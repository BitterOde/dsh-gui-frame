# tests/build/fixtures —— t17 独立复验用的源码夹具

每个子目录都是一棵**完整的 `src/client` 候选树**，由 `tests/build/harness.mjs` 的
`withTempPackage(<夹具名>, …)` 整体拷进临时包（`<tmp>/src/client/`），再跑**真** CLI
`node <tmp>/scripts/build-client.mjs`。夹具**不会**被并入真 `src/client`，也不会被
`node --test "tests/**/*.test.mjs"` 当用例执行（文件名不以 `.test.mjs` 结尾）。

| 夹具 | 故意埋的越界点 | 期望（机检） |
| --- | --- | --- |
| `valid/` | 无（**正对照**） | CLI exit 0；写出 `lib/client.js`；产物可加载、`id === dsh-gui-frame` |
| `out-of-bounds/` | `import { outside } from '../outside.mjs'`：用 `../` 爬到 `src/client` 根**之上** | CLI exit≠0，stderr 含「越出 src/client 根目录」；**不落产物**；夹具源码字节不变 |
| `bare-package/` | `import { useState } from 'react'`：模块自取裸包名种子 | CLI exit≠0，stderr 含「只支持相对 import」；不落产物 |
| `too-deep/` | `import './a/b/c/d/e/leaf.mjs'`：目录层数 5 > 上限 4 | CLI exit≠0，stderr 含「目录深度超限」；不落产物 |
| `cycle/` | `entry → a → b → a` 模块环 | CLI exit≠0，stderr 含「模块循环依赖」；不落产物 |
| `export-default/` | `export default function …` | CLI exit≠0，stderr 含「不支持 export default」；不落产物 |
| `export-braces/` | `export { createClientModule };` | CLI exit≠0，stderr 含「不支持 export { … }」；不落产物 |
| `export-class/` | `export class …` | CLI exit≠0，stderr 含「不支持 export class」；不落产物 |

**「失败而非静默改写」的判据（`tests/build/builder-guards.test.mjs`）**：
对越界夹具的临时包，失败后必须同时满足三条 —— ① 进程 exit≠0；② `<tmp>/lib/client.js`
不存在（没有落半成品产物）；③ 夹具源码树指纹前后一致（没有偷偷"帮"你改写 import）。

缺扩展名（`import './helper'`）、非 `.mjs` 文件（`style.css`）、坏绑定（import 一个目标模块
不存在的导出）三类用 `withTempTree` 的临时树覆盖，不单独落夹具。
