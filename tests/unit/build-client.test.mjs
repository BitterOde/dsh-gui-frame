/**
 * build-client.test.mjs —— **构建器契约测试**：`node --test tests/unit`。
 *
 * 覆盖六条：
 *  ① `ALLOWED_REQUIRES` 是冻结的 8 个**全名**（无简写、不因官方产物用过别的键而扩容）；
 *  ② **有限深度相对 import**（`./x.mjs` 与 `../y.mjs`）：越根 / 超深 / 裸包名 / 缺扩展名 /
 *     目标不存在 / 非 .mjs ⇒ 一律构建失败，绝不静默改写；
 *  ③ 产物头部**按声明注入多个种子实例**（不再只注入 react；react 恰好一次）；
 *  ④ **目录深度契约**：恰好 `MAX_DIR_DEPTH` 层合法、多一层变红（本文件第一条深度用例）；
 *  ⑤ 既有硬校验仍在（单次 load / id / {apply,inject} / 绑定检查 / 确定性 / 占位形态）；
 *  ⑥ 环检测与越界检测**全静态**——用一个「模块体 throw」的夹具证明构建期只解析不执行。
 *
 * 纪律：不联网、不需要 DSH 在跑、**不写包内任何文件**（临时树建在系统 TEMP 下并即时清理），
 * 不碰 profile。分工：本文件是**实现方自证**，独立复验在 `tests/build/**`。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_REQUIRES,
  BuildError,
  MAX_DIR_DEPTH,
  SEED_DECLARATIONS,
  buildArtifactText,
  checkBindings,
  createFakeSeeds,
  isFullSeedName,
  loadArtifact,
  loadModules,
  resolveModuleId,
  sortModules,
} from '../../scripts/build-client.mjs';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(await readFile(path.join(PKG_DIR, 'package.json'), 'utf8'));

/** 冻结的 8 个全名（本测试是它的**第二处**记录：写简写或悄悄扩容都会在这里变红）。 */
const FULL_SEED_NAMES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-store',
];

/** 在系统 TEMP 下建一棵临时源码树，跑完即删（绝不写包内文件）。 */
async function withTree(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'guif-build-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const full = path.join(dir, ...rel.split('/'));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text, 'utf8');
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 断言这棵树让 `loadModules` 以 `BuildError` 且消息匹配 `pattern` 失败。 */
async function expectLoadFail(files, pattern) {
  await withTree(files, async (dir) => {
    await assert.rejects(
      () => loadModules(dir),
      (error) => {
        assert.ok(error instanceof BuildError, `应当抛 BuildError，实际 ${error?.constructor?.name}: ${error?.message}`);
        assert.match(String(error.message), pattern);
        return true;
      },
    );
  });
}

const ENTRY_BODY = 'export function createClientModule() { return {}; }\n';

test('① 白名单＝冻结的 8 个全名（无简写、不扩容），且声明与白名单同源同序', () => {
  assert.deepEqual([...ALLOWED_REQUIRES].sort(), [...FULL_SEED_NAMES].sort(), 'ALLOWED_REQUIRES 必须逐项等于那 8 个全名');
  assert.deepEqual(SEED_DECLARATIONS.map((entry) => entry.name), [...ALLOWED_REQUIRES], '注入声明与白名单同一真源、同一顺序');
  for (const name of ALLOWED_REQUIRES) {
    assert.ok(isFullSeedName(name), `${name} 必须是全名（简写会让运行期 require 直接 throw）`);
  }
  assert.ok(!ALLOWED_REQUIRES.includes('react-dom/client'), 'react-dom/client 暂不收（不需要 createRoot）');
  assert.ok(
    !ALLOWED_REQUIRES.includes('@deepseek-ai/dsh-api-gateway/client'),
    '@deepseek-ai/dsh-api-gateway/client 明确不收（模块级 import 落在冻结分层的 L3，通道一律走 ctx.connection）',
  );
  assert.equal(new Set(ALLOWED_REQUIRES).size, ALLOWED_REQUIRES.length, '白名单不得有重复键');
});

test('③ 产物按声明注入多个种子实例：require 顺序＝声明顺序、react 恰好一次、无一内联', async () => {
  const modules = await loadModules();
  const { source, mode } = buildArtifactText({ pkgName: pkg.name, modules });
  assert.equal(mode, 'modules', 'src/client 已有 entry.mjs ⇒ 走真实模块图');
  for (const entry of SEED_DECLARATIONS) {
    assert.ok(
      source.includes(`var ${entry.key} = require(${JSON.stringify(entry.name)});`),
      `产物必须按声明注入 ${entry.name}（键名 ${entry.key}）`,
    );
  }
  const loaded = loadArtifact(source, { expectId: pkg.name, seeds: createFakeSeeds() });
  for (const row of loaded.checks) assert.ok(row.ok, `产物校验未过：${row.name} —— ${row.detail}`);
  assert.deepEqual(loaded.required, [...ALLOWED_REQUIRES], 'require 集合逐条等于声明集（不重不漏、顺序一致）');
  assert.ok(loaded.required.length > 1, '③：不再只注入 react');
  assert.equal(loaded.required.filter((name) => name === 'react').length, 1, 'react 恰好一次（绝不双 React）');
  assert.ok(!/react\.development|Symbol\.for\('react/.test(source), '种子只 require 不内联');
});

test('④ 目录深度契约：跨目录相对 import 合法，恰好 MAX_DIR_DEPTH 层合法', async () => {
  await withTree({
    'entry.mjs': "import { panel } from './panel/index.mjs';\nexport function createClientModule(seeds) { return { apply: panel, inject: [], __internals: { seeds: Object.keys(seeds) } }; }\n",
    'panel/index.mjs': "import { util } from '../shared/util.mjs';\nexport function panel() { return util(); }\n",
    'shared/util.mjs': "export function util() { return 'u'; }\n",
  }, async (dir) => {
    const modules = await loadModules(dir);
    assert.deepEqual(
      [...modules.keys()].sort(),
      ['./entry.mjs', './panel/index.mjs', './shared/util.mjs'],
      '模块 id 是相对根的路径（不是 basename）',
    );
    assert.equal(modules.get('./panel/index.mjs').imports[0].target, './shared/util.mjs', '`../` 必须解析成根相对 id');
    assert.deepEqual(checkBindings(modules), []);
    const { source, sorted } = buildArtifactText({ pkgName: 'dsh-probe', modules });
    assert.deepEqual(sorted, ['./shared/util.mjs', './panel/index.mjs', './entry.mjs'], '拓扑序：深层依赖在前');
    assert.ok(source.includes('__esMod["./shared/util.mjs"]'), '产物按解析后的 id 连接跨目录依赖');
    const loaded = loadArtifact(source, { expectId: 'dsh-probe' });
    for (const row of loaded.checks) assert.ok(row.ok, `${row.name} —— ${row.detail}`);
  });

  const depthOk = {};
  depthOk['entry.mjs'] = "import { leaf } from './a/b/c/d/leaf.mjs';\nexport function createClientModule() { return leaf; }\n";
  depthOk['a/b/c/d/leaf.mjs'] = 'export function leaf() {}\n';
  await withTree(depthOk, async (dir) => {
    const modules = await loadModules(dir);
    assert.ok(modules.has('./a/b/c/d/leaf.mjs'), `恰好 ${MAX_DIR_DEPTH} 层目录必须合法`);
  });

  const tooDeep = {};
  tooDeep['entry.mjs'] = ENTRY_BODY;
  tooDeep['a/b/c/d/e/leaf.mjs'] = 'export const leaf = 1;\n';
  await expectLoadFail(tooDeep, /目录深度超限/);
});

test('② 越界一律构建失败：越根 / 裸包名 / 缺扩展名 / 目标不存在 / 非 .mjs / 缺入口', async () => {
  await expectLoadFail({ 'entry.mjs': "import { x } from '../outside.mjs';\n" }, /越出 src\/client 根目录/);
  await expectLoadFail({ 'entry.mjs': "import { useState } from 'react';\n" }, /只支持相对 import/);
  await expectLoadFail({ 'entry.mjs': "import { x } from './x';\n", 'x.mjs': 'export const x = 1;\n' }, /必须写全 \.mjs 扩展名/);
  await expectLoadFail({ 'entry.mjs': "import { x } from './nope.mjs';\n" }, /没有这个模块/);
  await expectLoadFail({ 'entry.mjs': ENTRY_BODY, 'style.css': 'a { color: red; }\n' }, /只允许 \*\.mjs/);
  await expectLoadFail({ 'panel/index.mjs': 'export const x = 1;\n' }, /缺少入口模块/);
});

test('② export 变体仍各红（default / { … } / class）', async () => {
  await expectLoadFail({ 'entry.mjs': 'export default function () {}\n' }, /不支持 export default/);
  await expectLoadFail({ 'entry.mjs': 'const a = 1;\nexport { a };\n' }, /不支持 export \{ … \}/);
  await expectLoadFail({ 'entry.mjs': 'export class A {}\n' }, /不支持 export class/);
});

test('⑥ 环检测是静态的：有环 ⇒ 排序期变红，且全程不执行模块体', async () => {
  await withTree({
    'entry.mjs': "import { a } from './a.mjs';\nexport function createClientModule() { return a; }\n",
    'a.mjs': "import { b } from './b.mjs';\nexport function a() { return b; }\n",
    'b.mjs': "import { a } from './a.mjs';\nexport function b() { return a; }\n",
  }, async (dir) => {
    const modules = await loadModules(dir); // 加载只做静态解析，不报环
    assert.throws(() => sortModules(modules), /模块循环依赖/);
    assert.throws(() => buildArtifactText({ pkgName: 'dsh-probe', modules }), /模块循环依赖/);
  });

  await withTree({
    'entry.mjs': "import { self } from './entry.mjs';\nexport function createClientModule() { return self; }\n",
  }, async (dir) => {
    const selfModules = await loadModules(dir);
    assert.throws(() => sortModules(selfModules), /模块循环依赖/, '自引用也是环');
  });

  // 「模块体 throw」⇒ 构建期只要碰它一次就会炸；四步静态检查全过即证明不执行模块体。
  await withTree({
    'entry.mjs': "import './boom.mjs';\nexport function createClientModule() { return {}; }\n",
    'boom.mjs': 'throw new Error("模块体不得在构建期执行");\nexport const boom = 1;\n',
  }, async (dir) => {
    const modules = await loadModules(dir);
    assert.deepEqual(checkBindings(modules), []);
    const { source } = buildArtifactText({ pkgName: 'dsh-probe', modules });
    assert.ok(source.includes('模块体不得在构建期执行'), '模块体进产物但不执行');
  });
});

test('⑤ 绑定检查跨目录同效：导入不存在的导出必须变红（不许静默 undefined）', async () => {
  await withTree({
    'entry.mjs': "import { nope } from './panel/index.mjs';\nexport function createClientModule() { return nope; }\n",
    'panel/index.mjs': 'export function panel() {}\n',
  }, async (dir) => {
    const problems = checkBindings(await loadModules(dir));
    assert.equal(problems.length, 1, '跨目录的坏绑定必须被抓住');
    assert.match(problems[0], /导入 nope/);
  });
});

test('⑤ 同名文件不同目录不再互相顶掉（回归：旧实现按 basename 折叠 id）', async () => {
  await withTree({
    'entry.mjs': "import { a } from './left/x.mjs';\nimport { b } from './right/x.mjs';\nexport function createClientModule() { return a + b; }\n",
    'left/x.mjs': 'export const a = 1;\n',
    'right/x.mjs': 'export const b = 2;\n',
  }, async (dir) => {
    const modules = await loadModules(dir);
    assert.deepEqual([...modules.keys()].sort(), ['./entry.mjs', './left/x.mjs', './right/x.mjs']);
    assert.equal(modules.get('./entry.mjs').imports.map((item) => item.target).join('、'), './left/x.mjs、./right/x.mjs');
    assert.deepEqual(checkBindings(modules), [], '两条同名 import 各自绑到正确的模块');
  });
});

test('resolveModuleId：路径语义正确 + 越根即抛', () => {
  assert.equal(resolveModuleId('./entry.mjs', './panel/index.mjs'), './panel/index.mjs');
  assert.equal(resolveModuleId('./panel/index.mjs', './parts/a.mjs'), './panel/parts/a.mjs');
  assert.equal(resolveModuleId('./panel/parts/a.mjs', '../../shared/util.mjs'), './shared/util.mjs');
  assert.throws(() => resolveModuleId('./entry.mjs', '../x.mjs'), BuildError);
  assert.throws(() => resolveModuleId('./panel/index.mjs', '../../x.mjs'), BuildError);
});

test('⑤ 确定性与占位形态仍在：同输入同字节；空源码走 placeholder 且可加载', async () => {
  const modules = await loadModules();
  const first = buildArtifactText({ pkgName: pkg.name, modules }).source;
  const second = buildArtifactText({ pkgName: pkg.name, modules }).source;
  assert.equal(first, second, '两次打包逐字节相同（无时间戳 / 无随机值）');

  const empty = buildArtifactText({ pkgName: 'dsh-probe', modules: new Map() });
  assert.equal(empty.mode, 'placeholder');
  const loaded = loadArtifact(empty.source, { expectId: 'dsh-probe' });
  assert.equal(loaded.checks.filter((row) => !row.ok).length, 0, '占位产物仍必须形状合法');
});

test('回归：产物头注释不得出现 `**/`（会提前闭合注释，整份产物变语法错）', async () => {
  const { source } = buildArtifactText({ pkgName: pkg.name, modules: await loadModules() });
  // 注意：头注释里也会**提到** `window.__ModuleLoader__.load(...)`，所以要按「行首的调用」定位。
  const callIndex = source.search(/^window\.__ModuleLoader__\.load\(\{/m);
  assert.ok(callIndex > 0, '产物必须有一条行首的顶层 load 调用');
  const header = source.slice(0, callIndex);
  assert.ok(header.startsWith('/**'), '产物以头注释开头');
  assert.ok(!header.includes('**/'), '头注释里不得出现 `**/`');
  assert.equal(header.trimEnd().endsWith('*/'), true, '头注释必须在 load 之前正常闭合');
  assert.doesNotThrow(() => loadArtifact(source, { expectId: pkg.name }), '产物必须能被 classic script 解析（非 ESM）');
});
