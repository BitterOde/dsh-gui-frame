// lib/judge/click.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 点击原语：真鼠标点击、按字形点侧栏行

import { sleep } from './base.mjs';

export const clickExpr = (selector) => `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (node === null) return 'missing';
  node.click();
  return 'clicked';
})()`;
export const clickByAttrExpr = (attr, value) => `(() => {
  const nodes = [...document.querySelectorAll('[' + ${JSON.stringify(attr)} + ']')].filter((e) => e.getAttribute(${JSON.stringify(attr)}) === ${JSON.stringify(value)});
  if (nodes.length === 0) return 'missing';
  nodes[0].click();
  return 'clicked';
})()`;

/**
 * **真鼠标点击**（CDP Input）：按下 + 抬起都走浏览器输入管线 ⇒ 会同时产生 pointerdown/mousedown/mouseup/click
 * 这一整串真实事件。为什么不用 `element.click()`：它只派发一个 `click`，而坞入口/按钮很可能挂在
 * pointerdown 或 mousedown 上（实测：`element.click()` 打不开面板，真鼠标点击能打开）。
 */
export async function realClick(session, selector, { index = 0, waitMs = 900 } = {}) {
  const box = await session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes[${index}] ?? null;
    if (node === null) return { missing: true, count: nodes.length };
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { missing: false, zeroSize: true, count: nodes.length };
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // 命中测试：真鼠标点的是「那个坐标上的最上层元素」，不是「选择器选中的元素」。
    // 坞入口被覆盖层吞掉那次就是靠这个机制暴露的；不记下来就只能靠猜「为什么点了没反应」。
    const top = document.elementFromPoint(x, y);
    return {
      missing: false, zeroSize: false, x, y, count: nodes.length,
      tag: node.tagName, text: String(node.textContent ?? '').slice(0, 40),
      hitTag: top === null ? null : top.tagName,
      hitClass: top === null ? null : String(top.className ?? '').slice(0, 70),
      hitSelf: top !== null && (top === node || node.contains(top)),
    };
  })()`);
  if (box === null || box.missing === true) return { ok: false, reason: `missing（命中 ${box?.count ?? 0} 个）` };
  if (box.zeroSize === true) return { ok: false, reason: 'zero-size（元素不可见）' };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(waitMs);
  return { ok: true, box, hit: { tag: box.hitTag ?? null, className: box.hitClass ?? null, self: box.hitSelf === true } };
}

/** 坞自己的入口 id（＝ `src/client/dock.mjs` 的 `DOCK_ENTRY_ID`）：侧栏那一行是坞面板的唯一入口。 */
export async function clickSidebarRowByGlyph(session, index) {
  return session.evaluate(`(() => {
    const glyphs = [...document.querySelectorAll('[data-guif-glyph]')];
    const glyph = glyphs[${index}] ?? null;
    if (glyph === null) return 'missing';
    const row = glyph.closest('button') ?? glyph;
    row.click();
    return 'clicked';
  })()`);
}

/**
 * **坞面板的实时读数**（「坞面板＝动作型入口收纳台」重构后的新产品面）。
 *
 * 「哪块是坞面板」**不靠 id 硬编码**：坞面板是**含 `[data-guif-dock-actions]` / `[data-guif-dock-editor]` /
 * `[data-guif-dock-action]` 的那块面板**（这三个锚点只由 `createDockOverview` 画出来）。
 * 优先取**当前 active 的那块**（外壳把 `data-guif-active` 写在每个面板根上；非 active 的那块是 `false`
 * —— 实测两块面板会**同时挂在 DOM 里**，所以「找得到」不等于「开着」）。
 *
 * 读数逐项：
 *   · `dockActionIds` / `dockActionCount` —— `[data-guif-dock-action]`（值＝入口 id）：坞里收着的**动作型入口**；
 *   · `dockActionsRaw` / `dockActionsNumber` —— `[data-guif-dock-actions]` 的**数值**：坞自报的动作型入口条数；
 *   · `dockEditorCount` —— `[data-guif-dock-editor]`：坞面板底部**挂着的布局编辑器**；
 *   · `sidebarOwnIds` —— `[data-guif-glyph]` 里本包前缀的 id：**本包在 `sidebar.panellist` 的实时条目**
 *     （坞图标是 panellist 座位唯一的占用者；本包自己的附加页 `sidebar:false` ⇒ 只占 `main`，不出现在这里）；
 *   · `badgeInPanel` / `badgeInSidebar` —— `[data-guif-badge]`（自绘角标）。**当前没有入口设角标 ⇒ 恒 0**，
 *     所以它只作**读数**收进证据，**不作判据**（照实记账，不假装它验过什么）。
 */
