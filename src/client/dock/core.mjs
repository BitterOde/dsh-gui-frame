/**
 * dock/core.mjs —— **坞实例的装配核心**。
 *
 * 坞作用域的状态全在这里：`registry`（入口环）/ `refs`（装配期捕获的 ctx/slots/layout/layoutHandle/openPanel）
 * / `store`（快照仓库）/ `api`（切片面）/ `dock`（句柄面）。**状态随组搬走** —— `dock.mjs` 只留常量、
 * 几何、纯 helper 与 `install` 装配入口，经 bag 把这些交进来（不是两边各写一半）。
 *
 * **入参 bag（6 项）**：`env`（装配 options bag，原样交进来）/ `consts`（DOCK_SLICE_NAME / DOCK_ENTRY_ID /
 * PANELLIST_SLOT / MAIN_SLOT / DOCK_LABEL_FALLBACK）/ `geometry`（panelRectNear / anchorRectOf / assertEntryId）
 * / `helpers`（effectOn / dockLabel / entryLabel / rank / isInternalEntry）/ `readDockActions` /
 * `createPanelContent`。同域子模块（`./panels.mjs` / `./store-face.mjs`）与 kit 共享叶直接 import，不经 bag。
 *
 * 交回 1 个口子：`createDock(env)` 的返回值（坞句柄 `dock`，`install` 拿它去挂切片与入口）。
 */
import { createPrimitivesSeat } from '../kit/primitives.mjs';
import { createEntryGlyph, createDockIcon, readEntryAnchor } from '../kit/entry-icons.mjs';
import { createSnapshotStore, createStoreHook } from '../kit/store.mjs';
import { probeService } from '../kit/probe.mjs';
import { createDockPanels } from './panels.mjs';
import { createDockPanelApi } from './panel-api.mjs';
import { createDockStoreFace } from './store-face.mjs';

export function createDockCore(deps) {
  const { env, consts, geometry, helpers, readDockActions, createPanelContent } = deps;
  const { DOCK_SLICE_NAME, DOCK_ENTRY_ID, PANELLIST_SLOT, MAIN_SLOT, DOCK_LABEL_FALLBACK, WORKBENCH_PANEL_ID } = consts;
  const { panelRectNear, assertEntryId } = geometry;
  const { effectOn, dockLabel, entryLabel, rank, isInternalEntry } = helpers;
  const bag = env !== null && typeof env === 'object' ? env : {};
  const seeds = bag.seeds !== null && typeof bag.seeds === 'object' ? bag.seeds : {};
  const react = seeds.react;
  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
    throw new Error('[gui-frame] createDock(env) 需要 env.seeds.react（坞图标是 React 组件）');
  }
  const service = bag.service ?? null;
  /** 官方原子座位（字形/角标自绘要用它）：**经 kit 共享叶**取工厂，缺席时调用点退到自研等价物。 */
  const primitives = createPrimitivesSeat(seeds.primitives);
  /**
   * 面板壳组件（Panel / Toolbar）：**渲染期经服务面组件表取**（坞只交数据与锚点）。
   * 装配序 dock → theme → panel → overlay 保证「渲染时面板能力已在册」；
   * 面板能力没装上 ⇒ 返回 null，调用点退化为「不套壳但照常渲染」（可用但不装不起）。
   */
  const componentOf = (name) => {
    try {
      const face = service === null || service === undefined ? null : service.components;
      const found = face !== null && typeof face.get === 'function' ? face.get(name) : undefined;
      return typeof found === 'function' ? found : null;
    } catch {
      return null;
    }
  };
  const useSnapshot = createStoreHook(react);
  const store = createSnapshotStore(seeds, { ready: false, entries: [], panellist: [], main: [] });
  const el = react.createElement;
  /** 坞自己的入口环（**不进** slot 注册选项）：`{record, badge, icon, paired, dispose}`。 */
  const registry = new Map();
  /**
   * 装配期捕获：caller ctx / slots 服务 / 面板 layout（软探测，缺了就降级）/ 本包 layout 能力句柄
   * / `openPanel`（坞作用域打开函数）。
   */
  const refs = { ctx: null, slots: null, layout: null, layoutHandle: null, openPanel: null };

  // ── 实时读数 → store（`live`/`refresh` 在 `./dock/store-face.mjs`）──
  //    `registry`/`store`/`refs` 三样本侧的状态**整只交接**（不是两边各写一半），交回的口子只有 `refresh`。
  const storeFace = createDockStoreFace({ refs, registry, store, rank, MAIN_SLOT, PANELLIST_SLOT });
  const { live, refresh } = storeFace;

  // ── 坞的四件面板逻辑（在 `./dock/panels.mjs`）──────────
  //    `refs` 是共享可变对象（`openPanel`/`layout`/`layoutHandle` 由坞作用域写、面板侧读）⇒ 整只交接；
  //    `registry`/`store`/`refs` 这三样状态**留在本侧**，面板模块只有行为、不留读数的第二份副本。
  const panels = createDockPanels({
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, refresh, dockLabel,
    entryLabel, readDockActions, createPanelContent, panelRectNear, readEntryAnchor, DOCK_ENTRY_ID,
    DOCK_LABEL_FALLBACK, effectOn, // ★ 行样式表被摘走时要能自愈（值守观察器经它挂在调用方 ctx 上）
  });
  const { createMainShell, createDockEntryPage, createDockManagePage, closePanel, openDockPanel, closeDockPanel, isDockPanelOpen } = panels;
  /**
   * 成对注册一个入口（`panel` 型）：**同步**完成两次 `slots.inject`，返回幂等 disposer。
   * `label` 恒为 **thunk**：owner（sidebar）在 locale 变化时会**再次调用**它取新文案。
   *
   * `options.sidebar === false`：**只占 `main`，不占侧栏那一行**。
   * 这是「一个按钮 + 按钮面板」的形状所要求的 —— 本包自己贡献的附加页（坞的管理页）不该
   * 再往侧栏挤一行；它的入口由坞的**总览面板**（`createDockOverview`）给一颗按钮，
   * 点了照样 `selectPanel(id)` 打得开。判据：侧栏 `sidebar.panellist` 里本包只留一条。
   */
  function pairEntry(callerCtx, slots, record, icon, options) {
    assertEntryId(record.id);
    const withSidebar = options === null || options === undefined ? true : options.sidebar !== false;
    const order = Number.isInteger(record.order) ? record.order : 0;
    const label = () => entryLabel(record);
    const Shell = createMainShell(record);
    const ctx = callerCtx ?? refs.ctx;
    return effectOn(ctx, `gui-frame: dock pair ${record.id}`, () => {
      const offPanellist = withSidebar
        ? slots.inject(PANELLIST_SLOT, () => slots.register({
            name: PANELLIST_SLOT,
            id: record.id,
            order,
            label,
          }, icon))
        : () => {};
      const offMain = slots.inject(MAIN_SLOT, () => slots.register({ name: MAIN_SLOT, key: record.id }, Shell));
      return () => {
        offPanellist();
        offMain();
      };
    });
  }

  /** 坞的切片面（`service.__install('dock', api)`）；**每个方法的第一个参数都是调用方 ctx**。 */
  const api = {
    attachLayout(callerCtx, handle) {
      // 接收 **layout 能力**的句柄（由 layout 侧装配完成时推过来）。
      // ⚠ 本版没有 layout 能力 ⇒ 这条口子**没有调用方**；留着的理由是坞**先装**、能力**后装**，
      // 由后装的一侧把句柄推过来，既不动装配顺序契约，也不新增模块依赖。
      refs.layoutHandle = handle !== null && handle !== undefined && handle.installed === true ? handle : null;
      refresh(refs.slots);
      return refs.layoutHandle !== null;
    },
    /**
     * ⚠ 这里**不能**改成「工作台侧推 id 过来、由坞注册那一格」：那条晚注册的路真机实测不可靠
     * （attach 返回 true、日志无异常，平台 `renderSlot('main',
     * {}, { entryKey })` 却查不到这一格 ⇒ 工作台中心列空白）。工作台那一格必须与坞自己那一格
     * **同源同序**地在 `install()` 的同一个 effect 里注册（见下面的 `offWorkbenchMain`）。
     */
    onEntry(callerCtx, change) {
      const slots = refs.slots;
      if (slots === null) return false;
      const kind = change !== null && typeof change === 'object' ? change.type : '';
      const record = change !== null && typeof change === 'object' ? change.entry : null;
      if (record === null || typeof record !== 'object' || typeof record.id !== 'string') return false;
      if (kind === 'added') {
        const id = assertEntryId(record.id);
        if (registry.has(id)) return false;
        // `badge` / `icon` 从注册面收下来：官方 `register` 会把它们静默丢掉，坞自存自绘。
        const row = { record, badge: record.badge ?? null, icon: record.icon ?? null, paired: false, sidebar: false, dispose: null };
        registry.set(id, row);
        if (record.kind !== 'action') {
          /**
           * ★ **字形不再拦点击**：平台的 `PanelRow` 本身就是**一个** `<button>`
           * （字形与 label 都是它的子节点），它只有一个动作 `selectPanel(id)`。旧版让字形自己
           * `stopPropagation` 后开面板，等于把这一行劈成两半（点图标 ≠ 点文字）—— 用户判「做成了两个」。
           * 现在字形只干两件事：**画自己**、**记自己的屏幕矩形**（面板要贴着这一行长出来）。
           */
          const icon = createEntryGlyph(react, primitives, {
            id,
            label: record.label,
            icon: row.icon,
            readBadge: () => row.badge,
          });
          // 本包自己的附加入口（管理页）**不占侧栏行**：它只挂 `main`，
          // 按钮由坞总览面板给（侧栏只留一个按钮）。
          const sidebar = !isInternalEntry(record);
          row.dispose = pairEntry(callerCtx ?? refs.ctx, slots, record, icon, { sidebar });
          row.paired = true;
          row.sidebar = sidebar;
        }
        refresh(slots);
        return true;
      }
      if (kind === 'removed') {
        const row = registry.get(record.id);
        if (row === undefined) return false;
        registry.delete(record.id);
        if (typeof row.dispose === 'function') row.dispose();
        row.dispose = null;
        row.paired = false;
        refresh(slots);
        return true;
      }
      return false;
    },
    entries() {
      return refresh(refs.slots);
    },
    // ★ 公开面 `ctx.guiFrame.dock.open/close/isOpen` 的落点（三件摊进来；
    //   它们**不收调用方 ctx** —— 面板是**插件整体**的共享 UI，不挂调用方 fiber；语义见 `panel-api.mjs`）。
    ...createDockPanelApi({ openDockPanel, closeDockPanel, isDockPanelOpen }),
    list() {
      return [...registry.values()].map((row) => ({
        id: row.record.id,
        kind: row.record.kind,
        paired: row.paired,
        sidebar: row.sidebar === true,
        badge: row.badge,
      }));
    },
    setBadge(callerCtx, id, badge) {
      const row = registry.get(id);
      if (row === undefined) return false;
      row.badge = badge;
      refresh(refs.slots);
      return true;
    },
    setLabel(callerCtx, id, label) {
      const row = registry.get(id);
      if (row === undefined) return false;
      row.record = { ...row.record, label };
      refresh(refs.slots);
      return true;
    },
    dispose() {
      for (const row of registry.values()) {
        if (typeof row.dispose === 'function') row.dispose();
        row.dispose = null;
        row.paired = false;
        row.sidebar = false;
      }
      registry.clear();
      refresh(refs.slots);
    },
    /** 坞内部面（`__` 前缀：不进公开面快照；测试与诊断用）。 */
    __registry: registry,
    __store: store,
    __live: live,
    __pairEntry: pairEntry,
    /** 管理页工厂（自检页 + 布局编辑器；**不是**按钮面板）。 */
    __createDockOverview: createDockManagePage,
    /** 入口那一页工厂（折回页：到达即开按钮面板 + 把主区还回去）。 */
    __createDockEntryPage: createDockEntryPage,
    __createMainShell: createMainShell,
    __assertEntryId: assertEntryId,
  };

  const dock = {
    api,
    store,
    /**
     * 面板壳的**只读视图**（`get(name)` → 组件或 null）。
     * 坞不再自建组件集合：`Panel`/`Toolbar` 经服务面组件表在渲染期取，
     * 这里只是同一入口的一个薄视图，供诊断/测试读取（不是第二份实现）。
     */
    components: Object.freeze({ get: componentOf }),
    icon: null,
    /** 当前 ctx 下的实时座位快照。 */
    entries(ctx) {
      const slots = ctx === null || ctx === undefined ? null : (probeService(ctx, 'slots') ?? null);
      return live(slots ?? refs.slots);
    },
    list() {
      return api.list();
    },
    setBadge(id, badge) {
      return api.setBadge(null, id, badge);
    },
    setLabel(id, label) {
      return api.setLabel(null, id, label);
    },
    refreshNow() {
      return refresh(refs.slots);
    },
    closePanel,
    /** 装配：全副作用经 ctx.effect；返回幂等 disposer。`ctx` 上缺 `slots` ⇒ 返回 null。 */
    install(ctx) {
      if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') return null;
      const slots = probeService(ctx, 'slots');
      if (slots === undefined || slots === null || typeof slots.inject !== 'function') return null;
      if (service === null || typeof service.__install !== 'function') return null;
      refs.ctx = ctx;
      refs.slots = slots;
      const layout = probeService(ctx, 'layout');
      refs.layout = layout === undefined ? null : layout;
      return effectOn(ctx, 'gui-frame: dock slice + own entry', () => {
        const uninstall = service.__install(DOCK_SLICE_NAME, api);
        // 回放：坞切片装上前注册的入口（恢复完成前注册的直接进坞）
        if (typeof service.__entries === 'function') {
          for (const record of service.__entries()) api.onEntry(ctx, { type: 'added', entry: record });
        }
        // 坞自己的入口
        // `icon` 是注册面的一项：坞**自存自绘**（官方 `register` 只保留 key/id/order/label/priority，
        // 传进去也是被丢掉），不给它图标的话侧栏那一行就只剩一个首字兜底 —— 不给它图标就会让用户找不到入口。
        // 组件是**折回页**（`createDockEntryPage`）：平台那一行点下去 ⇒ `selectPanel(本 id)` ⇒ 到达即开
        // 按钮面板 + 把主区还给会话（管理页挂在工作台那一格，见下面的 `offWorkbenchMain`）。
        const ownEntry = service.register({
          id: DOCK_ENTRY_ID,
          label: () => DOCK_LABEL_FALLBACK,
          order: 0,
          kind: 'panel',
          source: 'dsh-gui-frame',
          icon: createDockIcon(react),
        }, createDockEntryPage());
        // ★ **工作台那一格**（`main[WORKBENCH_PANEL_ID]`）也在**这里**注册：
        // 与坞自己那一格**同源同序**（同一次 install 的同一个 effect 里）：真机读数
        // ——attach 返回 true、日志无异常，但平台 `renderSlot('main', {}, { entryKey })` 查不到这一格
        // ⇒ 工作台打开后中心列空白（全页文本长度 2）。字面量在 `contracts/panel-ids.mjs`（两边同源）。
        const offWorkbenchMain = slots.inject(MAIN_SLOT, () =>
          slots.register({ name: MAIN_SLOT, key: WORKBENCH_PANEL_ID }, createDockManagePage()));
        const offSlots = typeof slots.subscribe === 'function'
          ? [slots.subscribe(PANELLIST_SLOT, () => { refresh(slots); }), slots.subscribe(MAIN_SLOT, () => { refresh(slots); })]
          : [];
        return () => {
          for (const unsubscribe of offSlots) unsubscribe();
          offWorkbenchMain();
          if (typeof ownEntry === 'function') ownEntry();
          api.dispose();
          uninstall();
        };
      });
    },
    __internals: { registry, api, store, refs },
  };

  return dock;
}
