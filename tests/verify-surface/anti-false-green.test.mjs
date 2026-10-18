/**
 * anti-false-green.test.mjs —— 独立复验（六）：**验证这套验证自己的牙**（反假绿）。
 *
 * 「公开面快照比对全绿」本身不是证据：必须证明**改一个导出名会让它变红**。
 * 做法：把包骨架（package.json / src / tests / scripts）复制进系统 TEMP，在副本里做**一次定向变异**，
 * 再用 `--test-reporter=tap` 跑 `tests/verify-surface/public-surface.test.mjs`，断言：
 *   ① 子进程 exit≠0（确实变红）；② 红的那条正是被变异命中的判据（不是别处崩了）。
 * 副本用完即删 —— **绝不碰包内文件**（末尾再用 sha256 复核真快照逐字节未变）。
 *
 * ★ **变异靶点全部落在真实公开面上**，且逐条可自证命中：
 *   · `impl-rename`            实现（`service/core.mjs`）里的原型方法 `register` 改名；
 *   · `decl-rename`            声明表 `SERVICE_METHODS` 里的方法名改名（靶文本从声明表现算）；
 *   · `decl-namespace-rename`  声明表 `SERVICE_NAMESPACES` 里的命名空间名改名（同上）；
 *   · `code-add`               错误码冻结数组里加一条未冻结码；
 *   · `component-rename`       `components` 冻结名改名；
 *   · `snapshot-slot-drop`     声明表 `CONSUMED_SLOT_KEYS` 删一条座位键（收取面缩水）；
 *   · `snapshot-drop`          被验快照档自身删字段。
 *   每条都由 `mutateFile` 的「必须真命中」断言兜底：靶点若因结构变化打空，整条**判红并明说没验到**。
 *   `SLICE_NAMES` 没有对应的定向变异：它是**装配白名单**，不进公开面快照，本套件（只跑
 *   `public-surface.test.mjs`）里没有任何判据能观察到它 —— 为它造变异只会得到一条恒绿的假牙。
 *
 * ★ 子进程必须清掉 `NODE_TEST_CONTEXT`：否则它会打印
 *   「node:test run() is being called recursively within a test file. skipping running files.」
 *   然后空跑 exit 0，把每一条「必须变红」都变成假绿。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { PKG_DIR, SNAPSHOT_PATH, listFilesRecursive, runSuiteInCopy, sha256, srcPath } from './harness.mjs';

/**
 * 变异靶点从**声明表**现算（见下面 `methodListLiteral` 的说明）。
 * 这里只 import 常量（零副作用模块），保证靶点跟随契约走。
 */
const serviceFaceForMutation = await import(pathToFileURL(srcPath('client', 'contracts', 'service-face.mjs')).href);

const TARGET_SUITE = path.join('tests', 'verify-surface', 'public-surface.test.mjs');

/** 在**副本**里改文件（路径一律从 tmp 派生）。 */
function mutateFile(tmp, rel, transform) {
  const file = path.join(tmp, ...rel.split('/'));
  const before = readFileSync(file, 'utf8');
  const after = transform(before);
  assert.notEqual(after, before, `变异必须真的命中 ${rel}（否则该变异用例是空转）`);
  writeFileSync(file, after, 'utf8');
}

/**
 * ★ **变异靶点自取声明表**，不抄字面量。
 * 原实现把靶字符串写死成 `['channel', 'register', 'supports']`（v2 的方法集）。v1 裁剪后方法集是
 * `['register', 'supports']` ⇒ `String.replace` 打空 ⇒ `mutateFile` 的「必须真命中」断言把整个用例
 * 判红，而**真正该被判红的判据根本没被验到**。改成从 `SERVICE_METHODS` 现算靶文本：
 * 靶点跟着声明走 ⇒ 声明漂移不会静默退化成「空转变异」，`mutateFile` 的命中断言仍然照旧生效。
 */
const SERVICE_METHODS = serviceFaceForMutation.SERVICE_METHODS;
const methodListLiteral = `Object.freeze([${[...SERVICE_METHODS].sort().map((name) => `'${name}'`).join(', ')}])`;

const MUTATIONS = [
  {
    id: 'impl-rename',
    label: '把实现里的原型方法 register 改名（实现漂移）',
    expect: '公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合',
    // 服务面实例在 `src/client/service/core.mjs` —— 变异靶点跟着实现走
    // （**判据一字未改**：仍然要求「改了实现里的原型方法名 ⇒ 快照断言必须变红」，且必须真命中该文件）。
    mutate: (tmp) => mutateFile(tmp, 'src/client/service/core.mjs', (text) => text.replace('  register(entry, Component) {', '  registerEntry(entry, Component) {')),
  },
  {
    id: 'decl-rename',
    label: '把声明表 SERVICE_METHODS 里的 register 改名（声明漂移）',
    expect: '公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合',
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/service-face.mjs', (text) => {
      assert.ok(text.includes(methodListLiteral), `变异靶点必须在场：SERVICE_METHODS 的字面量应为 ${methodListLiteral}`);
      return text.replace(methodListLiteral, methodListLiteral.replace("'register'", "'registerEntry'"));
    }),
  },
  {
    id: 'decl-namespace-rename',
    label: '把声明表 SERVICE_NAMESPACES 里的 dock 改名（命名空间声明漂移）',
    expect: '公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合',
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/service-face.mjs', (text) => {
      const literal = `Object.freeze([${[...serviceFaceForMutation.SERVICE_NAMESPACES].sort().map((name) => `'${name}'`).join(', ')}])`;
      assert.ok(text.includes(literal), `变异靶点必须在场：SERVICE_NAMESPACES 的字面量应为 ${literal}`);
      return text.replace(literal, literal.replace("'dock'", "'dockPanel'"));
    }),
  },
  {
    id: 'code-add',
    label: '往错误码冻结数组里加一个新码（未冻结的码）',
    expect: '声明 ↔ 运行期 ↔ 快照三方一致（成员来自原型链反射，不是读常量）',
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/errors.mjs', (text) => text.replace("  'GUIF-E-CTX-INVALID',", "  'GUIF-E-T18-PROBE',\n  'GUIF-E-CTX-INVALID',")),
  },
  {
    id: 'component-rename',
    label: '把 components 冻结名 Panel 改名',
    expect: '公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合',
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/components.mjs', (text) => text.replace("'Panel'", "'PanelX'")),
  },
  {
    id: 'snapshot-slot-drop',
    label: '从声明表 CONSUMED_SLOT_KEYS 里删掉一个座位键（收取面缩水）',
    expect: '公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合',
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/service-face.mjs', (text) => {
      const literal = `Object.freeze([${[...serviceFaceForMutation.CONSUMED_SLOT_KEYS].sort().map((name) => `'${name}'`).join(', ')}])`;
      assert.ok(text.includes(literal), `变异靶点必须在场：CONSUMED_SLOT_KEYS 的字面量应为 ${literal}`);
      const dropped = [...serviceFaceForMutation.CONSUMED_SLOT_KEYS][0];
      return text.replace(literal, `Object.freeze([${serviceFaceForMutation.CONSUMED_SLOT_KEYS.filter((name) => name !== dropped).map((name) => `'${name}'`).join(', ')}])`);
    }),
  },
  {
    id: 'snapshot-drop',
    label: '把被验快照档里的 slots 字段删掉（快照自身被改写）',
    expect: '公开面逐字节比对：服务成员 / components 名 / slot 键 / inject 列表 / 错误码集合',
    mutate: (tmp) => mutateFile(tmp, 'tests/contracts/public-surface.json', (text) => {
      const parsed = JSON.parse(text);
      delete parsed.slots;
      return `${JSON.stringify(parsed, null, 2)}\n`;
    }),
  },
];

test('反向验证：故意改一个导出名 ⇒ 快照断言必须变红（逐条定向变异）', async () => {
  const snapshotBefore = sha256(readFileSync(SNAPSHOT_PATH, 'utf8'));
  // 服务面实例在 `src/client/service/core.mjs` ⇒ 「变异层不许碰真源码」这一条**同时盯两个文件**（只收紧）。
  const GUARDED_SOURCES = [
    path.join(PKG_DIR, 'src', 'client', 'service.mjs'),
    path.join(PKG_DIR, 'src', 'client', 'service', 'core.mjs'),
  ];
  const sourceBefore = GUARDED_SOURCES.map((file) => sha256(readFileSync(file, 'utf8')));
  const uncaught = [];
  const caught = [];

  for (const mutation of MUTATIONS) {
    const result = await runSuiteInCopy({ mutate: (tmp) => mutation.mutate(tmp), testFiles: [TARGET_SUITE] });
    // 变异自己先崩（靶点打空等）⇒ 单列一类，不冒充「已被抓住」也不冒充「假绿」
    if (result.status === null) {
      uncaught.push(`${mutation.id}（${mutation.label}）：变异层自身失败（靶点打空 / 写盘失败），本条**没有验到任何判据** —— ${result.setupError}`);
      continue;
    }
    if (result.status === 0) {
      uncaught.push(`${mutation.id}（${mutation.label}）：副本里仍然全绿 —— 假绿！`);
      continue;
    }
    if (!result.failing.some((name) => name.includes(mutation.expect))) {
      uncaught.push(`${mutation.id}（${mutation.label}）：确实变红了，但红的不是 ${mutation.expect}（说明该判据本体空转）—— 失败项：${result.failing.join(' ｜ ')}`);
      continue;
    }
    caught.push(mutation.id);
  }

  assert.deepEqual(uncaught, [], `以下变异没有被抓住：\n  - ${uncaught.join('\n  - ')}`);
  assert.equal(caught.length, MUTATIONS.length);

  // 变异层只在 TEMP 副本里动手：真源码与真快照必须逐字节未变
  assert.equal(sha256(readFileSync(SNAPSHOT_PATH, 'utf8')), snapshotBefore, '变异层绝不许触碰包内的 tests/contracts/public-surface.json');
  assert.deepEqual(GUARDED_SOURCES.map((file) => sha256(readFileSync(file, 'utf8'))), sourceBefore, '变异层绝不许触碰包内的 src/**');
});

test('阴性对照：不做任何变异 ⇒ 同一套件必须全绿（判据不是一票否决）', async () => {
  const result = await runSuiteInCopy({ testFiles: [TARGET_SUITE] });
  assert.equal(result.status, 0, `无变异时本该全绿：\n${result.out.slice(-1600)}`);
  assert.deepEqual(result.failing, []);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 扩表反证：**合法**的公开面变更（增/删错误码 + 同步重生成快照）不得被断言打红。
// 反过来说明公开面判据不写死条数；同时保留一条「非族前缀码必须变红」的牙齿，防止结构判据空转。
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** 在副本里改码表，再用**副本自己的**生成器重写快照（= 改公开面必须走的既有流程）。 */
async function runExtension(item) {
  return runSuiteInCopy({
    include: ['src', 'tests', 'scripts'],
    testFiles: [TARGET_SUITE],
    mutate: async (tmp) => {
      await item.mutate(tmp);
      const regen = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'public-surface.mjs'), '--write'], {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.equal(regen.status, 0, `${item.id}：副本里重生成快照必须成功 —— ${regen.stderr || regen.stdout}`);
    },
  });
}

const EXTENSION_CASES = [
  {
    id: 'extend-warning',
    label: '给 WARNING_CODES 增一条 + 同步重生成快照（合法扩表）',
    expectGreen: true,
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/errors.mjs', (text) => text.replace(
      'export const WARNING_CODES = Object.freeze([',
      "export const WARNING_CODES = Object.freeze(['GUIF-W-T25-PROBE',",
    )),
  },
  {
    id: 'extend-error',
    label: '给 ERROR_CODES 增一条 + 同步重生成快照（合法扩表）',
    expectGreen: true,
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/errors.mjs', (text) => text.replace(
      'export const ERROR_CODES = Object.freeze([',
      "export const ERROR_CODES = Object.freeze(['GUIF-E-T25-PROBE',",
    )),
  },
  {
    id: 'retire-warning',
    label: '从 WARNING_CODES 删一条（其 src 引用改指另一条冻结码）+ 同步重生成快照（合法退役）',
    expectGreen: true,
    mutate: async (tmp) => {
      const errorsRel = 'src/client/contracts/errors.mjs';
      const errorsFile = path.join(tmp, 'src', 'client', 'contracts', 'errors.mjs');
      const pristine = readFileSync(errorsFile, 'utf8');
      const warningBlock = pristine.slice(pristine.indexOf('export const WARNING_CODES'), pristine.indexOf('export const ALL_CODES'));
      const codes = [...new Set([...warningBlock.matchAll(/'(GUIF-W-[A-Z0-9-]+)'/g)].map((match) => match[1]))];
      assert.ok(codes.length >= 2, '至少要有两条 W 码才能做「删一条」的退役模拟');

      const allSrc = listFilesRecursive(path.join(tmp, 'src')).filter((entry) => entry.rel.endsWith('.mjs'));
      // 挑一条「被 src 引用」的码退役（退役它就得同时改引用，否则「用到的码必须在冻结表里」那条会（正确地）变红）
      const referenced = codes.find((code) => allSrc.some((entry) => entry.rel !== errorsRel && readFileSync(entry.full, 'utf8').includes(code)));
      const target = referenced ?? codes[0];
      const survivor = codes.find((code) => code !== target);

      // ① 先从冻结数组里删掉那一行（含行尾注释）
      mutateFile(tmp, errorsRel, (text) => text.replace(new RegExp(`\\n[ \\t]*'${target}',[^\\n]*`), ''));

      // ② 再把**其余源码**里对该码的引用（含注释里的裸写法）改指幸存码 —— 这才叫「退役」，否则是留下悬空引用
      for (const entry of allSrc) {
        if (entry.rel === errorsRel) continue;
        const text = readFileSync(entry.full, 'utf8');
        if (!text.includes(target)) continue;
        writeFileSync(path.join(tmp, 'src', ...entry.rel.split('/')), text.split(target).join(survivor), 'utf8');
      }

      // ③ 自检：退役后整棵 src 里不得再出现该码（否则本用例模拟的不是「干净退役」）
      const leftovers = listFilesRecursive(path.join(tmp, 'src'))
        .filter((entry) => entry.rel.endsWith('.mjs') && readFileSync(entry.full, 'utf8').includes(target));
      assert.deepEqual(leftovers.map((entry) => entry.rel), [], `退役模拟不完整：${target} 仍残留在 ${leftovers.map((e) => e.rel).join('、')}`);
    },
  },
  {
    id: 'bad-prefix',
    label: '塞一条非族前缀码（GUIF-X-*）+ 同步重生成快照 ⇒ 结构判据必须变红',
    expectGreen: false,
    expect: '公开面逐字节比对：服务成员',
    mutate: (tmp) => mutateFile(tmp, 'src/client/contracts/errors.mjs', (text) => text.replace(
      'export const WARNING_CODES = Object.freeze([',
      "export const WARNING_CODES = Object.freeze(['GUIF-X-T25-PROBE',",
    )),
  },
];

test('扩表反证：合法增/删错误码（+ 同步重生成快照）⇒ 套件仍全绿；非族前缀码 ⇒ 变红', async () => {
  const problems = [];
  const caught = [];
  for (const item of EXTENSION_CASES) {
    const result = await runExtension(item);
    if (item.expectGreen) {
      if (result.status !== 0) {
        problems.push(`${item.id}（${item.label}）：合法改动被判红（断言仍对扩表过敏）—— ${result.failing.join(' ｜ ') || result.out.slice(-400)}`);
      } else {
        caught.push(item.id);
      }
      continue;
    }
    if (result.status === 0) problems.push(`${item.id}（${item.label}）：应当变红却全绿（结构判据没有牙）`);
    else if (!result.failing.some((name) => name.includes(item.expect))) {
      problems.push(`${item.id}：确实变红了，但红的不是 ${item.expect} —— ${result.failing.join(' ｜ ')}`);
    } else {
      caught.push(item.id);
    }
  }
  assert.deepEqual(problems, [], `扩表反证不合格：\n  - ${problems.join('\n  - ')}`);
  assert.equal(caught.length, EXTENSION_CASES.length);
});
