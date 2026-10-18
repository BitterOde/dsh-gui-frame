// lib/judge/demo-actions.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// demo 动作锚点的点击（含 JS 兜底路径）

import { realClick } from './click.mjs';

export async function clickAction(session, actionId) {
  const index = await session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[data-guif-action]')];
    return nodes.findIndex((e) => e.getAttribute('data-guif-action') === ${JSON.stringify(actionId)});
  })()`);
  if (index < 0) return { ok: false, reason: `没有 action=${actionId}` };
  return realClick(session, '[data-guif-action]', { index, waitMs: 900 });
}

/**
 * **JS 兜底点击**（`element.click()`）：真鼠标被覆盖层吞掉时的第二策略（坞入口那次就是这种情形）。
 *
 * 纪律：用了哪条策略必须记账（`via`），**不许把兜底当成功悄悄用掉** —— 真鼠标点不动本身是要报的信号
 * （用户也是用鼠标点的）；兜底只负责让后续判据能继续跑，并在证据里留下 `hit` 的命中详情。
 */
export async function clickActionJs(session, actionId) {
  return session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[data-guif-action]')];
    const node = nodes.find((e) => e.getAttribute('data-guif-action') === ${JSON.stringify(actionId)}) ?? null;
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
}

/** demo 第④段开窗按钮的 JS 兜底（同 `clickActionJs` 的纪律）。 */
export async function clickDemoOpenJs(session, which) {
  return session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[data-guif-demo-open]')];
    const node = nodes.find((e) => e.getAttribute('data-guif-demo-open') === ${JSON.stringify(which)}) ?? null;
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
}

/** 诊断通道专测按钮的 JS 兜底（同 `clickActionJs` 的纪律）。 */
export async function clickDemoFailJs(session) {
  return session.evaluate(`(() => {
    const node = document.querySelector('[data-guif-demo-fail]');
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
}

/** 点 demo 第④段的一个开窗按钮（真鼠标）。 */
export async function clickDemoOpen(session, which) {
  const index = await session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('[data-guif-demo-open]')];
    return nodes.findIndex((e) => e.getAttribute('data-guif-demo-open') === ${JSON.stringify(which)});
  })()`);
  if (index < 0) return { ok: false, reason: `没有 demo-open=${which}` };
  return realClick(session, '[data-guif-demo-open]', { index, waitMs: 1000 });
}

/**
 * **浮层层栈的实时读数**：判「现在开着几扇 / 栈顶是谁」必须读**活的 DOM**，
 * 不能用第④段那份**只增不减**的开窗日志 —— 它记的是历史，Esc 关掉栈顶它也不会变短。
 *
 * 口径来源（`src/client/overlay/host.mjs`）：
 *   · 根 `[data-guif-overlay-root]` 上带 `data-guif-overlay-layers="<n>"`（＝当前记录数，**会减**）；
 *   · **每一层**（浮动窗 / 模态对话框 / 气泡）都包一个 `[data-guif-overlay-layer="<id>"]`，DOM 顺序＝自底向顶；
 *   · `data-guif-z` 与 `data-guif-window` **只有浮动窗家族**才有 —— 官方 Modal（对话层）没有这两个锚点，
 *     这正是早先几轮把「对话层已开」误判成「没开」的根因。
 */
export async function clickDemoFail(session) {
  return realClick(session, '[data-guif-demo-fail]', { waitMs: 2500 });
}

/**
 * **浮层内部的开第二扇入口**（冻结锚点 `data-guif-demo-open-dialog-inside`）。
 *
 * 它只挂在**浮动窗的 content 里**（全页唯一）⇒ 它的中心点必然位于浮层之上：
 * `pointerdown` 落在浮窗**内部** ⇒ `overlay/dismiss.mjs` 的「点外只关最上层」**不触发** ⇒ 两扇能叠。
 * 这正是证① 的第二扇**终于可以走真鼠标**的机制，也正是本装置要取证的那件事。
 */
