/**
 * panel-styles.mjs —— **坞面板的行样式表**（用户指令：
 * 「按钮面板里的按钮样式太丑了，你看看 DSH 上侧边栏的按钮实现呢？……按钮容器背景实现要和 DSH 原版的设计风格统一」）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么要有这张表，而不是全写内联样式】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * DSH 侧栏那一行的观感有一半在**伪类**上（`:hover` 背景、`:focus-visible` 轮廓）——
 * 内联 style 表达不了。所以：**内联样式给基线外观**（不依赖任何能力），
 * **这张表补伪类与「中和注册方控件外壳」**（`[data-guif-dock-action] button{…}`）。
 * 装配期由主题能力注入：`service.__slice('theme').installStyles(ctx, {css, id})`，标签
 * `<style data-guif-theme="gui-frame-dock-panel">`（`theme/styles.mjs` 的 `installStyleSheet`）。
 *
 * ⚠ **内联优先于样式表** ⇒ `:hover` / `:disabled` / 激活态这几条必须带 `!important`，否则状态永远换不过来
 *   （真机实测：真鼠标压上去背景仍是 `rgba(0,0,0,0)`）。两份样式都是本包自己的代码，
 *   工具在受控面内。
 *
 * ⚠ **第三方注册方控件的「悬停底色」也归本表管**（用户指令：「把鼠标移动到文字上，
 *   出现的白色背景删掉」）：注册方自己的 `.sq-btn:hover{background:var(--dsw-alias-bg-layer-2)}`
 *   特异性高过本表那条不带 `!important` 的外壳中和 ⇒ 浅色主题下 `#fff` 白块盖住整行。
 *   现在 `:is(:hover,:active,:focus,:focus-visible)` 一律 `background-color:transparent!important`
 *   （角标除外）。**代价**：注册方控件有意画的「悬停底色」也会被抹掉 —— 与 DSH 侧栏
 *   「整行一个悬停面」的语义一致，这是用户拍板的方向；它**只覆盖悬停/焦点/激活三态**，
 *   **不动**控件在静止态自己画的底色（那一层仍只做基线归一、不带 `!important`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【逐值照抄 DSH 侧栏的 `.hHd-Xa_panelRow`】（实读 `dsh-client-ui-sidebar/lib/client.js` 的 CSS 段）
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ```css
 * .panelRow{box-sizing:border-box;width:100%;min-height:36px;color:var(--dsw-alias-label-secondary);
 *   font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;
 *   align-items:center;gap:8px;padding:7px 8px;line-height:22px;display:flex}
 * .panelRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
 * .panelRow.panelActive{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
 * .panelRow:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}
 * .panelGlyph{flex:none;justify-content:center;align-items:center;display:inline-flex}
 * .panelTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
 * ```
 * 本表把 `.panelRow` 换成**我们自己的锚点** `[data-guif-dock-action]`，取值一字未改；
 * 颜色**只走白名单 `--dsw-*`**（`kit/tokens.mjs` 的 `DSW_TOKENS`，`check:tokens` 硬门禁照过）。
 *
 * ⚠ 两个**没进白名单**的 DSH token 故意不用：外壳的 `.newSession` 用 `--dsw-alias-button-elevated-fill` /
 *   `--dsw-alias-button-floating-hover`，而它们不在本包探针取证表里（`probe/evidence/p4-theme-tokens.json`）
 *   ⇒ 用了会在运行期被 token 闸门判成悬空。等价观感改用 `--dsw-alias-bg-layer-2` + `--dsw-alias-interactive-bg-hover`。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【「悬停背景没了」＝ 这张表**不在文档里**，而旧注入器不认账】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 真机取证（隔离实例 + headless CDP）：
 *   · 常态：四行（SafelyQuit / AbsentMode / ButtonMigration×2）悬停底色都是 `rgba(38,49,72,.06)`；
 *   · 把 `<style data-guif-theme="gui-frame-dock-panel">` **摘掉** ⇒ 行的几何/字色照旧（内联基线在），
 *     但悬停底色变 `rgba(0,0,0,0)`、焦点轮廓与激活态一并消失 —— **与用户报的那一幕逐项一致**；
 *   · 再**关掉面板重开** ⇒ 样式表**没回来**（`styleTagBack:false`）。旧注入器只记一个布尔
 *     「我注入过」，谁都问不出「它现在到底在不在」。⇒ 只有整页刷新能救。
 * 修法（本文件下半部分）：判据换成**问 DOM**（`panelStylesPresent`）+ 注入后**当场复验**
 *   + 成功后在 `document.head` 上**值守**（`MutationObserver`，摘了就补、补不回来就停手）。
 *   三条都只在**样式表层**，行内基线一字未动 ⇒ 主题能力缺席时的降级不受影响。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【「把外观接口做丰富」：行外观开成**一族公开变量**】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 用户原话：「外部可以通过接口自定义按钮（包括悬停时）底色吗？」→ 查证结论是**接口层没有**任何样式字段
 * （entry 字段表无样式项、公开命名空间里没有 theme），而**样式层**只有外壳 token 可改（会连带别处）。
 * 裁定：「在接口上做得稍微丰富点吧」⇒ 本表四条状态取值全部改走 `--guif-dock-row-*`（缺省＝原值）：
 *   `-bg`（静止，内联基线里）`-bg-hover` `-bg-active` `-fg`（内联基线）`-fg-active` `-focus-ring`。
 * ⚠ **不是可变项的两个几何值 ＝ 美学秩序的不变量**（「改行圆角和行间距会影响面板的美学秩序，
 *   所以不要。」）⇒ **圆角**与**行距**保持**字面量**（与 DSH 侧栏 `.panelRow` /
 *   `.panelList` 逐值同源），`tests/unit/dock-style-vars.test.mjs` 盯着它们不许变成变量 ——
 *   改成变量会先判红，逼人先想清楚该不该动美学秩序。
 * ⚠ **只取用、不声明**：名字一律出现在 `var(...)` 的值位。谁在元素上把 `--guif-*` 声明成内联自定义属性，
 *   谁就把祖先给的覆盖值**挡死**（自定义属性走继承，元素自己的声明恒胜）
 *   （`panel/components.mjs` 有同款注释）。
 */

/** 样式标签的归属 id（`<style data-guif-theme="…">`；真机断言用它找自己的样式）。 */
export const PANEL_STYLE_ID = 'gui-frame-dock-panel';

/**
 * 样式标签的**归属属性名**（`theme/styles.mjs` 的 `GUIF_STYLE_ATTRIBUTE`）。
 * 这里逐字写一遍而不是 import 它：本模块取主题切片只走服务面切片（`__slice('theme')`），不新增能力域直连。
 */
export const PANEL_STYLE_ATTRIBUTE = 'data-guif-theme';

/** 当前文档（没有 DOM ⇒ `null`；`document` 这个标识符本身也可能不存在，取值也要兜）。 */
function currentDocument() {
  try {
    return typeof document === 'undefined' ? null : document;
  } catch {
    return null;
  }
}

/** 面板行样式表（字符串常量：本模块零副作用，注入由调用方做）。 */
export const PANEL_CSS = [
  /* 列表容器：DSH 侧栏 `.panelList` 同款（纵向 + 4px 间距；行距有意不开变量 —— 见文件头） */
  '[data-guif-dock-actions]{display:flex;flex-direction:column;gap:4px}',
  /* ── 行本体：`.panelRow` 逐值 ─────────────────────────────────────────────
     ⚠ 状态类声明带 `!important`：**内联基线优先于样式表**（行上内联写了 `background`/`color`），
       不带它就等于 `:hover` 永远不生效（真机实测：真鼠标压上去背景仍是 `rgba(0,0,0,0)`，
       而原生那一行是 `rgba(38,49,72,.06)`）。这两份样式**都是本包自己的代码**，工具在受控面内。
     ★ 本表四条状态取值走**公开变量**（`var(--guif-dock-row-*, 原值)`），
       接入方在任意祖先上定义即生效 —— 缺省即现状，没人覆盖时观感零变化。 */
  '[data-guif-dock-action]{box-sizing:border-box;width:100%;min-height:36px;color:var(--guif-dock-row-fg, var(--guif-panel-fg, var(--dsw-alias-label-secondary)));font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:7px 8px;line-height:22px;display:flex}',
  '[data-guif-dock-action]:hover{background:var(--guif-dock-row-bg-hover, var(--dsw-alias-interactive-bg-hover))!important}',
  '[data-guif-dock-action]:focus-visible{outline:2px solid var(--guif-dock-row-focus-ring, var(--dsw-alias-label-primary));outline-offset:-2px}',
  '[data-guif-dock-action][data-guif-dock-row-active="true"]{background:var(--guif-dock-row-bg-active, var(--dsw-alias-interactive-bg-active))!important;color:var(--guif-dock-row-fg-active, var(--dsw-alias-label-primary))!important;font-weight:500!important}',
  /* ── 行内：角标（`.panelGlyph` 同款那一条已随图标槽一起删掉：行里只有一个图标，
        由注册方的控件自己画 —— 见 `panel-content.mjs` 的第四次翻面） ──────────────────── */
  '[data-guif-dock-action] [data-guif-badge]{flex:none;margin-left:auto}',
  /* ── ★ 中和注册方控件的**外壳**：插件自己的按钮/开关进坞后不再自带边框底色，
        与 DSH 行内内容同款（否则面板里就是一堆风格各异的小盒子）。文字与字号一并归一。 ── */
  '[data-guif-dock-action] button{background:0 0;border:none;padding:0;margin:0;color:inherit;font:inherit;line-height:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;text-align:left;min-width:0}',
  '[data-guif-dock-action] span{color:inherit;font:inherit}',
  /* ── ★ **行内任何元素都不许在悬停/激活/焦点时自己冒底色**（用户指令：
        「把鼠标移动到文字上，出现的白色背景删掉」）。
        为什么必须 `!important` + 覆盖伪类：注册方自己的 `.sq-btn:hover{background:var(--dsw-alias-bg-layer-2)}`
        特异性 (0,2,0) 高过上面那条 (0,1,1)，而浅色主题里 `--dsw-alias-bg-layer-2`
        ＝ `var(--dsw-static-neutral-bluish-00)` ＝ **#fff** ⇒ 真机实测内层按钮悬停背景 `rgb(255,255,255)`，
        一个**纯白块**盖在行的悬停底色（`rgba(38,49,72,.06)`）上。DSH 侧栏那一行的语义是
        **整行一个悬停面**（`.panelRow:hover` 画底色，字形与标题都不画）—— 注册方控件进坞后照此办理。
        `:not([data-guif-badge])` 把**坞自绘的角标**摘出去（角标本身就有底色，不该被清成透明）。 ── */
  '[data-guif-dock-action] :is(:hover,:active,:focus,:focus-visible):not([data-guif-badge]){background-color:transparent!important}',
  /* 空态：DSH 的 caption 文本（旧版用 opacity:.65 压暗，那是临时手法） */
  '[data-guif-dock-hint]{color:var(--dsw-alias-label-caption);line-height:1.6;padding:2px 8px}',
  /* ── 管理页（工作台那一格）的自检入口：DSH 次级按钮观感（`.newSession` 的等价取值） ──
     同上：内联 `BUTTON_STYLE` 写了 `background`/`color` ⇒ 悬停/禁用两态要 `!important` 才压得住。 */
  '[data-guif-launcher]{box-sizing:border-box;height:38px;padding:8px 16px;gap:6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
  '[data-guif-launcher]:hover{background:var(--dsw-alias-interactive-bg-hover)!important}',
  '[data-guif-launcher]:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:-2px}',
  '[data-guif-launcher]:disabled{cursor:default;color:var(--dsw-alias-label-caption)!important;background:0 0!important}',
  '',
].join('\n');

/**
 * 把样式表交给主题能力注入（**不判重**：theme 侧不按 id 去重，幂等守在调用侧 —— 见 `createPanelStylesInstaller`）。
 * 走**服务面切片**（`service.__slice('theme')`）而不是 import theme 模块 ⇒ 不新增能力域直连。
 *
 * ⚠ **不是 `service.theme`**：主题能力在服务面上**没有**同名属性，取法是 `__slice('theme')`
 *   （`contracts/service-face.mjs` 的 `CAPABILITY_SLICES.theme === 'theme'` + `SLICE_NAMES`）。
 *   按 `service.theme` 取 ⇒ 恒 `undefined` ⇒ 静默返回 false ⇒ **样式表一次都没注入**
 *   （真机实测：行的容器样式逐字段与原生一致，但 `:hover` 背景与「中和注册方外壳」全丢）。
 *
 * @param {object} service `ctx.gui-frame` 服务面实例
 * @param {object} ctx 调用方 ctx（清理挂它的 fiber）
 * @returns {boolean} 是否真的注入了（主题能力不在场 ⇒ false，观感退到内联基线）
 */
export function installPanelStyles(service, ctx) {
  try {
    if (service === null || service === undefined || typeof service.__slice !== 'function') return false;
    const theme = service.__slice('theme');
    if (theme === null || theme === undefined || typeof theme.installStyles !== 'function') return false;
    theme.installStyles(ctx, { css: PANEL_CSS, id: PANEL_STYLE_ID });
    return true;
  } catch {
    return false;
  }
}

/**
 * ★★ **我们的样式表此刻是否真的在文档里**。
 *
 * 为什么需要它 —— 报告是「按钮面板悬停背景没了」，真机取证的结论是：
 *   ① 行本体的观感有一半（容器几何）在**内联基线**上 ⇒ 样式表丢了以后行**看着照旧**，
 *      只有 `:hover` / `:focus-visible` / 激活态这三层（＝样式表独有）**全丢**；
 *   ② 样式表是**挂在调用方 fiber 上的副作用**（`ctx.effect` ⇒ `installStyleSheet`）——
 *      fiber 一卸载，theme 侧就把 `<style>` 摘掉；而旧版注入器只记一个布尔「我注入过」，
 *      **摘掉之后永远不再补**（真机读数：摘掉样式表 ⇒ 悬停底色 `rgba(0,0,0,0)`；
 *      关掉面板再开，`styleTagBack:false`、悬停底色仍是 `rgba(0,0,0,0)`）。
 *      ⇒ 那就不是「观感降级」，而是**静默的永久丢**，只有整页刷新能救。
 *   ③ 判据换成**问 DOM**：在位就是到位，不在位就（重新）注入，注入完**当场复验**。
 *
 * 无 DOM（单测 / 非浏览器）⇒ `false`（那一路本来也没有「在位」可言，调用点另有兜底语义）。
 *
 * @param {object} [doc] 文档（缺省取当前 `document`；测试可注入）
 * @returns {boolean} 样式表是否在文档里
 */
export function panelStylesPresent(doc = currentDocument()) {
  if (doc === null || doc === undefined || typeof doc.querySelector !== 'function') return false;
  try {
    return doc.querySelector(`style[${PANEL_STYLE_ATTRIBUTE}="${PANEL_STYLE_ID}"]`) !== null;
  } catch {
    return false;
  }
}

/**
 * 造一个**在位即幂等、丢了会补**的注入器：
 * `openDockPanel` 每次开面板、管理页每次挂载都会调 `ensure()`；样式表已经在位就不重复注入。
 *
 * ★ `resolveCtx` 收**取值函数**而不是 ctx 本体：调用侧在 `install(ctx)` 之前就造好了本注入器
 *   （`dock/core.mjs`：面板模块先建、`refs.ctx` 后填）。传 `refs.ctx` 的**快照**会捕获到 `null`
 *   ⇒ `theme.installStyles` 被 `__assertCtx` 挡下 ⇒ **样式表静默不注入**
 *   （真机实测：行的容器样式逐字段与原生一致，但 `:hover` 背景与「中和注册方外壳」全丢）。
 *   ⇒ 这里**每次调用现取**（`refs.ctx` 是共享可变对象，取值时已填好）。
 *
 * ★★ **把「记一个布尔」换成「看 DOM + 值守」**，三条真机事实：
 *   · 记布尔 ⇒ 样式表被 fiber 卸载摘掉后**永久不再补**（见 `panelStylesPresent` 的注释）；
 *   · 注入调用返回成功 ≠ 元素在文档里（`ctx.effect` 挂不上、`<head>` 取不到…都会「成功但没落地」）
 *     ⇒ 注入之后**当场复验**，验不过就不报成功、也不记「已装」；
 *   · 只补「下次开面板」不够 —— 面板可能**正开着**（用户就是盯着它悬停）⇒ 成功注入后上一个
 *     `MutationObserver` 守着 `document.head`：我们的 `<style>` 一没就补回来（面板不用重开）。
 *     补不回来（例如挂它的 ctx 已经死了）⇒ **停手**，不空转、不刷屏；下次 `ensure()` 还会再试。
 *
 * @param {object} service `ctx.gui-frame` 服务面实例
 * @param {() => object} resolveCtx 现取调用方 ctx（清理挂它的 fiber）
 * @param {(ctx:object, label:string, install:() => (() => void)|void) => (() => void)} [effectOn]
 *   坞的「在调用方 ctx 上挂一条幂等副作用」助手（`dock.mjs` 的 `effectOn`，内部就是 `ctx.effect`）。
 *   缺席 ⇒ 不值守（只保留「每次调用复验 + 按需补注入」这一半；观感仍会自愈，只是要等下一次调用）。
 * @returns {() => boolean} `ensure()`：本次调用结束时样式是否**已在位**
 */
export function createPanelStylesInstaller(service, resolveCtx, effectOn) {
  const ctxOf = () => (typeof resolveCtx === 'function' ? resolveCtx() : resolveCtx);
  /** 无 DOM 环境下的旧语义（调用成功即算装过）：那里没有任何可验证的判据，也不额外报错。 */
  let blindLatch = false;
  /** 值守观察器的摘除器（`null` = 没在守）。 */
  let watchOff = null;

  function inject() {
    try {
      return installPanelStyles(service, ctxOf()) === true;
    } catch {
      return false;
    }
  }

  function stopWatch() {
    const off = watchOff;
    watchOff = null;
    if (typeof off === 'function') {
      try {
        off();
      } catch {
        /* 已经摘掉了 */
      }
    }
  }

  /** 守着 `document.head`：`<style>` 一没就补；补不回来就停手（幂等：只在没有观察器时武装）。 */
  function armWatch(doc) {
    if (watchOff !== null || typeof effectOn !== 'function') return;
    if (doc === null || doc.head === null || doc.head === undefined) return;
    if (typeof MutationObserver !== 'function') return;
    try {
      watchOff = effectOn(ctxOf(), 'gui-frame: dock panel stylesheet watch', () => {
        const observer = new MutationObserver(() => {
          if (panelStylesPresent(doc) === true) return; // 还在 ⇒ 与这次变更无关
          if (inject() === true && panelStylesPresent(doc) === true) return; // 补回来了 ⇒ 继续守着
          stopWatch();
        });
        observer.observe(doc.head, { childList: true });
        return () => {
          observer.disconnect();
        };
      });
    } catch {
      watchOff = null;
    }
  }

  return function ensurePanelStyles() {
    const doc = currentDocument();
    // ① 没有 DOM：没有可验证的判据 ⇒ 退到「调用成功即算装过」（旧语义；那里本来也注入不出东西）。
    if (doc === null) {
      if (blindLatch === true) return true;
      const ok = inject();
      if (ok === true) blindLatch = true;
      return ok;
    }
    // ② 在位 ⇒ 直接成功（并确保值守已武装）。
    if (panelStylesPresent(doc) === true) {
      armWatch(doc);
      return true;
    }
    // ③ 不在位 ⇒ 补注入 + **当场复验**（验不过就不许报成功 —— 这一条就是那次事故的闸）。
    const ok = inject();
    if (ok !== true || panelStylesPresent(doc) !== true) {
      stopWatch();
      return false;
    }
    armWatch(doc);
    return true;
  };
}
