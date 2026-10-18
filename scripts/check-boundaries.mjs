#!/usr/bin/env node
/**
 * check-boundaries.mjs —— **随包面解耦的机检门禁**。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * 【为什么不用一份现成的耦合分析器】
 * 那份分析器有三处**已实测**的盲区，读数会被它们静默变松，因此本门禁把三处
 * 都按「修」的口径实现，并**各自造一条违规实测判红**（`--selftest`）：
 *   B1 `SKIP_DIRS` 含**目录名** `lib` ⇒ `scripts/lib/…`、`verify/<任何>/lib/…`（含全仓最大的
 *      `verify/real-machine/lib/judge.mjs`）整片被跳过。**本门禁按「包根相对路径」判定**：
 *      只跳包根那一层 `lib/`（产物根），`<任何>/lib/…` 一律照扫。
 *   B2 `duplicates` 被 `.slice(0, 40)` 截断 ⇒ 该字段恒为 40、**对回归完全失明**。
 *      **本门禁不截断**，并同时给「总数 / 三处以上的族 / `src/**` 内部」三个读数。
 *   B3 域表没有 `kit` / `service` / `entry` 规则，且**域为 null 的边被直接 `continue` 掉**
 *      ⇒ 「能力互连 = 0」可能因域为 null 而**假绿**。**本门禁把域为 null 的文件数当硬判据（必须 0）**，
 *      域表按目标树补齐（`kit` / `assembly`）。
 *
 * 【用法】
 *   node scripts/check-boundaries.mjs            # 判定：有违规 ⇒ 逐条打印并 exit 1
 *   node scripts/check-boundaries.mjs --print     # 只打印全部读数，不判定
 *   node scripts/check-boundaries.mjs --json <f>  # 读数写 JSON（供报告/复算引用）
 *   node scripts/check-boundaries.mjs --selftest  # **自带牙**：三处盲区各造一条违规 ⇒ 必须判红；
 *                                                 #   撤掉违规的对照夹具 ⇒ 必须复绿（不写仓库，用系统临时目录）
 *
 * 【纪律】默认模式**只读**（不写仓内任何文件）；判定阈值是本文件的常量，**只许收紧**。
 *
 * 【重复块的「面」口径】
 * `src/**` + `scripts/**` + `verify/**` + `tools/**` ＝ **生产面**（四类违规硬零）；`tests/**` ＝ **测试面**
 * （≥3 次重复族**只减不增** + **逐条登记理由**）。口径原文、依据与逐条理由**全部写在
 * `./check-boundaries.dup.mjs` 的文件头**（那是重复块口径的唯一真源；本文件不再复述，免得两处漂移）。
 * 判定入口：`violationsOf` 的三条重复块规则；反恒真的负控：`--selftest` 的对应用例。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCli } from './check-boundaries.cli.mjs';
import { runSelftest } from './check-boundaries.selftest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 包根。
 *
 * ★ 本文件从 v2 继承时写着 `path.resolve(HERE, '..')`（仓库根）＋
 * 下游 `path.join(root, 'dsh-gui-frame')` —— 在独立副本里那两处会指向**隔壁的 v2 开发树**：
 * 扫描面读的是 v2 的 323 个文件、公开面读出的是 v2 的快照（读数 1263 ≠ 本树的冻结口径），
 * 于是本树的门禁既没扫自己、又拿别人的字节数判红。副本是**独立可交付单元** ⇒ 包根 = 仓库根，
 * 扫描面就是本树自己的 src/tests/scripts/verify/tools。
 */
export const PKG_DIR = path.resolve(HERE, '..');
/** 门禁的扫描面根（副本内 ＝ 包根；`analyze()` 的 `root` 语义不变）。 */
export const DEFAULT_ROOT = PKG_DIR;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 口径常量与白名单（**唯一真源**＝`./check-boundaries.limits.mjs`；原路径再绑定，导出名一字不变）
// ═══════════════════════════════════════════════════════════════════════════════════════════
import {
  CAPABILITY_EDGE_WHITELIST as _CAPABILITY_EDGE_WHITELIST,
  LIMITS as _LIMITS,
  UNRESOLVED_WHITELIST as _UNRESOLVED_WHITELIST,
} from './check-boundaries.limits.mjs';

export const LIMITS = _LIMITS;
export const CAPABILITY_EDGE_WHITELIST = _CAPABILITY_EDGE_WHITELIST;
export const UNRESOLVED_WHITELIST = _UNRESOLVED_WHITELIST;

/**
 * **测试面**：每一条「≥3 次重复族」都要在 `TESTS_DUP_REASONS`（`check-boundaries.dup.mjs`）里
 * **按文件集合登记一行理由**（`自包含夹具` / `隔离判据` / `待抽取`）——未登记的族 ⇒ **判红**。
 * 口径与逐条理由的完整说明见 `./check-boundaries.dup.mjs` 头部【重复块的「面」口径】。
 */
import {
  TESTS_DUP_REASONS as _TESTS_DUP_REASONS,
  duplicateBlocks as _duplicateBlocks,
  familyFileKey as _familyFileKey,
  normalizeLine as _normalizeLine,
} from './check-boundaries.dup.mjs';

// ── 原路径再绑定：重复块分析面与登记表搬 `./check-boundaries.dup.mjs` 后，导出名一字不变 ────────────
export const TESTS_DUP_REASONS = _TESTS_DUP_REASONS;
export const normalizeLine = _normalizeLine;
export const duplicateBlocks = _duplicateBlocks;
export const familyFileKey = _familyFileKey;

/** import 抽取（含副作用 import / `require(` / 动态 `import(`）—— 与本门禁的 Python 前身同一口径。 */
const IMPORT_RE = /(?:^|[^\w$.])(?:import\s+[^'"]*?from\s*|import\s*|export\s+[^'"]*?from\s*|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g;
/** 具名绑定（dead-export 死导出的唯一口径：导出名是否出现在 `import { … }` 的 from 侧）。 */
const NAMED_IMPORT_RE = /(?:^|[^\w$.])import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
/** 命名空间导入（「去伪」项①：读数应为 0）。 */
const NAMESPACE_IMPORT_RE = /(?:^|[^\w$.])import\s*\*\s*as\s+[A-Za-z0-9_$]+\s*from\s*['"]([^'"]+)['"]/g;

const MJS_RE = /\.(mjs|js)$/;

/** 走查一个包面（相对包根的 posix 路径用于跳过判定 —— 这就是 B1 的修法）。 */
function walk(pkgRoot, scanRoots, out) {
  const stack = scanRoots.map((rel) => path.join(pkgRoot, rel));
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relFromPkg = path.relative(pkgRoot, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (shouldSkipDir(relFromPkg, entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (MJS_RE.test(entry.name)) out.push({ abs, rel: relFromPkg });
    }
  }
  return out;
}

/**
 * 目录跳过判定（**B1 的修法**：按包根相对路径判，不按目录名判）。
 * @param {string} relFromPkg 目录相对包根的 posix 路径
 * @param {string} name 目录名
 */
export function shouldSkipDir(relFromPkg, name) {
  if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.session-backup') return true;
  if (name === 'evidence') return true; // 真机证据目录（62 个，非源码；只在拓扑上有位置）
  if (name.startsWith('.')) return true; // 点前缀 scratch（构建器同样忽略）
  if (relFromPkg === 'lib') return true; // ★ 只跳**包根那一层**产物根；`<任何>/lib/**` 照扫
  return false;
}

/** 读一个扫描面（`src/client` / `src/host` / tests / scripts / verify / tools）。 */
export function readScanFace(pkgRoot) {
  const files = walk(pkgRoot, ['src/client', 'src/host', 'tests', 'scripts', 'verify', 'tools'], []);
  for (const file of files) file.source = fs.readFileSync(file.abs, 'utf8');
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** 相对说明符 → 已扫描到的文件（补 `.mjs` / `.js` / `/index.mjs` 三种后缀）。 */
export function resolveRelative(rel, spec, scanned) {
  const raw = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
  for (const candidate of [raw, `${raw}.mjs`, `${raw}.js`, `${raw}/index.mjs`]) {
    if (scanned.has(candidate)) return candidate;
  }
  return null;
}

/** 一段源码里的全部 import（说明符 + 是否相对）。 */
function specifiersOf(source) {
  const found = [];
  for (const match of source.matchAll(IMPORT_RE)) found.push(match[1]);
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 域表（B3 的修法：补齐 kit / assembly；域为 null ⇒ 硬红）
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** 六个能力域 + 三个「非第七项能力」的域（与 `CAPABILITY_ORDER` / 服务面一致）。 */
const CAPABILITY_DOMAINS = Object.freeze(['dock', 'panel', 'theme', 'overlay']);
/**
 * 装配层（方案 §1.1 · L3）：装配点 + 服务面切片 + 诊断。
 * 这里的每一件都是 `src/client/` 直下、不被域前缀规则命中的叶 —— 不登记就会让 `classifyDomain`
 * 返回 null，以 SELF「域为 null 的文件」判红（新增直下叶时记得同步这张表）。
 */
const ASSEMBLY_ENTRIES = Object.freeze(['src/client/entry.mjs', 'src/client/service.mjs', 'src/client/diagnostics.mjs']);

/**
 * 把一个 `src/**` 文件归入域（L0/L1/L2/L3/L4）。**返回 null 即门禁红**（B3：null 域会让边静默消失）。
 * @param {string} rel 相对包根的 posix 路径（如 `src/client/dock.mjs`）
 */
export function classifyDomain(rel) {
  if (!rel.startsWith('src/')) return 'non-src';
  if (rel.startsWith('src/host/')) return 'host';
  if (rel.startsWith('src/client/contracts/')) return 'contracts';
  if (rel.startsWith('src/client/kit/')) return 'kit';
  if (rel.startsWith('src/client/service/')) return 'assembly';
  if (rel.startsWith('src/client/diagnostics/')) return 'assembly';
  if (rel.startsWith('src/client/entry/')) return 'assembly';
  if (ASSEMBLY_ENTRIES.includes(rel)) return 'assembly';
  for (const domain of CAPABILITY_DOMAINS) {
    if (rel === `src/client/${domain}.mjs` || rel.startsWith(`src/client/${domain}/`)) return domain;
  }
  return null;
}

/** 允许的域间 import 方向（方案 §1.2 的 R1–R8 的可机检投影）。 */
export function edgeAllowed(fromDomain, toDomain) {
  if (fromDomain === null || toDomain === null) return false;
  if (toDomain === 'contracts' || toDomain === 'kit') return true; // R2 / R5：词汇叶与共享叶是全仓可依赖面
  if (fromDomain === 'assembly') return true; // R7：装配层就是这个职责
  if (fromDomain === 'contracts' && toDomain === 'contracts') return true; // R1
  if (fromDomain === 'host' && toDomain === 'host') return true; // R8：两半区互不依赖
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// file-size 规模
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** 行数口径与方案逐字一致：`source.split('\n').length`。 */
export function lineCount(source) {
  return source.split('\n').length;
}

/** file-size：超限文件（src 面豁免表内不报；非 src 面 600 行硬上限）。 */
export function oversizeFiles(files) {
  const src = [];
  const nonSrc = [];
  for (const file of files) {
    const lines = lineCount(file.source);
    if (file.rel.startsWith('src/')) {
      if (LIMITS.dataExempt.includes(file.rel)) continue;
      if (lines > LIMITS.srcMaxLines) src.push({ file: file.rel, lines });
    } else if (lines > LIMITS.nonSrcMaxLines) {
      nonSrc.push({ file: file.rel, lines });
    }
  }
  return { src, nonSrc };
}

/** file-size：data 豁免准入复检 —— 去注释正文里不得出现控制流（方案 §3·file-size 的「零控制流」判据）。 */
export function dataExemptionViolations(files, requirePresent = true) {
  const offenders = [];
  for (const rel of LIMITS.dataExempt) {
    const file = files.find((row) => row.rel === rel);
    if (file === undefined) {
      if (requirePresent) offenders.push({ file: rel, problem: '在豁免表里但磁盘上不存在（豁免必须只减不增）' });
      continue;
    }
    const body = file.source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/(?:=>|\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\bswitch\s*\(|\bclass\s+|\breturn\b)/.test(body)) {
      offenders.push({ file: rel, problem: '豁免准入判据失效：去注释正文里出现控制流（豁免只许给「生成物或纯字面量」）' });
    }
  }
  return offenders;
}


// ═══════════════════════════════════════════════════════════════════════════════════════════
// dead-export 死导出
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** 去注释（定义侧扫描前先剥掉注释，免得示例文本被当成「导出」）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** 一个文件导出的名字（`export function/const/let/var/class`）。 */
export function exportedNames(source) {
  const names = [];
  const body = stripComments(source);
  for (const match of body.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) names.push(match[1]);
  return names;
}

/** dead-export：死导出（导出名未出现在任何文件的 `import { … }` 绑定里；口径同方案）。 */
export function deadExports(files) {
  const bound = new Set();
  let namespaceImports = 0;
  for (const file of files) {
    for (const match of file.source.matchAll(NAMED_IMPORT_RE)) {
      for (const piece of match[1].split(',')) {
        const text = piece.trim();
        if (text === '') continue;
        const asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(text);
        bound.add(asMatch === null ? text : asMatch[2]);
        if (asMatch !== null) bound.add(asMatch[1]);
      }
    }
    for (const _ of file.source.matchAll(NAMESPACE_IMPORT_RE)) namespaceImports += 1;
  }
  const dead = [];
  for (const file of files) {
    if (!file.rel.startsWith('src/')) continue;
    for (const name of exportedNames(file.source)) {
      if (!bound.has(name)) dead.push({ file: file.rel, name });
    }
  }
  return { dead, namespaceImports };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// module-cycle 模块环（Tarjan SCC）
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** 建 import 图（相对 import 解析成功才算边）。 */
export function buildGraph(files) {
  const scanned = new Set(files.map((file) => file.rel));
  const edges = new Map();
  const unresolved = [];
  for (const file of files) {
    const out = new Set();
    for (const spec of specifiersOf(file.source)) {
      if (!spec.startsWith('.')) continue;
      const target = resolveRelative(file.rel, spec, scanned);
      if (target === null) {
        unresolved.push({ file: file.rel, spec });
        continue;
      }
      out.add(target);
    }
    edges.set(file.rel, [...out]);
  }
  return { edges, unresolved };
}

/** module-cycle：环（SCC size>1）与自环。 */
export function findCycles(files, edges) {
  const nodes = files.map((file) => file.rel);
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  let counter = 0;
  const strongConnect = (node) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      for (;;) {
        const popped = stack.pop();
        onStack.delete(popped);
        component.push(popped);
        if (popped === node) break;
      }
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const node of nodes) if (!index.has(node)) strongConnect(node);
  const selfLoops = nodes.filter((node) => (edges.get(node) ?? []).includes(node));
  return { cycles, selfLoops };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// capability-edge 能力域直连
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** capability-edge：越界边（域间 import 不落在白名单内）。 */
export function capabilityEdges(files, edges) {
  const violations = [];
  const observed = new Set();
  for (const file of files) {
    const fromDomain = classifyDomain(file.rel);
    if (fromDomain === 'non-src') continue;
    for (const target of edges.get(file.rel) ?? []) {
      const toDomain = classifyDomain(target);
      if (toDomain === null) continue; // 由自检单独判红（B3）
      if (fromDomain === toDomain) continue;
      const key = `${file.rel}->${target}`;
      observed.add(`${fromDomain}->${toDomain}`);
      if (edgeAllowed(fromDomain, toDomain)) continue;
      if (CAPABILITY_EDGE_WHITELIST.includes(key)) continue;
      violations.push({ from: file.rel, to: target, fromDomain, toDomain });
    }
  }
  const staleWhitelist = CAPABILITY_EDGE_WHITELIST.filter((key) => {
    const [from] = key.split('->');
    return !files.some((file) => file.rel === from);
  });
  return { violations, observed: [...observed].sort(), staleWhitelist };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// dir-depth / test-face / builder-guard
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** dir-depth：`src/client` 目录层数（与 build-client 的 MAX_DIR_DEPTH 同源：`./a/b/c/d/x.mjs` = 4）。 */
export function dirDepths(files) {
  const out = [];
  for (const file of files) {
    if (!file.rel.startsWith('src/client/')) continue;
    const moduleRel = file.rel.slice('src/client/'.length);
    const dir = path.posix.dirname(moduleRel);
    const depth = dir === '.' ? 0 : dir.split('/').filter((part) => part !== '').length;
    out.push({ file: file.rel, depth });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

/** test-face：`tests/**` 直接 import 的 `src` 模块数 / 做这件事的测试文件数。 */
export function testFacing(files, edges) {
  const srcModules = new Set();
  const testFiles = new Set();
  for (const file of files) {
    if (!file.rel.startsWith('tests/')) continue;
    for (const target of edges.get(file.rel) ?? []) {
      if (target.startsWith('src/')) {
        srcModules.add(target);
        testFiles.add(file.rel);
      }
    }
  }
  return { modules: srcModules.size, files: testFiles.size };
}

/** builder-guard：构建器禁止的形态（在 `src/client/**` 上静态复检；构建期另有强校验）。 */
export function builderViolations(files) {
  const offenders = [];
  for (const file of files) {
    if (!file.rel.startsWith('src/client/')) continue;
    const body = file.source;
    const checks = [
      [/^export\s+default\b/m, '禁止 export default'],
      [/^export\s*\{/m, '禁止 export { … } 形式（含再导出）'],
      [/^export\s+class\b/m, '禁止 export class'],
      [/^import\s*['"][^'"]+['"];?[ \t]*$/m, '禁止裸包名 import（种子只能经 env.seeds）'],
    ];
    for (const [re, message] of checks) if (re.test(body)) offenders.push({ file: file.rel, message });
    for (const spec of specifiersOf(body)) {
      if (spec.startsWith('.') && !spec.endsWith('.mjs')) offenders.push({ file: file.rel, message: `相对 import 必须写全 .mjs：${spec}` });
      if (!spec.startsWith('.') && !spec.startsWith('node:')) offenders.push({ file: file.rel, message: `裸包名 import：${spec}` });
    }
  }
  return offenders;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// surface-snapshot 公开面
// ═══════════════════════════════════════════════════════════════════════════════════════════
function publicSurface(pkgRoot) {
  const script = path.join(pkgRoot, 'scripts', 'public-surface.mjs');
  const snapshot = path.join(pkgRoot, 'tests', 'contracts', 'public-surface.json');
  if (!fs.existsSync(script)) return { ok: false, reason: 'public-surface.mjs 不存在', bytes: 0 };
  const bytes = fs.existsSync(snapshot) ? fs.statSync(snapshot).size : 0;
  const run = spawnSync(process.execPath, [script], { cwd: pkgRoot, stdio: 'inherit' });
  return { ok: run.status === 0, reason: run.status === 0 ? '与冻结快照逐字节一致' : `退出码 ${run.status}`, bytes };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 总分析
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * 跑一次全量分析（纯函数式：只读 root，不写盘）。
 * @param {{root?:string, withPublicSurface?:boolean}} [options]
 */
export function analyze(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  /**
   * `profile: 'fixture'`（**只给 `--selftest` 的假仓库用**）：把「对真实仓库才有意义」的量化下限
   * （测试直面 55/62、豁免文件必须在位）松到 0 —— 假仓库本来就没有 596 条测试与豁免产物。
   * **这不是放宽判据**：真实仓库一律走默认 profile，阈值仍是方案原文。
   */
  const fixture = options.profile === 'fixture';
  const limits = {
    ...LIMITS,
    testDirectModulesMin: fixture ? 0 : LIMITS.testDirectModulesMin,
    testDirectFilesMin: fixture ? 0 : LIMITS.testDirectFilesMin,
  };
  // ★ v1.0 副本：包根 = `root` 本身（见 PKG_DIR 的注释）——不再拼 `dsh-gui-frame` 子目录名。
  const pkgRoot = root;
  const files = readScanFace(pkgRoot);
  /** 测试面理由表（**单测缝**：默认＝登记表；自检用它注入「过期登记」做反尘味的阴性对照）。 */
  const dupReasons = Array.isArray(options.dupReasons) ? options.dupReasons : TESTS_DUP_REASONS;
  const { edges, unresolved } = buildGraph(files);
  const cycles = findCycles(files, edges);
  const domains = new Map();
  const nullDomain = [];
  for (const file of files) {
    if (!file.rel.startsWith('src/')) continue;
    const domain = classifyDomain(file.rel);
    domains.set(file.rel, domain);
    if (domain === null) nullDomain.push(file.rel);
  }
  const unresolvedWhitelisted = unresolved.filter((row) => {
    if (UNRESOLVED_WHITELIST.fixtureFiles.some((prefix) => row.file.startsWith(prefix))) return true;
    return UNRESOLVED_WHITELIST.exact.some((entry) => entry.file === row.file && entry.spec === row.spec);
  });
  const unresolvedOpen = unresolved.filter((row) => !unresolvedWhitelisted.includes(row));
  const srcCycles = cycles.cycles.filter((component) => component.every((file) => file.startsWith('src/')));
  const foreignCycles = cycles.cycles.filter((component) => component.some((file) => !LIMITS.registeredCycles.includes(file)));
  return {
    root,
    profile: fixture ? 'fixture' : 'repo',
    limits,
    files: {
      total: files.length,
      src: files.filter((file) => file.rel.startsWith('src/')).length,
      srcClient: files.filter((file) => file.rel.startsWith('src/client/')).length,
    },
    m1: { ...oversizeFiles(files), dataExemption: dataExemptionViolations(files, !fixture) },
    m2: {
      ...duplicateBlocks(files, { reasons: dupReasons, checkStale: !fixture || Array.isArray(options.dupReasons) }),
      /**
       * **方案口径对照面**（同一套重复块算法，额外剔掉 `<任何>/lib/…` 后再算一次）。
       * 为什么要有它：另外两个绝对数字（410 / 187）是在**跳过判定未修**的面上复算的；
       * 直接拿它们去卡 B1 修好后的全身面是「换了尺子还照旧刻度」。所以：
       *  · 「总数 / src 内部」按方案口径面判（可比）；
       *  · 「≥3 次的族」按**面**判（生产面硬零 / 测试面只减不增，见文件头）。
       */
      planFace: duplicateBlocks(files.filter((file) => !file.rel.startsWith('lib/') && !file.rel.includes('/lib/')), { checkStale: false }),
    },
    m3: deadExports(files),
    m4: { srcCycles, allCycles: cycles.cycles, selfLoops: cycles.selfLoops, foreignCycles },
    m5: capabilityEdges(files, edges),
    m6: { deepest: dirDepths(files).slice(0, 5) },
    m7: testFacing(files, edges),
    m9: builderViolations(files),
    selfCheck: { nullDomain, unresolvedOpen, unresolvedWhitelisted: unresolvedWhitelisted.length, unresolvedTotal: unresolved.length },
    m8: options.withPublicSurface === false ? { ok: null, reason: '（未跑）', bytes: 0 } : publicSurface(pkgRoot),
  };
}

/** 把读数转成违规清单（空数组 ⇒ 绿）。 */
export function violationsOf(reading) {
  const rows = [];
  const push = (id, message) => rows.push({ id, message });
  for (const row of reading.m1.src) push('file-size', `src 超限 ${row.lines} 行 > ${LIMITS.srcMaxLines}：${row.file}`);
  for (const row of reading.m1.nonSrc) push('file-size', `非 src 超限 ${row.lines} 行 > ${LIMITS.nonSrcMaxLines}：${row.file}`);
  for (const row of reading.m1.dataExemption) push('file-size', `data 豁免失守：${row.file}（${row.problem}）`);
  if (reading.m2.planFace.total > LIMITS.dupTotalMax) push('repeat-family', `重复组 ${reading.m2.planFace.total}（方案口径面）> 上限 ${LIMITS.dupTotalMax}`);
  if (reading.m2.productionFamilies.length > LIMITS.dupRepeatFamilyMax) {
    push('repeat-family', `**生产面**出现 ≥3 次的重复族 ${reading.m2.productionFamilies.length} 组 > 上限 ${LIMITS.dupRepeatFamilyMax}（例：${reading.m2.productionFamilies[0].slice(0, 3).join(' , ')}）`);
  }
  if (reading.m2.testsFamilies.length > LIMITS.testsDupFamiliesMax) {
    push('repeat-family', `**测试面** ≥3 次重复族 ${reading.m2.testsFamilies.length} 组 > 登记基线 ${LIMITS.testsDupFamiliesMax}（**只减不增**；口径与理由见 check-boundaries.dup.mjs 头部）`);
  }
  for (const hits of reading.m2.unregisteredTestsFamilies) {
    push('repeat-family', `**测试面** ≥3 次重复族**未登记理由**（TESTS_DUP_REASONS 里按文件集合查无此条；新造出来的重复不许溜过去）：${familyFileKey(hits)}｜命中 ${hits.length} 处：${hits.slice(0, 4).join(' , ')}`);
  }
  for (const row of reading.m2.staleTestsReasons) {
    push('repeat-family', `**测试面**理由表里的条目**已不再命中任何重复族**（反尘味；口径同 CAPABILITY_EDGE_WHITELIST 的 staleWhitelist：理由表不许退化成永久豁免）：${row.files.join(' | ')}`);
  }
  if (reading.m2.planFace.srcInternal > LIMITS.dupSrcInternalMax) push('repeat-family', `src 内部重复组 ${reading.m2.planFace.srcInternal}（方案口径面）> 上限 ${LIMITS.dupSrcInternalMax}`);
  if (reading.m3.dead.length > LIMITS.deadExportsMax) push('dead-export', `死导出 ${reading.m3.dead.length} > 上限 ${LIMITS.deadExportsMax}`);
  if (reading.m3.namespaceImports > 0) push('dead-export', `命名空间导入 ${reading.m3.namespaceImports} 处（口径要求 0：它会让死导出读数失真）`);
  if (reading.m4.srcCycles.length > LIMITS.srcCyclesMax) push('module-cycle', `src 真环 ${reading.m4.srcCycles.length} 个 > 上限 ${LIMITS.srcCyclesMax}`);
  if (reading.m4.selfLoops.length > 0) push('module-cycle', `自环 ${reading.m4.selfLoops.length} 个（必须 0）`);
  for (const component of reading.m4.foreignCycles) push('module-cycle', `未登记的环：${component.join(' ↔ ')}`);
  for (const row of reading.m5.violations) push('capability-edge', `能力域直连（不在白名单）：${row.fromDomain} → ${row.toDomain}｜${row.from} → ${row.to}`);
  for (const key of reading.m5.staleWhitelist) push('capability-edge', `白名单里的边已消失（可收紧白名单）：${key}`);
  const deepest = reading.m6.deepest[0];
  if (deepest !== undefined && deepest.depth > LIMITS.maxDirDepth) push('dir-depth', `src/client 目录层数 ${deepest.depth} > ${LIMITS.maxDirDepth}：${deepest.file}`);
  if (reading.m7.modules < reading.limits.testDirectModulesMin) push('test-face', `测试直连的 src 模块 ${reading.m7.modules} < 下限 ${reading.limits.testDirectModulesMin}（不许改测试换绿）`);
  if (reading.m7.files < reading.limits.testDirectFilesMin) push('test-face', `直接 import src 的测试文件 ${reading.m7.files} < 下限 ${reading.limits.testDirectFilesMin}`);
  if (reading.m8.ok === false) push('surface-snapshot', `公开面判定失败：${reading.m8.reason}`);
  if (reading.m8.ok === true && reading.m8.bytes !== LIMITS.publicSurfaceBytes) push('surface-snapshot', `公开面快照字节数 ${reading.m8.bytes} ≠ 冻结口径 ${LIMITS.publicSurfaceBytes}`);
  for (const row of reading.m9) push('builder-guard', `${row.message}：${row.file}`);
  for (const file of reading.selfCheck.nullDomain) push('SELF', `域为 null 的文件（B3 的口子，必须 0）：${file}`);
  for (const row of reading.selfCheck.unresolvedOpen) push('SELF', `未解析的相对 import（未白名单化）：${row.file} → ${row.spec}`);
  return rows;
}

const { main } = createCli({ analyze, violationsOf, runSelftest, LIMITS, DEFAULT_ROOT, CAPABILITY_EDGE_WHITELIST, TESTS_DUP_REASONS, familyFileKey });

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
