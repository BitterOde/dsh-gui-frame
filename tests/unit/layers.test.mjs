/**
 * layers.test.mjs —— **数字层级表**的机检门禁。
 *
 * 判据（**号段表是五段口径**）：
 *  1. 托管号段：浮动窗 50+ / **面板 200+** / Dialog 300+ / Popover 500+ / Toast 700+；官方内容层 20 是基线；
 *     ⚠ 面板与 Dialog 是**两段**（200–299 与 300–499），别按「dialog 200–399」那样的旧口径并回去；
 *     另有两条通检：「段表必须连续、互不重叠、覆盖 50…999」与「每段的 min/max 必须自洽落在本族」。
 *  2. 非托管约定：≤40 在下、≥1000 盖住；41…49 是缝（只告警）；
 *  3. **越段只告警不阻断**（返回值照给，同时产生 `GUIF-W-Z-SEGMENT`）；
 *  4. **极值拒绝**：非整数 / 非有限数 / ≥2^31 / 极端负数 ⇒ `GUIF-E-Z-RANGE`（不退化为告警）；
 *  5. 不传 `z` 时从 100 起**单调自增**；
 *  6. 家族旧表值（1/2/3/10/62/63/64/66/70）撞上只告警；
 *  7. `data-guif-z` 暴露实际值供真机断言。
 *
 * 纪律：本用例不写盘、不联网、不需要 DSH 在跑（L0 纯函数层）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_LAYER_Z,
  DATA_GUIF_Z,
  DEFAULT_Z_START,
  LAYER_FAMILIES,
  LAYER_SEGMENTS,
  RESERVED_LEGACY_Z,
  UNMANAGED_ABOVE_MIN,
  UNMANAGED_BELOW_MAX,
  Z_MAX,
  Z_MIN,
  createLayerAllocator,
  isHostedBand,
  validateZ,
  zBand,
  zDataAttribute,
} from '../../src/client/contracts/layers.mjs';

test('号段表：托管五段 + 下带 / 缝 / 盖住带，边界逐点对齐（五段口径 + 段表自洽通检）', () => {
  assert.deepEqual([...LAYER_FAMILIES], ['floating', 'panel', 'dialog', 'popover', 'toast']);
  assert.deepEqual(
    LAYER_SEGMENTS.map((segment) => [segment.family, segment.min, segment.max]),
    [['floating', 50, 199], ['panel', 200, 299], ['dialog', 300, 499], ['popover', 500, 699], ['toast', 700, 999]],
    '托管号段必须是 50+ / 200+ / 300+ / 500+ / 700+ 五段（面板是独立的一段）',
  );
  assert.equal(UNMANAGED_BELOW_MAX, 40, '「在下」带上界 = 40');
  assert.equal(UNMANAGED_ABOVE_MIN, 1000, '「盖住」带下界 = 1000');
  assert.equal(CONTENT_LAYER_Z, 20, '官方 .overlayLayer{z-index:20} 是基线');
  assert.equal(DEFAULT_Z_START, 100, '缺省分配起点 = 100（落在 floating 段内）');

  // ★ 收紧①：段表自洽 —— 连续、互不重叠、恰好覆盖 50…999；且每段端点的族名自证
  assert.equal(LAYER_SEGMENTS[0].min, 50, '第一段必须从 50 起');
  assert.equal(LAYER_SEGMENTS.at(-1).max, 999, '最后一段必须到 999 止');
  for (let index = 0; index < LAYER_SEGMENTS.length; index += 1) {
    const segment = LAYER_SEGMENTS[index];
    assert.ok(segment.min <= segment.max, `${segment.family} 段必须非空`);
    assert.equal(zBand(segment.min), segment.family, `${segment.family} 的 min=${segment.min} 必须自证落在本族`);
    assert.equal(zBand(segment.max), segment.family, `${segment.family} 的 max=${segment.max} 必须自证落在本族`);
    if (index > 0) {
      assert.equal(segment.min, LAYER_SEGMENTS[index - 1].max + 1, `${segment.family} 与上一段必须紧邻、无空隙无重叠`);
    }
  }

  // 边界逐点：下带 / 缝 / 五段 / 盖住带
  const points = [
    [-100, 'below'], [0, 'below'], [20, 'below'], [40, 'below'],
    [41, 'gap'], [49, 'gap'],
    [50, 'floating'], [199, 'floating'],
    [200, 'panel'], [299, 'panel'],
    [300, 'dialog'], [499, 'dialog'],
    [500, 'popover'], [699, 'popover'],
    [700, 'toast'], [999, 'toast'],
    [1000, 'above'], [100000, 'above'],
  ];
  for (const [z, band] of points) assert.equal(zBand(z), band, `z=${z} 应落在 ${band}`);
  assert.ok(isHostedBand('floating') && isHostedBand('panel') && isHostedBand('toast'), '托管段判定（含 panel）');
  assert.ok(!isHostedBand('below') && !isHostedBand('gap') && !isHostedBand('above'));

  // ★ 面板与悬浮窗是**两个组件** ⇒ panel 段不得并回 dialog
  assert.equal(zBand(250), 'panel', '250 必须落 panel（旧表把它算进 dialog，是判据滞后）');
  assert.notEqual(zBand(250), 'dialog', 'panel 段一旦并回 dialog，本条即红');
});

test('极值一律拒绝：非整数 / 非有限数 / ≥2^31 / 极端负数 ⇒ GUIF-E-Z-RANGE', () => {
  const rejected = [
    [2 ** 31, '2^31'],
    [2 ** 31 + 1, '2^31+1'],
    [-(2 ** 31) - 1, '极端负数'],
    [Number.MIN_SAFE_INTEGER, 'MIN_SAFE_INTEGER'],
    [Number.MAX_SAFE_INTEGER, 'MAX_SAFE_INTEGER'],
    [{}, '对象'],
    ['100', '字符串数字'],
    [true, '布尔'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [Number.NEGATIVE_INFINITY, '-Infinity'],
    [1.5, '小数'],
  ];
  for (const [value, label] of rejected) {
    const checked = validateZ(value);
    assert.equal(checked.ok, false, `${label} 必须被拒绝`);
    assert.equal(checked.code, 'GUIF-E-Z-RANGE', `${label} 的错误码必须是 GUIF-E-Z-RANGE`);
    assert.ok(checked.message.length > 0);
  }
  assert.deepEqual(validateZ(Z_MAX), { ok: true, z: Z_MAX }, '2^31-1 是上界，合法');
  assert.deepEqual(validateZ(Z_MIN), { ok: true, z: Z_MIN }, '-2^31 是下界，合法');
  assert.deepEqual(validateZ(0), { ok: true, z: 0 });
  assert.deepEqual(validateZ(-7), { ok: true, z: -7 });
});

test('分配器：缺省从 100 起单调自增；显式 z 采用原值且越段只告警（不阻断）', () => {
  const warnings = [];
  const allocator = createLayerAllocator({ onWarning: (warning) => warnings.push(warning) });
  assert.equal(allocator.current(), 100);

  const first = allocator.allocate('floating');
  assert.deepEqual({ z: first.z, band: first.band, allocated: first.allocated }, { z: 100, band: 'floating', allocated: true });
  const second = allocator.allocate('floating');
  assert.equal(second.z, 101, '单调自增');
  assert.equal(allocator.current(), 102);

  // 显式 z：采用原值（allocated=false），但不属于该族号段 ⇒ 只告警
  const explicit = allocator.allocate('floating', 700);
  assert.equal(explicit.z, 700, '越段也照用（只告警不阻断）');
  assert.equal(explicit.allocated, false);
  assert.equal(explicit.band, 'toast');
  assert.equal(explicit.warnings.length, 1);
  assert.equal(explicit.warnings[0].code, 'GUIF-W-Z-SEGMENT');

  // 非托管带同样只告警
  let sink = [];
  const other = createLayerAllocator({ onWarning: (warning) => sink.push(warning) });
  assert.equal(other.allocate('floating', 5000).z, 5000);
  assert.equal(sink.at(-1).code, 'GUIF-W-Z-SEGMENT');
  assert.equal(other.allocate('floating', 40).z, 40, '≤40 = 在下带，属非托管约定，仍可用');
  assert.equal(sink.at(-1).code, 'GUIF-W-Z-SEGMENT', '不属于 floating 号段 ⇒ 一条告警');
  assert.equal(other.allocate('toast', 1000).z, 1000, '≥1000 = 盖住带');

  // 家族旧表值：只告警（62 落在 floating 段内 ⇒ 只有 RESERVED；10 落在下带 ⇒ SEGMENT + RESERVED 两条）
  sink = [];
  const legacy = other.allocate('floating', 62);
  assert.equal(legacy.z, 62);
  assert.deepEqual(legacy.warnings.map((warning) => warning.code), ['GUIF-W-Z-RESERVED']);
  sink = [];
  const legacyBelow = other.allocate('floating', 10);
  assert.equal(legacyBelow.z, 10);
  assert.deepEqual(legacyBelow.warnings.map((warning) => warning.code), ['GUIF-W-Z-SEGMENT', 'GUIF-W-Z-RESERVED']);
  assert.ok(RESERVED_LEGACY_Z.every((value) => Number.isInteger(value)));

  assert.ok(warnings.length >= 1);
  assert.ok(allocator.warnings().length >= 1, '分配器自带告警环（诊断用）');

  // 极值：抛错，且是 GUIF-E-Z-RANGE
  assert.throws(() => allocator.allocate('floating', 2 ** 31), (error) => error.code === 'GUIF-E-Z-RANGE');
  assert.throws(() => allocator.allocate('dialog', '200'), (error) => error.code === 'GUIF-E-Z-RANGE');
  // 抛错不消耗号
  assert.equal(allocator.current(), 102);
  allocator.reset();
  assert.equal(allocator.current(), 100);
  assert.deepEqual(allocator.warnings(), []);
});

test('data-guif-z：属性名常量与实际值形态（真机断言锚点）', () => {
  assert.equal(DATA_GUIF_Z, 'data-guif-z');
  assert.deepEqual(zDataAttribute(100), { 'data-guif-z': '100' });
  assert.deepEqual(zDataAttribute(5000), { 'data-guif-z': '5000' });
  assert.deepEqual(RESERVED_LEGACY_Z, [1, 2, 3, 10, 62, 63, 64, 66, 70], '家族旧表值清单（托管浮层不复用）');
});
