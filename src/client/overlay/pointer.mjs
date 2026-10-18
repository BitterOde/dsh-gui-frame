/**
 * pointer.mjs —— **pointer-events 栈**：让浮层之下不可交互。
 *
 * 机制（Radix 同款，MIT，只借机制不抄码）：
 *   `body { pointer-events: none }` + **最上层内联 `auto`** ⇒ 浮层之下整片不可交互，
 *   而浮层自己（及其子树）照常可点 —— 因为 CSS 里 `pointer-events` 可以被后代显式改回来。
 *
 * ⚠ 这是**全局副作用**（改的是 `body` 的行内样式），所以两条纪律必须做足：
 *  ① **原值存取**：进入前记下 `body` 原有的行内 `pointer-events`（可能是空串 = 未设置）；
 *  ② **引用计数**：多层同时要锁时只写一次，最后一层走掉才还原 —— **卸载严格还原原值**，
 *     不留下 `pointer-events: none` 这种「页面看着正常但哪儿都点不动」的幽灵状态。
 *
 * 本文件只依赖注入的 `dom`（缺省 `document`），不依赖 React（L0/L3 直测）。
 */

/** 解析出 `body`（注入的 dom 可能是 document，也可能直接就是 body）。 */
function resolveBody(dom) {
  if (dom === null || dom === undefined) return null;
  if (dom.body !== undefined && dom.body !== null) return dom.body;
  if (dom.style !== undefined) return dom;
  return null;
}

/** 读当前行内值（**空串 = 没设过**，与 `undefined` 区分开）。 */
function readInline(element) {
  const value = element.style?.pointerEvents;
  return typeof value === 'string' ? value : '';
}

/**
 * @param {{dom?:object}} [options] `dom` 缺省 `globalThis.document`
 * @returns {{lock:Function, release:Function, depth:Function, saved:Function, isLocked:Function,
 *   restoreNow:Function, body:Function}}
 */
export function createPointerGuard(options = {}) {
  const dom = options.dom ?? (typeof document === 'undefined' ? null : document);
  let depth = 0;
  let saved = null; // { value: string }
  let target = null;

  const applyNone = () => {
    const body = resolveBody(dom);
    if (body === null || body === undefined || body.style === undefined) return null;
    if (depth === 0) {
      saved = { value: readInline(body) };
      target = body;
      body.style.pointerEvents = 'none';
    }
    return body;
  };

  const restore = () => {
    if (target === null || saved === null) return false;
    if (saved.value === '') {
      // 原来没设过 ⇒ **移除属性**，而不是写空串（写空串会多出一个无意义的内联属性）
      if (typeof target.style.removeProperty === 'function') target.style.removeProperty('pointer-events');
      else target.style.pointerEvents = '';
    } else {
      target.style.pointerEvents = saved.value;
    }
    saved = null;
    target = null;
    return true;
  };

  /** 解一层锁（计数归零时还原原值）。**不用 `this`** —— 解构出来后也必须能独立调用。 */
  const release = () => {
    if (depth === 0) return false;
    depth -= 1;
    if (depth === 0) return restore();
    return false;
  };

  return {
    /**
     * 加一层锁（返回幂等的解绑器）。
     * @returns {() => void}
     */
    lock() {
      applyNone();
      depth += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    },
    release,
    depth() {
      return depth;
    },
    saved() {
      return saved === null ? null : { ...saved };
    },
    isLocked() {
      return depth > 0;
    },
    /** 兜底：无论计数多少，强制还原原值（卸载路径上的最后一道保险）。 */
    restoreNow() {
      depth = 0;
      return restore();
    },
    body() {
      return target ?? resolveBody(dom);
    },
  };
}
