// tools/render-shot/report.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 结果呈现：人读摘要与 JSON 载荷

export function formatHumanSummary(result, write) {
  const size = result.size ?? { width: result.width, height: result.captureHeight };
  write(`[render-shot] ✔ 已写入 ${result.out}（${result.bytes} 字节，${size.width}×${size.height}）`);
  if (result.clip !== null && result.clip !== undefined) {
    write(
      `[render-shot] 裁剪自 ${result.clip.tag ?? '元素'} ${result.clip.width}×${result.clip.height} @ (${result.clip.x},${result.clip.y})`,
    );
  }
  if (result.fullPage) write(`[render-shot] 页面高度：${result.pageHeight} px`);
  write(`[render-shot] 耗时 ${result.elapsedMs} ms（浏览器 ${result.browser}）`);
}

/** `--json` 的形状（字段名固定：out / bytes / width / height / size / pageHeight / elapsedMs）。 */
export function toJsonResult(result) {
  return JSON.stringify(result);
}
