/**
 * non-specialized.test.mjs —— 判据组二：**证明修复不是特例化**。
 *
 * 验收原话：「另造至少两种不同形态的抛错子树（如 List 行内抛错、深层嵌套抛错、Toolbar 内抛错）
 * 同样被壳接住」。本文件用**三种形态**（Toolbar 子节点 / 深层嵌套 / List 行内组件），
 * 外加三条边界形态（无 renderError / renderError 返回 null / 有毒错误值）。
 *
 * 判定口径（与真路径分支同一条）：`escaped=false` + 面板根与 header/body 仍在 + 错误态节点在面板内
 * + **不落兜底节点**（落兜底 = fallback 自己又炸了一次，说明接住的方式不对）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCriteria } from './criteria.mjs';

const report = await runCriteria();
const byId = new Map(report.results.map((row) => [row.id, row]));
const expectPass = (id) => {
  const row = byId.get(id);
  assert.ok(row !== undefined, `判据 ${id} 不存在`);
  assert.equal(row.passed, true, `判据 ${id} 未通过：${row.detail}`);
  return row;
};

test('形态一：Toolbar 的子节点抛错 ⇒ 壳接住（面板树不卸载）', () => {
  const row = expectPass('R_S1_toolbar_child_throws');
  assert.match(row.detail, /escaped=false/);
  assert.match(row.detail, /errorInsidePanel=true/);
  assert.match(row.detail, /minimalNode=false/);
});

test('形态二：深层嵌套（Panel>div>section>Toolbar>span>span>Boom）抛错 ⇒ 壳接住', () => {
  const row = expectPass('R_S2_deep_nested_throws');
  assert.match(row.detail, /escaped=false/);
  assert.match(row.detail, /errorInsidePanel=true/);
  assert.match(row.detail, /minimalNode=false/);
});

test('形态三：List 的 renderItem **返回**一个渲染期抛错的组件 ⇒ 壳接住', () => {
  const row = expectPass('R_S3_list_row_component_throws');
  assert.match(row.detail, /escaped=false/);
  assert.match(row.detail, /errorInsidePanel=true/);
  assert.match(row.detail, /minimalNode=false/);
});

test('边界形态：完全没有 renderError 也绝不空白（落到兜底节点也算达标）', () => {
  const row = expectPass('R_E1_no_renderError_still_renders');
  assert.match(row.detail, /escaped=false/);
  assert.match(row.detail, /minimalNode=true/);
});

test('边界形态：renderError 返回 null ⇒ 失败态仍不得渲染成空白', () => {
  const row = expectPass('R_E2_failure_never_null');
  assert.match(row.detail, /escaped=false/);
  assert.match(row.detail, /minimalNode=true/);
});

test('边界形态：错误值的 message/toString 都抛 ⇒ 兜底节点仍画得出来', () => {
  const row = expectPass('R_E3_poisoned_error_value');
  assert.match(row.detail, /escaped=false/);
  assert.match(row.detail, /minimalNode=true/);
});
