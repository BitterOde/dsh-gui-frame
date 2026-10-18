/**
 * surface-matrix.test.mjs —— 判据组五：**扩面全矩阵**（8 处逃逸面 + 同类元素槽 + 两组负控）。
 *
 * 本文件不自己造夹具，只消费 `criteria.mjs` 的自写判据（同一套 harness、同一套 DOM 锚点），
 * 把「覆盖口径」逐条钉死：
 *   R_G1..R_G12 —— 8 处逃逸面 + `Empty.children` / `ErrorState.children` / `Empty.description`
 *                  （同类元素槽）+ Panel body 正对照：**每一条都必须被接住**（escaped=false +
 *                  渲染出含抛错消息的错误态 + 不落兜底节点）。
 *   R_N1..R_N4 —— 两组负控：不过度扩面（纯数据 props 的 thunk 抛错不得变成错误态）＋
 *                  行不为变（`Panel.close` / `items[].onSelect` / `List.getKey` 行为逐条不变）。
 *   R_M1..R_M3 —— 空态矩阵：默认/empty 渲染 children ＋ error 仍剥（失败态反向钉桩）＋ loading 仅记录。
 *   R_GAP      —— 已发现的同类缺口（`KeyValue` 值槽）**钉缺陷现状**；修好后本判据变红。
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

/** 覆盖清单（8 处逃逸面按同一顺序）。 */
const SURFACES = [
  ['R_G1_panel_actions', 'Panel.actions'],
  ['R_G2_toolbar_children_standalone', '独立 Toolbar.children'],
  ['R_G3_list_renderItem_element_standalone', '独立 List.renderItem 返回组件'],
  ['R_G4_list_children_standalone', 'List.children'],
  ['R_G5_list_empty_slot_standalone', 'List.empty'],
  ['R_G6_keyvalue_children_standalone', 'KeyValue.children'],
  ['R_G7_toolbar_item_icon_standalone', 'Toolbar.items[].icon'],
  ['R_G8_empty_action_standalone', 'Empty.action'],
];

test('8 处逃逸面逐条必须被接住（独立使用，不靠 Panel 包裹）', () => {
  for (const [id, label] of SURFACES) {
    const row = expectPass(id);
    assert.match(row.detail, /escaped=false/, `${label} 仍逃逸：${row.detail}`);
    assert.match(row.detail, /errNodes=[1-9]/, `${label} 没有错误态节点：${row.detail}`);
    assert.match(row.detail, /minimalNode=false/, `${label} 落到了兜底节点：${row.detail}`);
  }
});

test('同类元素槽（后补的三处）同样被接住', () => {
  for (const id of ['R_G9_empty_children_standalone', 'R_G10_errorstate_children_standalone', 'R_G11_empty_description_standalone']) {
    expectPass(id);
  }
});

test('正对照：Panel body 里的同一抛错仍被接住（扩面没把老路径改坏）', () => {
  const row = expectPass('R_G12_positive_control_in_panel_body');
  assert.match(row.detail, /escaped=false/);
});

test('负控一：不过度扩面 —— 纯数据 props（label thunk 抛错）不得被变成错误态', () => {
  const row = expectPass('R_N1_throwing_label_is_not_an_error_state');
  assert.match(row.detail, /errNode=false/, `label thunk 抛错被当成渲染错误了（过度扩面）：${row.detail}`);
  assert.match(row.detail, /正文/, '正常内容没渲染出来');
});

test('负控二：行不为变 —— close / onSelect / getKey 行为逐条不变', () => {
  expectPass('R_N2_close_callback_still_fires_once');
  expectPass('R_N3_onSelect_still_fires_once');
  const keys = expectPass('R_N4_getKey_shape_unchanged');
  assert.match(keys.detail, /"a:0","b:1"/, `getKey 形状变了：${keys.detail}`);
});

test('空态矩阵：默认/empty 渲染 children＋error 仍剥（失败态不回退）＋loading 仅记录', () => {
  const m1 = expectPass('R_M1_empty_renders_children_on_default_empty');
  assert.match(m1.detail, /"undefined":true/);
  assert.match(m1.detail, /"null":true/);
  assert.match(m1.detail, /"ready":true/);
  assert.match(m1.detail, /"empty":true/);
  expectPass('R_M2_error_state_still_strips_children');
  expectPass('R_M3_loading_does_not_render_children');
});

test('KeyValue 值槽已收口：元素值被接住（两种 entries 形态）＋ 纯数据不套边界', () => {
  for (const id of ['R_KV1_keyvalue_value_element_caught_tuple', 'R_KV1_keyvalue_value_element_caught_object']) {
    const row = expectPass(id);
    assert.match(row.detail, /escaped=false/, `${id} 仍逃逸：${row.detail}`);
    assert.match(row.detail, /errNodes=[1-9]/, `${id} 没有错误态节点：${row.detail}`);
    assert.match(row.detail, /minimalNode=false/, `${id} 落到了兜底节点：${row.detail}`);
  }
  const plain = expectPass('R_KV2_plain_values_get_no_boundary');
  assert.match(plain.detail, /边界数=0/, `纯数据被套了边界（过度扩面）：${plain.detail}`);
  assert.match(plain.detail, /元素值边界数=1/, `元素值没有套边界：${plain.detail}`);
});
