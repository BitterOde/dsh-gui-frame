/**
 * lint.mjs —— **主题 lint（告警式）**：硬编码颜色 + token 白名单 + 解析上下文 + 动态 token（能力④）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【二分口径】本文件是「第三方一侧」的实现
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * lint 是**告警式、不阻断构建**（对象是第三方与存量插件）；`npm run check:tokens`
 * 对本包源码**以非零退出码拦下**（对象是自己）。这条二分是裁定下来的口径，可被推翻。
 * 落到代码：本文件**只产出诊断（warnings）**，任何一条都不 throw、不阻断；
 * 硬门禁在 `scripts/check-tokens.mjs` 里，且它 import 本文件的规则 —— 两处**同一份判据**，不会漂移。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【四条判据，逐条对应验收】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ① 白名单 = `FROZEN_TOKENS`（403，外壳产物声明并集），**不是** `exportInspectTokens()` 的 14 个静态种子；
 * ② 解析上下文 = 403 ∪ `PLATFORM_VARS`（24：`--dsh-*` / `--ds-*` / `--shiki-*`）——
 *    少了平台变量，亮/暗各有 25 条会被误判悬空（`--verify-frozen` 可复现这两个数字）；
 * ③ 动态 token（第三方 `register` / `overrideTokens` 产生的新名字）**只告警不拒绝**；
 * ④ 暗色：只认 `body[data-ds-dark-theme]`，且**不要求**每个 token 有暗色值（196/207）。
 *
 * ⚠ 诊断码纪律：本文件产出的四条诊断码
 * **已显式登记进 `contracts/errors.mjs` 的 `WARNING_CODES`**（并同步 L1 公开面快照）。
 * 原因：`tests/verify-surface` 的命名空间闸门对 `src/**` **全文**正则扫 `GUIF-…` 码，要求
 * 全部 ⊆ 冻结集合（注释与字符串同样算数）——把码留在模块里会让门禁变红。
 * ⇒ 任何新码都必须走「入表 + `node scripts/public-surface.mjs --write`」两步，不许静默新增。
 * 结构性的写错（比如 name 不是字符串）走 JS 原生 `TypeError`，**不发明 `GUIF-E-*`**。
 */

import {
  DARK_COVERAGE_POLICY,
  FROZEN_DARK_TOKENS,
  FROZEN_TOKENS,
  PLATFORM_NAMESPACES,
  PLATFORM_VARS,
  TOKEN_PREFIX,
  isFrozenToken,
  isGuifPrivateVar,
  isGuifPublicVar,
  isPlatformVar,
  isUnknownToken,
  isValidVarName,
} from './tokens.mjs';

/** 本模块产出的诊断码（**只告警**；不是 `contracts/errors.mjs` 的公开码）。 */
export const THEME_DIAGNOSTICS = Object.freeze({
  TOKEN_UNKNOWN: 'GUIF-W-THEME-TOKEN-UNKNOWN',
  DYNAMIC_TOKEN: 'GUIF-W-THEME-DYNAMIC-TOKEN',
  LITERAL_COLOR: 'GUIF-W-THEME-LITERAL-COLOR',
  PRIVATE_LEAK: 'GUIF-W-THEME-PRIVATE-LEAK',
});

/** 具名颜色只在这些**颜色属性**的值位置才算命中（避免把普通 `'red'` 字符串当颜色）。 */
export const NAMED_COLOR_PROPS = Object.freeze([
  'background', 'background-color', 'background-image', 'border', 'border-color', 'border-top-color',
  'border-bottom-color', 'border-left-color', 'border-right-color', 'color', 'fill', 'stroke',
  'box-shadow', 'outline', 'outline-color', 'text-decoration-color', 'caret-color', 'stop-color',
  'column-rule-color', 'accent-color',
]);

/** CSS 具名颜色表（判据顺序见 `COLOR_RULES`）。 */
export const NAMED_COLORS = Object.freeze([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen',
  'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
  'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
  'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia',
  'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen',
  'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue',
  'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

/** 具名颜色判据：`<颜色属性> : <名字>`（名字必须完整；**允许带引号** —— 组件样式常写成 JS 对象的 `color: 'red'`）。 */
function namedColorRe() {
  const props = [...NAMED_COLOR_PROPS, ...NAMED_COLOR_PROPS.map(camelCase)].join('|');
  return new RegExp(`(?:${props})\\s*:\\s*['"]?(${NAMED_COLORS.join('|')})['"]?(?![\\w-])`, 'gi');
}

/** `border-color` → `borderColor`（JS 样式对象里的写法）。 */
function camelCase(name) {
  return name.replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase());
}

/** 逐条硬编码颜色判据（`scripts/check-tokens.mjs` 与本文件**共用同一份**）。 */
export const COLOR_RULES = Object.freeze([
  { id: 'hex', label: '十六进制颜色', re: () => /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F\w-])/g },
  { id: 'rgb', label: 'rgb()/rgba() 字面量', re: () => /\brgba?\s*\(\s*[0-9.]/g },
  { id: 'hsl', label: 'hsl()/hsla() 字面量', re: () => /\bhsla?\s*\(\s*[0-9.]/g },
  { id: 'color-fn', label: 'color()/lab()/lch()/oklch() 字面量', re: () => /\b(?:color|lab|lch|oklab|oklch)\s*\(\s*[0-9a-z%]/g },
  { id: 'named', label: '具名颜色（仅颜色属性值位置）', re: namedColorRe },
]);

/** 去注释（注释里的示例色不是代码）；markdown 的 `<!-- -->` 一并去掉。 */
export function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([;,{(\[])\s*\/\/.*$/gm, '$1');
}

/** 在一段文本里找硬编码颜色 ⇒ `[{line, column, rule, label, match}]`。 */
export function scanLiteralColors(text) {
  const stripped = stripComments(text);
  const hits = [];
  for (const rule of COLOR_RULES) {
    const re = rule.re();
    let match;
    while ((match = re.exec(stripped)) !== null) {
      const before = stripped.slice(0, match.index);
      hits.push({
        line: before.split('\n').length,
        column: match.index - (before.lastIndexOf('\n') + 1) + 1,
        rule: rule.id,
        label: rule.label,
        match: match[0],
      });
    }
  }
  return hits.sort((left, right) => left.line - right.line || left.column - right.column);
}

/** 变量声明 / 引用（CSS 文本级；不解析嵌套规则）。 */
export function collectVars(text) {
  const declared = new Set();
  const referenced = new Set();
  const body = stripComments(text);
  const declRe = /(--[a-z0-9-]+)\s*:/g;
  let match;
  while ((match = declRe.exec(body)) !== null) declared.add(match[1]);
  const refRe = /var\(\s*(--[a-z0-9-]+)/g;
  while ((match = refRe.exec(body)) !== null) referenced.add(match[1]);
  return { declared, referenced };
}

/**
 * 建一个**解析上下文**：403 白名单 ∪ 平台变量(24) ∪ 调用方登记的动态名字。
 * @param {{dynamic?:Iterable<string>|null, platform?:boolean}} [options] `platform:false` 只为**反假绿**
 *   用例存在（证明"少了平台变量会误报 25 条"这件事在本实现里真的成立）。
 */
export function createTokenContext(options = {}) {
  const platform = options.platform !== false;
  const dynamic = new Set(options.dynamic ?? []);
  return {
    dynamic,
    platform,
    has(name) {
      if (isFrozenToken(name)) return true;
      if (platform && isPlatformVar(name)) return true;
      return dynamic.has(name);
    },
    isDynamic(name) {
      return dynamic.has(name);
    },
    unknown(name) {
      return isUnknownToken(name, dynamic) && !(platform && isPlatformVar(name));
    },
  };
}

/** 造一条诊断（**只记录不阻断**；与 `contracts/errors.mjs` 的 `formatDiagnostic` 同形）。 */
export function diagnostic(code, message, details) {
  return { code, message, details: details === undefined ? null : details };
}

/**
 * lint 一段样式或组件源码。
 * @param {string} text CSS / 样式片段（组件源码也行：`var(--…)` 与 `: value` 都能扫）
 * @param {{context?:object, source?:string, allowDynamic?:boolean}} [options]
 * @returns {{ok:boolean, warnings:Array<object>, unknown:string[], dynamic:string[], literals:Array<object>,
 *   platformUsed:string[], stats:object}}
 */
export function lintTokenUsage(text, options = {}) {
  const context = options.context ?? createTokenContext();
  const source = options.source ?? '<inline>';
  const warnings = [];
  const { declared, referenced } = collectVars(text);
  const names = new Set([...declared, ...referenced]);
  const unknown = [];
  const dynamicNames = [];
  const platformUsed = [];

  for (const name of [...names].sort()) {
    if (name.startsWith(TOKEN_PREFIX)) {
      if (isFrozenToken(name)) continue;
      if (context.platform !== false && isPlatformVar(name)) {
        // 平台变量被 `--dsw-*` 前缀判定？不会 —— 这里只是留出显式分支，保证顺序可读。
        platformUsed.push(name);
        continue;
      }
      if (context.isDynamic(name)) {
        // 已登记的动态名：**lint 阶段不再告警**——"只告警不拒绝"的告警发生在**登记那一刻**
        // （`theme.register` / `theme.overrideTokens`），此后它就是已知名。
        // 否则第三方每渲染一次样式就刷一条同样的告警，等于把告警变成噪音。
        dynamicNames.push(name);
        continue;
      }
      unknown.push(name);
      warnings.push(diagnostic(
        THEME_DIAGNOSTICS.TOKEN_UNKNOWN,
        `${source}：${name} 不在外壳 token 白名单（403 条）里，也不是平台变量（${PLATFORM_NAMESPACES.join(' / ')} 共 ${PLATFORM_VARS.length} 个）`,
        { name, source },
      ));
      continue;
    }
    if (context.platform !== false && isPlatformVar(name)) {
      platformUsed.push(name);
      continue;
    }
    if (isGuifPrivateVar(name)) {
      warnings.push(diagnostic(
        THEME_DIAGNOSTICS.PRIVATE_LEAK,
        `${source}：${name} 是私有变量（--guif-private-*）；公开样式只应引用 --guif-* 与 --dsw-*`,
        { name, source },
      ));
      continue;
    }
    if (!isGuifPublicVar(name)) {
      unknown.push(name);
      warnings.push(diagnostic(
        THEME_DIAGNOSTICS.TOKEN_UNKNOWN,
        `${source}：${name} 既不是 --dsw-*、也不是 --guif-* / --guif-private-*`,
        { name, source },
      ));
    }
  }

  const literals = scanLiteralColors(text);
  for (const hit of literals) {
    warnings.push(diagnostic(
      THEME_DIAGNOSTICS.LITERAL_COLOR,
      `${source}:${hit.line}:${hit.column} 硬编码颜色「${hit.match}」（${hit.label}）—— 组件样式只走 var(--dsw-*) / var(--guif-*)`,
      { ...hit, source },
    ));
  }

  return {
    ok: warnings.length === 0,
    warnings,
    unknown,
    dynamic: dynamicNames,
    literals,
    platformUsed: [...new Set(platformUsed)].sort(),
    stats: { declared: declared.size, referenced: referenced.size, checked: names.size, literals: literals.length },
  };
}

/**
 * 暗色覆盖报告：**是报告不是门禁**（196 覆盖 / 207 继承，`requireAll: false`）。
 * 无论覆盖面多小，本函数都不产生"缺暗色值"类诊断 —— 这是 item 10 的口径。
 */
export function darkCoverage(extra) {
  const extraNames = [...(extra ?? [])];
  return {
    policy: DARK_COVERAGE_POLICY,
    covered: FROZEN_DARK_TOKENS.length,
    inherited: FROZEN_TOKENS.length - FROZEN_DARK_TOKENS.length,
    extra: extraNames.length,
    requireAll: DARK_COVERAGE_POLICY.requireAll,
    warnings: [],
  };
}

/** 校验一个变量名（结构性写错 ⇒ 抛 `TypeError`，不发明新错误码）；判据与 tokens.mjs **同一份**。 */
export function assertVarName(name, who) {
  if (typeof name !== 'string' || !isValidVarName(name)) {
    throw new TypeError(`${who} 需要形如 --foo-bar 的变量名（收到 ${typeof name} ${String(name)}）`);
  }
  return name;
}

/** 把一个 token 名包成 `var(...)`；名字非法 ⇒ 抛（结构性误用，不用信封）。 */
export function tokenRef(name) {
  assertVarName(name, 'tokenRef(name)');
  return `var(${name})`;
}
