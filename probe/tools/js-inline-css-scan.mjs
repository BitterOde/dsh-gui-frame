#!/usr/bin/env node
// 只读工具：列出某个（打包产物）JS 文件里所有行内 CSS 字面量绑定 `var NAME = "...";`，
// 统计各自声明的 --dsw-* token 数（去重）与整份文件的声明并集，按前缀分类。
// 用途：找 token 的真源 owner，并对账「官方声明了多少个 --dsw-*」这类数字到底数的是哪一层。
// 用法：node probe/tools/js-inline-css-scan.mjs <file.js> [--dump <tokenName>]
import { readFileSync } from 'node:fs'

const [file, flag, dumpName] = process.argv.slice(2)
if (!file) {
  console.error('usage: node probe/tools/js-inline-css-scan.mjs <file.js> [--dump <tokenName>]')
  process.exit(2)
}
const text = readFileSync(file, 'utf8')
const prefixOf = (name) => {
  const rest = name.slice('--dsw-'.length)
  return ['alias', 'static', 'specific', 'elevation', 'shadow'].find((p) => rest.startsWith(p + '-')) ?? rest.split('-')[0]
}
const collect = (css) => {
  const names = new Set()
  const re = /--dsw-[a-z0-9-]+\s*:/g
  let match
  while ((match = re.exec(css)) !== null) names.add(match[0].replace(/\s*:$/, ''))
  return names
}

const bindingRe = /var ([A-Za-z0-9_$]+) = "((?:[^"\\]|\\.)*)";/g
let match
const rows = []
const union = new Set()
while ((match = bindingRe.exec(text)) !== null) {
  const css = JSON.parse(`"${match[2]}"`)
  const names = collect(css)
  if (names.size === 0) continue
  for (const name of names) union.add(name)
  rows.push({ binding: match[1], charOffset: match.index, cssLength: css.length, tokens: names.size, names: [...names] })
}
const unionAll = new Set(collect(text))
console.log(`# file: ${file}`)
console.log(`# 行内 CSS 绑定（含 --dsw-* 声明者）：${rows.length} 个`)
for (const row of rows) console.log(`  ${row.binding.padEnd(36)} tokens=${String(row.tokens).padStart(4)}  offset=${row.charOffset}  cssLen=${row.cssLength}`)
const byPrefix = (names) => {
  const out = {}
  for (const name of names) out[prefixOf(name)] = (out[prefixOf(name)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}
console.log(`# 上述绑定并集：${union.size} 个 → ${JSON.stringify(byPrefix(union))}`)
console.log(`# 整份文件文本里 --dsw-*. 形式的声明并集：${unionAll.size} 个 → ${JSON.stringify(byPrefix(unionAll))}`)
const onlyText = [...unionAll].filter((name) => !union.has(name))
if (onlyText.length > 0) console.log(`# 只在绑定外出现（非 CSS 字面量，需人工分辨）：${onlyText.length} 个，前 8 个 ${onlyText.slice(0, 8).join(', ')}`)
if (flag === '--dump' && dumpName) {
  console.log(`# dump ${dumpName}:`)
  for (const row of rows) if (row.names.includes(dumpName)) console.log(`  ${row.binding}: ${row.names.filter((n) => n === dumpName).length} 次`)
}
