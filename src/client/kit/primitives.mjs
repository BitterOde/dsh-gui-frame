/**
 * primitives.mjs —— **官方 primitives 的安全子集**。
 *
 * ═══ 为什么要这张表 ═══
 * `@deepseek-ai/dsh-client-ui-primitives` 是外壳的静态种子键（rc 期**无独立包目录、无类型、无文档**，
 * 只在内联产物里）。GUIFrame 只用其中**官方自己在用的**那一部分：本机 50 个官方包的 `lib/client.js`
 * 里真实出现过 `primitives.<成员>` 的成员，恰好 180 个（扫描方法见下方 `PRIMITIVES_SCAN`，
 * 平台在位时可用它重扫一遍）。
 *
 * ⚠ **图标名的命名体系随平台换过**：0.1.5 一代用**尺寸后缀**（`IconCloseOutline16`），
 *   0.2.0 起换成**字重后缀**（`IconCloseOutlineRegular` / `…Medium`）。旧名在新平台里一个都没有，
 *   而 `get()` 对未覆盖名**直接抛** ⇒ 这不是「测试要改」而是**产品面必须跟着改名**。
 *
 * 判据强度说明（别把它当「大概齐」）：
 *  - 「存在」由**官方调用点**证明（不是从导出表猜的），所以被本表收录的成员都**有真实用法**；
 *  - 反过来，**不在表里的成员一律不许用**（`createPrimitivesSeat` 的 `get()` 对未知名字**直接抛**）——
 *    口径是「未覆盖成员**不得使用**」。
 *  - 种子缺席（`env.seeds.primitives` 为 `undefined` 或构建期的假种子）时**不抛**：`get()` 返回
 *    `undefined`，组件走**自研等价物**兜底（依赖缺失时不激活、不炸页面）。
 *
 * ═══ 我们实际用到的那 8 个（`PRIMITIVES_USED`）═══
 * 全是使用频次前排成员（括号里是 50 个包里的调用点数）：
 *   Button 112 · Tooltip 63 · IconChevronRightOutlineRegular 31 · IconCloseOutlineRegular 16 ·
 *   IconWarningOutlineRegular 16 · Tag 9 · IconRefreshOutlineRegular 8 · IconLoadingOutlineRegular 3
 * 单测断言 `PRIMITIVES_USED ⊆ PRIMITIVES_MEMBERS`，并在平台在位时断言 `⊆ 实时重扫结果`。
 *
 * 本文件**零副作用**：纯常量 + 纯函数，不读 DOM、不碰种子。
 */
import { createError } from '../contracts/errors.mjs';

/** 扫描元信息（可重演：同一版本 DSH 上重跑得到同一集合）。 */
export const PRIMITIVES_SCAN = Object.freeze({
  package: '@deepseek-ai/dsh-client-ui-primitives',
  platform: 'DSH 0.2.0-rc.2',
  method: '扫本机 @deepseek-ai/ 下所有 lib/client.js，取其中 require 该种子键的别名，统计 `<别名>.<成员>`',
  packages: 50,
  members: 180,
});

/**
 * 官方 50 个包真实 require 过的 primitives 成员全集（180 个，排序）。
 * 本文件**不解释**每个成员的签名（rc 期无反推保证）；表的作用是**闸门**，不是文档。
 */
export const PRIMITIVES_MEMBERS = Object.freeze([
  'BrandWordmark', 'Button', 'CODE_HIGHLIGHT_EXTENSIONS', 'Checkbox',
  'CodeBlock', 'ConnectionIndicator', 'DiffBlock', 'DisclosureRow',
  'FISH_LOGO_PATH', 'FISH_LOGO_VIEWBOX', 'FileTypeIcon', 'FishLogo',
  'GuideArtworkBrowser', 'GuideArtworkFiles', 'HoverCard', 'ICON_REGULAR_STROKE',
  'IconAgentPresetOutlineMedium', 'IconAgentPresetOutlineRegular', 'IconApiOutlineRegular', 'IconArchiveCheckOutlineRegular',
  'IconArchiveOffOutlineRegular', 'IconArchiveOutlineMedium', 'IconArchiveOutlineRegular', 'IconBranchOutlineRegular',
  'IconBrowseOutlineRegular', 'IconCheckCircleFillRegular', 'IconCheckOutlineRegular', 'IconChecklistOutlineRegular',
  'IconChevronDownOutlineRegular', 'IconChevronLeftOutlineMedium', 'IconChevronLeftOutlineRegular', 'IconChevronRightOutlineRegular',
  'IconChevronUpOutlineRegular', 'IconChevronsUpDownOutlineRegular', 'IconClockOutlineRegular', 'IconCloseCircleFillRegular',
  'IconCloseFillRegular', 'IconCloseOutlineMedium', 'IconCloseOutlineRegular', 'IconCodeOutlineRegular',
  'IconCompactOutlineRegular', 'IconCompareSplitOutlineRegular', 'IconContextInjectionOutlineRegular', 'IconCopyOutlineRegular',
  'IconCordisPluginOutlineRegular', 'IconDarkOutlineMedium', 'IconDataOutlineMedium', 'IconDataOutlineRegular',
  'IconDatabaseOutlineRegular', 'IconDeliverDocRegular', 'IconDislikeFillRegular', 'IconDislikeOutlineRegular',
  'IconDownloadOutlineRegular', 'IconEditOutlineRegular', 'IconEllipsisOutlineMedium', 'IconEllipsisOutlineRegular',
  'IconFlatListOutlineRegular', 'IconFolderCloseRegular', 'IconFolderOpenOutlineRegular', 'IconFolderOpenRegular',
  'IconFollowsystemOutlineMedium', 'IconGaugeOutlineRegular', 'IconGlobeOutlineRegular', 'IconGoalOutlineRegular',
  'IconInfoOutlineRegular', 'IconInspectOutlineRegular', 'IconLightOutlineMedium', 'IconLikeFillRegular',
  'IconLikeOutlineRegular', 'IconLinkOutlineRegular', 'IconListPenOutlineRegular', 'IconLoadingOutlineRegular',
  'IconMicrophoneOutlineRegular', 'IconNewChatOutlineMedium', 'IconNewChatOutlineRegular', 'IconNowrapFillRegular',
  'IconPanelLeftOutlineRegular', 'IconPaperPlaneOutlineMedium', 'IconPaperPlaneOutlineRegular', 'IconPaperclipOutlineRegular',
  'IconPauseOutlineRegular', 'IconPersonalizationOutlineMedium', 'IconPinFillRegular', 'IconPinOutlineRegular',
  'IconPlanOutlineRegular', 'IconPlayOutlineRegular', 'IconPluginPinwheelOutlineRegular', 'IconPlusOutlineMedium',
  'IconPlusOutlineRegular', 'IconProjectAddOutlineRegular', 'IconQuestionOutlineRegular', 'IconQueueOutlineRegular',
  'IconRefreshOutlineRegular', 'IconRightUpOutlineRegular', 'IconSearchOutlineRegular', 'IconSendOutlineRegular',
  'IconSettingsOutlineMedium', 'IconSettingsOutlineRegular', 'IconSkillOutlineRegular', 'IconSlidersTwoOutlineRegular',
  'IconSparkleRegular', 'IconStopFillRegular', 'IconThinkOutlineRegular', 'IconTrashOutlineRegular',
  'IconTriangleRightFillRegular', 'IconUnarchiveOutlineRegular', 'IconUserOutlineMedium', 'IconUserOutlineRegular',
  'IconUsersOutlineRegular', 'IconWarningOutlineRegular', 'IconWarningTriangleOutlineRegular', 'IconWorkspaceTreeOutlineRegular',
  'IconWrapFillRegular', 'IconWrapLinesOutlineRegular', 'ImageLightbox', 'Input',
  'JsonBlock', 'JsonTree', 'MarkdownDelegateProvider', 'MarkdownText',
  'Menu', 'MenuGroup', 'MenuItemButton', 'MenuSurface',
  'Modal', 'PathLabel', 'PermissionIconFullAccessRegular', 'PermissionIconReadOnlyRegular',
  'PermissionIconWorkspaceWriteRegular', 'Pill', 'PluginArtworkDefault', 'PluginArtworkLoop',
  'PluginArtworkSearch', 'PluginArtworkSubagent', 'PluginArtworkTerminal', 'ReadBlock',
  'ReferenceIconRegular', 'RiskConfirmation', 'SHIELD_OUTLINE_PATH', 'SearchBlock',
  'SegmentedControl', 'SegmentedTabs', 'SettingsForm', 'SettingsFormModel',
  'SettingsSecretField', 'SettingsValueField', 'ShortcutKeys', 'StateDot',
  'Switch', 'Tag', 'TerminalBlock', 'TextShimmer',
  'Toast', 'Tooltip', 'WebBlock', 'classifyFileType',
  'closeTopModal', 'diffTotals', 'extractMarkdownPlainText', 'fileExtension',
  'fileSizeText', 'focusWithoutRing', 'isBehindModal', 'isDarwinDesktop',
  'languageForPath', 'modalSelector', 'observeComposition', 'observeStickyMenuGroups',
  'pointerModality', 'projectUserText', 'rankByName', 'relativeTime',
  'settingsNumberField', 'settingsTextField', 'useAnchoredMaxHeight', 'useAnchoredPosition',
  'useCodeHighlighter', 'useDismissOnOutsidePointer', 'useModalLayer', 'writeClipboard',
]);

/** 本包坞与面板**实际取用**的成员（上表子集；每一处 `get()` 都要能指到这里）。 */
export const PRIMITIVES_USED = Object.freeze([
  'Button',
  'IconChevronRightOutlineRegular',
  'IconCloseOutlineRegular',
  'IconLoadingOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconWarningOutlineRegular',
  'Tag',
  'Tooltip',
]);

/** 装配期错误码：越出「官方真实用过」的子集。
 *
 * ⚠ 错误码取既有冻结码 `GUIF-E-COMPONENT-INVALID`（语义：**组件层入参非法**）—— 不新造码，
 * 理由见 `kit/tokens.mjs` 的同名注释（L1 公开面门禁扫 `src/**` 的 `GUIF-[EW]-*`）。
 */
export function primitivesError(message, details) {
  return createError('GUIF-E-COMPONENT-INVALID', `[panel/primitives] ${message}`, details);
}

/**
 * 造一个**受限取用面**：只有 `PRIMITIVES_MEMBERS` 里的成员能被取出。
 * 种子缺席**不算错**：这是正常的降级路径，故只记账（`missing()`）不产出诊断码
 * —— 诊断码只能取冻结集合里的码，给「降级」硬套一个语义不符的码反而会污染上报链路。
 * @param {object|undefined|null} seed `env.seeds.primitives`（缺席时所有 `get()` 返回 undefined）
 * @returns {{get:(name:string)=>unknown, has:(name:string)=>boolean, missing:()=>string[], used:readonly string[]}}
 */
export function createPrimitivesSeat(seed) {
  const bag = seed !== null && typeof seed === 'object' ? seed : null;
  const missing = [];
  const absent = bag === null;
  const record = (name) => {
    if (!missing.includes(name)) missing.push(name);
  };
  return {
    used: PRIMITIVES_USED,
    has(name) {
      if (!PRIMITIVES_MEMBERS.includes(name)) {
        throw primitivesError(`primitives 成员「${name}」不在官方 50 个包真实用过的 180 个成员里（未覆盖成员不得使用）`, { name });
      }
      return bag !== null && bag[name] !== undefined;
    },
    get(name) {
      if (!PRIMITIVES_MEMBERS.includes(name)) {
        throw primitivesError(`primitives 成员「${name}」不在官方 50 个包真实用过的 180 个成员里（未覆盖成员不得使用）`, { name });
      }
      const value = bag === null ? undefined : bag[name];
      if (value === undefined) record(name);
      return value;
    },
    missing() {
      return [...missing];
    },
    /** 种子整体缺席（组件层据此走自研兜底；语义比 `missing()` 更粗）。 */
    absent() {
      return absent;
    },
  };
}
