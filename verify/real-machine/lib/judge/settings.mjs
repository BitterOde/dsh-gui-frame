// lib/judge/settings.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// settings.yaml 的读法：注册行、kind、布局段解析、宿主侧判定

import { readFileSync } from 'node:fs';

export const SETTINGS_INSTALL_PREFIX = '[gui-frame] settings 注册';

/** 从宿主日志里取出全部 settings 注册行（保持原序）。 */
export function settingsInstallLines(logPath) {
  let text = '';
  try {
    text = readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith(SETTINGS_INSTALL_PREFIX));
}

/** 解析一行注册读数的关键字段（认不出就如实返回 null 字段，绝不猜）。 */
export function parseSettingsInstallLine(line) {
  const seqMatch = /#(\d+)/.exec(line ?? '');
  const registered = /⇒\s*已注册/.test(line ?? '') ? true : (/⇒\s*未注册/.test(line ?? '') ? false : null);
  const reasonMatch = /未注册\(([^)]*)\)/.exec(line ?? '');
  const atMatch = /at=([0-9T:.Z+-]+)/.exec(line ?? '');
  return {
    line: line ?? null,
    seq: seqMatch === null ? null : Number(seqMatch[1]),
    registered,
    reason: reasonMatch === null ? null : reasonMatch[1],
    at: atMatch === null ? null : atMatch[1],
  };
}

/**
 * 从坞面板编辑器状态行里抠出 `read.kind`（形如 `布局 v2 · rev 2 · unavailable（只读）…`）。
 * ⚠ 真机实测踩到：状态行是**拼接文本** —— `ready` 后面常常**没有括号**（`布局 v2 · rev 2 · ready恢复默认…`）
 * ⇒ 早先只认 `kind(` 的写法在真机上返回 `null`（读数丢失）。这里改成词边界 `\b`，两种形态都认。
 */
export function readKindFromStatusText(statusText) {
  const match = /·\s*(empty|ready|invalid|unavailable)\b/.exec(String(statusText ?? ''));
  return match === null ? null : match[1];
}

/**
 * workbench-cause：**用宿主侧读数 + 客户端读数把 workbench-persist 的成因二选一钉死**。
 * 三态互斥，任一成立都算「成因已钉死」（`ok:true`）；读数缺失/认不出 ⇒ `ok:false`（调用方按「未取真机证」登记）。
 *   · `host-not-registered`               —— 宿主那行写着「未注册(<reason>)」⇒ 卡在宿主侧（reason 就是下一步要修的东西）
 *   · `registered-but-client-cannot-see`  —— 宿主写着「已注册」而客户端仍读不到 ⇒ 卡在客户端/时序侧
 *   · `registered-and-client-writable`    —— 宿主已注册且客户端可写 ⇒ 这一条与宿主可见性**无关**（workbench-persist 的成因在别处）
 */
export function workbenchHostSettingsVerdict({ hostLine, clientReadKind, clientWritable }) {
  const parsed = hostLine === null || hostLine === undefined ? null : parseSettingsInstallLine(hostLine);
  const detail = {
    hostLine: parsed?.line ?? null,
    seq: parsed?.seq ?? null,
    registered: parsed?.registered ?? null,
    reason: parsed?.reason ?? null,
    at: parsed?.at ?? null,
    clientReadKind: clientReadKind ?? null,
    clientWritable: clientWritable === true,
  };
  if (parsed === null || parsed.registered === null) return { ok: false, cause: null, causeText: 'host-readout-missing', detail };
  if (parsed.registered === true && clientWritable !== true) {
    return { ok: true, cause: 'registered-but-client-cannot-see', causeText: '宿主已注册、客户端仍读不到 ⇒ 卡在客户端/时序侧', detail };
  }
  if (parsed.registered === false) {
    return { ok: true, cause: 'host-not-registered', causeText: `宿主未注册（reason=${parsed.reason ?? 'unknown'}）⇒ 卡在宿主侧`, detail };
  }
  if (parsed.registered === true && clientWritable === true) {
    return { ok: true, cause: 'registered-and-client-writable', causeText: '宿主已注册且客户端可写 ⇒ 这一条与宿主可见性无关', detail };
  }
  return { ok: false, cause: null, causeText: 'insufficient-readout', detail };
}

/* ── 工作台「采用链」读数的**页面侧采样口**（读 `__internals.workbenchProbe()`）─────────────────
 * 为什么要在启动前埋一段 init script：`__internals` **只在模块对象上**，页面里没有全局出口
 * （`src/client/entry.mjs` 不往 window 挂东西；外壳的 loader 实例只挂在 cordis 的 `ctx.loader.internal` 上）。
 * 装置要在页面里拿到它，只能在**页面脚本之前**拦一次 `window.__ModuleLoader__` 的赋值：
 * 包一层 `create`（拿到 loader 实例），再包一层 loader 的 `load`（拿到带 `__internals` 的模块对象）。
 *
 * ★ 安全性（这是**只读采样**，不许改变外壳行为）：
 *   · 三处 `try/catch` 兜底；拦不到就只是**读数缺失**，不影响页面；
 *   · **绝不改变 `load` 的返回形状**（把 `load` 写成 `async` 会破坏启动）；
 *   · 属性设为 `configurable: true`：外壳若用 `Object.defineProperty` 覆盖，我方 trap 被替换而**不报错**。
 */
export const WORKBENCH_PROBE_GLOBAL = '__guifWorkbenchProbe';

/** 采样口 init script（每个新文档都跑：`Page.addScriptToEvaluateOnNewDocument`）。 */
export function workbenchProbeInitScript() {
  return `(() => {
  const store = { captured: null, reason: null, error: null, facade: null, loads: 0, loader: null };
  try { window[${JSON.stringify(WORKBENCH_PROBE_GLOBAL)}] = store; } catch (error) { /* 挂不上就放弃采样 */ }
  try {
    let facade = null;
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true,
      get() { return facade; },
      set(value) {
        facade = value;
        try {
          if (value !== null && value !== undefined && typeof value.create === 'function' && value.__guifWrapped !== true) {
            value.__guifWrapped = true;
            const originalCreate = value.create;
            value.create = function () {
              const loader = originalCreate.apply(this, arguments);
              store.loader = loader === null || loader === undefined ? null : 'created';
              try {
                if (loader !== null && loader !== undefined && typeof loader.load === 'function' && loader.__guifWrapped !== true) {
                  loader.__guifWrapped = true;
                  const originalLoad = loader.load;
                  loader.load = function () {
                    const result = originalLoad.apply(this, arguments);
                    store.loads += 1;
                    const capture = (moduleValue) => {
                      try {
                        if (moduleValue !== null && moduleValue !== undefined && moduleValue.__internals !== undefined) store.captured = moduleValue;
                        else if (store.reason === null) store.reason = 'loaded-without-internals';
                      } catch { /* 采样失败不影响加载 */ }
                    };
                    try {
                      if (result !== null && result !== undefined && typeof result.then === 'function') result.then(capture, () => {});
                      else capture(result);
                    } catch { /* 采样失败不影响加载 */ }
                    return result;
                  };
                }
              } catch (error) { store.error = String((error && error.message) || error); }
              return loader;
            };
          }
        } catch (error) { store.error = String((error && error.message) || error); }
      },
    });
  } catch (error) { store.error = String((error && error.message) || error); }
})()`;
}

/** 采一次采用链读数（拿不到就如实返回 `available:false` + 原因，**绝不编读数**）。 */
export const WORKBENCH_PROBE_EXPR = `(() => {
  const store = window[${JSON.stringify(WORKBENCH_PROBE_GLOBAL)}];
  if (store === undefined || store === null) return { available: false, reason: 'no-trap' };
  const trap = { loads: store.loads ?? null, loader: store.loader ?? null, error: store.error ?? null };
  if (store.error !== null && store.error !== undefined) return { available: false, reason: 'trap-error:' + store.error, trap };
  if (store.captured === null || store.captured === undefined) return { available: false, reason: store.reason ?? 'module-not-captured', trap };
  const internals = store.captured.__internals;
  if (internals === null || internals === undefined || typeof internals.workbenchProbe !== 'function') return { available: false, reason: 'no-workbench-probe', trap };
  let probe = null;
  let threw = null;
  try { probe = internals.workbenchProbe(); } catch (error) { threw = String((error && error.message) || error); }
  return { available: true, at: new Date().toISOString(), probe, threw, trap };
})()`;
export async function readWorkbenchProbe(session) {
  return session.evaluate(WORKBENCH_PROBE_EXPR);
}

/**
 * 从 `settings.yaml` 文本里取出 `gui-frame.layout` 这一节的关键字段（**纯函数**，离线可自证）。
 *
 * **不引 YAML 依赖**（本装置零第三方依赖）：只认自己那一节，扫描规则窄而确定；
 * 认不出来就如实返回 `namespaceFound/layoutFound = false`，让判据**判红**，绝不「读不到就算过」。
 *
 * ⚠ **真机实测的坑**：重建后的载荷是**流式（flow）写法**——`docks: [ a, b, c ]` 一行数组、
 * `schemaVersion: 2,` 还带尾逗号；旧版只认块式（`docks:` + `- item` 行）⇒ 真机上把
 * `docks` 读成**空数组**，corrupt-file-rebuilt 因此**假红**（文件原文里三项都在）。现在两种写法都认。
 */
export function parseLayoutSection(text) {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);
  const out = { namespaceFound: false, layoutFound: false, schemaVersion: null, docks: null };
  let index = 0;
  for (; index < lines.length; index += 1) {
    if (/^gui-frame:\s*$/.test(lines[index])) {
      out.namespaceFound = true;
      index += 1;
      break;
    }
  }
  if (out.namespaceFound !== true) return out;
  for (let cursor = index; cursor < lines.length; cursor += 1) {
    if (/^\S/.test(lines[cursor])) break; // 出了这一节
    if (/^\s+layout\s*:/.test(lines[cursor])) {
      out.layoutFound = true;
      break;
    }
  }
  if (out.layoutFound !== true) return out;
  // schemaVersion：块式 / 行内 / flow（带尾逗号）都认
  const schema = src.match(/schemaVersion["']?\s*:\s*(\d+)/);
  out.schemaVersion = schema === null ? null : Number(schema[1]);
  // docks：**flow 数组优先**（真机重建后的写法），没有再退回块式 `- item`
  const flow = src.match(/docks\s*:\s*\[([^\]]*)\]/);
  if (flow !== null) {
    out.docks = flow[1]
      .split(',')
      .map((part) => part.trim().replace(/^["']|["']$/g, ''))
      .filter((part) => part !== '');
    return out;
  }
  const docks = [];
  let inDocks = false;
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (/^\S/.test(line)) {
      inDocks = false;
      continue;
    }
    if (/^\s+docks:\s*$/.test(line)) {
      inDocks = true;
      continue;
    }
    const item = inDocks ? line.match(/^\s+-\s*(\S+)\s*$/) : null;
    if (item !== null) {
      docks.push(item[1].replace(/^["']|["']$/g, ''));
      continue;
    }
    if (inDocks && /^\s+\w/.test(line)) inDocks = false;
  }
  out.docks = docks;
  return out;
}

/* ── 读「载入/采用链时间线」（经既有的诊断上报通道发布，落到宿主 stderr）─────────────────────────
 * 行形状（`src/client/workbench/timeline.mjs` 固定）：
 *   `[timeline] 1/4 t≈5ms state=… readKindAtLoad=… storeRead=<kind>:<value> deferred.armed=… deferred.fired=… layoutRev=… adopted=…`
 * 装置只**读宿主 stderr**（与 `[gui-frame] 客户端失败` 同一层），不改任何客户端行为。
 */
