/**
 * dock/panel-api.mjs —— **「按钮面板」的坞切片三件套**（公开面 `ctx.guiFrame.dock.open/close/isOpen`）。
 *
 * 为什么单独一件（与 `store-face.mjs` / `panel-content.mjs` 同一手法）：`dock/core.mjs` 已顶到
 * 320 行上限 —— 这三段的**契约说明比实现长得多**，塞回 core 只会把注释挤掉或把文件挤破。
 *
 * ═══ 三件的语义（真源在 `service/faces.mjs` 的 `DockFace`；这里只说落点）═══
 *   · `open(anchor)`：坞作用域那个 `openDockPanel` —— 与「点侧栏那一行」**同一扇**窗
 *     （同一个 `DOCK_PANEL_ID`、同一份正文、同一套锚点规则）；`anchor` 缺省/`null` ⇒ 用入口字形记的矩形；
 *   · `close()`：`closeDockPanel` —— **幂等**，返回「关之前它是否在场」；
 *   · `isOpen()`：`isDockPanelOpen` —— 读**层栈**（用户按 Esc / 点外关掉的也算数），不另记状态位。
 *
 * ⚠ 三件**都不收调用方 ctx**：面板是**插件整体**的共享 UI，不往调用方 fiber 挂任何东西
 *   （对照 `onEntry` / `setBadge` 那几件收 callerCtx 是因为它们要把座位挂到注册方的 fiber 上）。
 *
 * @param {{openDockPanel:Function, closeDockPanel:Function, isDockPanelOpen:Function}} deps 坞作用域的三个函数
 * @returns {{open:Function, close:Function, isOpen:Function}} 直接摊进坞切片面（`service.__slice('dock')`）
 */
export function createDockPanelApi(deps) {
  const { openDockPanel, closeDockPanel, isDockPanelOpen } = deps;
  return {
    open(anchor) {
      return openDockPanel(anchor ?? null) === true;
    },
    close() {
      return closeDockPanel() === true;
    },
    isOpen() {
      return isDockPanelOpen() === true;
    },
  };
}
