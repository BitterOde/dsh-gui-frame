/**
 * window-harness.mjs —— 浮层单测共用的**最小夹具**（L3/L4 层）。
 *
 * 只做三件事：
 *  ① `createDom()`：起一个 jsdom，并把 React 需要的全局（window/document/navigator/…）装上、
 *     返回 `cleanup()` 还原（node:test 默认每个测试文件独立进程，但仍显式还原以免同文件内串味）；
 *  ② `createListenerLog()`：可注入的 document-like 替身（记录 addEventListener 的 type/phase），
 *     用于**机制级**断言（捕获期 vs 冒泡期、是否对称摘挂）；
 *  ③ `createRecorderPrimitives()`：官方 primitives 的替身（记录「用了哪个原子件」），
 *     用于验证「弹层族确实复用官方原子」而不是自己重画。
 *
 * ⚠ 本文件不是 `.test.mjs`（`node --test "tests/**\/*.test.mjs"` 不会把它当用例跑）。
 *   独立验证**不要求**复用这里——各自有各自的判据。
 */
import { JSDOM } from 'jsdom';

/** 起 jsdom 并装好 React 需要的全局。 */
export function createDom(html = '<!doctype html><html><body></body></html>') {
  const jsdom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://127.0.0.1/' });
  const { window } = jsdom;
  const saved = new Map();
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return {
    jsdom,
    window,
    document: window.document,
    body: window.document.body,
    cleanup() {
      for (const [key, value] of saved.entries()) {
        if (value === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      }
      window.close();
    },
  };
}

/** 可注入的 document-like 替身：记录每一次 add/removeEventListener（type + phase + 顺序）。 */
export function createListenerLog() {
  const log = [];
  return {
    log,
    addEventListener(type, handler, options) {
      log.push({ op: 'add', type, capture: options === true || options?.capture === true, handler });
    },
    removeEventListener(type, handler, options) {
      log.push({ op: 'remove', type, capture: options === true || options?.capture === true, handler });
    },
    /** 当前仍挂着的监听（type + phase + handler）。 */
    active() {
      const live = new Map();
      for (const row of log) {
        const key = `${row.type}|${row.capture ? 'capture' : 'bubble'}`;
        const list = live.get(key) ?? [];
        if (row.op === 'add') list.push(row.handler);
        else {
          const index = list.indexOf(row.handler);
          if (index >= 0) list.splice(index, 1);
        }
        live.set(key, list);
      }
      const out = [];
      for (const [key, handlers] of live.entries()) {
        for (const handler of handlers) out.push({ key, type: key.split('|')[0], capture: key.endsWith('capture'), handler });
      }
      return out;
    },
    typesAttached() {
      return this.active().map((row) => `${row.type}:${row.capture ? 'capture' : 'bubble'}`);
    },
  };
}

/**
 * 模拟 React 渲染一个「元素」：`createElement(Component, …)` 只造元素，**组件函数要等渲染才被调用**；
 * 所以断言「用了官方原子」时必须显式 invoke 一次（`element.type(element.props, element.children)`）。
 */
export function renderElement(element) {
  if (element === null || element === undefined) return null;
  if (typeof element.type === 'function') return element.type(element.props, element.children);
  return element;
}

/** 官方 primitives 替身：被调用即记账，返回一个带标记的元素树。 */
export function createRecorderPrimitives(react) {
  const calls = [];
  const make = (name) => (props, children) => {
    calls.push({ name, props: props ?? null, children: children ?? null });
    return react.createElement('div', { 'data-atom': name }, children ?? null);
  };
  const primitives = {};
  for (const name of ['Modal', 'Menu', 'Tooltip', 'HoverCard', 'Toast', 'Button']) {
    primitives[name] = make(name);
  }
  return { primitives, calls, used: () => calls.map((row) => row.name) };
}

/** 可手动触发的 ResizeObserver 替身（jsdom 没有 ResizeObserver）。 */
export function createFakeResizeObserver() {
  const instances = [];
  function FakeResizeObserver(callback) {
    const instance = {
      callback,
      targets: [],
      disconnected: false,
      observe(target) {
        instance.targets.push(target);
      },
      unobserve() {},
      disconnect() {
        instance.disconnected = true;
      },
      /** 手动触发一次（模拟容器尺寸变化）。 */
      trigger() {
        callback([], instance);
      },
    };
    instances.push(instance);
    return instance;
  }
  FakeResizeObserver.instances = instances;
  return FakeResizeObserver;
}

/** 带记录功能的「指针事件」替身（给手势/关闭控制器的纯函数层用）。 */
export function createPointerEventLike(options = {}) {
  const calls = [];
  return {
    type: options.type ?? 'pointerdown',
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    target: options.target ?? null,
    calls,
    preventDefault() {
      calls.push('preventDefault');
    },
    stopPropagation() {
      calls.push('stopPropagation');
    },
    setPointerCapture() {
      calls.push('setPointerCapture');
    },
    releasePointerCapture() {
      calls.push('releasePointerCapture');
    },
  };
}

/** 造一个「假 DOM 元素」：只带 matches / parentNode / children，用于 selector 回溯测试。 */
export function createFakeElement(tag, options = {}) {
  const node = {
    tag,
    attributes: options.attributes ?? {},
    parentNode: null,
    children: [],
    matches(selector) {
      if (selector === '[data-guif-no-drag]') return node.attributes['data-guif-no-drag'] === true || node.attributes['data-guif-no-drag'] === '';
      return false;
    },
  };
  return node;
}

/** 把 `child.parentNode` 指向 `parent`（构造父链）。 */
export function link(parent, child) {
  child.parentNode = parent;
  parent.children.push(child);
  return child;
}
