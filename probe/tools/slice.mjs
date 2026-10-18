#!/usr/bin/env node
// 探针工具：按字符区间打印（可能压缩成单行的）产物原文片段，供逐字引用取证。
// 只读。用法：
//   node probe/tools/slice.mjs <file> <startChar> <endChar>
import { readFileSync } from 'node:fs'

const [file, startRaw, endRaw] = process.argv.slice(2)
if (!file || startRaw === undefined) {
  console.error('usage: node probe/tools/slice.mjs <file> <startChar> <endChar>')
  process.exit(2)
}
const text = readFileSync(file, 'utf8')
const start = Math.max(0, Number(startRaw))
const end = endRaw === undefined ? text.length : Math.min(text.length, Number(endRaw))
console.log(`# file: ${file} chars: ${text.length} slice: [${start}, ${end})`)
console.log(text.slice(start, end))
