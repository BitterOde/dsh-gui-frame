# dsh-gui-frame

**DSH（DeepSeek Harness）的「坞 + 按钮面板」基类插件。** 以客户端服务 `ctx.gui-frame` 的形态，让别的插件把自己的**按钮**与**面板**交进来：
**动作型**入口进坞（收在侧栏那一行浮出的**按钮面板**里），**面板型**入口由坞成对注册进平台座位；本包另外提供**面板骨架**、**浮层宿主**与**主题守门**。

| 项 | 值 |
| --- | --- |
| 包名 / 版本 | `dsh-gui-frame` · **`1.0.0`** |
| 平台线 | DSH **`0.2.0-rc.2`**（口径：本地版本优先；线上新增的座位与服务只做「探测到就避让」，不写死依赖） |
| 许可 | **MIT** —— 见 `LICENSE`（`Copyright (c) 2026 BitterOde`） |
| 运行期依赖 | **零**：`dependencies` 恒为空，平台包只走动态 `import()` 或外壳提供的种子键 |
| 交付面 | `lib/**` + `cordis.patch.yml` + `README.md` + `LICENSE` + `guide/**`（`npm run pack` 实测 **16 个文件 / 192.0 kB**） |

> 本包**不做挂载接口**：平台已有座位（slot）注册表与静态种子表；本包给的是**入口规则、面板骨架、浮层宿主与外观变量**。
> **未装本包时页面完全不受影响**：探测到服务已在场即让位、任何 `install` 抛错都被隔离、依赖缺失时本包不激活、不占座位。

## 安装

本包是 DSH 插件包，通过 **profile 的 `dsh.profile.bundles` 点名 `dsh-gui-frame`** 装载 —— 这是它与 DSH 之间唯一的注册通道：

1. **把本包加进某个 profile 的 bundles**：
   - 官方命令（会写 profile 的 `dependencies` 与 `dsh.profile.bundles`）：
     `dsh plugin --profile <profile> add dsh-gui-frame`；从本地目录开发时用 `link:<本包路径>`；
   - 或手工：把 `dsh-gui-frame` 写进该 profile `package.json` 的 `dsh.profile.bundles` 数组。
2. **重启 DSH**：装载行在启动时读 profile 的 bundles ⇒ 重启后本包才在。
   （若该 profile 带 `dsh.profile.patchReload: live`，**行级**增删无需重启 —— 见 `cordis.patch.yml` 顶部注释。）
3. ⚠ **两条装载通道二选一**：**bundle 模式**（上一条）**或** **dev 模式**（把同一段 `insert:` 行抄进 profile 的 `cordis.patch.yml`）。
   两条同时存在 ⇒ 组合里出现两行 `id: gui-frame` ⇒ 加载器抛 `duplicate loader entry id: gui-frame`，**DSH 起不来**。

> 本包**不做自装动作**：安装步骤只改 profile（并需重启宿主），本包自身的判据链不会替用户改 profile、也不会去碰任何正在运行的 DSH 实例。

## 能力面（本版四项）

一句话分工：**`dock` 管入口、`panel` 管骨架、`overlay` 管浮层、`theme` 管外观**。

| 能力 | 对外形态（你写的代码） | 你拿它做什么 |
| --- | --- | --- |
| **`dock`** 入口坞 | `ctx.guiFrame.register(entry, Component)`；`ctx.guiFrame.dock.open() / close() / isOpen()` | 动作型入口（开关/按钮类）进坞 ⇒ 收在**浮出的按钮面板**里；面板型入口由坞成对注册 `sidebar.panellist` + `main` |
| **`panel`** 面板骨架 | `ctx.guiFrame.components.get(name)`（6 个冻结复合组件） | 面板与浮层的成品件：`Panel` / `List` / `KeyValue` / `Toolbar` / `Empty` / `ErrorState` |
| **`overlay`** 浮层宿主 | `ctx.guiFrame.overlay.open(request) / close(id) / bringToFront(id)` | 自己的浮出层（含 toast 族与 dismiss 语义）；它占平台座位 `shell.overlay` |
| **`theme`** 主题守门 | 公开 CSS 变量族 `--guif-*`（16 个）+ 装配面 `service.__slice('theme')` | 外观不跟选择器打架：定义变量即可改观感；本包替你守住「只引用公开 token」 |

**公开面读数**（真源＝冻结快照 `tests/contracts/public-surface.json`，**1124 字节**，`node scripts/public-surface.mjs` 逐字节校验）：

- 服务名 `gui-frame`；`version` = **`1.0.0`**（与包版本同值）
- `capabilities` = `dock` / `overlay` / `panel` —— `ctx.guiFrame.supports(name)` **只认这三项**
- `serviceMembers` 7 项：`capabilities` / `components` / `dock` / `overlay` / `register` / `supports` / `version`
- 命名空间 3 个：`components`（`get`/`has`/`names`/`props`/`register`）、`dock`（`open`/`close`/`isOpen`）、`overlay`（`open`/`close`/`bringToFront`）
- 占座 2 个：`sidebar.panellist` + `main`；错误码 21 个（12 个抛出 + 9 个诊断）

> ⚠ **`theme` 为什么不在 `capabilities` 里（真话优先）**：`theme` 是**装配切片**（`SLICE_NAMES` = `dock` / `overlay` / `theme`），
> 也是本包真实交付的一块面（公开外观变量 + 样式表注入 + 守门告警），但 `supports()` 的实现只认 `CAPABILITIES` 那三项名单 ⇒
> **`ctx.guiFrame.supports('theme')` 恒为 `false`**，不要拿它判断外观面在不在位。这条口径缺口登记在下面「已知限制」里。

## 接入方从这里开始

**随包发布的接入说明在 `guide/`**（`package.json` 的 `files` 含它 ⇒ 装到的包里就有）：

| 文件 | 内容 | 什么时候读 |
| --- | --- | --- |
| `guide/README.md` | 索引 + 30 秒上手 + 红线 | 现在，两分钟 |
| `guide/接入指南.md` | 依赖探测的推荐写法、`register` 字段表、四项能力、降级与失败语义、已知坑与盲区、改外观 | 动手前通读 |
| `guide/契约速查.md` | 全部成员签名 / 返回值 / 错误码 / 组件 props / 数字层级表 / 公开外观变量 / 配置项 | 写代码时随查 |

`guide/契约速查.md` 的名单表与本包契约真源**机检双向对锁**（`tests/contracts/guide-contract.test.mjs`：少一个 / 多一个都判红），所以它不会悄悄过期。

## 从源码构建与测试

```bash
npm install                         # devDependencies 只服务渲染测试（jsdom / react / testing-library）
npm run build                       # = build:host && build:client；22 项构建期校验，任一不过 exit 1（会重建 lib/**）
npm test                            # 全量判据（带闸入口：--test-timeout=120000 / --max-old-space-size=2048 / 剥离继承的 NODE_OPTIONS）
node scripts/check-boundaries.mjs   # 全仓解耦机检门禁（九条判据 + 两条自检）：有违规逐条打印并 exit 1
node scripts/check-tokens.mjs       # 颜色/token 硬门禁（裸色值、悬空 token）
npm run guards                      # 测试入口自身的 11 项守护自检
node scripts/public-surface.mjs     # 公开面与冻结快照逐字节比对
node verify/freeze-rev.mjs          # 交付态与回归基线 verify/freeze-rev.json 逐字节比对
npm run pack                        # = npm pack --dry-run：看清真实交付面（prepack 会重建 lib/**）
```

**逐条实跑读数**（重建产物后的收口态）：

| 命令 | 读数 |
| --- | --- |
| `npm run build` | **exit 0** · 「22 项校验全部通过」；`lib/client.js` **452351 字节 / 50 模块**；两次独立打包**逐字节相同**（确定性） |
| `npm test` | **exit 0** · tests **299 / pass 299 / fail 0**（cancelled 0 / skipped 0 / todo 0） |
| `node scripts/check-boundaries.mjs` | **exit 0** · 「✔ 全部判据通过（九条判据 + 两条自检）」；扫描 **212 文件**（src 57 / src/client 50）；文件规模超限 **0**；死导出 **82**（上限 179）；模块环（src） **0**；能力域直连 **0**；目录层数最深 **2 层**；测试直面 **28 / 22**（下限同值）；公开面 **ok｜1124 字节**；构建器禁令 **0** |
| `node scripts/check-tokens.mjs` | **exit 0** · 「共 11 处命中（硬门禁 **0**｜夹具/记录 11｜豁免 0）」 |
| `npm run guards` | **exit 0** · 「合计：PASS **11**｜FAIL 0」 |
| `node scripts/public-surface.mjs` | **exit 0** · 「✔ 与 tests/contracts/public-surface.json 逐字节一致（**1124 字节**）」 |
| `node verify/freeze-rev.mjs` | **exit 0** · 覆盖 **72 个文件**，与基线 `verify/freeze-rev.json` **逐字节一致**；`lib/client.js` 452351 字节 / 50 模块 |
| `npm run pack` | **exit 0** · tarball 共 **16 个文件**（`LICENSE` / `README.md` / `package.json` / `cordis.patch.yml` / `guide/**` 3 份 / `lib/**` 9 份），包体 **192.0 kB**，解包 **594.2 kB** |

> **口径**：上表每一行都指得到一次亲跑，没有一条是推算或抄历史值；`lib/**` 是**产物区**，改它要重跑 `npm run build`，绝不手改。
> 三条命令构成验收面：`npm test` / `node scripts/check-boundaries.mjs` / `node verify/freeze-rev.mjs`（换基线才用 `--write`，且事后必须只读复核一次）。

> ⚠ **读数绑定（别把上表当永久真值）**：表中读数绑定 `lib/client.js` = **452351 字节 / 50 模块** / sha256 `0D68621A7EFA7FE137112E49F435907BA897C7146E47822B1B50AFDC932BCD96` 的那次构建。
> **之后任何 `src/**` / 包清单 / 本文档的改动都会让它们变号**。要复核当前交付态，**重跑上面这几条命令**，并以 `verify/freeze-rev.json` 与命令输出为准，不要引本文的数字当判据。
> 冻结基线的**重绑顺序**：所有会写盘的任务都收口 ⇒ `node verify/freeze-rev.mjs --write` ⇒ **再只读跑一次 `--check` 确认「逐字节一致」**（顺序反了就等于用基线给自己盖章）。

## 目录与归属

`lib/` 是**产物区**，`src/` 才是源码；**发布包里没有 `src/`**，所以产物必须自洽。

| 路径 | 是什么 | 随包发布 |
| --- | --- | --- |
| `lib/client.js` | 客户端半区产物（`classic script` + `window.__ModuleLoader__.load`，50 模块）；由 `scripts/build-client.mjs` 生成 | ✅ |
| `lib/index.js` + `lib/host/**` | 宿主半区产物（入口转发壳 + `envelope`/`register`/`routes`/`schema-probe`/`settings`/`sink`）；由 `scripts/build-host.mjs` 生成 | ✅ |
| `cordis.patch.yml` | **唯一注册通道**：恰好一条 `insert` 行，`id` 恒为 `gui-frame`（= 宿主入口 `name`） | ✅ |
| `README.md` / `LICENSE` | 本文与 MIT 许可正文 | ✅ |
| `guide/` | 随包接入说明 3 份（与契约真源机检对锁） | ✅ |
| `src/client/**` | 客户端源码：`contracts/`（服务面数据真源）· `kit/`（共享叶：token/几何/手势/诊断…）· `dock/`（坞与按钮面板）· `panel/`（面板骨架与复合组件）· `overlay/`（浮层宿主）· `theme/`（主题守门）· `service/`（服务面实例与三个命名空间视图）· `entry.mjs` + `entry/`（汇合点） | ❌ |
| `src/host/**` | 宿主源码：路由、官方信封、设置命名空间注册、诊断收端 | ❌ |
| `scripts/` | 构建器（零依赖自研打包器）与门禁（`check-boundaries` / `check-tokens` / `guards.selftest` / `public-surface` / `link-dsh` / `run-tests`） | ❌ |
| `tests/**` | 判据面（`npm test` 跑 `tests/**/*.test.mjs`；`contracts/public-surface.json` 是公开面冻结快照） | ❌ |
| `verify/**` | 回归基线与复验资产（`freeze-rev.json` 冻结基线、`real-machine/` 真机装置、`checks/` 判据件） | ❌ |
| `tools/**` · `probe/**` | 出图取证工具（零依赖 CDP 出 PNG，带内存硬闸）· 平台探针脚本与两份探针记录 | ❌ |

### 仓库范围（哪些东西刻意不随仓）

本仓承担「**代码本体 + 判据面**」。以下**可重跑重建**的原始产物不入库（见 `.gitignore` 的逐条理由）：

| 未入库 | 是什么 | 为什么不入库 / 怎么重建 |
| --- | --- | --- |
| `probe/evidence/t58-*/` | 平台探针 T58 的原始记录（约 7.6 MB） | 本机环境的原始 dump（含本机路径与宿主配置快照）；重跑 `probe/overlay-instrumentation/run-instrumentation.mjs` 即重建 |
| `verify/real-machine/evidence/` | 真机装置逐轮原始记录（62 轮，约 3.7 MB） | 同上；重建方式见 `verify/real-machine/README.md` |
| `tools/evidence/` | 出图工具与临时实例的日志/截图（约 1.6 MB） | 同上；重跑 `tools/dsh-shot.mjs` 即重建 |
| `docs/`（除两份探针记录） | 开发期日志 / 验收记录 / 事故报告 / 调研稿 | 按轮次写作的过程留档，不构成对外接口 |

> 两处**预期内的红**（不是缺陷，是可以复算的结果）：① `node verify/real-machine/check-citations.mjs` 校验的是「文档引用 ↔ 真机轮次目录」，真机 dump 未随仓 ⇒ 它会逐条报「引用的轮次不存在」，重跑装置后自愈；② `probe/overlay-instrumentation/浮层宿主子树消失结论.md` 引用的 `probe/evidence/t58-*` 同理。

## 已知限制（不许含糊）

口径：**留人工 / 未核验一律不写成已验证**，一条都不补成绿。

1. ⚠ **loader entry id 是独占的**：本包的 `cordis.patch.yml` 的 insert id 恒为 `gui-frame`（= `src/host/index.mjs` 的 `name`）。
   同一个 profile 里装两份同 id 的构建（例如从同族其它版本裁剪出的副本）⇒ 组合里出现两行同 id ⇒ 加载器抛 `duplicate loader entry id: gui-frame`，**DSH 起不来**。
   换版本要先卸旧再装新。
2. **本版的能力面是刻意收窄的**：不含数据通道、布局编辑与持久化、可拖可缩的浮动窗口、测试工作台与演示面板（`src/client/` 下没有 `channel/` `layout/` `window/` `demo/` `workbench/` 目录）。
   ⇒ 坞的管理页上「布局编辑器」会显示**降级文案**「布局编辑器不可用（layout 能力未装配或缺 react 种子）—— 按钮照常可用。」；按钮面板本身不受影响。
3. **`supports('theme')` 恒 `false`**（见「能力面」小节末尾）：`theme` 不在 `CAPABILITIES` 名单里 ⇒ 没有公开办法问「外观面在不在位」。
   这是冻结契约的已知缺口，**不是**「外观不可用」——公开变量与样式表注入照常工作。
4. **真机证据边界**：本仓的判据证据**全部是离线的**（单测 299 条 + 门禁 + 冻结基线）。`verify/real-machine/**` 是随仓的真机装置，但**它的原始轮次记录未随仓**（见上表）⇒
   **本仓当前没有任何绑定本交付态的真机读数**；真机轮次需要单独起隔离实例来跑，跑法见 `verify/real-machine/README.md`。
5. **覆盖边界**：深色主题下的对比度、多分辨率、多浏览器、HMR 热替换、卸载重挂载**均未覆盖**；观感与手感属**留人工**项（由使用方自己判定）。
6. `guide/` 的正文只保证与本包**当前源码真源**一致（名单表机检对锁）；描述背后的平台行为（如侧栏那一行的文字何时重读）可能随 DSH 版本变。

## 许可与署名

**MIT** —— 见 `LICENSE`，版权方 `Copyright (c) 2026 BitterOde`。

## 给改动者：几条硬约束

1. `dependencies` **恒为空**；平台包只走**动态** `import()`（宿主半区）或种子键 `require()`（客户端产物）。
2. **不写** `dsh.client.external`（种子键由外壳提供）；**不写** `dsh.engines`（不是官方字段 —— 写它只会制造「以为是兼容闸」的假安全感）。
3. loader entry id 恒为 **`gui-frame`**（= `cordis.patch.yml` 的 insert id = `src/host/index.mjs` 的 `name` = 客户端产物 bundle id）。
4. 客户端产物**绝不内联**种子键（双 React / 双 SlotCore 的根源）；种子白名单＝构建器里的 `ALLOWED_REQUIRES`，**不因「官方产物用过别的键」而扩容**。
5. ⚠ **没有 JSX、没有 TS**：自研打包器只重写 import/export，不做 JSX / TS 变换；组件一律用 `env.seeds.react.createElement(...)` 构造。
   写 JSX 会在**构建期**以「产物语法错」的形式失败，报错**不会明说是 JSX**。
6. `src/client` 之下目录层数 ≤ 4；相对 import 解析后不得越出 `src/client` 根；裸包名 / 缺 `.mjs` 扩展名 / 目标不存在 / 非 `.mjs` 文件 ⇒ 构建失败。
7. **服务面形状**（判据是机制，不是风格）：对外**方法**必须是原型方法、命名空间必须是**原型取值器** ——
   cordis 服务代理在**调用点**把 `this.ctx` 绑到调用方 ctx，清理才落得到调用方 fiber；写成实例箭头函数会**静默破坏按插件卸载**。
   公开面一变（成员 / 能力 / 座位）就要跑 `node scripts/public-surface.mjs --write` 重生成快照，并把 diff 提交给人看；同时同步 `scripts/check-boundaries.mjs` 的 `LIMITS.publicSurfaceBytes`。
8. `lib/**` 是产物：改 `src/**` 或包清单后必须重跑 `npm run build`，并重绑冻结基线（`node verify/freeze-rev.mjs --write` → 只读复核一次）。
9. 门禁阈值**只许收紧**：改判据前先读 `scripts/check-boundaries.mjs` 头部与本文；`tests/**` 里出现的新上限要连同理由一起写进门禁的限额表。
