// tools/render-shot.selftest/c.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// C 组：产物路径推导与输入解析

import { assert, assertThrows, check } from './kit.mjs';
import { inputHtml, sandbox } from './fixtures.mjs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { UsageError, deriveOutPath, outStemFor, parseArgs, resolveInputs } from '../render-shot.mjs';

export function runC() {
check('C1 --out 给目录 ⇒ 由输入文件名推导 <stem>.png', () => {
  const derived = deriveOutPath({ input: inputHtml, out: sandbox, isDirectory: (candidate) => candidate === sandbox });
  assert(derived === path.join(sandbox, 'design.png'), `推导结果不对：${derived}`);
  const withSeparator = deriveOutPath({ input: inputHtml, out: `${sandbox}${path.sep}`, isDirectory: () => false });
  assert(withSeparator === path.join(sandbox, 'design.png'), `尾分隔符写法推导结果不对：${withSeparator}`);
});
check('C2 --out 给文件 ⇒ 原样采用（不擅自改名）', () => {
  const target = path.join(sandbox, 'shot-final.png');
  assert(deriveOutPath({ input: inputHtml, out: target, isDirectory: () => false }) === target, 'C2：文件路径被改了');
});
check('C3 outStemFor 清掉文件名非法字符、去掉扩展名', () => {
  assert(outStemFor('C:\\a\\b\\page.v2.html') === 'page.v2', `扩展名没去干净：${outStemFor('C:\\a\\b\\page.v2.html')}`);
  // 只留"名字里真的带了非法字符"的形态：`: ` 交给 path.basename 处理（它把 `a:` 当盘符/流前缀剥掉），
  // 这里断言的是我们自己那条 `\\/:*?"<>|` → `_` 的替换规则。
  assert(outStemFor('a*b?c.htm') === 'a_b_c', `非法字符没清掉：${outStemFor('a*b?c.htm')}`);
  assert(outStemFor('.html') === 'shot', `空名字应回退成 shot，实得 ${outStemFor('.html')}`);
});
check('C4 resolveInputs 给出 file:// URL，并认出 --out 目录推导', () => {
  const resolved = resolveInputs({
    input: inputHtml,
    out: sandbox,
    exists: existsSync,
    isDirectory: (candidate) => {
      try {
        return statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    },
  });
  assert(resolved.fileUrl.startsWith('file:///'), `不是 file:// URL：${resolved.fileUrl}`);
  assert(resolved.fileUrl.endsWith('design.html'), `URL 尾巴不对：${resolved.fileUrl}`);
  assert(resolved.outPath === path.join(sandbox, 'design.png'), `outPath 推导不对：${resolved.outPath}`);
});
check('C5 输入不存在 / 输入是目录 必须带原因报错', () => {
  assertThrows(() => resolveInputs({ input: path.join(sandbox, 'nope.html'), out: 'x.png' }), '不存在', 'C5-missing');
  assertThrows(
    () => resolveInputs({ input: sandbox, out: 'x.png', isDirectory: (candidate) => candidate === sandbox }),
    '输入是目录',
    'C5-dir',
  );
});
check('C6 解析阶段与"输入不存在/是目录"的报错都是 UsageError（退出码 2 的依据）', () => {
  assert(assertThrows(() => parseArgs(['a.html']), '--out', 'C6-args') instanceof UsageError, 'parseArgs 应抛 UsageError');
  const missing = assertThrows(
    () => resolveInputs({ input: path.join(sandbox, 'nope.html'), out: 'x.png' }),
    '不存在',
    'C6-missing',
  );
  assert(missing instanceof UsageError, `"输入不存在"应是 UsageError（→ exit 2），实得 ${missing.constructor.name}`);
  const asDirectory = assertThrows(
    () => resolveInputs({ input: sandbox, out: 'x.png', isDirectory: (candidate) => candidate === sandbox }),
    '输入是目录',
    'C6-dir',
  );
  assert(asDirectory instanceof UsageError, '"输入是目录"应是 UsageError（→ exit 2）');
});

// ── D. CDP 命令字面量的形状 ────────────────────────────────────────────────────
}
