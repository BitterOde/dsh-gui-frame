// tools/dsh-shot/cli.mjs —— 由 dsh-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// CLI 参数面：用法文本与解析

import { DEFAULT_MIN_FREE_MB } from './env.mjs';
import path from 'node:path';
import { UsageError } from '../render-shot.mjs';

export const USAGE = [
  '用法：node tools/dsh-shot.mjs --out <out.png|目录> [选项]',
  '  --wait-for <css>        等锚点出现（默认 [data-guif-glyph] = 本包装上的前置闸）',
  '  --wait-for-timeout <ms> 等锚点超时（默认 30000：真机外壳首屏慢）',
  '  --click <css>           出图前点击（真机坞面板要"点开"才有内容）',
  '  --click-index <n>       点第 n 个命中（0 基，默认 0）',
  '  --click-via <mouse|js>  默认 mouse；坞入口用 js（对最近的外壳 button 派发 click）',
  '  --selector <css>        只截这个元素（如 [data-guif-dock-actions]）',
  '  --width/--height <px>   视口（默认 1440×900）',
  '  --json / --dry-run / --keep / --profile <name> / --dsh-bin <path> / --browser <path>',
  '  --min-free-mb <n>       内存硬闸：空闲物理内存低于 n MB 就 fail-closed（默认 4096；0 = 显式关闸）',
  '  --help                  本帮助',
  '',
  '例（对真机坞面板出图）：',
  '  node tools/dsh-shot.mjs --out tools/evidence/dock-panel.png \\',
  "    --click '[data-guif-glyph=\"dsh-gui-frame/dock\"]' --click-via js \\",
  '    --wait-for "[data-guif-dock-actions]" --selector "[data-guif-panel]" --json',
  '注意：--click-via mouse 只点你指定的那个元素；--click-via js 会对"包住它的外壳 button"派发 click。',
  '      绝不拿 --click "button" 去随便点（真 GUI 上可能撞到会话/发送键）。',
].join('\n');
export function positiveInt(raw, flag, allowZero = false) {
  if (!/^\d+$/.test(raw)) throw new UsageError(`${flag} 需要一个整数，收到：${raw}`);
  const value = Number(raw);
  if (allowZero ? value < 0 : value <= 0) throw new UsageError(`${flag} 必须${allowZero ? '≥ 0' : '> 0'}，收到：${raw}`);
  return value;
}

/** 解析命令行（不认识的一律用法错误；`--dry-run` / `--help` 不需要 --out）。 */
export function parseCli(argv) {
  const options = {
    out: null,
    waitFor: '[data-guif-glyph]',
    // 真机外壳首屏比静态页慢得多（装置实跑时最长等到 20s）⇒ 这里比 render-shot 的默认（15s）再宽一档。
    waitForTimeout: 30_000,
    click: null,
    clickIndex: 0,
    clickVia: 'mouse',
    selector: null,
    width: 1440,
    height: 900,
    waitMs: 800,
    timeoutMs: 30_000,
    json: false,
    profile: null,
    reuse: false,
    dshBin: null,
    link: null,
    browser: null,
    keep: false,
    dryRun: false,
    help: false,
    minFreeMb: DEFAULT_MIN_FREE_MB,
  };
  let index = 0;
  /** 取下一个 token 作为参数值（成功即前进一格，保证值不会被当成下一个开关）。 */
  const takeValue = (flag) => {
    index += 1;
    const next = argv[index];
    if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} 需要一个参数值`);
    return next;
  };
  for (index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') options.out = takeValue('--out');
    else if (arg === '--wait-for') options.waitFor = takeValue('--wait-for');
    else if (arg === '--wait-for-timeout') options.waitForTimeout = positiveInt(takeValue('--wait-for-timeout'), '--wait-for-timeout');
    else if (arg === '--click') options.click = takeValue('--click');
    else if (arg === '--click-index') options.clickIndex = positiveInt(takeValue('--click-index'), '--click-index', true);
    else if (arg === '--click-via') {
      const via = takeValue('--click-via');
      if (via !== 'mouse' && via !== 'js') throw new UsageError(`--click-via 只支持 mouse / js，收到：${via}`);
      options.clickVia = via;
    } else if (arg === '--selector') options.selector = takeValue('--selector');
    else if (arg === '--width') options.width = positiveInt(takeValue('--width'), '--width');
    else if (arg === '--height') options.height = positiveInt(takeValue('--height'), '--height');
    else if (arg === '--wait-ms') options.waitMs = positiveInt(takeValue('--wait-ms'), '--wait-ms', true);
    else if (arg === '--timeout-ms') options.timeoutMs = positiveInt(takeValue('--timeout-ms'), '--timeout-ms');
    else if (arg === '--profile') options.profile = takeValue('--profile');
    else if (arg === '--dsh-bin') options.dshBin = takeValue('--dsh-bin');
    else if (arg === '--link') options.link = takeValue('--link');
    else if (arg === '--browser') options.browser = takeValue('--browser');
    else if (arg === '--min-free-mb') options.minFreeMb = positiveInt(takeValue('--min-free-mb'), '--min-free-mb', true);
    else if (arg === '--json') options.json = true;
    else if (arg === '--reuse') options.reuse = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new UsageError(`未知参数：${arg}`);
  }
  if (options.help || options.dryRun) return options;
  if (options.out === null || options.out === '') {
    throw new UsageError('缺少 --out（产物 PNG 写到哪里）：node tools/dsh-shot.mjs --out <out.png|目录>');
  }
  if (options.profile !== null && !/^[A-Za-z0-9._-]+$/.test(options.profile)) {
    throw new UsageError(`--profile 名字不合法（只允许字母/数字/._-）：${options.profile}`);
  }
  if (options.profile === 'web') throw new UsageError('拒绝使用 profile `web` —— 那是用户在用的 profile（本工具只用临时 profile）');
  if (options.waitFor === null && options.click === null) {
    throw new UsageError('至少要有一个"等什么"：--wait-for（等锚点出现）或 --click（点开它）');
  }
  return options;
}

/** 计划（`--dry-run` 与正常跑共用的同一份说法，避免"打印的和真跑的不一样"）。 */
