/**
 * index.mjs —— 宿主半区入口（装配契约：`name` / `inject` / `apply`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【本文件的两件事】——**不实现路由**（注册方式仍归 `routes.mjs`）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ① 调 `registerRoutes(ctx)` 装内置端点（`/api/gui-frame/ping`、`/api/gui-frame/demo`）；
 *  ② 通过 `registerRoutes` 的**既有扩展点** `extraRoutes` 追加诊断收端
 *     `/api/gui-frame/diagnostics` —— 走的还是 `routes.mjs` 的
 *     `{path, methods, requestBody, fetch}` + `ctx.connection.fetch.register` 那一条路；
 *     **本文件一行 `fetch.register` / `webServer.register` 都不写**（`tests/host/diagnostics-sink.test.mjs`
 *     有源码扫描闸门盯着）。端点处理体（去重/封顶/两层打印）是**业务逻辑**，不是路由注册。
 *
 * 形状契约：`name` 恒等于 `cordis.patch.yml` 的 loader entry id（`gui-frame`）；
 * `inject` 声明本插件依赖的平台服务（服务缺席不得把插件悬置）；`apply` 绝不抛。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【诊断的两层打印，以及为什么必须有 stderr 那一层】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 探针实测（`probe/evidence/cordis-logger-threshold.txt`、`cordis-logger-buffer-exporter.txt`）：
 * Cordis logger 的内置 exporter **只进内存 buffer**，且**默认阈值下 `warn`/`debug` 连 buffer 都进不去**
 * （只有 `error`/`info` 留得下）。也就是说：客户端在浏览器里崩了，宿主若只写 `logger.warn`，
 * **cmd 里什么都看不到** —— 这里要的正是「用户在 cmd 里能看见」。所以这里**两层并用**：
 *   ① `ctx.logger.warn(line)` —— 进 Cordis 日志体系（内存 buffer / 将来的 exporter 用得上）；
 *   ② `process.stderr.write(line)` —— **cmd 可见性由它承担**（直写，绕过默认阈值）。
 * 去重与封顶是同一个理由的另一面：诊断通道自己不能变成把 cmd 刷爆的洪水。
 */

import { registerRoutes } from './routes.mjs';
import { LAYOUT_NAMESPACE, SETTINGS_EFFECT_LABEL, describeSchemaAttempts, installSettingsNamespace } from './settings.mjs';

import { createDiagnosticsSink as _createDiagnosticsSink, defaultWrite, CLIENT_FAILURE_PREFIX as _CLIENT_FAILURE_PREFIX, DIAGNOSTICS_LIMITS as _DIAGNOSTICS_LIMITS, fingerprintOf as _fingerprintOf, hashFingerprint as _hashFingerprint } from './sink.mjs';

// ★ 拆件后**原路径再绑定**（见 `sink.mjs` 文件头）：外部 import 路径与导出名一字不变。
export const CLIENT_FAILURE_PREFIX = _CLIENT_FAILURE_PREFIX;
export const DIAGNOSTICS_LIMITS = _DIAGNOSTICS_LIMITS;
export const createDiagnosticsSink = _createDiagnosticsSink;
export const fingerprintOf = _fingerprintOf;
export const hashFingerprint = _hashFingerprint;

/** loader entry id（＝ `cordis.patch.yml` 的 insert id ＝ `name`）。 */
export const name = 'gui-frame';

/**
 * **声明式 inject**：宿主半区依赖**平台自带服务** `connection`（`/api` 路由注册面）
 * 与 `settings`（用户设置命名空间注册面）。
 *
 * 为什么可以声明：不许 `inject` 那条口径针对的是**反方向** ——
 * **别的插件** `inject: ['gui-frame']` 依赖**本插件**（怕缺依赖把整页拖死）。本插件自身依赖平台自带服务时
 * 按平台口径声明 inject 是**正确做法**，官方宿主插件同款（`dsh-session-log-export`：`inject = ['commands','connection']`；
 * `dsh-client-ui-theme` 宿主半区：`ctx.inject(['settings'], …)` 给 `ui-theme` 注册命名空间）。
 * 不声明的实测后果（真机）：`ctx.get('connection')` 恒 `undefined`（兄弟插件提供的服务不解到本 ctx），
 * `/api/gui-frame/diagnostics` 永远 404；同理不声明 `settings` ⇒ `gui-frame` 命名空间注册不上去 ⇒
 * 客户端 `settingsScope` 恒 `unavailable` ⇒ 布局持久化在真机上只读。
 *
 * ⚠ **`settings` 为什么也必须写在这张声明表里**（而不是退回 `ctx.inject(['settings'], scoped => …)`）：
 * `register()` 内部那条 effect 绑的是**调用点的 ctx** —— 从**插件 ctx** 调用 ⇒ 注册随插件 fiber 卸载；
 * 从 `ctx.inject` 回调的**临时 scope** 调用 ⇒ 随 scope 消失（真机反例：日志说「已注册」而注册/端点没了）。
 * 声明式 inject 让 `apply` 直接跑在插件自己的 fiber 上，是唯一能同时满足「看得见服务」与「挂对 fiber」的写法。
 */
export const inject = ['connection', 'settings'];


/** 上报端点名（走 `routes.mjs` 的 `extraRoutes`；与客户端 `diagnostics.mjs` 的常量逐字一致）。 */
export const DIAGNOSTICS_ENDPOINT = 'diagnostics';

/**
 * **注册尝试读数行前缀**（真机 `stderr` / `cmd` 里 `grep 'settings 注册'` 直接读到结果）。
 * 为什么要有它：宿主侧注册到底发生了没有，一度读不到
 * （结果只进 Cordis logger 的内存 buffer）⇒ 根因被可见性挡在门外。这条前缀把尝试结果钉成
 * **装置可读的读数**（`seq` / `at` / `settingsSource` / 命中的锚 / 每个锚的失败原因）。
 */
export const SETTINGS_INSTALL_PREFIX = '[gui-frame] settings 注册';


/**
 * 宿主 `apply` 的实现体：**只调用 `routes.mjs` 的注册函数**（含它的 `extraRoutes` 扩展点）+
 * settings 命名空间注册（见 `installSettingsNamespaceHere`）。
 * 单独导出是为了让单测能拿到 sink（`apply` 只返回 `undefined`）。
 * @param {object} ctx 宿主 ctx
 * @param {{sink?:object, limits?:object, retry?:boolean, importModule?:Function, settings?:object}} [options]
 */
/** 命名空间注册的模块级观察口（`applyRoutes` 同步返回，注册体异步）。 */
let lastSettingsInstallReport = Object.freeze({ registered: false, reason: 'not-attempted', namespace: LAYOUT_NAMESPACE, field: 'layout' });
let settingsInstallPromise = null;

export function applyRoutes(ctx, options = {}) {
  const sink = options.sink ?? createDiagnosticsSink({ logger: ctx === null || ctx === undefined ? null : ctx.logger, limits: options.limits });
  const extraRoutes = [{ name: DIAGNOSTICS_ENDPOINT, handle: sink.handle, context: { diagnostics: true } }];

  // **声明式 inject 见本文件顶部的 `inject` 导出**。声明之后平台会在
  // `connection` 就绪时才激活本插件，`apply` 跑在**插件自己的 fiber** 上 ⇒ 注册用的 `ctx.effect` 挂在
  // 存活到插件卸载的 fiber 上，路由不会被回收（实测反证：把注册写进 `ctx.inject([...], scoped => …)`
  // 的临时 scope 里，日志说「已注册」而端点仍 404 —— scope 一结束 effect 即被拆掉）。
  // 失败可见性与有界补注册窗口保持不动：部署环境里 `connection` 真缺席时仍要能看见。
  const registered = registerRoutes(ctx, { extraRoutes, retry: options.retry ?? true });
  installSettingsNamespaceHere(ctx, options);
  return { ...registered, sink };
}

/**
 * ★ **宿主侧 settings 命名空间注册**（让客户端 `settingsScope` 不再恒 `unavailable`）。
 *
 * 三点口径：
 *  ① 注册体走 `settings.mjs` 的 `installSettingsNamespace(ctx, …)` —— **用插件自己的 ctx**，
 *     这样 `register()` 内部那条 effect 落在插件 fiber 上（卸载即注销）；**不在**任何 `ctx.inject(…)` 回调里注册；
 *  ② 它是**异步**的（schemastery 只能经 `import()` 取：宿主半区不许静态 import 平台包），
 *     而 `apply` 必须**同步返回 `undefined`**（Cordis 会把返回的 Promise 当 effect 收走）⇒ 这里只发起、不 await，
 *     失败也只在 then/catch 里记诊断；
 *  ③ 结果落在模块级 `lastSettingsInstall()`，给诊断与单测一个观察口（与客户端 `__internals.lastAssembly()` 同款思路）。
 */
function installSettingsNamespaceHere(ctx, options) {
  lastSettingsInstallReport = { registered: false, reason: 'pending', namespace: LAYOUT_NAMESPACE, field: 'layout' };
  const installOptions = options.importModule === undefined ? {} : { importModule: options.importModule };
  if (options.settings !== undefined) installOptions.settings = options.settings;
  // ★ 诊断/单测缝（**都是可选覆盖**，缺省时完全走默认行为，不改注册语义）：
  //   `anchors` / `resolveFrom` / `importUrl` / `baseUrl` / `profileDir` / `now` 原样透传，
  //   让「锚点解析」这条链在测试与真机判读里都能被喂入确定输入、并被记进读数。
  for (const key of ['anchors', 'resolveFrom', 'importUrl', 'baseUrl', 'profileDir', 'now']) {
    if (options[key] !== undefined) installOptions[key] = options[key];
  }
  settingsInstallPromise = installSettingsNamespace(ctx, installOptions)
    .then((report) => {
      lastSettingsInstallReport = report;
      // ★ 把「注册尝试的结果」写成**可读读数**（一行，stderr 与 logger 两层都出）——
      //   包含 seq / at / 服务来自哪一级 / schema 从哪来 / **每个候选锚的成败**。
      const readout = settingsReadoutOf(report);
      if (report.registered === true) {
        log(ctx, 'info', `${SETTINGS_INSTALL_PREFIX}尝试 #${report.seq} ⇒ 已注册 settings 命名空间 ${LAYOUT_NAMESPACE}（registered=true｜字段 ${report.field}｜effect=${SETTINGS_EFFECT_LABEL}）—— 客户端 settingsScope 由此不再 unavailable（布局可保存）｜${readout}`);
      } else {
        log(ctx, 'warn', `${SETTINGS_INSTALL_PREFIX}尝试 #${report.seq} ⇒ settings 命名空间**未注册**（${report.reason ?? 'unknown'}）⇒ 客户端 settingsScope 会停在 unavailable，布局只读（页面照常启动）｜${readout}`);
      }
      return report;
    })
    .catch((error) => {
      // 兜底：installSettingsNamespace 自己全程 try/catch，走到这里说明有意料之外的抛错 ⇒ 记下来，绝不再往外抛
      lastSettingsInstallReport = { registered: false, reason: `threw: ${String(error?.message ?? error)}`, namespace: LAYOUT_NAMESPACE, field: 'layout' };
      log(ctx, 'warn', `${SETTINGS_INSTALL_PREFIX}抛错（已吞，页面照常启动）：${error?.message ?? error}｜${settingsReadoutOf(lastSettingsInstallReport)}`);
      return lastSettingsInstallReport;
    });
  return settingsInstallPromise;
}

/**
 * 报告 → 一行**读数**（只读，不改任何行为）。
 * 形状固定，真机 `grep 'settings 注册'` 后一眼可判：`seq=… at=… settings=… schema=… 锚=…`。
 * @param {object} report `installSettingsNamespace` 的返回（缺字段也照打，不抛）
 */
export function settingsReadoutOf(report) {
  const row = report !== null && report !== undefined && typeof report === 'object' ? report : {};
  const source = row.schemaSource !== null && row.schemaSource !== undefined && typeof row.schemaSource === 'object' ? row.schemaSource : null;
  const schemaText = source === null ? 'none' : `${source.kind}${typeof source.anchorName === 'string' ? `@${source.anchorName}` : ''}${typeof source.resolvedPath === 'string' ? `=${source.resolvedPath}` : ''}`;
  return `settings=${row.settingsSource ?? 'unknown'} schema=${schemaText} 锚=${describeSchemaAttempts(row.anchorAttempts)} at=${row.at ?? 'unknown'}`;
}

/** 最近一次命名空间注册的结果（观察口；`applyRoutes` 同步返回，注册是异步的）。 */
export function lastSettingsInstall() {
  return lastSettingsInstallReport;
}

/** 等这次注册落定（单测/自检用；没发起过就返回当前结果）。 */
export function awaitSettingsInstall() {
  return settingsInstallPromise === null ? Promise.resolve(lastSettingsInstallReport) : settingsInstallPromise;
}

/** 插件入口（平台调用；**绝不抛**：宿主 apply 抛错会连累整页）。 */
export function apply(ctx) {
  try {
    const result = applyRoutes(ctx);
    if (result.ok !== true) {
      // 首轮多半是「connection 服务还没就绪」：这不是终态（routes.mjs 会在补注册窗口内重试），
      // 所以这里只记一条 warn；真正的失败/成功都以 **stderr 直写**落在 cmd 上。
      log(ctx, 'warn', `[gui-frame] 宿主路由未注册（${result.reason ?? 'unknown'}）—— 依赖缺失时不激活，只记一条警告；页面照常启动`);
    }
  } catch (error) {
    log(ctx, 'error', `[gui-frame] 宿主 apply 失败（已吞，页面照常）：${error?.message ?? error}`);
  }
  return undefined;
}

/**
 * 宿主侧诊断一式两层（**先 logger 后 stderr**，与诊断收端同款）：
 *   ① `ctx.logger[level](line)` —— 进 Cordis 日志体系（内存 buffer / 将来的 exporter 用得上）；
 *   ② `process.stderr.write(line)` —— **cmd / 装置可见性由它承担**（批准的出口：直写，绕过默认阈值）。
 *     探针实测：Cordis logger 的默认 exporter 只进内存 buffer，`warn` 连 buffer 都进不去 ⇒ 只写 logger
 *     等于真机上一行都看不到（这正是「宿主侧注册到底发生了没有」当时读不到的原因）。
 */
function log(ctx, level, line) {
  const logger = ctx === null || ctx === undefined ? null : ctx.logger;
  if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](line);
  defaultWrite(line);
}

export default { name, inject, apply };
