// real-machine/lib/report.mjs —— 由 run.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 判据收集与报告：check / 有牙对照范围闸 / 最终报告；另含页面可交互前置判据

import { LINK_SPEC, MUTATION, profileName, raw } from './config.mjs';
import { mutationReadings } from './mutations.mjs';
import path from 'node:path';

export const MUTATION_TARGETS = {
  'dock-action': ['dock-panel-actions'],
  'dialog-inside': ['overlay-inside-entry', 'overlay-two-layers', 'overlay-esc-top'],
  'layout-overwrite': ['corrupt-action-result', 'corrupt-file-rebuilt'],
  'layout-path': ['corrupt-no-write-before', 'corrupt-file-rebuilt'],
};

/**
 * **兜底回收**：万一收尾里某一步抛错，退出时也把**自己造的**隔离 home 删掉。
 * 为什么加：实测踩过一次 —— 收尾里抛错后 `guif-dsh-<stamp>` 留在了 TEMP（人工回收掉的）。
 * 只删自己造的那个（`ownedHome` 为真且没给 `--keep`）；外部用 `--dsh-home=<路径>` 指过来的**绝不删**。
 */
export const checks = [];
export function check(id, title, ok, detail = '', options = {}) {
  const row = {
    id,
    title,
    ok: ok === true,
    detail,
    manual: options.manual === true,
    expected: options.expected === true,
    // **未取真机证**（第四类）：判据本身没法在本机被走到（前置不可达）⇒ 它既不是 pass
    // 也不是「红」，更不能静默跳过。口径与「留人工」「预期」一致：**不算硬失败**，但在汇总、
    // 报告与命令行里**单独计数并写明原因**（本项目头号教训是「替身绿当真实绿」，所以这里绝不含糊）。
    notEvidence: options.notEvidence === true,
    reason: options.reason ?? null,
  };
  checks.push(row);
  const label = row.ok ? 'PASS' : (row.manual ? '人工' : (row.expected ? '预期' : (row.notEvidence ? '未证' : 'FAIL')));
  console.log(`  [${label}] ${id} ${title}${detail === '' ? '' : `\n         -> ${detail}`}`);
  return row;
}
export function reportMutationScope() {
  const hard = checks.filter((row) => row.ok !== true && row.manual !== true && row.expected !== true && row.notEvidence !== true);
  const ids = hard.map((row) => row.id);
  console.log('');
  console.log(`── 变异范围读数（mutation=${MUTATION}）──`);
  console.log(`  本轮各判据：${checks.map((row) => `${row.id}=${row.ok === true ? 'pass' : (row.manual ? '留人工' : (row.expected ? '预期' : 'FAIL'))}`).join(' ')}`);
  console.log(`  硬失败 ${hard.length} 条：${ids.length === 0 ? '（无）' : ids.join(', ')}`);
  for (const line of mutationReadings()) console.log(line);

  const target = MUTATION_TARGETS[MUTATION] ?? null;
  if (target === null) {
    console.log(`  （本条变异没登记靶点集 ⇒ 只作读数、不设闸；登记过的有：${Object.keys(MUTATION_TARGETS).join(' / ')}）`);
    return;
  }
  const unexpected = ids.filter((id) => !target.includes(id));
  const missed = target.filter((id) => !ids.includes(id));
  // 靶点判据自己就「未取真机证」时，这条变异**在本机无法证明有牙** —— 这是读数，不是「装置失效」。
  // 如实记成「未证」而不是红：把不可证说成「没抓住」会把一个前置缺口误报成装置缺陷。
  const notEvidenceIds = checks.filter((row) => row.notEvidence === true).map((row) => row.id);
  if (target.every((id) => notEvidenceIds.includes(id))) {
    // 理由**按当轮实读**取（优先用坏载荷段自己记下的那条），别照抄「宿主从未注册」那段历史结论。
    const reason = raw.corrupt?.notEvidenceReason ?? `靶点 ${target.join('/')} 在当轮全部「未取真机证」`;
    check(
      'mutation-target-set',
      `有牙范围闸（mutation=${MUTATION}）：靶点 ${target.join('/')} 在真机上**不可证**（前置缺口未修前，这条变异证明不了什么）`,
      false,
      `靶点判据全部「未取真机证」⇒ 本轮的红/绿不能当作有牙证据。原因：${reason}`,
      { notEvidence: true, reason },
    );
    return;
  }
  check(
    'mutation-target-set',
    `有牙范围闸（mutation=${MUTATION}）：靶点 ${target.join('/')} 必须判红，且**其余判据一条都不受牵连**（多红/少红都记账）`,
    unexpected.length === 0 && missed.length === 0,
    `硬失败=${JSON.stringify(ids)}｜靶点=${JSON.stringify(target)}｜未预期判红=${JSON.stringify(unexpected.length === 0 ? '（无）' : unexpected)}｜靶点未翻转=${JSON.stringify(missed.length === 0 ? '（无）' : missed)}`,
  );
}

/** 逐条变异的**实测读数**（变异前后各判据 pass/fail 那一半）。返回要打印的行。 */
export function checkShellModalPrereq(pass, { id = 'shell-modal-cleared', suffix = '' } = {}) {
  const before = pass.shellModal?.before ?? null;
  const after = pass.shellModal?.after ?? null;
  const afterOpen = pass.shellModalAfterOpen ?? null;
  const top = (row) => (row === null || row === undefined ? '?' : `${row.topTag ?? '?'}.${String(row.topClass ?? '').slice(0, 40)}`);
  check(
    id,
    `页面可交互前置（环境）${suffix}：外壳自己的模态遮罩已清掉、本包面板可达（临时 home 无 API Key 时外壳会弹「添加一个 API Key」的必答 Dialog + 全屏 mask；装置先处置、再取证）`,
    afterOpen !== null && afterOpen !== undefined && afterOpen.blocked !== true && afterOpen.ours === true,
    `处置前：探针点=${JSON.stringify(before?.point ?? null)} 最上层=${top(before)} 属于本包=${before?.ours ?? '?'} 遮罩在场=${before?.maskPresent ?? '?'}（${before?.maskCount ?? '?'} 个）｜`
      + `处置=${JSON.stringify(pass.shellModal?.steps ?? [])}（via=${pass.shellModal?.via ?? '无需/未清掉'}）｜`
      + `处置后：遮罩在场=${after?.maskPresent ?? '?'} 属于本包=${after?.ours ?? '?'}｜`
      + `开面板后再确认：最上层=${top(afterOpen)} 属于本包=${afterOpen?.ours ?? '?'} 被挡=${afterOpen?.blocked ?? '?'}｜`
      + `外壳模态正文=${JSON.stringify(String(before?.dialogText ?? '').slice(0, 160))}`,
  );
}
export function renderReport({ rows, mutation, hard, profileName: profile, pid3080Before, pid3080After }) {
  const lines = [
    '# 真机验收报告（`verify/real-machine`）',
    '',
    `- 时间：${new Date().toISOString()}｜模式：${mutation === 'none' ? '常规两态' : `有牙对照 mutation=${mutation}`}`,
    `- 临时 profile：\`${profile}\`（从出厂模板建成）｜link：\`${LINK_SPEC}\``,
    `- 3080 PID：前 ${pid3080Before ?? '?'} → 后 ${pid3080After ?? '?'}（必须相同）`,
    `- 结论：**硬失败 ${hard.length} 条** / 判据 ${rows.length} 条`,
    '',
    '## 判据逐条',
    '',
    '| id | 判据 | 结果 | 实测 |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const verdict = row.ok === true ? 'pass' : (row.manual ? '留人工' : (row.expected ? '预期' : (row.notEvidence ? '**未取真机证**' : '**FAIL**')));
    lines.push(`| ${row.id} | ${row.title} | ${verdict} | ${String(row.detail).replace(/\|/g, '\\|')} |`);
  }
  lines.push(
    '',
    '## 原始证据',
    '',
    '- `raw.json`：页面快照、console 分类账、浮层与诊断通道明细、profile 与进程账',
    '- `control-server.log` / `install-server.log`：两个实例的完整 stdout+stderr（诊断上报那行就在 install-server.log 里）',
    '- `edge-control.log` / `edge-install.log`：Edge 侧日志',
    '- `dump-config.yml`：装后 profile 的组合结果（loader entry 计数的原始依据）',
    '',
  );
  return lines.join('\n');
}
