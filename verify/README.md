# verify/ —— 交付态的离线复核资产

**这里是什么**：交付面的**复核装置**，与 `tests/**`（产品代码的判据）分开住 —— `tests/**` 验「代码对不对」，
`verify/**` 验「交付出去的这一份对不对」。它只读包内文件；唯一会写盘的是冻结基线的 `--write`。

## 怎么跑

```bash
node verify/freeze-rev.mjs           # 交付态与 verify/freeze-rev.json 逐字节比对（--check 是缺省）
node verify/freeze-rev.mjs --write   # 重绑基线（只在确实要换时用；换完必须再只读跑一次 --check）
node verify/v1-surface.mjs           # 离线表面复核：版本三方一致 / 公开面快照 / 已裁能力不许复活 / 产物装载红线
```

`verify/real-machine/` 里另有一套**真机装置**与它的文档入口（跑它会起独立端口实例与 headless 浏览器，
跑之前先读那里的说明）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `freeze-rev.json` / `freeze-rev.mjs` | 冻结基线：记录交付面每个文件的 sha256 与 `lib/client.js` 的字节数 / 模块数，外加一次生成的时刻。**它是真源本身**，本页不复述那些会漂的读数 |
| `v1-surface.mjs` | 只按本版真实面写的离线复核：跑一次真 `provideService` 反射公开面成员，逐条比对声明与快照 |
| `lib/harness.mjs` | 自备夹具：真产物装载（`window.__ModuleLoader__` + 种子表）、最小 Cordis ctx、slots / settingsScope / connection 替身、jsdom |
| `lib/source-face.mjs` | 源码面取数（读文本、判存在性、包根与 `verify/` 路径） |
| `lib/geometry-fixture.mjs` | 夹具自备的几何常量与矩形纯函数 —— **装置不得反向 import `src/**`**，所以要用的取值在夹具里有一份 |
| `real-machine/**` | 真机装置与四个只读检查脚本（引用核对 / 散文事实核对 / 空跑路径核对 / 绑定缺失核对） |
| `命名对照表-旧到新.md` | Q94 重命名的旧→新对照表（历史证据保留旧 id 时用它对读） |

## 已知依赖缺口（如实记账，不是 bug）

`@deepseek-ai/dsh-client-{store,ui-primitives,ui-slots,ui-dockkit}` 在本机 `node_modules` 里**不存在**
（只有 `cordis` 有 junction）⇒ 这四个种子由 `lib/harness.mjs` 的替身提供，**真种子只能在真机上验**。
替身不撒谎：`primitives` 只给 `PRIMITIVES_USED` 声明的那些成员（条数以该常量为准，本页不复述；
`lib/harness.mjs` 与 `src/client/kit/primitives.mjs` 两处同源，单测断言前者 ⊆ 官方成员表）；
`slots` 带声明语义（未声明座位的直接 `register` 会同步抛）。

## 过程台账与当前口径

`tests/**` 与 `probe/` 下的验证报告、结案记录与探针结论已按「描述性命名」重命名（旧→新见本目录 `命名对照表-旧到新.md`）：
它们是**当时那几轮的过程台账** —— 文件名改成描述性命名的同时，历史证据里的旧 id 原样保留，**不是当前口径**。
读当前口径用 `README.md` 与 `guide/`；本目录的装置对不对，以各脚本自己的输出为准。

## 数字口径

会随代码漂的数字（行数、文件数、判据条数、产物字节与 sha）**一律只指向真源或运行期插值**，
本页不写死：交付面锚点的真源是 `verify/freeze-rev.json` 自己带的生成时刻，
判据条数以各命令自己的收尾输出为准。
