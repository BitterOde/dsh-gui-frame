/**
 * harness.mjs —— 独立复验构建产物时自备的夹具、加载器与判据集合。
 *
 * 为什么要自备一套（独立性纪律）：
 *   1. **不 import `tests/helpers/**`**（那是实现方夹具）；
 *   2. **不 import `scripts/build-client.mjs` 的判据函数**（`loadArtifact` / `packageChecks` /
 *      `isFullSeedName` / `createFakeSeeds` …）——「产物形状」「require 白名单」「单次 load」
 *      「classic script」这些判据在本目录**另写一遍**：被验方自证不算证据；
 *   3. 唯一复用被验方的是**被验对象本身**——单元级越界用例 import `loadModules` / `sortModules` /
 *      `checkBindings`（要指名道姓证明"正是这一层的检查变红"）；另有 `withTempPackage` 起的
 *      **真进程端到端 CLI 复验**（真 exit code、真产物落盘面）作第二证；
 *   4. 冻结的 8 个全名种子在本文件里**再抄一份**（导出的同名常量），与实现方的
 *      `ALLOWED_REQUIRES` 交叉比对：任何一侧悄悄扩容或写成简写都会变红。
 *
 * 纪律：不联网、不需要 DSH 在跑、**不写包内任何文件**——需要落盘的一律写在系统 TEMP 的临时包副本里
 * 并在 finally 里删除；不碰 profile（只读）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `tests/build/` */
export const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 包根 `dsh-gui-frame/` */
export const PKG_DIR = path.resolve(HERE, '..', '..');
export const FIXTURES_DIR = path.join(HERE, 'fixtures');
export const CLIENT_OUT = path.join(PKG_DIR, 'lib', 'client.js');
export const PATCH_FILE = path.join(PKG_DIR, 'cordis.patch.yml');
export const PKG_FILE = path.join(PKG_DIR, 'package.json');

/** loader entry id（恒为 `gui-frame`，= 宿主入口 name）。 */
export const LOADER_ID = 'gui-frame';
/** `src/client` 目录层数上限（「有限深度」= 4）。 */
export const CONTRACT_MAX_DIR_DEPTH = 4;

/** 包清单（只读一次）。 */
export const pkg = JSON.parse(readFileSync(PKG_FILE, 'utf8'));

/**
 * 冻结的 8 个**全名**种子（本文件是它的第三处记录：与 build-client.mjs 的
 * `SEED_DECLARATIONS` 交叉比对）。
 * 只有集合断言是硬要求，顺序断言用于查「实现方是否悄悄改序」。
 */
export const FROZEN_SEED_NAMES = Object.freeze([
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

/** 读产物（每次调用都重读：构建与测试并行时拿到的是最新落盘面）。 */
export function readClientSource() {
  if (!existsSync(CLIENT_OUT)) throw new Error(`缺少产物 ${CLIENT_OUT} —— 先跑 npm run build`);
  return readFileSync(CLIENT_OUT, 'utf8');
}

/** 读包内 patch 文件。 */
export function readPatchText() {
  return readFileSync(PATCH_FILE, 'utf8');
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 一、产物形状判据（自写，不复用实现方 loadArtifact）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 顶层（行首）`window.__ModuleLoader__.load({` 调用点计数。 */
export function countTopLevelLoads(source) {
  return (source.match(/^[ \t]*window\.__ModuleLoader__\.load\(\{/gm) ?? []).length;
}

/** 顶层是否出现 ESM 语法（import/export **语句**，行首）。 */
export function hasTopLevelEsmSyntax(source) {
  return /^[ \t]*(import|export)[ \t]/m.test(source);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 静态列出所有 `require("X")` 的模块名（按出现顺序，含重复）。 */
export function listStaticRequires(source) {
  const out = [];
  const re = /require\((['"])([^'"]+)\1\)/g;
  for (;;) {
    const match = re.exec(source);
    if (match === null) break;
    out.push(match[2]);
  }
  return out;
}

/** 静态统计某个模块名被 `require` 了多少次（精确匹配模块名字符串）。 */
export function countStaticRequireOf(source, moduleName) {
  const re = new RegExp(`require\\((['"])${escapeRegExp(moduleName)}\\1\\)`, 'g');
  return (source.match(re) ?? []).length;
}

/**
 * 在**只有 `window.__ModuleLoader__`** 的假环境里加载产物。
 * `new Function('window', source)` 本身就是 classic script 判据：ESM 语法在这里必然 SyntaxError。
 * @returns {{loads: object[], window: object, fn: Function}}
 */
export function loadInMinimalFakeWindow(source) {
  const loads = [];
  const window = { __ModuleLoader__: { load(entry) { loads.push(entry); } } };
  const fn = new Function('window', source); // eslint-disable-line no-new-func
  fn(window);
  return { loads, window, fn };
}

/**
 * 物化 factory：假 `require` **只发白名单内的种子**，遇到白名单外的模块名直接抛错
 * （等于把「双 React / 双 SlotCore」这条红线做成运行期闸门）。
 * 不抛错地走完全程 ⇒ 产物 require 集合 ⊆ 白名单。
 * @returns {{ok:boolean, required:string[], exports:object|null, error:Error|null, windowKeys:string[]}}
 */
export function attemptMaterialize(entry, allowedNames) {
  const required = [];
  const instances = new Map();
  const fakeRequire = (name) => {
    required.push(name);
    if (!allowedNames.includes(name)) throw new Error(`产物 require 了白名单外的模块：${name}`);
    if (!instances.has(name)) instances.set(name, Object.freeze({ __fakeSeed: name }));
    return instances.get(name);
  };
  try {
    const exports = entry.factory(fakeRequire);
    return { ok: true, required, exports, error: null };
  } catch (error) {
    return { ok: false, required, exports: null, error };
  }
}

/** `node --check <file>`（**只作为旁证**，不接受它单独充当非 ESM 反证）。 */
export function runNodeCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 30_000 });
  return { status: result.status, stderr: (result.stderr ?? '').trim() };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 二、配置面判据：装载通道二选一（自写解析，不复用 build-host 的 parsePatchInserts）
// ═══════════════════════════════════════════════════════════════════════════════════════════

function unquote(value) {
  const text = value.trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * 只解析 patch 里 **顶层 insert 列表** 的行（`- insert:` 之下、缩进更深的 `- id:` 条目），
 * 顶层 `- id: xxx` 那种「对已有 id 的 config/disabled 覆写」不算通道声明。
 * @returns {{id:string, name:string|null}[]}
 */
export function parseInsertRows(text) {
  const rows = [];
  let inInsert = false;
  let current = null;
  let idIndent = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[ \t]+$/, '');
    if (line.trim() === '' || /^[ \t]*#/.test(line)) continue;
    if (/^-/.test(line)) { // 顶层条目
      inInsert = /^-[ \t]*insert:[ \t]*$/.test(line);
      current = null;
      idIndent = -1;
      continue;
    }
    if (!inInsert) continue;
    const indent = line.length - line.trimStart().length;
    const idMatch = new RegExp(`^[ \\t]*-[ \\t]+id:[ \\t]*(.+)$`).exec(line);
    if (idMatch && (idIndent === -1 || indent <= idIndent)) {
      current = { id: unquote(idMatch[1]), name: null };
      idIndent = indent;
      rows.push(current);
      continue;
    }
    const nameMatch = /^[ \t]*name:[ \t]*(.+)$/.exec(line);
    if (nameMatch && current !== null && indent === idIndent + 2) {
      current.name = unquote(nameMatch[1]);
    }
  }
  return rows;
}

/** 读本机 web profile（只读；读不到时返回 readable:false，由用例决定如何处置）。 */
export function readWebProfile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh');
  const dir = path.join(home, 'profiles', 'web');
  const manifestFile = path.join(dir, 'package.json');
  const patchFile = path.join(dir, 'cordis.patch.yml');
  if (!existsSync(manifestFile) || !existsSync(patchFile)) {
    return { readable: false, dir, manifestFile, patchFile, manifest: null, patchText: null };
  }
  return {
    readable: true,
    dir,
    manifestFile,
    patchFile,
    manifest: JSON.parse(readFileSync(manifestFile, 'utf8')),
    patchText: readFileSync(patchFile, 'utf8'),
  };
}

/**
 * 两条装载通道的判定（本包 cordis.patch.yml 自述的 LAYER RULE）：
 *   bundle 通道「就位」= 包清单声明了 `dsh.bundle.patch` 且该文件存在、其 insert 恰好一行（id = loaderId）；
 *   dev  通道「就位」= profile 的 cordis.patch.yml 里出现同 id（或同 name）的 insert 行。
 * 硬要求：**至多一条就位**；两条同时就位 ⇒ 组合里出现两行同 id ⇒ 加载器抛 duplicate entry id。
 */
export function loadingChannels({ bundleDeclared, devRowFound }) {
  return {
    bundle: Boolean(bundleDeclared),
    dev: Boolean(devRowFound),
    activeCount: (bundleDeclared ? 1 : 0) + (devRowFound ? 1 : 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 三、临时树 / 临时包（写在系统 TEMP，finally 删除）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 建一棵临时源码树（`{ 'entry.mjs': '…', 'a/b.mjs': '…' }`）。 */
export async function withTempTree(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'guif-t17-tree-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const full = path.join(dir, ...rel.split('/'));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text, 'utf8');
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 把「包骨架（package.json + scripts/ + tests/helpers/）」复制成一个临时包，
 * 再把 `fixtures/<fixtureName>/` 整体当作 `src/client`，然后交给用例跑真 CLI。
 */
export async function withTempPackage(fixtureName, fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), `guif-t17-pkg-${fixtureName}-`));
  try {
    await cp(PKG_FILE, path.join(tmp, 'package.json'));
    await cp(path.join(PKG_DIR, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    await mkdir(path.join(tmp, 'tests'), { recursive: true });
    await cp(path.join(PKG_DIR, 'tests', 'helpers'), path.join(tmp, 'tests', 'helpers'), { recursive: true });
    await cp(path.join(FIXTURES_DIR, fixtureName), path.join(tmp, 'src', 'client'), { recursive: true });
    await mkdir(path.join(tmp, 'lib'), { recursive: true });
    return await fn(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** 跑真 `node scripts/build-client.mjs`（真进程、真 exit code）。 */
export function runBuilderCli(pkgDir) {
  const cli = path.join(pkgDir, 'scripts', 'build-client.mjs');
  const result = spawnSync(process.execPath, [cli], { cwd: pkgDir, encoding: 'utf8', timeout: 120_000 });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    cli,
  };
}

/** 目录内容指纹（相对路径 + sha256，排序后拼一行一条）——用于证明「失败时一个字节都没动」。 */
export function hashTree(dir) {
  const rows = [];
  const walk = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, childRel);
      else rows.push(`${childRel} ${sha256(readFileSync(full))}`); // 原始字节，避免解码差异影响指纹
    }
  };
  walk(dir, '');
  return rows.join('\n');
}

/** 列出目录下的相对文件路径（诊断用）。 */
export function listTree(dir) {
  const out = [];
  const walk = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), childRel);
      else out.push(childRel);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}
