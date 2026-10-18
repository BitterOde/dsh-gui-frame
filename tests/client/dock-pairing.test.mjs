/**
 * dock-pairing.test.mjs —— 独立复验（一）：**坞与主区的成对注册**。
 *
 * 覆盖：
 *   - 坞与主区**成对**注册，且 `panellist.id === main.key`（官方 `MainPanelId` 的口径），
 *     并且两条座位在**同一次 `register()` 同步调用**内就位；
 *   - **负控**：只有 panellist、没有 main 时 `selectPanel(id)` 抛错；成对则不抛；半配对崩塌后再红；
 *   - 注册路径走 `ctx.slots.inject` 而**不是**直接 `register`：未声明时挂起（不抛）、声明后自动就位，
 *     并给出机制对照（直接 register 未声明槽位 ⇒ 同步抛）。
 *
 * 独立性：本文件不 import `tests/unit/**` 与 `tests/helpers/**`；ctx / slots / layout 替身全部自建
 * （见 `harness.mjs`），React 用真的（元素树逐节点检查）。只读：不写包内任何文件。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCtx,
  createLayoutService,
  createPrimitivesStub,
  createSlotsService,
  loadRealReact,
  loadSource,
} from './harness.mjs';

/** 把坞按真实装配链路装起来：真服务面（provideService）+ 自建 ctx/slots/layout 替身。 */
async function bootDock({ declareSlots = true } = {}) {
  const react = await loadRealReact();
  const { provideService } = await loadSource('client/service.mjs');
  const dockMod = await loadSource('client/dock.mjs');
  const slots = createSlotsService();
  const layout = createLayoutService(slots);
  const ctx = createCtx({ services: { slots, layout } });
  const { service } = provideService(ctx);
  if (declareSlots) {
    slots.declare('sidebar.panellist');
    slots.declare('main');
  }
  const primitives = createPrimitivesStub(react);
  const result = dockMod.install(ctx, { service, seeds: { react, primitives } });
  return { react, service, slots, layout, ctx, dock: result.dock, result, primitives, dockMod };
}

/** 一个合法的占位插件组件（坞只负责挂载，不碰它的内部结构）。 */
function Demo() {
  return null;
}

test('坞与主区成对注册：panellist.id === main.key === 入口 id，且在同一次 register() 调用内同步就位', async () => {
  const b = await bootDock();
  assert.equal(b.result.installed, true, `坞必须装上（reason=${b.result.reason ?? 'null'}）`);

  // 坞自己的入口（装载时就该成对）
  const ownId = b.dockMod.DOCK_ENTRY_ID;
  assert.ok(b.slots.entries('sidebar.panellist').some((row) => row.options.id === ownId), '坞自己的 panellist 条目必须就位');
  assert.ok(b.slots.entries('main').some((row) => row.options.key === ownId), '坞自己的 main 占用者必须就位');
  assert.doesNotThrow(() => b.layout.selectPanel(ownId), '坞自己的面板必须是可切换的（成对）');

  // 插件入口：一次同步 register() 之后，两处都应已在册（中间没有任何 await）
  const entryId = 'dsh-gui-frame/demo';
  const before = b.slots.calls.register.length;
  const disposer = b.service.register({ id: entryId, kind: 'panel', label: () => 'Demo' }, Demo);
  const after = b.slots.calls.register.length;
  assert.equal(after - before, 2, `一次入口注册必须恰好产生两条座位注册（实际 ${after - before}）`);

  const panellist = b.slots.entries('sidebar.panellist').find((row) => row.options.id === entryId);
  const main = b.slots.entries('main').find((row) => row.options.key === entryId);
  assert.notEqual(panellist, undefined, 'panellist 条目缺失');
  assert.notEqual(main, undefined, 'main 占用者缺失');
  assert.equal(panellist.options.id, entryId);
  assert.equal(main.options.key, entryId);
  assert.equal(panellist.options.id, main.options.key, 'id 与 key 必须同值（官方 MainPanelId 的判据）');

  // 主区占用者必须是个组件（坞包了壳），且是可切换的
  assert.equal(typeof main.Component, 'function');
  assert.doesNotThrow(() => b.layout.selectPanel(entryId));
  assert.equal(b.layout.activePanelId, entryId);

  // 卸载：两处一起撤（不留下「半配对」）
  disposer();
  assert.equal(b.slots.entries('sidebar.panellist').some((row) => row.options.id === entryId), false, '入口 disposer 后 panellist 必须撤掉');
  assert.equal(b.slots.entries('main').some((row) => row.options.key === entryId), false, '入口 disposer 后 main 必须一起撤掉');
});

test('负控：未成对注册 ⇒ selectPanel 抛错；成对 ⇒ 不抛；半配对崩塌后再次抛', async () => {
  const b = await bootDock();
  const id = 'dsh-gui-frame/only-panellist';

  // ① 只有 panellist 一半（绕过坞直接注册；坞自己不会这么做，这里是要复现「未成对」的世界）
  const off = b.slots.inject('sidebar.panellist', () => b.slots.register(
    { name: 'sidebar.panellist', id, order: 1, label: () => id },
    Demo,
  ));
  assert.ok(b.slots.entries('sidebar.panellist').some((row) => row.options.id === id), 'panellist 这半必须真的在册');
  assert.equal(b.slots.entries('main').some((row) => row.options.key === id), false, 'main 这半必须真的缺失');
  assert.equal(b.layout.hasMainPanel(id), false);
  assert.throws(
    () => b.layout.selectPanel(id),
    /main panel .* is not registered/,
    '未成对注册时 selectPanel 必须抛错（这正是「会整页死」的注册形态）',
  );
  off();

  // ② 成对（走坞）⇒ 不抛
  b.service.register({ id: 'dsh-gui-frame/paired', kind: 'panel' }, Demo);
  assert.doesNotThrow(() => b.layout.selectPanel('dsh-gui-frame/paired'));
  assert.equal(b.layout.activePanelId, 'dsh-gui-frame/paired');

  // ③ 半配对崩塌：把 main 那一条摘掉（模拟官方 owner 卸载 / 半边消失）⇒ 立刻回到抛错
  const mainRows = b.slots.rows.get('main');
  const index = mainRows.findIndex((row) => row.options.key === 'dsh-gui-frame/paired');
  assert.ok(index >= 0);
  mainRows.splice(index, 1);
  assert.throws(() => b.layout.selectPanel('dsh-gui-frame/paired'), /is not registered/);

  // ④ 关面板走 selectPanel(null)：合法且不抛
  assert.doesNotThrow(() => b.layout.selectPanel(null));
  assert.equal(b.layout.activePanelId, null);
});

test('注册路径走 ctx.slots.inject（不是直接 register）：未声明时挂起、声明后自动就位', async () => {
  // ① 座位**还没被声明**（官方 owner 未挂载）时，坞照装不误，注册走 inject 挂起
  const b = await bootDock({ declareSlots: false });
  assert.equal(b.result.installed, true, `座位未声明时坞仍必须装上（reason=${b.result.reason ?? 'null'}）`);
  const id = 'dsh-gui-frame/pending';
  assert.doesNotThrow(
    () => b.service.register({ id, kind: 'panel', label: () => id }, Demo),
    '座位未声明时注册入口不得抛错（inject 会挂起）',
  );
  assert.equal(b.slots.entries('sidebar.panellist').length, 0, '未声明 ⇒ 还没就位（这正是 inject 的挂起语义）');
  assert.equal(b.slots.entries('main').length, 0);
  assert.equal(b.slots.calls.register.length, 0, '未声明时**一次 register 都不该发生**（否则就是直接注册了）');
  assert.ok(b.slots.pendingCount('sidebar.panellist') >= 1, 'panellist 上必须挂着待办注册');
  assert.ok(b.slots.pendingCount('main') >= 1, 'main 上必须挂着待办注册');
  assert.deepEqual([...new Set(b.slots.calls.inject)].sort(), ['main', 'sidebar.panellist'], '两条座位都必须经 inject');

  // ② 官方 owner 声明到位 ⇒ 自动补注册（两条一起）
  b.slots.declare('sidebar.panellist');
  b.slots.declare('main');
  assert.ok(b.slots.entries('sidebar.panellist').some((row) => row.options.id === id), '声明后 panellist 必须自动就位');
  assert.ok(b.slots.entries('main').some((row) => row.options.key === id), '声明后 main 必须自动就位');
  assert.doesNotThrow(() => b.layout.selectPanel(id), '补注册后必须是可切换的');

  // ③ 机制对照：**直接** register 到未声明的槽位 ⇒ 同步抛（这才是「必须走 inject」的理由）
  const fresh = createSlotsService();
  assert.throws(
    () => fresh.register({ name: 'sidebar.panellist', id: 'x', order: 0 }, Demo),
    /is not declared/,
    '直接 register 未声明的槽位必须同步抛 —— 这就是坞必须走 inject 的机制来源',
  );
  assert.doesNotThrow(() => fresh.inject('sidebar.panellist', () => {}), 'inject 到未声明的槽位只挂起，不抛');
});
