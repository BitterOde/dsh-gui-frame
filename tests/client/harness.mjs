/**
 * harness.mjs —— **入口坞 + 面板骨架**独立复验自备的判据与夹具。
 *
 * 【独立性纪律】
 *   - **不 import** `tests/unit/**`（实现方测试）与 `tests/helpers/**`；
 *   - 不 import 任何 `tests/unit/dock-fixtures.mjs` 之类的替身 —— 本文件自建：
 *     `createCtx()`（最小 Cordis ctx）、`createSlotsService()`（**带声明的** slots 替身，直接 register
 *     未声明的槽位会同步抛，这正是「必须走 inject」的机制来源）、`createLayoutService()`（官方
 *     `selectPanel` / `hasMainPanel` 语义的替身）、`createPrimitivesStub()`（官方 primitives 子集替身）。
 *   - React 一律用**真的**（devDependency `react@19`）：元素树可被本文件的遍历器逐节点检查，
 *     L4 用例再用 `jsdom` + `@testing-library/react` 真渲染（见 `l4-real-react.test.mjs`）。
 *
 * 【只读】本目录不写包内任何文件。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url)); // tests/client
export const PKG_DIR = path.resolve(HERE, '..', '..');

/** `src/` 下的路径。 */
export function srcPath(...parts) {
  return path.join(PKG_DIR, 'src', ...parts);
}

/** 动态 import 一个包内 ESM 源文件。 */
export function loadSource(rel) {
  return import(pathToFileURL(srcPath(...rel.split('/'))).href);
}

/** 真 React（devDependency `react@19`；CJS 互操作下 default 是 React 对象本体）。 */
export async function loadRealReact() {
  const ns = await import('react');
  return ns.default ?? ns;
}

/** 读源码文本（默认剥掉块注释与整行行注释 —— 注释里的示例不该被当成代码判违规）。 */
export function readSourceText(file, { stripComments = true } = {}) {
  const text = readFileSync(file, 'utf8');
  if (!stripComments) return text;
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 一、最小 Cordis ctx（自备；不借 tests/helpers/fake-ctx.mjs）
// ═══════════════════════════════════════════════════════════════════════════════════════════

export function createCtx({ services = {}, label = 'ctx' } = {}) {
  const provided = new Map();
  const effects = [];
  const logs = [];
  const events = new Map();
  const calls = { get: 0, provide: 0, effect: 0 };
  const logger = Object.assign(() => logger, {
    error: (message) => logs.push({ level: 'error', message: String(message) }),
    info: (message) => logs.push({ level: 'info', message: String(message) }),
    warn: (message) => logs.push({ level: 'warn', message: String(message) }),
    debug: (message) => logs.push({ level: 'debug', message: String(message) }),
  });
  const ctx = {
    label,
    services,
    provided,
    effects,
    logs,
    calls,
    logger,
    get(name) {
      calls.get += 1;
      return provided.has(name) ? provided.get(name) : services[name];
    },
    provide(name, value) {
      calls.provide += 1;
      provided.set(name, value);
      return () => {
        if (provided.get(name) === value) provided.delete(name);
      };
    },
    effect(install, effectLabel) {
      calls.effect += 1;
      const cleanup = install();
      const record = { label: effectLabel, cleanup, active: true };
      effects.push(record);
      return () => {
        if (!record.active) return;
        record.active = false;
        if (typeof cleanup === 'function') cleanup();
      };
    },
    on(name, handler) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(handler);
      return () => events.get(name).delete(handler);
    },
    emit(name, ...args) {
      for (const handler of [...(events.get(name) ?? [])]) handler(...args);
    },
    activeEffects() {
      return effects.filter((record) => record.active);
    },
    unload() {
      for (const record of [...effects].reverse()) {
        if (!record.active) continue;
        record.active = false;
        if (typeof record.cleanup === 'function') record.cleanup();
      }
    },
  };
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 二、slots 替身（**带声明语义**：直接 register 未声明的槽位 ⇒ 同步抛；inject ⇒ 挂起/就位）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * 官方 `SlotCore` 的关键语义（实读官方产物后写进 `dock.mjs` 文件头，本替身按同一口径自建）：
 *   - `register` 到**未声明**的槽位 ⇒ 同步抛 `slot "X" is not declared`；
 *   - `inject(key, fn)`：已声明 ⇒ **同步**跑 `fn`；未声明 ⇒ 挂起，声明后自动跑（collapse 后再次声明会重跑）；
 *   - `entries(key)` / `entriesOfSlot(key)`：实时读数（dock 的 live() 只用这两个）。
 */
export function createSlotsService() {
  const declared = new Set();
  const rows = new Map(); // key -> [{options, Component}]
  const pending = new Map(); // key -> [fn]
  const listeners = new Map(); // key -> Set<fn>
  const calls = { declare: [], register: [], inject: [] };

  const listOf = (key) => {
    if (!rows.has(key)) rows.set(key, []);
    return rows.get(key);
  };
  const notify = (key) => {
    for (const fn of [...(listeners.get(key) ?? [])]) fn();
  };

  const service = {
    /** 测试夹具专用：模拟官方 owner 把座位声明出来（真实环境里由 sidebar / layout 包声明）。 */
    declare(key) {
      calls.declare.push(key);
      if (declared.has(key)) return () => {};
      declared.add(key);
      const queue = pending.get(key) ?? [];
      pending.set(key, []);
      for (const fn of queue) fn();
      notify(key);
      return () => {};
    },
    isDeclared: (key) => declared.has(key),
    /** 直接注册：未声明 ⇒ 同步抛（**这是「必须走 inject」的机制来源**）。 */
    register(options, Component) {
      const key = options?.name;
      calls.register.push({ key, options, Component });
      if (!declared.has(key)) throw new Error(`slot "${key}" is not declared`);
      listOf(key).push({ options, Component });
      notify(key);
      return () => {
        const list = listOf(key);
        const index = list.findIndex((row) => row.options === options);
        if (index >= 0) list.splice(index, 1);
        notify(key);
      };
    },
    inject(key, fn) {
      calls.inject.push(key);
      if (declared.has(key)) {
        const off = fn();
        return typeof off === 'function' ? off : () => {};
      }
      const queue = pending.get(key) ?? [];
      queue.push(fn);
      pending.set(key, queue);
      return () => {
        const q = pending.get(key) ?? [];
        const index = q.indexOf(fn);
        if (index >= 0) q.splice(index, 1);
      };
    },
    entries(key) {
      return listOf(key).map((row) => ({ options: row.options, Component: row.Component }));
    },
    entriesOfSlot(key) {
      return service.entries(key);
    },
    subscribe(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => listeners.get(key).delete(fn);
    },
    // ── 观测面（判据用）────────────────────────────────────────────────────────────────
    calls,
    rows,
    pendingCount(key) {
      return (pending.get(key) ?? []).length;
    },
  };
  return service;
}

/**
 * 官方 layout 的 `selectPanel` / `hasMainPanel` 语义替身（依据 dock.mjs 文件头引用的官方实现：
 * `hasMainPanel = (id) => ctx.slots.entries('main').some((entry) => entry.options.key === id)`；
 * `selectPanel(id)` 在 `id !== null && !hasMainPanel(id)` 时抛错）。
 */
export function createLayoutService(slots) {
  let activePanelId = null;
  const calls = [];
  return {
    calls,
    get activePanelId() {
      return activePanelId;
    },
    hasMainPanel(id) {
      return slots.entries('main').some((entry) => entry.options.key === id);
    },
    selectPanel(id) {
      calls.push(id);
      if (id !== null && !this.hasMainPanel(id)) {
        throw new Error(`layout.selectPanel: main panel "${id}" is not registered`);
      }
      activePanelId = id;
      return true;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 三、primitives 替身（只给官方 106 成员里的那 8 个；每个都返回**真 React 元素**）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * 替身**不撒谎**：`PRIMITIVES_USED` 之外的成员一个都不给（`createPrimitivesSeat` 的 `get()` 对
 * 未知名字直接抛，所以本替身的键必须落在官方 106 成员表内）。
 */
export function createPrimitivesStub(react) {
  const el = react.createElement;
  const icon = (name) => function IconStub(props) {
    return el('svg', { 'data-primitive': name, width: props?.size ?? 16, height: props?.size ?? 16 });
  };
  // 替身要像真原子：**透传**数据属性（否则壳写在上面的机检锚点会被替身吃掉，
  // 判据就会变成「测替身」而不是「测壳」）。
  const passthrough = (props, skip) => {
    const out = {};
    for (const [key, value] of Object.entries(props ?? {})) {
      if (skip.includes(key) || key === 'children') continue;
      out[key] = value;
    }
    return out;
  };
  return {
    Button: function ButtonStub(props) {
      return el('button', { type: 'button', ...passthrough(props, ['icon']), 'data-primitive': 'Button' }, props?.icon ?? null, props?.children ?? null);
    },
    Tooltip: function TooltipStub(props) {
      return el('span', { 'data-primitive': 'Tooltip', title: typeof props?.label === 'string' ? props.label : undefined }, props?.children ?? null);
    },
    Tag: function TagStub(props) {
      return el('span', { ...passthrough(props, []), 'data-primitive': 'Tag' }, props?.children ?? null);
    },
    IconChevronRightOutlineRegular: icon('IconChevronRightOutlineRegular'),
    IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
    IconLoadingOutlineRegular: icon('IconLoadingOutlineRegular'),
    IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
    IconWarningOutlineRegular: icon('IconWarningOutlineRegular'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 四、无 DOM 的元素树遍历（真 React 元素对象；不碰 window/document）
// ═══════════════════════════════════════════════════════════════════════════════════════════

export function walkElements(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const item of node) walkElements(item, visit);
    return;
  }
  if (typeof node !== 'object' || node.$$typeof === undefined) return;
  visit(node);
  walkElements(node?.props?.children, visit);
}

/** 收集树里所有宿主元素 + 组件节点的 props 谓词命中项。 */
export function collect(node, predicate) {
  const hits = [];
  walkElements(node, (element) => {
    if (predicate(element)) hits.push(element);
  });
  return hits;
}

/** 取元素树的纯文本（字符串子节点按顺序拼接）。 */
export function treeText(node) {
  const parts = [];
  const walk = (value) => {
    if (value === null || value === undefined || typeof value === 'boolean') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (typeof value === 'object' && value.$$typeof !== undefined) walk(value?.props?.children);
  };
  walk(node);
  return parts.join('');
}

/** 按锚点属性取值找节点（如 `findByAttr(tree, 'data-guif-state', 'loading')`）。 */
export function findByAttr(node, attr, value) {
  return collect(node, (element) => element?.props?.[attr] === value);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 五、样式判据（无硬编码颜色；CSS 变量必须落在白名单里）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 颜色字面量的形态（十六进制 / rgb(a) / hsl(a) / 具名色）。 */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const FUNC_COLOR = /\b(?:rgba?|hsla?|color-mix|oklch|lab)\s*\(/;
const NAMED_COLORS = /\b(?:red|blue|green|black|white|gray|grey|orange|purple|pink|yellow|brown|cyan|magenta|lime|navy|teal|maroon|olive|silver|aqua|fuchsia)\b/i;

/** 逐个字符串值检查：颜色必须是 var(...) 引用，不能是字面量。 */
export function colorOffenders(styles, trail = 'styles') {
  const offenders = [];
  const walk = (value, at) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (HEX_COLOR.test(value)) offenders.push(`${at} = ${JSON.stringify(value)}（十六进制颜色）`);
      if (FUNC_COLOR.test(value)) offenders.push(`${at} = ${JSON.stringify(value)}（颜色函数）`);
      if (NAMED_COLORS.test(value) && !value.includes('var(')) offenders.push(`${at} = ${JSON.stringify(value)}（具名色）`);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) walk(item, `${at}.${key}`);
  };
  walk(styles, trail);
  return offenders;
}

/** 提取一个字符串里所有 `var(--xxx` 的变量名（去重）。 */
export function cssVarNames(text) {
  if (typeof text !== 'string') return [];
  return [...new Set([...text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((match) => match[1]))];
}

/** 递归展开样式表里所有字符串值（[{path, value}]）。 */
export function flattenStyles(styles, trail = 'styles', out = []) {
  if (styles === null || styles === undefined) return out;
  if (typeof styles === 'string') {
    out.push({ path: trail, value: styles });
    return out;
  }
  if (typeof styles !== 'object') return out;
  for (const [key, value] of Object.entries(styles)) flattenStyles(value, `${trail}.${key}`, out);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 六、jsdom 环境（L4 真渲染用；**只装在 globalThis 上**，不改任何包内文件）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 把 jsdom 的 window/document 等装进 globalThis（Node 内置 navigator 是 getter，用 defineProperty）。 */
export function installDom(dom) {
  const win = dom.window;
  const define = (name, value) => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
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
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return win;
}
