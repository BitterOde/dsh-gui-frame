// tools/render-shot/png.mjs —— 由 render-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// PNG 魔数与 IHDR 尺寸核对（"有图、内容不对"的守门）

export function isPng(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

/** 截图字节的"空/坏"判据：CDP 偶尔回 `{}`，写出去就是一个 0 字节文件 —— 必须当失败报。 */
export function assertScreenshotBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('截图返回空（CDP 没有回传 PNG 数据）');
  if (!isPng(buffer)) throw new Error(`截图数据不是 PNG（前 8 字节：${buffer.subarray(0, 8).toString('hex')}）`);
  return buffer;
}

/**
 * 解析 PNG 的 IHDR 宽高（零依赖：PNG 头是固定布局）。
 * 8 字节签名 + 4 字节块长 + 4 字节 `IHDR` + 4 字节宽 + 4 字节高 ⇒ 24 字节足够。
 * @returns {{width:number, height:number}|null} 不是 PNG / 缺 IHDR ⇒ null
 */
export function parsePngSize(buffer) {
  if (!isPng(buffer) || !Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * 产物尺寸自校验：**"有图、魔数对、内容不对"是最难发现的假绿**，所以这里必须核对像素宽高。
 * 期望值来自请求本身（视口尺寸 / 整页高度 / 元素外框），容差默认 1px ——
 * 只给 CDP 的 clip 像素取整留一格，抓得住"整屏截图""裁剪被忽略""拍成空图"这类量级错误。
 */
export function assertPngSize(buffer, expected, tolerance = 1) {
  const size = parsePngSize(buffer);
  if (size === null) throw new Error('产物不是可解析的 PNG（缺 IHDR 头），没法核对尺寸');
  for (const key of ['width', 'height']) {
    const want = expected?.[key];
    if (typeof want !== 'number' || !Number.isFinite(want)) continue;
    const delta = Math.abs(size[key] - want);
    if (delta > tolerance) {
      throw new Error(
        `产物尺寸不符：期望 ${expected.width}×${expected.height}，实得 ${size.width}×${size.height}` +
          `（${key} 差 ${delta}px，超过容差 ${tolerance}px）`,
      );
    }
  }
  return size;
}


// ── CDP 客户端（薄薄一层：Promise 化的 send + 按 session 过滤的事件）────────────

/** 一个 CDP 连接（浏览器级 WebSocket；页面命令靠 `sessionId` 顶到顶层字段）。 */
