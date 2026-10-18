// tools/render-shot.selftest/s.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// S 组：编排器 dsh-shot 的静态纪律与离线参数面

import { assert, assertThrows, check } from './kit.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { OWN_PROFILE_RE, PKG_DIR as SHOT_PKG_DIR, parseCli as parseShotCli } from '../dsh-shot.mjs';
import { shotSourceCode } from './scan.mjs';

export function runS() {
check('S1 dsh-shot 零第三方依赖：所有 import 说明符只能是 node: 或相对路径', () => {
  const specifiers = [];
  for (const match of shotSourceCode.matchAll(/\bfrom\s+'([^']+)'/g)) specifiers.push(match[1]);
  for (const match of shotSourceCode.matchAll(/\bimport\s*\(\s*'([^']+)'\s*\)/g)) specifiers.push(match[1]);
  assert(specifiers.length >= 3, `没扫到 import（判据本身失效）：${JSON.stringify(specifiers)}`);
  // 相对路径含 './x' 与 '../x'（拆出子目录后子模块要回指上一级）；裸包名不以 . 开头 ⇒ 一律判红。
  const offenders = specifiers.filter((specifier) => !specifier.startsWith('node:') && !specifier.startsWith('./') && !specifier.startsWith('../'));
  assert(offenders.length === 0, `出现了非内置依赖：${offenders.join('、')}`);
});
check('S2 dsh-shot 只按自己的 pid 回收：有 /PID 与 /T，绝不出现 /IM', () => {
  assert(shotSourceCode.includes("'/PID'"), '收尾应用 taskkill /PID <自己的 pid>');
  assert(shotSourceCode.includes("'/T'"), '/T 只覆盖该 pid 的子树，收尾应带上');
  assert(!shotSourceCode.includes("'/IM'"), '出现了 /IM —— 那会按进程名批量杀');
});
check('S3 dsh-shot 起 dsh 一律 shell:false（走 process.execPath + bin.js）', () => {
  assert(shotSourceCode.includes('process.execPath'), '必须先解析到 dsh 的 bin.js 用 node 直接起（shell 包装会留下杀不掉的 cmd.exe 中间层）');
  assert(!shotSourceCode.includes('shell: true'), '不许用 shell:true 起 dsh');
  assert(shotSourceCode.includes('lib'), '入口应解析到 lib/bin.js');
});
check('S4 dsh-shot 的 3080 口径：常量在、只读 PID 对比、并拒绝 web profile', () => {
  assert(shotSourceCode.includes('LIVE_GUI_PORT = 3080'), '3080 应作为命名常量出现（红线可检索）');
  assert(shotSourceCode.includes('listenerPid'), '应只"读"3080 的监听者 PID 做前后对比');
  assert(shotSourceCode.includes('OWN_PROFILE_RE'), '删除临时 profile 必须按自己的命名白名单（不许删别人的）');
  assert(shotSourceCode.includes("'web'"), '应显式拒绝使用 `web` profile');
});
check('S5 dsh-shot 的参数面：缺 --out / 未知参数 / 非法取值 / web profile 都是用法错误', () => {
  assertThrows(() => parseShotCli([]), '--out', 'S5-noout');
  assertThrows(() => parseShotCli(['--nope']), '未知参数', 'S5-unknown');
  assertThrows(() => parseShotCli(['--out', 'x.png', '--click-via', 'bogus']), '--click-via', 'S5-via');
  assertThrows(() => parseShotCli(['--out', 'x.png', '--profile', 'web']), '拒绝使用 profile', 'S5-web');
  assertThrows(() => parseShotCli(['--out', 'x.png', '--wait-ms', 'abc']), '--wait-ms', 'S5-wait');
  const parsed = parseShotCli(['--out', 'x.png', '--click', 'b', '--click-via', 'js', '--selector', 's', '--wait-for', 'w']);
  assert(parsed.out === 'x.png' && parsed.click === 'b' && parsed.clickVia === 'js' && parsed.selector === 's' && parsed.waitFor === 'w', `编排器参数没解析对：${JSON.stringify(parsed)}`);
  assert(parsed.waitMs === 800 && parsed.width === 1440 && parsed.height === 900, '编排器默认视口/等待应与 README 一致');
  assert(parsed.waitForTimeout === 30_000, `编排器等锚点超时默认应为 30000（真机外壳首屏慢），实得 ${parsed.waitForTimeout}`);
  const plan = parseShotCli(['--dry-run', '--json', '--out', 'x.png']);
  assert(plan.dryRun === true && plan.json === true, '--dry-run/--json 应被识别（且 --dry-run 不强制 --out）');
});
check('S6 dsh-shot 的目标包就是本仓（link 规格由包目录拼出，不是写死的绝对路径）', () => {
  assert(SHOT_PKG_DIR.endsWith('dsh-gui-frame'), `包目录解析不对：${SHOT_PKG_DIR}`);
  assert(existsSync(path.join(SHOT_PKG_DIR, 'package.json')), '包目录里应有 package.json');
  assert(shotSourceCode.includes('link:${PKG_DIR'), 'link 规格应由包目录拼出来（换机器/换目录仍可跑）');
});
check('S7 临时 profile 白名单：只认自己的前缀（`guifshot…`），别的名字一律不删', () => {
  assert(shotSourceCode.includes('OWN_PROFILE_RE.test(profile)'), '删 profile 前必须先过白名单判据');
  assert(OWN_PROFILE_RE.test('guifshotabc123'), '自己建的临时 profile 应被认作"可删"');
  for (const foreign of ['web', 'guifrm1', 'default', 'guifshot']) {
    assert(OWN_PROFILE_RE.test(foreign) === false, `别人的 profile 名 ${foreign} 被判成了"可删"（正则 ${OWN_PROFILE_RE}）`);
  }
});

// ── M. 内存硬闸：未达标即 fail-closed —— **全部离线**（不真起实例/浏览器、不真吃内存）──

/**
 * 假依赖表：把「起进程 / 读内存 / 写输出」全换成记账用的桩。
 * 于是「未达标 ⇒ 一个子步骤都没发生」与「达标 ⇒ 一路走到出图」都能被确定性证明，
 * 而**不需要真起 dsh 实例或浏览器**（用户已下令停止大体量测试）。
 */
}
