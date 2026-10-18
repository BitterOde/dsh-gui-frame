// 外壳 boot kernel 的**逐字转写**（只换掉浏览器侧的不可用依赖，不改控制流）。
//
// ── 转写来源（DSH 0.2.0-rc.2 外壳产物，字符偏移为 UTF-16 code unit 下标）────────
// 文件：<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js
//   [625688, 626751)  JS/eM —— boot kernel：run / dispose / mountApp /
//                              prefetchImmediateTier / runPluginBoot / assertEntriesActive
//   [626751, 628166)  yn/tM —— 启动遮罩：setTotal / setState / fail / render
// 转写时逐字保留：`internal/status` 事件名、状态表、错误文案、
// `await loader.await()` 与 `assertEntriesActive(ctx)` 的调用顺序。
// 唯一替换的浏览器依赖（每处都标了原句）：
//   · `new $e`（cordis 根 Context）        → 注入的 Context 构造器
//   · `await t.plugin(Ba)`（Loader 插件）  → 注入的 Loader（真 cordis-plugin-loader）
//   · `r.create({boot,staticModules})`     → 注入的模块表（镜像 ClientModuleSystem 的
//                                            import/prefetch/manifest 契约）
//   · `document.getElementById('root')`/DOM 渲染 → recorder 记录
//   · `uiRenderer` 服务                    → 记录式桩（原句保留：ctx.inject + effect）
//   · `console.error(t)`                   → recorder + 真 console（两者都留证）
export const FIBER_STATE_NAMES = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: 'disposed',
  5: 'unloading',
} // 原文 K5（由 In 常量表映射）

/** 启动遮罩（原 jy）。只保留探针可观测的部分：状态表、失败文案。 */
export class BootOverlay {
  constructor(recorder) {
    this.states = new Map()
    this.active = new Set()
    this.total = 0
    this.failure = undefined
    this.recorder = recorder
  }
  setTotal(total) {
    this.total = total
    this.recorder('page.setTotal', total)
  }
  setState(name, state) {
    this.states.set(name, state)
    if (state === 'active') this.active.add(name)
    this.recorder('page.setState', name, state)
  }
  fail(message) {
    this.failure = message
    this.recorder('page.fail', message)
  }
  dispose() {
    this.recorder('page.dispose')
  }
}

/**
 * 建立 boot kernel 实例。
 * @param {object} options
 * @param {Function} options.Context - 真 cordis 根 Context 构造器
 * @param {Function} options.Loader - 真 cordis-plugin-loader 的 Loader
 * @param {object} options.modules - 模块表（镜像 ClientModuleSystem 的对外契约）
 * @param {(event: string, ...args: unknown[]) => void} [options.recorder]
 */
export function createShellBoot({ Context, Loader, modules, recorder = () => {} }) {
  const page = new BootOverlay(recorder)
  const shell = {
    page,
    appMounted: false,
    ctx: undefined,
    manifest: undefined,
    modules,
    /** 原 My#run */
    async run() {
      try {
        // 原句：await globalThis.__DSH_BOOT_READY__?.promise（探针环境无该全局，可选链短路）
        // 原句：const r=t.__ModuleLoader__; if(r===void 0) throw new Error("web boot: window.__ModuleLoader__ bootstrap facade is missing")
        const facade = modules // 探针中模块表即 __ModuleLoader__ 的等价物
        if (facade === undefined) throw new Error('web boot: window.__ModuleLoader__ bootstrap facade is missing')
        // 原句：this.modules=r.create({boot:t.__DSH_BOOT__,staticModules:by(),...})
        this.modules = modules
        this.manifest = this.modules.manifest
        // 原句：const s=this.prefetchImmediateTier()
        const prefetch = this.prefetchImmediateTier()
        // 原句：const a=new $e; this.ctx=a
        const ctx = new Context()
        this.ctx = ctx
        await this.runPluginBoot(ctx, prefetch)
        await this.mountApp(ctx)
      } catch (error) {
        // 原句：console.error(t), this.page.fail(t instanceof Error?t.message:String(t))
        recorder('console.error', error instanceof Error ? (error.stack ?? error.message) : String(error))
        console.error(error)
        this.page.fail(error instanceof Error ? error.message : String(error))
      }
    },
    /** 原 My#mountApp：await t.inject(["uiRenderer"], r=>{r.effect(()=>r.uiRenderer.mount(container), "web boot: application mount")}) */
    async mountApp(ctx) {
      await ctx.inject(['uiRenderer'], (ui) => {
        ui.effect(() => ui.uiRenderer.mount({ id: 'root' }), 'web boot: application mount')
        this.appMounted = true
        recorder('app.mounted')
      })
    },
    /** 原 My#prefetchImmediateTier：只预取 manifest.plugins 里 immediately 的行，失败吞掉 */
    async prefetchImmediateTier() {
      await Promise.all(
        this.manifest.plugins
          .filter((row) => row.immediately)
          .map((row) => this.modules.prefetch(row.id).catch(() => {})),
      )
    },
    /** 原 My#runPluginBoot —— 逐句对应 */
    async runPluginBoot(ctx, prefetch) {
      // 原句：await t.plugin(Ba)   ← Ba 即 cordis-plugin-loader 的 Loader 插件
      await ctx.plugin(Loader)
      const loader = ctx.loader
      // 原句：i.internal=this.modules
      loader.internal = this.modules
      // 原句：t.on("internal/status",a=>{const c=a.entry; c===void 0||c.fiber===void 0||this.page.setState(c.options.name,K5[c.fiber.state])})
      ctx.on('internal/status', (fiber) => {
        const entry = fiber.entry
        if (entry === undefined || entry.fiber === undefined) return
        this.page.setState(entry.options.name, FIBER_STATE_NAMES[entry.fiber.state])
      })
      // 原句：const s=this.manifest.plugins.map(a=>a.id); this.page.setTotal(s.length)
      const ids = this.manifest.plugins.map((row) => row.id)
      this.page.setTotal(ids.length)
      await prefetch
      // 原句：await Promise.all(s.map(async a=>{this.page.setState(a,"loading"); const c=await i.create({name:a}); i.resolve(c).fiber===void 0&&this.page.setState(a,"failed")}))
      await Promise.all(
        ids.map(async (id) => {
          this.page.setState(id, 'loading')
          const entryId = await loader.create({ name: id })
          if (loader.resolve(entryId).fiber === undefined) this.page.setState(id, 'failed')
        }),
      )
      // 原句：await i.await()
      await loader.await()
      this.assertEntriesActive(ctx)
    },
    /** 原 My#assertEntriesActive —— 文案与判定逐字保留 */
    assertEntriesActive(ctx) {
      const failed = []
      for (const entry of ctx.loader.entries()) {
        const name = entry.options.name
        if (entry.fiber === undefined) {
          failed.push(`${name}: import failed (see console for the import error)`)
          continue
        }
        const state = FIBER_STATE_NAMES[entry.fiber.state]
        if (state !== 'active') {
          if (state === 'pending') {
            const missing = Object.keys(entry.fiber.inject).filter((key) => ctx.get(key) === undefined)
            failed.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
          } else failed.push(`${name}: ${state}`)
        }
      }
      if (failed.length > 0) {
        throw new Error(`web boot: ${String(failed.length)} entr${failed.length === 1 ? 'y' : 'ies'} did not activate\n${failed.join('\n')}`)
      }
    },
    /** 原 My#dispose */
    async dispose() {
      const ctx = this.ctx
      this.ctx = undefined
      if (ctx !== undefined) await ctx.fiber.dispose()
      this.page.dispose()
    },
  }
  return shell
}

/**
 * 模块表：镜像 ClientModuleSystem 的对外契约
 * （<dsh>/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js L184-337 的
 *  `manifest` / `import` / `prefetch`，以及 P1 里外壳真正用到的三个成员）。
 * @param {Record<string, object>} rows - id → 插件模块导出（含 name/inject/apply）
 */
export function createModuleTable(rows) {
  const plugins = Object.keys(rows).map((id) => ({ id, inject: rows[id]?.inject ?? [], immediately: false }))
  return {
    manifest: { rev: 'probe', entries: [], batches: [], plugins },
    async import(specifier) {
      if (!(specifier in rows)) {
        throw new Error(`client-modules: cannot resolve "${specifier}" — not a seed word, not a materialized module, and not a row in the boot graph (the runtime mirror of the bundle purity gate)`)
      }
      return rows[specifier]
    },
    async prefetch(id) {
      if (!(id in rows)) throw new Error(`client-modules: prefetch("${id}") — not a graph entry`)
    },
  }
}

// 注：外壳里的 uiRenderer 服务由 `@deepseek-ai/dsh-client-ui-renderer` 这条 boot 行提供，
// 探针照同一架构用一条模块表行提供它（不额外注入桩），见 p1/p2/p3 的 rows。
