/**
 * dock-style-vars.test.mjs —— **坞面板外观接口**的机检门禁。
 *
 * 背景（用户提问）：「外部可以通过接口自定义按钮（包括悬停时）底色吗？」——
 * 查证结论是**接口层没有**（entry 字段表无样式项、公开命名空间里没有 theme），
 * 裁定：「在接口上做得稍微丰富点吧」⇒ 坞面板每一行开成一族公开变量（`--guif-dock-row-*`），
 * 伪类那三层（悬停/焦点/激活）在样式表里、静止那两层在内联基线里。
 * ⚠ 用户复查时又砍掉两个：**行圆角**与**行间距**「我感觉没必要」⇒ 有意**不开**变量（保持字面量），
 *   第 ② 条判据专门盯着这两个位不许变回变量。
 *
 * 这一层全是**静态/结构断言**（不碰网络、不写文件、不需要 DSH 在跑），判据三条：
 *   ① 样式表的三态取值必须**引用**族内变量，且内层缺省＝开接口之前的原值（观感零变化）。
 *   ② 内联基线的四个取值位（行底色/行字色/行圆角/列表行距）同样走族内变量、缺省不变。
 *   ③ ★ **只取用、不声明**：无论是渲染出的元素树，还是 `kit/ panel/ dock/` 三族源码，
 *        都**不得**出现 `--guif-*` 当**对象键**的写法 —— 键＝在元素上声明该自定义属性，
 *        而自定义属性走继承、元素自己的声明恒胜过继承值 ⇒ 声明一次，祖先给的覆盖值就被挡死
 *        这条是「接口是真的」的机制前提（机制细节见 `panel/components.mjs` 的注释）。
 *   ④ 负控：缺省被改坏、变量被写成键 —— 两种合成变异都必须被判出来（判据不许空转）。
 *
 * ⚠ 真机那半（浏览器里真的换色）不在本文件：jsdom 不做伪类级联，`tests/**` 表达不了；
 *   证据在真机装置的读数里。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createPanelContentFace } from '../../src/client/dock/panel-content.mjs';
import { PANEL_CSS } from '../../src/client/dock/panel-styles.mjs';
import { GUIF_PUBLIC_VARS } from '../../src/client/kit/tokens.mjs';
import { createFakeReact } from '../helpers/fake-react.mjs';
import { SRC_CLIENT_DIR } from './dock-fixtures.mjs';

/** 坞自己的入口 id（正文要按它过滤，别把坞自己那一条也算成「按钮」）。 */
const DOCK_ENTRY_ID = 'dsh-gui-frame/dock';

/**
 * ★ **冻结表**：族内每个名字的**内层缺省**必须与「开这个接口之前」的取值逐字一致。
 * 它同时锚住两件事：① 没人覆盖时观感零变化；② 这一族到底有几个名字（多一个少一个都红）。
 */
const ROW_VAR_DEFAULTS = Object.freeze({
  '--guif-dock-row-bg': 'transparent',
  '--guif-dock-row-bg-hover': 'var(--dsw-alias-interactive-bg-hover)',
  '--guif-dock-row-bg-active': 'var(--dsw-alias-interactive-bg-active)',
  '--guif-dock-row-fg': 'var(--guif-panel-fg, var(--dsw-alias-label-secondary))',
  '--guif-dock-row-fg-active': 'var(--dsw-alias-label-primary)',
  '--guif-dock-row-focus-ring': 'var(--dsw-alias-label-primary)',
});

/**
 * ★ **美学秩序的不变量 —— 不是可变项，也不是「漏开」**。
 * 用户两次确认：先判「没必要」，随后给出理由「**改行圆角和行间距会影响面板的美学秩序，
 * 所以不要。**」⇒ **行圆角**与**行与行的间距**必须保持**字面量**（与 DSH 侧栏 `.panelRow` /
 * `.panelList` 逐值同源，是这个面板「看着像同一个面板」的基础）；
 * 谁把它们改成 `var(--guif-…)`（或加回 `GUIF_PUBLIC_VARS`），第 ② 条与第 ① 条判据先红。
 * 颜色与状态（三态底色 / 字色 / 焦点环）才是可调面 —— 那是「按主题、按插件」真的会有区别的东西。
 */
const INTENTIONALLY_LITERAL = Object.freeze({
  rowBorderRadius: '8px',
  listGap: '4px',
});

/** 递归展开元素树（`children` 可能是元素 / 数组 / 字符串）。 */
function collect(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out);
    return out;
  }
  if (node.$$typeof !== 'element') return out;
  if (predicate(node)) out.push(node);
  collect(node.props?.children, predicate, out);
  return out;
}

/** 造一棵坞面板正文树：两行动作型入口（一行带角标）。 */
function panelTree() {
  const react = createFakeReact();
  const face = createPanelContentFace({ DOCK_ENTRY_ID });
  const registry = new Map([
    ['probe/one', { record: { kind: 'action', source: 'probe', label: 'One', order: 0, Component: () => null }, badge: null }],
    ['probe/two', { record: { kind: 'action', source: 'probe', label: 'Two', order: 1, Component: () => null }, badge: 3 }],
  ]);
  const rows = face.readDockActions(registry, null);
  assert.equal(rows.length, 2, '前置：两行动作型入口必须都被读出来（否则下面的读数全是空转）');
  return face.createPanelContent(react.createElement, rows);
}

/** 从元素树里取「内联 style 里被**声明**的自定义属性名」（键即声明）。 */
function declaredInStyle(node) {
  return Object.keys(node.props?.style ?? {}).filter((key) => key.startsWith('--'));
}

/** 递归列 `src/client/{kit,panel,dock}` 下的 .mjs（扫描面跟着实现走：任意深度都算）。 */
function styleLayerFiles() {
  const roots = [path.join(SRC_CLIENT_DIR, 'kit'), path.join(SRC_CLIENT_DIR, 'panel'), path.join(SRC_CLIENT_DIR, 'dock')];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(abs);
    return entry.name.endsWith('.mjs') ? [abs] : [];
  });
  return roots.flatMap((root) => walk(root));
}

/** 一条「把变量写成对象键」的判据（源码用；负控直接喂合成文本）。 */
function objectKeyDeclarations(text) {
  return [...text.matchAll(/['"](--guif(?:-private)?-[A-Za-z0-9-]+)['"]\s*:/g)].map((match) => match[1]);
}

test('行样式表：三态取值必须引用族内公开变量，且内层缺省＝原值（观感零变化）', () => {
  // ① 逐名对照：样式表里必须出现 `var(--guif-…, <缺省>)`（缺省原样照抄标量那几条）
  for (const name of ['--guif-dock-row-bg-hover', '--guif-dock-row-bg-active', '--guif-dock-row-fg-active', '--guif-dock-row-focus-ring']) {
    assert.ok(
      PANEL_CSS.includes(`var(${name}, ${ROW_VAR_DEFAULTS[name]})`),
      `样式表里必须出现「${name} + 原缺省」的组合：var(${name}, ${ROW_VAR_DEFAULTS[name]})`,
    );
  }
  // ② 字色那条是**三层链**（新名字 → 老名字 → 外壳 token），必须逐字在位
  assert.ok(
    PANEL_CSS.includes(`color:var(--guif-dock-row-fg, ${ROW_VAR_DEFAULTS['--guif-dock-row-fg']})`),
    '行本体字色必须是「--guif-dock-row-fg → --guif-panel-fg → 外壳 token」三层链（老接入方设过的 --guif-panel-fg 继续生效）',
  );
  // ③ 状态层不许丢掉 `!important`（内联基线优先于样式表；丢了悬停就永远不生效 —— 2026-10-04 真机实测）
  const hover = PANEL_CSS.split('\n').find((line) => /^\[data-guif-dock-action\]:hover\{/.test(line));
  assert.ok(hover !== undefined && hover.includes('!important'), '悬停底色仍必须带 !important（否则被内联基线压住）');
  const active = PANEL_CSS.split('\n').find((line) => line.includes('data-guif-dock-row-active'));
  assert.ok(active !== undefined && active.includes('--guif-dock-row-bg-active') && active.includes('--guif-dock-row-fg-active'), '激活态底色与字色都要走族内变量');
  // ④ 族边界：这 6 个名字必须在公开变量白名单里（登记面与实现一致），且白名单里没有第 7 个同族名字
  for (const name of Object.keys(ROW_VAR_DEFAULTS)) {
    assert.ok(GUIF_PUBLIC_VARS.includes(name), `${name} 必须在 GUIF_PUBLIC_VARS 里登记（否则接入方拿不到契约）`);
  }
  const family = GUIF_PUBLIC_VARS.filter((name) => name.startsWith('--guif-dock-row-'));
  assert.deepEqual([...family].sort(), Object.keys(ROW_VAR_DEFAULTS).sort(), '坞行这一族的成员集合必须与冻结表一致（多了要在这里补缺省，少了要删登记）');
  // ⑤ 被砍掉的两个旋钮不许以任何形式回到白名单（用户判定「没必要」）
  for (const retired of ['--guif-dock-row-radius', '--guif-dock-list-gap']) {
    assert.equal(GUIF_PUBLIC_VARS.includes(retired), false, `${retired} 已被用户复查砍掉，不得重新登记（要开先改裁定与本节判据）`);
  }
});

test('内联基线：行底色/字色走族内变量、缺省不变；**圆角与行距是美学秩序不变量（字面量）**', () => {
  const tree = panelTree();
  const container = collect(tree, (node) => node.props?.['data-guif-dock-actions'] !== undefined);
  const rows = collect(tree, (node) => node.props?.['data-guif-dock-action'] !== undefined);
  assert.equal(container.length, 1, '正文里必须恰有一个按钮列表容器');
  assert.equal(rows.length, 2, '正文里必须恰有两行按钮（两行都是外部插件交进来的）');

  // ★ 美学秩序的不变量：必须是字面量（不是 `var(--guif-…)`）—— 用户给了理由：「会影响面板的美学秩序」
  assert.equal(container[0].props.style.gap, INTENTIONALLY_LITERAL.listGap, '行距是**美学秩序不变量**（字面量，与 DSH 侧栏同源；要改先改设计，不是加变量）');
  assert.equal(String(container[0].props.style.gap).includes('var('), false, '行距不得是变量引用');
  // 行：静止底色 / 字色三层链 逐条对照冻结表
  for (const row of rows) {
    assert.equal(row.props.style.background, `var(--guif-dock-row-bg, ${ROW_VAR_DEFAULTS['--guif-dock-row-bg']})`, '行静止底色必须可被祖先覆盖（原来写死 transparent）');
    assert.equal(row.props.style.borderRadius, INTENTIONALLY_LITERAL.rowBorderRadius, '行圆角是**美学秩序不变量**（字面量；用户：「改行圆角和行间距会影响面板的美学秩序，所以不要」）');
    assert.equal(String(row.props.style.borderRadius).includes('var('), false, '行圆角不得是变量引用');
    assert.equal(row.props.style.color, `var(--guif-dock-row-fg, ${ROW_VAR_DEFAULTS['--guif-dock-row-fg']})`, '行字色走三层链');
  }
  // 样式表侧同一口径：容器行距与行圆角也必须是字面量
  const containerRule = PANEL_CSS.split('\n').find((line) => line.startsWith('[data-guif-dock-actions]{'));
  const rowRule = PANEL_CSS.split('\n').find((line) => line.startsWith('[data-guif-dock-action]{'));
  assert.ok(containerRule.includes(`gap:${INTENTIONALLY_LITERAL.listGap}`), '样式表里行距同样是字面量');
  assert.ok(rowRule.includes(`border-radius:${INTENTIONALLY_LITERAL.rowBorderRadius}`), '样式表里行圆角同样是字面量');
  assert.equal(/gap:var\(--guif-dock-list-gap/.test(PANEL_CSS), false, '行距不得回退成变量');
  assert.equal(/border-radius:var\(--guif-dock-row-radius/.test(PANEL_CSS), false, '行圆角不得回退成变量');
});

test('★ 只取用、不声明：元素树与 kit/panel/dock 源码里都不得把 --guif-* 当对象键', () => {
  // ① 元素树：整棵正文里**没有**任何元素把变量声明成内联自定义属性（声明会把祖先覆盖挡死）
  const offendersInTree = collect(panelTree(), (node) => declaredInStyle(node).length > 0);
  assert.deepEqual(offendersInTree, [], '坞面板正文里不得有任何元素声明 --guif-* 内联自定义属性');

  // ② 源码：样式层三族（kit / panel / dock）里不得出现 `'--guif-…': 值` 这种键写法
  const offenders = [];
  let scanned = 0;
  for (const file of styleLayerFiles()) {
    scanned += 1;
    const rel = path.relative(SRC_CLIENT_DIR, file).split(path.sep).join('/');
    for (const name of objectKeyDeclarations(readFileSync(file, 'utf8'))) offenders.push(`${rel}：${name}`);
  }
  assert.ok(scanned >= 20, `样式层文件数异常（${scanned}）—— 扫描面取错了会让这条判据空转`);
  assert.deepEqual(offenders, [], `公开变量不得写成对象键（那是内联声明，会挡死祖先覆盖）：\n  - ${offenders.join('\n  - ')}`);

  // ③ 反向：变量确实**在取值位**被用到了（否则「不声明」可以靠「根本不用」骗过）
  const own = styleLayerFiles().map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const name of Object.keys(ROW_VAR_DEFAULTS)) {
    assert.ok(own.includes(`var(${name}`), `${name} 必须在取值位（var(...)）里真的被用到 —— 只登记不用＝死声明`);
  }
});

test('负控：缺省被改坏 / 变量被写成键 —— 两种变异都必须被判出来（判据不是空转）', () => {
  // ① 缺省改坏：把悬停那条的缺省换掉，冻结表比对必须不通过
  const mutatedCss = `[data-guif-dock-action]:hover{background:var(--guif-dock-row-bg-hover, var(--dsw-alias-bg-layer-2))!important}`;
  assert.equal(
    mutatedCss.includes(`var(--guif-dock-row-bg-hover, ${ROW_VAR_DEFAULTS['--guif-dock-row-bg-hover']})`),
    false,
    '★ 缺省被改坏必须判红（否则「观感零变化」这句话没有牙）',
  );
  // ② 正向对照：原样那一行必须判绿（证明上面的判据不是恒假）
  assert.equal(
    PANEL_CSS.includes(`var(--guif-dock-row-bg-hover, ${ROW_VAR_DEFAULTS['--guif-dock-row-bg-hover']})`),
    true,
    '实现里那一行必须判绿',
  );
  // ③ 变量被写成键：合成的声明式写法必须被抓出来；取用式写法不得误报
  assert.deepEqual(objectKeyDeclarations("const s = { '--guif-dock-row-bg': 'red' };\n"), ['--guif-dock-row-bg']);
  assert.deepEqual(objectKeyDeclarations("const s = { background: 'var(--guif-dock-row-bg, transparent)' };\n"), [], '取值位写法不得被误报');
  // ④ 元素树侧的同一批判据也要有牙
  assert.deepEqual(declaredInStyle({ props: { style: { '--guif-dock-row-bg': 'red' } } }), ['--guif-dock-row-bg']);
  assert.deepEqual(declaredInStyle({ props: { style: { background: 'var(--guif-dock-row-bg)' } } }), []);
  // ⑤ 「被砍掉的旋钮」那条判据的负控：合成一段把它们改回变量的 CSS，必须被同一批正则抓出来
  assert.equal(
    /border-radius:var\(--guif-dock-row-radius/.test('[data-guif-dock-action]{border-radius:var(--guif-dock-row-radius, 8px)}'),
    true,
    '★ 把行圆角改回变量必须能被抓（否则上面那条是空转）',
  );
  assert.equal(
    /gap:var\(--guif-dock-list-gap/.test('[data-guif-dock-actions]{gap:var(--guif-dock-list-gap, 4px)}'),
    true,
    '★ 把行距改回变量必须能被抓',
  );
});
