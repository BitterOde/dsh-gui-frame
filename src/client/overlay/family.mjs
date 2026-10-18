/**
 * family.mjs —— **弹层族**：Dialog / Popover / Tooltip / HoverCard 的宿主侧容器
 * （对外暴露复合组件、原子件由插件自行取用）。
 *
 * 纪律：**复用官方 primitives 的原子件**（`Modal` / `Menu` / `Tooltip` / `HoverCard`），
 * GUIFrame 只补「组合与行为约定」——不重画外观、不重复造原子。
 * 官方实测签名（全部从外壳产物反推）：
 *   `Modal({open,onClose,title,closeLabel,description,children,footer,className,contentClassName,headless})`
 *   `Menu({open,anchor,items,selectedId,onSelect,onClose,align,side,portal,…})`
 *   `Tooltip({label,side,delayMs,disabled,maxWidth,children})`（**children 必须能接 ref**）
 *   `HoverCard({anchor,content,openDelayMs,disabled,copyText,copyLabel,copiedLabel})`
 *   `Toast` 无宿主 ⇒ 见 `toast.mjs`（队列/堆叠自研）。
 *
 * ⚠ 原子件缺失时（种子表变动、rc 期改名）**不抛错**：退化成「不渲染 + 记一条使用记录」，
 * 由宿主转到诊断（任何一处失败都不许把整页带走）。
 */

/** 族 → 官方原子件名（单一真源；`toast` 的宿主在 `toast.mjs`）。 */
export const FAMILY_ATOMS = Object.freeze({
  dialog: 'Modal',
  popover: 'Menu',
  tooltip: 'Tooltip',
  hoverCard: 'HoverCard',
  toast: 'Toast',
});

/** 取官方原子（拿不到返回 `null`）。 */
export function resolveAtom(primitives, name) {
  if (primitives === null || primitives === undefined || typeof primitives !== 'object') return null;
  const atom = primitives[name];
  return typeof atom === 'function' ? atom : null;
}

/**
 * 造一族容器组件（每个都只是官方原子的一层**薄壳**：补默认值 + 记录使用情况）。
 * @param {object} react 种子里的 React
 * @param {object|null} primitives 官方 primitives 种子
 * @returns {{Dialog:Function, Popover:Function, Tooltip:Function, HoverCard:Function,
 *   atoms:object, usage:Function, missing:Function}}
 */
export function createFamily(react, primitives) {
  const usageRows = [];
  const missingRows = [];

  const record = (kind, atomName, used) => {
    usageRows.push({ kind, atom: atomName, used });
    if (!used) missingRows.push({ kind, atom: atomName });
  };

  /** Dialog：官方 Modal 的薄壳（模态 ⇒ 宿主据此决定要不要锁 body 的 pointer-events）。 */
  function Dialog(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.dialog);
    record('dialog', FAMILY_ATOMS.dialog, atom !== null);
    if (atom === null) return null;
    return react.createElement(atom, {
      open: props.open !== false,
      onClose: props.onClose,
      title: props.title,
      closeLabel: props.closeLabel,
      description: props.description,
      footer: props.footer,
      className: props.className,
      contentClassName: props.contentClassName,
      headless: props.headless === true,
    }, props.children ?? null);
  }

  /** Popover：官方 Menu 的薄壳（锚点定位 + 边界 clamp 由官方内部负责）。 */
  function Popover(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.popover);
    record('popover', FAMILY_ATOMS.popover, atom !== null);
    if (atom === null) return null;
    return react.createElement(atom, {
      open: props.open !== false,
      anchor: props.anchor,
      getAnchorRect: props.getAnchorRect,
      items: props.items ?? [],
      selectedId: props.selectedId,
      selectedIds: props.selectedIds,
      onSelect: props.onSelect,
      onClose: props.onClose,
      align: props.align ?? 'start',
      side: props.side ?? 'bottom',
      portal: props.portal !== false,
      dense: props.dense === true,
      compact: props.compact === true,
      footer: props.footer,
      className: props.className,
    });
  }

  /** Tooltip：官方 Tooltip 的薄壳（**必须把裸文本包成元素**，官方要求 children 能接 ref）。 */
  function Tooltip(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.tooltip);
    record('tooltip', FAMILY_ATOMS.tooltip, atom !== null);
    if (atom === null) return props.children ?? null;
    const child = props.children;
    const safeChild = typeof child === 'string' || typeof child === 'number'
      ? react.createElement('span', null, String(child))
      : child ?? react.createElement('span', null);
    return react.createElement(atom, {
      label: props.label,
      side: props.side ?? 'bottom',
      delayMs: props.delayMs ?? 0,
      disabled: props.disabled === true,
      maxWidth: props.maxWidth,
    }, safeChild);
  }

  /** HoverCard：官方 HoverCard 的薄壳。 */
  function HoverCard(props) {
    const atom = resolveAtom(primitives, FAMILY_ATOMS.hoverCard);
    record('hoverCard', FAMILY_ATOMS.hoverCard, atom !== null);
    if (atom === null) return props.children ?? null;
    return react.createElement(atom, {
      anchor: props.anchor,
      content: props.content,
      openDelayMs: props.openDelayMs,
      disabled: props.disabled === true,
    });
  }

  return {
    Dialog,
    Popover,
    Tooltip,
    HoverCard,
    atoms: { ...FAMILY_ATOMS },
    /** 使用记录（测试/诊断：证明「确实走的是官方原子」）。 */
    usage() {
      return usageRows.map((row) => ({ ...row }));
    },
    missing() {
      return missingRows.map((row) => ({ ...row }));
    },
  };
}

/** 弹层族里**哪些是模态**（模态才需要锁 body 的 pointer-events；浮动窗/气泡/吐司不是）。 */
export function isModalFamily(family) {
  return family === 'dialog';
}
