/**
 * fixtures/export-default/entry.mjs —— 越界点：**export 变体 `export default`**。
 * 期望：构建期失败，stderr 含「不支持 export default」，不落产物。
 */
export default function createClientModule() {
  return { apply() {}, inject: [] };
}
