/**
 * freeze-rev.mjs —— **freeze-rev 回归基线**（落点 `verify/freeze-rev.json`）。
 *
 * 用途：把「交付态」钉成一串可复算的哈希，任何人换机器/换时间重跑都能确认
 * 「产物与源码还是不是这一版」——它是**回归基线**，不是门禁的替代品（门禁是 build/test/check）。
 *
 * 跑法：
 *   node verify/freeze-rev.mjs            # 校验：与基线逐条比对，任一不符 exit 1
 *   node verify/freeze-rev.mjs --write    # 生成/更新基线（只在确实要换基线时用，并在交付说明里写明）
 *   node verify/freeze-rev.mjs --json     # 机器可读输出（stdout）
 *
 * 覆盖范围（**只读**）：`package.json` / `cordis.patch.yml` / `README.md` / `guide/**` / `src/**` / `lib/**`。
 * ★ `guide/**` 也在覆盖范围内：它是**随包发布**的接入说明（`package.json` 的 `files` 含它），
 *   属交付面 ⇒ 进冻结面。这是**扩大覆盖**（更严），不是放宽任何判据。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PKG_DIR, VERIFY_DIR } from './lib/harness.mjs';

const BASELINE = path.join(VERIFY_DIR, 'freeze-rev.json');
const SCOPE = Object.freeze(['package.json', 'cordis.patch.yml', 'README.md', 'guide', 'src', 'lib']);

function listFiles(relative) {
  const full = path.join(PKG_DIR, ...relative.split('/'));
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return [relative];
  const out = [];
  for (const name of readdirSync(full)) {
    out.push(...listFiles(`${relative}/${name}`));
  }
  return out;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex').toUpperCase();
}

/** 收集当前交付态指纹（排序后逐文件哈希）。 */
export function collectFreezeSnapshot() {
  const files = {};
  for (const relative of SCOPE.flatMap((entry) => listFiles(entry)).sort()) {
    const buffer = readFileSync(path.join(PKG_DIR, ...relative.split('/')));
    files[relative] = { sha256: sha256(buffer), bytes: buffer.length };
  }
  const clientText = readFileSync(path.join(PKG_DIR, 'lib', 'client.js'), 'utf8');
  const hostFiles = Object.keys(files).filter((file) => file.startsWith('lib/host/')).sort();
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    scope: SCOPE,
    artifact: {
      'lib/client.js': {
        sha256: files['lib/client.js']?.sha256 ?? null,
        bytes: files['lib/client.js']?.bytes ?? null,
        // 模块数＝产物里 `__esMod["…"]` 的键数（与 build-client 的「模块数」同口径）
        modules: new Set([...clientText.matchAll(/__esMod\["([^"]+)"\]/g)].map((match) => match[1])).size,
        loadCalls: (clientText.match(/^window\.__ModuleLoader__\.load\(\{/gm) ?? []).length,
      },
    },
    files,
  };
}

function diff(current, baseline) {
  const problems = [];
  const keys = new Set([...Object.keys(current.files), ...Object.keys(baseline.files ?? {})]);
  for (const key of [...keys].sort()) {
    const now = current.files[key];
    const then = baseline.files?.[key];
    if (then === undefined) problems.push(`新增文件：${key}（${now.bytes} 字节）`);
    else if (now === undefined) problems.push(`文件消失：${key}`);
    else if (now.sha256 !== then.sha256) problems.push(`内容变了：${key}（${then.sha256.slice(0, 12)}… → ${now.sha256.slice(0, 12)}…）`);
  }
  const sizeNow = current.artifact['lib/client.js'];
  const sizeThen = baseline.artifact?.['lib/client.js'];
  if (sizeThen !== undefined && sizeNow.sha256 !== sizeThen.sha256) {
    problems.push(`产物变了：lib/client.js ${sizeThen.bytes} → ${sizeNow.bytes} 字节（模块数 ${sizeThen.modules} → ${sizeNow.modules}）`);
  }
  return problems;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly || process.argv.includes('--write') || process.argv.includes('--json')) {
  const write = process.argv.includes('--write');
  const json = process.argv.includes('--json');
  const current = collectFreezeSnapshot();
  if (write) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    if (!json) {
      console.log(`[freeze-rev] 基线已写入 ${path.relative(PKG_DIR, BASELINE)}：${Object.keys(current.files).length} 个文件`);
      console.log(`[freeze-rev] lib/client.js ${current.artifact['lib/client.js'].bytes} 字节 / ${current.artifact['lib/client.js'].modules} 模块 / sha256 ${current.artifact['lib/client.js'].sha256.slice(0, 16)}…`);
    } else {
      console.log(JSON.stringify(current, null, 2));
    }
  } else {
    let baseline = null;
    try {
      baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    } catch {
      baseline = null;
    }
    if (baseline === null) {
      console.error(`[freeze-rev] 基线不存在或不可解析：${path.relative(PKG_DIR, BASELINE)}（先用 --write 生成）`);
      process.exitCode = 1;
    } else {
      const problems = diff(current, baseline);
      if (json) {
        console.log(JSON.stringify({ ok: problems.length === 0, problems, current, baseline: { generatedAt: baseline.generatedAt } }, null, 2));
      } else {
        console.log(`[freeze-rev] 基线 ${baseline.generatedAt}｜当前 ${current.generatedAt}`);
        console.log(`[freeze-rev] 覆盖 ${Object.keys(current.files).length} 个文件；lib/client.js ${current.artifact['lib/client.js'].bytes} 字节 / ${current.artifact['lib/client.js'].modules} 模块`);
        if (problems.length === 0) {
          console.log('[freeze-rev] 与基线**逐字节一致**（无新增/删除/内容变化）');
        } else {
          for (const problem of problems) console.error(`[freeze-rev] ✗ ${problem}`);
          console.error(`[freeze-rev] 共 ${problems.length} 处与基线不符`);
          process.exitCode = 1;
        }
      }
      if (problems.length > 0) process.exitCode = 1;
    }
  }
}
