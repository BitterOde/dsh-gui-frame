/**
 * errors.mjs —— GUIFrame **错误码集合**：码名是公开面的一部分，一经发布不改。
 *
 * 为什么要单独一个文件：调用方按 `error.code` 分支，而不是去 match 错误文案 ——
 * 码名因此属于公开面。码表集中在这里，快照档
 * `tests/contracts/public-surface.json` 的 `errorCodes` 是它的**排序副本**；
 * 改一个码名 = 公开面变更 ⇒ 快照断言变红，必须显式改快照（不是禁止改，是不许**静默**改）。
 *
 * 两类码：
 *  - `GUIF-E-*`（抛出）：调用方写错 / 装配缺失 —— **可主动防御的错，绝不静默**；
 *  - `GUIF-W-*`（诊断）：只记录不阻断 —— 「越段只告警」「服务撞名主动让位」都在这一类。
 *
 * 三条纪律：
 *  ① **极值拒绝、越段告警**：`GUIF-E-Z-RANGE` 抛；`GUIF-W-Z-SEGMENT` 只记。
 *  ② **服务重名不让页面死**：`provideService` 先 `ctx.get` 探测、已存在则记
 *     `GUIF-W-SERVICE-CONFLICT` 并**主动让位**，绝不重复 `provide`（同 scope 重名 = 整页死）。
 *  ③ **能力缺席显式报**：某项能力的 `install` 没跑过就调它的方法 ⇒
 *     `GUIF-E-CAPABILITY-ABSENT`；不许静默 no-op（那会让调用方以为窗口开了）。
 *
 * 本文件**零副作用**：只定义常量与类，模块体在 factory 内物化时不碰 window / document。
 */

/** `error.name` 恒为该值；判型请用 `isGuiFrameError(err)` 或 `err.code`。 */
export const GUI_FRAME_ERROR_NAME = 'GuiFrameError';

/**
 * 致命码（抛出）。每个码都必须**可达**——加码前先确认 `src/` 里有真实抛出点。
 */
export const ERROR_CODES = Object.freeze([
  'GUIF-E-CTX-INVALID', // 调用方 ctx 不具备 Cordis 必备面（effect）—— 不许静默退化成「直接执行」
  'GUIF-E-ENTRY-INVALID', // register(entry, Component) 的 entry / Component 形状非法
  'GUIF-E-ENTRY-DUPLICATE', // entry.id 已在册（同一 id 不许注册两次）
  'GUIF-E-COMPONENT-INVALID', // components.register(name, Component) 参数非法
  'GUIF-E-COMPONENT-DUPLICATE', // 组件名已被占用
  'GUIF-E-CAPABILITY-ABSENT', // 该能力的分片未装配（对应 install(ctx, env) 未执行）
  'GUIF-E-SLICE-INVALID', // 装配切片返回了非法形状（装配期契约被破坏）
  'GUIF-E-Z-RANGE', // 层级号极值 / 非整数 ⇒ 一律拒绝，不退化为告警
  'GUIF-E-OVERLAY-SPEC', // overlay.open 的 spec / options 形状非法
  'GUIF-E-OVERLAY-ID', // 窗口 id 形态非法（合法但不存在的 id 走「返回 false」的幂等路径）
  'GUIF-E-LAYOUT-INVALID', // layout.replace / layout.subscribe 的入参不是校验过的 VersionedLayout
  'GUIF-E-CHANNEL-INVALID', // channel(method, params) 的 method 不是非空字符串
]);

/** 诊断码（只记录，不阻断）。 */
export const WARNING_CODES = Object.freeze([
  'GUIF-W-SERVICE-CONFLICT', // 服务名 gui-frame 已被占用 ⇒ 记诊断并让位
  'GUIF-W-Z-SEGMENT', // 层级号落在托管号段之外 ⇒ 只告警，不阻断
  'GUIF-W-Z-RESERVED', // 撞家族旧表值（1/2/3/10/62/63/64/66/70）⇒ 只告警
  'GUIF-W-LAYOUT-CORRUPT', // migrate 收到损坏 / 不认识版本的载荷 ⇒ 返回默认布局并记诊断（不抛错）
  'GUIF-W-LISTENER-THREW', // 订阅者在通知里抛错 ⇒ 吞掉并记录，不阻断其余订阅者
  // ── 主题守门的四条诊断码 ─────────────────────────────────────────────────────────
  // 为什么要进**码表**而不是留在 theme/ 里：命名空间闸门对 `src/**` 全文扫 `GUIF-…` 码，
  // 要求它们 ⊆ 本文件冻结集合 —— 留在模块里的「私有码」会让该门禁变红。
  // 本文件头的规则是「不是禁止改，是不许**静默**改」，于是这里**显式入表**并同步快照
  // （`node scripts/public-surface.mjs --write`）。
  'GUIF-W-THEME-TOKEN-UNKNOWN', // 样式用到既不在 403 白名单、也不是平台变量、且未登记的 token 名 ⇒ 只告警
  'GUIF-W-THEME-DYNAMIC-TOKEN', // 第三方经 register / overrideTokens 登记的动态 token 名 ⇒ 只告警不拒绝
  'GUIF-W-THEME-LITERAL-COLOR', // 样式里出现硬编码颜色 ⇒ 只告警（本包源码由 `check:tokens` 硬拦）
  'GUIF-W-THEME-PRIVATE-LEAK', // 公开样式引用了 --guif-private-* 私有变量 ⇒ 只告警
]);

/** 全部码（排序后）—— 即快照档 `errorCodes` 字段的内容。 */
export const ALL_CODES = Object.freeze([...ERROR_CODES, ...WARNING_CODES].sort());

/**
 * GUIFrame 的统一错误类型。**不用 `instanceof Error` 判型**（跨 bundle 实例会失配）——
 * 判型用 `isGuiFrameError`（查 `code` + 名字），或直接读 `error.code`。
 */
export const GuiFrameError = class GuiFrameError extends Error {
  /**
   * @param {string} code 必须取自 `ERROR_CODES`（构造器不校验集合：码表在本文件定义，校验留在测试）
   * @param {string} message 面向人的说明（含「怎么办」，不要只写「非法参数」）
   * @param {object|null} [details] 结构化上下文（调用方 id / 实际值 / 期望值）
   */
  constructor(code, message, details) {
    super(message);
    this.name = GUI_FRAME_ERROR_NAME;
    this.code = code;
    this.details = details === undefined ? null : details;
  }
};

/** 造一个 `GuiFrameError`（内部与下游的统一起手式）。 */
export function createError(code, message, details) {
  return new GuiFrameError(code, message, details);
}

/** 判型：只看 `code` 与 `name`，故跨 bundle 实例/跨 iframe 也能认。 */
export function isGuiFrameError(value) {
  return Boolean(value) && typeof value === 'object' && value.name === GUI_FRAME_ERROR_NAME && typeof value.code === 'string';
}

/** 诊断条目的人读形式（终端/上报链路统一用它，避免各处手拼）。 */
export function formatDiagnostic(diagnostic) {
  const code = diagnostic && typeof diagnostic.code === 'string' ? diagnostic.code : 'GUIF-W-UNKNOWN';
  const message = diagnostic && diagnostic.message ? String(diagnostic.message) : '';
  return `[gui-frame] ${code} ${message}`.trim();
}
