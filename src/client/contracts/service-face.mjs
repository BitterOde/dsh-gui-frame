/**
 * service-face.mjs —— `ctx.gui-frame` **服务面的数据真源**（接口已冻结）。
 *
 * 本文件只放**声明**（常量表），不放实现：实现见 `src/client/service.mjs`，
 * 而公开面快照档 `tests/contracts/public-surface.json` 就是这些表的**排序副本**。
 * 于是「声明」「实现」「快照」三者互锁：
 *   ① 实现改了成员名 ⇒ 单测比对 `SERVICE_METHODS/SERVICE_NAMESPACES/SERVICE_FIELDS` 变红；
 *   ② 声明改了成员名 ⇒ 快照逐字节比对变红；③ 快照改了 ⇒ 得有人显式改，不能静默漂移。
 *
 * ═══ 服务名 ═══
 * 固定 `gui-frame`（带命名空间前缀）——实测本机已有 15 个官方客户端服务
 * （theme / layout / uiRenderer / connection / locale / resources / modules / sessions / sidebarRight …），
 * 撞名在 Cordis 里是**同 scope 重名直接 throw**；本包的口径是「提供前先 `ctx.get` 探测，
 * 已存在就记诊断并主动让位」——所以探测/让位落在 `service.mjs` 的 `provideService(ctx)`。
 *
 * ═══ 对外方法必须是原型方法（硬约束）═══
 * 证据是官方 `dsh-client-ui-renderer` 的 `registry.d.ts`（本机 0.2.0-rc.2 原文）：
 *   「Declared here, implemented by prototype assignment below the class: it MUST stay a prototype
 *    method (never an instance arrow) — the cordis service proxy binds `this.ctx` to the CALLER's
 *    context at call time, which is what routes the effect (and the unload cascade) into the
 *    caller's fiber. An arrow property would freeze `this` to the service's own root ctx and
 *    silently break per-plugin disposal.」
 * ⇒ `register / supports` 是**原型方法**；`components / dock / overlay` 是**原型取值器**
 *   （getter 也走调用点绑定，读 `this.ctx` 得到的是调用方 ctx —— 这样嵌套命名空间里的方法
 *   才能把副作用挂到调用方 fiber；若在构造器里 `this.overlay = {...}`，嵌套方法拿到的会是
 *   服务自己的 root ctx，正是官方原文警告的那个静默失效）。
 *
 * 本文件**零副作用**：纯常量表，无 DOM、无种子依赖。
 */

/** 服务名（固定；`cordis.patch.yml` 的 loader id 与本文件同名，但两者是不同层面的东西）。 */
export const SERVICE_NAME = 'gui-frame';

/** 服务面版本：**公开面**的一部分（服务要有 version 字段）；改它要同步快照。 */
export const SERVICE_VERSION = '1.0.0';

/** 原型**方法**（数据属性值必须是函数；绝不允许出现在实例自有的函数属性上 —— 见文件头）。 */
export const SERVICE_METHODS = Object.freeze(['register', 'supports']);

/**
 * 原型**取值器**（命名空间：`service.overlay.open(...)` 这一层）。
 * ★ `dock` 是后加的（用户裁定「开放一个 API」）：按钮面板从此有公开入口 ——
 *   `service.dock.open()/close()/isOpen()`。加它之前公开面宣告 `supports('dock') === true`
 *   却没有任何入口（README 的契约缺口那一节自己记着这件事）。
 *   开口子的代价写死在这里：要动冻结的公开面快照、逐字节读数与冻结评审。
 */
export const SERVICE_NAMESPACES = Object.freeze(['components', 'dock', 'overlay']);

/** 实例**数据字段**（非函数；快照里的 `serviceMembers` 也包含它们）。 */
export const SERVICE_FIELDS = Object.freeze(['capabilities', 'version']);

/** 公开面成员全集（排序后即快照的 `serviceMembers`）。 */
export const SERVICE_MEMBERS = Object.freeze([...SERVICE_METHODS, ...SERVICE_NAMESPACES, ...SERVICE_FIELDS].sort());

/**
 * 命名空间**内部的成员**（`overlay.open/close/bringToFront` 等）。
 * 它们不被公开面快照列为字段（快照冻结的是**服务成员**这一层），但同样是公开契约：
 * `tests/unit/service.test.mjs` 用本表把「声明 ↔ 实现」锁住（多一个 / 少一个都变红）。
 */
export const NAMESPACE_MEMBERS = Object.freeze({
  components: Object.freeze(['get', 'has', 'names', 'props', 'register']),
  dock: Object.freeze(['close', 'isOpen', 'open']),
  overlay: Object.freeze(['bringToFront', 'close', 'open']),
});

/**
 * 服务实例上的**载体字段**（Cordis 惯例，不是 GUIFrame 的 API 成员，故**不进快照**）：
 * `service.ctx` 是「调用方 ctx」的载体 —— cordis 服务代理在**调用点**改写它（见文件头）。
 * 这里显式登记它，是为了让单测能区分「契约成员」与「载体」：后者被改名时由调用方-fiber 绑定用例抓。
 */
export const SERVICE_CARRIER_FIELDS = Object.freeze(['ctx']);

/**
 * 对外承诺的能力集：坞（入口注册与座位）、面板骨架、浮层（含按钮面板的托管浮层）。
 * 名称与 `src/client/` 的能力目录一一对应（分层建议）。
 * 主题守门有切片、不对外起名，故不在这张表里 —— 判据见 `tests/verify-surface/public-surface.test.mjs`。
 */
export const CAPABILITIES = Object.freeze(['dock', 'overlay', 'panel']);

/**
 * 能力 → 装配切片名（`service.supports(name)` 用它判断「当前真的可用」）：
 *  - `null` ⇒ 服务面自带内存态，无需切片；
 *  - 否则 ⇒ 必须由对应模块的 `install(ctx, env)` 装入切片后 `supports` 才为 true。
 *  `theme` 有切片但没有对外命名空间（主题守门不是能力集里的一项，见 `CAPABILITIES` 的注）。
 */
export const CAPABILITY_SLICES = Object.freeze({
  dock: 'dock',
  panel: 'dock', // 面板骨架挂在坞的成对注册上（panellist + main 成对）
  overlay: 'overlay',
  theme: 'theme',
});

/** 允许装配的切片名全集（`service.__install(name, api)` 的白名单；多一个都算契约外）。 */
export const SLICE_NAMES = Object.freeze(['dock', 'overlay', 'theme']);

/**
 * 本包**收取的 slot 键**：`sidebar.panellist`（侧栏中部图标行）+ `main`（主区面板）——
 * 坞必须**成对**注册这两个，两者 `id`/`key` 同值。
 * 快照里冻结它，是为了拦住「多注册一个座位 / 换一个座位」这类静默漂移。
 */
export const CONSUMED_SLOT_KEYS = Object.freeze(['main', 'sidebar.panellist']);

/**
 * 本包**查询的平台服务名**（快照字段名是 `inject`，但语义要说清）：
 * 这三项一律经 `ctx.get(name)` **软探测**取用，**不用 Cordis 的 `inject` 声明** ——
 * 口径已定：客户端 `inject` 缺服务会让 fiber 悬置、外壳 `assertEntriesActive` 直接抛错
 * 打死整页；GUIFrame 的接入口径是「依赖缺失就不激活」（唯一默认写法 `if (!ctx.get('gui-frame')) return;`）。
 *  - `slots`：座位注册
 *  - `settingsScope`：设置命名空间 `gui-frame`（宿主半区注册；本版的服务面成员一个都不读它）
 *  - `connection`：宿主路由的注册通道（诊断与 ping 走它）
 */
export const PLATFORM_SERVICE_KEYS = Object.freeze(['connection', 'settingsScope', 'slots']);

/** entry.id 的形态（**必须带命名空间前缀**，绝不占保留 key）。 */
export const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;
/** entry.id / key 的保留字（`conversation` 是外壳保留 key，占用会顶掉会话界面）。 */
export const RESERVED_ENTRY_IDS = Object.freeze(['conversation']);
/** entry.id 长度上限（防御性，避免超长 DOM 属性/日志）。 */
export const ENTRY_ID_MAX_LENGTH = 128;
/** entry 的两种形态（混合策略：面板型走 panellist，动作型在坞内展开）。 */
export const ENTRY_KINDS = Object.freeze(['panel', 'action']);
/** 本包自己的 id 前缀（本包自带入口用；第三方插件用各自的包名前缀）。 */
export const OWN_ID_PREFIX = 'dsh-gui-frame/';
