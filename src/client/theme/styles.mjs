/**
 * styles.mjs —— **组件自带 token**：样式只走 `var(--dsw-*)` 与 `var(--guif-*)`（能力④）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【两层变量：公开 `--guif-*` / 私有 `--guif-private-*`】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  - **公开族 `--guif-*`**：GUIFrame 对外的样式契约（组件作者写样式只引用它，或直接引用 `--dsw-*`）。
 *    它们**不是新颜色**，而是外壳 token 的**语义别名**（见 `SCOPE_VAR_MAP`）——
 *    换主题时跟着外壳走，插件永远不写死颜色。
 *  - **私有族 `--guif-private-*`**：实现态（作用域 id、层级号、拖拽偏移、尺寸…）。
 *    私有变量**不得**被公开样式引用；lint 见到就告警（`GUIF-W-THEME-PRIVATE-LEAK`）。
 *    规则很简单：**公开面只暴露 `--guif-*`，实现的都加 `private-`**。
 *
 * 「不写颜色就不会错」：本文件的 `defineStyleSheet` 只做**拼装 + 校验**，
 * 检测到硬编码颜色就产诊断（`GUIF-W-THEME-LITERAL-COLOR`），**不抛**（告警式）。
 * 本包自己源码里的硬编码颜色由 `npm run check:tokens` **硬拦**。
 *
 * 本文件不碰全局：`document` 从参数进来；`installStyleSheet` 缺 DOM 时静默不激活。
 */

import { lintTokenUsage, createTokenContext } from './lint.mjs';
import { DARK_SELECTOR } from './dark.mjs';

/** 注入的样式标签（真机断言用它找自己的样式）。 */
export const GUIF_STYLE_TAG = 'style';
/** 样式标签上的归属属性（值恒为 `gui-frame`）。 */
export const GUIF_STYLE_ATTRIBUTE = 'data-guif-theme';

/**
 * **公开变量 → 外壳 token** 的语义别名表（组件样式只认左边）。
 * 右边的每个 token 都在白名单里 —— 换名字会被 `check:tokens` 的硬门禁当场抓住
 * （这就是"自带 token"不靠自觉的原因）。
 */
export const SCOPE_VAR_MAP = Object.freeze({
  '--guif-bg': 'var(--dsw-alias-bg-layer-1)',
  '--guif-bg-raised': 'var(--dsw-alias-bg-layer-2)',
  '--guif-bg-hover': 'var(--dsw-alias-interactive-bg-hover)',
  '--guif-border': 'var(--dsw-alias-border-l1)',
  '--guif-border-strong': 'var(--dsw-alias-border-l2)',
  '--guif-text': 'var(--dsw-alias-label-primary)',
  '--guif-text-dim': 'var(--dsw-alias-label-secondary)',
  '--guif-text-caption': 'var(--dsw-alias-label-caption)',
  '--guif-accent': 'var(--dsw-alias-brand-primary)',
  '--guif-danger': 'var(--dsw-alias-state-error-primary)',
  '--guif-success': 'var(--dsw-alias-state-success-primary)',
  '--guif-warn': 'var(--dsw-alias-state-warn-primary)',
});

/** 公开族变量名（排序）。 */
export const GUIF_PUBLIC_VARS = Object.freeze(Object.keys(SCOPE_VAR_MAP).sort());

/** 私有族变量名（实现态；公开样式**不得**引用）。 */
export const GUIF_PRIVATE_VARS = Object.freeze([
  '--guif-private-drag-x',
  '--guif-private-drag-y',
  '--guif-private-height',
  '--guif-private-scope',
  '--guif-private-width',
  '--guif-private-z',
]);

/** 作用域 class（组件根节点用；样式表里唯一的公开钩子）。 */
export const SCOPE_CLASS = 'guif-theme-scope';

/** `var(--dsw-x)` 引用所用 token 名（供断言与 lint）。 */
export function tokensUsedByScopeMap() {
  const used = new Set();
  for (const value of Object.values(SCOPE_VAR_MAP)) {
    for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) used.add(match[1]);
  }
  return [...used].sort();
}

/**
 * 把一张声明表渲染成 CSS 声明串（值原样输出；只做**形态**检查，不做颜色拦截 —— 拦截在 lint 里）。
 * @param {Record<string,string|number>} declarations 声明名 → 值
 * @param {{requireVar?:boolean}} [options] `requireVar:true` 时声明名必须是自定义属性（`--x`），
 *   用于"作用域变量块"那一处（普通 CSS 属性如 `color` 不是自定义属性，不该被这条规则挡）
 * @returns {string}
 */
export function renderDeclarations(declarations, options = {}) {
  const requireVar = options.requireVar === true;
  const rows = [];
  for (const [name, value] of Object.entries(declarations ?? {})) {
    if (typeof name !== 'string' || !/^(--)?[a-z][a-z0-9-]*$/.test(name)) {
      throw new TypeError(`CSS 声明名形态非法：${String(name)}（只允许小写字母/数字/连字符，自定义属性以 -- 开头）`);
    }
    if (requireVar && !name.startsWith('--')) {
      throw new TypeError(`这里要的是自定义属性（-- 开头），收到 ${name}`);
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`声明 ${name} 的值必须是字符串或数字（收到 ${typeof value}）`);
    }
    rows.push(`${name}: ${String(value)}`);
  }
  return rows.join('; ');
}

/**
 * 拼一张样式表。
 * @param {{scope?:string, vars?:Record<string,string>, rules?:Array<{selector:string, decls:Record<string,string>}>}} spec
 * @param {{source?:string, context?:object}} [options]
 * @returns {{css:string, warnings:Array<object>, ok:boolean}}
 */
export function defineStyleSheet(spec, options = {}) {
  if (spec === null || typeof spec !== 'object') throw new TypeError('defineStyleSheet(spec) 的 spec 必须是对象');
  const scope = typeof spec.scope === 'string' && spec.scope !== '' ? spec.scope : `.${SCOPE_CLASS}`;
  const blocks = [];
  if (spec.vars !== undefined && spec.vars !== null) blocks.push(`${scope} { ${renderDeclarations(spec.vars, { requireVar: true })} }`);
  for (const rule of spec.rules ?? []) {
    if (rule === null || typeof rule !== 'object' || typeof rule.selector !== 'string') {
      throw new TypeError('defineStyleSheet 的每条 rule 需要 { selector, decls }');
    }
    blocks.push(`${rule.selector} { ${renderDeclarations(rule.decls)} }`);
  }
  const css = `${blocks.join('\n')}\n`;
  const report = lintTokenUsage(css, { context: options.context ?? createTokenContext(), source: options.source ?? 'defineStyleSheet' });
  return { css, warnings: report.warnings, ok: report.ok };
}

/**
 * 组件基础样式（**只引用变量**；组件直接用，不需要再写颜色）。
 * 暗色段用唯一合法选择器 `body[data-ds-dark-theme] ...`（见 dark.mjs 的三条"不许"）：
 * 这里刻意**只覆盖需要差异化的少数几处**，其余继承亮色值 —— 对应 196/207 的现实。
 */
export function baseStyleSheet() {
  const base = 'display: block; background: var(--guif-bg); color: var(--guif-text); border: 1px solid var(--guif-border);';
  return [
    `.${SCOPE_CLASS} { ${base} }`,
    `${DARK_SELECTOR} .${SCOPE_CLASS} { border-color: var(--guif-border-strong); }`,
    '.guif-empty { color: var(--guif-text-dim); }',
    '.guif-error { color: var(--guif-danger); }',
    '',
  ].join('\n');
}

/** 一份基础样式表的 lint 报告（本包自证：0 命中）。 */
export function lintBaseStyleSheet() {
  return lintTokenUsage(baseStyleSheet(), { context: createTokenContext(), source: 'baseStyleSheet' });
}

/**
 * 注入一张样式表（`<style data-guif-theme="gui-frame">`）。
 * 副作用经 `ctx.effect` 挂在调用方 fiber 上：卸载 ⇒ 标签移除。
 * 没有 DOM ⇒ 静默返回空 disposer（依赖缺失不激活、不报错）。
 * @param {object} ctx
 * @param {{css:string, document?:object, id?:string}} options
 * @returns {() => void}
 */
export function installStyleSheet(ctx, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('installStyleSheet(ctx, options) 需要在 Cordis ctx 上调用（清理要挂到调用方 fiber）');
  }
  const css = typeof options.css === 'string' ? options.css : '';
  const doc = 'document' in options ? options.document : (typeof document === 'undefined' ? undefined : document);
  if (doc === undefined || doc === null || typeof doc.createElement !== 'function') return () => {};
  const id = typeof options.id === 'string' ? options.id : 'gui-frame';
  return ctx.effect(() => {
    const element = doc.createElement(GUIF_STYLE_TAG);
    element.setAttribute(GUIF_STYLE_ATTRIBUTE, id);
    element.textContent = css;
    const parent = doc.head ?? doc.body ?? null;
    if (parent === null || typeof parent.appendChild !== 'function') return undefined;
    parent.appendChild(element);
    return () => {
      if (typeof element.remove === 'function') element.remove();
      else if (typeof parent.removeChild === 'function') parent.removeChild(element);
    };
  }, `gui-frame: theme style sheet ${id}`);
}

/**
 * 本文件只做「拼装 + 自检」，不重复判定私有/公开族：族判定与诊断码都在 `lint.mjs`（单一真源），
 * 组件作者写样式时调 `defineStyleSheet` / `lintTokenUsage` 即可拿到 `GUIF-W-THEME-PRIVATE-LEAK` 等告警。
 */
