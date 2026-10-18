/**
 * check-prose-claims.mjs —— **文档散文里的「可推导事实」机检**（装牙，但只装窄而稳的那一颗）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么是这一颗牙，而不是「数字＋量词」那一种】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 原先的建议是「暂不装牙」（理由：松模式会把「诊断步骤」误报成「7 步」命中 ⇒ 要配白名单 ⇒ 白名单会腐化）。
 * **该建议已被推翻**，因为实测出一条更坏的失败：`项目索引.md` 宣称开发日志含
 * §十二 / §十三（工作台重做轮 / 外观轮），而日志里**当时根本没有这两段** —— 散文**说了没做**。
 * 所以本模块只做**零歧义**的那一类：
 *   ⓐ 文档里用**显式标记**登记「这段散文说的是什么事实」——注释 `<!-- prose:<key>=<value> -->`；
 *   ⓑ 真值来自**可推导真源**（`verify/freeze-rev.json`、各检查自己跑出来的读数），不来自人的记忆；
 *   ⓒ 逐条比对，任一条不符 ⇒ 判红并指到具体文件与行。
 * **不做**：不扫「数字＋量词」（误报来源）、**不白名单**（没有名单可腐化）、**不猜真值**
 * （认不出的键一律判红，逼作者把键加进 `derivations`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【两栏真值：能自动推导的 / 由跑者自报的】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  - **自动推导**（`derivations()`）：`freeze.files` / `artifact.bytes` / `artifact.modules`
 *    —— 直接读 `verify/freeze-rev.json`（那是「交付锚点」的唯一真源）。
 *  - **跑者自报**（`verify/prose-claimed.json`）：本树在用的只有 `tests.total` / `tests.pass`，
 *    由 `node scripts/run-tests.mjs` 的 `--record` 按 stdout 的总结行回填。
 *    自报值**不是手填**，但**是跑出来的** —— 所以 `npm test` 之后跑一次完整读数即可对齐；
 *    改判据条数会让它变红，正是我们要的（散文与真值不许分叉）。
 *    本树没有的装置，对应键留空（缺失键按「本树不适用」处理，不是 0）。
 *
 * 用法：
 *   node verify/real-machine/check-prose-claims.mjs                  # 判定（不符 ⇒ exit 1）
 *   node verify/real-machine/check-prose-claims.mjs --print          # 只打印全部标记与真值
 *   node verify/real-machine/check-prose-claims.mjs --record=tests.total=610,tests.pass=610
 *                                                                    # 把跑出来的读数写进自报栏
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★ 接入文档（`guide/**`）也进受检面 ⇒ 它写的「成员数 / 组件数 / 错误码数」同样要对真值。
//   真源取 `src/client/contracts/**` 的**纯常量表**（零副作用、无 DOM、无种子依赖）。
//   ⚠ 这里只 import **声明**，不从散文里反向解析数字 —— 口径同本文件头：真值必须外生。
import { ALL_CODES } from '../../src/client/contracts/errors.mjs';
import { COMPONENT_NAMES } from '../../src/client/contracts/components.mjs';
import { GUIF_PUBLIC_VARS } from '../../src/client/kit/tokens.mjs';
import { LAYER_FAMILIES } from '../../src/client/contracts/layers.mjs';
import { CONSUMED_SLOT_KEYS, NAMESPACE_MEMBERS, SERVICE_MEMBERS } from '../../src/client/contracts/service-face.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 包根：本包自己的根（v1 副本里＝`v1-dsh-gui-frame/`）。 */
export const PKG_DIR = path.resolve(HERE, '..', '..');
/**
 * 本包**目录名**（`path.basename(PKG_DIR)` —— **派生，不写死**）。
 * ★ 版本线隔离：原先本文件把 `'dsh-gui-frame'` 写死在 CLAIM_DOCS 与取值函数里，
 *   于是**在本包副本里跑，读的却是邻居那棵开发树的文档与基线**（报出来的是邻居的账：tests 638、
 *   产物 908139、成员 10）——本包的散文面等于**没有守卫**。改成派生之后，同一份脚本在两棵树里
 *   各自判各自的账（本包：tests 310 / 产物 509457 / 成员 7）。
 */
export const PKG_NAME = path.basename(PKG_DIR);
/** 工作区根（`项目索引.md` 在那儿）。 */
export const WORKSPACE_DIR = path.resolve(PKG_DIR, '..');

/** 标记所在的文档（相对工作区根）。★ 接入文档 `guide/**` 一并纳入（它随包发布，写错数字会骗外部读者）。
 *  ★ **包内文档一律用派生出来的 `PKG_NAME` 拼**（本包根下的 `README.md` / `guide/**`）；
 *    `项目索引.md` 在**工作区根**（不属于本包），单独按工作区相对路径列出 —— 它的标记按「**观察项**」处理，
 *    理由见 `BASELINE_DERIVED_KEYS` 那一节：它记的是**当前开发线**的读数，包级守卫无权拿本包基线去判它。 */
export const CLAIM_DOCS = Object.freeze([
  `${PKG_NAME}/README.md`,
  `${PKG_NAME}/guide/README.md`,
  `${PKG_NAME}/guide/契约速查.md`,
  '项目索引.md',
]);
/** 工作区级文档（不在本包目录内）：它们的**基线派生标记**只观察、不判红。 */
export const WORKSPACE_DOCS = Object.freeze(['项目索引.md']);
/** 基线派生键：取值随 `freeze-rev.json` 重绑而变，**不是契约真值** ⇒ 重绑前必然与基线同值、重绑后须同步。 */
export const BASELINE_DERIVED_KEYS = Object.freeze(['freeze.files', 'artifact.bytes', 'artifact.modules']);
/** 跑者自报栏（相对包根）。 */
export const CLAIMED_REL = 'verify/prose-claimed.json';

/**
 * 标记语法：`<!-- prose:<key>=<value> -->`（值允许数字或短字符串）。
 * ⚠ **不用正则**：这条标记的扫描曾经用一条 `MARKER_RE` 正则，出现「分开都匹配、合起来不匹配」的怪失败，
 * 追了四轮二分没钉死（键/值两段单独跑都对，整条跑恒 null）——本项目头号纪律是**判据不许有说不清的部件**，
 * 所以改成**手写扫描器**（`collectMarkers`），并在 `tests/verify-surface/prose-claims.test.mjs` 里同时钉
 * 「正控：能匹配」与「负控：不该匹配的不许匹配」。`MARKER_HEAD`/`MARKER_TAIL` 只留给文档与人读。
 */
export const MARKER_HEAD = '<!-- prose:';
/** 标记收尾。 */
export const MARKER_TAIL = '-->';

/** 取一份文件文本（读不到 ⇒ 空串）。 */
function readText(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

/** 读一份 JSON（读不到 / 坏掉 ⇒ 空对象：判红由「认不出的键」兜住，不在这里抛）。 */
function readJson(abs) {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return {};
  }
}

/** 跑者自报栏（读）。 */
export function readClaimed(root = WORKSPACE_DIR) {
  return readJson(path.join(root, PKG_NAME, CLAIMED_REL));
}

/** 跑者自报栏（写；`patch` 为 `{key: value}` 平铺）。 */
export function writeClaimed(root, patch) {
  const abs = path.join(root, PKG_NAME, CLAIMED_REL);
  const current = readClaimed(root);
  const next = { ...current, ...patch, generatedAt: new Date().toISOString() };
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * **真值表**：键 → 当前值；认不出的键返回 `null`（判红用）。
 * 加键的规矩：真值要么来自**可推导真源**，要么来自**跑者自报栏**（`--record` 写入）；
 * **不许**来自真源文档自己写过的数字（那就成了自证）。
 */
export function derivations(root = WORKSPACE_DIR) {
  const freeze = readJson(path.join(root, PKG_NAME, 'verify', 'freeze-rev.json'));
  const claimed = readClaimed(root);
  const client = (freeze.artifact ?? {})['lib/client.js'] ?? {};
  const derived = {
    // ── 自动推导：交付锚点（唯一真源＝freeze-rev.json）────────────────────────────
    'freeze.files': freeze.files !== null && typeof freeze.files === 'object' ? Object.keys(freeze.files).length : null,
    'artifact.bytes': typeof client.bytes === 'number' ? client.bytes : null,
    'artifact.modules': typeof client.modules === 'number' ? client.modules : null,
    // ── 自动推导：**契约面规模** —— 真源＝`src/client/contracts/**` 的常量表 ──────────
    //   文档里写的「9 项成员 / 4 个命名空间 / 6 个组件 / 3 个座位 / 21 个错误码 / 5 个层族」
    //   是**声明规模**，改契约（加一个成员、加一个码）就得同步改文档，否则这里判红。
    'service.members': SERVICE_MEMBERS.length,
    'service.namespaces': Object.keys(NAMESPACE_MEMBERS).length,
    'components.frozen': COMPONENT_NAMES.length,
    'slots.consumed': CONSUMED_SLOT_KEYS.length,
    'errors.codes': ALL_CODES.length,
    'layers.families': LAYER_FAMILIES.length,
    // ★ 外观接口的规模 —— 真源＝样式层的 `GUIF_PUBLIC_VARS`（kit/tokens.mjs）。
    //   文档里写「N 个变量」的地方就靠它守；加/减一个变量就得同步文档，否则这里判红。
    'vars.public': GUIF_PUBLIC_VARS.length,
    // ── 跑者自报：命令自己报自己的读数（`--record` 回填）──────────────────────────
    ...Object.fromEntries(Object.entries(claimed)
      .filter(([key, value]) => key !== 'generatedAt' && (typeof value === 'number' || typeof value === 'string'))
      .map(([key, value]) => [key, value])),
  };
  return derived;
}

/**
 * 从一段文本里取出全部标记（`{key, value, line}`）——**手写扫描器**，不用正则。
 * 认的形态严格是：`<!--` 与 `-->` 之间、以 `prose:` 开头、形状为 `prose:<key>=<value>`；
 * 键 `[a-z0-9.-]+`、值 `[A-Za-z0-9._-]+`（不认的形态一律**不产生标记**，由 `describe()` 的
 * 「一份标记都没探测到」兜住——它不悄悄放过，会喊出来）。
 */
export function collectMarkers(text) {
  const found = [];
  const lines = String(text).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let from = 0;
    for (;;) {
      const head = line.indexOf('<!--', from);
      if (head < 0) break;
      const tail = line.indexOf('-->', head + 4);
      if (tail < 0) break;
      const body = line.slice(head + 4, tail).trim();
      from = tail + 3;
      if (!body.startsWith('prose:')) continue;
      const pair = body.slice('prose:'.length).trim();
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const key = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const keyOk = key.length > 0 && [...key].every((ch) => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '.' || ch === '-');
      const valueOk = value.length > 0 && [...value].every((ch) => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '.' || ch === '_' || ch === '-');
      if (!keyOk || !valueOk) continue;
      found.push({ key, value, line: index + 1, column: head + 1 });
    }
  }
  return found;
}

/**
 * **判定**：文档里登记的每条事实与真值是否一致。
 * @param {Array<{rel:string, text:string}>} docs
 * @param {Record<string, unknown>} derived `derivations()` 的结果
 * @returns {{ok:boolean, checked:number, findings:Array<object>, markers:Array<object>}}
 */
export function scanProseClaims(docs, derived) {
  const findings = [];
  const advisories = [];
  const markers = [];
  let checked = 0;
  for (const doc of docs ?? []) {
    for (const marker of collectMarkers(doc.text)) {
      markers.push({ ...marker, rel: doc.rel });
      const truth = derived?.[marker.key];
      // ★ **工作区级文档**（不在本包目录内，如 `项目索引.md`）的**基线派生标记**只观察、不判红 ——
      //   它记的是**当前开发线**的读数，包级守卫无权拿本包基线去判它（完整理由见 CLAIM_DOCS 的注释）。
      const advisory = WORKSPACE_DOCS.includes(doc.rel) && BASELINE_DERIVED_KEYS.includes(marker.key);
      const sink = advisory ? advisories : findings;
      if (truth === undefined || truth === null) {
        sink.push({ rel: doc.rel, line: marker.line, key: marker.key, problem: 'unknown-key', value: marker.value, truth: null });
        continue;
      }
      checked += 1;
      if (String(truth) !== String(marker.value)) {
        sink.push({ rel: doc.rel, line: marker.line, key: marker.key, problem: 'stale', value: marker.value, truth: String(truth) });
      }
    }
  }
  return { ok: findings.length === 0, checked, findings, advisories, markers };
}

/** 读出两份受检文档（相对工作区根）。 */
export function loadDocs(root = WORKSPACE_DIR) {
  return CLAIM_DOCS.map((rel) => ({ rel, text: readText(path.join(root, rel)) }));
}

/** 面向人/机检的一行式读数。 */
export function describe(scan) {
  if (scan.markers.length === 0) return '⚠ 一份标记都没探测到（判据可能已失效：标记语法或文档路径变了）';
  const base = scan.ok
    ? `散文事实逐条一致：检 ${scan.checked} 条（标记 ${scan.markers.length} 个）`
    : `散文事实不符 ${scan.findings.length} 处：${scan.findings.map((f) => `${f.rel}:${f.line} ${f.key}=${f.value}（真值 ${f.truth ?? '认不出的键'}）`).join('；')}`;
  const advisories = (scan.advisories ?? []).length;
  return advisories > 0
    ? `${base}｜另有观察项 ${advisories} 处（工作区级文档的基线派生标记，不判红）`
    : base;
}

/** 解析 `--record=a=1,b=2` 形式的键值对。 */
export function parseRecord(arg) {
  const body = String(arg).replace(/^--record=/, '');
  const patch = {};
  const bad = [];
  for (const pair of body.split(',').map((s) => s.trim()).filter((s) => s !== '')) {
    const at = pair.indexOf('=');
    if (at <= 0) {
      bad.push(pair);
      continue;
    }
    const key = pair.slice(0, at).trim();
    const raw = pair.slice(at + 1).trim();
    const numeric = Number(raw);
    patch[key] = Number.isFinite(numeric) && raw !== '' ? numeric : raw;
  }
  return { patch, bad };
}

/** CLI。 */
function main(argv) {
  const print = argv.includes('--print');
  const recordArg = argv.find((value) => value.startsWith('--record='));
  if (recordArg !== undefined) {
    const { patch, bad } = parseRecord(recordArg);
    if (bad.length > 0) {
      process.stdout.write(`[prose-claims] ✗ --record 里有认不出的键值对：${bad.join(' ')}\n`);
      return 2;
    }
    writeClaimed(WORKSPACE_DIR, patch);
    process.stdout.write(`[prose-claims] 自报栏已回填：${JSON.stringify(patch)}\n`);
  }
  const derived = derivations(WORKSPACE_DIR);
  const scan = scanProseClaims(loadDocs(WORKSPACE_DIR), derived);
  if (print) {
    for (const marker of scan.markers) {
      const truth = derived[marker.key];
      process.stdout.write(`  ${marker.rel}:${marker.line}  ${marker.key}=${marker.value}  真值=${truth === undefined ? '（认不出的键）' : truth}\n`);
    }
  }
  process.stdout.write(`[prose-claims] ${describe(scan)}\n`);
  if (!scan.ok) {
    process.stdout.write('  ⚠ 改法是改**散文**（或把跑出来的读数用 `--record=` 回填自报栏），不许把不一致写进白名单。\n');
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}

export { existsSync };
