// real-machine/lib/workbench-pass.mjs —— 由 run.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 工作台取证段：进入/退出/刷新后保留的单页读数

import { state } from './config.mjs';
import { readSettingsText } from './corrupt.mjs';
import { sleep } from './cdp.mjs';
import { clickWorkbenchSwitch, dismissShellModal, readWorkbenchFacts, readWorkbenchProbe, reloadAndWaitWorkbench, workbenchRestored } from './judge.mjs';

export async function workbenchPass(session) {
  const readings = {
    d0: null, enter: null, d1: null, exit: null, d2: null, restore: null,
    reenter: null, saved: null, reload: null, d3: null, d3Settled: null,
    leave: null, d4: null, afterLeave: null,
  };
  readings.d0 = await readWorkbenchFacts(session);
  readings.enter = await clickWorkbenchSwitch(session, { expect: 'workbench' });
  readings.d1 = readings.enter.after ?? (await readWorkbenchFacts(session));
  readings.exit = await clickWorkbenchSwitch(session, { expect: 'official' });
  readings.d2 = readings.exit.after ?? (await readWorkbenchFacts(session));
  readings.restore = workbenchRestored(readings.d0, readings.d2);

  // ④ 再进一次，让「workbench」这个值真的过一遍 400ms 去抖 + revision 围栏再落盘
  readings.reenter = await clickWorkbenchSwitch(session, { expect: 'workbench' });
  await sleep(1600);
  readings.saved = readSettingsText();

  // ⑤ 真刷新：状态保留才算「刷新后保留」，而且要求**布局也真的被采用**（不是只翻了个标志）
  readings.reload = await reloadAndWaitWorkbench(session);
  // ⚠ **刷新之后必须再处置外壳模态**（首跑踩到的**装置自身缺陷**）：临时 home 里没有 API Key
  //   ⇒ 外壳的「添加一个 API Key」Dialog **每次加载页面都会重弹**（它不是持久化开关；内测声明才是，
  //   后者会写进 `ui-onboarding`）⇒ 不清它，刷新之后所有真鼠标点击都会打在 `_mask_*` 遮罩上。
  //   ⚠ 真机实测又发现它是**竞态**：有一轮里 `reloadModal.needed=false`（那一刻弹窗还没挂上），
  //   之后它才挂出来 ⇒ 单次处置不保险。改成**有界轮询**：窗口期内反复看，见到就处置，逐跳记账。
  //   ⚠ 这条有界轮询的修法**就是拿真机跑次来验它的**。
  readings.reloadModal = await dismissShellModal(session);
  readings.reloadModalSweeps = [readings.reloadModal];
  for (let sweep = 0; sweep < 6; sweep += 1) {
    await sleep(700);
    const again = await dismissShellModal(session, { attempts: 2, waitMs: 500 });
    readings.reloadModalSweeps.push(again);
    if (again?.maskPresent === true || again?.needed === true) break;
  }

  // ── 刷新后的**采用链时间线**（读数清单：立刻 / +800ms / +3.2s / +6.2s 各采一次）─────────────────────
  //   每一跳都同时采：① 界面读数（状态读数 / 侧栏是否收起 / 坞面板是否在中心列 / 轨）② 页面侧的
  //   `__internals.workbenchProbe()`（`readKindAtLoad`/`storeRead`/`deferredLoad`/`layoutRev`/`write`）。
  //   采样点之间的 `state` 变化就是「何时被采用」的直接证据；`d3` 取**最后一次**（给 workbench-persist 判）。
  const reloadT0 = Date.now();
  readings.stateTimeline = [];
  readings.probeTimeline = [];
  const sampleAdoption = async (label) => {
    const facts = await readWorkbenchFacts(session);
    const probe = await readWorkbenchProbe(session);
    const atMs = Date.now() - reloadT0;
    readings.stateTimeline.push({
      label, atMs,
      state: facts?.switch?.stateAttr ?? null,
      sidebarCollapsed: facts?.frame?.sidebarCollapsed === true,
      panelInCenter: facts?.panelInCenter === true,
      grid: facts?.frame?.gridRaw ?? null,
      notice: facts?.switch?.noticeText ?? null,
    });
    readings.probeTimeline.push({ label, atMs, ...probe });
    return facts;
  };
  let lastFacts = await sampleAdoption('reload+immediate');
  await sleep(800);
  lastFacts = await sampleAdoption('reload+~0.8s');
  await sleep(2400);
  lastFacts = await sampleAdoption('reload+~3.2s');
  await sleep(3000);
  lastFacts = await sampleAdoption('reload+~6.2s');
  readings.d3 = lastFacts;
  readings.d3Settled = lastFacts;

  // ⑥ 交还给官方布局（并把持久化值也写回 official，免得给下一轮留个「开机即工作台」的坑）
  readings.leave = await clickWorkbenchSwitch(session, { expect: 'official' });
  // 按读数清单 —— **leave 后 2000 ms** 再读文件原文，并与 `probe().write` 对账
  await sleep(2000);
  readings.d4 = readings.leave.after ?? (await readWorkbenchFacts(session));
  readings.afterLeave = readSettingsText();
  readings.probeAfterLeave = await readWorkbenchProbe(session);
  return readings;
}

/** 打开一次页面并按判据采集（两态共用）；`tag === 'install'` 时才走全套判据。 */
