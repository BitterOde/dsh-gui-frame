// 探针 P1：客户端 apply 抛错是否真打死整页
//
// 方法：把外壳 boot kernel（index-BKQ_L1z6.js [553610,555926)）逐字转写后，
// 用**真平台库**（本机 DSH 安装里的 cordis 4.0.2 + cordis-plugin-loader 1.0.3）
// 跑三种入口组合，观察 boot kernel 自己走到哪一步：
//   S1 必抛的 apply（外壳原样）           → 看 create 拒绝 / page.fail / 是否 mountApp
//   S2 必抛的 apply（改动版：吞掉 create 拒绝）→ 看 assertEntriesActive 单独能否发现
//   S3 inject 未满足（声明了而服务不存在）  → 看是 pending 还是别的
// 不监听端口、不写 profile、不接触正在跑的 GUI。
import { loadPlatform } from './platform.mjs'
import { createShellBoot, createModuleTable, FIBER_STATE_NAMES } from './shell-boot.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const platform = await loadPlatform()
const results = []

const uiRendererRow = {
  name: '@probe/ui-renderer',
  apply(ctx) {
    ctx.provide('uiRenderer', { mount: () => {} })
  },
}
const okRow = {
  name: '@probe/ok',
  apply() {
    globalThis.__probeOkApplied = (globalThis.__probeOkApplied ?? 0) + 1
  },
}
const boomRow = {
  name: '@probe/boom',
  apply() {
    throw new Error('probe: apply threw on purpose')
  },
}
const needsFrameRow = {
  name: '@probe/needs-frame',
  inject: ['gui-frame'],
  apply() {
    globalThis.__probeNeedsFrameApplied = (globalThis.__probeNeedsFrameApplied ?? 0) + 1
  },
}

function snapshot(loader) {
  // 注意：Loader#entries() 是 generator（loader lib L170），必须展开成数组再 map；
  // 直接 .map() 会命中 V8 的惰性 Iterator Helper，结果永远不被消费（JSON 为 {}）。
  return [...loader.entries()].map((entry) => ({
    id: entry.options.name,
    fiberState: entry.fiber === undefined ? 'no-fiber(import failed)' : FIBER_STATE_NAMES[entry.fiber.state],
  }))
}

// ── S1：外壳原样（Promise.all 里的 loader.create 不捕获） ──────────────────
{
  const events = []
  const rows = {
    '@probe/ui-renderer': uiRendererRow,
    '@probe/ok': okRow,
    '@probe/boom': boomRow,
  }
  const shell = createShellBoot({
    Context: platform.Context,
    Loader: platform.Loader,
    modules: createModuleTable(rows),
    recorder: (event, ...args) => events.push([event, ...args.map(String)]),
  })
  await shell.run()
  results.push({
    scenario: 'S1 外壳原样：一个 apply 抛错',
    appMounted: shell.appMounted,
    pageFailure: shell.page.failure,
    pageStates: Object.fromEntries(shell.page.states),
    events,
    entriesAfterBoot: snapshot(shell.ctx.loader),
    okAppliedCount: globalThis.__probeOkApplied ?? 0,
  })
  await shell.dispose().catch(() => {})
}

// ── S2：改动版（把 create 的拒绝吞掉后继续，只为观察 assertEntriesActive 单独的作用） ──
{
  const rows = {
    '@probe/ui-renderer': uiRendererRow,
    '@probe/boom': boomRow,
  }
  const ctx = new platform.Context()
  await ctx.plugin(platform.Loader)
  ctx.loader.internal = createModuleTable(rows)
  let createError = null
  let auditError = null
  try {
    const entryId = await ctx.loader.create({ name: '@probe/boom' })
    void entryId
  } catch (error) {
    createError = { name: error?.name, message: error?.message }
  }
  const entriesAfterCreate = snapshot(ctx.loader)
  const shell = createShellBoot({
    Context: platform.Context,
    Loader: platform.Loader,
    modules: createModuleTable(rows),
  })
  try {
    shell.assertEntriesActive(ctx)
  } catch (error) {
    auditError = error.message
  }
  results.push({
    scenario: 'S2 改动版：吞掉 create 拒绝后再单独跑 assertEntriesActive',
    createError,
    entriesAfterCreate,
    auditError,
    note: '壳内原样不会走到这一步：create 拒绝先冒泡出 run()',
  })
  await ctx.fiber.dispose()
}

// ── S3：inject 未满足（声明 inject 而服务不存在） ─────────────────────────
{
  const events = []
  const rows = {
    '@probe/ui-renderer': uiRendererRow,
    '@probe/needs-frame': needsFrameRow,
  }
  const shell = createShellBoot({
    Context: platform.Context,
    Loader: platform.Loader,
    modules: createModuleTable(rows),
    recorder: (event, ...args) => events.push([event, ...args.map(String)]),
  })
  await shell.run()
  results.push({
    scenario: 'S3 inject 未满足：声明 inject: ["gui-frame"] 而无人提供',
    appMounted: shell.appMounted,
    pageFailure: shell.page.failure,
    pageStates: Object.fromEntries(shell.page.states),
    entriesAfterBoot: snapshot(shell.ctx.loader),
    needsFrameAppliedCount: globalThis.__probeNeedsFrameApplied ?? 0,
  })
  await shell.dispose().catch(() => {})
}

const evidencePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'p1-apply-throw.json')
mkdirSync(dirname(evidencePath), { recursive: true })
writeFileSync(
  evidencePath,
  `${JSON.stringify({ platform: { dshVersion: platform.dshVersion, cordis: platform.cordisVersion, install: '<dsh-install>' }, results }, null, 2)}\n`,
  'utf8',
)
console.log(`P1 完成，证据：${evidencePath}`)
for (const row of results) {
  console.log(`- ${row.scenario}`)
  console.log(`    appMounted=${String(row.appMounted)} pageFailure=${JSON.stringify(row.pageFailure ?? row.auditError ?? null)}`)
  if (row.entriesAfterBoot) console.log(`    entries=${JSON.stringify(row.entriesAfterBoot)}`)
  if (row.entriesAfterCreate) console.log(`    entriesAfterCreate=${JSON.stringify(row.entriesAfterCreate)}`)
  if (row.createError) console.log(`    createError=${JSON.stringify(row.createError)}`)
}
