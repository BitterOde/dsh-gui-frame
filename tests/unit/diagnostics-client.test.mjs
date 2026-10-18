/**
 * diagnostics-client.test.mjs —— **客户端诊断上报**的机检门禁。
 *
 * 判据：
 *  1. 载荷带**插件名 / 消息 / 栈摘要 / 客户端版本 / 时间戳 / 阶段**（+ 指纹）；
 *  2. 走**同源** `fetch` `POST /api/gui-frame/diagnostics`，体是**官方信封**
 *     `{type:'client-request', rpcId, method:'gui-frame/diagnostics', payload}`，`credentials:'same-origin'`；
 *  3. **四道闸**：限长（截断并计数）/ 限频（窗口内最多 N 条）/ 同指纹去重 / 队列封顶；
 *  4. `fetch` 缺席或抛错 ⇒ **只计数不抛**（诊断通道自己不能把页面搞崩）；
 *  5. **钩子**：`window` 的 `error` / `unhandledrejection` ⇒ 记 `render` / `unhandled`；缺 `window` ⇒ 静默跳过；
 *     ★ 并且**绝不改写平台的共享 `ctx.slots` 服务**：写自有属性会打断 cordis 的调用点
 *     effect 归属（同一处钩子已经出过一次整页事故）。这条既是行为判据也是静态判据。
 *  6. 钩子注册经 `ctx.effect`，卸载后**监听还原**；
 *  7. `CLIENT_VERSION` 与 `package.json` 的 `version` 一致（防常量漂移）。
 *
 * 纪律：零真实网络（假 fetch）、零真 DOM（假 window/slots）、不写盘。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFakeCtx } from '../helpers/fake-ctx.mjs';
import {
  CLIENT_REQUEST_TYPE,
  CLIENT_VERSION,
  DIAGNOSTICS_METHOD,
  DIAGNOSTICS_PATH,
  DIAGNOSTIC_LIMITS,
  PLUGIN_NAME,
  createDiagnosticsEnvelope,
  createDiagnosticsReporter,
  degradeEvent,
  describeError,
  fingerprintOf,
  hashFingerprint,
  installDiagnosticsHooks,
  renderErrorReport,
  summarizeStack,
  truncate,
} from '../../src/client/diagnostics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8'));

/** 假 fetch：记录调用，按 `respond` 决定成功/失败。 */
function createFakeFetch(respond = () => ({ ok: true, status: 200 })) {
  const calls = [];
  return {
    calls,
    fetchImpl(url, init) {
      calls.push({ url, init });
      return Promise.resolve(respond(calls.length - 1));
    },
  };
}

/** 固定时钟（限频窗口可确定性驱动）。 */
function createClock(startMs = Date.parse('2026-10-02T12:00:00.000Z')) {
  let current = startMs;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
  };
}

test('① 载荷字段：插件名 / 阶段 / 消息 / 栈摘要 / 客户端版本 / 时间戳 / 指纹', async () => {
  const fake = createFakeFetch();
  const clock = createClock();
  const reporter = createDiagnosticsReporter({ fetchImpl: fake.fetchImpl, now: clock.now });
  const outcome = reporter.report({ phase: 'apply', message: 'apply 抛错', error: new Error('boom') });
  assert.equal(outcome.accepted, true);
  const payload = outcome.payload;
  assert.equal(payload.plugin, PLUGIN_NAME);
  assert.equal(payload.plugin, 'dsh-gui-frame');
  assert.equal(payload.phase, 'apply');
  assert.equal(payload.message, 'apply 抛错');
  assert.ok(payload.stack.includes('boom'), '栈摘要带原始错误');
  assert.equal(payload.clientVersion, CLIENT_VERSION);
  assert.equal(payload.at, '2026-10-02T12:00:00.000Z');
  assert.equal(payload.fingerprint, hashFingerprint(fingerprintOf({ plugin: PLUGIN_NAME, phase: 'apply', message: 'apply 抛错' })));

  const results = await reporter.flush();
  assert.deepEqual(results, [{ ok: true, reason: null }]);
  assert.equal(reporter.stats().sent, 1);
});

test('② 同源 fetch：路径 / 方法 / 体形状 / credentials', async () => {
  const fake = createFakeFetch();
  const reporter = createDiagnosticsReporter({ fetchImpl: fake.fetchImpl, now: createClock().now });
  reporter.report({ phase: 'render', message: '渲染失败' });
  await reporter.flush();

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.url, DIAGNOSTICS_PATH, '必须是同源相对路径');
  assert.equal(DIAGNOSTICS_PATH, '/api/gui-frame/diagnostics');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.equal(call.init.credentials, 'same-origin', '同源带上载体认证，但**不自建鉴权**');
  const body = JSON.parse(call.init.body);
  assert.equal(body.type, CLIENT_REQUEST_TYPE);
  assert.equal(body.type, 'client-request');
  assert.equal(body.method, DIAGNOSTICS_METHOD);
  assert.equal(body.method, 'gui-frame/diagnostics');
  assert.equal(typeof body.rpcId, 'string');
  assert.equal(body.payload.message, '渲染失败');
  assert.deepEqual(Object.keys(createDiagnosticsEnvelope({ a: 1 }, 'rpc-x')), ['type', 'rpcId', 'method', 'payload']);
});

test('③ 四道闸：限长 / 限频 / 同指纹去重 / 队列封顶', () => {
  const fake = createFakeFetch();
  const clock = createClock();
  const reporter = createDiagnosticsReporter({
    fetchImpl: fake.fetchImpl,
    now: clock.now,
    limits: { maxPerWindow: 2, windowMs: 1000, maxQueue: 1, message: 10, stack: 12 },
  });

  // 限长：消息被截断并计数
  const long = reporter.report({ phase: 'apply', message: 'x'.repeat(50), error: new Error('y'.repeat(50)) });
  assert.ok(long.payload.message.endsWith('…'));
  assert.equal(long.payload.message.length, 11);
  assert.equal(reporter.stats().truncated, 1);

  // 同指纹去重（窗口内）
  const duplicate = reporter.report({ phase: 'apply', message: 'x'.repeat(50) });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'dedup');
  assert.equal(reporter.stats().deduped, 1);

  // 限频：窗口内最多 2 条（已发 1 条，第二条不同消息放行，第三条被限）
  const second = reporter.report({ phase: 'slot', message: '第二条' });
  assert.equal(second.accepted, true);
  const third = reporter.report({ phase: 'render', message: '第三条' });
  assert.equal(third.accepted, false);
  assert.equal(third.reason, 'rate-limit');
  assert.equal(reporter.stats().limited, 1);

  // 窗口一过 ⇒ 恢复
  clock.advance(1001);
  const afterWindow = reporter.report({ phase: 'degrade', message: '窗口后' });
  assert.equal(afterWindow.accepted, true);

  // 队列封顶：maxQueue=1 ⇒ 最早的待发被丢弃
  assert.equal(reporter.stats().queued, 1);
  assert.equal(reporter.stats().dropped >= 1, true);
  assert.equal(DIAGNOSTIC_LIMITS.maxPerWindow, 20);
  assert.equal(DIAGNOSTIC_LIMITS.windowMs, 60000);
});

test('④ fetch 缺席 / 抛错 / HTTP 失败：只计数不抛', async () => {
  const silent = createDiagnosticsReporter({ fetchImpl: undefined });
  silent.report({ phase: 'apply', message: '没有 fetch 的环境' });
  const silentResults = await silent.flush();
  assert.deepEqual(silentResults, [{ ok: false, reason: 'no-fetch' }]);

  const throwing = createDiagnosticsReporter({ fetchImpl: () => Promise.reject(new Error('network down')) });
  throwing.report({ phase: 'apply', message: '网络挂了' });
  const thrown = await throwing.flush();
  assert.equal(thrown[0].ok, false);
  assert.match(thrown[0].reason, /network down/);
  assert.equal(throwing.stats().failed, 1);

  const httpFail = createDiagnosticsReporter({ fetchImpl: () => Promise.resolve({ ok: false, status: 500 }) });
  httpFail.report({ phase: 'apply', message: '宿主 500' });
  const failed = await httpFail.flush();
  assert.equal(failed[0].reason, 'http-500');
  assert.equal(httpFail.stats().failed, 1);
});

test('⑤ 钩子：全局错误被看见；**绝不改写平台共享 slots 服务**；卸载即还原', () => {
  const fake = createFakeFetch();
  const reporter = createDiagnosticsReporter({ fetchImpl: fake.fetchImpl, now: createClock().now });
  const { ctx, effects } = createFakeCtx({ services: {} });

  // 平台上那份**共享** slots 服务的替身：谁动它一根手指都算事故（下面逐条断言它自始至终没被动过）。
  const slotCalls = [];
  const slots = {
    register(options) {
      slotCalls.push(options);
      throw new Error('座位未声明');
    },
    inject(key, callback) {
      slotCalls.push(key);
      return callback();
    },
  };
  const originalRegister = slots.register;
  const originalInject = slots.inject;
  const originalKeys = Object.keys(slots).sort();
  const listeners = new Map();
  const win = {
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((row) => row !== handler));
    },
  };

  const dispose = installDiagnosticsHooks(ctx, reporter, { window: win, slots });
  assert.equal(typeof dispose, 'function');
  assert.equal(effects.length, 1, '钩子经 ctx.effect 挂在调用方 fiber');
  assert.equal(listeners.get('error').length, 1);
  assert.equal(listeners.get('unhandledrejection').length, 1);

  // ★ 共享服务**逐字段原样**（写自有属性会打断 cordis 的调用点 effect 归属）——
  //   旧版会在挂钩期间把 register/inject 换成自己的包装（`assert.notEqual(…)` 就是旧判据），
  //   而那正是打断 cordis 调用点 effect 归属、并已造成一次整页事故的写法。判据翻面为「不许动」。
  assert.equal(slots.register, originalRegister, '不得替换共享服务的成员');
  assert.equal(slots.inject, originalInject, '不得替换共享服务的成员');
  assert.deepEqual(Object.keys(slots).sort(), originalKeys, '不得往共享服务上加自有属性');
  assert.equal(slotCalls.length, 0, '钩子不得替调用方发起任何注册');

  // 调用方自己那一次抛错**照旧抛出**（本包不再拦截它，但绝不吞掉、绝不改写行为）
  assert.throws(() => slots.register({ id: 'x' }), /座位未声明/);
  assert.equal(slotCalls.length, 1, '抛错来自调用方自己那一次，与钩子无关');

  // 全局错误 / 未处理拒绝照旧被看见
  listeners.get('error')[0]({ error: new Error('组件树炸了') });
  assert.equal(reporter.lastPayload().phase, 'render');
  listeners.get('unhandledrejection')[0]({ reason: new Error('没接的 promise') });
  assert.equal(reporter.lastPayload().phase, 'unhandled');

  // 卸载 ⇒ 监听还原；共享服务**自始至终没被碰过**
  effects[0].disposer();
  assert.equal(listeners.get('error').length, 0);
  assert.equal(listeners.get('unhandledrejection').length, 0);
  assert.equal(slots.register, originalRegister);
  assert.equal(slots.inject, originalInject);
  assert.deepEqual(Object.keys(slots).sort(), originalKeys);
  assert.throws(() => installDiagnosticsHooks({}, reporter), /Cordis ctx/);
  assert.throws(() => installDiagnosticsHooks(ctx, {}), /reporter\.report/);

  // 静态闸（防回退）：源码里**不得**出现「把自有属性写到某个 slots 上」的写法。
  // 先剥注释再匹配 —— 上面那段解释性注释里正写着 `slots[method] = wrapped`（不剥注释就是自伤）。
  const source = readFileSync(path.join(HERE, '..', '..', 'src', 'client', 'diagnostics.mjs'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.equal(/\bslots\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=/.test(code), false, '不得往共享 slots 服务写自有属性（防回退闸）');
});

test('⑥ 无 window 环境静默跳过；降级事件与渲染错误报告的形状', () => {
  const reporter = createDiagnosticsReporter({ fetchImpl: () => Promise.resolve({ ok: true }) });
  const { ctx, effects } = createFakeCtx({ services: {} });
  const dispose = installDiagnosticsHooks(ctx, reporter, { window: undefined, slots: undefined });
  assert.equal(effects.length, 1, '仍然注册一条 effect（收尾统一在这里）');
  dispose();

  const event = degradeEvent('channel', 'capability-absent', reporter);
  assert.equal(event.phase, 'degrade');
  assert.match(event.message, /能力「channel」未装配/);
  assert.equal(event.details.capability, 'channel');
  assert.equal(reporter.lastPayload().phase, 'degrade');

  const shape = degradeEvent('panel', 'no-components-face', null);
  assert.equal(shape.details.reason, 'no-components-face', 'rc 为 null 时也要给出事件形状');
  renderErrorReport(reporter, new Error('渲染失败'), { section: 'demo' });
  assert.match(reporter.lastPayload().message, /渲染失败/);
  assert.equal(renderErrorReport(null, new Error('x')), null);
});

test('⑦ 纯函数：describeError / truncate / summarizeStack / 版本常量', () => {
  assert.equal(describeError(null), '未知错误（null/undefined）');
  assert.equal(describeError('字符串错'), '字符串错');
  assert.equal(describeError(new Error('有消息')), '有消息');
  assert.deepEqual(truncate('abcdef', 3), { text: 'abc…', truncated: true });
  assert.deepEqual(truncate('ab', 3), { text: 'ab', truncated: false });
  const stack = summarizeStack(new Error('boom'), { maxLines: 2 });
  assert.ok(stack.stack.split('\n').length <= 2);
  assert.equal(summarizeStack({}).stack, '');
  assert.equal(CLIENT_VERSION, PKG.version, '★ 客户端版本常量必须与 package.json 的 version 一致');
  assert.equal(PLUGIN_NAME, PKG.name);
});
