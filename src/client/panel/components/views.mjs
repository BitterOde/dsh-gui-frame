/**
 * components/views.mjs —— **面板壳的状态视图组**（从 `panel/components.mjs` 原样搬出，行为一字未改）。
 *
 * 装了：`readHook`（框架注入的标准 hook prop 的读法，含「hooks 数量与顺序恒定」纪律）、
 * `loadingView` / `emptyView` / `errorView` / `stateView`、`errorProps`（剥 `children` 的第一层修复）、
 * `guardSlot`（元素槽的边界）、`isElementNode`、`resolveState`（显式 state ∪ 推导 state）。
 *
 * **依赖注入形态**：原来吃 `createComponents` 的闭包，现在把用到的名字从 `deps` 显式取；
 * **函数体一字未动**，返回值就是这组函数。
 */
export function createPanelViews(deps) {
  const {
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, Boundary,
  } = deps;
  /**
   * 读一个框架注入的标准 hook prop（`usePanelInfo` / `useSessions`）——**定义在 `createComponents` 内部**，
   * 因为它要用闭包里的 `report` 与 `safeRender`（放模块顶层会丢 `report`，真踩过：`report is not defined`）。
   *
   * ═══ 为什么不能写成「有就调、没有就 return null」（真机 React #300 的真根因）═══
   * hooks 的**数量与顺序必须在同一 fiber 的两次渲染之间恒定**。外壳会在两次渲染之间改变注入的 owner props
   * 集合（平台的补装窗口 / demo 重装），旧写法「缺席 ⇒ 一个 hook 都不调」会让 hook 数 2→1 ⇒
   * `Rendered fewer hooks than expected`（#300）⇒ 面板整段进错误态、布局编辑器永不出现。
   * ⇒ 本函数在每个槽位**恒定消耗 1 个同类型 hook**：
   *    · 注入可用 ⇒ 调它（外壳给的是 `useSyncExternalStoreWithSelector` 系，实读
   *      `dsh-client-ui-renderer` 的 `bindSnapshotSelector`，fiber 级记的就是**1 个 `useSyncExternalStore`**）；
   *    · 注入缺席 ⇒ 在**同一位置**调 `useStandInHook(react)`：一个 `useSyncExternalStore` 占位
   *      （常量快照 + 空订阅）——**类型与槽数都对齐**，否则真 React 会报「change in the order of Hooks」
   *      （实测：用 `useState` 占位 ⇒ `Previous render: useState / Next render: useSyncExternalStore`）。
   * 【契约】注入的 owner hook 必须**恰好占 1 个 `useSyncExternalStore` 槽**；形状不同则数量/顺序仍会漂移，
   * 那是外壳侧的约束，本函数无法在运行时补救。
   * 【替身兼容】无 `useSyncExternalStore` 的假 react（构建期 `loadArtifact` / 单测替身）退到 `useState`
   * ——该分支只影响替身（替身不校验 hooks 顺序），真 React 一律走上面那条同类型路径。
   *
   * ═══ 选择器必须**永远传**（真机实测：`加载失败 l is not a function`）═══
   * 外壳注入的不是「取值函数」而是 `bindSnapshotSelector(source)` 产出的**选择器 hook**，实读
   * `dsh-client-ui-renderer/lib/client.js`：
   *     function bindSnapshotSelector(w) { … return function useSelector(sel, eq) {
   *       return useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, sel, eq); }; }
   * 而 `use-sync-external-store/shim/with-selector` 的 **production.min** 产物签名是
   *     function(a /*subscribe*\/, b /*getSnapshot*\/, e /*getServerSnapshot*\/, l /*selector*\/, g /*isEqual*\/)
   * 内部那一行就是 `a = l(a)` —— **`l` 就是这个没传的选择器**。`useSelector()` 不传参 ⇒ `l === undefined`
   * ⇒ 原生 `TypeError: l is not a function`（真机报错文本逐字如此）⇒ 面板整块进错误态、工具栏 0 项。
   * 外壳自己的每一个调用点都传 （`usePanelInfo((info) => info.activePanelId)` /
   * `useSessions((s) => s)`）⇒ 这是**调用契约**，不是可选参数。
   * ⇒ 本函数**不再有「不传选择器」的路径**（默认落到 `SELECT_SNAPSHOT`）。
   * 【与两种注入形状的兼容】真正吃选择器的是外壳那一种；若某个调用方注入的是"自己就不吃参数"的取值函数
   * （单测替身常见），多传一个函数参数无副作用 ⇒ 两种形状都成立（单测有正反两条用例钉住）。
   *
   * ═══ try/catch 的边界（验收明令）═══
   * 本函数体内**一个 try/catch 都没有**（单测有静态断言锁死）：
   *   · `safeRender` **只包我们交给 hook 的 selector 回调**（我们自己写的代码：错了只该降级、
   *     不该炸整棵渲染）；
   *   · **绝不包 `hook(...)` 这个调用本身** —— 用 try/catch 吞掉 hooks 抛错＝把 hooks 链留成半坏状态，
   *     比直接报错更难查。hooks 抛错会经 `renderPanel` 冒泡到 `Panel` 的兜底：渲染**可见错误态**并上报
   *     （`GUIF-W-LISTENER-THREW`），**不静默**、不退化成「装作没注入」。
   * 唯一允许吞错的地方是 `useStandInHook` 里「压根不在 React 渲染树里」那一种（它自己就是占位实现，
   * 见该函数注释），与本节规则不冲突：那里不存在 hook 链，也没有「注入 hook 抛错」可言。
   *
   * @param {object} react 种子 react（真 React 或测试替身）
   * @param {unknown} hook 注入的 hook prop（可能缺席）
   * @param {((snapshot:unknown)=>unknown)|null} [selector] **回调**（会被 safeRender 包住）
   */
  function readHook(react, hook, selector = null) {
    if (typeof hook === 'function') {
      // ⚠ 注入的 hook 是**选择器 hook**：选择器**永远要传**（真机 `l is not a function` 的根因）。
      const pick = selector === null ? SELECT_SNAPSHOT : selector;
      const safeSelector = (snapshot) => safeRender(() => pick(snapshot), snapshot, report);
      return hook(safeSelector);
    }
    return useStandInHook(react);
  }

  // ── 三态视图（**唯一**渲染路径：显式 state 与 useSessions 推导都走这里）─────────────────

  function loadingView() {
    const IconLoading = atom('IconLoadingOutlineRegular');
    return el('div', { [ANCHORS.state]: 'loading', style: S.stateBox },
      IconLoading === undefined ? null : el(IconLoading, { size: 16 }),
      el('div', { style: S.stateTitle }, resolveLabel(null, null, 'loading')));
  }

  function emptyView(props) {
    const p = props ?? {};
    // 三个元素槽（A6/A2）：children 是冻结契约声明 Empty 必须接受的槽、action 放按钮、description 可放元素。
    // description 也可能是纯字符串 —— 字符串经过边界仍是同一个字符串（边界不产生额外 DOM）。
    return el('div', { [ANCHORS.state]: 'empty', style: S.stateBox },
      el('div', { style: S.stateTitle }, resolveLabel(p.title, p.t, 'empty')),
      guardSlot('empty-description', p.description === undefined || p.description === null ? null : el('div', null, p.description), p),
      p.action === undefined || p.action === null ? null : el('div', null, guardSlot('empty-action', p.action, p)),
      guardSlot('empty-children', p.children, p));
  }

  function errorView(props) {
    const p = props ?? {};
    const IconWarning = atom('IconWarningOutlineRegular');
    const retry = p.onRetry === undefined || p.onRetry === null
      ? null
      : renderAction({ id: 'retry', label: resolveLabel(p.retryLabel, p.t, 'retry'), icon: atom('IconRefreshOutlineRegular'), onSelect: p.onRetry, t: p.t });
    return el('div', { [ANCHORS.state]: 'error', style: S.stateBox },
      IconWarning === undefined ? null : el(IconWarning, { size: 16 }),
      el('div', { style: S.stateTitle }, resolveLabel(p.title, p.t, 'error')),
      el('code', { style: S.stateDetail }, describeError(p.error)),
      retry,
      p.children ?? null);
  }

  /** 按态取视图；`ready` ⇒ `null`（调用方渲染 children）。 */
  function stateView(state, props) {
    if (state === 'loading') return loadingView();
    if (state === 'empty') return emptyView(props);
    if (state === 'error') return errorView(props);
    return null;
  }

  /**
   * 造**错误态**的 props：**剥掉 `children`**（根因见下）。
   *
   * 为什么必须剥：这类调用点拿到的 `props.children` 往往**正是刚抛错的那棵子树**。
   * 让 fallback 再渲染它一次 ⇒ React 认为「边界自己也炸了」⇒ 卸载整棵树 ⇒
   * 真机上由官方 `SlotErrorBoundary` 兜住，用户看到的是那个空 div。
   * `boundary.mjs` 的裸类另有第三层保险（fallback 抛错也退到静态最小节点），这里是第一层。
   *
   * @param {object} props 原组件 props
   * @param {unknown} error 错因（`undefined` ⇒ 沿用 `props.error`）
   */
  function errorProps(props, error) {
    const source = props !== null && typeof props === 'object' ? props : {};
    const next = { ...source, children: null };
    if (error !== undefined) next.error = error;
    return next;
  }

  /**
   * 把一段**插件内容**包进本壳的错误边界（崩溃隔离面从 Panel 的 body 扩到其余槽位）。
   *
   * 隔离面覆盖的是「**由插件提供的元素/组件**」的每一个落点（不是只有 Panel 的 children）：
   *   Panel.actions ｜ Toolbar 的每个动作与 children ｜ List 的每一行内容与 children ｜
   *   Empty 的 action/description/children ｜ KeyValue 的 children ｜ ErrorState 的 children。
   * 不给这些槽位套边界时，插件元素在渲染期抛错会一路逃到 React 根（真机上＝官方
   * `SlotErrorBoundary` 的空 div），正是要消灭的现象。
   *
   * 边界**不产生额外 DOM**（只多一层组件），所以正常路径的 DOM 结构不变；
   * 出错时的兜底完全复用 `boundary.mjs` 那三层保险（fallback 抛错 ⇒ 静态最小错误节点）。
   *
   * @param {string} key React key（同一父节点下的多个槽位必须唯一）
   * @param {unknown} node 插件内容（`null`/`undefined` ⇒ 直接返回 null，不为空槽套边界）
   * @param {object|null|undefined} props 宿主组件的 props（供 fallback 取 t/文案）
   */
  function guardSlot(key, node, props) {
    if (node === null || node === undefined) return null;
    return el(Boundary, {
      key,
      onError: report,
      renderError: (error) => errorView(errorProps(props, error)),
    }, node);
  }

  /**
   * 是否是 **React 元素**（`createElement` 的产物）。
   * 判据的用途只有一个：**只有元素才可能在渲染期抛错**（字符串/数字是惰性数据），
   * 所以「值槽要不要套边界」由它决定 —— 这样既堵住逃逸面，又不会给纯数据套边界。
   */
  function isElementNode(value) {
    return value !== null && typeof value === 'object' && value.$$typeof !== undefined;
  }

  /**
   * 收敛「显式 state ∪ 推导 state」。非法 state **不向外抛**（抛出去会被官方 boundary 换成空 div，
   * 那是明确要避免的现象）——就地渲染错误态并把原始错因显示出来。
   */
  function resolveState(props, derived) {
    try {
      const declared = normalizeState(props?.state);
      return { state: declared === 'ready' ? derived : declared, error: null };
    } catch (error) {
      return { state: 'error', error };
    }
  }

  /**
   * 一个动作按钮：官方 Button 优先，缺席退 `<button>`；带图标时套官方 Tooltip。
   * ★ 为什么归到视图组：原在 `shell.mjs`，但**错误态的重试按钮**（`stateView`）也用它 ⇒ 归到视图组，
   * 由 `shell.mjs` 经 bag 取用（函数体一字未动）。
   */
  function renderAction(item) {
    const spec = item ?? {};
    const Button = atom('Button');
    const Tooltip = atom('Tooltip');
    const label = resolveLabel(spec.label, spec.t, spec.id ?? 'action');
    const onClick = spec.onSelect === undefined || spec.onSelect === null
      ? undefined
      : (event) => safeRender(() => spec.onSelect(spec.id, event), undefined, report);
    const disabled = spec.disabled === true;
    const hasIcon = spec.icon !== undefined && spec.icon !== null;
    const icon = hasIcon ? el(spec.icon, { size: spec.iconSize ?? 14 }) : undefined;
    const core = Button === undefined
      ? el('button', { type: 'button', key: 'core', disabled, onClick, className: spec.className, [ANCHORS.action]: String(spec.id ?? '') }, icon ?? null, label)
      : el(Button, { key: 'core', disabled, onClick, className: spec.className, icon, [ANCHORS.action]: String(spec.id ?? '') }, label);
    if (Tooltip === undefined || spec.tooltip === false || !hasIcon) return core;
    // children 走 createElement 的第三参数（不要塞进 props.children：真 React 两种写法都行，
    // 但替身会把 props.children 覆盖成子参数，塞进去的那种写法在无 DOM 测试里会静默丢子树）。
    return el(Tooltip, { key: 'tip', label }, core);
  }

  // 交回 `createComponents`：这一组就是原来那层闭包里的同名函数（引用与语义一字未改）。
  return { readHook, loadingView, emptyView, errorView, stateView, errorProps, guardSlot, isElementNode, resolveState, renderAction };
}
