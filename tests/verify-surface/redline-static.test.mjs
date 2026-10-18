/**
 * redline-static.test.mjs —— 独立复验（五）：**红线「未装 GUIFrame 时页面照常启动」的静态复核**。
 *
 * 红线：插件可以用本插件的接口和组件，但不能变成「不装本插件就启动不了」；
 * 依赖缺失时插件不激活（不注册、不占座位、面板不出现），且页面必须照常启动。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * 【这条红线到底禁什么：两个方向，别混】（下一个人请先读完这段，别把判据改回去）
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * · 被禁止的是「**别的插件** `inject: ['gui-frame']` 依赖**本插件**」这**一个方向**：客户端 inject 缺服务
 *   ⇒ fiber 永久 pending ⇒ 外壳 `assertEntriesActive` 抛错 ⇒ **整页打不开**。本文件继续钉住：
 *   任何 inject 列表里都不许出现 `gui-frame`。
 * · 反方向不禁：**本插件自己的宿主半区**依赖**平台自带服务**（`connection` 等）时，**按平台口径声明
 *   `inject: ['connection']`**，不走自检软探测。依据是平台自己的写法 —— 官方宿主插件
 *   `dsh-session-log-export/lib/index.js` 实读即 `const inject = ['commands','connection']`，再
 *   `ctx.connection.fetch.register(...)`；且 `connection` 是 DSH 自重服务（它不在 ⇒ DSH 本身已坏），
 *   不存在上面那种「缺依赖把整页拖死」的情形。
 * · 代价实证：本仓宿主半区原为 `inject: []` ⇒ `ctx.get('connection')` **永远**拿不到 ⇒ `/api/gui-frame/*`
 *   **全部从未注册** ⇒ 真机已鉴权直连 404（装置两轮宿主 stderr 铁证）。
 * · 边界（不得外推）：`inject` **只许声明平台自带服务**，且**声明集合必须等于代码实际访问的服务集合**
 *   （声明侧与访问侧**双向**机检；只看「声明了没有」对「声明了却用不到」与「用到了却没声明」两种真缺陷完全无感）。
 *   **客户端半区保持不变**：`inject` 恒空（整页风险只在客户端侧成立），且客户端一律走 `soft-probe` 访问器。
 *
 * 机制物证（见 `docs/探针记录-运行稳定性.md`）：
 *   - 客户端 `apply` 抛错 ⇒ `loader.create` 拒绝冒泡出 `runPluginBoot` 的 `Promise.all`（无 try/catch）
 *     ⇒ `page.fail` 且 **`mountApp` 永不执行** ⇒ 整页失败；
 *   - 声明了 `inject` 而服务缺席 ⇒ fiber `pending` ⇒ `assertEntriesActive` 抛错 ⇒ 同样整页失败。
 * 于是静态复核落成三条可机械验的判据：
 *   ① **装载通道口径（按 profile 的真实状态分腿，两条通道只许出现一条）**：
 *      **未装**：本包不在 profile 的 bundles 里、profile patch 里也没有 gui-frame 的 insert 行
 *      ⇒ 装载器不会取用本包的 `dsh.bundle.patch` ⇒ 组合里没有本插件 ⇒ 零代码执行；
 *      **已装（bundle 或 dev 其一）**：那一行**恰由一条通道**贡献，另一层不得重复写同一 id
 *      （同时出现 ⇒ duplicate loader entry id: gui-frame ⇒ profile 起不来）；
 *      未装态（零影响）另由真机装置用出厂模板对照 profile 独立取证；
 *   ② **装了/降级**：inject 只许平台自带服务且「声明集合 = 实际访问集合」（不得含 `gui-frame`）；
 *      `apply` 同步不抛、缺依赖时不激活但降级可见；`provideService` 冲突/失败一律让位且**不 rethrow**；
 *   ③ **变异反证**：四条定向变异（死声明 / 漏声明 / 越界声明 `gui-frame` / 白名单外服务名）必须各自变红。
 * 结论写进验证报告 `tests/verify-surface/服务面与红线验证报告.md`。
 *
 * 只读：本文件不写任何文件（变异反证用的 TEMP 副本由 harness 建、跑完即删）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  PKG_DIR,
  REPORT_PATH,
  createCtx,
  listFilesRecursive,
  parseInsertRows,
  pkg,
  readWebProfile,
  runSuiteInCopy,
  srcPath,
} from './harness.mjs';

const CLIENT_SEED_KEYS = ['react', 'jsxRuntime', 'reactDom', 'cordis', 'store', 'primitives', 'slots', 'dockkit'];

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 「inject 只许声明平台自带服务且声明集合 = 实际访问集合」这条判据用的常量与扫描器
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * **平台自带服务白名单** —— 「`inject` 只许声明平台自带服务」的判据面。
 * 只许在有平台证据（官方产物实读 / 真机实测）时往里加名字；**严禁**把本包自己的服务或自造服务名写进来。
 * 来源（真机实测 / 官方产物实读 / 本包真实调用点）：
 *       · `slots` / `layout` / `locale` / `settingsScope` / `connection`：真机实测；
 *       · `commands` / `connection`：官方宿主插件实读；
 *       · `@deepseek-ai/dsh-settings`（本机装机包）的 `Service.register/installSection/describe` 就是 `ctx.settings` 的公开面；
 *       · 官方 `dsh-client-ui-theme` 的**宿主半区**正是 `ctx.inject(['settings'], …) → settings.register('ui-theme', …)`；
 *       · `settings` 在本包有**真实调用点**（`src/host/settings.mjs` 的 `settings.register('gui-frame', …)`）。
 *       ⇒ 这是「有平台证据 + 有调用点」的扩表，**不是**本项目已否定的「无调用点的白名单扩容」。
 */
const PLATFORM_SERVICES = Object.freeze(['connection', 'slots', 'settingsScope', 'layout', 'locale', 'commands', 'settings']);
/** 本包自己的服务名：**任何** inject 列表里都不许出现（那是「别的插件依赖本插件」的方向）。 */
const OWN_SERVICE = 'gui-frame';
/** 变量探针（不是平台服务，不参与 inject 判据）。 */
const VARIABLE_PROBES = Object.freeze(['workspace']);

/** 剥注释（块注释 + 整行行注释）：注释里的示例串不许命中判据。 */
function codeOf(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 解析一段代码里的 `inject` 声明（三种写法）⇒ 名字数组的列表。 */
function parseInjectDeclarations(code) {
  const raws = [];
  for (const match of code.matchAll(/\binject\s*:\s*(\[[^\]]*\])/g)) raws.push(match[1]);
  for (const match of code.matchAll(/\binject\s*=\s*Object\.freeze\(\s*(\[[^\]]*\])/g)) raws.push(match[1]);
  for (const match of code.matchAll(/\binject\s*=\s*(\[[^\]]*\])/g)) raws.push(match[1]);
  return raws.map((raw) => [...raw.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]));
}

/** 读一个半区的全部 `.mjs`（剥注释）并建常量表（`const X = 'name'` ⇒ X → name，用于解析 `ctx.get(CONST)`）。 */
function readHalf(relDir) {
  const files = listFilesRecursive(srcPath(relDir)).filter((entry) => entry.rel.endsWith('.mjs'));
  const constants = new Map();
  const sources = [];
  for (const file of files) {
    const text = codeOf(readFileSync(file.full, 'utf8'));
    sources.push({ rel: file.rel.split(path.sep).join('/'), text });
    for (const match of text.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)) constants.set(match[1], match[2]);
  }
  return { files, sources, constants };
}

/**
 * 一个半区的服务访问面（两类通道，**互斥**）：
 *   - `direct`：**硬访问** —— `ctx.get('x')` / `ctx.get(CONST)` / `ctx.x`（不经 soft-probe 访问器）⇒ **必须声明**；
 *   - `soft`：**软探测** —— 经 `soft-probe.mjs` 的 `probeService(ctx,'x')` / `readService(ctx,'x')` ⇒ **不得声明**
 *     （声明了就等于把可选依赖变成激活闸门；客户端侧更会 pending 打死整页）。
 * 访问器模块自身（`soft-probe.mjs`）与变量探针（`workspace`）不计入。
 */
function scanServiceAccess(relDir) {
  const { files, sources, constants } = readHalf(relDir);
  const direct = new Set();
  const soft = new Set();
  const unresolved = new Set();
  for (const file of sources) {
    if (file.rel === 'soft-probe.mjs') continue;
    for (const match of file.text.matchAll(/\b(?:probeService|readService)\s*\(\s*[^,()]+,\s*(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))/g)) {
      const name = match[1] ?? constants.get(match[2]);
      if (typeof name === 'string' && !VARIABLE_PROBES.includes(name)) soft.add(name);
    }
    for (const match of file.text.matchAll(/\bctx\s*(?:\?\.|\.)\s*get\s*(?:\?\.)?\s*\(\s*(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*\)/g)) {
      if (typeof match[1] === 'string') {
        if (!VARIABLE_PROBES.includes(match[1])) direct.add(match[1]);
        continue;
      }
      const resolved = constants.get(match[2]);
      if (typeof resolved === 'string') direct.add(resolved);
      else unresolved.add(match[2]);
    }
    for (const match of file.text.matchAll(/\bctx\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) {
      if (PLATFORM_SERVICES.includes(match[1])) direct.add(match[1]);
    }
  }
  return { files, direct, soft, unresolved };
}

/** 每个半区声明的 inject 集合（声明侧）。 */
function declaredInjectOf(sources) {
  const names = new Set();
  const raw = [];
  for (const file of sources) for (const list of parseInjectDeclarations(file.text)) { raw.push({ rel: file.rel, list }); for (const name of list) names.add(name); }
  return { names, raw };
}

const CLIENT_HALF = scanServiceAccess('client');
const HOST_HALF = scanServiceAccess('host');
const CLIENT_SOURCES = readHalf('client').sources;
const HOST_SOURCES = readHalf('host').sources;
const CLIENT_DECLARED = declaredInjectOf(CLIENT_SOURCES);
const HOST_DECLARED = declaredInjectOf(HOST_SOURCES);

const sorted = (set) => [...set].sort();

test('装载通道口径：未装 ⇒ 组合里没有本插件（零代码执行）；已装 ⇒ 恰一条通道贡献那一行', (t) => {
  const profile = readWebProfile();
  const inBundles = profile.readable ? (profile.manifest?.dsh?.profile?.bundles ?? []).includes(pkg.name) : false;
  const devRows = profile.readable
    ? parseInsertRows(profile.patchText).filter((row) => row.id === 'gui-frame' || row.name === pkg.name)
    : [];
  const channel = inBundles === false && devRows.length === 0 ? '未装' : (inBundles ? 'bundle（bundles 点名）' : 'dev（profile patch insert）');

  if (profile.readable) {
    // 铁律一：两条通道**只许出现一条** —— 同时出现即 duplicate loader entry id: gui-frame（profile 起不来）
    assert.equal(
      inBundles === false || devRows.length === 0,
      true,
      `两条装载通道同时出现（bundles=${inBundles}／profile patch 的 gui-frame insert 行=${devRows.length}）—— duplicate id 会让 profile 起不来`,
    );
    // 铁律二：**未装 = 零影响** —— 不在 bundles 且 dev 无行 ⇒ 组合里没有本插件
    //         已装（bundle 通道）时那一行由本包 `dsh.bundle.patch` 贡献 ⇒ dev 层绝不许再写同一 id
    assert.deepEqual(devRows, [], `profile 的 cordis.patch.yml 里不得出现 gui-frame 的 insert 行（当前通道=${channel}）`);
    t.diagnostic(`profile 可读：${profile.dir}｜装载通道=${channel}｜在 bundles=${inBundles}｜profile patch 里 gui-frame insert 行数=${devRows.length}`);
  } else {
    t.diagnostic(`profile 不可读（${profile.dir}）—— 外部状态不可观测，本条只复核包侧陈述`);
  }

  // 包侧：本包的注册**只可能**来自这一行 insert；不在 bundles ⇒ 装载器不会读它 ⇒ 组合里没有 gui-frame
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  const pkgPatch = path.join(PKG_DIR, pkg.dsh.bundle.patch);
  assert.ok(existsSync(pkgPatch), 'dsh.bundle.patch 指向的文件必须存在');
  const rows = parseInsertRows(readFileSync(pkgPatch, 'utf8'));
  assert.equal(rows.length, 1, '本包 patch 恰好一行 insert');
  assert.equal(rows[0].id, 'gui-frame');
  assert.equal(rows[0].name, pkg.name);

  // 静态链条：**未装** ⇒ 不在 bundles ⇒ 不读本包 patch ⇒ 组合里没有 gui-frame 行 ⇒ 本包零代码执行
  //            **已装** ⇒ 在 bundles 与 dev 行**恰有其一** ⇒ 组合里恰一行，且它只能来自上面复验过的那一行 insert
  if (profile.readable && inBundles) {
    assert.equal(devRows.length, 0, 'bundle 通道已就位 ⇒ dev 层不得再贡献同一 id');
    assert.equal(rows.length, 1, '已装（bundle 通道）⇒ 本包 patch 恰一行 insert，就是组合里那一行');
  } else {
    assert.equal(inBundles, false);
    assert.equal(devRows.length, 0);
  }

  // loader entry id 必须等于宿主入口的 name（不一致会在装载期报错 —— 也是「装了起不来」的一种）
  const hostEntry = readFileSync(srcPath('host', 'index.mjs'), 'utf8');
  assert.match(hostEntry, /export const name = 'gui-frame'/);
  assert.equal(rows[0].id, 'gui-frame');
});

test('装了也不许打死页面：inject 只许平台自带服务且「声明集合 = 实际访问集合」、apply 同步不抛、provideService 冲突不 rethrow', async () => {
  // ══ ① 声明侧：只许平台自带服务（白名单）+ 不得含本插件自己的服务 + 扫描非空转自守
  const declarations = [...CLIENT_DECLARED.raw.map((row) => ({ ...row, half: 'client' })), ...HOST_DECLARED.raw.map((row) => ({ ...row, half: 'host' }))];
  assert.ok(declarations.length >= 2, `inject 声明扫描必须真的扫到东西（当前 ${declarations.length} 处）—— 否则下面的判据是空转`);
  const allDeclared = new Set([...CLIENT_DECLARED.names, ...HOST_DECLARED.names]);
  const unknown = sorted(allDeclared).filter((name) => !PLATFORM_SERVICES.includes(name));
  assert.deepEqual(unknown, [], `inject 只许声明**平台自带服务** —— 越界名：${unknown.join('、')}\n  白名单：${PLATFORM_SERVICES.join(' / ')}`);
  assert.equal(allDeclared.has(OWN_SERVICE), false, `任何 inject 里都不许出现本插件自己的服务 ${OWN_SERVICE}（那是「别的插件依赖本插件」的方向）`);

  // ══ ② 访问侧：两个半区各自算「硬访问 / 软探测」两个互斥通道
  // 自守：访问侧扫描必须真的看得见东西（否则等式两侧都是空集 = 空转）
  assert.ok(CLIENT_HALF.files.length >= 8, `客户端半区被扫描的文件太少（${CLIENT_HALF.files.length}）`);
  assert.ok(HOST_HALF.files.length >= 2, `宿主半区被扫描的文件太少（${HOST_HALF.files.length}）`);
  assert.ok(CLIENT_HALF.soft.size >= 3, `客户端半区必须能扫到软探测访问（当前 ${sorted(CLIENT_HALF.soft).join('、') || '无'}）`);
  assert.deepEqual(sorted(HOST_HALF.unresolved), [], `宿主半区里的 ctx.get(标识符) 必须都能解析成字符串（未解析：${sorted(HOST_HALF.unresolved).join('、')}）`);
  // 未解析的标识符只允许是本插件自己的服务名常量（SERVICE_NAME ⇒ 'gui-frame'，那是冲突探测，不是平台依赖）
  assert.deepEqual(sorted(CLIENT_HALF.unresolved).filter((name) => name !== 'SERVICE_NAME'), [], `客户端半区里出现了无法解析的服务标识符：${sorted(CLIENT_HALF.unresolved).join('、')}`);

  // ══ ③ 等式：声明集合 = 实际访问集合（逐半区，双向）
  // 客户端半区：inject 恒空（客户端缺服务 ⇒ fiber pending ⇒ 整页打不开）
  assert.deepEqual(
    sorted(CLIENT_DECLARED.names),
    [],
    `客户端半区 inject 必须恒为空数组（客户端缺服务 ⇒ fiber pending ⇒ assertEntriesActive 抛错 ⇒ 整页打不开）—— 实际：${sorted(CLIENT_DECLARED.names).join('、') || '（空）'}`,
  );
  assert.deepEqual(sorted(CLIENT_HALF.soft).filter((name) => CLIENT_DECLARED.names.has(name)), [], '软探测的服务**不得**出现在 inject 里（那会把可选依赖变成激活闸门）');

  // 逐半区双向对账（**这一对就是「声明集合 = 实际访问集合」的一般形式**）：
  //   ① 提到的服务必须被「声明」或「软探测」之一覆盖 —— 缺了就是「用到了却没声明」（真机上永远拿不到）；
  //   ② inject 里的每个名字都必须真的被访问过 —— 缺了就是死声明（旧判据对这两种真缺陷完全无感）。
  // 注：`ctx.<服务>` 属性读取与诊断文案里出现的服务名都算「提到」，因此本对账是**保守**的（提到即要能交代通道）。
  const mentionedOf = (half) => new Set([...half.direct, ...half.soft]);
  for (const [label, half, declared] of [['client', CLIENT_HALF, CLIENT_DECLARED.names], ['host', HOST_HALF, HOST_DECLARED.names]]) {
    const mentioned = mentionedOf(half);
    const unaccounted = sorted(mentioned).filter((name) => name !== OWN_SERVICE && !declared.has(name) && !half.soft.has(name));
    assert.deepEqual(
      unaccounted,
      [],
      `${label} 半区有服务「既没写进 inject、也没走 soft-probe 访问器」：${unaccounted.join('、')}（用到了却没声明 ⇒ 真机上永远拿不到）`,
    );
    const dead = sorted(declared).filter((name) => !mentioned.has(name));
    assert.deepEqual(dead, [], `${label} 半区 inject 里有**死声明**（没有任何代码访问过）：${dead.join('、')}`);
  }

  // 宿主半区：声明集合 === 实际访问集合（最锋利的形式；缺 connection 就是这里漏的）
  assert.deepEqual(sorted(HOST_HALF.soft), [], `宿主半区不得走软探测通道（依赖平台自带服务时按平台口径声明 inject）—— 实际软探测：${sorted(HOST_HALF.soft).join('、') || '（无）'}`);
  const hostDeclaredList = sorted(HOST_DECLARED.names);
  const hostAccessedList = sorted(HOST_HALF.direct);
  assert.deepEqual(hostDeclaredList, hostAccessedList, `宿主半区的 inject 必须**恰好等于**代码实际访问的平台服务集合：声明 [${hostDeclaredList.join('、')}] vs 实访 [${hostAccessedList.join('、')}]（多一个＝死声明；少一个＝用到了却没声明 ⇒ 真机上永远拿不到）`);
  assert.ok(hostAccessedList.length >= 1, '宿主半区必须至少访问一个平台服务（否则等式两侧同时为空 = 空转）');

  // ══ ④ 产物侧（平台真正加载的东西）：inject 与源码声明同源，且不含本插件自己的服务
  const host = await import(pathToFileURL(path.join(PKG_DIR, 'lib', 'index.js')).href);
  assert.equal(host.name, 'gui-frame');
  assert.deepEqual(
    [...(host.inject ?? [])].sort(),
    hostDeclaredList,
    '产物 lib/index.js 的 inject 必须与源码声明一致（不一致 ⇒ 先 `npm run build`；平台加载的是产物，不是源码）',
  );
  assert.equal((host.inject ?? []).includes(OWN_SERVICE), false, `产物 inject 里不许出现 ${OWN_SERVICE}（那是「别的插件依赖本插件」的方向）`);
  assert.equal(typeof host.apply, 'function');
  assert.equal(host.default?.name, host.name);

  // ══ ⑤ 行为保形（原判据的**目的**：不成为启动前提 / 缺依赖不激活 / 页面照常启动）
  //   5.1 客户端入口：apply 同步不抛、只 provide 自己的服务、缺依赖不占座位、降级可见
  const entryMod = await import(pathToFileURL(srcPath('client', 'entry.mjs')).href);
  const seeds = Object.fromEntries(CLIENT_SEED_KEYS.map((key) => [key, Object.freeze({ __seed: key })]));
  const clientModule = entryMod.createClientModule(seeds);
  assert.deepEqual(clientModule.inject, [], '客户端入口不得声明硬依赖（声明了而服务缺席 ⇒ fiber pending ⇒ boot 抛错打死整页）');
  assert.equal(typeof clientModule.apply, 'function');
  const clientCtx = createCtx({ label: 'client' });
  let returned;
  assert.doesNotThrow(() => { returned = clientModule.apply(clientCtx); }, '客户端 apply 不得抛错');
  assert.equal(returned, undefined, 'apply 必须同步返回 undefined（返回 Promise 会被 Cordis 当 effect 收集）');
  assert.deepEqual(
    [...clientCtx.provided.keys()],
    ['gui-frame'],
    `缺依赖时只许 provide 本插件自己的服务（平台座位一个都不许占）—— 实际：${JSON.stringify([...clientCtx.provided.keys()])}`,
  );
  assert.ok(clientCtx.calls.get >= 3, `装配必须真的探测过服务（否则下面的"未激活"是空转判据）—— get 次数=${clientCtx.calls.get}`);
  assert.ok(clientCtx.calls.effect >= 1, '装配自己的 effect 照常登记（说明装配真的跑过，不是整体短路）');
  const assembly = clientModule.__internals?.lastAssembly?.() ?? null;
  assert.notEqual(assembly, null, 'apply 之后必须留下装配记录（诊断与机检的观察口）');
  const byCapability = Object.fromEntries((assembly.capabilities ?? []).map((row) => [row.capability, row]));
  assert.equal(byCapability.dock?.installed, false, '缺 slots ⇒ 坞不得激活（GB15：不注册、不占座位）');
  assert.equal(byCapability.dock?.reason, 'no-slots', '未激活必须给出具体原因');
  assert.equal(byCapability.panel?.installed, false, '缺 react 种子 ⇒ 面板不得激活');
  assert.equal(typeof byCapability.panel?.reason === 'string' && byCapability.panel.reason !== '', true, '未激活必须给出具体原因');
  assert.equal(byCapability.theme?.installed, true, '无强依赖的能力照常装配（不是整体让位）');
  assert.ok(clientCtx.logs.some((row) => row.level === 'warn'), '降级必须可见（至少一条 warn）');
  assert.equal(clientCtx.logs.some((row) => row.level === 'error'), false, '缺依赖是降级不是错误（error 会误导现场）');

  //   5.2 宿主入口的**行为**（拿不到 connection 时）：apply 不抛、不 provide、降级可见 —— 页面照常启动
  const hostCtx = createCtx({ label: 'host' });
  assert.equal(host.apply(hostCtx), undefined, '宿主 apply 必须同步返回 undefined');
  assert.equal(hostCtx.calls.provide, 0, '宿主侧不得 provide 任何服务');
  assert.equal(hostCtx.logs.some((row) => row.level === 'error'), false, '缺依赖不是 error');
  if (hostDeclaredList.length === 0) {
    // 只有宿主半区不声明任何 inject 时，"缺依赖也得能跑"才是必须成立的（声明了则由平台闸门保证不激活）
    assert.equal(hostCtx.calls.effect, 0, '宿主侧缺依赖时不得注册 effect');
    assert.ok(hostCtx.logs.some((row) => row.level === 'warn' && /connection/.test(row.message)), '宿主侧缺依赖必须留可见降级（点名缺席的服务）');
  } else {
    // 声明式 inject 在位：平台侧「服务不在 ⇒ 插件根本不激活」由产物 inject 与源码声明逐条相等来钉；
    // 这里只要求"万一被直接 apply（替身/离线场景）也不抛、也不静默"。
    assert.doesNotThrow(() => host.apply(createCtx({ label: 'host-2' })), '宿主 apply 在缺依赖的直接调用下也不得抛');
  }

  // ══ ⑥ provideService：冲突/失败路径一律让位，catch 里不得 rethrow
  const serviceSrc = readFileSync(srcPath('client', 'service.mjs'), 'utf8');
  const fnStart = serviceSrc.indexOf('export function provideService');
  assert.ok(fnStart > 0);
  const fnBody = serviceSrc.slice(fnStart, serviceSrc.indexOf('\n}\n', fnStart));
  assert.match(fnBody, /const existing = typeof ctx\.get === 'function' \? ctx\.get\(SERVICE_NAME\) : undefined/, '提供前必须先 ctx.get 探测');
  const catchStart = fnBody.indexOf('catch (error)');
  assert.ok(catchStart > 0, 'provideService 必须捕获 provide 失败');
  const catchBlock = fnBody.slice(catchStart, fnBody.indexOf('\n  }', catchStart));
  assert.equal(/\bthrow\b/.test(catchBlock), false, 'catch 里绝不许 rethrow（客户端/宿主一旦冒泡就是整页失败）');
  assert.match(catchBlock, /owned: false/, 'catch 必须返回 owned:false 的让位结果');

  const serviceMod = await import(pathToFileURL(srcPath('client', 'service.mjs')).href);
  const throwingCtx = createCtx({ label: 'throwing' });
  throwingCtx.provide = () => { throw new Error('duplicate service name in this scope'); };
  assert.doesNotThrow(() => serviceMod.provideService(throwingCtx));
  const takenCtx = createCtx({ services: { 'gui-frame': Object.freeze({}) } });
  assert.doesNotThrow(() => serviceMod.provideService(takenCtx));
});

test('变异反证：四条定向变异各自把「装了也不许打死页面」那条判据打红（TEMP 副本内实测）', async () => {
  const HOST_ENTRY = path.join('src', 'host', 'index.mjs');
  // 当前真值：宿主半区给 `gui-frame` 注册 settings 命名空间（所以 inject 里必须有 settings）
  // —— 这个锚点若与实现漂移，本用例会**当场失败并指出漂移**（不是静默跳过）：这正是它的强度所在，
  //    改它＝把「当前真值」重新钉到新的实现上，而四条定向变异（死声明 / 漏声明 / 越界声明本包服务 / 非平台名）
  //    依旧逐条必须被那条注入判据抓住 —— 强度不变，只是真值跟着实现走。
  const DECLARED = "export const inject = ['connection', 'settings'];";
  const MUTATIONS = [
    {
      id: 'dead-declaration',
      what: '给 inject 加一个**未被任何代码访问**的平台服务（locale）⇒ 死声明',
      from: DECLARED,
      to: "export const inject = ['connection', 'locale'];",
    },
    {
      id: 'missing-declaration',
      what: '从 inject 删掉一个**被实际访问**的服务（connection）⇒ 用到了却没声明',
      from: DECLARED,
      to: 'export const inject = [];',
    },
    {
      id: 'q16-direction',
      what: '往 inject 里塞本插件自己的服务（gui-frame）⇒ 撞 Q16 方向',
      from: DECLARED,
      to: "export const inject = ['connection', 'gui-frame'];",
    },
    {
      id: 'non-platform',
      what: '往 inject 里塞白名单外的服务名（notARealService）⇒ 违反「只许平台自带服务」',
      from: DECLARED,
      to: "export const inject = ['connection', 'notARealService'];",
    },
  ];

  const caught = [];
  const escaped = [];
  for (const mutation of MUTATIONS) {
    const result = await runSuiteInCopy({
      include: ['src', 'tests', 'lib'],
      testFiles: [path.join('tests', 'verify-surface', 'redline-static.test.mjs')],
      mutate: (tmp) => {
        const file = path.join(tmp, ...HOST_ENTRY.split('/'));
        const text = readFileSync(file, 'utf8');
        assert.equal(text.includes(mutation.from), true, `变异锚点必须命中 ${HOST_ENTRY}（当前 inject 声明与判据假定不一致）`);
        const next = text.replace(mutation.from, mutation.to);
        assert.notEqual(next, text, `变异必须真的改动 ${HOST_ENTRY}`);
        // 只写 TEMP 副本（不碰包内文件）
        writeFileSync(file, next, 'utf8');
      },
    });
    if (result.status === 0) {
      escaped.push(`${mutation.id}（${mutation.what}）：副本里仍然全绿 —— 假绿！`);
      continue;
    }
    if (!result.failing.some((name) => name.includes('装了也不许打死页面：inject 只许平台自带服务且「声明集合 = 实际访问集合」、apply 同步不抛、provideService 冲突不 rethrow'))) {
      escaped.push(`${mutation.id}（${mutation.what}）：变红了但红的不是那条 inject 判据 —— 失败项：${result.failing.join(' ｜ ') || '(未能解析)'}`);
      continue;
    }
    caught.push(mutation.id);
  }

  assert.deepEqual(escaped, [], `以下变异没有被抓住：\n  - ${escaped.join('\n  - ')}`);
  assert.equal(caught.length, MUTATIONS.length);
});

test('红线结论已写进验证报告（tests/verify-surface/服务面与红线验证报告.md）', () => {
  assert.ok(existsSync(REPORT_PATH), `验证报告必须存在：${REPORT_PATH}`);
  const report = readFileSync(REPORT_PATH, 'utf8');
  for (const needle of [
    '未装 GUIFrame 时页面照常启动',
    '红线',
    '结论',
    'npm test',
    'npm run build',
    'node --check lib/client.js',
    'tests/verify-surface',
  ]) {
    assert.ok(report.includes(needle), `验证报告里必须含「${needle}」`);
  }
  assert.match(report, /##\s*一、红线静态复核|##\s*红线/, '报告里必须有红线的独立小节');
  assert.match(report, /未覆盖|残余/, '报告必须诚实登记未覆盖项');
  assert.ok(report.length > 1500, `验证报告过短（${report.length} 字符）`);
});
