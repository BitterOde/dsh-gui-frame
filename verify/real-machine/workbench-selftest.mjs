#!/usr/bin/env node
/**
 * workbench-selftest.mjs —— 工作台真机判据的**离线有牙自证**。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 真机轮跑一次很贵（起实例 + 起浏览器），而且**一条恒真的判据在真机上也是绿的**。
 * 所以每条新判据都要先在离线面证明「**它会在什么情况下变红**」——本项目头号教训：
 * 「替身绿 ≠ 真机绿」，反过来同样成立：「判据在真机上绿 ≠ 它有牙」。
 *
 * 做法：用 dev-only 的 jsdom（不进产物、不进 dependencies）造**合成页面**，把 `lib/judge.mjs` 里
 * 那几条**纯函数判定**真跑一遍。真机轮与离线轮调的是**同一份函数**（不是两份平行逻辑）。
 *
 * 合成页面只需要结构：官方 AppFrame 的 frame 元素 = `[data-shell-overlay]` 的 parent，
 * 子列顺序 `[0]` 侧栏、`[1]` 中心列、`[data-rightbar-col]` 右栏，属性按装机源码
 * （`dsh-client-ui-layout/lib/client.js`）给：`data-sidebar-collapsed` / `data-rightbar-collapsed` /
 * `data-rightbar-fullscreen` / `style.grid-template-columns` / 侧栏拖柄 `[data-side="sidebar"]`。
 * **不读几何**（jsdom 没有布局）—— 几何与观感由 workbench-manual 留人工。
 *
 * 跑法：`node verify/real-machine/workbench-selftest.mjs`（零网络、不起任何进程）
 * 退出码：全部 PASS ⇒ 0；任一 FAIL ⇒ 1。
 */
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import {
  WORKBENCH_FACTS_EXPR,
  WORKBENCH_PROBE_EXPR,
  bundleGate,
  bundleGateVerdict,
  comboNormalizeArtifact,
  parseLayoutSection,
  parseTimelineLine,
  classifyHostResidual,
  parseSettingsInstallLine,
  readBundleArtifact,
  readKindFromStatusText,
  workbenchEnterVerdict,
  workbenchHostSettingsVerdict,
  workbenchOfficialEntriesVerdict,
  workbenchOfficialVerdict,
  workbenchPersistVerdict,
  workbenchProbeInitScript,
  workbenchRestored,
  workbenchSwitchVerdict,
} from './lib/judge.mjs';

const SWITCH_HTML = (state) => {
  const on = state === 'workbench';
  return `<div data-guif-workbench-switch data-guif-workbench-state="${state}">
      <button role="switch" aria-checked="${on}" aria-label="工作台">
        <span data-guif-workbench-thumb="${on ? 'right' : 'left'}"></span>
      </button>
    </div>`;
};

/**
 * 造一个合成页面（结构照装机源码的三轨 frame）。
 * @param {{sidebarCollapsed?:boolean, rightbarTrack?:number, rightbarFullscreen?:boolean,
 *   state?:string, panelInCenter?:boolean, panelInRightbar?:boolean,
 *   dropSidebarHandle?:boolean, addSidebarHandle?:boolean, switchCount?:number,
 *   breakAria?:boolean, breakThumb?:boolean, ariaChecked?:string|null,
 *   sidebarLabel?:string, officialGlyph?:string[]}} [options]
 */
function factsFrom(options = {}) {
  const {
    sidebarCollapsed = false, rightbarTrack = 0, rightbarFullscreen = false, state = 'official',
    panelInCenter = false, panelInRightbar = false, dropSidebarHandle = false, addSidebarHandle = false,
    switchCount = 1, breakAria = false, breakThumb = false, ariaChecked = null,
    sidebarLabel = '侧栏按钮', officialGlyph = [], gridStyle = null,
  } = options;
  const sidebarTrack = sidebarCollapsed ? 56 : 280;
  const rightbarCollapsed = rightbarTrack === 0;
  // 侧栏拖柄：官方只在**未收起**时渲染（`!sidebarCollapsed && <DragHandle side="sidebar">`）
  const sidebarHandle = sidebarCollapsed
    ? (addSidebarHandle ? `<div data-side="sidebar"></div>` : '')
    : (dropSidebarHandle ? '' : `<div data-side="sidebar"></div>`);
  const panel = panelInCenter ? `<section data-guif-panel></section>` : '';
  const rightPanel = panelInRightbar ? `<section data-guif-panel></section>` : '';
  const glyphs = officialGlyph.map((id) => `<div data-guif-glyph="${id}"></div>`).join('');
  const switches = Array.from({ length: switchCount }, (_, index) => {
    if (index === 0) {
      let html = SWITCH_HTML(state);
      if (breakThumb) html = html.replace(`data-guif-workbench-thumb="${state === 'workbench' ? 'right' : 'left'}"`, 'data-guif-workbench-thumb="wrong"');
      if (ariaChecked !== null) html = html.replace(`aria-checked="${state === 'workbench'}"`, `aria-checked="${ariaChecked}"`);
      if (breakAria) html = html.replace(' role="switch"', '');
      return html;
    }
    return SWITCH_HTML(state);
  }).join('');
  const gridValue = gridStyle ?? `${sidebarTrack}px minmax(0, 1fr) ${rightbarTrack}px`;
  const html = `<!doctype html><html><body>
    <div id="frame"${sidebarCollapsed ? ' data-sidebar-collapsed="true"' : ''}${rightbarCollapsed ? ' data-rightbar-collapsed="true"' : ''}${rightbarFullscreen ? ' data-rightbar-fullscreen="true"' : ''}
         style="grid-template-columns: ${gridValue}">
      <div class="sidebar"><button aria-label="${sidebarLabel}"></button>${glyphs}</div>
      <div class="center">${panel}</div>
      <div data-rightbar-col>${rightPanel}</div>
      <div data-shell-overlay>${switches}</div>
      ${sidebarHandle}
    </div>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  try {
    return dom.window.eval(WORKBENCH_FACTS_EXPR);
  } finally {
    dom.window.close();
  }
}

// ── 断言小工具（本文件自带，不引第三方断言库：jsdom 已是本包唯一的 dev 依赖）──────────────
let pass = 0;
const failures = [];
function ok(title, condition, detail = '') {
  if (condition === true) {
    pass += 1;
    console.log(`  PASS ${title}`);
    return;
  }
  failures.push(`${title}${detail === '' ? '' : ` —— ${detail}`}`);
  console.log(`  FAIL ${title}${detail === '' ? '' : ` —— ${detail}`}`);
}

console.log('[workbench-selftest] 工作台判据的离线有牙自证（jsdom 合成页面，不起任何进程）');

// ── 基线三态 ────────────────────────────────────────────────────────────────────────────────
const official = factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] });
const workbench = factsFrom({ state: 'workbench', sidebarCollapsed: true, rightbarTrack: 576, rightbarFullscreen: true, panelInCenter: true, officialGlyph: ['other-plugin/x'] });

console.log('① 表达式本身：合成页面能被正确读出来');
ok('[frame-official-geometry] 官方态：开关在场、三轨、侧栏展开、无 rightbar 轨、侧栏拖柄在', official.switch.present === true && official.frame.trackCount === 3 && official.frame.sidebarTrack === 280 && official.frame.sidebarCollapsed === false && official.frame.rightbarTrack === 0 && official.frame.dragHandleSidebar === true, JSON.stringify(official.frame));
ok('[frame-workbench-geometry] 工作台态：侧栏轨=56、sidebarCollapsed、右栏轨>0、坞面板在中心列', workbench.frame.sidebarTrack === 56 && workbench.frame.sidebarCollapsed === true && workbench.frame.rightbarTrack === 576 && workbench.panelInCenter === true && workbench.frame.dragHandleSidebar === false, JSON.stringify(workbench.frame));
ok('[frame-tracks-parsed] 「三轨」按整行正则判定：中轨是 minmax(0, 1fr)（含空格也不会被数成 4 条）', official.frame.trackCount === 3 && official.frame.centerTrackRaw === 'minmax(0, 1fr)', JSON.stringify(official.frame.gridRaw));

// ★ 真机首跑的真实教训：**真机 Chrome 的 CSSOM 会把 `minmax(0, 1fr)` 规范化成 `minmax(0px, 1fr)`**
//   （raw.json 里 `gridRaw` 原文＝`280px minmax(0px, 1fr) 0px`）。只认 jsdom 那一种写法 ⇒ 真机上
//   `trackCount` 恒 0、轨宽恒 null ⇒ workbench-enter/workbench-official-frame **恒假**（比恒真更难发现）。下面两条把两种序列化钉住。
const enterOkEntry = { ok: true, via: 'mouse', hit: { self: true } };
const chromeSerialized = factsFrom({ state: 'workbench', sidebarCollapsed: true, rightbarTrack: 564, rightbarFullscreen: true, panelInCenter: true, gridStyle: '56px minmax(0px, 1fr) 564px' });
ok('[frame-chrome-serialized] **Chrome 序列化形态** `minmax(0px, 1fr)`（真机原样）也能被读出来：轨=56/1fr/564、轨数=3', chromeSerialized.frame.sidebarTrack === 56 && chromeSerialized.frame.rightbarTrack === 564 && chromeSerialized.frame.trackCount === 3, JSON.stringify(chromeSerialized.frame.gridRaw));
ok('[frame-chrome-enter-green] 该形态下 workbench-enter 判绿（若正则只认 jsdom 写法，这里会红 ⇒ 真机恒假）', workbenchEnterVerdict(official, enterOkEntry, chromeSerialized).ok === true);
const brokenGrid = factsFrom({ state: 'workbench', sidebarCollapsed: true, rightbarTrack: 564, rightbarFullscreen: true, panelInCenter: true, gridStyle: '56px 1fr 564px' });
ok('[frame-tracks-broken] 负控：轨串写成 `56px 1fr 564px`（无 minmax ⇒ 读不出）⇒ trackCount=0，workbench-enter/workbench-official-frame 必须判红', brokenGrid.frame.trackCount === 0 && workbenchEnterVerdict(official, enterOkEntry, brokenGrid).ok === false);

console.log('② workbench-toggle（开关在位、三处同源）');
ok('[switch-official-ok] 官方态 ⇒ 绿', workbenchSwitchVerdict(official).ok === true, JSON.stringify(workbenchSwitchVerdict(official).got));
ok('[switch-workbench-ok] 工作台态（aria-checked=true / thumb=right）⇒ 绿', workbenchSwitchVerdict(workbench).ok === true, JSON.stringify(workbenchSwitchVerdict(workbench).got));
ok('[switch-container-missing] 负控：开关容器**不存在** ⇒ 红', workbenchSwitchVerdict(factsFrom({ switchCount: 0 })).ok === false);
ok('[switch-role-missing] 负控：`role="switch"` 被去掉 ⇒ 红', workbenchSwitchVerdict(factsFrom({ breakAria: true })).ok === false);
ok('[switch-cross-source-mismatch] 负控：状态读数=workbench 但 aria-checked 还停在 false（**三处不同源**）⇒ 红', workbenchSwitchVerdict(factsFrom({ state: 'workbench', ariaChecked: 'false' })).ok === false);
ok('[switch-thumb-mismatch] 负控：thumb 与状态不一致 ⇒ 红', workbenchSwitchVerdict(factsFrom({ state: 'workbench', breakThumb: true })).ok === false);
ok('[switch-anchor-duplicated] 负控：容器出现 2 个（锚点重复）⇒ 红', workbenchSwitchVerdict(factsFrom({ switchCount: 2 })).ok === false);

console.log('③ workbench-enter（一次真鼠标点击 ⇒ 进工作台布局）');
const enterOk = { ok: true, via: 'mouse', hit: { self: true } };
ok('[enter-real-mouse-ok] 真鼠标 + 工作台态读数 ⇒ 绿', workbenchEnterVerdict(official, enterOk, workbench).ok === true);
ok('[enter-js-fallback] 负控：**走了 JS 兜底**（via=js）⇒ 红', workbenchEnterVerdict(official, { ok: true, via: 'js', hit: { self: true } }, workbench).ok === false);
ok('[enter-miss-self] 负控：真鼠标但**没命中自身** ⇒ 红', workbenchEnterVerdict(official, { ok: true, via: 'mouse', hit: { self: false } }, workbench).ok === false);
ok('[enter-sidebar-open] 负控：状态翻成 workbench 但**侧栏没收起**（轨仍 280）⇒ 红', workbenchEnterVerdict(official, enterOk, factsFrom({ state: 'workbench', rightbarTrack: 576, panelInCenter: true })).ok === false);
ok('[enter-panel-not-center] 负控：侧栏收起了但**坞面板没进中心列** ⇒ 红', workbenchEnterVerdict(official, enterOk, factsFrom({ state: 'workbench', sidebarCollapsed: true, rightbarTrack: 576 })).ok === false);
ok('[enter-rightbar-closed] 负控：右栏轨没打开（track=0）⇒ 红', workbenchEnterVerdict(official, enterOk, factsFrom({ state: 'workbench', sidebarCollapsed: true, panelInCenter: true })).ok === false);
ok('[enter-panel-in-rightbar] 负控：坞面板跑进了**右栏列**（不在中心列）⇒ 红', workbenchEnterVerdict(official, enterOk, factsFrom({ state: 'workbench', sidebarCollapsed: true, rightbarTrack: 576, panelInRightbar: true })).ok === false);
ok('[enter-handle-left] 负控：收起态却还留着侧栏拖柄（官方实现不自洽）⇒ 红', workbenchEnterVerdict(official, enterOk, factsFrom({ state: 'workbench', sidebarCollapsed: true, rightbarTrack: 576, panelInCenter: true, addSidebarHandle: true })).ok === false);

console.log('④ workbench-restore（「完全还原」：与进入前逐字段相等）');
ok('[restore-roundtrip-ok] 官方 → 工作台 → 官方：逐字段相等 ⇒ 绿', workbenchRestored(official, factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] })).restored === true);
const notRestored = factsFrom({ state: 'official', panelInCenter: true, officialGlyph: ['other-plugin/x'] });
const r1 = workbenchRestored(official, notRestored);
ok('[restore-main-stuck] 负控：退出后 **main 还停在坞面板**（忘了 selectPanel 回退）⇒ 红，且 diffs 点出 panelCount/panelInCenter', r1.restored === false && r1.diffs.some((row) => row.startsWith('panelCount')) && r1.diffs.some((row) => row.startsWith('panelInCenter')), JSON.stringify(r1.diffs));
const collapsedEntry = factsFrom({ state: 'official', sidebarCollapsed: true, officialGlyph: ['other-plugin/x'] });
const expandedAfter = factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] });
const r2 = workbenchRestored(collapsedEntry, expandedAfter);
ok('[restore-sidebar-expanded] 负控：**进入前侧栏已收起，退出后却展开**（把 toggle 写成「设回默认宽」）⇒ 红，且 diffs 点出 sidebarCollapsed/sidebarTrack/dragHandleSidebar', r2.restored === false && r2.diffs.some((row) => row.startsWith('sidebarCollapsed')) && r2.diffs.some((row) => row.startsWith('sidebarTrack')) && r2.diffs.some((row) => row.startsWith('dragHandleSidebar')), JSON.stringify(r2.diffs));
const r3 = workbenchRestored(official, factsFrom({ state: 'official', rightbarTrack: 576, rightbarFullscreen: true, officialGlyph: ['other-plugin/x'] }));
ok('[restore-rightbar-open] 负控：退出后**右栏没关回去** ⇒ 红，且 diffs 点出 rightbarTrack/rightbarFullscreen/rightbarCollapsed', r3.restored === false && r3.diffs.some((row) => row.startsWith('rightbarTrack')) && r3.diffs.some((row) => row.startsWith('rightbarFullscreen')), JSON.stringify(r3.diffs));

console.log('⑤ workbench-persist（刷新后保留：字节 + 被采用）');
ok('[persist-ok] 落盘文本含 workbench 且刷新后处于工作台布局 ⇒ 绿', workbenchPersistVerdict({ persistedText: 'gui-frame:\n  layout:\n    userLayout:\n      workbench: workbench\n', afterReload: workbench }).ok === true);
ok('[persist-not-written] 负控：**文件里没有 workbench**（压根没落盘）⇒ 红', workbenchPersistVerdict({ persistedText: 'gui-frame:\n  layout:\n    docks: []\n', afterReload: workbench }).ok === false);
ok('[persist-not-adopted] 负控：落盘了但刷新后**没被采用**（页面仍是官方布局）⇒ 红', workbenchPersistVerdict({ persistedText: 'workbench', afterReload: official }).ok === false);
ok('[persist-unreadable] 负控：读不到文件（null）⇒ 红', workbenchPersistVerdict({ persistedText: null, afterReload: workbench }).ok === false);

console.log('⑥ workbench-official-frame（官方侧两态不受影响）');
ok('[official-same-ok] 同一官方结构的两次读数 ⇒ 绿', workbenchOfficialVerdict(official, factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] })).ok === true);
ok('[official-entries-split] 非本包入口变了：**workbench-official-frame 本体仍判绿**（它已不再管这一分句）', workbenchOfficialVerdict(official, factsFrom({ state: 'official' })).ok === true);
ok('[official-sidebar-changed] 负控：第二次读数里**侧栏内容摘要变了** ⇒ 红', workbenchOfficialVerdict(official, factsFrom({ state: 'official', sidebarLabel: '换了标签', officialGlyph: ['other-plugin/x'] })).ok === false);
const brokenFrame = factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] });
brokenFrame.frame = { ...brokenFrame.frame, rightbarColCount: 0 };
ok('[official-frame-broken] 负控：官方 frame 缺 `[data-rightbar-col]`（结构被破坏）⇒ 红', workbenchOfficialVerdict(official, brokenFrame).ok === false);

console.log('⑦ workbench-official-entries（非本包入口一致性：带适用性闸）');
const emptyBoth = factsFrom({ state: 'official' });   // 出厂 profile：非本包入口 = []
const vEmpty = workbenchOfficialEntriesVerdict(emptyBoth, factsFrom({ state: 'official' }));
ok('[entries-empty-inapplicable] **两态都是空数组 ⇒ applicable=false**（不再是恒真的绿）', vEmpty.applicable === false && vEmpty.same === true, JSON.stringify(vEmpty));
ok('[entries-same-ok] 两态非空且相同 ⇒ applicable=true 且 same=true ⇒ 绿', (() => { const v = workbenchOfficialEntriesVerdict(factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] }), factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] })); return v.applicable === true && v.same === true; })());
ok('[entries-missing] 负控：两态非空但**少了一个入口** ⇒ applicable=true 且 same=false ⇒ 红', (() => { const v = workbenchOfficialEntriesVerdict(factsFrom({ state: 'official', officialGlyph: ['other-plugin/x', 'other-plugin/y'] }), factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] })); return v.applicable === true && v.same === false; })());
ok('[entries-half-empty] 负控：**一侧空、一侧非空** ⇒ applicable=true 且 same=false ⇒ 红（不会因为有一侧空就「不适用」逃掉）', (() => { const v = workbenchOfficialEntriesVerdict(emptyBoth, factsFrom({ state: 'official', officialGlyph: ['other-plugin/x'] })); return v.applicable === true && v.same === false; })());

console.log('⑧ workbench-cause（宿主侧注册读数 ✕ 客户端读数 ⇒ 成因二选一钉死）');
const HOST_REGISTERED = '[gui-frame] settings 注册 尝试 #1 ⇒ 已注册 ｜settings=ctx.get schema=anchor@profile=C:/x/profiles/web 锚=argv[1]✗(MODULE_NOT_FOUND) profile✓(命中) at=2026-10-03T14:20:00.000Z';
const HOST_NOT_REGISTERED = '[gui-frame] settings 注册 尝试 #1 ⇒ 未注册(schemastery-unavailable) ｜settings=ctx.get schema=none 锚=argv[1]✗(MODULE_NOT_FOUND) profile✗(MODULE_NOT_FOUND) at=2026-10-03T14:20:00.000Z';
const vHostA = workbenchHostSettingsVerdict({ hostLine: HOST_REGISTERED, clientReadKind: 'unavailable', clientWritable: false });
ok('[cause-host-registered] 宿主「已注册」+ 客户端不可写 ⇒ 成因 = **卡在客户端/时序侧**', vHostA.ok === true && vHostA.cause === 'registered-but-client-cannot-see', JSON.stringify(vHostA.detail));
const vHostB = workbenchHostSettingsVerdict({ hostLine: HOST_NOT_REGISTERED, clientReadKind: 'unavailable', clientWritable: false });
ok('[cause-host-unregistered] 宿主「未注册(reason)」⇒ 成因 = **卡在宿主侧**，并把 reason 带出来', vHostB.ok === true && vHostB.cause === 'host-not-registered' && vHostB.detail.reason === 'schemastery-unavailable');
const vHostC = workbenchHostSettingsVerdict({ hostLine: HOST_REGISTERED, clientReadKind: 'ready', clientWritable: true });
ok('[cause-writable] 宿主已注册且客户端可写 ⇒ 成因 = 这一条与宿主可见性无关（第三种世界）', vHostC.ok === true && vHostC.cause === 'registered-and-client-writable');
ok('[cause-no-host-line] 负控：**拿不到宿主那行** ⇒ ok=false（调用方按「未取真机证」登记，**不猜**）', workbenchHostSettingsVerdict({ hostLine: null, clientReadKind: 'unavailable', clientWritable: false }).ok === false);
ok('[cause-unknown-host-line] 负控：宿主行存在但**认不出已注册/未注册** ⇒ ok=false（不糊化当已注册）', workbenchHostSettingsVerdict({ hostLine: '[gui-frame] settings 注册 尝试 #1 ⇒ 未知形态', clientReadKind: 'unavailable', clientWritable: false }).ok === false);
ok('[status-line-parse] 状态行解析：`布局 v2 · rev 2 · unavailable（只读）…` ⇒ read.kind=unavailable；`ready（可写）` ⇒ ready；乱文 ⇒ null', readKindFromStatusText('布局 v2 · rev 2 · unavailable（只读）恢复默认未知条目 0 恢复默认未知条目 0') === 'unavailable' && readKindFromStatusText('布局 v2 · rev 5 · ready (writable)') === 'ready' && readKindFromStatusText('随便写点什么') === null);
// ★ 真机实测踩到：状态行是**拼接文本** ⇒ `ready` 后面没有括号（下面这条是**真机上抄下来的原文**）。
//   早先只认 `kind(` 的写法在真机上返回 null（读数丢失）；改成 `\b` 后两种形态都认。
ok('[status-line-parse-real] 真机原样字符串 `布局 v2 · rev 2 · ready恢复默认未知条目 0` ⇒ read.kind=ready（**不是 null**）', readKindFromStatusText('布局 v2 · rev 2 · ready恢复默认未知条目 0') === 'ready', JSON.stringify(readKindFromStatusText('布局 v2 · rev 2 · ready恢复默认未知条目 0')));
ok('[host-line-fields] 解析器对真实行形状的字段抠取：seq/registered/reason/at 四件都对', (() => { const p = parseSettingsInstallLine(HOST_NOT_REGISTERED); return p.seq === 1 && p.registered === false && p.reason === 'schemastery-unavailable' && p.at === '2026-10-03T14:20:00.000Z'; })());

console.log('⑨ 页面侧采样口（读 `__internals.workbenchProbe()` 的 trap，离线自证）');
function probeFromHtml(prelude = []) {
  const dom = new JSDOM('<!doctype html><body>x</body>', { runScripts: 'outside-only' });
  try {
    for (const step of prelude) dom.window.eval(step);
    return dom.window.eval(WORKBENCH_PROBE_EXPR);
  } finally {
    dom.window.close();
  }
}
const PROBE_FAKE_MODULE = `({ __internals: { workbenchProbe: () => ({ state: 'official', adopted: true, readKindAtLoad: 'ready', storeRead: { kind: 'ready', value: 'workbench' }, layoutRev: 7, write: { written: 1, scheduled: false }, deferredLoad: { armed: false, fired: 0 } }) } })`;
const PROBE_BOOT = [
  workbenchProbeInitScript(),
  `window.__ModuleLoader__ = { create: () => ({ load: () => ${PROBE_FAKE_MODULE} }) };`,
  `(() => { window.__ModuleLoader__.create().load({ id: 'dsh-gui-frame' }); })()`,
];
ok('没埋 trap（普通页面）⇒ available:false + reason=no-trap（**不编读数**）', (() => { const r = probeFromHtml([]); return r.available === false && r.reason === 'no-trap'; })());
ok('埋了 trap 但外壳没启动（模块没被 load）⇒ available:false + `trap.loads=0`', (() => { const r = probeFromHtml([workbenchProbeInitScript()]); return r.available === false && typeof r.reason === 'string' && r.reason !== '' && r.trap?.loads === 0; })());
ok('trap 能捕获模块对象 ⇒ available:true 且 probe 字段**原样透出**', (() => { const r = probeFromHtml(PROBE_BOOT); return r.available === true && r.probe?.readKindAtLoad === 'ready' && r.probe?.adopted === true && r.probe?.deferredLoad?.fired === 0 && r.trap?.loads === 1; })(), JSON.stringify(probeFromHtml(PROBE_BOOT)));
ok('捕获到了但模块没有 `__internals` ⇒ available:false + 原因，**不静默当绿**', (() => {
  const r = probeFromHtml([
    workbenchProbeInitScript(),
    `window.__ModuleLoader__ = { create: () => ({ load: () => ({ nope: true }) }) };`,
    `(() => { window.__ModuleLoader__.create().load({ id: 'x' }); })()`,
  ]);
  return r.available === false && typeof r.reason === 'string';
})());
ok('负控：trap **没改变 `load` 的返回形状**（同步 load 仍返回模块对象本身，不是 Promise）', (() => {
  const dom = new JSDOM('<!doctype html><body>x</body>', { runScripts: 'outside-only' });
  try {
    dom.window.eval(workbenchProbeInitScript());
    dom.window.eval(`window.__ModuleLoader__ = { create: () => ({ load: () => ${PROBE_FAKE_MODULE} }) };`);
    const out = dom.window.eval(`(() => { const r = window.__ModuleLoader__.create().load({ id: 'x' }); return { thenable: r !== null && typeof r.then === 'function', hasInternals: r !== null && r !== undefined && r.__internals !== undefined }; })()`);
    return out.thenable === false && out.hasInternals === true;
  } finally { dom.window.close(); }
})());

console.log('⑩ settings.yaml 的 layout 字段解析（真机的**流式写法**曾把 corrupt-file-rebuilt 判成假红）');
const BLOCK_YAML = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'gui-frame:',
  '  layout:',
  '    schemaVersion: 2',
  '    rev: 5',
  '    docks:',
  '      - dsh-gui-frame/dock',
  '      - dsh-gui-frame/demo',
  '    entries:',
  '      dsh-gui-frame/dock:',
  '        visible: true',
  '',
].join('\n');
// ↓ 本轮真机上抄下来的**原文**（重建后的流式写法：一行数组 + 尾逗号）
const FLOW_YAML = [
  'gui-frame:',
  '  {',
  '    layout:',
  '      {',
  '        schemaVersion: 2,',
  '        rev: 3,',
  '        docks: [ dsh-gui-frame/dock, dsh-gui-frame/demo, dsh-gui-frame/demo-action ],',
  '        entries:',
  '          {',
  '            dsh-gui-frame/dock: { visible: true, source: dsh-gui-frame }',
  '          },',
  '        floating: []',
  '      }',
  '  }',
  '',
].join('\n');
// ↓ 种坏载荷那一刻的原文
const CORRUPT_YAML = [
  'gui-frame:',
  '  {',
  '    layout:',
  '      {',
  '        schemaVersion: 999,',
  '        rev: 0,',
  '        docks:',
  '          [ dsh-gui-frame/ghost-entry ]',
  '      }',
  '  }',
  '',
].join('\n');
const pBlock = parseLayoutSection(BLOCK_YAML);
const pFlow = parseLayoutSection(FLOW_YAML);
const pCorrupt = parseLayoutSection(CORRUPT_YAML);
ok('[layout-block-form] 块式写法（`docks:` + `- item`）⇒ 三项按序读出', pBlock.namespaceFound === true && pBlock.layoutFound === true && pBlock.schemaVersion === 2 && JSON.stringify(pBlock.docks) === JSON.stringify(['dsh-gui-frame/dock', 'dsh-gui-frame/demo']), JSON.stringify(pBlock));
ok('[layout-flow-form] **流式写法（真机原文）**⇒ `docks` 三项按序读出、`schemaVersion=2`（旧版在这里读成空数组 ⇒ corrupt-file-rebuilt 假红）', pFlow.layoutFound === true && pFlow.schemaVersion === 2 && JSON.stringify(pFlow.docks) === JSON.stringify(['dsh-gui-frame/dock', 'dsh-gui-frame/demo', 'dsh-gui-frame/demo-action']), JSON.stringify(pFlow));
ok('[layout-corrupt-form] 坏载荷原文 ⇒ `schemaVersion=999` 且 `docks=[ghost]`（负控与结果证据两边都读得到）', pCorrupt.schemaVersion === 999 && JSON.stringify(pCorrupt.docks) === JSON.stringify(['dsh-gui-frame/ghost-entry']), JSON.stringify(pCorrupt));
ok('[layout-missing-section] 负控：只有 `gui-frame:` 没有 `layout:` ⇒ `layoutFound=false`（不假装读到）', (() => { const p = parseLayoutSection('gui-frame:\n  ui-theme:\n    x: 1\n'); return p.namespaceFound === true && p.layoutFound === false; })());
ok('[layout-garbage] 负控：乱文 ⇒ `namespaceFound=false`（不假装读到）', (() => { const p = parseLayoutSection('hello\nworld\n'); return p.namespaceFound === false && p.layoutFound === false; })());

console.log('⑪ 时间线行的读取（装置从宿主 stderr 取「载入/采用链」四点读数）');
const TL_NOT_ADOPTED = '[timeline] 1/4 t≈5ms state=official readKindAtLoad=loading storeRead=empty:null deferred.armed=true deferred.fired=0 layoutRev=2 adopted=false';
const TL_ADOPTED = '[timeline] 3/4 t≈3200ms state=workbench readKindAtLoad=ready storeRead=ready:workbench deferred.armed=false deferred.fired=1 layoutRev=7 adopted=true';
const pTl1 = parseTimelineLine(TL_NOT_ADOPTED);
const pTl2 = parseTimelineLine(TL_ADOPTED);
ok('「未采用」世界 ⇒ official / readKindAtLoad=loading / storeRead=empty:null / armed=true,fired=0 / adopted=false', pTl1.index === 1 && pTl1.total === 4 && pTl1.offsetMs === 5 && pTl1.state === 'official' && pTl1.readKindAtLoad === 'loading' && pTl1.storeKind === 'empty' && pTl1.storeValue === 'null' && pTl1.deferredArmed === true && pTl1.deferredFired === 0 && pTl1.adopted === false, JSON.stringify(pTl1));
ok('「已采用」世界 ⇒ workbench / storeRead=ready:workbench / armed=false,fired=1 / adopted=true（两种世界**可判开**）', pTl2.index === 3 && pTl2.offsetMs === 3200 && pTl2.state === 'workbench' && pTl2.storeKind === 'ready' && pTl2.storeValue === 'workbench' && pTl2.deferredArmed === false && pTl2.deferredFired === 1 && pTl2.adopted === true, JSON.stringify(pTl2));
ok('负控：非时间线行（诊断上报失败行 / 空串）⇒ 返回 null（**不把别的行糊化当时间线**）', parseTimelineLine('[gui-frame] 客户端失败 dsh-gui-frame · render · v0.0.1 · 2026-10-03T00:00:00.000Z') === null && parseTimelineLine('') === null);
ok('缺字段容忍：只有标记与 i/N ⇒ 其余字段如实 null，**不抛**', (() => { const p = parseTimelineLine('[timeline] 2/4'); return p !== null && p.index === 2 && p.state === null && p.storeKind === null && p.deferredFired === null && p.adopted === null; })());

console.log('⑫ 判读段（`scope=…@revN val=[…] usr=[…]`）的读取与宿主侧残因归类');
// 真机原文形状：**判读段接在原字段之后**（旧格式行仍然解析得动 ⇒ 它就是负控）
const TL_SCOPE_STRIPPED = '[timeline] 1/4 t≈5ms state=official readKindAtLoad=loading storeRead=empty:null deferred.armed=true deferred.fired=0 layoutRev=2 adopted=false scope=ready@rev0 val=[] usr=[layout]';
const TL_SCOPE_ABSENT = '[timeline] 2/4 t≈800ms state=official readKindAtLoad=loading storeRead=empty:null deferred.armed=true deferred.fired=0 layoutRev=2 adopted=false scope=ready@rev3 val=[] usr=[]';
const TL_SCOPE_PRESENT = '[timeline] 3/4 t≈3200ms state=workbench readKindAtLoad=ready storeRead=ready:workbench deferred.armed=false deferred.fired=1 layoutRev=7 adopted=true scope=ready@rev5 val=[layout,ui-theme] usr=[layout,ui-theme]';
const pScope1 = parseTimelineLine(TL_SCOPE_STRIPPED);
const pScope2 = parseTimelineLine(TL_SCOPE_ABSENT);
const pScope3 = parseTimelineLine(TL_SCOPE_PRESENT);
ok('判读段解析：`scope=<status>@rev<N>` 与两个键名列表都读出来（键名可多个、可带空格）', pScope1.scopeStatus === 'ready' && pScope1.scopeRevision === 0 && JSON.stringify(pScope1.valKeys) === JSON.stringify([]) && JSON.stringify(pScope1.usrKeys) === JSON.stringify(['layout']) && JSON.stringify(pScope3.valKeys) === JSON.stringify(['layout', 'ui-theme']), JSON.stringify({ a: pScope1.valKeys, b: pScope1.usrKeys, c: pScope3.valKeys, rev: pScope1.scopeRevision }));
ok('归类①：`val=[] usr=[layout]` ⇒ `host-resolved-key-away`（有值却被宿主那一环解析掉）+ 附加读数 `fresh-registration`（@rev0）', classifyHostResidual(pScope1).kind === 'host-resolved-key-away' && classifyHostResidual(pScope1).note === 'fresh-registration', JSON.stringify(classifyHostResidual(pScope1)));
ok('归类②：`val=[] usr=[]` ⇒ `absent-from-host-answer`（**不许**与归类①混成同一个结论）；`@rev3` ⇒ 不挂 `fresh-registration`', classifyHostResidual(pScope2).kind === 'absent-from-host-answer' && classifyHostResidual(pScope2).note === null, JSON.stringify(classifyHostResidual(pScope2)));
ok('归类③ 负控：`val` 里有 layout ⇒ `host-value-present`（本就不该红）；**旧格式/判读段缺失 ⇒ `unknown`，不猜**', classifyHostResidual(pScope3).kind === 'host-value-present' && classifyHostResidual(pTl1).kind === 'unknown' && classifyHostResidual(pTl1).why.includes('没有判读段'), JSON.stringify({ present: classifyHostResidual(pScope3).kind, old: classifyHostResidual(pTl1).kind }));

console.log('⑬ 页面字节身份闸（堵「旧 bundle 含 marker ⇒ 假绿」）');
const GATE_URL = '/plugins/??dsh-gui-frame/client.js&rev=deadbeefdead';
const GATE_MARKER = 'useStandInHook';
/** 造一个「新构建」产物（够长、含 marker、有非 ASCII 字符以体现两种量纲）。 */
const ARTIFACT_NEW = `// artifact v2 —— 新构建（含中文注释）\nconst ${GATE_MARKER} = true;\nconst PAD = '${'x'.repeat(400)}';\n`;
/** 旧构建：**同样含 marker**（这正是老口径会假绿的原因），但产物文本不同。 */
const ARTIFACT_OLD = `// artifact v1 —— 旧构建\nconst ${GATE_MARKER} = true;\nconst PAD = '${'y'.repeat(400)}';\n`;

/**
 * 用 jsdom 把**真实的页面侧表达式**跑一遍，只把「网络回来的字节」换掉 —— 这就是注入式反证：
 * 表达式、字符串比对、判定函数全是真的，唯一变量是 fetch 的响应体。
 */
async function gateFromServed({ served, marker = GATE_MARKER, artifactText, url = GATE_URL, fetchThrows = false }) {
  const dom = new JSDOM(`<!doctype html><body><script type="module" src="${url}"></script></body>`, { runScripts: 'outside-only' });
  dom.window.fetch = async () => {
    if (fetchThrows) throw new Error('network down');
    return { status: 200, text: async () => served };
  };
  const session = { evaluate: (expr) => dom.window.eval(expr) };
  return bundleGate(session, { marker, artifactText });
}

const gGreen = await gateFromServed({ served: `/* combo header 占位 */\n${ARTIFACT_NEW};\n/* next plugin */\n`, artifactText: ARTIFACT_NEW });
const vGreen = bundleGateVerdict(gGreen);
ok('未变异（服务字节＝平台拼接口径：产物后接 `;\\n`）⇒ **必须绿**，且判到 `verbatim`＋首次命中偏移', vGreen.ok === true && vGreen.tier === 'verbatim' && vGreen.offset === gGreen.identity.verbatim.offset && gGreen.identity.verbatim.offset === '/* combo header 占位 */\n'.length, JSON.stringify({ ok: vGreen.ok, tier: vGreen.tier, offset: vGreen.offset, units: gGreen.units, utf8Bytes: gGreen.utf8Bytes }));

// ★ 这就是本任务要堵的那条**假绿通道**：旧构建的字节 + 恰好含 marker ⇒ 老口径（只看 marker）会判绿。
const gOld = await gateFromServed({ served: ARTIFACT_OLD, artifactText: ARTIFACT_NEW });
const vOld = bundleGateVerdict(gOld);
const legacyOk = gOld.checked === true && gOld.hasMarker === true; // 旧口径的 ok 表达式（只看标记串的那个口径）
ok('**负控（要堵的假绿通道）**：服务字节＝旧构建但**含 marker** ⇒ 老口径 `checked && hasMarker` 为 true（会假绿）、新口径 **判红**', gOld.hasMarker === true && legacyOk === true && vOld.ok === false && vOld.why.includes('找不到当前 lib/client.js'), JSON.stringify({ hasMarker: gOld.hasMarker, legacyOk, newOk: vOld.ok, why: vOld.why }));

const gNoUrl = await gateFromServed({ served: ARTIFACT_NEW, artifactText: ARTIFACT_NEW, url: 'http://127.0.0.1:1/not-our-module.js' });
ok('负控：页面上找不到本包模块 URL ⇒ `checked:false` ⇒ **判红（fail-closed）**，不猜也不放过', gNoUrl.checked === false && bundleGateVerdict(gNoUrl).ok === false && bundleGateVerdict(gNoUrl).why.includes('没取到页面字节'), JSON.stringify(bundleGateVerdict(gNoUrl)));
ok('负控：fetch 抛错 ⇒ 同样判红并如实带上错误原因（不把「取不到」当绿）', (() => {
  // gateFromServed 是 async，这里用同步假 session 直接测判定函数的形状
  const verdict = bundleGateVerdict({ checked: false, fetchError: 'network down', marker: GATE_MARKER });
  return verdict.ok === false && verdict.why.includes('network down');
})());

// 平台会**去掉 sourceMappingURL trailer**（`dsh-client-modules` 的 `comboSource()`）⇒ 退到归一化口径，仍是身份判据（不是只看 marker）
const ARTIFACT_TRAILER = `const ${GATE_MARKER} = true;\nconst A = 1;\nconst B = 2;\n//# sourceMappingURL=client.js.map\n`;
const gTrailer = await gateFromServed({ served: `${comboNormalizeArtifact(ARTIFACT_TRAILER)};\n`, artifactText: ARTIFACT_TRAILER });
const vTrailer = bundleGateVerdict(gTrailer);
const gTrailerWrong = await gateFromServed({ served: `${comboNormalizeArtifact(ARTIFACT_TRAILER)};\n`, artifactText: `${ARTIFACT_TRAILER}const C = 3;\n` });
ok('退到平台归一化口径时**仍是身份判据**：带 trailer 的产物在「去掉 trailer + 补换行」后命中（tier≠verbatim）且整体判绿；而**换一份产物文本就必须判红**（不是退回只看 marker）', vTrailer.ok === true && vTrailer.tier === 'combo-source' && gTrailer.hasMarker === true && bundleGateVerdict(gTrailerWrong).ok === false, JSON.stringify({ tier: vTrailer.tier, ok: vTrailer.ok, marker: gTrailer.hasMarker, wrongOk: bundleGateVerdict(gTrailerWrong).ok }));

const realArtifact = readBundleArtifact(fileURLToPath(new URL('../../lib/client.js', import.meta.url)));
ok('**量纲写死**：`lib/client.js` 的 `statSync().size === Buffer.byteLength(text,"utf8")`，且 UTF-8 字节数 **≥** UTF-16 码元数（两者是不同的量）', realArtifact.statSize === realArtifact.utf8Bytes && realArtifact.utf8Bytes >= realArtifact.units, JSON.stringify({ statSize: realArtifact.statSize, utf8Bytes: realArtifact.utf8Bytes, units: realArtifact.units, delta: realArtifact.utf8Bytes - realArtifact.units }));
console.log(`  · 量纲读数：lib/client.js ＝ ${realArtifact.utf8Bytes} UTF-8 字节 ／ ${realArtifact.units} UTF-16 码元（差 ${realArtifact.utf8Bytes - realArtifact.units}）｜sha256=${realArtifact.sha256.slice(0, 12)}…`);

// 真尺寸演练：拿**真产物**（67 万字节 / 53 万码元）走一遍页面侧表达式 + 判定，证明这段路在真实体量下能跑通
const gReal = await gateFromServed({
  served: `/* combo header 占位（多插件拼接里的前一份） */\n${comboNormalizeArtifact(realArtifact.text)};\n/* 后一份 */\n`,
  artifactText: realArtifact.text,
});
const vReal = bundleGateVerdict(gReal);
// 额外事实（写进证据供下一轮引用）：本包当前产物**没有** sourceURL/sourceMappingURL trailer ⇒ 平台归一化对它**恒等**
// ⇒ 真机上预期落在最强口径 `verbatim`；若下一轮真机报 `combo-source`，那就说明产物带了 trailer（归一化已代劳）。
const normalizeIdentity = comboNormalizeArtifact(realArtifact.text) === realArtifact.text;
ok('真尺寸演练：拿**真 `lib/client.js`** 造服务字节 ⇒ 判绿且落在最强口径（脚本里嵌 67 万字节的针、页面侧 indexOf 都在真实体量下跑通；且该产物**无 trailer ⇒ 平台归一化对它恒等**）', vReal.ok === true && vReal.tier === 'verbatim' && gReal.identity.artifactUnits === realArtifact.units && normalizeIdentity === true, JSON.stringify({ tier: vReal.tier, offset: vReal.offset, artifactUnits: gReal.identity.artifactUnits, bundleUnits: gReal.units, normalizeIdentity }));

console.log('');
console.log(`[workbench-selftest] 合计：PASS ${pass}｜FAIL ${failures.length}`);
if (failures.length > 0) {
  for (const row of failures) console.log(`  ✗ ${row}`);
  console.log('[workbench-selftest] 有判据**没牙**或表达式读错 ⇒ exit 1');
  process.exitCode = 1;
} else {
  console.log('[workbench-selftest] ✓ 每条判据都有一条「会变红」的实例（无恒真判据）');
  process.exitCode = 0;
}
