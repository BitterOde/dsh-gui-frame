// lib/judge/shell-modal.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 外壳模态：读数、点按钮、处置与 Esc

import { sleep } from './base.mjs';
import { realClick } from './click.mjs';

export const SHELL_MODAL_EXPR = `(() => {
  const panel = document.querySelector('[data-guif-panel]');
  const rect = panel === null ? null : panel.getBoundingClientRect();
  const x = rect !== null && rect.width > 0 ? rect.left + Math.min(40, rect.width / 2) : 400;
  const y = rect !== null && rect.height > 0 ? rect.top + Math.min(40, rect.height / 2) : 300;
  const top = document.elementFromPoint(x, y);
  const ours = top !== null && top.closest('[data-guif-overlay-root], [data-guif-panel]') !== null;
  // 「模态遮罩」按**类名 + 实际占位**认（外壳的 CSS modules：\`_mask_*\`）；空态落地页（无会话时的
  // 「探索未至之境」那一屏）不是遮罩 —— 它不吃点击，别把它误判成阻断。
  const masks = [...document.querySelectorAll('[class*="_mask"]')].filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  const maskPresent = masks.length > 0;
  const blocked = maskPresent && ours !== true;
  let dialogText = null;
  let dialogClasses = null;
  if (maskPresent) {
    const box = masks[0].parentElement ?? masks[0];
    dialogText = (box.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
    dialogClasses = [...box.querySelectorAll('[class]')].slice(0, 14).map((e) => String(e.className).slice(0, 48));
  }
  return {
    point: { x, y },
    panelId: panel === null ? null : String(panel.getAttribute('data-guif-panel')),
    topTag: top === null ? null : top.tagName,
    topClass: top === null ? null : String(top.className ?? '').slice(0, 80),
    ours: ours === true,
    maskCount: masks.length,
    maskPresent,
    blocked,
    dialogText,
    dialogClasses,
  };
})()`;

/** 采一次「外壳模态」读数。 */
export async function readShellModal(session) {
  return session.evaluate(SHELL_MODAL_EXPR);
}

/**
 * 点外壳那个模态里**那颗能往前走**的按钮（实测：全新 home 里外壳会连着弹几个必答 Dialog ——
 * 「内测声明 … 继续」→「添加一个 API Key … 稍后配置」→ …；Escape 与右上角关闭都关不掉它们）。
 *
 * 两条策略，都**只认外壳对话框子树内的按钮**、都要 `elementFromPoint` 命中自身：
 *   ① **非承诺用语白名单**（精确匹配，避免误点「保存并继续」这种会写东西的主按钮）：
 *      `继续 / 稍后配置 / 稍后 / 跳过 / 取消 / 关闭 / 知道了 / 确定 / 好的 / continue / later / skip / cancel / close / got it`；
 *   ② 退一步：对话框里**只有一颗按钮**时就点它（模态里那是唯一出路，人也会这么做），
 *      步骤里如实标成 `single`，不含糊成「白名单命中」。
 * 两条都不成立就如实返回 0（判据会红），**绝不猜位置乱点**。
 */
export async function clickShellDialogButton(session, point, waitMs) {
  const x = Number.isFinite(point?.x) ? point.x : 400;
  const y = Number.isFinite(point?.y) ? point.y : 300;
  const picked = await session.evaluate(`(() => {
    const blocked = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
    let node = blocked;
    for (let hop = 0; hop < 6 && node !== null && node !== undefined && node.parentElement !== null; hop += 1) {
      if (/dialog|modal|overlay|root/i.test(String(node.className ?? ''))) break;
      node = node.parentElement;
    }
    const box = node ?? document;
    const buttons = [...box.querySelectorAll('button')];
    const exact = /^(继续|稍后配置|稍后|跳过|取消|关闭|知道了|确定|好的|开始|continue|later|skip|cancel|close|got it|dismiss|ok)$/i;
    const matched = buttons.filter((candidate) => exact.test(String(candidate.textContent ?? '').trim()));
    const chosen = matched.length > 0 ? matched : (buttons.length === 1 ? buttons : []);
    const strategy = matched.length > 0 ? 'whitelist' : (buttons.length === 1 ? 'single' : null);
    chosen.forEach((candidate, index) => candidate.setAttribute('data-guif-rm-shell-skip', String(index)));
    return {
      strategy,
      found: chosen.length,
      labels: chosen.map((candidate) => String(candidate.textContent ?? '').trim().slice(0, 24)),
      allLabels: buttons.map((candidate) => String(candidate.textContent ?? '').trim().slice(0, 24)),
    };
  })()`);
  if (picked?.found === 0) return { ok: false, reason: `外壳模态里没有可用按钮（白名单没命中，且按钮数≠1）：${JSON.stringify(picked?.allLabels ?? [])}`, picked };
  const click = await realClick(session, '[data-guif-rm-shell-skip]', { index: 0, waitMs });
  return { ok: click.ok === true, hitSelf: click.hit?.self === true, reason: click.reason ?? null, picked, hit: click.hit ?? null };
}

/**
 * **把外壳自己的模态清掉**：真 Escape → 它的关闭按钮 → 它的「稍后/跳过」按钮（真鼠标，
 * 每一步都用 `elementFromPoint` 复核点完有没有真的清掉）。
 *
 * 纪律：**每一步都记账**（用了哪条、结果如何、前后读数），绝不在「没清掉」的情况下继续跑还给绿 ——
 * 清不掉的后果由后续判据如实承担（真鼠标点不动 ⇒ overlay-real-mouse/e 判红），这里只负责把事实与处置写进证据。
 */
export async function dismissShellModal(session, { attempts = 5, waitMs = 900 } = {}) {
  const before = await readShellModal(session);
  if (before?.maskPresent !== true) return { needed: false, before, after: before, steps: ['没有外壳模态遮罩：无需处置'] };
  const steps = [];
  const cleared = (row) => row !== null && row !== undefined && row.maskPresent !== true;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await pressEscape(session);
    let after = await readShellModal(session);
    steps.push(`escape#${attempt + 1}:${cleared(after) ? '已清' : '仍被挡'}`);
    if (cleared(after)) return { needed: true, before, after, steps, via: `escape#${attempt + 1}` };

    const closed = await realClick(session, '[class*="_close_"]', { waitMs });
    steps.push(`close#${attempt + 1}:${closed.ok === true ? `clicked(命中${closed.hit?.self === true ? '自身' : '遮挡'})` : closed.reason}`);
    after = await readShellModal(session);
    if (cleared(after)) return { needed: true, before, after, steps, via: `close#${attempt + 1}` };

    const next = await clickShellDialogButton(session, before.point, waitMs);
    steps.push(`next#${attempt + 1}:${next.ok === true ? `${next.picked?.strategy ?? '?'}=${JSON.stringify(next.picked?.labels ?? [])}(命中${next.hitSelf === true ? '自身' : '遮挡'})` : next.reason}`);
    after = await readShellModal(session);
    // 外壳是**一串**必答 Dialog（内测声明 → API Key → …）⇒ 清掉一个之后可能还有一个：继续循环。
    if (cleared(after)) return { needed: true, before, after, steps, via: `next#${attempt + 1}` };
    await sleep(waitMs);
    const stillMask = await readShellModal(session);
    if (stillMask?.maskPresent !== true) return { needed: true, before, after: stillMask, steps, via: `next#${attempt + 1}` };
  }
  const after = await readShellModal(session);
  return { needed: true, before, after, steps, via: null, reason: `外壳模态没被清掉（Escape / 关闭 / 对话框按钮 三轮共 ${attempts} 次都没生效）` };
}

/** 点一个工具栏动作（按 id 精确匹配，真鼠标）。 */
export async function pressEscape(session) {
  const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(700);
}

/**
 * 页面字节**身份**闸：从页面上拿本包模块的 URL（含 rev），**不带 token** 取一次字节，
 * ①查判据标记是否存在（老口径：防「旧字节 ⇒ 伪阴性」）；
 * ②**断言这份字节＝当前交付产物 `lib/client.js`**（老口径只要有标记就绿，旧 bundle 里
 *   恰好含标记就会**假绿** —— 标记串在每一版产物里都有，它证明不了「字节是当前这一版」）。
 * 读数是**纯只读**：只 fetch + 比字符串，不改页面状态。
 */
