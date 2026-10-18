/**
 * service-lifecycle.test.mjs —— 独立复验（三）：**服务面的生命周期与形态**。
 *
 * 覆盖验收：
 *   服务面能 provide（`ctx.get('gui-frame')` 拿得到、恰好挂一条 effect）；
 *   **卸载时自动注销**（dispose 与 fiber unload 两条路径，并跑 `__shutdown` 收尾；注销后可重新提供）；
 *   冲突让位 / 提供失败都不 rethrow（红线：服务重名不许打死页面）；
 *   对外方法定义在**原型**上（方法 + 取值器），实例上不得有同名自有属性；
 *   **调用点绑定**：用 `Object.create(service)` 模拟官方服务代理 ⇒ 副作用必须落在**调用方** ctx。
 *
 * 自备 mock：`createCtx()`（见 harness.mjs），不借实现方的 tests/helpers/fake-ctx.mjs。
 * 只读：本文件不写任何文件。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createCtx, srcPath } from './harness.mjs';

const serviceMod = await import(pathToFileURL(srcPath('client', 'service.mjs')).href);
const serviceFace = await import(pathToFileURL(srcPath('client', 'contracts', 'service-face.mjs')).href);
const { GuiFrameService, provideService } = serviceMod;
// ★ 期望值自取声明表 —— `SERVICE_VERSION` 与 `CAPABILITIES` 都是声明的公开面，
// 这里再抄一份字面量就等于让被测方自证（也与本文件「声明 ↔ 运行期」的对锁口径自相矛盾）。
const { CAPABILITIES, NAMESPACE_MEMBERS, SERVICE_CARRIER_FIELDS, SERVICE_FIELDS, SERVICE_METHODS, SERVICE_NAMESPACES, SERVICE_VERSION } = serviceFace;

test('服务面能 provide：ctx.get 拿得到、服务名经运行期取证、恰好挂一条 effect', () => {
  const ctx = createCtx({ label: 'provider' });
  const result = provideService(ctx);

  assert.equal(result.owned, true, '没人占名字时必须由本包提供');
  assert.equal(result.reason, null);
  assert.equal(typeof result.dispose, 'function');
  assert.deepEqual([...ctx.provided.keys()], ['gui-frame'], 'provide 的真实名字必须只有 gui-frame');
  assert.equal(ctx.get('gui-frame'), result.service, 'ctx.get 必须拿到同一个服务实例');
  assert.equal(ctx.calls.effect, 1, 'provide 只许挂一条 effect（多挂 = 泄漏）');
  assert.equal(ctx.activeEffects().length, 1);
  assert.equal(result.service.version, SERVICE_VERSION, 'version 必须逐字等于声明表的 SERVICE_VERSION');
  assert.deepEqual([...result.service.capabilities].sort(), [...CAPABILITIES].sort(), '能力集必须逐条等于声明表的 CAPABILITIES');

  // 幂等：disposer 跑两次不炸
  result.dispose();
  assert.doesNotThrow(() => result.dispose());
  assert.equal(ctx.get('gui-frame'), undefined);
});

test('卸载自动注销：dispose 与 fiber unload 两条路径都注销服务并跑 __shutdown 收尾', () => {
  // ── 路径一：dispose()（= 内部 effect 的 disposer）
  const ctxA = createCtx({ label: 'provider-A' });
  const a = provideService(ctxA);
  const callerA = createCtx({ label: 'caller-A' });
  const proxyA = Object.create(a.service); // 官方服务代理：调用点改写 this.ctx
  proxyA.ctx = callerA;
  const disposer = proxyA.register({ id: 'dsh-gui-frame/demo' }, function Demo() {});
  let sliceDisposed = false;
  a.service.__install('dock', { onEntry() {}, dispose() { sliceDisposed = true; } });
  assert.equal(a.service.__entries().length, 1, '注册后入口必须在册');
  assert.deepEqual(a.service.__slices(), ['dock']);

  a.dispose();
  assert.equal(ctxA.get('gui-frame'), undefined, 'dispose 后服务必须自动注销（不能留个死引用）');
  assert.equal(ctxA.activeEffects().length, 0, 'provider 的 effect 必须已清理');
  assert.equal(a.service.__entries().length, 0, '__shutdown 必须清空入口表');
  assert.deepEqual(a.service.__slices(), [], '__shutdown 必须卸掉切片');
  assert.equal(sliceDisposed, true, '切片的 dispose 必须被调用（否则切片自己的副作用会泄漏）');
  assert.doesNotThrow(() => disposer(), '服务已 shutdown 后再跑入口 disposer 必须幂等');

  // ── 路径二：fiber unload（把 provider 那条 effect 一起清掉）
  const ctxB = createCtx({ label: 'provider-B' });
  const b = provideService(ctxB);
  assert.equal(ctxB.get('gui-frame'), b.service);
  ctxB.unload();
  assert.equal(ctxB.get('gui-frame'), undefined, 'fiber 卸载必须同样自动注销');
  assert.equal(b.service.__entries().length, 0);

  // ── 注销之后可以重新提供（真机实测的自动重挂载路径）
  const again = provideService(ctxB);
  assert.equal(again.owned, true, '服务已注销 ⇒ 第二次 provide 必须成功');
  assert.notEqual(again.service, b.service, '重挂载是一个新实例（旧实例已 shutdown）');
  assert.equal(ctxB.get('gui-frame'), again.service);
});

test('冲突让位与提供失败都不 rethrow（服务重名不许打死页面）', () => {
  // ① 已存在 ⇒ 记诊断 + 让位，绝不重复 provide
  const existing = Object.freeze({ marker: 'someone-else-service' });
  const ctx = createCtx({ services: { 'gui-frame': existing } });
  const result = provideService(ctx);
  assert.equal(result.owned, false);
  assert.equal(result.reason, 'conflict');
  assert.equal(result.service, existing, '让位时必须把既有实例交出去（调用方据此判断）');
  assert.equal(ctx.calls.provide, 0, '绝不重复 provide —— 同 scope 重名会 throw ⇒ 整页死');
  assert.equal(ctx.calls.effect, 0, '让位路径不得留下任何 effect');
  assert.ok(
    ctx.logs.some((row) => row.level === 'warn' && row.message.includes('GUIF-W-SERVICE-CONFLICT')),
    '让位必须留下 GUIF-W-SERVICE-CONFLICT 诊断（否则是静默失败）',
  );
  assert.doesNotThrow(() => result.dispose(), '别人的服务：dispose 必须是空操作');
  assert.equal(ctx.services['gui-frame'], existing);

  // ② provide 自身抛错（scope 冲突等）⇒ 捕获、记 error、返回 owned:false，绝不 rethrow
  const ctx2 = createCtx({ label: 'provider-throw' });
  ctx2.provide = () => { throw new Error('duplicate service name in this scope'); };
  let r2 = null;
  assert.doesNotThrow(() => { r2 = provideService(ctx2); }, 'provide 抛错不得冒泡出去（会打死整页）');
  assert.equal(r2.owned, false);
  assert.equal(r2.reason, 'provide-failed');
  assert.equal(r2.service, null);
  assert.ok(ctx2.logs.some((row) => row.level === 'error' && row.message.includes('GUIF-W-SERVICE-CONFLICT')));
  assert.doesNotThrow(() => r2.dispose());

  // ③ 只有「调用方写错」这一类才允许抛（可主动防御的错，绝不静默）
  assert.throws(() => provideService(null), (error) => error?.code === 'GUIF-E-CTX-INVALID');
  assert.throws(() => provideService('not-a-ctx'), (error) => error?.code === 'GUIF-E-CTX-INVALID');
});

test('对外方法定义在原型上（方法 + 取值器），实例上不得有同名自有属性', () => {
  const ctx = createCtx();
  const service = new GuiFrameService(ctx);
  assert.equal(Object.getPrototypeOf(service), GuiFrameService.prototype);

  for (const name of SERVICE_METHODS) {
    const desc = Object.getOwnPropertyDescriptor(GuiFrameService.prototype, name);
    assert.equal(typeof desc?.value, 'function', `${name} 必须是原型上的数据方法`);
    assert.equal(typeof desc?.get, 'undefined', `${name} 不应该是取值器`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(service, name),
      false,
      `${name} 不得是实例自有属性：实例箭头函数会把 this 冻在服务自己的 root ctx 上，静默破坏按插件卸载`,
    );
  }
  for (const name of SERVICE_NAMESPACES) {
    const desc = Object.getOwnPropertyDescriptor(GuiFrameService.prototype, name);
    assert.equal(typeof desc?.get, 'function', `${name} 必须是原型上的取值器（getter 同样走调用点绑定）`);
    assert.equal(Object.prototype.hasOwnProperty.call(service, name), false, `${name} 不得被实例属性遮蔽`);
  }
  for (const name of SERVICE_FIELDS) {
    assert.equal(typeof service[name] !== 'function', true, `${name} 是数据字段，不该是函数`);
    assert.equal(Object.prototype.hasOwnProperty.call(service, name), true);
  }

  // 自有公开键 = 数据字段 ∪ 载体字段（`ctx`）；多一个都算公开面漂移
  const ownPublic = Object.keys(service).filter((name) => !name.startsWith('__')).sort();
  assert.deepEqual(ownPublic, [...SERVICE_FIELDS, ...SERVICE_CARRIER_FIELDS].sort(), '实例自有公开键必须恰好是「字段 + 载体」');

  // 命名空间内部成员也必须是原型方法（同一个机制理由）
  for (const [namespace, names] of Object.entries(NAMESPACE_MEMBERS)) {
    const face = service[namespace];
    const proto = Object.getPrototypeOf(face);
    for (const name of names) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      assert.equal(typeof desc?.value, 'function', `${namespace}.${name} 必须是原型方法`);
      assert.equal(Object.prototype.hasOwnProperty.call(face, name), false, `${namespace}.${name} 不得是实例自有属性`);
    }
  }

  // 源码级守卫：不得出现 `this.<公开成员> = …` 这种实例赋值写法
  //   （先把块注释与整行行注释剥掉 —— 文件头正是用这句反例在讲道理，不能把注释当代码）
  // 服务面实例定义在 `src/client/service/core.mjs` ⇒ **两个文件都扫**（只收紧，不缩小扫描面）。
  for (const rel of [['client', 'service.mjs'], ['client', 'service', 'core.mjs']]) {
    const rawSource = readFileSync(srcPath(...rel), 'utf8');
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    assert.ok(source.length < rawSource.length, `注释剥离必须真的生效（否则下面的守卫会误报）：${rel.join('/')}`);
    for (const name of [...SERVICE_METHODS, ...SERVICE_NAMESPACES]) {
      assert.equal(new RegExp(`this\\.${name}\\s*=`).test(source), false, `${rel.join('/')} 里不得把 ${name} 赋成实例属性`);
    }
  }

  // ★ 牙齿：同一个「自有属性」探测器必须能认出实例箭头函数写法
  class ArrowLike {
    constructor() { this.register = () => {}; }
  }
  const arrow = new ArrowLike();
  assert.equal(Object.prototype.hasOwnProperty.call(arrow, 'register'), true, '探测器必须能认出实例箭头函数（否则本用例是空的）');
});

test('调用点绑定：Object.create(service) 模拟官方代理 ⇒ 副作用必须落在调用方 ctx', () => {
  const provider = createCtx({ label: 'provider' });
  const caller = createCtx({ label: 'caller' });
  const service = new GuiFrameService(provider);
  const proxy = Object.create(service);
  proxy.ctx = caller; // cordis 服务代理在调用点做的事

  const disposer = proxy.register({ id: 'dsh-gui-frame/probe' }, function Probe() {});
  assert.equal(caller.activeEffects().length, 1, 'register 的副作用必须挂在调用方 fiber 上');
  assert.equal(provider.activeEffects().length, 0, '提供方 fiber 上不得出现调用方的副作用');
  assert.equal(service.__entries().length, 1, '入口登记对两个 ctx 是同一份服务状态');

  disposer();
  assert.equal(caller.activeEffects().length, 0, 'disposer 必须清掉调用方那条 effect');
  assert.equal(service.__entries().length, 0, 'disposer 必须同时注销入口');

  // 命名空间同理（取值器在调用点被访问 ⇒ 拿到的是调用方 ctx 的视图）
  // ★ 服务面**没有 layout 命名空间**，改取 `components.register`：
  //   它是三个命名空间里**唯一**会挂副作用的那一个（`effects` 语义与 `layout.subscribe` 逐条同源：
  //   装配经 `__effect(ctx, …)` 挂调用方 fiber）。判据强度不变。
  const callerComp = proxy.components.register('你的包名/可复用面板', function ProbePanel() {});
  assert.equal(caller.activeEffects().length, 1, 'components.register 的副作用必须挂在调用方 fiber 上');
  assert.equal(provider.activeEffects().length, 0, '提供方 fiber 上不得出现调用方的副作用');
  callerComp();
  assert.equal(caller.activeEffects().length, 0, '命名空间 disposer 必须清掉调用方那条 effect');

  // 取值器本身的调用点绑定：同一份服务状态在两个 ctx 下都可读，但**视图对象必须各是各的**
  const caller2 = createCtx({ label: 'caller-2' });
  const proxy2 = Object.create(service);
  proxy2.ctx = caller2;
  assert.equal(proxy2.dock.isOpen(), proxy.dock.isOpen(), '同一份服务状态 ⇒ 两个 ctx 读到同值');
  assert.notEqual(proxy.dock, service.dock, '不同调用方 ctx 必须拿到不同的命名空间视图');
  assert.notEqual(proxy2.dock, proxy.dock, '视图缓存按 ctx 分槽（WeakMap），不得跨 ctx 复用');
  assert.equal(caller.activeEffects().length, 0, '只读取值器不得留下任何 effect');
  assert.equal(caller2.activeEffects().length, 0, '只读取值器不得留下任何 effect');

  // ★ 牙齿：实例箭头函数写法在同一个探针下会露馅（副作用跑到提供方 fiber 上）
  class ArrowService {
    constructor(ctx) {
      this.ctx = ctx;
      this.register = () => this.ctx.effect(() => () => {}, 'arrow-register');
    }
  }
  assert.equal(caller.activeEffects().length, 0, '（反证前提）调用方此刻没有存活的 effect');
  const provider2 = createCtx({ label: 'provider-2' });
  const arrowProxy = Object.create(new ArrowService(provider2));
  arrowProxy.ctx = caller; // 代理照样改写 ctx —— 但箭头函数早已把 this 冻结在服务实例上
  arrowProxy.register({});
  assert.equal(provider2.activeEffects().length, 1, '（反证）实例箭头函数把副作用挂在了**提供方** fiber 上');
  assert.equal(caller.activeEffects().length, 0, '（反证）调用方拿不到这条副作用 —— 正是官方原文警告的「静默破坏按插件卸载」');
});
