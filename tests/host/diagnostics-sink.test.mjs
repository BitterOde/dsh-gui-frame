/**
 * diagnostics-sink.test.mjs —— **宿主诊断收端**的机检门禁。
 *
 * 判据：
 *  1. 收端经 `routes.mjs` 的**既有扩展点**注册：`registerRoutes(ctx, {extraRoutes})` ⇒ 精确路由
 *     `/api/gui-frame/diagnostics`，形状仍是 `{path, methods, requestBody, fetch}`；
 *  2. 端到端：真的构造官方 `{type:'client-request', rpcId, method, payload}` 打进那条路由的 `fetch`，
 *     收端能解出载荷并打印；
 *  3. **两层打印**：`ctx.logger.warn(line)` 与 `process.stderr.write` 都发生，且行首是
 *     `[gui-frame] 客户端失败`（cmd 可见性由 stderr 直写承担 —— 实测默认阈值下 `logger.warn`
 *     连内存 buffer 都进不去）；
 *  4. **限长**（message 400 / stack 800，截断而非丢弃，计数 `truncated`）；
 *  5. **指纹去重**：**三条同指纹输入 ⇒ 只打印一次**；
 *  6. **总条数封顶**：超过 `limits.maxEntries` ⇒ 只计数不打印（`reason:'capped'`）；
 *  7. `src/host/index.mjs` **不自行实现路由**（源码扫描：没有 `fetch.register` / `webServer.register`，
 *     只有对 `registerRoutes` 的调用）。
 *
 * 纪律：零真实网络（假 connection + 直接调 handler）、不写盘。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFakeCtx } from '../helpers/fake-ctx.mjs';
import {
  CLIENT_FAILURE_PREFIX,
  DIAGNOSTICS_ENDPOINT,
  DIAGNOSTICS_LIMITS,
  applyRoutes,
  apply,
  createDiagnosticsSink,
  fingerprintOf,
  hashFingerprint,
} from '../../src/host/index.mjs';
import { ROUTE_PREFIX, routePathOf } from '../../src/host/routes.mjs';
// 跨半区契约检查（**只读 import 客户端常量**）：客户端发的 path/method 必须与宿主注册的逐字一致，
// 否则诊断端点在真机上永远 404（而"上报静默失败"恰恰是最难发现的那类故障）。
import { DIAGNOSTICS_METHOD as CLIENT_METHOD, DIAGNOSTICS_PATH as CLIENT_PATH, CLIENT_REQUEST_TYPE } from '../../src/client/diagnostics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_INDEX = path.join(HERE, '..', '..', 'src', 'host', 'index.mjs');

/** 假 connection（与 routes-*.test.mjs 同形）。 */
function createFakeConnection() {
  const routes = new Map();
  return {
    routes,
    service: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      },
    },
  };
}

/** 收端夹具：捕获 stderr 行与 logger 行。 */
function createSink(options = {}) {
  const stderr = [];
  const warn = [];
  const sink = createDiagnosticsSink({
    logger: { warn: (line) => warn.push(String(line)) },
    write: (line) => {
      stderr.push(String(line));
      return true;
    },
    now: () => Date.parse('2026-10-02T12:00:00.000Z'),
    ...options,
  });
  return { sink, stderr, warn };
}

/** 一条上报载荷（客户端 `diagnostics.mjs` 的字段集）。 */
function payloadOf(overrides = {}) {
  return {
    plugin: 'dsh-gui-frame',
    phase: 'apply',
    message: 'apply 抛错（已吞，页面照常）：boom',
    stack: 'Error: boom\n    at assemble (entry.mjs:1)',
    clientVersion: '0.0.1',
    at: '2026-10-02T11:59:00.000Z',
    fingerprint: 'deadbeef',
    ...overrides,
  };
}

test('① 注册路径：走 registerRoutes 的 extraRoutes，形状与内置端点完全一致', () => {
  const connection = createFakeConnection();
  const { ctx, calls } = createFakeCtx({ services: { connection: connection.service } });
  const { sink } = createSink();
  const result = applyRoutes(ctx, { sink });

  assert.equal(result.ok, true);
  assert.deepEqual(result.routes, [routePathOf('ping'), routePathOf('demo'), routePathOf(DIAGNOSTICS_ENDPOINT)]);
  const route = connection.routes.get(routePathOf(DIAGNOSTICS_ENDPOINT));
  assert.ok(route !== undefined, '诊断端点必须注册成精确路由');
  assert.deepEqual(route.methods, ['POST']);
  assert.equal(route.requestBody, 'buffered');
  assert.equal(typeof route.fetch, 'function');
  assert.equal(calls.effect.length, 3, '三条路由各一条 effect（随 fiber 卸载）');
  assert.equal(result.sink, sink);
});

test('② 端到端：官方信封打进诊断路由 ⇒ 收端解出载荷并打印两层', async () => {
  const connection = createFakeConnection();
  const { ctx } = createFakeCtx({ services: { connection: connection.service } });
  const { sink, stderr, warn } = createSink();
  applyRoutes(ctx, { sink });
  const route = connection.routes.get(routePathOf(DIAGNOSTICS_ENDPOINT));

  const request = new Request(`http://dsh.internal${routePathOf(DIAGNOSTICS_ENDPOINT)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-d1', method: `gui-frame/${DIAGNOSTICS_ENDPOINT}`, payload: payloadOf() }),
  });
  const response = await route.fetch(request);
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.rpcId, 'rpc-d1');
  assert.equal(json.result.ok, true);
  assert.equal(json.result.value.data.accepted, true);
  assert.equal(json.result.value.data.printCount, 1);

  assert.equal(stderr.length, 1, 'stderr 直写一次');
  assert.equal(warn.length, 1, 'logger.warn 一次');
  assert.ok(stderr[0].startsWith(CLIENT_FAILURE_PREFIX), `stderr 行首必须是 ${CLIENT_FAILURE_PREFIX}`);
  assert.ok(stderr[0].includes('dsh-gui-frame'), '行里带插件名');
  assert.ok(stderr[0].includes('apply'), '行里带阶段');
  assert.ok(stderr[0].includes('boom'), '行里带消息');
  assert.ok(stderr[0].includes('entry.mjs:1'), '行里带栈摘要');
  assert.equal(warn[0], stderr[0], '两层打的是同一行（可 grep 一致）');
});

test('③ ★ 三条同指纹输入 ⇒ 只打印一次', () => {
  const { sink, stderr, warn } = createSink();
  const first = sink.handle(payloadOf());
  const second = sink.handle(payloadOf({ at: '2026-10-02T12:00:05.000Z' })); // 时间戳不同 ⇒ 指纹必须相同
  const third = sink.handle(payloadOf({ stack: 'Error: boom\n    at other (x.mjs:9)' })); // 栈不同 ⇒ 指纹仍相同

  assert.equal(first.value.data.accepted, true);
  assert.equal(first.value.data.printCount, 1);
  assert.equal(second.value.data.accepted, false);
  assert.equal(second.value.data.reason, 'duplicate');
  assert.equal(third.value.data.reason, 'duplicate');
  assert.equal(stderr.length, 1, '三条同指纹 ⇒ stderr 只出现一次');
  assert.equal(warn.length, 1, '三条同指纹 ⇒ logger 只出现一次');
  assert.equal(first.value.data.fingerprint, second.value.data.fingerprint);
  assert.equal(second.value.data.fingerprint, third.value.data.fingerprint);
  const stats = sink.stats();
  assert.equal(stats.received, 3);
  assert.equal(stats.accepted, 1);
  assert.equal(stats.deduped, 2);
  assert.equal(stats.printed, 1);

  // 换一条消息 ⇒ 指纹不同 ⇒ 再打印一次
  const other = sink.handle(payloadOf({ message: '另一条错误' }));
  assert.equal(other.value.data.accepted, true);
  assert.equal(stderr.length, 2);

  // 指纹的构成：plugin|phase|message（**不含时间戳**，否则去重失效）
  assert.equal(fingerprintOf({ plugin: 'p', phase: 'apply', message: 'm' }), 'p|apply|m');
  assert.equal(hashFingerprint('p|apply|m').length, 8);
});

test('④ 限长：message 400 / stack 800 截断并计数（截断 ≠ 丢弃）', () => {
  assert.equal(DIAGNOSTICS_LIMITS.message, 400);
  assert.equal(DIAGNOSTICS_LIMITS.stack, 800);
  const { sink, stderr } = createSink();
  const longMessage = 'x'.repeat(1000);
  const longStack = Array.from({ length: 40 }, (unused, index) => `    at frame${index} (f.mjs:${index})`).join('\n');
  const result = sink.handle(payloadOf({ message: longMessage, stack: longStack }));
  assert.equal(result.value.data.accepted, true);
  assert.equal(sink.stats().truncated, 1);
  assert.ok(stderr[0].includes('…'), '被截断的字段留省略号');
  assert.ok(stderr[0].length < 1000, `打印行必须有界（实际 ${stderr[0].length}）`);
  assert.ok(stderr[0].split('\n').length <= 3, '栈只留前两行（摘要而非全文）');
});

test('⑤ 总条数封顶：超过 maxEntries 后只计数不打印', () => {
  const { sink, stderr } = createSink({ limits: { maxEntries: 3 } });
  for (let index = 0; index < 5; index += 1) sink.handle(payloadOf({ message: `第 ${index} 条` }));
  assert.equal(stderr.length, 3, '前三条打印');
  const stats = sink.stats();
  assert.equal(stats.received, 5);
  assert.equal(stats.printed, 3);
  assert.equal(stats.capped, 2);
  const last = sink.handle(payloadOf({ message: '第六条' }));
  assert.equal(last.value.data.accepted, false);
  assert.equal(last.value.data.reason, 'capped');
  assert.equal(last.value.data.printCount, 0);

  // 指纹表也有上限（防长期运行把 Map 撑爆）
  const small = createSink({ limits: { maxFingerprints: 2 } });
  small.sink.handle(payloadOf({ message: 'a' }));
  small.sink.handle(payloadOf({ message: 'b' }));
  const over = small.sink.handle(payloadOf({ message: 'c' }));
  assert.equal(over.value.data.reason, 'capped');
  assert.equal(small.sink.stats().fingerprints, 2);
});

test('⑥ 载荷形态：非对象 ⇒ 官方失败结果；缺字段 ⇒ 用缺省值兜住（不抛）', () => {
  const { sink } = createSink();
  for (const bad of [null, undefined, 42, 'x', ['a']]) {
    const result = sink.handle(bad);
    assert.equal(result.ok, false, `非对象载荷必须拒：${JSON.stringify(bad)}`);
    assert.equal(typeof result.error.message, 'string');
  }
  const sparse = sink.handle({ message: '只有消息' });
  assert.equal(sparse.value.data.accepted, true);
  assert.equal(sink.stats().invalid, 5, 'null/undefined/42/字符串/数组五条全判非法');
});

test('⑦ 宿主 apply：绝不抛、返回 undefined；src/host/index.mjs 不自行实现路由', () => {  const connection = createFakeConnection();
  const { ctx } = createFakeCtx({ services: { connection: connection.service } });
  assert.equal(apply(ctx), undefined);
  assert.equal(connection.routes.size, 3, 'apply 会装齐三条路由');

  // 依赖缺失：不抛、不注册，只记一条 warn
  const bare = createFakeCtx({ services: {} });
  assert.equal(apply(bare.ctx), undefined);
  assert.ok(bare.logs.some((row) => row.level === 'warn' && row.message.includes('宿主路由未注册')));

  // 形状非法也不抛
  assert.equal(apply(null), undefined);
  assert.equal(apply({}), undefined);

  // 源码扫描：路由注册只能来自 routes.mjs
  const source = readFileSync(HOST_INDEX, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.ok(code.includes('registerRoutes('), '必须调用 routes.mjs 的注册函数');
  for (const banned of ['fetch.register', 'webServer.register', 'requestRejection', 'createFetchHandler', "kind: 'prefix'"]) {
    assert.ok(!code.includes(banned), `宿主入口不得自行实现路由（出现 ${banned}）`);
  }
  assert.ok(!/path:/.test(code), '宿主入口不得自己拼路由 path');
  assert.ok(code.includes('extraRoutes'), '诊断端点走 routes.mjs 的既有扩展点');
  assert.equal(ROUTE_PREFIX, '/api/gui-frame');

  // ★ 跨半区契约：客户端发的 path / method / 信封 type 与宿主注册的逐字一致
  assert.equal(CLIENT_PATH, routePathOf(DIAGNOSTICS_ENDPOINT), '客户端上报路径 === 宿主注册的精确路由');
  assert.equal(CLIENT_METHOD, `gui-frame/${DIAGNOSTICS_ENDPOINT}`, '客户端信封 method === 宿主期望的 method');
  assert.equal(CLIENT_REQUEST_TYPE, 'client-request');
});
