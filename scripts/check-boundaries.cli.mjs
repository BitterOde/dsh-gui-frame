/**
 * check-boundaries.cli.mjs —— 解耦门禁的**命令行面**（读数打印 + 判定 + JSON 输出）。
 *
 * 为什么单独成文件：入口要守住「非 src 面单文件 ≤600 行」——门禁不许违反自己要执行的判据。
 * 依赖注入（`analyze` / `violationsOf` / `runSelftest` 由入口传进来）刻意避免 import 入口而成环。
 */
import fs from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════════════════════
export function createCli({ analyze, violationsOf, runSelftest, LIMITS, DEFAULT_ROOT, CAPABILITY_EDGE_WHITELIST, TESTS_DUP_REASONS = [], familyFileKey = () => '' }) {
function printReading(reading) {
  const line = (label, value) => console.log(`  ${label}：${value}`);
  console.log('[check-boundaries] 读数（真源口径：docs/重构方案-2026-10-04.md §3）');
  line('扫描文件', `${reading.files.total}（src ${reading.files.src} / src/client ${reading.files.srcClient}）`);
  line('文件规模：src 超限', `${reading.m1.src.length} 个（上限 ${LIMITS.srcMaxLines}）`);
  line('文件规模：非 src 超限', `${reading.m1.nonSrc.length} 个（上限 ${LIMITS.nonSrcMaxLines}）`);
  line('文件规模：data 豁免失守', `${reading.m1.dataExemption.length}`);
  line('重复族：重复块', `${reading.m2.total}（全身面）／${reading.m2.planFace.total}（方案口径面，上限 ${LIMITS.dupTotalMax}）｜直方图 ${JSON.stringify(reading.m2.histogram)}`);
  line('重复族：≥3 次的族', `${reading.m2.repeatFamilies.length}（全身面）｜**生产面 ${reading.m2.productionFamilies.length}**（上限 ${LIMITS.dupRepeatFamilyMax}）｜**测试面 ${reading.m2.testsFamilies.length}**（登记基线 ${LIMITS.testsDupFamiliesMax}，只减不增）｜**理由表过期 ${reading.m2.staleTestsReasons.length}**（须 0，反尘味）／方案口径面 ${reading.m2.planFace.repeatFamilies.length}`);
  line('重复族：src 内部重复', `${reading.m2.srcInternal}（全身面）／${reading.m2.planFace.srcInternal}（方案口径面，上限 ${LIMITS.dupSrcInternalMax}）`);
  // ── 测试面 ≥3 族：**逐条**打印落点、条数与登记理由（口径原文要求「如实打印 + 每条一行理由」）──────
  for (const hits of reading.m2.testsFamilies) {
    const key = familyFileKey(hits);
    const row = TESTS_DUP_REASONS.find((item) => item.files.join(' | ') === key);
    const reason = row === undefined ? '**未登记**（判定模式会判红）' : `${row.reason} —— ${row.note}`;
    console.log(`  · [测试面 ≥3 族｜${hits.length} 处] ${key}`);
    console.log(`      理由：${reason}`);
    console.log(`      落点：${hits.join(' , ')}`);
  }
  line('死导出', `${reading.m3.dead.length}（上限 ${LIMITS.deadExportsMax}）｜命名空间导入 ${reading.m3.namespaceImports}`);
  line('模块环：src 环', `${reading.m4.srcCycles.length}（上限 ${LIMITS.srcCyclesMax}）｜全仓环 ${reading.m4.allCycles.length}｜自环 ${reading.m4.selfLoops.length}`);
  line('能力域直连', `${reading.m5.violations.length}（白名单 ${CAPABILITY_EDGE_WHITELIST.length} 条）｜域对读数 ${reading.m5.observed.join(' , ') || '（无）'}`);
  line('目录层数：src/client 最深', reading.m6.deepest[0] === undefined ? '（无）' : `${reading.m6.deepest[0].depth} 层：${reading.m6.deepest[0].file}`);
  line('测试直面', `直连模块 ${reading.m7.modules}（下限 ${LIMITS.testDirectModulesMin}）｜测试文件 ${reading.m7.files}（下限 ${LIMITS.testDirectFilesMin}）`);
  line('公开面', reading.m8.ok === null ? '（未跑）' : `${reading.m8.ok ? 'ok' : 'fail'}｜${reading.m8.reason}｜${reading.m8.bytes} 字节`);
  line('构建器禁令', `${reading.m9.length} 处`);
  line('SELF 域为 null 的文件', `${reading.selfCheck.nullDomain.length}（必须 0）`);
  line('SELF 未解析相对 import', `总 ${reading.selfCheck.unresolvedTotal}｜白名单 ${reading.selfCheck.unresolvedWhitelisted}｜未白名单 ${reading.selfCheck.unresolvedOpen.length}`);
}

function main(argv) {
  if (argv.includes('--selftest')) return runSelftest({ analyze, violationsOf });
  const printOnly = argv.includes('--print');
  const jsonIndex = argv.indexOf('--json');
  const reading = analyze({ root: DEFAULT_ROOT });
  if (jsonIndex >= 0) {
    const target = argv[jsonIndex + 1];
    if (target === undefined) {
      console.error('[check-boundaries] ✗ --json 需要一个输出路径');
      return 2;
    }
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(path.resolve(target), `${JSON.stringify(reading, null, 2)}\n`, 'utf8');
    console.log(`[check-boundaries] 读数已写入 ${target}`);
  }
  printReading(reading);
  const rows = violationsOf(reading);
  if (printOnly) {
    console.log(`[check-boundaries] --print：只打印不判定（当前有 ${rows.length} 条违规）`);
    return 0;
  }
  if (rows.length === 0) {
    console.log('[check-boundaries] ✔ 全部判据通过（九条判据 + 两条自检）');
    return 0;
  }
  console.error(`[check-boundaries] ✗ ${rows.length} 条违规：`);
  for (const row of rows) console.error(`  · [${row.id}] ${row.message}`);
  return 1;
}


  return { main, printReading };
}
