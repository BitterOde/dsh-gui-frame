/**
 * envelope.mjs —— **官方信封的形状件 + 内置端点表**（从 `routes.mjs` 原样搬出，行为一字未改）。
 *
 * 【线上协议】宿主**只讲官方协议**：
 *   请求体 `{ type:'client-request', rpcId, method:'gui-frame/<端点>', payload }`
 *   响应体 `{ type:'server-response', rpcId, result }`，`result` 是 `{ ok:true, value }` /
 *   `{ ok:false, error:{ code, message, details } }`。
 *   家族 TX28 的 5 个业务字段（`data/warnings/changed/rev/undoToken`）装在 `value` 里 ——
 *   客户端 `src/client/channel/envelope.mjs` 的 `adaptOfficialEnvelope` 负责摊平（映射表就是契约）。
 *
 * 【用谁的注册面】官方 `ctx.connection.fetch.register({path, methods, requestBody, fetch})`；
 * 分发是 `createSharedFetchHandler('…')` 里的**精确路径匹配** ⇒ `path` 必须逐字等于 `url.pathname`。
 * 注册与补注册窗口在 `register.mjs`；本件只造信封、端点表与 `fetch(Request) → Response` 的处理器。
 *
 * ⚠ **不自建鉴权**：`/api` 前缀路由由平台自己注册并在 `bridge(...)` 之前过围栏，
 * 所以本件**不读 cookie、不发 token、不写 401/403、不 import 任何 auth 模块**
 * （`tests/host/routes-register.test.mjs` 有源码扫描反向证明）。
 *
 * 零静态依赖：只用 node 内置全局（`Response` 是 Node 18+ 的全局，本机 Node 24 实测可用）。
 */
/** 端点命名空间前缀（客户端那一份冻结在 `client/kit/diagnostics.mjs` 的 `DIAGNOSTICS_PATH` 里，两边各自留一份便于交叉核对）。 */
export const ROUTE_PREFIX = '/api/gui-frame';
/** 只收 POST（官方客户端 `createWebConnectionRpc.call` 就是 POST + JSON body）。 */
export const ROUTE_METHODS = Object.freeze(['POST']);
/** 请求体模式：`buffered`（我们要整包 JSON；`streaming` 是给 SSE 之类留的，本包不用）。 */
export const ROUTE_REQUEST_BODY = 'buffered';
/** 内置端点名（demo 面板就是调 `/api/gui-frame/demo`）。 */
export const ENDPOINT_NAMES = Object.freeze(['demo', 'ping']);
/** 端点名形态（与平台的 `ENDPOINT_SEGMENT_PATTERN` 同形）。 */
export const ENDPOINT_NAME_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/** 官方信封的两种 type（实读；响应里 `type` 恒为 server-response）。 */
export const OFFICIAL_TYPE_REQUEST = 'client-request';
export const OFFICIAL_TYPE_RESPONSE = 'server-response';
/** 非法请求时的占位 rpcId（对齐平台自己的 `INVALID_REQUEST_RPC_ID` 做法）。 */
export const INVALID_REQUEST_RPC_ID = 'invalid-request';
/** 本包在**官方错误域**里用的 code（`gateway/*` 是平台域，`gui-frame/*` 是我们的业务域）。 */
export const HOST_ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'gateway/bad-request',
  INTERNAL: 'gui-frame/internal',
  DEMO_FAILURE: 'gui-frame/demo-failure',
});
/** `demo` 的 slow 模式缺省延迟（演示超时用）。 */
export const DEFAULT_DEMO_DELAY_MS = 1200;

/** 端点名单个段落的校验（空段 / `.` / `..` 一律拒）。 */
export function assertEndpointName(name) {
  if (typeof name !== 'string' || name === '') throw new TypeError('端点名必须是非空字符串');
  const segments = name.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || !ENDPOINT_NAME_PATTERN.test(segment)) {
      throw new TypeError(`端点名 ${JSON.stringify(name)} 含非法段落（只允许 [A-Za-z0-9_$.-]）`);
    }
  }
  return name;
}

/** 端点名 → 精确路由 path（`demo` ⇒ `/api/gui-frame/demo`）。 */
export function routePathOf(name) {
  return `${ROUTE_PREFIX}/${assertEndpointName(name)}`;
}

/** 普通对象判据。 */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 造 JSON `Response`。 */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/** 官方形态的成功结果。 */
export function okResult(data, meta = {}) {
  return {
    ok: true,
    value: {
      data: data === undefined ? null : data,
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
      changed: meta.changed === true,
      rev: Number.isInteger(meta.rev) ? meta.rev : null,
      undoToken: typeof meta.undoToken === 'string' && meta.undoToken !== '' ? meta.undoToken : null,
    },
  };
}

/** 官方形态的失败结果。 */
export function errorResult(code, message, details) {
  return { ok: false, error: { code, message: String(message ?? ''), details: details === undefined ? null : details } };
}

/** 读并校验官方客户端请求信封。 */
export async function readClientRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return { ok: false, rpcId: INVALID_REQUEST_RPC_ID, message: '请求体不是合法 JSON', details: { reason: String(error?.message ?? error) } };
  }
  if (!isPlainObject(body)) {
    return { ok: false, rpcId: INVALID_REQUEST_RPC_ID, message: '请求体必须是 JSON 对象', details: { type: typeof body } };
  }
  const rpcId = typeof body.rpcId === 'string' && body.rpcId !== '' ? body.rpcId : INVALID_REQUEST_RPC_ID;
  if (body.type !== OFFICIAL_TYPE_REQUEST) {
    return { ok: false, rpcId, message: `信封 type 必须是 ${OFFICIAL_TYPE_REQUEST}`, details: { type: body.type ?? null } };
  }
  if (typeof body.method !== 'string' || body.method === '') {
    return { ok: false, rpcId, message: '信封 method 必须是非空字符串', details: { method: body.method ?? null } };
  }
  return { ok: true, rpcId, method: body.method, payload: body.payload === undefined ? null : body.payload };
}

/**
 * 造一个端点请求处理器（`fetch(Request) → Promise<Response>`）。
 * 三层校验：① 信封形态 → ② 路径与信封 `method` 一致（防止"打到 A 端点的包说自己是 B"）
 * → ③ 端点自身抛错一律收敛成 `gui-frame/internal`（**不给调用方看栈**，栈进 logger）。
 */
export function createFetchHandler(spec) {
  const name = assertEndpointName(spec.name);
  const expectedMethod = `${ROUTE_PREFIX.slice('/api/'.length)}/${name}`; // 'gui-frame/<name>'
  const handle = spec.handle;
  if (typeof handle !== 'function') throw new TypeError(`端点 ${name} 需要 handle(payload, context) 函数`);
  const context = spec.context ?? {};
  return async function fetch(request) {
    const parsed = await readClientRequest(request);
    if (!parsed.ok) {
      return jsonResponse({ type: OFFICIAL_TYPE_RESPONSE, rpcId: parsed.rpcId, result: errorResult(HOST_ERROR_CODES.BAD_REQUEST, parsed.message, parsed.details) });
    }
    if (parsed.method !== expectedMethod) {
      return jsonResponse({
        type: OFFICIAL_TYPE_RESPONSE,
        rpcId: parsed.rpcId,
        result: errorResult(HOST_ERROR_CODES.BAD_REQUEST, `路径与信封 method 不一致：路由 /api/${expectedMethod} vs 信封 ${parsed.method}`, { expected: expectedMethod, received: parsed.method }),
      });
    }
    let result;
    try {
      result = await handle(parsed.payload, context);
    } catch (error) {
      log(context.ctx, 'error', `[gui-frame] 端点 ${name} 抛错：${describeError(error)}`);
      result = errorResult(HOST_ERROR_CODES.INTERNAL, `端点 ${name} 内部错误`, { reason: describeError(error) });
    }
    if (!isResult(result)) {
      result = errorResult(HOST_ERROR_CODES.INTERNAL, `端点 ${name} 返回了非法结果（既不是 {ok:true,value} 也不是 {ok:false,error}）`, { received: typeof result });
    }
    return jsonResponse({ type: OFFICIAL_TYPE_RESPONSE, rpcId: parsed.rpcId, result });
  };
}

function isResult(value) {
  if (!isPlainObject(value)) return false;
  if (value.ok === true) return 'value' in value;
  if (value.ok === false) return isPlainObject(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string';
  return false;
}

/** 缺省 sleep（可注入：单测里换成即时返回，避免真等）。 */
function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 内置端点表（`ping` + `demo`）。
 * `demo` 的四种模式给 demo 面板用：`ok`（成功）/ `empty`（空态）/ `error`（失败）/
 * `slow`（超时路径，客户端用 `timeoutMs` 打断）；`mutate:true` 让 `rev` 前进并给 `undoToken`。
 */
export function createEndpointTable(options = {}) {
  const sleep = typeof options.sleep === 'function' ? options.sleep : defaultSleep;
  const demoDelayMs = Number.isInteger(options.demoDelayMs) && options.demoDelayMs >= 0 ? options.demoDelayMs : DEFAULT_DEMO_DELAY_MS;
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();
  const state = { rev: 1, undoSeq: 0 };
  const table = new Map();
  table.set('ping', (payload) => okResult(
    { pong: true, echo: isPlainObject(payload) ? payload.params ?? null : null, at: clock() },
    { rev: state.rev },
  ));
  table.set('demo', async (payload) => {
    const params = isPlainObject(payload) && isPlainObject(payload.params) ? payload.params : {};
    const mode = typeof params.mode === 'string' ? params.mode : 'ok';
    if (mode === 'error') {
      return errorResult(HOST_ERROR_CODES.DEMO_FAILURE, '演示用失败（demo/error 分支：这条走 ok:false + error.kind=app）', { mode, endpoint: 'demo' });
    }
    if (mode === 'slow') await sleep(demoDelayMs);
    const warnings = params.warn === true ? ['演示用告警：信封 warnings 字段的样例（demo 面板第三段用它演示"有告警但成功"）'] : [];
    if (mode === 'empty') return okResult({ items: [], total: 0, mode }, { warnings, changed: false, rev: state.rev });
    if (params.mutate === true) {
      state.rev += 1;
      state.undoSeq += 1;
      return okResult(demoItems(mode), { warnings, changed: true, rev: state.rev, undoToken: `demo-undo-${state.undoSeq}` });
    }
    return okResult(demoItems(mode), { warnings, changed: false, rev: state.rev });
  });
  return table;
}

/** demo 数据（四条，够面板演示 List/KeyValue）。 */
function demoItems(mode) {
  return {
    mode,
    total: 4,
    items: [
      { id: 'entry-dock', title: '入口坞总览', kind: 'panel' },
      { id: 'layout-preview', title: '布局编辑预览', kind: 'panel' },
      { id: 'channel-demo', title: '数据通道示例', kind: 'panel' },
      { id: 'overlay-demo', title: '悬浮窗演示', kind: 'panel' },
    ],
  };
}

/**
 * 宿主侧诊断一式（**只进 logger**；cmd 可见性那一层由 `register.mjs` 的 `writeHostStderr` 承担）：
 * `ctx.logger[level](line)`，拿不到 logger 就静默 —— 绝不因为打印而抛。
 * `createFetchHandler` 的「端点抛错」分支与 `register.mjs` 的注册诊断共用它（**单一实现**，不各自抄一份）。
 */
export function log(ctx, level, line) {
  const logger = ctx === null || ctx === undefined ? null : ctx.logger;
  if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](line);
}

/** 错误 → 一行可读文本（**只留 message，截 200 字**；栈不进响应体，也不搬进日志正文）。 */
export function describeError(error) {
  if (error === null || error === undefined) return String(error);
  if (typeof error === 'object' && typeof error.message === 'string') return String(error.message).slice(0, 200);
  return String(error).slice(0, 200);
}
