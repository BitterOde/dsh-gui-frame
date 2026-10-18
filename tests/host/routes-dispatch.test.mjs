/**
 * routes-dispatch.test.mjs —— **宿主端点的线上协议与四条分支**。
 *
 * 判据：
 *  1. 请求体是**官方** `{ type:'client-request', rpcId, method, payload }`，响应体是
 *     `{ type:'server-response', rpcId, result }`，`result` 是 `{ok:true,value}` / `{ok:false,error}`；
 *  2. 家族业务字段（`data/warnings/changed/rev/undoToken`）装在 `value` 里 —— 客户端适配层再摊平；
 *  3. `demo` 的 ok / empty / error / slow 四条模式各有一条断言（对应 demo 端点要演示的 loading/空/错/刷新）；
 *  4. 信封坏 / 路径与 method 不一致 / 端点抛错 ⇒ 一律收敛成官方失败结果，**不把栈甩给调用方**；
 *  5. `ping` 与 `demo` 的路径逐字等于 `/api/gui-frame/<端点>`。
 *
 * 纪律：本用例零网络（直接调 handler）、零 DOM、不写盘。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeCtx } from '../helpers/fake-ctx.mjs';
import {
  DEFAULT_DEMO_DELAY_MS,
  HOST_ERROR_CODES,
  ROUTE_PREFIX,
  createEndpointTable,
  createFetchHandler,
  errorResult,
  okResult,
  readClientRequest,
  registerRoutes,
} from '../../src/host/routes.mjs';

/** 假 connection（与 routes-register.test.mjs 同形的最小实现）。 */
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

/** 起一个"注册好了"的宿主：返回按 path 取 handler 的助手。 */
function setup(options = {}) {
  const connection = createFakeConnection();
  const { ctx, logs, calls } = createFakeCtx({ services: { connection: connection.service } });
  const result = registerRoutes(ctx, options);
  assert.equal(result.ok, true);
  const call = async (name, body, init = {}) => {
    const path = `${ROUTE_PREFIX}/${name}`;
    const route = connection.routes.get(path);
    assert.ok(route, `路由未注册：${path}`);
    const request = new Request(`http://dsh.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...init,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const response = await route.fetch(request);
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { response, json, text, route };
  };
  return { connection, ctx, logs, calls, call, result };
}

/** 官方请求信封。 */
function requestOf(name, payload, rpcId = 'rpc-1') {
  return { type: 'client-request', rpcId, method: `gui-frame/${name}`, payload };
}

test('① 成功路径：官方响应信封 + 家族业务字段装在 value 里', async () => {
  const { call } = setup();
  const { response, json } = await call('ping', requestOf('ping', { params: { hello: 'world' } }));
  assert.equal(response.status, 200);
  assert.ok(String(response.headers.get('content-type')).includes('application/json'), 'JSON content-type');
  assert.equal(json.type, 'server-response');
  assert.equal(json.rpcId, 'rpc-1', 'rpcId 必须原样回（平台客户端会逐字核对）');
  assert.equal(json.result.ok, true);
  assert.equal(json.result.value.data.pong, true);
  assert.deepEqual(json.result.value.data.echo, { hello: 'world' });
  assert.deepEqual(Object.keys(json.result.value).sort(), ['changed', 'data', 'rev', 'undoToken', 'warnings'], '家族 5 字段齐备（客户端适配层据此摊平）');
  assert.equal(json.result.value.changed, false);
  assert.deepEqual(json.result.value.warnings, []);
});

test('② demo 四条模式：ok / empty / error / slow（demo 端点要演示的四态）', async () => {
  const { call } = setup({ demoDelayMs: 0, sleep: () => Promise.resolve() });
  assert.equal(ROUTE_PREFIX, '/api/gui-frame', 'demo 调 /api/gui-frame/<端点>');

  const ok = await call('demo', requestOf('demo', { params: {} }));
  assert.equal(ok.json.result.ok, true);
  assert.equal(ok.json.result.value.data.items.length, 4);
  assert.equal(ok.json.result.value.changed, false);

  const empty = await call('demo', requestOf('demo', { params: { mode: 'empty' } }));
  assert.equal(empty.json.result.ok, true);
  assert.deepEqual(empty.json.result.value.data.items, []);
  assert.equal(empty.json.result.value.data.total, 0);

  const failed = await call('demo', requestOf('demo', { params: { mode: 'error' } }));
  assert.equal(failed.json.result.ok, false, 'error 分支必须走 ok:false');
  assert.equal(failed.json.result.error.code, HOST_ERROR_CODES.DEMO_FAILURE);
  assert.equal(typeof failed.json.result.error.message, 'string');

  const slow = await call('demo', requestOf('demo', { params: { mode: 'slow' } }));
  assert.equal(slow.json.result.ok, true, 'slow 只是慢，最终仍是成功（客户端用 timeoutMs 打断）');
  assert.equal(DEFAULT_DEMO_DELAY_MS > 0, true, '缺省延迟必须 > 0（否则超时演示没有意义）');
});

test('③ 变更语义：mutate ⇒ rev 前进 + changed=true + undoToken；warn ⇒ warnings 有值', async () => {
  const { call } = setup({ demoDelayMs: 0, sleep: () => Promise.resolve() });
  const first = await call('demo', requestOf('demo', { params: {} }));
  const before = first.json.result.value.rev;
  const mutated = await call('demo', requestOf('demo', { params: { mutate: true, warn: true } }));
  assert.equal(mutated.json.result.value.changed, true);
  assert.equal(mutated.json.result.value.rev, before + 1, 'rev 必须单调前进（revision 围栏靠它）');
  assert.equal(typeof mutated.json.result.value.undoToken, 'string');
  assert.equal(mutated.json.result.value.warnings.length, 1);
  const after = await call('demo', requestOf('demo', { params: {} }));
  assert.equal(after.json.result.value.rev, before + 1, '非变更调用不得推 rev');
  assert.equal(after.json.result.value.changed, false);
});

test('④ 坏信封 / 路径与 method 不一致：一律官方失败结果，不甩栈', async () => {
  const { call } = setup();
  const badType = await call('ping', { type: 'nope', rpcId: 'rpc-9', method: 'gui-frame/ping', payload: null });
  assert.equal(badType.json.result.ok, false);
  assert.equal(badType.json.result.error.code, HOST_ERROR_CODES.BAD_REQUEST);
  assert.equal(badType.json.rpcId, 'rpc-9', '能读到 rpcId 就原样回（客户端靠它核对关联）');

  const mismatch = await call('demo', requestOf('ping', { params: {} }, 'rpc-7'));
  assert.equal(mismatch.json.result.ok, false);
  assert.equal(mismatch.json.result.error.code, HOST_ERROR_CODES.BAD_REQUEST);
  assert.match(mismatch.json.result.error.message, /路径与信封 method 不一致/);

  const notJson = await call('ping', 'not-json-at-all');
  assert.equal(notJson.json.result.ok, false);
  assert.equal(notJson.json.result.error.code, HOST_ERROR_CODES.BAD_REQUEST);
  assert.equal(notJson.json.rpcId, 'invalid-request', '没有 rpcId 就用占位（对齐平台做法）');
});

test('⑤ 端点抛错 / 返回非法结果 ⇒ 收敛成 internal，栈只进 logger', async () => {
  const { logs, calls, call } = setup({
    endpoints: new Map([
      ['boom', () => {
        throw new Error('端点内部炸了（这条不能出现在响应里）');
      }],
      ['weird', () => ({ nope: true })],
    ]),
  });
  const boom = await call('boom', requestOf('boom', {}));
  assert.equal(boom.json.result.ok, false);
  assert.equal(boom.json.result.error.code, HOST_ERROR_CODES.INTERNAL);
  assert.ok(!boom.json.result.error.message.includes('端点内部炸了'), '响应里不得回显内部错误文案');
  assert.ok(logs.some((row) => row.level === 'error' && row.message.includes('端点 boom 抛错')), '内部错误要进 logger');

  const weird = await call('weird', requestOf('weird', {}));
  assert.equal(weird.json.result.ok, false);
  assert.equal(weird.json.result.error.code, HOST_ERROR_CODES.INTERNAL);
  assert.ok(calls.effect.length >= 2, '每条路由都经 ctx.effect 注册');
});

test('⑥ 信封读取与结果形状的纯函数判据', async () => {
  const parsed = await readClientRequest(new Request('http://x/api/gui-frame/ping', { method: 'POST', body: JSON.stringify(requestOf('ping', { a: 1 }, 'rpc-3')) }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rpcId, 'rpc-3');
  assert.equal(parsed.method, 'gui-frame/ping');
  assert.deepEqual(parsed.payload, { a: 1 });

  assert.deepEqual(okResult({ x: 1 }, { changed: true, rev: 3, undoToken: 'u', warnings: ['w'] }), {
    ok: true,
    value: { data: { x: 1 }, warnings: ['w'], changed: true, rev: 3, undoToken: 'u' },
  });
  assert.deepEqual(errorResult('gui-frame/x', 'm', { d: 1 }), { ok: false, error: { code: 'gui-frame/x', message: 'm', details: { d: 1 } } });
  assert.deepEqual([...createEndpointTable().keys()].sort(), ['demo', 'ping']);

  // handler 直接用（不经路由）时也要认它
  const handler = createFetchHandler({ name: 'ping', handle: createEndpointTable().get('ping') });
  const response = await handler(new Request('http://x/api/gui-frame/ping', { method: 'POST', body: JSON.stringify(requestOf('ping', null, 'rpc-5')) }));
  assert.equal((await response.json()).rpcId, 'rpc-5');
});
