/**
 * link-dsh.mjs —— 为 `link:` 安装的插件自建 / 自清 `@deepseek-ai/*` junction（家族约定）。
 *
 * 背景：Node 从包的**真实路径**解析 import。`link:` 装的插件必须在自身目录向上能找到
 * `@deepseek-ai/*`。本脚本把已安装 DSH 里的目标包以 junction 挂到 `<包>/node_modules/`，
 * 只做链接，不复制、不下载、**不触碰正在服务的宿主进程**。
 *
 * 为什么需要：宿主半区若动态 `import('@deepseek-ai/*')` 取平台符号，真 DSH 里那条路径要从
 * 本包真实路径解析，没有 junction 就解析不到（纯 node 的模块层级测试不受影响）。
 *
 * 用法（安装侧 / 卸载侧各一步）：
 *   node scripts/link-dsh.mjs            # 建 junction（已存在则跳过）
 *   node scripts/link-dsh.mjs --list     # 只报告现状，绝不写盘（干跑）
 *   node scripts/link-dsh.mjs --unlink   # 删本脚本建的 junction（卸载第 2 步；只删 reparse point）
 *   node scripts/link-dsh.mjs --unlink --list   # 只报告会删哪些（干跑）
 *   node scripts/link-dsh.mjs --package <包目录>
 *
 * 硬纪律：删除一律 `lstat` 先判 reparse point，是链接才删（Windows 走 `cmd /c rmdir`，
 * **绝不**递归删穿链接）；不是链接的普通目录一律跳过并如实回报。空目录用非递归 `rmdir`
 * 逐个回收到 `node_modules`，非空立即停手。
 *
 * 纪律提醒：本脚本只写**本包目录内的 node_modules**。把它当安装步骤跑，不等于把包装进 profile
 * ——装载走 `dsh plugin --profile web add "link:<本包路径>"`，且真机装载留到收口时由用户在场执行。
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, rmdirSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PKG_DIR = path.resolve(HERE, '..');

/** 默认 DSH 安装根（npm 全局 node_modules/@deepseek-ai/dsh）。 */
export function defaultDshInstall() {
  const appData = process.env.APPDATA ?? '';
  return path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
}

/**
 * 宿主半区真正动态 import 的平台包（包内最小 import 面）。
 * 当前宿主半区是空壳（零 import），只声明 cordis（插件形状与 ctx 面的来源）。
 * 日后在 src/host/** 里新增 `import('@deepseek-ai/dsh-*')`，**同时**把包名加到这里。
 */
export const DEFAULT_PACKAGES = Object.freeze(['@deepseek-ai/cordis']);

/** 解析某个平台包在 DSH 安装里的真实路径；找不到返回 null。 */
function resolveTarget(installDir, name) {
  for (const candidate of [path.join(installDir, 'node_modules', ...name.split('/')), path.join(installDir, ...name.split('/'))]) {
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/** 是否 reparse point（junction / symlink）——只 `lstat`，绝不跟随链接。 */
export function isReparsePoint(target) {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/** junction 指向哪里（读不到返回 null，不抛）。 */
export function linkTarget(target) {
  try {
    return readlinkSync(target);
  } catch {
    return null;
  }
}

/**
 * 在 `<packageDir>/node_modules` 下建立 junction。
 * @param {{packageDir?:string, installDir?:string, packages?:string[], listOnly?:boolean}} [opts]
 * @returns {Array<{name:string, target:string|null, status:string}>} status: linked | exists | missing | would-link
 */
export function ensureDshLinks(opts = {}) {
  const packageDir = opts.packageDir ?? DEFAULT_PKG_DIR;
  const installDir = opts.installDir ?? defaultDshInstall();
  const packages = opts.packages ?? DEFAULT_PACKAGES;
  const out = [];
  for (const name of packages) {
    const linkPath = path.join(packageDir, 'node_modules', ...name.split('/'));
    if (existsSync(linkPath)) {
      out.push({ name, target: isReparsePoint(linkPath) ? linkTarget(linkPath) : null, status: 'exists' });
      continue;
    }
    const target = resolveTarget(installDir, name);
    if (target === null) {
      out.push({ name, target: null, status: 'missing' });
      continue;
    }
    if (opts.listOnly === true) {
      out.push({ name, target, status: 'would-link' });
      continue;
    }
    mkdirSync(path.dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    out.push({ name, target, status: 'linked' });
  }
  return out;
}

/** 删单个 junction：Windows 走 `cmd /c rmdir`（只解链、不递归），其它平台走非递归 `rmSync`。 */
function removeLink(linkPath) {
  if (process.platform === 'win32') {
    const result = spawnSync('cmd.exe', ['/c', 'rmdir', linkPath], { encoding: 'utf8', windowsHide: true });
    return { ok: result.status === 0, detail: `${(result.stderr ?? '').trim().slice(0, 120)}`.trim() };
  }
  try {
    rmSync(linkPath, { recursive: false, force: true });
    return { ok: true, detail: '' };
  } catch (error) {
    return { ok: false, detail: String(error?.code ?? error?.message ?? error) };
  }
}

/** 自深向浅回收**空**目录（非递归 `rmdir`，非空立即停手）；绝不穿过链接。 */
function pruneEmptyDirs(startDir, stopDir) {
  const pruned = [];
  const stopParent = path.dirname(stopDir);
  let dir = startDir;
  while (dir !== stopParent && (dir === stopDir || dir.startsWith(`${stopDir}${path.sep}`))) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      dir = path.dirname(dir);
      continue;
    }
    if (entries.length > 0) break;
    try {
      rmdirSync(dir);
      pruned.push(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
  return pruned;
}

/**
 * 删除 ensureDshLinks 建的 junction（卸载第 2 步）。
 * @param {{packageDir?:string, packages?:string[], listOnly?:boolean}} [opts]
 * @returns {{rows:Array<{name:string, path:string, target:string|null, status:string}>, pruned:string[]}}
 *   status: removed | would-remove | absent | skipped-not-link | failed
 */
export function removeDshLinks(opts = {}) {
  const packageDir = opts.packageDir ?? DEFAULT_PKG_DIR;
  const packages = opts.packages ?? DEFAULT_PACKAGES;
  const listOnly = opts.listOnly === true;
  const modulesRoot = path.join(packageDir, 'node_modules');
  const rows = [];
  for (const name of packages) {
    const linkPath = path.join(modulesRoot, ...name.split('/'));
    if (!existsSync(linkPath)) {
      rows.push({ name, path: linkPath, target: null, status: 'absent' });
      continue;
    }
    if (!isReparsePoint(linkPath)) {
      rows.push({ name, path: linkPath, target: null, status: 'skipped-not-link' });
      continue;
    }
    const target = linkTarget(linkPath);
    if (listOnly) {
      rows.push({ name, path: linkPath, target, status: 'would-remove' });
      continue;
    }
    const result = removeLink(linkPath);
    rows.push({
      name,
      path: linkPath,
      target,
      status: result.ok && !existsSync(linkPath) ? 'removed' : 'failed',
      ...(result.ok ? {} : { detail: result.detail }),
    });
  }
  const first = packages[0] ?? DEFAULT_PACKAGES[0];
  const pruned = listOnly || rows.some((row) => row.status === 'skipped-not-link')
    ? []
    : pruneEmptyDirs(path.dirname(path.join(modulesRoot, ...first.split('/'))), modulesRoot);
  return { rows, pruned };
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const valueOf = (flag) => {
    const idx = process.argv.indexOf(flag);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
  };
  const packageDir = valueOf('--package') ? path.resolve(valueOf('--package')) : DEFAULT_PKG_DIR;
  const listOnly = process.argv.includes('--list');
  const unlink = process.argv.includes('--unlink');
  console.log(`[link-dsh] mode=${unlink ? 'unlink' : 'link'}${listOnly ? ' (dry-run)' : ''}｜packageDir=${packageDir}`);
  if (unlink) {
    const { rows, pruned } = removeDshLinks({ packageDir, listOnly });
    for (const row of rows) {
      console.log(`[link-dsh] ${row.status.padEnd(16)} ${row.name}${row.target ? ` -> ${row.target}` : ''}${row.detail ? ` (${row.detail})` : ''}`);
    }
    for (const dir of pruned) console.log(`[link-dsh] pruned-empty     ${dir}`);
    if (rows.some((row) => row.status === 'failed' || row.status === 'skipped-not-link')) process.exitCode = 1;
  } else {
    console.log(`[link-dsh] dshInstall=${defaultDshInstall()}`);
    const rows = ensureDshLinks({ packageDir, listOnly });
    for (const row of rows) console.log(`[link-dsh] ${row.status.padEnd(10)} ${row.name}${row.target ? ` -> ${row.target}` : ''}`);
    if (rows.some((row) => row.status === 'missing')) process.exitCode = 1;
  }
}
