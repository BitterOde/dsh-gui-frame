/**
 * fixtures/cycle/entry.mjs —— 越界点：**模块环**（entry → a → b → a）。
 * 期望：排序期失败，stderr 含「模块循环依赖」，不落产物。
 */
import { a } from './a.mjs';

export function createClientModule() {
  return { apply: a, inject: [] };
}
