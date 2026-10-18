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
import { createError } from './errors.mjs';

/** 实际层号暴露给真机断言的属性名（浮层宿主必须把它挂在窗口根节点上）。 */
export const DATA_GUIF_Z = 'data-guif-z';

/** 官方内容层基线：`.overlayLayer { z-index: 20 }`（实测 CSS）——本表的一切相对关系以它为参照。 */
export const CONTENT_LAYER_Z = 20;

/** 托管号段的族名（顺序即优先级顺序，仅用于文档与校验；分配时不依赖顺序）。 */
export const LAYER_FAMILIES = Object.freeze(['floating', 'panel', 'dialog', 'popover', 'toast']);

/** 托管号段表（闭区间）。 */
export const LAYER_SEGMENTS = Object.freeze([
  Object.freeze({ family: 'floating', min: 50, max: 199 }),
  Object.freeze({ family: 'panel', min: 200, max: 299 }),
  Object.freeze({ family: 'dialog', min: 300, max: 499 }),
  Object.freeze({ family: 'popover', min: 500, max: 699 }),
  Object.freeze({ family: 'toast', min: 700, max: 999 }),
]);

/** 非托管「在下」带上界（≤ 40 落在托管浮层之下）。 */
export const UNMANAGED_BELOW_MAX = 40;
/** 非托管「盖住」带下界（≥ 1000 盖住托管浮层）。 */
export const UNMANAGED_ABOVE_MIN = 1000;
/** 不传 `z` 时的起始分配值（单调自增）。 */
export const DEFAULT_Z_START = 100;
/** 可表示范围＝CSS `z-index` 的 32 位有符号整数域。 */
export const Z_MIN = -2147483648;
export const Z_MAX = 2147483647;
/** 家族旧表（TextManager `src/client/styles.mjs` 的 LAYER 表）——托管浮层不复用这些值，撞上只告警。 */
export const RESERVED_LEGACY_Z = Object.freeze([1, 2, 3, 10, 62, 63, 64, 66, 70]);

/** 段名 → 段（不存在 ⇒ `undefined`）。 */
export function segmentOf(family) {
  return LAYER_SEGMENTS.find((segment) => segment.family === family);
}

/**
 * 纯函数：把一个**整数**层号落到带名上（不做形态校验，校验走 `validateZ`）。
 * @returns {'below'|'gap'|'floating'|'dialog'|'popover'|'toast'|'above'}
 */
export function zBand(z) {
  if (z <= UNMANAGED_BELOW_MAX) return 'below';
  if (z >= UNMANAGED_ABOVE_MIN) return 'above';
  for (const segment of LAYER_SEGMENTS) {
    if (z >= segment.min && z <= segment.max) return segment.family;
  }
  return 'gap';
}

/** 带名是否属于托管号段（`floating/dialog/popover/toast`）。 */
export function isHostedBand(band) {
  return LAYER_FAMILIES.includes(band);
}

/**
 * 形态校验（「极值拒绝」就落在这里）。
 * @param {unknown} z
 * @returns {{ok:true, z:number}|{ok:false, code:string, message:string}}
 */
export function validateZ(z) {
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
export function createLayerAllocator(options = {}) {
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
export function zDataAttribute(z) {
  return { [DATA_GUIF_Z]: String(z) };
}

/** 极简值描述（错误文案用；不 dump 整对象，避免把 live 数据打进日志）。 */
function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组(${value.length})`;
  return typeof value === 'object' ? '对象' : `${typeof value} ${String(value)}`;
}
