// tools/render-shot.selftest/f.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// F 组：静态纪律（对整片去注释源码下判据）

import { assert, check } from './kit.mjs';
import { killProcessTree } from '../render-shot.mjs';
import { sourceCode } from './scan.mjs';

export function runF() {
check('F1 零第三方依赖：所有 import 说明符只能是 node: 或相对路径', () => {
  const specifiers = [];
  for (const match of sourceCode.matchAll(/\bfrom\s+'([^']+)'/g)) specifiers.push(match[1]);
  for (const match of sourceCode.matchAll(/\bimport\s*\(\s*'([^']+)'\s*\)/g)) specifiers.push(match[1]);
  assert(specifiers.length >= 5, `没扫到 import（判据本身失效）：${JSON.stringify(specifiers)}`);
  // 相对路径含 './x' 与 '../x'（拆出子目录后子模块要回指上一级）；裸包名（如 jsdom）不以 . 开头 ⇒ 一律判红。
  const offenders = specifiers.filter((specifier) => !specifier.startsWith('node:') && !specifier.startsWith('./') && !specifier.startsWith('../'));
  assert(offenders.length === 0, `出现了非内置依赖：${offenders.join('、')}`);
});
check('F2 绝不按进程名批量杀：只用 /PID（+ /T 树），不出现 /IM', () => {
  assert(sourceCode.includes("'/PID'"), 'killProcessTree 应使用 /PID（按自己记录的 pid）');
  assert(!sourceCode.includes("'/IM'"), '出现了 /IM —— 那会按进程名批量杀，可能误杀用户自己开着的浏览器');
  assert(sourceCode.includes("'/T'"), '/T 只覆盖该 pid 的子树，收尾应带上');
});
check('F3 无头是硬约束：源码里必须点名 --headless=new', () => {
  assert(sourceCode.includes('--headless=new'), '启动开关里没有 --headless=new');
});
check('F4 不出现系统级整屏截图的做法（CopyFromScreen / graphics.CopyFrom）', () => {
  for (const needle of ['CopyFromScreen', 'CopyFrom', 'screenshot-desktop']) {
    assert(!sourceCode.includes(needle), `源码里出现了系统级截屏字样：${needle}`);
  }
});
check('F5 killProcessTree 对非法 pid 是 no-op（不许"pid 拿不到就杀全家"）', () => {
  let threw = false;
  try {
    killProcessTree(0);
    killProcessTree(-1);
    killProcessTree(Number.NaN);
  } catch {
    threw = true;
  }
  assert(threw === false, 'killProcessTree 对非法 pid 应静默返回（这里不应真的去杀任何进程）');
});

// ── H. 真机目标面：URL 输入 / 3080 红线 / 等锚点 / 按选择器裁剪 / 点击 ────────────
// 这些判据全部**离线可判**（纯函数 + 字面量形状），所以不必起浏览器就能证明"写错了会当场翻红"。
// G1/G2 那两项仍然只能真跑 —— SKIP 的含义不变。

/** 造一个只够读尺寸的最小 PNG（IHDR 头 + 一点尾巴）。 */
}
