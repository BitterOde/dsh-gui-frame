/**
 * dock-placement.test.mjs —— **坞的就位位置**探针，与「不隐藏 newSession」的机检。
 *
 * ═══ 一次**可重演**的探针，回答两个问题 ═══
 *  问 1：`sidebar.panellist` 是否天然落在 newSession 的**原位**？
 *  问 2：newSession 是否需要隐藏？
 *
 * 方法（只读；不写 profile、不起服务、不碰 127.0.0.1:3080 上正在跑的 GUI）：
 *  读本机 DSH 安装里的官方包 `@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`，
 *  在 `SidebarRoot` 的渲染表达式里取三处锚点的**字符偏移**：
 *    `SidebarRoot_module_css_default.newSession`（新建会话按钮）
 *    `SidebarRoot_module_css_default.panelList`（panellist 行，`renderSlot("sidebar.panellist", …)` 就在其中）
 *    `SidebarRoot_module_css_default.regionArea`（sidebar.workspaces）
 *  再检查 panellist 行的渲染条件与 newSession 元素前一个 token。
 *
 *  **结论（本机 DSH 0.1.5-rc.3 实测，见用例内的断言）**：
 *   ① panellist 行是 newSession **同一个 children 数组里的下一个兄弟**（同一 flex 列、紧随其后），
 *      **不是**与 newSession 同位；且它带 `panels.length > 0 &&` 守卫 —— 只要坞注册了第一个入口，
 *      这一行就会出现（坞在 install 时就注册了自己的入口）。
 *   ② newSession 是**无条件渲染**的：源码里没有任何官方开关/条件/prop 能隐藏它
 *      （`showNewSession` / `hideNewSession` 之类标识符 0 命中）。
 *  ⇒ **不隐藏**（隐藏只能靠外部 CSS/DOM 外科手术 = 反向修改官方 UI）；
 *     替代方案＝坞直接用「newSession 下方那一行」，不需要隐藏任何官方控件。
 *
 * 平台不在位（没有本机 DSH 安装）时本用例**显式 skip 并写明原因**——探针不是"绿了就算过"。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { readPlatformFile, resolveDshInstallDir, SRC_CLIENT_DIR } from './dock-fixtures.mjs';

/** 侧栏官方包（panellist 行的归属方）。 */
const SIDEBAR = 'dsh-client-ui-sidebar/lib/client.js';
/** 布局官方包（`main` 座位 + `selectPanel` 的归属方）。 */
const LAYOUT = 'dsh-client-ui-layout/lib/client.js';

/** 取某锚点在文本里的偏移（找不到返回 -1）。 */
export function offsetOf(text, needle) {
  return text.indexOf(needle);
}

/**
 * 判断一个 JSX 元素是否被条件渲染：看它前面紧邻的 token 是不是 `&&` / `?` / `??`。
 * 数组兄弟之间是 `}),`（前一个元素收尾 + 逗号），条件渲染则是 `cond && (0, react_jsx_runtime.jsx)(…`。
 */
export function isConditionalElement(text, elementStart) {
  const before = text.slice(Math.max(0, elementStart - 60), elementStart);
  return /(&&|\?\?|\?)\s*$/.test(before);
}

test('sidebar.panellist 的就位位置：newSession 的**下一个兄弟**（不是同位），且 newSession 无条件渲染', (t) => {
  const sidebar = readPlatformFile(SIDEBAR);
  if (sidebar === null) {
    t.skip(`未找到本机 DSH 安装里的 ${SIDEBAR}（可用 DSH_INSTALL_DIR 指定）——本条是外部平台状态探针，无平台不判`);
    return;
  }
  const text = sidebar.text;
  const newSession = offsetOf(text, 'SidebarRoot_module_css_default.newSession');
  const panelList = offsetOf(text, 'SidebarRoot_module_css_default.panelList');
  const regionArea = offsetOf(text, 'SidebarRoot_module_css_default.regionArea');
  const panellistSlot = offsetOf(text, 'renderSlot("sidebar.panellist"');
  assert.ok(newSession > 0 && panelList > 0 && regionArea > 0 && panellistSlot > 0, '四处锚点都必须能定位到（官方包结构变了 ⇒ 探针要重跑重判）');

  // ① panellist 行在 newSession 之后、regionArea 之前 ⇒ 就位在 newSession **正下方**
  assert.ok(newSession < panelList, `panellist 行必须排在 newSession 之后（newSession@${newSession} panelList@${panelList}）`);
  assert.ok(panelList < regionArea, `panellist 行必须排在 regionArea 之前（panelList@${panelList} regionArea@${regionArea}）`);
  const navBlock = text.slice(panelList - 200, regionArea);
  assert.ok(
    navBlock.includes('panels.map(') && navBlock.includes('PanelRow'),
    'panelList 这一段必须把每个 panellist 条目交给 PanelRow 渲染',
  );
  assert.ok(
    text.slice(0, panelList).includes('renderSlot("sidebar.panellist"'),
    'panellist 的 renderSlot 调用必须在 panelList 之前定义（PanelRow 内部渲它，nav 只负责列条目）',
  );

  // ② panellist 行带 `panels.length > 0 &&` 守卫 ⇒ 有第一个入口才出现（坞 install 时就注册了自己的入口）
  const guard = /panels\.length\s*>\s*0\s*&&[\s\S]{0,120}panelList/.test(text);
  assert.ok(guard, 'panellist 行应由 panels.length > 0 守卫（没有入口时不占位）');

  // ③ newSession **不是**条件渲染：它前面紧邻的是上一个兄弟的收尾（`}),`），不是 `&&`
  const tooltipStart = text.lastIndexOf('(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {', newSession);
  assert.ok(tooltipStart > 0, 'newSession 按钮应由 Tooltip 包裹（官方就是这么写的）');
  assert.equal(isConditionalElement(text, tooltipStart), false, 'newSession 元素不得被条件包住（它能被隐藏的话，本条的结论就要改写）');

  // ④ 官方没有任何"隐藏 newSession"的开关（有的话就不必做 DOM 外科手术了）
  for (const needle of ['hideNewSession', 'showNewSession', 'newSessionHidden']) {
    assert.equal(offsetOf(text, needle), -1, `官方侧栏包出现了 ${needle} —— 探针结论需要重判（可能已有官方开关）`);
  }

  // ⑤ label thunk 的官方投影路径（A4 的依据）：owner 用 resolveSlotLabel 解析 label 并在 locale 变化时重投影
  assert.ok(
    /resolveSlotLabel\)?\(options\.label\)/.test(text),
    'owner 必须用 resolveSlotLabel 解析 label（thunk 才会生效；官方写法是 (0, …ui_slots.resolveSlotLabel)(options.label) ?? id）',
  );
  assert.ok(text.includes('ctx.locale.subscribe(syncPanels)'), 'owner 必须在 locale 变化时重投影（label thunk 跟随 locale 的机制）');

  t.diagnostic(`偏移：newSession=${newSession} panelList=${panelList} panellistSlot=${panellistSlot} regionArea=${regionArea}（${sidebar.file}，共 ${text.length} 字符）`);
  t.diagnostic('结论①：panellist 行 = newSession 的下一个兄弟（同一 flex 列），带 panels.length>0 守卫');
  t.diagnostic('结论②：newSession 无条件渲染，官方无隐藏开关 ⇒ 隐藏它需要外部 CSS/DOM 外科手术');
});

test('两个座位的声明与 kind：panellist=list/root（id 必填）、main=keyed/root（key 必填）', (t) => {
  const sidebar = readPlatformFile(SIDEBAR);
  const layout = readPlatformFile(LAYOUT);
  if (sidebar === null || layout === null) {
    t.skip('未找到本机 DSH 安装里的 sidebar/layout 官方包 —— 无平台不判');
    return;
  }
  assert.ok(
    /"sidebar\.panellist":\s*\{\s*kind:\s*"list",\s*scope:\s*"root"/.test(sidebar.text),
    'panellist 必须是 list/root（注册选项 id 必填 —— 成对注册的 panellist 半边）',
  );
  assert.ok(
    /"main":\s*\{\s*kind:\s*"keyed",\s*scope:\s*"root"/.test(layout.text),
    'main 必须是 keyed/root（注册选项 key 必填 —— 成对注册的 main 半边）',
  );
  assert.ok(
    layout.text.includes('ctx.slots.entries("main").some((entry) => entry.options.key === id)'),
    'layout 的 hasMainPanel 必须读**实时** entries（这条就是负控替身 createFakeLayout 的转写来源）',
  );
  assert.ok(
    layout.text.includes('is not registered'),
    'layout.selectPanel 对未注册的 main key 必须抛 "is not registered"',
  );
  t.diagnostic('座位声明：sidebar.panellist=list/root、main=keyed/root；selectPanel 的 @throws 依据已复现');
});

test('隐藏 newSession：本包**不做**——源码里没有任何 DOM/CSS 外科手术或对官方控件的引用', () => {
  const files = [
    'dock.mjs',
    // 坞的**面板组件与打开面板**在 `dock/panels.mjs` ⇒ 扫描面跟着实现走（只扩不缩）
    'dock/panels.mjs',
    // 面板行/样式表/管理页是三个模块 ⇒ 扫描面跟着实现走（要覆盖全部坞内代码）
    'dock/panel-content.mjs',
    'dock/panel-styles.mjs',
    'dock/manage-page.mjs',
    'panel/index.mjs',
    'panel/components.mjs',
    // 面板壳拆出 `components/{views,shell}.mjs` ⇒ 扫描面跟着实现走（只扩不缩）
    'panel/components/views.mjs',
    'panel/components/shell.mjs',
    'panel/boundary.mjs',
    'kit/entry-icons.mjs',
    'kit/primitives.mjs',
    'panel/state.mjs',
    'kit/store.mjs',
    'kit/tokens.mjs',
  ];
  const forbidden = [
    'document.',
    'getElementById',
    'styleSheets',
    'insertRule',
    'newSession',
    'startSession',
    'createElement("style"',
    "createElement('style'",
  ];
  /**
   * ★ `querySelector` 的口径：**只许查本包自己注入的那张样式表**（不是「一律不许出现」）。
   *
   * 为什么这样收窄：本用例的原意是「不碰**官方控件**、不做 CSS 外科手术」（用例标题与上面那张
   * 文件清单都在说这件事）。真机事故（用户报「按钮面板悬停背景没了」）钉出的事实是：行样式表
   * `<style data-guif-theme="gui-frame-dock-panel">` 是**我们自己**注入的副作用，它被 fiber 卸载摘走后
   * 旧注入器**永远不再补**（真机读数：重开面板 `styleTagBack:false`）——「它现在到底在不在文档里」
   * 只能问 DOM。所以这一处读取被**逐字限定**在本包自己的标签上：任何查官方控件的 `querySelector`
   * 仍然判红（下面的牙齿用例就在证明这条收窄没有变成洞）。
   */
  const ownStyleQuery = /style\[[^\]]*PANEL_STYLE_ID/;
  const teeth = "document.querySelector('.newSession').remove(); // 合成违规：查官方控件";
  assert.equal(teeth.includes('querySelector') && ownStyleQuery.test(teeth), false, '牙齿：查官方控件的 querySelector 必须仍被判红');
  for (const rel of files) {
    const raw = readFileSync(path.join(SRC_CLIENT_DIR, ...rel.split('/')), 'utf8');
    // 判据落在**代码**上：注释里讨论 A18/A19 的结论是应该的，不算违规
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const needle of forbidden) {
      assert.equal(
        code.includes(needle),
        false,
        `${rel} 的**代码**里出现了「${needle}」——A19 判定为"不做隐藏"：反向修改/隐藏官方控件（DOM 或 CSS 外科手术）一律不碰`,
      );
    }
    for (const site of code.matchAll(/querySelector(?:All)?\(\s*([^)]*)\)/g)) {
      assert.ok(
        ownStyleQuery.test(site[1]),
        `${rel} 里出现了一处**不是查本包自己样式表**的 querySelector：\`${site[1].trim()}\` —— A19 只放行「读我们注入的 <style data-guif-theme=…>」这一种`,
      );
      assert.equal(
        /newSession|panellist|panelRow|documentElement|body/i.test(site[1]),
        false,
        `${rel} 的 querySelector 指向了官方控件/DOM 位置：\`${site[1].trim()}\``,
      );
    }
  }
});

test('平台在位时复核：官方控件没有对外可关的接口（本题的"不做"是证据结论，不是偷懒）', (t) => {
  const root = resolveDshInstallDir();
  if (root === null) {
    t.skip('未找到本机 DSH 安装 —— 无平台不判');
    return;
  }
  const sidebar = readPlatformFile(SIDEBAR);
  const declaration = sidebar === null ? '' : sidebar.text;
  assert.ok(declaration.length > 0, '应能读到侧栏官方包');
  // newSession 只由侧栏内部渲染（它不在任何 seat 里，也没有 ownerProps 外的开关）
  assert.ok(declaration.includes('className: SidebarRoot_module_css_default.newSession'));
  assert.equal(declaration.includes('external: true') || declaration.includes('hideable'), false);
  t.diagnostic(`平台根：${root}；侧栏包长度 ${declaration.length}；newSession 仅由 SidebarRoot 内部渲染、无对外开关`);
});
