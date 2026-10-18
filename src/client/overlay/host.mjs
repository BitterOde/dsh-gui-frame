/**
 * host.mjs —— **OverlayHost**：挂在官方 `shell.overlay` 座位上的浮层宿主。
 *
 * 三件事，逐条对着官方实测：
 *  ① **根容器必须显式把 `pointerEvents` 设回 `auto`**：官方 `shell.overlay` 的 layer 本体是
 *     **点击穿透**的（doc 原文「click-through — entries opt back into pointer events」），
 *     不设回来整层收不到任何点击；
 *  ② **层栈自底向顶渲染**（DOM 顺序 = 同层内叠放顺序），每扇窗自带 `data-guif-z` 实际层号；
 *  ③ **Esc / 点外**两个控制器在这里挂载（只在宿主真的挂上时挂监听，卸载即摘）。
 *
 * 浮层之下不可交互：**只有模态族（dialog）**才锁 `body` 的 `pointer-events`；
 * 浮动窗/气泡/吐司是非模态的，锁 body 会把整个应用点不动 —— 那条只适用于模态。
 */
import { CONTENT_LAYER_Z } from '../contracts/layers.mjs';
import { overlayLayerStyle, overlayRootStyle } from './styles.mjs';

/** 宿主根节点的属性（真机断言锚点）。 */
export const OVERLAY_ROOT_ATTR = 'data-guif-overlay-root';
/**
 * 每层包裹节点的属性（值＝该层的 id）。
 * 它是「entries opt back into pointer events」的落点：根容器是 `pointer-events: none` 的整屏空壳
 * （点击穿透，不吞页面点击），**由这个包裹节点把子树恢复成 `auto`**；`display: contents` 不生成盒子，
 * 所以窗口的绝对定位与 DOM 叠放序都不受影响。
 */
export const OVERLAY_LAYER_ATTR = 'data-guif-overlay-layer';

/**
 * 造 OverlayHost 组件。
 * @param {object} react 种子里的 React
 * @param {{stack:object, pointer:object, dismiss:object, escape:object, toasts:object,
 *   FloatingWindow:Function, family:object, rootZ?:number, containerRef?:object}} runtime
 *   全部依赖都是**注入**的：组件本身不 import 任何平台件、不碰服务面。
 */
export function createOverlayHost(react, runtime) {
  const rootZ = Number.isInteger(runtime.rootZ) ? runtime.rootZ : CONTENT_LAYER_Z;
  /**
 * 浮动窗组件：**渲染期经 resolver 取**（overlay 不 import window/**；跨能力只走 service）。
 * 兼容老用法：调用方直接给 `runtime.FloatingWindow` 时，缺省 resolver 就返回它（单测替身照旧）。
 */
const resolveFloatingWindow = typeof runtime.resolveFloatingWindow === 'function'
  ? runtime.resolveFloatingWindow
  : () => runtime.FloatingWindow;
  const family = runtime.family;

  /**
   * 单层包裹：根容器是 `pointer-events: none` 的整屏空壳（点击穿透），这里**逐层**把交互恢复回来。
   * `display: contents` 不生成盒子 ⇒ 不影响窗口的绝对定位与 DOM 叠放序。
   */
  function renderLayer(record) {
    return react.createElement('div', {
      key: record.id,
      [OVERLAY_LAYER_ATTR]: record.id,
      style: overlayLayerStyle(),
    }, renderLayerBody(record));
  }

  /** 单层内容：**面板**走 OverlayPanel，浮动窗走 FloatingWindow，模态/气泡走官方原子薄壳。 */
  function renderLayerBody(record) {
    const common = { key: record.id, id: record.id, z: record.z, family: record.family };
    if (record.family === 'panel' && typeof runtime.Panel === 'function') {
      // ⚠ 面板**不是**浮动窗：没有把手条、没有缩放手柄、不参与拖动 —— 它就是贴边浮出的一块面
      //   （用户裁定「面板」与「悬浮窗」是两个组件，不得混用）。
      return react.createElement(runtime.Panel, {
        key: record.id,
        id: record.id,
        z: record.z,
        title: record.title,
        description: record.description,
        closeLabel: record.closeLabel,
        rect: record.rect,
        onClose: record.closable === false ? undefined : () => runtime.stack.remove(record.id),
        onPointerDownCapture: () => runtime.dismiss.onPointerDownCapture(),
      }, record.content ?? null);
    }
    if (record.family === 'dialog' && family !== null && family !== undefined) {
      return react.createElement(family.Dialog, {
        key: record.id,
        open: true,
        onClose: () => runtime.stack.remove(record.id),
        title: record.title,
        closeLabel: record.closeLabel ?? '关闭',
        description: record.description,
        footer: record.footer,
        children: record.content ?? null,
      });
    }
    if (record.family === 'popover' && family !== null && family !== undefined) {
      return react.createElement(family.Popover, {
        key: record.id,
        open: true,
        anchor: record.anchor,
        getAnchorRect: record.getAnchorRect,
        items: record.items ?? [],
        onSelect: record.onSelect,
        onClose: () => runtime.stack.remove(record.id),
        children: record.content ?? null,
      });
    }
    const FloatingWindow = resolveFloatingWindow();
    if (typeof FloatingWindow !== 'function') return null;
    return react.createElement(FloatingWindow, {
      ...common,
      title: record.title,
      children: record.content ?? null,
      actions: record.actions,
      footer: record.footer,
      initialRect: record.rect,
      index: record.index,
      containerRef: runtime.containerRef ?? null,
      minVisible: record.minVisible,
      onClose: record.closable === false ? undefined : () => runtime.stack.remove(record.id),
      onBringToFront: (id) => runtime.stack.bringToFront(id),
      onPointerDownCapture: () => runtime.dismiss.onPointerDownCapture(),
      onRectChange: (change) => {
        record.rect = change.rect;
        if (typeof record.onRectChange === 'function') record.onRectChange(change);
      },
    });
  }

  function OverlayHost() {
    const [, force] = react.useState(0);
    const records = runtime.stack.records();
    const modalCount = records.filter((record) => record.modal === true).length;
    const toastCount = runtime.toasts === null || runtime.toasts === undefined ? 0 : runtime.toasts.size();

    // 层栈变化 ⇒ 重渲染（订阅随宿主 mount/unmount 成对摘挂）
    react.useEffect(() => runtime.stack.subscribe(() => force((value) => value + 1)), []);

    // Esc / 点外两个控制器：只在宿主挂上时挂监听，卸载即摘
    react.useEffect(() => {
      runtime.dismiss.attach();
      runtime.escape.attach();
      return () => {
        runtime.dismiss.detach();
        runtime.escape.detach();
      };
    }, []);

    // 模态层在 ⇒ 锁 body；最后一层模态走掉 ⇒ **严格还原原值**
    react.useEffect(() => {
      if (modalCount === 0) return undefined;
      const unlock = runtime.pointer.lock();
      return () => unlock();
    }, [modalCount > 0, modalCount]);

    // 吐司变化 ⇒ 重渲染
    react.useEffect(() => {
      if (runtime.toasts === null || runtime.toasts === undefined) return undefined;
      return runtime.toasts.subscribe(() => force((value) => value + 1));
    }, []);

    const children = [];
    for (const record of records) {
      const node = renderLayer(record);
      if (node !== null) children.push(node);
    }
    if (toastCount > 0) children.push(react.createElement(runtime.toasts.component, { key: 'guif-toasts' }));

    return react.createElement('div', {
      [OVERLAY_ROOT_ATTR]: '',
      'data-guif-overlay-layers': String(records.length),
      style: overlayRootStyle(rootZ),
      onPointerDownCapture: () => runtime.dismiss.onPointerDownCapture(),
    }, children);
  }

  return OverlayHost;
}
