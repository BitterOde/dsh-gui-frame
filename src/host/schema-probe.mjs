/**
 * schema-probe.mjs —— **取 schemastery 的「锚点解析」半区**（从 `settings.mjs` 原样搬出，行为一字未改）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【这里装什么】取 schemastery 的「锚点解析」前半段：把包名解析成**可 import 的绝对路径**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   · `schemaAnchors` —— 候选锚的发现与排序（`options.baseUrl` → `process.argv[1]` → profile 目录）；
 *   · `probeSchemaAnchors` 的**缺省解析器**与三个纯判据（`isObject` / `describeError` / `defaultResolveFrom`）。
 *
 * 后半段（`probeSchemaAnchors` / `describeSchemaAttempts` / `createLayoutSchema` / `installSettingsNamespace`）
 * 留在 `settings.mjs`：那几个函数直接落在「注册」这条链上，而 `SCHEMASTER_SPECIFIER` 的单一真源也在那边
 * （`tests/host/settings-namespace.test.mjs` 上有一条断言盯着这句）。
 *
 * 纪律（与宿主半区同款）：**只静态 import 相对路径 / `node:` 内建**；不抛；不读 `ctx.<name>`
 * （`schemaAnchors` 的 `ctx` 是签名占位，理由见 `settings.mjs` 文件头的「为什么不读 `ctx.baseUrl`」）。
 */
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** 对象判据（`null`/`undefined` 一律当「没有」——不写 `x !== null` 那种挡不住 `undefined` 的写法）。 */
export function isObject(value) {
  return value !== null && value !== undefined && (typeof value === 'object' || typeof value === 'function');
}

/** 错误 → 一行可读文本（读数只留 code/消息，不搬栈）。 */
export function describeError(error) {
  if (error === null || error === undefined) return 'unknown';
  if (typeof error.code === 'string' && error.code !== '') return error.code;
  return String(error.message ?? error);
}

/** 只认字符串锚（空串/非串一律当「缺席」）。 */
function asAnchor(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * **候选锚**（顺序＝优先级）：
 *   ① `options.baseUrl` —— **显式传入**的装载基准（平台若确实提供 baseUrl，由上层/装置传进来）；
 *   ② `process.argv[1]` —— DSH 启动入口；装机里它位于 `@deepseek-ai/dsh` 的 `node_modules` 链上；
 *   ③ **profile 目录** —— 从 `DSH_HOME` 发现（`$DSH_HOME/profiles/<第一个存在的 profile>`；拿不到就退 `$DSH_HOME`）。
 *
 * ⚠ **为什么这里不读 `ctx.baseUrl`**：宿主半区的 `ctx.<name>` 读取会被
 * `tests/unit/skeleton.test.mjs` 的**「inject 声明集合 ≡ 实际访问集合」双向等式闸**算成「访问了一个
 * 未声明的服务」（`baseUrl` 不在它的 `PLATFORM_CTX_MEMBERS` 白名单里）—— 那条闸在 `tests/unit/**`，
 * 不归本文件管，**不得越界改闸**。⇒ 平台若确实给了 baseUrl，请经 `options.baseUrl` 显式传入
 * （首个候选随之生效）；本条同时是交给下一轮真机判读的一条待办（若 `process.argv[1]` 与 profile 两条
 * 都失败，就该把 baseUrl 接上，并同步放行那条闸的白名单）。
 * 去重、去空；每个候选都带**名字**（名字进读数，真机判读时知道是哪一条命中/失败）。
 * @param {object} ctx 插件自己的 ctx（**只作签名占位**：本函数不读它的属性，理由见上）
 * @param {{baseUrl?:string, env?:object, argv?:string[], profileDir?:string}} [options]
 * @returns {Array<{name:string, anchor:string}>}
 */
export function schemaAnchors(ctx, options = {}) {
  const env = isObject(options.env) ? options.env : (typeof process !== 'undefined' && isObject(process.env) ? process.env : {});
  const argv = Array.isArray(options.argv) ? options.argv : (typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : []);
  const candidates = [];
  candidates.push({ name: 'baseUrl', anchor: asAnchor(options.baseUrl) });
  candidates.push({ name: 'process.argv[1]', anchor: asAnchor(argv[1]) });

  let profile = asAnchor(options.profileDir);
  if (profile === null) {
    const home = asAnchor(env.DSH_HOME);
    if (home !== null) {
      profile = home;
      try {
        const profilesDir = path.join(home, 'profiles');
        const first = readdirSync(profilesDir, { withFileTypes: true }).find((entry) => entry.isDirectory() || entry.isSymbolicLink());
        if (first !== undefined) profile = path.join(profilesDir, first.name);
      } catch {
        // 没有 profiles/ 目录（或读不了）⇒ 就用 DSH_HOME 本身当锚；绝不因为发现失败而抛
      }
    }
  }
  candidates.push({ name: 'profile', anchor: profile });

  const seen = new Set();
  const anchors = [];
  for (const candidate of candidates) {
    if (candidate.anchor === null || seen.has(candidate.anchor)) continue;
    seen.add(candidate.anchor);
    anchors.push(candidate);
  }
  return anchors;
}

/** 缺省解析器：`createRequire(anchor).resolve(specifier)`（锚可以是文件或目录；CJS 解析语义与 ESM 的 node_modules 走法同形）。 */
export function defaultResolveFrom(anchor, specifier) {
  return createRequire(anchor).resolve(specifier);
}
