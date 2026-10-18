/**
 * boundary-independent.test.mjs —— 判据组一：**四分支复现**（独立重写的一遍）。
 *
 * 与 `tests/client/repro-boundary.mjs`（qa-eng 的脚本）**不共用代码**：这里用本目录自备的
 * harness 重新挂载 A/B/C/D 四个分支，并按**自己写的**判据判定（DOM 锚点写死在 harness 里）。
 * 「R_*」判据的判定逻辑集中在 criteria.mjs，本文件负责把它们与验收要求一一对上。
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

test('四分支 A/B/C/D 全部 caught 且 DOM 非空（独立重写，不跑对方的脚本）', () => {
  for (const id of ['R_A_simple_fallback', 'R_B_fallback_renders_throwing_child', 'R_C_panel_catches_child', 'R_D_errorstate_fallback']) {
    expectPass(id);
  }
});

test('A 分支：简单 fallback 必须画出来（没有逃逸）', () => {
  const row = expectPass('R_A_simple_fallback');
  assert.match(row.detail, /escaped=false/);
});

test('B 分支：fallback 再渲染抛错的 children ⇒ 必须被**兜底节点**接住（不是 uncaught、不是空白）', () => {
  const row = expectPass('R_B_fallback_renders_throwing_child');
  assert.match(row.detail, /escaped=false/, 'B 分支发生逃逸（React 把整棵树卸载）');
  assert.match(row.detail, /minimalNode=true/, 'B 分支未落到静态最小错误节点');
});

test('C 分支：真路径 <Panel><Boom/></Panel> ⇒ 壳错误态出现且用不上兜底节点', () => {
  const row = expectPass('R_C_panel_catches_child');
  assert.match(row.detail, /panelAlive=true/);
  assert.match(row.detail, /errorInsidePanel=true/);
  assert.match(row.detail, /minimalNode=false/, '落到了兜底节点 ⇒ 说明 fallback 自己又炸了一次（子树泄漏）');
});

test('D 分支：ErrorState 形态的 fallback 同样干净接住', () => {
  const row = expectPass('R_D_errorstate_fallback');
  assert.match(row.detail, /errorState=true/);
  assert.match(row.detail, /minimalNode=false/);
});

test('判据集的锚点与被测方导出一致（防止锚点改名后判据静默失效）', () => {
  expectPass('R_anchor_agreement');
});
