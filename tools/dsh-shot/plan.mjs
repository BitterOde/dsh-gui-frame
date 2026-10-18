// tools/dsh-shot/plan.mjs —— 由 dsh-shot.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 执行计划（dry-run 的可见内容）

import { DEFAULT_MIN_FREE_MB, GUI_FRAME_ENTRY_ID } from './env.mjs';

export function buildPlan(options, { entry, profile, port, linkSpec, outPath, memory = null }) {
  return {
    profile,
    entry,
    port,
    linkSpec,
    outPath: outPath ?? '(未指定 --out)',
    memory,
    steps: [
      `⓪ 内存硬闸（起任何进程之前）：空闲物理内存 ≥ ${options.minFreeMb ?? DEFAULT_MIN_FREE_MB} MB，否则 fail-closed（不写 PNG、不起实例、不起浏览器）`,
      `① 记录 3080 的监听 PID（只读；收尾必须不变）`,
      `② 从出厂模板建临时 profile：node <dsh bin.js> --profile ${profile} --from-default-profile web --dump-config`,
      `③ 装本包：node <dsh bin.js> plugin --profile ${profile} add ${linkSpec}`,
      `④ 前置闸：--dump-config 里 loader entry \`${GUI_FRAME_ENTRY_ID}\` 必须恰 1 次`,
      `⑤ 起独立端口实例：node <dsh bin.js> --profile ${profile} --port ${port} --no-open（headless，不碰 3080）`,
      `⑥ 从启动日志取带 token 的 URL`,
      `⑦ 出图（headless Edge + CDP）：等锚点 ${options.waitFor ?? '（无）'}` +
        `${options.click === null ? '' : ` → 点击 ${options.click}（via ${options.clickVia}，index ${options.clickIndex}）`}` +
        `${options.selector === null ? ' → 截整视口' : ` → 裁剪 ${options.selector}`} ⇒ ${outPath}`,
      `⑧ 收尾：按 pid 回收实例并确认端口释放；核对 3080 PID 未变；${options.keep ? '**保留**临时 profile（--keep）' : `删掉临时 profile ${profile}`}`,
    ],
  };
}

/**
 * 本模块所有"与外部世界打交道"的入口，收成一份**可注入**的依赖表。
 *
 * 为什么要这样：内存闸这类"资源纪律"只有能在**不真吃内存、不起进程**的前提下做负控，才算有牙。
 * 注入面只覆盖「起进程 / 读内存 / 写输出」这几件事，业务逻辑一行不动。
 */
