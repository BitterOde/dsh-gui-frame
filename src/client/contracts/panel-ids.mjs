/**
 * panel-ids.mjs —— **本包占用的 `main` key 词表**（L0 契约词汇表）。
 *
 * 为什么单独一个文件：这些 key 现在有**两个消费方**——能力①（坞）在**装配期**注册它们，
 * 能力「工作台开关」在**点击时**用其中一个去 `layout.selectPanel(...)`。两边都要拿到同一份字面量，
 * 而边界检查器规定**能力域之间不得互相 import**（dock ↛ workbench、workbench ↛ dock）⇒
 * 按依赖方向把它放到 L0 契约层：两边各自 import 契约（dock->contracts / workbench->contracts 都是白名单内的边）。
 *
 * ⚠ 与 `contracts/service-face.mjs` 分开：那一份是**公开面快照**（逐字节比对），加一个导出就会动它；
 * 本文件是包内词表，不进公开面。
 */

/**
 * **工作台那一格的 `main` key**。
 *
 * ⚠ 这一格**必须与坞入口那一格用不同的 key**：两者共用 `dsh-gui-frame/dock` 时，坞入口那一页
 * 永远「已经开着」⇒ 平台的 `selectPanel(同值)` 不产生状态变化 ⇒ 折回页不挂载
 * （用户看到的症状：点文字 = 留在管理页、点图标 = 浮出面板）。
 *
 * **注册时机**：由**坞在装配期**注册（与它自己那一格同一条路），**不许**等
 * workbench 装配时再「推 id 过来注册」——真机实测：晚注册那条路走完 `attach` 返回 true、
 * 日志无异常，但平台 `renderSlot('main', {}, { entryKey })` 查不到这一格 ⇒
 * **工作台打开后中心列空白**（页面总文本长度 2）。装配期注册则与坞自己那一格同源同序。
 */
export const WORKBENCH_PANEL_ID = 'dsh-gui-frame/workbench';
