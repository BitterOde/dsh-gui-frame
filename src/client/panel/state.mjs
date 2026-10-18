/**
 * state.mjs —— 面板的**三态模型**：loading / 空 / 错 各有一个可显式触发的 demo，
 * 面板外壳提供 header/body/status + loading/错误/空态/刷新。
 *
 * 三态是**显式**的，不是「碰巧渲染出空数组」：
 *   - 组件接受可选的 `state` prop（`'ready' | 'loading' | 'empty' | 'error'`）；
 *   - 也可以从官方数据面**推导**：`stateFromSessions(useSessions())` 把
 *     `SessionListSnapshot.state ∈ {idle,loading,error}` + `items.length` 映射成四态里的一态；
 *   - 每个态渲染出的根节点都带 `data-guif-state="<态>"`（机检锚点：`findByAttr(tree,'data-guif-state','loading')`）。
 *
 * 文案一律**可被 `t` 覆盖**（`label` 支持 thunk，组件层同样适用）。
 *
 * 本文件**零副作用**：纯函数，不碰种子、不碰 DOM。
 */
import { createError } from '../contracts/errors.mjs';

/** 四态（`ready` 是「正常渲染 children」那一态）。 */
export const PANEL_STATES = Object.freeze(['ready', 'loading', 'empty', 'error']);

/** 需要**显式可触发**的三态（判据就是这三个字面量）。 */
export const TRIGGERABLE_STATES = Object.freeze(['loading', 'empty', 'error']);

/** 机检锚点属性名（组件渲染出来的根节点上恒有它，值＝当前态）。 */
export const STATE_ATTR = 'data-guif-state';

/** 缺省文案（可被 `t` 或 `label` thunk 覆盖；外壳 locale 归主题/文案面，这里给兜底）。 */
export const DEFAULT_LABELS = Object.freeze({
  loading: '加载中…',
  empty: '暂无内容',
  error: '加载失败',
  retry: '重试',
  close: '关闭',
  refresh: '刷新',
});

/** 装配期/渲染期错误：非法 state 一律显式抛（否则会静默渲染成空白，那正是要消灭的现象）。
 *
 * ⚠ 错误码取既有冻结码 `GUIF-E-COMPONENT-INVALID`（语义：**组件层入参非法**）—— 不新造码，
 * 理由见 `kit/tokens.mjs` 的同名注释（公开面门禁扫 `src/**` 的 `GUIF-[EW]-*`）。
 */
export function stateError(message, details) {
  return createError('GUIF-E-COMPONENT-INVALID', `[panel/state] ${message}`, details);
}

/**
 * 收敛 `state` prop：`undefined` / `null` ⇒ `'ready'`；非四态之一 ⇒ 抛。
 * @param {unknown} value
 * @returns {'ready'|'loading'|'empty'|'error'}
 */
export function normalizeState(value) {
  if (value === undefined || value === null) return 'ready';
  if (typeof value !== 'string' || !PANEL_STATES.includes(value)) {
    throw stateError(`state 必须是 ${PANEL_STATES.join(' / ')} 之一（收到 ${JSON.stringify(value)}）——三态要能被**显式**触发，不许靠"猜"`);
  }
  return value;
}

/**
 * 从官方会话面（`useSessions()` 的 `SessionListSnapshot`）推导状态。
 * 依据（本机 0.2.0-rc.2 实读 `dsh-api-session-controller/lib/types/client/sessions/manager.d.ts`）：
 *   `{ items: readonly SessionListEntry[]; current; state: 'idle'|'loading'|'error'; phase; error; … }`
 * ⇒ `state==='loading'` ⇒ loading；`state==='error'` ⇒ error；`items` 为空且 `state==='idle'` ⇒ empty。
 * 快照缺席或形状不认识 ⇒ `'ready'`（**不猜成 loading**：那会让「没有会话服务」看起来像「正在加载」）。
 * @param {unknown} snapshot
 * @returns {'ready'|'loading'|'empty'|'error'}
 */
export function stateFromSessions(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 'ready';
  const phaseState = snapshot.state;
  if (phaseState === 'loading') return 'loading';
  if (phaseState === 'error') return 'error';
  const items = snapshot.items;
  if (Array.isArray(items) && items.length === 0 && (phaseState === 'idle' || phaseState === undefined)) return 'empty';
  return 'ready';
}

/** 把任意抛出的值收敛成一行可读文案（渲染在错误态里；绝不再抛）。 */
export function describeError(error) {
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
  try {
    return String(error);
  } catch {
    return '（无法序列化的错误值）';
  }
}

/**
 * 解析一个「可能是 thunk 的文案/label」（组件层同样适用）。
 * 优先级：`label`（thunk 优先、字符串次之）→ `t(key)` → `DEFAULT_LABELS[key]` → `key`。
 * thunk 抛错**不向上冒**（渲染期抛错会被官方 boundary 换成一个空 div，那是明确要避免的）。
 * @param {unknown} label 字符串 / thunk / undefined
 * @param {((key:string)=>unknown)|null|undefined} t 文案 thunk（跟随 locale）
 * @param {string} key DEFAULT_LABELS 的键
 * @returns {string}
 */
export function resolveLabel(label, t, key) {
  if (typeof label === 'function') {
    try {
      const value = label();
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 落到下一档（thunk 抛错只损失文案，不该损失整个面板）
    }
  } else if (typeof label === 'string' && label !== '') {
    return label;
  }
  if (typeof t === 'function') {
    try {
      const value = t(key);
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 同上
    }
  }
  return DEFAULT_LABELS[key] ?? key;
}
