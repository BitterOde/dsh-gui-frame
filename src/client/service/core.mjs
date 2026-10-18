/**
 * core.mjs —— **`ctx.gui-frame` 服务面实例**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 * 哪些没变（都是判据盯着的机制，不是风格）：
 *   · `register / supports` 是**原型方法**，`components / dock / overlay` 是**原型取值器**（v1.0 交付面＝坞 + 面板服务，面板走托管浮层）
 *     —— 取值器同样走「调用点绑定」，`ctx.guiFrame.overlay` 在访问时读**调用方** ctx，于是
 *     `dock.open()` 里注册的 effect 落在调用方 fiber 上（`tests/verify-surface/service-lifecycle.test.mjs`
 *     用 `Object.create(service)` 模拟官方代理盯这条）；
 *   · 实例自有数据字段**不得与原型成员同名**（`this.__entries = …` 曾把 `__entries()` 方法盖掉）；
 *   · `__install` 的切片白名单＝`SLICE_NAMES`；`__effect` 一律挂在**调用方** fiber；
 *   · 本文件**零副作用**：不注册座位、不订阅事件、不碰 window/document。
 *
 * 依赖方向：`service/**` 是装配层（L3），可依赖任何域；本件依赖词汇叶 `contracts/**`、共享叶 `kit/**`
 * 与同域拆件 `entries.mjs` / `text.mjs`。
 */
import { createError, formatDiagnostic } from '../contracts/errors.mjs';
import { CAPABILITIES, CAPABILITY_SLICES, SERVICE_VERSION, SLICE_NAMES } from '../contracts/service-face.mjs';
import { createLayerAllocator } from '../contracts/layers.mjs';
import { probeLogger } from '../kit/probe.mjs';
import { entryRank, normalizeEntry } from './entries.mjs';
import { ComponentFace, DockFace, OverlayFace } from './faces.mjs';
import { describeError, describeValue, truncate } from './text.mjs';

/** 诊断环容量（`__note` 的保留条数；诊断上报链路自己再去重/封顶）。 */
const DIAGNOSTIC_LIMIT = 64;
/**
 * 服务面实例。**不要从实例上取属性再延迟调用**（那会丢掉调用点绑定）：
 * 正确用法恒为 `ctx.guiFrame.register(...)` / `ctx.guiFrame.overlay.open(...)`。
 */
export const GuiFrameService = class GuiFrameService {
  /**
   * @param {object} ctx 提供者根 ctx（cordis 服务代理会在**调用点**把它换成调用方 ctx —— 见文件头）
   */
  constructor(ctx) {
    /** 调用方 ctx（调用点由 cordis 服务代理绑定；构造时＝提供者根 ctx）。 */
    this.ctx = ctx;
    this.version = SERVICE_VERSION;
    this.capabilities = CAPABILITIES;
    // ⚠ 内部数据字段**不得与原型成员同名**：实例自有属性会遮蔽原型方法/取值器
    //   （真踩过：`this.__entries = new Map()` 把 `__entries()` 方法盖掉 ⇒ 调用直接 TypeError）。
    //   `tests/unit/service.test.mjs` 有一条「自有属性 ∩ 原型成员 = ∅」的守卫盯着这件事。
    this.__installed = new Map();
    this.__registry = new Map();
    this.__entrySeq = 0;
    this.__diagnostics = [];
    this.__views = { components: new WeakMap(), dock: new WeakMap(), overlay: new WeakMap() };
    this.__stores = { components: new Map() };
    /**
     * ⚠ 这里**不放布局内态**：`__face` 的三个 kind 是 components/dock/overlay，
     * `LayoutFace` 无实例化点 ⇒ 任何布局字段都**没有路径**能从服务面上拿到，
     * 只会在 `__shutdown` 里留下一句够不着的清理。
     * 判据：`tests/unit/service-cleanup.test.mjs` 用源码扫描钉住它不再回来。
     */
    this.__layers = createLayerAllocator({ onWarning: (warning) => this.__note(warning.code, warning.message, warning.details) });
  }

  // ── 公开面：取值器（命名空间；必须是取值器，理由见文件头）────────────────────────────────

  get components() {
    return this.__face('components', ComponentFace, this.__stores.components);
  }

  /**
   * ★ **「按钮面板」的公开入口** —— `open()/close()/isOpen()`。
   * 语义与「点侧栏那一行」同源同一扇（详见 `faces.mjs` 的 `DockFace`）；能力缺席返回 `false` 不抛。
   */
  get dock() {
    return this.__face('dock', DockFace);
  }

  /**
   * **托管浮层**（能力⑥的一半；v1 保留它是因为「按钮面板」本身就是浮层实现：
   * `dock/panels.mjs` 走 `service.overlay.open({family:'panel'})`）。
   * 切片缺席时 `open` 抛 `GUIF-E-CAPABILITY-ABSENT`（与 v2 同语义）。
   */
  get overlay() {
    return this.__face('overlay', OverlayFace, this.__layers);
  }

  // ── 公开面：方法 ──────────────────────────────────────────────────────────────────────

  /**
   * 登记一个入口（自带 demo 与所有接入方都用它）。
   * `entry`：`{ id, label?, order?, group?, kind?, source? }` ——
   *  - `id` **必须带命名空间前缀**（如 `dsh-gui-frame/demo`），不得占用保留 key `conversation`；
   *  - `label` 传 thunk 以跟随 locale；`kind` ∈ `panel|action`（混合策略）；
   *  - `source` 是插件自报的包名（stale 判定要用）。
   * @param {object} entry
   * @param {Function|object} Component React 组件（任意形状，GUIFrame 只负责挂载，不碰内部结构）
   * @returns {() => void} disposer（幂等；卸载调用方 fiber 时 Cordis 会自动跑它）
   */
  register(entry, Component) {
    const ctx = this.ctx;
    const record = normalizeEntry(entry, Component);
    if (this.__registry.has(record.id)) {
      throw createError('GUIF-E-ENTRY-DUPLICATE', `入口 ${record.id} 已在册（同一 id 只能注册一次；先调用上一次返回的 disposer）`, { id: record.id });
    }
    this.__assertCtx(ctx, 'register');
    record.seq = this.__entrySeq;
    this.__entrySeq += 1;
    this.__registry.set(record.id, record);
    this.__broadcast({ type: 'added', entry: record });
    return this.__effect(ctx, `gui-frame: register ${record.id}`, () => () => {
      if (this.__registry.get(record.id) === record) {
        this.__registry.delete(record.id);
        this.__broadcast({ type: 'removed', entry: record });
      }
    });
  }

  /**
   * 能力是否**当前可用**：声明里有它（`capabilities`）**且**对应的切片已装配；
   * `layout` 无需切片（服务面自带内存态）。接入方应在调用前用它做优雅降级。
   */
  supports(name) {
    if (!CAPABILITIES.includes(name)) return false;
    const slice = CAPABILITY_SLICES[name];
    if (slice === null || slice === undefined) return true;
    return this.__installed.has(slice);
  }

  // ── 内部面（`__` 前缀：受【装配契约 v1】约束，但**不进公开面快照**）──────────────────────

  /** 装配一个能力切片（能力模块的 install 调用）。返回 disposer（可作 `ctx.effect` 的清理器）。 */
  __install(name, api) {
    if (!SLICE_NAMES.includes(name)) {
      throw createError('GUIF-E-SLICE-INVALID', `未知切片名 ${describeValue(name)}（白名单：${SLICE_NAMES.join(' / ')}）`, { name });
    }
    if (api === null || (typeof api !== 'object' && typeof api !== 'function')) {
      throw createError('GUIF-E-SLICE-INVALID', `切片 ${name} 的装配面必须是对象或函数（收到 ${describeValue(api)}）`, { name });
    }
    if (this.__installed.has(name)) {
      throw createError('GUIF-E-SLICE-INVALID', `切片 ${name} 已装配过（重复装配 = 两套实现抢同一能力；先调用上一次 __install 返回的 disposer）`, { name });
    }
    this.__installed.set(name, api);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (this.__installed.get(name) === api) this.__installed.delete(name);
    };
  }

  /** 读切片（诊断；调用公开方法不需要它）。 */
  __slice(name) {
    return this.__installed.get(name);
  }

  /** 已装配切片名（排序）—— `service.supports()` 的运行时补充。 */
  __slices() {
    return [...this.__installed.keys()].sort();
  }

  /**
   * 当前全部入口（**内部**；坞用它做初始挂载，之后靠 `dock.onEntry` 增量通知）。
   * 排序：`order` 升序，`order` 缺失的按注册序排在最后（「恢复完成前注册的直接进坞」）。
   */
  __entries() {
    return [...this.__registry.values()]
      .sort((left, right) => entryRank(left) - entryRank(right) || left.seq - right.seq)
      .map((record) => ({ ...record }));
  }

  /** 记一条诊断（进内存环 + `ctx.logger.warn`）。**限长**：超长消息截断，避免把栈灌进日志。 */
  __note(code, message, details) {
    const diagnostic = { code, message: truncate(String(message), 512), details: details === undefined ? null : details, at: Date.now() };
    this.__diagnostics.push(diagnostic);
    if (this.__diagnostics.length > DIAGNOSTIC_LIMIT) this.__diagnostics.splice(0, this.__diagnostics.length - DIAGNOSTIC_LIMIT);
    this.__log('warn', formatDiagnostic(diagnostic));
    return diagnostic;
  }

  /** 取走并清空诊断环（诊断上报链路用）。 */
  __drainDiagnostics() {
    return this.__diagnostics.splice(0, this.__diagnostics.length);
  }

  /** 提供者 fiber 卸载时的收尾（`provideService` 的 effect 调它）。 */
  __shutdown() {
    for (const [name, api] of [...this.__installed]) {
      this.__installed.delete(name);
      if (api !== null && typeof api.dispose === 'function') {
        try {
          api.dispose();
        } catch (error) {
          this.__note('GUIF-W-LISTENER-THREW', `切片 ${name} 的 dispose 抛错（已吞）：${describeError(error)}`);
        }
      }
    }
    this.__registry.clear();
  }

  /** 调用方 ctx 的准入（Cordis 必备面；缺了绝不静默退化成「直接执行」）。 */
  __assertCtx(ctx, who) {
    if (ctx === null || ctx === undefined || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
      throw createError('GUIF-E-CTX-INVALID', `${who} 需要在 Cordis ctx 上调用（ctx.effect 缺失 ⇒ 清理会挂不上调用方 fiber，不接受退化路径）`, { who });
    }
    return ctx;
  }

  /** 在**调用方** fiber 上注册一条副作用，返回幂等 disposer。 */
  __effect(ctx, label, install) {
    this.__assertCtx(ctx, label);
    const dispose = ctx.effect(install, label);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (typeof dispose === 'function') dispose();
    };
  }

  /** 按**调用方 ctx** 取命名空间视图（WeakMap 缓存：同一 ctx 拿同一个面）。 */
  __face(kind, Face, ...rest) {
    const ctx = this.__assertCtx(this.ctx, `${kind} 命名空间`);
    const cache = this.__views[kind];
    let face = cache.get(ctx);
    if (face === undefined) {
      face = new Face(ctx, this, ...rest);
      cache.set(ctx, face);
    }
    return face;
  }

  __broadcast(change) {
    const slice = this.__installed.get('dock');
    if (slice === undefined || typeof slice.onEntry !== 'function') return;
    try {
      slice.onEntry(this.ctx, change);
    } catch (error) {
      this.__note('GUIF-W-LISTENER-THREW', `dock 切片的 onEntry 抛错（已吞，注册不回滚）：${describeError(error)}`);
    }
  }

  __log(level, line) {
    const logger = probeLogger(this.ctx);
    if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](line);
  }
};
