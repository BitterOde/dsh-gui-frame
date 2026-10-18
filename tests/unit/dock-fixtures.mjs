/**
 * dock-fixtures.mjs —— 坞与面板用例共用的**测试替身**（单元 / 负控 / 探针）。
 *
 * 替身的纪律（与 tests/helpers/fake-ctx.mjs 的头部约定一致）：
 *  - `inject / register` 的**记录**复用 `createFakeSlots()`（`injected` / `registered` 两个数组是
 *    唯一真源）——这里只**补齐**官方语义（声明表、四种 kind 的注册约束、`entries/entriesOfSlot`、
 *    `subscribe`），不另造第二套记录；
 *  - `createFakeLayout` 的 `selectPanel` 是官方 `LayoutController` 的**逐字转写**（见函数头引注）；
 *  - ⚠ 本文件**不是**产品代码，任何「官方行为」的断言都必须能指到一条实读证据（下面每条都带）。
 *
 * 本文件**零副作用**：只造对象，不写盘、不联网、不起服务。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFakeCtx, createFakeSlots } from '../helpers/fake-ctx.mjs';
import { createFakeReact } from '../helpers/fake-react.mjs';
import { GuiFrameService } from '../../src/client/service.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 包根 `dsh-gui-frame/`。 */
export const PKG_DIR = path.resolve(HERE, '..', '..');
export const SRC_CLIENT_DIR = path.join(PKG_DIR, 'src', 'client');

/** 官方四种 kind 的注册约束（`SlotCore.register`，逐字实读）。 */
export function assertRegisterable(options, declarations) {
  const name = options === null || typeof options !== 'object' ? undefined : options.name;
  const spec = declarations.get(name);
  if (spec === undefined) {
    throw new Error(`slot "${name}" is not declared (a parent entry's children table must declare it)`);
  }
  const priority = Number.isInteger(options.priority) ? options.priority : 0;
  if (options.priority !== undefined && !Number.isInteger(options.priority)) {
    throw new Error(`slot "${name}" priority must be an integer`);
  }
  if (spec.kind === 'keyed' && (typeof options.key !== 'string' || options.key === '')) {
    throw new Error(`keyed slot "${name}" requires options.key`);
  }
  if (spec.kind === 'list' && (typeof options.id !== 'string' || options.id === '')) {
    throw new Error(`list slot "${name}" requires options.id`);
  }
  if (spec.kind === 'chain' && typeof options.select !== 'function') {
    throw new Error(`chain slot "${name}" requires options.select`);
  }
  return { spec, priority };
}

/** 一个 entry 的 cell 键（single→整槽 / keyed→key / list→id / chain→无 cell）。 */
export function cellOf(options, kind) {
  if (kind === 'keyed') return options.key;
  if (kind === 'list') return options.id;
  return '*';
}

/**
 * 造一个**更接近官方**的假座位服务。
 *
 * 官方语义（`dsh-client-ui-renderer/lib/types/client/registry.d.ts` L85-100 原文）：
 *  - `inject(key, cb)`：声明已存在 ⇒ **同步**跑 cb；否则等声明提交后再跑；
 *    **声明崩塌会 dispose effect，之后再声明会重跑**；
 *  - 直接 `register` 到未声明槽位 ⇒ **同步抛**。
 * 本替身把这两条都实现出来（`declare(key, spec)` / `undeclare(key)` 模拟官方 owner 的挂载与卸载）。
 */
export function createSlotRegistry() {
  const base = createFakeSlots();
  const declarations = new Map();
  const listeners = new Map();
  const waiters = [];
  const abdicated = new Set();

  const notify = (key) => {
    for (const fn of [...(listeners.get(key) ?? [])]) {
      try {
        fn();
      } catch {
        // 订阅者抛错不连坐（官方 notifyDeclaration 语义）
      }
    }
  };

  const slots = {
    /** 声明一个座位（官方由 client-ui-sidebar / client-ui-layout 的 children 表声明）。 */
    declare(key, spec) {
      declarations.set(key, spec);
      notify(key);
      for (const waiter of [...waiters]) {
        if (waiter.key !== key) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.activate();
      }
      return () => {
        slots.undeclare(key);
      };
    },
    /** 声明崩塌（官方 owner 卸载）：已跑的 inject effect 被 dispose，注册随之消失。 */
    undeclare(key) {
      declarations.delete(key);
      for (const waiter of [...waiters]) {
        if (waiter.key !== key) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.deactivate();
      }
      for (const row of [...base.registered]) {
        if (row.options.name === key) {
          const index = base.registered.indexOf(row);
          if (index >= 0) base.registered.splice(index, 1);
        }
      }
      notify(key);
      return true;
    },
    inject(key, callback) {
      base.injected.push({ key });
      const waiter = { key, activate: null, deactivate: null };
      waiter.activate = () => {
        const disposer = callback();
        waiter.deactivate = typeof disposer === 'function' ? disposer : () => {};
        waiter.active = true;
      };
      if (declarations.has(key)) {
        waiter.activate();
        return () => {
          waiter.deactivate();
          waiter.active = false;
        };
      }
      waiters.push(waiter);
      return () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        if (waiter.active === true) waiter.deactivate();
        waiter.active = false;
      };
    },
    register(options, component) {
      const { priority } = assertRegisterable(options, declarations);
      const kind = declarations.get(options.name).kind;
      const cell = cellOf(options, kind);
      const clash = kind === 'single'
        ? base.registered.some((row) => row.options.name === options.name && (row.options.priority ?? 0) === priority)
        : base.registered.some((row) => row.options.name === options.name && cellOf(row.options, kind) === cell && (row.options.priority ?? 0) === priority);
      if (clash) {
        throw new Error(`${kind} slot "${options.name}" already has a registration at priority ${priority} (lowest renders)`);
      }
      const dispose = base.slots.register(options, component);
      notify(options.name);
      return () => {
        dispose();
        notify(options.name);
      };
    },
    /** 原始视图（官方：`entries(key)`）—— 渲染无关，稳定引用。 */
    entries(key) {
      return base.registered.filter((row) => row.options.name === key).map((row) => ({
        options: row.options,
        component: row.component,
      }));
    },
    /** 每个 cell 的**遮蔽赢家**（官方：`entriesOfSlot(key)`；priority 小的赢）。 */
    entriesOfSlot(key) {
      const kind = declarations.get(key)?.kind ?? 'list';
      const live = base.registered.filter((row) => row.options.name === key && !abdicated.has(row));
      const winners = new Map();
      for (const row of live) {
        const cell = cellOf(row.options, kind);
        const current = winners.get(cell);
        if (current === undefined || (row.options.priority ?? 0) < (current.options.priority ?? 0)) winners.set(cell, row);
      }
      return [...winners.values()].map((row) => ({ options: row.options, component: row.component }));
    },
    subscribe(key, fn) {
      const list = listeners.get(key) ?? [];
      list.push(fn);
      listeners.set(key, list);
      return () => {
        const current = listeners.get(key) ?? [];
        const index = current.indexOf(fn);
        if (index >= 0) current.splice(index, 1);
      };
    },
    /** 测试钩子：把某个 entry 标成 abdicated（官方崩溃退位），用于 `entriesOfSlot` 的遮蔽断言。 */
    __abdicate(row) {
      abdicated.add(row);
    },
  };

  return {
    slots,
    declarations,
    injected: base.injected,
    registered: base.registered,
    notify,
    /** 造齐本包需要的两个座位（官方由 sidebar / layout 两个 owner 声明）。 */
    declareConsumed() {
      slots.declare('sidebar.panellist', { kind: 'list', scope: 'root' });
      slots.declare('main', { kind: 'keyed', scope: 'root' });
      return slots;
    },
  };
}

/**
 * 假 `ctx.layout`：`selectPanel` 是官方 `LayoutController.selectPanel` 的**逐字转写**。
 *
 * 实读证据：`…/dsh-client-ui-layout/lib/client.js`，偏移 ≈18107：
 * ```js
 * selectPanel(panelId) {
 *   if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
 *   this.navigation.abort();
 *   this.panels.selectPanel(panelId);
 * }
 * ```
 * 其中 `hasMainPanel` ＝ `(id) => ctx.slots.entries("main").some((entry) => entry.options.key === id)`
 * （同文件 `provideRoot` 处，偏移 ≈22794）。
 *
 * ⇒ 这不是「替身自己定的规矩」，而是把官方那两行搬过来 —— 所以负控用例证明的是
 *   「成对注册」这件事本身，而不是「替身恰好会抛」。
 */
export function createFakeLayout(slots) {
  const controller = {
    activePanelId: null,
    /** 官方 `hasMainPanel` 的逐字等价（读的是**实时** entries，不是缓存）。 */
    hasMainPanel(id) {
      return slots.entries('main').some((entry) => entry.options.key === id);
    },
    selectPanel(panelId) {
      if (panelId !== null && !controller.hasMainPanel(panelId)) {
        throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
      }
      controller.activePanelId = panelId;
      return undefined;
    },
    toggleSidebar() {
      return undefined;
    },
  };
  return controller;
}

/** 常见的面板行 owner props（官方 `sidebar.panellist` ownerProps：`{size, active}`）。 */
export function panellistOwnerProps(active = false, size = 18) {
  return { size, active };
}

/** 假 primitives 种子：**只给官方真实用过的成员**，每个组件渲染一个带锚点的 span。 */
export function createFakePrimitives(react) {
  const names = [
    'Button',
    'IconChevronRightOutlineRegular',
    'IconCloseOutlineRegular',
    'IconLoadingOutlineRegular',
    'IconRefreshOutlineRegular',
    'IconWarningOutlineRegular',
    'Tag',
    'Tooltip',
  ];
  const seed = {};
  for (const name of names) {
    seed[name] = function FakePrimitive(props) {
      const { children, ...rest } = props ?? {};
      const style = rest.style;
      const safe = {};
      for (const [key, value] of Object.entries(rest)) {
        if (key === 'icon' || key === '$typeof' || typeof value === 'function') continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
      }
      return react.createElement('span', { ...safe, 'data-guif-prim': name, style }, children ?? null);
    };
  }
  return seed;
}

/** 本包坞/面板要用的种子表（react + primitives；store 故意不给，走自研最小 store）。 */
export function createDockSeeds(options = {}) {
  const react = options.react ?? createFakeReact();
  return {
    react,
    primitives: options.primitives === null ? undefined : (options.primitives ?? createFakePrimitives(react)),
    store: options.store ?? undefined,
  };
}

/**
 * 一整套坞测试台：假座位服务 + 假 layout + 假 ctx + **真** `ctx.gui-frame` 服务。
 * @param {{react?:object, primitives?:object, declare?:boolean}} [options]
 */
export function createDockHarness(options = {}) {
  const registry = createSlotRegistry();
  if (options.declare !== false) registry.declareConsumed();
  const layout = createFakeLayout(registry.slots);
  const fake = createFakeCtx({ services: { slots: registry.slots, layout } });
  const service = new GuiFrameService(fake.ctx);
  const seeds = createDockSeeds(options);
  return {
    registry,
    slots: registry.slots,
    declarations: registry.declarations,
    injected: registry.injected,
    registered: registry.registered,
    layout,
    ctx: fake.ctx,
    ctxInternals: fake,
    service,
    seeds,
    env: { service, seeds },
  };
}

/** 从 `registered` 里取某个座位上的全部注册选项。 */
export function optionsOn(registered, slotKey) {
  return registered.filter((row) => row.options.name === slotKey).map((row) => row.options);
}

/** 从 `registered` 里取某个座位上的（唯一）占用组件。 */
export function componentOn(registered, slotKey, cellKey, cellField = 'id') {
  const row = registered.find((entry) => entry.options.name === slotKey && entry.options[cellField] === cellKey);
  return row === undefined ? null : row.component;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 平台只读定位（A18 的探针用；**只读**：不写 profile、不起服务、不碰 3080 上正在跑的 GUI）
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * 定位本机 DSH 安装目录（顺序：`DSH_INSTALL_DIR` → `%APPDATA%/npm/…` → 本包 devDeps 里的 junction 反推）。
 * 与 `probe/runtime/platform.mjs#resolveDshInstallDir` 同一口径（探针侧已用过，口径一致才不会各说各话）。
 * @returns {string|null} 找不到返回 null（探针据此 skip 并写明原因）
 */
export function resolveDshInstallDir() {
  const candidates = [];
  if (process.env.DSH_INSTALL_DIR) candidates.push(process.env.DSH_INSTALL_DIR);
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
  }
  try {
    const require = createRequire(import.meta.url);
    return path.resolve(path.dirname(require.resolve('@deepseek-ai/cordis/package.json')), '..', '..', '..', '..');
  } catch {
    return null;
  }
}

/** 读一个官方包的文件（只读；不存在返回 null）。 */
export function readPlatformFile(relPath) {
  const root = resolveDshInstallDir();
  if (root === null) return null;
  const file = path.join(root, 'node_modules', '@deepseek-ai', relPath);
  if (!existsSync(file)) return null;
  return { file, text: readFileSync(file, 'utf8') };
}
