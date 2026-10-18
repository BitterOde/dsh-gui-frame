#!/usr/bin/env node
// 探针工具：在（可能是单行／压缩的）产物原文里按正则抓取命中点并打印带上下文的窗口。
// 只读：不修改任何目标文件。用法：
//   node probe/tools/grep-context.mjs <file> <regex-source> [before] [after] [maxHits]
// 例：
//   node probe/tools/grep-context.mjs <shell.js> "assertEntriesActive" 800 1200 3
import { readFileSync } from 'node:fs'

const [file, pattern, beforeRaw, afterRaw, maxRaw] = process.argv.slice(2)
if (!file || !pattern) {
  console.error('usage: node probe/tools/grep-context.mjs <file> <regex-source> [before] [after] [maxHits]')
  process.exit(2)
}
const before = Number(beforeRaw ?? 400)
const after = Number(afterRaw ?? 600)
const maxHits = Number(maxRaw ?? 5)

const text = readFileSync(file, 'utf8')
const re = new RegExp(pattern, 'g')
let match
let hits = 0
const lineStarts = [0]
for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1)
const lineOf = (offset) => {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

console.log(`# file: ${file}`)
console.log(`# bytes: ${Buffer.byteLength(text)}  chars: ${text.length}  pattern: /${pattern}/g  window: ${before}/${after}  maxHits: ${maxHits}`)
while ((match = re.exec(text)) !== null) {
  hits += 1
  const start = Math.max(0, match.index - before)
  const end = Math.min(text.length, match.index + match[0].length + after)
  console.log('')
  console.log(`===== hit ${hits} @ char ${match.index} (line ${lineOf(match.index)}) match="${match[0]}" =====`)
  console.log(text.slice(start, end))
  if (hits >= maxHits) break
}
console.log('')
console.log(`# total hits shown: ${hits}${hits >= maxHits ? ' (capped)' : ''}`)
