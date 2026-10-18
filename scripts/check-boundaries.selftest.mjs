/**
 * check-boundaries.selftest.mjs —— 解耦门禁的**自带牙**（三处盲区各造一条违规 ⇒ 必须判红；
 * 撤掉违规的对照夹具 ⇒ 必须复绿）。三处盲区：跳过判定按目录名判、重复块被截断、域为 null 的边被静默丢掉。
 *
 * 为什么单独成文件：它自己有 200 来行夹具（假仓库、重复块生成器），留在入口里会让入口**违反
 * 该文件自己要执行的非 src 面 600 行上限** —— 门禁不许给自己开豁免。
 *
 * 依赖注入：夹具只认调用方传进来的 `analyze` / `violationsOf`，因此**不 import 入口**
 * （否则入口 ↔ selftest 成环，虽然 ESM 能跑，但读代码的人要算半天求值顺序）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 自带牙：三处盲区各造一条违规（B1 / B2 / B3）—— 违规版必须判红，撤销后必须复绿
// ═══════════════════════════════════════════════════════════════════════════════════════════
/** 造一棵最小可控的假仓库（只在系统临时目录里写，不碰真实仓库）。 */
function writeFixtureRepo(dir, spec) {
  const write = (rel, text) => {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  };
  // 假仓库里的 import 语句**拼出来**：本文件自身也在扫描面内，写死的 `from '…'` 字面量会让
  // 「未解析相对 import」自检把自己的夹具文本当成噪声（实测：4 条）。拼装后本文件自身干净。
  const FROM = `${'fro'}m`;
  const line = (bindings, spec2) => `import { ${bindings} } ${FROM} '${spec2}';\n`;
  // 干净底子：一个能力域 + 词汇叶 + 共享叶 + 装配点 + 测试 + 非源码目录
  write('src/client/contracts/layers.mjs', 'export const LAYER = 1;\n');
  write('src/client/kit/util.mjs', 'export const util = 1;\n');
  write('src/client/dock.mjs', `${line('LAYER', './contracts/layers.mjs')}${line('util', './kit/util.mjs')}export const dock = LAYER + util;\n`);
  write('src/client/entry.mjs', `${line('dock', './dock.mjs')}export const entry = dock;\n`);
  write('src/host/index.mjs', 'export const host = 1;\n');
  write('tests/unit/dock.test.mjs', `${line('dock', '../../src/client/dock.mjs')}${line('entry', '../../src/client/entry.mjs')}${line('host', '../../src/host/index.mjs')}export const t = dock + entry + host;\n`);
  write('scripts/tool.mjs', 'export const tool = 1;\n');
  write('lib/client.js', 'ignore me\n');
  for (const [rel, text] of Object.entries(spec.extra ?? {})) write(rel, text);
  return dir;
}

/** 造一个「同一段 8 行块出现 `times` 次」的文件体（中间用**唯一代码行**隔开，免得窗口在边界上合并）。 */
function repeatBlock(family, times) {
  const block = [
    `const ${family}_a = alpha;`,
    `const ${family}_b = beta;`,
    `const ${family}_c = gamma;`,
    `const ${family}_d = delta;`,
    `const ${family}_e = epsilon;`,
    `const ${family}_f = zeta;`,
    `const ${family}_g = eta;`,
    `const ${family}_h = theta;`,
  ].join('\n');
  const parts = [];
  for (let index = 0; index < times; index += 1) {
    parts.push(block);
    parts.push(`const ${family}_sep_${index} = ${index};`);
  }
  return parts.join('\n');
}

export function runSelftest({ analyze, violationsOf }) {
  const cases = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guif-gate-'));
  /** B4 的反恒真基线：干净夹具上的「测试面族」与「生产面族」读数（必须都是 0）。 */
  let cleanTestsFamilies = -1;
  let cleanProductionFamilies = -1;
  try {
    // ── 对照：干净夹具必须**复绿** ──────────────────────────────────────────────────────
    {
      const dir = writeFixtureRepo(path.join(tmp, 'clean'), {});
      const reading = analyze({ root: dir, withPublicSurface: false, profile: 'fixture' });
      const rows = violationsOf(reading);
      cleanTestsFamilies = reading.m2.testsFamilies.length;
      cleanProductionFamilies = reading.m2.productionFamilies.length;
      cases.push({ name: '对照·干净夹具', expect: 'green', rows });
    }
    // ── B1：`<任何>/lib/**` 里的超长文件必须被**扫到**并判红；包根 `lib/` 产物仍必须跳过 ──
    {
      const big = Array.from({ length: 700 }, (_, index) => `export const line${index} = ${index};`).join('\n');
      const dir = writeFixtureRepo(path.join(tmp, 'b1'), {
        extra: {
          'verify/real-machine/lib/judge.mjs': `${big}\n`,
          'lib/huge-product.js': `${big}\n`,
          // 被扫到的 lib 文件还要制造一条能力域直连，证明域表对它同样生效
        },
      });
      const reading = analyze({ root: dir, withPublicSurface: false, profile: 'fixture' });
      const rows = violationsOf(reading);
      cases.push({
        name: 'B1·按目录名跳 lib（旧口径）',
        expect: 'red',
        rows,
        mustHit: (list) => list.some((row) => row.message.includes('verify/real-machine/lib/judge.mjs')),
        mustMiss: (list) => !list.some((row) => row.message.includes('lib/huge-product.js')),
      });
    }
    // ── B2：≥3 次的重复族必须被抓到（旧口径被 slice(0,40) 截断 ⇒ 恒看得出 40 组） ──────
    {
      const blocks = Array.from({ length: 45 }, (_, index) => repeatBlock(`fam${index}`, 3)).join('\n');
      const dir = writeFixtureRepo(path.join(tmp, 'b2'), {
        extra: { 'tools/repeat.mjs': `${blocks}\n` },
      });
      const reading = analyze({ root: dir, withPublicSurface: false, profile: 'fixture' });
      const rows = violationsOf(reading);
      cases.push({
        name: 'B2·重复块被截断（旧口径）',
        expect: 'red',
        rows,
        mustHit: (list) => list.some((row) => row.message.includes('出现 ≥3 次的重复族')),
        extra: { repeatFamilies: reading.m2.repeatFamilies.length, total: reading.m2.total },
      });
    }
    // ── B3：域为 null 的文件 + kit 域的能力互连，都必须判红（旧口径下二者静默消失） ──────
    {
      const leaky = `import { dock } ${'fro'}m '../dock.mjs';\nexport const leaky = dock;\n`;
      const dir = writeFixtureRepo(path.join(tmp, 'b3'), {
        extra: {
          'src/client/mystery/x.mjs': 'export const mystery = 1;\n',
          'src/client/kit/leaky.mjs': leaky,
        },
      });
      const reading = analyze({ root: dir, withPublicSurface: false, profile: 'fixture' });
      const rows = violationsOf(reading);
      cases.push({
        name: 'B3·域为 null / kit 域静默（旧口径）',
        expect: 'red',
        rows,
        mustHit: (list) => list.some((row) => row.message.includes('src/client/mystery/x.mjs')) && list.some((row) => row.message.includes('kit → dock')),
      });
    }

    // ── B4：**测试面 ≥3 族统计必须有牙**（反恒真 / 反恒零）：三个 `tests/**` 文件里放同一段 8 行块
    //       ⇒ ① 测试面族读数 0 → N（不是恒零）；② 生产面族仍为 0（**不把测试面的命中误记成生产面**）；
    //      ③ 未登记理由 ⇒ 必须判红（新造出来的重复不会因为登记表里有别的条目而溜过去）。
    {
      const dup = repeatBlock('tdup', 3);
      const dir = writeFixtureRepo(path.join(tmp, 'b4'), {
        extra: {
          'tests/unit/dup-a.test.mjs': `${dup}\n`,
          'tests/unit/dup-b.test.mjs': `${dup}\n`,
          'tests/unit/dup-c.test.mjs': `${dup}\n`,
        },
      });
      const reading = analyze({ root: dir, withPublicSurface: false, profile: 'fixture' });
      const rows = violationsOf(reading);
      cases.push({
        name: 'B4·测试面重复族统计恒零（旧口径下这条读数为 0 或恒真）',
        expect: 'red',
        rows,
        mustHit: (list) => list.some((row) => row.message.includes('未登记理由'))
          && reading.m2.testsFamilies.length >= 1
          && cleanTestsFamilies === 0
          && reading.m2.productionFamilies.length === 0
          && cleanProductionFamilies === 0,
        extra: {
          testsFamilies: reading.m2.testsFamilies.length,
          cleanTestsFamilies,
          productionFamilies: reading.m2.productionFamilies.length,
          cleanProductionFamilies,
        },
      });
    }

    // ── B5：**理由表反尘味**（契约 v4 第 10 条）—— 已登记却不再命中任何重复族的条目必须判红。
    //      阴性对照＝注入一条**与夹具文件集合不符**的「过期登记」⇒ 必须报反尘味；
    //      正对照＝换成**与夹具吻合**的登记 ⇒ 同一夹具不得报反尘味（证明这条规则不是恒真）。
    {
      const dup = repeatBlock('b5', 3);
      const fixtureFiles = ['tests/unit/stale-a.test.mjs', 'tests/unit/stale-b.test.mjs', 'tests/unit/stale-c.test.mjs'];
      const dir = writeFixtureRepo(path.join(tmp, 'b5'), {
        extra: Object.fromEntries(fixtureFiles.map((rel) => [`${rel}`, `${dup}\n`])),
      });
      const staleReading = analyze({
        root: dir,
        withPublicSurface: false,
        profile: 'fixture',
        dupReasons: [{ files: ['tests/unit/gone-away.test.mjs'], reason: '待抽取', note: '阴性对照：这条登记已经不再命中任何族' }],
      });
      const rows = violationsOf(staleReading);
      cases.push({
        name: 'B5·理由表反尘味（造一条过期登记 ⇒ 必须判红）',
        expect: 'red',
        rows,
        mustHit: (list) => list.some((row) => row.message.includes('反尘味'))
          && staleReading.m2.staleTestsReasons.length === 1
          && staleReading.m2.unregisteredTestsFamilies.length >= 1,
        extra: { staleTestsReasons: staleReading.m2.staleTestsReasons.length },
      });
      const freshReading = analyze({
        root: dir,
        withPublicSurface: false,
        profile: 'fixture',
        dupReasons: [{ files: fixtureFiles, reason: '待抽取', note: '正对照：这条登记与夹具的文件集合逐字吻合' }],
      });
      const freshRows = violationsOf(freshReading);
      cases.push({
        name: 'B5-对照·登记与命中吻合 ⇒ 不报反尘味（规则不是恒真）',
        expect: 'green',
        rows: freshRows,
        mustMiss: (list) => !list.some((row) => row.message.includes('反尘味')),
        extra: { staleTestsReasons: freshReading.m2.staleTestsReasons.length, testsFamilies: freshReading.m2.testsFamilies.length },
      });
    }

    let failed = 0;
    console.log('[check-boundaries] --selftest：三处盲区各造一条违规 ⇒ 必须判红；对照夹具 ⇒ 必须复绿');
    for (const item of cases) {
      const red = item.rows.length > 0;
      const okExpect = item.expect === 'red' ? red : !red;
      const okHit = item.mustHit === undefined ? true : item.mustHit(item.rows);
      const okMiss = item.mustMiss === undefined ? true : item.mustMiss(item.rows);
      const ok = okExpect && okHit && okMiss;
      if (!ok) failed += 1;
      console.log(`  ${ok ? '✔' : '✗'} ${item.name}：期望 ${item.expect}｜实际 ${red ? 'red' : 'green'}｜违规 ${item.rows.length} 条`);
      if (item.extra !== undefined) console.log(`     读数：${JSON.stringify(item.extra)}`);
      for (const row of item.rows.slice(0, 4)) console.log(`     · ${row.id} ${row.message}`);
      if (!ok) {
        if (!okExpect) console.log(`     ✗ 期望与实际不符（期望 ${item.expect}，实际 ${red ? 'red' : 'green'}）`);
        if (!okHit) console.log('     ✗ 必须命中的那条违规没出现（眼睛是瞎的）');
        if (!okMiss) console.log('     ✗ 必须被跳过的产物文件被误报（跳过面失准）');
      }
    }
    console.log(`[check-boundaries] --selftest 结论：${failed === 0 ? '全部符合预期（门禁自带牙）' : `${failed} 条不符合预期`}`);
    return failed === 0 ? 0 : 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

