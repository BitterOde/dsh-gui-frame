/**
 * fixtures/export-class/entry.mjs —— 越界点：**export 变体 `export class`**。
 * 期望：构建期失败，stderr 含「不支持 export class」，不落产物。
 */
export class ClientModule {
  apply() {}
}
