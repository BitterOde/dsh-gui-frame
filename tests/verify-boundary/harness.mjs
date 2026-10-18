/**
 * harness.mjs —— 第二轮独立复核（面板壳错误边界）**自备**的夹具与加载器。
 *
 * 【独立性纪律】
 *   - **不 import** `tests/client/**`、`tests/unit/**`、`tests/helpers/**` —— 判据、DOM 夹具、
 *     primitives 替身全部在本文件里自建；
 *   - 只 import **被测源码**（`src/**`，只读）与**真第三方依赖**（`react@19` / `react-dom` / `jsdom`）；
 *   - 不写包内任何文件（TEMP 副本由反假绿测试自建）。
 *
 * 【源头可换】`GUIF_VERIFY_ROOT` 环境变量可把「被测源码根」指向另一棵树（反假绿测试用它加载
 * TEMP 里的变异副本）；默认是本包根。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.resolve(HERE, '..', '..');
/** 被测源码根（默认本包；反假绿时指向 TEMP 变异副本）。 */
export const ROOT = process.env.GUIF_VERIFY_ROOT
  ? path.resolve(process.env.GUIF_VERIFY_ROOT)
  : PKG_DIR;

/** 动态 import 被测源码（`src/<rel>`）。 */
export function loadSource(rel) {
  return import(pathToFileURL(path.join(ROOT, 'src', ...rel.split('/'))).href);
}

/**
 * 读被测源码文本（可选剥注释：注释里的示例不该被判违规）。
 *
 * ★ 面板壳已拆成 `panel/components.mjs` + `panel/components/{views,shell}.mjs`
 *   ⇒ 落到 `client/panel/components.mjs` 这个**入口路径**上的扫描面，按**并集**读
 *   （断言与锚点不随拆件改动，只是扫描面跟着实现走；否则拆件会让一批判据静默空转）。
 */
const SOURCE_UNION = Object.freeze({
  'client/panel/components.mjs': ['client/panel/components.mjs', 'client/panel/components/views.mjs', 'client/panel/components/shell.mjs'],
});

export function readSourceText(rel, { stripComments = true } = {}) {
  const parts = SOURCE_UNION[rel] ?? [rel];
  const text = parts.map((one) => readFileSync(path.join(ROOT, 'src', ...one.split('/')), 'utf8')).join('\n');
  if (!stripComments) return text;
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 真 React（devDependency `react@19`；CJS 互操作下 default 是 React 本体）。 */
export async function loadReact() {
  const ns = await import('react');
  return ns.default ?? ns;
}

/**
 * 安全读错误文案：有一条用例故意把 `message`/`toString` 做成会抛的取值，
 * 判据自己绝不能因此炸掉。
 */
export function safeMessage(error) {
  try {
    if (typeof error === 'string') return error;
    if (error === null || error === undefined) return String(error);
    if (typeof error.message === 'string') return error.message;
    return String(error);
  } catch {
    return '（错误值不可读）';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// jsdom 环境（只装 globalThis）
// ═══════════════════════════════════════════════════════════════════════════════════════════

export async function setupDom() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const win = dom.window;
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('HTMLElement', win.HTMLElement);
  define('Element', win.Element);
  define('Node', win.Node);
  define('Event', win.Event);
  define('MouseEvent', win.MouseEvent);
  define('requestAnimationFrame', win.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 0)));
  define('cancelAnimationFrame', win.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id)));
  define('getComputedStyle', win.getComputedStyle.bind(win));
  // 故意设 false：本套用例不走 act()，设 true 会让 React 打一堆 act 警告掩盖真信号。
  define('IS_REACT_ACT_ENVIRONMENT', false);
  return dom;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// primitives 替身（只给 `PRIMITIVES_USED` 的 8 个；每个都返回**真 React 元素**）
// ═══════════════════════════════════════════════════════════════════════════════════════════

export function createPrimitivesStub(react) {
  const el = react.createElement;
  const passthrough = (props, skip = []) => {
    const out = {};
    for (const [key, value] of Object.entries(props ?? {})) {
      if (skip.includes(key) || key === 'children') continue;
      out[key] = value;
    }
    return out;
  };
  const icon = (name) => function IconStub(props) {
    return el('svg', { 'data-primitive': name, width: props?.size ?? 16, height: props?.size ?? 16 });
  };
  return {
    // 透传数据属性：壳写在原子上的机检锚点不能被替身吃掉（否则判据变成「测替身」）
    Button: function ButtonStub(props) {
      return el('button', { type: 'button', ...passthrough(props, ['icon']), 'data-primitive': 'Button' },
        props?.icon ?? null, props?.children ?? null);
    },
    Tooltip: function TooltipStub(props) {
      return el('span', { 'data-primitive': 'Tooltip', title: typeof props?.label === 'string' ? props.label : undefined },
        props?.children ?? null);
    },
    Tag: function TagStub(props) {
      return el('span', { ...passthrough(props), 'data-primitive': 'Tag' }, props?.children ?? null);
    },
    IconChevronRightOutlineRegular: icon('IconChevronRightOutlineRegular'),
    IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
    IconLoadingOutlineRegular: icon('IconLoadingOutlineRegular'),
    IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
    IconWarningOutlineRegular: icon('IconWarningOutlineRegular'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 挂载（真 React + 真 react-dom/client；错误回调把「谁接住了」记成事件流）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** DOM 锚点（与被测壳的公开锚点一致；写死在这里＝判据不依赖被测方的常量导出）。 */
export const ANCHOR = Object.freeze({
  panel: 'data-guif-panel',
  panelHeader: 'data-guif-panel-header',
  panelBody: 'data-guif-panel-body',
  state: 'data-guif-state',
  boundary: 'data-guif-boundary',
  minimal: 'minimal',
  errorState: 'error',
});

/**
 * 挂载一个元素树并等它稳定。
 * @param {object} react 真 React
 * @param {object} node React 元素
 * @param {{settleMs?:number}} [options]
 * @returns {Promise<object>} `{ html, text, events, threw, container }`
 */
export async function mountNode(react, node, { settleMs = 60 } = {}) {
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');
  container.setAttribute('data-verify-root', '1');
  document.body.appendChild(container);
  const events = [];
  const root = createRoot(container, {
    onCaughtError: (error) => events.push({ kind: 'caught', message: safeMessage(error) }),
    onUncaughtError: (error) => events.push({ kind: 'uncaught', message: safeMessage(error) }),
    onRecoverableError: (error) => events.push({ kind: 'recoverable', message: safeMessage(error) }),
  });
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let threw = null;
  try {
    root.render(node);
  } catch (error) {
    threw = safeMessage(error);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    console.error = originalError;
    console.warn = originalWarn;
  }
  return {
    html: container.innerHTML,
    text: container.textContent,
    events,
    threw,
    container,
    query: (selector) => container.querySelector(selector),
    queryAll: (selector) => [...container.querySelectorAll(selector)],
    dispose: () => root.unmount(),
  };
}

/** 有无「逃逸」：React 未接住（onUncaughtError）或 render() 直接抛出。 */
export function escaped(result) {
  const uncaught = result.events.filter((event) => event.kind === 'uncaught');
  return {
    escaped: uncaught.length > 0 || result.threw !== null,
    uncaught: uncaught.map((event) => event.message),
    threw: result.threw,
  };
}

/** 面板树是否还在（未被整体卸载）。 */
export function panelAlive(result, id) {
  const panel = result.query(`[${ANCHOR.panel}="${id}"]`);
  if (panel === null) return { alive: false, reason: '找不到面板根' };
  const header = panel.querySelector(`[${ANCHOR.panelHeader}="${id}"]`);
  const body = panel.querySelector(`[${ANCHOR.panelBody}="${id}"]`);
  const stateNode = panel.querySelector(`[${ANCHOR.state}="${ANCHOR.errorState}"]`);
  return {
    alive: true,
    header: header !== null,
    body: body !== null,
    errorInsidePanel: stateNode !== null,
    html: panel.outerHTML.slice(0, 200),
  };
}
