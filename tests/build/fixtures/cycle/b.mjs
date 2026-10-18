/** fixtures/cycle/b.mjs —— 环的另一半（b → a）。 */
import { a } from './a.mjs';

export function b() {
  return a;
}
