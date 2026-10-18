/**
 * atomic-write.mjs —— **产物原子写**。
 *
 * 【为什么必须原子写】`lib/client.js` 原先是被**原地重写**的：`writeFile(target, …)` 会先截断再写，
 * 于是「重建窗口期」里任何一次页面加载都可能读到**半截产物** ⇒ 整页 `Failed to load plugins`。
 * 那次插件其实没坏（真机探针全绿、硬刷新即愈），是**构建的写盘方式**造出来的假故障。
 * 修法：先写**同目录**临时文件，再 `rename` 到目标 —— rename 是单步原子操作，
 * 目标路径上要么是旧产物、要么是新产物，**不存在"半截"这个中间态**。
 *
 * 【三条纪律】
 *  ① **临时文件必须与目标同目录**：跨盘/跨卷的 rename 不是原子操作（Windows 上会退化成复制+删除）。
 *     本模块显式检查 `dirname(tmp) === dirname(target)`，不满足直接抛（不许悄悄降级）。
 *  ② **临时文件名带 pid**：多个构建进程/重入调用不会互相踩（`.tmp-<pid>`）。
 *  ③ **失败不留垃圾**：写临时文件失败 ⇒ 清掉临时文件；rename 失败 ⇒ 目标保持**旧**内容（旧的还能用）。
 *
 * 【Windows 上的覆盖式 rename】`fs.rename` 覆盖已存在的目标走的是 `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`
 * 语义，正常情况下能直接覆盖。但杀软/索引器持有句柄时可能返回 `EPERM`/`EACCES`/`EBUSY` ⇒
 * 退化三步：`目标 → .bak-<pid>`、`临时 → 目标`、删 `.bak`；若第二步也失败，把 `.bak` 换回目标（回滚）。
 * 退化路径不静默：`onStep` 会带 `fallback:true` 报出来。
 */
import { promises as defaultFs } from 'node:fs';
import path from 'node:path';

/** 需要走退化三步的 rename 错误码（Windows 上被句柄占住时的典型形态）。 */
export const REPLACE_FALLBACK_CODES = Object.freeze(['EPERM', 'EACCES', 'EBUSY', 'EEXIST']);

/** 临时文件路径：与目标**同目录**，带 pid 后缀。 */
export function tempPathFor(target, pid = process.pid) {
  return `${target}.tmp-${pid}`;
}

/** 备份文件路径（只在退化三步里用）。 */
export function backupPathFor(target, pid = process.pid) {
  return `${target}.bak-${pid}`;
}

/**
 * 退化三步：目标 → .bak、临时 → 目标、删 .bak。失败要回滚（不许把目标弄丢）。
 * @param {object} fs `node:fs/promises` 或同形替身
 * @param {string} tmp 同目录临时文件（已写完）
 * @param {string} target 目标路径
 * @param {number} pid
 * @param {Function|null} onStep 步骤记账
 */
export async function replaceViaBackup(fs, tmp, target, pid, onStep) {
  const backup = backupPathFor(target, pid);
  let hadTarget = false;
  try {
    await fs.rename(target, backup);
    hadTarget = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error; // 目标本来就不在 ⇒ 直接换过去即可
  }
  onStep?.({ step: 'rename-backup', target, backup, hadTarget });
  try {
    await fs.rename(tmp, target);
  } catch (error) {
    if (hadTarget) {
      // 回滚：宁可回到「旧产物还在」，也不要留下「目标不见了」
      try {
        await fs.rename(backup, target);
      } catch {
        // 回滚也失败：原始错误优先上抛（备份文件仍在磁盘上，可人工恢复）
      }
    }
    throw error;
  }
  if (hadTarget) await fs.rm(backup, { force: true });
  onStep?.({ step: 'cleanup-backup', backup });
}

/**
 * 原子写一个文件。
 * @param {string} target 目标路径
 * @param {string} data 内容（UTF-8）
 * @param {{fs?:object, pid?:number, onStep?:(step:object)=>void}} [options]
 *   `fs` 可注入（自检用记录型替身；缺省 `node:fs/promises`）；`onStep` 逐步记账（构建/自检都读它）
 * @returns {Promise<{target:string, tmp:string, bytes:number, fallback:boolean}>}
 */
export async function writeFileAtomic(target, data, options = {}) {
  const fs = options.fs ?? defaultFs;
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const onStep = typeof options.onStep === 'function' ? options.onStep : null;
  const text = typeof data === 'string' ? data : String(data);
  const dir = path.dirname(target);
  const tmp = tempPathFor(target, pid);
  // 纪律①：临时文件必须与目标同目录（跨盘的 rename 不是原子操作）
  if (path.dirname(tmp) !== dir) {
    throw new Error(`原子写的临时文件必须与目标同目录：tmp=${tmp} target=${target}`);
  }
  await fs.mkdir(dir, { recursive: true });
  let moved = false;
  let fallback = false;
  try {
    await fs.writeFile(tmp, text, 'utf8');
    onStep?.({ step: 'write-temp', tmp, target });
    try {
      await fs.rename(tmp, target);
    } catch (error) {
      if (!REPLACE_FALLBACK_CODES.includes(error?.code)) throw error;
      fallback = true;
      await replaceViaBackup(fs, tmp, target, pid, onStep);
    }
    moved = true;
    onStep?.({ step: 'rename', tmp, target, fallback });
    return { target, tmp, bytes: Buffer.byteLength(text, 'utf8'), fallback };
  } finally {
    if (!moved) {
      // 纪律③：失败不留垃圾（目标路径上的旧内容原封不动）
      try {
        await fs.rm(tmp, { force: true });
      } catch {
        // 清理失败不掩盖原始错误
      }
    }
  }
}
