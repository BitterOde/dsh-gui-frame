/**
 * lib/cdp.mjs —— 真机验收装置 · **headless 浏览器 + CDP**这一半。
 *
 * 为什么用 Edge + CDP 直连（而不是 Playwright）：本仓**零第三方依赖**是硬口径，
 * 而 Node v24 自带全局 `WebSocket`，够用；captain 已用这条路跑通两轮真机验收。
 *
 * 回收纪律：只杀**命令行里带本脚本专属 `--user-data-dir`** 的 msedge 进程 ——
 * 绝不「杀所有 msedge」（用户自己的浏览器就在同一台机器上）。
 */
import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findEdge() {
  for (const candidate of EDGE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 起 headless Edge。`userDataDir` 是**专属标记**（回收时按它匹配命令行），必须唯一。
 * @returns {{child:object, pid:number, profileMarker:string, stop:Function}}
 */
export function launchEdge({ userDataDir, port, logPath, target = 'about:blank' }) {
  const exe = findEdge();
  if (exe === null) throw new Error('找不到 msedge.exe（真机验收需要 Edge）');
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'a');
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1280,900',
    '--remote-allow-origins=*',
    target,
  ];
  const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', fd, fd] });
  const marker = path.basename(userDataDir);
  return {
    child,
    pid: child.pid,
    profileMarker: marker,
    logPath,
    stop() {
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
      try {
        closeSync(fd);
      } catch {
        /* 已关 */
      }
    },
  };
}

/** 等 CDP 端点起来并返回页面目标（type === 'page'）。 */
export async function waitForPageTarget(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = Array.isArray(list) ? list.find((target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string') : null;
      if (page !== undefined && page !== null) return page;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`等 CDP 页面目标超时（${timeoutMs}ms）：${lastError?.message ?? ''}`);
}

/** 一个极简 CDP 会话：`send()` + `evaluate()` + 事件账本。 */
export class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.events = [];
    this.seq = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
        return;
      }
      if (message.method !== undefined) this.events.push(message);
    };
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new CdpSession(ws);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, (message) => (message.error !== undefined ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`)) : resolve(message.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails !== undefined) return { __evalError: result.exceptionDetails.text };
    return result.result.value;
  }

  /** 装页面级装置：在**任何页面脚本之前**执行（变异注入与 SPA 导航都在它之后仍生效）。 */
  addInitScript(source) {
    return this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  navigated(url) {
    return this.send('Page.navigate', { url });
  }

  consoleEntries() {
    return this.events
      .filter((event) => event.method === 'Runtime.consoleAPICalled')
      .map((event) => ({
        type: event.params.type,
        text: (event.params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? arg.type ?? '')).join(' '),
      }));
  }

  exceptions() {
    return this.events
      .filter((event) => event.method === 'Runtime.exceptionThrown')
      .map((event) => String(event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text ?? '').slice(0, 400));
  }

  logEntries() {
    return this.events
      .filter((event) => event.method === 'Log.entryAdded')
      .map((event) => ({ level: event.params.entry.level, text: String(event.params.entry.text).slice(0, 400) }));
  }

  /**
   * 网络响应：判一条 API 请求「到底发出去没有、回的是什么码」。
   * 为什么必须有它：客户端上报器把 `flush()` 的结果**丢掉**（界面上的 `accepted` 只代表「进本地队列」），
   * 所以「界面显示 sent」不能推出「宿主收到了」——只有响应码能分清这两件事。
   */
  responses() {
    return this.events
      .filter((event) => event.method === 'Network.responseReceived')
      .map((event) => ({
        url: String(event.params.response?.url ?? ''),
        status: Number(event.params.response?.status ?? 0),
        mimeType: String(event.params.response?.mimeType ?? ''),
      }));
  }

  /** 失败的请求（被拦/被断）也要留痕，否则「发了但没到」会被静默吞掉。 */
  failures() {
    return this.events
      .filter((event) => event.method === 'Network.loadingFailed')
      .map((event) => ({ errorText: String(event.params.errorText ?? ''), canceled: event.params.canceled === true }));
  }

  requests() {
    return this.events.filter((event) => event.method === 'Network.requestWillBeSent').map((event) => event.params.request.url);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 已关 */
    }
  }
}

export { sleep };
