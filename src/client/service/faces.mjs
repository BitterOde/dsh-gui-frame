/**
 * faces.mjs —— **三个命名空间视图**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 *   · `ComponentFace`（`components.register/has/get/names/props`；冻结名与 props 契约在 `contracts/components.mjs`）；
 *   · `OverlayFace`（`overlay.open/close/bringToFront`：校验窗口描述 → 向数字层级表领号 → 交给 overlay 切片）；
 *   · `DockFace`（「按钮面板」的公开开关 `open/close/isOpen`）。
 *
 * 每个面的 `ctx` 都是**调用点绑定的调用方 ctx**（构造参数），副作用一律经 `__service.__effect(ctx, …)`
 * 挂调用方 fiber —— 这条机制由 `service-lifecycle.test.mjs` 与 `service.test.mjs` 盯着，搬文件不搬语义。
 *
 * ★ 本文件**只认这三个面**：`LayoutFace`（`layout.get/replace/subscribe`）随同 `get layout()`
 *   命名空间一起被裁，它独占的布局链（形状词表、迁移、收敛）**整套已删** —— 本版没有布局能力，
 *   那条链没有任何运行时消费方。**不许加回来**：`tests/unit/service-cleanup.test.mjs` 逐个钉着
 *   这些路径，构建器另有一条「`src/client` 下每个模块都必须从入口可达」的校验。
 *
 * 依赖方向：`service/**` 是装配层（L3）；本件依赖词汇叶 `contracts/**` 与同域 `text.mjs`。
 */
import { createError } from '../contracts/errors.mjs';
import { COMPONENT_NAMES, COMPONENT_PROPS } from '../contracts/components.mjs';
import { LAYER_FAMILIES } from '../contracts/layers.mjs';
import { describeError, describeValue } from './text.mjs';

/**
 * `components` 命名空间（把 GUIFrame 的**复合组件**给插件用）。
 * 本文件只冻结名字（见 contracts/components.mjs）与登记语义，实现另装。
 */
export const ComponentFace = class ComponentFace {
  constructor(ctx, service, store) {
    this.ctx = ctx;
    this.__service = service;
    this.__store = store;
  }

  /** 登记一个组件实现（本包用冻结名装实现；插件也可贡献自己的可复用组件）。 */
  register(name, Component) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw createError('GUIF-E-COMPONENT-INVALID', `components.register(name, Component) 的 name 必须是非空字符串（收到 ${describeValue(name)}）`, { name });
    }
    if (Component === null || (typeof Component !== 'function' && typeof Component !== 'object')) {
      throw createError('GUIF-E-COMPONENT-INVALID', `组件 ${name} 必须是函数组件、类组件或 memo/forwardRef 形状（收到 ${describeValue(Component)}）`, { name });
    }
    if (this.__store.has(name)) {
      throw createError('GUIF-E-COMPONENT-DUPLICATE', `组件名 ${name} 已被占用（先调用上一次 register 返回的 disposer）`, { name });
    }
    this.__service.__assertCtx(this.ctx, 'components.register');
    this.__store.set(name, Component);
    return this.__service.__effect(this.ctx, `gui-frame: components.register ${name}`, () => () => {
      if (this.__store.get(name) === Component) this.__store.delete(name);
    });
  }

  /** 名字是否可用（冻结清单里的名字恒为 true —— 它们已经在对外承诺里）。 */
  has(name) {
    return typeof name === 'string' && (this.__store.has(name) || COMPONENT_NAMES.includes(name));
  }

  /** 取实现；冻结名在本包装上前返回 `undefined`（**不要编码成空组件**，那会把「还没实现」伪装成「实现了但是空的」）。 */
  get(name) {
    return typeof name === 'string' ? this.__store.get(name) : undefined;
  }

  /** 全部可用名字（冻结清单 ∪ 已登记），排序。 */
  names() {
    return [...new Set([...COMPONENT_NAMES, ...this.__store.keys()])].sort();
  }

  /** 冻结名必须接受的 props（只读契约；只能加可选 props，不得改名/删名）。 */
  props(name) {
    return COMPONENT_PROPS[name] ?? null;
  }
};

/**
 * 普通对象判据（数组 / 类实例 / null 都不算；`overlay.open` 的入参校验用）。
 *
 * ★ 写法是**有意的**：只看原型是不是 `Object.prototype` / `null`。只写 `typeof value === 'object'`
 * 会放行类实例 —— 那是放宽 `GUIF-E-ENTRY-INVALID` 的判据，不是简化。
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `overlay` 命名空间（`overlay.open/close/bringToFront`）。
 * 真正的 DOM/层栈实现在 overlay 切片；本文件负责**在服务面上**：校验窗口描述、向数字层级表领号
 * （极值拒绝、越段告警），再交给切片。
 */
export const OverlayFace = class OverlayFace {
  constructor(ctx, service, layers) {
    this.ctx = ctx;
    this.__service = service;
    this.__layers = layers;
  }

  /**
   * @param {{id?:string, family?:'floating'|'dialog'|'popover'|'toast', title?:unknown, component?:unknown, props?:unknown}} spec
   * @param {{z?:number}} [options] 显式层级号；不传则从 100 起单调自增
   * @returns {object} overlay 切片返回的句柄（约定形状：`{ id, z, close(), bringToFront() }`）
   */
  open(spec, options) {
    const opts = options === undefined || options === null ? {} : options;
    if (!isPlainObject(spec)) {
      throw createError('GUIF-E-OVERLAY-SPEC', `overlay.open(spec) 的 spec 必须是普通对象（收到 ${describeValue(spec)}）`, { spec: describeValue(spec) });
    }
    if (!isPlainObject(opts)) {
      throw createError('GUIF-E-OVERLAY-SPEC', `overlay.open(spec, options) 的 options 必须是普通对象（收到 ${describeValue(opts)}）`, { options: describeValue(opts) });
    }
    if (spec.id !== undefined && (typeof spec.id !== 'string' || spec.id.trim() === '')) {
      throw createError('GUIF-E-OVERLAY-ID', `窗口 id 必须是非空字符串（收到 ${describeValue(spec.id)}）`, { id: spec.id });
    }
    const family = spec.family === undefined ? 'floating' : spec.family;
    if (!LAYER_FAMILIES.includes(family)) {
      throw createError('GUIF-E-OVERLAY-SPEC', `窗口 family 必须是 ${LAYER_FAMILIES.join(' / ')} 之一（收到 ${describeValue(family)}）`, { family });
    }
    const slice = this.__service.__installed.get('overlay');
    if (slice === undefined || typeof slice.open !== 'function') {
      throw createError('GUIF-E-CAPABILITY-ABSENT', '浮层能力未装配（浮层切片的 install(ctx, env) 未执行）—— 不静默 no-op', { capability: 'overlay' });
    }
    // 数字层级表：极值 ⇒ 抛 GUIF-E-Z-RANGE；越段 ⇒ 只告警。
    // 放在切片检查之后：装配都没装配就别消耗号（失败调用不留副作用）。
    const seat = this.__layers.allocate(family, opts.z);
    const request = { ...spec, family, z: seat.z, band: seat.band };
    const handle = slice.open(this.ctx, request);
    if (handle === null || typeof handle !== 'object' || typeof handle.id !== 'string' || handle.id === '') {
      throw createError('GUIF-E-SLICE-INVALID', 'overlay 切片必须返回带字符串 id 的句柄（装配期契约被破坏）', { handle: describeValue(handle) });
    }
    return handle;
  }

  /** 关闭；**合法但不存在的 id 返回 false（幂等），形态非法才抛**。 */
  close(id) {
    return this.__dispatch('close', id);
  }

  /** 点击置顶（同层内的叠放序；跨族恒由数字表决定）；语义与 close 相同。 */
  bringToFront(id) {
    return this.__dispatch('bringToFront', id);
  }

  __dispatch(method, id) {
    if (typeof id !== 'string' || id === '') {
      throw createError('GUIF-E-OVERLAY-ID', `overlay.${method}(id) 的 id 必须是非空字符串（窗口不存在时返回 false，不抛错）`, { id: describeValue(id) });
    }
    const slice = this.__service.__installed.get('overlay');
    if (slice === undefined || typeof slice[method] !== 'function') {
      throw createError('GUIF-E-CAPABILITY-ABSENT', `浮层能力未装配（浮层切片的 install(ctx, env) 未执行）—— overlay.${method}`, { capability: 'overlay' });
    }
    return slice[method](this.ctx, id) !== false;
  }
};

/**
 * `dock` 命名空间（用户裁定「开放一个 API」）——**「按钮面板」的公开开关**。
 *
 * ═══ 它解决的是哪条契约缺口 ═══
 * 加它之前：`supports('dock')` 返回 true（切片装了就 true），可**公开面没有任何入口**能打开那块面板 ——
 * 只有坞自己（点侧栏那一行 / 管理页的自检按钮）能开，外部插件只能绕平台的
 * `ctx.layout.selectPanel('dsh-gui-frame/dock')` 去触发折回页（README 的「契约缺口」那一节自己记着这件事）。
 *
 * ═══ 三条语义（写死在这里，改它就是改公开契约）═══
 *  ① **同一扇面板**：与「点侧栏那一行」走的是同一次打开 —— 同一个窗口 id
 *     （`dock/panels.mjs` 的 `DOCK_PANEL_ID`）、同一份正文（外部插件交进来的 `kind:'action'` 按钮）、
 *     同一套锚点规则（不给锚点就用坞入口字形记的矩形，拿不到就用安全缺省位）；
 *  ② **共享 UI，不是调用方的窗口**：它归**插件整体**所有（`ctx.gui-frame` 服务在场期间一直在），
 *     所以**不**把任何副作用挂到调用方 fiber 上（`open` 之后调用方卸载**不会**替你关掉它）——
 *     要成对收尾就自己调 `close()`；这与 `overlay.open` 的「调用方私有窗口」语义**故意不同**，
 *     因为「按钮面板」是全局一件的东西，不是谁的私有浮窗；
 *  ③ **能力缺席 ⇒ `false`，不抛**：坞切片未装（本包没装上 / 让位给了别人）或浮层切片未装时，
 *     `open()` 返回 `false`（与坞内部 `openDockPanel` 的口径**同一份**：它也是拿 overlay 开不出来就 false，
 *     折回页据此退回管理页）。要提前判断用 `ctx.guiFrame.supports('dock')`；真正的异常（切片形状破了）
 *     会记一条 `GUIF-W-LISTENER-THREW` 诊断，不静默吞掉。
 */
export const DockFace = class DockFace {
  constructor(ctx, service) {
    this.ctx = ctx;
    this.__service = service;
  }

  /**
   * 打开（或把已在场的面板**重新置顶**）「按钮面板」。
   * @param {{anchor?:{left?:number, top?:number, right?:number, width?:number, height?:number}|null}} [options]
   *   `anchor` 是**可选的**定位矩形（触发它的那颗按钮的屏幕矩形）；缺省/非法 ⇒ 用坞入口字形记的矩形。
   * @returns {boolean} 面板此刻是否在场（`false` ＝ 没开成，成因见类注释③；形态非法**不抛**，按「不给锚点」处理）
   */
  open(options) {
    const slice = this.__dock();
    if (slice === null || typeof slice.open !== 'function') return false;
    return this.__call('open', slice, dockAnchorOf(options));
  }

  /** 关掉「按钮面板」（幂等：不在场 ⇒ `false`）。返回**操作前**是否在场。 */
  close() {
    const slice = this.__dock();
    if (slice === null || typeof slice.close !== 'function') return false;
    return this.__call('close', slice);
  }

  /** 面板此刻是否在场（只读；坞/浮层切片缺席 ⇒ `false`）。 */
  isOpen() {
    const slice = this.__dock();
    if (slice === null || typeof slice.isOpen !== 'function') return false;
    return this.__call('isOpen', slice);
  }

  /** 坞切片（未装配 ⇒ `null`，**不抛**：这是「本包没装上」的正常一态，不是异常）。 */
  __dock() {
    const service = this.__service;
    if (service === null || typeof service.__slice !== 'function') return null;
    const slice = service.__slice('dock');
    return slice === undefined || slice === null || typeof slice !== 'object' ? null : slice;
  }

  /**
   * 切片调用一律收成 boolean：**切片形状破了的错要留痕**（诊断环 + warn 日志），
   * 但不把异常冒到调用点 —— 这个接口的调用方是「想弹一块 UI」的人，不该为了弹不出来去写 try/catch。
   */
  __call(method, slice, ...args) {
    try {
      return slice[method](...args) === true;
    } catch (error) {
      try {
        this.__service.__note('GUIF-W-LISTENER-THREW', `dock.${method} 抛错（已吞，返回 false）：${describeError(error)}`);
      } catch {
        // 诊断本身失败不再往上冒（与 __broadcast 同一口径）
      }
      return false;
    }
  }
};

/**
 * 从 `dock.open(options)` 里取出锚点矩形：**只认对象**，其余（缺省 / null / 数字 / 字符串）
 * 一律当「不给锚点」⇒ 由坞回落到入口字形的矩形。字段形态的宽容由 `panelRectNear` 承担
 * （读不到 left/right/top 就退到安全缺省位），这里不重复一遍校验。
 * @param {unknown} options
 * @returns {object|null}
 */
export function dockAnchorOf(options) {
  if (options === null || options === undefined || typeof options !== 'object') return null;
  const anchor = options.anchor;
  return anchor !== null && typeof anchor === 'object' ? anchor : null;
}


