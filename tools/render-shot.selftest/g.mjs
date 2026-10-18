// tools/render-shot.selftest/g.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// G 组：真机截图（可选；默认 SKIP 且不计入 PASS）

import { assert, checkAsync, skip } from './kit.mjs';
import { inputHtml, sandbox } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isPng } from '../render-shot.mjs';

export async function runG() {
const argv = process.argv.slice(2);
const runBrowser = argv.includes('--browser');
const browserPathIndex = argv.indexOf('--browser-path');
const browserPath = browserPathIndex === -1 ? null : (argv[browserPathIndex + 1] ?? null);
if (!runBrowser) {
  skip(
    'G1 真机截图（HTML → PNG，含 --full-page 页面高度）',
    '未传 --browser：起浏览器需要用户逐次同意，本脚本默认不启动任何进程',
  );
  skip('G2 真机截图产物校验（PNG 魔数 / 字节数 / pageHeight）', '同上：G1 被跳过');
} else {
  const { renderShot } = await import('../render-shot.mjs');
  const outPng = path.join(sandbox, 'real-machine.png');
  await checkAsync('G1 真机截图（HTML → PNG，含 --full-page 页面高度）', async () => {
    const result = await renderShot(
      {
        input: inputHtml,
        out: outPng,
        width: 320,
        height: 200,
        fullPage: true,
        waitMs: 50,
        json: false,
        browser: browserPath,
        timeoutMs: 30_000,
        keepProfile: false,
      },
      { log: (line) => console.log(`[selftest]   ${line}`) },
    );
    assert(result.bytes > 0, `产物字节数为 0：${result.out}`);
    assert(result.pageHeight >= 1600, `页面高度应 ≥1600，实得 ${result.pageHeight}`);
    console.log(`[selftest]   产物 ${result.out}（${result.bytes} 字节，页面高度 ${result.pageHeight}px）`);
  });
  await checkAsync('G2 真机截图产物校验（PNG 魔数 / 字节数 / pageHeight）', async () => {
    const bytes = readFileSync(outPng);
    assert(isPng(bytes), '产物不是 PNG');
    assert(bytes.length > 1000, `PNG 太小，像是空图：${bytes.length} 字节`);
  });
}

// ── 收尾 ───────────────────────────────────────────────────────────────────────
}
