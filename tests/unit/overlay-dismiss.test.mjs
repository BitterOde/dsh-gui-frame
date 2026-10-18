/**
 * overlay-dismiss.test.mjs —— **Esc 与点外关闭**门禁。
 *
 * 判据逐条：
 *  ① **六种后续事件**（pointerup / mousedown / mouseup / touchstart / touchend / click）
 *     **同时挂捕获期与冒泡期**，捕获期置 `true` / 冒泡期置 `false`，账本任一为 `true` ⇒ 被拦截；
 *  ② `pointerdown` 监听**延迟一个 macrotask 才挂**；
 *  ③ 判内外用 **React 树**（`onPointerDownCapture` 打标）；
 *  ④ 账本非空 ⇒ **不关**（拖拽在层外松手不误关）；
 *  ⑤ Esc **只关最上层**、**只在真关掉一层时** `preventDefault`；
 *  ⑥ `detach` 逐条对称摘挂（含尚未武装的那次延迟）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GESTURE_HOLD_KEY,
  OUTSIDE_INTERCEPTION_EVENTS,
  createDismissController,
  createEscapeController,
  createInterceptionLedger,
} from '../../src/client/overlay/dismiss.mjs';
import { createListenerLog, createPointerEventLike } from './window-harness.mjs';

/** 可控 macrotask 调度器：`flush()` 手动跑掉排队任务。 */
function createScheduler() {
  const queue = [];
  return {
    schedule(fn) {
      const handle = { fn, canceled: false };
      queue.push(handle);
      return handle;
    },
    cancel(handle) {
      if (handle !== undefined && handle !== null) handle.canceled = true;
    },
    flush() {
      const rows = queue.splice(0);
      for (const row of rows) if (!row.canceled) row.fn();
      return rows.length;
    },
    pending() {
      return queue.length;
    },
  };
}

test('账本：六种事件捕获期置 true / 冒泡期置 false；任一为 true 即「被拦截」', () => {
  const ledger = createInterceptionLedger();
  assert.deepEqual([...ledger.types], ['pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'], '真源逐字清单');
  assert.equal(ledger.isIntercepted(), false, '空账本 = 没被拦截');

  ledger.mark('pointerup', true);
  assert.equal(ledger.isIntercepted(), true, '捕获期真 ⇒ 被拦截');
  ledger.mark('pointerup', false);
  assert.equal(ledger.isIntercepted(), false, '冒泡期假 ⇒ 撤销');

  for (const type of OUTSIDE_INTERCEPTION_EVENTS) ledger.mark(type, true);
  assert.equal(ledger.isIntercepted(), true);
  assert.equal(Object.keys(ledger.snapshot()).length, OUTSIDE_INTERCEPTION_EVENTS.length);
  ledger.reset();
  assert.equal(ledger.isIntercepted(), false);
  assert.equal(ledger.size(), 0);

  ledger.hold();
  assert.equal(ledger.isIntercepted(), true, '拖拽在飞时的显式 hold');
  ledger.release();
  assert.equal(ledger.isIntercepted(), false);
  assert.equal(GESTURE_HOLD_KEY, 'guif-gesture');
});

test('控制器：六种事件成对挂载（捕获+冒泡），pointerdown 延迟一个 macrotask 才武装', () => {
  const dom = createListenerLog();
  const scheduler = createScheduler();
  const dismissals = [];
  const controller = createDismissController({
    dom,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    isInside: () => false,
    onDismiss: (event, reason) => dismissals.push(reason),
  });
  controller.attach();

  const types = dom.typesAttached();
  for (const type of OUTSIDE_INCEPTION_SAFE_EVENTS()) {
    assert.ok(types.includes(`${type}:capture`), `${type} 必须有捕获期监听`);
    assert.ok(types.includes(`${type}:bubble`), `${type} 必须有冒泡期监听`);
  }
  assert.ok(!types.includes('pointerdown:bubble'), 'pointerdown 还没挂（要等一个 macrotask）');
  assert.equal(controller.armed(), false);
  assert.equal(scheduler.pending(), 1, '延迟任务已排队');

  scheduler.flush();
  assert.equal(controller.armed(), true);
  assert.ok(dom.typesAttached().includes('pointerdown:bubble'), 'macrotask 之后才挂 pointerdown');
});

/** 六种事件（与导出常量同源，这里只是给断言一个短名字）。 */
function OUTSIDE_INCEPTION_SAFE_EVENTS() {
  return OUTSIDE_INTERCEPTION_EVENTS;
}

test('点外关闭：React 树判内外；账本非空不关；detach 对称摘挂', () => {
  const dom = createListenerLog();
  const scheduler = createScheduler();
  const dismissals = [];
  const controller = createDismissController({
    dom,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    isInside: () => false,
    onDismiss: () => dismissals.push('outside'),
  });
  controller.attach();
  scheduler.flush();
  const pointerDown = dom.active().find((row) => row.type === 'pointerdown').handler;

  // ③ React 树判内外：先打标 ⇒ 不关
  controller.onPointerDownCapture();
  pointerDown(createPointerEventLike({ target: null }));
  assert.deepEqual(dismissals, [], '点在浮层自己的 React 树内 ⇒ 不关');

  // 普通点外 ⇒ 关
  pointerDown(createPointerEventLike({}));
  assert.deepEqual(dismissals, ['outside']);

  // ④ 账本非空（拖拽在飞）⇒ 不关
  controller.ledger.hold();
  pointerDown(createPointerEventLike({}));
  assert.deepEqual(dismissals, ['outside'], '被拦截的外部交互不触发关闭');
  controller.ledger.release();

  // 捕获/冒泡标记：捕获期置 true、冒泡期置 false（账本被真实事件驱动）
  const capture = dom.active().find((row) => row.type === 'click' && row.capture).handler;
  const bubble = dom.active().find((row) => row.type === 'click' && !row.capture).handler;
  capture({ type: 'click' });
  assert.equal(controller.ledger.isIntercepted(), true);
  bubble({ type: 'click' });
  assert.equal(controller.ledger.isIntercepted(), false);
  assert.deepEqual(
    controller.calls().map((row) => `${row.phase}:${row.type}`).slice(-2),
    ['capture:click', 'bubble:click'],
  );

  controller.detach();
  assert.deepEqual(dom.active(), [], 'detach 必须逐条摘干净');
  assert.equal(controller.armed(), false);

  // 尚未武装就 detach：延迟任务被取消（不留悬挂的 macrotask）
  const dom2 = createListenerLog();
  const scheduler2 = createScheduler();
  const controller2 = createDismissController({ dom: dom2, schedule: scheduler2.schedule, cancel: scheduler2.cancel, onDismiss: () => {} });
  controller2.attach();
  controller2.detach();
  scheduler2.flush();
  assert.ok(!dom2.typesAttached().includes('pointerdown:bubble'), '被取消的延迟任务不许再挂监听');
});

test('enabled=false 时点外不再关闭（宿主卸载路径）', () => {
  const dom = createListenerLog();
  const scheduler = createScheduler();
  let enabled = true;
  const dismissals = [];
  const controller = createDismissController({
    dom,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    enabled: () => enabled,
    onDismiss: () => dismissals.push('x'),
  });
  controller.attach();
  scheduler.flush();
  const pointerDown = dom.active().find((row) => row.type === 'pointerdown').handler;
  enabled = false;
  pointerDown(createPointerEventLike({}));
  assert.deepEqual(dismissals, []);
});

test('Esc：只关最上层；只在真关掉一层时 preventDefault；没有浮层时不吞事件', () => {
  const dom = createListenerLog();
  const stack = [{ id: 'a' }, { id: 'b' }];
  const closed = [];
  const controller = createEscapeController({
    dom,
    top: () => (stack.length === 0 ? null : stack[stack.length - 1]),
    onEscape: (entry) => {
      closed.push(entry.id);
      stack.pop();
    },
  });
  controller.attach();
  const handler = dom.active().find((row) => row.type === 'keydown').handler;
  assert.equal(dom.active()[0].capture, true, 'Esc 走捕获期（抢在插件之前，但不无条件吞）');

  const esc1 = createPointerEventLike({ type: 'keydown' });
  esc1.key = 'Escape';
  assert.equal(handler(esc1), true);
  assert.deepEqual(closed, ['b'], '只关最上层');
  assert.deepEqual(esc1.calls, ['preventDefault'], '真关掉了一层才 preventDefault');

  const notEsc = createPointerEventLike({ type: 'keydown' });
  notEsc.key = 'a';
  assert.equal(handler(notEsc), false);
  assert.deepEqual(notEsc.calls, [], '不是 Esc ⇒ 一个副作用都没有');

  const esc2 = createPointerEventLike({ type: 'keydown' });
  esc2.key = 'Escape';
  handler(esc2);
  assert.deepEqual(closed, ['b', 'a']);
  const esc3 = createPointerEventLike({ type: 'keydown' });
  esc3.key = 'Escape';
  assert.equal(handler(esc3), false, '没有浮层可关');
  assert.deepEqual(esc3.calls, [], '没关掉就不许吞事件（免得抢插件的 Esc）');

  controller.detach();
  assert.deepEqual(dom.active(), []);
});

test('不可关闭的浮层不吃 Esc（closable=false）', () => {
  const dom = createListenerLog();
  const controller = createEscapeController({
    dom,
    top: () => ({ id: 'pinned', closable: false }),
    onEscape: () => {
      throw new Error('不该被调用');
    },
  });
  controller.attach();
  const handler = dom.active()[0].handler;
  const event = createPointerEventLike({ type: 'keydown' });
  event.key = 'Escape';
  assert.equal(handler(event), false);
  assert.deepEqual(event.calls, []);
});
