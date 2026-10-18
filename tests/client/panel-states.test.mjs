/**
 * panel-states.test.mjs —— 独立复验（三）：**三态骨架与壳内自 catch**。
 *
 * 覆盖：
 *   - loading / 空 / 错三态**分别**可显式触发（`state` prop），并支持从 `useSessions()` 快照推导；
 *   - 壳组件**内部自 catch**：装配期抛错 ⇒ 就地渲染错误态（不是把页面交给官方 boundary 的空 div）、
 *     非法 state 不向外抛、`List` 单行 renderItem 抛错只影响那一行、
 *     内层 `GuiFrameRenderBoundary` 是**真 React 类组件**（`getDerivedStateFromError` + `isReactComponent`）。
 *
 * 本文件是**无 DOM** 的一层（元素树逐节点检查）；真 DOM 渲染在 `l4-real-react.test.mjs`。
 * 独立性：不 import `tests/unit/**` 与 `tests/helpers/**`。只读：不写包内任何文件。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { findByAttr, loadRealReact, loadSource, treeText } from './harness.mjs';

const react = await loadRealReact();
const { createPanelComponents } = await loadSource('client/panel/index.mjs');
const { createRenderBoundary, safeRender } = await loadSource('client/panel/boundary.mjs');
const { stateFromSessions, normalizeState, DEFAULT_LABELS } = await loadSource('client/panel/state.mjs');
const { createPrimitivesStub } = await import('./harness.mjs');
const primitives = createPrimitivesStub(react);
const comps = createPanelComponents({ seeds: { react, primitives } });
const { Panel, Toolbar, Empty, ErrorState, List, KeyValue } = comps;

test('三态分别可显式触发：loading / 空 / 错 各有 data-guif-state 锚点；推导路径同源', () => {
  // ① 显式 loading
  const loading = Panel({ id: 'p-loading', state: 'loading' });
  assert.equal(findByAttr(loading, 'data-guif-state', 'loading').length, 1, '显式 loading 必须渲染出 data-guif-state="loading"');
  assert.match(treeText(loading), new RegExp(DEFAULT_LABELS.loading), 'loading 态必须带可见文案');

  // ② 显式空态
  const empty = Panel({ id: 'p-empty', state: 'empty' });
  assert.equal(findByAttr(empty, 'data-guif-state', 'empty').length, 1, '显式空态必须渲染出 data-guif-state="empty"');
  assert.match(treeText(empty), new RegExp(DEFAULT_LABELS.empty));

  // ③ 显式错误态（带错因）
  const failure = Panel({ id: 'p-error', state: 'error', error: new Error('真机上会看到的错因') });
  assert.equal(findByAttr(failure, 'data-guif-state', 'error').length, 1, '显式错误态必须渲染出 data-guif-state="error"');
  assert.match(treeText(failure), /真机上会看到的错因/, '错误态必须把错因显示出来（不是空 div）');

  // ④ 三态互不串台：一次只出现一个 state 锚点
  for (const [state, tree] of [['loading', loading], ['empty', empty], ['error', failure]]) {
    const anchors = ['loading', 'empty', 'error'].filter((value) => findByAttr(tree, 'data-guif-state', value).length > 0);
    assert.deepEqual(anchors, [state], `${state} 态不该同时出现别的态锚点`);
  }

  // ⑤ 组件层各自也能显式触发（不是只有 Panel 能）
  assert.equal(findByAttr(Empty({}), 'data-guif-state', 'empty').length, 1, 'Empty 默认空态');
  assert.equal(findByAttr(Empty({ state: 'loading' }), 'data-guif-state', 'loading').length, 1, 'Empty 可以被要求显示 loading');
  assert.equal(findByAttr(ErrorState({ error: new Error('x') }), 'data-guif-state', 'error').length, 1, 'ErrorState 恒为错误态');
  assert.equal(findByAttr(List({ items: [] }), 'data-guif-state', 'empty').length, 1, 'List 空数组自动进空态');
  assert.equal(findByAttr(KeyValue({ entries: [] }), 'data-guif-state', 'empty').length, 1, 'KeyValue 无条目自动进空态');

  // ⑥ 推导路径：useSessions 快照 → stateFromSessions
  assert.equal(findByAttr(Panel({ id: 'd1', useSessions: () => ({ state: 'loading', items: [] }) }), 'data-guif-state', 'loading').length, 1);
  assert.equal(findByAttr(Panel({ id: 'd2', useSessions: () => ({ state: 'idle', items: [] }) }), 'data-guif-state', 'empty').length, 1);
  assert.equal(findByAttr(Panel({ id: 'd3', useSessions: () => ({ state: 'error', items: [{}] }) }), 'data-guif-state', 'error').length, 1);
  assert.equal(stateFromSessions(null), 'ready', '快照缺席 ⇒ ready（不许猜成 loading）');
  assert.equal(stateFromSessions({ state: 'idle', items: [{}] }), 'ready');

  // ⑦ 显式 state 优先于推导（显式说了就别猜）
  const explicit = Panel({ id: 'd4', state: 'empty', useSessions: () => ({ state: 'loading', items: [] }) });
  assert.equal(findByAttr(explicit, 'data-guif-state', 'empty').length, 1, '显式 state 必须压过推导');

  // ⑧ ready 时正常渲染 children（三态是「可选覆盖」，不是强制）
  const ready = Panel({
    id: 'd5',
    useSessions: () => ({ state: 'idle', items: [{}] }),
    children: react.createElement('b', null, '正文内容'),
  });
  assert.match(treeText(ready), /正文内容/);
  assert.equal(findByAttr(ready, 'data-guif-state', 'loading').length + findByAttr(ready, 'data-guif-state', 'empty').length + findByAttr(ready, 'data-guif-state', 'error').length, 0);
});

test('壳组件内部自 catch：装配期抛错就地渲染错误态；单行抛错不连坐；内层是真 React 错误边界', () => {
  // ① 外层 try/catch：用一个带 getter 的 style 制造**确定性**抛错（展开 props.style 时会调用 getter）
  const poisoned = {};
  Object.defineProperty(poisoned, 'poisoned', { enumerable: true, get() { throw new Error('装配期炸了-style-getter'); } });
  const outer = Panel({ id: 'p-outer', style: poisoned });
  assert.equal(findByAttr(outer, 'data-guif-state', 'error').length, 1, '装配期抛错必须就地渲染错误态');
  assert.match(treeText(outer), /装配期炸了-style-getter/, '错误态里必须带上错因');

  // ② 非法 state **不向外抛**（抛出去会被官方 boundary 换成空 div）
  let bad = null;
  assert.doesNotThrow(() => { bad = Panel({ id: 'p-bad', state: 'nonsense' }); });
  assert.equal(findByAttr(bad, 'data-guif-state', 'error').length, 1, '非法 state ⇒ 就地渲染错误态');
  assert.match(treeText(bad), /state 必须是/, '必须把「错在哪」显示出来');
  assert.throws(() => normalizeState('nonsense'), (error) => error?.code === 'GUIF-E-COMPONENT-INVALID', '纯函数层仍然显式抛（组件层才吞）');

  // ③ List 单行 renderItem 抛错 ⇒ 只影响那一行
  const list = List({
    items: [1, 2, 3],
    renderItem: (item) => {
      if (item === 2) throw new Error('单行炸了-row-boom');
      return `ok-${item}`;
    },
  });
  const text = treeText(list);
  assert.match(text, /ok-1/, '没抛错的行必须照常渲染');
  assert.match(text, /ok-3/, '抛错行之后的行也必须照常渲染');
  assert.match(text, /单行炸了-row-boom/, '抛错的那一行必须显示错因（不是把原始 item 当文案）');
  assert.equal(findByAttr(list, 'data-guif-row', '1').length, 1, '三行都该在树里');

  // ④ renderItem 整个缺席 ⇒ 退化成 item 的可读文案（不抛）
  assert.doesNotThrow(() => List({ items: [{ a: 1 }] }));

  // ⑤ 内层错误边界：**真 React 类组件**（否则 React 会把它当函数组件调，静默失效）
  const Boundary = createRenderBoundary(react);
  assert.equal(Boundary.prototype instanceof react.Component, true, '边界必须继承真 react.Component');
  assert.equal(Boolean(Boundary.prototype.isReactComponent), true, 'React 靠 isReactComponent 判定类组件');
  assert.equal(typeof Boundary.getDerivedStateFromError, 'function', '必须能接住子树渲染抛错');
  const derived = Boundary.getDerivedStateFromError(new Error('子树炸了-child-boom'));
  assert.equal(derived.failed, true);
  assert.equal(derived.error.message, '子树炸了-child-boom');

  // 无 DOM 地把实例的 render 当纯函数调：失败态 ⇒ renderError；未失败 ⇒ children
  const instance = Object.create(Boundary.prototype);
  instance.props = { renderError: (error) => ErrorState({ error }), children: 'child' };
  instance.__reset = () => {};
  instance.state = derived;
  const failedTree = instance.render();
  assert.equal(findByAttr(failedTree, 'data-guif-state', 'error').length, 1, '边界失败态必须渲染壳自己的错误态');
  assert.match(treeText(failedTree), /子树炸了-child-boom/);
  instance.state = { failed: false, error: null };
  assert.equal(instance.render(), 'child', '未失败时透传子树');

  // ⑥ safeRender：渲染期调用的回调抛错 ⇒ 返回兜底值并上报（不冒到 React）
  const seen = [];
  assert.equal(safeRender(() => { throw new Error('cb'); }, 'fallback', (error) => seen.push(error.message)), 'fallback');
  assert.deepEqual(seen, ['cb']);
  assert.equal(safeRender(() => 'ok', 'fallback'), 'ok');
  assert.doesNotThrow(() => safeRender(() => { throw new Error('x'); }, null, () => { throw new Error('上报也炸'); }), '上报抛错不得连坐');

  // ⑦ 壳内自 catch 会上报诊断（码取冻结集合里的 GUIF-W-LISTENER-THREW）
  const notes = [];
  const set = createPanelComponents({ seeds: { react, primitives }, note: (code, message) => notes.push({ code, message }) });
  set.List({ items: [1], renderItem: () => { throw new Error('上报给我'); } });
  assert.ok(notes.some((row) => row.code === 'GUIF-W-LISTENER-THREW'), `壳内吞错必须留诊断（实际：${JSON.stringify(notes)}）`);
  assert.match(notes.map((row) => row.message).join('｜'), /上报给我/, '诊断里要带错因');
});
