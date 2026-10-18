/**
 * anti-false-green.test.mjs —— 判据组四：**变异反假绿**。
 *
 * 思路：把 `src/**` 整棵复制到 TEMP，**只动一处**（锚点出现次数必须恰好 1，否则本测试自己失败，
 * 不允许「变异没打上」被当成「判据有牙齿」），再用 `GUIF_VERIFY_ROOT=<TEMP>` 让**同一套判据**
 * 去跑变异副本。判据红了 ⇒ 它真的在测这条修复；判据还绿 ⇒ 它没有牙齿。
 *
 * 另有一条**阴性对照**（no-op 变异）：原样复制、一字不改，判据必须仍然全绿 —— 排除
 * 「TEMP 副本加载失败导致的假红」。
 *
 * 不写包内任何文件；TEMP 目录用完即删。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HERE, PKG_DIR } from './harness.mjs';

const CRITERIA = path.join(HERE, 'criteria.mjs');

/** 造一棵 TEMP 副本（`src/**`）。 */
function makeCopy(tag) {
  const root = mkdtempSync(path.join(tmpdir(), `guif-t28-${tag}-`));
  cpSync(path.join(PKG_DIR, 'src'), path.join(root, 'src'), { recursive: true });
  return root;
}

/**
 * 在副本里做一处**定点**替换（锚点必须恰好出现 1 次），并**读回自证已落盘**。
 * 自证三件：① 写盘后 `from` 在文件里 0 次；② `to` 出现 1 次；③ 内容与预期一致。
 * 少了这三件，「变异静默没生效 ⇒ 判据全绿」会被误读成「判据没牙齿」。
 */
function patch(root, rel, from, to) {
  // ★ 面板壳拆件 ⇒ 锚点按**并集**找，落在哪个文件就改哪个文件
  //   （**自证三件不变**：出现 1 次 / 落盘后 0 次 / 内容逐字等于预期）。
  const candidates = rel === 'client/panel/components.mjs'
    ? [rel, 'client/panel/components/views.mjs', 'client/panel/components/shell.mjs']
    : [rel];
  const hit = candidates
    .map((one) => ({ one, file: path.join(root, 'src', ...one.split('/')) }))
    .find(({ file }) => readFileSync(file, 'utf8').includes(from));
  const target = hit === undefined ? path.join(root, 'src', ...rel.split('/')) : hit.file;
  const file = target;
  const text = readFileSync(file, 'utf8');
  const occurrences = text.split(from).length - 1;
  assert.equal(occurrences, 1, `变异锚点在 ${rel} 出现 ${occurrences} 次（要求恰好 1 次）：${JSON.stringify(from)}`);
  const next = text.replace(from, to);
  writeFileSync(file, next, 'utf8');
  const readBack = readFileSync(file, 'utf8');
  assert.equal(readBack.split(from).length - 1, 0, `变异未落盘：替换后 ${rel} 里仍能找到原锚点`);
  assert.ok(readBack.includes(to), `变异未落盘：替换后 ${rel} 里找不到替换文本 ${JSON.stringify(to)}`);
  assert.notEqual(readBack, text, `变异未落盘：${rel} 内容没变`);
  assert.equal(readBack, next, `变异落盘内容与预期不一致（${rel}）`);
}

/** 用同一套判据跑指定源码根（子进程；顺带验证 criteria.mjs 的 CLI 路径可用）。 */
function runCriteriaAt(root) {
  const result = spawnSync(process.execPath, [CRITERIA], {
    encoding: 'utf8',
    env: { ...process.env, GUIF_VERIFY_ROOT: root },
    maxBuffer: 32 * 1024 * 1024,
  });
  const line = (result.stdout ?? '').split(/\r?\n/).find((row) => row.startsWith('VERIFY-RESULT '));
  const parsed = line === undefined ? null : JSON.parse(line.slice('VERIFY-RESULT '.length));
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', parsed };
}

/** 断言「某几个判据必须红」，并打印整份结果便于定位。 */
function assertRed(result, expectedIds, label) {
  assert.notEqual(result.status, 0, `${label}：变异后判据仍然全绿（退出码 0）⇒ 该判据没有牙齿\n${result.stdout}`);
  assert.ok(result.parsed !== null, `${label}：没解析到 VERIFY-RESULT 行\n${result.stdout}\n${result.stderr}`);
  for (const id of expectedIds) {
    assert.ok(
      result.parsed.failed.includes(id),
      `${label}：期望判据 ${id} 变红，实际红的是 ${JSON.stringify(result.parsed.failed)}\n${result.stdout}`,
    );
  }
}

test('阴性对照：TEMP 副本一字不改 ⇒ 判据必须仍然全绿（排除假红）', (t) => {
  const root = makeCopy('noop');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = runCriteriaAt(root);
  assert.equal(result.status, 0, `no-op 副本上判据红了 ⇒ 复制/加载有问题（不是修复的问题）\n${result.stdout}\n${result.stderr}`);
  assert.deepEqual(result.parsed?.failed, [], 'no-op 副本上仍有失败判据');
  assert.ok((result.parsed?.total ?? 0) >= 15, `判据数量异常：${result.parsed?.total}`);
});

test('变异①：把 errorProps 还原成 `{ ...source }`（不剥 children）⇒ 子树泄漏判据必须红', (t) => {
  const root = makeCopy('m1');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  patch(root, 'client/panel/components.mjs', 'const next = { ...source, children: null };', 'const next = { ...source };');
  const result = runCriteriaAt(root);
  assertRed(result, ['R_C_panel_catches_child', 'S_1_errorProps_strips_children'], '变异①');
});

test('变异②：拆掉 `__guard()` 那层包裹 ⇒ B 分支（fallback 再渲染抛错子树）必须红', (t) => {
  const root = makeCopy('m2');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  patch(root, 'client/panel/boundary.mjs', 'return guardEnabled ? this.__guard(node) : node;', 'return node;');
  const result = runCriteriaAt(root);
  assertRed(result, ['R_B_fallback_renders_throwing_child'], '变异②');
});

test('变异③：让失败态可以 `return null` ⇒ 「失败态绝不空白」判据必须红', (t) => {
  const root = makeCopy('m3');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  patch(root, 'client/panel/boundary.mjs', 'if (!failed) return null;', 'return null;');
  const result = runCriteriaAt(root);
  assertRed(result, ['R_E2_failure_never_null'], '变异③');
});

// ═══ 扩面反假绿（定向反转变异）＋ 前/后差值清单 ═════════════════════════════════════════════

/** 把 `guardSlot()` 整个函数体换成直通（= 回到扩面前的"没有槽位边界"状态）。 */
function neutralizeGuardSlot(root) {
  // ★ 面板壳拆件后 `guardSlot` 的**体内**落在 `components/views.mjs`
  //   ⇒ 靶点跟着实现走（断言与"逐字符扫平衡括号"的变异手法不变）。
  const candidates = [
    path.join(root, 'src', 'client', 'panel', 'components', 'views.mjs'),
    path.join(root, 'src', 'client', 'panel', 'components.mjs'),
  ];
  const file = candidates.find((one) => readFileSync(one, 'utf8').includes('function guardSlot(key, node, props) {'));
  assert.ok(file !== undefined, '变异锚点不存在：三件里都找不到 `function guardSlot(key, node, props) {`');
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('function guardSlot(key, node, props) {');
  assert.ok(start > -1, '变异锚点不存在：找不到 `function guardSlot(key, node, props) {`');
  let depth = 0;
  let end = -1;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > start, '变异失败：guardSlot 花括号没配平');
  const replaced = `${text.slice(0, start)}function guardSlot(key, node, props) {
    return node === null || node === undefined ? null : node;
  }${text.slice(end + 1)}`;
  writeFileSync(file, replaced, 'utf8');
}

test('变异④：只摘掉 `panel-actions` 那一处边界 ⇒ 对应判据 `R_G1` 必须红，且不连坐其他面', (t) => {
  const root = makeCopy('m4');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  patch(root, 'client/panel/components.mjs', "guardSlot('panel-actions', props.actions, props)", 'props.actions');
  const result = runCriteriaAt(root);
  assertRed(result, ['R_G1_panel_actions'], '变异④');
  assert.ok(!result.parsed.failed.includes('R_G2_toolbar_children_standalone'), `变异④连坐了 G2：${JSON.stringify(result.parsed.failed)}`);
  assert.ok(!result.parsed.failed.includes('R_G12_positive_control_in_panel_body'), `变异④连坐了 Panel body 正对照：${JSON.stringify(result.parsed.failed)}`);
});

test('变异⑤：把 `guardSlot` 整体中和（= 回到扩面前）⇒ 11 条槽位判据全红、Panel body 正对照与负控保持绿（前/后差值清单）', (t) => {
  const root = makeCopy('m5');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  neutralizeGuardSlot(root);
  const result = runCriteriaAt(root);
  const surfaceIds = [
    'R_G1_panel_actions',
    'R_G2_toolbar_children_standalone',
    'R_G3_list_renderItem_element_standalone',
    'R_G4_list_children_standalone',
    'R_G5_list_empty_slot_standalone',
    'R_G6_keyvalue_children_standalone',
    'R_G7_toolbar_item_icon_standalone',
    'R_G8_empty_action_standalone',
    'R_G9_empty_children_standalone',
    'R_G10_errorstate_children_standalone',
    'R_G11_empty_description_standalone',
  ];
  assert.notEqual(result.status, 0, `变异⑤后判据仍全绿 ⇒ 这些判据没有牙齿\n${result.stdout}`);
  const missing = surfaceIds.filter((id) => !result.parsed.failed.includes(id));
  assert.equal(missing.length, 0, `预期全红的槽位判据里，以下没有红：${JSON.stringify(missing)}\n失败清单=${JSON.stringify(result.parsed.failed)}`);
  // 「前/后差值」的另一半：这些**不应该**因为扩面消失而变红
  for (const keepGreen of ['R_G12_positive_control_in_panel_body', 'R_N1_throwing_label_is_not_an_error_state', 'R_N2_close_callback_still_fires_once', 'R_N3_onSelect_still_fires_once', 'R_N4_getKey_shape_unchanged', 'R_M1_empty_renders_children_on_default_empty', 'R_M2_error_state_still_strips_children', 'R_GAP_kv_value_slot_still_escapes']) {
    assert.ok(!result.parsed.failed.includes(keepGreen), `变异⑤不该影响 ${keepGreen}：${JSON.stringify(result.parsed.failed)}`);
  }
  console.log(`变异⑤前/后差值：中和 guardSlot ⇒ 红的 ${result.parsed.failed.length} 条 = ${JSON.stringify(result.parsed.failed)}`);
});

test('变异⑥：把 Empty 的 empty 分流回退成 `=== \'ready\'` ⇒ 空态矩阵正向钉桩必须红', (t) => {
  const root = makeCopy('m6');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  patch(root, 'client/panel/components.mjs', "if (resolved.state === 'empty') return emptyView(props);", "if (resolved.state === 'ready') return emptyView(props);");
  const result = runCriteriaAt(root);
  assertRed(result, ['R_M1_empty_renders_children_on_default_empty'], '变异⑥');
});

test('变异⑦：摘掉 `KeyValue` 值槽那一处 `guardSlot` ⇒ 只红对应的 KV 判据，其余全绿', (t) => {
  const root = makeCopy('m7');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  patch(
    root,
    'client/panel/components.mjs',
    'isElementNode(field.value) ? guardSlot(`keyvalue-value-${index}`, field.value, props) : field.value',
    'field.value',
  );
  const result = runCriteriaAt(root);
  // 期望红：值槽的两条形态判据 + 值槽结构判据（R_KV2 的元素值那半边也依赖这处边界）
  assertRed(
    result,
    ['R_KV1_keyvalue_value_element_caught_tuple', 'R_KV1_keyvalue_value_element_caught_object', 'R_KV2_plain_values_get_no_boundary'],
    '变异⑦',
  );
  // 前后差值：**只有**值槽这一类变红；11 处既有隔离面、正对照、负控、空态矩阵都不受影响。
  const shouldStayGreen = [
    'R_G1_panel_actions',
    'R_G2_toolbar_children_standalone',
    'R_G3_list_renderItem_element_standalone',
    'R_G4_list_children_standalone',
    'R_G5_list_empty_slot_standalone',
    'R_G6_keyvalue_children_standalone',
    'R_G7_toolbar_item_icon_standalone',
    'R_G8_empty_action_standalone',
    'R_G9_empty_children_standalone',
    'R_G10_errorstate_children_standalone',
    'R_G11_empty_description_standalone',
    'R_G12_positive_control_in_panel_body',
    'R_N1_throwing_label_is_not_an_error_state',
    'R_N2_close_callback_still_fires_once',
    'R_N3_onSelect_still_fires_once',
    'R_N4_getKey_shape_unchanged',
    'R_M1_empty_renders_children_on_default_empty',
    'R_M2_error_state_still_strips_children',
    'R_M3_loading_does_not_render_children',
  ];
  const collateral = shouldStayGreen.filter((id) => result.parsed.failed.includes(id));
  assert.equal(collateral.length, 0, `变异⑦连坐了不该红的判据：${JSON.stringify(collateral)}`);
  const unexpected = result.parsed.failed.filter((id) => !id.startsWith('R_KV1_')).filter((id) => id !== 'R_KV2_plain_values_get_no_boundary');
  assert.equal(unexpected.length, 0, `变异⑦红了预期外的判据：${JSON.stringify(unexpected)}`);
  console.log(`变异⑦前/后差值：摘掉值槽边界 ⇒ 红的 ${result.parsed.failed.length} 条 = ${JSON.stringify(result.parsed.failed)}`);
});

test('判据自身的最小规模（防止判据被悄悄删空）', () => {
  const result = runCriteriaAt(PKG_DIR);
  assert.equal(result.status, 0, `包内源码上判据未全绿\n${result.stdout}\n${result.stderr}`);
  const ids = result.stdout.split(/\r?\n/).filter((row) => row.startsWith('PASS ') || row.startsWith('FAIL ')).map((row) => row.split(/\s+/)[1]);
  for (const required of [
    'R_A_simple_fallback',
    'R_B_fallback_renders_throwing_child',
    'R_C_panel_catches_child',
    'R_D_errorstate_fallback',
    'R_S1_toolbar_child_throws',
    'R_S2_deep_nested_throws',
    'R_S3_list_row_component_throws',
    'R_E1_no_renderError_still_renders',
    'R_E2_failure_never_null',
    'R_E3_poisoned_error_value',
    // 扩面全矩阵（8 逃逸面 + 同类元素槽 + 正对照）
    'R_G1_panel_actions',
    'R_G2_toolbar_children_standalone',
    'R_G3_list_renderItem_element_standalone',
    'R_G4_list_children_standalone',
    'R_G5_list_empty_slot_standalone',
    'R_G6_keyvalue_children_standalone',
    'R_G7_toolbar_item_icon_standalone',
    'R_G8_empty_action_standalone',
    'R_G9_empty_children_standalone',
    'R_G10_errorstate_children_standalone',
    'R_G11_empty_description_standalone',
    'R_G12_positive_control_in_panel_body',
    // 负控（不过度扩面 / 行不为变）与空态矩阵
    'R_N1_throwing_label_is_not_an_error_state',
    'R_N2_close_callback_still_fires_once',
    'R_N3_onSelect_still_fires_once',
    'R_N4_getKey_shape_unchanged',
    'R_M1_empty_renders_children_on_default_empty',
    'R_M2_error_state_still_strips_children',
    'R_M3_loading_does_not_render_children',
    // KeyValue 值槽已收口
    'R_KV1_keyvalue_value_element_caught_tuple',
    'R_KV1_keyvalue_value_element_caught_object',
    'R_KV2_plain_values_get_no_boundary',
    'S_1_errorProps_strips_children',
    'S_2_all_errorView_calls_collected',
    'S_3_panel_renderError_collected',
    'S_4_boundary_third_layer_present',
  ]) assert.ok(ids.includes(required), `判据集缺 ${required}`);
});
