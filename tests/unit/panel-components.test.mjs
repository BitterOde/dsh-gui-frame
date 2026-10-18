/**
 * panel-components.test.mjs —— 六个复合组件的机检门禁。
 *
 * 纪律：不写文件、不联网、不需要 DSH 在跑；用假 react（`tests/helpers/fake-react.mjs`）产出元素树做结构断言。
 * ⚠ 假 react 的 `walkElements` 遇到**类组件**会当函数组件调用（会抛），而面板壳里有自己的错误边界（类），
 *   所以本文件自带 `walkSafe / findAttr / textSafe`（展开函数组件、**不调用**类组件），不整树 walk。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MINIMAL_ERROR_ATTR, MINIMAL_ERROR_KIND, MINIMAL_ERROR_STATE, createRenderBoundary } from '../../src/client/panel/boundary.mjs';
import { ANCHORS, STATE_VALUES, createComponents } from '../../src/client/panel/components.mjs';
import { PRIMITIVES_MEMBERS, PRIMITIVES_USED } from '../../src/client/kit/primitives.mjs';
import { PANEL_STATES, TRIGGERABLE_STATES } from '../../src/client/panel/state.mjs';
import { PANEL_COMPONENT_NAMES, createPanelComponents, install } from '../../src/client/panel/index.mjs';
import { renderComponent } from '../helpers/fake-react.mjs';
import { SRC_CLIENT_DIR, createDockHarness, createFakePrimitives } from './dock-fixtures.mjs';

/**
 * 面板壳拆成 `panel/components.mjs` + `panel/components/{views,shell}.mjs`
 * ⇒ 源码级断言的**扫描面取并集**（让扫描面跟着实现走）。
 */
const readPanelShellSource = () => ['components.mjs', path.join('components', 'views.mjs'), path.join('components', 'shell.mjs')]
  .map((rel) => readFileSync(path.join(SRC_CLIENT_DIR, 'panel', rel), 'utf8'))
  .join('\n');

/** 是否是**类组件**（标记挂在 `prototype.isReactComponent` 上；真 React 与本地基类一致）。 */
function isClassElement(node) {
  const type = node?.type;
  return typeof type === 'function' && type.prototype !== undefined && type.prototype.isReactComponent !== undefined;
}

/**
 * 安全遍历：展开函数组件、**不调用**类组件（但类组件的 children 仍要遍历 —— 它们已是元素）。
 *
 * ⚠ **为什么绕开共享夹具**：`tests/helpers/fake-react.mjs` 的 `walkElements` / `textOf` 会把类组件
 * 当函数组件调用（`node.type(node.props)`）⇒ 树里一旦出现错误边界类就抛
 * `Class constructor GuiFrameRenderBoundary cannot be invoked without 'new'`。
 * 所以本文件自备两个本地遍历器（`walkSafe` / `textSafe`），共享夹具修好后可删掉改用共享夹具。
 * **这不是两套并行口径**，只是同一语义的临时落地（本文件不动共享夹具）。
 */
function walkSafe(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walkSafe(child, visit);
    return;
  }
  if (node === null || typeof node !== 'object' || node.$$typeof === undefined) return;
  visit(node);
  if (isClassElement(node)) {
    for (const child of node.props?.children ?? []) walkSafe(child, visit);
    return;
  }
  if (typeof node.type === 'function') {
    walkSafe(node.type(node.props), visit);
    return;
  }
  for (const child of node.props?.children ?? []) walkSafe(child, visit);
}

/** 按属性找（语义同 `fake-react` 的 findByAttr，但类组件不展开）。 */
function findAttr(node, key, value) {
  const out = [];
  walkSafe(node, (candidate) => {
    if (value === undefined ? candidate.props?.[key] !== undefined : String(candidate.props?.[key] ?? '') === String(value)) out.push(candidate);
  });
  return out;
}

/** 文本汇总（展开函数组件；类组件不展开）。 */
function textSafe(node) {
  const parts = [];
  const visit = (current) => {
    if (typeof current === 'string' || typeof current === 'number') {
      parts.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (current === null || typeof current !== 'object' || current.$$typeof === undefined) return;
    if (isClassElement(current)) {
      for (const child of current.props?.children ?? []) visit(child);
      return;
    }
    if (typeof current.type === 'function') {
      visit(current.type(current.props));
      return;
    }
    for (const child of current.props?.children ?? []) visit(child);
  };
  visit(node);
  return parts.join('');
}

/** 浅层找：只看 children 数组与宿主元素，**不调用**任何组件（用来定位错误边界元素本身）。 */
function shallowFind(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) shallowFind(child, predicate, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || node.$$typeof === undefined) return out;
  if (predicate(node)) out.push(node);
  for (const child of node.props?.children ?? []) shallowFind(child, predicate, out);
  return out;
}

/** 取面板 body 里的错误边界元素（Panel 结构：header / body / status）。 */
function boundaryOf(tree, Boundary) {
  const hits = shallowFind(tree, (node) => node.type === Boundary);
  assert.equal(hits.length, 1, `面板 body 里应恰好有 1 个错误边界（实际 ${hits.length}）`);
  return hits[0];
}

function panelHarness(options = {}) {
  const h = createDockHarness(options);
  const set = createComponents({ seeds: h.seeds });
  return { h, set, react: h.seeds.react };
}

test('panel 的 install(ctx, env)：六个冻结名逐个登记，副作用全在 ctx.effect 上，卸载可一次性撤掉', () => {
  const h = createDockHarness();
  assert.deepEqual(Object.keys(h.env).sort(), ['seeds', 'service']);
  const installed = install(h.ctx, h.env);
  assert.equal(installed.capability, 'panel');
  assert.equal(installed.installed, true, `面板能力应装配成功（reason=${installed.reason}）`);
  assert.deepEqual(installed.registered, ['Empty', 'ErrorState', 'KeyValue', 'List', 'Panel', 'Toolbar'], '登记顺序即冻结清单顺序');
  for (const name of installed.registered) {
    assert.equal(typeof h.service.components.get(name), 'function', `${name} 必须已登记进 components 面`);
    assert.ok(
      h.ctxInternals.calls.effect.includes(`gui-frame: panel component ${name}`),
      `${name} 的登记副作用必须挂在 ctx.effect 上（A16）`,
    );
  }
  assert.deepEqual(h.service.components.names(), ['Empty', 'ErrorState', 'KeyValue', 'List', 'Panel', 'Toolbar'].sort());

  installed.dispose();
  for (const name of installed.registered) {
    assert.equal(h.service.components.get(name), undefined, `${name} 卸载后必须从 components 面注销`);
  }

  // 缺面 ⇒ 显式不装
  assert.equal(install(h.ctx, { seeds: h.seeds }).reason, 'no-service');
  assert.equal(install(h.ctx, { service: h.service }).reason, 'no-react-seed', '没有 react 种子 ⇒ 不装（而不是装出半个空组件）');
  assert.equal(createPanelComponents(h.env).Panel.name, 'Panel');
});

test('三态**显式**触发：state=loading/empty/error 各自渲染出带锚点的视图（Panel 与 List 两条路径）', () => {
  const { set, react } = panelHarness();
  for (const state of STATE_VALUES) {
    const tree = renderComponent(react, set.Panel, { id: 'dsh-gui-frame/demo', label: '演示', state, error: '后端 500', onRetry: () => 'retried' });
    const hits = findAttr(tree, ANCHORS.state, state);
    assert.equal(hits.length, 1, `state=${state} 时必须渲染出 data-guif-state="${state}" 的视图`);
  }
  const loading = renderComponent(react, set.Panel, { id: 'x/1', state: 'loading' });
  assert.equal(findAttr(loading, 'data-guif-prim', 'IconLoadingOutlineRegular').length, 1, 'loading 视图用官方 IconLoadingOutlineRegular（种子在位时）');
  const empty = renderComponent(react, set.Panel, { id: 'x/1', state: 'empty', title: '空空如也' });
  assert.equal(textSafe(empty).includes('空空如也'), true);
  const error = renderComponent(react, set.Panel, { id: 'x/1', state: 'error', error: new Error('炸了') });
  assert.equal(textSafe(error).includes('炸了'), true);
  assert.equal(findAttr(error, ANCHORS.action, 'retry').length, 0, '没有 onRetry 时不画重试按钮');
  const retryable = renderComponent(react, set.Panel, { id: 'x/1', state: 'error', error: 'x', onRetry: () => 'ok' });
  assert.ok(findAttr(retryable, ANCHORS.action, 'retry').length >= 1, '给了 onRetry 就要画重试按钮');

  // List：空数组自动进空态；显式 state 优先
  const listEmpty = renderComponent(react, set.List, { items: [] });
  assert.equal(findAttr(listEmpty, ANCHORS.state, 'empty').length, 1, 'List 空数组 ⇒ 空态（同一条渲染路径）');
  const listLoading = renderComponent(react, set.List, { items: [1, 2], state: 'loading' });
  assert.equal(findAttr(listLoading, ANCHORS.state, 'loading').length, 1, '显式 state 优先于推导');
  const listError = renderComponent(react, set.List, { items: [1], state: 'error', error: '拉取失败' });
  assert.equal(textSafe(listError).includes('拉取失败'), true);
  const listRows = renderComponent(react, set.List, { items: ['a', 'b'], renderItem: (item) => item });
  assert.equal(findAttr(listRows, ANCHORS.row).length, 2, '非空 ⇒ 正常渲染每一行');
  assert.equal(findAttr(listRows, ANCHORS.state).length, 0, '正常渲染时不应残留任何态锚点');
  assert.deepEqual([...STATE_VALUES], ['loading', 'empty', 'error']);
  assert.deepEqual([...TRIGGERABLE_STATES], [...STATE_VALUES], '三态清单必须与可显式触发的 state 值一致（两份表不许漂移）');
  assert.deepEqual([...PANEL_COMPONENT_NAMES], ['Empty', 'ErrorState', 'KeyValue', 'List', 'Panel', 'Toolbar'], '装配用的名字表 = 冻结清单');
  assert.deepEqual([...PANEL_STATES], ['ready', 'loading', 'empty', 'error']);
});

test('面板壳自己用 usePanelInfo() 判 active、useSessions() 取会话（不依赖 main 的 owner props）', () => {
  const { set, react } = panelHarness();
  const sessions = { items: [{}, {}], state: 'idle' };
  const active = renderComponent(react, set.Panel, {
    id: 'dsh-gui-frame/demo',
    label: '演示',
    usePanelInfo: () => ({ activePanelId: 'dsh-gui-frame/demo' }),
    useSessions: (selector) => (typeof selector === 'function' ? selector(sessions) : sessions),
  });
  assert.equal(active.props[ANCHORS.panelActive], 'true', 'activePanelId 与 id 相同 ⇒ active=true');
  assert.equal(active.props[ANCHORS.sessionsCount], '2', '会话数来自 useSessions() 的快照');

  const inactive = renderComponent(react, set.Panel, {
    id: 'dsh-gui-frame/demo',
    usePanelInfo: () => ({ activePanelId: 'conversation' }),
    useSessions: (selector) => (typeof selector === 'function' ? selector(sessions) : sessions),
  });
  assert.equal(inactive.props[ANCHORS.panelActive], 'false');

  // hook **缺席** ⇒ 同位置补 1 槽占位，按"不知道"处理（**不得因此不调 hook** —— 那正是 #300 的根因）
  const bare = renderComponent(react, set.Panel, { id: 'dsh-gui-frame/demo' });
  assert.equal(bare.props[ANCHORS.panelActive], 'unknown');
  assert.equal(bare.props[ANCHORS.sessionsCount], '0');
  // hook **抛错** ⇒ 必须冒泡成**可见错误态**（不许被 try/catch 吞成半坏链、不许装作没注入）
  const throwing = renderComponent(react, set.Panel, {
    id: 'dsh-gui-frame/demo',
    usePanelInfo: () => { throw new Error('hook 炸了'); },
    useSessions: () => { throw new Error('hook 炸了'); },
  });
  const hookError = findAttr(throwing, ANCHORS.state, 'error');
  assert.equal(hookError.length, 1, 'hook 抛错必须渲染出错误态（不再静默退化成 unknown）');
  assert.equal(textSafe(hookError[0]).includes('hook 炸了'), true, '错误态里必须带 hooks 的错因');
  // selector **回调**抛错只降级（safeRender 包的是回调，不是 hook 调用本身）
  const selectorPath = renderComponent(react, set.Panel, {
    id: 'dsh-gui-frame/demo',
    useSessions: (selector) => (typeof selector === 'function' ? selector({ items: [{}, {}], state: 'idle' }) : null),
  });
  assert.equal(selectorPath.props[ANCHORS.sessionsCount], '2', 'selector 正常时照常取数');

  // 会话快照**推导**三态：loading / empty / error 与 demo 显式触发走同一条渲染路径
  const derive = (snapshot) => renderComponent(react, set.Panel, {
    id: 'dsh-gui-frame/demo',
    useSessions: (selector) => (typeof selector === 'function' ? selector(snapshot) : snapshot),
  });
  assert.equal(findAttr(derive({ items: [], state: 'loading' }), ANCHORS.state, 'loading').length, 1);
  assert.equal(findAttr(derive({ items: [], state: 'idle' }), ANCHORS.state, 'empty').length, 1);
  assert.equal(findAttr(derive({ items: [{}], state: 'error', error: { message: 'x' } }), ANCHORS.state, 'error').length, 1);
  assert.equal(findAttr(derive({ items: [{}], state: 'idle' }), ANCHORS.state).length, 0, '正常态 ⇒ 渲染 children，不带态锚点');
});

test('壳组件内部自 catch：子树抛错走自有边界渲染错误态；组装期抛错就地兜住；单行/单动作抛错不连坐', () => {
  const { set, react } = panelHarness();

  // ① 子树（插件内容）抛错 ⇒ 自有边界的 getDerivedStateFromError → 渲染 ErrorState（不是官方那个空 div）
  const tree = renderComponent(react, set.Panel, { id: 'dsh-gui-frame/demo', label: '演示', close: () => {} });
  const boundary = boundaryOf(tree, set.boundary);
  const failure = set.boundary.getDerivedStateFromError(new Error('插件内容炸了'));
  assert.equal(failure.failed, true);
  const instance = new set.boundary({ ...boundary.props });
  instance.state = failure;
  const crashed = instance.render();
  assert.equal(findAttr(crashed, ANCHORS.state, 'error').length, 1, '崩溃面必须是**有文案的错误态**');
  assert.equal(textSafe(crashed).includes('插件内容炸了'), true);

  let reported = null;
  instance.props.onError = (error) => { reported = error.message; };
  instance.componentDidCatch(new Error('插件内容炸了'), { componentStack: 'x' });
  assert.equal(reported, '插件内容炸了', '崩溃要能被上报（诊断上报链路接这里）');
  instance.props.onError = () => { throw new Error('上报自己炸了'); };
  instance.componentDidCatch(new Error('x'), null); // 上报抛错不得冒泡

  // ② 组装期抛错（非法 state）⇒ 渲染错误态而不是把异常抛给官方 boundary
  const badState = renderComponent(react, set.Panel, { id: 'dsh-gui-frame/demo', state: 'wat' });
  assert.equal(findAttr(badState, ANCHORS.state, 'error').length, 1);
  assert.equal(textSafe(badState).includes('state'), true);

  // ③ List 的 renderItem 抛错 ⇒ 只有那一行变成错误文案，其余行照常
  const rows = renderComponent(react, set.List, {
    items: ['ok-1', 'boom', 'ok-2'],
    renderItem: (item) => {
      if (item === 'boom') throw new Error('这一行炸了');
      return item;
    },
  });
  assert.equal(findAttr(rows, ANCHORS.row).length, 3, '一行抛错不得连坐其余行');
  assert.equal(textSafe(rows).includes('ok-1') && textSafe(rows).includes('ok-2'), true);
  assert.equal(textSafe(rows).includes('这一行炸了'), true);

  // ④ Toolbar 的动作回调抛错 ⇒ 不冒泡（safeRender）
  const toolbar = renderComponent(react, set.Toolbar, {
    items: [{ id: 'boom', label: '炸', onSelect: () => { throw new Error('动作炸了'); } }],
  });
  const button = shallowFind(toolbar, (node) => node.props?.[ANCHORS.action] === 'boom')[0];
  assert.ok(button, '动作按钮必须在树上');
  assert.equal(button.props.onClick(), undefined, 'onSelect 抛错必须被吞掉（返回 undefined），不得冒泡');

  // ⑤ 自研等价物：没有 primitives 种子时也能渲染（退成 <button>）
  const noPrims = createComponents({ seeds: { react } });
  const fallback = renderComponent(react, noPrims.Panel, {
    id: 'dsh-gui-frame/demo',
    label: '演示',
    actions: noPrims.Toolbar({ items: [{ id: 'a', label: 'A', onSelect: () => {} }] }),
  });
  const fallbackButton = shallowFind(fallback, (node) => node.props?.[ANCHORS.action] === 'a')[0];
  assert.ok(fallbackButton, '没有 primitives 时动作按钮仍要出现');
  assert.equal(String(fallbackButton.type), 'button', '种子缺席 ⇒ 退到自研 <button>');
});

test('primitives 只取官方 50 个包真实用过的成员：不在表里的一律抛；表本身自洽', () => {
  const { set } = panelHarness();
  assert.equal(new Set(PRIMITIVES_MEMBERS).size, PRIMITIVES_MEMBERS.length, '180 个成员不得重复');
  assert.deepEqual([...PRIMITIVES_MEMBERS], [...PRIMITIVES_MEMBERS].sort(), '成员表必须排序（便于逐字节比对）');
  for (const name of PRIMITIVES_USED) {
    assert.ok(PRIMITIVES_MEMBERS.includes(name), `用到的 ${name} 必须在官方真实用过的成员表里`);
    assert.equal(set.primitives.has(name), true, `${name} 必须能从受限取用面取出`);
  }
  // ★ 反例必须选**真不在** 180 表里的名字：旧版这里用 `Input` 当反例，0.2.0 把它收进官方调用面后
  //   仍拿它当反例 ⇒ 断言「必须抛」变成假红。反例清单要跟着平台表走（新增成员时就换一个）。
  for (const name of ['Skeleton', 'SplitPane', 'Tabs', 'NotARealPrimitive']) {
    assert.throws(() => set.primitives.get(name), /不在官方 50 个包真实用过的 180 个成员里/, `${name} 必须被闸门拒绝（未覆盖成员不得使用）`);
  }
});

test('组件一律用 createElement 构造：种子缺席即失败；渲染一帧确实在调 createElement', () => {
  assert.throws(() => createComponents({ seeds: { react: undefined } }), /需要 env\.seeds\.react/, '没有 react 种子必须显式失败（不猜第二份 react）');

  const base = panelHarness();
  let calls = 0;
  const spyReact = { ...base.react, createElement: (...args) => { calls += 1; return base.react.createElement(...args); } };
  const set = createComponents({ seeds: { ...base.h.seeds, react: spyReact } });
  const before = calls;
  renderComponent(base.react, set.Panel, { id: 'dsh-gui-frame/demo', label: '演示' });
  assert.ok(calls > before, '渲染一帧必须产生 createElement 调用（说明没有走 JSX 编译产物）');
  const afterOneFrame = calls;
  renderComponent(base.react, set.Toolbar, { items: [{ id: 'a', label: 'A' }] });
  assert.ok(calls > afterOneFrame, '每个组件都靠 createElement 构造');
  assert.equal(typeof set.Panel, 'function');
});

test('[A10/A11 前置] 公开变量缺省值只在 var() 回退位：面板根**不声明**任何内联 --guif-*（祖先覆盖成立的前提）', () => {
  // 冻结表（真值不放在 src 里：src 一旦有 `'--guif-*': 值` 这种**键**，就是「内联声明」那种写法 ⇒ D1）
  const PANEL_VAR_DEFAULTS = Object.freeze({
    '--guif-panel-padding': '10px',
    '--guif-panel-gap': '8px',
    '--guif-panel-radius': '12px',
  });
  for (const [name, value] of Object.entries(PANEL_VAR_DEFAULTS)) {
    assert.ok(name.startsWith('--guif-') && !name.startsWith('--guif-private-'), `${name} 属公开变量（--guif-*）`);
    assert.equal(typeof value, 'string');
  }
  const { set, react } = panelHarness();

  // ① 冻结表 ↔ 实现同源：三条缺省值必须能在样式的 `var()` 回退位上**逐字**找到
  assert.equal(set.styles.panel.gap, `var(--guif-panel-gap, ${PANEL_VAR_DEFAULTS['--guif-panel-gap']})`);
  assert.equal(set.styles.body.padding, `var(--guif-panel-padding, ${PANEL_VAR_DEFAULTS['--guif-panel-padding']})`);
  assert.equal(set.styles.panel.borderRadius, `var(--guif-panel-radius, ${PANEL_VAR_DEFAULTS['--guif-panel-radius']})`, '★ 圆角缺省是长度值：拿 corner-shape 关键字当 border-radius 用会让圆角退化成 0（D2）');

  // ② ★ D1：面板根的内联 style 里**不得**有 `--guif-*` 的**键**（键＝声明）。
  //    自定义属性走继承，元素自己的声明恒胜过继承值 ⇒ 声明一次，祖先覆盖在这棵子树上就永久失效。
  const tree = renderComponent(react, set.Panel, { id: 'dsh-gui-frame/demo' });
  const declared = Object.keys(tree.props.style).filter((key) => key.startsWith('--'));
  assert.deepEqual(declared, [], '面板根不得把公开变量声明成内联自定义属性（否则「接入方在任意父级覆盖」是假的）');
  // ③ 反向：缺省值必须**在取值位**（`var()` 的回退位）上真的存在
  const styleText = JSON.stringify(tree.props.style);
  assert.ok(styleText.includes('var(--guif-panel-gap, 8px)'), '缺省必须在 var() 的回退位上（那才是可被祖先覆盖的写法）');
  assert.ok(styleText.includes('var(--guif-panel-radius, 12px)'), '圆角缺省必须落到长度值 12px');
});

test('[补充] 六个组件与冻结 props 形状：假 primitives 成员集合 ≡ PRIMITIVES_USED（替身不撒谎）', () => {
  const { set, react } = panelHarness();
  const fake = createFakePrimitives(react);
  assert.deepEqual(Object.keys(fake).sort(), [...PRIMITIVES_USED].sort(), '假 primitives 的成员集合必须与 PRIMITIVES_USED 一致');

  for (const name of ['Panel', 'Toolbar', 'Empty', 'ErrorState', 'List', 'KeyValue']) {
    assert.equal(typeof set[name], 'function', `${name} 必须在组件集合里`);
  }
  // 冻结的「必须接受的 props」逐个喂进去（一个不少），六个组件都要能渲染出元素
  const frozen = {
    Panel: { id: 'dsh-gui-frame/demo', label: '演示', close: () => {}, actions: null, children: '内容' },
    Toolbar: { items: [{ id: 'a', label: 'A', onSelect: () => {} }], children: null },
    Empty: { title: '空', description: '说明', action: null, children: null },
    ErrorState: { error: '错了', onRetry: () => {}, children: null },
    List: { items: ['x'], renderItem: (item) => item, empty: null, children: null },
    KeyValue: { entries: [['k', 'v']], children: null },
  };
  for (const [name, props] of Object.entries(frozen)) {
    const tree = renderComponent(react, set[name], props);
    assert.ok(tree !== null && tree !== undefined && tree.$$typeof === 'element', `${name} 必须能渲染出元素`);
  }
  // KeyValue 的三种 entries 形态
  assert.equal(textSafe(renderComponent(react, set.KeyValue, { entries: [['a', 1]] })).includes('a1'), true);
  assert.equal(textSafe(renderComponent(react, set.KeyValue, { entries: [{ key: 'b', value: 2 }] })).includes('b2'), true);
  assert.equal(textSafe(renderComponent(react, set.KeyValue, { entries: ['c'] })).includes('c'), true);
  // 空 entries ⇒ 空态
  assert.equal(findAttr(renderComponent(react, set.KeyValue, { entries: [] }), ANCHORS.state, 'empty').length, 1);
  // Empty / ErrorState 独立可用
  assert.equal(findAttr(renderComponent(react, set.Empty, {}), ANCHORS.state, 'empty').length, 1);
  assert.equal(findAttr(renderComponent(react, set.ErrorState, { error: 'x' }), ANCHORS.state, 'error').length, 1);
  assert.deepEqual([...STATE_VALUES], ['loading', 'empty', 'error']);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 错误边界接不住子树抛错（真机 blocker）—— 根因与三层保险
//   ① 调用点剥 children（本文件末尾的「错误态不带 children」用例 + 源码静态断言）
//   ② fallback 构造期抛错 ⇒ 同步 catch 退到静态最小节点
//   ③ fallback 的**输出子树**再抛错 ⇒ 由包在它外面的**同类边界**接住（repro B 分支的关键）
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('错误态一律**不带 children**：面板/列表/键值表/工具条的错误路径不得再渲染刚抛错的子树', () => {
  const { set, react } = panelHarness();
  const Marker = react.createElement('b', { 'data-testid': 'plugin-content' }, '插件内容');
  const withMarker = (props) => ({ ...props, children: Marker });

  const cases = [
    ['Panel 显式 error 态', () => renderComponent(react, set.Panel, withMarker({ id: 'x/1', state: 'error', error: '炸了' }))],
    ['Panel 非法 state（组装期抛错后走兜底）', () => renderComponent(react, set.Panel, withMarker({ id: 'x/1', state: 'wat' }))],
    ['Panel 推导出的 error 态', () => renderComponent(react, set.Panel, withMarker({ id: 'x/1', useSessions: (sel) => (typeof sel === 'function' ? sel({ state: 'error', items: [], error: { message: 'e' } }) : { state: 'error', items: [] }) }))],
    ['List 显式 error 态', () => renderComponent(react, set.List, withMarker({ items: [1], state: 'error', error: 'e' }))],
    ['KeyValue 显式 error 态', () => renderComponent(react, set.KeyValue, withMarker({ entries: [['k', 'v']], state: 'error', error: 'e' }))],
    ['Empty 显式 error 态', () => renderComponent(react, set.Empty, withMarker({ state: 'error', error: 'e' }))],
  ];
  for (const [name, render] of cases) {
    const tree = render();
    assert.equal(findAttr(tree, 'data-testid', 'plugin-content').length, 0, `${name}：错误视图里不得出现插件内容子树（它可能正是刚抛错的那棵）`);
    assert.equal(findAttr(tree, ANCHORS.state, 'error').length >= 1, true, `${name}：必须渲染出错误态锚点`);
  }

  // 源码级收口断言：不许再有 `errorView({ ...props, error })` / `stateView(..., { ...props, ... })` 这种形态
  const source = readPanelShellSource();
  const rawSpreads = source.match(/(?:errorView|stateView)\([^)]*\{\s*\.\.\.props/g) ?? [];
  assert.deepEqual(rawSpreads, [], `components.mjs 里仍有把整个 props（含 children）传进错误/状态视图的调用点：${rawSpreads.join(' | ')}`);
  assert.ok(source.includes('function errorProps('), '必须有统一的 errorProps(props, error) 收口函数');
  const callSites = (source.match(/errorProps\(/g) ?? []).length;
  assert.ok(callSites >= 8, `所有错误路径都要走 errorProps 收口（当前 ${callSites} 处：定义 1 + 调用点）`);
});

/** 剥掉边界自己套的那层「fallback 保险」外壳（`guard:false` 的同类边界），拿到真正渲染的节点。 */
function unwrapGuard(node, Boundary) {
  let current = Array.isArray(node) ? node[0] : node;
  let depth = 0;
  while (current !== null && current !== undefined && current.type === Boundary && depth < 4) {
    const children = current.props?.children;
    current = Array.isArray(children) ? children[0] : children;
    depth += 1;
  }
  return current;
}

test('边界保险（裸类）：fallback 抛错退到静态最小错误节点；失败态**绝不返回 null**', () => {
  const { react } = panelHarness();
  const Boundary = createRenderBoundary(react);

  // ② fallback 构造期就抛错 ⇒ 同步 catch，返回静态最小节点（不是 null、不是抛出去）
  const throwing = new Boundary({ renderError: () => { throw new Error('fallback 构造期炸了'); } });
  throwing.state = { failed: true, error: new Error('原始错因') };
  const outer = throwing.render();
  assert.notEqual(outer, null, '失败态绝不返回 null');
  const node = unwrapGuard(outer, Boundary);
  assert.equal(node.props[MINIMAL_ERROR_ATTR], MINIMAL_ERROR_KIND);
  assert.equal(node.props['data-guif-state'], MINIMAL_ERROR_STATE);
  const text = textSafe(node);
  assert.ok(text.includes('原始错因'), '最小节点要保留原始错因');
  assert.ok(text.includes('fallback 构造期炸了'), '同时说明兜底自己也失败了');

  // 没有 renderError ⇒ 仍然要有可见节点（绝不 null / 绝不空白）
  const bare = new Boundary({});
  bare.state = { failed: true, error: 'E-无 fallback' };
  const bareNode = unwrapGuard(bare.render(), Boundary);
  assert.equal(bareNode.props[MINIMAL_ERROR_ATTR], MINIMAL_ERROR_KIND);
  assert.ok(textSafe(bareNode).includes('E-无 fallback'));

  // ③ fallback 的**输出子树**被包进一层同类边界（`guard:false`）—— 这是 repro B 分支转 caught 的机制
  const normal = new Boundary({ renderError: () => react.createElement('div', { 'data-testid': 'fb' }, 'FB') });
  normal.state = { failed: true, error: 'E' };
  const wrapped = normal.render();
  assert.equal(wrapped.type, Boundary, 'fallback 的输出必须再包一层同类边界');
  assert.equal(wrapped.props.guard, false, '嵌套实例不得再往下套（否则无限嵌套）');
  const inner = Array.isArray(wrapped.props.children) ? wrapped.props.children[0] : wrapped.props.children;
  assert.equal(inner.props['data-testid'], 'fb', '包的是 fallback 自己的输出，不是抛错的 children');
  const deep = new Boundary({ guard: false, renderError: () => react.createElement('div', null, 'D') });
  deep.state = { failed: true, error: 'E' };
  assert.equal(deep.render().type, 'div', 'guard:false ⇒ 不再套第二层');

  // 正常路径不受影响：未失败 + 无 children ⇒ null；有 children ⇒ 原样返回
  assert.equal(new Boundary({}).render(), null, '未失败且无 children 时返回 null 是正常的');
  const child = react.createElement('b', null, 'c');
  assert.equal(new Boundary({ children: child }).render(), child, '未失败时原样渲染 children');

  // 上报链自己抛错不得冒泡
  const reporting = new Boundary({
    renderError: () => { throw new Error('fallback 炸了'); },
    onError: () => { throw new Error('上报炸了'); },
  });
  reporting.state = { failed: true, error: 'E' };
  assert.doesNotThrow(() => reporting.render(), '上报抛错绝不能连坐渲染');
});

test('最小错误节点的形状是**静态**的：不读 props、不碰种子/样式表/文案表', () => {
  const { react } = panelHarness();
  const Boundary = createRenderBoundary(react);
  const instance = new Boundary({ guard: false, renderError: () => { throw new Error('x'); } });
  instance.state = { failed: true, error: '主错因' };
  const node = instance.render();
  assert.equal(node.type, 'div', '最小节点是纯宿主 div');
  assert.deepEqual(Object.keys(node.props).sort(), [MINIMAL_ERROR_ATTR, 'children', 'data-guif-state'].sort(), 'props 只有锚点与 children（不转发任何调用方 props）');
  const children = node.props.children;
  assert.equal(children.length, 3, '标题 + 原始错因 + 兜底自己的错因（两者文本不同 ⇒ 都画出来）');
  assert.equal(children[0].type, 'div');
  assert.equal(children[1].type, 'code');
  assert.equal(textSafe(children[1]), '主错因');
  assert.equal(children[2].type, 'code');
  assert.equal(textSafe(children[2]), 'x', '兜底失败的错因也要露出来（否则"为什么变兜底了"查不到）');
  // 两处锚点都写死在节点上（真机/E2E 可直接 query）
  assert.equal(node.props['data-guif-state'], MINIMAL_ERROR_STATE);
  assert.equal(node.props[MINIMAL_ERROR_ATTR], MINIMAL_ERROR_KIND);

  // 同文本的明细不重复画（同一次抛错会在两层里各出现一次）
  const same = new Boundary({ guard: false, renderError: () => { throw new Error('同一句'); } });
  same.state = { failed: true, error: '同一句' };
  const deduped = same.render();
  assert.equal(deduped.props.children.length, 2, '主错因与明细同文本 ⇒ 只画一行');
  assert.equal(textSafe(deduped.props.children[1]), '同一句');

  // 错误值形态千奇百怪：不可序列化的值也不能让兜底节点抛错
  for (const weird of [null, undefined, 0, false, { toString() { throw new Error('toString 炸了'); } }]) {
    const odd = new Boundary({ guard: false });
    odd.state = { failed: true, error: weird };
    assert.doesNotThrow(() => odd.render(), `错误值（typeof=${typeof weird}）不得让兜底节点抛错`);
    assert.equal(odd.render().props['data-guif-state'], MINIMAL_ERROR_STATE);
  }
});

test('KeyValue 值槽：只有 React 元素被套边界，字符串/数字保持原样（纯数据不包）', () => {
  const h = createDockHarness();
  const set = createComponents({ seeds: h.seeds });
  const react = h.seeds.react;
  const boundaries = (tree) => shallowFind(tree, (node) => node.type === set.boundary);

  // ① 纯数据（字符串 + 数字）⇒ 一条边界都不套
  const plain = set.KeyValue({ entries: [['k-str', '纯文本'], ['k-num', 42]] });
  assert.equal(boundaries(plain).length, 0, '字符串/数字值不得被套边界（不过度扩面的负控口径）');
  assert.equal(textSafe(plain).includes('纯文本'), true);
  assert.equal(textSafe(plain).includes('42'), true);

  // ② 元素值 ⇒ 恰好一条边界，键带该值的下标
  const withElement = set.KeyValue({ entries: [['k-str', '纯文本'], ['k-el', react.createElement('b', null, '元素值')]] });
  assert.equal(boundaries(withElement).length, 1, '元素值必须落在边界内');
  assert.deepEqual(boundaries(withElement).map((node) => node.key), ['keyvalue-value-1'], '边界键必须带该值的下标（第 2 条 = 1）');

  // ③ 混合输入 ⇒ 只有元素那条被包
  const mixed = set.KeyValue({ entries: [['a', 1], ['b', react.createElement('i', null, 'x')], ['c', 'text']] });
  assert.deepEqual(boundaries(mixed).map((node) => node.key), ['keyvalue-value-1'], '混合输入下只有元素值被包（下标 1）');

  // ④ 源码级：条件必须写在 `isElementNode(field.value)` 上（不是无条件包、也不是按别的判据）
  const source = readPanelShellSource();
  assert.match(
    source,
    /isElementNode\(field\.value\)\s*\?\s*guardSlot\(`keyvalue-value-\$\{index\}`/,
    '值槽的边界必须是「仅当值为元素」的条件表达式',
  );
  assert.match(source, /function isElementNode\(value\)\s*\{[\s\S]*?\$\$typeof/, 'isElementNode 必须按 $$typeof 判元素');
});
