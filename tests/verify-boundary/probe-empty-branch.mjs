/**
 * probe-empty-branch.mjs —— `Empty.children` 槽的**证据 + 期望**一体脚本。
 *
 * 【它证什么】`Empty` 已改成 `resolved.state === 'empty'` 走 `emptyView(props)`、
 * 槽位隔离交给 `guardSlot('empty-children', …)`，于是同一段矩阵吃到的是期望态。这是**设计行为**：
 * 本脚本不改成恒真，而是把两侧都写成显式 verdict —— 槽位回到死态时照样能红。
 *
 * 【用法】`node tests/verify-boundary/probe-empty-branch.mjs`
 * 退出码：0 = `EMPTY_SLOT_ALIVE`；1 = `EMPTY_SLOT_DEAD`（回到死槽）或 `MATRIX_UNEXPECTED`。
 *
 * 【期望矩阵（**不是**"所有 state 都要渲染 children"）】
 *   ① 默认 / empty 路径（`undefined` / `null` / `"ready"` / `"empty"`）⇒ children **必须渲染**
 *   ② loading ⇒ children 不渲染（既定裁定，**不作正向判据**，只记录）
 *   ③ error ⇒ children **必须仍被剥**（反向钉桩：失败态不回退）
 *
 * 只读：不写包内任何文件。
 */
import { createPrimitivesStub, loadReact, loadSource, mountNode, readSourceText, setupDom } from './harness.mjs';

const say = (text) => console.log(text);

await setupDom();
const react = await loadReact();
const el = react.createElement;
const { createPanelComponents } = await loadSource('client/panel/index.mjs');
const { normalizeState } = await loadSource('client/panel/state.mjs');
const comps = createPanelComponents({ seeds: { react, primitives: createPrimitivesStub(react) }, note: () => {} });

const MARK = 'EMPTY-CHILD-MARK';

say('【A】真实导出 normalizeState 的取值面（state prop 是唯一能影响 declared 的输入）');
const stateInputs = [
  ['undefined（未传）', undefined],
  ['null', null],
  ['"ready"', 'ready'],
  ['"loading"', 'loading'],
  ['"empty"', 'empty'],
  ['"error"', 'error'],
  ['"bogus"（非法）', 'bogus'],
];
for (const [label, value] of stateInputs) {
  let outcome;
  try {
    outcome = `'${normalizeState(value)}'`;
  } catch (error) {
    outcome = `throw（${String(error?.message ?? error).slice(0, 40)}…）`;
  }
  say(`   state=${label.padEnd(18)} → normalizeState ⇒ ${outcome}`);
}

say('');
say('【B】源码口径：Empty 现在怎么分流（本节只报告，不判定）');
const componentsText = readSourceText('client/panel/components.mjs');
const emptyBody = /function Empty\(rawProps\)[\s\S]*?\n {2}\}/.exec(componentsText)?.[0] ?? '';
const routesEmptyToEmptyView = /resolved\.state === 'empty'\)\s*return emptyView\(props\)/.test(emptyBody);
const sendsOtherStatesThroughCollector = /stateView\(resolved\.state,\s*errorProps\(/.test(emptyBody);
say(`   empty 态 → emptyView(props)（原 props、不剥 children）= ${routesEmptyToEmptyView}`);
say(`   其余态 → stateView(…, errorProps(…))                  = ${sendsOtherStatesThroughCollector}`);
say(`   槽位隔离：emptyView 里 ${/guardSlot\('empty-children'/.test(componentsText) ? '有' : '没有'} guardSlot('empty-children')`);

say('');
say('【C】组件级实测：同一个 children 交给 Empty，逐一喂 state，看 DOM 里出现没有');
const observations = [];
for (const [label, value] of stateInputs) {
  const props = { id: `empty-${String(value)}` };
  if (value !== undefined) props.state = value;
  const result = await mountNode(react, el(comps.Empty, props, el('span', null, MARK)));
  const rendered = result.text.includes(MARK);
  observations.push({ label, rendered });
  say(`   state=${label.padEnd(18)} → children 渲染？ ${String(rendered).padEnd(5)} （DOM 文本：${JSON.stringify(result.text.slice(0, 30))}）`);
}

say('');
say('【D】对照：List 的 derived 可以是 \'ready\'（items 非空），其 children 一直走渲染路径');
const listReady = await mountNode(react, el(comps.List, { id: 'l-ready', items: [1], renderItem: () => 'row' }, el('span', null, 'LIST-CHILD-MARK')));
say(`   List items=[1] + children → children 渲染？ ${listReady.text.includes('LIST-CHILD-MARK')}`);

// ── 判定 ──────────────────────────────────────────────────────────────────────────────────
const defaultEmptyInputs = ['undefined（未传）', 'null', '"ready"', '"empty"'];
const rendersOn = (label) => observations.find((row) => row.label === label)?.rendered === true;
const rendersOff = (label) => observations.find((row) => row.label === label)?.rendered === false;
const rule1 = defaultEmptyInputs.every(rendersOn);
const rule3 = rendersOff('"error"');
const rule2Loading = rendersOff('"loading"');

let verdict;
if (rule1 && rule3) verdict = 'EMPTY_SLOT_ALIVE';
else if (!rule1 && rule3) verdict = 'EMPTY_SLOT_DEAD';
else verdict = 'MATRIX_UNEXPECTED';

say('');
say(`【判定】① 默认/empty 路径渲染 children：${rule1}（输入：${defaultEmptyInputs.join(' / ')}）`);
say(`        ② loading 不渲染 children（既定裁定，仅记录）：${rule2Loading}`);
say(`        ③ error 路径仍剥 children（失败态反向钉桩）：${rule3}`);
say(`VERDICT ${verdict}`);
say('注：EMPTY_SLOT_DEAD = 回到「children 进不了 DOM」的死槽状态（须修实现，或更新本证据）；');
say('    MATRIX_UNEXPECTED = 出现「error 也渲染 children」这类失败态回退，或 loading 渲染了 children。');

process.exitCode = verdict === 'EMPTY_SLOT_ALIVE' ? 0 : 1;
