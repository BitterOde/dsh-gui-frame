// tools/render-shot/args.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// CLI 参数面：默认值常量、用法错误类型、解析与用法文本

import { UsageError } from './constants.mjs';
import { isHttpUrl } from './inputs.mjs';
import path from 'node:path';

export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 900;
/** 加载完成后的静置时长：够 webfont 落地与首屏稳定，又不至于让批量截图肉眼变慢。 */
export const DEFAULT_WAIT_MS = 500;
/** CDP 单步超时（导航/截图这类重活共用；可用 --timeout-ms 覆盖）。 */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** 单边像素上限：Chromium 的合成器贴图上限就是 16384，超了会拍到空白或直接失败。 */
export const MAX_CAPTURE_HEIGHT = 16_384;
/** 整页总像素上限：防"一个恶意/异常页面把内存吃干"（对齐参考实现的像素安全线思路）。 */
export const MAX_CAPTURE_PIXELS = 64_000_000;
/** 整页唤醒的步数上限：IntersectionObserver 类"滚动才出现"的内容要有上限地唤醒。 */
export const MAX_WAKE_STEPS = 40;
/** 整页唤醒每步停留（毫秒）：给 IntersectionObserver 回调留一拍。 */
export const WAKE_STEP_MS = 40;
/** 整页唤醒扫到底后回顶端再等的时长（等 reveal 过渡收尾）。 */
export const WAKE_SETTLE_MS = 250;
/** 等锚点出现的默认超时：真机页面「外壳先到、内容后到」，15 秒够首屏 + 一次面板展开。 */
export const DEFAULT_WAIT_FOR_TIMEOUT_MS = 15_000;
/** 等锚点的轮询间隔：200ms 在「等得够快」与「不把 CDP 打满」之间取中。 */
export const WAIT_FOR_POLL_MS = 200;
/** 点击之后的静置：让 React 提交那次状态变更再量尺寸/拍图。 */
export const CLICK_SETTLE_MS = 600;


// ── 浏览器探测（纯函数：全部注入，便于自检不启动浏览器）─────────────────────────

/**
 * 候选浏览器可执行文件（按优先级）。
 *
 * 为什么**不**扫盘/读注册表：扫盘慢且可能碰到用户自己装的奇怪构建；这里只列
 * Chromium 系（Edge/Chrome/Chromium）的**标准安装位**，再叠加显式环境变量覆盖。
 * 本机只有 Edge，所以 Edge 的两条标准路径必须在列。
 */
export function splitInlineValue(token) {
  if (!token.startsWith('--')) return [token, null];
  const at = token.indexOf('=');
  return at === -1 ? [token, null] : [token.slice(0, at), token.slice(at + 1)];
}

/** 解析一个非负/正整数（拒绝 `abc` / `0` / `-3` / `1.5`）。 */
export function parsePositiveInt(raw, flag, { allowZero = false } = {}) {
  if (raw === null || raw === undefined) throw new UsageError(`${flag} 需要一个参数值`);
  if (!/^\d+$/.test(raw)) throw new UsageError(`${flag} 需要一个整数，收到：${raw}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new UsageError(`${flag} 数值过大：${raw}`);
  if (allowZero ? value < 0 : value <= 0) throw new UsageError(`${flag} 必须${allowZero ? '≥ 0' : '> 0'}，收到：${raw}`);
  return value;
}

/**
 * 解析命令行。
 * @param {string[]} argv 不含 `node` 与脚本名
 * @returns {{input:string, out:string, width:number, height:number, fullPage:boolean,
 *   waitMs:number, json:boolean, browser:string|null, timeoutMs:number, keepProfile:boolean, help:boolean,
 *   waitFor:string|null, waitForTimeoutMs:number, selector:string|null,
 *   click:string|null, clickIndex:number, clickVia:'mouse'|'js'}}
 */
export function parseArgs(argv) {
  const options = {
    input: null,
    out: null,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    fullPage: false,
    waitMs: DEFAULT_WAIT_MS,
    json: false,
    browser: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    keepProfile: false,
    help: false,
    waitFor: null,
    waitForTimeoutMs: DEFAULT_WAIT_FOR_TIMEOUT_MS,
    selector: null,
    click: null,
    clickIndex: 0,
    clickVia: 'mouse',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [token, inline] = splitInlineValue(raw);
    /** 取下一段作为值（支持 `--k v` 与 `--k=v`）。 */
    const takeValue = () => {
      if (inline !== null) return inline;
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith('--') && next !== '--')) {
        throw new UsageError(`${token} 需要一个参数值`);
      }
      index += 1;
      return next;
    };
    switch (token) {
      case '--out':
        options.out = takeValue();
        break;
      case '--width':
        options.width = parsePositiveInt(takeValue(), '--width');
        break;
      case '--height':
        options.height = parsePositiveInt(takeValue(), '--height');
        break;
      case '--wait-ms':
        options.waitMs = parsePositiveInt(takeValue(), '--wait-ms', { allowZero: true });
        break;
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInt(takeValue(), '--timeout-ms');
        break;
      case '--browser':
        options.browser = takeValue();
        break;
      case '--full-page':
        options.fullPage = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--keep-profile':
        options.keepProfile = true;
        break;
      case '--wait-for':
        options.waitFor = takeValue();
        break;
      case '--wait-for-timeout':
        options.waitForTimeoutMs = parsePositiveInt(takeValue(), '--wait-for-timeout');
        break;
      case '--selector':
        options.selector = takeValue();
        break;
      case '--click':
        options.click = takeValue();
        break;
      case '--click-index':
        options.clickIndex = parsePositiveInt(takeValue(), '--click-index', { allowZero: true });
        break;
      case '--click-via': {
        const via = takeValue();
        if (via !== 'mouse' && via !== 'js') throw new UsageError(`--click-via 只支持 mouse / js，收到：${via}`);
        options.clickVia = via;
        break;
      }
      case '--url': {
        const value = takeValue();
        if (!isHttpUrl(value)) throw new UsageError(`--url 需要一个 http(s) 地址，收到：${value}`);
        if (options.input !== null) throw new UsageError(`只接受一个输入，多余的位置参数：${raw}`);
        options.input = value;
        break;
      }
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (token.startsWith('-')) throw new UsageError(`未知参数：${raw}`);
        if (options.input !== null) throw new UsageError(`只接受一个输入 HTML，多余的位置参数：${raw}`);
        options.input = raw;
        break;
    }
  }
  if (options.help) return options;
  if (options.input === null) throw new UsageError('缺少输入 HTML：node tools/render-shot.mjs <input.html|http(s) URL> --out <out.png>');
  if (options.out === null || options.out === '') throw new UsageError('缺少 --out 参数（截图写到哪个文件）');
  if (!isHttpUrl(options.input) && !/\.html?$/i.test(options.input)) {
    throw new UsageError(`输入必须是 .html/.htm 文件或 http(s) URL：${options.input}`);
  }
  if (options.fullPage && options.selector !== null) {
    // 两者是两种取景口径：整页要「全」，裁剪要「准」。同时给只会让产物含义说不清 ⇒ 直接拦下。
    throw new UsageError('--full-page 与 --selector 不能同时用（要么截整页，要么按元素裁剪）');
  }
  return options;
}

/** 用法文本（`--help` 与原样打印本文件头注释共用同一份口头禅）。 */
export const USAGE = [
  '用法：node tools/render-shot.mjs <input.html|http(s) URL> --out <out.png> [选项]',
  '  --width <px> / --height <px>   视口尺寸（默认 1280×900）',
  '  --full-page                    截整页并打印页面高度',
  '  --wait-ms <ms>                 渲染后等待（默认 500）',
  '  --json                         结果以 JSON 输出到 stdout',
  '  --browser <path>               显式指定浏览器可执行文件',
  '  --timeout-ms <ms>              CDP 单步超时（默认 30000）',
  '  --keep-profile                 保留临时 profile（排查用）',
  '  --wait-for <css>               截图前等这个选择器出现（超时 ⇒ 失败，不截图）',
  '  --wait-for-timeout <ms>        等锚点超时（默认 15000）',
  '  --selector <css>               只截这个元素的外框（默认截整个视口）',
  '  --click <css> [--click-via js] 截图前点击（默认真鼠标；js = 对最近的外壳 button 派发 click）',
  '  --click-index <n>              点第 n 个命中（0 基，默认 0）',
  '  注意：http://127.0.0.1:3080 是活体 GUI，本工具拒绝访问（无绕过开关）。',
].join('\n');


// ── 路径推导（纯函数；自检的核心面）─────────────────────────────────────────────

/** 由输入文件名推导产物名，并清掉文件名非法字符（`--out` 给的是目录时用）。 */
