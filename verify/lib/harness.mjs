/**
 * harness.mjs —— **verify 命名空间自备夹具**（端到端集成复验用）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【独立性纪律】（与 `tests/client/harness.mjs`、`tests/verify-<组>/harness.mjs` 同一口径）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   - **不 import 任何 `tests/**` 的夹具**（那是各任务实现方/复核方自己的替身）；
 *   - React 一律用**真的**（devDependency `react@19` + `react-dom@19`）；
 *   - DOM 用**真的** jsdom（dev-only），装到 `globalThis` 上；
 *   - 端到端主体走**真产物** `lib/client.js`（classic script + `window.__ModuleLoader__`），
 *     而不是 `src/**` —— 交付给用户的是产物，产物自洽才是集成结论。
 *
 * 【本文件只读包内文件，绝不写盘】
 *
 * 依赖缺口（如实记账，写进验收记录）：
 *   `@deepseek-ai/dsh-client-{store,ui-primitives,ui-slots,ui-dockkit}` 在本机 node_modules 里
 *   **不存在**（只有 `cordis` 有 junction）⇒ 这四个种子由本文件的替身提供；真种子只能在真机上验。
 *   替身**不撒谎**：成员名与官方 primitives 成员表**逐名对齐**（取本文件 `PRIMITIVES_USED` 声明的那些；
 *   官方表的规模与这里的条数都不在本行写死 —— 要现值看常量与平台产物）。
 */
// ★ 几何件改由**同目录夹具**提供（`./geometry-fixture.mjs`）。
//   原来 import `src/client/window/geometry.mjs` —— v1 已裁 `window/**`，生产侧另一个消费者
//   `kit/gesture.mjs` 也随浮窗一起删；夹具自足即可，顺带解掉「verify 装置延长 src 存活期」。
import { DRAG_THRESHOLD, FLOAT_DEFAULT_SIZE, FLOAT_MIN_SIZE, floatRectAt, movedRect, passedThreshold, resizedRect } from './geometry-fixture.mjs';
export { DRAG_THRESHOLD, FLOAT_DEFAULT_SIZE, FLOAT_MIN_SIZE, floatRectAt, movedRect, passedThreshold, resizedRect };
// ★ **真源取面**（路径 / 存在性 / 装载护栏 / 从源码派生的刻度）搬到同目录 `source-face.mjs`
//   —— 本文件装上那一层护栏后涨到 625 行，越过「非 `src` 面单文件 ≤600 行」硬上限
//   （门禁与本目录的同名自检会同时判红）。这里对历史 import 面**原样转出**：
//   `../lib/harness.mjs` 的消费者一个字都不用改；护栏为什么必要见 `source-face.mjs` 文件头。
export { CONSUMED_SLOT_KEYS, EXPECTED_CAPABILITY_ORDER, EXPECTED_ENV_KEYS, HERE, PKG_DIR, VERIFY_DIR, loadSource, pkgPath, readText, sourceExists } from './source-face.mjs';
import { CONSUMED_SLOT_KEYS, readText } from './source-face.mjs';

/** 真 React（CJS 互操作下 `default` 是 React 对象本体）。 */
export async function loadRealReact() {
  const ns = await import('react');
  return ns.default ?? ns;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 一、真产物装载（classic script 语义：顶层唯一副作用 = window.__ModuleLoader__.load）
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * 把 `lib/client.js` 当**经典脚本**跑一遍，取出 `{ id, factory }`，再用 `require` 替身
 * 把**种子表**注入 `factory` —— 这就是外壳 `__ModuleLoader__` 在真机上做的事。
 * ⚠ 键名与**条数以构建器的 `SEED_DECLARATIONS` 为准**，此处不复述数字（加第 9 个种子即漂）。
 *
 * @param {Record<string, unknown>} seeds 全名（`react` / `react/jsx-runtime` / `react-dom` / …）
 * @returns {{id:string, mod:{apply:Function, inject:unknown[], __internals:object},
 *   required:string[], source:string, bytes:number}}
 */
export function loadArtifact(seeds) {
  const source = readText('lib', 'client.js');
  const loaded = [];
  const windowLike = {
    __ModuleLoader__: {
      load(entry) {
        loaded.push(entry);
      },
    },
  };
  // eslint-disable-next-line no-new-func —— 经典脚本语义（非 ESM）：只能这么跑
  const run = new Function('window', source);
  run(windowLike);
  if (loaded.length !== 1) {
    throw new Error(`[verify] 产物应当恰好调用一次 __ModuleLoader__.load（实测 ${loaded.length} 次）`);
  }
  const entry = loaded[0];
  const required = [];
  const requireShim = (name) => {
    required.push(name);
    if (!(name in seeds)) throw new Error(`[verify] 产物 require 了未声明的种子「${name}」`);
    return seeds[name];
  };
  const mod = entry.factory(requireShim);
  return { id: entry.id, mod, required, source, bytes: Buffer.byteLength(source, 'utf8') };
}

/** 产物里的静态 `require("…")` 全名清单（去重、保持出现顺序）——种子白名单核对用。 */
export function staticRequiresOf(source) {
  const names = [];
  for (const match of source.matchAll(/require\("([^"]+)"\)/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 二、最小 Cordis ctx（自备替身：只实现本包真实用到的面）
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * 最小 Cordis ctx：`get / provide / effect / on / emit / logger`。
 * `effect` 会把 `label` 记进**有序时间线**（`effectLabels`）—— 装配顺序的独立信号就从这里来。
 */
export function createCtx({ services = {}, label = 'verify-root' } = {}) {
  const provided = new Map();
  const effects = [];
  const effectLabels = [];
  const events = new Map();
  const logs = [];
  const calls = { get: 0, provide: 0, effect: 0 };
  let effectSeq = 0;

  const logger = Object.assign(() => logger, {
    error: (message) => logs.push({ level: 'error', message: String(message) }),
    info: (message) => logs.push({ level: 'info', message: String(message) }),
    warn: (message) => logs.push({ level: 'warn', message: String(message) }),
    debug: (message) => logs.push({ level: 'debug', message: String(message) }),
  });

  const ctx = {
    label,
    provided,
    effects,
    effectLabels,
    logs,
    calls,
    logger,
    get(name) {
      calls.get += 1;
      return provided.has(name) ? provided.get(name) : services[name];
    },    provide(name, value) {
      calls.provide += 1;
      provided.set(name, value);
      // 真 Cordis 里 provide 出来的服务同时可从 `ctx.<name>` 取（本包用得到：overlay 读 `ctx.slots`）
      if (!(name in ctx)) Object.defineProperty(ctx, name, { value, configurable: true, writable: true });
      return () => {
        if (provided.get(name) === value) {
          provided.delete(name);
          if (ctx[name] === value) delete ctx[name];
        }
      };
    },
    effect(install, effectLabel) {
      calls.effect += 1;
      const cleanup = install();
      effectSeq += 1;
      const record = { label: effectLabel, cleanup, active: true, seq: effectSeq };
      effects.push(record);
      effectLabels.push(String(effectLabel));
      return () => {
        if (!record.active) return;
        record.active = false;
        if (typeof cleanup === 'function') cleanup();
      };
    },
    on(name, handler) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(handler);
      return () => events.get(name)?.delete(handler);
    },
    emit(name, ...args) {
      for (const handler of [...(events.get(name) ?? [])]) handler(...args);
    },
    activeEffects() {
      return effects.filter((record) => record.active);
    },
    /** 卸载：逆序跑 cleanup（与 Cordis fiber 卸载同向）。 */
    unload() {
      for (const record of [...effects].reverse()) {
        if (!record.active) continue;
        record.active = false;
        if (typeof record.cleanup === 'function') record.cleanup();
      }
    },
  };
  // 真 Cordis 的 ctx 既能 `ctx.get(name)` 也能直接 `ctx.<name>` 取服务（overlay 读的是 `ctx.slots`）
  for (const [name, value] of Object.entries(services)) {
    if (value === undefined || name in ctx) continue;
    Object.defineProperty(ctx, name, { value, configurable: true, writable: true });
  }
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 三、slots 替身（**带声明语义**：直接 register 未声明的槽位 ⇒ 同步抛）
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * 外壳在真机上会声明出来的座位。
 *
 * ★ **从 `CONSUMED_SLOT_KEYS` 派生**，不再抄 v2 的字面量。
 * v2 那份还含 `shell.overlay`（浮层自注册的座位）与 `settings.general.item`（设置页那一行，
 * 随工作台开关一起被裁）——两者在 v1 都不注册。派生式写法同时消掉「改了声明表、夹具不跟」的静默漂移。
 */
export const DECLARED_SLOTS = Object.freeze([...CONSUMED_SLOT_KEYS, 'shell.overlay']);

export function createSlots({ declared = DECLARED_SLOTS } = {}) {
  const declaredSet = new Set(declared);
  const rows = new Map();
  const pending = new Map();
  const listeners = new Map();
  const calls = { declare: [], register: [], inject: [] };

  const listOf = (key) => {
    if (!rows.has(key)) rows.set(key, []);
    return rows.get(key);
  };
  const notify = (key) => {
    for (const fn of [...(listeners.get(key) ?? [])]) fn();
  };

  const service = {
    /** 夹具专用：模拟外壳 owner 声明座位（真机上由 sidebar / layout 包声明）。 */
    declare(key) {
      calls.declare.push(key);
      if (declaredSet.has(key)) return () => {};
      declaredSet.add(key);
      const queue = pending.get(key) ?? [];
      pending.set(key, []);
      for (const fn of queue) fn();
      notify(key);
      return () => {};
    },
    isDeclared: (key) => declaredSet.has(key),
    /** 直接注册到未声明座位 ⇒ 同步抛（这是「必须走 inject」的机制来源）。 */
    register(options, Component) {
      const key = options?.name;
      calls.register.push({ key, options, Component });
      if (!declaredSet.has(key)) throw new Error(`slot "${key}" is not declared`);
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
      if (declaredSet.has(key)) {
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
      return () => listeners.get(key)?.delete(fn);
    },
    calls,
    rows,
    pendingCount: (key) => (pending.get(key) ?? []).length,
  };
  return service;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 四、settingsScope 替身（官方客户端 bind({namespace}) 的语义子集）
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * `ctx.settingsScope.bind({namespace})` → 作用域；快照形状按平台的消费面实读：
 * `{ status:'ready', mode:'host', writable, revision, value }`，写入走 `set(field, payload)`。
 */
export function createSettingsScope({ initial = null, mode = 'host', writable = true, status = 'ready' } = {}) {
  const calls = { bind: [], getSnapshot: 0, set: [] };
  let value = initial;
  let revision = 0;
  const scope = {
    getSnapshot() {
      calls.getSnapshot += 1;
      return { status, mode, writable, revision, value };
    },
    set(field, next) {
      calls.set.push({ field, value: next, revision });
      value = value === null || typeof value !== 'object' ? { [field]: next } : { ...value, [field]: next };
      revision += 1;
      return true;
    },
  };
  return {
    calls,
    /** 官方签名：`bind({ namespace })`（本包只 bind 一次 `gui-frame`）。 */
    bind(options) {
      calls.bind.push(options);
      return scope;
    },
    scope,
    read: () => ({ value, revision }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 五、connection 替身（数据通道的宿主半边：`ctx.connection`）
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * @param {Function|object} reply `(endpoint, payload) => result` 或固定 result
 *   result 形状＝官方 `{ ok, value, warnings, changed, rev, undoToken, error }`
 */
export function createConnection(reply) {
  const calls = { rpc: [], fetchRegister: [], fetchRoutes: [] };
  return {
    calls,
    rpc: {
      async call(pathName, endpoint, payload, signal) {
        calls.rpc.push({ pathName, endpoint, payload, signal: signal === undefined ? null : signal });
        return typeof reply === 'function' ? reply(endpoint, payload) : reply;
      },
    },
    fetch: {
      register(spec) {
        calls.fetchRegister.push(spec);
        calls.fetchRoutes.push(spec?.path);
        return spec;
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 六、primitives 替身（严格取 `PRIMITIVES_USED` 声明的成员，**条数以该常量为准**、本处不写死；每个都返回**真 React 元素**）
// ═══════════════════════════════════════════════════════════════════════════════════════

export const PRIMITIVES_USED = Object.freeze([
  'Button',
  'IconChevronRightOutlineRegular',
  'IconCloseOutlineRegular',
  'IconLoadingOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconWarningOutlineRegular',
  'Tag',
  'Tooltip',
]);

export function createPrimitivesStub(react) {
  const el = react.createElement;
  const icon = (name) => function IconStub(props) {
    return el('svg', { 'data-primitive': name, width: props?.size ?? 16, height: props?.size ?? 16 });
  };
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// 七、jsdom 环境（L4 真渲染用；只装 globalThis，不改包内文件）
// ═══════════════════════════════════════════════════════════════════════════════════════

export async function makeDom(html = '<!doctype html><html><body><div id="root"></div></body></html>') {
  const { JSDOM } = await import('jsdom');
  return new JSDOM(html, { pretendToBeVisual: true, url: 'http://127.0.0.1:3080/' });
}

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
  define('KeyboardEvent', win.KeyboardEvent);
  define('MouseEvent', win.MouseEvent);
  define('PointerEvent', win.PointerEvent ?? win.MouseEvent);
  define('ResizeObserver', win.ResizeObserver ?? undefined);
  define('requestAnimationFrame', win.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 0)));
  define('cancelAnimationFrame', win.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id)));
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return win;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 八、装配驱动（**走真产物**：`mod.apply(ctx)`，这就是外壳在真机上做的唯一调用）
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * 造种子实例（**键集合同 `SEED_DECLARATIONS`，本处不写死条数**）
 * —— 真 react / react-dom / jsx-runtime / cordis；平台 UI 包本机未装 ⇒ 用替身（见文件头）。
 */
export async function createSeeds({ slots, dockkit = null } = {}) {
  const react = await loadRealReact();
  const reactDomNs = await import('react-dom');
  const reactDom = reactDomNs.default ?? reactDomNs;
  const jsxRuntime = await import('react/jsx-runtime');
  const cordisNs = await import('@deepseek-ai/cordis');
  const cordis = cordisNs.default ?? cordisNs;
  return {
    react,
    'react/jsx-runtime': jsxRuntime,
    'react-dom': reactDom,
    '@deepseek-ai/cordis': cordis,
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: () => ({ get: () => null, set: () => {}, subscribe: () => () => {} }) },
    '@deepseek-ai/dsh-client-ui-primitives': createPrimitivesStub(react),
    '@deepseek-ai/dsh-client-ui-slots': slots ?? createSlots(),
    '@deepseek-ai/dsh-client-ui-dockkit': dockkit ?? createDockkitStub(),
  };
}

/** 把已装载的产物再驱动一次（捕获 console.error；幂等判据要在**同一模块实例**上连按两次）。 */
export function applyOnce(artifact, ctx) {
  const consoleErrors = [];
  const original = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((value) => String(value)).join(' '));
  };
  try {
    artifact.mod.apply(ctx);
  } finally {
    console.error = original;
  }
  const assembly = typeof artifact.mod.__internals?.lastAssembly === 'function' ? artifact.mod.__internals.lastAssembly() : null;
  return { assembly, consoleErrors };
}

/** 把真产物按平台方式驱动一次（`apply(ctx)` 就是外壳在真机上做的唯一调用）。 */
export function driveProduct(seeds, ctx) {
  const artifact = loadArtifact(seeds);
  const { assembly, consoleErrors } = applyOnce(artifact, ctx);
  return { artifact, assembly, consoleErrors };
}

/**
 * 造一套最小但完整的宿主环境并驱动一次真装配。
 *
 * @returns {Promise<object>} 观测面：`{ ctx, artifact, seeds, slots, scope, connection, assembly }`
 */
export async function assembleProduct({
  workspace = null,
  connectionResult = null,
  scopeOptions = {},
  declaredSlots = DECLARED_SLOTS,
  schedule = null,
  dropConnection = false,
  dockkit = null,
} = {}) {
  const slots = createSlots({ declared: declaredSlots });
  const scope = createSettingsScope(scopeOptions);
  const connection = createConnection(
    connectionResult ?? ((endpoint) => ({ ok: true, value: { endpoint, echo: true }, warnings: [], changed: false, rev: 1, undoToken: null })),
  );
  const dockkitStub = dockkit ?? createDockkitStub();
  const seeds = await createSeeds({ slots, dockkit: dockkitStub });

  const ctx = createCtx({
    services: {
      slots,
      settingsScope: scope,
      ...(dropConnection ? {} : { connection }),
      workspace: workspace === null ? undefined : { id: workspace },
    },
    label: 'verify-shell-ctx',
  });

  const { artifact, assembly, consoleErrors } = driveProduct(seeds, ctx);
  return { ctx, artifact, seeds, slots, scope, connection, assembly, schedule, consoleErrors, dockkit: dockkitStub, service: assembly?.service ?? null };
}

/** 本版能力的期望装配顺序（真源 `src/client/entry.mjs` 的 `CAPABILITY_ORDER`；**步数＝下面这个数组的 `length`，本处不写死**）。 */
/**
 * 期望的装配顺序（**从 `entry.mjs` 的 `CAPABILITY_ORDER` 派生**，不抄字面量）。
 *
 * ★ v1 只有四项（dock / theme / panel / overlay），派生式写法让
 * 「有人往装配表里插一项」在本装置上立刻可见；常量本体搬到 `source-face.mjs`，此处原样转出。
 */

/**
 * dockkit 种子替身（**计数型**）：`window.install` 会拿它与自研几何做一次**装配期对照探针**。
 * 计数＝「探针真的执行过」的证据；`mismatch:true` 时故意返回错值，用来证明探针**有牙**（能发现不一致），
 * 而不是一条恒真断言。正常值取自同一份自研几何（只读 import）⇒ 正常情况下 `mismatched` 为空。
 */
export function createDockkitStub({ mismatch = false } = {}) {
  const calls = { FLOAT_MIN_SIZE: 0, FLOAT_DEFAULT_SIZE: 0, DRAG_THRESHOLD: 0, movedRect: 0, resizedRect: 0, floatRectAt: 0, passedThreshold: 0 };
  const wrap = (name, fn) => (...args) => {
    calls[name] += 1;
    return fn(...args);
  };
  return {
    calls,
    get FLOAT_MIN_SIZE() {
      calls.FLOAT_MIN_SIZE += 1;
      return mismatch ? { width: 1, height: 1 } : { ...FLOAT_MIN_SIZE };
    },
    get FLOAT_DEFAULT_SIZE() {
      calls.FLOAT_DEFAULT_SIZE += 1;
      return mismatch ? { width: 2, height: 2 } : { ...FLOAT_DEFAULT_SIZE };
    },
    get DRAG_THRESHOLD() {
      calls.DRAG_THRESHOLD += 1;
      return mismatch ? DRAG_THRESHOLD + 99 : DRAG_THRESHOLD;
    },
    movedRect: wrap('movedRect', movedRect),
    resizedRect: wrap('resizedRect', resizedRect),
    floatRectAt: wrap('floatRectAt', floatRectAt),
    passedThreshold: wrap('passedThreshold', passedThreshold),
  };
}

/** `env` 的键集（只增不改不删；取自装配契约）。 */
/**
 * 装配面 `env` 的键集（**从 `entry.mjs` 实际读到的键派生**，不抄字面量）。
 *
 * ★ v1 的 `entry.mjs` **不再组装 `workspace`**（布局能力已裁），
 * 故派生结果自然少一个键；常量本体搬到 `source-face.mjs`，此处原样转出。
 */
