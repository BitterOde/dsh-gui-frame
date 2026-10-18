/**
 * prose-claims.test.mjs —— **「散文事实」机检的离线有牙自证**。
 *
 * 为什么要有这一份：松判据（数词＋量词）会误报 —— 正文里随便一句数字都可能被当成交付读数。
 * 换成**窄判据**（显式标记 + 可推导真值 + 判定不许白名单）之后，风险换了一种：
 * **判据自己恒真**（标记语法写错、真值取不到、`describe()` 永远说 OK）——那才是新装的门禁最常见的死法。
 * 所以这里按本项目一贯纪律，给每一条都配**会变红的实例**（变异负控），并且**不依赖仓库当时的数字**：
 * 判据跑在**合成输入**上（内置真值表 + 内置文档文本），与「本期交付物的读数是多少」无关。
 *
 * 判据：
 *  ① 标记语法：只认 `<!-- prose:key=value -->`；行号要指得到；一行多个标记要全取到。
 *  ② 一致 ⇒ 绿；**值不符 ⇒ 红并报 `stale` + 真值**（会红：把真值改一位）。
 *  ③ **认不出的键 ⇒ 红**（会红：写一个 `derivations()` 里没有的键；这条挡住「真值取不到却判绿」）。
 *  ④ 一份标记都探测不到 ⇒ `describe()` 必须**显式报警**（会红：喂空文档 —— 标记语法/路径写错时的兜底）。
 *  ⑤ `parseRecord`：`--record=a=1,b=two` ⇒ `{a:1, b:'two'}`；`--record=a=1,bad` ⇒ 进 `bad` 列表（会红：默默吞掉错输入）。
 *  ⑥ 真值来源必须**外生**：`derivations()` 读的是 `verify/freeze-rev.json` 与自报栏，
 *       改真源（在临时目录里造一份假的 freeze-rev.json）⇒ 真值随之变（会红：真值改成从文档自身反向解析）。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MARKER_HEAD, MARKER_TAIL, PKG_NAME, collectMarkers, derivations, describe, parseRecord, scanProseClaims,
} from '../../verify/real-machine/check-prose-claims.mjs';

/** 造一份「真值表 + 文档」的合成夹具（不碰真仓库）。 */
function fixture(markerValue, truth, key = 'freeze.files') {
  return {
    docs: [{ rel: 'x.md', text: `交付面 ${markerValue} 个文件\n<!-- prose:${key}=${markerValue} -->\n` }],
    derived: { [key]: truth },
  };
}

test('标记语法：只认显式标记、行号可指、一行多个全取到', () => {
  // 正控：**这一条必须绿**，否则整套机检都是空转（曾踩：扫描器写坏 ⇒ 恒 0 个标记 ⇒ 假绿）
  const markers = collectMarkers([
    '前言',
    '<!-- prose:freeze.files=110 -->',
    '<!-- prose:artifact.bytes=846973 --><!-- prose:tests.total=610 -->',
  ].join('\n'));
  assert.deepEqual(markers.map((m) => [m.key, m.value, m.line]), [
    ['freeze.files', '110', 2],
    ['artifact.bytes', '846973', 3],
    ['tests.total', '610', 3],
  ], '一行多个标记必须全取到，且行号指得到');
  assert.equal(`${MARKER_HEAD}freeze.files=110 ${MARKER_TAIL}`.length > 0, true, '文档里给作者看的头尾常量要在');
  // 负控：不该匹配的一律不许产生标记（不猜、不宽容）
  assert.deepEqual(collectMarkers('散文里写 110 个文件但没有标记'), [], '★ 没标记就没事实登记（不猜）');
  assert.deepEqual(collectMarkers('<!-- prose:只有键没有值 -->'), [], '缺 `=` ⇒ 不成标记');
  assert.deepEqual(collectMarkers('<!-- prose:=110 -->'), [], '缺键 ⇒ 不成标记');
  assert.deepEqual(collectMarkers('<!-- Prose:freeze.files=110 -->'), [], '大小写敏感（`Prose:` 不算）');
  assert.deepEqual(collectMarkers('<!-- prose:freeze.files=110'), [], '没有收尾 `-->` ⇒ 不成标记');
  assert.deepEqual(collectMarkers('<!-- prose:freeze files=110 -->'), [], '键里有空格 ⇒ 不成标记');
});

test('一致 ⇒ 绿；值不符 ⇒ 红并报 stale + 真值', () => {
  const good = scanProseClaims(...Object.values(fixture('110', 110)));
  assert.equal(good.ok, true, '标记与真值一致 ⇒ 绿');
  assert.equal(good.checked, 1);

  const bad = scanProseClaims(...Object.values(fixture('59', 66)));
  assert.equal(bad.ok, false, '★ 值不符必须判红（真机上出现过「交付面 59 个文件 vs 真值 66」这一类）');
  assert.equal(bad.findings[0].problem, 'stale');
  assert.equal(bad.findings[0].truth, '66', '判红要给出**真值**，否则人无从改');
  assert.match(describe(bad), /不符 1 处/, '一行式读数要带结论');
});

test('认不出的键 ⇒ 判红（挡住「真值取不到却判绿」）', () => {
  const scan = scanProseClaims([{ rel: 'x.md', text: '<!-- prose:no.such.key=1 -->' }], { 'freeze.files': 110 });
  assert.equal(scan.ok, false, '★ 认不出的键必须红（绝不当成「没这条事实」而放过）');
  assert.equal(scan.findings[0].problem, 'unknown-key');
  assert.equal(scan.findings[0].truth, null);
});

test('一份标记都探测不到 ⇒ 读数必须显式报警（判据失效时的兜底）', () => {
  const empty = scanProseClaims([{ rel: 'x.md', text: '没有标记的散文' }], { 'freeze.files': 110 });
  assert.equal(empty.ok, true, '没有标记时不算「不符」（否则新项目一上来就红）');
  assert.match(describe(empty), /一份标记都没探测到/, '★ 但读数必须显式说「判据可能已失效」——不然标记被误删就变成空转');
});

test('parseRecord：好输入进 patch、坏输入进 bad（不静默吞）', () => {
  assert.deepEqual(parseRecord('--record=tests.total=610,tests.pass=610').patch, { 'tests.total': 610, 'tests.pass': 610 });
  assert.deepEqual(parseRecord('--record=e2e.checks=74').patch, { 'e2e.checks': 74 }, '单条也要认');
  const mixed = parseRecord('--record=a=1,bad,=x');
  assert.deepEqual(mixed.patch, { a: 1 });
  assert.deepEqual(mixed.bad, ['bad', '=x'], '★ 坏输入必须进 bad 列表（由 CLI 判 exit 2），不许默默丢掉');
});

test('真值外生：改真源 ⇒ 真值跟着变，且与文档自身写的数字无关', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guif-prose-'));
  try {
    // ★ 夹具的包目录名必须与判据侧**同一个派生值**（`PKG_NAME`）：写死 `'dsh-gui-frame'` 的话，
    //   判据侧一改成派生，夹具就会写到另一个目录、真值外生那条恒红。
    mkdirSync(path.join(root, PKG_NAME, 'verify'), { recursive: true });
    writeFileSync(path.join(root, PKG_NAME, 'verify', 'freeze-rev.json'), JSON.stringify({
      files: { 'a.mjs': {}, 'b.mjs': {}, 'c.mjs': {} },
      artifact: { 'lib/client.js': { bytes: 1234, modules: 7 } },
    }));
    writeFileSync(path.join(root, PKG_NAME, 'verify', 'prose-claimed.json'), JSON.stringify({ 'tests.total': 42 }));
    const first = derivations(root);
    assert.equal(first['freeze.files'], 3, '文件数从 freeze-rev.json 的键数推出来');
    assert.equal(first['artifact.bytes'], 1234);
    assert.equal(first['tests.total'], 42, '自报栏的键原样进真值表');

    writeFileSync(path.join(root, PKG_NAME, 'verify', 'freeze-rev.json'), JSON.stringify({ files: {}, artifact: { 'lib/client.js': { bytes: 1, modules: 1 } } }));
    const second = derivations(root);
    assert.equal(second['freeze.files'], 0, '★ 改真源 ⇒ 真值随之变（真值不是从散文里读回来的）');
    assert.equal(second['artifact.bytes'], 1);

    assert.equal(derivations(path.join(root, 'nope'))['freeze.files'], null, '真源读不到 ⇒ null ⇒ 由 P3 的 unknown-key 判红（不假装有值）');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
