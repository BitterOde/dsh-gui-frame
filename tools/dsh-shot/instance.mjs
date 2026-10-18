// tools/dsh-shot/instance.mjs —— 由 dsh-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 实例生命周期：起实例、等 URL、停止并核对回收、收尾守卫

import { PKG_DIR } from './env.mjs';
import { isPortListening, parseStartUrl } from './probe.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function runDsh(entry, args, { timeoutMs = 180_000, cwd = PKG_DIR } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 已被回收 */
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error?.message ?? error}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 起一个长驻实例：输出直接落日志文件（不经管道），按自己的 pid 精确回收。 */
export function startInstance({ entry, profile, port, logPath, timeoutMs = 120_000 }) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [entry, '--profile', profile, '--port', String(port), '--no-open'], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
  });
  const state = { url: null, exited: false, code: null, pid: child.pid ?? null, fd };
  child.on('close', (code) => {
    state.exited = true;
    state.code = code ?? -1;
  });

  /** 轮询启动日志里的带 token URL。 */
  async function waitForUrl(deadline = Date.now() + timeoutMs) {
    while (Date.now() < deadline) {
      if (state.exited) return { url: null, reason: `实例提前退出（exit=${state.code}）` };
      let text = '';
      try {
        text = readFileSync(logPath, 'utf8');
      } catch {
        text = '';
      }
      const url = parseStartUrl(text);
      if (url !== null) {
        state.url = url;
        return { url, reason: null };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { url: null, reason: `等待启动 URL 超时（${timeoutMs}ms）` };
  }

  /** 收尾：按 pid 直杀 + 轮询端口确认释放；仍监听才用 taskkill 针对**这个 pid** 收树。 */
  async function stopAndVerify({ attempts = 12, gapMs = 250 } = {}) {
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
    let listening = await isPortListening(port);
    for (let attempt = 0; attempt < attempts && listening; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      listening = await isPortListening(port);
    }
    if (listening && state.pid !== null) {
      spawnSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      for (let attempt = 0; attempt < attempts && listening; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        listening = await isPortListening(port);
      }
    }
    try {
      closeSync(fd);
    } catch {
      /* 已关 */
    }
    state.listeningAfterStop = listening;
    return { port, pid: state.pid, listening, reclaimed: !listening };
  }

  return { child, pid: child.pid ?? null, logPath, port, state, waitForUrl, stopAndVerify };
}

/** 本次起的实例（进程级兜底钩子按它收尾；同一进程只会起一个实例）。 */
export let activeInstance = null;

/** 记录/清空「本次起的实例」。入口 `main` 与收尾守卫共用同一份状态；跨模块改它只能经本函数（ESM 的 import 绑定不可赋值）。 */
export function setActiveInstance(instance) {
  activeInstance = instance;
}

/** 进程级兜底：Ctrl+C / 异常终止时也按记录的 pid 收掉自己起的实例。 */
export function installCleanupGuard(log) {
  const cleanup = (reason) => {
    const active = activeInstance;
    if (active === null) return;
    activeInstance = null;
    log(`[dsh-shot] 收尾（${reason}）：按 pid ${active.pid} 回收自己起的实例`);
    try {
      process.kill(active.pid);
    } catch {
      /* 已退出 */
    }
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(active.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
  };
  process.once('exit', () => cleanup('进程退出'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      cleanup(signal);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

/** 用法文本（`--help` 与文件头注释同一套说法）。 */
