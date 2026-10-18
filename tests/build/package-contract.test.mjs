/**
 * package-contract.test.mjs —— 独立复验（一）：**包清单与装载通道面**。
 *
 * 覆盖任务契约里两条验收：
 *   ① package.json 的 platform 为 web、exports 指向 lib/client.js、无 dsh.client.external、
 *      dependencies 为空（外加「键在任意深度都不存在」的递归扫描，防止换个层级藏起来）；
 *   ② 两条装载通道（bundle / dev）在配置里**只出现一条**——同时出现即 duplicate loader entry id。
 *
 * 独立性：本文件不复用 `scripts/build-client.mjs` 的 `packageChecks`，也不复用 tests/helpers；
 * YAML 由 `harness.mjs` 的 `parseInsertRows` 自写解析（并对解析器本身做非空转断言）。
 * 只读：本文件不写任何文件、不碰 profile（只读 profile 的 package.json / cordis.patch.yml）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CLIENT_OUT,
  LOADER_ID,
  PATCH_FILE,
  PKG_DIR,
  PKG_FILE,
  loadingChannels,
  parseInsertRows,
  pkg,
  readWebProfile,
} from './harness.mjs';

const manifest = JSON.parse(readFileSync(PKG_FILE, 'utf8'));

/** 递归找同名键（任意深度）。 */
function findKeysDeep(value, key, hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findKeysDeep(item, key, hits.map((h) => `${h}[${index}]`)));
    return hits;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) hits.push(k);
      findKeysDeep(v, key, hits);
    }
  }
  return hits;
}

test('package.json：platform=web / exports["./client"]→lib/client.js / 无 dsh.client.external / dependencies 为空', () => {
  assert.equal(manifest.name, 'dsh-gui-frame');
  assert.equal(manifest.name, pkg.name);

  // ① dsh.client.platform === 'web'
  assert.equal(manifest.dsh?.client?.platform, 'web', "dsh.client.platform 必须是 'web'");

  // ② exports['./client'] 指向 lib/client.js，且该文件真实存在、非空、是产物形态（以头注释开头）
  assert.equal(manifest.exports?.['./client'], './lib/client.js');
  const resolved = path.resolve(PKG_DIR, manifest.exports['./client']);
  assert.equal(resolved, CLIENT_OUT, "exports['./client'] 必须解析到包内 lib/client.js");
  assert.ok(existsSync(resolved), `exports 指向的产物必须存在：${resolved}`);
  assert.ok(statSync(resolved).size > 0, '产物不得是空文件');
  assert.equal(readFileSync(resolved, 'utf8').startsWith('/**'), true, '产物必须以构建器头注释开头');

  // ③ 不存在 dsh.client.external：键级 + 递归任意深度 + 原文级三重判据
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.dsh.client, 'external'), false, 'dsh.client 下不得有 external 键');
  assert.equal(manifest.dsh.client.external, undefined);
  assert.deepEqual(findKeysDeep(manifest, 'external'), [], '清单任意深度都不得出现 external 键（种子键由外壳的 __ModuleLoader__ 提供）');

  // ④ dependencies 为空
  assert.deepEqual(manifest.dependencies, {}, 'dependencies 必须是空对象（零第三方依赖）');
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(manifest.optionalDependencies ?? {}).length, 0, 'optionalDependencies 也必须为空');
  assert.equal(Object.keys(manifest.bundledDependencies ?? manifest.bundleDependencies ?? {}).length, 0, '不得内联打包依赖');

  // 旁证（通道判据的原料）：bundle 通道的声明字段与目标文件
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.ok(existsSync(path.join(PKG_DIR, manifest.dsh.bundle.patch)));

  // ⑤ 包内不得出现指向本产物的「第二份清单式声明」：lib/client.js 只由 exports 暴露一次
  assert.equal(manifest.main, 'lib/index.js', '宿主半区入口保持 lib/index.js（客户端半区走 exports["./client"]）');
});

test('两条装载通道只出现一条：bundle 就位 ∧ dev 未写；同时出现即红', (t) => {
  // ① 包侧：bundle 通道的声明必须齐备，且 patch 里**恰好一行** insert
  const patchText = readFileSync(PATCH_FILE, 'utf8');
  const rows = parseInsertRows(patchText);
  assert.equal(rows.length, 1, `本包 cordis.patch.yml 必须恰好一条 insert 行（当前 ${rows.length} 条）`);
  assert.equal(rows[0].id, LOADER_ID, 'insert id 恒为 gui-frame');
  assert.equal(rows[0].name, manifest.name, 'insert name 恒为包名');
  const bundleDeclared = manifest.dsh?.bundle?.patch === './cordis.patch.yml' && existsSync(PATCH_FILE) && rows.length === 1;

  // ② 解析器非空转：喂合成文本必须解析出该行（否则上面「恰好一行」可能是解析器失明）
  assert.deepEqual(
    parseInsertRows("- insert:\n    - id: gui-frame\n      name: 'dsh-gui-frame'\n"),
    [{ id: 'gui-frame', name: 'dsh-gui-frame' }],
    'parseInsertRows 必须能解析出 insert 行',
  );
  assert.deepEqual(
    parseInsertRows("- id: some-override\n  disabled: true\n"),
    [],
    '顶层 `- id: xxx` 是对已有 id 的覆写，不得被当成通道声明',
  );

  // ③ profile 侧：dev 通道 = profile 的 patch 里出现同 id（或同包名）的 insert 行
  const profile = readWebProfile();
  const devRows = profile.readable
    ? parseInsertRows(profile.patchText).filter((row) => row.id === LOADER_ID || row.name === manifest.name)
    : [];
  const bundles = profile.readable ? (profile.manifest?.dsh?.profile?.bundles ?? []) : [];
  const inBundles = bundles.includes(manifest.name);

  const channels = loadingChannels({ bundleDeclared, devRowFound: devRows.length > 0 });

  // ★ 主判据：两条通道**只出现一条**
  assert.equal(
    channels.activeCount,
    1,
    `装载通道必须恰好一条就位：bundle=${channels.bundle}（包侧声明）；dev=${channels.dev}（profile patch 里的 insert 行）`
    + (channels.activeCount === 2
      ? ' ⇒ 组合里会出现两行同 id，加载器抛 duplicate loader entry id，DSH 起不来'
      : ' ⇒ 没有任何通道就位，本包根本不会被装载'),
  );

  // ④ 若 profile 里真出现了本包 insert 行，则它必须**不**在 bundles 里（否则就是那条事故的组合）
  if (devRows.length > 0) {
    assert.equal(inBundles, false, 'profile patch 已手写本包 insert 行（dev 模式）时，dsh.profile.bundles 不得再列本包');
  }

  // ⑤ 判据牙齿：合成的「两条同时就位」世界必须被判违规
  assert.deepEqual(loadingChannels({ bundleDeclared: true, devRowFound: true }), { bundle: true, dev: true, activeCount: 2 });
  assert.equal(loadingChannels({ bundleDeclared: true, devRowFound: false }).activeCount, 1);
  assert.equal(loadingChannels({ bundleDeclared: false, devRowFound: true }).activeCount, 1);
  assert.equal(loadingChannels({ bundleDeclared: false, devRowFound: false }).activeCount, 0);

  t.diagnostic(
    `通道现状：bundle=${channels.bundle}｜dev=${channels.dev}｜profile ${profile.readable ? `可读（${profile.dir}）` : `不可读（${profile.dir}）`}`
    + `｜本包在 dsh.profile.bundles=${inBundles}｜bundle 挂载由收口时用户在场执行`,
  );
});
