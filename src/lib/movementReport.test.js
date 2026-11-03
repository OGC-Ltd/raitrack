import { describe, it, expect } from 'vitest';
import { applyEdits, pdfRequest, pdfRequests, splitsByType, byFleetList, NOT_ON_LIST, directionWords, statesFor, isEdited, editedRow, countRows, stamp, isMoving, editCounts, locationChanged, isLoading, movementWindows, windowsProblem, vehicleTypes, defaultTypes, onlyTypes } from './movementReport';

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

describe('editing the Movements report before the PDF', () => {
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

  it('does not count spaces at the ends of a location as a change, on the table or in the count', () => {
    const a = row('A', 'to');
    expect(locationChanged(a, 'Mombasa Road  ')).toBe(false);
    expect(isEdited(a, { location: ' Mombasa Road ' })).toBe(false);
    expect(locationChanged(a, 'Mombasa Rd')).toBe(true);
    expect(locationChanged(row('A', 'to', { location: null }), '   ')).toBe(false);
  });

  it('knows an edit that changes nothing is not an edit', () => {
    const a = row('A', 'to');
    expect(isEdited(a, { location: 'Mombasa Road', state: 'to' })).toBe(false);
    expect(isEdited(a, { state: 'from' })).toBe(true);
    expect(isEdited(a, { removed: true })).toBe(true);
    expect(isEdited(a, undefined)).toBe(false);
  });

  it('sends the server only what it draws from, and how much was edited', () => {
    expect(Object.keys(pdfRequest(report, {})).sort()).toEqual(['edits', 'from', 'groups', 'hours', 'morl', 'site', 'to']);
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
    expect(stamp(null)).toBe('-');
    expect(directionWords('MORL')['no-fix']).toBe('At RAIMDF');
    expect(directionWords('Sukari')['no-fix']).toBe('Not reporting');
  });

  it('offers neither Moving nor No fix in the dropdown, except on a row already in it', () => {
    expect(statesFor(row('A', 'to'))).toEqual(['to', 'from', 'at', 'stopped']);
    expect(statesFor(row('A', 'moving'))).toContain('moving');
    expect(directionWords('MORL').moving).toBe('-');
  });

  it('reads a unit as moving at 5 km/h or more on a fix inside the window, so its location shows green', () => {
    expect(isMoving(row('A', 'to', { speedKmh: 5 }))).toBe(true);
    expect(isMoving(row('A', 'stopped', { speedKmh: 4 }))).toBe(false);
    expect(isMoving(row('A', 'to', { speedKmh: 60, stale: true }))).toBe(false);
    expect(isMoving(row('A', 'no-fix', { speedKmh: null, lastAt: null }))).toBe(false);
  });

  it('reads a unit within 1 km of the Mombasa loading point as loading, so its location shows orange', () => {
    expect(isLoading(row('A', 'stopped', { lat: -4.04579, lng: 39.65165 }))).toBe(true);
    expect(isLoading(row('A', 'stopped', { lat: -4.0535, lng: 39.65165 }))).toBe(true);   // ~860 m south
    expect(isLoading(row('A', 'stopped', { lat: -4.0558, lng: 39.65165 }))).toBe(false);  // ~1.1 km south
    expect(isLoading(row('A', 'stopped', { lat: -4.04579, lng: 39.65165, stale: true }))).toBe(false);
    expect(isLoading(row('A', 'no-fix', { lat: null, lng: null, lastAt: null }))).toBe(false);
  });

  it('follows a corrected direction: a unit set to Stopped is not green', () => {
    expect(isMoving(row('A', 'stopped', { speedKmh: 60 }))).toBe(false);
    expect(isMoving(row('A', 'moving', { speedKmh: 60 }))).toBe(true);
  });
});

describe('the windows and vehicle types of the Movements report', () => {
  const at = (iso) => Date.parse(`${iso}+03:00`);
  const now = at('2026-11-02T10:30:00');

  it('opens on the last hour up to now', () => {
    expect(movementWindows({ mode: 'last', hours: 1 }, now)).toEqual([{ from: now - 3_600_000, to: now }]);
  });

  it('runs the same hours on every day of a range, stopping at now, leaving out what has not begun', () => {
    const w = movementWindows({ mode: 'days', fromDay: '2026-10-31', toDay: '2026-11-02', start: 7, end: 20 }, now);
    expect(w).toEqual([
      { from: at('2026-10-31T07:00:00'), to: at('2026-10-31T20:00:00') },
      { from: at('2026-11-01T07:00:00'), to: at('2026-11-01T20:00:00') },
      { from: at('2026-11-02T07:00:00'), to: now },
    ]);
    expect(movementWindows({ mode: 'days', fromDay: '2026-11-02', toDay: '2026-11-02', start: 11, end: 12 }, now)).toEqual([]);
  });

  it('runs past midnight when the hours end at or before they start', () => {
    expect(movementWindows({ mode: 'days', fromDay: '2026-10-31', toDay: '2026-10-31', start: 20, end: 6 }, now))
      .toEqual([{ from: at('2026-10-31T20:00:00'), to: at('2026-11-01T06:00:00') }]);
  });

  it('says why a choice cannot run', () => {
    const sel = { mode: 'days', fromDay: '2026-10-25', toDay: '2026-11-02', start: 7, end: 8 };
    expect(windowsProblem(sel, now)).toBe('7 days at most');
    expect(windowsProblem({ ...sel, fromDay: '2026-11-03', toDay: '2026-11-02' }, now)).toBe('The last day is before the first');
    expect(windowsProblem({ ...sel, fromDay: '2026-11-01', start: 7, end: 7 }, now)).toBe('The hours start and end at the same time');
    expect(windowsProblem({ ...sel, fromDay: '2026-11-01', start: 0, end: 24 }, now)).toBeNull();
    expect(windowsProblem({ ...sel, fromDay: '2026-11-02', start: 11, end: 12 }, now)).toBe('These hours have not begun yet');
  });

  it('lists the vehicle types CPO first, opens on CPO, and keeps only the picked ones', () => {
    const r = { ...report, groups: [{ name: 'FG - Menengai', rows: [row('F', 'to')] }, ...report.groups] };
    const types = vehicleTypes([r]);
    expect(types).toEqual(['CPO - Menengai', 'FG - Menengai']);
    expect(defaultTypes(types)).toEqual(['CPO - Menengai']);
    expect(defaultTypes(['FG - Menengai'])).toEqual(['FG - Menengai']);
    const cpo = onlyTypes(r, ['CPO - Menengai']);
    expect(cpo.groups.map((g) => g.name)).toEqual(['CPO - Menengai']);
    expect(cpo.counts.total).toBe(3);
  });
});

describe('the PDF outside Menengai: a report a vehicle type', () => {
  const row = (id) => ({ vehicleId: id, plate: id, grouping: id, lastAt: 1, lat: -1, lng: 36, location: 'Road', speedKmh: 0, state: 'stopped', kmToMorl: null, closerKm: null, stale: false });
  const day = (orgCode) => ({
    orgCode, hours: 1, from: 0, to: 3_600_000, morl: null,
    groups: [{ name: 'Trucks', rows: [row('T1'), row('T2')] }, { name: 'Tractors', rows: [row('R1')] }, { name: 'Other', rows: [row('O1')] }],
  });

  it('splits by type for every organisation but Menengai', () => {
    expect(splitsByType(day('SUKARI'))).toBe(true);
    expect(splitsByType(day('MENENGAI'))).toBe(false);
    expect(pdfRequests([day('MENENGAI')], [{}], ['Trucks', 'Tractors', 'Other'])).toHaveLength(1);
    const each = pdfRequests([day('SUKARI')], [{}], ['Trucks', 'Tractors', 'Other']);
    expect(each.map((q) => q.groups.map((g) => g.name))).toEqual([['Trucks'], ['Tractors'], ['Other']]);
  });

  it('takes only the types picked, a type a day, and none emptied by leaving its units out', () => {
    const each = pdfRequests([day('SUKARI'), day('SUKARI')], [{ R1: { removed: true } }, {}], ['Trucks', 'Tractors']);
    expect(each.map((q) => q.groups[0].name)).toEqual(['Trucks', 'Trucks', 'Tractors']);
  });
});

describe('Menengai by its fleet list', () => {
  const r = (plate, state = 'stopped', name = `CPO - Menengai - ${plate}`) => ({ vehicleId: plate.replace(/\s/g, ''), plate, grouping: name, lastAt: 1, lat: -1, lng: 36, location: 'x', speedKmh: 0, state, kmToMorl: null, closerKm: null, stale: false });
  const list = [
    { name: 'Tankers', units: [['KCK 345G', 'Tanker', 1], ['KCH 012A', 'Tanker', 1]] },
    { name: 'Finished Goods', units: [['KBT 114R', 'FG', 1]] },
    { name: 'RAI MDF Equipment', units: [['FL 01', 'Forklift', 0]] },
  ];
  const report = { orgCode: 'MENENGAI', site: 'MORL', groups: [
    { name: 'CPO - Menengai', rows: [r('KCK 345G', 'at'), r('KCH 012A', 'to')] },
    { name: 'FG - Menengai', rows: [r('KBT 114R'), r('KXX 999Z')] },
    { name: 'RAIMDF', rows: [r('RAIMDF - FL 01', 'stopped', 'RAIMDF - FL 01')] },
  ] };

  it('groups the units as the list does, in its order, the rest last', () => {
    const out = byFleetList(report, list);
    expect(out.groups.map((g) => g.name)).toEqual(['Tankers', 'Finished Goods', 'RAI MDF Equipment', NOT_ON_LIST]);
    expect(out.groups[0].rows.map((x) => x.plate)).toEqual(['KCH 012A', 'KCK 345G']);   // heading to MORL first
    expect(out.groups[3].rows.map((x) => x.plate)).toEqual(['KXX 999Z']);
    expect(vehicleTypes([out])).toEqual(['Tankers', 'Finished Goods', 'RAI MDF Equipment', NOT_ON_LIST]);
    expect(defaultTypes(vehicleTypes([out]))).toEqual(['Tankers']);
  });

  it('reads directions against the site of the report', () => {
    expect(directionWords('Sukari')).toMatchObject({ to: 'To Sukari', at: 'At Sukari' });
    expect(pdfRequest({ ...report, groups: [] }, {}).site).toBe('MORL');
  });
});
