#!/usr/bin/env node
/**
 * render-shot.mjs —— **HTML → PNG 无头渲染截图**（命令行；零第三方依赖）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【它从哪来】借鉴 dsh-vision-router 的 `vision_html_screenshot`
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 借的是**思路**而不是实现：那个工具用本地 HTML 文件 + 无头系统浏览器截图、`fullPage: true`
 * 时截整页并回传页面高度、产物是 PNG —— 这正是「参考图 → 实现 → 截图 → 像素比对」验证回路
 * 的第二棒。它依赖 `puppeteer-core`（外加 sharp 等），本仓硬规则是**零第三方依赖**
 * ⇒ 这里用 `child_process` 起浏览器、用**裸 CDP（Chrome DevTools Protocol）**驱动：
 * 自己挑空闲端口 → 用 HTTP `/json/version` 或 profile 里的 `DevToolsActivePort` 拿到
 * WebSocket 端点 → `Target.attachToTarget(flatten)` → `Page.navigate` / `Emulation.*` /
 * `Page.captureScreenshot`。全程只用 `node:*` 内置模块与全局 `WebSocket`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么它不影响你用电脑】用户明令：不动输入、不切界面、纯图形渲染
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ① **headless=new**：浏览器不创建可见窗口 —— 没有窗口可抢焦点，也就没有鼠标/键盘注入；
 *    全程**不调用任何系统级整屏截图**（那种做法会连桌面一起拍进去，还会受遮挡影响）。
 * ② **专属 user-data-dir**：`<系统临时目录>/guif-render-shot-<pid>-<随机>`。**不复用**用户的
 *    浏览器配置 ⇒ 不共享会话、不写用户的 `~/.dsh`、不改任何用户数据；且因为 profile 不同，
 *    浏览器**不会**把这次启动挂到用户已开着的 Edge 上（否则会"借用"用户窗口并抢走一次导航）。
 * ③ **精确回收**：只按**自己 spawn 出来的那个 pid** 收尾 —— 先走 CDP `Browser.close`，
 *    超时未退再 `taskkill /PID <pid> /T /F`（`/T` = 只杀该 pid 的**进程树**）。
 *    **绝不按进程名批量杀**（不出现 `/IM msedge.exe`）：用户自己的浏览器还开在同一台机器上。
 * ④ **不联网**：`--disable-background-networking` / `--disable-component-update` / `--disable-sync`
 *    等关掉后台请求；渲染的是本地 `file://` 文件。
 * ⑤ 收尾删除临时 profile（幂等重试），失败也不影响别的进程。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【用法】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   node tools/render-shot.mjs <input.html|http(s)-URL> --out <out.png> [选项]
 *
 *   --out <path>      必填。可给文件路径，也可给**目录**（以分隔符结尾或已存在的目录）
 *                     ⇒ 文件名由输入推导为 `<stem>.png`（URL 输入取 `主机-端口`，**不带 token**）。
 *   --width <px>      视口宽，默认 1280（正整数）
 *   --height <px>     视口高，默认 900（正整数）
 *   --full-page       截整页：内容高度超过视口时整页拍下，并**打印页面高度**
 *   --wait-ms <ms>    加载完成后再等多久（默认 500，等字体/首屏稳定；非负整数）
 *   --json            结果以 JSON 打到 stdout（人读文案改走 stderr，不污染 JSON）
 *   --browser <path>  显式指定浏览器可执行文件（默认自动探测 Edge/Chrome）
 *   --timeout-ms <ms> CDP 单步超时，默认 30000
 *   --keep-profile    保留临时 profile（排查用；默认收尾删除）
 *   -h, --help        打印用法
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【真机页面（DSH 实例）出图：URL + 等锚点 + 点击 + 按选择器裁剪】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 输入除了本地 HTML，还可以是**一个已在跑的 http(s) 地址**（真机实例带 token 的启动 URL）。
 * 真机页面是「先有外壳、后有内容」的，所以多了三步**光靠等 load 事件不够**的能力：
 *
 *   --url                     显式声明输入是 URL（可省：以 http(s):// 开头即认）
 *   --wait-for <css>          截图前等这个选择器**出现**；超时 ⇒ 失败（exit 1），**不截图**
 *   --wait-for-timeout <ms>   等锚点的超时，默认 15000
 *   --selector <css>          只截这个元素的外框（CDP `clip`），默认截整个视口
 *   --click <css>             截图前点击它（真鼠标：mouseMoved + mousePressed + mouseReleased）
 *   --click-index <n>         点第 n 个命中（0 基，默认 0；多个坞入口时用它挑）
 *   --click-via <mouse|js>    点击方式，默认 mouse；`js` = 页面内 `el.closest("button") ?? el`
 *                             派发 `click()` —— 坞入口的实测路径（图标中心点被一个无 class 的
 *                             覆盖 DIV 挡着，真鼠标点会被吞；对外壳行按钮派发 click 才开面板）
 *
 * 三条纪律都落成了**硬失败**（不是警告）：等不到锚点 / 裁剪元素不在场或 0 尺寸 / 点击目标不在场
 * ⇒ **非 0 退出且不写 PNG** —— 「静默出一张空图当成功」比报错危险得多。
 *
 * **3080 红线**：`http://127.0.0.1:3080` 是用户正在用的 DSH GUI，本工具**拒绝访问**（UsageError ⇒ 2），
 * 且**没有绕过开关**。对真机出图请用独立端口实例（见 `tools/dsh-shot.mjs` 与 README 的《对 GUIFrame 真机出图》）。
 *
 * 退出码：0 = 成功｜1 = 运行期失败（找不到浏览器 / 连不上 CDP / 截图为空 / **等锚点超时** /
 *         **裁剪元素不在场** / **产物尺寸与请求不符**…）｜2 = 用法错误（参数写错、输入不存在、
 *         输入不是 .html/URL、`--out` 指向目录、**目标指向 3080** —— 这些一律 UsageError ⇒ 2）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【产物尺寸自校验】拍完不只看魔数，还读 PNG 的 IHDR 头核对宽高
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `Page.captureScreenshot` 的 `clip` 若被忽略，产物就是一张**尺寸对不上**的图 —— 那正是最难发现
 * 的假绿（"有图、魔数对、就是内容不对"）。所以这里解析 IHDR 的宽高：视口/整页模式必须等于请求尺寸，
 * 裁剪模式必须等于元素外框（容差 1px，给 CDP 的像素取整留一格），不符 ⇒ 失败。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【本仓门禁】`tools/**` 在 `scripts/check-tokens.mjs` 的**硬门禁面**内
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⇒ 本文件**不得出现裸色值字面量**。若注释里必须提到"井号 + 十六进制"，井号一律写成
 * `\u0023`（JS 转义）—— 被判据正则看到的是转义序列，不是颜色。
 */

import path from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

// ── 默认值与上限 ────────────────────────────────────────────────────────────────
/** 默认视口（与 dsh-vision-router 的 1200×720 同类；这里取更接近设计稿的桌面尺寸）。 */

import { USAGE, parseArgs } from './render-shot/args.mjs';
import { UsageError } from './render-shot/constants.mjs';
import { installCleanupGuard, renderShot } from './render-shot/render.mjs';
import { formatHumanSummary, toJsonResult } from './render-shot/report.mjs';

export { CLICK_SETTLE_MS, DEFAULT_HEIGHT, DEFAULT_TIMEOUT_MS, DEFAULT_WAIT_FOR_TIMEOUT_MS, DEFAULT_WAIT_MS, DEFAULT_WIDTH, MAX_CAPTURE_HEIGHT, MAX_CAPTURE_PIXELS, MAX_WAKE_STEPS, USAGE, WAIT_FOR_POLL_MS, WAKE_SETTLE_MS, WAKE_STEP_MS, parseArgs } from './render-shot/args.mjs';
export { LIVE_GUI_PORT, UsageError } from './render-shot/constants.mjs';
export { browserCandidates, findBrowserExecutable } from './render-shot/browser.mjs';
export { assertNotLiveGuiUrl, deriveOutPath, isHttpUrl, outStemFor, resolveInputs, resolveTargets, urlStemFor } from './render-shot/inputs.mjs';
export { FONTS_READY_EXPRESSION, PAGE_HEIGHT_EXPRESSION, WAKE_FULL_PAGE_EXPRESSION, clickJsExpression, clickPointExpression, fontsReadyCommand, pageHeightCommand, selectorProbeExpression, selectorRectExpression, wakeFullPageCommand } from './render-shot/expressions.mjs';
export { assertAnchorFound, assertClickPoint, assertElementRect } from './render-shot/asserts.mjs';
export { buildCaptureSteps, buildLaunchArgs, buildPagePlan } from './render-shot/plan.mjs';
export { assertPngSize, assertScreenshotBytes, isPng, parsePngSize } from './render-shot/png.mjs';
export { killProcessTree } from './render-shot/cdp.mjs';
export { normalizeRenderOptions, renderShot } from './render-shot/render.mjs';
export { formatHumanSummary, toJsonResult } from './render-shot/report.mjs';

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[render-shot] 用法错误：${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  installCleanupGuard((line) => process.stderr.write(`${line}\n`));
  try {
    const result = await renderShot(options);
    if (options.json) process.stdout.write(`${toJsonResult(result)}\n`);
    else formatHumanSummary(result, (line) => process.stdout.write(`${line}\n`));
    return 0;
  } catch (error) {
    // 退出码按**错误性质**分：UsageError 一律 2（"你传错了"），其余 1（"环境/页面不对"）。
    // 输入不存在、输入不是 .html、--out 指向目录、目标指向 3080、选择器语法非法都在
    // resolveTargets / assert* 里抛 UsageError ⇒ 与"参数写错"同码；
    // 而"等锚点超时""裁剪元素不在场""产物尺寸不符"是 **1** —— 它们说的是"页面/环境不对"。
    // 脚本调用方只需要看一个数就知道该改参数还是改环境。
    process.stderr.write(`[render-shot] ${error instanceof UsageError ? '用法错误' : '失败'}：${error?.message ?? error}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

const invokedDirectly =

  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main();
}