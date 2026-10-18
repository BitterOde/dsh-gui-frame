# verify/real-machine —— 真机验收装置

> ⚠ **本版（v1）的现状，先读这一段再看下面的跑法**：这套装置是随 v2 线一起长起来的，
> 它的**交互判据以「演示面板」上的按钮为触发面**（`[data-guif-demo-*]` 锚点：开浮层、开对话层、
> 打诊断），而本版**没有演示面板** —— 活样本换成了坞的管理页。带来的后果如实记账：
> - 触发面不存在 ⇒ 依赖它点开东西的那几条判据在本版**跑不出结果**（会停在等就绪），
>   不是「判红」，是**没有可判的东西**；
> - 「坏载荷态」整条是为**布局能力**写的（往 `gui-frame.layout` 写坏值，取证「用默认值覆盖」），
>   本版没有布局能力 ⇒ 那条态**不适用**；
> - 本仓**当前没有任何绑定本交付态的真机读数**，下面的读数与轮次记账都是历史记录。
>
> 要重启真机线，第一件事是把触发面接到坞的管理页（自检页）上；在那之前，本目录的价值是
> **引擎与纪律**（临时 profile、独立端口、精确回收、CDP、证据落盘），不是它的判据清单。

**这是什么**：把「手动真机验收」固化成**可重复执行、带判据与退出码、自带牙**的脚本。
它从**出厂模板**建一个临时 profile → 用 `link:` 注册本包 → `--dump-config` 验 loader entry 恰好一次 →
起独立端口实例 → headless Edge（CDP）采判据 → 收尾精确回收自己起的进程 → 落盘证据。

```
verify/real-machine/
  run.mjs              # 唯一入口（编排 + 判据 + 报告 + 退出码）
  lib/dsh.mjs          # profile 生命周期与实例进程（按 pid 精确回收 + 端口复核）
  lib/cdp.mjs          # headless Edge + 极简 CDP 客户端（零第三方依赖，用 Node 自带 WebSocket）
  lib/judge.mjs        # 页面快照 / 真鼠标点击 / **坞面板读数与导航（t1）** / console 分类记账 / 报告材料
  evidence/<stamp>/    # 每次跑的证据：report.md + raw.json + 实例与 Edge 日志 + dump-config.yml
```

## 纪律（**先读再跑**）

1. **本目录是全仓唯一允许起进程的验证资产**；`src/**`、`tests/**`、`scripts/**` 的任何东西都不许起进程。
2. **跑它之前要取一次明确同意**（用户或 captain）。默认不要在别人正跑全量门禁时跑：
   `tests/unit/panel-hooks.test.mjs` 的变异 scratch 是包内固定目录，**两个 `npm test` 不能并发**（t48 在处置）。
3. **只用自己新建的临时 profile**（`guifrm<时间戳>`，出厂模板），**绝不写 `web`**；
   **绝不碰 127.0.0.1:3080**（那是用户正在用的 GUI）——脚本只**读**它的 PID，收尾核对没变（cleanup-pid-unchanged）。
4. **收尾只回收自己起的进程**：
   - 两个 dsh 实例：`stopAndVerify()` **按 pid 直杀 + 轮询端口确认释放**（cleanup-ports）；
   - 浏览器：只回收命令行里带**自己专属 `--user-data-dir`** 的 msedge（cleanup-browser）；
   - **绝不**「杀所有 node / 杀所有 msedge」。
5. **（t8 起）整跑跑在独立的 `$DSH_HOME` 上**（默认 `%TEMP%/guif-dsh-<stamp>`，收尾删；另挂一道 `process.on('exit')` 兜底）。
   为什么必须隔离：客户端设置的落地文件是 **`$DSH_HOME/settings.yaml`**（`dsh-settings-file` 的 `resolveSpec`），
   而用户正在用的 GUI（3080）读的是同一份 `~/.dsh/settings.yaml` —— 本装置要往 `gui-frame.layout` 写坏载荷取证，
   写进用户真实 home 就是污染用户环境。隔离后**用户 `~/.dsh` 只读不写**（isolated-home / cleanup-home 就是钉这条的）。
   代价（必须知道）：临时 home 里**没有会话、没有 API Key** ⇒ 外壳会连着弹它自己的必答 Dialog
   （「内测声明 … 继续」→「添加一个 API Key … 稍后配置」），**全屏遮罩会把本包面板整块盖住**。
   装置把这件事当**环境前置**如实处置并记账（shell-modal-cleared），否则真鼠标判据会以「点不动」的形式齐红（t8 首次整跑就踩过）。

## 跑法

```bash
cd dsh-gui-frame
node verify/real-machine/run.mjs                    # 常规态：不装对照组 + 装后全判据 + 坏载荷态
node verify/real-machine/run.mjs --dry-run          # 只打印计划，不起任何进程
node verify/real-machine/run.mjs --keep             # 保留临时 profile / 隔离 home / 证据目录（排障）
node verify/real-machine/run.mjs --only=corrupt     # 只跑某一段（control|install|corrupt，逗号分隔）——判据校准用
node verify/real-machine/run.mjs --dsh-home=<路径>  # 用指定的 harness home（**那种不删**；默认自己造一个临时的、收尾删掉）
node verify/real-machine/run.mjs --mutation=anchor       # 有牙对照①：把坞入口锚点选择器改错 ⇒ anchors-all（含 anchors-subset）判红
node verify/real-machine/run.mjs --mutation=console-apply # 有牙对照②：注入同形 console.error ⇒ console-apply-failure 判红
node verify/real-machine/run.mjs --mutation=dock-action   # 有牙对照③（t1）：把坞面板动作锚点选择器改错 ⇒ 只该翻转 dock-panel-actions
node verify/real-machine/run.mjs --mutation=dialog-inside # 有牙对照④（t8）：把**浮层内部第二扇入口**选择器改错 ⇒ 翻转 overlay-inside-entry/overlay-two-layers/overlay-esc-top
node verify/real-machine/run.mjs --mutation=layout-overwrite # 有牙对照⑤（t8）：把「用默认值覆盖」锚点选择器改错 ⇒ 该翻 corrupt-action-result/corrupt-file-rebuilt（**当前不可证**，见下）
node verify/real-machine/run.mjs --mutation=layout-path  # 有牙对照⑥（t8）：把**装置读证据的文件**指到别处 ⇒ 该翻 corrupt-no-write-before/corrupt-file-rebuilt（**当前不可证**）
node verify/real-machine/run.mjs --profile=<名> --out=<目录>
```

退出码：常规轮 = 硬失败数 > 0 ? 1 : 0；**变异轮一律 exit 1**（它本身就是「应当判红」的证据）。
`留人工` / `预期` / **`未取真机证`** 三类判据**不算硬失败** —— 但**逐条打印并计入汇总**，绝不静默跳过。

## 判据清单（id → 看什么 → 合格线）

| id | 判据 | 合格线 |
| --- | --- | --- |
| baseline-pid | 记录 3080 监听者 PID | 先记下来，收尾必须相同 |
| environment-ready | 环境：本包与 Edge 可达 | 两者都在 |
| **isolated-home**（t8 新增） | **隔离**：本次跑用独立 `$DSH_HOME`（用户真实 home 全程只读） | `process.env.DSH_HOME` = 本轮 home 且 ≠ 用户 home，且 `lib/dsh.mjs` 视角一致 |
| **shell-modal-cleared / shell-modal-cleared-corrupt**（t8 新增） | **页面可交互前置（环境）**：外壳自己的模态遮罩已清掉、本包面板可达 | 处置前读出「遮罩在场 + 那颗必答按钮的文案」→ 真 Escape / 关闭 / 对话框按钮 逐步处置 → 处置后 `maskPresent=false`，开面板后探针点最上层属于本包（`ours=true`）。**处置不了就判红**（真鼠标判据会全被它吞掉） |
| control-profile | 对照组 profile 从出厂模板建成 | `--dump-config` 里 `gui-frame` entry **恰 0 次** |
| control-instance | 对照组实例起得来 | 独立端口 + 带 token 的启动 URL |
| not-installed-page | **不装态**页面照常启动 | 正文 > 200 字符，本包锚点**全 0**（零影响） |
| not-installed-console | 不装态 console 无本包硬红 | 0 |
| plugin-add | `dsh plugin add link:<本包>` | exit 0 |
| dump-config-single-entry | 装后 `--dump-config` | `gui-frame` entry **恰 1 次**（duplicate 直接起不来） |
| installed-instance | 装后实例起得来 | 独立端口；未触碰 3080 |
| **bundle-identity** | **前置闸：页面加载的字节是不是「当前这一版」构建产物**（t37 起**验身份**，不再只验标记串） | ① 服务字节含判据标记 `useStandInHook`；② **服务字节逐字包含当前 `lib/client.js` 的文本**（同一归一化口径：本地按 utf8 读成 JS 字符串、与服务端响应文本比）。身份口径三级、**都不是「只看标记」**：`verbatim`（原样）→ `combo-source`（按平台 `comboSource()` 去掉 sourceURL/sourceMappingURL trailer + 补结尾换行）→ `combo-joined`（再补平台拼接的 `;\n`）。取不到字节 / fetch 失败 / 三级都不成立 ⇒ **判红（fail-closed）**，detail 给出「找到/未找到」、首次命中偏移、首尾探针与**两种量纲**的读数。**已堵的假绿通道**：旧 bundle 里恰好含 `useStandInHook`（每版产物都有）⇒ 老口径判绿；t37 起判红（离线负控 `[G2]`）。**✅ 第七轮真机首次报级＝`verbatim`**（命中偏移 10639593；该响应是含 53 份 bundle 的组合路由）。**量纲**：`units` 是 **UTF-16 码元数**、`utf8Bytes` 是 **UTF-8 字节数**——见下「`bytes` 的量纲」小节 |
| anchors-all | 五类锚点齐：面板 / 主题 / 坞入口 / 浮层宿主 / 布局编辑器 | 五类都 > 0 |
| anchors-subset | 锚点子集（坞入口 / 主题 / 浮层宿主）三类都出现 | 三类都 > 0（有牙对照 `--mutation=anchor` 打的就是它） |
| **dock-panel-actions**（t1 新增） | **坞面板＝动作型入口收纳台**（阶段 1.5 重构后的新产品面） | ① 本包在 `sidebar.panellist` 的条目**恰 1 条**（坞自己）；② 坞面板里 `[data-guif-dock-action]` **≥ 1**；③ `[data-guif-dock-actions]` 的**数值**与②数出来的锚点数**一致**；④ 坞面板底部挂着布局编辑器（`[data-guif-dock-editor]` **≥ 1**）。有牙对照 `--mutation=dock-action`。**只作读数、不作判据**：`[data-guif-badge]`（见下「坞面板口径翻面」） |
| **mutation-target-set**（t1 起：`dock-action`；t8 扩到全部登记过靶点的变异） | **有牙范围闸** | 该轮硬失败集**恰等于**靶点集（多红/少红都记账）。靶点表见下「变异」小节。靶点判据自己「未取真机证」时，闸也如实记**未证**（不把「不可证」说成「没抓住」） |
| demo-dock…d | **demo 四段逐段走** | ① 有正文非错态；② `data-guif-layout-editor` 在场且非 error；③④ 仍可点（无连坐） |
| **panel-health** | **面板健康五件套**（t50 补强；F-real-4 的可机检合格线） | 打开 demo 面板后：① `[data-guif-state]` 三态锚点**全消失**；② 正文**不含** `is not a function`；③ `data-guif-active` = `true`；④ `data-guif-sessions-count` 是**纯数字**，且与**外壳侧真值参照**对齐 —— 参照（`[data-ds-session]`／`[data-session-id]`／`a[href*="/session"]` 三者取**最大**）为 **0** 时**接受任意数字（含 `0`）**，参照 **> 0** 时必须与它**相等**；`unknown`／非数字一律不算（**t12 校正：此前写成「纯数字且 > 0，0 不算」，与实现不符** —— 权威轮里 `sessions-count=0` 而参照也是 0，那条判据当时就是 pass）；⑤ 四段动作 `dock`/`layout`/`channel`/`overlay` 齐备（「可点」由 demo-dock…demo-overlay 逐段点验）。有界等待 9s（补装窗口第一遍的 loading 属设计内） |
| **overlay-two-layers** | GB21 证①：两扇浮层**各点一次**开出、两个层级号且后者更大、活层栈底→顶与开窗账两行同序 | ① 开窗账**恰 2 行**（⇒ 点击次数＝期望层数，**不许靠重复点击凑数**）；② `z` 恰 2 个且 **递增**；③ **活的层栈**（`[data-guif-overlay-layer]`）恰 2 层且底＝账上第 1 行 id、顶＝账上第 2 行 id。**不看只有浮动窗才有的 `[data-guif-window]`**（官方 Modal 没有它） |
| **overlay-esc-top** | GB21 证①：Esc 只关栈顶 | 用**活的层栈**读数做减法：Esc 后**恰剩 1 层**、少掉的正是 Esc 前的**栈顶**那扇、且**底下那扇还在**。**不用第④段那份只增不减的开窗账**（它记历史，Esc 关了也不会变短） |
| **overlay-real-mouse** | **真鼠标路径**（t54 新增）：第④段两扇各一次**真鼠标**点击 | ① 两次点击的 `elementFromPoint` 都**命中自身**（命中元素是 `BUTTON`，不是任何覆盖层）＝「无 class 的遮挡 DIV」确已修掉；② 每次点击**恰开一层**（开窗账 +1）；③ `z` 递增；④ **如实记录设计内的「点外只关最上层」**：第二次真鼠标点击的 `pointerdown` 打在浮层之外 ⇒ 先摘掉第一扇再开第二扇（`被摘=[demo-window]`）。**这条是 overlay-two-layers/overlay-esc-top 的前置事实**：真鼠标点得动、点击与开层 1:1 |
| **overlay-inside-entry**（t8 新增） | **GB21 证① 第二扇＝真鼠标**（走 t6 冻结的**浮层内部**入口 `[data-guif-demo-open-dialog-inside]`） | ① 该锚点在场且**真在浮层宿主内部**（`closest('[data-guif-overlay-root]')`）且在浮动窗里；② 这一扇**只做了一次点击、那次是真鼠标且命中自身**（`mouseHitSelf=true`，`attempts.length===1` ⇒ **没有**走 JS 兜底）；③ 那一下**恰开一层**（账 +1）。**单列这条的理由**：若哪天退回 JS 兜底，overlay-two-layers/overlay-esc-top 仍会绿 —— 只有它能抓住（反假绿）。有牙对照 `--mutation=dialog-inside` |
| **corrupt-payload-seed / corrupt-payload-start**（t8 新增） | 坏载荷态前置：把 `schemaVersion` 高于本实现的载荷写进**临时 home** 的 `settings.yaml`；实例起得来 | 写入成功（字节数记账）＋ 独立端口起来 |
| **corrupt-payload-visible**（t8 新增） | 坏载荷态**可达性前置**：`gui-frame` 命名空间对客户端**可见**（`read.kind ∈ {ready, empty, invalid, error}`） | **真机实测判红**（`read.kind=unavailable`）：客户端 scope 只在宿主 `settings.describe()` 的**已注册**命名空间里找自己那一节，而本包 `src/` 只有 `client/**`、全仓没有一处为 `gui-frame` 做宿主侧注册 ⇒ 布局持久化（GB9/GF22「可保存」）在真机上**没有接上宿主**。这条红是**真实的能力级缺口**，不是装置瑕疵（详见下「t8 真机口径翻面」） |
| **corrupt-invalid-readable…corrupt-file-rebuilt**（t8 新增） | 坏载荷态四条：a 载荷被读成 `invalid` 且界面给出唯一人工出路；**b 负控＝点它之前一个字节都没写回**；c 点它之后界面说出结果 + 可写恢复 + 出路消失；d 落盘：坏载荷被清掉、按当前已注册入口重建（幽灵条目消失、已注册入口一个不少、落盘顺序＝编辑器显示顺序） | 前置可达时按上述逐条判。**当前真机不可达 ⇒ 四条一律记「未取真机证」**（附完整现场读数：状态行、锚点计数、文件原文/版本号/docks、点击策略）。**绝不用 t6 的替身单测把这四条写成真机绿** |
| diagnostics-client-sent/b | Q17 专测：界面 `sent` + 宿主 stderr `[gui-frame] 客户端失败 …` | 两处都在 |
| **workbench-toggle**（t18 新增） | **工作台开关在位且三处同源**（GB22）：容器冻结锚点 `[data-guif-workbench-switch]` 恰 1 个、内部 `button[role="switch"]`、状态读数 `[data-guif-workbench-state]` ∈ {`official`,`workbench`} 与 `aria-checked` / 滑块 `[data-guif-workbench-thumb]`（`left`/`right`）**逐一对应** | 三处必须同源（容器/开关本体/滑块都由同一个 `on` 派生）：锚点恰 1 个 + `aria-checked === (state==='workbench')` + `thumb === (state==='workbench' ? 'right' : 'left'）`。**会红**：缺开关、`role="switch"` 被去掉、`aria-checked` 与状态读数打架、thumb 与状态不一致、锚点重复 |
| **workbench-enter**（t18 新增） | **真鼠标点一次 ⇒ 进工作台布局**：状态读数=`workbench`、侧栏**收起**、坞面板渲染在**中心列**、右栏轨打开 | ① 那一次点击必须是**真鼠标且 `elementFromPoint` 命中自身**（`via==='mouse'`，退回 JS 兜底即判红）；② `data-guif-workbench-state=workbench`；③ 官方 frame 的 `data-sidebar-collapsed` 在场**且侧栏轨 = 56**（装机源码 `computeColumns` 的 rail 宽；⚠ 轨串在真机上被 Chrome 规范化成 `minmax(0px, 1fr)`，解析必须两种都认——见「已知限制」）；④ 恰好 3 条轨；⑤ `[data-guif-panel]` **在中心列**（`frame.children[1]`）里；⑥ 右栏轨 > 0 且 `data-rightbar-collapsed` **不在**；⑦ 侧栏拖柄 `[data-side="sidebar"]` **消失**（官方只在未收起时渲染它）。**会红**：侧栏没收起、坞面板没进中心列、右栏没开、拖柄没跟着收、走了 JS 兜底。⚠ **「main 是否算全屏」属观感** ⇒ 本判据只断言结构与官方属性，视觉判定见 workbench-manual |
| **workbench-restore**（t18 新增） | **再点一次 ⇒ 完全还原**：退出后的读数与**进入前**逐字段相等（**不是「看起来回来了」**） | 逐字段比对 `workbenchDigest`：状态 / 侧栏收起与轨宽 / 轨数 / 右栏轨与 fullscreen / 侧栏拖柄 / **main 是否还停在坞面板** / 侧栏内容摘要。**会红**（离线自检 `workbench-selftest.mjs` 逐条喂过）：① 进入前侧栏已收起、退出后却展开（把 toggle 写成「设回默认宽」）；② 退出后 main 还停在坞面板（忘了 `selectPanel` 回退）；③ 右栏没关回去；④ 拖柄渲染条件搞反 |
| **workbench-persist**（t18 新增） | **刷新后状态保留**：`workbench` 真的**写进隔离 home 的 `settings.yaml`**（看字节），且 `Page.reload` 之后状态读数仍是 `workbench`、侧栏收起、坞面板仍在中心列 | ① 隔离 `$DSH_HOME/settings.yaml` 原文里含 `workbench`（**不只看界面**）；② **真刷新**（`Page.reload`）后 `data-guif-workbench-state=workbench`；③ 侧栏仍收起；④ 坞面板仍在中心列（＝持久化值被**采用**成布局，不是只翻了个标志）。**会红**：没落盘、落盘了但刷新后没被采用、文件读不到。界面若显示只读提示（`[data-guif-workbench-notice]`）会原样记进读数。**过程读数**（不作判据）：宿主 stderr 的 `[timeline]` 四点行连同组数原样列进 `detail`（读法见下面「workbench-persist 的过程读数」一节） |
| **workbench-official-frame**（t18 新增） | **官方侧两种布局下不受影响（官方 frame 契约面）**：官方 frame 契约自洽 + 侧栏内容摘要/语义标签两态**完全一致** | ① `[data-shell-overlay]` 与 `[data-rightbar-col]` 各 **1**、恰好 **3** 条轨（两态）；② 侧栏内容摘要（`[role]`/`button`/`a` 的 tag+role+aria-label 串）两态相等；③ 侧栏语义标签（显式 `aria-label`/`title`）两态相等。**会红**：侧栏内容变了、frame 结构被破坏。⚠ 「非本包入口」那一分句**已拆到 workbench-official-entries**（t25 收口 t19-F4：留在这里就是恒真） |
| **workbench-official-entries**（t25 新增） | **非本包（官方 / 其它插件）的侧栏入口在两种布局下不受影响**：两态读数**非空且逐项相等** | 带**适用性闸**：两态都是空数组 ⇒ 本条**不适用**，按「**未取真机证**」登记（**不算绿**，理由写进 `reason`）；两态非空才比相等。**会红**：少一个入口 / 一侧空一侧非空（离线自检 F5–F8）。⚠ 出厂 profile 只装本包 ⇒ 本环境**不可测**，要真覆盖需一个**装了别的 panellist 占用者**的 profile |
| **workbench-cause**（t25 新增） | **workbench-persist 的成因二选一钉死**（宿主侧注册读数 ✕ 客户端读数交叉定位） | 宿主读数＝grep `[gui-frame] settings 注册`（t24 落地，取最后一行）；客户端读数＝坞面板编辑器状态行的 `read.kind` + `data-guif-layout-writable`。三种互斥世界任一成立即 pass：① `host-not-registered`（宿主未注册 + reason）② `registered-but-client-cannot-see`（宿主已注册而客户端仍读不到）③ `registered-and-client-writable`（与本条无关）。**拿不到宿主那行 ⇒ `insufficient-readout`，按「未取真机证」登记，不猜**（离线自检 H1–H7） |
| **workbench-manual**（t18 新增） | 留人工项（本装置不代判）：工作台切换的**闪屏 / 切换动画 / 观感是否与现有 DSH 一致 / 布局切换手感**，以及「main 看起来是否算全屏」 | **不代判**，只列出 |
| console-apply-failure | console `[gui-frame] 客户端 apply 失败` | **命中 0**（GB15 会把它吞在界面上，只有 console 有原文） |
| console-react-error | console `Minified React error` / hooks 顺序错误 | **命中 0**（替身 react 不校验 hooks 顺序，这是真机盲区） |
| console-expected-degraded | `能力「X」未装配：no-slots` 这类**补装窗口的预期降级** | 单列「预期」，**不算红**（设计内行为，别去「修」） |
| console-other-errors | 其余 error 级条目 | 逐条列出（不隐藏） |
| manual-gesture | 留人工项（拖动手感/观感/GB21 ②③④ 手感） | **不代判**，只列出 |
| **cleanup-pid-unchanged/b/c** | 收尾：3080 PID 不变、浏览器按标记回收、**实例全部不再监听** | 三条都过 |

## `bytes` 的量纲（t37 写死，**别再混用**）

| 名字（装置里的字段） | 是什么 | 怎么算 |
| --- | --- | --- |
| `units`（原 `bytes`，**已改名**） | **UTF-16 码元数** | 浏览器/Node 里 `text.length` |
| `utf8Bytes` | **UTF-8 字节数** | 页面侧 `new TextEncoder().encode(text).length`；Node 侧 `Buffer.byteLength(text,'utf8')` |
| `statSize` | **文件字节数** | `statSync(path).size`（与本包产物应**等于** `utf8Bytes`） |

**为什么必须写死**：`text.length` 是**码元**不是字节。本包产物里非 ASCII（中文注释）占比很高，两者能差出 14 万+。
- 实测（t37 当时的交付态）`lib/client.js` ＝ **677445 UTF-8 字节 / 536337 UTF-16 码元**（差 **141108**）。
- 随时重算：`node -e "const t=require('fs').readFileSync('lib/client.js','utf8');console.log('utf8',Buffer.byteLength(t,'utf8'),'units',t.length)"`。
- ⇒ 任何「页 bundle 的长度差 vs 产物的字节差」这种比较，**必须先统一量纲**；跨版本比长度差本身也不可靠（页里是**多插件拼接**的组合响应，见下）。

**服务字节是怎么拼出来的（t37 读平台真源，用于定「身份」口径）** —— `@deepseek-ai/dsh-client-modules/lib/index.js`：
- `comboUrl()`：页面上那条 URL 是**组合路由**（`/plugins/??<id>/client.js,…&rev=<12 位内容哈希>`），一次可带**多个插件**的 bundle ⇒ 页响应是多份产物**顺序拼接**的结果，不是本包一份。
- `comboSource()`：拼接前对每份产物做两步 —— **去掉** `//# sourceURL=` / `//# sourceMappingURL=` 两条 trailer，再**保证结尾有 `\n`**。
- `buildCombo()`：每份处理后接 **`;\n`** 再拼。
⇒ 所以「逐字包含」要在**上面那两步归一化**之后成立（装置的三级口径就是照抄这两步；**没有一级退回「只看标记」**）。**本装置从 t37 起 bundle-identity 验身份，不再只验标记串**；「旧 bundle 含 marker 即绿」已列为**已堵的假绿通道**（离线负控 `[G2]` 注入式复现：旧字节 + 保留 marker ⇒ 判红）。

## 工作台（GB22）真机判据（t18 新增）

**要判什么**：GB22 的验收里有四条**只能在真机上成立** —— 「开关 → 布局切换（侧栏收起 / main 切坞面板 / 右栏在位）」「切回官方布局能**完全还原**」「**刷新后**开关状态保留」「官方 CordisPanel 与侧栏其它入口在两种布局下不受影响」。单测证明不了它们（本项目头号教训：替身绿 ≠ 真机绿）。

**冻结锚点**（t17 的 `src/client/workbench/switch.mjs` 定义，装置侧**只读名字、不另起一套**）：

| 锚点 | 值 | 判什么 |
| --- | --- | --- |
| `data-guif-workbench-switch` | —— | 开关容器（**恰 1 个**） |
| `data-guif-workbench-state` | `official` / `workbench` | 状态读数（真值来源） |
| `data-guif-workbench-thumb` | `left` / `right` | 滑块位置（与状态同源） |
| `button[role="switch"]` + `aria-checked` | `true` / `false` | 无障碍语义（必须与状态读数一致） |
| `data-guif-workbench-notice` | 文案 | **只读/没写进设置** 时界面自己说的话（作读数，不作判据） |

**官方 frame 契约从哪来**（不是猜的）：装机源码 `@deepseek-ai/dsh-client-ui-layout/lib/client.js`（t18 实读）——
`frame.style.gridTemplateColumns = "<sidebar>px minmax(0, 1fr) <rightbar>px"`、`data-sidebar-collapsed` / `data-rightbar-collapsed` / `data-rightbar-fullscreen`（**为真才出现**，源码是 `x || void 0`）、子列顺序 `[0]` 侧栏 / `[1]` 中心列、`[data-rightbar-col]` 右栏列、`[data-shell-overlay]` 浮层宿主、**侧栏拖柄只在未收起时渲染**、`SIDEBAR_AUTO_COLLAPSE = 1024`（本装置 Edge 固定 `--window-size=1280,900` ⇒ 不走窄屏分支）、`toggleSidebar()` 是 `sidebar = sidebar === 0 ? 280 : 0` 的**自逆**动作、收起时侧栏轨 = **56**（rail）。

**为什么号段叫 RM-17 而不是任务书建议的 `RM-10a–e`**：**`RM-10` 已经被「对照组 profile entry 恰 0 次」占用**（见上面判据表）⇒ 再用 RM-10x 会让靶点表/报告里两族撞号。id 自选是任务书允许的，这里选独立号段并在本表登记。

**有牙自证是离线做的，不是靠变异轮**：

```bash
node verify/real-machine/workbench-selftest.mjs      # jsdom 合成页面，全绿；不起任何进程、不联网
```

它把 `lib/judge.mjs` 里那**八个纯函数判定 + 四个解析器/采样口**（`workbenchSwitchVerdict` / `workbenchEnterVerdict` / `workbenchRestored` / `workbenchPersistVerdict` / `workbenchOfficialVerdict` / `workbenchOfficialEntriesVerdict` / `workbenchHostSettingsVerdict`，外加 `parseLayoutSection` / `readKindFromStatusText` / `parseSettingsInstallLine` / `timelineLines`+`parseTimelineLine` 与页面侧 trap `workbenchProbeInitScript`）在「官方态 / 工作台态 / **没还原**态 / **空数组**态 / 宿主四种读数态 / **两种 YAML 写法** / **时间线两个世界（未采用 vs 已采用）**」上各跑一遍，并逐条配负控（**每条判定都必须有一个「变红」的实例**）。真机轮与离线轮调的是**同一份函数**——不是两份平行逻辑。（用户已叫停大体量测试 ⇒ **零变异轮**，`RM-17` 一族**不登记变异靶点**。）
**数字口径**：**判据条数以脚本自己的收尾行为准**（`[workbench-selftest] 合计：PASS …｜FAIL 0`，运行期插值）——
**本页不复述条数**，避免下一条无声漂移；下面这串是**轮次绑定的历史读数（保持原样，不改）**：
t25 之前是 30（t19 复核时 33）→ t25 后 45 → t27 再加页面侧 trap（`[P1]–[P5]`）与流式 YAML 解析（`[L1]–[L5]`）后为 55 → t30 再加时间线解析/分组（`[T1]–[T4]`，两世界 + 负控）后为 59 → t34 再加判读段解析（`[T5]`）与宿主侧残因归类（`[T6]`/`[T7]` + 负控 `[T8]`）后为 63 → **t37 再加页面字节**身份**闸（`[G1]`–`[G7]`：未变异必须绿／旧字节含 marker 必须红／取不到必须红／归一化口径仍是身份判据／量纲写死／真尺寸演练）后为 70**。

**workbench-official-frame vs workbench-official-entries（t25 收口 t19-F4）**：`workbench-official-frame` 只判「官方 frame 契约自洽 + 侧栏摘要/语义标签两态一致」；
「**非本包入口**在两种布局下不受影响」单列为 **`workbench-official-entries`**，并带**适用性闸**：出厂 profile 里两态读数都是空数组 ⇒ 本条**不适用**（按「未取真机证」登记，**不算绿**），
两态非空时才真比相等（离线自检 F5–F8 覆盖空/非空/少一个/一侧空四种输入）。**不许**把恒真等式塞回 `workbench-official-frame` 的 ok 链。

**workbench-cause（t25 新增）**：用 t24 的宿主侧读数（grep 前缀 `[gui-frame] settings 注册`）+ 客户端读数（坞面板编辑器状态行的 `read.kind` 与 `data-guif-layout-writable`）把 workbench-persist 的成因**二选一（或第三态）钉死**；
拿不到宿主那行 ⇒ `insufficient-readout`，按「未取真机证」登记，**不猜**。

**workbench-persist 的过程读数：宿主 stderr 的 `[timeline]` 四点行（t30 采集 + t34 扩读，**只是读数、不参与判绿/判红**）**

`run.mjs` 用 `TIMELINE_MARKER` / `timelineLines()` 从实例 stderr（`evidence/<stamp>/install-server.log`）抓 `[timeline]` 行，用 `parseTimelineLine()` 解析，按 `index===1` **分组**（页面每载入一次打一组），把**原始行**与**解析结果**一起写进 `raw.workbenchTimeline`，并把**最后一组**（＝最后一次页面载入，即 `Page.reload` 那次）列进 `workbench-persist` 的 `detail`。行格式（真源 `src/client/workbench/timeline.mjs`；行末那段是 **t31 加的判读段**）：

```text
[timeline] 1/4 t≈5ms state=official readKindAtLoad=loading storeRead=empty:null deferred.armed=true deferred.fired=0 layoutRev=2 adopted=false scope=ready@rev2 val=[layout] usr=[layout]
```

**读法（两把尺子怎么比）**：
- **未采用世界**：`state=official` + `readKindAtLoad=loading` + `storeRead=empty:null` + `deferred.armed=true` + `deferred.fired=0` + `adopted=false`（t30 实读即此形）。
- **已采用世界**：`state=workbench` + `readKindAtLoad=ready` + `storeRead=ready:workbench` + `deferred.armed=false` + `deferred.fired=1` + `adopted=true`（**t34 实读即此形**）。
- 偏移**相对页面载入**（插件自己在载入后 5 ms / 0.8 s / 3.2 s / 6.2 s 打点）；装置自己的界面采样（`stateTimeline`）偏移**相对 `reloadT0`**，而 `reloadT0` 排在「刷新后模态有界轮询」之后（6×700 ms）⇒ 界面四点实际落在**页面载入后约 5 s … 11 s**。**别把两个偏移直接相减**。
- `storeRead=empty` 的含义（`persist.mjs` 的 `read()`）：**`snapshot.status==='ready'` 之后字段缺失**才会返回它（另一条来路是「本页刚显式覆盖过」的本地账）；`empty:null` 里的 `null` 是字段值。
- **t30 真机读数把「未采用」钉到**：reload 后那次载入 `readKindAtLoad=loading`（载荷被丢、屏障套空默认布局、`layoutRev=2`）+ 为它挂的补载入 `armed=true / fired=0 / skipped=null`（**不是被守卫拦下，是订阅回调没拿到过可用 status**）。
- ⚠ **方法论坑（t30 的结论在 t34 被「换了个红点」取代，两轮都别混）**：t30 的「光让补载入早点 fire 救不回来」是**那一轮读数下的正确结论**（当时同窗口 `storeRead=empty`）；**t34 复现不到那个形态**（四点全是 `storeRead=ready:workbench`，`fired=1`、`adopted=true`）⇒ 采用链已通。两轮差异**未归因**（装置侧两轮只改了读数；实现侧唯一变量是 t31 的客户端修法）—— 不许写成结论。

**判读段与宿主侧残因归类（t34；判读表由 t31 给定，装置只照表归类）**

| 现象（`val` = 宿主 `describe()` 的键名；`usr` = 原始用户层键名） | `classifyHostResidual()` 归类 |
| --- | --- |
| `val=[…含 layout]` | `host-value-present`（**t34 命中**：`val=[layout] usr=[layout]` ⇒ 宿主答案里带着这一节） |
| `val=[] usr=[layout]` | `host-resolved-key-away`（有值却被宿主那一环解析掉） |
| `val=[] usr=[]` | `absent-from-host-answer`（宿主答案里本来就没有） |
| 判读段缺失（旧格式行） | `unknown`（**不猜**） |

- `scope=<status>@rev<N>` 里的 `@rev0` 另挂一条附加读数 `fresh-registration`（注册是新造的，与内存节≠文件呼应）；**`rev=0` 不覆盖主归类**。
- 归类结果写进 `workbench-persist` 的 `detail`（**读数，不参与判绿/判红**）；离线自检 `[T6]–[T8]` 逐条配正反例（含「判读段缺失 ⇒ unknown」的负控）。
- **t34 的归类结论**：`host-value-present` + `scope@rev2/rev3`（非 0）+ 宿主注册行 `seq=1 / registered=true` ⇒ **宿主侧那一节在**；t30 那种「快照 ready 却不含这份值」的形态**没有复现**。

**t34 的另一个结论（红点换了，判据未动）**：`[timeline]` 已是「已采用」世界，官方 frame 也确实是工作台布局（`data-sidebar-collapsed=true`、轨 `56px minmax(0px, 1fr) 565px`、坞面板在中心列），**但开关自己的三处读数仍是 `official`**（`aria-checked=false` / `thumb=left`，四点一致）⇒ `workbench-persist` **仍判红**，红点＝**开关显示与采用后的布局不同步**（源码级读数：`switch.mjs` 在挂载时一次性取 `runtime.isWorkbench()` 存进 `useState`，之后只在自己被点时才 `setOn`，**没有订阅采用通知**）。⚠ 不许据此改判据，也不许再说「刷新后没被采用」。


## 变异（证明装置有牙）

- **`--mutation=anchor`**：把 anchors-all/anchors-subset 读的**坞入口**（`[data-guif-glyph]`）选择器换成不存在的那个 ⇒ **anchors-all 与 anchors-subset 必判红**（两条都读 `anchors.glyph`，实测两轮证据一致），其余判据不受影响。
  （**README 口径更正（t1）**：此前这里写的是「把布局编辑器锚点选择器改错」——与代码不符，代码改的是坞入口锚点；如实改为实测口径。）
- **`--mutation=console-apply`**：页面里注入一条与硬红判据同形的 `console.error` ⇒ **console-apply-failure 必判红**。
- `--mutation=apply-throw`（**已如实记账为「拦不住」**）：本想包住 `window.__ModuleLoader__.load` 让 `apply` 抛错，
  但在真外壳里没生效（页面行为与常规轮完全一致）⇒ 不作为有牙证据使用，保留代码供后人接手。
- **`--mutation=panel-active`**（t50 新增）：拦 `Element.prototype.setAttribute`，把 `data-guif-active` 的每次写入都改成 `false`
  ⇒ **只该翻转 panel-health 的 ③**。选它当靶点的理由：当前没有其它判据读这个属性 ⇒ 变异跑完「只多红 panel-health 一条」能证明这条新判据**不是恒真**
  （旧两条变异各自只打 anchors-subset / console-apply-failure，动不到它）。拦在 `setAttribute` 层 ⇒ React 重渲染多少次都恒假，不是「采样瞬间生效」的赌博。
- **`--mutation=esc-block`**（t57 新增，**只该翻转 overlay-esc-top**）：页面级 init script 在**捕获相最早处**吞掉 `Escape`
  ⇒ 本包与外壳的 Esc 处理器都收不到 ⇒ 层栈不减 ⇒ overlay-esc-top 判红、overlay-two-layers 不受影响。
- **`--mutation=overlay-double`**（t57 新增，**驱动级**对照，不是页面级）：把第二扇（对话层）**再点一次**
  ⇒ 开窗账三行 ⇒ overlay-two-layers 必须判红 —— 反证「判据不靠重复点击凑数、`zOpened=3` 不算合格」。
  ⚠ 耦合明说（**按实测改写 · t12 校正引用**）：仓内 `overlay-double` 有**两轮** ——
  `evidence/2026-10-03T08-49-48-555Z-mut-overlay-double` 与 `evidence/2026-10-03T09-02-51-713Z-mut-overlay-double`，**两轮都只红 `overlay-two-layers`**
  （各自 `raw.json` 里「硬失败 id 集合」＝`["overlay-two-layers"]`）⇒ 它**不算「只翻自己一条」**、也**不设范围闸**，只作 overlay-two-layers 的非恒真反证。
  ⚠ 另有一句旧文「更早一轮曾连带红 overlay-esc-top」：**该论据在仓内没有对应证据目录**（`evidence/` 下 overlay-double 只有上面两轮）⇒
  **保留为备忘、不作依据**（要重新主张它，必须先有那一轮的目录，或补跑一轮并留证）。
- **`--mutation=dock-action`**（t1 新增，**只该翻转 dock-panel-actions**）：把坞面板「动作型入口」锚点 `[data-guif-dock-action]` 的**选择器改成不存在的那个**后**重读一次**
  （手法与 `anchor` 同源：先记真实读数，再记变异读数，两条都进 `raw.json` 与命令行输出）。
  预期读数变化：② 动作锚点 `1 → 0`、③ `data-guif-dock-actions` 值（真实 `1`）与锚点数（变异后 `0`）不再相等 ⇒ ②③ 不成立 ⇒ **dock-panel-actions 判红**；
  ① 侧栏本包条目数与 ④ 坞内布局编辑器锚点读的是**别的**锚点 ⇒ 不受影响。
  **耦合面（如实写）**：它只打 dock-panel-actions，**动不到任何其它判据**——当前只有 dock-panel-actions 读 `[data-guif-dock-action]` / `[data-guif-dock-actions]` / `[data-guif-dock-editor]`。
  该轮另有 `mutation-target-set` 范围闸把「只翻转自己一条」变成**机检断言**（硬失败集恰等于 `['dock-panel-actions']`）。
  ⚠ 它**不证明**「坞面板在真机上是活的」——那只由常规轮的 dock-panel-actions 读数负责；变异轮只证明**这条判据不是恒真**。
  ⚠⚠ **但这一轮从来没跑过**（t12 更正）：仓内 `evidence/` 下**没有** `-mut-dock-action` 目录（t1 只写了变异代码，用户随后下令停止大体量测试）⇒
  本变异的状态是「**已实现、未实测**」，它与 `mutation-target-set` 范围闸的读数**都不存在**。未核验登记见 `docs/验收记录-真机-2026-10-03.md` §8.2；**本轮不补跑**。
- **`--mutation=dialog-inside`**（t8 新增，靶点 `['overlay-inside-entry','overlay-two-layers','overlay-esc-top']`）：把**浮层内部第二扇入口** `[data-guif-demo-open-dialog-inside]` 的选择器改成不存在的那个。
  **真机实测（`evidence/2026-10-03T12-54-02-943Z-mut-dialog-inside`）**：硬失败 = `['overlay-inside-entry','overlay-two-layers','overlay-esc-top']`，**恰等于靶点集** ⇒ `mutation-target-set` pass（未预期判红＝无、靶点未翻转＝无）；
  shell-modal-cleared / overlay-real-mouse / dock-panel-actions / 四段走 / Q17 全部照旧绿。**它就是「overlay-inside-entry 不是恒真」的证据**（把入口改错 ⇒ 这一扇点不开、账 +0 ⇒ overlay-inside-entry 红，且「恰两扇」前提塌掉 ⇒ overlay-two-layers/overlay-esc-top 跟着红）。
  ⚠ **引用校正（t12）**：这里曾引 `2026-10-03T12-52-00-121Z-mut-dialog-inside` —— 那一轮**目录存在但结论不同**：它当时还带着环境缺陷（外壳必答 Dialog 未清），
  `raw.json` 的硬失败集含 `shell-modal-cleared`/`overlay-real-mouse`/`overlay-inside-entry`/`overlay-two-layers`/`overlay-esc-top` 与当时的范围闸（历史 raw.json 记作 `RM-MUT`），**范围闸是 FAIL 而不是 pass** ⇒ 它不是这条变异的有牙证据。
  正确的证据轮是 **`12-54-02-943Z`**（修掉 corrupt/install 段的外壳模态处置之后跑的同一变异）。
- **`--mutation=layout-overwrite`**（t8 新增，靶点 `['corrupt-action-result','corrupt-file-rebuilt']`）与 **`--mutation=layout-path`**（t8 新增，靶点 `['corrupt-no-write-before','corrupt-file-rebuilt']`）：前者把「用默认值覆盖」锚点选择器改错，后者把**装置读证据的文件**指到另一个文件（专门打「负控不是恒真」这条）。
  ⚠ **两者当前都不可证**：靶点判据本身在真机上「未取真机证」（`corrupt-payload-visible` 前置判红）⇒ `mutation-target-set` 如实记**未证**，本轮读数**不作为有牙证据**（见下「t8 真机口径翻面」§4）。
  真机实测（`evidence/2026-10-03T12-58-07-000Z-mut-layout-path`）：硬失败 1 条 = `corrupt-payload-visible`；`shell-modal-cleared-corrupt` pass、`corrupt-invalid-readable…corrupt-file-rebuilt` 与 `mutation-target-set` 五项未证。

**变异靶点表**（`mutation-target-set` 用的就是它；表里没有的变异只打读数、不设闸）：

| 变异 | 靶点集 | 设闸与否 |
| --- | --- | --- |
| `dock-action` | `['dock-panel-actions']` | ⚠ **已实现、未实测**（仓内**没有**对应的 `-mut-*` 证据目录；未核验登记见 `docs/验收记录-真机-2026-10-03.md` **§8.2**）——**本轮不补跑** |
| `dialog-inside` | `['overlay-inside-entry','overlay-two-layers','overlay-esc-top']` | ✅ 已实测（`evidence/2026-10-03T12-54-02-943Z-mut-dialog-inside`，硬失败集**恰等于**靶点集 ⇒ 范围闸 pass） |
| `layout-overwrite` | `['corrupt-action-result','corrupt-file-rebuilt']` | ⚠ 已登记但**当前不可证** |
| `layout-path` | `['corrupt-no-write-before','corrupt-file-rebuilt']` | ⚠ 已登记但**当前不可证** |
| `anchor` / `console-apply` / `panel-active` / `esc-block` / `overlay-double` / `apply-throw` | —— | ❌ 不设闸（历史证据里翻转集会漂，详见 `reportMutationScope` 注释） |


## 坞面板口径翻面（t1：坞面板成为可机检对象 + 新判据有牙）

**为什么**：2026-10-03 用户判首版坞面板「语义漂移」并下令按原始需求重构 —— 坞面板改成**动作型入口收纳台**
（只列 `kind:'action'` 的注册入口、原样渲染插件自己的组件、画角标、底部挂布局编辑器），侧栏里本包**只留 1 条**（坞自己）。
而本装置当时**完全不读**新产品面的锚点（`grep dock-action verify/real-machine` 零命中）⇒ 那轮改动在真机上**零判据覆盖**。

### 一、新采集进快照的锚点（`SNAPSHOT_EXPR` + `DOCK_FACTS_EXPR`）

| 读数 | 来源 | 用途 |
| --- | --- | --- |
| `anchors.dockAction` / `dockActionIds` | `[data-guif-dock-action]`（值＝入口 id） | 坞里收着的动作型入口 |
| `anchors.dockEditor` / `dockEditorCount` | `[data-guif-dock-editor]` | 坞面板底部的布局编辑器 |
| `dockActionsRaw` / `dockActionsNumber` | `[data-guif-dock-actions]` 的数值 | 坞自报的条数（与锚点数比对） |
| `anchors.badge` / `badgeInPanel` / `badgeInSidebar` | `[data-guif-badge]` | **只作读数**（见下） |
| `sidebarOwnIds` | `[data-guif-glyph]` 里带本包前缀的 id | 本包在 `sidebar.panellist` 的实时条目数 |
| `dockGroupKeys` / `launcherIds` / `panelToolbarActions` / `bodyHead` | 坞内分组 / `[data-guif-launcher]` / 坞内工具条 / 正文 | 归因材料（读数，不作判据） |

**`[data-guif-badge]` 为什么只作读数**：当前**没有任何入口调 `dock.setBadge`**（demo 的动作型入口没设角标）⇒ 真机上它**恒为 0**。
拿它当判据只有两种写法：写 `=== 0`（恒真、什么也没验）或写 `≥ 1`（恒假、永远红）。两种都是假判据 ⇒ 只收证据、不设判据。

**“哪一块是坞面板”不靠 id 硬编码**：坞面板＝**含 `[data-guif-dock-actions]` / `[data-guif-dock-editor]` / `[data-guif-dock-action]` 的那块面板**
（这三个锚点只由坞的总览面板画出来）。优先取**active** 的那块。

### 二、导航口径跟着改（**不改这里，整套 demo 判据在真机上是伪红**）

Q20 之后本包自己的附加页一律 `sidebar:false`（**只占 `main`、不占侧栏**）⇒ **demo 面板在侧栏已经没有图标可点了**。
旧 `ensureDemoPanel` 只会「逐个点坞入口」⇒ 在新口径下**永远点不开 demo 面板**（anchors-all / demo-dock…demo-overlay 全红，且那是装置自己的错，不是实现的错）。
新主路：**先开坞面板 → 点坞面板内部的 `[data-guif-launcher]` 导航按钮**（真鼠标优先、JS 兜底，两条策略都写进 `via`）；
侧栏逐个点行按钮降级为**兜底**（万一将来又回到「本包附加页占侧栏」）。

同时收紧了「点哪里」的边界：真鼠标兜底从「点任意第 N 颗 `button`」改成**只点坞图标自身**（`[data-guif-glyph]`）——
在真 GUI 上「随便点一颗按钮」可能撞到会话/发送键，那是不可接受的副作用。

### 三、「哪一块面板」的口径修正（`panelHealth` / `dumpPanel`）

阶段 1.5 之后**坞面板与 demo 面板会同时挂在 DOM 里**（上一轮真机证据：`panels=2`）⇒ 原来的
`document.querySelector('[data-guif-panel]')`（**DOM 里第一块**）取到哪一块是**未定义**的。
`PANEL_HEALTH_EXPR`（panel-health 的读数）与 `dumpPanel` 改为：**active 的那块** → 含 `[data-guif-demo-section]` 的那块 → 第一块，并把**所有**面板 id 一并记入证据。
判据的**条目与合格线一个字没改**（仍是五件套）；改的只是「读哪一块面板」这个**读数定位** —— 不修它，panel-health 会随挂载顺序随机红绿。

### 四、范围闸为什么只给 `dock-action` 设

`dock-panel-mutation` 要求该轮硬失败集**恰等于** `['dock-panel-actions']`，把「只翻转自己一条」变成**机检断言**。
**别的变异不设闸**，理由是实测而不是口味：把本仓 `evidence/` 里所有 `-mut-` 轮的 `raw.json` 逐轮数出来，
早期几轮的翻转集**跑次之间会漂**（`console-apply` 有一轮连带红了 overlay-two-layers/overlay-esc-top/diagnostics-host-line；`overlay-double` 后两轮只红 overlay-two-layers，
而本文档上面曾写它连带 overlay-esc-top）。把会漂的集合写成硬判据＝自造一条会闪的判据 ⇒ 它们的翻转集**只作读数**打印
（每轮都打「本轮各判据 pass/FAIL」+ 硬失败清单，`evidence/<stamp>-mut-*/raw.json` 里也有）。

### 五、`waitForDemoReady` 的实测记账（**未改**，但要说清）

实测（历轮 `raw.json` 的 `readiness`）：本包入口**不会自动开面板** ⇒ 它的第二个条件
（`actions.includes('layout') || demoMarks > 0`）在打开面板之前**恒不成立** ⇒ 该等待每轮都跑到 20s 超时并返回 `ready:false`。
真正把关「入口到位了没有」的是新增的 `ensureDockPanel` + `waitDockReady`（坞面板就绪，有界 12s）与 `ensureDemoPanel`（demo 工具栏出现）。
此处**只记账不动它**：改它会动到既有证据的字段语义，属于另一件事。

## 口径修正账：`overlay-two-layers`/`overlay-esc-top` 曾**结构性不可满足**（F-t53-1，t57 修）

**结论先说**：t53 那两轮里的 `overlay-two-layers`/`overlay-esc-top` 判红，**不得**被当作「F-real-6（第④段浮层点了不开）未修复」的证据 —— 它们是**装置口径错**，与实现好坏无关。发现者是 t53 属主（实现方抓出验证方的仪器误差）。

| 缺陷 | 复现与证据（t53 属主的两轮真机跑） | 根因 |
| --- | --- | --- |
| **一：用不存在的锚点判「对话层开出来了」** | `evidence/2026-10-03T08-37-59-660Z`：`点击策略=["window:mouse","dialog:mouse无效→js"]`、`zOpened=[100,101,102]`、`openedRows` 三行（对话层被点了**两次**） | 装置用只有**浮动窗**才有的 `[data-guif-window]` 判「这一下开出来了没有」；**对话层是官方 Modal、没有这个锚点** ⇒ 永远「看起来没开」⇒ 触发 JS 兜底再点一次 ⇒ 账上三行，而判据要求**恰 2** ⇒ **永远过不去** |
| **二：Esc 减法用了只增不减的日志** | 同上：`Esc 前 3 扇 → 后 3 扇`、`关掉 top=false`（`remaining` 与 `before` 逐字相同） | Esc 的「减一」是用第④段那份**只增不减**的开窗账算的 ⇒ 即使 Esc 真的关掉了栈顶，那份账也不会变短 ⇒ **同样永远过不去** |

**修法（t57）**：
1. 判「这一下点开出来了没有」改用**家族无关的事件计数器**＝开窗账**行数增长**（浮动窗与官方 Modal 都记一行）；
2. **第二扇必须用 JS `element.click()` 开**：第④段两个按钮在浮层**外面**，真鼠标点击会产生 `pointerdown` ⇒ 命中**设计内的「点外只关最上层」**（`overlay/dismiss.mjs`）⇒ 先把已开的那扇关掉，两扇永远叠不起来。JS click 只派发 `click`、不产生 `pointerdown` ⇒ 两扇共存。**理由记进 `via`，不是偷偷换策略**；
   ⚠ **这一条只对「浮层外面」的按钮成立；t8 起第二扇已改走浮层内部入口的真鼠标（见文末「t8 真机口径翻面」§2、判据 overlay-inside-entry）。**
3. Esc 的增减改读**活的层栈**（`[data-guif-overlay-layer]` / root 的 `data-guif-overlay-layers`，**会减**），并要求「少掉的正是原栈顶 + 底下那扇还在」。

**修正后的实测（`evidence/2026-10-03T08-59-49-412Z`，整跑 **30 判据 / pass 30 / 硬失败 0 / exit 0**）**：
开窗账两行 `window z=100` / `dialog z=101`｜活层栈 `[demo-window, demo-dialog]`（attr=2）｜每扇点击 `window(mouse):开` / `dialog(js):开`｜Esc 后 `[demo-window]`（1 扇）、少掉 `demo-dialog`＝原栈顶、底下那扇还在。
**真鼠标路径另由 `overlay-real-mouse` 单独取证（t54 新增）**：两扇各一次真鼠标点击 —— `window: 命中自身=true/命中元素=BUTTON/账+1/点后层=[demo-window]`、`dialog: 命中自身=true/BUTTON/账+1/点后层=[demo-dialog]/被摘=[demo-window]`，`z=[100,101]`，清场（「全部关闭」）后 `stack=[], rows=0`。
⇒ 口径合成一句话：**真鼠标负责「点得动、一次点击一层」（overlay-real-mouse），叠层语义负责「两扇并存时 z 递增、Esc 只关栈顶」（overlay-two-layers/overlay-esc-top）**。
⚠ **t8 更新（2026-10-03）**：上句里 t57 那句「第二扇走 JS click」**已作废** —— t6 补了浮层内部入口，第二扇现在也走**真鼠标**（overlay-inside-entry 判它，实测成立）。上面这段保留为 t57 当时的口径账。

## F-t53-2 的归属（t58 插桩结论：**非实现面**，不判红）

**问题**：曾有观察称「对话层开出后 overlay 宿主子树整体从 DOM 消失、零 console 报错」。**t58 插桩（`probe/overlay-instrumentation/**`）结论＝未复现**：
- **宿主根全程活着**：根节点以 WeakMap 稳定 id 追踪，**id 全程 119、`isConnected` 全程 true**，`rootGone`/`rootDetached`/`rootReplaced` 三张迹象表全空；`__slice('overlay')` 的 api 对象与 `shell.overlay` 座位全程未注销（`api.dispose()` 只在装配期补装窗口发生过 1 次，早于任何用户操作）。
- **真机可复现的只有**「浮动窗**那一层**被摘、对话层仍在、宿主根活着」——触发源是**真鼠标 `pointerdown` 打在浮层之外** ⇒ 走**设计内的点外关闭**（`src/client/overlay/dismiss.mjs:106-123` 的 `onPointerDown` ⇒ `stack.remove(top.id)`）。
- **差分依据**：真鼠标 / JS 点击 / 直接调服务面三条路径，唯一变量＝有没有 `pointerdown`；事件时序 t=9500.9 `pointerdown` → t=9501.3 摘除浮窗层 → t=9507.2 才挂对话层 ⇒ 摘除**先于**对话层挂载，不是被它顶掉。
- **装置侧同口径复现**：`overlay-real-mouse` 第二条读数即 `被摘=[demo-window]`。

⇒ 因此该项**按「设计内行为」结案，不作为实现面缺陷、不判红**；本目录不再把它列为待收项。

## 维护本目录时的两条硬约束（都踩过）

- **别写「井号 + 三位十六进制」形状的字面量**：本包 `scripts/check-tokens.mjs` 的**硬门禁面 = 除 `tests/`、`probe/`、`docs/` 之外的全部**，`verify/**` 落在里面 ⇒ 判据里写 React 错误码的字面形式会被当成色值，`npm run check:tokens` exit 1、连带 `npm test` 变红（t45 真踩过：`lib/judge.mjs` 的正则 + `run.mjs` 的 not-installed-console 标题）。修法是正则里用 `\u0023` 转义写「井号」（语义逐字等价）。改判据后**先跑 `node scripts/check-tokens.mjs` 再跑 `npm test`**。
- **起进程一律 `node <dsh bin.js>`（`shell:false`）**：`spawn('dsh', …, { shell: true })` 在 Windows 上多一层 cmd.exe 包装，杀它带不走真正的 node（实测泄漏出 8 个仍在 LISTEN 的实例），且传参数组会触发 DEP0190。`lib/dsh.mjs` 的 `runDsh` 与 `startServer` 都已走这条路径。

## 点不动 / 收不到时的取证纪律（t50 补强）

装置把「点了没反应」从猜测变成可判定，靠三件东西（都在判据里落成字段，不看「应该没问题」）：

- **点击策略与命中测试**：真鼠标点击先做 `elementFromPoint` 命中测试，记录「命中的是哪个元素」（坞入口与面板工具栏都被一个**无 class 的 DIV** 遮挡过）；鼠标不生效才走 JS `element.click()` 兜底，并把两条策略都写进 walk 行的 `via`。**兜底只负责让后续判据能继续跑，绝不当成功悄悄用掉**。
- **API 响应码**：CDP 采 `Network.responseReceived`，判「这条请求到底发出去没有、回的是什么码」。**「界面说 sent」≠「宿主收到了」** —— 客户端上报器的 `report()` 同步返回的是**本地队列**的 `accepted`，`flush()` 的结果被调用方丢弃；只有响应码能分清这两件事。
- **归因探针**：Q17 步骤后从**页面上下文**（带页面自身鉴权）直连 `/api/gui-frame/diagnostics` 打一发，记录状态码与响应体。一次分清「路由在不在 / 鉴权过不过 / stderr 落不落进装置日志」：未鉴权是 **401**（鉴权层先答），已鉴权是 **404** 就说明**路由表里没有这条**。

## 已知限制（不许含糊）

- ~~**GB21 证① 的第二扇用 JS click 开**（t57 起）~~ **—— 该条已被 t8 推翻（2026-10-03 真机实测）**。
  t6 在**浮动窗 content 里**冻结了新入口 `data-guif-demo-open-dialog-inside`（全页唯一）⇒ 点它时 `pointerdown` 落在浮层**内部** ⇒ 设计内的「点外只关最上层」**不触发** ⇒ 两扇能叠。
  **新口径（实测）**：第一扇（浮动窗）走第④段按钮的真鼠标；**第二扇走浮层内部那颗入口的真鼠标**；两条都记 `via`，**没有**回退到 JS 兜底（一旦回退，overlay-inside-entry 判红）。
  真机读数（`evidence/2026-10-03T12-45-23-211Z`，`--only=install`）：`insideEntry = {present:true, inOverlayRoot:true, inFloatingWindow:true, inLayer:'dsh-gui-frame/demo-window', hitSelf:true, hitTag:'BUTTON'}`；
  `insideOpen = {via:'mouse:clicked', attempts:[{kind:'mouse', ok:true, hitSelf:true}], added:1}`；开窗账两行 `demo-window z=102` / `demo-dialog-inside z=103`。
  ⇒ 本目录「已知限制」不再包含这一条；它现在是**被正面覆盖**的一条（overlay-inside-entry）。
- **坏载荷态四条（corrupt-invalid-readable…corrupt-file-rebuilt）：条件已具备，且 t27/t30 已实测取证**（旧措辞「因命名空间对客户端不可见 ⇒ 走不到」**已作废** —— t10 + t24 之后真机上命名空间**可见且可写**）：
  `--only=corrupt` 的**第五轮（`evidence/2026-10-03T15-14-59-694Z`）与第六轮（`…15-36-13-426Z`）两轮实测均＝ 5 条全 pass**：
  · **corrupt-payload-visible pass**（编辑器状态行 `布局 v2 · rev 2 · invalid（只读）…` ⇒ `read.kind=invalid`）；
  · **corrupt-invalid-readable pass**（`[data-guif-layout-overwrite]` 1 个、可写锚点 `false`）；
  · **corrupt-no-write-before pass**（负控：点前文件里仍是 `schemaVersion 999` + `docks=[ghost-entry]`、界面仍只读）；
  · **corrupt-action-result pass（第四轮红 → 本轮转绿）**：点击＝真鼠标命中自身、提示锚点 `data-guif-layout-notice=overwrite-default`、提示正文如实、可写 `false→true`、**那条出路消失（锚点 1→0）**、状态行转为 `布局 v2 · rev 3 · empty…`（第四轮的红＝出路没消失，t29 在 `persist.mjs` 加了本地「刚清过载荷」的账后修掉）；
  · **corrupt-file-rebuilt pass（本轮原生判到，不再需要重判）**：`含标记 999=false`、`版本号=2`、落盘 `docks` 三项与编辑器/坞面板读数逐项相等、顺序一致。
  （历史：第四轮 `corrupt-action-result` 红、`corrupt-file-rebuilt` 因装置**只认块式 YAML** 而假红 ⇒ t27 把解析器搬进 `lib/judge.mjs` 的纯函数 `parseLayoutSection`（两种写法都认）并用同一轮原文重判；第五轮起解析器已能原生判到。）
  ⇒ **本目录不再说这四条「走不到」**；它们的现状是 **5 条全 pass**，与「命名空间可见性」无关。
- **工作台开关「刷新后状态保留」：✅ 第七轮已转绿（判据一字未改）**（见上「workbench-persist 的过程读数」）。
  历史（第六轮）：**持久化值确实被采用成布局**（`[timeline]`＝「已采用」世界 + `data-sidebar-collapsed=true` + 坞面板在中心列），**但开关自己的三处读数仍是 `official`** ⇒ 红点＝**开关显示与采用后的布局不同步**；t36 在**离线面**修掉（能力侧 `subscribeState(listener)`「订阅即回放当前值一次」+ 两条发通知路径（采用/点击），组件侧 `switch.mjs` 用 `react.useEffect` 订阅）。
  **第七轮（t40）真机确认**：四点 `state=workbench`／`fired=1`／`adopted=true`／`storeRead=ready:workbench`，**开关三处读数跟随**（`data-guif-workbench-state=workbench`／`aria-checked=true`／`thumb=right`），侧栏收起、坞面板在中心列、落盘 588 字节含 `workbench: workbench` ⇒ **`workbench-persist` pass**（那一轮 48 条 ＝ pass 44 / **硬失败 0**，退出码 0）。
  ⚠ **口径**：**不许**把判据改绿——它是**判据自己转的绿**；也**不许**再说「刷新后没被采用」。已排除的成因（当时逐条钉的）：没落盘（588 字节（UTF-8）落盘 OK）、客户端不可写（`writable=true`）、宿主没注册（`workbench-cause registered=true`）、补载入没触发（`fired=1`）、宿主答案缺节（`val=[layout]`）。交付态证据绑定状态（第六轮 → 第七轮重绑）见 `docs/验收记录-工作台-2026-10-03.md` **§1.2**。
- **留人工**：拖动手感与缩放手感、观感是否与现有 DSH 一致、GB21 ②③④ 的手感类判定 —— 本装置不代判。
- **坞面板只机检到「形状」，不代判「手感/顺序语义」**（t1 起）：dock-panel-actions 判的是「侧栏恰 1 条 + 动作锚点 ≥ 1 + 自报条数与锚点数一致 + 底部挂着布局编辑器」；
  在坞面板里**拖一下换序/关一个显隐之后画面是否正确**、拖动的手感——仍留人工。
- **`[data-guif-badge]` 不设判据**（t1 起）：当前没有任何入口设角标 ⇒ 真机恒 0，写成判据即恒真/恒假；只作读数收进证据。
- **不覆盖**：多浏览器/多分辨率、HMR 热替换、卸载重挂载、布局「拖拽 → 重启 → 仍在」等跨进程项（→ 需求基线 §7 的真机清单）。
  ⚠ 最后一项在 t8 之后**有了新的已知前置**：**宿主侧命名空间注册**（t24 已解决，真机实测 `registered=true`）**不是**当前拦路的那一环；
  **当轮**拦路的是「开关读数与采用后的布局不同步」（`workbench-persist`，见上）⇒ 在它解决之前，「拖拽 → 重启 → 仍在」在真机上不可能成立。
- **⚠ 环境事实（t18/t25 真机实测，**每次跑都要知道**）**：临时 home 里**没有配置 API Key** ⇒ 外壳的
  「**添加一个 API Key**」Dialog **每次加载页面都会重弹**（它不是持久化开关；被持久化的是「内测声明」，写在 `settings.yaml` 的 `ui-onboarding` 下）。
  ⇒ **任何一次 `Page.reload` / 导航之后都必须处置模态**，否则之后所有真鼠标点击都会命中 `DIV._mask_*`。
  ⚠ **t25 补充：它是竞态** —— 第三轮里刷新后那一刻 `needed=false`（弹窗还没挂上），**它是在处置之后才挂出来的**
  ⇒ 单次处置不保险；装置已改成**有界轮询**（窗口期内反复看、见到就处置，最长 6 轮 × 700 ms，逐跳记进 `reloadModalSweeps`）。
  **该修法已在第四、五、六轮真机验证有效**（`reloadModalSweeps` 每次都是「首跳/次跳抓住 → 之后全清」）；它只改装置行为、不新增/不放宽判据。
- **⚠ 判据读数的两种序列化（t18 真机首跑实测）**：官方 frame 的三轨是 `style.gridTemplateColumns = "<sidebar>px minmax(0, 1fr) <rightbar>px"`，
  而**真机 Chrome 的 CSSOM 会把它规范化成 `minmax(0px, 1fr)`**（jsdom 不会）⇒ 解析轨串的正则**必须两种都认**，否则真机上轨读数恒 `null`、判据**恒假**（t18 首跑踩过，见 `docs/验收记录-工作台-2026-10-03.md` §3.1）。
- **⚠ 状态行是拼接文本（t25 实测）**：坞面板布局编辑器的 `[data-guif-layout-status]` 里 `read.kind` 后面**不一定有括号**
  （真机原样：`布局 v2 · rev 2 · ready恢复默认未知条目 0`）⇒ 抠 kind 的正则要用词边界 `\b`，只认 `kind(` 会在真机上返回 `null`（读数丢失）。
- **工作台（GB22）的如实边界**（六轮读数详见 `docs/验收记录-工作台-2026-10-03.md`）：
  ① **「刷新后状态保留」判据仍未达成**（红点已换到「显示）」），六轮把机制逐段推进：
     - t20（第二轮）：客户端侧 `read.kind=unavailable` ⇒ 只读 ⇒ 不落盘（`settings.yaml` 52 字节、无 `gui-frame` 段）。
     - t25（第三轮）：t24 修好 schema 锚点后，**宿主侧注册真的发生了**（`[gui-frame] settings 注册尝试 #1 ⇒ 已注册…`，三锚全命中）、客户端**已可写**（`ready` + `writable=true`）、**字节真的落盘**（588 字节、`userLayout: workbench: workbench`）—— 但 `Page.reload` 后仍是 `official` ⇒ 残红＝「写进去了、刷新后没被采用」。
     - t27（第四轮）：t26 改了采用路径之后**仍未转绿**（刷新后 4 个采样点全是 `official`）。
     - **t30（第五轮）**：宿主侧 `[timeline]` 四点行取到了 ⇒ 把「未采用」钉到「载入读到 `loading` + 补载入 `fired=0`」；同轮 `corrupt-payload` 家族转全绿（`corrupt-action-result` 由 t29 修掉）。
     - **t34（第六轮·末轮）**：**采用链通了**（`fired=1` / `adopted=true` / `storeRead=ready:workbench`，布局确实被采用）⇒ 红点换成**开关显示不同步**（见上）。宿主侧残因归类＝**`host-value-present`**（t30 的形态未复现）。
       ⚠ **构建绑定（t38 补记，t40 已解除）**：上面这些第六轮真机读数**绑的是 `lib/client.js` 671916 字节（UTF-8）/ `3BE31AE8…`**；交付态随后换成 677445 字节（UTF-8）/ `B244D785A43C…`（t36 修「开关显示同步」后重建重冻）。✅ **第七轮（t40）已把交付态证据重绑完成**：`raw.gate.artifact` ＝ 677445 / 536337 / `b244d785a43c…`，与 `verify/freeze-rev.json` 逐项一致，且 `bundle-identity` 身份落在 **`verbatim`**；同轮 `workbench-persist` **转绿**（开关三处读数跟随）。完整四点见 `docs/验收记录-工作台-2026-10-03.md` **§1.2「交付态证据绑定状态」**。
     - **t40（第七轮·末轮）**：**`workbench-persist` 转绿**（全绿轮：48 条 ＝ pass 44 / 留人工 2 / 预期 1 / **硬失败 0** / 未证 1，**退出码 0**）。四点 `state=workbench`／`fired=1`／`adopted=true`／`storeRead=ready:workbench`，**开关三处读数跟随**（`data-guif-workbench-state=workbench`／`aria-checked=true`／`thumb=right`）；侧栏收起、坞面板在中心列、落盘 588 字节含 `workbench: workbench`。⚠ 该轮**第一次派单被内存闸 fail-closed 挡下**（起跑前 3405 MB < 4096，未起任何进程），重派后 6892 MB 才跑成。
  ② 「**其它插件**的侧栏入口不受影响」⇒ 已拆成 **workbench-official-entries** 并带**适用性闸**：出厂 profile 里两态读数都是空数组 ⇒ **本环境不可测**，按「未取真机证」登记（**不算绿**）。
  ③ 真鼠标判据的**有效读数＝第二、四、五、六、七轮**：第一、三轮被外壳模态吃掉（`anchors-all/dock-panel-actions/demo-dock…demo-overlay/diagnostics-client-sent` 降级成 JS 兜底；`overlay-real-mouse/overlay-inside-entry/overlay-two-layers/overlay-esc-top` 读数作废）。
     **t25 的「有界轮询」修法已在第四、五、六、七轮验证有效**（`reloadModalSweeps` 首跳即抓住重弹的模态，之后 6 次扫描全清；四轮的 walk 全 `mouse:命中自身`）。
  ④ 判据条数：只跑 install 是 **40**；`--only=install,corrupt` 是 **48**（多出坏载荷段 8 条）。
  ⑤ **七轮的理由**（避免被读成多轮战役）：第一轮 7 条是量具自伤；第二轮补取读数；第三轮问「宿主注册发生了没有」；第四轮问「t26 改完采用路径转绿没有」；第五轮问「t28 的时间线能不能把『未采用』钉到环节 + t29 修完 `corrupt-action-result` 转绿没有」；第六轮是「t31 改了交付构建之后必须重绑证据」；**第七轮是「t36 改了 `src/**` ⇒ 按 GB24 必须重绑交付态证据」**（并首次让升级后的 bundle-identity 报出身份级别）。**七轮到此为止，不再追加。**
   ⑥ **阶段 2（工作台模式）已于 2026-10-04 收口（用户裁定）**：本阶段真机取证到此为止、不再加轮次；逐条结论（②③ 达成、④ 达成但带 `workbench-official-entries` 适用性缺口＝未取真机证、① 无闪屏/错位 与 ⑤ 观感/手感 作**留人工结案**）见 `docs/验收记录-工作台-2026-10-03.md` **§9.4「阶段 2 收口结论」**。本目录的 RM-17 一族判据**一字未改**，第七轮读数即其最终真机读数。
- 判据读的是**真外壳 + 真 React + 真 DOM** —— 这正是它相对离线单测（替身 ctx + jsdom）的价值：
  离线那侧跑得动却看不见平台的 inject 规则与真实渲染，这一侧反过来，两边缺一不可。

## t8 真机口径翻面（浮层内第二扇 + 载荷覆盖动作）：**跑出来的读数与一个真缺口**

t8 的授权是「**允许判据校准跑**」，所以下面每一条都是**真机跑出来的**（不是设计推演）。跑法 `node verify/real-machine/run.mjs --only=<state>`（隔离 `$DSH_HOME`），
证据目录都写在每条的括号里；**权威整跑与验收记录仍归 t4**。

### 1. 环境前置：外壳自己的必答 Dialog（**发现**）

临时 home 里没有会话、没有 API Key ⇒ 外壳连着弹「内测声明 … **继续**」→「添加一个 API Key … **稍后配置**」，
**全屏遮罩把本包面板整块盖住** ⇒ 真鼠标点什么都命中 `DIV._mask_*`（t8 首次整跑 overlay-real-mouse/overlay-inside-entry/overlay-two-layers/overlay-esc-top 齐红，根因就在这里，**不是实现坏了**）。
处置：装置先看见（把 dialog 正文与类名记进证据）→ 真 Escape → 它的关闭按钮 → 它自己的「继续/稍后配置」（**非承诺用语白名单**，退一步只在「对话框里只有一颗按钮」时点它并标明 `single`）⇒ 直到遮罩消失（shell-modal-cleared）。
实测（`12-45-23-211Z`）：`steps=["escape#1:仍被挡","close#1:missing","skip#1:clicked(命中自身) [\"稍后配置\"]"]`，处置后开面板探针点最上层＝`HEADER`（本包）。

### 2. GB21 证① 第二扇：**真鼠标成立**（t6 的新入口在真机上可用）

见上面「已知限制」那一条的读数（`12-45-23-211Z`）。**这是本任务最想要的结论**：那条「第二扇只能用 JS click」的旧限制，在真机上被 t6 的新入口彻底解掉了，而且**有判据盯着它**（overlay-inside-entry）。

### 3. 有牙：`--mutation=dialog-inside` **恰等于靶点集**

`evidence/2026-10-03T12-54-02-943Z-mut-dialog-inside`：硬失败 `['overlay-inside-entry','overlay-two-layers','overlay-esc-top']` = **靶点集**（逐字取自该轮 `raw.json` 的 `checks[].ok!==true` 且非 manual/expected/notEvidence 的 id）⇒ `mutation-target-set` **pass**（未预期判红＝无、靶点未翻转＝无）；shell-modal-cleared / overlay-real-mouse / 四段走 / Q17 照旧绿。
（**t12 引用校正**：此前这里引的是 `12-52-00-121Z`，那一轮 `mutation-target-set` 是 **FAIL**（硬失败集含 `shell-modal-cleared`/`overlay-real-mouse`）⇒ 换成本轮 `12-54-02-943Z`。）

### 4. **真缺口**：`gui-frame` 命名空间从未在宿主侧注册 ⇒ 布局持久化在真机上没接上

实测：坞面板编辑器状态行恒为 `布局 v2 · rev 2 · **unavailable**（只读）`（历轮常规轮与 t8 各轮一致，与是否种坏载荷无关）。
机制（读装机源码，不是猜）：客户端 `settingsScope.bind()` 的 fold 只在**宿主 `settings.describe()` 列出的已注册命名空间**里找自己那一节
（`dsh-client-ui-settings` 的 `SettingsScopeController`：`view.namespaces.find(c => c.ns === spec.namespace)` 未命中 ⇒ `status='unavailable'`），
而 `dsh-settings.describe()` 遍历的是 **`this.registrations`** —— 只有**宿主侧** `register(ns, schema, …)` / `installSection(owner, ns, schema, …)` 过的命名空间才在里面。
本包 `src/` **只有 `client/**`**，全仓没有一处为 `gui-frame` 注册命名空间（对照：`dsh-client-ui-theme` 有宿主半区 `lib/index.js` 给 `ui-theme` 注册）。
旁证：用户真实 `~/.dsh/settings.yaml` 里只有宿主注册过的节（`ui-theme` / `agent-presets` / …），**没有 `gui-frame`**。
⇒ 后果两条：**（i）**GB9/GF22「布局编辑（可保存）」在真机上**没有接上宿主**（编辑器只见只读态）；**（ii）**t6 的「载荷损坏 ⇒ 用默认值覆盖」按设计只在 `invalid/error/写阻断` 时出现 ⇒ 真机上**结构性不可达**（`read.kind` 停在 `unavailable`，既不 block 也不 allow）。
装置的处理：`corrupt-payload-visible` 判红（把缺口钉成可机检的一条），`corrupt-invalid-readable…corrupt-file-rebuilt` 记**未取真机证**（附现场读数），`--mutation=layout-*` 的 `mutation-target-set` 记**未证**。
**这不是本轮 t6 实现的问题**，也不会被「替身单测的绿」掩盖过去 —— 已作为待裁定条目交回（是否本轮补宿主侧注册，属实现面、在 device 的 inScope 之外）。
