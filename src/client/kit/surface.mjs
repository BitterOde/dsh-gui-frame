/**
 * base.mjs —— **面板基类**（`--dsw-*` 表面 + 头部 + 内容区 + 底部；全包唯一真源）。
 *
 * ═══ 为什么要抽这一层（用户原话：「你就不能借鉴一下人家的面板代码，写自己的基类？」）═══
 * 之前「坞的面板」有两套皮：`components.Panel`（主区面板，有表面）与 overlay 里另写的一个**裸 div**
 * （没有背景 ⇒ 用户当场判「你现在的面板连背景都没有」）。两处各写一份 = 必然漂移。
 * 现在**只有这一份**：主区面板（`components.Panel`）与浮出面板（`overlay/panel.mjs`）都渲染这四个零件。
 *
 * ═══ 表面规则是从自家插件的事故里抄来的（TextManager `src/client/styles.mjs`）═══
 *  · **底面必须不透明**：TextManager 的事故原文 —— 悬浮窗标题条用了
 *    `--dsw-alias-interactive-bg-hover`（近全透明的 hover wash，浅色 `#2631480f` ≈6%），
 *    压在下面那扇窗的文字**直接透上来**，看成一团糊。⇒ 面板的底面只用「抬起的层」这类不透明层色
 *    （`--dsw-alias-bg-layer-2`，缺省再退 `--dsw-alias-bg-base`），**绝不用 hover/遮罩色当脸**。
 *  · **一像素实边框 + 圆角 + 投影**三件套齐全（TextManager 的 `WINDOW_FRAME` 就是这个组合：
 *    `border: 1px solid <border-l2>` + `borderRadius: 12px` + `boxShadow`）。
 *  · **头部与内容区之间一条分隔线**（TextManager 的 `windowHeader`：`borderBottom: 1px solid`）。
 *
 * 颜色一律经 `kit/tokens.mjs` 的白名单引用（硬编码颜色会被 `check:tokens` 硬门禁拦下）；
 * 尺寸/间距走公开变量 `--guif-panel-*`（接入方可覆盖）。本文件**零副作用**：只有样式表与薄组件。
 */
import { dsw, guifLiteral, guifPrivateVar, guifVar } from './tokens.mjs';

/** 面板底面的层色（**必须不透明** —— 理由见文件头的事故记录）。 */
export const PANEL_SURFACE_TOKEN = '--dsw-alias-bg-layer-2';
/** 面板边框的层色（`border-l2` 比 `l3` 实，浮层才立得住）。 */
export const PANEL_BORDER_TOKEN = '--dsw-alias-border-l2';
/** 头部与内容区之间的分隔线（低一档，不抢边框）。 */
export const PANEL_DIVIDER_TOKEN = '--dsw-alias-border-l3';

/** 面板基类的机检锚点（沿用 `components.mjs` 里已冻结的那一套，不另造名字）。 */
export const BASE_ANCHORS = Object.freeze({
  frame: 'data-guif-panel-frame',
  header: 'data-guif-panel-header',
  title: 'data-guif-panel-title',
  close: 'data-guif-panel-close',
  body: 'data-guif-panel-body',
  footer: 'data-guif-panel-footer',
});

/** 圆角（字面量只出现在 `var()` 的 fallback 位）。 */
export const PANEL_RADIUS_FALLBACK = '12px';

/**
 * 面板基类样式表。**唯一真源**：主区面板与浮出面板都从这里取。
 * @returns {{frame:object, header:object, title:object, close:object, body:object, footer:object}}
 */
export function panelBaseStyles() {
  const surface = guifVar('--guif-panel-bg', PANEL_SURFACE_TOKEN, dsw('--dsw-alias-bg-base'));
  const stroke = guifVar('--guif-panel-border', PANEL_BORDER_TOKEN);
  const divider = dsw(PANEL_DIVIDER_TOKEN);
  const fg = guifVar('--guif-panel-fg', '--dsw-alias-label-primary');
  return Object.freeze({
    /** 脸：不透明底面 + 实边框 + 圆角 + 投影 + 裁切 + **自己接回指针事件**。 */
    frame: Object.freeze({
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      minHeight: 0,
      background: surface,
      color: fg,
      border: `1px solid ${stroke}`,
      borderRadius: guifLiteral('--guif-panel-radius', PANEL_RADIUS_FALLBACK),
      boxShadow: `0 8px 24px ${dsw('--dsw-alias-bg-mask-1')}`,
      overflow: 'hidden',
      // 自己接回指针事件（RAMManager 的 `.rm-panel` 同款：`pointer-events:auto`）——
      // 浮层根容器是点击穿透的，这一句让面板自己可点，且不必依赖宿主包裹层的样式。
      pointerEvents: 'auto',
    }),
    /** 头部：**不透明**底（同 frame）+ 一条分隔线 + 定高。 */
    header: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      gap: guifLiteral('--guif-panel-gap', '8px'),
      minHeight: guifPrivateVar('--guif-private-header-min-height', '32px'),
      padding: '6px 10px',
      flex: 'none',
      borderBottom: `1px solid ${divider}`,
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
      fontSize: 'var(--dsw-font-xs-13-font-size)',
    }),
    title: Object.freeze({
      flex: '1 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-primary'),
    }),
    close: Object.freeze({
      appearance: 'none',
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
      lineHeight: 1,
      padding: '2px 6px',
      borderRadius: guifLiteral('--guif-panel-radius', '6px'),
      flex: 'none',
    }),
    /** 内容区：可滚动 + 内边距（面板高度定了，内容多了在自己这格里滚）。 */
    body: Object.freeze({
      flex: '1 1 auto',
      minHeight: 0,
      overflow: 'auto',
      padding: guifLiteral('--guif-panel-padding', '10px'),
      display: 'flex',
      flexDirection: 'column',
      gap: guifLiteral('--guif-panel-gap', '8px'),
    }),
    /** 底部（可选）：动作条，与内容区之间一条分隔线。 */
    footer: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: guifLiteral('--guif-panel-gap', '8px'),
      padding: '6px 10px',
      flex: 'none',
      borderTop: `1px solid ${divider}`,
    }),
  });
}

/**
 * 造面板基类的**零件**（薄组件：只铺样式与锚点，不带状态、不带 hook）。
 *
 * 谁用：① `components.Panel`（主区面板骨架）② `overlay/panel.mjs`（贴边浮出的按钮面板）。
 * 两处都只组合这四个零件 ⇒ 表面/头部/分隔线永远一致。
 *
 * @param {object} react 种子 react
 * @returns {{Frame:Function, Header:Function, Body:Function, Footer:Function, styles:object}}
 */
export function createPanelParts(react) {
  const el = react.createElement;
  const styles = panelBaseStyles();

  /** 脸：`{id?, style?, children, ...rest}`（`style` 可叠加定位，例如浮出面板的 left/top/width/height）。 */
  function Frame(props) {
    const p = props ?? {};
    return el('div', {
      ...(p.id === undefined || p.id === null ? {} : { [BASE_ANCHORS.frame]: String(p.id) }),
      style: { ...styles.frame, ...(p.style ?? {}) },
      onPointerDownCapture: p.onPointerDownCapture,
      'data-guif-family': p.family,
      'data-guif-z': p.z === undefined || p.z === null ? undefined : String(p.z),
      role: p.role,
      'aria-label': p.label,
    }, p.children ?? null);
  }

  /** 头部：`{id?, title, onClose?, closeLabel?, extra?}`。 */
  function Header(props) {
    const p = props ?? {};
    const close = typeof p.onClose === 'function' ? p.onClose : null;
    return el('div', { [BASE_ANCHORS.header]: String(p.id ?? ''), style: styles.header },
      el('span', { key: 'title', [BASE_ANCHORS.title]: String(p.id ?? '') , style: styles.title }, p.title ?? ''),
      p.extra ?? null,
      close === null ? null : el('button', {
        key: 'close',
        type: 'button',
        [BASE_ANCHORS.close]: String(p.id ?? ''),
        'aria-label': p.closeLabel ?? '关闭',
        title: p.closeLabel ?? '关闭',
        style: styles.close,
        onClick: () => close(),
      }, '✕'));
  }

  /** 内容区：`{id?, children, header?}`（`header` 为真 ⇒ 预留头部空间，滚动区不吃头部）。 */
  function Body(props) {
    const p = props ?? {};
    return el('div', { [BASE_ANCHORS.body]: String(p.id ?? ''), style: styles.body }, p.children ?? null);
  }

  /** 底部动作条（可选）。 */
  function Footer(props) {
    const p = props ?? {};
    if (p.children === undefined || p.children === null) return null;
    return el('div', { [BASE_ANCHORS.footer]: String(p.id ?? ''), style: styles.footer }, p.children);
  }

  return { Frame, Header, Body, Footer, styles };
}
