/**
 * settings-namespace.test.mjs —— **宿主侧 settings 命名空间注册**的机检门禁。
 *
 * 真机实证过：坞面板编辑器读到 `unavailable（只读）`、显式覆盖锚点计数 0 ——
 * `gui-frame` 命名空间从来没在宿主侧注册过 ⇒ 客户端 `settingsScope` 恒 `unavailable` ⇒ 布局持久化只读。
 *
 * 判据逐条（每条都写明**什么情况下会红**）：
 *  ① 注册真的发生：`settings.register('gui-frame', <schema>, {applies:'live'})` 被调用，schema 里有 `layout` 字段；
 *     会红：没注册、命名空间写错、字段名写错、或退了 `applies`。
 *  ② **挂对 fiber**：注册经由插件自己的 ctx（`ctx.effect` 记账带固定 label），fake settings 按真机实现
 *     （`register` 内部那条 effect 绑调用点 ctx）模拟 ⇒ 跑掉 ctx 的 effect disposer 后注册消失；
 *     会红：注册挂到别处（例如 `ctx.inject(…)` 回调的临时 scope，见 ④ 的结构闸）。
 *  ③ 集成：`applyRoutes(ctx)` 会发起注册，且**同步返回**（返回 Promise 会被 Cordis 当 effect 收走），
 *     注册结果经 `awaitSettingsInstall()` 可读。会红：applyRoutes 不再发起注册、或改成异步返回。
 *  ④ 结构闸 + 变异负控：宿主半区**不得**出现 `ctx.inject(...)` 注册回调、
 *     `index.mjs` 必须声明 `inject` 含 `settings` 且必须调用 `installSettingsNamespace(ctx, …)`；
 *     三条内存变异必须各自被判红（证明这条判据**能红**，不是恒真）。
 *  ⑤ 失败分支一律不抛、给可读理由：缺服务 / schemastery 取不到 / schema 不合法 / 注册被拒 / 没有 effect 面。
 *  ⑥ 平台包只许 `import()`：宿主半区不得有静态 `import … from '@deepseek-ai/…'`（依赖边界）。
 *
 * 纪律：零网络、零 DOM、不写盘；诊断只走 stderr（node --test 的 stdout 是协议流）。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { awaitSettingsInstall, applyRoutes, inject } from '../../src/host/index.mjs';
import {
  LAYOUT_FIELD,
  LAYOUT_NAMESPACE,
  SCHEMASTER_SPECIFIER,
  SETTINGS_APPLIES,
  SETTINGS_EFFECT_LABEL,
  createLayoutSchema,
  installSettingsNamespace,
} from '../../src/host/settings.mjs';
import { createFakeCtx } from '../helpers/fake-ctx.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_DIR = path.join(HERE, '..', '..', 'src', 'host');

/** 剥注释（结构闸先剥注释：注释里的同名串不算代码）。 */
function codeOf(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 宿主半区全部源码（相对路径 → 剥注释后的代码面）。 */
function hostSources() {
  return readdirSync(HOST_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => ({ name, code: codeOf(readFileSync(path.join(HOST_DIR, name), 'utf8')) }));
}

/**
 * schemastery 替身（只用到本包 schema 需要的那几个构造器）。
 * ★ `boolean()`（带 `.default()`）是给门控字段 `testWorkbench` 用的 —— 它是一个**缺省 false 的布尔**。
 */
function createFakeSchemastery() {
  const leaf = (kind) => {
    const node = { kind, defaultValue: undefined };
    node.default = (value) => {
      node.defaultValue = value;
      return node;
    };
    return node;
  };
  return {
    object: (shape) => ({ kind: 'object', shape }),
    any: () => leaf('any'),
    boolean: () => leaf('boolean'),
  };
}

/**
 * 假 settings 服务：**语义对齐装机实现**（`dsh-settings` 的 `register`）——
 * 注册体是**调用点 ctx 上的一条 effect**，取消即注销；重名一律抛。
 * @param {object} ctx 注册时的调用点 ctx（用它挂 effect，才能模拟"注册随谁卸载"）
 */
function createFakeSettings(ctx) {
  const registrations = new Map();
  const calls = [];
  return {
    registrations,
    calls,
    service: {
      register(ns, schema, options) {
        if (registrations.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`);
        calls.push({ ns, schema, options });
        ctx.effect(() => {
          registrations.set(ns, { schema, options });
          return () => registrations.delete(ns);
        }, `settings.register(${JSON.stringify(ns)})`);
        return { get: () => undefined, update: async () => {}, replace: async () => {} };
      },
    },
  };
}

const fakeImporter = async (specifier) => {
  assert.equal(specifier, SCHEMASTER_SPECIFIER, '取 schema 库只能按常量名去 import()');
  return { default: createFakeSchemastery() };
};

test('注册真的发生：ns / 字段 / schema / applies 逐项对得上，且带固定 effect 标签', async () => {
  const { ctx, calls } = createFakeCtx({});
  const settings = createFakeSettings(ctx);
  const report = await installSettingsNamespace(ctx, { settings: settings.service, importModule: fakeImporter });

  assert.equal(report.registered, true, `注册必须成功：${report.reason ?? ''}`);
  assert.equal(report.namespace, LAYOUT_NAMESPACE);
  assert.equal(report.field, LAYOUT_FIELD);
  assert.equal(settings.calls.length, 1, '恰好注册一次（重复注册在真机上会抛）');
  const call = settings.calls[0];
  assert.equal(call.ns, 'gui-frame', '命名空间恒为 gui-frame（与客户端 bind 的 namespace 逐字相同）');
  assert.deepEqual(call.options, { applies: SETTINGS_APPLIES }, 'applies 恒为 live（布局改动立即生效）');
  assert.equal(call.schema.kind, 'object', 'schema 必须是 schemastery 的 object');
  assert.deepEqual(Object.keys(call.schema.shape), ['layout', 'testWorkbench', 'workbenchSwitch'], '★ 三个字段都声明（布局载荷 + 测试工作台门控 + 开关外观覆盖）');
  assert.equal(call.schema.shape.layout.kind, 'any', 'layout 用 z.any() 原样透传：坏载荷必须能被客户端读到（否则显式覆盖又不可达）');
  assert.equal(call.schema.shape.testWorkbench.kind, 'boolean', 'testWorkbench 是布尔门控');
  assert.equal(call.schema.shape.testWorkbench.defaultValue, false, '★ 缺省 false：什么都没设 ⇒ 客户端读到明确的「关」⇒ 开关自动隐藏（默认就是 DSH 原版）');
  assert.equal(call.schema.shape.workbenchSwitch.kind, 'any', 'workbenchSwitch 用 z.any() 原样透传（校验与归一的真源在客户端 `switch.mjs`）');
  assert.ok(calls.effect.includes(SETTINGS_EFFECT_LABEL), '注册动作必须留下带固定 label 的 effect（可机检、可真机日志核对）');
  assert.equal(typeof report.dispose, 'function', '报告里必须给出这条 effect 的 disposer');
});

test('挂对 fiber：跑掉 ctx 的 effect disposer ⇒ 注册消失（卸载即注销）', async () => {
  const fake = createFakeCtx({});
  const settings = createFakeSettings(fake.ctx);
  const report = await installSettingsNamespace(fake.ctx, { settings: settings.service, importModule: fakeImporter });
  assert.equal(report.registered, true);
  assert.equal(settings.registrations.has(LAYOUT_NAMESPACE), true, '注册当时在册');

  const ran = fake.dispose();
  assert.ok(ran >= 2, `至少要跑掉两条 effect（注册本体 + 本插件的记账）：实际 ${ran}`);
  assert.equal(settings.registrations.has(LAYOUT_NAMESPACE), false, '★ 插件卸载（effect 被取消）⇒ 命名空间注销');
});

test('集成：applyRoutes 会发起注册且**同步返回**，结果经 awaitSettingsInstall() 可读', async () => {
  const fake = createFakeCtx({});
  const settings = createFakeSettings(fake.ctx);
  let returned = 'unset';
  assert.doesNotThrow(() => {
    returned = applyRoutes(fake.ctx, { sink: {}, retry: false, settings: settings.service, importModule: fakeImporter });
  }, 'applyRoutes 不得抛');
  assert.notEqual(returned, 'unset');
  assert.equal(typeof returned?.then, 'undefined', 'applyRoutes 必须**同步**返回（返回 Promise 会被 Cordis 当 effect 收走）');

  const report = await awaitSettingsInstall();
  assert.equal(report.registered, true, `applyRoutes 必须真的发起注册：${report.reason ?? ''}`);
  assert.equal(settings.calls.length, 1);
  assert.equal(settings.calls[0].ns, LAYOUT_NAMESPACE);
  assert.ok(fake.logs.some((row) => row.level === 'info' && row.message.includes('已注册 settings 命名空间')), '成功要留一条 info（真机排查用）');
});

test('结构闸 + 变异负控：不许写进 ctx.inject 回调、声明与调用必须在位（判据能红）', () => {
  const sources = hostSources();
  const index = sources.find((row) => row.name === 'index.mjs');
  assert.ok(index !== undefined && index.code.length > 0, '宿主入口必须被扫到（否则下面的判据是空转）');

  /** 纯函数判据：给定宿主源码 ⇒ 问题清单（空 = 过）。变异负控直接喂它，不写盘、不起子进程。 */
  const gateProblems = (rows, declaredInject) => {
    const problems = [];
    for (const row of rows) {
      if (/\bctx\s*\.\s*inject\s*\(/.test(row.code)) {
        problems.push(`${row.name} 出现 ctx.inject(...)：注册会绑到临时 scope 上（真机反例：日志说已注册而注册随 scope 消失）—— 必须改走声明式 inject`);
      }
    }
    const entry = rows.find((row) => row.name === 'index.mjs');
    if (entry === undefined) problems.push('找不到宿主入口 index.mjs');
    else {
      // ⚠ 这里必须用**语句形态**（结尾带分号）：函数定义 `function installSettingsNamespaceHere(ctx, options) {` 也含同名调用前缀，
      //   只写 `installSettingsNamespaceHere(ctx` 会把「定义还在」当成「真的发起了」——本次实测踩到（变异负控当场把它抓出来）。
      if (!/installSettingsNamespaceHere\s*\(\s*ctx\s*,\s*options\s*\)\s*;/.test(entry.code)) {
        problems.push('index.mjs 的 applyRoutes 必须**真的发起**这次注册（installSettingsNamespaceHere(ctx, options);）—— 只留一个没人调用的函数定义不算');
      }
      if (!/installSettingsNamespace\s*\(\s*ctx\b/.test(entry.code)) problems.push('index.mjs 必须用**插件自己的 ctx** 调 installSettingsNamespace(ctx, …)');
      if (!declaredInject.includes('settings')) problems.push('index.mjs 的 inject 声明必须含 settings（不声明 ⇒ 服务看不见，注册无从发生）');
      if (!declaredInject.includes('connection')) problems.push('index.mjs 的 inject 声明必须含 connection（路由注册面）');
    }
    return problems;
  };

  assert.deepEqual(gateProblems(sources, [...inject]), [], `宿主半区结构闸未过：\n  - ${gateProblems(sources, [...inject]).join('\n  - ')}`);
  assert.deepEqual([...inject].sort(), ['connection', 'settings'], '真值：宿主 inject 恰好这两项（改它必须先改本判据与 verify-surface 的注入白名单）');

  // ★ 变异负控（四条）：每条都必须被判红，否则上面那条是恒真的
  const indexRow = sources.find((row) => row.name === 'index.mjs');
  const mutants = [
    [
      '删掉 applyRoutes 里的发起调用（＝corrupt-payload-visible 的原始状态）',
      sources.map((row) => (row.name === 'index.mjs' ? { ...row, code: row.code.replace(/installSettingsNamespaceHere\s*\(\s*ctx\s*,\s*options\s*\)\s*;/, '/* 不发起 */') } : row)),
      ['connection', 'settings'],
    ],
    [
      '内层调用换成别的 ctx（不是插件自己的）',
      sources.map((row) => (row.name === 'index.mjs' ? { ...row, code: row.code.replace(/installSettingsNamespace\s*\(\s*ctx\s*,/, 'installSettingsNamespace(scoped,') } : row)),
      ['connection', 'settings'],
    ],
    ['从 inject 声明里去掉 settings', sources, ['connection']],
    [
      '把注册塞进 ctx.inject(...) 回调（真机反例的形状）',
      sources.map((row) => (row.name === 'index.mjs' ? { ...row, code: `${row.code}\nctx.inject(['settings'], (scoped) => { installSettingsNamespace(scoped); });\n` } : row)),
      ['connection', 'settings'],
    ],
  ];
  const silent = [];
  for (const [label, rows, declared] of mutants) {
    const changed = rows !== sources || declared.join() !== [...inject].join();
    if (changed === false) {
      silent.push(`${label}（变异没落到输入上＝空转）`);
      continue;
    }
    if (gateProblems(rows, declared).length === 0) silent.push(label);
  }
  assert.deepEqual(silent, [], `这些变异必须被判红：\n  - ${silent.join('\n  - ')}`);
  assert.equal(indexRow !== undefined, true, '变异靶点必须来自真实源码（防空转）');
});

test('失败分支：一律不抛，且给出可读理由（缺依赖只是不注册，页面照常）', async () => {
  const bare = createFakeCtx({});
  const missing = await installSettingsNamespace(bare.ctx, { importModule: fakeImporter });
  assert.equal(missing.registered, false);
  assert.equal(missing.reason, 'settings-absent', '缺服务 ⇒ settings-absent');
  assert.deepEqual(bare.calls.effect, [], '缺服务时一条 effect 都不许挂（宿主侧缺依赖不得注册副作用）');

  const withService = createFakeCtx({});
  const settings = createFakeSettings(withService.ctx);
  const noEffectCtx = { get: () => settings.service, settings: settings.service };
  const noEffect = await installSettingsNamespace(noEffectCtx, { importModule: fakeImporter });
  assert.equal(noEffect.reason, 'no-ctx-effect', '没有 effect 面 ⇒ 不注册（不许悄悄挂在别处）');

  const throwing = await installSettingsNamespace(withService.ctx, {
    settings: settings.service,
    importModule: async () => {
      throw new Error('cannot find module');
    },
  });
  assert.equal(throwing.registered, false);
  assert.match(throwing.reason, /^schemastery-unavailable: /, '取不到 schema 库 ⇒ 如实报，不抛');
  assert.deepEqual(withService.calls.effect, [], '取不到 schema 时不得挂 effect');

  const invalid = await installSettingsNamespace(withService.ctx, { settings: settings.service, importModule: async () => ({ default: {} }) });
  assert.equal(invalid.reason, 'schemastery-invalid', 'schema 库形状不对 ⇒ 如实报');

  const dupSettings = createFakeSettings(withService.ctx);
  const first = await installSettingsNamespace(withService.ctx, { settings: dupSettings.service, importModule: fakeImporter });
  assert.equal(first.registered, true);
  const again = await installSettingsNamespace(withService.ctx, { settings: dupSettings.service, importModule: fakeImporter });
  assert.equal(again.registered, false);
  assert.match(again.reason, /^register-failed: /, '重名注册被拒 ⇒ 如实报 register-failed（不抛）');
});

test('依赖边界：宿主半区不得静态 import 平台包（只许 import()），schema 库按常量名动态取', () => {
  const offenders = [];
  for (const row of hostSources()) {
    for (const match of row.code.matchAll(/^\s*import\s+[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm)) {
      if (match[1].startsWith('@deepseek-ai/')) offenders.push(`${row.name} → 静态 import ${match[1]}`);
    }
    for (const match of row.code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
      if (match[1].startsWith('@deepseek-ai/')) offenders.push(`${row.name} → 静态 import ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `宿主半区只许静态 import 相对路径/node 内建（依赖边界）—— 越界：${offenders.join('、')}`);

  const settingsCode = hostSources().find((row) => row.name === 'settings.mjs').code;
  assert.ok(settingsCode.includes('import(specifier)'), 'schema 库必须经 import() 动态取（拿不到就如实报，不抛）');
  assert.ok(settingsCode.includes(`'${SCHEMASTER_SPECIFIER}'`), '包名必须来自导出的常量（单一真源）');
});
