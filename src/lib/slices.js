// Long work done in slices, so the page keeps answering while a report is
// made (operator, 25 Nov 2026: "the UI must never freeze while a report is
// being built"). A loop over thousands of units or millions of readings is
// run a few milliseconds at a time; between slices the browser paints,
// scrolls and takes clicks, and a Cancel can stop the work.
//
//   const slice = slicer({ signal });
//   for (const v of vehicles) { await slice(); …work on v… }
//
// `slice()` costs nothing until the slice's time is spent, so it can sit in a
// tight loop. Pure apart from the timers: it runs in tests and in workers.

/** How long one slice may run: well under the 50 ms a browser calls a long task. */
export const SLICE_MS = 12;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Hands the thread back to the browser for one turn: a paint, input, timers.
 * scheduler.yield where there is one (it keeps this work's place in line),
 * else a message (no 4 ms clamp, as setTimeout has once nested), else a timer.
 */
export function nextTurn() {
  const s = typeof globalThis !== 'undefined' ? globalThis.scheduler : undefined;
  if (s && typeof s.yield === 'function') return s.yield();
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The error a cancelled run ends with: callers tell it apart by its name. */
export function cancelled() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}

export const isCancel = (err) => err?.name === 'AbortError';

/**
 * A slice-keeper. Each call returns at once while the slice has time left; once
 * it is spent the call waits a turn, then throws if `signal` was aborted.
 * @param {{ signal?: AbortSignal, budget?: number }} [o]
 * @returns {() => Promise<void> | undefined}
 */
export function slicer({ signal, budget = SLICE_MS } = {}) {
  let start = now();
  return () => {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (now() - start < budget) return undefined;
    return nextTurn().then(() => {
      if (signal?.aborted) throw cancelled();
      start = now();
    });
  };
}

/**
 * `fn` over every item, a slice at a time. Answers the results in order.
 * @template T, R
 * @param {Iterable<T>} items
 * @param {(item: T, i: number) => R} fn
 * @param {{ signal?: AbortSignal, budget?: number, onProgress?: (p: { done: number, total: number }) => void }} [o]
 * @returns {Promise<R[]>}
 */
export async function mapSliced(items, fn, { signal, budget, onProgress } = {}) {
  const list = Array.isArray(items) ? items : [...items];
  const slice = slicer({ signal, budget });
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const wait = slice();
    if (wait) { onProgress?.({ done: i, total: list.length }); await wait; }
    out[i] = fn(list[i], i);
  }
  onProgress?.({ done: list.length, total: list.length });
  return out;
}

/**
 * Appends `more` onto `into` without spreading it into arguments: a spread of
 * a day of readings (100,000+) overflows the stack and is slow besides.
 */
export function append(into, more) {
  for (let i = 0; i < more.length; i++) into.push(more[i]);
  return into;
}
