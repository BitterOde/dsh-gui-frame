/**
 * store.mjs —— 坞/面板的**快照数据源**：优先用官方 `dsh-client-store` 种子，缺席时退到自研等价物。
 *
 * 官方形状（本机 0.2.0-rc.2 实读外壳产物偏移 ≈199 450 的 `createSnapshotStore`）：
 *   `createSnapshotStore(initial, options?) → { getSnapshot(), subscribe(cb), update(mutator), set(value) }`
 * —— 与 `ui-sidebar` 内部做法一致（它把 `createSnapshotStore([])` 交给 `ctx.slots.provideRoot({hooks})`，
 * 组件侧则以 `usePanels(selector)` 读）。GUIFrame 的坞是**本插件自己的**数据源，所以直接把它当普通
 * store 用：组件用 `useDockSnapshot(store, selector)` 订阅（本文件的 `createStoreHook`）。
 *
 * 为什么要有自己的 hook 而不是 `provideRoot({hooks})`：`provideRoot` 的 hook 名**必须全局唯一**且属
 * root 标准座位（`useResource/useWorkspaces/usePanelInfo/useSessions/…`）——本插件往那里塞名字会与
 * 官方/第三方撞名（「名字全局唯一」约束）。自己造 hook 只需 `react.useState/useEffect`，
 * 在真 React 与无 DOM 替身上都能跑。
 *
 * 本文件**零副作用**：只在被调用时造对象。
 */

/**
 * 造一个快照 store。
 * @param {object|undefined|null} seeds 种子表（`seeds.store.createSnapshotStore` 优先）
 * @param {unknown} initial 初始快照
 * @returns {{getSnapshot:()=>unknown, subscribe:(cb:Function)=>()=>void, set:(value:unknown)=>void, update:(fn:Function)=>void}}
 */
export function createSnapshotStore(seeds, initial) {
  const seed = seeds !== null && typeof seeds === 'object' ? seeds.store : null;
  const factory = seed !== null && typeof seed === 'object' ? seed.createSnapshotStore : null;
  if (typeof factory === 'function') {
    const official = factory(initial);
    if (official !== null && typeof official === 'object' && typeof official.getSnapshot === 'function' && typeof official.subscribe === 'function') {
      return official;
    }
  }
  return createMinimalStore(initial);
}

/**
 * 自研最小等价物（**只**在官方种子缺席时使用）。
 * 语义与官方一致：`set` 整体替换、`update` 走 mutator、`subscribe` 返回取消函数。
 */
export function createMinimalStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot() {
      return value;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // 订阅者抛错不连坐其他人（与官方 notifySubscribers 的隔离口径一致）
        }
      }
    },
    update(mutator) {
      if (typeof mutator !== 'function') return;
      mutator(this);
    },
  };
}

/**
 * 造一个「订阅 store 的 hook」（用种子 react 的 useState/useEffect；不依赖 React 18+ 的 uSES）。
 * @param {object} react 种子 react
 * @returns {Function} `useSnapshot(store, selector?)`
 */
export function createStoreHook(react) {
  return function useSnapshot(store, selector) {
    const read = typeof selector === 'function' ? selector : identity;
    const [value, setValue] = react.useState(() => read(store.getSnapshot()));
    react.useEffect(() => {
      const off = store.subscribe(() => {
        setValue(read(store.getSnapshot()));
      });
      return typeof off === 'function' ? off : undefined;
    }, [store]);
    return value;
  };
}

function identity(value) {
  return value;
}
