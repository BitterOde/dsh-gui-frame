/**
 * fixtures/bare-package/entry.mjs —— 越界点：**裸包名 import**。
 *
 * 种子（react / @deepseek-ai/*）只能由入口 `createClientModule(__seeds)` 转交；
 * 模块自己 `import 'react'` 会让产物与外壳的种子表打架（双 React 的来源）。
 * 期望：构建期即失败，stderr 含「只支持相对 import」，不落产物。
 */
import { useState } from 'react';

export function createClientModule() {
  return { apply: useState, inject: [] };
}
