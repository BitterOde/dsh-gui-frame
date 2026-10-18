// verify/real-machine/lib/install-phase.mjs —— 由 run.mjs 的「② 装上本包：起实例 → 全判据」段整体提出
// 口径：**函数体逐字等于原 run.mjs 那一段**（只包了一层 async function，未改写任何语句）。
// 该段只用得到本模块自己声明的局部量 + 文件级配置（lib/config.mjs）+ 判据纯函数（lib/judge/**），故无需入参。
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { BUNDLE_MARKER, MUTATION, outDir, profileName, raw, state, stateWanted } from './config.mjs';
import { pickFreePort, startServer } from './dsh.mjs';
import { check, checkShellModalPrereq } from './report.mjs';
import { pagePass } from './page-pass.mjs';
import {
  SETTINGS_INSTALL_PREFIX,
  bundleGateDetail,
  bundleGateVerdict,
  classifyHostResidual,
  dockPanelVerdicts,
  hostStderrLines,
  isDockPanelPass,
  isPanelHealthy,
  parseTimelineLine,
  readKindFromStatusText,
  settingsInstallLines,
  timelineLines,
  workbenchEnterVerdict,
  workbenchHostSettingsVerdict,
  workbenchOfficialEntriesVerdict,
  workbenchOfficialVerdict,
  workbenchPersistVerdict,
  workbenchSwitchVerdict,
} from './judge.mjs';

export async function installPhase() {
    const port = await pickFreePort();
    const server = startServer({ profile: profileName, port, logPath: path.join(outDir, 'install-server.log') });
    state.servers.push(server);
    const started = await server.waitForUrl();
    check('installed-instance', '装后实例起得来（独立端口，未触碰 3080）', started.url !== null, started.url === null ? started.reason : `port=${port}｜url=${started.url.replace(/token=[^&]*/g, 'token=***')}`);

    if (started.url !== null) {
      const pass = await pagePass({ url: started.url, tag: 'install', mutation: MUTATION, waits: 20_000 });
      raw.states.install = pass.raw;
      const snap = pass.snapshot ?? {};
      const ledger = pass.console;

      // 前置闸不再「只看标记串」—— 除标记外还**验身份**（服务字节是否逐字/按平台归一化口径包含当前 `lib/client.js`）。
      // 判定放在 lib/judge.mjs 的纯函数里（真机轮与离线自检跑的是同一份逻辑）。
      const gateVerdict = bundleGateVerdict(pass.gate);
      check(
        'bundle-identity',
        `前置闸：页面加载的字节是**当前**构建产物 \`lib/client.js\`（逐字包含；防「旧字节 ⇒ 伪阴性」）且含判据标记 ${BUNDLE_MARKER}`,
        gateVerdict.ok === true,
        bundleGateDetail(pass.gate),
      );

      const a = snap.anchors ?? {};
      const walkRows = pass.walk ?? [];
      // ── shell-modal-cleared：页面可交互前置（外壳模态必须先被处置掉）─────────────────────────────────────
      checkShellModalPrereq(pass);
      const layoutAnchor = walkRows.find((row) => row.section === 'layout')?.layoutEditor ?? 0;
      const panelAnchor = Math.max(Number(pass.panelAnchor ?? 0), (a.panel ?? 0));
      check(
        'anchors-all',
        '五类锚点齐：面板 / 主题 / 坞入口 / 浮层宿主 / 布局编辑器',
        panelAnchor > 0 && (a.theme ?? 0) > 0 && (a.glyph ?? 0) > 0 && (a.overlayRoot ?? 0) > 0 && layoutAnchor > 0,
        `面板=${panelAnchor}（开面板后取）｜主题=${a.theme ?? 0}｜坞入口=${a.glyph ?? 0}｜浮层宿主=${a.overlayRoot ?? 0}｜布局编辑器=${layoutAnchor}（第②段取）｜开面板：${pass.panelOpened?.opened === true ? `成功（${pass.panelOpened.via}）` : `失败（${pass.panelOpened?.reason ?? '?'}）`}`,
      );
      // anchors-subset：**正常轮恒绿**的那半（坞入口/主题/浮层宿主）单独一条 —— 有牙对照 `anchor` 就是打它
      check(
        'anchors-subset',
        '锚点子集（坞入口 / 主题 / 浮层宿主）三类都出现（有牙对照 `--mutation=anchor` 的靶点）',
        (a.glyph ?? 0) > 0 && (a.theme ?? 0) > 0 && (a.overlayRoot ?? 0) > 0,
        `坞入口=${a.glyph ?? 0}｜主题=${a.theme ?? 0}｜浮层宿主=${a.overlayRoot ?? 0}${pass.mutation === undefined ? '' : `｜mutation=${JSON.stringify(pass.mutation)}`}`,
      );

      // ── dock-panel-actions：**坞面板＝动作型入口收纳台** ────────────────────────────────────────────────────
      // 逐项都要在真机 DOM 上读，不看「应该没问题」：
      //   ① 本包在 `sidebar.panellist` 的条目**恰 1 条**（坞自己）——读 `[data-guif-glyph]` 里本包前缀的 id
      //       （坞图标是 panellist 座位唯一的占用者；本包自己的附加页 `sidebar:false` ⇒ 只占 `main`）；
      //   ② 坞面板里 `[data-guif-dock-action]` ≥ 1（demo 注册了 `kind:'action'` 入口，坞把它原样渲染进面板）；
      //   ③ 坞面板 `[data-guif-dock-actions]` 的**数值**与②数出来的锚点数**一致**（自报数不能对不上画出来的）；
      //   ④ 坞面板底部挂着布局编辑器（`[data-guif-dock-editor]` ≥ 1）。
      // ⚠ **只作读数、不作判据**：`[data-guif-badge]` —— 当前没有任何入口调 `setBadge` ⇒ 恒 0，
      //    写成判据就是恒真（本项目头号教训正是「替身绿当真实绿」）。照实收进证据，不假装它验过什么。
      const dock = pass.dockFacts ?? null;
      const dockOwn = (dock?.sidebarOwnIds ?? []).length;
      const dockItems = dockPanelVerdicts(dock);
      check(
        'dock-panel-actions',
        '坞面板＝动作型入口收纳台：① 本包在 sidebar.panellist 恰 1 条（坞自己）；② 坞面板里 [data-guif-dock-action] ≥ 1；③ [data-guif-dock-actions] 数值与动作锚点数一致；④ **浮出的按钮面板里布局编辑器锚点 = 0**（它只在管理页／工作台那一格，旧口径要求 ≥ 1）',
        isDockPanelPass(dock),
        `坞面板=${dock?.panelId ?? '(未找到)'}（active=${dock?.panelActive ?? '?'}｜全页面板=${JSON.stringify(dock?.panelIds ?? [])}）｜`
          + `① 侧栏本包条目=${dockOwn}${JSON.stringify(dock?.sidebarOwnIds ?? [])}=${dockItems.sidebarOne ? '✓' : '✗'}｜`
          + `② 动作锚点=${dock?.dockActionCount ?? '?'}${JSON.stringify(dock?.dockActionIds ?? [])}=${dockItems.actionAtLeastOne ? '✓' : '✗'}｜`
          + `③ data-guif-dock-actions=${JSON.stringify(dock?.dockActionsRaw ?? null)}（数值=${dock?.dockActionsNumber ?? 'null'}）=${dockItems.actionsMatch ? '✓' : '✗'}｜`
          + `④ 面板内布局编辑器锚点=${dock?.dockEditorCount ?? '?'}（须 0）=${dockItems.editorAbsentInPanel ? '✓' : '✗'}｜`
          + `读数（不作判据）角标：坞内=${dock?.badgeInPanel ?? '?'}／全页=${dock?.badgeInSidebar ?? '?'}｜坞内分组=${JSON.stringify(dock?.dockGroupKeys ?? [])}｜坞内导航按钮=${JSON.stringify(dock?.launcherIds ?? [])}｜`
          + `开坞面板=${pass.dockOpened?.opened === true ? `成功（${pass.dockOpened.via}）` : `失败（${pass.dockOpened?.reason ?? '?'}）`}｜坞面板就绪=${pass.dockReady === true ? '是' : `否（采样尾=${JSON.stringify((pass.dockFactsSamples ?? []).slice(-2))}）`}`
          + `${pass.mutation?.kind === 'dock-action' ? `｜⚠ 本轮为有牙变异：动作锚点选择器已被改错（真实读数见 raw.json 的 dockFactsBefore）` : ''}`,
      );

      const applyFailHits = ledger.hardRed.filter((row) => /apply 失败/.test(row.text));      const reactHits = ledger.hardRed.filter((row) => !/apply 失败/.test(row.text));
      check('console-apply-failure', 'console：`[gui-frame] 客户端 apply 失败` 命中 0', applyFailHits.length === 0, `命中 ${applyFailHits.length} 条${applyFailHits.map((row) => `｜${row.text.slice(0, 90)}`).join('')}`);
      check('console-react-error', 'console：`Minified React error` / hooks 顺序错误命中 0', reactHits.length === 0, `命中 ${reactHits.length} 条${reactHits.map((row) => `｜${row.text.slice(0, 90)}`).join('')}`);
      check(
        'console-expected-degraded',
        'console：`能力「X」未装配：no-slots` 这类补装窗口的预期降级单列为「预期」，不算红',
        true,
        ledger.expectedDegrade.length === 0 ? '本轮未出现（也属正常）' : `预期 ${ledger.expectedDegrade.length} 条：${ledger.expectedDegrade.map((row) => row.text.slice(0, 70)).join(' ｜ ')}`,
        { expected: true },
      );
      check('console-other-errors', 'console：其余 error 级条目（非上述三类）逐条列出', ledger.otherErrors.length === 0, ledger.otherErrors.length === 0 ? '无' : ledger.otherErrors.map((row) => row.text.slice(0, 90)).join(' ｜ '));

      const rowOf = (id) => walkRows.find((item) => item.section === id) ?? {};
      const dockRow = rowOf('dock');
      const layoutRow = rowOf('layout');
      const channelRow = rowOf('channel');
      const overlayRow = rowOf('overlay');
      check('demo-dock', 'demo ① 入口坞总览：段渲染出来且面板正文可读（非错误态）', dockRow.present === true && dockRow.errorState !== true, `① present=${dockRow.present} errorState=${dockRow.errorState} head=${JSON.stringify(dockRow.head ?? '')}`);
      check(
        'demo-layout',
        'demo ② 布局编辑预览：`data-guif-layout-editor` 在场且该处 state 非 error',
        layoutRow.present === true && (layoutRow.layoutEditor ?? 0) > 0 && layoutRow.errorState !== true,
        `② present=${layoutRow.present} layoutEditor=${layoutRow.layoutEditor} errorState=${layoutRow.errorState} reactErr=${JSON.stringify(layoutRow.reactErrorText ?? [])}`,
      );
      check('demo-channel', 'demo ③ 数据通道示例：② 之后仍可点（连坐消失）', channelRow.present === true && channelRow.errorState !== true, `③ present=${channelRow.present} errorState=${channelRow.errorState}`);
      check('demo-overlay', 'demo ④ 悬浮窗演示：③ 之后仍可点，开窗按钮在场', overlayRow.present === true && (overlayRow.demoOpen ?? []).length >= 3, `④ present=${overlayRow.present} 开窗按钮=${JSON.stringify(overlayRow.demoOpen ?? [])}`);

      // 面板健康五件套（在 demo-dock~d 之外单独钉「面板是活的」这条前置事实）
      const health = pass.panelHealth ?? null;
      check(
        'panel-health',
        '面板健康五件套（面板整块进错误态的合格线）：三态锚点全消失 / 正文无 `is not a function` / `data-guif-active=true` / 会话数是真实条数 / 四段动作齐备',
        pass.panelHealthy === true && isPanelHealthy(health),
        `三态锚点=${JSON.stringify(health?.states ?? null)}｜active=${health?.active ?? null}｜sessions-count=${health?.sessionsCountRaw ?? null}（外壳侧真值参照=${health?.shellSessionsBest ?? '?'}：${JSON.stringify(health?.shellSessionProbe ?? null)}）｜正文含「is not a function」=${health?.bodyHasNotAFunction ?? null}｜四段动作=${JSON.stringify(health?.actions ?? [])}｜采样尾=${JSON.stringify((pass.panelHealthSamples ?? []).slice(-2))}｜bodyHead=${JSON.stringify(health?.bodyHead ?? '')}`,
      );

      const gb21 = pass.gb21 ?? {};
      // overlay-real-mouse：**真鼠标路径**的读数 —— 命中自身、每点一次只开一层、z 递增，且如实记录
      // 「第二次真鼠标点击按设计先摘掉第一扇」。它是 overlay-two-layers/overlay-esc-top 的**前置事实**（真鼠标点得动、点击与开层 1:1）。
      const rm = pass.realMouse ?? null;
      const rmSteps = rm?.steps ?? [];
      check(
        'overlay-real-mouse',
        '真鼠标路径（第④段）：两扇各一次真鼠标点击**命中自身**、每次恰开一层（账 +1）、z 递增；第二次点击按设计摘掉第一扇（点外关闭）',
        rmSteps.length === 2
          && rmSteps.every((row) => row.hitSelf === true && row.ledgerDelta === 1)
          && (rmSteps[0].stack?.layers ?? []).length === 1
          && (rmSteps[1].stack?.layers ?? []).length === 1
          && (rmSteps[1].removedIds ?? []).length === 1
          && (rm?.zAfter ?? []).length === 2
          && rm.zAfter[1] > rm.zAfter[0],
        `逐点=${JSON.stringify(rmSteps.map((row) => `${row.which}: 命中自身=${row.hitSelf}/命中元素=${row.hitTag}.${String(row.hitClassName ?? '')}/账+${row.ledgerDelta}/点后层=${JSON.stringify(row.stack?.layers ?? [])}/被摘=${JSON.stringify(row.removedIds ?? [])}`))}｜z=${JSON.stringify(rm?.zAfter ?? [])}｜清场=${JSON.stringify({ closeAll: rm?.reset?.closeAllClick ?? null, stackAfter: rm?.reset?.stack?.layers ?? null, rowsAfter: rm?.reset?.rows?.length ?? null })}`,
      );
      // ── overlay-inside-entry：**第二扇走真鼠标**（浮层内部入口）──────────────────────────────────────────────
      // 曾把第二扇改成 JS click（那时两个开窗按钮都在浮层**外面**，真鼠标的 pointerdown 会命中
      // 设计内的「点外只关最上层」）。**浮动窗 content 里**冻结了新入口 ⇒ 机制前提变了：
      // pointerdown 落在浮层里 ⇒ 不触发点外关闭。这条判据判的就是「这一扇确实是**真鼠标**点开的」：
      //   · 锚点在场且**真在浮层宿主内部**（`closest('[data-guif-overlay-root]')`）+ 在浮动窗里；
      //   · 只做了一次点击、那次是**真鼠标**且 `elementFromPoint` 命中自身（**没有**走 JS 兜底）；
      //   · 那一下**恰开一层**（账 +1）。
      // 之所以单列一条：若某天退回 JS 兜底，overlay-two-layers/overlay-esc-top 仍会绿 —— 只有这条能把它抓住（反假绿）。
      const insideEntry = pass.insideEntry ?? null;
      const insideOpen = pass.insideOpen ?? null;
      const insideAttempts = insideOpen?.attempts ?? [];
      const firstAttempt = insideAttempts[0] ?? null;
      const openedByRealMouse = insideAttempts.length === 1 && firstAttempt?.kind === 'mouse' && firstAttempt?.ok === true;
      check(
        'overlay-inside-entry',
        '证① 第二扇＝**真鼠标**（浮层内部入口 `[data-guif-demo-open-dialog-inside]`）：锚点在浮层宿主内、一次真鼠标点击命中自身、恰开一层（**没用 JS 兜底**）',
        insideEntry?.present === true
          && insideEntry.inOverlayRoot === true
          && insideEntry.inFloatingWindow === true
          && openedByRealMouse
          && insideOpen?.mouseHitSelf === true
          && insideOpen?.added === 1,
        `锚点：在场=${insideEntry?.present ?? '?'}（全页 ${insideEntry?.count ?? '?'} 个）｜在浮层宿主内=${insideEntry?.inOverlayRoot ?? '?'}｜在浮动窗内=${insideEntry?.inFloatingWindow ?? '?'}｜所在层=${JSON.stringify(insideEntry?.inLayer ?? null)}｜命中的是=${insideEntry?.hitTag ?? '?'}｜`
          + `点击：策略=${JSON.stringify(insideOpen?.via ?? null)}｜尝试=${JSON.stringify(insideAttempts.map((row) => `${row.kind}:${row.ok === true ? 'clicked' : row.reason}`))}｜真鼠标命中自身=${insideOpen?.mouseHitSelf ?? '?'}（命中元素=${insideOpen?.mouseHitTag ?? '?'}）｜账 +${insideOpen?.added ?? '?'}｜`
          + `两扇点击明细=${JSON.stringify((pass.gb21Opens ?? []).map((row) => `${row.which}[${row.entry ?? '?'}](${row.prefer}):${row.opened === true ? '开' : '未开'}/${row.via}`))}`
          + `${pass.mutation?.kind === 'dialog-inside' ? '｜⚠ 本轮为有牙变异：内部入口选择器已被改错（真实读数见 raw.json 的 insideEntry）' : ''}`,
      );
      check(
        'overlay-two-layers',
        '证①：两扇浮层**各点一次**开出、两个层级号且后者更大、活层栈底→顶与账上两行同序（**不依赖只有浮动窗才有的锚点**）',
        (gb21.openedRows ?? []).length === 2
          && (gb21.zOpened ?? []).length === 2
          && gb21.zOpened[1] > gb21.zOpened[0]
          && (gb21.stackBefore?.layers ?? []).length === 2
          && gb21.stackBefore?.bottom === gb21.ledgerIds?.[0]
          && gb21.stackBefore?.top === gb21.ledgerIds?.[1],
        `开窗账=${JSON.stringify(gb21.openedRows ?? [])}｜z=${JSON.stringify(gb21.zOpened ?? [])}｜活层栈=${JSON.stringify(gb21.stackBefore?.layers ?? [])}（root attr=${gb21.stackBefore?.layersAttr ?? '?'}）｜每扇点击=${JSON.stringify((gb21.opens ?? []).map((row) => `${row.which}(${row.prefer}):${row.opened === true ? '开' : '未开'}/${row.via}`))}`,
      );
      check(
        'overlay-esc-top',
        '证①：Esc 只关栈顶（**活的层栈读数减一**，少掉的正是栈顶那扇，且底下那扇还在）',
        gb21.afterEscCount === 1 && gb21.topClosed === true && gb21.bottomSurvives === true,
        `Esc 前 ${gb21.beforeEscCount} 扇 ${JSON.stringify(gb21.stackBefore?.layers ?? [])} → 后 ${gb21.afterEscCount} 扇 ${JSON.stringify(gb21.stackAfter?.layers ?? [])}｜少掉=${JSON.stringify(gb21.closedIds ?? [])}｜栈顶=${gb21.topIdBeforeEsc ?? '?'}｜关掉 top=${gb21.topClosed}｜底下那扇还在=${gb21.bottomSurvives}`,
      );

      const stderrLines = hostStderrLines(path.join(outDir, 'install-server.log'));
      // 宿主侧 **settings 注册读数**（grep 那行可观测行）。只读，不改宿主行为。
      const hostSettingsLines = settingsInstallLines(path.join(outDir, 'install-server.log'));
      raw.hostSettingsLines = hostSettingsLines;
      // **载入/采用链时间线**（经既有的诊断上报通道落到宿主 stderr）。只读，不改客户端行为。
      const timelineRaw = timelineLines(path.join(outDir, 'install-server.log'));
      const timelineParsed = timelineRaw.map((line) => parseTimelineLine(line)).filter((row) => row !== null);
      raw.workbenchTimeline = { count: timelineParsed.length, lines: timelineRaw, parsed: timelineParsed };
      check('diagnostics-client-sent', '诊断通道专测：点 `data-guif-demo-fail` 后界面结果行变 `sent`（带指纹）', pass.q17?.result === 'sent' && typeof pass.q17?.fingerprint === 'string' && pass.q17.fingerprint.length > 0, `click=${pass.q17?.failClick}｜result=${pass.q17?.result}｜fingerprint=${pass.q17?.fingerprint}`);
      check(
        'diagnostics-host-line',
        '诊断通道专测：宿主 stderr 出现 `[gui-frame] 客户端失败 …`（cmd 可见性的离线等价证据）',
        stderrLines.length >= 1,
        stderrLines.length === 0
          ? `宿主日志里没有该行｜直连探针=${JSON.stringify(pass.q17?.apiProbe ?? null)}｜/api/gui-frame/ 响应=${JSON.stringify(pass.q17?.apiResponses ?? [])}｜网络失败=${JSON.stringify(pass.q17?.networkFailures ?? [])}（注：diagnostics-client-sent 的「sent」只代表进本地队列，不代表宿主收到）`
          : stderrLines[0].slice(0, 170),
      );

      raw.consoleLedger = { hardRed: ledger.hardRed.map((row) => row.text), expectedDegrade: ledger.expectedDegrade.map((row) => row.text), otherErrors: ledger.otherErrors.map((row) => row.text) };
      raw.hostStderr = stderrLines.slice(0, 5);

      // ── 工作台：workbench-toggle…workbench-manual ─────────────────────────────────────────────────────────────────────────
      // ⚠ 号段说明：10 号段已经被「对照组 profile entry 0 次」占用
      //   （见上面 control 段）⇒ 沿用那片号段会让靶点表/报告里两族撞车。这里改用独立号段 RM-17x，
      //   并在 README 的判据表里登记。
      const wb = pass.workbench ?? {};
      const wbD0 = wb.d0 ?? null;
      const wbD1 = wb.d1 ?? null;
      const wbD2 = wb.d2 ?? null;
      const wbD3 = wb.d3 ?? null;
      const wbD3s = wb.d3Settled ?? null;
      const wbD4 = wb.d4 ?? null;
      const wbSw = wbD0?.switch ?? {};
      const stateOf = (facts) => facts?.switch?.stateAttr ?? null;
      const wantThumb = (state) => (state === 'workbench' ? 'right' : 'left');
      const tracksOf = (facts) => [facts?.frame?.sidebarTrack ?? null, facts?.frame?.centerTrackRaw ?? null, facts?.frame?.rightbarTrack ?? null];
      const savedText = wb?.saved?.text ?? null;
      const afterLeaveText = wb?.afterLeave?.text ?? null;
      const persistedHasWorkbench = savedText !== null && savedText.includes('workbench');
      const censusOf = (facts) => JSON.stringify(facts?.sidebarLabelCensus ?? null);
      // 把时间线按「i=1 起一组」切开，取**最后一组**＝ reload 之后那次页面载入的 4 点读数
      const timelineRows = raw.workbenchTimeline?.parsed ?? [];
      const timelineGroups = [];
      for (const row of timelineRows) {
        if (row.index === 1 || timelineGroups.length === 0) timelineGroups.push([]);
        timelineGroups[timelineGroups.length - 1].push(row);
      }
      const lastTimeline = timelineGroups.length === 0 ? [] : timelineGroups[timelineGroups.length - 1];
      const timelineText = lastTimeline.map((row) => `${row.index}/${row.total}@${row.offsetMs}ms state=${row.state} readKindAtLoad=${row.readKindAtLoad} storeRead=${row.storeRead} armed=${row.deferredArmed} fired=${row.deferredFired} rev=${row.layoutRev} adopted=${row.adopted}` + (row.scopeStatus === null ? '' : ` scope=${row.scopeStatus}@rev${row.scopeRevision} val=[${(row.valKeys ?? []).join(',')}] usr=[${(row.usrKeys ?? []).join(',')}]`));
      // ★ **宿主侧残因归类**（按固定的三分表归类）。这是**读数**，不参与 workbench-persist 的判绿/判红；
      //   归类逻辑同样是 lib/judge.mjs 的纯函数（离线自检里有正反例）。
      const residual = classifyHostResidual(lastTimeline.length === 0 ? {} : lastTimeline[lastTimeline.length - 1]);
      const residualText = `${residual.kind}${residual.note === null ? '' : `+${residual.note}`}（${residual.why}）`;
      // ★ 判定本身在 lib/judge.mjs 的**纯函数**里（真机轮与离线自检调的是同一份逻辑，不写两遍）
      const vSwitch = workbenchSwitchVerdict(wbD0);
      const vEnter = workbenchEnterVerdict(wbD0, wb.enter, wbD1);
      const vOfficial = workbenchOfficialVerdict(wbD0, wbD2);
      const vPersist = workbenchPersistVerdict({ persistedText: savedText, afterReload: wbD3 });
      const enterHit = wb?.enter?.hit ?? null;

      check(
        'workbench-toggle',
        '工作台开关在位且**三处同源**：容器冻结锚点恰 1 个、内部 `button[role="switch"]`、状态读数 ∈ {official,workbench} 与 `aria-checked` / 滑块 `data-guif-workbench-thumb` 逐一对应',
        vSwitch.ok === true,
        `[data-guif-workbench-switch]×${wbSw.count ?? '?'}｜button[role=switch]=${wbSw.buttonPresent ?? '?'}｜状态读数=${JSON.stringify(wbSw.stateAttr)}｜aria-checked=${JSON.stringify(wbSw.ariaChecked)}（应=${JSON.stringify(String(wbSw.stateAttr === 'workbench'))}）｜thumb=${JSON.stringify(wbSw.thumbAttr)}（应=${JSON.stringify(wantThumb(wbSw.stateAttr))}）｜aria-label=${JSON.stringify(wbSw.ariaLabel ?? null)}｜界面提示行=${JSON.stringify(wbSw.noticeText ?? null)}｜点击前官方 frame：轨=${JSON.stringify(tracksOf(wbD0))}｜sidebarCollapsed=${wbD0?.frame?.sidebarCollapsed ?? '?'}`,
      );

      check(
        'workbench-enter',
        '真鼠标点一次 ⇒ 进入工作台布局：状态读数=`workbench`、侧栏**收起**（官方属性 `data-sidebar-collapsed` + 侧栏轨=56 的 rail）、坞面板渲染在**中心列**（main）、右栏轨打开、侧栏拖柄随收起消失（官方实现自洽）',
        vEnter.ok === true,
        `点击=${wb?.enter?.via ?? '(没点到)'}｜命中自身=${enterHit?.self ?? '?'}（命中元素=${enterHit?.tag ?? '?'}${enterHit?.className === undefined ? '' : `.${String(enterHit.className).slice(0, 40)}`}）｜状态 ${JSON.stringify(stateOf(wbD0))} → ${JSON.stringify(stateOf(wbD1))}｜官方 frame 轨=${JSON.stringify(tracksOf(wbD1))}（侧栏 ${wbD1?.frame?.sidebarTrack ?? '?'}px／右栏 ${wbD1?.frame?.rightbarTrack ?? '?'}px）｜data-sidebar-collapsed=${wbD1?.frame?.sidebarCollapsed ?? '?'}｜data-rightbar-collapsed=${wbD1?.frame?.rightbarCollapsed ?? '?'}｜data-rightbar-fullscreen=${wbD1?.frame?.rightbarFullscreen ?? '?'}｜侧栏拖柄=${wbD1?.frame?.dragHandleSidebar ?? '?'}（收起态应为 false）｜坞面板数=${wbD1?.panelCount ?? '?'}｜在中心列=${wbD1?.panelInCenter ?? '?'}／在右栏列=${wbD1?.panelInRightbar ?? '?'}｜提示行=${JSON.stringify(wbD1?.switch?.noticeText ?? null)}｜⚠ 「main 是否算全屏」属观感 ⇒ 本判据只断言**结构与官方属性**，视觉判定见 workbench-manual 留人工`,
      );

      const restore = wb?.restore ?? null;
      check(
        'workbench-restore',
        '再点一次 ⇒ **完全还原**：退出后的读数与**进入前**逐字段相等（状态／侧栏收起与轨宽／main 是否还停在坞面板／右栏轨与 fullscreen／侧栏拖柄／侧栏内容摘要），**不是「看起来回来了」**',
        wb?.exit?.ok === true && restore?.restored === true,
        `退出点击=${wb?.exit?.via ?? '(没点到)'}｜逐项比对=${restore?.restored === true ? '全部相等' : `不等：${JSON.stringify(restore?.diffs ?? [])}`}｜进入前=${JSON.stringify(restore?.before ?? null)}｜退出后=${JSON.stringify(restore?.after ?? null)}`,
      );

      check(
        'workbench-persist',
        '刷新后状态保留：`workbench` 真的写进**隔离 home** 的 `settings.yaml`（看字节，不只看界面），且 `Page.reload` 之后状态读数仍是 `workbench`、侧栏收起、坞面板仍在中心列（＝持久化值被**采用**成布局，不是只翻了个标志）',
        vPersist.ok === true,
        `落盘文件=${wb?.saved?.path ?? '?'}（${wb?.saved?.bytes ?? '?'} 字节（UTF-8）｜含 workbench=${persistedHasWorkbench}）｜刷新就绪=${wb?.reload?.ready === true}｜刷新后状态=${JSON.stringify(stateOf(wbD3))}｜侧栏收起=${wbD3?.frame?.sidebarCollapsed ?? '?'}｜坞面板在中心列=${wbD3?.panelInCenter ?? '?'}｜刷新后采样尾=${JSON.stringify((wb?.reload?.samples ?? []).slice(-3))}｜刷新后提示行=${JSON.stringify(wbD3s?.switch?.noticeText ?? wbD3?.switch?.noticeText ?? null)}｜**采用链时间线**：${JSON.stringify((wb?.stateTimeline ?? []).map((row) => `${row.label}@${row.atMs}ms:${row.state}${row.sidebarCollapsed ? '(收起)' : ''}`))}｜**页面侧采样读数**（${JSON.stringify((wb?.probeTimeline ?? []).map((row) => ({ label: row.label, available: row.available === true, reason: row.reason ?? null, readKindAtLoad: row.probe?.readKindAtLoad ?? null, adopted: row.probe?.adopted ?? null, state: row.probe?.state ?? null, storeKind: row.probe?.storeRead?.kind ?? null, layoutRev: row.probe?.layoutRev ?? null, fired: row.probe?.deferredLoad?.fired ?? null, armed: row.probe?.deferredLoad?.armed ?? null, skipped: row.probe?.deferredLoad?.skipped ?? null })))}）｜**时间线**（宿主 stderr 共 ${timelineRows.length} 行／${timelineGroups.length} 组；取最后一组＝reload 后那次页面载入）：${JSON.stringify(timelineText)}｜**宿主侧残因归类**（三分表 · **读数，不作判据**）：${residualText}｜（读数，不作判据）点回官方后状态=${JSON.stringify(stateOf(wbD4))}、再读文件仍含 workbench=${afterLeaveText === null ? '?' : afterLeaveText.includes('workbench')}、leave 后 probe.write=${JSON.stringify(wb?.probeAfterLeave?.probe?.write ?? null)}｜**机制直读**（坞面板布局编辑器）：状态行=${JSON.stringify(pass.layoutEditorInstall?.statusText ?? null)}｜data-guif-layout-writable=${JSON.stringify(pass.layoutEditorInstall?.writableAttr ?? null)}｜notice=${JSON.stringify(pass.layoutEditorInstall?.noticeText ?? null)}｜锚点 overwritePage=${pass.layoutEditorInstall?.overwritePage ?? '?'}`,
      );

      check(
        'workbench-official-frame',
        '官方侧两种布局下都不受影响：官方 frame 契约自洽（`[data-shell-overlay]` 与 `[data-rightbar-col]` 各 1、恰好 3 条轨）＋侧栏内容摘要与语义标签在两态**完全一致**',
        vOfficial.ok === true,
        `官方 shell.overlay=${wbD0?.frame?.shellOverlayCount ?? '?'}→${wbD2?.frame?.shellOverlayCount ?? '?'}｜data-rightbar-col=${wbD0?.frame?.rightbarColCount ?? '?'}→${wbD2?.frame?.rightbarColCount ?? '?'}｜轨数=${wbD0?.frame?.trackCount ?? '?'}→${wbD2?.frame?.trackCount ?? '?'}｜侧栏摘要一致=${typeof wbD0?.sidebarSignature === 'string' && wbD0.sidebarSignature === wbD2?.sidebarSignature}｜侧栏语义标签=${JSON.stringify(wbD0?.sidebarLabelCensus ?? null)}（两态一致=${censusOf(wbD0) === censusOf(wbD2)}）｜侧栏按钮数=${wbD0?.sidebarButtonCount ?? '?'}→${wbD2?.sidebarButtonCount ?? '?'}｜（「非本包入口」那一分句已拆成 workbench-official-entries，因为它在本环境空转）`,
      );

      // ── workbench-official-entries：非本包入口一致性的**适用性闸** ───────────────────────────────────────────────
      // 旧的写法把 `officialGlyphIdsSame` 塞进 workbench-official-frame 的 ok 链：出厂 profile 里两态都是 `[]` ⇒ **恒真**。
      // 现在单列：空数组 ⇒ 本条**不适用**，按「未取真机证」登记（不算绿、也不算实现红）；两态非空才真比。
      const vEntries = workbenchOfficialEntriesVerdict(wbD0, wbD2);
      if (vEntries.applicable === true) {
        check(
          'workbench-official-entries',
          '非本包（官方/其它插件）的侧栏入口在两种布局下**不受影响**：两态读数非空且逐项相等',
          vEntries.same === true,
          `两态非本包入口 id=${JSON.stringify(vEntries.ids0)} / ${JSON.stringify(vEntries.ids1)}｜逐项相等=${vEntries.same === true}`,
        );
      } else {
        check(
          'workbench-official-entries',
          '非本包（官方/其它插件）的侧栏入口在两种布局下**不受影响**：两态读数非空且逐项相等',
          false,
          `⚠ **本条不适用**（不算绿）：出厂 profile 只装了本包 ⇒ 两态「非本包入口」读数都是 ${JSON.stringify(vEntries.ids0)} / ${JSON.stringify(vEntries.ids1)}（空数组）⇒ 比相等是**空转恒真**，不能当证据。要真正覆盖这一分句，需要一个**装了别的 panellist 占用者**的 profile。`,
          { notEvidence: true, reason: '出厂 profile 只装本包 ⇒ 非本包入口读数两态皆空数组，该断言在本环境**不可测**（空转恒真不算证据）' },
        );
      }

      // ── workbench-cause：用宿主侧读数 + 客户端读数把 workbench-persist 的成因**二选一钉死** ────────────────────────
      const hostSettingsLine = hostSettingsLines.length === 0 ? null : hostSettingsLines[hostSettingsLines.length - 1];
      const clientReadKind = readKindFromStatusText(pass.layoutEditorInstall?.statusText);
      const clientWritable = pass.layoutEditorInstall?.writableAttr === 'true';
      const vHost = workbenchHostSettingsVerdict({ hostLine: hostSettingsLine, clientReadKind, clientWritable });
      raw.workbenchHost = { hostLine: hostSettingsLine, clientReadKind, clientWritable, cause: vHost.cause, causeText: vHost.causeText, verdict: vHost.detail, allLines: hostSettingsLines };
      if (vHost.ok === true) {
        check(
          'workbench-cause',
          'workbench-persist 成因已钉死（宿主侧注册读数 ✕ 客户端读数交叉定位）：① 宿主没注册 ② 注册了但客户端看不到 ③ 已注册且客户端可写（与本条无关）',
          true,
          `宿主读数（前缀 \`${SETTINGS_INSTALL_PREFIX}\`，共 ${hostSettingsLines.length} 行，取最后一行）=${JSON.stringify(vHost.detail.hostLine)}｜seq=${vHost.detail.seq ?? '?'}｜registered=${vHost.detail.registered ?? '?'}｜reason=${vHost.detail.reason ?? '—'}｜at=${vHost.detail.at ?? '—'}｜客户端：read.kind=${JSON.stringify(clientReadKind)}｜可写=${clientWritable}｜⇒ **成因=${vHost.cause}**：${vHost.causeText}`,
        );
      } else {
        check(
          'workbench-cause',
          'workbench-persist 成因已钉死（宿主侧注册读数 ✕ 客户端读数交叉定位）：① 宿主没注册 ② 注册了但客户端看不到 ③ 已注册且客户端可写（与本条无关）',
          false,
          `⚠ **取不到宿主侧读数 ⇒ 成因未钉死**（insufficient-readout）：日志里 \`${SETTINGS_INSTALL_PREFIX}\` 命中 ${hostSettingsLines.length} 行｜客户端 read.kind=${JSON.stringify(clientReadKind)}｜可写=${clientWritable}`,
          { notEvidence: true, reason: `宿主侧 settings 注册行（前缀 \`${SETTINGS_INSTALL_PREFIX}\`）没出现在装置日志里 ⇒ 读数缺失，**不猜**成因` },
        );
      }

      check(
        'workbench-manual',
        '留人工项（本装置不代判）：工作台切换的**闪屏 / 切换动画 / 观感是否与现有 DSH 一致 / 布局切换手感**，以及「main 看起来是否算全屏」',
        true,
        `本装置只给结构读数（轨宽、属性、锚点），不给视觉判定。人看什么：点开关那一刻有没有闪屏/错位、右栏与中心列是否自然、再点回来是否与原样无异｜界面形状见 src/client/workbench/switch.mjs（toggle switch + thumb，role=switch）`,
        { manual: true },
      );
      raw.workbench = wb;
    }
}
