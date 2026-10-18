/**
 * entries.mjs —— **入口登记的形态收敛与排序键**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 * `normalizeEntry(entry, Component)` 把接入方给的 `{id,label,order,group,kind,source,icon,badge}` 收成
 * 服务内部记录，**逐条错误码与判据（`GUIF-E-ENTRY-INVALID` 的八种分支）一字未改**；
 * `entryRank` 是 `__entries()` 的排序键（`order` 缺省排最后）。
 *
 * 依赖方向：`service/**` 是装配层（L3）；本件依赖词汇叶 `contracts/**` 与同域 `text.mjs`（读数成形）。
 */
import { createError } from '../contracts/errors.mjs';
import { ENTRY_ID_MAX_LENGTH, ENTRY_ID_PATTERN, ENTRY_KINDS, RESERVED_ENTRY_IDS } from '../contracts/service-face.mjs';
import { describeValue } from './text.mjs';

/**
 * 普通对象判据（数组 / 类实例 / null 都不算）：只看原型是不是 `Object.prototype` / `null`。
 *
 * ⚠ 别把它简化成 `typeof v === 'object'` —— 那会放行类实例，是**放宽**判据
 * （`GUIF-E-ENTRY-INVALID` 会少一支）。
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 入口 id / Component 的形态收敛（错误码 `GUIF-E-ENTRY-INVALID`）。 */
export function normalizeEntry(entry, Component) {
  if (!isPlainObject(entry)) {
    throw createError('GUIF-E-ENTRY-INVALID', `register(entry, Component) 的 entry 必须是普通对象（收到 ${describeValue(entry)}）`, { entry: describeValue(entry) });
  }
  const id = entry.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 必须是非空字符串（收到 ${describeValue(id)}）`, { id });
  }
  if (id.length > ENTRY_ID_MAX_LENGTH) {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 长度不得超过 ${ENTRY_ID_MAX_LENGTH}（收到 ${id.length}）`, { id });
  }
  if (RESERVED_ENTRY_IDS.includes(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 不得占用保留 key「${id}」（会顶掉外壳自己的界面）`, { id });
  }
  if (!ENTRY_ID_PATTERN.test(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 必须带命名空间前缀且只含 [A-Za-z0-9._-/]（如 dsh-gui-frame/demo，收到「${id}」）`, { id });
  }
  if (Component === null || (typeof Component !== 'function' && typeof Component !== 'object')) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 Component 必须是函数组件、类组件或 memo/forwardRef 形状（收到 ${describeValue(Component)}）`, { id });
  }
  if (entry.label !== undefined && typeof entry.label !== 'string' && typeof entry.label !== 'function') {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 label 必须是字符串或 thunk（收到 ${describeValue(entry.label)}）`, { id });
  }
  if (entry.order !== undefined && !Number.isInteger(entry.order)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 order 必须是整数（收到 ${describeValue(entry.order)}）`, { id });
  }
  if (entry.group !== undefined && (typeof entry.group !== 'string' || entry.group === '')) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 group 必须是非空字符串（收到 ${describeValue(entry.group)}）`, { id });
  }
  const kind = entry.kind === undefined ? 'panel' : entry.kind;
  if (!ENTRY_KINDS.includes(kind)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 kind 必须是 ${ENTRY_KINDS.join(' / ')} 之一（收到 ${describeValue(entry.kind)}）`, { id });
  }
  if (entry.source !== undefined && entry.source !== null && (typeof entry.source !== 'string' || entry.source === '')) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 source 必须是非空字符串（插件自报的包名，stale 判定要用）`, { id });
  }
  return {
    id,
    label: entry.label === undefined ? null : entry.label,
    order: entry.order === undefined ? null : entry.order,
    group: entry.group === undefined ? null : entry.group,
    kind,
    source: entry.source === undefined || entry.source === null ? null : entry.source,
    // 入口注册形状里有 `icon` 与 `badge` —— 官方 `register` 只保留 key/id/order/label/priority，
    // 这两个字段会被**静默丢掉**，所以坞必须自己收下来（角标由坞自绘 / 面板画；图标给出入口字形）。
    icon: entry.icon === undefined ? null : entry.icon,
    badge: entry.badge === undefined ? null : entry.badge,
    Component,
    seq: 0,
  };
}

/** 排序键：`order` 缺省排最后（`order` 相等时用注册序兜底）。 */
export function entryRank(record) {
  return Number.isInteger(record.order) ? record.order : Number.MAX_SAFE_INTEGER;
}
