/**
 * dock-styles-recovery.test.mjs —— **行样式表「不在文档里」这一态必须可检测、可自愈**。
 *
 * ═══ 这条判据是冲着哪次事故来的 ═══
 * 用户报障「按钮面板悬停背景没了」。真机取证（隔离实例 + headless CDP + 真鼠标）把那一态钉成三条读数：
 *   ① 四行（SafelyQuit / AbsentMode / ButtonMigration×2）在**常态**下悬停底色都是 `rgba(38,49,72,.06)`；
 *   ② 把 `<style data-guif-theme="gui-frame-dock-panel">` 摘掉 ⇒ 行照旧在、几何照旧（内联基线扛着），
 *      但悬停底色变 `rgba(0,0,0,0)`、焦点轮廓与激活态一并消失 —— **与用户报的那一幕逐项一致**；
 *   ③ 关掉面板**重开** ⇒ 样式表**没回来**（`styleTagBack:false`）—— 旧注入器只记一个布尔「我注入过」，
 *      于是「它现在到底在不在」谁都问不出 ⇒ 只有整页刷新能救。
 * 修法（`src/client/dock/panel-styles.mjs` 下半部分）：判据换成**问 DOM** + 注入后**当场复验**
 *   + 成功后在 `document.head` 上**值守**（摘了就补、补不回来就停手）。本文件把这三条各钉一颗牙。
 *
 * ═══ 装置 ═══
 * 本文件平时**不装 DOM**（Node 里没有 `document`），三条用例临时把一份**最小假文档**装到
 * `globalThis.document` 上并在 `finally` 里还原；注入那一侧走**真的** `installStyleSheet`
 * （不是替身）⇒ 断言的「文档里有没有那张表」与运行期同一条路径。
 * `MutationObserver` 同样换成可手动 `fire()` 的替身（Node 里没有它），这样才能演「面板开着时被摘」。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { install as installDock } from '../../src/client/dock.mjs';
import { PANEL_STYLE_ATTRIBUTE, PANEL_STYLE_ID, panelStylesPresent } from '../../src/client/dock/panel-styles.mjs';
import { GUIF_STYLE_ATTRIBUTE, installStyleSheet } from '../../src/client/theme/styles.mjs';
import { createDockHarness } from './dock-fixtures.mjs';

/** 起一套坞 + 一个够用的假浮层切片（开面板只要求 `overlay.open` 在位并交回带字符串 id 的句柄）。 */
function createRecoveryHarness() {
  const h = createDockHarness();
  h.service.__install('overlay', {
    open(callerCtx, request) {
      return { id: typeof request?.id === 'string' && request.id !== '' ? request.id : 'probe-panel', z: 1, close() {}, bringToFront() {} };
    },
    close() {
      return true;
    },
    has() {
      return false;
    },
  });
  const installed = installDock(h.ctx, h.env);
  assert.equal(installed.installed, true, '坞必须装配成功（本文件只关心样式表那一层）');
  return { ...h, installed };
}

/** 最小假文档：只支持 `<style data-guif-theme="…">` 这一条查询（本包自己那一张表的选择器）。 */
function createFakeDocument() {
  const nodes = [];
  const createElement = (tag) => ({
    tagName: String(tag).toUpperCase(),
    attrs: new Map(),
    textContent: '',
    setAttribute(name, value) {
      this.attrs.set(String(name), String(value));
    },
    getAttribute(name) {
      return this.attrs.has(String(name)) ? this.attrs.get(String(name)) : null;
    },
    remove() {
      const index = nodes.indexOf(this);
      if (index >= 0) nodes.splice(index, 1);
    },
  });
  const head = {
    appendChild(node) {
      nodes.push(node);
      return node;
    },
    removeChild(node) {
      const index = nodes.indexOf(node);
      if (index >= 0) nodes.splice(index, 1);
      return node;
    },
  };
  const doc = {
    head,
    body: head,
    createElement,
    querySelector(selector) {
      const match = /^style\[data-guif-theme="(.+)"\]$/.exec(String(selector));
      if (match === null) return null;
      return nodes.find((node) => node.tagName === 'STYLE' && node.getAttribute('data-guif-theme') === match[1]) ?? null;
    },
  };
  return { doc, nodes, count: () => nodes.filter((node) => node.tagName === 'STYLE').length };
}

/** 装一份假文档（返回还原器）；顺带把 `MutationObserver` 换成**可手动触发**的替身。 */
function withFakeDom(run) {
  const dom = createFakeDocument();
  const observers = [];
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.MutationObserver;
  globalThis.document = dom.doc;
  globalThis.MutationObserver = class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      this.observed = null;
      observers.push(this);
    }
    observe(target) {
      this.observed = target;
    }
    disconnect() {
      this.disconnected = true;
    }
    fire() {
      if (this.disconnected !== true) this.callback([]);
    }
  };
  try {
    return run({ ...dom, observers });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previousObserver;
  }
}

/**
 * 一套「真注入」的坞：theme 切片把 css 交给**真的** `installStyleSheet`，写进假文档。
 * `benign: true` ⇒ 注入**调用成功但什么也不落地**（模拟 `ctx.effect` 挂不上那一类）。
 */
function createStyledHarness(dom, options = {}) {
  const h = createRecoveryHarness();
  const calls = [];
  let benign = options.benign === true;
  h.service.__install('theme', {
    installStyles(callerCtx, styleOptions) {
      calls.push(styleOptions);
      if (benign === true) return () => {};
      return installStyleSheet(callerCtx, { ...styleOptions, document: dom.doc });
    },
  });
  return { h, calls, setBenign: (next) => { benign = next === true; } };
}

test('样式表**摘掉之后不许认死账**：再开面板必须补注入（真机事故闸）', () => {
  withFakeDom((dom) => {
    // ① 判据本身：属性名必须与能力④注入时写的那一个**逐字一致**（本包两侧各写一遍，靠这条钉住）
    assert.equal(PANEL_STYLE_ATTRIBUTE, GUIF_STYLE_ATTRIBUTE, 'panel-styles 侧写的归属属性必须与 theme/styles 侧一致');
    assert.equal(panelStylesPresent(dom.doc), false, '前置：此时文档里什么都没有 ⇒ 判据必须说不' );

    const { h, calls } = createStyledHarness(dom);
    const refs = h.installed.dock.__internals.refs;

    assert.equal(refs.openPanel(null), true, '第一次：面板必须开得出来');
    assert.equal(calls.length, 1, '第一次：必须注入一次');
    assert.equal(calls[0].id, PANEL_STYLE_ID, '注入的标签 id 必须是坞面板那张表');
    assert.equal(dom.count(), 1, '★ 注入之后文档里必须**真的**有一张表（这就是本文件的判据）');
    assert.equal(panelStylesPresent(dom.doc), true, '判据必须认得出它');

    // 摘掉它 —— 真机上这就是「挂它的 fiber 被卸载」那一下（theme 侧的清理器把 <style> 摘走）
    const element = dom.doc.querySelector(`style[${PANEL_STYLE_ATTRIBUTE}="${PANEL_STYLE_ID}"]`);
    element.remove();
    assert.equal(dom.count(), 0, '前置：这一下之后文档里没有我们的表');
    assert.equal(panelStylesPresent(dom.doc), false, '判据必须跟着变');

    assert.equal(refs.openPanel(null), true, '重开面板必须成功（功能不许依赖观感）');
    assert.equal(calls.length, 2, '★★ 旧版在这里恒等于 1（记布尔 ⇒ 永不补）—— 必须再注入一次');
    assert.equal(dom.count(), 1, '补完之后文档里又有一张');

    refs.openPanel(null);
    assert.equal(calls.length, 2, '在位时不许重复注入（幂等仍在：判据是「在不在」，不是「装过没」）');
    assert.equal(dom.count(), 1, '在位时不许堆出第二张');
  });
});

test('「调用成功但没落地」不许认账：下一轮必须再试（真机事故的同一类）', () => {
  withFakeDom((dom) => {
    const { h, calls, setBenign } = createStyledHarness(dom, { benign: true });
    const refs = h.installed.dock.__internals.refs;

    assert.equal(refs.openPanel(null), true, '面板照常开（观感降级不等于功能没了）');
    assert.equal(calls.length, 1, '这一轮调过 installStyles');
    assert.equal(dom.count(), 0, '前置：这一轮「调用成功但文档里什么都没有」');

    setBenign(false);
    refs.openPanel(null);
    assert.equal(calls.length, 2, '★ 上一轮没落地 ⇒ 这一轮必须再试（旧版会把第一轮的「成功」当已装）');
    assert.equal(dom.count(), 1, '这一轮真的落地了');
  });
});

test('面板**开着**时样式表被摘 ⇒ 值守观察器把它补回来；补不回来就停手（不空转）', () => {
  withFakeDom((dom) => {
    const { h, calls } = createStyledHarness(dom);
    const refs = h.installed.dock.__internals.refs;
    assert.equal(refs.openPanel(null), true, '开面板');
    assert.equal(dom.count(), 1);
    const observer = dom.observers.at(-1);
    assert.ok(observer !== undefined, '★ 注入成功之后必须在 document.head 上留一个值守观察器');
    assert.equal(observer.observed, dom.doc.head, '值守目标必须是 document.head');
    assert.equal(observer.disconnected, false, '值守中不许是断开的');

    // ① 摘掉 ⇒ 观察器补回来（**不用关面板**：用户当时正盯着那扇面板悬停）
    dom.doc.head.removeChild(dom.nodes[0]);
    observer.fire();
    assert.equal(calls.length, 2, '摘掉那一刻必须补注入');
    assert.equal(dom.count(), 1, '补回来了');
    assert.equal(observer.disconnected, false, '补回来之后继续守着（不是一次性）');

    // ② 再摘一次仍然补（值守是长期的）
    dom.doc.head.removeChild(dom.nodes[0]);
    observer.fire();
    assert.equal(calls.length, 3, '第二次摘掉同样要补');
    assert.equal(dom.count(), 1);

    // ③ 牙齿：补不回来（注入不落地）⇒ **停手**，不许空转刷注入
    dom.doc.head.removeChild(dom.nodes[0]);
    const before = calls.length;
    // 之后的注入仍然「调用成功」但什么也不落地（＝`ctx.effect` 挂不上的那一类）——记录照记，落地没有
    h.service.__slice('theme').installStyles = (callerCtx, styleOptions) => {
      calls.push(styleOptions);
      return () => {};
    };
    observer.fire();
    assert.equal(calls.length, before + 1, '补不回来时只允许试**一次**');
    assert.equal(observer.disconnected, true, '★ 试过仍不落地 ⇒ 观察器必须断开自己（不空转）');
    observer.fire();
    assert.equal(calls.length, before + 1, '断开之后按什么都不再注入（真 MutationObserver 也不会再回调）');
  });
});

test('没有 DOM 的环境：不装值守、也不假装「在位」，退到旧语义（降级面）', () => {
  assert.equal(typeof globalThis.document, 'undefined', '前置：本文件不装 DOM 时 Node 里没有 document');
  assert.equal(panelStylesPresent(), false, '没有 DOM ⇒ 判据为 false（不抛）');
  const h = createRecoveryHarness();
  const calls = [];
  h.service.__install('theme', {
    installStyles(callerCtx, styleOptions) {
      calls.push(styleOptions);
      return () => {};
    },
  });
  const refs = h.installed.dock.__internals.refs;
  assert.equal(refs.openPanel(null), true, '没有 DOM 也照常开面板');
  assert.equal(calls.length, 1, '注入调用照发（注入器内部对无 DOM 是空操作）');
  refs.openPanel(null);
  assert.equal(calls.length, 1, '无 DOM 环境没有可验证的判据 ⇒ 保持「调用成功即算装过」的旧语义（不反复注入）');
});
