/**
 * routes.mjs —— **宿主半区路由注册器**（能力③的宿主半边）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【解耦：本文件＝原路径的**再绑定壳**（行为一字未改）】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 定义已搬到同目录两件：
 *   · `./envelope.mjs` —— 官方信封形状件（请求/响应/结果）+ 内置端点表 + `fetch(Request) → Response`；
 *   · `./register.mjs` —— `registerRoute` / `registerRoutes` + **有界补注册窗口与失败可见性**。
 * 本文件按**原路径**再绑定同一组导出名 ⇒ `src/host/index.mjs`、`tests/host/**`、`verify/**` 的 import 不变。
 * 依赖方向只有「壳 → 两件」一条（无反向边）⇒ 目录内无环。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【用谁的注册面】官方 `ctx.connection.fetch.register({path, methods, requestBody, fetch})`
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 本机 DSH 0.2.0-rc.2 实读 `dsh-client-connection/lib/index.js`：
 *   - `get fetch()` → `{ register: (route) => this.registerFetchRoute(owner, route) }`，
 *     `owner` 是**读这个服务时**的 ctx ⇒ 注册本来就是**按调用方 fiber** 记账的；
 *   - `registerFetchRoute` 内部 `owner.effect(() => { fetchRoutes.set(path, …); return () => fetchRoutes.delete(path) })`
 *     ⇒ 卸载自动摘除；**同一 path 重复注册会 throw**（所以我们每个端点只注册一次，且天然幂等）；
 *   - 分发是 `createSharedFetchHandler('…')` 里的 `fetchRoutes.get(url.pathname)` —— **精确路径匹配**，
 *     因此 `path` 必须逐字等于 `url.pathname`（`/api/gui-frame/<端点>`，段落形态 `^[A-Za-z0-9_$.-]+$`）。
 *
 * ⚠ **不自建鉴权**（trust/auth 由物理载体统一施加，handler 不必自己鉴权）：
 * `/api` 前缀路由由平台自己注册，它在 `bridge(...)` **之前**跑 `connection.requestRejection(req)`
 * （Host/Origin 围栏 + 浏览器认证），只有过了围栏的请求才会走到我们的 handler。
 * 所以本半区**不读 cookie、不发 token、不写 401/403、不 import 任何 auth 模块** ——
 * 出现这些字样就是走错了路（`tests/host/routes-register.test.mjs` 有源码扫描反向证明）。
 *
 * ⚠ **依赖缺失时不激活**：没有 `connection` 服务就**不注册**、只记一条日志并返回
 * `{ ok:false, reason }`；绝不 throw（宿主 apply 抛错会连累整页）。
 *
 * 【线上协议】宿主**只讲官方协议**：
 *   请求体 `{ type:'client-request', rpcId, method:'gui-frame/<端点>', payload }`
 *   响应体 `{ type:'server-response', rpcId, result }`，`result` 是 `{ ok:true, value }` /
 *   `{ ok:false, error:{ code, message, details } }`。
 *   官方的 5 个业务字段（`data/warnings/changed/rev/undoToken`）装在 `value` 里 ——
 *   客户端 `src/client/channel/envelope.mjs` 的 `adaptOfficialEnvelope` 负责摊平（映射表就是契约）。
 *
 * 零**外部**静态依赖（`dependencies` 恒为空、宿主半区只动态 import 平台包）：本文件只 import 本目录两件，
 * 其余只用 node 内置全局（`Response` 是 Node 18+ 的全局，本机 Node 24 实测可用）。
 */
import {
  DEFAULT_DEMO_DELAY_MS as _DEFAULT_DEMO_DELAY_MS,
  ENDPOINT_NAMES as _ENDPOINT_NAMES,
  ENDPOINT_NAME_PATTERN as _ENDPOINT_NAME_PATTERN,
  HOST_ERROR_CODES as _HOST_ERROR_CODES,
  INVALID_REQUEST_RPC_ID as _INVALID_REQUEST_RPC_ID,
  OFFICIAL_TYPE_REQUEST as _OFFICIAL_TYPE_REQUEST,
  OFFICIAL_TYPE_RESPONSE as _OFFICIAL_TYPE_RESPONSE,
  ROUTE_METHODS as _ROUTE_METHODS,
  ROUTE_PREFIX as _ROUTE_PREFIX,
  ROUTE_REQUEST_BODY as _ROUTE_REQUEST_BODY,
  assertEndpointName as _assertEndpointName,
  createEndpointTable as _createEndpointTable,
  createFetchHandler as _createFetchHandler,
  errorResult as _errorResult,
  isPlainObject as _isPlainObject,
  jsonResponse as _jsonResponse,
  okResult as _okResult,
  readClientRequest as _readClientRequest,
  routePathOf as _routePathOf,
} from './envelope.js';
import {
  HOST_ROUTE_RETRY_INTERVAL_MS as _HOST_ROUTE_RETRY_INTERVAL_MS,
  HOST_ROUTE_RETRY_TIMEOUT_MS as _HOST_ROUTE_RETRY_TIMEOUT_MS,
  readConnection as _readConnection,
  registerRoute as _registerRoute,
  registerRoutes as _registerRoutes,
  scheduleTick as _scheduleTick,
  writeHostStderr as _writeHostStderr,
} from './register.js';

// ── 再绑定：导出名与语义一字未改（原路径仍是唯一 import 口）─────────────────────────────
export const ROUTE_PREFIX = _ROUTE_PREFIX;
export const ROUTE_METHODS = _ROUTE_METHODS;
export const ROUTE_REQUEST_BODY = _ROUTE_REQUEST_BODY;
export const ENDPOINT_NAMES = _ENDPOINT_NAMES;
export const ENDPOINT_NAME_PATTERN = _ENDPOINT_NAME_PATTERN;
export const OFFICIAL_TYPE_REQUEST = _OFFICIAL_TYPE_REQUEST;
export const OFFICIAL_TYPE_RESPONSE = _OFFICIAL_TYPE_RESPONSE;
export const INVALID_REQUEST_RPC_ID = _INVALID_REQUEST_RPC_ID;
export const HOST_ERROR_CODES = _HOST_ERROR_CODES;
export const DEFAULT_DEMO_DELAY_MS = _DEFAULT_DEMO_DELAY_MS;
export const assertEndpointName = _assertEndpointName;
export const routePathOf = _routePathOf;
export const isPlainObject = _isPlainObject;
export const jsonResponse = _jsonResponse;
export const okResult = _okResult;
export const errorResult = _errorResult;
export const readClientRequest = _readClientRequest;
export const createFetchHandler = _createFetchHandler;
export const createEndpointTable = _createEndpointTable;
export const readConnection = _readConnection;
export const HOST_ROUTE_RETRY_TIMEOUT_MS = _HOST_ROUTE_RETRY_TIMEOUT_MS;
export const HOST_ROUTE_RETRY_INTERVAL_MS = _HOST_ROUTE_RETRY_INTERVAL_MS;
export const writeHostStderr = _writeHostStderr;
export const scheduleTick = _scheduleTick;
export const registerRoute = _registerRoute;
export const registerRoutes = _registerRoutes;
