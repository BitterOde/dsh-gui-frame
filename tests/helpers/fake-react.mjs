/**
 * fake-react.mjs —— 极简 react 替身 + 元素树断言工具（测试层无 DOM；家族同形，L0/L3 层）。
 *
 * 目的：让客户端半区的**纯函数组件**在 Node 里产出元素树，从而对结构（元素类型、属性、文案、
 * 无障碍名）做断言，不必起浏览器。不实现 reconcile：挂钩子只给最小但**不撒谎**的语义 ——
 *   - `useState` 按 hook 游标持久化，setter 支持函数式更新；
 *   - `useEffect` 收集、由 `__runEffects()` 手动跑（「首帧 → 跑 effect → 数据回来后的第二帧」可复现）；
 *   - `useMemo` / `useCallback` 带依赖数组比较（依赖变了才重算）。
 * 同一份替身被 **构建期行为校验**（scripts/build-client.mjs 的 loadArtifact）与**单测**共用，
 * 避免两处替身漂移。
 *
 * ⚠ L4（真 React 渲染）不走本替身：那条用 devDependencies 里的 jsdom + @testing-library/react。
 */

function flattenChildren(children) {
  const out = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flattenChildren(child));
    else if (child !== null && child !== undefined && child !== false) out.push(child);
  }
  return out;
}

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

/** 建一个假 react。返回的面与真 react 同名，另加 `__` 前缀的测试钩子。 */
export function createFakeReact() {
  const states = [];
  const effects = [];
  const memos = [];
  let cursor = 0;
  return {
    __states: states,
    __effects: effects,
    __memos: memos,
    /** 每个组件函数调用前重置 hook 游标（模拟"单次渲染"）。 */
    __resetHooks() {
      cursor = 0;
    },
    /** 跑一遍本帧收集到的 effect（React 挂载语义；返回跑了几个）。 */
    __runEffects() {
      const pending = effects.splice(0);
      for (const fn of pending) fn();
      return pending.length;
    },
    createElement(type, props, ...children) {
      return {
        $$typeof: 'element',
        type,
        key: props?.key ?? null,
        props: { ...(props ?? {}), children: flattenChildren(children) },
      };
    },
    useState(init) {
      const index = cursor;
      cursor += 1;
      if (states[index] === undefined) states[index] = typeof init === 'function' ? init() : init;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(fn) {
      effects.push(fn);
    },
    useRef(init) {
      const index = cursor;
      cursor += 1;
      if (memos[index] === undefined) memos[index] = { kind: 'ref', value: { current: init } };
      return memos[index].value;
    },
    useMemo(fn, deps) {
      const index = cursor;
      cursor += 1;
      const slot = memos[index];
      if (slot === undefined || slot.kind !== 'memo' || !sameDeps(slot.deps, deps)) {
        memos[index] = { kind: 'memo', deps, value: fn() };
      }
      return memos[index].value;
    },
    useCallback(fn, deps) {
      const index = cursor;
      cursor += 1;
      const slot = memos[index];
      if (slot === undefined || slot.kind !== 'callback' || !sameDeps(slot.deps, deps)) {
        memos[index] = { kind: 'callback', deps, value: fn };
      }
      return memos[index].value;
    },
  };
}

export function isElement(node) {
  return Boolean(node) && typeof node === 'object' && node.$$typeof === 'element';
}

/**
 * 是不是 **ES class 组件**（真 React 的判据：原型上有 `render`）。
 * 为什么需要它：本包的面板错误边界 `GuiFrameRenderBoundary` 是**类**（`boundary.mjs`），
 * 而早先的遍历器对 `typeof node.type === 'function'` 一律 `type(props)` 直接调用 ⇒
 * `TypeError: Class constructor … cannot be invoked without 'new'`。
 * 这是**替身的缺陷**，不是被测代码的问题（真 React 会用 `new` 实例化类组件）。
 */
export function isClassComponent(type) {
  return typeof type === 'function' && type.prototype !== undefined && type.prototype !== null && typeof type.prototype.render === 'function';
}

/**
 * 按**真 React 的类组件语义**渲染一次元素：`new type(props)` → `instance.render()`。
 * 实例化或 `render()` 抛错时**退化为遍历 `props.children`** —— 这是**兜底**（仍然把子树走完），
 * **不是**「把边界当不透明节点跳过」：类元素本身照样先被 `visit` 到，只是它的产出取不到时改走 children。
 * 函数组件照旧直接调用（本项目的展示组件都是纯函数）。
 */
function renderTypeOnce(type, props) {
  if (!isClassComponent(type)) return type(props);
  try {
    const instance = new type(props);
    if (instance.props === undefined || instance.props === null) instance.props = props; // 真 React 会注入 props
    return instance.render();
  } catch (error) {
    return props !== null && props !== undefined ? (props.children ?? null) : null;
  }
}

/**
 * 深度优先遍历（含根）。遇到函数组件/类组件就按渲染器的方式渲染一次，再遍历其产出。
 * @param {*} node 元素 / 元素数组 / 其它值
 * @param {(node:object, parents:object[])=>void} visit
 */
export function walkElements(node, visit, parents = []) {
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visit, parents);
    return;
  }
  if (!isElement(node)) return;
  visit(node, parents);
  if (typeof node.type === 'function') {
    walkElements(renderTypeOnce(node.type, node.props), visit, [...parents, node]);
    return;
  }
  for (const child of node.props?.children ?? []) walkElements(child, visit, [...parents, node]);
}

/** 命中全部满足 predicate 的元素（含函数组件展开后的产物）。 */
export function findAll(node, predicate) {
  const hits = [];
  walkElements(node, (candidate, parents) => {
    if (predicate(candidate, parents)) hits.push(candidate);
  });
  return hits;
}

/** 按元素类型找（字符串标签或组件函数）。 */
export function findByType(node, type) {
  return findAll(node, (candidate) => candidate.type === type);
}

/** 按属性找：`findByAttr(tree, 'title', '注入技能')`；只给 key 时找"有该属性"的元素。 */
export function findByAttr(node, key, value) {
  return findAll(node, (candidate) => (value === undefined
    ? candidate.props?.[key] !== undefined
    : String(candidate.props?.[key] ?? '') === String(value)));
}

/** 文本汇总（文案存在性断言）；同样展开函数组件、**类组件**与嵌套数组。 */
export function textOf(node) {
  const parts = [];
  const visit = (current) => {
    if (typeof current === 'string' || typeof current === 'number') {
      parts.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!isElement(current)) return;
    if (typeof current.type === 'function') {
      visit(renderTypeOnce(current.type, current.props));
      return;
    }
    for (const child of current.props?.children ?? []) visit(child);
  };
  visit(node);
  return parts.join('');
}

/** 元素类型名集合（结构断言用）。 */
export function typesOf(node) {
  const out = [];
  walkElements(node, (candidate) => out.push(typeof candidate.type === 'string' ? candidate.type : (candidate.type?.name ?? 'component')));
  return out;
}

/** 在（唯一）匹配元素上触发事件；找不到或命中多个 ⇒ 抛错，避免"静默不触发"的假绿。 */
export function fire(node, predicate, eventName, event = {}) {
  const hits = findAll(node, predicate);
  if (hits.length !== 1) throw new Error(`fire 期望命中 1 个元素，实际 ${hits.length}`);
  const handler = hits[0].props?.[eventName];
  if (typeof handler !== 'function') throw new Error(`fire 命中的元素没有 ${eventName} 处理器`);
  return handler(event);
}

/** 渲染一帧：重置 hook 游标 → 调用组件函数 → 返回元素树。 */
export function renderComponent(react, Component, props = {}) {
  react.__resetHooks();
  return Component(props);
}
