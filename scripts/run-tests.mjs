#!/usr/bin/env node
/**
 * run-tests.mjs —— **门禁跑测试的唯一入口**。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 【为什么要有这个入口】一次事故里 `node --test` 的子进程涨到 **9.4 GB**，把 16 GB 整机压到 89 MB 空闲，
 * 而且**自己不会停**：环境里带着 `--test-timeout=0`（等于关掉超时）且**没有任何堆上限**。
 * 一条跑飞的测试因此能连坐整机（连开始菜单的 WebView2 都被 OOM 打崩）。
 * 结论：凡是由 DSH 代跑的重负载门禁，都该**显式**给出「超时 + 堆上限」两道闸。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 【三道闸 + 一条剥离】—— 全部**显式**，不依赖环境
 *   ① `--test-timeout=<ms>`：单条测试超时 ⇒ 挂死的测试被 runner 收尸（**绝不接受 0**：0 = 永不超时）；
 *   ② `--max-old-space-size=<mb>`：V8 堆上限 ⇒ 失控分配变成「自己 OOM 退出」，而不是吃掉整机；
 *   ③ **总时限看门狗**（wrapper 侧）：整个子进程树超过 deadline ⇒ 按 pid **连子树**收尸
 *      （Windows：`taskkill /PID <pid> /T /F`；只杀外层 shell 会留下 detached 的 node）；
 *   ④ **剥离继承来的 `NODE_OPTIONS`**：那 23 个参数就是从环境变量灌进来的（来源至今没找到），
 *      本入口在 spawn 前 `delete env.NODE_OPTIONS`，**只认自己命令行上写死的那几个参数**。
 *
 * 【打印即可复核】每次运行都原样打印最终 argv、三道闸的取值、以及父进程 NODE_OPTIONS 的有无，
 * 便于事后从日志判断「这一次到底带没带闸」。
 *
 * 用法：
 *   node scripts/run-tests.mjs                       # 门禁全量（= npm test）
 *   node scripts/run-tests.mjs --pattern "tests/unit/**\/*.test.mjs"
 *   node scripts/run-tests.mjs --timeout-ms 120000 --heap-mb 2048 --deadline-ms 600000
 *   node scripts/run-tests.mjs --plan                # 只打印将执行的 argv/闸值，不跑（自检用）
 * 环境变量（同样显式，缺省值见上）：`GUIF_TEST_TIMEOUT_MS` / `GUIF_TEST_HEAP_MB` / `GUIF_TEST_DEADLINE_MS`
 * 退出码：0 = 全绿；子进程的退出码原样透传；看门狗收尸 = 124；参数/环境不合法 = 2。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');

/** 缺省闸值（显式常量，改这里就是改门禁；不从环境读默认）。 */
export const DEFAULTS = Object.freeze({
  pattern: ['tests/**/*.test.mjs'],
  timeoutMs: 120000, // 单条测试 2 分钟（全量整跑约 35s，单文件最慢约 5s ⇒ 余量充足）
  heapMb: 2048, // V8 老生代上限 2 GB（事故里是 9.4 GB 无上限）
  deadlineMs: 600000, // 整体看门狗 10 分钟
});

const USAGE = '用法：node scripts/run-tests.mjs [--pattern <glob>]… [--timeout-ms <ms>] [--heap-mb <mb>] [--deadline-ms <ms>] [--plan]';

/** 正整数解析（不合法 ⇒ null，由调用方报用法错误）。 */
function posInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 解析命令行 + 环境（命令行优先）。返回 `{config}` 或 `{error}`。 */
export function parseArgs(argv, env = process.env) {
  const config = {
    pattern: [],
    timeoutMs: posInt(env.GUIF_TEST_TIMEOUT_MS) ?? DEFAULTS.timeoutMs,
    heapMb: posInt(env.GUIF_TEST_HEAP_MB) ?? DEFAULTS.heapMb,
    deadlineMs: posInt(env.GUIF_TEST_DEADLINE_MS) ?? DEFAULTS.deadlineMs,
    plan: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const next = argv[index + 1];
      if (next === undefined) return null;
      index += 1;
      return next;
    };
    if (arg === '--plan' || arg === '--dry-run') {
      config.plan = true;
      continue;
    }
    if (arg === '--pattern') {
      const value = take();
      if (value === null || value.trim() === '') return { error: `--pattern 需要一个非空值（${USAGE}）` };
      config.pattern.push(value);
      continue;
    }
    if (arg === '--timeout-ms' || arg === '--heap-mb' || arg === '--deadline-ms') {
      const value = take();
      const n = value === null ? null : posInt(value);
      if (n === null) return { error: `${arg} 需要一个正整数（收到 ${JSON.stringify(value)}）` };
      if (arg === '--timeout-ms') config.timeoutMs = n;
      else if (arg === '--heap-mb') config.heapMb = n;
      else config.deadlineMs = n;
      continue;
    }
    return { error: `未知参数 ${JSON.stringify(arg)}（${USAGE}）` };
  }
  if (config.pattern.length === 0) config.pattern = [...DEFAULTS.pattern];
  // 闸值下限：显式拒绝「等于没闸」的取值（0/极小值就是事故里的形状）
  if (config.timeoutMs < 1000) return { error: `单测超时必须 ≥ 1000ms（收到 ${config.timeoutMs}；0 = 永不超时，正是事故的形状）` };
  if (config.heapMb < 256) return { error: `堆上限必须 ≥ 256MB（收到 ${config.heapMb}）` };
  if (config.deadlineMs < config.timeoutMs) return { error: `总时限（${config.deadlineMs}ms）不得小于单测超时（${config.timeoutMs}ms）` };
  return { config };
}

/** 最终要执行的 argv（**唯一真源**：计划模式与真跑都读它）。 */
export function buildArgv(config, nodePath = process.execPath) {
  // V8 参数写在前面（node 允许），`--test` 与它的参数在后。
  return [
    nodePath,
    `--max-old-space-size=${config.heapMb}`,
    '--test',
    `--test-timeout=${config.timeoutMs}`,
    ...config.pattern,
  ];
}

/** 子进程环境：**剥离 NODE_OPTIONS**（并如实记录剥离前有没有）。 */
export function childEnv(env = process.env) {
  const copy = { ...env };
  const inherited = typeof copy.NODE_OPTIONS === 'string' ? copy.NODE_OPTIONS : null;
  delete copy.NODE_OPTIONS;
  return { env: copy, inherited };
}

/** 按 pid **连子树**收尸（Windows 用 taskkill /T；只杀外层会留下 detached 的 node）。 */
export function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
      spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // 收尸失败不该把 wrapper 自己带走（下面照样按超时报错退出）
  }
}

/** 三道闸的取值 + 最终 argv，原样打印（供事后复核「这一次带没带闸」）。 */
export function describe(config, env = process.env) {
  const { inherited } = childEnv(env);
  const lines = [
    '[run-tests] 门禁跑测试的唯一入口：scripts/run-tests.mjs（三道闸 + 剥离 NODE_OPTIONS）',
    `[run-tests] 父进程 NODE_OPTIONS：${inherited === null ? '（无）' : `【已剥离】原值=${inherited}`}`,
    `[run-tests] 闸① --test-timeout=${config.timeoutMs} ms（显式；0 = 永不超时是被拒的取值）`,
    `[run-tests] 闸② --max-old-space-size=${config.heapMb} MB（V8 老生代上限）`,
    `[run-tests] 闸③ 总时限看门狗 ${config.deadlineMs} ms（到点按 pid 连子树收尸：taskkill /PID <pid> /T /F）`,
    `[run-tests] 子进程环境：NODE_OPTIONS 已删除（只认命令行上的参数）`,
    `[run-tests] argv：${buildArgv(config).map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}`,
    `[run-tests] 工作目录：${PKG_DIR}`,
  ];
  return lines;
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    console.error(`[run-tests] ✗ ${parsed.error}`);
    process.exitCode = 2;
    return;
  }
  const { config } = parsed;
  const nodeMajor = Number(String(process.versions.node).split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    console.error(`[run-tests] ✗ Node ${process.versions.node} 不认识 --test-timeout（需 ≥ 22）—— 拒绝在**没有超时闸**的情况下跑门禁`);
    process.exitCode = 2;
    return;
  }
  for (const line of describe(config)) console.log(line);
  if (config.plan) {
    console.log('[run-tests] --plan：只打印不执行（未起任何子进程）');
    return;
  }

  const { env } = childEnv();
  const [exec, ...args] = buildArgv(config);
  const child = spawn(exec, args, { cwd: PKG_DIR, env, shell: false, stdio: 'inherit', windowsHide: true });

  let killedByWatchdog = false;
  const watchdog = setTimeout(() => {
    killedByWatchdog = true;
    console.error(`[run-tests] ✗ 总时限到（${config.deadlineMs} ms）⇒ 按 pid 连子树收尸（pid=${child.pid}）`);
    killTree(child.pid);
  }, config.deadlineMs);

  const code = await new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`[run-tests] ✗ 起子进程失败：${error?.message ?? error}`);
      resolve(1);
    });
    child.on('exit', (exitCode, signal) => resolve(signal === null || signal === undefined ? (exitCode ?? 1) : 1));
  });
  clearTimeout(watchdog);

  if (killedByWatchdog) {
    console.error('[run-tests] 结论：被总时限看门狗收尸（这一轮不算通过）');
    process.exitCode = 124;
    return;
  }
  console.log(`[run-tests] 子进程退出码=${code}（闸值：timeout=${config.timeoutMs}ms heap=${config.heapMb}MB deadline=${config.deadlineMs}ms）`);
  process.exitCode = code;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
