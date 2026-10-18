// 探针 P4：主题 token 口径对齐
//
// 冲突要解的问题：「本机产物 CSS 实测 71 个 --dsw-*（44 个 alias）」vs「文档记的官方 token 总数」。
// 本探针不猜，对**同一份产物**分别数四个口径，并做静态 var() 解析：
//   A. ui-theme 客户端 bundle 的各段行内 CSS：各自声明多少 --dsw-*、并集多少、按前缀分类。
//   B. exportInspectTokens() 的静态种子（BUILTIN_INSPECT_TOKENS）：多少条、带哪些字段。
//   C. 外壳产物 CSS（dsh-web-frontend/dist/assets/*.css）：声明多少 / 引用多少 / alias 各多少
//      —— 用来对账「71 个（44 alias）」到底数的是哪一层。
//   D. 全安装树里所有 client bundle 的 CSS 声明并集：token 的 owner 是谁、谁只是引用。
//   E. 静态解析：每个 token 的 var() 引用能否全部落地（亮/暗两套表），列出暗色悬空项。
// 只读：不写 profile、不监听端口、不碰正在跑的 GUI。
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallDir } from './platform.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dshRoot = resolveDshInstallDir()
const pkgRoot = join(dshRoot, 'node_modules', '@deepseek-ai')
const themeBundlePath = join(pkgRoot, 'dsh-client-ui-theme', 'lib', 'client.js')
const frontendDist = join(pkgRoot, 'dsh-web-frontend', 'dist', 'assets')

const PREFIXES = ['alias', 'static', 'specific', 'elevation', 'shadow', 'font', 'linear', 'mask', 'corner']
const prefixOf = (name) => {
  const rest = name.slice('--dsw-'.length)
  return PREFIXES.find((p) => rest.startsWith(p + '-')) ?? rest.split('-')[0]
}
const countByPrefix = (names) => {
  const out = {}
  for (const name of names) out[prefixOf(name)] = (out[prefixOf(name)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

/**
 * 拆 CSS 为（选择器 → --dsw-* 声明表）。本产物无嵌套规则。
 * `rawBody` 保留原始声明串，供平台级变量（--ds-* / --dsh-*）的解析上下文使用。
 */
function parseBlocks(css) {
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = re.exec(css)) !== null) {
    const decls = {}
    for (const decl of match[2].split(';')) {
      const at = decl.indexOf(':')
      if (at <= 0) continue
      const name = decl.slice(0, at).trim()
      if (name.startsWith('--dsw-')) decls[name] = decl.slice(at + 1).trim()
    }
    blocks.push({ selector: match[1].trim(), decls, rawBody: match[2] })
  }
  return blocks
}

/** 取出一段声明体里所有自定义属性（任意 --* 前缀）。 */
function parseAllVars(body) {
  const out = {}
  for (const decl of body.split(';')) {
    const at = decl.indexOf(':')
    if (at <= 0) continue
    const name = decl.slice(0, at).trim()
    if (name.startsWith('--')) out[name] = decl.slice(at + 1).trim()
  }
  return out
}

/**
 * 解码 JS 字符串字面量的转义（不用 JSON.parse：产物里存在 `\d`/`\s` 这类
 * 对 JSON 非法、对 JS 合法的转义，JSON.parse 会直接抛）。
 */
function unescapeJsString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (whole, esc) => {
    if (esc[0] === 'u') return String.fromCharCode(Number.parseInt(esc.slice(1), 16))
    if (esc[0] === 'x') return String.fromCharCode(Number.parseInt(esc.slice(1), 16))
    if (esc === 'n') return '\n'
    if (esc === 't') return '\t'
    if (esc === 'r') return '\r'
    if (esc === 'b') return '\b'
    if (esc === 'f') return '\f'
    if (esc === 'v') return '\v'
    if (esc === '0') return '\0'
    return esc
  })
}

/** 取出产物里所有 `var NAME = "行内 CSS";` 绑定（rolldown 的 inline-css 形态）。 */
function inlineCssBindings(text) {
  const re = /var ([A-Za-z0-9_$]+) = "((?:[^"\\]|\\.)*)";/g
  const out = []
  let match
  while ((match = re.exec(text)) !== null) {
    if (!match[2].includes('--dsw-')) continue
    out.push({ binding: match[1], offset: match.index, css: unescapeJsString(match[2]) })
  }
  return out
}

// ── A + B：ui-theme bundle ────────────────────────────────────────────────
const themeText = readFileSync(themeBundlePath, 'utf8')
const bindings = inlineCssBindings(themeText)
const bindingRows = []
const lightDecls = {}
const darkDecls = {}
const lightAllVars = {}
const darkAllVars = {}
const union = new Set()
for (const binding of bindings) {
  const names = new Set()
  for (const block of parseBlocks(binding.css)) {
    for (const [name, value] of Object.entries(block.decls)) {
      names.add(name)
      union.add(name)
      if (block.selector.includes('data-ds-dark-theme')) darkDecls[name] = value
      else lightDecls[name] = value
    }
    // 平台级变量（--ds-* / --dsh-* 等）不进 --dsw-* 白名单，但**是解析上下文的一部分**：
    // 少了它们，25 个官方排版 token 会被误判成悬空。
    for (const [name, value] of Object.entries(parseAllVars(block.rawBody))) {
      if (block.selector.includes('data-ds-dark-theme')) darkAllVars[name] = value
      else lightAllVars[name] = value
    }
  }
  if (names.size > 0) bindingRows.push({ binding: binding.binding, offset: binding.offset, cssLength: binding.css.length, tokens: names.size })
}
const inspectAnchor = themeText.indexOf('const BUILTIN_INSPECT_TOKENS = Object.freeze(')
const arrayStart = themeText.indexOf('[', inspectAnchor)
let depth = 0
let arrayEnd = -1
for (let i = arrayStart; i < themeText.length; i += 1) {
  if (themeText[i] === '[') depth += 1
  else if (themeText[i] === ']' && --depth === 0) {
    arrayEnd = i
    break
  }
}
const inspectTokens = new Function(`return ${themeText.slice(arrayStart, arrayEnd + 1)}`)()
const inspectNames = inspectTokens.map((token) => token.name)

// ── C：外壳产物 CSS ───────────────────────────────────────────────────────
function scanCssText(css) {
  const declared = new Set()
  const referenced = new Set()
  for (const block of parseBlocks(css)) for (const name of Object.keys(block.decls)) declared.add(name)
  const refRe = /var\(\s*(--[a-z0-9-]+)/g
  let match
  while ((match = refRe.exec(css)) !== null) referenced.add(match[1])
  return { declared, referenced }
}
const shellCssFiles = readdirSync(frontendDist).filter((name) => name.endsWith('.css'))
const shellDeclared = new Set()
const shellReferenced = new Set()
const shellPerFile = []
for (const file of shellCssFiles) {
  const scanned = scanCssText(readFileSync(join(frontendDist, file), 'utf8'))
  shellPerFile.push({
    file,
    declared: scanned.declared.size,
    referenced: scanned.referenced.size,
    referencedAlias: [...scanned.referenced].filter((name) => name.startsWith('--dsw-alias-')).length,
  })
  for (const name of scanned.declared) shellDeclared.add(name)
  for (const name of scanned.referenced) shellReferenced.add(name)
}
const aliasOf = (set) => [...set].filter((name) => name.startsWith('--dsw-alias-'))

// ── D：全安装树 client bundle 的声明并集（只看行内 CSS 字面量） ─────────────
const treeOwners = []
const treeDeclaredUnion = new Set()
const treeReferenced = new Set()
for (const pkg of readdirSync(pkgRoot)) {
  const clientPath = join(pkgRoot, pkg, 'lib', 'client.js')
  try {
    if (!statSync(clientPath).isFile()) continue
  } catch {
    continue
  }
  const text = readFileSync(clientPath, 'utf8')
  const declared = new Set()
  for (const binding of inlineCssBindings(text)) for (const block of parseBlocks(binding.css)) for (const name of Object.keys(block.decls)) declared.add(name)
  const refRe = /var\(\s*(--dsw-[a-z0-9-]+)/g
  let match
  while ((match = refRe.exec(text)) !== null) treeReferenced.add(match[1])
  if (declared.size > 0) {
    treeOwners.push({ pkg, declared: declared.size })
    for (const name of declared) treeDeclaredUnion.add(name)
  }
}

// ── E：静态解析（把值里每个 var() 展开，看有没有落不下来的引用） ─────────────
const BAD = ['unresolved-ref', 'missing-token', 'cycle']
/** 逐条收集某个 token 值里落不下来的外部引用（键为缺失的变量名）。 */
function missingRefs(name, table, seen = new Set()) {
  if (seen.has(name)) return [name]
  seen.add(name)
  const value = table[name]
  if (value === undefined) return [name]
  const out = []
  const refRe = /var\(\s*(--[a-z0-9-]+)\s*(,[^()]*)?\)/g
  let match
  while ((match = refRe.exec(value)) !== null) {
    const ref = match[1]
    if (table[ref] !== undefined) out.push(...missingRefs(ref, table, seen))
    else if (match[2] === undefined) out.push(ref)
  }
  seen.delete(name)
  return out
}
function resolveValue(name, table, seen = new Set()) {
  if (seen.has(name)) return { status: 'cycle' }
  seen.add(name)
  const value = table[name]
  if (value === undefined) return { status: 'missing-token' }
  const refRe = /var\(\s*(--[a-z0-9-]+)\s*(,[^()]*)?\)/g
  let usedFallback = false
  let broken = false
  let match
  while ((match = refRe.exec(value)) !== null) {
    const ref = match[1]
    if (table[ref] !== undefined) {
      if (BAD.includes(resolveValue(ref, table, seen).status)) broken = true
    } else if (match[2] !== undefined) usedFallback = true
    else broken = true
  }
  seen.delete(name)
  if (broken) return { status: 'unresolved-ref' }
  if (!value.includes('var(')) return { status: 'literal' }
  return { status: usedFallback ? 'resolved-with-fallback' : 'resolved-chain' }
}
const darkTable = { ...lightDecls, ...darkDecls }
const resolution = { light: {}, dark: {} }
for (const name of union) {
  resolution.light[name] = resolveValue(name, lightDecls)
  resolution.dark[name] = resolveValue(name, darkTable)
}
const summarize = (side) => {
  const out = {}
  for (const result of Object.values(resolution[side])) out[result.status] = (out[result.status] ?? 0) + 1
  return out
}
const unresolvedInLight = [...union].filter((name) => BAD.includes(resolution.light[name].status))
const darkUnresolved = [...union].filter((name) => BAD.includes(resolution.dark[name].status))
const notInLight = [...union].filter((name) => lightDecls[name] === undefined)
const unresolvedDetail = Object.fromEntries(unresolvedInLight.map((name) => [name, [...new Set(missingRefs(name, lightDecls))]]))
const offNamespace = {}
for (const refs of Object.values(unresolvedDetail)) {
  for (const ref of refs) {
    const namespace = ref.startsWith('--dsw-') ? '--dsw-*' : ref.startsWith('--dsh-') ? '--dsh-*' : ref.startsWith('--shiki-') ? '--shiki-*' : 'other'
    offNamespace[namespace] = (offNamespace[namespace] ?? 0) + 1
  }
}

const lightAllVarsFull = { ...lightAllVars }
const darkAllVarsFull = { ...lightAllVars, ...darkAllVars }
const resolutionFull = { light: {}, dark: {} }
for (const name of union) {
  resolutionFull.light[name] = resolveValue(name, lightAllVarsFull)
  resolutionFull.dark[name] = resolveValue(name, darkAllVarsFull)
}
const summarizeFull = (side) => {
  const out = {}
  for (const result of Object.values(resolutionFull[side])) out[result.status] = (out[result.status] ?? 0) + 1
  return out
}
const fullUnresolved = (side) => [...union].filter((name) => BAD.includes(resolutionFull[side][name].status))
const platformVarNames = Object.keys(lightAllVars).filter((name) => !name.startsWith('--dsw-'))
const platformVarNamespaces = {}
for (const name of platformVarNames) {
  const namespace = name.startsWith('--dsh-') ? '--dsh-*' : name.startsWith('--ds-') ? '--ds-*' : 'other'
  platformVarNamespaces[namespace] = (platformVarNamespaces[namespace] ?? 0) + 1
}
const platformVarsSeen = {
  light: platformVarNames.length,
  dark: Object.keys(darkAllVars).filter((name) => !name.startsWith('--dsw-')).length,
  namespaces: platformVarNamespaces,
  names: platformVarNames,
  examples: platformVarNames.slice(0, 8),
}

const evidence = {
  dshRoot: '<dsh-install>',
  A_themeBundle: {
    source: 'dsh-client-ui-theme/lib/client.js（行内 CSS 绑定）',
    bindings: bindingRows,
    unionDeclared: union.size,
    byPrefix: countByPrefix(union),
    lightDeclared: Object.keys(lightDecls).length,
    darkDeclared: Object.keys(darkDecls).length,
    darkOnlyTokens: notInLight,
  },
  B_inspectDirectory: {
    source: 'BUILTIN_INSPECT_TOKENS（exportInspectTokens 的静态种子）',
    count: inspectNames.length,
    names: inspectNames,
    byPrefix: countByPrefix(inspectNames),
    requiresLightAndDark: inspectTokens.filter((token) => token.requiresLightAndDark === true).length,
    inDirectoryNotInStylesheet: inspectNames.filter((name) => !union.has(name)),
    stylesheetNamesCoveredByDirectory: inspectNames.filter((name) => union.has(name)).length,
  },
  C_shellCss: {
    files: shellCssFiles,
    perFile: shellPerFile,
    declared: shellDeclared.size,
    declaredAlias: aliasOf(shellDeclared).length,
    referenced: shellReferenced.size,
    referencedAlias: aliasOf(shellReferenced).length,
    declaredNames: [...shellDeclared],
    referencedAliasNames: aliasOf(shellReferenced).sort(),
  },
  D_tree: {
    owners: treeOwners.sort((a, b) => b.declared - a.declared),
    declaredUnion: treeDeclaredUnion.size,
    declaredUnionByPrefix: countByPrefix(treeDeclaredUnion),
    referencedUnion: treeReferenced.size,
    referencedNotDeclared: [...treeReferenced].filter((name) => !treeDeclaredUnion.has(name)).sort(),
  },
  E_resolution: {
    light: summarize('light'),
    dark: summarize('dark'),
    unresolvedInLight,
    unresolvedInDark: darkUnresolved,
    unresolvedDetail,
    unresolvedNamespace: offNamespace,
  },
  F_resolutionWithPlatformVars: {
    note: '把同一批样式表里的平台级变量（--ds-* / --dsh-* 等）一并作为解析上下文后再解析 A 的并集',
    platformVars: platformVarsSeen,
    light: summarizeFull('light'),
    dark: summarizeFull('dark'),
    unresolvedInLight: fullUnresolved('light'),
    unresolvedInDark: fullUnresolved('dark'),
  },
}

const evidencePath = join(here, '..', 'evidence', 'p4-theme-tokens.json')
mkdirSync(dirname(evidencePath), { recursive: true })
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

console.log(`P4 完成，证据：${evidencePath}`)
console.log(`A ui-theme 行内 CSS：${bindingRows.map((row) => `${row.binding}=${row.tokens}`).join(' | ')}`)
console.log(`  并集 ${union.size} 个 → ${JSON.stringify(countByPrefix(union))}（亮 ${Object.keys(lightDecls).length} / 暗 ${Object.keys(darkDecls).length}）`)
console.log(`B exportInspectTokens 静态种子：${inspectNames.length} 条 → ${JSON.stringify(countByPrefix(inspectNames))}；目录有而样式表没有：${evidence.B_inspectDirectory.inDirectoryNotInStylesheet.length}`)
console.log(`C 外壳产物 CSS：声明 ${shellDeclared.size} 个（alias ${aliasOf(shellDeclared).length}）｜引用 ${shellReferenced.size} 个（alias ${aliasOf(shellReferenced).length}）`)
console.log(`D 全树 client bundle 声明并集：${treeDeclaredUnion.size} → ${JSON.stringify(countByPrefix(treeDeclaredUnion))}；引用并集 ${treeReferenced.size}`)
console.log(`E 解析（只用 --dsw-* 表）：亮 ${JSON.stringify(summarize('light'))}｜暗 ${JSON.stringify(summarize('dark'))}`)
console.log(`  亮色落不下来的：${unresolvedInLight.length}｜暗色落不下来的：${darkUnresolved.length}｜悬空目标命名空间 ${JSON.stringify(offNamespace)}`)
console.log(`F 解析（纳入平台变量 --ds-*/--dsh-* 共 ${platformVarsSeen.light} 个）：亮 ${JSON.stringify(summarizeFull('light'))}｜暗 ${JSON.stringify(summarizeFull('dark'))}`)
console.log(`  落不下来的：亮 ${fullUnresolved('light').length}｜暗 ${fullUnresolved('dark').length}`)
