#!/usr/bin/env node
/**
 * v1-surface.mjs —— **本包的离线表面复核**（只按本版真实面写）。
 *
 * 【本装置检查什么（都绑本版真源，不看「应该没问题」）】
 *   V1 版本三方一致：`SERVICE_VERSION` === `package.json.version`
 *      （v1 的 `CLIENT_VERSION` 同值这条由 `tests/unit/diagnostics-client.test.mjs` 钉住，
 *       本件不重复；这里只管**服务面**那一份）
 *   V2 公开面快照 ↔ 声明 ↔ **运行期反射**：服务成员 / 能力集 / 座位 / 组件名 / 错误码 / 层族
 *      （运行期那一侧真跑一次 `provideService`，成员取自实例的原型链）
 *   V3 **已裁的四个命名空间不得复活**：`layout` / `channel` / `workbench` / `window`
 *      （原型取值器与实例自有键上都不许出现 —— 这是同代裁剪最容易被顺手加回来的地方）
 *   V4 可装性红线：产物 `lib/client.js` 里 `window.__ModuleLoader__.load(` 恰好 1 次、
 *      且裸包名 `require` 的集合恰好等于声明的平台种子（客户端半区只吃外壳种子）
 *
 * 用法：`node verify/v1-surface.mjs`（硬判据全过 ⇒ exit 0；任一不过 ⇒ 逐条打印并 exit 1）
 * 纪律：只读；不写盘、不联网、不起进程、不需要 DSH 在跑。
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SEED_DECLARATIONS } from '../scripts/build-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const pkgPath = (...parts) => path.join(PKG_DIR, ...parts);
const load = (rel) => import(pathToFileURL(pkgPath(...rel.split('/'))).href);

const [serviceFace, componentsMod, errorsMod, layersMod, serviceMod, settingsMod] = await Promise.all([
  load('src/client/contracts/service-face.mjs'),
  load('src/client/contracts/components.mjs'),
  load('src/client/contracts/errors.mjs'),
  load('src/client/contracts/layers.mjs'),
  load('src/client/service.mjs'),
  load('src/host/settings.mjs'),
]);

const SNAPSHOT = JSON.parse(readFileSync(pkgPath('tests', 'contracts', 'public-surface.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));

/** 判据收集器：一条一行，`ok=false` 即计入失败。 */
const rows = [];
const check = (id, contract, ok, observed) => rows.push({ id, contract, ok: ok === true, observed });

/** 最小 Cordis ctx（只够 `provideService` 跑完；不借 tests/** 的夹具）。 */
function createCtx() {
  const provided = new Map();
  const records = [];
  const logger = Object.assign(() => {}, { error() {}, info() {}, warn() {}, debug() {} });
  return {
    provided,
    records,
    logger,
    get: (name) => provided.get(name),
    provide: (name, value) => {
      provided.set(name, value);
      return () => { if (provided.get(name) === value) provided.delete(name); };
    },
    effect: (install, label) => {
      const cleanup = install();
      const record = { label, cleanup, active: true };
      records.push(record);
      return () => { if (record.active) { record.active = false; if (typeof cleanup === 'function') cleanup(); } };
    },
  };
}

// ── V1 版本三方一致 ─────────────────────────────────────────────────────────────────────
check('V1-1', '服务面版本 === package.json.version', serviceFace.SERVICE_VERSION === pkg.version,
  `SERVICE_VERSION=${serviceFace.SERVICE_VERSION}｜package.json=${pkg.version}`);
check('V1-2', '快照 version === package.json.version', SNAPSHOT.version === pkg.version,
  `快照=${SNAPSHOT.version}｜package.json=${pkg.version}`);
check('V1-3', '宿主命名空间与 loader id 同名（gui-frame）', settingsMod.LAYOUT_NAMESPACE === serviceFace.SERVICE_NAME,
  `settings.LAYOUT_NAMESPACE=${settingsMod.LAYOUT_NAMESPACE}｜SERVICE_NAME=${serviceFace.SERVICE_NAME}`);

// ── V2 公开面、声明、运行期三方一致 ─────────────────────────────────────────────────────
const provider = createCtx();
const provided = serviceMod.provideService(provider, {});
const service = provided.service;
check('V2-0', '服务面能被 provide（运行期反射那一侧的前提）', provided.owned === true && service !== null, `owned=${provided.owned} reason=${provided.reason}`);

/** 整条原型链上的公开成员（排除 `__` 内部面与 constructor）。 */
function prototypeMembers(instance) {
  const methods = new Set();
  const getters = new Set();
  for (let proto = Object.getPrototypeOf(instance); proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (name === 'constructor' || name.startsWith('__')) continue;
      if (typeof desc.value === 'function') methods.add(name);
      else if (typeof desc.get === 'function') getters.add(name);
    }
  }
  return { methods: [...methods].sort(), getters: [...getters].sort() };
}
const reflected = prototypeMembers(service);
const ownFields = Object.keys(service).filter((name) => !name.startsWith('__') && name !== 'ctx');
const reflectedMembers = [...new Set([...reflected.methods, ...reflected.getters, ...ownFields])].sort();

check('V2-1', '服务成员：快照 === 声明 === 运行期反射（三路逐条）',
  JSON.stringify(SNAPSHOT.serviceMembers) === JSON.stringify([...serviceFace.SERVICE_MEMBERS].sort())
  && JSON.stringify(reflectedMembers) === JSON.stringify([...serviceFace.SERVICE_MEMBERS].sort()),
  `快照=${SNAPSHOT.serviceMembers.join(',')}｜声明=${[...serviceFace.SERVICE_MEMBERS].sort().join(',')}｜运行期=${reflectedMembers.join(',')}`);
check('V2-2', '原型方法集 === 声明的方法集', JSON.stringify(reflected.methods) === JSON.stringify([...serviceFace.SERVICE_METHODS].sort()),
  `运行期=${reflected.methods.join(',')}｜声明=${[...serviceFace.SERVICE_METHODS].sort().join(',')}`);
check('V2-3', '原型取值器集 === 声明的命名空间集', JSON.stringify(reflected.getters) === JSON.stringify([...serviceFace.SERVICE_NAMESPACES].sort()),
  `运行期=${reflected.getters.join(',')}｜声明=${[...serviceFace.SERVICE_NAMESPACES].sort().join(',')}`);
check('V2-4', '能力集：快照 === 声明', JSON.stringify(SNAPSHOT.capabilities) === JSON.stringify([...serviceFace.CAPABILITIES].sort()),
  `快照=${SNAPSHOT.capabilities.join(',')}｜声明=${[...serviceFace.CAPABILITIES].sort().join(',')}`);
check('V2-5', '座位：快照 === 声明（consumed slots）', JSON.stringify(SNAPSHOT.slots) === JSON.stringify([...serviceFace.CONSUMED_SLOT_KEYS].sort()),
  `快照=${SNAPSHOT.slots.join(',')}｜声明=${[...serviceFace.CONSUMED_SLOT_KEYS].sort().join(',')}`);
check('V2-6', '平台软探测服务：快照 === 声明', JSON.stringify(SNAPSHOT.inject) === JSON.stringify([...serviceFace.PLATFORM_SERVICE_KEYS].sort()),
  `快照=${SNAPSHOT.inject.join(',')}｜声明=${[...serviceFace.PLATFORM_SERVICE_KEYS].sort().join(',')}`);
check('V2-7', '组件名：快照 === 冻结清单，且 props 表键集与之逐条相等',
  JSON.stringify(SNAPSHOT.components) === JSON.stringify([...componentsMod.COMPONENT_NAMES].sort())
  && JSON.stringify(Object.keys(componentsMod.COMPONENT_PROPS).sort()) === JSON.stringify([...componentsMod.COMPONENT_NAMES].sort()),
  `${componentsMod.COMPONENT_NAMES.length} 件：${[...componentsMod.COMPONENT_NAMES].sort().join(',')}`);
check('V2-8', '错误码全集：快照 === ALL_CODES（两族之并、无重复）',
  JSON.stringify(SNAPSHOT.errorCodes) === JSON.stringify([...errorsMod.ALL_CODES].sort())
  && new Set(errorsMod.ALL_CODES).size === errorsMod.ALL_CODES.length,
  `${errorsMod.ERROR_CODES.length} E + ${errorsMod.WARNING_CODES.length} W = ${errorsMod.ALL_CODES.length} 条`);
check('V2-10', '层族全集非空且与消费面一致（数字层级表的族名）', Array.isArray(layersMod.LAYER_FAMILIES) && layersMod.LAYER_FAMILIES.length === 5,
  `LAYER_FAMILIES=${layersMod.LAYER_FAMILIES.join(',')}`);

// ── V3 已裁的四个命名空间不得复活 ────────────────────────────────────────────────────────
const CUT_NAMESPACES = ['layout', 'channel', 'workbench', 'window'];
for (const name of CUT_NAMESPACES) {
  check(`V3-${name}`, `同代裁剪项 \`${name}\` 不得出现在公开面（原型成员 / 自有键 / 声明表）`,
    !reflected.getters.includes(name)
    && !reflected.methods.includes(name)
    && !Object.prototype.hasOwnProperty.call(service, name)
    && !serviceFace.SERVICE_NAMESPACES.includes(name)
    && !serviceFace.CAPABILITIES.includes(name),
    `getter=${reflected.getters.includes(name)}｜method=${reflected.methods.includes(name)}｜own=${Object.prototype.hasOwnProperty.call(service, name)}｜声明=${serviceFace.SERVICE_NAMESPACES.includes(name) || serviceFace.CAPABILITIES.includes(name)}`);
}

// ── V4 可装性红线（产物层） ─────────────────────────────────────────────────────────────
const artifactPath = pkgPath('lib', 'client.js');
const artifact = readFileSync(artifactPath, 'utf8');
check('V4-1', '产物存在且非空', artifact.length > 0, `${statSync(artifactPath).size} 字节`);
check('V4-2', '恰好一条装载调用 `window.__ModuleLoader__.load({`',
  (artifact.match(/^window\.__ModuleLoader__\.load\(\{/gm) ?? []).length === 1,
  `load 行数=${(artifact.match(/^window\.__ModuleLoader__\.load\(\{/gm) ?? []).length}`);
/**
 * 产物里的裸包名 `require` **恰好等于声明的平台种子**。
 *
 * ★ 别把它写成「一个裸包名 require 都不许有」：种子注入块本身就是 `var react = require("react")`
 *   —— 那些名字由外壳提供、不打包进产物，是**设计要求**。这条要拦的是「顺手 require 一个第三方
 *   包并把它打进产物」，所以判据是「集合相等」：既挡住多出来的，也挡住悄悄少掉的种子。
 */
const bareNames = [...new Set([...artifact.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)]
  .map((match) => match[1])
  .filter((spec) => !spec.startsWith('.') && !spec.startsWith('/')))].sort();
const declaredSeeds = [...SEED_DECLARATIONS].map((entry) => entry.name).sort();
check('V4-3', '产物里的裸包名 require 恰好等于声明的平台种子（种子由外壳注入，绝不打包第三方）',
  JSON.stringify(bareNames) === JSON.stringify(declaredSeeds),
  `裸包名=${bareNames.length} 项｜声明=${declaredSeeds.length} 项｜多出=${bareNames.filter((n) => !declaredSeeds.includes(n)).join(',') || '无'}｜缺=${declaredSeeds.filter((n) => !bareNames.includes(n)).join(',') || '无'}`);

// ── 汇总 ────────────────────────────────────────────────────────────────────────────────
const failed = rows.filter((row) => !row.ok);
console.log('[v1-surface] 离线表面复核（本装置按本版真实面写）');
console.log(`[v1-surface] 公开面快照：tests/contracts/public-surface.json（${Buffer.byteLength(readFileSync(pkgPath('tests', 'contracts', 'public-surface.json')), 'utf8')} 字节）`);
for (const row of rows) console.log(`  ${row.ok ? '✔' : '✗'} [${row.id}] ${row.contract}｜${row.observed}`);
console.log(`[v1-surface] 判据 ${rows.length} 条：pass ${rows.length - failed.length} / fail ${failed.length}`);
if (failed.length > 0) {
  for (const row of failed) console.error(`[v1-surface] ✗ [${row.id}] ${row.contract} —— ${row.observed}`);
  process.exitCode = 1;
}
