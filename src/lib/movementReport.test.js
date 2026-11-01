import { describe, it, expect } from 'vitest';
import { applyEdits, pdfRequest, isEdited, editedRow, countRows, stamp, isMoving, editCounts } from './movementReport';

const row = (vehicleId, state, extra = {}) => ({
  vehicleId, plate: vehicleId, grouping: `CPO - Menengai - ${vehicleId}`, lastAt: 1_762_000_000_000,
  lat: -1, lng: 37, location: 'Mombasa Road', speedKmh: 50, state, kmToMorl: 10, closerKm: 2, stale: false, ...extra,
});
const report = {
  organisation: 'Menengai Oil Refineries Ltd', orgCode: 'MENENGAI', hours: 2, from: 1, to: 2, morl: 'MORL',
  groups: [
    { name: 'CPO - Menengai', rows: [row('A', 'to'), row('B', 'from'), row('C', 'stopped', { stale: true })] },
    { name: 'FG - Menengai', rows: [row('D', 'moving')] },
  ],
};

describe('editing the CPO movements report before the PDF', () => {
  it('leaves the report as the server sent it when nothing is edited', () => {
    const out = applyEdits(report, {});
    expect(out.groups).toEqual(report.groups);
    expect(out.counts).toMatchObject({ total: 4, to: 1, from: 1, stopped: 1, moving: 1, stale: 1 });
  });

  it('applies a new location and direction, and counts again', () => {
    const out = applyEdits(report, { C: { state: 'to', location: '  Naivasha weighbridge ' } });
    const c = out.groups[0].rows[2];
    expect(c).toMatchObject({ state: 'to', location: 'Naivasha weighbridge' });
    expect(out.counts).toMatchObject({ to: 2, stopped: 0 });
    expect(report.groups[0].rows[2].state).toBe('stopped');
  });

  it('drops the rows left out, and a group with none left', () => {
    const out = applyEdits(report, { D: { removed: true }, B: { removed: true } });
    expect(out.groups.map((g) => g.name)).toEqual(['CPO - Menengai']);
    expect(out.groups[0].rows.map((r) => r.vehicleId)).toEqual(['A', 'C']);
    expect(out.counts.total).toBe(2);
  });

  it('treats a cleared location as none, so the PDF shows a dash', () => {
    expect(editedRow(row('A', 'to'), { location: '   ' }).location).toBeNull();
  });

  it('knows an edit that changes nothing is not an edit', () => {
    const a = row('A', 'to');
    expect(isEdited(a, { location: 'Mombasa Road', state: 'to' })).toBe(false);
    expect(isEdited(a, { state: 'from' })).toBe(true);
    expect(isEdited(a, { removed: true })).toBe(true);
    expect(isEdited(a, undefined)).toBe(false);
  });

  it('sends the server only what it draws from, and how much was edited', () => {
    expect(Object.keys(pdfRequest(report, {})).sort()).toEqual(['edits', 'from', 'groups', 'hours', 'morl', 'to']);
    expect(pdfRequest(report, {}).edits).toEqual({ changed: 0, removed: 0 });
  });

  it('counts a row left out once, as left out, even if it was changed first', () => {
    const edits = { A: { location: 'Somewhere else' }, B: { state: 'from' }, C: { state: 'to', removed: true }, D: { removed: true } };
    expect(editCounts(report, edits)).toEqual({ changed: 1, removed: 2 });
  });

  it('counts as the server does', () => {
    expect(countRows([])).toMatchObject({ total: 0 });
  });

  it('writes the time as the sheet does, in Nairobi time', () => {
    expect(stamp(Date.UTC(2025, 5, 18, 4, 56, 26))).toBe('18.06.2025 07:56:26');
    expect(stamp(null)).toBe('No fix');
  });

  it('reads a unit as moving at 5 km/h or more on a fix inside the window, so its location shows green', () => {
    expect(isMoving(row('A', 'to', { speedKmh: 5 }))).toBe(true);
    expect(isMoving(row('A', 'stopped', { speedKmh: 4 }))).toBe(false);
    expect(isMoving(row('A', 'to', { speedKmh: 60, stale: true }))).toBe(false);
    expect(isMoving(row('A', 'no-fix', { speedKmh: null, lastAt: null }))).toBe(false);
  });

  it('follows a corrected direction: a unit set to Stopped is not green', () => {
    expect(isMoving(row('A', 'stopped', { speedKmh: 60 }))).toBe(false);
    expect(isMoving(row('A', 'moving', { speedKmh: 60 }))).toBe(true);
  });
});
