/**
 * toast.mjs —— **Toast 的宿主与堆叠**（实测：官方只给原子、没有宿主）。
 *
 * 为什么必须自研这一层：官方 primitives 的 `Toast` 只是个**原子**（签名
 * `{text, icon, anchor, holdMs, onDone}`，内部 `createPortal` 到 body），
 * 实测结论原文是「**没有 Toast 宿主/堆栈管理器**」——
 * 队列、堆叠顺序、时长、满员淘汰、卸载全得宿主自己做。
 *
 * 本文件负责：FIFO 队列 + 最大同时条数 + 自动消失 + 手动关闭 + 幂等卸载；
 * 渲染时**复用官方原子** `primitives.Toast`（不重画外观）。
 */

/** 同时最多几条（超出即淘汰最老的）。 */
export const TOAST_MAX_VISIBLE = 3;
/** 单条默认停留时长（ms）。 */
export const TOAST_HOLD_MS = 4000;

/**
 * @param {object} react 种子里的 React
 * @param {{primitives?:object, max?:number, holdMs?:number, schedule?:Function, cancel?:Function}} [options]
 * @returns {{push:Function, dismiss:Function, clear:Function, items:Function, subscribe:Function,
 *   size:Function, component:Function, stats:Function}}
 */
export function createToastStack(react, options = {}) {
  const primitives = options.primitives ?? null;
  const max = Number.isInteger(options.max) && options.max > 0 ? options.max : TOAST_MAX_VISIBLE;
  const holdMs = Number.isInteger(options.holdMs) && options.holdMs > 0 ? options.holdMs : TOAST_HOLD_MS;
  const schedule = typeof options.schedule === 'function' ? options.schedule : (fn, ms) => setTimeout(fn, ms);
  const cancel = typeof options.cancel === 'function' ? options.cancel : (handle) => clearTimeout(handle);
  /** 容器自身的层号（由数字层级表的 toast 族分配；缺省给 toast 段下界）。 */
  const containerZ = Number.isInteger(options.z) ? options.z : 600;

  let seq = 0;
  let items = [];
  const timers = new Map();
  const listeners = new Set();
  const stats = { pushed: 0, dropped: 0, autoDismissed: 0, manualDismissed: 0 };

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 订阅者抛错不打断队列
      }
    }
  };

  const clearTimer = (id) => {
    if (!timers.has(id)) return;
    cancel(timers.get(id));
    timers.delete(id);
  };

  const dismiss = (id, reason = 'manual') => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    clearTimer(id);
    items = items.filter((item) => item.id !== id);
    if (reason === 'auto') stats.autoDismissed += 1;
    else stats.manualDismissed += 1;
    notify();
    return true;
  };

  const push = (text, pushOptions = {}) => {
    seq += 1;
    const id = `guif-toast-${seq}`;
    const item = { id, text: String(text ?? ''), holdMs: Number.isInteger(pushOptions.holdMs) ? pushOptions.holdMs : holdMs, at: seq };
    items = [...items, item];
    stats.pushed += 1;
    while (items.length > max) {
      const evicted = items[0];
      clearTimer(evicted.id);
      items = items.slice(1);
      stats.dropped += 1;
    }
    timers.set(id, schedule(() => dismiss(id, 'auto'), item.holdMs));
    notify();
    return id;
  };

  /** 宿主渲染的 Toast 容器（**自研堆叠**：FIFO ⇒ 老的在上面，新的往下排）。 */
  function ToastStack() {
    const [, force] = react.useState(0);
    react.useEffect(() => subscribe(() => force((value) => value + 1)), []);
    const rows = items.map((item) => {
      if (primitives !== null && typeof primitives.Toast === 'function') {
        return react.createElement(primitives.Toast, {
          key: item.id,
          text: item.text,
          holdMs: item.holdMs,
          onDone: () => dismiss(item.id, 'manual'),
        });
      }
      // 官方原子不可用时的退化形态（仍然是我们自己的堆叠与时长）
      return react.createElement('div', { key: item.id, role: 'alert', 'data-guif-toast': item.id }, item.text);
    });
    return react.createElement('div', {
      'data-guif-toast-stack': '',
      style: {
        position: 'absolute',
        right: '12px',
        bottom: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        pointerEvents: 'auto',
        zIndex: containerZ,
      },
    }, rows);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** 清空队列 + **摘掉所有定时器**（幂等卸载：不留悬挂 timer）。**不用 `this`**（解构后也能调用）。 */
  const clear = () => {
    for (const id of [...timers.keys()]) clearTimer(id);
    items = [];
    notify();
  };

  return {
    push,
    dismiss,
    clear,
    items() {
      return items.map((item) => ({ ...item }));
    },
    subscribe,
    size() {
      return items.length;
    },
    component: ToastStack,
    stats() {
      return { ...stats, pending: timers.size };
    },
  };
}
