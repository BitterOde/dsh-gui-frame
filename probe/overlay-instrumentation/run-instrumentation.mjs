/**
 * run-instrumentation.mjs —— **插桩定位**：对话层开出后 overlay 宿主子树从 DOM 消失、零 console 报错。
 *
 * 与 `verify/real-machine/**` 的关系（**只读复用，一个字节都不改那边**）：
 *   - 复用它的两个零件：`lib/dsh.mjs`（临时 profile / 实例生命周期 / 精确回收）与 `lib/cdp.mjs`（headless Edge + CDP）；
 *   - **不 import `lib/judge.mjs`**、不调 `run.mjs`：装置判据此刻正在改口径，
 *     结论不能被一个正在变的仪器牵着走；点击/等待/采样都在本文件里自实现，判据与读数全部出自本探针。
 *
 * 纪律（与装置 README 一致）：
 *   - 只用**自己新建的临时 profile**（`guit58<stamp>`，出厂模板）+ 自己的 `--port`；**绝不写 `web`、绝不碰 127.0.0.1:3080**（只读它的 PID 做对照）；
 *   - 收尾只回收自己起的进程：实例按 pid 直杀 + 轮询端口释放；Edge 按命令行里的**专属 `--user-data-dir` 标记**回收；
 *   - 插桩脚本在 `probe/overlay-instrumentation/page-instrument.js`（本目录），页面侧只观察、不改产物代码。
 *
 * 三轮场景（每轮一次导航 ⇒ 页面侧 `window.__T58__` 是干净的）：
 *   A 复现轮：demo 面板 → 第④段 → 开浮动窗 → 开对话层（复刻装置里那条已验证的点击序列），密集采样；
 *   B 二分轮：菜单第④段 → **只开对话层**（不开窗）⇒ 判「必须先后开窗」还是「对话层单独就够」；
 *   C 二分轮：**绕开 demo** 直接 `service.overlay.open({family:'dialog'})`（需要 ctx 捕获成功）⇒ 判「demo 的 React 路径」还是「overlay/dialog 路径」。
 * 每轮结束前跑 `selftest()`：人为移走一根 overlay 根节点，断言采样器与 observer 确实看得见（反假绿自证）。
 *
 * 退出码：0 = 给出了可证伪的归属判定；2 = 现象未复现（宿主活着）；1 = 未能定位 / 自证失败（不得据以立项）。
 *   跑法：node probe/overlay-instrumentation/run-instrumentation.mjs [--keep] [--passes=a,b,c] [--profile=名] [--out=目录]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addPlugin, countLoaderEntry, createProfileFromTemplate, dumpConfig, isPortListening, listenerPid, pickFreePort, profileDir, startServer } from '../../verify/real-machine/lib/dsh.mjs';
import { CdpSession, launchEdge, sleep, waitForPageTarget } from '../../verify/real-machine/lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');
const INSTRUMENT_PATH = path.join(HERE, 'page-instrument.js');
const GUI_FRAME_ENTRY_ID = 'gui-frame';
const LINK_SPEC = `link:${PKG_DIR}`;

const argValue = (name) => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};
const KEEP = process.argv.includes('--keep');
const DRY_RUN = process.argv.includes('--dry-run');
const PASSES = (argValue('passes') ?? 's').split(',').map((item) => item.trim().toLowerCase()).filter((item) => item !== '');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const profileName = argValue('profile') ?? `guit58${Date.now().toString(36)}`;
const outDir = path.resolve(argValue('out') ?? path.join(PKG_DIR, 'probe', 'evidence', `t58-${stamp}`));
const edgeUserDataDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', `guif-t58-${stamp}`);

const state = { servers: [], edges: [], session: null, serverPorts: [] };

const say = (line) => console.log(line);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ── 页面侧小工具（自实现，不依赖装置判据）────────────────────────────────────────────────────

/** CDP 真鼠标点击 + 命中测试（命中谁、是否命中自身都记下来 —— 兜底不许悄悄换绿）。 */
async function realClick(session, selector, { index = 0 } = {}) {
  const box = await session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes[${index}] ?? null;
    if (node === null) return { missing: true, count: nodes.length };
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { missing: false, zeroSize: true, count: nodes.length };
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const top = document.elementFromPoint(x, y);
    return {
      missing: false,
      x, y,
      self: top === node,
      hitTag: top === null ? null : top.tagName.toLowerCase(),
      hitClass: top === null ? null : String(top.className ?? '').slice(0, 60),
    };
  })()`);
  if (box.missing === true) return { ok: false, reason: `找不到 ${selector}`, count: box.count };
  if (box.zeroSize === true) return { ok: false, reason: `${selector} 尺寸为 0`, count: box.count };
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 });
  return { ok: true, hit: { self: box.self, tag: box.hitTag, className: box.hitClass, x: box.x, y: box.y } };
}

/** JS 兜底点击（只在真鼠标没生效时用；调用点负责把两条策略都记账）。 */
function jsClick(session, selector, index = 0) {
  return session.evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes[${index}] ?? null;
    if (node === null) return { ok: false, reason: 'missing', count: nodes.length };
    node.click();
    return { ok: true };
  })()`);
}

const t58 = (session, expr) => session.evaluate(`window.__T58__ === undefined ? { __noInstrument: true } : (${expr})`);
const sample = (session, label) => t58(session, `window.__T58__.sample(${JSON.stringify(label)})`);
const dump = (session) => t58(session, 'window.__T58__.dump()');

async function waitUntil(session, expr, { timeoutMs = 20_000, gapMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await session.evaluate(expr);
    if (last === true) return { ok: true, last };
    await sleep(gapMs);
  }
  return { ok: false, last };
}

/** 等 demo 就绪（坞入口出现 + demo 标记出现）——装置同款等待的含义，这里自己实现。 */
async function waitDemoReady(session, timeoutMs = 25_000) {
  return waitUntil(session, `(() => document.querySelectorAll('[data-guif-glyph]').length > 0 && document.querySelectorAll('[data-guif-demo-section],[data-guif-demo-open]').length > 0)()`, { timeoutMs });
}

/**
 * 开 **demo 面板**（不是坞面板）：坞入口点开的第一块面板是 **dock 面板**，
 * demo 面板要从坞列表里的 demo 那条进去 —— 判据同装置：面板工具栏同时有 `layout` 与 `overlay` 才算 demo 面板。
 * 逐条坞入口点（JS `closest('button').click()` 优先，再真鼠标兜底），两条策略都记账。
 */
async function ensureDemoPanel(session) {
  const readState = () => session.evaluate(`(() => ({
    panels: document.querySelectorAll('[data-guif-panel]').length,
    glyphs: document.querySelectorAll('[data-guif-glyph]').length,
    actions: [...document.querySelectorAll('[data-guif-action]')].map((el) => String(el.getAttribute('data-guif-action'))),
  }))()`);
  const hasDemo = (state) => state.actions.includes('layout') && state.actions.includes('overlay');
  let state = await readState();
  if (hasDemo(state)) return { opened: true, via: 'already-open', actions: state.actions };
  const tried = [];
  for (let index = 0; index < Math.max(state.glyphs, 1); index += 1) {
    const clicked = await session.evaluate(`(() => {
      const glyphs = [...document.querySelectorAll('[data-guif-glyph]')];
      const glyph = glyphs[${index}] ?? null;
      if (glyph === null) return 'missing';
      (glyph.closest('button') ?? glyph).click();
      return 'clicked';
    })()`);
    await sleep(1200);
    state = await readState();
    tried.push(`row#${index}:${clicked}${state.panels > 0 ? '(有面板)' : ''}`);
    if (hasDemo(state)) return { opened: true, via: `row#${index}`, actions: state.actions, tried };
  }
  for (let index = 0; index < Math.max(state.glyphs, 1); index += 1) {
    const mouse = await realClick(session, '[data-guif-glyph]', { index });
    await sleep(900);
    state = await readState();
    tried.push(`mouse#${index}:${mouse.ok === true ? 'clicked' : mouse.reason}`);
    if (hasDemo(state)) return { opened: true, via: `mouse#${index}`, actions: state.actions, tried };
  }
  return { opened: false, reason: '点遍坞入口仍未出现 demo 工具栏（layout+overlay）', actions: state.actions, tried };
}

/** 等坞入口出现（页面起来的最低门槛；平台服务可能晚到，给足时间）。 */
async function waitGlyph(session, timeoutMs = 30_000) {
  return waitUntil(session, `document.querySelectorAll('[data-guif-glyph]').length > 0`, { timeoutMs });
}

/** 等 demo 段出现（面板开出来后 demo 能力可能还在补装窗口里）。 */
async function waitDemoMarks(session, timeoutMs = 30_000) {
  return waitUntil(session, `document.querySelectorAll('[data-guif-demo-section],[data-guif-demo-open]').length > 0`, { timeoutMs });
}

/**
 * 页面公共前置：等坞入口 → 开 **demo 面板** → 等 demo 段 → 切第④段。
 * 全程记诊断（面板正文、段/按钮清单）——「场景没跑起来」与「现象没复现」必须能分开。
 */
async function setupPage(session, tag) {
  const setup = { tag };
  setup.glyph = await waitGlyph(session);
  setup.panel = await ensureDemoPanel(session);
  setup.demoMarksBefore = await session.evaluate(`[...document.querySelectorAll('[data-guif-demo-section],[data-guif-demo-open]')].map((el) => el.getAttribute('data-guif-demo-section') ?? el.getAttribute('data-guif-demo-open'))`);
  setup.demoMarks = await waitDemoMarks(session, 30_000);
  setup.dumpAfterWait = await sample(session, `${tag}-setup-after-wait`);
  setup.section = await ensureOverlaySection(session);
  setup.ready = await sample(session, `${tag}-setup-ready`);
  return setup;
}

/** 开 demo 面板：先真鼠标点坞入口，没开出来再 JS 兜底（两条策略都记账）。 */
async function ensurePanel(session) {
  const via = [];
  if ((await session.evaluate(`document.querySelectorAll('[data-guif-panel]').length`)) > 0) return { opened: true, via: ['already-open'] };
  const mouse = await realClick(session, '[data-guif-glyph]');
  via.push(mouse.ok === true ? `mouse:${mouse.hit.self === true ? '命中自身' : `遮挡(${mouse.hit.tag}.${mouse.hit.className})`}` : `mouse:${mouse.reason}`);
  let opened = (await waitUntil(session, `document.querySelectorAll('[data-guif-panel]').length > 0`, { timeoutMs: 6_000 })).ok;
  if (!opened) {
    const fallback = await jsClick(session, '[data-guif-glyph]');
    via.push(fallback.ok === true ? 'js-click' : `js:${fallback.reason}`);
    opened = (await waitUntil(session, `document.querySelectorAll('[data-guif-panel]').length > 0`, { timeoutMs: 6_000 })).ok;
  }
  return { opened, via };
}

/** 切到 demo 第④段（overlay）：点 `[data-guif-action="overlay"]`，鼠标无效走 JS 兜底。 */
async function ensureOverlaySection(session) {
  const via = [];
  const present = () => session.evaluate(`[...document.querySelectorAll('[data-guif-demo-section]')].some((el) => el.getAttribute('data-guif-demo-section') === 'overlay')`);
  if (await present()) return { present: true, via: ['already'] };
  const mouse = await realClick(session, '[data-guif-action="overlay"]');
  via.push(mouse.ok === true ? `mouse:${mouse.hit.self === true ? '命中自身' : `遮挡(${mouse.hit.tag}.${mouse.hit.className})`}` : `mouse:${mouse.reason}`);
  let ok = await waitUntil(session, `(() => [...document.querySelectorAll('[data-guif-demo-section]')].some((el) => el.getAttribute('data-guif-demo-section') === 'overlay'))()`, { timeoutMs: 4_000 }).then((r) => r.ok);
  if (!ok) {
    const fallback = await jsClick(session, '[data-guif-action="overlay"]');
    via.push(fallback.ok === true ? 'js-click' : `js:${fallback.reason}`);
    ok = await waitUntil(session, `(() => [...document.querySelectorAll('[data-guif-demo-section]')].some((el) => el.getAttribute('data-guif-demo-section') === 'overlay'))()`, { timeoutMs: 4_000 }).then((r) => r.ok);
  }
  return { present: ok, via };
}

/**
 * 打开一扇浮层（`window` / `dialog`）：真鼠标 → 以「出现的证据」判是否生效 → 不生效才 JS 兜底。
 * 判据用**两类证据**：z 锚点（`[data-guif-z]`）与 demo 的已开行（`dd`）——任一增长即认生效。
 */
async function openDemoLayer(session, which, label) {
  const countExpr = `(() => ({ z: document.querySelectorAll('[data-guif-z]').length, rows: document.querySelectorAll('[data-guif-overlay-opened] dd').length, windows: document.querySelectorAll('[data-guif-window]').length }))()`;
  const before = await session.evaluate(countExpr);
  const via = [];
  const grew = (now) => now.z > before.z || now.rows > before.rows || now.windows > before.windows;
  const mouse = await realClick(session, `[data-guif-demo-open="${which}"]`);
  via.push(mouse.ok === true ? `mouse:${mouse.hit.self === true ? '命中自身' : `遮挡(${mouse.hit.tag}.${mouse.hit.className})`}` : `mouse:${mouse.reason}`);
  await sleep(900);
  let after = await session.evaluate(countExpr);
  if (!grew(after)) {
    const fallback = await jsClick(session, `[data-guif-demo-open="${which}"]`);
    via.push(fallback.ok === true ? 'js-click' : `js:${fallback.reason}`);
    await sleep(900);
    after = await session.evaluate(countExpr);
  }
  const s = await sample(session, `${label}-after-open`);
  return { via, before, after, grew: grew(after), sample: s };
}

// ── 三轮场景 ─────────────────────────────────────────────────────────────────────────────────

/** 密集采样：label#1, label#2 … 用于看清「消失发生在哪一拍」。 */
async function denseSamples(session, label, offsets = [0, 60, 150, 300, 600, 1200, 2400, 4000]) {
  const rows = [];
  let elapsed = 0;
  for (const offset of offsets) {
    if (offset > elapsed) {
      await sleep(offset - elapsed);
      elapsed = offset;
    }
    rows.push(await sample(session, `${label}@${offset}ms`));
  }
  return rows;
}

/** 只走 JS `element.click()`（**不发 pointerdown**）——「点外关闭」路径的负控。 */
async function openDemoLayerJs(session, which, label) {
  const countExpr = `(() => ({ z: document.querySelectorAll('[data-guif-z]').length, rows: document.querySelectorAll('[data-guif-overlay-opened] dd').length, windows: document.querySelectorAll('[data-guif-window]').length }))()`;
  const before = await session.evaluate(countExpr);
  const clicked = await jsClick(session, `[data-guif-demo-open="${which}"]`);
  await sleep(900);
  const after = await session.evaluate(countExpr);
  const s = await sample(session, `${label}-after-open`);
  return { via: [clicked.ok === true ? 'js-only(负控：无 pointerdown)' : `js:${clicked.reason}`], before, after, grew: after.z > before.z || after.rows > before.rows || after.windows > before.windows, sample: s };
}

/** 直接叫服务面开一层（**完全不发 DOM 事件**）——第三条独立路径。 */
async function openDirect(session, spec, label) {
  const result = await t58(session, `window.__T58__.openDirect(${JSON.stringify(spec)})`);
  await sleep(700);
  const s = await sample(session, `${label}-after-open`);
  return { result, sample: s };
}

/** Esc（CDP 真键盘）。 */
async function pressEscape(session) {
  const params = { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await session.send('Input.dispatchKeyEvent', params);
  await session.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
}

/**
 * 主场景（**一次页面加载跑完**，这样 ctx/服务面捕获不会因为重新导航而丢）：
 *   S1 真鼠标开浮动窗 → S2 真鼠标开对话层（装置旧口径下「窗口锚点先有后无」就发生在这里）
 *   → S3 清场 → S4/S5 **JS 点击**（无 pointerdown）开同样的两扇（负控：预测两扇共存）
 *   → S6 **直接调服务面**（无任何 DOM 事件）开两扇 → S7 Esc 只关栈顶
 * 差异对比（S2 vs S5）就是「点外关闭」归属的判据：唯一变量＝有没有真 pointerdown。
 */
async function suite(session) {
  const pass = { name: 'S：三路点击策略差分（鼠标 / JS / 直接 API）+ Esc', steps: [] };
  const step = async (label, note) => {
    const s = await sample(session, label);
    pass.steps.push({ label, note: note ?? null, sample: s });
    return s;
  };
  pass.setup = await setupPage(session, 'S');
  pass.baseline = await step('S0-baseline', '面板第④段就绪、还没开任何浮层');
  pass.serviceBefore = await t58(session, 'window.__T58__.serviceFacts()');

  pass.mouseWindow = await openDemoLayer(session, 'window', 'S1-mouse-window');
  pass.afterMouseWindow = await step('S1-after-mouse-window', '真鼠标开窗后的宿主/栈读数');

  pass.mouseDialog = await openDemoLayer(session, 'dialog', 'S2-mouse-dialog');
  pass.afterMouseDialog = await denseSamples(session, 'S2-after-mouse-dialog', [0, 120, 400, 1000, 2000]);

  await jsClick(session, '[data-guif-demo-close-all]');
  await sleep(800);
  pass.afterCloseAll = await step('S3-after-close-all', 'JS 点「全部关闭」清场');

  pass.jsWindow = await openDemoLayerJs(session, 'window', 'S4-js-window');
  pass.jsDialog = await openDemoLayerJs(session, 'dialog', 'S5-js-dialog');
  pass.afterJsBoth = await denseSamples(session, 'S5-after-js-both', [0, 200, 800, 2000]);

  await jsClick(session, '[data-guif-demo-close-all]');
  await sleep(800);
  pass.directWindow = await openDirect(session, { id: 't58-direct-window', family: 'floating', title: 'T58 直接开的浮动窗' }, 'S6-direct-window');
  pass.directDialog = await openDirect(session, { id: 't58-direct-dialog', family: 'dialog', title: 'T58 直接开的对话层', description: '绕开 demo 与任何 DOM 事件' }, 'S6-direct-dialog');
  pass.afterDirectBoth = await denseSamples(session, 'S6-after-direct-both', [0, 200, 800, 2000]);

  await pressEscape(session);
  pass.afterEscape = await denseSamples(session, 'S7-after-escape', [0, 300, 1200]);
  pass.serviceAfter = await t58(session, 'window.__T58__.serviceFacts()');
  pass.selftest = await t58(session, 'window.__T58__.selftest()');
  pass.dump = await dump(session);
  return pass;
}

// ── 判读：把读数折成「可证伪的归属」──────────────────────────────────────────────────────────

/**
 * 判定规则（**先写死，后跑**；每条都写明「若观察到 X ⇒ 归属 Y」）：
 *   R0 场景闸：本轮必须真的开出过浮层（`openWindow.grew` / `openDialog.grew` / `direct.ok` / 样本里 `layerAnchors` 非空）。
 *      场景没跑起来 ⇒ 「未定位（场景未跑起来）」，不许把「栈本来就空」读成「栈被清空」（第一轮踩过）。
 *   R1 宿主被重挂：`[data-guif-overlay-root]` 节点 id 变化，或旧根 `isConnected=false` 且另有新根。
 *   R2 宿主整棵卸载：根计数 0、旧根脱离文档、无新根接上。
 *   R3 层栈被清空：根节点 id 不变、`isConnected=true`，而 `data-guif-overlay-layers` 读到 0/子节点 0。
 *   R4 触发源：切片仍在且 api 对象 id 不变 ⇒ 非 dispose；切片消失 / api id 变化 / 抓到 `api.dispose()` 或
 *      切片 disposer 调用 ⇒ 走了 `raw()`（附调用栈）。
 *   R5 **差分归属（本案的关键）**：S2（真鼠标开对话层）与 S5（JS 点击开同样两扇）**唯一变量是有没有真 pointerdown**。
 *      若 S2 里浮窗层消失而 S5 里两扇共存 ⇒ 归属为**设计内的「点外只关最上层」被真鼠标 pointerdown 触发**，
 *      与「宿主/栈被清空」无关（宿主根始终在、栈长读数与层锚点自洽）。
 */
function classify(pass) {
  const openWindow = pass?.openWindow ?? null;
  const openDialog = pass?.mouseDialog ?? null;
  const scenarioRan = (openWindow !== null && openWindow.grew === true)
    || (openDialog !== null && openDialog.grew === true)
    || pass?.directDialog?.result?.ok === true
    || (pass?.steps ?? []).some((row) => (row.sample?.layerAnchors ?? []).length > 0);
  if (!scenarioRan) return { verdict: '未定位（场景未跑起来）', scenarioRan: false, sightings: {} };
  const all = [
    ...(pass.steps ?? []).map((row) => ({ label: row.label, sample: row.sample })),
    ...(pass.afterMouseDialog ?? []).map((row) => ({ label: row.label, sample: row })),
    ...(pass.afterJsBoth ?? []).map((row) => ({ label: row.label, sample: row })),
    ...(pass.afterDirectBoth ?? []).map((row) => ({ label: row.label, sample: row })),
    ...(pass.afterEscape ?? []).map((row) => ({ label: row.label, sample: row })),
  ];
  const sightings = {
    rootGone: all.filter((row) => row.sample?.rootCount === 0).map((row) => row.label),
    rootDetached: all.filter((row) => row.sample?.refRootConnected === false).map((row) => row.label),
    rootReplaced: all.filter((row) => row.sample?.currentRootId !== undefined && row.sample?.refRootId !== undefined && row.sample.currentRootId !== row.sample.refRootId).map((row) => row.label),
  };
  const layersOf = (list) => (list ?? []).map((row) => `${row.label}:${row.rootLayers}/${JSON.stringify(row.layerAnchors)}`);
  const evidence = {
    S1_mouseWindow: layersOf(pass.afterMouseWindow === undefined ? [] : [pass.afterMouseWindow]),
    S2_mouseDialog: layersOf(pass.afterMouseDialog),
    S5_jsBoth: layersOf(pass.afterJsBoth),
    S6_directBoth: layersOf(pass.afterDirectBoth),
    S7_escape: layersOf(pass.afterEscape),
  };
  const anyRootGone = sightings.rootGone.length > 0 || sightings.rootDetached.length > 0 || sightings.rootReplaced.length > 0;
  if (anyRootGone) {
    const which = sightings.rootGone.length > 0 ? '宿主整棵卸载（根计数 0）' : sightings.rootReplaced.length > 0 ? '宿主被重挂（根节点 id 变了）' : '宿主被重挂（旧根脱离）';
    return { verdict: which, scenarioRan, sightings, evidence, reproduced: true };
  }
  // 未复现宿主消失：再看差分——S2 掉层而 S5 共存 ⇒ 点外关闭；S2 也共存 ⇒ 连「窗口先有后无」都没复现
  const s2 = pass.afterMouseDialog ?? [];
  const s5 = pass.afterJsBoth ?? [];
  const s2Layers = s2.length === 0 ? null : s2[s2.length - 1].layerAnchors ?? [];
  const s5Layers = s5.length === 0 ? null : s5[s5.length - 1].layerAnchors ?? [];
  const s2LostWindow = s2Layers !== null && !s2Layers.includes('dsh-gui-frame/demo-window') && s2Layers.length === 1;
  const s5KeepsBoth = s5Layers !== null && s5Layers.length >= 2 && s5Layers.includes('dsh-gui-frame/demo-window');
  if (s2LostWindow && s5KeepsBoth) {
    return {
      verdict: '未复现「宿主整棵消失」；实测＝真鼠标 pointerdown 触发**设计内的点外只关最上层**（差分归属，见 R5）',
      scenarioRan, sightings, evidence, reproduced: false, cause: 'dismiss-on-outside-pointerdown',
    };
  }
  return { verdict: '未复现「宿主整棵消失」（宿主根全程在场，层栈读数自洽）', scenarioRan, sightings, evidence, reproduced: false, cause: s2Layers !== null && s2Layers.length >= 2 ? 'none' : 'unknown' };
}

// ── 主流程 ───────────────────────────────────────────────────────────────────────────────────

say('');
say('== t58 插桩轮：F-t53-2（对话层开出后 overlay 宿主子树消失）==');
say(`  临时 profile：${profileName}｜证据目录：${outDir}`);
say(`  link：${LINK_SPEC}｜轮次：${PASSES.join('/')}｜Edge 标记：${path.basename(edgeUserDataDir)}`);
say('  纪律：独立端口实例 + headless Edge；不写 web、不碰 3080（只读 PID）；收尾只回收自己起的进程。');
say('');

if (DRY_RUN) {
  say('[dry-run] 不建 profile、不起进程、不写证据。');
  process.exitCode = 0;
} else {
  await main();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const instrumentSource = readFileSync(INSTRUMENT_PATH, 'utf8');
  const readings = {
    stamp,
    profileName,
    linkSpec: LINK_SPEC,
    edgeUserDataDir,
    passes: {},
    product: {
      libClient: { path: 'lib/client.js', bytes: null, sha256: null, mtime: null },
      instrument: { path: 'probe/overlay-instrumentation/page-instrument.js', bytes: instrumentSource.length },
      srcMtimes: {},
    },
    errors: [],
  };
  const pid3080Before = await listenerPid(3080);
  readings.pid3080Before = pid3080Before;

  // 被测产物的身份（结论要能钉到具体一版字节上：src 正在被别的成员改）
  try {
    const clientFile = path.join(PKG_DIR, 'lib', 'client.js');
    readings.product.libClient.sha256 = sha256(clientFile);
    readings.product.libClient.bytes = readFileSync(clientFile).length;
    readings.product.libClient.mtime = new Date(statMtime(clientFile)).toISOString();
    for (const rel of ['src/client/overlay/host.mjs', 'src/client/overlay/index.mjs', 'src/client/overlay/family.mjs', 'src/client/overlay/stack.mjs', 'src/client/window/floating-window.mjs', 'src/client/demo/sections.mjs', 'src/client/entry.mjs']) {
      const file = path.join(PKG_DIR, rel);
      if (existsSync(file)) readings.product.srcMtimes[rel] = new Date(statMtime(file)).toISOString();
    }
  } catch (error) {
    readings.errors.push({ phase: 'product-identity', message: msg(error) });
  }

  let session = null;
  let url = null;
  try {
    // ① 临时 profile（出厂模板）→ link 装包 → dump-config 恰一次
    const created = await createProfileFromTemplate(profileName);
    readings.profile = { createExit: created.code, entryCountBefore: countLoaderEntry(created.config, GUI_FRAME_ENTRY_ID) };
    const added = await addPlugin(profileName, LINK_SPEC);
    readings.profile.addExit = added.code;
    readings.profile.addTail = `${added.stdout}${added.stderr}`.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-3);
    const dumped = await dumpConfig(profileName);
    readings.profile.entryCountAfter = countLoaderEntry(dumped.config, GUI_FRAME_ENTRY_ID);
    writeFileSync(path.join(outDir, 'dump-config.yml'), dumped.config, 'utf8');
    say(`  [profile] create exit=${created.code}（entry 前 ${readings.profile.entryCountBefore}）→ add exit=${added.code} → entry 后 ${readings.profile.entryCountAfter}（必须 = 1）`);

    // ② 起实例
    const port = await pickFreePort();
    const server = startServer({ profile: profileName, port, logPath: path.join(outDir, 'install-server.log') });
    state.servers.push(server);
    state.serverPorts.push(port);
    const started = await server.waitForUrl();
    url = started.url;
    readings.server = { port, started: url !== null, reason: started.reason ?? null };
    if (url === null) throw new Error(`实例起不来：${started.reason}`);
    say(`  [server] port=${port} 起来了`);

    // ③ headless Edge + 插桩（每次导航都会重跑插桩）
    const passDir = `${edgeUserDataDir}-probe`;
    const cdpPort = await pickFreePort();
    const launched = launchEdge({ userDataDir: passDir, port: cdpPort, logPath: path.join(outDir, 'edge-probe.log') });
    state.edges.push(launched);
    const page = await waitForPageTarget(cdpPort, 30_000);
    session = await CdpSession.attach(page.webSocketDebuggerUrl);
    state.session = session;
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.addInitScript(instrumentSource);

    let firstNavigation = true;
    for (const which of PASSES) {
      const eventsBefore = session.events.length;
      if (firstNavigation) {
        await session.navigated(url);
        firstNavigation = false;
      } else {
        // 重新导航拿一个干净页面（`window.__T58__` 会重新初始化）
        await session.navigated(url);
      }
      await sleep(6_000);
      const instrumentSeen = await t58(session, `({ ready: true, hasLoader: window.__ModuleLoader__ !== undefined, instrument: window.__T58__.version })`);
      // 前置闸：确认页面跑的是**当前产物**，否则一切读数都可能出自旧字节
      const gate = await session.evaluate(`(async () => {
        const urls = [...document.querySelectorAll('script[src]')].map((el) => el.src);
        const hit = urls.find((url) => /gui-frame/.test(url)) ?? null;
        if (hit === null) return { checked: true, found: false, urls };
        try {
          const text = await fetch(hit).then((response) => response.text());
          return { checked: true, found: true, url: hit, bytes: text.length, hasMarker: text.indexOf('useStandInHook') >= 0 };
        } catch (error) {
          return { checked: true, found: true, url: hit, error: String((error && error.message) || error) };
        }
      })()`);
      readings.passes[which] = {
        instrumentSeen,
        gate,
        consoleLedger: null,
        pass: null,
        classify: null,
      };
      say(`  [pass ${which}] 插桩=${JSON.stringify(instrumentSeen)}｜产物闸=${JSON.stringify(gate)}`);
      if (instrumentSeen.__noInstrument === true) {
        readings.errors.push({ phase: `pass-${which}`, message: '插桩没跑起来（window.__T58__ 缺失）' });
        continue;
      }
      const result = which === 's' ? await suite(session) : null;
      if (result === null) {
        readings.errors.push({ phase: `pass-${which}`, message: `未知轮次 ${which}（当前只支持 s：三路点击策略差分）` });
        continue;
      }
      const events = session.events.slice(eventsBefore);
      readings.passes[which].consoleLedger = {
        errors: events.filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error').map((event) => String((event.params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' ')).slice(0, 300)),
        warnings: events.filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'warning').map((event) => String((event.params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' ')).slice(0, 300)),
        exceptions: events.filter((event) => event.method === 'Runtime.exceptionThrown').map((event) => String(event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text ?? '').slice(0, 400)),
        logErrors: events.filter((event) => event.method === 'Log.entryAdded' && event.params.entry.level === 'error').map((event) => String(event.params.entry.text).slice(0, 300)),
      };
      readings.passes[which].pass = result;
      readings.passes[which].classify = classify(result);
      say(`  [pass ${which}] 归属判定：${readings.passes[which].classify.verdict}`);
      writeFileSync(path.join(outDir, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8');
    }
  } catch (error) {
    readings.errors.push({ phase: 'main', message: msg(error), stack: String(error?.stack ?? '').slice(0, 1200) });
    say(`  [error] ${msg(error)}`);
  } finally {
    if (state.session !== null) state.session.close();
    for (const edge of state.edges) edge.stop();
    const reclaimed = await killEdgeByMarker(edgeUserDataDir);
    readings.reclaimedEdgePids = reclaimed;
    const reclaim = [];
    for (const server of state.servers) {
      const row = await server.stopAndVerify();
      reclaim.push(row);
    }
    readings.serverReclaim = reclaim;
    await sleep(600);
    readings.pid3080After = await listenerPid(3080);
    readings.stillListening = [];
    for (const port of state.serverPorts) if (await isPortListening(port)) readings.stillListening.push(port);
    if (!KEEP) {
      for (const target of [profileDir(profileName), `${edgeUserDataDir}-probe`]) {
        try {
          rmSync(target, { recursive: true, force: true });
        } catch (error) {
          readings.errors.push({ phase: 'cleanup', message: msg(error), target });
        }
      }
      readings.cleaned = true;
    }
  }

  // ── 汇总判定与退出码 ─────────────────────────────────────────────────────────────────────
  const verdicts = Object.entries(readings.passes).map(([key, value]) => ({ pass: key, ...(value.classify ?? { verdict: '未定位' }) }));
  const selftests = Object.entries(readings.passes).map(([key, value]) => ({ pass: key, selftest: value.pass?.selftest ?? null }));
  const hasVerdict = verdicts.some((row) => row.scenarioRan === true);
  const reproduced = verdicts.some((row) => row.reproduced === true);
  const selftestOk = selftests.some((row) => row.selftest?.detected === true);
  readings.summary = { verdicts, selftests, hasVerdict, reproduced, selftestOk };
  writeFileSync(path.join(outDir, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8');
  writeFileSync(path.join(outDir, 'report.md'), renderReport(readings), 'utf8');

  say('');
  say(`── 汇总 ── ${verdicts.map((row) => `${row.pass}=${row.verdict}`).join('｜')}`);
  say(`  反假绿自证（能看见人为消失）：${selftestOk ? '通过' : '未通过'}`);
  say(`  3080 PID：前 ${readings.pid3080Before} → 后 ${readings.pid3080After}（必须相同）`);
  say(`  [t58] 读数：${path.relative(PKG_DIR, outDir)}（readings.json + report.md + 实例/Edge 日志）`);
  // 退出码：0 = 给出了可证伪的判定（复现 or 未复现都算）；1 = 未定位 / 自证失败（不得据以立项）
  process.exitCode = hasVerdict && selftestOk ? 0 : 1;
}

// ── 报告 ─────────────────────────────────────────────────────────────────────────────────────

function renderReport(readings) {
  const lines = [];
  lines.push('# t58 插桩读数（F-t53-2：对话层开出后 overlay 宿主子树消失）');
  lines.push('');
  lines.push(`- 时间：${new Date().toISOString()}｜临时 profile：\`${readings.profileName}\`｜link：\`${readings.linkSpec}\``);
  lines.push(`- 被测产物：\`lib/client.js\` ${readings.product.libClient.bytes} 字节｜SHA256 \`${readings.product.libClient.sha256}\`｜mtime ${readings.product.libClient.mtime}`);
  lines.push(`- 3080 PID：前 ${readings.pid3080Before} → 后 ${readings.pid3080After}（本探针全程只读它）`);
  lines.push('');
  lines.push('## 判定规则（先写死，后跑）');
  lines.push('');
  lines.push('- **R0 场景闸**：必须真的开出过浮层（`grew` / `direct.ok` / 层锚点非空）；否则一律「未定位（场景未跑起来）」。');
  lines.push('- **R1 宿主被重挂**：`[data-guif-overlay-root]` 节点 id 变化，或旧根 `isConnected=false` 且另有新根。');
  lines.push('- **R2 宿主整棵卸载**：根计数 0、旧根脱离文档、无新根接上。');
  lines.push('- **R3 层栈被清空**：根节点 id 不变、`isConnected=true`，而 `data-guif-overlay-layers` 读到 0/子节点 0。');
  lines.push('- **R4 触发源**：切片仍在且 api 对象 id 不变 ⇒ 非 dispose；切片消失 / api id 变化 / 抓到 `api.dispose()` 或切片 disposer 调用 ⇒ 走了 `raw()`（附调用栈）。');
  lines.push('- **R5 差分归属（关键）**：S2（真鼠标）与 S5（JS 点击）**唯一变量＝有没有真 pointerdown**；S2 掉层而 S5 共存 ⇒ 归属「设计内的点外只关最上层」。');
  lines.push('');
  lines.push('## 逐轮读数');
  lines.push('');
  for (const [key, value] of Object.entries(readings.passes)) {
    const pass = value.pass ?? {};
    lines.push(`### 轮次 ${key}：${pass.name ?? '(未跑)'}`);
    lines.push('');
    lines.push(`- 归属判定：**${value.classify?.verdict ?? '未定位'}**（场景真的跑起来=${value.classify?.scenarioRan ?? false}｜复现宿主消失=${value.classify?.reproduced ?? false}）`);
    lines.push(`- 宿主消失迹象：${JSON.stringify(value.classify?.sightings ?? null)}`);
    lines.push(`- 插桩可见性：${JSON.stringify(value.instrumentSeen ?? null)}｜产物前置闸：${JSON.stringify(value.gate ?? null)}`);
    lines.push(`- 前置：坞入口=${JSON.stringify(pass.setup?.glyph ?? null)}；demo 面板=${JSON.stringify(pass.setup?.panel ?? null)}；demo 段等待=${JSON.stringify(pass.setup?.demoMarks ?? null)}；第④段=${JSON.stringify(pass.setup?.section ?? null)}`);
    lines.push(`- loader：repatch=${pass.dump?.loader?.repatchCount ?? '?'}｜见过 load ${pass.dump?.loader?.loads?.length ?? '?'} 条｜本插件 factory 命中 ${pass.dump?.loader?.factorySeen?.length ?? '?'}｜apply 捕获 ${pass.dump?.loader?.applyCalls ?? '?'}`);
    lines.push(`- 服务面：${JSON.stringify(pass.dump?.service ?? null)}`);
    lines.push(`- 平台 slots 套壳：${JSON.stringify(pass.dump?.slots ?? null)}`);
    lines.push('');
    lines.push('**各步读数（`/` 前＝宿主自己渲染的栈长 `data-guif-overlay-layers`，后＝层锚点）**');
    lines.push('');
    lines.push('| 步 | 采样点 | 根计数 | 当前根 id | 参照根在文档 | 栈长 | 层锚点 | 窗口锚点 | z 锚点 | 面板 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const rows = [];
    for (const step of pass.steps ?? []) rows.push([step.label, step.note ?? '', step.sample]);
    for (const [name, list] of [['S2-鼠标开对话层', pass.afterMouseDialog], ['S5-JS 开两扇', pass.afterJsBoth], ['S6-直接 API 两扇', pass.afterDirectBoth], ['S7-Esc', pass.afterEscape]]) {
      for (const row of list ?? []) rows.push([row.label, name, row]);
    }
    for (const [label, note, sample] of rows) {
      if (sample === null || sample === undefined) continue;
      lines.push(`| ${label} | ${note} | ${sample.rootCount} | ${sample.currentRootId} | ${sample.refRootInDocument}(connected=${sample.refRootConnected}) | ${sample.rootLayers} | ${JSON.stringify(sample.layerAnchors)} | ${JSON.stringify(sample.windows)} | ${JSON.stringify(sample.zList)} | ${sample.panelCount} |`);
    }
    lines.push('');
    lines.push(`- 开窗（真鼠标）：via=${JSON.stringify(pass.mouseWindow?.via ?? null)}｜before=${JSON.stringify(pass.mouseWindow?.before ?? null)}｜after=${JSON.stringify(pass.mouseWindow?.after ?? null)}｜生效=${pass.mouseWindow?.grew}`);
    lines.push(`- 开对话层（真鼠标）：via=${JSON.stringify(pass.mouseDialog?.via ?? null)}｜after=${JSON.stringify(pass.mouseDialog?.after ?? null)}｜生效=${pass.mouseDialog?.grew}`);
    lines.push(`- 开窗（JS 负控）：via=${JSON.stringify(pass.jsWindow?.via ?? null)}｜生效=${pass.jsWindow?.grew}｜开对话层（JS）：生效=${pass.jsDialog?.grew}`);
    lines.push(`- 直接 API：开窗=${JSON.stringify(pass.directWindow?.result ?? null)}｜开对话层=${JSON.stringify(pass.directDialog?.result ?? null)}`);
    lines.push(`- 反假绿自证：${JSON.stringify(pass.selftest ?? null)}`);
    lines.push(`- 指针/键盘事件账（判点外关闭）：${JSON.stringify((pass.dump?.events ?? []).slice(0, 24))}`);
    lines.push(`- 面板正文（末次）：${JSON.stringify(pass.setup?.ready?.panelText ?? null)}`);
    lines.push(`- console（本轮）：错误 ${(value.consoleLedger?.errors ?? []).length} 条｜例外 ${(value.consoleLedger?.exceptions ?? []).length} 条｜Log.error ${(value.consoleLedger?.logErrors ?? []).length} 条`);
    for (const line of value.consoleLedger?.errors ?? []) lines.push(`  - err: ${line}`);
    for (const line of value.consoleLedger?.exceptions ?? []) lines.push(`  - exception: ${line}`);
    lines.push('');
  }
  lines.push('## 收尾');
  lines.push('');
  lines.push(`- 回收：实例 ${JSON.stringify(readings.serverReclaim ?? [])}｜Edge PID ${JSON.stringify(readings.reclaimedEdgePids ?? [])}`);
  lines.push(`- 仍在监听的自起端口：${JSON.stringify(readings.stillListening ?? [])}`);
  lines.push(`- 过程中的错误：${JSON.stringify(readings.errors ?? [])}`);
  lines.push('');
  return lines.join('\n');
}

// ── 杂项 ─────────────────────────────────────────────────────────────────────────────────────

function statMtime(file) {
  return existsSync(file) ? statSync(file).mtimeMs : null;
}
function msg(error) {
  return String((error && error.message) || error).slice(0, 400);
}

/** 按命令行里的专属 user-data-dir 标记找自己起的 msedge（绝不按进程名大范围杀）。 */
function listEdgeByMarker(marker) {
  return new Promise((resolve) => {
    const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | Select-Object -ExpandProperty ProcessId`;
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('close', () => resolve(out.split(/\s+/).map((value) => value.trim()).filter((value) => value !== '')));
    child.on('error', () => resolve([]));
  });
}

async function killEdgeByMarker(marker) {
  const pids = await listEdgeByMarker(marker);
  for (const pid of pids) {
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      /* 已退出 */
    }
  }
  await sleep(400);
  return pids;
}
