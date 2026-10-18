// real-machine/lib/page-pass.mjs —— 由 run.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 单页遍历：一个实例的九段读数与全部交互判据

import { BUNDLE_MARKER, MUTATION, PKG_DIR, edgeUserDataDir, insideSelector, outDir, overwriteSelector, raw, seededCorruptText, state } from './config.mjs';
import { applyThrowMutation, consoleApplyMutation, escBlockMutation, killEdgeByMarker, panelActiveMutation } from './mutations.mjs';
import { clickLayoutOverwrite, readSettingsText, truncateSettingsText } from './corrupt.mjs';
import { workbenchPass } from './workbench-pass.mjs';
import path from 'node:path';
import { CdpSession, launchEdge, sleep, waitForPageTarget } from './cdp.mjs';
import { pickFreePort } from './dsh.mjs';
import { bundleGate, bundleGateVerdict, classifyConsole, clickAction, clickActionJs, clickDemoFail, clickDemoFailJs, clickDemoOpen, dismissShellModal, dumpPanel, ensureDemoPanel, ensureDockPanel, openDemoOverlayOnce, openInsideDialogOnce, parseOpenedZ, pressEscape, readInsideEntry, readOpenedRows, readOverlayStack, readShellModal, snapshot, waitDockReady, waitForDemoReady, waitLayoutEditor, waitPanelHealthy, workbenchProbeInitScript } from './judge.mjs';

export async function pagePass({ url, tag, mutation, waits }) {
  // 每一轮用独立的 user-data-dir：同一个目录被复用会让新 Edge 委托给仍在跑的老实例，
  // 调试端口不会新开（实测过：第二轮 waitForPageTarget 超时）。子目录仍带基础标记 ⇒ 回收规则不变。
  const passDir = `${edgeUserDataDir}-${tag}`;
  let session = null;
  for (let attempt = 1; attempt <= 2 && session === null; attempt += 1) {
    await killEdgeByMarker(passDir);
    await sleep(400);
    const cdpPort = await pickFreePort();
    const launched = launchEdge({ userDataDir: passDir, port: cdpPort, logPath: path.join(outDir, `edge-${tag}.log`) });
    state.edges.push(launched);
    try {
      const page = await waitForPageTarget(cdpPort, 25_000);
      session = await CdpSession.attach(page.webSocketDebuggerUrl);
    } catch (error) {
      console.log(`  （Edge/CDP 第 ${attempt} 次未就绪：${error?.message ?? error}）`);
      await killEdgeByMarker(passDir);
    }
  }
  if (session === null) throw new Error(`headless Edge 起不来（tag=${tag}）`);
  if (tag === 'install' || tag === 'corrupt') state.session = session;
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Log.enable');
  await session.send('Network.enable');
  if (mutation === 'apply-throw') await session.addInitScript(applyThrowMutation());
  // 页面侧采样口（读 `__internals.workbenchProbe()`）——**只读采样**，见 judge.mjs 的说明。
  // 两态都埋：install 段用它采「刷新后的采用链」；corrupt 段埋着不影响判据（多一份读数而已）。
  await session.addInitScript(workbenchProbeInitScript());
  if (mutation === 'console-apply') await session.addInitScript(consoleApplyMutation());
  if (mutation === 'panel-active') await session.addInitScript(panelActiveMutation());
  if (mutation === 'esc-block') await session.addInitScript(escBlockMutation());
  await session.navigated(url);
  await sleep(waits);

  const snap = await snapshot(session);
  const ledger = classifyConsole(session);
  const result = {
    snapshot: snap,
    console: ledger,
    gate: { checked: false },
    walk: [],
    gb21: {},
    q17: { failClick: null, result: null, fingerprint: null },
    panelOpened: { opened: false, reason: 'not-run' },
    panelAnchor: 0,
    raw: { snapshot: snap, console: { hardRed: ledger.hardRed.map((row) => row.text) } },
  };
  if (tag === 'corrupt') {
    // ── 坏载荷态：只做一件事 —— 把「显式覆盖」这条人工出路**走完一遍并留证** ──────────────
    result.gate = await bundleGate(session, { marker: BUNDLE_MARKER, artifactPath: path.join(PKG_DIR, 'lib', 'client.js') });
    // 把身份闸的读数（含**量纲**：units＝UTF-16 码元 / utf8Bytes＝字节 / 产物两种值）原样落进证据；不落大文本
    result.raw.gate = { url: result.gate.url ?? null, rev: result.gate.rev ?? null, status: result.gate.status ?? null, combo: result.gate.combo ?? null, units: result.gate.units ?? null, utf8Bytes: result.gate.utf8Bytes ?? null, hasMarker: result.gate.hasMarker ?? null, identity: result.gate.identity ?? null, artifact: result.gate.artifact ?? null, verdict: bundleGateVerdict(result.gate) };
    // 环境前置：外壳自己那串首跑必答 Dialog（内测声明 / API Key）必须先清掉，否则读到的「只读」可能是遮罩下的假象
    result.shellModal = await dismissShellModal(session);
    result.raw.shellModal = result.shellModal;
    result.dockOpened = await ensureDockPanel(session);
    // 开面板之后再确认一次「最上层是我们的面板」（此时探针点落在坞面板内）
    result.shellModalAfterOpen = await readShellModal(session);
    result.raw.shellModalAfterOpen = result.shellModalAfterOpen;
    const dockFacts = await waitDockReady(session);
    result.dockFacts = dockFacts.facts;
    result.dockFactsSamples = dockFacts.samples;
    const before = await waitLayoutEditor(session, { timeoutMs: 12_000 });
    result.editorBefore = before.facts;
    result.editorBeforeSamples = before.samples;
    result.editorBeforeReady = before.ready;
    // 负控的第一手材料：**这一刻**的 settings.yaml 原文（点之前）
    result.settingsBefore = readSettingsText();

    // ── 动作：真鼠标点那颗「用默认值覆盖」（选择器可被 `--mutation=layout-overwrite` 改错）──────
    result.overwriteClick = await clickLayoutOverwrite(session, overwriteSelector);
    const after = await waitLayoutEditor(session, { timeoutMs: 10_000 });
    result.editorAfter = after.facts;
    result.editorAfterSamples = after.samples;
    result.settingsAfter = readSettingsText();
    result.raw.editorBefore = result.editorBefore;
    result.raw.editorAfter = result.editorAfter;
    result.raw.settingsBefore = { ...result.settingsBefore, text: truncateSettingsText(result.settingsBefore.text) };
    result.raw.settingsAfter = { ...result.settingsAfter, text: truncateSettingsText(result.settingsAfter.text) };
    result.raw.dockFacts = result.dockFacts;
    result.raw.overwriteClick = result.overwriteClick;
    result.raw.editorBeforeSamples = result.editorBeforeSamples;
    result.raw.editorAfterSamples = result.editorAfterSamples;
    result.raw.seededCorruptText = truncateSettingsText(seededCorruptText);
    return result;
  }
  if (tag !== 'install') return result;

  result.gate = await bundleGate(session, { marker: BUNDLE_MARKER, artifactPath: path.join(PKG_DIR, 'lib', 'client.js') });
    // 把身份闸的读数（含**量纲**：units＝UTF-16 码元 / utf8Bytes＝字节 / 产物两种值）原样落进证据；不落大文本
    result.raw.gate = { url: result.gate.url ?? null, rev: result.gate.rev ?? null, status: result.gate.status ?? null, combo: result.gate.combo ?? null, units: result.gate.units ?? null, utf8Bytes: result.gate.utf8Bytes ?? null, hasMarker: result.gate.hasMarker ?? null, identity: result.gate.identity ?? null, artifact: result.gate.artifact ?? null, verdict: bundleGateVerdict(result.gate) };
  // 有牙对照之一：**故意把锚点选择器写错** ⇒ 正常绿的那条锚点判据（anchors-subset）必须判红
  if (mutation === 'anchor') {
    const wrong = '[data-guif-glyph-MUTATED-BY-t45]';
    const wrongCount = await session.evaluate(`document.querySelectorAll(${JSON.stringify(wrong)}).length`);
    result.mutation = { kind: 'anchor', wrongSelector: wrong, wrongCount, note: '把「坞入口」锚点选择器改错后喂给 anchors-subset（正常轮它 > 0）' };
    if (snap.anchors !== undefined) snap.anchors.glyph = wrongCount;
    result.snapshot = snap;
    result.raw.snapshot = snap;
  }
  // 开面板前先等「demo 段就绪」：兄弟服务可能晚到（汇合点有 4s/250ms 的有界补装窗口），
  // 在补装完成前点开只会得到空面板（captain 实测教训）。
  // ⚠ 实测记账：本包自己的入口在页面加载时**不会自动开面板** ⇒ 这条等待的第二个条件
  // （`actions.includes('layout') || demoMarks > 0`）在打开面板之前**恒不成立** ⇒ 它到点即返回
  // `ready:false`（历轮证据一致）。真正把关「坞/demo 的入口都到位了没有」的是下面的
  // `ensureDockPanel` + `waitDockReady`（坞面板就绪）与 `ensureDemoPanel`（demo 工具栏出现）。
  const readiness = await waitForDemoReady(session, { timeoutMs: 20_000 });
  result.readiness = readiness;

  // ── 外壳自己的模态：临时 home 里**没有会话** ⇒ 外壳会弹它自己的 Dialog + 全屏 mask ──────────
  // 那个遮罩会把本包的面板整块盖住（真鼠标点什么都命中 `_mask_*`）。它是**环境前置**而不是本包缺陷，
  // 但装置必须先看见它、再如实处置（真 Escape → 关闭按钮），并把前后读数写进证据 —— 否则
  // 「第④段点不动」会被误读成实现坏了（首次整跑就踩过：overlay-real-mouse/e/a/b 齐红，根因在遮罩）。
  result.shellModal = await dismissShellModal(session);
  result.raw.shellModal = result.shellModal;

  // ── 工作台：真机判据段 ────────────────────────────────────────────────────────────────────────
  // 位置刻意在这里：外壳模态已处置（真鼠标点得动）、而**坞面板还没开**（main 停在会话）
  // ⇒ 「进入工作台之前」的官方布局基线是确定的，D0/D2 的比对才有意义。
  result.workbench = await workbenchPass(session);
  result.raw.workbench = result.workbench;

  // ── 判据 dock-panel-actions：**坞面板成为可机检对象** ─────────────────────────────────────────────────────
  // 坞面板重构成「动作型入口收纳台」之后，旧装置的采集面里**一个新锚点都没有**
  // （grep `dock-action` 全目录零命中）⇒ 那轮改动在真机上没有任何判据。这里补上：
  //   ① 先开**坞面板**（侧栏那一行是它唯一的入口）并**有界等待**它就绪（坞内容跟着 store 刷新，晚到是可能的）；
  //   ② 采它的新锚点（动作型入口 / 自报条数 / 布局编辑器 / 角标 / 侧栏本包条目）；
  //   ③ 再经**坞面板内部的导航按钮**进 demo 面板（本包附加页 `sidebar:false`，不再占侧栏）。
  result.dockOpened = await ensureDockPanel(session);
    // 开面板之后再确认一次「最上层是我们的面板」（此时探针点落在坞面板内）
    result.shellModalAfterOpen = await readShellModal(session);
    result.raw.shellModalAfterOpen = result.shellModalAfterOpen;
  const dockWait = await waitDockReady(session);
  result.dockFacts = dockWait.facts;
  result.dockFactsSamples = dockWait.samples;
  result.dockReady = dockWait.ready;

  // ── 读数（**不是判据**）：坞面板里布局编辑器的**状态行 / 可写锚点** ────────────────────────────
  // 为什么要有它：workbench-persist（刷新后保留）判红时，必须能一句话说清「是不是 settingsScope 又 `unavailable` 了」。
  // 编辑器状态行会**直接写出** `布局 v2 · rev N · <readKind>`（`[data-guif-layout-status]`），
  // 比从开关的只读提示行反推更硬；它只作读数进证据，不参与任何判据的成败。
  const editorInstall = await waitLayoutEditor(session, { timeoutMs: 8_000 });
  result.layoutEditorInstall = editorInstall.facts;
  result.layoutEditorInstallSamples = editorInstall.samples;
  result.raw.layoutEditorInstall = editorInstall.facts;
  result.raw.layoutEditorInstallSamples = editorInstall.samples;

  // 有牙对照：**把坞面板动作锚点的选择器改错**（手法与 `--mutation=anchor` 同源）——
  // 先记**真实读数**，再用不存在的选择器重读一次，两条读数都进证据与命令行输出。
  // 预期：只该翻转 dock-panel-actions 的 ②（≥1）与 ③（数值一致）；① 与 ④ 读的是别的锚点，不受影响。
  if (mutation === 'dock-action') {
    const wrong = '[data-guif-dock-action-MUTATED-BY-t1]';
    const wrongCount = await session.evaluate(`document.querySelectorAll(${JSON.stringify(wrong)}).length`);
    const before = dockWait.facts ?? null;
    const after = before === null ? null : { ...before, dockActionIds: [], dockActionCount: wrongCount, dockActionsMutated: true };
    result.dockFactsBefore = before;
    result.dockFacts = after;
    result.mutation = {
      kind: 'dock-action',
      wrongSelector: wrong,
      wrongCount,
      before,
      after,
      note: '把坞面板「动作型入口」锚点 [data-guif-dock-action] 的选择器改成不存在的那个后**重读**一次：② ≥1 与 ③ 与锚点数一致 据此判红；① 侧栏本包条目数与 ④ 坞内布局编辑器锚点读的是别的锚点，不受影响',
    };
  }
  result.raw.dockOpened = result.dockOpened;
  result.raw.dockFacts = result.dockFacts;
  result.raw.dockFactsSamples = result.dockFactsSamples;
  if (result.dockFactsBefore !== undefined) result.raw.dockFactsBefore = result.dockFactsBefore;

  result.panelOpened = await ensureDemoPanel(session);
  result.panelAnchor = await session.evaluate(`document.querySelectorAll('[data-guif-panel]').length`);
  // 把「开出来的那个面板」的全量属性与正文落进 raw.json：一眼分辨「开的是别的面板 / demo 未装完 / 选择器不匹配」
  result.panelDump = await dumpPanel(session);
  // 有牙对照之三：**把面板活性锚点恒置假**（init script 拦 setAttribute）⇒ 只该翻转 panel-health 的 ③
  if (mutation === 'panel-active') {
    result.mutation = { kind: 'panel-active', note: '拦 Element.prototype.setAttribute，把 data-guif-active 的每次写入都改成 false（正常轮它是 true）' };
  }
  // 面板健康五件套（面板整块进错误态的合格线）。有界等待 —— 补装窗口第一遍的 loading 态是设计内。
  const health = await waitPanelHealthy(session, { timeoutMs: 9_000 });
  result.panelHealth = health.health;
  result.panelHealthSamples = health.samples;
  result.panelHealthy = health.healthy;
  result.raw.panelHealth = { health: health.health, healthy: health.healthy, samples: health.samples };
  const first = await snapshot(session);
  const actionIds = (first?.actions ?? []).filter((id) => !/close/i.test(id));
  for (const section of ['dock', 'layout', 'channel', 'overlay']) {
    if (!actionIds.includes(section)) {
      result.walk.push({ section, present: false, note: `工具栏里没有 ${section}（actions=${JSON.stringify(actionIds)}）` });
      continue;
    }
    // 真鼠标优先；**没生效才**走 JS 兜底，并把两条策略与命中详情都记进 walk（不许悄悄用兜底换绿）
    const via = [];
    const mouse = await clickAction(session, section);
    via.push(mouse.ok === true
      ? `mouse:命中${mouse.hit?.self === true ? '自身' : `遮挡(${mouse.hit?.tag ?? '?'}.${String(mouse.hit?.className ?? '').slice(0, 40)})`}`
      : `mouse:${mouse.reason}`);
    let after = await snapshot(session);
    if (!(after?.sections ?? []).includes(section)) {
      const jsClick = await clickActionJs(session, section);
      via.push(jsClick.ok === true ? 'js-click' : `js:${jsClick.reason}`);
      await sleep(800);
      after = await snapshot(session);
    }
    result.walk.push({
      section,
      present: (after?.sections ?? []).includes(section),
      via,
      layoutEditor: after?.anchors?.layoutEditor ?? 0,
      errorState: after?.hasErrorState === true,
      reactErrorText: after?.reactErrorText ?? [],
      demoOpen: after?.demoOpen ?? [],
      head: after?.panelBodyHead ?? '',
      errorText: after?.errorText ?? '',
    });
  }

  // ── 判据 overlay-real-mouse：**真鼠标路径逐点取证**（第④段两扇各一次真鼠标点击）──────────────────────────────
  // 目的：把「真鼠标点得动、每点一次只开一层」变成可判读数（命中测试必须命中自身），并**如实记录
  // 设计内的「点外只关最上层」**：第二扇按钮在浮层之外 ⇒ 真鼠标 pointerdown 会先把第一扇摘掉再开第二扇
  // （机制已插桩钉死：`overlay/dismiss.mjs` 的 `onPointerDown` ⇒ `overlay/index.mjs` 的 `stack.remove(top.id)`）。
  const realMouseSteps = [];
  for (const which of ['window', 'dialog']) {
    const rowsBefore = await readOpenedRows(session);
    const stackBefore = await readOverlayStack(session);
    const click = await clickDemoOpen(session, which);
    await sleep(1200);
    const rowsAfter = await readOpenedRows(session);
    const stackAfter = await readOverlayStack(session);
    const beforeIds = stackBefore?.layers ?? [];
    const afterIds = stackAfter?.layers ?? [];
    realMouseSteps.push({
      which,
      hitSelf: click.hit?.self === true,
      hitTag: click.hit?.tag ?? null,
      hitClassName: click.hit?.className ?? null,
      ledgerDelta: rowsAfter.length - rowsBefore.length,
      removedIds: beforeIds.filter((id) => !afterIds.includes(id)),
      stack: stackAfter,
    });
  }
  result.realMouse = {
    steps: realMouseSteps,
    zAfter: parseOpenedZ(await readOpenedRows(session)),
    rowsAfter: await readOpenedRows(session),
    note: '真鼠标逐点：第一扇开出 → 第二扇的真鼠标 pointerdown 命中「点外」⇒ 设计内先摘掉第一扇、再开第二扇',
  };

  // ── 清场：「全部关闭」把层栈与第④段开窗账一起归零，再跑下面的叠层语义那一段 ────────────────────
  const closeAllClick = await session.evaluate(`(() => {
    const node = document.querySelector('[data-guif-demo-close-all]');
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
  await sleep(900);
  result.realMouse.reset = { closeAllClick, stack: await readOverlayStack(session), rows: await readOpenedRows(session) };
  result.raw.realMouse = result.realMouse;

  // 证①：浮动窗 + 对话层 → 数值序 → Esc 只关栈顶
  // 【口径修正】① 每扇**只点一次**，判「这一下点开出来了没有」用**家族无关**的事件计数器＝开窗账行数增长
  //   （旧口径用只有浮动窗才有的 `[data-guif-window]` ⇒ 官方 Modal 永远「看起来没开」⇒ 被点第二次 ⇒ 账上三行）；
  //   ③ Esc 的增减读**活的层栈**（`[data-guif-overlay-layer]` / root 的 `data-guif-overlay-layers`），
  //   不读那份只增不减的开窗账（它记历史，Esc 关了也不会变短）。
  // 【口径翻面】② 第二扇**改走真鼠标**：**浮动窗 content 里**冻结了新入口
  //   `data-guif-demo-open-dialog-inside` ⇒ 它的 pointerdown 落在浮层**内部** ⇒ 设计内的「点外只关最上层」
  //   **不触发** ⇒ 两扇能叠。旧口径那条「第二扇必须用 JS click」到此作废（README「已知限制」第一条同步翻面），
  //   而「这一扇到底是不是真鼠标点开的」由 **overlay-inside-entry** 单独判 —— 不许悄悄退回 JS 兜底还当成功。
  const gb21Opens = [];
  const firstOpen = await openDemoOverlayOnce(session, 'window', { prefer: 'mouse' });
  gb21Opens.push({ which: 'window', prefer: 'mouse', entry: '第④段开窗按钮（浮层外）', opened: firstOpen.opened, added: firstOpen.added, via: firstOpen.via, steps: firstOpen.steps });
  if (firstOpen.opened) {
    // 内部入口的现状（在不在、是不是真在浮层宿主内部、命中几何）单独记下来 —— overlay-inside-entry 的前置事实
    result.insideEntry = await readInsideEntry(session);
    const insideOpen = await openInsideDialogOnce(session, { selector: insideSelector, prefer: 'mouse' });
    result.insideOpen = insideOpen;
    gb21Opens.push({ which: 'dialog-inside', prefer: 'mouse', entry: '浮层内部入口（冻结锚点）', opened: insideOpen.opened, added: insideOpen.added, via: insideOpen.via, steps: insideOpen.steps, attempts: insideOpen.attempts });
    // 驱动级有牙对照：把第二扇再点一次 ⇒ 开窗账三行 ⇒ overlay-two-layers 必须判红
    if (MUTATION === 'overlay-double' && insideOpen.opened) {
      const extra = await openInsideDialogOnce(session, { selector: insideSelector, prefer: 'js' });
      gb21Opens.push({ which: 'dialog-inside#2(MUTATED · 驱动级)', prefer: 'js', entry: '浮层内部入口（重复点一次）', opened: extra.opened, added: extra.added, via: extra.via, steps: extra.steps });
    }
  }
  result.gb21Opens = gb21Opens;
  result.raw.insideEntry = result.insideEntry ?? null;
  result.raw.insideOpen = result.insideOpen ?? null;
  result.raw.gb21Opens = gb21Opens;
  const openedRows = await readOpenedRows(session); // 第④段的账＝**历史**（只增不减）：只用来读「开了什么、分到几号」
  const zOpened = parseOpenedZ(openedRows);
  const ledgerIds = openedRows.map((row) => String(row).split(/\s+/)[0]);
  const stackBefore = await readOverlayStack(session);
  await pressEscape(session);
  const stackAfter = await readOverlayStack(session);
  const beforeIds = stackBefore?.layers ?? [];
  const afterIds = stackAfter?.layers ?? [];
  const closedIds = beforeIds.filter((id) => !afterIds.includes(id));
  const topIdBeforeEsc = beforeIds.length === 0 ? null : beforeIds[beforeIds.length - 1];
  result.gb21 = {
    openedRows,
    zOpened,
    ledgerIds,
    opens: gb21Opens,
    stackBefore,
    stackAfter,
    beforeEscCount: beforeIds.length,
    afterEscCount: afterIds.length,
    closedIds,
    topIdBeforeEsc,
    remaining: afterIds,
    bottomSurvives: afterIds.length === 1 && afterIds[0] === (beforeIds[0] ?? null),
    topClosed: beforeIds.length >= 2
      && afterIds.length === beforeIds.length - 1
      && closedIds.length === 1
      && closedIds[0] === topIdBeforeEsc,
  };

  // 诊断通道专测（第③段）—— 同样：真鼠标优先，没生效才走 JS 兜底并记账
  const q17Via = [];
  await clickAction(session, 'channel');
  await sleep(700);
  if (!((await snapshot(session))?.sections ?? []).includes('channel')) {
    const js = await clickActionJs(session, 'channel');
    q17Via.push(js.ok === true ? 'channel:mouse无效→js' : `channel:mouse无效→js(${js.reason})`);
    await sleep(800);
  } else {
    q17Via.push('channel:mouse');
  }
  const failClick = await clickDemoFail(session);
  q17Via.push(failClick.ok === true ? 'fail-btn:mouse' : `fail-btn:mouse(${failClick.reason})`);
  let afterFail = await snapshot(session);
  if (afterFail?.failResult === null || afterFail?.failResult === undefined) {
    const js = await clickDemoFailJs(session);
    q17Via.push(js.ok === true ? 'fail-btn:mouse无效→js' : `fail-btn:mouse无效→js(${js.reason})`);
    await sleep(2500);
    afterFail = await snapshot(session);
  }
  result.q17.via = q17Via;
  result.q17.failClick = failClick.ok === true ? 'clicked' : `failed:${failClick.reason}`;
  // 归因探针：从**页面上下文**直连宿主 sink —— 一次分清「路由在不在 / 鉴权过不过 / stderr 落不落进装置日志」。
  // 没有它，diagnostics-host-line 判红时只能猜是「实现没写」还是「装置看不见」。
  result.q17.apiProbe = await session.evaluate(`(async () => {
    try {
      const post = await fetch('/api/gui-frame/diagnostics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plugin: 'dsh-gui-frame', phase: 'render', message: 'DIAGNOSTICS-STDERR-PROBE（装置归因探针 · 直连）', stack: '', clientVersion: '0.0.1', at: new Date().toISOString() }),
      });
      const text = await post.text();
      return { status: post.status, body: text.slice(0, 240) };
    } catch (error) {
      return { thrown: String(error?.message ?? error) };
    }
  })()`);
  await sleep(700);
  result.q17.apiResponses = session.responses().filter((row) => row.url.includes('/api/gui-frame/'));
  result.q17.networkFailures = session.failures();
  result.q17.result = afterFail?.failResult ?? null;
  result.q17.fingerprint = afterFail?.failFingerprint ?? null;
  result.raw.q17 = result.q17;
  result.raw.gb21 = result.gb21;
  result.raw.walk = result.walk;
  result.raw.panelOpened = result.panelOpened;
  result.raw.panelDump = result.panelDump;
  result.raw.readiness = result.readiness;
  // 变异明细也必须进 raw.json：范围闸（dock-panel-mutation）读的就是它 —— 只留在内存里的读数不算证据。
  if (result.mutation !== undefined) result.raw.mutation = result.mutation;
  return result;
}

/**
 * 页面级变异：把 gui-frame 模块的 apply 包成抛错（复现那条被吞掉的失败）。
 * ⚠ 写成**函数声明**（有提升）而不是 `const` 字符串：本文件在顶层 `await main()`，若用 const
 * 后置声明，`--mutation=apply-throw` 会在 pagePass 里撞 TDZ（实测过：`Cannot access … before initialization`）。
 */
