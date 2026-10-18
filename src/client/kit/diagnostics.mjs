/**
 * diagnostics.mjs（kit）—— **诊断的纯件层**（「能力 → 共享叶」那一层）。
 *
 * 为什么下沉：demo 是**消费者**，它需要的只是「降级事件的形状」「渲染错误的上报形状」与两个常量；
 * 这些是纯工厂/常量，留在装配层的 `diagnostics.mjs` 里会让 demo 直连装配层（装配层不许被 demo 直连）。
 * 上报器实例本身仍由装配点经 `env.diagnostics` 交进来（六键之一：全流程唯一实例）。
 *
 * 本文件**零副作用**：纯函数与常量，不碰 ctx / service / DOM。
 */
export const DIAGNOSTICS_PATH = '/api/gui-frame/diagnostics';
/** 官方信封里的 `method`＝端点名（`/api/` 之后那段）。 */
export const DIAGNOSTICS_METHOD = 'gui-frame/diagnostics';
/** 官方信封的两种 type（与平台 `dsh-client-connection` 的实读值一致）。 */
export const CLIENT_REQUEST_TYPE = 'client-request';
/** 插件名（宿主与 demo 都用它做归属）。 */
export const PLUGIN_NAME = 'dsh-gui-frame';
/**
 * 客户端版本（**与 package.json 的 version 同值**，由 `tests/unit/diagnostics-client.test.mjs` 断言）。
 * 客户端产物在 factory 里物化，读不到 package.json，所以这里只能是常量 —— 那条断言就是防它漂移的。
 * ★ v1.0 对外发布：清单 `version` 与它必须**同值** —— 改的是版本字面量，不是逻辑
 *   （产物由 `npm run build` 重生成，`CLIENT_VERSION` 也是诊断行里那句
 *   `v<版本>` 的取值来源）。两处不同值会让 `npm test` 里那条同值断言直接判红。
 */
export const CLIENT_VERSION = '1.0.0';

/** 诊断阶段（调用方按它分支；也是指纹的组成部分）。 */
export const DIAGNOSTIC_PHASES = Object.freeze(['apply', 'install', 'slot', 'render', 'degrade', 'unhandled', 'transport']);

/** 四个上界（全部可在 `createDiagnosticsReporter` 的 options 里覆盖，便于单测把边界跑到）。 */
export const DIAGNOSTIC_LIMITS = Object.freeze({
  message: 400,
  stack: 800,
  maxPerWindow: 20,
  windowMs: 60000,
  maxQueue: 32,
});

/** 把任意值收敛成一行可上报的消息（**绝不让诊断本身抛错**）。 */
export function describeError(error) {
  if (error === null || error === undefined) return '未知错误（null/undefined）';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
  try {
    return String(error);
  } catch {
    return '无法字符串化的错误';
  }
}

/** 截断（保留头部；`\n` 折成 `\n    ` 之外不动，栈摘要要能看出调用链的前几层）。 */
export function truncate(value, limit) {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
}

/** **栈摘要**：只留前 `maxLines` 行、总长 ≤ 800 —— 认得出「哪一层炸的」就够了，不搬整条栈。 */
export function summarizeStack(error, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DIAGNOSTIC_LIMITS.stack;
  const maxLines = Number.isInteger(options.maxLines) && options.maxLines > 0 ? options.maxLines : 8;
  const raw = error !== null && error !== undefined && typeof error === 'object' && typeof error.stack === 'string' ? error.stack : '';
  if (raw === '') return { stack: '', lines: 0, truncated: false };
  const lines = raw.split('\n').slice(0, maxLines);
  const clipped = truncate(lines.join('\n'), limit);
  return { stack: clipped.text, lines: lines.length, truncated: clipped.truncated || raw.split('\n').length > maxLines };
}

/** 指纹：`plugin|phase|message`（**不含时间戳** —— 否则每次都不同，去重就废了）。 */
export function fingerprintOf(entry) {
  const phase = typeof entry.phase === 'string' ? entry.phase : 'unknown';
  const message = typeof entry.message === 'string' ? entry.message : '';
  const plugin = typeof entry.plugin === 'string' && entry.plugin !== '' ? entry.plugin : PLUGIN_NAME;
  return `${plugin}|${phase}|${message}`;
}

/** 轻量稳定哈希（FNV-1a 32 位；只用于日志/去重键，不做安全用途）。 */
export function hashFingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 把一条**能力降级**事件记成标准形状（entry/demo 共用，避免两处各写一遍）。 */
export function degradeEvent(capability, reason, reporter) {
  const entry = {
    phase: 'degrade',
    message: `能力「${String(capability)}」未装配：${String(reason ?? 'unknown')}（页面照常启动）`,
    details: { capability, reason: reason ?? null },
  };
  if (reporter === undefined || reporter === null || typeof reporter.report !== 'function') return entry;
  reporter.report(entry);
  return entry;
}

/** 供**组件**在自己 catch 时调用（`panel` 的 Boundary onError 就用它）。 */
export function renderErrorReport(reporter, error, details) {
  if (reporter === undefined || reporter === null || typeof reporter.report !== 'function') return null;
  return reporter.report({ phase: 'render', message: `渲染失败：${describeError(error)}`, error, details });
}
