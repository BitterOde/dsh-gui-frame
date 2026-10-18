/**
 * panel-isolation.test.mjs —— **崩溃隔离面**必须覆盖「壳会渲染给调用方的每一个元素槽」。
 *
 * 判据：边界规则 / 8 处逃逸面逐一收口 / 正对照 / 负控（回调行为不变）/ 不过度扩面 /
 * Empty.children 死槽按冻结契约恢复渲染并进边界。
 *
 * 方法：**真 jsdom + 真 React**（devDependency），用 `createRoot` 的
 * `onCaughtError` / `onUncaughtError` 区分「被边界接住」与「逃逸到 React 根」——
 * 这正是真机上「官方 SlotErrorBoundary 兜成一个空 div」的前一步。
 * 本文件自带夹具（不 import tests/helpers/**、不 import tests/client/**），且**不写任何文件**。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

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

const reactNs = await import('react');
const react = reactNs.default ?? reactNs;
const { createRoot } = await import('react-dom/client');
const el = react.createElement;

const { createComponents } = await import('../../src/client/panel/components.mjs');

/** primitives 替身：只给官方 106 成员里的那 8 个，且**透传数据属性**（别把壳的锚点吃掉）。 */
function createPrimitivesStub() {
  const icon = (name) => function IconStub(props) {
    return el('svg', { 'data-primitive': name, width: props?.size ?? 16, height: props?.size ?? 16 });
  };
  const pass = (props, skip = []) => {
    const out = {};
    for (const [key, value] of Object.entries(props ?? {})) {
      if (skip.includes(key) || key === 'children') continue;
      out[key] = value;
    }
    return out;
  };
  return {
    Button: (props) => el('button', { type: 'button', ...pass(props, ['icon']), 'data-primitive': 'Button' }, props?.icon ?? null, props?.children ?? null),
    Tooltip: (props) => el('span', { 'data-primitive': 'Tooltip', title: typeof props?.label === 'string' ? props.label : undefined }, props?.children ?? null),
    Tag: (props) => el('span', { ...pass(props), 'data-primitive': 'Tag' }, props?.children ?? null),
    IconChevronRightOutlineRegular: icon('IconChevronRightOutlineRegular'),
    IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
    IconLoadingOutlineRegular: icon('IconLoadingOutlineRegular'),
    IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
    IconWarningOutlineRegular: icon('IconWarningOutlineRegular'),
  };
}

const notes = [];
const comps = createComponents({ seeds: { react, primitives: createPrimitivesStub() }, note: (code, message) => notes.push({ code, message }) });
const { Empty, KeyValue, List, Panel, Toolbar } = comps;

let seq = 0;
/** 挂载一个元素并等 React 落定；返回逃逸/捕获事件、DOM 与查询器。 */
async function mount(node) {
  seq += 1;
  const container = win.document.createElement('div');
  container.setAttribute('data-mount', String(seq));
  win.document.body.appendChild(container);
  const events = [];
  const messageOf = (error) => {
    try {
      return String(error?.message ?? error);
    } catch {
      return '<unreadable>';
    }
  };
  const root = createRoot(container, {
    onCaughtError: (error) => events.push(`caught:${messageOf(error)}`),
    onUncaughtError: (error) => events.push(`uncaught:${messageOf(error)}`),
  });
  const original = console.error;
  console.error = () => {};
  try {
    root.render(node);
    await new Promise((resolve) => setTimeout(resolve, 30));
  } catch (error) {
    events.push(`threw:${messageOf(error)}`);
  } finally {
    console.error = original;
  }
  const escaped = events.some((event) => event.startsWith('uncaught:') || event.startsWith('threw:'));
  return {
    container,
    events,
    escaped,
    html: container.innerHTML,
    text: container.textContent ?? '',
    query: (selector) => container.querySelector(selector),
    queryAll: (selector) => [...container.querySelectorAll(selector)],
    unmount: () => {
      const quiet = console.error;
      console.error = () => {};
      try {
        root.unmount();
      } finally {
        console.error = quiet;
      }
    },
  };
}

/** 渲染期必抛的组件。 */
function boom(label) {
  return function Boom() {
    throw new Error(label);
  };
}

/** 一条逃逸面的公共判据：不逃逸 + DOM 非空 + 出现有文案的错误态（错因必须真的画在屏幕上）。 */
function assertCaught(result, label, needle) {
  assert.equal(result.escaped, false, `${label}：错误逃逸到 React 根了（真机上＝官方 SlotErrorBoundary 的空 div）—— ${JSON.stringify(result.events)}`);
  assert.notEqual(result.text.trim(), '', `${label}：DOM 为空（空 div 正是要消灭的现象）`);
  const node = result.query('[data-guif-state="error"]');
  assert.ok(node !== null, `${label}：没有渲染出带 data-guif-state="error" 的错误态；DOM=${JSON.stringify(result.html.slice(0, 160))}`);
  assert.ok(result.text.includes(needle), `${label}：错误态里必须带错因文案「${needle}」（实测文本 ${JSON.stringify(result.text.slice(0, 120))}）`);
}

test('8 处逃逸面逐一收口（独立使用，无 Panel 包裹）', async (t) => {
  const cases = [
    ['① Panel.actions', 'VERIFY-actions', () => el(Panel, { id: 'p-actions', actions: el(boom('VERIFY-actions')) })],
    ['② 独立 Toolbar.children', 'VERIFY-toolbar-children', () => el(Toolbar, { id: 'tb-children' }, el(boom('VERIFY-toolbar-children')))],
    ['③ 独立 List.renderItem 返回组件', 'VERIFY-list-row', () => el(List, { id: 'li-row', items: [{ id: 'r1' }], renderItem: (item) => el(boom('VERIFY-list-row'), { key: item.id }) })],
    ['④ List.children', 'VERIFY-list-children', () => el(List, { id: 'li-children', items: [{ id: 'r1' }], renderItem: () => 'row' }, el(boom('VERIFY-list-children')))],
    ['⑤ List.empty', 'VERIFY-list-empty', () => el(List, { id: 'li-empty', items: [], empty: el(boom('VERIFY-list-empty')) })],
    ['⑥ KeyValue.children', 'VERIFY-kv-children', () => el(KeyValue, { entries: [['k', 'v']] }, el(boom('VERIFY-kv-children')))],
    ['⑦ Toolbar.items[].icon', 'VERIFY-toolbar-icon', () => el(Toolbar, { id: 'tb-icon', items: [{ id: 'a', label: 'A', icon: boom('VERIFY-toolbar-icon') }] })],
    ['⑧ Empty.action', 'VERIFY-empty-action', () => el(Empty, { title: '空', action: el(boom('VERIFY-empty-action')) })],
  ];
  for (const [label, needle, build] of cases) {
    const result = await mount(build());
    assertCaught(result, label, needle);
    t.diagnostic(`${label} → escaped=${result.escaped} events=${JSON.stringify(result.events)} text=${JSON.stringify(result.text.slice(0, 40))}`);
    result.unmount();
  }
});

test('KeyValue 的 **entries 值槽**：值为 React 元素时进边界；字符串/数字保持原样不套边界', async (t) => {
  // ① 值槽（`[k, el]` 形态）：抛错元素必须被接住，且退到**正常错误态**（不是兜底最小节点）
  const tupleForm = await mount(el(KeyValue, { entries: [['k-tuple', el(boom('VERIFY-kv-value-tuple'))]] }));
  assertCaught(tupleForm, 'KeyValue 值槽（[k, el]）', 'VERIFY-kv-value-tuple');
  assert.equal(tupleForm.query('[data-guif-boundary="minimal"]'), null, '走的是正常错误态，不该落兜底最小节点');
  t.diagnostic(`[k, el] → escaped=${tupleForm.escaped} events=${JSON.stringify(tupleForm.events)}`);
  tupleForm.unmount();

  // ② 值槽（`{key, value: el}` 形态）：同上
  const objectForm = await mount(el(KeyValue, { entries: [{ key: 'k-object', value: el(boom('VERIFY-kv-value-object')) }] }));
  assertCaught(objectForm, 'KeyValue 值槽（{key, value: el}）', 'VERIFY-kv-value-object');
  assert.equal(objectForm.query('[data-guif-boundary="minimal"]'), null, '走的是正常错误态，不该落兜底最小节点');
  objectForm.unmount();

  // ③ 值槽的正常元素（不抛）照常渲染 ⇒ 边界不改变正常路径
  const ok = await mount(el(KeyValue, { entries: [['k-ok', el('b', { 'data-testid': 'ok-value' }, '正常值')]] }));
  assert.equal(ok.escaped, false);
  assert.ok(ok.query('[data-testid="ok-value"]') !== null, '正常元素值必须照常渲染');
  assert.equal(ok.query('[data-guif-state="error"]'), null, '正常路径不得出现错误态');
  ok.unmount();

  // ④ 纯数据值（字符串/数字）**不套边界**：结构级证据见 panel-components.test.mjs 的 guardSlot 清单
  const text = await mount(el(KeyValue, { entries: [['k-str', '纯文本值'], ['k-num', 42]] }));
  assert.equal(text.escaped, false);
  assert.ok(text.text.includes('纯文本值') && text.text.includes('42'), '字符串/数字值照常渲染');
  text.unmount();
});

test('正对照：同一负载放进 Panel body 仍被接住，且壳保持存活（不落兜底最小节点）', async () => {
  const result = await mount(el(Panel, { id: 'p-body', label: '正对照' }, el(boom('VERIFY-body'))));
  assert.equal(result.escaped, false, `正对照逃逸了：${JSON.stringify(result.events)}`);
  const state = result.query('[data-guif-state="error"]');
  assert.ok(state !== null, '没有渲染出错误态');
  assert.match(state.textContent ?? '', /VERIFY-body/);
  // 壳本身必须还在（header/body/status 三段锚点 + 错误态在面板内部）
  assert.ok(result.query('[data-guif-panel="p-body"]') !== null, '面板根必须仍在（整棵树没被卸载）');
  assert.ok(result.query('[data-guif-panel-header="p-body"]') !== null, 'header 必须仍在');
  assert.ok(result.query('[data-guif-panel-body="p-body"]') !== null, 'body 必须仍在');
  assert.equal(
    result.query('[data-guif-boundary="minimal"]'),
    null,
    '正对照走的是**正常错误态**，不该退到静态最小节点（那是 fallback 自己也炸了才用的）',
  );
  result.unmount();
});

test('负控：扩面不得改变回调行为（Panel.close / Toolbar.onSelect / List.getKey 照常）', async () => {
  const tags = [];
  // Panel.close：渲染期不抛的静态标签回调
  const panel = await mount(el(Panel, { id: 'p-close', label: '负控', close: () => tags.push('close') }, el('div', null, '正文')));
  assert.equal(panel.escaped, false);
  assert.equal(panel.query('[data-guif-state="error"]'), null, '正常路径不得因为扩面而渲染错误态');
  const closeButton = panel.query('[data-guif-action="p-close::close"]');
  assert.ok(closeButton !== null, '关闭按钮必须渲染出来');
  closeButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(tags, ['close'], 'Panel.close 必须仍被调用（扩面不改变回调行为）');
  panel.unmount();

  // Toolbar.items[].onSelect
  const clicks = [];
  const toolbar = await mount(el(Toolbar, { id: 'tb-click', items: [{ id: 'refresh', label: '刷新', onSelect: (id) => clicks.push(id) }] }));
  const action = toolbar.query('[data-guif-action="refresh"]');
  assert.ok(action !== null, '动作按钮必须渲染出来');
  action.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(clicks, ['refresh'], 'onSelect 必须仍被调用（且参数是 action id）');
  toolbar.unmount();

  // List.getKey
  const keys = [];
  const list = await mount(el(List, {
    items: ['a', 'b'],
    getKey: (item, index) => {
      keys.push(`${item}:${index}`);
      return `k-${index}`;
    },
    renderItem: (item) => item,
  }));
  assert.equal(list.escaped, false);
  assert.deepEqual(keys, ['a:0', 'b:1'], 'getKey 必须仍被调用（每行一次，参数 item/index）');
  assert.equal(list.queryAll('[data-guif-row]').length, 2);
  list.unmount();
});

test('不过度扩面：正常路径零错误态，且边界只落在**元素槽**上（静态清单锁死）', async () => {
  const result = await mount(el(Panel, {
    id: 'p-normal',
    label: '正常',
    actions: el('span', { 'data-testid': 'act' }, '动作'),
    close: () => {},
  },
  el(Toolbar, { id: 'tb-normal', items: [{ id: 'a', label: 'A', onSelect: () => {} }] },
    el('span', { 'data-testid': 'tb-child' }, '工具条子节点')),
  el(List, { id: 'li-normal', items: ['x', 'y'], renderItem: (item) => item, empty: el('span', null, '空') }),
  el(KeyValue, { entries: [['k', 'v']] }),
  el(Empty, { title: '空', description: '说明', action: el('button', { type: 'button' }, '去创建') })));
  assert.equal(result.escaped, false);
  assert.equal(result.query('[data-guif-state="error"]'), null, '正常路径不得出现任何错误态（边界不该被"见元素就包"地滥用）');
  assert.equal(result.query('[data-guif-boundary="minimal"]'), null, '正常路径不得出现兜底节点');
  assert.ok(result.query('[data-testid="act"]') !== null, 'actions 正常内容照常渲染');
  assert.ok(result.query('[data-testid="tb-child"]') !== null, 'Toolbar.children 正常内容照常渲染');
  assert.equal(result.queryAll('[data-guif-row]').length, 2, 'List 正常行数不变');
  assert.match(result.text, /说明/, 'Empty.description 正常渲染');
  result.unmount();

  // 静态清单：guardSlot 的**键集合**必须恰好是这些元素槽（多一个/少一个都要在这里显式改）
  // ★ 面板壳拆出 `components/{views,shell}.mjs` ⇒ 扫描面取**并集**
  //   （键集合与断言一字未改；本文件仍**自带夹具**，只是把「扫描哪个文件」跟着实现走）
  const { readFileSync } = await import('node:fs');
  const source = ['components.mjs', 'components/views.mjs', 'components/shell.mjs']
    .map((rel) => readFileSync(new URL(`../../src/client/panel/${rel}`, import.meta.url), 'utf8'))
    .join('\n');
  const keys = [...source.matchAll(/guardSlot\(\s*'([^']+)'/g)].map((match) => match[1]);
  const withParam = [...source.matchAll(/guardSlot\(\s*`([^`]+)\$\{/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(keys)].sort(),
    ['empty-action', 'empty-children', 'empty-description', 'error-children', 'keyvalue-children', 'list-children', 'list-empty', 'panel-actions', 'toolbar-children'],
    `guardSlot 的静态键集合变了（新增/删除了被隔离的槽位）：${JSON.stringify([...new Set(keys)].sort())}`,
  );
  assert.deepEqual(withParam, ['toolbar-item-', 'list-row-', 'keyvalue-value-'], '带参键（每个动作 / 每一行 / 每个元素值）必须仍逐项包裹');
  // 反向：纯数据 props 不得被包（避免"见元素就包"）
  for (const dataProp of ['label', 't', 'entries', 'getKey', 'onSelect', 'title']) {
    assert.equal(
      new RegExp(`guardSlot\\([^)]*\\b${dataProp}\\b`).test(source),
      false,
      `纯数据 props「${dataProp}」被误包进边界了（A5 禁止过度扩面）`,
    );
  }
});

test('Empty.children：按冻结契约恢复渲染，且同样落在边界里', async () => {
  // ① 正常渲染（死槽复活）：children 必须出现在 DOM 里
  const normal = await mount(el(Empty, { title: '空空' }, el('b', { 'data-testid': 'empty-child' }, '自定义空态内容')));
  assert.equal(normal.escaped, false);
  assert.ok(normal.query('[data-testid="empty-child"]') !== null, 'Empty.children 必须被渲染（冻结契约声明 Empty 接受 children）');
  assert.match(normal.text, /自定义空态内容/);
  normal.unmount();

  // ② 同一个槽里放抛错组件 ⇒ 被接住（说明它确实在边界内，而不是"复活了但裸奔"）
  const caught = await mount(el(Empty, { title: '空空' }, el(boom('VERIFY-empty-children'))));
  assertCaught(caught, 'Empty.children', 'VERIFY-empty-children');
  caught.unmount();

  // ③ 空态其余两个槽（description）同样在边界内
  const desc = await mount(el(Empty, { title: '空空', description: el(boom('VERIFY-empty-description')) }));
  assertCaught(desc, 'Empty.description', 'VERIFY-empty-description');
  desc.unmount();

  // ④ ErrorState.children（元素槽）也在边界内
  const errorChildren = await mount(comps.ErrorState({ error: '主错因', children: el(boom('VERIFY-error-children')) }));
  assertCaught(errorChildren, 'ErrorState.children', 'VERIFY-error-children');
  errorChildren.unmount();
});

test('隔离面扩面后，诊断上报仍走同一套：捕获必须记 GUIF-W-LISTENER-THREW', async () => {
  const before = notes.length;
  const result = await mount(el(Toolbar, { id: 'tb-report' }, el(boom('VERIFY-report'))));
  assert.equal(result.escaped, false);
  assert.ok(
    notes.slice(before).some((row) => row.code === 'GUIF-W-LISTENER-THREW' && /VERIFY-report/.test(row.message)),
    `扩展后的槽位捕获也必须走壳内上报（当前新增 ${JSON.stringify(notes.slice(before))}）`,
  );
  result.unmount();
});

test.after(() => {
  dom.window.close();
});
