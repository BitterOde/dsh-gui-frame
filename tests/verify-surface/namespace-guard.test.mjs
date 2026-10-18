/**
 * namespace-guard.test.mjs —— 独立复验（七）：**命名空间与写盘纪律**。
 *
 * 覆盖验收：**验证脚本写在自己的 `tests/verify-surface/**`
 * 命名空间，且不得改写被测的 `tests/contracts/public-surface.json`**。
 *
 * 两条机械判据：
 *   ① 静态：本命名空间内**所有**写 API 调用的实参必须指向 `mkdtemp` 出来的 TEMP 副本（`tmp` 或其派生名），
 *      且不得直接点名被测快照档；
 *   ② 运行期：被测快照的 mtime 必须早于本测试进程的模块加载时刻（本次运行没有写过它）。
 * 两条都带「牙齿」：合成一段「往仓库里写」的源码，同一个扫描器必须能抓出来。
 *
 * 只读：本文件不写任何文件。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { HERE, SNAPSHOT_PATH, listFilesRecursive, scanWriteCalls, tempDerivedNames } from './harness.mjs';

/** 本测试进程的模块加载时刻（用于「快照没被本次运行写过」的运行期判据）。 */
const MODULE_LOAD_MS = Date.now();

test('验证脚本只住在 tests/verify-surface/**，写盘只落在 TEMP 副本（被测快照只读）', () => {
  const files = listFilesRecursive(HERE);
  assert.ok(files.length >= 6, `本命名空间文件太少（${files.length}）⇒ 覆盖不足`);

  // ① 不另存一份被测对象
  assert.equal(
    existsSync(path.join(HERE, 'public-surface.json')),
    false,
    '快照档归实现方（tests/contracts/public-surface.json），验证方不得在自己的命名空间里复制一份',
  );

  // ② 写调用静态扫描：实参必须指向 TEMP 副本
  const sites = [];
  for (const file of files.filter((entry) => entry.rel.endsWith('.mjs'))) {
    const source = readFileSync(file.full, 'utf8');
    const tempNames = tempDerivedNames(source);
    for (const call of scanWriteCalls(source)) sites.push({ file: file.rel, tempNames, ...call });
  }
  assert.ok(sites.length >= 6, `写调用扫描必须真的扫到东西（当前 ${sites.length} 处）—— 否则本判据是空转`);

  const offenders = [];
  for (const site of sites) {
    const isTemp = [...site.tempNames].some((name) => new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`).test(site.args));
    if (!isTemp) offenders.push(`${site.file}:${site.line} ${site.api}(…) 的实参里没有 TEMP 副本名（可用：${[...site.tempNames].join(' / ')}）`);
    if (/public-surface\.json/.test(site.args)) offenders.push(`${site.file}:${site.line} ${site.api}(…) 直接点名了被测快照档`);
  }
  assert.deepEqual(offenders, [], `本命名空间出现了仓库内写盘：\n  - ${offenders.join('\n  - ')}`);

  // ③ 牙齿：同一扫描器对「写仓库」与「写 TEMP」两段合成源码必须给出相反判断
  //   （合成文本里的 API 名拆开拼，免得本文件自己被扫描器点名）
  const writeApi = `write${'File'}(`;
  const badCalls = scanWriteCalls(`await ${writeApi}path.join(PKG_DIR, 'tests', 'contracts', 'public-surface.json'), text);\n`);
  assert.equal(badCalls.length, 1, '扫描器必须抓得到 writeFile');
  assert.equal(/(?<![A-Za-z0-9_$])tmp(?![A-Za-z0-9_$])/.test(badCalls[0].args), false, '写仓库的调用不得被误判为 TEMP 写');
  assert.equal(/public-surface\.json/.test(badCalls[0].args), true);
  const goodCalls = scanWriteCalls(`await ${writeApi}path.join(tmp, 'x.json'), text);\n`);
  assert.equal(goodCalls.length, 1);
  assert.equal(/(?<![A-Za-z0-9_$])tmp(?![A-Za-z0-9_$])/.test(goodCalls[0].args), true);

  // ④ 运行期：被测快照在本次运行里没被写过（mtime 必须早于本测试进程的模块加载时刻）
  const stat = statSync(SNAPSHOT_PATH);
  assert.ok(stat.size > 400, `快照档过小（${stat.size} 字节）`);
  assert.ok(
    stat.mtimeMs < MODULE_LOAD_MS,
    `被测快照的 mtime（${new Date(stat.mtimeMs).toISOString()}）不早于本进程模块加载时刻 —— 本次运行写过它！`,
  );
});
