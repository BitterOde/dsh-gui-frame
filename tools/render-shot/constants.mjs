// tools/render-shot/constants.mjs —— 由 args.mjs 下沉出来的**共享叶**
// 为什么单独一个文件：args.mjs 要 isHttpUrl（在 inputs.mjs）、inputs.mjs 要这里的两个名字 ——
// 两边互相 import 就是模块环（由自检的环检查把关）。共享物下沉到叶之后，两侧都只依赖它。
// 口径：下面两块声明**逐字**来自 args.mjs（原文的注释一起搬），只是搬了家。

/**
 * **活体 GUI 端口**：用户正在用的 DSH Web（用户级硬约束：绝不碰）。
 * 本工具只对**独立端口实例**出图；撞上它一律按用法错误拦下，且**没有绕过开关**。
 */
export const LIVE_GUI_PORT = 3080;

/** 用法/参数错误（退出码 2；与运行期失败区分，便于脚本判断"我传错了"还是"环境不对"）。 */
export class UsageError extends Error {}
