# render-shot —— HTML → PNG 无头渲染截图（零第三方依赖）

把**本地 HTML 文件**（或**一个已在跑的真机地址**）用**无头系统浏览器**渲染成 PNG。
它是「参考图 → 实现 → 截图 → 像素比对」验证回路里的第二棒：改了 `src/**` 的界面之后，
用它把设计稿/页面拍成图片，再拿去做像素比对。

真机那一支（起独立端口实例 → 点开坞面板 → 等锚点 → 裁剪 → 出图）见
[《对 GUIFrame 真机出图（一条命令）》](#对-guiframe-真机出图一条命令)：一句话是
`node tools/dsh-shot.mjs --out <png> --click "[data-guif-glyph]" --click-via js --wait-for "[data-guif-dock-actions]" --selector "[data-guif-dock-actions]"`。

思路借自 `dsh-vision-router` 的 `vision_html_screenshot`（本地 HTML + 无头浏览器 +
`fullPage` 截整页并回传页面高度、产物是 PNG），这是用户点名要借鉴的对象。
**实现是重写的**：那个工具依赖 `puppeteer-core`，而本仓硬规则是**零第三方依赖**
⇒ 这里直接用 `node:child_process` 起浏览器、用**裸 CDP**（Chrome DevTools Protocol）驱动，
只用 Node 内置模块 + 全局 `fetch` / `WebSocket`（需要 Node 22+，本机 v24.19.0）。

```
tools/render-shot.mjs           截图命令行入口（HTML 文件或 http(s) 地址 → PNG）
tools/render-shot.selftest.mjs  离线自检（默认不启动浏览器）
tools/render-shot.mutation.mjs  反假绿轮：在副本里改坏代码，要求对应判据翻红（离线）
tools/dsh-shot.mjs              **一条命令对 DSH 真机出图**（临时 profile + link 本包 + 独立端口 + headless Edge）
tools/render-shot.README.md     本文件
```

## 快速开始

```powershell
cd dsh-gui-frame

# 1) 视口截图（默认 1280×900）
node tools/render-shot.mjs docs/demo/page.html --out .tmp/shot.png

# 2) 整页截图：内容多长拍多长，并把页面高度打出来
node tools/render-shot.mjs docs/demo/page.html --out .tmp/shot-full.png --full-page

# 3) 指定视口 + 等字体落地 1 秒 + 机器可读输出
node tools/render-shot.mjs docs/demo/page.html --out .tmp/ --width 1440 --height 900 --wait-ms 1000 --json

# 4) 本机浏览器装在非标准位置时
node tools/render-shot.mjs page.html --out shot.png --browser "D:\Edge\msedge.exe"
```

`--out` 给**目录**（以分隔符结尾，或该目录已存在）时，文件名由输入推导：
`page.html` → `<目录>/page.png`；URL 输入则是 `<主机>-<端口>.png`（**不含 token**）。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `<input.html\|http(s) URL>` | 必填 | 本地 `.html` / `.htm` 文件，**或**一个已在跑的 http(s) 地址（真机实例） |
| `--url <u>` | | 显式声明输入是 URL（等价于把地址写在位置参数上） |
| `--out <path>` | 必填 | 产物路径；给目录则按输入名推导 `.png`（URL 输入见下） |
| `--width <px>` | `1280` | 视口宽（正整数） |
| `--height <px>` | `900` | 视口高（正整数） |
| `--full-page` | 关 | 截整页，并打印**页面高度**（与 `--selector` 互斥） |
| `--wait-for <css>` | 关 | 截图前等这个选择器出现；**超时 ⇒ 失败（exit 1）且不写 PNG** |
| `--wait-for-timeout <ms>` | `15000` | 等锚点的超时 |
| `--selector <css>` | 关 | 只截这个元素的外框（CDP `clip`）；元素不在场 / 0 尺寸 ⇒ **失败** |
| `--click <css>` | 关 | 截图前点击该元素；目标不在场 / 0 尺寸 ⇒ **失败** |
| `--click-index <n>` | `0` | 点第 n 个命中（0 基） |
| `--click-via <mouse\|js>` | `mouse` | `js` = 页面内对**最近的外壳 button** 派发 `click()`（坞入口的实测路径） |
| `--wait-ms <ms>` | `500` | 加载完成后再等多久（等 webfont / 首屏稳定） |
| `--json` | 关 | 结果以 JSON 打到 stdout（人读文案改走 stderr） |
| `--browser <path>` | 自动探测 | 显式指定浏览器可执行文件 |
| `--timeout-ms <ms>` | `30000` | CDP 单步超时 |
| `--keep-profile` | 关 | 保留临时 profile（排查用） |
| `-h` / `--help` | | 打印用法 |

退出码：`0` 成功｜`1` 运行期失败（找不到浏览器 / CDP 连不上 / 截图为空 / **等锚点超时** /
**裁剪元素不在场** / **产物尺寸与请求不符**…）｜`2` 用法错误
（参数写错、**输入不存在**、输入不是 `.html`、`--out` 指向目录、**目标指向 127.0.0.1:3080**）。
调用方看一个数就能分清"该改参数"还是"该查环境"。

`--json` 的形状（字段名固定；`size` / `clip` / `clicks` / `waitedMs` 都在）：

```json
{"ok":true,"out":"D:\\...\\shot.png","bytes":48213,"width":1280,"height":900,
 "size":{"width":1280,"height":900},"pageHeight":2400,"captureHeight":2400,"clamped":false,
 "fullPage":true,"target":{"kind":"file","url":null},
 "clip":{"x":12,"y":34,"width":320,"height":240,"tag":"DIV"},
 "clicks":[{"selector":"[data-guif-glyph]","index":0,"via":"js","ok":true,"clicked":"BUTTON"}],
 "waitedMs":1160,
 "browser":"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","elapsedMs":2140}
```

产物还会**自校验尺寸**：解析 PNG 的 IHDR 宽高，必须与实际请求一致（视口模式＝视口尺寸、整页模式＝
`captureHeight`、裁剪模式＝元素外框，容差 1px）。"有图、魔数对、内容不对"是最难发现的假绿，
这一条把它变成当场翻红。

## 对 GUIFrame 真机出图（一条命令）

坞面板是**真机外壳里的东西**：只看静态 HTML 拍不到它。要先起一个**装了本包的独立端口实例**，
再让 headless Edge 打开它、**点开坞入口**、等面板锚点出现、按元素裁剪落 PNG。
`tools/dsh-shot.mjs` 把这一串做成**一条命令**（临时 profile + link 本包 + 独立端口 + headless Edge
+ 等锚点 + 点击 + 裁剪 + 落 PNG，收尾只回收自己起的进程）：

### 硬前置：内存闸（不达标就不起任何进程）

起任何进程**之前**先读系统**空闲物理内存**，低于阈值就 **fail-closed**：`exit 1`、**不写 PNG**、
**不建 profile、不起 dsh 实例、不起 msedge**（连读 3080 基线那一步都不做——那一步要 spawn PowerShell）。
实读值与阈值会打印出来，`--json` 里也带 `memory` 字段。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--min-free-mb <n>` | `4096` | 空闲物理内存**硬阈值**（MB）；未达标 ⇒ fail-closed |
| `--min-free-mb 0` | | **显式关闸**（逃生口，自担风险）：只播报读数、不拦 |

- 读数来源：Windows 走 `Win32_OperatingSystem.FreePhysicalMemory`（**单位 KB ⇒ /1024 得 MB**）；
  读不到时退回 `node:os` 的 `freemem()`；两条都拿不到 ⇒ **fail-closed**（不知道够不够就别起）。
- 为什么要有这条闸：**真机首跑时，第二次起跑前实读 3591 MB（低于 4096），仍然跑了**——
  写在文档里的阈值拦不住任何东西。现在它拦得住：离线判据 `M1–M7` 用注入读数（3591/4564）与
  「阈值调到天上」的 CLI 负控证明「未达标 ⇒ 非零退出且零子步骤、无 PNG」与「达标 ⇒ 顺序照常走到出图」。
- `--dry-run` **不受闸拦**（它不起任何进程），只把闸的读数播报出来并打印计划。

```powershell
cd dsh-gui-frame
node tools/dsh-shot.mjs --out tools/evidence/<stamp>/dock-panel.png `
  --click '[data-guif-glyph*=dock]' --click-via js `
  --wait-for "[data-guif-dock-actions]" --selector "[data-guif-panel]" --json
```

> **⚠ PowerShell 传参陷阱（真机首跑踩到，已计入判据）**：PowerShell 7 会把**传给原生进程的参数里的
> 内嵌双引号剥掉** ⇒ 写成 `--click '[data-guif-glyph="dsh-gui-frame/dock"]'` 时，到 Node 手里变成
> `[data-guif-glyph=dsh-gui-frame/dock]` —— 值里含 `/`，**不加引号就是非法选择器**，工具会（正确地）
> 判用法错误 `exit 2` 且**不写任何 PNG**（宁可不画也不画错）。
> ⇒ 用**引号无关**的等价写法：`[data-guif-glyph*=dock]`（`*=` 子串匹配；`dock` 是合法 ident，
> 坞入口的属性值就是 `dsh-gui-frame/dock`）。要在 PS 里写死全值，请走 `cmd /c` 或把参数放进脚本文件。

- `--out`：产物 PNG（给目录则按 URL 推出 `<主机>-<端口>.png`，**绝不把 token 写进文件名**）。
- `--click '[data-guif-glyph*=dock]'`：坞面板**唯一的入口是侧栏那一行**，而这一行的坞图标带
  `data-guif-glyph="dsh-gui-frame/dock"` ⇒ 用属性选择器**点名**它，不必靠 DOM 顺序猜
  （`verify/real-machine` 的 `ensureDockPanel` 就是这么定位的）。
  多个坞入口 / 想看第几个时再用 `--click-index <n>`（0 基，默认 0）。
- `--click-via js`：坞面板要先点开才渲染；坞图标**中心点被一个无 class 的覆盖 DIV 挡着**，
  真鼠标点击会被吞 ⇒ 走 `js` —— 页面内对**包住该图标的外壳行按钮**（`glyph.closest("button")`）派发 `click()`。
  ⚠ **不要**用 `--click "button"` 去"随便点一颗按钮"：在真 GUI 上那可能撞到会话/发送键（装置里明写了这条禁令）。
  真鼠标那条路（`--click-via mouse`，默认）只会点**你指定的那个元素**本身，不会去点别的按钮 ——
  它的 `--json` 里带 `clicks[].hit.self`，被遮挡时会如实说"点被谁吞了"。
- `--wait-for "[data-guif-dock-actions]"`：**出图前的闸** —— 等不到这个锚点 ⇒ `exit 1` 且**不写 PNG**
  （编排器的等锚点超时默认 `30000`：真机外壳首屏比静态页慢；底层 `render-shot.mjs` 的默认是 `15000`）。
  这个锚点正是装置用来认"坞面板在场"的三件套之一（`[data-guif-dock-actions]` / `[data-guif-dock-editor]` /
  `[data-guif-dock-action]`）⇒ 出图与判据看的是**同一批锚点**。
- `--selector "[data-guif-panel]"`：截**整块坞面板**（点开坞入口后，页面上在场的就是它）。
  只想截坞内那份**动作列表**就换成 `[data-guif-dock-actions]`；要严格限定"含坞动作锚点的那块面板"，
  可以用带 `:has()` 的写法 `[data-guif-panel]:has([data-guif-dock-actions])`。
- 先看计划、不起任何进程：`node tools/dsh-shot.mjs --dry-run --out x.png --click '[data-guif-glyph*=dock]'`。

**真机首跑记录（2026-10-03 21:08，本仓首张真机 UI PNG）**：产物
`tools/evidence/2026-10-03T21-08-13/dock-panel.png`（**1160×900 / 32097 B**；
`sha256=c5e39eacafb91c4ff4a1e7bdd8fd3b270982dbc6c00d21b10c8dbd6f65921668`），
读数与命令原文落在当轮证据目录（`tools/evidence/2026-10-03T21-08-13/`，本机现场，未随仓）。
关键读数：entry 恰 1 次｜独立端口 55492｜点击 `[data-guif-glyph*=dock][0]`（js→外壳 BUTTON）｜
`[data-guif-dock-actions]` 在场 1 个｜裁剪 `[data-guif-panel]` 1160×900 @(280,0)｜
实例「已回收/不再监听」｜**3080 PID 前=后=24020**。

**命令输出与落盘位置**：stderr 逐条打印读数（建 profile / link 装包 / entry 计数 / 端口 /
锚点命中数 / 裁剪框 / 回收结果 / 3080 PID 前后），`--json` 把同一批读数打到 stdout：

```json
{"ok":true,"profile":"guifshot…","port":46982,"out":"…/dock-panel.png","bytes":41230,
 "size":{"width":320,"height":180},"clip":{"x":1180,"y":96,"width":320,"height":180,"tag":"DIV"},
 "clicks":[{"selector":"[data-guif-glyph]","index":0,"via":"js","ok":true}],"waitedMs":1420,
 "instance":{"port":46982,"pid":25468,"listeningAfter":false,"reclaimed":true},
 "liveGui":{"port":3080,"pidBefore":18992,"pidAfter":18992,"unchanged":true},"elapsedMs":38210}
```

### 这条命令的边界（与 `verify/real-machine` 同一套纪律）

0. **资源硬前置**：空闲物理内存 < `4096` MB（可 `--min-free-mb` 覆盖）**就不起任何进程**（见上一节）。
   这条不是建议：真机首跑时 3591 MB 仍照跑过，现在会被闸拦下。

1. **绝不碰 127.0.0.1:3080**：全程只**读**它的监听 PID 做前后对比（收尾打印「前 X → 后 X，未变=true」）；
   而 `render-shot.mjs` 对 3080 目标是**直接拒**（exit 2，且**没有绕过开关**）。
2. **临时 profile** `guifshot<时间戳>`（从**出厂模板** [`--from-default-profile web`] 建），
   **绝不写 `web`**；收尾只删**自己这个名字形状**的 profile（正则白名单 `guifshot…`），`--keep` 保留现场。
3. **只回收自己起的进程**：实例按自己的 pid 收 + 轮询端口确认释放（必要时 `taskkill /PID <pid> /T /F`）；
   浏览器由 `render-shot` 按自己的 pid 收。**全链路没有"按进程名批量杀"**。
4. **headless=new + CDP 截图**，没有系统级整屏截图。

### 只想复用其中一步？

底层那支（认识 URL、等锚点、点击、裁剪）在 `render-shot.mjs` 里，可以单独对**已在跑的**实例用：

```powershell
node tools/render-shot.mjs "http://127.0.0.1:46982/?token=<实例启动 URL 里的 token>" --out shot.png `
  --wait-for "[data-guif-panel]" --selector "[data-guif-panel]" --click "[data-guif-glyph]" --click-via js --json
```

需要"一条命令把实例也起起来"的完整闭环，用上面的 `dsh-shot.mjs`。


## 为什么它不影响你用电脑

用户明令：**不动电脑输入、不切换界面、纯图形渲染生成，截图过程不要影响电脑使用**。
落到实现上是五条，每一条都能在源码里指到具体行：

1. **headless=new**：浏览器不创建可见窗口 —— 没有窗口可抢焦点，也就没有鼠标/键盘注入；
   全程**不调用任何系统级整屏截图**（CopyFromScreen 那一类会连桌面一起拍进去，还受遮挡影响）。
   自检里有一条静态判据专门钉这件事（`F4`）。
2. **专属 user-data-dir**：`<系统临时目录>/guif-render-shot-<pid>-<时间戳>-<随机>`。
   因为 profile 与用户的不同，浏览器**不会**把这次启动挂到你已经开着的 Edge 上
   （那种"复用"会借走你的窗口并抢一次导航），也不读不写你的 `~/.dsh` 与浏览器配置。
3. **精确回收**：只按**自己 spawn 出来的那个 pid** 收尾 —— 先走 CDP `Browser.close`，
   3 秒不退再 `taskkill /PID <pid> /T /F`（`/T` = 只覆盖该 pid 的**子树**）。
   **绝不按进程名批量杀**（源码里不出现 `/IM`；自检 `F2` 会拦），
   所以你同时开着自己的浏览器也不会被误杀。脚本被 Ctrl+C 时也有兜底钩子按同一个 pid 收尾。
4. **不联网**：`--disable-background-networking` / `--disable-component-update` / `--disable-sync`
   等关掉后台请求。页面对象是本地 `file://` 文件，或**回环**地址（`http://127.0.0.1:<独立端口>`，
   即真机实例）；CDP 也只连 `127.0.0.1` 回环。
5. **收尾删干净**：临时 profile 递归删除（带重试），失败也只在 stderr 说一句，不影响别的进程。

## 已知限制

- **只认 Edge / Chrome / Chromium**（标准安装位 + `GUIF_BROWSER_PATH` / `CHROME_PATH` /
  `PUPPETEER_EXECUTABLE_PATH` 环境变量 + `--browser` 显式指定）。本机只有 Edge，走的是
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。没有浏览器的机器上会明确报错。
- **不渲染需要联网的资源**：页面里的外链 CSS/字体/图片加载不到（断网是刻意的），
  本地相对路径的同目录资源可以（带 `--allow-file-access-from-files`）。
- **`file://` 的脚本限制照旧**：跨文件 `fetch`/XHR 受浏览器同源策略限制；
  需要复杂交互的页面请用 `--wait-ms` 给足时间，或把数据内联进 HTML。
- **整页高度上限**：单边 `16384` px、总像素 `64000000`。超过单边上限会**截断到 16384**
  并在 `--json` 里给 `clamped: true`（`pageHeight` 仍照实报告页面真实高度）；
  超过总像素上限直接失败（防异常页面把内存吃干）。
- **整页唤醒是启发式**：会关掉图片懒加载、从顶到底扫一遍（最多 40 步 × 40ms）再回顶端，
  用来触发滚动才出现的 IntersectionObserver 内容；更复杂的滚动动画仍可能拍不全。
- **像素尺寸与 CSS 尺寸 1:1**：`--force-device-scale-factor=1` + CDP
  `deviceScaleFactor: 1`。Windows 上 125% 缩放**不会**让产物变成 1600 宽 —— 这是刻意的
  （像素比对要对得上号）；要高清图请显式放大 `--width`/`--height`。
- **`--full-page` 的页面高度是"唤醒后"的高度**：先量一次、扫描、再量一次，取最后一次
  （扫描本身可能把内容撑高）。
- **整页截图会把渲染视口临时撑到内容高度再拍**（`Emulation.setDeviceMetricsOverride` →
  `Page.captureScreenshot{captureBeyondViewport:true}`）。这与 `puppeteer` 的 `fullPage`
  可观察行为一致，代价是**用 `vh` 单位的元素会随整页高度被拉伸** —— 换来的是"整页一定拍全"，
  不会出现拍到一半空白。要严格的"视口不变"请只截视口（不加 `--full-page`）。
- **一次只截一张**：没有批量模式；批量请在外面循环调用（每次独立进程、独立 profile）。
- **URL 目标要"已经在跑"**：`render-shot.mjs` 只负责打开与截图，**不负责起实例**（起实例 =
  `dsh-shot.mjs`，或者你自己起的独立端口实例）。URL 目标**必须是 `http(s)`**（`file://` 与相对路径按文件算），
  且**不能是 `127.0.0.1:3080`**（活体 GUI 红线，直接拒、无绕过开关）。
- **`--click-via js` 只派发 `click`，不产生 `pointerdown`**：这与真鼠标点击**在语义上不同**。
  本仓的浮层有一条"点外只关最上层"是挂在 `pointerdown` 上的 —— 所以"用 js 点击叠两扇浮层"能成功，
  真鼠标却会先摘掉一层。**要测"真鼠标点得动"就必须用 `mouse`**（默认），`js` 只用来"把面板点开好出图"。
- **裁剪（`--selector`）用页面坐标 + `captureBeyondViewport`**：元素在折线以下也拍得到；
  代价是**不重排**（不会为了元素把设备指标撑高），所以它拍的是"当前布局下那块区域"，
  与 `--full-page` 的"先撑高再拍"是两种口径（两者互斥）。
- **产物尺寸容差 1px**：`clip` 的像素取整在各版本上可能差一格；量级错误（整视口 / 空图 / 尺寸不符）
  照样抓得住。
- **等锚点每 200ms 数一次命中个数**：`--wait-for` 判的是"选择器有没有命中元素"，不是"元素可见/在视口内"。
  要"等到某个状态"请自己把状态写进选择器（例如等 `[data-guif-active="true"]`）。


## 自检

```powershell
node tools/render-shot.selftest.mjs              # 离线：68 项 PASS / 0 FAIL / **SKIP 2**（exit 0）
node tools/render-shot.selftest.mjs --browser    # 再跑两条真机项（G1/G2）——本轮未跑，见下
node tools/render-shot.mutation.mjs              # 反假绿轮：7 个靶点必须逐个翻红（离线，不起浏览器）
```

> **真机两项的现状**：由**真跑**转成过 PASS（不是改判）——
> G1 用 headless Edge 拍了本地 HTML 的整页图（页面高度 1616px、5189 B），G2 校验其 PNG 魔数与字节数；
> 那一轮合计 **PASS 63 / FAIL 0 / SKIP 0**（当时离线面 61 项）——**这是 2026-10-03 21:08 那一轮的历史读数，保持原样不改**。
> **当前条数一律以脚本自己的收尾行为准**（`[selftest] 合计：PASS …｜FAIL …｜SKIP …`，运行期插值；**本页不复述条数**，免得再出现下一条无声漂移）。
> **本轮没有再跑 `--browser`**（用户已叫停真机动作）⇒ 如实写"未跑"：不把 SKIP 记成 PASS，也不把没跑过的数字写成结果。

默认**不启动浏览器**。真机那两项会打印 `SKIP` 与原因，且 **SKIP 不计入 PASS** ——
把跳过算成通过等于自检自己骗自己。传 `--browser`（可加 `--browser-path <exe>`）才跑真机那一轮。

离线面覆盖：参数解析（缺 `--out`、非数字 `--width`、未知参数、缺值…）、浏览器候选顺序、
`--out` 缺省路径推导、**CDP 命令字面量形状**（`Page.enable` → `Emulation.setDeviceMetricsOverride`
→ `Page.navigate`；整页先撑设备指标再 `captureBeyondViewport` 拍）、空截图/非 PNG 判据，
以及三条静态纪律：**零第三方依赖**、**绝不按进程名批量杀**（只用 `/PID`，不出现 `/IM`）、
**无头**（`--headless=new`）。

2026-10-03 新增的离线面（真机出图那一支，全部离线可判）：

| 组 | 覆盖 |
| --- | --- |
| `H1–H4` | URL 输入（位置参数与 `--url`）、**3080 红线**（回环三种写法都拒、无绕过开关）、URL 产物名**不带 token**、URL 目标不做文件存在性检查而文件目标仍全套校验 |
| `H5–H8` | **等锚点超时 / 裁剪元素不在场或 0 尺寸 / 点击目标不在场**四条都必须报错（不静默出空图）；非法选择器一律判"用法错误"（exit 2），与"页面没出现"（exit 1）分开 |
| `H9–H10` | 点击两条路径的形状（`js` 走最近的外壳 button、真鼠标必带 `elementFromPoint` 命中测试）、裁剪收尾的字面量（一步 `captureScreenshot` + `clip` + `captureBeyondViewport`） |
| `H11–H16` | 新参数的用法错误面与默认值、`parsePngSize` 读 IHDR、**产物尺寸不符必须翻红**、**端到端退出码**（用子进程跑真 CLI，确认用法错误 exit 2 且都发生在起浏览器之前）、以及**入参归一化**（只给一半字段的程序化调用不会被带进"点 undefined 选择器"） |
| `S1–S7` | 编排器 `dsh-shot.mjs` 的静态纪律：零依赖、只按 `/PID`（无 `/IM`）、`shell:false` 起 dsh、3080 只读对比、临时 profile 删除白名单、参数面 |
| `M1–M7` | **内存硬闸**：纯判定四种输入、读数与接线可注入（Win32 的 KB⇒MB 换算）、**注入式端到端**（未达标 ⇒ 非零退出 + 无 PNG + **零子步骤**；达标 ⇒ 一路走到出图并回收）、**CLI 级负控**（阈值调到天上 ⇒ 非零退出且没走到起进程那几步）、显式关闸逃生口、静态顺序（闸先于任何起进程调用） |

**反假绿轮**（`render-shot.mutation.mjs`）：把上述文件**复制到系统临时目录**，每次只改坏一处
（裁剪分支短路 / 尺寸核对置零 / 摘掉 3080 红线 / 让等锚点超时静默 / 放宽 profile 删除白名单 /
改成按进程名杀 / 取消 click 字段的归一化），再跑副本自检，要求**靶点判据由绿转红**并列出"顺带多红了谁"。
当前 **7/7 靶点都被抓住**（M3 除靶点 `H4` 外还会红端到端那条 `H15`，如实记账）。
仓里的文件一个字节都不动；全程不起浏览器。


## 排错

| 现象 | 处理 |
| --- | --- |
| `找不到可用的浏览器` | 用 `--browser <exe>` 指定，或设 `GUIF_BROWSER_PATH` |
| `CDP 连接超时` / `启动后立刻退出` | 看是不是杀软拦了无头进程；`--keep-profile` 保留现场后手工核对；必要时 `--timeout-ms 60000` |
| `输入文件不存在` | 路径按**当前工作目录**解析；先 `--help` 看用法 |
| 图是空白的 | 页面可能是"等 JS 渲染"的：加大 `--wait-ms`；外链资源加载不到属于已知限制 |
| 产物比预期高/矮 | 整页模式看 `pageHeight` 与 `clamped`；视口模式确认 `--width/--height` |
| `等锚点超时（…ms）：选择器 … 始终没有命中任何元素` | **它就是结论**：那一刻页面上没有这个锚点（面板没点开 / 装的是旧字节 / 选择器写错）。先 `--selector` 换成更外面的锚点看看到底有什么，再确认点击那步是否真的生效（`--json` 的 `clicks[].via` / `hit`） |
| `找不到要裁剪的元素` / `尺寸为 0（不可见）` | 锚点在、但元素不可见或在别的容器里：换成 `[data-guif-panel]` 之类的外层锚点，或加大 `--wait-ms` |
| `产物尺寸不符：期望 … 实得 …` | 请求的取景口径与实际产物对不上（裁剪被忽略 / 拍成整视口）。先看 `--json` 的 `clip` 与 `size`，再确认 `--selector` 命中的是不是你以为的那个元素 |
| `拒绝访问 127.0.0.1:3080` | 这是红线：改指向独立端口实例（`node tools/dsh-shot.mjs`），不要试图绕过 |
| 点了没反应（面板不开） | 坞入口的图标中心被覆盖层挡着：用 `--click-via js`（对最近的外壳行按钮派发 click），并用 `--click-index` 试第 n 个坞入口；`--json` 的 `clicks[].hit.self=false` 就是"点被吞了"的现场 |

