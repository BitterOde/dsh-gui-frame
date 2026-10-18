/**
 * guide-contract.test.mjs —— **接入文档 ↔ 契约真源**的机检。
 *
 * 为什么需要它：随包 README 做入口，包中自带说明文档文件夹——
 * `guide/**` 从此是**对外交付面**（`package.json` 的 `files` 含它、`verify/freeze-rev.json` 的 SCOPE 含它）。
 * 文档最容易的死法不是写错，是**悄悄过期**：契约加了成员、文档没跟，外部读者照着旧表写代码。
 * 本项目对「散文事实」只装窄而稳的那一颗牙，但要有真牙。
 * 于是这里只做一类零歧义的判定：**名单的双向比对**（文档漏一个 / 多一个都判红），
 * 并把「解析器失效」本身也当失败（空块必须判红，不许因为取不到东西而恒绿）。
 *
 * 判据：
 *  三份 `guide/**` 文档都在；契约速查里**每个已登记块都能被解析出来且非空**
 *       （会红：块标记写坏 / 表格首格格式变了 / 文件被挪走 —— 防止「解析失败 = 空集 = 恒绿」这种假绿）。
 *  逐块**双向比对**：文档 ⊆ 真源 且 真源 ⊆ 文档（会红：漏一个名字 / 多一个名字 / 同名重复）。
 *  **没有无人管的块**：文档里出现的每个 `<!-- members:x -->` 都必须在真值表里登记
 *       （会红：新加一块名单却没人给它真值 ⇒ 那块等于没牙）。
 *  解析器**自带负控**：空块 / 少一个 / 多一个三种合成输入都必须判出问题；正确输入必须判绿。
 *  **README 做入口**：包根 README 必须给出指向 `guide/` 三份文档的指针，
 *       且 `package.json` 的 `files` 必须含 `guide`。
 *
 * 纪律：只读、不联网、不起进程（L0 之外的纯文本层）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMPONENT_NAMES } from '../../src/client/contracts/components.mjs';
import { ALL_CODES } from '../../src/client/contracts/errors.mjs';
import { GUIF_PUBLIC_VARS } from '../../src/client/kit/tokens.mjs';
import {
  CONSUMED_SLOT_KEYS, NAMESPACE_MEMBERS, PLATFORM_SERVICE_KEYS, SERVICE_MEMBERS,
} from '../../src/client/contracts/service-face.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');

/** `guide/` 三份文档（相对包根）。 */
const GUIDE_FILES = ['guide/README.md', 'guide/接入指南.md', 'guide/契约速查.md'];
/** 名单块所在的那一份。 */
const CONTRACT_REL = 'guide/契约速查.md';

/**
 * 块名 → 真值（真源恒为 `src/client/contracts/**` 的常量表；**唯一例外是 `vars`** ——
 * 公开外观变量登记在样式层 `src/client/kit/tokens.mjs` 的 `GUIF_PUBLIC_VARS`，那里才是它的真源，
 * 在 `guide/契约速查.md` 里有说明）。
 * **不在这张表里的块名 ⇒ G3 判红**：加了名单却没人给它真值，等于装了一块没有牙的板子。
 */
const BLOCK_TRUTH = new Map([
  ['service', { truth: SERVICE_MEMBERS, source: 'SERVICE_MEMBERS' }],
  ...Object.entries(NAMESPACE_MEMBERS).map(([name, members]) => [`namespace:${name}`, { truth: members, source: `NAMESPACE_MEMBERS.${name}` }]),
  ['components', { truth: COMPONENT_NAMES, source: 'COMPONENT_NAMES' }],
  ['errors', { truth: ALL_CODES, source: 'ALL_CODES' }],
  ['slots', { truth: CONSUMED_SLOT_KEYS, source: 'CONSUMED_SLOT_KEYS' }],
  ['platform', { truth: PLATFORM_SERVICE_KEYS, source: 'PLATFORM_SERVICE_KEYS' }],
  // ★ 坞面板外观开成一族公开变量 ⇒ 文档有了第七张名单
  ['vars', { truth: GUIF_PUBLIC_VARS, source: 'GUIF_PUBLIC_VARS（kit/tokens.mjs）' }],
]);

/** 读一份包内文件（读不到就抛：判据不允许「文件没了 ⇒ 静默通过」）。 */
function readPkgFile(rel) {
  return readFileSync(path.join(PKG_DIR, ...rel.split('/')), 'utf8');
}

/** 文档里出现过块名的全部（按出现顺序，可重复）。 */
function blockNames(text) {
  const names = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf('<!-- members:');
    if (at < 0) continue;
    const tail = line.indexOf('-->', at);
    if (tail < 0) continue;
    const name = line.slice(at + '<!-- members:'.length, tail).trim();
    if (name !== '' && !name.startsWith('/')) names.push(name);
  }
  return names;
}

/**
 * 解析一个名单块的首列名字。
 * 形态：块标记之间是 Markdown 表格，**第一格恒为 `` `名字` ``**（表头与分隔行不算）。
 * @returns {{found:boolean, names:string[]}}
 */
function parseBlock(text, name) {
  const open = `<!-- members:${name} -->`;
  const close = `<!-- /members:${name} -->`;
  const from = text.indexOf(open);
  const to = text.indexOf(close, from < 0 ? 0 : from);
  if (from < 0 || to < 0) return { found: false, names: [] };
  const names = [];
  for (const raw of text.slice(from + open.length, to).split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[1] === undefined ? '' : line.split('|')[1].trim();
    const matched = /^`([^`]+)`$/.exec(cell);
    if (matched !== null) names.push(matched[1]);
  }
  return { found: true, names };
}

/** 双向比对：返回问题清单（空数组 = 对得上）。 */
function compareBlock(docNames, truth) {
  const problems = [];
  const docSet = new Set(docNames);
  const truthSet = new Set(truth);
  if (docSet.size !== docNames.length) problems.push('文档列表里有重复名字');
  for (const item of truth) if (!docSet.has(item)) problems.push(`文档缺 ${item}`);
  for (const item of docNames) if (!truthSet.has(item)) problems.push(`文档多 ${item}`);
  return problems;
}

test('guide/ 三份文档都在，且契约速查的每个已登记块都能解析出非空名单', () => {
  for (const rel of GUIDE_FILES) {
    assert.ok(readPkgFile(rel).length > 0, `${rel} 必须在且非空（随包说明文档）`);
  }
  const text = readPkgFile(CONTRACT_REL);
  const seen = blockNames(text);
  assert.ok(seen.length >= BLOCK_TRUTH.size, `契约速查里探测到的块太少（${seen.length} < ${BLOCK_TRUTH.size}）—— 标记被误删或格式变了`);
  for (const name of BLOCK_TRUTH.keys()) {
    const parsed = parseBlock(text, name);
    assert.equal(parsed.found, true, `块 ${name} 的起止标记必须在（否则这一块等于没有牙）`);
    // ★ 这一条是**防假绿**的关键：解析器取不到名字时不能"两边都空 ⇒ 判绿"
    assert.ok(parsed.names.length > 0, `块 ${name} 解析出的名字数为 0 —— 表格首格格式必须恒为「\`名字\`」`);
  }
});

test('名单双向比对：文档与契约真源逐块对锁（漏一个 / 多一个都红）', () => {
  const text = readPkgFile(CONTRACT_REL);
  for (const [name, meta] of BLOCK_TRUTH) {
    const parsed = parseBlock(text, name);
    const problems = compareBlock(parsed.names, meta.truth);
    assert.deepEqual(problems, [], `块 ${name}（真源 ${meta.source}）不对锁：${problems.join('；')}`);
  }
});

test('没有无人管的块：文档里每个 members 块都必须在真值表里登记', () => {
  const seen = blockNames(readPkgFile(CONTRACT_REL));
  const unknown = [...new Set(seen.filter((name) => !BLOCK_TRUTH.has(name)))];
  assert.deepEqual(unknown, [], `这些块没有登记真值 ⇒ 等于没装牙：${unknown.join(' / ')}`);
});

test('解析器自带负控：空块 / 少一个 / 多一个都必须判出问题，正确输入必须判绿', () => {
  const open = '<!-- members:demo -->';
  const close = '<!-- /members:demo -->';
  const body = (rows) => `${open}\n| 名字 |\n| --- |\n${rows.map((r) => `| \`${r}\` |`).join('\n')}\n${close}`;
  const truth = ['alpha', 'beta'];

  // 正控：正确的合成块必须解析出两个名字、且比对为空（否则下面的负控全是空转）
  const ok = parseBlock(body(truth), 'demo');
  assert.deepEqual(ok, { found: true, names: ['alpha', 'beta'] }, '正控：合成块必须被完整解析');
  assert.deepEqual(compareBlock(ok.names, truth), [], '正控：正确输入必须判绿');

  // 负控 ①：空块 —— 必须判红（这是「解析器失效却判绿」的主要防线）
  const empty = parseBlock(`${open}\n${close}`, 'demo');
  assert.equal(empty.found, true, '块标记还在');
  assert.deepEqual(empty.names, [], '空块解析出空名单');
  assert.notDeepEqual(compareBlock(empty.names, truth), [], '★ 空块必须判红（不许当成「都没写 ⇒ 对得上」）');

  // 负控 ②：少一个
  const missing = parseBlock(body(['alpha']), 'demo');
  assert.deepEqual(compareBlock(missing.names, truth), ['文档缺 beta'], '少一个必须点名报出来');

  // 负控 ③：多一个 / 写错名字
  const extra = parseBlock(body(['alpha', 'beta', 'gamma']), 'demo');
  assert.deepEqual(compareBlock(extra.names, truth), ['文档多 gamma'], '多一个必须点名报出来');

  // 负控 ④：块标记缺失（整块被删）—— found=false 必须能被 G1 抓住
  assert.equal(parseBlock('# 没有块的文档', 'demo').found, false, '整块缺失必须可判');
});

test('README 做入口：包根 README 给出指向 guide/ 三份文档的指针，files 含 guide', () => {
  const readme = readPkgFile('README.md');
  for (const rel of GUIDE_FILES) {
    assert.ok(readme.includes(rel), `README 必须指向 ${rel}（随包 README 做入口）`);
  }
  const pkg = JSON.parse(readPkgFile('package.json'));
  assert.ok(pkg.files.includes('guide'), 'package.json 的 files 必须含 guide（否则说明文档不随包发布，入口就是死链）');
});
