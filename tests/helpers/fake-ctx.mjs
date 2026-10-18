/**
 * fake-ctx.mjs —— 假 Cordis ctx（测试层无真平台；家族同形，L0/L1/L3 层共用）。
 *
 * 形状对齐 `@deepseek-ai/cordis` 的公开面：
 *   `ctx.get(name)`（缺服务返回 undefined，不抛）/ `ctx.provide(name, value)`（返回 disposer）/
 *   `ctx.inject(names, cb)`（依赖齐了才回调，缺则挂起，补齐后自动回调——家族线上事故面）/
 *   `ctx.effect(fn[, label])`（返回 disposer）/ `ctx.on(event, handler)` + `ctx.emit(event, …)` /
 *   `ctx.logger`（既可 `ctx.logger.info(…)`，也可 `ctx.logger('名字').info(…)`）。
 *
 * 客户端半区另配 `createFakeSlots()`：`slots.inject(key, cb)` 立即回调并记录，
 * `slots.register(options, component)` 记录并返回 disposer。
 * ⚠ 这是**最小替身**：坞与面板若需要 keys/entries/owners 等面，在本文件上扩，
 *   不要在测试里另造第二份替身（两份替身必然漂移）。
 */

/** 造一个"什么都没有"的 logger 收集器。 */
function createLogSink(sink) {
  const push = (level) => (message, ...rest) => {
    sink.push({ level, message: String(message), rest });
    return undefined;
  };
  return { info: push('info'), warn: push('warn'), error: push('error'), debug: push('debug') };
}

/**
 * @param {{services?:Record<string, unknown>, sessionId?:string, loggerName?:string}} [options]
 * @returns {{ctx:object, provided:Map<string,unknown>, logs:object[], calls:object,
 *   effects:Array<{label:string|null, disposer:Function|null}>, events:Map<string,Function[]>,
 *   pendingInjects:Array<object>, flushInjects:Function, emit:Function, dispose:Function}}
 */
export function createFakeCtx(options = {}) {
  const provided = new Map(Object.entries(options.services ?? {}));
  const logs = [];
  const calls = { get: [], provide: [], inject: [], effect: [], on: [] };
  const effects = [];
  const events = new Map();
  const pendingInjects = [];

  const loggerRoot = createLogger(options.loggerName);
  /** `ctx.logger` 既可当对象用（`ctx.logger.info(...)`），也可当函数用（`ctx.logger('名字')`）。 */
  function createLogger(name) {
    const named = (scope) => createLogger(scope);
    const sink = createLogSink(logs);
    named.info = sink.info;
    named.warn = sink.warn;
    named.error = sink.error;
    named.debug = sink.debug;
    Object.defineProperty(named, 'name', { value: name ?? options.loggerName ?? 'gui-frame', configurable: true });
    return named;
  }

  const ctx = {
    get sessionId() {
      return options.sessionId ?? 'session-1';
    },
    logger: loggerRoot,
    get(name) {
      calls.get.push(name);
      return provided.get(name);
    },
    provide(name, value) {
      calls.provide.push(name);
      provided.set(name, value);
      runPendingInjects();
      return () => {
        if (provided.get(name) === value) provided.delete(name);
      };
    },
    inject(names, callback) {
      const list = Array.isArray(names) ? [...names] : [names];
      calls.inject.push(list);
      const entry = { names: list, callback, done: false };
      pendingInjects.push(entry);
      runPendingInjects(); // 依赖已齐 ⇒ 立刻回调并摘除；未齐 ⇒ 留在队列里等 provide 补齐
      return () => {
        const index = pendingInjects.indexOf(entry);
        if (index >= 0) pendingInjects.splice(index, 1);
      };
    },
    effect(fn, label = null) {
      calls.effect.push(label);
      const disposer = typeof fn === 'function' ? fn() : undefined;
      const record = { label, disposer: typeof disposer === 'function' ? disposer : null };
      effects.push(record);
      return record.disposer ?? (() => {});
    },
    on(event, handler, label = null) {
      calls.on.push(label);
      const list = events.get(event) ?? [];
      list.push(handler);
      events.set(event, list);
      return () => {
        const current = events.get(event) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      };
    },
    emit(event, ...args) {
      const list = [...(events.get(event) ?? [])];
      const results = [];
      for (const handler of list) results.push(handler(...args));
      return results;
    },
  };

  /** 依赖齐了的挂起 inject 立刻回调（Cordis 的重新激活语义）。 */
  function runPendingInjects() {
    for (const entry of [...pendingInjects]) {
      if (entry.done) continue;
      if (!entry.names.every((name) => provided.has(name))) continue;
      entry.done = true;
      pendingInjects.splice(pendingInjects.indexOf(entry), 1);
      entry.callback(ctx);
    }
  }

  return {
    ctx,
    provided,
    logs,
    calls,
    effects,
    events,
    pendingInjects,
    /** 手动把挂起的 inject 全部跑掉（不给依赖的用例用）。 */
    flushInjects() {
      for (const entry of [...pendingInjects]) {
        entry.done = true;
        pendingInjects.splice(pendingInjects.indexOf(entry), 1);
        entry.callback(ctx);
      }
      return this;
    },
    /** 按注册顺序跑掉全部 effect disposer（模拟卸载）。 */
    dispose() {
      const rows = effects.splice(0);
      for (const row of rows) if (typeof row.disposer === 'function') row.disposer();
      return rows.length;
    },
    emit: ctx.emit,
  };
}

/**
 * 客户端半区用的假 `ctx.slots`（组件与装配测试）。
 * @returns {{slots:object, injected:Array<{key:string}>, registered:Array<{options:object, component:Function}>}}
 */
export function createFakeSlots() {
  const injected = [];
  const registered = [];
  return {
    injected,
    registered,
    slots: {
      inject(key, callback) {
        injected.push({ key });
        return callback();
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {
          const index = registered.findIndex((row) => row.options === options && row.component === component);
          if (index >= 0) registered.splice(index, 1);
        };
      },
    },
  };
}
