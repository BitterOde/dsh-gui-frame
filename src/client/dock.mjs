/**
 * dock.mjs —— **入口坞**（能力①）与「坞＋面板」的成对注册。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 一、为什么必须**成对**注册（判据是机制，不是风格）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `ctx.layout.selectPanel(panelId)` 的实现是（实读 `dsh-client-ui-layout/lib/client.js`，偏移 ≈18107）：
 *   `if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error('layout.selectPanel: main panel "…" is not registered')`
 * 其中 `hasMainPanel = (id) => ctx.slots.entries("main").some((entry) => entry.options.key === id)`。
 * `MainPanelId` 的类型注释也写着「Identity shared by a sidebar panel entry and its main-slot occupant」。
 * ⇒ 坞里点一下 → `selectPanel(id)` → **`main` 上没有同名 keyed entry 就当场抛错**。
 * 所以 `sidebar.panellist`（list，`id` 必填）与 `main`（keyed，`key` 必填）**必须同值成对**，
 * 而且要在 `register()` 的**同一次同步调用里**就位（`dock.onEntry` 由 `service.__broadcast` 同步调用）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 二、注册路径只能是 `slots.inject(key, () => slots.register(options, Component))`
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 官方 `registry.d.ts` 原文：`inject` 的回调「**runs synchronously when the declaration already
 * exists**; otherwise it runs inside the declaring `register()` call after the declaration is
 * committed. **Collapse disposes the effect and a later declaration runs it again.**」；
 * 直接 `register` 到未声明的槽位会**同步抛** `slot "X" is not declared`。
 * ⇒ 座位存在性随官方 owner 的挂载而变（`sidebar.panellist` 由 client-ui-sidebar 声明、`main` 由
 * client-ui-layout 声明），必须用 `inject` 守卫，**不能**直接 register。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 三、坞的就位位置（探针结论与证据见 `tests/unit/dock-placement.test.mjs`）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `dsh-client-ui-sidebar` 的 `SidebarRoot` 渲染子节点顺序是
 *   `logoRow` → **`newSession` 按钮** → **`panels.length > 0 && <nav class=panelList>`（panellist 行）**
 *   → `regionArea`（sidebar.workspaces） → `footArea`
 * ⇒ `sidebar.panellist` **天然落在 newSession 正下方**（同一 flex 列里紧随其后），
 *   **不是**与 newSession 同位；newSession 是**无条件渲染**的（源码里没有任何开关/条件）。
 * ⇒ 「坞占据 newSession 原位」只有在 newSession 被隐藏后才成立，而隐藏它**没有官方开关**
 *   （只能靠 CSS/DOM 外科手术 = 反向修改官方 UI）⇒ **不做**，坞直接用「newSession 下方那一行」。
 *   证据与替代方案见交付说明。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 四、角标不进注册选项
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 官方 `register` 只保留 `key / id / order / label / priority` —— `badge` 会被**静静丢掉**。
 * 所以坞把角标存在自己的环里（`dock.setBadge(id, value)`），由**自绘图标组件**（`kit/entry-icons.mjs`）
 * 读出来画；`SLOT_OPTION_KEYS` 白名单就是这条的机检抓手。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 五、谁提供 ctx
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 切片方法第一个参数恒为**调用方 ctx**（`dock.onEntry(ctx, change)`）。`service.__broadcast`
 * 传进来的正是「当时在调 `register()` 的那个调用方 ctx」，所以插件卸载 ⇒ 它的 entry 被移除 ⇒
 * 坞同步撤掉那一对座位。装配期**回放**既有入口（恢复完成前注册的直接进坞）时用装配方 ctx。
 *
 * 本文件**零副作用**：`install(ctx, env)` 才产生效果，且**全部**经 `ctx.effect`。
 */

import { createError } from './contracts/errors.mjs';
import { WORKBENCH_PANEL_ID as WORKBENCH_PANEL_KEY } from './contracts/panel-ids.mjs';
import { CONSUMED_SLOT_KEYS, ENTRY_ID_MAX_LENGTH, ENTRY_ID_PATTERN, OWN_ID_PREFIX, RESERVED_ENTRY_IDS } from './contracts/service-face.mjs';
import { probeService } from './kit/probe.mjs';
import { createPanelContentFace } from './dock/panel-content.mjs';
import { createDockCore } from './dock/core.mjs';

/** 切片名（`service.__install('dock', api)`；切片白名单见 contracts/service-face.mjs）。 */
export const DOCK_SLICE_NAME = 'dock';

/** 坞自己的入口 id（坞 = panellist 的一个 entry，GUIFrame 自己的图标）＝ `dsh-gui-frame/dock`。 */
export const DOCK_ENTRY_ID = `${OWN_ID_PREFIX}dock`;

/**
 * 工作台那一格的 `main` key（**由坞在装配期与自己的入口同源同序注册**；真源 `contracts/panel-ids.mjs`）。
 * 这里再声明一次只为「坞侧一个口子拿全自己的座位」；字面量与 workbench 侧同源自契约文件
 * （打包器不支持 `export { … }` 再绑定形式 ⇒ 写法是「import 带别名 + 本地 const 导出」）。
 */
export const WORKBENCH_PANEL_ID = WORKBENCH_PANEL_KEY;

/** 收取的两个座位（顺序即注册顺序：先 panellist 后 main，不依赖对方的声明时机）。 */
export const PANELLIST_SLOT = CONSUMED_SLOT_KEYS.includes('sidebar.panellist') ? 'sidebar.panellist' : CONSUMED_SLOT_KEYS[0];
export const MAIN_SLOT = CONSUMED_SLOT_KEYS.includes('main') ? 'main' : CONSUMED_SLOT_KEYS[1];

/**
 * 允许出现在 slot 注册选项里的键（**白名单**，机检直接比对 `Object.keys(options)`）。
 * 官方 `SlotCore.register` 只保留 `key / id / order / label / priority`；坞只用前四个 ——
 * 角标**不在这里**（`badge` 没有官方字段，塞进去也是被丢掉：角标由坞自绘）。
 */
export const SLOT_OPTION_KEYS = Object.freeze(['id', 'key', 'label', 'name', 'order']);

/**
 * 坞入口的 label 文案键与兜底（走 owner 的 `t`；坞自己的文案不占用官方 locale 命名空间）。
 *
 * ⚠ 兜底文案 = **用户对该物的原话**（「我要的按钮面板」）。旧值 `'GUIFrame'` 是**包名**，
 * 侧栏那一行读起来像「又一个插件入口」而不是用户要的那件东西 —— 它必须是功能性命名，
 * 否则用户找不到入口。包身份仍由面板内的自检页与 README 承担。
 */
export const DOCK_LABEL_KEY = 'dock.label';
export const DOCK_LABEL_FALLBACK = '按钮面板';

/** 浮出面板的初始尺寸（可拖可缩 ⇒ 尺寸不是契约，**位置**才是：必须从按钮旁长出来）。 */
export const DOCK_PANEL_SIZE = Object.freeze({ width: 340, height: 440 });
/** 面板与锚点之间的间隙。 */
export const DOCK_PANEL_GAP = 8;

/**
 * 由**锚点矩形**（那颗按钮的屏幕矩形）算出面板的初始矩形：右缘 +8px、与按钮顶边对齐，
 * 再按视口夹一次（视口量不到就不夹 —— 容器 clamp 由 FloatingWindow 自己兜）。
 * @param {{left?:number, top?:number, right?:number, width?:number}|null} anchor
 * @param {{width:number, height:number}|null} [viewport] 缺省读 `window`（Node 里为 null）
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function panelRectNear(anchor, viewport) {
  const size = DOCK_PANEL_SIZE;
  const view = viewport === undefined
    ? (typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight })
    : viewport;
  const left = anchor !== null && anchor !== undefined && Number.isFinite(anchor.left) ? anchor.left : null;
  const width = anchor !== null && anchor !== undefined && Number.isFinite(anchor.width) ? anchor.width : 0;
  const right = anchor !== null && anchor !== undefined && Number.isFinite(anchor.right) ? anchor.right : (left === null ? null : left + width);
  const top = anchor !== null && anchor !== undefined && Number.isFinite(anchor.top) ? anchor.top : null;
  const rawX = right === null ? 16 : right + DOCK_PANEL_GAP;
  const rawY = top === null ? 16 : Math.max(8, top - 8);
  const x = view === null ? rawX : Math.max(8, Math.min(rawX, view.width - size.width - 8));
  const y = view === null ? rawY : Math.max(8, Math.min(rawY, view.height - size.height - 8));
  return { x, y, width: size.width, height: size.height };
}

/** 从 React 合成事件里量出**触发元素**的矩形（拿不到 ⇒ `null`，面板走缺省位）。 */
export function anchorRectOf(event) {
  const node = event === null || event === undefined ? null : event.currentTarget ?? null;
  if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return null;
  try {
    const box = node.getBoundingClientRect();
    if (box === null || typeof box !== 'object' || !Number.isFinite(box.left)) return null;
    return { left: box.left, top: box.top, right: box.right, width: box.width, height: box.height };
  } catch {
    return null;
  }
}

/**
 * 没有事件对象时（键盘/替身）⇒ `null`：面板走 `panelRectNear(null)` 的安全缺省位。
 * ⚠ 这里**故意不查 DOM**：门禁扫 `dock.mjs` 的代码里不许出现 `document.`
 * （本包不做任何「对官方 UI 的 DOM/CSS 外科手术」）—— 坞只认自己拿到的事件矩形。
 * @param {object|null|undefined} event
 * @returns {object|null}
 */
export function anchorFromEvent(event) {
  return event === null || event === undefined ? null : anchorRectOf(event);
}

/** 入口 id 的准入（复用冻结的服务面正则/保留字/长度上限；错误码取既有 `GUIF-E-ENTRY-INVALID`）。 */
export function assertEntryId(id) {
  if (typeof id !== 'string' || id === '') {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 必须是非空字符串（收到 ${JSON.stringify(id)}）`, { id });
  }
  if (id.length > ENTRY_ID_MAX_LENGTH) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 长度不得超过 ${ENTRY_ID_MAX_LENGTH}（收到 ${id.length}）`, { id });
  }
  if (RESERVED_ENTRY_IDS.includes(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 不得占用保留 key「${id}」（会顶掉外壳自己的会话界面）`, { id });
  }
  if (!ENTRY_ID_PATTERN.test(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 必须带命名空间前缀且只含 [A-Za-z0-9._-/]（如 ${DOCK_ENTRY_ID}，收到「${id}」）`, { id });
  }
  return id;
}

/** 在**调用方** ctx 上挂一条幂等副作用（副作用一律经 ctx.effect）。 */
function effectOn(ctx, label, install) {
  const dispose = ctx.effect(install, label);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (typeof dispose === 'function') dispose();
  };
}

/** 坞自己的 label 解析（owner 的 `t` 优先；thunk 抛错不冒泡）。 */
function dockLabel(t) {
  if (typeof t === 'function') {
    try {
      const value = t(DOCK_LABEL_KEY);
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 落到兜底
    }
  }
  return DOCK_LABEL_FALLBACK;
}

/** 解析一个入口的 label（字符串 / thunk / 缺省 ⇒ 入口 id）。 */
function entryLabel(record) {
  const label = record.label;
  if (typeof label === 'function') {
    try {
      const value = label();
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 落到 id
    }
  } else if (typeof label === 'string' && label !== '') {
    return label;
  }
  return record.id;
}

/** 排序键：`order` 缺省排最后。 */
function rank(order) {
  return Number.isInteger(order) ? order : Number.MAX_SAFE_INTEGER;
}

/**
 * 本包**自己贡献的附加入口**（坞的管理页）＝ 不该在侧栏再占一行的那一类。
 * 判据只用「来源包名 + 不是坞自己的入口」两条，不认具体 id —— 免得日后加一个自检页就漏一处。
 */
function isInternalEntry(record) {
  return record.source === 'dsh-gui-frame' && record.id !== DOCK_ENTRY_ID;
}

function result(installed, reason, extra) {
  return { capability: 'dock', installed, reason, ...(extra ?? {}) };
}

// ── 按钮面板的正文（在 `./dock/panel-content.mjs`）───────────────────────────────
//    两个常量（坞自己的入口 id / 入口 label 解析）在本侧声明 ⇒ 经 bag 交进去，本模块不复制声明。
// 正文工厂要拿得到「改自己那一行的角标/标签」的两个 setter —— 用**取值函数**交进去
// （坞实例晚于本行创建 ⇒ 收取值函数而不是快照，避免把「早建晚用」的对象捕获成 null）；`currentDock` 先声明。
let currentDock = null;
const panelContent = createPanelContentFace({
  DOCK_ENTRY_ID,
  // ★ 行的 `label` 取注册面元数据（thunk 支持）——用本侧**同一个** `entryLabel`，不复制声明
  entryLabel,
  // ⚠ 必须走**切片级单参封装**（`service.__slice('dock')` 的 `setBadge(id, badge)`）：内部面
  //   `api.setBadge(callerCtx, id, badge)` 是三参签名，拿它当 `(id, badge)` 用会 `registry.get(callerCtx)`
  //   恒 undefined ⇒ **静默返回 false**（踩过一次）。坞实例自己那两个是单参封装（`dock.setBadge(id, badge)`）；
  //   取值函数形态：坞实例晚于本行创建 ⇒ 收函数不收快照。
  setBadge: (id, badge) => currentDock?.setBadge?.(id, badge),
  setLabel: (id, label) => currentDock?.setLabel?.(id, label),
});
const { readDockActions, createPanelContent } = panelContent;

/**
 * 造一个坞实例（**不做**任何注册；`install(ctx)` 才产生副作用）。
 *
 * 函数体整段在 `./dock/core.mjs` —— 坞作用域的状态（registry / refs /
 * store / api / dock）**随组搬走**，本文件只把常量、几何、纯 helper 与面板正文经 bag 交进去。
 *
 * @param {{service?:object, seeds?:object, note?:Function}} env 装配面
 */
export function createDock(env) {
  return createDockCore({
    env,
    consts: { DOCK_SLICE_NAME, DOCK_ENTRY_ID, PANELLIST_SLOT, MAIN_SLOT, DOCK_LABEL_FALLBACK, WORKBENCH_PANEL_ID },
    geometry: { panelRectNear, assertEntryId },
    helpers: { effectOn, dockLabel, entryLabel, rank, isInternalEntry },
    readDockActions,
    createPanelContent,
  });
}

/**
 * 装配入口坞。
 *
 * 语义：
 *  - `env.service` 缺席 ⇒ `{installed:false, reason:'no-service'}`，**不注册任何座位**；
 *  - `ctx.get('slots')` 缺席 ⇒ `{installed:false, reason:'no-slots'}`（座位服务都没有，坞无处可落）；
 *  - 同一 service 已装过切片 ⇒ `{installed:false, reason:'already-installed'}`（幂等，不重复注册）。
 *
 * @param {object} ctx 调用方 Cordis ctx
 * @param {{service?:object, seeds?:object}} env 装配面
 */
export function install(ctx, env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  const service = bag.service;
  if (service === null || typeof service !== 'object') return result(false, 'no-service');
  if (typeof ctx?.effect !== 'function') return result(false, 'no-ctx-effect');
  if (typeof service.__install !== 'function') return result(false, 'no-service-face');
  if (typeof service.__slice === 'function' && service.__slice(DOCK_SLICE_NAME) !== undefined) {
    return result(false, 'already-installed');
  }
  const slots = probeService(ctx, 'slots');
  if (slots === undefined || slots === null) return result(false, 'no-slots');
  let dock;
  try {
    dock = createDock(bag);
    currentDock = dock; // ★ 让正文工厂里的两个取值函数能落到这个实例的 `api` 上
  } catch (error) {
    if (typeof service.__note === 'function') {
      service.__note('GUIF-W-LISTENER-THREW', `坞装配失败（缺 react 种子？）：${error?.message ?? error}`);
    }
    return result(false, 'create-failed');
  }
  let dispose;
  try {
    dispose = dock.install(ctx);
  } catch (error) {
    // 官方 `slots.inject` 在"槽位已声明但回调装配失败"时会**同步抛**；这里兜住并让位，
    // 绝不把异常冒到汇合点 —— 客户端 apply 抛错会让 mountApp 永不执行。
    if (typeof service.__note === 'function') {
      service.__note('GUIF-W-LISTENER-THREW', `坞装配期抛错（已兜住，页面照常）：${error?.message ?? error}`);
    }
    return result(false, 'install-threw');
  }
  if (dispose === null) return result(false, 'no-slots');
  return result(true, null, { dock, store: dock.store, dispose, entryId: DOCK_ENTRY_ID });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * 面板内容的两件工具（**模块作用域**：坞一装上就能用，不等任何组件渲染）
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** 空态：**面板里一个外部按钮都没有**时的说明（不是错误，是这个阶段的事实）。 */
