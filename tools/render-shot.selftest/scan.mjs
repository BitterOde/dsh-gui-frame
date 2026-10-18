// tools/render-shot.selftest/scan.mjs —— 静态纪律的**扫描面**：入口 + 拆分出的全部子模块。
// 口径（只收紧，不放宽）：拆成多文件后，F1–F4 / S1–S7，以及内存闸那几条的字面量判据必须覆盖**整片**工具源码，
// 否则判据会在入口空壳上"通过"——判据空转即静默放宽。子模块由目录枚举得到 ⇒ 以后新增文件自动纳入。
// 位置类判据（「内存闸先于起进程」）读的是本拼接串：**入口排在首位**，而 `main` 就在入口里，
// 所以那两条 indexOf 比较仍在同一文件内部成立。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { codeOnly } from './kit.mjs';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SOURCE_FILE = path.join(HERE, 'render-shot.mjs');
export const SHOT_SOURCE_FILE = path.join(HERE, 'dsh-shot.mjs');

/** 某目录下的全部 `.mjs`（排序；目录不存在时回空表，便于"还没拆分"时照常跑）。 */
function moduleFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith('.mjs')).sort().map((name) => path.join(dir, name));
}

export const RENDER_SOURCE_FILES = [SOURCE_FILE, ...moduleFiles(path.join(HERE, 'render-shot'))];
export const SHOT_SOURCE_FILES = [SHOT_SOURCE_FILE, ...moduleFiles(path.join(HERE, 'dsh-shot'))];

/** 去注释后的整片源码（渲染器：入口 + 子模块）。 */
export const sourceCode = RENDER_SOURCE_FILES.map((file) => codeOnly(readFileSync(file, 'utf8'))).join('\n');
/** 去注释后的整片源码（编排器：入口 + 子模块）。 */
export const shotSourceCode = SHOT_SOURCE_FILES.map((file) => codeOnly(readFileSync(file, 'utf8'))).join('\n');
