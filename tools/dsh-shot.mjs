#!/usr/bin/env node
/**
 * dsh-shot.mjs —— **一条命令对 DSH 真机出图**：临时 profile + link 本包 + 独立端口实例 +
 * headless Edge + 等锚点 / 点击 / 按选择器裁剪 + 落 PNG（「渲染 → 截图验证」通道的真机那一棒）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【它补的是哪个洞】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `tools/render-shot.mjs` 能截图，但它要一个**已在跑的地址**；而"页面上真有坞面板"这件事，
 * 需要先有「装上了本包的独立端口实例」。此前这条链只有 ①装置（verify/real-machine，只采判据、
 * **不出图**）与 ②截图工具（能出图、**不认识真机**）两截，中间那截（把实例起出来再喂给截图工具）
 * 没人管 ⇒ `tools/render-shot.selftest.mjs` 的两个真机项长期 SKIP。本文件就是中间那一截。
 *
 * 于是「对真机坞面板出一张图」变成**一条命令**：
 *
 *   node tools/dsh-shot.mjs --out tools/evidence/<stamp>/dock-panel.png \
 *     --click "[data-guif-glyph]" --click-via js --click-index 0 \
 *     --wait-for "[data-guif-dock-actions]" --selector "[data-guif-dock-actions]"
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【纪律（与 verify/real-machine 同一套口径；用户级硬约束）】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 1. **绝不碰 127.0.0.1:3080**（用户正在用的 GUI）：全程只**读**它的监听 PID 做前后对比，
 *    任何一步都不连它、不杀它；端口是 `pickFreePort()` 挑的，与它无关。
 * 2. **临时 profile**：`guifshot<时间戳>`，从出厂模板建；**绝不写 `web`**；收尾只删**自己那个名字**
 *    （正则 ^guifshot…$ 之外的名字一律不删，`--keep` 也不删）。
 * 3. **只回收自己起的进程**：实例按**自己的 pid** 收（先 kill，再轮询端口确认释放，必要时
 *    `taskkill /PID <pid> /T /F`）；浏览器由 `render-shot` 按自己的 pid 收。**绝不按进程名批量杀**
 *    （本文件里不出现 `/IM`）。
 * 4. **不用整屏截图**：出图全靠 CDP `Page.captureScreenshot`（headless=new），没有系统级截屏调用。
 * 5. **起进程一律 `node <dsh 的 bin.js>`（shell:false）**：走 shell 会多一层 cmd.exe 包装，
 *    杀它带不走真正在跑的 node（装置早期实测泄漏过 8 个仍在监听 的实例）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么这里另起一份 profile/实例代码，而不 import verify/real-machine/lib/dsh.mjs】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 装置是**被独立核验的对象**：工具在运行期依赖它，等于让「被测方」变成「支撑方」，装置一改工具就崩。
 * 所以两边口径相同、代码各自一份（这里是 `profile / 端口 / 实例 / 回收` 四件事的最小实现）。
 * **口径若有分歧，以装置（verify/real-machine）为准**，改这里对齐。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【用法】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   node tools/dsh-shot.mjs --out <out.png|目录> [选项]
 *
 *   --out <path>            必填。产物路径（给目录则按 URL 推出 `<主机>-<端口>.png`）
 *   --wait-for <css>        等这个选择器出现（默认 `[data-guif-glyph]` =
 *                           **前置闸**：本包装上了、坞入口在册；超时 ⇒ 失败，不出图）
 *   --wait-for-timeout <ms> 等锚点超时（默认 30000；真机外壳首屏比静态页慢）
 *   --click <css>          出图前点击它（真机坞面板要"点开"才有内容）
 *   --click-index <n>       点第 n 个命中（0 基，默认 0）
 *   --click-via <mouse|js>  默认 mouse；**坞入口用 js**（图标中心被覆盖层挡着，真鼠点会被吞；
 *                           js = 对包住它的外壳行按钮派发 click，装置实测路径）
 *   --selector <css>        只截这个元素（例如 `[data-guif-dock-actions]`）；不给则截整视口
 *   --width/--height <px>   视口（默认 1440×900）
 *   --wait-ms <ms>          导航后等待（默认 800；真机外壳首屏比静态页慢）
 *   --timeout-ms <ms>       CDP 单步超时（默认 30000）
 *   --json                  结果以 JSON 打到 stdout（人读文案走 stderr）
 *   --profile <name>        临时 profile 名（默认 guifshot<时间戳>）
 *   --reuse                 允许用已存在的同名 profile（默认碰到同名就报错，免得污染别人的）
 *   --dsh-bin <path>        显式指定 DSH 的 node 入口（默认探测标准安装位）
 *   --link <spec>           link 规格（默认 link:<本包绝对路径>）
 *   --browser <path>        透传给 render-shot 的浏览器可执行文件
 *   --keep                  保留临时 profile 与实例日志（排障）
 *   --dry-run               只打印计划，不起任何进程（静态自检用）
 *   -h, --help              打印用法
 *
 * 退出码：0 = 出图成功且收尾干净｜1 = 运行期失败（起不来实例 / 不出图 / 收尾没回收干净）｜
 *         2 = 用法错误（参数写错、profile 同名、指向 3080…）
 */

import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { UsageError, renderShot } from './render-shot.mjs';

import { DEFAULT_MIN_FREE_MB, GUI_FRAME_ENTRY_ID, LIVE_GUI_PORT, OWN_PROFILE_RE, PKG_DIR, PROFILE_PREFIX, evaluateMemoryGate, profileDir } from './dsh-shot/env.mjs';
import { countLoaderEntry, maskToken } from './dsh-shot/probe.mjs';
import { setActiveInstance } from './dsh-shot/instance.mjs';
import { USAGE, parseCli } from './dsh-shot/cli.mjs';
import { buildPlan } from './dsh-shot/plan.mjs';
import { createDeps } from './dsh-shot/deps.mjs';

export { DEFAULT_MIN_FREE_MB, GUI_FRAME_ENTRY_ID, LIVE_GUI_PORT, OWN_PROFILE_RE, PKG_DIR, PROFILE_PREFIX, dshEntry, dshHome, evaluateMemoryGate, profileDir, readFreeMemoryMb } from './dsh-shot/env.mjs';
export { countLoaderEntry, isPortListening, listenerPid, maskToken, parseStartUrl, pickFreePort } from './dsh-shot/probe.mjs';
export { startInstance } from './dsh-shot/instance.mjs';
export { USAGE, parseCli } from './dsh-shot/cli.mjs';
export { buildPlan } from './dsh-shot/plan.mjs';
export { createDeps } from './dsh-shot/deps.mjs';

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const d = createDeps(overrides);
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    d.err(`[dsh-shot] 用法错误：${error?.message ?? error}\n\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    d.stdout(`${USAGE}\n`);
    return 0;
  }
  const log = d.log;
  const entry = d.dshEntry({ explicit: options.dshBin });
  const stamp = d.now().toISOString().replace(/[:.]/g, '-');
  const profile = options.profile ?? `${PROFILE_PREFIX}${Date.now().toString(36)}`;
  const linkSpec = options.link ?? `link:${PKG_DIR.replace(/\\/g, '/')}`;
  const evidenceDir = path.resolve(process.cwd(), 'tools', 'evidence', stamp);
  const outPath = options.out;
  const startedAt = Date.now();
  const minFreeMb = Number.isFinite(options.minFreeMb) ? options.minFreeMb : DEFAULT_MIN_FREE_MB;

  const dryPort = 0;
  if (options.dryRun) {
    // dry-run 只打印计划：**不起任何进程** ⇒ 内存闸只作"读数播报"（不达标也不拦），
    // 否则机器紧张时连"先看看要跑什么"都做不到。
    const memory = evaluateMemoryGate({ freeMb: d.readFreeMemoryMb({}), minFreeMb });
    const plan = buildPlan(options, {
      entry: entry ?? '(未找到 DSH 的 node 入口，真跑前需 --dsh-bin 指定)',
      profile,
      port: dryPort,
      linkSpec,
      outPath,
      memory,
    });
    log('[dsh-shot] dry-run：不做任何动作（不建 profile、不起进程、不写文件）。');
    log(`[dsh-shot] 内存闸（dry-run 只播报不拦）：${memory.message}`);
    for (const line of plan.steps) log(`  ${line}`);
    if (options.json) d.stdout(`${JSON.stringify({ ok: true, dryRun: true, memory, plan })}\n`);
    return 0;
  }

  // ⓪ **内存硬闸**：必须在**起任何进程之前**（比读 3080 基线还早 —— 那一步要 spawn PowerShell）。
  //    未达标 ⇒ fail-closed：非零退出、不写 PNG、不建 profile、不起实例、不起浏览器。
  const memory = evaluateMemoryGate({ freeMb: d.readFreeMemoryMb({}), minFreeMb });
  log(`[dsh-shot] ⓪ 内存闸：${memory.message}`);
  if (!memory.ok) {
    d.err(`[dsh-shot] 失败：${memory.message}\n`);
    return memory.exitCode ?? 1;
  }

  if (entry === null) {
    d.err('[dsh-shot] 找不到 DSH 的 node 入口（lib/bin.js）：用 --dsh-bin <path> 或设 GUIF_DSH_BIN / DSH_ROOT\n');
    return 2;
  }

  // ① 先记 3080 的监听 PID（收尾必须相同；全程只读）
  const livePidBefore = await d.listenerPid(LIVE_GUI_PORT);
  log(`[dsh-shot] 基线：${LIVE_GUI_PORT} 监听 PID = ${livePidBefore ?? '(未读到)'}（只读；收尾核对不变）`);

  const existingProfile = profileDir(profile);
  if (d.existsSync(existingProfile) && !options.reuse) {
    d.err(`[dsh-shot] 用法错误：临时 profile 已存在：${existingProfile}\n  换个名字，或加 --reuse（会往那个 profile 上继续装）\n`);
    return 2;
  }

  d.installCleanupGuard(log);
  const result = { ok: false, profile, linkSpec, out: outPath, evidenceDir, memory, steps: [], liveGui: { port: LIVE_GUI_PORT, pidBefore: livePidBefore } };
  let instance = null;
  let exitCode = 1;
  try {
    // ② 从出厂模板建临时 profile
    const created = await d.runDsh(entry, ['--profile', profile, '--from-default-profile', 'web', '--dump-config']);
    const controlCount = countLoaderEntry(created.stdout, GUI_FRAME_ENTRY_ID);
    result.steps.push({ step: 'create-profile', code: created.code, entryCount: controlCount });
    log(`[dsh-shot] ② 建 profile：exit=${created.code}｜loader entry \`${GUI_FRAME_ENTRY_ID}\`=${controlCount}（对照：应为 0）`);
    if (created.code !== 0) throw new Error(`建临时 profile 失败（exit=${created.code}）：${`${created.stdout}${created.stderr}`.trim().split(/\r?\n/).slice(-3).join(' / ')}`);

    // ③ 装本包（link 到包目录，改源码后重跑即最新）
    const added = await d.runDsh(entry, ['plugin', '--profile', profile, 'add', linkSpec], { timeoutMs: 300_000 });
    result.steps.push({ step: 'link-package', code: added.code });
    log(`[dsh-shot] ③ link 装包：exit=${added.code}`);
    if (added.code !== 0) throw new Error(`link 装包失败（exit=${added.code}）：${`${added.stdout}${added.stderr}`.trim().split(/\r?\n/).slice(-3).join(' / ')}`);

    // ④ 前置闸：loader entry 恰好一次（duplicate 会让 DSH 起不来）
    const dumped = await d.runDsh(entry, ['--profile', profile, '--dump-config']);
    const installCount = countLoaderEntry(dumped.stdout, GUI_FRAME_ENTRY_ID);
    result.steps.push({ step: 'dump-config', code: dumped.code, entryCount: installCount });
    log(`[dsh-shot] ④ 前置闸：loader entry \`${GUI_FRAME_ENTRY_ID}\` = ${installCount} 次（必须恰 1）`);
    if (dumped.code !== 0 || installCount !== 1) {
      throw new Error(`前置闸未过：dump-config exit=${dumped.code}，entry 计数=${installCount}（应为 1）`);
    }

    // ⑤ 起独立端口实例（挑的端口与 3080 无关）
    const port = await d.pickFreePort();
    if (port === LIVE_GUI_PORT) throw new Error(`拿到的端口竟是 ${LIVE_GUI_PORT}（活体 GUI 的端口）——放弃本次`);
    const logPath = path.join(evidenceDir, 'instance.log');
    instance = d.startInstance({ entry, profile, port, logPath });
    setActiveInstance({ pid: instance.pid, port });
    log(`[dsh-shot] ⑤ 起实例：port=${port}（独立端口）｜pid=${instance.pid}｜日志 ${logPath}`);
    const started = await instance.waitForUrl();
    if (started.url === null) throw new Error(`实例没起来：${started.reason}（看 ${logPath}）`);
    result.steps.push({ step: 'start-instance', port, pid: instance.pid, url: maskToken(started.url) });
    log(`[dsh-shot] ⑥ 实例就绪：${maskToken(started.url)}`);

    // ⑦ 出图（headless Edge + CDP；等锚点/点击/裁剪都在 render-shot 里）
    const shot = await d.renderShot(
      {
        input: started.url,
        out: outPath,
        width: options.width,
        height: options.height,
        fullPage: false,
        waitMs: options.waitMs,
        json: false,
        browser: options.browser,
        timeoutMs: options.timeoutMs,
        keepProfile: false,
        waitFor: options.waitFor,
        waitForTimeoutMs: options.waitForTimeout,
        selector: options.selector,
        click: options.click,
        clickIndex: options.clickIndex,
        clickVia: options.clickVia,
      },
      { log },
    );
    result.steps.push({ step: 'render-shot', out: shot.out, bytes: shot.bytes, size: shot.size, clip: shot.clip, clicks: shot.clicks, waitedMs: shot.waitedMs });
    result.out = shot.out;
    result.bytes = shot.bytes;
    result.size = shot.size;
    result.clip = shot.clip;
    result.clicks = shot.clicks;
    result.waitedMs = shot.waitedMs;
    result.ok = true;
    exitCode = 0;
  } catch (error) {
    result.error = `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
    d.err(`[dsh-shot] ${error instanceof UsageError ? '用法错误' : '失败'}：${error?.message ?? error}\n`);
    exitCode = error instanceof UsageError ? 2 : 1;
  } finally {
    // ⑧ 收尾：只回收自己起的实例，再核对 3080 未变，最后才删自己那个临时 profile
    if (instance !== null) {
      const reclaimed = await instance.stopAndVerify();
      result.instance = { port: reclaimed.port, pid: reclaimed.pid, listeningAfter: reclaimed.listening, reclaimed: reclaimed.reclaimed };
      log(`[dsh-shot] ⑧ 回收实例：port ${reclaimed.port} pid ${reclaimed.pid}｜仍监听=${reclaimed.listening}｜已回收=${reclaimed.reclaimed}`);
      if (!reclaimed.reclaimed) {
        d.err('[dsh-shot] ⚠ 自己起的实例端口仍在监听（收尾不干净）——这算失败，不要把它当成"跑完了"\n');
        result.ok = false;
        exitCode = exitCode === 0 ? 1 : exitCode;
      }
    }
    setActiveInstance(null);
    const livePidAfter = await d.listenerPid(LIVE_GUI_PORT);
    result.liveGui.pidAfter = livePidAfter;
    result.liveGui.unchanged = livePidAfter === livePidBefore;
    log(`[dsh-shot] ⑧ 3080 监听 PID：前 ${livePidBefore ?? '(未读到)'} → 后 ${livePidAfter ?? '(未读到)'}（未变=${result.liveGui.unchanged}）`);
    if (!result.liveGui.unchanged) {
      d.err('[dsh-shot] ⚠ 3080 的监听者变了 —— 红线被触碰，本次结果不可信\n');
      result.ok = false;
      exitCode = 1;
    }
    if (options.keep) {
      log(`[dsh-shot] --keep：保留临时 profile ${profile}（${profileDir(profile)}）与日志 ${path.join(evidenceDir, 'instance.log')}`);
    } else if (OWN_PROFILE_RE.test(profile)) {
      try {
        d.rmSync(profileDir(profile), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
        log(`[dsh-shot] ⑧ 已删除临时 profile ${profile}`);
      } catch {
        log(`[dsh-shot] ⚠ 临时 profile 没删干净（不影响本次结果）：${profileDir(profile)}`);
      }
    } else {
      log(`[dsh-shot] ⑧ profile 名不在自建白名单（${PROFILE_PREFIX}…）里，**不删**：${profile}`);
    }
    result.elapsedMs = Date.now() - startedAt;
  }

  if (options.json) d.stdout(`${JSON.stringify(result)}\n`);
  else {
    const size = result.size ?? null;
    log(`[dsh-shot] ${result.ok ? '✔ 完成' : '✗ 未完成'}：${result.ok ? `${result.out}（${result.bytes} 字节，${size.width}×${size.height}）` : result.error}`);
  }
  return exitCode;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main();
}