// lib/judge/base.mjs —— 由 judge.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 共用叶：等待原语与本包 id 前缀

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 本包入口 id 的前缀（＝ `src/client/contracts/service-face.mjs` 的 `OWN_ID_PREFIX`）：判「侧栏只留一条」的读数口径。 */
export const OWN_ID_PREFIX = 'dsh-gui-frame/';
export const OWN_PREFIX_LITERAL = JSON.stringify(OWN_ID_PREFIX);

/** 页面快照表达式（一次取回所有判据要读的东西）。 */
