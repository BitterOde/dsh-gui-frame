/**
 * source-face.mjs —— **verify 装置的真源取面**（从 `harness.mjs` **原样搬出**）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么单独成文件】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `harness.mjs` 装上「装载期护栏 + 从真源派生刻度」之后涨到 625 行，越过「非 `src` 面单文件 ≤600 行」
 * 的硬上限 —— **门禁不许违反自己要执行的判据**，且
 * `tests/unit/service-cleanup.test.mjs` 的同名自检会同时判红。搬出的是**取面本身**
 * （路径 / 存在性 / 装载护栏 / 从源码派生的刻度），其余夹具一概留在 `harness.mjs`；
 * `harness.mjs` 对这些名字**原样转出** ⇒ 历史 import 面（`../lib/harness.mjs`）一个都没变。
 *
 * 【为什么要有「护栏」这一层】
 * 实测过一个坑：表驱动的装载点里只要有一条**指向已裁模块**的行，动态 import 会在**装载期**
 * 抛 `ERR_MODULE_NOT_FOUND` ⇒ 整台装置进程死掉 ⇒ `report.print()` 永不执行 ⇒
 * **整套判据静默失效**（比判红更坏：红至少证明装置活着、位置看得见）。
 * 现在：文件不在 ⇒ `sourceExists` 返回 false；`loadSource` 交回 `{ __sourceMissing, loadError }`
 * 而**不抛**，调用方据此判红或记「v1 无被测对象」，**其余判据照跑**。
 *
 * 【本文件只读包内文件，绝不写盘】
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url)); // verify/lib
export const VERIFY_DIR = path.resolve(HERE, '..'); // verify
export const PKG_DIR = path.resolve(VERIFY_DIR, '..'); // dsh-gui-frame

export function pkgPath(...parts) {
  return path.join(PKG_DIR, ...parts);
}

/** 读包内文本文件（UTF-8）。 */
export function readText(...parts) {
  return readFileSync(pkgPath(...parts), 'utf8');
}

/**
 * 静态判「这个 `src/**` 文件在不在」（存在性，不装载）。
 *
 * ★ 表驱动的装载点先问它，再决定要不要 `loadSource` ——
 *   v1 同代裁剪掉了若干能力目录（`layout/**` / `demo/**` / `channel/**` / `window/**` /
 *   `workbench/**`），任何**指向已裁模块的行**都会让动态 import 在装载期抛死，
 *   而装置一崩 ⇒ `report.print()` 永不执行 ⇒ **整套判据静默失效**。
 */
export function sourceExists(rel) {
  return existsSync(pkgPath('src', ...rel.split('/')));
}

/**
 * ★ `loadSource` 从「**会抛**」改成「**取不到就交回一个空件**」。
 *
 * 为什么必须改：装载期的 `ERR_MODULE_NOT_FOUND` 会**终止整个装置进程**，
 * 于是所有判据一条都跑不到、一条读数都印不出来 —— 那是「判据面静默失效」，比判红更坏
 * （红至少说明装置活着）。现在：文件不存在 ⇒ 返回 `{ loadError, __sourceMissing: true }`，
 * 调用方按 `mod.loadError` 判红或记「v1 无被测对象」，**其余判据照跑**。
 *
 * @param {string} rel 相对 `src/` 的路径（如 `client/dock.mjs`）
 * @returns {Promise<object>} 真实模块命名空间，或 `{ loadError, __sourceMissing, __rel }`
 */
export async function loadSource(rel) {
  if (!sourceExists(rel)) {
    return { __sourceMissing: true, __rel: rel, loadError: `${rel} 不存在（同代裁剪后已删 / 或路径写错）` };
  }
  try {
    return await import(pathToFileURL(pkgPath('src', ...rel.split('/'))).href);
  } catch (error) {
    return { __sourceMissing: true, __rel: rel, loadError: `${rel} 装载失败：${error?.message ?? error}` };
  }
}

/**
 * 从 `entry.mjs` 源码里读出 `const env = { … }` 的**字面键名**（不跑装配、不猜）。
 * 只认该对象**自身**的键：缩进 4–6 空格起头（4 空格是第一层，6 空格是长行续行），
 * 冒号可省（`service,` 这种简写也是键）；遇到 `};` 或注释行即收工。
 */
export function readEnvKeys(text) {
  const at = text.indexOf('const env = {');
  if (at < 0) return [];
  const keys = [];
  for (const line of text.slice(at).split('\n').slice(1)) {
    if (/^\s*};?\s*$/.test(line)) break;
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    const m = /^\s{4,6}([A-Za-z_$][\w$]*)\s*(?::|,)/.exec(line);
    if (m !== null) keys.push(m[1]);
  }
  return keys;
}

// ★ 本模块的三个「刻度」全部**从 v1 真源派生**（见各自的常量注释）：
//   · `CONSUMED_SLOT_KEYS`    ← `src/client/contracts/service-face.mjs`
//   · `CAPABILITY_ORDER`      ← `src/client/entry.mjs`（顺序即契约）
//   · `env` 的键集            ← `src/client/entry.mjs`（**源码扫描**：v1 去掉了 `workspace`）
//
// ⚠ 下面两处「前置真源」是**唯一允许抛**的地方：这两个面若取不到，装置的所有判据都没有对象，
//   此时**应当**响亮地死掉（而不是交出一份恒真/恒假的读数）。已裁能力的缺失不走这条路 ——
//   它们由各判据点自己判红或记「v1 无被测对象」。
const serviceFaceMod = await loadSource('client/contracts/service-face.mjs');
if (serviceFaceMod.__sourceMissing === true) throw new Error(`verify 夹具的前置真源缺失：${serviceFaceMod.loadError}`);
export const CONSUMED_SLOT_KEYS = serviceFaceMod.CONSUMED_SLOT_KEYS;

const entrySource = readText('src', 'client', 'entry.mjs');
const entryMod = await loadSource('client/entry.mjs');
if (entryMod.__sourceMissing === true) throw new Error(`verify 夹具的前置真源缺失：${entryMod.loadError}`);
const ENTRY_CAPABILITY_ORDER = entryMod.CAPABILITY_ORDER;
const ENTRY_ENV_KEYS = readEnvKeys(entrySource);

/**
 * 期望的装配顺序（**从 `entry.mjs` 的 `CAPABILITY_ORDER` 派生**，不抄字面量）。
 *
 * ★ v2 那份写死八项（`dock/theme/channel/panel/overlay/window/layout/demo`），
 * v1 的 `CAPABILITY_ORDER` 只有四项（dock / theme / panel / overlay），且**顺序即契约**
 * ——派生式写法让「有人往装配表里插一项」这件事在本装置上立刻可见，而不是靠人记得改夹具。
 */
export const EXPECTED_CAPABILITY_ORDER = Object.freeze(ENTRY_CAPABILITY_ORDER.map((step) => step.capability));

/**
 * 装配面 `env` 的键集（**从 `entry.mjs` 实际读到的键派生**，不抄字面量）。
 *
 * ★ v2 那份是 `['service','seeds','workspace','schedule','cancel','diagnostics']`
 * ——v1 的 `entry.mjs` **不再组装 `workspace`**（布局能力已裁），故派生式写法的结果自然少一个键。
 */
export const EXPECTED_ENV_KEYS = Object.freeze([...ENTRY_ENV_KEYS]);
