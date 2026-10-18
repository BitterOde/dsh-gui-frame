/**
 * fixtures/valid/entry.mjs —— 合法最小源码树（端到端 CLI 的**正对照**）。
 *
 * 期望：`node scripts/build-client.mjs` exit 0，写出 lib/client.js，
 * 产物能在「只有 window.__ModuleLoader__」的假环境里加载，`id === dsh-gui-frame`。
 */
export function createClientModule(seeds) {
  return {
    apply: function apply() {},
    inject: [],
    __internals: { seeds: Object.keys(seeds).sort() },
  };
}
