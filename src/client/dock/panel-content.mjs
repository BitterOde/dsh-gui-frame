/**
 * dock/panel-content.mjs —— **按钮面板的正文**。
 *
 *   · `readDockActions(registry, layoutHandle)` —— 坞在册的**外部**动作型入口（只装外部插件
 *     交进来的按钮）。★ 只依赖坞自己的环 + 布局句柄，**不依赖任何组件渲染** —— 入口在用户点它之前
 *     坞面板从没渲染过（旧实现把「打开面板」放在面板组件闭包里 ⇒ 点图标空转，机检实测）。
 *   · `createPanelContent(el, rows)` —— 面板正文节点（现造，同上理由）；`PANEL_EMPTY_HINT` 是它的空态文案。
 *
 * **入参 bag（1 个）**：`DOCK_ENTRY_ID`（坞自己的入口 id，读法要按它过滤，在 `dock.mjs` 侧声明）
 * —— 本模块**不重复声明**任何常量。
 * ⚠ `PANEL_EMPTY_HINT` 不再是对外导出（原 `export const` 无外部引用）：坞只把它用在正文里。
 * ⚠ 行改成 DSH 侧栏同款（容器取值逐值照抄 `.panelRow`，样式表在 `./panel-styles.mjs`）。
 * ⚠ 行 = `[注册方的控件][角标?]` —— 坞**不画图标槽**（注册面的 `icon` 与注册方控件自带的图标
 *   会撞成两个图标），理由与真机读数见 `createPanelContent`。
 */
import { dsw, guifLiteral, guifVar } from '../kit/tokens.mjs';

export function createPanelContentFace(deps) {
  const { DOCK_ENTRY_ID } = deps;
  const PANEL_EMPTY_HINT = "还没有插件把按钮交进来。写法：别的插件里调用 ctx.guiFrame.register({ id, label, order, kind: 'action', badge }, 你的按钮组件) —— 单向依赖：本插件不在时不注册、不占座位、页面照常。";

  /**
   * 行内三段与空态的**内联基线**（不依赖主题能力；伪类与「中和注册方外壳」在 `panel-styles.mjs` 的样式表里）。
   * 取值与 DSH 侧栏 `.panelRow` / `.panelGlyph` / `.panelTitle` 同源；颜色只走白名单 token（`guifVar`）。
   *
   * ★ 底色/字色走**公开变量**，接入方在任意祖先上定义即生效
   *   —— `--guif-dock-row-bg`（静止）/ `-row-fg`，悬停与激活那两态在样式表里
   *   （`--guif-dock-row-bg-hover` / `-bg-active` / `-fg-active` / `-focus-ring`，伪类内联表达不了）。
   *   ⚠ 这里只**取用**（写在 `var(...)` 的值位），**绝不**把变量声明成元素上的自定义属性 ——
   *     后者会把祖先给的覆盖值挡死（`panel/components.mjs` 就是这么踩的）。
   *   ⚠ 字色保留旧链：`--guif-dock-row-fg` → `--guif-panel-fg` → 外壳 token，故老接入方设过的
   *     `--guif-panel-fg` 继续生效（新名字是**更细的旋钮**，不是替换）。
   *   ⚠ **圆角与行距不在这一族里 —— 它们是美学秩序的不变量**（凭据：
   *     「改行圆角和行间距会影响面板的美学秩序，所以不要。」）⇒ 保持字面量、与 DSH 侧栏逐值同源；
   *     `tests/unit/dock-style-vars.test.mjs` 盯着这两个位必须是字面量（改成变量会红）。
   */
  const ROW_STYLE = Object.freeze({
    boxSizing: 'border-box',
    width: '100%',
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 8px',
    border: 'none',
    borderRadius: '8px',
    background: guifLiteral('--guif-dock-row-bg', 'transparent'),
    color: `var(--guif-dock-row-fg, ${guifVar('--guif-panel-fg', '--dsw-alias-label-secondary')})`,
    font: 'inherit',
    fontSize: '14px',
    lineHeight: '22px',
    textAlign: 'left',
    cursor: 'pointer',
  });
  const BADGE_STYLE = Object.freeze({
    flex: 'none',
    marginLeft: 'auto',
    minWidth: '14px',
    padding: '0 5px',
    borderRadius: '999px',
    background: guifVar('--guif-dock-badge-bg', '--dsw-alias-state-business-primary'),
    color: guifVar('--guif-dock-badge-fg', '--dsw-alias-label-primary-inverted'),
    fontSize: '11px',
    lineHeight: '16px',
    textAlign: 'center',
  });
  const HINT_STYLE = Object.freeze({
    color: dsw('--dsw-alias-label-caption'),
    lineHeight: '1.6',
    padding: '2px 8px',
  });

  /**
   * 坞在册的**外部**动作型入口（面板只装外部插件交进来的按钮，本包自己的不进）。
   *
   * ★ 关键：这份读法**只依赖坞自己的环 + 布局句柄**，**不依赖任何组件渲染** ——
   *   入口（侧栏那一颗）在用户点它之前，坞面板从没渲染过；旧实现把「打开面板」的函数放在
   *   面板组件的闭包里、靠组件渲染时才赋值给 `refs.openPanel`，于是**点图标 = 空转**
   *   （机检实测：`stopPropagation` 拦下了官方那一下，但 `overlay.open` 一次都没调）。
   */
  /**
   * 注册方**运行期改写过的** label：`setLabel(next)` 写进这里，
   * 此后 `labelOf` 优先用它 —— 因为注册面的 `label` 可能是 **thunk**（每次读取重新求值），
   * 单改 `row.record.label` 会被原 thunk 覆盖回去（踩过一次）。
   */
  const labelOverrides = new Map();
  /** 行的 label：**改写优先** → 注册面元数据（含 thunk）→ null。 */
  function labelOf(id, record) {
    if (labelOverrides.has(id)) return labelOverrides.get(id);
    if (typeof deps.entryLabel === 'function') return deps.entryLabel(record);
    return record?.label ?? null;
  }

  function readDockActions(registry, layoutHandle) {
    const rows = [];
    for (const [id, row] of registry) {
      if (id === DOCK_ENTRY_ID) continue;
      if (row.record.kind !== 'action') continue;
      if (row.record.source === 'dsh-gui-frame') continue;
      rows.push({
        id,
        order: Number.isInteger(row.record.order) ? row.record.order : 0,
        badge: row.badge ?? null,
        label: labelOf(id, row.record),
        Component: row.record.Component,
        record: row.record,
      });
    }
    const status = layoutHandle !== null && layoutHandle !== undefined && typeof layoutHandle.status === 'function' ? layoutHandle.status() : null;
    const layout = status === null || status === undefined ? null : status.layout ?? null;
    const docks = layout !== null && Array.isArray(layout.docks) ? layout.docks : null;
    const entries = layout !== null && layout.entries !== null && typeof layout.entries === 'object' ? layout.entries : null;
    const indexOf = (id) => (docks === null || docks.indexOf(id) < 0 ? Number.MAX_SAFE_INTEGER : docks.indexOf(id));
    const visible = (id) => (entries === null || entries[id] === undefined || entries[id] === null ? true : entries[id].visible !== false);
    return rows
      .filter((row) => visible(row.id))
      .sort((left, right) => indexOf(left.id) - indexOf(right.id) || left.order - right.order || left.id.localeCompare(right.id));
  }

  /**
   * 面板正文节点（入口点开时现造，不依赖面板组件是否渲染过）。
   *
   * ═══ 每一行**照 DSH 侧栏那一行**画 ═══
   * 用户原话：「按钮面板里的按钮样式太丑了，你看看 DSH 上侧边栏的按钮实现呢？**一个按钮包括图标和文字两部分，
   * 由外部注册**。至于**按钮容器背景**实现要和 DSH 原版的设计风格统一。」
   *
   * ⇒ 每行 = `<button data-guif-dock-action="<id>">`（容器取值逐字照 `dsh-client-ui-sidebar` 的 `.panelRow`）：
   *   `[注册方的控件]` + `[角标槽?]`。
   *
   * ═══ **坞不画图标槽**（一行里只有一个图标） ═══
   * 用户原话：「为什么面板里有两个图标？是你的问题还是使用者的问题？」
   *
   * 真机取证（隔离实例 + headless CDP）：
   * 一行里 `glyphSlots=1`、`svgCount=2` —— **两颗 16×16 的 `svg.sq-icon`**。
   * 根因是**坞的注册面给了两处图标来源、契约却没定谁负责**：
   *   · 坞在行首画 `register({icon})` 那一颗（上一版的 `glyphNode`）；
   *   · 注册方的 `Component`（注册契约里**必填**）自带同一颗 —— SafelyQuit 把**同一个 `PowerIcon`**
   *     既传给 `register({icon})` 又放进自己的按钮里（它是照坞的文档写的 ⇒ **不是使用方的问题**）。
   *
   * ⇒ 口径：**行的内容一律是注册方交进来的那个控件**（图标 + 文字都在它里面），坞只补**角标**；
   *   `register({icon})` 仍是注册面字段，坞**自绘字形**的地方继续用它（`kind !== 'action'` 的侧栏行，
   *   见 `dock/core.mjs` 的 `createEntryGlyph`）—— **动作型入口的面板行不画**，画了就是两个图标。
   */
  function createPanelContent(el, rows) {
    return el('div', {
      key: 'panel-content',
      'data-guif-dock-actions': String(rows.length),
      // 容器取值与样式表同源（`[data-guif-dock-actions]`）；内联这一份是「主题能力缺席时的基线」。
      // ⚠ 行距是字面量：`tests/unit/dock-style-vars.test.mjs` 盯着它（改成变量会红）。
      style: { display: 'flex', flexDirection: 'column', gap: '4px' },
    },
    rows.length === 0
      ? el('div', { key: 'empty', 'data-guif-dock-hint': 'true', style: HINT_STYLE }, PANEL_EMPTY_HINT)
      : null,
    rows.map((row) => el('button', {
      key: `action:${row.id}`,
      type: 'button',
      // 锚点名不叫 `data-guif-action`：那个名字被本包自己的 Toolbar/按钮组件占着（撞名会让判据把工具条也算进来）。
      'data-guif-dock-action': row.id,
      style: ROW_STYLE,
    },
    el(row.Component, {
      // ★ 注册方拿到**自己的**只读能力面 —— 值全是能力面（两个 setter 只作用它自己那一行），
      //   不是给别人的入口。`label` 取注册面元数据（可为 thunk），运行期改写走 `setLabel`。
      id: row.id,
      label: row.label,
      setBadge: (next) => deps.setBadge?.(row.id, next),
      setLabel: (next) => {
        labelOverrides.set(row.id, next); // 面板自己这一份（thunk 覆盖不了）
        return deps.setLabel?.(row.id, next); // 同时通知坞切片（侧栏/管理页那两处自绘的读数）
      },
    }),
    row.badge === null || row.badge === undefined
      ? null
      : el('span', { 'data-guif-badge': String(row.badge), style: BADGE_STYLE }, String(row.badge)))));
  }

  /** 交回装配面：正文工厂 + 在册动作读法（装配侧再把它们递给面板模块）。 */
  return { readDockActions, createPanelContent };
}
