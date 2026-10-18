/**
 * harness.mjs —— 独立复验（服务面冻结 / migrate / 探针记录 / 红线）自备的判据与工具。
 *
 * 【命名空间】
 *   本目录 `tests/verify-surface/**` 是**验证方专属**命名空间；被测对象 `tests/contracts/public-surface.json`
 *   归实现方 —— 本套件**只读**它，任何写盘只允许落在 `os.tmpdir()` 的临时副本里
 *   （由写调用静态扫描 + 变异层前后的 sha256 比对两条机械证明）。
 *
 * 【独立性】
 *   - 不 import `tests/helpers/**`（实现方夹具），也不 import `tests/build/harness.mjs`；
 *   - 不调用实现方的 `describePublicSurface()` / `serializePublicSurface()` / `diffSurface()` 来「自证」——
 *     快照由本套件**自己重新推导**：服务成员走**原型链反射 + 实例自有键**，错误码走**源码文本块扫描**，
 *     组件名 / slot 键 / inject 走声明模块，服务名走**运行期取证**（`provideService` 到底 provide 了哪个名字）；
 *   - 探针记录的复核走**重跑**：在 TEMP 副本里跑真 `probe/runtime/*.mjs`，拿新产出的 JSON 与文档里的
 *     摘录逐条对齐。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `tests/verify-surface/` */
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.resolve(HERE, '..', '..');
export const SNAPSHOT_REL = 'tests/contracts/public-surface.json';
export const SNAPSHOT_PATH = path.join(PKG_DIR, ...SNAPSHOT_REL.split('/'));
export const PROBE_DOC = path.join(PKG_DIR, 'docs', '探针记录-运行稳定性.md');
/** 第二份同规格探针记录（P4 主题 token 口径 / P5 推送半边）。 */
export const PROBE_DOC_THEME = path.join(PKG_DIR, 'docs', '探针记录-主题与推送.md');
export const PROBE_DIR = path.join(PKG_DIR, 'probe');
export const REPORT_PATH = path.join(HERE, '服务面与红线验证报告.md');

/** 包清单（只读）。 */
export const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));

/** 快照字段全集**及其顺序**（本套件自己抄的第二份；顺序也是契约 —— 序列化后逐字节稳定）。 */
export const SURFACE_KEYS = Object.freeze([
  'service',
  'version',
  'capabilities',
  'serviceMembers',
  'components',
  'slots',
  'inject',
  'errorCodes',
]);

/** `src/` 下的路径。 */
export function srcPath(...parts) {
  return path.join(PKG_DIR, 'src', ...parts);
}

export function sha256(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function listFilesRecursive(dir) {
  const out = [];
  const walk = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), child);
      else out.push({ rel: child, full: path.join(current, entry.name) });
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 一、自备的「最小 Cordis ctx」—— 不借实现方的 tests/helpers/fake-ctx.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * 造一个最小 Cordis ctx：`get` / `provide`（返回注销器）/ `effect(install, label)`（立即执行 install、
 * 返回幂等 disposer）/ `logger`（可当函数调、也可带方法调）+ 记录面。
 * `ctx.unload()` 模拟 fiber 卸载：逆序跑掉所有仍存活的 effect 清理器。
 */
export function createCtx({ services = {}, label = 'ctx' } = {}) {
  const provided = new Map();
  const effects = [];
  const logs = [];
  const calls = { get: 0, provide: 0, effect: 0 };
  const logger = Object.assign(() => logger, {
    error: (message) => logs.push({ level: 'error', message: String(message) }),
    info: (message) => logs.push({ level: 'info', message: String(message) }),
    warn: (message) => logs.push({ level: 'warn', message: String(message) }),
    debug: (message) => logs.push({ level: 'debug', message: String(message) }),
  });
  const ctx = {
    label,
    services,
    provided,
    effects,
    logs,
    calls,
    logger,
    get(name) {
      calls.get += 1;
      return provided.has(name) ? provided.get(name) : services[name];
    },
    provide(name, value) {
      calls.provide += 1;
      provided.set(name, value);
      return () => {
        if (provided.get(name) === value) provided.delete(name);
      };
    },
    effect(install, effectLabel) {
      calls.effect += 1;
      const cleanup = install();
      const record = { label: effectLabel, cleanup, active: true };
      effects.push(record);
      return () => {
        if (!record.active) return;
        record.active = false;
        if (typeof cleanup === 'function') cleanup();
      };
    },
    activeEffects() {
      return effects.filter((record) => record.active);
    },
    unload() {
      for (const record of [...effects].reverse()) {
        if (!record.active) continue;
        record.active = false;
        if (typeof record.cleanup === 'function') record.cleanup();
      }
    },
  };
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 二、快照与错误码（自带推导路径，不复用实现方的序列化器）
// ═══════════════════════════════════════════════════════════════════════════════════════════

export function readSnapshotText() {
  return readFileSync(SNAPSHOT_PATH, 'utf8');
}

export function readSnapshotJson() {
  return JSON.parse(readSnapshotText());
}

/** 与快照档同形的序列化（2 空格缩进 + 结尾换行；LF）。 */
export function serializeSurface(surface) {
  return `${JSON.stringify(surface, null, 2)}\n`;
}

/**
 * 从 `errors.mjs` 的**两个冻结数组块**里扫错误码（不读 `ALL_CODES` 导出，
 * 也刻意不扫 `formatDiagnostic` 里的显示兜底码 `GUIF-W-UNKNOWN`——它不在契约集合里）。
 * 找不到块边界 ⇒ 返回 `null`（用例据此显式失败，而不是静默返回空集）。
 */
export function collectCodesFromText(text) {
  const start = text.indexOf('export const ERROR_CODES');
  const mid = text.indexOf('export const WARNING_CODES');
  const end = text.indexOf('export const ALL_CODES');
  if (start < 0 || mid < 0 || end < 0 || !(start < mid && mid < end)) return null;
  const blocks = `${text.slice(start, mid)}\n${text.slice(mid, end)}`;
  return [...new Set([...blocks.matchAll(/GUIF-[EW]-[A-Z0-9-]+/g)].map((match) => match[0]))].sort();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 三、配置面：patch 里的 insert 行 + 本机 web profile（只读）
// ═══════════════════════════════════════════════════════════════════════════════════════════

function unquote(value) {
  const text = value.trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) return text.slice(1, -1);
  return text;
}

/** 只解析**顶层 insert 列表**里的 `- id:` 条目（顶层 `- id: xxx` 的覆写行不算通道声明）。 */
export function parseInsertRows(text) {
  const rows = [];
  let inInsert = false;
  let current = null;
  let idIndent = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[ \t]+$/, '');
    if (line.trim() === '' || /^[ \t]*#/.test(line)) continue;
    if (/^-/.test(line)) {
      inInsert = /^-[ \t]*insert:[ \t]*$/.test(line);
      current = null;
      idIndent = -1;
      continue;
    }
    if (!inInsert) continue;
    const indent = line.length - line.trimStart().length;
    const idMatch = /^[ \t]*-[ \t]+id:[ \t]*(.+)$/.exec(line);
    if (idMatch !== null && (idIndent === -1 || indent <= idIndent)) {
      current = { id: unquote(idMatch[1]), name: null };
      idIndent = indent;
      rows.push(current);
      continue;
    }
    const nameMatch = /^[ \t]*name:[ \t]*(.+)$/.exec(line);
    if (nameMatch !== null && current !== null && indent === idIndent + 2) current.name = unquote(nameMatch[1]);
  }
  return rows;
}

export function readWebProfile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh');
  const dir = path.join(home, 'profiles', 'web');
  const manifestFile = path.join(dir, 'package.json');
  const patchFile = path.join(dir, 'cordis.patch.yml');
  if (!existsSync(manifestFile) || !existsSync(patchFile)) {
    return { readable: false, dir, manifest: null, patchText: null };
  }
  return {
    readable: true,
    dir,
    manifest: JSON.parse(readFileSync(manifestFile, 'utf8')),
    patchText: readFileSync(patchFile, 'utf8'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 四、Markdown 段落切分（探针记录复核用）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 按 `## ` 切成 [{title, body}]（不含 `###`）。 */
export function splitH2(markdown) {
  const sections = [];
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match !== null) {
      current = { title: match[1].trim(), body: '' };
      sections.push(current);
      continue;
    }
    if (current !== null) current.body += `${line}\n`;
  }
  return sections;
}

/** 取某个 `### <prefix>` 小节的正文（到下一个 `###` / 文末为止）。 */
export function h3Section(body, prefix) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^###\\s*${prefix}`).test(line));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^###\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 五、写调用静态扫描（证明「本套件只往 TEMP 写」）
// ═══════════════════════════════════════════════════════════════════════════════════════════

const WRITE_APIS = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir', 'rmSync', 'rm', 'unlinkSync', 'unlink', 'renameSync', 'rename', 'truncateSync', 'truncate', 'copyFileSync', 'copyFile', 'cp', 'createWriteStream'];

/** 扫出源码里所有写 API 调用（含括号配平后的实参文本与行号）。 */
export function scanWriteCalls(source) {
  const found = [];
  for (const api of WRITE_APIS) {
    const pattern = new RegExp(`(?<![A-Za-z0-9_$.])${api}\\s*\\(`, 'g');
    for (;;) {
      const match = pattern.exec(source);
      if (match === null) break;
      let depth = 0;
      let end = match.index + match[0].length - 1;
      for (let i = end; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      const args = source.slice(match.index + match[0].length, end);
      const line = source.slice(0, match.index).split('\n').length;
      found.push({ api, args, line });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * 「这个写调用的目标是 TEMP 副本」的判据标识符集合：`tmp` 本身，
 * 以及本文件里用 `const X = path.join(tmp, …)` 从它派生出来的局部名。
 */
export function tempDerivedNames(source) {
  const names = new Set(['tmp']);
  for (const match of source.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*path\.join\(\s*tmp\b/g)) names.add(match[1]);
  return names;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 六、TEMP 副本执行器（本套件**唯一**允许写盘的地方）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * 把包骨架复制进 TEMP，可选地做一次定向变异，然后跑指定测试文件（`--test-reporter=tap`）。
 * ★ 必须清掉 `NODE_TEST_CONTEXT`：否则子进程把自己当成「测试文件里的子测试」，会打印
 *   「node:test run() is being called recursively within a test file. skipping running files.」
 *   然后**空跑 exit 0**，所有「必须变红」的断言都会变成假绿。
 */
export async function runSuiteInCopy({ mutate = async () => {}, testFiles, include = ['src', 'tests'] }) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'guif-t18-copy-'));
  try {
    await cp(path.join(PKG_DIR, 'package.json'), path.join(tmp, 'package.json'));
    for (const dir of include) {
      await cp(path.join(PKG_DIR, dir), path.join(tmp, dir), { recursive: true });
    }
    /**
     * ★ **变异函数失败不得把整个用例连坐**。
     * 原实现让 `mutate` 的异常直接冒到调用方：第一条「打空」的变异就会终止整个 for 循环，
     * 后面的变异**根本没跑**，而报告里只会看到一句断言错 —— 既盖住真实读数，也在 `finally` 之外
     * 留下 TEMP 副本（`rm` 跑不到 ⇒ 逐轮累积，直到把整机内存吃光）。
     * 现在把它变成一次**可报告的失败**：`status=null` + `setupError`。
     */
    try {
      await mutate(tmp);
    } catch (error) {
      return { status: null, out: '', failing: [], setupError: String(error?.message ?? error) };
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_TEST_REPORTER;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], {
      cwd: tmp,
      encoding: 'utf8',
      env,
      timeout: 180_000,
    });
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const failing = out
      .split(/\r?\n/)
      .map((line) => /^not ok \d+ - (.*)$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => match[1].trim());
    return { status: result.status, out, failing, setupError: null };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** 把 `probe/` 复制进 TEMP 跑真探针（探针会往自己旁边的 evidence/ 写 JSON —— 只落在副本里）。 */
export async function withProbeCopy(fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'guif-t18-probe-'));
  try {
    await cp(path.join(PKG_DIR, 'package.json'), path.join(tmp, 'package.json'));
    await cp(PROBE_DIR, path.join(tmp, 'probe'), { recursive: true });
    return await fn(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * 本机 DSH 安装根（读不到 ⇒ `null`）。
 * 与 `probe/runtime/platform.mjs` 的 `resolveDshInstallDir()` 同口径（环境变量 → npm 全局），
 * 但**本套件自带一份**：`tests/verify-surface/**` 不 import 包外装置，且跨目录 import `probe/**`
 * 会被 `check-boundaries` 记成「未解析相对 import」（那个面只扫代码树，probe 不在树内）。
 */
export function resolveDshInstallDir() {
  const candidates = [];
  if (process.env.DSH_INSTALL_DIR) candidates.push(process.env.DSH_INSTALL_DIR);
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  for (const dir of candidates) if (existsSync(path.join(dir, 'package.json'))) return dir;
  return null;
}

export function runProbeScript(pkgDir, name) {
  const script = path.join(pkgDir, 'probe', 'runtime', `${name}.mjs`);
  const result = spawnSync(process.execPath, [script], { cwd: pkgDir, encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function readProbeEvidence(pkgDir, name) {
  return JSON.parse(readFileSync(path.join(pkgDir, 'probe', 'evidence', `${name}.json`), 'utf8'));
}

/** 文件大小（诊断用）。 */
export function fileSize(file) {
  return existsSync(file) ? statSync(file).size : -1;
}
