/**
 * geometry-fixture.mjs —— **verify 夹具自备的几何件**（v1.0 校准轮新增）。
 *
 * 为什么单独成文件：① `verify/lib/harness.mjs` 是「非 src 面 ≤600 行」判据的当事人，
 * 把 20 行几何件放进去会让它 605 行超限；② 夹具自足（不借 `src/**`）本来就是这套装置的纪律。
 * 数值与 dockkit 的 FLOAT_MIN_SIZE / FLOAT_DEFAULT_SIZE / DRAG_THRESHOLD 逐字一致；
 * 夹具自备一份是为了**不反向 import `src/**`**（装置自足的纪律，见 `tests/unit/service-cleanup.test.mjs`）。
 */
export const FLOAT_MIN_SIZE = Object.freeze({ width: 220, height: 140 });
export const FLOAT_DEFAULT_SIZE = Object.freeze({ width: 380, height: 300 });
export const DRAG_THRESHOLD = 4;
const GRAB_OFFSET_X = 60;
const GRAB_OFFSET_Y = 14;
export function passedThreshold(startX, startY, x, y) {
  return Math.abs(x - startX) >= DRAG_THRESHOLD || Math.abs(y - startY) >= DRAG_THRESHOLD;
}
export function movedRect(rect, dx, dy) {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}
export function resizedRect(rect, dx, dy, minSize = FLOAT_MIN_SIZE) {
  return { ...rect, width: Math.max(minSize.width, rect.width + dx), height: Math.max(minSize.height, rect.height + dy) };
}
export function floatRectAt(px, py, size = FLOAT_DEFAULT_SIZE) {
  return { x: Math.max(0, px - GRAB_OFFSET_X), y: Math.max(0, py - GRAB_OFFSET_Y), width: size.width, height: size.height };
}
