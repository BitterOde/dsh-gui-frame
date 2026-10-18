/**
 * dock/store-face.mjs —— **坞的实时读数 → store 的快照面**（从 `dock.mjs` 原样搬出，函数体一字未动）。
 *
 *   · `live(slots)` —— 读实时座位状态（**唯一**入口：`slots.entries(key)` + `slots.entriesOfSlot(key)`）；
 *   · `refresh(slots)` —— 把坞的状态刷进 store（组件订阅它；**每次刷新都重新读一次实时座位**）。
 *
 * **入参 bag（6 个）**：`refs`（装配期捕获的 ctx/slots/layout/layoutHandle/openPanel）/
 * `registry`（坞自己的入口环）/
 * `store`（快照仓库）/ `rank`（排序键）/ `MAIN_SLOT` / `PANELLIST_SLOT`。
 * 前三个是**坞作用域的状态**（由装配侧持有）⇒ 整只交接；本模块不复制任何一份读数。
 * 交回 1 个口子：`refresh`（坞的刷新入口；`api.refreshNow` 与座位订阅都走它）。
 */
export function createDockStoreFace(deps) {
  const { refs, registry, store, rank, MAIN_SLOT, PANELLIST_SLOT } = deps;
  /** 读实时座位状态（**唯一**入口：`slots.entries(key)` + `slots.entriesOfSlot(key)`）。 */
  function live(slots) {
    const handle = slots ?? refs.slots;
    if (handle === null || typeof handle !== 'object' || typeof handle.entries !== 'function') {
      return { panellist: [], main: [], winners: [] };
    }
    const winners = typeof handle.entriesOfSlot === 'function' ? (handle.entriesOfSlot(MAIN_SLOT) ?? []) : [];
    return {
      panellist: [...(handle.entries(PANELLIST_SLOT) ?? [])],
      main: [...(handle.entries(MAIN_SLOT) ?? [])],
      winners: [...winners],
    };
  }

  /** 把坞的状态刷进 store（组件订阅它；**每次刷新都重新读一次实时座位**）。 */
  function refresh(slots) {
    const snapshot = live(slots);
    const optionsOf = (rows) => rows.map((entry) => entry?.options ?? null).filter((options) => options !== null);
    store.set({
      ready: true,
      entries: [...registry.values()]
        .map((row) => ({
          id: row.record.id,
          kind: row.record.kind,
          order: rank(row.record.order),
          source: row.record.source,
          badge: row.badge ?? null,
          paired: row.paired === true,
          sidebar: row.sidebar === true,
        }))
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
      panellist: optionsOf(snapshot.panellist),
      main: optionsOf(snapshot.main),
    });
    return store.getSnapshot();
  }

  /** 交回装配面：`live`（`api.__live` 诊断面）与 `refresh`（`api.refreshNow` 与两个座位订阅都走它）。 */
  return { live, refresh };
}
