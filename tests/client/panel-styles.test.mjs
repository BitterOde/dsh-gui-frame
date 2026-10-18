/**
 * panel-styles.test.mjs —— 独立复验（四）：**样式纪律**。
 *
 * 扫描组件样式并断言**无硬编码颜色**、且只用 `--dsw-*`（白名单）与
 * `--guif-*` / `--guif-private-*`（命名两分）；另加**源码级**复核（样式表之外的变量字面量同样要在白名单里），
 * 以及牙齿用例（合成的违规样式/源码必须被抓出来，证明扫描器不是空转）。
 *
 * 独立性：不 import `tests/unit/**` 与 `tests/helpers/**`。只读：不写包内任何文件。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  colorOffenders,
  createPrimitivesStub,
  cssVarNames,
  flattenStyles,
  loadRealReact,
  loadSource,
  readSourceText,
  srcPath,
} from './harness.mjs';

const react = await loadRealReact();
const primitives = createPrimitivesStub(react);
const { createPanelComponents } = await loadSource('client/panel/index.mjs');
const tokensMod = await loadSource('client/kit/tokens.mjs');
const { DSW_TOKENS, GUIF_PRIVATE_VARS, GUIF_PUBLIC_VARS, dsw, guifLiteral, guifPrivateVar, guifVar } = tokensMod;

const comps = createPanelComponents({ seeds: { react, primitives } });
const styles = comps.styles;

/**
 * 源码级扫描面（样式纪律的**受检文件清单**；两处用例共用这一份 —— 不许两处各写一遍）。
 */
const PANEL_SOURCE_FILES = [
  'client/dock.mjs',
  // 坞的**面板组件与打开面板**在 `dock/panels.mjs` ⇒ 扫描面跟着实现走（只扩不缩）
  'client/dock/panels.mjs',
  // 面板行 / 行样式表 / 管理页是三个模块 ⇒ 扫描面跟着实现走（token 与颜色都要过白名单）
  'client/dock/panel-content.mjs',
  'client/dock/panel-styles.mjs',
  'client/dock/manage-page.mjs',
  'client/panel/components.mjs',
  // 面板壳拆出 `components/{views,shell}.mjs` ⇒ 扫描面跟着实现走（只扩不缩）
  'client/panel/components/views.mjs',
  'client/panel/components/shell.mjs',
  'client/kit/entry-icons.mjs',
  'client/panel/state.mjs',
  'client/panel/boundary.mjs',
  'client/kit/store.mjs',
  'client/kit/primitives.mjs',
  'client/panel/index.mjs',
];

/** 变量名是否落在三类白名单里（返回违规清单）。 */
function variableOffenders(entries) {
  const offenders = [];
  for (const { path: at, value } of entries) {
    for (const name of cssVarNames(value)) {
      const ok = name.startsWith('--dsw-')
        ? DSW_TOKENS.includes(name)
        : name.startsWith('--guif-private-')
          ? GUIF_PRIVATE_VARS.includes(name)
          : name.startsWith('--guif-')
            ? GUIF_PUBLIC_VARS.includes(name)
            : false;
      if (!ok) offenders.push(`${at}：${name}`);
      if (!name.startsWith('--dsw-') && !name.startsWith('--guif-')) offenders.push(`${at}：${name}（前缀不属于这两族）`);
    }
  }
  return offenders;
}

test('组件样式：无硬编码颜色，且所有 CSS 变量都落在 --dsw-* / --guif-* 白名单里', () => {
  const entries = flattenStyles(styles);
  assert.ok(entries.length >= 25, `样式表里的字符串值太少（${entries.length}）⇒ 扫描覆盖面不足`);

  // ① 零硬编码颜色
  assert.deepEqual(colorOffenders(styles), [], '样式表里出现了硬编码颜色（必须走 --dsw-* token）');

  // ② 变量名全部合规
  assert.deepEqual(variableOffenders(entries), [], '样式表里出现了白名单之外的 CSS 变量');

  // ③ 颜色类取值位置必须含 var(...)（不能是裸字面量）
  const COLORISH_KEY = /(color|background|border|fill|stroke|outline|shadow)/i;
  const naked = [];
  for (const { path: at, value } of entries) {
    const key = at.split('.').pop();
    if (!COLORISH_KEY.test(key)) continue;
    if (!value.includes('var(')) naked.push(`${at} = ${JSON.stringify(value)}`);
  }
  assert.deepEqual(naked, [], `颜色类取值必须写成 var(...)：\n  - ${naked.join('\n  - ')}`);

  // ④ 两分纪律：公开变量一律 --guif-*、私有变量一律 --guif-private-*（不许串味）
  for (const name of GUIF_PUBLIC_VARS) {
    assert.equal(name.startsWith('--guif-private-'), false, `公开变量不该带 private 前缀：${name}`);
    assert.match(name, /^--guif-[a-z0-9-]+$/, `公开变量命名不合规：${name}`);
  }
  for (const name of GUIF_PRIVATE_VARS) assert.match(name, /^--guif-private-[a-z0-9-]+$/, `私有变量命名不合规：${name}`);
  assert.equal(GUIF_PUBLIC_VARS.some((name) => GUIF_PRIVATE_VARS.includes(name)), false, '两族不得重叠');

  // ⑤ 公开变量**只许出现在取值位**：源码里不得出现把 `--guif-*` 当**对象键**的写法。
  //    键＝在元素上「声明」这个自定义属性（`style={{'--guif-panel-padding': '10px'}}` 那种），
  //    而自定义属性走继承、**元素自己的声明恒胜过继承值** ⇒ 声明一次，接入方在祖先上的覆盖
  //    在这棵子树上就永久失效。
  const declaredInline = [];
  for (const rel of PANEL_SOURCE_FILES) {
    const text = readSourceText(srcPath(...rel.split('/')));
    for (const match of text.matchAll(/['"](--guif(?:-private)?-[A-Za-z0-9-]+)['"]\s*:/g)) {
      declaredInline.push(`${rel}：${match[1]}`);
    }
  }
  assert.deepEqual(declaredInline, [], `公开变量不得写成对象键（那是内联声明，会挡死祖先覆盖）：\n  - ${declaredInline.join('\n  - ')}`);
  // 负控：同一批正则必须能抓住合成的那一行（否则上面是空转）
  const syntheticDeclaration = "const s = { '--guif-panel-gap': '8px' };\n";
  assert.equal([...syntheticDeclaration.matchAll(/['"](--guif(?:-private)?-[A-Za-z0-9-]+)['"]\s*:/g)].length, 1, '负控：合成声明必须被抓到');

  // ⑥ 机制对照：tokens 的三个助手对未知名字**直接抛**（不会静默写出悬空 token）
  assert.equal(dsw('--dsw-alias-bg-layer-1'), 'var(--dsw-alias-bg-layer-1)');
  assert.throws(() => dsw('--dsw-not-a-real-token'), (error) => error?.code === 'GUIF-E-COMPONENT-INVALID');
  assert.throws(() => guifVar('--guif-not-declared', '--dsw-alias-bg-layer-1'), (error) => error?.code === 'GUIF-E-COMPONENT-INVALID');
  assert.throws(() => guifPrivateVar('--guif-not-private'), (error) => error?.code === 'GUIF-E-COMPONENT-INVALID');
  assert.equal(guifLiteral('--guif-panel-gap', '8px'), 'var(--guif-panel-gap, 8px)');
  assert.equal(guifVar('--guif-panel-bg', '--dsw-alias-bg-layer-1'), 'var(--guif-panel-bg, var(--dsw-alias-bg-layer-1))');
  assert.ok(dsw('--dsw-alias-bg-layer-1', 'red').includes('red'), '字面量只允许出现在 var() 的 fallback 位');
});

test('源码级复核：panel/** 与 dock.mjs 里的 CSS 变量字面量与颜色字面量同样合规', async () => {
  const files = PANEL_SOURCE_FILES;
  const badVars = [];
  const badColors = [];
  let seen = 0;
  for (const rel of files) {
    const text = readSourceText(srcPath(...rel.split('/')));
    for (const match of text.matchAll(/'(--(?:dsw|guif)[A-Za-z0-9-]*)'/g)) {
      seen += 1;
      const name = match[1];
      const ok = name.startsWith('--dsw-')
        ? DSW_TOKENS.includes(name)
        : name.startsWith('--guif-private-')
          ? GUIF_PRIVATE_VARS.includes(name)
          : GUIF_PUBLIC_VARS.includes(name);
      if (!ok) badVars.push(`${rel}：${name}`);
    }
    for (const line of text.split(/\r?\n/)) {
      if (/(#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/.test(line)) badColors.push(`${rel}：${line.trim()}`);
    }
  }
  assert.deepEqual(badVars, [], `源码里出现了白名单之外的 CSS 变量：\n  - ${badVars.join('\n  - ')}`);
  assert.deepEqual(badColors, [], `源码里出现了颜色字面量：\n  - ${badColors.join('\n  - ')}`);
  assert.ok(seen >= 10, `源码级变量扫描必须真的扫到东西（当前 ${seen} 处）—— 否则本判据是空转`);

  // 令牌白名单自身自洽：全部是 --dsw-* 前缀、无重复、形态合法
  assert.equal(new Set(DSW_TOKENS).size, DSW_TOKENS.length, 'DSW_TOKENS 不得有重复');
  for (const name of DSW_TOKENS) assert.match(name, /^--dsw-[a-z0-9-]+$/, `token 命名不合规：${name}`);
});

test('牙齿：合成的违规样式与合成源码必须被同一批判据抓出来', () => {
  // ① 硬编码颜色
  const synthetic = {
    a: { color: '#ff0000' },
    b: { background: 'rgb(1, 2, 3)' },
    c: { borderColor: 'red' },
    d: { color: 'var(--dsw-alias-label-primary)' },
  };
  const flagged = colorOffenders(synthetic);
  assert.equal(flagged.length, 3, `三种硬编码颜色必须各被抓一条（实际 ${flagged.length}：${flagged.join('｜')}）`);
  assert.equal(flagged.some((row) => row.includes('var(--dsw')), false, '合规的 var(...) 不该被误报');

  // ② 白名单之外的变量名
  const offenders = variableOffenders([{ path: 'x.color', value: 'var(--dsw-not-real, red)' }, { path: 'y.gap', value: 'var(--guif-unknown, 4px)' }]);
  assert.equal(offenders.length >= 2, true, `未知 token / 未知公开变量必须被抓（实际 ${offenders.length}）`);
  assert.equal(variableOffenders([{ path: 'z', value: 'var(--dsw-alias-label-primary)' }]).length, 0, '合规变量不该被误报');

  // ③ 源码级颜色扫描的同一批正则
  const syntheticSource = "const s = { color: '#abcdef' };\nconst t = { background: 'rgba(0,0,0,.5)' };\n";
  const hits = syntheticSource.split(/\r?\n/).filter((line) => /(#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/.test(line));
  assert.equal(hits.length, 2, '合成源码里的两处颜色字面量必须都被抓');
});
