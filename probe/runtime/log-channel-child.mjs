// 探针 P2 的子进程：把同一进程里两条打印通道的落点分开观察。
//   ① ctx.logger.{error,warn}(...)   —— Cordis 内置 exporter（默认只有内存 buffer）
//   ② process.stderr.write(...)      —— 直写进程 stderr
// 用法：node log-channel-child.mjs      （父进程按 stdio: pipe / inherit 各跑一次）
// 只读：不写 profile、不监听端口、不接触正在跑的 GUI。
import { loadPlatform } from './platform.mjs'

const MARK_LOG = process.env.PROBE_MARK_LOG ?? '[gui-frame] logger-marker-P2'
const MARK_ERR = process.env.PROBE_MARK_ERR ?? '[gui-frame] 客户端失败 stderr-marker-P2'

const platform = await loadPlatform()
const ctx = new platform.Context()
const logger = ctx.logger()
ctx.logger.error(MARK_LOG)
ctx.logger.info(MARK_LOG)
ctx.logger.warn(MARK_LOG)
ctx.logger.debug(MARK_LOG)
const argsCarry = (message, needle) => (message.args ?? []).some((arg) => arg === needle)
const hit = (type) => ctx.logger.buffer.some((message) => message.type === type && argsCarry(message, MARK_LOG))
const summary = {
  exporters: ctx.logger.exporters.size,
  bufferLen: ctx.logger.buffer.length,
  bufferTypes: ctx.logger.buffer.map((message) => `${message.type}:${message.level}`),
  errorHitsBuffer: hit('error'),
  infoHitsBuffer: hit('info'),
  warnHitsBuffer: hit('warn'),
  debugHitsBuffer: hit('debug'),
  loggerLevel: logger.level ?? null,
  loggerName: logger.name,
}
// 只输出布尔与计数：marker 原文绝不落 stdout，父进程才能用「搜不到」作为证据。
process.stdout.write(`P2-CHILD ${JSON.stringify(summary)}\n`)
process.stderr.write(`${MARK_ERR}\n`)
await ctx.fiber.dispose()
