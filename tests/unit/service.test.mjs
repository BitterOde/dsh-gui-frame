/**
 * service.test.mjs —— **服务面冻结 + provideService + 公开面快照** 的机检门禁。
 *
 * 判据逐条：
 *  1. **对外方法必须是原型方法**（不是风格问题）：用 `Object.create(service)` 模拟
 *     cordis 服务代理「在调用点把 `this.ctx` 绑到调用方 ctx」，断言副作用落在**调用方** fiber 上；
 *     并另附一条**反假绿**用例：把 `register` 换成实例箭头函数 ⇒ 调用方绑定落空（证明判据真的在拦）。
 *  2. 服务面成员（方法 / 命名空间 / 字段）与 `contracts/service-face.mjs` 的声明**双向一致**。
 *  3. `register(entry, Component)`：形态校验、保留 key、命名空间前缀、重复 id、disposer 幂等、
 *     dock 切片的 added/removed 通知。
 *  4. `components`：冻结名清单、登记/取用/占用、props 契约。
 *  5. `overlay`：能力缺席显式报错、数字层级表领号（极值拒绝 / 越段只告警）、close/bringToFront 幂等语义。
 *  6. `ctx` 准入：调用方 ctx 缺 `effect` ⇒ `GUIF-E-CTX-INVALID`（register / 命名空间两条路）。
 *  7. `provideService`：先探测后让位、卸载自动注销、不重复 provide。
 *  8. **公开面快照逐字节比对 + 反向验证**（改一个导出名就变红）。
 *
 * ★ v1.0 的服务面只有 components / dock / overlay 三个命名空间（`layout` / `channel` 不在交付面里）：
 *   本文件因此没有它们的用例，v1 真有的每一条都留着。
 *
 * 纪律：本用例只读快照档，**不写任何文件**、不联网、不需要 DSH 在跑。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GuiFrameService, provideService } from '../../src/client/service.mjs';
import {
  CAPABILITIES,
  NAMESPACE_MEMBERS,
  SERVICE_CARRIER_FIELDS,
  SERVICE_FIELDS,
  SERVICE_MEMBERS,
  SERVICE_METHODS,
  SERVICE_NAME,
  SERVICE_NAMESPACES,
  SERVICE_VERSION,
  SLICE_NAMES,
} from '../../src/client/contracts/service-face.mjs';
import { COMPONENT_NAMES, COMPONENT_PROPS } from '../../src/client/contracts/components.mjs';
import { PUBLIC_SURFACE_PATH, SURFACE_KEYS, describePublicSurface, diffSurface, serializePublicSurface } from '../../scripts/public-surface.describe.mjs';
import { createFakeCtx } from '../helpers/fake-ctx.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');

/** 模拟 cordis 服务代理：让 `this.ctx` 在**调用点**读到调用方 ctx（原型方法才吃得到这个绑定）。 */
function callerView(service, callerCtx) {
  const view = Object.create(service);
  Object.defineProperty(view, 'ctx', { value: callerCtx, enumerable: true, configurable: true, writable: true });
  return view;
}

/** 一个最小可用的 overlay 切片替身（形状对齐【装配契约 v1】：切片方法第一个参数恒为调用方 ctx）。 */
function createOverlaySlice() {
  const calls = [];
  const windows = new Map();
  return {
    calls,
    windows,
    open(ctx, request) {
      calls.push(['open', ctx, request]);
      const id = request.id === undefined ? `win-${windows.size + 1}` : request.id;
      const handle = { id, z: request.z, close: () => windows.delete(id), bringToFront: () => true };
      windows.set(id, handle);
      return handle;
    },
    close(ctx, id) {
      calls.push(['close', ctx, id]);
      return windows.delete(id) ? true : false;
    },
    bringToFront(ctx, id) {
      calls.push(['bringToFront', ctx, id]);
      return windows.has(id);
    },
    dispose() {
      calls.push(['dispose']);
      windows.clear();
    },
  };
}

test('服务面形态：方法/命名空间都在原型上，实例自有属性里**没有函数**（机制性判据）', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);

  const proto = Object.getPrototypeOf(service);
  const protoNamesAll = Object.getOwnPropertyNames(proto);
  const protoNames = protoNamesAll.filter((name) => name !== 'constructor' && !name.startsWith('__')).sort();
  assert.deepEqual(protoNames, [...SERVICE_METHODS, ...SERVICE_NAMESPACES].sort(), '原型成员必须与声明一致（多一个/少一个都红）');

  for (const name of SERVICE_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    assert.equal(typeof descriptor.value, 'function', `${name} 必须是原型**方法**`);
    assert.equal(descriptor.get, undefined);
  }
  for (const name of SERVICE_NAMESPACES) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    assert.equal(typeof descriptor.get, 'function', `${name} 必须是原型**取值器**（实例属性会把 this.ctx 冻在 root ctx）`);
    assert.equal(descriptor.value, undefined, `${name} 不得同时是数据属性`);
  }

  const ownKeys = Object.keys(service).filter((key) => !key.startsWith('__')).sort();
  assert.deepEqual(ownKeys, [...SERVICE_FIELDS, ...SERVICE_CARRIER_FIELDS].sort(), '实例自有非内部属性只能是声明里的字段 + 载体 ctx');
  for (const [key, value] of Object.entries(service)) {
    assert.notEqual(typeof value, 'function', `实例自有属性 ${key} 是函数 —— 箭头函数属性会把 this 冻在服务自己的 root ctx 上`);
  }
  const shadowed = Object.getOwnPropertyNames(service).filter((key) => protoNamesAll.includes(key));
  assert.deepEqual(shadowed, [], '实例自有属性不得遮蔽原型成员（数据字段与原型方法重名 ⇒ 方法被吃掉，TypeError 只在调用时才炸）');
  assert.equal(service.ctx, ctx, '构造时 ctx 是提供者根 ctx（代理由 cordis 在调用点替换）');
  assert.equal(service.version, SERVICE_VERSION);
  assert.deepEqual([...service.capabilities], [...CAPABILITIES]);
  assert.ok(Object.isFrozen(service.capabilities));
  assert.equal(SERVICE_NAME, 'gui-frame');
});

test('调用方 fiber 绑定：命名空间 + 方法注册的副作用都落在**调用方** ctx 上', () => {
  const root = createFakeCtx({});
  const { service, owned } = provideService(root.ctx);
  assert.equal(owned, true);
  assert.equal(root.effects.length, 1, '提供阶段只有 provideService 自己那一条 effect');
  assert.equal(root.calls.provide.filter((name) => name === SERVICE_NAME).length, 1);

  const caller = createFakeCtx({});
  const view = callerView(service, caller.ctx);

  const off = view.register({ id: 'demo/panel' }, function Demo() { return null; });
  assert.equal(caller.effects.length, 1, 'register 的清理必须挂在调用方 fiber 上（原型方法才做得到）');
  assert.equal(root.effects.length, 1, '不得挂到服务自己的 root ctx 上');
  assert.equal(service.__entries().length, 1);

  // 命名空间面本身也必须是「按调用方 ctx」取到的
  assert.equal(view.dock.ctx, caller.ctx, 'dock 命名空间读到的必须是调用方 ctx');
  assert.equal(view.components.ctx, caller.ctx);

  // disposer 幂等
  off();
  off();
  assert.equal(service.__entries().length, 0);
});

test('反假绿：把 register 写成实例箭头函数 ⇒ 调用方绑定落空（本套判据确实在拦）', () => {
  const root = createFakeCtx({});
  const { service } = provideService(root.ctx);
  const caller = createFakeCtx({});

  // 模拟「写成实例箭头函数」：this 被冻在服务实例（= 服务自己的 root ctx）上
  const arrowView = Object.create(service);
  Object.defineProperty(arrowView, 'ctx', { value: caller.ctx, enumerable: true, configurable: true });
  arrowView.register = (entry, Component) => service.register(entry, Component);

  arrowView.register({ id: 'demo/x' }, function X() { return null; });
  assert.equal(caller.effects.length, 0, '箭头写法下调用方 fiber 一条 effect 都没有 —— 这正是被静默破坏的清理');
  assert.equal(root.effects.length, 2, '反而挂回了服务自己的 root ctx（泄漏根源）');
  assert.equal(service.__entries().length, 1, '注册本身仍成功 ⇒ 只看「有没有注册上」的断言抓不到这个 bug');
});

test('register：形态校验逐条变红，保留 key 与命名空间前缀不可绕过', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  const Component = function C() { return null; };
  const codeOf = (fn) => {
    try {
      fn();
      return null;
    } catch (error) {
      return error.code;
    }
  };

  assert.equal(codeOf(() => service.register(null, Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register([], Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({}, Component)), 'GUIF-E-ENTRY-INVALID', '缺 id');
  assert.equal(codeOf(() => service.register({ id: '   ' }, Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({ id: 'conversation' }, Component)), 'GUIF-E-ENTRY-INVALID', '不得占用保留 key');
  assert.equal(codeOf(() => service.register({ id: 'no-prefix' }, Component)), 'GUIF-E-ENTRY-INVALID', '必须带命名空间前缀');
  assert.equal(codeOf(() => service.register({ id: 'a b/c' }, Component)), 'GUIF-E-ENTRY-INVALID', '不得含空格');
  assert.equal(codeOf(() => service.register({ id: `${'x'.repeat(200)}/y` }, Component)), 'GUIF-E-ENTRY-INVALID', '超长 id');
  assert.equal(codeOf(() => service.register({ id: 'ok/id' }, null)), 'GUIF-E-ENTRY-INVALID', 'Component 缺失');
  assert.equal(codeOf(() => service.register({ id: 'ok/id' }, 42)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({ id: 'ok/id', label: 1 }, Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({ id: 'ok/id', order: 1.5 }, Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({ id: 'ok/id', group: '' }, Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({ id: 'ok/id', kind: 'floating' }, Component)), 'GUIF-E-ENTRY-INVALID');
  assert.equal(codeOf(() => service.register({ id: 'ok/id', source: 5 }, Component)), 'GUIF-E-ENTRY-INVALID');

  // 合法：三种 kind / label thunk / memo 形状（对象）都要收
  const memo = Object.freeze({ $$typeof: Symbol.for('react.memo') });
  const off = service.register({ id: 'dsh-gui-frame/demo', label: () => '演示', order: 10, group: '示例', kind: 'action', source: 'dsh-gui-frame' }, memo);
  assert.equal(typeof off, 'function');
  assert.equal(codeOf(() => service.register({ id: 'dsh-gui-frame/demo' }, Component)), 'GUIF-E-ENTRY-DUPLICATE', '同一 id 不许注册两次');
  off();
  assert.equal(codeOf(() => service.register({ id: 'dsh-gui-frame/demo' }, Component)), null, 'disposer 之后可以重新注册');
});

test('__install：白名单 / 重复装配 / 非法装配面逐条变红', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  const codeOf = (fn) => {
    try {
      fn();
      return null;
    } catch (error) {
      return error.code;
    }
  };
  // ★ `workbench`（工作台开关的控件面）是第 5 个切片 —— 它不是第七项能力，只是共享 UI 的控件面。
  assert.deepEqual([...SLICE_NAMES].sort(), ['dock', 'overlay', 'theme']);
  assert.equal(codeOf(() => service.__install('nope', {})), 'GUIF-E-SLICE-INVALID');
  assert.equal(codeOf(() => service.__install('dock', null)), 'GUIF-E-SLICE-INVALID');
  const off = service.__install('dock', {});
  assert.equal(codeOf(() => service.__install('dock', {})), 'GUIF-E-SLICE-INVALID', '重复装配必须变红');
  off();
  off();
  assert.equal(service.__slice('dock'), undefined);
  assert.equal(codeOf(() => service.__install('dock', {})), null, 'disposer 之后可以重新装配');
});

test('components：冻结名清单 + 登记/取用/占用 + props 契约', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  const components = service.components;

  assert.deepEqual(components.names(), [...COMPONENT_NAMES].sort(), '初始 names() 就是冻结清单（名字先冻住）');
  assert.equal(components.has('Panel'), true, '冻结名恒为「可用」——它们在对外承诺里');
  assert.equal(components.get('Panel'), undefined, '装上前取不到实现（不伪装成空组件）');
  assert.deepEqual(components.props('Panel'), [...COMPONENT_PROPS.Panel]);
  assert.equal(components.props('Nope'), null);

  const Panel = function Panel() { return null; };
  const off = components.register('Panel', Panel);
  assert.equal(components.get('Panel'), Panel);
  assert.throws(() => components.register('Panel', Panel), (error) => error.code === 'GUIF-E-COMPONENT-DUPLICATE');
  assert.throws(() => components.register('', Panel), (error) => error.code === 'GUIF-E-COMPONENT-INVALID');
  assert.throws(() => components.register('Extra', 42), (error) => error.code === 'GUIF-E-COMPONENT-INVALID');

  components.register('Extra', function Extra() { return null; });
  assert.deepEqual(components.names(), [...COMPONENT_NAMES, 'Extra'].sort(), '插件自注册的名字进 names()，但**不进快照**');
  off();
  assert.equal(components.get('Panel'), undefined);

  // 调用方解绑：register 返回的 disposer 挂在调用方 fiber 上
  const caller = createFakeCtx({});
  const view = callerView(service, caller.ctx);
  view.components.register('Panel', Panel);
  assert.equal(caller.effects.length, 1);
  caller.dispose();
  assert.equal(components.get('Panel'), undefined, '调用方 fiber 卸载 ⇒ 组件登记自动撤销');
});

test('overlay：能力缺席显式报错；领号走数字层级表（极值拒绝 / 越段只告警）', () => {
  const { ctx, logs } = createFakeCtx({});
  const { service } = provideService(ctx);
  const overlay = service.overlay;

  assert.equal(service.supports('overlay'), false);
  assert.throws(() => overlay.open({ id: 'w1' }), (error) => error.code === 'GUIF-E-CAPABILITY-ABSENT');
  assert.throws(() => overlay.close('w1'), (error) => error.code === 'GUIF-E-CAPABILITY-ABSENT');
  assert.throws(() => overlay.bringToFront('w1'), (error) => error.code === 'GUIF-E-CAPABILITY-ABSENT');

  const slice = createOverlaySlice();
  service.__install('overlay', slice);
  assert.equal(service.supports('overlay'), true);

  const first = overlay.open({ id: 'w1', family: 'floating' });
  assert.equal(first.id, 'w1');
  assert.equal(slice.calls.at(-1)[2].z, 100, '不传 z ⇒ 从 100 起单调自增');
  const second = overlay.open({});
  assert.equal(slice.calls.at(-1)[2].z, 101);
  assert.equal(second.z, 101);

  // 面板（panel 200–299）与 Dialog（300–499）是**两个**号段 —— 别按「z=250 且期望 dialog」那种旧口径；
  // 这里「两段各拿一个号，各自的 band 自证」。
  const panel = overlay.open({ id: 'p1', family: 'panel' }, { z: 250 });
  assert.equal(panel.z, 250);
  assert.equal(slice.calls.at(-1)[2].band, 'panel', 'z=250 必须落 panel 段（旧表把它算进 dialog）');
  assert.equal(slice.calls.at(-1)[2].family, 'panel');

  const dialog = overlay.open({ id: 'd1', family: 'dialog' }, { z: 350 });
  assert.equal(dialog.z, 350);
  assert.equal(slice.calls.at(-1)[2].band, 'dialog');
  assert.equal(slice.calls.at(-1)[2].family, 'dialog');
  assert.notEqual(slice.calls.at(-1)[2].band, 'panel', 'dialog 段的号不得被判成 panel（两段必须互不混淆）');

  // 越段只告警：不阻断，且留下诊断（`data-guif-z` 挂在窗口根节点上）
  const before = service.__drainDiagnostics();
  const wild = overlay.open({ id: 'w9', family: 'floating' }, { z: 5000 });
  assert.equal(wild.z, 5000);
  const after = service.__drainDiagnostics();
  assert.equal(before.length, 0);
  assert.ok(after.some((entry) => entry.code === 'GUIF-W-Z-SEGMENT'), '越段必须留下 GUIF-W-Z-SEGMENT 诊断');
  assert.ok(logs.some((entry) => entry.level === 'warn' && entry.message.includes('GUIF-W-Z-SEGMENT')), '越段要有 warn 日志');
  assert.ok(slice.calls.some((call) => call[2].z === 5000), '越段仍然把窗口交出去（只告警不阻断）');

  // 极值拒绝：抛错且**不消耗**号、不惊动切片
  const callsBefore = slice.calls.length;
  assert.throws(() => overlay.open({ id: 'bad' }, { z: 2 ** 31 }), (error) => error.code === 'GUIF-E-Z-RANGE');
  assert.throws(() => overlay.open({ id: 'bad' }, { z: -1.5 }), (error) => error.code === 'GUIF-E-Z-RANGE');
  assert.equal(slice.calls.length, callsBefore, '极值不该把窗口交给切片');

  // 参数形态
  assert.throws(() => overlay.open(null), (error) => error.code === 'GUIF-E-OVERLAY-SPEC');
  assert.throws(() => overlay.open({ id: 'w', family: 'toastie' }), (error) => error.code === 'GUIF-E-OVERLAY-SPEC');
  assert.throws(() => overlay.open({ id: '' }), (error) => error.code === 'GUIF-E-OVERLAY-ID');
  assert.throws(() => overlay.close(1), (error) => error.code === 'GUIF-E-OVERLAY-ID');
  assert.throws(() => overlay.bringToFront(''), (error) => error.code === 'GUIF-E-OVERLAY-ID');

  // 幂等语义：合法但不存在的 id ⇒ false（不抛）
  assert.equal(overlay.close('nope'), false);
  assert.equal(overlay.bringToFront('nope'), false);
  assert.equal(overlay.close('w1'), true);
  assert.equal(overlay.close('w1'), false, '再关一次 = 不存在');
});
test('overlay 切片形状守卫：返回非法句柄 ⇒ GUIF-E-SLICE-INVALID（装配期契约）', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  service.__install('overlay', { open: () => null });
  assert.throws(() => service.overlay.open({}), (error) => error.code === 'GUIF-E-SLICE-INVALID');
  const service2 = new GuiFrameService(ctx);
  service2.__install('overlay', { open: () => ({ id: 7 }) });
  assert.throws(() => service2.overlay.open({}), (error) => error.code === 'GUIF-E-SLICE-INVALID');
});
test('ctx 准入：调用方 ctx 缺 effect ⇒ GUIF-E-CTX-INVALID（不接受静默退化）', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  const bare = {}; // 没有 effect 的「ctx」
  const view = callerView(service, bare);
  // ① 方法这条路：`register` 的准入在登记**之前**就抛（不许留半成品）
  assert.throws(() => view.register({ id: 'a/b' }, () => null), (error) => error.code === 'GUIF-E-CTX-INVALID');
  // ② 命名空间这条路：v1 的三个命名空间取值器都先过 `__assertCtx`
  //    （原用例取 `layout.subscribe`，而 v1 已无 layout 命名空间 —— 见文件头「v1.0 副本」段）。
  assert.throws(() => view.components, (error) => error.code === 'GUIF-E-CTX-INVALID');
  assert.throws(() => view.dock, (error) => error.code === 'GUIF-E-CTX-INVALID');
  assert.throws(() => view.overlay, (error) => error.code === 'GUIF-E-CTX-INVALID');
  assert.equal(service.__entries().length, 0, '准入失败不得留下半成品');
  // 取不到面 ⇒ 不缓存：同一个 ctx 再访问仍然走准入（不是「第一次抛、第二次拿到半个面」）
  assert.throws(() => view.components, (error) => error.code === 'GUIF-E-CTX-INVALID');
});
test('provideService：先探测后让位 / 卸载自动注销 / 不重复 provide', () => {
  const root = createFakeCtx({});
  const provided = provideService(root.ctx);
  assert.equal(provided.owned, true);
  assert.equal(root.ctx.get(SERVICE_NAME), provided.service);
  assert.equal(root.calls.provide.filter((name) => name === SERVICE_NAME).length, 1);
  assert.equal(root.calls.effect.length, 1);

  // 第二次：探测到既有服务 ⇒ 记诊断并让位，不再 provide
  const second = provideService(root.ctx);
  assert.equal(second.owned, false);
  assert.equal(second.reason, 'conflict');
  assert.equal(second.service, provided.service, '让位时交出既有实例');
  assert.equal(root.calls.provide.filter((name) => name === SERVICE_NAME).length, 1, '绝不重复 provide（重名 = 整页死）');
  assert.ok(root.logs.some((entry) => entry.level === 'warn' && entry.message.includes('GUIF-W-SERVICE-CONFLICT')));

  // 卸载（fiber 卸载 或 显式 dispose）⇒ 服务自动注销
  const managed = provideService(createFakeCtx({}).ctx);
  assert.equal(managed.owned, true);
  managed.dispose();
  assert.equal(managed.service.ctx.get(SERVICE_NAME), undefined, 'dispose 之后服务必须注销');
  assert.equal(managed.service.__slices().length, 0);

  const fake = createFakeCtx({});
  const viaFiber = provideService(fake.ctx);
  viaFiber.service.__install('dock', {});
  assert.equal(fake.ctx.get(SERVICE_NAME), viaFiber.service);
  fake.dispose(); // 模拟提供者 fiber 卸载：跑掉全部 effect disposer
  assert.equal(fake.ctx.get(SERVICE_NAME), undefined, 'fiber 卸载 ⇒ 服务自动注销');
  assert.deepEqual(viaFiber.service.__slices(), [], '__shutdown 收尾');

  // 提供失败也要让位（页面照常起），绝不抛穿
  const broken = { get: () => undefined, effect: (fn) => fn(), logger: { warn() {}, error() {} } };
  const failed = provideService(broken);
  assert.equal(failed.owned, false);
  assert.equal(failed.reason, 'provide-failed');
  assert.equal(failed.service, null);
  assert.equal(typeof failed.dispose, 'function');

  assert.throws(() => provideService(null), (error) => error.code === 'GUIF-E-CTX-INVALID');
  const bareService = new GuiFrameService({});
  assert.throws(() => bareService.register({ id: 'a/b' }, () => null), (error) => error.code === 'GUIF-E-CTX-INVALID');
});

test('公开面快照：逐字节一致 + 反向验证（改一个导出名就变红）', () => {
  const snapshotPath = path.join(PKG_DIR, ...PUBLIC_SURFACE_PATH.split('/'));
  const onDisk = readFileSync(snapshotPath, 'utf8');

  assert.deepEqual(Object.keys(describePublicSurface()), [...SURFACE_KEYS], '快照字段顺序也是契约（逐字节比对）');
  assert.equal(onDisk, serializePublicSurface(), `快照档与当前源码不一致 —— 若是有意的公开面变更，跑 node scripts/public-surface.mjs --write 并提交 diff（${PUBLIC_SURFACE_PATH}）`);
  assert.deepEqual(diffSurface(JSON.parse(onDisk)), [], 'diffSurface 必须认同一份数据');
  assert.deepEqual(diffSurface({ ...JSON.parse(onDisk), serviceMembers: ['registerX'] }), ['serviceMembers：期望 ' + JSON.stringify(describePublicSurface().serviceMembers) + '，实际 ["registerX"]']);

  const surface = describePublicSurface();
  assert.deepEqual(surface.serviceMembers, [...SERVICE_MEMBERS]);
  assert.deepEqual(surface.components, [...COMPONENT_NAMES].sort());
  assert.deepEqual(surface.slots, ['main', 'sidebar.panellist'], '本包收取的 slot 键：坞成对注册（v1 无工作台，故无设置页那一行）');
  assert.deepEqual(surface.inject, ['connection', 'settingsScope', 'slots'], '软探测的平台服务名（不用真 inject）');
  assert.ok(surface.errorCodes.every((code) => code.startsWith('GUIF-E-') || code.startsWith('GUIF-W-')));
  assert.deepEqual(surface.errorCodes, [...surface.errorCodes].sort(), '错误码集合必须排序');

  // 反向验证①：改一个服务成员名 ⇒ 快照文本必变
  const renamed = serializePublicSurface().replace('"register"', '"registerX"');
  assert.notEqual(renamed, onDisk, '改导出名必须让快照变红');
  // 反向验证②：改一个组件名 ⇒ 快照文本必变
  assert.notEqual(serializePublicSurface().replace('"Toolbar"', '"TopBar"'), onDisk);
  // 反向验证③：排序是判据的一部分（乱序即不一致）
  const shuffled = JSON.parse(onDisk);
  shuffled.errorCodes = [...shuffled.errorCodes].reverse();
  assert.notEqual(`${JSON.stringify(shuffled, null, 2)}\n`, onDisk, '集合乱序必须让快照变红');
});

/**
 * ★ `ctx.guiFrame.dock` —— 公开面里「打开按钮面板」的入口（此前只有 `supports('dock') === true`
 * 却无门可入，README 的契约缺口自己记着）。
 * 三件走切片；能力缺席一律 `false`（**不抛**）；形态非法按「不给锚点」处理。
 */
test('dock 命名空间：open/close/isOpen 委托给坞切片；能力缺席一律 false（不抛）', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  const dock = service.dock;

  assert.equal(service.supports('dock'), false, '坞切片还没装');
  assert.equal(dock.open(), false, '坞切片未装 ⇒ false（这是「本包没装上」的正常一态，不是异常）');
  assert.equal(dock.close(), false);
  assert.equal(dock.isOpen(), false);

  const calls = [];
  service.__install('dock', {
    open(anchor) { calls.push(['open', anchor]); return true; },
    close() { calls.push(['close']); return true; },
    isOpen() { calls.push(['isOpen']); return true; },
  });
  assert.equal(service.supports('dock'), true);

  assert.equal(dock.open(), true);
  assert.deepEqual(calls.at(-1), ['open', null], '不给锚点 ⇒ 交 null（由坞回落到入口字形记的矩形）');
  const rect = { left: 10, top: 20, right: 40, width: 30, height: 18 };
  assert.equal(dock.open({ anchor: rect }), true);
  assert.equal(calls.at(-1)[1], rect, '锚点原样交给坞');
  for (const bad of [42, 'x', { anchor: 'nope' }, null]) {
    assert.equal(dock.open(bad), true, '形态非法**不抛**（按「不给锚点」处理）');
    assert.equal(calls.at(-1)[1], null, `options=${JSON.stringify(bad)} ⇒ 锚点 null`);
  }
  assert.equal(dock.isOpen(), true);
  assert.equal(calls.at(-1)[0], 'isOpen');
  assert.equal(dock.close(), true);
  assert.equal(calls.at(-1)[0], 'close');

  // 三件**都不收调用方 ctx**（与 dock 切片的 entries/list 同一口径）：面板是插件整体的共享 UI，
  // 不往调用方 fiber 挂任何东西 —— 这条钉住「别把共享 UI 伪装成调用方的私有窗口」。
  const caller = createFakeCtx({});
  const view = callerView(service, caller.ctx);
  assert.equal(view.dock.open(), true);
  assert.equal(view.dock.close(), true);
  assert.equal(caller.effects.length, 0, '调用方 fiber 上一条 effect 都不该有');
  assert.equal(view.dock.ctx, caller.ctx, 'dock 与其余三个命名空间一样：按调用方 ctx 取面');

  // 切片抛错：调用点拿 false，但**必须留诊断**（不许静默吞）
  const broken = new GuiFrameService(ctx);
  broken.__install('dock', {
    open() { throw new Error('切片炸了'); },
    close() { throw new Error('切片炸了'); },
    isOpen() { throw new Error('切片炸了'); },
  });
  assert.equal(broken.dock.open(), false);
  assert.equal(broken.dock.close(), false);
  assert.equal(broken.dock.isOpen(), false);
  const diagnostics = broken.__drainDiagnostics();
  assert.equal(diagnostics.filter((entry) => entry.code === 'GUIF-W-LISTENER-THREW').length, 3, '三次失败各留一条诊断');
});

test('命名空间成员与声明一致（overlay.open/close/bringToFront 等逐条锁住）', () => {
  const { ctx } = createFakeCtx({});
  const service = new GuiFrameService(ctx);
  for (const name of SERVICE_NAMESPACES) {
    const face = service[name];
    const proto = Object.getPrototypeOf(face);
    const members = Object.getOwnPropertyNames(proto).filter((key) => key !== 'constructor' && !key.startsWith('__')).sort();
    assert.deepEqual(members, [...NAMESPACE_MEMBERS[name]].sort(), `${name} 命名空间的成员必须与声明一致`);
    for (const member of members) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, member);
      assert.equal(typeof descriptor.value, 'function', `${name}.${member} 必须也是原型方法（调用方 ctx 绑定）`);
    }
  }
  assert.deepEqual(NAMESPACE_MEMBERS.dock, ['close', 'isOpen', 'open']);
  assert.deepEqual(NAMESPACE_MEMBERS.overlay, ['bringToFront', 'close', 'open']);
});
