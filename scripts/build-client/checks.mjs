/**
 * checks.mjs —— 客户端产物的**自校验件**（从 scripts/build-client.mjs 搬出：非 src 面单文件 600 行上限）。
 *
 * 内容：种子声明与白名单（构建期硬约束的唯一真源）+ 产物形态自校验的 8 个函数
 * （classic script 可加载 / 单次 load / id === 包名 / require 集合 ⊆ 声明集 / 缺依赖零座位 / 有依赖成对注册 …）。
 * 入口 `scripts/build-client.mjs` 原路径 re-bind 这些名字 ⇒ 外部（tests/**）取用路径一字不变。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { createFakeCtx, createFakeSlots } from '../../tests/helpers/fake-ctx.mjs';
import { createFakeReact } from '../../tests/helpers/fake-react.mjs';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★ 种子声明 —— 白名单与注入集的**唯一真源**。
//
// 每一行 = 一个外壳运行时提供的种子实例：`name` 是 require 的**全名**（写简写即运行期 throw），
// `key` 是交给 `createClientModule(__seeds)` 的键名（模块只能经这个对象取用种子）。
// 8 项全部取自冻结清单，**不因「官方产物用过」而扩容**；
// 日后要加第 9 键，须先有 `src/` 里的真实调用点，并在交付说明里单列理由与调用点。
// ═══════════════════════════════════════════════════════════════════════════════════════════
export const SEED_DECLARATIONS = Object.freeze([
  { name: 'react', key: 'react' },
  { name: 'react/jsx-runtime', key: 'jsxRuntime' },
  { name: 'react-dom', key: 'reactDom' },
  { name: '@deepseek-ai/cordis', key: 'cordis' },
  { name: '@deepseek-ai/dsh-client-store', key: 'store' },
  { name: '@deepseek-ai/dsh-client-ui-primitives', key: 'primitives' },
  { name: '@deepseek-ai/dsh-client-ui-slots', key: 'slots' },
  { name: '@deepseek-ai/dsh-client-ui-dockkit', key: 'dockkit' },
]);

/** 允许出现在产物里的 require 目标＝种子声明里的全名（顺序一致）。 */
export const ALLOWED_REQUIRES = Object.freeze(SEED_DECLARATIONS.map((entry) => entry.name));

/** 语法检查（classic script：ESM 语法会直接报错，这正是要的）。 */
export function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return { ok: result.status === 0, message: (result.stderr ?? '').trim().split('\n').slice(0, 4).join(' ') };
}

/**
 * 假种子表：按 `SEED_DECLARATIONS` 的**全名**给出替身（构建期加载自检与单测共用）。
 * `react` 用 tests/helpers/fake-react.mjs 的真替身；其余给带 `__seedName` 标签的空对象 ——
 * **不假装实现了那些模块**：用例需要真实行为时自己传 `options.seeds` 覆盖。
 */
export function createFakeSeeds() {
  const seeds = {};
  for (const entry of SEED_DECLARATIONS) {
    seeds[entry.name] = entry.name === 'react' ? createFakeReact() : Object.freeze({ __seedName: entry.name, __fake: true });
  }
  return seeds;
}

/**
 * 在「只有 window.__ModuleLoader__」的环境里加载产物，并做形状级断言（不依赖任何 DOM）。
 * @param {string} source 产物文本
 * @param {{expectId?:string|null, seeds?:object|null, react?:object|null, ctx?:object|null}} [options]
 *   `seeds` 缺省用 `createFakeSeeds()`（`react` 选项是它的 `react` 单项快捷写法）；
 *   `ctx` 给了就顺带断言 `apply` 不抛错。
 */
export function loadArtifact(source, options = {}) {
  const checks = [];
  const required = [];
  let entry = null;
  const windowLike = { __ModuleLoader__: { load(value) { entry = value; } } };
  const host = new Function('window', source); // eslint-disable-line no-new-func
  host(windowLike);
  checks.push({ name: '顶层调用一次 __ModuleLoader__.load', ok: entry !== null, detail: entry === null ? '没有调用 load' : 'ok' });
  if (entry === null) return { checks, required, exports: null };
  const expectId = options.expectId ?? null;
  checks.push({ name: 'bundle id 与包名一致', ok: expectId === null || entry.id === expectId, detail: `id=${entry.id}${expectId === null ? '' : ` / 期望 ${expectId}`}` });
  checks.push({ name: 'factory 是函数', ok: typeof entry.factory === 'function', detail: typeof entry.factory });
  if (typeof entry.factory !== 'function') return { checks, required, exports: null };

  const seeds = { ...createFakeSeeds(), ...(options.seeds ?? {}) };
  if (options.react !== undefined && options.react !== null) seeds.react = options.react;
  const fakeRequire = (name) => {
    required.push(name);
    if (Object.prototype.hasOwnProperty.call(seeds, name)) return seeds[name];
    throw new Error(`产物 require 了未授权的模块：${name}`);
  };
  const exports = entry.factory(fakeRequire);
  checks.push({
    name: 'factory 返回 { apply, inject }',
    ok: typeof exports?.apply === 'function' && Array.isArray(exports?.inject),
    detail: `apply=${typeof exports?.apply} inject=${JSON.stringify(exports?.inject ?? null)}`,
  });
  checks.push({
    name: 'require 集合 ⊆ 允许的种子键',
    ok: required.every((name) => ALLOWED_REQUIRES.includes(name)),
    detail: required.join('、') || '（无）',
  });
  if (options.ctx !== null && options.ctx !== undefined) {
    let threw = null;
    try {
      exports.apply(options.ctx);
    } catch (error) {
      threw = error;
    }
    checks.push({
      name: 'apply(最小客户端 ctx) 不抛错（客户端 apply 抛错会打死整页）',
      ok: threw === null,
      detail: threw === null ? 'ok' : String(threw.message),
    });
  }
  return { checks, required, exports };
}

/** 最小客户端 ctx：只放外壳会提供的那两个面（`slots` / `logger`），够 apply 走一遍。 */
export function createClientCheckCtx() {
  const { slots } = createFakeSlots();
  const { ctx } = createFakeCtx({ services: { slots } });
  return ctx;
}

/** 全名判据：react 家族的三个入口，或 `@deepseek-ai/*` 作用域包 —— 简写一律不算。 */
export function isFullSeedName(name) {
  return name === 'react' || name === 'react-dom' || name === 'react/jsx-runtime' || name.startsWith('@deepseek-ai/');
}

/** `package.json` 的静态契约。 */
export function packageChecks(pkg) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
  add('dsh.client.platform === "web"', pkg?.dsh?.client?.platform === 'web', String(pkg?.dsh?.client?.platform));
  add('exports["./client"] === "./lib/client.js"', pkg?.exports?.['./client'] === './lib/client.js', String(pkg?.exports?.['./client']));
  add('不存在 dsh.client.external（种子键由外壳提供）', pkg?.dsh?.client?.external === undefined, JSON.stringify(pkg?.dsh?.client?.external ?? null));
  add('dependencies 为空', Object.keys(pkg?.dependencies ?? {}).length === 0, JSON.stringify(pkg?.dependencies ?? {}));
  add('files 含 lib', Array.isArray(pkg?.files) && pkg.files.includes('lib'), JSON.stringify(pkg?.files ?? []));
  add('dsh.bundle.patch === "./cordis.patch.yml"', pkg?.dsh?.bundle?.patch === './cordis.patch.yml', String(pkg?.dsh?.bundle?.patch));
  return checks;
}

/** 两个名字序列是否逐项相等（用于「require 集合 === 声明集」）。 */
export function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
