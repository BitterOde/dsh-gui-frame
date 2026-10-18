/** fixtures/cycle/a.mjs —— 环的一半（a → b）。 */
import { b } from './b.mjs';

export function a() {
  return b;
}
