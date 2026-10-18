/**
 * overlay-pointer.test.mjs —— **pointer-events 栈**门禁。
 *
 * 判据：`body` 被置 `none`；**引用计数**（多层同时锁只写一次）；**原值存取**；
 * **卸载严格还原**（原来是空串 ⇒ 移除属性；原来是 `auto` ⇒ 还回 `auto`）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPointerGuard } from '../../src/client/overlay/pointer.mjs';
import { createDom } from './window-harness.mjs';

test('lock/release：引用计数 + 原值还原（原来是空串 ⇒ 移除内联属性）', () => {
  const { body, cleanup } = createDom();
  try {
    const guard = createPointerGuard({ dom: body.ownerDocument });
    assert.equal(guard.isLocked(), false);
    assert.equal(body.style.pointerEvents, '', '起点没有内联值');

    const unlockA = guard.lock();
    assert.equal(body.style.pointerEvents, 'none', '锁上 ⇒ 浮层之下不可交互');
    assert.equal(guard.depth(), 1);
    assert.deepEqual(guard.saved(), { value: '' }, '记下的是「空串 = 没设过」');

    const unlockB = guard.lock();
    assert.equal(guard.depth(), 2, '引用计数');
    assert.equal(body.style.pointerEvents, 'none');

    unlockA();
    assert.equal(guard.depth(), 1);
    assert.equal(body.style.pointerEvents, 'none', '还有一层锁着 ⇒ 不还原');
    unlockB();
    assert.equal(guard.depth(), 0);
    assert.equal(body.style.pointerEvents, '', '最后一层走掉 ⇒ 还原成空串');
    assert.equal(body.style.length, 0, '**属性被移除**（不是留一个空的 pointer-events）');

    unlockB();
    assert.equal(guard.depth(), 0, '重复解绑幂等');
  } finally {
    cleanup();
  }
});

test('原值不是空串时按原样还原（严格还原原值）', () => {
  const { body, cleanup } = createDom();
  try {
    body.style.pointerEvents = 'auto';
    const guard = createPointerGuard({ dom: body.ownerDocument });
    const unlock = guard.lock();
    assert.equal(body.style.pointerEvents, 'none');
    unlock();
    assert.equal(body.style.pointerEvents, 'auto', '原值 auto 必须还回 auto');
    assert.deepEqual(guard.saved(), null);
  } finally {
    cleanup();
  }
});

test('restoreNow 是兜底：无论计数多少都强制还原（卸载路径最后一道保险）', () => {
  const { body, cleanup } = createDom();
  try {
    const guard = createPointerGuard({ dom: body.ownerDocument });
    guard.lock();
    guard.lock();
    assert.equal(guard.depth(), 2);
    guard.restoreNow();
    assert.equal(guard.depth(), 0);
    assert.equal(body.style.pointerEvents, '');
    assert.equal(guard.isLocked(), false);
  } finally {
    cleanup();
  }
});

test('没有 document 时不抛（渐进接入：拿不到 dom 就退化成空操作）', () => {
  const guard = createPointerGuard({ dom: null });
  const unlock = guard.lock();
  assert.equal(guard.depth(), 1);
  unlock();
  assert.equal(guard.depth(), 0);
  assert.equal(guard.body(), null);
});
