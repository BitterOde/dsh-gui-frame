/**
 * dock-identity.test.mjs —— 独立复验（二）：**入口 id 纪律与自绘角标**。
 *
 * 覆盖：
 *   - 入口 id 必须带 `dsh-gui-frame/` 前缀，且不得占用保留 key `conversation`
 *     —— 坞自己（`assertEntryId`）与服务面（`service.register` 的归一化）**两道闸**都要拦；
 *   - 角标由**自有图标组件**绘制：注册选项里没有任何 `badge` 字段（官方会静默丢掉），
 *     角标读的是坞自己的环。插件在 entry 上传的 badge 由坞收下并自绘；
 *     **硬线是：badge 绝不进官方注册选项**。
 *
 * 独立性：ctx / slots / layout 替身自建；React 用真的。只读：不写包内任何文件。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCtx,
  createLayoutService,
  createPrimitivesStub,
  createSlotsService,
  findByAttr,
  loadRealReact,
  loadSource,
  treeText,
} from './harness.mjs';

async function bootDock() {
  const react = await loadRealReact();
  const { provideService } = await loadSource('client/service.mjs');
  const dockMod = await loadSource('client/dock.mjs');
  const slots = createSlotsService();
  const layout = createLayoutService(slots);
  const ctx = createCtx({ services: { slots, layout } });
  const { service } = provideService(ctx);
  slots.declare('sidebar.panellist');
  slots.declare('main');
  const primitives = createPrimitivesStub(react);
  const result = dockMod.install(ctx, { service, seeds: { react, primitives } });
  return { react, service, slots, layout, ctx, dock: result.dock, result, dockMod, primitives };
}

function Demo() {
  return null;
}

test('入口 id：必须带命名空间前缀、不得占用保留 key —— 坞与服务面两道闸都拦', async () => {
  const b = await bootDock();
  const { assertEntryId, DOCK_ENTRY_ID, SLOT_OPTION_KEYS } = b.dockMod;

  // 坞自己的 id 带前缀
  assert.equal(DOCK_ENTRY_ID, 'dsh-gui-frame/dock');
  assert.equal(assertEntryId(DOCK_ENTRY_ID), DOCK_ENTRY_ID, '合法 id 原样返回');
  assert.equal(b.slots.entries('sidebar.panellist').some((row) => row.options.id === DOCK_ENTRY_ID), true, '坞自己的条目必须带该前缀注册');

  // ① 保留 key `conversation`：坞闸 + 服务面闸都拒
  assert.throws(() => assertEntryId('conversation'), (error) => error?.code === 'GUIF-E-ENTRY-INVALID', '坞闸必须拦保留 key');
  assert.throws(
    () => b.service.register({ id: 'conversation' }, Demo),
    (error) => error?.code === 'GUIF-E-ENTRY-INVALID',
    '服务面闸也必须拦保留 key（不能只有一道）',
  );
  assert.equal(b.slots.calls.register.some((call) => call.options?.id === 'conversation'), false, '被拒的 id 一次注册都不许发生');
  // 服务面也没把这条登记进坞
  assert.equal(b.dock.list().some((row) => row.id === 'conversation'), false);

  // ② 缺命名空间前缀 / 空 id / 前缀后为空 / 超长 / 非法字符
  const badIds = ['foo', '', 'dsh-gui-frame/', '/dock', 'dsh gui/dock', 'a'.repeat(200)];
  for (const bad of badIds) {
    assert.throws(() => assertEntryId(bad), (error) => error?.code === 'GUIF-E-ENTRY-INVALID', `坞闸必须拒「${bad}」`);
    assert.throws(() => b.service.register({ id: bad }, Demo), (error) => error?.code === 'GUIF-E-ENTRY-INVALID', `服务面闸必须拒「${bad}」`);
  }

  // ③ 合法 id 一律放行（含带点/下划线/多级路径的形态；避开坞自己的 id，那条已在册）
  for (const good of ['dsh-gui-frame/demo', 'third-party/panel', 'a.b/x_y-z', 'ns/sub/leaf']) {
    assert.equal(assertEntryId(good), good, `合法 id 不该被拒：${good}`);
    assert.doesNotThrow(() => b.service.register({ id: good, kind: 'action' }, Demo), `服务面必须放行：${good}`);
  }

  // ④ 注册选项只允许白名单里的键（角标纪律的一半：没有什么神秘字段能溜进去）
  for (const call of b.slots.calls.register) {
    for (const key of Object.keys(call.options ?? {})) {
      assert.ok(SLOT_OPTION_KEYS.includes(key), `注册选项里出现了白名单之外的键「${key}」（官方会静默丢弃）`);
    }
  }
  assert.equal(SLOT_OPTION_KEYS.includes('badge'), false, 'badge 不在官方注册选项表里 —— 所以角标必须自绘');
});

test('角标由自有图标组件绘制：注册选项里没有 badge 字段，角标读坞自己的环', async () => {
  const b = await bootDock();
  const id = 'dsh-gui-frame/badged';
  b.service.register({ id, kind: 'panel', label: () => id }, Demo);

  const row = b.slots.entries('sidebar.panellist').find((entry) => entry.options.id === id);
  assert.notEqual(row, undefined, 'panellist 条目必须在册');
  assert.equal(typeof row.Component, 'function', '坞必须给 panellist 挂一个自己的图标组件');

  // ① 注册选项：没有 badge（官方 register 只保留 key/id/order/label/priority）
  assert.equal('badge' in row.options, false, '角标不得进注册选项（塞进去也是被丢掉）');
  assert.deepEqual(Object.keys(row.options).sort(), ['id', 'label', 'name', 'order'], '注册选项必须恰好是这四项');

  // ② 未设角标 ⇒ 图上没有角标节点
  assert.equal(findByAttr(row.Component({ size: 18, active: false }), 'data-guif-badge', id).length, 0);

  // ③ 设角标 ⇒ **同一个注册选项对象**不变，图标树里出现自绘角标
  assert.equal(b.dock.setBadge(id, 3), true, 'setBadge 必须命中在册入口');
  const optionsAfter = JSON.stringify(row.options);
  const tree = row.Component({ size: 18, active: false });
  const badges = findByAttr(tree, 'data-guif-badge', id);
  assert.equal(badges.length, 1, '自绘角标必须出现在图标树里');
  assert.equal(treeText(badges[0]), '3', '角标文案＝坞环里的值');
  assert.equal(JSON.stringify(row.options), optionsAfter, '注册选项必须纹丝不动（角标不经过官方那条路）');

  // ④ 改角标 ⇒ 图标树跟着变（读的是坞自己的环，不是注册选项）
  b.dock.setBadge(id, 12);
  assert.equal(treeText(findByAttr(row.Component({}), 'data-guif-badge', id)[0]), '12');
  assert.equal(b.dock.list().find((item) => item.id === id).badge, 12, '坞自己的列表里要能读到角标');

  // ⑤ 0 / null ⇒ 不画角标
  b.dock.setBadge(id, 0);
  assert.equal(findByAttr(row.Component({}), 'data-guif-badge', id).length, 0, '角标 0 不该画');
  b.dock.setBadge(id, null);
  assert.equal(findByAttr(row.Component({}), 'data-guif-badge', id).length, 0);

  // ⑥ 插件在自己的 entry 里塞 badge ⇒ **坞收下并自绘**，但**绝不搬进注册选项**。
  //    注册形状是 `register({id,label,icon,order,kind,badge}, Component)`；官方 register 只保留
  //    key/id/order/label/priority，badge 塞进去也是被丢掉 —— 所以它必须由坞自绘。
  const id2 = 'dsh-gui-frame/with-badge-field';
  b.service.register({ id: id2, kind: 'panel', badge: 99 }, Demo);
  const row2 = b.slots.entries('sidebar.panellist').find((entry) => entry.options.id === id2);
  assert.notEqual(row2, undefined);
  assert.equal('badge' in row2.options, false, 'entry 上的 badge 不得被搬到注册选项里');
  const tree2 = row2.Component({});
  const badges2 = findByAttr(tree2, 'data-guif-badge', id2);
  assert.equal(badges2.length, 1, 'entry 上的 badge 必须由坞收下并自绘（注册形状里有 badge）');
  assert.equal(treeText(badges2[0]), '99', '画出来的必须是 entry 上传的那个值');
});
