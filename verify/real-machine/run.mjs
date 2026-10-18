#!/usr/bin/env node
/**
 * run.mjs —— 真机验收装置：从出厂模板建临时 profile → 注册 link 包 → 起独立端口实例 →
 * headless Edge + CDP 采判据 → 回收自己起的进程 → 落盘证据。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 纪律（跑之前先读；同目录 README.md 有完整版）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 1. 本目录是全仓唯一允许起进程的验证资产；跑它之前必须取得一次明确同意。
 * 2. 只用自己新建的临时 profile（`guifrm<时间戳>`，从出厂模板建），绝不写 `web`；
 *    绝不碰 127.0.0.1:3080（只读它的 PID，收尾核对没变）。
 * 3. 收尾只回收自己起的进程（临时 profile 的 dsh 实例 + 命令行里带自己专属 `--user-data-dir` 的 msedge）；
 *    绝不「杀所有 node / 杀所有 msedge」。
 * 4. **整跑跑在独立的 `$DSH_HOME` 上**（默认 `%TEMP%/guif-dsh-<stamp>`，收尾删掉）。为什么必须隔离：
 *    客户端设置的落地文件是 **`$DSH_HOME/settings.yaml`**（`dsh-settings-file` 的 `resolveDshHome()`），
 *    而用户正在用的 GUI（3080）读的是同一份 `~/.dsh/settings.yaml` —— 本装置要往 `gui-frame.layout`
 *    写一份**坏载荷**来取证「用默认值覆盖」，写进用户真实 home 就是污染用户环境。
 *    隔离之后：profile 也一并落在临时 home 里，用户 `~/.dsh` **只读不写**。
 *
 * 跑法（详见 README）：`node verify/real-machine/run.mjs [--dry-run] [--keep] [--only=control,install,corrupt] [--dsh-home=<路径>] [--mutation=apply-throw|anchor|console-apply|panel-active|overlay-double|esc-block|dock-action|dialog-inside|layout-overwrite|layout-path]`
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import os from 'node:os';

import path from 'node:path';

import { CdpSession, launchEdge, sleep, waitForPageTarget } from './lib/cdp.mjs';

import { addPlugin, countLoaderEntry, createProfileFromTemplate, dshHome, dumpConfig, isPortListening, listenerPid, pickFreePort, profileDir, startServer } from './lib/dsh.mjs';

import { DRY_RUN, GUI_FRAME_ENTRY_ID, KEEP, LINK_SPEC, MUTATION, PKG_DIR, SETTINGS_NAMESPACE, SETTINGS_TEST_WORKBENCH_FIELD, dshHomeDir, edgeUserDataDir, outDir, ownedHome, profileName, raw, realHome, setRaw, settingsPath, state, stateWanted, wantedStates } from './lib/config.mjs';
import { check, checks, renderReport, reportMutationScope } from './lib/report.mjs';
import { killEdgeByMarker } from './lib/mutations.mjs';
import { readCorruptOutcome, seedCorruptLayout } from './lib/corrupt.mjs';
import { pagePass } from './lib/page-pass.mjs';
import { installPhase } from './lib/install-phase.mjs';

console.log('');

console.log('== 真机验收装置 ==');

console.log(`  模式：${MUTATION === 'none' ? '常规态（不装对照组 + 装后全判据 + 坏载荷态）' : `有牙对照 mutation=${MUTATION}`}${DRY_RUN ? '（dry-run）' : ''}｜态=${JSON.stringify(wantedStates)}`);

console.log(`  临时 profile：${profileName}｜证据目录：${outDir}`);

console.log(`  link 规格：${LINK_SPEC}`);

console.log(`  $DSH_HOME（**隔离**）：${dshHomeDir}${ownedHome ? '（本轮新建，收尾删）' : '（外部指定，不删）'}｜用户真实 home=${realHome}（只读）`);

console.log(`  settings.yaml（判据读的就是这一份）：${settingsPath}`);

console.log(`  Edge user-data-dir（专属回收标记）：${edgeUserDataDir}`);

console.log('  纪律：会起独立端口实例与 headless Edge；不写 web profile、不碰 3080、只回收自己起的进程。');

console.log('');

if (DRY_RUN) {
  console.log('[dry-run] 不做任何动作：不建 profile、不起进程、不写证据。');
  process.exitCode = 0;
} else {
  await main();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const pid3080Before = await listenerPid(3080);
  setRaw({ profileName, linkSpec: LINK_SPEC, mutation: MUTATION, edgeUserDataDir, outDir, states: {}, checks: [] });
  check('baseline-pid', '基线：记录 3080 监听者 PID（收尾必须不变；脚本全程不碰它）', true, `3080 PID=${pid3080Before ?? '(未读到)'}`);
  // 起跑前环境读数：空闲物理内存（沿用 4096 MB 口径）+ 3080 PID。**只进证据、不作判据**
  // ——「未达标即 fail-closed」那道硬闸做在 `tools/dsh-shot.mjs` 里，本装置一直是手工核对。
  {
    const freeMb = Math.round(os.freemem() / (1024 * 1024));
    raw.preflight = { freeMb, minFreeMb: 4096, ok: freeMb >= 4096, pid3080: pid3080Before ?? null, at: new Date().toISOString(), source: 'node:os.freemem()' };
    console.log(`  起跑前环境：空闲物理内存 ${freeMb} MB（门槛 4096 MB ⇒ ${freeMb >= 4096 ? '达标' : '**未达标**'}）｜3080 PID=${pid3080Before ?? '(未读到)'}`);
  }
  check('environment-ready', '环境：本包 package.json 可达、Edge 可用', existsSync(path.join(PKG_DIR, 'package.json')) && existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'), `link=${LINK_SPEC}`);
  // isolated-home：**跑在隔离的 $DSH_HOME 上** —— 坏载荷那条判据要往 settings.yaml 写东西，
  // 写进用户真实 home 就是污染用户正在用的 GUI（3080 读的是同一份文件）。
  check(
    'isolated-home',
    '隔离：本次跑用独立的 $DSH_HOME（用户真实 home 全程只读；坏载荷只写进临时 home）',
    process.env.DSH_HOME === dshHomeDir && dshHomeDir !== path.resolve(realHome) && dshHome() === dshHomeDir,
    `DSH_HOME=${dshHomeDir}｜用户 home=${path.resolve(realHome)}｜一致=${process.env.DSH_HOME === dshHomeDir}｜lib/dsh.mjs 视角=${dshHome()}`,
  );

  try {
    // ── ① 对照组（不装）：从出厂模板建 profile，页面必须照常启动且零锚点 ─────────────────────────
    const created = await createProfileFromTemplate(profileName);
    const controlCount = countLoaderEntry(created.config, GUI_FRAME_ENTRY_ID);
    raw.createProfile = { code: created.code, configBytes: created.config.length, entryCount: controlCount };
    check('control-profile', '对照组 profile 从出厂模板建成，loader entry `gui-frame` 恰 0 次（天然对照组）', created.code === 0 && controlCount === 0, `exit=${created.code}｜gui-frame entry=${controlCount} 次｜配置 ${created.config.length} 字符`);

    if (stateWanted('control')) {
      const controlPort = await pickFreePort();
      const controlServer = startServer({ profile: profileName, port: controlPort, logPath: path.join(outDir, 'control-server.log') });
      state.servers.push(controlServer);
      const controlUrl = await controlServer.waitForUrl();
      check('control-instance', '对照组实例起得来（独立端口 + 带 token 的启动 URL）', controlUrl.url !== null, controlUrl.url === null ? controlUrl.reason : `port=${controlPort}｜url=${controlUrl.url.replace(/token=[^&]*/g, 'token=***')}`);
      if (controlUrl.url !== null) {
        const pass = await pagePass({ url: controlUrl.url, tag: 'control', mutation: MUTATION, waits: 9_000 });
        raw.states.control = pass.raw;
        const c = pass.snapshot;
        check(
          'not-installed-page',
          '不装态：页面照常启动（有正文、无本包任何锚点 ⇒ 零影响）',
          c !== null && c.bodyText > 200 && c.anchors.panel === 0 && c.anchors.glyph === 0 && c.anchors.overlayRoot === 0 && c.anchors.layoutEditor === 0,
          c === null ? '没拿到快照' : `bodyText=${c.bodyText} 字符｜panel=${c.anchors.panel} glyph=${c.anchors.glyph} overlayRoot=${c.anchors.overlayRoot} layoutEditor=${c.anchors.layoutEditor}`,
        );
        check('not-installed-console', '不装态：console 无本包硬红（apply 失败 / React 错误码 3xx）', pass.console.hardRed.length === 0, `hardRed=${pass.console.hardRed.length}：${pass.console.hardRed.map((row) => row.text.slice(0, 60)).join(' ｜ ') || '—'}`);
      }
      controlServer.stop();
      await sleep(800);
    }

    // ── 装包（`install` 与 `corrupt` 两态共用）：link → dump-config 恰好一次 ─────────────────────
    if (stateWanted('install') || stateWanted('corrupt')) {
    const added = await addPlugin(profileName, LINK_SPEC);
    raw.addPlugin = { code: added.code, tail: `${added.stdout}${added.stderr}`.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-3) };
    check('plugin-add', '`dsh plugin --profile <临时> add link:<本包>` 成功', added.code === 0, `exit=${added.code}｜${raw.addPlugin.tail.join(' / ').slice(0, 160)}`);

    const dumped = await dumpConfig(profileName);
    const installCount = countLoaderEntry(dumped.config, GUI_FRAME_ENTRY_ID);
    // 量纲：`dumped.config.length` 是 **UTF-16 码元数**（不是字节）⇒ 字段名用 `units`，字节另记 `utf8Bytes`
    raw.dumpConfig = { code: dumped.code, entryCount: installCount, units: dumped.config.length, utf8Bytes: Buffer.byteLength(dumped.config, 'utf8') };
    writeFileSync(path.join(outDir, 'dump-config.yml'), dumped.config, 'utf8');
    check('dump-config-single-entry', '装后 dump-config：loader entry `gui-frame` 恰好一次（duplicate 会让 DSH 起不来）', installCount === 1, `exit=${dumped.code}｜gui-frame entry=${installCount} 次`);
    }

    // ── ★ 前置：把「测试工作台」这道门打开（语义＝用户在 DSH 设置页打开它）──────────────────────────
    // 为什么必须有这一步：门控（`gui-frame.testWorkbench`）**缺省 false** ⇒ 状态表只剩 `official` ⇒ 顶部
    // 开关**按设计自动隐藏**（「只有一个状态时滑块自动隐藏」）⇒ 工作台那一族判据会全部读不到锚点，
    // 表现为一串**假红**。装置因此先写隔离 home 的 `settings.yaml`（用户真实 home 只读，一个字节不碰）。
    const gateSeed = (() => {
      try {
        mkdirSync(dshHomeDir, { recursive: true });
        const existing = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
        const text = existing.includes(`${SETTINGS_NAMESPACE}:`)
          ? existing // 已有本包那一节（例如 `--keep` 复用旧 home）⇒ 不动它，免得覆盖上一轮的取证状态
          : `${existing}${SETTINGS_NAMESPACE}:\n  ${SETTINGS_TEST_WORKBENCH_FIELD}: true\n`;
        writeFileSync(settingsPath, text, 'utf8');
        return { ok: true, bytes: Buffer.byteLength(text, 'utf8'), reused: existing.includes(`${SETTINGS_NAMESPACE}:`) };
      } catch (error) {
        return { ok: false, reason: String(error?.message ?? error) };
      }
    })();
    raw.gateSeed = gateSeed;
    check('shell-modal-cleared', '测试工作台的门控已打开（`gui-frame.testWorkbench: true`，只写**隔离 home** 的 settings.yaml）', gateSeed.ok === true, `settings.yaml=${settingsPath}｜写入=${gateSeed.ok === true ? `${gateSeed.bytes} 字节（沿用旧节=${gateSeed.reused}）` : `失败：${gateSeed.reason}`}`);

    // ── ② 装上本包：起实例 → 全判据 ─────────────────────────────────────────────────────────────
    if (stateWanted('install')) {
    await installPhase();
    }

    // ── ③ 坏载荷态：把一份**读不出来**的布局载荷预先写进 settings.yaml，再起一台新实例 ──────────────
    // 判据见下面的 corrupt-invalid-readable…corrupt-file-rebuilt。三件事必须同时成立才算「显式覆盖」这件事真的做对了：
    //   ① 载荷坏掉时界面**给出**那条唯一的人工出路（锚点在场）；
    //   ② **点它之前一个字节都不写**（负控：原载荷仍在、界面仍只读）；
    //   ③ 点它之后载荷被清空、按当前已注册入口的默认顺序重建、可写恢复，并且**把人读结果说出来**。
    if (stateWanted('corrupt')) {
      const seeded = seedCorruptLayout();
      raw.corrupt = { settingsPath, seeded };
      check(
        'corrupt-payload-seed',
        '坏载荷前置：把 schemaVersion 高于本实现的布局载荷写进**临时 home** 的 settings.yaml（用户真实 home 不动）',
        seeded.ok === true,
        `settings.yaml=${settingsPath}｜用户 home=${path.resolve(realHome)}｜写入=${seeded.ok === true ? `${seeded.bytes} 字节（UTF-8）` : `失败：${seeded.reason}`}`,
      );
      if (seeded.ok === true) {
        const corruptPort = await pickFreePort();
        const corruptServer = startServer({ profile: profileName, port: corruptPort, logPath: path.join(outDir, 'corrupt-server.log') });
        state.servers.push(corruptServer);
        const corruptUrl = await corruptServer.waitForUrl();
        check('corrupt-payload-start', '坏载荷态：实例起得来（独立端口，未触碰 3080）', corruptUrl.url !== null, corruptUrl.url === null ? corruptUrl.reason : `port=${corruptPort}｜url=${corruptUrl.url.replace(/token=[^&]*/g, 'token=***')}`);
        if (corruptUrl.url !== null) {
          const pass = await pagePass({ url: corruptUrl.url, tag: 'corrupt', mutation: MUTATION, waits: 20_000 });
          raw.states.corrupt = pass.raw;
          readCorruptOutcome({ raw, pass, seeded });
        }
        corruptServer.stop();
        await sleep(800);
      }
    }

    check('manual-gesture', '留人工项（本装置不代判）：拖动手感/缩放手感、观感与现有 DSH 是否一致、浮层那几项手感类判定', true, '手感与观感只能人看，本装置不代判', { manual: true });
  } finally {
    // ── 收尾：只回收自己起的进程 ────────────────────────────────────────────────────────────────
    if (state.session !== null) state.session.close();
    for (const edge of state.edges) edge.stop();
    const reclaimed = await killEdgeByMarker(edgeUserDataDir);
    // 两个 dsh 实例：**按 pid 精确回收 + 轮询端口确认释放**（旧版只 kill shell 包装进程 ⇒ 实例泄漏）
    const serverReclaim = [];
    for (const server of state.servers) {
      const row = await server.stopAndVerify();
      serverReclaim.push(row);
      state.serverPorts.push(row.port);
    }
    await sleep(600);

    const pid3080After = await listenerPid(3080);
    check('cleanup-pid-unchanged', '收尾：3080 的监听者 PID 全程不变', pid3080Before !== null && pid3080After === pid3080Before, `前=${pid3080Before}｜后=${pid3080After}`);
    const stray = await listEdgeByMarker(edgeUserDataDir);
    check('cleanup-browser', '收尾：只按自己的 user-data-dir 标记回收浏览器（绝无「杀所有 msedge」）', stray.length === 0, `回收 ${reclaimed.length} 个｜标记 ${path.basename(edgeUserDataDir)} 下残留 ${stray.length} 个${stray.length > 0 ? `：${stray.slice(0, 3).join(',')}` : ''}`);
    raw.reclaimedEdgePids = reclaimed;

    // cleanup-ports：本装置起的实例必须全部不再监听（端口逐个复核，防「杀包装进程留下真身」）
    const stillListening = [];
    for (const port of state.serverPorts) {
      if (await isPortListening(port)) stillListening.push(port);
    }
    check(
      'cleanup-ports',
      '收尾：本装置起的 dsh 实例**全部不再监听**（按 pid/端口精确回收，不按名字批量杀）',
      state.serverPorts.length > 0 && stillListening.length === 0,
      `实例端口=${JSON.stringify(state.serverPorts)}｜回收明细=${JSON.stringify(serverReclaim.map((row) => `port${row.port}:pid${row.pid}:${row.reclaimed ? '已回收' : '仍在监听'}`))}`,
    );
    raw.serverReclaim = serverReclaim;

    // ── 隔离 home 的清理：**只删我们自己造的那个**（`--dsh-home=<外部路径>` 时一个字节都不动）──────
    let homeGone = null;
    if (KEEP !== true && ownedHome === true) {
      try {
        rmSync(dshHomeDir, { recursive: true, force: true });
      } catch (error) {
        console.log(`  （未删净 ${dshHomeDir}：${error?.message ?? error}）`);
      }
      homeGone = !existsSync(dshHomeDir);
    }
    check(
      'cleanup-home',
      '收尾：本轮新建的隔离 `$DSH_HOME` 已删除（**用户真实 home 全程一个字节都没写**）',
      ownedHome === false || KEEP === true || homeGone === true,
      `本次 home=${dshHomeDir}｜自己造的=${ownedHome}｜--keep=${KEEP}｜已删=${homeGone ?? (ownedHome === false ? '（外部指定，不删）' : '（--keep，保留）')}｜用户 home=${path.resolve(realHome)}（本装置只读它，从没写过）`,
    );

    if (!KEEP) {
      for (const target of [profileDir(profileName), edgeUserDataDir, `${edgeUserDataDir}-control`, `${edgeUserDataDir}-install`, `${edgeUserDataDir}-corrupt`]) {
        try {
          rmSync(target, { recursive: true, force: true });
        } catch (error) {
          console.log(`  （未删净 ${target}：${error?.message ?? error}）`);
        }
      }
      raw.cleaned = true;
    }

    // ── 有牙对照的**范围读数 + 范围闸**：必须在**全部判据都记完**之后、算 hard 之前跑
    // （放在收尾检查之后，收尾那几条判据若判红也能被范围闸看见）。只变异轮打：常规轮打了只是噪声。
    if (MUTATION !== 'none') reportMutationScope();

    const hard = checks.filter((row) => row.ok !== true && row.manual !== true && row.expected !== true && row.notEvidence !== true);
    raw.checks = checks;
    writeFileSync(path.join(outDir, 'report.md'), renderReport({ rows: checks, mutation: MUTATION, hard, profileName, pid3080Before, pid3080After }), 'utf8');
    writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(raw, null, 2), 'utf8');
    console.log('');
    // 汇总**分开计数**：`ok === true` 的总数把「留人工」「预期」也算了进去 —— 报告里曾据此
    // 写成 pass 38，而真实的 pass 要再扣掉那两类（权威轮实为 36）。这里按「纯 pass」口径打，并给全五类数字。
    const purePass = checks.filter((row) => row.ok === true && row.manual !== true && row.expected !== true && row.notEvidence !== true).length;
    const manualCount = checks.filter((row) => row.manual === true).length;
    const expectedCount = checks.filter((row) => row.expected === true).length;
    const notEvidenceCount = checks.filter((row) => row.notEvidence === true).length;
    console.log(`── 汇总 ── 判据 ${checks.length} 条 ＝ pass ${purePass} / 留人工 ${manualCount} / 预期 ${expectedCount} / 硬失败 ${hard.length} / 未取真机证 ${notEvidenceCount}（五项之和＝判据总数）`);
    for (const row of checks.filter((item) => item.notEvidence === true)) {
      console.log(`  [未证] ${row.id} ${row.title}\n         -> ${row.reason ?? row.detail}`);
    }
    console.log(`[real-machine] 证据：${path.relative(PKG_DIR, outDir)}（report.md + raw.json + 实例/Edge 日志）`);
    if (MUTATION === 'none') {
      process.exitCode = hard.length > 0 ? 1 : 0;
    } else {
      console.log(`[real-machine] 有牙对照（mutation=${MUTATION}）：硬失败 ${hard.length} 条 ⇒ ${hard.length > 0 ? '装置有牙（预期判红）' : '没抓住（装置失效，需修）'}`);
      process.exitCode = 1;
    }
  }
}

/**
 * ── 工作台：真机取证段 ─────────────────────────────────────────────────────────────────────────────
 *
 * 六步（每步都留读数；判据在 main() 的 workbench-toggle…workbench-official-frame 里逐条消费）：
 *   ① **基线 D0**：还没点过开关，页面处于**官方布局**（侧栏展开、main 停在会话、无右栏轨）
 *   ② **真鼠标点一次** → 等状态读数变 `workbench` → **D1**（进工作台：侧栏收起 + 坞面板进中心列 + 右栏开轨）
 *   ③ **再点一次** → 等状态回 `official` → **D2**，用 `workbenchRestored(D0, D2)` **逐字段比对**
 *   ④ 再进一次工作台 → 等**去抖**（布局那条 400ms 口径 + 余量）→ 读**隔离 home 的 settings.yaml 原文**
 *      （判据要的是「字节真落盘了」，不是「界面说保存了」）
 *   ⑤ `Page.reload`（真刷新）→ 等插件把开关重新装上 → **D3**（刷新后状态保留 + 布局真的被采用）
 *   ⑥ 点回官方 → 等落盘 → **D4**（把页面交还给后面的判据：段末必须是官方布局）
 *
 * ⚠ 为什么段末必须回官方：后面的 `ensureDockPanel` / overlay-real-mouse/e 都在**官方布局**下取读数 ——
 *   若把页面留在「侧栏收起 + 坞面板占着 main + 右栏全屏」，那些判据读到的会是另一种布局，
 *   等于把本段的副作用甩给了它们。
 */