// tools/render-shot.selftest/h.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// H 组：真机目标面的离线判据（URL / 3080 红线 / 等锚点 / 裁剪 / 点击）

import { assert, assertThrows, check } from './kit.mjs';
import { inputHtml, makePng, sandbox } from './fixtures.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_WAIT_FOR_TIMEOUT_MS, UsageError, assertAnchorFound, assertClickPoint, assertElementRect, assertNotLiveGuiUrl, assertPngSize, buildCaptureSteps, clickJsExpression, clickPointExpression, isHttpUrl, normalizeRenderOptions, parseArgs, parsePngSize, resolveTargets, selectorProbeExpression, selectorRectExpression, urlStemFor } from '../render-shot.mjs';
import { SOURCE_FILE } from './scan.mjs';

export function runH() {
check('H1 URL 输入被认出来（位置参数与 --url 两条路），本地文件名不会被误认成 URL', () => {
  const viaPosition = parseArgs(['http://127.0.0.1:46982/?token=abc', '--out', 'x.png']);
  assert(viaPosition.input.startsWith('http://'), `位置参数里的 URL 没被保留：${viaPosition.input}`);
  const viaFlag = parseArgs(['--url', 'https://example.test/page', '--out', 'x.png']);
  assert(viaFlag.input === 'https://example.test/page', `--url 没设成输入：${viaFlag.input}`);
  assert(isHttpUrl('HTTP://X/Y') === true, '大写协议头也应算 URL');
  assert(isHttpUrl('docs/demo/page.html') === false, '本地路径不该被当成 URL');
  assertThrows(() => parseArgs(['--url', 'page.html', '--out', 'x.png']), 'http(s) 地址', 'H1-url');
});
check('H2 3080 红线：本机回环的三种写法都拒，其它端口放行（无绕过开关）', () => {
  for (const url of ['http://127.0.0.1:3080/', 'http://localhost:3080/?token=x', 'http://[::1]:3080/']) {
    const error = assertThrows(() => assertNotLiveGuiUrl(url), '3080', `H2-${url}`);
    assert(error instanceof UsageError, `撞 3080 应是用法错误（exit 2），实得 ${error.constructor.name}`);
    assert(String(error.message).includes('绝不碰'), '报错必须点名"绝不碰"这条红线');
  }
  assert(assertNotLiveGuiUrl('http://127.0.0.1:46982/?token=x') === 'http://127.0.0.1:46982/?token=x', '独立端口实例应放行');
  assert(assertNotLiveGuiUrl('file:///D:/x/y.html') === 'file:///D:/x/y.html', 'file:// 不是 http 目标，不该被 3080 规则拦');
});
check('H3 URL 的产物名取"主机-端口"，**绝不带 token**（凭据不许落进文件名）', () => {
  const stem = urlStemFor('http://127.0.0.1:46982/?token=supersecret&x=1');
  assert(stem === '127.0.0.1-46982', `产物名应为主机-端口，实得 ${stem}`);
  assert(!stem.includes('supersecret'), 'token 泄进了产物名');
  assert(urlStemFor('http://127.0.0.1:46982/page.html') === '127.0.0.1-46982-page', `带路径时应拼上末段：${urlStemFor('http://127.0.0.1:46982/page.html')}`);
});
check('H4 resolveTargets：URL 目标不做文件存在性检查；文件目标仍全套校验', () => {
  const urlTarget = resolveTargets({ input: 'http://127.0.0.1:46982/?token=x', out: path.join(sandbox, 'url.png'), exists: () => false });
  assert(urlTarget.kind === 'url', `URL 目标的 kind 应为 url，实得 ${urlTarget.kind}`);
  assert(urlTarget.inputPath === null, 'URL 目标不该有 inputPath');
  assert(urlTarget.outPath === path.join(sandbox, 'url.png'), `outPath 不对：${urlTarget.outPath}`);
  const fileTarget = resolveTargets({ input: inputHtml, out: path.join(sandbox, 'file.png'), exists: existsSync });
  assert(fileTarget.kind === 'file' && fileTarget.fileUrl.startsWith('file:///'), `文件目标应给 file:// URL，实得 ${fileTarget.fileUrl}`);
  assertThrows(() => resolveTargets({ input: path.join(sandbox, 'nope.html'), out: 'x.png' }), '不存在', 'H4-missing');
  assertThrows(
    () => resolveTargets({ input: 'http://127.0.0.1:3080/', out: 'x.png' }),
    '绝不碰',
    'H4-live',
  );
});
check('H5 等锚点超时**必须报错**（不许静默出一张空图当成功）', () => {
  const error = assertThrows(() => assertAnchorFound({ count: 0 }, '[data-guif-panel]', 15_000), '等锚点超时', 'H5');
  assert(String(error.message).includes('不截图'), '报错必须说清"不截图"');
  assert(String(error.message).includes('15000'), '报错应带上等了多久');
  assert(assertAnchorFound({ count: 3 }, 'x', 10) === 3, '命中时应回条数');
});
check('H6 等锚点的选择器非法 ⇒ 用法错误（"你传错了"与"页面没出现"分开）', () => {
  const error = assertThrows(() => assertAnchorFound({ error: 'is not a valid selector' }, '###', 0), '不是合法的 CSS 选择器', 'H6');
  assert(error instanceof UsageError, `非法选择器应是 UsageError（exit 2），实得 ${error.constructor.name}`);
});
check('H7 按选择器裁剪：不在场 / 0 尺寸 / 非法选择器 三种都必须报错', () => {
  assertThrows(() => assertElementRect({ found: false }, '[data-guif-panel]'), '找不到要裁剪的元素', 'H7-missing');
  assertThrows(() => assertElementRect({ found: true, rect: { x: 0, y: 0, width: 0, height: 10 } }, 'x'), '尺寸为 0', 'H7-zero');
  const bad = assertThrows(() => assertElementRect({ error: 'nope' }, '###'), '不是合法的 CSS 选择器', 'H7-bad');
  assert(bad instanceof UsageError, '非法选择器应是 UsageError');
  const rect = assertElementRect({ found: true, tag: 'DIV', rect: { x: 10.4, y: 20.6, width: 300.2, height: 90.5 } }, 'x');
  assert(rect.x === 10 && rect.y === 21 && rect.width === 300 && rect.height === 91, `外框取整不对：${JSON.stringify(rect)}`);
});
check('H8 点击目标不在场 / 0 尺寸 / 非法选择器 都必须报错（不许静默跳过点击）', () => {
  assertThrows(() => assertClickPoint({ found: false }, '[data-guif-glyph]'), '找不到要点击的元素', 'H8-missing');
  assertThrows(() => assertClickPoint({ found: true, zeroSize: true }, 'x'), '尺寸为 0', 'H8-zero');
  const bad = assertThrows(() => assertClickPoint({ error: 'nope' }, '###'), '不是合法的 CSS 选择器', 'H8-bad');
  assert(bad instanceof UsageError, '非法选择器应是 UsageError');
});
check('H9 点击的两条路径形状：js 走最近的外壳 button，真鼠标必带命中测试', () => {
  const js = clickJsExpression('[data-guif-glyph]', 1);
  assert(js.includes('.closest("button")'), 'js 点击必须对最近的 button 派发（坞入口实测路径）');
  assert(js.includes('[1]'), 'js 点击应支持 index（多个坞入口时挑第几个）');
  const mouse = clickPointExpression('[data-guif-glyph]');
  assert(mouse.includes('elementFromPoint'), '真鼠标点击必须先做命中测试（"点了没反应"要能说清是被谁挡住）');
  assert(mouse.includes('getBoundingClientRect'), '真鼠标点击要用元素中心点');
  assert(selectorRectExpression('[data-guif-panel]').includes('window.scrollX'), '量外框必须换算到页面坐标（CDP clip 用的是页面坐标）');
  assert(selectorProbeExpression('[data-guif-panel]').includes('querySelectorAll'), '等锚点靠数命中个数');
});
check('H10 裁剪收尾：只一步截图、带 clip、开 captureBeyondViewport（不撑设备指标）', () => {
  const steps = buildCaptureSteps({ width: 1440, height: 900, pageHeight: null, fullPage: false, clip: { x: 12, y: 34, width: 320, height: 240, tag: 'DIV' } });
  assert(steps.length === 1, `裁剪模式应只有 1 步，实得 ${steps.length}`);
  assert(steps[0].method === 'Page.captureScreenshot', `裁剪那步应是截图，实得 ${steps[0].method}`);
  const clip = steps[0].params.clip;
  assert(clip.x === 12 && clip.y === 34 && clip.width === 320 && clip.height === 240, `clip 没传对：${JSON.stringify(clip)}`);
  assert(clip.scale === 1, 'clip.scale 必须是 1（否则像素宽高对不上请求）');
  assert(steps[0].params.captureBeyondViewport === true, '元素在折线以下时也要拍得到');
  assert(steps[0].params.format === 'png' && steps[0].params.fromSurface === true, '格式/来源不能漂');
});
check('H11 新参数的用法错误面：互斥、非法取值、非数字、负数', () => {
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--full-page', '--selector', 'div']), '不能同时用', 'H11-both');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--click-via', 'bogus']), '--click-via', 'H11-via');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--wait-for-timeout', 'abc']), '--wait-for-timeout', 'H11-timeout');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--click-index', '-1']), '--click-index', 'H11-index');
  assertThrows(() => parseArgs(['a.html', '--out', 'x.png', '--wait-for']), '--wait-for 需要一个参数值', 'H11-missing');
});
check('H12 新参数默认值固定（编排器与脚本都按这组默认写）', () => {
  const options = parseArgs(['a.html', '--out', 'x.png']);
  assert(options.waitFor === null, `--wait-for 默认应为 null，实得 ${options.waitFor}`);
  assert(options.waitForTimeoutMs === DEFAULT_WAIT_FOR_TIMEOUT_MS && options.waitForTimeoutMs === 15_000, `等锚点超时默认应为 15000，实得 ${options.waitForTimeoutMs}`);
  assert(options.selector === null && options.click === null, '默认不裁剪、不点击');
  assert(options.clickIndex === 0 && options.clickVia === 'mouse', '点击默认点第 0 个、走真鼠标');
  const clicked = parseArgs(['a.html', '--out', 'x.png', '--click', 'b', '--click-index', '2', '--click-via', 'js', '--selector', 'p', '--wait-for', 'q']);
  assert(clicked.clickIndex === 2 && clicked.clickVia === 'js' && clicked.selector === 'p' && clicked.waitFor === 'q', '新参数没解析对');
});
check('H13 parsePngSize 真读 IHDR 宽高；不是 PNG / 缺 IHDR 一律 null', () => {
  const size = parsePngSize(makePng(1440, 900));
  assert(size !== null && size.width === 1440 && size.height === 900, `读到的尺寸不对：${JSON.stringify(size)}`);
  assert(parsePngSize(Buffer.from('not a png')) === null, '非 PNG 应回 null');
  assert(parsePngSize(Buffer.alloc(8)) === null, '太短应回 null');
  const noIhdr = makePng(10, 10);
  noIhdr.write('XXXX', 12, 'latin1');
  assert(parsePngSize(noIhdr) === null, 'IHDR 块名不对应回 null');
});
check('H14 产物尺寸不符必须翻红（"有图、魔数对、内容不对"是最难发现的假绿）', () => {
  const png = makePng(1440, 900);
  assertPngSize(png, { width: 1440, height: 900 });
  assertPngSize(png, { width: 1441, height: 899 });
  const error = assertThrows(() => assertPngSize(png, { width: 320, height: 240 }), '产物尺寸不符', 'H14');
  assert(String(error.message).includes('1440×900'), '报错应给出实得尺寸');
  assertThrows(() => assertPngSize(Buffer.from('nope'), { width: 1, height: 1 }), '缺 IHDR', 'H14-notpng');
});
check('H15 端到端退出码（离线）：用法错误一律 2，且都发生在起浏览器之前', () => {
  const run = (args) => spawnSync(process.execPath, [SOURCE_FILE, ...args], { encoding: 'utf8' });
  const both = run(['a.html', '--out', 'x.png', '--full-page', '--selector', 'div']);
  assert(both.status === 2, `互斥参数应 exit 2，实得 ${both.status}；stderr=${(both.stderr ?? '').slice(0, 120)}`);
  const live = run(['http://127.0.0.1:3080/?token=x', '--out', 'x.png']);
  assert(live.status === 2, `3080 目标应 exit 2，实得 ${live.status}`);
  assert((live.stderr ?? '').includes('绝不碰'), '3080 的拒绝理由必须出现在 stderr');
  const missing = run(['a.html', '--out']);
  assert(missing.status === 2, `缺参数值应 exit 2，实得 ${missing.status}`);
  const help = run(['--help']);
  assert(help.status === 0 && (help.stdout ?? '').includes('用法'), `--help 应 exit 0 并打用法，实得 ${help.status}`);
});
check('H16 入参归一化：只给一半字段的程序化调用不会被带进"点 undefined 选择器"', () => {
  const partial = normalizeRenderOptions({ input: 'x.html', out: 'x.png', fullPage: true, timeoutMs: 30_000 });
  assert(partial.click === null && partial.selector === null && partial.waitFor === null, '缺省字段必须归成 null（= 不做这一步）');
  assert(partial.clickVia === 'mouse' && partial.clickIndex === 0, '点击的默认值与 CLI 一致');
  assert(partial.waitForTimeoutMs === DEFAULT_WAIT_FOR_TIMEOUT_MS, '等锚点超时应落到默认值');
  assert(partial.width === 1280 && partial.height === 900 && partial.waitMs === 500, '视口/等待落默认值');
  const explicit = normalizeRenderOptions({ click: '[data-guif-glyph]', clickVia: 'js', clickIndex: 2, selector: 'p', waitFor: 'q', waitForTimeoutMs: 60_000 });
  assert(
    explicit.click === '[data-guif-glyph]' && explicit.clickVia === 'js' && explicit.clickIndex === 2 && explicit.selector === 'p' && explicit.waitForTimeoutMs === 60_000,
    '给全了的字段不该被默认值覆盖',
  );
  assert(normalizeRenderOptions(null).clickVia === 'mouse', 'null 入参也要能归一化（不许抛）');
});

// ── S. 编排器（dsh-shot）的静态纪律与离线参数面 ─────────────────────────────────
}
