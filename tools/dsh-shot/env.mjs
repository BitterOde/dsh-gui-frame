// tools/dsh-shot/env.mjs —— 由 dsh-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 环境面：包目录 / 常量 / 内存硬闸 / profile 与 dsh 入口解析

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本模块在 `tools/dsh-shot/` 下 ⇒ 回上一层才是 `tools/`（与拆分前的 HERE 同义）。
export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 本包根（`tools/` 的上一层）：link 规格由它拼出来。 */
export const PKG_DIR = path.resolve(HERE, '..');
/** loader entry id 恒为 `gui-frame`（package.json 硬约束④）；装完必须**恰好一次**。 */
export const GUI_FRAME_ENTRY_ID = 'gui-frame';
/** 活体 GUI 端口：只读它的 PID 作前后对比，绝不连、绝不杀。 */
export const LIVE_GUI_PORT = 3080;
/** 临时 profile 名前缀：**只有**这个名字形状的 profile 才会被本工具删掉。 */
export const PROFILE_PREFIX = 'guifshot';
/** 只有自己建的临时 profile 才允许删除（按名字白名单，不按"--keep 没传"就删）。 */
export const OWN_PROFILE_RE = /^guifshot[0-9a-z]+$/i;
/**
 * **内存硬阈值（MB，默认 4096 = 4 GB）**：起任何进程之前先读空闲物理内存，未达标就 fail-closed。
 *
 * 由来：真机出图时，第 2 次起跑前实读 **3591 MB（低于 4096 的建议值）**，
 * 我仍然起跑了 —— 说明「写在文档里的阈值」拦不住任何东西。本项目立场：**能被机检拦住才算闸门**。
 * ⇒ 这里把它做成闸：不达标 ⇒ 非零退出、不写 PNG、不起 dsh 实例、不起浏览器。
 */
export const DEFAULT_MIN_FREE_MB = 4096;

/**
 * 判定**纯函数**：所有"能不能起进程"的语义只在这一处（便于离线负控，不用真吃内存）。
 *
 * 口径：`minFreeMb === 0` ⇒ 显式关闸（逃生口，自担风险）；读数为 null ⇒ **fail-closed**
 * （读不到内存就等于不知道机器够不够，宁可不起）；`freeMb >= minFreeMb` 才算达标（等于也算）。
 *
 * @param {{freeMb?:number|null, minFreeMb?:number}} input
 * @returns {{ok:boolean, freeMb:number|null, minFreeMb:number, exitCode?:number,
 *   unknown?:boolean, disabled?:boolean, shortfallMb?:number, headroomMb?:number, message:string}}
 */
export function evaluateMemoryGate(input = {}) {
  const freeMb = Number.isFinite(input.freeMb) ? input.freeMb : null;
  const minFreeMb = Number.isFinite(input.minFreeMb) ? input.minFreeMb : DEFAULT_MIN_FREE_MB;
  if (minFreeMb === 0) {
    return {
      ok: true,
      disabled: true,
      freeMb,
      minFreeMb,
      message: `内存闸被显式关闭（--min-free-mb 0）：实读 ${freeMb ?? '(未读到)'} MB，本次不拦（自担风险）`,
    };
  }
  if (freeMb === null) {
    return {
      ok: false,
      unknown: true,
      exitCode: 1,
      freeMb: null,
      minFreeMb,
      message: `读不到空闲物理内存 ⇒ 按 fail-closed 拒绝起进程（阈值 ${minFreeMb} MB；要强行跑请显式 --min-free-mb 0）`,
    };
  }
  if (freeMb < minFreeMb) {
    return {
      ok: false,
      exitCode: 1,
      freeMb,
      minFreeMb,
      shortfallMb: minFreeMb - freeMb,
      message:
        `空闲物理内存不足：实读 ${freeMb} MB < 阈值 ${minFreeMb} MB（差 ${minFreeMb - freeMb} MB）` +
        '⇒ fail-closed：不起任何进程、不写 PNG',
    };
  }
  return {
    ok: true,
    freeMb,
    minFreeMb,
    headroomMb: freeMb - minFreeMb,
    message: `空闲物理内存达标：实读 ${freeMb} MB ≥ 阈值 ${minFreeMb} MB（余量 ${freeMb - minFreeMb} MB）`,
  };
}

/**
 * 读**空闲物理内存**（MB）。纯只读，不改系统状态。
 *
 * Windows：`Win32_OperatingSystem.FreePhysicalMemory` —— **单位是 KB**，所以要 /1024 才是 MB；
 * 读不到（PowerShell 不可用/被拦/输出不可解析）时退回 `node:os` 的 `freemem()`；
 * 两条都拿不到 ⇒ 返回 null（由 `evaluateMemoryGate` 按 fail-closed 处置）。
 *
 * @param {{spawnSyncImpl?:Function, platform?:string}} [deps] 注入点（离线自检用假读数，不真起进程）
 */
export function readFreeMemoryMb(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const spawnSyncImpl = deps.spawnSyncImpl ?? spawnSync;
  if (platform === 'win32') {
    try {
      const result = spawnSyncImpl('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000,
      });
      const kb = Number(String(result?.stdout ?? '').trim());
      if (Number.isFinite(kb) && kb > 0) return Math.round(kb / 1024);
    } catch {
      /* 落到 os.freemem() */
    }
  }
  try {
    return Math.round(os.freemem() / (1024 * 1024));
  } catch {
    return null;
  }
}

/** `$DSH_HOME`（缺省 `~/.dsh`）。 */
export function dshHome() {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
}

/** 临时 profile 的目录（与装置同口径）。 */
export function profileDir(name) {
  return path.join(dshHome(), 'profiles', name);
}

/**
 * DSH CLI 的 node 入口。
 * `dsh` 在 Windows 上是 npm 的 `.cmd` 包装：直接 spawn 它必须走 shell，而 shell 包装会留下
 * **杀不掉的 cmd.exe 中间层**（装置实测泄漏 8 个仍在监听的实例）⇒ 这里一律解析到 `lib/bin.js`。
 */
export function dshEntry(options = {}) {
  const explicit = options.explicit ?? process.env.GUIF_DSH_BIN ?? null;
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  const candidates = [
    process.env.DSH_ROOT ? path.join(process.env.DSH_ROOT, 'lib', 'bin.js') : null,
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ].filter((candidate) => candidate !== null);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

/** 取一个空闲 TCP 端口（绑 0 号端口拿系统分配，随即释放给实例用）。 */
