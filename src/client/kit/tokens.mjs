/**
 * tokens.mjs —— 坞与面板的**样式层**：`--dsw-*` token 白名单 + `--guif-*` 变量命名规则。
 *
 * ═══ 两条硬规则的判据（不是风格，是机制）═══
 * ① **只用 `--dsw-*`**：外壳的主题真源是 `dsh-client-ui-theme` 产物里的 403 条 `--dsw-*`
 *    声明（P4 探针实测：`probe/evidence/p4-theme-tokens.json` 的 `A_themeBundle.unionDeclared`）。
 *    本文件的白名单是它的**子集**，且每一条都同时出现在
 *      - `B_inspectDirectory.names`（`exportInspectTokens()` 的静态种子）或
 *      - `C_shellCss.referencedAliasNames`（外壳 CSS 真实引用的 alias），
 *    并且**不在** `D_tree.referencedNotDeclared`（被引用但主题表里没有声明的那 10 条）里 ——
 *    那 10 条是「写上去就悬空」的陷阱（如 `--dsw-alias-label-error`、`--dsw-font`）。
 *    ⇒ 任何不在白名单里的 `--dsw-*` 名字都**在装配期直接抛**
 *      （取既有冻结码 `GUIF-E-COMPONENT-INVALID`，不新造码 —— 见下方 `tokenError` 的说明），
 *      这样「手滑写了个不存在的 token」不会变成「真机上颜色莫名其妙」。
 * ② **`--guif-*` 两分**：**公开**变量（接入方可以覆盖，属契约）一律 `--guif-*`；
 *    **私有**变量（实现细节，随时可改）一律 `--guif-private-*`。两者都**只作为 fallback 的外层**：
 *    `var(--guif-xxx, var(--dsw-yyy))` —— 没被覆盖时观感与外壳同源。
 *    命名判据是纯函数（`isGuifPublicVar` / `isGuifPrivateVar`），单测直接扫源码复核。
 *
 * 本文件**零副作用**：纯常量表 + 纯函数。
 */
import { createError } from '../contracts/errors.mjs';

/** token / 变量的前缀常量（三处判据唯一真源）。 */
export const DSW_PREFIX = '--dsw-';
export const GUIF_PUBLIC_PREFIX = '--guif-';
export const GUIF_PRIVATE_PREFIX = '--guif-private-';

/**
 * 允许出现在坞与面板样式里的 `--dsw-*` token（**白名单**；见文件头 ①）。
 * 每一条都在 `probe/evidence/p4-theme-tokens.json` 里有落点，且已逐个对照
 * `D_tree.referencedNotDeclared`（10 条陷阱）确认不在其中。
 */
export const DSW_TOKENS = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-corner-shape',
  '--dsw-elevation-stroke',
  '--dsw-font-xxs-12-font-size',
  '--dsw-font-xs-13-font-size',
  '--dsw-specific-sidebar-fill',
]);

/**
 * **公开** `--guif-*` 变量（接入方契约：可以覆盖，且改了属于公开面变更）。
 * 用途：坞/面板的骨架尺寸与配色缝 —— 插件只写内容，观感由这里统一。
 *
 * ★ 扩容（用户要求「在接口上做得稍微丰富点」）：坞面板里**按钮那一行**从「只有角标
 *   两个色」扩成**一族**（`--guif-dock-row-*`），把**三态底色、字色与焦点环**开出来。三条纪律
 *   （缺一条这一族就是假的）：
 *   ① **只「取用」，绝不「声明」**：取值一律写在 `var(--guif-…, 缺省)` 的**使用位**
 *      （内联 style 的值、样式表的声明值）—— 一旦在元素上把变量**声明**成内联自定义属性，
 *      祖先给的覆盖值就被它自己那一条挡死（自定义属性走继承：元素自己的声明恒胜过继承来的值）。
 *      本包就是这样踩的（见 `panel/components.mjs` 的注释）。
 *   ② **缺省即现状**：族内每个名字的 `var()` 回退值 = 扩容前的取值 ⇒ 没人覆盖时观感零变化
 *      （由 `tests/unit/dock-style-vars.test.mjs` 的冻结表逐条对锁）。
 *   ③ **一行一个悬停面**：族里给的是**整行**的底色；行内控件自己的悬停底色
 *      仍被样式表强制透明（不要在这一族里给它开口子，那是另一条裁定）。
 *
 * ⚠ **有意不开的两个旋钮＝美学秩序里的不变量（用户两次确认）**：**行圆角**（`8px`）与
 *   **行与行的间距**（`4px`）。第一次是判「没必要」；**第二次给的是理由：「改行圆角和行间距会影响面板的
 *   美学秩序，所以不要。」** ⇒ 它们与 DSH 侧栏 `.panelRow` / `.panelList` **逐值同源**，是这个面板「看着
 *   像同一个面板」的基础 ⇒ **不是配置项、不是漏开**：实现里保持字面量。
 *   要改这两个只能动本包样式/内联基线（或提需求改设计），**不要**顺手加回登记 —— 有断言盯着它们
 *   必须是**字面量**（加回来会红，逼人先想清楚是不是该动美学秩序）。
 */
export const GUIF_PUBLIC_VARS = Object.freeze([
  '--guif-dock-badge-bg',
  '--guif-dock-badge-fg',
  '--guif-dock-glyph-size',
  '--guif-dock-row-bg',
  '--guif-dock-row-bg-active',
  '--guif-dock-row-bg-hover',
  '--guif-dock-row-fg',
  '--guif-dock-row-fg-active',
  '--guif-dock-row-focus-ring',
  '--guif-panel-bg',
  '--guif-panel-border',
  '--guif-panel-fg',
  '--guif-panel-gap',
  '--guif-panel-padding',
  '--guif-panel-radius',
  '--guif-toolbar-gap',
]);

/**
 * **私有** `--guif-private-*` 变量（实现细节；接入方**不得**依赖，改名不算公开面变更）。
 */
export const GUIF_PRIVATE_VARS = Object.freeze([
  '--guif-private-badge-min-width',
  '--guif-private-header-min-height',
  '--guif-private-row-min-height',
  '--guif-private-status-min-height',
]);

/** 是否合法 `--dsw-*` token（在**白名单**内；不在白名单的合法主题 token 也不许用 —— 见文件头 ①）。 */
export function isAllowedDswToken(name) {
  return typeof name === 'string' && DSW_TOKENS.includes(name);
}

/** 是否**公开** `--guif-*` 变量（注意：`--guif-private-*` 也以 `--guif-` 开头，必须先排除它）。 */
export function isGuifPublicVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PUBLIC_PREFIX) && !name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 是否**私有** `--guif-private-*` 变量。 */
export function isGuifPrivateVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 装配期错误（未知 token / 未知变量名一律显式抛，不静默降级成空串）。
 *
 * ⚠ 错误码**只能取 `src/client/contracts/errors.mjs` 里已冻结的那 17 条**（公开面门禁
 * `tests/verify-surface/public-surface.test.mjs` 会扫 `src/**` 里的 `GUIF-[EW]-*` 并要求 ⊆ 冻结集合）。
 * 本文件用既有码 `GUIF-E-COMPONENT-INVALID`（语义：**组件层入参非法** —— token 名正是组件层的入参），
 * 不为「token 白名单」新造码（那要走公开面的反向验证流程）。
 */
export function tokenError(message, details) {
  return createError('GUIF-E-COMPONENT-INVALID', `[panel/tokens] ${message}`, details);
}

/**
 * 取一个白名单 token 的 `var(...)` 引用。
 * @param {string} name 必须是 `DSW_TOKENS` 里的一条
 * @param {string|null} [fallback] 可选兜底值（另一个 `var(...)` 或字面量）
 */
export function dsw(name, fallback = null) {
  if (!isAllowedDswToken(name)) {
    throw tokenError(`未知或未获准的 --dsw-* token「${name}」——白名单见 src/client/kit/tokens.mjs（只用 P4 证据里真实声明过的 token）`);
  }
  return fallback === null ? `var(${name})` : `var(${name}, ${fallback})`;
}

/**
 * 公开变量引用：外层是接入方可覆盖的 `--guif-*`，内层落到 `--dsw-*`（观感与外壳同源）。
 * @param {string} name 必须是 `GUIF_PUBLIC_VARS` 里的一条
 * @param {string} token `DSW_TOKENS` 里的一条（兜底）
 * @param {string|null} [literal] 内层再兜一个字面量（`--dsw-*` 本身也可能悬空时用）
 */
export function guifVar(name, token, literal = null) {
  if (!isGuifPublicVar(name) || !GUIF_PUBLIC_VARS.includes(name)) {
    throw tokenError(`公开变量必须写成 --guif-* 且在 GUIF_PUBLIC_VARS 里（收到「${name}」）——私有变量要用 --guif-private-*`);
  }
  return `var(${name}, ${dsw(token, literal)})`;
}

/**
 * 公开变量引用，兜底是**字面量**（尺寸/间距这类没有对应 `--dsw-*` token 的取值）。
 * 取值位置仍然是 `var(...)`；字面量**只允许出现在 var() 的 fallback 位置**（见文件头 ②）。
 * @param {string} name 必须是 `GUIF_PUBLIC_VARS` 里的一条
 * @param {string} literal CSS 字面量（如 `'8px'`）
 */
export function guifLiteral(name, literal) {
  if (!isGuifPublicVar(name) || !GUIF_PUBLIC_VARS.includes(name)) {
    throw tokenError(`公开变量必须写成 --guif-* 且在 GUIF_PUBLIC_VARS 里（收到「${name}」）`);
  }
  return `var(${name}, ${literal})`;
}

/**
 * 私有变量引用（`--guif-private-*`）。
 * @param {string} name 必须是 `GUIF_PRIVATE_VARS` 里的一条
 * @param {string|null} [fallback] `--dsw-*` token（须在白名单内）**或**一个字面量（如 `'14px'`）
 */
export function guifPrivateVar(name, fallback = null) {
  if (!isGuifPrivateVar(name) || !GUIF_PRIVATE_VARS.includes(name)) {
    throw tokenError(`私有变量必须写成 --guif-private-* 且在 GUIF_PRIVATE_VARS 里（收到「${name}」）`);
  }
  if (fallback === null) return `var(${name})`;
  if (typeof fallback === 'string' && fallback.startsWith(DSW_PREFIX)) return `var(${name}, ${dsw(fallback)})`;
  return `var(${name}, ${fallback})`;
}
