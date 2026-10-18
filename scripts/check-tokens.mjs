/**
 * check-tokens.mjs —— **主题 token 门禁**：硬编码颜色扫描 + 冻结白名单校验（白名单口径来自探针 P4 实测）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【二分口径】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 「lint 是告警式、不阻断构建」与「`npm run check:tokens` 要以非零退出码报错」两条要求并存。
 * 两者同时成立的唯一读法是**对象二分**，本脚本把它落成**三个面**（同一次扫描里同时报告）：
 *   - **硬门禁面**：`src/**` / `scripts/**` / `lib/**` / 包根清单 —— 命中 ⇒ **exit 1**。
 *     这里是"组件样式只走 token"真正适用的地方（组件样式与构建器）。
 *   - **夹具与记录面**：`tests/**` / `probe/**` / `docs/**` —— 命中 ⇒ **只告警**。
 *     理由是这些文件**天然含颜色**：单测夹具要故意写死颜色来证明扫描器抓得到、探针记录要抄现场样式；
 *     把它们计进硬门禁等于要求"测试不许有反例"，那是自相矛盾。命中照旧逐条打印、计数、进 `--json`。
 *   - **第三方面**：`--advisory <dir>` —— 存量插件 / 别人的包，命中 ⇒ **只告警**、**exit 0**，绝不阻断他人构建。
 * 例外通道：文件内一行 `check-tokens:allow-hardcoded-color: <至少 8 字的理由>` 可豁免（无理由不算），
 * 豁免仍会被计数打印（豁免 ≠ 看不见）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【白名单口径】—— 探针 P4 实测，本脚本可**重演**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 白名单 = `dsh-client-ui-theme/lib/client.js` 行内 CSS 里**声明**的 `--dsw-*` 并集（0.2.0-rc.2 实测 **403**），
 * 而不是 `exportInspectTokens()` 的静态种子 —— 后者运行期还会叠加「已注册主题 + 覆盖层」，
 * 拿它当白名单会把大部分合法 token 判成未知。
 * 解析上下文还必须带**平台变量**（`--ds-*` 5 / `--dsh-*` 8 / `--shiki-*` 11 = 24 个）：
 * 只用 `--dsw-*` 表自洽 ⇒ 亮/暗各有 **25 条**悬空（19 条引用 `--dsh-content-font-delta`、
 * 6 条引用 `--ds-font-family-code`）；纳入平台变量后 ⇒ **0 条悬空**。两条数字本脚本都实测。
 *
 * 用法：
 *   node scripts/check-tokens.mjs                      # 本包全树硬门禁（默认；命中 ⇒ exit 1）
 *   node scripts/check-tokens.mjs --advisory <dir>     # 第三方/存量插件：只告警，exit 0（不阻断）
 *   node scripts/check-tokens.mjs --verify-frozen      # 重算外壳 token 集合并与冻结件比对 + 解析力报告
 *   node scripts/check-tokens.mjs --write-frozen       # 重新生成 src/client/theme/tokens-data.mjs
 *   node scripts/check-tokens.mjs --json               # 机器可读输出（验收留证用）
 *   node scripts/check-tokens.mjs --scope=all          # 连 docs/ 与 probe/ 一起扫（默认只扫代码树）
 *
 * 退出码：0 = 通过（或仅告警）｜1 = 硬门禁未过｜2 = 用法错误。
 *
 * 本脚本零外部依赖（`dependencies` 恒为空）：只用 node 内置模块 + 本包源码里的冻结数据。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 颜色判据与文本扫描**只有一份实现**（`src/client/theme/lint.mjs`）：
// 本脚本是"硬门禁面"、产品里的运行期 lint 是"夹具 / 第三方面"，两侧共用同一套规则 ——
// 复制一份必然漂移（本文件早期版本就漂过：具名颜色规则没跟上 camelCase 与引号写法）。
import { COLOR_RULES, NAMED_COLORS, scanLiteralColors, stripComments } from '../src/client/theme/lint.mjs';

/** 判据与扫描函数的再导出（测试与下游复核从这里取，不必知道实现在哪）。 */
export const HARDCODED_COLOR_RULES = COLOR_RULES;
export const HARDCODED_COLOR_NAMES = NAMED_COLORS;
export const scanHardcodedColors = scanLiteralColors;
export const stripCodeComments = stripComments;

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 包根：`dsh-gui-frame/`。 */
export const PKG_DIR = path.resolve(HERE, '..');
/** 冻结数据文件（白名单真源；由 `--write-frozen` 生成）。 */
export const FROZEN_FILE = path.join(PKG_DIR, 'src', 'client', 'theme', 'tokens-data.mjs');
/** 客户端主题产物（token 的声明 owner；探针 P4 实测全树唯一）。 */
export const THEME_BUNDLE_REL = path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');

/** 默认扫描**不**递归进去的目录（生成物/依赖/团队状态）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.agent-teams']);
/** 认作「代码」的扩展名（默认 scope=code）；`--scope=all` 时连 md/json 一起扫。 */
const CODE_EXT = new Set(['.mjs', '.js', '.cjs', '.css']);
const ALL_EXT = new Set([...CODE_EXT, '.md', '.json', '.yml', '.yaml', '.html']);

/**
 * 扫描工具自己的豁免标记：**必须是"注释开头 + 整行标记 + 理由"**，且理由 ≥ 8 字。
 * 为什么这么严：早期版本用"全文匹配"实现，结果**文档里提到这行标记的正文**也会把整个文件豁免掉，
 * 理由还印错。
 * 现在只有"`// check-tokens:allow-hardcoded-color: 理由`"或"`/* check-tokens:allow-hardcoded-color: 理由 *\/`"
 * 这种**行首注释形态**才算数 —— 描述机制的正文里出现同样的字串不再生效。
 */
const ALLOW_MARKER_LINE = /^[ \t]*(?:\/\/|\/\*|\*|#)[ \t]*check-tokens:allow-hardcoded-color[ \t]*[:：][ \t]*(.{8,}?)[ \t]*(?:\*\/)?[ \t]*$/m;

/** 取文件里的豁免理由（没有则 null）。 */
export function allowanceReasonOf(text) {
  const matched = ALLOW_MARKER_LINE.exec(text);
  return matched === null ? null : matched[1].trim();
}

/** 构建失败 / 用法错误（CLI 捕获后置退出码：用法错 = 2，硬门禁未过 = 1）。 */
export class CheckError extends Error {}

/**
 * **夹具与记录面**：这些目录下的命中只告警（它们是"故意写死的反例"与现场抄录，不是发布出去的样式）。
 * 硬门禁面 = 其余全部（`src/**` / `scripts/**` / `lib/**` / 包根清单）。
 */
export const FIXTURE_PREFIXES = Object.freeze(['tests/', 'probe/', 'docs/']);

/** 某个相对路径属于哪个面（gate = 硬门禁 / fixture = 只告警）。 */
export function faceOf(relPath) {
  return FIXTURE_PREFIXES.some((prefix) => relPath.startsWith(prefix)) ? 'fixture' : 'gate';
}


/**
 * 扫描一棵树。
 * @param {{root?:string, scope?:'code'|'all', ignore?:string[]}} [options]
 * @returns {{root:string, scope:string, files:string[], findings:Array<object>, skippedDirs:string[]}}
 */
export function scanTree(options = {}) {
  const root = options.root ?? PKG_DIR;
  const scope = options.scope ?? 'code';
  const ext = scope === 'all' ? ALL_EXT : CODE_EXT;
  const ignore = new Set(options.ignore ?? []);
  const files = [];
  const findings = [];
  const skippedDirs = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || ignore.has(relPath)) {
          skippedDirs.push(relPath);
          continue;
        }
        walk(abs, relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!ext.has(path.extname(entry.name).toLowerCase())) continue;
      const text = readFileSync(abs, 'utf8');
      files.push(relPath);
      const allowance = allowanceReasonOf(text);
      for (const hit of scanLiteralColors(text)) {
        findings.push({
          file: relPath,
          face: faceOf(relPath),
          ...hit,
          allowed: allowance !== null,
          allowanceReason: allowance,
        });
      }
    }
  };
  walk(root, '');
  return { root, scope, files, findings, skippedDirs: skippedDirs.sort() };
}

/** 默认的 DSH 安装根（与外壳 token 探针同一处；找不到就跳过需要它的检查，不报错）。 */
export function resolveDshRoot(explicit) {
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  if (typeof process.env.DSH_ROOT === 'string' && process.env.DSH_ROOT !== '') return process.env.DSH_ROOT;
  const appData = process.env.APPDATA;
  const candidates = [
    typeof appData === 'string' && appData !== '' ? path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh') : null,
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh'),
  ].filter((candidate) => candidate !== null && candidate !== '');
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

/** JS 字符串字面量反转义（产物里存在 `\d`/`\s` 这类「对 JSON 非法、对 JS 合法」的转义）。 */
function unescapeJsString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (whole, esc) => {
    if (esc[0] === 'u') return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc[0] === 'x') return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc === 'n') return '\n';
    if (esc === 't') return '\t';
    if (esc === 'r') return '\r';
    if (esc === 'b') return '\b';
    if (esc === 'f') return '\f';
    if (esc === 'v') return '\v';
    if (esc === '0') return '\0';
    return esc;
  });
}

/** 取产物里所有 `var NAME = "行内 CSS";` 绑定（rolldown 的 inline-css 形态）。 */
function inlineCssBindings(text) {
  const re = /var ([A-Za-z0-9_$]+) = "((?:[^"\\]|\\.)*)";/g;
  const out = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    if (!match[2].includes('--')) continue;
    out.push({ binding: match[1], offset: match.index, css: unescapeJsString(match[2]) });
  }
  return out;
}

/** 取出一段声明体里的全部自定义属性。 */
function parseAllVars(body) {
  const out = {};
  for (const decl of body.split(';')) {
    const at = decl.indexOf(':');
    if (at <= 0) continue;
    const name = decl.slice(0, at).trim();
    if (name.startsWith('--')) out[name] = decl.slice(at + 1).trim();
  }
  return out;
}

const BAD_STATUS = new Set(['unresolved-ref', 'missing-token', 'cycle']);

/**
 * 静态解析：值里每个 `var()` 能否在表里落地（探针 P4 的 E/F 两段同法，可重演）。
 * @returns {{summary:object, unresolved:string[]}}
 */
export function resolveTable(names, table, baseTable) {
  const merged = { ...(baseTable ?? {}), ...table };
  const resolveValue = (name, seen) => {
    if (seen.has(name)) return 'cycle';
    seen.add(name);
    const value = merged[name];
    if (value === undefined) return 'missing-token';
    let broken = false;
    let usedFallback = false;
    const re = /var\(\s*(--[a-z0-9-]+)\s*(,[^()]*)?\)/g;
    let match;
    while ((match = re.exec(value)) !== null) {
      if (merged[match[1]] !== undefined) {
        if (BAD_STATUS.has(resolveValue(match[1], seen))) broken = true;
      } else if (match[2] === undefined) broken = true;
      else usedFallback = true;
    }
    seen.delete(name);
    if (broken) return 'unresolved-ref';
    if (!value.includes('var(')) return 'literal';
    return usedFallback ? 'resolved-with-fallback' : 'resolved-chain';
  };
  const summary = {};
  const unresolved = [];
  for (const name of names) {
    const status = resolveValue(name, new Set());
    summary[status] = (summary[status] ?? 0) + 1;
    if (BAD_STATUS.has(status)) unresolved.push(name);
  }
  return { summary, unresolved };
}

/**
 * **重算**外壳产物里的 token 事实（探针 P4 的方法学，逐段可复演）。
 * @param {{dshRoot?:string|null}} [options]
 * @returns {{ok:true, source:string, sha256:string, bytes:number, bindings:number, tokens:string[],
 *   darkTokens:string[], lightTokens:string[], platformVars:object, light:object, dark:object,
 *   lightWithPlatform:object, darkWithPlatform:object}
 *   | {ok:false, reason:string, source:string|null}}
 */
export function extractTokenFacts(options = {}) {
  const dshRoot = resolveDshRoot(options.dshRoot);
  if (dshRoot === null) return { ok: false, reason: '找不到本机 DSH 安装（可用 DSH_ROOT 或 --dsh-root 指定）', source: null };
  const source = path.join(dshRoot, THEME_BUNDLE_REL);
  if (!existsSync(source)) return { ok: false, reason: `外壳主题产物不在：${source}`, source };
  const text = readFileSync(source, 'utf8');
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  const union = new Map();
  const darkOnly = new Map();
  const platform = new Map();
  let bindings = 0;
  for (const binding of inlineCssBindings(text)) {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let block;
    let used = false;
    while ((block = re.exec(binding.css)) !== null) {
      const isDark = block[1].includes('data-ds-dark-theme');
      const vars = parseAllVars(block[2]);
      for (const [name, value] of Object.entries(vars)) {
        if (!name.startsWith('--dsw-')) {
          if (!isDark) platform.set(name, value);
          continue;
        }
        used = true;
        if (isDark) {
          darkOnly.set(name, value);
          if (!union.has(name)) union.set(name, undefined); // 暗色独有（P4 实测为 0 条）也进白名单
        } else if (!union.has(name)) {
          union.set(name, value);
        }
      }
    }
    if (used) bindings += 1;
  }
  const tokens = [...union.keys()].sort();
  const lightTable = Object.fromEntries([...union].filter(([, value]) => value !== undefined));
  const darkTable = Object.fromEntries(darkOnly);
  const darkTokens = Object.keys(darkTable).sort();
  const platformTable = Object.fromEntries(platform);
  return {
    ok: true,
    source,
    sha256,
    bytes: Buffer.byteLength(text, 'utf8'),
    bindings,
    tokens,
    lightTokens: Object.keys(lightTable).sort(),
    darkTokens,
    platformVars: {
      count: Object.keys(platformTable).length,
      names: Object.keys(platformTable).sort(),
      byNamespace: countNamespaces(Object.keys(platformTable)),
    },
    light: resolveTable(tokens, lightTable),
    dark: resolveTable(tokens, { ...lightTable, ...darkTable }),
    lightWithPlatform: resolveTable(tokens, lightTable, platformTable),
    darkWithPlatform: resolveTable(tokens, { ...lightTable, ...darkTable }, platformTable),
  };
}

/** 平台变量命名空间计数（--ds-* / --dsh-* / --shiki-*）。 */
export function countNamespaces(names) {
  const out = {};
  for (const name of names) {
    const ns = name.startsWith('--dsh-') ? '--dsh-*' : name.startsWith('--ds-') ? '--ds-*' : name.startsWith('--shiki-') ? '--shiki-*' : 'other';
    out[ns] = (out[ns] ?? 0) + 1;
  }
  return out;
}

/**
 * 冻结件 vs 实测：逐条比对（token 集合、暗色集合、平台变量集合）。
 * @returns {{ok:boolean, problems:string[], frozen:object, live:object}}
 */
export function verifyFrozen(frozen, facts) {
  const problems = [];
  if (!facts.ok) return { ok: false, problems: [facts.reason], frozen: summaryOf(frozen), live: null };
  const same = (label, expected, actual) => {
    if (expected.length !== actual.length) problems.push(`${label}条数不符：冻结 ${expected.length} / 实测 ${actual.length}`);
    const missing = actual.filter((name) => !expected.includes(name));
    const extra = expected.filter((name) => !actual.includes(name));
    if (missing.length > 0) problems.push(`${label}冻结件缺 ${missing.length} 条（如 ${missing.slice(0, 3).join('、')}）`);
    if (extra.length > 0) problems.push(`${label}冻结件多 ${extra.length} 条（如 ${extra.slice(0, 3).join('、')}）`);
  };
  same('--dsw-* 白名单', frozen.tokens, facts.tokens);
  same('暗色覆盖集', frozen.darkTokens, facts.darkTokens);
  same('平台变量集', frozen.platformVars, facts.platformVars.names);
  return { ok: problems.length === 0, problems, frozen: summaryOf(frozen), live: summaryOf(facts) };
}

/** 一段可打印的摘要（CLI 与 `--json` 共用；冻结件与实测两侧都能喂进来）。 */
export function summaryOf(facts) {
  if (facts === null || facts === undefined) return null;
  const platformVars = Array.isArray(facts.platformVars)
    ? facts.platformVars.length
    : (facts.platformVars?.names?.length ?? facts.platformVars?.count ?? 0);
  return {
    tokens: facts.tokens?.length ?? 0,
    darkTokens: facts.darkTokens?.length ?? 0,
    platformVars,
    sha256: facts.sha256 ?? null,
    unresolvedLight: facts.light?.unresolved?.length ?? null,
    unresolvedDark: facts.dark?.unresolved?.length ?? null,
    unresolvedLightWithPlatform: facts.lightWithPlatform?.unresolved?.length ?? null,
  };
}

/** 渲染 `tokens-data.mjs` 全文（确定性：同实测 ⇒ 同字节）。 */
export function renderFrozenModule(facts, meta = {}) {
  const header = `/**
 * tokens-data.mjs —— **主题 token 冻结件**（白名单真源；由 \`scripts/check-tokens.mjs --write-frozen\` 生成）。
 *
 * ⚠ **请勿手改**：手改会被 \`node scripts/check-tokens.mjs --verify-frozen\` 抓出来（重算实测逐条比对）。
 *
 * 口径（探针 P4 实测标尺）：
 *   - \`FROZEN_TOKENS\` = 外壳 \`dsh-client-ui-theme/lib/client.js\` 行内 CSS 里**声明**的 \`--dsw-*\` 并集；
 *   - \`FROZEN_DARK_TOKENS\` = 其中在 \`[data-ds-dark-theme]\` 段**另有暗色值**的那些（其余**继承亮色**，
 *     因此 lint 不得要求每个 token 都有暗色值）；
 *   - \`PLATFORM_VARS\` = 同一批样式表里的平台级变量（\`--ds-*\` / \`--dsh-*\` / \`--shiki-*\`）——
 *     它们是 lint 的**解析上下文**而不是白名单：少了它们，冻结白名单里亮/暗各有 25 条会被误判悬空。
 *   - **不用** \`exportInspectTokens()\` 的静态种子当白名单（它运行期还会叠加"已注册主题 + 覆盖层"，
 *     拿它当白名单会把大部分合法 token 判成未知；它只作**说明层**，见 \`tokens.mjs\` 的 INSPECT_SEED 注释）。
 *
 * 实测来源：本机 DSH 安装目录下的 \`@@SOURCE_REL@@\`
 * 产物 SHA-256：\`@@SHA256@@\`（${facts.bytes} 字节；行内 CSS 绑定 ${facts.bindings} 段）
 * 实测时间：@@GENERATED@@｜生成命令：\`node scripts/check-tokens.mjs --write-frozen\`
 */

/** 数据来源与指纹（\`--verify-frozen\` 用它判断"冻结件是哪一版实测"）。 */
export const FROZEN_PROVENANCE = Object.freeze({
  package: 'dsh-client-ui-theme',
  file: 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
  sha256: '${facts.sha256}',
  bytes: ${facts.bytes},
  cssBindings: ${facts.bindings},
  platform: '${meta.platform ?? 'windows'}',
  generatedAt: '${meta.generatedAt ?? new Date().toISOString()}',
});

/** \`--dsw-*\` 白名单：**${facts.tokens.length}** 条（排序；与实测逐条相等）。 */
export const FROZEN_TOKENS = Object.freeze([
${facts.tokens.map((name) => `  '${name}',`).join('\n')}
]);

/** 暗色**另有值**的 token：**${facts.darkTokens.length}** 条（其余 ${facts.tokens.length - facts.darkTokens.length} 条继承亮色 —— 非缺陷）。 */
export const FROZEN_DARK_TOKENS = Object.freeze([
${facts.darkTokens.map((name) => `  '${name}',`).join('\n')}
]);

/** 平台变量（解析上下文，**不是**白名单成员）：${facts.platformVars.names.length} 个。 */
export const PLATFORM_VARS = Object.freeze([
${facts.platformVars.names.map((name) => `  '${name}',`).join('\n')}
]);
`;
  return header.replace('@@SOURCE_REL@@', THEME_BUNDLE_REL.split(path.sep).join('/')).replace('@@SHA256@@', facts.sha256).replace('@@GENERATED@@', meta.generatedAt ?? new Date().toISOString());
}

/** 读冻结件（不存在 ⇒ null；`assert` 由调用方决定要不要报错）。 */
export async function loadFrozen() {
  if (!existsSync(FROZEN_FILE)) return null;
  const module = await import(`${pathToFileUrl(FROZEN_FILE)}?t=${statSync(FROZEN_FILE).mtimeMs}`);
  return {
    tokens: [...module.FROZEN_TOKENS],
    darkTokens: [...module.FROZEN_DARK_TOKENS],
    platformVars: [...module.PLATFORM_VARS],
    provenance: module.FROZEN_PROVENANCE,
    file: FROZEN_FILE,
  };
}

function pathToFileUrl(file) {
  return `file:///${file.replace(/\\/g, '/')}`;
}

/** 解析 CLI 参数。 */
export function parseArgs(argv) {
  const options = { mode: 'scan', scope: 'code', json: false, advisory: null, dshRoot: null, root: null, report: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--advisory') {
      options.mode = 'advisory';
      options.advisory = argv[index + 1] ?? null;
      index += 1;
      if (options.advisory === null || options.advisory.startsWith('--')) throw new CheckError('--advisory 需要一个目录参数');
    } else if (arg === '--verify-frozen') options.mode = 'verify-frozen';
    else if (arg === '--write-frozen') options.mode = 'write-frozen';
    else if (arg === '--report') options.report = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--dsh-root') {
      options.dshRoot = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--root') {
      // 扫别的树（主要给单测用：证明"本包硬门禁 exit 1 / 第三方只告警 exit 0"的二分是真的）
      options.root = argv[index + 1] ?? null;
      index += 1;
      if (options.root === null || options.root.startsWith('--')) throw new CheckError('--root 需要一个目录参数');
    } else if (arg.startsWith('--scope=')) {
      const scope = arg.slice('--scope='.length);
      if (scope !== 'code' && scope !== 'all') throw new CheckError(`--scope 只支持 code / all（收到 ${scope}）`);
      options.scope = scope;
    } else if (arg === '--help' || arg === '-h') options.mode = 'help';
    else throw new CheckError(`未知参数：${arg}`);
  }
  return options;
}

/** 该条命中在本次运行里是否**应当拦住**（决定退出码）。 */
export function blocksExit(hit, advisory) {
  if (advisory) return false; // 第三方面：只告警，绝不阻断
  if (hit.allowed) return false; // 显式豁免（带理由）
  return hit.face !== 'fixture'; // 夹具与记录面只告警
}

/** 打印扫描结果（人读），返回应当拦截的命中数。 */
function printScan(result, { advisory }) {
  console.log(`[check-tokens] 扫描 ${result.files.length} 个文件（scope=${result.scope}，跳过 ${result.skippedDirs.length} 个目录：${result.skippedDirs.join('、') || '（无）'}）`);
  if (result.findings.length === 0) {
    console.log('[check-tokens] ✔ 无硬编码颜色');
    return 0;
  }
  for (const hit of result.findings) {
    const line = `${hit.file}:${hit.line}:${hit.column} [${hit.rule}] ${hit.match}`;
    if (hit.allowed) console.log(`[check-tokens] · 已豁免（${hit.allowanceReason}）：${line}`);
    else if (advisory) console.log(`[check-tokens] ⚠ 告警（第三方，不阻断）：${line}`);
    else if (hit.face === 'fixture') console.log(`[check-tokens] ⚠ 告警（夹具/记录面，不阻断）：${line}`);
    else console.log(`[check-tokens] ✗ 失败：${line}`);
  }
  const blocking = result.findings.filter((hit) => blocksExit(hit, advisory));
  const fixture = result.findings.filter((hit) => hit.face === 'fixture' && !hit.allowed).length;
  const allowed = result.findings.filter((hit) => hit.allowed).length;
  console.log(`[check-tokens] 共 ${result.findings.length} 处命中（硬门禁 ${result.findings.length - fixture - allowed}｜夹具/记录 ${fixture}｜豁免 ${allowed}）`);
  return blocking.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return 0;
  }
  if (options.mode === 'write-frozen') {
    const facts = extractTokenFacts({ dshRoot: options.dshRoot });
    if (!facts.ok) throw new CheckError(`重算 token 实测失败：${facts.reason}`);
    const text = renderFrozenModule(facts, { platform: process.platform, generatedAt: new Date().toISOString() });
    mkdirSync(path.dirname(FROZEN_FILE), { recursive: true });
    writeFileSync(FROZEN_FILE, text, 'utf8');
    console.log(`[check-tokens] 已重写冻结件：${path.relative(PKG_DIR, FROZEN_FILE)}（--dsw-* ${facts.tokens.length} / 暗色 ${facts.darkTokens.length} / 平台变量 ${facts.platformVars.names.length}）`);
    return 0;
  }
  const frozen = await loadFrozen();
  if (options.mode === 'verify-frozen') {
    if (frozen === null) throw new CheckError(`冻结件不存在：${FROZEN_FILE}（先跑 --write-frozen）`);
    const facts = extractTokenFacts({ dshRoot: options.dshRoot });
    const verdict = verifyFrozen(frozen, facts);
    const report = { ok: verdict.ok, problems: verdict.problems, frozen: verdict.frozen, live: summaryOf(facts), resolution: facts.ok ? {
      withoutPlatform: { light: facts.light.unresolved.length, dark: facts.dark.unresolved.length },
      withPlatform: { light: facts.lightWithPlatform.unresolved.length, dark: facts.darkWithPlatform.unresolved.length },
      platformNamespaces: facts.platformVars.byNamespace,
    } : null };
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`[check-tokens] 冻结件 --dsw-* ${verdict.frozen.tokens}｜暗色 ${verdict.frozen.darkTokens}｜平台变量 ${verdict.frozen.platformVars}`);
      if (facts.ok) {
        console.log(`[check-tokens] 实测     --dsw-* ${facts.tokens.length}｜暗色 ${facts.darkTokens.length}｜平台变量 ${facts.platformVars.names.length}（产物 sha256 ${facts.sha256.slice(0, 12)}…，绑定 ${facts.bindings} 段）`);
        console.log(`[check-tokens] 解析力（只用 --dsw-* 表）：亮 ${facts.light.unresolved.length} 条悬空 / 暗 ${facts.dark.unresolved.length} 条悬空`);
        console.log(`[check-tokens] 解析力（纳入平台变量 ${facts.platformVars.names.length} 个 ${JSON.stringify(facts.platformVars.byNamespace)}）：亮 ${facts.lightWithPlatform.unresolved.length} 条悬空 / 暗 ${facts.darkWithPlatform.unresolved.length} 条悬空`);
      }
      for (const problem of verdict.problems) console.log(`[check-tokens] ✗ ${problem}`);
      if (verdict.ok) console.log('[check-tokens] ✔ 冻结件与实测逐条一致');
    }
    return verdict.ok ? 0 : 1;
  }
  const root = options.mode === 'advisory' ? path.resolve(options.advisory) : path.resolve(options.root ?? PKG_DIR);
  if (!existsSync(root)) throw new CheckError(`目录不存在：${root}`);
  const result = scanTree({ root, scope: options.scope === 'all' ? 'all' : 'code' });
  const advisory = options.mode === 'advisory';
  if (options.json) {
    const blocking = result.findings.filter((hit) => blocksExit(hit, advisory));
    console.log(JSON.stringify({ mode: options.mode, scope: options.scope, root, files: result.files.length, blocking: blocking.length, findings: result.findings }, null, 2));
    return blocking.length > 0 ? 1 : 0;
  }
  const bad = printScan(result, { advisory });
  if (bad > 0) {
    console.log('[check-tokens] 自研组件样式只走 var(--dsw-*) / var(--guif-*)；硬门禁面命中即 exit 1（D9 二分口径）。');
    console.log('[check-tokens] 夹具/记录面（tests / probe / docs）与第三方目录只告警：前者是"故意写死的反例"，后者用 --advisory <dir>。');
  }
  return bad === 0 ? 0 : 1;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[check-tokens] 用法/运行错误：${error?.message ?? error}`);
    process.exitCode = error instanceof CheckError ? 2 : 1;
  }
}
