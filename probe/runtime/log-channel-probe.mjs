// 探针 P2：诊断上报链路在真机前的可机检部分
//
// 要验的是两件事，必须分开验、都要有字节级观察：
//   A. ctx.logger.warn(...) 到底落在哪儿？
//      说法是「终端可见性只能靠 process.stderr.write（Cordis logger 内置 exporter 只进内存
//      buffer）」。→ 起真 cordis 根 ctx，写一条带哨兵串的 warn，然后**搜进程自己的
//      stdout/stderr**：搜不到哨兵、但内存 buffer 命中 ⇒ 该路径对终端不可见。
//   B. process.stderr.write(...) 真的出得去吗？
//      → 同一个子进程写一条哨兵到 stderr：pipe 档由父进程在 stderr 管道里抓到；
//        inherit 档直接落到本探针进程的 stderr（= 我在工具输出里肉眼可见的那一行）。
// 只读：不写 profile、不监听端口、不接触正在跑的 GUI。
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const childPath = join(here, 'log-channel-child.mjs')
const MARK_LOG = '[gui-frame] logger-marker-P2'
const MARK_ERR = '[gui-frame] 客户端失败 stderr-marker-P2'

// ── A/B pipe 档：父进程分别持有子进程 stdout 与 stderr 两条管道 ──────────────
const piped = spawnSync(process.execPath, [childPath], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PROBE_MARK_LOG: MARK_LOG, PROBE_MARK_ERR: MARK_ERR },
})

const findings = {
  pipe: {
    exitCode: piped.status,
    childStdout: piped.stdout,
    childStderr: piped.stderr,
    loggerMarkerOnStdout: piped.stdout.includes(MARK_LOG),
    loggerMarkerOnStderr: piped.stderr.includes(MARK_LOG),
    stderrMarkerOnStderr: piped.stderr.includes(MARK_ERR),
    stderrMarkerOnStdout: piped.stdout.includes(MARK_ERR),
  },
}

// ── B inherit 档：让子进程 stderr 直接继承本进程，观察者即终端 ───────────────
const inherited = spawnSync(process.execPath, [childPath], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PROBE_MARK_LOG: MARK_LOG, PROBE_MARK_ERR: MARK_ERR },
})
findings.inherit = { exitCode: inherited.status, note: '子进程 stderr 直落本探针进程 stderr，见本次命令输出里的哨兵行' }

const assertions = {
  'A1 子进程 logger 写的哨兵没出现在 stdout': findings.pipe.loggerMarkerOnStdout === false,
  'A2 子进程 logger 写的哨兵没出现在 stderr': findings.pipe.loggerMarkerOnStderr === false,
  'A3 默认配置下 logger.error 进内存 buffer': findings.pipe.childStdout.includes('"errorHitsBuffer":true'),
  'A4 默认配置下 logger.warn 连内存 buffer 都进不去': findings.pipe.childStdout.includes('"warnHitsBuffer":false'),
  'A5 默认配置下 logger.debug 连内存 buffer 都进不去': findings.pipe.childStdout.includes('"debugHitsBuffer":false'),
  'B1 process.stderr.write 的哨兵出现在 stderr 管道': findings.pipe.stderrMarkerOnStderr === true,
  'B2 该哨兵不串到 stdout': findings.pipe.stderrMarkerOnStdout === false,
}

const evidencePath = join(here, '..', 'evidence', 'p2-q17-chain.json')
mkdirSync(dirname(evidencePath), { recursive: true })
writeFileSync(evidencePath, `${JSON.stringify({ markers: { MARK_LOG, MARK_ERR }, findings, assertions }, null, 2)}\n`, 'utf8')

console.log(`P2 完成，证据：${evidencePath}`)
for (const [key, ok] of Object.entries(assertions)) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${key}`)
console.log(`  子进程 stdout 转录：${JSON.stringify(findings.pipe.childStdout.trim())}`)
console.log(`  子进程 stderr 转录：${JSON.stringify(findings.pipe.childStderr.trim())}`)
console.log(`  inherit 档（下面这行由子进程直写 stderr，若你看到它，说明 stderr 写真的到了终端）`)
if (Object.values(assertions).some((ok) => !ok)) process.exitCode = 1
