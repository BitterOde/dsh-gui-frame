/**
 * stack.mjs —— **浮层层栈**（overlay-kit 的 orderList 语义，MIT，只借机制不抄码）。
 *
 * 三条语义：
 *  ① **栈序 = id 数组，末尾是最上层**；「点击置顶」＝把 id 移到数组末尾（overlay-kit 的 orderList 同款）；
 *  ② **挂载注册 / 卸载注销**：`add(record)` / `remove(id)`，`remove` 只摘记录不动别人的相对顺序；
 *  ③ **只作用最上层**：`top()` 给 Esc 与点外关闭用。
 *
 * 为什么是「每个 install 一份实例」而不是进程级单例（模块级层栈）：
 * 服务方自动重挂载时**必须幂等、不得残留浮窗** —— 实例随 `install` 的 disposer 一起
 * `clear()`，比全局单例更安全；对使用方而言它同样是「模块级」的（不跨插件共享栈）。
 *
 * 数字层号（z）**只是记录字段**：它由数字层级表分配，栈序只决定**同层内的叠放**。
 * 本文件不碰 DOM、不碰 React（L0 层直测）。
 */

/**
 * @param {{limit?:number}} [options] `limit` 是最大同时存在的浮层数（防御性封顶，超出时最老的被丢弃）
 * @returns {{add:Function, remove:Function, bringToFront:Function, top:Function, get:Function,
 *   ids:Function, records:Function, size:Function, clear:Function, subscribe:Function, dropped:Function}}
 */
export function createOverlayStack(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 64;
  let order = [];
  const records = new Map();
  const listeners = new Set();
  const droppedRows = [];

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 订阅者自己的错不该打断层栈
      }
    }
  };

  return {
    /** 注册一层（已存在同 id 时先摘后加，等价「重新打开即置顶」）。 */
    add(record) {
      if (record === null || record === undefined || typeof record.id !== 'string' || record.id === '') return null;
      if (order.includes(record.id)) order = order.filter((id) => id !== record.id);
      order.push(record.id);
      records.set(record.id, { ...record });
      while (order.length > limit) {
        const evicted = order.shift();
        const row = records.get(evicted);
        records.delete(evicted);
        droppedRows.push({ id: evicted, record: row });
      }
      notify();
      return records.get(record.id);
    },
    remove(id) {
      if (!order.includes(id)) return false;
      order = order.filter((current) => current !== id);
      records.delete(id);
      notify();
      return true;
    },
    /** 点击置顶（**同层内**的叠放序；跨族的上下关系恒由数字层级表决定）。 */
    bringToFront(id) {
      if (!order.includes(id)) return false;
      order = [...order.filter((current) => current !== id), id];
      notify();
      return true;
    },
    top() {
      return order.length === 0 ? null : records.get(order[order.length - 1]);
    },
    get(id) {
      return records.get(id) ?? null;
    },
    ids() {
      return [...order];
    },
    /** 自底向顶的有序记录（宿主按这个顺序渲染 ⇒ DOM 顺序即叠放顺序）。 */
    records() {
      return order.map((id) => records.get(id));
    },
    size() {
      return order.length;
    },
    /** 卸载时清空（幂等的第二道保险：服务方自动重挂载不得残留浮窗）。 */
    clear() {
      order = [];
      records.clear();
      notify();
      return this;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 因超出 `limit` 被丢弃的记录（诊断用）。 */
    dropped() {
      return [...droppedRows];
    },
  };
}
