import { describe, it, expect, beforeEach } from 'vitest';
import {
  casesFromRun, mergeCases, recordAction, isOverdue, needsEscalation, statusWord, periodCases,
  opensCase, incidentWords, importCases, exportCases, loadCases, saveCases,
} from './followUp';
import { scopeUnits } from './fleetGroups';
import { REPORTS } from './reportTables';
import { reportHtml } from './reportLetterhead';

const at = (s) => Date.parse(`${s}+03:00`);
const HOUR = 3600_000;

const vehicles = [
  { id: 'VS - KCS 082M', vehicleId: 'v1', regPlate: 'KCS 082M', driver: 'Osero Monari' },
  { id: 'CPO - KCN 901F', vehicleId: 'v2', driver: 'Simon Kitienya' },
];
const groups = [
  { name: 'Van Sales', units: [['KCS 082M', 'Hino', 1]] },
  { name: 'Tankers', units: [['KCN 901F', 'Tanker', 1]] },
];
const { units } = scopeUnits(vehicles, groups);
const ev = (vehicleId, ts, alertType = 'HARSH_ACCELERATION') => ({ vehicleId, alertType, ts: new Date(at(ts)).toISOString() });
const alarm = (vehicleId, ts, code) => ({ vehicleId, code, occurredMs: at(ts) });
const twoDays = { from: at('2026-11-01T00:00:00'), to: at('2026-11-03T00:00:00'), dashcams: true };

describe('which vehicle-days open a case', () => {
  it('any seen incident, or 5 harsh events, but not a faulty sensor', () => {
    expect(opensCase({ phone: 1 })).toBe(true);
    expect(opensCase({ accel: 3, brake: 1 })).toBe(false);
    expect(opensCase({ accel: 3, brake: 2 })).toBe(true);
    expect(opensCase({ accel: 300, suspect: true })).toBe(false);
    expect(opensCase({ seatbelt: 1, suspect: true })).toBe(true);
  });

  it('one case per vehicle per day, opened at its first incident', () => {
    const harsh = [1, 2, 3, 4, 5].map((m) => ev('v2', `2026-11-01T08:0${m}:00`));
    const found = casesFromRun(units, [...harsh, ev('v1', '2026-11-02T09:00:00')], [
      alarm('v1', '2026-11-01T10:00:00', 116), alarm('v1', '2026-11-01T11:00:00', 125),
      alarm('v1', '2026-11-02T10:00:00', 123),
    ], twoDays);
    expect(found.map((c) => `${c.plate} ${c.day}`).sort()).toEqual([
      'KCN 901F 2026-11-01', 'KCS 082M 2026-11-01', 'KCS 082M 2026-11-02',
    ]);
    expect(found.find((c) => c.id.endsWith('2026-11-01') && c.plate === 'KCS 082M')).toMatchObject({ phone: 1, seatbelt: 1, driver: 'Osero Monari', openedAt: at('2026-11-01T10:00:00') });
    expect(incidentWords(found.find((c) => c.day === '2026-11-02'))).toBe('1 camera covered, 1 harsh');
  });
});

describe('following up', () => {
  const base = casesFromRun(units, [], [alarm('v1', '2026-11-01T10:00:00', 116)], twoDays);

  it('a run keeps what operators recorded', () => {
    let list = mergeCases([], base);
    expect(list[0]).toMatchObject({ status: 'pending', action: null });
    list = recordAction(list, list[0].id, { action: 'Driver called', note: 'Called', by: 'Grace', at: at('2026-11-01T11:00:00') });
    const again = mergeCases(list, casesFromRun(units, [], [
      alarm('v1', '2026-11-01T10:00:00', 116), alarm('v1', '2026-11-01T12:00:00', 116),
    ], twoDays));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ status: 'done', action: 'Driver called', by: 'Grace', phone: 2 });
    expect(recordAction(again, again[0].id, { action: null })[0]).toMatchObject({ status: 'pending', action: null, by: '' });
  });

  it('overdue after a day, and the word the report shows', () => {
    const [c] = mergeCases([], base);
    expect(isOverdue(c, c.openedAt + 23 * HOUR)).toBe(false);
    expect(isOverdue(c, c.openedAt + 25 * HOUR)).toBe(true);
    expect(statusWord([], 0)).toBe('No case');
    expect(statusWord([c], c.openedAt + HOUR)).toBe('Pending');
    expect(statusWord([c], c.openedAt + 25 * HOUR)).toBe('Overdue');
    expect(statusWord([{ ...c, status: 'done' }], c.openedAt + 25 * HOUR)).toBe('Action taken');
  });

  it('escalates a driver with 3 cases in 7 days', () => {
    const c = (day) => ({ id: day, day, unitKey: 'k', driver: 'Osero Monari', status: 'pending', openedAt: at(`${day}T10:00:00`) });
    const all = [c('2026-10-20'), c('2026-10-28'), c('2026-10-31'), c('2026-11-01')];
    expect(needsEscalation(all[1], all)).toBe(false);
    expect(needsEscalation(all[3], all)).toBe(true);
  });

  it('the period takes the days it covers', () => {
    const list = [{ id: 'a', day: '2026-10-31' }, { id: 'b', day: '2026-11-01' }, { id: 'c', day: '2026-11-02' }];
    expect(periodCases(list, { from: at('2026-11-01T00:00:00'), to: at('2026-11-02T00:00:00') }).map((x) => x.id)).toEqual(['b']);
  });

  it('import adds new cases and takes the later action', () => {
    const [c] = mergeCases([], base);
    const acted = { ...c, status: 'done', action: 'Verbal warning', actedAt: 5 };
    const r = importCases([c], exportCases([acted, { ...c, id: 'other' }], 'MENENGAI'));
    expect(r.added).toBe(1);
    expect(r.list.find((x) => x.id === c.id).action).toBe('Verbal warning');
  });
});

describe('storage', () => {
  beforeEach(() => {
    const m = new Map();
    globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
    globalThis.window = { dispatchEvent: () => true };
    globalThis.Event ??= class { constructor(t) { this.type = t; } };
  });
  it('keeps one list per organisation', () => {
    expect(saveCases('org1', [{ id: 'a', day: '2026-11-01' }])).toBe(true);
    expect(loadCases('org1')).toHaveLength(1);
    expect(loadCases('org2')).toEqual([]);
  });
});

describe('the PDF', () => {
  it('has the follow-up column, the summary and the pending list', () => {
    const now = at('2026-11-02T12:00:00');
    const found = casesFromRun(units, [], [alarm('v1', '2026-11-01T10:00:00', 116)], twoDays);
    const cases = mergeCases([], found);
    const rows = Object.assign([{ unit: units[0], dashcam: true, accel: 0, brake: 0, seatbelt: 0, phone: 1, covered: 0, total: 1, driver: 'Osero Monari' }], { logged: [] });
    const followUp = new Map([[units[0].key, cases]]);
    const done = { rows, secs: [{ name: 'Van Sales', rows, total: 1 }], missing: [], units: 2, failed: 0,
      ctx: { ...twoDays, followUp, cases, allCases: cases, now } };
    const { html } = reportHtml(REPORTS.behaviour, done, { companyName: 'Menengai', orgCode: 'MENENGAI', groupWords: 'All groups', periodWords: 'p', logos: { rai: '', ogc: '' }, now });
    expect(html).toContain('Follow-up');
    expect(html).toContain('0 of 1 case actioned');
    expect(html).toContain('Pending cases');
    expect(html).toContain('Overdue');
  });
});

describe('columns with nothing in them', () => {
  it('leave out Type and Driver when every vehicle has none, in the screen, CSV and PDF', async () => {
    const { shownColumns, csvTable } = await import('./reportTables');
    const bare = [{ id: 'X - KDU 474H', vehicleId: 'n1', vehicleType: 'UNSPECIFIED' }];
    const { units: u } = scopeUnits(bare, null);
    const rows = Object.assign([{ unit: { ...u[0], type: 'UNSPECIFIED' }, dashcam: true, accel: 1, brake: 0, seatbelt: 0, phone: 0, covered: 0, total: 1, driver: '' }], { logged: [] });
    const ctx = { from: twoDays.from, to: twoDays.to, followUp: new Map(), cases: [], allCases: [], now: twoDays.to };
    const keep = shownColumns(REPORTS.behaviour, rows, ctx);
    const heads = REPORTS.behaviour.columns(ctx);
    expect(keep.map((i) => heads[i])).not.toContain('Type');
    expect(keep.map((i) => heads[i])).not.toContain('Driver');
    expect(csvTable(REPORTS.behaviour, [{ name: null, rows }], ctx).head).not.toContain('Type');
    const { html } = reportHtml(REPORTS.behaviour, { rows, secs: [{ name: null, rows, total: 1 }], missing: [], units: 1, failed: 0, ctx },
      { companyName: 'Nzoia', orgCode: 'NZOIA', groupWords: 'All vehicles', periodWords: 'p', logos: { rai: '', ogc: '' }, now: twoDays.to });
    expect(html).not.toContain('UNSPECIFIED');
    expect(html).not.toContain('>Driver<');
    expect(html).not.toContain('Logged by operators');
  });
});
