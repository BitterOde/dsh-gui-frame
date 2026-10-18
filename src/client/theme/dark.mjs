/**
 * dark.mjs —— **暗色判据与监听**（探针 P4 的深色载体结论）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【唯一判据：`body[data-ds-dark-theme]`】—— 三条"不许"都是实测踩出来的
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 探针 P4 实读外壳产物：`ThemePresenter.apply` 按 `active.colorScheme` 往 `document.body` 写
 * `data-ds-dark-theme` 属性，其源码注释原文是 **「never the id — system is resolved upstream」**。
 * 于是：
 *  ① **不认 theme id**：主题 id 是 `light` / `dark` / `system` 之类，但 `system` 的真值只有外壳知道，
 *     插件按 id 判会在 `system` 上判错；`apply` 已经把 system 解析掉了，属性才是解析后的**结果**；
 *  ② **不认 `prefers-color-scheme`**：它只表示"系统偏好"，而用户可以在 UI 里覆盖成与系统相反的方案；
 *     用它判色会与外壳自身渲染的明暗相反（这也是官方注释那句 "resolved upstream" 的反面）；
 *  ③ **不认 `documentElement` 上的颜色**：`ThemePresenter` 只写 `body` 的属性
 *     （`documentElement.style.colorScheme` 是另一件事，boot 脚本会写，但它不承载"当前是否暗色"）。
 * 插件树激活前，宿主半区的 boot 脚本也会写同一语义的属性 —— 所以「属性存在」在两段时间线上都成立。
 *
 * 判据是**属性有无**，不是属性值（`data-ds-dark-theme=""` 也算暗色）——`hasAttribute` 而非 `getAttribute`。
 *
 * 本文件不碰全局：所有 DOM 都从参数进来（缺省才回落到 `globalThis.document`），
 * 因此 L0/L3 层可以用假 document 单测（模块体不得读全局）。
 */

/** 暗色载体属性（外壳 `ThemePresenter.apply` 写的那个）。 */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme';
/** 唯一合法的暗色选择器（CSS 侧只允许写它）。 */
export const DARK_SELECTOR = `body[${DARK_ATTRIBUTE}]`;
/** 取值：**没有**该属性（不是"另一个属性"）。 */
export const LIGHT_SCHEME = 'light';
/** 暗色。 */
export const DARK_SCHEME = 'dark';

/**
 * 取当前 document：支持三种形态 —— `{ document }` 选项袋、直接传一个 document、什么都不传（回落全局）。
 * ⚠ 本文件**不列**"禁止的判据字符串"（如系统偏好查询/主题 id）—— 那会把禁词写进产品源码，
 * 而源码扫描恰恰要拦住它们。禁词表在测试侧。
 */
function resolveDocument(options) {
  if (options === null || options === undefined) return typeof document === 'undefined' ? undefined : document;
  if (typeof options !== 'object') return undefined;
  if ('document' in options) return options.document;
  if ('body' in options) return options;
  return undefined;
}

/**
 * 当前配色方案。**只认 `body` 上的属性**。
 * 读不到 body（树还没挂载 / 没有 DOM）⇒ 返回 `light`：保守选择，
 * 与外壳 boot 前的默认一致（`ThemePresenter` 在写入暗色属性前，页面就是亮色）。
 * @param {{document?:object|null}|object|null} [options] 选项袋，或直接传一个 document 对象
 * @returns {'light'|'dark'}
 */
export function currentScheme(options) {
  const doc = resolveDocument(options);
  if (doc === undefined || doc === null) return LIGHT_SCHEME;
  const body = doc.body;
  if (body === undefined || body === null) return LIGHT_SCHEME;
  if (typeof body.hasAttribute !== 'function') return LIGHT_SCHEME;
  return body.hasAttribute(DARK_ATTRIBUTE) ? DARK_SCHEME : LIGHT_SCHEME;
}

/** 现在是不是暗色（`currentScheme(...) === 'dark'`）。 */
export function isDark(options) {
  return currentScheme(options) === DARK_SCHEME;
}

/**
 * 监听方案变化（**只观察 body 的属性**，不问系统偏好）。
 * 副作用经 `ctx.effect(...)` 挂到调用方 fiber 上：卸载 ⇒ observer 断开、监听器摘除。
 *
 * @param {object} ctx Cordis ctx（必须有 `effect`）
 * @param {(scheme:'light'|'dark', previous:'light'|'dark') => void} listener 仅在**变化**时调用
 * @param {{document?:object, MutationObserverImpl?:Function, target?:object}} [options]
 * @returns {() => void} 幂等 disposer
 */
export function watchScheme(ctx, listener, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('watchScheme(ctx, listener) 需要在 Cordis ctx 上调用（清理要挂到调用方 fiber）');
  }
  if (typeof listener !== 'function') throw new TypeError('watchScheme(ctx, listener) 的 listener 必须是函数');
  const doc = resolveDocument(options);
  const Observer = options.MutationObserverImpl ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver);
  const target = options.target ?? (doc === undefined || doc === null ? undefined : doc.body);
  if (target === undefined || target === null || typeof Observer !== 'function') {
    // 没 DOM / 没 observer ⇒ 静默不激活（依赖缺失不报错、不影响页面）。
    return () => {};
  }
  let last = currentScheme({ document: doc });
  return ctx.effect(() => {
    const observer = new Observer(() => {
      const next = currentScheme({ document: doc });
      if (next === last) return;
      const previous = last;
      last = next;
      listener(next, previous);
    });
    observer.observe(target, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
    return () => {
      if (typeof observer.disconnect === 'function') observer.disconnect();
    };
  }, 'gui-frame: theme dark watch');
}

/** 一次性的读取 + 监听组合（组件作者最常用的形状）。 */
export function schemeSnapshot(options) {
  const scheme = currentScheme(options);
  return { scheme, isDark: scheme === DARK_SCHEME, attribute: DARK_ATTRIBUTE, selector: DARK_SELECTOR };
}
