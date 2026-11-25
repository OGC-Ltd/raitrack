// A long table drawn a batch of rows at a time (operator, 25 Nov 2026: "the
// UI must never freeze while a report is being built"). Mounting all 634 rows
// of a fleet's report at once held the page for 200 ms and more; the first
// batch is drawn at once, the rest a batch a turn, so the page answers
// between them. Exports read the report's rows, not the table, so they are
// whole from the start.

import { useEffect, useState } from 'react';

export const DRAW_STEP = 80;

/**
 * How many rows may be drawn so far. `key` is what makes it a new table (a new
 * run): drawing starts over from the first batch only then, never on a
 * refresh of the same table.
 * A timer, not requestAnimationFrame: a hidden tab never runs the latter, and
 * the table would stay cut short.
 */
export function useDrawnRows(total, key, step = DRAW_STEP) {
  const [state, setState] = useState({ key, n: step });
  const n = state.key === key ? state.n : step;
  if (state.key !== key) setState({ key, n: step });
  useEffect(() => {
    if (n >= total) return undefined;
    const id = setTimeout(() => setState((s) => (s.key === key ? { key, n: s.n + step } : s)), 0);
    return () => clearTimeout(id);
  }, [n, total, key, step]);
  return n;
}
