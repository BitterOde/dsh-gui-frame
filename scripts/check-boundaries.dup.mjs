/**
 * check-boundaries.dup.mjs —— **重复块（8 行窗口）的分析面与「面」口径登记表**
 * （从 `check-boundaries.mjs` 原样搬出；`normalizeLine` / `duplicateBlocks` 逐字未改）。
 *
 * 为什么单独成文件：入口要守住「非 src 面单文件 ≤600 行」——**门禁不许违反自己要执行的判据**
 * （加上测试面登记表后入口涨到 719 行 ⇒ 本件独立）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【重复块的「面」口径】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `src/**`、`scripts/**`、`verify/**`、`tools/**` 合称**生产面**；`tests/**` 是**测试面**。
 * 同一个「出现 ≥3 次的重复族」按**命中条数**分流（不按文件个数、不按目录名）：
 *   · **生产面族** ＝ 生产面命中 **≥3 条**的族 ⇒ **必须 0**（`LIMITS.dupRepeatFamilyMax = 0`）；
 *     少于 3 条生产命中的族**不算**生产面族（剩下的命中在测试面，由下一条管）。
 *   · **测试面族** ＝ 含 **≥1 条** `tests/**` 命中的族 ⇒ **只减不增**：
 *     ① 总数 ≤ `LIMITS.testsDupFamiliesMax`（本轮登记基线 **50**）；
 *     ② **每一条都要在 `TESTS_DUP_REASONS` 里按「文件集合」登记一行理由**
 *        （取值只认 `自包含夹具` / `隔离判据` / `待抽取`），**未登记的族 ⇒ 判红**
 *        —— 新造出来的测试侧重复不会因为「表里已有别的条目」而溜过去。
 *   · 反恒真（`--selftest` 的 B4 用例）：造 3 处同形块 ⇒ 测试面族读数 0 → N 且生产面仍 0（不恒零、
 *     也不把测试面的命中误记成生产面）。
 *
 * **依据（不是放宽，是换面判）**：这条指标是自拟的、不是用户裁定；`tests/unit/panel-isolation.test.mjs:10`
 * 明写「本文件自带夹具（不 import tests/helpers/**、不 import tests/client/**）」，是**刻意的隔离纪律**，
 * 代价不该由指标来付；本项目已有「只减不增」的惯用口径（死导出 182 → ≤179）。
 * 判定与逐条打印在入口（`violationsOf`）与 `check-boundaries.cli.mjs` 的 `printReading`。
 */

/** 一条族的「文件集合」键（`TESTS_DUP_REASONS` 的匹配粒度；行号不参与）。 */
export function familyFileKey(hits) {
  return [...new Set(hits.map((loc) => loc.split(':')[0]))].sort().join(' | ');
}
/**
 * **测试面**：每一条「≥3 次重复族」都要在这里**按文件集合登记一行理由**。
 *   · 匹配粒度＝该族命中的**文件集合**（排序拼接；**不看行号** —— 行号会随无关改动漂移，
 *     而「这几个文件同形」这件事不会）；
 *   · `reason` 只认三个取值（口径原文）：`自包含夹具` / `隔离判据` / `待抽取`；
 *   · **未登记的族 ⇒ 判红**（入口 `violationsOf` 的重复块规则）：新造出来的测试侧重复溜不过去。
 * 口径与逐条理由的完整说明见本文件头部【重复块的「面」口径】。
 */
export const TESTS_DUP_REASONS = Object.freeze([
  {
    files: ['tests/unit/panel-hooks.test.mjs', 'tests/unit/panel-isolation.test.mjs', 'tests/unit/panel-shell-hook.test.mjs'],
    reason: '自包含夹具',
    note: 'JSDOM 注入 + mountStrict/act：三文件各自「不 import tests/helpers/**、不 import tests/client/**」的刻意复制（panel-isolation.test.mjs 文件头明写）',
  },
  {
    files: ['tests/verify-boundary/anti-false-green.test.mjs'],
    reason: '待抽取',
    note: '**同一文件**内三次列同一串判据 id ⇒ 本文件内提成常量即可消',
  },
  {
    files: ['tests/verify-boundary/boundary-independent.test.mjs', 'tests/verify-boundary/non-specialized.test.mjs', 'tests/verify-boundary/static-collection.test.mjs', 'tests/verify-boundary/surface-matrix.test.mjs'],
    reason: '待抽取',
    note: '四文件同形引导头（runCriteria() + byId + expectPass）⇒ 可抽 tests/verify-boundary/harness',
  },
  {
    files: ['tests/verify-boundary/boundary-independent.test.mjs', 'tests/verify-boundary/non-specialized.test.mjs', 'tests/verify-boundary/surface-matrix.test.mjs'],
    reason: '待抽取',
    note: '同上（三文件子集，同一段引导头的另一窗口）',
  },
  {
    files: ['tests/host/diagnostics-sink.test.mjs', 'tests/host/routes-register.test.mjs', 'tests/unit/diagnostics-client.test.mjs'],
    reason: '待抽取',
    note: '同形 import 头（node:test + createFakeCtx）—— import 头抽不动，只能靠公共夹具统一',
  },
  {
    files: ['src/client/kit/primitives.mjs', 'tests/unit/dock-fixtures.mjs', 'verify/lib/harness.mjs'],
    reason: '待抽取',
    note: '**跨面**：生产侧只有 1 处命中（kit/primitives 的 icon 夹具块）⇒ **不构成生产面族**；另两处分别在测试夹具与验证装置 verify/lib/harness.mjs',
  },
  {
    files: ['tests/client/harness.mjs', 'tests/verify-surface/harness.mjs', 'verify/lib/harness.mjs'],
    reason: '待抽取',
    note: '同形 harness 引导段（icon 夹具 + 假 slots）',
  },
  {
    files: ['tests/client/harness.mjs', 'tests/unit/panel-isolation.test.mjs', 'verify/lib/harness.mjs'],
    reason: '待抽取',
    note: '同上（panel-isolation 侧受「自带夹具」纪律约束，只有它与 client/harness 两处可动）',
  },
  {
    files: ['tests/client/harness.mjs', 'tests/verify-boundary/harness.mjs', 'verify/lib/harness.mjs'],
    reason: '待抽取',
    note: '同上（verify-boundary/harness 侧）',
  },
  {
    files: ['tests/client/harness.mjs', 'tests/unit/panel-hooks.test.mjs', 'tests/unit/panel-isolation.test.mjs', 'tests/verify-boundary/harness.mjs', 'verify/lib/harness.mjs'],
    reason: '待抽取',
    note: 'icon 夹具块在 5 个 harness/测试文件里的最长一条重叠',
  },
]);

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 重复块（8 行窗口）—— **不截断**
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** 归一化：去行注释 / 块注释 / 首尾空白 / 折叠空白。 */
export function normalizeLine(line) {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim().replace(/\s+/g, ' ');
}

/**
 * 8 行窗口的重复块（**全量**，不做任何 slice 截断）。
 * @param {Array<{rel:string, source:string}>} files
 * @param {{reasons?:Array<{files:string[],reason:string,note:string}>, checkStale?:boolean}} [options]
 *   `reasons` 是**单测缝**（默认＝`TESTS_DUP_REASONS`；自检用它造「过期登记」的阴性对照）；
 *   `checkStale` 控制**反尘味**这一条是否生效（默认开；夹具面默认关，理由见文件头反尘味小节）。
 */
export function duplicateBlocks(files, options = {}) {
  const reasons = Array.isArray(options.reasons) ? options.reasons : TESTS_DUP_REASONS;
  const checkStale = options.checkStale !== false;
  const WINDOW = 8;
  const blocks = new Map();
  for (const file of files) {
    const lines = file.source.split('\n').map(normalizeLine);
    for (let index = 0; index + WINDOW <= lines.length; index += 1) {
      const slice = lines.slice(index, index + WINDOW);
      if (slice.filter((line) => line.length > 0).length < WINDOW - 1) continue;
      if (slice.every((line) => /^[)}\];,]*$/.test(line) || line === '')) continue;
      const key = slice.join('\n');
      if (key === '') continue;
      const hits = blocks.get(key) ?? [];
      hits.push(`${file.rel}:${index + 1}`);
      blocks.set(key, hits);
    }
  }
  const groups = [...blocks.entries()].filter(([, hits]) => hits.length > 1).map(([, hits]) => hits);
  const histogram = {};
  for (const hits of groups) histogram[hits.length] = (histogram[hits.length] ?? 0) + 1;
  const repeatFamilies = groups.filter((hits) => hits.length >= 3);
  // ── 面口径（文件头【重复块的「面」口径】；**按命中条数分流**，不按目录名）─────────────────────────
  const testsHit = (loc) => loc.startsWith('tests/');
  /** 生产面族：生产面命中 **≥3 条**（少于 3 条的族由测试面规则管）。 */
  const productionFamilies = repeatFamilies.filter((hits) => hits.filter((loc) => !testsHit(loc)).length >= 3);
  /** 测试面族：含 ≥1 条 `tests/**` 命中（**每条都要在 `TESTS_DUP_REASONS` 里登记理由**）。 */
  const testsFamilies = repeatFamilies.filter((hits) => hits.some(testsHit));
  /** 未登记理由的测试面族（判红；反恒真的另一半：登记表按**文件集合**匹配）。 */
  const unregisteredTestsFamilies = testsFamilies.filter((hits) => !reasons.some((row) => row.files.join(' | ') === familyFileKey(hits)));
  /**
   * **反尘味**：理由表里**已登记却不再命中任何重复族**的条目 ⇒ 判红。
   * 为什么必须有它：只对「未登记」有牙、对「已失效」没牙的表会退化成**永久豁免**（同 `CAPABILITY_EDGE_WHITELIST`
   * 的 `staleWhitelist` 口径；刚因一条未解析白名单盖住活断链付过一轮修复代价）。
   * 夹具面默认不查（自检的最小夹具**天然**不会命中登记表里的真实文件集合；要用它得显式注入 `reasons`）。
   */
  const observedKeys = new Set(testsFamilies.map((hits) => familyFileKey(hits)));
  const staleTestsReasons = checkStale ? reasons.filter((row) => !observedKeys.has(row.files.join(' | '))) : [];
  return {
    total: groups.length,
    histogram,
    repeatFamilies,
    productionFamilies,
    testsFamilies,
    unregisteredTestsFamilies,
    staleTestsReasons,
    srcInternal: groups.filter((hits) => hits.every((loc) => loc.startsWith('src/'))).length,
  };
}
