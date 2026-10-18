/**
 * l4-real-react.test.mjs —— 独立复验（五）：**L4 真 React 渲染**（dev-only `jsdom` + `@testing-library/react`）。
 *
 * 证明壳组件在**真 React + 真 DOM** 下能渲染三态与错误态 ——
 *   - 六态渲染：显式 loading / 空 / 错 + 从真 hook 推导 + ready 透传 children；
 *   - **错误态是壳组件自己接住的**：子树在渲染期抛错 ⇒ 壳内的 `GuiFrameRenderBoundary`
 *     （真 `react.Component` 子类）接住并渲染 GUIFrame 自己的错误态，而不是官方那个空 div；
 *   - 真 DOM 事件：`Toolbar` 的 action 点击会调到 `onSelect`，`ErrorState` 的重试同理。
 *
 * 为什么这条必须存在：`tests/unit/**` 的 L2 层用的是自研 React 替身，
 * 「在真 React 下还能不能成立」此前没有机械证据路径。
 *
 * 环境：jsdom 只装进 `globalThis`（本文件自己 `close()`），**不改包内任何文件**。
 *
 * 【错误态为什么必须由壳自己接住】子树渲染期抛错 ⇒ 整个面板树被卸载、DOM 全空 ⇒ 真机由官方
 * `SlotErrorBoundary` 兜成一个空 div。`errorProps` 收口 + 边界三层保险 + fallback 输出再包一层
 * 同类边界，就是为此。结案记录在 `tests/client/` 目录里（`结案记录-*.md`）。
 */
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';

import { createPrimitivesStub, installDom, loadRealReact, loadSource } from './harness.mjs';

// ① 先装真 DOM，再加载 react / RTL（它们构造时会读 document）
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
installDom(dom);

const react = await loadRealReact();
const { cleanup, fireEvent, render } = await import('@testing-library/react');
const { createPanelComponents } = await loadSource('client/panel/index.mjs');

const primitives = createPrimitivesStub(react);
const notes = [];
const comps = createPanelComponents({ seeds: { react, primitives }, note: (code, message) => notes.push({ code, message }) });
const { ErrorState, KeyValue, List, Panel, Toolbar } = comps;

afterEach(() => cleanup());
after(() => dom.window.close());

const anchor = (container, value) => container.querySelector(`[data-guif-state="${value}"]`);

test('真 React：三态各自在真 DOM 里渲染出 data-guif-state 锚点与可见文案', () => {
  const loading = render(react.createElement(Panel, { id: 'p-loading', state: 'loading' }));
  const loadingNode = anchor(loading.container, 'loading');
  assert.ok(loadingNode, 'loading 态必须在真 DOM 里出现');
  assert.match(loadingNode.textContent, /加载中/, 'loading 文案必须可见');
  assert.equal(anchor(loading.container, 'empty'), null, '不该同时出现别的态');
  cleanup();

  const empty = render(react.createElement(Panel, { id: 'p-empty', state: 'empty' }));
  assert.ok(anchor(empty.container, 'empty'), '空态必须在真 DOM 里出现');
  cleanup();

  const failure = render(react.createElement(Panel, { id: 'p-error', state: 'error', error: new Error('L4-错态文案') }));
  const errorNode = anchor(failure.container, 'error');
  assert.ok(errorNode, '错误态必须在真 DOM 里出现');
  assert.match(errorNode.textContent, /L4-错态文案/, '错误态必须把错因渲染出来（不是空 div）');

  // 壳的骨架锚点也都要在（header / body / status 三段）
  assert.ok(failure.container.querySelector('[data-guif-panel="p-error"]'), 'panel 根锚点');
  assert.ok(failure.container.querySelector('[data-guif-panel-header="p-error"]'), 'header 锚点');
  assert.ok(failure.container.querySelector('[data-guif-panel-body="p-error"]'), 'body 锚点');
  assert.ok(failure.container.querySelector('[data-guif-panel-status="p-error"]'), 'status 锚点');
});

test('真 React：从**真 hook** 推导三态（hook 注入路径），ready 时透传 children', () => {
  const usePanelInfo = () => react.useState({ activePanelId: 'p-hook' })[0];
  const makeSessions = (snapshot) => function useSessions(selector) {
    const [value] = react.useState(snapshot);
    return typeof selector === 'function' ? selector(value) : value;
  };

  const loading = render(react.createElement(Panel, { id: 'p-hook', usePanelInfo, useSessions: makeSessions({ state: 'loading', items: [] }) }));
  assert.ok(anchor(loading.container, 'loading'), 'hook 快照 state=loading ⇒ loading 态');
  assert.equal(loading.container.querySelector('[data-guif-active]')?.getAttribute('data-guif-active'), 'true', 'activePanelId 命中时必须标 true');
  cleanup();

  const empty = render(react.createElement(Panel, { id: 'p-hook', usePanelInfo, useSessions: makeSessions({ state: 'idle', items: [] }) }));
  assert.ok(anchor(empty.container, 'empty'), 'hook 快照 idle+空 items ⇒ 空态');
  cleanup();

  const ready = render(react.createElement(Panel, { id: 'p-hook', usePanelInfo, useSessions: makeSessions({ state: 'idle', items: [{}] }) },
    react.createElement('b', { 'data-testid': 'body' }, '正文')));
  assert.match(ready.container.textContent, /正文/, 'ready 态必须把 children 渲染进真 DOM');
  assert.equal(anchor(ready.container, 'loading'), null);
  assert.equal(ready.container.querySelector('[data-guif-sessions-count]')?.getAttribute('data-guif-sessions-count'), '1', '会话数取自快照 items');
});

test('真 React 错误边界：子树渲染抛错 ⇒ 壳自己接住并渲染错误态（不是官方空 div）', () => {
  function Boom() {
    throw new Error('L4-子树渲染炸了');
  }
  const before = notes.length;
  const stderr = [];
  const original = console.error;
  console.error = (...args) => stderr.push(args); // React 自己也会打日志，这里只用来证明「不是静默空白」
  let tree = null;
  let escaped = null;
  try {
    tree = render(react.createElement(Panel, { id: 'p-boom' }, react.createElement(Boom)));
  } catch (error) {
    escaped = error;
  } finally {
    console.error = original;
  }
  const node = tree === null ? null : anchor(tree.container, 'error');
  assert.ok(
    node !== null,
    '真 React 下子树抛错必须由**壳内边界**接住并渲染 GUIFrame 自己的错误态；实测：'
    + (escaped !== null
      ? `错误逃逸出渲染（${escaped.message}）⇒ React 报为 uncaught、整棵树被卸载（真机上是空白面板）`
      : `树里没有 data-guif-state="error" 锚点（DOM 文本：${JSON.stringify(tree?.container.textContent ?? '')}）`),
  );
  assert.match(node.textContent, /L4-子树渲染炸了/, '错误态里必须有错因');
  assert.ok(tree.container.textContent.trim().length > 0, '绝不能是空白（官方 boundary 只给空 div，那正是要消灭的现象）');
  assert.ok(
    notes.slice(before).some((row) => row.code === 'GUIF-W-LISTENER-THREW' && /L4-子树渲染炸了/.test(row.message)),
    '边界捕获必须走壳内的诊断上报（GUIF-W-LISTENER-THREW）',
  );
  assert.ok(stderr.length >= 1, 'React 自身也会报错 —— 说明我们既没吞掉错误、也没让它冒成白屏');
});

test('真 React：List 单行抛错只影响那一行；Toolbar / ErrorState 的按钮真能被点', () => {
  const list = render(react.createElement(List, {
    items: [1, 2, 3],
    renderItem: (item) => {
      if (item === 2) throw new Error('L4-单行炸了');
      return `行-${item}`;
    },
  }));
  assert.match(list.container.textContent, /行-1/, '没抛错的行照常渲染');
  assert.match(list.container.textContent, /行-3/, '抛错行后面的行也照常渲染');
  assert.match(list.container.textContent, /L4-单行炸了/, '抛错行显示错因');
  assert.equal(list.container.querySelectorAll('[data-guif-row]').length, 3, '三行都在 DOM 里');
  cleanup();

  const clicks = [];
  const toolbar = render(react.createElement(Toolbar, {
    id: 'tb',
    items: [{ id: 'refresh', label: '刷新', onSelect: (id) => clicks.push(id) }],
  }));
  const button = toolbar.container.querySelector('[data-guif-action="refresh"]');
  assert.ok(button, 'action 按钮必须渲染出来（带 data-guif-action 锚点）');
  fireEvent.click(button);
  assert.deepEqual(clicks, ['refresh'], '真 DOM 点击必须调到 onSelect（参数是 action id）');
  cleanup();

  const retries = [];
  const failure = render(react.createElement(ErrorState, { error: new Error('L4-重试'), onRetry: () => retries.push('retry') }));
  const retryButton = failure.container.querySelector('[data-guif-action="retry"]');
  assert.ok(retryButton, 'ErrorState 的重试按钮必须渲染出来');
  fireEvent.click(retryButton);
  assert.deepEqual(retries, ['retry'], '重试按钮必须真的能点');
  cleanup();

  const kv = render(react.createElement(KeyValue, { entries: [['panellist 条目', '2'], ['main 条目', '1']] }));
  assert.equal(kv.container.querySelectorAll('dt').length, 2, 'KeyValue 必须渲染 dt/dd 对');
  assert.equal(kv.container.querySelectorAll('dd').length, 2);
  assert.match(kv.container.textContent, /panellist 条目/);
});
