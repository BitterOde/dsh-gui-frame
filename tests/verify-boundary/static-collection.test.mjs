/**
 * static-collection.test.mjs —— 判据组三：**静态复核收口面**。
 *
 * 验收原话：「静态复核 components.mjs 里同形态的 errorView 调用点均已收口」。
 * 本文件在 criteria 的 S_* 判据之外，再把「收口规则」本身与**历史肇事点**逐条钉住：
 *   - `errorProps` 必须剥 `children`；
 *   - 每个 `errorView(...)` 调用点的实参要么是 `errorProps(...)`，要么是 `stateView` 体内的 `props`
 *     （而 `stateView` 的每个调用点第二参数又必须是 `errorProps(...)`）；
 *   - Panel 的 `renderError` 是失败态的肇事点，单独点名；
 *   - 第三层保险（fallback 输出再套同类边界 + 失败态不返回 null）必须在位。
 *
 * 注：本文件只读源码文本，**不改任何 src**；注释先剥掉再判（注释里的示例不算代码）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSourceText } from './harness.mjs';
import { runCriteria } from './criteria.mjs';

const report = await runCriteria();
const byId = new Map(report.results.map((row) => [row.id, row]));
const expectPass = (id) => {
  const row = byId.get(id);
  assert.ok(row !== undefined, `判据 ${id} 不存在`);
  assert.equal(row.passed, true, `判据 ${id} 未通过：${row.detail}`);
  return row;
};

test('errorProps 必须剥掉 children（第一层修复）', () => {
  const row = expectPass('S_1_errorProps_strips_children');
  assert.match(row.detail, /children:null/, `errorProps 里看不到 children: null：${row.detail}`);
  // 再独立读一次源码（不信判据的摘录）：函数体里必须有 `children: null`
  const text = readSourceText('client/panel/components.mjs');
  const body = /function errorProps\([\s\S]*?\n {2}\}/.exec(text)?.[0] ?? '';
  assert.match(body, /children:\s*null/, 'errorProps 函数体里没有 `children: null`');
});

test('所有 errorView 调用点均已收口（8 个调用点，0 个裸传 props）', () => {
  const row = expectPass('S_2_all_errorView_calls_collected');
  assert.match(row.detail, /未收口的直接调用 0 个/);
  assert.match(row.detail, /第二参数未收口 0 个/);
});

test('Panel 的 renderError（失败态肇事点）走 errorProps', () => {
  expectPass('S_3_panel_renderError_collected');
});

test('boundary 第三层保险在位（fallback 输出再套同类边界 + 失败态兜底节点）', () => {
  expectPass('S_4_boundary_third_layer_present');
});

test('收口不是「只改了一处」：调用点数量下限 + 逐点实参形状', () => {
  const text = readSourceText('client/panel/components.mjs');
  const isDefinition = (index) => /function\s*$/.test(text.slice(Math.max(0, index - 10), index));
  const calls = [...text.matchAll(/errorView\(/g)].filter((match) => !isDefinition(match.index));
  assert.ok(calls.length >= 8, `errorView 调用点只有 ${calls.length} 个，少于下限 8`);
  // 裸传 props 的只允许有一个（stateView 内那个），且必须紧跟在 state === 'error' 判断里
  const bareProps = [...text.matchAll(/errorView\(props\)/g)].filter((match) => !isDefinition(match.index));
  assert.ok(bareProps.length <= 1, `errorView(props) 出现 ${bareProps.length} 次（定义处已排除），收口面可能有漏网`);
  if (bareProps.length === 1) {
    const around = text.slice(Math.max(0, bareProps[0].index - 80), bareProps[0].index);
    assert.match(around, /state === 'error'/, '唯一允许的 errorView(props) 不在 stateView 的 error 分支里');
  }
});
