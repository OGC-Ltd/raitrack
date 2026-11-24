import { describe, it, expect, beforeEach } from 'vitest';
import {
  casesFromRun, mergeCases, recordAction, isOverdue, needsEscalation, statusWord, periodCases,
  opensCase, incidentWords, importCases, exportCases, loadCases, saveCases,
} from './followUp';
import { scopeUnits } from './fleetGroups';
import { REPORTS, dashcamWindowWords } from './reportTables';
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

  it('overdue after a day; the report says Pending however long (operator, 9 Nov 2026)', () => {
    const [c] = mergeCases([], base);
    expect(isOverdue(c, c.openedAt + 23 * HOUR)).toBe(false);
    expect(isOverdue(c, c.openedAt + 25 * HOUR)).toBe(true);
    expect(statusWord([], 0)).toBe('No case');
    expect(statusWord([c], c.openedAt + HOUR)).toBe('Pending');
    expect(statusWord([c], c.openedAt + 25 * HOUR)).toBe('Pending');
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
  // Follow-up is off the report for now (operator, 5 Nov 2026: "remove the pending pending things"; reportTables SHOW_FOLLOW_UP)
  it('puts the follow-up on the PDF, with who gave the feedback, not who recorded it (9 Nov 2026)', () => {
    const now = at('2026-11-02T12:00:00');
    const found = casesFromRun(units, [], [alarm('v1', '2026-11-01T10:00:00', 116)], twoDays);
    const cases = mergeCases([], found);
    const rows = Object.assign([{ unit: units[0], dashcam: true, accel: 0, brake: 0, seatbelt: 0, phone: 1, covered: 0, total: 1, driver: 'Osero Monari' }], { logged: [] });
    const followUp = new Map([[units[0].key, cases]]);
    const done = { rows, secs: [{ name: 'Van Sales', rows, total: 1 }], missing: [], units: 2, failed: 0,
      ctx: { ...twoDays, followUp, cases, allCases: cases, now } };
    const { html } = reportHtml(REPORTS.behaviour, done, { companyName: 'Menengai', orgCode: 'MENENGAI', groupWords: 'All groups', periodWords: 'p', logos: { rai: '', ogc: '' }, now });
    expect(html).toContain('Follow-up');
    expect(html).not.toContain('Pending cases');
    expect(html).not.toContain('Overdue');
    const acted = cases.map((c) => ({ ...c, status: 'done', action: 'Driver called', note: 'Belt fixed', by: 'Ann Operator', feedbackBy: 'Site Manager', actedAt: now }));
    const again = reportHtml(REPORTS.behaviour, { ...done, ctx: { ...done.ctx, cases: acted, allCases: acted, followUp: new Map([[units[0].key, acted]]) } },
      { companyName: 'Menengai', orgCode: 'MENENGAI', groupWords: 'All groups', periodWords: 'p', logos: { rai: '', ogc: '' }, now }).html;
    expect(again).toContain('Feedback received');
    expect(again).toContain('Site Manager');
    expect(again).not.toContain('Ann Operator');
  });
});

describe('columns with nothing in them', () => {
  it('leave out Type when every vehicle has none, in the screen, CSV and PDF; keep Driver to say there was no dispatch', async () => {
    const { shownColumns, csvTable, NO_DISPATCH_KEY } = await import('./reportTables');
    const bare = [{ id: 'X - KDU 474H', vehicleId: 'n1', vehicleType: 'UNSPECIFIED' }];
    const { units: u } = scopeUnits(bare, null);
    const rows = Object.assign([{ unit: { ...u[0], type: 'UNSPECIFIED' }, dashcam: true, accel: 1, brake: 0, seatbelt: 0, phone: 0, covered: 0, total: 1, driver: '' }], { logged: [] });
    const ctx = { from: twoDays.from, to: twoDays.to, followUp: new Map(), cases: [], allCases: [], now: twoDays.to };
    const keep = shownColumns(REPORTS.behaviour, rows, ctx);
    const heads = REPORTS.behaviour.columns(ctx);
    expect(keep.map((i) => heads[i])).not.toContain('Type');
    // Incidents and no driver (operator, 16 Nov 2026): the Driver column stays, to say so
    expect(keep.map((i) => heads[i])).toContain('Driver');
    expect(csvTable(REPORTS.behaviour, [{ name: null, rows }], ctx).head).not.toContain('Type');
    // A vehicle with no incidents and no driver still leaves Driver out
    const quiet = [{ ...rows[0], accel: 0, total: 0 }];
    expect(shownColumns(REPORTS.behaviour, quiet, ctx).map((i) => heads[i])).not.toContain('Driver');
    const { html } = reportHtml(REPORTS.behaviour, { rows, secs: [{ name: null, rows, total: 1 }], missing: [], units: 1, failed: 0, ctx },
      { companyName: 'Nzoia', orgCode: 'NZOIA', groupWords: 'All vehicles', periodWords: 'p', logos: { rai: '', ogc: '' }, now: twoDays.to });
    expect(html).not.toContain('UNSPECIFIED');
    expect(html).toContain('>Driver<');
    expect(html).toContain(NO_DISPATCH_KEY);
    expect(html).not.toContain('Logged by operators');
    // The dispatch runs could not be read: the key does not claim the vehicle stayed in the premises
    const { NO_RUNS_KEY } = await import('./reportTables');
    const failed = reportHtml(REPORTS.behaviour, { rows, secs: [{ name: null, rows, total: 1 }], missing: [], units: 1, failed: 0, ctx: { ...ctx, runsFailed: true } },
      { companyName: 'Nzoia', orgCode: 'NZOIA', groupWords: 'All vehicles', periodWords: 'p', logos: { rai: '', ogc: '' }, now: twoDays.to }).html;
    expect(failed).toContain(NO_RUNS_KEY);
    expect(failed).not.toContain(NO_DISPATCH_KEY);
    expect(failed).toContain('The dispatch runs could not be read');
  });
});

describe('a month’s run: days the dashcam no longer reaches', () => {
  // 1 Nov: 5 harsh on KCN 901F; 2 Nov: a phone alarm on KCS 082M. The dashcam reaches back to 2 Nov only.
  const harsh = [1, 2, 3, 4, 5].map((m) => ev('v2', `2026-11-01T08:0${m}:00`));
  const alarms = [alarm('v1', '2026-11-02T10:00:00', 116)];

  it('sends no case for a day before the dashcam’s reach, so a held case keeps its counts', () => {
    const found = casesFromRun(units, harsh, alarms, { ...twoDays, dashcamFrom: at('2026-11-02T00:00:00') });
    expect(found.map((c) => c.day)).toEqual(['2026-11-02']);
  });

  it('a day only partly reached is left out too', () => {
    const found = casesFromRun(units, harsh, alarms, { ...twoDays, dashcamFrom: at('2026-11-02T06:00:00') });
    expect(found).toEqual([]);
  });

  it('sends every day where the fleet has no dashcams, or the period is within reach', () => {
    expect(casesFromRun(units, harsh, [], { ...twoDays, dashcams: false, dashcamFrom: at('2026-11-02T00:00:00') }).map((c) => c.day)).toEqual(['2026-11-01']);
    expect(casesFromRun(units, harsh, alarms, twoDays).map((c) => c.day).sort()).toEqual(['2026-11-01', '2026-11-02']);
  });
});

describe('the Driver conduct report over a month', () => {
  it('takes up to 31 days, started within the last 31', () => {
    expect(REPORTS.behaviour.maxDays).toBe(31);
    expect(REPORTS.behaviour.reachDays).toBe(31);
  });

  it('says in the PDF which days the dashcam covered, and when cornering could not all be read', () => {
    const t = at('2026-11-24T12:00:00');
    const done = { rows: [], secs: [], missing: [], units: 2, failed: 0,
      ctx: { from: at('2026-11-01T00:00:00'), to: t, dashcams: true, dashcamFrom: at('2026-11-17T12:00:00'), cornerPartial: 2 } };
    const { html } = reportHtml(REPORTS.behaviour, done, { companyName: 'Aquamist', orgCode: 'AQUAMIST', groupWords: 'All groups', periodWords: 'November 2026', logos: { rai: 'r', ogc: 'o' }, now: t });
    expect(html).toContain('from the dashcam from 17 Nov 12:00 only');
    expect(html).toContain('Harsh cornering could not be read for 2 of the days.');
  });
});

describe('the stretch of time the dashcam alarms cover (operator, 24 Nov 2026)', () => {
  const t = at('2026-11-24T14:12:00');
  const month = { from: at('2026-11-01T00:00:00'), to: at('2026-11-25T00:00:00'), dashcams: true };

  it('from the dashcam’s reach, or the period’s start, to now or the period’s end', () => {
    expect(dashcamWindowWords({ ...month, dashcamFrom: at('2026-11-10T14:05:00') }, t)).toBe('10 Nov 2026 14:05 to 24 Nov 2026 14:12');
    expect(dashcamWindowWords({ ...month, from: at('2026-11-20T00:00:00'), to: at('2026-11-21T00:00:00'), dashcamFrom: null }, t)).toBe('20 Nov 2026 00:00 to 21 Nov 2026 00:00');
  });

  it('says so when the fleet has no dashcams, or they could not be read', () => {
    expect(dashcamWindowWords({ ...month, dashcams: false }, t)).toBe('No dashcams in this fleet');
    expect(dashcamWindowWords({ ...month, dashcamFailed: true }, t)).toBe('Could not be read');
  });

  it('is among the PDF’s details', () => {
    const done = { rows: [], secs: [], missing: [], units: 2, failed: 0, ctx: { ...month, dashcamFrom: at('2026-11-10T14:05:00') } };
    const { html } = reportHtml(REPORTS.behaviour, done, { companyName: 'Aquamist', orgCode: 'AQUAMIST', groupWords: 'All groups', periodWords: '1 Nov 2026 – 24 Nov 2026', logos: { rai: 'r', ogc: 'o' }, now: t });
    expect(html).toContain('Dashcam alarms');
    expect(html).toContain('10 Nov 2026 14:05 to 24 Nov 2026 14:12');
  });
});
