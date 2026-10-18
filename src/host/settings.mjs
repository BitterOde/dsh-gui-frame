/**
 * settings.mjs —— **宿主侧 `settings` 命名空间注册**（`src/host/` 声明命名空间）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 【为什么必须有这个文件 —— 真机实证（隔离 `$DSH_HOME`）】
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 真机上坞面板的布局编辑器状态行读到的是 `布局 v2 · rev 2 · **unavailable（只读）**`，
 * 显式覆盖锚点 `data-guif-layout-overwrite` 计数 **0** —— 即：**能力⑤「布局持久化」从来没接上宿主**，
 * 「可保存」在真机上一直是只读，「载荷损坏 ⇒ 用默认值覆盖」也因此结构性不可达。
 *
 * 机制（读装机源码取证：`dsh-client-ui-settings` 的 fold + `dsh-settings` 的 `describe()`）：
 *   · 客户端 scope 只在宿主 `describe()` 的**已注册命名空间**里找自己那一节
 *     （`view.namespaces.find(c => c.ns === spec.namespace)` 未命中 ⇒ `status = 'unavailable'`）；
 *   · `describe()` 只遍历宿主 `registrations` —— 只有宿主侧 `settings.register(ns, schema)` /
 *     `installSection(owner, ns, schema, …)` 过的命名空间才算数；
 *   · 对照样本：`dsh-client-ui-theme` 的**宿主半区**给自己注册了 `ui-theme`，用户 `settings.yaml`
 *     里于是有 `ui-theme` 一节；本包此前**没有宿主侧注册**（`src/host/**` 里 grep settings 零命中）
 *     ⇒ `settings.yaml` 里也从来没有 `gui-frame` 一节。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 【为什么取 schema 的路径要绕：宿主半区只许静态 import 相对路径与 `node:` 内建】
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 第二轮真机把机制钉到客户端那一环（`read.kind=unavailable` ⇒ `writability=false` ⇒ 一个字节
 * 不落盘 ⇒ 刷新回 official），但**宿主侧注册到底发生了没有**当时读不到（结果只进 Cordis logger 的
 * 内存 buffer）。离线把根因定位到**取 schema 这一步**：
 *   · 插件经 profile **Junction** 装载（`<profile>/node_modules/dsh-gui-frame` → 插件包的真实目录），
 *     Node 解析模块时按 **realpath** 走；
 *   · 于是 `import('@deepseek-ai/schemastery')` 从 **realpath**（工作区）向上找 `node_modules`
 *     **命不中**装机 DSH 里的那一份（实测 `createRequire('…/lib/host/index.js').resolve(…)`
 *     ⇒ `MODULE_NOT_FOUND`；DSH 安装树内也没有 `--preserve-symlinks`）⇒ 本文件返回
 *     `schemastery-unavailable`，**从不调用 `settings.register`** ⇒ 客户端永远 `unavailable`。
 * ⇒ 取径**锚点解析**：先按若干**候选锚**把包名解析成可 import 的**绝对路径**，再
 *   `import(pathToFileURL(resolvedPath).href)`；候选锚依次为 `ctx.baseUrl`（平台给的 baseUrl）→
 *   `process.argv[1]`（DSH 启动入口，装在其 `node_modules` 链上）→ **profile 目录**（从 `DSH_HOME`
 *   发现）；**全部失败仍降级**（照旧 `schemastery-unavailable`，不抛、不影响页面）；裸
 *   `import(specifier)` 只作**最后一次兜底**（旧行为，保留以免改变任何既有语义）。**零新依赖**
 *   （`dependencies` 恒为空）。每个候选锚的成败都进报告的 `anchorAttempts`（可读读数）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 【三条实现纪律（每条都有真机/装机源码依据）】
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  ① **在插件自己的 ctx 上注册**：`settings.register()` 内部是
 *     `this.ctx.effect(() => { registrations.set(ns, …) ; return () => registrations.delete(ns) })`，
 *     而 `this.ctx` 由 Cordis 在**调用点**绑成调用方 ctx（与 `settingsScope.bind` 同一个绑定机制）。
 *     所以从**插件自己的 ctx** 调用 ⇒ 注册就是**插件 fiber 上的一条 effect**，插件卸载即自动注销。
 *     反例（真机实测）：把它写进 `ctx.inject(['settings'], scoped => scoped.settings.register(…))`
 *     就绑到了那个**临时 scope** 上 —— 日志说「已注册」，随 scope 一结束注册就没了（端点 404 / 命名空间消失）。
 *     ⇒ 本包一律走**声明式 `inject`**（`src/host/index.mjs` 的 `export const inject`），让 `apply` 直接跑在
 *     插件自己的 fiber 上；**不要**退回 `ctx.inject(…)` 回调。
 *  ② **动态 import schemastery**：宿主半区只许静态 import 相对路径或 `node:`（build-host 的依赖边界闸
 *     `checkSpecifierPurity` 盯着），平台包一律走 `import()`。`dependencies` 恒为空。
 *  ③ **绝不抛**：宿主 `apply` 抛错会连累整页。拿不到服务 / 拿不到 schemastery / 注册被拒
 *     （重名、存量节非法）都只是「未注册 + 一条可见诊断」，页面照常。
 *  ④ **注册尝试的结果必须是可读读数**（`anchorAttempts` / `schemaSource` / `settingsSource` /
 *     `seq` / `at` 挂在报告的每一条返回上；`src/host/index.mjs` 再把它写进 stderr）。
 *     **只增加可观测性，不改变注册行为**：注册调用的实参（ns / schema / `{applies:'live'}`）与
 *     fiber 归属一字未动。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 【schema 为什么是 `z.object({ layout: z.any() })`】
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `layout` 装的是本包自己的 `VersionedLayout`（JSON 值），**宿主不做二次校验**：
 * 「载荷坏了」这件事必须能被客户端读到（`migrate` 报 `GUIF-W-LAYOUT-CORRUPT` ⇒ `read.kind='invalid'`），
 * 客户端才有机会给出显式出路。宿主若在这里按结构拦掉，坏载荷就读不到了，
 * 「用户点名用默认值覆盖」在真机上会再次变成结构性不可达。⇒ 用 `z.any()` 原样透传，
 * 校验与迁移的**唯一真源**留在客户端 `migrate.mjs`。
 */

import { pathToFileURL } from 'node:url';

import { describeError, defaultResolveFrom, isObject, schemaAnchors as _schemaAnchors } from './schema-probe.mjs';

/** 候选锚的发现与排序（**定义已搬 `schema-probe.mjs`**；本行是原路径的同一入口，行为一字未改）。 */
export const schemaAnchors = _schemaAnchors;

/** 命名空间（客户端经 `ctx.settingsScope.bind({namespace})` 取用时要逐字对上，否则永远 unavailable）。 */
export const LAYOUT_NAMESPACE = 'gui-frame';
/** 载荷字段名（**标量字段级写**：客户端写的是这一个字段，不整段替换 namespace）。 */
export const LAYOUT_FIELD = 'layout';
/**
 * **门控字段**：本插件自用的**测试工作台**开不开。
 * `false`（**缺省**）⇒ 客户端状态表只剩 `official` ⇒ 顶部那个工作台开关**自动隐藏**（＝默认就是 DSH 原版）。
 */
export const TEST_WORKBENCH_FIELD = 'testWorkbench';
/**
 * **外观覆盖字段**：工作台开关的尺寸 / 滑块位置 / 颜色 / 文字等覆盖。
 * ⚠ 本版没有测试工作台 ⇒ 这个字段**没有消费方**（与 `LAYOUT_FIELD` 同）；`z.any()` 原样透传。
 */
export const SWITCH_STYLE_FIELD = 'workbenchSwitch';
/** 本命名空间声明的全部字段（诊断读数与判据用；顺序稳定）。 */
export const NAMESPACE_FIELDS = Object.freeze([LAYOUT_FIELD, TEST_WORKBENCH_FIELD, SWITCH_STYLE_FIELD]);
/** schemastery 的包名（宿主半区只经 `import()` 取它；不写进 dependencies）。 */
export const SCHEMASTER_SPECIFIER = '@deepseek-ai/schemastery';
/** 注册那条 effect 的固定标签（真机日志与判据都认它）。 */
export const SETTINGS_EFFECT_LABEL = `gui-frame: settings.register(${LAYOUT_NAMESPACE})`;
/** 注册时的时机声明：布局改动对属主**立即生效**（与 ui-theme 同款默认 `live`）。 */
export const SETTINGS_APPLIES = 'live';

/** 尝试序号（只读读数：真机上把「宿主第几次尝试」与客户端事件对上时间序）。 */
let installSeq = 0;


/**
 * **逐个锚试解析**（只读、不抛、不 import）：把包名解析成绝对路径。
 * @param {Array<{name:string, anchor:string}>} anchors
 * @param {{specifier?:string, resolveFrom?:Function}} [options] `resolveFrom` 可注入（单测用替身，不碰真解析）
 * @returns {{attempts:Array<{name:string,anchor:string,ok:boolean,reason:string|null,resolvedPath:string|null}>, hit:object|null}}
 */
export function probeSchemaAnchors(anchors, options = {}) {
  const specifier = typeof options.specifier === 'string' && options.specifier !== '' ? options.specifier : SCHEMASTER_SPECIFIER;
  const resolveFrom = typeof options.resolveFrom === 'function' ? options.resolveFrom : defaultResolveFrom;
  const attempts = [];
  let hit = null;
  for (const candidate of Array.isArray(anchors) ? anchors : []) {
    try {
      const resolvedPath = resolveFrom(candidate.anchor, specifier);
      const row = { name: candidate.name, anchor: candidate.anchor, ok: true, reason: null, resolvedPath: String(resolvedPath) };
      attempts.push(row);
      if (hit === null) hit = row;
    } catch (error) {
      attempts.push({ name: candidate.name, anchor: candidate.anchor, ok: false, reason: describeError(error), resolvedPath: null });
    }
  }
  return { attempts, hit };
}

/** 锚尝试 → 一行紧凑读数（进 stderr；真机 `grep 'settings 注册'` 一眼看出哪条命中/为什么全失败）。 */
export function describeSchemaAttempts(attempts) {
  const rows = Array.isArray(attempts) ? attempts : [];
  if (rows.length === 0) return '(无候选锚)';
  return rows
    .map((row) => `${row.name}${row.ok ? '✓' : '✗'}(${row.ok ? '命中' : row.reason ?? 'unknown'})`)
    .join(' ');
}

/**
 * 造本命名空间的 schema。
 * `layout` / `workbenchSwitch` 原样透传（见文件头最后一节：校验与迁移的唯一真源在客户端）；
 * `testWorkbench` 是**布尔门控**，缺省 `false` —— 于是「什么都没设」时客户端读到的就是明确的「关」。
 * @param {object} z schemastery 的默认导出
 */
export function createLayoutSchema(z) {
  return z.object({
    [LAYOUT_FIELD]: z.any(),
    [TEST_WORKBENCH_FIELD]: z.boolean().default(false),
    [SWITCH_STYLE_FIELD]: z.any(),
  });
}

/**
 * 定位 `settings` 服务（拿不到返回 `{service:null, source:'absent'}`；**不抛**）。
 *
 * 两级读法与 `routes.mjs` 的 `readConnection` 完全同形：
 *   ① `ctx.get('settings')` —— 替身/同 scope 场景下可见；
 *   ② **受保护**的 `ctx.settings` 属性读取 —— 声明式 `inject` 生效时服务就挂在本 ctx 上。
 * 服务是**兄弟插件提供的**：不声明 `inject` 就两级都看不见（这正是上面真机实证的根因形状）。
 * `source` 进读数（真机判读时能区分「两级都没看见」与「属性那级看见的」）。
 * @param {object} ctx 插件自己的 ctx
 * @returns {{service:object|null, source:'ctx.get'|'ctx.settings'|'absent'}}
 */
function locateSettings(ctx) {
  if (!isObject(ctx)) return { service: null, source: 'absent' };
  if (typeof ctx.get === 'function') {
    const soft = ctx.get('settings');
    if (isObject(soft)) return { service: soft, source: 'ctx.get' };
  }
  try {
    const direct = ctx.settings;
    if (isObject(direct)) return { service: direct, source: 'ctx.settings' };
  } catch {
    // 受保护读取：拿不到就按「缺席」处理（绝不把异常抛给 apply）
  }
  return { service: null, source: 'absent' };
}

/** 取 schemastery 的命名空间（`{default: z}` 与 `z` 两种形态都认；形状不对返回 `null`）。 */
function pickSchemaNamespace(module) {
  const z = isObject(module) && isObject(module.default) ? module.default : module;
  return isObject(z) && typeof z.object === 'function' && typeof z.any === 'function' ? z : null;
}

/**
 * 在**插件自己的 ctx** 上注册 `gui-frame` 命名空间（见文件头纪律①）。
 *
 * 返回形状（**绝不抛**，失败也返回一条可读诊断）：
 * `{ registered, reason, namespace, field, schema?, handle?, dispose?, effectLabel?,
 *    seq, at, anchorAttempts, schemaSource, settingsSource }`
 *   —— 后五项是**只读读数**（只增加可观测性，不改注册行为）。
 *
 * @param {object} ctx 插件自己的 ctx（**必须是插件 ctx**：注册的 fiber 归属由它决定）
 * @param {{importModule?:Function, settings?:object, anchors?:Array, resolveFrom?:Function,
 *   importUrl?:Function, baseUrl?:string, profileDir?:string, env?:object, argv?:string[],
 *   now?:Function}} [options]
 *   `importModule` / `resolveFrom` / `importUrl` 可注入（单测替身）；`settings` 可注入（跳过服务探测）
 * @returns {Promise<object>}
 */
export async function installSettingsNamespace(ctx, options = {}) {
  const seq = (installSeq += 1);
  const at = typeof options.now === 'function' ? String(options.now()) : new Date().toISOString();
  const anchorAttempts = [];
  let schemaSource = typeof options.importModule === 'function' ? { kind: 'injected', anchorName: null, resolvedPath: null } : null;
  const located = isObject(options.settings) ? { service: options.settings, source: 'injected' } : locateSettings(ctx);
  const settingsSource = located.source;
  /** 每条返回都带上读数（失败分支同样要能读出「为什么没成」）。 */
  const report = (extra) => ({
    registered: false,
    reason: null,
    namespace: LAYOUT_NAMESPACE,
    field: LAYOUT_FIELD,
    ...extra,
    seq,
    at,
    anchorAttempts,
    schemaSource,
    settingsSource,
  });

  if (!isObject(ctx) || typeof ctx.effect !== 'function') {
    return report({ reason: 'no-ctx-effect' });
  }
  const settings = located.service;
  if (settings === null) return report({ reason: 'settings-absent' });
  if (typeof settings.register !== 'function') return report({ reason: 'settings-invalid' });

  const importModule = typeof options.importModule === 'function' ? options.importModule : (specifier) => import(specifier);
  const importUrl = typeof options.importUrl === 'function' ? options.importUrl : (url) => import(url);
  let z = null;

  // ── ① 锚点解析：把包名解析成绝对路径，再 import 那个路径 ───────────────────────────────────
  //    注：`importModule` 被注入时（单测缝）**不做锚点解析**，行为与不注入时完全一致。
  if (typeof options.importModule !== 'function') {
    const anchors = Array.isArray(options.anchors) ? options.anchors : schemaAnchors(ctx, options);
    const probed = probeSchemaAnchors(anchors, { specifier: SCHEMASTER_SPECIFIER, resolveFrom: options.resolveFrom });
    for (const row of probed.attempts) anchorAttempts.push(row);
    if (probed.hit !== null) {
      const url = pathToFileURL(probed.hit.resolvedPath).href;
      schemaSource = { kind: 'anchor', anchorName: probed.hit.name, anchor: probed.hit.anchor, resolvedPath: probed.hit.resolvedPath, url };
      try {
        z = pickSchemaNamespace(await importUrl(url));
        if (z === null) schemaSource = { ...schemaSource, kind: 'anchor-invalid' };
      } catch (error) {
        schemaSource = { ...schemaSource, kind: 'anchor-import-failed', reason: describeError(error) };
      }
    }
  }

  // ── ② 最后一次兜底：裸 import(specifier)（**旧行为**，原样保留；真机上必失败＝上面那条锚全部没命中） ──
  if (z === null) {
    const bare = { name: 'bare-import', anchor: SCHEMASTER_SPECIFIER, ok: false, reason: null, resolvedPath: null };
    anchorAttempts.push(bare);
    try {
      const module = await importModule(SCHEMASTER_SPECIFIER);
      bare.ok = true;
      if (schemaSource === null) schemaSource = { kind: 'bare', anchorName: null, resolvedPath: null };
      z = pickSchemaNamespace(module);
    } catch (error) {
      bare.reason = describeError(error);
      return report({ reason: `schemastery-unavailable: ${String(error?.message ?? error)}` });
    }
  }
  if (z === null) return report({ reason: 'schemastery-invalid' });

  const schema = createLayoutSchema(z);
  // ★ 调用点就是**插件自己的 ctx** ⇒ `settings.register` 内部那条 effect 落在插件 fiber 上（纪律①）。
  let handle = null;
  try {
    handle = settings.register(LAYOUT_NAMESPACE, schema, { applies: SETTINGS_APPLIES });
  } catch (error) {
    return report({ reason: `register-failed: ${String(error?.message ?? error)}` });
  }
  // 再挂一条**本插件自己的**记账 effect：把「这次注册属于本插件」变成可机检的形状
  // （label 固定；卸载时清句柄）。真正的注销由 register 内部那条 fiber effect 完成（纪律①）。
  const dispose = ctx.effect(() => () => {
    handle = null;
    return undefined;
  }, SETTINGS_EFFECT_LABEL);
  return report({
    registered: true,
    reason: null,
    schema,
    handle,
    dispose,
    effectLabel: SETTINGS_EFFECT_LABEL,
  });
}
