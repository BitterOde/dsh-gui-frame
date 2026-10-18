/**
 * index.mjs —— **面板骨架**（能力②）的装配入口。
 *
 * 装配契约 v1：`install(ctx, env)`，`env = { service, seeds }`（只增不改不删）。
 * 本文件做两件事，副作用**全部**经 `ctx.effect` 挂在**调用方** fiber 上：
 *   ① 造六个复合组件（`createComponents(env)`，纯闭包，无副作用）；
 *   ② 用冻结名逐个 `service.components.register(name, Component)` 登记
 *      （`components.register` 内部已经按调用方 fiber 记 effect，本文件再包一层 ctx.effect 是为了
 *      「install 的每一条副作用都能在调用方 fiber 的 effect 表里被看见/被一次性撤掉」）。
 *
 * 不做什么：**不注册座位**（座位属于坞＝能力①，见 `src/client/dock.mjs`）；不改 `entry.mjs`。
 */

import { COMPONENT_NAMES } from '../contracts/components.mjs';
import { createComponents } from './components.mjs';

/** 本能力对外登记的名字（＝冻结的六个复合组件名；顺序即登记顺序）。 */
export const PANEL_COMPONENT_NAMES = COMPONENT_NAMES;

/** 装配结果形状（`installed=false` 时 `reason` 说明为什么没装 —— 绝不静默半装）。 */
function result(installed, reason, extra) {
  return { capability: 'panel', installed, reason, ...(extra ?? {}) };
}

/**
 * 装配面板能力。
 * @param {object} ctx 调用方 Cordis ctx（副作用落它的 fiber）
 * @param {{service?:object, seeds?:object}} env 装配面
 */
export function install(ctx, env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  const service = bag.service;
  if (service === null || typeof service !== 'object') return result(false, 'no-service');
  if (typeof ctx?.effect !== 'function') return result(false, 'no-ctx-effect');
  const face = service.components;
  if (face === null || typeof face !== 'object' || typeof face.register !== 'function') {
    return result(false, 'no-components-face');
  }
  const note = (code, message) => {
    if (typeof service.__note === 'function') service.__note(code, message);
  };
  let set;
  try {
    set = createComponents({ seeds: bag.seeds, note });
  } catch (error) {
    note('GUIF-W-LISTENER-THREW', `面板组件装配失败（缺 react 种子？）：${error?.message ?? error}`);
    return result(false, 'no-react-seed');
  }
  const registered = [];
  const disposers = [];
  for (const name of COMPONENT_NAMES) {
    const Component = set[name];
    // 每个组件一条独立 effect：单条失败不牵连同一条链上的其余组件。
    const dispose = ctx.effect(() => {
      const off = face.register(name, Component);
      return () => {
        if (typeof off === 'function') off();
      };
    }, `gui-frame: panel component ${name}`);
    registered.push(name);
    disposers.push(dispose);
  }
  let done = false;
  return result(true, null, {
    components: set,
    registered,
    dispose() {
      if (done) return;
      done = true;
      for (const dispose of disposers) dispose();
    },
  });
}

/** 供坞/测试直接拿到组件集合（走同一条 `createComponents`，不另起第二份实现）。 */
export function createPanelComponents(env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  return createComponents({ seeds: bag.seeds, note: bag.note });
}
