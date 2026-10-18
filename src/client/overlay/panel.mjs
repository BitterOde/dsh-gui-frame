/**
 * overlay/panel.mjs —— **浮出面板的呈现层**（托管浮层 `panel` 族）。
 *
 * ═══ 它与「悬浮窗」是两个组件（用户原话）═══
 * 「你能不能把『悬浮窗』和『面板』两个组件区分开？你不认得吗？」
 *
 *   | | 悬浮窗 `FloatingWindow` | 面板（本文件＝基类 + 定位） |
 *   | --- | --- | --- |
 *   | 定位 | 自由摆放（拖动 + 缩放 + 贴边吸附） | **锚定**：贴住触发它的那颗按钮 |
 *   | 形状 | 窗口：空白把手条 + 标题栏 + 缩放手柄 | 面板：**脸 + 头 + 内容区**，无把手、无缩放 |
 *   | 生命周期 | 用户摆放（位置/大小被记住） | 点开即来、Esc / 点外即走 |
 *
 * ═══ 皮在基类里（本轮返工的根因）═══
 * 上一版这里自己写了一层样式（**透明裸 div** ⇒ 用户判「你现在的面板连背景都没有」），而
 * `components.Panel` 另有一套皮。现在表面/头部/分隔线**全部来自 `panel/base.mjs`**（主区面板与
 * 浮出面板共用同一份 ⇒ 不可能再漂移）；本文件只负责**锚定定位**这一件事。
 *
 * 本文件零副作用：只造组件。
 */
import { BASE_ANCHORS, createPanelParts } from '../kit/surface.mjs';

/** 面板族名（与 `contracts/layers.mjs` 的 `LAYER_FAMILIES` 同字面）。 */
export const PANEL_FAMILY = 'panel';
/** 缺省尺寸（可被 `initialRect` 覆盖；面板**不**给用户改尺寸 —— 尺寸是形态的一部分）。 */
export const OVERLAY_PANEL_DEFAULT_SIZE = Object.freeze({ width: 320, height: 420 });

/** 机器锚点（真机装置按它们读「面板在不在、标题是什么、内容区在哪」）。 */
export const PANEL_ATTR = BASE_ANCHORS.frame;
export const PANEL_HEADER_ATTR = BASE_ANCHORS.header;
export const PANEL_TITLE_ATTR = BASE_ANCHORS.title;
export const PANEL_CLOSE_ATTR = BASE_ANCHORS.close;
export const PANEL_BODY_ATTR = BASE_ANCHORS.body;

/**
 * 造**浮出面板**组件（工厂模式：react 只能从 `env.seeds.react` 来 —— 模块不 import 裸包名）。
 * @param {object} react 种子 react
 * @param {{defaultSize?:{width:number, height:number}}} [runtime]
 * @returns {Function} 组件：`(props) => element`
 */
export function createOverlayPanel(react, runtime = {}) {
  const el = react.createElement;
  const parts = createPanelParts(react);
  const fallbackSize = runtime.defaultSize ?? OVERLAY_PANEL_DEFAULT_SIZE;

  /**
   * @param {object} props
   *  - `id`（必填）/ `z`（数字层级表分配的层号）/ `title` / `closeLabel`
   *  - `rect`：`{x, y, width?, height?}` —— 由调用方**贴着触发它的按钮**算好（面板不自己找位置）
   *  - `children`：内容（按钮面板＝外部插件交进来的按钮）/ `onClose`
   */
  return function OverlayPanel(props) {
    const p = props ?? {};
    const rect = p.rect ?? {};
    const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : fallbackSize.width;
    const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : fallbackSize.height;
    const x = Number.isFinite(rect.x) ? rect.x : 0;
    const y = Number.isFinite(rect.y) ? rect.y : 0;
    const id = String(p.id ?? '');
    const title = typeof p.title === 'string' && p.title !== '' ? p.title : '面板';
    const onClose = typeof p.onClose === 'function' ? p.onClose : null;

    return el(parts.Frame, {
      id,
      family: PANEL_FAMILY,
      z: p.z,
      role: 'dialog',
      label: title,
      onPointerDownCapture: p.onPointerDownCapture,
      // 定位是**面板这一层**的事：基类只管脸，不猜它待在哪。
      style: {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: Number.isFinite(p.z) ? p.z : undefined,
      },
    },
    el(parts.Header, { key: 'head', id, title, onClose, closeLabel: p.closeLabel }),
    el(parts.Body, { key: 'body', id }, p.children ?? null));
  };
}
