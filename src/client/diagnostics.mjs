/**
 * diagnostics.mjs —— **客户端诊断上报链路**（客户端半边；宿主收端在 `src/host/index.mjs`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么是"同源 fetch 直发"而不是走服务面】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 诊断通道要能报告**服务面自己坏掉**的情况（apply 抛错、座位注册失败、渲染崩溃）。
 * 若上报本身依赖 `ctx.gui-frame` 或 `ctx.connection`，那"服务面死了"这类最该被看见的事故
 * 恰好会在最需要它的时候失去通道。所以本文件只依赖全局 `fetch`：
 *   - **同源相对路径** `POST /api/gui-frame/diagnostics`（不带 origin，浏览器自动补同源）；
 *   - 请求体仍用**平台自己的信封形状**（`{type:'client-request', rpcId, method, payload}`），
 *     于是宿主侧 `ctx.connection.fetch.register` 的 handler 一字不改就能收（不改注册方式）；
 *   - `credentials:'same-origin'`（默认值，显式写出来）：`/api` 的 trust/auth 由**载体**施加，
 *     本文件不读 cookie、不造 token、不碰 401 —— 出现这些字样就是走错了路。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【四道限流闸】—— 诊断通道自己必须是"不会把宿主打垮"的那条通道
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ① **限长**：`message` ≤ 400 字符、`stack` ≤ 800 字符（都是**截断**而非丢弃，并记 `truncated` 计数）；
 *  ② **限频**：滚动窗口 `windowMs` 内最多 `maxPerWindow` 条（超出 ⇒ 丢弃 + `limited` 计数）；
 *  ③ **同指纹去重**：`plugin|phase|message` 的指纹在窗口内只发一次（`deduped` 计数）；
 *  ④ **队列封顶**：待发队列 ≤ `maxQueue`（超出即丢最旧的）。
 * 宿主侧还有第二层（app 级：指纹去重 + 总条数封顶 + 打印封顶），两层都做是因为客户端可能被整页刷爆。
 *
 * 本文件不碰 DOM：`fetch` / `now` / `window` 全部可注入（缺省才回落到全局），
 * 于是限频与钩子行为都能在 L0 层确定性单测。
 */

import { CLIENT_REQUEST_TYPE as _CLIENT_REQUEST_TYPE, CLIENT_VERSION as _CLIENT_VERSION, DIAGNOSTIC_LIMITS as _DIAGNOSTIC_LIMITS, DIAGNOSTIC_PHASES as _DIAGNOSTIC_PHASES, DIAGNOSTICS_METHOD as _DIAGNOSTICS_METHOD, DIAGNOSTICS_PATH as _DIAGNOSTICS_PATH, PLUGIN_NAME as _PLUGIN_NAME, degradeEvent as _degradeEvent, describeError as _describeError, fingerprintOf as _fingerprintOf, hashFingerprint as _hashFingerprint, renderErrorReport as _renderErrorReport, summarizeStack as _summarizeStack, truncate as _truncate } from './kit/diagnostics.mjs';

/* ── 纯件已下沉 `kit/diagnostics.mjs`（能力 → 共享叶）；下面这组 re-bind 保持
   本文件对外导出集合一字不变（tests 与宿主半区仍按老路径取名字）。 ───────────────────────────── */
export const DIAGNOSTICS_PATH = _DIAGNOSTICS_PATH;
export const DIAGNOSTICS_METHOD = _DIAGNOSTICS_METHOD;
export const CLIENT_REQUEST_TYPE = _CLIENT_REQUEST_TYPE;
export const PLUGIN_NAME = _PLUGIN_NAME;
export const CLIENT_VERSION = _CLIENT_VERSION;
export const DIAGNOSTIC_PHASES = _DIAGNOSTIC_PHASES;
export const DIAGNOSTIC_LIMITS = _DIAGNOSTIC_LIMITS;
export const describeError = _describeError;
export const truncate = _truncate;
export const summarizeStack = _summarizeStack;
export const fingerprintOf = _fingerprintOf;
export const hashFingerprint = _hashFingerprint;
export const degradeEvent = _degradeEvent;
export const renderErrorReport = _renderErrorReport;

/** 造**官方形状**的请求体（宿主 handler 直接认它）。 */
export function createDiagnosticsEnvelope(payload, rpcId) {
  return {
    type: CLIENT_REQUEST_TYPE,
    rpcId: typeof rpcId === 'string' && rpcId !== '' ? rpcId : 'diag-0',
    method: DIAGNOSTICS_METHOD,
    payload,
  };
}

/**
 * 上报器。
 * @param {{fetchImpl?:Function, now?:Function, path?:string, plugin?:string, clientVersion?:string,
 *   limits?:object, consoleImpl?:object}} [options]
 * @returns {{report:Function, stats:Function, flush:Function, lastPayload:Function, entries:Function}}
 */
export function createDiagnosticsReporter(options = {}) {
  const limits = { ...DIAGNOSTIC_LIMITS, ...(options.limits ?? {}) };
  const plugin = typeof options.plugin === 'string' && options.plugin !== '' ? options.plugin : PLUGIN_NAME;
  const clientVersion = typeof options.clientVersion === 'string' && options.clientVersion !== '' ? options.clientVersion : CLIENT_VERSION;
  const path = typeof options.path === 'string' && options.path !== '' ? options.path : DIAGNOSTICS_PATH;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  // `fetchImpl` 允许显式传 `null` 表示「这个环境没有 fetch」（`?? 全局` 会把 null 也当没传，
  // 于是"显式关掉"就没了出口 —— 用 in 判断，把"没传"和"传了 null"分开）。
  const fetchImpl = 'fetchImpl' in options ? options.fetchImpl : (typeof fetch === 'undefined' ? undefined : fetch);

  const seen = new Map(); // fingerprint → 首次时间（窗口内去重）
  /** 上报失败原因去重（每个 reason 只在 console 上说一次）。 */
  const reportedFailures = new Map();
  const queue = [];
  const sent = [];
  const stats = { reported: 0, sent: 0, deduped: 0, limited: 0, truncated: 0, dropped: 0, failed: 0 };
  let seq = 0;

  /** 把一条事件收敛成**载荷**（限长 + 指纹 + 时间戳）。 */
  function buildPayload(entry) {
    const message = truncate(entry.message, limits.message);
    const stack = summarizeStack(entry.error, { limit: limits.stack });
    if (message.truncated || stack.truncated) stats.truncated += 1;
    const payload = {
      plugin,
      phase: DIAGNOSTIC_PHASES.includes(entry.phase) ? entry.phase : 'apply',
      message: message.text,
      stack: stack.stack,
      clientVersion,
      at: new Date(now()).toISOString(),
    };
    if (entry.details !== undefined && entry.details !== null) payload.details = entry.details;
    payload.fingerprint = hashFingerprint(fingerprintOf({ plugin, phase: payload.phase, message: payload.message }));
    return payload;
  }

  /** 同步记一条诊断（**永不抛**）；返回 `{accepted, reason}`，调用方可据此断言"被限流"。 */
  function report(entry) {
    try {
      stats.reported += 1;
      const source = entry === null || entry === undefined ? {} : entry;
      const payload = buildPayload(source);
      const key = fingerprintOf({ plugin, phase: payload.phase, message: payload.message });
      const stamp = now();
      const last = seen.get(key);
      if (last !== undefined && stamp - last < limits.windowMs) {
        stats.deduped += 1;
        return { accepted: false, reason: 'dedup', payload };
      }
      seen.set(key, stamp);
      // 清理过期指纹（防长期运行把 Map 撑大）
      for (const [seenKey, seenAt] of seen) if (stamp - seenAt >= limits.windowMs) seen.delete(seenKey);
      const recent = sent.filter((row) => stamp - row.at < limits.windowMs);
      if (recent.length >= limits.maxPerWindow) {
        stats.limited += 1;
        return { accepted: false, reason: 'rate-limit', payload };
      }
      if (queue.length >= limits.maxQueue) {
        queue.shift();
        stats.dropped += 1;
      }
      queue.push({ payload, rpcId: `${plugin}-diag-${seq += 1}`, at: stamp });
      sent.push({ at: stamp });
      if (sent.length > limits.maxPerWindow * 4) sent.splice(0, sent.length - limits.maxPerWindow);
      return { accepted: true, reason: null, payload };
    } catch (error) {
      stats.failed += 1;
      return { accepted: false, reason: 'reporter-threw', error };
    }
  }

  /**
   * **上报失败必须可见**：`report()` 返回的 `accepted` 只代表「排上了本地队列」，
   * 真正的发送在 `flush()`。端点 404 / 网络失败以前被完全丢弃 ⇒ 界面说「sent」而宿主什么都没收到。
   * 处置：失败计数（已有）＋ **console 一行**（去重，每个 reason 只打一次，避免把 console 刷爆）。
   */
  function noteFailure(reason, extra) {
    stats.failed += 1;
    const key = String(reason);
    if (reportedFailures.has(key)) return;
    reportedFailures.set(key, 1);
    try {
      if (typeof console !== 'undefined' && console !== null && typeof console.warn === 'function') {
        console.warn(`[gui-frame] 诊断上报失败：${key}${extra === undefined ? '' : `（${extra}）`} —— 上报地址 ${path}`);
      }
    } catch {
      // console 不可用就算了（计数仍在 stats.failed 上）
    }
  }

  /** 发一条（内部）：把队列里的载荷逐个 POST 出去；失败**只计数不抛**（但一定可见）。 */
  async function sendOne(item) {
    if (fetchImpl === undefined || typeof fetchImpl !== 'function') {
      noteFailure('no-fetch', '当前环境没有 fetch');
      return { ok: false, reason: 'no-fetch' };
    }
    try {
      const envelope = createDiagnosticsEnvelope(item.payload, item.rpcId);
      const response = await fetchImpl(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(envelope),
      });
      if (response !== null && response !== undefined && typeof response.ok === 'boolean' && response.ok === false) {
        noteFailure(`http-${response.status}`, '端点未注册或被拒');
        return { ok: false, reason: `http-${response.status}` };
      }
      stats.sent += 1;
      return { ok: true, reason: null };
    } catch (error) {
      noteFailure(describeError(error), '请求抛错');
      return { ok: false, reason: describeError(error) };
    }
  }

  /** 把队列刷出去（**不抛**；返回每条的结果）。 */
  async function flush() {
    const pending = queue.splice(0, queue.length);
    const results = [];
    for (const item of pending) results.push(await sendOne(item));
    return results;
  }

  return {
    report,
    flush,
    stats: () => ({ ...stats, queued: queue.length, fingerprints: seen.size }),
    lastPayload: () => (queue.length === 0 ? null : queue[queue.length - 1].payload),
    entries: () => queue.map((item) => ({ ...item.payload })),
    /**
     * 一条式便捷入口：`report + flush`（各装配点的常用形状）。
     * ⚠ **把 flush 的结果一并交出去**（`{...outcome, flush}`）—— 以前返回值只有队列 accepted，
     * 端点 404 这类硬失败在调用方那里彻底消失（「界面说 sent ≠ 宿主收到」）。
     */
    async reportNow(entry) {
      const outcome = report(entry);
      if (outcome.accepted === true) {
        const results = await flush();
        return { ...outcome, flush: results, delivered: results.every((row) => row.ok === true) };
      }
      return { ...outcome, flush: [], delivered: false };
    },
  };
}

/**
 * 装**客户端诊断钩子**（来源两条 + 一条显式入口，全部经 `ctx.effect` 挂在调用方 fiber 上）：
 *  ① **渲染崩溃**：`window` 的 `error` / `unhandledrejection`（逃出 React 边界的那种）；
 *  ② **边界内崩溃**：由组件把错误交给 `report`（`phase:'render'`；面板壳的错误边界就是这么报的）。
 *
 * ═══ 为什么**不再**包一层平台的共享 `ctx.slots.register/inject`（用户裁定：不许改写共享服务）═══
 * 旧版把包装后的函数**写回共享 slots 服务**（`slots[method] = wrapped`）。它确实能多看见一类来源
 * （别的插件在**注册期同步抛**的错），但代价是踩在平台的书面契约上，而且已经出过一次生产事故：
 *   · 平台契约（`dsh-client-ui-renderer/lib/types/client/registry.d.ts` 原文）：`register` **必须**
 *     留在原型上 —— cordis 服务代理在**调用点**把 `this.ctx` 绑到调用方 ctx，effect 才落进调用方的
 *     fiber。往共享对象上写自有属性会打断这条归属链 ⇒ 别人经它注册的座位，effect 归到本包 fiber 上，
 *     本包卸载 / HMR 时可能**连带拆除别人的贡献**；平台自己的示范是 **Proxy 包一层自己的引用**，
 *     而不是改写共享对象。
 *   · 事故：同一处钩子曾把 `register/inject` 的返回值（有身份的 effect 句柄）换成
 *     `.then()` 派生的新 Promise ⇒ cordis 抛 `Invalid effect` ⇒ 同批 combo 的下一位插件 apply 失败
 *     ⇒ 外壳 `assertEntriesActive` 全或无闸把**整页**打成 `Failed to load plugins`。
 * ⇒ **裁定：撤掉这一类诊断源**。本包自己的诊断（渲染崩溃 / 未处理拒绝 / 组件显式 `report`）不受影响，
 *   客户端 → 宿主链路也不依赖它（那条链路只走 `report()` → POST → 宿主 sink → stderr）。
 *   代价如实记账：**不再拦截其它插件注册期的同步抛错**。若日后确实需要这一覆盖，正确的方向是
 *   「包自己的引用（Proxy）+ 把调用方 ctx 透传」，而不是改写共享服务 —— 另立条目再议。
 *
 * `options.slots` 仍然收下（调用方按老签名传），但**只读不用**：绝不写任何自有属性。
 *
 * 缺 `window`（无 DOM 环境）⇒ 静默跳过全局监听，**不报错**。
 * @param {object} ctx Cordis ctx
 * @param {object} reporter `createDiagnosticsReporter(...)`
 * @param {{window?:object, slots?:object}} [options]
 * @returns {() => void} 幂等 disposer
 */
export function installDiagnosticsHooks(ctx, reporter, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('installDiagnosticsHooks(ctx, reporter) 需要在 Cordis ctx 上调用（清理要挂到调用方 fiber）');
  }
  if (reporter === null || typeof reporter !== 'object' || typeof reporter.report !== 'function') {
    throw new TypeError('installDiagnosticsHooks(ctx, reporter) 需要 reporter.report');
  }
  const win = 'window' in options ? options.window : (typeof window === 'undefined' ? undefined : window);
  const disposers = [];

  // ② 渲染崩溃 / 未处理的 Promise（逃出边界的那些）
  if (win !== null && win !== undefined && typeof win.addEventListener === 'function') {
    const onError = (event) => {
      reporter.report({
        phase: 'render',
        message: `页面错误：${describeError(event?.error ?? event?.message ?? event)}`,
        error: event?.error,
        details: { source: 'window.error' },
      });
    };
    const onRejection = (event) => {
      reporter.report({
        phase: 'unhandled',
        message: `未处理的 Promise 拒绝：${describeError(event?.reason ?? event)}`,
        error: event?.reason,
        details: { source: 'window.unhandledrejection' },
      });
    };
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    disposers.push(() => {
      if (typeof win.removeEventListener === 'function') {
        win.removeEventListener('error', onError);
        win.removeEventListener('unhandledrejection', onRejection);
      }
    });
  }

  return ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // 收尾失败不影响卸载
      }
    }
  }, 'gui-frame: diagnostics hooks');
}
