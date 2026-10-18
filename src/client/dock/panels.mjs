/**
 * dock/panels.mjs —— **坞的三件面板逻辑**：
 *   · `createMainShell` —— `main` 座位的占用者（面板壳 + 插件组件）；
 *   · `createDockEntryPage` —— **坞自己入口那一页**（`main['dsh-gui-frame/dock']` 的占用者）：
 *     到达即**折回按钮面板**、把主区还给会话/工作台（用户裁定「这一整行是一个按钮」）；
 *   · `closePanel` / `openDockPanel` —— 坞**作用域**里的开/关（`install` 时就注册好，不等组件渲染：
 *     旧实现等组件渲染才赋值 ⇒ 点图标空转，机检实测）。
 * 管理页（自检页 + 布局编辑器）已搬到 `manage-page.mjs`（同域），本模块只留「入口 / 壳 / 开关」。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么入口那一页变成「折回」而不是管理页】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 用户原话：「这是一整个按钮，**不要做成两个**，点开后就是按钮面板。」
 *
 * 平台给的是**一个** `<button class=panelRow>`（内含我们的字形 + 平台渲染的 label），它的 onClick 只有
 * 一个动作：`layout.selectPanel(id)`（`dsh-client-ui-sidebar` 的 `PanelRow`，源码可查）。旧实现把这一行
 * 劈成了两半：字形自己 `stopPropagation` 后直接开浮出面板，而 label 那一半照旧走平台的 `selectPanel`
 * ⇒ 到达**管理页**。于是同一行的两半落到两个地方 —— 用户判「做成了两个」。
 *
 * 现在的口径：**整行只有一个行为** —— 平台的 `selectPanel('dsh-gui-frame/dock')`；坞把这一页做成
 * **折回页**：到达即开浮出按钮面板、随即把主区还回去（工作台开着 ⇒ 还给工作台那一格）。
 * 字形**不再拦点击**（`onActivate` 已删）⇒ 点图标 / 点文字 / 按回车三条路径**结构上就是同一条**。
 *
 * 管理页不再出现在这条路径上：它挂在工作台那一格（`main['dsh-gui-frame/workbench']`，由坞在
 * `install()` 里与自己的入口同源同序注册），浮层能力缺席时本页退化为直接渲染管理页
 * （功能不丢，见 `createDockEntryPage` 的兜底分支）。
 *
 * **入参 bag（18 个，全是本实例的活口）**：`el` / `componentOf` / `useSnapshot` / `store` / `primitives` /
 * `refs` / `service` / `react` / `registry` / `refresh` / `dockLabel` / `entryLabel` / `readDockActions` /
 * `createPanelContent` / `panelRectNear` / `readEntryAnchor` / `DOCK_ENTRY_ID` / `DOCK_LABEL_FALLBACK`。
 * `refs` 是**共享可变对象**（`openPanel` / `layout` / `layoutHandle` 由坞作用域写、这里读）⇒ 整只交接；
 * **状态（`registry` / `store` / `refs`）留在装配侧**，本模块只有行为，不留读数的第二份副本。
 *
 * 交回 7 个口子：`createMainShell` / `createDockEntryPage` / `createDockManagePage`（`dock/core.mjs` 用）
 * 与 `closePanel`（关**主区那一页**，回会话）/ `openDockPanel` / `closeDockPanel` / `isDockPanelOpen`
 * （后者三件是**「按钮面板」本身**的开/关/读，坞作用域：`refs.openPanel` 由本模块自己接上，
 *  公开面 `ctx.guiFrame.dock.open/close/isOpen` 经坞切片落到同样这三个函数上）。
 */
import { createPanelStylesInstaller } from './panel-styles.mjs';
import { createManagePageFactory } from './manage-page.mjs';

/**
 * ★ **「按钮面板」的浮层窗口 id**（是公开契约的一部分：`ctx.guiFrame.dock` 的三件说的就是它）。
 *
 * 形态是 `<坞入口 id>::panel` —— 与坞自己的 `main` 座位（`dsh-gui-frame/dock`）**不同一个 id**：
 * 座位是「主区那一页」，浮出的面板是叠在最上层的一扇 `family:'panel'` 窗口，两者不能共用一个 id
 * （共用了 ⇒ 平台的 `selectPanel(同值)` 不产生状态变化，折回页根本不挂载；这条踩过）。
 *
 * ⚠ 导出的理由不是「测试方便」：`close` / `isOpen` 必须按**同一个字面量**找这扇窗，写在两处就会分叉。
 */
export const DOCK_PANEL_ID = 'dsh-gui-frame/dock::panel';

export function createDockPanels(deps) {
  const {
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, refresh, dockLabel,
    entryLabel, readDockActions, createPanelContent, panelRectNear, readEntryAnchor, DOCK_ENTRY_ID,
    DOCK_LABEL_FALLBACK, effectOn,
  } = deps;
  /**
   * 「面板行样式表」**在位即幂等、丢了会补**（闸与自愈都在 `panel-styles.mjs` 的注入器里）：
   * 主题能力（theme）在场就注入，缺席就退到内联基线。为什么用服务面：`service.__slice('theme').installStyles`
   * —— 不 import theme 模块 ⇒ 不新增能力域直连。
   * ⚠ 传**取值函数**而不是 `refs.ctx` 本体：本模块在 `install(ctx)` 之前就建好，那时 `refs.ctx` 还是
   *   `null`；传快照会让样式表静默丢（真机实测，详见 `panel-styles.mjs`）。
   * ⚠ `effectOn`（内部就是 `ctx.effect`）交进去只为一件事：注入成功后在 `document.head` 上**值守**
   *   —— 样式表被 fiber 卸载摘走时，**正开着的那扇面板**也能自己恢复。
   */
  const ensurePanelStyles = createPanelStylesInstaller(service, () => refs.ctx, effectOn);
  /** 管理页（自检页 + 布局编辑器）：本包自己的地盘，挂在工作台那一格（见 `manage-page.mjs`）。 */
  const createDockManagePage = createManagePageFactory({
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, entryLabel,
    dockLabel, refresh, DOCK_ENTRY_ID, closePanel, ensurePanelStyles,
  });

  /** 造 `main` 座位的占用者：**面板壳 + 插件组件**（ownerProps 为空 ⇒ 壳自己从 hook props 取数）。 */
  function createMainShell(record) {
    function GuiFrameMainPanel(props) {
      const owner = props ?? {};
      const Panel = componentOf('Panel');
      // 面板能力缺席 ⇒ 不套壳，直接把插件组件渲染进 main（页面照常，不占位假壳）
      if (Panel === null) return el(record.Component, owner);
      return el(Panel, {
        id: record.id,
        label: record.label,
        t: owner.t,
        close: () => { closePanel(); },
        usePanelInfo: owner.usePanelInfo,
        useSessions: owner.useSessions,
      }, el(record.Component, owner));
    }
    return GuiFrameMainPanel;
  }

  /**
   * 坞**入口那一页**（`main['dsh-gui-frame/dock']` 的占用者）＝ **折回页**。
   *
   * 它自己**不渲染任何东西**（折回成功时 `null`）：到达这一页 = 用户点了侧栏那一行
   * （点图标 / 点文字 / 按回车，三条路径由平台统一派发到 `selectPanel(id)`）⇒
   *   ① 用**入口字形记的矩形**当锚点，把浮出的「按钮面板」开出来（`refs.openPanel`）；
   *   ② 随即 `selectPanel(null)` —— **平台的「回到会话」**（`ILayout.selectPanel` 的 d.ts 原文：
   *      "Select a global panel or return to the Conversation"）。会话因此留在主区，用户看不到换页。
   *
   * ═══ 这里**不能**按工作台状态去「还给工作台那一格」 ═══
   * 上一版写成「工作台开着（布局自留区 `userLayout.workbench === 'workbench'`）就折回工作台那一格」——
   * 用户随后报「现在一点按钮，会话就没了」。根因：那个自留区是**粘滞的状态位**，不代表工作台那一格
   * **此刻正显示在主区**（用户点一个会话、点别的插件的行，主区都会换成别的东西，而这个位还留着）。
   * 于是折回页把**用户正在看的会话**换成我们的管理页 —— 症状就是这么来的。
   * ⇒ 折回的目标只有一个：**会话**（`null`）。工作台要回中心列，由它自己的开关/主区去选（平台语义对所有
   *   插件那一行都一视同仁：点谁的行，主区就是谁的页）。
   *
   * ★ 折回发生在**浏览器绘制之前** ⇒ 用户看不到「主区换了一页又换回去」
   *   的闪烁（首版用 `useEffect`，那一帧是真的会画出来的）。
   *
   * 两个兜底（都不是「另一种交互」，是能力缺席时的降级）：
   *   · **浮层切片缺席**（`openPanel` 返回 false）⇒ 停在**管理页**上（自检页 + 布局编辑器照旧可用）；
   *   · **主区还不过去**（layout 不在场 / `selectPanel` 抛错）⇒ 同上，不许把用户留在空白页上。
   */
  function createDockEntryPage() {
    const ManagePage = createDockManagePage();
    /**
     * 折回发生在**浏览器绘制之前**（`useLayoutEffect`）⇒ 用户看不到「主区换了一页又换回去」的闪烁。
     * 测试面的假 react 只有 `useEffect` ⇒ 退到它（语义仍对：那一帧折回，只是绘制之后）。
     */
    const useFoldEffect = typeof react.useLayoutEffect === 'function' ? react.useLayoutEffect : react.useEffect;
    function GuiFrameDockEntry(props) {
      const owner = props ?? {};
      const [fallback, setFallback] = react.useState(false);
      const done = react.useRef(false);
      useFoldEffect(() => {
        if (done.current === true) return; // 折回只做一次（重渲染不再动主区）
        done.current = true;
        const opened = typeof refs.openPanel === 'function' ? refs.openPanel(readEntryAnchor(DOCK_ENTRY_ID)) : false;
        if (opened !== true) {
          setFallback(true); // 面板开不出来 ⇒ 停在管理页，功能不丢
          return;
        }
        const layout = refs.layout;
        if (layout === null || layout === undefined || typeof layout.selectPanel !== 'function') {
          setFallback(true);
          return;
        }
        try {
          layout.selectPanel(null); // 平台的「回到会话」：会话留在主区（不许按工作台状态换成别的页）
        } catch {
          setFallback(true);
        }
      }, []);
      return fallback === true ? el(ManagePage, owner) : null;
    }
    return GuiFrameDockEntry;
  }

  /**
   * 关闭当前面板（回到会话）：`ctx.layout.selectPanel(null)`；layout 缺席/抛错都只当「没关成」。
   */
  function closePanel() {
    const layout = refs.layout;
    if (layout === null || typeof layout.selectPanel !== 'function') return false;
    try {
      layout.selectPanel(null);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ★ **打开按钮面板**（坞作用域：`install` 时就注册好，不等任何组件渲染）。
   *
   * 形态：`family: 'panel'` ⇒ 渲染 `overlay/panel.mjs` 的 OverlayPanel
   * （面板基类：不透明表面 + 固定头 + 单一滚动体；**不是**悬浮窗），锚点＝触发它的那颗按钮；
   * 内容：**只有外部插件交进来的 `kind:'action'` 按钮**。
   *
   * @param {{left?:number, top?:number, right?:number, width?:number}|null} anchorRect 触发它的按钮的屏幕矩形
   * @returns {boolean} 面板是否真的打开了（overlay 切片缺席 ⇒ false，调用方据此决定要不要退回管理页）
   */
  function openDockPanel(anchorRect) {
    try {
      const overlay = service === null ? null : service.overlay;
      if (overlay === null || overlay === undefined || typeof overlay.open !== 'function') return false;
      ensurePanelStyles(); // 行样式表（伪类 + 中和注册方外壳）在开面板时按需注入
      const rows = readDockActions(registry, refs.layoutHandle);
      overlay.open({
        id: DOCK_PANEL_ID,
        family: 'panel',
        title: DOCK_LABEL_FALLBACK,
        initialRect: panelRectNear(anchorRect ?? readEntryAnchor(DOCK_ENTRY_ID)),
        content: createPanelContent(el, rows),
      });
      return true;
    } catch {
      return false;
    }
  }
  // 坞一装上就能用（旧实现等面板组件渲染才赋值 ⇒ 点图标空转）。
  refs.openPanel = openDockPanel;

  /**
   * ★ **关掉「按钮面板」**（`ctx.guiFrame.dock.close()` 落到这里）。
   *
   * 与 `closePanel` **不是一件事**：那个关的是**主区那一页**（`selectPanel(null)` ＝ 回会话），
   * 这个关的是叠在最上层的那扇浮出面板（同一扇窗）。
   *
   * 语义：**幂等** —— 不在场 / 浮层能力缺席 / 坞自己就是在场者之外 ⇒ 一律 `false`（不抛）。
   * 层栈的 `remove` 只认 id，所以「谁开的都能关」是有意的：这是共享 UI 的一扇窗（详见 DockFace 注释）。
   *
   * @returns {boolean} 关之前它是否在场
   */
  function closeDockPanel() {
    try {
      const overlay = service === null ? null : service.overlay;
      if (overlay === null || overlay === undefined || typeof overlay.close !== 'function') return false;
      return overlay.close(DOCK_PANEL_ID) === true;
    } catch {
      return false;
    }
  }

  /**
   * ★ **面板此刻是否在场**（`ctx.guiFrame.dock.isOpen()` 落到这里）。
   *
   * 为什么要有它：光有 open/close 的返回值不够 —— 用户随时能用头部 × / Esc / 点外把它关掉，
   * 那三条路都不经过我们（层栈自己 `remove`）。⇒ 唯一诚实的读法是**问层栈**：
   * `overlay` 切片的 `has(id)`（`stack.get(id) !== null`）。
   *
   * 拿不到浮层切片 / 老切片没有 `has` ⇒ `false`（没有一层「我们说它在、屏幕上看不见」的第二份状态）。
   *
   * @returns {boolean}
   */
  function isDockPanelOpen() {
    try {
      const slice = service !== null && typeof service.__slice === 'function' ? service.__slice('overlay') : undefined;
      if (slice === undefined || slice === null || typeof slice.has !== 'function') return false;
      return slice.has(refs.ctx, DOCK_PANEL_ID) === true;
    } catch {
      return false;
    }
  }

  // 交回装配面：三件页面工厂 + 主区开关 + 「按钮面板」自己的开/关/读三件。
  return { createMainShell, createDockEntryPage, createDockManagePage, closePanel, openDockPanel, closeDockPanel, isDockPanelOpen };
}
