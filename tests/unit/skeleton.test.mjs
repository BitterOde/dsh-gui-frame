/**
 * skeleton.test.mjs —— 包骨架与构建空壳的机检门禁，`node --test tests/unit`。
 *
 * 判据来源：
 *  1. 包清单：`dependencies` 为空 / `type:module` / `dsh.client.platform==='web'` /
 *     `exports['./client']` 指向 `lib/client.js` / **不存在** `dsh.client.external` /
 *     `dsh.bundle.patch==='./cordis.patch.yml'` / `dsh` 字段全部落在官方合法集内；
 *     ★ v1.0 发布面：`private` 不得为 true / `version==='1.0.0'`（=公开面快照的 version）/
 *     `license` 有值 / `files` 精确清单 / 根 `LICENSE` 存在；
 *  2. 注册通道**只有一个**：`cordis.patch.yml` 恰好一条 insert 行，`id==='gui-frame'`、`name===包名`；
 *  3. 注册通道**二选一**：本包进了 profile 的 `dsh.profile.bundles` 时，
 *     profile 的 `cordis.patch.yml` 不得再有同 id 的 insert 行（否则 duplicate loader entry id）；
 *  4. `lib/index.js` 纯 node 可 `import()`、形状合法、`apply` 同步返回 undefined 且**零注册**；
 *  5. `lib/client.js` 是合法客户端产物（classic script、单次 load、id 正确、require ⊆ 白名单、
 *     apply 不抛且**零注册**）；
 *  6. 打包器自检与 `rewriteSpecifiers` 行为；
 *  7. 夹具自检（fake-react / fake-ctx）。
 *
 * 纪律：本用例**不写任何文件**、不联网、不需要 DSH 在跑、**不碰 profile**（第 3 条只读）。
 * 与后续任务并行时「源码改了但还没重建」属正常中间态，故 client 侧只查**产物自身的形状契约**，
 * 不做「产物 == 当前源码」的比对（那条由 scripts/build-client.mjs 构建期自检保证）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ENTRY_OUT,
  LIB_HOST_DIR,
  LOADER_ID,
  SRC_HOST_DIR,
  entrySource,
  listFiles,
  parsePatchInserts,
  rewriteSpecifiers,
} from '../../scripts/build-host.mjs';
import {
  ALLOWED_REQUIRES,
  OUT_FILE as CLIENT_OUT,
  SRC_CLIENT_DIR,
  buildArtifactText,
  checkBindings,
  loadArtifact,
  loadModules,
} from '../../scripts/build-client.mjs';
import { createFakeCtx, createFakeSlots } from '../helpers/fake-ctx.mjs';
import { createFakeReact, findAll, findByAttr, fire, renderComponent, textOf, typesOf, walkElements } from '../helpers/fake-react.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const patchText = readFileSync(path.join(PKG_DIR, 'cordis.patch.yml'), 'utf8');

/** 官方 manifest 的 `dsh` 字段合法集（实读官方类型）。 */
const LEGAL_DSH_KEYS = ['bundle', 'profile', 'client', 'configTrees', 'sessionFormatMigration', 'moduleFallback'];

test('package.json：家族包约定与依赖边界（dependencies 必须为空）', () => {
  assert.deepEqual(pkg.dependencies, {}, 'dependencies 必须为空对象');
  assert.equal(Object.keys(pkg.dependencies).length, 0);
  assert.equal(pkg.type, 'module', 'type 必须是 module');
  assert.notEqual(pkg.private, true, 'v1.0 发布线：清单不得再写 private: true（写了 npm publish 会拒）');
  assert.equal(pkg.version, '1.0.0', 'v1.0 发布线：清单 version 必须与公开面快照 tests/contracts/public-surface.json 的 version 同值');
  assert.ok(
    typeof pkg.license === 'string' && pkg.license.trim() !== '',
    'license 必须有值（v1.0 发布线：具体许可由用户拍板，现为占位值 SEE LICENSE IN LICENSE）',
  );
  assert.ok(existsSync(path.join(PKG_DIR, 'LICENSE')), 'LICENSE 必须随包（v1.0：占位说明，具体许可待人补）');
  assert.ok(
    typeof pkg.description === 'string' && pkg.description.includes('坞'),
    'description 必须是对外可读的一句话定位（坞 + 按钮面板基类）',
  );
  assert.equal(pkg.main, 'lib/index.js');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.js', "exports['./client'] 必须指向 lib/client.js");
  assert.equal(pkg.dsh.client.platform, 'web', "dsh.client.platform 必须是 'web'");
  assert.equal(pkg.dsh.client.external, undefined, '种子键由外壳提供，清单里不得出现 dsh.client.external');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'dsh.bundle.patch 必须指向本包的 cordis.patch.yml');
  // `guide/` 是**随包发布的接入说明**（README 做入口、包内自带说明文档夹）⇒ 发布面四项。
  // 本条断言**精确清单**：多一项少一项都红。
  assert.deepEqual(pkg.files, ['lib', 'cordis.patch.yml', 'README.md', 'guide']);
  for (const key of Object.keys(pkg.dsh)) {
    assert.ok(LEGAL_DSH_KEYS.includes(key), `dsh.${key} 不在官方合法集 ${LEGAL_DSH_KEYS.join('/')} 内`);
  }
  assert.equal(pkg.dsh.engines, undefined, 'dsh.engines 不是官方字段——不写它，版本兼容靠 L1 探针');
  assert.ok(pkg.peerDependencies['@deepseek-ai/cordis'], 'peerDependencies 声明 cordis（「宿主提供」声明，不进依赖树）');
  assert.ok(pkg.scripts.link && pkg.scripts.unlink, '开发循环：npm run link / unlink 必须在册');
  assert.equal(pkg.scripts['check:tokens'], 'node scripts/check-tokens.mjs', 'check:tokens 的 npm script 位必须指到 scripts/check-tokens.mjs');
});

test('注册通道只有一个：cordis.patch.yml 恰好一条 insert 行，id/name 与冻结名一致', () => {
  const rows = parsePatchInserts(patchText);
  assert.equal(rows.length, 1, `cordis.patch.yml 必须恰好一条 insert 行（当前 ${rows.length} 条）`);
  assert.equal(rows[0].id, LOADER_ID, 'insert id 恒为 gui-frame（= 入口 name）');
  assert.equal(rows[0].id, 'gui-frame');
  assert.equal(rows[0].name, pkg.name, 'insert name 恒为包名 dsh-gui-frame');
});

test('注册通道二选一：profile 已列本包进 bundles 时，profile 的 patch 不得再有同 id 的 insert 行', (t) => {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh');
  const profileDir = path.join(home, 'profiles', 'web');
  let manifest;
  let profilePatch;
  try {
    manifest = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    profilePatch = readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  } catch {
    t.skip('未发现可读的 profile（DSH_HOME/profiles/web）——本条是外部状态守护');
    return;
  }
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  if (!bundles.includes(pkg.name)) {
    t.skip(`${pkg.name} 尚未进入该 profile 的 dsh.profile.bundles（bundle 模式未启用），无需守护`);
    return;
  }
  const ids = parsePatchInserts(profilePatch).map((row) => row.id);
  assert.ok(
    !ids.includes(LOADER_ID),
    `profile 的 cordis.patch.yml 里出现了 id: ${LOADER_ID} 的 insert 行，而本包已在 dsh.profile.bundles`
    + ' —— 组合里会出现两行同 id，加载器抛 "duplicate loader entry id" 让 DSH 起不来',
  );
});

test('lib/index.js：纯 node 可 import()、形状合法、apply 同步返回 undefined；缺依赖零注册且降级可见', async () => {
  assert.ok(existsSync(ENTRY_OUT), `缺少包入口产物 ${path.relative(PKG_DIR, ENTRY_OUT)}（先跑 node scripts/build-host.mjs）`);
  const mod = await import(pathToFileURL(ENTRY_OUT).href);
  assert.equal(mod.name, LOADER_ID, 'name 必须等于 loader entry id');
  // 宿主半区**可以**声明**平台自带服务**的 inject ——
  // 「不许 inject」那条管的是**反方向**（别的插件 `inject: ['gui-frame']` 依赖本插件）。但判据
  // **不放宽成「想声明什么就声明什么」**，改成**双向等式**：声明的服务集合 **≡ 代码实际访问的服务集合**。
  //   多声明 ⇒ 平台会为一个没用到的服务把插件悬置（真·风险）；
  //   少声明 ⇒ 真机上根本拿不到那个服务（真机实测：不声明 `connection` ⇒ `ctx.get('connection')` 恒 undefined）。
  const hostDir = path.join(PKG_DIR, 'src', 'host');
  const hostFiles = readdirSync(hostDir).filter((name) => name.endsWith('.mjs'));
  const PLATFORM_CTX_MEMBERS = new Set([
    'effect', 'on', 'off', 'once', 'get', 'provide', 'inject', 'emit', 'scope', 'root', 'isolate',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'logger', 'start', 'stop', 'dispose',
  ]);
  const accessedServices = new Set();
  for (const name of hostFiles) {
    const code = readFileSync(path.join(hostDir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    for (const match of code.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) accessedServices.add(match[1]);
    for (const match of code.matchAll(/ctx\.get\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) accessedServices.add(match[1]);
    for (const match of code.matchAll(/ctx\.get\(\s*'([^']+)'\s*\)/g)) accessedServices.add(match[1]);
  }
  for (const member of PLATFORM_CTX_MEMBERS) accessedServices.delete(member);
  assert.ok(accessedServices.size > 0, '扫描必须真的扫到东西（否则下面那条等式空转 ⇒ 恒真）');
  assert.deepEqual(
    [...accessedServices].sort(),
    [...mod.inject].sort(),
    `inject 声明的服务集合必须逐条等于宿主半区实际访问的服务集合（声明=${JSON.stringify(mod.inject)}；访问=${JSON.stringify([...accessedServices].sort())}）`,
  );
  // 宿主半区还声明 `settings` —— 用户设置命名空间注册面；真机上曾出现宿主没注册 `gui-frame`
  // ⇒ 客户端 `settingsScope` 恒 unavailable ⇒ 布局只读，这条判据堵的就是它。
  // 与上面那条**双向等式**分工：等式由源码扫描算出来（多一项/少一项都红），这里只是把「当前恰好是哪两项」
  // 钉住 ⇒ 任何人改 inject 声明都必须显式改这条判据，改不动就说明漏了声明或写了死声明。
  assert.deepEqual(mod.inject, ['connection', 'settings'], '当前声明的平台服务：connection（/api 路由注册面）+ settings（settingsScope 命名空间注册面）');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(mod.default?.name, mod.name, 'default 导出与命名导出同源');
  assert.equal(mod.default?.apply, mod.apply);

  // 宿主 apply 会真的去注册路由，"零注册空壳 + 不打日志"那条老判据不成立；要看的是两条：
  //   ① 依赖缺席 ⇒ 不激活：不 provide / 不 inject / 不注册 effect / 不订阅事件（页面照常启动）；
  //   ② 降级**必须可见**：缺依赖这件事要留在日志里（否则真机上分不清"没装"与"装了但没工作"）。
  const { ctx, calls, logs, effects, pendingInjects } = createFakeCtx({ services: {} });
  const returned = mod.apply(ctx);
  assert.equal(returned, undefined, 'apply 必须同步返回 undefined（async apply 会被 Cordis 当 effect 收集）');
  assert.ok(!(returned instanceof Promise));
  assert.deepEqual(calls.provide, [], '缺依赖时不得 provide 任何服务');
  assert.deepEqual(calls.inject, [], '缺依赖时不得 inject 任何依赖（声明即悬置 ⇒ 整页失败）');
  assert.deepEqual(calls.effect, [], '缺依赖时不得注册 effect（也就没有可泄漏的副作用）');
  assert.deepEqual(calls.on, [], '缺依赖时不得订阅事件');
  assert.equal(effects.length, 0);
  assert.equal(pendingInjects.length, 0);
  assert.ok(logs.length >= 1, '缺依赖时必须留下可见的降级记录（静默降级 = 现场无法定位）');
  assert.ok(logs.every((row) => row.level === 'warn'), `缺依赖是降级不是错误 ⇒ 只许 warn：${JSON.stringify(logs)}`);
  assert.ok(logs.every((row) => row.message.startsWith('[gui-frame]')), '降级日志必须带包前缀（真机 grep 认它）');
  assert.ok(logs.some((row) => row.message.includes('connection')), '降级日志必须点名缺席的服务名');
  assert.ok(logs.some((row) => row.message.includes('/api/gui-frame/')), '降级日志必须点名因此没注册的路由');
});

test('产物与源码同源：入口形态与 lib/host 的产出状态一致，且不留孤儿产物', async () => {
  const hasHostProduct = existsSync(path.join(LIB_HOST_DIR, 'index.js'));
  assert.equal(
    readFileSync(ENTRY_OUT, 'utf8'),
    entrySource({ hasHost: hasHostProduct, loaderId: LOADER_ID, pkgName: pkg.name }),
    hasHostProduct
      ? 'lib/host/index.js 已存在 ⇒ lib/index.js 必须是转发壳（重跑 node scripts/build-host.mjs）'
      : 'lib/host/index.js 不存在 ⇒ lib/index.js 应是骨架占位入口',
  );
  for (const file of await listFiles(LIB_HOST_DIR)) {
    const rel = path.relative(LIB_HOST_DIR, file).split(path.sep).join('/');
    const sourceRel = rel.replace(/\.js$/, '.mjs');
    assert.ok(
      existsSync(path.join(SRC_HOST_DIR, sourceRel)) || existsSync(path.join(SRC_HOST_DIR, rel)),
      `lib/host 里有产物但没有对应源码：lib/host/${rel}（孤儿产物 ⇒ 重跑 node scripts/build-host.mjs）`,
    );
  }
});

test('lib/client.js：合法客户端产物（classic script / 单次 load / id / 种子子集 / 缺依赖零座位、有依赖成对注册）', () => {
  assert.ok(existsSync(CLIENT_OUT), `缺少客户端产物 ${path.relative(PKG_DIR, CLIENT_OUT)}（先跑 node scripts/build-client.mjs）`);
  const source = readFileSync(CLIENT_OUT, 'utf8');
  assert.ok(!/^\s*(import|export)\s/m.test(source), '产物必须是 classic script（顶层不得有 ESM 语法）');
  assert.equal((source.match(/^window\.__ModuleLoader__\.load\(\{/gm) ?? []).length, 1, '顶层只能调用一次 __ModuleLoader__.load');

  // "整包零注册"在"坞/面板成对注册座位"的装配现实下不成立。这里用**两套世界**分开钉：
  // "缺依赖不占座位"＋"有依赖真的注册"
  // （正面对照，证明前一条不是"什么都没跑"的空转判据）。
  // ① 缺依赖：一个平台服务都不给 ⇒ 不注册、不占座位，且降级可见
  const bare = createFakeSlots();
  const bareCtx = createFakeCtx({ services: {} });
  // 降级出口的取证：把装配期的 console 流抓下来（v1 的坞降级走这条 + 诊断上报，不必然走 logger）
  const consoleLines = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args) => { consoleLines.push(args.map(String).join(' ')); };
  console.warn = (...args) => { consoleLines.push(args.map(String).join(' ')); };
  let bareLoaded;
  try {
    bareLoaded = loadArtifact(source, { expectId: pkg.name, ctx: bareCtx.ctx });
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
  for (const row of bareLoaded.checks) assert.ok(row.ok, `产物校验未过：${row.name} —— ${row.detail}`);
  assert.ok(
    bareLoaded.required.every((name) => ALLOWED_REQUIRES.includes(name)),
    `require 集合必须 ⊆ ${JSON.stringify(ALLOWED_REQUIRES)}（否则双 React / 双 SlotCore）`,
  );
  assert.deepEqual(bare.injected, [], '缺 slots ⇒ 不许往任何座位注入（不注册、不占座位）');
  assert.deepEqual(bare.registered, [], '缺 slots ⇒ 不许注册任何座位');
  assert.deepEqual(
    [...bareCtx.provided.keys()],
    ['gui-frame'],
    '缺依赖时只许 provide 本插件自己的服务（服务名冻结为 gui-frame；那不是平台座位）',
  );
  assert.equal(bareCtx.calls.inject.length, 0, '不得 inject 任何依赖（声明即悬置 ⇒ 整页失败）');
  // ①b **降级可见性是设计不变量，具体出口随版本走**（v1 裁剪留痕）：声明的 `deck`/`theme`/`panel` 三步里
  //     真正依赖平台服务的只有 `dock`（`slots`）；它缺席时坞那条 install 返回 `installed:false`，
  //     汇合点按设计把它记成 `console.error` + 诊断上报，**不**必然落到 `ctx.logger.warn`
  //     （v2 的 `ctx.logger.warn` 那一路来自已被裁掉的 channel/overlay/layout）。
  //     ⇒ v1 的判据改成：**必须有一条可见的降级出口**（logger 或 console），而不是钉死某一层。
  const degradeVisible = bareCtx.logs.length > 0 || consoleLines.length > 0;
  assert.ok(degradeVisible, `缺依赖的降级必须可见（不许静默）：logger=${bareCtx.logs.length} 条／console=${consoleLines.length} 条`);
  assert.equal(bareCtx.logs.some((row) => row.level === 'error'), false, '缺依赖是降级不是错误');

  // ② 正面对照：slots 在位 ⇒ 坞与面板的座位确实成对注册（否则①是空转）
  //    这里还多一条 `shell.overlay`：overlay 原来读的是 `ctx.slots` 属性（真机会抛，离线世界恒 undefined
  //    ⇒ 座位从来没占上）。改成 `ctx.get('slots')` 软探测后，离线世界也能走到「占座位」那条路。
  const wired = createFakeSlots();
  const wiredCtx = createFakeCtx({ services: { slots: wired.slots } });
  const wiredLoaded = loadArtifact(source, { expectId: pkg.name, ctx: wiredCtx.ctx });
  for (const row of wiredLoaded.checks) assert.ok(row.ok, `产物校验未过：${row.name} —— ${row.detail}`);
  assert.deepEqual(
    [...new Set(wired.injected.map((row) => row.key))].sort(),
    ['main', 'shell.overlay', 'sidebar.panellist'],
    'slots 在位 ⇒ 恰三个座位：坞的成对注册（main + sidebar.panellist）+ 浮层宿主（shell.overlay；v1 的按钮面板就走它）',
  );
  const overlayReg = wired.registered.find((row) => row.options.name === 'shell.overlay');
  assert.ok(overlayReg !== undefined, 'shell.overlay 必须由 overlay 能力占上（v1 的按钮面板依赖它）');
  assert.equal(overlayReg.options.id, 'dsh-gui-frame/overlay', '座位 id 带命名空间前缀');
  assert.ok(wired.registered.length >= 3, `slots 在位 ⇒ 至少三条注册（实际 ${wired.registered.length}）`);
});

test('打包器自检：合成模块 ⇒ 拓扑序 / 绑定检查 / 产物可加载 / 空源码走占位形态', () => {
  const entryBody = [
    'const createClientModule = function (deps) {',
    "  return { apply: function () {}, inject: ['slots'], __internals: { react: deps.react } };",
    '};',
    '',
  ].join('\n');
  const modules = new Map([
    ['./a.mjs', { id: './a.mjs', file: 'a.mjs', imports: [], exports: ['alpha'], body: 'const alpha = 1;\n' }],
    ['./entry.mjs', {
      id: './entry.mjs',
      file: 'entry.mjs',
      imports: [{ spec: './a.mjs', bindings: [{ from: 'alpha', to: 'alpha' }] }],
      exports: ['createClientModule'],
      body: entryBody,
    }],
  ]);
  const { source, sorted } = buildArtifactText({ pkgName: pkg.name, modules });
  assert.deepEqual(sorted, ['./a.mjs', './entry.mjs'], '拓扑序：被依赖者在前');
  const loaded = loadArtifact(source, { expectId: pkg.name });
  for (const row of loaded.checks) assert.ok(row.ok, `${row.name} —— ${row.detail}`);
  assert.deepEqual(loaded.exports.inject, ['slots']);
  assert.deepEqual(checkBindings(modules), [], '绑定检查：import 的名字都在目标模块的导出列表里');
  const broken = new Map(modules);
  broken.set('./entry.mjs', { ...modules.get('./entry.mjs'), imports: [{ spec: './a.mjs', bindings: [{ from: 'nope', to: 'nope' }] }] });
  assert.equal(checkBindings(broken).length, 1, '绑定检查必须能变红（否则等于没查）');
  const empty = buildArtifactText({ pkgName: pkg.name, modules: new Map() });
  assert.equal(empty.mode, 'placeholder', 'src/client 为空 ⇒ 骨架占位 bundle');
  assert.equal(loadArtifact(empty.source, { expectId: pkg.name }).checks.filter((row) => !row.ok).length, 0);
});

test('rewriteSpecifiers：只改相对 .mjs 后缀', () => {
  assert.equal(rewriteSpecifiers("import { a } from './x.mjs';\n"), "import { a } from './x.js';\n");
  assert.equal(rewriteSpecifiers("export { b } from '../y.mjs';\n"), "export { b } from '../y.js';\n");
  assert.equal(rewriteSpecifiers("const m = await import('./z.mjs');\n"), "const m = await import('./z.js');\n");
  assert.equal(
    rewriteSpecifiers("const m = await import('@deepseek-ai/cordis');\n"),
    "const m = await import('@deepseek-ai/cordis');\n",
    '裸包名不得改写',
  );
  assert.equal(rewriteSpecifiers("import './keep.js';\n"), "import './keep.js';\n");
});

test('loadModules：src/client 缺席 ⇒ 空 Map；有源码则必须有 entry.mjs', async () => {
  assert.deepEqual([...(await loadModules(path.join(PKG_DIR, 'tests', 'unit', 'no-such-dir'))).keys()], []);
  const real = await loadModules();
  assert.ok(real instanceof Map);
  if (real.size > 0) assert.ok(real.has('./entry.mjs'), `src/client 有源码时必须含入口 ./entry.mjs（当前：${[...real.keys()].join('、')}）`);
  assert.ok(existsSync(SRC_CLIENT_DIR) || real.size === 0);
});

test('夹具自检：fake-react（元素树遍历 / 钩子 / 事件）', () => {
  const react = createFakeReact();
  const Item = (props) => react.createElement('span', { title: props.title }, `技能 ${props.name}`);
  const tree = react.createElement('div', { id: 'root' }, react.createElement(Item, { name: 'demo', title: '注入 demo' }), null, false);
  assert.deepEqual(typesOf(tree), ['div', 'Item', 'span'], 'typesOf 同时列出宿主元素与函数组件名');
  assert.equal(textOf(tree), '技能 demo');
  assert.equal(findAll(tree, (node) => node.type === 'span' && node.props.title === '注入 demo').length, 1);
  assert.equal(
    findByAttr(tree, 'title', '注入 demo').length,
    2,
    'props 同时出现在组件节点与它展开出的宿主节点上（遍历语义，断言按 type 收紧）',
  );
  assert.equal(findAll(tree, (node) => node.type === 'span').length, 1);
  const seen = [];
  walkElements(tree, (node) => seen.push(typeof node.type === 'string' ? node.type : 'fn'));
  assert.ok(seen.includes('div') && seen.includes('span'));

  function Counter() {
    const [count, setCount] = react.useState(0);
    react.useEffect(() => { setCount(1); }, []);
    return react.createElement('b', null, String(count));
  }
  const frame = renderComponent(react, Counter, {});
  assert.equal(textOf(frame), '0', '首帧 = 初始 state');
  assert.equal(react.__runEffects(), 1, 'effect 由测试手动跑（挂载语义）');
  const second = renderComponent(react, Counter, {});
  assert.equal(textOf(second), '1', '第二帧读到 effect 里写入的 state');

  const Button = () => react.createElement('button', { onClick: () => 'clicked' }, 'x');
  assert.equal(fire(react.createElement(Button, {}), (node) => node.type === 'button', 'onClick'), 'clicked');
  assert.throws(() => fire(tree, (node) => node.type === 'span', 'onClick'), /没有 onClick 处理器/);
});

test('夹具自检：fake-ctx（get/provide/inject/effect/logger/on + slots）', () => {
  const { ctx, logs, pendingInjects } = createFakeCtx({ services: { slots: { register: () => () => {} } } });
  assert.equal(typeof ctx.get('slots').register, 'function');
  assert.equal(ctx.get('nope'), undefined, '缺服务返回 undefined（不抛）');
  assert.equal(ctx.sessionId, 'session-1');

  let called = 0;
  ctx.inject(['settingsScope'], () => { called += 1; });
  assert.equal(called, 0, '依赖缺席 ⇒ 挂起');
  assert.equal(pendingInjects.length, 1);
  ctx.provide('settingsScope', { bind: () => () => {} });
  assert.equal(called, 1, '依赖补齐 ⇒ 自动回调');
  assert.equal(pendingInjects.length, 0);

  let effectRuns = 0;
  const off = ctx.effect(() => { effectRuns += 1; return () => { effectRuns -= 1; }; }, 'gui-frame: probe');
  assert.equal(effectRuns, 1, 'effect 立即执行一次');
  off();
  assert.equal(effectRuns, 0, 'disposer 可回收');

  ctx.logger.warn('warn-1');
  assert.equal(logs.at(-1).level, 'warn');
  assert.equal(logs.at(-1).message, 'warn-1');
  ctx.logger('named').info('info-1');
  assert.equal(logs.at(-1).message, 'info-1', "ctx.logger('名字') 也可用");

  let eventSeen = null;
  const offEvent = ctx.on('connection/reset', () => { eventSeen = 'fired'; });
  ctx.emit('connection/reset');
  assert.equal(eventSeen, 'fired');
  offEvent();
  eventSeen = null;
  ctx.emit('connection/reset');
  assert.equal(eventSeen, null, 'disposer 后不再收到事件');

  const { slots, injected, registered } = createFakeSlots();
  slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: 'dsh-gui-frame/dock' }, () => null));
  assert.equal(injected.length, 1);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].options.id, 'dsh-gui-frame/dock');
});
