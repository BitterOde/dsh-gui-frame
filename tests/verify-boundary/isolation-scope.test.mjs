/**
 * isolation-scope.test.mjs —— 崩溃隔离面的**范围钉桩**。
 *
 * ⚠ **这不是放宽判据**：这些桩曾经记的是**缺陷现状**（逃逸 = 要消灭的空 div 现象）；
 * 收紧是把判据对齐到「缺陷已修」的**更强**要求。强度只增不减：
 *   旧桩：`assert.equal(escaped, true)`（记录缺陷）；
 *   现桩：`escaped === false` **且** 渲染出含抛错消息的错误态 **且** 不落兜底节点。
 */
/*
 * ═══ 值槽这一处的来历 ═══
 * `KeyValue` 的 `entries` **值槽**（`entries={[['k', <元素/>]]}` / `{key, value:<元素/>}`）曾经没有走
 * `guardSlot`，放一个渲染期抛错的元素进去会逃逸（`escaped=true`、DOM 全空）；实现自己的
 * `renderable()` 注释写着「字符串/数字/**元素**都合法」⇒ 同类缺口、契约内用法。
 * 收口后，本文件原来的缺口桩（断言 `escaped === true`）改成了下面那条「必须被接住」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHOR,
  createPrimitivesStub,
  escaped,
  loadReact,
  loadSource,
  mountNode,
  setupDom,
} from './harness.mjs';

await setupDom();
const react = await loadReact();
const el = react.createElement;
const { createPanelComponents } = await loadSource('client/panel/index.mjs');
const comps = createPanelComponents({
  seeds: { react, primitives: createPrimitivesStub(react) },
  note: () => {},
});

function Boom() {
  throw new Error('SCOPE-BOOM');
}

const ERROR_SELECTOR = `[${ANCHOR.state}="${ANCHOR.errorState}"]`;
const MINIMAL_SELECTOR = `[${ANCHOR.boundary}="${ANCHOR.minimal}"]`;

/** 断言「被接住」：不逃逸 + 有含抛错消息的错误态 + 不落兜底节点。 */
function assertCaught(result, label) {
  const escape = escaped(result);
  assert.equal(escape.escaped, false, `${label} 发生逃逸：${JSON.stringify(escape)}`);
  const nodes = result.queryAll(ERROR_SELECTOR);
  assert.ok(nodes.length > 0, `${label} 没有渲染出错误态节点`);
  const text = nodes.map((node) => node.textContent).join(' | ');
  assert.ok(text.includes('SCOPE-BOOM'), `${label} 的错误态没有文案/不含抛错消息：${JSON.stringify(text)}`);
  assert.equal(result.query(MINIMAL_SELECTOR), null, `${label} 落到了兜底节点（说明 fallback 自己又炸了一次）`);
}

test('正对照：同一抛错子树放进 Panel 的 children ⇒ 被壳接住（隔离面存在）', async () => {
  const result = await mountNode(react, el(comps.Panel, { id: 'scope-inside' }, el(Boom)));
  assertCaught(result, 'Panel.children');
});

test('`Panel.actions` 槽子元素抛错 ⇒ 必须被接住（未收口时实测逃逸）', async () => {
  const result = await mountNode(react, el(comps.Panel, { id: 'scope-actions', actions: el(Boom) }));
  assertCaught(result, 'Panel.actions');
});

test('`Toolbar` 独立使用（无 Panel 包裹）子节点抛错 ⇒ 必须被接住（未收口时实测逃逸）', async () => {
  const result = await mountNode(react, el(comps.Toolbar, { id: 'scope-toolbar' }, el(Boom)));
  assertCaught(result, '独立 Toolbar.children');
});

test('`List` 独立使用且行内组件抛错 ⇒ 必须被接住（未收口时实测逃逸）', async () => {
  const result = await mountNode(
    react,
    el(comps.List, { id: 'scope-list', items: [{ id: 'r1' }], renderItem: (item) => el(Boom, { key: item.id }) }),
  );
  assertCaught(result, '独立 List.renderItem 返回组件');
});

test('`KeyValue` 的 entries **值槽**（元素值）抛错 ⇒ 必须被接住（收口前实测逃逸）', async () => {
  // 两种 entries 形态都测：元组式 [key, value] 与对象式 { key, value }
  const tuple = await mountNode(react, el(comps.KeyValue, { entries: [['k', el(Boom)]] }));
  assertCaught(tuple, 'KeyValue 值槽（元组式）');
  const object = await mountNode(react, el(comps.KeyValue, { entries: [{ key: 'k', value: el(Boom) }] }));
  assertCaught(object, 'KeyValue 值槽（对象式）');
});

test('负控：`KeyValue` 的纯数据值（字符串/数字）**不得**被套边界（不过度扩面）', async () => {
  const result = await mountNode(react, el(comps.KeyValue, { entries: [['s', '字符串'], ['n', 42], ['b', true]] }));
  const escape = escaped(result);
  assert.equal(escape.escaped, false, `纯数据表发生异常：${JSON.stringify(escape)}`);
  assert.equal(result.query(ERROR_SELECTOR), null, '纯数据值被当成了渲染错误（过度扩面）');
  assert.ok(result.text.includes('字符串') && result.text.includes('42'), `纯数据值没渲染出来：${JSON.stringify(result.text)}`);
});
