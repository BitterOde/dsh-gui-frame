/**
 * overlay/index.mjs —— `overlay` 能力的**装配函数**（装配契约 v1）。
 *
 * 装配清单（全部经 `ctx.effect(...)`，随**调用方** fiber 卸载）：
 *  ① `ctx.slots.inject('shell.overlay', () => ctx.slots.register({name, id, order}, OverlayHost))`
 *     —— 官方 `shell.overlay` 是 **list / root** 座位（可叠加、点击穿透、`replaceRisk: none`），**不需要成对注册**；
 *  ② `env.service.__install('overlay', api)` —— 把 `overlay.open/close/bringToFront` 的实现挂到服务面
 *     （切片方法**第一个参数恒为调用方 ctx**，这是冻结契约）。
 *
 * **幂等**：同一服务实例二次 `install` 直接返回第一次的句柄（不重复盖座位、不残留浮层）——
 * 服务方自动重挂载时的硬要求。
 *
 * ⚠ 汇合点 `src/client/entry.mjs`：本文件只导出装配函数，**不自行挂载**。
 */
import { probeService } from '../kit/probe.mjs';

/**
 * 浮动窗组件在**服务面组件表**里的注册名（＝ \`window/index.mjs\` 的 \`WINDOW_COMPONENT_NAME\`）。
 * 两个半区各自定义常量、由测试钉相等 —— 这是本仓既有的跨模块命名范式（见 layout 命名空间那一对）。
 */
export const FLOATING_COMPONENT_NAME = 'FloatingWindow';
import { createDismissController, createEscapeController, createInterceptionLedger } from './dismiss.mjs';
import { FAMILY_ATOMS, createFamily, isModalFamily } from './family.mjs';
import { createOverlayHost } from './host.mjs';
import { createOverlayPanel } from './panel.mjs';
import { createPointerGuard } from './pointer.mjs';
import { createOverlayStack } from './stack.mjs';
import { createToastStack } from './toast.mjs';

/** 座位键（本包收取的 slot 键之一，冻结在 service-face.mjs 的 CONSUMED_SLOT_KEYS 里）。 */
export const OVERLAY_SLOT_KEY = 'shell.overlay';
/** 座位登记 id（带命名空间前缀）。 */
export const OVERLAY_SLOT_ID = 'dsh-gui-frame/overlay';
/** 座位 order（越小越靠前；GUIFrame 不抢官方内容层的位置，取 100）。 */
export const OVERLAY_SLOT_ORDER = 100;
/** 自动生成的窗口 id 前缀。 */
export const WINDOW_ID_PREFIX = 'guif-win-';

/** 每个服务实例只装一次。 */
const INSTALLED = new WeakMap();

function note(env, code, message) {
  try {
    if (env?.service !== null && env?.service !== undefined && typeof env.service.__note === 'function') env.service.__note(code, message);
  } catch {
    // 诊断出问题不影响装配
  }
}

/**
 * @param {object} ctx 调用方 Cordis ctx
 * @param {{service:object, seeds:object}} env 装配契约 v1 的 options bag
 * @returns {{dispose:Function, installed:boolean, host:Function|null, stack:object, toasts:object,
 *   pointer:object, dismiss:object, escape:object, family:object, slot:{key:string,id:string}}}
 */
export function install(ctx, env) {
  const service = env === null || env === undefined ? null : env.service ?? null;
  const seeds = env === null || env === undefined ? null : env.seeds ?? null;
  if (isObject(service) && INSTALLED.has(service)) return INSTALLED.get(service);

  const react = seeds === null || seeds === undefined ? null : seeds.react ?? null;
  const primitives = seeds === null || seeds === undefined ? null : seeds.primitives ?? null;
  const dom = typeof document === 'undefined' ? null : document;

  const stack = createOverlayStack({});
  const pointer = createPointerGuard({ dom });
  const ledger = createInterceptionLedger();
  const toasts = createToastStack(react, { primitives });
  const family = react === null ? null : createFamily(react, primitives);
  /**
   * 浮动窗组件：**渲染期经服务面组件表取**。
   * 本包自己**不登记**这个名字（浮窗能力不在交付面里）—— 名字留给外部经
   * `service.components.register(name, Component)` 贡献实现；取不到 ⇒ 渲染期返回 null
   * （浮层其余部分照常，不抛）。
   */
  const resolveFloatingWindow = () => {
    try {
      const face = service === null || service === undefined ? null : service.components;
      const found = face !== null && typeof face.get === 'function' ? face.get(FLOATING_COMPONENT_NAME) : undefined;
      return typeof found === 'function' ? found : null;
    } catch {
      return null;
    }
  };
  // ★ 面板是与浮动窗**并列的另一个组件**：贴边浮出、无把手条、无缩放手柄、自带表面。
  const Panel = react === null ? null : createOverlayPanel(react, {});

  if (react === null || typeof react.createElement !== 'function') {
    note(env, 'GUIF-W-LISTENER-THREW', 'overlay.install：env.seeds.react 不可用 ⇒ 只登记层栈，不注册宿主');
  }

  /**
   * 点外关闭控制器：
   * `isInside` 走 **React 树**（浮层根 `onPointerDownCapture` 打的标记）；账本非空 ⇒ 不关。
   */
  const dismiss = createDismissController({
    dom: dom ?? { addEventListener() {}, removeEventListener() {} },
    ledger,
    isInside: () => false, // 真正的判内外由 onPointerDownCapture 的标记承担（见 host.mjs）
    onDismiss: () => {
      const top = stack.top();
      if (top === null || top.closable === false) return;
      stack.remove(top.id);
    },
  });
  const escape = createEscapeController({
    dom: dom ?? { addEventListener() {}, removeEventListener() {} },
    top: () => stack.top(),
    onEscape: (entry) => stack.remove(entry.id),
  });

  let windowSeq = 0;

  /** 切片实现：`service.overlay.open/close/bringToFront` 的落点（第一参数恒为调用方 ctx）；`has` 是内部只读面。 */
  const api = {
    /** @param {object} request 已由服务面校验并分配好 `z`（来自数字层级表） */
    open(callerCtx, request) {
      windowSeq += 1;
      const id = typeof request.id === 'string' && request.id !== '' ? request.id : `${WINDOW_ID_PREFIX}${windowSeq}`;
      const familyName = request.family ?? 'floating';

      if (familyName === 'toast') {
        const toastId = toasts.push(request.text ?? request.title ?? '', { holdMs: request.holdMs });
        return {
          id: toastId,
          z: request.z,
          family: 'toast',
          close: () => toasts.dismiss(toastId, 'manual'),
          bringToFront: () => false,
        };
      }

      const record = {
        id,
        family: familyName,
        z: request.z,
        band: request.band,
        modal: isModalFamily(familyName),
        closable: request.closable !== false,
        title: request.title,
        description: request.description,
        content: request.content ?? null,
        actions: request.actions,
        footer: request.footer,
        anchor: request.anchor,
        getAnchorRect: request.getAnchorRect,
        items: request.items,
        onSelect: request.onSelect,
        onRectChange: request.onRectChange,
        closeLabel: request.closeLabel,
        rect: request.initialRect,
        index: windowSeq - 1,
        minVisible: request.minVisible,
      };
      const added = stack.add(record);
      if (added === null) return { id, z: request.z, family: familyName, close: () => false, bringToFront: () => false };
      return {
        id,
        z: request.z,
        family: familyName,
        /** 关闭这扇窗（幂等）。 */
        close: () => stack.remove(id),
        /** 同层内点击置顶。 */
        bringToFront: () => stack.bringToFront(id),
      };
    },
    close(callerCtx, id) {
      if (stack.remove(id)) return true;
      return toasts.dismiss(id, 'manual');
    },
    /**
     * 某一扇窗**此刻是否在场**（只读；`ctx.guiFrame.dock.isOpen()` 问的就是这一句）。
     *
     * 读的是**层栈本身**而不是谁记的状态位：用户按 Esc / 点外 / 点头部 × 关掉的那一扇也必须如实反映
     * （那三条路都直接 `stack.remove`，不经过开窗的人）。吐司不在本判据内（`toast` 族有自己的生命周期）。
     * @param {string} id
     * @returns {boolean}
     */
    has(callerCtx, id) {
      if (typeof id !== 'string' || id === '') return false;
      return stack.get(id) !== null;
    },
    bringToFront(callerCtx, id) {
      return stack.bringToFront(id);
    },
    /** 卸载：清空层栈 + 吐司队列（**幂等**，二次 install 不残留）。 */
    dispose() {
      stack.clear();
      toasts.clear();
      if (pointer.isLocked()) pointer.restoreNow();
    },
  };

  const host = react === null ? null : createOverlayHost(react, {
    stack,
    pointer,
    dismiss,
    escape,
    toasts,
    resolveFloatingWindow,
    Panel,
    family,
    rootZ: request_rootZ(env),
  });

  // ① 座位：官方 shell.overlay（list/root，点击穿透 ⇒ 宿主根容器自己把 pointerEvents 设回 auto）
  let offSlot = null;
  const slots = probeService(ctx, 'slots') ?? null;
  if (host !== null && slots !== null && typeof slots.inject === 'function' && typeof slots.register === 'function') {
    offSlot = slots.inject(OVERLAY_SLOT_KEY, () => slots.register({
      name: OVERLAY_SLOT_KEY,
      id: OVERLAY_SLOT_ID,
      order: OVERLAY_SLOT_ORDER,
    }, host));
  } else if (host !== null) {
    note(env, 'GUIF-W-LISTENER-THREW', 'overlay.install：ctx.slots 不可用 ⇒ 不占座位（允许渐进接入）');
  }

  // ② 服务面分片（**宿主不可用时不装**：宁可让 overlay.open 报「能力未装配」，也不静默收下一个永远不渲染的窗口）
  let offSlice = null;
  if (host !== null && isObject(service) && typeof service.__install === 'function' && typeof service.__slice === 'function' && service.__slice('overlay') === undefined) {
    try {
      offSlice = service.__install('overlay', api);
    } catch (error) {
      note(env, 'GUIF-E-SLICE-INVALID', `overlay.install：分片装配失败（已让位）：${error?.message ?? error}`);
      offSlice = null;
    }
  }

  const raw = () => {
    dismiss.detach();
    escape.detach();
    if (typeof offSlot === 'function') offSlot();
    offSlot = null;
    if (typeof offSlice === 'function') offSlice();
    offSlice = null;
    api.dispose();
    if (isObject(service)) INSTALLED.delete(service);
  };

  const handle = {
    installed: host !== null,
    host,
    stack,
    toasts,
    pointer,
    dismiss,
    escape,
    family,
    api,
    slot: { key: OVERLAY_SLOT_KEY, id: OVERLAY_SLOT_ID, order: OVERLAY_SLOT_ORDER },
    atoms: { ...FAMILY_ATOMS },
    dispose: raw,
  };

  // 装配期的副作用一律挂在**调用方 fiber** 上：fiber 卸载 ⇒ raw() 自动跑
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
    ctx.effect(() => () => raw(), 'gui-frame: install overlay');
  } else {
    note(env, 'GUIF-E-CTX-INVALID', 'overlay.install：ctx.effect 缺失 ⇒ 装配完成但清理需显式调用 dispose()');
  }

  if (isObject(service)) INSTALLED.set(service, handle);
  return handle;
}

/** 对象判据（`null` / `undefined` 一律当「没有」，绝不因为少一个面就抛穿整页）。 */
function isObject(value) {
  return value !== null && value !== undefined && (typeof value === 'object' || typeof value === 'function');
}

/** 宿主根层号：缺省用官方内容层基线（`shell.overlay` 本体已经在这个 z 上）。 */
function request_rootZ(env) {
  const value = env?.rootZ;
  return Number.isInteger(value) ? value : undefined;
}
