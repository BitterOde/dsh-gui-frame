/**
 * public-surface.mjs —— **L1 公开面快照**的生成 / 校验入口（真源：`scripts/public-surface.describe.mjs`）。
 *
 * 用法：
 *   node scripts/public-surface.mjs            # = --check：与 tests/contracts/public-surface.json 逐字节比对，不一致 ⇒ exit 1
 *   node scripts/public-surface.mjs --check
 *   node scripts/public-surface.mjs --write    # 用当前源码重写快照档（**改了公开面才这么干**，然后提交 diff 给人看）
 *
 * 为什么要有这条命令：快照的意义不是「永远不变」，而是**变的时候必须有人看见**。
 * 单测 `tests/unit/service.test.mjs` 也会做同样的比对（`npm test` 里就有），
 * 这里多一条 CLI 是为了让人能一条命令重生成、并在 CI/收口脚本里单独检查。
 *
 * 本脚本属服务面冻结；`--write` 只写 `tests/contracts/public-surface.json` 一个文件。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_SURFACE_PATH, serializePublicSurface } from './public-surface.describe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const TARGET = path.join(PKG_DIR, ...PUBLIC_SURFACE_PATH.split('/'));

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const unknown = argv.filter((flag) => flag !== '--write' && flag !== '--check');
if (unknown.length > 0) {
  console.error(`[public-surface] 未知参数：${unknown.join(' ')}（只认 --write / --check）`);
  process.exitCode = 1;
} else {
  const expected = serializePublicSurface();
  if (write) {
    await mkdir(path.dirname(TARGET), { recursive: true });
    await writeFile(TARGET, expected, 'utf8');
    console.log(`[public-surface] 已写入 ${PUBLIC_SURFACE_PATH}（${Buffer.byteLength(expected, 'utf8')} 字节）`);
  } else {
    let current = null;
    try {
      current = await readFile(TARGET, 'utf8');
    } catch {
      current = null;
    }
    if (current === null) {
      console.error(`[public-surface] 缺少快照档 ${PUBLIC_SURFACE_PATH} —— 跑 node scripts/public-surface.mjs --write 生成`);
      process.exitCode = 1;
    } else if (current !== expected) {
      console.error(`[public-surface] 公开面与快照不一致：${PUBLIC_SURFACE_PATH}`);
      console.error('[public-surface] 期望（由当前源码生成）：');
      console.error(expected);
      console.error('[public-surface] 实际（磁盘上的快照档）：');
      console.error(current);
      console.error('[public-surface] 若这次改动是**有意的**公开面变更 ⇒ 跑 --write 重生成并把 diff 提交给人看；否则请回退源码。');
      process.exitCode = 1;
    } else {
      console.log(`[public-surface] ✔ 与 ${PUBLIC_SURFACE_PATH} 逐字节一致（${Buffer.byteLength(expected, 'utf8')} 字节）`);
    }
  }
}
