/**
 * service-cleanup.test.mjs —— **v1.0 简化的落地判据**。
 *
 * 为什么要有这个文件：简化做的是「删掉同代裁剪后无人消费的内态与面」。删掉的东西如果没有判据，
 * 下一个人顺手加回来时**没有任何东西会响**。这里只钉三件事，每条都对应报告里的一个简化项：
 *
 *   ① `service/core.mjs` 的 `__layout` 内态**不许回来**
 *        （它随 `get layout()` 一起被裁，全仓无消费方；`__layers` 必须留着 —— `get overlay()` 在用）
 *   ② `LayoutFace` **不许回来**，且两个调用点的 `isPlainObject` **必须仍是带原型判据的版本**
 *        （内联时若简化成 `typeof === 'object'`，会放行类实例 ⇒ 悄悄放宽 `GUIF-E-ENTRY-INVALID` 的判据）
 *   ③ 入口闭包外的件**不许回来**：当时那三个无真 import 的件、整套布局链（本版没有布局能力，
 *      迁移与收敛没有任何运行时消费方）、两个测试锚点外壳（定义已下沉 `kit/`）、以及只给脚本与单测
 *      用的公开面描述器 —— 它们都会被打包规则收进客户端产物，所以「存在」本身就是错。
 *      同时**反向**钉住下沉后的真源必须在位（`kit/tokens.mjs` / `kit/primitives.mjs` /
 *      `scripts/public-surface.describe.mjs`）。
 *
 * 纪律：只读（读源码文本 + 判存在性）；不写盘、不联网、不起进程。
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..', '..');
const read = (...parts) => readFileSync(path.join(PKG_DIR, ...parts), 'utf8');
const has = (...parts) => existsSync(path.join(PKG_DIR, ...parts));

/**
 * 剥掉块注释与整行行注释 —— **判据只看代码，不看解释**。
 *
 * 为什么必须这样：简化后的原处会留一段「这里原来有什么、为什么删」的注释。若判据扫全文，
 * 那些注释里的旧名字会让判据**永远红**（把「有留痕」误判成「没删掉」）。凡按符号扫源码文本的判据，
 * 都先剥注释再比，这条不例外。
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

test('简化：`service/core.mjs` 的 `__layout` 内态已被清除，且 `__layers` 必须留着', () => {
  const source = stripComments(read('src', 'client', 'service', 'core.mjs'));
  assert.equal(/\bthis\.__layout\b/.test(source), false, '`__layout` 内态不得复活（它的消费方 get layout() 已随同代裁剪删除）');
  assert.equal(/\bthis\.__layout\.listeners/.test(source), false, '`__shutdown` 里那句 listeners.clear() 也必须一起没了（否则它引用的字段不存在）');
  assert.equal(/\bcreateEmptyLayout\b/.test(source), false, '`createEmptyLayout` 的 import 只在喂 `__layout` —— 应当一并清掉');
  // 反证：overlay 仍需要 __layers（别把两件事一起删了）
  assert.equal(/\bthis\.__layers\b/.test(source), true, '`__layers` 必须留着：get overlay() 在用它');
  assert.equal(/createLayerAllocator/.test(source), true, '`createLayerAllocator` 的 import 同理必须在位');
});

test('简化：`LayoutFace` 不复活，且内联的 `isPlainObject` 必须带原型判据（不许偷偷放宽）', () => {
  const faces = stripComments(read('src', 'client', 'service', 'faces.mjs'));
  assert.equal(/\bLayoutFace\b/.test(faces), false, '`LayoutFace` 不得复活（无实例化点）');
  assert.equal(/layout\.(get|replace|subscribe)/.test(faces), false, '`layout` 命名空间的三个方法签名不得复活');

  for (const rel of [['src', 'client', 'service', 'faces.mjs'], ['src', 'client', 'service', 'entries.mjs']]) {
    const source = stripComments(read(...rel));
    assert.equal(/from '\.\.\/kit\/layout-schema\.mjs'/.test(source), false, `${rel.join('/')} 不得再从 kit/layout-schema 借 isPlainObject（那条链已裁）`);
    assert.equal(/function isPlainObject\(value\)/.test(source), true, `${rel.join('/')} 必须自带 isPlainObject`);
    assert.equal(/Array\.isArray\(value\)/.test(source), true, `${rel.join('/')} 的 isPlainObject 必须挡数组`);
    assert.equal(/getPrototypeOf\(value\)/.test(source), true, `${rel.join('/')} 的 isPlainObject 必须看原型 —— 只看 typeof 会放行类实例，那是放宽判据`);
    assert.equal(/proto === Object\.prototype \|\| proto === null/.test(source), true, `${rel.join('/')} 的 isPlainObject 必须只放行「原型是 Object.prototype 或 null」`);
  }
});

test('简化：入口闭包外的件不许回来；下沉后的真源必须在位', () => {
  for (const rel of [
    ['src', 'client', 'soft-probe.mjs'],
    ['src', 'client', 'kit', 'gesture.mjs'],
    ['src', 'client', 'kit', 'geometry.mjs'],
  ]) {
    assert.equal(has(...rel), false, `${rel.join('/')} 应已删除（全仓无真 import / 随 window 能力一起被裁）`);
  }
  // 布局链：本版没有布局编辑与持久化 ⇒ 迁移与收敛没有任何运行时消费方，留着只会被打进产物
  for (const rel of [
    ['src', 'client', 'migrate.mjs'],
    ['src', 'client', 'kit', 'layout-schema.mjs'],
    ['src', 'client', 'kit', 'layout-shape.mjs'],
    ['src', 'client', 'contracts', 'layout-schema.mjs'],
  ]) {
    assert.equal(has(...rel), false, `${rel.join('/')} 不得存在（布局能力已裁，这条链没有消费方）`);
  }
  // 测试锚点外壳：定义早已下沉 kit/，旧路径只为测试保留 —— 而打包规则会把它一并收进产物
  for (const rel of [['src', 'client', 'panel', 'tokens.mjs'], ['src', 'client', 'panel', 'primitives.mjs']]) {
    assert.equal(has(...rel), false, `${rel.join('/')} 不得存在（只有测试走这条路径，不该进产物）`);
  }
  // 公开面描述器是工具件，归 scripts/；留在 src/client 下就会被当成客户端运行时打包
  assert.equal(has('src', 'client', 'contracts', 'surface.mjs'), false, '公开面描述器不得回到 src/client/contracts/ 下');
  // ★ 反向：下沉后的真源必须在位（判据与脚本都指向它们）
  for (const rel of [
    ['src', 'client', 'kit', 'tokens.mjs'],
    ['src', 'client', 'kit', 'primitives.mjs'],
    ['scripts', 'public-surface.describe.mjs'],
  ]) {
    assert.equal(has(...rel), true, `${rel.join('/')} 必须存在：它是被下沉/外移后的唯一真源`);
  }
});

test('简化：夹具自备几何件（verify 装置不再借 `src/**`）；`harness.mjs` 回到 600 行以内', () => {
  const fixture = read('verify', 'lib', 'geometry-fixture.mjs');
  assert.equal(/FLOAT_MIN_SIZE|FLOAT_DEFAULT_SIZE|DRAG_THRESHOLD/.test(fixture), true, '夹具必须自带几何常量');
  assert.equal(/from '\.\.\/\.\.\/src\//.test(fixture), false, '夹具不得反向 import src/**（装置自足纪律）');
  const harnessRaw = read('verify', 'lib', 'harness.mjs');
  const harness = stripComments(harnessRaw);
  assert.equal(/client\/window\/geometry\.mjs|client\/kit\/geometry\.mjs/.test(harness), false, 'harness 不得再从已删的几何件 import（解释性注释不参与判定）');
  assert.equal(/from '\.\/geometry-fixture\.mjs'/.test(harnessRaw), true, 'harness 必须以 `from \'./geometry-fixture.mjs\'` 的形式从夹具取几何件（路径以字符串出现才算真 import）');
  const lines = harnessRaw.split('\n').length;
  assert.ok(lines <= 600, `verify/lib/harness.mjs 必须守住「非 src 面 ≤600 行」：现 ${lines} 行`);
  // ★ 同一条上限对 **`verify/lib/**` 整个目录**生效：只钉单文件的话，把内容搬去同目录另一个文件
  //   就能让违规**换个位置藏起来**（`harness.mjs` 涨到 625 行判红那次，就是把「真源取面」搬到
  //   `source-face.mjs` 才化解的）。判据面跟到整目录 —— `verify/lib` 本就同属「非 src 面」。
  const libDir = path.join(PKG_DIR, 'verify', 'lib');
  for (const name of readdirSync(libDir).filter((n) => n.endsWith('.mjs')).sort()) {
    const n = readFileSync(path.join(libDir, name), 'utf8').split('\n').length;
    assert.ok(n <= 600, `verify/lib/${name} 必须守住「非 src 面 ≤600 行」：现 ${n} 行`);
  }
});
