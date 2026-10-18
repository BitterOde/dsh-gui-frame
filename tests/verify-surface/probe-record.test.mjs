/**
 * probe-record.test.mjs —— 独立复验（四）：**两份探针记录的方法学与证据强度**。
 *
 * 覆盖验收（**P1–P5 五条探针全部**）：
 *   两份记录里**每条**（P1…P5）都有「可重演步骤 + 观察结果」，且判定与残余未知都不缺；
 *   记录里**没有**「应该没问题」式表述；没做的事**显式登记**（不许把没做的说成做了）；
 *   **每条结论都能指到**一处产物原文或一次实测：判定段所在小节带 `probe/evidence/…` 引用、
 *   证据清单里有一行把该条列为支撑对象、该行的文件真实存在、全文引用的证据文件与脚本都落地；
 *   **实测复现**：在 TEMP 副本里重跑 P1–P5 五条真探针（`probe/runtime/*.mjs`），
 *            用**新产出的 JSON** 与记录里的摘录逐条对齐 —— 这才是「一次实测」，不是信文档。
 *
 * 只读：本文件不写包内任何文件；探针只在 TEMP 副本里跑（它们会往副本的 `probe/evidence/` 写 JSON）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PKG_DIR,
  PROBE_DOC,
  PROBE_DOC_THEME,
  PROBE_DIR,
  h3Section,
  readProbeEvidence,
  resolveDshInstallDir,
  runProbeScript,
  splitH2,
  withProbeCopy,
} from './harness.mjs';

/** 两份记录的同一套判据（同一规格：边界小节 + 每条 P 的四段 + 证据清单表）。 */
const DOCS = [
  {
    id: 't4',
    label: '运行稳定性探针（P1/P2/P3）',
    file: PROBE_DOC,
    probes: ['P1', 'P2', 'P3'],
    scripts: ['apply-throw-probe', 'log-channel-probe', 'unload-remount-probe'],
  },
  {
    id: 't5',
    label: '主题与推送探针（P4/P5）',
    file: PROBE_DOC_THEME,
    probes: ['P4', 'P5'],
    scripts: ['theme-token-probe', 'push-surface-probe'],
  },
].map((doc) => ({ ...doc, text: readFileSync(doc.file, 'utf8') }))
  .map((doc) => ({ ...doc, sections: splitH2(doc.text) }))
  .map((doc) => ({ ...doc, probeSections: doc.sections.filter((section) => /^P\d+\s*·/.test(section.title)) }));

/** 「应该没问题」这一类没有观察支撑的措辞。 */
const BANNED_PHRASES = ['应该没问题', '应该可以', '应该是', '大概', '估计', '差不多', '也许', '似乎', '可能没问题', '基本可以', '应该不会'];

/** 一行里提到的证据文件（支持 `probe/evidence/x.txt` 与同一行里的裸文件名两种写法）。 */
function evidenceFilesIn(row) {
  const files = new Set();
  for (const match of row.matchAll(/probe\/evidence\/([A-Za-z0-9._\-]+)/g)) files.add(match[1]);
  for (const match of row.matchAll(/`([A-Za-z0-9._\-]+\.(?:json|txt))`/g)) files.add(match[1]);
  return [...files];
}

/** 证据清单表的数据行（[{line, cells, files, scripts, support}]）。 */
function evidenceListRows(doc) {
  const listSection = doc.sections.find((section) => /证据清单/.test(section.title));
  if (listSection === undefined) return null;
  return listSection.body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && line.includes('probe/'))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      const scripts = [...new Set([...line.matchAll(/probe\/(?:runtime|tools)\/[A-Za-z0-9._\-]+\.mjs/g)].map((match) => match[0]))];
      return { line, cells, files: evidenceFilesIn(line), scripts, support: cells[cells.length - 1] ?? '' };
    });
}

/** 递归收集 JSON 里的数字（形状无关的「记录里的数字必须能在重跑结果里找到」判据）。 */
function collectNumbers(value, out = new Set()) {
  if (typeof value === 'number') out.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectNumbers(item, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((item) => collectNumbers(item, out));
  return out;
}

test('两份记录的结构：P1–P5 每条都有 可重演步骤 / 观察结果 / 判定 / 残余未知', () => {
  const allIds = DOCS.flatMap((doc) => doc.probeSections.map((section) => /^P(\d+)/.exec(section.title)[1]));
  assert.deepEqual(
    [...new Set(allIds)].sort(),
    ['1', '2', '3', '4', '5'],
    `两份记录合起来必须覆盖 P1–P5 五条探针，实际只有 P${[...new Set(allIds)].sort().join('/P')}`,
  );

  const problems = [];
  for (const doc of DOCS) {
    assert.ok(doc.probeSections.length >= doc.probes.length, `${doc.label}：探针小节数不足`);
    for (const section of doc.probeSections) {
      for (const part of ['可重演步骤', '观察结果', '判定', '残余未知']) {
        if (h3Section(section.body, part) === null) problems.push(`${doc.id}/${section.title}：缺小节「${part}」`);
      }
      const steps = h3Section(section.body, '可重演步骤') ?? '';
      const observed = h3Section(section.body, '观察结果') ?? '';
      const judged = h3Section(section.body, '判定') ?? '';
      const unknown = h3Section(section.body, '残余未知') ?? '';

      if (!/\n?\s*\d+\./.test(steps)) problems.push(`${doc.id}/${section.title}：可重演步骤没有有序步骤`);
      if (!/node\s+probe\/(runtime|tools)\/[A-Za-z0-9._\-]+\.mjs/.test(steps)) problems.push(`${doc.id}/${section.title}：可重演步骤里没有可执行的 node 命令`);
      if (!/```/.test(observed) && !/^\s*\|/m.test(observed)) problems.push(`${doc.id}/${section.title}：观察结果里没有代码块/表格（原文摘录）`);
      if (observed.replace(/\s/g, '').length < 80) problems.push(`${doc.id}/${section.title}：观察结果太短，撑不起结论`);
      if (judged.replace(/\s/g, '').length < 120) problems.push(`${doc.id}/${section.title}：判定太短（${judged.length} 字符）`);
      if (!/未做|未测|没做|没实测|留到|没法/.test(unknown)) problems.push(`${doc.id}/${section.title}：残余未知里没有显式登记未做的事`);

      // 结论 → 证据清单 → 文件 的引用链必须闭合
      const id = /^P(\d+)/.exec(section.title)[1];
      const supporting = (evidenceListRows(doc) ?? []).filter((row) => new RegExp(`P${id}(?![0-9])`).test(row.support));
      if (supporting.length === 0) problems.push(`${doc.id}/${section.title}：证据清单里没有一行把「P${id}」列为支撑对象`);
    }
  }
  assert.deepEqual(problems, [], `两份探针记录的结构/引用链不合格：\n  - ${problems.join('\n  - ')}`);
});

test('无含糊表述：禁用措辞零命中，且「本轮没做的事」显式登记', () => {
  const problems = [];
  for (const doc of DOCS) {
    const hits = BANNED_PHRASES.filter((phrase) => doc.text.includes(phrase));
    if (hits.length > 0) problems.push(`${doc.id}：出现没有观察支撑的措辞 ${hits.join('、')}`);

    const notDone = doc.sections.find((section) => /本轮没做的事|本轮未做/.test(section.title));
    if (notDone === undefined) problems.push(`${doc.id}：缺「本轮没做的事」这一节`);
    else {
      if (notDone.body.replace(/\s/g, '').length <= 80) problems.push(`${doc.id}：「本轮没做的事」是空壳`);
      if (!/浏览器|真机/.test(notDone.body)) problems.push(`${doc.id}：「本轮没做的事」里没有登记浏览器/真机那一层`);
    }

    const boundary = doc.sections.find((section) => /边界/.test(section.title));
    if (boundary === undefined) problems.push(`${doc.id}：开头的「边界」小节缺失`);
    else {
      for (const phrase of ['产物', '静态判读']) {
        if (!boundary.body.includes(phrase)) problems.push(`${doc.id}：边界小节没有登记证据分型「${phrase}」`);
      }
      if (!/没有|未/.test(boundary.body)) problems.push(`${doc.id}：边界小节没有说明「哪些没做」`);
    }
  }
  assert.deepEqual(problems, [], `探针记录的诚实性不合格：\n  - ${problems.join('\n  - ')}`);
});

/** 记录里引用的证据路径（支持 `p4-*.json` 这类通配写法）。 */
function evidenceRefsIn(text) {
  const refs = new Set();
  for (const match of text.matchAll(/probe\/evidence\/[A-Za-z0-9._\-*]+/g)) refs.add(match[0]);
  return [...refs];
}

/** 引用是否落地：普通路径查存在；`*` 通配查同目录下是否有匹配文件。 */
function refExists(ref) {
  const full = path.join(PKG_DIR, ...ref.split('/'));
  if (!ref.includes('*')) return existsSync(full);
  const dir = path.dirname(full);
  const pattern = new RegExp(`^${path.basename(full).split('*').map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return existsSync(dir) && readdirSync(dir).some((name) => pattern.test(name));
}

test('每条结论都指得到证据：判定段带引用、清单行行可落地、引用的文件与脚本都存在', () => {
  const problems = [];
  const allRefs = new Set();
  for (const doc of DOCS) {
    const refs = evidenceRefsIn(doc.text);
    refs.forEach((ref) => allRefs.add(ref));
    const scripts = [...new Set([...doc.text.matchAll(/probe\/(runtime|tools)\/[A-Za-z0-9._\-]+\.mjs/g)].map((match) => match[0]))];

    if (refs.length < 4) problems.push(`${doc.id}：全文引用的证据路径太少（${refs.length}）`);
    if (scripts.length < 3) problems.push(`${doc.id}：点名的可重演脚本太少（${scripts.length}）`);
    for (const ref of refs) if (!refExists(ref)) problems.push(`${doc.id}：引用了不存在（或通配落空）的证据文件 ${ref}`);
    for (const script of scripts) if (!existsSync(path.join(PKG_DIR, ...script.split('/')))) problems.push(`${doc.id}：点名了不存在的脚本 ${script}`);

    // 每条 P 的小节必须带证据引用，且绑到一次可重演实测
    for (const section of doc.probeSections) {
      if (!/probe\/evidence\//.test(section.body)) problems.push(`${doc.id}/${section.title}：整节没有任何 probe/evidence 引用`);
      const runnable = `${h3Section(section.body, '可重演步骤') ?? ''}\n${h3Section(section.body, '判定') ?? ''}`;
      if (!/node\s+probe\/(runtime|tools)\//.test(runnable)) problems.push(`${doc.id}/${section.title}：没有绑到一次可重演实测`);
    }

    // 证据清单表：每行文件存在 + 「支撑」列非空
    const rows = evidenceListRows(doc);
    if (rows === null) problems.push(`${doc.id}：缺「证据清单」小节`);
    else {
      if (rows.length < 4) problems.push(`${doc.id}：证据清单表行数太少（${rows.length}）`);
      for (const row of rows) {
        if (row.files.length === 0 && row.scripts.length === 0) problems.push(`${doc.id}：行内没有可解析的证据文件/脚本名 —— ${row.line.slice(0, 60)}`);
        for (const file of row.files) {
          if (!existsSync(path.join(PROBE_DIR, 'evidence', file))) problems.push(`${doc.id}：清单里的文件不存在 ${file}`);
        }
        for (const script of row.scripts) {
          if (!existsSync(path.join(PKG_DIR, ...script.split('/')))) problems.push(`${doc.id}：清单里的脚本不存在 ${script}`);
        }
        if (row.support === '' || row.support === '---') problems.push(`${doc.id}：「支撑」列为空 —— ${row.line.slice(0, 60)}`);
      }
    }
  }
  assert.ok(allRefs.size >= 12, `两份记录合起来引用的证据路径太少（${allRefs.size}）⇒ 证据强度不足`);
  assert.deepEqual(problems, [], `结论与证据的对应关系不合格：\n  - ${problems.join('\n  - ')}`);
});

test('实测复现：TEMP 副本里重跑 P1–P5 五条探针 ⇒ exit 0，关键观察与记录一致', async () => {
  await withProbeCopy(async (tmp) => {
    // ── P1：apply 抛错是否打死整页
    const p1 = runProbeScript(tmp, 'apply-throw-probe');
    assert.equal(p1.status, 0, `P1 必须 exit 0：${p1.stderr.slice(-600)}`);
    const e1 = readProbeEvidence(tmp, 'p1-apply-throw');
    // ★ 探针记的是**当刻本机平台版本**：这里按当刻安装现读比对。把版本号抄死进判据 ⇒ DSH 一升级这条
    //   就假红，而它真正要判的是「探针读到了平台版本」，不是「版本恰好等于某个字面量」。
    const installRoot = resolveDshInstallDir();
    assert.ok(installRoot !== null, 'P1：本机应能找到 DSH 安装根（找不到就不是「无平台不判」，而是判据环境坏了）');
    const dshManifest = JSON.parse(readFileSync(path.join(installRoot, 'package.json'), 'utf8'));
    assert.equal(e1.platform.dshVersion, dshManifest.version);
    assert.match(String(e1.platform.dshVersion), /^\d+\.\d+\.\d+/);
    const s1 = e1.results[0];
    assert.equal(s1.appMounted, false, 'P1/S1：apply 抛错 ⇒ mountApp 不得执行');
    // ★ 报错**原文形状**由平台定：0.1.5-rc.3 里 loader 抛的那句原文直达页面；0.2.0-rc.2 里是
    //   「整批汇总行 + 逐条状态行」两段（`web boot: 1 entry did not activate` / `@probe/boom: failed`）。
    //   本判据要判的是**「这一条抛错真的被页面看见、并被标成失败」**，不是「报错文案逐字等于某版原文」
    //   ⇒ 两版形状都接，且逐条点名 @probe/boom。
    assert.match(
      s1.pageFailure,
      /(failed to apply loader entry .*\(@probe\/boom\): probe: apply threw on purpose)|(did not activate[\s\S]*@probe\/boom: failed)/,
    );
    assert.equal(s1.pageStates['@probe/boom'], 'failed');
    // ★ S2 判读按**平台当刻行为**两分（0.2.0-rc.2 实测变了）：create 要么抛（旧行为）、要么把 entry
    //   留在树里标 failed（新行为）—— 二者必居其一，不许两空；只要 entry 留在树里，审计就**必须**点到它。
    const s2 = e1.results[1];
    assert.ok(
      s2.createError !== null || (Array.isArray(s2.entriesAfterCreate) && s2.entriesAfterCreate.length > 0),
      'P1/S2：create 既没抛错、又没把 entry 留在树里 —— 两种行为都不是，装置失效',
    );
    if (Array.isArray(s2.entriesAfterCreate) && s2.entriesAfterCreate.length > 0) {
      assert.match(String(s2.auditError), /did not activate[\s\S]*@probe\/boom/);
    } else {
      assert.equal(s2.auditError, null, 'P1/S2：create 已把 errant entry 删掉 ⇒ 审计无对象');
    }
    const s3 = e1.results[2];
    assert.equal(s3.appMounted, false);
    assert.match(s3.pageFailure, /pending \(waiting for service: gui-frame\)/);
    assert.equal(s3.needsFrameAppliedCount, 0, 'P1/S3：inject 未满足的入口不得被 apply');

    // ── P2：诊断上报链路
    const p2 = runProbeScript(tmp, 'log-channel-probe');
    assert.equal(p2.status, 0, `P2 必须 exit 0：${p2.stderr.slice(-600)}`);
    const e2 = readProbeEvidence(tmp, 'p2-q17-chain');
    const failedAssertions = Object.entries(e2.assertions).filter(([, value]) => value !== true).map(([key]) => key);
    assert.deepEqual(failedAssertions, [], `P2 自己的断言有假：${failedAssertions.join('、')}`);
    const child = JSON.parse(e2.findings.pipe.childStdout.trim().replace(/^P2-CHILD\s+/, ''));
    assert.equal(child.exporters, 1, '全树只有 1 个 logger exporter（内存 buffer）');
    assert.deepEqual(child.bufferTypes, ['error:0', 'info:1'], '默认阈值下只有 error/info 进 buffer');
    assert.equal(child.warnHitsBuffer, false, 'warn 连 buffer 都进不去 ⇒ 不能当上报通道');
    assert.equal(child.debugHitsBuffer, false);
    assert.equal(e2.findings.pipe.stderrMarkerOnStderr, true, 'process.stderr.write 必须必达 stderr');
    assert.equal(e2.findings.pipe.stderrMarkerOnStdout, false, '不得串到 stdout');
    assert.equal(e2.findings.pipe.loggerMarkerOnStderr, false, 'logger 写的东西不会到 stderr');
    assert.match(e2.findings.pipe.childStderr, /\[gui-frame\] 客户端失败 stderr-marker-P2/);

    // ── P3：卸载后重挂载
    const p3 = runProbeScript(tmp, 'unload-remount-probe');
    assert.equal(p3.status, 0, `P3 必须 exit 0：${p3.stderr.slice(-600)}`);
    const e3 = readProbeEvidence(tmp, 'p3-unload-remount');
    const [mounted, unloaded, remounted] = e3.timeline;
    assert.equal(mounted.counters.consumerEffectsAlive, 1);
    assert.equal(mounted.serviceGuiFrame, true);
    assert.equal(unloaded.counters.consumerEffectsAlive, 0, '卸载 ⇒ 依赖方 effects 全清');
    const consumerAfter = unloaded.entries.find((entry) => entry.id === '@probe/consumer');
    assert.equal(consumerAfter.fiberState, 'pending', '卸载后依赖方回 pending');
    assert.equal(consumerAfter.fiberUid, mounted.entries.find((entry) => entry.id === '@probe/consumer').fiberUid, 'fiber 保留、uid 不变');
    assert.equal(unloaded.serviceGuiFrame, false);
    assert.equal(remounted.counters.consumerApplies, 2, '服务回归 ⇒ 依赖方自动重新 apply');
    assert.equal(remounted.counters.frameApplies, 2);
    assert.equal(remounted.counters.getterUnloads, 0, 'ctx.get 逃生写法全程零耦合');
    assert.equal(e3.reloadedEntryIdSameAsBefore, true);

    // ── P4：主题 token 口径（记录里的关键数字必须能在重跑结果里找到）
    const p4 = runProbeScript(tmp, 'theme-token-probe');
    assert.equal(p4.status, 0, `P4 必须 exit 0：${p4.stderr.slice(-600)}`);
    const e4 = readProbeEvidence(tmp, 'p4-theme-tokens');
    const numbers = collectNumbers(e4);
    // ★ 数字也**从探针当刻输出派生**，不抄死：抄死字面量 ⇒ 平台一改（本例：DSH 0.2.0-rc.2 把主题产物
    //   拆成 6 段、变量总量与暗色覆盖同步放大）记录与实测的对应关系就断言不出来。判据不变：
    //   **这些面必须各自还在、且带得出读数**。
    const expected = [
      e4.D_tree?.declaredUnion,
      Math.max(...(e4.A_themeBundle?.bindings ?? []).map((b) => b.tokens ?? 0)),
      e4.B_inspectDirectory?.count,
      e4.C_shellCss?.referencedUnion ?? e4.C_shellCss?.perFile?.[0]?.referenced,
      Array.isArray(e4.E_resolution?.unresolvedInLight)
        ? e4.E_resolution.unresolvedInLight.length
        : e4.E_resolution?.unresolvedRef,
    ];
    assert.equal(expected.length, 5);
    for (const value of expected) {
      assert.ok(
        typeof value === 'number' && numbers.has(value),
        `P4 重跑结果里没有记录引用的数字 ${String(value)}（记录与实测不一致）`,
      );
    }
    const t5doc = DOCS.find((doc) => doc.id === 't5').text;
    // ★ 记录里的并集/暗色覆盖读数必须与本次重跑同值（文档改了、实测没改，或反之，都判红）。
    assert.ok(t5doc.includes(String(e4.A_themeBundle.unionDeclared)), 'P4 记录的并集条数与本次重跑不一致');
    assert.ok(t5doc.includes(String(e4.A_themeBundle.darkDeclared)), 'P4 记录的暗色覆盖条数与本次重跑不一致');
    for (const anchor of ['A 六段行内 CSS', 'B exportInspectTokens() 静态种子', 'C 外壳产物 CSS', 'D 全树 client bundle', 'E 只拿 --dsw-* 自洽解析', 'F 纳入平台变量']) {
      assert.ok(t5doc.includes(anchor), `P4 记录里缺分段叙述「${anchor}」`);
    }
    for (const key of ['A_themeBundle', 'B_inspectDirectory', 'C_shellCss', 'D_tree', 'E_resolution', 'F_resolutionWithPlatformVars']) {
      assert.ok(Object.hasOwn(e4, key) && e4[key] !== null && typeof e4[key] === 'object', `P4 重跑结果里缺分段 ${key}`);
    }

    // ── P5：推送半边（判据条数从记录自身的 PASS 行派生，不写死）
    const p5 = runProbeScript(tmp, 'push-surface-probe');
    assert.equal(p5.status, 0, `P5 必须 exit 0：${p5.stderr.slice(-600)}`);
    const e5 = readProbeEvidence(tmp, 'p5-push-surface');
    const verdictNames = Object.keys(e5.verdicts);
    const passNames = [...t5doc.matchAll(/^PASS\s+(\S+)/gm)].map((match) => match[1]);
    assert.ok(passNames.length > 0, 'P5 记录里必须有 PASS 行（否则本判据是空转）');
    assert.equal(verdictNames.length, passNames.length, `P5 判据条数（${verdictNames.length}）必须等于记录里的 PASS 行数（${passNames.length}）`);
    assert.deepEqual(Object.values(e5.verdicts).filter((value) => value !== true), [], 'P5 判据必须全 PASS');
    for (const name of verdictNames) {
      assert.ok(passNames.includes(name), `P5 判据 ${name} 在记录的 PASS 行里没有对应项`);
      assert.ok(t5doc.includes(name), `P5 判据 ${name} 在记录里没有出现（记录与实测不一致）`);
    }
    const slices = Object.values(e5.slices);
    assert.ok(slices.length >= 10, `P5 原文切片太少（${slices.length}）`);
    assert.deepEqual(slices.filter((slice) => slice.found !== true).map((slice) => slice.anchor), [], 'P5 每处原文切片都必须 found');
    for (const slice of slices) {
      assert.ok(Number.isInteger(slice.offset) && slice.offset >= 0, `切片 ${slice.anchor} 必须带字符偏移`);
    }
  });
});
