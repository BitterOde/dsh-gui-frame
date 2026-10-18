/**
 * components.mjs —— 对外暴露的**复合组件清单**（接口已冻结）。
 *
 * 方向与边界：
 *  - 方向②（GUIFrame → 插件）：`ctx.guiFrame.components` 暴露 GUIFrame 用官方 primitives 实现的
 *    **复合组件**；插件拿到的是普通函数/组件，直接用**自己的** React 树里（同一个 React 单例，
 *    全程不需要模块 import，插件构建链不变）。
 *  - **只暴露复合组件**（Panel / Toolbar / Empty / ErrorState / List / KeyValue）——
 *    它们才是各插件重复造的那一层；**原子组件**（Button/Tooltip/Menu/Modal/Tag/Toast/
 *    HoverCard/StateDot/JsonTree …）由插件自己从 primitives 种子取用，GUIFrame **不**转发。
 *  - 方向①（插件 → GUIFrame）：插件经 `register(entry, Component)` 贡献**入口组件**；
 *    若插件想贡献**可复用组件**给别人，走 `service.components.register(name, Component)`
 *    —— 这两条路都在服务面上，但只有下面这六个名字属于 GUIFrame 的**公开面**（进快照）。
 *
 * 本文件**只冻结名字**（先冻接口再写实现）：
 * 实现、props 细节、样式与 token 都在组件实现里；实现方用同样的名字调
 * `components.register(name, Component)` 装上实现。**签名属于行为期契约**：
 * 「组件签名要作为稳定接口单独冻结」——故此处同时冻结各组件**必须接受的 props 名**，
 * 实现方只能加可选参数，不能改名/删名。
 *
 * 本文件**零副作用**：纯常量，无 React、无种子依赖（组件实现不在这里）。
 */

/**
 * 冻结的复合组件名（排序后即快照的 `components` 字段）。
 * ⚠ 顺序无意义（快照会排序），但**拼写是契约**。
 */
export const COMPONENT_NAMES = Object.freeze(['Empty', 'ErrorState', 'KeyValue', 'List', 'Panel', 'Toolbar']);

/**
 * 每个组件的**必须接受的 props 名**（真值来自「props 由 GUIFrame 注入」能力面 +
 * 面板骨架的要求）。实现方可以**新增可选** props，但不得改名或删名 —— 删名 = 公开面变更。
 *
 * 约定（三个通用面，任何组件都可选接受）：
 *  - `theme`：只读主题镜像（`--dsw-*` 的解析结果；数据源是主题守门）
 *  - `t`：文案 thunk（跟随 locale；label 一律传 thunk）
 *  - `children`：内容槽（GUIFrame 只提供容器与行为，**不接管插件内容**）
 */
export const COMPONENT_PROPS = Object.freeze({
  Panel: Object.freeze(['id', 'label', 'close', 'actions', 'children']),
  Toolbar: Object.freeze(['items', 'children']),
  Empty: Object.freeze(['title', 'description', 'action', 'children']),
  ErrorState: Object.freeze(['error', 'onRetry', 'children']),
  List: Object.freeze(['items', 'renderItem', 'empty', 'children']),
  KeyValue: Object.freeze(['entries', 'children']),
});

/** 组件是否属于冻结清单（自定义组件名不走快照，见文件头）。 */
export function isFrozenComponentName(name) {
  return COMPONENT_NAMES.includes(name);
}
