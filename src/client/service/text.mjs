/**
 * text.mjs —— **服务面的文本成形与日志出口**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 * 两件事：① 读数成形（`truncate` / `describeValue` / `describeError`）——错误里只说「收到了什么形状」，
 * 不把栈或对象整个搬进日志；② 日志出口（`logTo`：`ctx.logger[level]`，拿不到就静默 —— 与
 * `kit/probe.mjs` 的单一软探测口径同源）。
 *
 * 依赖方向：`service/**` 是装配层（L3），可依赖任何域；本件只依赖共享叶 `kit/probe.mjs`。
 * 判定口径（`describeValue` 对 null/undefined/数组/对象的四分支、`describeError` 的 200 字截断）**一字未改**。
 */
import { probeLogger } from '../kit/probe.mjs';

export function logTo(ctx, level, line) {
  const logger = probeLogger(ctx);
  if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](line);
}

export function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function describeValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `数组(${value.length})`;
  if (typeof value === 'object') return '对象';
  return `${typeof value} ${String(value)}`;
}

export function describeError(error) {
  if (error === null || error === undefined) return describeValue(error);
  if (typeof error === 'object' && typeof error.message === 'string') return truncate(error.message, 200);
  return truncate(String(error), 200);
}

export function noop() {}
