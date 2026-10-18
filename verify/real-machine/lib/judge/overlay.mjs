// lib/judge/overlay.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 浮层：活层栈读数、两扇浮层的开与内部入口

import { sleep } from './base.mjs';
import { realClick } from './click.mjs';
import { clickDemoOpen, clickDemoOpenJs } from './demo-actions.mjs';

export const OVERLAY_STACK_EXPR = `(() => {
  const layers = [...document.querySelectorAll('[data-guif-overlay-layer]')].map((e) => String(e.getAttribute('data-guif-overlay-layer')));
  const root = document.querySelector('[data-guif-overlay-root]');
  const windows = [...document.querySelectorAll('[data-guif-window]')].map((e) => String(e.getAttribute('data-guif-window')));
  const zList = [...document.querySelectorAll('[data-guif-z]')].map((e) => Number(e.getAttribute('data-guif-z')));
  return {
    layers,
    layerCount: layers.length,
    layersAttr: root === null ? null : root.getAttribute('data-guif-overlay-layers'),
    bottom: layers.length === 0 ? null : layers[0],
    top: layers.length === 0 ? null : layers[layers.length - 1],
    windows,
    zList,
  };
})()`;

/** 读一次浮层层栈（活的当前态）。 */
export async function readOverlayStack(session) {
  return session.evaluate(OVERLAY_STACK_EXPR);
}

/** 读第④段那份**只增不减**的开窗账（`dl[data-guif-overlay-opened]` 的行文本）——它记的是「开过什么」，不是「现在开着几扇」。 */
export async function readOpenedRows(session) {
  return session.evaluate(`[...document.querySelectorAll('[data-guif-overlay-opened] dt, [data-guif-overlay-opened] dd')].map((e) => e.textContent)`);
}

/**
 * **每个浮层只点一次**地开出一扇（修正口径的第二核心）。
 *
 * 判「这一下点开出来了没有」用**事件计数器** —— 开窗账行数增长；它家族无关（浮动窗与官方 Modal 都记一行），
 * 而旧口径用只有浮动窗才有的 `[data-guif-window]` ⇒ 对话层**永远看起来没开** ⇒ 被点第二次 ⇒ 账上三行。
 *
 * `prefer` 指定首选策略，另一条留作兜底（都记账）：
 *   · `window` 用 `prefer:'mouse'` —— 走真机鼠标路径；
 *   · `dialog` 用 `prefer:'js'` —— **必须避开 `pointerdown`**：第④段这两个按钮在浮层**外面**，真鼠标点击会产生
 *     document 上的 `pointerdown` ⇒ 命中「**点外只关最上层**」（设计内行为，见 `overlay/dismiss.mjs`）⇒ 先把已开的
 *     那一扇关掉，两扇就永远叠不起来（这正是早先几轮里窗口「消失」的原因）。
 *     JS `element.click()` 只派发 `click`、不产生 `pointerdown` ⇒ 两扇能共存。理由写在 `via` 里，不是偷偷换策略。
 */
export async function openDemoOverlayOnce(session, which, { prefer = 'mouse', waitMs = 2600, gapMs = 300 } = {}) {
  const rowsBefore = await readOpenedRows(session);
  const steps = [];
  const settle = async () => {
    const deadline = Date.now() + waitMs;
    let rows = await readOpenedRows(session);
    while (Date.now() < deadline && rows.length <= rowsBefore.length) {
      await sleep(gapMs);
      rows = await readOpenedRows(session);
    }
    return rows;
  };
  const attempt = async (kind) => {
    const result = kind === 'mouse' ? await clickDemoOpen(session, which) : await clickDemoOpenJs(session, which);
    steps.push(`${kind}:${result.ok === true ? 'clicked' : result.reason}`);
    return settle();
  };
  const order = prefer === 'js' ? ['js', 'mouse'] : ['mouse', 'js'];
  let rows = await attempt(order[0]);
  if (rows.length <= rowsBefore.length) rows = await attempt(order[1]);
  return {
    which,
    prefer,
    opened: rows.length > rowsBefore.length,
    added: rows.length - rowsBefore.length,
    via: steps.join('→'),
    steps,
    rows,
  };
}

/** 点诊断通道的专测按钮（真鼠标）。 */
export const INSIDE_SELECTOR = '[data-guif-demo-open-dialog-inside]';

/** 读这条内部入口的现状：在不在、**是否真在浮层宿主内部**、命中几何。 */
export const INSIDE_ENTRY_EXPR = `(() => {
  const nodes = [...document.querySelectorAll(${JSON.stringify('[data-guif-demo-open-dialog-inside]')})];
  const node = nodes[0] ?? null;
  const layer = node === null ? null : node.closest('[data-guif-overlay-layer]');
  const rect = node === null ? null : node.getBoundingClientRect();
  const usable = rect !== null && rect.width > 0 && rect.height > 0;
  const x = usable ? rect.left + rect.width / 2 : null;
  const y = usable ? rect.top + rect.height / 2 : null;
  const top = usable ? document.elementFromPoint(x, y) : null;
  return {
    count: nodes.length,
    present: node !== null,
    // 「在浮层宿主内部」与「在某一层里」分开记：前者是本判据的机制前提（dismiss 按 root 判内外）
    inOverlayRoot: node === null ? false : node.closest('[data-guif-overlay-root]') !== null,
    inLayer: layer === null ? null : String(layer.getAttribute('data-guif-overlay-layer')),
    inFloatingWindow: node === null ? false : node.closest('[data-guif-window]') !== null,
    zeroSize: rect !== null && !usable,
    hitSelf: top !== null && node !== null && (top === node || node.contains(top)),
    hitTag: top === null ? null : top.tagName,
    hitClassName: top === null ? null : String(top.className ?? '').slice(0, 60),
    text: node === null ? null : String(node.textContent ?? '').slice(0, 60),
    overlayLayers: [...document.querySelectorAll('[data-guif-overlay-layer]')].map((e) => String(e.getAttribute('data-guif-overlay-layer'))),
  };
})()`;

/** 采一次内部入口读数。 */
export async function readInsideEntry(session) {
  return session.evaluate(INSIDE_ENTRY_EXPR);
}

/** 内部入口的 JS 兜底点击（同 `clickDemoOpenJs` 的纪律：记账，不悄悄当成功）。 */
export async function clickInsideDialogJs(session, selector = INSIDE_SELECTOR) {
  return session.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
}

/**
 * 开**第二扇**（走浮层内部入口），并如实记账用的是哪条策略。
 *
 * 与 `openDemoOverlayOnce` 同一套「每扇只点一次 + 用家族无关的账行数判开没开」的口径；
 * 差别只有两点：① 点的锚点是**浮层内部**那颗（`selector` 可被变异改错，用来装牙）；
 * ② 额外把**真鼠标那一下的命中事实**（`hitSelf / 是否在浮层里 / 命中元素`）带回来 ——
 *    「真鼠标点得动」这条本身要能被单独判红（overlay-inside-entry），不能混在「开出来了」里含糊过去。
 */
export async function openInsideDialogOnce(session, { selector = INSIDE_SELECTOR, prefer = 'mouse', waitMs = 2600, gapMs = 300 } = {}) {
  const rowsBefore = await readOpenedRows(session);
  const before = await readInsideEntry(session);
  const steps = [];
  const attempts = [];
  const settle = async () => {
    const deadline = Date.now() + waitMs;
    let rows = await readOpenedRows(session);
    while (Date.now() < deadline && rows.length <= rowsBefore.length) {
      await sleep(gapMs);
      rows = await readOpenedRows(session);
    }
    return rows;
  };
  const attempt = async (kind) => {
    let result;
    if (kind === 'mouse') {
      result = await realClick(session, selector, { waitMs: 1200 });
      attempts.push({ kind, ok: result.ok === true, reason: result.reason ?? null, hitSelf: result.hit?.self === true, hitTag: result.hit?.tag ?? null, hitClassName: result.hit?.className ?? null });
    } else {
      result = await clickInsideDialogJs(session, selector);
      attempts.push({ kind, ok: result.ok === true, reason: result.reason ?? null, hitSelf: null, hitTag: null, hitClassName: null });
    }
    steps.push(`${kind}:${result.ok === true ? 'clicked' : result.reason}`);
    return settle();
  };
  const order = prefer === 'js' ? ['js', 'mouse'] : ['mouse', 'js'];
  let rows = await attempt(order[0]);
  if (rows.length <= rowsBefore.length) rows = await attempt(order[1]);
  const mouseAttempt = attempts.find((row) => row.kind === 'mouse') ?? null;
  return {
    // 变异把选择器改错时，「入口在不在」本身就是读数的一部分 ⇒ 单独记下来，别让它藏在 count 里
    present: before?.present === true,
    count: before?.count ?? 0,
    inOverlayRoot: before?.inOverlayRoot === true,
    inFloatingWindow: before?.inFloatingWindow === true,
    inLayer: before?.inLayer ?? null,
    prefer,
    opened: rows.length > rowsBefore.length,
    added: rows.length - rowsBefore.length,
    via: steps.join('→'),
    steps,
    attempts,
    mouseClicked: mouseAttempt?.ok === true,
    mouseHitSelf: mouseAttempt?.hitSelf === true,
    mouseHitTag: mouseAttempt?.hitTag ?? null,
    mouseHitClassName: mouseAttempt?.hitClassName ?? null,
    rows,
    overlaysBefore: before?.overlayLayers ?? null,
  };
}

/**
 * **坞面板底部那台布局编辑器**的实时读数：显式覆盖动作 / 结果提示 / 可写态 / 行序。
 *
 * 为什么单开一条表达式而不是塞进快照：这几个锚点**只在坞面板里**，而坞面板的内容跟着 store 刷新
 * （载入屏障 + 动作结果都要重读一次）。判定要的是「点之前 / 点之后」两次**同口径**的读数。
 */
