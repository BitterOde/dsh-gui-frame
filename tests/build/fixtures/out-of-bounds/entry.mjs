/**
 * fixtures/out-of-bounds/entry.mjs —— **故意越界**的源码夹具（独立复验用，勿并入 src/client）。
 *
 * 越界点：`../outside.mjs` 用 `../` 从 `src/client` 根**爬出去**——
 * 「有限深度」允许向上，但绝不允许越出根。
 *
 * 期望（`tests/build/builder-guards.test.mjs` 的越界用例）：
 *   ① CLI exit≠0 且 stderr 含「越出 src/client 根目录」；
 *   ② 不写 `lib/client.js`（失败而不是落半成品）；
 *   ③ **本文件一个字节都不被改写**（失败而非静默"帮你"修好）——指纹前后比对。
 */
import { outside } from '../outside.mjs';

export function createClientModule() {
  return { apply: outside, inject: [] };
}
