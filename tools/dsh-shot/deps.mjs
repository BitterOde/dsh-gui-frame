// tools/dsh-shot/deps.mjs —— 由 dsh-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 依赖注入表：默认全部接真实现

import { dshEntry, readFreeMemoryMb } from './env.mjs';
import { listenerPid, pickFreePort } from './probe.mjs';
import { installCleanupGuard, runDsh, startInstance } from './instance.mjs';
import { existsSync, rmSync } from 'node:fs';
import { renderShot } from '../render-shot.mjs';

export function createDeps(overrides = {}) {
  return {
    log: (line) => process.stderr.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    stdout: (text) => process.stdout.write(text),
    readFreeMemoryMb,
    dshEntry,
    runDsh,
    pickFreePort,
    startInstance,
    renderShot,
    listenerPid,
    existsSync,
    rmSync,
    installCleanupGuard,
    now: () => new Date(),
    ...overrides,
  };
}

/**
 * 编排主流程。**导出是为了离线负控**：`overrides` 可把「起进程 / 读内存 / 写输出」全部换掉，
 * 于是"未达标 ⇒ 不起任何东西"与"达标 ⇒ 一路走到出图"两条都能在**不真起实例、不真起浏览器、
 * 不真吃内存**的前提下被证明。
 *
 * @param {string[]} [argv] 不含 node 与脚本名
 * @param {object} [overrides] 见 `createDeps`
 * @returns {Promise<number>} 退出码（0 成功｜1 运行期失败/内存闸未达标｜2 用法错误）
 */
