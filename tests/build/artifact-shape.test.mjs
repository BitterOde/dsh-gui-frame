/**
 * artifact-shape.test.mjs —— 独立复验（二）：**产物形状与 require 集合**。
 *
 * 覆盖任务契约里四条验收：
 *   ① classic script 判据 = `new Function('window', source)` 能加载 **且** 顶层 import/export 语法为假；
 *      `node --check` **不得单独充当非 ESM 反证** —— 本用例在同一台机器上把这条反证做出来：
 *      node v24 对 ESM 源码同样 exit 0（语法自动识别），只有 `new Function` 会拒绝 ESM。
 *   ② 在**只有 `window.__ModuleLoader__`** 的假环境里加载产物，断言 require 集合 ⊆ 白名单（且不重不漏）；
 *   ③ react 只被 require 一次（静态 + 运行期两侧）；
 *   ④ 顶层恰好一次 `__ModuleLoader__.load({id, factory})` 且 id === 包名。
 *
 * 独立性：假窗口、假种子、require 计数器、顶层 load 计数器、ESM 探测器全在 `harness.mjs` 里自写，
 * **不复用** `scripts/build-client.mjs` 的 `loadArtifact`；白名单在 harness 里另抄一份（冻结 8 全名）。
 * 每条主判据都附**变红反证**（把产物改坏，判据必须翻红），避免出现「恒真」的空转断言。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLIENT_OUT,
  FROZEN_SEED_NAMES,
  attemptMaterialize,
  countStaticRequireOf,
  countTopLevelLoads,
  hasTopLevelEsmSyntax,
  listStaticRequires,
  loadInMinimalFakeWindow,
  pkg,
  readClientSource,
  runNodeCheck,
} from './harness.mjs';

const source = readClientSource();

test('classic script：new Function("window", source) 可加载 ∧ 顶层无 import/export；node --check 单用不构成反证', async () => {
  // ── 判据一：classic script 能被当函数体解析并执行（ESM 语法在这里必然 SyntaxError）
  assert.doesNotThrow(
    () => new Function('window', source), // eslint-disable-line no-new-func
    '产物必须能被 classic script 方式加载（new Function）',
  );
  // ── 判据二：顶层不得出现 import/export 语句
  assert.equal(hasTopLevelEsmSyntax(source), false, '顶层不得出现 import/export 语法');

  // ── 判据一的牙齿：同一条产物前缀上 ESM 语法必须抛
  const esmSample = `import 'react';\nexport const marker = 1;\n${source}`;
  assert.throws(() => new Function('window', esmSample), SyntaxError, 'ESM 语法必须让 new Function 抛 SyntaxError');
  // ── 判据二的牙齿：同一个样本必须被探测器判为「有顶层 ESM 语法」
  assert.equal(hasTopLevelEsmSyntax(esmSample), true);

  // ── 旁证（**不是判据**）：node --check 也通过
  const clientCheck = runNodeCheck(CLIENT_OUT);
  assert.equal(clientCheck.status, 0, `node --check lib/client.js 应通过（旁证）：${clientCheck.stderr}`);

  // ── 反证：`node --check` 不能单独当非 ESM 证据
  // 本包是 type:module，node v24 默认做「语法自动识别」：ESM 源码在这里一样 exit 0。
  const dir = await mkdtemp(path.join(os.tmpdir(), 'guif-t17-check-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    const esmFile = path.join(dir, 'esm-sample.js');
    const brokenFile = path.join(dir, 'broken-sample.js');
    await writeFile(esmFile, "import 'react';\nexport const marker = 1;\n", 'utf8');
    await writeFile(brokenFile, 'const = ;\n', 'utf8');

    const brokenCheck = runNodeCheck(brokenFile);
    assert.equal(brokenCheck.status, 1, '对照：node --check 确实能抓真语法错（否则下面那条 exit 0 说明不了任何事）');

    const esmCheck = runNodeCheck(esmFile);
    assert.equal(
      esmCheck.status,
      0,
      `在 ${path.basename(dir)}（type:module）里 node --check 对 ESM 源码也 exit 0 ⇒ 它无法单独证明产物不是 ESM；`
      + `真正的非 ESM 判据是 new Function（对同一段 ESM 源码必须抛）`,
    );
    const esmText = "import 'react';\nexport const marker = 1;\n";
    assert.throws(() => new Function('window', esmText), SyntaxError, '同一段 ESM 源码，new Function 必须拒绝 —— 这才是判据');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('只有 window.__ModuleLoader__ 的假环境加载产物：require 集合 ⊆ 冻结白名单（不重不漏）', () => {
  const { loads, window: fakeWindow } = loadInMinimalFakeWindow(source);

  // 假环境确实是「只有 __ModuleLoader__」：加载后 window 上不得多出任何键
  assert.deepEqual(Object.keys(fakeWindow), ['__ModuleLoader__'], '假环境只有 __ModuleLoader__；产物不得往 window 上挂东西');
  assert.equal(globalThis.__ModuleLoader__, undefined, '产物不得污染 Node 全局（classic script 只许碰传入的 window）');
  assert.equal(loads.length, 1, 'load 必须被调用一次');

  const { ok, required, exports, error } = attemptMaterialize(loads[0], [...FROZEN_SEED_NAMES]);
  assert.equal(ok, true, `factory 不得 require 白名单外的模块（假 require 是硬闸门）：${error?.message ?? ''}`);

  // ★ 子集断言
  const outside = required.filter((name) => !FROZEN_SEED_NAMES.includes(name));
  assert.deepEqual(outside, [], `产物 require 了白名单外的模块：${outside.join('、')}`);
  // 不重不漏（与 harness 里另抄的冻结清单逐项比对）
  assert.deepEqual([...required].sort(), [...FROZEN_SEED_NAMES].sort(), 'require 集合必须逐项等于 冻结的 8 个全名');
  assert.equal(new Set(required).size, required.length, '不得重复 require 同一模块');

  // 静态 require 列表 === 运行期 require 列表（顺序也一致）
  assert.deepEqual(listStaticRequires(source), required, '静态 require 调用点必须与运行期 require 顺序一致');

  // 形状：factory 交出 { apply, inject }
  assert.equal(typeof exports.apply, 'function', 'factory 必须返回 apply');
  assert.ok(Array.isArray(exports.inject), 'factory 必须返回 inject 数组');

  // 种子只 require、不内联（双 React 的另一种来源是打包器把运行时打进来）
  assert.equal(/react\.development|Symbol\.for\('react/.test(source), false, '产物不得内联 react 运行时');

  // ★ 牙齿：往 factory 体里塞一个白名单外的 require ⇒ 判据必须变红
  const tampered = source.replace(
    '  factory: function (require) {',
    '  factory: function (require) {\n    var evil = require("lodash");',
  );
  assert.notEqual(tampered, source, '注入点必须命中（否则本条牙齿是空转）');
  const tamperedRun = attemptMaterialize(loadInMinimalFakeWindow(tampered).loads[0], [...FROZEN_SEED_NAMES]);
  assert.equal(tamperedRun.ok, false, '白名单外的 require 必须被假环境挡下');
  assert.match(String(tamperedRun.error?.message), /白名单外的模块：lodash/);
  assert.ok(tamperedRun.required.includes('lodash'));
});

test('react 只被 require 一次（静态 × 运行期；重复注入必须变红）', () => {
  const runtime = attemptMaterialize(loadInMinimalFakeWindow(source).loads[0], [...FROZEN_SEED_NAMES]).required;

  assert.equal(runtime.filter((name) => name === 'react').length, 1, 'react 恰好一次（绝不双 React）');
  assert.equal(countStaticRequireOf(source, 'react'), 1, '静态 require("react") 恰好一次');
  // 不要把 react/jsx-runtime 与 react 混为一谈（精确匹配模块名字符串）
  assert.equal(countStaticRequireOf(source, 'react/jsx-runtime'), 1, 'react/jsx-runtime 各算一次，不得把 react 计成 2');
  assert.equal(runtime.filter((name) => name === 'react/jsx-runtime').length, 1);
  // 静态 require 总次数 === 冻结白名单条数（8）：既不重复注入，也不漏
  assert.equal(listStaticRequires(source).length, FROZEN_SEED_NAMES.length);

  // ★ 牙齿：重复注入 react ⇒ 两侧判据都必须翻红
  const duplicated = source.replace(
    '    var react = require("react");',
    '    var react = require("react");\n    var reactAlias = require("react");',
  );
  assert.notEqual(duplicated, source, '注入点必须命中（否则本条牙齿是空转）');
  assert.equal(countStaticRequireOf(duplicated, 'react'), 2, '静态计数器必须能数出两次');
  const dupRun = attemptMaterialize(loadInMinimalFakeWindow(duplicated).loads[0], [...FROZEN_SEED_NAMES]).required;
  assert.equal(dupRun.filter((name) => name === 'react').length, 2, '运行期计数器必须能抓出双 React');
});

test('顶层恰好一次 __ModuleLoader__.load({id, factory})，且 id === 包名', () => {
  // 静态侧：行首的顶层调用点恰好一个
  assert.equal(countTopLevelLoads(source), 1, '顶层 `window.__ModuleLoader__.load({` 调用点恰好一次');
  // 运行期侧：load() 实际只被调用一次
  const { loads } = loadInMinimalFakeWindow(source);
  assert.equal(loads.length, 1, 'load() 实际调用次数恰好一次（静态一次 ≠ 运行期一次，两侧都要）');

  const entry = loads[0];
  assert.equal(entry.id, pkg.name, 'bundle id 必须等于 package.json 的 name');
  assert.equal(entry.id, 'dsh-gui-frame');
  assert.equal(typeof entry.factory, 'function', 'load 的载荷必须带 factory');
  assert.ok(entry.factory.length >= 1, 'factory 必须接收 require 参数（种子只能经它进来）');
  assert.ok(!('exports' in entry), '顶层 load 只注册 { id, factory }，不得直接塞 exports');

  // ★ 牙齿：二次 load ⇒ 两侧判据都必须翻红
  const doubled = `${source}\nwindow.__ModuleLoader__.load({ id: 'second-gui-frame', factory: function () { return {}; } });\n`;
  assert.equal(countTopLevelLoads(doubled), 2, '静态计数器必须能数出两次');
  assert.equal(loadInMinimalFakeWindow(doubled).loads.length, 2, '运行期计数器必须能数出两次');
});
