/**
 * overlay-stack.test.mjs —— **浮层层栈**门禁。
 *
 * 判据：栈序 = id 数组（末尾最上层）；点击置顶 = 移到末尾；挂载注册 / 卸载注销；
 * `top()` 只给最上层；**卸载后不残留**（服务方自动重挂载的幂等前提）；超出上限即淘汰最老的。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createOverlayStack } from '../../src/client/overlay/stack.mjs';

test('栈序与置顶：末尾是最上层，bringToFront 把 id 移到末尾', () => {
  const stack = createOverlayStack();
  stack.add({ id: 'a', z: 100 });
  stack.add({ id: 'b', z: 101 });
  stack.add({ id: 'c', z: 102 });
  assert.deepEqual(stack.ids(), ['a', 'b', 'c'], '注册顺序即栈序');
  assert.equal(stack.top().id, 'c', '最上层是末尾那个');

  assert.equal(stack.bringToFront('a'), true);
  assert.deepEqual(stack.ids(), ['b', 'c', 'a'], '点击置顶 = 移到末尾（overlay-kit orderList 语义）');
  assert.equal(stack.top().id, 'a');
  assert.equal(stack.bringToFront('zzz'), false, '不存在的 id 返回 false');

  assert.deepEqual(stack.records().map((row) => row.id), ['b', 'c', 'a'], 'records() 自底向顶，宿主按它渲染');
  assert.equal(stack.size(), 3);
  assert.equal(stack.get('b').z, 101);
  assert.equal(stack.get('nope'), null);
});

test('重复 add 同一个 id = 重新打开并置顶（不产生两扇窗）', () => {
  const stack = createOverlayStack();
  stack.add({ id: 'w', z: 100, title: '旧' });
  stack.add({ id: 'x', z: 101 });
  stack.add({ id: 'w', z: 102, title: '新' });
  assert.deepEqual(stack.ids(), ['x', 'w']);
  assert.equal(stack.size(), 2);
  assert.equal(stack.get('w').title, '新');
  assert.equal(stack.get('w').z, 102);
});

test('remove / clear：卸载路径不残留任何记录（幂等的第二道保险）', () => {
  const stack = createOverlayStack();
  stack.add({ id: 'a', z: 100 });
  stack.add({ id: 'b', z: 101 });
  assert.equal(stack.remove('a'), true);
  assert.equal(stack.remove('a'), false, '重复 remove 幂等');
  assert.deepEqual(stack.ids(), ['b']);
  assert.equal(stack.top().id, 'b');

  stack.clear();
  assert.deepEqual(stack.ids(), []);
  assert.deepEqual(stack.records(), []);
  assert.equal(stack.top(), null, '空栈 ⇒ top() 为 null');
  assert.equal(stack.size(), 0);
});

test('订阅：增删改都通知；订阅者抛错不打断其他订阅者；退订后不再收到', () => {
  const stack = createOverlayStack();
  const seen = [];
  const offA = stack.subscribe(() => {
    seen.push('a');
    throw new Error('订阅者炸了');
  });
  const offB = stack.subscribe(() => seen.push('b'));
  stack.add({ id: 'x', z: 100 });
  assert.deepEqual(seen, ['a', 'b'], '抛错的订阅者不阻断后面那个');
  stack.bringToFront('x');
  assert.equal(seen.length, 4);
  offA();
  offB();
  stack.remove('x');
  assert.equal(seen.length, 4, '退订后不再收到通知');
});

test('上限淘汰：超出 limit 时最老的被丢弃且可诊断（防御性封顶）', () => {
  const stack = createOverlayStack({ limit: 2 });
  stack.add({ id: 'a', z: 100 });
  stack.add({ id: 'b', z: 101 });
  stack.add({ id: 'c', z: 102 });
  assert.deepEqual(stack.ids(), ['b', 'c'], '最老的 a 被淘汰');
  assert.deepEqual(stack.dropped().map((row) => row.id), ['a']);
  assert.equal(stack.dropped()[0].record.z, 100);
});

test('非法记录不入栈（id 必须是非空字符串）', () => {
  const stack = createOverlayStack();
  assert.equal(stack.add(null), null);
  assert.equal(stack.add({ id: '' }), null);
  assert.equal(stack.add({ z: 100 }), null);
  assert.equal(stack.size(), 0);
});
