// tools/render-shot/asserts.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 三条硬失败的断言（等锚点 / 裁剪外框 / 点击点）

import { UsageError } from './constants.mjs';

export function assertAnchorFound(probe, selector, waitedMs) {
  if (probe === null || typeof probe !== 'object') throw new Error(`等锚点失败：页面没有回读数（${selector}）`);
  if (typeof probe.error === 'string') throw new UsageError(`--wait-for 不是合法的 CSS 选择器：${probe.error}`);
  if (!(probe.count > 0)) {
    throw new Error(
      `等锚点超时（${waitedMs}ms）：选择器 ${selector} 始终没有命中任何元素 —— 不截图（免得出一张空图当成功）`,
    );
  }
  return probe.count;
}

/** 按选择器裁剪：元素必须在场且可见；0 尺寸＝不可见，同样报错而不是截一张空图。 */
export function assertElementRect(probe, selector) {
  if (probe === null || typeof probe !== 'object') throw new Error(`量元素失败：页面没有回读数（${selector}）`);
  if (typeof probe.error === 'string') throw new UsageError(`--selector 不是合法的 CSS 选择器：${probe.error}`);
  if (probe.found !== true) throw new Error(`找不到要裁剪的元素：${selector}（不截图）`);
  const rect = probe.rect;
  if (rect === undefined || !(rect.width > 0) || !(rect.height > 0)) {
    throw new Error(`要裁剪的元素尺寸为 0（不可见）：${selector}（不截图）`);
  }
  // 取整：让"请求的裁剪框"与"产物的像素宽高"能逐个数字对上（容差见 assertPngSize）。
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    tag: probe.tag ?? null,
  };
}

/** 点击目标必须在场且可见；否则报错（静默跳过点击 ⇒ 后面等锚点超时，错误信息会指错方向）。 */
export function assertClickPoint(probe, selector) {
  if (probe === null || typeof probe !== 'object') throw new Error(`取点击落点失败：页面没有回读数（${selector}）`);
  if (typeof probe.error === 'string') throw new UsageError(`--click 不是合法的 CSS 选择器：${probe.error}`);
  if (probe.found !== true) throw new Error(`找不到要点击的元素：${selector}（不截图）`);
  if (probe.zeroSize === true) throw new Error(`要点击的元素尺寸为 0（不可见）：${selector}（不截图）`);
  return probe;
}


/**
 * 页面级命令计划（attach 之后、量高度之前的那一段）。
 * 顺序即语义：**先定视口再导航** —— 反过来的话页面会按默认视口（800×600）先布局一次，
 * 响应式断点与 vh 单位都会拿错，截出来的图与"按目标尺寸打开"不一致。
 */
