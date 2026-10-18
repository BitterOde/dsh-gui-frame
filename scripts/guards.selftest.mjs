#!/usr/bin/env node
/**
 * guards.selftest.mjs —— 两道防线的**自检**（离线、有界、自带清理；不跑全量测试、不吃内存）。
 *
 * 覆盖两组判据：
 *  A. **产物原子写**（`scripts/lib/atomic-write.mjs` + 两个构建脚本的接入）
 *     A1 真 fs 端到端：目标内容被换成新内容，目录里**不留** `.tmp-*` 残留，记账顺序 = write-temp → rename
 *     A2 记录型 fs 替身：调用序列必须是 `mkdir → writeFile(<目标>.tmp-<pid>) → rename(tmp → 目标)`，
 *        且**没有任何一次 writeFile 的目标是产物路径本身**（这才是「不再原地重写」的机检判据）
 *     A3 负控：rename 覆盖失败（EPERM）⇒ 走 `.bak` 退化三步，目标最终是新内容且备份被清掉
 *     A4 负控：写临时文件失败 ⇒ 错误上抛、**目标保持旧内容**、临时文件被清掉
 *     A5 静态闸：两个构建脚本（剥注释后）不得再出现对产物路径的 `writeFile(...)` 原形
 *  B. **门禁入口三道闸**（`scripts/run-tests.mjs`）
 *     B1 `--plan` 原样打印：`--test-timeout`、`--max-old-space-size` 在 argv 里；父进程 NODE_OPTIONS 标为「已剥离」
 *     B2 毒丸对照（证明「标记文件没出现」是有意义的）：带 `NODE_OPTIONS=--require poison.cjs` 直接起 node ⇒ 标记出现
 *     B3 **超时闸有牙**：临时目录里的挂死夹具被显式超时**杀掉**（有界耗时 + 非零退出码），
 *        且这次运行里 `NODE_OPTIONS` **没有被继承**（标记文件只记到 wrapper 自己那一条 pid）
 *     B4 堆上限真的传到了**跑测试的那个 per-file 子进程**：同一夹具在 `--heap-mb 512` 与 `2048` 下的
 *        `v8.getHeapStatistics().heap_size_limit` 跟着变（不跑任何吃内存的夹具）
 *     B5 **裸跑口径**：**绕开本仓入口**直接 `node --test --test-isolation=process` 跑两个极小夹具 ⇒
 *        per-file 子进程 `process.env.NODE_OPTIONS` 为空，且 `execArgv` **逐项等于 Node 自己序列化的 24 项默认值**
 *        （与实测摘录同形同序；唯 `--tls-cipher-list` 取值按**前缀**匹配，
 *        因为原文把取值截断成 `TLS_AES_…`）。⇒ 钉死「**裸跑默认无超时**」（`--test-timeout=0`）与
 *        「那套参数不是谁注入的」这两条防回归事实 —— 该结论现在**每次门禁自检都重取一次**。
 *        **负控**：把同一断言改成「必须含**显式**的 `--test-timeout=<非 0 值>`」，在裸跑下必须**判红**，
 *        以此证明 B5 不是恒真（B3 另证该谓词在入口路径上**能**为真：那里传的是 `--test-timeout=2000`）。
 *
 * 用法：node scripts/guards.selftest.mjs
 * 退出码：0 = 全 PASS；1 = 有 FAIL。夹具全部落在系统临时目录，`finally` 里删干净。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFileAtomic } from './lib/atomic-write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const RUN_TESTS = path.join(HERE, 'run-tests.mjs');

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok: Boolean(ok), detail: String(detail ?? '') });
  console.log(`[guards] ${ok ? 'PASS' : 'FAIL'} ${id} ${detail ?? ''}`.trimEnd());
};

/** 记录型 fs 替身（内存态；可注入 rename/writeFile 的失败行为）。 */
function createRecordingFs(options = {}) {
  const calls = [];
  const files = new Map(options.initial ?? []);
  let renameCount = 0;
  return {
    calls,
    files,
    async mkdir(dir) {
      calls.push({ op: 'mkdir', dir });
    },
    async writeFile(file, text) {
      if (options.failWrite === true) {
        const error = new Error('磁盘写失败（自检注入）');
        error.code = 'ENOSPC';
        throw error;
      }
      calls.push({ op: 'writeFile', file, bytes: Buffer.byteLength(String(text), 'utf8') });
      files.set(file, String(text));
    },
    async rename(from, to) {
      renameCount += 1;
      calls.push({ op: 'rename', from, to, nth: renameCount });
      if (options.failFirstRename === true && renameCount === 1) {
        const error = new Error('句柄被占（自检注入）');
        error.code = 'EPERM';
        throw error;
      }
      if (!files.has(from)) {
        const error = new Error(`ENOENT: ${from}`);
        error.code = 'ENOENT';
        throw error;
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    async rm(file) {
      calls.push({ op: 'rm', file });
      files.delete(file);
    },
  };
}

/** 剥注释（静态闸用：注释里出现同名串不算代码）。 */
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * **实测原样摘录的那套参数** —— 判据 B5 的对照基准，**同形同序**逐项比对。
 *
 * ⚠ 是 **24 项**，不是 23 项：原报告标题写「23 个」是数错了（摘录本身 24 项；实测
 *   `process.execArgv.length === 24`）。此处保留更正后的口径。
 * ⚠ 第 7 项在原文里被截断成 `TLS_AES_…` ⇒ 比对时**带 `…` 的项按前缀匹配**（见 `sameShapeInOrder`）。
 * ⚠ 这是 **Node 测试运行器自己的默认值序列化**（`--test-isolation=process` 下 per-file 子进程），
 *   不是谁注入的：B5 就是拿「父环境已把 NODE_OPTIONS 摘掉」的裸跑去证它照样出现。
 *   Node 升级若改了这套序列化 ⇒ B5 会**响**（那时按新实测重贴这份基准，不要放宽比对）。
 */
const REPORTED_CHILD_ARGV = Object.freeze([
  '--use-largepages=off',
  '--trace-event-file-pattern=node_trace.${rotation}.log',
  '--v8-pool-size=4',
  '--node-snapshot',
  '--cpu-prof-interval=1000',
  '--report-signal=SIGUSR2',
  '--tls-cipher-list=TLS_AES_…',
  '--secure-heap=0',
  '--secure-heap-min=2',
  '--stack-trace-limit=10',
  '--test-isolation=process',
  '--network-family-autoselection-attempt-timeout=250',
  '--experimental-addon-modules',
  '--heapsnapshot-near-heap-limit=0',
  '--heap-prof-interval=524288',
  '--max-http-header-size=16384',
  '--test-concurrency=0',
  '--test-timeout=0',
  '--test-coverage-branches=0',
  '--test-coverage-functions=0',
  '--test-coverage-lines=0',
  '--watch-kill-signal=SIGTERM',
  '--inspect-port=127.0.0.1:9229',
  '--inspect-publish-uid=stderr,http',
]);

/** 逐项比对（长度、顺序、取值；带 `…` 的期望项按前缀匹配）。 */
function sameShapeInOrder(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((want, index) => (want.endsWith('…')
      ? String(actual[index]).startsWith(want.slice(0, -1))
      : String(actual[index]) === want));
}

async function partA(workspace) {
  const target = path.join(workspace, 'out', 'artifact.js');
  mkdirSync(path.dirname(target), { recursive: true });
  // A0：先把目标写成「旧产物」，后面所有负控都要看它有没有被保住
  writeFileSync(target, 'OLD', 'utf8');

  // A1 真 fs 端到端
  const steps = [];
  const result = await writeFileAtomic(target, 'NEW-CONTENT', { onStep: (step) => steps.push(step) });
  const order = steps.map((step) => step.step).join('→');
  const leftovers = readdirSync(path.dirname(target)).filter((name) => name.includes('.tmp-'));
  check(
    'A1 真 fs：内容换新 + 无 .tmp 残留 + 记账顺序 write-temp→rename',
    readFileSync(target, 'utf8') === 'NEW-CONTENT' && leftovers.length === 0 && order === 'write-temp→rename',
    `内容=${readFileSync(target, 'utf8') || '(空)'}｜残留=${leftovers.length}｜顺序=${order}｜tmp=${path.basename(result.tmp)}｜fallback=${result.fallback}`,
  );

  // A2 记录型 fs 替身：证明「不原地重写」
  const fake = createRecordingFs({ initial: [[target, 'OLD']] });
  await writeFileAtomic(target, 'NEW', { fs: fake, pid: 4242 });
  const seq = fake.calls.map((call) => call.op).join('→');
  const wroteTargetDirectly = fake.calls.some((call) => call.op === 'writeFile' && call.file === target);
  const tmpCall = fake.calls.find((call) => call.op === 'writeFile');
  const renameCall = fake.calls.find((call) => call.op === 'rename');
  const sameDir = tmpCall !== undefined && renameCall !== undefined
    && path.dirname(tmpCall.file) === path.dirname(target)
    && path.dirname(renameCall.from) === path.dirname(target);
  check(
    'A2 替身：调用序列 = mkdir→writeFile(<目标>.tmp-<pid>)→rename(tmp→目标)，且从不原地写目标',
    seq === 'mkdir→writeFile→rename' && wroteTargetDirectly === false && sameDir && fake.files.get(target) === 'NEW',
    `序列=${seq}｜直写目标=${wroteTargetDirectly}｜同目录=${sameDir}｜tmp=${path.basename(String(tmpCall?.file))}｜目标内容=${fake.files.get(target)}`,
  );

  // A3 负控：rename 覆盖失败 ⇒ .bak 退化三步
  const fallbackFs = createRecordingFs({ initial: [[target, 'OLD']], failFirstRename: true });
  const fallbackSteps = [];
  await writeFileAtomic(target, 'NEW-VIA-BAK', { fs: fallbackFs, pid: 777, onStep: (step) => fallbackSteps.push(step.step + (step.fallback === true ? '(fallback)' : '')) });
  const backupLeft = [...fallbackFs.files.keys()].filter((file) => file.includes('.bak-'));
  const tmpLeft = [...fallbackFs.files.keys()].filter((file) => file.includes('.tmp-'));
  check(
    'A3 负控：rename 被句柄占住（EPERM）⇒ 经 .bak 退化，目标仍是新内容且不留 .bak/.tmp',
    fallbackFs.files.get(target) === 'NEW-VIA-BAK' && backupLeft.length === 0 && tmpLeft.length === 0
      && fallbackSteps.includes('write-temp') && fallbackSteps.includes('rename(fallback)'),
    `步骤=${fallbackSteps.join('→')}｜目标=${fallbackFs.files.get(target)}｜.bak 残留=${backupLeft.length}｜.tmp 残留=${tmpLeft.length}`,
  );

  // A4 负控：写临时文件失败 ⇒ 目标保持旧内容、临时文件清掉、错误上抛
  const failingFs = createRecordingFs({ initial: [[target, 'OLD']], failWrite: true });
  let threw = null;
  try {
    await writeFileAtomic(target, 'SHOULD-NOT-LAND', { fs: failingFs, pid: 888 });
  } catch (error) {
    threw = error;
  }
  const removedTmp = failingFs.calls.some((call) => call.op === 'rm' && String(call.file).includes('.tmp-'));
  check(
    'A4 负控：写临时文件失败 ⇒ 上抛 + 目标保持旧内容 + 临时文件被清掉',
    threw !== null && failingFs.files.get(target) === 'OLD' && removedTmp === true,
    `抛错=${threw?.code ?? '（没抛！）'}｜目标=${failingFs.files.get(target)}｜清理临时=${removedTmp}`,
  );

  // A5 静态闸：两个构建脚本不得再原地写产物
  const banned = [
    ['build-client.mjs', /writeFile\(\s*OUT_FILE/],
    ['build-host.mjs', /writeFile\(\s*ENTRY_OUT/],
    ['build-host.mjs', /writeFile\(\s*outPath/],
  ];
  const offenders = [];
  for (const [file, pattern] of banned) {
    const code = codeOf(readFileSync(path.join(HERE, file), 'utf8'));
    if (pattern.test(code)) offenders.push(`${file} 里仍有 ${pattern}`);
  }
  const usesAtomic = ['build-client.mjs', 'build-host.mjs'].every((file) => readFileSync(path.join(HERE, file), 'utf8').includes("from './lib/atomic-write.mjs'"));
  check(
    'A5 静态闸：两个构建脚本都不再原地写产物，且都 import 原子写模块',
    offenders.length === 0 && usesAtomic === true,
    `越界=${offenders.join('；') || '无'}｜import 原子写=${usesAtomic}`,
  );
}

function partB(workspace) {
  // B1 --plan：参数原样打印 + NODE_OPTIONS 标为「已剥离」
  const planned = spawnSync(process.execPath, [RUN_TESTS, '--plan'], {
    cwd: PKG_DIR,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  const planText = `${planned.stdout ?? ''}${planned.stderr ?? ''}`;
  check(
    'B1 --plan 打印三道闸 + argv（含 --test-timeout 与 --max-old-space-size），并标注父进程 NODE_OPTIONS 已剥离',
    planned.status === 0
      && planText.includes('--test-timeout=120000')
      && planText.includes('--max-old-space-size=2048')
      && planText.includes('--require') === false
      && /【已剥离】原值=--max-old-space-size=4096/.test(planText)
      && planText.includes('闸③'),
    `exit=${planned.status}｜含 timeout=${planText.includes('--test-timeout=120000')}｜含 heap=${planText.includes('--max-old-space-size=2048')}｜标注剥离=${/【已剥离】/.test(planText)}`,
  );

  // 毒丸：`--require` 一个会写标记文件的模块（只为证明「标记没出现」有意义）
  const poison = path.join(workspace, 'poison.cjs');
  const marker = path.join(workspace, 'poison-marker.txt');
  writeFileSync(poison, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, process.pid + '\\n');\n`, 'utf8');

  // B2 阴性对照：同样带 NODE_OPTIONS 直接起 node ⇒ 标记必须出现（否则毒丸无效）
  // ⚠ NODE_OPTIONS 是按空白切分的，**不能给路径加引号**（加了引号 Node 会去找带引号的路径名）
  rmSync(marker, { force: true });
  const control = spawnSync(process.execPath, ['-e', '0'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `--require ${poison}` },
  });
  const controlMarker = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split(/\r?\n/) : [];
  check(
    'B2 毒丸对照：NODE_OPTIONS=--require poison 时标记文件出现（⇒「没出现」是可判的）',
    control.status === 0 && controlMarker.length === 1 && controlMarker[0] === String(control.pid),
    `exit=${control.status}｜标记行=${JSON.stringify(controlMarker)}｜对照 pid=${control.pid}`,
  );

  // B3 超时闸有牙：挂死夹具必须被显式超时杀掉，且 NODE_OPTIONS 不被继承
  const hangFixture = path.join(workspace, 'hang.test.mjs');
  writeFileSync(hangFixture, [
    "import test from 'node:test';",
    "test('挂死（自检夹具，永不 resolve）', async () => { await new Promise(() => {}); });",
    '',
  ].join('\n'), 'utf8');
  rmSync(marker, { force: true });
  const started = Date.now();
  const killed = spawnSync(process.execPath, [RUN_TESTS, '--pattern', hangFixture, '--timeout-ms', '2000', '--deadline-ms', '60000'], {
    cwd: PKG_DIR,
    encoding: 'utf8',
    timeout: 90000,
    env: { ...process.env, NODE_OPTIONS: `--require ${poison}` },
  });
  const elapsedMs = Date.now() - started;
  const killedText = `${killed.stdout ?? ''}${killed.stderr ?? ''}`;
  const markerAfter = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split(/\r?\n/).filter((line) => line !== '') : [];
  // wrapper 自己是被本自检用毒丸环境起的 ⇒ 它这一条 pid 必然出现；**子进程/孙进程不许再出现**（那就是继承了 NODE_OPTIONS）
  const inheritedBeyondWrapper = markerAfter.filter((line) => line !== String(killed.pid));
  check(
    'B3 超时闸有牙：挂死夹具在显式超时内被杀（非零退出 + 有界耗时），且 NODE_OPTIONS 未被继承',
    killed.status !== 0
      && elapsedMs < 60000
      && /test-timeout=2000/.test(killedText)
      && inheritedBeyondWrapper.length === 0
      && markerAfter.length === 1,
    `exit=${killed.status}｜耗时=${elapsedMs}ms｜用了显式超时=${/test-timeout=2000/.test(killedText)}｜标记 pid 行=${JSON.stringify(markerAfter)}（wrapper pid=${killed.pid}）`,
  );

  // B4 堆上限真的落到 per-file 子进程：heap_size_limit 跟着 --heap-mb 变（不吃内存）
  const probeFixture = path.join(workspace, 'heap-probe.test.mjs');
  writeFileSync(probeFixture, [
    "import test from 'node:test';",
    "import v8 from 'node:v8';",
    "test('heap cap probe', () => {",
    "  const mb = Math.round(v8.getHeapStatistics().heap_size_limit / (1024 * 1024));",
    "  process.stderr.write(`[guif-guards-probe] heapLimitMB=${mb}\\n`);",
    "});",
    '',
  ].join('\n'), 'utf8');
  const probe = (heapMb) => {
    const run = spawnSync(process.execPath, [RUN_TESTS, '--pattern', probeFixture, '--heap-mb', String(heapMb)], { cwd: PKG_DIR, encoding: 'utf8', timeout: 60000 });
    const text = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const match = /\[guif-guards-probe\] heapLimitMB=(\d+)/.exec(text);
    return { exit: run.status, mb: match === null ? null : Number(match[1]) };
  };
  const small = probe(512);
  const large = probe(2048);
  // heap_size_limit = max-old-space + 其它空间（实测本机 V8 的固定偏移约 192MB）⇒ 判据用**差值**与下限，
  // 不写死绝对窗口：差值必须等于两个 --heap-mb 之差（默认值不可能跟着命令行变），且都不小于各自的下限。
  const delta = small.mb === null || large.mb === null ? null : large.mb - small.mb;
  check(
    'B4 堆上限传到 per-file 子进程：heap_size_limit 跟着 --heap-mb 走（512 vs 2048 差 1536MB）',
    small.mb !== null && large.mb !== null
      && small.mb >= 512 && large.mb >= 2048
      && delta === 1536
      && small.exit === 0 && large.exit === 0,
    `512 ⇒ ${small.mb}MB（exit=${small.exit}）｜2048 ⇒ ${large.mb}MB（exit=${large.exit}）｜差=${delta}MB（期望 1536）`,
  );

  // ── B5 裸跑口径：**绕开本仓入口**，直接 `node --test --test-isolation=process` ────────────────────
  //   证两件事：① 那套参数是 Node 测试运行器自己的序列化（不是谁注入的）；② **裸跑默认无超时**。
  //   夹具只落一份读数（execArgv / NODE_OPTIONS / heap_size_limit），不挂死、不吃内存。
  const bareDir = path.join(workspace, 'bare');
  mkdirSync(bareDir, { recursive: true });
  const bareOut = path.join(workspace, 'bare-execargv.jsonl');
  const bareFixture = [
    "import test from 'node:test';",
    "import v8 from 'node:v8';",
    "import { appendFileSync } from 'node:fs';",
    "test('bare execArgv probe（只落读数；不吃内存、不挂死）', () => {",
    "  appendFileSync(process.env.GUIF_GUARDS_BARE_OUT, JSON.stringify({",
    "    pid: process.pid,",
    "    nodeOptions: process.env.NODE_OPTIONS ?? null,",
    "    execArgv: process.execArgv,",
    "    heapLimitMB: Math.round(v8.getHeapStatistics().heap_size_limit / (1024 * 1024)),",
    "  }) + '\\n', 'utf8');",
    "});",
    '',
  ].join('\n');
  writeFileSync(path.join(bareDir, 'a.test.mjs'), bareFixture, 'utf8');
  writeFileSync(path.join(bareDir, 'b.test.mjs'), bareFixture, 'utf8');
  // ⚠ 显式把继承来的 NODE_OPTIONS 摘掉：B5 要证的正是「**没有它**，这套参数照样出现、照样无超时」。
  const { NODE_OPTIONS: ambientNodeOptions, ...bareEnv } = process.env;
  const bare = spawnSync(process.execPath, ['--test', '--test-isolation=process', path.join(bareDir, 'a.test.mjs'), path.join(bareDir, 'b.test.mjs')], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...bareEnv, GUIF_GUARDS_BARE_OUT: bareOut },
  });
  const bareRows = existsSync(bareOut)
    ? readFileSync(bareOut, 'utf8').trim().split(/\r?\n/).filter((line) => line !== '').map((line) => JSON.parse(line))
    : [];
  const bareNoInjection = bareRows.length === 2 && bareRows.every((row) => row.nodeOptions === null);
  const bareSameShape = bareRows.length === 2 && bareRows.every((row) => sameShapeInOrder(row.execArgv, REPORTED_CHILD_ARGV));
  const bareZeroTimeout = bareRows.length === 2 && bareRows.every((row) => row.execArgv.includes('--test-timeout=0') && row.execArgv.includes('--test-isolation=process'));
  check(
    `B5 裸跑口径：子进程 NODE_OPTIONS 为空且 execArgv 逐项等于 Node 自己序列化的 ${REPORTED_CHILD_ARGV.length} 项默认值（含 --test-timeout=0）`,
    bare.status === 0 && bareNoInjection && bareSameShape && bareZeroTimeout,
    `exit=${bare.status}｜子进程数=${bareRows.length}｜NODE_OPTIONS=${JSON.stringify(bareRows.map((row) => row.nodeOptions))}｜argv 长度=${JSON.stringify(bareRows.map((row) => row.execArgv.length))}（期望 ${REPORTED_CHILD_ARGV.length}）｜同形同序=${bareSameShape}｜含 --test-timeout=0=${bareZeroTimeout}｜heapLimitMB=${JSON.stringify(bareRows.map((row) => row.heapLimitMB))}｜父环境 NODE_OPTIONS=${ambientNodeOptions ?? '(未设置)'}`,
  );

  // B5 负控：同一断言改成「必须含**显式**的 --test-timeout=<非 0 值>」⇒ 裸跑下必须判红（证明 B5 不是恒真）。
  //   （该谓词**能**为真：B3 那条路径上入口传的就是 --test-timeout=2000。）
  const demandsExplicitTimeout = (row) => /--test-timeout=(?!0(?:$|\s))\d+/.test(row.execArgv.join(' '));
  const negativeHolds = bareRows.length === 2 && bareRows.every((row) => demandsExplicitTimeout(row));
  check(
    'B5-负控：同一断言改成「必须含显式 --test-timeout=<非 0 值>」⇒ 裸跑下必须判红（否则 B5 恒真）',
    bareRows.length === 2 && negativeHolds === false,
    `裸跑各子进程的 --test-timeout=${JSON.stringify(bareRows.map((row) => row.execArgv.find((arg) => arg.startsWith('--test-timeout=')) ?? '(无)'))}｜「必须显式」成立=${negativeHolds}（期望 false）`,
  );
}

const workspace = mkdtempSync(path.join(tmpdir(), 'guif-guards-'));
try {
  console.log(`[guards] 工作目录（临时，收尾删除）：${workspace}`);
  await partA(workspace);
  partB(workspace);
} finally {
  rmSync(workspace, { recursive: true, force: true });
  const left = existsSync(workspace);
  console.log(`[guards] 清理：临时目录已删除=${left === false}`);
}

const failed = results.filter((row) => !row.ok);
console.log(`[guards] 合计：PASS ${results.length - failed.length}｜FAIL ${failed.length}${failed.length === 0 ? '' : `｜失败项：${failed.map((row) => row.id).join('、')}`}`);
console.log('[guards] 说明：本次自检**不跑全量测试、不吃内存**；超时闸的牙由「挂死夹具被显式超时杀掉」证明，堆上限由「参数落到 per-file 子进程」证明，「裸跑默认无超时 + 无 NODE_OPTIONS 注入」由 B5 证明（含负控）。');
process.exitCode = failed.length === 0 ? 0 : 1;
