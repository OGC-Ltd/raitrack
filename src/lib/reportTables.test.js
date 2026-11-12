import { describe, it, expect } from 'vitest';
import { REPORTS, isFigure, movingRange } from './reportTables';

const at = (s) => Date.parse(`${s}+03:00`);

describe('night report: Moving between', () => {
  it('reads as clock times over one night, across midnight', () => {
    expect(movingRange({ firstMovingAt: at('2026-10-31T23:30:00'), latestMovingAt: at('2026-11-01T02:10:00'), nights: 1, movingNights: 1 }))
      .toBe('23:30 – 02:10 Hrs');
  });

  it('gives one time when it moved at one reading only, and a dash when never', () => {
    const t = at('2026-10-31T22:47:00');
    expect(movingRange({ firstMovingAt: t, latestMovingAt: t, nights: 1, movingNights: 1 })).toBe('22:47 Hrs');
    expect(movingRange({ firstMovingAt: null, latestMovingAt: null, nights: 1 })).toBe('-');
  });

  it('dates the times over several nights, so a range never reads backwards', () => {
    expect(movingRange({ firstMovingAt: at('2026-10-31T23:30:00'), latestMovingAt: at('2026-11-02T22:10:00'), nights: 3, movingNights: 2 }))
      .toBe('31 Oct 23:30 – 2 Nov 22:10 Hrs, 2 nights');
    // Several nights in the period, movement in one: dated, no count
    expect(movingRange({ firstMovingAt: at('2026-11-01T01:00:00'), latestMovingAt: at('2026-11-01T01:40:00'), nights: 3, movingNights: 1 }))
      .toBe('1 Nov 01:00 – 1 Nov 01:40 Hrs');
  });

  it('is text, left-aligned; the figures before it stay right-aligned', () => {
    const def = REPORTS.night;
    const heads = def.columns();
    expect(heads.map((h, i) => isFigure(def, heads, i))).toEqual([false, false, true, true, false]);
  });
});
