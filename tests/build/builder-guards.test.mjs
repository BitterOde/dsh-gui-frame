/**
 * builder-guards.test.mjs —— 独立复验（三）：**构建器的越界逐条变红 / 失败而非静默改写**。
 *
 * 覆盖任务契约里两条验收：
 *   ① 构建器单测让**裸包名 / 子目录越级 / 目录超深 / 缺扩展名 / 非 .mjs / export 三变体 / 模块环**
 *           各自变红（单元层：走 `loadModules → checkBindings → buildArtifactText(内含 sortModules)`
 *           这条与真 `build()` 同序的静态流水线，不写盘、不执行模块体）；
 *   ② **故意越界的 fixture**（`tests/build/fixtures/out-of-bounds/`）证明构建**失败而非静默改写**：
 *           exit≠0 + 不落 `lib/client.js` + 源码树指纹一个字节不变（重跑一次仍然如此）。
 *   另有：把同一批夹具逐棵放进**临时包副本**跑**真 CLI**（真进程、真 exit code、真落盘面），
 *           覆盖「单元层变红」与「真构建失败」之间的缝；`fixtures/valid/` 作正对照。
 *
 * 独立性：夹具是磁盘上的真源码树（人可复核）；CLI 在系统 TEMP 的包副本里跑，
 * **不写包内任何文件、不碰 profile、不需要 DSH 在跑**。
 *
 * ── 分层约定（与上面的越界判据并列，不改动其中任何一条）────────────────────────────────
 * **`src/client` 之下的暂存物一律用点前缀**：并行写入方做原子写时，会在目标目录下先落
 * `.tmpdir/`（或 `.xxx.tmp`）这类瞬时物，写完再改名搬走。构建器对**点前缀条目一律跳过**
 * （不递归、不校验、不进图），所以别人写盘时不会让本构建无故变红；反过来，
 * **点前缀目录里不得放本包的源**（真源只能是非点前缀的 `*.mjs`），
 * 而非点前缀的非 `.mjs` 文件仍**一律构建失败** —— 「越界即显式变红」的纪律不变。
 * 对应的回归用例见文件末尾「点前缀 scratch 豁免」那五条（含一条去掉豁免就变红的反假绿对照）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { BuildError, buildArtifactText, checkBindings, loadModules, sortModules } from '../../scripts/build-client.mjs';
import {
  CONTRACT_MAX_DIR_DEPTH,
  FIXTURES_DIR,
  FROZEN_SEED_NAMES,
  attemptMaterialize,
  hashTree,
  loadInMinimalFakeWindow,
  pkg,
  runBuilderCli,
  sha256,
  withTempPackage,
  withTempTree,
} from './harness.mjs';

/**
 * 与真 `build()` 同序的**静态**前四步（不写盘）：
 * `loadModules`（解析越界）→ `checkBindings`（坏绑定）→ `buildArtifactText`（内含 `sortModules` 环检测）。
 */
async function staticPipeline(srcDir) {
  const modules = await loadModules(srcDir);
  const problems = checkBindings(modules);
  if (problems.length > 0) throw new BuildError(`import 绑定检查失败（共 ${problems.length} 处）：${problems.join('；')}`);
  const { source } = buildArtifactText({ pkgName: pkg.name, modules });
  return { modules, source };
}

async function captureError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

/** 磁盘夹具（每个子目录 = 一棵完整 `src/client` 候选树）。 */
const FIXTURE_CASES = [
  { fixture: 'bare-package', label: '裸包名（import "react"）', pattern: /只支持相对 import/ },
  { fixture: 'out-of-bounds', label: '子目录越级（../ 爬出 src/client 根）', pattern: /越出 src\/client 根目录/ },
  { fixture: 'too-deep', label: `目录层数超限（${CONTRACT_MAX_DIR_DEPTH + 1} > ${CONTRACT_MAX_DIR_DEPTH}）`, pattern: /目录深度超限/ },
  { fixture: 'export-default', label: 'export 变体：export default', pattern: /不支持 export default/ },
  { fixture: 'export-braces', label: 'export 变体：export { … }', pattern: /不支持 export \{ … \}/ },
  { fixture: 'export-class', label: 'export 变体：export class', pattern: /不支持 export class/ },
  { fixture: 'cycle', label: '模块环（entry → a → b → a）', pattern: /模块循环依赖/ },
];

/** 临时树夹具（不值得为它们落磁盘文件的几类）。 */
const INLINE_CASES = [
  {
    label: '缺 .mjs 扩展名（import "./helper"）',
    files: {
      'entry.mjs': "import { helper } from './helper';\nexport function createClientModule() { return helper; }\n",
      'helper.mjs': 'export function helper() {}\n',
    },
    pattern: /必须写全 \.mjs 扩展名/,
  },
  {
    label: '非 .mjs 普通文件（style.css）',
    files: {
      'entry.mjs': 'export function createClientModule() { return {}; }\n',
      'style.css': 'a { color: red; }\n',
    },
    pattern: /只允许 \*\.mjs/,
  },
  {
    label: '缺入口 entry.mjs',
    files: { 'panel/index.mjs': 'export const x = 1;\n' },
    pattern: /缺少入口模块/,
  },
  {
    label: '坏绑定（import 目标没导出的名字）',
    files: {
      'entry.mjs': "import { nope } from './panel/index.mjs';\nexport function createClientModule() { return nope; }\n",
      'panel/index.mjs': 'export function panel() {}\n',
    },
    pattern: /导入 nope/,
  },
];

test('静态流水线逐条变红：裸包名 / 子目录越级 / 目录超深 / export 三变体 / 模块环', async () => {
  const mismatches = [];
  for (const item of FIXTURE_CASES) {
    const dir = path.join(FIXTURES_DIR, item.fixture);
    if (!existsSync(dir)) {
      mismatches.push(`${item.fixture}：夹具目录不存在（${dir}）`);
      continue;
    }
    const error = await captureError(() => staticPipeline(dir));
    if (error === null) {
      mismatches.push(`${item.fixture}（${item.label}）：期望构建期失败，实际**静默通过**`);
    } else if (!(error instanceof BuildError)) {
      mismatches.push(`${item.fixture}（${item.label}）：期望 BuildError，实际 ${error.constructor.name}: ${error.message}`);
    } else if (!item.pattern.test(String(error.message))) {
      mismatches.push(`${item.fixture}（${item.label}）：错误消息不含 ${item.pattern} —— 实际「${error.message}」`);
    }
  }
  assert.deepEqual(mismatches, [], `以下越界未能逐条变红：\n  - ${mismatches.join('\n  - ')}`);
});

test('静态流水线逐条变红（临时树）：缺扩展名 / 非 .mjs / 缺入口 / 坏绑定', async () => {
  const mismatches = [];
  for (const item of INLINE_CASES) {
    const error = await withTempTree(item.files, (dir) => captureError(() => staticPipeline(dir)));
    if (error === null) {
      mismatches.push(`${item.label}：期望构建期失败，实际**静默通过**`);
    } else if (!(error instanceof BuildError)) {
      mismatches.push(`${item.label}：期望 BuildError，实际 ${error.constructor.name}: ${error.message}`);
    } else if (!item.pattern.test(String(error.message))) {
      mismatches.push(`${item.label}：错误消息不含 ${item.pattern} —— 实际「${error.message}」`);
    }
  }
  assert.deepEqual(mismatches, [], `以下越界未能逐条变红：\n  - ${mismatches.join('\n  - ')}`);
});

test('环检测发生在静态排序层：解析层放行、排序层拒绝（全程不执行模块体）', async () => {
  const modules = await loadModules(path.join(FIXTURES_DIR, 'cycle'));
  assert.ok(modules.has('./entry.mjs'), '环夹具的解析层必须放行（loadModules 只做静态解析）');
  assert.throws(() => sortModules(modules), /模块循环依赖/, 'sortModules 必须拒绝环');
  assert.throws(() => buildArtifactText({ pkgName: pkg.name, modules }), /模块循环依赖/, 'buildArtifactText 也必须拒绝环');

  // 「模块体 throw」不参与证据：上面全程没有执行任何模块体（loadModules/sortModules 只读文本）
  const withBoom = await withTempTree({
    'entry.mjs': "import { boom } from './boom.mjs';\nexport function createClientModule() { return boom; }\n",
    'boom.mjs': 'throw new Error("模块体不得在构建期执行");\nexport const boom = 1;\n',
  }, (dir) => staticPipeline(dir));
  assert.match(withBoom.source, /模块体不得在构建期执行/, '模块体进产物但构建期不执行它');
});

test('故意越界 fixture：真 CLI exit≠0、不落产物、源码字节不变 = 失败而非静默改写', async () => {
  const fixtureDir = path.join(FIXTURES_DIR, 'out-of-bounds');
  const fixtureFile = path.join(fixtureDir, 'entry.mjs');
  assert.ok(existsSync(fixtureFile), `故意越界的夹具必须存在：${fixtureFile}`);
  const fixtureText = readFileSync(fixtureFile, 'utf8');
  assert.match(fixtureText, /from '\.\.\/outside\.mjs'/, '夹具必须真的埋着越界 import（不是靠测试拼字符串）');
  const fixtureHash = sha256(fixtureText);

  await withTempPackage('out-of-bounds', async (tmp) => {
    const srcDir = path.join(tmp, 'src', 'client');
    const before = hashTree(srcDir);

    const first = runBuilderCli(tmp);
    assert.equal(first.signal, null, 'CLI 不得被超时杀掉');
    assert.notEqual(first.status, 0, `越界夹具必须让真 CLI 失败（实际 status=${first.status}）`);
    assert.match(first.stderr, /构建失败/, 'stderr 必须明确报「构建失败」');
    assert.match(first.stderr, /越出 src\/client 根目录/, 'stderr 必须点名越界原因');
    assert.equal(
      existsSync(path.join(tmp, 'lib', 'client.js')),
      false,
      '构建失败时不得落 lib/client.js —— 半成品产物比失败更危险（静默改写的一种）',
    );
    assert.equal(hashTree(srcDir), before, '构建失败时源码树必须一个字节都不变');
    assert.equal(
      sha256(readFileSync(path.join(srcDir, 'entry.mjs'), 'utf8')),
      fixtureHash,
      '夹具源码不得被构建器"帮"着改写（越界必须失败，不许静默修正）',
    );

    // 重跑一次：仍然失败、仍然不落产物、仍然不动源码（不是偶发）
    const second = runBuilderCli(tmp);
    assert.notEqual(second.status, 0, '重跑必须仍然失败');
    assert.equal(existsSync(path.join(tmp, 'lib', 'client.js')), false, '重跑仍不得落产物');
    assert.equal(hashTree(srcDir), before, '重跑仍不得动源码');
  });
});

for (const item of FIXTURE_CASES) {
  test(`真 CLI 端到端：${item.label} ⇒ exit≠0 且不落产物`, async () => {
    await withTempPackage(item.fixture, async (tmp) => {
      const srcDir = path.join(tmp, 'src', 'client');
      const before = hashTree(srcDir);
      const run = runBuilderCli(tmp);
      assert.equal(run.signal, null, 'CLI 不得被超时杀掉');
      assert.notEqual(run.status, 0, `真 CLI 必须失败（status=${run.status}；stdout=${run.stdout.slice(-400)}）`);
      assert.match(run.stderr, /构建失败/);
      assert.match(run.stderr, item.pattern, `stderr 必须点名原因：${item.pattern}`);
      assert.equal(existsSync(path.join(tmp, 'lib', 'client.js')), false, '失败时不得落产物');
      assert.equal(hashTree(srcDir), before, '失败时源码树不得变化');
    });
  });
}

test('正对照：合法夹具 exit 0、写出产物、产物可加载且 id === 包名', async () => {
  await withTempPackage('valid', async (tmp) => {
    const run = runBuilderCli(tmp);
    assert.equal(run.signal, null, 'CLI 不得被超时杀掉');
    assert.equal(run.status, 0, `合法夹具必须 exit 0（stderr=${run.stderr.slice(-600)}）`);
    assert.doesNotMatch(run.stdout, /构建失败/);
    assert.match(run.stdout, /完成：\d+ 项校验全部通过/, '构建器自检必须全过（否则下面是假绿）');

    const out = path.join(tmp, 'lib', 'client.js');
    assert.ok(existsSync(out), '合法夹具必须写出 lib/client.js');
    const built = readFileSync(out, 'utf8');
    const { loads, window: fakeWindow } = loadInMinimalFakeWindow(built);
    assert.equal(loads.length, 1, '产物顶层恰好一次 load');
    assert.equal(loads[0].id, pkg.name, 'id 必须等于包名');
    assert.deepEqual(Object.keys(fakeWindow), ['__ModuleLoader__'], '假环境只许有 __ModuleLoader__');
    const materialized = attemptMaterialize(loads[0], [...FROZEN_SEED_NAMES]);
    assert.equal(materialized.ok, true, `产物 require 必须全在白名单内：${materialized.error?.message ?? ''}`);
    assert.deepEqual([...materialized.required].sort(), [...FROZEN_SEED_NAMES].sort());
    assert.equal(typeof materialized.exports.apply, 'function');
    assert.deepEqual(materialized.exports.inject, [], '骨架入口的 inject 为空数组');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// **点前缀 scratch 豁免**（消除并行写入的瞬时红）
//
// 背景：并行写入方做原子写时会先在目标目录下落 `src/client/.tmpdir/*.tmp`，写完再搬走。旧实现
// 把它当「非法文件」⇒ 整个 build exit 1 ⇒ 其他成员看到与自己无关的瞬时红。豁免规则与理由写在
// `scripts/build-client.mjs` 的 `walkSource` 注释里；下面五条用例把它钉住，最后一条是反假绿对照。
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 在临时包副本的 `src/client` 下落暂存物（只写系统 TEMP 里的副本，绝不碰真包）。 */
async function writeScratch(tmp, files) {
  const srcDir = path.join(tmp, 'src', 'client');
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(srcDir, ...rel.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
}

test('单元层：loadModules 跳过点前缀条目（暂存目录 / 暂存文件 / 点前缀 .mjs），其余模块照常进图', async () => {
  await withTempTree({
    'entry.mjs': "import { panel } from './panel/index.mjs';\nexport function createClientModule() { return panel; }\n",
    'panel/index.mjs': 'export function panel() {}\n',
    '.tmpdir/part-1.tmp': '暂存中的半个文件\n',
    '.tmpdir/nested/deep.tmp': '再深一层也不进图\n',
    '.stray.tmp': '根下的暂存文件\n',
    '.gone.mjs': 'export const 暂存模块 = 1;\n',
    'panel/.tmpdir/inner.tmp': '模块目录旁的暂存目录\n',
  }, async (dir) => {
    const modules = await loadModules(dir);
    assert.deepEqual([...modules.keys()].sort(), ['./entry.mjs', './panel/index.mjs'], '点前缀条目一律不进图');
    const { source } = buildArtifactText({ pkgName: pkg.name, modules });
    assert.doesNotMatch(source, /暂存中的半个文件|再深一层|根下的暂存文件|暂存模块/, '暂存内容不得进产物');
  });

  // 对照：同一棵树去掉点前缀条目后，模块集合完全一致（豁免没有顺手改变正常路径的行为）
  await withTempTree({
    'entry.mjs': "import { panel } from './panel/index.mjs';\nexport function createClientModule() { return panel; }\n",
    'panel/index.mjs': 'export function panel() {}\n',
  }, async (dir) => {
    const modules = await loadModules(dir);
    assert.deepEqual([...modules.keys()].sort(), ['./entry.mjs', './panel/index.mjs']);
  });
});

test('真 CLI（正）：src/client 下放着 .tmpdir/x.tmp ⇒ 构建仍 exit 0 且产物正常', async () => {
  await withTempPackage('valid', async (tmp) => {
    await writeScratch(tmp, {
      '.tmpdir/x.tmp': 'half-written scratch\n',
      '.tmpdir/sub/deep.tmp': 'nested scratch\n',
      '.atomic-1234.tmp': 'root scratch\n',
    });
    const run = runBuilderCli(tmp);
    assert.equal(run.signal, null, 'CLI 不得被超时杀掉');
    assert.equal(run.status, 0, `暂存物不得让构建变红（stderr=${run.stderr.slice(-600)}）`);
    assert.doesNotMatch(run.stdout, /构建失败/);
    assert.match(run.stdout, /完成：\d+ 项校验全部通过/, '跳过暂存物后构建器自检必须仍全过');

    const out = path.join(tmp, 'lib', 'client.js');
    assert.ok(existsSync(out), '暂存物在场也必须落产物');
    const built = readFileSync(out, 'utf8');
    assert.doesNotMatch(built, /half-written scratch|nested scratch|root scratch/, '暂存内容不得进产物');
    const { loads } = loadInMinimalFakeWindow(built);
    assert.equal(loads.length, 1, '产物顶层恰好一次 load');
    assert.equal(loads[0].id, pkg.name);
  });
});

test('真 CLI（负）：非点前缀的 x.tmp ⇒ exit≠0 且点名文件（豁免不得扩大）', async () => {
  await withTempPackage('valid', async (tmp) => {
    await writeScratch(tmp, { 'x.tmp': 'misplaced source\n' });
    const run = runBuilderCli(tmp);
    assert.equal(run.signal, null, 'CLI 不得被超时杀掉');
    assert.notEqual(run.status, 0, '非点前缀的非 .mjs 文件必须让构建失败');
    assert.match(run.stderr, /构建失败/, 'stderr 必须明确报「构建失败」');
    assert.match(run.stderr, /只允许 \*\.mjs/, 'stderr 必须给出可读原因');
    assert.match(run.stderr, /src\/client\/x\.tmp/, 'stderr 必须点名是哪个文件');
    assert.equal(existsSync(path.join(tmp, 'lib', 'client.js')), false, '失败时不得落半成品产物');
  });
});

test('豁免边界：点前缀目录不递归（深路径不触发深度超限）；非点前缀深路径仍红', async () => {
  await withTempTree({
    'entry.mjs': 'export function createClientModule() { return {}; }\n',
    '.tmpdir/a/b/c/d/e/f/g/leaf.mjs': 'export const leaf = 1;\n',
  }, async (dir) => {
    const modules = await loadModules(dir);
    assert.deepEqual([...modules.keys()], ['./entry.mjs'], '点前缀目录不递归，里面的 .mjs 也不进图');
  });

  await withTempTree({
    'entry.mjs': 'export function createClientModule() { return {}; }\n',
    'a/b/c/d/e/leaf.mjs': 'export const leaf = 1;\n',
  }, async (dir) => {
    const error = await captureError(() => loadModules(dir));
    assert.ok(error instanceof BuildError, '非点前缀的超深目录仍必须变红');
    assert.match(String(error.message), /目录深度超限/);
  });
});

test('反假绿：把点前缀豁免从构建器里去掉，「真 CLI（正）：src/client 下放着 .tmpdir/x.tmp」的场景必须立刻变红', async () => {
  await withTempPackage('valid', async (tmp) => {
    const cli = path.join(tmp, 'scripts', 'build-client.mjs');
    const original = readFileSync(cli, 'utf8');
    const patched = original.replace("if (entry.name.startsWith('.')) continue;", 'if (false) continue;');
    assert.notEqual(patched, original, '变异必须真的落到构建器源码上（否则本用例本身是假绿）');
    await writeFile(cli, patched, 'utf8');

    await writeScratch(tmp, { '.tmpdir/x.tmp': 'half-written scratch\n' });
    const run = runBuilderCli(tmp);
    assert.equal(run.signal, null, 'CLI 不得被超时杀掉');
    assert.notEqual(run.status, 0, '去掉豁免后暂存物必须让构建变红 —— 证明「真 CLI（正）」那条的绿是豁免给的');
    assert.match(run.stderr, /只允许 \*\.mjs/, '变红的原因必须正是「非 .mjs 文件」这条判定');
    assert.equal(existsSync(path.join(tmp, 'lib', 'client.js')), false, '变异态下不得落产物');
  });
});
