// tools/render-shot/expressions.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 页面侧表达式与 CDP 命令字面量（量高 / 等字体 / 唤醒 / 探测 / 点击）

export const PAGE_HEIGHT_EXPRESSION =
  'Math.max(' +
  'document.documentElement ? document.documentElement.scrollHeight : 0,' +
  'document.body ? document.body.scrollHeight : 0,' +
  'document.documentElement ? document.documentElement.offsetHeight : 0,' +
  'window.innerHeight || 0)';

/** 等字体就绪（没有 FontFaceSet 的实现直接放行）。 */
export const FONTS_READY_EXPRESSION =
  'document.fonts && document.fonts.ready' +
  ' ? document.fonts.ready.then(function () { return true; })' +
  ' : Promise.resolve(true)';

/** 整页唤醒：关掉平滑滚动 + 把 loading="lazy" 改 eager + 回顶端（配合下方滚动扫描）。 */
export const WAKE_FULL_PAGE_EXPRESSION =
  '(function () {' +
  ' if (document.documentElement) { document.documentElement.style.scrollBehavior = "auto"; }' +
  ' var images = document.querySelectorAll("img[loading=\\"lazy\\"]");' +
  ' var woken = images.length;' +
  ' for (var i = 0; i < images.length; i += 1) { images[i].loading = "eager"; }' +
  ' window.scrollTo(0, 0);' +
  ' return woken;' +
  '})()';

/** 按 `--wait-ms` 的语义构造"等字体"那一步（`awaitPromise` 必须显式给，否则拿到的是 Promise 对象）。 */
export function fontsReadyCommand() {
  return {
    method: 'Runtime.evaluate',
    params: { expression: FONTS_READY_EXPRESSION, awaitPromise: true, returnByValue: true },
  };
}

/** 量页面高度那一步。 */
export function pageHeightCommand() {
  return { method: 'Runtime.evaluate', params: { expression: PAGE_HEIGHT_EXPRESSION, returnByValue: true } };
}

/** 唤醒整页内容那一步（只在 `--full-page` 时进计划）。 */
export function wakeFullPageCommand() {
  return { method: 'Runtime.evaluate', params: { expression: WAKE_FULL_PAGE_EXPRESSION, returnByValue: true } };
}

// ── 选择器三件事：等锚点 / 量外框 / 点击（全部是**字面量 + 纯判据**，离线可测）──────────

/**
 * 等锚点用的表达式：数命中个数。
 * **非法选择器不抛**：把错误当数据带回 Node 侧，好让"选择器写错了"（用法错，exit 2）
 * 与"锚点压根没出现"（页面问题，exit 1）分成两种可分辨的失败。
 */
export function selectorProbeExpression(selector) {
  return (
    '(() => {\n' +
    '  try { return { count: document.querySelectorAll(' +
    JSON.stringify(selector) +
    ').length }; }\n' +
    '  catch (error) { return { error: String((error && error.message) || error) }; }\n' +
    '})()'
  );
}

/**
 * 量元素外框用的表达式。坐标取**页面坐标**（视口坐标 + 滚动量）——
 * CDP `Page.captureScreenshot` 的 `clip` 就是页面坐标系；用视口坐标会让"页面滚动过"的图裁错位置。
 */
export function selectorRectExpression(selector) {
  return (
    '(() => {\n' +
    '  let node = null;\n' +
    '  try { node = document.querySelector(' +
    JSON.stringify(selector) +
    '); }\n' +
    '  catch (error) { return { error: String((error && error.message) || error) }; }\n' +
    '  if (node === null) return { found: false };\n' +
    '  const rect = node.getBoundingClientRect();\n' +
    '  return { found: true, tag: node.tagName, rect: {\n' +
    '    x: rect.left + window.scrollX, y: rect.top + window.scrollY,\n' +
    '    width: rect.width, height: rect.height } };\n' +
    '})()'
  );
}

/**
 * 真鼠标点击的落点：元素中心 + `elementFromPoint` 命中测试。
 * 命中测试不是装饰：坞入口被一个无 class 的覆盖 DIV 挡住那次，就是靠它把"点了没反应"变成可读事实。
 */
export function clickPointExpression(selector, index = 0) {
  return (
    '(() => {\n' +
    '  let node = null;\n' +
    '  try { node = document.querySelectorAll(' +
    JSON.stringify(selector) +
    `)[${index}] ?? null; }\n` +
    '  catch (error) { return { error: String((error && error.message) || error) }; }\n' +
    '  if (node === null) return { found: false };\n' +
    '  const rect = node.getBoundingClientRect();\n' +
    '  if (rect.width === 0 || rect.height === 0) return { found: true, zeroSize: true };\n' +
    '  const x = rect.left + rect.width / 2;\n' +
    '  const y = rect.top + rect.height / 2;\n' +
    '  const top = document.elementFromPoint(x, y);\n' +
    '  return { found: true, zeroSize: false, x, y, tag: node.tagName,\n' +
    '    hit: { tag: top === null ? null : top.tagName,\n' +
    '           self: top !== null && (top === node || node.contains(top)) } };\n' +
    '})()'
  );
}

/**
 * JS 点击的表达式：`el.closest("button") ?? el` 派发 `click()`。
 * 为什么默认要往上找 button：坞入口的图标在外壳**行按钮内部**，点图标本身会被覆盖层吞；
 * 对外壳行按钮派发 click 才开面板（verify/real-machine 实测结论）。
 * `js` 路径只派发一个 `click`、**不产生 pointerdown** —— 这一条也是记账的一部分（见 README）。
 */
export function clickJsExpression(selector, index = 0) {
  return (
    '(() => {\n' +
    '  let el = null;\n' +
    '  try { el = document.querySelectorAll(' +
    JSON.stringify(selector) +
    `)[${index}] ?? null; }\n` +
    '  catch (error) { return { error: String((error && error.message) || error) }; }\n' +
    '  if (el === null) return { ok: false, reason: "missing" };\n' +
    '  const target = el.closest("button") ?? el;\n' +
    '  target.click();\n' +
    '  return { ok: true, tag: el.tagName, clicked: target.tagName };\n' +
    '})()'
  );
}

/** 等锚点：超时是**失败**（宁可报错，也不静默出一张空图当成功）。 */
