/**
 * fixtures/too-deep/entry.mjs —— 越界点：**目录层数超限**（5 层 > 上限 4）。
 * 期望：构建期失败，stderr 含「目录深度超限」，不落产物。
 */
import { leaf } from './a/b/c/d/e/leaf.mjs';

export function createClientModule() {
  return { apply: leaf, inject: [] };
}
