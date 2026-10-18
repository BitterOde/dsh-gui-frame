/**
 * fixtures/export-braces/entry.mjs —— 越界点：**export 变体 `export { … }`**。
 * 期望：构建期失败，stderr 含「不支持 export { … }」，不落产物。
 */
function createClientModule() {
  return { apply() {}, inject: [] };
}

export { createClientModule };
