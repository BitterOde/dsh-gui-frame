// verify/real-machine/check-missing-bindings.mjs —— 机检：新拆模块「引用了同树导出名，却既没 import 也没本地声明」
// 为什么要有它：把巨型文件拆成多模块时，`install-phase.mjs` 漏了 pickFreePort/startServer/profileName 三个绑定
// —— `node --check` 只查语法、不查绑定，`--dry-run` 又走不到那段 ⇒ 缺陷一路绿到真机才炸。
// **防复发工具**：任何把巨型文件拆成多模块的轮次，收尾都该跑它。
// 口径（**只看同树导出名**，避免把外部全局/local 误报成缺失）：
//   1) 被引用名 ∉ 本文件 import 绑定 ∪ 本文件任何位置的声明；
//   2) 该名**至少被同树某个文件 export**（⇒ 它本来能 import 到，只是漏了）。
// 用法（在**包目录** `dsh-gui-frame/` 下跑；脚本自己按模块位置定位包根，不依赖 cwd）：
//   node verify/real-machine/check-missing-bindings.mjs            # 扫真实仓库：两扫面各 0 处 ⇒ exit 0
//   node verify/real-machine/check-missing-bindings.mjs --selftest # 阴性对照：各造一条违规，必须判红
// 搬入仓内时的改动（**只动本文件内部**）：原落点 `.tmp-refactor/assets/`（临时目录，会被清）⇒ 改为按
// `import.meta.url` 推导包根；其余口径、扫面、阴性对照一字未改。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本文件所在目录 ＝ `<包>/verify/real-machine/`。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 包根 ＝ `<…>/dsh-gui-frame/`（与 `verify/lib/harness.mjs` 的 `PKG_DIR` 同义，此处独立推导避免耦合）。 */
const PKG = path.resolve(HERE, '..', '..');

/** 五棵被拆分过的树（路径写死，避免扫到无关目录）。 */
export const TREES = [
  'verify/real-machine/lib',
  'verify/real-machine/lib/judge',
  'tools/render-shot',
  'tools/render-shot.selftest',
  'tools/dsh-shot',
];

const GLOBALS = new Set(['console', 'process', 'globalThis', 'undefined', 'null', 'true', 'false', 'this', 'arguments',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'JSON', 'Math', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError', 'ReferenceError', 'AggregateError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'ArrayBuffer', 'Uint8Array', 'Int32Array', 'Float64Array', 'DataView', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'Buffer', 'Intl', 'AbortController', 'AbortSignal', 'crypto', 'fetch', 'performance', 'navigator', 'document', 'window', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'isNaN', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'Function', 'eval', 'Infinity', 'NaN', 'require', 'module', 'exports', 'global']);

/** 只去注释（字符串/模板原样保留）：整词命中判据不能把注释里的提及算进来。 */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const c2 = text.slice(i, i + 2);
    if (c2 === '//') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (c2 === '/*') { const j = text.indexOf('*/', i + 2); i = j < 0 ? text.length : j + 2; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length) { if (text[j] === '\\') { j += 2; continue; } if (text[j] === c) { j += 1; break; } j += 1; }
      out += text.slice(i, j); i = j; continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** 本文件导入的全部绑定名。 */
function importBindings(code) {
  const out = new Set();
  for (const m of code.matchAll(/(?:^|[^\w$.])import\s*\{([^}]*)\}\s*from/g)) {
    for (const piece of m[1].split(',')) {
      const t = piece.trim().split(/\s+as\s+/);
      const nm = (t.length === 2 ? t[1] : t[0]).trim();
      if (nm) out.add(nm);
    }
  }
  for (const m of code.matchAll(/(?:^|[^\w$.])import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) out.add(m[1]);
  for (const m of code.matchAll(/(?:^|[^\w$.])import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
}

/** 本文件**任何位置**声明过的名字（超集口径：宁多勿漏，只用来避免误报）。 */
function declaredAnywhere(code) {
  const out = new Set();
  for (const m of code.matchAll(/(?:const|let|var|function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) for (const piece of m[1].split(',')) { const nm = piece.trim().split(/\s*[:=]\s*/)[0].trim(); if (nm) out.add(nm); }
  for (const m of code.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) for (const piece of m[1].split(',')) { const nm = piece.trim().split(/\s*=\s*/)[0].trim(); if (nm) out.add(nm); }
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
}

/** 本文件 export 出去的名字。 */
function exportNames(code) {
  const out = new Set();
  // 注意 `export async function` / `export function*` 都要认（漏了会把真导出误判成"不存在"）
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) for (const piece of m[1].split(',')) { const t = piece.trim().split(/\s+as\s+/); const nm = (t.length === 2 ? t[1] : t[0]).trim(); if (nm) out.add(nm); }
  return out;
}

/**
 * 被引用的标识符。
 * - 跳过属性访问的右侧；跳过再导出语句（壳的合法写法）；
 * - **字符串字面量整段跳过**（`'--no-default-browser-check'` 里的 check 不是标识符）；
 * - **模板字面量只取 `${…}` 里的表达式**（`${SETTINGS_INSTALL_PREFIX}` 是真引用，必须留）。
 */
function referenced(code) {
  const withoutReExport = code
    .replace(/export\s*\{[^}]*\}\s*from\s*'[^']*';?/g, ' ')
    .replace(/export\s*\*\s*from\s*'[^']*';?/g, ' ');
  const slim = [];
  for (let i = 0; i < withoutReExport.length; i += 1) {
    const c = withoutReExport[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < withoutReExport.length) { if (withoutReExport[j] === '\\') { j += 2; continue; } if (withoutReExport[j] === c) { j += 1; break; } j += 1; }
      i = j - 1; continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      let expr = '';
      while (j < withoutReExport.length) {
        const d = withoutReExport[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '`' && depth === 0) { j += 1; break; }
        if (d === '$' && withoutReExport[j + 1] === '{') { depth += 1; j += 2; expr += ' '; continue; }
        if (depth > 0 && d === '}') { depth -= 1; j += 1; if (depth === 0) { expr += ' ; '; } continue; }
        if (depth > 0) { expr += d; j += 1; continue; }
        j += 1;
      }
      slim.push(expr); i = j - 1; continue;
    }
    slim.push(c);
  }
  const text = slim.join('');
  const out = new Set();
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (/(?:\.|\?\.)\s*$/.test(before)) continue;
    out.add(m[0]);
  }
  return out;
}

export function collectTree(root) {
  const dir = path.join(PKG, root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort().map((f) => `${root}/${f}`);
}

/** overrides: Map<相对包根路径, 文本>（阴性对照用）。 */
export function scan(overrides = new Map()) {
  const files = TREES.flatMap((t) => collectTree(t));
  const treeOf = (rel) => {
    const hits = TREES.filter((t) => rel.startsWith(`${t}/`));
    return hits.length === 0 ? rel : hits.sort((a, b) => b.length - a.length)[0]; // 取**最长**前缀：judge/ 是 lib/ 的子树，不能折进父树
  };
  const texts = new Map(files.map((rel) => [rel, overrides.has(rel) ? overrides.get(rel) : fs.readFileSync(path.join(PKG, rel), 'utf8')]));
  const exportedBy = new Map(); // `${tree}\u0000${name}` -> [file]（**按树分域**：同名跨树不算同一份词汇）
  for (const [rel, text] of texts) {
    for (const nm of exportNames(text)) {
      const key = `${treeOf(rel)}\u0000${nm}`;
      if (!exportedBy.has(key)) exportedBy.set(key, []);
      exportedBy.get(key).push(rel);
    }
  }

  const findings = [];
  for (const [rel, text] of texts) {
    const code = stripComments(text);
    const have = new Set([...importBindings(code), ...declaredAnywhere(code)]);
    for (const nm of referenced(code)) {
      if (have.has(nm) || GLOBALS.has(nm)) continue;
      const owners = exportedBy.get(`${treeOf(rel)}\u0000${nm}`);
      if (owners === undefined) continue;
      if (owners.every((f) => f === rel)) continue;
      findings.push({ file: rel, name: nm, exportedBy: owners.filter((f) => f !== rel) });
    }
  }
  return { files: files.length, findings };
}

/** 四个入口壳（它们不在上面那 5 棵树里，但被树内模块 import）。 */
export const ENTRY_FILES = [
  'verify/real-machine/run.mjs',
  'verify/real-machine/lib/judge.mjs',
  'tools/render-shot.mjs',
  'tools/render-shot.selftest.mjs',
  'tools/dsh-shot.mjs',
];

/**
 * 第二个扫描面（同一类错法的镜像）：「import 了一个目标模块**并不导出**的名字」；
 * 绑定在文件里"看起来有"，运行期却整模块加载失败（修环时就踩过一次）。
 */
export function scanImports(overrides = new Map()) {
  const all = [...TREES.flatMap((t) => collectTree(t)), ...ENTRY_FILES];
  const texts = new Map(all.map((rel) => [rel, overrides.has(rel) ? overrides.get(rel) : fs.readFileSync(path.join(PKG, rel), 'utf8')]));
  const exportsOf = new Map([...texts].map(([rel, text]) => [rel, exportNames(stripComments(text))]));
  const resolve = (from, spec) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    for (const candidate of [base, `${base}.mjs`, `${base}/index.mjs`]) if (texts.has(candidate)) return candidate;
    return null;
  };
  const findings = [];
  for (const [rel, text] of texts) {
    const code = stripComments(text);
    for (const m of code.matchAll(/(?:^|[^\w$.])import\s*\{([^}]*)\}\s*from\s*'(\.[^']*)'/g)) {
      const target = resolve(rel, m[2]);
      if (target === null) continue; // 树外的相对目标（如 ../render-shot.mjs 指向的入口）另行覆盖
      const have = exportsOf.get(target);
      for (const piece of m[1].split(',')) {
        const t = piece.trim().split(/\s+as\s+/);
        const orig = t[0].trim();
        if (orig === '' || have.has(orig)) continue;
        findings.push({ file: rel, name: orig, importedFrom: target });
      }
    }
  }
  return { files: texts.size, findings };
}

if (process.argv[1] && process.argv[1].endsWith('check-missing-bindings.mjs')) {
  const selftest = process.argv.includes('--selftest');
  if (!selftest) {
    const missing = scan();
    const badImport = scanImports();
    console.log(`[missing-bindings] 扫描 ${missing.files} 个模块（5 棵树）｜发现 ${missing.findings.length} 处「引用了同树导出名却没 import/声明」`);
    for (const row of missing.findings) console.log(`  ✗ ${row.file} 用到 ${row.name}（其定义在 ${row.exportedBy.join(', ')}）——疑漏 import`);
    console.log(`[bad-imports] 扫描 ${badImport.files} 个模块（5 棵树 + 4 个入口壳）｜发现 ${badImport.findings.length} 处「import 了目标模块并不导出的名字」`);
    for (const row of badImport.findings) console.log(`  ✗ ${row.file} 从 ${row.importedFrom} import 的 ${row.name} 不存在`);
    process.exitCode = missing.findings.length + badImport.findings.length === 0 ? 0 : 1;
  } else {
    // 阴性对照 ①：抽掉 install-phase.mjs 那条 dsh.mjs 的 import ⇒ 必须报 pickFreePort / startServer
    const rel = 'verify/real-machine/lib/install-phase.mjs';
    const text = fs.readFileSync(path.join(PKG, rel), 'utf8');
    // ⚠ 这条靶串**必须拼出来、不能写成整字面量**：包内门禁 `scripts/check-boundaries.mjs` 的 import 扫描是
    // 纯正则、不区分字符串字面量 ⇒ 写成「import … 单引号 + 目标文件名 + 单引号」那种整字面量，会被它当成
    // 一条**真实的**未解析相对 import（本文件搬进仓内后实测判红 1 条）。拼出来的字符串与原文**逐字相同**，
    // 阴性对照的语义不变 —— 同一条纪律也约束注释：注释里写整形态一样会被算成 import。
    const DSH_IMPORT_LINE = ['import { pickFreePort, startServer }', " from '", './dsh.mjs', "';", '\n'].join('');
    const broken = text.replace(DSH_IMPORT_LINE, '');
    // 阴性对照 ②：把 constants.mjs 的导出名改掉 ⇒ 所有 import UsageError 的模块必须被判红
    const crel = 'tools/render-shot/constants.mjs';
    const ctext = fs.readFileSync(path.join(PKG, crel), 'utf8');
    const cbroken = ctext.replace('export class UsageError', 'export class UsageErrorRenamedForSelftest');
    const cbroken2 = cbroken.includes('UsageErrorRenamedForSelftest') ? cbroken : null;
    let ok = true;
    if (broken === text) { console.log('[missing-bindings] ✗ 阴性对照①没造出来：找不到那条 import（判据失去靶子）'); ok = false; }
    else {
      const { findings } = scan(new Map([[rel, broken]]));
      const hit = findings.filter((row) => row.file === rel).map((row) => row.name).sort();
      const want = ['pickFreePort', 'startServer'];
      const caught = want.every((nm) => hit.includes(nm));
      console.log(`[missing-bindings] 阴性对照①：抽掉那条 import ⇒ 报 ${JSON.stringify(hit)}（要求至少含 ${JSON.stringify(want)}）⇒ ${caught ? '✓ 判红（有牙）' : '✗ 没抓住'}`);
      ok = ok && caught;
    }
    if (cbroken2 === null) { console.log('[bad-imports] ✗ 阴性对照②没造出来：constants.mjs 里找不到 `export class UsageError`'); ok = false; }
    else {
      const { findings } = scanImports(new Map([[crel, cbroken2]]));
      const hit = [...new Set(findings.map((row) => `${row.file}:${row.name}`))].sort();
      const caught = hit.length >= 3 && findings.some((row) => row.file === 'tools/render-shot.mjs');
      console.log(`[bad-imports] 阴性对照②：把 constants.mjs 的 UsageError 改名 ⇒ 报 ${hit.length} 处，含入口 ${hit.some((h) => h.startsWith('tools/render-shot.mjs'))}：`);
      for (const h of hit) console.log(`  ✗ ${h}`);
      console.log(`[bad-imports] ${caught ? '✓ 判红（有牙）' : '✗ 没抓住'}`);
      ok = ok && caught;
    }
    process.exitCode = ok ? 0 : 1;
  }
}
