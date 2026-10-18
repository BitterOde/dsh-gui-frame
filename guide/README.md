# dsh-gui-frame · 接入说明（随包发布）

这个文件夹是**给接入方看的**：你要在**自己的插件**里用 GUIFrame 提供的入口坞、按钮面板、面板骨架与浮层，从这里开始读。

> **本包是 `dsh-gui-frame` 1.0.0 的接入说明**（坞 + 按钮面板基座），能力面刻意收窄：**不含**数据通道、布局编辑与持久化、浮动窗口（`FloatingWindow`）、测试工作台与演示面板。你在这份文档里看到的每一个成员，都是**本版真实存在**的（名单与契约真源机检对锁，见下）。
>
> 包根那份 `README.md` 是**面向使用方的总览**（定位 / 安装 / 能力面 / 版本与已知限制）；**动手写代码时以本文件夹为准**：`guide/接入指南.md` 是怎么用，`guide/契约速查.md` 是确切签名。

## 三份文档的分工

| 文件 | 回答什么问题 | 什么时候读 |
| --- | --- | --- |
| `guide/README.md`（本文件） | 我该读哪份？最小可用代码长什么样？本版有什么、没什么？ | 现在，先花两分钟 |
| `guide/接入指南.md` | 怎么把插件接进来、怎么降级、有哪些坑 | 动手前通读一遍 |
| `guide/契约速查.md` | 每个成员的确切签名 / 返回值 / 抛什么错 / 组件要什么 props / 层号怎么定 | 写代码时随查 |

## 30 秒上手

```js
// 你的客户端插件 apply(ctx) 里（照抄这一段就能跑）
const gui = ctx.get('gui-frame');          // ① 先探测：本包没装 ⇒ undefined
if (!gui) return;                          // ② 没装就什么都不做（红线，见下）

const dispose = gui.register(              // ③ 登记一个入口
  { id: '你的包名/按钮', label: () => '我的按钮', kind: 'action', source: '你的包名' },
  function MyButton() {                    // ④ 面板行里渲染的就是这个组件
    return ctx.get('react').createElement('button', { onClick: () => {} }, '我的按钮');
  },
);

ctx.effect(() => dispose, 'my-plugin: gui entry');   // ⑤ 清理（也可以交给平台自动跑）
```

- `kind: 'action'` ⇒ 这个按钮进**「按钮面板」**（点侧栏那一行展开的浮出面板）。
- `kind: 'panel'`（缺省）⇒ 你的页面**自己占侧栏那一行 + 主区一格**，不进按钮面板。
- 完整的字段表与两条登记路径的区别见 `guide/接入指南.md` §3。

**红线（务必先看）**：本包**不是**你的硬依赖。没装本包时你的插件必须照常跑 —— 这决定了第 ① 步只能用 `ctx.get('gui-frame')` 探测，**不要**在自己的插件里写 `inject: ['gui-frame']`。原因与两种写法的后果见 `guide/接入指南.md` §2。

## 你会用到的四项能力（本版 1.0 的服务面）

| 能力 | 怎么取 | 你要它做什么 |
| --- | --- | --- |
| ① `dock` 入口坞 | `ctx.guiFrame.register(entry, Component)`、`ctx.guiFrame.dock.open() / close() / isOpen()` | 把按钮放进统一入口坞（「按钮面板」）；也能用 API 直接开/关这扇面板 |
| ② `panel` 面板骨架 | `ctx.guiFrame.components.get('Panel' \| 'Toolbar' \| …)` | 不用自己造面板、工具条、空态、错误态 |
| ③ `overlay` 浮层 | `ctx.guiFrame.overlay.open(spec)`、`overlay.close(id)`、`overlay.bringToFront(id)` | 开**你自己的**浮层（含 toast 族），层号由本包那张数字表统一分配 |
| ④ `theme` 外观守门 | 公开 CSS 变量族 `--guif-*`（**16 个**，见 `guide/契约速查.md` §7） | 改观感不用跟选择器打架：定义变量即可；本包替你守住「只引用公开 token」 |

> ⚠ **`supports(name)` 只认前三项**（`dock` / `overlay` / `panel`）：`theme` 是**外观切片**、不在能力名单里 ⇒ `ctx.guiFrame.supports('theme')` 恒为 `false`（这是本版冻结契约的已知口径缺口，不是你写错了）。外观面在不在位，只有装配内部面 `service.__slice('theme')` 问得出来，而 `__` 前缀属内部面、接入方**不得**使用。
>
> 其余三项都能用 `ctx.guiFrame.supports(name)` 在运行期问「此刻真的可用吗」，再决定降级 —— 见 `guide/接入指南.md` §5。

## 本版没有的东西（别照着找）

| 你在别处可能见过 | 本版 |
| --- | --- |
| `channel`（数据通道）/ `ctx.guiFrame.channel(...)` | **没有**（服务面成员里没有它） |
| `layout`（布局编辑与持久化）/ `ctx.guiFrame.layout` | **没有**（坞管理页上的布局编辑区显示降级文案） |
| `window` / `FloatingWindow`（可拖可缩的浮动窗口） | **没有**（浮层只有 `overlay` 的浮出面板与 toast 族） |
| `workbench` / 测试工作台开关 / `--guif-workbench-*` | **没有**（连开关都不渲染） |
| demo 四段自检 | **没有**（本版的活样本是坞的**管理页自检页**，见 `guide/接入指南.md` §9） |
| 座位 `settings.general.item` | **没有**（本版只占 `main` + `sidebar.panellist` 两个座位） |

## 包内还有什么

| 路径 | 是什么 | 你要读吗 |
| --- | --- | --- |
| `guide/` | 本说明（三份） | 是 |
| `README.md` | 包总览：定位 / 安装 / 能力面 / 版本 / 已知限制 | 装之前扫一眼 |
| `LICENSE` | **MIT** 许可正文 | 对外分发前看 |
| `lib/` | 构建产物（`lib/client.js` 客户端半区、`lib/index.js` + `lib/host/**` 宿主半区） | 不用，别手改 |
| `cordis.patch.yml` | 本包自己的装载通道 | 不用 |
| `package.json` | 清单 | 看 `dsh` 段了解本包怎么被平台装载 |

<!-- prose:freeze.files=72 -->
<!-- prose:artifact.bytes=452351 -->
<!-- 上面两行是**机器可校验的事实登记**（`verify/real-machine/check-prose-claims.mjs` 认这种标记）：
     `freeze.files` ＝ `verify/freeze-rev.json` 的覆盖文件数、`artifact.bytes` ＝ 同一基线里 `lib/client.js` 的字节数。
     ⚠ 冻结基线**重绑（`--write`）之后必须同步这两行**，否则机检会判 `stale`。 -->
