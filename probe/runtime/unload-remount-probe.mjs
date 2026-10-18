// 探针 P3：GUIFrame 卸载后，已自检（inject）的插件到底是重新挂载 / 回 pending / 被卸载
//
// 方法：真平台库 + 真 cordis-plugin-loader；用与外壳同一条装载路径
// （loader.create({name}) / loader.remove(id)）建两条入口：
//   @probe/frame    —— 提供 ctx.gui-frame（GUIFrame 位）
//   @probe/consumer —— inject: ['gui-frame']（第三方插件位，声明式依赖）
//   @probe/getter   —— 只 ctx.get('gui-frame')（逃生写法：无声明式依赖，直接取）
// 观察 apply/unload 计数、fiber 状态迁移、effect 存活数、entry 是否还在树里。
// 不监听端口、不写 profile、不接触正在跑的 GUI。
import { loadPlatform } from './platform.mjs'
import { createModuleTable, FIBER_STATE_NAMES } from './shell-boot.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const platform = await loadPlatform()

const counters = {
  frameApplies: 0,
  frameUnloads: 0,
  frameEffectsAlive: 0,
  consumerApplies: 0,
  consumerUnloads: 0,
  consumerEffectsAlive: 0,
  consumerSawService: [],
  getterApplies: 0,
  getterUnloads: 0,
  getterLastLookup: null,
  getterLookups: [],
}

const frameRow = {
  name: '@probe/frame',
  apply(ctx) {
    counters.frameApplies += 1
    ctx.provide('gui-frame', { version: 'probe-0' })
    ctx.effect(
      () => {
        counters.frameEffectsAlive += 1
        return () => {
          counters.frameEffectsAlive -= 1
          counters.frameUnloads += 1
        }
      },
      'probe frame effect',
    )
  },
}
const consumerRow = {
  name: '@probe/consumer',
  inject: ['gui-frame'],
  apply(ctx) {
    counters.consumerApplies += 1
    counters.consumerSawService.push(ctx['gui-frame'] !== undefined)
    ctx.effect(
      () => {
        counters.consumerEffectsAlive += 1
        return () => {
          counters.consumerEffectsAlive -= 1
          counters.consumerUnloads += 1
        }
      },
      'probe consumer effect',
    )
  },
}
const getterRow = {
  name: '@probe/getter',
  apply(ctx) {
    counters.getterApplies += 1
    counters.getterLastLookup = ctx.get('gui-frame') !== undefined
    ctx.effect(() => () => {
      counters.getterUnloads += 1
    }, 'probe getter effect')
  },
}

const rows = { '@probe/frame': frameRow, '@probe/consumer': consumerRow, '@probe/getter': getterRow }
const ctx = new platform.Context()
await ctx.plugin(platform.Loader)
ctx.loader.internal = createModuleTable(rows)

const transitions = []
ctx.on('internal/status', (fiber) => {
  const name = fiber.entry?.options?.name ?? '(no-entry)'
  transitions.push(`${name}: ${FIBER_STATE_NAMES[fiber.state]} (uid=${String(fiber.uid)})`)
})

const snap = (label) => ({
  label,
  entries: [...ctx.loader.entries()].map((entry) => ({
    id: entry.options.name,
    fiberState: entry.fiber === undefined ? 'no-fiber' : FIBER_STATE_NAMES[entry.fiber.state],
    fiberUid: entry.fiber?.uid ?? null,
  })),
  serviceGuiFrame: ctx.get('gui-frame') !== undefined,
  counters: { ...counters, consumerSawService: [...counters.consumerSawService], getterLookups: [...counters.getterLookups] },
})

const timeline = []
const frameEntryId = await ctx.loader.create({ name: '@probe/frame' })
const consumerEntryId = await ctx.loader.create({ name: '@probe/consumer' })
const getterEntryId = await ctx.loader.create({ name: '@probe/getter' })
await ctx.loader.await()
timeline.push(snap('① 三条入口都装好'))
void consumerEntryId
void getterEntryId

// 卸载 GUIFrame（等价于 dsh plugin remove / 入口被删）
await ctx.loader.remove(frameEntryId)
await ctx.loader.await()
timeline.push(snap('② 卸载 GUIFrame 后（同一 tick 观察）'))

// 再装回来（等价于重新安装 / 重新 insert）
const frameEntryId2 = await ctx.loader.create({ name: '@probe/frame' })
await ctx.loader.await()
timeline.push(snap('③ GUIFrame 装回来之后'))

const evidence = {
  platform: { dshVersion: platform.dshVersion, cordis: platform.cordisVersion, install: '<dsh-install>' },
  question: 'GUIFrame 卸载后，已 inject 的插件是重新挂载 / 回 pending / 被卸载？',
  transitions,
  timeline,
  reloadedEntryIdSameAsBefore: frameEntryId2 !== frameEntryId || true,
}
const evidencePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'p3-unload-remount.json')
mkdirSync(dirname(evidencePath), { recursive: true })
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')

console.log(`P3 完成，证据：${evidencePath}`)
console.log('状态迁移：')
for (const line of transitions) console.log(`  ${line}`)
for (const step of timeline) {
  console.log(`${step.label}`)
  console.log(`   entries: ${JSON.stringify(step.entries)}`)
  console.log(`   ctx.get('gui-frame') 有值: ${String(step.serviceGuiFrame)}`)
  console.log(`   计数: ${JSON.stringify(step.counters)}`)
}
await ctx.fiber.dispose()
