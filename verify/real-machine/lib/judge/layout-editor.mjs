// lib/judge/layout-editor.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 布局编辑器读数（坞面板底部那一块）

import { sleep } from './base.mjs';

export const LAYOUT_EDITOR_FACTS_EXPR = `(() => {
  const panels = [...document.querySelectorAll('[data-guif-panel]')];
  const dockish = (node) => node.querySelector('[data-guif-dock-actions], [data-guif-dock-editor], [data-guif-dock-action]') !== null;
  const active = panels.find((node) => node.getAttribute('data-guif-active') === 'true') ?? null;
  const root = panels.find((node) => node === active && dockish(node)) ?? panels.find((node) => dockish(node)) ?? null;
  const q = (sel) => (root === null ? [] : [...root.querySelectorAll(sel)]);
  const editor = q('[data-guif-layout-editor]')[0] ?? null;
  const one = (sel) => (editor === null ? null : editor.querySelector(sel));
  const notice = one('[data-guif-layout-notice]');
  const status = one('[data-guif-layout-status]');
  const writableText = one('[data-guif-layout-writable]');
  return {
    panelId: root === null ? null : String(root.getAttribute('data-guif-panel')),
    panelActive: root === null ? null : String(root.getAttribute('data-guif-active')),
    editorPresent: editor !== null,
    overwriteCount: editor === null ? 0 : editor.querySelectorAll('[data-guif-layout-overwrite]').length,
    noticeAttr: notice === null ? null : String(notice.getAttribute('data-guif-layout-notice')),
    noticeText: notice === null ? null : (notice.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
    writableAttr: writableText === null ? null : String(writableText.getAttribute('data-guif-layout-writable')),
    statusText: status === null ? null : (status.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140),
    schemaAttr: editor === null ? null : String(editor.getAttribute('data-guif-layout-schema')),
    revAttr: editor === null ? null : String(editor.getAttribute('data-guif-layout-rev')),
    rows: q('[data-guif-layout-row]').map((e) => String(e.getAttribute('data-guif-layout-row'))),
    unknownAttr: q('[data-guif-layout-unknown-count]').length === 0 ? null : String(q('[data-guif-layout-unknown-count]')[0].getAttribute('data-guif-layout-unknown-count')),
    // 全页计数（防「坞面板里没有、别处有」被误读成「动作不存在」）
    overwritePage: document.querySelectorAll('[data-guif-layout-overwrite]').length,
    noticePage: document.querySelectorAll('[data-guif-layout-notice]').length,
    editorPage: document.querySelectorAll('[data-guif-layout-editor]').length,
    bodyHead: (root === null ? '' : (root.innerText || '')).replace(/\\s+/g, ' ').trim().slice(0, 240),
  };
})()`;

/** 采一次坞面板布局编辑器的读数。 */
export async function readLayoutEditorFacts(session) {
  return session.evaluate(LAYOUT_EDITOR_FACTS_EXPR);
}

/** 有界等待「坞面板里的编辑器就绪」（载荷状态要等载入屏障走完才定型）。 */
export async function waitLayoutEditor(session, { timeoutMs = 12000, gapMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const samples = [];
  let last = null;
  while (Date.now() < deadline) {
    last = await readLayoutEditorFacts(session);
    samples.push({
      present: last?.editorPresent ?? null,
      writable: last?.writableAttr ?? null,
      rows: (last?.rows ?? []).length,
      overwrite: last?.overwriteCount ?? null,
      status: last?.statusText ?? null,
    });
    if (last !== null && last.editorPresent === true) return { facts: last, ready: true, samples: samples.slice(-3) };
    await sleep(gapMs);
  }
  return { facts: last, ready: false, samples: samples.slice(-5) };
}

/** 按一次真实 Escape（走 CDP Input，比 JS 造事件更接近真机）。 */
