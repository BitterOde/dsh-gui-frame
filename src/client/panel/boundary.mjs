/**
 * boundary.mjs —— 壳组件**自己的**渲染错误隔离。
 *
 * ═══ 为什么不能靠官方 boundary ═══
 * 官方渲染层给每个座位条目一个 `SlotErrorBoundary`，但它的崩溃面是
 * **`<div data-slot-error="<slotKey>">` —— 空 div、没有文案、不能重试**（逐字实读
 * `dsh-client-ui-renderer/lib/client.js`）。用户看到的就是一片空白。
 * ⇒ 错误态必须由 GUIFrame 的壳组件内部自 catch 渲染，本文件就是这个 catch。
 *
 * 三层 catch，缺一不可：
 *   ① **类组件的错误边界**（`getDerivedStateFromError` + `componentDidCatch`）：抓**子树渲染期间**
 *      抛出的错误（插件内容组件自己抛）——这是 React 里唯一能抓 render 抛错的机制；
 *   ② **`safeRender`**：抓**我们自己在 render 里同步调用**的回调抛错（`renderItem`、label thunk、
 *      `onSelect` 之类的构造期调用）——它发生在**我们自己的渲染函数体内**，那时还没有子边界可接；
 *   ③ **fallback 自身的保险**：光是 ① 还不够 ——
 *      如果 fallback 又把刚抛错的那棵 `children` 渲染一遍（`errorView({ ...props, error })` 的经典形态），
 *      React 会认为**边界自己也炸了**，于是把整棵树卸载 ⇒ 真机上由官方 `SlotErrorBoundary` 兜住，
 *      用户看到的正是那个空 div。所以 `render()` 必须自己 try/catch fallback，失败就退到
 *      **静态最小错误节点**（纯字面量、不读 props、不调组件）—— 且**任何情况下都不返回 null**。
 *
 * 基类取用：真实 React 走 `react.Component`（`isReactComponent` 标记由它自己打）；
 * 无 `Component` 的假 react（构建期 `loadArtifact` 用的那种）退到本地基类，并自己打上
 * `prototype.isReactComponent` —— 否则 React 会把类组件当函数组件调用（静默失效）。
 *
 * 本文件**零副作用**，且**不 import 任何东西**：兜底层要能在「什么都坏了」的时候还画得出来。
 */

/** 静态最小错误节点的锚点值（与状态视图同一套：`data-guif-state="error"`）与标题文案（纯字面量）。 */
export const MINIMAL_ERROR_STATE = 'error';
export const MINIMAL_ERROR_TITLE = '面板渲染出错';
/** 静态最小错误节点的专用标记（用于区分「正常错误态」与「连 fallback 都炸了」的兜底节点）。 */
export const MINIMAL_ERROR_ATTR = 'data-guif-boundary';
export const MINIMAL_ERROR_KIND = 'minimal';

/** 无 `react.Component` 时的最小基类（React 只要求 + `isReactComponent` 标记）。 */
function createMiniComponent() {
  class MiniComponent {
    constructor(props) {
      this.props = props ?? {};
      this.state = null;
    }

    setState(partial) {
      const next = typeof partial === 'function' ? partial(this.state ?? {}) : partial;
      this.state = { ...(this.state ?? {}), ...next };
    }
  }
  MiniComponent.prototype.isReactComponent = {};
  return MiniComponent;
}

/** 取基类：真 React 的 `Component` 优先（它自带 `isReactComponent`）。 */
function baseClass(react) {
  if (react !== null && typeof react === 'object' && typeof react.Component === 'function') return react.Component;
  return createMiniComponent();
}

/** 把任意错误值收敛成一行文案；**自己绝不抛**（兜底层的兜底层，不能有失败路径）。 */
function minimalMessage(error) {
  try {
    if (typeof error === 'string') return error;
    if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
    if (error === null || error === undefined) return '（无错误信息）';
    return String(error);
  } catch {
    return '（错误值无法读取）';
  }
}

/**
 * 造 GUIFrame 自己的错误边界组件。
 * props：
 *  - `children`：被隔离的子树；
 *  - `renderError(error, reset)`：崩溃时渲染什么（返回元素；壳组件传 ErrorState）。
 *    **可以不传**——不传时退到静态最小错误节点（绝不渲染成空白/null）；
 *  - `onError(error, info)`：可选上报（诊断链路用；本文件只调，不实现）。
 * @param {object} react 种子 react（真 React 或测试替身）
 * @returns {Function} 类组件
 */
export function createRenderBoundary(react) {
  const Base = baseClass(react);
  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
    throw new Error('[gui-frame] createRenderBoundary(react) 需要一个带 createElement 的 react（兜底节点也要能建元素）');
  }
  const el = react.createElement;

  /**
   * **静态最小错误节点**：纯字面量 + 纯宿主元素，不读 props、不调组件、不碰种子/样式表/文案表。
   * 它存在的意义是「连 fallback 都炸了的时候，屏幕上至少要有一句话」——
   * 所以这里**没有任何可能抛错的取值**（除了 createElement 本身）。
   */
  function minimalNode(primary, detail) {
    const title = minimalMessage(primary);
    // 明细与主错因**同文本**时不重复画一行（同一次抛错会在两层里各出现一次）
    const showDetail = detail !== undefined && detail !== null && detail !== primary && minimalMessage(detail) !== title;
    return el('div', { [MINIMAL_ERROR_ATTR]: MINIMAL_ERROR_KIND, 'data-guif-state': MINIMAL_ERROR_STATE },
      el('div', null, MINIMAL_ERROR_TITLE),
      el('code', null, title),
      showDetail ? el('code', null, minimalMessage(detail)) : null);
  }

  class GuiFrameRenderBoundary extends Base {
    constructor(props) {
      super(props);
      this.state = { failed: false, error: null };
      this.__reset = () => {
        this.setState({ failed: false, error: null });
      };
    }

    static getDerivedStateFromError(error) {
      return { failed: true, error };
    }

    componentDidCatch(error, info) {
      this.__report(error, info);
    }

    /** 上报（**吞掉一切**：上报链自己抛错绝不能连坐渲染）。 */
    __report(error, info) {
      const callback = this.props === null || this.props === undefined ? null : this.props.onError;
      if (typeof callback !== 'function') return;
      try {
        callback(error, info === undefined ? null : info);
      } catch {
        // 上报抛错不连坐
      }
    }

    /** 失败态下的「主错因」：优先用让边界失败的那个原始错误。 */
    __primaryError(secondary) {
      const state = this.state === null || this.state === undefined ? null : this.state;
      const primary = state === null ? null : state.error;
      return primary === undefined || primary === null ? secondary : primary;
    }

    render() {
      const state = this.state === null || this.state === undefined ? null : this.state;
      const failed = state !== null && state.failed === true;
      const props = this.props === null || this.props === undefined ? {} : this.props;
      // 嵌套实例（`guard: false`）不再往下套 —— 否则边界会无限自我嵌套
      const guardEnabled = props.guard !== false;
      let node = null;
      try {
        node = this.__renderInner(failed, state);
      } catch (error) {
        // ③ 的保险（同步那半）：构造 fallback 的过程中就抛错 ⇒ 绝不逃出去
        this.__report(error, null);
        const staticNode = minimalNode(this.__primaryError(error), error);
        return guardEnabled ? this.__guard(staticNode) : staticNode;
      }
      if (node === null || node === undefined) {
        // 失败态**绝不返回 null**（返回 null = 把「有错」变成「什么都没有」，比空 div 更难查）
        if (!failed) return null; // 未失败且无 children ⇒ null 是正常的
        const staticNode = minimalNode(this.__primaryError(null), null);
        return guardEnabled ? this.__guard(staticNode) : staticNode;
      }
      if (!failed) return node;
      // ③ 的保险（异步那半，**这才是 repro B 分支的关键**）：fallback 自己返回的子树由 React 渲染，
      // 里面若再包着抛错的 children，React 会把错误抛到**上层**（同一个边界不会二次接住自己）⇒
      // 所以给 fallback 的输出再套一层**同类边界**，由它退到静态最小节点。
      return guardEnabled ? this.__guard(node) : node;
    }

    /**
     * 把 fallback 的输出包进一个**同类边界**（嵌套实例，类型只建一次，不会因换类型而重挂载）。
     * 嵌套实例带 `guard: false`（**不再往下套**，否则边界会无限自我嵌套），并且它的 fallback 恒为
     * 静态最小错误节点。
     */
    __guard(node) {
      const callback = this.props === null || this.props === undefined ? null : this.props.onError;
      const primary = this.__primaryError(null);
      return el(GuiFrameRenderBoundary, {
        key: '__guif-fallback-guard',
        guard: false,
        onError: typeof callback === 'function' ? callback : undefined,
        renderError: (innerError) => minimalNode(primary, innerError),
      }, node);
    }

    /** 正常路径：失败 ⇒ fallback（或静态最小节点）；未失败 ⇒ children。 */
    __renderInner(failed, state) {
      if (!failed) return this.props === null || this.props === undefined ? null : (this.props.children ?? null);
      const renderError = this.props === null || this.props === undefined ? null : this.props.renderError;
      if (typeof renderError === 'function') return renderError(state.error, this.__reset);
      return minimalNode(state.error, null);
    }
  }
  return GuiFrameRenderBoundary;
}

/**
 * 同步调用一个可能抛错的构造函数（渲染期用）。
 * @param {Function} fn 待调用
 * @param {unknown} fallbackValue 抛错时的返回值
 * @param {((error:unknown)=>void)|null} [onError] 可选上报
 * @returns {unknown} `fn()` 的返回值，或 `fallbackValue`
 */
export function safeRender(fn, fallbackValue, onError = null) {
  try {
    return fn();
  } catch (error) {
    if (typeof onError === 'function') {
      try {
        onError(error);
      } catch {
        // 上报抛错不连坐
      }
    }
    return fallbackValue;
  }
}
