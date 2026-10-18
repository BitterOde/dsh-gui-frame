/**
 * dock-pairing.test.mjs —— 入口坞的**成对注册 / 注册路径 / 角标 / 实时读数 / 负控**机检门禁。
 *
 * 纪律：本文件**不写任何文件**、不联网、不需要 DSH 在跑、**不碰 profile / 不起服务**。
 * 用真 `GuiFrameService`（`src/client/service.mjs`）+ 假座位服务/假 layout（`dock-fixtures.mjs`，
 * 后者的 `selectPanel` 是官方 `LayoutController` 的逐字转写，见其函数头引注）。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DOCK_ENTRY_ID, DOCK_PANEL_SIZE, DOCK_SLICE_NAME, MAIN_SLOT, PANELLIST_SLOT, SLOT_OPTION_KEYS, WORKBENCH_PANEL_ID, anchorRectOf, assertEntryId, install, panelRectNear } from '../../src/client/dock.mjs';
import { readEntryAnchor, recordEntryAnchor } from '../../src/client/kit/entry-icons.mjs';
import { findAll, findByAttr, findByType, renderComponent, textOf } from '../helpers/fake-react.mjs';
import { PKG_DIR, componentOn, createDockHarness, optionsOn, panellistOwnerProps } from './dock-fixtures.mjs';

/** 官方 `resolveSlotLabel` 的逐字等价（实读外壳：`function Fc(t){return typeof t=="function"?t():t}`）。 */
const resolveSlotLabel = (label) => (typeof label === 'function' ? label() : label);

test('[A1/A3/A17] 坞在 register 内部**同步**成对注册 panellist + main，走 inject 而不直接 register', () => {
  const h = createDockHarness();
  const installed = install(h.ctx, h.env);
  assert.equal(installed.installed, true, `坞应装配成功（reason=${installed.reason}）`);

  // 坞自己的入口：id 带 dsh-gui-frame/ 前缀
  assert.equal(DOCK_ENTRY_ID, 'dsh-gui-frame/dock');
  const own = h.service.__entries().map((row) => row.id);
  assert.deepEqual(own, [DOCK_ENTRY_ID], '坞必须把自己注册成一个入口（坞 = panellist 的一个 entry）');

  // register 返回时，两处注册**已经在册**（同步；`__broadcast` 不是下一帧）
  const panellist = optionsOn(h.registered, PANELLIST_SLOT);
  const main = optionsOn(h.registered, MAIN_SLOT);
  assert.equal(panellist.length, 1, 'panellist 上应恰好 1 条（坞自己 —— 工作台那一格不占侧栏行）');
  /**
   * `main` 上是**两条** —— 坞自己那一格 + 工作台那一格（`WORKBENCH_PANEL_ID`，由坞在装配期与自己的
   * 入口**同源同序**注册；晚注册那条路真机实测查不到这一格）。
   * 判据要求「恰好两条、键集确定、每条都能被平台 `hasMainPanel` 查到」。
   */
  assert.equal(main.length, 2, 'main 上应恰好 2 条（坞自己 + 工作台那一格）');
  assert.equal(panellist[0].id, DOCK_ENTRY_ID);
  assert.deepEqual(main.map((options) => options.key).sort(), [WORKBENCH_PANEL_ID, DOCK_ENTRY_ID].sort(), 'main 的键集＝{坞入口, 工作台那一格}');
  const ownMain = main.find((options) => options.key === DOCK_ENTRY_ID);
  assert.equal(panellist[0].id, ownMain.key, 'panellist.id 与坞自己那一格 main.key 必须同值');
  assert.ok(panellist[0].id.startsWith('dsh-gui-frame/'), 'id 必须带本包命名空间前缀');
  assert.equal(panellist[0].name, 'sidebar.panellist');
  assert.equal(ownMain.name, 'main');

  // 注册选项白名单：官方 SlotCore 只保留 key/id/order/label/priority，坞只用前四个
  for (const options of [...panellist, ...main]) {
    for (const key of Object.keys(options)) {
      assert.ok(SLOT_OPTION_KEYS.includes(key), `注册选项里出现了白名单外的键「${key}」（${JSON.stringify(options)}）`);
    }
  }

  // A3：两处注册都来自 inject（`injected` 记录里 `main` 出现两次：坞 pair 一次 + 工作台那一格一次；没有"绕过 inject"的 register）
  assert.deepEqual(h.injected.map((row) => row.key), [PANELLIST_SLOT, MAIN_SLOT, MAIN_SLOT]);
  assert.equal(h.registered.length, 3, 'registered 的条数必须等于 inject 回调里的 register 次数（坞 pair 2 条 + 工作台 1 条）—— 没有第二条注册路径');
});

test('未声明座位时 inject 会**挂起**而不是立刻注册；声明到位后自动补注册（直接 register 则同步抛）', () => {
  // ① 直接 register 到未声明槽位 ⇒ 同步抛（官方原文：slot "X" is not declared）
  const bare = createDockHarness({ declare: false });
  assert.throws(
    () => bare.slots.register({ name: PANELLIST_SLOT, id: 'dsh-gui-frame/x' }, () => null),
    /is not declared/,
    '未声明座位直接 register 必须同步抛 —— 这条正是"必须走 inject"的机制依据',
  );

  // ② 走 inject：声明还没到位 ⇒ 回调不跑，注册为 0 条
  const h = createDockHarness({ declare: false });
  const installed = install(h.ctx, h.env);
  assert.equal(installed.installed, true);
  assert.deepEqual(h.injected.map((row) => row.key), [PANELLIST_SLOT, MAIN_SLOT, MAIN_SLOT], 'inject 必须已经挂上（等待声明；main 两次：坞 pair + 工作台那一格）');
  assert.equal(h.registered.length, 0, '声明未到位 ⇒ inject 回调不得执行，也就没有任何注册');

  // ③ 声明到位 ⇒ inject 回调补跑，两个座位同时出现（成对是原子的）
  h.registry.declareConsumed();
  assert.equal(optionsOn(h.registered, PANELLIST_SLOT).length, 1);
  assert.equal(optionsOn(h.registered, MAIN_SLOT).length, 2, 'main 上两条：坞自己那一格 + 工作台那一格');
  assert.equal(
    optionsOn(h.registered, PANELLIST_SLOT)[0].id,
    optionsOn(h.registered, MAIN_SLOT).find((options) => options.key === DOCK_ENTRY_ID).key,
  );
  assert.ok(optionsOn(h.registered, MAIN_SLOT).some((options) => options.key === WORKBENCH_PANEL_ID), '工作台那一格也要在册');
});

test('id / key 绝不占用保留 key conversation（坞自己的准入 + 服务面归一化两条都拒）', () => {
  const h = createDockHarness();
  install(h.ctx, h.env);
  assert.throws(() => assertEntryId('conversation'), /保留 key/);
  assert.throws(() => h.service.register({ id: 'conversation' }, () => null), /保留 key/);
  for (const options of h.registered.map((row) => row.options)) {
    assert.notEqual(options.id, 'conversation');
    assert.notEqual(options.key, 'conversation');
  }
  assert.ok(!h.service.__entries().some((row) => row.id === 'conversation'));
  // 前缀也是硬约束：无命名空间前缀的 id 一律拒
  assert.throws(() => assertEntryId('demo'), /命名空间前缀/);
  assert.throws(() => assertEntryId(''), /非空字符串/);
});

test('注册选项的 label 恒为 thunk：owner 重新投影时跟着 locale 变', () => {
  const h = createDockHarness();
  install(h.ctx, h.env);
  let locale = 'zh';
  const label = () => (locale === 'zh' ? '演示面板' : 'Demo panel');
  h.service.register({ id: 'dsh-gui-frame/demo', label }, () => null);

  const options = optionsOn(h.registered, PANELLIST_SLOT).find((row) => row.id === 'dsh-gui-frame/demo');
  assert.equal(typeof options.label, 'function', 'label 必须是 thunk（官方 owner 会在 locale 变化时再次调用它）');
  assert.equal(resolveSlotLabel(options.label), '演示面板');
  locale = 'en';
  assert.equal(resolveSlotLabel(options.label), 'Demo panel', 'locale 变了 ⇒ 同一条注册的 label 解析结果必须跟着变');

  // 坞自己的入口也是 thunk（不是字符串）
  const own = optionsOn(h.registered, PANELLIST_SLOT).find((row) => row.id === DOCK_ENTRY_ID);
  assert.equal(typeof own.label, 'function');
  assert.equal(resolveSlotLabel(own.label), '按钮面板', '坞入口的兜底文案是**用户对该物的原话**（旧值 GUIFrame 是包名，用户据此判「找不到入口」）');
});

test('兜底字形必须认 thunk label（真缺陷回归：旧实现只认字符串 ⇒ 坞那一行恒显示「•」）', () => {
  const h = createDockHarness();
  install(h.ctx, h.env);
  h.service.register({ id: 'dsh-gui-frame/demo', label: () => '演示面板' }, () => null);

  const mark = findByAttr(renderComponent(h.seeds.react, componentOn(h.registered, PANELLIST_SLOT, 'dsh-gui-frame/demo'), panellistOwnerProps(false)), 'data-guif-glyph-mark', 'dsh-gui-frame/demo');
  assert.equal(mark.length, 1, '没有图标时必须画兜底字形');
  assert.equal(textOf(mark[0]), '演', 'label 是 thunk 也要取到首字（旧实现只认字符串，这里恒为「•」）');

  // 负控：真的解析不出 label 时才落到「•」
  h.service.register({ id: 'dsh-gui-frame/anon', label: () => '' }, () => null);
  const anon = findByAttr(renderComponent(h.seeds.react, componentOn(h.registered, PANELLIST_SLOT, 'dsh-gui-frame/anon'), panellistOwnerProps(false)), 'data-guif-glyph-mark', 'dsh-gui-frame/anon');
  assert.equal(textOf(anon[0]), '•', 'label 解析为空才是「•」兜底');
});

test('坞自带自绘图标：有 icon 的入口画 SVG，不再画兜底首字（侧栏那一行要能认出来）', () => {
  const h = createDockHarness();
  install(h.ctx, h.env);
  const tree = renderComponent(h.seeds.react, componentOn(h.registered, PANELLIST_SLOT, DOCK_ENTRY_ID), panellistOwnerProps(false));

  assert.equal(findByAttr(tree, 'data-guif-glyph', DOCK_ENTRY_ID).length, 1, '坞在侧栏那一行仍是坞自己造的图标组件');
  assert.equal(findByAttr(tree, 'data-guif-dock-icon').length, 1, '坞入口必须带自绘图标（否则只剩首字兜底）');
  assert.equal(findByAttr(tree, 'data-guif-glyph-mark', DOCK_ENTRY_ID).length, 0, '有图标就不该再画兜底首字');
  assert.equal(findByType(tree, 'rect').length, 4, '图标是 2×2 圆角方格（＝「一板子按钮」）');
  for (const rect of findByType(tree, 'rect')) {
    assert.equal(rect.props.fill, 'currentColor', '颜色只许走 currentColor（暗色主题跟着那一行的前景色走）');
  }
  assert.ok(!/#[0-9a-fA-F]{3,8}|rgb\(/.test(JSON.stringify(tree)), '图标不得内联颜色字面量（check:tokens 硬门禁）');
});

test('坞那一行是**一个**按钮：字形不拦点击、不带第二套交互', () => {
  const h = createDockHarness();
  install(h.ctx, h.env);
  h.service.register({ id: 'dsh-gui-frame/demo', label: '演示' }, () => null);

  /**
   * 用户原话：「为什么点击『按钮面板』和它左边的图标得到的东西还是不同？不对的，
   * **这是一整个按钮，不要做成两个**，点开后就是按钮面板。」
   *
   * 平台给的是**一个** `<button class=panelRow>`：字形与平台自己渲染的 label 都是它的子节点，它只有
   * **一个**动作 `layout.selectPanel(id)`（`dsh-client-ui-sidebar` 的 `PanelRow`，已实读）。
   * ⇒ 坞**不再**在字形上挂 onClick / stopPropagation（旧实现那样做，等于把这一行劈成两半：
   *   点图标开面板、点文字落到管理页 —— 真机两半不一致的根因）。
   */
  const ownTree = renderComponent(h.seeds.react, componentOn(h.registered, PANELLIST_SLOT, DOCK_ENTRY_ID), panellistOwnerProps(false));
  assert.equal(findByAttr(ownTree, 'data-guif-panel-launcher', DOCK_ENTRY_ID).length, 0, '坞那一颗不许再带「展开面板」锚点（那是第二套交互的痕迹）');
  assert.equal(findAll(ownTree, (node) => typeof node.props?.onClick === 'function').length, 0, '字形不许自带 onClick（点击由平台那一行统一派发）');

  // 字形仍要**记自己的屏幕矩形**：折回页要用它当锚点把面板贴着这一行开出来（没有它面板会掉到默认位）。
  const glyphNode = findByAttr(ownTree, 'data-guif-glyph', DOCK_ENTRY_ID)[0];
  assert.equal(typeof glyphNode.props?.ref, 'function', '字形必须挂 ref 回调（量矩形是面板定位的唯一来源）');
  recordEntryAnchor(DOCK_ENTRY_ID, null);
  glyphNode.props.ref({ getBoundingClientRect: () => ({ left: 20, top: 166, right: 36, width: 16, height: 16 }) });
  assert.deepEqual(readEntryAnchor(DOCK_ENTRY_ID), { left: 20, top: 166, right: 36, width: 16, height: 16 }, '挂载即记矩形');
  glyphNode.props.ref(null);
  assert.equal(readEntryAnchor(DOCK_ENTRY_ID), null, '卸载即清掉（不留过期锚点）');

  // 锚点换算：面板贴着按钮右缘长出来（x = right + gap，y 与按钮顶边对齐后再夹进视口）
  const event = { currentTarget: { getBoundingClientRect: () => ({ left: 20, top: 166, right: 36, width: 16, height: 16 }) } };
  assert.deepEqual(anchorRectOf(event), { left: 20, top: 166, right: 36, width: 16, height: 16 });
  assert.deepEqual(panelRectNear(anchorRectOf(event), { width: 1280, height: 900 }), {
    x: 44, y: 158, width: DOCK_PANEL_SIZE.width, height: DOCK_PANEL_SIZE.height,
  });
  // 视口装不下 ⇒ 夹进来（不许把面板推到屏幕外）
  const clamped = panelRectNear(anchorRectOf(event), { width: 360, height: 500 });
  assert.ok(clamped.x + clamped.width <= 360 && clamped.y + clamped.height <= 500, `夹取失败：${JSON.stringify(clamped)}`);
  // 量不到锚点（键盘/替身）⇒ 给一个安全缺省位，不抛
  assert.equal(anchorRectOf(null), null);
  assert.deepEqual(panelRectNear(null, { width: 1280, height: 900 }), { x: 16, y: 16, width: DOCK_PANEL_SIZE.width, height: DOCK_PANEL_SIZE.height });

  // 别的入口本来就不拦（反向面照旧：任何字形都不许自带 onClick）
  const demoTree = renderComponent(h.seeds.react, componentOn(h.registered, PANELLIST_SLOT, 'dsh-gui-frame/demo'), panellistOwnerProps(false));
  assert.equal(findByAttr(demoTree, 'data-guif-panel-launcher', 'dsh-gui-frame/demo').length, 0);
  assert.equal(findAll(demoTree, (node) => typeof node.props?.onClick === 'function').length, 0, '别的入口不许自带 onClick（不拦官方点击）');
});

test('角标自绘在坞图标组件里；注册选项里没有 badge 字段（官方会丢掉它）', () => {
  const h = createDockHarness();
  const installed = install(h.ctx, h.env);
  const dock = installed.dock;
  h.service.register({ id: 'dsh-gui-frame/demo', label: '演示' }, () => null);

  const options = optionsOn(h.registered, PANELLIST_SLOT).find((row) => row.id === 'dsh-gui-frame/demo');
  assert.ok(!Object.prototype.hasOwnProperty.call(options, 'badge'), '注册选项里不得出现 badge（官方 register 只保留 key/id/order/label/priority）');

  const glyph = componentOn(h.registered, PANELLIST_SLOT, 'dsh-gui-frame/demo');
  assert.equal(typeof glyph, 'function', 'panellist 的占用者必须是坞自己造的图标组件');
  const before = renderComponent(h.seeds.react, glyph, panellistOwnerProps(false));
  assert.equal(findByAttr(before, 'data-guif-badge').length, 0, '没有角标时不该画出角标节点');

  assert.equal(dock.setBadge('dsh-gui-frame/demo', 3), true);
  const after = renderComponent(h.seeds.react, glyph, panellistOwnerProps(true));
  const badge = findByAttr(after, 'data-guif-badge', 'dsh-gui-frame/demo');
  assert.equal(badge.length, 1, '角标应由自有图标组件自绘（带 data-guif-badge 锚点）');
  assert.equal(textOf(badge[0]), '3');
  assert.equal(badge[0].props['data-guif-badge-tone'], 'neutral');

  // 上限与清零
  dock.setBadge('dsh-gui-frame/demo', 1000);
  assert.equal(textOf(findByAttr(renderComponent(h.seeds.react, glyph, {}), 'data-guif-badge')[0]), '99+');
  dock.setBadge('dsh-gui-frame/demo', 0);
  assert.equal(findByAttr(renderComponent(h.seeds.react, glyph, {}), 'data-guif-badge').length, 0, '角标为 0 ⇒ 不画');

  // 图标节点本身也在（自绘字形兜底）
  assert.equal(findByAttr(after, 'data-guif-glyph', 'dsh-gui-frame/demo').length, 1);
  assert.equal(findByAttr(after, 'data-guif-glyph-mark', 'dsh-gui-frame/demo').length, 1);
});

test('入口列表读的是**实时**座位状态（slots.entries + entriesOfSlot），不是坞自己的缓存', () => {
  const h = createDockHarness();
  const installed = install(h.ctx, h.env);
  const dock = installed.dock;
  const disposeDemo = h.service.register({ id: 'dsh-gui-frame/demo', label: '演示' }, () => null);

  const snapshot = dock.entries(h.ctx);
  assert.equal(snapshot.panellist.length, 2, 'panellist 实时条目 = 坞自己 + demo');
  assert.equal(snapshot.main.length, 3, 'main 实时条目 = 坞自己 + 工作台那一格 + demo（第三次翻面：工作台那一格在装配期注册）');
  assert.equal(snapshot.winners.length, 3, 'entriesOfSlot 的按格赢家视图也要读到（main 三格：坞入口 / 工作台 / demo）');
  assert.deepEqual(snapshot.main.map((row) => row.options.key).sort(), [DOCK_ENTRY_ID, WORKBENCH_PANEL_ID, 'dsh-gui-frame/demo'].sort());

  // 外部（别的插件）直接往 panellist 里加一条：坞的实时读数必须看见它
  h.slots.register({ name: PANELLIST_SLOT, id: 'text-manager/panel', order: 5, label: '文本' }, () => null);
  assert.equal(dock.entries(h.ctx).panellist.length, 3, '坞必须能看见"不是它注册的"座位条目（实时读）');
  const store = dock.refreshNow();
  assert.equal(store.panellist.length, 3, '刷新后的 store 快照同样来自实时读数');
  assert.equal(store.entries.length, 2, '坞内入口环只含经 ctx.gui-frame.register 登记的条目');

  // 撤掉 demo ⇒ 实时读数回落
  disposeDemo();
  assert.equal(dock.entries(h.ctx).panellist.length, 2);
  assert.equal(dock.list().some((row) => row.id === 'dsh-gui-frame/demo'), false, '撤掉的入口必须从坞内环里消失');
});

test('未成对注册 ⇒ ctx.layout.selectPanel 抛错；成对注册后同一调用通过（含"半配对崩塌"再变红）', () => {
  // ① 负控：只有 panellist，没有 main
  const broken = createDockHarness();
  broken.slots.register({ name: PANELLIST_SLOT, id: 'dsh-gui-frame/half', order: 0, label: '半边' }, () => null);
  assert.throws(
    () => broken.layout.selectPanel('dsh-gui-frame/half'),
    /main panel "dsh-gui-frame\/half" is not registered/,
    '半边注册时 selectPanel 必须抛（官方 LayoutController 的 @throws 契约）',
  );

  // ② 正控：坞的成对注册之后，同一个 id 可以选中
  const h = createDockHarness();
  install(h.ctx, h.env);
  assert.equal(h.layout.selectPanel(DOCK_ENTRY_ID), undefined);
  assert.equal(h.layout.activePanelId, DOCK_ENTRY_ID);

  // ③ 半配对崩塌再变红：走坞的卸载路径把 fiber 上的副作用全撤掉（main 的注册随之消失）
  const again = install(h.ctx, h.env);
  assert.equal(again.installed, false, '同一 service 二次 install 必须幂等（already-installed），不重复注册');
  assert.equal(again.reason, 'already-installed');
  h.ctxInternals.dispose();
  assert.equal(optionsOn(h.registered, MAIN_SLOT).length, 0, '卸载后 main 的注册必须消失（副作用挂在调用方 fiber 上）');
  assert.equal(optionsOn(h.registered, PANELLIST_SLOT).length, 0, '卸载后 panellist 的注册同样消失（成对撤）');
  assert.throws(
    () => h.layout.selectPanel(DOCK_ENTRY_ID),
    /is not registered/,
    'main 的注册随 fiber 卸载消失 ⇒ selectPanel 立刻回到抛错状态（证明负控不是"替身恰好会抛"）',
  );
});

test('dock/panel 都导出 install(ctx, env)；env 恰含 service 与 seeds 两个面；缺面时显式不装', () => {
  const h = createDockHarness();
  assert.deepEqual(Object.keys(h.env).sort(), ['seeds', 'service'], 'env 只有 service 与 seeds 两个面');
  const installed = install(h.ctx, h.env);
  assert.equal(installed.installed, true);
  assert.equal(installed.capability, 'dock');
  assert.equal(typeof installed.dispose, 'function');
  assert.equal(typeof h.env.seeds.react.createElement, 'function', 'seeds 面必须真的被用上（react 种子）');

  // 缺 service ⇒ 不装、不注册任何座位
  const bare = createDockHarness();
  const noService = install(bare.ctx, { seeds: bare.seeds });
  assert.equal(noService.installed, false);
  assert.equal(noService.reason, 'no-service');
  assert.deepEqual(bare.injected, []);

  // 缺 slots ⇒ 不装（连 inject 都不调）
  const noSlots = createDockHarness();
  const noSlotsEnv = { service: noSlots.service, seeds: noSlots.seeds };
  const emptyCtx = { ...noSlots.ctx, get: () => undefined };
  const outcome = install(emptyCtx, noSlotsEnv);
  assert.equal(outcome.installed, false);
  assert.equal(outcome.reason, 'no-slots');
});

test('副作用全部经 ctx.effect；切片经 service.__install 登记且第一个参数是调用方 ctx', () => {
  const h = createDockHarness();
  const installed = install(h.ctx, h.env);
  assert.ok(h.ctxInternals.calls.effect.includes('gui-frame: dock slice + own entry'), '坞的装配副作用必须在 ctx.effect 上');
  const slice = h.service.__slice(DOCK_SLICE_NAME);
  assert.equal(slice, installed.dock.api, '切片必须就是坞的 api 对象（service.__install("dock", api)）');
  for (const method of ['onEntry', 'entries', 'list', 'setBadge', 'setLabel', 'dispose']) {
    assert.equal(typeof slice[method], 'function', `切片方法 ${method} 必须在册`);
  }
  assert.ok(slice.onEntry.length >= 2, 'onEntry 的签名必须是 (ctx, change)');

  // 切片方法第一个参数恒为调用方 ctx：把 onEntry 包一层，看 service.register 传进来的是谁
  let seenCtx = null;
  const original = slice.onEntry;
  slice.onEntry = (callerCtx, change) => {
    if (seenCtx === null) seenCtx = callerCtx;
    return original(callerCtx, change);
  };
  h.service.register({ id: 'dsh-gui-frame/probe', label: '探针' }, () => null);
  assert.equal(seenCtx, h.ctx, '切片方法的第一个参数必须是在调用 register 的那个 ctx');
  slice.onEntry = original;
  h.service.__entries(); // 只读，确认探针入口确实在册（它的清理归它自己的 fiber）
  const probeOff = h.service.__entries().find((row) => row.id === 'dsh-gui-frame/probe');
  assert.ok(probeOff, '探针入口应在册');

  // 卸载：一次 dispose 把坞自己的座位、切片、坞入口全部收干净（探针入口归它自己的 fiber，另行撤）
  const effectsBefore = h.ctxInternals.effects.length;
  assert.ok(effectsBefore > 0);
  installed.dispose();
  assert.equal(h.service.__slice(DOCK_SLICE_NAME), undefined, '卸载后切片必须注销');
  assert.equal(h.registered.length, 0, '卸载后不得残留任何座位注册');
  assert.deepEqual(h.service.__entries().map((row) => row.id), ['dsh-gui-frame/probe'], '坞自己的入口必须撤掉（探针入口不归坞管）');
  assert.throws(() => h.layout.selectPanel(DOCK_ENTRY_ID), /is not registered/);
});

test('汇合点唯一：坞/面板只导出装配函数、不自行挂载（挂载点归 entry.mjs）', () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  // 判据钉在**能力模块自己**身上：只导出装配函数、没有平台入口形态（apply/inject/default）
  // ⇒ 不可能自行挂载（写「entry.mjs 里没有 dock/panel」那种判据在汇合点装起来后必然失效 ——
  // 汇合点本来就该 import 能力模块）。
  for (const rel of ['dock.mjs', 'panel/index.mjs']) {
    const code = strip(readFileSync(path.join(PKG_DIR, 'src', 'client', ...rel.split('/')), 'utf8'));
    assert.ok(/export function install\s*\(/.test(code), `${rel} 必须导出 install(ctx, env)（装配契约 v1）`);
    assert.equal(/export\s+default/.test(code), false, `${rel} 不得有平台入口形态的 default 导出（loader 会把 default 当插件挂）`);
    assert.equal(/^\s*export\s+(?:const|let|var)\s+apply\b/m.test(code), false, `${rel} 不得导出 apply`);
    assert.equal(/^\s*export\s+(?:const|let|var)\s+inject\b/m.test(code), false, `${rel} 不得导出 inject`);
  }

  // 单向依赖：只有汇合点 entry.mjs 能 import 能力模块（反向 import = 能力模块自己去找挂载点）
  const clientDir = path.join(PKG_DIR, 'src', 'client');
  const importers = listClientSources(clientDir).filter((rel) => {
    const code = strip(readFileSync(path.join(clientDir, ...rel.split('/')), 'utf8'));
    return /from '\.\/dock\.mjs'|from '\.\/panel\/index\.mjs'/.test(code);
  });
  assert.deepEqual(importers, ['entry.mjs'], `能力模块的 import 方必须只有汇合点（实际：${importers.join('、') || '无'}）`);

  // 本任务的文件里也不得 import entry.mjs（单向：汇合点 import 能力模块，不能反过来）
  const dockSource = readFileSync(path.join(PKG_DIR, 'src', 'client', 'dock.mjs'), 'utf8');
  assert.ok(!dockSource.includes("'./entry.mjs'") && !dockSource.includes('"./entry.mjs"'), '能力模块不得反向 import 汇合点');

  // 判据非空转自检：扫描器必须真的看得见 entry.mjs 里那两条 import
  const entryCode = strip(readFileSync(path.join(PKG_DIR, 'src', 'client', 'entry.mjs'), 'utf8'));
  assert.ok(/from '\.\/dock\.mjs'/.test(entryCode), '汇合点必须 import 坞（否则上面的"唯一 import 方"是空的）');
  assert.ok(/from '\.\/panel\/index\.mjs'/.test(entryCode), '汇合点必须 import 面板');
});

/** 递归列出 `src/client` 下的 `.mjs`（本任务只需相对 POSIX 路径）。 */
function listClientSources(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) listClientSources(abs, base, out);
    else if (entry.name.endsWith('.mjs')) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}
