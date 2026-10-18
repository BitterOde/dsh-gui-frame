/**
 * lib/client.js —— dsh-gui-frame 客户端半区产物（**由 scripts/build-client.mjs 生成，请勿手改**）。
 *
 * 形态（平台实测契约）：classic script（非 ESM），顶层唯一副作用 = 向
 * `window.__ModuleLoader__.load({ id, factory })` 注册 factory；模块体在 factory 内惰性物化。
 * 种子实例按 SEED_DECLARATIONS 注入（8 个，全名 require、**绝不打包**）；
 * 相对 import 支持有限深度（目录层数 ≤ 4，不得越出 src/client 根）。
 *
 * 源：src/client 下 50 个 .mjs（拓扑序）；入口 ./entry.mjs。
 */
window.__ModuleLoader__.load({
  id: "dsh-gui-frame",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // 种子实例按声明注入（SEED_DECLARATIONS）—— 外壳运行时提供，**绝不**打进 bundle：
    var react = require("react");
    var jsxRuntime = require("react/jsx-runtime");
    var reactDom = require("react-dom");
    var cordis = require("@deepseek-ai/cordis");
    var store = require("@deepseek-ai/dsh-client-store");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var slots = require("@deepseek-ai/dsh-client-ui-slots");
    var dockkit = require("@deepseek-ai/dsh-client-ui-dockkit");

    var __seeds = { react: react, jsxRuntime: jsxRuntime, reactDom: reactDom, cordis: cordis, store: store, primitives: primitives, slots: slots, dockkit: dockkit };

    var __esMod = {};

__esMod["./contracts/components.mjs"] = (function () {
/**
 * components.mjs —— 对外暴露的**复合组件清单**（接口已冻结）。
 *
 * 方向与边界：
 *  - 方向②（GUIFrame → 插件）：`ctx.guiFrame.components` 暴露 GUIFrame 用官方 primitives 实现的
 *    **复合组件**；插件拿到的是普通函数/组件，直接用**自己的** React 树里（同一个 React 单例，
 *    全程不需要模块 import，插件构建链不变）。
 *  - **只暴露复合组件**（Panel / Toolbar / Empty / ErrorState / List / KeyValue）——
 *    它们才是各插件重复造的那一层；**原子组件**（Button/Tooltip/Menu/Modal/Tag/Toast/
 *    HoverCard/StateDot/JsonTree …）由插件自己从 primitives 种子取用，GUIFrame **不**转发。
 *  - 方向①（插件 → GUIFrame）：插件经 `register(entry, Component)` 贡献**入口组件**；
 *    若插件想贡献**可复用组件**给别人，走 `service.components.register(name, Component)`
 *    —— 这两条路都在服务面上，但只有下面这六个名字属于 GUIFrame 的**公开面**（进快照）。
 *
 * 本文件**只冻结名字**（先冻接口再写实现）：
 * 实现、props 细节、样式与 token 都在组件实现里；实现方用同样的名字调
 * `components.register(name, Component)` 装上实现。**签名属于行为期契约**：
 * 「组件签名要作为稳定接口单独冻结」——故此处同时冻结各组件**必须接受的 props 名**，
 * 实现方只能加可选参数，不能改名/删名。
 *
 * 本文件**零副作用**：纯常量，无 React、无种子依赖（组件实现不在这里）。
 */

/**
 * 冻结的复合组件名（排序后即快照的 `components` 字段）。
 * ⚠ 顺序无意义（快照会排序），但**拼写是契约**。
 */
const COMPONENT_NAMES = Object.freeze(['Empty', 'ErrorState', 'KeyValue', 'List', 'Panel', 'Toolbar']);

/**
 * 每个组件的**必须接受的 props 名**（真值来自「props 由 GUIFrame 注入」能力面 +
 * 面板骨架的要求）。实现方可以**新增可选** props，但不得改名或删名 —— 删名 = 公开面变更。
 *
 * 约定（三个通用面，任何组件都可选接受）：
 *  - `theme`：只读主题镜像（`--dsw-*` 的解析结果；数据源是主题守门）
 *  - `t`：文案 thunk（跟随 locale；label 一律传 thunk）
 *  - `children`：内容槽（GUIFrame 只提供容器与行为，**不接管插件内容**）
 */
const COMPONENT_PROPS = Object.freeze({
  Panel: Object.freeze(['id', 'label', 'close', 'actions', 'children']),
  Toolbar: Object.freeze(['items', 'children']),
  Empty: Object.freeze(['title', 'description', 'action', 'children']),
  ErrorState: Object.freeze(['error', 'onRetry', 'children']),
  List: Object.freeze(['items', 'renderItem', 'empty', 'children']),
  KeyValue: Object.freeze(['entries', 'children']),
});

/** 组件是否属于冻结清单（自定义组件名不走快照，见文件头）。 */
function isFrozenComponentName(name) {
  return COMPONENT_NAMES.includes(name);
}
  return { COMPONENT_NAMES: COMPONENT_NAMES, COMPONENT_PROPS: COMPONENT_PROPS, isFrozenComponentName: isFrozenComponentName };
}());
__esMod["./contracts/errors.mjs"] = (function () {
/**
 * errors.mjs —— GUIFrame **错误码集合**：码名是公开面的一部分，一经发布不改。
 *
 * 为什么要单独一个文件：调用方按 `error.code` 分支，而不是去 match 错误文案 ——
 * 码名因此属于公开面。码表集中在这里，快照档
 * `tests/contracts/public-surface.json` 的 `errorCodes` 是它的**排序副本**；
 * 改一个码名 = 公开面变更 ⇒ 快照断言变红，必须显式改快照（不是禁止改，是不许**静默**改）。
 *
 * 两类码：
 *  - `GUIF-E-*`（抛出）：调用方写错 / 装配缺失 —— **可主动防御的错，绝不静默**；
 *  - `GUIF-W-*`（诊断）：只记录不阻断 —— 「越段只告警」「服务撞名主动让位」都在这一类。
 *
 * 三条纪律：
 *  ① **极值拒绝、越段告警**：`GUIF-E-Z-RANGE` 抛；`GUIF-W-Z-SEGMENT` 只记。
 *  ② **服务重名不让页面死**：`provideService` 先 `ctx.get` 探测、已存在则记
 *     `GUIF-W-SERVICE-CONFLICT` 并**主动让位**，绝不重复 `provide`（同 scope 重名 = 整页死）。
 *  ③ **能力缺席显式报**：某项能力的 `install` 没跑过就调它的方法 ⇒
 *     `GUIF-E-CAPABILITY-ABSENT`；不许静默 no-op（那会让调用方以为窗口开了）。
 *
 * 本文件**零副作用**：只定义常量与类，模块体在 factory 内物化时不碰 window / document。
 */

/** `error.name` 恒为该值；判型请用 `isGuiFrameError(err)` 或 `err.code`。 */
const GUI_FRAME_ERROR_NAME = 'GuiFrameError';

/**
 * 致命码（抛出）。每个码都必须**可达**——加码前先确认 `src/` 里有真实抛出点。
 */
const ERROR_CODES = Object.freeze([
  'GUIF-E-CTX-INVALID', // 调用方 ctx 不具备 Cordis 必备面（effect）—— 不许静默退化成「直接执行」
  'GUIF-E-ENTRY-INVALID', // register(entry, Component) 的 entry / Component 形状非法
  'GUIF-E-ENTRY-DUPLICATE', // entry.id 已在册（同一 id 不许注册两次）
  'GUIF-E-COMPONENT-INVALID', // components.register(name, Component) 参数非法
  'GUIF-E-COMPONENT-DUPLICATE', // 组件名已被占用
  'GUIF-E-CAPABILITY-ABSENT', // 该能力的分片未装配（对应 install(ctx, env) 未执行）
  'GUIF-E-SLICE-INVALID', // 装配切片返回了非法形状（装配期契约被破坏）
  'GUIF-E-Z-RANGE', // 层级号极值 / 非整数 ⇒ 一律拒绝，不退化为告警
  'GUIF-E-OVERLAY-SPEC', // overlay.open 的 spec / options 形状非法
  'GUIF-E-OVERLAY-ID', // 窗口 id 形态非法（合法但不存在的 id 走「返回 false」的幂等路径）
  'GUIF-E-LAYOUT-INVALID', // layout.replace / layout.subscribe 的入参不是校验过的 VersionedLayout
  'GUIF-E-CHANNEL-INVALID', // channel(method, params) 的 method 不是非空字符串
]);

/** 诊断码（只记录，不阻断）。 */
const WARNING_CODES = Object.freeze([
  'GUIF-W-SERVICE-CONFLICT', // 服务名 gui-frame 已被占用 ⇒ 记诊断并让位
  'GUIF-W-Z-SEGMENT', // 层级号落在托管号段之外 ⇒ 只告警，不阻断
  'GUIF-W-Z-RESERVED', // 撞家族旧表值（1/2/3/10/62/63/64/66/70）⇒ 只告警
  'GUIF-W-LAYOUT-CORRUPT', // migrate 收到损坏 / 不认识版本的载荷 ⇒ 返回默认布局并记诊断（不抛错）
  'GUIF-W-LISTENER-THREW', // 订阅者在通知里抛错 ⇒ 吞掉并记录，不阻断其余订阅者
  // ── 主题守门的四条诊断码 ─────────────────────────────────────────────────────────
  // 为什么要进**码表**而不是留在 theme/ 里：命名空间闸门对 `src/**` 全文扫 `GUIF-…` 码，
  // 要求它们 ⊆ 本文件冻结集合 —— 留在模块里的「私有码」会让该门禁变红。
  // 本文件头的规则是「不是禁止改，是不许**静默**改」，于是这里**显式入表**并同步快照
  // （`node scripts/public-surface.mjs --write`）。
  'GUIF-W-THEME-TOKEN-UNKNOWN', // 样式用到既不在 403 白名单、也不是平台变量、且未登记的 token 名 ⇒ 只告警
  'GUIF-W-THEME-DYNAMIC-TOKEN', // 第三方经 register / overrideTokens 登记的动态 token 名 ⇒ 只告警不拒绝
  'GUIF-W-THEME-LITERAL-COLOR', // 样式里出现硬编码颜色 ⇒ 只告警（本包源码由 `check:tokens` 硬拦）
  'GUIF-W-THEME-PRIVATE-LEAK', // 公开样式引用了 --guif-private-* 私有变量 ⇒ 只告警
]);

/** 全部码（排序后）—— 即快照档 `errorCodes` 字段的内容。 */
const ALL_CODES = Object.freeze([...ERROR_CODES, ...WARNING_CODES].sort());

/**
 * GUIFrame 的统一错误类型。**不用 `instanceof Error` 判型**（跨 bundle 实例会失配）——
 * 判型用 `isGuiFrameError`（查 `code` + 名字），或直接读 `error.code`。
 */
const GuiFrameError = class GuiFrameError extends Error {
  /**
   * @param {string} code 必须取自 `ERROR_CODES`（构造器不校验集合：码表在本文件定义，校验留在测试）
   * @param {string} message 面向人的说明（含「怎么办」，不要只写「非法参数」）
   * @param {object|null} [details] 结构化上下文（调用方 id / 实际值 / 期望值）
   */
  constructor(code, message, details) {
    super(message);
    this.name = GUI_FRAME_ERROR_NAME;
    this.code = code;
    this.details = details === undefined ? null : details;
  }
};

/** 造一个 `GuiFrameError`（内部与下游的统一起手式）。 */
function createError(code, message, details) {
  return new GuiFrameError(code, message, details);
}

/** 判型：只看 `code` 与 `name`，故跨 bundle 实例/跨 iframe 也能认。 */
function isGuiFrameError(value) {
  return Boolean(value) && typeof value === 'object' && value.name === GUI_FRAME_ERROR_NAME && typeof value.code === 'string';
}

/** 诊断条目的人读形式（终端/上报链路统一用它，避免各处手拼）。 */
function formatDiagnostic(diagnostic) {
  const code = diagnostic && typeof diagnostic.code === 'string' ? diagnostic.code : 'GUIF-W-UNKNOWN';
  const message = diagnostic && diagnostic.message ? String(diagnostic.message) : '';
  return `[gui-frame] ${code} ${message}`.trim();
}
  return { GUI_FRAME_ERROR_NAME: GUI_FRAME_ERROR_NAME, ERROR_CODES: ERROR_CODES, WARNING_CODES: WARNING_CODES, ALL_CODES: ALL_CODES, GuiFrameError: GuiFrameError, createError: createError, isGuiFrameError: isGuiFrameError, formatDiagnostic: formatDiagnostic };
}());
__esMod["./contracts/layers.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
/**
 * layers.mjs —— **GUIFrame 数字层级表**（接口已冻结）。
 *
 * 用户的裁定原话：「凭什么不写数字？就应当用数字表述层级最简洁！」⇒ 层级**用数字表述**，
 * 本文件是**唯一真源**。
 *
 * ═══ 号段表（同一容器内数值大者在上）═══
 *   ≤ 40            「在下」带：非托管浮层若要**落在托管浮层之下**用这里（含官方内容层 20）
 *   41 … 49         缝：既不在下带也不在托管段 ⇒ 只告警（`GUIF-W-Z-SEGMENT`）
 *   50 … 199        托管·浮动窗（floating）
 *   200 … 299       托管·**面板**（panel —— 贴边浮出的按钮面板；与浮动窗是**两个组件**）
 *   300 … 499       托管·Dialog（dialog）
 *   500 … 699       托管·Popover（popover）
 *   700 … 999       托管·Toast（toast）
 *   ≥ 1000          「盖住」带：非托管浮层若要**盖住托管浮层**用这里
 *
 * ⚠ `panel` 号段按用户裁定单列（**「面板」与「悬浮窗」是两个组件，
 *   不得混用**）—— 面板从按钮旁浮出、无拖动条、无缩放手柄、自带表面；浮动窗才是可拖可缩的窗口。
 *
 * ═══ 三条硬规则 ═══
 *  ① 不传 `z` 时由分配器**从 100 起单调自增**（100 落在 floating 段内，故缺省 = 浮动窗档）；
 *  ② **越段只告警不阻断**，并把实际值经 `data-guif-z` 暴露出来供真机断言；
 *  ③ **极值一律拒绝**：非整数 / 非有限数 / ≥ 2^31 / 极端负数 ⇒ 抛 `GUIF-E-Z-RANGE`
 *     （这是「可主动防御的错」，不退化为告警）。
 *
 * 另外两条从真源直接落下的约束：
 *  - 托管浮层**不复用**家族旧表的 `1/2/3/10/62/63/64/66/70`（TextManager 的 LAYER 表）——
 *    撞上只告警（`GUIF-W-Z-RESERVED`），因为那两个数是别人的存量语义，不是本表的锚点；
 *  - `data-guif-z` 是**属性名常量**（不是变量名），真机断言一律 `document.querySelector('[data-guif-z="100"]')` 这种写法。
 *
 * 本文件**零副作用**、纯函数，无 DOM、无种子依赖 —— L0 层可直接单测。
 */


/** 实际层号暴露给真机断言的属性名（浮层宿主必须把它挂在窗口根节点上）。 */
const DATA_GUIF_Z = 'data-guif-z';

/** 官方内容层基线：`.overlayLayer { z-index: 20 }`（实测 CSS）——本表的一切相对关系以它为参照。 */
const CONTENT_LAYER_Z = 20;

/** 托管号段的族名（顺序即优先级顺序，仅用于文档与校验；分配时不依赖顺序）。 */
const LAYER_FAMILIES = Object.freeze(['floating', 'panel', 'dialog', 'popover', 'toast']);

/** 托管号段表（闭区间）。 */
const LAYER_SEGMENTS = Object.freeze([
  Object.freeze({ family: 'floating', min: 50, max: 199 }),
  Object.freeze({ family: 'panel', min: 200, max: 299 }),
  Object.freeze({ family: 'dialog', min: 300, max: 499 }),
  Object.freeze({ family: 'popover', min: 500, max: 699 }),
  Object.freeze({ family: 'toast', min: 700, max: 999 }),
]);

/** 非托管「在下」带上界（≤ 40 落在托管浮层之下）。 */
const UNMANAGED_BELOW_MAX = 40;
/** 非托管「盖住」带下界（≥ 1000 盖住托管浮层）。 */
const UNMANAGED_ABOVE_MIN = 1000;
/** 不传 `z` 时的起始分配值（单调自增）。 */
const DEFAULT_Z_START = 100;
/** 可表示范围＝CSS `z-index` 的 32 位有符号整数域。 */
const Z_MIN = -2147483648;
const Z_MAX = 2147483647;
/** 家族旧表（TextManager `src/client/styles.mjs` 的 LAYER 表）——托管浮层不复用这些值，撞上只告警。 */
const RESERVED_LEGACY_Z = Object.freeze([1, 2, 3, 10, 62, 63, 64, 66, 70]);

/** 段名 → 段（不存在 ⇒ `undefined`）。 */
function segmentOf(family) {
  return LAYER_SEGMENTS.find((segment) => segment.family === family);
}

/**
 * 纯函数：把一个**整数**层号落到带名上（不做形态校验，校验走 `validateZ`）。
 * @returns {'below'|'gap'|'floating'|'dialog'|'popover'|'toast'|'above'}
 */
function zBand(z) {
  if (z <= UNMANAGED_BELOW_MAX) return 'below';
  if (z >= UNMANAGED_ABOVE_MIN) return 'above';
  for (const segment of LAYER_SEGMENTS) {
    if (z >= segment.min && z <= segment.max) return segment.family;
  }
  return 'gap';
}

/** 带名是否属于托管号段（`floating/dialog/popover/toast`）。 */
function isHostedBand(band) {
  return LAYER_FAMILIES.includes(band);
}

/**
 * 形态校验（「极值拒绝」就落在这里）。
 * @param {unknown} z
 * @returns {{ok:true, z:number}|{ok:false, code:string, message:string}}
 */
function validateZ(z) {
  if (typeof z !== 'number' || !Number.isFinite(z)) {
    return { ok: false, code: 'GUIF-E-Z-RANGE', message: `层级号必须是有限数字（收到 ${describeValue(z)}）` };
  }
  if (!Number.isInteger(z)) {
    return { ok: false, code: 'GUIF-E-Z-RANGE', message: `层级号必须是整数（收到 ${z}；CSS z-index 不接受小数）` };
  }
  if (z > Z_MAX || z < Z_MIN) {
    return {
      ok: false,
      code: 'GUIF-E-Z-RANGE',
      message: `层级号 ${z} 超出可表示范围 [${Z_MIN}, ${Z_MAX}]（极值一律拒绝，不退化为告警）`,
    };
  }
  return { ok: true, z };
}

/** 分配器自带告警环的容量（诊断用；`seen` 只保最近这么多条）。 */
const WARNING_RING_LIMIT = 32;

/**
 * 造一个层级分配器（一个服务实例一个，**跨调用方共享**，保证单调）。
 *
 * `allocate(family, requested)` 语义：
 *  - `requested` 给了：先过 `validateZ`，**不合格直接抛 `GUIF-E-Z-RANGE`**；合格则采用该值，
 *    但若它不在 `family` 的号段内 ⇒ 记 `GUIF-W-Z-SEGMENT` 告警（**不阻断**）；
 *    撞家族旧表值 ⇒ 记 `GUIF-W-Z-RESERVED` 告警。
 *  - `requested` 缺省：从 `start`（缺省 100）单调自增取号；越过本族号段上限也**只告警**。
 *
 * @param {{start?:number, onWarning?:(warning:{code:string,message:string,details:object|null})=>void}} [options]
 * @returns {{allocate:Function, current:Function, reset:Function, warnings:Function}}
 */
function createLayerAllocator(options = {}) {
  const start = Number.isInteger(options.start) ? options.start : DEFAULT_Z_START;
  const report = typeof options.onWarning === 'function' ? options.onWarning : null;
  let cursor = start;
  let seen = [];

  const note = (code, message, details) => {
    const warning = { code, message, details: details === undefined ? null : details };
    seen.push(warning);
    if (seen.length > WARNING_RING_LIMIT) seen.splice(0, seen.length - WARNING_RING_LIMIT);
    if (report !== null) report(warning);
    return warning;
  };

  return {
    allocate(family, requested) {
      const target = LAYER_FAMILIES.includes(family) ? family : 'floating';
      const segment = segmentOf(target);
      const warnings = [];
      const collect = (code, message, details) => {
        warnings.push(note(code, message, details));
      };
      if (requested !== undefined && requested !== null) {
        const checked = validateZ(requested);
        if (!checked.ok) throw createError(checked.code, checked.message, { family: target, z: requested });
        const band = zBand(requested);
        if (band !== target) {
          collect('GUIF-W-Z-SEGMENT', `层级号 ${requested} 落在「${band}」带，不属于 ${target} 号段 [${segment.min}, ${segment.max}]（越段只告警，不阻断）`, { family: target, z: requested, band });
        }
        if (RESERVED_LEGACY_Z.includes(requested)) {
          collect('GUIF-W-Z-RESERVED', `层级号 ${requested} 是家族旧表保留值（${RESERVED_LEGACY_Z.join('/')}），托管浮层不复用它们（只告警）`, { z: requested });
        }
        return { z: requested, family: target, band, allocated: false, warnings };
      }
      const z = cursor;
      cursor += 1;
      const band = zBand(z);
      if (band !== target) {
        collect('GUIF-W-Z-SEGMENT', `分配器自增取号越出 ${target} 号段 [${segment.min}, ${segment.max}]（当前 ${z}，只告警不阻断）`, { family: target, z, band });
      }
      return { z, family: target, band, allocated: true, warnings };
    },
    /** 下一个自增值（诊断/测试用，不消耗号）。 */
    current() {
      return cursor;
    },
    reset(value) {
      cursor = Number.isInteger(value) ? value : start;
      seen = [];
      return cursor;
    },
    /** 本分配器产生过的全部告警（诊断环，诊断上报链路可读）。 */
    warnings() {
      return [...seen];
    },
  };
}

/** 把层号转成可直接铺到 React 元素上的属性对象：`{ 'data-guif-z': '100' }`（真机断言锚点）。 */
function zDataAttribute(z) {
  return { [DATA_GUIF_Z]: String(z) };
}

/** 极简值描述（错误文案用；不 dump 整对象，避免把 live 数据打进日志）。 */
function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组(${value.length})`;
  return typeof value === 'object' ? '对象' : `${typeof value} ${String(value)}`;
}
  return { DATA_GUIF_Z: DATA_GUIF_Z, CONTENT_LAYER_Z: CONTENT_LAYER_Z, LAYER_FAMILIES: LAYER_FAMILIES, LAYER_SEGMENTS: LAYER_SEGMENTS, UNMANAGED_BELOW_MAX: UNMANAGED_BELOW_MAX, UNMANAGED_ABOVE_MIN: UNMANAGED_ABOVE_MIN, DEFAULT_Z_START: DEFAULT_Z_START, Z_MIN: Z_MIN, Z_MAX: Z_MAX, RESERVED_LEGACY_Z: RESERVED_LEGACY_Z, segmentOf: segmentOf, zBand: zBand, isHostedBand: isHostedBand, validateZ: validateZ, createLayerAllocator: createLayerAllocator, zDataAttribute: zDataAttribute };
}());
__esMod["./contracts/panel-ids.mjs"] = (function () {
/**
 * panel-ids.mjs —— **本包占用的 `main` key 词表**（L0 契约词汇表）。
 *
 * 为什么单独一个文件：这些 key 现在有**两个消费方**——能力①（坞）在**装配期**注册它们，
 * 能力「工作台开关」在**点击时**用其中一个去 `layout.selectPanel(...)`。两边都要拿到同一份字面量，
 * 而边界检查器规定**能力域之间不得互相 import**（dock ↛ workbench、workbench ↛ dock）⇒
 * 按依赖方向把它放到 L0 契约层：两边各自 import 契约（dock->contracts / workbench->contracts 都是白名单内的边）。
 *
 * ⚠ 与 `contracts/service-face.mjs` 分开：那一份是**公开面快照**（逐字节比对），加一个导出就会动它；
 * 本文件是包内词表，不进公开面。
 */

/**
 * **工作台那一格的 `main` key**。
 *
 * ⚠ 这一格**必须与坞入口那一格用不同的 key**：两者共用 `dsh-gui-frame/dock` 时，坞入口那一页
 * 永远「已经开着」⇒ 平台的 `selectPanel(同值)` 不产生状态变化 ⇒ 折回页不挂载
 * （用户看到的症状：点文字 = 留在管理页、点图标 = 浮出面板）。
 *
 * **注册时机**：由**坞在装配期**注册（与它自己那一格同一条路），**不许**等
 * workbench 装配时再「推 id 过来注册」——真机实测：晚注册那条路走完 `attach` 返回 true、
 * 日志无异常，但平台 `renderSlot('main', {}, { entryKey })` 查不到这一格 ⇒
 * **工作台打开后中心列空白**（页面总文本长度 2）。装配期注册则与坞自己那一格同源同序。
 */
const WORKBENCH_PANEL_ID = 'dsh-gui-frame/workbench';
  return { WORKBENCH_PANEL_ID: WORKBENCH_PANEL_ID };
}());
__esMod["./contracts/service-face.mjs"] = (function () {
/**
 * service-face.mjs —— `ctx.gui-frame` **服务面的数据真源**（接口已冻结）。
 *
 * 本文件只放**声明**（常量表），不放实现：实现见 `src/client/service.mjs`，
 * 而公开面快照档 `tests/contracts/public-surface.json` 就是这些表的**排序副本**。
 * 于是「声明」「实现」「快照」三者互锁：
 *   ① 实现改了成员名 ⇒ 单测比对 `SERVICE_METHODS/SERVICE_NAMESPACES/SERVICE_FIELDS` 变红；
 *   ② 声明改了成员名 ⇒ 快照逐字节比对变红；③ 快照改了 ⇒ 得有人显式改，不能静默漂移。
 *
 * ═══ 服务名 ═══
 * 固定 `gui-frame`（带命名空间前缀）——实测本机已有 15 个官方客户端服务
 * （theme / layout / uiRenderer / connection / locale / resources / modules / sessions / sidebarRight …），
 * 撞名在 Cordis 里是**同 scope 重名直接 throw**；本包的口径是「提供前先 `ctx.get` 探测，
 * 已存在就记诊断并主动让位」——所以探测/让位落在 `service.mjs` 的 `provideService(ctx)`。
 *
 * ═══ 对外方法必须是原型方法（硬约束）═══
 * 证据是官方 `dsh-client-ui-renderer` 的 `registry.d.ts`（本机 0.2.0-rc.2 原文）：
 *   「Declared here, implemented by prototype assignment below the class: it MUST stay a prototype
 *    method (never an instance arrow) — the cordis service proxy binds `this.ctx` to the CALLER's
 *    context at call time, which is what routes the effect (and the unload cascade) into the
 *    caller's fiber. An arrow property would freeze `this` to the service's own root ctx and
 *    silently break per-plugin disposal.」
 * ⇒ `register / supports` 是**原型方法**；`components / dock / overlay` 是**原型取值器**
 *   （getter 也走调用点绑定，读 `this.ctx` 得到的是调用方 ctx —— 这样嵌套命名空间里的方法
 *   才能把副作用挂到调用方 fiber；若在构造器里 `this.overlay = {...}`，嵌套方法拿到的会是
 *   服务自己的 root ctx，正是官方原文警告的那个静默失效）。
 *
 * 本文件**零副作用**：纯常量表，无 DOM、无种子依赖。
 */

/** 服务名（固定；`cordis.patch.yml` 的 loader id 与本文件同名，但两者是不同层面的东西）。 */
const SERVICE_NAME = 'gui-frame';

/** 服务面版本：**公开面**的一部分（服务要有 version 字段）；改它要同步快照。 */
const SERVICE_VERSION = '1.0.0';

/** 原型**方法**（数据属性值必须是函数；绝不允许出现在实例自有的函数属性上 —— 见文件头）。 */
const SERVICE_METHODS = Object.freeze(['register', 'supports']);

/**
 * 原型**取值器**（命名空间：`service.overlay.open(...)` 这一层）。
 * ★ `dock` 是后加的（用户裁定「开放一个 API」）：按钮面板从此有公开入口 ——
 *   `service.dock.open()/close()/isOpen()`。加它之前公开面宣告 `supports('dock') === true`
 *   却没有任何入口（README 的契约缺口那一节自己记着这件事）。
 *   开口子的代价写死在这里：要动冻结的公开面快照、逐字节读数与冻结评审。
 */
const SERVICE_NAMESPACES = Object.freeze(['components', 'dock', 'overlay']);

/** 实例**数据字段**（非函数；快照里的 `serviceMembers` 也包含它们）。 */
const SERVICE_FIELDS = Object.freeze(['capabilities', 'version']);

/** 公开面成员全集（排序后即快照的 `serviceMembers`）。 */
const SERVICE_MEMBERS = Object.freeze([...SERVICE_METHODS, ...SERVICE_NAMESPACES, ...SERVICE_FIELDS].sort());

/**
 * 命名空间**内部的成员**（`overlay.open/close/bringToFront` 等）。
 * 它们不被公开面快照列为字段（快照冻结的是**服务成员**这一层），但同样是公开契约：
 * `tests/unit/service.test.mjs` 用本表把「声明 ↔ 实现」锁住（多一个 / 少一个都变红）。
 */
const NAMESPACE_MEMBERS = Object.freeze({
  components: Object.freeze(['get', 'has', 'names', 'props', 'register']),
  dock: Object.freeze(['close', 'isOpen', 'open']),
  overlay: Object.freeze(['bringToFront', 'close', 'open']),
});

/**
 * 服务实例上的**载体字段**（Cordis 惯例，不是 GUIFrame 的 API 成员，故**不进快照**）：
 * `service.ctx` 是「调用方 ctx」的载体 —— cordis 服务代理在**调用点**改写它（见文件头）。
 * 这里显式登记它，是为了让单测能区分「契约成员」与「载体」：后者被改名时由调用方-fiber 绑定用例抓。
 */
const SERVICE_CARRIER_FIELDS = Object.freeze(['ctx']);

/**
 * 对外承诺的能力集：坞（入口注册与座位）、面板骨架、浮层（含按钮面板的托管浮层）。
 * 名称与 `src/client/` 的能力目录一一对应（分层建议）。
 * 主题守门有切片、不对外起名，故不在这张表里 —— 判据见 `tests/verify-surface/public-surface.test.mjs`。
 */
const CAPABILITIES = Object.freeze(['dock', 'overlay', 'panel']);

/**
 * 能力 → 装配切片名（`service.supports(name)` 用它判断「当前真的可用」）：
 *  - `null` ⇒ 服务面自带内存态，无需切片；
 *  - 否则 ⇒ 必须由对应模块的 `install(ctx, env)` 装入切片后 `supports` 才为 true。
 *  `theme` 有切片但没有对外命名空间（主题守门不是能力集里的一项，见 `CAPABILITIES` 的注）。
 */
const CAPABILITY_SLICES = Object.freeze({
  dock: 'dock',
  panel: 'dock', // 面板骨架挂在坞的成对注册上（panellist + main 成对）
  overlay: 'overlay',
  theme: 'theme',
});

/** 允许装配的切片名全集（`service.__install(name, api)` 的白名单；多一个都算契约外）。 */
const SLICE_NAMES = Object.freeze(['dock', 'overlay', 'theme']);

/**
 * 本包**收取的 slot 键**：`sidebar.panellist`（侧栏中部图标行）+ `main`（主区面板）——
 * 坞必须**成对**注册这两个，两者 `id`/`key` 同值。
 * 快照里冻结它，是为了拦住「多注册一个座位 / 换一个座位」这类静默漂移。
 */
const CONSUMED_SLOT_KEYS = Object.freeze(['main', 'sidebar.panellist']);

/**
 * 本包**查询的平台服务名**（快照字段名是 `inject`，但语义要说清）：
 * 这三项一律经 `ctx.get(name)` **软探测**取用，**不用 Cordis 的 `inject` 声明** ——
 * 口径已定：客户端 `inject` 缺服务会让 fiber 悬置、外壳 `assertEntriesActive` 直接抛错
 * 打死整页；GUIFrame 的接入口径是「依赖缺失就不激活」（唯一默认写法 `if (!ctx.get('gui-frame')) return;`）。
 *  - `slots`：座位注册
 *  - `settingsScope`：设置命名空间 `gui-frame`（宿主半区注册；本版的服务面成员一个都不读它）
 *  - `connection`：宿主路由的注册通道（诊断与 ping 走它）
 */
const PLATFORM_SERVICE_KEYS = Object.freeze(['connection', 'settingsScope', 'slots']);

/** entry.id 的形态（**必须带命名空间前缀**，绝不占保留 key）。 */
const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;
/** entry.id / key 的保留字（`conversation` 是外壳保留 key，占用会顶掉会话界面）。 */
const RESERVED_ENTRY_IDS = Object.freeze(['conversation']);
/** entry.id 长度上限（防御性，避免超长 DOM 属性/日志）。 */
const ENTRY_ID_MAX_LENGTH = 128;
/** entry 的两种形态（混合策略：面板型走 panellist，动作型在坞内展开）。 */
const ENTRY_KINDS = Object.freeze(['panel', 'action']);
/** 本包自己的 id 前缀（本包自带入口用；第三方插件用各自的包名前缀）。 */
const OWN_ID_PREFIX = 'dsh-gui-frame/';
  return { SERVICE_NAME: SERVICE_NAME, SERVICE_VERSION: SERVICE_VERSION, SERVICE_METHODS: SERVICE_METHODS, SERVICE_NAMESPACES: SERVICE_NAMESPACES, SERVICE_FIELDS: SERVICE_FIELDS, SERVICE_MEMBERS: SERVICE_MEMBERS, NAMESPACE_MEMBERS: NAMESPACE_MEMBERS, SERVICE_CARRIER_FIELDS: SERVICE_CARRIER_FIELDS, CAPABILITIES: CAPABILITIES, CAPABILITY_SLICES: CAPABILITY_SLICES, SLICE_NAMES: SLICE_NAMES, CONSUMED_SLOT_KEYS: CONSUMED_SLOT_KEYS, PLATFORM_SERVICE_KEYS: PLATFORM_SERVICE_KEYS, ENTRY_ID_PATTERN: ENTRY_ID_PATTERN, RESERVED_ENTRY_IDS: RESERVED_ENTRY_IDS, ENTRY_ID_MAX_LENGTH: ENTRY_ID_MAX_LENGTH, ENTRY_KINDS: ENTRY_KINDS, OWN_ID_PREFIX: OWN_ID_PREFIX };
}());
__esMod["./kit/diagnostics.mjs"] = (function () {
/**
 * diagnostics.mjs（kit）—— **诊断的纯件层**（「能力 → 共享叶」那一层）。
 *
 * 为什么下沉：demo 是**消费者**，它需要的只是「降级事件的形状」「渲染错误的上报形状」与两个常量；
 * 这些是纯工厂/常量，留在装配层的 `diagnostics.mjs` 里会让 demo 直连装配层（装配层不许被 demo 直连）。
 * 上报器实例本身仍由装配点经 `env.diagnostics` 交进来（六键之一：全流程唯一实例）。
 *
 * 本文件**零副作用**：纯函数与常量，不碰 ctx / service / DOM。
 */
const DIAGNOSTICS_PATH = '/api/gui-frame/diagnostics';
/** 官方信封里的 `method`＝端点名（`/api/` 之后那段）。 */
const DIAGNOSTICS_METHOD = 'gui-frame/diagnostics';
/** 官方信封的两种 type（与平台 `dsh-client-connection` 的实读值一致）。 */
const CLIENT_REQUEST_TYPE = 'client-request';
/** 插件名（宿主与 demo 都用它做归属）。 */
const PLUGIN_NAME = 'dsh-gui-frame';
/**
 * 客户端版本（**与 package.json 的 version 同值**，由 `tests/unit/diagnostics-client.test.mjs` 断言）。
 * 客户端产物在 factory 里物化，读不到 package.json，所以这里只能是常量 —— 那条断言就是防它漂移的。
 * ★ v1.0 对外发布：清单 `version` 与它必须**同值** —— 改的是版本字面量，不是逻辑
 *   （产物由 `npm run build` 重生成，`CLIENT_VERSION` 也是诊断行里那句
 *   `v<版本>` 的取值来源）。两处不同值会让 `npm test` 里那条同值断言直接判红。
 */
const CLIENT_VERSION = '1.0.0';

/** 诊断阶段（调用方按它分支；也是指纹的组成部分）。 */
const DIAGNOSTIC_PHASES = Object.freeze(['apply', 'install', 'slot', 'render', 'degrade', 'unhandled', 'transport']);

/** 四个上界（全部可在 `createDiagnosticsReporter` 的 options 里覆盖，便于单测把边界跑到）。 */
const DIAGNOSTIC_LIMITS = Object.freeze({
  message: 400,
  stack: 800,
  maxPerWindow: 20,
  windowMs: 60000,
  maxQueue: 32,
});

/** 把任意值收敛成一行可上报的消息（**绝不让诊断本身抛错**）。 */
function describeError(error) {
  if (error === null || error === undefined) return '未知错误（null/undefined）';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
  try {
    return String(error);
  } catch {
    return '无法字符串化的错误';
  }
}

/** 截断（保留头部；`\n` 折成 `\n    ` 之外不动，栈摘要要能看出调用链的前几层）。 */
function truncate(value, limit) {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
}

/** **栈摘要**：只留前 `maxLines` 行、总长 ≤ 800 —— 认得出「哪一层炸的」就够了，不搬整条栈。 */
function summarizeStack(error, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DIAGNOSTIC_LIMITS.stack;
  const maxLines = Number.isInteger(options.maxLines) && options.maxLines > 0 ? options.maxLines : 8;
  const raw = error !== null && error !== undefined && typeof error === 'object' && typeof error.stack === 'string' ? error.stack : '';
  if (raw === '') return { stack: '', lines: 0, truncated: false };
  const lines = raw.split('\n').slice(0, maxLines);
  const clipped = truncate(lines.join('\n'), limit);
  return { stack: clipped.text, lines: lines.length, truncated: clipped.truncated || raw.split('\n').length > maxLines };
}

/** 指纹：`plugin|phase|message`（**不含时间戳** —— 否则每次都不同，去重就废了）。 */
function fingerprintOf(entry) {
  const phase = typeof entry.phase === 'string' ? entry.phase : 'unknown';
  const message = typeof entry.message === 'string' ? entry.message : '';
  const plugin = typeof entry.plugin === 'string' && entry.plugin !== '' ? entry.plugin : PLUGIN_NAME;
  return `${plugin}|${phase}|${message}`;
}

/** 轻量稳定哈希（FNV-1a 32 位；只用于日志/去重键，不做安全用途）。 */
function hashFingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 把一条**能力降级**事件记成标准形状（entry/demo 共用，避免两处各写一遍）。 */
function degradeEvent(capability, reason, reporter) {
  const entry = {
    phase: 'degrade',
    message: `能力「${String(capability)}」未装配：${String(reason ?? 'unknown')}（页面照常启动）`,
    details: { capability, reason: reason ?? null },
  };
  if (reporter === undefined || reporter === null || typeof reporter.report !== 'function') return entry;
  reporter.report(entry);
  return entry;
}

/** 供**组件**在自己 catch 时调用（`panel` 的 Boundary onError 就用它）。 */
function renderErrorReport(reporter, error, details) {
  if (reporter === undefined || reporter === null || typeof reporter.report !== 'function') return null;
  return reporter.report({ phase: 'render', message: `渲染失败：${describeError(error)}`, error, details });
}
  return { DIAGNOSTICS_PATH: DIAGNOSTICS_PATH, DIAGNOSTICS_METHOD: DIAGNOSTICS_METHOD, CLIENT_REQUEST_TYPE: CLIENT_REQUEST_TYPE, PLUGIN_NAME: PLUGIN_NAME, CLIENT_VERSION: CLIENT_VERSION, DIAGNOSTIC_PHASES: DIAGNOSTIC_PHASES, DIAGNOSTIC_LIMITS: DIAGNOSTIC_LIMITS, describeError: describeError, truncate: truncate, summarizeStack: summarizeStack, fingerprintOf: fingerprintOf, hashFingerprint: hashFingerprint, degradeEvent: degradeEvent, renderErrorReport: renderErrorReport };
}());
__esMod["./diagnostics.mjs"] = (function () {
  var { CLIENT_REQUEST_TYPE: _CLIENT_REQUEST_TYPE, CLIENT_VERSION: _CLIENT_VERSION, DIAGNOSTIC_LIMITS: _DIAGNOSTIC_LIMITS, DIAGNOSTIC_PHASES: _DIAGNOSTIC_PHASES, DIAGNOSTICS_METHOD: _DIAGNOSTICS_METHOD, DIAGNOSTICS_PATH: _DIAGNOSTICS_PATH, PLUGIN_NAME: _PLUGIN_NAME, degradeEvent: _degradeEvent, describeError: _describeError, fingerprintOf: _fingerprintOf, hashFingerprint: _hashFingerprint, renderErrorReport: _renderErrorReport, summarizeStack: _summarizeStack, truncate: _truncate } = __esMod["./kit/diagnostics.mjs"];
/**
 * diagnostics.mjs —— **客户端诊断上报链路**（客户端半边；宿主收端在 `src/host/index.mjs`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么是"同源 fetch 直发"而不是走服务面】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 诊断通道要能报告**服务面自己坏掉**的情况（apply 抛错、座位注册失败、渲染崩溃）。
 * 若上报本身依赖 `ctx.gui-frame` 或 `ctx.connection`，那"服务面死了"这类最该被看见的事故
 * 恰好会在最需要它的时候失去通道。所以本文件只依赖全局 `fetch`：
 *   - **同源相对路径** `POST /api/gui-frame/diagnostics`（不带 origin，浏览器自动补同源）；
 *   - 请求体仍用**平台自己的信封形状**（`{type:'client-request', rpcId, method, payload}`），
 *     于是宿主侧 `ctx.connection.fetch.register` 的 handler 一字不改就能收（不改注册方式）；
 *   - `credentials:'same-origin'`（默认值，显式写出来）：`/api` 的 trust/auth 由**载体**施加，
 *     本文件不读 cookie、不造 token、不碰 401 —— 出现这些字样就是走错了路。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【四道限流闸】—— 诊断通道自己必须是"不会把宿主打垮"的那条通道
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ① **限长**：`message` ≤ 400 字符、`stack` ≤ 800 字符（都是**截断**而非丢弃，并记 `truncated` 计数）；
 *  ② **限频**：滚动窗口 `windowMs` 内最多 `maxPerWindow` 条（超出 ⇒ 丢弃 + `limited` 计数）；
 *  ③ **同指纹去重**：`plugin|phase|message` 的指纹在窗口内只发一次（`deduped` 计数）；
 *  ④ **队列封顶**：待发队列 ≤ `maxQueue`（超出即丢最旧的）。
 * 宿主侧还有第二层（app 级：指纹去重 + 总条数封顶 + 打印封顶），两层都做是因为客户端可能被整页刷爆。
 *
 * 本文件不碰 DOM：`fetch` / `now` / `window` 全部可注入（缺省才回落到全局），
 * 于是限频与钩子行为都能在 L0 层确定性单测。
 */



/* ── 纯件已下沉 `kit/diagnostics.mjs`（能力 → 共享叶）；下面这组 re-bind 保持
   本文件对外导出集合一字不变（tests 与宿主半区仍按老路径取名字）。 ───────────────────────────── */
const DIAGNOSTICS_PATH = _DIAGNOSTICS_PATH;
const DIAGNOSTICS_METHOD = _DIAGNOSTICS_METHOD;
const CLIENT_REQUEST_TYPE = _CLIENT_REQUEST_TYPE;
const PLUGIN_NAME = _PLUGIN_NAME;
const CLIENT_VERSION = _CLIENT_VERSION;
const DIAGNOSTIC_PHASES = _DIAGNOSTIC_PHASES;
const DIAGNOSTIC_LIMITS = _DIAGNOSTIC_LIMITS;
const describeError = _describeError;
const truncate = _truncate;
const summarizeStack = _summarizeStack;
const fingerprintOf = _fingerprintOf;
const hashFingerprint = _hashFingerprint;
const degradeEvent = _degradeEvent;
const renderErrorReport = _renderErrorReport;

/** 造**官方形状**的请求体（宿主 handler 直接认它）。 */
function createDiagnosticsEnvelope(payload, rpcId) {
  return {
    type: CLIENT_REQUEST_TYPE,
    rpcId: typeof rpcId === 'string' && rpcId !== '' ? rpcId : 'diag-0',
    method: DIAGNOSTICS_METHOD,
    payload,
  };
}

/**
 * 上报器。
 * @param {{fetchImpl?:Function, now?:Function, path?:string, plugin?:string, clientVersion?:string,
 *   limits?:object, consoleImpl?:object}} [options]
 * @returns {{report:Function, stats:Function, flush:Function, lastPayload:Function, entries:Function}}
 */
function createDiagnosticsReporter(options = {}) {
  const limits = { ...DIAGNOSTIC_LIMITS, ...(options.limits ?? {}) };
  const plugin = typeof options.plugin === 'string' && options.plugin !== '' ? options.plugin : PLUGIN_NAME;
  const clientVersion = typeof options.clientVersion === 'string' && options.clientVersion !== '' ? options.clientVersion : CLIENT_VERSION;
  const path = typeof options.path === 'string' && options.path !== '' ? options.path : DIAGNOSTICS_PATH;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  // `fetchImpl` 允许显式传 `null` 表示「这个环境没有 fetch」（`?? 全局` 会把 null 也当没传，
  // 于是"显式关掉"就没了出口 —— 用 in 判断，把"没传"和"传了 null"分开）。
  const fetchImpl = 'fetchImpl' in options ? options.fetchImpl : (typeof fetch === 'undefined' ? undefined : fetch);

  const seen = new Map(); // fingerprint → 首次时间（窗口内去重）
  /** 上报失败原因去重（每个 reason 只在 console 上说一次）。 */
  const reportedFailures = new Map();
  const queue = [];
  const sent = [];
  const stats = { reported: 0, sent: 0, deduped: 0, limited: 0, truncated: 0, dropped: 0, failed: 0 };
  let seq = 0;

  /** 把一条事件收敛成**载荷**（限长 + 指纹 + 时间戳）。 */
  function buildPayload(entry) {
    const message = truncate(entry.message, limits.message);
    const stack = summarizeStack(entry.error, { limit: limits.stack });
    if (message.truncated || stack.truncated) stats.truncated += 1;
    const payload = {
      plugin,
      phase: DIAGNOSTIC_PHASES.includes(entry.phase) ? entry.phase : 'apply',
      message: message.text,
      stack: stack.stack,
      clientVersion,
      at: new Date(now()).toISOString(),
    };
    if (entry.details !== undefined && entry.details !== null) payload.details = entry.details;
    payload.fingerprint = hashFingerprint(fingerprintOf({ plugin, phase: payload.phase, message: payload.message }));
    return payload;
  }

  /** 同步记一条诊断（**永不抛**）；返回 `{accepted, reason}`，调用方可据此断言"被限流"。 */
  function report(entry) {
    try {
      stats.reported += 1;
      const source = entry === null || entry === undefined ? {} : entry;
      const payload = buildPayload(source);
      const key = fingerprintOf({ plugin, phase: payload.phase, message: payload.message });
      const stamp = now();
      const last = seen.get(key);
      if (last !== undefined && stamp - last < limits.windowMs) {
        stats.deduped += 1;
        return { accepted: false, reason: 'dedup', payload };
      }
      seen.set(key, stamp);
      // 清理过期指纹（防长期运行把 Map 撑大）
      for (const [seenKey, seenAt] of seen) if (stamp - seenAt >= limits.windowMs) seen.delete(seenKey);
      const recent = sent.filter((row) => stamp - row.at < limits.windowMs);
      if (recent.length >= limits.maxPerWindow) {
        stats.limited += 1;
        return { accepted: false, reason: 'rate-limit', payload };
      }
      if (queue.length >= limits.maxQueue) {
        queue.shift();
        stats.dropped += 1;
      }
      queue.push({ payload, rpcId: `${plugin}-diag-${seq += 1}`, at: stamp });
      sent.push({ at: stamp });
      if (sent.length > limits.maxPerWindow * 4) sent.splice(0, sent.length - limits.maxPerWindow);
      return { accepted: true, reason: null, payload };
    } catch (error) {
      stats.failed += 1;
      return { accepted: false, reason: 'reporter-threw', error };
    }
  }

  /**
   * **上报失败必须可见**：`report()` 返回的 `accepted` 只代表「排上了本地队列」，
   * 真正的发送在 `flush()`。端点 404 / 网络失败以前被完全丢弃 ⇒ 界面说「sent」而宿主什么都没收到。
   * 处置：失败计数（已有）＋ **console 一行**（去重，每个 reason 只打一次，避免把 console 刷爆）。
   */
  function noteFailure(reason, extra) {
    stats.failed += 1;
    const key = String(reason);
    if (reportedFailures.has(key)) return;
    reportedFailures.set(key, 1);
    try {
      if (typeof console !== 'undefined' && console !== null && typeof console.warn === 'function') {
        console.warn(`[gui-frame] 诊断上报失败：${key}${extra === undefined ? '' : `（${extra}）`} —— 上报地址 ${path}`);
      }
    } catch {
      // console 不可用就算了（计数仍在 stats.failed 上）
    }
  }

  /** 发一条（内部）：把队列里的载荷逐个 POST 出去；失败**只计数不抛**（但一定可见）。 */
  async function sendOne(item) {
    if (fetchImpl === undefined || typeof fetchImpl !== 'function') {
      noteFailure('no-fetch', '当前环境没有 fetch');
      return { ok: false, reason: 'no-fetch' };
    }
    try {
      const envelope = createDiagnosticsEnvelope(item.payload, item.rpcId);
      const response = await fetchImpl(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(envelope),
      });
      if (response !== null && response !== undefined && typeof response.ok === 'boolean' && response.ok === false) {
        noteFailure(`http-${response.status}`, '端点未注册或被拒');
        return { ok: false, reason: `http-${response.status}` };
      }
      stats.sent += 1;
      return { ok: true, reason: null };
    } catch (error) {
      noteFailure(describeError(error), '请求抛错');
      return { ok: false, reason: describeError(error) };
    }
  }

  /** 把队列刷出去（**不抛**；返回每条的结果）。 */
  async function flush() {
    const pending = queue.splice(0, queue.length);
    const results = [];
    for (const item of pending) results.push(await sendOne(item));
    return results;
  }

  return {
    report,
    flush,
    stats: () => ({ ...stats, queued: queue.length, fingerprints: seen.size }),
    lastPayload: () => (queue.length === 0 ? null : queue[queue.length - 1].payload),
    entries: () => queue.map((item) => ({ ...item.payload })),
    /**
     * 一条式便捷入口：`report + flush`（各装配点的常用形状）。
     * ⚠ **把 flush 的结果一并交出去**（`{...outcome, flush}`）—— 以前返回值只有队列 accepted，
     * 端点 404 这类硬失败在调用方那里彻底消失（「界面说 sent ≠ 宿主收到」）。
     */
    async reportNow(entry) {
      const outcome = report(entry);
      if (outcome.accepted === true) {
        const results = await flush();
        return { ...outcome, flush: results, delivered: results.every((row) => row.ok === true) };
      }
      return { ...outcome, flush: [], delivered: false };
    },
  };
}

/**
 * 装**客户端诊断钩子**（来源两条 + 一条显式入口，全部经 `ctx.effect` 挂在调用方 fiber 上）：
 *  ① **渲染崩溃**：`window` 的 `error` / `unhandledrejection`（逃出 React 边界的那种）；
 *  ② **边界内崩溃**：由组件把错误交给 `report`（`phase:'render'`；面板壳的错误边界就是这么报的）。
 *
 * ═══ 为什么**不再**包一层平台的共享 `ctx.slots.register/inject`（用户裁定：不许改写共享服务）═══
 * 旧版把包装后的函数**写回共享 slots 服务**（`slots[method] = wrapped`）。它确实能多看见一类来源
 * （别的插件在**注册期同步抛**的错），但代价是踩在平台的书面契约上，而且已经出过一次生产事故：
 *   · 平台契约（`dsh-client-ui-renderer/lib/types/client/registry.d.ts` 原文）：`register` **必须**
 *     留在原型上 —— cordis 服务代理在**调用点**把 `this.ctx` 绑到调用方 ctx，effect 才落进调用方的
 *     fiber。往共享对象上写自有属性会打断这条归属链 ⇒ 别人经它注册的座位，effect 归到本包 fiber 上，
 *     本包卸载 / HMR 时可能**连带拆除别人的贡献**；平台自己的示范是 **Proxy 包一层自己的引用**，
 *     而不是改写共享对象。
 *   · 事故：同一处钩子曾把 `register/inject` 的返回值（有身份的 effect 句柄）换成
 *     `.then()` 派生的新 Promise ⇒ cordis 抛 `Invalid effect` ⇒ 同批 combo 的下一位插件 apply 失败
 *     ⇒ 外壳 `assertEntriesActive` 全或无闸把**整页**打成 `Failed to load plugins`。
 * ⇒ **裁定：撤掉这一类诊断源**。本包自己的诊断（渲染崩溃 / 未处理拒绝 / 组件显式 `report`）不受影响，
 *   客户端 → 宿主链路也不依赖它（那条链路只走 `report()` → POST → 宿主 sink → stderr）。
 *   代价如实记账：**不再拦截其它插件注册期的同步抛错**。若日后确实需要这一覆盖，正确的方向是
 *   「包自己的引用（Proxy）+ 把调用方 ctx 透传」，而不是改写共享服务 —— 另立条目再议。
 *
 * `options.slots` 仍然收下（调用方按老签名传），但**只读不用**：绝不写任何自有属性。
 *
 * 缺 `window`（无 DOM 环境）⇒ 静默跳过全局监听，**不报错**。
 * @param {object} ctx Cordis ctx
 * @param {object} reporter `createDiagnosticsReporter(...)`
 * @param {{window?:object, slots?:object}} [options]
 * @returns {() => void} 幂等 disposer
 */
function installDiagnosticsHooks(ctx, reporter, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('installDiagnosticsHooks(ctx, reporter) 需要在 Cordis ctx 上调用（清理要挂到调用方 fiber）');
  }
  if (reporter === null || typeof reporter !== 'object' || typeof reporter.report !== 'function') {
    throw new TypeError('installDiagnosticsHooks(ctx, reporter) 需要 reporter.report');
  }
  const win = 'window' in options ? options.window : (typeof window === 'undefined' ? undefined : window);
  const disposers = [];

  // ② 渲染崩溃 / 未处理的 Promise（逃出边界的那些）
  if (win !== null && win !== undefined && typeof win.addEventListener === 'function') {
    const onError = (event) => {
      reporter.report({
        phase: 'render',
        message: `页面错误：${describeError(event?.error ?? event?.message ?? event)}`,
        error: event?.error,
        details: { source: 'window.error' },
      });
    };
    const onRejection = (event) => {
      reporter.report({
        phase: 'unhandled',
        message: `未处理的 Promise 拒绝：${describeError(event?.reason ?? event)}`,
        error: event?.reason,
        details: { source: 'window.unhandledrejection' },
      });
    };
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    disposers.push(() => {
      if (typeof win.removeEventListener === 'function') {
        win.removeEventListener('error', onError);
        win.removeEventListener('unhandledrejection', onRejection);
      }
    });
  }

  return ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // 收尾失败不影响卸载
      }
    }
  }, 'gui-frame: diagnostics hooks');
}
  return { DIAGNOSTICS_PATH: DIAGNOSTICS_PATH, DIAGNOSTICS_METHOD: DIAGNOSTICS_METHOD, CLIENT_REQUEST_TYPE: CLIENT_REQUEST_TYPE, PLUGIN_NAME: PLUGIN_NAME, CLIENT_VERSION: CLIENT_VERSION, DIAGNOSTIC_PHASES: DIAGNOSTIC_PHASES, DIAGNOSTIC_LIMITS: DIAGNOSTIC_LIMITS, describeError: describeError, truncate: truncate, summarizeStack: summarizeStack, fingerprintOf: fingerprintOf, hashFingerprint: hashFingerprint, degradeEvent: degradeEvent, renderErrorReport: renderErrorReport, createDiagnosticsEnvelope: createDiagnosticsEnvelope, createDiagnosticsReporter: createDiagnosticsReporter, installDiagnosticsHooks: installDiagnosticsHooks };
}());
__esMod["./kit/probe.mjs"] = (function () {
/**
 * soft-probe.mjs —— **读可选服务的唯一口径**。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【平台规则（实读 `@deepseek-ai/cordis/lib/index.js` 的 reflect handler，非推断）】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   get: (target, prop, ctx) => {
 *     if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);   // prototype / then / 数字 / `_` 开头
 *     if (Reflect.has(target, prop)) return …;                             // ctx 自己的成员（方法等）
 *     const error = new Error(`cannot get property "${prop}" without inject`);
 *     … 解析服务：解析不到 ⇒ **抛** →……………
 *   }
 * ⇒ 对**未声明/未注册**的服务做属性访问（`ctx.workspace`）会**直接抛**，不是返回 `undefined`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么这条规则能造成"静默零注册"】（真机事故）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 真机事故：探一个服务时写成「先试属性访问，拿不到再 `ctx.get(...)`」——
 * 真机上**第一行就抛**，软探测那行永远走不到；抛出的错又被「不许把页面搞崩」要求的整段 try/catch 吞掉
 * （apply 不许把页面搞崩，这是对的）⇒ **页面正常、能力全无**：
 *   `[gui-frame] 客户端 apply 失败（已吞，页面照常）：cannot get property "workspace" without inject`
 * 离线单测/e2e 用的是**替身 ctx**（不执行平台的 inject 规则）⇒ 属性访问只是 `undefined`，全绿。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【本文件的口径】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   - **读服务一律 `ctx.get(name)`**：平台公开的软探测，缺服务返回 `undefined`、**不抛**；
 *     这也是 `contracts/service-face.mjs` 写明的自家口径（不用 Cordis 的 inject 声明
 *     ——客户端 inject 缺服务会让 fiber 悬置、外壳 `assertEntriesActive` 抛错）。
 *   - **唯一豁免**：平台常驻的 `logger`（见 `probeLogger`）允许一次**受保护**的属性读取，
 *     且只允许发生在本文件 —— 别的模块一律 `probeLogger(ctx)` 取用，不自己碰属性。
 *   - 探测本身**绝不抛**：连 `ctx.get` 都抛的环境（退化替身）也退化成 `undefined`。
 */

/** 软探测的标识（诊断里点名用）。 */
const SOFT_PROBE_NAME = 'gui-frame:soft-probe';

/**
 * 取一个**可选**服务（缺了就当没有，绝不抛）。
 *
 * **只用 `ctx.get(name)` 这一条路** —— 真机实测的三条事实决定了这一点：
 *   ① 本插件 `apply` 时（平台服务尚未注册）`ctx.get(name)` 恒为 `undefined`；
 *   ② 此时 `ctx.reflect.get(name, false)`（宽松解析）会返回一个**半初始化**的服务对象
 *      （`slots` 能拿到 `{ctx,name,_core,…}`，但它还没挂进渲染树）⇒ 拿它去注册座位等于**注册进一个不渲染的表**，
 *      比降级更糟：能力自称装上了、界面却什么都没有；
 *   ③ ~3s 后（兄弟插件的 fiber 就绪）`ctx.get(name)` 对 **slots / layout / locale / settingsScope / connection**
 *      全部返回真对象。
 * ⇒ 正确姿势是「**严格探测 + 等它真的出现**」：本函数只做严格探测，等待由 `entry.mjs` 的补装窗口负责
 *   （`SERVICES_READY_TIMEOUT_MS` / `SERVICES_READY_INTERVAL_MS`）。
 * @param {object|undefined|null} ctx 调用方 Cordis ctx
 * @param {string} name 服务名（如 `workspace` / `slots` / `settingsScope` / `connection`）
 * @returns {*} 服务实例或 `undefined`
 */
function probeService(ctx, name) {
  if (ctx === null || ctx === undefined) return undefined;
  try {
    if (typeof ctx.get !== 'function') return undefined;
    return ctx.get(name);
  } catch {
    // 探测本身不许抛：拿不到 = 没有（「依赖缺失就不激活」）
    return undefined;
  }
}

/** `console` 兜底（没有 console 的环境就什么都不做；日志绝不该把装配搞崩）。 */
function consoleFallback(level, line) {
  try {
    if (typeof console === 'undefined' || console === null) return;
    const fn = typeof console[level] === 'function' ? console[level] : console.log;
    if (typeof fn === 'function') fn.call(console, line);
  } catch {
    // 兜底失败也不许抛
  }
}

/** console 形状的 logger（保底可见性：真机 console 里至少能看到降级原因）。 */
const CONSOLE_LOGGER = Object.freeze({
  error: (line) => consoleFallback('error', line),
  warn: (line) => consoleFallback('warn', line),
  info: (line) => consoleFallback('info', line),
  debug: (line) => consoleFallback('debug', line),
});

/**
 * 取**日志出口**（诊断专用；拿不到也绝不抛）。
 *
 * 顺序：`ctx.get('logger')`（真机口径）→ 一次**受保护**的 `ctx.logger` 读取（测试替身把 logger 挂在
 * 属性上；真机若拒绝未声明属性访问就抛 ⇒ 这里吞掉）→ `console` 兜底。
 * ⚠ 这是全仓库**唯一**允许碰 `ctx.logger` 的地方：其它文件一律 `probeLogger(ctx)`。
 * @param {object|undefined|null} ctx
 * @returns {{error:Function, warn:Function, info:Function, debug:Function}}
 */
function probeLogger(ctx) {
  const viaGet = probeService(ctx, 'logger');
  if (viaGet !== null && viaGet !== undefined) return viaGet;
  try {
    const direct = ctx === null || ctx === undefined ? undefined : ctx.logger;
    if (direct !== null && direct !== undefined) return direct;
  } catch {
    // 平台拒绝未声明属性访问 ⇒ 退到 console（可见性不丢）
  }
  return CONSOLE_LOGGER;
}

/**
 * 取日志出口的**某一级**（`logger.warn` 之类；拿不到就退到 console 的同级）。
 * @param {object|undefined|null} ctx
 * @param {'error'|'warn'|'info'|'debug'} level
 * @returns {Function} 恒可调用的函数（**永不抛**）
 */
function probeLogFn(ctx, level) {
  const logger = probeLogger(ctx);
  try {
    if (logger !== null && logger !== undefined && typeof logger[level] === 'function') {
      return (line) => logger[level](line);
    }
  } catch {
    // 读 logger 的成员都可能抛（代理对象）⇒ 退 console
  }
  return (line) => consoleFallback(level, line);
}
  return { SOFT_PROBE_NAME: SOFT_PROBE_NAME, probeService: probeService, CONSOLE_LOGGER: CONSOLE_LOGGER, probeLogger: probeLogger, probeLogFn: probeLogFn };
}());
__esMod["./kit/tokens.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
/**
 * tokens.mjs —— 坞与面板的**样式层**：`--dsw-*` token 白名单 + `--guif-*` 变量命名规则。
 *
 * ═══ 两条硬规则的判据（不是风格，是机制）═══
 * ① **只用 `--dsw-*`**：外壳的主题真源是 `dsh-client-ui-theme` 产物里的 403 条 `--dsw-*`
 *    声明（P4 探针实测：`probe/evidence/p4-theme-tokens.json` 的 `A_themeBundle.unionDeclared`）。
 *    本文件的白名单是它的**子集**，且每一条都同时出现在
 *      - `B_inspectDirectory.names`（`exportInspectTokens()` 的静态种子）或
 *      - `C_shellCss.referencedAliasNames`（外壳 CSS 真实引用的 alias），
 *    并且**不在** `D_tree.referencedNotDeclared`（被引用但主题表里没有声明的那 10 条）里 ——
 *    那 10 条是「写上去就悬空」的陷阱（如 `--dsw-alias-label-error`、`--dsw-font`）。
 *    ⇒ 任何不在白名单里的 `--dsw-*` 名字都**在装配期直接抛**
 *      （取既有冻结码 `GUIF-E-COMPONENT-INVALID`，不新造码 —— 见下方 `tokenError` 的说明），
 *      这样「手滑写了个不存在的 token」不会变成「真机上颜色莫名其妙」。
 * ② **`--guif-*` 两分**：**公开**变量（接入方可以覆盖，属契约）一律 `--guif-*`；
 *    **私有**变量（实现细节，随时可改）一律 `--guif-private-*`。两者都**只作为 fallback 的外层**：
 *    `var(--guif-xxx, var(--dsw-yyy))` —— 没被覆盖时观感与外壳同源。
 *    命名判据是纯函数（`isGuifPublicVar` / `isGuifPrivateVar`），单测直接扫源码复核。
 *
 * 本文件**零副作用**：纯常量表 + 纯函数。
 */


/** token / 变量的前缀常量（三处判据唯一真源）。 */
const DSW_PREFIX = '--dsw-';
const GUIF_PUBLIC_PREFIX = '--guif-';
const GUIF_PRIVATE_PREFIX = '--guif-private-';

/**
 * 允许出现在坞与面板样式里的 `--dsw-*` token（**白名单**；见文件头 ①）。
 * 每一条都在 `probe/evidence/p4-theme-tokens.json` 里有落点，且已逐个对照
 * `D_tree.referencedNotDeclared`（10 条陷阱）确认不在其中。
 */
const DSW_TOKENS = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-brand-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-corner-shape',
  '--dsw-elevation-stroke',
  '--dsw-font-xxs-12-font-size',
  '--dsw-font-xs-13-font-size',
  '--dsw-specific-sidebar-fill',
]);

/**
 * **公开** `--guif-*` 变量（接入方契约：可以覆盖，且改了属于公开面变更）。
 * 用途：坞/面板的骨架尺寸与配色缝 —— 插件只写内容，观感由这里统一。
 *
 * ★ 扩容（用户要求「在接口上做得稍微丰富点」）：坞面板里**按钮那一行**从「只有角标
 *   两个色」扩成**一族**（`--guif-dock-row-*`），把**三态底色、字色与焦点环**开出来。三条纪律
 *   （缺一条这一族就是假的）：
 *   ① **只「取用」，绝不「声明」**：取值一律写在 `var(--guif-…, 缺省)` 的**使用位**
 *      （内联 style 的值、样式表的声明值）—— 一旦在元素上把变量**声明**成内联自定义属性，
 *      祖先给的覆盖值就被它自己那一条挡死（自定义属性走继承：元素自己的声明恒胜过继承来的值）。
 *      本包就是这样踩的（见 `panel/components.mjs` 的注释）。
 *   ② **缺省即现状**：族内每个名字的 `var()` 回退值 = 扩容前的取值 ⇒ 没人覆盖时观感零变化
 *      （由 `tests/unit/dock-style-vars.test.mjs` 的冻结表逐条对锁）。
 *   ③ **一行一个悬停面**：族里给的是**整行**的底色；行内控件自己的悬停底色
 *      仍被样式表强制透明（不要在这一族里给它开口子，那是另一条裁定）。
 *
 * ⚠ **有意不开的两个旋钮＝美学秩序里的不变量（用户两次确认）**：**行圆角**（`8px`）与
 *   **行与行的间距**（`4px`）。第一次是判「没必要」；**第二次给的是理由：「改行圆角和行间距会影响面板的
 *   美学秩序，所以不要。」** ⇒ 它们与 DSH 侧栏 `.panelRow` / `.panelList` **逐值同源**，是这个面板「看着
 *   像同一个面板」的基础 ⇒ **不是配置项、不是漏开**：实现里保持字面量。
 *   要改这两个只能动本包样式/内联基线（或提需求改设计），**不要**顺手加回登记 —— 有断言盯着它们
 *   必须是**字面量**（加回来会红，逼人先想清楚是不是该动美学秩序）。
 */
const GUIF_PUBLIC_VARS = Object.freeze([
  '--guif-dock-badge-bg',
  '--guif-dock-badge-fg',
  '--guif-dock-glyph-size',
  '--guif-dock-row-bg',
  '--guif-dock-row-bg-active',
  '--guif-dock-row-bg-hover',
  '--guif-dock-row-fg',
  '--guif-dock-row-fg-active',
  '--guif-dock-row-focus-ring',
  '--guif-panel-bg',
  '--guif-panel-border',
  '--guif-panel-fg',
  '--guif-panel-gap',
  '--guif-panel-padding',
  '--guif-panel-radius',
  '--guif-toolbar-gap',
]);

/**
 * **私有** `--guif-private-*` 变量（实现细节；接入方**不得**依赖，改名不算公开面变更）。
 */
const GUIF_PRIVATE_VARS = Object.freeze([
  '--guif-private-badge-min-width',
  '--guif-private-header-min-height',
  '--guif-private-row-min-height',
  '--guif-private-status-min-height',
]);

/** 是否合法 `--dsw-*` token（在**白名单**内；不在白名单的合法主题 token 也不许用 —— 见文件头 ①）。 */
function isAllowedDswToken(name) {
  return typeof name === 'string' && DSW_TOKENS.includes(name);
}

/** 是否**公开** `--guif-*` 变量（注意：`--guif-private-*` 也以 `--guif-` 开头，必须先排除它）。 */
function isGuifPublicVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PUBLIC_PREFIX) && !name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 是否**私有** `--guif-private-*` 变量。 */
function isGuifPrivateVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 装配期错误（未知 token / 未知变量名一律显式抛，不静默降级成空串）。
 *
 * ⚠ 错误码**只能取 `src/client/contracts/errors.mjs` 里已冻结的那 17 条**（公开面门禁
 * `tests/verify-surface/public-surface.test.mjs` 会扫 `src/**` 里的 `GUIF-[EW]-*` 并要求 ⊆ 冻结集合）。
 * 本文件用既有码 `GUIF-E-COMPONENT-INVALID`（语义：**组件层入参非法** —— token 名正是组件层的入参），
 * 不为「token 白名单」新造码（那要走公开面的反向验证流程）。
 */
function tokenError(message, details) {
  return createError('GUIF-E-COMPONENT-INVALID', `[panel/tokens] ${message}`, details);
}

/**
 * 取一个白名单 token 的 `var(...)` 引用。
 * @param {string} name 必须是 `DSW_TOKENS` 里的一条
 * @param {string|null} [fallback] 可选兜底值（另一个 `var(...)` 或字面量）
 */
function dsw(name, fallback = null) {
  if (!isAllowedDswToken(name)) {
    throw tokenError(`未知或未获准的 --dsw-* token「${name}」——白名单见 src/client/kit/tokens.mjs（只用 P4 证据里真实声明过的 token）`);
  }
  return fallback === null ? `var(${name})` : `var(${name}, ${fallback})`;
}

/**
 * 公开变量引用：外层是接入方可覆盖的 `--guif-*`，内层落到 `--dsw-*`（观感与外壳同源）。
 * @param {string} name 必须是 `GUIF_PUBLIC_VARS` 里的一条
 * @param {string} token `DSW_TOKENS` 里的一条（兜底）
 * @param {string|null} [literal] 内层再兜一个字面量（`--dsw-*` 本身也可能悬空时用）
 */
function guifVar(name, token, literal = null) {
  if (!isGuifPublicVar(name) || !GUIF_PUBLIC_VARS.includes(name)) {
    throw tokenError(`公开变量必须写成 --guif-* 且在 GUIF_PUBLIC_VARS 里（收到「${name}」）——私有变量要用 --guif-private-*`);
  }
  return `var(${name}, ${dsw(token, literal)})`;
}

/**
 * 公开变量引用，兜底是**字面量**（尺寸/间距这类没有对应 `--dsw-*` token 的取值）。
 * 取值位置仍然是 `var(...)`；字面量**只允许出现在 var() 的 fallback 位置**（见文件头 ②）。
 * @param {string} name 必须是 `GUIF_PUBLIC_VARS` 里的一条
 * @param {string} literal CSS 字面量（如 `'8px'`）
 */
function guifLiteral(name, literal) {
  if (!isGuifPublicVar(name) || !GUIF_PUBLIC_VARS.includes(name)) {
    throw tokenError(`公开变量必须写成 --guif-* 且在 GUIF_PUBLIC_VARS 里（收到「${name}」）`);
  }
  return `var(${name}, ${literal})`;
}

/**
 * 私有变量引用（`--guif-private-*`）。
 * @param {string} name 必须是 `GUIF_PRIVATE_VARS` 里的一条
 * @param {string|null} [fallback] `--dsw-*` token（须在白名单内）**或**一个字面量（如 `'14px'`）
 */
function guifPrivateVar(name, fallback = null) {
  if (!isGuifPrivateVar(name) || !GUIF_PRIVATE_VARS.includes(name)) {
    throw tokenError(`私有变量必须写成 --guif-private-* 且在 GUIF_PRIVATE_VARS 里（收到「${name}」）`);
  }
  if (fallback === null) return `var(${name})`;
  if (typeof fallback === 'string' && fallback.startsWith(DSW_PREFIX)) return `var(${name}, ${dsw(fallback)})`;
  return `var(${name}, ${fallback})`;
}
  return { DSW_PREFIX: DSW_PREFIX, GUIF_PUBLIC_PREFIX: GUIF_PUBLIC_PREFIX, GUIF_PRIVATE_PREFIX: GUIF_PRIVATE_PREFIX, DSW_TOKENS: DSW_TOKENS, GUIF_PUBLIC_VARS: GUIF_PUBLIC_VARS, GUIF_PRIVATE_VARS: GUIF_PRIVATE_VARS, isAllowedDswToken: isAllowedDswToken, isGuifPublicVar: isGuifPublicVar, isGuifPrivateVar: isGuifPrivateVar, tokenError: tokenError, dsw: dsw, guifVar: guifVar, guifLiteral: guifLiteral, guifPrivateVar: guifPrivateVar };
}());
__esMod["./dock/panel-content.mjs"] = (function () {
  var { dsw, guifLiteral, guifVar } = __esMod["./kit/tokens.mjs"];
/**
 * dock/panel-content.mjs —— **按钮面板的正文**。
 *
 *   · `readDockActions(registry, layoutHandle)` —— 坞在册的**外部**动作型入口（只装外部插件
 *     交进来的按钮）。★ 只依赖坞自己的环 + 布局句柄，**不依赖任何组件渲染** —— 入口在用户点它之前
 *     坞面板从没渲染过（旧实现把「打开面板」放在面板组件闭包里 ⇒ 点图标空转，机检实测）。
 *   · `createPanelContent(el, rows)` —— 面板正文节点（现造，同上理由）；`PANEL_EMPTY_HINT` 是它的空态文案。
 *
 * **入参 bag（1 个）**：`DOCK_ENTRY_ID`（坞自己的入口 id，读法要按它过滤，在 `dock.mjs` 侧声明）
 * —— 本模块**不重复声明**任何常量。
 * ⚠ `PANEL_EMPTY_HINT` 不再是对外导出（原 `export const` 无外部引用）：坞只把它用在正文里。
 * ⚠ 行改成 DSH 侧栏同款（容器取值逐值照抄 `.panelRow`，样式表在 `./panel-styles.mjs`）。
 * ⚠ 行 = `[注册方的控件][角标?]` —— 坞**不画图标槽**（注册面的 `icon` 与注册方控件自带的图标
 *   会撞成两个图标），理由与真机读数见 `createPanelContent`。
 */


function createPanelContentFace(deps) {
  const { DOCK_ENTRY_ID } = deps;
  const PANEL_EMPTY_HINT = "还没有插件把按钮交进来。写法：别的插件里调用 ctx.guiFrame.register({ id, label, order, kind: 'action', badge }, 你的按钮组件) —— 单向依赖：本插件不在时不注册、不占座位、页面照常。";

  /**
   * 行内三段与空态的**内联基线**（不依赖主题能力；伪类与「中和注册方外壳」在 `panel-styles.mjs` 的样式表里）。
   * 取值与 DSH 侧栏 `.panelRow` / `.panelGlyph` / `.panelTitle` 同源；颜色只走白名单 token（`guifVar`）。
   *
   * ★ 底色/字色走**公开变量**，接入方在任意祖先上定义即生效
   *   —— `--guif-dock-row-bg`（静止）/ `-row-fg`，悬停与激活那两态在样式表里
   *   （`--guif-dock-row-bg-hover` / `-bg-active` / `-fg-active` / `-focus-ring`，伪类内联表达不了）。
   *   ⚠ 这里只**取用**（写在 `var(...)` 的值位），**绝不**把变量声明成元素上的自定义属性 ——
   *     后者会把祖先给的覆盖值挡死（`panel/components.mjs` 就是这么踩的）。
   *   ⚠ 字色保留旧链：`--guif-dock-row-fg` → `--guif-panel-fg` → 外壳 token，故老接入方设过的
   *     `--guif-panel-fg` 继续生效（新名字是**更细的旋钮**，不是替换）。
   *   ⚠ **圆角与行距不在这一族里 —— 它们是美学秩序的不变量**（凭据：
   *     「改行圆角和行间距会影响面板的美学秩序，所以不要。」）⇒ 保持字面量、与 DSH 侧栏逐值同源；
   *     `tests/unit/dock-style-vars.test.mjs` 盯着这两个位必须是字面量（改成变量会红）。
   */
  const ROW_STYLE = Object.freeze({
    boxSizing: 'border-box',
    width: '100%',
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 8px',
    border: 'none',
    borderRadius: '8px',
    background: guifLiteral('--guif-dock-row-bg', 'transparent'),
    color: `var(--guif-dock-row-fg, ${guifVar('--guif-panel-fg', '--dsw-alias-label-secondary')})`,
    font: 'inherit',
    fontSize: '14px',
    lineHeight: '22px',
    textAlign: 'left',
    cursor: 'pointer',
  });
  const BADGE_STYLE = Object.freeze({
    flex: 'none',
    marginLeft: 'auto',
    minWidth: '14px',
    padding: '0 5px',
    borderRadius: '999px',
    background: guifVar('--guif-dock-badge-bg', '--dsw-alias-state-business-primary'),
    color: guifVar('--guif-dock-badge-fg', '--dsw-alias-label-primary-inverted'),
    fontSize: '11px',
    lineHeight: '16px',
    textAlign: 'center',
  });
  const HINT_STYLE = Object.freeze({
    color: dsw('--dsw-alias-label-caption'),
    lineHeight: '1.6',
    padding: '2px 8px',
  });

  /**
   * 坞在册的**外部**动作型入口（面板只装外部插件交进来的按钮，本包自己的不进）。
   *
   * ★ 关键：这份读法**只依赖坞自己的环 + 布局句柄**，**不依赖任何组件渲染** ——
   *   入口（侧栏那一颗）在用户点它之前，坞面板从没渲染过；旧实现把「打开面板」的函数放在
   *   面板组件的闭包里、靠组件渲染时才赋值给 `refs.openPanel`，于是**点图标 = 空转**
   *   （机检实测：`stopPropagation` 拦下了官方那一下，但 `overlay.open` 一次都没调）。
   */
  /**
   * 注册方**运行期改写过的** label：`setLabel(next)` 写进这里，
   * 此后 `labelOf` 优先用它 —— 因为注册面的 `label` 可能是 **thunk**（每次读取重新求值），
   * 单改 `row.record.label` 会被原 thunk 覆盖回去（踩过一次）。
   */
  const labelOverrides = new Map();
  /** 行的 label：**改写优先** → 注册面元数据（含 thunk）→ null。 */
  function labelOf(id, record) {
    if (labelOverrides.has(id)) return labelOverrides.get(id);
    if (typeof deps.entryLabel === 'function') return deps.entryLabel(record);
    return record?.label ?? null;
  }

  function readDockActions(registry, layoutHandle) {
    const rows = [];
    for (const [id, row] of registry) {
      if (id === DOCK_ENTRY_ID) continue;
      if (row.record.kind !== 'action') continue;
      if (row.record.source === 'dsh-gui-frame') continue;
      rows.push({
        id,
        order: Number.isInteger(row.record.order) ? row.record.order : 0,
        badge: row.badge ?? null,
        label: labelOf(id, row.record),
        Component: row.record.Component,
        record: row.record,
      });
    }
    const status = layoutHandle !== null && layoutHandle !== undefined && typeof layoutHandle.status === 'function' ? layoutHandle.status() : null;
    const layout = status === null || status === undefined ? null : status.layout ?? null;
    const docks = layout !== null && Array.isArray(layout.docks) ? layout.docks : null;
    const entries = layout !== null && layout.entries !== null && typeof layout.entries === 'object' ? layout.entries : null;
    const indexOf = (id) => (docks === null || docks.indexOf(id) < 0 ? Number.MAX_SAFE_INTEGER : docks.indexOf(id));
    const visible = (id) => (entries === null || entries[id] === undefined || entries[id] === null ? true : entries[id].visible !== false);
    return rows
      .filter((row) => visible(row.id))
      .sort((left, right) => indexOf(left.id) - indexOf(right.id) || left.order - right.order || left.id.localeCompare(right.id));
  }

  /**
   * 面板正文节点（入口点开时现造，不依赖面板组件是否渲染过）。
   *
   * ═══ 每一行**照 DSH 侧栏那一行**画 ═══
   * 用户原话：「按钮面板里的按钮样式太丑了，你看看 DSH 上侧边栏的按钮实现呢？**一个按钮包括图标和文字两部分，
   * 由外部注册**。至于**按钮容器背景**实现要和 DSH 原版的设计风格统一。」
   *
   * ⇒ 每行 = `<button data-guif-dock-action="<id>">`（容器取值逐字照 `dsh-client-ui-sidebar` 的 `.panelRow`）：
   *   `[注册方的控件]` + `[角标槽?]`。
   *
   * ═══ **坞不画图标槽**（一行里只有一个图标） ═══
   * 用户原话：「为什么面板里有两个图标？是你的问题还是使用者的问题？」
   *
   * 真机取证（隔离实例 + headless CDP）：
   * 一行里 `glyphSlots=1`、`svgCount=2` —— **两颗 16×16 的 `svg.sq-icon`**。
   * 根因是**坞的注册面给了两处图标来源、契约却没定谁负责**：
   *   · 坞在行首画 `register({icon})` 那一颗（上一版的 `glyphNode`）；
   *   · 注册方的 `Component`（注册契约里**必填**）自带同一颗 —— SafelyQuit 把**同一个 `PowerIcon`**
   *     既传给 `register({icon})` 又放进自己的按钮里（它是照坞的文档写的 ⇒ **不是使用方的问题**）。
   *
   * ⇒ 口径：**行的内容一律是注册方交进来的那个控件**（图标 + 文字都在它里面），坞只补**角标**；
   *   `register({icon})` 仍是注册面字段，坞**自绘字形**的地方继续用它（`kind !== 'action'` 的侧栏行，
   *   见 `dock/core.mjs` 的 `createEntryGlyph`）—— **动作型入口的面板行不画**，画了就是两个图标。
   */
  function createPanelContent(el, rows) {
    return el('div', {
      key: 'panel-content',
      'data-guif-dock-actions': String(rows.length),
      // 容器取值与样式表同源（`[data-guif-dock-actions]`）；内联这一份是「主题能力缺席时的基线」。
      // ⚠ 行距是字面量：`tests/unit/dock-style-vars.test.mjs` 盯着它（改成变量会红）。
      style: { display: 'flex', flexDirection: 'column', gap: '4px' },
    },
    rows.length === 0
      ? el('div', { key: 'empty', 'data-guif-dock-hint': 'true', style: HINT_STYLE }, PANEL_EMPTY_HINT)
      : null,
    rows.map((row) => el('button', {
      key: `action:${row.id}`,
      type: 'button',
      // 锚点名不叫 `data-guif-action`：那个名字被本包自己的 Toolbar/按钮组件占着（撞名会让判据把工具条也算进来）。
      'data-guif-dock-action': row.id,
      style: ROW_STYLE,
    },
    el(row.Component, {
      // ★ 注册方拿到**自己的**只读能力面 —— 值全是能力面（两个 setter 只作用它自己那一行），
      //   不是给别人的入口。`label` 取注册面元数据（可为 thunk），运行期改写走 `setLabel`。
      id: row.id,
      label: row.label,
      setBadge: (next) => deps.setBadge?.(row.id, next),
      setLabel: (next) => {
        labelOverrides.set(row.id, next); // 面板自己这一份（thunk 覆盖不了）
        return deps.setLabel?.(row.id, next); // 同时通知坞切片（侧栏/管理页那两处自绘的读数）
      },
    }),
    row.badge === null || row.badge === undefined
      ? null
      : el('span', { 'data-guif-badge': String(row.badge), style: BADGE_STYLE }, String(row.badge)))));
  }

  /** 交回装配面：正文工厂 + 在册动作读法（装配侧再把它们递给面板模块）。 */
  return { readDockActions, createPanelContent };
}
  return { createPanelContentFace: createPanelContentFace };
}());
__esMod["./kit/primitives.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
/**
 * primitives.mjs —— **官方 primitives 的安全子集**。
 *
 * ═══ 为什么要这张表 ═══
 * `@deepseek-ai/dsh-client-ui-primitives` 是外壳的静态种子键（rc 期**无独立包目录、无类型、无文档**，
 * 只在内联产物里）。GUIFrame 只用其中**官方自己在用的**那一部分：本机 50 个官方包的 `lib/client.js`
 * 里真实出现过 `primitives.<成员>` 的成员，恰好 180 个（扫描方法见下方 `PRIMITIVES_SCAN`，
 * 平台在位时可用它重扫一遍）。
 *
 * ⚠ **图标名的命名体系随平台换过**：0.1.5 一代用**尺寸后缀**（`IconCloseOutline16`），
 *   0.2.0 起换成**字重后缀**（`IconCloseOutlineRegular` / `…Medium`）。旧名在新平台里一个都没有，
 *   而 `get()` 对未覆盖名**直接抛** ⇒ 这不是「测试要改」而是**产品面必须跟着改名**。
 *
 * 判据强度说明（别把它当「大概齐」）：
 *  - 「存在」由**官方调用点**证明（不是从导出表猜的），所以被本表收录的成员都**有真实用法**；
 *  - 反过来，**不在表里的成员一律不许用**（`createPrimitivesSeat` 的 `get()` 对未知名字**直接抛**）——
 *    口径是「未覆盖成员**不得使用**」。
 *  - 种子缺席（`env.seeds.primitives` 为 `undefined` 或构建期的假种子）时**不抛**：`get()` 返回
 *    `undefined`，组件走**自研等价物**兜底（依赖缺失时不激活、不炸页面）。
 *
 * ═══ 我们实际用到的那 8 个（`PRIMITIVES_USED`）═══
 * 全是使用频次前排成员（括号里是 50 个包里的调用点数）：
 *   Button 112 · Tooltip 63 · IconChevronRightOutlineRegular 31 · IconCloseOutlineRegular 16 ·
 *   IconWarningOutlineRegular 16 · Tag 9 · IconRefreshOutlineRegular 8 · IconLoadingOutlineRegular 3
 * 单测断言 `PRIMITIVES_USED ⊆ PRIMITIVES_MEMBERS`，并在平台在位时断言 `⊆ 实时重扫结果`。
 *
 * 本文件**零副作用**：纯常量 + 纯函数，不读 DOM、不碰种子。
 */


/** 扫描元信息（可重演：同一版本 DSH 上重跑得到同一集合）。 */
const PRIMITIVES_SCAN = Object.freeze({
  package: '@deepseek-ai/dsh-client-ui-primitives',
  platform: 'DSH 0.2.0-rc.2',
  method: '扫本机 @deepseek-ai/ 下所有 lib/client.js，取其中 require 该种子键的别名，统计 `<别名>.<成员>`',
  packages: 50,
  members: 180,
});

/**
 * 官方 50 个包真实 require 过的 primitives 成员全集（180 个，排序）。
 * 本文件**不解释**每个成员的签名（rc 期无反推保证）；表的作用是**闸门**，不是文档。
 */
const PRIMITIVES_MEMBERS = Object.freeze([
  'BrandWordmark', 'Button', 'CODE_HIGHLIGHT_EXTENSIONS', 'Checkbox',
  'CodeBlock', 'ConnectionIndicator', 'DiffBlock', 'DisclosureRow',
  'FISH_LOGO_PATH', 'FISH_LOGO_VIEWBOX', 'FileTypeIcon', 'FishLogo',
  'GuideArtworkBrowser', 'GuideArtworkFiles', 'HoverCard', 'ICON_REGULAR_STROKE',
  'IconAgentPresetOutlineMedium', 'IconAgentPresetOutlineRegular', 'IconApiOutlineRegular', 'IconArchiveCheckOutlineRegular',
  'IconArchiveOffOutlineRegular', 'IconArchiveOutlineMedium', 'IconArchiveOutlineRegular', 'IconBranchOutlineRegular',
  'IconBrowseOutlineRegular', 'IconCheckCircleFillRegular', 'IconCheckOutlineRegular', 'IconChecklistOutlineRegular',
  'IconChevronDownOutlineRegular', 'IconChevronLeftOutlineMedium', 'IconChevronLeftOutlineRegular', 'IconChevronRightOutlineRegular',
  'IconChevronUpOutlineRegular', 'IconChevronsUpDownOutlineRegular', 'IconClockOutlineRegular', 'IconCloseCircleFillRegular',
  'IconCloseFillRegular', 'IconCloseOutlineMedium', 'IconCloseOutlineRegular', 'IconCodeOutlineRegular',
  'IconCompactOutlineRegular', 'IconCompareSplitOutlineRegular', 'IconContextInjectionOutlineRegular', 'IconCopyOutlineRegular',
  'IconCordisPluginOutlineRegular', 'IconDarkOutlineMedium', 'IconDataOutlineMedium', 'IconDataOutlineRegular',
  'IconDatabaseOutlineRegular', 'IconDeliverDocRegular', 'IconDislikeFillRegular', 'IconDislikeOutlineRegular',
  'IconDownloadOutlineRegular', 'IconEditOutlineRegular', 'IconEllipsisOutlineMedium', 'IconEllipsisOutlineRegular',
  'IconFlatListOutlineRegular', 'IconFolderCloseRegular', 'IconFolderOpenOutlineRegular', 'IconFolderOpenRegular',
  'IconFollowsystemOutlineMedium', 'IconGaugeOutlineRegular', 'IconGlobeOutlineRegular', 'IconGoalOutlineRegular',
  'IconInfoOutlineRegular', 'IconInspectOutlineRegular', 'IconLightOutlineMedium', 'IconLikeFillRegular',
  'IconLikeOutlineRegular', 'IconLinkOutlineRegular', 'IconListPenOutlineRegular', 'IconLoadingOutlineRegular',
  'IconMicrophoneOutlineRegular', 'IconNewChatOutlineMedium', 'IconNewChatOutlineRegular', 'IconNowrapFillRegular',
  'IconPanelLeftOutlineRegular', 'IconPaperPlaneOutlineMedium', 'IconPaperPlaneOutlineRegular', 'IconPaperclipOutlineRegular',
  'IconPauseOutlineRegular', 'IconPersonalizationOutlineMedium', 'IconPinFillRegular', 'IconPinOutlineRegular',
  'IconPlanOutlineRegular', 'IconPlayOutlineRegular', 'IconPluginPinwheelOutlineRegular', 'IconPlusOutlineMedium',
  'IconPlusOutlineRegular', 'IconProjectAddOutlineRegular', 'IconQuestionOutlineRegular', 'IconQueueOutlineRegular',
  'IconRefreshOutlineRegular', 'IconRightUpOutlineRegular', 'IconSearchOutlineRegular', 'IconSendOutlineRegular',
  'IconSettingsOutlineMedium', 'IconSettingsOutlineRegular', 'IconSkillOutlineRegular', 'IconSlidersTwoOutlineRegular',
  'IconSparkleRegular', 'IconStopFillRegular', 'IconThinkOutlineRegular', 'IconTrashOutlineRegular',
  'IconTriangleRightFillRegular', 'IconUnarchiveOutlineRegular', 'IconUserOutlineMedium', 'IconUserOutlineRegular',
  'IconUsersOutlineRegular', 'IconWarningOutlineRegular', 'IconWarningTriangleOutlineRegular', 'IconWorkspaceTreeOutlineRegular',
  'IconWrapFillRegular', 'IconWrapLinesOutlineRegular', 'ImageLightbox', 'Input',
  'JsonBlock', 'JsonTree', 'MarkdownDelegateProvider', 'MarkdownText',
  'Menu', 'MenuGroup', 'MenuItemButton', 'MenuSurface',
  'Modal', 'PathLabel', 'PermissionIconFullAccessRegular', 'PermissionIconReadOnlyRegular',
  'PermissionIconWorkspaceWriteRegular', 'Pill', 'PluginArtworkDefault', 'PluginArtworkLoop',
  'PluginArtworkSearch', 'PluginArtworkSubagent', 'PluginArtworkTerminal', 'ReadBlock',
  'ReferenceIconRegular', 'RiskConfirmation', 'SHIELD_OUTLINE_PATH', 'SearchBlock',
  'SegmentedControl', 'SegmentedTabs', 'SettingsForm', 'SettingsFormModel',
  'SettingsSecretField', 'SettingsValueField', 'ShortcutKeys', 'StateDot',
  'Switch', 'Tag', 'TerminalBlock', 'TextShimmer',
  'Toast', 'Tooltip', 'WebBlock', 'classifyFileType',
  'closeTopModal', 'diffTotals', 'extractMarkdownPlainText', 'fileExtension',
  'fileSizeText', 'focusWithoutRing', 'isBehindModal', 'isDarwinDesktop',
  'languageForPath', 'modalSelector', 'observeComposition', 'observeStickyMenuGroups',
  'pointerModality', 'projectUserText', 'rankByName', 'relativeTime',
  'settingsNumberField', 'settingsTextField', 'useAnchoredMaxHeight', 'useAnchoredPosition',
  'useCodeHighlighter', 'useDismissOnOutsidePointer', 'useModalLayer', 'writeClipboard',
]);

/** 本包坞与面板**实际取用**的成员（上表子集；每一处 `get()` 都要能指到这里）。 */
const PRIMITIVES_USED = Object.freeze([
  'Button',
  'IconChevronRightOutlineRegular',
  'IconCloseOutlineRegular',
  'IconLoadingOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconWarningOutlineRegular',
  'Tag',
  'Tooltip',
]);

/** 装配期错误码：越出「官方真实用过」的子集。
 *
 * ⚠ 错误码取既有冻结码 `GUIF-E-COMPONENT-INVALID`（语义：**组件层入参非法**）—— 不新造码，
 * 理由见 `kit/tokens.mjs` 的同名注释（L1 公开面门禁扫 `src/**` 的 `GUIF-[EW]-*`）。
 */
function primitivesError(message, details) {
  return createError('GUIF-E-COMPONENT-INVALID', `[panel/primitives] ${message}`, details);
}

/**
 * 造一个**受限取用面**：只有 `PRIMITIVES_MEMBERS` 里的成员能被取出。
 * 种子缺席**不算错**：这是正常的降级路径，故只记账（`missing()`）不产出诊断码
 * —— 诊断码只能取冻结集合里的码，给「降级」硬套一个语义不符的码反而会污染上报链路。
 * @param {object|undefined|null} seed `env.seeds.primitives`（缺席时所有 `get()` 返回 undefined）
 * @returns {{get:(name:string)=>unknown, has:(name:string)=>boolean, missing:()=>string[], used:readonly string[]}}
 */
function createPrimitivesSeat(seed) {
  const bag = seed !== null && typeof seed === 'object' ? seed : null;
  const missing = [];
  const absent = bag === null;
  const record = (name) => {
    if (!missing.includes(name)) missing.push(name);
  };
  return {
    used: PRIMITIVES_USED,
    has(name) {
      if (!PRIMITIVES_MEMBERS.includes(name)) {
        throw primitivesError(`primitives 成员「${name}」不在官方 50 个包真实用过的 180 个成员里（未覆盖成员不得使用）`, { name });
      }
      return bag !== null && bag[name] !== undefined;
    },
    get(name) {
      if (!PRIMITIVES_MEMBERS.includes(name)) {
        throw primitivesError(`primitives 成员「${name}」不在官方 50 个包真实用过的 180 个成员里（未覆盖成员不得使用）`, { name });
      }
      const value = bag === null ? undefined : bag[name];
      if (value === undefined) record(name);
      return value;
    },
    missing() {
      return [...missing];
    },
    /** 种子整体缺席（组件层据此走自研兜底；语义比 `missing()` 更粗）。 */
    absent() {
      return absent;
    },
  };
}
  return { PRIMITIVES_SCAN: PRIMITIVES_SCAN, PRIMITIVES_MEMBERS: PRIMITIVES_MEMBERS, PRIMITIVES_USED: PRIMITIVES_USED, primitivesError: primitivesError, createPrimitivesSeat: createPrimitivesSeat };
}());
__esMod["./kit/entry-icons.mjs"] = (function () {
  var { guifLiteral, guifPrivateVar, guifVar } = __esMod["./kit/tokens.mjs"];
/**
 * entry-icons.mjs —— 坞图标与**自绘角标**。
 *
 * ═══ 为什么角标必须自绘 ═══
 * `SlotCore.register` 只把 `key / id / order / label / priority` 保留到 `options` 里
 * （实读官方 register 选项表：里面**没有 `badge` 字段**）⇒ 往注册选项里塞 `badge` 是**静默丢弃**。
 * 所以：坞把角标存进**自己的** store，图标组件从 store 读出并画出来 —— 注册选项里一个多余的键都没有
 * （单测直接断言 `Object.keys(options)` 只有白名单里的四个）。
 *
 * ═══ 形状 ═══
 * `sidebar.panellist` 的 owner 只传 `{ size, active }`（官方 `contract/slots.d.ts` L39-43），
 * 所以 id / label / 角标这些**不来自 owner props**，由坞在造图标组件时闭包带进来 ——
 * 这也正是「不依赖官方会丢字段的那条路」的实现方式。
 *
 * 本文件**零副作用**：只造元素与闭包，不注册任何东西。
 */



/** 自绘角标的机检锚点（值＝入口 id）。 */
const BADGE_ATTR = 'data-guif-badge';

/** 自绘字形的机检锚点。 */
const GLYPH_ATTR = 'data-guif-glyph';

/** 未提供图标时的兜底字形锚点（首字母/首字）。 */
const GLYPH_MARK_ATTR = 'data-guif-glyph-mark';

/** 角标文案上限（超过显示 `99+`，避免长数字把图标行撑开）。 */
const BADGE_MAX = 99;

/**
 * 收敛角标取值（坞自己的环内数据，**不进** slot 注册选项）。
 * 接受：正整数 / 字符串 / `{ count|text, tone }` / `null` / `0` / 负数 / `false`。
 * @param {unknown} value
 * @returns {{text:string, tone:string|null}|null} `null` ＝ 不画角标
 */
function normalizeBadge(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return null;
  let raw = value;
  let tone = null;
  if (typeof value === 'object') {
    if (value === null) return null;
    raw = value.count ?? value.text ?? null;
    tone = typeof value.tone === 'string' && value.tone !== '' ? value.tone : null;
    if (raw === null || raw === undefined) return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const count = Math.floor(raw);
    return { text: count > BADGE_MAX ? `${BADGE_MAX}+` : String(count), tone };
  }
  const text = String(raw).trim();
  if (text === '' || text === '0' || text === 'false') return null;
  return { text: text.length > 4 ? `${text.slice(0, 4)}…` : text, tone };
}

/** 角标底色：三档 tone（错误/警告/中性），全部落到 `--dsw-*`。 */
function badgeStyle(tone) {
  const bg = tone === 'error'
    ? guifVar('--guif-dock-badge-bg', '--dsw-alias-state-error-primary')
    : tone === 'warn'
      ? guifVar('--guif-dock-badge-bg', '--dsw-alias-state-warn-primary')
      : guifVar('--guif-dock-badge-bg', '--dsw-alias-state-business-primary');
  return {
    minWidth: guifPrivateVar('--guif-private-badge-min-width', '14px'),
    background: bg,
    color: guifVar('--guif-dock-badge-fg', '--dsw-alias-label-primary-inverted'),
  };
}

/** 图标行的整体盒（尺寸由 owner props 给；字号走公开变量，字面量只在 fallback 位）。 */
function glyphStyle(size) {
  const px = Number.isFinite(size) && size > 0 ? size : 18;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: `${px}px`,
    height: `${px}px`,
    fontSize: guifLiteral('--guif-dock-glyph-size', '13px'),
    color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
  };
}

/**
 * 解析一个入口 label：**字符串 / thunk**（注册选项里的 label 恒为 thunk）/ 其它 ⇒ `''`。
 *
 * ⚠ 这个函数存在的原因是一次真缺陷：旧版 `initialOf` 只认字符串，而坞**自己的**
 * 入口 label 是 `() => '按钮面板'` 这种 thunk ⇒ 兜底字形恒为 `•`（一个没有意义的中点）。用户看到
 * 侧栏那一行只有一个「•」，判定「按钮面板没实现」。凡走 thunk 的注册（即官方约定的全部）都会踩。
 */
function resolveEntryLabel(label) {
  if (typeof label === 'string') return label;
  if (typeof label === 'function') {
    try {
      const value = label();
      if (typeof value === 'string') return value;
    } catch {
      // thunk 抛错 ⇒ 当作没有 label（非关键路径，兜底字形接管）
    }
  }
  return '';
}

/** 从入口 label 里取一个自绘兜底字形（首字；空 ⇒ `•`）。 */
function initialOf(label) {
  const text = resolveEntryLabel(label).trim();
  return text === '' ? '•' : Array.from(text)[0];
}

/** 坞图标自身的机检锚点。 */
const DOCK_ICON_ATTR = 'data-guif-dock-icon';

/**
 * 每个入口图标「最后一次量的屏幕矩形」。
 *
 * 为什么记：面板要**贴着触发它的那颗按钮**长出来，而「点文字 / 按回车」那条路径没有事件对象
 * （`event === null`），量不到锚点。于是由图标自己在每次渲染后量一次（只读**我们自己渲染的节点**，
 * 不碰官方 DOM 结构 —— `dock.mjs` 里那条门禁禁止的是对官方 UI 做 DOM/CSS 外科手术）。
 * 记录失败（无 DOM / 节点不可量）一律不影响功能：面板退回缺省位。
 */
const entryAnchors = new Map();

/** 记一次图标矩形（内部用；`box` 传 `null` 表示量不到 ⇒ 清掉旧值）。 */
function recordEntryAnchor(id, box) {
  const key = String(id ?? '');
  if (key === '') return null;
  if (box === null || box === undefined || !Number.isFinite(box.left)) {
    entryAnchors.delete(key);
    return null;
  }
  entryAnchors.set(key, { left: box.left, top: box.top, right: box.right, width: box.width, height: box.height });
  return entryAnchors.get(key);
}

/** 读某个入口图标最后一次量的矩形（没有 ⇒ `null`）。 */
function readEntryAnchor(id) {
  return entryAnchors.get(String(id ?? '')) ?? null;
}

/**
 * 造**坞自己的图标**（2×2 圆角方格 ＝ 「一板子按钮」，就是这一行字面意思）。
 *
 * 为什么自绘而不是取官方 primitives：180 个官方成员里没有「一板子按钮」这一档语义
 * （`IconPanelLeftOutlineRegular` 是侧栏折叠、`IconCordisPluginOutlineRegular` 是官方插件面板 —— 用哪个都会撞语义）。
 * 约束照旧：零第三方依赖、颜色只走 `currentColor`（继承那一行的前景色，暗色主题自动跟随）、
 * 不写任何颜色字面量（`check:tokens` 硬门禁照过）。
 *
 * @param {object} react 种子 react
 * @returns {Function} 组件：`(props: {size?:number}) => element`
 */
function createDockIcon(react) {
  const el = react.createElement;
  return function GuiFrameDockIcon(props) {
    const size = Number.isFinite(props?.size) && props.size > 0 ? props.size : 18;
    const cells = [];
    for (const row of [0, 1]) {
      for (const col of [0, 1]) {
        cells.push(el('rect', {
          key: `${row}${col}`,
          x: 1.5 + col * 7.5,
          y: 1.5 + row * 7.5,
          width: 5.5,
          height: 5.5,
          rx: 1.6,
          fill: 'currentColor',
        }));
      }
    }
    return el('svg', {
      [DOCK_ICON_ATTR]: 'true',
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      'aria-hidden': 'true',
      focusable: 'false',
    }, cells);
  };
}

/**
 * 造一个入口的**坞图标组件**（`sidebar.panellist` 的占用者）。
 *
 * ═══ 字形**不拦点击** ═══
 * 用户原话：「为什么点击『按钮面板』和它左边的图标得到的东西还是不同？不对的，**这是一整个按钮，
 * 不要做成两个**，点开后就是按钮面板。」
 *
 * 平台渲染的是**一个** `<button class=panelRow>`（`dsh-client-ui-sidebar` 的 `PanelRow`），我们的字形与
 * 平台自己渲染的 label 都是它的子节点；这一行**只有**一个动作：`layout.selectPanel(id)`。
 * 字形只负责**画自己**与**记自己的屏幕矩形**（浮出面板要贴着这一行长出来），点击由平台那一行统一派发
 * —— 给坞自己那一颗挂 `onActivate`（`stopPropagation` + 直接开面板）会让同一行的两半落到两个地方。
 *
 * @param {object} react 种子 react
 * @param {object} primitives `createPrimitivesSeat(seeds.primitives)` 的产物
 * @param {object} options
 * @param {string} options.id 入口 id（同时用于 `data-guif-glyph`，锚点记录也按它索引）
 * @param {unknown} options.label 入口 label（字符串或 thunk；只用于兜底字形）
 * @param {unknown} [options.icon] 入口图标（函数组件 / 元素 / null）
 * @param {() => (unknown)} [options.readBadge] **每次渲染都重新读**角标（坞的 store 是唯一真源）
 * @returns {Function} 组件：`(ownerProps: {size?:number, active?:boolean}) => element`
 */
function createEntryGlyph(react, primitives, options) {
  const el = react.createElement;
  const id = String(options.id);
  const icon = options.icon ?? null;
  const readBadge = typeof options.readBadge === 'function' ? options.readBadge : () => null;
  /**
   * 每个入口都记矩形：面板要贴着触发它的那一行长出来，而「点文字 / 按回车」那条路径没有事件对象
   * （`event === null`）⇒ 由字形自己在挂载时量一次。**只读我们自己渲染的节点**，不碰官方 DOM。
   * ⚠ 用 **ref 回调**而不是 `useRef + useEffect`：这个图标会被「直接当函数调用」的测试装置渲染
   *   （那类调用里调 hook 会抛 `Invalid hook call`），ref 回调在两处都只是普通 prop，最稳。
   */
  const captureRef = {
    ref: (node) => {
      if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') {
        recordEntryAnchor(id, null);
        return;
      }
      try {
        recordEntryAnchor(id, node.getBoundingClientRect());
      } catch {
        recordEntryAnchor(id, null);
      }
    },
  };
  return function GuiFrameEntryGlyph(ownerProps) {
    const props = ownerProps ?? {};
    const badge = normalizeBadge(readBadge());
    const mark = icon === null || icon === undefined
      ? el('span', { [GLYPH_MARK_ATTR]: id, style: { lineHeight: 1 } }, initialOf(options.label))
      : (typeof icon === 'function' || typeof icon === 'object' && icon !== null && icon.$$typeof !== undefined
        ? el(icon, { size: props.size ?? 18 })
        : icon);
    return el('span', {
      [GLYPH_ATTR]: id,
      'data-guif-active': String(props.active === true),
      ...captureRef,
      style: glyphStyle(props.size),
    }, mark, badge === null ? null : el('span', {
      [BADGE_ATTR]: id,
      'data-guif-badge-tone': badge.tone ?? 'neutral',
      style: badgeStyle(badge.tone),
    }, badge.text));
  };
}
  return { BADGE_ATTR: BADGE_ATTR, GLYPH_ATTR: GLYPH_ATTR, GLYPH_MARK_ATTR: GLYPH_MARK_ATTR, BADGE_MAX: BADGE_MAX, normalizeBadge: normalizeBadge, resolveEntryLabel: resolveEntryLabel, DOCK_ICON_ATTR: DOCK_ICON_ATTR, recordEntryAnchor: recordEntryAnchor, readEntryAnchor: readEntryAnchor, createDockIcon: createDockIcon, createEntryGlyph: createEntryGlyph };
}());
__esMod["./kit/store.mjs"] = (function () {
/**
 * store.mjs —— 坞/面板的**快照数据源**：优先用官方 `dsh-client-store` 种子，缺席时退到自研等价物。
 *
 * 官方形状（本机 0.2.0-rc.2 实读外壳产物偏移 ≈199 450 的 `createSnapshotStore`）：
 *   `createSnapshotStore(initial, options?) → { getSnapshot(), subscribe(cb), update(mutator), set(value) }`
 * —— 与 `ui-sidebar` 内部做法一致（它把 `createSnapshotStore([])` 交给 `ctx.slots.provideRoot({hooks})`，
 * 组件侧则以 `usePanels(selector)` 读）。GUIFrame 的坞是**本插件自己的**数据源，所以直接把它当普通
 * store 用：组件用 `useDockSnapshot(store, selector)` 订阅（本文件的 `createStoreHook`）。
 *
 * 为什么要有自己的 hook 而不是 `provideRoot({hooks})`：`provideRoot` 的 hook 名**必须全局唯一**且属
 * root 标准座位（`useResource/useWorkspaces/usePanelInfo/useSessions/…`）——本插件往那里塞名字会与
 * 官方/第三方撞名（「名字全局唯一」约束）。自己造 hook 只需 `react.useState/useEffect`，
 * 在真 React 与无 DOM 替身上都能跑。
 *
 * 本文件**零副作用**：只在被调用时造对象。
 */

/**
 * 造一个快照 store。
 * @param {object|undefined|null} seeds 种子表（`seeds.store.createSnapshotStore` 优先）
 * @param {unknown} initial 初始快照
 * @returns {{getSnapshot:()=>unknown, subscribe:(cb:Function)=>()=>void, set:(value:unknown)=>void, update:(fn:Function)=>void}}
 */
function createSnapshotStore(seeds, initial) {
  const seed = seeds !== null && typeof seeds === 'object' ? seeds.store : null;
  const factory = seed !== null && typeof seed === 'object' ? seed.createSnapshotStore : null;
  if (typeof factory === 'function') {
    const official = factory(initial);
    if (official !== null && typeof official === 'object' && typeof official.getSnapshot === 'function' && typeof official.subscribe === 'function') {
      return official;
    }
  }
  return createMinimalStore(initial);
}

/**
 * 自研最小等价物（**只**在官方种子缺席时使用）。
 * 语义与官方一致：`set` 整体替换、`update` 走 mutator、`subscribe` 返回取消函数。
 */
function createMinimalStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot() {
      return value;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // 订阅者抛错不连坐其他人（与官方 notifySubscribers 的隔离口径一致）
        }
      }
    },
    update(mutator) {
      if (typeof mutator !== 'function') return;
      mutator(this);
    },
  };
}

/**
 * 造一个「订阅 store 的 hook」（用种子 react 的 useState/useEffect；不依赖 React 18+ 的 uSES）。
 * @param {object} react 种子 react
 * @returns {Function} `useSnapshot(store, selector?)`
 */
function createStoreHook(react) {
  return function useSnapshot(store, selector) {
    const read = typeof selector === 'function' ? selector : identity;
    const [value, setValue] = react.useState(() => read(store.getSnapshot()));
    react.useEffect(() => {
      const off = store.subscribe(() => {
        setValue(read(store.getSnapshot()));
      });
      return typeof off === 'function' ? off : undefined;
    }, [store]);
    return value;
  };
}

function identity(value) {
  return value;
}
  return { createSnapshotStore: createSnapshotStore, createMinimalStore: createMinimalStore, createStoreHook: createStoreHook };
}());
__esMod["./dock/panel-styles.mjs"] = (function () {
/**
 * panel-styles.mjs —— **坞面板的行样式表**（用户指令：
 * 「按钮面板里的按钮样式太丑了，你看看 DSH 上侧边栏的按钮实现呢？……按钮容器背景实现要和 DSH 原版的设计风格统一」）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么要有这张表，而不是全写内联样式】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * DSH 侧栏那一行的观感有一半在**伪类**上（`:hover` 背景、`:focus-visible` 轮廓）——
 * 内联 style 表达不了。所以：**内联样式给基线外观**（不依赖任何能力），
 * **这张表补伪类与「中和注册方控件外壳」**（`[data-guif-dock-action] button{…}`）。
 * 装配期由主题能力注入：`service.__slice('theme').installStyles(ctx, {css, id})`，标签
 * `<style data-guif-theme="gui-frame-dock-panel">`（`theme/styles.mjs` 的 `installStyleSheet`）。
 *
 * ⚠ **内联优先于样式表** ⇒ `:hover` / `:disabled` / 激活态这几条必须带 `!important`，否则状态永远换不过来
 *   （真机实测：真鼠标压上去背景仍是 `rgba(0,0,0,0)`）。两份样式都是本包自己的代码，
 *   工具在受控面内。
 *
 * ⚠ **第三方注册方控件的「悬停底色」也归本表管**（用户指令：「把鼠标移动到文字上，
 *   出现的白色背景删掉」）：注册方自己的 `.sq-btn:hover{background:var(--dsw-alias-bg-layer-2)}`
 *   特异性高过本表那条不带 `!important` 的外壳中和 ⇒ 浅色主题下 `#fff` 白块盖住整行。
 *   现在 `:is(:hover,:active,:focus,:focus-visible)` 一律 `background-color:transparent!important`
 *   （角标除外）。**代价**：注册方控件有意画的「悬停底色」也会被抹掉 —— 与 DSH 侧栏
 *   「整行一个悬停面」的语义一致，这是用户拍板的方向；它**只覆盖悬停/焦点/激活三态**，
 *   **不动**控件在静止态自己画的底色（那一层仍只做基线归一、不带 `!important`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【逐值照抄 DSH 侧栏的 `.hHd-Xa_panelRow`】（实读 `dsh-client-ui-sidebar/lib/client.js` 的 CSS 段）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ```css
 * .panelRow{box-sizing:border-box;width:100%;min-height:36px;color:var(--dsw-alias-label-secondary);
 *   font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;
 *   align-items:center;gap:8px;padding:7px 8px;line-height:22px;display:flex}
 * .panelRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
 * .panelRow.panelActive{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
 * .panelRow:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}
 * .panelGlyph{flex:none;justify-content:center;align-items:center;display:inline-flex}
 * .panelTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
 * ```
 * 本表把 `.panelRow` 换成**我们自己的锚点** `[data-guif-dock-action]`，取值一字未改；
 * 颜色**只走白名单 `--dsw-*`**（`kit/tokens.mjs` 的 `DSW_TOKENS`，`check:tokens` 硬门禁照过）。
 *
 * ⚠ 两个**没进白名单**的 DSH token 故意不用：外壳的 `.newSession` 用 `--dsw-alias-button-elevated-fill` /
 *   `--dsw-alias-button-floating-hover`，而它们不在本包探针取证表里（`probe/evidence/p4-theme-tokens.json`）
 *   ⇒ 用了会在运行期被 token 闸门判成悬空。等价观感改用 `--dsw-alias-bg-layer-2` + `--dsw-alias-interactive-bg-hover`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【「悬停背景没了」＝ 这张表**不在文档里**，而旧注入器不认账】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 真机取证（隔离实例 + headless CDP）：
 *   · 常态：四行（SafelyQuit / AbsentMode / ButtonMigration×2）悬停底色都是 `rgba(38,49,72,.06)`；
 *   · 把 `<style data-guif-theme="gui-frame-dock-panel">` **摘掉** ⇒ 行的几何/字色照旧（内联基线在），
 *     但悬停底色变 `rgba(0,0,0,0)`、焦点轮廓与激活态一并消失 —— **与用户报的那一幕逐项一致**；
 *   · 再**关掉面板重开** ⇒ 样式表**没回来**（`styleTagBack:false`）。旧注入器只记一个布尔
 *     「我注入过」，谁都问不出「它现在到底在不在」。⇒ 只有整页刷新能救。
 * 修法（本文件下半部分）：判据换成**问 DOM**（`panelStylesPresent`）+ 注入后**当场复验**
 *   + 成功后在 `document.head` 上**值守**（`MutationObserver`，摘了就补、补不回来就停手）。
 *   三条都只在**样式表层**，行内基线一字未动 ⇒ 主题能力缺席时的降级不受影响。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【「把外观接口做丰富」：行外观开成**一族公开变量**】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 用户原话：「外部可以通过接口自定义按钮（包括悬停时）底色吗？」→ 查证结论是**接口层没有**任何样式字段
 * （entry 字段表无样式项、公开命名空间里没有 theme），而**样式层**只有外壳 token 可改（会连带别处）。
 * 裁定：「在接口上做得稍微丰富点吧」⇒ 本表四条状态取值全部改走 `--guif-dock-row-*`（缺省＝原值）：
 *   `-bg`（静止，内联基线里）`-bg-hover` `-bg-active` `-fg`（内联基线）`-fg-active` `-focus-ring`。
 * ⚠ **不是可变项的两个几何值 ＝ 美学秩序的不变量**（「改行圆角和行间距会影响面板的美学秩序，
 *   所以不要。」）⇒ **圆角**与**行距**保持**字面量**（与 DSH 侧栏 `.panelRow` /
 *   `.panelList` 逐值同源），`tests/unit/dock-style-vars.test.mjs` 盯着它们不许变成变量 ——
 *   改成变量会先判红，逼人先想清楚该不该动美学秩序。
 * ⚠ **只取用、不声明**：名字一律出现在 `var(...)` 的值位。谁在元素上把 `--guif-*` 声明成内联自定义属性，
 *   谁就把祖先给的覆盖值**挡死**（自定义属性走继承，元素自己的声明恒胜）
 *   （`panel/components.mjs` 有同款注释）。
 */

/** 样式标签的归属 id（`<style data-guif-theme="…">`；真机断言用它找自己的样式）。 */
const PANEL_STYLE_ID = 'gui-frame-dock-panel';

/**
 * 样式标签的**归属属性名**（`theme/styles.mjs` 的 `GUIF_STYLE_ATTRIBUTE`）。
 * 这里逐字写一遍而不是 import 它：本模块取主题切片只走服务面切片（`__slice('theme')`），不新增能力域直连。
 */
const PANEL_STYLE_ATTRIBUTE = 'data-guif-theme';

/** 当前文档（没有 DOM ⇒ `null`；`document` 这个标识符本身也可能不存在，取值也要兜）。 */
function currentDocument() {
  try {
    return typeof document === 'undefined' ? null : document;
  } catch {
    return null;
  }
}

/** 面板行样式表（字符串常量：本模块零副作用，注入由调用方做）。 */
const PANEL_CSS = [
  /* 列表容器：DSH 侧栏 `.panelList` 同款（纵向 + 4px 间距；行距有意不开变量 —— 见文件头） */
  '[data-guif-dock-actions]{display:flex;flex-direction:column;gap:4px}',
  /* ── 行本体：`.panelRow` 逐值 ─────────────────────────────────────────────
     ⚠ 状态类声明带 `!important`：**内联基线优先于样式表**（行上内联写了 `background`/`color`），
       不带它就等于 `:hover` 永远不生效（真机实测：真鼠标压上去背景仍是 `rgba(0,0,0,0)`，
       而原生那一行是 `rgba(38,49,72,.06)`）。这两份样式**都是本包自己的代码**，工具在受控面内。
     ★ 本表四条状态取值走**公开变量**（`var(--guif-dock-row-*, 原值)`），
       接入方在任意祖先上定义即生效 —— 缺省即现状，没人覆盖时观感零变化。 */
  '[data-guif-dock-action]{box-sizing:border-box;width:100%;min-height:36px;color:var(--guif-dock-row-fg, var(--guif-panel-fg, var(--dsw-alias-label-secondary)));font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:7px 8px;line-height:22px;display:flex}',
  '[data-guif-dock-action]:hover{background:var(--guif-dock-row-bg-hover, var(--dsw-alias-interactive-bg-hover))!important}',
  '[data-guif-dock-action]:focus-visible{outline:2px solid var(--guif-dock-row-focus-ring, var(--dsw-alias-label-primary));outline-offset:-2px}',
  '[data-guif-dock-action][data-guif-dock-row-active="true"]{background:var(--guif-dock-row-bg-active, var(--dsw-alias-interactive-bg-active))!important;color:var(--guif-dock-row-fg-active, var(--dsw-alias-label-primary))!important;font-weight:500!important}',
  /* ── 行内：角标（`.panelGlyph` 同款那一条已随图标槽一起删掉：行里只有一个图标，
        由注册方的控件自己画 —— 见 `panel-content.mjs` 的第四次翻面） ──────────────────── */
  '[data-guif-dock-action] [data-guif-badge]{flex:none;margin-left:auto}',
  /* ── ★ 中和注册方控件的**外壳**：插件自己的按钮/开关进坞后不再自带边框底色，
        与 DSH 行内内容同款（否则面板里就是一堆风格各异的小盒子）。文字与字号一并归一。 ── */
  '[data-guif-dock-action] button{background:0 0;border:none;padding:0;margin:0;color:inherit;font:inherit;line-height:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;text-align:left;min-width:0}',
  '[data-guif-dock-action] span{color:inherit;font:inherit}',
  /* ── ★ **行内任何元素都不许在悬停/激活/焦点时自己冒底色**（用户指令：
        「把鼠标移动到文字上，出现的白色背景删掉」）。
        为什么必须 `!important` + 覆盖伪类：注册方自己的 `.sq-btn:hover{background:var(--dsw-alias-bg-layer-2)}`
        特异性 (0,2,0) 高过上面那条 (0,1,1)，而浅色主题里 `--dsw-alias-bg-layer-2`
        ＝ `var(--dsw-static-neutral-bluish-00)` ＝ **#fff** ⇒ 真机实测内层按钮悬停背景 `rgb(255,255,255)`，
        一个**纯白块**盖在行的悬停底色（`rgba(38,49,72,.06)`）上。DSH 侧栏那一行的语义是
        **整行一个悬停面**（`.panelRow:hover` 画底色，字形与标题都不画）—— 注册方控件进坞后照此办理。
        `:not([data-guif-badge])` 把**坞自绘的角标**摘出去（角标本身就有底色，不该被清成透明）。 ── */
  '[data-guif-dock-action] :is(:hover,:active,:focus,:focus-visible):not([data-guif-badge]){background-color:transparent!important}',
  /* 空态：DSH 的 caption 文本（旧版用 opacity:.65 压暗，那是临时手法） */
  '[data-guif-dock-hint]{color:var(--dsw-alias-label-caption);line-height:1.6;padding:2px 8px}',
  /* ── 管理页（工作台那一格）的自检入口：DSH 次级按钮观感（`.newSession` 的等价取值） ──
     同上：内联 `BUTTON_STYLE` 写了 `background`/`color` ⇒ 悬停/禁用两态要 `!important` 才压得住。 */
  '[data-guif-launcher]{box-sizing:border-box;height:38px;padding:8px 16px;gap:6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
  '[data-guif-launcher]:hover{background:var(--dsw-alias-interactive-bg-hover)!important}',
  '[data-guif-launcher]:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}',
  '[data-guif-launcher]:disabled{cursor:default;color:var(--dsw-alias-label-caption)!important;background:0 0!important}',
  '',
].join('\n');

/**
 * 把样式表交给主题能力注入（**不判重**：theme 侧不按 id 去重，幂等守在调用侧 —— 见 `createPanelStylesInstaller`）。
 * 走**服务面切片**（`service.__slice('theme')`）而不是 import theme 模块 ⇒ 不新增能力域直连。
 *
 * ⚠ **不是 `service.theme`**：主题能力在服务面上**没有**同名属性，取法是 `__slice('theme')`
 *   （`contracts/service-face.mjs` 的 `CAPABILITY_SLICES.theme === 'theme'` + `SLICE_NAMES`）。
 *   按 `service.theme` 取 ⇒ 恒 `undefined` ⇒ 静默返回 false ⇒ **样式表一次都没注入**
 *   （真机实测：行的容器样式逐字段与原生一致，但 `:hover` 背景与「中和注册方外壳」全丢）。
 *
 * @param {object} service `ctx.gui-frame` 服务面实例
 * @param {object} ctx 调用方 ctx（清理挂它的 fiber）
 * @returns {boolean} 是否真的注入了（主题能力不在场 ⇒ false，观感退到内联基线）
 */
function installPanelStyles(service, ctx) {
  try {
    if (service === null || service === undefined || typeof service.__slice !== 'function') return false;
    const theme = service.__slice('theme');
    if (theme === null || theme === undefined || typeof theme.installStyles !== 'function') return false;
    theme.installStyles(ctx, { css: PANEL_CSS, id: PANEL_STYLE_ID });
    return true;
  } catch {
    return false;
  }
}

/**
 * ★★ **我们的样式表此刻是否真的在文档里**。
 *
 * 为什么需要它 —— 报告是「按钮面板悬停背景没了」，真机取证的结论是：
 *   ① 行本体的观感有一半（容器几何）在**内联基线**上 ⇒ 样式表丢了以后行**看着照旧**，
 *      只有 `:hover` / `:focus-visible` / 激活态这三层（＝样式表独有）**全丢**；
 *   ② 样式表是**挂在调用方 fiber 上的副作用**（`ctx.effect` ⇒ `installStyleSheet`）——
 *      fiber 一卸载，theme 侧就把 `<style>` 摘掉；而旧版注入器只记一个布尔「我注入过」，
 *      **摘掉之后永远不再补**（真机读数：摘掉样式表 ⇒ 悬停底色 `rgba(0,0,0,0)`；
 *      关掉面板再开，`styleTagBack:false`、悬停底色仍是 `rgba(0,0,0,0)`）。
 *      ⇒ 那就不是「观感降级」，而是**静默的永久丢**，只有整页刷新能救。
 *   ③ 判据换成**问 DOM**：在位就是到位，不在位就（重新）注入，注入完**当场复验**。
 *
 * 无 DOM（单测 / 非浏览器）⇒ `false`（那一路本来也没有「在位」可言，调用点另有兜底语义）。
 *
 * @param {object} [doc] 文档（缺省取当前 `document`；测试可注入）
 * @returns {boolean} 样式表是否在文档里
 */
function panelStylesPresent(doc = currentDocument()) {
  if (doc === null || doc === undefined || typeof doc.querySelector !== 'function') return false;
  try {
    return doc.querySelector(`style[${PANEL_STYLE_ATTRIBUTE}="${PANEL_STYLE_ID}"]`) !== null;
  } catch {
    return false;
  }
}

/**
 * 造一个**在位即幂等、丢了会补**的注入器：
 * `openDockPanel` 每次开面板、管理页每次挂载都会调 `ensure()`；样式表已经在位就不重复注入。
 *
 * ★ `resolveCtx` 收**取值函数**而不是 ctx 本体：调用侧在 `install(ctx)` 之前就造好了本注入器
 *   （`dock/core.mjs`：面板模块先建、`refs.ctx` 后填）。传 `refs.ctx` 的**快照**会捕获到 `null`
 *   ⇒ `theme.installStyles` 被 `__assertCtx` 挡下 ⇒ **样式表静默不注入**
 *   （真机实测：行的容器样式逐字段与原生一致，但 `:hover` 背景与「中和注册方外壳」全丢）。
 *   ⇒ 这里**每次调用现取**（`refs.ctx` 是共享可变对象，取值时已填好）。
 *
 * ★★ **把「记一个布尔」换成「看 DOM + 值守」**，三条真机事实：
 *   · 记布尔 ⇒ 样式表被 fiber 卸载摘掉后**永久不再补**（见 `panelStylesPresent` 的注释）；
 *   · 注入调用返回成功 ≠ 元素在文档里（`ctx.effect` 挂不上、`<head>` 取不到…都会「成功但没落地」）
 *     ⇒ 注入之后**当场复验**，验不过就不报成功、也不记「已装」；
 *   · 只补「下次开面板」不够 —— 面板可能**正开着**（用户就是盯着它悬停）⇒ 成功注入后上一个
 *     `MutationObserver` 守着 `document.head`：我们的 `<style>` 一没就补回来（面板不用重开）。
 *     补不回来（例如挂它的 ctx 已经死了）⇒ **停手**，不空转、不刷屏；下次 `ensure()` 还会再试。
 *
 * @param {object} service `ctx.gui-frame` 服务面实例
 * @param {() => object} resolveCtx 现取调用方 ctx（清理挂它的 fiber）
 * @param {(ctx:object, label:string, install:() => (() => void)|void) => (() => void)} [effectOn]
 *   坞的「在调用方 ctx 上挂一条幂等副作用」助手（`dock.mjs` 的 `effectOn`，内部就是 `ctx.effect`）。
 *   缺席 ⇒ 不值守（只保留「每次调用复验 + 按需补注入」这一半；观感仍会自愈，只是要等下一次调用）。
 * @returns {() => boolean} `ensure()`：本次调用结束时样式是否**已在位**
 */
function createPanelStylesInstaller(service, resolveCtx, effectOn) {
  const ctxOf = () => (typeof resolveCtx === 'function' ? resolveCtx() : resolveCtx);
  /** 无 DOM 环境下的旧语义（调用成功即算装过）：那里没有任何可验证的判据，也不额外报错。 */
  let blindLatch = false;
  /** 值守观察器的摘除器（`null` = 没在守）。 */
  let watchOff = null;

  function inject() {
    try {
      return installPanelStyles(service, ctxOf()) === true;
    } catch {
      return false;
    }
  }

  function stopWatch() {
    const off = watchOff;
    watchOff = null;
    if (typeof off === 'function') {
      try {
        off();
      } catch {
        /* 已经摘掉了 */
      }
    }
  }

  /** 守着 `document.head`：`<style>` 一没就补；补不回来就停手（幂等：只在没有观察器时武装）。 */
  function armWatch(doc) {
    if (watchOff !== null || typeof effectOn !== 'function') return;
    if (doc === null || doc.head === null || doc.head === undefined) return;
    if (typeof MutationObserver !== 'function') return;
    try {
      watchOff = effectOn(ctxOf(), 'gui-frame: dock panel stylesheet watch', () => {
        const observer = new MutationObserver(() => {
          if (panelStylesPresent(doc) === true) return; // 还在 ⇒ 与这次变更无关
          if (inject() === true && panelStylesPresent(doc) === true) return; // 补回来了 ⇒ 继续守着
          stopWatch();
        });
        observer.observe(doc.head, { childList: true });
        return () => {
          observer.disconnect();
        };
      });
    } catch {
      watchOff = null;
    }
  }

  return function ensurePanelStyles() {
    const doc = currentDocument();
    // ① 没有 DOM：没有可验证的判据 ⇒ 退到「调用成功即算装过」（旧语义；那里本来也注入不出东西）。
    if (doc === null) {
      if (blindLatch === true) return true;
      const ok = inject();
      if (ok === true) blindLatch = true;
      return ok;
    }
    // ② 在位 ⇒ 直接成功（并确保值守已武装）。
    if (panelStylesPresent(doc) === true) {
      armWatch(doc);
      return true;
    }
    // ③ 不在位 ⇒ 补注入 + **当场复验**（验不过就不许报成功 —— 这一条就是那次事故的闸）。
    const ok = inject();
    if (ok !== true || panelStylesPresent(doc) !== true) {
      stopWatch();
      return false;
    }
    armWatch(doc);
    return true;
  };
}
  return { PANEL_STYLE_ID: PANEL_STYLE_ID, PANEL_STYLE_ATTRIBUTE: PANEL_STYLE_ATTRIBUTE, PANEL_CSS: PANEL_CSS, installPanelStyles: installPanelStyles, panelStylesPresent: panelStylesPresent, createPanelStylesInstaller: createPanelStylesInstaller };
}());
__esMod["./dock/manage-page.mjs"] = (function () {
  var { dsw } = __esMod["./kit/tokens.mjs"];
/**
 * dock/manage-page.mjs —— **坞的管理页**（自检页 + 布局编辑器）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【它是什么 / 它不是什么】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 它是**本包自己的地盘**：自检页（本包注册且非 `action` 的入口，点了切到它那一格）+ 布局编辑器
 * （人工修改布局，可保存）。它**不是按钮面板**。
 *
 * 挂载点两处：① 工作台那一格 `main['dsh-gui-frame/workbench']`（坞在 `install()` 里与自己的入口
 * 同源同序注册）；② `createDockEntryPage` 的**降级分支**（浮层切片缺席 / 主区还不回去时停在它上面）。
 * 面板壳（`Panel`）在渲染期解析（装配序保证 panel 已装；缺席则不套壳，内容照常渲染）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【外观：照 DSH 外壳取值，而不是自己发明一套】（积极使用 DSH 本体的设计元素）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 自检入口＝**DSH 次级按钮**（`.newSession` 的等价取值：38px 高 / 12px 圆角 / 8·16 内边距 / 14px·500）。
 * 说明文字＝`--dsw-alias-label-secondary` / `--dsw-alias-label-caption` 两档文字色。
 * 旧版那套 `1px solid` + 无底色 + `opacity:.65` 压暗已全部删除 —— 那是外来控件的观感，不是 DSH 的语言。
 * 悬停 / 焦点 / 禁用三态在 `panel-styles.mjs` 的 `[data-guif-launcher]` 规则里（内联样式表达不了伪类）。
 * 颜色**只走白名单 `--dsw-*`**（`kit/tokens.mjs` 的 `DSW_TOKENS`）⇒ `check:tokens` 硬门禁照过。
 */


/**
 * 造管理页组件工厂。
 *
 * @param {object} deps 装配面 bag（与 `panels.mjs` 同一个 bag，外加 `closePanel` / `ensurePanelStyles`）
 * @returns {() => Function} `createDockManagePage` —— 每次调用得到一个页面组件
 */
function createManagePageFactory(deps) {
  const {
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, entryLabel,
    dockLabel, refresh, DOCK_ENTRY_ID, closePanel, ensurePanelStyles,
  } = deps;

  /**
   * 次级按钮的内联基线（**照 DSH 外壳的 `.newSession` 取值**：38px 高、12px 圆角、8/16 内边距、
   * 14px/500 字重；颜色走白名单 token）。悬停/焦点态在 `panel-styles.mjs` 的 `[data-guif-launcher]` 规则里。
   */
  const BUTTON_STYLE = Object.freeze({
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    height: '38px',
    padding: '8px 16px',
    borderRadius: '12px',
    border: `0.5px solid ${dsw('--dsw-alias-border-l3')}`,
    background: dsw('--dsw-alias-bg-layer-2'),
    color: dsw('--dsw-alias-label-primary'),
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '22px',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
  });
  /** 说明文字的基线色（旧版用 `opacity:.65` 压暗 —— 那是临时手法，不是 DSH 的语言）。 */
  const HINT_STYLE = Object.freeze({ color: dsw('--dsw-alias-label-secondary'), lineHeight: '1.6' });
  const CAPTION_STYLE = Object.freeze({ color: dsw('--dsw-alias-label-caption'), lineHeight: '1.6' });

  return function createDockManagePage() {
    const IconRefresh = primitives.get('IconRefreshOutlineRegular');
    const Tag = primitives.get('Tag');

    function GuiFrameDockManage(props) {
      const owner = props ?? {};
      const Panel = componentOf('Panel');
      const Toolbar = componentOf('Toolbar');
      const snapshot = useSnapshot(store, (value) => value);
      const platformLayout = refs.layout;
      const canOpen = platformLayout !== null && typeof platformLayout.selectPanel === 'function';
      const handle = refs.layoutHandle;
      const status = handle !== null && typeof handle.status === 'function' ? handle.status() : null;
      const layoutModel = status === null ? null : status.layout;
      const Editor = handle !== null && typeof handle.editor === 'function' ? handle.editor : null;
      // 行样式表（悬停/焦点 + 自检入口的次级按钮观感）：管理页挂上时按需注入一次（幂等）。
      react.useEffect(() => { ensurePanelStyles(); }, []);

      /** 打开某个入口的 `main` 面板（layout 缺席 ⇒ 返回 false，界面照常显示按钮，只是点了没反应）。 */
      function openPanel(id) {
        if (canOpen !== true) return false;
        try {
          platformLayout.selectPanel(id);
          return true;
        } catch {
          return false;
        }
      }

      /**
       * 布局里的**顺序与显隐**（模型：`{version, docks:[id…], entries:{id:{visible,group,source}}}`）。
       * `docks` 的数组顺序就是用户拖出来的顺序；不在布局里的入口排最后（新注册、还没对账进去）。
       */
      function layoutIndex(id) {
        const docks = layoutModel !== null && Array.isArray(layoutModel.docks) ? layoutModel.docks : null;
        if (docks === null) return Number.MAX_SAFE_INTEGER;
        const index = docks.indexOf(id);
        return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
      }

      /** 一颗导航按钮（`data-guif-launcher` 是机器锚点）。 */
      function launcher(id, label, hint) {
        return el('button', {
          key: `launcher:${id}`,
          type: 'button',
          'data-guif-launcher': id,
          style: BUTTON_STYLE,
          disabled: canOpen !== true,
          onClick: () => { openPanel(id); },
        }, el('span', null, label), hint === null || hint === undefined ? null : hint);
      }

      /** 一个分组（标题 + 内容）；空组不渲染，免得面板里出现空标题。 */
      function group(key, title, nodes) {
        if (nodes.length === 0) return null;
        return el('div', { key, 'data-guif-launcher-group': key, style: { margin: '4px 0 10px' } },
          el('div', { style: { ...HINT_STYLE, margin: '0 0 6px' } }, title),
          el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, nodes));
      }

      /** 入口的显示名：坞内注册的从 record 取（thunk 兜底）。 */
      function labelOf(id) {
        const row = registry.get(id);
        if (row === undefined) return id;
        return entryLabel(row.record);
      }

      const byLayoutOrder = (left, right) =>
        layoutIndex(left.id) - layoutIndex(right.id) || left.order - right.order || left.id.localeCompare(right.id);

      /**
       * 本包**自己的自检页**（`panel` 型、只占 `main` 不占侧栏行）：只出现在**坞的管理页**上，
       * **绝不进按钮面板**。
       */
      const selfRows = snapshot.entries
        .filter((row) => row.id !== DOCK_ENTRY_ID && row.kind !== 'action' && row.source === 'dsh-gui-frame')
        .sort(byLayoutOrder);

      /** 布局编辑区（人工修改布局，可保存）：**只在管理页**，不进按钮面板。 */
      const editorNode = Editor === null
        ? el('div', { key: 'editor', style: CAPTION_STYLE }, '布局编辑器不可用（layout 能力未装配或缺 react 种子）—— 按钮照常可用。')
        : el('div', { key: 'editor', 'data-guif-dock-editor': 'true' },
          el('div', { style: { ...CAPTION_STYLE, margin: '4px 0 6px' } },
            `布局编辑（拖拽换序 / 显隐 / 分组，改动自动保存）${status !== null && status.writable === false ? ' —— ⚠ 当前只读（载荷读不出来或 scope 不可写）' : ''}`),
          el(Editor, { layout: layoutModel, records: typeof service.__entries === 'function' ? service.__entries() : [] }));

      /** 管理页正文（**只出现在管理页**：自检页 + 布局编辑器）—— 它是本包自己的地盘，不是按钮面板。 */
      function manageContent() {
        return el('div', { key: 'manage-content' },
          group('self', '本包自检页', selfRows.map((row) => launcher(
            row.id,
            labelOf(row.id),
            Tag === undefined || Tag === null ? null : el(Tag, { tone: 'neutral' }, row.kind),
          ))),
          editorNode);
      }

      return el(Panel, {
        id: DOCK_ENTRY_ID,
        label: () => dockLabel(owner.t),
        t: owner.t,
        close: () => { closePanel(); },
        actions: el(Toolbar, {
          id: `${DOCK_ENTRY_ID}::toolbar`,
          t: owner.t,
          items: [
            {
              id: `${DOCK_ENTRY_ID}::refresh`,
              label: '刷新',
              icon: IconRefresh,
              onSelect: () => { refresh(refs.slots); },
            },
            {
              id: `${DOCK_ENTRY_ID}::float`,
              label: '浮出面板',
              onSelect: () => { if (typeof refs.openPanel === 'function') refs.openPanel(null); },
            },
          ],
        }),
        usePanelInfo: owner.usePanelInfo,
        useSessions: owner.useSessions,
      }, manageContent());
    }
    return GuiFrameDockManage;
  };
}
  return { createManagePageFactory: createManagePageFactory };
}());
__esMod["./dock/panels.mjs"] = (function () {
  var { createPanelStylesInstaller } = __esMod["./dock/panel-styles.mjs"];
  var { createManagePageFactory } = __esMod["./dock/manage-page.mjs"];
﻿/**
 * dock/panels.mjs —— **坞的三件面板逻辑**：
 *   · `createMainShell` —— `main` 座位的占用者（面板壳 + 插件组件）；
 *   · `createDockEntryPage` —— **坞自己入口那一页**（`main['dsh-gui-frame/dock']` 的占用者）：
 *     到达即**折回按钮面板**、把主区还给会话/工作台（用户裁定「这一整行是一个按钮」）；
 *   · `closePanel` / `openDockPanel` —— 坞**作用域**里的开/关（`install` 时就注册好，不等组件渲染：
 *     旧实现等组件渲染才赋值 ⇒ 点图标空转，机检实测）。
 * 管理页（自检页 + 布局编辑器）已搬到 `manage-page.mjs`（同域），本模块只留「入口 / 壳 / 开关」。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么入口那一页变成「折回」而不是管理页】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 用户原话：「这是一整个按钮，**不要做成两个**，点开后就是按钮面板。」
 *
 * 平台给的是**一个** `<button class=panelRow>`（内含我们的字形 + 平台渲染的 label），它的 onClick 只有
 * 一个动作：`layout.selectPanel(id)`（`dsh-client-ui-sidebar` 的 `PanelRow`，源码可查）。旧实现把这一行
 * 劈成了两半：字形自己 `stopPropagation` 后直接开浮出面板，而 label 那一半照旧走平台的 `selectPanel`
 * ⇒ 到达**管理页**。于是同一行的两半落到两个地方 —— 用户判「做成了两个」。
 *
 * 现在的口径：**整行只有一个行为** —— 平台的 `selectPanel('dsh-gui-frame/dock')`；坞把这一页做成
 * **折回页**：到达即开浮出按钮面板、随即把主区还回去（工作台开着 ⇒ 还给工作台那一格）。
 * 字形**不再拦点击**（`onActivate` 已删）⇒ 点图标 / 点文字 / 按回车三条路径**结构上就是同一条**。
 *
 * 管理页不再出现在这条路径上：它挂在工作台那一格（`main['dsh-gui-frame/workbench']`，由坞在
 * `install()` 里与自己的入口同源同序注册），浮层能力缺席时本页退化为直接渲染管理页
 * （功能不丢，见 `createDockEntryPage` 的兜底分支）。
 *
 * **入参 bag（18 个，全是本实例的活口）**：`el` / `componentOf` / `useSnapshot` / `store` / `primitives` /
 * `refs` / `service` / `react` / `registry` / `refresh` / `dockLabel` / `entryLabel` / `readDockActions` /
 * `createPanelContent` / `panelRectNear` / `readEntryAnchor` / `DOCK_ENTRY_ID` / `DOCK_LABEL_FALLBACK`。
 * `refs` 是**共享可变对象**（`openPanel` / `layout` / `layoutHandle` 由坞作用域写、这里读）⇒ 整只交接；
 * **状态（`registry` / `store` / `refs`）留在装配侧**，本模块只有行为，不留读数的第二份副本。
 *
 * 交回 7 个口子：`createMainShell` / `createDockEntryPage` / `createDockManagePage`（`dock/core.mjs` 用）
 * 与 `closePanel`（关**主区那一页**，回会话）/ `openDockPanel` / `closeDockPanel` / `isDockPanelOpen`
 * （后者三件是**「按钮面板」本身**的开/关/读，坞作用域：`refs.openPanel` 由本模块自己接上，
 *  公开面 `ctx.guiFrame.dock.open/close/isOpen` 经坞切片落到同样这三个函数上）。
 */



/**
 * ★ **「按钮面板」的浮层窗口 id**（是公开契约的一部分：`ctx.guiFrame.dock` 的三件说的就是它）。
 *
 * 形态是 `<坞入口 id>::panel` —— 与坞自己的 `main` 座位（`dsh-gui-frame/dock`）**不同一个 id**：
 * 座位是「主区那一页」，浮出的面板是叠在最上层的一扇 `family:'panel'` 窗口，两者不能共用一个 id
 * （共用了 ⇒ 平台的 `selectPanel(同值)` 不产生状态变化，折回页根本不挂载；这条踩过）。
 *
 * ⚠ 导出的理由不是「测试方便」：`close` / `isOpen` 必须按**同一个字面量**找这扇窗，写在两处就会分叉。
 */
const DOCK_PANEL_ID = 'dsh-gui-frame/dock::panel';

function createDockPanels(deps) {
  const {
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, refresh, dockLabel,
    entryLabel, readDockActions, createPanelContent, panelRectNear, readEntryAnchor, DOCK_ENTRY_ID,
    DOCK_LABEL_FALLBACK, effectOn,
  } = deps;
  /**
   * 「面板行样式表」**在位即幂等、丢了会补**（闸与自愈都在 `panel-styles.mjs` 的注入器里）：
   * 主题能力（theme）在场就注入，缺席就退到内联基线。为什么用服务面：`service.__slice('theme').installStyles`
   * —— 不 import theme 模块 ⇒ 不新增能力域直连。
   * ⚠ 传**取值函数**而不是 `refs.ctx` 本体：本模块在 `install(ctx)` 之前就建好，那时 `refs.ctx` 还是
   *   `null`；传快照会让样式表静默丢（真机实测，详见 `panel-styles.mjs`）。
   * ⚠ `effectOn`（内部就是 `ctx.effect`）交进去只为一件事：注入成功后在 `document.head` 上**值守**
   *   —— 样式表被 fiber 卸载摘走时，**正开着的那扇面板**也能自己恢复。
   */
  const ensurePanelStyles = createPanelStylesInstaller(service, () => refs.ctx, effectOn);
  /** 管理页（自检页 + 布局编辑器）：本包自己的地盘，挂在工作台那一格（见 `manage-page.mjs`）。 */
  const createDockManagePage = createManagePageFactory({
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, entryLabel,
    dockLabel, refresh, DOCK_ENTRY_ID, closePanel, ensurePanelStyles,
  });

  /** 造 `main` 座位的占用者：**面板壳 + 插件组件**（ownerProps 为空 ⇒ 壳自己从 hook props 取数）。 */
  function createMainShell(record) {
    function GuiFrameMainPanel(props) {
      const owner = props ?? {};
      const Panel = componentOf('Panel');
      // 面板能力缺席 ⇒ 不套壳，直接把插件组件渲染进 main（页面照常，不占位假壳）
      if (Panel === null) return el(record.Component, owner);
      return el(Panel, {
        id: record.id,
        label: record.label,
        t: owner.t,
        close: () => { closePanel(); },
        usePanelInfo: owner.usePanelInfo,
        useSessions: owner.useSessions,
      }, el(record.Component, owner));
    }
    return GuiFrameMainPanel;
  }

  /**
   * 坞**入口那一页**（`main['dsh-gui-frame/dock']` 的占用者）＝ **折回页**。
   *
   * 它自己**不渲染任何东西**（折回成功时 `null`）：到达这一页 = 用户点了侧栏那一行
   * （点图标 / 点文字 / 按回车，三条路径由平台统一派发到 `selectPanel(id)`）⇒
   *   ① 用**入口字形记的矩形**当锚点，把浮出的「按钮面板」开出来（`refs.openPanel`）；
   *   ② 随即 `selectPanel(null)` —— **平台的「回到会话」**（`ILayout.selectPanel` 的 d.ts 原文：
   *      "Select a global panel or return to the Conversation"）。会话因此留在主区，用户看不到换页。
   *
   * ═══ 这里**不能**按工作台状态去「还给工作台那一格」 ═══
   * 上一版写成「工作台开着（布局自留区 `userLayout.workbench === 'workbench'`）就折回工作台那一格」——
   * 用户随后报「现在一点按钮，会话就没了」。根因：那个自留区是**粘滞的状态位**，不代表工作台那一格
   * **此刻正显示在主区**（用户点一个会话、点别的插件的行，主区都会换成别的东西，而这个位还留着）。
   * 于是折回页把**用户正在看的会话**换成我们的管理页 —— 症状就是这么来的。
   * ⇒ 折回的目标只有一个：**会话**（`null`）。工作台要回中心列，由它自己的开关/主区去选（平台语义对所有
   *   插件那一行都一视同仁：点谁的行，主区就是谁的页）。
   *
   * ★ 折回发生在**浏览器绘制之前** ⇒ 用户看不到「主区换了一页又换回去」
   *   的闪烁（首版用 `useEffect`，那一帧是真的会画出来的）。
   *
   * 两个兜底（都不是「另一种交互」，是能力缺席时的降级）：
   *   · **浮层切片缺席**（`openPanel` 返回 false）⇒ 停在**管理页**上（自检页 + 布局编辑器照旧可用）；
   *   · **主区还不过去**（layout 不在场 / `selectPanel` 抛错）⇒ 同上，不许把用户留在空白页上。
   */
  function createDockEntryPage() {
    const ManagePage = createDockManagePage();
    /**
     * 折回发生在**浏览器绘制之前**（`useLayoutEffect`）⇒ 用户看不到「主区换了一页又换回去」的闪烁。
     * 测试面的假 react 只有 `useEffect` ⇒ 退到它（语义仍对：那一帧折回，只是绘制之后）。
     */
    const useFoldEffect = typeof react.useLayoutEffect === 'function' ? react.useLayoutEffect : react.useEffect;
    function GuiFrameDockEntry(props) {
      const owner = props ?? {};
      const [fallback, setFallback] = react.useState(false);
      const done = react.useRef(false);
      useFoldEffect(() => {
        if (done.current === true) return; // 折回只做一次（重渲染不再动主区）
        done.current = true;
        const opened = typeof refs.openPanel === 'function' ? refs.openPanel(readEntryAnchor(DOCK_ENTRY_ID)) : false;
        if (opened !== true) {
          setFallback(true); // 面板开不出来 ⇒ 停在管理页，功能不丢
          return;
        }
        const layout = refs.layout;
        if (layout === null || layout === undefined || typeof layout.selectPanel !== 'function') {
          setFallback(true);
          return;
        }
        try {
          layout.selectPanel(null); // 平台的「回到会话」：会话留在主区（不许按工作台状态换成别的页）
        } catch {
          setFallback(true);
        }
      }, []);
      return fallback === true ? el(ManagePage, owner) : null;
    }
    return GuiFrameDockEntry;
  }

  /**
   * 关闭当前面板（回到会话）：`ctx.layout.selectPanel(null)`；layout 缺席/抛错都只当「没关成」。
   */
  function closePanel() {
    const layout = refs.layout;
    if (layout === null || typeof layout.selectPanel !== 'function') return false;
    try {
      layout.selectPanel(null);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ★ **打开按钮面板**（坞作用域：`install` 时就注册好，不等任何组件渲染）。
   *
   * 形态：`family: 'panel'` ⇒ 渲染 `overlay/panel.mjs` 的 OverlayPanel
   * （面板基类：不透明表面 + 固定头 + 单一滚动体；**不是**悬浮窗），锚点＝触发它的那颗按钮；
   * 内容：**只有外部插件交进来的 `kind:'action'` 按钮**。
   *
   * @param {{left?:number, top?:number, right?:number, width?:number}|null} anchorRect 触发它的按钮的屏幕矩形
   * @returns {boolean} 面板是否真的打开了（overlay 切片缺席 ⇒ false，调用方据此决定要不要退回管理页）
   */
  function openDockPanel(anchorRect) {
    try {
      const overlay = service === null ? null : service.overlay;
      if (overlay === null || overlay === undefined || typeof overlay.open !== 'function') return false;
      ensurePanelStyles(); // 行样式表（伪类 + 中和注册方外壳）在开面板时按需注入
      const rows = readDockActions(registry, refs.layoutHandle);
      overlay.open({
        id: DOCK_PANEL_ID,
        family: 'panel',
        title: DOCK_LABEL_FALLBACK,
        initialRect: panelRectNear(anchorRect ?? readEntryAnchor(DOCK_ENTRY_ID)),
        content: createPanelContent(el, rows),
      });
      return true;
    } catch {
      return false;
    }
  }
  // 坞一装上就能用（旧实现等面板组件渲染才赋值 ⇒ 点图标空转）。
  refs.openPanel = openDockPanel;

  /**
   * ★ **关掉「按钮面板」**（`ctx.guiFrame.dock.close()` 落到这里）。
   *
   * 与 `closePanel` **不是一件事**：那个关的是**主区那一页**（`selectPanel(null)` ＝ 回会话），
   * 这个关的是叠在最上层的那扇浮出面板（同一扇窗）。
   *
   * 语义：**幂等** —— 不在场 / 浮层能力缺席 / 坞自己就是在场者之外 ⇒ 一律 `false`（不抛）。
   * 层栈的 `remove` 只认 id，所以「谁开的都能关」是有意的：这是共享 UI 的一扇窗（详见 DockFace 注释）。
   *
   * @returns {boolean} 关之前它是否在场
   */
  function closeDockPanel() {
    try {
      const overlay = service === null ? null : service.overlay;
      if (overlay === null || overlay === undefined || typeof overlay.close !== 'function') return false;
      return overlay.close(DOCK_PANEL_ID) === true;
    } catch {
      return false;
    }
  }

  /**
   * ★ **面板此刻是否在场**（`ctx.guiFrame.dock.isOpen()` 落到这里）。
   *
   * 为什么要有它：光有 open/close 的返回值不够 —— 用户随时能用头部 × / Esc / 点外把它关掉，
   * 那三条路都不经过我们（层栈自己 `remove`）。⇒ 唯一诚实的读法是**问层栈**：
   * `overlay` 切片的 `has(id)`（`stack.get(id) !== null`）。
   *
   * 拿不到浮层切片 / 老切片没有 `has` ⇒ `false`（没有一层「我们说它在、屏幕上看不见」的第二份状态）。
   *
   * @returns {boolean}
   */
  function isDockPanelOpen() {
    try {
      const slice = service !== null && typeof service.__slice === 'function' ? service.__slice('overlay') : undefined;
      if (slice === undefined || slice === null || typeof slice.has !== 'function') return false;
      return slice.has(refs.ctx, DOCK_PANEL_ID) === true;
    } catch {
      return false;
    }
  }

  // 交回装配面：三件页面工厂 + 主区开关 + 「按钮面板」自己的开/关/读三件。
  return { createMainShell, createDockEntryPage, createDockManagePage, closePanel, openDockPanel, closeDockPanel, isDockPanelOpen };
}
  return { DOCK_PANEL_ID: DOCK_PANEL_ID, createDockPanels: createDockPanels };
}());
__esMod["./dock/panel-api.mjs"] = (function () {
/**
 * dock/panel-api.mjs —— **「按钮面板」的坞切片三件套**（公开面 `ctx.guiFrame.dock.open/close/isOpen`）。
 *
 * 为什么单独一件（与 `store-face.mjs` / `panel-content.mjs` 同一手法）：`dock/core.mjs` 已顶到
 * 320 行上限 —— 这三段的**契约说明比实现长得多**，塞回 core 只会把注释挤掉或把文件挤破。
 *
 * ═══ 三件的语义（真源在 `service/faces.mjs` 的 `DockFace`；这里只说落点）═══
 *   · `open(anchor)`：坞作用域那个 `openDockPanel` —— 与「点侧栏那一行」**同一扇**窗
 *     （同一个 `DOCK_PANEL_ID`、同一份正文、同一套锚点规则）；`anchor` 缺省/`null` ⇒ 用入口字形记的矩形；
 *   · `close()`：`closeDockPanel` —— **幂等**，返回「关之前它是否在场」；
 *   · `isOpen()`：`isDockPanelOpen` —— 读**层栈**（用户按 Esc / 点外关掉的也算数），不另记状态位。
 *
 * ⚠ 三件**都不收调用方 ctx**：面板是**插件整体**的共享 UI，不往调用方 fiber 挂任何东西
 *   （对照 `onEntry` / `setBadge` 那几件收 callerCtx 是因为它们要把座位挂到注册方的 fiber 上）。
 *
 * @param {{openDockPanel:Function, closeDockPanel:Function, isDockPanelOpen:Function}} deps 坞作用域的三个函数
 * @returns {{open:Function, close:Function, isOpen:Function}} 直接摊进坞切片面（`service.__slice('dock')`）
 */
function createDockPanelApi(deps) {
  const { openDockPanel, closeDockPanel, isDockPanelOpen } = deps;
  return {
    open(anchor) {
      return openDockPanel(anchor ?? null) === true;
    },
    close() {
      return closeDockPanel() === true;
    },
    isOpen() {
      return isDockPanelOpen() === true;
    },
  };
}
  return { createDockPanelApi: createDockPanelApi };
}());
__esMod["./dock/store-face.mjs"] = (function () {
/**
 * dock/store-face.mjs —— **坞的实时读数 → store 的快照面**（从 `dock.mjs` 原样搬出，函数体一字未动）。
 *
 *   · `live(slots)` —— 读实时座位状态（**唯一**入口：`slots.entries(key)` + `slots.entriesOfSlot(key)`）；
 *   · `refresh(slots)` —— 把坞的状态刷进 store（组件订阅它；**每次刷新都重新读一次实时座位**）。
 *
 * **入参 bag（6 个）**：`refs`（装配期捕获的 ctx/slots/layout/layoutHandle/openPanel）/
 * `registry`（坞自己的入口环）/
 * `store`（快照仓库）/ `rank`（排序键）/ `MAIN_SLOT` / `PANELLIST_SLOT`。
 * 前三个是**坞作用域的状态**（由装配侧持有）⇒ 整只交接；本模块不复制任何一份读数。
 * 交回 1 个口子：`refresh`（坞的刷新入口；`api.refreshNow` 与座位订阅都走它）。
 */
function createDockStoreFace(deps) {
  const { refs, registry, store, rank, MAIN_SLOT, PANELLIST_SLOT } = deps;
  /** 读实时座位状态（**唯一**入口：`slots.entries(key)` + `slots.entriesOfSlot(key)`）。 */
  function live(slots) {
    const handle = slots ?? refs.slots;
    if (handle === null || typeof handle !== 'object' || typeof handle.entries !== 'function') {
      return { panellist: [], main: [], winners: [] };
    }
    const winners = typeof handle.entriesOfSlot === 'function' ? (handle.entriesOfSlot(MAIN_SLOT) ?? []) : [];
    return {
      panellist: [...(handle.entries(PANELLIST_SLOT) ?? [])],
      main: [...(handle.entries(MAIN_SLOT) ?? [])],
      winners: [...winners],
    };
  }

  /** 把坞的状态刷进 store（组件订阅它；**每次刷新都重新读一次实时座位**）。 */
  function refresh(slots) {
    const snapshot = live(slots);
    const optionsOf = (rows) => rows.map((entry) => entry?.options ?? null).filter((options) => options !== null);
    store.set({
      ready: true,
      entries: [...registry.values()]
        .map((row) => ({
          id: row.record.id,
          kind: row.record.kind,
          order: rank(row.record.order),
          source: row.record.source,
          badge: row.badge ?? null,
          paired: row.paired === true,
          sidebar: row.sidebar === true,
        }))
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
      panellist: optionsOf(snapshot.panellist),
      main: optionsOf(snapshot.main),
    });
    return store.getSnapshot();
  }

  /** 交回装配面：`live`（`api.__live` 诊断面）与 `refresh`（`api.refreshNow` 与两个座位订阅都走它）。 */
  return { live, refresh };
}
  return { createDockStoreFace: createDockStoreFace };
}());
__esMod["./dock/core.mjs"] = (function () {
  var { createPrimitivesSeat } = __esMod["./kit/primitives.mjs"];
  var { createEntryGlyph, createDockIcon, readEntryAnchor } = __esMod["./kit/entry-icons.mjs"];
  var { createSnapshotStore, createStoreHook } = __esMod["./kit/store.mjs"];
  var { probeService } = __esMod["./kit/probe.mjs"];
  var { createDockPanels } = __esMod["./dock/panels.mjs"];
  var { createDockPanelApi } = __esMod["./dock/panel-api.mjs"];
  var { createDockStoreFace } = __esMod["./dock/store-face.mjs"];
/**
 * dock/core.mjs —— **坞实例的装配核心**。
 *
 * 坞作用域的状态全在这里：`registry`（入口环）/ `refs`（装配期捕获的 ctx/slots/layout/layoutHandle/openPanel）
 * / `store`（快照仓库）/ `api`（切片面）/ `dock`（句柄面）。**状态随组搬走** —— `dock.mjs` 只留常量、
 * 几何、纯 helper 与 `install` 装配入口，经 bag 把这些交进来（不是两边各写一半）。
 *
 * **入参 bag（6 项）**：`env`（装配 options bag，原样交进来）/ `consts`（DOCK_SLICE_NAME / DOCK_ENTRY_ID /
 * PANELLIST_SLOT / MAIN_SLOT / DOCK_LABEL_FALLBACK）/ `geometry`（panelRectNear / anchorRectOf / assertEntryId）
 * / `helpers`（effectOn / dockLabel / entryLabel / rank / isInternalEntry）/ `readDockActions` /
 * `createPanelContent`。同域子模块（`./panels.mjs` / `./store-face.mjs`）与 kit 共享叶直接 import，不经 bag。
 *
 * 交回 1 个口子：`createDock(env)` 的返回值（坞句柄 `dock`，`install` 拿它去挂切片与入口）。
 */








function createDockCore(deps) {
  const { env, consts, geometry, helpers, readDockActions, createPanelContent } = deps;
  const { DOCK_SLICE_NAME, DOCK_ENTRY_ID, PANELLIST_SLOT, MAIN_SLOT, DOCK_LABEL_FALLBACK, WORKBENCH_PANEL_ID } = consts;
  const { panelRectNear, assertEntryId } = geometry;
  const { effectOn, dockLabel, entryLabel, rank, isInternalEntry } = helpers;
  const bag = env !== null && typeof env === 'object' ? env : {};
  const seeds = bag.seeds !== null && typeof bag.seeds === 'object' ? bag.seeds : {};
  const react = seeds.react;
  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
    throw new Error('[gui-frame] createDock(env) 需要 env.seeds.react（坞图标是 React 组件）');
  }
  const service = bag.service ?? null;
  /** 官方原子座位（字形/角标自绘要用它）：**经 kit 共享叶**取工厂，缺席时调用点退到自研等价物。 */
  const primitives = createPrimitivesSeat(seeds.primitives);
  /**
   * 面板壳组件（Panel / Toolbar）：**渲染期经服务面组件表取**（坞只交数据与锚点）。
   * 装配序 dock → theme → panel → overlay 保证「渲染时面板能力已在册」；
   * 面板能力没装上 ⇒ 返回 null，调用点退化为「不套壳但照常渲染」（可用但不装不起）。
   */
  const componentOf = (name) => {
    try {
      const face = service === null || service === undefined ? null : service.components;
      const found = face !== null && typeof face.get === 'function' ? face.get(name) : undefined;
      return typeof found === 'function' ? found : null;
    } catch {
      return null;
    }
  };
  const useSnapshot = createStoreHook(react);
  const store = createSnapshotStore(seeds, { ready: false, entries: [], panellist: [], main: [] });
  const el = react.createElement;
  /** 坞自己的入口环（**不进** slot 注册选项）：`{record, badge, icon, paired, dispose}`。 */
  const registry = new Map();
  /**
   * 装配期捕获：caller ctx / slots 服务 / 面板 layout（软探测，缺了就降级）/ 本包 layout 能力句柄
   * / `openPanel`（坞作用域打开函数）。
   */
  const refs = { ctx: null, slots: null, layout: null, layoutHandle: null, openPanel: null };

  // ── 实时读数 → store（`live`/`refresh` 在 `./dock/store-face.mjs`）──
  //    `registry`/`store`/`refs` 三样本侧的状态**整只交接**（不是两边各写一半），交回的口子只有 `refresh`。
  const storeFace = createDockStoreFace({ refs, registry, store, rank, MAIN_SLOT, PANELLIST_SLOT });
  const { live, refresh } = storeFace;

  // ── 坞的四件面板逻辑（在 `./dock/panels.mjs`）──────────
  //    `refs` 是共享可变对象（`openPanel`/`layout`/`layoutHandle` 由坞作用域写、面板侧读）⇒ 整只交接；
  //    `registry`/`store`/`refs` 这三样状态**留在本侧**，面板模块只有行为、不留读数的第二份副本。
  const panels = createDockPanels({
    el, componentOf, useSnapshot, store, primitives, refs, service, react, registry, refresh, dockLabel,
    entryLabel, readDockActions, createPanelContent, panelRectNear, readEntryAnchor, DOCK_ENTRY_ID,
    DOCK_LABEL_FALLBACK, effectOn, // ★ 行样式表被摘走时要能自愈（值守观察器经它挂在调用方 ctx 上）
  });
  const { createMainShell, createDockEntryPage, createDockManagePage, closePanel, openDockPanel, closeDockPanel, isDockPanelOpen } = panels;
  /**
   * 成对注册一个入口（`panel` 型）：**同步**完成两次 `slots.inject`，返回幂等 disposer。
   * `label` 恒为 **thunk**：owner（sidebar）在 locale 变化时会**再次调用**它取新文案。
   *
   * `options.sidebar === false`：**只占 `main`，不占侧栏那一行**。
   * 这是「一个按钮 + 按钮面板」的形状所要求的 —— 本包自己贡献的附加页（坞的管理页）不该
   * 再往侧栏挤一行；它的入口由坞的**总览面板**（`createDockOverview`）给一颗按钮，
   * 点了照样 `selectPanel(id)` 打得开。判据：侧栏 `sidebar.panellist` 里本包只留一条。
   */
  function pairEntry(callerCtx, slots, record, icon, options) {
    assertEntryId(record.id);
    const withSidebar = options === null || options === undefined ? true : options.sidebar !== false;
    const order = Number.isInteger(record.order) ? record.order : 0;
    const label = () => entryLabel(record);
    const Shell = createMainShell(record);
    const ctx = callerCtx ?? refs.ctx;
    return effectOn(ctx, `gui-frame: dock pair ${record.id}`, () => {
      const offPanellist = withSidebar
        ? slots.inject(PANELLIST_SLOT, () => slots.register({
            name: PANELLIST_SLOT,
            id: record.id,
            order,
            label,
          }, icon))
        : () => {};
      const offMain = slots.inject(MAIN_SLOT, () => slots.register({ name: MAIN_SLOT, key: record.id }, Shell));
      return () => {
        offPanellist();
        offMain();
      };
    });
  }

  /** 坞的切片面（`service.__install('dock', api)`）；**每个方法的第一个参数都是调用方 ctx**。 */
  const api = {
    attachLayout(callerCtx, handle) {
      // 接收 **layout 能力**的句柄（由 layout 侧装配完成时推过来）。
      // ⚠ 本版没有 layout 能力 ⇒ 这条口子**没有调用方**；留着的理由是坞**先装**、能力**后装**，
      // 由后装的一侧把句柄推过来，既不动装配顺序契约，也不新增模块依赖。
      refs.layoutHandle = handle !== null && handle !== undefined && handle.installed === true ? handle : null;
      refresh(refs.slots);
      return refs.layoutHandle !== null;
    },
    /**
     * ⚠ 这里**不能**改成「工作台侧推 id 过来、由坞注册那一格」：那条晚注册的路真机实测不可靠
     * （attach 返回 true、日志无异常，平台 `renderSlot('main',
     * {}, { entryKey })` 却查不到这一格 ⇒ 工作台中心列空白）。工作台那一格必须与坞自己那一格
     * **同源同序**地在 `install()` 的同一个 effect 里注册（见下面的 `offWorkbenchMain`）。
     */
    onEntry(callerCtx, change) {
      const slots = refs.slots;
      if (slots === null) return false;
      const kind = change !== null && typeof change === 'object' ? change.type : '';
      const record = change !== null && typeof change === 'object' ? change.entry : null;
      if (record === null || typeof record !== 'object' || typeof record.id !== 'string') return false;
      if (kind === 'added') {
        const id = assertEntryId(record.id);
        if (registry.has(id)) return false;
        // `badge` / `icon` 从注册面收下来：官方 `register` 会把它们静默丢掉，坞自存自绘。
        const row = { record, badge: record.badge ?? null, icon: record.icon ?? null, paired: false, sidebar: false, dispose: null };
        registry.set(id, row);
        if (record.kind !== 'action') {
          /**
           * ★ **字形不再拦点击**：平台的 `PanelRow` 本身就是**一个** `<button>`
           * （字形与 label 都是它的子节点），它只有一个动作 `selectPanel(id)`。旧版让字形自己
           * `stopPropagation` 后开面板，等于把这一行劈成两半（点图标 ≠ 点文字）—— 用户判「做成了两个」。
           * 现在字形只干两件事：**画自己**、**记自己的屏幕矩形**（面板要贴着这一行长出来）。
           */
          const icon = createEntryGlyph(react, primitives, {
            id,
            label: record.label,
            icon: row.icon,
            readBadge: () => row.badge,
          });
          // 本包自己的附加入口（管理页）**不占侧栏行**：它只挂 `main`，
          // 按钮由坞总览面板给（侧栏只留一个按钮）。
          const sidebar = !isInternalEntry(record);
          row.dispose = pairEntry(callerCtx ?? refs.ctx, slots, record, icon, { sidebar });
          row.paired = true;
          row.sidebar = sidebar;
        }
        refresh(slots);
        return true;
      }
      if (kind === 'removed') {
        const row = registry.get(record.id);
        if (row === undefined) return false;
        registry.delete(record.id);
        if (typeof row.dispose === 'function') row.dispose();
        row.dispose = null;
        row.paired = false;
        refresh(slots);
        return true;
      }
      return false;
    },
    entries() {
      return refresh(refs.slots);
    },
    // ★ 公开面 `ctx.guiFrame.dock.open/close/isOpen` 的落点（三件摊进来；
    //   它们**不收调用方 ctx** —— 面板是**插件整体**的共享 UI，不挂调用方 fiber；语义见 `panel-api.mjs`）。
    ...createDockPanelApi({ openDockPanel, closeDockPanel, isDockPanelOpen }),
    list() {
      return [...registry.values()].map((row) => ({
        id: row.record.id,
        kind: row.record.kind,
        paired: row.paired,
        sidebar: row.sidebar === true,
        badge: row.badge,
      }));
    },
    setBadge(callerCtx, id, badge) {
      const row = registry.get(id);
      if (row === undefined) return false;
      row.badge = badge;
      refresh(refs.slots);
      return true;
    },
    setLabel(callerCtx, id, label) {
      const row = registry.get(id);
      if (row === undefined) return false;
      row.record = { ...row.record, label };
      refresh(refs.slots);
      return true;
    },
    dispose() {
      for (const row of registry.values()) {
        if (typeof row.dispose === 'function') row.dispose();
        row.dispose = null;
        row.paired = false;
        row.sidebar = false;
      }
      registry.clear();
      refresh(refs.slots);
    },
    /** 坞内部面（`__` 前缀：不进公开面快照；测试与诊断用）。 */
    __registry: registry,
    __store: store,
    __live: live,
    __pairEntry: pairEntry,
    /** 管理页工厂（自检页 + 布局编辑器；**不是**按钮面板）。 */
    __createDockOverview: createDockManagePage,
    /** 入口那一页工厂（折回页：到达即开按钮面板 + 把主区还回去）。 */
    __createDockEntryPage: createDockEntryPage,
    __createMainShell: createMainShell,
    __assertEntryId: assertEntryId,
  };

  const dock = {
    api,
    store,
    /**
     * 面板壳的**只读视图**（`get(name)` → 组件或 null）。
     * 坞不再自建组件集合：`Panel`/`Toolbar` 经服务面组件表在渲染期取，
     * 这里只是同一入口的一个薄视图，供诊断/测试读取（不是第二份实现）。
     */
    components: Object.freeze({ get: componentOf }),
    icon: null,
    /** 当前 ctx 下的实时座位快照。 */
    entries(ctx) {
      const slots = ctx === null || ctx === undefined ? null : (probeService(ctx, 'slots') ?? null);
      return live(slots ?? refs.slots);
    },
    list() {
      return api.list();
    },
    setBadge(id, badge) {
      return api.setBadge(null, id, badge);
    },
    setLabel(id, label) {
      return api.setLabel(null, id, label);
    },
    refreshNow() {
      return refresh(refs.slots);
    },
    closePanel,
    /** 装配：全副作用经 ctx.effect；返回幂等 disposer。`ctx` 上缺 `slots` ⇒ 返回 null。 */
    install(ctx) {
      if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') return null;
      const slots = probeService(ctx, 'slots');
      if (slots === undefined || slots === null || typeof slots.inject !== 'function') return null;
      if (service === null || typeof service.__install !== 'function') return null;
      refs.ctx = ctx;
      refs.slots = slots;
      const layout = probeService(ctx, 'layout');
      refs.layout = layout === undefined ? null : layout;
      return effectOn(ctx, 'gui-frame: dock slice + own entry', () => {
        const uninstall = service.__install(DOCK_SLICE_NAME, api);
        // 回放：坞切片装上前注册的入口（恢复完成前注册的直接进坞）
        if (typeof service.__entries === 'function') {
          for (const record of service.__entries()) api.onEntry(ctx, { type: 'added', entry: record });
        }
        // 坞自己的入口
        // `icon` 是注册面的一项：坞**自存自绘**（官方 `register` 只保留 key/id/order/label/priority，
        // 传进去也是被丢掉），不给它图标的话侧栏那一行就只剩一个首字兜底 —— 不给它图标就会让用户找不到入口。
        // 组件是**折回页**（`createDockEntryPage`）：平台那一行点下去 ⇒ `selectPanel(本 id)` ⇒ 到达即开
        // 按钮面板 + 把主区还给会话（管理页挂在工作台那一格，见下面的 `offWorkbenchMain`）。
        const ownEntry = service.register({
          id: DOCK_ENTRY_ID,
          label: () => DOCK_LABEL_FALLBACK,
          order: 0,
          kind: 'panel',
          source: 'dsh-gui-frame',
          icon: createDockIcon(react),
        }, createDockEntryPage());
        // ★ **工作台那一格**（`main[WORKBENCH_PANEL_ID]`）也在**这里**注册：
        // 与坞自己那一格**同源同序**（同一次 install 的同一个 effect 里）：真机读数
        // ——attach 返回 true、日志无异常，但平台 `renderSlot('main', {}, { entryKey })` 查不到这一格
        // ⇒ 工作台打开后中心列空白（全页文本长度 2）。字面量在 `contracts/panel-ids.mjs`（两边同源）。
        const offWorkbenchMain = slots.inject(MAIN_SLOT, () =>
          slots.register({ name: MAIN_SLOT, key: WORKBENCH_PANEL_ID }, createDockManagePage()));
        const offSlots = typeof slots.subscribe === 'function'
          ? [slots.subscribe(PANELLIST_SLOT, () => { refresh(slots); }), slots.subscribe(MAIN_SLOT, () => { refresh(slots); })]
          : [];
        return () => {
          for (const unsubscribe of offSlots) unsubscribe();
          offWorkbenchMain();
          if (typeof ownEntry === 'function') ownEntry();
          api.dispose();
          uninstall();
        };
      });
    },
    __internals: { registry, api, store, refs },
  };

  return dock;
}
  return { createDockCore: createDockCore };
}());
__esMod["./dock.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
  var { WORKBENCH_PANEL_ID: WORKBENCH_PANEL_KEY } = __esMod["./contracts/panel-ids.mjs"];
  var { CONSUMED_SLOT_KEYS, ENTRY_ID_MAX_LENGTH, ENTRY_ID_PATTERN, OWN_ID_PREFIX, RESERVED_ENTRY_IDS } = __esMod["./contracts/service-face.mjs"];
  var { probeService } = __esMod["./kit/probe.mjs"];
  var { createPanelContentFace } = __esMod["./dock/panel-content.mjs"];
  var { createDockCore } = __esMod["./dock/core.mjs"];
/**
 * dock.mjs —— **入口坞**（能力①）与「坞＋面板」的成对注册。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 一、为什么必须**成对**注册（判据是机制，不是风格）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `ctx.layout.selectPanel(panelId)` 的实现是（实读 `dsh-client-ui-layout/lib/client.js`，偏移 ≈18107）：
 *   `if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error('layout.selectPanel: main panel "…" is not registered')`
 * 其中 `hasMainPanel = (id) => ctx.slots.entries("main").some((entry) => entry.options.key === id)`。
 * `MainPanelId` 的类型注释也写着「Identity shared by a sidebar panel entry and its main-slot occupant」。
 * ⇒ 坞里点一下 → `selectPanel(id)` → **`main` 上没有同名 keyed entry 就当场抛错**。
 * 所以 `sidebar.panellist`（list，`id` 必填）与 `main`（keyed，`key` 必填）**必须同值成对**，
 * 而且要在 `register()` 的**同一次同步调用里**就位（`dock.onEntry` 由 `service.__broadcast` 同步调用）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 二、注册路径只能是 `slots.inject(key, () => slots.register(options, Component))`
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 官方 `registry.d.ts` 原文：`inject` 的回调「**runs synchronously when the declaration already
 * exists**; otherwise it runs inside the declaring `register()` call after the declaration is
 * committed. **Collapse disposes the effect and a later declaration runs it again.**」；
 * 直接 `register` 到未声明的槽位会**同步抛** `slot "X" is not declared`。
 * ⇒ 座位存在性随官方 owner 的挂载而变（`sidebar.panellist` 由 client-ui-sidebar 声明、`main` 由
 * client-ui-layout 声明），必须用 `inject` 守卫，**不能**直接 register。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 三、坞的就位位置（探针结论与证据见 `tests/unit/dock-placement.test.mjs`）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `dsh-client-ui-sidebar` 的 `SidebarRoot` 渲染子节点顺序是
 *   `logoRow` → **`newSession` 按钮** → **`panels.length > 0 && <nav class=panelList>`（panellist 行）**
 *   → `regionArea`（sidebar.workspaces） → `footArea`
 * ⇒ `sidebar.panellist` **天然落在 newSession 正下方**（同一 flex 列里紧随其后），
 *   **不是**与 newSession 同位；newSession 是**无条件渲染**的（源码里没有任何开关/条件）。
 * ⇒ 「坞占据 newSession 原位」只有在 newSession 被隐藏后才成立，而隐藏它**没有官方开关**
 *   （只能靠 CSS/DOM 外科手术 = 反向修改官方 UI）⇒ **不做**，坞直接用「newSession 下方那一行」。
 *   证据与替代方案见交付说明。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 四、角标不进注册选项
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 官方 `register` 只保留 `key / id / order / label / priority` —— `badge` 会被**静静丢掉**。
 * 所以坞把角标存在自己的环里（`dock.setBadge(id, value)`），由**自绘图标组件**（`kit/entry-icons.mjs`）
 * 读出来画；`SLOT_OPTION_KEYS` 白名单就是这条的机检抓手。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 五、谁提供 ctx
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 切片方法第一个参数恒为**调用方 ctx**（`dock.onEntry(ctx, change)`）。`service.__broadcast`
 * 传进来的正是「当时在调 `register()` 的那个调用方 ctx」，所以插件卸载 ⇒ 它的 entry 被移除 ⇒
 * 坞同步撤掉那一对座位。装配期**回放**既有入口（恢复完成前注册的直接进坞）时用装配方 ctx。
 *
 * 本文件**零副作用**：`install(ctx, env)` 才产生效果，且**全部**经 `ctx.effect`。
 */








/** 切片名（`service.__install('dock', api)`；切片白名单见 contracts/service-face.mjs）。 */
const DOCK_SLICE_NAME = 'dock';

/** 坞自己的入口 id（坞 = panellist 的一个 entry，GUIFrame 自己的图标）＝ `dsh-gui-frame/dock`。 */
const DOCK_ENTRY_ID = `${OWN_ID_PREFIX}dock`;

/**
 * 工作台那一格的 `main` key（**由坞在装配期与自己的入口同源同序注册**；真源 `contracts/panel-ids.mjs`）。
 * 这里再声明一次只为「坞侧一个口子拿全自己的座位」；字面量与 workbench 侧同源自契约文件
 * （打包器不支持 `export { … }` 再绑定形式 ⇒ 写法是「import 带别名 + 本地 const 导出」）。
 */
const WORKBENCH_PANEL_ID = WORKBENCH_PANEL_KEY;

/** 收取的两个座位（顺序即注册顺序：先 panellist 后 main，不依赖对方的声明时机）。 */
const PANELLIST_SLOT = CONSUMED_SLOT_KEYS.includes('sidebar.panellist') ? 'sidebar.panellist' : CONSUMED_SLOT_KEYS[0];
const MAIN_SLOT = CONSUMED_SLOT_KEYS.includes('main') ? 'main' : CONSUMED_SLOT_KEYS[1];

/**
 * 允许出现在 slot 注册选项里的键（**白名单**，机检直接比对 `Object.keys(options)`）。
 * 官方 `SlotCore.register` 只保留 `key / id / order / label / priority`；坞只用前四个 ——
 * 角标**不在这里**（`badge` 没有官方字段，塞进去也是被丢掉：角标由坞自绘）。
 */
const SLOT_OPTION_KEYS = Object.freeze(['id', 'key', 'label', 'name', 'order']);

/**
 * 坞入口的 label 文案键与兜底（走 owner 的 `t`；坞自己的文案不占用官方 locale 命名空间）。
 *
 * ⚠ 兜底文案 = **用户对该物的原话**（「我要的按钮面板」）。旧值 `'GUIFrame'` 是**包名**，
 * 侧栏那一行读起来像「又一个插件入口」而不是用户要的那件东西 —— 它必须是功能性命名，
 * 否则用户找不到入口。包身份仍由面板内的自检页与 README 承担。
 */
const DOCK_LABEL_KEY = 'dock.label';
const DOCK_LABEL_FALLBACK = '按钮面板';

/** 浮出面板的初始尺寸（可拖可缩 ⇒ 尺寸不是契约，**位置**才是：必须从按钮旁长出来）。 */
const DOCK_PANEL_SIZE = Object.freeze({ width: 340, height: 440 });
/** 面板与锚点之间的间隙。 */
const DOCK_PANEL_GAP = 8;

/**
 * 由**锚点矩形**（那颗按钮的屏幕矩形）算出面板的初始矩形：右缘 +8px、与按钮顶边对齐，
 * 再按视口夹一次（视口量不到就不夹 —— 容器 clamp 由 FloatingWindow 自己兜）。
 * @param {{left?:number, top?:number, right?:number, width?:number}|null} anchor
 * @param {{width:number, height:number}|null} [viewport] 缺省读 `window`（Node 里为 null）
 * @returns {{x:number, y:number, width:number, height:number}}
 */
function panelRectNear(anchor, viewport) {
  const size = DOCK_PANEL_SIZE;
  const view = viewport === undefined
    ? (typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight })
    : viewport;
  const left = anchor !== null && anchor !== undefined && Number.isFinite(anchor.left) ? anchor.left : null;
  const width = anchor !== null && anchor !== undefined && Number.isFinite(anchor.width) ? anchor.width : 0;
  const right = anchor !== null && anchor !== undefined && Number.isFinite(anchor.right) ? anchor.right : (left === null ? null : left + width);
  const top = anchor !== null && anchor !== undefined && Number.isFinite(anchor.top) ? anchor.top : null;
  const rawX = right === null ? 16 : right + DOCK_PANEL_GAP;
  const rawY = top === null ? 16 : Math.max(8, top - 8);
  const x = view === null ? rawX : Math.max(8, Math.min(rawX, view.width - size.width - 8));
  const y = view === null ? rawY : Math.max(8, Math.min(rawY, view.height - size.height - 8));
  return { x, y, width: size.width, height: size.height };
}

/** 从 React 合成事件里量出**触发元素**的矩形（拿不到 ⇒ `null`，面板走缺省位）。 */
function anchorRectOf(event) {
  const node = event === null || event === undefined ? null : event.currentTarget ?? null;
  if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return null;
  try {
    const box = node.getBoundingClientRect();
    if (box === null || typeof box !== 'object' || !Number.isFinite(box.left)) return null;
    return { left: box.left, top: box.top, right: box.right, width: box.width, height: box.height };
  } catch {
    return null;
  }
}

/**
 * 没有事件对象时（键盘/替身）⇒ `null`：面板走 `panelRectNear(null)` 的安全缺省位。
 * ⚠ 这里**故意不查 DOM**：门禁扫 `dock.mjs` 的代码里不许出现 `document.`
 * （本包不做任何「对官方 UI 的 DOM/CSS 外科手术」）—— 坞只认自己拿到的事件矩形。
 * @param {object|null|undefined} event
 * @returns {object|null}
 */
function anchorFromEvent(event) {
  return event === null || event === undefined ? null : anchorRectOf(event);
}

/** 入口 id 的准入（复用冻结的服务面正则/保留字/长度上限；错误码取既有 `GUIF-E-ENTRY-INVALID`）。 */
function assertEntryId(id) {
  if (typeof id !== 'string' || id === '') {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 必须是非空字符串（收到 ${JSON.stringify(id)}）`, { id });
  }
  if (id.length > ENTRY_ID_MAX_LENGTH) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 长度不得超过 ${ENTRY_ID_MAX_LENGTH}（收到 ${id.length}）`, { id });
  }
  if (RESERVED_ENTRY_IDS.includes(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 不得占用保留 key「${id}」（会顶掉外壳自己的会话界面）`, { id });
  }
  if (!ENTRY_ID_PATTERN.test(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 id 必须带命名空间前缀且只含 [A-Za-z0-9._-/]（如 ${DOCK_ENTRY_ID}，收到「${id}」）`, { id });
  }
  return id;
}

/** 在**调用方** ctx 上挂一条幂等副作用（副作用一律经 ctx.effect）。 */
function effectOn(ctx, label, install) {
  const dispose = ctx.effect(install, label);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (typeof dispose === 'function') dispose();
  };
}

/** 坞自己的 label 解析（owner 的 `t` 优先；thunk 抛错不冒泡）。 */
function dockLabel(t) {
  if (typeof t === 'function') {
    try {
      const value = t(DOCK_LABEL_KEY);
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 落到兜底
    }
  }
  return DOCK_LABEL_FALLBACK;
}

/** 解析一个入口的 label（字符串 / thunk / 缺省 ⇒ 入口 id）。 */
function entryLabel(record) {
  const label = record.label;
  if (typeof label === 'function') {
    try {
      const value = label();
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 落到 id
    }
  } else if (typeof label === 'string' && label !== '') {
    return label;
  }
  return record.id;
}

/** 排序键：`order` 缺省排最后。 */
function rank(order) {
  return Number.isInteger(order) ? order : Number.MAX_SAFE_INTEGER;
}

/**
 * 本包**自己贡献的附加入口**（坞的管理页）＝ 不该在侧栏再占一行的那一类。
 * 判据只用「来源包名 + 不是坞自己的入口」两条，不认具体 id —— 免得日后加一个自检页就漏一处。
 */
function isInternalEntry(record) {
  return record.source === 'dsh-gui-frame' && record.id !== DOCK_ENTRY_ID;
}

function result(installed, reason, extra) {
  return { capability: 'dock', installed, reason, ...(extra ?? {}) };
}

// ── 按钮面板的正文（在 `./dock/panel-content.mjs`）───────────────────────────────
//    两个常量（坞自己的入口 id / 入口 label 解析）在本侧声明 ⇒ 经 bag 交进去，本模块不复制声明。
// 正文工厂要拿得到「改自己那一行的角标/标签」的两个 setter —— 用**取值函数**交进去
// （坞实例晚于本行创建 ⇒ 收取值函数而不是快照，避免把「早建晚用」的对象捕获成 null）；`currentDock` 先声明。
let currentDock = null;
const panelContent = createPanelContentFace({
  DOCK_ENTRY_ID,
  // ★ 行的 `label` 取注册面元数据（thunk 支持）——用本侧**同一个** `entryLabel`，不复制声明
  entryLabel,
  // ⚠ 必须走**切片级单参封装**（`service.__slice('dock')` 的 `setBadge(id, badge)`）：内部面
  //   `api.setBadge(callerCtx, id, badge)` 是三参签名，拿它当 `(id, badge)` 用会 `registry.get(callerCtx)`
  //   恒 undefined ⇒ **静默返回 false**（踩过一次）。坞实例自己那两个是单参封装（`dock.setBadge(id, badge)`）；
  //   取值函数形态：坞实例晚于本行创建 ⇒ 收函数不收快照。
  setBadge: (id, badge) => currentDock?.setBadge?.(id, badge),
  setLabel: (id, label) => currentDock?.setLabel?.(id, label),
});
const { readDockActions, createPanelContent } = panelContent;

/**
 * 造一个坞实例（**不做**任何注册；`install(ctx)` 才产生副作用）。
 *
 * 函数体整段在 `./dock/core.mjs` —— 坞作用域的状态（registry / refs /
 * store / api / dock）**随组搬走**，本文件只把常量、几何、纯 helper 与面板正文经 bag 交进去。
 *
 * @param {{service?:object, seeds?:object, note?:Function}} env 装配面
 */
function createDock(env) {
  return createDockCore({
    env,
    consts: { DOCK_SLICE_NAME, DOCK_ENTRY_ID, PANELLIST_SLOT, MAIN_SLOT, DOCK_LABEL_FALLBACK, WORKBENCH_PANEL_ID },
    geometry: { panelRectNear, assertEntryId },
    helpers: { effectOn, dockLabel, entryLabel, rank, isInternalEntry },
    readDockActions,
    createPanelContent,
  });
}

/**
 * 装配入口坞。
 *
 * 语义：
 *  - `env.service` 缺席 ⇒ `{installed:false, reason:'no-service'}`，**不注册任何座位**；
 *  - `ctx.get('slots')` 缺席 ⇒ `{installed:false, reason:'no-slots'}`（座位服务都没有，坞无处可落）；
 *  - 同一 service 已装过切片 ⇒ `{installed:false, reason:'already-installed'}`（幂等，不重复注册）。
 *
 * @param {object} ctx 调用方 Cordis ctx
 * @param {{service?:object, seeds?:object}} env 装配面
 */
function install(ctx, env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  const service = bag.service;
  if (service === null || typeof service !== 'object') return result(false, 'no-service');
  if (typeof ctx?.effect !== 'function') return result(false, 'no-ctx-effect');
  if (typeof service.__install !== 'function') return result(false, 'no-service-face');
  if (typeof service.__slice === 'function' && service.__slice(DOCK_SLICE_NAME) !== undefined) {
    return result(false, 'already-installed');
  }
  const slots = probeService(ctx, 'slots');
  if (slots === undefined || slots === null) return result(false, 'no-slots');
  let dock;
  try {
    dock = createDock(bag);
    currentDock = dock; // ★ 让正文工厂里的两个取值函数能落到这个实例的 `api` 上
  } catch (error) {
    if (typeof service.__note === 'function') {
      service.__note('GUIF-W-LISTENER-THREW', `坞装配失败（缺 react 种子？）：${error?.message ?? error}`);
    }
    return result(false, 'create-failed');
  }
  let dispose;
  try {
    dispose = dock.install(ctx);
  } catch (error) {
    // 官方 `slots.inject` 在"槽位已声明但回调装配失败"时会**同步抛**；这里兜住并让位，
    // 绝不把异常冒到汇合点 —— 客户端 apply 抛错会让 mountApp 永不执行。
    if (typeof service.__note === 'function') {
      service.__note('GUIF-W-LISTENER-THREW', `坞装配期抛错（已兜住，页面照常）：${error?.message ?? error}`);
    }
    return result(false, 'install-threw');
  }
  if (dispose === null) return result(false, 'no-slots');
  return result(true, null, { dock, store: dock.store, dispose, entryId: DOCK_ENTRY_ID });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * 面板内容的两件工具（**模块作用域**：坞一装上就能用，不等任何组件渲染）
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** 空态：**面板里一个外部按钮都没有**时的说明（不是错误，是这个阶段的事实）。 */
  return { DOCK_SLICE_NAME: DOCK_SLICE_NAME, DOCK_ENTRY_ID: DOCK_ENTRY_ID, WORKBENCH_PANEL_ID: WORKBENCH_PANEL_ID, PANELLIST_SLOT: PANELLIST_SLOT, MAIN_SLOT: MAIN_SLOT, SLOT_OPTION_KEYS: SLOT_OPTION_KEYS, DOCK_LABEL_KEY: DOCK_LABEL_KEY, DOCK_LABEL_FALLBACK: DOCK_LABEL_FALLBACK, DOCK_PANEL_SIZE: DOCK_PANEL_SIZE, DOCK_PANEL_GAP: DOCK_PANEL_GAP, panelRectNear: panelRectNear, anchorRectOf: anchorRectOf, anchorFromEvent: anchorFromEvent, assertEntryId: assertEntryId, createDock: createDock, install: install };
}());
__esMod["./panel/boundary.mjs"] = (function () {
/**
 * boundary.mjs —— 壳组件**自己的**渲染错误隔离。
 *
 * ═══ 为什么不能靠官方 boundary ═══
 * 官方渲染层给每个座位条目一个 `SlotErrorBoundary`，但它的崩溃面是
 * **`<div data-slot-error="<slotKey>">` —— 空 div、没有文案、不能重试**（逐字实读
 * `dsh-client-ui-renderer/lib/client.js`）。用户看到的就是一片空白。
 * ⇒ 错误态必须由 GUIFrame 的壳组件内部自 catch 渲染，本文件就是这个 catch。
 *
 * 三层 catch，缺一不可：
 *   ① **类组件的错误边界**（`getDerivedStateFromError` + `componentDidCatch`）：抓**子树渲染期间**
 *      抛出的错误（插件内容组件自己抛）——这是 React 里唯一能抓 render 抛错的机制；
 *   ② **`safeRender`**：抓**我们自己在 render 里同步调用**的回调抛错（`renderItem`、label thunk、
 *      `onSelect` 之类的构造期调用）——它发生在**我们自己的渲染函数体内**，那时还没有子边界可接；
 *   ③ **fallback 自身的保险**：光是 ① 还不够 ——
 *      如果 fallback 又把刚抛错的那棵 `children` 渲染一遍（`errorView({ ...props, error })` 的经典形态），
 *      React 会认为**边界自己也炸了**，于是把整棵树卸载 ⇒ 真机上由官方 `SlotErrorBoundary` 兜住，
 *      用户看到的正是那个空 div。所以 `render()` 必须自己 try/catch fallback，失败就退到
 *      **静态最小错误节点**（纯字面量、不读 props、不调组件）—— 且**任何情况下都不返回 null**。
 *
 * 基类取用：真实 React 走 `react.Component`（`isReactComponent` 标记由它自己打）；
 * 无 `Component` 的假 react（构建期 `loadArtifact` 用的那种）退到本地基类，并自己打上
 * `prototype.isReactComponent` —— 否则 React 会把类组件当函数组件调用（静默失效）。
 *
 * 本文件**零副作用**，且**不 import 任何东西**：兜底层要能在「什么都坏了」的时候还画得出来。
 */

/** 静态最小错误节点的锚点值（与状态视图同一套：`data-guif-state="error"`）与标题文案（纯字面量）。 */
const MINIMAL_ERROR_STATE = 'error';
const MINIMAL_ERROR_TITLE = '面板渲染出错';
/** 静态最小错误节点的专用标记（用于区分「正常错误态」与「连 fallback 都炸了」的兜底节点）。 */
const MINIMAL_ERROR_ATTR = 'data-guif-boundary';
const MINIMAL_ERROR_KIND = 'minimal';

/** 无 `react.Component` 时的最小基类（React 只要求 + `isReactComponent` 标记）。 */
function createMiniComponent() {
  class MiniComponent {
    constructor(props) {
      this.props = props ?? {};
      this.state = null;
    }

    setState(partial) {
      const next = typeof partial === 'function' ? partial(this.state ?? {}) : partial;
      this.state = { ...(this.state ?? {}), ...next };
    }
  }
  MiniComponent.prototype.isReactComponent = {};
  return MiniComponent;
}

/** 取基类：真 React 的 `Component` 优先（它自带 `isReactComponent`）。 */
function baseClass(react) {
  if (react !== null && typeof react === 'object' && typeof react.Component === 'function') return react.Component;
  return createMiniComponent();
}

/** 把任意错误值收敛成一行文案；**自己绝不抛**（兜底层的兜底层，不能有失败路径）。 */
function minimalMessage(error) {
  try {
    if (typeof error === 'string') return error;
    if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
    if (error === null || error === undefined) return '（无错误信息）';
    return String(error);
  } catch {
    return '（错误值无法读取）';
  }
}

/**
 * 造 GUIFrame 自己的错误边界组件。
 * props：
 *  - `children`：被隔离的子树；
 *  - `renderError(error, reset)`：崩溃时渲染什么（返回元素；壳组件传 ErrorState）。
 *    **可以不传**——不传时退到静态最小错误节点（绝不渲染成空白/null）；
 *  - `onError(error, info)`：可选上报（诊断链路用；本文件只调，不实现）。
 * @param {object} react 种子 react（真 React 或测试替身）
 * @returns {Function} 类组件
 */
function createRenderBoundary(react) {
  const Base = baseClass(react);
  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
    throw new Error('[gui-frame] createRenderBoundary(react) 需要一个带 createElement 的 react（兜底节点也要能建元素）');
  }
  const el = react.createElement;

  /**
   * **静态最小错误节点**：纯字面量 + 纯宿主元素，不读 props、不调组件、不碰种子/样式表/文案表。
   * 它存在的意义是「连 fallback 都炸了的时候，屏幕上至少要有一句话」——
   * 所以这里**没有任何可能抛错的取值**（除了 createElement 本身）。
   */
  function minimalNode(primary, detail) {
    const title = minimalMessage(primary);
    // 明细与主错因**同文本**时不重复画一行（同一次抛错会在两层里各出现一次）
    const showDetail = detail !== undefined && detail !== null && detail !== primary && minimalMessage(detail) !== title;
    return el('div', { [MINIMAL_ERROR_ATTR]: MINIMAL_ERROR_KIND, 'data-guif-state': MINIMAL_ERROR_STATE },
      el('div', null, MINIMAL_ERROR_TITLE),
      el('code', null, title),
      showDetail ? el('code', null, minimalMessage(detail)) : null);
  }

  class GuiFrameRenderBoundary extends Base {
    constructor(props) {
      super(props);
      this.state = { failed: false, error: null };
      this.__reset = () => {
        this.setState({ failed: false, error: null });
      };
    }

    static getDerivedStateFromError(error) {
      return { failed: true, error };
    }

    componentDidCatch(error, info) {
      this.__report(error, info);
    }

    /** 上报（**吞掉一切**：上报链自己抛错绝不能连坐渲染）。 */
    __report(error, info) {
      const callback = this.props === null || this.props === undefined ? null : this.props.onError;
      if (typeof callback !== 'function') return;
      try {
        callback(error, info === undefined ? null : info);
      } catch {
        // 上报抛错不连坐
      }
    }

    /** 失败态下的「主错因」：优先用让边界失败的那个原始错误。 */
    __primaryError(secondary) {
      const state = this.state === null || this.state === undefined ? null : this.state;
      const primary = state === null ? null : state.error;
      return primary === undefined || primary === null ? secondary : primary;
    }

    render() {
      const state = this.state === null || this.state === undefined ? null : this.state;
      const failed = state !== null && state.failed === true;
      const props = this.props === null || this.props === undefined ? {} : this.props;
      // 嵌套实例（`guard: false`）不再往下套 —— 否则边界会无限自我嵌套
      const guardEnabled = props.guard !== false;
      let node = null;
      try {
        node = this.__renderInner(failed, state);
      } catch (error) {
        // ③ 的保险（同步那半）：构造 fallback 的过程中就抛错 ⇒ 绝不逃出去
        this.__report(error, null);
        const staticNode = minimalNode(this.__primaryError(error), error);
        return guardEnabled ? this.__guard(staticNode) : staticNode;
      }
      if (node === null || node === undefined) {
        // 失败态**绝不返回 null**（返回 null = 把「有错」变成「什么都没有」，比空 div 更难查）
        if (!failed) return null; // 未失败且无 children ⇒ null 是正常的
        const staticNode = minimalNode(this.__primaryError(null), null);
        return guardEnabled ? this.__guard(staticNode) : staticNode;
      }
      if (!failed) return node;
      // ③ 的保险（异步那半，**这才是 repro B 分支的关键**）：fallback 自己返回的子树由 React 渲染，
      // 里面若再包着抛错的 children，React 会把错误抛到**上层**（同一个边界不会二次接住自己）⇒
      // 所以给 fallback 的输出再套一层**同类边界**，由它退到静态最小节点。
      return guardEnabled ? this.__guard(node) : node;
    }

    /**
     * 把 fallback 的输出包进一个**同类边界**（嵌套实例，类型只建一次，不会因换类型而重挂载）。
     * 嵌套实例带 `guard: false`（**不再往下套**，否则边界会无限自我嵌套），并且它的 fallback 恒为
     * 静态最小错误节点。
     */
    __guard(node) {
      const callback = this.props === null || this.props === undefined ? null : this.props.onError;
      const primary = this.__primaryError(null);
      return el(GuiFrameRenderBoundary, {
        key: '__guif-fallback-guard',
        guard: false,
        onError: typeof callback === 'function' ? callback : undefined,
        renderError: (innerError) => minimalNode(primary, innerError),
      }, node);
    }

    /** 正常路径：失败 ⇒ fallback（或静态最小节点）；未失败 ⇒ children。 */
    __renderInner(failed, state) {
      if (!failed) return this.props === null || this.props === undefined ? null : (this.props.children ?? null);
      const renderError = this.props === null || this.props === undefined ? null : this.props.renderError;
      if (typeof renderError === 'function') return renderError(state.error, this.__reset);
      return minimalNode(state.error, null);
    }
  }
  return GuiFrameRenderBoundary;
}

/**
 * 同步调用一个可能抛错的构造函数（渲染期用）。
 * @param {Function} fn 待调用
 * @param {unknown} fallbackValue 抛错时的返回值
 * @param {((error:unknown)=>void)|null} [onError] 可选上报
 * @returns {unknown} `fn()` 的返回值，或 `fallbackValue`
 */
function safeRender(fn, fallbackValue, onError = null) {
  try {
    return fn();
  } catch (error) {
    if (typeof onError === 'function') {
      try {
        onError(error);
      } catch {
        // 上报抛错不连坐
      }
    }
    return fallbackValue;
  }
}
  return { MINIMAL_ERROR_STATE: MINIMAL_ERROR_STATE, MINIMAL_ERROR_TITLE: MINIMAL_ERROR_TITLE, MINIMAL_ERROR_ATTR: MINIMAL_ERROR_ATTR, MINIMAL_ERROR_KIND: MINIMAL_ERROR_KIND, createRenderBoundary: createRenderBoundary, safeRender: safeRender };
}());
__esMod["./kit/surface.mjs"] = (function () {
  var { dsw, guifLiteral, guifPrivateVar, guifVar } = __esMod["./kit/tokens.mjs"];
/**
 * base.mjs —— **面板基类**（`--dsw-*` 表面 + 头部 + 内容区 + 底部；全包唯一真源）。
 *
 * ═══ 为什么要抽这一层（用户原话：「你就不能借鉴一下人家的面板代码，写自己的基类？」）═══
 * 之前「坞的面板」有两套皮：`components.Panel`（主区面板，有表面）与 overlay 里另写的一个**裸 div**
 * （没有背景 ⇒ 用户当场判「你现在的面板连背景都没有」）。两处各写一份 = 必然漂移。
 * 现在**只有这一份**：主区面板（`components.Panel`）与浮出面板（`overlay/panel.mjs`）都渲染这四个零件。
 *
 * ═══ 表面规则是从自家插件的事故里抄来的（TextManager `src/client/styles.mjs`）═══
 *  · **底面必须不透明**：TextManager 的事故原文 —— 悬浮窗标题条用了
 *    `--dsw-alias-interactive-bg-hover`（近全透明的 hover wash，浅色 `#2631480f` ≈6%），
 *    压在下面那扇窗的文字**直接透上来**，看成一团糊。⇒ 面板的底面只用「抬起的层」这类不透明层色
 *    （`--dsw-alias-bg-layer-2`，缺省再退 `--dsw-alias-bg-base`），**绝不用 hover/遮罩色当脸**。
 *  · **一像素实边框 + 圆角 + 投影**三件套齐全（TextManager 的 `WINDOW_FRAME` 就是这个组合：
 *    `border: 1px solid <border-l2>` + `borderRadius: 12px` + `boxShadow`）。
 *  · **头部与内容区之间一条分隔线**（TextManager 的 `windowHeader`：`borderBottom: 1px solid`）。
 *
 * 颜色一律经 `kit/tokens.mjs` 的白名单引用（硬编码颜色会被 `check:tokens` 硬门禁拦下）；
 * 尺寸/间距走公开变量 `--guif-panel-*`（接入方可覆盖）。本文件**零副作用**：只有样式表与薄组件。
 */


/** 面板底面的层色（**必须不透明** —— 理由见文件头的事故记录）。 */
const PANEL_SURFACE_TOKEN = '--dsw-alias-bg-layer-2';
/** 面板边框的层色（`border-l2` 比 `l3` 实，浮层才立得住）。 */
const PANEL_BORDER_TOKEN = '--dsw-alias-border-l2';
/** 头部与内容区之间的分隔线（低一档，不抢边框）。 */
const PANEL_DIVIDER_TOKEN = '--dsw-alias-border-l3';

/** 面板基类的机检锚点（沿用 `components.mjs` 里已冻结的那一套，不另造名字）。 */
const BASE_ANCHORS = Object.freeze({
  frame: 'data-guif-panel-frame',
  header: 'data-guif-panel-header',
  title: 'data-guif-panel-title',
  close: 'data-guif-panel-close',
  body: 'data-guif-panel-body',
  footer: 'data-guif-panel-footer',
});

/** 圆角（字面量只出现在 `var()` 的 fallback 位）。 */
const PANEL_RADIUS_FALLBACK = '12px';

/**
 * 面板基类样式表。**唯一真源**：主区面板与浮出面板都从这里取。
 * @returns {{frame:object, header:object, title:object, close:object, body:object, footer:object}}
 */
function panelBaseStyles() {
  const surface = guifVar('--guif-panel-bg', PANEL_SURFACE_TOKEN, dsw('--dsw-alias-bg-base'));
  const stroke = guifVar('--guif-panel-border', PANEL_BORDER_TOKEN);
  const divider = dsw(PANEL_DIVIDER_TOKEN);
  const fg = guifVar('--guif-panel-fg', '--dsw-alias-label-primary');
  return Object.freeze({
    /** 脸：不透明底面 + 实边框 + 圆角 + 投影 + 裁切 + **自己接回指针事件**。 */
    frame: Object.freeze({
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      minHeight: 0,
      background: surface,
      color: fg,
      border: `1px solid ${stroke}`,
      borderRadius: guifLiteral('--guif-panel-radius', PANEL_RADIUS_FALLBACK),
      boxShadow: `0 8px 24px ${dsw('--dsw-alias-bg-mask-1')}`,
      overflow: 'hidden',
      // 自己接回指针事件（RAMManager 的 `.rm-panel` 同款：`pointer-events:auto`）——
      // 浮层根容器是点击穿透的，这一句让面板自己可点，且不必依赖宿主包裹层的样式。
      pointerEvents: 'auto',
    }),
    /** 头部：**不透明**底（同 frame）+ 一条分隔线 + 定高。 */
    header: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      gap: guifLiteral('--guif-panel-gap', '8px'),
      minHeight: guifPrivateVar('--guif-private-header-min-height', '32px'),
      padding: '6px 10px',
      flex: 'none',
      borderBottom: `1px solid ${divider}`,
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
      fontSize: 'var(--dsw-font-xs-13-font-size)',
    }),
    title: Object.freeze({
      flex: '1 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-primary'),
    }),
    close: Object.freeze({
      appearance: 'none',
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
      lineHeight: 1,
      padding: '2px 6px',
      borderRadius: guifLiteral('--guif-panel-radius', '6px'),
      flex: 'none',
    }),
    /** 内容区：可滚动 + 内边距（面板高度定了，内容多了在自己这格里滚）。 */
    body: Object.freeze({
      flex: '1 1 auto',
      minHeight: 0,
      overflow: 'auto',
      padding: guifLiteral('--guif-panel-padding', '10px'),
      display: 'flex',
      flexDirection: 'column',
      gap: guifLiteral('--guif-panel-gap', '8px'),
    }),
    /** 底部（可选）：动作条，与内容区之间一条分隔线。 */
    footer: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: guifLiteral('--guif-panel-gap', '8px'),
      padding: '6px 10px',
      flex: 'none',
      borderTop: `1px solid ${divider}`,
    }),
  });
}

/**
 * 造面板基类的**零件**（薄组件：只铺样式与锚点，不带状态、不带 hook）。
 *
 * 谁用：① `components.Panel`（主区面板骨架）② `overlay/panel.mjs`（贴边浮出的按钮面板）。
 * 两处都只组合这四个零件 ⇒ 表面/头部/分隔线永远一致。
 *
 * @param {object} react 种子 react
 * @returns {{Frame:Function, Header:Function, Body:Function, Footer:Function, styles:object}}
 */
function createPanelParts(react) {
  const el = react.createElement;
  const styles = panelBaseStyles();

  /** 脸：`{id?, style?, children, ...rest}`（`style` 可叠加定位，例如浮出面板的 left/top/width/height）。 */
  function Frame(props) {
    const p = props ?? {};
    return el('div', {
      ...(p.id === undefined || p.id === null ? {} : { [BASE_ANCHORS.frame]: String(p.id) }),
      style: { ...styles.frame, ...(p.style ?? {}) },
      onPointerDownCapture: p.onPointerDownCapture,
      'data-guif-family': p.family,
      'data-guif-z': p.z === undefined || p.z === null ? undefined : String(p.z),
      role: p.role,
      'aria-label': p.label,
    }, p.children ?? null);
  }

  /** 头部：`{id?, title, onClose?, closeLabel?, extra?}`。 */
  function Header(props) {
    const p = props ?? {};
    const close = typeof p.onClose === 'function' ? p.onClose : null;
    return el('div', { [BASE_ANCHORS.header]: String(p.id ?? ''), style: styles.header },
      el('span', { key: 'title', [BASE_ANCHORS.title]: String(p.id ?? '') , style: styles.title }, p.title ?? ''),
      p.extra ?? null,
      close === null ? null : el('button', {
        key: 'close',
        type: 'button',
        [BASE_ANCHORS.close]: String(p.id ?? ''),
        'aria-label': p.closeLabel ?? '关闭',
        title: p.closeLabel ?? '关闭',
        style: styles.close,
        onClick: () => close(),
      }, '✕'));
  }

  /** 内容区：`{id?, children, header?}`（`header` 为真 ⇒ 预留头部空间，滚动区不吃头部）。 */
  function Body(props) {
    const p = props ?? {};
    return el('div', { [BASE_ANCHORS.body]: String(p.id ?? ''), style: styles.body }, p.children ?? null);
  }

  /** 底部动作条（可选）。 */
  function Footer(props) {
    const p = props ?? {};
    if (p.children === undefined || p.children === null) return null;
    return el('div', { [BASE_ANCHORS.footer]: String(p.id ?? ''), style: styles.footer }, p.children);
  }

  return { Frame, Header, Body, Footer, styles };
}
  return { PANEL_SURFACE_TOKEN: PANEL_SURFACE_TOKEN, PANEL_BORDER_TOKEN: PANEL_BORDER_TOKEN, PANEL_DIVIDER_TOKEN: PANEL_DIVIDER_TOKEN, BASE_ANCHORS: BASE_ANCHORS, PANEL_RADIUS_FALLBACK: PANEL_RADIUS_FALLBACK, panelBaseStyles: panelBaseStyles, createPanelParts: createPanelParts };
}());
__esMod["./panel/state.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
/**
 * state.mjs —— 面板的**三态模型**：loading / 空 / 错 各有一个可显式触发的 demo，
 * 面板外壳提供 header/body/status + loading/错误/空态/刷新。
 *
 * 三态是**显式**的，不是「碰巧渲染出空数组」：
 *   - 组件接受可选的 `state` prop（`'ready' | 'loading' | 'empty' | 'error'`）；
 *   - 也可以从官方数据面**推导**：`stateFromSessions(useSessions())` 把
 *     `SessionListSnapshot.state ∈ {idle,loading,error}` + `items.length` 映射成四态里的一态；
 *   - 每个态渲染出的根节点都带 `data-guif-state="<态>"`（机检锚点：`findByAttr(tree,'data-guif-state','loading')`）。
 *
 * 文案一律**可被 `t` 覆盖**（`label` 支持 thunk，组件层同样适用）。
 *
 * 本文件**零副作用**：纯函数，不碰种子、不碰 DOM。
 */


/** 四态（`ready` 是「正常渲染 children」那一态）。 */
const PANEL_STATES = Object.freeze(['ready', 'loading', 'empty', 'error']);

/** 需要**显式可触发**的三态（判据就是这三个字面量）。 */
const TRIGGERABLE_STATES = Object.freeze(['loading', 'empty', 'error']);

/** 机检锚点属性名（组件渲染出来的根节点上恒有它，值＝当前态）。 */
const STATE_ATTR = 'data-guif-state';

/** 缺省文案（可被 `t` 或 `label` thunk 覆盖；外壳 locale 归主题/文案面，这里给兜底）。 */
const DEFAULT_LABELS = Object.freeze({
  loading: '加载中…',
  empty: '暂无内容',
  error: '加载失败',
  retry: '重试',
  close: '关闭',
  refresh: '刷新',
});

/** 装配期/渲染期错误：非法 state 一律显式抛（否则会静默渲染成空白，那正是要消灭的现象）。
 *
 * ⚠ 错误码取既有冻结码 `GUIF-E-COMPONENT-INVALID`（语义：**组件层入参非法**）—— 不新造码，
 * 理由见 `kit/tokens.mjs` 的同名注释（公开面门禁扫 `src/**` 的 `GUIF-[EW]-*`）。
 */
function stateError(message, details) {
  return createError('GUIF-E-COMPONENT-INVALID', `[panel/state] ${message}`, details);
}

/**
 * 收敛 `state` prop：`undefined` / `null` ⇒ `'ready'`；非四态之一 ⇒ 抛。
 * @param {unknown} value
 * @returns {'ready'|'loading'|'empty'|'error'}
 */
function normalizeState(value) {
  if (value === undefined || value === null) return 'ready';
  if (typeof value !== 'string' || !PANEL_STATES.includes(value)) {
    throw stateError(`state 必须是 ${PANEL_STATES.join(' / ')} 之一（收到 ${JSON.stringify(value)}）——三态要能被**显式**触发，不许靠"猜"`);
  }
  return value;
}

/**
 * 从官方会话面（`useSessions()` 的 `SessionListSnapshot`）推导状态。
 * 依据（本机 0.2.0-rc.2 实读 `dsh-api-session-controller/lib/types/client/sessions/manager.d.ts`）：
 *   `{ items: readonly SessionListEntry[]; current; state: 'idle'|'loading'|'error'; phase; error; … }`
 * ⇒ `state==='loading'` ⇒ loading；`state==='error'` ⇒ error；`items` 为空且 `state==='idle'` ⇒ empty。
 * 快照缺席或形状不认识 ⇒ `'ready'`（**不猜成 loading**：那会让「没有会话服务」看起来像「正在加载」）。
 * @param {unknown} snapshot
 * @returns {'ready'|'loading'|'empty'|'error'}
 */
function stateFromSessions(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 'ready';
  const phaseState = snapshot.state;
  if (phaseState === 'loading') return 'loading';
  if (phaseState === 'error') return 'error';
  const items = snapshot.items;
  if (Array.isArray(items) && items.length === 0 && (phaseState === 'idle' || phaseState === undefined)) return 'empty';
  return 'ready';
}

/** 把任意抛出的值收敛成一行可读文案（渲染在错误态里；绝不再抛）。 */
function describeError(error) {
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
  try {
    return String(error);
  } catch {
    return '（无法序列化的错误值）';
  }
}

/**
 * 解析一个「可能是 thunk 的文案/label」（组件层同样适用）。
 * 优先级：`label`（thunk 优先、字符串次之）→ `t(key)` → `DEFAULT_LABELS[key]` → `key`。
 * thunk 抛错**不向上冒**（渲染期抛错会被官方 boundary 换成一个空 div，那是明确要避免的）。
 * @param {unknown} label 字符串 / thunk / undefined
 * @param {((key:string)=>unknown)|null|undefined} t 文案 thunk（跟随 locale）
 * @param {string} key DEFAULT_LABELS 的键
 * @returns {string}
 */
function resolveLabel(label, t, key) {
  if (typeof label === 'function') {
    try {
      const value = label();
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 落到下一档（thunk 抛错只损失文案，不该损失整个面板）
    }
  } else if (typeof label === 'string' && label !== '') {
    return label;
  }
  if (typeof t === 'function') {
    try {
      const value = t(key);
      if (typeof value === 'string' && value !== '') return value;
    } catch {
      // 同上
    }
  }
  return DEFAULT_LABELS[key] ?? key;
}
  return { PANEL_STATES: PANEL_STATES, TRIGGERABLE_STATES: TRIGGERABLE_STATES, STATE_ATTR: STATE_ATTR, DEFAULT_LABELS: DEFAULT_LABELS, stateError: stateError, normalizeState: normalizeState, stateFromSessions: stateFromSessions, describeError: describeError, resolveLabel: resolveLabel };
}());
__esMod["./panel/components/views.mjs"] = (function () {
/**
 * components/views.mjs —— **面板壳的状态视图组**（从 `panel/components.mjs` 原样搬出，行为一字未改）。
 *
 * 装了：`readHook`（框架注入的标准 hook prop 的读法，含「hooks 数量与顺序恒定」纪律）、
 * `loadingView` / `emptyView` / `errorView` / `stateView`、`errorProps`（剥 `children` 的第一层修复）、
 * `guardSlot`（元素槽的边界）、`isElementNode`、`resolveState`（显式 state ∪ 推导 state）。
 *
 * **依赖注入形态**：原来吃 `createComponents` 的闭包，现在把用到的名字从 `deps` 显式取；
 * **函数体一字未动**，返回值就是这组函数。
 */
function createPanelViews(deps) {
  const {
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, Boundary,
  } = deps;
  /**
   * 读一个框架注入的标准 hook prop（`usePanelInfo` / `useSessions`）——**定义在 `createComponents` 内部**，
   * 因为它要用闭包里的 `report` 与 `safeRender`（放模块顶层会丢 `report`，真踩过：`report is not defined`）。
   *
   * ═══ 为什么不能写成「有就调、没有就 return null」（真机 React #300 的真根因）═══
   * hooks 的**数量与顺序必须在同一 fiber 的两次渲染之间恒定**。外壳会在两次渲染之间改变注入的 owner props
   * 集合（平台的补装窗口 / demo 重装），旧写法「缺席 ⇒ 一个 hook 都不调」会让 hook 数 2→1 ⇒
   * `Rendered fewer hooks than expected`（#300）⇒ 面板整段进错误态、布局编辑器永不出现。
   * ⇒ 本函数在每个槽位**恒定消耗 1 个同类型 hook**：
   *    · 注入可用 ⇒ 调它（外壳给的是 `useSyncExternalStoreWithSelector` 系，实读
   *      `dsh-client-ui-renderer` 的 `bindSnapshotSelector`，fiber 级记的就是**1 个 `useSyncExternalStore`**）；
   *    · 注入缺席 ⇒ 在**同一位置**调 `useStandInHook(react)`：一个 `useSyncExternalStore` 占位
   *      （常量快照 + 空订阅）——**类型与槽数都对齐**，否则真 React 会报「change in the order of Hooks」
   *      （实测：用 `useState` 占位 ⇒ `Previous render: useState / Next render: useSyncExternalStore`）。
   * 【契约】注入的 owner hook 必须**恰好占 1 个 `useSyncExternalStore` 槽**；形状不同则数量/顺序仍会漂移，
   * 那是外壳侧的约束，本函数无法在运行时补救。
   * 【替身兼容】无 `useSyncExternalStore` 的假 react（构建期 `loadArtifact` / 单测替身）退到 `useState`
   * ——该分支只影响替身（替身不校验 hooks 顺序），真 React 一律走上面那条同类型路径。
   *
   * ═══ 选择器必须**永远传**（真机实测：`加载失败 l is not a function`）═══
   * 外壳注入的不是「取值函数」而是 `bindSnapshotSelector(source)` 产出的**选择器 hook**，实读
   * `dsh-client-ui-renderer/lib/client.js`：
   *     function bindSnapshotSelector(w) { … return function useSelector(sel, eq) {
   *       return useSyncExternalStoreWithSelector(subscribe, getSnapshot, void 0, sel, eq); }; }
   * 而 `use-sync-external-store/shim/with-selector` 的 **production.min** 产物签名是
   *     function(a /*subscribe*\/, b /*getSnapshot*\/, e /*getServerSnapshot*\/, l /*selector*\/, g /*isEqual*\/)
   * 内部那一行就是 `a = l(a)` —— **`l` 就是这个没传的选择器**。`useSelector()` 不传参 ⇒ `l === undefined`
   * ⇒ 原生 `TypeError: l is not a function`（真机报错文本逐字如此）⇒ 面板整块进错误态、工具栏 0 项。
   * 外壳自己的每一个调用点都传 （`usePanelInfo((info) => info.activePanelId)` /
   * `useSessions((s) => s)`）⇒ 这是**调用契约**，不是可选参数。
   * ⇒ 本函数**不再有「不传选择器」的路径**（默认落到 `SELECT_SNAPSHOT`）。
   * 【与两种注入形状的兼容】真正吃选择器的是外壳那一种；若某个调用方注入的是"自己就不吃参数"的取值函数
   * （单测替身常见），多传一个函数参数无副作用 ⇒ 两种形状都成立（单测有正反两条用例钉住）。
   *
   * ═══ try/catch 的边界（验收明令）═══
   * 本函数体内**一个 try/catch 都没有**（单测有静态断言锁死）：
   *   · `safeRender` **只包我们交给 hook 的 selector 回调**（我们自己写的代码：错了只该降级、
   *     不该炸整棵渲染）；
   *   · **绝不包 `hook(...)` 这个调用本身** —— 用 try/catch 吞掉 hooks 抛错＝把 hooks 链留成半坏状态，
   *     比直接报错更难查。hooks 抛错会经 `renderPanel` 冒泡到 `Panel` 的兜底：渲染**可见错误态**并上报
   *     （`GUIF-W-LISTENER-THREW`），**不静默**、不退化成「装作没注入」。
   * 唯一允许吞错的地方是 `useStandInHook` 里「压根不在 React 渲染树里」那一种（它自己就是占位实现，
   * 见该函数注释），与本节规则不冲突：那里不存在 hook 链，也没有「注入 hook 抛错」可言。
   *
   * @param {object} react 种子 react（真 React 或测试替身）
   * @param {unknown} hook 注入的 hook prop（可能缺席）
   * @param {((snapshot:unknown)=>unknown)|null} [selector] **回调**（会被 safeRender 包住）
   */
  function readHook(react, hook, selector = null) {
    if (typeof hook === 'function') {
      // ⚠ 注入的 hook 是**选择器 hook**：选择器**永远要传**（真机 `l is not a function` 的根因）。
      const pick = selector === null ? SELECT_SNAPSHOT : selector;
      const safeSelector = (snapshot) => safeRender(() => pick(snapshot), snapshot, report);
      return hook(safeSelector);
    }
    return useStandInHook(react);
  }

  // ── 三态视图（**唯一**渲染路径：显式 state 与 useSessions 推导都走这里）─────────────────

  function loadingView() {
    const IconLoading = atom('IconLoadingOutlineRegular');
    return el('div', { [ANCHORS.state]: 'loading', style: S.stateBox },
      IconLoading === undefined ? null : el(IconLoading, { size: 16 }),
      el('div', { style: S.stateTitle }, resolveLabel(null, null, 'loading')));
  }

  function emptyView(props) {
    const p = props ?? {};
    // 三个元素槽（A6/A2）：children 是冻结契约声明 Empty 必须接受的槽、action 放按钮、description 可放元素。
    // description 也可能是纯字符串 —— 字符串经过边界仍是同一个字符串（边界不产生额外 DOM）。
    return el('div', { [ANCHORS.state]: 'empty', style: S.stateBox },
      el('div', { style: S.stateTitle }, resolveLabel(p.title, p.t, 'empty')),
      guardSlot('empty-description', p.description === undefined || p.description === null ? null : el('div', null, p.description), p),
      p.action === undefined || p.action === null ? null : el('div', null, guardSlot('empty-action', p.action, p)),
      guardSlot('empty-children', p.children, p));
  }

  function errorView(props) {
    const p = props ?? {};
    const IconWarning = atom('IconWarningOutlineRegular');
    const retry = p.onRetry === undefined || p.onRetry === null
      ? null
      : renderAction({ id: 'retry', label: resolveLabel(p.retryLabel, p.t, 'retry'), icon: atom('IconRefreshOutlineRegular'), onSelect: p.onRetry, t: p.t });
    return el('div', { [ANCHORS.state]: 'error', style: S.stateBox },
      IconWarning === undefined ? null : el(IconWarning, { size: 16 }),
      el('div', { style: S.stateTitle }, resolveLabel(p.title, p.t, 'error')),
      el('code', { style: S.stateDetail }, describeError(p.error)),
      retry,
      p.children ?? null);
  }

  /** 按态取视图；`ready` ⇒ `null`（调用方渲染 children）。 */
  function stateView(state, props) {
    if (state === 'loading') return loadingView();
    if (state === 'empty') return emptyView(props);
    if (state === 'error') return errorView(props);
    return null;
  }

  /**
   * 造**错误态**的 props：**剥掉 `children`**（根因见下）。
   *
   * 为什么必须剥：这类调用点拿到的 `props.children` 往往**正是刚抛错的那棵子树**。
   * 让 fallback 再渲染它一次 ⇒ React 认为「边界自己也炸了」⇒ 卸载整棵树 ⇒
   * 真机上由官方 `SlotErrorBoundary` 兜住，用户看到的是那个空 div。
   * `boundary.mjs` 的裸类另有第三层保险（fallback 抛错也退到静态最小节点），这里是第一层。
   *
   * @param {object} props 原组件 props
   * @param {unknown} error 错因（`undefined` ⇒ 沿用 `props.error`）
   */
  function errorProps(props, error) {
    const source = props !== null && typeof props === 'object' ? props : {};
    const next = { ...source, children: null };
    if (error !== undefined) next.error = error;
    return next;
  }

  /**
   * 把一段**插件内容**包进本壳的错误边界（崩溃隔离面从 Panel 的 body 扩到其余槽位）。
   *
   * 隔离面覆盖的是「**由插件提供的元素/组件**」的每一个落点（不是只有 Panel 的 children）：
   *   Panel.actions ｜ Toolbar 的每个动作与 children ｜ List 的每一行内容与 children ｜
   *   Empty 的 action/description/children ｜ KeyValue 的 children ｜ ErrorState 的 children。
   * 不给这些槽位套边界时，插件元素在渲染期抛错会一路逃到 React 根（真机上＝官方
   * `SlotErrorBoundary` 的空 div），正是要消灭的现象。
   *
   * 边界**不产生额外 DOM**（只多一层组件），所以正常路径的 DOM 结构不变；
   * 出错时的兜底完全复用 `boundary.mjs` 那三层保险（fallback 抛错 ⇒ 静态最小错误节点）。
   *
   * @param {string} key React key（同一父节点下的多个槽位必须唯一）
   * @param {unknown} node 插件内容（`null`/`undefined` ⇒ 直接返回 null，不为空槽套边界）
   * @param {object|null|undefined} props 宿主组件的 props（供 fallback 取 t/文案）
   */
  function guardSlot(key, node, props) {
    if (node === null || node === undefined) return null;
    return el(Boundary, {
      key,
      onError: report,
      renderError: (error) => errorView(errorProps(props, error)),
    }, node);
  }

  /**
   * 是否是 **React 元素**（`createElement` 的产物）。
   * 判据的用途只有一个：**只有元素才可能在渲染期抛错**（字符串/数字是惰性数据），
   * 所以「值槽要不要套边界」由它决定 —— 这样既堵住逃逸面，又不会给纯数据套边界。
   */
  function isElementNode(value) {
    return value !== null && typeof value === 'object' && value.$$typeof !== undefined;
  }

  /**
   * 收敛「显式 state ∪ 推导 state」。非法 state **不向外抛**（抛出去会被官方 boundary 换成空 div，
   * 那是明确要避免的现象）——就地渲染错误态并把原始错因显示出来。
   */
  function resolveState(props, derived) {
    try {
      const declared = normalizeState(props?.state);
      return { state: declared === 'ready' ? derived : declared, error: null };
    } catch (error) {
      return { state: 'error', error };
    }
  }

  /**
   * 一个动作按钮：官方 Button 优先，缺席退 `<button>`；带图标时套官方 Tooltip。
   * ★ 为什么归到视图组：原在 `shell.mjs`，但**错误态的重试按钮**（`stateView`）也用它 ⇒ 归到视图组，
   * 由 `shell.mjs` 经 bag 取用（函数体一字未动）。
   */
  function renderAction(item) {
    const spec = item ?? {};
    const Button = atom('Button');
    const Tooltip = atom('Tooltip');
    const label = resolveLabel(spec.label, spec.t, spec.id ?? 'action');
    const onClick = spec.onSelect === undefined || spec.onSelect === null
      ? undefined
      : (event) => safeRender(() => spec.onSelect(spec.id, event), undefined, report);
    const disabled = spec.disabled === true;
    const hasIcon = spec.icon !== undefined && spec.icon !== null;
    const icon = hasIcon ? el(spec.icon, { size: spec.iconSize ?? 14 }) : undefined;
    const core = Button === undefined
      ? el('button', { type: 'button', key: 'core', disabled, onClick, className: spec.className, [ANCHORS.action]: String(spec.id ?? '') }, icon ?? null, label)
      : el(Button, { key: 'core', disabled, onClick, className: spec.className, icon, [ANCHORS.action]: String(spec.id ?? '') }, label);
    if (Tooltip === undefined || spec.tooltip === false || !hasIcon) return core;
    // children 走 createElement 的第三参数（不要塞进 props.children：真 React 两种写法都行，
    // 但替身会把 props.children 覆盖成子参数，塞进去的那种写法在无 DOM 测试里会静默丢子树）。
    return el(Tooltip, { key: 'tip', label }, core);
  }

  // 交回 `createComponents`：这一组就是原来那层闭包里的同名函数（引用与语义一字未改）。
  return { readHook, loadingView, emptyView, errorView, stateView, errorProps, guardSlot, isElementNode, resolveState, renderAction };
}
  return { createPanelViews: createPanelViews };
}());
__esMod["./panel/components/shell.mjs"] = (function () {
/**
 * components/shell.mjs —— **六个复合组件的实现**（从 `panel/components.mjs` 原样搬出，行为一字未改）。
 *
 * 装了：`renderAction`（官方 Button/Tooltip 优先，缺席退自研等价物）与 `Panel` / `renderPanel` /
 * `Toolbar` / `Empty` / `ErrorState` / `List` / `KeyValue` —— 每个都自带 try/catch → `errorView` 的兜底，
 * 且**所有元素槽都经 `guardSlot`**（插件内容的边界面）。
 *
 * **依赖注入形态**：原来吃 `createComponents` 的闭包，现在把用到的名字从 `deps` 显式取（其中
 * `readHook` / `stateView` / `errorProps` / `guardSlot` / `isElementNode` / `resolveState` 由
 * `./views.mjs` 产出后一并传入）；**函数体一字未动**。
 */
function createPanelComponents(deps) {
  const {
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, STATE_VALUES, Boundary,
    SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, normalizeField, sessionCount,
    readHook, loadingView, emptyView, errorView, stateView, errorProps, guardSlot, isElementNode, resolveState, renderAction,
  } = deps;
  // ── 六个复合组件 ────────────────────────────────────────────────────────────────────────

  /** Panel：面板外壳（header / body / status）；`main` 座位没有 owner props，数据**自己取**。 */
  function Panel(rawProps) {
    const props = rawProps ?? {};
    try {
      return renderPanel(props);
    } catch (error) {
      report(error);
      return el('section', { [ANCHORS.panel]: String(props.id ?? ''), style: S.panel },
        errorView(errorProps(props, error)));
    }
  }

  function renderPanel(props) {
    // **自己**从框架注入的标准 hook props 取数（`main` 的 ownerProps 是空数组，不能等它传）。
    // ⚠ 这两行必须在**每一次渲染**都按同一顺序执行，且各自恒占 1 个 hook 槽（真机 React #300 的根因）。
    const activePanelId = normalizeActivePanelId(readHook(react, props.usePanelInfo, SELECT_ACTIVE_PANEL_ID));
    const sessions = readHook(react, props.useSessions, SELECT_SNAPSHOT);
    // `undefined`（选择器说"不认识快照"）与 `null`（hook 缺席 ⇒ 占位快照）都记"不知道"，不得当成 false。
    const active = activePanelId === null || activePanelId === undefined ? null : activePanelId === props.id;
    const resolved = resolveState(props, stateFromSessions(sessions));
    const content = resolved.state === 'ready'
      ? (props.children ?? null)
      : stateView(resolved.state, errorProps(props, resolved.error ?? props.error));
    const header = el('header', { [ANCHORS.panelHeader]: String(props.id ?? ''), style: S.header },
      el('span', { [ANCHORS.panelTitle]: String(props.id ?? ''), style: S.title }, resolveLabel(props.label, props.t, 'empty')),
      // actions 槽承载插件元素（按钮/图标组件），必须和 body 一样在自己的边界里
      props.actions === undefined || props.actions === null ? null : el('span', { key: 'actions' }, guardSlot('panel-actions', props.actions, props)),
      props.close === undefined || props.close === null ? null : el('span', null, renderAction({
        id: `${props.id ?? ''}::close`,
        label: resolveLabel(props.closeLabel, props.t, 'close'),
        icon: atom('IconCloseOutlineRegular'),
        onSelect: () => { props.close(); },
        t: props.t,
      })));
    const count = sessionCount(sessions);
    const status = el('footer', {
      [ANCHORS.panelStatus]: String(props.id ?? ''),
      style: S.status,
    }, el('span', null, String(props.status ?? '')));
    return el('section', {
      [ANCHORS.panel]: String(props.id ?? ''),
      [ANCHORS.panelActive]: active === null ? 'unknown' : String(active),
      [ANCHORS.sessionsCount]: String(count),
      className: props.className,
      style: { ...S.panel, ...(props.style ?? {}) },
    },
    header,
    el('div', { [ANCHORS.panelBody]: String(props.id ?? ''), style: S.body },
      el(Boundary, {
        onError: report,
        // fallback **不带 children**：刚抛错的子树再渲染一次 = 边界自己也炸 = 整棵树被卸载
        renderError: (error) => errorView(errorProps(props, error)),
      }, content)),
    status);
  }

  /** Toolbar：一行动作（`items` + `children`）。独立使用时同样自带崩溃隔离。 */
  function Toolbar(rawProps) {
    const props = rawProps ?? {};
    try {
      const items = Array.isArray(props.items) ? props.items : [];
      // 每个动作单独一条边界：一个动作的图标组件炸了，不该带走整条工具栏（与官方「每条目一个边界」同构）
      const rendered = items.map((item, index) => {
        const key = String(item?.id ?? index);
        return el('span', { key, style: S.slot }, guardSlot(`toolbar-item-${key}`, renderAction({ ...(item ?? {}), t: props.t }), props));
      });
      return el('div', { [ANCHORS.toolbar]: String(props.id ?? ''), role: 'toolbar', style: { ...S.toolbar, ...(props.style ?? {}) } },
        rendered,
        guardSlot('toolbar-children', props.children, props));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  /** Empty：空态（独立可用；Panel/List 的空态也走它）。 */
  function Empty(rawProps) {
    const props = rawProps ?? {};
    try {
      const resolved = resolveState(props, 'empty');
      // ⚠ **不能**把 empty 态也喂 `errorProps`（它会剥 children）—— 冻结契约（contracts/components.mjs）
      // 声明 `Empty: […, 'children']`，而 Empty 的 state 恒为 'empty'（未声明时由 derived 推导成 'empty'）
      // ⇒ 走 errorProps 会让该槽**永远是死槽**（渲染不出来 = 契约没兑现）。
      // 【兑现口径，别当漏修】：
      //   · 默认 / `state="empty"` 路径 ⇒ **必须渲染 children**（在 emptyView 里由自己的边界护住）；
      //   · `state="loading"` ⇒ 不渲染 children（loadingView 本就没有 children 槽）；
      //   · `state="error"` ⇒ **必须剥 children**（errorProps 原样保留 —— 那是根因修复，
      //     fallback 再渲染刚抛错的 children 会让边界自己也炸、整棵树被卸载）。
      if (resolved.state === 'empty') return emptyView(props);
      return stateView(resolved.state, errorProps(props, resolved.error));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  /** ErrorState：错误态（`error` + `onRetry`；`children` 是可选文案/元素槽）。 */
  function ErrorState(rawProps) {
    const props = rawProps ?? {};
    try {
      const asText = typeof props.children === 'string' || typeof props.children === 'number' ? props.children : undefined;
      const view = errorView(errorProps(props, props.error ?? asText));
      const extra = asText === undefined ? guardSlot('error-children', props.children, props) : null;
      return extra === null ? view : el('div', null, view, extra);
    } catch (error) {
      return el('div', { [ANCHORS.state]: 'error', style: S.stateBox }, describeError(error));
    }
  }

  /** List：`items` + `renderItem`；空数组自动进空态；单行 `renderItem` 抛错只影响那一行。 */
  function List(rawProps) {
    const props = rawProps ?? {};
    try {
      const items = Array.isArray(props.items) ? props.items : [];
      const resolved = resolveState(props, items.length === 0 ? 'empty' : 'ready');
      if (resolved.state !== 'ready') {
        // `empty` 是**元素槽**（调用方传进来占位用的元素/文案）⇒ 同样要落在边界里（A2）
        if (resolved.state === 'empty' && props.empty !== undefined && props.empty !== null) return guardSlot('list-empty', props.empty, props);
        return stateView(resolved.state, errorProps(props, resolved.error ?? props.error));
      }
      const getKey = typeof props.getKey === 'function' ? props.getKey : null;
      const Chevron = atom('IconChevronRightOutlineRegular');
      const rows = items.map((item, index) => {
        let rowError = null;
        const rendered = typeof props.renderItem === 'function'
          ? safeRender(() => props.renderItem(item, index), null, (error) => {
            rowError = error;
            report(error);
          })
          : null;
        const key = getKey === null ? String(index) : safeRender(() => String(getKey(item, index)), String(index), report);
        // 单行渲染抛错 ⇒ 那一行显示**错因**（不是把原始 item 当文案，那会让人以为渲染成功了）
        const content = rendered ?? (rowError === null ? describeError(item) : describeError(rowError));
        return el('div', { key, [ANCHORS.row]: String(index), style: S.row },
          Chevron === undefined ? null : el(Chevron, { size: 14 }),
          // 每一行的内容单独一条边界：`renderItem` 返回的**组件**在渲染期抛错时只废掉那一行（A2）
          el('span', { style: S.rowBody }, guardSlot(`list-row-${key}`, content, props)));
      });
      return el('div', { [ANCHORS.panelBody]: String(props.id ?? ''), style: { ...S.body, padding: '0' } },
        rows,
        guardSlot('list-children', props.children, props));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  /** KeyValue：键值表（`entries` 支持 `[k,v]` / `{key|label|name, value}` / 裸字符串）。 */
  function KeyValue(rawProps) {
    const props = rawProps ?? {};
    try {
      const entries = Array.isArray(props.entries) ? props.entries : [];
      const resolved = resolveState(props, entries.length === 0 ? 'empty' : 'ready');
      if (resolved.state !== 'ready') return stateView(resolved.state, errorProps(props, resolved.error ?? props.error));
      const fields = [];
      entries.forEach((entry, index) => {
        const field = normalizeField(entry, index);
        // 值槽也是**元素槽** —— `renderable()` 明说「字符串/数字/**元素**都合法」，
        // 元素在渲染期抛错时以前会一路逃到 React 根（真机上＝官方 SlotErrorBoundary 的空 div）。
        // 只在**值为 React 元素**时套边界；字符串/数字保持原样（纯数据不包，与既有负控口径一致）。
        const valueNode = isElementNode(field.value) ? guardSlot(`keyvalue-value-${index}`, field.value, props) : field.value;
        fields.push(el('dt', { key: `k${index}`, [ANCHORS.field]: field.key, style: S.fieldKey }, field.key));
        fields.push(el('dd', { key: `v${index}`, style: S.fieldValue }, valueNode));
      });
      return el('dl', { style: S.field }, fields, guardSlot('keyvalue-children', props.children, props));
    } catch (error) {
      report(error);
      return errorView(errorProps(props, error));
    }
  }

  // 交回 `createComponents`：六个复合组件 + 动作按钮渲染器（引用与语义一字未改）。
  return { renderAction, Panel, renderPanel, Toolbar, Empty, ErrorState, List, KeyValue };
}
  return { createPanelComponents: createPanelComponents };
}());
__esMod["./panel/components.mjs"] = (function () {
  var { createRenderBoundary, safeRender } = __esMod["./panel/boundary.mjs"];
  var { panelBaseStyles } = __esMod["./kit/surface.mjs"];
  var { describeError, normalizeState, resolveLabel, stateFromSessions } = __esMod["./panel/state.mjs"];
  var { createPrimitivesSeat } = __esMod["./kit/primitives.mjs"];
  var { guifLiteral, guifPrivateVar, guifVar, dsw } = __esMod["./kit/tokens.mjs"];
  var { createPanelViews } = __esMod["./panel/components/views.mjs"];
  var { createPanelComponents } = __esMod["./panel/components/shell.mjs"];
/**
 * components.mjs —— 对外暴露的**六个复合组件**（props 契约见
 * `src/client/contracts/components.mjs`，**只许加可选 props，不许改名/删名**）。
 *
 *   Panel / Toolbar / Empty / ErrorState / List / KeyValue
 *
 * ═══ 三条机制（不是风格）═══
 * ① **必须用 `react.createElement`**：自研打包器只重写 import/export，**不做 JSX / TS 变换**。
 * ② **只用官方 38 个包真实用过的 primitives 子集**：取用一律经 `kit/primitives.mjs` 的
 *    `createPrimitivesSeat` 闸门；种子缺席时 `get()` 返回 `undefined`，组件退到自研等价物
 *    （`<button>` / `<span>`），**不炸页面**。
 * ③ **壳组件自己 catch 渲染错误**：每个组件最外层是 try/catch —— 我们自己组装期间抛错
 *    → 就地渲染 ErrorState；子树（插件内容）抛错 → 由壳内的 `GuiFrameRenderBoundary` 接住。
 *    官方 boundary 只给一个空 div，那不叫错误态。
 *
 * ═══ 样式 ═══
 * 每个取值位置都是 `var(...)`：颜色落到 `--dsw-*` token，尺寸/间距落到 `--guif-*`（公开）或
 * `--guif-private-*`（私有）变量，字面量**只允许出现在 var() 的 fallback 位置**。
 * 取用一律经 `kit/tokens.mjs` 的三个助手，名字不在白名单即抛（不会静默写出悬空 token）。
 *
 * 本文件**零副作用**：`createComponents(env)` 只造闭包，不注册任何东西（注册在 `index.mjs`）。
 */









/** 机检锚点（结构断言用；也是真机收口时肉眼可见的抓手）。 */
const ANCHORS = Object.freeze({
  panel: 'data-guif-panel',
  panelHeader: 'data-guif-panel-header',
  panelTitle: 'data-guif-panel-title',
  panelBody: 'data-guif-panel-body',
  panelStatus: 'data-guif-panel-status',
  panelActive: 'data-guif-active',
  sessionsCount: 'data-guif-sessions-count',
  toolbar: 'data-guif-toolbar',
  action: 'data-guif-action',
  row: 'data-guif-row',
  field: 'data-guif-field',
  state: 'data-guif-state',
});

/** 可显式触发的三态在树上的锚点值（`data-guif-state` 的取值）。 */
const STATE_VALUES = Object.freeze(['loading', 'empty', 'error']);

/**
 * 面板骨架的**公开变量缺省值不在这里，也不在元素上** —— 它们在 `var()` 的**回退位**
 * （`kit/surface.mjs`：`guifLiteral('--guif-panel-padding', '10px')` / `'-gap', '8px'` /
 * `'-radius', '12px'`；本文件的 `styles()` 取用同一份）。冻结读数在
 * `tests/unit/panel-components.test.mjs` 与 `tests/unit/dock-style-vars.test.mjs`。
 *
 * ═══ **为什么不写进面板根内联 style** —— 那样写会踩两个坑 ═══
 * 把缺省值铺成面板根上的**内联自定义属性**（`style={{...defaults, ...S.panel}}`）看着更顺，
 * 但有两个坑，而且「接入方在任意父级都能覆盖」这句话在那种写法下**根本不成立**：
 *   ① 自定义属性走继承，**元素自己的声明恒胜过继承值** ⇒ 祖先给的覆盖值在这棵子树上被挡死；
 *   ② 表里 `--guif-panel-radius` 的值是 `var(--dsw-corner-shape)`，而 `--dsw-corner-shape` 是
 *      **corner-shape 用的关键字**（外壳只在 `@supports (corner-shape:superellipse(1.5))` 里声明它，
 *      值形如 `superellipse(1.5)`）—— 拿它当 `border-radius` 用 ⇒ 计算值非法（IACVT）⇒
 *      **圆角退化成 0**，而真正想要的 `12px` 兜底永远轮不到。
 * ⇒ 现在：**缺省只在回退位，元素上一个 `--guif-*` 都不声明**。观感回到设计值（面板根 12px /
 *   关闭按钮 6px / 内容区 padding 10px / gap 8px），祖先覆盖真的生效。
 * 牙：`tests/unit/dock-style-vars.test.mjs`（渲染树里**不得**有 `--guif-*` 键）与
 *     `tests/client/panel-styles.test.mjs`（源码级扫「把 `--guif-*` 当对象键」的写法）。
 */

/**
 * 认「**根本不在 React 渲染树里**」这一类错 —— `readHook` 缺席分支唯一允许吞掉的错。
 *
 * 组件被当普通函数直接调用时（元素树断言层就这么调 `Panel(props)`：`tests/client/panel-states.test.mjs`），
 * React 的 dispatcher 是 `null` ⇒ 任何 hook 一调就炸。两种真实形态都要认：
 *   · React 19：`resolveDispatcher` 只 `console.error('Invalid hook call…')` 后**返回 null**，
 *     于是属性访问继续炸 ⇒ `TypeError: Cannot read properties of null (reading 'useSyncExternalStore')`；
 *   · 老版本/其它入口：直接 `Error: Invalid hook call. Hooks can only be called inside…`。
 *
 * 那种场合**压根不存在 hook 链**（没有 fiber、没有上一次渲染），吞掉它不可能掩盖「数量/顺序漂移」——
 * 这是本条 catch 的合法性来源。**其余错误一律继续冒泡**（真渲染期抛的 hooks 错必须让面板显形）。
 * 按消息文本判而不按错误类型判：同一件事在各版本分别抛 `TypeError` 与 `Error`，按类型会漏。
 */
function isNoDispatcherError(error) {
  if (error === null || typeof error !== 'object') return false;
  const message = typeof error.message === 'string' ? error.message : '';
  if (/Invalid hook call/i.test(message)) return true;
  return /read(ing)? propert(y|ies) of (null|undefined)/.test(message) && message.includes('useSyncExternalStore');
}

/** 占位 hook 的空订阅（**恒等引用**：每次渲染传同一个函数，`useSyncExternalStore` 才不会反复重订阅）。 */
const NOOP_SUBSCRIBE = () => () => {};
/** 占位 hook 的常量快照（恒 `null`；primitive 恒等，永不触发更新循环）。 */
const NULL_SNAPSHOT = () => null;

/**
 * 原样取回快照的选择器 —— 与外壳自己的 `useSessions((s) => s)`（`dsh-client-ui-workspace` 真实调用点）同款。
 * ⚠ 它返回的**就是**快照对象：安全的前提是外壳的 store 快照引用稳定（外壳自己就这么用 ⇒ 这是它的契约）。
 */
const SELECT_SNAPSHOT = (snapshot) => snapshot;

/**
 * `usePanelInfo` 的选择器：**只取一个原语**（外壳自己的用法就是这个形状：
 * `usePanelInfo((info) => info.activePanelId)`，见 `dsh-client-ui-layout` / `dsh-client-ui-sidebar`）。
 *
 * ⚠ 为什么必须返回**原语**：`useSyncExternalStoreWithSelector` 会拿选择结果与上一次比较（默认 `Object.is`），
 * 选择器若返回新对象，React 每次都判「变了」⇒ 无限重渲染。`activePanelId` 是 `string | null`，天然稳定。
 * 不认识快照（`null`/非对象）⇒ `undefined`，调用点据此走"不知道"分支。
 */
const SELECT_ACTIVE_PANEL_ID = (info) => (info === null || typeof info !== 'object' ? undefined : info.activePanelId);

/**
 * 把 `usePanelInfo` 的返回值**归一化成 `activePanelId`**（`string | null | undefined`）。
 *
 * 为什么还要在调用点再兜一次：`readHook` 返回的是**注入 hook 的返回值**，而选择器是**交给 hook**的：
 *   · 外壳的选择器 hook（`bindSnapshotSelector`）会**应用**我们传的选择器 ⇒ 已经拿到 `activePanelId`（原语）；
 *   · "自己不吃参数"的取值函数（单测 / 旧接入方常见）会忽略选择器、直接返回**整个快照对象** ⇒ 这里补一次提取。
 * 两种形状都能得到同一种原语值；`null`（hook 缺席 ⇒ 占位快照）原样返回，调用点据此记"不知道"。
 */
const normalizeActivePanelId = (value) => {
  if (value === null) return null;
  if (value !== null && typeof value === 'object') return value.activePanelId ?? null;
  return value;
};

/**
 * `readHook` 在「注入缺席」时用的**占位 hook**：恒定消耗**恰好 1 个 `useSyncExternalStore` 槽**。
 *
 * 为什么必须真是个 hook、且必须是这个类型：外壳在两次渲染之间改变注入 owner 集合时（平台补装窗口 /
 * demo 重装），占用槽数一变 React 就报 #300 / #310，类型一变报「change in the order of Hooks」。
 * 详见 `readHook` 的注释。
 *
 * ═══ 唯一的 catch：`isNoDispatcherError` 放行（真踩过）═══
 * 无 DOM 的元素树断言层（`tests/client/panel-states.test.mjs`）把组件**当普通函数直接调**：
 * `Panel({ id: 'p-loading', state: 'loading' })`。那时没有 fiber、没有 dispatcher，任何 hook 一调就炸
 * ——旧写法（不包）会让整个「缺席」路径变成 `Cannot read properties of null (reading 'useSyncExternalStore')`，
 * 面板显示成这句废话而不是它真正的状态。该场合**不存在 hook 链**，所以吞掉这一个错不可能掩盖
 * 数量/顺序漂移；**其它任何错误照常冒泡**（真渲染期抛的错必须让面板显形）。
 *
 * @param {object} react 种子 react（真 React 或测试替身）
 * @returns {unknown} 常量 `null`（占位快照）
 */
function useStandInHook(react) {
  if (typeof react.useSyncExternalStore === 'function') {
    try {
      return react.useSyncExternalStore(NOOP_SUBSCRIBE, NULL_SNAPSHOT, NULL_SNAPSHOT);
    } catch (error) {
      if (!isNoDispatcherError(error)) throw error;
      return null;
    }
  }
  // 替身（假 react）没有 useSyncExternalStore：退到 useState；替身不校验 hooks 顺序，此分支只影响替身。
  const placeholder = react.useState(null);
  return placeholder[0];
}

/**
 * 造六个复合组件。
 * @param {{seeds?:object, note?:(code:string,message:string)=>void}} env 装配面（`install(ctx, env)` 的 env）
 * @returns {{Panel:Function, Toolbar:Function, Empty:Function, ErrorState:Function, List:Function, KeyValue:Function,
 *   primitives:object, boundary:Function, styles:object}}
 */
function createComponents(env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  const seeds = bag.seeds !== null && typeof bag.seeds === 'object' ? bag.seeds : {};
  const react = seeds.react;
  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
    throw new Error('[gui-frame] createComponents(env) 需要 env.seeds.react（没有种子就没有 React 树——不猜第二份 react）');
  }
  const note = typeof bag.note === 'function' ? bag.note : null;
  const primitives = createPrimitivesSeat(seeds.primitives);
  const Boundary = createRenderBoundary(react);
  const el = react.createElement;
  const S = styles();
  // ⚠ 这里不铺 `defaults`：缺省值只在 `var()` 的回退位（为什么，见文件头那两个坑）。

  /** 官方原子组件（缺席 ⇒ `undefined`，调用点自己退到自研等价物）。 */
  const atom = (name) => primitives.get(name);

  /** 上报（壳内部自 catch 时调）。码只能取冻结集合里的码：`GUIF-W-LISTENER-THREW`。 */
  const report = (error) => {
    if (note !== null) note('GUIF-W-LISTENER-THREW', describeError(error));
  };

  // ── 组件实现（**状态视图组 → `./components/views.mjs`**；
  //    六个复合组件 + 原子使用点 → `./components/shell.mjs`。两处都只吃显式 bag，**函数体一字未动**）──
  const views = createPanelViews({
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, Boundary,
  });
  const shell = createPanelComponents({
    react, el, S, atom, report, safeRender, describeError, normalizeState, resolveLabel,
    stateFromSessions, ANCHORS, STATE_VALUES, Boundary,
    SELECT_SNAPSHOT, SELECT_ACTIVE_PANEL_ID, normalizeActivePanelId, useStandInHook, normalizeField, sessionCount,
    // 视图组整包转交（`readHook` / `stateView` / `errorView` / `emptyView` / `loadingView` / `errorProps` / `guardSlot` / `isElementNode` / `resolveState`）
    ...views,
  });
  const { Panel, Toolbar, Empty, ErrorState, List, KeyValue } = shell;

  return { Panel, Toolbar, Empty, ErrorState, List, KeyValue, primitives, boundary: Boundary, styles: S };
}

/** 骨架样式表（**每个取值都是 `var(...)`**：颜色 → `--dsw-*`，尺寸 → `--guif-*` / `--guif-private-*`）。 */
function styles() {
  const stroke = guifVar('--guif-panel-border', '--dsw-elevation-stroke');
  // ★ 脸 / 头 / 标题 / 内容区**一律取面板基类**（`panel/base.mjs`）：与浮出面板共用同一份皮。
  //   这里与 `overlay/panel.mjs` 曾各写一套，浮出面板那边漏了底面 ⇒ 用户当场判
  //   「你现在的面板连背景都没有」。现在表面规则只有一份，两处不可能再漂移。
  const base = panelBaseStyles();
  return Object.freeze({
    panel: Object.freeze({ ...base.frame, gap: guifLiteral('--guif-panel-gap', '8px'), height: '100%' }),
    header: base.header,
    title: base.title,
    body: base.body,
    status: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minHeight: guifPrivateVar('--guif-private-status-min-height', '24px'),
      padding: '4px 8px',
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
      borderTop: `1px solid ${stroke}`,
    }),
    toolbar: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: guifLiteral('--guif-toolbar-gap', '6px'),
      padding: '4px 0',
    }),
    slot: Object.freeze({ display: 'inline-flex' }),
    stateBox: Object.freeze({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      padding: '16px 12px',
      textAlign: 'center',
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
    }),
    stateTitle: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-primary'),
      fontWeight: 600,
    }),
    stateDetail: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-tertiary'),
      background: guifVar('--guif-panel-bg', '--dsw-alias-markdown-code-block'),
      fontSize: dsw('--dsw-font-xs-13-font-size'),
      padding: '6px 8px',
      borderRadius: guifVar('--guif-panel-radius', '--dsw-corner-shape'),
      maxWidth: '100%',
      overflowWrap: 'anywhere',
    }),
    row: Object.freeze({
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      minHeight: guifPrivateVar('--guif-private-row-min-height', '28px'),
      padding: '2px 4px',
      borderRadius: guifVar('--guif-panel-radius', '--dsw-corner-shape'),
    }),
    rowBody: Object.freeze({ minWidth: 0, flex: '1 1 auto' }),
    field: Object.freeze({
      display: 'grid',
      gridTemplateColumns: 'minmax(72px, max-content) 1fr',
      gap: '4px 10px',
      alignItems: 'baseline',
      margin: 0,
      padding: '4px 8px',
    }),
    fieldKey: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-secondary'),
      fontSize: 'var(--dsw-font-xxs-12-font-size)',
    }),
    fieldValue: Object.freeze({
      color: guifVar('--guif-panel-fg', '--dsw-alias-label-primary'),
      overflowWrap: 'anywhere',
      margin: 0,
    }),
  });
}

/** `[k, v]` / `{key|label|name, value}` / `{k, v}` / 裸字符串 ⇒ `{key, value}`。 */
function normalizeField(entry, index) {
  if (Array.isArray(entry)) return { key: String(entry[0] ?? index), value: renderable(entry[1]) };
  if (entry !== null && typeof entry === 'object') {
    const key = entry.key ?? entry.label ?? entry.name ?? `#${index}`;
    return { key: String(key), value: renderable(entry.value ?? entry.v ?? '') };
  }
  return { key: String(entry ?? index), value: '' };
}

/** 值原样交给 React（字符串/数字/元素都合法）；普通对象序列化成一行（不猜渲染方式）。 */
function renderable(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.$$typeof === undefined) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

/** 会话数（`SessionListSnapshot.items`）；形状不认识时记 0（**不猜**）。 */
function sessionCount(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return 0;
  const items = snapshot.items;
  return Array.isArray(items) ? items.length : 0;
}
  return { ANCHORS: ANCHORS, STATE_VALUES: STATE_VALUES, createComponents: createComponents };
}());
__esMod["./panel/index.mjs"] = (function () {
  var { COMPONENT_NAMES } = __esMod["./contracts/components.mjs"];
  var { createComponents } = __esMod["./panel/components.mjs"];
/**
 * index.mjs —— **面板骨架**（能力②）的装配入口。
 *
 * 装配契约 v1：`install(ctx, env)`，`env = { service, seeds }`（只增不改不删）。
 * 本文件做两件事，副作用**全部**经 `ctx.effect` 挂在**调用方** fiber 上：
 *   ① 造六个复合组件（`createComponents(env)`，纯闭包，无副作用）；
 *   ② 用冻结名逐个 `service.components.register(name, Component)` 登记
 *      （`components.register` 内部已经按调用方 fiber 记 effect，本文件再包一层 ctx.effect 是为了
 *      「install 的每一条副作用都能在调用方 fiber 的 effect 表里被看见/被一次性撤掉」）。
 *
 * 不做什么：**不注册座位**（座位属于坞＝能力①，见 `src/client/dock.mjs`）；不改 `entry.mjs`。
 */




/** 本能力对外登记的名字（＝冻结的六个复合组件名；顺序即登记顺序）。 */
const PANEL_COMPONENT_NAMES = COMPONENT_NAMES;

/** 装配结果形状（`installed=false` 时 `reason` 说明为什么没装 —— 绝不静默半装）。 */
function result(installed, reason, extra) {
  return { capability: 'panel', installed, reason, ...(extra ?? {}) };
}

/**
 * 装配面板能力。
 * @param {object} ctx 调用方 Cordis ctx（副作用落它的 fiber）
 * @param {{service?:object, seeds?:object}} env 装配面
 */
function install(ctx, env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  const service = bag.service;
  if (service === null || typeof service !== 'object') return result(false, 'no-service');
  if (typeof ctx?.effect !== 'function') return result(false, 'no-ctx-effect');
  const face = service.components;
  if (face === null || typeof face !== 'object' || typeof face.register !== 'function') {
    return result(false, 'no-components-face');
  }
  const note = (code, message) => {
    if (typeof service.__note === 'function') service.__note(code, message);
  };
  let set;
  try {
    set = createComponents({ seeds: bag.seeds, note });
  } catch (error) {
    note('GUIF-W-LISTENER-THREW', `面板组件装配失败（缺 react 种子？）：${error?.message ?? error}`);
    return result(false, 'no-react-seed');
  }
  const registered = [];
  const disposers = [];
  for (const name of COMPONENT_NAMES) {
    const Component = set[name];
    // 每个组件一条独立 effect：单条失败不牵连同一条链上的其余组件。
    const dispose = ctx.effect(() => {
      const off = face.register(name, Component);
      return () => {
        if (typeof off === 'function') off();
      };
    }, `gui-frame: panel component ${name}`);
    registered.push(name);
    disposers.push(dispose);
  }
  let done = false;
  return result(true, null, {
    components: set,
    registered,
    dispose() {
      if (done) return;
      done = true;
      for (const dispose of disposers) dispose();
    },
  });
}

/** 供坞/测试直接拿到组件集合（走同一条 `createComponents`，不另起第二份实现）。 */
function createPanelComponents(env) {
  const bag = env !== null && typeof env === 'object' ? env : {};
  return createComponents({ seeds: bag.seeds, note: bag.note });
}
  return { PANEL_COMPONENT_NAMES: PANEL_COMPONENT_NAMES, install: install, createPanelComponents: createPanelComponents };
}());
__esMod["./overlay/dismiss.mjs"] = (function () {
/**
 * dismiss.mjs —— **Esc 与点外关闭**。
 *
 * 三条机制，逐条对着 Radix（`@radix-ui/react-dismissable-layer@1.1.19`，MIT，只借机制不抄码）：
 *
 * ① **判内外用 React 树，不用 DOM 树**：浮层内容可能在 portal 里（DOM 上不是兄弟），
 *    `contains()` 判不出来 ⇒ 由浮层根节点的 `onPointerDownCapture` 打标（宿主把它接到这里）。
 * ② **`pointerdown` 监听延迟一个 macrotask 才挂**：否则「打开浮层的那一次点击」会立刻把它关掉。
 * ③ **六种后续事件的「捕获期置 true / 冒泡期置 false」拦截账本**：
 *    `['pointerup','mousedown','mouseup','touchstart','touchend','click']` 同时挂捕获期与冒泡期，
 *    账本里任一为 `true` ⇒ **这次外部交互是被拦截的**（典型：**拖拽在浮层外松手**）⇒ **不关**。
 *
 * 额外两条本项目口径：
 *  - **Esc 只在真的关掉一层时 `preventDefault`**（捕获期只打标、不吞事件，
 *    免得抢掉插件自己的 Esc）；
 *  - **始终只作用最上层**：Esc 关栈顶，点外也只关栈顶。
 *
 * 本文件不碰 React、不碰服务面：注入 `dom` / `schedule` 即可在 node 里直测（L0/L3）。
 */

/**
 * 六种后续事件（真源逐字清单）。
 * 捕获期置 `true` / 冒泡期置 `false` —— 账本非空即「外部交互被拦截」。
 */
const OUTSIDE_INTERCEPTION_EVENTS = Object.freeze([
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'click',
]);

/** 手势进行中的显式标记键（拖拽在飞时由业务侧 hold/release）。 */
const GESTURE_HOLD_KEY = 'guif-gesture';

/**
 * 拦截账本：**纯状态机**（不碰 DOM）。
 * `mark(type, true)` / `mark(type, false)` 由捕获/冒泡两个监听器驱动；
 * `hold()` / `release()` 是业务侧（拖动手势）的显式标记。
 */
function createInterceptionLedger() {
  const state = new Map();
  return {
    types: OUTSIDE_INTERCEPTION_EVENTS,
    mark(type, value) {
      state.set(type, value === true);
      return value === true;
    },
    hold(key = GESTURE_HOLD_KEY) {
      state.set(key, true);
    },
    release(key = GESTURE_HOLD_KEY) {
      state.set(key, false);
    },
    /** 任一为 `true` ⇒ 被拦截（真源原文的判据）。 */
    isIntercepted() {
      for (const value of state.values()) if (value === true) return true;
      return false;
    },
    snapshot() {
      return Object.fromEntries(state.entries());
    },
    reset() {
      state.clear();
    },
    size() {
      return state.size;
    },
  };
}

/**
 * 造一个点外关闭控制器。
 *
 * @param {{dom:object, isInside:(event:object)=>boolean, onDismiss:(event:object, reason:string)=>void,
 *   ledger?:object, schedule?:(fn:Function)=>unknown, cancel?:(handle:unknown)=>void, enabled?:()=>boolean}} options
 *   - `dom`：document-like（必须支持 addEventListener/removeEventListener；测试可注入替身）
 *   - `isInside`：**React 树判内外**（宿主用浮层根的 `onPointerDownCapture` 打标后回读）
 *   - `schedule`：macrotask 调度器（缺省 `setTimeout(fn, 0)`；测试可注入同步/手动触发器）
 * @returns {{attach:Function, detach:Function, onPointerDownCapture:Function, ledger:object,
 *   armed:Function, calls:Function}}
 */
function createDismissController(options = {}) {
  const dom = options.dom;
  const ledger = options.ledger ?? createInterceptionLedger();
  const schedule = typeof options.schedule === 'function' ? options.schedule : (fn) => setTimeout(fn, 0);
  const cancel = typeof options.cancel === 'function' ? options.cancel : (handle) => clearTimeout(handle);
  const eventLog = [];

  let armed = false;
  let pending = null;
  let attached = false;
  // React 树判内外的标记：由浮层根的 onPointerDownCapture 置 true，决策时消费后清零
  let insideReactTree = false;

  const captureMarker = (event) => {
    ledger.mark(event.type, true); // 捕获期：这次外部交互「正在进行」
    eventLog.push({ phase: 'capture', type: event.type });
  };
  const bubbleMarker = (event) => {
    ledger.mark(event.type, false); // 冒泡期：这次外部交互「已经走完」
    eventLog.push({ phase: 'bubble', type: event.type });
  };

  const onPointerDown = (event) => {
    if (options.enabled !== undefined && options.enabled() === false) return;
    const inside = insideReactTree || (typeof options.isInside === 'function' && options.isInside(event) === true);
    insideReactTree = false;
    if (inside) {
      eventLog.push({ phase: 'pointerdown', type: 'inside' });
      return; // ① React 树判内外：点在浮层自己身上 ⇒ 什么都不做
    }
    if (ledger.isIntercepted()) {
      // ③ 账本非空 ⇒ 这次外部交互是被拦截的（拖拽在层外松手）⇒ 不关
      eventLog.push({ phase: 'pointerdown', type: 'intercepted' });
      ledger.reset();
      return;
    }
    eventLog.push({ phase: 'pointerdown', type: 'outside' });
    ledger.reset();
    if (typeof options.onDismiss === 'function') options.onDismiss(event, 'outside');
  };

  return {
    ledger,
    /** 浮层根节点把它接到 `onPointerDownCapture` 上（React 树判内外的唯一入口）。 */
    onPointerDownCapture() {
      insideReactTree = true;
    },
    armed() {
      return armed;
    },
    /** 事件账本（测试/诊断读得到「谁在捕获期、谁在冒泡期」）。 */
    calls() {
      return [...eventLog];
    },
    /** 挂监听：六种事件**同时**挂捕获期与冒泡期；`pointerdown` **延迟一个 macrotask** 才挂（②）。 */
    attach() {
      if (attached) return this;
      attached = true;
      for (const type of OUTSIDE_INTERCEPTION_EVENTS) {
        dom.addEventListener(type, captureMarker, { capture: true });
        dom.addEventListener(type, bubbleMarker, { capture: false });
      }
      pending = schedule(() => {
        pending = null;
        armed = true;
        dom.addEventListener('pointerdown', onPointerDown, { capture: false });
      });
      return this;
    },
    /** 摘监听（**逐条对称摘**，含还没武装的那次延迟）。 */
    detach() {
      if (!attached) return this;
      attached = false;
      armed = false;
      if (pending !== null) {
        cancel(pending);
        pending = null;
      }
      for (const type of OUTSIDE_INTERCEPTION_EVENTS) {
        dom.removeEventListener(type, captureMarker, { capture: true });
        dom.removeEventListener(type, bubbleMarker, { capture: false });
      }
      dom.removeEventListener('pointerdown', onPointerDown, { capture: false });
      insideReactTree = false;
      return this;
    },
  };
}

/**
 * 造一个 Esc 控制器：**只关最上层**，且**只在真关掉一层时 `preventDefault`**。
 *
 * @param {{dom:object, top:()=>object|null, onEscape:(entry:object)=>void, enabled?:()=>boolean}} options
 *   `top()` 返回栈顶条目（`null` = 没有浮层）；`onEscape` 负责真正关闭它
 * @returns {{attach:Function, detach:Function, handle:Function}}
 */
function createEscapeController(options = {}) {
  const dom = options.dom;
  let attached = false;

  const handle = (event) => {
    if (event === null || event === undefined) return false;
    if (event.key !== 'Escape' && event.key !== 'Esc') return false;
    if (options.enabled !== undefined && options.enabled() === false) return false;
    const entry = typeof options.top === 'function' ? options.top() : null;
    if (entry === null || entry === undefined) return false;
    if (entry.closable === false) return false;
    if (typeof options.onEscape === 'function') options.onEscape(entry);
    // 只有「真的关掉了一层」才吞掉事件（捕获期只打标，不抢插件的 Esc）
    if (typeof event.preventDefault === 'function') event.preventDefault();
    return true;
  };

  return {
    handle,
    attach() {
      if (attached) return this;
      attached = true;
      // 捕获期：抢在插件之前看到 Esc（`defaultPrevented` 协作）
      dom.addEventListener('keydown', handle, { capture: true });
      return this;
    },
    detach() {
      if (!attached) return this;
      attached = false;
      dom.removeEventListener('keydown', handle, { capture: true });
      return this;
    },
  };
}
  return { OUTSIDE_INTERCEPTION_EVENTS: OUTSIDE_INTERCEPTION_EVENTS, GESTURE_HOLD_KEY: GESTURE_HOLD_KEY, createInterceptionLedger: createInterceptionLedger, createDismissController: createDismissController, createEscapeController: createEscapeController };
}());
__esMod["./overlay/family.mjs"] = (function () {
/**
 * family.mjs —— **弹层族**：Dialog / Popover / Tooltip / HoverCard 的宿主侧容器
 * （对外暴露复合组件、原子件由插件自行取用）。
 *
 * 纪律：**复用官方 primitives 的原子件**（`Modal` / `Menu` / `Tooltip` / `HoverCard`），
 * GUIFrame 只补「组合与行为约定」——不重画外观、不重复造原子。
 * 官方实测签名（全部从外壳产物反推）：
 *   `Modal({open,onClose,title,closeLabel,description,children,footer,className,contentClassName,headless})`
 *   `Menu({open,anchor,items,selectedId,onSelect,onClose,align,side,portal,…})`
 *   `Tooltip({label,side,delayMs,disabled,maxWidth,children})`（**children 必须能接 ref**）
 *   `HoverCard({anchor,content,openDelayMs,disabled,copyText,copyLabel,copiedLabel})`
 *   `Toast` 无宿主 ⇒ 见 `toast.mjs`（队列/堆叠自研）。
 *
 * ⚠ 原子件缺失时（种子表变动、rc 期改名）**不抛错**：退化成「不渲染 + 记一条使用记录」，
 * 由宿主转到诊断（任何一处失败都不许把整页带走）。
 */

/** 族 → 官方原子件名（单一真源；`toast` 的宿主在 `toast.mjs`）。 */
const FAMILY_ATOMS = Object.freeze({
  dialog: 'Modal',
  popover: 'Menu',
  tooltip: 'Tooltip',
  hoverCard: 'HoverCard',
  toast: 'Toast',
});

/** 取官方原子（拿不到返回 `null`）。 */
function resolveAtom(primitives, name) {
  if (primitives === null || primitives === undefined || typeof primitives !== 'object') return null;
  const atom = primitives[name];
  return typeof atom === 'function' ? atom : null;
}

/**
 * 造一族容器组件（每个都只是官方原子的一层**薄壳**：补默认值 + 记录使用情况）。
 * @param {object} react 种子里的 React
 * @param {object|null} primitives 官方 primitives 种子
 * @returns {{Dialog:Function, Popover:Function, Tooltip:Function, HoverCard:Function,
 *   atoms:object, usage:Function, missing:Function}}
 */
function createFamily(react, primitives) {
  const usageRows = [];
  const missingRows = [];

  const record = (kind, atomName, used) => {
    usageRows.push({ kind, atom: atomName, used });
    if (!used) missingRows.push({ kind, atom: atomName });
  };

  /** Dialog：官方 Modal 的薄壳（模态 ⇒ 宿主据此决定要不要锁 body 的 pointer-events）。 */
  function Dialog(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.dialog);
    record('dialog', FAMILY_ATOMS.dialog, atom !== null);
    if (atom === null) return null;
    return react.createElement(atom, {
      open: props.open !== false,
      onClose: props.onClose,
      title: props.title,
      closeLabel: props.closeLabel,
      description: props.description,
      footer: props.footer,
      className: props.className,
      contentClassName: props.contentClassName,
      headless: props.headless === true,
    }, props.children ?? null);
  }

  /** Popover：官方 Menu 的薄壳（锚点定位 + 边界 clamp 由官方内部负责）。 */
  function Popover(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.popover);
    record('popover', FAMILY_ATOMS.popover, atom !== null);
    if (atom === null) return null;
    return react.createElement(atom, {
      open: props.open !== false,
      anchor: props.anchor,
      getAnchorRect: props.getAnchorRect,
      items: props.items ?? [],
      selectedId: props.selectedId,
      selectedIds: props.selectedIds,
      onSelect: props.onSelect,
      onClose: props.onClose,
      align: props.align ?? 'start',
      side: props.side ?? 'bottom',
      portal: props.portal !== false,
      dense: props.dense === true,
      compact: props.compact === true,
      footer: props.footer,
      className: props.className,
    });
  }

  /** Tooltip：官方 Tooltip 的薄壳（**必须把裸文本包成元素**，官方要求 children 能接 ref）。 */
  function Tooltip(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.tooltip);
    record('tooltip', FAMILY_ATOMS.tooltip, atom !== null);
    if (atom === null) return props.children ?? null;
    const child = props.children;
    const safeChild = typeof child === 'string' || typeof child === 'number'
      ? react.createElement('span', null, String(child))
      : child ?? react.createElement('span', null);
    return react.createElement(atom, {
      label: props.label,
      side: props.side ?? 'bottom',
      delayMs: props.delayMs ?? 0,
      disabled: props.disabled === true,
      maxWidth: props.maxWidth,
    }, safeChild);
  }

  /** HoverCard：官方 HoverCard 的薄壳。 */
  function HoverCard(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.hoverCard);
    record('hoverCard', FAMILY_ATOMS.hoverCard, atom !== null);
    if (atom === null) return props.children ?? null;
    return react.createElement(atom, {
      anchor: props.anchor,
      content: props.content,
      openDelayMs: props.openDelayMs,
      disabled: props.disabled === true,
    });
  }

  return {
    Dialog,
    Popover,
    Tooltip,
    HoverCard,
    atoms: { ...FAMILY_ATOMS },
    /** 使用记录（测试/诊断：证明「确实走的是官方原子」）。 */
    usage() {
      return usageRows.map((row) => ({ ...row }));
    },
    missing() {
      return missingRows.map((row) => ({ ...row }));
    },
  };
}

/** 弹层族里**哪些是模态**（模态才需要锁 body 的 pointer-events；浮动窗/气泡/吐司不是）。 */
function isModalFamily(family) {
  return family === 'dialog';
}
  return { FAMILY_ATOMS: FAMILY_ATOMS, resolveAtom: resolveAtom, createFamily: createFamily, isModalFamily: isModalFamily };
}());
__esMod["./overlay/styles.mjs"] = (function () {
/**
 * styles.mjs —— **浮层宿主容器**的样式（宿主容器样式归 overlay 域）。
 *
 * 为什么搬到这里：这两条样式描述的是 **overlay 自己的宿主节点**（整屏点击穿透的根容器 + 每层的包裹节点），
 * 却住在 window/styles.mjs 里 ⇒ 浮层能力要反向 import 窗口能力（能力↔能力直连）。归位后
 * overlay/** 自己拥有它，窗口能力不再被浮层「借用」。
 *
 * 契约不变（真机结论原样带走）：根容器**必须保持点击穿透**（pointerEvents:none），每层用
 * `display:contents` 把子树恢复成 `auto` —— 真机实测里坞入口全员点不动就是根容器变 auto 造成的。
 */
/**
 * OverlayHost 根容器的样式：**必须保持点击穿透（`pointerEvents: 'none'`）**。
 *
 * 官方 `shell.overlay` 的 layer 本体是点击穿透的（doc 原文「click-through — entries opt back into
 * pointer events」）—— 但「opt back in」是让**条目**（每扇窗 / 弹层 / 吐司）恢复可交互，
 * **不是**让这个 `inset: 0` 的整屏空容器恢复：容器一旦 `auto`，它就成了**全屏遮罩**，
 * 页面上任何真鼠标点击都会落在它身上。
 * 真机实测（`verify/real-machine` 的命中测试）：坞入口与四个面板动作**全员**命中
 * 「遮挡(DIV.)」—— 那个无 class 的 DIV 就是这个整屏容器 ⇒ 用户用鼠标点不动界面。
 * ⇒ 根容器恒 `none`（点击穿透），每层由 `layerStyle()` 的包裹节点把子树恢复成 `auto`。
 * @param {number} rootZ 根层号（来自数字层级表的「下带」，缺省用内容层基线 20）
 */
function overlayRootStyle(rootZ) {
  return {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: rootZ,
  };
}

/**
 * 单层包裹节点（`OverlayHost` 里每层一个）的样式。
 *
 * `display: contents` ⇒ **不生成盒子**（布局上与不存在等价，不影响窗口的绝对定位与叠放序），
 * 只把 `pointer-events` 恢复成 `auto`，让子树（浮动窗 / 官方弹层原子 / 吐司）可交互 ——
 * 这正是官方「entries opt back into pointer events」的落点，且不会像整屏容器那样吞掉页面点击。
 */
function overlayLayerStyle() {
  return {
    display: 'contents',
    pointerEvents: 'auto',
  };
}
  return { overlayRootStyle: overlayRootStyle, overlayLayerStyle: overlayLayerStyle };
}());
__esMod["./overlay/host.mjs"] = (function () {
  var { CONTENT_LAYER_Z } = __esMod["./contracts/layers.mjs"];
  var { overlayLayerStyle, overlayRootStyle } = __esMod["./overlay/styles.mjs"];
/**
 * host.mjs —— **OverlayHost**：挂在官方 `shell.overlay` 座位上的浮层宿主。
 *
 * 三件事，逐条对着官方实测：
 *  ① **根容器必须显式把 `pointerEvents` 设回 `auto`**：官方 `shell.overlay` 的 layer 本体是
 *     **点击穿透**的（doc 原文「click-through — entries opt back into pointer events」），
 *     不设回来整层收不到任何点击；
 *  ② **层栈自底向顶渲染**（DOM 顺序 = 同层内叠放顺序），每扇窗自带 `data-guif-z` 实际层号；
 *  ③ **Esc / 点外**两个控制器在这里挂载（只在宿主真的挂上时挂监听，卸载即摘）。
 *
 * 浮层之下不可交互：**只有模态族（dialog）**才锁 `body` 的 `pointer-events`；
 * 浮动窗/气泡/吐司是非模态的，锁 body 会把整个应用点不动 —— 那条只适用于模态。
 */



/** 宿主根节点的属性（真机断言锚点）。 */
const OVERLAY_ROOT_ATTR = 'data-guif-overlay-root';
/**
 * 每层包裹节点的属性（值＝该层的 id）。
 * 它是「entries opt back into pointer events」的落点：根容器是 `pointer-events: none` 的整屏空壳
 * （点击穿透，不吞页面点击），**由这个包裹节点把子树恢复成 `auto`**；`display: contents` 不生成盒子，
 * 所以窗口的绝对定位与 DOM 叠放序都不受影响。
 */
const OVERLAY_LAYER_ATTR = 'data-guif-overlay-layer';

/**
 * 造 OverlayHost 组件。
 * @param {object} react 种子里的 React
 * @param {{stack:object, pointer:object, dismiss:object, escape:object, toasts:object,
 *   FloatingWindow:Function, family:object, rootZ?:number, containerRef?:object}} runtime
 *   全部依赖都是**注入**的：组件本身不 import 任何平台件、不碰服务面。
 */
function createOverlayHost(react, runtime) {
  const rootZ = Number.isInteger(runtime.rootZ) ? runtime.rootZ : CONTENT_LAYER_Z;
  /**
 * 浮动窗组件：**渲染期经 resolver 取**（overlay 不 import window/**；跨能力只走 service）。
 * 兼容老用法：调用方直接给 `runtime.FloatingWindow` 时，缺省 resolver 就返回它（单测替身照旧）。
 */
const resolveFloatingWindow = typeof runtime.resolveFloatingWindow === 'function'
  ? runtime.resolveFloatingWindow
  : () => runtime.FloatingWindow;
  const family = runtime.family;

  /**
   * 单层包裹：根容器是 `pointer-events: none` 的整屏空壳（点击穿透），这里**逐层**把交互恢复回来。
   * `display: contents` 不生成盒子 ⇒ 不影响窗口的绝对定位与 DOM 叠放序。
   */
  function renderLayer(record) {
    return react.createElement('div', {
      key: record.id,
      [OVERLAY_LAYER_ATTR]: record.id,
      style: overlayLayerStyle(),
    }, renderLayerBody(record));
  }

  /** 单层内容：**面板**走 OverlayPanel，浮动窗走 FloatingWindow，模态/气泡走官方原子薄壳。 */
  function renderLayerBody(record) {
    const common = { key: record.id, id: record.id, z: record.z, family: record.family };
    if (record.family === 'panel' && typeof runtime.Panel === 'function') {
      // ⚠ 面板**不是**浮动窗：没有把手条、没有缩放手柄、不参与拖动 —— 它就是贴边浮出的一块面
      //   （用户裁定「面板」与「悬浮窗」是两个组件，不得混用）。
      return react.createElement(runtime.Panel, {
        key: record.id,
        id: record.id,
        z: record.z,
        title: record.title,
        description: record.description,
        closeLabel: record.closeLabel,
        rect: record.rect,
        onClose: record.closable === false ? undefined : () => runtime.stack.remove(record.id),
        onPointerDownCapture: () => runtime.dismiss.onPointerDownCapture(),
      }, record.content ?? null);
    }
    if (record.family === 'dialog' && family !== null && family !== undefined) {
      return react.createElement(family.Dialog, {
        key: record.id,
        open: true,
        onClose: () => runtime.stack.remove(record.id),
        title: record.title,
        closeLabel: record.closeLabel ?? '关闭',
        description: record.description,
        footer: record.footer,
        children: record.content ?? null,
      });
    }
    if (record.family === 'popover' && family !== null && family !== undefined) {
      return react.createElement(family.Popover, {
        key: record.id,
        open: true,
        anchor: record.anchor,
        getAnchorRect: record.getAnchorRect,
        items: record.items ?? [],
        onSelect: record.onSelect,
        onClose: () => runtime.stack.remove(record.id),
        children: record.content ?? null,
      });
    }
    const FloatingWindow = resolveFloatingWindow();
    if (typeof FloatingWindow !== 'function') return null;
    return react.createElement(FloatingWindow, {
      ...common,
      title: record.title,
      children: record.content ?? null,
      actions: record.actions,
      footer: record.footer,
      initialRect: record.rect,
      index: record.index,
      containerRef: runtime.containerRef ?? null,
      minVisible: record.minVisible,
      onClose: record.closable === false ? undefined : () => runtime.stack.remove(record.id),
      onBringToFront: (id) => runtime.stack.bringToFront(id),
      onPointerDownCapture: () => runtime.dismiss.onPointerDownCapture(),
      onRectChange: (change) => {
        record.rect = change.rect;
        if (typeof record.onRectChange === 'function') record.onRectChange(change);
      },
    });
  }

  function OverlayHost() {
    const [, force] = react.useState(0);
    const records = runtime.stack.records();
    const modalCount = records.filter((record) => record.modal === true).length;
    const toastCount = runtime.toasts === null || runtime.toasts === undefined ? 0 : runtime.toasts.size();

    // 层栈变化 ⇒ 重渲染（订阅随宿主 mount/unmount 成对摘挂）
    react.useEffect(() => runtime.stack.subscribe(() => force((value) => value + 1)), []);

    // Esc / 点外两个控制器：只在宿主挂上时挂监听，卸载即摘
    react.useEffect(() => {
      runtime.dismiss.attach();
      runtime.escape.attach();
      return () => {
        runtime.dismiss.detach();
        runtime.escape.detach();
      };
    }, []);

    // 模态层在 ⇒ 锁 body；最后一层模态走掉 ⇒ **严格还原原值**
    react.useEffect(() => {
      if (modalCount === 0) return undefined;
      const unlock = runtime.pointer.lock();
      return () => unlock();
    }, [modalCount > 0, modalCount]);

    // 吐司变化 ⇒ 重渲染
    react.useEffect(() => {
      if (runtime.toasts === null || runtime.toasts === undefined) return undefined;
      return runtime.toasts.subscribe(() => force((value) => value + 1));
    }, []);

    const children = [];
    for (const record of records) {
      const node = renderLayer(record);
      if (node !== null) children.push(node);
    }
    if (toastCount > 0) children.push(react.createElement(runtime.toasts.component, { key: 'guif-toasts' }));

    return react.createElement('div', {
      [OVERLAY_ROOT_ATTR]: '',
      'data-guif-overlay-layers': String(records.length),
      style: overlayRootStyle(rootZ),
      onPointerDownCapture: () => runtime.dismiss.onPointerDownCapture(),
    }, children);
  }

  return OverlayHost;
}
  return { OVERLAY_ROOT_ATTR: OVERLAY_ROOT_ATTR, OVERLAY_LAYER_ATTR: OVERLAY_LAYER_ATTR, createOverlayHost: createOverlayHost };
}());
__esMod["./overlay/panel.mjs"] = (function () {
  var { BASE_ANCHORS, createPanelParts } = __esMod["./kit/surface.mjs"];
/**
 * overlay/panel.mjs —— **浮出面板的呈现层**（托管浮层 `panel` 族）。
 *
 * ═══ 它与「悬浮窗」是两个组件（用户原话）═══
 * 「你能不能把『悬浮窗』和『面板』两个组件区分开？你不认得吗？」
 *
 *   | | 悬浮窗 `FloatingWindow` | 面板（本文件＝基类 + 定位） |
 *   | --- | --- | --- |
 *   | 定位 | 自由摆放（拖动 + 缩放 + 贴边吸附） | **锚定**：贴住触发它的那颗按钮 |
 *   | 形状 | 窗口：空白把手条 + 标题栏 + 缩放手柄 | 面板：**脸 + 头 + 内容区**，无把手、无缩放 |
 *   | 生命周期 | 用户摆放（位置/大小被记住） | 点开即来、Esc / 点外即走 |
 *
 * ═══ 皮在基类里（本轮返工的根因）═══
 * 上一版这里自己写了一层样式（**透明裸 div** ⇒ 用户判「你现在的面板连背景都没有」），而
 * `components.Panel` 另有一套皮。现在表面/头部/分隔线**全部来自 `panel/base.mjs`**（主区面板与
 * 浮出面板共用同一份 ⇒ 不可能再漂移）；本文件只负责**锚定定位**这一件事。
 *
 * 本文件零副作用：只造组件。
 */


/** 面板族名（与 `contracts/layers.mjs` 的 `LAYER_FAMILIES` 同字面）。 */
const PANEL_FAMILY = 'panel';
/** 缺省尺寸（可被 `initialRect` 覆盖；面板**不**给用户改尺寸 —— 尺寸是形态的一部分）。 */
const OVERLAY_PANEL_DEFAULT_SIZE = Object.freeze({ width: 320, height: 420 });

/** 机器锚点（真机装置按它们读「面板在不在、标题是什么、内容区在哪」）。 */
const PANEL_ATTR = BASE_ANCHORS.frame;
const PANEL_HEADER_ATTR = BASE_ANCHORS.header;
const PANEL_TITLE_ATTR = BASE_ANCHORS.title;
const PANEL_CLOSE_ATTR = BASE_ANCHORS.close;
const PANEL_BODY_ATTR = BASE_ANCHORS.body;

/**
 * 造**浮出面板**组件（工厂模式：react 只能从 `env.seeds.react` 来 —— 模块不 import 裸包名）。
 * @param {object} react 种子 react
 * @param {{defaultSize?:{width:number, height:number}}} [runtime]
 * @returns {Function} 组件：`(props) => element`
 */
function createOverlayPanel(react, runtime = {}) {
  const el = react.createElement;
  const parts = createPanelParts(react);
  const fallbackSize = runtime.defaultSize ?? OVERLAY_PANEL_DEFAULT_SIZE;

  /**
   * @param {object} props
   *  - `id`（必填）/ `z`（数字层级表分配的层号）/ `title` / `closeLabel`
   *  - `rect`：`{x, y, width?, height?}` —— 由调用方**贴着触发它的按钮**算好（面板不自己找位置）
   *  - `children`：内容（按钮面板＝外部插件交进来的按钮）/ `onClose`
   */
  return function OverlayPanel(props) {
    const p = props ?? {};
    const rect = p.rect ?? {};
    const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : fallbackSize.width;
    const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : fallbackSize.height;
    const x = Number.isFinite(rect.x) ? rect.x : 0;
    const y = Number.isFinite(rect.y) ? rect.y : 0;
    const id = String(p.id ?? '');
    const title = typeof p.title === 'string' && p.title !== '' ? p.title : '面板';
    const onClose = typeof p.onClose === 'function' ? p.onClose : null;

    return el(parts.Frame, {
      id,
      family: PANEL_FAMILY,
      z: p.z,
      role: 'dialog',
      label: title,
      onPointerDownCapture: p.onPointerDownCapture,
      // 定位是**面板这一层**的事：基类只管脸，不猜它待在哪。
      style: {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: Number.isFinite(p.z) ? p.z : undefined,
      },
    },
    el(parts.Header, { key: 'head', id, title, onClose, closeLabel: p.closeLabel }),
    el(parts.Body, { key: 'body', id }, p.children ?? null));
  };
}
  return { PANEL_FAMILY: PANEL_FAMILY, OVERLAY_PANEL_DEFAULT_SIZE: OVERLAY_PANEL_DEFAULT_SIZE, PANEL_ATTR: PANEL_ATTR, PANEL_HEADER_ATTR: PANEL_HEADER_ATTR, PANEL_TITLE_ATTR: PANEL_TITLE_ATTR, PANEL_CLOSE_ATTR: PANEL_CLOSE_ATTR, PANEL_BODY_ATTR: PANEL_BODY_ATTR, createOverlayPanel: createOverlayPanel };
}());
__esMod["./overlay/pointer.mjs"] = (function () {
/**
 * pointer.mjs —— **pointer-events 栈**：让浮层之下不可交互。
 *
 * 机制（Radix 同款，MIT，只借机制不抄码）：
 *   `body { pointer-events: none }` + **最上层内联 `auto`** ⇒ 浮层之下整片不可交互，
 *   而浮层自己（及其子树）照常可点 —— 因为 CSS 里 `pointer-events` 可以被后代显式改回来。
 *
 * ⚠ 这是**全局副作用**（改的是 `body` 的行内样式），所以两条纪律必须做足：
 *  ① **原值存取**：进入前记下 `body` 原有的行内 `pointer-events`（可能是空串 = 未设置）；
 *  ② **引用计数**：多层同时要锁时只写一次，最后一层走掉才还原 —— **卸载严格还原原值**，
 *     不留下 `pointer-events: none` 这种「页面看着正常但哪儿都点不动」的幽灵状态。
 *
 * 本文件只依赖注入的 `dom`（缺省 `document`），不依赖 React（L0/L3 直测）。
 */

/** 解析出 `body`（注入的 dom 可能是 document，也可能直接就是 body）。 */
function resolveBody(dom) {
  if (dom === null || dom === undefined) return null;
  if (dom.body !== undefined && dom.body !== null) return dom.body;
  if (dom.style !== undefined) return dom;
  return null;
}

/** 读当前行内值（**空串 = 没设过**，与 `undefined` 区分开）。 */
function readInline(element) {
  const value = element.style?.pointerEvents;
  return typeof value === 'string' ? value : '';
}

/**
 * @param {{dom?:object}} [options] `dom` 缺省 `globalThis.document`
 * @returns {{lock:Function, release:Function, depth:Function, saved:Function, isLocked:Function,
 *   restoreNow:Function, body:Function}}
 */
function createPointerGuard(options = {}) {
  const dom = options.dom ?? (typeof document === 'undefined' ? null : document);
  let depth = 0;
  let saved = null; // { value: string }
  let target = null;

  const applyNone = () => {
    const body = resolveBody(dom);
    if (body === null || body === undefined || body.style === undefined) return null;
    if (depth === 0) {
      saved = { value: readInline(body) };
      target = body;
      body.style.pointerEvents = 'none';
    }
    return body;
  };

  const restore = () => {
    if (target === null || saved === null) return false;
    if (saved.value === '') {
      // 原来没设过 ⇒ **移除属性**，而不是写空串（写空串会多出一个无意义的内联属性）
      if (typeof target.style.removeProperty === 'function') target.style.removeProperty('pointer-events');
      else target.style.pointerEvents = '';
    } else {
      target.style.pointerEvents = saved.value;
    }
    saved = null;
    target = null;
    return true;
  };

  /** 解一层锁（计数归零时还原原值）。**不用 `this`** —— 解构出来后也必须能独立调用。 */
  const release = () => {
    if (depth === 0) return false;
    depth -= 1;
    if (depth === 0) return restore();
    return false;
  };

  return {
    /**
     * 加一层锁（返回幂等的解绑器）。
     * @returns {() => void}
     */
    lock() {
      applyNone();
      depth += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    },
    release,
    depth() {
      return depth;
    },
    saved() {
      return saved === null ? null : { ...saved };
    },
    isLocked() {
      return depth > 0;
    },
    /** 兜底：无论计数多少，强制还原原值（卸载路径上的最后一道保险）。 */
    restoreNow() {
      depth = 0;
      return restore();
    },
    body() {
      return target ?? resolveBody(dom);
    },
  };
}
  return { createPointerGuard: createPointerGuard };
}());
__esMod["./overlay/stack.mjs"] = (function () {
/**
 * stack.mjs —— **浮层层栈**（overlay-kit 的 orderList 语义，MIT，只借机制不抄码）。
 *
 * 三条语义：
 *  ① **栈序 = id 数组，末尾是最上层**；「点击置顶」＝把 id 移到数组末尾（overlay-kit 的 orderList 同款）；
 *  ② **挂载注册 / 卸载注销**：`add(record)` / `remove(id)`，`remove` 只摘记录不动别人的相对顺序；
 *  ③ **只作用最上层**：`top()` 给 Esc 与点外关闭用。
 *
 * 为什么是「每个 install 一份实例」而不是进程级单例（模块级层栈）：
 * 服务方自动重挂载时**必须幂等、不得残留浮窗** —— 实例随 `install` 的 disposer 一起
 * `clear()`，比全局单例更安全；对使用方而言它同样是「模块级」的（不跨插件共享栈）。
 *
 * 数字层号（z）**只是记录字段**：它由数字层级表分配，栈序只决定**同层内的叠放**。
 * 本文件不碰 DOM、不碰 React（L0 层直测）。
 */

/**
 * @param {{limit?:number}} [options] `limit` 是最大同时存在的浮层数（防御性封顶，超出时最老的被丢弃）
 * @returns {{add:Function, remove:Function, bringToFront:Function, top:Function, get:Function,
 *   ids:Function, records:Function, size:Function, clear:Function, subscribe:Function, dropped:Function}}
 */
function createOverlayStack(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 64;
  let order = [];
  const records = new Map();
  const listeners = new Set();
  const droppedRows = [];

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 订阅者自己的错不该打断层栈
      }
    }
  };

  return {
    /** 注册一层（已存在同 id 时先摘后加，等价「重新打开即置顶」）。 */
    add(record) {
      if (record === null || record === undefined || typeof record.id !== 'string' || record.id === '') return null;
      if (order.includes(record.id)) order = order.filter((id) => id !== record.id);
      order.push(record.id);
      records.set(record.id, { ...record });
      while (order.length > limit) {
        const evicted = order.shift();
        const row = records.get(evicted);
        records.delete(evicted);
        droppedRows.push({ id: evicted, record: row });
      }
      notify();
      return records.get(record.id);
    },
    remove(id) {
      if (!order.includes(id)) return false;
      order = order.filter((current) => current !== id);
      records.delete(id);
      notify();
      return true;
    },
    /** 点击置顶（**同层内**的叠放序；跨族的上下关系恒由数字层级表决定）。 */
    bringToFront(id) {
      if (!order.includes(id)) return false;
      order = [...order.filter((current) => current !== id), id];
      notify();
      return true;
    },
    top() {
      return order.length === 0 ? null : records.get(order[order.length - 1]);
    },
    get(id) {
      return records.get(id) ?? null;
    },
    ids() {
      return [...order];
    },
    /** 自底向顶的有序记录（宿主按这个顺序渲染 ⇒ DOM 顺序即叠放顺序）。 */
    records() {
      return order.map((id) => records.get(id));
    },
    size() {
      return order.length;
    },
    /** 卸载时清空（幂等的第二道保险：服务方自动重挂载不得残留浮窗）。 */
    clear() {
      order = [];
      records.clear();
      notify();
      return this;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 因超出 `limit` 被丢弃的记录（诊断用）。 */
    dropped() {
      return [...droppedRows];
    },
  };
}
  return { createOverlayStack: createOverlayStack };
}());
__esMod["./overlay/toast.mjs"] = (function () {
/**
 * toast.mjs —— **Toast 的宿主与堆叠**（实测：官方只给原子、没有宿主）。
 *
 * 为什么必须自研这一层：官方 primitives 的 `Toast` 只是个**原子**（签名
 * `{text, icon, anchor, holdMs, onDone}`，内部 `createPortal` 到 body），
 * 实测结论原文是「**没有 Toast 宿主/堆栈管理器**」——
 * 队列、堆叠顺序、时长、满员淘汰、卸载全得宿主自己做。
 *
 * 本文件负责：FIFO 队列 + 最大同时条数 + 自动消失 + 手动关闭 + 幂等卸载；
 * 渲染时**复用官方原子** `primitives.Toast`（不重画外观）。
 */

/** 同时最多几条（超出即淘汰最老的）。 */
const TOAST_MAX_VISIBLE = 3;
/** 单条默认停留时长（ms）。 */
const TOAST_HOLD_MS = 4000;

/**
 * @param {object} react 种子里的 React
 * @param {{primitives?:object, max?:number, holdMs?:number, schedule?:Function, cancel?:Function}} [options]
 * @returns {{push:Function, dismiss:Function, clear:Function, items:Function, subscribe:Function,
 *   size:Function, component:Function, stats:Function}}
 */
function createToastStack(react, options = {}) {
  const primitives = options.primitives ?? null;
  const max = Number.isInteger(options.max) && options.max > 0 ? options.max : TOAST_MAX_VISIBLE;
  const holdMs = Number.isInteger(options.holdMs) && options.holdMs > 0 ? options.holdMs : TOAST_HOLD_MS;
  const schedule = typeof options.schedule === 'function' ? options.schedule : (fn, ms) => setTimeout(fn, ms);
  const cancel = typeof options.cancel === 'function' ? options.cancel : (handle) => clearTimeout(handle);
  /** 容器自身的层号（由数字层级表的 toast 族分配；缺省给 toast 段下界）。 */
  const containerZ = Number.isInteger(options.z) ? options.z : 600;

  let seq = 0;
  let items = [];
  const timers = new Map();
  const listeners = new Set();
  const stats = { pushed: 0, dropped: 0, autoDismissed: 0, manualDismissed: 0 };

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 订阅者抛错不打断队列
      }
    }
  };

  const clearTimer = (id) => {
    if (!timers.has(id)) return;
    cancel(timers.get(id));
    timers.delete(id);
  };

  const dismiss = (id, reason = 'manual') => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    clearTimer(id);
    items = items.filter((item) => item.id !== id);
    if (reason === 'auto') stats.autoDismissed += 1;
    else stats.manualDismissed += 1;
    notify();
    return true;
  };

  const push = (text, pushOptions = {}) => {
    seq += 1;
    const id = `guif-toast-${seq}`;
    const item = { id, text: String(text ?? ''), holdMs: Number.isInteger(pushOptions.holdMs) ? pushOptions.holdMs : holdMs, at: seq };
    items = [...items, item];
    stats.pushed += 1;
    while (items.length > max) {
      const evicted = items[0];
      clearTimer(evicted.id);
      items = items.slice(1);
      stats.dropped += 1;
    }
    timers.set(id, schedule(() => dismiss(id, 'auto'), item.holdMs));
    notify();
    return id;
  };

  /** 宿主渲染的 Toast 容器（**自研堆叠**：FIFO ⇒ 老的在上面，新的往下排）。 */
  function ToastStack() {
    const [, force] = react.useState(0);
    react.useEffect(() => subscribe(() => force((value) => value + 1)), []);
    const rows = items.map((item) => {
      if (primitives !== null && typeof primitives.Toast === 'function') {
        return react.createElement(primitives.Toast, {
          key: item.id,
          text: item.text,
          holdMs: item.holdMs,
          onDone: () => dismiss(item.id, 'manual'),
        });
      }
      // 官方原子不可用时的退化形态（仍然是我们自己的堆叠与时长）
      return react.createElement('div', { key: item.id, role: 'alert', 'data-guif-toast': item.id }, item.text);
    });
    return react.createElement('div', {
      'data-guif-toast-stack': '',
      style: {
        position: 'absolute',
        right: '12px',
        bottom: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        pointerEvents: 'auto',
        zIndex: containerZ,
      },
    }, rows);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** 清空队列 + **摘掉所有定时器**（幂等卸载：不留悬挂 timer）。**不用 `this`**（解构后也能调用）。 */
  const clear = () => {
    for (const id of [...timers.keys()]) clearTimer(id);
    items = [];
    notify();
  };

  return {
    push,
    dismiss,
    clear,
    items() {
      return items.map((item) => ({ ...item }));
    },
    subscribe,
    size() {
      return items.length;
    },
    component: ToastStack,
    stats() {
      return { ...stats, pending: timers.size };
    },
  };
}
  return { TOAST_MAX_VISIBLE: TOAST_MAX_VISIBLE, TOAST_HOLD_MS: TOAST_HOLD_MS, createToastStack: createToastStack };
}());
__esMod["./overlay/index.mjs"] = (function () {
  var { probeService } = __esMod["./kit/probe.mjs"];
  var { createDismissController, createEscapeController, createInterceptionLedger } = __esMod["./overlay/dismiss.mjs"];
  var { FAMILY_ATOMS, createFamily, isModalFamily } = __esMod["./overlay/family.mjs"];
  var { createOverlayHost } = __esMod["./overlay/host.mjs"];
  var { createOverlayPanel } = __esMod["./overlay/panel.mjs"];
  var { createPointerGuard } = __esMod["./overlay/pointer.mjs"];
  var { createOverlayStack } = __esMod["./overlay/stack.mjs"];
  var { createToastStack } = __esMod["./overlay/toast.mjs"];
/**
 * overlay/index.mjs —— `overlay` 能力的**装配函数**（装配契约 v1）。
 *
 * 装配清单（全部经 `ctx.effect(...)`，随**调用方** fiber 卸载）：
 *  ① `ctx.slots.inject('shell.overlay', () => ctx.slots.register({name, id, order}, OverlayHost))`
 *     —— 官方 `shell.overlay` 是 **list / root** 座位（可叠加、点击穿透、`replaceRisk: none`），**不需要成对注册**；
 *  ② `env.service.__install('overlay', api)` —— 把 `overlay.open/close/bringToFront` 的实现挂到服务面
 *     （切片方法**第一个参数恒为调用方 ctx**，这是冻结契约）。
 *
 * **幂等**：同一服务实例二次 `install` 直接返回第一次的句柄（不重复盖座位、不残留浮层）——
 * 服务方自动重挂载时的硬要求。
 *
 * ⚠ 汇合点 `src/client/entry.mjs`：本文件只导出装配函数，**不自行挂载**。
 */


/**
 * 浮动窗组件在**服务面组件表**里的注册名（＝ \`window/index.mjs\` 的 \`WINDOW_COMPONENT_NAME\`）。
 * 两个半区各自定义常量、由测试钉相等 —— 这是本仓既有的跨模块命名范式（见 layout 命名空间那一对）。
 */
const FLOATING_COMPONENT_NAME = 'FloatingWindow';








/** 座位键（本包收取的 slot 键之一，冻结在 service-face.mjs 的 CONSUMED_SLOT_KEYS 里）。 */
const OVERLAY_SLOT_KEY = 'shell.overlay';
/** 座位登记 id（带命名空间前缀）。 */
const OVERLAY_SLOT_ID = 'dsh-gui-frame/overlay';
/** 座位 order（越小越靠前；GUIFrame 不抢官方内容层的位置，取 100）。 */
const OVERLAY_SLOT_ORDER = 100;
/** 自动生成的窗口 id 前缀。 */
const WINDOW_ID_PREFIX = 'guif-win-';

/** 每个服务实例只装一次。 */
const INSTALLED = new WeakMap();

function note(env, code, message) {
  try {
    if (env?.service !== null && env?.service !== undefined && typeof env.service.__note === 'function') env.service.__note(code, message);
  } catch {
    // 诊断出问题不影响装配
  }
}

/**
 * @param {object} ctx 调用方 Cordis ctx
 * @param {{service:object, seeds:object}} env 装配契约 v1 的 options bag
 * @returns {{dispose:Function, installed:boolean, host:Function|null, stack:object, toasts:object,
 *   pointer:object, dismiss:object, escape:object, family:object, slot:{key:string,id:string}}}
 */
function install(ctx, env) {
  const service = env === null || env === undefined ? null : env.service ?? null;
  const seeds = env === null || env === undefined ? null : env.seeds ?? null;
  if (isObject(service) && INSTALLED.has(service)) return INSTALLED.get(service);

  const react = seeds === null || seeds === undefined ? null : seeds.react ?? null;
  const primitives = seeds === null || seeds === undefined ? null : seeds.primitives ?? null;
  const dom = typeof document === 'undefined' ? null : document;

  const stack = createOverlayStack({});
  const pointer = createPointerGuard({ dom });
  const ledger = createInterceptionLedger();
  const toasts = createToastStack(react, { primitives });
  const family = react === null ? null : createFamily(react, primitives);
  /**
   * 浮动窗组件：**渲染期经服务面组件表取**。
   * 本包自己**不登记**这个名字（浮窗能力不在交付面里）—— 名字留给外部经
   * `service.components.register(name, Component)` 贡献实现；取不到 ⇒ 渲染期返回 null
   * （浮层其余部分照常，不抛）。
   */
  const resolveFloatingWindow = () => {
    try {
      const face = service === null || service === undefined ? null : service.components;
      const found = face !== null && typeof face.get === 'function' ? face.get(FLOATING_COMPONENT_NAME) : undefined;
      return typeof found === 'function' ? found : null;
    } catch {
      return null;
    }
  };
  // ★ 面板是与浮动窗**并列的另一个组件**：贴边浮出、无把手条、无缩放手柄、自带表面。
  const Panel = react === null ? null : createOverlayPanel(react, {});

  if (react === null || typeof react.createElement !== 'function') {
    note(env, 'GUIF-W-LISTENER-THREW', 'overlay.install：env.seeds.react 不可用 ⇒ 只登记层栈，不注册宿主');
  }

  /**
   * 点外关闭控制器：
   * `isInside` 走 **React 树**（浮层根 `onPointerDownCapture` 打的标记）；账本非空 ⇒ 不关。
   */
  const dismiss = createDismissController({
    dom: dom ?? { addEventListener() {}, removeEventListener() {} },
    ledger,
    isInside: () => false, // 真正的判内外由 onPointerDownCapture 的标记承担（见 host.mjs）
    onDismiss: () => {
      const top = stack.top();
      if (top === null || top.closable === false) return;
      stack.remove(top.id);
    },
  });
  const escape = createEscapeController({
    dom: dom ?? { addEventListener() {}, removeEventListener() {} },
    top: () => stack.top(),
    onEscape: (entry) => stack.remove(entry.id),
  });

  let windowSeq = 0;

  /** 切片实现：`service.overlay.open/close/bringToFront` 的落点（第一参数恒为调用方 ctx）；`has` 是内部只读面。 */
  const api = {
    /** @param {object} request 已由服务面校验并分配好 `z`（来自数字层级表） */
    open(callerCtx, request) {
      windowSeq += 1;
      const id = typeof request.id === 'string' && request.id !== '' ? request.id : `${WINDOW_ID_PREFIX}${windowSeq}`;
      const familyName = request.family ?? 'floating';

      if (familyName === 'toast') {
        const toastId = toasts.push(request.text ?? request.title ?? '', { holdMs: request.holdMs });
        return {
          id: toastId,
          z: request.z,
          family: 'toast',
          close: () => toasts.dismiss(toastId, 'manual'),
          bringToFront: () => false,
        };
      }

      const record = {
        id,
        family: familyName,
        z: request.z,
        band: request.band,
        modal: isModalFamily(familyName),
        closable: request.closable !== false,
        title: request.title,
        description: request.description,
        content: request.content ?? null,
        actions: request.actions,
        footer: request.footer,
        anchor: request.anchor,
        getAnchorRect: request.getAnchorRect,
        items: request.items,
        onSelect: request.onSelect,
        onRectChange: request.onRectChange,
        closeLabel: request.closeLabel,
        rect: request.initialRect,
        index: windowSeq - 1,
        minVisible: request.minVisible,
      };
      const added = stack.add(record);
      if (added === null) return { id, z: request.z, family: familyName, close: () => false, bringToFront: () => false };
      return {
        id,
        z: request.z,
        family: familyName,
        /** 关闭这扇窗（幂等）。 */
        close: () => stack.remove(id),
        /** 同层内点击置顶。 */
        bringToFront: () => stack.bringToFront(id),
      };
    },
    close(callerCtx, id) {
      if (stack.remove(id)) return true;
      return toasts.dismiss(id, 'manual');
    },
    /**
     * 某一扇窗**此刻是否在场**（只读；`ctx.guiFrame.dock.isOpen()` 问的就是这一句）。
     *
     * 读的是**层栈本身**而不是谁记的状态位：用户按 Esc / 点外 / 点头部 × 关掉的那一扇也必须如实反映
     * （那三条路都直接 `stack.remove`，不经过开窗的人）。吐司不在本判据内（`toast` 族有自己的生命周期）。
     * @param {string} id
     * @returns {boolean}
     */
    has(callerCtx, id) {
      if (typeof id !== 'string' || id === '') return false;
      return stack.get(id) !== null;
    },
    bringToFront(callerCtx, id) {
      return stack.bringToFront(id);
    },
    /** 卸载：清空层栈 + 吐司队列（**幂等**，二次 install 不残留）。 */
    dispose() {
      stack.clear();
      toasts.clear();
      if (pointer.isLocked()) pointer.restoreNow();
    },
  };

  const host = react === null ? null : createOverlayHost(react, {
    stack,
    pointer,
    dismiss,
    escape,
    toasts,
    resolveFloatingWindow,
    Panel,
    family,
    rootZ: request_rootZ(env),
  });

  // ① 座位：官方 shell.overlay（list/root，点击穿透 ⇒ 宿主根容器自己把 pointerEvents 设回 auto）
  let offSlot = null;
  const slots = probeService(ctx, 'slots') ?? null;
  if (host !== null && slots !== null && typeof slots.inject === 'function' && typeof slots.register === 'function') {
    offSlot = slots.inject(OVERLAY_SLOT_KEY, () => slots.register({
      name: OVERLAY_SLOT_KEY,
      id: OVERLAY_SLOT_ID,
      order: OVERLAY_SLOT_ORDER,
    }, host));
  } else if (host !== null) {
    note(env, 'GUIF-W-LISTENER-THREW', 'overlay.install：ctx.slots 不可用 ⇒ 不占座位（允许渐进接入）');
  }

  // ② 服务面分片（**宿主不可用时不装**：宁可让 overlay.open 报「能力未装配」，也不静默收下一个永远不渲染的窗口）
  let offSlice = null;
  if (host !== null && isObject(service) && typeof service.__install === 'function' && typeof service.__slice === 'function' && service.__slice('overlay') === undefined) {
    try {
      offSlice = service.__install('overlay', api);
    } catch (error) {
      note(env, 'GUIF-E-SLICE-INVALID', `overlay.install：分片装配失败（已让位）：${error?.message ?? error}`);
      offSlice = null;
    }
  }

  const raw = () => {
    dismiss.detach();
    escape.detach();
    if (typeof offSlot === 'function') offSlot();
    offSlot = null;
    if (typeof offSlice === 'function') offSlice();
    offSlice = null;
    api.dispose();
    if (isObject(service)) INSTALLED.delete(service);
  };

  const handle = {
    installed: host !== null,
    host,
    stack,
    toasts,
    pointer,
    dismiss,
    escape,
    family,
    api,
    slot: { key: OVERLAY_SLOT_KEY, id: OVERLAY_SLOT_ID, order: OVERLAY_SLOT_ORDER },
    atoms: { ...FAMILY_ATOMS },
    dispose: raw,
  };

  // 装配期的副作用一律挂在**调用方 fiber** 上：fiber 卸载 ⇒ raw() 自动跑
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
    ctx.effect(() => () => raw(), 'gui-frame: install overlay');
  } else {
    note(env, 'GUIF-E-CTX-INVALID', 'overlay.install：ctx.effect 缺失 ⇒ 装配完成但清理需显式调用 dispose()');
  }

  if (isObject(service)) INSTALLED.set(service, handle);
  return handle;
}

/** 对象判据（`null` / `undefined` 一律当「没有」，绝不因为少一个面就抛穿整页）。 */
function isObject(value) {
  return value !== null && value !== undefined && (typeof value === 'object' || typeof value === 'function');
}

/** 宿主根层号：缺省用官方内容层基线（`shell.overlay` 本体已经在这个 z 上）。 */
function request_rootZ(env) {
  const value = env?.rootZ;
  return Number.isInteger(value) ? value : undefined;
}
  return { FLOATING_COMPONENT_NAME: FLOATING_COMPONENT_NAME, OVERLAY_SLOT_KEY: OVERLAY_SLOT_KEY, OVERLAY_SLOT_ID: OVERLAY_SLOT_ID, OVERLAY_SLOT_ORDER: OVERLAY_SLOT_ORDER, WINDOW_ID_PREFIX: WINDOW_ID_PREFIX, install: install };
}());
__esMod["./service/text.mjs"] = (function () {
  var { probeLogger } = __esMod["./kit/probe.mjs"];
/**
 * text.mjs —— **服务面的文本成形与日志出口**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 * 两件事：① 读数成形（`truncate` / `describeValue` / `describeError`）——错误里只说「收到了什么形状」，
 * 不把栈或对象整个搬进日志；② 日志出口（`logTo`：`ctx.logger[level]`，拿不到就静默 —— 与
 * `kit/probe.mjs` 的单一软探测口径同源）。
 *
 * 依赖方向：`service/**` 是装配层（L3），可依赖任何域；本件只依赖共享叶 `kit/probe.mjs`。
 * 判定口径（`describeValue` 对 null/undefined/数组/对象的四分支、`describeError` 的 200 字截断）**一字未改**。
 */


function logTo(ctx, level, line) {
  const logger = probeLogger(ctx);
  if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](line);
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function describeValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `数组(${value.length})`;
  if (typeof value === 'object') return '对象';
  return `${typeof value} ${String(value)}`;
}

function describeError(error) {
  if (error === null || error === undefined) return describeValue(error);
  if (typeof error === 'object' && typeof error.message === 'string') return truncate(error.message, 200);
  return truncate(String(error), 200);
}

function noop() {}
  return { logTo: logTo, truncate: truncate, describeValue: describeValue, describeError: describeError, noop: noop };
}());
__esMod["./service/entries.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
  var { ENTRY_ID_MAX_LENGTH, ENTRY_ID_PATTERN, ENTRY_KINDS, RESERVED_ENTRY_IDS } = __esMod["./contracts/service-face.mjs"];
  var { describeValue } = __esMod["./service/text.mjs"];
/**
 * entries.mjs —— **入口登记的形态收敛与排序键**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 * `normalizeEntry(entry, Component)` 把接入方给的 `{id,label,order,group,kind,source,icon,badge}` 收成
 * 服务内部记录，**逐条错误码与判据（`GUIF-E-ENTRY-INVALID` 的八种分支）一字未改**；
 * `entryRank` 是 `__entries()` 的排序键（`order` 缺省排最后）。
 *
 * 依赖方向：`service/**` 是装配层（L3）；本件依赖词汇叶 `contracts/**` 与同域 `text.mjs`（读数成形）。
 */




/**
 * 普通对象判据（数组 / 类实例 / null 都不算）：只看原型是不是 `Object.prototype` / `null`。
 *
 * ⚠ 别把它简化成 `typeof v === 'object'` —— 那会放行类实例，是**放宽**判据
 * （`GUIF-E-ENTRY-INVALID` 会少一支）。
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 入口 id / Component 的形态收敛（错误码 `GUIF-E-ENTRY-INVALID`）。 */
function normalizeEntry(entry, Component) {
  if (!isPlainObject(entry)) {
    throw createError('GUIF-E-ENTRY-INVALID', `register(entry, Component) 的 entry 必须是普通对象（收到 ${describeValue(entry)}）`, { entry: describeValue(entry) });
  }
  const id = entry.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 必须是非空字符串（收到 ${describeValue(id)}）`, { id });
  }
  if (id.length > ENTRY_ID_MAX_LENGTH) {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 长度不得超过 ${ENTRY_ID_MAX_LENGTH}（收到 ${id.length}）`, { id });
  }
  if (RESERVED_ENTRY_IDS.includes(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 不得占用保留 key「${id}」（会顶掉外壳自己的界面）`, { id });
  }
  if (!ENTRY_ID_PATTERN.test(id)) {
    throw createError('GUIF-E-ENTRY-INVALID', `entry.id 必须带命名空间前缀且只含 [A-Za-z0-9._-/]（如 dsh-gui-frame/demo，收到「${id}」）`, { id });
  }
  if (Component === null || (typeof Component !== 'function' && typeof Component !== 'object')) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 Component 必须是函数组件、类组件或 memo/forwardRef 形状（收到 ${describeValue(Component)}）`, { id });
  }
  if (entry.label !== undefined && typeof entry.label !== 'string' && typeof entry.label !== 'function') {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 label 必须是字符串或 thunk（收到 ${describeValue(entry.label)}）`, { id });
  }
  if (entry.order !== undefined && !Number.isInteger(entry.order)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 order 必须是整数（收到 ${describeValue(entry.order)}）`, { id });
  }
  if (entry.group !== undefined && (typeof entry.group !== 'string' || entry.group === '')) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 group 必须是非空字符串（收到 ${describeValue(entry.group)}）`, { id });
  }
  const kind = entry.kind === undefined ? 'panel' : entry.kind;
  if (!ENTRY_KINDS.includes(kind)) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 kind 必须是 ${ENTRY_KINDS.join(' / ')} 之一（收到 ${describeValue(entry.kind)}）`, { id });
  }
  if (entry.source !== undefined && entry.source !== null && (typeof entry.source !== 'string' || entry.source === '')) {
    throw createError('GUIF-E-ENTRY-INVALID', `入口 ${id} 的 source 必须是非空字符串（插件自报的包名，stale 判定要用）`, { id });
  }
  return {
    id,
    label: entry.label === undefined ? null : entry.label,
    order: entry.order === undefined ? null : entry.order,
    group: entry.group === undefined ? null : entry.group,
    kind,
    source: entry.source === undefined || entry.source === null ? null : entry.source,
    // 入口注册形状里有 `icon` 与 `badge` —— 官方 `register` 只保留 key/id/order/label/priority，
    // 这两个字段会被**静默丢掉**，所以坞必须自己收下来（角标由坞自绘 / 面板画；图标给出入口字形）。
    icon: entry.icon === undefined ? null : entry.icon,
    badge: entry.badge === undefined ? null : entry.badge,
    Component,
    seq: 0,
  };
}

/** 排序键：`order` 缺省排最后（`order` 相等时用注册序兜底）。 */
function entryRank(record) {
  return Number.isInteger(record.order) ? record.order : Number.MAX_SAFE_INTEGER;
}
  return { normalizeEntry: normalizeEntry, entryRank: entryRank };
}());
__esMod["./service/faces.mjs"] = (function () {
  var { createError } = __esMod["./contracts/errors.mjs"];
  var { COMPONENT_NAMES, COMPONENT_PROPS } = __esMod["./contracts/components.mjs"];
  var { LAYER_FAMILIES } = __esMod["./contracts/layers.mjs"];
  var { describeError, describeValue } = __esMod["./service/text.mjs"];
/**
 * faces.mjs —— **三个命名空间视图**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 *   · `ComponentFace`（`components.register/has/get/names/props`；冻结名与 props 契约在 `contracts/components.mjs`）；
 *   · `OverlayFace`（`overlay.open/close/bringToFront`：校验窗口描述 → 向数字层级表领号 → 交给 overlay 切片）；
 *   · `DockFace`（「按钮面板」的公开开关 `open/close/isOpen`）。
 *
 * 每个面的 `ctx` 都是**调用点绑定的调用方 ctx**（构造参数），副作用一律经 `__service.__effect(ctx, …)`
 * 挂调用方 fiber —— 这条机制由 `service-lifecycle.test.mjs` 与 `service.test.mjs` 盯着，搬文件不搬语义。
 *
 * ★ 本文件**只认这三个面**：`LayoutFace`（`layout.get/replace/subscribe`）随同 `get layout()`
 *   命名空间一起被裁，它独占的布局链（形状词表、迁移、收敛）**整套已删** —— 本版没有布局能力，
 *   那条链没有任何运行时消费方。**不许加回来**：`tests/unit/service-cleanup.test.mjs` 逐个钉着
 *   这些路径，构建器另有一条「`src/client` 下每个模块都必须从入口可达」的校验。
 *
 * 依赖方向：`service/**` 是装配层（L3）；本件依赖词汇叶 `contracts/**` 与同域 `text.mjs`。
 */





/**
 * `components` 命名空间（把 GUIFrame 的**复合组件**给插件用）。
 * 本文件只冻结名字（见 contracts/components.mjs）与登记语义，实现另装。
 */
const ComponentFace = class ComponentFace {
  constructor(ctx, service, store) {
    this.ctx = ctx;
    this.__service = service;
    this.__store = store;
  }

  /** 登记一个组件实现（本包用冻结名装实现；插件也可贡献自己的可复用组件）。 */
  register(name, Component) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw createError('GUIF-E-COMPONENT-INVALID', `components.register(name, Component) 的 name 必须是非空字符串（收到 ${describeValue(name)}）`, { name });
    }
    if (Component === null || (typeof Component !== 'function' && typeof Component !== 'object')) {
      throw createError('GUIF-E-COMPONENT-INVALID', `组件 ${name} 必须是函数组件、类组件或 memo/forwardRef 形状（收到 ${describeValue(Component)}）`, { name });
    }
    if (this.__store.has(name)) {
      throw createError('GUIF-E-COMPONENT-DUPLICATE', `组件名 ${name} 已被占用（先调用上一次 register 返回的 disposer）`, { name });
    }
    this.__service.__assertCtx(this.ctx, 'components.register');
    this.__store.set(name, Component);
    return this.__service.__effect(this.ctx, `gui-frame: components.register ${name}`, () => () => {
      if (this.__store.get(name) === Component) this.__store.delete(name);
    });
  }

  /** 名字是否可用（冻结清单里的名字恒为 true —— 它们已经在对外承诺里）。 */
  has(name) {
    return typeof name === 'string' && (this.__store.has(name) || COMPONENT_NAMES.includes(name));
  }

  /** 取实现；冻结名在本包装上前返回 `undefined`（**不要编码成空组件**，那会把「还没实现」伪装成「实现了但是空的」）。 */
  get(name) {
    return typeof name === 'string' ? this.__store.get(name) : undefined;
  }

  /** 全部可用名字（冻结清单 ∪ 已登记），排序。 */
  names() {
    return [...new Set([...COMPONENT_NAMES, ...this.__store.keys()])].sort();
  }

  /** 冻结名必须接受的 props（只读契约；只能加可选 props，不得改名/删名）。 */
  props(name) {
    return COMPONENT_PROPS[name] ?? null;
  }
};

/**
 * 普通对象判据（数组 / 类实例 / null 都不算；`overlay.open` 的入参校验用）。
 *
 * ★ 写法是**有意的**：只看原型是不是 `Object.prototype` / `null`。只写 `typeof value === 'object'`
 * 会放行类实例 —— 那是放宽 `GUIF-E-ENTRY-INVALID` 的判据，不是简化。
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `overlay` 命名空间（`overlay.open/close/bringToFront`）。
 * 真正的 DOM/层栈实现在 overlay 切片；本文件负责**在服务面上**：校验窗口描述、向数字层级表领号
 * （极值拒绝、越段告警），再交给切片。
 */
const OverlayFace = class OverlayFace {
  constructor(ctx, service, layers) {
    this.ctx = ctx;
    this.__service = service;
    this.__layers = layers;
  }

  /**
   * @param {{id?:string, family?:'floating'|'dialog'|'popover'|'toast', title?:unknown, component?:unknown, props?:unknown}} spec
   * @param {{z?:number}} [options] 显式层级号；不传则从 100 起单调自增
   * @returns {object} overlay 切片返回的句柄（约定形状：`{ id, z, close(), bringToFront() }`）
   */
  open(spec, options) {
    const opts = options === undefined || options === null ? {} : options;
    if (!isPlainObject(spec)) {
      throw createError('GUIF-E-OVERLAY-SPEC', `overlay.open(spec) 的 spec 必须是普通对象（收到 ${describeValue(spec)}）`, { spec: describeValue(spec) });
    }
    if (!isPlainObject(opts)) {
      throw createError('GUIF-E-OVERLAY-SPEC', `overlay.open(spec, options) 的 options 必须是普通对象（收到 ${describeValue(opts)}）`, { options: describeValue(opts) });
    }
    if (spec.id !== undefined && (typeof spec.id !== 'string' || spec.id.trim() === '')) {
      throw createError('GUIF-E-OVERLAY-ID', `窗口 id 必须是非空字符串（收到 ${describeValue(spec.id)}）`, { id: spec.id });
    }
    const family = spec.family === undefined ? 'floating' : spec.family;
    if (!LAYER_FAMILIES.includes(family)) {
      throw createError('GUIF-E-OVERLAY-SPEC', `窗口 family 必须是 ${LAYER_FAMILIES.join(' / ')} 之一（收到 ${describeValue(family)}）`, { family });
    }
    const slice = this.__service.__installed.get('overlay');
    if (slice === undefined || typeof slice.open !== 'function') {
      throw createError('GUIF-E-CAPABILITY-ABSENT', '浮层能力未装配（浮层切片的 install(ctx, env) 未执行）—— 不静默 no-op', { capability: 'overlay' });
    }
    // 数字层级表：极值 ⇒ 抛 GUIF-E-Z-RANGE；越段 ⇒ 只告警。
    // 放在切片检查之后：装配都没装配就别消耗号（失败调用不留副作用）。
    const seat = this.__layers.allocate(family, opts.z);
    const request = { ...spec, family, z: seat.z, band: seat.band };
    const handle = slice.open(this.ctx, request);
    if (handle === null || typeof handle !== 'object' || typeof handle.id !== 'string' || handle.id === '') {
      throw createError('GUIF-E-SLICE-INVALID', 'overlay 切片必须返回带字符串 id 的句柄（装配期契约被破坏）', { handle: describeValue(handle) });
    }
    return handle;
  }

  /** 关闭；**合法但不存在的 id 返回 false（幂等），形态非法才抛**。 */
  close(id) {
    return this.__dispatch('close', id);
  }

  /** 点击置顶（同层内的叠放序；跨族恒由数字表决定）；语义与 close 相同。 */
  bringToFront(id) {
    return this.__dispatch('bringToFront', id);
  }

  __dispatch(method, id) {
    if (typeof id !== 'string' || id === '') {
      throw createError('GUIF-E-OVERLAY-ID', `overlay.${method}(id) 的 id 必须是非空字符串（窗口不存在时返回 false，不抛错）`, { id: describeValue(id) });
    }
    const slice = this.__service.__installed.get('overlay');
    if (slice === undefined || typeof slice[method] !== 'function') {
      throw createError('GUIF-E-CAPABILITY-ABSENT', `浮层能力未装配（浮层切片的 install(ctx, env) 未执行）—— overlay.${method}`, { capability: 'overlay' });
    }
    return slice[method](this.ctx, id) !== false;
  }
};

/**
 * `dock` 命名空间（用户裁定「开放一个 API」）——**「按钮面板」的公开开关**。
 *
 * ═══ 它解决的是哪条契约缺口 ═══
 * 加它之前：`supports('dock')` 返回 true（切片装了就 true），可**公开面没有任何入口**能打开那块面板 ——
 * 只有坞自己（点侧栏那一行 / 管理页的自检按钮）能开，外部插件只能绕平台的
 * `ctx.layout.selectPanel('dsh-gui-frame/dock')` 去触发折回页（README 的「契约缺口」那一节自己记着这件事）。
 *
 * ═══ 三条语义（写死在这里，改它就是改公开契约）═══
 *  ① **同一扇面板**：与「点侧栏那一行」走的是同一次打开 —— 同一个窗口 id
 *     （`dock/panels.mjs` 的 `DOCK_PANEL_ID`）、同一份正文（外部插件交进来的 `kind:'action'` 按钮）、
 *     同一套锚点规则（不给锚点就用坞入口字形记的矩形，拿不到就用安全缺省位）；
 *  ② **共享 UI，不是调用方的窗口**：它归**插件整体**所有（`ctx.gui-frame` 服务在场期间一直在），
 *     所以**不**把任何副作用挂到调用方 fiber 上（`open` 之后调用方卸载**不会**替你关掉它）——
 *     要成对收尾就自己调 `close()`；这与 `overlay.open` 的「调用方私有窗口」语义**故意不同**，
 *     因为「按钮面板」是全局一件的东西，不是谁的私有浮窗；
 *  ③ **能力缺席 ⇒ `false`，不抛**：坞切片未装（本包没装上 / 让位给了别人）或浮层切片未装时，
 *     `open()` 返回 `false`（与坞内部 `openDockPanel` 的口径**同一份**：它也是拿 overlay 开不出来就 false，
 *     折回页据此退回管理页）。要提前判断用 `ctx.guiFrame.supports('dock')`；真正的异常（切片形状破了）
 *     会记一条 `GUIF-W-LISTENER-THREW` 诊断，不静默吞掉。
 */
const DockFace = class DockFace {
  constructor(ctx, service) {
    this.ctx = ctx;
    this.__service = service;
  }

  /**
   * 打开（或把已在场的面板**重新置顶**）「按钮面板」。
   * @param {{anchor?:{left?:number, top?:number, right?:number, width?:number, height?:number}|null}} [options]
   *   `anchor` 是**可选的**定位矩形（触发它的那颗按钮的屏幕矩形）；缺省/非法 ⇒ 用坞入口字形记的矩形。
   * @returns {boolean} 面板此刻是否在场（`false` ＝ 没开成，成因见类注释③；形态非法**不抛**，按「不给锚点」处理）
   */
  open(options) {
    const slice = this.__dock();
    if (slice === null || typeof slice.open !== 'function') return false;
    return this.__call('open', slice, dockAnchorOf(options));
  }

  /** 关掉「按钮面板」（幂等：不在场 ⇒ `false`）。返回**操作前**是否在场。 */
  close() {
    const slice = this.__dock();
    if (slice === null || typeof slice.close !== 'function') return false;
    return this.__call('close', slice);
  }

  /** 面板此刻是否在场（只读；坞/浮层切片缺席 ⇒ `false`）。 */
  isOpen() {
    const slice = this.__dock();
    if (slice === null || typeof slice.isOpen !== 'function') return false;
    return this.__call('isOpen', slice);
  }

  /** 坞切片（未装配 ⇒ `null`，**不抛**：这是「本包没装上」的正常一态，不是异常）。 */
  __dock() {
    const service = this.__service;
    if (service === null || typeof service.__slice !== 'function') return null;
    const slice = service.__slice('dock');
    return slice === undefined || slice === null || typeof slice !== 'object' ? null : slice;
  }

  /**
   * 切片调用一律收成 boolean：**切片形状破了的错要留痕**（诊断环 + warn 日志），
   * 但不把异常冒到调用点 —— 这个接口的调用方是「想弹一块 UI」的人，不该为了弹不出来去写 try/catch。
   */
  __call(method, slice, ...args) {
    try {
      return slice[method](...args) === true;
    } catch (error) {
      try {
        this.__service.__note('GUIF-W-LISTENER-THREW', `dock.${method} 抛错（已吞，返回 false）：${describeError(error)}`);
      } catch {
        // 诊断本身失败不再往上冒（与 __broadcast 同一口径）
      }
      return false;
    }
  }
};

/**
 * 从 `dock.open(options)` 里取出锚点矩形：**只认对象**，其余（缺省 / null / 数字 / 字符串）
 * 一律当「不给锚点」⇒ 由坞回落到入口字形的矩形。字段形态的宽容由 `panelRectNear` 承担
 * （读不到 left/right/top 就退到安全缺省位），这里不重复一遍校验。
 * @param {unknown} options
 * @returns {object|null}
 */
function dockAnchorOf(options) {
  if (options === null || options === undefined || typeof options !== 'object') return null;
  const anchor = options.anchor;
  return anchor !== null && typeof anchor === 'object' ? anchor : null;
}


  return { ComponentFace: ComponentFace, OverlayFace: OverlayFace, DockFace: DockFace, dockAnchorOf: dockAnchorOf };
}());
__esMod["./service/core.mjs"] = (function () {
  var { createError, formatDiagnostic } = __esMod["./contracts/errors.mjs"];
  var { CAPABILITIES, CAPABILITY_SLICES, SERVICE_VERSION, SLICE_NAMES } = __esMod["./contracts/service-face.mjs"];
  var { createLayerAllocator } = __esMod["./contracts/layers.mjs"];
  var { probeLogger } = __esMod["./kit/probe.mjs"];
  var { entryRank, normalizeEntry } = __esMod["./service/entries.mjs"];
  var { ComponentFace, DockFace, OverlayFace } = __esMod["./service/faces.mjs"];
  var { describeError, describeValue, truncate } = __esMod["./service/text.mjs"];
/**
 * core.mjs —— **`ctx.gui-frame` 服务面实例**（从 `service.mjs` 原样搬出，行为一字未改）。
 *
 * 哪些没变（都是判据盯着的机制，不是风格）：
 *   · `register / supports` 是**原型方法**，`components / dock / overlay` 是**原型取值器**（v1.0 交付面＝坞 + 面板服务，面板走托管浮层）
 *     —— 取值器同样走「调用点绑定」，`ctx.guiFrame.overlay` 在访问时读**调用方** ctx，于是
 *     `dock.open()` 里注册的 effect 落在调用方 fiber 上（`tests/verify-surface/service-lifecycle.test.mjs`
 *     用 `Object.create(service)` 模拟官方代理盯这条）；
 *   · 实例自有数据字段**不得与原型成员同名**（`this.__entries = …` 曾把 `__entries()` 方法盖掉）；
 *   · `__install` 的切片白名单＝`SLICE_NAMES`；`__effect` 一律挂在**调用方** fiber；
 *   · 本文件**零副作用**：不注册座位、不订阅事件、不碰 window/document。
 *
 * 依赖方向：`service/**` 是装配层（L3），可依赖任何域；本件依赖词汇叶 `contracts/**`、共享叶 `kit/**`
 * 与同域拆件 `entries.mjs` / `text.mjs`。
 */








/** 诊断环容量（`__note` 的保留条数；诊断上报链路自己再去重/封顶）。 */
const DIAGNOSTIC_LIMIT = 64;
/**
 * 服务面实例。**不要从实例上取属性再延迟调用**（那会丢掉调用点绑定）：
 * 正确用法恒为 `ctx.guiFrame.register(...)` / `ctx.guiFrame.overlay.open(...)`。
 */
const GuiFrameService = class GuiFrameService {
  /**
   * @param {object} ctx 提供者根 ctx（cordis 服务代理会在**调用点**把它换成调用方 ctx —— 见文件头）
   */
  constructor(ctx) {
    /** 调用方 ctx（调用点由 cordis 服务代理绑定；构造时＝提供者根 ctx）。 */
    this.ctx = ctx;
    this.version = SERVICE_VERSION;
    this.capabilities = CAPABILITIES;
    // ⚠ 内部数据字段**不得与原型成员同名**：实例自有属性会遮蔽原型方法/取值器
    //   （真踩过：`this.__entries = new Map()` 把 `__entries()` 方法盖掉 ⇒ 调用直接 TypeError）。
    //   `tests/unit/service.test.mjs` 有一条「自有属性 ∩ 原型成员 = ∅」的守卫盯着这件事。
    this.__installed = new Map();
    this.__registry = new Map();
    this.__entrySeq = 0;
    this.__diagnostics = [];
    this.__views = { components: new WeakMap(), dock: new WeakMap(), overlay: new WeakMap() };
    this.__stores = { components: new Map() };
    /**
     * ⚠ 这里**不放布局内态**：`__face` 的三个 kind 是 components/dock/overlay，
     * `LayoutFace` 无实例化点 ⇒ 任何布局字段都**没有路径**能从服务面上拿到，
     * 只会在 `__shutdown` 里留下一句够不着的清理。
     * 判据：`tests/unit/service-cleanup.test.mjs` 用源码扫描钉住它不再回来。
     */
    this.__layers = createLayerAllocator({ onWarning: (warning) => this.__note(warning.code, warning.message, warning.details) });
  }

  // ── 公开面：取值器（命名空间；必须是取值器，理由见文件头）────────────────────────────────

  get components() {
    return this.__face('components', ComponentFace, this.__stores.components);
  }

  /**
   * ★ **「按钮面板」的公开入口** —— `open()/close()/isOpen()`。
   * 语义与「点侧栏那一行」同源同一扇（详见 `faces.mjs` 的 `DockFace`）；能力缺席返回 `false` 不抛。
   */
  get dock() {
    return this.__face('dock', DockFace);
  }

  /**
   * **托管浮层**（能力⑥的一半；v1 保留它是因为「按钮面板」本身就是浮层实现：
   * `dock/panels.mjs` 走 `service.overlay.open({family:'panel'})`）。
   * 切片缺席时 `open` 抛 `GUIF-E-CAPABILITY-ABSENT`（与 v2 同语义）。
   */
  get overlay() {
    return this.__face('overlay', OverlayFace, this.__layers);
  }

  // ── 公开面：方法 ──────────────────────────────────────────────────────────────────────

  /**
   * 登记一个入口（自带 demo 与所有接入方都用它）。
   * `entry`：`{ id, label?, order?, group?, kind?, source? }` ——
   *  - `id` **必须带命名空间前缀**（如 `dsh-gui-frame/demo`），不得占用保留 key `conversation`；
   *  - `label` 传 thunk 以跟随 locale；`kind` ∈ `panel|action`（混合策略）；
   *  - `source` 是插件自报的包名（stale 判定要用）。
   * @param {object} entry
   * @param {Function|object} Component React 组件（任意形状，GUIFrame 只负责挂载，不碰内部结构）
   * @returns {() => void} disposer（幂等；卸载调用方 fiber 时 Cordis 会自动跑它）
   */
  register(entry, Component) {
    const ctx = this.ctx;
    const record = normalizeEntry(entry, Component);
    if (this.__registry.has(record.id)) {
      throw createError('GUIF-E-ENTRY-DUPLICATE', `入口 ${record.id} 已在册（同一 id 只能注册一次；先调用上一次返回的 disposer）`, { id: record.id });
    }
    this.__assertCtx(ctx, 'register');
    record.seq = this.__entrySeq;
    this.__entrySeq += 1;
    this.__registry.set(record.id, record);
    this.__broadcast({ type: 'added', entry: record });
    return this.__effect(ctx, `gui-frame: register ${record.id}`, () => () => {
      if (this.__registry.get(record.id) === record) {
        this.__registry.delete(record.id);
        this.__broadcast({ type: 'removed', entry: record });
      }
    });
  }

  /**
   * 能力是否**当前可用**：声明里有它（`capabilities`）**且**对应的切片已装配；
   * `layout` 无需切片（服务面自带内存态）。接入方应在调用前用它做优雅降级。
   */
  supports(name) {
    if (!CAPABILITIES.includes(name)) return false;
    const slice = CAPABILITY_SLICES[name];
    if (slice === null || slice === undefined) return true;
    return this.__installed.has(slice);
  }

  // ── 内部面（`__` 前缀：受【装配契约 v1】约束，但**不进公开面快照**）──────────────────────

  /** 装配一个能力切片（能力模块的 install 调用）。返回 disposer（可作 `ctx.effect` 的清理器）。 */
  __install(name, api) {
    if (!SLICE_NAMES.includes(name)) {
      throw createError('GUIF-E-SLICE-INVALID', `未知切片名 ${describeValue(name)}（白名单：${SLICE_NAMES.join(' / ')}）`, { name });
    }
    if (api === null || (typeof api !== 'object' && typeof api !== 'function')) {
      throw createError('GUIF-E-SLICE-INVALID', `切片 ${name} 的装配面必须是对象或函数（收到 ${describeValue(api)}）`, { name });
    }
    if (this.__installed.has(name)) {
      throw createError('GUIF-E-SLICE-INVALID', `切片 ${name} 已装配过（重复装配 = 两套实现抢同一能力；先调用上一次 __install 返回的 disposer）`, { name });
    }
    this.__installed.set(name, api);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (this.__installed.get(name) === api) this.__installed.delete(name);
    };
  }

  /** 读切片（诊断；调用公开方法不需要它）。 */
  __slice(name) {
    return this.__installed.get(name);
  }

  /** 已装配切片名（排序）—— `service.supports()` 的运行时补充。 */
  __slices() {
    return [...this.__installed.keys()].sort();
  }

  /**
   * 当前全部入口（**内部**；坞用它做初始挂载，之后靠 `dock.onEntry` 增量通知）。
   * 排序：`order` 升序，`order` 缺失的按注册序排在最后（「恢复完成前注册的直接进坞」）。
   */
  __entries() {
    return [...this.__registry.values()]
      .sort((left, right) => entryRank(left) - entryRank(right) || left.seq - right.seq)
      .map((record) => ({ ...record }));
  }

  /** 记一条诊断（进内存环 + `ctx.logger.warn`）。**限长**：超长消息截断，避免把栈灌进日志。 */
  __note(code, message, details) {
    const diagnostic = { code, message: truncate(String(message), 512), details: details === undefined ? null : details, at: Date.now() };
    this.__diagnostics.push(diagnostic);
    if (this.__diagnostics.length > DIAGNOSTIC_LIMIT) this.__diagnostics.splice(0, this.__diagnostics.length - DIAGNOSTIC_LIMIT);
    this.__log('warn', formatDiagnostic(diagnostic));
    return diagnostic;
  }

  /** 取走并清空诊断环（诊断上报链路用）。 */
  __drainDiagnostics() {
    return this.__diagnostics.splice(0, this.__diagnostics.length);
  }

  /** 提供者 fiber 卸载时的收尾（`provideService` 的 effect 调它）。 */
  __shutdown() {
    for (const [name, api] of [...this.__installed]) {
      this.__installed.delete(name);
      if (api !== null && typeof api.dispose === 'function') {
        try {
          api.dispose();
        } catch (error) {
          this.__note('GUIF-W-LISTENER-THREW', `切片 ${name} 的 dispose 抛错（已吞）：${describeError(error)}`);
        }
      }
    }
    this.__registry.clear();
  }

  /** 调用方 ctx 的准入（Cordis 必备面；缺了绝不静默退化成「直接执行」）。 */
  __assertCtx(ctx, who) {
    if (ctx === null || ctx === undefined || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
      throw createError('GUIF-E-CTX-INVALID', `${who} 需要在 Cordis ctx 上调用（ctx.effect 缺失 ⇒ 清理会挂不上调用方 fiber，不接受退化路径）`, { who });
    }
    return ctx;
  }

  /** 在**调用方** fiber 上注册一条副作用，返回幂等 disposer。 */
  __effect(ctx, label, install) {
    this.__assertCtx(ctx, label);
    const dispose = ctx.effect(install, label);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (typeof dispose === 'function') dispose();
    };
  }

  /** 按**调用方 ctx** 取命名空间视图（WeakMap 缓存：同一 ctx 拿同一个面）。 */
  __face(kind, Face, ...rest) {
    const ctx = this.__assertCtx(this.ctx, `${kind} 命名空间`);
    const cache = this.__views[kind];
    let face = cache.get(ctx);
    if (face === undefined) {
      face = new Face(ctx, this, ...rest);
      cache.set(ctx, face);
    }
    return face;
  }

  __broadcast(change) {
    const slice = this.__installed.get('dock');
    if (slice === undefined || typeof slice.onEntry !== 'function') return;
    try {
      slice.onEntry(this.ctx, change);
    } catch (error) {
      this.__note('GUIF-W-LISTENER-THREW', `dock 切片的 onEntry 抛错（已吞，注册不回滚）：${describeError(error)}`);
    }
  }

  __log(level, line) {
    const logger = probeLogger(this.ctx);
    if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](line);
  }
};
  return { GuiFrameService: GuiFrameService };
}());
__esMod["./service.mjs"] = (function () {
  var { createError, formatDiagnostic } = __esMod["./contracts/errors.mjs"];
  var { SERVICE_NAME } = __esMod["./contracts/service-face.mjs"];
  var { GuiFrameService: _GuiFrameService } = __esMod["./service/core.mjs"];
  var { describeError, describeValue, logTo, noop } = __esMod["./service/text.mjs"];
/**
 * service.mjs —— `ctx.gui-frame` **服务面冻结** ＋ **提供入口** `provideService(ctx)`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【装配契约 v1】—— 能力模块并行开发时的**唯一**接口真相
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ① **装配函数签名统一为 `install(ctx, env)`**（单一 options bag，日后加面不改签名）：
 *    - `env.service` = `ctx.gui-frame` 的服务面实例（本文件 `provideService` 的产物）；
 *    - `env.seeds`   = 种子实例表（键：`react` / `jsxRuntime` / `reactDom` / `cordis` / `store` /
 *      `primitives` / `slots` / `dockkit`），由 `entry.mjs` 把 `createClientModule(seeds)` 收到的
 *      `seeds` **原样转交**；
 *    - 签名归属：`dock / overlay / window / layout / channel(客户端) → install(ctx, env)`；
 *      `routes.mjs`（宿主半区）→ `registerRoutes(ctx)`。
 *    - **`env` 只增不改不删**：要加第 3 个面只能**追加键**（向后兼容）；改名/删键 = 契约破坏。
 *      当前刻意**只有** `service` 与 `seeds` 两项 —— 诊断上报走同级模块 import，
 *      不进 bag（避免把「谁依赖谁」写死在装配面上）。
 *
 * ② **install 内部的副作用一律经 `ctx.effect(...)` 注册**（不要自己管生命周期）：
 *    官方 `dsh-client-ui-renderer` 的 `registry.d.ts` 原文点明「cordis 服务代理在**调用点**把
 *    `this.ctx` 绑到**调用方** ctx，箭头函数属性会把 `this` 冻在服务自己的 root ctx 上、
 *    静默破坏按插件卸载」——装配阶段的副作用同理必须挂在调用方 fiber 上。
 *
 * ③ **没有 JSX（最容易踩）**：自研打包器只重写 import/export，**不做 JSX / TS 变换**。
 *    所有组件必须用 `env.seeds.react.createElement(...)` 构造；写 JSX 会在构建期以
 *    「产物语法错（`new Function` 解析失败）」的形式失败，**报错信息不会明说是 JSX**。
 *
 * ④ **模块不得 import 裸包名**（构建期即拦）；种子只能经 `env.seeds` 取用。
 *
 * ⑤ 能力分片：本文件给出 `service.__install(切片名, api)`（内部分片点，`__` 前缀**不进公开面快照**）。
 *    切片白名单＝`SLICE_NAMES`（`channel / dock / overlay / theme`）。切片方法的**第一个参数恒为调用方 ctx**，
 *    例如 `overlay.open(ctx, request)`、`channel.call(ctx, method, params)`、`dock.onEntry(ctx, change)`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【对外方法必须是原型方法】（硬约束，判据不是风格而是机制）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `register / supports / channel` 是原型**方法**；`components / layout / overlay` 是原型**取值器**
 * —— 取值器同样走「调用点绑定」：`ctx.guiFrame.overlay` 在访问时读的是**调用方** ctx，
 * 于是 `overlay.open()` 里注册的 effect 落在调用方 fiber 上。若把命名空间在构造器里
 * `this.overlay = { open() {...} }`，那个 `open` 拿到的 `this.ctx` 是服务自己的 root ctx，
 * 就会出现「插件卸载了，它开的窗口还在」这类静默泄漏 —— `tests/unit/service.test.mjs` 用
 * `Object.create(service)` 模拟官方代理，专门盯这条（改成实例箭头函数即变红）。
 *
 * 本文件**零副作用**：不注册座位、不订阅事件、不碰 window/document；只有 `provideService`
 * 被 `entry.mjs` 调用时才产生它自己那一条 `ctx.effect`（未装本包时页面完全不受影响）。
 */






/** 服务面实例（**类定义已搬 `service/core.mjs`**；本行是原路径的同一入口，行为一字未改）。 */
const GuiFrameService = _GuiFrameService;

/**
 * **提供入口**（补上「谁在哪儿把服务装上」这个汇合点缺口）：
 * 由 `src/client/entry.mjs` 在 `apply` 里调用。
 *
 * 语义：
 *  - 先 `ctx.get('gui-frame')` **探测**；已存在 ⇒ 记 `GUIF-W-SERVICE-CONFLICT` 诊断并**主动让位**
 *    （同 scope 重名 `provide` 会直接 throw ⇒ 整页死，绝不复现）；
 *  - 形态用官方最简写法 `ctx.effect(() => ctx.provide(name, service))`（theme 同款）；
 *  - 卸载（fiber 卸载或调用返回的 `dispose()`）⇒ 服务自动注销 + `__shutdown()` 收尾。
 *
 * @param {object} ctx
 * @returns {{service:object|null, owned:boolean, reason:string|null, dispose:() => void}}
 *   `owned=false` ⇒ 没轮到你提供（已存在/提供失败）：`service` 是既有实例或 `null`，
 *   `dispose()` 是空操作（**不要动别人的服务**）。
 */
function provideService(ctx) {
  if (ctx === null || typeof ctx !== 'object') {
    throw createError('GUIF-E-CTX-INVALID', `provideService(ctx) 需要一个 Cordis ctx（收到 ${describeValue(ctx)}）`, null);
  }
  const existing = typeof ctx.get === 'function' ? ctx.get(SERVICE_NAME) : undefined;
  if (existing !== undefined) {
    const message = `服务 ${SERVICE_NAME} 已存在 ⇒ 主动让位（不重复 provide：同 scope 重名会 throw，等于整页死）`;
    logTo(ctx, 'warn', formatDiagnostic({ code: 'GUIF-W-SERVICE-CONFLICT', message }));
    return { service: existing, owned: false, reason: 'conflict', dispose: noop };
  }
  const service = new GuiFrameService(ctx);
  try {
    const dispose = service.__effect(ctx, `gui-frame: provide ${SERVICE_NAME}`, () => {
      const unprovide = ctx.provide(SERVICE_NAME, service);
      return () => {
        service.__shutdown();
        if (typeof unprovide === 'function') unprovide();
      };
    });
    return { service, owned: true, reason: null, dispose };
  } catch (error) {
    const message = `提供 ${SERVICE_NAME} 失败（已让位，页面照常起）：${describeError(error)}`;
    logTo(ctx, 'error', formatDiagnostic({ code: 'GUIF-W-SERVICE-CONFLICT', message }));
    return { service: null, owned: false, reason: 'provide-failed', dispose: noop };
  }
}


  return { GuiFrameService: GuiFrameService, provideService: provideService };
}());
__esMod["./theme/tokens-data.mjs"] = (function () {
/**
 * tokens-data.mjs —— **主题 token 冻结件**（白名单真源；由 `scripts/check-tokens.mjs --write-frozen` 生成）。
 *
 * ⚠ **请勿手改**：手改会被 `node scripts/check-tokens.mjs --verify-frozen` 抓出来（重算实测逐条比对）。
 *
 * 口径（探针 P4 实测标尺）：
 *   - `FROZEN_TOKENS` = 外壳 `dsh-client-ui-theme/lib/client.js` 行内 CSS 里**声明**的 `--dsw-*` 并集；
 *   - `FROZEN_DARK_TOKENS` = 其中在 `[data-ds-dark-theme]` 段**另有暗色值**的那些（其余**继承亮色**，
 *     因此 lint 不得要求每个 token 都有暗色值）；
 *   - `PLATFORM_VARS` = 同一批样式表里的平台级变量（`--ds-*` / `--dsh-*` / `--shiki-*`）——
 *     它们是 lint 的**解析上下文**而不是白名单：少了它们，冻结白名单里亮/暗各有 25 条会被误判悬空。
 *   - **不用** `exportInspectTokens()` 的静态种子当白名单（它运行期还会叠加"已注册主题 + 覆盖层"，
 *     拿它当白名单会把大部分合法 token 判成未知；它只作**说明层**，见 `tokens.mjs` 的 INSPECT_SEED 注释）。
 *
 * 实测来源：本机 DSH 安装目录下的 `node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`
 * 产物 SHA-256：`b1c1d19438c15717dec571032a3c911eed4038d4dab8b4975ca797b7b7afd6ab`（101885 字节；行内 CSS 绑定 6 段）
 * 实测时间：2026-10-18T02:40:38.386Z｜生成命令：`node scripts/check-tokens.mjs --write-frozen`
 */

/** 数据来源与指纹（`--verify-frozen` 用它判断"冻结件是哪一版实测"）。 */
const FROZEN_PROVENANCE = Object.freeze({
  package: 'dsh-client-ui-theme',
  file: 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
  sha256: 'b1c1d19438c15717dec571032a3c911eed4038d4dab8b4975ca797b7b7afd6ab',
  bytes: 101885,
  cssBindings: 6,
  platform: 'win32',
  generatedAt: '2026-10-18T02:40:38.386Z',
});

/** `--dsw-*` 白名单：**403** 条（排序；与实测逐条相等）。 */
const FROZEN_TOKENS = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-document-preview',
  '--dsw-alias-bg-document-selection',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop',
  '--dsw-alias-bg-mask-photo',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-border-inverted',
  '--dsw-alias-border-inverted2',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-contrast-fill',
  '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-button-ghost-active-hover',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted',
  '--dsw-alias-file-diff-added-bg',
  '--dsw-alias-file-diff-added-gutter',
  '--dsw-alias-file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg',
  '--dsw-alias-file-diff-deleted-gutter',
  '--dsw-alias-file-diff-deleted-marker',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-deep-diving',
  '--dsw-alias-label-deep-diving-shimmer',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-document-preview',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-shimmer',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-placeholder',
  '--dsw-alias-markdown-tag',
  '--dsw-alias-menu-group-header-fill',
  '--dsw-alias-menu-icon',
  '--dsw-alias-onboarding-accent',
  '--dsw-alias-onboarding-card-fill',
  '--dsw-alias-onboarding-checkbox-border',
  '--dsw-alias-onboarding-secondary-fill',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-secondary',
  '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-switch-thumb',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-turn-trigger-bg',
  '--dsw-alias-turn-trigger-bg-hover',
  '--dsw-corner-shape',
  '--dsw-elevation-panel',
  '--dsw-elevation-prominent',
  '--dsw-elevation-soft',
  '--dsw-elevation-stroke',
  '--dsw-elevation-stroke-color',
  '--dsw-focus-ring-color',
  '--dsw-focus-ring-width',
  '--dsw-font-base-16',
  '--dsw-font-base-16-font-family',
  '--dsw-font-base-16-font-size',
  '--dsw-font-base-16-font-style',
  '--dsw-font-base-16-font-weight',
  '--dsw-font-base-16-line-height',
  '--dsw-font-base-strong-16',
  '--dsw-font-base-strong-16-font-family',
  '--dsw-font-base-strong-16-font-size',
  '--dsw-font-base-strong-16-font-style',
  '--dsw-font-base-strong-16-font-weight',
  '--dsw-font-base-strong-16-line-height',
  '--dsw-font-family',
  '--dsw-font-family-brand',
  '--dsw-font-l-20',
  '--dsw-font-l-20-font-family',
  '--dsw-font-l-20-font-size',
  '--dsw-font-l-20-font-style',
  '--dsw-font-l-20-font-weight',
  '--dsw-font-l-20-line-height',
  '--dsw-font-m-18',
  '--dsw-font-m-18-font-family',
  '--dsw-font-m-18-font-size',
  '--dsw-font-m-18-font-style',
  '--dsw-font-m-18-font-weight',
  '--dsw-font-m-18-line-height',
  '--dsw-font-markdown-base',
  '--dsw-font-markdown-base-font-family',
  '--dsw-font-markdown-base-font-size',
  '--dsw-font-markdown-base-font-style',
  '--dsw-font-markdown-base-font-weight',
  '--dsw-font-markdown-base-italic',
  '--dsw-font-markdown-base-italic-font-family',
  '--dsw-font-markdown-base-italic-font-size',
  '--dsw-font-markdown-base-italic-font-style',
  '--dsw-font-markdown-base-italic-font-weight',
  '--dsw-font-markdown-base-italic-line-height',
  '--dsw-font-markdown-base-line-height',
  '--dsw-font-markdown-base-strong',
  '--dsw-font-markdown-base-strong-font-family',
  '--dsw-font-markdown-base-strong-font-size',
  '--dsw-font-markdown-base-strong-font-style',
  '--dsw-font-markdown-base-strong-font-weight',
  '--dsw-font-markdown-base-strong-italic',
  '--dsw-font-markdown-base-strong-italic-font-family',
  '--dsw-font-markdown-base-strong-italic-font-size',
  '--dsw-font-markdown-base-strong-italic-font-style',
  '--dsw-font-markdown-base-strong-italic-font-weight',
  '--dsw-font-markdown-base-strong-italic-line-height',
  '--dsw-font-markdown-base-strong-line-height',
  '--dsw-font-markdown-code',
  '--dsw-font-markdown-code-block',
  '--dsw-font-markdown-code-block-font-family',
  '--dsw-font-markdown-code-block-font-size',
  '--dsw-font-markdown-code-block-font-style',
  '--dsw-font-markdown-code-block-font-weight',
  '--dsw-font-markdown-code-block-line-height',
  '--dsw-font-markdown-code-block-small',
  '--dsw-font-markdown-code-block-small-font-family',
  '--dsw-font-markdown-code-block-small-font-size',
  '--dsw-font-markdown-code-block-small-font-style',
  '--dsw-font-markdown-code-block-small-font-weight',
  '--dsw-font-markdown-code-block-small-line-height',
  '--dsw-font-markdown-code-font-family',
  '--dsw-font-markdown-code-font-size',
  '--dsw-font-markdown-code-font-style',
  '--dsw-font-markdown-code-font-weight',
  '--dsw-font-markdown-code-line-height',
  '--dsw-font-markdown-h1',
  '--dsw-font-markdown-h1-font-family',
  '--dsw-font-markdown-h1-font-size',
  '--dsw-font-markdown-h1-font-style',
  '--dsw-font-markdown-h1-font-weight',
  '--dsw-font-markdown-h1-line-height',
  '--dsw-font-markdown-h2',
  '--dsw-font-markdown-h2-font-family',
  '--dsw-font-markdown-h2-font-size',
  '--dsw-font-markdown-h2-font-style',
  '--dsw-font-markdown-h2-font-weight',
  '--dsw-font-markdown-h2-line-height',
  '--dsw-font-markdown-h3',
  '--dsw-font-markdown-h3-font-family',
  '--dsw-font-markdown-h3-font-size',
  '--dsw-font-markdown-h3-font-style',
  '--dsw-font-markdown-h3-font-weight',
  '--dsw-font-markdown-h3-line-height',
  '--dsw-font-markdown-h4',
  '--dsw-font-markdown-h4-font-family',
  '--dsw-font-markdown-h4-font-size',
  '--dsw-font-markdown-h4-font-style',
  '--dsw-font-markdown-h4-font-weight',
  '--dsw-font-markdown-h4-line-height',
  '--dsw-font-markdown-small',
  '--dsw-font-markdown-small-font-family',
  '--dsw-font-markdown-small-font-size',
  '--dsw-font-markdown-small-font-style',
  '--dsw-font-markdown-small-font-weight',
  '--dsw-font-markdown-small-italic',
  '--dsw-font-markdown-small-italic-font-family',
  '--dsw-font-markdown-small-italic-font-size',
  '--dsw-font-markdown-small-italic-font-style',
  '--dsw-font-markdown-small-italic-font-weight',
  '--dsw-font-markdown-small-italic-line-height',
  '--dsw-font-markdown-small-line-height',
  '--dsw-font-markdown-small-strong',
  '--dsw-font-markdown-small-strong-font-family',
  '--dsw-font-markdown-small-strong-font-size',
  '--dsw-font-markdown-small-strong-font-style',
  '--dsw-font-markdown-small-strong-font-weight',
  '--dsw-font-markdown-small-strong-italic',
  '--dsw-font-markdown-small-strong-italic-font-family',
  '--dsw-font-markdown-small-strong-italic-font-size',
  '--dsw-font-markdown-small-strong-italic-font-style',
  '--dsw-font-markdown-small-strong-italic-font-weight',
  '--dsw-font-markdown-small-strong-italic-line-height',
  '--dsw-font-markdown-small-strong-line-height',
  '--dsw-font-markdown-table',
  '--dsw-font-markdown-table-font-family',
  '--dsw-font-markdown-table-font-size',
  '--dsw-font-markdown-table-font-style',
  '--dsw-font-markdown-table-font-weight',
  '--dsw-font-markdown-table-head',
  '--dsw-font-markdown-table-head-font-family',
  '--dsw-font-markdown-table-head-font-size',
  '--dsw-font-markdown-table-head-font-style',
  '--dsw-font-markdown-table-head-font-weight',
  '--dsw-font-markdown-table-head-line-height',
  '--dsw-font-markdown-table-line-height',
  '--dsw-font-s-14',
  '--dsw-font-s-14-font-family',
  '--dsw-font-s-14-font-size',
  '--dsw-font-s-14-font-style',
  '--dsw-font-s-14-font-weight',
  '--dsw-font-s-14-line-height',
  '--dsw-font-s-strong-14',
  '--dsw-font-s-strong-14-font-family',
  '--dsw-font-s-strong-14-font-size',
  '--dsw-font-s-strong-14-font-style',
  '--dsw-font-s-strong-14-font-weight',
  '--dsw-font-s-strong-14-line-height',
  '--dsw-font-xl-24',
  '--dsw-font-xl-24-font-family',
  '--dsw-font-xl-24-font-size',
  '--dsw-font-xl-24-font-style',
  '--dsw-font-xl-24-font-weight',
  '--dsw-font-xl-24-line-height',
  '--dsw-font-xs-13',
  '--dsw-font-xs-13-font-family',
  '--dsw-font-xs-13-font-size',
  '--dsw-font-xs-13-font-style',
  '--dsw-font-xs-13-font-weight',
  '--dsw-font-xs-13-line-height',
  '--dsw-font-xs-strong-13',
  '--dsw-font-xs-strong-13-font-family',
  '--dsw-font-xs-strong-13-font-size',
  '--dsw-font-xs-strong-13-font-style',
  '--dsw-font-xs-strong-13-font-weight',
  '--dsw-font-xs-strong-13-line-height',
  '--dsw-font-xxs-12',
  '--dsw-font-xxs-12-font-family',
  '--dsw-font-xxs-12-font-size',
  '--dsw-font-xxs-12-font-style',
  '--dsw-font-xxs-12-font-weight',
  '--dsw-font-xxs-12-line-height',
  '--dsw-font-xxs-strong-12',
  '--dsw-font-xxs-strong-12-font-family',
  '--dsw-font-xxs-strong-12-font-size',
  '--dsw-font-xxs-strong-12-font-style',
  '--dsw-font-xxs-strong-12-font-weight',
  '--dsw-font-xxs-strong-12-line-height',
  '--dsw-font-xxxs-11',
  '--dsw-font-xxxs-11-font-family',
  '--dsw-font-xxxs-11-font-size',
  '--dsw-font-xxxs-11-font-style',
  '--dsw-font-xxxs-11-font-weight',
  '--dsw-font-xxxs-11-line-height',
  '--dsw-font-xxxs-strong-11',
  '--dsw-font-xxxs-strong-11-font-family',
  '--dsw-font-xxxs-strong-11-font-size',
  '--dsw-font-xxxs-strong-11-font-style',
  '--dsw-font-xxxs-strong-11-font-weight',
  '--dsw-font-xxxs-strong-11-line-height',
  '--dsw-gradient-onboarding-blue-stops',
  '--dsw-gradient-onboarding-cyan-stops',
  '--dsw-gradient-onboarding-violet-stops',
  '--dsw-linear-gradient-think',
  '--dsw-linear-think-select',
  '--dsw-mask-blur',
  '--dsw-menu-backdrop-filter',
  '--dsw-menu-surface-fill',
  '--dsw-radius-lg',
  '--dsw-radius-md',
  '--dsw-radius-panel',
  '--dsw-radius-sm',
  '--dsw-radius-xl',
  '--dsw-radius-xs',
  '--dsw-shadow-lv1',
  '--dsw-shadow-lv1-blur',
  '--dsw-shadow-lv2',
  '--dsw-shadow-lv3',
  '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-input-major',
  '--dsw-specific-login-input',
  '--dsw-specific-menu',
  '--dsw-specific-selector',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-active-accent',
  '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-tip',
  '--dsw-static-amber-100',
  '--dsw-static-amber-400',
  '--dsw-static-amber-500',
  '--dsw-static-amber-600',
  '--dsw-static-amber-900',
  '--dsw-static-blue-100',
  '--dsw-static-blue-300',
  '--dsw-static-blue-400',
  '--dsw-static-blue-450',
  '--dsw-static-blue-50',
  '--dsw-static-blue-500',
  '--dsw-static-blue-50p',
  '--dsw-static-blue-600',
  '--dsw-static-blue-75',
  '--dsw-static-blue-800',
  '--dsw-static-blue-900',
  '--dsw-static-blue-950',
  '--dsw-static-deepseek-100',
  '--dsw-static-deepseek-200',
  '--dsw-static-deepseek-300',
  '--dsw-static-deepseek-400',
  '--dsw-static-deepseek-450',
  '--dsw-static-deepseek-50',
  '--dsw-static-deepseek-500',
  '--dsw-static-deepseek-600',
  '--dsw-static-deepseek-700-delete',
  '--dsw-static-deepseek-800',
  '--dsw-static-deepseek-900',
  '--dsw-static-green-100',
  '--dsw-static-green-400',
  '--dsw-static-green-500',
  '--dsw-static-green-500-a08',
  '--dsw-static-green-500-a12',
  '--dsw-static-green-900',
  '--dsw-static-neutral-00',
  '--dsw-static-neutral-100',
  '--dsw-static-neutral-1000',
  '--dsw-static-neutral-150',
  '--dsw-static-neutral-200',
  '--dsw-static-neutral-250',
  '--dsw-static-neutral-300',
  '--dsw-static-neutral-400',
  '--dsw-static-neutral-50',
  '--dsw-static-neutral-500',
  '--dsw-static-neutral-550',
  '--dsw-static-neutral-600',
  '--dsw-static-neutral-700',
  '--dsw-static-neutral-800',
  '--dsw-static-neutral-850',
  '--dsw-static-neutral-900',
  '--dsw-static-neutral-bluish-00',
  '--dsw-static-neutral-bluish-100',
  '--dsw-static-neutral-bluish-1000',
  '--dsw-static-neutral-bluish-150',
  '--dsw-static-neutral-bluish-200',
  '--dsw-static-neutral-bluish-300',
  '--dsw-static-neutral-bluish-400',
  '--dsw-static-neutral-bluish-50',
  '--dsw-static-neutral-bluish-500',
  '--dsw-static-neutral-bluish-60',
  '--dsw-static-neutral-bluish-600',
  '--dsw-static-neutral-bluish-700',
  '--dsw-static-neutral-bluish-75',
  '--dsw-static-neutral-bluish-750',
  '--dsw-static-neutral-bluish-800',
  '--dsw-static-neutral-bluish-850',
  '--dsw-static-neutral-bluish-875',
  '--dsw-static-neutral-bluish-900',
  '--dsw-static-neutral-bluish-950',
  '--dsw-static-red-100',
  '--dsw-static-red-400',
  '--dsw-static-red-400-a12',
  '--dsw-static-red-50',
  '--dsw-static-red-500',
  '--dsw-static-red-600',
  '--dsw-static-red-600-a08',
  '--dsw-static-red-900',
]);

/** 暗色**另有值**的 token：**196** 条（其余 207 条继承亮色 —— 非缺陷）。 */
const FROZEN_DARK_TOKENS = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-document-preview',
  '--dsw-alias-bg-document-selection',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop',
  '--dsw-alias-bg-mask-photo',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-border-inverted',
  '--dsw-alias-border-inverted2',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-contrast-fill',
  '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-button-ghost-active-hover',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted',
  '--dsw-alias-file-diff-added-bg',
  '--dsw-alias-file-diff-added-gutter',
  '--dsw-alias-file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg',
  '--dsw-alias-file-diff-deleted-gutter',
  '--dsw-alias-file-diff-deleted-marker',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-deep-diving',
  '--dsw-alias-label-deep-diving-shimmer',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-document-preview',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-shimmer',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-placeholder',
  '--dsw-alias-markdown-tag',
  '--dsw-alias-menu-group-header-fill',
  '--dsw-alias-menu-icon',
  '--dsw-alias-onboarding-card-fill',
  '--dsw-alias-onboarding-checkbox-border',
  '--dsw-alias-onboarding-secondary-fill',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-secondary',
  '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-switch-thumb',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-turn-trigger-bg',
  '--dsw-alias-turn-trigger-bg-hover',
  '--dsw-elevation-stroke-color',
  '--dsw-linear-gradient-think',
  '--dsw-linear-think-select',
  '--dsw-menu-surface-fill',
  '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-input-major',
  '--dsw-specific-login-input',
  '--dsw-specific-menu',
  '--dsw-specific-selector',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-active-accent',
  '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-tip',
  '--dsw-static-amber-100',
  '--dsw-static-amber-400',
  '--dsw-static-amber-500',
  '--dsw-static-amber-600',
  '--dsw-static-amber-900',
  '--dsw-static-blue-100',
  '--dsw-static-blue-300',
  '--dsw-static-blue-400',
  '--dsw-static-blue-450',
  '--dsw-static-blue-50',
  '--dsw-static-blue-500',
  '--dsw-static-blue-50p',
  '--dsw-static-blue-600',
  '--dsw-static-blue-75',
  '--dsw-static-blue-800',
  '--dsw-static-blue-900',
  '--dsw-static-blue-950',
  '--dsw-static-deepseek-100',
  '--dsw-static-deepseek-200',
  '--dsw-static-deepseek-300',
  '--dsw-static-deepseek-400',
  '--dsw-static-deepseek-450',
  '--dsw-static-deepseek-50',
  '--dsw-static-deepseek-500',
  '--dsw-static-deepseek-600',
  '--dsw-static-deepseek-700-delete',
  '--dsw-static-deepseek-800',
  '--dsw-static-deepseek-900',
  '--dsw-static-green-100',
  '--dsw-static-green-400',
  '--dsw-static-green-500',
  '--dsw-static-green-500-a08',
  '--dsw-static-green-500-a12',
  '--dsw-static-green-900',
  '--dsw-static-neutral-00',
  '--dsw-static-neutral-100',
  '--dsw-static-neutral-1000',
  '--dsw-static-neutral-150',
  '--dsw-static-neutral-200',
  '--dsw-static-neutral-250',
  '--dsw-static-neutral-300',
  '--dsw-static-neutral-400',
  '--dsw-static-neutral-50',
  '--dsw-static-neutral-500',
  '--dsw-static-neutral-550',
  '--dsw-static-neutral-600',
  '--dsw-static-neutral-700',
  '--dsw-static-neutral-800',
  '--dsw-static-neutral-850',
  '--dsw-static-neutral-900',
  '--dsw-static-neutral-bluish-00',
  '--dsw-static-neutral-bluish-100',
  '--dsw-static-neutral-bluish-1000',
  '--dsw-static-neutral-bluish-150',
  '--dsw-static-neutral-bluish-200',
  '--dsw-static-neutral-bluish-300',
  '--dsw-static-neutral-bluish-400',
  '--dsw-static-neutral-bluish-50',
  '--dsw-static-neutral-bluish-500',
  '--dsw-static-neutral-bluish-60',
  '--dsw-static-neutral-bluish-600',
  '--dsw-static-neutral-bluish-700',
  '--dsw-static-neutral-bluish-75',
  '--dsw-static-neutral-bluish-750',
  '--dsw-static-neutral-bluish-800',
  '--dsw-static-neutral-bluish-850',
  '--dsw-static-neutral-bluish-875',
  '--dsw-static-neutral-bluish-900',
  '--dsw-static-neutral-bluish-950',
  '--dsw-static-red-100',
  '--dsw-static-red-400',
  '--dsw-static-red-400-a12',
  '--dsw-static-red-50',
  '--dsw-static-red-500',
  '--dsw-static-red-600',
  '--dsw-static-red-600-a08',
  '--dsw-static-red-900',
]);

/** 平台变量（解析上下文，**不是**白名单成员）：24 个。 */
const PLATFORM_VARS = Object.freeze([
  '--ds-ease-in-out',
  '--ds-font-family-code',
  '--ds-transition-duration',
  '--ds-transition-duration-fast',
  '--ds-transition-duration-slow',
  '--dsh-content-font-delta',
  '--dsh-content-font-delta-secondary',
  '--dsh-content-font-size-secondary',
  '--dsh-scrollbar-thumb',
  '--dsh-scrollbar-thumb-border',
  '--dsh-scrollbar-thumb-hover',
  '--dsh-scrollbar-track-margin',
  '--dsh-scrollbar-width',
  '--shiki-background',
  '--shiki-foreground',
  '--shiki-token-comment',
  '--shiki-token-constant',
  '--shiki-token-function',
  '--shiki-token-keyword',
  '--shiki-token-link',
  '--shiki-token-parameter',
  '--shiki-token-punctuation',
  '--shiki-token-string',
  '--shiki-token-string-expression',
]);
  return { FROZEN_PROVENANCE: FROZEN_PROVENANCE, FROZEN_TOKENS: FROZEN_TOKENS, FROZEN_DARK_TOKENS: FROZEN_DARK_TOKENS, PLATFORM_VARS: PLATFORM_VARS };
}());
__esMod["./theme/tokens.mjs"] = (function () {
  var { FROZEN_DARK_TOKENS: DATA_DARK_TOKENS, FROZEN_PROVENANCE: DATA_PROVENANCE, FROZEN_TOKENS: DATA_TOKENS, PLATFORM_VARS: DATA_PLATFORM_VARS } = __esMod["./theme/tokens-data.mjs"];
/**
 * tokens.mjs —— **主题 token 表逻辑**（能力④，探针 P4 实测标尺）。
 *
 * 本文件只做**表与判据**，数据在 `tokens-data.mjs`（生成物，勿手改）：
 *   - `FROZEN_TOKENS`：**403** 个 `--dsw-*` —— 外壳 `dsh-client-ui-theme` 产物里**声明**的并集，
 *     这是**唯一白名单**；
 *   - `FROZEN_DARK_TOKENS`：其中 **196** 个另有暗色值；**其余 207 个继承亮色，不是缺陷**
 *     （探针 P4 实测 `darkOnlyTokens: []`：没有任何 token 是「只有暗色」的）——
 *     所以 lint **不得**要求每个 token 都有暗色值；
 *   - `PLATFORM_VARS`：**24** 个平台变量（`--ds-*` 5 / `--dsh-*` 8 / `--shiki-*` 11）。
 *     它们是**解析上下文**而不是白名单成员：只用 `--dsw-*` 表自洽，403 条里亮/暗各有 25 条悬空
 *     （19 条引用 `--dsh-content-font-delta`、6 条引用 `--ds-font-family-code`）；
 *     纳入平台变量后 0 条悬空。两条数字都由 `node scripts/check-tokens.mjs --verify-frozen` 实测复现。
 *
 * ⚠ 三条反面清单（踩过就有代价）：
 *   ① **不要**把 `exportInspectTokens()` 的 14 个静态种子当白名单 —— 它运行期还会叠加
 *      「已注册主题 + 覆盖层」的 token 名，拿它当白名单会把 **389** 个合法 token 判成未知
 *      （`INSPECT_SEED_TOKENS` 只作**说明层**：给「这些名字长什么样」当例子）；
 *   ② **不要**按 `--dsw-` 前缀以外的规则「猜」token 合法性（如 `--dsw-alias-*` 才认）——
 *     前缀分布 font 182 / alias 107 / static 77 / specific 11 / radius 6 / elevation 5 / shadow 4 /
 *     gradient 3 / menu 2 / focus 2 / linear 2 / corner 1 / mask 1，任何前缀白名单都会误报；
 *   ③ 本文件的判据是**纯函数**，不碰 DOM、不读全局，故 L0 层可直接单测。
 */



/**
 * 冻结件重导出（下游只需 import 本文件）。
 * ⚠ 这里**不能**写 `export { … } from` 重导出形式：自研打包器只支持 `export const X = …` /
 * `export function f()`，`export { … }` 是**构建失败**面（实测报错「不支持 export { … } 形式」）。
 */
const FROZEN_TOKENS = DATA_TOKENS;
const FROZEN_DARK_TOKENS = DATA_DARK_TOKENS;
const PLATFORM_VARS = DATA_PLATFORM_VARS;
const FROZEN_PROVENANCE = DATA_PROVENANCE;

/** 设计系统 token 前缀。 */
const TOKEN_PREFIX = '--dsw-';
/** GUIFrame **公开** CSS 变量前缀（组件对外只暴露这一族）。 */
const GUIF_PUBLIC_PREFIX = '--guif-';
/** GUIFrame **私有** CSS 变量前缀（内部状态一律加 `private-`：公开面只留 `--guif-*`）。 */
const GUIF_PRIVATE_PREFIX = '--guif-private-';
/** 解析上下文里的平台命名空间（顺序与验收条款一致：`--dsh-*` / `--ds-*` / `--shiki-*`）。 */
const PLATFORM_NAMESPACES = Object.freeze(['--dsh-', '--ds-', '--shiki-']);

/** 白名单条数（403）——硬编码在断言里，避免"悄悄换成一个更小的表"也能过。 */
const FROZEN_TOKEN_COUNT = FROZEN_TOKENS.length;
/** 暗色另有值的条数（196）。 */
const FROZEN_DARK_COUNT = FROZEN_DARK_TOKENS.length;
/** 继承亮色的条数（207）——**不是**待补清单。 */
const FROZEN_INHERITED_COUNT = FROZEN_TOKEN_COUNT - FROZEN_DARK_COUNT;

/**
 * `exportInspectTokens()` 的**静态种子**（14 条，探针 P4 的 B 段实测）。
 * **只作说明层**：它是「inspect 目录里长什么样」的样例，不是全集、不参与白名单判定。
 * 实测：14 条**全部**在 403 里（`inDirectoryNotInStylesheet: []`），但 403 里有 389 条不在它里面。
 */
const INSPECT_SEED_TOKENS = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]);

const FROZEN_SET = new Set(FROZEN_TOKENS);
const DARK_SET = new Set(FROZEN_DARK_TOKENS);
const PLATFORM_SET = new Set(PLATFORM_VARS);

/** 是不是 403 白名单成员。 */
function isFrozenToken(name) {
  return typeof name === 'string' && FROZEN_SET.has(name);
}

/** 该 token 是否**另有暗色值**（false ≠ 缺暗色：它继承亮色）。 */
function isDarkCovered(name) {
  return typeof name === 'string' && DARK_SET.has(name);
}

/** 是不是平台变量（解析上下文成员；`--ds-*` / `--dsh-*` / `--shiki-*`）。 */
function isPlatformVar(name) {
  return typeof name === 'string' && PLATFORM_SET.has(name);
}

/** 是否是**未知**的 `--dsw-*` 名（既不冻结、也不是平台变量、也没被动态登记）。 */
function isUnknownToken(name, extra) {
  if (typeof name !== 'string' || !name.startsWith(TOKEN_PREFIX)) return false;
  if (FROZEN_SET.has(name) || PLATFORM_SET.has(name)) return false;
  if (extra !== undefined && extra !== null) {
    if (extra instanceof Set ? extra.has(name) : Array.isArray(extra) ? extra.includes(name) : false) return false;
  }
  return true;
}

/** 公开 `--guif-*` 变量（不得以 `--guif-private-` 开头，那是私有族）。 */
function isGuifPublicVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PUBLIC_PREFIX) && !name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 私有 `--guif-private-*` 变量。 */
function isGuifPrivateVar(name) {
  return typeof name === 'string' && name.startsWith(GUIF_PRIVATE_PREFIX);
}

/** 变量名形态：`--` 开头的 kebab（不校验语义，只挡明显写错的名字）。 */
function isValidVarName(name) {
  return typeof name === 'string' && /^--[a-z0-9][a-z0-9-]*$/.test(name);
}

/**
 * 暗色覆盖策略（**只读声明**，供 lint 与文档共用；item 10 的口径）。
 * `requireAll: false` 是**刻意**的：要求每个 token 都有暗色值会与外壳自身的 196/207 现实打架。
 */
const DARK_COVERAGE_POLICY = Object.freeze({
  attribute: 'data-ds-dark-theme',
  selector: 'body[data-ds-dark-theme]',
  covered: FROZEN_DARK_COUNT,
  inherited: FROZEN_INHERITED_COUNT,
  requireAll: false,
  note: '暗色只覆盖 196 条，其余 207 条继承亮色；lint 不得把「无暗色值」报成问题。',
});
  return { FROZEN_TOKENS: FROZEN_TOKENS, FROZEN_DARK_TOKENS: FROZEN_DARK_TOKENS, PLATFORM_VARS: PLATFORM_VARS, FROZEN_PROVENANCE: FROZEN_PROVENANCE, TOKEN_PREFIX: TOKEN_PREFIX, GUIF_PUBLIC_PREFIX: GUIF_PUBLIC_PREFIX, GUIF_PRIVATE_PREFIX: GUIF_PRIVATE_PREFIX, PLATFORM_NAMESPACES: PLATFORM_NAMESPACES, FROZEN_TOKEN_COUNT: FROZEN_TOKEN_COUNT, FROZEN_DARK_COUNT: FROZEN_DARK_COUNT, FROZEN_INHERITED_COUNT: FROZEN_INHERITED_COUNT, INSPECT_SEED_TOKENS: INSPECT_SEED_TOKENS, isFrozenToken: isFrozenToken, isDarkCovered: isDarkCovered, isPlatformVar: isPlatformVar, isUnknownToken: isUnknownToken, isGuifPublicVar: isGuifPublicVar, isGuifPrivateVar: isGuifPrivateVar, isValidVarName: isValidVarName, DARK_COVERAGE_POLICY: DARK_COVERAGE_POLICY };
}());
__esMod["./theme/lint.mjs"] = (function () {
  var { DARK_COVERAGE_POLICY, FROZEN_DARK_TOKENS, FROZEN_TOKENS, PLATFORM_NAMESPACES, PLATFORM_VARS, TOKEN_PREFIX, isFrozenToken, isGuifPrivateVar, isGuifPublicVar, isPlatformVar, isUnknownToken, isValidVarName } = __esMod["./theme/tokens.mjs"];
/**
 * lint.mjs —— **主题 lint（告警式）**：硬编码颜色 + token 白名单 + 解析上下文 + 动态 token（能力④）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【二分口径】本文件是「第三方一侧」的实现
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * lint 是**告警式、不阻断构建**（对象是第三方与存量插件）；`npm run check:tokens`
 * 对本包源码**以非零退出码拦下**（对象是自己）。这条二分是裁定下来的口径，可被推翻。
 * 落到代码：本文件**只产出诊断（warnings）**，任何一条都不 throw、不阻断；
 * 硬门禁在 `scripts/check-tokens.mjs` 里，且它 import 本文件的规则 —— 两处**同一份判据**，不会漂移。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【四条判据，逐条对应验收】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ① 白名单 = `FROZEN_TOKENS`（403，外壳产物声明并集），**不是** `exportInspectTokens()` 的 14 个静态种子；
 * ② 解析上下文 = 403 ∪ `PLATFORM_VARS`（24：`--dsh-*` / `--ds-*` / `--shiki-*`）——
 *    少了平台变量，亮/暗各有 25 条会被误判悬空（`--verify-frozen` 可复现这两个数字）；
 * ③ 动态 token（第三方 `register` / `overrideTokens` 产生的新名字）**只告警不拒绝**；
 * ④ 暗色：只认 `body[data-ds-dark-theme]`，且**不要求**每个 token 有暗色值（196/207）。
 *
 * ⚠ 诊断码纪律：本文件产出的四条诊断码
 * **已显式登记进 `contracts/errors.mjs` 的 `WARNING_CODES`**（并同步 L1 公开面快照）。
 * 原因：`tests/verify-surface` 的命名空间闸门对 `src/**` **全文**正则扫 `GUIF-…` 码，要求
 * 全部 ⊆ 冻结集合（注释与字符串同样算数）——把码留在模块里会让门禁变红。
 * ⇒ 任何新码都必须走「入表 + `node scripts/public-surface.mjs --write`」两步，不许静默新增。
 * 结构性的写错（比如 name 不是字符串）走 JS 原生 `TypeError`，**不发明 `GUIF-E-*`**。
 */



/** 本模块产出的诊断码（**只告警**；不是 `contracts/errors.mjs` 的公开码）。 */
const THEME_DIAGNOSTICS = Object.freeze({
  TOKEN_UNKNOWN: 'GUIF-W-THEME-TOKEN-UNKNOWN',
  DYNAMIC_TOKEN: 'GUIF-W-THEME-DYNAMIC-TOKEN',
  LITERAL_COLOR: 'GUIF-W-THEME-LITERAL-COLOR',
  PRIVATE_LEAK: 'GUIF-W-THEME-PRIVATE-LEAK',
});

/** 具名颜色只在这些**颜色属性**的值位置才算命中（避免把普通 `'red'` 字符串当颜色）。 */
const NAMED_COLOR_PROPS = Object.freeze([
  'background', 'background-color', 'background-image', 'border', 'border-color', 'border-top-color',
  'border-bottom-color', 'border-left-color', 'border-right-color', 'color', 'fill', 'stroke',
  'box-shadow', 'outline', 'outline-color', 'text-decoration-color', 'caret-color', 'stop-color',
  'column-rule-color', 'accent-color',
]);

/** CSS 具名颜色表（判据顺序见 `COLOR_RULES`）。 */
const NAMED_COLORS = Object.freeze([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen',
  'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
  'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
  'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia',
  'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen',
  'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue',
  'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

/** 具名颜色判据：`<颜色属性> : <名字>`（名字必须完整；**允许带引号** —— 组件样式常写成 JS 对象的 `color: 'red'`）。 */
function namedColorRe() {
  const props = [...NAMED_COLOR_PROPS, ...NAMED_COLOR_PROPS.map(camelCase)].join('|');
  return new RegExp(`(?:${props})\\s*:\\s*['"]?(${NAMED_COLORS.join('|')})['"]?(?![\\w-])`, 'gi');
}

/** `border-color` → `borderColor`（JS 样式对象里的写法）。 */
function camelCase(name) {
  return name.replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase());
}

/** 逐条硬编码颜色判据（`scripts/check-tokens.mjs` 与本文件**共用同一份**）。 */
const COLOR_RULES = Object.freeze([
  { id: 'hex', label: '十六进制颜色', re: () => /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F\w-])/g },
  { id: 'rgb', label: 'rgb()/rgba() 字面量', re: () => /\brgba?\s*\(\s*[0-9.]/g },
  { id: 'hsl', label: 'hsl()/hsla() 字面量', re: () => /\bhsla?\s*\(\s*[0-9.]/g },
  { id: 'color-fn', label: 'color()/lab()/lch()/oklch() 字面量', re: () => /\b(?:color|lab|lch|oklab|oklch)\s*\(\s*[0-9a-z%]/g },
  { id: 'named', label: '具名颜色（仅颜色属性值位置）', re: namedColorRe },
]);

/** 去注释（注释里的示例色不是代码）；markdown 的 `<!-- -->` 一并去掉。 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([;,{(\[])\s*\/\/.*$/gm, '$1');
}

/** 在一段文本里找硬编码颜色 ⇒ `[{line, column, rule, label, match}]`。 */
function scanLiteralColors(text) {
  const stripped = stripComments(text);
  const hits = [];
  for (const rule of COLOR_RULES) {
    const re = rule.re();
    let match;
    while ((match = re.exec(stripped)) !== null) {
      const before = stripped.slice(0, match.index);
      hits.push({
        line: before.split('\n').length,
        column: match.index - (before.lastIndexOf('\n') + 1) + 1,
        rule: rule.id,
        label: rule.label,
        match: match[0],
      });
    }
  }
  return hits.sort((left, right) => left.line - right.line || left.column - right.column);
}

/** 变量声明 / 引用（CSS 文本级；不解析嵌套规则）。 */
function collectVars(text) {
  const declared = new Set();
  const referenced = new Set();
  const body = stripComments(text);
  const declRe = /(--[a-z0-9-]+)\s*:/g;
  let match;
  while ((match = declRe.exec(body)) !== null) declared.add(match[1]);
  const refRe = /var\(\s*(--[a-z0-9-]+)/g;
  while ((match = refRe.exec(body)) !== null) referenced.add(match[1]);
  return { declared, referenced };
}

/**
 * 建一个**解析上下文**：403 白名单 ∪ 平台变量(24) ∪ 调用方登记的动态名字。
 * @param {{dynamic?:Iterable<string>|null, platform?:boolean}} [options] `platform:false` 只为**反假绿**
 *   用例存在（证明"少了平台变量会误报 25 条"这件事在本实现里真的成立）。
 */
function createTokenContext(options = {}) {
  const platform = options.platform !== false;
  const dynamic = new Set(options.dynamic ?? []);
  return {
    dynamic,
    platform,
    has(name) {
      if (isFrozenToken(name)) return true;
      if (platform && isPlatformVar(name)) return true;
      return dynamic.has(name);
    },
    isDynamic(name) {
      return dynamic.has(name);
    },
    unknown(name) {
      return isUnknownToken(name, dynamic) && !(platform && isPlatformVar(name));
    },
  };
}

/** 造一条诊断（**只记录不阻断**；与 `contracts/errors.mjs` 的 `formatDiagnostic` 同形）。 */
function diagnostic(code, message, details) {
  return { code, message, details: details === undefined ? null : details };
}

/**
 * lint 一段样式或组件源码。
 * @param {string} text CSS / 样式片段（组件源码也行：`var(--…)` 与 `: value` 都能扫）
 * @param {{context?:object, source?:string, allowDynamic?:boolean}} [options]
 * @returns {{ok:boolean, warnings:Array<object>, unknown:string[], dynamic:string[], literals:Array<object>,
 *   platformUsed:string[], stats:object}}
 */
function lintTokenUsage(text, options = {}) {
  const context = options.context ?? createTokenContext();
  const source = options.source ?? '<inline>';
  const warnings = [];
  const { declared, referenced } = collectVars(text);
  const names = new Set([...declared, ...referenced]);
  const unknown = [];
  const dynamicNames = [];
  const platformUsed = [];

  for (const name of [...names].sort()) {
    if (name.startsWith(TOKEN_PREFIX)) {
      if (isFrozenToken(name)) continue;
      if (context.platform !== false && isPlatformVar(name)) {
        // 平台变量被 `--dsw-*` 前缀判定？不会 —— 这里只是留出显式分支，保证顺序可读。
        platformUsed.push(name);
        continue;
      }
      if (context.isDynamic(name)) {
        // 已登记的动态名：**lint 阶段不再告警**——"只告警不拒绝"的告警发生在**登记那一刻**
        // （`theme.register` / `theme.overrideTokens`），此后它就是已知名。
        // 否则第三方每渲染一次样式就刷一条同样的告警，等于把告警变成噪音。
        dynamicNames.push(name);
        continue;
      }
      unknown.push(name);
      warnings.push(diagnostic(
        THEME_DIAGNOSTICS.TOKEN_UNKNOWN,
        `${source}：${name} 不在外壳 token 白名单（403 条）里，也不是平台变量（${PLATFORM_NAMESPACES.join(' / ')} 共 ${PLATFORM_VARS.length} 个）`,
        { name, source },
      ));
      continue;
    }
    if (context.platform !== false && isPlatformVar(name)) {
      platformUsed.push(name);
      continue;
    }
    if (isGuifPrivateVar(name)) {
      warnings.push(diagnostic(
        THEME_DIAGNOSTICS.PRIVATE_LEAK,
        `${source}：${name} 是私有变量（--guif-private-*）；公开样式只应引用 --guif-* 与 --dsw-*`,
        { name, source },
      ));
      continue;
    }
    if (!isGuifPublicVar(name)) {
      unknown.push(name);
      warnings.push(diagnostic(
        THEME_DIAGNOSTICS.TOKEN_UNKNOWN,
        `${source}：${name} 既不是 --dsw-*、也不是 --guif-* / --guif-private-*`,
        { name, source },
      ));
    }
  }

  const literals = scanLiteralColors(text);
  for (const hit of literals) {
    warnings.push(diagnostic(
      THEME_DIAGNOSTICS.LITERAL_COLOR,
      `${source}:${hit.line}:${hit.column} 硬编码颜色「${hit.match}」（${hit.label}）—— 组件样式只走 var(--dsw-*) / var(--guif-*)`,
      { ...hit, source },
    ));
  }

  return {
    ok: warnings.length === 0,
    warnings,
    unknown,
    dynamic: dynamicNames,
    literals,
    platformUsed: [...new Set(platformUsed)].sort(),
    stats: { declared: declared.size, referenced: referenced.size, checked: names.size, literals: literals.length },
  };
}

/**
 * 暗色覆盖报告：**是报告不是门禁**（196 覆盖 / 207 继承，`requireAll: false`）。
 * 无论覆盖面多小，本函数都不产生"缺暗色值"类诊断 —— 这是 item 10 的口径。
 */
function darkCoverage(extra) {
  const extraNames = [...(extra ?? [])];
  return {
    policy: DARK_COVERAGE_POLICY,
    covered: FROZEN_DARK_TOKENS.length,
    inherited: FROZEN_TOKENS.length - FROZEN_DARK_TOKENS.length,
    extra: extraNames.length,
    requireAll: DARK_COVERAGE_POLICY.requireAll,
    warnings: [],
  };
}

/** 校验一个变量名（结构性写错 ⇒ 抛 `TypeError`，不发明新错误码）；判据与 tokens.mjs **同一份**。 */
function assertVarName(name, who) {
  if (typeof name !== 'string' || !isValidVarName(name)) {
    throw new TypeError(`${who} 需要形如 --foo-bar 的变量名（收到 ${typeof name} ${String(name)}）`);
  }
  return name;
}

/** 把一个 token 名包成 `var(...)`；名字非法 ⇒ 抛（结构性误用，不用信封）。 */
function tokenRef(name) {
  assertVarName(name, 'tokenRef(name)');
  return `var(${name})`;
}
  return { THEME_DIAGNOSTICS: THEME_DIAGNOSTICS, NAMED_COLOR_PROPS: NAMED_COLOR_PROPS, NAMED_COLORS: NAMED_COLORS, COLOR_RULES: COLOR_RULES, stripComments: stripComments, scanLiteralColors: scanLiteralColors, collectVars: collectVars, createTokenContext: createTokenContext, diagnostic: diagnostic, lintTokenUsage: lintTokenUsage, darkCoverage: darkCoverage, assertVarName: assertVarName, tokenRef: tokenRef };
}());
__esMod["./theme/dark.mjs"] = (function () {
/**
 * dark.mjs —— **暗色判据与监听**（探针 P4 的深色载体结论）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【唯一判据：`body[data-ds-dark-theme]`】—— 三条"不许"都是实测踩出来的
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 探针 P4 实读外壳产物：`ThemePresenter.apply` 按 `active.colorScheme` 往 `document.body` 写
 * `data-ds-dark-theme` 属性，其源码注释原文是 **「never the id — system is resolved upstream」**。
 * 于是：
 *  ① **不认 theme id**：主题 id 是 `light` / `dark` / `system` 之类，但 `system` 的真值只有外壳知道，
 *     插件按 id 判会在 `system` 上判错；`apply` 已经把 system 解析掉了，属性才是解析后的**结果**；
 *  ② **不认 `prefers-color-scheme`**：它只表示"系统偏好"，而用户可以在 UI 里覆盖成与系统相反的方案；
 *     用它判色会与外壳自身渲染的明暗相反（这也是官方注释那句 "resolved upstream" 的反面）；
 *  ③ **不认 `documentElement` 上的颜色**：`ThemePresenter` 只写 `body` 的属性
 *     （`documentElement.style.colorScheme` 是另一件事，boot 脚本会写，但它不承载"当前是否暗色"）。
 * 插件树激活前，宿主半区的 boot 脚本也会写同一语义的属性 —— 所以「属性存在」在两段时间线上都成立。
 *
 * 判据是**属性有无**，不是属性值（`data-ds-dark-theme=""` 也算暗色）——`hasAttribute` 而非 `getAttribute`。
 *
 * 本文件不碰全局：所有 DOM 都从参数进来（缺省才回落到 `globalThis.document`），
 * 因此 L0/L3 层可以用假 document 单测（模块体不得读全局）。
 */

/** 暗色载体属性（外壳 `ThemePresenter.apply` 写的那个）。 */
const DARK_ATTRIBUTE = 'data-ds-dark-theme';
/** 唯一合法的暗色选择器（CSS 侧只允许写它）。 */
const DARK_SELECTOR = `body[${DARK_ATTRIBUTE}]`;
/** 取值：**没有**该属性（不是"另一个属性"）。 */
const LIGHT_SCHEME = 'light';
/** 暗色。 */
const DARK_SCHEME = 'dark';

/**
 * 取当前 document：支持三种形态 —— `{ document }` 选项袋、直接传一个 document、什么都不传（回落全局）。
 * ⚠ 本文件**不列**"禁止的判据字符串"（如系统偏好查询/主题 id）—— 那会把禁词写进产品源码，
 * 而源码扫描恰恰要拦住它们。禁词表在测试侧。
 */
function resolveDocument(options) {
  if (options === null || options === undefined) return typeof document === 'undefined' ? undefined : document;
  if (typeof options !== 'object') return undefined;
  if ('document' in options) return options.document;
  if ('body' in options) return options;
  return undefined;
}

/**
 * 当前配色方案。**只认 `body` 上的属性**。
 * 读不到 body（树还没挂载 / 没有 DOM）⇒ 返回 `light`：保守选择，
 * 与外壳 boot 前的默认一致（`ThemePresenter` 在写入暗色属性前，页面就是亮色）。
 * @param {{document?:object|null}|object|null} [options] 选项袋，或直接传一个 document 对象
 * @returns {'light'|'dark'}
 */
function currentScheme(options) {
  const doc = resolveDocument(options);
  if (doc === undefined || doc === null) return LIGHT_SCHEME;
  const body = doc.body;
  if (body === undefined || body === null) return LIGHT_SCHEME;
  if (typeof body.hasAttribute !== 'function') return LIGHT_SCHEME;
  return body.hasAttribute(DARK_ATTRIBUTE) ? DARK_SCHEME : LIGHT_SCHEME;
}

/** 现在是不是暗色（`currentScheme(...) === 'dark'`）。 */
function isDark(options) {
  return currentScheme(options) === DARK_SCHEME;
}

/**
 * 监听方案变化（**只观察 body 的属性**，不问系统偏好）。
 * 副作用经 `ctx.effect(...)` 挂到调用方 fiber 上：卸载 ⇒ observer 断开、监听器摘除。
 *
 * @param {object} ctx Cordis ctx（必须有 `effect`）
 * @param {(scheme:'light'|'dark', previous:'light'|'dark') => void} listener 仅在**变化**时调用
 * @param {{document?:object, MutationObserverImpl?:Function, target?:object}} [options]
 * @returns {() => void} 幂等 disposer
 */
function watchScheme(ctx, listener, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('watchScheme(ctx, listener) 需要在 Cordis ctx 上调用（清理要挂到调用方 fiber）');
  }
  if (typeof listener !== 'function') throw new TypeError('watchScheme(ctx, listener) 的 listener 必须是函数');
  const doc = resolveDocument(options);
  const Observer = options.MutationObserverImpl ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver);
  const target = options.target ?? (doc === undefined || doc === null ? undefined : doc.body);
  if (target === undefined || target === null || typeof Observer !== 'function') {
    // 没 DOM / 没 observer ⇒ 静默不激活（依赖缺失不报错、不影响页面）。
    return () => {};
  }
  let last = currentScheme({ document: doc });
  return ctx.effect(() => {
    const observer = new Observer(() => {
      const next = currentScheme({ document: doc });
      if (next === last) return;
      const previous = last;
      last = next;
      listener(next, previous);
    });
    observer.observe(target, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
    return () => {
      if (typeof observer.disconnect === 'function') observer.disconnect();
    };
  }, 'gui-frame: theme dark watch');
}

/** 一次性的读取 + 监听组合（组件作者最常用的形状）。 */
function schemeSnapshot(options) {
  const scheme = currentScheme(options);
  return { scheme, isDark: scheme === DARK_SCHEME, attribute: DARK_ATTRIBUTE, selector: DARK_SELECTOR };
}
  return { DARK_ATTRIBUTE: DARK_ATTRIBUTE, DARK_SELECTOR: DARK_SELECTOR, LIGHT_SCHEME: LIGHT_SCHEME, DARK_SCHEME: DARK_SCHEME, currentScheme: currentScheme, isDark: isDark, watchScheme: watchScheme, schemeSnapshot: schemeSnapshot };
}());
__esMod["./theme/styles.mjs"] = (function () {
  var { lintTokenUsage, createTokenContext } = __esMod["./theme/lint.mjs"];
  var { DARK_SELECTOR } = __esMod["./theme/dark.mjs"];
/**
 * styles.mjs —— **组件自带 token**：样式只走 `var(--dsw-*)` 与 `var(--guif-*)`（能力④）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【两层变量：公开 `--guif-*` / 私有 `--guif-private-*`】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  - **公开族 `--guif-*`**：GUIFrame 对外的样式契约（组件作者写样式只引用它，或直接引用 `--dsw-*`）。
 *    它们**不是新颜色**，而是外壳 token 的**语义别名**（见 `SCOPE_VAR_MAP`）——
 *    换主题时跟着外壳走，插件永远不写死颜色。
 *  - **私有族 `--guif-private-*`**：实现态（作用域 id、层级号、拖拽偏移、尺寸…）。
 *    私有变量**不得**被公开样式引用；lint 见到就告警（`GUIF-W-THEME-PRIVATE-LEAK`）。
 *    规则很简单：**公开面只暴露 `--guif-*`，实现的都加 `private-`**。
 *
 * 「不写颜色就不会错」：本文件的 `defineStyleSheet` 只做**拼装 + 校验**，
 * 检测到硬编码颜色就产诊断（`GUIF-W-THEME-LITERAL-COLOR`），**不抛**（告警式）。
 * 本包自己源码里的硬编码颜色由 `npm run check:tokens` **硬拦**。
 *
 * 本文件不碰全局：`document` 从参数进来；`installStyleSheet` 缺 DOM 时静默不激活。
 */




/** 注入的样式标签（真机断言用它找自己的样式）。 */
const GUIF_STYLE_TAG = 'style';
/** 样式标签上的归属属性（值恒为 `gui-frame`）。 */
const GUIF_STYLE_ATTRIBUTE = 'data-guif-theme';

/**
 * **公开变量 → 外壳 token** 的语义别名表（组件样式只认左边）。
 * 右边的每个 token 都在白名单里 —— 换名字会被 `check:tokens` 的硬门禁当场抓住
 * （这就是"自带 token"不靠自觉的原因）。
 */
const SCOPE_VAR_MAP = Object.freeze({
  '--guif-bg': 'var(--dsw-alias-bg-layer-1)',
  '--guif-bg-raised': 'var(--dsw-alias-bg-layer-2)',
  '--guif-bg-hover': 'var(--dsw-alias-interactive-bg-hover)',
  '--guif-border': 'var(--dsw-alias-border-l1)',
  '--guif-border-strong': 'var(--dsw-alias-border-l2)',
  '--guif-text': 'var(--dsw-alias-label-primary)',
  '--guif-text-dim': 'var(--dsw-alias-label-secondary)',
  '--guif-text-caption': 'var(--dsw-alias-label-caption)',
  '--guif-accent': 'var(--dsw-alias-brand-primary)',
  '--guif-danger': 'var(--dsw-alias-state-error-primary)',
  '--guif-success': 'var(--dsw-alias-state-success-primary)',
  '--guif-warn': 'var(--dsw-alias-state-warn-primary)',
});

/** 公开族变量名（排序）。 */
const GUIF_PUBLIC_VARS = Object.freeze(Object.keys(SCOPE_VAR_MAP).sort());

/** 私有族变量名（实现态；公开样式**不得**引用）。 */
const GUIF_PRIVATE_VARS = Object.freeze([
  '--guif-private-drag-x',
  '--guif-private-drag-y',
  '--guif-private-height',
  '--guif-private-scope',
  '--guif-private-width',
  '--guif-private-z',
]);

/** 作用域 class（组件根节点用；样式表里唯一的公开钩子）。 */
const SCOPE_CLASS = 'guif-theme-scope';

/** `var(--dsw-x)` 引用所用 token 名（供断言与 lint）。 */
function tokensUsedByScopeMap() {
  const used = new Set();
  for (const value of Object.values(SCOPE_VAR_MAP)) {
    for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) used.add(match[1]);
  }
  return [...used].sort();
}

/**
 * 把一张声明表渲染成 CSS 声明串（值原样输出；只做**形态**检查，不做颜色拦截 —— 拦截在 lint 里）。
 * @param {Record<string,string|number>} declarations 声明名 → 值
 * @param {{requireVar?:boolean}} [options] `requireVar:true` 时声明名必须是自定义属性（`--x`），
 *   用于"作用域变量块"那一处（普通 CSS 属性如 `color` 不是自定义属性，不该被这条规则挡）
 * @returns {string}
 */
function renderDeclarations(declarations, options = {}) {
  const requireVar = options.requireVar === true;
  const rows = [];
  for (const [name, value] of Object.entries(declarations ?? {})) {
    if (typeof name !== 'string' || !/^(--)?[a-z][a-z0-9-]*$/.test(name)) {
      throw new TypeError(`CSS 声明名形态非法：${String(name)}（只允许小写字母/数字/连字符，自定义属性以 -- 开头）`);
    }
    if (requireVar && !name.startsWith('--')) {
      throw new TypeError(`这里要的是自定义属性（-- 开头），收到 ${name}`);
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`声明 ${name} 的值必须是字符串或数字（收到 ${typeof value}）`);
    }
    rows.push(`${name}: ${String(value)}`);
  }
  return rows.join('; ');
}

/**
 * 拼一张样式表。
 * @param {{scope?:string, vars?:Record<string,string>, rules?:Array<{selector:string, decls:Record<string,string>}>}} spec
 * @param {{source?:string, context?:object}} [options]
 * @returns {{css:string, warnings:Array<object>, ok:boolean}}
 */
function defineStyleSheet(spec, options = {}) {
  if (spec === null || typeof spec !== 'object') throw new TypeError('defineStyleSheet(spec) 的 spec 必须是对象');
  const scope = typeof spec.scope === 'string' && spec.scope !== '' ? spec.scope : `.${SCOPE_CLASS}`;
  const blocks = [];
  if (spec.vars !== undefined && spec.vars !== null) blocks.push(`${scope} { ${renderDeclarations(spec.vars, { requireVar: true })} }`);
  for (const rule of spec.rules ?? []) {
    if (rule === null || typeof rule !== 'object' || typeof rule.selector !== 'string') {
      throw new TypeError('defineStyleSheet 的每条 rule 需要 { selector, decls }');
    }
    blocks.push(`${rule.selector} { ${renderDeclarations(rule.decls)} }`);
  }
  const css = `${blocks.join('\n')}\n`;
  const report = lintTokenUsage(css, { context: options.context ?? createTokenContext(), source: options.source ?? 'defineStyleSheet' });
  return { css, warnings: report.warnings, ok: report.ok };
}

/**
 * 组件基础样式（**只引用变量**；组件直接用，不需要再写颜色）。
 * 暗色段用唯一合法选择器 `body[data-ds-dark-theme] ...`（见 dark.mjs 的三条"不许"）：
 * 这里刻意**只覆盖需要差异化的少数几处**，其余继承亮色值 —— 对应 196/207 的现实。
 */
function baseStyleSheet() {
  const base = 'display: block; background: var(--guif-bg); color: var(--guif-text); border: 1px solid var(--guif-border);';
  return [
    `.${SCOPE_CLASS} { ${base} }`,
    `${DARK_SELECTOR} .${SCOPE_CLASS} { border-color: var(--guif-border-strong); }`,
    '.guif-empty { color: var(--guif-text-dim); }',
    '.guif-error { color: var(--guif-danger); }',
    '',
  ].join('\n');
}

/** 一份基础样式表的 lint 报告（本包自证：0 命中）。 */
function lintBaseStyleSheet() {
  return lintTokenUsage(baseStyleSheet(), { context: createTokenContext(), source: 'baseStyleSheet' });
}

/**
 * 注入一张样式表（`<style data-guif-theme="gui-frame">`）。
 * 副作用经 `ctx.effect` 挂在调用方 fiber 上：卸载 ⇒ 标签移除。
 * 没有 DOM ⇒ 静默返回空 disposer（依赖缺失不激活、不报错）。
 * @param {object} ctx
 * @param {{css:string, document?:object, id?:string}} options
 * @returns {() => void}
 */
function installStyleSheet(ctx, options = {}) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.effect !== 'function') {
    throw new TypeError('installStyleSheet(ctx, options) 需要在 Cordis ctx 上调用（清理要挂到调用方 fiber）');
  }
  const css = typeof options.css === 'string' ? options.css : '';
  const doc = 'document' in options ? options.document : (typeof document === 'undefined' ? undefined : document);
  if (doc === undefined || doc === null || typeof doc.createElement !== 'function') return () => {};
  const id = typeof options.id === 'string' ? options.id : 'gui-frame';
  return ctx.effect(() => {
    const element = doc.createElement(GUIF_STYLE_TAG);
    element.setAttribute(GUIF_STYLE_ATTRIBUTE, id);
    element.textContent = css;
    const parent = doc.head ?? doc.body ?? null;
    if (parent === null || typeof parent.appendChild !== 'function') return undefined;
    parent.appendChild(element);
    return () => {
      if (typeof element.remove === 'function') element.remove();
      else if (typeof parent.removeChild === 'function') parent.removeChild(element);
    };
  }, `gui-frame: theme style sheet ${id}`);
}

/**
 * 本文件只做「拼装 + 自检」，不重复判定私有/公开族：族判定与诊断码都在 `lint.mjs`（单一真源），
 * 组件作者写样式时调 `defineStyleSheet` / `lintTokenUsage` 即可拿到 `GUIF-W-THEME-PRIVATE-LEAK` 等告警。
 */
  return { GUIF_STYLE_TAG: GUIF_STYLE_TAG, GUIF_STYLE_ATTRIBUTE: GUIF_STYLE_ATTRIBUTE, SCOPE_VAR_MAP: SCOPE_VAR_MAP, GUIF_PUBLIC_VARS: GUIF_PUBLIC_VARS, GUIF_PRIVATE_VARS: GUIF_PRIVATE_VARS, SCOPE_CLASS: SCOPE_CLASS, tokensUsedByScopeMap: tokensUsedByScopeMap, renderDeclarations: renderDeclarations, defineStyleSheet: defineStyleSheet, baseStyleSheet: baseStyleSheet, lintBaseStyleSheet: lintBaseStyleSheet, installStyleSheet: installStyleSheet };
}());
__esMod["./theme/element.mjs"] = (function () {
  var { SCOPE_CLASS, SCOPE_VAR_MAP } = __esMod["./theme/styles.mjs"];
  var { DARK_ATTRIBUTE } = __esMod["./theme/dark.mjs"];
/**
 * element.mjs —— **自带 token 的作用域组件**（组件**没有 JSX**，只认 `env.seeds.react.createElement`）。
 *
 * 为什么要有它：自研打包器（scripts/build-client.mjs）**只重写 import/export，不做 JSX/TS 变换**，
 * 所以客户端组件一律 `env.seeds.react.createElement(...)`（README 硬约束）。
 * 写 JSX 的失败形态是构建期的「产物语法错」，报错不会明说是 JSX —— 这里给组件作者一个
 * **可复制的正确样例**，并让"组件自带 token"落到结构上：作用域根节点一次性把 `--guif-*`
 * 映射到外壳 token（`SCOPE_VAR_MAP`），子组件样式就只剩 `var(--guif-*)` 可写。
 *
 * 本文件不碰全局：`react` 由 `env.seeds` 传入（种子没有第二条路）；缺 react ⇒ 构造时抛 `TypeError`。
 */




/** 作用域根节点上的归属属性（真机断言用）。 */
const THEME_SCOPE_ATTRIBUTE = 'data-guif-theme';
/** 缺省作用域名。 */
const DEFAULT_SCOPE_NAME = 'gui-frame';

/**
 * 造一个**作用域组件**：`createThemeScope(env)` ⇒ `(props) => element`。
 * props：`{ scope?, className?, style?, id?, children }` —— 只有这四个（多一个都会泄漏内部实现）。
 * 组件渲染出的根节点带 `class="guif-theme-scope …"`、`data-guif-theme="<scope>"`
 * 与 `style` 里的 `--guif-*` 变量（内联变量优先级最高，正是"作用域"该有的语义）。
 *
 * @param {{seeds?:{react?:object}}} env 装配环境（`install(ctx, env)` 的 env）
 * @returns {(props:object) => object} React 元素（由调用方放进自己的树里）
 */
function createThemeScope(env) {
  const react = env === null || env === undefined ? undefined : env.seeds?.react;
  if (react === null || react === undefined || typeof react.createElement !== 'function') {
    throw new TypeError('createThemeScope(env) 需要 env.seeds.react.createElement（打包器不做 JSX 变换，种子没有第二条路）');
  }
  /** 作用域根：只做三件事 —— 类名、归属属性、把公开变量绑到外壳 token。 */
  function GuifThemeScope(props) {
    const given = props === null || props === undefined ? {} : props;
    const className = given.className === undefined || given.className === null || given.className === ''
      ? SCOPE_CLASS
      : `${SCOPE_CLASS} ${given.className}`;
    const scope = typeof given.scope === 'string' && given.scope !== '' ? given.scope : DEFAULT_SCOPE_NAME;
    const attributes = {
      className,
      [THEME_SCOPE_ATTRIBUTE]: scope,
      style: { ...SCOPE_VAR_MAP, ...(given.style ?? {}) },
    };
    if (typeof given.id === 'string' && given.id !== '') attributes.id = given.id;
    return react.createElement('div', attributes, given.children);
  }
  /** 便于测试与真机断言：组件名与它依赖的载体属性。 */
  GuifThemeScope.displayName = 'GuifThemeScope';
  return GuifThemeScope;
}

/** 组件侧"暗色怎么读"的统一入口（只认 body 的属性，见 dark.mjs）；这里只导出属性名，避免二次实现。 */
const SCOPE_DARK_ATTRIBUTE = DARK_ATTRIBUTE;
  return { THEME_SCOPE_ATTRIBUTE: THEME_SCOPE_ATTRIBUTE, DEFAULT_SCOPE_NAME: DEFAULT_SCOPE_NAME, createThemeScope: createThemeScope, SCOPE_DARK_ATTRIBUTE: SCOPE_DARK_ATTRIBUTE };
}());
__esMod["./theme/index.mjs"] = (function () {
  var { THEME_DIAGNOSTICS, diagnostic, createTokenContext, darkCoverage, lintTokenUsage } = __esMod["./theme/lint.mjs"];
  var { DARK_ATTRIBUTE, DARK_SELECTOR, currentScheme, watchScheme } = __esMod["./theme/dark.mjs"];
  var { createThemeScope } = __esMod["./theme/element.mjs"];
  var { SCOPE_VAR_MAP, baseStyleSheet, defineStyleSheet, installStyleSheet } = __esMod["./theme/styles.mjs"];
  var { FROZEN_DARK_TOKENS, FROZEN_TOKENS, PLATFORM_VARS, isFrozenToken, isPlatformVar } = __esMod["./theme/tokens.mjs"];
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







/** 切片名（白名单成员）。 */
const SLICE_NAME = 'theme';
/** 一次 lint 调用最多往诊断环里写几条（防止把环灌满）。 */
const DIAGNOSTIC_BUDGET = 8;

/**
 * 装配主题守门。
 * @param {object} ctx 提供者 ctx
 * @param {{service:object, seeds?:object, theme?:object}} env
 * @returns {{slice:string, api:object, dispose:() => void, reused:boolean}}
 */
function install(ctx, env) {
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
  return { SLICE_NAME: SLICE_NAME, DIAGNOSTIC_BUDGET: DIAGNOSTIC_BUDGET, install: install };
}());
__esMod["./entry/after-services-v1.mjs"] = (function () {
/**
 * after-services-v1.mjs —— **平台服务补装 + 收尾**段。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么需要这一段】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 坞（能力①）依赖平台服务 `slots`，而兄弟插件提供它的时机**晚于**本插件 `apply`（真机实测
 * ~3s 内到齐）。没有这段补装窗口，坞在第一遍装配时只会拿到「slots 缺席 ⇒ 不激活」，之后再无机会
 * —— 页面正常但坞永不出现（静默零注册）。
 *
 * 【补装窗口就是本段的全部内容】
 *   - 它只在窗口内有界轮询「依赖的平台服务到齐了没有」，到点即停、不再重试；
 *   - `restore` 交回的仍是**同一个 promise**（`retryDone`）：「补装完成」就是收尾完成，
 *     汇合点与测试照旧 `await restore` 即可，不需要为一件事造两个名字。
 *
 * 本文件**不改 `env`**：追加键只允许出现在调用点。
 */

/**
 * 造「补装 + 收尾」段。
 *
 * @param {{ctx:object, env:object, handles:Map, runStep:Function, probeService:Function,
 *          report:Function, degradeEvent:Function, reporter:object,
 *          CAPABILITY_ORDER:Array, CAPABILITY_SERVICE_DEPENDENCY:object,
 *          SERVICES_READY_TIMEOUT_MS:number, SERVICES_READY_INTERVAL_MS:number}} deps
 * @returns {{retryDone:Promise<unknown>, restore:Promise<unknown>}}
 */
function createAfterServices(deps) {
  const {
    ctx, env, handles, runStep, probeService, report, degradeEvent, reporter,
    CAPABILITY_ORDER, CAPABILITY_SERVICE_DEPENDENCY, SERVICES_READY_TIMEOUT_MS, SERVICES_READY_INTERVAL_MS,
  } = deps;

  // ⑤b **平台服务补装**：某能力因缺平台服务未激活 ⇒ 在窗口内等服务到齐后**补装一次**（超时即放弃）
  const retryDone = new Promise((resolve) => {
    const startedAt = Date.now();
    const pendingService = () => CAPABILITY_ORDER.filter((step) => {
      const serviceName = CAPABILITY_SERVICE_DEPENDENCY[step.capability];
      if (serviceName === undefined || serviceName === null) return false;
      const row = handles.get(step.capability);
      if (row === undefined || row === null || row.installed !== false) return false;
      const probe = probeService(ctx, serviceName);
      return probe === null || probe === undefined;
    });
    const tick = () => {
      const pending = pendingService();
      if (pending.length > 0) {
        for (const step of pending) {
          try {
            runStep(step);
            report(degradeEvent(step.capability, `平台服务 ${CAPABILITY_SERVICE_DEPENDENCY[step.capability]} 到齐 ⇒ 补装一次`, env.diagnostics));
          } catch (error) {
            report({ phase: 'install', message: `补装「${step.capability}」抛错：${error?.message ?? error}`, error, details: { capability: step.capability } });
          }
        }
      }
      if (pendingService().length === 0 || Date.now() - startedAt >= SERVICES_READY_TIMEOUT_MS) { resolve(); return; }
      env.schedule(tick, SERVICES_READY_INTERVAL_MS);
    };
    env.schedule(tick, SERVICES_READY_INTERVAL_MS);
  });

  return { retryDone, restore: retryDone };
}
  return { createAfterServices: createAfterServices };
}());
__esMod["./entry.mjs"] = (function () {
  var { SERVICE_NAME } = __esMod["./contracts/service-face.mjs"];
  var { createDiagnosticsReporter, degradeEvent, installDiagnosticsHooks } = __esMod["./diagnostics.mjs"];
  var { install: installDock } = __esMod["./dock.mjs"];
  var { install: installPanel } = __esMod["./panel/index.mjs"];
  var { install: installOverlay } = __esMod["./overlay/index.mjs"];
  var { provideService } = __esMod["./service.mjs"];
  var { probeService } = __esMod["./kit/probe.mjs"];
  var { install: installTheme } = __esMod["./theme/index.mjs"];
  var { createAfterServices } = __esMod["./entry/after-services-v1.mjs"];
/**
 * entry.mjs —— 客户端半区**汇合点**：把四项能力的 `install(ctx, env)` 按固定顺序装起来
 * （交付面＝坞 + 主题 + 面板 + 浮层：按钮面板本身走托管浮层 `family:'panel'`，故浮层属于面板族）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【装配契约 v1】—— 各能力模块只导出装配函数，**本文件是唯一的调用者**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 1. **签名统一为 `install(ctx, env)`**（单一 options bag，日后加面不改签名）；
 *    `env` 的键集（**只增不改不删**，由本文件组装）：
 *      - `service`     = `ctx.gui-frame` 服务面实例（`provideService(ctx)` 的产物）；
 *      - `seeds`       = 种子实例表（`createClientModule(seeds)` 收到的**原样**转交；模块不能 import 裸包名）；
 *      - `schedule` / `cancel` = 定时器端口（平台服务晚到时的补装轮询用；真机是全局 `setTimeout`，测试可注入假时钟）；
 *      - `diagnostics` = 诊断上报器（**全流程唯一实例**：各能力报同一条通道，避免每条通道各限各的频）。
 * 2. **固定装配顺序**（顺序即契约，测试逐项比对 `CAPABILITY_ORDER`）：
 *    `provideService → dock → theme → panel → overlay → 驱动恢复屏障`。
 *    依赖链见 `CAPABILITY_ORDER` 上方注释；**恢复屏障在所有 install 之后驱动，不得跳过**。
 *    宿主半区同理：`src/host/index.mjs` 只调用 `routes.mjs` 的 `registerRoutes(ctx)`（含它的
 *    `extraRoutes` 扩展点去挂诊断收端），**不自行实现路由**。
 * 3. **副作用一律经 `ctx.effect`**（各模块内部纪律；本文件只负责按序调用与兜错）。
 * 4. **包在这里的三条硬纪律**（都有实测出处，不是风格偏好）：
 *    - `apply` **整体 try/catch 且绝不 rethrow**：探针实测「客户端 apply 抛错 ⇒ `loader.create` 拒绝
 *      冒泡 ⇒ 就绪回调永不执行 ⇒ 整页停在失败卡片」；
 *    - **每个 install 单独 try/catch**：单个能力失败不牵连其余能力，也不牵连整页；
 *    - **装配前先探测** `ctx.get('gui-frame')`：已存在就记诊断并**让位**（同 scope 重名 `provide` 会 throw）。
 * 5. **重挂载幂等**（实测：服务方卸载后回归会触发依赖方自动重新 `apply`）：同一 ctx 二次装配直接
 *    跳过（`ASSEMBLED`），各能力自身的 `install` 也都是幂等的（第二层保险）。
 *
 * 本文件**不内联任何能力实现、不注册任何座位**：座位一律由坞成对注册。
 * 打包器约定（scripts/build-client.mjs）：必须导出 `createClientModule(__seeds)` → `{ apply, inject, __internals }`。
 */









// 平台服务晚到 ⇒ 在窗口内补装一次（实现见 `entry/after-services-v1.mjs`）。


/**
 * **固定装配顺序**（顺序本身就是契约，测试会逐项比对）。
 * 依赖链（为什么是这个序）：
 *   `dock` 最早 —— 它注册坞自己的入口与两个座位，并给出 dock 切片；
 *   `theme` 紧随 —— 面板族的样式与公开变量都由它提供；
 *   `panel` 在 `overlay` 前 —— 面板把复合组件登记进服务面组件表，坞与浮层在**渲染期**取用；
 *   `overlay` 最后 —— 按钮面板本身走它的托管浮层（`family:'panel'`）。
 */
const CAPABILITY_ORDER = Object.freeze([
  { capability: 'dock', install: installDock },
  { capability: 'theme', install: installTheme },
  { capability: 'panel', install: installPanel },
  { capability: 'overlay', install: installOverlay },
]);

/** 同一 ctx 只装配一次（重挂载幂等的第一层；各能力自身的幂等是第二层）。 */
const ASSEMBLED = new WeakSet();

/**
 * **平台服务晚到的补装窗口**（真机实测：兄弟插件提供的 `slots` / `settingsScope` 晚于本插件 `apply`
 * 就绪，实测 ~3s 内到齐）。第一遍照常装（缺服务 ⇒ 降级/不激活），窗口内服务出现则**补装一次**；
 * 超时后不再重试，保持第一遍的降级结论。
 */
const SERVICES_READY_TIMEOUT_MS = 4000;
const SERVICES_READY_INTERVAL_MS = 250;

/** 哪些能力依赖哪个平台服务（用于补装判定；不需要平台服务的能力不进这张表）。 */
const CAPABILITY_SERVICE_DEPENDENCY = Object.freeze({
  dock: 'slots',
  overlay: 'slots',
});

/** 缺省定时器端口（平台服务晚到时的补装轮询用；可注入假时钟）。 */
function defaultSchedule(fn, delay) {
  return setTimeout(fn, delay);
}

function defaultCancel(handle) {
  clearTimeout(handle);
}

/**
 * 组装入口模块。
 * @param {object} seeds 种子实例表（8 个全名 require 进来的实例；**原样**转交各能力）
 */
function createClientModule(seeds) {
  const name = 'gui-frame';
  const reporter = createDiagnosticsReporter({});
  let lastAssembly = null;

  /** 记一条到 console（**吞掉一切**：诊断自己不许把装配搞崩）。 */
  function consoleError(line) {
    try {
      if (typeof console !== 'undefined' && console !== null && typeof console.error === 'function') console.error(line);
    } catch {
      // 没有 console 就算了 —— 这条不是能力的一部分
    }
  }

  /** 上报（同步、绝不抛）。 */
  function report(entry) {
    try {
      reporter.report(entry);
    } catch {
      // 诊断失败不影响装配
    }
  }

  /**
   * 真正的装配（同步返回装配记录；`apply` 是它「绝不抛」的外壳）。
   * @param {object} ctx 调用方 ctx
   * @param {{schedule?:Function, cancel?:Function, diagnostics?:object}} [options]
   */
  function assemble(ctx, options = {}) {
    if (ctx === null || typeof ctx !== 'object') return { owned: false, reason: 'no-ctx', capabilities: [] };
    if (ASSEMBLED.has(ctx)) return { owned: false, reason: 'already-assembled', capabilities: [] };

    // ① 探测：已存在 ⇒ 记诊断并让位（**不重复 provide**：同 scope 重名会 throw ⇒ 整页死）
    const existing = typeof ctx.get === 'function' ? ctx.get(SERVICE_NAME) : undefined;
    if (existing !== undefined) {
      const entry = degradeEvent('service', `服务 ${SERVICE_NAME} 已在场 ⇒ 本插件让位（不重复 provide）`, reporter);
      consoleError(`[gui-frame] ${entry.message}`);
      return { owned: false, reason: 'conflict', service: existing, capabilities: [] };
    }

    // ② 提供：形态用官方最简写法（`ctx.effect(() => ctx.provide(...))`，见 service.mjs）
    const provided = provideService(ctx);
    if (provided.owned !== true || provided.service === null) {
      const entry = degradeEvent('service', `提供 ${SERVICE_NAME} 失败或让位：${provided.reason ?? 'unknown'}`, reporter);
      consoleError(`[gui-frame] ${entry.message}`);
      return { owned: false, reason: provided.reason ?? 'provide-failed', capabilities: [] };
    }
    const service = provided.service;

    // ③ env：**只增不改不删**（本文件是唯一组装点）
    const env = {
      service,
      seeds,
      schedule: typeof options.schedule === 'function' ? options.schedule : defaultSchedule,
      cancel: typeof options.cancel === 'function' ? options.cancel : defaultCancel,
      diagnostics: options.diagnostics ?? reporter,
    };

    // ④ 诊断钩子（座位注册失败 / 渲染崩溃 / 未处理拒绝）—— **早于各 install**，才能看见它们的失败
    try {
      installDiagnosticsHooks(ctx, env.diagnostics);
    } catch (error) {
      report(degradeEvent('diagnostics', `诊断钩子装配失败：${error?.message ?? error}`, env.diagnostics));
    }

    // ⑤ 按固定顺序装配：**每个 install 单独 try/catch**
    const capabilities = [];
    const handles = new Map();
    const rowOf = (capability) => capabilities.find((item) => item.capability === capability);
    const runStep = (step) => {
      try {
        // **追加键只允许出现在调用点**（`{...env, layoutHandle}`），`env` 本体一字不改。
        // demo 是消费者：布局句柄是装配点交给它的端口，不是它自己装出来的能力。
        const outcome = step.install(ctx, env);
        handles.set(step.capability, outcome);
        const installed = outcome === null || outcome === undefined ? null : outcome.installed !== false;
        const row = rowOf(step.capability);
        if (row === undefined) capabilities.push({ capability: step.capability, installed, reason: outcome?.reason ?? null });
        else {
          row.installed = installed;
          row.reason = outcome?.reason ?? null;
        }
        if (installed === false) {
          const entry = degradeEvent(step.capability, outcome?.reason ?? 'unknown', env.diagnostics);
          consoleError(`[gui-frame] ${entry.message}`);
        }
        return outcome;
      } catch (error) {
        const row = rowOf(step.capability);
        if (row === undefined) capabilities.push({ capability: step.capability, installed: false, reason: 'install-threw' });
        else {
          row.installed = false;
          row.reason = 'install-threw';
        }
        report({ phase: 'install', message: `能力「${step.capability}」装配抛错：${error?.message ?? error}`, error, details: { capability: step.capability } });
        consoleError(`[gui-frame] 能力「${step.capability}」装配抛错（已隔离，继续装其余能力）：${error?.message ?? error}`);
        return null;
      }
    };
    for (const step of CAPABILITY_ORDER) runStep(step);

    // ⑤b **平台服务补装**（只此一件事：坞等 `slots` 到齐再补装一次，
    //    实现见 `./entry/after-services-v1.mjs`）
    const { retryDone, restore } = createAfterServices({
      ctx, env, handles, runStep, probeService, report, degradeEvent, reporter,
      CAPABILITY_ORDER, CAPABILITY_SERVICE_DEPENDENCY, SERVICES_READY_TIMEOUT_MS, SERVICES_READY_INTERVAL_MS,
    });

    ASSEMBLED.add(ctx);
    lastAssembly = { ctx, service, env, capabilities, restore, release: provided.dispose };
    return { owned: true, reason: null, service, env, capabilities, restore, dispose: provided.dispose };
  }

  /** 平台入口：**同步、绝不抛**（抛出去会让平台就绪回调永不执行）。 */
  function apply(ctx) {
    try {
      assemble(ctx);
    } catch (error) {
      report({ phase: 'apply', message: `apply 抛错（已吞，页面照常）：${error?.message ?? error}`, error });
      consoleError(`[gui-frame] 客户端 apply 失败（已吞，页面照常）：${error?.message ?? error}`);
    }
    return undefined;
  }

  return {
    apply,
    inject: [],
    __internals: {
      name,
      stage: 'stage1',
      seeds: Object.keys(Object(seeds)).sort(),
      capabilityOrder: CAPABILITY_ORDER.map((step) => step.capability),
      diagnostics: reporter,
      /** 最近一次装配记录（诊断与测试的观察口；不参与平台协议）。 */
      lastAssembly: () => lastAssembly,
      /** 供测试直接驱动装配（能拿到 `restore` promise 以便 `await`）。 */
      assemble,
    },
  };
}
  return { CAPABILITY_ORDER: CAPABILITY_ORDER, SERVICES_READY_TIMEOUT_MS: SERVICES_READY_TIMEOUT_MS, SERVICES_READY_INTERVAL_MS: SERVICES_READY_INTERVAL_MS, CAPABILITY_SERVICE_DEPENDENCY: CAPABILITY_SERVICE_DEPENDENCY, createClientModule: createClientModule };
}());

    var __client = __esMod["./entry.mjs"].createClientModule(__seeds);
    exports.apply = __client.apply;
    exports.inject = __client.inject;
    exports.__internals = __client.__internals;
    return exports;
  },
});
