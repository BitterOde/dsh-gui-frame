/**
 * overlay-host.test.mjs —— **OverlayHost 与端到端浮层行为**门禁（L4 真 React 渲染）。
 *
 * 判据逐条：
 *  ① 根容器 `data-guif-overlay-root` 且**点击穿透**（`pointerEvents: none`；每层包裹节点把交互恢复回来）；
 *  ② 层栈自底向顶渲染，每层带 **`data-guif-z` 实际层号**；
 *  ③ **Esc 只关最上层**；
 *  ④ **点外只关最上层**（点里面不关；账本被 hold 时不关）；
 *  ⑤ 模态层在 ⇒ `body.pointerEvents = 'none'`；模态走掉 ⇒ **严格还原原值**；
 *  ⑥ 吐司有内容时才出现。
 *
 * 这里是「宿主 + 层栈 + 浮出面板 + 关闭控制器」第一次真正串起来跑，等价于真机四证的**离线版**。
 *
 * ★ v1.0 的交付面里**没有 `window/**`**（托管浮层只剩 `panel` 族；见 `src/client/service/core.mjs`
 *   文件头「v1.0 交付面＝坞 + 面板服务，面板走托管浮层」），所以夹具用**浮出面板**
 *   （`overlay/panel.mjs` 的 `createOverlayPanel`），锚点用面板自己的机器锚点
 *   （`data-guif-panel-frame` / `data-guif-panel-body`）：
 *   `family: 'floating'` 在 v1 里**渲染不出东西**（`host.mjs` 的 resolver 取不到组件 ⇒ 返回 null），
 *   那是被裁能力的既成事实，不在本文件的判据面里。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { createDismissController, createEscapeController, createInterceptionLedger } from '../../src/client/overlay/dismiss.mjs';
import { createOverlayHost } from '../../src/client/overlay/host.mjs';
import { createOverlayPanel } from '../../src/client/overlay/panel.mjs';
import { createPointerGuard } from '../../src/client/overlay/pointer.mjs';
import { createOverlayStack } from '../../src/client/overlay/stack.mjs';
import { createToastStack } from '../../src/client/overlay/toast.mjs';
import { createFamily } from '../../src/client/overlay/family.mjs';
import { createDom } from './window-harness.mjs';

/** 浮出面板的机器锚点（与 `kit/surface.mjs` 的 `BASE_ANCHORS` 同字面）。 */
const PANEL_FRAME = '[data-guif-panel-frame]';
const PANEL_BODY = '[data-guif-panel-body]';

/** 一扇「面板族」浮层记录（v1 托管浮层的真实形态）。 */
function panelRecord(id, z, extra = {}) {
  return {
    id,
    z,
    family: 'panel',
    title: id,
    rect: { x: 10, y: 10, width: 300, height: 200 },
    ...extra,
  };
}

/** 造一套与 `overlay/index.mjs` 同构的运行时（但不走 install，便于逐条断言机制）。 */
function createRuntime(document, options = {}) {
  const stack = createOverlayStack({});
  const pointer = createPointerGuard({ dom: document });
  const ledger = createInterceptionLedger();
  const dismissed = [];
  const dismiss = createDismissController({
    dom: document,
    ledger,
    isInside: () => false,
    onDismiss: () => {
      const top = stack.top();
      if (top === null || top.closable === false) return;
      dismissed.push(top.id);
      stack.remove(top.id);
    },
    schedule: (fn) => setTimeout(fn, 0),
  });
  const escape = createEscapeController({
    dom: document,
    top: () => stack.top(),
    onEscape: (entry) => stack.remove(entry.id),
  });
  const toasts = createToastStack(React, { max: 2 });
  const runtime = {
    stack,
    pointer,
    dismiss,
    escape,
    toasts,
    family: createFamily(React, null),
    Panel: createOverlayPanel(React, {}),
    rootZ: 20,
    dismissed,
    ledger,
  };
  if (options.withoutFamily) runtime.family = null;
  return runtime;
}

function mountHost(runtime) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const Host = createOverlayHost(React, runtime);
  act(() => {
    root.render(React.createElement(Host));
  });
  return {
    host,
    root,
    rerender: () => act(() => root.render(React.createElement(Host))),
    unmount: () => act(() => root.unmount()),
  };
}

/** 全部浮出面板节点（文档序＝叠放序），带实际层号。 */
function panelNodes(body) {
  return [...body.querySelectorAll(PANEL_FRAME)];
}

test('① 根容器 data-guif-overlay-root 且**点击穿透**；② 每层带 data-guif-z、逐层 opt back in', () => {
  const { document, body, cleanup } = createDom();
  try {
    const runtime = createRuntime(document);
    const mounted = mountHost(runtime);
    const rootNode = body.querySelector('[data-guif-overlay-root]');
    assert.ok(rootNode !== null, '宿主根节点必须在');
    assert.equal(rootNode.style.pointerEvents, 'none', '★ 整屏空容器必须**点击穿透**：设成 auto 就是全屏遮罩，坞入口与面板动作会被它全员吞掉（真机实测「命中遮挡(DIV.)」）');
    assert.equal(rootNode.style.zIndex, '20', '根层号 = 官方内容层基线');

    act(() => {
      runtime.stack.add(panelRecord('w1', 100));
      runtime.stack.add(panelRecord('w2', 101));
    });
    const panels = panelNodes(body);
    assert.deepEqual(panels.map((node) => node.getAttribute('data-guif-panel-frame')), ['w1', 'w2'], '自底向顶渲染');
    assert.deepEqual(panels.map((node) => node.getAttribute('data-guif-z')), ['100', '101'], '实际层号暴露出来');
    assert.equal(body.querySelector('[data-guif-overlay-root]').getAttribute('data-guif-overlay-layers'), '2');
    assert.deepEqual(panels.map((node) => node.style.pointerEvents), ['auto', 'auto'], '面板自己把交互接回来（浮层根是穿透的）');

    // 「entries opt back into pointer events」的落点：**逐层包裹节点**恢复可交互（根容器是穿透的）
    const wrappers = [...body.querySelectorAll('[data-guif-overlay-layer]')];
    assert.deepEqual(wrappers.map((node) => node.getAttribute('data-guif-overlay-layer')), ['w1', 'w2'], '每层一个包裹节点（值＝层 id，顺序＝叠放序）');
    assert.deepEqual(wrappers.map((node) => node.style.pointerEvents), ['auto', 'auto'], '包裹节点把交互恢复回来');
    assert.deepEqual(wrappers.map((node) => node.style.display), ['contents', 'contents'], '包裹节点不生成盒子（不影响面板定位）');

    mounted.unmount();
  } finally {
    cleanup();
  }
});

test('③ Esc 只关最上层（连续两次依次关掉）', () => {
  const { document, cleanup } = createDom();
  try {
    const runtime = createRuntime(document);
    const mounted = mountHost(runtime);
    act(() => {
      runtime.stack.add(panelRecord('w1', 100));
      runtime.stack.add(panelRecord('w2', 101));
      runtime.stack.add(panelRecord('w3', 102));
    });
    const pressEscape = () => {
      const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      act(() => {
        document.dispatchEvent(event);
      });
      return event;
    };
    const first = pressEscape();
    assert.deepEqual(runtime.stack.ids(), ['w1', 'w2'], 'Esc 只关最上层');
    assert.equal(first.defaultPrevented, true, '真关掉一层才 preventDefault');
    pressEscape();
    assert.deepEqual(runtime.stack.ids(), ['w1']);
    pressEscape();
    assert.deepEqual(runtime.stack.ids(), []);
    const last = pressEscape();
    assert.equal(last.defaultPrevented, false, '没有浮层可关 ⇒ 不吞事件');

    mounted.unmount();
  } finally {
    cleanup();
  }
});

test('④ 点外关闭：延迟一个 macrotask 才武装；点里面不关；账本 hold 时不关', async () => {
  const { document, cleanup } = createDom();
  try {
    const runtime = createRuntime(document);
    const mounted = mountHost(runtime);
    act(() => {
      runtime.stack.add(panelRecord('top', 100));
      runtime.stack.add(panelRecord('above', 101));
    });

    const clickOutside = () => {
      const event = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      act(() => {
        document.body.dispatchEvent(event);
      });
    };

    clickOutside();
    assert.deepEqual(runtime.stack.ids(), ['top', 'above'], '监听还没武装（延迟一个 macrotask）⇒ 不关');
    await new Promise((resolve) => setTimeout(resolve, 5));

    // 点浮层自己（React 树内 ⇒ 由 onPointerDownCapture 打标）⇒ 不关
    const inner = document.querySelector('[data-guif-panel-frame="above"] [data-guif-panel-body]');
    assert.ok(inner !== null, '面板内容区必须在（否则「点里面」这条是空转）');
    const insideEvent = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    act(() => {
      inner.dispatchEvent(insideEvent);
    });
    assert.deepEqual(runtime.stack.ids(), ['top', 'above'], '点浮层自己 ⇒ 不关');

    // 账本被 hold（拖拽在飞）⇒ 点外也不关
    runtime.ledger.hold();
    clickOutside();
    assert.deepEqual(runtime.stack.ids(), ['top', 'above'], '被拦截的外部交互不关浮层');
    runtime.ledger.release();

    // 普通点外 ⇒ 只关最上层
    clickOutside();
    assert.deepEqual(runtime.stack.ids(), ['top'], '点外只关最上层');

    mounted.unmount();
  } finally {
    cleanup();
  }
});

test('⑤ 模态层在 ⇒ body.pointerEvents=none；模态走掉 ⇒ 严格还原原值', () => {
  const { document, body, cleanup } = createDom();
  try {
    body.style.pointerEvents = 'auto'; // 故意留一个原值，验「严格还原」
    const runtime = createRuntime(document);
    const mounted = mountHost(runtime);
    assert.equal(body.style.pointerEvents, 'auto', '没有模态 ⇒ 不动 body');

    // 非模态面板：自己内联 auto（浮层之下才是 none）
    act(() => {
      runtime.stack.add(panelRecord('w', 100));
    });
    assert.equal(document.querySelector('[data-guif-panel-frame="w"]').style.pointerEvents, 'auto', '面板内联 auto');
    assert.equal(body.style.pointerEvents, 'auto', '非模态不锁 body（锁了整个应用都点不动）');

    act(() => {
      runtime.stack.add({ id: 'modal1', z: 200, family: 'dialog', modal: true, title: '模态' });
    });
    assert.equal(body.style.pointerEvents, 'none', '模态在 ⇒ 浮层之下不可交互');
    // 官方 Modal 原子在离线夹具里不可用 ⇒ 不假装渲染（有缺失记录为证），但模态语义照旧生效
    assert.deepEqual(runtime.family.missing().map((row) => row.atom), ['Modal']);

    act(() => {
      runtime.stack.remove('modal1');
    });
    assert.equal(body.style.pointerEvents, 'auto', '模态走掉 ⇒ **严格还原原值**');

    mounted.unmount();
  } finally {
    cleanup();
  }
});

test('⑥ 吐司：有内容才渲染容器；清空后容器消失', () => {
  const { document, body, cleanup } = createDom();
  try {
    const runtime = createRuntime(document);
    const mounted = mountHost(runtime);
    assert.equal(body.querySelector('[data-guif-toast-stack]'), null, '没有吐司时不渲染容器');
    act(() => {
      runtime.toasts.push('保存成功');
    });
    assert.ok(body.querySelector('[data-guif-toast-stack]') !== null, '有吐司 ⇒ 容器出现');
    act(() => {
      runtime.toasts.clear();
    });
    assert.equal(body.querySelector('[data-guif-toast-stack]'), null);
    mounted.unmount();
  } finally {
    cleanup();
  }
});

test('卸载：Esc / 点外监听全部摘干净，body 不留 pointer-events:none 的幽灵状态', () => {
  const { document, body, cleanup } = createDom();
  try {
    const runtime = createRuntime(document);
    const mounted = mountHost(runtime);
    act(() => {
      runtime.stack.add({ id: 'm', z: 200, family: 'dialog', modal: true });
    });
    assert.equal(body.style.pointerEvents, 'none');
    assert.equal(runtime.dismiss.armed() === true || runtime.dismiss.armed() === false, true);

    mounted.unmount();
    assert.equal(runtime.dismiss.armed(), false, '卸载后点外监听不再是武装态');
    assert.equal(body.querySelector('[data-guif-overlay-root]'), null, '宿主节点已摘掉');
    // 模态记录还在层栈里，但宿主已经不再 lock：指针锁的 depth 归零
    assert.equal(runtime.pointer.depth(), 0, '宿主卸载 ⇒ 指针锁释放');
    assert.equal(body.style.pointerEvents, '', '**不留 pointer-events:none 的幽灵状态**');
  } finally {
    cleanup();
  }
});
