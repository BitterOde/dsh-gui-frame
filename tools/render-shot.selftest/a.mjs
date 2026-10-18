// tools/render-shot.selftest/a.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// A 组：CLI 参数解析的用法错误面

import { assert, assertThrows, check } from './kit.mjs';
import { parseArgs } from '../render-shot.mjs';

export function runA() {
check('A1 缺 --out 必须报错', () => {
  assertThrows(() => parseArgs(['a.html']), '--out', 'A1');
});
check('A2 缺输入 HTML 必须报错', () => {
  assertThrows(() => parseArgs(['--out', 'x.png']), '缺少输入 HTML', 'A2');
});
check('A3 --width 非数字必须报错', () => {
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--width', 'abc']), '--width', 'A3');
});
check('A4 --width 0 / 负数 / 小数都必须报错', () => {
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--width', '0']), '--width', 'A4-0');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--width', '-5']), '--width', 'A4-neg');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--width', '12.5']), '--width', 'A4-float');
});
check('A5 --height 非数字必须报错', () => {
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--height', '高']), '--height', 'A5');
});
check('A6 --wait-ms 允许 0 但不允许非数字', () => {
  const options = parseArgs(['a.html', '--out', 'x.png', '--wait-ms', '0']);
  assert(options.waitMs === 0, `--wait-ms 0 应被接受，实得 ${options.waitMs}`);
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--wait-ms', 'abc']), '--wait-ms', 'A6');
});
check('A7 --out/--width 末尾缺值必须报错', () => {
  assertThrows(() => parseArgs(['a.html', '--out']), '--out 需要一个参数值', 'A7-out');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--width']), '--width 需要一个参数值', 'A7-width');
});
check('A8 未知参数与多余位置参数必须报错', () => {
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--nope']), '未知参数', 'A8-unknown');
  assertThrows(() => parseArgs(['a.html', 'b.html', '--out', 'x.png']), '只接受一个输入 HTML', 'A8-extra');
});
check('A9 非 .html/.htm 输入必须报错', () => {
  assertThrows(() => parseArgs(['a.txt', '--out', 'x.png']), '.html', 'A9');
});
check('A10 正常解析：默认值 + 内联写法 + 布尔开关', () => {
  const base = parseArgs(['a.html', '--out', 'x.png']);
  assert(base.width === 1280 && base.height === 900, `默认视口应为 1280×900，实得 ${base.width}×${base.height}`);
  assert(base.fullPage === false && base.json === false, '默认不应开启 --full-page / --json');
  assert(base.waitMs === 500, `默认 --wait-ms 应为 500，实得 ${base.waitMs}`);
  const inline = parseArgs(['a.html', '--out=x.png', '--width=800', '--height=600', '--full-page', '--json']);
  assert(inline.out === 'x.png', `--out=x.png 内联写法没解析出来：${inline.out}`);
  assert(inline.width === 800 && inline.height === 600, '内联宽高没解析出来');
  assert(inline.fullPage === true && inline.json === true, '布尔开关没解析出来');
  const help = parseArgs(['--help']);
  assert(help.help === true, '--help 没被识别（且不应因为缺输入而报错）');
});

// ── B. 浏览器探测（注入 exists，不碰真磁盘）────────────────────────────────────
}
