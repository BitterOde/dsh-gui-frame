#!/usr/bin/env node
/**
 * render-shot.selftest.mjs —— `render-shot.mjs` 的**离线自检**（自带牙）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【它验什么 / 它不验什么】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 默认**不启动浏览器**（起进程需要用户逐次同意）：验证的是那些"不需要浏览器就有答案"的面 ——
 * 参数解析、找 Edge/Chrome 的路径顺序、`--out` 缺省路径推导、**CDP 命令字面量的形状**、
 * 截图为空的判据、**真机那一支的离线面**（URL 输入 / 3080 红线 / 等锚点超时 / 按选择器裁剪 /
 * 点击的两条路径 / 产物 PNG 尺寸核对）、以及四条**静态纪律**（零第三方依赖 / 绝不按进程名批量杀 /
 * 无头 / 编排器只用 `node <bin.js>` 起进程）。
 * 真机截图那一步留成可选：`--browser` 才跑；不跑就打印 **SKIP + 原因**，且 **SKIP 不计入 PASS**
 * （把跳过算成通过，等于自检自己骗自己）。
 *
 * 判据"有没有牙"另有一轮反证：`node tools/render-shot.mutation.mjs`（在副本里改坏代码 ⇒ 必须翻红）。
 *
 * 为什么"命令形状"值得单测：真机截图花的是一次用户批准，而**写错方法名/参数名**
 * （`Page.captureScreenshot` 拼错、整页忘了先撑设备指标）在真机上表现为"图不对"而不是"命令报错"，
 * 排查代价高。把这几条字面量钉死在离线面，真机那一跑才是验证而不是试错。
 *
 * 用法：`node tools/render-shot.selftest.mjs [--browser] [--browser-path <exe>]`
 * 退出码：0 = 全过（跳过项不算过，但也不算失败）｜1 = 有失败项。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

import { failed, failures, passed, skipped } from './render-shot.selftest/kit.mjs';
import { sandbox } from './render-shot.selftest/fixtures.mjs';
import { runA } from './render-shot.selftest/a.mjs';
import { runB } from './render-shot.selftest/b.mjs';
import { runC } from './render-shot.selftest/c.mjs';
import { runD } from './render-shot.selftest/d.mjs';
import { runE } from './render-shot.selftest/e.mjs';
import { runF } from './render-shot.selftest/f.mjs';
import { runH } from './render-shot.selftest/h.mjs';
import { runS } from './render-shot.selftest/s.mjs';
import { runM } from './render-shot.selftest/m.mjs';
import { runG } from './render-shot.selftest/g.mjs';

runA();

runB();

runC();

runD();

runE();

runF();

runH();

runS();

await runM();

await runG();

rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

console.log(
  `[selftest] 合计：PASS ${passed}｜FAIL ${failed}｜SKIP ${skipped}` +
    `（SKIP 不计入 PASS：跳过 = 本轮没有验证过这件事）`,
);

if (failures.length > 0) {
  console.log('[selftest] 失败清单：');
  for (const failure of failures) console.log(`[selftest]   ✗ ${failure}`);
}

process.exitCode = failed === 0 ? 0 : 1;