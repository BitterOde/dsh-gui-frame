// tools/render-shot/render.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 渲染编排：入参归一化、会话状态、一次出图、量高与唤醒

import { DEFAULT_HEIGHT, DEFAULT_TIMEOUT_MS, DEFAULT_WAIT_FOR_TIMEOUT_MS, DEFAULT_WAIT_MS, DEFAULT_WIDTH, MAX_CAPTURE_HEIGHT, MAX_CAPTURE_PIXELS, MAX_WAKE_STEPS, WAKE_SETTLE_MS, WAKE_STEP_MS } from './args.mjs';
import { browserCandidates, findBrowserExecutable } from './browser.mjs';
import { resolveTargets } from './inputs.mjs';
import { pageHeightCommand, selectorRectExpression } from './expressions.mjs';
import { assertElementRect } from './asserts.mjs';
import { buildCaptureSteps, buildLaunchArgs, buildPagePlan } from './plan.mjs';
import { assertPngSize, assertScreenshotBytes } from './png.mjs';
import { CdpConnection, clickOnce, evaluateExpression, killProcessTree, openWebSocket, pickFreePort, sleep, waitForDevTools, waitForExit, waitForSelector, withTimeout } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function normalizeRenderOptions(raw) {
  const source = raw ?? {};
  return {
    ...source,
    input: source.input ?? null,
    out: source.out ?? null,
    width: Number.isFinite(source.width) ? source.width : DEFAULT_WIDTH,
    height: Number.isFinite(source.height) ? source.height : DEFAULT_HEIGHT,
    fullPage: source.fullPage === true,
    waitMs: Number.isFinite(source.waitMs) ? source.waitMs : DEFAULT_WAIT_MS,
    timeoutMs: Number.isFinite(source.timeoutMs) ? source.timeoutMs : DEFAULT_TIMEOUT_MS,
    keepProfile: source.keepProfile === true,
    browser: source.browser ?? null,
    waitFor: source.waitFor ?? null,
    waitForTimeoutMs: Number.isFinite(source.waitForTimeoutMs) ? source.waitForTimeoutMs : DEFAULT_WAIT_FOR_TIMEOUT_MS,
    selector: source.selector ?? null,
    click: source.click ?? null,
    clickIndex: Number.isInteger(source.clickIndex) && source.clickIndex >= 0 ? source.clickIndex : 0,
    clickVia: source.clickVia === 'js' ? 'js' : 'mouse',
  };
}

/** 一次渲染里的临时资源（进程 + profile 目录），供异常路径统一回收。 */
export let activeSession = null;

/** 进程级兜底：脚本被 Ctrl+C / 异常终止时，也按记录的 pid 收掉浏览器。 */
export function installCleanupGuard(log) {
  const cleanup = (reason) => {
    const session = activeSession;
    if (session === null) return;
    activeSession = null;
    log(`[render-shot] 收尾（${reason}）：按 pid ${session.child.pid} 回收自己起的浏览器`);
    killProcessTree(session.child.pid);
    if (!session.keepProfile) {
      try {
        rmSync(session.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        /* 收尾尽力而为 */
      }
    }
  };
  process.once('exit', () => cleanup('进程退出'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      cleanup(signal);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

/**
 * 渲染一张截图。
 *
 * **入参归一化**：程序化调用方（自检的 G1、编排器 dsh-shot）可能只给一部分字段。
 * 缺省一律按"这一步不做 / 用默认值"处理 —— 而不是让 `undefined !== null` 这种判断为真，
 * 把流程带进"去点一个 undefined 选择器"的沟里（那会让真机自检以一种莫名其妙的方式失败）。
 *
 * @param {ReturnType<typeof parseArgs>} rawOptions
 * @param {{log?:(line:string)=>void, exists?:(p:string)=>boolean, isDirectory?:(p:string)=>boolean}} [deps]
 */
export async function renderShot(rawOptions, deps = {}) {
  const log = deps.log ?? ((line) => process.stderr.write(`${line}\n`));
  const exists = deps.exists ?? existsSync;
  const isDirectory =
    deps.isDirectory ??
    ((candidate) => {
      try {
        return statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });
  const options = normalizeRenderOptions(rawOptions);
  const startedAt = Date.now();

  // ① 先校验输入/输出（"路径写错了"要在找浏览器之前就报出来）；
  //    目标是本地 HTML 还是真机 URL 在这里就分好，后面只认 target。
  const { kind, target, outPath } = resolveTargets({ input: options.input, out: options.out, exists, isDirectory });

  // ② 找浏览器
  const browser =
    options.browser !== null
      ? findBrowserExecutable({ env: process.env, platform: process.platform, exists, explicit: options.browser })
      : findBrowserExecutable({ env: process.env, platform: process.platform, exists });
  if (browser === null) {
    const tried = browserCandidates(process.env, process.platform);
    throw new Error(
      `找不到可用的浏览器（Edge/Chrome/Chromium）。已试过 ${tried.length} 条标准路径` +
        `${tried.length > 0 ? `，例如 ${tried[0]}` : ''}；可用 --browser <path> 或环境变量 GUIF_BROWSER_PATH / CHROME_PATH 指定`,
    );
  }

  // ③ 专属 profile + 空闲端口
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const userDataDir = path.join(tmpdir(), `guif-render-shot-${token}`);
  await mkdir(userDataDir, { recursive: true });
  await mkdir(path.dirname(outPath), { recursive: true });
  const port = await pickFreePort();
  const launchArgs = buildLaunchArgs({
    userDataDir,
    port,
    width: options.width,
    height: options.height,
    fullPage: options.fullPage,
  });

  log(`[render-shot] 渲染 ${kind === 'url' ? target.replace(/token=[^&]*/, 'token=***') : target}`);
  log(`[render-shot] 浏览器 ${browser.path}（headless=new，profile ${userDataDir}）`);

  const child = spawn(browser.path, launchArgs, {
    stdio: 'ignore', // 不接管道：受限沙箱下管道 stdio 会被拒（EPERM），而这里也不需要浏览器日志
    windowsHide: true, // 双保险：绝不出现控制台窗口
    detached: process.platform !== 'win32', // POSIX 下建进程组，方便整组回收
  });
  activeSession = { child, userDataDir, keepProfile: options.keepProfile === true };

  let connection = null;
  try {
    if (child.pid === undefined) throw new Error('浏览器进程没起来（spawn 未返回 pid）');
    const endpoint = await waitForDevTools(userDataDir, port, child, options.timeoutMs);
    log(`[render-shot] CDP 就绪：${endpoint.replace(/\/devtools\/browser\/.*$/, '/devtools/browser/…')}`);
    const socket = await openWebSocket(endpoint, options.timeoutMs);
    connection = new CdpConnection(socket);

    // ④ 拿一个页面目标并 attach（flatten：事件与命令共用一条连接，靠 sessionId 分流）
    const { targetInfos = [] } = await connection.send('Target.getTargets');
    let targetId = targetInfos.find((info) => info.type === 'page')?.targetId ?? null;
    if (targetId === null) {
      const created = await connection.send('Target.createTarget', { url: 'about:blank' });
      targetId = created.targetId;
    }
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });

    // ⑤ 跑页面计划：先定视口 → 导航 → 等 load → 等字体
    const loaded = connection.waitForEvent('Page.loadEventFired', { sessionId, timeoutMs: options.timeoutMs });
    for (const step of buildPagePlan({ url: target, width: options.width, height: options.height, fullPage: options.fullPage })) {
      const result = await withTimeout(
        connection.send(step.method, step.params, sessionId),
        options.timeoutMs,
        `CDP 命令超时（${options.timeoutMs}ms）：${step.method}`,
      );
      if (step.method === 'Page.navigate' && typeof result.errorText === 'string' && result.errorText !== '') {
        throw new Error(`页面导航失败：${result.errorText}（${target}）`);
      }
    }
    await loaded;
    if (options.waitMs > 0) await sleep(options.waitMs);

    // ⑥ 真机页面才需要的那三步：点击 → 等锚点 → 量裁剪框。
    //    顺序即语义：**先点开、再等它出现、最后才量**（先量会量到还没渲染的 0 尺寸框）。
    const clicks = [];
    if (options.click !== null) clicks.push(await clickOnce(connection, sessionId, options, log));

    let waitedMs = 0;
    if (options.waitFor !== null) {
      const waitStartedAt = Date.now();
      await waitForSelector(connection, sessionId, options, log);
      waitedMs = Date.now() - waitStartedAt;
    }

    let clipRect = null;
    if (options.selector !== null) {
      const probe = await evaluateExpression(connection, sessionId, selectorRectExpression(options.selector), options);
      clipRect = assertElementRect(probe, options.selector);
      log(
        `[render-shot] 裁剪框（${clipRect.tag ?? '元素'} ${options.selector}）：` +
          `${clipRect.width}×${clipRect.height} @ (${clipRect.x},${clipRect.y})`,
      );
    }

    // ⑦ 量高度（整页模式才有意义）+ 拍图
    let pageHeight = null;
    let captureHeight = options.height;
    let clamped = false;
    if (options.fullPage) {
      pageHeight = await measurePageHeight(connection, sessionId, options);
      // 唤醒顺序是刻意的：**先量再扫、扫完再量一次** —— 扫描本身可能把内容撑高
      // （懒图加载、reveal 展开），拿旧高度去拍会从底部裁掉一截。
      pageHeight = await wakeFullPage(connection, sessionId, options, pageHeight, log);
      if (options.width * pageHeight > MAX_CAPTURE_PIXELS) {
        throw new Error(
          `整页像素超上限：${options.width}×${pageHeight} > ${MAX_CAPTURE_PIXELS} 像素（改小 --width，或只截视口）`,
        );
      }
      captureHeight = pageHeight;
      if (captureHeight > MAX_CAPTURE_HEIGHT) {
        clamped = true;
        captureHeight = MAX_CAPTURE_HEIGHT;
        log(`[render-shot] ⚠ 页面高度 ${pageHeight}px 超过单边上限 ${MAX_CAPTURE_HEIGHT}px，截图截到 ${MAX_CAPTURE_HEIGHT}px（页面高度照实报告）`);
      }
    }

    let base64 = null;
    for (const step of buildCaptureSteps({
      width: options.width,
      height: options.height,
      pageHeight: captureHeight,
      fullPage: options.fullPage,
      clip: clipRect,
    })) {
      const result = await withTimeout(
        connection.send(step.method, step.params, sessionId),
        options.timeoutMs,
        `CDP 命令超时（${options.timeoutMs}ms）：${step.method}`,
      );
      if (typeof result.data === 'string') base64 = result.data;
    }
    if (base64 === null) throw new Error('截图返回空（CDP 没有回传 PNG 数据）');
    const bytes = assertScreenshotBytes(Buffer.from(base64, 'base64'));
    // 产物尺寸必须与**请求**对得上：裁剪被忽略 / 拍成整屏 / 拍成空图都会在这里当场翻红。
    const size = assertPngSize(bytes, clipRect !== null ? { width: clipRect.width, height: clipRect.height } : { width: options.width, height: captureHeight });
    await writeFile(outPath, bytes);

    const elapsedMs = Date.now() - startedAt;
    return {
      ok: true,
      out: outPath,
      bytes: bytes.length,
      width: options.width,
      height: options.height,
      size,
      pageHeight,
      captureHeight,
      clamped,
      fullPage: options.fullPage,
      target: { kind, url: kind === 'url' ? target.replace(/token=[^&]*/, 'token=***') : null },
      clip: clipRect,
      clicks,
      waitedMs,
      browser: browser.path,
      elapsedMs,
    };
  } finally {
    // ⑧ 收尾：CDP 优雅关闭 → 仍不退出则按 pid 收进程树 → 删临时 profile
    if (connection !== null) await connection.tryClose();
    let exited = await waitForExit(child, 3000);
    if (!exited) {
      log(`[render-shot] CDP 关闭后进程仍在，按 pid ${child.pid} 收自己起的这棵树`);
      killProcessTree(child.pid);
      exited = await waitForExit(child, 4000);
    }
    if (connection !== null) connection.dispose();
    void exited;
    activeSession = null;
    if (options.keepProfile === true) {
      log(`[render-shot] --keep-profile：保留 ${userDataDir}`);
    } else {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }).catch(() => {
        log(`[render-shot] ⚠ 临时 profile 没删干净（不影响本次结果）：${userDataDir}`);
      });
    }
  }
}

/** 量一次页面高度（CSS px）；拿不到值时退回视口高度。 */
export async function measurePageHeight(connection, sessionId, options) {
  const result = await connection.send(pageHeightCommand().method, pageHeightCommand().params, sessionId);
  const value = result?.result?.value;
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : options.height;
}

/**
 * 整页唤醒：从顶扫到底，给 IntersectionObserver 类"滚动才出现"的内容一个出现的机会。
 * 有步数上限 —— 一个静态超高页面不该把我们拖进几万次滚动。
 * @returns {Promise<number>} 唤醒后**重测**的页面高度（扫描可能把内容撑高）
 */
export async function wakeFullPage(connection, sessionId, options, initialHeight, log) {
  let height = initialHeight;
  const step = Math.max(200, options.height);
  let steps = 0;
  for (let y = 0; y < height && steps < MAX_WAKE_STEPS; y += step) {
    const expression = `window.scrollTo(0, ${y})`;
    await connection.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId).catch(() => null);
    steps += 1;
    await sleep(WAKE_STEP_MS);
    height = Math.max(height, await measurePageHeight(connection, sessionId, options));
  }
  await connection.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)', returnByValue: true }, sessionId).catch(() => null);
  await sleep(WAKE_SETTLE_MS);
  const finalHeight = Math.max(height, await measurePageHeight(connection, sessionId, options));
  log(`[render-shot] 整页唤醒完成（${steps} 步，扫描高度 ${finalHeight}px）`);
  return finalHeight;
}

/** 人读输出（`--json` 时改走 stderr，避免污染 stdout 的 JSON）。 */
