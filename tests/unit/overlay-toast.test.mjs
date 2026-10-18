/**
 * overlay-toast.test.mjs —— **Toast 宿主与堆叠**门禁。
 *
 * 判据：官方 `Toast` 只是**原子**（无宿主/无队列）⇒ 队列、堆叠顺序、时长、满员淘汰、卸载全由宿主自己实现；
 * 渲染时**复用官方原子**（不重画外观）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { TOAST_HOLD_MS, TOAST_MAX_VISIBLE, createToastStack } from '../../src/client/overlay/toast.mjs';
import { createRecorderPrimitives, renderElement } from './window-harness.mjs';

/** 造一个只够渲染一次的最小 React 替身（不作为 React 使用，只用来记录 createElement 调用）。 */
function createElementRecorder() {
  const calls = [];
  return {
    calls,
    useState: () => [0, () => {}],
    useEffect: () => {},
    createElement(type, props, children) {
      calls.push({ type, props, children });
      return { type, props, children };
    },
  };
}

/** 手动触发的定时器（不依赖真实时间）。 */
function createTimers() {
  const queue = [];
  return {
    schedule(fn, ms) {
      const handle = { fn, ms, canceled: false };
      queue.push(handle);
      return handle;
    },
    cancel(handle) {
      if (handle) handle.canceled = true;
    },
    fireAll() {
      const rows = queue.splice(0);
      for (const row of rows) if (!row.canceled) row.fn();
    },
    pending() {
      return queue.filter((row) => !row.canceled).length;
    },
  };
}

test('队列：FIFO 堆叠 + 最大同时条数 + 满员淘汰最老的', () => {
  const timers = createTimers();
  const stack = createToastStack(null, { max: 2, holdMs: 5000, schedule: timers.schedule, cancel: timers.cancel });
  assert.equal(TOAST_MAX_VISIBLE, 3);
  assert.equal(TOAST_HOLD_MS, 4000);

  const id1 = stack.push('第一条');
  const id2 = stack.push('第二条');
  assert.deepEqual(stack.items().map((row) => row.text), ['第一条', '第二条'], 'FIFO：先来的在前');
  const id3 = stack.push('第三条');
  assert.deepEqual(stack.items().map((row) => row.text), ['第二条', '第三条'], '满员 ⇒ 淘汰最老的');
  assert.equal(stack.size(), 2);
  assert.equal(stack.stats().dropped, 1);
  assert.equal(timers.pending(), 2, '被淘汰的那条定时器也要摘掉');

  assert.equal(stack.dismiss(id2), true);
  assert.deepEqual(stack.items().map((row) => row.text), ['第三条']);
  assert.equal(stack.dismiss(id2), false, '重复关闭幂等');
  assert.equal(stack.dismiss(id1), false, '已被淘汰的 id 关不掉');
  void id3;
});

test('时长：到点自动消失（autoDismissed 计数）；clear 摘掉全部定时器', () => {
  const timers = createTimers();
  const stack = createToastStack(null, { schedule: timers.schedule, cancel: timers.cancel });
  stack.push('a', { holdMs: 1000 });
  stack.push('b', { holdMs: 1000 });
  assert.equal(timers.pending(), 2);
  timers.fireAll();
  assert.equal(stack.size(), 0, '到点自动消失');
  assert.equal(stack.stats().autoDismissed, 2);

  stack.push('c');
  stack.clear();
  assert.equal(stack.size(), 0);
  assert.equal(timers.pending(), 0, 'clear 必须摘干净（不留悬挂 timer）');
  assert.equal(stack.items().length, 0);
});

test('订阅：入队/出队都通知；退订后不再收到', () => {
  const timers = createTimers();
  const stack = createToastStack(null, { schedule: timers.schedule, cancel: timers.cancel });
  const seen = [];
  const off = stack.subscribe(() => seen.push(stack.size()));
  const id = stack.push('x');
  stack.dismiss(id);
  assert.deepEqual(seen, [1, 0]);
  off();
  stack.push('y');
  assert.deepEqual(seen, [1, 0]);
});

test('渲染：自研容器（堆叠）+ 官方 Toast 原子（不重画外观）', () => {
  const react = createElementRecorder();
  const { primitives, used } = createRecorderPrimitives(react);
  const timers = createTimers();
  const stack = createToastStack(react, { primitives, schedule: timers.schedule, cancel: timers.cancel, z: 600 });
  stack.push('甲');
  stack.push('乙');

  const tree = stack.component();
  assert.equal(tree.props['data-guif-toast-stack'], '', '容器是**我们自己**的（官方没有宿主）');
  assert.equal(tree.props.style.position, 'absolute');
  assert.equal(tree.props.style.zIndex, 600, '层号来自数字层级表的 toast 族');
  assert.equal(tree.children.length, 2, '两条吐司');
  for (const node of tree.children) renderElement(node); // 官方原子要等渲染时才被调用
  assert.deepEqual(used(), ['Toast', 'Toast'], '每条都用官方 Toast 原子渲染');
  assert.deepEqual(tree.children.map((node) => node.props.text), ['甲', '乙'], 'FIFO 顺序进 DOM');
  assert.equal(typeof tree.children[0].props.onDone, 'function', 'onDone 交回宿主（官方原子的契约）');

  // 官方原子缺失时退化成自带 role=alert 的节点，但堆叠仍是我们的
  const bare = createToastStack(react, { primitives: null, schedule: timers.schedule, cancel: timers.cancel });
  bare.push('丙');
  const bareTree = bare.component();
  assert.equal(bareTree.children[0].type, 'div');
  assert.equal(bareTree.children[0].props.role, 'alert');
});
