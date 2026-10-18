/**
 * dismiss.mjs —— **Esc 与点外关闭**。
 *
 * 三条机制，逐条对着 Radix（`@radix-ui/react-dismissable-layer@1.1.19`，MIT，只借机制不抄码）：
 *
 * ① **判内外用 React 树，不用 DOM 树**：浮层内容可能在 portal 里（DOM 上不是兄弟），
 *    `contains()` 判不出来 ⇒ 由浮层根节点的 `onPointerDownCapture` 打标（宿主把它接到这里）。
 * ② **`pointerdown` 监听延迟一个 macrotask 才挂**：否则「打开浮层的那一次点击」会立刻把它关掉。
 * ③ **六种后续事件的「捕获期置 true / 冒泡期置 false」拦截账本**：
 *    `['pointerup','mousedown','mouseup','touchstart','touchend','click']` 同时挂捕获期与冒泡期，
 *    账本里任一为 `true` ⇒ **这次外部交互是被拦截的**（典型：**拖拽在浮层外松手**）⇒ **不关**。
 *
 * 额外两条本项目口径：
 *  - **Esc 只在真的关掉一层时 `preventDefault`**（捕获期只打标、不吞事件，
 *    免得抢掉插件自己的 Esc）；
 *  - **始终只作用最上层**：Esc 关栈顶，点外也只关栈顶。
 *
 * 本文件不碰 React、不碰服务面：注入 `dom` / `schedule` 即可在 node 里直测（L0/L3）。
 */

/**
 * 六种后续事件（真源逐字清单）。
 * 捕获期置 `true` / 冒泡期置 `false` —— 账本非空即「外部交互被拦截」。
 */
export const OUTSIDE_INTERCEPTION_EVENTS = Object.freeze([
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'click',
]);

/** 手势进行中的显式标记键（拖拽在飞时由业务侧 hold/release）。 */
export const GESTURE_HOLD_KEY = 'guif-gesture';

/**
 * 拦截账本：**纯状态机**（不碰 DOM）。
 * `mark(type, true)` / `mark(type, false)` 由捕获/冒泡两个监听器驱动；
 * `hold()` / `release()` 是业务侧（拖动手势）的显式标记。
 */
export function createInterceptionLedger() {
  const state = new Map();
  return {
    types: OUTSIDE_INTERCEPTION_EVENTS,
    mark(type, value) {
      state.set(type, value === true);
      return value === true;
    },
    hold(key = GESTURE_HOLD_KEY) {
      state.set(key, true);
    },
    release(key = GESTURE_HOLD_KEY) {
      state.set(key, false);
    },
    /** 任一为 `true` ⇒ 被拦截（真源原文的判据）。 */
    isIntercepted() {
      for (const value of state.values()) if (value === true) return true;
      return false;
    },
    snapshot() {
      return Object.fromEntries(state.entries());
    },
    reset() {
      state.clear();
    },
    size() {
      return state.size;
    },
  };
}

/**
 * 造一个点外关闭控制器。
 *
 * @param {{dom:object, isInside:(event:object)=>boolean, onDismiss:(event:object, reason:string)=>void,
 *   ledger?:object, schedule?:(fn:Function)=>unknown, cancel?:(handle:unknown)=>void, enabled?:()=>boolean}} options
 *   - `dom`：document-like（必须支持 addEventListener/removeEventListener；测试可注入替身）
 *   - `isInside`：**React 树判内外**（宿主用浮层根的 `onPointerDownCapture` 打标后回读）
 *   - `schedule`：macrotask 调度器（缺省 `setTimeout(fn, 0)`；测试可注入同步/手动触发器）
 * @returns {{attach:Function, detach:Function, onPointerDownCapture:Function, ledger:object,
 *   armed:Function, calls:Function}}
 */
export function createDismissController(options = {}) {
  const dom = options.dom;
  const ledger = options.ledger ?? createInterceptionLedger();
  const schedule = typeof options.schedule === 'function' ? options.schedule : (fn) => setTimeout(fn, 0);
  const cancel = typeof options.cancel === 'function' ? options.cancel : (handle) => clearTimeout(handle);
  const eventLog = [];

  let armed = false;
  let pending = null;
  let attached = false;
  // React 树判内外的标记：由浮层根的 onPointerDownCapture 置 true，决策时消费后清零
  let insideReactTree = false;

  const captureMarker = (event) => {
    ledger.mark(event.type, true); // 捕获期：这次外部交互「正在进行」
    eventLog.push({ phase: 'capture', type: event.type });
  };
  const bubbleMarker = (event) => {
    ledger.mark(event.type, false); // 冒泡期：这次外部交互「已经走完」
    eventLog.push({ phase: 'bubble', type: event.type });
  };

  const onPointerDown = (event) => {
    if (options.enabled !== undefined && options.enabled() === false) return;
    const inside = insideReactTree || (typeof options.isInside === 'function' && options.isInside(event) === true);
    insideReactTree = false;
    if (inside) {
      eventLog.push({ phase: 'pointerdown', type: 'inside' });
      return; // ① React 树判内外：点在浮层自己身上 ⇒ 什么都不做
    }
    if (ledger.isIntercepted()) {
      // ③ 账本非空 ⇒ 这次外部交互是被拦截的（拖拽在层外松手）⇒ 不关
      eventLog.push({ phase: 'pointerdown', type: 'intercepted' });
      ledger.reset();
      return;
    }
    eventLog.push({ phase: 'pointerdown', type: 'outside' });
    ledger.reset();
    if (typeof options.onDismiss === 'function') options.onDismiss(event, 'outside');
  };

  return {
    ledger,
    /** 浮层根节点把它接到 `onPointerDownCapture` 上（React 树判内外的唯一入口）。 */
    onPointerDownCapture() {
      insideReactTree = true;
    },
    armed() {
      return armed;
    },
    /** 事件账本（测试/诊断读得到「谁在捕获期、谁在冒泡期」）。 */
    calls() {
      return [...eventLog];
    },
    /** 挂监听：六种事件**同时**挂捕获期与冒泡期；`pointerdown` **延迟一个 macrotask** 才挂（②）。 */
    attach() {
      if (attached) return this;
      attached = true;
      for (const type of OUTSIDE_INTERCEPTION_EVENTS) {
        dom.addEventListener(type, captureMarker, { capture: true });
        dom.addEventListener(type, bubbleMarker, { capture: false });
      }
      pending = schedule(() => {
        pending = null;
        armed = true;
        dom.addEventListener('pointerdown', onPointerDown, { capture: false });
      });
      return this;
    },
    /** 摘监听（**逐条对称摘**，含还没武装的那次延迟）。 */
    detach() {
      if (!attached) return this;
      attached = false;
      armed = false;
      if (pending !== null) {
        cancel(pending);
        pending = null;
      }
      for (const type of OUTSIDE_INTERCEPTION_EVENTS) {
        dom.removeEventListener(type, captureMarker, { capture: true });
        dom.removeEventListener(type, bubbleMarker, { capture: false });
      }
      dom.removeEventListener('pointerdown', onPointerDown, { capture: false });
      insideReactTree = false;
      return this;
    },
  };
}

/**
 * 造一个 Esc 控制器：**只关最上层**，且**只在真关掉一层时 `preventDefault`**。
 *
 * @param {{dom:object, top:()=>object|null, onEscape:(entry:object)=>void, enabled?:()=>boolean}} options
 *   `top()` 返回栈顶条目（`null` = 没有浮层）；`onEscape` 负责真正关闭它
 * @returns {{attach:Function, detach:Function, handle:Function}}
 */
export function createEscapeController(options = {}) {
  const dom = options.dom;
  let attached = false;

  const handle = (event) => {
    if (event === null || event === undefined) return false;
    if (event.key !== 'Escape' && event.key !== 'Esc') return false;
    if (options.enabled !== undefined && options.enabled() === false) return false;
    const entry = typeof options.top === 'function' ? options.top() : null;
    if (entry === null || entry === undefined) return false;
    if (entry.closable === false) return false;
    if (typeof options.onEscape === 'function') options.onEscape(entry);
    // 只有「真的关掉了一层」才吞掉事件（捕获期只打标，不抢插件的 Esc）
    if (typeof event.preventDefault === 'function') event.preventDefault();
    return true;
  };

  return {
    handle,
    attach() {
      if (attached) return this;
      attached = true;
      // 捕获期：抢在插件之前看到 Esc（`defaultPrevented` 协作）
      dom.addEventListener('keydown', handle, { capture: true });
      return this;
    },
    detach() {
      if (!attached) return this;
      attached = false;
      dom.removeEventListener('keydown', handle, { capture: true });
      return this;
    },
  };
}
