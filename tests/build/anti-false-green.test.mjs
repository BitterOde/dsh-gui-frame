/**
 * anti-false-green.test.mjs —— 独立复验（四）：**验证这套验证自己的牙**。
 *
 * 「18 条用例全绿」本身不是证据：必须证明每一条**判据变红的能力**存在（反假绿 / 反空转断言）。
 * 做法：把包骨架（package.json / cordis.patch.yml / lib / scripts / tests）复制进系统 TEMP，
 * 在副本里做**一次定向变异**，然后用 `--test-reporter=tap` 跑**对应的那一条测试文件**，
 * 断言：① 子进程 exit≠0（套件确实变红）；② 变红的那条正是被变异命中的判据（不是别处崩了）。
 * 副本用完即删——**绝不碰包内文件、不碰真 profile**。
 *
 * 变异清单（每条都要被**它自己那条判据**抓住，写的是判据用例的标题）：
 *   dup-react      → react 只被 require 一次（静态 × 运行期）   （产物：双 React）
 *   second-load    → 顶层恰好一次 __ModuleLoader__.load         （产物：二次注册）
 *   wrong-id       → 顶层恰好一次 __ModuleLoader__.load（id ≠ 包名）
 *   esm-top        → classic script 判据（产物顶层出现 ESM import 语句）
 *   rogue-require  → require 集合 ⊆ 冻结白名单（factory 里 require 白名单外模块）
 *   platform       → 包清单与装载通道面（dsh.client.platform ≠ web）
 *   external       → 包清单与装载通道面（清单里出现 dsh.client.external）
 *   dependency     → 包清单与装载通道面（dependencies 非空）
 *   channel-both   → 两条装载通道只出现一条（假 profile 同时走 bundle + dev 两条通道）
 *   fixture-legal  → 故意越界 fixture：真 CLI exit≠0、不落产物、源码字节不变（越界属性一旦消失必须被抓）
 * 另加一条**阴性对照**：假 profile 只走 bundle 通道 ⇒ 通道判据必须保持绿（判据不是一票否决）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PKG_DIR, pkg } from './harness.mjs';

const ARTIFACT_SUITE = path.join('tests', 'build', 'artifact-shape.test.mjs');
const CONTRACT_SUITE = path.join('tests', 'build', 'package-contract.test.mjs');
const GUARDS_SUITE = path.join('tests', 'build', 'builder-guards.test.mjs');

/** 复制包骨架到 TEMP，按 `mutate` 改副本，跑指定测试文件，最后删除副本。 */
async function runVariant({ mutate = async () => {}, testFiles, fakeProfile = null }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'guif-t17-mut-'));
  try {
    for (const rel of ['package.json', 'cordis.patch.yml']) {
      await cp(path.join(PKG_DIR, rel), path.join(tmp, rel));
    }
    for (const dir of ['lib', 'scripts', 'tests']) {
      await cp(path.join(PKG_DIR, dir), path.join(tmp, dir), { recursive: true });
    }
    await mutate(tmp);

    const env = { ...process.env };
    // ★ 关键：清掉测试运行器身份，否则子进程会把自己当成「测试文件里的子测试」，
    // 打印 "node:test run() is being called recursively within a test file. skipping running files."
    // 然后**空跑 exit 0** —— 那会让下面每条「变异必须变红」变成假绿（本用例第一版就踩到过）。
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_TEST_REPORTER;
    if (fakeProfile !== null) {
      const home = path.join(tmp, '.fake-dsh-home');
      const profileDir = path.join(home, 'profiles', 'web');
      await mkdir(profileDir, { recursive: true });
      await writeFile(
        path.join(profileDir, 'package.json'),
        JSON.stringify({ name: 'dsh-profile-web', dsh: { profile: { bundles: fakeProfile.inBundles ? [pkg.name] : [] } } }, null, 2),
        'utf8',
      );
      await writeFile(
        path.join(profileDir, 'cordis.patch.yml'),
        fakeProfile.devInsert
          ? "- insert:\n    - id: gui-frame\n      name: 'dsh-gui-frame'\n"
          : '# 假 profile：不写 dev 通道\n',
        'utf8',
      );
      env.DSH_HOME = home;
    }

    const result = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', ...testFiles],
      { cwd: tmp, encoding: 'utf8', env, timeout: 120_000 },
    );
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const failing = out
      .split(/\r?\n/)
      .map((line) => /^not ok \d+ - (.*)$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => match[1].trim());
    return { status: result.status, out, failing, tmp };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** 把 `lib/client.js` 读出来、改、写回。 */
async function mutateClient(tmp, transform) {
  const file = path.join(tmp, 'lib', 'client.js');
  const source = await readFile(file, 'utf8');
  const next = transform(source);
  assert.notEqual(next, source, '变异必须真的命中（否则该变异用例是空转）');
  await writeFile(file, next, 'utf8');
}

async function mutateManifest(tmp, transform) {
  const file = path.join(tmp, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  transform(manifest);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

const MUTATIONS = [
  {
    id: 'dup-react',
    label: 'lib/client.js 里 react 被 require 两次',
    suite: ARTIFACT_SUITE,
    expect: 'react 只被 require 一次（静态 × 运行期；重复注入必须变红）',
    mutate: (tmp) => mutateClient(tmp, (source) => source.replace(
      '    var react = require("react");',
      '    var react = require("react");\n    var reactAlias = require("react");',
    )),
  },
  {
    id: 'second-load',
    label: '产物顶层再调一次 __ModuleLoader__.load',
    suite: ARTIFACT_SUITE,
    expect: '顶层恰好一次 __ModuleLoader__.load({id, factory})，且 id === 包名',
    mutate: (tmp) => mutateClient(tmp, (source) => `${source}\nwindow.__ModuleLoader__.load({ id: 'second', factory: function () { return {}; } });\n`),
  },
  {
    id: 'wrong-id',
    label: 'load 的 id 改成别的名字（≠ 包名）',
    suite: ARTIFACT_SUITE,
    expect: '顶层恰好一次 __ModuleLoader__.load({id, factory})，且 id === 包名',
    mutate: (tmp) => mutateClient(tmp, (source) => source.replace('  id: "dsh-gui-frame",', '  id: "dsh-not-the-package-name",')),
  },
  {
    id: 'esm-top',
    label: '产物顶层插入 ESM import 语句（不再是 classic script）',
    suite: ARTIFACT_SUITE,
    expect: 'classic script：new Function("window", source) 可加载 ∧ 顶层无 import/export；node --check 单用不构成反证',
    mutate: (tmp) => mutateClient(tmp, (source) => `import 'react';\n${source}`),
  },
  {
    id: 'rogue-require',
    label: 'factory 里 require 一个白名单外的模块（lodash）',
    suite: ARTIFACT_SUITE,
    expect: '只有 window.__ModuleLoader__ 的假环境加载产物：require 集合 ⊆ 冻结白名单（不重不漏）',
    mutate: (tmp) => mutateClient(tmp, (source) => source.replace(
      '  factory: function (require) {',
      '  factory: function (require) {\n    var evil = require("lodash");',
    )),
  },
  {
    id: 'platform',
    label: 'package.json 的 dsh.client.platform 改成 desktop',
    suite: CONTRACT_SUITE,
    expect: 'package.json：platform=web / exports["./client"]→lib/client.js / 无 dsh.client.external / dependencies 为空',
    mutate: (tmp) => mutateManifest(tmp, (manifest) => { manifest.dsh.client.platform = 'desktop'; }),
  },
  {
    id: 'external',
    label: 'package.json 里塞进 dsh.client.external',
    suite: CONTRACT_SUITE,
    expect: 'package.json：platform=web / exports["./client"]→lib/client.js / 无 dsh.client.external / dependencies 为空',
    mutate: (tmp) => mutateManifest(tmp, (manifest) => { manifest.dsh.client.external = { react: 'react' }; }),
  },
  {
    id: 'dependency',
    label: 'package.json 的 dependencies 非空',
    suite: CONTRACT_SUITE,
    expect: 'package.json：platform=web / exports["./client"]→lib/client.js / 无 dsh.client.external / dependencies 为空',
    mutate: (tmp) => mutateManifest(tmp, (manifest) => { manifest.dependencies = { lodash: '^4.17.21' }; }),
  },
  {
    id: 'channel-both',
    label: '假 profile 同时走 bundle + dev 两条通道（duplicate loader entry id 世界）',
    suite: CONTRACT_SUITE,
    expect: '两条装载通道只出现一条：bundle 就位 ∧ dev 未写；同时出现即红',
    fakeProfile: { inBundles: true, devInsert: true },
  },
  {
    id: 'fixture-legal',
    label: '把「故意越界的夹具」改成合法模块（越界属性消失）',
    suite: GUARDS_SUITE,
    expect: '故意越界 fixture：真 CLI exit≠0、不落产物、源码字节不变 = 失败而非静默改写',
    mutate: async (tmp) => {
      await writeFile(
        path.join(tmp, 'tests', 'build', 'fixtures', 'out-of-bounds', 'entry.mjs'),
        'export function createClientModule() { return { apply() {}, inject: [] }; }\n',
        'utf8',
      );
    },
  },
];

for (const mutation of MUTATIONS) {
  test(`反假绿：${mutation.label} ⇒ 对应用例必须变红`, async () => {
    const result = await runVariant({
      mutate: mutation.mutate,
      testFiles: [mutation.suite],
      fakeProfile: mutation.fakeProfile ?? null,
    });
    assert.notEqual(
      result.status,
      0,
      `变异「${mutation.id}」没被抓住（假绿！）—— ${mutation.suite} 在副本里仍然全绿：\n${result.out.slice(-1800)}`,
    );
    assert.ok(
      result.failing.some((name) => name.includes(mutation.expect)),
      `变异「${mutation.id}」确实变红了，但红的不是 ${mutation.expect}（说明该判据本体是空转）：失败项 = ${result.failing.join(' ｜ ')}`,
    );
  });
}

test('阴性对照：假 profile 只走 bundle 通道 ⇒ 通道判据必须保持绿（判据不是一票否决）', async () => {
  const result = await runVariant({
    testFiles: [CONTRACT_SUITE],
    fakeProfile: { inBundles: true, devInsert: false },
  });
  assert.equal(
    result.status,
    0,
    `只走 bundle 通道本该是合法世界，通道判据却变红了（判据过严）：\n${result.out.slice(-1800)}`,
  );
  assert.deepEqual(result.failing, []);
});
