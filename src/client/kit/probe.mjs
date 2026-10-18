/**
 * soft-probe.mjs —— **读可选服务的唯一口径**。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【平台规则（实读 `@deepseek-ai/cordis/lib/index.js` 的 reflect handler，非推断）】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   get: (target, prop, ctx) => {
 *     if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);   // prototype / then / 数字 / `_` 开头
 *     if (Reflect.has(target, prop)) return …;                             // ctx 自己的成员（方法等）
 *     const error = new Error(`cannot get property "${prop}" without inject`);
 *     … 解析服务：解析不到 ⇒ **抛** →……………
 *   }
 * ⇒ 对**未声明/未注册**的服务做属性访问（`ctx.workspace`）会**直接抛**，不是返回 `undefined`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么这条规则能造成"静默零注册"】（真机事故）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 真机事故：探一个服务时写成「先试属性访问，拿不到再 `ctx.get(...)`」——
 * 真机上**第一行就抛**，软探测那行永远走不到；抛出的错又被「不许把页面搞崩」要求的整段 try/catch 吞掉
 * （apply 不许把页面搞崩，这是对的）⇒ **页面正常、能力全无**：
 *   `[gui-frame] 客户端 apply 失败（已吞，页面照常）：cannot get property "workspace" without inject`
 * 离线单测/e2e 用的是**替身 ctx**（不执行平台的 inject 规则）⇒ 属性访问只是 `undefined`，全绿。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【本文件的口径】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   - **读服务一律 `ctx.get(name)`**：平台公开的软探测，缺服务返回 `undefined`、**不抛**；
 *     这也是 `contracts/service-face.mjs` 写明的自家口径（不用 Cordis 的 inject 声明
 *     ——客户端 inject 缺服务会让 fiber 悬置、外壳 `assertEntriesActive` 抛错）。
 *   - **唯一豁免**：平台常驻的 `logger`（见 `probeLogger`）允许一次**受保护**的属性读取，
 *     且只允许发生在本文件 —— 别的模块一律 `probeLogger(ctx)` 取用，不自己碰属性。
 *   - 探测本身**绝不抛**：连 `ctx.get` 都抛的环境（退化替身）也退化成 `undefined`。
 */

/** 软探测的标识（诊断里点名用）。 */
export const SOFT_PROBE_NAME = 'gui-frame:soft-probe';

/**
 * 取一个**可选**服务（缺了就当没有，绝不抛）。
 *
 * **只用 `ctx.get(name)` 这一条路** —— 真机实测的三条事实决定了这一点：
 *   ① 本插件 `apply` 时（平台服务尚未注册）`ctx.get(name)` 恒为 `undefined`；
 *   ② 此时 `ctx.reflect.get(name, false)`（宽松解析）会返回一个**半初始化**的服务对象
 *      （`slots` 能拿到 `{ctx,name,_core,…}`，但它还没挂进渲染树）⇒ 拿它去注册座位等于**注册进一个不渲染的表**，
 *      比降级更糟：能力自称装上了、界面却什么都没有；
 *   ③ ~3s 后（兄弟插件的 fiber 就绪）`ctx.get(name)` 对 **slots / layout / locale / settingsScope / connection**
 *      全部返回真对象。
 * ⇒ 正确姿势是「**严格探测 + 等它真的出现**」：本函数只做严格探测，等待由 `entry.mjs` 的补装窗口负责
 *   （`SERVICES_READY_TIMEOUT_MS` / `SERVICES_READY_INTERVAL_MS`）。
 * @param {object|undefined|null} ctx 调用方 Cordis ctx
 * @param {string} name 服务名（如 `workspace` / `slots` / `settingsScope` / `connection`）
 * @returns {*} 服务实例或 `undefined`
 */
export function probeService(ctx, name) {
  if (ctx === null || ctx === undefined) return undefined;
  try {
    if (typeof ctx.get !== 'function') return undefined;
    return ctx.get(name);
  } catch {
    // 探测本身不许抛：拿不到 = 没有（「依赖缺失就不激活」）
    return undefined;
  }
}

/** `console` 兜底（没有 console 的环境就什么都不做；日志绝不该把装配搞崩）。 */
function consoleFallback(level, line) {
  try {
    if (typeof console === 'undefined' || console === null) return;
    const fn = typeof console[level] === 'function' ? console[level] : console.log;
    if (typeof fn === 'function') fn.call(console, line);
  } catch {
    // 兜底失败也不许抛
  }
}

/** console 形状的 logger（保底可见性：真机 console 里至少能看到降级原因）。 */
export const CONSOLE_LOGGER = Object.freeze({
  error: (line) => consoleFallback('error', line),
  warn: (line) => consoleFallback('warn', line),
  info: (line) => consoleFallback('info', line),
  debug: (line) => consoleFallback('debug', line),
});

/**
 * 取**日志出口**（诊断专用；拿不到也绝不抛）。
 *
 * 顺序：`ctx.get('logger')`（真机口径）→ 一次**受保护**的 `ctx.logger` 读取（测试替身把 logger 挂在
 * 属性上；真机若拒绝未声明属性访问就抛 ⇒ 这里吞掉）→ `console` 兜底。
 * ⚠ 这是全仓库**唯一**允许碰 `ctx.logger` 的地方：其它文件一律 `probeLogger(ctx)`。
 * @param {object|undefined|null} ctx
 * @returns {{error:Function, warn:Function, info:Function, debug:Function}}
 */
export function probeLogger(ctx) {
  const viaGet = probeService(ctx, 'logger');
  if (viaGet !== null && viaGet !== undefined) return viaGet;
  try {
    const direct = ctx === null || ctx === undefined ? undefined : ctx.logger;
    if (direct !== null && direct !== undefined) return direct;
  } catch {
    // 平台拒绝未声明属性访问 ⇒ 退到 console（可见性不丢）
  }
  return CONSOLE_LOGGER;
}

/**
 * 取日志出口的**某一级**（`logger.warn` 之类；拿不到就退到 console 的同级）。
 * @param {object|undefined|null} ctx
 * @param {'error'|'warn'|'info'|'debug'} level
 * @returns {Function} 恒可调用的函数（**永不抛**）
 */
export function probeLogFn(ctx, level) {
  const logger = probeLogger(ctx);
  try {
    if (logger !== null && logger !== undefined && typeof logger[level] === 'function') {
      return (line) => logger[level](line);
    }
  } catch {
    // 读 logger 的成员都可能抛（代理对象）⇒ 退 console
  }
  return (line) => consoleFallback(level, line);
}
