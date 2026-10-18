/**
 * register.mjs —— **宿主侧路由注册器**（能力③的宿主半边；
 * 从 `routes.mjs` 原样搬出，行为一字未改）。
 *
 *   · `registerRoute(ctx, spec)` —— 注册**一条**精确 Fetch 路由（`fetch` 由 `envelope.mjs` 的
 *     `createFetchHandler` 造）；`connection` 可显式传入（真机上它只在经 inject 拿到的 scoped ctx 上可见，
 *     而 effect 必须挂**长期存活的插件 ctx**）；
 *   · `registerRoutes(ctx, options)` —— 内置端点表 + `extraRoutes` 扩展点（diagnostics 端点走它）；
 *   · **有界补注册窗口 + 失败可见性**：失败轮不留半截 effect；`logger.warn` 在本机默认阈值下进不了
 *     buffer（实测）⇒ 失败与补注册结果**直写 stderr**（用户与装置都看得见）；窗口内重试，超时给最后一条明说。
 *
 * ⚠ **依赖缺失时不激活**：没有 `connection` 服务就**不注册**、只记一条日志并返回
 * `{ ok:false, reason }`；绝不 throw（宿主 apply 抛错会连累整页）。
 * ⚠ **不自建鉴权**：不读 cookie、不发 token、不写 401/403、不 import 任何 auth 模块。
 * 依赖方向：host → host（本目录内）；只静态 import `./envelope.mjs`（相对路径），零外部依赖。
 */
import { ROUTE_METHODS, ROUTE_REQUEST_BODY, assertEndpointName, createEndpointTable, createFetchHandler, describeError, log, routePathOf } from './envelope.mjs';
import { defaultWrite } from './sink.mjs';

/** 软探测连接服务（宿主侧同名服务；缺了不抛）。
 *
 * ⚠ 真机结论：**只用 `ctx.get('connection')` 在真机上永远拿不到** —— 官方宿主插件（如
 * `dsh-session-log-export`）都写成 `const inject = ["commands","connection"]` 再 `ctx.connection.fetch.register(...)`：
 * `connection` 是**兄弟插件提供的服务**，不声明 inject（或不用动态 `ctx.inject` 拿 scoped ctx）就看它不见。
 * 所以这里保留两级：① `ctx.get` 软探测（替身/同 scope 场景）；② **受保护**的 `ctx.connection` 属性读取
 * —— 只有在调用方已经通过 inject 拿到 scoped ctx 时才可能成功，其它情况抛错即当「没有」。
 */
export function readConnection(ctx) {
  if (ctx === null || ctx === undefined) return undefined;
  try {
    if (typeof ctx.get === 'function') {
      const connection = ctx.get('connection');
      if (connection !== null && connection !== undefined) return connection;
    }
  } catch {
    // 软探测失败 ⇒ 继续试属性面
  }
  try {
    const direct = ctx.connection;
    if (direct !== null && direct !== undefined) return direct;
  } catch {
    // 未声明服务的属性访问会抛（平台规则）⇒ 当「没有」
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// **宿主侧的有界补注册窗口 + 失败可见性**
//
// 真机事故：客户端直连 `/api/gui-frame/diagnostics` 得到**已鉴权 404**（未鉴权 401），
// 诊断收端因此无对象 —— 根因是 `registerRoute` 在「`connection` 服务还没就绪」时**只发 warn 就不注册**，
// 而宿主半区**没有客户端那样的补装窗口**，且 `ctx.logger.warn` 在本机默认阈值下
// **连 buffer 都进不去**（实测）⇒ 真机上零痕迹、只见 404。
// 处置（与客户端同款形状）：① 注册失败时**落到 stderr**（用户/装置都看得见）；
// ② 在 `HOST_ROUTE_RETRY_*` 窗口内**重试注册**（服务就绪即装上）；③ 超时仍失败 ⇒ 最后一条 stderr 明说。
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 补注册窗口：总时长与间隔（宿主 apply 通常早于 `connection` 服务就绪）。 */
export const HOST_ROUTE_RETRY_TIMEOUT_MS = 5000;
export const HOST_ROUTE_RETRY_INTERVAL_MS = 250;

/**
 * 宿主侧 stderr 直写（cmd 可见性；拿不到 `process` 就静默降级 ⇒ 返回 false）。
 *
 * **实现只有一份**：与诊断收端（`sink.mjs` 的 `defaultWrite`，那一层打印走的就是它）共用同一个函数；
 * 名字按原路径保留，`src/host/index.mjs`、`tests/host/**` 的 import 不变。
 */
export const writeHostStderr = defaultWrite;

/** 取一个「随 fiber 回收」的定时器（cordis ctx 自带；**没有就返回 null**，不落全局 —— 免在测试里留野定时器）。 */
export function scheduleTick(ctx, fn, delayMs) {
  try {
    if (ctx !== null && ctx !== undefined && typeof ctx.setTimeout === 'function') return ctx.setTimeout(fn, delayMs);
  } catch {
    // 落到全局
  }
  return null;
}

function clearTick(ctx, handle) {
  if (handle === null || handle === undefined) return;
  try {
    if (ctx !== null && ctx !== undefined && typeof ctx.clearTimeout === 'function') {
      ctx.clearTimeout(handle);
      return;
    }
  } catch {
    // 落到全局
  }
  try {
    if (typeof clearTimeout === 'function') clearTimeout(handle);
  } catch {
    // 忽略
  }
}

/**
 * 注册**一条**精确 Fetch 路由（diagnostics 端点也走它，**不改注册方式**）。
 * @param {object} ctx 宿主 ctx（必须有 effect）
 * @param {{name:string, handle:Function, path?:string, methods?:string[], requestBody?:string, context?:object}} spec
 * @returns {{ok:boolean, path:string, reason:string|null, dispose:() => void}}
 */
export function registerRoute(ctx, spec) {
  const name = assertEndpointName(spec.name);
  const path = typeof spec.path === 'string' && spec.path !== '' ? spec.path : routePathOf(name);
  // `connection` 可以**由调用方显式传入**。为什么需要这个口子：真机上 `connection` 只在**经 inject 拿到的
  // scoped ctx** 上可见，而 scoped ctx 是 `ctx.inject(...)` 回调的临时作用域 —— 在它上面 `ctx.effect` 注册的
  // 路由会随该作用域一起消失（真机实测：注册「成功」但端点仍 404）。正确做法＝**服务实例从 scoped ctx 取**、
  // **effect 挂在长期存活的插件 ctx 上**。
  const connection = spec.connection !== undefined ? spec.connection : readConnection(ctx);
  if (connection === undefined || connection === null) {
    log(ctx, 'warn', `[gui-frame] connection 服务缺席 ⇒ 不注册路由 ${path}（依赖缺失时不激活，页面照常启动）`);
    return { ok: false, path, reason: 'connection-absent', dispose: noop };
  }
  const registry = connection.fetch;
  if (registry === null || registry === undefined || typeof registry.register !== 'function') {
    log(ctx, 'warn', `[gui-frame] connection.fetch.register 不可用 ⇒ 不注册路由 ${path}（不静默假装注册成功）`);
    return { ok: false, path, reason: 'fetch-registry-absent', dispose: noop };
  }
  const route = {
    path,
    methods: Array.isArray(spec.methods) && spec.methods.length > 0 ? [...spec.methods] : [...ROUTE_METHODS],
    requestBody: typeof spec.requestBody === 'string' ? spec.requestBody : ROUTE_REQUEST_BODY,
    fetch: createFetchHandler({ name, handle: spec.handle, context: spec.context ?? { ctx } }),
  };
  const dispose = ctx.effect(() => registry.register(route), `gui-frame: fetch route ${path}`);
  return { ok: true, path, reason: null, route, dispose: typeof dispose === 'function' ? dispose : noop };
}

/**
 * **宿主侧注册函数**（由 `src/host/index.mjs` 调用）。
 * @param {object} ctx 宿主 ctx
 * @param {{demoDelayMs?:number, sleep?:Function, now?:Function, extraEndpoints?:Map<string,Function>,
 *   extraRoutes?:Array<{name:string, handle:Function, path?:string, context?:object}>, endpoints?:Map<string,Function>}} [options]
 * @returns {{ok:boolean, reason:string|null, routes:string[], dispose:() => void}}
 */
export function registerRoutes(ctx, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('registerRoutes(ctx) 需要一个 Cordis ctx（副作用要挂在调用方 fiber 上）');
  }
  const table = options.endpoints instanceof Map ? new Map(options.endpoints) : createEndpointTable(options);
  for (const [name, handle] of options.extraEndpoints ?? []) table.set(assertEndpointName(name), handle);
  const context = { ctx, host: 'gui-frame' };
  const extra = Array.isArray(options.extraRoutes) ? options.extraRoutes : [];
  /** 跑一轮注册（可重复调用；失败轮**不会**留下 effect —— `registerRoute` 在两条失败路径上直接返回）。 */
  const attempt = () => {
    const routes = [];
    const disposers = [];
    let reason = null;
    for (const [name, handle] of table) {
      const registered = registerRoute(ctx, { name, handle, context, connection: options.connection });
      routes.push(registered.path);
      if (typeof registered.dispose === 'function') disposers.push(registered.dispose);
      if (!registered.ok) reason = registered.reason;
    }
    for (const spec of extra) {
      const registered = registerRoute(ctx, { ...spec, context: { ...context, ...(spec.context ?? {}) }, connection: options.connection });
      routes.push(registered.path);
      if (typeof registered.dispose === 'function') disposers.push(registered.dispose);
      if (!registered.ok) reason = registered.reason;
    }
    if (reason !== null) {
      for (const dispose of disposers) {
        try { dispose(); } catch { /* 失败轮不留半截 */ }
      }
      disposers.length = 0;
    }
    return { routes, disposers, reason };
  };
  const disposeCurrent = (row) => {
    for (const dispose of row.disposers) {
      try {
        dispose();
      } catch (error) {
        log(ctx, 'warn', `[gui-frame] 撤销路由时抛错（已吞）：${describeError(error)}`);
      }
    }
  };

  let current = attempt();
  let timer = null;
  let settled = false;

  if (current.reason === null) {
    log(ctx, 'info', `[gui-frame] 已注册 ${current.routes.length} 条精确 Fetch 路由：${current.routes.join('、')}`);
    settled = true;
  } else {
    // 失败**必须可见**：logger.warn 在本机默认阈值下进不了 buffer（实测）⇒ 直写 stderr。
    const first = `[gui-frame] 宿主路由未注册（${current.reason}）：${current.routes.join('、')} —— ${HOST_ROUTE_RETRY_TIMEOUT_MS}ms 内重试（connection 服务通常晚于本插件 apply 就绪）`;
    log(ctx, 'warn', first);
    writeHostStderr(first);
    if (options.retry !== false && typeof options.retry !== 'function') {
      const startedAt = Date.now();
      const retryTimeoutMs = Number.isFinite(options.retryTimeoutMs) ? options.retryTimeoutMs : HOST_ROUTE_RETRY_TIMEOUT_MS;
      const retryIntervalMs = Number.isFinite(options.retryIntervalMs) ? options.retryIntervalMs : HOST_ROUTE_RETRY_INTERVAL_MS;
      const tick = () => {
        timer = null;
        const next = attempt();
        if (next.reason === null) {
          disposeCurrent(current);
          current = next;
          settled = true;
          const line = `[gui-frame] 宿主路由补注册成功：${next.routes.join('、')}（首轮 reason=${firstReason}）`;
          log(ctx, 'info', line);
          writeHostStderr(line);
          return;
        }
        if (Date.now() - startedAt < retryTimeoutMs) {
          timer = scheduleTick(ctx, tick, retryIntervalMs);
          return;
        }
        const line = `[gui-frame] 宿主路由仍未注册（${next.reason}）：${next.routes.join('、')} —— 依赖缺失时不激活，页面照常启动`;
        log(ctx, 'error', line);
        writeHostStderr(line);
      };
      const firstReason = current.reason;
      timer = scheduleTick(ctx, tick, retryIntervalMs);
    }
  }

  return {
    // 用 getter：补注册窗口成功之后，外面看到的 ok/reason/routes 要跟着变（快照会撒谎）。
    get ok() {
      return current.reason === null;
    },
    get reason() {
      return current.reason;
    },
    get routes() {
      return [...current.routes];
    },
    /** 立刻再试一次（测试与「首次请求前惰性注册」都可调用）。 */
    retryNow() {
      if (settled) return { ok: true, reason: null, routes: [...current.routes] };
      const next = attempt();
      if (next.reason === null) {
        disposeCurrent(current);
        current = next;
        settled = true;
        if (timer !== null) clearTick(ctx, timer);
        timer = null;
      }
      return { ok: current.reason === null, reason: current.reason, routes: [...current.routes] };
    },
    dispose() {
      if (timer !== null) clearTick(ctx, timer);
      timer = null;
      disposeCurrent(current);
    },
  };
}

function noop() {}
