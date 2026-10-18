// real-machine/lib/config.mjs —— 由 run.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 运行期配置：CLI 参数、隔离 home、profile/证据路径、态选择与进程级收尾

import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSIDE_SELECTOR } from './judge.mjs';

/** 本模块所在目录（`verify/real-machine/lib`）——**只作模块自身定位**，不要拿它当装置根。 */
export const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 装置根（`verify/real-machine`）：拆成 `lib/` 子模块后 HERE 少了一层，凡「相对装置根」的路径
 * 都必须从 ORIGIN 出发 —— 旧写法 `path.resolve(HERE, '..', '..')` 会指到 `verify/`。
 */
export const ORIGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PKG_DIR = path.resolve(ORIGIN, '..', '..');
export const LINK_SPEC = `link:${PKG_DIR.replace(/\\/g, '/')}`;
export const BUNDLE_MARKER = 'useStandInHook';
export const GUI_FRAME_ENTRY_ID = 'gui-frame';
/** `settings.yaml` 里本包那一节 / 字段（与 `src/client/layout/persist.mjs` 的 NAMESPACE / LAYOUT_FIELD 同值）。 */
export const SETTINGS_NAMESPACE = 'gui-frame';
export const SETTINGS_LAYOUT_FIELD = 'layout';
/**
 * ★ **测试工作台的门控字段**（与 `src/host/settings.mjs` 的 `TEST_WORKBENCH_FIELD` 同值）。
 * 语义＝「用户在 DSH 设置页把『GUIFrame 测试工作台』打开」；不打开 ⇒ 状态表只剩 `official` ⇒ 顶部开关
 * **按设计自动隐藏** ⇒ 工作台那一族判据全都无从取证（会被判成假红）。
 * 装置因此在每条真机 pass 之前把这道门写进**隔离 home**（用户真实 home 只读，一个字节不碰）。
 */
export const SETTINGS_TEST_WORKBENCH_FIELD = 'testWorkbench';
/** 坏载荷的标记：版本号**高于**本实现 ⇒ `migrate` 判 `GUIF-W-LAYOUT-CORRUPT` ⇒ `read.kind = invalid`。 */
export const CORRUPT_SCHEMA_VERSION = 999;
export function argValue(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}
export const DRY_RUN = process.argv.includes('--dry-run');
export const KEEP = process.argv.includes('--keep');
export const MUTATION = argValue('mutation') ?? 'none';
export const OUT_ROOT = argValue('out') ?? path.join(ORIGIN, 'evidence');
export const stamp = new Date().toISOString().replace(/[:.]/g, '-');
export const profileName = argValue('profile') ?? `guifrm${Date.now().toString(36)}`;
export const outDir = path.join(OUT_ROOT, `${stamp}${MUTATION === 'none' ? '' : `-mut-${MUTATION}`}`);
export const edgeUserDataDir = path.join(process.env.TEMP ?? process.env.TMP ?? '.', `guif-rm-${stamp}`);

/**
 * 隔离的 harness home：默认在 TEMP 下**新建**一个；也可以用 `--dsh-home=<路径>` 指到别处
 * （指过去的那种**不删**，只删我们自己造的那个）。`process.env.DSH_HOME` 必须在**任何 dsh 调用之前**
 * 设好 —— `lib/dsh.mjs` 的 `dshHome()` 与子进程环境都读它。
 */
export const HOME_FLAG = argValue('dsh-home');
export const realHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
export const ownedHome = HOME_FLAG === null;
export const dshHomeDir = HOME_FLAG === null ? path.join(process.env.TEMP ?? process.env.TMP ?? '.', `guif-dsh-${stamp}`) : path.resolve(HOME_FLAG);
process.env.DSH_HOME = dshHomeDir;
/** 设置文件的绝对路径（＝ `<harness home>/settings.yaml`，与 `dsh-settings-file` 的 resolveSpec 同口径）。 */
export const settingsPath = path.join(dshHomeDir, 'settings.yaml');

/**
 * 装置**读证据**用的设置文件路径。`--mutation=layout-path` 故意把它指到另一个文件 —— 证明
 * 「点它之前一个字节都没写」这条**负控**不是恒真（指向不存在的文件时，负控与落盘证据都会判红）。
 */
export const evidenceSettingsPath = MUTATION === 'layout-path' ? path.join(dshHomeDir, 'settings-NOT-THE-ONE.yaml') : settingsPath;

/** 种下去的那份坏载荷原文（负控要比对的就是它那一节）。 */
export let seededCorruptText = null;

/**
 * **每条变异的靶点集**（范围闸用它判「只翻转自己」）。表里**没有**的变异一律不设闸，只打读数 ——
 * 理由是实测而不是口味：本仓 `evidence/` 下各 `-mut-` 轮的 `raw.json` 逐轮数出来，早期几轮的翻转集
 * **跑次之间会漂**（`console-apply` 有一轮连带红了 overlay-two-layers/overlay-esc-top/diagnostics-host-line；`overlay-double` 后两轮又只红 overlay-two-layers
 * 而 README 曾写它连带 overlay-esc-top）。把会漂的集合写成硬判据＝自造一条会闪的判据。
 *
 * `dialog-inside` 的靶点集**故意含 overlay-two-layers/overlay-esc-top**：内部入口现在是第二扇的**唯一**路径，
 * 改错它就必然连带那两条（「恰两扇」的前提塌了）。这不是「只翻自己一条」，如实登记、如实判。
 *
 * ⚠ 本文件在**模块顶层**直接 `await main()`：凡是 main 期间要读的 `const/let` 都必须声明在那之前，
 * 否则进 TDZ（`applyThrowMutation` 与 `seededCorruptText` 都踩过同一个坑）。
 */
process.on('exit', () => {
  if (ownedHome !== true || KEEP === true) return;
  try {
    rmSync(dshHomeDir, { recursive: true, force: true });
  } catch {
    // 退出阶段不再抛
  }
});

/**
 * 「坏载荷 ⇒ 显式覆盖」这一族判据**在本机不可证**时的统一原因串（真机实测结论，机制见
 * `readCorruptOutcome` 的头注释与坏载荷可达性前置那条判据的 detail）。放在顶层是因为 main 期间要读它 ——
 * 本文件在模块顶层直接 `await main()`，后置的 `const` 会进 TDZ。
 */
/** 本轮的原始读数容器（模块级 —— reportMutationScope / mutationReadings 也要读它，
 *  而它们不在 main() 的作用域里；后置声明会进 TDZ，所以放在顶层）。 */
export let raw = null;

// 原先这里有一条写死的 `RM08_NOT_EVIDENCE_REASON`（内容是「宿主侧从未注册 `gui-frame` 命名空间」）。
// 宿主侧改为注册命名空间之后那句话已不成立 ⇒ 改成**按当轮实读生成**（`readCorruptOutcome` 内的 `notEvidenceReason`），
// 免得把历史结论当成本轮理由（本项目反复踩的「据与说不一致」）。

/** 本条变异要改错的选择器（`none` ⇒ 用真选择器）。 */
export const INSIDE_SELECTOR_MUTATED = '[data-guif-demo-open-dialog-inside-MUTATED-BY-t8]';
export const OVERWRITE_SELECTOR_MUTATED = '[data-guif-layout-overwrite-MUTATED-BY-t8]';
export const insideSelector = MUTATION === 'dialog-inside' ? INSIDE_SELECTOR_MUTATED : INSIDE_SELECTOR;
export const overwriteSelector = MUTATION === 'layout-overwrite' ? OVERWRITE_SELECTOR_MUTATED : '[data-guif-layout-overwrite]';

/** 本轮要跑的态（`--only=` 可单独跑一段，便于校准）。 */
export const ONLY = argValue('only');
/** 每条变异只跑它**打得到**的那个态（省时间，也让「范围读数」只含该态的判据）。 */
export const MUTATION_STATES = {
  'dialog-inside': ['install'],
  'layout-overwrite': ['corrupt'],
  'layout-path': ['corrupt'],
};
export const defaultStates = MUTATION === 'none' ? ['control', 'install', 'corrupt'] : (MUTATION_STATES[MUTATION] ?? ['install']);
export const wantedStates = ONLY === null
  ? defaultStates
  : ONLY.split(',').map((value) => value.trim()).filter((value) => value !== '');
export const stateWanted = (name) => wantedStates.includes(name);

/** 本轮起的进程（收尾只回收这些 + 带自己标记的 Edge）。 */
export const state = { servers: [], serverPorts: [], edges: [], session: null };

/** 换一份本轮证据对象（入口 main 只管赋值，读的人到处都有）。 */
export function setRaw(value) {
  raw = value;
}

/** 记下本轮播种的坏载荷原文（seedCorruptLayout 写，readSettingsText 读）。 */
export function setSeededCorruptText(value) {
  seededCorruptText = value;
}
