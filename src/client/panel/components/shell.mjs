/**
 * components/shell.mjs —— **六个复合组件的实现**（从 `panel/components.mjs` 原样搬出，行为一字未改）。
 *
 * 装了：`renderAction`（官方 Button/Tooltip 优先，缺席退自研等价物）与 `Panel` / `renderPanel` /
 * `Toolbar` / `Empty` / `ErrorState` / `List` / `KeyValue` —— 每个都自带 try/catch → `errorView` 的兜底，
 * 且**所有元素槽都经 `guardSlot`**（插件内容的边界面）。
 *
 * **依赖注入形态**：原来吃 `createComponents` 的闭包，现在把用到的名字从 `deps` 显式取（其中
 * `readHook` / `stateView` / `errorProps` / `guardSlot` / `isElementNode` / `resolveState` 由
 * `./views.mjs` 产出后一并传入）；**函数体一字未动**。
 */
export function createPanelComponents(deps) {
  const {
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, STATE_VALUES, Boundary,
    SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, normalizeField, sessionCount,
    readHook, loadingView, emptyView, errorView, stateView, errorProps, guardSlot, isElementNode, resolveState, renderAction,
  } = deps;
  // ── 六个复合组件 ────────────────────────────────────────────────────────────────────────

  /** Panel：面板外壳（header / body / status）；`main` 座位没有 owner props，数据**自己取**。 */
  function Panel(rawProps) {
    const props = rawProps ?? {};
    try {
      return renderPanel(props);
    } catch (error) {
      report(error);
      return el('section', { [ANCHORS.panel]: String(props.id ?? ''), style: S.panel },
        errorView(errorProps(props, error)));
    }
  }

  function renderPanel(props) {
    // **自己**从框架注入的标准 hook props 取数（`main` 的 ownerProps 是空数组，不能等它传）。
    // ⚠ 这两行必须在**每一次渲染**都按同一顺序执行，且各自恒占 1 个 hook 槽（真机 React #300 的根因）。
    const activePanelId = normalizeActivePanelId(readHook(react, props.usePanelInfo, SELECT_ACTIVE_PANEL_ID));
    const sessions = readHook(react, props.useSessions, SELECT_SNAPSHOT);
    // `undefined`（选择器说"不认识快照"）与 `null`（hook 缺席 ⇒ 占位快照）都记"不知道"，不得当成 false。
    const active = activePanelId === null || activePanelId === undefined ? null : activePanelId === props.id;
    const resolved = resolveState(props, stateFromSessions(sessions));
    const content = resolved.state === 'ready'
      ? (props.children ?? null)
      : stateView(resolved.state, errorProps(props, resolved.error ?? props.error));
    const header = el('header', { [ANCHORS.panelHeader]: String(props.id ?? ''), style: S.header },
      el('span', { [ANCHORS.panelTitle]: String(props.id ?? ''), style: S.title }, resolveLabel(props.label, props.t, 'empty')),
      // actions 槽承载插件元素（按钮/图标组件），必须和 body 一样在自己的边界里
      props.actions === undefined || props.actions === null ? null : el('span', { key: 'actions' }, guardSlot('panel-actions', props.actions, props)),
      props.close === undefined || props.close === null ? null : el('span', null, renderAction({
        id: `${props.id ?? ''}::close`,
        label: resolveLabel(props.closeLabel, props.t, 'close'),
        icon: atom('IconCloseOutlineRegular'),
        onSelect: () => { props.close(); },
        t: props.t,
      })));
    const count = sessionCount(sessions);
    const status = el('footer', {
      [ANCHORS.panelStatus]: String(props.id ?? ''),
      style: S.status,
    }, el('span', null, String(props.status ?? '')));
    return el('section', {
      [ANCHORS.panel]: String(props.id ?? ''),
      [ANCHORS.panelActive]: active === null ? 'unknown' : String(active),
      [ANCHORS.sessionsCount]: String(count),
      className: props.className,
      style: { ...S.panel, ...(props.style ?? {}) },
    },
    header,
    el('div', { [ANCHORS.panelBody]: String(props.id ?? ''), style: S.body },
      el(Boundary, {
        onError: report,
        // fallback **不带 children**：刚抛错的子树再渲染一次 = 边界自己也炸 = 整棵树被卸载
        renderError: (error) => errorView(errorProps(props, error)),
      }, content)),
    status);
  }

  /** Toolbar：一行动作（`items` + `children`）。独立使用时同样自带崩溃隔离。 */
  function Toolbar(rawProps) {
    const props = rawProps ?? {};
    try {
      const items = Array.isArray(props.items) ? props.items : [];
      // 每个动作单独一条边界：一个动作的图标组件炸了，不该带走整条工具栏（与官方「每条目一个边界」同构）
      const rendered = items.map((item, index) => {
        const key = String(item?.id ?? index);
        return el('span', { key, style: S.slot }, guardSlot(`toolbar-item-${key}`, renderAction({ ...(item ?? {}), t: props.t }), props));
      });
      return el('div', { [ANCHORS.toolbar]: String(props.id ?? ''), role: 'toolbar', style: { ...S.toolbar, ...(props.style ?? {}) } },
        rendered,
        guardSlot('toolbar-children', props.children, props));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  /** Empty：空态（独立可用；Panel/List 的空态也走它）。 */
  function Empty(rawProps) {
    const props = rawProps ?? {};
    try {
      const resolved = resolveState(props, 'empty');
      // ⚠ **不能**把 empty 态也喂 `errorProps`（它会剥 children）—— 冻结契约（contracts/components.mjs）
      // 声明 `Empty: […, 'children']`，而 Empty 的 state 恒为 'empty'（未声明时由 derived 推导成 'empty'）
      // ⇒ 走 errorProps 会让该槽**永远是死槽**（渲染不出来 = 契约没兑现）。
      // 【兑现口径，别当漏修】：
      //   · 默认 / `state="empty"` 路径 ⇒ **必须渲染 children**（在 emptyView 里由自己的边界护住）；
      //   · `state="loading"` ⇒ 不渲染 children（loadingView 本就没有 children 槽）；
      //   · `state="error"` ⇒ **必须剥 children**（errorProps 原样保留 —— 那是根因修复，
      //     fallback 再渲染刚抛错的 children 会让边界自己也炸、整棵树被卸载）。
      if (resolved.state === 'empty') return emptyView(props);
      return stateView(resolved.state, errorProps(props, resolved.error));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  /** ErrorState：错误态（`error` + `onRetry`；`children` 是可选文案/元素槽）。 */
  function ErrorState(rawProps) {
    const props = rawProps ?? {};
    try {
      const asText = typeof props.children === 'string' || typeof props.children === 'number' ? props.children : undefined;
      const view = errorView(errorProps(props, props.error ?? asText));
      const extra = asText === undefined ? guardSlot('error-children', props.children, props) : null;
      return extra === null ? view : el('div', null, view, extra);
    } catch (error) {
      return el('div', { [ANCHORS.state]: 'error', style: S.stateBox }, describeError(error));
    }
  }

  /** List：`items` + `renderItem`；空数组自动进空态；单行 `renderItem` 抛错只影响那一行。 */
  function List(rawProps) {
    const props = rawProps ?? {};
    try {
      const items = Array.isArray(props.items) ? props.items : [];
      const resolved = resolveState(props, items.length === 0 ? 'empty' : 'ready');
      if (resolved.state !== 'ready') {
        // `empty` 是**元素槽**（调用方传进来占位用的元素/文案）⇒ 同样要落在边界里（A2）
        if (resolved.state === 'empty' && props.empty !== undefined && props.empty !== null) return guardSlot('list-empty', props.empty, props);
        return stateView(resolved.state, errorProps(props, resolved.error ?? props.error));
      }
      const getKey = typeof props.getKey === 'function' ? props.getKey : null;
      const Chevron = atom('IconChevronRightOutlineRegular');
      const rows = items.map((item, index) => {
        let rowError = null;
        const rendered = typeof props.renderItem === 'function'
          ? safeRender(() => props.renderItem(item, index), null, (error) => {
            rowError = error;
            report(error);
          })
          : null;
        const key = getKey === null ? String(index) : safeRender(() => String(getKey(item, index)), String(index), report);
        // 单行渲染抛错 ⇒ 那一行显示**错因**（不是把原始 item 当文案，那会让人以为渲染成功了）
        const content = rendered ?? (rowError === null ? describeError(item) : describeError(rowError));
        return el('div', { key, [ANCHORS.row]: String(index), style: S.row },
          Chevron === undefined ? null : el(Chevron, { size: 14 }),
          // 每一行的内容单独一条边界：`renderItem` 返回的**组件**在渲染期抛错时只废掉那一行（A2）
          el('span', { style: S.rowBody }, guardSlot(`list-row-${key}`, content, props)));
      });
      return el('div', { [ANCHORS.panelBody]: String(props.id ?? ''), style: { ...S.body, padding: '0' } },
        rows,
        guardSlot('list-children', props.children, props));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  /** KeyValue：键值表（`entries` 支持 `[k,v]` / `{key|label|name, value}` / 裸字符串）。 */
  function KeyValue(rawProps) {
    const props = rawProps ?? {};
    try {
      const entries = Array.isArray(props.entries) ? props.entries : [];
      const resolved = resolveState(props, entries.length === 0 ? 'empty' : 'ready');
      if (resolved.state !== 'ready') return stateView(resolved.state, errorProps(props, resolved.error ?? props.error));
      const fields = [];
      entries.forEach((entry, index) => {
        const field = normalizeField(entry, index);
        // 值槽也是**元素槽** —— `renderable()` 明说「字符串/数字/**元素**都合法」，
        // 元素在渲染期抛错时以前会一路逃到 React 根（真机上＝官方 SlotErrorBoundary 的空 div）。
        // 只在**值为 React 元素**时套边界；字符串/数字保持原样（纯数据不包，与既有负控口径一致）。
        const valueNode = isElementNode(field.value) ? guardSlot(`keyvalue-value-${index}`, field.value, props) : field.value;
        fields.push(el('dt', { key: `k${index}`, [ANCHORS.field]: field.key, style: S.fieldKey }, field.key));
        fields.push(el('dd', { key: `v${index}`, style: S.fieldValue }, valueNode));
      });
      return el('dl', { style: S.field }, fields, guardSlot('keyvalue-children', props.children, props));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  // 交回 `createComponents`：六个复合组件 + 动作按钮渲染器（引用与语义一字未改）。
  return { renderAction, Panel, renderPanel, Toolbar, Empty, ErrorState, List, KeyValue };
}
