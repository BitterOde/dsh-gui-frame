/**
 * entry-icons.mjs —— 坞图标与**自绘角标**。
 *
 * ═══ 为什么角标必须自绘 ═══
 * `SlotCore.register` 只把 `key / id / order / label / priority` 保留到 `options` 里
 * （实读官方 register 选项表：里面**没有 `badge` 字段**）⇒ 往注册选项里塞 `badge` 是**静默丢弃**。
 * 所以：坞把角标存进**自己的** store，图标组件从 store 读出并画出来 —— 注册选项里一个多余的键都没有
 * （单测直接断言 `Object.keys(options)` 只有白名单里的四个）。
 *
 * ═══ 形状 ═══
 * `sidebar.panellist` 的 owner 只传 `{ size, active }`（官方 `contract/slots.d.ts` L39-43），
 * 所以 id / label / 角标这些**不来自 owner props**，由坞在造图标组件时闭包带进来 ——
 * 这也正是「不依赖官方会丢字段的那条路」的实现方式。
 *
 * 本文件**零副作用**：只造元素与闭包，不注册任何东西。
 */

import { guifLiteral, guifPrivateVar, guifVar } from './tokens.mjs';

/** 自绘角标的机检锚点（值＝入口 id）。 */
export const BADGE_ATTR = 'data-guif-badge';

/** 自绘字形的机检锚点。 */
export const GLYPH_ATTR = 'data-guif-glyph';

/** 未提供图标时的兜底字形锚点（首字母/首字）。 */
export const GLYPH_MARK_ATTR = 'data-guif-glyph-mark';

/** 角标文案上限（超过显示 `99+`，避免长数字把图标行撑开）。 */
export const BADGE_MAX = 99;

/**
 * 收敛角标取值（坞自己的环内数据，**不进** slot 注册选项）。
 * 接受：正整数 / 字符串 / `{ count|text, tone }` / `null` / `0` / 负数 / `false`。
 * @param {unknown} value
 * @returns {{text:string, tone:string|null}|null} `null` ＝ 不画角标
 */
export function normalizeBadge(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return null;
  let raw = value;
  let tone = null;
  if (typeof value === 'object') {
    if (value === null) return null;
    raw = value.count ?? value.text ?? null;
    tone = typeof value.tone === 'string' && value.tone !== '' ? value.tone : null;
    if (raw === null || raw === undefined) return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const count = Math.floor(raw);
    return { text: count > BADGE_MAX ? `${BADGE_MAX}+` : String(count), tone };
  }
  const text = String(raw).trim();
  if (text === '' || text === '0' || text === 'false') return null;
  return { text: text.length > 4 ? `${text.slice(0, 4)}…` : text, tone };
}

/** 角标底色：三档 tone（错误/警告/中性），全部落到 `--dsw-*`。 */
function badgeStyle(tone) {
  const bg = tone === 'error'
    ? guifVar('--guif-dock-badge-bg', '--dsw-alias-state-error-primary')
    : tone === 'warn'
      ? guifVar('--guif-dock-badge-bg', '--dsw-alias-state-warn-primary')
      : guifVar('--guif-dock-badge-bg', '--dsw-alias-state-business-primary');
  return {
    minWidth: guifPrivateVar('--guif-private-badge-min-width', '14px'),
    background: bg,
    color: guifVar('--guif-dock-badge-fg', '--dsw-alias-label-primary-inverted'),
  };
}

/** 图标行的整体盒（尺寸由 owner props 给；字号走公开变量，字面量只在 fallback 位）。 */
function glyphStyle(size) {
  const px = Number.isFinite(size) && size > 0 ? size : 18;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: `${px}px`,
    height: `${px}px`,
    fontSize: guifLiteral('--guif-dock-glyph-size', '13px'),
    color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
  };
}

/**
 * 解析一个入口 label：**字符串 / thunk**（注册选项里的 label 恒为 thunk）/ 其它 ⇒ `''`。
 *
 * ⚠ 这个函数存在的原因是一次真缺陷：旧版 `initialOf` 只认字符串，而坞**自己的**
 * 入口 label 是 `() => '按钮面板'` 这种 thunk ⇒ 兜底字形恒为 `•`（一个没有意义的中点）。用户看到
 * 侧栏那一行只有一个「•」，判定「按钮面板没实现」。凡走 thunk 的注册（即官方约定的全部）都会踩。
 */
export function resolveEntryLabel(label) {
  if (typeof label === 'string') return label;
  if (typeof label === 'function') {
    try {
      const value = label();
      if (typeof value === 'string') return value;
    } catch {
      // thunk 抛错 ⇒ 当作没有 label（非关键路径，兜底字形接管）
    }
  }
  return '';
}

/** 从入口 label 里取一个自绘兜底字形（首字；空 ⇒ `•`）。 */
function initialOf(label) {
  const text = resolveEntryLabel(label).trim();
  return text === '' ? '•' : Array.from(text)[0];
}

/** 坞图标自身的机检锚点。 */
export const DOCK_ICON_ATTR = 'data-guif-dock-icon';

/**
 * 每个入口图标「最后一次量的屏幕矩形」。
 *
 * 为什么记：面板要**贴着触发它的那颗按钮**长出来，而「点文字 / 按回车」那条路径没有事件对象
 * （`event === null`），量不到锚点。于是由图标自己在每次渲染后量一次（只读**我们自己渲染的节点**，
 * 不碰官方 DOM 结构 —— `dock.mjs` 里那条门禁禁止的是对官方 UI 做 DOM/CSS 外科手术）。
 * 记录失败（无 DOM / 节点不可量）一律不影响功能：面板退回缺省位。
 */
const entryAnchors = new Map();

/** 记一次图标矩形（内部用；`box` 传 `null` 表示量不到 ⇒ 清掉旧值）。 */
export function recordEntryAnchor(id, box) {
  const key = String(id ?? '');
  if (key === '') return null;
  if (box === null || box === undefined || !Number.isFinite(box.left)) {
    entryAnchors.delete(key);
    return null;
  }
  entryAnchors.set(key, { left: box.left, top: box.top, right: box.right, width: box.width, height: box.height });
  return entryAnchors.get(key);
}

/** 读某个入口图标最后一次量的矩形（没有 ⇒ `null`）。 */
export function readEntryAnchor(id) {
  return entryAnchors.get(String(id ?? '')) ?? null;
}

/**
 * 造**坞自己的图标**（2×2 圆角方格 ＝ 「一板子按钮」，就是这一行字面意思）。
 *
 * 为什么自绘而不是取官方 primitives：180 个官方成员里没有「一板子按钮」这一档语义
 * （`IconPanelLeftOutlineRegular` 是侧栏折叠、`IconCordisPluginOutlineRegular` 是官方插件面板 —— 用哪个都会撞语义）。
 * 约束照旧：零第三方依赖、颜色只走 `currentColor`（继承那一行的前景色，暗色主题自动跟随）、
 * 不写任何颜色字面量（`check:tokens` 硬门禁照过）。
 *
 * @param {object} react 种子 react
 * @returns {Function} 组件：`(props: {size?:number}) => element`
 */
export function createDockIcon(react) {
  const el = react.createElement;
  return function GuiFrameDockIcon(props) {
    const size = Number.isFinite(props?.size) && props.size > 0 ? props.size : 18;
    const cells = [];
    for (const row of [0, 1]) {
      for (const col of [0, 1]) {
        cells.push(el('rect', {
          key: `${row}${col}`,
          x: 1.5 + col * 7.5,
          y: 1.5 + row * 7.5,
          width: 5.5,
          height: 5.5,
          rx: 1.6,
          fill: 'currentColor',
        }));
      }
    }
    return el('svg', {
      [DOCK_ICON_ATTR]: 'true',
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    }, cells);
  };
}

/**
 * 造一个入口的**坞图标组件**（`sidebar.panellist` 的占用者）。
 *
 * ═══ 字形**不拦点击** ═══
 * 用户原话：「为什么点击『按钮面板』和它左边的图标得到的东西还是不同？不对的，**这是一整个按钮，
 * 不要做成两个**，点开后就是按钮面板。」
 *
 * 平台渲染的是**一个** `<button class=panelRow>`（`dsh-client-ui-sidebar` 的 `PanelRow`），我们的字形与
 * 平台自己渲染的 label 都是它的子节点；这一行**只有**一个动作：`layout.selectPanel(id)`。
 * 字形只负责**画自己**与**记自己的屏幕矩形**（浮出面板要贴着这一行长出来），点击由平台那一行统一派发
 * —— 给坞自己那一颗挂 `onActivate`（`stopPropagation` + 直接开面板）会让同一行的两半落到两个地方。
 *
 * @param {object} react 种子 react
 * @param {object} primitives `createPrimitivesSeat(seeds.primitives)` 的产物
 * @param {object} options
 * @param {string} options.id 入口 id（同时用于 `data-guif-glyph`，锚点记录也按它索引）
 * @param {unknown} options.label 入口 label（字符串或 thunk；只用于兜底字形）
 * @param {unknown} [options.icon] 入口图标（函数组件 / 元素 / null）
 * @param {() => (unknown)} [options.readBadge] **每次渲染都重新读**角标（坞的 store 是唯一真源）
 * @returns {Function} 组件：`(ownerProps: {size?:number, active?:boolean}) => element`
 */
export function createEntryGlyph(react, primitives, options) {
  const el = react.createElement;
  const id = String(options.id);
  const icon = options.icon ?? null;
  const readBadge = typeof options.readBadge === 'function' ? options.readBadge : () => null;
  /**
   * 每个入口都记矩形：面板要贴着触发它的那一行长出来，而「点文字 / 按回车」那条路径没有事件对象
   * （`event === null`）⇒ 由字形自己在挂载时量一次。**只读我们自己渲染的节点**，不碰官方 DOM。
   * ⚠ 用 **ref 回调**而不是 `useRef + useEffect`：这个图标会被「直接当函数调用」的测试装置渲染
   *   （那类调用里调 hook 会抛 `Invalid hook call`），ref 回调在两处都只是普通 prop，最稳。
   */
  const captureRef = {
    ref: (node) => {
      if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') {
        recordEntryAnchor(id, null);
        return;
      }
      try {
        recordEntryAnchor(id, node.getBoundingClientRect());
      } catch {
        recordEntryAnchor(id, null);
      }
    },
  };
  return function GuiFrameEntryGlyph(ownerProps) {
    const props = ownerProps ?? {};
    const badge = normalizeBadge(readBadge());
    const mark = icon === null || icon === undefined
      ? el('span', { [GLYPH_MARK_ATTR]: id, style: { lineHeight: 1 } }, initialOf(options.label))
      : (typeof icon === 'function' || typeof icon === 'object' && icon !== null && icon.$$typeof !== undefined
        ? el(icon, { size: props.size ?? 18 })
        : icon);
    return el('span', {
      [GLYPH_ATTR]: id,
      'data-guif-active': String(props.active === true),
      ...captureRef,
      style: glyphStyle(props.size),
    }, mark, badge === null ? null : el('span', {
      [BADGE_ATTR]: id,
      'data-guif-badge-tone': badge.tone ?? 'neutral',
      style: badgeStyle(badge.tone),
    }, badge.text));
  };
}
