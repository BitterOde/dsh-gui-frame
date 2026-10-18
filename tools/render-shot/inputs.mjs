// tools/render-shot/inputs.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 输入与输出目标解析（file:// / URL / 3080 红线 / 产物名推导）

import { LIVE_GUI_PORT, UsageError } from './constants.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function outStemFor(inputPath) {
  const stem = path.basename(inputPath).replace(/\.html?$/i, '');
  const safe = stem.replace(/[\\/:*?"<>|]/g, '_');
  return safe === '' ? 'shot' : safe;
}

/** 输入是不是 http(s) 地址（真机实例的启动 URL 走这条路；相对路径与 `file://` 仍按文件算）。 */
export function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * URL 输入的产物名：`主机-端口`（带路径时拼最后一段）。
 * **绝不带 query**：真机启动 URL 的 `?token=…` 是凭据，落进文件名等于把它写进证据目录。
 */
export function urlStemFor(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return 'shot';
  }
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  const last = segments.length === 0 ? '' : segments[segments.length - 1].replace(/\.html?$/i, '');
  const host = parsed.port === '' ? parsed.hostname : `${parsed.hostname}-${parsed.port}`;
  const stem = (last === '' ? host : `${host}-${last}`).replace(/[\\/:*?"<>|]/g, '_');
  return stem === '' ? 'shot' : stem;
}

/**
 * **3080 红线**：`http://127.0.0.1:3080` 是用户正在用的 DSH GUI（用户级硬约束：绝不碰）。
 * 这里按**用法错误**拦下（exit 2）而不是运行期错误：撞上它是「你把目标写错了」，不是环境问题。
 * 刻意**不提供**绕过开关 —— 「绝不碰」是用户级约束，不是默认值。
 */
export function assertNotLiveGuiUrl(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError(`不是合法的 URL：${url}`);
  }
  const host = parsed.hostname;
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (loopback && parsed.port === String(LIVE_GUI_PORT)) {
    throw new UsageError(
      `拒绝访问 127.0.0.1:${LIVE_GUI_PORT} —— 那是用户正在使用的 DSH GUI（绝不碰）。` +
        '对真机出图请用**独立端口**实例：node tools/dsh-shot.mjs（见 tools/render-shot.README.md）',
    );
  }
  return url;
}

/**
 * `--out` 既接受文件路径，也接受目录。
 * 判"是目录"只看两条**确定**信号：以分隔符结尾，或该路径已存在且是目录 ——
 * 不去猜"没有扩展名就是目录"（那会把 `--out shot` 变成目录，反直觉）。
 * @param {{input:string, out:string, cwd?:string, isDirectory?:(p:string)=>boolean, stem?:string}} args
 */
export function deriveOutPath(args) {
  const { input, out } = args;
  const cwd = args.cwd ?? process.cwd();
  const isDirectory = args.isDirectory ?? (() => false);
  const resolved = path.resolve(cwd, out);
  const trailingSeparator = /[\\/]$/.test(out);
  if (trailingSeparator || isDirectory(resolved)) {
    const stem = args.stem ?? outStemFor(input);
    return path.join(resolved, `${stem}.png`);
  }
  return resolved;
}


/**
 * 把输入/输出解析成绝对路径 + file URL，并做**启动浏览器之前**就能做的全部校验。
 * 顺序很关键：先报"文件不存在"，不要因为环境里没有浏览器而掩盖"我把路径写错了"。
 * @param {{input:string, out:string, cwd?:string, exists?:(p:string)=>boolean, isDirectory?:(p:string)=>boolean}} args
 */
export function resolveInputs(args) {
  const cwd = args.cwd ?? process.cwd();
  const exists = args.exists ?? existsSync;
  const isDirectory = args.isDirectory ?? (() => false);
  const inputPath = path.resolve(cwd, args.input);
  if (!exists(inputPath)) throw new UsageError(`输入文件不存在：${inputPath}`);
  if (isDirectory(inputPath)) throw new UsageError(`输入是目录不是文件：${inputPath}`);
  const outPath = deriveOutPath({ input: args.input, out: args.out, cwd, isDirectory });
  if (exists(outPath) && isDirectory(outPath)) throw new UsageError(`输出路径是一个目录（--out 需要文件或目录前缀）：${outPath}`);
  return { inputPath, outPath, fileUrl: pathToFileURL(inputPath).href };
}

/**
 * 解析**目标**：本地 HTML 文件**或**真机实例的 http(s) 地址（两选一）。
 * 顺序刻意如此：URL 不做文件存在性检查；文件目标仍走 `resolveInputs` 的全套校验
 * （"路径写错了"必须在起浏览器之前就报出来）。
 * @returns {{kind:'file'|'url', target:string, fileUrl:string|null, inputPath:string|null, outPath:string}}
 */
export function resolveTargets(args) {
  const cwd = args.cwd ?? process.cwd();
  const exists = args.exists ?? existsSync;
  const isDirectory = args.isDirectory ?? (() => false);
  const raw = String(args.input ?? '').trim();
  if (isHttpUrl(raw)) {
    const url = assertNotLiveGuiUrl(raw);
    const outPath = deriveOutPath({ input: raw, out: args.out, cwd, isDirectory, stem: urlStemFor(raw) });
    if (exists(outPath) && isDirectory(outPath)) {
      throw new UsageError(`输出路径是一个目录（--out 需要文件或目录前缀）：${outPath}`);
    }
    return { kind: 'url', target: url, fileUrl: null, inputPath: null, outPath };
  }
  const file = resolveInputs({ input: args.input, out: args.out, cwd, exists, isDirectory });
  return { kind: 'file', target: file.fileUrl, fileUrl: file.fileUrl, inputPath: file.inputPath, outPath: file.outPath };
}


// ── CDP 命令字面量（纯函数；自检断言的就是这一段"形状"）────────────────────────

/** 取整页高度（CSS px）：取滚动高度与文档高度的最大值，空页退回视口高度（不能报 0）。 */
