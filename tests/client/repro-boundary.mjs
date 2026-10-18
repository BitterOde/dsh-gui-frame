/**
 * 最小复现（四分支）：定位「子树抛错时错误态没出现」的**根因**。
 *   A. 边界 + 简单 fallback（不渲染 children）      → 期望：渲染出 fallback
 *   B. 边界 + fallback 里再渲染同一个抛错子节点     → 期望：错误逃逸（说明 fallback 自己炸了）
 *   C. 真路径：Panel 包一个抛错子组件               → 期望：渲染出壳错误态
 *   D. 修复方向：fallback 用 ErrorState、不带 children → 期望：错误态正常渲染
 * 用法：node tests/client/repro-boundary.mjs
 *
 * 【四分支各证什么】面板壳错误边界接不住子树抛错时实测：A=caught、**B/C=uncaught 且 DOM 空**、
 * D=caught；边界修好后**四分支全部 caught 且 DOM 非空**。结案记录在 `tests/client/` 目录里（`结案记录-*.md`）。
 */
import { createPrimitivesStub, installDom, loadRealReact, loadSource } from './harness.mjs';

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
installDom(dom);

const react = await loadRealReact();
const { createRoot } = await import('react-dom/client');
const { createRenderBoundary } = await loadSource('client/panel/boundary.mjs');
const { createPanelComponents } = await loadSource('client/panel/index.mjs');

const Boundary = createRenderBoundary(react);
const el = react.createElement;

function Boom() {
  throw new Error('REPRO-子树抛错');
}

async function mount(node) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const events = [];
  const root = createRoot(container, {
    onCaughtError: (error) => events.push(`caught:${error?.message}`),
    onUncaughtError: (error) => events.push(`uncaught:${error?.message}`),
  });
  const original = console.error;
  console.error = () => {};
  try {
    root.render(node);
    await new Promise((resolve) => setTimeout(resolve, 40));
  } catch (error) {
    events.push(`threw:${error?.message}`);
  } finally {
    console.error = original;
  }
  return { text: container.textContent.slice(0, 80), html: container.innerHTML.slice(0, 160), events };
}

// A：边界 + 简单 fallback
const a = await mount(el(Boundary, {
  onError: (error) => {},
  renderError: (error) => el('div', { 'data-repro': 'fallback' }, `A-兜底：${error.message}`),
}, el(Boom)));
console.log('A 简单 fallback        →', JSON.stringify(a));

// B：边界 + fallback 里再渲染同一个抛错子节点（= Panel 那条 `errorView({...props, error})` 的形态）
const child = el(Boom);
const b = await mount(el(Boundary, {
  renderError: (error) => el('div', { 'data-repro': 'fallback' }, `B-兜底：${error.message}`, child),
}, child));
console.log('B fallback 再渲染 children →', JSON.stringify(b));

// C：真路径 Panel（children 抛错）
const comps = createPanelComponents({ seeds: { react, primitives: createPrimitivesStub(react) }, note: () => {} });
const c = await mount(el(comps.Panel, { id: 'repro' }, el(Boom)));
console.log('C 真路径 <Panel><Boom/>  →', JSON.stringify(c));

// D：**修复方向验证** —— 用同一套组件的边界 + ErrorState 造的 fallback（不渲染抛错的 children）
const d = await mount(el(comps.boundary, {
  onError: () => {},
  renderError: (error) => comps.ErrorState({ error }),
}, el(Boom)));
console.log('D 修复方向（fallback 用 ErrorState、不带 children）→', JSON.stringify(d));

dom.window.close();
