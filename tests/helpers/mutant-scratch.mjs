/**
 * mutant-scratch.mjs —— **变异副本落盘的唯一口径**。
 *
 * ═══ 为什么不能再维护「硬编码 import 清单」═══
 * 硬编码 import 清单的变异夹具只写死了几个相对 import ——
 * 只要被测模块**新增一个相对 import**（样式下沉到 `panel/base.mjs` 就是一次），
 * 副本目录里就缺文件，5 条变异反证一起报 `ERR_MODULE_NOT_FOUND`（**夹具失效，不是真代码缺陷**）。
 * 口径（只许收紧）：复制面必须**从被测入口按 import 图递归收集**（相对 import 逐层展开），
 * 不得再维护硬编码清单 —— 否则本仓每一次拆分都会再制造一次同类红点。
 *
 * ═══ 落盘形状：**保持包根相对路径** ═══
 * 副本树写成 `<scratchDir>/src/client/panel/components.mjs` 这种**与包内同构**的相对路径，
 * 于是副本之间的相对 import **原样成立**（一个字节都不用改写），
 * 而裸包名（`react` / `jsdom`）仍按 node 解析规则向父目录找到本包 `node_modules`。
 * 这同时把 `rewire*` 那类「改写后没命中就静默空转」的隐患整类消掉：不再有改写。
 *
 * 本文件是**测试辅助**：不写盘以外无副作用，不 import 被测模块，不联网。
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * import 抽取（含副作用 import / `require(` / 动态 `import(`），与门禁 `check-boundaries.mjs` 同一口径。
 * 只取**相对**说明符；裸包名（含 `node:`）不属于「复制面」。
 */
const IMPORT_RE = /(?:^|[^\w$.])(?:import\s+[^'"]*?from\s*|import\s*|export\s+[^'"]*?from\s*|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g;

/**
 * 抽出一段源码里的**相对** import 说明符（去重、保持出现顺序）。
 * @param {string} source 源码文本
 * @returns {string[]} 形如 `./base.mjs` / `../contracts/errors.mjs`
 */
export function relativeImportSpecifiers(source) {
  const found = [];
  for (const match of String(source).matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    if (!found.includes(spec)) found.push(spec);
  }
  return found;
}

/**
 * 相对说明符 → 磁盘上的真实文件（补 `.mjs` / `.js` / `/index.mjs` 三种后缀）。
 * @param {string} fromFile 引用方文件
 * @param {string} spec 相对说明符
 * @returns {string|null} 解析到的真实文件；不存在 ⇒ null
 */
export function resolveRelativeFile(fromFile, spec) {
  const raw = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [raw, `${raw}.mjs`, `${raw}.js`, path.join(raw, 'index.mjs')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 从入口文件按 import 图**递归**收集相对 import 闭包。
 * @param {string} entryFile 入口的绝对路径
 * @returns {Map<string, string>} 绝对路径 → 源码（含入口自身）
 */
export function collectImportClosure(entryFile) {
  const closure = new Map();
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.shift();
    if (closure.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    closure.set(file, text);
    for (const spec of relativeImportSpecifiers(text)) {
      const resolved = resolveRelativeFile(file, spec);
      if (resolved !== null && !closure.has(resolved)) queue.push(resolved);
    }
  }
  return closure;
}

/**
 * 把「入口 + 其 import 闭包」按**包根相对路径**写进 scratch 目录，入口用变异后的源码。
 *
 * @param {object} options
 *  - `entryFile`：被测入口的绝对路径（必须在本包内）
 *  - `source`：入口的**变异后**源码
 *  - `scratchDir`：本进程独占的 scratch 子目录（调用方创建/清理）
 *  - `packageRoot`：包根（`dsh-gui-frame/`），副本树按它算相对路径
 *  - `tag`：**同一条用例的副本标识**（可选）。同一个入口文件在同一个进程里派生**多份**不同变异时，
 *    必须给不同的 tag：否则副本路径相同 ⇒ ESM 的模块缓存会把第二份当成第一份（实测踩过：
 *    实测踩过：第二次读到的是第一次的变异体，反证结论全错）。tag 会成为 scratch 下一层目录名。
 * @returns {string} 副本入口的绝对路径（可直接 `import()`）
 */
export function writeMutantTree({ entryFile, source, scratchDir, packageRoot, tag = null, overrides = null }) {
  const relativeEntry = path.relative(packageRoot, entryFile);
  if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
    throw new Error(`[mutant-scratch] 入口必须在包内：${entryFile}（包根 ${packageRoot}）`);
  }
  const closure = collectImportClosure(entryFile);
  // 防空转：闭包必须真的展开出依赖 —— 只剩入口自己说明 import 图没被读到（口径失效，要立刻红）
  if (closure.size < 2) {
    throw new Error(`[mutant-scratch] ${relativeEntry} 的相对 import 闭包只有 ${closure.size} 个文件（防空转：import 图没读到）`);
  }
  const base = tag === null || tag === '' ? scratchDir : path.join(scratchDir, String(tag));
  for (const [file, text] of closure) {
    const relative = path.relative(packageRoot, file);
    const target = path.join(base, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    // `overrides`：**依赖文件**也要能被定点变异（拆分后靶点可能不在入口里）。
    // 口径与入口一致：写的是调用方给的**变异后**文本，没给就原样复制。
    const override = overrides === null || overrides === undefined ? undefined : overrides[file];
    writeFileSync(target, file === entryFile ? source : (override ?? text), 'utf8');
  }
  return path.join(base, relativeEntry);
}

/**
 * 收尾：**只删本进程那一层**；共享根只在「自己删空后仍然空着」时才尝试移除
 * （`rmdirSync` 对非空目录必抛 ⇒ 永远碰不到并发进程的层）。
 * @param {string} scratchDir 本进程的层
 * @param {string} scratchRoot 共享根
 */
export function cleanupMutantTree(scratchDir, scratchRoot) {
  rmSync(scratchDir, { recursive: true, force: true });
  try {
    rmdirSync(scratchRoot);
  } catch {
    /* 根目录非空（还有别的进程在跑）或已不存在 —— 都不该影响本进程的结论 */
  }
}
