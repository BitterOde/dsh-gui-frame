/**
 * routes-register.test.mjs —— **宿主侧路由注册**的机检门禁。
 *
 * 判据：
 *  1. 用 `ctx.connection.fetch.register({path, methods, requestBody, fetch})` 注册 —— 形状逐字段核对；
 *  2. 每个端点注册**恰好一条精确路由**（平台按 `url.pathname` 精确命中；等价于"精确路由"语义）；
 *  3. 注册发生在 `ctx.effect(...)` 里 ⇒ 卸载时路由跟着走（本用例把 fake register 的 disposer 跑掉验证）；
 *  4. **不自建鉴权**：源码里不得出现 authorization / bearer / cookie / 401 / 403 之类字样；
 *  5. 依赖缺失（没有 connection / 没有 fetch.register）⇒ 不注册、**不抛**、有日志。
 *
 * 纪律：本用例零网络、零 DOM、不写盘、不需要 DSH 在跑。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFakeCtx } from '../helpers/fake-ctx.mjs';
import {
  ROUTE_METHODS,
  ROUTE_PREFIX,
  ROUTE_REQUEST_BODY,
  registerRoute,
  registerRoutes,
  routePathOf,
} from '../../src/host/routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_SOURCE = path.join(HERE, '..', '..', 'src', 'host', 'routes.mjs');

/** 假 connection 服务：register 的语义对齐平台（重复 path ⇒ throw、返回 disposer）。 */
function createFakeConnection() {
  const routes = new Map();
  return {
    routes,
    registrations: [],
    service: {
      fetch: {
        register(route) {
          if (routes.has(route.path)) throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`);
          routes.set(route.path, route);
          this.registrations ??= [];
          return () => {
            routes.delete(route.path);
          };
        },
      },
    },
  };
}

test('① 用官方 fetch.register 注册：path/methods/requestBody/fetch 逐字段对齐', () => {
  const connection = createFakeConnection();
  const { ctx, logs, calls } = createFakeCtx({ services: { connection: connection.service } });
  const result = registerRoutes(ctx);

  assert.equal(result.ok, true, 'connection 在 ⇒ 必须注册成功');
  assert.deepEqual(result.routes, [routePathOf('ping'), routePathOf('demo')], '内置两条端点路由');
  assert.deepEqual([...connection.routes.keys()].sort(), [routePathOf('demo'), routePathOf('ping')]);
  assert.equal(new Set(result.routes).size, result.routes.length, '同一 path 不得注册两次（平台会 throw）');

  for (const route of connection.routes.values()) {
    assert.equal(typeof route.fetch, 'function', '每条路由都要有 fetch');
    assert.deepEqual(route.methods, [...ROUTE_METHODS], 'methods 恒为 POST');
    assert.equal(route.requestBody, ROUTE_REQUEST_BODY, 'requestBody 恒为 buffered');
    assert.ok(route.path.startsWith(`${ROUTE_PREFIX}/`), `path 必须在 ${ROUTE_PREFIX}/ 之下：${route.path}`);
    assert.ok(!('handler' in route), '不得用 webServer 的 {kind,path,handler} 形态 —— 那是绕过 /api 鉴权链的另一条路');
  }
  assert.ok(logs.some((row) => row.level === 'info' && row.message.includes('精确 Fetch 路由')), '注册后有一条 info 日志');
  assert.equal(calls.effect.length, 2, '每条路由都在 ctx.effect 里注册（卸载即摘）');
});

test('② 卸载：effect 的 disposer 跑掉 ⇒ 路由从注册表消失（不残留）', () => {
  const connection = createFakeConnection();
  const { ctx, dispose } = createFakeCtx({ services: { connection: connection.service } });
  const result = registerRoutes(ctx);
  assert.equal(connection.routes.size, 2);
  dispose();
  assert.equal(connection.routes.size, 0, '卸载后不得留下任何路由（否则重挂载会 duplicate 抛错）');
  result.dispose();
  assert.equal(connection.routes.size, 0, '显式 dispose 幂等');
});

test('③ 依赖缺失：没有 connection ⇒ 不注册、不抛、有 warn', () => {
  const { ctx, logs, calls } = createFakeCtx({ services: {} });
  let result;
  assert.doesNotThrow(() => {
    result = registerRoutes(ctx);
  }, '宿主 apply 抛错会连累整页 —— 缺依赖必须静默降级');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'connection-absent');
  assert.equal(calls.effect.length, 0, '没注册就不得留下 effect');
  assert.ok(logs.some((row) => row.level === 'warn' && row.message.includes('connection 服务缺席')), '缺依赖要留一条 warn');
});

test('④ 有 connection 但没有 fetch.register ⇒ 同样不抛（不静默假装注册成功）', () => {
  const { ctx, logs } = createFakeCtx({ services: { connection: { rpc: {} } } });
  const result = registerRoutes(ctx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'fetch-registry-absent');
  assert.ok(logs.some((row) => row.level === 'warn' && row.message.includes('connection.fetch.register 不可用')));
});

test('⑤ 不自建鉴权：源码里没有 auth 字样（trust/auth 由 /api 载体统一施加）', () => {
  const source = readFileSync(ROUTES_SOURCE, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  for (const banned of ['authorization', 'bearer', 'cookie', 'set-cookie', 'writeHead(401', 'writeHead(403', "status: 401", "status: 403", 'unauthorized']) {
    assert.ok(!code.toLowerCase().includes(banned.toLowerCase()), `宿主半区不得出现 ${banned}（不自建鉴权）`);
  }
  assert.ok(!/requestRejection/.test(code), 'requestRejection 是平台 /api 路由的事，插件不该自己调');
});

test('⑥ 扩展端点走同一个注册函数（registerRoute / extraRoutes 而不改注册方式）', () => {
  const connection = createFakeConnection();
  const { ctx } = createFakeCtx({ services: { connection: connection.service } });
  const result = registerRoutes(ctx, {
    extraRoutes: [{ name: 'diagnostics', handle: () => ({ ok: true, value: { data: { received: true } } }) }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.routes, [routePathOf('ping'), routePathOf('demo'), routePathOf('diagnostics')]);
  assert.ok(connection.routes.has(routePathOf('diagnostics')));
  // 单条注册也是同一形状
  const single = registerRoute(ctx, { name: 'extra', handle: () => ({ ok: true, value: { data: null } }) });
  assert.equal(single.ok, true);
  assert.equal(single.path, routePathOf('extra'));
  assert.deepEqual(connection.routes.get(routePathOf('extra')).methods, ['POST']);
});

test('⑦ 端点名形态与路由路径：非法段落一律拒（与平台 endpointFromPath 同形）', () => {
  const { ctx } = createFakeCtx({ services: {} });
  assert.equal(routePathOf('demo'), '/api/gui-frame/demo');
  assert.equal(routePathOf('a/b'), '/api/gui-frame/a/b');
  for (const bad of ['', 'a//b', 'a/../b', 'a/./b', 'a b', 'a?b']) {
    assert.throws(() => routePathOf(bad), /端点名/, `非法端点名必须拒：${JSON.stringify(bad)}`);
  }
  assert.throws(() => registerRoutes({}, {}), /Cordis ctx/, 'registerRoutes 需要真 ctx');
});
