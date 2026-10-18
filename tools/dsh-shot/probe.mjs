// tools/dsh-shot/probe.mjs —— 由 dsh-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 真机探测：空闲端口 / 端口监听 / 监听者 PID / loader 条目 / 启动 URL / token 脱敏

import { spawn } from 'node:child_process';
import net from 'node:net';

export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('拿不到空闲端口'))));
    });
  });
}

/** 端口此刻是否在监听（TCP 探测；不依赖 PowerShell）。 */
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

/** 读某端口的监听者 PID（只用于"3080 前后没变"的取证）。 */
export function listenerPid(port) {
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

/** 数 `- id: <entryId>` 的行数（duplicate loader entry id 会让 DSH 直接起不来）。 */
export function countLoaderEntry(config, entryId) {
  const pattern = new RegExp(`^\\s*-\\s*id:\\s*${entryId}\\s*$`, 'gm');
  return (config.match(pattern) ?? []).length;
}

/** 从实例启动日志里抠出**带 token 的启动 URL**（裸请求 `/` 是 401，属正常）。 */
export function parseStartUrl(text) {
  const match = String(text).match(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"'`]*token=[^\s"'`&]+/);
  return match === null ? null : match[0];
}

/** 打日志时把 token 抹掉（token 是凭据，不进证据）。 */
export function maskToken(url) {
  return String(url).replace(/token=[^&\s]*/g, 'token=***');
}

/**
 * 一条 dsh 子命令（短命令：stdout/stderr 收进字符串）。
 * 与实例进程同一条纪律：优先 `node <bin.js>`，**shell:false**。
 */
