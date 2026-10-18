// lib/judge/bundle.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 前置闸：产物身份（逐字/平台归一化）与标记

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export const BUNDLE_ARTIFACT_REL = 'lib/client.js';

/**
 * 平台拼接客户端产物时对每个 bundle 做的两步（**逐字复刻**真源）
 * —— `@deepseek-ai/dsh-client-modules/lib/index.js` 的 `comboSource()` + `buildCombo()`：
 *   · `comboSource()`：先把 `//# sourceURL=` / `//# sourceMappingURL=` 两条 trailer **去掉**，再**保证结尾有 `\n`**；
 *   · `buildCombo()`：把每份 `comboSource()` 结果后接 `;\n` 依次拼进一个响应。
 * ⇒ 「服务字节里逐字包含当前产物」这句话在**去掉 trailer + 补结尾换行**的口径下成立；
 *   本装置把这两条 trailer 逐字抄下来（正则同源），只用于**归一化**，不改判据强度。
 */
export const SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/;
export const SOURCE_URL_TRAILER = /(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/;
/** 平台在每份产物后追加的分隔（`buildCombo()` 的 `` `${source};\n` ``）。 */
export const COMBO_JOIN = ';\n';

/** 平台侧归一化后的产物文本（＝ `comboSource()` 的结果；与 `buildCombo()` 的拼接片段只差尾部 `;\n`）。 */
export function comboNormalizeArtifact(text) {
  let source = String(text ?? '');
  source = source.replace(SOURCE_URL_TRAILER, '').replace(SOURCE_MAP_TRAILER, '');
  if (!source.endsWith('\n')) source += '\n';
  return source;
}

/**
 * 读当前交付产物（`lib/client.js`）并**同时**给出两种量纲 —— 这是要写死的事实：
 * `text.length` 是 **UTF-16 码元数**，`utf8Bytes` / `statSize` 才是**字节数**；两者在本产物上差 14 万+。
 * @param {string} artifactPath
 * @returns {{path:string, text:string, units:number, utf8Bytes:number, statSize:number|null, sha256:string}}
 */
export function readBundleArtifact(artifactPath) {
  const text = readFileSync(artifactPath, 'utf8');
  let statSize = null;
  try { statSize = statSync(artifactPath).size; } catch { statSize = null; }
  return {
    path: artifactPath,
    text,
    units: text.length, // UTF-16 码元（`String#length`）
    utf8Bytes: Buffer.byteLength(text, 'utf8'), // UTF-8 字节
    statSize, // 文件字节数（应与 utf8Bytes 相等）
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

/**
 * 页面侧取字节 + 做身份比对（**大文本不出页面**：11 MB 的响应不出 CDP，只回小结果）。
 * 两种口径各比一次：`verbatim`（原样）与 `combo`（平台 `comboSource` 归一化后 + `;\n`）。
 * @param {{marker:string, artifactText:string, comboText:string}} input
 */
export function bundleGateExpr({ marker, artifactText, comboText }) {
  const sameText = artifactText === comboText;
  return `(async () => {
    const MARKER = ${JSON.stringify(marker)};
    const ARTIFACT = ${JSON.stringify(artifactText)};
    const COMBO = ${sameText ? 'ARTIFACT' : JSON.stringify(comboText)};
    const at = (hay, needle) => { const i = needle === '' ? -1 : hay.indexOf(needle); return { hit: i >= 0, offset: i }; };
    const urls = (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []).map((e) => e.name).filter((u) => /dsh-gui-frame\\/client\\.js/.test(u));
    const fromHtml = (document.documentElement.outerHTML.match(/[^"'\\s]*dsh-gui-frame\\/client\\.js[^"'\\s]*/) || [null])[0];
    const url = urls[0] ?? fromHtml ?? null;
    if (url === null) return { url: null, checked: false };
    const withoutToken = url.replace(/([?&])token=[^&]*/g, '$1').replace(/[?&]$/, '');
    let response;
    let text;
    try {
      response = await fetch(withoutToken, { credentials: 'same-origin' });
      text = await response.text();
    } catch (error) {
      return { url, withoutToken, checked: false, fetchError: String(error && error.message ? error.message : error) };
    }
    const utf8Bytes = (() => { try { return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : null; } catch (error) { return null; } })();
    return {
      url,
      withoutToken,
      checked: true,
      rev: (url.match(/rev=([^&]+)/) || [])[1] ?? null,
      status: response.status,
      combo: url.includes('/plugins/??'),
      units: text.length,
      utf8Bytes,
      hasMarker: text.includes(MARKER),
      identity: {
        verbatim: at(text, ARTIFACT),
        comboSource: at(text, COMBO),
        comboJoined: at(text, COMBO + ${JSON.stringify(COMBO_JOIN)}),
        tailVerbatim: { hit: text.endsWith(ARTIFACT) },
        headProbe: at(text, ARTIFACT.slice(0, 200)),
        tailProbe: at(text, ARTIFACT.slice(-200)),
        artifactUnits: ARTIFACT.length,
      },
    };
  })()`;
}

/**
 * **身份判定**（纯函数；真机轮与离线自检同一份）：服务字节是否逐字包含当前产物。
 * 三级都要求「当前产物的文本出现在服务字节里」——差别只在归一化口径，**没有一级是「只看标记」**：
 *   · `verbatim`：原样逐字包含（最强）；
 *   · `combo-source`：按平台 `comboSource()` 归一化后逐字包含（去 trailer + 补结尾换行）；
 *   · `combo-joined`：平台拼接口径（归一化后 + `;\n`）逐字包含。
 * 都不成立 ⇒ 判红（fail-closed），并给出首/尾探针以便区分「包装」与「旧字节」。
 */
export function bundleIdentityVerdict(gate) {
  const id = gate?.identity ?? null;
  if (gate?.checked !== true || id === null) {
    return { ok: false, tier: null, offset: null, why: gate?.fetchError ? `取字节失败：${gate.fetchError}` : '没取到页面字节（页面上找不到本包模块 URL）⇒ 判红（fail-closed）' };
  }
  if (id.verbatim?.hit === true) return { ok: true, tier: 'verbatim', offset: id.verbatim.offset, why: `服务字节**逐字包含当前 lib/client.js**（首次命中偏移 ${id.verbatim.offset}）` };
  if (id.comboSource?.hit === true) return { ok: true, tier: 'combo-source', offset: id.comboSource.offset, why: `服务字节包含**按平台 comboSource 归一化后**的当前产物（去掉 sourceURL/sourceMappingURL trailer + 补结尾换行；偏移 ${id.comboSource.offset}）` };
  if (id.comboJoined?.hit === true) return { ok: true, tier: 'combo-joined', offset: id.comboJoined.offset, why: `服务字节包含**平台拼接口径**（归一化后 + 分号换行）的当前产物（偏移 ${id.comboJoined.offset}）` };
  return {
    ok: false,
    tier: null,
    offset: null,
    why: `服务字节里**找不到当前 lib/client.js**（首探针${id.headProbe?.hit === true ? '命中' : '未命中'}／尾探针${id.tailProbe?.hit === true ? '命中' : '未命中'}）⇒ 页面字节不是当前交付产物`,
  };
}

/** 前置闸的**完整判定**（标记 + 身份）：真机轮与离线自检调的是这一份，别在调用点重写判断。 */
export function bundleGateVerdict(gate) {
  const identity = bundleIdentityVerdict(gate);
  if (gate?.checked !== true) return { ...identity, marker: null, markerOk: false };
  const markerOk = gate.hasMarker === true;
  if (markerOk !== true) {
    return { ok: false, tier: identity.tier, offset: identity.offset, marker: gate.marker ?? null, markerOk: false, why: `服务字节里没有判据标记 ${gate.marker ?? '(未指定)'} ⇒ 页面字节过期，请硬刷新后再跑` };
  }
  return { ok: identity.ok === true, tier: identity.tier, offset: identity.offset, marker: gate.marker ?? null, markerOk: true, why: identity.why };
}

/**
 * 前置闸的人读 detail（**量纲写在这里**：`units` 是 UTF-16 码元、`utf8Bytes` 是字节；产物两种都印）。
 */
export function bundleGateDetail(gate) {
  const v = bundleGateVerdict(gate);
  const art = gate?.artifact ?? null;
  const artText = art === null ? '产物读数缺失'
    : `产物 ${art.rel ?? BUNDLE_ARTIFACT_REL}：utf8=${art.utf8Bytes} 字节 / units=${art.units} 码元（差 ${art.utf8Bytes - art.units}）/ sha256=${String(art.sha256).slice(0, 12)}…`;
  return [
    `rev=${gate?.rev ?? '?'}`,
    `units(UTF-16 码元)=${gate?.units ?? '?'}`,
    `utf8Bytes=${gate?.utf8Bytes ?? '?'}`,
    `status=${gate?.status ?? '?'}`,
    `含标记=${gate?.hasMarker === true}`,
    `身份=${v.ok === true ? v.tier : '**不成立**'}${v.offset === null || v.offset === undefined ? '' : `@${v.offset}`}`,
    artText,
  ].join('｜') + `｜判定：${v.why}${gate?.combo === true ? '｜URL=组合路由(/plugins/??…)' : ''}`;
}
export async function bundleGate(session, { marker, artifactPath, artifactText } = {}) {
  // 产物在 Node 侧读（页面只拿到两段文本用于比对）；`artifactText` 供离线自检注入
  const artifact = artifactText === undefined
    ? readBundleArtifact(artifactPath)
    : { path: artifactPath ?? '(injected)', text: artifactText, units: artifactText.length, utf8Bytes: Buffer.byteLength(artifactText, 'utf8'), statSize: null, sha256: createHash('sha256').update(artifactText, 'utf8').digest('hex') };
  const comboText = comboNormalizeArtifact(artifact.text);
  const facts = await session.evaluate(bundleGateExpr({ marker, artifactText: artifact.text, comboText }));
  return {
    ...facts,
    marker,
    artifact: {
      rel: BUNDLE_ARTIFACT_REL,
      path: artifact.path,
      units: artifact.units,
      utf8Bytes: artifact.utf8Bytes,
      statSize: artifact.statSize,
      sha256: artifact.sha256,
    },
  };
}
