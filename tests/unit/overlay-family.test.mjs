/**
 * overlay-family.test.mjs —— **弹层族复用官方原子**门禁。
 *
 * 判据：Dialog → `Modal`、Popover → `Menu`、Tooltip → `Tooltip`、HoverCard → `HoverCard`，
 * GUIFrame 只补「组合与行为约定」，**不重画外观、不重复造原子**；原子缺失时退化成不渲染 + 记账，绝不抛。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { FAMILY_ATOMS, createFamily, isModalFamily, resolveAtom } from '../../src/client/overlay/family.mjs';
import { createRecorderPrimitives, renderElement } from './window-harness.mjs';

/** 只够记录 createElement 的最小 React 替身。 */
function createElementRecorder() {
  return {
    createElement(type, props, children) {
      return { type, props, children };
    },
  };
}

test('族 → 官方原子映射是冻结单点真源', () => {
  assert.deepEqual({ ...FAMILY_ATOMS }, {
    dialog: 'Modal',
    popover: 'Menu',
    tooltip: 'Tooltip',
    hoverCard: 'HoverCard',
    toast: 'Toast',
  });
  assert.equal(isModalFamily('dialog'), true, '只有 Dialog 是模态（模态才锁 body）');
  assert.equal(isModalFamily('floating'), false);
  assert.equal(isModalFamily('popover'), false);
  assert.equal(isModalFamily('toast'), false);
});

test('Dialog / Popover / Tooltip / HoverCard 都走官方原子（有使用记录为证）', () => {
  const react = createElementRecorder();
  const { primitives, used, calls } = createRecorderPrimitives(react);
  const family = createFamily(react, primitives);

  const dialogNode = family.Dialog({ open: true, title: '标题', children: '内容' });
  const popoverNode = family.Popover({ open: true, anchor: {}, items: [{ id: 'a', label: 'A' }] });
  const tooltipNode = family.Tooltip({ label: '提示', children: '裸文本' });
  const hoverNode = family.HoverCard({ anchor: {}, content: '卡片' });
  // `createElement(Component, …)` 只造元素 —— 官方原子要等 React 渲染时才被调用
  for (const node of [dialogNode, popoverNode, tooltipNode, hoverNode]) renderElement(node);

  assert.deepEqual(used(), ['Modal', 'Menu', 'Tooltip', 'HoverCard'], '四个族各自复用官方原子');
  const dialogProps = calls[0].props;
  assert.equal(dialogProps.open, true);
  assert.equal(dialogProps.title, '标题');
  assert.equal(typeof dialogProps.onClose, 'undefined');

  assert.equal(tooltipNode.type, primitives.Tooltip);
  assert.equal(tooltipNode.children.type, 'span', '**裸文本必须包成元素**（官方要求 children 能接 ref）');
  assert.equal(tooltipNode.children.children, '裸文本');
  assert.deepEqual(family.usage().map((row) => [row.kind, row.atom, row.used]), [
    ['dialog', 'Modal', true],
    ['popover', 'Menu', true],
    ['tooltip', 'Tooltip', true],
    ['hoverCard', 'HoverCard', true],
  ]);
});

test('原子缺失/种子表变动 ⇒ 不抛、不假装渲染，只记账', () => {
  const react = createElementRecorder();
  const family = createFamily(react, null);
  assert.equal(family.Dialog({ open: true }), null, '官方原子不可用 ⇒ 不渲染（不自己画一个假的）');
  assert.equal(family.Popover({ open: true }), null);
  assert.equal(family.Tooltip({ label: 'x', children: '文本' }), '文本', 'Tooltip 退化时原样返回 children');
  assert.deepEqual(family.missing().map((row) => row.atom), ['Modal', 'Menu', 'Tooltip']);
  assert.equal(resolveAtom(null, 'Modal'), null);
  assert.equal(resolveAtom({ Modal: 'not-a-function' }, 'Modal'), null);
});

test('Tooltip 的 children 是元素时原样透传（不动调用方的节点）', () => {
  const react = createElementRecorder();
  const { primitives } = createRecorderPrimitives(react);
  const family = createFamily(react, primitives);
  const node = react.createElement('button', null, 'x');
  const tree = family.Tooltip({ label: 'l', children: node });
  assert.equal(tree.children, node);
});
