/**
 * components.mjs —— 对外暴露的**六个复合组件**（props 契约见
 * `src/client/contracts/components.mjs`，**只许加可选 props，不许改名/删名**）。
 *
 *   Panel / Toolbar / Empty / ErrorState / List / KeyValue
 *
 * ═══ 三条机制（不是风格）═══
 * ① **必须用 `react.createElement`**：自研打包器只重写 import/export，**不做 JSX / TS 变换**。
 * ② **只用官方 38 个包真实用过的 primitives 子集**：取用一律经 `kit/primitives.mjs` 的
 *    `createPrimitivesSeat` 闸门；种子缺席时 `get()` 返回 `undefined`，组件退到自研等价物
 *    （`<button>` / `<span>`），**不炸页面**。
 * ③ **壳组件自己 catch 渲染错误**：每个组件最外层是 try/catch —— 我们自己组装期间抛错
 *    → 就地渲染 ErrorState；子树（插件内容）抛错 → 由壳内的 `GuiFrameRenderBoundary` 接住。
 *    官方 boundary 只给一个空 div，那不叫错误态。
 *
 * ═══ 样式 ═══
 * 每个取值位置都是 `var(...)`：颜色落到 `--dsw-*` token，尺寸/间距落到 `--guif-*`（公开）或
 * `--guif-private-*`（私有）变量，字面量**只允许出现在 var() 的 fallback 位置**。
 * 取用一律经 `kit/tokens.mjs` 的三个助手，名字不在白名单即抛（不会静默写出悬空 token）。
 *
 * 本文件**零副作用**：`createComponents(env)` 只造闭包，不注册任何东西（注册在 `index.mjs`）。
 */

import { createRenderBoundary, safeRender } from './boundary.mjs';
import { panelBaseStyles } from '../kit/surface.mjs';
import { describeError, normalizeState, resolveLabel, stateFromSessions } from './state.mjs';
import { createPrimitivesSeat } from '../kit/primitives.mjs';
import { guifLiteral, guifPrivateVar, guifVar, dsw } from '../kit/tokens.mjs';
import { createPanelViews } from './components/views.mjs';
import { createPanelComponents } from './components/shell.mjs';

/** 机检锚点（结构断言用；也是真机收口时肉眼可见的抓手）。 */
export const ANCHORS = Object.freeze({
  panel: 'data-guif-panel',
  panelHeader: 'data-guif-panel-header',
  panelTitle: 'data-guif-panel-title',
  panelBody: 'data-guif-panel-body',
  panelStatus: 'data-guif-panel-status',
  panelActive: 'data-guif-active',
  sessionsCount: 'data-guif-sessions-count',
  toolbar: 'data-guif-toolbar',
  action: 'data-guif-action',
  row: 'data-guif-row',
  field: 'data-guif-field',
  state: 'data-guif-state',
});

/** 可显式触发的三态在树上的锚点值（`data-guif-state` 的取值）。 */
export const STATE_VALUES = Object.freeze(['loading', 'empty', 'error']);

/**
 * 面板骨架的**公开变量缺省值不在这里，也不在元素上** —— 它们在 `var()` 的**回退位**
 * （`kit/surface.mjs`：`guifLiteral('--guif-panel-padding', '10px')` / `'-gap', '8px'` /
 * `'-radius', '12px'`；本文件的 `styles()` 取用同一份）。冻结读数在
 * `tests/unit/panel-components.test.mjs` 与 `tests/unit/dock-style-vars.test.mjs`。
 *
 * ═══ **为什么不写进面板根内联 style** —— 那样写会踩两个坑 ═══
 * 把缺省值铺成面板根上的**内联自定义属性**（`style={{...defaults, ...S.panel}}`）看着更顺，
 * 但有两个坑，而且「接入方在任意父级都能覆盖」这句话在那种写法下**根本不成立**：
 *   ① 自定义属性走继承，**元素自己的声明恒胜过继承值** ⇒ 祖先给的覆盖值在这棵子树上被挡死；
 *   ② 表里 `--guif-panel-radius` 的值是 `var(--dsw-corner-shape)`，而 `--dsw-corner-shape` 是
 *      **corner-shape 用的关键字**（外壳只在 `@supports (corner-shape:superellipse(1.5))` 里声明它，
 *      值形如 `superellipse(1.5)`）—— 拿它当 `border-radius` 用 ⇒ 计算值非法（IACVT）⇒
 *      **圆角退化成 0**，而真正想要的 `12px` 兜底永远轮不到。
 * ⇒ 现在：**缺省只在回退位，元素上一个 `--guif-*` 都不声明**。观感回到设计值（面板根 12px /
 *   关闭按钮 6px / 内容区 padding 10px / gap 8px），祖先覆盖真的生效。
 * 牙：`tests/unit/dock-style-vars.test.mjs`（渲染树里**不得**有 `--guif-*` 键）与
 *     `tests/client/panel-styles.test.mjs`（源码级扫「把 `--guif-*` 当对象键」的写法）。
 */

/**
 * 认「**根本不在 React 渲染树里**」这一类错 —— `readHook` 缺席分支唯一允许吞掉的错。
 *
 * 组件被当普通函数直接调用时（元素树断言层就这么调 `Panel(props)`：`tests/client/panel-states.test.mjs`），
 * React 的 dispatcher 是 `null` ⇒ 任何 hook 一调就炸。两种真实形态都要认：
 *   · React 19：`resolveDispatcher` 只 `console.error('Invalid hook call…')` 后**返回 null**，
 *     于是属性访问继续炸 ⇒ `TypeError: Cannot read properties of null (reading 'useSyncExternalStore')`；
 *   · 老版本/其它入口：直接 `Error: Invalid hook call. Hooks can only be called inside…`。
 *
 * 那种场合**压根不存在 hook 链**（没有 fiber、没有上一次渲染），吞掉它不可能掩盖「数量/顺序漂移」——
 * 这是本条 catch 的合法性来源。**其余错误一律继续冒泡**（真渲染期抛的 hooks 错必须让面板显形）。
 * 按消息文本判而不按错误类型判：同一件事在各版本分别抛 `TypeError` 与 `Error`，按类型会漏。
 */
function isNoDispatcherError(error) {
  if (error === null || typeof error !== 'object') return false;
  const message = typeof error.message === 'string' ? error.message : '';
  if (/Invalid hook call/i.test(message)) return true;
  return /read(ing)? propert(y|ies) of (null|undefined)/.test(message) && message.includes('useSyncExternalStore');
}

/** 占位 hook 的空订阅（**恒等引用**：每次渲染传同一个函数，`useSyncExternalStore` 才不会反复重订阅）。 */
const NOOP_SUBSCRIBE = () => () => {};
/** 占位 hook 的常量快照（恒 `null`；primitive 恒等，永不触发更新循环）。 */
const NULL_SNAPSHOT = () => null;

/**
 * 原样取回快照的选择器 —— 与外壳自己的 `useSessions((s) => s)`（`dsh-client-ui-workspace` 真实调用点）同款。
 * ⚠ 它返回的**就是**快照对象：安全的前提是外壳的 store 快照引用稳定（外壳自己就这么用 ⇒ 这是它的契约）。
 */
const SELECT_SNAPSHOT = (snapshot) => snapshot;

/**
 * `usePanelInfo` 的选择器：**只取一个原语**（外壳自己的用法就是这个形状：
 * `usePanelInfo((info) => info.activePanelId)`，见 `dsh-client-ui-layout` / `dsh-client-ui-sidebar`）。
 *
 * ⚠ 为什么必须返回**原语**：`useSyncExternalStoreWithSelector` 会拿选择结果与上一次比较（默认 `Object.is`），
 * 选择器若返回新对象，React 每次都判「变了」⇒ 无限重渲染。`activePanelId` 是 `string | null`，天然稳定。
 * 不认识快照（`null`/非对象）⇒ `undefined`，调用点据此走"不知道"分支。
 */
const SELECT_ACTIVE_PANEL_ID = (info) => (info === null || typeof info !== 'object' ? undefined : info.activePanelId);

/**
 * 把 `usePanelInfo` 的返回值**归一化成 `activePanelId`**（`string | null | undefined`）。
 *
 * 为什么还要在调用点再兜一次：`readHook` 返回的是**注入 hook 的返回值**，而选择器是**交给 hook**的：
 *   · 外壳的选择器 hook（`bindSnapshotSelector`）会**应用**我们传的选择器 ⇒ 已经拿到 `activePanelId`（原语）；
 *   · "自己不吃参数"的取值函数（单测 / 旧接入方常见）会忽略选择器、直接返回**整个快照对象** ⇒ 这里补一次提取。
 * 两种形状都能得到同一种原语值；`null`（hook 缺席 ⇒ 占位快照）原样返回，调用点据此记"不知道"。
 */
const normalizeActivePanelId = (value) => {
  if (value === null) return null;
  if (value !== null && typeof value === 'object') return value.activePanelId ?? null;
  return value;
};

/**
 * `readHook` 在「注入缺席」时用的**占位 hook**：恒定消耗**恰好 1 个 `useSyncExternalStore` 槽**。
 *
 * 为什么必须真是个 hook、且必须是这个类型：外壳在两次渲染之间改变注入 owner 集合时（平台补装窗口 /
 * demo 重装），占用槽数一变 React 就报 #300 / #310，类型一变报「change in the order of Hooks」。
 * 详见 `readHook` 的注释。
 *
 * ═══ 唯一的 catch：`isNoDispatcherError` 放行（真踩过）═══
 * 无 DOM 的元素树断言层（`tests/client/panel-states.test.mjs`）把组件**当普通函数直接调**：
 * `Panel({ id: 'p-loading', state: 'loading' })`。那时没有 fiber、没有 dispatcher，任何 hook 一调就炸
 * ——旧写法（不包）会让整个「缺席」路径变成 `Cannot read properties of null (reading 'useSyncExternalStore')`，
 * 面板显示成这句废话而不是它真正的状态。该场合**不存在 hook 链**，所以吞掉这一个错不可能掩盖
 * 数量/顺序漂移；**其它任何错误照常冒泡**（真渲染期抛的错必须让面板显形）。
 *
 * @param {object} react 种子 react（真 React 或测试替身）
 * @returns {unknown} 常量 `null`（占位快照）
 */
function useStandInHook(react) {
  if (typeof react.useSyncExternalStore === 'function') {
    try {
      return react.useSyncExternalStore(NOOP_SUBSCRIBE, NULL_SNAPSHOT, NULL_SNAPSHOT);
    } catch (error) {
      if (!isNoDispatcherError(error)) throw error;
      return null;
    }
  }
  // 替身（假 react）没有 useSyncExternalStore：退到 useState；替身不校验 hooks 顺序，此分支只影响替身。
  const placeholder = react.useState(null);
  return placeholder[0];
}

/**
 * 造六个复合组件。
 * @param {{seeds?:object, note?:(code:string,message:string)=>void}} env 装配面（`install(ctx, env)` 的 env）
 * @returns {{Panel:Function, Toolbar:Function, Empty:Function, ErrorState:Function, List:Function, KeyValue:Function,
 *   primitives:object, boundary:Function, styles:object}}
 */
export function createComponents(env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  const seeds = bag.seeds !== null && typeof bag.seeds === 'object' ? bag.seeds : {};
  const react = seeds.react;
  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
    throw new Error('[gui-frame] createComponents(env) 需要 env.seeds.react（没有种子就没有 React 树——不猜第二份 react）');
  }
  const note = typeof bag.note === 'function' ? bag.note : null;
  const primitives = createPrimitivesSeat(seeds.primitives);
  const Boundary = createRenderBoundary(react);
  const el = react.createElement;
  const S = styles();
  // ⚠ 这里不铺 `defaults`：缺省值只在 `var()` 的回退位（为什么，见文件头那两个坑）。

  /** 官方原子组件（缺席 ⇒ `undefined`，调用点自己退到自研等价物）。 */
  const atom = (name) => primitives.get(name);

  /** 上报（壳内部自 catch 时调）。码只能取冻结集合里的码：`GUIF-W-LISTENER-THREW`。 */
  const report = (error) => {
    if (note !== null) note('GUIF-W-LISTENER-THREW', describeError(error));
  };

  // ── 组件实现（**状态视图组 → `./components/views.mjs`**；
  //    六个复合组件 + 原子使用点 → `./components/shell.mjs`。两处都只吃显式 bag，**函数体一字未动**）──
  const views = createPanelViews({
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, Boundary,
  });
  const shell = createPanelComponents({
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, STATE_VALUES, Boundary,
    SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, normalizeField, sessionCount,
    // 视图组整包转交（`readHook` / `stateView` / `errorView` / `emptyView` / `loadingView` / `errorProps` / `guardSlot` / `isElementNode` / `resolveState`）
    ...views,
  });
  const { Panel, Toolbar, Empty, ErrorState, List, KeyValue } = shell;

  return { Panel, Toolbar, Empty, ErrorState, List, KeyValue, primitives, boundary: Boundary, styles: S };
}

/** 骨架样式表（**每个取值都是 `var(...)`**：颜色 → `--dsw-*`，尺寸 → `--guif-*` / `--guif-private-*`）。 */
function styles() {
  const stroke = guifVar('--guif-panel-border', '--dsw-elevation-stroke');
  // ★ 脸 / 头 / 标题 / 内容区**一律取面板基类**（`panel/base.mjs`）：与浮出面板共用同一份皮。
  //   这里与 `overlay/panel.mjs` 曾各写一套，浮出面板那边漏了底面 ⇒ 用户当场判
  //   「你现在的面板连背景都没有」。现在表面规则只有一份，两处不可能再漂移。
  const base = panelBaseStyles();
  return Object.freeze({
    panel: Object.freeze({ ...base.frame, gap: guifLiteral('--guif-panel-gap', '8px'), height: '100%' }),
    header: base.header,
    title: base.title,
    body: base.body,
    status: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minHeight: guifPrivateVar('--guif-private-status-min-height', '24px'),
      padding: '4px 8px',
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
      borderTop: `1px solid ${stroke}`,
    }),
    toolbar: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: guifLiteral('--guif-toolbar-gap', '6px'),
      padding: '4px 0',
    }),
    slot: Object.freeze({ display: 'inline-flex' }),
    stateBox: Object.freeze({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      padding: '16px 12px',
      textAlign: 'center',
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
    }),
    stateTitle: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-primary'),
      fontWeight: 600,
    }),
    stateDetail: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-tertiary'),
      background: guifVar('--guif-panel-bg', '--dsw-alias-markdown-code-block'),
      fontSize: dsw('--dsw-font-xs-13-font-size'),
      padding: '6px 8px',
      borderRadius: guifVar('--guif-panel-radius', '--dsw-corner-shape'),
      maxWidth: '100%',
      overflowWrap: 'anywhere',
    }),
    row: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minHeight: guifPrivateVar('--guif-private-row-min-height', '28px'),
      padding: '2px 4px',
      borderRadius: guifVar('--guif-panel-radius', '--dsw-corner-shape'),
    }),
    rowBody: Object.freeze({ minWidth: 0, flex: '1 1 auto' }),
    field: Object.freeze({
      display: 'grid',
      gridTemplateColumns: 'minmax(72px, max-content) 1fr',
      gap: '4px 10px',
      alignItems: 'baseline',
      margin: 0,
      padding: '4px 8px',
    }),
    fieldKey: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
      fontSize: 'var(--dsw-font-xxs-12-font-size)',
    }),
    fieldValue: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-primary'),
      overflowWrap: 'anywhere',
      margin: 0,
    }),
  });
}

/** `[k, v]` / `{key|label|name, value}` / `{k, v}` / 裸字符串 ⇒ `{key, value}`。 */
function normalizeField(entry, index) {
  if (Array.isArray(entry)) return { key: String(entry[0] ?? index), value: renderable(entry[1]) };
  if (entry !== null && typeof entry === 'object') {
    const key = entry.key ?? entry.label ?? entry.name ?? `#${index}`;
    return { key: String(key), value: renderable(entry.value ?? entry.v ?? '') };
  }
  return { key: String(entry ?? index), value: '' };
}

/** 值原样交给 React（字符串/数字/元素都合法）；普通对象序列化成一行（不猜渲染方式）。 */
function renderable(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.$$typeof === undefined) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

/** 会话数（`SessionListSnapshot.items`）；形状不认识时记 0（**不猜**）。 */
function sessionCount(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 0;
  const items = snapshot.items;
  return Array.isArray(items) ? items.length : 0;
}
