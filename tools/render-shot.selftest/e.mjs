// tools/render-shot.selftest/e.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// E 组：截图为空 / 非 PNG 的守门

import { assert, assertThrows, check } from './kit.mjs';
import { assertScreenshotBytes, isPng } from '../render-shot.mjs';

export function runE() {
check('E1 isPng 认魔数、拒空与假数据', () => {
  const realPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  assert(isPng(realPng) === true, '真 PNG 头被判成非 PNG');
  assert(isPng(Buffer.alloc(0)) === false, '空 buffer 不该算 PNG');
  assert(isPng(Buffer.from('not a png at all')) === false, '文本不该算 PNG');
});
check('E2 空截图必须报错（不能写出 0 字节文件当成功）', () => {
  assertThrows(() => assertScreenshotBytes(Buffer.alloc(0)), '截图返回空', 'E2');
});
check('E3 非 PNG 数据必须报错并带上现场字节', () => {
  const error = assertThrows(() => assertScreenshotBytes(Buffer.from('GIF89a..')), '不是 PNG', 'E3');
  assert(error.message.includes('47494638'), `报错应带前 8 字节现场，实得：${error.message}`);
});

// ── F. 静态纪律（对去注释后的真代码下判据）─────────────────────────────────────
}
