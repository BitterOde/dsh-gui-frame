#!/usr/bin/env node
/**
 * render-shot.mutation.mjs —— `render-shot.selftest.mjs` 的**反假绿轮**（离线、不起浏览器）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【它回答的问题】「这些判据是真的会红，还是恒真？」
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 一条判据只有"把**它指向的那行代码**改坏之后它确实翻红"才算有牙。只看自检全绿证明不了这件事：
 * 恒真的判据也全绿。所以本脚本做变异轮：
 *   ① 把 `tools/render-shot.mjs` / `tools/dsh-shot.mjs` / `tools/render-shot.selftest.mjs`
 *      **复制到系统临时目录**（**绝不改仓里的文件**）；
 *   ② 每次只改坏**一处**，在副本里重跑自检；
 *   ③ 要求「靶点判据由绿转红」，并把"顺带多红了谁"如实列出来（多红不一定是错，
 *      但必须被看见 —— 例如 3080 红线被摘掉时，单元判据 H4 与端到端退出码 H15 会一起红）。
 *
 * **它不起浏览器**：变异轮只跑自检（自检默认不启动浏览器），所以随时可跑、不抢真机资源。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【跑法】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   node tools/render-shot.mutation.mjs            # 全部变异，逐条打印，全抓得住 ⇒ exit 0
 *   node tools/render-shot.mutation.mjs --json     # 机器可读（stdout），人读文案走 stderr
 *
 * 退出码：0 = 每个靶点都被抓住｜1 = 有靶点没被抓住（判据无牙，或变异点已不存在）｜2 = 用法错误。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【副本里唯一"天然失败"的判据】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `S6` 断言"包目录以 `dsh-gui-frame` 结尾"。副本在系统临时目录里，这条**必然**失败 ——
 * 那是副本位置的产物，不是判据问题。本脚本把它单列为"位置相关"，不计入变异比较，
 * 也不假装它通过。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 参与变异的三个**入口**。复制面由 `collectSources()` 从这三个入口按**相对 import 递归收集**得到
 * —— 不再维护硬编码文件清单：工具面一旦按职责拆成多文件，硬编码清单会静默漏拷（副本缺模块 ⇒
 * `ERR_MODULE_NOT_FOUND`，看起来像"判据翻红"其实只是夹具漏带文件）。目录结构原样重建。
 */
export const MUTATION_ENTRIES = ['render-shot.mjs', 'dsh-shot.mjs', 'render-shot.selftest.mjs'];
/** 副本位置导致的"天然失败"：只记账，不当成变异结果。 */
export const LOCATION_DEPENDENT = { S6: '副本不在包目录里 ⇒ "包目录以 dsh-gui-frame 结尾"必然失败（副本位置的产物）' };

/** 从入口按相对 import 递归收集（相对说明符补 `.mjs` 与 `/index.mjs`，与 Node 的解析口径一致）。 */
export function collectSources(here = HERE) {
  const out = new Map();
  const seen = new Set();
  const resolveSpec = (rel, spec) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    for (const candidate of [base, `${base}.mjs`, `${base}/index.mjs`]) {
      if (existsSync(path.join(here, candidate))) return candidate;
    }
    return null;
  };
  const visit = (rel) => {
    if (rel === null || seen.has(rel)) return;
    seen.add(rel);
    const text = readFileSync(path.join(here, rel), 'utf8');
    out.set(rel, text);
    for (const match of text.matchAll(/\bfrom\s+'(\.[^']*)'/g)) visit(resolveSpec(rel, match[1]));
    for (const match of text.matchAll(/\bimport\s*\(\s*'(\.[^']*)'\s*\)/g)) visit(resolveSpec(rel, match[1]));
  };
  for (const entry of MUTATION_ENTRIES) visit(entry);
  return out;
}

/**
 * 变异表：每条 = 改坏一处**代码**（不是改文本），靶点一栏写明"这条变异该让哪条判据翻红"。
 * `from` 必须与源码逐字一致 —— 找不到就说明判据/源码已经漂了，脚本会报"变异点没找到"并判失败。
 */
export const MUTATIONS = [
  {
    id: 'M1-clip-short-circuit',
    file: 'render-shot/plan.mjs',
    from: '  if (clip !== null) {',
    to: '  if (false && clip !== null) {',
    target: 'H10',
    note: '裁剪分支被短路 ⇒ clip 被忽略，产物会是整视口而不是元素框',
  },
  {
    id: 'M2-png-size-noop',
    file: 'render-shot/png.mjs',
    from: '    const delta = Math.abs(size[key] - want);',
    to: '    const delta = 0;',
    target: 'H14',
    note: '产物尺寸核对被废掉（永远"相符"）⇒ "有图、内容不对"的假绿回来',
  },
  {
    id: 'M3-live-port-guard-removed',
    file: 'render-shot/inputs.mjs',
    from: '    const url = assertNotLiveGuiUrl(raw);',
    to: '    const url = raw;',
    target: 'H4',
    note: '3080 红线被摘掉 ⇒ 指向用户正在用的 GUI 也能跑',
  },
  {
    id: 'M4-anchor-timeout-silent',
    file: 'render-shot/asserts.mjs',
    from: '  if (!(probe.count > 0)) {',
    to: '  if (false) {',
    target: 'H5',
    note: '等锚点超时不再报错 ⇒ 选择器不存在也照样出一张图',
  },
  {
    id: 'M5-profile-whitelist-wide-open',
    file: 'dsh-shot/env.mjs',
    from: 'export const OWN_PROFILE_RE = /^guifshot[0-9a-z]+$/i;',
    to: 'export const OWN_PROFILE_RE = /.*/;',
    target: 'S7',
    note: '临时 profile 白名单放宽成"什么都删"',
  },
  {
    id: 'M6-kill-by-image-name',
    file: 'dsh-shot/instance.mjs',
    from: "  spawnSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });",
    to: "  spawnSync('taskkill', ['/IM', 'msedge.exe', '/F'], { stdio: 'ignore', windowsHide: true });",
    target: 'S2',
    note: '回收改成按进程名批量杀（正是明令禁止的那件事）',
  },
  {
    id: 'M7-click-field-not-normalized',
    file: 'render-shot/render.mjs',
    from: '    click: source.click ?? null,',
    to: '    click: source.click,',
    target: 'H16',
    note: '缺省字段不再归成 null ⇒ 只给一半字段的调用会去点一个 undefined 选择器',
  },
];

/** 从自检输出里抠出 PASS/FAIL 明细。 */
export function parseSelfTestOutput(text) {
  const fails = [...String(text).matchAll(/^\[selftest\] FAIL (\S+)/gm)].map((match) => match[1]);
  const total = /合计：PASS (\d+)｜FAIL (\d+)｜SKIP (\d+)/.exec(String(text));
  return { fails, totals: total === null ? null : { pass: Number(total[1]), fail: Number(total[2]), skip: Number(total[3]) } };
}

function runSelfTest(dir) {
  const result = spawnSync(process.execPath, [path.join(dir, 'render-shot.selftest.mjs')], { encoding: 'utf8' });
  const parsed = parseSelfTestOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return { status: result.status, ...parsed };
}

function writeCopies(dir, sources, file, replacement) {
  for (const [name, text] of sources) {
    const content = file !== null && name === file ? text.replace(replacement.from, replacement.to) : text;
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
}

async function main(argv) {
  const json = argv.includes('--json');
  for (const arg of argv) {
    if (arg !== '--json') {
      process.stderr.write(`[mutation] 用法错误：未知参数 ${arg}\n用法：node tools/render-shot.mutation.mjs [--json]\n`);
      return 2;
    }
  }
  const sources = collectSources();

  const log = (line) => (json ? process.stderr.write(`${line}\n`) : process.stdout.write(`${line}\n`));
  const root = mkdtempSync(path.join(tmpdir(), 'guif-shot-mutation-'));
  log(`[mutation] 副本根目录（跑完自动删）：${root}`);
  log('[mutation] 纪律：只在副本里变异，仓里的文件一个字节都不动；全程不起浏览器。');

  const baselineDir = path.join(root, 'baseline');
  writeCopies(baselineDir, sources, null, { from: '', to: '' });
  const baseline = runSelfTest(baselineDir);
  const tolerated = baseline.fails.filter((id) => id in LOCATION_DEPENDENT);
  const unexpected = baseline.fails.filter((id) => !(id in LOCATION_DEPENDENT));
  log(
    `[mutation] 基线（副本，未变异）：exit=${baseline.status} PASS/FAIL/SKIP=` +
      `${baseline.totals === null ? '?' : `${baseline.totals.pass}/${baseline.totals.fail}/${baseline.totals.skip}`}` +
      `｜位置相关失败=${tolerated.join('、') || '无'}${unexpected.length > 0 ? `｜**意外失败**=${unexpected.join('、')}` : ''}`,
  );
  for (const id of tolerated) log(`[mutation]   位置相关：${id} —— ${LOCATION_DEPENDENT[id]}`);

  const rows = [];
  let allCaught = true;
  for (const mutation of MUTATIONS) {
    const source = sources.get(mutation.file);
    if (typeof source !== 'string' || !source.includes(mutation.from)) {
      rows.push({ ...mutation, caught: false, reason: '变异点没找到（源码已漂，判据失去靶子）', fresh: [], extra: [] });
      allCaught = false;
      log(`[mutation] ${mutation.id} ✗ 变异点没找到（判据失去靶子）：${mutation.from}`);
      continue;
    }
    const dir = path.join(root, mutation.id);
    writeCopies(dir, sources, mutation.file, { from: mutation.from, to: mutation.to });
    const result = runSelfTest(dir);
    const fresh = result.fails.filter((id) => !(id in LOCATION_DEPENDENT) && !baseline.fails.includes(id));
    const caught = fresh.includes(mutation.target);
    const extra = fresh.filter((id) => id !== mutation.target);
    allCaught = allCaught && caught;
    rows.push({ ...mutation, caught, status: result.status, fresh, extra, totals: result.totals });
    log(
      `[mutation] ${mutation.id} ${caught ? '✔ 靶点翻红' : '✗ 靶点没红'} ${mutation.target}` +
        `｜新红=${fresh.join('、') || '无'}｜多红=${extra.join('、') || '无'}｜exit=${result.status}`,
    );
    log(`[mutation]        变异：${mutation.note}`);
  }

  log(
    `[mutation] 结论：${allCaught ? `${MUTATIONS.length}/${MUTATIONS.length} 个靶点都被自检抓住（判据有牙）` : '有靶点没被抓住（判据无牙或靶子已漂）'}`,
  );
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    log(`[mutation] ⚠ 副本目录没删干净（不影响结论）：${root}`);
  }
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: allCaught,
        baseline: { status: baseline.status, totals: baseline.totals, fails: baseline.fails, tolerated, unexpected },
        mutations: rows.map((row) => ({
          id: row.id,
          file: row.file,
          target: row.target,
          caught: row.caught,
          fresh: row.fresh,
          extra: row.extra,
          note: row.note,
        })),
      })}\n`,
    );
  }
  return allCaught ? 0 : 1;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
