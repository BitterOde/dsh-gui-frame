// tools/render-shot.selftest/kit.mjs —— 由 render-shot.selftest.mjs 按职责拆分（块级逐字搬运，未改写实现）
// 自检骨架：计数器、断言、check/checkAsync/skip、去注释工具

export let passed = 0;
export let failed = 0;
export let skipped = 0;
export const failures = [];

/** 判据失败即抛；由 `check()` 收口成 PASS/FAIL 一行。 */
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 断言某段代码必须抛错，且消息里含 `needle`（"报错"本身也要有正确的原因）。 */
export function assertThrows(fn, needle, label) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown !== null, `${label}：本应报错却通过了`);
  assert(
    String(thrown.message).includes(needle),
    `${label}：报错原因不对，期望含「${needle}」，实得「${thrown.message}」`,
  );
  return thrown;
}
export function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[selftest] PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name} —— ${error?.message ?? error}`);
    console.log(`[selftest] FAIL ${name} —— ${error?.message ?? error}`);
  }
}
export async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`[selftest] PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name} —— ${error?.message ?? error}`);
    console.log(`[selftest] FAIL ${name} —— ${error?.message ?? error}`);
  }
}
export function skip(name, reason) {
  skipped += 1;
  console.log(`[selftest] SKIP ${name} —— ${reason}`);
}

/** 去掉注释后的源码：静态纪律必须对"真代码"下判据，注释里提到某词不算数。 */
export function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([;,{(\[])\s*\/\/.*$/gm, '$1');
}

// ── A. 参数解析 ────────────────────────────────────────────────────────────────
