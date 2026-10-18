/**
 * styles.mjs —— **浮层宿主容器**的样式（宿主容器样式归 overlay 域）。
 *
 * 为什么搬到这里：这两条样式描述的是 **overlay 自己的宿主节点**（整屏点击穿透的根容器 + 每层的包裹节点），
 * 却住在 window/styles.mjs 里 ⇒ 浮层能力要反向 import 窗口能力（能力↔能力直连）。归位后
 * overlay/** 自己拥有它，窗口能力不再被浮层「借用」。
 *
 * 契约不变（真机结论原样带走）：根容器**必须保持点击穿透**（pointerEvents:none），每层用
 * `display:contents` 把子树恢复成 `auto` —— 真机实测里坞入口全员点不动就是根容器变 auto 造成的。
 */
/**
 * OverlayHost 根容器的样式：**必须保持点击穿透（`pointerEvents: 'none'`）**。
 *
 * 官方 `shell.overlay` 的 layer 本体是点击穿透的（doc 原文「click-through — entries opt back into
 * pointer events」）—— 但「opt back in」是让**条目**（每扇窗 / 弹层 / 吐司）恢复可交互，
 * **不是**让这个 `inset: 0` 的整屏空容器恢复：容器一旦 `auto`，它就成了**全屏遮罩**，
 * 页面上任何真鼠标点击都会落在它身上。
 * 真机实测（`verify/real-machine` 的命中测试）：坞入口与四个面板动作**全员**命中
 * 「遮挡(DIV.)」—— 那个无 class 的 DIV 就是这个整屏容器 ⇒ 用户用鼠标点不动界面。
 * ⇒ 根容器恒 `none`（点击穿透），每层由 `layerStyle()` 的包裹节点把子树恢复成 `auto`。
 * @param {number} rootZ 根层号（来自数字层级表的「下带」，缺省用内容层基线 20）
 */
export function overlayRootStyle(rootZ) {
  return {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: rootZ,
  };
}

/**
 * 单层包裹节点（`OverlayHost` 里每层一个）的样式。
 *
 * `display: contents` ⇒ **不生成盒子**（布局上与不存在等价，不影响窗口的绝对定位与叠放序），
 * 只把 `pointer-events` 恢复成 `auto`，让子树（浮动窗 / 官方弹层原子 / 吐司）可交互 ——
 * 这正是官方「entries opt back into pointer events」的落点，且不会像整屏容器那样吞掉页面点击。
 */
export function overlayLayerStyle() {
  return {
    display: 'contents',
    pointerEvents: 'auto',
  };
}
