/**
 * tokens.mjs —— **主题 token 表逻辑**（能力④，探针 P4 实测标尺）。
 *
 * 本文件只做**表与判据**，数据在 `tokens-data.mjs`（生成物，勿手改）：
 *   - `FROZEN_TOKENS`：**403** 个 `--dsw-*` —— 外壳 `dsh-client-ui-theme` 产物里**声明**的并集，
 *     这是**唯一白名单**；
 *   - `FROZEN_DARK_TOKENS`：其中 **196** 个另有暗色值；**其余 207 个继承亮色，不是缺陷**
 *     （探针 P4 实测 `darkOnlyTokens: []`：没有任何 token 是「只有暗色」的）——
 *     所以 lint **不得**要求每个 token 都有暗色值；
 *   - `PLATFORM_VARS`：**24** 个平台变量（`--ds-*` 5 / `--dsh-*` 8 / `--shiki-*` 11）。
 *     它们是**解析上下文**而不是白名单成员：只用 `--dsw-*` 表自洽，403 条里亮/暗各有 25 条悬空
 *     （19 条引用 `--dsh-content-font-delta`、6 条引用 `--ds-font-family-code`）；
 *     纳入平台变量后 0 条悬空。两条数字都由 `node scripts/check-tokens.mjs --verify-frozen` 实测复现。
 *
 * ⚠ 三条反面清单（踩过就有代价）：
 *   ① **不要**把 `exportInspectTokens()` 的 14 个静态种子当白名单 —— 它运行期还会叠加
 *      「已注册主题 + 覆盖层」的 token 名，拿它当白名单会把 **389** 个合法 token 判成未知
 *      （`INSPECT_SEED_TOKENS` 只作**说明层**：给「这些名字长什么样」当例子）；
 *   ② **不要**按 `--dsw-` 前缀以外的规则「猜」token 合法性（如 `--dsw-alias-*` 才认）——
 *     前缀分布 font 182 / alias 107 / static 77 / specific 11 / radius 6 / elevation 5 / shadow 4 /
 *     gradient 3 / menu 2 / focus 2 / linear 2 / corner 1 / mask 1，任何前缀白名单都会误报；
 *   ③ 本文件的判据是**纯函数**，不碰 DOM、不读全局，故 L0 层可直接单测。
 */

import {
  FROZEN_DARK_TOKENS as DATA_DARK_TOKENS,
  FROZEN_PROVENANCE as DATA_PROVENANCE,
  FROZEN_TOKENS as DATA_TOKENS,
  PLATFORM_VARS as DATA_PLATFORM_VARS,
} from './tokens-data.mjs';

/**
 * 冻结件重导出（下游只需 import 本文件）。
 * ⚠ 这里**不能**写 `export { … } from` 重导出形式：自研打包器只支持 `export const X = …` /
 * `export function f()`，`export { … }` 是**构建失败**面（实测报错「不支持 export { … } 形式」）。
 */
export const FROZEN_TOKENS = DATA_TOKENS;
export const FROZEN_DARK_TOKENS = DATA_DARK_TOKENS;
export const PLATFORM_VARS = DATA_PLATFORM_VARS;
export const FROZEN_PROVENANCE = DATA_PROVENANCE;

/** 设计系统 token 前缀。 */
export const TOKEN_PREFIX = '--dsw-';
/** GUIFrame **公开** CSS 变量前缀（组件对外只暴露这一族）。 */
export const GUIF_PUBLIC_PREFIX = '--guif-';
/** GUIFrame **私有** CSS 变量前缀（内部状态一律加 `private-`：公开面只留 `--guif-*`）。 */
export const GUIF_PRIVATE_PREFIX = '--guif-private-';
/** 解析上下文里的平台命名空间（顺序与验收条款一致：`--dsh-*` / `--ds-*` / `--shiki-*`）。 */
export const PLATFORM_NAMESPACES = Object.freeze(['--dsh-', '--ds-', '--shiki-']);

/** 白名单条数（403）——硬编码在断言里，避免"悄悄换成一个更小的表"也能过。 */
export const FROZEN_TOKEN_COUNT = FROZEN_TOKENS.length;
/** 暗色另有值的条数（196）。 */
export const FROZEN_DARK_COUNT = FROZEN_DARK_TOKENS.length;
/** 继承亮色的条数（207）——**不是**待补清单。 */
export const FROZEN_INHERITED_COUNT = FROZEN_TOKEN_COUNT - FROZEN_DARK_COUNT;

/**
 * `exportInspectTokens()` 的**静态种子**（14 条，探针 P4 的 B 段实测）。
 * **只作说明层**：它是「inspect 目录里长什么样」的样例，不是全集、不参与白名单判定。
 * 实测：14 条**全部**在 403 里（`inDirectoryNotInStylesheet: []`），但 403 里有 389 条不在它里面。
 */
export const INSPECT_SEED_TOKENS = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]);

const FROZEN_SET = new Set(FROZEN_TOKENS);
const DARK_SET = new Set(FROZEN_DARK_TOKENS);
const PLATFORM_SET = new Set(PLATFORM_VARS);

/** 是不是 403 白名单成员。 */
export function isFrozenToken(name) {
  return typeof name === 'string' && FROZEN_SET.has(name);
}

/** 该 token 是否**另有暗色值**（false ≠ 缺暗色：它继承亮色）。 */
export function isDarkCovered(name) {
  return typeof name === 'string' && DARK_SET.has(name);
}

/** 是不是平台变量（解析上下文成员；`--ds-*` / `--dsh-*` / `--shiki-*`）。 */
export function isPlatformVar(name) {
  return typeof name === 'string' && PLATFORM_SET.has(name);
}

/** 是否是**未知**的 `--dsw-*` 名（既不冻结、也不是平台变量、也没被动态登记）。 */
export function isUnknownToken(name, extra) {
  if (typeof name !== 'string' || !name.startsWith(TOKEN_PREFIX)) return false;
  if (FROZEN_SET.has(name) || PLATFORM_SET.has(name)) return false;
  if (extra !== undefined && extra !== null) {
    if (extra instanceof Set ? extra.has(name) : Array.isArray(extra) ? extra.includes(name) : false) return false;
  }
  return true;
}

/** 公开 `--guif-*` 变量（不得以 `--guif-private-` 开头，那是私有族）。 */
export function isGuifPublicVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PUBLIC_PREFIX) && !name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 私有 `--guif-private-*` 变量。 */
export function isGuifPrivateVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 变量名形态：`--` 开头的 kebab（不校验语义，只挡明显写错的名字）。 */
export function isValidVarName(name) {
  return typeof name === 'string' && /^--[a-z0-9][a-z0-9-]*$/.test(name);
}

/**
 * 暗色覆盖策略（**只读声明**，供 lint 与文档共用；item 10 的口径）。
 * `requireAll: false` 是**刻意**的：要求每个 token 都有暗色值会与外壳自身的 196/207 现实打架。
 */
export const DARK_COVERAGE_POLICY = Object.freeze({
  attribute: 'data-ds-dark-theme',
  selector: 'body[data-ds-dark-theme]',
  covered: FROZEN_DARK_COUNT,
  inherited: FROZEN_INHERITED_COUNT,
  requireAll: false,
  note: '暗色只覆盖 196 条，其余 207 条继承亮色；lint 不得把「无暗色值」报成问题。',
});
