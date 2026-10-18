/**
 * page-instrument.js —— 真机插桩（**页面侧**，经 CDP `Page.addScriptToEvaluateOnNewDocument` 注入；
 * 每次导航都会重新跑一遍，所以每一轮拿到的是独立的 `window.__T58__`）。
 *
 * 目的：在真外壳里把「对话层开出后 overlay 宿主子树从 DOM 消失」钉到**可证伪的归属**：
 *   ① 层栈被清空（宿主还在、栈空了）；② 宿主被重挂（根节点被替换/卸载）；③ 宿主整棵卸载（第三种，不在候选里也要如实报）。
 *
 * 插桩面（全部**只观察**，不改产物代码；仅给切片 api 对象的方法套一层记账壳，仍然原样调用原方法）：
 *   A. `[data-guif-overlay-root]` 的**节点引用身份**（WeakMap 分配稳定 id）+ 是否仍在文档内 + 父链；
 *   B. 宿主自己渲染的**栈长读数** `data-guif-overlay-layers`（= `stack.records().length`，host.mjs 写的）；
 *   C. MutationObserver（childList + 白名单属性）记录**移除/新增的顺序与身份**；
 *   D. 服务面：尽力捕获 `ctx` → `ctx.get('gui-frame')` → 包 `__install`（记录每次切片装配 + 给返回的
 *      disposer 套壳）→ 给 overlay 切片的 `open/close/bringToFront/dispose` 套壳并抓调用栈。
 *      ⇒ 「清空」这条路的触发源（`raw()` / `api.dispose()` / 切片 disposer / fiber 卸载）能直接落进读数。
 *   E. loader 捕获**三路并记**（defineProperty setter / `Object.defineProperty` 钩子 / 50ms 轮询），
 *      逐条记录哪一路真的生效、`load()` 见过哪些 id —— 早先记过「拦不住 `__ModuleLoader__`」，这里把它证清楚。
 *   F. 反假绿自证 `selftest()`：人为把一根 `[data-guif-overlay-root]` 从文档里移走，
 *      断言采样器与 observer **确实能看见**这次消失（看不见 ⇒ 本次所有「没消失」结论都不可信）。
 */
(() => {
  if (window.__T58__ !== undefined) return;

  const t0 = performance.now();
  const now = () => Number((performance.now() - t0).toFixed(1));
  const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max === undefined ? 120 : max) : value);
  const msgOf = (error) => {
    try {
      return String((error && error.message) || error).slice(0, 240);
    } catch {
      return 'unprintable';
    }
  };
  const stackOf = () => {
    try {
      return String(new Error('t58').stack || '').split('\n').slice(1, 9).map((line) => line.trim()).join(' | ').slice(0, 900);
    } catch {
      return null;
    }
  };

  const S = {
    t0,
    version: 1,
    seq: 0,
    objSeq: 0,
    log: [],
    samples: [],
    mutations: [],
    mutationOverflow: false,
    sampleOverflow: false,
    loader: { setterFired: false, definePropertyHookFired: false, pollWrapped: false, wrappedAt: null, loads: [], factorySeen: [], applyCalls: 0 },
    service: { captured: false, via: null, installs: [], sliceDisposerCalls: [], apiCalls: [], apiWrapFails: [], ctxGetErrors: [] },
    notes: [],
    errors: [],
    selftest: null,
  };
  window.__T58__ = S;

  const nodeIds = new WeakMap();
  const objIds = new WeakMap();
  const nid = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return null;
    let id = nodeIds.get(node);
    if (id === undefined) {
      id = ++S.seq;
      nodeIds.set(node, id);
    }
    return id;
  };
  const oid = (object) => {
    if (object === null || object === undefined || (typeof object !== 'object' && typeof object !== 'function')) return null;
    let id = objIds.get(object);
    if (id === undefined) {
      id = ++S.objSeq;
      objIds.set(object, id);
    }
    return id;
  };
  const rec = (kind, data) => {
    try {
      S.log.push(Object.assign({ t: now(), kind }, data === undefined ? {} : data));
    } catch {
      /* 记账失败不影响页面 */
    }
  };
  S.nid = nid;
  S.oid = oid;
  S.rec = rec;
  S.now = now;

  /** 节点描述（只出可 JSON 化的身份 + 少量属性；绝不出节点本身）。 */
  const describe = (node) => {
    try {
      if (node === null || node === undefined) return null;
      if (node.nodeType !== 1) {
        return { id: null, nodeType: node.nodeType, text: node.nodeType === 3 ? clip(String(node.textContent || ''), 40) : null };
      }
      const attrs = {};
      for (const attribute of [...node.attributes]) {
        if (attribute.name.indexOf('data-guif') === 0 || attribute.name === 'class' || attribute.name === 'role' || attribute.name === 'aria-modal') {
          attrs[attribute.name] = clip(String(attribute.value), 100);
        }
      }
      return { id: nid(node), tag: node.tagName.toLowerCase(), connected: node.isConnected === true, attrs };
    } catch (error) {
      return { err: msgOf(error) };
    }
  };
  S.describe = describe;

  // ── A/B/C：DOM 观察器（宿主根身份 + 栈长读数 + 增删顺序）──────────────────────────────────
  const OVERLAY_WATCH = [
    'data-guif-overlay-root',
    'data-guif-overlay-layers',
    'data-guif-overlay-layer',
    'data-guif-window',
    'data-guif-state',
    'data-guif-overlay-opened',
    'data-guif-panel',
  ];

  const installObserver = () => {
    try {
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (S.mutations.length >= 1500) {
            S.mutationOverflow = true;
            return;
          }
          S.mutations.push({
            t: now(),
            kind: record.type,
            target: describe(record.target),
            attr: record.type === 'attributes' ? { name: clip(record.attributeName, 60), oldValue: clip(record.oldValue, 60) } : null,
            added: [...record.addedNodes].map(describe),
            removed: [...record.removedNodes].map(describe),
          });
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: OVERLAY_WATCH,
        attributeOldValue: true,
      });
      S.observerReady = true;
      rec('observer-installed', { at: now() });
    } catch (error) {
      S.observerReady = false;
      rec('observer-failed', { message: msgOf(error) });
    }
  };
  if (document.documentElement !== null) installObserver();
  else {
    rec('observer-deferred', {});
    document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  }

  // ── D：服务面捕获 ─────────────────────────────────────────────────────────────────────────
  /** 给 overlay 切片的 api 套壳（原方法照原样调用；只记账与抓栈）。 */
  const wrapOverlayApi = (api) => {
    if (api === null || typeof api !== 'object') return;
    try {
      if (api.__t58Wrapped === true) return;
      api.__t58Wrapped = true;
    } catch (error) {
      S.service.apiWrapFails.push({ name: 'flag', message: msgOf(error) });
      return;
    }
    S.service.apiId = oid(api);
    for (const name of ['open', 'close', 'bringToFront', 'dispose']) {
      const original = api[name];
      if (typeof original !== 'function') continue;
      const wrapped = function (...args) {
        try {
          const first = args[0];
          S.service.apiCalls.push({
            t: now(),
            name,
            argc: args.length,
            second: args.length > 1 && args[1] !== null && typeof args[1] === 'object' ? { id: clip(args[1].id, 60), family: clip(args[1].family, 20) } : null,
            stack: name === 'dispose' || name === 'close' || name === 'bringToFront' ? stackOf() : null,
          });
        } catch {
          /* 记账失败不阻断原调用 */
        }
        return original.apply(this, args);
      };
      try {
        api[name] = wrapped;
      } catch (error) {
        S.service.apiWrapFails.push({ name, message: msgOf(error) });
      }
    }
    S.service.disposeWrapped = typeof api.dispose === 'function';
  };

  /** 挂上服务实例：包 `__install`（记装配 + 给 disposer 套壳）并给 overlay 切片套壳。 */
  const attachService = (service, via) => {
    if (service === null || service === undefined) return false;
    if (S.service.instance === service) return true;
    S.service.instance = service;
    S.service.captured = true;
    S.service.via = via;
    S.service.serviceId = oid(service);
    rec('service-attached', { via, serviceId: S.service.serviceId });
    try {
      const existing = typeof service.__slice === 'function' ? service.__slice('overlay') : undefined;
      if (existing !== undefined) {
        rec('overlay-slice-already-present', { apiId: oid(existing) });
        wrapOverlayApi(existing);
      }
    } catch (error) {
      S.service.apiWrapFails.push({ name: 'pre-slice', message: msgOf(error) });
    }
    try {
      const originalInstall = service.__install;
      if (typeof originalInstall === 'function' && originalInstall.__t58 !== true) {
        const wrappedInstall = function (name, api) {
          const off = originalInstall.call(this, name, api);
          try {
            S.service.installs.push({ t: now(), name: clip(name, 40), apiId: oid(api) });
            if (name === 'overlay') wrapOverlayApi(api);
            if (typeof off === 'function' && off.__t58 !== true) {
              const wrappedOff = function () {
                S.service.sliceDisposerCalls.push({ t: now(), name: clip(name, 40), stack: stackOf() });
                return off();
              };
              wrappedOff.__t58 = true;
              return wrappedOff;
            }
          } catch (error) {
            S.service.apiWrapFails.push({ name: 'install-wrap', message: msgOf(error) });
          }
          return off;
        };
        wrappedInstall.__t58 = true;
        service.__install = wrappedInstall;
        S.service.installWrapped = true;
      }
    } catch (error) {
      S.service.apiWrapFails.push({ name: 'install-hook', message: msgOf(error) });
    }
    return true;
  };
  S.attachService = attachService;

  /** 取参的**可 JSON 化**预览（对象只摘 id/name/key/order 这类身份字段，绝不整包序列化）。 */
  const previewArg = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return clip(String(value), 60);
    const out = {};
    for (const key of ['id', 'name', 'key', 'order', 'slot', 'family']) {
      if (value[key] !== undefined) out[key] = clip(String(value[key]), 60);
    }
    return Object.keys(out).length === 0 ? { keys: Object.keys(value).slice(0, 8) } : out;
  };

  /**
   * 套壳平台 `slots` 服务：**座位注销**是「宿主整棵从 DOM 消失」的头号嫌疑之一
   * （`slots.inject(...)` 返回的 dispoer 一跑，React 就把宿主卸载掉）。
   * 只记账 + 给返回的 dispoer 套壳抓栈，不再吞掉/改写返回值。
   */
  const wrapSlots = (slots, via) => {
    if (slots === null || slots === undefined || typeof slots !== 'object' || S.slots.wrapped === true) return false;
    S.slots = { via, keys: [], calls: {}, registers: [], injects: [], disposerCalls: [] };
    try {
      for (const key of Object.keys(slots)) S.slots.keys.push(key + ':' + typeof slots[key]);
    } catch (error) {
      S.slots.keysError = msgOf(error);
    }
    for (const name of ['register', 'inject', 'unregister', 'remove', 'list', 'entries']) {
      const original = slots[name];
      if (typeof original !== 'function' || original.__t58 === true) continue;
      const wrapped = function (...args) {
        S.slots.calls[name] = (S.slots.calls[name] ?? 0) + 1;
        let result;
        try {
          result = original.apply(this, args);
        } catch (error) {
          S.slots.calls[name + 'Threw'] = clip(msgOf(error), 120);
          throw error;
        }
        try {
          if (name === 'register') S.slots.registers.push({ t: now(), arg0: previewArg(args[0]), resultType: typeof result });
          if (name === 'inject') S.slots.injects.push({ t: now(), arg0: previewArg(args[0]), arg1Type: typeof args[1] });
        } catch {
          /* 记账失败不改返回值 */
        }
        if (typeof result === 'function' && result.__t58 !== true) {
          const wrappedOff = function () {
            S.slots.disposerCalls.push({ t: now(), from: name, stack: stackOf() });
            return result();
          };
          wrappedOff.__t58 = true;
          return wrappedOff;
        }
        return result;
      };
      wrapped.__t58 = true;
      try {
        slots[name] = wrapped;
      } catch (error) {
        S.slots.calls[name + 'WrapFailed'] = clip(msgOf(error), 120);
      }
    }
    S.slots.wrapped = true;
    rec('slots-wrapped', { via, keys: S.slots.keys.slice(0, 20) });
    return true;
  };

  /** ctx 到手：立刻取服务面；拿不到就轮询（provideService 在本插件 apply 内同步发生，通常立即命中）。 */
  const captureCtx = (ctx) => {
    S.service.ctxCaptured = true;
    S.service.ctxGetErrors = [];
    const tryGet = (via) => {
      let hit = false;
      try {
        if (ctx === null || typeof ctx.get !== 'function') {
          S.service.ctxGetErrors.push({ via, message: 'ctx.get 不可用' });
          return false;
        }
        const service = ctx.get('gui-frame');
        if (service !== undefined && service !== null) hit = attachService(service, via);
      } catch (error) {
        S.service.ctxGetErrors.push({ via, message: msgOf(error) });
      }
      try {
        if (S.slots.wrapped !== true && ctx !== null && typeof ctx.get === 'function') {
          const slots = ctx.get('slots');
          if (slots !== undefined && slots !== null) wrapSlots(slots, via);
        }
      } catch (error) {
        S.slots = S.slots ?? {};
        S.slots.getError = msgOf(error);
      }
      return hit;
    };
    if (tryGet('ctx.get@apply')) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tryGet('ctx.get@poll') || tries >= 40) clearInterval(timer);
    }, 50);
  };

  /** 兜底：从 React fiber 里找「带 __slices 的对象」（万一 loader 拦不住、拿不到 ctx）。 */
  S.tryFiberService = () => {
    try {
      if (S.service.captured) return true;
      const seen = new Set();
      const queue = [];
      for (const el of document.querySelectorAll('[data-guif-panel],[data-guif-demo-section],[data-guif-overlay-root],[data-guif-glyph]')) {
        const key = Object.keys(el).find((name) => name.indexOf('__reactFiber$') === 0);
        if (key !== undefined) queue.push(el[key]);
      }
      let hops = 0;
      while (queue.length > 0 && hops < 4000) {
        hops += 1;
        const fiber = queue.pop();
        if (fiber === null || fiber === undefined || seen.has(fiber)) continue;
        seen.add(fiber);
        for (const bag of [fiber.memoizedProps, fiber.memoizedState]) {
          if (bag === null || bag === undefined || typeof bag !== 'object') continue;
          for (const key of Object.keys(bag)) {
            const value = bag[key];
            if (value !== null && typeof value === 'object' && typeof value.__slices === 'function') {
              S.service.fiberHits = (S.service.fiberHits ?? []).concat([{ key, hops }]);
              return attachService(value, 'fiber:' + key);
            }
          }
        }
        if (fiber.return !== null && fiber.return !== undefined) queue.push(fiber.return);
        if (fiber.child !== null && fiber.child !== undefined) queue.push(fiber.child);
        if (fiber.sibling !== null && fiber.sibling !== undefined) queue.push(fiber.sibling);
      }
    } catch (error) {
      rec('fiber-probe-failed', { message: msgOf(error) });
    }
    return false;
  };

  // ── E：loader 捕获（三路并记）──────────────────────────────────────────────────────────────
  //
  // 平台机制（实读 `@deepseek-ai/dsh-client-modules/lib/client.js`）：引导期 `window.__ModuleLoader__`
  // 是**队列态门面** `{mode:'queue', pendingQueue:[], load(reg){pendingQueue.push(reg)}, create}`；
  // 运行时模块启动时 `mode='live'` 并把**同一个对象**的 `load` **换成**自己的 `register`（源码 :223-226）。
  // ⇒ 引导之后再套壳才有用（第一轮就是被这次替换顶掉的：`loads` 里只剩运行时模块一条）。
  const patchLoader = (loader, how) => {
    if (loader === null || typeof loader !== 'object') return false;
    if (typeof loader.load !== 'function' || loader.load.__t58 === true) return false;
    try {
      const originalLoad = loader.load.bind(loader);
      const wrappedLoad = (entry) => {
        try {
          const id = entry !== null && typeof entry === 'object' ? clip(String(entry.id), 80) : clip(String(entry), 80);
          S.loader.loads.push({ t: now(), id, hasFactory: entry !== null && typeof entry === 'object' && typeof entry.factory === 'function', how });
          if (entry !== null && typeof entry === 'object' && entry.id === 'dsh-gui-frame' && typeof entry.factory === 'function') {
            const factory = entry.factory;
            entry.factory = (require) => {
              const mod = factory(require);
              S.loader.factorySeen.push({ t: now(), id, hasApply: mod !== null && typeof mod === 'object' && typeof mod.apply === 'function' });
              try {
                if (mod !== null && typeof mod === 'object' && typeof mod.apply === 'function' && mod.apply.__t58 !== true) {
                  const originalApply = mod.apply;
                  const wrappedApply = function (ctx) {
                    S.loader.applyCalls += 1;
                    rec('apply-captured', { calls: S.loader.applyCalls, ctxUsable: ctx !== null && ctx !== undefined && typeof ctx.get === 'function' });
                    try {
                      captureCtx(ctx);
                    } catch (error) {
                      rec('capture-ctx-failed', { message: msgOf(error) });
                    }
                    return originalApply.call(this, ctx);
                  };
                  wrappedApply.__t58 = true;
                  mod.apply = wrappedApply;
                }
              } catch (error) {
                rec('apply-wrap-failed', { message: msgOf(error) });
              }
              return mod;
            };
          }
        } catch (error) {
          rec('load-wrap-error', { message: msgOf(error) });
        }
        return originalLoad(entry);
      };
      wrappedLoad.__t58 = true;
      loader.load = wrappedLoad;
      loader.__t58 = true;
      S.loader.wrappedAt = how;
      rec('loader-wrapped', { how, at: now() });
      return true;
    } catch (error) {
      rec('loader-wrap-failed', { how, message: msgOf(error) });
      return false;
    }
  };

  if (window.__ModuleLoader__ !== undefined) patchLoader(window.__ModuleLoader__, 'immediate');
  else {
    let real;
    try {
      Object.defineProperty(window, '__ModuleLoader__', {
        configurable: true,
        get() {
          return real;
        },
        set(value) {
          S.loader.setterFired = true;
          rec('loader-setter-fired', { at: now() });
          real = value;
          patchLoader(value, 'setter');
        },
      });
    } catch (error) {
      rec('defineProperty-failed', { message: msgOf(error) });
    }
    // 真外壳若用 Object.defineProperty 直接定义（会顶掉上面的 setter），这条路要能看见
    try {
      const originalDefineProperty = Object.defineProperty;
      Object.defineProperty = function (target, property, descriptor) {
        const result = originalDefineProperty.call(Object, target, property, descriptor);
        try {
          if (target === window && property === '__ModuleLoader__') {
            S.loader.definePropertyHookFired = true;
            rec('defineProperty-hook-fired', { at: now() });
            patchLoader(window.__ModuleLoader__, 'defineProperty-hook');
          }
        } catch {
          /* 钩子记账失败不影响定义结果 */
        }
        return result;
      };
    } catch (error) {
      rec('defineProperty-hook-failed', { message: msgOf(error) });
    }
  }
  // 兜底轮询：上面两路都没赶在 `load()` 之前生效时，至少把「什么时候才拿到 loader」记清楚。
  // ⚠ 实测（第一轮）：setter 确实触发过，但**只见到 1 次 `load()`（@deepseek-ai/dsh-client-modules）**，
  //   本插件那条 entry 没经过这里 ⇒ 真外壳会在引导之后**换掉 `loader.load`**（把我们的壳顶掉）。
  //   所以这里每一拍都要复核「壳还在不在」，被顶掉就重新套上（每次重套都记账：它本身就是「loader 被换过」的证据）。
  let polls = 0;
  let repatches = 0;
  const poll = setInterval(() => {
    polls += 1;
    try {
      const loader = window.__ModuleLoader__;
      if (loader !== undefined && loader !== null) {
        // 每一拍都复核「壳还在不在」：运行时启动时会把 `load` 换成自己的 `register`（实读源码 :223），
        // 那次替换就是第一轮漏掉本插件 entry 的原因；重套次数本身就是「loader 被换过」的证据。
        if (patchLoader(loader, 'repatch@' + polls)) {
          repatches += 1;
          S.loader.repatchCount = repatches;
        }
      }
      if (!S.service.captured) S.tryFiberService();
    } catch (error) {
      rec('poll-failed', { message: msgOf(error) });
    }
    if (polls > 2400) clearInterval(poll);
  }, 50);

  // ── G：指针/键盘事件记账（判「点外关闭」这类由真实指针触发的路径）──────────────────────────────
  S.events = [];
  for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) {
    document.addEventListener(type, (event) => {
      try {
        if (S.events.length >= 400) return;
        S.events.push({
          t: now(),
          type,
          key: event.key === undefined ? null : clip(String(event.key), 20),
          target: describe(event.target),
          x: typeof event.clientX === 'number' ? event.clientX : null,
          y: typeof event.clientY === 'number' ? event.clientY : null,
        });
      } catch {
        /* 记账失败不影响事件 */
      }
    }, true);
  }

  // ── A/B：采样器 ────────────────────────────────────────────────────────────────────────────
  /** 一次采样：根身份 + 栈长读数 + 父链 + 窗口/层锚点 + 服务面切片事实。 */
  S.sample = (label) => {
    try {
      const roots = [...document.querySelectorAll('[data-guif-overlay-root]')];
      const current = roots.length === 0 ? null : roots[0];
      if (current !== null && S.rootRef === undefined) S.rootRef = current;
      const parentChain = [];
      if (current !== null) {
        let node = current.parentElement;
        let depth = 0;
        while (node !== null && depth < 6) {
          parentChain.push(describe(node));
          node = node.parentElement;
          depth += 1;
        }
      }
      const sample = {
        t: now(),
        label: label === undefined ? null : clip(String(label), 60),
        rootCount: roots.length,
        rootIds: roots.map((node) => nid(node)),
        currentRootId: current === null ? null : nid(current),
        refRootId: S.rootRef === undefined || S.rootRef === null ? null : nid(S.rootRef),
        refRootConnected: S.rootRef === undefined || S.rootRef === null ? null : S.rootRef.isConnected === true,
        refRootInDocument: S.rootRef === undefined || S.rootRef === null ? null : document.contains(S.rootRef),
        refRootChildren: S.rootRef === undefined || S.rootRef === null ? null : S.rootRef.children.length,
        rootChildren: current === null ? null : current.children.length,
        rootLayers: current === null ? null : clip(current.getAttribute('data-guif-overlay-layers'), 20),
        rootPointerEvents: current === null ? null : clip(getComputedStyle(current).pointerEvents, 20),
        layerAnchors: [...document.querySelectorAll('[data-guif-overlay-layer]')].map((el) => clip(String(el.getAttribute('data-guif-overlay-layer')), 60)),
        windows: [...document.querySelectorAll('[data-guif-window]')].map((el) => clip(String(el.getAttribute('data-guif-window')), 60)),
        zList: [...document.querySelectorAll('[data-guif-z]')].map((el) => Number(el.getAttribute('data-guif-z'))),
        dialogAtoms: document.querySelectorAll('[role="dialog"],[aria-modal="true"]').length,
        panelCount: document.querySelectorAll('[data-guif-panel]').length,
        sectionMarks: [...document.querySelectorAll('[data-guif-demo-section]')].map((el) => clip(String(el.getAttribute('data-guif-demo-section')), 30)),
        demoOpen: [...document.querySelectorAll('[data-guif-demo-open]')].map((el) => clip(String(el.getAttribute('data-guif-demo-open')), 30)),
        demoActions: [...document.querySelectorAll('[data-guif-action]')].map((el) => clip(String(el.getAttribute('data-guif-action')), 40)),
        panelText: clip(String((document.querySelector('[data-guif-panel]') || {}).innerText || '').replace(/\s+/g, ' '), 220),
        openedRows: [...document.querySelectorAll('[data-guif-overlay-opened] dt, [data-guif-overlay-opened] dd')].map((el) => clip(String(el.textContent), 90)),
        bodyChildren: document.body === null ? null : document.body.children.length,
        bodyTextLen: String((document.body && document.body.innerText) || '').length,
        rootParentChain: parentChain,
        service: S.serviceFacts(),
      };
      if (S.samples.length < 1500) S.samples.push(sample);
      else S.sampleOverflow = true;
      return sample;
    } catch (error) {
      rec('sample-failed', { message: msgOf(error) });
      return { t: now(), error: msgOf(error) };
    }
  };

  /** 服务面事实（不返回对象本体，只返回可 JSON 化的形状）。 */
  S.serviceFacts = () => {
    const out = {
      captured: S.service.captured === true,
      via: S.service.via,
      serviceId: S.service.serviceId === undefined ? null : S.service.serviceId,
      installs: S.service.installs.map((row) => ({ t: row.t, name: row.name, apiId: row.apiId })),
      sliceDisposerCalls: S.service.sliceDisposerCalls.length,
      apiCalls: S.service.apiCalls.length,
      disposeWrapped: S.service.disposeWrapped === true,
    };
    try {
      const service = S.service.instance;
      if (service !== null && service !== undefined && typeof service.__slices === 'function') {
        out.slices = service.__slices();
        const api = typeof service.__slice === 'function' ? service.__slice('overlay') : undefined;
        out.apiPresent = api !== undefined && api !== null;
        out.apiId = api === undefined || api === null ? null : oid(api);
      }
    } catch (error) {
      out.error = msgOf(error);
    }
    return out;
  };

  let sampler = null;
  S.startSampler = (intervalMs) => {
    if (sampler !== null) clearInterval(sampler);
    sampler = setInterval(() => S.sample('tick'), intervalMs === undefined ? 120 : intervalMs);
    return true;
  };
  S.stopSampler = () => {
    if (sampler !== null) clearInterval(sampler);
    sampler = null;
    return true;
  };
  S.startSampler(120);

  // ── F：反假绿自证 ─────────────────────────────────────────────────────────────────────────
  /**
   * 人为制造一次「根节点从文档里消失」，断言采样器与 observer 都能看见。
   * 优先拿真根节点；没有的话造一根同锚点的假根。返回 { mode, before, after, mutationsSeen, detected }。
   * ⚠ 必须等一拍再判：MutationObserver 的回调是**微任务**，同步采样时记录还没送达（第一轮踩过假失败）。
   */
  S.selftest = async () => {
    const before = S.sample('selftest-before');
    const baseline = S.mutations.length;
    let node = document.querySelector('[data-guif-overlay-root]');
    let mode = 'real-root';
    let injected = null;
    if (node === null) {
      mode = 'injected-root';
      injected = document.createElement('div');
      injected.setAttribute('data-guif-overlay-root', '');
      injected.setAttribute('data-guif-overlay-layers', '0');
      document.body.appendChild(injected);
      node = injected;
    }
    const targetId = nid(node);
    const parent = node.parentNode;
    if (parent !== null) parent.removeChild(node);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = S.sample('selftest-after');
    const seen = S.mutations.slice(baseline).filter((row) => (row.removed || []).some((item) => item !== null && item.id === targetId));
    const result = {
      mode,
      detected: after.rootCount === 0 && seen.length >= 1,
      targetId,
      beforeRootCount: before.rootCount,
      afterRootCount: after.rootCount,
      mutationsSeen: seen.length,
      refRootConnectedAfter: after.refRootConnected,
    };
    if (mode === 'injected-root' && injected !== null) {
      // 清掉自证用的假节点（若真根不存在，留着会污染后续采样）
      try {
        injected.remove();
      } catch {
        /* 已移除 */
      }
    } else if (mode === 'real-root' && parent !== null) {
      // 真根：移回去，避免后续步骤（如再点一次）因宿主被拆而失去意义
      try {
        parent.appendChild(node);
      } catch (error) {
        rec('selftest-restore-failed', { message: msgOf(error) });
      }
    }
    S.selftest = result;
    rec('selftest', result);
    return result;
  };

  /** 直接叫服务面开一层（绕开 demo 的 React 状态更新）—— 二分「demo 渲染路径」vs「overlay/dialog 路径」。 */
  S.openDirect = (spec) => {
    try {
      const service = S.service.instance;
      if (service === null || service === undefined) return { ok: false, reason: 'no-service' };
      if (typeof service.overlay !== 'object' || service.overlay === null || typeof service.overlay.open !== 'function') return { ok: false, reason: 'no-overlay-face' };
      const handle = service.overlay.open(spec);
      return { ok: true, id: handle === null || handle === undefined ? null : handle.id, z: handle === null || handle === undefined ? null : handle.z, family: handle === null || handle === undefined ? null : handle.family };
    } catch (error) {
      return { ok: false, reason: 'threw', message: msgOf(error), code: String((error && error.code) || '') };
    }
  };

  /** loader 形状（诊断用：真外壳把自己怎么挂的、被谁顶掉，都记下来）。 */
  S.loaderShape = () => {
    try {
      const loader = window.__ModuleLoader__;
      if (loader === undefined || loader === null) return { present: false };
      const shape = { present: true, type: typeof loader, keys: [], methods: {}, loadIsWrapped: loader.load !== undefined && loader.load.__t58 === true };
      for (const key of Object.keys(loader)) {
        const value = loader[key];
        shape.keys.push(key);
        shape.methods[key] = typeof value === 'function' ? 'function/' + (value.__t58 === true ? 'wrapped' : 'plain') : typeof value;
      }
      const proto = Object.getPrototypeOf(loader);
      shape.protoKeys = proto === null ? [] : Object.getOwnPropertyNames(proto).slice(0, 40);
      return shape;
    } catch (error) {
      return { present: false, error: msgOf(error) };
    }
  };

  /** 页面自己加载过的脚本 URL（bundle 前置闸：确认跑的是哪一版产物）。 */
  S.scripts = () => {
    try {
      return [...document.querySelectorAll('script[src]')].map((el) => clip(String(el.src), 200));
    } catch (error) {
      return [msgOf(error)];
    }
  };

  /** 全量读数（只出可 JSON 化的字段；绝不返回 ctx / service 本体）。 */
  S.dump = () => {
    try {
      const rootNow = document.querySelector('[data-guif-overlay-root]');
      return {
        version: S.version,
        t0: S.t0,
        observerReady: S.observerReady === true,
        loader: {
          setterFired: S.loader.setterFired,
          definePropertyHookFired: S.loader.definePropertyHookFired,
          pollWrapped: S.loader.pollWrapped,
          wrappedAt: S.loader.wrappedAt,
          repatchCount: S.loader.repatchCount ?? 0,
          shape: S.loaderShape(),
          scripts: S.scripts(),
          loads: S.loader.loads,
          factorySeen: S.loader.factorySeen,
          applyCalls: S.loader.applyCalls,
        },
        service: Object.assign(S.serviceFacts(), {
          ctxCaptured: S.service.ctxCaptured === true,
          installWrapped: S.service.installWrapped === true,
          installs: S.service.installs,
          sliceDisposerCalls: S.service.sliceDisposerCalls,
          apiCalls: S.service.apiCalls,
          apiWrapFails: S.service.apiWrapFails,
          ctxGetErrors: S.service.ctxGetErrors,
          fiberHits: S.service.fiberHits ?? null,
        }),
        slots: S.slots ?? null,
        finalDom: rootNow === null ? null : describe(rootNow),
        events: S.events,
        samples: S.samples,
        sampleOverflow: S.sampleOverflow,
        mutations: S.mutations,
        mutationOverflow: S.mutationOverflow,
        log: S.log,
        notes: S.notes,
        errors: S.errors,
        selftest: S.selftest,
      };
    } catch (error) {
      return { dumpFailed: msgOf(error), log: S.log.slice(-50) };
    }
  };

  rec('instrument-ready', { at: now(), hasModuleLoader: window.__ModuleLoader__ !== undefined });
})();
