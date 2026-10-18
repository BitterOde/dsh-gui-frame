#!/usr/bin/env node
/**
 * check-citations.mjs —— **「引用的证据目录必须真实存在」的机检**。
 *
 * 为什么需要它：真机说明书（`verify/real-machine/README.md`）、验收记录（`docs/验收记录-真机-*.md`）
 * 与**开发日志**（`docs/开发日志-*.md`）里到处在引用 `evidence/<stamp>` 目录当论据 —— 一旦引用写错（写了一个**根本不存在**的轮次），
 * 读者无法从纸面分辨「真有那条证据」还是「作者记错了」——这一条最早就是靠人眼抓出来的。
 * 这条机检把「引用的目录存在」从人眼变成退出码。
 *
 * 口径（只判**存在性**，不判结论对错）：
 *   · 扫 `evidence/<名字>` 形式的引用 ⇒ `<名字>` 必须是 `verify/real-machine/evidence/` 下的真实目录；
 *   · 扫**完整轮次名**（`YYYY-MM-DDThh-mm-ss-mmmZ` 或带 `-mut-xxx` 后缀）⇒ 同样必须是真实目录；
 *     （README/报告在正文里会省略 `evidence/` 前缀只写轮次名，那也是引用。）
 *   · 逐条打印 ✓/✗；**只要有一条 ✗ 就 exit 1** 并列出条目。
 *
 * ★ 两处**收紧**（本装置自己的跨树误判收口）：
 *   ① **带前缀的引用只认本包**：只允许「包内相对」（`verify/real-machine/…`、`tools/…`）与
 *      「工作区相对但**以本包目录名开头**」（`<本包目录名>/verify/real-machine/…`）两种写法，且解析结果必须仍在
 *      `PKG_DIR` 之内。旧写法还返回 `workspaceRoot + prefix` 这个候选 ⇒ 在本包副本里写邻居包的 `dsh-gui-frame/verify/…`
 *      会解析到**隔壁真树**、那里证据目录真实存在 ⇒ 判绿，而本包自己的证据面没人管（装置去判邻居树）。
 *   ② **完整轮次名必须独立成词**（前后不得粘 `[A-Za-z0-9._-]`）：形如 `.tmp-repro/tree-align-backup-<戳>`、
 *      `%TEMP%/guif-dsh-<戳>` 的**临时目录名**不是证据引用（旧写法把里面的戳记当轮次名去查，文档里那条
 *      「文档里能引用它）的轮次」反而被这些临时量搅红）。被排除的戳记**不静默丢弃**，逐条记账打印。
 *
 * 不判什么（如实说清，免得被当万灵药）：
 *   · **不判**「引用的那一轮里判据结论是否与文中所说一致」—— 那是语义核对，得读那一轮的 `raw.json`；
 *     本脚本抓不到「引错了另一个**存在**的轮次」这种错，只能靠人读 raw.json 复核；
 *   · **不判**非证据面的引用（`src/**`、`tests/**`、`docs/xxx.md` 这类路径）—— 本脚本只认上面两种形态，
 *     其余一律不抓 ⇒ 「没被报 ✗」**不等于**「整段话都对」。
 *
 * 跑法：
 *   node verify/real-machine/check-citations.mjs                       # 默认扫 README + docs/验收记录-真机-*.md + docs/开发日志-*.md
 *   node verify/real-machine/check-citations.mjs --files=a.md,b.md     # 指定文件（自带反例自检用）
 * 零第三方依赖；**不起任何进程、不读网络**。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');
/** **本包目录名**（自定位派生，不写死）：工作区相对的写法只认以它开头的那种。 */
const PKG_NAME = path.basename(PKG_DIR);
const EVIDENCE_DIR = path.join(HERE, 'evidence');

/** 证据目录清单（一次读盘；后面所有比对都在这份集合上做，不做模糊匹配）。 */
function evidenceNames() {
  let names = [];
  try {
    names = readdirSync(EVIDENCE_DIR).filter((name) => {
      try {
        return statSync(path.join(EVIDENCE_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    names = [];
  }
  return new Set(names);
}

/**
 * 默认要扫的文本：装置 README + 全部**真机验收记录** + 全部**开发日志**。
 * 三类都是「会拿证据目录当论据」的文档；`docs/开发日志-*.md` 在「交付态实测数字」段逐条标注命令与证据文件，
 * 不纳入机检面就等于那份文档的引用「没人管」。
 */
function defaultFiles() {
  const files = [path.join(HERE, 'README.md')];
  const docsDir = path.join(PKG_DIR, 'docs');
  try {
    for (const name of readdirSync(docsDir)) {
      // 「验收记录-真机-*」「验收记录-工作台-*」与「开发日志-*」三类；其它 docs 文件（需求基线、探针记录…）不在此面内
      if (/^(验收记录-真机-|验收记录-工作台-|开发日志-).*\.md$/.test(name)) files.push(path.join(docsDir, name));
    }
  } catch {
    // docs/ 不在就没有第二个来源；README 仍在扫
  }
  return files.filter((file) => existsSync(file));
}

/**
 * 从一段文本里抽出**引用**：
 *   ① `…evidence/<名字>` 形式 —— **带前缀就按前缀解析**：`verify/real-machine/evidence/X` 与
 *      `tools/evidence/X` 是**两个不同的证据根**，混着查会把对的判成错的（首跑就踩到这条）；
 *   ② 正文里省略前缀的**完整轮次名**（`…Z` 结尾，或再带 `-mut-xxx`）—— 它们指本装置的证据根。
 * 返回 `[{ root, name, index, form }]`。
 */
function extractCitations(text) {
  const found = [];
  const loose = [];
  const push = (roots, prefix, name, index, form) => {
    const clean = name.replace(/[`）)\]】,，。；;：:]/g, '');
    if (clean !== '') found.push({ roots, prefix, name: clean, index, form });
  };
  for (const match of text.matchAll(/([A-Za-z0-9._/-]*?)evidence\/([A-Za-z0-9._:-]+)/g)) {
    const prefix = String(match[1] ?? '').replace(/\\/g, '/');
    push(resolveRoots(prefix), prefix, match[2], match.index ?? 0, `evidence/（前缀＝${prefix === '' ? '默认' : prefix}）`);
  }
  // ② 正文里省略前缀的**完整轮次名** —— 只认**独立成词**的戳记（前后不得粘 `[A-Za-z0-9._-]`）。
  //    粘连 = 它只是某个更长的名字里的一段（临时备份目录 `…-backup-<戳>`、临时 home `guif-dsh-<戳>`），不是证据轮次。
  const STAMP = String.raw`20\d\d-\d\d-\d\dT\d\d-\d\d-\d\d-\d\d\dZ(?:-mut-[a-z0-9-]+)?`;
  for (const match of text.matchAll(new RegExp(String.raw`(?<![\w.-])(${STAMP})(?![\w.-])`, 'g'))) {
    push([EVIDENCE_DIR], '', match[1], match.index ?? 0, '轮次名');
  }
  // ★ 被排除的那些戳记单独记账（**不静默丢弃**）：把承载它的那个「更长的词」原样打出来，读者能自己判。
  for (const match of text.matchAll(new RegExp(String.raw`([A-Za-z0-9._/-]*?)(${STAMP})([A-Za-z0-9._-]*)`, 'g'))) {
    const before = match[1] ?? '';
    const after = match[3] ?? '';
    if (!/[\w.-]$/.test(before) && !/^[\w.-]/.test(after)) continue; // 前后都没粘连 ⇒ 已由 ② 收走
    const token = `${before}${match[2]}${after}`.split('/').filter((part) => part !== '').pop() ?? match[2];
    loose.push({ token, index: match.index ?? 0 });
  }
  return { citations: found, loose };
}

/**
 * 引用前缀 → **候选证据根**（**只在 `PKG_DIR` 之内解析**）。空前缀＝本装置（`verify/real-machine/evidence/`）。
 *   · 包内相对：`verify/real-machine/…`、`tools/…` ⇒ `<PKG_DIR>/<前缀>/evidence`；
 *   · 工作区相对但**以本包目录名开头**：`<PKG_NAME>/verify/real-machine/…` ⇒ 先把 `<PKG_NAME>/` 剥掉再按上一条解析
 *     （报告里写成 `dsh-gui-frame/…` 的那种；在 v1 副本里该写成 `v1-dsh-gui-frame/…`）。
 *
 * **不再**返回 `workspaceRoot + prefix` 这个候选根。旧写法下，本包副本里若有人把引用写成邻居包名
 * （`dsh-gui-frame/verify/real-machine/…`），第二个候选会顺着**工作区根**解析到隔壁真树 —— 那里证据目录真实存在
 * ⇒ **判绿**，但它根本不是本包的证据（装置去判邻居树）。现在该写法只会在本包内拼成
 * `<PKG_DIR>/dsh-gui-frame/verify/real-machine/evidence`（不存在）⇒ 判 ✗。
 * 另加一条越界守卫：解析结果必须仍在 `PKG_DIR` 之内（`..`/绝对路径之类的写法一律不给候选根）。
 */
function resolveRoots(prefix) {
  const trimmed = (prefix.endsWith('/') ? prefix.slice(0, -1) : prefix).replace(/\\/g, '/');
  if (trimmed === '') return [EVIDENCE_DIR];
  const ownPrefix = `${PKG_NAME}/`;
  const rel = trimmed.startsWith(ownPrefix) ? trimmed.slice(ownPrefix.length) : trimmed;
  const root = path.resolve(PKG_DIR, rel, 'evidence');
  const inside = root === PKG_DIR || root.startsWith(PKG_DIR + path.sep);
  return inside ? [root] : [];
}

/** 该证据根下是否存在这个目录。 */
function dirExists(root, name) {
  try {
    return statSync(path.join(root, name)).isDirectory();
  } catch {
    return false;
  }
}

/** 任一候选根下有就算存在。 */
function existsInAny(roots, name) {
  return roots.some((root) => dirExists(root, name));
}

/** 字符下标 → 行号（报错要能直接跳到那一行）。 */
function lineOf(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text[cursor] === '\n') line += 1;
  }
  return line;
}

function main() {
  const arg = process.argv.find((value) => value.startsWith('--files='));
  const files = arg === undefined
    ? defaultFiles()
    : arg.slice('--files='.length).split(',').map((value) => value.trim()).filter((value) => value !== '');
  const known = evidenceNames();

  if (files.length === 0) {
    console.log('[check-citations] 没有可扫的文件（README.md、docs/验收记录-真机-*.md、docs/开发日志-*.md 都不在）');
    process.exitCode = 1;
    return;
  }

  console.log(`[check-citations] 本装置证据根：${path.relative(PKG_DIR, EVIDENCE_DIR)}（${known.size} 个目录）`);
  console.log(`[check-citations] 扫描文件 ${files.length} 个`);

  const broken = [];
  const looseAll = [];
  let total = 0;
  for (const file of files) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      broken.push({ file, line: 0, name: '(读不出来)', form: String(error?.message ?? error) });
      continue;
    }
    const { citations, loose } = extractCitations(text);
    // 同一个（引用写法 + 名字）算一条；别让「同一目录在文里写两遍」把计数灌水
    const unique = [...new Map(citations.map((row) => [`${row.prefix}::${row.name}`, row])).values()];
    total += unique.length;
    const misses = unique.filter((row) => existsInAny(row.roots, row.name) !== true);
    for (const row of loose) looseAll.push({ file, line: lineOf(text, row.index), token: row.token });
    const looseNote = loose.length === 0 ? '' : `｜非证据面戳记 ${loose.length} 处（已记账，未计入引用）`;
    console.log(`  ${path.relative(PKG_DIR, file)}：引用 ${unique.length} 条｜不存在 ${misses.length} 条${looseNote}`);
    for (const row of misses) {
      broken.push({ file, line: lineOf(text, row.index), name: row.name, form: row.form, roots: row.roots });
    }
  }

  // ★ 记账：被「独立成词」规则排除的戳记逐条打印（**不静默丢弃**；它们不是证据引用，读者可自行复核）。
  if (looseAll.length > 0) {
    console.log('');
    console.log(`[check-citations] 另 ${looseAll.length} 处戳记**嵌在更长的词里**（非证据面，已记账、未计入引用）：`);
    for (const row of looseAll) {
      console.log(`  · ${path.relative(PKG_DIR, row.file)}:${row.line} → ${row.token}`);
    }
  }

  if (broken.length > 0) {
    console.log('');
    console.log(`[check-citations] ✗ 引用了不存在的证据目录 ${broken.length} 条：`);
    for (const row of broken) {
      const where = row.roots === undefined
        ? '（读不出来）'
        : (row.roots.length === 0
          ? '**前缀越界**：本装置只在包根之内解析（不允许 `..`/绝对路径这类写法）'
          : `候选根：${row.roots.map((root) => path.relative(PKG_DIR, root)).join(' | ')}`);
      console.log(`  ✗ ${path.relative(PKG_DIR, row.file)}:${row.line} （${row.form}）→ ${row.name}  ［${where}］`);
    }
    console.log('');
    console.log('  修法：把引用改成真实存在的轮次名，或删掉该论据（**不许**为让它变绿而新建空目录）。');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`[check-citations] ✓ 全部 ${total} 条引用都指向真实存在的证据目录（exit 0）`);
  process.exitCode = 0;
}

main();
