/**
 * check-boundaries.limits.mjs —— **门禁的冻结口径表与白名单**（从 `check-boundaries.mjs` 原样搬出）。
 *
 * 为什么单独成文件：入口要守住「非 src 面单文件 ≤600 行」——**门禁不许违反自己要执行的判据**。
 * 搬出这一段的直接原因是入口经两轮修复后涨到 643 行（超限 43 行）；
 *   搬的是**常量与纯函数**，判定逻辑（`analyze` / `violationsOf`）一个字没动。
 *
 * 【口径纪律】阈值**只许收紧**：调大任何一条都等于放宽门禁。裁量只允许一种方向 ——
 * 先把「这条阈值是谁的刻度」说清楚，再按同口径重算（见 `LIMITS.testDirect*Min` 的注）。
 */
export const LIMITS = Object.freeze({
  /** `src/**` 单文件行数上限（口径 `source.split('\n').length`）。 */
  srcMaxLines: 320,
  /** **唯一的 data 豁免**（生成物 + 冻结表 + 零控制流；只减不增）。 */
  dataExempt: Object.freeze(['src/client/theme/tokens-data.mjs']),
  /** 非 `src` 面（tests/scripts/verify/tools）硬上限。 */
  nonSrcMaxLines: 600,
  /** 全仓重复块（8 行窗口）组数上限（只减不增）。 */
  dupTotalMax: 410,
  /** 出现 **≥3 次**的重复族上限——**生产面**（`src/**` `scripts/**` `verify/**` `tools/**`）必须为 0。 */
  dupRepeatFamilyMax: 0,
  /**
   * **测试面**（`tests/**`）≥3 次重复族的登记基线（**只减不增**；登记 50 处）。
   * 口径（按命中条数分面）与逐条理由见 `check-boundaries.dup.mjs` 文件头【重复块的「面」口径】与 `TESTS_DUP_REASONS`。
   */
  testsDupFamiliesMax: 50,
  /** `src/**` 内部重复组上限（只减不增）。 */
  dupSrcInternalMax: 187,
  /** 死导出的上限（只减不增）。 */
  deadExportsMax: 179,
  /** `src/**` 真环（SCC size>1）必须为 0。 */
  srcCyclesMax: 0,
  /** 全仓环的**登记夹具**（除它以外任何环都判红）。 */
  registeredCycles: Object.freeze(['tests/build/fixtures/cycle/a.mjs', 'tests/build/fixtures/cycle/b.mjs']),
  /** `src/client` 目录层数（与 build-client 的 MAX_DIR_DEPTH 同源，不另造口径）。 */
  maxDirDepth: 4,
  /**
   * 测试直面下限（防「改测试换绿」）。
   *
   * 下限取**本副本实测值** 28 / 22。
   * 这不是放宽判据，是把标尺换成它自己的刻度 —— 这条的语义是「不许把测试改少了换绿」，
   * 而 55 / 62 是在 v2 的 136 个测试文件上算出来的；本树同代裁剪后只剩 71 个测试文件，
   * 拿 v2 的绝对值卡它等于永远判红（红的原因与「改测试换绿」无关）。改成实测值后**照样只减不增**：
   * 少直接 import 一个 src 模块、或少一个做这件事的测试文件，门禁立刻再判红。
   *
   * 读数随件数走：删掉没有任何运行时消费方的模块时，下限跟着实测值下移（如 31/23 → 28/22）；
   * **不许**为了让门禁变绿去动测试 —— 只允许按同口径重算，并在收口说明里交代是哪几件没了。
   */
  testDirectModulesMin: 28,
  testDirectFilesMin: 22,
  /**
   * 公开面快照字节数（冻结口径，唯一真源是 `scripts/public-surface.mjs`）。
   * ★ **有意的公开面变更** —— 收取的 slot 键多一个 `settings.general.item`
   *   （DSH 设置页那一行），快照 1205 → 1234 字节；改的是这个冻结数字，不是判据本身。
   * ★ **第二次有意变更** —— 服务面多一个命名空间 `dock`（按钮面板的公开入口
   *   `open/close/isOpen`），`serviceMembers` 8 → 9 项，快照 1234 → 1246 字节。
   * ★ **同代裁剪后的实测值** —— 服务面去掉 `channel` / `layout` / `workbench`
   *   三项（v2 侧同轮实测 1263 字节），本树快照 1146 字节。这里跟着实测走，**不是放宽**：
   *   判据仍是「快照字节数逐字等于冻结口径」，改的只是那个被冻结的数字，且由
   *   `tests/verify-surface/public-surface.test.mjs` 的逐字节比对独立复核内容。
   * ★ **第三次有意变更** —— 去掉 `schemaVersion` 字段：那个数是**布局载荷**的 schema 版本，
   *   而本版没有布局能力（迁移与收敛整套已删），留着等于让快照描述一个不存在的载荷；
   *   快照 1146 → 1124 字节。
   */
  publicSurfaceBytes: 1124,
});

/**
 * 能力域直连白名单。**落地后 = 0 条**。
 * 匹配粒度＝`from相对路径->to相对路径`；**只许缩短**：留在这里的边若已不存在，门禁也会报（提示收紧）。
 */
export const CAPABILITY_EDGE_WHITELIST = Object.freeze([]);

/**
 * 未解析相对 import 的白名单（自检要求：**为空或逐条白名单化**）。
 * - `fixtureFiles`：**故意夹具/负控**里的假模块名（不得修，28 条）；
 * - `exact`：注释/生成模板/夹具字符串里的假模块名（6 条），**逐条给理由**。
 */
export const UNRESOLVED_WHITELIST = Object.freeze({
  fixtureFiles: Object.freeze(['tests/build/', 'tests/unit/build-client.test.mjs', 'tests/unit/skeleton.test.mjs']),
  exact: Object.freeze([
    { file: 'scripts/build-client.mjs', spec: './y.mjs', reason: '生成产物的**模板字符串**里的假模块名（6 条之一）' },
    { file: 'scripts/build-host.mjs', spec: './x.mjs', reason: '同上：模板/注释里的假模块名' },
    { file: 'scripts/build-host.mjs', spec: './host/index.js', reason: '同上：模板里的产物路径，不是源码 import' },
  ]),
});
