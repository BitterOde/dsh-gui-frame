/**
 * panel-hooks.test.mjs —— **真 React 的 hooks 数量守卫**。
 *
 * 【为什么必须有这一层】真机上「布局编辑预览」段进错误态，报的是 React **#300
 * `Rendered fewer hooks than expected`**。根因不在编辑器，而在面板壳：
 * `components.mjs` 的 `readHook` 旧写法「注入的 hook 缺席 ⇒ 一个 hook 都不调」，于是**同一 fiber** 上
 * 两次渲染的 hooks 数量会随**注入的 owner props 集合**变化（补装窗口 / demo 重装正好会改它）。
 * 离线门禁一直没抓到的原因有两条，本文件把两条都堵上：
 *   ① 多数离线用例跑**替身 react** —— 替身不校验 hooks 顺序；
 *   ② 即使用真 React，只要**每次重新挂载**（新 fiber）也看不见 —— React 只和**上一次渲染**比数量。
 * ⇒ 判据必须是「**同一实例**、逐条路径 rerender」（StrictMode 下），且两个方向都要走：
 *   注入集合 **2→1**（旧写法 ⇒ #300）与 **0→2**（旧写法 ⇒ #310，且会被 try/catch 吞掉）。
 *
 * 【注入 hook 的形状】外壳给的是 `useSyncExternalStoreWithSelector` 系（实读
 * `dsh-client-ui-renderer` 的 `bindSnapshotSelector`），**恰好 1 个 hook 槽**；本文件的两条注入 hook
 * 与夹具都按这个形状造（真 `useSyncExternalStore`），这样「1 槽对 1 槽」的契约是被真形状验证的。
 * ⚠ 快照必须是**稳定引用**（每次 `getSnapshot()` 返回新对象会让 React 无限重渲染）。
 *
 * 【边界】只读源码 + 只渲染真组件；变异副本写在包内**点前缀** scratch（构建器忽略点前缀），
 * `t.after` 里删干净，绝不改 `src/**`。
 *
 * 【并发卫生】scratch 根（包内点前缀目录）是**多进程共享**的 ⇒ 副本一律落在**每进程子目录**
 * `<根>/<process.pid>/`，收尾只删自己那一层（`cleanupScratchDir()`）；**任何进程都不许对根做整目录删除**
 * —— 那会拆掉并发进程正在 `import()` 的变异文件并让它收到假红（自守扫描 + 变异反证钉住）。
 *
 * ℹ 跑本文件时若在输出里看到 `Internal React error: Expected static flag was missing.`：它**只由变异副本**
 * （变异副本 2→1 那条）触发 —— 固定版在同一序列下连一条 console.error 都没有（阴性对照逐条断言），
 * 属 React 内部告警在"半坏 hook 链"上的连带反应，不是本包缺陷。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeMutantTree } from '../helpers/mutant-scratch.mjs';

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
const { StrictMode, act } = React;
const { createRoot } = await import('react-dom/client');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');
const COMPONENTS_SRC = path.join(PKG_DIR, 'src', 'client', 'panel', 'components.mjs');
/**
 * 面板壳拆成 `components.mjs` + `components/{views,shell}.mjs` 后，`readHook` / `useStandInHook`
 * 的**读法**分散在三件里 ⇒ 扫描面取并集，否则拆件会让判据静默空转。
 */
const VIEWS_SRC = path.join(PKG_DIR, 'src', 'client', 'panel', 'components', 'views.mjs');
const SHELL_SRC = path.join(PKG_DIR, 'src', 'client', 'panel', 'components', 'shell.mjs');
/** 扫描面并集（读法断言用）。 */
const readPanelShellSource = () => [COMPONENTS_SRC, VIEWS_SRC, SHELL_SRC].map((file) => readFileSync(file, 'utf8')).join('\n');

/**
 * scratch **根**：包内点前缀目录（构建器忽略点前缀；放包内才能解析 `jsdom`/`react`）。
 * ⚠ 这里**只放每进程的子目录**，任何进程都不许对**根**做整目录 `rmSync`（多进程共享根时的缺陷形状）。
 */
const MUTANT_ROOT = path.join(PKG_DIR, '.tmp-t47-mutant');

/**
 * **本进程**的 scratch 子目录（每进程一层）。
 *
 * 若直接落在共享 `MUTANT_ROOT` 上、收尾对**根**做递归强制删除 ⇒
 * 进程 A 的收尾会删掉进程 B 正在 `await import()` 的变异文件 ⇒ B 拿到**假红**
 * `Cannot find module .../components-mutant-<pid>.mjs`（8 进程并发实测复现过）。
 * 注意：本文件**自身**不得出现「对根递归删除」的连续调用原文，
 * 否则自守扫描会打到自己（自守用例里有断言钉住这一点）。
 */
const MUTANT_DIR = path.join(MUTANT_ROOT, String(process.pid));

/** React 的 hooks 数量错（#300 / #310 两族的自报文案）。 */
const HOOK_ERROR = /Rendered (fewer|more) hooks|Invalid hook call|#300|#310/i;

/**
 * 收尾：**只删自己那一层**；根目录只在「自己删空后它仍然空着」时才尝试移除。
 * `rmdirSync` 对非空目录必抛 ⇒ 永远不会碰到别人的层（这正是对整目录 `rmSync` 做不到的）。
 */
function cleanupScratchDir() {
  rmSync(MUTANT_DIR, { recursive: true, force: true });
  try {
    rmdirSync(MUTANT_ROOT);
  } catch {
    /* 根目录非空（还有别的进程在跑）或已不存在 —— 都不该影响本进程的结论 */
  }
}

/**
 * 变异副本落盘：**从被测入口按 import 图递归收集**。
 *
 * ⚠ 不维护硬编码的相对 import 改写清单：那四行 `.replace("from './x.mjs'", …)` 在
 * 「样式下沉到 `panel/base.mjs`」这类拆分之后会当场失配（副本缺文件 ⇒ `ERR_MODULE_NOT_FOUND`），
 * 把反证用例一起变成假红。改按 import 图递归收集后，任何一次拆分都不需要再改夹具
 * （防空转判据由 `mutant-scratch.mjs` 的闭包大小断言兜住）。
 */
/**
 * 变异副本落盘（`source` 是**变异后**的 `views.mjs` 文本）：
 * 入口固定用 `components.mjs`（它有完整 import 闭包），变异经 `overrides` 落到 `views.mjs`
 * —— **防空转**由 `mutant-scratch` 的闭包大小断言 + 调用点的 `assert.notEqual` 共同兜住。
 */
function writeScratchMutant(source, tag) {
  mkdirSync(MUTANT_DIR, { recursive: true });
  return writeMutantTree({
    entryFile: COMPONENTS_SRC,
    source: readFileSync(COMPONENTS_SRC, 'utf8'),
    overrides: { [VIEWS_SRC]: source },
    scratchDir: MUTANT_DIR,
    packageRoot: PKG_DIR,
    tag,
  });
}

/**
 * 自守扫描：找出「对**共享 scratch 根**做整目录 rmSync」的写法 —— 本文件里出现即算违规。
 * @param {string} source 本文件源码
 * @returns {string[]} 违规调用的原文（空数组 ⇒ 干净）
 */
function findUnsafeScratchCleanup(source) {
  const offenders = [];
  for (const match of source.matchAll(/rmSync\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}/g)) {
    const [, target, options] = match;
    if (target === 'MUTANT_ROOT' && /recursive\s*:\s*true/.test(options)) offenders.push(match[0]);
  }
  return offenders;
}

const { createComponents } = await import(pathToFileURL(COMPONENTS_SRC).href);

/** primitives 替身：只给官方 106 成员里的那 8 个（与其它 panel 用例同形，不撒谎）。 */
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
    IconChevronRightOutlineRegular: icon('IconChevronRightOutlineRegular'),
    IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
    IconLoadingOutlineRegular: icon('IconLoadingOutlineRegular'),
    IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
    IconWarningOutlineRegular: icon('IconWarningOutlineRegular'),
  };
}

/** 造一套组件（每个用例一套，避免共享状态互相污染）。 */
function makeComponents() {
  return createComponents({ seeds: { react: React, primitives: createPrimitivesStub() }, note: () => {} });
}

/**
 * 外壳形状的注入 hook：真 `useSyncExternalStore` ⇒ **恰好 1 个 hook 槽**。
 * @param {unknown} snapshot **稳定引用**的快照值（每次返回同一个对象，否则 React 会无限重渲染）
 */
function makeShellHook(snapshot) {
  const subscribe = () => () => {};
  const read = () => snapshot;
  return function useSelector(selector) {
    const value = React.useSyncExternalStore(subscribe, read, read);
    return typeof selector === 'function' ? selector(value) : value;
  };
}

/** 在 **StrictMode** 下挂一个真组件，抓「渲染期抛出的错」与「React 自报的 hooks 错」。 */
function mountStrict(element) {
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  const root = createRoot(host);
  const errors = [];
  /** 全部 console.error 原文（判据之外的全量留痕：变异副本会额外喷 React 内部告警）。 */
  const allErrors = [];
  const originalError = console.error;
  console.error = (...args) => {
    const line = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : '')).join(' ');
    allErrors.push(line);
    if (HOOK_ERROR.test(line) || /hooks/i.test(line)) errors.push(line);
    originalError(...args);
  };
  const render = (node) => {
    try {
      act(() => root.render(React.createElement(StrictMode, null, node)));
    } catch (error) {
      errors.push(String(error?.message ?? error));
    }
  };
  render(element);
  return {
    host,
    errors,
    allErrors,
    rerender: (next) => render(next),
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

function panelElement(components, props) {
  return React.createElement(components.Panel, { id: 'p-hooks', label: '面板', ...props },
    React.createElement('b', { 'data-testid': 'body' }, '正文'));
}

const PANEL_INFO = { activePanelId: 'p-hooks' };
const SESSIONS_TWO = { items: [{ id: 'a' }, { id: 'b' }], state: 'idle' };
const SESSIONS_ONE = { items: [{ id: 'a' }], state: 'idle' };

test('真 React + StrictMode：同一实例注入集合 **2→1**（撤掉 useSessions）⇒ 零 hooks 错误', () => {
  const components = makeComponents();
  const usePanelInfo = makeShellHook(PANEL_INFO);
  const useSessions = makeShellHook(SESSIONS_TWO);

  const mounted = mountStrict(panelElement(components, { usePanelInfo, useSessions }));
  assert.deepEqual(mounted.errors, [], '首帧（2 个注入 hook）不得报错');
  assert.equal(mounted.host.querySelector('[data-guif-panel="p-hooks"]')?.getAttribute('data-guif-active'), 'true', '首帧 active 必须是 true');
  assert.equal(mounted.host.querySelector('[data-guif-sessions-count]')?.getAttribute('data-guif-sessions-count'), '2');

  // 2 → 1：同一实例撤掉 useSessions（旧写法会在这里报 #300）
  mounted.rerender(panelElement(components, { usePanelInfo }));
  assert.deepEqual(mounted.errors, [], '2→1 之后不得出现 hooks 相关错误（这就是真机 #300 的场景）');
  assert.ok(mounted.host.querySelector('[data-guif-panel="p-hooks"]') !== null, '面板必须仍然活着（不得进错误态）');
  assert.equal(mounted.host.querySelector('[data-guif-state="error"]'), null, '不得渲染错误态');
  assert.equal(mounted.host.querySelector('[data-guif-sessions-count]')?.getAttribute('data-guif-sessions-count'), '0', '撤掉 hook 后会话数按"不知道"记 0');

  // 1 → 0 → 2：把三条路径都走一遍（旧写法在 0→2 会报 #310，并被 try/catch 吞成半坏链）
  mounted.rerender(panelElement(components, {}));
  assert.deepEqual(mounted.errors, [], '1→0 之后不得报错');
  assert.equal(mounted.host.querySelector('[data-guif-panel="p-hooks"]')?.getAttribute('data-guif-active'), 'unknown', '都不注入 ⇒ unknown');
  mounted.rerender(panelElement(components, { usePanelInfo, useSessions }));
  assert.deepEqual(mounted.errors, [], '0→2 之后不得报错');
  assert.equal(mounted.host.querySelector('[data-guif-sessions-count]')?.getAttribute('data-guif-sessions-count'), '2', '回到 2 个 hook 后数据照常取到');
  mounted.rerender(panelElement(components, { useSessions }));
  assert.deepEqual(mounted.errors, [], '2→1（换成另一个）仍不得报错');

  mounted.unmount();
});

test('真 React + StrictMode：**0→2**（从未注入到两个都注入）⇒ 零 hooks 错误（含阴性对照）', () => {
  const components = makeComponents();
  const usePanelInfo = makeShellHook(PANEL_INFO);
  const useSessions = makeShellHook(SESSIONS_ONE);

  // 阴性对照：同一条序列但**注入集合恒定**（都注入）⇒ 零错误（证明序列本身不是"必然报错"的）
  const control = mountStrict(panelElement(components, { usePanelInfo, useSessions }));
  control.rerender(panelElement(components, { usePanelInfo, useSessions }));
  control.rerender(panelElement(components, { usePanelInfo, useSessions }));
  assert.deepEqual(control.errors, [], '阴性对照（集合恒定）必须零错误');
  control.unmount();

  // 靶子：0 → 2
  const mounted = mountStrict(panelElement(components, {}));
  assert.deepEqual(mounted.errors, [], '首帧（0 个注入 hook）不得报错');
  assert.equal(mounted.host.querySelector('[data-guif-panel="p-hooks"]')?.getAttribute('data-guif-active'), 'unknown', '没注入 ⇒ unknown');
  mounted.rerender(panelElement(components, { usePanelInfo }));
  assert.deepEqual(mounted.errors, [], '0→1 不得报错');
  mounted.rerender(panelElement(components, { usePanelInfo, useSessions }));
  assert.deepEqual(mounted.errors, [], '0→2 不得报错（旧写法在这里抛 #310 并被 try/catch 吞掉）');
  assert.equal(mounted.host.querySelector('[data-guif-sessions-count]')?.getAttribute('data-guif-sessions-count'), '1');
  mounted.unmount();
});

test('hooks 抛错必须冒泡成**可见错误态**（不许被 try/catch 吞成"装作没注入"）；safeRender 只包 selector 回调', () => {
  const components = makeComponents();
  const boomHook = () => { throw new Error('HOOK-THROW-T47'); };
  const mounted = mountStrict(panelElement(components, { usePanelInfo: boomHook }));
  const errorNode = mounted.host.querySelector('[data-guif-state="error"]');
  assert.ok(errorNode !== null, `hooks 抛错必须渲染可见错误态（DOM=${JSON.stringify(mounted.host.textContent?.slice(0, 120))}）`);
  assert.match(errorNode.textContent ?? '', /HOOK-THROW-T47/, '错误态里必须带 hooks 的错因（不许吞）');
  assert.equal(
    mounted.host.querySelector('[data-guif-panel="p-hooks"]')?.getAttribute('data-guif-active'),
    null,
    '不得退化成"当作没注入"的 unknown 路径',
  );
  mounted.unmount();

  // 静态：hooks 调用本身必须是裸调用，safeRender 只能出现一次（包 selector 回调）；
  // 且 **readHook 体内不许有任何 try/catch**（吞错只允许发生在 useStandInHook 的「不在渲染树里」一类）。
  // 靶点：唯一一次 hook 调用 = `hook(safeSelector)`，且不得出现 `hook()`（真机 `l is not a function`
  // 正是零参数调用造成的）。
  const source = readPanelShellSource();
  const body = / {2}function readHook\(react, hook, selector = null\) \{[\s\S]*?\n {2}\}\n/.exec(source)?.[0] ?? '';
  assert.ok(body !== '', 'readHook 函数体必须能定位（防空转）');
  assert.ok(body.includes('return hook(safeSelector);'), `readHook 里 hooks 调用必须是裸调用（实际片段：${body.replace(/\s+/g, ' ').slice(0, 240)}）`);
  assert.equal(/return hook\(\)/.test(body), false, 'readHook 里**不得**出现零参数 hook 调用（外壳的选择器 hook 不吃零参数）');
  assert.equal((body.match(/\bhook\(/g) ?? []).length, 1, 'readHook 里只能有**一次** hook 调用（多调用点会重新引入槽数漂移风险）');
  assert.equal(/\b(?:try|catch)\b/.test(body), false, `readHook 体内不得出现 try/catch（吞错会掩盖 hooks 抛错）：${JSON.stringify(body.replace(/\s+/g, ' ').slice(0, 240))}`);
  const safeLines = body.split('\n').filter((line) => line.includes('safeRender'));
  assert.equal(safeLines.length, 1, `readHook 里 safeRender 只能出现 1 次（包 selector 回调），实际 ${safeLines.length} 次：${JSON.stringify(safeLines)}`);
  assert.match(safeLines[0], /\bpick\(snapshot\)/, 'safeRender 包的必须是 selector 回调');
  assert.equal(/safeRender\(\s*\(\)\s*=>\s*hook/.test(body), false, '绝不允许出现「把 hook 调用包进 safeRender」的写法');

  // 唯一的 catch：必须被 isNoDispatcherError 窄化，且非该类错误继续冒泡（否则就是真的在吞错）
  const standIn = /function useStandInHook\(react\) \{[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
  assert.ok(standIn !== '', 'useStandInHook 必须存在（缺席分支的占位实现）且能定位');
  assert.match(standIn, /isNoDispatcherError\(error\)/, '唯一允许吞错的 catch 必须用 isNoDispatcherError 窄化');
  assert.ok(standIn.includes('throw error'), '非「不在渲染树里」的错误必须继续冒泡');
  assert.ok(source.includes('return useStandInHook(react);'), '缺席分支必须走占位 hook（1 个 useSyncExternalStore 槽）');
});

test('变异反证：把 readHook 改回「缺席就 return null」的副本必须判红（自带牙 + 阴性对照）', async (t) => {
  const source = readFileSync(VIEWS_SRC, 'utf8'); // 靶点（readHook）现在落在 views.mjs ⇒ 副本入口也用它
  const target = / {2}function readHook\(react, hook, selector = null\) \{[\s\S]*?\n {2}\}\n/.exec(source);
  assert.ok(target !== null, '变异靶点仍在原文（源码改了这段，本用例必须跟着改，不许静默空转）');

  const replacement = "  function readHook(react, hook, selector = null) {\n    if (typeof hook !== 'function') return null;\n    return selector === null ? hook() : hook(selector);\n  }\n";
  const mutated = source.replace(target[0], replacement);
  assert.notEqual(mutated, source, '副本与原文件必须不同（防空转）');
  const mutatedBody = / {2}function readHook\(react, hook, selector = null\) \{[\s\S]*?\n {2}\}\n/.exec(mutated)?.[0] ?? '';
  assert.ok(mutatedBody.includes("if (typeof hook !== 'function') return null;"), '变异必须真的落到副本源码');
  assert.equal(/\b(?:useStandInHook|placeholder|useSyncExternalStore)\b/.test(mutatedBody), false, '旧写法没有占位 hook —— 变异后的 readHook 不得再碰占位（这就是"变回去"）');

  /** 「被抓住」= React 自报 hooks 错 **或** 面板落进错误态（#310 会被 Panel 自己的兜底接住，不进 console）。 */
  const caught = (mounted) => mounted.errors.some((line) => HOOK_ERROR.test(line))
    || mounted.host.querySelector('[data-guif-state="error"]') !== null;

  const mutantPath = writeScratchMutant(mutated, 'collapse', VIEWS_SRC);
  t.after(() => {
    cleanupScratchDir();
    assert.equal(existsSync(mutantPath), false, 'scratch 必须删干净');
  });

  const { createComponents: createMutant } = await import(pathToFileURL(mutantPath).href);
  const mutant = createMutant({ seeds: { react: React, primitives: createPrimitivesStub() }, note: () => {} });
  const usePanelInfo = makeShellHook(PANEL_INFO);
  const useSessions = makeShellHook(SESSIONS_ONE);

  // 方向一：2 → 1 ⇒ 变异副本必须被 React 抓住（#300 那一类；真机就是这个形状）
  const fewer = mountStrict(panelElement(mutant, { usePanelInfo, useSessions }));
  assert.deepEqual(fewer.errors, [], '变异副本首帧不报（证明后面报的是数量变化，不是首帧问题）');
  fewer.rerender(panelElement(mutant, { usePanelInfo }));
  assert.ok(caught(fewer), `变异副本在 2→1 必须被抓住（console=${JSON.stringify(fewer.errors)}，错误态=${fewer.host.querySelector('[data-guif-state="error"]') !== null}）`);
  t.diagnostic(`变异副本 2→1 的 React 实况：hooks 错=${JSON.stringify(fewer.errors)}｜错误态=${fewer.host.querySelector('[data-guif-state="error"]') !== null}｜全部 console.error=${JSON.stringify(fewer.allErrors)}`);
  fewer.unmount();

  // 方向二（如实记录 React 的实际行为，不当判据）：React 19 容忍「0 个 hook → N 个 hook」，
  // 因为首次渲染没建立 hook 链 —— 这一半**本来就抓不到**，所以真机的 #300 只会发生在 2→1 那一侧。
  const more = mountStrict(panelElement(mutant, {}));
  more.rerender(panelElement(mutant, { usePanelInfo, useSessions }));
  t.diagnostic(`变异副本 0→2 的 React 实况：console=${JSON.stringify(more.errors)}，错误态=${more.host.querySelector('[data-guif-state="error"]') !== null}（React 19 容忍 0→N，非判据）`);
  more.unmount();

  // 阴性对照：**未变异**的原组件在**同一序列**下不报（证明红的是变异，不是这条序列本身）
  const fixed = makeComponents();
  const control = mountStrict(panelElement(fixed, { usePanelInfo, useSessions }));
  control.rerender(panelElement(fixed, { usePanelInfo }));
  control.rerender(panelElement(fixed, {}));
  control.rerender(panelElement(fixed, { usePanelInfo, useSessions }));
  assert.deepEqual(control.errors, [], '原组件在同一序列下不得报错');
  assert.deepEqual(control.allErrors, [], '原组件在同一序列下不得产生任何 console.error（含 React 内部告警）');
  control.unmount();
});

test('变异反证②：把 **hook 调用本身**包进 safeRender ⇒ 抛错被吞（面板无错误态）⇒ 证明「hooks 抛错必须冒泡」那条有牙', async (t) => {
  const source = readFileSync(VIEWS_SRC, 'utf8'); // 靶点（`return hook(safeSelector);`）随 readHook 落在 views.mjs
  // readHook 里只有一次 hook 调用（`hook(safeSelector)`）⇒ 靶点一条。
  // 把这次调用包进 safeRender，hooks 抛错就会被吞成"装作没注入"。
  assert.ok(source.includes('return hook(safeSelector);'), '变异靶点仍在原文（防空转）');

  const mutated = source.replace('return hook(safeSelector);', 'return safeRender(() => hook(safeSelector), null, report);');
  assert.notEqual(mutated, source, '副本与原文件必须不同（防空转）');
  assert.ok(mutated.includes('safeRender(() => hook(safeSelector), null, report)'), '变异必须真的落到副本源码');

  const mutantPath = writeScratchMutant(mutated, 'swallow', VIEWS_SRC);
  t.after(() => {
    cleanupScratchDir();
    assert.equal(existsSync(mutantPath), false, 'scratch 必须删干净');
  });

  const { createComponents: createSwallowing } = await import(pathToFileURL(mutantPath).href);
  const swallowing = createSwallowing({ seeds: { react: React, primitives: createPrimitivesStub() }, note: () => {} });
  const boomHook = () => { throw new Error('HOOK-THROW-T47'); };

  const swallowed = mountStrict(panelElement(swallowing, { usePanelInfo: boomHook }));
  assert.equal(
    swallowed.host.querySelector('[data-guif-state="error"]'),
    null,
    '变异（把 hook 调用包进 safeRender）会把 hooks 抛错吞掉 ⇒ 面板**不**进错误态',
  );
  assert.equal(
    swallowed.host.querySelector('[data-guif-panel="p-hooks"]')?.getAttribute('data-guif-active'),
    'unknown',
    '被吞之后退回"装作没注入"的 unknown —— 正是验收禁止的"半坏链"',
  );
  swallowed.unmount();

  // 对照：未变异版在同一输入下**必须**渲染错误态（「hooks 抛错必须冒泡」那条的判据）
  const fixed = makeComponents();
  const loud = mountStrict(panelElement(fixed, { usePanelInfo: boomHook }));
  assert.ok(loud.host.querySelector('[data-guif-state="error"]') !== null, '原组件必须把 hooks 抛错渲染成可见错误态');
  loud.unmount();
});

test('无渲染树（dispatcher 为 null）里被当普通函数直接调 ⇒ 缺席分支不得炸成 useSyncExternalStore 的 TypeError', () => {
  const components = makeComponents();
  /** 无 DOM 的纯元素树遍历：只看 `props.children`，**绝不调用函数组件**（调用它们才是触发 hook 的那一步）。 */
  const collect = (node, out = []) => {
    if (node === null || node === undefined || typeof node === 'boolean') return out;
    if (Array.isArray(node)) {
      node.forEach((child) => collect(child, out));
      return out;
    }
    if (typeof node !== 'object' || node.$$typeof === undefined) return out;
    out.push(node);
    return collect(node.props?.children, out);
  };

  const noise = [];
  const originalError = console.error;
  console.error = (...args) => { noise.push(args.map((a) => String(a)).join(' ')); };
  let tree;
  try {
    // 无渲染树的世界就是这么调的：没有 fiber、没有上一次渲染 —— 真 React 的 dispatcher 是 null。
    tree = components.Panel({ id: 'p-domless', state: 'loading' });
  } finally {
    console.error = originalError;
  }

  const nodes = collect(tree);
  const text = nodes.flatMap((n) => [n.props?.children].filter((c) => typeof c === 'string')).join(' | ');
  assert.equal(nodes.filter((n) => n.props?.['data-guif-state'] === 'loading').length, 1, `无渲染树直调也必须渲染出 loading 态（实际文本：${text.slice(0, 160)}）`);
  assert.equal(nodes.some((n) => n.props?.['data-guif-state'] === 'error'), false, `不得退化成错误态（console 噪声：${JSON.stringify(noise).slice(0, 200)}）`);
  assert.equal(/Invalid hook call|useSyncExternalStore/.test(text), false, `面板文本里不得出现 React 的 hook 报错原文：${text.slice(0, 160)}`);
});

test('自守：scratch 每进程独立 + 不得对共享根整目录删除（阴性对照 + 变异反证 + 行为面）', (t) => {
  const selfPath = fileURLToPath(import.meta.url);
  const source = readFileSync(selfPath, 'utf8');

  // ── 防空转：自守必须有对象可扫（本文件真的定义了根、每进程子目录、统一收尾） ──
  assert.match(
    source,
    /^const MUTANT_ROOT = path\.join\(PKG_DIR, '\.tmp-t47-mutant'\);$/m,
    'scratch 根必须仍是包内**点前缀**目录（构建器忽略点前缀）',
  );
  assert.match(
    source,
    /^const MUTANT_DIR = path\.join\(MUTANT_ROOT, String\(process\.pid\)\);$/m,
    'scratch 必须落到**每进程**子目录（路径含 process.pid）',
  );
  assert.equal(
    (source.match(/t\.after\(\(\) => \{\s*\n\s*cleanupScratchDir\(\);/g) ?? []).length,
    2,
    '两处 t.after 收尾都必须走统一助手（否则自守扫不到真正在用的那处）',
  );
  assert.equal(/MUTANT_DIR\s*=\s*MUTANT_ROOT\b/.test(source), false, 'MUTANT_DIR 不得退化成共享根');

  // ── 阴性对照：真源必须干净 ──
  assert.deepEqual(findUnsafeScratchCleanup(source), [], '真源不得出现对共享根的整目录删除');

  // ── 变异反证：把收尾改回修前形状 ⇒ 自守必须判红 ──
  // 禁用调用按片段拼出来，**不落成连续原文** —— 否则自守会扫到自己（上一行 negative 断言会当场变红）。
  const bannedCleanup = `rm${'Sync'}(MUTANT_ROOT, { recursive: true, force: true });`;
  assert.equal(source.includes(bannedCleanup), false, '本文件自身不得出现连续的禁用调用（防自伤、也防"恒真"）');
  const mutated = source.replace('rmSync(MUTANT_DIR, { recursive: true, force: true });', bannedCleanup);
  assert.notEqual(mutated, source, '变异必须真的落到副本（防空转）');
  assert.ok(mutated.includes(bannedCleanup), '副本必须真的含禁用调用（防空转）');
  assert.equal(findUnsafeScratchCleanup(mutated).length, 1, '自守必须抓到「改回修前形状」的副本（自守有牙）');
  assert.deepEqual(findUnsafeScratchCleanup(source), [], '阴性对照：同一扫描器对真源必须为空');

  // ── 行为面：收尾只删自己那一层；别人的层必须活着（修前的整目录删除会把它一起删掉） ──
  const siblingDir = path.join(MUTANT_ROOT, '999999999');
  const siblingFile = path.join(siblingDir, 'someone-elses-mutant.mjs');
  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(siblingFile, 'export const marker = 1;\n', 'utf8');
  t.after(() => {
    rmSync(siblingDir, { recursive: true, force: true });
    try {
      rmdirSync(MUTANT_ROOT);
    } catch {
      /* 根目录非空或已不存在 */
    }
  });

  mkdirSync(MUTANT_DIR, { recursive: true });
  const ownFile = path.join(MUTANT_DIR, 'own-scratch.mjs');
  writeFileSync(ownFile, 'export const marker = 2;\n', 'utf8');
  cleanupScratchDir();
  assert.equal(existsSync(ownFile), false, '收尾必须删掉自己那一层里的文件');
  assert.equal(existsSync(MUTANT_DIR), false, '自己那一层目录也要清掉（不留残留）');
  assert.equal(existsSync(siblingFile), true, '收尾**不得**碰别人的层 —— 这正是修前会拆掉并发进程变异文件的那一下');
  assert.equal(existsSync(MUTANT_ROOT), true, '还有别人的层在时，共享根必须留着');
});

test.after(() => {
  dom.window.close();
});
