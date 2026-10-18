// real-machine/lib/corrupt.mjs —— 由 run.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 坏载荷态：settings.yaml 的读/写/截断与覆盖锚点、坏载荷结果判定

import { CORRUPT_SCHEMA_VERSION, SETTINGS_LAYOUT_FIELD, SETTINGS_NAMESPACE, SETTINGS_TEST_WORKBENCH_FIELD, dshHomeDir, evidenceSettingsPath, raw, seededCorruptText, setSeededCorruptText, settingsPath } from './config.mjs';
import { check, checkShellModalPrereq } from './report.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseLayoutSection, realClick } from './judge.mjs';

export function truncateSettingsText(text) {
  return text === null || text === undefined ? null : String(text).slice(0, 4000);
}

/** 读 settings.yaml 原文（判据要的是**逐字节**的事实，不是「应该写进去了」）。 */
export function readSettingsText(target = evidenceSettingsPath) {
  let text = null;
  let reason = null;
  try {
    text = readFileSync(target, 'utf8');
  } catch (error) {
    reason = String(error?.code ?? error?.message ?? error);
  }
  const parsed = text === null ? { namespaceFound: false, layoutFound: false, schemaVersion: null, docks: null } : parseLayoutSection(text);
  return {
    ok: text !== null,
    path: target,
    bytes: text === null ? null : Buffer.byteLength(text, 'utf8'), // 量纲：**UTF-8 字节**（≠ `text.length`，后者是 UTF-16 码元）
    text,
    reason,
    corruptMarker: text === null ? null : text.includes(String(CORRUPT_SCHEMA_VERSION)),
    ...parsed,
  };
}


/**
 * 把一份**读不出来**的布局载荷写进临时 home 的 `settings.yaml`。
 *
 * 手法：`schemaVersion` 取一个**高于本实现**的值（999）⇒ `src/client/migrate.mjs` 判
 * `GUIF-W-LAYOUT-CORRUPT` ⇒ `persist.read()` 返回 `kind: 'invalid'` ⇒ 载入后**不启用保存**（只读）
 * 且界面出现「用默认值覆盖」。写的是 **JSON 文本**（YAML 1.2 是 JSON 的超集 ⇒ 同一个文件两种写法都能读），
 * 免去手写 YAML 的缩进风险；settings-file 之后自己重写时输出块式 YAML，判据的文本扫描两种都认。
 */
export function seedCorruptLayout() {
  try {
    mkdirSync(dshHomeDir, { recursive: true });
    const payload = {
      schemaVersion: CORRUPT_SCHEMA_VERSION,
      rev: 0,
      docks: ['dsh-gui-frame/ghost-entry'],
      entries: { 'dsh-gui-frame/ghost-entry': { visible: true, source: 'ghost' } },
    };
    // 写**块式 YAML**（不用 JSON 写法）：设备自己那套极简扫描器只认块式 `gui-frame:` / `layout:`
    // —— 写进去和读回来必须同一种形状，否则「读了半天读不出来」会变成一条假的红。
    const text = [
      `${SETTINGS_NAMESPACE}:`,
      // ★ 门控（测试工作台）**必须一起写回来** —— 这一族判据要的是「布局载荷坏掉时界面给出唯一出路」，
      //   而门控关着时顶部开关与工作台那一族整体不可用（按设计自动隐藏）。两份状态同属一个命名空间、一次写全。
      `  ${SETTINGS_TEST_WORKBENCH_FIELD}: true`,
      `  ${SETTINGS_LAYOUT_FIELD}:`,
      `    schemaVersion: ${payload.schemaVersion}`,
      `    rev: ${payload.rev}`,
      '    docks:',
      ...payload.docks.map((id) => `      - ${id}`),
      '    entries:',
      `      ${payload.docks[0]}:`,
      '        visible: true',
      '        source: ghost',
      '',
    ].join('\n');
    writeFileSync(settingsPath, text, 'utf8');
    setSeededCorruptText(text);
    return { ok: true, bytes: Buffer.byteLength(text, 'utf8'), text, payload, path: settingsPath }; // 量纲：**UTF-8 字节**
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error), path: settingsPath };
  }
}

/** 点「用默认值覆盖」（真鼠标优先；没生效才 JS 兜底，两条都记账）。 */
export async function clickLayoutOverwrite(session, selector) {
  const mouse = await realClick(session, selector, { waitMs: 1500 });
  if (mouse.ok === true) return { ok: true, via: `mouse:命中${mouse.hit?.self === true ? '自身' : `遮挡(${mouse.hit?.tag ?? '?'})`}`, hit: mouse.hit ?? null, steps: ['mouse:clicked'] };
  const js = await session.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (node === null) return { ok: false, reason: 'missing' };
    node.click();
    return { ok: true };
  })()`);
  return { ok: js.ok === true, via: `mouse:${mouse.reason}→js:${js.ok === true ? 'clicked' : js.reason}`, hit: mouse.hit ?? null, steps: [`mouse:${mouse.reason}`, `js:${js.ok === true ? 'clicked' : js.reason}`] };
}

/**
 * 坏载荷态的四条判据（corrupt-invalid-readable…corrupt-file-rebuilt）+ 一条**可达性前置**。**逐条**判，每条都要能单独判红。
 *
 * ═══ 为什么先判「可达性」，以及这条前置为什么必判红 ═══
 * 真机实测（`evidence/2026-10-03T12-33-41-377Z`，以及历轮常规轮的 demo ② 读数）：
 * 坞面板里那台编辑器的状态行恒为 `布局 vN · rev R · **unavailable**（只读）`。
 * 机制（读 DSH 装机源码，不是猜）：
 *   · 客户端 `settingsScope.bind({namespace})` 的 fold 只在**宿主 `settings.describe()` 列出的已注册命名空间**
 *     里找自己那一节 —— `dsh-client-ui-settings` 的 `SettingsScopeController`：
 *     `const view = mirrored.view.namespaces.find((c) => c.ns === spec.namespace); if (view === undefined) { status = 'unavailable'; return; }`；
 *   · 而 `dsh-settings` 的 `describe()` 遍历的是 **`this.registrations`** —— 只有**宿主侧**调用过
 *     `register(ns, schema, …)` / `installSection(owner, ns, schema, …)` 的命名空间才在里面；
 *   · 本包 `src/` **只有 `client/**`**，全仓没有任何一处为 `gui-frame` 注册命名空间；
 *   · 旁证：用户真实 `~/.dsh/settings.yaml` 里只有宿主注册过的节（`ui-theme` / `agent-presets` / …），**没有 `gui-frame`**。
 * ⇒ 真机上 `read.kind` **永远到不了** `invalid`/`error`（那两种才进 writePolicy 的 `block`、才会把
 * `needsOverwrite` 置真）⇒ 「载荷损坏 ⇒ 用默认值覆盖」这条链**在真机上不可达**。
 * 所以：**前置判红**（这是一个真实的能力级缺口：把布局存到 settings 的能力在真机上没有接上宿主），
 * 四条 corrupt-invalid-readable…corrupt-file-rebuilt 记为**未取真机证**并把现场读数一并写下 —— 既不假装绿，也不把它当成本轮实现的锅。
 */
export function readCorruptOutcome({ raw, pass, seeded }) {
  const before = pass.editorBefore ?? null;
  const after = pass.editorAfter ?? null;
  const fileBefore = pass.settingsBefore ?? null;
  const fileAfter = pass.settingsAfter ?? null;
  const seeds = seeded?.text ?? null;
  const dockIds = [...new Set([pass.dockFacts?.panelId, ...(pass.dockFacts?.launcherIds ?? []), ...(pass.dockFacts?.dockActionIds ?? [])]
    .filter((id) => typeof id === 'string' && id !== ''))];
  const ghost = 'dsh-gui-frame/ghost-entry';

  const statusText = String(before?.statusText ?? '');
  const readKind = (statusText.match(/·\s*([a-z-]+)\s*（只读）/) ?? [])[1] ?? (statusText.match(/·\s*(ready|empty|invalid|error|loading|unavailable)\b/) ?? [])[1] ?? null;
  // 环境前置同 install 一轮：外壳模态也必须先被处置掉（否则下面读到的「只读」可能是遮罩下的假象）
  checkShellModalPrereq(pass, { id: 'shell-modal-cleared-corrupt', suffix: '（坏载荷态）' });
  // 「命名空间对客户端可见」＝ read.kind 落在四个**真的读到了**的 kind 里（ready/empty/invalid/error）。
  const reachable = readKind !== null && ['ready', 'empty', 'invalid', 'error'].includes(readKind);
  // **未取真机证的理由按当轮实读生成**（旧版写死「宿主侧从未注册 gui-frame 命名空间」——
  //   那在宿主侧改为注册命名空间之后已经不成立，留着就是「据与说不一致」）。
  const notEvidenceReason = `前置不可达：坞面板编辑器状态行解析出的 read.kind=${JSON.stringify(readKind ?? null)}`
    + `（可见集合 = ready/empty/invalid/error）⇒ 载荷损坏态在真机上走不到 ⇒ 这四条**未取真机证**（现场读数见 detail，替身单测的绿不算真机绿）`;
  check(
    'corrupt-payload-visible',
    '坏载荷态**可达性前置**：`gui-frame` 命名空间对客户端**可见**（`read.kind ∈ {ready, empty, invalid, error}`）—— 这是「载荷损坏 ⇒ 显式覆盖」在真机上能不能被走到的前提',
    reachable,
    `坞面板编辑器状态行=${JSON.stringify(statusText || null)}｜解析出的 read.kind=${JSON.stringify(readKind)}｜可写锚点=${JSON.stringify(before?.writableAttr ?? null)}｜`
      + (reachable
        ? '（可见 ⇒ 下面的 corrupt-invalid-readable…corrupt-file-rebuilt 才有意义）'
        : '**不可见** ⇒ 判红即「前置不可达」，现场读数在下方的 corrupt-invalid-readable…corrupt-file-rebuilt detail 里逐条留存。'
          + '（历史注：那次的原因是「宿主侧从未注册 `gui-frame` 命名空间」；**宿主侧改为注册命名空间、客户端可写之后**，'
          + '若本轮仍不可见，原因需按当轮读数另查，别照抄旧结论。）'),
  );

  if (!reachable) {
    const snapshot = `坞面板=${before?.panelId ?? '(未找到)'}｜状态行=${JSON.stringify(statusText || null)}｜覆盖动作锚点=${before?.overwriteCount ?? '?'}（全页 ${before?.overwritePage ?? '?'}）｜可写锚点=${JSON.stringify(before?.writableAttr ?? null)}｜`
      + `种下的坏载荷：${fileBefore?.path ?? '?'}（读得到=${fileBefore?.ok === true}，含标记 999=${fileBefore?.corruptMarker ?? '?'}，逐字节＝原文=${fileBefore?.text === seeds}）｜点后文件=None 未点（拿不到那颗动作）｜`
      + `点那颗动作的结果=${pass.overwriteClick?.via ?? '（未尝试）'}`;
    for (const [id, title] of [
      ['corrupt-invalid-readable', '坏载荷态前置：载荷被读成 invalid（只读态 + 界面给出唯一的人工出路）'],
      ['corrupt-no-write-before', '坏载荷态负控：点那颗动作之前一个字节都没写回'],
      ['corrupt-action-result', '坏载荷态动作：点它之后界面如实说出结果、可写恢复、出路消失'],
      ['corrupt-file-rebuilt', '坏载荷态落盘：坏载荷被清掉、按当前已注册入口重建'],
    ]) {
      check(id, title, false, `${notEvidenceReason}｜现场读数：${snapshot}`, { notEvidence: true, reason: notEvidenceReason });
    }
    raw.corrupt = {
      ...raw.corrupt,
      reachable: false,
      readKind,
      statusText,
      before,
      after,
      fileBefore: { ...fileBefore, text: truncateSettingsText(fileBefore?.text ?? null) },
      fileAfter: { ...fileAfter, text: truncateSettingsText(fileAfter?.text ?? null) },
      dockIds,
      notEvidenceReason,
    };
    return;
  }

  const badStillThere = fileBefore !== null && fileBefore.ok === true
    && fileBefore.schemaVersion === CORRUPT_SCHEMA_VERSION
    && Array.isArray(fileBefore.docks) && fileBefore.docks.includes(ghost);
  const badGone = fileAfter !== null && fileAfter.ok === true
    && fileAfter.corruptMarker === false
    && fileAfter.schemaVersion !== CORRUPT_SCHEMA_VERSION
    && Array.isArray(fileAfter.docks) && !fileAfter.docks.includes(ghost);
  const rebuilt = fileAfter !== null && fileAfter.ok === true
    && Array.isArray(fileAfter.docks) && fileAfter.docks.length >= 1
    && dockIds.every((id) => fileAfter.docks.includes(id))
    && Array.isArray(after?.rows) && after.rows.length === fileAfter.docks.length
    && after.rows.every((id, index) => id === fileAfter.docks[index]);

  check(
    'corrupt-invalid-readable',
    '坏载荷态前置：`schemaVersion` 高于本实现的载荷被**读成 invalid**（只读态 + 界面给出唯一的人工出路 `[data-guif-layout-overwrite]`）',
    before !== null && before.editorPresent === true && before.overwriteCount >= 1 && before.writableAttr === 'false' && /invalid/.test(String(before.statusText ?? '')),
    `坞面板=${before?.panelId ?? '(未找到)'}｜编辑器在场=${before?.editorPresent ?? '?'}｜覆盖动作锚点=${before?.overwriteCount ?? '?'}（全页=${before?.overwritePage ?? '?'}）｜可写锚点=${JSON.stringify(before?.writableAttr ?? null)}｜状态行=${JSON.stringify(before?.statusText ?? null)}｜行=${JSON.stringify(before?.rows ?? [])}`,
  );
  check(
    'corrupt-no-write-before',
    '坏载荷态**负控**：点那颗动作之前一个字节都没写回（文件里那份坏载荷仍在：版本号仍 999、docks 仍是幽灵条目，界面仍只读）',
    badStillThere && before !== null && before.writableAttr === 'false' && /invalid/.test(String(before.statusText ?? '')),
    `证据文件=${fileBefore?.path ?? '?'}（读得到=${fileBefore?.ok === true}${fileBefore?.ok === true ? '' : `，原因=${fileBefore?.reason}`}）｜版本号=${fileBefore?.schemaVersion ?? 'null'}｜docks=${JSON.stringify(fileBefore?.docks ?? null)}｜含标记 999=${fileBefore?.corruptMarker ?? '?'}｜逐字节等于种下的原文=${fileBefore?.text === seeds}（**只作读数**：别的命名空间启动时可能自己落一次盘）｜界面可写锚点=${JSON.stringify(before?.writableAttr ?? null)}｜状态行=${JSON.stringify(before?.statusText ?? null)}`,
  );
  check(
    'corrupt-action-result',
    '坏载荷态动作：点「用默认值覆盖」之后界面如实说出结果（`[data-guif-layout-notice]`）、可写恢复、那条出路本身消失（载荷已经不坏了）',
    after !== null && after.noticeAttr !== null && after.writableAttr === 'true' && after.overwriteCount === 0 && !/invalid/.test(String(after.statusText ?? '')),
    `点击=${pass.overwriteClick?.via ?? '?'}｜提示锚点=${JSON.stringify(after?.noticeAttr ?? null)}｜提示正文=${JSON.stringify(after?.noticeText ?? null)}｜可写锚点=${JSON.stringify(after?.writableAttr ?? null)}｜覆盖动作锚点=${after?.overwriteCount ?? '?'}｜状态行=${JSON.stringify(after?.statusText ?? null)}｜行=${JSON.stringify(after?.rows ?? [])}`,
  );
  check(
    'corrupt-file-rebuilt',
    '坏载荷态落盘：坏载荷被清掉、按当前已注册入口重建（幽灵条目消失、已注册入口一个不少、落盘顺序＝编辑器显示顺序）',
    badGone && rebuilt,
    `证据文件=${fileAfter?.path ?? '?'}（读得到=${fileAfter?.ok === true}${fileAfter?.ok === true ? '' : `，原因=${fileAfter?.reason}`}）｜含标记 999=${fileAfter?.corruptMarker ?? '?'}｜版本号=${fileAfter?.schemaVersion ?? 'null'}｜落盘 docks=${JSON.stringify(fileAfter?.docks ?? null)}｜界面行=${JSON.stringify(after?.rows ?? [])}｜已注册入口（坞面板锚点读到）=${JSON.stringify(dockIds)}｜顺序一致=${rebuilt ? '是' : '否'}`,
  );
  raw.corrupt = {
    ...raw.corrupt,
    reachable: true,
    readKind,
    statusText,
    before,
    after,
    fileBefore: { ...fileBefore, text: truncateSettingsText(fileBefore?.text ?? null) },
    fileAfter: { ...fileAfter, text: truncateSettingsText(fileAfter?.text ?? null) },
    dockIds,
  };
}

/**
 * **页面可交互前置**（shell-modal-cleared）：本包面板上方不该有**外壳自己的**模态遮罩。
 *
 * 为什么单列一条：整跑挪到独立 `$DSH_HOME` 之后，临时 home 里**没有会话** ⇒ 外壳会弹它自己的
 * Dialog（`dsh-web-frontend` 的 `_mask_*`），全屏遮罩把面板整块盖住 ⇒ 真鼠标点什么都命中那个 mask。
 * 这是**环境前置**（外壳的态，不是本包缺陷），但装置必须**先处置再取证**，否则 overlay-real-mouse/e 与整段
 * 四段走都会以「点不动」的形式齐红，看上去像实现坏了（首次整跑就踩过）。
 */
