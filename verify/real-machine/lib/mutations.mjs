// real-machine/lib/mutations.mjs —— 由 run.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 有牙对照与本轮变异读数（只在副本里改坏，仓里文件不动）

import { INSIDE_SELECTOR_MUTATED, MUTATION, OVERWRITE_SELECTOR_MUTATED, evidenceSettingsPath, raw } from './config.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { dockPanelVerdicts, isDockPanelPass } from './judge.mjs';

export function applyThrowMutation() {
  return `(() => {
  const patch = (loader) => {
    if (loader === null || typeof loader !== 'object' || loader.__guifMutated === true) return;
    const original = loader.load.bind(loader);
    loader.load = (entry) => {
      try {
        if (entry !== null && typeof entry === 'object' && entry.id === 'dsh-gui-frame' && typeof entry.factory === 'function') {
          const factory = entry.factory;
          entry.factory = (require) => {
            const mod = factory(require);
            if (mod !== null && typeof mod === 'object' && typeof mod.apply === 'function') {
              mod.apply = function () { throw new Error('GUIF-MUTATION: apply 故意抛错（有牙对照）'); };
            }
            return mod;
          };
        }
      } catch { /* 包装失败就保持原样 */ }
      return original(entry);
    };
    loader.__guifMutated = true;
  };
  if (window.__ModuleLoader__ !== undefined) { patch(window.__ModuleLoader__); return; }
  let real;
  Object.defineProperty(window, '__ModuleLoader__', {
    configurable: true,
    get() { return real; },
    set(value) { real = value; patch(value); },
  });
})()`;
}

/**
 * 页面级变异②（**确定性**的有牙对照）：在页面里**注入一条与硬红判据同形的 console.error**。
 * 与 ① 的差别：① 试图拦 `__ModuleLoader__`（实测在真外壳里拦不住，已如实记账），
 * ② 只依赖 init script 能跑起来 —— 它验证的是「console 分类记账这条判据本身有牙」。
 */
export function consoleApplyMutation() {
  return `(() => {
  setTimeout(() => {
    try {
      console.error('[gui-frame] 客户端 apply 失败（已吞，页面照常）：GUIF-MUTATION 有牙对照');
    } catch { /* 无 console 就算了 */ }
  }, 6000);
})()`;
}

/**
 * 页面级变异③（**只打 panel-health 的 ③ 一项**）：拦 `Element.prototype.setAttribute`，
 * 把 `data-guif-active` 的**每一次写入**都改成 `'false'`。
 *
 * 选它当靶点的理由：当前没有任何**其它**判据读这个属性 ⇒ 变异跑完只该翻转 panel-health，
 * 从而证明这条新判据不是恒真（旧两条变异各自只打 anchors-subset / console-apply-failure，动不到它）。
 * 选择器在 setAttribute 层拦 ⇒ 无论 React 之后重渲染多少次都恒假，不是「采样瞬间生效」的赌博。
 */
export function panelActiveMutation() {
  return `(() => {
  const proto = Element.prototype;
  const original = proto.setAttribute;
  proto.setAttribute = function (name, value) {
    if (name === 'data-guif-active') value = 'false';
    return original.call(this, name, value);
  };
})()`;
}

/**
 * 页面级变异④（**只打 overlay-esc-top**）：在捕获相最早处吞掉 Escape
 * ⇒ 本装置与外壳的 Esc 处理器都收不到 ⇒ 层栈**不减** ⇒ overlay-esc-top 判红、overlay-two-layers 不受影响。
 *
 * 另有一条**驱动级**对照 `--mutation=overlay-double`（不在这里，见叠层取证段）：把第二扇再点一次
 * ⇒ 开窗账三行 ⇒ overlay-two-layers 必须判红（反证「不靠重复点击凑数」）。
 */
export function escBlockMutation() {
  return `(() => {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);
})()`;
}

/** 按命令行里的专属 user-data-dir 标记找自己起的 msedge（绝不按进程名大范围杀）。 */function listEdgeByMarker(marker) {
  return new Promise((resolve) => {
    const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | Select-Object -ExpandProperty ProcessId`;
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('close', () => resolve(out.split(/\s+/).map((value) => value.trim()).filter((value) => value !== '')));
    child.on('error', () => resolve([]));
  });
}
export async function killEdgeByMarker(marker) {
  const pids = await listEdgeByMarker(marker);
  const killed = [];
  for (const pid of pids) {
    try {
      process.kill(Number(pid));
      killed.push(pid);
    } catch {
      /* 已退出 */
    }
  }
  return killed;
}

/**
 * 变异轮的**范围读数与范围闸**（范围闸覆盖全部登记过靶点的变异）。两件事分开做，别混：
 *
 * ① **读数**（每一轮变异都打）：逐条列出本轮的硬失败 id + 全部判据的 pass/FAIL —— 这就是
 *    「把实测读数（变异前后各判据 pass/fail）写进命令行输出」的落点。
 * ② **范围闸**（`mutation-target-set`）：只对 `MUTATION_TARGETS` 里登记过的变异设，要求硬失败集**恰等于**靶点集。
 */
export function mutationReadings() {
  if (MUTATION === 'dock-action') {
    const mut = raw.states?.install?.mutation ?? null;
    if (mut === null) return ['  ⚠ 没拿到 dock-action 的变异明细（页面那一轮没跑到？）⇒ 只作读数。'];
    const before = mut.before ?? null;
    const after = mut.after ?? null;
    const own = (row) => (row === null ? null : (row.sidebarOwnIds ?? []).length);
    const verdicts = (row) => {
      const v = dockPanelVerdicts(row);
      return [v.sidebarOne, v.actionAtLeastOne, v.actionsMatch, v.editorAbsentInPanel].map((value) => (value === true ? 'pass' : 'FAIL')).join('/');
    };
    return [
      '  同一个页面、同一次运行内的**先后两次读数**（② 与 ③ 是靶点；① ④ 是「不该被牵连」的对照）：',
      `    变异前（真实选择器）：① 侧栏本包条目=${own(before)} ｜ ② 动作锚点=${before?.dockActionCount} ${JSON.stringify(before?.dockActionIds ?? [])} ｜ ③ dock-actions 原始值=${JSON.stringify(before?.dockActionsRaw)}（数值 ${before?.dockActionsNumber}）｜ ④ 坞内布局编辑器锚点=${before?.dockEditorCount}`,
      `    变异后（选择器改成 ${mut.wrongSelector}）：① ${own(after)} ｜ ② ${after?.dockActionCount} ｜ ③ dock-actions 原始值=${JSON.stringify(after?.dockActionsRaw)}（数值 ${after?.dockActionsNumber}）｜ ④ ${after?.dockEditorCount}`,
      `    变异前 dock-panel-actions 四个子项（①②③④）= ${verdicts(before)} ⇒ dock-panel-actions ${isDockPanelPass(before) ? 'pass' : 'FAIL'}`,
      `    变异后 dock-panel-actions 四个子项（①②③④）= ${verdicts(after)} ⇒ dock-panel-actions ${isDockPanelPass(after) ? 'pass' : 'FAIL'}`,
    ];
  }
  if (MUTATION === 'dialog-inside') {
    const install = raw.states?.install ?? {};
    const entry = install.insideEntry ?? null;
    const open = install.insideOpen ?? null;
    const attempts = open?.attempts ?? [];
    return [
      `  靶点读数（把内部入口选择器改成 ${INSIDE_SELECTOR_MUTATED} 之后）：`,
      `    锚点（真选择器读的）：在场=${entry?.present ?? '?'}（全页 ${entry?.count ?? '?'} 个）｜在浮层宿主内=${entry?.inOverlayRoot ?? '?'}｜在浮动窗内=${entry?.inFloatingWindow ?? '?'}｜命中=${entry?.hitTag ?? '?'}`,
      `    这一扇的开法：策略=${JSON.stringify(open?.via ?? null)}｜尝试=${JSON.stringify(attempts.map((row) => `${row.kind}:${row.ok === true ? 'clicked' : row.reason}`))}｜账 +${open?.added ?? '?'}｜真鼠标命中自身=${open?.mouseHitSelf ?? '?'}`,
      '    预期：选错选择器 ⇒ 这一扇点不开（账 +0）⇒ overlay-inside-entry 判红，且「恰两扇」的前提塌掉 ⇒ overlay-two-layers/overlay-esc-top 跟着红。',
    ];
  }
  if (MUTATION === 'layout-overwrite' || MUTATION === 'layout-path') {
    const pass = raw.states?.corrupt ?? {};
    const before = pass.editorBefore ?? null;
    const after = pass.editorAfter ?? null;
    const fileBefore = pass.settingsBefore ?? null;
    const fileAfter = pass.settingsAfter ?? null;
    const lines = [
      `  靶点读数（${MUTATION === 'layout-overwrite' ? `动作锚点选择器改成 ${OVERWRITE_SELECTOR_MUTATED}` : `装置读证据的文件指到 ${evidenceSettingsPath}`}）：`,
      `    界面：覆盖动作锚点 前=${before?.overwriteCount ?? '?'} 后=${after?.overwriteCount ?? '?'}｜可写 前=${JSON.stringify(before?.writableAttr ?? null)} 后=${JSON.stringify(after?.writableAttr ?? null)}｜结果提示 后=${JSON.stringify(after?.noticeAttr ?? null)}`,
      `    点击：${pass.overwriteClick?.via ?? '?'}`,
      `    证据文件：${fileBefore?.path ?? '?'}｜前：读得到=${fileBefore?.ok === true} 版本号=${fileBefore?.schemaVersion ?? 'null'}（原因=${fileBefore?.reason ?? '—'}）｜后：读得到=${fileAfter?.ok === true} 版本号=${fileAfter?.schemaVersion ?? 'null'} 含标记 999=${fileAfter?.corruptMarker ?? '?'}`,
    ];
    lines.push(MUTATION === 'layout-overwrite'
      ? '    预期：选择器改错 ⇒ 那颗动作**点不到** ⇒ corrupt-action-result（动作没发生）/corrupt-file-rebuilt（载荷没被清掉）判红；corrupt-invalid-readable/corrupt-no-write-before 照旧成立。'
      : '    预期：装置读的证据文件不是实现真正读的那一份 ⇒ 负控与结果证据失去依据 ⇒ corrupt-no-write-before/corrupt-file-rebuilt 判红；corrupt-invalid-readable/corrupt-action-result 照旧成立（动作本身仍然发生）。');
    return lines;
  }
  return [];
}

/** 证据里只留设置文件的前 4000 字符（原文一般不超几百字节；留个上限防意外）。 */
