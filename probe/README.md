# probe/ —— 阻塞级未知的实测取证

三条探针的**结论与判定**写在 `../docs/探针记录-运行稳定性.md`；
本目录只放**可重演的脚本与原始证据**，不放结论。

## 怎么跑（只读：不写 profile、不监听端口、不碰正在跑的 GUI）

```powershell
cd <你克隆出来的仓库根目录>
node probe/runtime/apply-throw-probe.mjs        # 客户端 apply 抛错 → 整页？
node probe/runtime/log-channel-probe.mjs          # logger vs process.stderr.write
node probe/runtime/unload-remount-probe.mjs     # 卸载 GUIFrame → 依赖方去哪
```

三条都应 exit 0；结果落在 `probe/evidence/*.json`，脚本同时把关键行打到 stdout。
P2 会额外 spawn 一次 `stdio: inherit` 的子进程 —— **你在命令输出里看到
`[gui-frame] 客户端失败 stderr-marker-P2` 那一行，本身就是"stderr 写到了终端"的证据**。

环境：本机 DSH 0.1.5-rc.3（内含 cordis 4.0.2 + cordis-plugin-loader 1.0.3）+ node v24.19.0。
DSH 安装目录默认按 `%APPDATA%\npm\node_modules\@deepseek-ai\dsh` 找，可用 `DSH_INSTALL_DIR` 覆盖。

## 文件

| 文件 | 作用 |
| --- | --- |
| `runtime/platform.mjs` | 从本机 DSH 安装目录加载**真** cordis 与 cordis-plugin-loader（保证同一份 cordis 实例） |
| `runtime/shell-boot.mjs` | 外壳 boot kernel 的**逐字转写**（来源与字符区间写在文件头）；只替换 DOM/uiRenderer 等浏览器依赖 |
| `runtime/apply-throw-probe.mjs` | P1：三个场景（apply 抛错 / 吞掉拒绝的改动版 / inject 未满足） |
| `runtime/log-channel-probe.mjs` | P2：父进程用 pipe 与 inherit 两档跑同一子进程，断言两条打印通道的落点 |
| `runtime/log-channel-child.mjs` | P2 子进程：logger 四个级别 + `process.stderr.write` 哨兵 |
| `runtime/unload-remount-probe.mjs` | P3：提供方卸载/回装，观察依赖方 fiber 状态、effect 存活数、entry 存留 |
| `tools/grep-context.mjs` | 只读：在压缩成单行的产物里按正则抓命中点前后的字符窗口 |
| `tools/slice.mjs` | 只读：按字符区间打印产物原文（取证引用用） |
| `evidence/*.txt` | 产物原文切片（文件路径 + 字符区间写在每片首行） |
| `evidence/*.json` | 三条探针的原始运行结果 |

## 纪律

- 只读探针：不得为了"看清结果"去装插件、改 profile、重启 `dsh web`。
- 每条结论要么指到一份产物原文切片，要么指到一次脚本运行；**不写"应该没问题"**。
- 转写外壳代码时**不许顺手改控制流/文案** —— 改了就不再是外壳的证据，而是自己写的模型。
