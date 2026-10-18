/**
 * lib/dsh.mjs —— 真机验收装置 · **DSH profile 与进程**这一半。
 *
 * 纪律（写进 README，别只放在代码里）：
 *   - 本目录是**全仓唯一允许起进程的验证资产**；跑它之前必须取得一次明确同意；
 *   - 只用**自己新建的临时 profile**（从出厂模板建），**绝不写 `web`**，**绝不碰 127.0.0.1:3080**；
 *   - 收尾只回收自己起的进程（按 profile 名 / 专属 `--user-data-dir` 标记），**绝不**「杀所有 node/msedge」。
 *
 * 父进程（run.mjs）通过 `stdio: ['ignore', logFd, logFd]` 起子进程：所有输出直接进日志文件，
 * 不经管道（Windows 上管道捕获子进程输出有沙箱/句柄风险）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** `$DSH_HOME`（缺省 `~/.dsh`）。 */
export function dshHome() {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
}

export function profileDir(name) {
  return path.join(dshHome(), 'profiles', name);
}

export function profileExists(name) {
  return existsSync(profileDir(name));
}

/** 跑一条 dsh 子命令并把 stdout/stderr 收进字符串（短命令用；长驻进程用 startServer）。 */
export function runDsh(args, { timeoutMs = 120_000, cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    // 与 startServer 同一条纪律：优先 `node <dsh bin.js>`（**shell:false**）。
    // 走 shell 有两个坏处：多一层 cmd.exe 包装（`spawn(shell:true)` 传参数组还会触发 DEP0190），
    // 且杀掉包装进程带不走真正的 node —— 本装置早期就是这样实测泄漏出 8 个仍在 LISTEN 的实例。
    const entry = dshEntry();
    const child = entry === null
      ? spawn('dsh', args, { cwd, shell: true, windowsHide: true })
      : spawn(process.execPath, [entry, ...args], { cwd, shell: false, windowsHide: true });
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

/** 从**出厂模板**建一个新 profile（不启动）：`dsh --profile <name> --from-default-profile web --dump-config`。 */
export async function createProfileFromTemplate(name) {
  const result = await runDsh(['--profile', name, '--from-default-profile', 'web', '--dump-config']);
  return { ...result, config: result.stdout };
}

/** `dsh --profile <name> --dump-config`：打印组合后的 profile 树（只读）。 */
export async function dumpConfig(name) {
  const result = await runDsh(['--profile', name, '--dump-config']);
  return { ...result, config: result.stdout };
}

/** 数 `- id: <entryId>` 的出现次数（duplicate loader entry id 会直接起不来）。 */
export function countLoaderEntry(config, entryId) {
  const pattern = new RegExp(`^\\s*-\\s*id:\\s*${entryId}\\s*$`, 'gm');
  return (config.match(pattern) ?? []).length;
}

/** `dsh plugin --profile <name> add <spec>`（转发给 profile 目录里的 pnpm）。 */
export function addPlugin(name, spec) {
  return runDsh(['plugin', '--profile', name, 'add', spec], { timeoutMs: 300_000 });
}

/** 取一个空闲 TCP 端口。 */
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** 解析 DSH CLI 的 node 入口（`dsh` 是 npm 的 .cmd 包装，直接跑会留下回收不掉的孙进程）。 */
export function dshEntry() {
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 端口此刻是否在监听（TCP 连接探测，不依赖 PowerShell）。 */
export function isPortListening(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => {
      try {
        socket.destroy();
      } catch {
        /* 已关 */
      }
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/**
 * 起一个真机实例（长驻）。输出直接落日志文件（不经管道）。
 *
 * ⚠ 必须用 `node <dsh 的 bin.js>` 直接起（**shell:false**）：
 *   `spawn('dsh', …, { shell: true })` 在 Windows 上产生的是 cmd.exe 包装进程，
 *   杀它不会带走真正在跑的 node（实测泄漏 8 个实例都在 LISTEN）。
 * @returns {{child:object, pid:number, logPath:string, port:number, state:object, waitForUrl:Function, stop:Function}}
 */
export function startServer({ profile, port, logPath, timeoutMs = 90_000 }) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'a');
  const entry = dshEntry();
  const args = ['--profile', profile, '--port', String(port), '--no-open'];
  const child = entry === null
    ? spawn('dsh', args, { shell: true, windowsHide: true, stdio: ['ignore', fd, fd] })
    : spawn(process.execPath, [entry, ...args], { shell: false, windowsHide: true, stdio: ['ignore', fd, fd] });
  const state = { url: null, exited: false, code: null, pid: child.pid ?? null, fd };
  child.on('close', (code) => {
    state.exited = true;
    state.code = code ?? -1;
  });

  /** 轮询启动日志里的带 token URL（裸请求 `/` 是 401，属正常）。 */
  async function waitForUrl(deadline = Date.now() + timeoutMs) {
    while (Date.now() < deadline) {
      if (state.exited) return { url: null, reason: `实例提前退出（exit=${state.code}）` };
      let text = '';
      try {
        text = readFileSync(logPath, 'utf8');
      } catch {
        text = '';
      }
      const match = text.match(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"'`]*token=[^\s"'`&]+/);
      if (match !== null) {
        state.url = match[0];
        return { url: match[0], reason: null };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { url: null, reason: `等待启动 URL 超时（${timeoutMs}ms）` };
  }

  /**
   * 收尾：**精确回收本实例**（pid 直杀 + 轮询端口确认已不再监听）。
   * 只动自己的 pid，绝不按进程名批量杀；端口释放失败才用 taskkill 针对**这个 pid** 收树。
   */
  async function stopAndVerify({ attempts = 12, gapMs = 250 } = {}) {
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
    let listening = await isPortListening(port);
    for (let attempt = 0; attempt < attempts && listening; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      if (state.pid !== null) {
        try {
          process.kill(state.pid, 0);
        } catch {
          /* 进程已退出 */
        }
      }
      listening = await isPortListening(port);
    }
    if (listening && state.pid !== null) {
      spawn('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
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

  function stop() {
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
    try {
      closeSync(fd);
    } catch {
      /* 已关 */
    }
    return state;
  }

  return { child, pid: child.pid ?? null, logPath, port, state, waitForUrl, stop, stopAndVerify };
}

/** 进程是否还在跑（按 pid）。 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 读某端口的监听者 PID（用来证明 3080 的进程全程没变）。 */
export async function listenerPid(port) {
  return new Promise((resolve) => {
    const script = `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`;
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('close', () => resolve(Number(out.trim()) || null));
    child.on('error', () => resolve(null));
  });
}
