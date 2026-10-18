// lib/judge/timeline.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// [timeline] 行与宿主侧残因归类

import { readFileSync } from 'node:fs';

export const TIMELINE_MARKER = '[timeline]';

/** 从宿主日志里取出全部时间线行（保持原序）。 */
export function timelineLines(logPath) {
  let text = '';
  try {
    text = readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes(TIMELINE_MARKER));
}

/**
 * 解析一行时间线（认不出的字段如实返回 null，**绝不猜**）。
 *
 * ★ 行末多了**判读段** `scope=<status>@rev<N> val=[<键名>] usr=[<键名>]`
 *   （真源 `src/client/workbench/timeline.mjs` 的 formatter）。它是**纯读数**，不改采用语义；
 *   装置把它原样解析出来，**只用于给「宿主侧残因」归类**，不参与任何判据的判绿/判红。
 *   旧格式（没有这一段）照样解析：三个新字段如实为 `null` / 空数组，**不抛也不猜**。
 */
export function parseTimelineLine(line) {
  const text = String(line ?? '');
  if (text.includes(TIMELINE_MARKER) !== true) return null;
  const field = (key) => {
    const match = new RegExp(`${key}=([^\\s]+)`).exec(text);
    return match === null ? null : match[1];
  };
  const index = /(\d+)\s*\/\s*(\d+)/.exec(text);
  const offset = /t≈\s*(\d+)\s*ms/.exec(text);
  const store = field('storeRead');
  // `val=[…]` / `usr=[…]` 用独立的方括号正则（键名列表可能带空格）⇒ 不借用 `field()`
  const bracketKeys = (key) => {
    const match = new RegExp(`${key}=\\[([^\\]]*)\\]`).exec(text);
    if (match === null) return null;
    return match[1]
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
  };
  const scopeSeg = /scope=([^\s@]+)@rev(\d+)/.exec(text);
  return {
    line: text,
    index: index === null ? null : Number(index[1]),
    total: index === null ? null : Number(index[2]),
    offsetMs: offset === null ? null : Number(offset[1]),
    state: field('state'),
    readKindAtLoad: field('readKindAtLoad'),
    storeRead: store,
    storeKind: store === null ? null : String(store).split(':')[0],
    storeValue: store === null ? null : String(store).slice(String(store).indexOf(':') + 1),
    deferredArmed: field('deferred\\.armed') === null ? null : field('deferred\\.armed') === 'true',
    deferredFired: field('deferred\\.fired') === null ? null : Number(field('deferred\\.fired')),
    layoutRev: field('layoutRev'),
    adopted: field('adopted') === null ? null : field('adopted') === 'true',
    scopeStatus: scopeSeg === null ? null : scopeSeg[1],
    scopeRevision: scopeSeg === null ? null : Number(scopeSeg[2]),
    valKeys: bracketKeys('val'),
    usrKeys: bracketKeys('usr'),
  };
}

/**
 * **宿主侧残因归类**（装置只照固定的三分表归类、**不改语义**）。
 *
 * 三分表（`val` = 宿主 `describe()` 里带的键名；`usr` = 原始用户层里的键名）：
 *   · `val=[…含 layout]`                        ⇒ `host-value-present`（本就不该红）
 *   · `val=[] 且 usr=[…含 layout]`              ⇒ `host-resolved-key-away`（**有值却被宿主解析掉**）
 *   · `val=[] 且 usr=[]`（或不含 layout）        ⇒ `absent-from-host-answer`（宿主答案里本来就没有）
 *   · 判读段缺失（旧格式/解析失败）              ⇒ `unknown`（**不猜**）
 * `scopeRevision === 0` 另记一条 `fresh-registration`（注册是新造的，与内存节≠文件呼应），
 * 它是**附加读数**，不覆盖上面的主归类。
 *
 * @returns {{kind:string, note:string|null, why:string}}
 */
export function classifyHostResidual(row) {
  const value = Array.isArray(row?.valKeys) ? row.valKeys : null;
  const user = Array.isArray(row?.usrKeys) ? row.usrKeys : null;
  const freshNote = Number.isInteger(row?.scopeRevision) && row.scopeRevision === 0 ? 'fresh-registration' : null;
  if (value === null || user === null) {
    return { kind: 'unknown', note: freshNote, why: '时间线里没有判读段（`val=` / `usr=`）⇒ 按「未取到」记，不猜' };
  }
  const hasLayout = (keys) => keys.some((key) => key === 'layout' || key.startsWith('layout'));
  if (hasLayout(value)) {
    return { kind: 'host-value-present', note: freshNote, why: `宿主 describe() 的键里有 layout（val=[${value.join(',')}]）` };
  }
  if (hasLayout(user)) {
    return { kind: 'host-resolved-key-away', note: freshNote, why: `用户层有 layout 而宿主答案里没有（usr=[${user.join(',')}] / val=[${value.join(',')}]）⇒ 有值却被宿主那一环解析掉` };
  }
  return { kind: 'absent-from-host-answer', note: freshNote, why: `两层都没有 layout（val=[${value.join(',')}] / usr=[${user.join(',')}]）⇒ 宿主答案里本来就没有这一节` };
}
