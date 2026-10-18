/**
 * build-host.mjs —— 宿主半区构建：`src/host/**.mjs` → `lib/host/**.js` + 包入口 `lib/index.js`。
 *
 * 口径（家族同形，实例对照同族插件的构建脚本；
 * 本包真源见 `package.json` 与 `cordis.patch.yml`）：
 * - `lib/` 是**产物布局**，不是源码区：`package.json` 的 `files` 只发 `lib` + `cordis.patch.yml`
 *   + `README.md`，所以交付包里没有 `src/`，产物必须自洽。
 * - 相对 import/export 说明符的 `.mjs` 后缀改写为 `.js`，**其余字节一字节不动**。
 * - `lib/index.js` = 包入口转发壳（`package.json` 的 `main` / `exports["."]` 指向它）。
 * - **只清本脚本拥有的产物**：`lib/host/`、`lib/index.js`。`lib/client.js` 属
 *   `scripts/build-client.mjs`，本脚本绝不碰它。
 *
 * 骨架占位：`src/host/index.mjs` 尚未落地时，本脚本产出**骨架占位入口**
 * ——仍满足「文件存在 + 纯 node 可 import() + 插件形状合法（name/inject/apply）」。
 * 当前已落下最小空壳（`apply` 空转、无任何注册），故走转发壳分支。
 *
 * 构建期自检（任一不过 ⇒ exit 1）：
 * 1. `node --check` 逐个产物；
 * 2. **同源自检**：`lib/host/**` 与 `src/host/**` 一一对应（漏 emit 一条即红，多出也红）；
 * 3. **入口可导入**：在纯 node 子进程里 `import()` `lib/index.js` 成功；
 * 4. **依赖边界**（家族约定）：静态 import 只能是相对路径或 `node:` 内建；`@deepseek-ai/*`
 *    只能出现在 `import()` 里（宿主半区只**动态** import 平台自带包；`dependencies` 恒为空）；
 * 5. **注册通道唯一**：`cordis.patch.yml` 恰好一条 insert 行，且 `name` == 包名、`id` == 入口 name。
 *
 * 用法：node scripts/build-host.mjs
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeFileAtomic } from './lib/atomic-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 包根：`dsh-gui-frame/`。 */
export const PKG_DIR = path.resolve(HERE, '..');
export const PKG_FILE = path.join(PKG_DIR, 'package.json');
export const PATCH_FILE = path.join(PKG_DIR, 'cordis.patch.yml');
export const SRC_DIR = path.join(PKG_DIR, 'src');
export const SRC_HOST_DIR = path.join(SRC_DIR, 'host');
export const LIB_DIR = path.join(PKG_DIR, 'lib');
export const LIB_HOST_DIR = path.join(LIB_DIR, 'host');
/** 宿主半区入口源码。 */
export const ENTRY_SRC = path.join(SRC_HOST_DIR, 'index.mjs');
/** 包入口产物；package.json 的 main / exports["."]。 */
export const ENTRY_OUT = path.join(LIB_DIR, 'index.js');
/** loader entry id（冻结名）：cordis.patch.yml 的 insert id === 入口 name。 */
export const LOADER_ID = 'gui-frame';

/** 构建失败（CLI 捕获后 exit 1）。 */
export class BuildError extends Error {}

function fail(message) {
  throw new BuildError(message);
}

/** 只改写**相对**说明符的 `.mjs` 后缀（`from './x.mjs'` / `import './x.mjs'` / `import('./x.mjs')`）。 */
export function rewriteSpecifiers(text) {
  return String(text).replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?)\.mjs\2/g,
    (_match, head, quote, spec) => `${head}${quote}${spec}.js${quote}`,
  );
}

/** 递归列文件；目录不存在时返回 `[]`（src/host 缺席属正常）。 */
export async function listFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

/**
 * 递归复制一个源码区到产物区（`.mjs` → `.js` + 相对说明符改写）。返回产物相对路径列表。
 *
 * ★ **原子写**：`writeFile(outPath, …)` 的原地重写（先截断后写）会让窗口期内加载 `lib/host/**.js`
 *   读到半截文件。改为同目录 `.tmp-<pid>` + rename。
 * @param {{steps?:Array<object>}} [options] `steps` 收原子写记账（CLI/自检用）
 */
export async function emitTree(fromDir, toDir, options = {}) {
  const written = [];
  const steps = Array.isArray(options.steps) ? options.steps : null;
  for (const file of await listFiles(fromDir)) {
    const rel = path.relative(fromDir, file).split(path.sep).join('/');
    const outRel = rel.endsWith('.mjs') ? `${rel.slice(0, -4)}.js` : rel;
    const outPath = path.join(toDir, ...outRel.split('/'));
    const text = await readFile(file, 'utf8');
    await writeFileAtomic(outPath, rel.endsWith('.mjs') ? rewriteSpecifiers(text) : text, {
      onStep: (step) => steps?.push({ ...step, file: path.relative(PKG_DIR, outPath).split(path.sep).join('/') }),
    });
    written.push(path.relative(PKG_DIR, outPath).split(path.sep).join('/'));
  }
  return written;
}

/**
 * 清掉产物区里**本轮不再产出**的陈旧文件（emit 之后调用）。
 *
 * 为什么不是「先 rm 掉整个 `lib/host/` 再重建」（原先的 `clean` 行为）：那会造出一个
 * 「产物区整个不在」的窗口 —— 窗口期内加载 `lib/index.js` 会 import 到不存在的 `./host/*.js`，
 * 和半截产物是同一类假故障。改成「先原子替换、再删陈旧」，窗口期只剩「陈旧文件多待几毫秒」，
 * 而陈旧文件**不会**被任何有效产物引用（同源闸门仍按 src 逐条比对，漏 emit 一条照样红）。
 * @returns {Promise<string[]>} 被删掉的陈旧产物相对路径
 */
export async function pruneStale(toDir, expected) {
  const PREFIX = 'lib/host/';
  const keep = new Set(
    expected.filter((rel) => rel.startsWith(PREFIX)).map((rel) => rel.slice(PREFIX.length)),
  );
  const removed = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (keep.has(rel)) continue;
      await rm(path.join(dir, entry.name), { force: true });
      removed.push(`${PREFIX}${rel}`);
    }
    // 空目录也清掉（源区里已没有对应目录时，产物区不该留空壳）
    const remaining = await readdir(dir).catch(() => []);
    if (remaining.length === 0 && prefix !== '') await rm(dir, { recursive: true, force: true });
  };
  if (existsSync(toDir)) await walk(toDir, '');
  return removed;
}

/**
 * `cordis.patch.yml` 里的 insert 行（**本包唯一注册通道**：恰好一行）。
 * 只解析本包自带的这份小文件所需的 YAML 子集（顶层 `- insert:` + 一层 `- id:` / `name:`），
 * 不引 YAML 依赖（`dependencies` 恒为空）。
 * @returns {Array<{id:string|null, name:string|null, indent:number}>}
 */
export function parsePatchInserts(text) {
  const rows = [];
  let insertIndent = null;
  for (const line of String(text).split(/\r?\n/)) {
    const insertMatch = /^(\s*)-\s*insert:\s*$/.exec(line);
    if (insertMatch !== null) {
      insertIndent = insertMatch[1].length;
      continue;
    }
    if (insertIndent === null || line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= insertIndent) {
      insertIndent = null;
      continue;
    }
    const idMatch = /^-\s*id:\s*(\S+)\s*$/.exec(line.trim());
    if (idMatch !== null) {
      rows.push({ id: idMatch[1], name: null, indent });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last === undefined || last.name !== null) continue;
    const nameMatch = /^name:\s*(.+?)\s*$/.exec(line.trim());
    // 行首键与同一行项的 `- ` 之间恰好隔 2 格；更深的缩进属于该行的 config 子树。
    if (nameMatch !== null && indent === last.indent + 2) {
      last.name = nameMatch[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return rows;
}

/** 读并校验 `cordis.patch.yml` 的唯一 insert 行。 */
export async function readPatchEntry(patchPath = PATCH_FILE) {
  const rows = parsePatchInserts(await readFile(patchPath, 'utf8'));
  if (rows.length !== 1) {
    fail(`cordis.patch.yml 必须恰好声明 1 条 insert 行（当前 ${rows.length} 条）——注册通道只有一个`);
  }
  const row = rows[0];
  if (row.id === null || row.id === '') fail('cordis.patch.yml 的 insert 行缺少 id');
  if (row.name === null || row.name === '') fail('cordis.patch.yml 的 insert 行缺少 name（应等于包名）');
  return row;
}

/**
 * 包入口源码（构建期生成，确定性：同输入 ⇒ 同字节）。
 * @param {{hasHost:boolean, loaderId?:string, pkgName?:string}} options
 *   `hasHost` = `src/host/index.mjs` 是否已落地；`loaderId` = `cordis.patch.yml` 的 insert id。
 */
export function entrySource({ hasHost, loaderId = LOADER_ID, pkgName = 'dsh-gui-frame' }) {
  const id = JSON.stringify(loaderId);
  if (hasHost === true) {
    return [
      '/**',
      ` * ${pkgName} 包入口（**构建产物**，由 scripts/build-host.mjs 生成，请勿手改）。`,
      ' *',
      ' * 真正的宿主半区在 ./host/index.js（= src/host/** 的构建产物）；这里只做转发，',
      ' * 使 package.json 的 main / exports["."] 与源码布局解耦。',
      ' *',
      ` * 形状契约：name === cordis.patch.yml 的 loader entry id（${id}）；`,
      ' * inject 为空数组（服务缺席不得悬置插件）；apply 同步且返回 undefined。',
      ' */',
      "export { name, inject, apply } from './host/index.js';",
      "export { default } from './host/index.js';",
      '',
    ].join('\n');
  }
  return [
    '/**',
    ` * ${pkgName} 包入口（**构建产物**，由 scripts/build-host.mjs 生成，请勿手改）。`,
    ' *',
    ' * 骨架占位形态：src/host/index.mjs 尚未落地，所以这里不是转发壳。',
    ' * 它保证三件事：',
    ' *   ① 文件始终存在（package.json 的 main / exports["."] 有落点）；',
    ' *   ② 纯 node 下 import() 成功（构建脚本的同一条自检）；',
    ' *   ③ 插件形状合法（name / inject / apply），apply 同步、返回 undefined、不抛也不打死宿主。',
    ' *',
    ' * 落下 src/host/** 之后重跑 node scripts/build-host.mjs，本文件自动变成转发壳。',
    ' */',
    `export const name = ${id};`,
    'export const inject = [];',
    'export function apply(ctx) {',
    '  const logger = ctx === null || ctx === undefined ? null : ctx.logger;',
    "  if (logger !== null && typeof logger.warn === 'function') {",
    "    logger.warn('[gui-frame] 宿主半区尚未构建：src/host/index.mjs 落地后重跑 node scripts/build-host.mjs');",
    '  }',
    '  return undefined;',
    '}',
    'export default { name, inject, apply };',
    '',
  ].join('\n');
}

/** 语法自检（`node --check`）。 */
export function syntaxCheck(files, pkgDir = PKG_DIR) {
  const bad = [];
  for (const rel of files) {
    if (!rel.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(pkgDir, ...rel.split('/'))], { encoding: 'utf8' });
    if (result.status !== 0) {
      bad.push({ file: rel, message: (result.stderr ?? '').trim().split('\n').slice(0, 3).join(' ') });
    }
  }
  return bad;
}

/** `lib/index.js` 在纯 node 下能否 import() 成功。 */
export function importCheck(file) {
  const code = `await import(${JSON.stringify(pathToFileURL(file).href)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: PKG_DIR });
  return { ok: result.status === 0, message: (result.stderr ?? '').trim().split('\n').slice(0, 4).join(' ') };
}

/** 同源自检：`lib/host/**` 与 `src/host/**` 必须一一对应，且都在本次写出的清单里。 */
export async function sourceParity(produced) {
  const problems = [];
  const owned = new Set(produced);
  const sourceFiles = await listFiles(SRC_HOST_DIR);
  const expected = sourceFiles.map((file) => {
    const rel = path.relative(SRC_HOST_DIR, file).split(path.sep).join('/');
    return `lib/host/${rel.replace(/\.mjs$/, '.js')}`;
  });
  const outputFiles = (await listFiles(LIB_HOST_DIR)).map((file) => path.relative(PKG_DIR, file).split(path.sep).join('/'));
  const missing = expected.filter((rel) => !outputFiles.includes(rel));
  const extra = outputFiles.filter((rel) => !expected.includes(rel));
  if (missing.length > 0) problems.push(`lib/host 缺 ${missing.length} 个产物：${missing.join('、')}`);
  if (extra.length > 0) problems.push(`lib/host 多出 ${extra.length} 个产物：${extra.join('、')}`);
  for (const rel of expected) if (!owned.has(rel)) problems.push(`${rel} 未登记进本次产物清单`);
  return problems;
}

/** 去掉块注释与行注释（依赖边界只看代码，不看注释里的词）。 */
export function stripComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * 依赖边界（家族约定）：静态 import 只允许相对路径 / `node:`；平台包只能走动态 `import()`。
 */
export async function checkSpecifierPurity(files) {
  const problems = [];
  const STATIC_NAMED = /^[ \t]*import\s+[\s\S]*?from\s*['"]([^'"]+)['"]/gm;
  const STATIC_SIDE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
  const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const isRelative = (spec) => spec.startsWith('.') || spec.startsWith('/');
  for (const rel of files) {
    if (!rel.endsWith('.js')) continue;
    const text = stripComments(await readFile(path.join(PKG_DIR, ...rel.split('/')), 'utf8'));
    const statics = [...text.matchAll(STATIC_NAMED), ...text.matchAll(STATIC_SIDE)].map((match) => match[1]);
    for (const spec of statics) {
      if (!isRelative(spec) && !spec.startsWith('node:')) {
        problems.push(`${rel}：静态 import 了裸模块「${spec}」——宿主半区只允许相对路径与 node: 内建`);
      }
    }
    for (const match of text.matchAll(DYNAMIC)) {
      const spec = match[1];
      if (!isRelative(spec) && !spec.startsWith('node:') && !spec.startsWith('@deepseek-ai/')) {
        problems.push(`${rel}：动态 import 了平台之外的模块「${spec}」（只允许 @deepseek-ai/* 与 node:）`);
      }
    }
  }
  return problems;
}

/**
 * 构建。
 * @returns {Promise<{files:string[], hasHost:boolean, entry:object, pkg:object,
 *   syntaxErrors:object[], parityProblems:string[], purityProblems:string[], importResult:object}>}
 */
export async function build({ clean = true } = {}) {
  const pkg = JSON.parse(await readFile(PKG_FILE, 'utf8'));
  const entry = await readPatchEntry();
  if (entry.name !== pkg.name) {
    fail(`cordis.patch.yml 的 insert name「${entry.name}」与 package.json 的 name「${pkg.name}」不一致`);
  }
  // ★ 顺序即防线：**先原子替换、再清陈旧**。
  //   原先是 `rm(lib/host, recursive)` + `rm(lib/index.js)` 开头 —— 那会造出「产物区整个不在」的窗口：
  //   窗口期内加载 `lib/index.js` 会 import 到不存在的 `./host/*.js`，与「半截产物」是同一类假故障。
  const writeSteps = [];
  const hasHost = existsSync(ENTRY_SRC);
  const emitted = await emitTree(SRC_HOST_DIR, LIB_HOST_DIR, { steps: writeSteps });
  const staleRemoved = clean ? await pruneStale(LIB_HOST_DIR, emitted) : [];
  await mkdir(LIB_DIR, { recursive: true });
  await writeFileAtomic(ENTRY_OUT, entrySource({ hasHost, loaderId: entry.id, pkgName: pkg.name }), {
    onStep: (step) => writeSteps.push({ ...step, file: 'lib/index.js' }),
  });
  const files = [...emitted, 'lib/index.js'];
  return {
    pkg,
    entry,
    hasHost,
    files,
    writeSteps,
    staleRemoved,
    syntaxErrors: syntaxCheck(files),
    parityProblems: await sourceParity(files),
    purityProblems: await checkSpecifierPurity(files),
    importResult: importCheck(ENTRY_OUT),
  };
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await build();
    for (const file of result.files) console.log(`[build-host] ${file}`);
    console.log(`[build-host] 原子写：${result.writeSteps.filter((step) => step.step === 'rename').length} 个产物走 .tmp-<pid> → rename（先替换后清陈旧）${result.staleRemoved.length === 0 ? '；无陈旧残留' : `；清掉陈旧 ${result.staleRemoved.join('、')}`}`);
    for (const row of result.syntaxErrors) console.error(`[build-host] ✗ 语法检查失败：${row.file} —— ${row.message}`);
    for (const row of result.parityProblems) console.error(`[build-host] ✗ 同源自检失败：${row}`);
    for (const row of result.purityProblems) console.error(`[build-host] ✗ 依赖边界失败：${row}`);
    if (!result.importResult.ok) console.error(`[build-host] ✗ 入口 import() 失败：${result.importResult.message}`);
    const failed = result.syntaxErrors.length > 0
      || result.parityProblems.length > 0
      || result.purityProblems.length > 0
      || !result.importResult.ok;
    console.log(`[build-host] 入口形态：${result.hasHost ? '转发壳（src/host/index.mjs 已落地）' : '骨架占位（src/host/index.mjs 尚未落地）'}｜loader id=${result.entry.id}｜包名=${result.pkg.name}`);
    if (failed) {
      console.error('[build-host] 构建失败：校验未全部通过');
      process.exitCode = 1;
    } else {
      console.log(`[build-host] 完成：${result.files.length} 个产物文件；node --check 通过；lib/host 与 src/host 同源；lib/index.js 纯 node 可 import()`);
    }
  } catch (error) {
    console.error(`[build-host] 构建失败：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
