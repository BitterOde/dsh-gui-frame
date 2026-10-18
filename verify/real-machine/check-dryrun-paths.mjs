// verify/real-machine/check-dryrun-paths.mjs —— 机检：装置 `--dry-run` 的**路径项逐字断言**
// 为什么要有它：`lib/config.mjs` 拆出来时 HERE 少回一层 ⇒ PKG_DIR 指到 `verify/`、LINK_SPEC 多出 `/verify`、
// OUT_ROOT 落到 `lib/evidence`；当时只比了「横幅行数」没比内容，缺陷一路漏到真机才炸。
// **防复发工具**：任何拆分/搬家真机装置的轮次，收尾都该跑它。
// 口径（可判定，不接受「除路径外一致」）：
//   ① 每棵树各自断言三项：PKG_DIR === 该树包根、LINK_SPEC === 'link:'+PKG_DIR、OUT_ROOT === 该树 verify/real-machine/evidence；
//   ② 再把「现树」与「冻结的基线副本」两份横幅做**归一化后逐字比对**——只允许替换三样外部量：
//      树包根前缀 <PKG>、时间戳 <STAMP>、临时 profile 名 <PROFILE>（三者都由脚本显式替换，替换后必须完全相等）。
// 用法（在**包目录** `dsh-gui-frame/` 下跑；脚本自己按模块位置定位，不依赖 cwd）：
//   node verify/real-machine/check-dryrun-paths.mjs             # ① 本树三项断言 ② 与基线副本归一化后逐字比对
//   node verify/real-machine/check-dryrun-paths.mjs --selftest  # 阴性对照：把 LINK_SPEC 伪造成旧的错值，必须判红
// 搬入仓内的改动（**只动本文件内部**）：包根/工作区改为按 `import.meta.url` 推导（原落点 `.tmp-refactor/assets/`
// 是临时目录，会被清）；基线副本不在时，跨树比对**记「未参与」并醒目打印**（不当成通过），
// 本树三项断言与 `--selftest` 阴性对照照常生效。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** 本文件所在目录 ＝ `<包>/verify/real-machine/`。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 现树包根 `dsh-gui-frame/`。 */
const NOW_ROOT = path.resolve(HERE, '..', '..');
/** 工作区根（仅用于定位基线副本）。 */
const WS = path.dirname(NOW_ROOT);
/** 冻结的基线副本（跨树逐字比对的参照；不在时按「未参与」登记，不当成通过）。可用 `GUIF_BASE_ROOT` 指向别处的副本。 */
const BASE_ROOT = process.env.GUIF_BASE_ROOT
  ?? path.join(WS, '.tmp-refactor/baseline/2026-10-04T04-37-27-596Z/dsh-gui-frame');

const readBuf = (p) => { const b = fs.readFileSync(p); return (b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le') : b.toString('utf8')).replace(/^\ufeff/, ''); };

/** 跑一次 dry-run，返回 { code, text }（**不传 --out**：要测的就是 OUT_ROOT 的默认分支）。 */
export function dryRun(pkgRoot) {
  const script = path.join(pkgRoot, 'verify/real-machine/run.mjs');
  try {
    const out = execFileSync(process.execPath, [script, '--dry-run'], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
    const text = out[0] === 0xff && out[1] === 0xfe ? out.toString('utf16le') : out.toString('utf8');
    return { code: 0, text };
  } catch (error) {
    const raw = Buffer.concat([error.stdout ?? Buffer.alloc(0), error.stderr ?? Buffer.alloc(0)]);
    const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
    return { code: error.status ?? -1, text };
  }
}

/** 从横幅里抠出三项路径读数。 */
export function parseBanner(text) {
  const grab = (re) => { const m = re.exec(text); return m === null ? null : m[1]; };
  return {
    linkSpec: grab(/link 规格：(.+)/),
    outDir: grab(/证据目录：(.+)/),
    home: grab(/\$DSH_HOME（\*\*隔离\*\*）：([^（]+)/),
    settings: grab(/settings\.yaml（判据读的就是这一份）：(.+)/),
    edgeDir: grab(/Edge user-data-dir（专属回收标记）：(.+)/),
  };
}

/** 三项断言（纯函数：阴性对照直接拿它试错值）。 */
export function assertPaths(pkgRoot, banner) {
  const problems = [];
  const expectPkg = path.resolve(pkgRoot).replace(/\\/g, '/');
  const gotPkg = banner.linkSpec === null ? null : banner.linkSpec.replace(/^link:/, '');
  if (gotPkg !== expectPkg) problems.push(`PKG_DIR/LINK_SPEC 不对：期望 link:${expectPkg}，实得 ${banner.linkSpec}`);
  const expectOutRoot = path.join(pkgRoot, 'verify/real-machine/evidence').replace(/\\/g, '/');
  const gotOutRoot = banner.outDir === null ? null : path.dirname(banner.outDir).replace(/\\/g, '/');
  if (gotOutRoot !== expectOutRoot) problems.push(`OUT_ROOT 不对：期望 ${expectOutRoot}，实得 ${gotOutRoot}`);
  if (banner.outDir !== null && path.basename(banner.outDir) === '') problems.push('证据目录缺时间戳段');
  return problems;
}

/** 归一化：只替换树包根 / 时间戳 / 临时 profile 名。 */
export function normalize(text, pkgRoot, profile, stamp) {
  let s = text;
  s = s.split(path.resolve(pkgRoot)).join('<PKG>');
  s = s.split(path.resolve(pkgRoot).replace(/\\/g, '/')).join('<PKG>');
  s = s.split(stamp).join('<STAMP>');
  s = s.split(profile).join('<PROFILE>');
  return s;
}

const PROFILE_RE = /临时 profile：(guifrm[0-9a-z]+)｜/;
// 证据目录行的**行尾**才是本轮时间戳：基线副本的路径里本身含快照戳（…T04-37-27-596Z）⇒ 必须锚到行尾，不能懒匹配取第一个。
const STAMP_RE = /证据目录：[^\n]*?([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z)\s*$/m;

if (process.argv[1] && process.argv[1].endsWith('check-dryrun-paths.mjs')) {
  if (process.argv.includes('--selftest')) {
    // 阴性对照：把那个错值（PKG_DIR 指到 verify/）喂给同一断言函数 ⇒ 必须判红
    const banner = { linkSpec: 'link:D:/MyPlugins/GUIFrame/dsh-gui-frame/verify', outDir: 'D:/MyPlugins/GUIFrame/dsh-gui-frame/verify/real-machine/lib/evidence/2026-10-04T00-00-00-000Z', home: 'x', settings: 'x', edgeDir: 'x' };
    const problems = assertPaths(NOW_ROOT, banner);
    const ok = problems.length >= 2;
    console.log(`[dryrun-paths] 阴性对照：喂入那个错值（`+`LINK_SPEC=…/verify`+`）⇒ 断言报 ${problems.length} 条错：`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log(`[dryrun-paths] ${ok ? '✓ 判红（有牙）' : '✗ 没抓住'}`);
    process.exitCode = ok ? 0 : 1;
  } else {
    const baseEntry = path.join(BASE_ROOT, 'verify/real-machine/run.mjs');
    const baseExists = fs.existsSync(baseEntry);
    const trees = baseExists ? [['现树', NOW_ROOT], ['基线副本', BASE_ROOT]] : [['现树', NOW_ROOT]];
    const banners = [];
    let bad = 0;
    const normed = [];
    for (const [label, root] of trees) {
      const script = path.join(root, 'verify/real-machine/run.mjs');
      if (!fs.existsSync(script)) { console.log(`[dryrun-paths] ✗ ${label} 缺入口：${script}`); bad += 1; continue; }
      const { code, text } = dryRun(root);
      const banner = parseBanner(text);
      const problems = assertPaths(root, banner);
      const profile = (PROFILE_RE.exec(text) ?? [, null])[1];
      const stamp = (STAMP_RE.exec(text) ?? [, null])[1];
      console.log(`[dryrun-paths] ${label}：exit=${code}｜profile=${profile}｜`);
      console.log(`  PKG_DIR/LINK_SPEC = ${banner.linkSpec}`);
      console.log(`  OUT_ROOT（证据目录）= ${banner.outDir}`);
      console.log(`  settings.yaml = ${banner.settings}`);
      if (code !== 0) { console.log(`  ✗ exit≠0`); bad += 1; }
      for (const p of problems) { console.log(`  ✗ ${p}`); bad += 1; }
      if (profile === null || stamp === null) { console.log('  ✗ 横幅里找不到 profile/时间戳（判据本身失效）'); bad += 1; }
      else { banners.push([label, text]); normed.push([label, normalize(text, root, profile, stamp)]); }
    }
    if (normed.length === 2) {
      const [a, b] = normed;
      const same = a[1] === b[1];
      console.log(`[dryrun-paths] 归一化后逐字比对（只替换 <PKG>/<STAMP>/<PROFILE>）：${same ? '✓ 完全相等' : '✗ 不等'}`);
      if (!same) {
        bad += 1;
        const la = a[1].split('\n'); const lb = b[1].split('\n');
        for (let i = 0; i < Math.max(la.length, lb.length); i += 1) if (la[i] !== lb[i]) console.log(`  差异 行${i + 1}：\n    现树    : ${la[i]}\n    基线副本: ${lb[i]}`);
      }
    } else if (!baseExists) {
      // **不当成通过**：只是这份参照不在了（临时目录会被清），本树三项断言与 `--selftest` 仍然生效。
      console.log(`[dryrun-paths] ⚠ 跨树逐字比对**未参与**：基线副本不在（${baseEntry}）——`);
      console.log('  这是「参照副本缺失」，**不是判据通过**；本树三项逐字断言与 --selftest 阴性对照照常生效。');
    }
    process.exitCode = bad === 0 ? 0 : 1;
  }
}
