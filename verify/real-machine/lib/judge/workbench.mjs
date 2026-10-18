// lib/judge/workbench.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 工作台：事实读数、判定纯函数与开关操作

import { OWN_PREFIX_LITERAL, sleep } from './base.mjs';
import { realClick } from './click.mjs';

export const WORKBENCH_SWITCH_ATTR = 'data-guif-workbench-switch';
export const WORKBENCH_STATE_ATTR = 'data-guif-workbench-state';
export const WORKBENCH_THUMB_ATTR = 'data-guif-workbench-thumb';
export const WORKBENCH_SWITCH_SELECTOR = `[${WORKBENCH_SWITCH_ATTR}]`;
export const WORKBENCH_BUTTON_SELECTOR = `${WORKBENCH_SWITCH_SELECTOR} button[role="switch"]`;
export const WORKBENCH_FACTS_EXPR = `(() => {
  const frame = (() => { const node = document.querySelector('[data-shell-overlay]'); return node === null ? null : node.parentElement; })();
  const root = document.querySelector(${JSON.stringify(WORKBENCH_SWITCH_SELECTOR)});
  const button = root === null ? null : root.querySelector('button[role="switch"]');
  const thumb = root === null ? null : root.querySelector('[${WORKBENCH_THUMB_ATTR}]');
  const notice = root === null ? null : root.querySelector('[data-guif-workbench-notice]');
  // 官方三轨写法：侧栏px / minmax(0, 1fr) / 右栏px。**中轨里含空格** ⇒ 不能按空白硬切，
  // 用整行正则取两端的 px（实测踩坑：按空白切会数出 4 条轨，把三轨判据变成恒假）。
  const gridRaw = frame === null ? '' : String(frame.style.gridTemplateColumns ?? '').trim();
  // ⚠ **两种序列化都要认**（真机首跑踩到）：jsdom 原样回 minmax(0, 1fr)，而**真机 Chrome 的 CSSOM
  // 会把它规范化成 minmax(0px, 1fr)**（raw.json 里 gridRaw 原文可证：280px minmax(0px, 1fr) 0px）。
  // 只认前一种 ⇒ 真机上 trackCount 恒 0、轨宽恒 null（判据恒假，比恒真更难发现）。
  const grid = /^(-?\\d+(?:\\.\\d+)?)px\\s+minmax\\(0(?:px)?,\\s*1fr\\)\\s+(-?\\d+(?:\\.\\d+)?)px$/.exec(gridRaw);
  const sidebarTrack = grid === null ? null : Number(grid[1]);
  const rightbarTrack = grid === null ? null : Number(grid[2]);
  const trackCount = grid === null ? 0 : 3;
  const sidebarCol = frame === null ? null : (frame.children[0] ?? null);
  const centerCol = frame === null ? null : (frame.children[1] ?? null);
  const rightbarCol = document.querySelector('[data-rightbar-col]');
  const panels = [...document.querySelectorAll('[data-guif-panel]')];
  const glyphIds = [...document.querySelectorAll('[data-guif-glyph]')].map((e) => String(e.getAttribute('data-guif-glyph')));
  // 侧栏「内容摘要」：只取**结构+角色标签**（不取正文文本，免得会话标题/时间之类把两次读数冲开）
  const signatureOf = (node) => node === null ? null : [...node.querySelectorAll('[role], button, a')]
    .map((e) => String(e.tagName) + ':' + String(e.getAttribute('role') ?? '') + ':' + String(e.getAttribute('aria-label') ?? ''))
    .join('|');
  return {
    switch: {
      present: root !== null,
      count: document.querySelectorAll(${JSON.stringify(WORKBENCH_SWITCH_SELECTOR)}).length,
      stateAttr: root === null ? null : root.getAttribute('${WORKBENCH_STATE_ATTR}'),
      buttonPresent: button !== null,
      ariaChecked: button === null ? null : button.getAttribute('aria-checked'),
      ariaLabel: button === null ? null : button.getAttribute('aria-label'),
      thumbAttr: thumb === null ? null : thumb.getAttribute('${WORKBENCH_THUMB_ATTR}'),
      noticeText: notice === null ? null : String(notice.textContent ?? ''),
    },
    frame: frame === null ? { found: false } : {
      found: true,
      childCount: frame.children.length,
      gridRaw,
      trackCount,
      sidebarTrack,
      centerTrackRaw: grid === null ? null : (gridRaw.includes('minmax(0px,') ? 'minmax(0px, 1fr)' : 'minmax(0, 1fr)'),
      rightbarTrack,
      sidebarCollapsed: frame.hasAttribute('data-sidebar-collapsed'),
      rightbarCollapsed: frame.hasAttribute('data-rightbar-collapsed'),
      rightbarFullscreen: frame.hasAttribute('data-rightbar-fullscreen'),
      dragging: frame.hasAttribute('data-dragging'),
      shellOverlayCount: document.querySelectorAll('[data-shell-overlay]').length,
      rightbarColCount: document.querySelectorAll('[data-rightbar-col]').length,
      dragHandleSidebar: document.querySelector('[data-side="sidebar"]') !== null,
      dragHandleRightbar: document.querySelector('[data-side="rightbar"]') !== null,
    },
    panelCount: panels.length,
    panelInCenter: centerCol !== null && panels.some((node) => centerCol.contains(node)),
    panelInRightbar: rightbarCol !== null && panels.some((node) => rightbarCol.contains(node)),
    sidebarSignature: signatureOf(sidebarCol),
    // 官方侧的**语义标签**读数（只取显式 aria-label/title，不取 textContent —— 正文里可能有会变的东西）：
    // 用来判「官方入口/按钮在两种布局下不受影响」，同时**如实暴露**它在出厂 profile 里可能是空的。
    sidebarLabelCensus: sidebarCol === null ? null : [...sidebarCol.querySelectorAll('button, [role], a, [aria-label], [title]')]
      .map((e) => String(e.getAttribute('aria-label') ?? e.getAttribute('title') ?? '').replace(/\\s+/g, ' ').trim())
      .filter((label) => label !== ''),
    sidebarButtonCount: sidebarCol === null ? null : sidebarCol.querySelectorAll('button, a, [role="button"]').length,
    centerSignature: signatureOf(centerCol),
    glyphIds,
    officialGlyphIds: glyphIds.filter((id) => id.indexOf(${OWN_PREFIX_LITERAL}) !== 0),
  };
})()`;

/** 读一次工作台读数（结构 + 属性）。 */
export async function readWorkbenchFacts(session) {
  return session.evaluate(WORKBENCH_FACTS_EXPR);
}

/** 「完全还原」要比的那些字段（**结构 + 属性**；几何与观感不在其中 —— 见文件头注释）。 */
export function workbenchDigest(facts) {
  const frame = facts?.frame ?? {};
  return {
    state: facts?.switch?.stateAttr ?? null,
    sidebarCollapsed: frame.sidebarCollapsed === true,
    sidebarTrack: frame.sidebarTrack ?? null,
    trackCount: frame.trackCount ?? null,
    rightbarTrack: frame.rightbarTrack ?? null,
    rightbarCollapsed: frame.rightbarCollapsed === true,
    rightbarFullscreen: frame.rightbarFullscreen === true,
    dragHandleSidebar: frame.dragHandleSidebar === true,
    panelCount: facts?.panelCount ?? null,
    panelInCenter: facts?.panelInCenter === true,
    sidebarSignature: facts?.sidebarSignature ?? null,
  };
}

/**
 * 「完全还原」判据（**纯函数** ⇒ 离线可自证，见 `verify/real-machine/workbench-selftest.mjs`）：
 * 退出后的 digest 必须与进入前的 digest **逐字段相等**。
 *
 * 会红的场景（离线自证逐条喂，不是口头保证）：
 *  ① **进入前侧栏已收起、退出后却展开**（把 `toggle` 写成「设回默认宽」）⇒ `sidebarCollapsed` / `sidebarTrack` 不等；
 *  ② **退出后 main 还停在坞面板**（忘了 `selectPanel` 回退）⇒ `panelCount` / `panelInCenter` 不等；
 *  ③ **右栏没关回去**（`data-rightbar-fullscreen` / `rightbarTrack` 留着）⇒ 不等；
 *  ④ 退出时把侧栏拖柄的渲染条件搞反 ⇒ `dragHandleSidebar` 不等。
 * 反过来说：**「看起来回来了」不等于还原** —— 只有逐字段相等才算。
 */
export function workbenchRestored(before, after) {
  const a = workbenchDigest(before);
  const b = workbenchDigest(after);
  const diffs = Object.keys(a)
    .filter((key) => a[key] !== b[key])
    .map((key) => `${key}: ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
  return { restored: diffs.length === 0, diffs, before: a, after: b };
}

/** 点开关的 JS 兜底（只在真鼠标点了没生效时用；调用方必须如实记账 `via`）。 */
export async function clickWorkbenchSwitchJs(session) {
  return session.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(WORKBENCH_BUTTON_SELECTOR)});
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
}

/** 有界等状态读数变成 `expected`（`official` / `workbench`）。 */
export async function waitWorkbenchState(session, expected, { timeoutMs = 6000, gapMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const samples = [];
  let facts = await readWorkbenchFacts(session);
  let state = facts?.switch?.stateAttr ?? null;
  samples.push(state);
  while (Date.now() < deadline && state !== expected) {
    await sleep(gapMs);
    facts = await readWorkbenchFacts(session);
    state = facts?.switch?.stateAttr ?? null;
    samples.push(state);
  }
  return { reached: state === expected, state, samples, facts };
}

/**
 * 点一次开关：**优先真鼠标**（要求 `elementFromPoint` 命中自身）；真鼠标点了但状态没动，或压根点不到，
 * 才退回 JS click —— **退回本身写进读数**（`via = 'mouse' | 'mouse+js-fallback' | 'js'`），
 * 免得「真鼠标闭环」这句话在装置里被悄悄放大。
 */
export async function clickWorkbenchSwitch(session, { expect, mouseWaitMs = 3000, fallbackWaitMs = 4000, gapMs = 250 } = {}) {
  const attempt = { expect, via: null, hit: null, mouseReason: null, fallback: null, samples: [] };
  const clicked = await realClick(session, WORKBENCH_BUTTON_SELECTOR, { waitMs: 300 });
  if (clicked.ok === true) {
    attempt.via = 'mouse';
    attempt.hit = clicked.hit ?? null;
  } else {
    attempt.mouseReason = clicked.reason ?? null;
  }
  let settled = await waitWorkbenchState(session, expect, { timeoutMs: attempt.via === 'mouse' ? mouseWaitMs : 0, gapMs });
  attempt.samples.push(...settled.samples);
  if (settled.reached !== true) {
    const viaJs = await clickWorkbenchSwitchJs(session);
    const retry = await waitWorkbenchState(session, expect, { timeoutMs: fallbackWaitMs, gapMs });
    attempt.samples.push(...retry.samples);
    attempt.fallback = {
      ...viaJs,
      reason: attempt.via === 'mouse' ? '真鼠标点击后状态未变 ⇒ 退回 JS click（如实记账）' : '真鼠标点不到 ⇒ 退回 JS click（如实记账）',
    };
    attempt.via = attempt.via === 'mouse' ? 'mouse+js-fallback' : 'js';
    settled = retry;
  }
  attempt.after = settled.facts ?? (await readWorkbenchFacts(session));
  attempt.ok = settled.reached === true;
  return attempt;
}

/** 真刷新（`Page.reload`，不是 SPA 跳转）并等到插件把开关重新装上（`present === true`）。 */
export async function reloadAndWaitWorkbench(session, { timeoutMs = 25_000, gapMs = 400 } = {}) {
  await session.send('Page.reload', { ignoreCache: false });
  const deadline = Date.now() + timeoutMs;
  const samples = [];
  let facts = null;
  while (Date.now() < deadline) {
    await sleep(gapMs);
    facts = await readWorkbenchFacts(session);
    const present = facts?.switch?.present === true;
    samples.push({ present, state: facts?.switch?.stateAttr ?? null });
    if (present === true) return { ready: true, facts, samples };
  }
  return { ready: false, facts, samples };
}

/* ── 四条判定的**核心**（纯函数）────────────────────────────────────────────────────────────────
 * 为什么把判定从 run.mjs 里提出来：**离线自检要跑同一份逻辑**（`workbench-selftest.mjs`）。
 * 判定写两遍 = 两处漂移；写在这里，真机轮与离线轮调的**就是同一个函数**（离线有牙自证）。
 */

/** workbench-toggle：开关在位且三处同源（容器锚点 / 状态读数 / aria-checked 与 thumb）。 */
export function workbenchSwitchVerdict(facts) {
  const sw = facts?.switch ?? {};
  const on = sw.stateAttr === 'workbench';
  const want = { present: true, count: 1, buttonPresent: true, stateInRange: true, ariaChecked: String(on), thumb: on ? 'right' : 'left' };
  const ok = sw.present === true
    && sw.count === 1
    && sw.buttonPresent === true
    && (sw.stateAttr === 'official' || sw.stateAttr === 'workbench')
    && sw.ariaChecked === want.ariaChecked
    && sw.thumbAttr === want.thumb;
  return { ok, want, got: { present: sw.present, count: sw.count, buttonPresent: sw.buttonPresent, stateAttr: sw.stateAttr, ariaChecked: sw.ariaChecked, thumbAttr: sw.thumbAttr } };
}

/** workbench-enter：一次点击是否**真的**进了工作台布局（且那一次是**真鼠标**命中自身）。 */
export function workbenchEnterVerdict(before, enter, after) {
  const frame = after?.frame ?? {};
  const want = {
    viaMouse: true, hitSelf: true, stateAttr: 'workbench', sidebarCollapsed: true, sidebarTrack: 56,
    trackCount: 3, panelInCenter: true, rightbarTrackPositive: true, rightbarCollapsed: false, dragHandleSidebar: false,
  };
  const got = {
    via: enter?.via ?? null, hitSelf: enter?.hit?.self ?? null, stateBefore: before?.switch?.stateAttr ?? null,
    stateAttr: after?.switch?.stateAttr ?? null, sidebarCollapsed: frame.sidebarCollapsed ?? null, sidebarTrack: frame.sidebarTrack ?? null,
    trackCount: frame.trackCount ?? null, panelInCenter: after?.panelInCenter ?? null, panelInRightbar: after?.panelInRightbar ?? null,
    rightbarTrack: frame.rightbarTrack ?? null, rightbarCollapsed: frame.rightbarCollapsed ?? null,
    rightbarFullscreen: frame.rightbarFullscreen ?? null, dragHandleSidebar: frame.dragHandleSidebar ?? null, panelCount: after?.panelCount ?? null,
  };
  const ok = enter?.ok === true
    && enter?.via === 'mouse'
    && enter?.hit?.self === true
    && got.stateAttr === 'workbench'
    && got.sidebarCollapsed === true
    && got.sidebarTrack === 56
    && got.trackCount === 3
    && got.panelInCenter === true
    && (got.rightbarTrack ?? 0) > 0
    && got.rightbarCollapsed === false
    && got.dragHandleSidebar === false;
  return { ok, want, got };
}

/** workbench-persist：落盘字节里真有这个值 **且** 刷新后被采用成布局（不是只翻了个标志）。 */
export function workbenchPersistVerdict({ persistedText, afterReload }) {
  const hasWorkbench = typeof persistedText === 'string' && persistedText.includes('workbench');
  const adopted = afterReload?.switch?.stateAttr === 'workbench'
    && afterReload?.frame?.sidebarCollapsed === true
    && afterReload?.panelInCenter === true;
  return { ok: hasWorkbench === true && adopted === true, hasWorkbench, adopted };
}

/** workbench-official-frame：官方侧在两个布局之间「什么也没变」（frame 契约自洽 + 侧栏摘要/标签一致）。 */
export function workbenchOfficialVerdict(d0, d2) {
  const f0 = d0?.frame ?? {};
  const f2 = d2?.frame ?? {};
  const got = {
    found: [f0.found === true, f2.found === true],
    shellOverlayCount: [f0.shellOverlayCount ?? null, f2.shellOverlayCount ?? null],
    rightbarColCount: [f0.rightbarColCount ?? null, f2.rightbarColCount ?? null],
    trackCount: [f0.trackCount ?? null, f2.trackCount ?? null],
    sidebarSignatureSame: typeof d0?.sidebarSignature === 'string' && d0.sidebarSignature === d2?.sidebarSignature,
    sidebarLabelCensusSame: JSON.stringify(d0?.sidebarLabelCensus ?? null) === JSON.stringify(d2?.sidebarLabelCensus ?? null),
    officialGlyphIdsSame: JSON.stringify(d0?.officialGlyphIds ?? null) === JSON.stringify(d2?.officialGlyphIds ?? null),
    officialGlyphIds: d0?.officialGlyphIds ?? null,
    sidebarLabelCensus: d0?.sidebarLabelCensus ?? null,
  };
  // ★ 注意：`officialGlyphIdsSame` **不在**本 `ok` 链里。
  //   出厂 profile 只装本包 ⇒ 两态读数都是 `[]` ⇒ 那个等式**空转恒真**，留在链里等于拿恒真断言充数。
  //   它已**单独拆成 workbench-official-entries**（`workbenchOfficialEntriesVerdict`），并带「不适用 ⇒ 不判绿」的闸。
  const ok = got.found[0] === true && got.found[1] === true
    && got.shellOverlayCount[0] === 1 && got.shellOverlayCount[1] === 1
    && got.rightbarColCount[0] === 1 && got.rightbarColCount[1] === 1
    && got.trackCount[0] === 3 && got.trackCount[1] === 3
    && got.sidebarSignatureSame === true
    && got.sidebarLabelCensusSame === true;
  return { ok, got };
}

/**
 * workbench-official-entries：**「非本包入口在两种布局下不受影响」单独判**，并带**适用性闸**。
 *
 * 为什么单独拆：出厂 profile（只装了本包）里非本包入口读数**两态都是空数组** ⇒ 只比相等的写法**恒真**，
 * 属「恒真断言充数」。正确姿势：**空数组 ⇒ 本条不适用**（不算绿、也不算实现红，按「未取真机证」登记），
 * 两态**非空**时才真的比相等。纯函数 ⇒ 离线自检三种输入都能喂（含「变了必须判红」的负控）。
 */
export function workbenchOfficialEntriesVerdict(d0, d2) {
  const a = Array.isArray(d0?.officialGlyphIds) ? d0.officialGlyphIds : null;
  const b = Array.isArray(d2?.officialGlyphIds) ? d2.officialGlyphIds : null;
  const applicable = a !== null && b !== null && (a.length > 0 || b.length > 0);
  return { applicable, same: JSON.stringify(a) === JSON.stringify(b), ids0: a, ids1: b };
}

/* ── 宿主侧 settings 注册读数（读宿主半区写的可观测行）────────────────────────────────────────
 * 宿主半区每次注册尝试都写**一行**到 logger + stderr，前缀固定、形状可 grep：
 *   `[gui-frame] settings 注册 尝试 #<seq> ⇒ 已注册/未注册(<reason>) ｜settings=<…> schema=<…> 锚=<逐锚成败> at=<ISO>`
 * 本装置只**读**这一行（不改宿主行为）：它是回答「宿主到底注册了没有」的唯一一手读数
 * —— Cordis logger 的内存 buffer 不落盘，所以「日志里没有」**不能**当「没注册」。
 */
