/**
 * dock/manage-page.mjs —— **坞的管理页**（自检页 + 布局编辑器）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【它是什么 / 它不是什么】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 它是**本包自己的地盘**：自检页（本包注册且非 `action` 的入口，点了切到它那一格）+ 布局编辑器
 * （人工修改布局，可保存）。它**不是按钮面板**。
 *
 * 挂载点两处：① 工作台那一格 `main['dsh-gui-frame/workbench']`（坞在 `install()` 里与自己的入口
 * 同源同序注册）；② `createDockEntryPage` 的**降级分支**（浮层切片缺席 / 主区还不回去时停在它上面）。
 * 面板壳（`Panel`）在渲染期解析（装配序保证 panel 已装；缺席则不套壳，内容照常渲染）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【外观：照 DSH 外壳取值，而不是自己发明一套】（积极使用 DSH 本体的设计元素）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 自检入口＝**DSH 次级按钮**（`.newSession` 的等价取值：38px 高 / 12px 圆角 / 8·16 内边距 / 14px·500）。
 * 说明文字＝`--dsw-alias-label-secondary` / `--dsw-alias-label-caption` 两档文字色。
 * 旧版那套 `1px solid` + 无底色 + `opacity:.65` 压暗已全部删除 —— 那是外来控件的观感，不是 DSH 的语言。
 * 悬停 / 焦点 / 禁用三态在 `panel-styles.mjs` 的 `[data-guif-launcher]` 规则里（内联样式表达不了伪类）。
 * 颜色**只走白名单 `--dsw-*`**（`kit/tokens.mjs` 的 `DSW_TOKENS`）⇒ `check:tokens` 硬门禁照过。
 */
import { dsw } from '../kit/tokens.mjs';

/**
 * 造管理页组件工厂。
 *
 * @param {object} deps 装配面 bag（与 `panels.mjs` 同一个 bag，外加 `closePanel` / `ensurePanelStyles`）
 * @returns {() => Function} `createDockManagePage` —— 每次调用得到一个页面组件
 */
export function createManagePageFactory(deps) {
  const {
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, entryLabel,
    dockLabel, refresh, DOCK_ENTRY_ID, closePanel, ensurePanelStyles,
  } = deps;

  /**
   * 次级按钮的内联基线（**照 DSH 外壳的 `.newSession` 取值**：38px 高、12px 圆角、8/16 内边距、
   * 14px/500 字重；颜色走白名单 token）。悬停/焦点态在 `panel-styles.mjs` 的 `[data-guif-launcher]` 规则里。
   */
  const BUTTON_STYLE = Object.freeze({
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    height: '38px',
    padding: '8px 16px',
    borderRadius: '12px',
    border: `0.5px solid ${dsw('--dsw-alias-border-l3')}`,
    background: dsw('--dsw-alias-bg-layer-2'),
    color: dsw('--dsw-alias-label-primary'),
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '22px',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
  });
  /** 说明文字的基线色（旧版用 `opacity:.65` 压暗 —— 那是临时手法，不是 DSH 的语言）。 */
  const HINT_STYLE = Object.freeze({ color: dsw('--dsw-alias-label-secondary'), lineHeight: '1.6' });
  const CAPTION_STYLE = Object.freeze({ color: dsw('--dsw-alias-label-caption'), lineHeight: '1.6' });

  return function createDockManagePage() {
    const IconRefresh = primitives.get('IconRefreshOutlineRegular');
    const Tag = primitives.get('Tag');

    function GuiFrameDockManage(props) {
      const owner = props ?? {};
      const Panel = componentOf('Panel');
      const Toolbar = componentOf('Toolbar');
      const snapshot = useSnapshot(store, (value) => value);
      const platformLayout = refs.layout;
      const canOpen = platformLayout !== null && typeof platformLayout.selectPanel === 'function';
      const handle = refs.layoutHandle;
      const status = handle !== null && typeof handle.status === 'function' ? handle.status() : null;
      const layoutModel = status === null ? null : status.layout;
      const Editor = handle !== null && typeof handle.editor === 'function' ? handle.editor : null;
      // 行样式表（悬停/焦点 + 自检入口的次级按钮观感）：管理页挂上时按需注入一次（幂等）。
      react.useEffect(() => { ensurePanelStyles(); }, []);

      /** 打开某个入口的 `main` 面板（layout 缺席 ⇒ 返回 false，界面照常显示按钮，只是点了没反应）。 */
      function openPanel(id) {
        if (canOpen !== true) return false;
        try {
          platformLayout.selectPanel(id);
          return true;
        } catch {
          return false;
        }
      }

      /**
       * 布局里的**顺序与显隐**（模型：`{version, docks:[id…], entries:{id:{visible,group,source}}}`）。
       * `docks` 的数组顺序就是用户拖出来的顺序；不在布局里的入口排最后（新注册、还没对账进去）。
       */
      function layoutIndex(id) {
        const docks = layoutModel !== null && Array.isArray(layoutModel.docks) ? layoutModel.docks : null;
        if (docks === null) return Number.MAX_SAFE_INTEGER;
        const index = docks.indexOf(id);
        return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
      }

      /** 一颗导航按钮（`data-guif-launcher` 是机器锚点）。 */
      function launcher(id, label, hint) {
        return el('button', {
          key: `launcher:${id}`,
          type: 'button',
          'data-guif-launcher': id,
          style: BUTTON_STYLE,
          disabled: canOpen !== true,
          onClick: () => { openPanel(id); },
        }, el('span', null, label), hint === null || hint === undefined ? null : hint);
      }

      /** 一个分组（标题 + 内容）；空组不渲染，免得面板里出现空标题。 */
      function group(key, title, nodes) {
        if (nodes.length === 0) return null;
        return el('div', { key, 'data-guif-launcher-group': key, style: { margin: '4px 0 10px' } },
          el('div', { style: { ...HINT_STYLE, margin: '0 0 6px' } }, title),
          el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, nodes));
      }

      /** 入口的显示名：坞内注册的从 record 取（thunk 兜底）。 */
      function labelOf(id) {
        const row = registry.get(id);
        if (row === undefined) return id;
        return entryLabel(row.record);
      }

      const byLayoutOrder = (left, right) =>
        layoutIndex(left.id) - layoutIndex(right.id) || left.order - right.order || left.id.localeCompare(right.id);

      /**
       * 本包**自己的自检页**（`panel` 型、只占 `main` 不占侧栏行）：只出现在**坞的管理页**上，
       * **绝不进按钮面板**。
       */
      const selfRows = snapshot.entries
        .filter((row) => row.id !== DOCK_ENTRY_ID && row.kind !== 'action' && row.source === 'dsh-gui-frame')
        .sort(byLayoutOrder);

      /** 布局编辑区（人工修改布局，可保存）：**只在管理页**，不进按钮面板。 */
      const editorNode = Editor === null
        ? el('div', { key: 'editor', style: CAPTION_STYLE }, '布局编辑器不可用（layout 能力未装配或缺 react 种子）—— 按钮照常可用。')
        : el('div', { key: 'editor', 'data-guif-dock-editor': 'true' },
          el('div', { style: { ...CAPTION_STYLE, margin: '4px 0 6px' } },
            `布局编辑（拖拽换序 / 显隐 / 分组，改动自动保存）${status !== null && status.writable === false ? ' —— ⚠ 当前只读（载荷读不出来或 scope 不可写）' : ''}`),
          el(Editor, { layout: layoutModel, records: typeof service.__entries === 'function' ? service.__entries() : [] }));

      /** 管理页正文（**只出现在管理页**：自检页 + 布局编辑器）—— 它是本包自己的地盘，不是按钮面板。 */
      function manageContent() {
        return el('div', { key: 'manage-content' },
          group('self', '本包自检页', selfRows.map((row) => launcher(
            row.id,
            labelOf(row.id),
            Tag === undefined || Tag === null ? null : el(Tag, { tone: 'neutral' }, row.kind),
          ))),
          editorNode);
      }

      return el(Panel, {
        id: DOCK_ENTRY_ID,
        label: () => dockLabel(owner.t),
        t: owner.t,
        close: () => { closePanel(); },
        actions: el(Toolbar, {
          id: `${DOCK_ENTRY_ID}::toolbar`,
          t: owner.t,
          items: [
            {
              id: `${DOCK_ENTRY_ID}::refresh`,
              label: '刷新',
              icon: IconRefresh,
              onSelect: () => { refresh(refs.slots); },
            },
            {
              id: `${DOCK_ENTRY_ID}::float`,
              label: '浮出面板',
              onSelect: () => { if (typeof refs.openPanel === 'function') refs.openPanel(null); },
            },
          ],
        }),
        usePanelInfo: owner.usePanelInfo,
        useSessions: owner.useSessions,
      }, manageContent());
    }
    return GuiFrameDockManage;
  };
}
