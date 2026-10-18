// lib/judge/dock.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 坞与坞面板：事实读数、可见/就绪判定、四件套判据

import { OWN_ID_PREFIX, OWN_PREFIX_LITERAL, sleep } from './base.mjs';
import { clickSidebarRowByGlyph, realClick } from './click.mjs';

export const DOCK_ENTRY_ID = `${OWN_ID_PREFIX}dock`;

/** 点侧栏的一行（行按钮内部才是我们自己的坞图标）。 */
export const DOCK_FACTS_EXPR = `(() => {
  const panels = [...document.querySelectorAll('[data-guif-panel]')];
  const dockish = (node) => node.querySelector('[data-guif-dock-actions], [data-guif-dock-editor], [data-guif-dock-action]') !== null;
  const active = panels.find((node) => node.getAttribute('data-guif-active') === 'true') ?? null;
  const root = panels.find((node) => node === active && dockish(node)) ?? panels.find((node) => dockish(node)) ?? null;
  const q = (sel) => (root === null ? [] : [...root.querySelectorAll(sel)]);
  const ids = q('[data-guif-dock-action]').map((e) => String(e.getAttribute('data-guif-dock-action')));
  const valueNode = q('[data-guif-dock-actions]')[0] ?? null;
  const raw = valueNode === null ? null : String(valueNode.getAttribute('data-guif-dock-actions'));
  const glyphIds = [...document.querySelectorAll('[data-guif-glyph]')].map((e) => String(e.getAttribute('data-guif-glyph')));
  return {
    found: root !== null,
    panelId: root === null ? null : String(root.getAttribute('data-guif-panel')),
    panelActive: root === null ? null : String(root.getAttribute('data-guif-active')),
    panelCount: panels.length,
    panelIds: panels.map((node) => String(node.getAttribute('data-guif-panel')) + ':' + String(node.getAttribute('data-guif-active'))),
    activePanelId: active === null ? null : String(active.getAttribute('data-guif-panel')),
    dockActionIds: ids,
    dockActionCount: ids.length,
    dockActionsRaw: raw,
    dockActionsNumber: raw !== null && /^[0-9]+$/.test(raw) ? Number(raw) : null,
    dockEditorCount: q('[data-guif-dock-editor]').length,
    dockGroupKeys: q('[data-guif-launcher-group]').map((e) => String(e.getAttribute('data-guif-launcher-group'))),
    launcherIds: q('[data-guif-launcher]').map((e) => String(e.getAttribute('data-guif-launcher'))),
    badgeInPanel: q('[data-guif-badge]').length,
    badgeInSidebar: document.querySelectorAll('[data-guif-badge]').length,
    panelToolbarActions: q('[data-guif-action]').map((e) => String(e.getAttribute('data-guif-action'))),
    sidebarGlyphIds: glyphIds,
    sidebarOwnIds: glyphIds.filter((id) => id.indexOf(${OWN_PREFIX_LITERAL}) === 0),
    bodyHead: (root === null ? '' : (root.innerText || '')).replace(/\\s+/g, ' ').trim().slice(0, 200),
  };
})()`;

/** 读一次坞面板的实时读数。 */
export async function readDockFacts(session) {
  return session.evaluate(DOCK_FACTS_EXPR);
}

/** 「坞面板开着」＝ 它在 DOM 里且**不是**非 active 的那块（`unknown`＝外壳说它不知道，照实记录该值）。 */
export function isDockVisible(facts) {
  return facts !== null && facts !== undefined && facts.found === true && facts.panelActive !== 'false';
}

/**
 * 坞面板**就绪**（现行口径：**不再要求面板里有布局编辑器**）。
 *
 * 旧口径「动作型入口锚点 ≥ 1 且布局编辑器锚点 ≥ 1」已作废：
 *   · 布局编辑器属于**管理页**（现在挂在工作台那一格 `main['dsh-gui-frame/workbench']`），
 *     **永远不许**出现在浮出的按钮面板里（反向面见 `dockPanelVerdicts` 的 ④）；
 *   · 「动作型入口 ≥ 1」在**出厂 profile** 上恒为 0（本包自己的 demo 动作条目不进面板，
 *     真机装置的新 profile 里没有别的插件交按钮）⇒ 它不能当「面板开没开」的判据。
 * ⇒ 就绪 = 面板在场 + **它自己的内容锚点 `[data-guif-dock-actions]` 在位**（面板真的渲染出了正文）。
 */
export function isDockReady(facts) {
  return isDockVisible(facts) && facts.dockActionsRaw !== null;
}

/**
 * **dock-panel-actions 四个子项的判定**（单一真源：常规轮的判据与命令行里的「变异前后读数对照」都走它，
 * 免得两处口径各写一遍、写到后来对不上）。返回的四个值恒为布尔。
 *
 * ① `sidebarOne` — 本包在 `sidebar.panellist` 的条目**恰 1 条**（坞自己）
 * ② `actionAtLeastOne` — 坞面板里 `[data-guif-dock-action]` ≥ 1（**出厂 profile 上恒 0** ⇒
 *    这一项只在「有外部动作型入口」的 profile 上才有分辨力；读数照记，不粉饰）
 * ③ `actionsMatch` — `[data-guif-dock-actions]` 的数值与②数出来的锚点数**一致**
 * ④ `editorAbsentInPanel` — ★ 浮出的按钮面板里**不许**出现布局编辑器
 *    （旧口径恰恰相反：要求 ≥ 1）——「布局编辑器一律不进按钮面板」，它只在管理页
 *    （＝工作台那一格）里。这一项从「正向要求」翻成**反向要求**，判据没被放宽：编辑器锚点数必须**等于 0**。
 *
 * ⚠ 这里**没有** `[data-guif-badge]`：当前没有任何入口设角标 ⇒ 真机恒 0，写进判据就是恒真/恒假。
 */
export function dockPanelVerdicts(facts) {
  const has = facts !== null && facts !== undefined;
  const own = has && Array.isArray(facts.sidebarOwnIds) ? facts.sidebarOwnIds.length : null;
  return {
    sidebarOne: has && facts.found === true && own === 1,
    actionAtLeastOne: has && facts.dockActionCount >= 1,
    actionsMatch: has && facts.dockActionsNumber !== null && facts.dockActionsNumber === facts.dockActionCount,
    editorAbsentInPanel: has && facts.dockEditorCount === 0,
  };
}

/** 四个子项全真 ⇒ dock-panel-actions 过。**逐项**判（不是「没报错就算过」）。 */
export function isDockPanelPass(facts) {
  const verdicts = dockPanelVerdicts(facts);
  return verdicts.sidebarOne && verdicts.actionAtLeastOne && verdicts.actionsMatch && verdicts.editorAbsentInPanel;
}

/**
 * 有界等待「坞面板就绪」：坞的面板内容跟着 store 刷新（demo 的动作型入口晚到 ~3s 是可能的），
 * 所以不能一点开就判死。到点仍不就绪 ⇒ 返回最后一次采样（判定方据此**如实判红**）。
 */
export async function waitDockReady(session, { timeoutMs = 12000, gapMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const samples = [];
  let last = null;
  while (Date.now() < deadline) {
    last = await readDockFacts(session);
    samples.push({
      found: last?.found ?? null,
      active: last?.panelActive ?? null,
      dockAction: last?.dockActionCount ?? null,
      dockEditor: last?.dockEditorCount ?? null,
      ownSidebar: (last?.sidebarOwnIds ?? []).length,
    });
    if (isDockReady(last)) return { facts: last, ready: true, samples: samples.slice(-3) };
    await sleep(gapMs);
  }
  return { facts: last, ready: false, samples: samples.slice(-5) };
}

/**
 * 打开 **坞自己的面板**（`dsh-gui-frame/dock`）。侧栏那一行是它**唯一**的入口。
 *
 * 为什么第一策略是 JS `row.click()` 而不是真鼠标：坞图标（我们自己的 `[data-guif-glyph]`）在**外壳行按钮内部**，
 * 而该图标中心点被一个覆盖层（`elementFromPoint` 实测命中一个无 class 的 DIV）挡着 ⇒ 真鼠标点击会被吞。
 * 真鼠标只作**第二策略**，而且**限定点图标自身**（`realClick` 自带命中测试，会如实记下被谁遮挡）——
 * 绝不 point 任意 `button`：在真 GUI 上「随便点一颗按钮」可能撞到会话/发送键，那是不可接受的副作用。
 */
export async function ensureDockPanel(session) {
  const tried = [];
  let facts = await readDockFacts(session);
  if (isDockVisible(facts)) return { opened: true, via: 'already-open', tried, focus: facts };

  const glyphIds = await session.evaluate(`(() => [...document.querySelectorAll('[data-guif-glyph]')].map((e) => String(e.getAttribute('data-guif-glyph'))))()`);
  const all = glyphIds.map((_, index) => index);
  const preferred = glyphIds.indexOf(DOCK_ENTRY_ID);
  const order = preferred >= 0 ? [preferred, ...all.filter((index) => index !== preferred)] : all;

  for (const index of order) {
    const clicked = await clickSidebarRowByGlyph(session, index);
    await sleep(1200);
    facts = await readDockFacts(session);
    tried.push(`row#${index}(${glyphIds[index] ?? '?'}):${clicked}${isDockVisible(facts) ? `(坞面板在 active=${facts.panelActive})` : ''}`);
    if (isDockVisible(facts)) return { opened: true, via: `sidebar-row#${index}`, tried, focus: facts };
  }
  for (const index of order) {
    const result = await realClick(session, '[data-guif-glyph]', { index, waitMs: 1000 });
    facts = await readDockFacts(session);
    tried.push(`mouse-glyph#${index}:${result.ok === true ? `clicked(命中${result.hit?.self === true ? '自身' : `遮挡(${result.hit?.tag ?? '?'}.${String(result.hit?.className ?? '').slice(0, 30)})`})` : result.reason}`);
    if (isDockVisible(facts)) return { opened: true, via: `mouse-glyph#${index}`, tried, focus: facts };
  }
  return { opened: false, reason: `点遍侧栏行仍未开出坞面板（${tried.join(' / ')}）`, tried, focus: facts };
}

/**
 * 打开 **demo 面板**：直到 `[data-guif-action]` 里出现 demo 四段的 id。
 *
 * ⚠ **入口路径变过（本函数必须跟着变，否则整套 demo 判据在真机上是伪红）**：
 * 旧口径里 demo 自己占侧栏一行（点它的坞图标即开）；后来本包自己的附加页一律
 * `sidebar:false` ⇒ **只占 `main`、不占侧栏**，入口由**坞总览面板**给一颗 `data-guif-launcher` 按钮。
 * 所以主路是：先开坞面板 → 点坞面板里那颗导航按钮（真鼠标优先、JS 兜底，两条都记账）。
 * 侧栏逐个点行按钮降级为**兜底**（万一将来又出现“本包附加页占侧栏”的口径）。
 */
export async function ensureDemoPanel(session) {
  const readState = () => session.evaluate(`(() => ({
    panels: document.querySelectorAll('[data-guif-panel]').length,
    panelIds: [...document.querySelectorAll('[data-guif-panel]')].map((e) => String(e.getAttribute('data-guif-panel')) + ':' + String(e.getAttribute('data-guif-active'))),
    actions: [...document.querySelectorAll('[data-guif-action]')].map((e) => String(e.getAttribute('data-guif-action'))),
    sections: [...document.querySelectorAll('[data-guif-demo-section]')].map((e) => String(e.getAttribute('data-guif-demo-section'))),
    glyphs: document.querySelectorAll('[data-guif-glyph]').length,
    dockActions: document.querySelectorAll('[data-guif-dock-action]').length,
    launchers: [...document.querySelectorAll('[data-guif-launcher]')].map((e) => String(e.getAttribute('data-guif-launcher'))),
    active: [...document.querySelectorAll('button[aria-current="page"]')].map((e) => (e.textContent || '').trim().slice(0, 20)),
  }))()`);
  const hasDemo = (state) => state.actions.includes('layout') && state.actions.includes('overlay');

  let state = await readState();
  if (hasDemo(state)) return { opened: true, via: 'already-open', state, tried: [] };

  const tried = [];
  const dock = await ensureDockPanel(session);
  tried.push(`坞面板:${dock.opened === true ? `开（${dock.via}）` : `未开（${dock.reason ?? '?'}）`}`);
  if (dock.opened === true) {
    let launchers = (await readState()).launchers;
    // 坞面板的内容跟着 store 刷新走：入口刚注册进来时导航按钮可能还差一帧 ⇒ 空列表时补采一次（有界）。
    if (launchers.length === 0) {
      await sleep(1200);
      launchers = (await readState()).launchers;
    }
    tried.push(`坞内导航按钮=${JSON.stringify(launchers)}`);
    for (let index = 0; index < launchers.length; index += 1) {
      const id = launchers[index];
      const mouse = await realClick(session, '[data-guif-launcher]', { index, waitMs: 1200 });
      tried.push(`launcher#${index}(${id}):mouse:${mouse.ok === true ? `clicked(命中${mouse.hit?.self === true ? '自身' : '遮挡'})` : mouse.reason}`);
      state = await readState();
      if (hasDemo(state)) return { opened: true, via: `坞面板-launcher#${index}:mouse`, state, tried, dock };
      const js = await session.evaluate(`(() => {
        const node = [...document.querySelectorAll('[data-guif-launcher]')].find((e) => e.getAttribute('data-guif-launcher') === ${JSON.stringify(id)}) ?? null;
        if (node === null) return { ok: false, reason: 'missing' };
        node.click();
        return { ok: true };
      })()`);
      await sleep(1200);
      state = await readState();
      tried.push(`launcher#${index}(${id}):js:${js.ok === true ? 'clicked' : js.reason}${hasDemo(state) ? '' : '（仍未见 demo 工具栏）'}`);
      if (hasDemo(state)) return { opened: true, via: `坞面板-launcher#${index}:js（真鼠标未生效，已记账）`, state, tried, dock };
    }
  }

  // 兜底：侧栏里若还有本包的 demo 行（旧口径/回退情形），按老办法逐个点行按钮。
  const glyphIds = await session.evaluate(`(() => [...document.querySelectorAll('[data-guif-glyph]')].map((e) => String(e.getAttribute('data-guif-glyph'))))()`);
  for (let index = 0; index < Math.max(glyphIds.length, 1); index += 1) {
    const clicked = await clickSidebarRowByGlyph(session, index);
    await sleep(1200);
    state = await readState();
    tried.push(`兜底-侧栏row#${index}(${glyphIds[index] ?? '?'}):${clicked}`);
    if (hasDemo(state)) return { opened: true, via: `兜底-侧栏row#${index}`, state, tried, dock };
  }
  for (let index = 0; index < Math.max(glyphIds.length, 1); index += 1) {
    const result = await realClick(session, '[data-guif-glyph]', { index, waitMs: 900 });
    state = await readState();
    tried.push(`兜底-mouse-glyph#${index}:${result.ok === true ? 'clicked' : result.reason}`);
    if (hasDemo(state)) return { opened: true, via: `兜底-mouse-glyph#${index}`, state, tried, dock };
  }
  return { opened: false, reason: `点遍坞面板导航按钮与侧栏行仍未出现 demo 工具栏（${tried.join(' / ')}）`, state, tried, dock };
}
