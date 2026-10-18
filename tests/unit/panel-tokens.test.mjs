/**
 * panel-tokens.test.mjs —— **样式层与静态契约**的机检门禁。
 *
 * 这一层全是**静态扫描**（读源码文本 + 读官方产物文本），因为这几条约定的失效方式恰恰是
 * 「某个文件里悄悄多写了一个悬空 token / 一个未冻结码名 / 一段 JSX」，跑起来不一定报错。
 *
 * 扫描口径：
 *  - 先剥注释（块注释 + 行注释），再匹配 —— 注释里的示例代码（`<div>`、`--dsw-xxx`）不该被当成违规；
 *    但**码名不剥**：「注释与字符串同样算数」是这条的约定（另有一处全文正则门禁按同一口径扫）。
 *  - `--dsw-*` / `--guif-*` 的名字一律要求落在 `kit/tokens.mjs` 的白名单里（不在就红）。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ALL_CODES } from '../../src/client/contracts/errors.mjs';
import { GUIF_PRIVATE_PREFIX, GUIF_PRIVATE_VARS, GUIF_PUBLIC_PREFIX, GUIF_PUBLIC_VARS, DSW_TOKENS, isGuifPrivateVar, isGuifPublicVar } from '../../src/client/kit/tokens.mjs';
import { PRIMITIVES_MEMBERS, PRIMITIVES_SCAN, PRIMITIVES_USED } from '../../src/client/kit/primitives.mjs';
import { PKG_DIR, SRC_CLIENT_DIR, readPlatformFile, resolveDshInstallDir } from './dock-fixtures.mjs';

/** 本套件覆盖的全部产品源码（坞 + 面板 + **下沉到 kit 的样式/字形层**）。 */
function scopedFiles() {
  const panelDir = path.join(SRC_CLIENT_DIR, 'panel');
  const kitDir = path.join(SRC_CLIENT_DIR, 'kit');
  const files = ['dock.mjs'];
  for (const name of readdirSync(panelDir).sort()) {
    if (name.endsWith('.mjs')) files.push(`panel/${name}`);
  }
  // 表面/字形层下沉 `kit/**`（共享叶）——扫描面跟着实现走。
  // 不跟着走的话，「登记了却没人用＝死声明」与「不许硬编码颜色」两条判据会漏掉一半实现（实测）：
  // `--guif-dock-badge-bg` 的唯一取用点就在 `kit/entry-icons.mjs` 里。
  for (const name of readdirSync(kitDir).sort()) {
    if (name.endsWith('.mjs')) files.push(`kit/${name}`);
  }
  // 面板壳拆件：`panel/components/{views,shell}.mjs` 与 `panel/components.mjs` 同族 ——
  // 扫描面跟着实现走（只扩不缩）：不跟着走，「取用的成员必须登记」与「不许 JSX」会漏掉壳的一半实现。
  for (const name of readdirSync(path.join(panelDir, 'components')).sort()) {
    if (name.endsWith('.mjs')) files.push(`panel/components/${name}`);
  }
  // 坞拆件：`dock/{panels}.mjs` 与 `dock.mjs` 同族 —— 扫描面跟着实现走（只扩不缩）：
  // 坞的**面板组件与打开面板**都在这里，不跟着走的话「取用必须登记」「废弃码名」
  // 「不新造错误码」「不许 JSX」四条会**漏掉坞的一半实现**（判据面缩水＝偷偷放宽）。
  for (const name of readdirSync(path.join(SRC_CLIENT_DIR, 'dock')).sort()) {
    if (name.endsWith('.mjs')) files.push(`dock/${name}`);
  }
  return files.map((rel) => ({ rel, text: readFileSync(path.join(SRC_CLIENT_DIR, ...rel.split('/')), 'utf8') }));
}

/** 剥注释（块 + 行），用于「代码里有没有 JSX / 硬编码颜色」这类扫描。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const FILES = scopedFiles();

/** 名字的合法取用点（只数"真的取了一个成员"的调用，不数前缀常量）。 */
const MEMBER_CALL = /(?:primitives\.(?:get|has)|atom)\(\s*'([A-Za-z0-9_$]+)'\s*\)/g;

/** 前缀常量本身（`'--guif-private-'` 这类）不是变量名，扫描时要排掉。 */
const BARE_PREFIXES = new Set(['--dsw-', '--guif-', '--guif-private-']);

test('样式只走 --dsw-* token 与 --guif-* 变量：名字全部落在白名单，且无硬编码颜色', () => {
  const dswSeen = new Set();
  const guifSeen = new Set();
  for (const { rel, text } of FILES) {
    const code = stripComments(text);
    for (const match of code.matchAll(/--dsw-[A-Za-z0-9_-]*/g)) {
      if (BARE_PREFIXES.has(match[0])) continue;
      dswSeen.add(match[0]);
      assert.ok(DSW_TOKENS.includes(match[0]), `${rel} 用了白名单外的 --dsw-* token「${match[0]}」（白名单＝P4 证据里真实声明过的 token 子集）`);
    }
    for (const match of code.matchAll(/--guif(?:-private)?-[A-Za-z0-9_-]*/g)) {
      if (BARE_PREFIXES.has(match[0])) continue;
      guifSeen.add(match[0]);
      assert.ok(
        GUIF_PUBLIC_VARS.includes(match[0]) || GUIF_PRIVATE_VARS.includes(match[0]),
        `${rel} 用了未登记的 --guif-* 变量「${match[0]}」（公开/私有都必须先在 tokens.mjs 登记）`,
      );
    }
    // 硬编码颜色：十六进制 / rgb(a) / hsl(a)
    for (const match of code.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)) {
      assert.fail(`${rel} 出现硬编码颜色「${match[0]}」——颜色只走 --dsw-* token`);
    }
    for (const keyword of ['red', 'blue', 'green', 'white', 'black', 'gray', 'grey']) {
      assert.equal(
        new RegExp(`['"]${keyword}['"]`).test(code),
        false,
        `${rel} 出现颜色关键字「${keyword}」——颜色只走 --dsw-* token`,
      );
    }
  }
  assert.ok(dswSeen.size >= 8, `样式层至少要真的用到若干 token（当前 ${dswSeen.size} 个：${[...dswSeen].join('、')}）`);
  assert.ok(guifSeen.size >= 8, `--guif-* 变量要真的被使用（当前 ${guifSeen.size} 个）`);
  // 反向：登记了却没人用 = 死声明
  for (const name of [...GUIF_PUBLIC_VARS, ...GUIF_PRIVATE_VARS]) {
    assert.ok(guifSeen.has(name), `tokens.mjs 登记了 ${name} 但没有任何样式在用它（死声明，应删或接上）`);
  }
});

test('私有变量一律 --guif-private-*、公开变量一律 --guif-*：命名判据与源码一致', () => {
  for (const name of GUIF_PRIVATE_VARS) {
    assert.ok(name.startsWith(GUIF_PRIVATE_PREFIX), `${name} 必须是 --guif-private-* 前缀`);
    assert.equal(isGuifPrivateVar(name), true);
    assert.equal(isGuifPublicVar(name), false, '--guif-private-* 不得被判为公开变量（前缀包含关系的经典坑）');
  }
  for (const name of GUIF_PUBLIC_VARS) {
    assert.ok(name.startsWith(GUIF_PUBLIC_PREFIX), `${name} 必须是 --guif-* 前缀`);
    assert.equal(isGuifPublicVar(name), true);
    assert.equal(isGuifPrivateVar(name), false);
  }
  assert.equal(isGuifPublicVar('--dsw-alias-bg-base'), false);
  assert.equal(isGuifPublicVar('--guif-private-header-min-height'), false);
  // 源码里出现过的每个 --guif-* 名字都必须能被上述两个判据之一接住
  for (const { rel, text } of FILES) {
    for (const match of text.matchAll(/--guif(?:-private)?-[A-Za-z0-9_-]+/g)) {
      assert.ok(isGuifPrivateVar(match[0]) || isGuifPublicVar(match[0]), `${rel} 的「${match[0]}」既不是公开变量也不是私有变量`);
    }
  }
});

test('白名单里的 token 都在平台真实声明过，且都不在"被引用但没声明"的陷阱名单里', (t) => {
  const theme = readPlatformFile('dsh-client-ui-theme/lib/client.js');
  const evidenceFile = path.join(PKG_DIR, 'probe', 'evidence', 'p4-theme-tokens.json');
  let evidence = null;
  try {
    evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
  } catch {
    evidence = null;
  }
  if (theme === null && evidence === null) {
    t.skip('既没有本机 DSH 的 ui-theme 产物，也没有 P4 证据档 —— 无平台不判（白名单的静态自洽仍由 A10 覆盖）');
    return;
  }
  if (evidence !== null) {
    const traps = new Set(evidence.D_tree.referencedNotDeclared ?? []);
    for (const name of DSW_TOKENS) {
      assert.equal(traps.has(name), false, `${name} 在"被引用但主题表没声明"的陷阱名单里（写上去就是悬空色）`);
    }
  }
  if (theme !== null) {
    const declared = new Set();
    for (const match of theme.text.matchAll(/(--dsw-[A-Za-z0-9_-]+)\s*:/g)) declared.add(match[1]);
    assert.ok(declared.size > 0, 'ui-theme 产物里应能取到 --dsw-* 声明');
    for (const name of DSW_TOKENS) {
      assert.ok(declared.has(name), `${name} 不在 ui-theme 产物声明的 ${declared.size} 条 --dsw-* 里（悬空 token）`);
    }
    t.diagnostic(`平台声明 --dsw-* 共 ${declared.size} 条；本包白名单 ${DSW_TOKENS.length} 条全部命中`);
  }
});

test('primitives 静态：源码里取用的成员全部落在 PRIMITIVES_USED / 官方真实用过的子集里', () => {
  const used = new Set();
  for (const { rel, text } of FILES) {
    const code = stripComments(text);
    for (const match of code.matchAll(MEMBER_CALL)) {
      used.add(match[1]);
      assert.ok(PRIMITIVES_USED.includes(match[1]), `${rel} 取了 ${match[1]}，但它不在 PRIMITIVES_USED 里（新增取用要先登记并给证据）`);
    }
    assert.equal(/primitives\.[A-Z]/.test(code), false, `${rel} 出现了对 primitives 成员的直接取用 —— 必须走受限取用面 createPrimitivesSeat.get()`);
  }
  assert.deepEqual([...used].sort(), [...PRIMITIVES_USED].sort(), '源码实际取用的成员集合必须与 PRIMITIVES_USED 一致（不多不少）');
  assert.equal(PRIMITIVES_SCAN.packages, 50, '证据表声明扫的是 50 个官方包');
  assert.equal(PRIMITIVES_SCAN.members, 180);
  assert.equal(PRIMITIVES_MEMBERS.length, 180);
});

test('平台在位时重扫 50 个官方包：PRIMITIVES_USED ⊆ 实时结果（可重演）', (t) => {
  const root = resolveDshInstallDir();
  if (root === null) {
    t.skip('未找到本机 DSH 安装 —— 复扫是无平台不判的探针');
    return;
  }
  const packagesDir = path.join(root, 'node_modules', '@deepseek-ai');
  let dirs;
  try {
    dirs = readdirSync(packagesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    t.skip('读不到官方包目录 —— 无平台不判');
    return;
  }
  const live = new Set();
  let scanned = 0;
  for (const dir of dirs) {
    let text;
    try {
      text = readFileSync(path.join(packagesDir, dir, 'lib', 'client.js'), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('@deepseek-ai/dsh-client-ui-primitives')) continue;
    scanned += 1;
    const aliases = new Set();
    for (const match of text.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*require\(['"]@deepseek-ai\/dsh-client-ui-primitives['"]\)/g)) aliases.add(match[1]);
    for (const alias of aliases) {
      const re = new RegExp(`\\b${alias.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)`, 'g');
      for (const match of text.matchAll(re)) live.add(match[1]);
    }
  }
  assert.ok(scanned > 0, '应至少扫到 1 个引用 primitives 的官方包');
  for (const name of PRIMITIVES_USED) {
    assert.ok(live.has(name), `实时复扫里没有 ${name}（用到的成员必须是官方真实用过的；证据表需要重扫）`);
  }
  const missing = PRIMITIVES_MEMBERS.filter((name) => !live.has(name));
  t.diagnostic(`实时复扫：${scanned} 个包 / 不同成员 ${live.size} 个；冻结表 180 个，其中不在实时集合里的 ${missing.length} 个${missing.length === 0 ? '' : `：${missing.slice(0, 8).join('、')}`}`);
});

test('panel/ 与 dock.mjs 里不得残留已废弃的码名 GUIF-E-TOKEN-UNKNOWN（注释与字符串同样算数）', () => {
  for (const { rel, text } of FILES) {
    assert.equal(
      text.includes('GUIF-E-TOKEN-UNKNOWN'),
      false,
      `${rel} 里残留了废弃码名 GUIF-E-TOKEN-UNKNOWN —— 全文正则门禁扫 src/**，注释也算`,
    );
  }
});

test('不新造错误码：本任务源码里出现的每一个 GUIF-[EW]-* 都在冻结集合内', () => {
  const frozen = new Set(ALL_CODES);
  const seen = new Set();
  for (const { rel, text } of FILES) {
    for (const match of text.matchAll(/GUIF-[EW]-[A-Z0-9-]+/g)) {
      seen.add(match[0]);
      assert.ok(frozen.has(match[0]), `${rel} 出现了未冻结的错误码「${match[0]}」—— 需要新码要回报 captain，不得自行改 src/client/contracts/ 与 tests/contracts/`);
    }
  }
  assert.ok(seen.size > 0, '本任务至少要用到既有码（组件层入参非法 / 吞错诊断）');
  for (const code of seen) {
    assert.ok(ALL_CODES.includes(code));
  }
  // 反向：本任务只允许 import contracts（读），不得反向定义
  for (const { rel, text } of FILES) {
    for (const match of text.matchAll(/^export const ([A-Z_]+_CODES)\b/gm)) {
      assert.fail(`${rel} 定义了错误码表 ${match[1]}—— 码表真源只有 src/client/contracts/errors.mjs`);
    }
  }
});

test('没有 JSX / TS：剥掉注释后源码里不存在 JSX 语法，也没有 .jsx/.tsx 文件', () => {
  for (const { rel, text } of FILES) {
    const code = stripComments(text);
    const jsx = /<[A-Za-z][A-Za-z0-9.]*(\s[^<>{}]*)?\/?>/.exec(code);
    assert.equal(jsx, null, `${rel} 里出现了 JSX 语法「${jsx?.[0] ?? ''}」—— 打包器不做 JSX 变换，必须用 react.createElement`);
  }
  const panelDir = path.join(SRC_CLIENT_DIR, 'panel');
  // ★ 2026-10-04 解耦：`panel/components/` 是新的**子目录**（面板壳拆件的落点）⇒
  //   判据改成**递归列文件**（意图一字未改、且更严：任意深度的非 .mjs 文件都要报）。
  const collectNames = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? collectNames(path.join(dir, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]));
  for (const name of collectNames(panelDir)) {
    assert.ok(name.endsWith('.mjs') || name.endsWith('.d.mjs'), `panel/ 下只允许 .mjs（发现 ${name}）`);
  }
  assert.equal(readdirSync(SRC_CLIENT_DIR).some((name) => name.endsWith('.jsx')), false);
});
