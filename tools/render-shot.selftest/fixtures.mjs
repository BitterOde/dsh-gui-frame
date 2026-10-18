// tools/render-shot.selftest/fixtures.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 共享夹具：临时沙箱、输入 HTML、最小 PNG 构造

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const sandbox = mkdtempSync(path.join(tmpdir(), 'guif-render-shot-selftest-'));
export const inputHtml = path.join(sandbox, 'design.html');
writeFileSync(inputHtml, '<!doctype html><meta charset="utf-8"><title>selftest</title><div style="height:1600px">tall</div>\n', 'utf8');
export function makePng(width, height) {
  const head = Buffer.alloc(8);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  const chunk = Buffer.alloc(16);
  chunk.writeUInt32BE(13, 0);
  chunk.write('IHDR', 4, 'latin1');
  chunk.writeUInt32BE(width, 8);
  chunk.writeUInt32BE(height, 12);
  return Buffer.concat([head, chunk, Buffer.alloc(64)]);
}
