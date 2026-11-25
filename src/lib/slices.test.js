import { describe, it, expect } from 'vitest';
import { slicer, mapSliced, append, isCancel, nextTurn } from './slices';

describe('slices', () => {
  it('costs nothing while the slice has time left', () => {
    const slice = slicer({ budget: 1e9 });
    expect(slice()).toBeUndefined();
    expect(slice()).toBeUndefined();
  });

  it('waits a turn once the slice is spent', async () => {
    const slice = slicer({ budget: 0 });
    const wait = slice();
    expect(wait).toBeInstanceOf(Promise);
    await wait;
  });

  it('maps every item in order, handing back between slices', async () => {
    const seen = [];
    const out = await mapSliced([1, 2, 3, 4], (x, i) => x * 10 + i, { budget: 0, onProgress: (p) => seen.push(p.done) });
    expect(out).toEqual([10, 21, 32, 43]);
    expect(seen.at(-1)).toBe(4);
  });

  it('stops with an AbortError when cancelled', async () => {
    const ctl = new AbortController();
    const run = mapSliced([1, 2, 3], (x) => { if (x === 1) ctl.abort(); return x; }, { budget: 0, signal: ctl.signal });
    await expect(run).rejects.toSatisfy(isCancel);
  });

  it('appends a long list without spreading it into arguments', () => {
    const big = Array.from({ length: 300_000 }, (_, i) => i);
    const into = [1];
    append(into, big);
    expect(into.length).toBe(300_001);
    expect(into[300_000]).toBe(299_999);
  });

  it('gives the thread back', async () => {
    let ran = false;
    setTimeout(() => { ran = true; }, 0);
    await new Promise((r) => setTimeout(r, 5));
    await nextTurn();
    expect(ran).toBe(true);
  });
});
