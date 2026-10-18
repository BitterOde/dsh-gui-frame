/**
 * service.mjs —— `ctx.gui-frame` **服务面冻结** ＋ **提供入口** `provideService(ctx)`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【装配契约 v1】—— 能力模块并行开发时的**唯一**接口真相
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ① **装配函数签名统一为 `install(ctx, env)`**（单一 options bag，日后加面不改签名）：
 *    - `env.service` = `ctx.gui-frame` 的服务面实例（本文件 `provideService` 的产物）；
 *    - `env.seeds`   = 种子实例表（键：`react` / `jsxRuntime` / `reactDom` / `cordis` / `store` /
 *      `primitives` / `slots` / `dockkit`），由 `entry.mjs` 把 `createClientModule(seeds)` 收到的
 *      `seeds` **原样转交**；
 *    - 签名归属：`dock / overlay / window / layout / channel(客户端) → install(ctx, env)`；
 *      `routes.mjs`（宿主半区）→ `registerRoutes(ctx)`。
 *    - **`env` 只增不改不删**：要加第 3 个面只能**追加键**（向后兼容）；改名/删键 = 契约破坏。
 *      当前刻意**只有** `service` 与 `seeds` 两项 —— 诊断上报走同级模块 import，
 *      不进 bag（避免把「谁依赖谁」写死在装配面上）。
 *
 * ② **install 内部的副作用一律经 `ctx.effect(...)` 注册**（不要自己管生命周期）：
 *    官方 `dsh-client-ui-renderer` 的 `registry.d.ts` 原文点明「cordis 服务代理在**调用点**把
 *    `this.ctx` 绑到**调用方** ctx，箭头函数属性会把 `this` 冻在服务自己的 root ctx 上、
 *    静默破坏按插件卸载」——装配阶段的副作用同理必须挂在调用方 fiber 上。
 *
 * ③ **没有 JSX（最容易踩）**：自研打包器只重写 import/export，**不做 JSX / TS 变换**。
 *    所有组件必须用 `env.seeds.react.createElement(...)` 构造；写 JSX 会在构建期以
 *    「产物语法错（`new Function` 解析失败）」的形式失败，**报错信息不会明说是 JSX**。
 *
 * ④ **模块不得 import 裸包名**（构建期即拦）；种子只能经 `env.seeds` 取用。
 *
 * ⑤ 能力分片：本文件给出 `service.__install(切片名, api)`（内部分片点，`__` 前缀**不进公开面快照**）。
 *    切片白名单＝`SLICE_NAMES`（`channel / dock / overlay / theme`）。切片方法的**第一个参数恒为调用方 ctx**，
 *    例如 `overlay.open(ctx, request)`、`channel.call(ctx, method, params)`、`dock.onEntry(ctx, change)`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【对外方法必须是原型方法】（硬约束，判据不是风格而是机制）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `register / supports / channel` 是原型**方法**；`components / layout / overlay` 是原型**取值器**
 * —— 取值器同样走「调用点绑定」：`ctx.guiFrame.overlay` 在访问时读的是**调用方** ctx，
 * 于是 `overlay.open()` 里注册的 effect 落在调用方 fiber 上。若把命名空间在构造器里
 * `this.overlay = { open() {...} }`，那个 `open` 拿到的 `this.ctx` 是服务自己的 root ctx，
 * 就会出现「插件卸载了，它开的窗口还在」这类静默泄漏 —— `tests/unit/service.test.mjs` 用
 * `Object.create(service)` 模拟官方代理，专门盯这条（改成实例箭头函数即变红）。
 *
 * 本文件**零副作用**：不注册座位、不订阅事件、不碰 window/document；只有 `provideService`
 * 被 `entry.mjs` 调用时才产生它自己那一条 `ctx.effect`（未装本包时页面完全不受影响）。
 */
import { createError, formatDiagnostic } from './contracts/errors.mjs';
import { SERVICE_NAME } from './contracts/service-face.mjs';

import { GuiFrameService as _GuiFrameService } from './service/core.mjs';
import { describeError, describeValue, logTo, noop } from './service/text.mjs';

/** 服务面实例（**类定义已搬 `service/core.mjs`**；本行是原路径的同一入口，行为一字未改）。 */
export const GuiFrameService = _GuiFrameService;

/**
 * **提供入口**（补上「谁在哪儿把服务装上」这个汇合点缺口）：
 * 由 `src/client/entry.mjs` 在 `apply` 里调用。
 *
 * 语义：
 *  - 先 `ctx.get('gui-frame')` **探测**；已存在 ⇒ 记 `GUIF-W-SERVICE-CONFLICT` 诊断并**主动让位**
 *    （同 scope 重名 `provide` 会直接 throw ⇒ 整页死，绝不复现）；
 *  - 形态用官方最简写法 `ctx.effect(() => ctx.provide(name, service))`（theme 同款）；
 *  - 卸载（fiber 卸载或调用返回的 `dispose()`）⇒ 服务自动注销 + `__shutdown()` 收尾。
 *
 * @param {object} ctx
 * @returns {{service:object|null, owned:boolean, reason:string|null, dispose:() => void}}
 *   `owned=false` ⇒ 没轮到你提供（已存在/提供失败）：`service` 是既有实例或 `null`，
 *   `dispose()` 是空操作（**不要动别人的服务**）。
 */
export function provideService(ctx) {
  if (ctx === null || typeof ctx !== 'object') {
    throw createError('GUIF-E-CTX-INVALID', `provideService(ctx) 需要一个 Cordis ctx（收到 ${describeValue(ctx)}）`, null);
  }
  const existing = typeof ctx.get === 'function' ? ctx.get(SERVICE_NAME) : undefined;
  if (existing !== undefined) {
    const message = `服务 ${SERVICE_NAME} 已存在 ⇒ 主动让位（不重复 provide：同 scope 重名会 throw，等于整页死）`;
    logTo(ctx, 'warn', formatDiagnostic({ code: 'GUIF-W-SERVICE-CONFLICT', message }));
    return { service: existing, owned: false, reason: 'conflict', dispose: noop };
  }
  const service = new GuiFrameService(ctx);
  try {
    const dispose = service.__effect(ctx, `gui-frame: provide ${SERVICE_NAME}`, () => {
      const unprovide = ctx.provide(SERVICE_NAME, service);
      return () => {
        service.__shutdown();
        if (typeof unprovide === 'function') unprovide();
      };
    });
    return { service, owned: true, reason: null, dispose };
  } catch (error) {
    const message = `提供 ${SERVICE_NAME} 失败（已让位，页面照常起）：${describeError(error)}`;
    logTo(ctx, 'error', formatDiagnostic({ code: 'GUIF-W-SERVICE-CONFLICT', message }));
    return { service: null, owned: false, reason: 'provide-failed', dispose: noop };
  }
}


