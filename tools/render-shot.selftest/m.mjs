// tools/render-shot.selftest/m.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// M 组：内存硬闸（纯函数 / 可注入 / 端到端注入式 / CLI 级负控 / 静态顺序）

import { assert, check, checkAsync } from './kit.mjs';
import { makePng, sandbox } from './fixtures.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_MIN_FREE_MB, createDeps, evaluateMemoryGate, main as dshShotMain, readFreeMemoryMb, startInstance as shotStartInstance } from '../dsh-shot.mjs';
import { SHOT_SOURCE_FILE, shotSourceCode } from './scan.mjs';

export async function runM() {
function fakeShotDeps({ calls, freeMb }) {
  return {
    log: (line) => calls.push({ kind: 'log', line }),
    err: (line) => calls.push({ kind: 'err', line }),
    stdout: (text) => calls.push({ kind: 'stdout', text }),
    readFreeMemoryMb: () => freeMb,
    dshEntry: () => 'C:/fake/dsh/lib/bin.js',
    runDsh: async (_entry, args) => {
      calls.push({ kind: 'runDsh', args: args.join(' ') });
      if (args.includes('--from-default-profile')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('add')) return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: `- id: ${'gui-frame'}\n`, stderr: '' };
    },
    pickFreePort: async () => {
      calls.push({ kind: 'pickFreePort' });
      return 45678;
    },
    startInstance: ({ port, logPath }) => {
      calls.push({ kind: 'startInstance', port, logPath });
      return {
        pid: 4242,
        port,
        logPath,
        waitForUrl: async () => {
          calls.push({ kind: 'waitForUrl' });
          return { url: 'http://127.0.0.1:45678/?token=fake', reason: null };
        },
        stopAndVerify: async () => {
          calls.push({ kind: 'stopAndVerify' });
          return { port, pid: 4242, listening: false, reclaimed: true };
        },
      };
    },
    renderShot: async (shotOptions) => {
      calls.push({ kind: 'renderShot', out: shotOptions.out, selector: shotOptions.selector, click: shotOptions.click });
      writeFileSync(shotOptions.out, makePng(120, 80)); // 假的"出图"：只证明流程走到了这一步
      return { out: shotOptions.out, bytes: 96, size: { width: 120, height: 80 }, clip: null, clicks: [], waitedMs: 3 };
    },
    listenerPid: async () => {
      calls.push({ kind: 'listenerPid' });
      return 24020;
    },
    existsSync: () => false, // 临时 profile 不存在 ⇒ 不需要 --reuse
    rmSync: () => {
      calls.push({ kind: 'rmSync' });
    },
    installCleanupGuard: () => {
      calls.push({ kind: 'installCleanupGuard' });
    },
    now: () => new Date('2026-10-03T13:00:00.000Z'),
  };
}
check('M1 evaluateMemoryGate 是纯函数：达标 / 未达 / 读不到 / 显式关闸 四种输入各有确定结论', () => {
  const low = evaluateMemoryGate({ freeMb: 3591, minFreeMb: 4096 });
  assert(low.ok === false && low.exitCode === 1, `3591 < 4096 应判不通过，实得 ${JSON.stringify(low)}`);
  assert(low.message.includes('3591') && low.message.includes('4096'), '报错必须同时给出**实读值**与**阈值**');
  assert(low.message.includes('fail-closed'), '必须点名 fail-closed');
  assert(low.shortfallMb === 505, `应给出差额 505 MB，实得 ${low.shortfallMb}`);
  const high = evaluateMemoryGate({ freeMb: 4564, minFreeMb: 4096 });
  assert(high.ok === true && high.headroomMb === 468, `4564 ≥ 4096 应放行，实得 ${JSON.stringify(high)}`);
  assert(high.message.includes('4564') && high.message.includes('4096'), '达标也要把两个数打印出来');
  assert(evaluateMemoryGate({ freeMb: 4096, minFreeMb: 4096 }).ok === true, '边界：等于阈值算达标');
  const unknown = evaluateMemoryGate({ freeMb: null, minFreeMb: 4096 });
  assert(unknown.ok === false && unknown.unknown === true && unknown.exitCode === 1, '读不到内存必须 fail-closed（不知道够不够就别起）');
  const off = evaluateMemoryGate({ freeMb: 3591, minFreeMb: 0 });
  assert(off.ok === true && off.disabled === true, '`--min-free-mb 0` 是**显式**关闸（逃生口，自担风险）');
  assert(evaluateMemoryGate({}).minFreeMb === DEFAULT_MIN_FREE_MB, `默认阈值应为 ${DEFAULT_MIN_FREE_MB}`);
});
check('M2 读数与接线可注入：Win32 的 KB 换算、默认接线是真实现、overrides 生效', () => {
  // Win32_OperatingSystem.FreePhysicalMemory 的单位是 KB ⇒ 必须 /1024
  const mb = readFreeMemoryMb({ platform: 'win32', spawnSyncImpl: () => ({ stdout: '4194304\n' }) });
  assert(mb === 4096, `4194304 KB 应换算成 4096 MB，实得 ${mb}`);
  const garbage = readFreeMemoryMb({ platform: 'win32', spawnSyncImpl: () => ({ stdout: 'not-a-number' }) });
  assert(garbage === null || Number.isFinite(garbage), `读数不可解析时应退回 os.freemem()，实得 ${garbage}`);
  const d = createDeps();
  assert(d.startInstance === shotStartInstance, 'createDeps() 默认必须接真 startInstance（注入面不许把真实现换掉）');
  assert(d.readFreeMemoryMb === readFreeMemoryMb, 'createDeps() 默认必须接真读数函数');
  assert(typeof d.runDsh === 'function' && typeof d.renderShot === 'function' && typeof d.listenerPid === 'function', '默认 dep 表要齐');
  const injected = createDeps({ readFreeMemoryMb: () => 1234 });
  assert(injected.readFreeMemoryMb() === 1234, 'overrides 必须生效');
  assert(createDeps().readFreeMemoryMb !== injected.readFreeMemoryMb, '注入不该污染默认表');
  assert(shotSourceCode.includes('Win32_OperatingSystem'), 'Windows 读数必须走 Win32_OperatingSystem.FreePhysicalMemory');
});
await checkAsync('M3 端到端（注入式）：内存未达标 ⇒ 非零退出、**无 PNG**、**零子步骤**（没建 profile / 没起实例 / 没起浏览器）', async () => {
  const calls = [];
  const outPath = path.join(sandbox, 'gated-blocked.png');
  const code = await dshShotMain(
    ['--out', outPath, '--click', '[data-guif-glyph*=dock]', '--min-free-mb', '4096', '--json'],
    fakeShotDeps({ calls, freeMb: 3591 }),
  );
  assert(code === 1, `未达标应 exit 1，实得 ${code}`);
  assert(!existsSync(outPath), `未达标却写了 PNG：${outPath}`);
  const sideEffects = calls.filter((call) => !['log', 'err', 'stdout'].includes(call.kind));
  assert(sideEffects.length === 0, `未达标仍有子步骤被调用（闸没拦住）：${JSON.stringify(sideEffects)}`);
  const text = calls
    .filter((call) => call.kind === 'log' || call.kind === 'err')
    .map((call) => call.line)
    .join('\n');
  assert(text.includes('3591') && text.includes('4096'), '必须打印实读值与阈值');
  assert(text.includes('内存闸'), '必须有一行点名"内存闸"');
});
await checkAsync('M4 端到端（注入式）：内存达标 ⇒ 一路走到出图、产物在场、收尾回收（成功路径不受影响）', async () => {
  const calls = [];
  const stdoutLines = [];
  const outPath = path.join(sandbox, 'gated-ok.png');
  const deps = fakeShotDeps({ calls, freeMb: 4564 });
  deps.stdout = (text) => {
    stdoutLines.push(text);
    calls.push({ kind: 'stdout', text });
  };
  const code = await dshShotMain(
    ['--out', outPath, '--click', '[data-guif-glyph*=dock]', '--wait-for', '[data-guif-dock-actions]', '--selector', '[data-guif-panel]', '--json'],
    deps,
  );
  assert(code === 0, `达标应 exit 0，实得 ${code}：${JSON.stringify(calls.filter((call) => call.kind === 'err'))}`);
  const order = calls
    .filter((call) => ['runDsh', 'pickFreePort', 'startInstance', 'renderShot', 'stopAndVerify', 'rmSync'].includes(call.kind))
    .map((call) => call.kind);
  assert(
    order.join(',') === 'runDsh,runDsh,runDsh,pickFreePort,startInstance,renderShot,stopAndVerify,rmSync',
    `步骤顺序/次数不对：${order.join(',')}`,
  );
  assert(existsSync(outPath) && statSync(outPath).size > 0, `达标路径应产出 PNG：${outPath}`);
  const payload = JSON.parse(stdoutLines.join(''));
  assert(payload.ok === true, `--json 的 ok 应为 true：${JSON.stringify(payload)}`);
  assert(payload.memory.freeMb === 4564 && payload.memory.minFreeMb === 4096, `JSON 里的内存读数不对：${JSON.stringify(payload.memory)}`);
  assert(payload.steps.some((step) => step.step === 'render-shot'), 'JSON 应记录出图那一步');
});
check('M5 CLI 级负控：真 CLI + 阈值调到天上 ⇒ 非零退出、无 PNG、且**没走到任何起进程的步骤**', () => {
  const never = path.join(sandbox, 'cli-never.png');
  const result = spawnSync(process.execPath, [SHOT_SOURCE_FILE, '--out', never, '--click', '[data-guif-glyph*=dock]', '--min-free-mb', '100000000'], { encoding: 'utf8' });
  assert(result.status !== 0, `应非零退出，实得 ${result.status}`);
  assert(!existsSync(never), '闸未过却写了 PNG');
  const stderr = result.stderr ?? '';
  assert(!stderr.includes('② 建 profile'), '闸未过却去建 profile 了');
  assert(!stderr.includes('基线：3080'), '闸未过却读了 3080 基线 ⇒ 说明闸不在最前（那一步要 spawn PowerShell）');
  assert(stderr.includes('内存闸'), 'stderr 必须打印内存闸那一行');
  assert(/不足|读不到/.test(stderr), 'stderr 必须说清是"不足"还是"读不到"');
});
check('M6 CLI 级：`--min-free-mb 0` 显式关闸后 dry-run 照常可用（逃生口有据，且不起进程）', () => {
  const result = spawnSync(
    process.execPath,
    [SHOT_SOURCE_FILE, '--dry-run', '--json', '--min-free-mb', '0', '--out', 'x.png', '--click', '[data-guif-glyph*=dock]'],
    { encoding: 'utf8' },
  );
  assert(result.status === 0, `dry-run 应 exit 0，实得 ${result.status}：${(result.stderr ?? '').slice(0, 160)}`);
  const payload = JSON.parse(result.stdout);
  assert(payload.memory.disabled === true && payload.memory.ok === true, `dry-run 应播报"闸已关"：${JSON.stringify(payload.memory)}`);
  assert(payload.plan.steps[0].includes('内存硬闸'), `计划第 1 步应是内存闸：${payload.plan.steps[0]}`);
});
check('M7 静态：内存闸在 main 里**先于**任何起进程的调用（比读 3080 基线还早）', () => {
  const gateAt = shotSourceCode.indexOf('d.readFreeMemoryMb');
  const baselineAt = shotSourceCode.indexOf('d.listenerPid(LIVE_GUI_PORT)');
  const profileAt = shotSourceCode.indexOf("'--from-default-profile'");
  assert(gateAt > 0, '没找到内存闸调用（判据本身失效）');
  assert(baselineAt > 0 && gateAt < baselineAt, '内存闸必须在读 3080 基线之前');
  assert(profileAt > 0 && gateAt < profileAt, '内存闸必须在建 profile 之前');
  assert(shotSourceCode.includes('fail-closed'), '源码里要点名 fail-closed（口径可检索）');
});

// ── G. 真机截图（可选；默认 SKIP 且不计入 PASS）────────────────────────────────
}
