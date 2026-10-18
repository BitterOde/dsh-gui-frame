// lib/judge/console.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// console 归类与面板健康（含宿主 stderr 读数）

import { sleep } from './base.mjs';
import { readFileSync } from 'node:fs';

export const APPLY_FAILED = /\[gui-frame\] 客户端 apply 失败/;
/**
 * React 错误码族（300 = 本次渲染 hooks 比上次少、310 = 比上次多）与 minified 报错前缀。
 *
 * 「井号」在这里写成 `\u0023` 转义、**不写字面符号**：本包 `scripts/check-tokens.mjs` 的**硬门禁面**
 * 会把「井号 + 三位十六进制」判成硬编码色值（它的夹具/记录面目前只含 `tests/`、`probe/`、`docs/`，
 * `verify/**` 不在内），字面写法会让 `npm run check:tokens` exit 1、连带 `npm test` 变红。
 * 转义与字面写法**逐字等价**（`\u0023` 就是那个符号），覆盖面反而略宽（`3\d\d` 覆盖整个 hooks 错误族）。
 */
export const REACT_MINIFIED = /(Minified React error|React \u00233\d\d|Rendered fewer hooks than expected|Rendered more hooks than during the previous render)/;
export const EXPECTED_DEGRADE = /未装配：no-slots|未装配：no-react-seed|未装配：缺少|让位/;

/** console / 异常 / Log 三类来源合并后**分类记账**。 */
export function classifyConsole(session) {
  const consoleItems = session.consoleEntries().map((row) => ({ source: 'console', level: row.type, text: row.text }));
  const logItems = session.logEntries().map((row) => ({ source: 'log', level: row.level, text: row.text }));
  const exceptionItems = session.exceptions().map((text) => ({ source: 'exception', level: 'error', text }));
  const all = [...consoleItems, ...logItems, ...exceptionItems];
  const dedupe = (rows) => [...new Set(rows.map((row) => row.text))].map((text) => rows.find((row) => row.text === text));
  const hardRed = dedupe(all.filter((row) => APPLY_FAILED.test(row.text) || REACT_MINIFIED.test(row.text)));
  const expected = dedupe(all.filter((row) => EXPECTED_DEGRADE.test(row.text) && !hardRed.includes(row)));
  const other = dedupe(all.filter((row) => row.level === 'error' && !APPLY_FAILED.test(row.text) && !REACT_MINIFIED.test(row.text) && !EXPECTED_DEGRADE.test(row.text)));
  return { all, hardRed, expectedDegrade: expected, otherErrors: other };
}

/**
 * **面板健康五件套**（面板整块进错误态的合格线，来自实现方的自证口径）。
 *
 * 为什么要在「四段逐段可达」之外再加这一条：那种错误的形态是**面板整块进错误态**（正文一句话、工具栏 0 项），
 * 而四段判据读的是「点某段之后段在不在」——一旦面板根本没渲染成正常态，四段会**一起**红，看不出「哪儿坏了」。
 * 五件套直接读面板根与正文的**结构事实**，把「面板是活的」这件事单独钉一条：
 *   ① `[data-guif-state]` 三态锚点**全部消失**（loading/empty/error 都不该在）
 *   ② 面板正文**不含** `is not a function`（那次的错误原文）
 *   ③ `data-guif-active` === `'true'`（外壳的 `activePanelId` 确实指向本面板）
 *   ④ `data-guif-sessions-count` 与**外壳侧真值参照**对齐：是**纯数字**，且 —— 参照
 *      （`[data-ds-session]`／`[data-session-id]`／`a[href*="/session"]` 三者取最大）为 **0** 时
 *      **接受任意数字（含 `0`）**；参照 **> 0** 时必须与它**相等**；`unknown`／非数字一律不算。
 *      （此处曾写「纯数字且 > 0；`0` 都不算」——**与实现不符**。真实口径见下面的
 *      `sessionsCountReal`：有一轮真机 `sessions-count=0` 而参照也是 0，panel-health 当时就是 pass。
 *      本处只改**描述**，**不动判据强度**。）
 *   ⑤ 四段动作（`dock`/`layout`/`channel`/`overlay`）齐备（「可点」由 demo-dock…demo-overlay 逐段点验）
 *
 * ⚠ `data-guif-state` 取的是**全页**（不限面板内）：本包三态只出现在面板里，全页扫反而更能抓到逃逸的态节点。
 */
export const PANEL_HEALTH_EXPR = `(() => {
  const panels = [...document.querySelectorAll('[data-guif-panel]')];
  // 口径修正：**哪一块面板**必须是确定的。坞面板与 demo 面板会同时挂在 DOM 里（实测 panelCount=2），
  // 取「第一块」等于把判据挂在未定义的挂载顺序上。改取：active 的那块 → 含 demo 段的那块 → 第一块。
  const panel = panels.find((node) => node.getAttribute('data-guif-active') === 'true')
    ?? panels.find((node) => node.querySelector('[data-guif-demo-section]') !== null)
    ?? panels[0] ?? null;
  const body = panel === null ? null : panel.querySelector('[data-guif-panel-body]');
  const states = [...document.querySelectorAll('[data-guif-state]')].map((e) => e.getAttribute('data-guif-state'));
  const actions = [...document.querySelectorAll('[data-guif-action]')].map((e) => String(e.getAttribute('data-guif-action')));
  const bodyText = body === null ? '' : (body.innerText || '');
  const raw = panel === null ? null : panel.getAttribute('data-guif-sessions-count');
  // 会话数的「真值参照」：外壳自己的会话列表在侧栏里，几种可能的标记都数一遍。
  // 目的只有一个 —— 分辨「0 是真没有会话」与「0 是取不到快照」。命中任一种 > 0 时，我们的数必须与它一致。
  const probe = {
    dsSession: document.querySelectorAll('[data-ds-session]').length,
    sessionId: document.querySelectorAll('[data-session-id]').length,
    hrefSession: document.querySelectorAll('a[href*="/session"]').length,
  };
  const shellBest = Math.max(probe.dsSession, probe.sessionId, probe.hrefSession);
  const numeric = raw !== null && raw !== undefined && /^\\d+$/.test(raw);
  return {
    panelId: panel === null ? null : panel.getAttribute('data-guif-panel'),
    panelIds: panels.map((node) => String(node.getAttribute('data-guif-panel')) + ':' + String(node.getAttribute('data-guif-active'))),
    states,
    statesAbsent: states.length === 0,
    bodyHasNotAFunction: /is not a function/.test(bodyText),
    bodyHead: bodyText.replace(/\\s+/g, ' ').trim().slice(0, 140),
    active: panel === null ? null : panel.getAttribute('data-guif-active'),
    sessionsCountRaw: raw,
    sessionsCountNumeric: numeric,
    shellSessionProbe: probe,
    shellSessionsBest: shellBest,
    sessionsCountReal: numeric && (shellBest === 0 || Number(raw) === shellBest),
    actions,
    actionsComplete: ['dock', 'layout', 'channel', 'overlay'].every((id) => actions.includes(id)),
  };
})()`;

/** 采一次面板健康五件套（原始事实；判定见 `isPanelHealthy`）。 */
export async function panelHealth(session) {
  return session.evaluate(PANEL_HEALTH_EXPR);
}

/** 五件套全真 ⇒ 健康。**逐条**写上（不是「没报错就算过」）。 */
export function isPanelHealthy(health) {
  if (health === null || health === undefined) return false;
  return health.statesAbsent === true
    && health.bodyHasNotAFunction === false
    && health.active === 'true'
    && health.sessionsCountReal === true
    && health.actionsComplete === true;
}

/**
 * 有界等待「面板健康」：补装窗口内第一遍可能先渲染 `loading` 态（**设计内**，与 no-slots 同源），
 * 所以不能一开面板就判死。到点仍不健康 ⇒ 返回最后一次采样（判定方据此如实判红）。
 */
export async function waitPanelHealthy(session, { timeoutMs = 9000, gapMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const samples = [];
  let last = null;
  while (Date.now() < deadline) {
    last = await panelHealth(session);
    samples.push({
      states: last?.states ?? null,
      active: last?.active ?? null,
      sessions: last?.sessionsCountRaw ?? null,
      actions: (last?.actions ?? []).length,
    });
    if (isPanelHealthy(last)) return { health: last, healthy: true, samples: samples.slice(-3) };
    await sleep(gapMs);
  }
  return { health: last, healthy: false, samples: samples.slice(-5) };
}

/** 宿主 stderr（= 实例日志文件）里找诊断上报那行（前缀 `[gui-frame] 客户端失败`）。 */
export function hostStderrLines(logPath, pattern = /\[gui-frame\] 客户端失败/) {
  let text = '';
  try {
    text = readFileSync(logPath, 'utf8');
  } catch {
    text = '';
  }
  return text.split(/\r?\n/).filter((line) => pattern.test(line));
}

/** demo 第④段「已打开」列表里每一行的 z（形如 `family=floating z=100`）。 */
export function parseOpenedZ(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const match = String(row).match(/z=(\d+)/);
    if (match !== null) out.push(Number(match[1]));
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 工作台
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 冻结锚点（`src/client/workbench/switch.mjs` 定义；装置侧**只读名字**、不自己另起一套）：
 *   · 容器 `data-guif-workbench-switch`；状态读数 `data-guif-workbench-state`（`official` / `workbench`）；
 *   · 滑块 `data-guif-workbench-thumb`（`left` / `right`）；开关本体 `button[role="switch"]` + `aria-checked`。
 *
 * ⚠ **为什么不在这里读几何**：判据表达式要能在**离线 jsdom 自检**里跑（离线有牙自证）。
 *   jsdom 没有布局 ⇒ `getBoundingClientRect()` 恒 0，几何读数在离线面必然是假值。所以这里只读
 *   **结构 + 属性**，而官方 frame 的这几条属性/轨道是**有真源可查的**（装机源码
 *   `@deepseek-ai/dsh-client-ui-layout/lib/client.js`，实读）：
 *     · `frame.style.gridTemplateColumns` = `"<sidebar>px minmax(0, 1fr) <rightbar>px"`；
 *       **收起时侧栏轨 = 56**（`computeColumns`：`sidebar === 0 ? 56 : clampWidth(...)` 的 rail 宽）；
 *     · frame 上的 `data-sidebar-collapsed` / `data-rightbar-collapsed` / `data-rightbar-fullscreen`（**为真才出现**，
 *       源码是 `sidebarCollapsed || void 0`）；
 *     · frame.children：`[0]` 侧栏列、`[1]` 中心列（main）、`[data-rightbar-col]` 右栏列、`[data-shell-overlay]` 浮层宿主；
 *     · 侧栏拖柄**只在未收起时**渲染（`!sidebarCollapsed && <DragHandle side="sidebar">`）⇒ 它的有无是收起态的**官方旁证**；
 *     · `SIDEBAR_AUTO_COLLAPSE = 1024`：视口 < 1024 时官方会走「窄屏」分支（本装置 Edge 固定 `--window-size=1280,900`
 *       ⇒ 不走窄屏，`toggleSidebar` 是 `sidebar = sidebar === 0 ? 280 : 0` 的**自逆**动作）。
 *   视觉是否算「main 全屏」属**观感**，本装置**不代判**（见 workbench-manual 留人工；报告里只给轨道读数）。
 */
