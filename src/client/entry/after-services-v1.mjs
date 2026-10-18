/**
 * after-services-v1.mjs —— **平台服务补装 + 收尾**段。
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 【为什么需要这一段】
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 坞（能力①）依赖平台服务 `slots`，而兄弟插件提供它的时机**晚于**本插件 `apply`（真机实测
 * ~3s 内到齐）。没有这段补装窗口，坞在第一遍装配时只会拿到「slots 缺席 ⇒ 不激活」，之后再无机会
 * —— 页面正常但坞永不出现（静默零注册）。
 *
 * 【补装窗口就是本段的全部内容】
 *   - 它只在窗口内有界轮询「依赖的平台服务到齐了没有」，到点即停、不再重试；
 *   - `restore` 交回的仍是**同一个 promise**（`retryDone`）：「补装完成」就是收尾完成，
 *     汇合点与测试照旧 `await restore` 即可，不需要为一件事造两个名字。
 *
 * 本文件**不改 `env`**：追加键只允许出现在调用点。
 */

/**
 * 造「补装 + 收尾」段。
 *
 * @param {{ctx:object, env:object, handles:Map, runStep:Function, probeService:Function,
 *          report:Function, degradeEvent:Function, reporter:object,
 *          CAPABILITY_ORDER:Array, CAPABILITY_SERVICE_DEPENDENCY:object,
 *          SERVICES_READY_TIMEOUT_MS:number, SERVICES_READY_INTERVAL_MS:number}} deps
 * @returns {{retryDone:Promise<unknown>, restore:Promise<unknown>}}
 */
export function createAfterServices(deps) {
  const {
    ctx, env, handles, runStep, probeService, report, degradeEvent, reporter,
    CAPABILITY_ORDER, CAPABILITY_SERVICE_DEPENDENCY, SERVICES_READY_TIMEOUT_MS, SERVICES_READY_INTERVAL_MS,
  } = deps;

  // ⑤b **平台服务补装**：某能力因缺平台服务未激活 ⇒ 在窗口内等服务到齐后**补装一次**（超时即放弃）
  const retryDone = new Promise((resolve) => {
    const startedAt = Date.now();
    const pendingService = () => CAPABILITY_ORDER.filter((step) => {
      const serviceName = CAPABILITY_SERVICE_DEPENDENCY[step.capability];
      if (serviceName === undefined || serviceName === null) return false;
      const row = handles.get(step.capability);
      if (row === undefined || row === null || row.installed !== false) return false;
      const probe = probeService(ctx, serviceName);
      return probe === null || probe === undefined;
    });
    const tick = () => {
      const pending = pendingService();
      if (pending.length > 0) {
        for (const step of pending) {
          try {
            runStep(step);
            report(degradeEvent(step.capability, `平台服务 ${CAPABILITY_SERVICE_DEPENDENCY[step.capability]} 到齐 ⇒ 补装一次`, env.diagnostics));
          } catch (error) {
            report({ phase: 'install', message: `补装「${step.capability}」抛错：${error?.message ?? error}`, error, details: { capability: step.capability } });
          }
        }
      }
      if (pendingService().length === 0 || Date.now() - startedAt >= SERVICES_READY_TIMEOUT_MS) { resolve(); return; }
      env.schedule(tick, SERVICES_READY_INTERVAL_MS);
    };
    env.schedule(tick, SERVICES_READY_INTERVAL_MS);
  });

  return { retryDone, restore: retryDone };
}
