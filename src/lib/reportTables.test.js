import { describe, it, expect } from 'vitest';
import { REPORTS, isFigure, movingRange, noDispatchDriver, csvTable, shownColumns } from './reportTables';

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

describe('driver conduct: incidents with no driver on record', () => {
  const def = REPORTS.behaviour;
  const driverAt = def.columns().indexOf('Driver');
  const row = (driver, total = 3) => ({ unit: { key: 'KDX 131Y', plate: 'KDX 131Y', type: 'Truck' }, driver,
    accel: total, brake: 0, corner: 0, seatbelt: 0, phone: 0, covered: 0, total, dashcam: true });

  it('leaves the Driver cell blank: the reason is in the key, not on every row', () => {
    expect(def.cells(row(null))[driverAt]).toBe('');
    expect(def.cells(row(''))[driverAt]).toBe('');
    expect(def.cells(row('Osero'))[driverAt]).toBe('Osero');
  });

  it('keeps the Driver column when every vehicle with incidents has no driver', () => {
    expect(shownColumns(def, [row(null)], {}).map((i) => def.columns()[i])).toContain('Driver');
    // No incidents and no driver: nothing to shade, so the empty column goes as before
    expect(shownColumns(def, [row(null, 0)], {}).map((i) => def.columns()[i])).not.toContain('Driver');
  });

  it('marks only rows that have incidents and no driver', () => {
    expect(noDispatchDriver(row(null))).toBe(true);
    expect(noDispatchDriver(row('Unknown'))).toBe(true);
    expect(noDispatchDriver(row('Osero'))).toBe(false);
    // An operator entry that is not counted leaves a row with no incidents: not marked
    expect(noDispatchDriver(row(null, 0))).toBe(false);
  });

  it('leaves the cell empty in the CSV too, keeping the Driver column', () => {
    const t = csvTable(def, [{ name: null, rows: [row(null), row('Osero')] }], {});
    const at = t.head.indexOf('Driver');
    expect(at).toBeGreaterThan(-1);
    expect(t.body.map((b) => b[at])).toEqual(['', 'Osero']);
  });
});
