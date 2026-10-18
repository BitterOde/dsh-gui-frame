/**
 * build-client.mjs —— 客户端半区构建：`src/client/**.mjs` → `lib/client.js`。
 *
 * 为什么自己写打包器（而不是 esbuild/tsdown）：**零外部依赖**（`dependencies` 恒为空）。
 * 平台实测契约（dsh-client-modules 的 `__ModuleLoader__`，本机 DSH 0.2.0-rc.2 实读）：
 * 产物是 **classic script**（非 ESM），顶层唯一副作用是 `window.__ModuleLoader__.load({ id, factory })`；
 * 模块体在 factory 内惰性物化，**种子键一律 `require` 运行时、绝不打进 bundle**（否则双 React / 双 SlotCore）。
 *
 * ═══ 能力 ═══
 * - **`ALLOWED_REQUIRES` 写全名**：8 项冻结清单（react / react/jsx-runtime / react-dom /
 *   @deepseek-ai/cordis / @deepseek-ai/dsh-client-store / @deepseek-ai/dsh-client-ui-primitives /
 *   @deepseek-ai/dsh-client-ui-slots / @deepseek-ai/dsh-client-ui-dockkit）。写简写（`cordis` /
 *   `primitives`…）会让合法 require 被白名单拒，或运行期 `require('cordis')` 直接 throw。
 *   **白名单与注入集同一真源**＝本文件顶部的 `SEED_DECLARATIONS`（改一处即两处生效）；
 *   不因「官方产物用过别的键」而扩容，新增第 9 键须先有真实调用点。
 * - **有限深度相对 import**：支持 `./x.mjs` 与 `../y.mjs`（按 posix 语义解析到模块 id），
 *   仍禁裸包名、仍禁 `export default` / `export { … }` / `export class`；越出 `src/client` 根、
 *   目录层数超过 `MAX_DIR_DEPTH`、import 目标不存在 —— 一律构建失败（绝不静默改写）。
 * - **产物头部按声明注入多个种子实例**：每个声明生成一行 `var <key> = require('<全名>')`，
 *   汇成一个 `__seeds` 对象交给 `createClientModule(__seeds)`（不再只注入 react）。
 * - **环检测 / 越界检测全静态**：正则解析 + 目录遍历，**不执行 bundle**。
 *
 * 构建期硬校验（任一不过 ⇒ exit 1）：
 * 1. `node --check`（classic script：ESM 语法会直接报错，这正是要的）；
 * 2. 顶层只调用一次 `window.__ModuleLoader__.load({ id, factory })`，且 `id === package.json name`；
 * 3. factory 里 `require('…')` 集合 ⊆ `ALLOWED_REQUIRES`，且**逐条等于声明集**（不重不漏）；
 * 4. 真能在「只有 window.__ModuleLoader__」的环境里加载：`factory(fakeRequire)` 返回 `{apply, inject}`，
 *    且 `apply(最小客户端 ctx)` **不抛错**（客户端 apply 抛错会打死整页）；
 * 5. 可重复构建：两次独立打包**逐字节相同**（确定性，无时间戳 / 无随机值）；
 * 6. `package.json` 契约：`dsh.client.platform === 'web'`、`exports['./client']` 指向本产物、
 *    无 `dsh.client.external`、`dependencies` 为空、`files` 含 `lib`、`dsh.bundle.patch` 正确。
 *
 * 用法：node scripts/build-client.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeCtx, createFakeSlots } from '../tests/helpers/fake-ctx.mjs';
import { createFakeReact } from '../tests/helpers/fake-react.mjs';
import { writeFileAtomic } from './lib/atomic-write.mjs';

import { sameSequence } from './build-client/checks.mjs';
import { ALLOWED_REQUIRES as _ALLOWED_REQUIRES, SEED_DECLARATIONS as _SEED_DECLARATIONS, createClientCheckCtx as _createClientCheckCtx, createFakeSeeds as _createFakeSeeds, isFullSeedName as _isFullSeedName, loadArtifact as _loadArtifact, packageChecks as _packageChecks, syntaxCheck as _syntaxCheck } from './build-client/checks.mjs';

/* 下面这组 re-bind 保持本文件的对外导出集合一字不变（产物自校验件已搬到 ./build-client/checks.mjs）。 */
export const SEED_DECLARATIONS = _SEED_DECLARATIONS;
export const ALLOWED_REQUIRES = _ALLOWED_REQUIRES;
export const syntaxCheck = _syntaxCheck;
export const createFakeSeeds = _createFakeSeeds;
export const loadArtifact = _loadArtifact;
export const createClientCheckCtx = _createClientCheckCtx;
export const isFullSeedName = _isFullSeedName;
export const packageChecks = _packageChecks;

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 包根：`dsh-gui-frame/`。 */
export const PKG_DIR = path.resolve(HERE, '..');
export const PKG_FILE = path.join(PKG_DIR, 'package.json');
export const SRC_CLIENT_DIR = path.join(PKG_DIR, 'src', 'client');
export const OUT_FILE = path.join(PKG_DIR, 'lib', 'client.js');
/** 客户端半区组装入口模块名（恒在 src/client 根下）。 */
export const ENTRY_MODULE = './entry.mjs';
/** 入口模块的工厂函数名（`createClientModule(__seeds)`）。 */
export const FACTORY_CALL = 'createClientModule';

/**
 * `src/client` 之下的**目录层数上限**（「有限深度」的具体口径）。
 * 例：`./entry.mjs` = 0 层、`./panel/index.mjs` = 1 层、`./a/b/c/d/x.mjs` = 4 层（恰好合法）、
 * `./a/b/c/d/e/x.mjs` = 5 层 ⇒ 构建失败。相对 import 可以 `../` 向上，但不允许解析后越出 `src/client` 根。
 */
export const MAX_DIR_DEPTH = 4;


const IMPORT_NAMED = /^import\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2;?[ \t]*$/m;
const IMPORT_SIDE_EFFECT = /^import\s*(['"])([^'"]+)\1;?[ \t]*$/m;
const EXPORT_FUNCTION = /^export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/m;
const EXPORT_CONST = /^export\s+const\s+([A-Za-z0-9_$]+)/m;

/** 构建失败（CLI 捕获后 exit 1）。 */
export class BuildError extends Error {}

function fail(message) {
  throw new BuildError(message);
}

/**
 * 把一个相对说明符解析成**模块 id**（`./` + 相对 `src/client` 的 posix 路径）。
 * 越出 `src/client` 根（`../` 爬到根之上）一律失败。
 * @param {string} fromId 发起 import 的模块 id，如 `./panel/index.mjs`
 * @param {string} spec import 里的说明符，如 `../shared/util.mjs`
 */
export function resolveModuleId(fromId, spec) {
  const base = path.posix.dirname(fromId); // './panel/index.mjs' → './panel'；'./entry.mjs' → '.'
  const joined = path.posix.join(base, spec);
  const normalized = path.posix.normalize(joined);
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    fail(`import 的 ${spec}（来自 ${fromId}）越出 src/client 根目录 —— 有限深度不等于可以爬出包`);
  }
  return normalized.startsWith('./') ? normalized : `./${normalized}`;
}

/** 解析并**移除**一个模块里的 import 语句（其余字节与换行结构保持不变）。 */
function parseImports(file, text) {
  const imports = [];
  let rest = text;
  const checkSpec = (spec) => {
    if (!spec.startsWith('.')) fail(`${file}：只支持相对 import，发现裸模块名 ${spec}`);
    if (!spec.endsWith('.mjs')) fail(`${file}：import 的 ${spec} 必须写全 .mjs 扩展名（构建期不做扩展名推断）`);
  };
  for (;;) {
    const named = IMPORT_NAMED.exec(rest);
    const side = IMPORT_SIDE_EFFECT.exec(rest);
    if (!named && !side) break;
    const useNamed = named && (!side || named.index <= side.index);
    if (useNamed) {
      const spec = named[3];
      checkSpec(spec);
      const bindings = named[1]
        .split(',')
        .map((piece) => piece.trim())
        .filter((piece) => piece !== '')
        .map((piece) => {
          const asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(piece);
          if (asMatch) return { from: asMatch[1], to: asMatch[2] };
          if (!/^[A-Za-z0-9_$]+$/.test(piece)) fail(`${file}：不支持的 import 说明符「${piece}」`);
          return { from: piece, to: piece };
        });
      imports.push({ spec, bindings });
      rest = `${rest.slice(0, named.index)}${rest.slice(named.index + named[0].length)}`;
    } else {
      const spec = side[2];
      checkSpec(spec);
      imports.push({ spec, bindings: [] });
      rest = `${rest.slice(0, side.index)}${rest.slice(side.index + side[0].length)}`;
    }
  }
  return { imports, text: rest };
}

/** 收集 `export function` / `export const` 的名字，并剥掉 export 前缀。 */
function parseExports(file, text) {
  if (/^export\s+default\b/m.test(text)) fail(`${file}：不支持 export default`);
  if (/^export\s*\{/m.test(text)) fail(`${file}：不支持 export { … } 形式（请改用 export function/const）`);
  if (/^export\s+class\b/m.test(text)) fail(`${file}：不支持 export class`);
  const names = [];
  let out = text;
  for (;;) {
    const fn = EXPORT_FUNCTION.exec(out);
    const cn = EXPORT_CONST.exec(out);
    if (!fn && !cn) break;
    const useFn = fn && (!cn || fn.index <= cn.index);
    if (useFn) {
      names.push(fn[2]);
      out = `${out.slice(0, fn.index)}${fn[1] ?? ''}function ${fn[2]}${out.slice(fn.index + fn[0].length)}`;
    } else {
      names.push(cn[1]);
      out = `${out.slice(0, cn.index)}const ${cn[1]}${out.slice(cn.index + cn[0].length)}`;
    }
  }
  return { names, text: out };
}

/**
 * 目录遍历收集 `src/client/**\/*.mjs`（静态，不执行任何源）。
 * 目录层数 > `MAX_DIR_DEPTH`、出现非 `.mjs` 的普通文件、出现非普通文件/目录 ⇒ 失败。
 * **点前缀条目一律跳过（不递归、不校验、不进图）** —— **并行写入豁免**：
 *   并行写入方（其他成员 / 编辑器 / 工具）做**原子写**时，会在目标目录下先落一个暂存目录或暂存文件
 *   （如 `src/client/.tmpdir/xxx.tmp`），写完再改名或搬走。这类条目是**外部瞬时状态**，不是本包的源；
 *   把它当成「非法文件」会让整个 `npm run build` exit 1，于是其他成员会看到与自己无关的**瞬时红**。
 *   豁免的边界（严格保持不变，绝不静默）：
 *     - 只有**点前缀**（`.` 开头）的条目被跳过；点前缀目录**不递归**（里面的东西既不校验也不进图）；
 *     - **非点前缀的非 `.mjs` 普通文件仍然一律失败**（那才是「人把源文件放错了」）；
 *     - `src/client` 的真源**只能是非点前缀的 `*.mjs`**：点前缀的 `.mjs` 也视为暂存物、不进图。
 * @returns {Promise<string[]>} 相对 `src/client` 的 posix 路径（未排序；目录不存在 ⇒ `[]`）
 */
async function walkSource(dir, relDir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' && relDir === '') return out;
    throw error;
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    // 点前缀 = 并行写入方的暂存物（原子写临时目录 / 临时文件）：跳过，既不校验也不进图。
    if (entry.name.startsWith('.')) continue;
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      const depth = rel.split('/').length;
      if (depth > MAX_DIR_DEPTH) {
        fail(`目录深度超限：src/client/${rel} 是第 ${depth} 层目录，上限 ${MAX_DIR_DEPTH} 层（「有限深度」）`);
      }
      await walkSource(path.join(dir, entry.name), rel, out);
      continue;
    }
    if (!entry.isFile()) fail(`src/client 只允许普通文件与目录（发现 src/client/${rel}）`);
    if (!entry.name.endsWith('.mjs')) fail(`src/client 只允许 *.mjs（发现 src/client/${rel}）`);
    out.push(rel);
  }
  return out;
}

/**
 * 读 `src/client/**\/*.mjs` 并做语法级解析（模块 id ＝ `./` + 相对根路径）。
 * `src/client/` 不存在或没有 `.mjs` ⇒ 空 Map（占位产物）；有源码但没有入口 ⇒ 失败；
 * import 目标解析后必须真实存在于图里 ⇒ 否则失败（越界/缺文件的统一出口）。
 *
 * @param {string} [dir] 源目录（测试可传临时目录）
 * @returns {Promise<Map<string, object>>} key = 模块 id（如 `./entry.mjs`、`./panel/index.mjs`）
 */
export async function loadModules(dir = SRC_CLIENT_DIR) {
  const rels = (await walkSource(dir, '', [])).sort();
  if (rels.length === 0) return new Map();
  const modules = new Map();
  for (const rel of rels) {
    const id = `./${rel}`;
    const raw = await readFile(path.join(dir, ...rel.split('/')), 'utf8');
    const { imports, text: withoutImports } = parseImports(rel, raw);
    const parsed = parseExports(rel, withoutImports);
    if (/^import\s/m.test(parsed.text)) fail(`${rel}：仍有未处理的 import 语句`);
    if (/^export\s/m.test(parsed.text)) fail(`${rel}：仍有未处理的 export 语句`);
    modules.set(id, {
      id,
      file: rel,
      imports: imports.map((item) => ({ ...item, target: resolveModuleId(id, item.spec) })),
      exports: parsed.names,
      body: parsed.text,
    });
  }
  if (!modules.has(ENTRY_MODULE)) {
    fail(`缺少入口模块 ${ENTRY_MODULE}（src/client 下有 ${modules.size} 个模块：${[...modules.keys()].join('、')}）`);
  }
  for (const module of modules.values()) {
    for (const item of module.imports) {
      if (!modules.has(item.target)) {
        fail(`${module.file}：import 的 ${item.spec} 解析到 ${item.target}，但 src/client 内没有这个模块`);
      }
    }
  }
  // 每个模块都必须能从入口走到：打包规则是「src/client 下每个 .mjs 都进产物」，
  // 于是一个没人 import 的模块会**照样被打进产物**（只有当测试还引用它时才看不出来）。
  // 判据放在这里而不是事后扫描：构建是唯一能同时看到「全部模块」与「入口」的地方。
  const reached = new Set();
  const walk = (id) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const item of modules.get(id).imports) walk(item.target);
  };
  walk(ENTRY_MODULE);
  const orphans = [...modules.values()].map((module) => module.file).filter((file) => !reached.has(`./${file}`)).sort();
  if (orphans.length > 0) {
    fail(`以下模块从入口 ${ENTRY_MODULE} 不可达，却会被打进产物（删掉它们，或接到真实调用点）：${orphans.join('、')}`);
  }
  return modules;
}

/** import 的目标模块 id（`loadModules` 已解析；合成模块图允许只给 spec，这里补解析）。 */
function targetOf(module, item) {
  return item.target ?? resolveModuleId(module.id, item.spec);
}

/**
 * 静态绑定检查：`import { a as b } from './y.mjs'` 里的 `a` 必须在 y 的导出列表里。
 * 打包器把 import 变成 `var { a } = __esMod['./y.mjs']` —— y 未导出 `a` 时运行时只会静默拿到
 * `undefined`（真 ESM 会立刻报错）⇒ 必须在**构建期**显式变红。跨目录同理。
 */
export function checkBindings(modules) {
  const problems = [];
  for (const module of modules.values()) {
    for (const item of module.imports) {
      const targetId = targetOf(module, item);
      const target = modules.get(targetId);
      if (target === undefined) {
        problems.push(`${module.file} → ${targetId} 不存在`);
        continue;
      }
      for (const binding of item.bindings) {
        if (!target.exports.includes(binding.from)) {
          problems.push(`${module.file} 从 ${targetId} 导入 ${binding.from}，但该模块只导出：${target.exports.join('、') || '（无）'}`);
        }
      }
    }
  }
  return problems;
}

/** 拓扑排序（依赖在前）；有环 / 缺模块 ⇒ 构建失败。全程静态，不执行模块。 */
export function sortModules(modules) {
  const order = [];
  const state = new Map();
  const visit = (id, stack) => {
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') fail(`模块循环依赖：${[...stack, id].join(' → ')}`);
    const module = modules.get(id);
    if (module === undefined) fail(`模块 ${id} 不在图里（被 ${stack.at(-1) ?? '入口'} 引用）`);
    state.set(id, 'visiting');
    for (const item of module.imports) visit(targetOf(module, item), [...stack, id]);
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of [...modules.keys()].sort()) visit(id, []);
  return order;
}

/** 生成单个模块的 wrapper 源码（模块体逐字节保留，只把 import/export 换成 var/return）。 */
function emitModule(module) {
  const prologue = module.imports.map((item) => {
    const target = targetOf(module, item);
    if (item.bindings.length === 0) return `  __esMod[${JSON.stringify(target)}];`;
    const pattern = item.bindings.map((binding) => (binding.from === binding.to ? binding.from : `${binding.from}: ${binding.to}`)).join(', ');
    return `  var { ${pattern} } = __esMod[${JSON.stringify(target)}];`;
  }).join('\n');
  const exported = module.exports.map((name) => `${name}: ${name}`).join(', ');
  return [
    `__esMod[${JSON.stringify(module.id)}] = (function () {`,
    prologue,
    module.body.endsWith('\n') ? module.body.slice(0, -1) : module.body,
    `  return { ${exported} };`,
    '}());',
  ].filter((line) => line !== '').join('\n');
}

/**
 * 种子注入块：按 `SEED_DECLARATIONS` 生成**多行** `require`，汇成 `__seeds`。
 * 确定性：同声明 ⇒ 同字节；声明顺序即产物顺序（`ALLOWED_REQUIRES` 同源）。
 */
export function seedPrologue(declarations = SEED_DECLARATIONS) {
  const lines = ['    // 种子实例按声明注入（SEED_DECLARATIONS）—— 外壳运行时提供，**绝不**打进 bundle：'];
  for (const entry of declarations) {
    lines.push(`    var ${entry.key} = require(${JSON.stringify(entry.name)});`);
  }
  lines.push('', `    var __seeds = { ${declarations.map((entry) => `${entry.key}: ${entry.key}`).join(', ')} };`, '');
  return lines.join('\n');
}

/** 产物头注释（构建期与测试同源）。 */
export function bundleHeader({ mode, sorted, pkgName }) {
  const lines = [
    '/**',
    ` * lib/client.js —— ${pkgName} 客户端半区产物（**由 scripts/build-client.mjs 生成，请勿手改**）。`,
    ' *',
    ' * 形态（平台实测契约）：classic script（非 ESM），顶层唯一副作用 = 向',
    ' * `window.__ModuleLoader__.load({ id, factory })` 注册 factory；模块体在 factory 内惰性物化。',
    ` * 种子实例按 SEED_DECLARATIONS 注入（${SEED_DECLARATIONS.length} 个，全名 require、**绝不打包**）；`,
    ` * 相对 import 支持有限深度（目录层数 ≤ ${MAX_DIR_DEPTH}，不得越出 src/client 根）。`,
    ' *',
  ];
  if (mode === 'placeholder') {
    lines.push(
      ' * **骨架占位**：src/client 下尚无 .mjs 源，',
      ' * 故本产物只保证形状合法（id 正确、factory 返回 {apply, inject}）。',
      ' * 落下 src/client/*.mjs 后重跑 node scripts/build-client.mjs 即换成真实 bundle。',
    );
  } else {
    // 注意：这里会进**产物头注释**，所以不能出现 `**` 紧跟 `/` 的写法（`*/` 会提前闭合注释）。
    lines.push(` * 源：src/client 下 ${sorted.length} 个 .mjs（拓扑序）；入口 ${ENTRY_MODULE}。`);
  }
  lines.push(' */');
  return lines.join('\n');
}

/** 生成完整产物文本。 */
export function renderBundle({ pkgName, sorted, modules, header }) {
  const parts = [
    header,
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(pkgName)},`,
    '  factory: function (require) {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });",
    '',
    seedPrologue(),
    '    var __esMod = {};',
    '',
    ...sorted.map((id) => emitModule(modules.get(id))),
    '',
  ];
  if (modules.size === 0) {
    parts.push(
      '    // 骨架占位：src/client 尚无模块（落地后由 build-client 重新生成）',
      '    exports.apply = function apply() {};',
      '    exports.inject = [];',
      '    exports.__internals = { placeholder: true };',
    );
  } else {
    parts.push(
      `    var __client = __esMod[${JSON.stringify(ENTRY_MODULE)}].${FACTORY_CALL}(__seeds);`,
      '    exports.apply = __client.apply;',
      '    exports.inject = __client.inject;',
      '    exports.__internals = __client.__internals;',
    );
  }
  parts.push('    return exports;', '  },', '});', '');
  return parts.join('\n');
}


/**
 * 构建：读源码 → 打包 → 写盘 → 自检。
 * @returns {Promise<{source:string, mode:string, sorted:string[], checks:object[], failed:object[],
 *   modules:number, bytes:number, changed:boolean, onDiskMatches:boolean}>}
 */
export async function build({ write = true } = {}) {
  const pkg = JSON.parse(await readFile(PKG_FILE, 'utf8'));
  const modules = await loadModules();
  const bindingProblems = checkBindings(modules);
  if (bindingProblems.length > 0) {
    fail(`import 绑定检查失败（共 ${bindingProblems.length} 处）：\n  - ${bindingProblems.join('\n  - ')}`);
  }
  const { source, sorted, mode } = buildArtifactText({ pkgName: pkg.name, modules });

  let previous = null;
  try {
    previous = await readFile(OUT_FILE, 'utf8');
  } catch {
    previous = null;
  }
  // ★ **原子写**：先写同目录 `.tmp-<pid>`，再 rename 到 `lib/client.js`。
  //   `writeFile(OUT_FILE, …)` 的**原地重写**（先截断后写）会让重建窗口期内的页面加载读到
  //   半截产物 ⇒ 整页 `Failed to load plugins`（那次插件其实没坏，是写盘方式造的假故障）。
  //   rename 是单步原子操作 ⇒ 目标路径上只可能是「旧产物」或「新产物」，没有中间态。
  const writeSteps = [];
  if (write) {
    await writeFileAtomic(OUT_FILE, source, { onStep: (step) => writeSteps.push(step) });
  }
  let onDisk = null;
  try {
    onDisk = await readFile(OUT_FILE, 'utf8');
  } catch {
    onDisk = null;
  }

  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  const syntax = syntaxCheck(OUT_FILE);
  check('node --check（classic script 语法）', syntax.ok, syntax.message || 'ok');
  check('产物无顶层 import/export 语法', !/^\s*(import|export)\s/m.test(source), 'ok');
  const loadCalls = (source.match(/^window\.__ModuleLoader__\.load\(\{/gm) ?? []).length;
  check('产物只调用一次 __ModuleLoader__.load（顶层语句级）', loadCalls === 1, `× ${loadCalls}`);
  check('产物未内联 react（无 react 运行时特征）', !/react\.development|Symbol\.for\('react/.test(source), 'ok');
  check('白名单全部是全名（无简写 cordis / primitives / store …）', ALLOWED_REQUIRES.every(isFullSeedName), ALLOWED_REQUIRES.join('、'));
  const staticRequires = (source.match(/= require\(/g) ?? []).length;
  check(
    `产物静态 require 调用次数 === 种子声明数（${SEED_DECLARATIONS.length}）`,
    staticRequires === SEED_DECLARATIONS.length,
    `× ${staticRequires}`,
  );
  check('产物已写入 lib/client.js（逐字节 = 本次打包结果）', onDisk === source, onDisk === null ? '读不到产物' : `${Buffer.byteLength(onDisk, 'utf8')} 字节`);
  const again = buildArtifactText({ pkgName: pkg.name, modules: await loadModules() }).source;
  check(
    '可重复构建：两次独立打包逐字节相同（确定性，无时间戳 / 无随机值）',
    again === source,
    `旧产物=${previous === null ? '（无）' : `${Buffer.byteLength(previous, 'utf8')} 字节`} 本次=${Buffer.byteLength(source, 'utf8')} 字节`,
  );
  const artifact = (() => {
    // 产物不可解析（例如头注释被 `*/` 提前闭合）时，把它记成一条**失败校验**再继续跑完其余校验，
    // 而不是抛出裸错——否则 CLI 只会打印一句 "Unexpected token" 而丢掉后面所有诊断。
    try {
      return loadArtifact(source, { expectId: pkg.name, ctx: createClientCheckCtx() });
    } catch (error) {
      return {
        checks: [{ name: '产物可加载（只有 window.__ModuleLoader__ 的假环境）', ok: false, detail: String(error?.message ?? error) }],
        required: [],
        exports: null,
      };
    }
  })();
  for (const row of artifact.checks) check(`产物：${row.name}`, row.ok, row.detail);
  check(
    '产物 require 的种子 === 声明集（逐条、不重不漏）',
    sameSequence(artifact.required, ALLOWED_REQUIRES),
    artifact.required.join('、') || '（无）',
  );
  check(
    'react 恰好被 require 一次（绝不双 React）',
    artifact.required.filter((name) => name === 'react').length === 1,
    `× ${artifact.required.filter((name) => name === 'react').length}`,
  );
  for (const row of packageChecks(pkg)) check(`package.json：${row.name}`, row.ok, row.detail);

  const failed = checks.filter((row) => !row.ok);
  return {
    source,
    mode,
    sorted,
    checks,
    failed,
    modules: modules.size,
    bytes: Buffer.byteLength(source, 'utf8'),
    changed: previous !== source,
    onDiskMatches: onDisk === source,
    writeSteps, // 原子写的逐步记账（CLI 打印；自检也读它，用来证明「真的走了 rename 那条路」）
  };
}

/** 原子写的可复核摘要（CLI 打印 + 自检读同一份记账，不许各写一套）。 */
/**
 * 由已解析的模块生成**完整产物文本**（确定性：同源码 ⇒ 同字节）。
 * `modules` 为空 Map ⇒ 产出骨架占位 bundle。
 */
export function buildArtifactText({ pkgName, modules }) {
  const sorted = sortModules(modules);
  const mode = modules.size === 0 ? 'placeholder' : 'modules';
  return { source: renderBundle({ pkgName, sorted, modules, header: bundleHeader({ mode, sorted, pkgName }) }), sorted, mode };
}

export function atomicSummary(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const written = list.find((step) => step.step === 'write-temp');
  const renamed = list.find((step) => step.step === 'rename');
  if (written === undefined || renamed === undefined) return '（本次没有写盘；或原子写记账缺失）';
  return `${written.tmp} → ${written.target}（rename 原子替换${renamed.fallback === true ? '；走了 .bak 退化三步' : ''}）`;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await build();
    for (const row of result.checks) {
      console.log(`[build-client] ${row.ok ? '✔' : '✗'} ${row.name}${row.detail === '' ? '' : ` —— ${row.detail}`}`);
    }
    console.log(`[build-client] 产物：lib/client.js（${result.bytes} 字节，形态=${result.mode}，模块数=${result.modules}${result.sorted.length > 0 ? `：${result.sorted.join(' ')}` : ''}）`);
    console.log(`[build-client] 种子声明 ${SEED_DECLARATIONS.length} 项｜目录层数上限 ${MAX_DIR_DEPTH}`);
    console.log(`[build-client] 原子写：${atomicSummary(result.writeSteps)}`);
    console.log(`[build-client] 本次写盘${result.changed ? '更新了产物（新产物 或 源码已变更后重建）' : '未改变字节（产物已是最新）'}`);
    if (result.failed.length > 0) {
      console.error(`[build-client] 构建失败：${result.failed.length} 项校验未通过`);
      process.exitCode = 1;
    } else {
      console.log(`[build-client] 完成：${result.checks.length} 项校验全部通过`);
    }
  } catch (error) {
    console.error(`[build-client] 构建失败：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
