/**
 * overlay-install.test.mjs —— **overlay 装配函数**门禁（装配契约 v1）。
 *
 * 判据逐条：
 *  ① `install(ctx, env)` 把宿主挂到官方 `shell.overlay` 座位（`{name, id, order}`）；
 *  ② 把实现装成服务面的 `overlay` 分片 ⇒ `ctx.gui-frame.overlay.open/close/bringToFront` 真的能用；
 *  ③ 层号全部由数字层级表分配：不传 z 从 100 起单调自增；**极值抛 `GUIF-E-Z-RANGE`**；越段只告警；
 *  ④ 副作用经 `ctx.effect` 注册 ⇒ 调用方 fiber 卸载即摘座位/卸分片/清层栈（**不残留浮窗**）；
 *  ⑤ 幂等：二次 install 返回同一句柄、座位只占一次、不重复 provide。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { install, OVERLAY_SLOT_ID, OVERLAY_SLOT_KEY, OVERLAY_SLOT_ORDER, WINDOW_ID_PREFIX } from '../../src/client/overlay/index.mjs';
import { provideService } from '../../src/client/service.mjs';
import { createFakeCtx, createFakeSlots } from '../helpers/fake-ctx.mjs';

/** 造一套「假 ctx + 真服务面 + 假座位表 + 真 React 种子」的最小环境。 */
function createEnv() {
  const fake = createFakeCtx({});
  const slotFixture = createFakeSlots();
  // 座位服务经 `provide` 注册（读侧 `ctx.get('slots')` 软探测；属性赋值在真机上不是服务）
  fake.ctx.provide('slots', slotFixture.slots);
  const provided = provideService(fake.ctx);
  assert.equal(provided.owned, true, '服务面必须先提供成功');
  return {
    fake,
    slots: slotFixture.slots,
    injected: slotFixture.injected,
    registered: slotFixture.registered,
    service: provided.service,
    env: { service: provided.service, seeds: { react: React, primitives: null } },
  };
}

test('① 挂 shell.overlay 座位（id 带命名空间前缀 + order）；② 装成服务面 overlay 分片', () => {
  const { fake, injected, registered, service, env } = createEnv();
  const handle = install(fake.ctx, env);
  assert.deepEqual(injected.map((row) => row.key), [OVERLAY_SLOT_KEY]);
  assert.equal(registered.length, 1, '恰好占一个座位（shell.overlay 是 list，不需要成对注册）');
  assert.equal(registered[0].options.name, OVERLAY_SLOT_KEY);
  assert.equal(registered[0].options.id, OVERLAY_SLOT_ID);
  assert.equal(registered[0].options.order, OVERLAY_SLOT_ORDER);
  assert.equal(typeof registered[0].component, 'function', '挂上去的是 OverlayHost 组件');
  assert.deepEqual(service.__slices(), ['overlay']);
  assert.equal(service.supports('overlay'), true);
  assert.equal(handle.installed, true);

  // ④ 副作用经 ctx.effect（标签可读）
  assert.ok(fake.calls.effect.includes('gui-frame: install overlay'), '装配副作用必须挂在调用方 fiber 上');
});

test('③ 层号走数字层级表：不传 z 从 100 起单调自增；close/bringToFront 幂等', () => {
  const { fake, service, env } = createEnv();
  install(fake.ctx, env);

  const first = service.overlay.open({ id: 'w1', title: '甲' });
  const second = service.overlay.open({});
  assert.equal(first.id, 'w1');
  assert.equal(first.z, 100, '不传 z ⇒ 从 100 起（数字层级表的分配器）');
  assert.equal(second.z, 101, '单调自增');
  assert.ok(second.id.startsWith(WINDOW_ID_PREFIX), '未给 id ⇒ 自动生成，前缀可读');
  assert.equal(first.close(), true);
  assert.equal(first.close(), false, 'close 幂等');

  const third = service.overlay.open({ id: 'w3' });
  const fourth = service.overlay.open({ id: 'w4' });
  assert.equal(fourth.z, 103);
  assert.equal(service.overlay.bringToFront('w3'), true, '点击置顶');
  assert.equal(service.overlay.bringToFront('nope'), false);
  third.close();
  fourth.close();
  assert.equal(service.overlay.close('ghost'), false, '合法但不存在的 id ⇒ false（幂等，不抛）');
});

test('③ 极值被拒绝（GUIF-E-Z-RANGE）；越段只告警不阻断', () => {
  const { fake, service, env } = createEnv();
  install(fake.ctx, env);
  const before = service.__drainDiagnostics();

  assert.throws(() => service.overlay.open({ id: 'bad' }, { z: 2 ** 31 }), (error) => error.code === 'GUIF-E-Z-RANGE', '极值必须拒绝');
  assert.throws(() => service.overlay.open({ id: 'bad' }, { z: -1.5 }), (error) => error.code === 'GUIF-E-Z-RANGE');
  assert.equal(service.__drainDiagnostics().length, before.length, '被拒的调用不留窗口，也不多记诊断');

  const wild = service.overlay.open({ id: 'wild' }, { z: 5000 });
  assert.equal(wild.z, 5000, '越段照开（只告警不阻断）');
  const diagnostics = service.__drainDiagnostics();
  assert.ok(diagnostics.some((row) => row.code === 'GUIF-W-Z-SEGMENT'), '越段必须留下 GUIF-W-Z-SEGMENT');
  wild.close();
});

test('⑤ 幂等：二次 install 返回同一句柄、座位只占一次、不重复 provide', () => {
  const { fake, registered, service, env } = createEnv();
  const first = install(fake.ctx, env);
  const second = install(fake.ctx, env);
  assert.equal(first, second, '二次 install 返回同一句柄');
  assert.equal(registered.length, 1, '座位只占一次');
  assert.equal(fake.calls.provide.filter((name) => name === 'gui-frame').length, 1, '服务只提供一次');
  assert.equal(fake.calls.effect.length, 2, 'provide 一条 + install 一条');

  // 二次 install 之后层号不漂移、也不多出窗口
  const a = service.overlay.open({ id: 'a' });
  const b = service.overlay.open({ id: 'b' });
  assert.equal(b.z, a.z + 1);
  assert.equal(service.__slice('overlay') !== undefined, true);
  a.close();
  b.close();
});

test('④ 卸载：fiber 卸载 ⇒ 摘座位 + 卸分片 + 清层栈（不残留浮窗）', () => {
  const { fake, registered, service, env } = createEnv();
  install(fake.ctx, env);
  service.overlay.open({ id: 'w1' });
  service.overlay.open({ id: 'w2' });
  assert.equal(registered.length, 1);

  fake.dispose(); // 模拟调用方 fiber 卸载：跑掉全部 effect disposer
  assert.equal(registered.length, 0, '座位必须摘掉');
  assert.equal(service.__slice('overlay'), undefined, '分片必须卸掉');
  assert.equal(service.supports('overlay'), false);

  // 卸载后重新装配：同一个服务实例上继续可用（层号由服务分配器继续，不重复占用）
  const again = install(fake.ctx, env);
  assert.equal(again.installed, true);
  const fresh = service.overlay.open({ id: 'w3' });
  assert.equal(fresh.z, 102, '同一个服务的分配器继续单调（不漂移、不重号）');
  assert.deepEqual(again.stack.ids(), ['w3'], '**不残留上一轮的浮窗**');
  fresh.close();
});

test('卸载后再装：新服务实例从 100 重新开始（层号不跨实例漂移）', () => {
  const { fake, service, env } = createEnv();
  install(fake.ctx, env);
  service.overlay.open({ id: 'a' });
  fake.dispose();

  const fresh = createEnv();
  install(fresh.fake.ctx, fresh.env);
  const win = fresh.service.overlay.open({ id: 'b' });
  assert.equal(win.z, 100, '新服务实例 ⇒ 分配器从 100 重新开始');
});

test('没有 ctx.slots 也能装（渐进接入）：不抛、不占座位；React 不可用时**不装分片**（不静默收窗口）', () => {
  const fake = createFakeCtx({});
  const provided = provideService(fake.ctx);
  const handle = install(fake.ctx, { service: provided.service, seeds: { react: null } });
  assert.equal(handle.installed, false, '拿不到 React ⇒ 不注册宿主');
  assert.deepEqual(provided.service.__slices(), [], '宿主不可用 ⇒ 分片也不装（宁可显式报「未装配」）');
  assert.throws(() => provided.service.overlay.open({}), (error) => error.code === 'GUIF-E-CAPABILITY-ABSENT', '**不静默 no-op**');
  handle.dispose();
});

test('env 面契约：缺 service / 缺 seeds / 缺 env 都不抛（绝不把整页带走）', () => {
  const fake = createFakeCtx({});
  assert.doesNotThrow(() => install(fake.ctx, {}));
  assert.doesNotThrow(() => install(fake.ctx, null));
  assert.doesNotThrow(() => install(null, { service: null, seeds: null }));
  assert.doesNotThrow(() => install(undefined, undefined));
  const missing = install(fake.ctx, {});
  assert.equal(missing.installed, false);
  assert.equal(typeof missing.dispose, 'function');
});
