/**
 * panel-shell-hook.test.mjs —— **外壳注入 hook 的调用契约**。
 *
 * 【真机现象（两处独立探针各复现一次，逐字一致）】打开 `dsh-gui-frame/demo` 面板 ⇒
 * 面板整块 `data-guif-state="error"`、正文 `加载失败 l is not a function`、`data-guif-panel-body` 不存在、
 * 工具栏 0 项 ⇒ demo 四段（dock / layout / channel / overlay）一段都点不开。
 * 同一轮里 `apply 失败` = 0、`Minified React error` = 0 ⇒ **与 #300 是两件事**。
 *
 * 【根因（真源逐行可查，不是推测）】外壳注入的 `usePanelInfo` / `useSessions` 不是"取值函数"，而是
 * `bindSnapshotSelector(source)` 产出的**选择器 hook**：
 *     // dsh-client-ui-renderer/lib/client.js:155-161
 *     function bindSnapshotSelector(w) { … return function useSelector(sel, eq) {
 *       return useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, sel, eq); }; }
 * 它落到 `use-sync-external-store/shim/with-selector` 的 **production.min** 产物：
 *     function(a /*subscribe*\/, b /*getSnapshot*\/, e /*getServerSnapshot*\/, l /*selector*\/, g /*isEqual*\/) { … a = l(a); … }
 * **`l` 就是第 4 个形参 = 选择器**。`usePanelInfo()`（不传参）⇒ `l === undefined` ⇒ 原生
 * `TypeError: l is not a function`（真机报错文本逐字如此）。外壳自己的每个调用点都传
 * （`usePanelInfo((info) => info.activePanelId)` / `useSessions((s) => s)`）⇒ 这是**调用契约**，不是可选参数。
 *
 * 【本文件干两件事】① 最小复现：把调用点 + `readHook` 改回"不传选择器"的副本**必须判红**；
 * ② 契约守卫：真源在同一条路径上零错误态、active/sessions 取到真值、四段 action 齐备，且**两种注入形状都成立**。
 *
 * 【等价 shim】本文件自造 `useSyncExternalStoreWithSelector(a, b, e, l, g)`，**形参名与调用点 `l(a)` 与外壳
 * 压缩产物一致** ⇒ 面板正文与真机逐字对齐（`加载失败 l is not a function`）。它同时接真 `react` 的
 * `useSyncExternalStore`，所以 hook 计数与真机同形。
 *
 * 【边界】只读源码 + 只渲染真组件；变异副本写在包内**点前缀** scratch（构建器忽略点前缀），`t.after` 删净。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { cleanupMutantTree, writeMutantTree } from '../helpers/mutant-scratch.mjs';

// ① 先装真 DOM，再加载 react / react-dom（它们构造时会读 document）
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
const win = dom.window;
for (const [name, value] of Object.entries({
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  Event: win.Event,
  MouseEvent: win.MouseEvent,
  requestAnimationFrame: win.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 0)),
  cancelAnimationFrame: win.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id)),
  getComputedStyle: win.getComputedStyle.bind(win),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const React = (await import('react')).default;
const { act } = React;
const { createRoot } = await import('react-dom/client');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');
const COMPONENTS_SRC = path.join(PKG_DIR, 'src', 'client', 'panel', 'components.mjs');
/**
 * 面板壳是三件（`entry` / `views` / `shell`）：`readHook` 的**体内**落在 `views`，
 * 它的**调用点**落在 `shell`。变异按 `mutation.file` 定点落到对应文件
 * （`mutant-scratch` 的 `overrides`），让靶点跟着实现走。
 */
const PANEL_SOURCES = Object.freeze({
  entry: COMPONENTS_SRC,
  views: path.join(PKG_DIR, 'src', 'client', 'panel', 'components', 'views.mjs'),
  shell: path.join(PKG_DIR, 'src', 'client', 'panel', 'components', 'shell.mjs'),
});
/** 扫描面并集（源码级读法断言用）。 */
const readPanelShellSource = () => Object.values(PANEL_SOURCES).map((file) => readFileSync(file, 'utf8')).join('\n');
/**
 * 变异副本放包内点前缀目录（构建器忽略点前缀；且能解析 `react`）。
 * 共享**根** + 每进程子目录（并发卫生：任何进程都不许对共享根做整目录删除）。
 */
const MUTANT_ROOT = path.join(PKG_DIR, '.tmp-t49-mutant');
const MUTANT_DIR = path.join(MUTANT_ROOT, String(process.pid));
/** demo 面板的四段（与 demo 实现的四段同 id、同顺序）。 */
const DEMO_SECTIONS = [
  { id: 'dock', label: '① 入口坞总览' },
  { id: 'layout', label: '② 布局编辑预览' },
  { id: 'channel', label: '③ 数据通道示例' },
  { id: 'overlay', label: '④ 悬浮窗演示' },
];

const { createComponents } = await import(pathToFileURL(COMPONENTS_SRC).href);

/** 变异靶点 ①：`usePanelInfo` 的调用点（当前真源形状：传原语选择器）。 */
const CALLSITE_TARGET = String.raw` {4}const activePanelId = normalizeActivePanelId\(readHook\(react, props\.usePanelInfo, SELECT_ACTIVE_PANEL_ID\)\);`;
/** 变异靶点 ②：`readHook` 的 present 分支（当前真源形状：永远传选择器）。 */
const READHOOK_TARGET = String.raw` {4}if \(typeof hook === 'function'\) \{[\s\S]*?\n {4}\}\n {4}return useStandInHook\(react\);`;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 一、等价外壳 shim（形参名 / 调用点与外壳压缩产物一致；选择器缺席时抛 `l is not a function`）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * 等价 `use-sync-external-store/shim/with-selector` 的 production.min 产物。
 * ⚠ 第 4 个形参**必须叫 `l`**：压缩产物里就是 `l`，原生 TypeError 的文本才与真机一致。
 */
function useSyncExternalStoreWithSelector(a, b, e, l, g) {
  const instRef = React.useRef(null);
  if (instRef.current === null) instRef.current = { hasValue: false, value: null };
  const inst = instRef.current;
  const pair = React.useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot;
    let memoizedSelection;
    const memoizedSelector = (nextSnapshot) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        // ↓↓↓ 外壳压缩产物同一行：`a = l(a);` —— 选择器不是函数就在这里炸
        memoizedSelection = l(nextSnapshot);
        return memoizedSelection;
      }
      if (Object.is(memoizedSnapshot, nextSnapshot)) return memoizedSelection;
      const nextSelection = l(nextSnapshot);
      if (g !== undefined && g(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }
      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };
    return [() => memoizedSelector(b()), e === undefined ? undefined : () => memoizedSelector(e())];
  }, [b, e, l, g]);
  const value = React.useSyncExternalStore(a, pair[0], pair[1]);
  React.useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [value]);
  return value;
}

/** 外壳的 `bindSnapshotSelector(w)`（逐行等价；快照源用稳定引用的桩 store）。 */
function bindSnapshotSelector(w) {
  const subscribe = (fn) => w.subscribe(fn);
  const getSnapshot = () => w.getSnapshot();
  return function useSelector(sel, eq) {
    return useSyncExternalStoreWithSelector(subscribe, getSnapshot, undefined, sel, eq);
  };
}

/** 稳定引用的快照源（每次 `getSnapshot()` 返回**同一个对象**，否则 React 会判"每次都变了"）。 */
function createStore(snapshot) {
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 二、夹具：真组件 + demo 形状的面板
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** primitives 替身：只给本文件用到的原子（与其它 panel 用例同形，不撒谎）。 */
function createPrimitivesStub() {
  const icon = (name) => function IconStub(props) {
    return React.createElement('svg', { 'data-primitive': name, width: props?.size ?? 16, height: props?.size ?? 16 });
  };
  const pass = (props, skip = []) => {
    const out = {};
    for (const [key, value] of Object.entries(props ?? {})) {
      if (skip.includes(key) || key === 'children' || typeof value === 'function') continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    }
    return out;
  };
  return {
    Button: (props) => React.createElement('button', { type: 'button', ...pass(props, ['icon']), 'data-primitive': 'Button' }, props?.children ?? null),
    Tooltip: (props) => React.createElement('span', { 'data-primitive': 'Tooltip' }, props?.children ?? null),
    Tag: (props) => React.createElement('span', { ...pass(props), 'data-primitive': 'Tag' }, props?.children ?? null),
    IconLoadingOutlineRegular: icon('IconLoadingOutlineRegular'),
    IconWarningOutlineRegular: icon('IconWarningOutlineRegular'),
    IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
    IconChevronRightOutlineRegular: icon('IconChevronRightOutlineRegular'),
    IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
  };
}

/**
 * 造一套组件。
 * @param {(code:string,message:string)=>void} [note] 上报收集器（观测"错被吞掉"的那条路）
 */
function makeComponents(note = () => {}) {
  return createComponents({ seeds: { react: React, primitives: createPrimitivesStub() }, note });
}

/** 面板元素（形状：id / label / state / status / actions / 两个注入 hook）。 */
function demoPanel(components, injected) {
  const { Panel, Toolbar } = components;
  return React.createElement(Panel, {
    id: 'dsh-gui-frame/demo',
    label: 'GUIFrame demo',
    state: 'ready',
    status: '四段演示 · 当前：① 入口坞总览',
    actions: React.createElement(Toolbar, {
      id: 'dsh-gui-frame/demo-toolbar',
      items: DEMO_SECTIONS.map((section) => ({ id: section.id, label: section.label, onSelect: () => {}, tooltip: false })),
    }),
    usePanelInfo: injected?.usePanelInfo,
    useSessions: injected?.useSessions,
  }, React.createElement('b', { 'data-testid': 'demo-body' }, '演示正文'));
}

/** 外壳注入的两个 hook（选择器 hook 形状）。 */
function makeShellHooks() {
  return {
    usePanelInfo: bindSnapshotSelector(createStore({ activePanelId: 'dsh-gui-frame/demo' })),
    useSessions: bindSnapshotSelector(createStore({ items: [{ id: 'a' }, { id: 'b' }], state: 'idle' })),
  };
}

/**
 * 挂一个真组件（真 React + 真 jsdom + 真 react-dom）。
 *
 * ⚠ **刻意不用 StrictMode**：真机跑的是 React **production** 构建（`Minified React error #300` 这种码只在
 * production 出现，外壳 shim 也是 `production.min`），production 不做 StrictMode 的双调用；双调用会把
 * 「被 Panel 自己接住的 hooks 抛错」变成 React 内部告警，反而偏离真机形状。
 * hooks 数量恒定（2→1 / 0→2）的守卫由 `panel-hooks.test.mjs` 用 StrictMode 负责 —— 本文件不重复、也不放宽它。
 */
function mount(element) {
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  const root = createRoot(host);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    const line = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : '')).join(' ');
    errors.push(line);
    originalError(...args);
  };
  try {
    act(() => root.render(element));
  } catch (error) {
    errors.push(String(error?.message ?? error));
  }
  return {
    host,
    errors,
    unmount: () => {
      try {
        act(() => root.unmount());
      } catch {
        /* 卸载期错误与本判据无关 */
      }
      console.error = originalError;
      host.remove();
    },
  };
}

/**
 * 从源码派生一个变异副本（**逐条**验证靶点命中 + 内容真的变了 + 必须含某串，防空转），跑完由 `t.after` 删净。
 * @param {Array<{target:string, replacement:string}>} mutations 依次施加的变异
 * @param {string[]} mustContain 副本必须包含的串（防空转）
 * @param {(code:string,message:string)=>void} [note] 副本的上报收集器
 */
async function loadMutant(t, mutations, mustContain, tag, note = () => {}) {
  /** 三件源码各读一份；`mutation.file` 决定变异落到哪一件（缺省＝入口）。 */
  const texts = Object.fromEntries(Object.entries(PANEL_SOURCES).map(([key, file]) => [key, readFileSync(file, 'utf8')]));
  for (const [index, mutation] of mutations.entries()) {
    const key = mutation.file ?? 'entry';
    assert.ok(new RegExp(mutation.target).test(texts[key]), `变异靶点 #${index + 1} 仍在 ${key} 原文（源码改了这段，本用例必须跟着改，不许静默空转）：${tag}`);
    const before = texts[key];
    texts[key] = before.replace(new RegExp(mutation.target), mutation.replacement);
    assert.notEqual(texts[key], before, `变异 #${index + 1} 必须真的落到副本（${key}）：${tag}`);
  }
  const mutated = `${texts.entry}\n${texts.views}\n${texts.shell}`;
  for (const needle of mustContain) {
    assert.ok(mutated.includes(needle), `副本必须含 \`${needle}\`（防空转）：${tag}`);
  }

  // 副本落盘：**从被测入口按 import 图递归收集**，
  // 变异后的 `views` / `shell` 经 `overrides` 覆盖到闭包里的同名文件。
  const mutantPath = writeMutantTree({
    entryFile: COMPONENTS_SRC,
    source: texts.entry,
    overrides: { [PANEL_SOURCES.views]: texts.views, [PANEL_SOURCES.shell]: texts.shell },
    scratchDir: MUTANT_DIR,
    packageRoot: PKG_DIR,
    tag,
  });
  t.after(() => {
    cleanupMutantTree(MUTANT_DIR, MUTANT_ROOT);
    assert.equal(existsSync(mutantPath), false, 'scratch 必须删干净');
  });
  const mod = await import(pathToFileURL(mutantPath).href);
  return mod.createComponents({ seeds: { react: React, primitives: createPrimitivesStub() }, note });
}

test('最小复现（旧代码判红）：不传选择器 ⇒ 面板正文 `加载失败 l is not a function`、工具栏 0 项', async (t) => {
  const source = readPanelShellSource();
  // 旧形状（两处）：调用点不传选择器 + present 分支 `return hook();`
  const old = await loadMutant(
    t,
    [
      { file: 'shell', target: CALLSITE_TARGET, replacement: '    const activePanelId = readHook(react, props.usePanelInfo);' },
      {
        file: 'views',
        target: READHOOK_TARGET,
        replacement: "    if (typeof hook !== 'function') return useStandInHook(react);\n"
          + '    if (selector === null) return hook();\n'
          + '    const safeSelector = (snapshot) => safeRender(() => selector(snapshot), snapshot, report);\n'
          + '    return hook(safeSelector);',
      },
    ],
    ['readHook(react, props.usePanelInfo);', 'if (selector === null) return hook();'],
    'noselector',
  );

  const mounted = mount(demoPanel(old, makeShellHooks()));
  const errorNode = mounted.host.querySelector('[data-guif-state="error"]');
  assert.ok(errorNode !== null, '不传选择器的副本必须把面板打进错误态（真机现象）');
  const text = errorNode.textContent ?? '';
  assert.match(text, /l is not a function/, `面板正文必须与真机逐字对齐（实际：${JSON.stringify(text)}）`);
  assert.match(text, /加载失败/, '错误态前缀与真机一致（`加载失败 …`）');
  assert.equal(mounted.host.querySelector('[data-guif-panel-body]'), null, '错误视图落在面板根 ⇒ body 锚点不存在（真机同形）');
  assert.equal(mounted.host.querySelectorAll('[data-guif-action]').length, 0, '四段工具栏在错误态下 0 项（真机 toolbarItems=[]）');
  mounted.unmount();
});

test('修后转绿：同一输入下面板正常渲染、active/sessions 取到真值；两种注入形状都成立', () => {
  const components = makeComponents();
  const mounted = mount(demoPanel(components, makeShellHooks()));

  assert.equal(mounted.host.querySelector('[data-guif-state="error"]'), null, '不得出现错误态');
  assert.equal(mounted.host.querySelector('[data-guif-state]'), null, '任何三态锚点都不该出现（state=ready）');
  const panel = mounted.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]');
  assert.ok(panel !== null, '面板根必须在场');
  assert.equal(panel.getAttribute('data-guif-active'), 'true', 'activePanelId 与 id 相同 ⇒ active=true');
  assert.equal(panel.getAttribute('data-guif-sessions-count'), '2', 'useSessions 选择器取到 2 条');
  assert.equal(panel.textContent.includes('is not a function'), false, '正文不得再出现 React 的报错原文');
  assert.deepEqual(mounted.errors, [], '真 React 渲染路径上不得有任何 console.error');
  mounted.unmount();

  // 形状二：注入的是"自己就不吃参数"的取值函数（单测 / 旧接入方常见）⇒ 多传一个选择器参数必须无副作用
  const plain = mount(demoPanel(components, {
    usePanelInfo: () => ({ activePanelId: 'dsh-gui-frame/demo' }),
    useSessions: (selector) => (typeof selector === 'function' ? selector({ items: [{}], state: 'idle' }) : { items: [{}], state: 'idle' }),
  }));
  const plainPanel = plain.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]');
  assert.equal(plainPanel?.getAttribute('data-guif-active'), 'true', '不吃参数的注入形状照常可用（active=true）');
  assert.equal(plainPanel?.getAttribute('data-guif-sessions-count'), '1', '不吃参数的注入形状照常取到会话数');
  assert.deepEqual(plain.errors, [], '不吃参数的形状不得报错');
  plain.unmount();
});

test('demo 工具栏四段 action（dock / layout / channel / overlay）齐备且保序', () => {
  const components = makeComponents();
  const mounted = mount(demoPanel(components, makeShellHooks()));
  const ids = [...mounted.host.querySelectorAll('[data-guif-action]')].map((node) => node.getAttribute('data-guif-action'));
  assert.deepEqual(ids, DEMO_SECTIONS.map((section) => section.id), `四段 action 必须齐备且保序（实际：${JSON.stringify(ids)}）`);
  assert.ok(mounted.host.querySelector('[data-guif-toolbar="dsh-gui-frame/demo-toolbar"]') !== null, '工具栏锚点在场');
  assert.deepEqual(mounted.errors, [], '渲染四段工具栏不得报错');
  mounted.unmount();
});

test('回归判定（对照实验）：同一条"不传选择器"的违反在旧形状下**就被吞掉**，只是数据也丢了', async (t) => {
  const source = readPanelShellSource();
  // 对照副本 = **旧 present 分支形状**：调用点不传选择器 + 把 hooks 调用本身包进 safeRender（吞错）。
  // 唯一等价改写：吞错点接上 `report` —— 这样"错被吞了、吞的是什么"**可观测**（旧形状传 null，静默）。
  const notes = [];
  const control = await loadMutant(
    t,
    [
      { file: 'shell', target: CALLSITE_TARGET, replacement: '    const activePanelId = readHook(react, props.usePanelInfo);' },
      { file: 'views', target: READHOOK_TARGET, replacement: "    if (typeof hook !== 'function') return null;\n    return safeRender(() => hook(), null, report);" },
    ],
    ['return safeRender(() => hook(), null, report);'],
    'pret47',
    (code, message) => notes.push(`${code}: ${message}`),
  );

  const mounted = mount(demoPanel(control, makeShellHooks()));
  assert.equal(
    mounted.host.querySelector('[data-guif-state="error"]'),
    null,
    '旧形状下**不**显形（hooks 调用被 try/catch 吞掉）—— 这正是它一直没被发现的原因',
  );
  const panel = mounted.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]');
  assert.equal(panel?.getAttribute('data-guif-active'), 'unknown', '被吞之后 active 只能记"不知道"（真值丢失）');
  assert.equal(panel?.getAttribute('data-guif-sessions-count'), '0', '被吞之后会话数只能记 0（真值丢失）');
  mounted.unmount();

  // 决定性证据：吞掉的**正是同一条契约违反**（同一个 `l is not a function`），不是别的东西
  assert.ok(notes.length > 0, `旧形状必须至少吞掉一条错误（实际：${JSON.stringify(notes)}）`);
  assert.ok(
    notes.some((line) => /l is not a function/.test(line)),
    `被吞掉的错必须就是同一条契约违反（实际：${JSON.stringify(notes)}）`,
  );

  // 真源（修后）在同一输入下：既不显形、也不丢数据
  const fixedNotes = [];
  const fixed = mount(demoPanel(makeComponents((code, message) => fixedNotes.push(`${code}: ${message}`)), makeShellHooks()));
  const fixedPanel = fixed.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]');
  assert.equal(fixedPanel?.getAttribute('data-guif-active'), 'true', '修后 active 必须是真的');
  assert.equal(fixedPanel?.getAttribute('data-guif-sessions-count'), '2', '修后会话数必须是真的');
  assert.deepEqual(fixedNotes, [], '修后不该有任何被吞的错误上报');
  fixed.unmount();
});

test('排除候选机制：hook 缺席（走 useStandInHook）不是真机那条的抛点', () => {
  // 真机上两个 hook 都是**注入**的（present 分支）——这条用例把"缺席分支（useStandInHook）引入本缺陷"
  // 这个候选假设直接证伪：缺席路径在真 React 下既不抛错、也不进错误态。
  const components = makeComponents();
  const bare = mount(demoPanel(components, { usePanelInfo: undefined, useSessions: undefined }));
  assert.equal(bare.host.querySelector('[data-guif-state="error"]'), null, '缺席 ⇒ 占位 hook 不抛错、不进错误态');
  assert.equal(bare.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]')?.getAttribute('data-guif-active'), 'unknown');
  assert.deepEqual(bare.errors, [], '缺席路径零 console.error');
  bare.unmount();
});

test('外壳契约钉（读本机 DSH 产物；装不到就 skip）：`usePanelInfo` 是**选择器 hook**，官方调用点都传选择器', (t) => {
  // 外壳根：包的 `node_modules/@deepseek-ai/cordis` 是 junction（`npm run link` 建的）⇒ 反解到 DSH 安装位置
  let scopeDir = null;
  try {
    scopeDir = path.dirname(realpathSync(path.join(PKG_DIR, 'node_modules', '@deepseek-ai', 'cordis')));
  } catch {
    scopeDir = null;
  }
  const renderer = scopeDir === null ? null : path.join(scopeDir, 'dsh-client-ui-renderer', 'lib', 'client.js');
  if (renderer === null || !existsSync(renderer)) {
    t.skip('本机没有 link 到 DSH 产物（node_modules/@deepseek-ai/cordis 不是 junction）⇒ 跳过外壳契约钉');
    return;
  }

  const bundle = readFileSync(renderer, 'utf8');
  assert.ok(
    bundle.includes('function(a, b, e, l, g)'),
    'with-selector 的 production.min 签名里第 4 个形参必须仍是 `l`（= selector）—— 真机报错文本就是它',
  );
  assert.ok(bundle.includes('l(a)'), '那句 `l(a)` 必须仍在外壳产物里（选择器缺席即在此抛原生 TypeError）');
  assert.ok(
    /return function useSelector\(sel, eq\) \{\s*return \(0, [A-Za-z_$][\w$]*\.useSyncExternalStoreWithSelector\)\(subscribe, getSnapshot, void 0, sel, eq\)/.test(bundle),
    'bindSnapshotSelector 必须把 `sel` 放在第 4 个实参位置（选择器位置）',
  );

  // 官方调用点：一律**带选择器**（不许有空参调用 —— 那正是本缺陷的形状）
  const emptyCalls = [];
  let callSites = 0;
  for (const pkg of ['dsh-client-ui-layout', 'dsh-client-ui-sidebar', 'dsh-client-ui-workspace', 'dsh-client-ui-renderer']) {
    const file = path.join(scopeDir, pkg, 'lib', 'client.js');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    callSites += (text.match(/usePanelInfo\(\(/g) ?? []).length + (text.match(/useSessions\(\(/g) ?? []).length;
    const bare = (text.match(/usePanelInfo\(\)/g) ?? []).length + (text.match(/useSessions\(\)/g) ?? []).length;
    if (bare > 0) emptyCalls.push(`${pkg}=${bare}`);
  }
  assert.ok(callSites > 0, '必须真的在外壳产物里扫到官方调用点（防空转）');
  assert.deepEqual(emptyCalls, [], `官方调用点不得出现无选择器调用（实际：${JSON.stringify(emptyCalls)}）`);
});

test('证伪两条候选机制：**包裹层**不是抛点（去掉仍绿）、**缺席分支**不是抛点（强制走仍绿）', async (t) => {
  const source = readPanelShellSource();
  const shell = makeShellHooks();

  // 变体 1（候选："present 分支 selector 外多包了一层 safeRender 引入本缺陷"）
  // 保留「永远传选择器」，只**去掉包裹层** ⇒ 若包裹层是抛点，这里必炸；实测照样绿。
  const noWrapper = await loadMutant(
    t,
    [{
      file: 'views',
      target: READHOOK_TARGET,
      replacement: "    if (typeof hook !== 'function') return useStandInHook(react);\n"
        + '    return hook(selector === null ? SELECT_SNAPSHOT : selector);',
    }],
    ['return hook(selector === null ? SELECT_SNAPSHOT : selector);'],
    'nowrapper',
  );
  const plainMount = mount(demoPanel(noWrapper, shell));
  assert.equal(plainMount.host.querySelector('[data-guif-state="error"]'), null, '去掉包裹层（仍传选择器）必须照常渲染 ⇒ 抛点在**参数**不在包装');
  assert.equal(plainMount.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]')?.getAttribute('data-guif-active'), 'true');
  assert.deepEqual(plainMount.errors, [], '去掉包裹层不得报错');
  plainMount.unmount();

  // 变体 2（候选："useStandInHook 借道 seeds.react 的门面走坏路径"）
  // 注入照旧（props 里就是真 hook），但**强制走缺席分支** ⇒ 若缺席分支是抛点，这里必报同一句；实测照样绿。
  const forced = await loadMutant(
    t,
    [{ file: 'views', target: String.raw` {4}if \(typeof hook === 'function'\) \{`, replacement: "    if (false && typeof hook === 'function') {" }],
    ['if (false && typeof hook'],
    'forcedabsent',
  );
  const forcedMount = mount(demoPanel(forced, shell));
  assert.equal(forcedMount.host.querySelector('[data-guif-state="error"]'), null, '强制走缺席分支必须照常渲染 ⇒ 缺席分支不是真机那句的抛点');
  assert.equal(
    forcedMount.host.querySelector('[data-guif-panel="dsh-gui-frame/demo"]')?.getAttribute('data-guif-active'),
    'unknown',
    '强制缺席 ⇒ 只能记"不知道"（说明确实走了占位路径）',
  );
  assert.deepEqual(forcedMount.errors, [], '缺席路径零 console.error');
  forcedMount.unmount();
});

test.after(() => {
  dom.window.close();
});
