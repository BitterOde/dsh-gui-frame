/**
 * index.mjs —— 能力④**主题守门**的装配入口：`install(ctx, env)`（探针 P4 实测标尺）。
 *
 * 与能力③同款形状：`service.__install('theme', api)`，**切片方法第一个参数恒为调用方 ctx**；
 * 所有副作用经 `ctx.effect(...)`（`service.__effect(...)` 是它的服务面等价物）挂在调用方 fiber 上。
 *
 * 切片提供的面（都在 `api` 上，逐个都被单测钉住）：
 *   `tokens / has / register / overrideTokens / dynamic / scheme / watch / lint / styles / coverage / scope`
 *
 * 三条纪律写在这里，免得下游猜：
 *  ① **第三方动态 token 只告警不拒绝**：`register` / `overrideTokens` 收到不在 403
 *     里的名字时**接受**它、把它记进动态集（此后不再算"未知"）、并发一条 `GUIF-W-THEME-DYNAMIC-TOKEN`；
 *  ② **暗色不要求全覆盖**：`coverage()` 是**报告**，196 覆盖 / 207 继承，`requireAll: false`；
 *  ③ **公开面不动**：本切片**不**往 `ctx.gui-frame` 上加 `theme` 取值器 —— 那会改冻结的公开面快照
 *     （`tests/contracts/public-surface.json`）。取用路径是 `service.__slice('theme')`
 *     （`__` 前缀属**内部面**，明确不进快照）。要把它升成公开成员 ⇒ 走快照流程，显式改快照。
 */

import { THEME_DIAGNOSTICS, diagnostic, createTokenContext, darkCoverage, lintTokenUsage } from './lint.mjs';
import { DARK_ATTRIBUTE, DARK_SELECTOR, currentScheme, watchScheme } from './dark.mjs';
import { createThemeScope } from './element.mjs';
import { SCOPE_VAR_MAP, baseStyleSheet, defineStyleSheet, installStyleSheet } from './styles.mjs';
import { FROZEN_DARK_TOKENS, FROZEN_TOKENS, PLATFORM_VARS, isFrozenToken, isPlatformVar } from './tokens.mjs';

/** 切片名（白名单成员）。 */
export const SLICE_NAME = 'theme';
/** 一次 lint 调用最多往诊断环里写几条（防止把环灌满）。 */
export const DIAGNOSTIC_BUDGET = 8;

/**
 * 装配主题守门。
 * @param {object} ctx 提供者 ctx
 * @param {{service:object, seeds?:object, theme?:object}} env
 * @returns {{slice:string, api:object, dispose:() => void, reused:boolean}}
 */
export function install(ctx, env) {
  if (env === null || env === undefined || env.service === null || env.service === undefined) {
    throw new TypeError('install(ctx, env) 需要 env.service（= ctx.gui-frame 服务面实例）');
  }
  const service = env.service;
  if (typeof service.__install !== 'function' || typeof service.__slice !== 'function') {
    throw new TypeError('install(ctx, env) 的 env.service 缺少 __install/__slice（不是本包服务面提供的实例）');
  }
  const existing = service.__slice(SLICE_NAME);
  if (existing !== undefined) {
    note(service, 'GUIF-W-SERVICE-CONFLICT', '主题守门切片已装配 ⇒ 本次让位（同一 service 二次 install 不得重复安装）');
    return { slice: SLICE_NAME, api: existing, dispose: noop, reused: true };
  }

  const state = { dynamic: new Set() };
  const context = () => createTokenContext({ dynamic: state.dynamic });

  /** 记一条诊断（进服务面诊断环 + logger；`__note` 自带限长与环容量）。 */
  const record = (code, message, details) => note(service, code, message, details);

  const api = {
    __slice: SLICE_NAME,
    /** 白名单副本（不可变语义：调用方改它不影响内部）。 */
    tokens() {
      return [...FROZEN_TOKENS];
    },
    /** 某个变量名认不认得（403 ∪ 平台变量 ∪ 动态登记）。 */
    has(callerCtx, name) {
      if (typeof name !== 'string') return false;
      return isFrozenToken(name) || isPlatformVar(name) || state.dynamic.has(name);
    },
    /**
     * **第三方登记新 token 名**（如自己主题扩展里的 `--dsw-…`）——只告警不拒绝。
     * @returns {() => void} 幂等 disposer（挂在**调用方** fiber 上：卸载即撤销登记）
     */
    register(callerCtx, names, options) {
      service.__assertCtx(callerCtx, 'theme.register');
      const list = Array.isArray(names) ? names : [names];
      const source = readSource(options);
      const added = [];
      for (const name of list) {
        assertVarName(name, 'theme.register');
        if (isFrozenToken(name) || isPlatformVar(name) || state.dynamic.has(name)) continue;
        added.push(name);
        record(
          THEME_DIAGNOSTICS.DYNAMIC_TOKEN,
          `${source} 登记动态 token ${name}：只告警不拒绝（它不在 403 白名单里，但登记后不再算未知）`,
          { name, source },
        );
      }
      return service.__effect(callerCtx, `gui-frame: theme register ${added.length}`, () => {
        for (const name of added) state.dynamic.add(name);
        return () => {
          for (const name of added) state.dynamic.delete(name);
        };
      });
    },
    /**
     * **第三方覆盖/补充 token 值**——未知名字同样只告警不拒绝。
     * @returns {{applied:Record<string,string>, warnings:Array<object>, dynamic:string[]}}
     */
    overrideTokens(callerCtx, tokens, options) {
      service.__assertCtx(callerCtx, 'theme.overrideTokens');
      if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
        throw new TypeError('theme.overrideTokens(ctx, tokens) 的 tokens 必须是 { "--name": value } 形式的对象');
      }
      const source = readSource(options);
      const applied = {};
      const warnings = [];
      const dynamicNames = [];
      for (const [name, value] of Object.entries(tokens)) {
        assertVarName(name, 'theme.overrideTokens');
        if (typeof value !== 'string' && typeof value !== 'number') {
          throw new TypeError(`theme.overrideTokens 的 ${name} 值必须是字符串或数字（收到 ${typeof value}）`);
        }
        applied[name] = String(value);
        if (isFrozenToken(name) || isPlatformVar(name) || state.dynamic.has(name)) continue;
        state.dynamic.add(name);
        dynamicNames.push(name);
        const warning = diagnostic(
          THEME_DIAGNOSTICS.DYNAMIC_TOKEN,
          `${source} 覆盖了未知 token ${name}：只告警不拒绝（已纳入解析上下文）`,
          { name, source },
        );
        warnings.push(warning);
        record(warning.code, warning.message, warning.details);
      }
      return { applied, warnings, dynamic: dynamicNames };
    },
    /** 已登记的动态 token 名（排序副本）。 */
    dynamic() {
      return [...state.dynamic].sort();
    },
    /**
     * 当前配色方案：**只认 `body[data-ds-dark-theme]`**（不认 theme id、不认 prefers-color-scheme）。
     * @param {object} [callerCtx]
     * @param {{document?:object|null}} [options]
     * @returns {'light'|'dark'}
     */
    scheme(callerCtx, options) {
      return currentScheme(options);
    },
    /** 监听方案变化（挂在调用方 fiber 上）。 */
    watch(callerCtx, listener, options) {
      service.__assertCtx(callerCtx, 'theme.watch');
      return watchScheme(callerCtx, listener, options ?? {});
    },
    /**
     * 告警式 lint（**永不抛、永不阻断**）：白名单 = 403；解析上下文 = 403 ∪ 24 平台变量 ∪ 动态名。
     * @returns {{ok:boolean, warnings:Array<object>, unknown:string[], dynamic:string[], literals:Array<object>,
     *   platformUsed:string[], stats:object}}
     */
    lint(callerCtx, text, options) {
      const opts = options ?? {};
      const report = lintTokenUsage(text, {
        context: createTokenContext({ dynamic: state.dynamic, platform: opts.platform !== false }),
        source: typeof opts.source === 'string' ? opts.source : 'theme.lint',
      });
      for (const warning of report.warnings.slice(0, DIAGNOSTIC_BUDGET)) record(warning.code, warning.message, warning.details);
      return report;
    },
    /** 拼一张只走 token/变量的样式表（硬编码颜色只告警，不抛）。 */
    styles(callerCtx, spec, options) {
      return defineStyleSheet(spec, {
        context: createTokenContext({ dynamic: state.dynamic }),
        source: options?.source ?? 'theme.styles',
      });
    },
    /** 组件基础样式文本（组件直接取用）。 */
    baseStyles() {
      return baseStyleSheet();
    },
    /** 注入样式表（挂在调用方 fiber 上；无 DOM ⇒ 静默空操作）。 */
    installStyles(callerCtx, options) {
      service.__assertCtx(callerCtx, 'theme.installStyles');
      return installStyleSheet(callerCtx, options ?? {});
    },
    /** 暗色覆盖**报告**（不是门禁：196 覆盖 / 207 继承，`requireAll:false`）。 */
    coverage() {
      return darkCoverage(state.dynamic);
    },
    /** 作用域组件（createElement 构造；**没有 JSX**）。 */
    scope() {
      return createThemeScope({ seeds: env.seeds });
    },
    /** 公开变量 → 外壳 token 的别名表（只读副本）。 */
    vars() {
      return { ...SCOPE_VAR_MAP };
    },
    /** 只读快照（诊断/单测用）。 */
    describe() {
      return {
        slice: SLICE_NAME,
        tokens: FROZEN_TOKENS.length,
        darkTokens: FROZEN_DARK_TOKENS.length,
        platformVars: PLATFORM_VARS.length,
        dynamic: state.dynamic.size,
        darkAttribute: DARK_ATTRIBUTE,
        darkSelector: DARK_SELECTOR,
      };
    },
    dispose() {
      state.dynamic.clear();
    },
  };

  const releaseSlice = ctx.effect(() => {
    const release = service.__install(SLICE_NAME, api);
    return () => {
      api.dispose();
      release();
    };
  }, 'gui-frame: theme slice');

  return {
    slice: SLICE_NAME,
    api,
    reused: false,
    dispose() {
      if (typeof releaseSlice === 'function') releaseSlice();
    },
  };
}

function readSource(options) {
  return options !== null && options !== undefined && typeof options.source === 'string' && options.source !== ''
    ? options.source
    : 'third-party';
}

function assertVarName(name, who) {
  if (typeof name !== 'string' || !/^--[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`${who} 的 token 名必须形如 --foo-bar（收到 ${typeof name} ${String(name)}）`);
  }
  return name;
}

function note(service, code, message, details) {
  if (typeof service.__note === 'function') return service.__note(code, message, details);
  return null;
}

function noop() {}
