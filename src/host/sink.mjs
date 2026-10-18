/**
 * sink.mjs —— **诊断收端（宿主侧）的实现体**（从 `index.mjs` 原样搬出，行为一字未改）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么单独一件】`index.mjs` 只留「装配契约」的三件事（`name` / `inject` / `apply` + 路由调用），
 * 收端的业务体（校验 → 限长 → 指纹去重 → 总条数封顶 → 两层打印）与它的常量/纯函数放这里；
 * `index.mjs` 仍按**原路径**再绑定同一组导出（`CLIENT_FAILURE_PREFIX` / `DIAGNOSTICS_LIMITS` /
 * `createDiagnosticsSink` / `fingerprintOf` / `hashFingerprint`），外部（`tests/host/diagnostics-sink.test.mjs`
 * 等）的 import 路径不变。
 *
 * 两层打印的理由（探针实测）见 `index.mjs` 文件头：Cordis logger 默认只进内存 buffer，
 * `warn` 连 buffer 都进不去 ⇒ cmd 可见性必须由 `process.stderr.write` 那一层承担。
 * 纪律：只静态 import `node:` 内建；绝不抛。
 */
/** stderr 行前缀（真机留证与 `grep` 都认它；这条字样是对外承诺的一部分）。 */
export const CLIENT_FAILURE_PREFIX = '[gui-frame] 客户端失败';
/** 缺省上限：总条数封顶 / 打印条数封顶 / 指纹表容量 / 单字段长度。 */
export const DIAGNOSTICS_LIMITS = Object.freeze({
  maxEntries: 500,
  maxPrinted: 100,
  maxFingerprints: 256,
  message: 400,
  stack: 800,
});

/** 截断（保头部）：返回 `[text, truncated]`。 */
function truncate(value, limit) {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  if (text.length <= limit) return [text, false];
  return [`${text.slice(0, limit)}…`, true];
}

/** 栈摘要：只留前两行（认得出"哪一层炸的"就够，不把整条栈搬进 cmd）。 */
function stackHead(stack, limit) {
  const [text, clipped] = truncate(stack, limit);
  const all = text.split('\n');
  const lines = all.slice(0, 2).join(' ↩ ');
  return [lines, clipped || all.length > 2];
}

/** 指纹：`plugin|phase|message`（**不含时间戳**，否则每次都不同、去重就废了）。 */
export function fingerprintOf(entry) {
  const plugin = entry !== null && entry !== undefined && typeof entry.plugin === 'string' && entry.plugin !== '' ? entry.plugin : 'unknown-plugin';
  const phase = entry !== null && entry !== undefined && typeof entry.phase === 'string' && entry.phase !== '' ? entry.phase : 'unknown-phase';
  const message = entry !== null && entry !== undefined && typeof entry.message === 'string' ? entry.message : '';
  return `${plugin}|${phase}|${message}`;
}

/** 轻量稳定哈希（FNV-1a 32 位；只用于日志与去重键）。 */
export function hashFingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 缺省 stderr 直写（Node 里 `process` 是全局；拿不到就静默降级为只走 logger）。**导出**：`index.mjs` 的 `log()` 那一层也走它。 */
export function defaultWrite(line) {
  try {
    if (typeof process !== 'undefined' && process !== null && process.stderr !== undefined && typeof process.stderr.write === 'function') {
      process.stderr.write(`${line}\n`);
      return true;
    }
  } catch {
    // stderr 不可写就算了 —— 不许因为打印而让收端抛错
  }
  return false;
}

/**
 * 造诊断**收端**（宿主侧）：校验 → 限长 → 指纹去重 → 总条数封顶 → 两层打印。
 * @param {{logger?:object, write?:Function, limits?:object, now?:Function}} [options]
 * @returns {{handle:Function, stats:Function, lines:Function, reset:Function}}
 */
export function createDiagnosticsSink(options = {}) {
  const limits = { ...DIAGNOSTICS_LIMITS, ...(options.limits ?? {}) };
  const logger = options.logger ?? null;
  const write = typeof options.write === 'function' ? options.write : defaultWrite;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const seen = new Map();
  const printed = [];
  const state = { received: 0, accepted: 0, deduped: 0, printed: 0, capped: 0, truncated: 0, invalid: 0 };

  /** 两层打印（**先 logger 后 stderr**：logger 抛错不能妨碍 cmd 可见性）。 */
  function emit(body) {
    // 前缀只在这一处加：两层打的是**同一行**（cmd 里 grep 到的与 logger 里的一致）。
    const line = `${CLIENT_FAILURE_PREFIX} ${body}`;
    if (logger !== null && logger !== undefined && typeof logger.warn === 'function') {
      try {
        logger.warn(line);
      } catch {
        // logger 那一层失败不影响 stderr 这一层
      }
    }
    write(line);
    state.printed += 1;
    printed.push(line);
    if (printed.length > limits.maxPrinted) printed.splice(0, printed.length - limits.maxPrinted);
  }

  /** 官方 result 形状（家族业务字段装在 `value` 里，客户端 `adaptOfficialEnvelope` 再摊平）。 */
  function summarize(info) {
    return {
      data: {
        accepted: info.accepted,
        reason: info.reason,
        fingerprint: info.fingerprint,
        printCount: info.printCount,
        total: state.received,
        deduped: state.deduped,
        capped: state.capped,
      },
      warnings: [],
      changed: false,
      rev: null,
      undoToken: null,
    };
  }

  /** 端点处理体：`handle(payload, context)` → 官方 `result`（由 `routes.mjs` 包成响应）。 */
  function handle(payload) {
    state.received += 1;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      state.invalid += 1;
      return { ok: false, error: { code: 'gui-frame/transport', message: '诊断载荷必须是对象', details: { type: typeof payload } } };
    }
    const [message, messageTruncated] = truncate(payload.message, limits.message);
    const [stack, stackTruncated] = stackHead(payload.stack, limits.stack);
    if (messageTruncated || stackTruncated) state.truncated += 1;
    const plugin = typeof payload.plugin === 'string' && payload.plugin !== '' ? payload.plugin : 'unknown-plugin';
    const phase = typeof payload.phase === 'string' && payload.phase !== '' ? payload.phase : 'unknown-phase';
    const clientVersion = typeof payload.clientVersion === 'string' && payload.clientVersion !== '' ? payload.clientVersion : 'unknown';
    const at = typeof payload.at === 'string' && payload.at !== '' ? payload.at : new Date(now()).toISOString();
    const fingerprint = hashFingerprint(fingerprintOf({ plugin, phase, message }));

    // ① 指纹去重：同一条错误反复发生 ⇒ **只打印一次**
    if (seen.has(fingerprint)) {
      seen.set(fingerprint, seen.get(fingerprint) + 1);
      state.deduped += 1;
      return { ok: true, value: summarize({ accepted: false, reason: 'duplicate', fingerprint, printCount: 1 }) };
    }
    // ② 总条数封顶：超过就只计数不打印（也不再新增指纹，避免表被撑爆）
    if (state.received > limits.maxEntries || seen.size >= limits.maxFingerprints) {
      state.capped += 1;
      return { ok: true, value: summarize({ accepted: false, reason: 'capped', fingerprint, printCount: 0 }) };
    }
    seen.set(fingerprint, 1);
    state.accepted += 1;
    // 行体（前缀由 `emit` 加）：`[gui-frame] 客户端失败 <插件> · <阶段> · v<版本> · <时间>` + 消息 + 栈摘要
    const body = `${plugin} · ${phase} · v${clientVersion} · ${at}\n  ${message}${stack === '' ? '' : `\n  ${stack}`}`;
    emit(body);
    return { ok: true, value: summarize({ accepted: true, reason: null, fingerprint, printCount: 1 }) };
  }

  return {
    handle,
    stats: () => ({ ...state, fingerprints: seen.size, lines: printed.length }),
    /** 打印过的行（真机留证与单测断言用）。 */
    lines: () => [...printed],
    reset() {
      seen.clear();
      printed.splice(0, printed.length);
      for (const key of Object.keys(state)) state[key] = 0;
    },
  };
}
