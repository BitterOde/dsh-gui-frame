/**
 * entry.mjs —— 客户端半区**汇合点**：把四项能力的 `install(ctx, env)` 按固定顺序装起来
 * （交付面＝坞 + 主题 + 面板 + 浮层：按钮面板本身走托管浮层 `family:'panel'`，故浮层属于面板族）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【装配契约 v1】—— 各能力模块只导出装配函数，**本文件是唯一的调用者**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 1. **签名统一为 `install(ctx, env)`**（单一 options bag，日后加面不改签名）；
 *    `env` 的键集（**只增不改不删**，由本文件组装）：
 *      - `service`     = `ctx.gui-frame` 服务面实例（`provideService(ctx)` 的产物）；
 *      - `seeds`       = 种子实例表（`createClientModule(seeds)` 收到的**原样**转交；模块不能 import 裸包名）；
 *      - `schedule` / `cancel` = 定时器端口（平台服务晚到时的补装轮询用；真机是全局 `setTimeout`，测试可注入假时钟）；
 *      - `diagnostics` = 诊断上报器（**全流程唯一实例**：各能力报同一条通道，避免每条通道各限各的频）。
 * 2. **固定装配顺序**（顺序即契约，测试逐项比对 `CAPABILITY_ORDER`）：
 *    `provideService → dock → theme → panel → overlay → 驱动恢复屏障`。
 *    依赖链见 `CAPABILITY_ORDER` 上方注释；**恢复屏障在所有 install 之后驱动，不得跳过**。
 *    宿主半区同理：`src/host/index.mjs` 只调用 `routes.mjs` 的 `registerRoutes(ctx)`（含它的
 *    `extraRoutes` 扩展点去挂诊断收端），**不自行实现路由**。
 * 3. **副作用一律经 `ctx.effect`**（各模块内部纪律；本文件只负责按序调用与兜错）。
 * 4. **包在这里的三条硬纪律**（都有实测出处，不是风格偏好）：
 *    - `apply` **整体 try/catch 且绝不 rethrow**：探针实测「客户端 apply 抛错 ⇒ `loader.create` 拒绝
 *      冒泡 ⇒ 就绪回调永不执行 ⇒ 整页停在失败卡片」；
 *    - **每个 install 单独 try/catch**：单个能力失败不牵连其余能力，也不牵连整页；
 *    - **装配前先探测** `ctx.get('gui-frame')`：已存在就记诊断并**让位**（同 scope 重名 `provide` 会 throw）。
 * 5. **重挂载幂等**（实测：服务方卸载后回归会触发依赖方自动重新 `apply`）：同一 ctx 二次装配直接
 *    跳过（`ASSEMBLED`），各能力自身的 `install` 也都是幂等的（第二层保险）。
 *
 * 本文件**不内联任何能力实现、不注册任何座位**：座位一律由坞成对注册。
 * 打包器约定（scripts/build-client.mjs）：必须导出 `createClientModule(__seeds)` → `{ apply, inject, __internals }`。
 */

import { SERVICE_NAME } from './contracts/service-face.mjs';
import { createDiagnosticsReporter, degradeEvent, installDiagnosticsHooks } from './diagnostics.mjs';
import { install as installDock } from './dock.mjs';
import { install as installPanel } from './panel/index.mjs';
import { install as installOverlay } from './overlay/index.mjs';
import { provideService } from './service.mjs';
import { probeService } from './kit/probe.mjs';
import { install as installTheme } from './theme/index.mjs';
// 平台服务晚到 ⇒ 在窗口内补装一次（实现见 `entry/after-services-v1.mjs`）。
import { createAfterServices } from './entry/after-services-v1.mjs';

/**
 * **固定装配顺序**（顺序本身就是契约，测试会逐项比对）。
 * 依赖链（为什么是这个序）：
 *   `dock` 最早 —— 它注册坞自己的入口与两个座位，并给出 dock 切片；
 *   `theme` 紧随 —— 面板族的样式与公开变量都由它提供；
 *   `panel` 在 `overlay` 前 —— 面板把复合组件登记进服务面组件表，坞与浮层在**渲染期**取用；
 *   `overlay` 最后 —— 按钮面板本身走它的托管浮层（`family:'panel'`）。
 */
export const CAPABILITY_ORDER = Object.freeze([
  { capability: 'dock', install: installDock },
  { capability: 'theme', install: installTheme },
  { capability: 'panel', install: installPanel },
  { capability: 'overlay', install: installOverlay },
]);

/** 同一 ctx 只装配一次（重挂载幂等的第一层；各能力自身的幂等是第二层）。 */
const ASSEMBLED = new WeakSet();

/**
 * **平台服务晚到的补装窗口**（真机实测：兄弟插件提供的 `slots` / `settingsScope` 晚于本插件 `apply`
 * 就绪，实测 ~3s 内到齐）。第一遍照常装（缺服务 ⇒ 降级/不激活），窗口内服务出现则**补装一次**；
 * 超时后不再重试，保持第一遍的降级结论。
 */
export const SERVICES_READY_TIMEOUT_MS = 4000;
export const SERVICES_READY_INTERVAL_MS = 250;

/** 哪些能力依赖哪个平台服务（用于补装判定；不需要平台服务的能力不进这张表）。 */
export const CAPABILITY_SERVICE_DEPENDENCY = Object.freeze({
  dock: 'slots',
  overlay: 'slots',
});

/** 缺省定时器端口（平台服务晚到时的补装轮询用；可注入假时钟）。 */
function defaultSchedule(fn, delay) {
  return setTimeout(fn, delay);
}

function defaultCancel(handle) {
  clearTimeout(handle);
}

/**
 * 组装入口模块。
 * @param {object} seeds 种子实例表（8 个全名 require 进来的实例；**原样**转交各能力）
 */
export function createClientModule(seeds) {
  const name = 'gui-frame';
  const reporter = createDiagnosticsReporter({});
  let lastAssembly = null;

  /** 记一条到 console（**吞掉一切**：诊断自己不许把装配搞崩）。 */
  function consoleError(line) {
    try {
      if (typeof console !== 'undefined' && console !== null && typeof console.error === 'function') console.error(line);
    } catch {
      // 没有 console 就算了 —— 这条不是能力的一部分
    }
  }

  /** 上报（同步、绝不抛）。 */
  function report(entry) {
    try {
      reporter.report(entry);
    } catch {
      // 诊断失败不影响装配
    }
  }

  /**
   * 真正的装配（同步返回装配记录；`apply` 是它「绝不抛」的外壳）。
   * @param {object} ctx 调用方 ctx
   * @param {{schedule?:Function, cancel?:Function, diagnostics?:object}} [options]
   */
  function assemble(ctx, options = {}) {
    if (ctx === null || typeof ctx !== 'object') return { owned: false, reason: 'no-ctx', capabilities: [] };
    if (ASSEMBLED.has(ctx)) return { owned: false, reason: 'already-assembled', capabilities: [] };

    // ① 探测：已存在 ⇒ 记诊断并让位（**不重复 provide**：同 scope 重名会 throw ⇒ 整页死）
    const existing = typeof ctx.get === 'function' ? ctx.get(SERVICE_NAME) : undefined;
    if (existing !== undefined) {
      const entry = degradeEvent('service', `服务 ${SERVICE_NAME} 已在场 ⇒ 本插件让位（不重复 provide）`, reporter);
      consoleError(`[gui-frame] ${entry.message}`);
      return { owned: false, reason: 'conflict', service: existing, capabilities: [] };
    }

    // ② 提供：形态用官方最简写法（`ctx.effect(() => ctx.provide(...))`，见 service.mjs）
    const provided = provideService(ctx);
    if (provided.owned !== true || provided.service === null) {
      const entry = degradeEvent('service', `提供 ${SERVICE_NAME} 失败或让位：${provided.reason ?? 'unknown'}`, reporter);
      consoleError(`[gui-frame] ${entry.message}`);
      return { owned: false, reason: provided.reason ?? 'provide-failed', capabilities: [] };
    }
    const service = provided.service;

    // ③ env：**只增不改不删**（本文件是唯一组装点）
    const env = {
      service,
      seeds,
      schedule: typeof options.schedule === 'function' ? options.schedule : defaultSchedule,
      cancel: typeof options.cancel === 'function' ? options.cancel : defaultCancel,
      diagnostics: options.diagnostics ?? reporter,
    };

    // ④ 诊断钩子（座位注册失败 / 渲染崩溃 / 未处理拒绝）—— **早于各 install**，才能看见它们的失败
    try {
      installDiagnosticsHooks(ctx, env.diagnostics);
    } catch (error) {
      report(degradeEvent('diagnostics', `诊断钩子装配失败：${error?.message ?? error}`, env.diagnostics));
    }

    // ⑤ 按固定顺序装配：**每个 install 单独 try/catch**
    const capabilities = [];
    const handles = new Map();
    const rowOf = (capability) => capabilities.find((item) => item.capability === capability);
    const runStep = (step) => {
      try {
        // **追加键只允许出现在调用点**（`{...env, layoutHandle}`），`env` 本体一字不改。
        // demo 是消费者：布局句柄是装配点交给它的端口，不是它自己装出来的能力。
        const outcome = step.install(ctx, env);
        handles.set(step.capability, outcome);
        const installed = outcome === null || outcome === undefined ? null : outcome.installed !== false;
        const row = rowOf(step.capability);
        if (row === undefined) capabilities.push({ capability: step.capability, installed, reason: outcome?.reason ?? null });
        else {
          row.installed = installed;
          row.reason = outcome?.reason ?? null;
        }
        if (installed === false) {
          const entry = degradeEvent(step.capability, outcome?.reason ?? 'unknown', env.diagnostics);
          consoleError(`[gui-frame] ${entry.message}`);
        }
        return outcome;
      } catch (error) {
        const row = rowOf(step.capability);
        if (row === undefined) capabilities.push({ capability: step.capability, installed: false, reason: 'install-threw' });
        else {
          row.installed = false;
          row.reason = 'install-threw';
        }
        report({ phase: 'install', message: `能力「${step.capability}」装配抛错：${error?.message ?? error}`, error, details: { capability: step.capability } });
        consoleError(`[gui-frame] 能力「${step.capability}」装配抛错（已隔离，继续装其余能力）：${error?.message ?? error}`);
        return null;
      }
    };
    for (const step of CAPABILITY_ORDER) runStep(step);

    // ⑤b **平台服务补装**（只此一件事：坞等 `slots` 到齐再补装一次，
    //    实现见 `./entry/after-services-v1.mjs`）
    const { retryDone, restore } = createAfterServices({
      ctx, env, handles, runStep, probeService, report, degradeEvent, reporter,
      CAPABILITY_ORDER, CAPABILITY_SERVICE_DEPENDENCY, SERVICES_READY_TIMEOUT_MS, SERVICES_READY_INTERVAL_MS,
    });

    ASSEMBLED.add(ctx);
    lastAssembly = { ctx, service, env, capabilities, restore, release: provided.dispose };
    return { owned: true, reason: null, service, env, capabilities, restore, dispose: provided.dispose };
  }

  /** 平台入口：**同步、绝不抛**（抛出去会让平台就绪回调永不执行）。 */
  function apply(ctx) {
    try {
      assemble(ctx);
    } catch (error) {
      report({ phase: 'apply', message: `apply 抛错（已吞，页面照常）：${error?.message ?? error}`, error });
      consoleError(`[gui-frame] 客户端 apply 失败（已吞，页面照常）：${error?.message ?? error}`);
    }
    return undefined;
  }

  return {
    apply,
    inject: [],
    __internals: {
      name,
      stage: 'stage1',
      seeds: Object.keys(Object(seeds)).sort(),
      capabilityOrder: CAPABILITY_ORDER.map((step) => step.capability),
      diagnostics: reporter,
      /** 最近一次装配记录（诊断与测试的观察口；不参与平台协议）。 */
      lastAssembly: () => lastAssembly,
      /** 供测试直接驱动装配（能拿到 `restore` promise 以便 `await`）。 */
      assemble,
    },
  };
}
