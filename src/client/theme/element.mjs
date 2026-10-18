/**
 * element.mjs —— **自带 token 的作用域组件**（组件**没有 JSX**，只认 `env.seeds.react.createElement`）。
 *
 * 为什么要有它：自研打包器（scripts/build-client.mjs）**只重写 import/export，不做 JSX/TS 变换**，
 * 所以客户端组件一律 `env.seeds.react.createElement(...)`（README 硬约束）。
 * 写 JSX 的失败形态是构建期的「产物语法错」，报错不会明说是 JSX —— 这里给组件作者一个
 * **可复制的正确样例**，并让"组件自带 token"落到结构上：作用域根节点一次性把 `--guif-*`
 * 映射到外壳 token（`SCOPE_VAR_MAP`），子组件样式就只剩 `var(--guif-*)` 可写。
 *
 * 本文件不碰全局：`react` 由 `env.seeds` 传入（种子没有第二条路）；缺 react ⇒ 构造时抛 `TypeError`。
 */

import { SCOPE_CLASS, SCOPE_VAR_MAP } from './styles.mjs';
import { DARK_ATTRIBUTE } from './dark.mjs';

/** 作用域根节点上的归属属性（真机断言用）。 */
export const THEME_SCOPE_ATTRIBUTE = 'data-guif-theme';
/** 缺省作用域名。 */
export const DEFAULT_SCOPE_NAME = 'gui-frame';

/**
 * 造一个**作用域组件**：`createThemeScope(env)` ⇒ `(props) => element`。
 * props：`{ scope?, className?, style?, id?, children }` —— 只有这四个（多一个都会泄漏内部实现）。
 * 组件渲染出的根节点带 `class="guif-theme-scope …"`、`data-guif-theme="<scope>"`
 * 与 `style` 里的 `--guif-*` 变量（内联变量优先级最高，正是"作用域"该有的语义）。
 *
 * @param {{seeds?:{react?:object}}} env 装配环境（`install(ctx, env)` 的 env）
 * @returns {(props:object) => object} React 元素（由调用方放进自己的树里）
 */
export function createThemeScope(env) {
  const react = env === null || env === undefined ? undefined : env.seeds?.react;
  if (react === null || react === undefined || typeof react.createElement !== 'function') {
    throw new TypeError('createThemeScope(env) 需要 env.seeds.react.createElement（打包器不做 JSX 变换，种子没有第二条路）');
  }
  /** 作用域根：只做三件事 —— 类名、归属属性、把公开变量绑到外壳 token。 */
  function GuifThemeScope(props) {
    const given = props === null || props === undefined ? {} : props;
    const className = given.className === undefined || given.className === null || given.className === ''
      ? SCOPE_CLASS
      : `${SCOPE_CLASS} ${given.className}`;
    const scope = typeof given.scope === 'string' && given.scope !== '' ? given.scope : DEFAULT_SCOPE_NAME;
    const attributes = {
      className,
      [THEME_SCOPE_ATTRIBUTE]: scope,
      style: { ...SCOPE_VAR_MAP, ...(given.style ?? {}) },
    };
    if (typeof given.id === 'string' && given.id !== '') attributes.id = given.id;
    return react.createElement('div', attributes, given.children);
  }
  /** 便于测试与真机断言：组件名与它依赖的载体属性。 */
  GuifThemeScope.displayName = 'GuifThemeScope';
  return GuifThemeScope;
}

/** 组件侧"暗色怎么读"的统一入口（只认 body 的属性，见 dark.mjs）；这里只导出属性名，避免二次实现。 */
export const SCOPE_DARK_ATTRIBUTE = DARK_ATTRIBUTE;
