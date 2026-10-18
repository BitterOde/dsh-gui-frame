// tools/render-shot/cdp.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 裸 CDP：连接、端口、WebSocket、DevTools 等待、进程树回收、求值与点击

import { CLICK_SETTLE_MS, DEFAULT_TIMEOUT_MS, WAIT_FOR_POLL_MS } from './args.mjs';
import { UsageError } from './constants.mjs';
import { clickJsExpression, clickPointExpression, selectorProbeExpression } from './expressions.mjs';
import { assertAnchorFound, assertClickPoint } from './asserts.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

export class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    socket.addEventListener('message', (event) => this.#onMessage(event.data));
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const [, entry] of this.pending) entry.reject(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });
  }

  #onMessage(data) {
    let message;
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return; // 非 JSON 帧（协议层心跳之类）直接忽略，不打断主流程
    }
    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`CDP ${entry.method} 失败：${message.error.message ?? JSON.stringify(message.error)}`));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method === 'string') {
      for (const listener of [...this.listeners]) listener(message);
    }
  }

  /** 发一条命令；`sessionId` 给页面级命令。 */
  send(method, params = {}, sessionId = undefined) {
    if (this.closed) return Promise.reject(new Error(`CDP 连接已关闭，无法发送 ${method}`));
    const id = this.nextId;
    this.nextId += 1;
    const payload = sessionId === undefined ? { id, method, params } : { id, method, params, sessionId };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.socket.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** 等一个事件（可按 sessionId 过滤）。 */
  waitForEvent(method, { sessionId = undefined, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`等待事件超时（${timeoutMs}ms）：${method}`));
      }, timeoutMs);
      const listener = (message) => {
        if (message.method !== method) return;
        if (sessionId !== undefined && message.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message.params ?? {});
      };
      this.listeners.add(listener);
    });
  }

  /** 浏览器级关闭：不抛（收尾路径上失败也不该盖住主错误）。 */
  async tryClose() {
    try {
      await this.send('Browser.close');
    } catch {
      /* 收尾尽力而为 */
    }
  }

  dispose() {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      /* 已关 */
    }
  }
}

// ── 小工具 ─────────────────────────────────────────────────────────────────────
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 带超时的 Promise（把"卡死"变成可读错误，而不是永远挂着）。 */
export function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** 挑一个空闲端口：绑 0 号端口拿系统分配，再立刻释放给浏览器用。 */
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('拿不到空闲端口'))));
    });
  });
}

/** 连上 WebSocket（Node 22+ 有全局 WebSocket；本机 Node 24 有）。 */
export function openWebSocket(url, timeoutMs) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('本工具需要 Node 22+（全局 WebSocket / fetch 都在用）；当前运行时没有 WebSocket');
  }
  return withTimeout(
    new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(socket), { once: true });
      socket.addEventListener('error', () => reject(new Error(`WebSocket 连接失败：${url}`)), { once: true });
    }),
    timeoutMs,
    `连接 CDP WebSocket 超时（${timeoutMs}ms）：${url}`,
  );
}

/**
 * 等 CDP 端点就绪。两条路并行：
 *   ① profile 里的 `DevToolsActivePort`（浏览器**真实**绑定的端口，最可靠）；
 *   ② `http://127.0.0.1:<port>/json/version`（回环 HTTP，不是外网）。
 * 用 stdio:'ignore' 起进程 ⇒ 不必去接 stderr 管道（受限沙箱下管道正是 EPERM 的来源）。
 */
export async function waitForDevTools(userDataDir, port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let childExit = null;
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });
  while (Date.now() < deadline) {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    if (existsSync(portFile)) {
      try {
        const [portLine, pathLine] = readFileSync(portFile, 'utf8').split('\n');
        const realPort = Number((portLine ?? '').trim());
        const browserPath = (pathLine ?? '').trim();
        if (Number.isInteger(realPort) && realPort > 0 && browserPath !== '') {
          return `ws://127.0.0.1:${realPort}${browserPath}`;
        }
      } catch {
        /* 文件正在写，下一轮再读 */
      }
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) });
      if (response.ok) {
        const info = await response.json();
        if (typeof info.webSocketDebuggerUrl === 'string' && info.webSocketDebuggerUrl !== '') return info.webSocketDebuggerUrl;
      }
    } catch {
      /* 还没起来 */
    }
    if (childExit !== null && Date.now() - (deadline - timeoutMs) > 800) {
      throw new Error(
        `浏览器启动后立刻退出（exit code ${childExit.code ?? '?'}${childExit.signal ? `, signal ${childExit.signal}` : ''}），CDP 没起来`,
      );
    }
    await sleep(100);
  }
  throw new Error(`CDP 连接超时（${timeoutMs}ms）：端点始终没出现在 127.0.0.1:${port}`);
}

/**
 * 只按**自己记录的 pid** 回收进程树。
 * Windows 用 `taskkill /PID <pid> /T /F`：`/T` 只覆盖该 pid 的子树；**不出现 `/IM`**，
 * 所以绝不会按进程名批量误杀用户自己开着的浏览器。POSIX 走进程组。
 */
export function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // detached 起的进程组
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 已经没了 */
    }
  }
}

/** 等子进程退出（轮询；返回是否真的退了）。 */
export async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    await sleep(50);
  }
  return child.exitCode !== null || child.signalCode !== null;
}

// ── 页面交互：点击 / 等锚点 / 求值（真机页面才用得上）────────────────────────────

/** 跑一段页面表达式并取回值（CDP 把返回值嵌在 `result.value`）。 */
export async function evaluateExpression(connection, sessionId, expression, options) {
  const result = await withTimeout(
    connection.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId),
    options.timeoutMs,
    `CDP 命令超时（${options.timeoutMs}ms）：Runtime.evaluate`,
  );
  return result?.result?.value ?? null;
}

/**
 * 等锚点出现：每 `WAIT_FOR_POLL_MS` 数一次命中个数，超时**抛错**（不截图）。
 * 为什么在 Node 侧轮询而不是在页面里挂一个"等到出现为止"的 Promise：轮询能落日志、
 * 能在超时那一刻说清"等了多久、选择器是什么"；页面里的长 Promise 只会把问题糊成一个超时。
 */
export async function waitForSelector(connection, sessionId, options, log) {
  const deadline = Date.now() + options.waitForTimeoutMs;
  const expression = selectorProbeExpression(options.waitFor);
  let last = null;
  for (;;) {
    last = await evaluateExpression(connection, sessionId, expression, options);
    if (last !== null && typeof last === 'object') {
      // 非法选择器属于"你传错了"（exit 2），不必等满超时；"还没出现"才继续等。
      if (typeof last.error === 'string') assertAnchorFound(last, options.waitFor, 0);
      if (last.count > 0) {
        log(`[render-shot] 锚点在场：${options.waitFor}（${last.count} 个）`);
        return last.count;
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(WAIT_FOR_POLL_MS);
  }
  return assertAnchorFound(last, options.waitFor, options.waitForTimeoutMs);
}

/** 点击一次：真鼠标（默认）或页面内 JS。两条路径都**记账**（`via` 与命中详情），不许悄悄兜底。 */
export async function clickOnce(connection, sessionId, options, log) {
  const selector = options.click;
  if (options.clickVia === 'js') {
    const value = await evaluateExpression(connection, sessionId, clickJsExpression(selector, options.clickIndex), options);
    if (value === null || typeof value !== 'object') throw new Error(`点击（js）失败：页面没有回读数（${selector}）`);
    if (typeof value.error === 'string') throw new UsageError(`--click 不是合法的 CSS 选择器：${value.error}`);
    if (value.ok !== true) throw new Error(`点击（js）失败：${value.reason ?? '未知'}（${selector} 第 ${options.clickIndex} 个）`);
    log(`[render-shot] 点击（js→最近的外壳 button）：${selector}[${options.clickIndex}] → ${value.clicked}`);
    await sleep(CLICK_SETTLE_MS);
    return { selector, index: options.clickIndex, via: 'js', ok: true, tag: value.tag, clicked: value.clicked };
  }
  const probe = await evaluateExpression(connection, sessionId, clickPointExpression(selector, options.clickIndex), options);
  const point = assertClickPoint(probe, selector);
  await connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId);
  await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
  await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
  log(
    `[render-shot] 点击（真鼠标）：${selector}[${options.clickIndex}] @ (${Math.round(point.x)},${Math.round(point.y)})，` +
      `命中 ${point.hit?.tag ?? '?'}，命中自身=${point.hit?.self === true}`,
  );
  await sleep(CLICK_SETTLE_MS);
  return {
    selector,
    index: options.clickIndex,
    via: 'mouse',
    ok: true,
    x: Math.round(point.x),
    y: Math.round(point.y),
    hit: point.hit ?? null,
  };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────

/**
 * 把调用方给的选项归一化成"每一步都明确"的一份（纯函数，离线可测）。
 *
 * 为什么值得单独一个函数：`renderShot` 的三个调用方（CLI、自检 G1、编排器 dsh-shot）给的对象
 * **字段并不一样**，而 `if (options.click !== null)` 在 `click === undefined` 时是**真** ——
 * 那会让"没打算点击"的调用去点一个 `undefined` 选择器。归一化把这种坑挡在一处：
 * 缺省 = 不做这一步或用默认值。
 */
