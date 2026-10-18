// lib/judge/snapshot.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 页面快照与面板转储（等 demo 就绪 / 五类锚点读数）

import { OWN_PREFIX_LITERAL, sleep } from './base.mjs';

export const SNAPSHOT_EXPR = `(() => {
  const text = (sel) => (document.querySelector(sel)?.textContent ?? '');
  const count = (sel) => document.querySelectorAll(sel).length;
  const states = [...document.querySelectorAll('[data-guif-state]')].map((e) => e.getAttribute('data-guif-state'));
  const rows = [...document.querySelectorAll('[data-guif-overlay-opened] dt, [data-guif-overlay-opened] dd')].map((e) => e.textContent);
  // 「坞面板＝动作型入口收纳台」重构后的**新产品面锚点**。
  // 重构之前的采集面只有五类老锚点 ⇒ 这轮改动在真机上一条判据都没有（dock-panel-actions 补这个空白）。
  const glyphIds = [...document.querySelectorAll('[data-guif-glyph]')].map((e) => String(e.getAttribute('data-guif-glyph')));
  const dockActionsNode = document.querySelector('[data-guif-dock-actions]');
  return {
    title: document.title,
    bodyText: (document.body.innerText || '').length,
    anchors: {
      panel: count('[data-guif-panel]'),
      theme: count('[data-guif-theme]'),
      glyph: count('[data-guif-glyph]'),
      overlayRoot: count('[data-guif-overlay-root]'),
      layoutEditor: count('[data-guif-layout-editor]'),
      dockAction: count('[data-guif-dock-action]'),
      dockEditor: count('[data-guif-dock-editor]'),
      badge: count('[data-guif-badge]'),
      // 两个冻结的新锚点（浮层内第二扇入口 / 载荷损坏时的显式「用默认值覆盖」动作）
      dialogInside: count('[data-guif-demo-open-dialog-inside]'),
      layoutOverwrite: count('[data-guif-layout-overwrite]'),
      layoutNotice: count('[data-guif-layout-notice]'),
    },
    dialogInsideInOverlay: (() => {
      const node = document.querySelector('[data-guif-demo-open-dialog-inside]');
      return node === null ? null : node.closest('[data-guif-overlay-root]') !== null;
    })(),
    dockActionsRaw: dockActionsNode === null ? null : String(dockActionsNode.getAttribute('data-guif-dock-actions')),
    sidebarGlyphIds: glyphIds,
    sidebarOwnIds: glyphIds.filter((id) => id.indexOf(${OWN_PREFIX_LITERAL}) === 0),
    states,
    hasErrorState: states.includes('error'),
    sections: [...document.querySelectorAll('[data-guif-demo-section]')].map((e) => e.getAttribute('data-guif-demo-section')),
    overlayChildren: (document.querySelector('[data-guif-overlay-root]')?.children.length) ?? 0,
    toastish: [...document.querySelectorAll('[data-guif-overlay-root] [role], [data-guif-overlay-root] [data-guif-family]')].length,
    actions: [...document.querySelectorAll('[data-guif-action]')].map((e) => String(e.getAttribute('data-guif-action'))),
    demoOpen: [...document.querySelectorAll('[data-guif-demo-open]')].map((e) => String(e.getAttribute('data-guif-demo-open'))),
    zList: [...document.querySelectorAll('[data-guif-z]')].map((e) => Number(e.getAttribute('data-guif-z'))),
    windows: [...document.querySelectorAll('[data-guif-window]')].map((e) => String(e.getAttribute('data-guif-window'))),
    openedRows: rows,
    failResult: document.querySelector('[data-guif-demo-fail-result]')?.getAttribute('data-guif-demo-fail-result') ?? null,
    failFingerprint: document.querySelector('[data-guif-demo-fail-fingerprint]')?.getAttribute('data-guif-demo-fail-fingerprint') ?? null,
    panelBodyHead: text('[data-guif-panel-body]').replace(/\\s+/g, ' ').slice(0, 160),
    errorText: (document.querySelector('[data-guif-state="error"]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
    reactErrorText: (document.body.innerText.match(/Minified React error[^\\n]{0,90}/g) || []).slice(0, 2),
  };
})()`;

/**
 * 等「demo 段就绪」：坞入口出现 +（若面板已开）demo 工具栏项或 demo 锚点出现。
 * 为什么不直接点：兄弟服务可能晚到约 3s，汇合点有 4s/250ms 的**有界补装窗口**；
 * 在补装完成前点开只会得到空面板（captain 实测教训）。
 */
export async function waitForDemoReady(session, { timeoutMs = 20000, gapMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const samples = [];
  while (Date.now() < deadline) {
    const state = await session.evaluate(`(() => ({
      glyphs: document.querySelectorAll('[data-guif-glyph]').length,
      panels: document.querySelectorAll('[data-guif-panel]').length,
      actions: [...document.querySelectorAll('[data-guif-action]')].map((e) => String(e.getAttribute('data-guif-action'))),
      demoMarks: document.querySelectorAll('[data-guif-demo-section], [data-guif-demo-open], [data-guif-demo-fail]').length,
    }))()`);
    samples.push(state);
    if (state.glyphs > 0 && (state.actions.includes('layout') || state.demoMarks > 0)) {
      return { ready: true, state, samples: samples.slice(-3) };
    }
    await sleep(gapMs);
  }
  return { ready: false, state: samples[samples.length - 1] ?? null, samples: samples.slice(-4) };
}

/**
 * 把当前面板的全量 `data-guif-*` 属性与正文抓下来（判「开的是哪块面板」的一手材料）。
 *
 * ⚠ 口径修正：**不再**取 `document.querySelector('[data-guif-panel]')`（DOM 里第一块）。
 * 坞面板与 demo 面板**会同时挂在 DOM 里**（实测 `panelCount=2`）⇒ 「第一块」是
 * 未定义的：同一份代码在不同挂载顺序下会 dump 到不同的面板。改为：**active 的那块**优先，
 * 其次含 `[data-guif-demo-section]` 的那块，最后才退回第一块；并把**所有**面板 id 一起记下来。
 */
export async function dumpPanel(session) {
  return session.evaluate(`(() => {
    const panels = [...document.querySelectorAll('[data-guif-panel]')];
    const panel = panels.find((node) => node.getAttribute('data-guif-active') === 'true')
      ?? panels.find((node) => node.querySelector('[data-guif-demo-section]') !== null)
      ?? panels[0] ?? null;
    const attrs = {};
    if (panel !== null) for (const a of [...panel.attributes]) attrs[a.name] = String(a.value).slice(0, 80);
    const all = (panel === null ? [] : [...panel.querySelectorAll('*')])
      .flatMap((node) => [...node.attributes].map((a) => a.name))
      .filter((name) => name.startsWith('data-guif-'));
    return {
      panelId: panel?.getAttribute('data-guif-panel') ?? null,
      panelIds: panels.map((node) => String(node.getAttribute('data-guif-panel')) + ':' + String(node.getAttribute('data-guif-active'))),
      attrs,
      guifAttrsInside: [...new Set(all)].sort(),
      bodyText: (panel?.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
      errorText: (document.querySelector('[data-guif-state="error"]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
      toolbarItems: [...document.querySelectorAll('[data-guif-action]')].map((e) => String(e.getAttribute('data-guif-action'))),
    };
  })()`);
}
export async function snapshot(session) {
  return session.evaluate(SNAPSHOT_EXPR);
}

/**
 * **外壳自己的模态遮罩**：本包的面板被一个**不属于本包**的遮罩挡住时，长什么样。
 *
 * 为什么需要它：整跑挪到独立的 `$DSH_HOME` 之后，临时 home 里**没有会话** ⇒ 外壳会弹一个
 * 自己的 Dialog（`dsh-web-frontend` 的 `_mask_*` / `_dialog_*`，见证据里 `shellModal`）⇒ 它的全屏
 * 遮罩把面板整块盖住、真鼠标点什么都命中那个 mask。这是**环境前置**（外壳的态），不是本包的缺陷；
 * 但装置必须**先看见它、再说清怎么处理**，否则「真鼠标点不动」会被误读成实现坏了。
 *
 * 读数：探针点（面板左上角内侧）上的最上层元素、是否属于本包、被挡时把那个 dialog 的正文与类名带回来。
 */
