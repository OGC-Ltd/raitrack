import { describe, it, expect } from 'vitest';
import {
  dormantDoc, geofenceDoc, roomForHeads, tatDoc, speedDoc, deliveriesDoc, recoveryDoc,
  loginActivityDoc, LOGIN_ACTIVITY_PDF_LIMIT, fcrDoc, alarmDistDoc,
} from './reportDocs';
import { offlineReport } from './offlineReport';
import { removeBar } from './shiftDoc';

const at = (s) => Date.parse(`${s}+03:00`);
const NOW = at('2026-11-04T09:00:00');
const kinds = (d) => d.blocks.map((b) => b.kind);
const tables = (d) => d.blocks.filter((b) => b.kind === 'table');

describe('reports as documents', () => {
  const rep = offlineReport([
    { vehicleId: 'a', grouping: 'WSL 01', lastAt: at('2026-11-03T10:00:00'), location: 'Kakamega' },
    { vehicleId: 'b', grouping: 'WSL 02', lastAt: at('2026-10-20T10:00:00'), location: null },
    { vehicleId: 'c', grouping: 'WSL 03', lastAt: null },
  ], NOW);

  it('Dormant Assets keeps its three bars, and says who never reported', () => {
    const d = dormantDoc(rep, { fleet: 'West Kenya', now: NOW, orgCode: 'WK' });
    expect(d.title).toBe('DORMANT ASSETS REPORT');
    expect(d.filename).toBe('Dormant Assets Report West Kenya 2026-11-04');
    expect(d.blocks.filter((b) => b.kind === 'bar').map((b) => b.title)).toEqual(['OFFLINE YESTERDAY', 'OFFLINE FOR 48 HRS', 'OFFLINE FOR OVER 48 HRS']);
    expect(tables(d).map((t) => t.rows[0][0].text)).toEqual(['WSL 01', 'WSL 02']);
    expect(d.blocks.some((b) => b.kind === 'note' && b.text.startsWith('1 vehicle has never reported'))).toBe(true);
  });

  it('a bar leaves with what stands under it, and no more', () => {
    const d = dormantDoc(rep, { fleet: 'West Kenya', now: NOW, orgCode: 'WK' });
    const first = d.blocks.findIndex((b) => b.kind === 'bar');
    const out = removeBar(d, first);
    expect(out.blocks.filter((b) => b.kind === 'bar').map((b) => b.title)).toEqual(['OFFLINE FOR 48 HRS', 'OFFLINE FOR OVER 48 HRS']);
    expect(tables(out)).toHaveLength(1);
    expect(d.blocks.filter((b) => b.kind === 'bar')).toHaveLength(3);
  });

  it('Geofences says the period and each visit', () => {
    const rows = [{ vehicle: 'WSL 01', vehicleId: 'a', place: 'Kabras', in: at('2026-11-03T08:00:00'), out: at('2026-11-03T09:30:00'), open: false }];
    const d = geofenceDoc(rows, { from: at('2026-11-03T00:00:00'), to: at('2026-11-04T00:00:00'), fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    expect(d.filename).toBe('Geofence Report West Kenya 2026-11-03');
    expect(tables(d)[0].rows[0].map((c) => c.text)).toEqual(['WSL 01', 'Kabras', '2026-11-03 08:00:00', '2026-11-03 09:30:00', '1:30:00']);
  });

  const tatRow = {
    vehicleId: 'a', plate: 'WSL 01', group: 'CANE', dispatchedAt: at('2026-11-03T06:00:00'), leftAt: at('2026-11-03T06:10:00'), returnedAt: at('2026-11-03T18:10:00'),
    station: 'Kabras', fuel: { initial: 100, topUps: 0, total: 100, consumption: 20, theft: 0, final: 80 }, km: 60, rate: 3, tankL: 300, comment: 'PROBE OK', base: 'Kabras',
  };
  it('TAT and Fuel is made on its side, with all fourteen columns', () => {
    const d = tatDoc([tatRow], { day: '2026-11-03', fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    expect(d.landscape).toBe(true);
    const [t] = tables(d);
    expect(t.head).toHaveLength(14);
    expect(t.cols).toHaveLength(14);
    expect(t.rows[0]).toHaveLength(14);
    expect(t.cols.reduce((n, c) => n + c.w, 0)).toBeLessThanOrEqual(271.5);
    expect(d.blocks.find((b) => b.kind === 'h2' && b.title.endsWith('CANE'))).toBeTruthy();
  });

  it('TAT and Fuel over several days says so, and names its file for them', () => {
    const d = tatDoc([tatRow], { day: '2026-11-01', to: '2026-11-03', fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    expect(d.filename).toBe('TAT and Fuel Report West Kenya 2026-11-01 to 2026-11-03');
    expect(d.blocks[0].aside).toBe('1 to 3 November 2026');
    expect(d.footer).toContain('1 to 3 November 2026');
  });

  it('Speed keeps the link to where the peak happened', () => {
    const row = { vehicleId: 'a', name: 'WSL 01', group: 'CANE', km: 90, maxKmh: 102.4, limitKmh: 80, overByKmh: 22.4, overKm: 3.2, occurrences: 4, peak: { lat: 0.5, lng: 34.5 } };
    const d = speedDoc([row], { day: '2026-11-03', fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    const [t] = tables(d);
    expect(t.rows[0][3]).toMatchObject({ text: '102 km/h', link: 'https://www.google.com/maps?q=0.5,34.5' });
    expect(t.cols[0].w).toBe(0);
    expect(kinds(d)[0]).toBe('h2');
  });
});

describe('the Deliveries Report as a document', () => {
  const row = {
    plate: 'KDE 136E', fulfilled: 1, planned: 3, place: null,
    trip: { leftAt: at('2026-11-03T08:33:00'), leftFrom: { short: 'STO', label: 'Nairobi depot' }, arrivedAt: at('2026-11-03T16:23:00'), arrivedTo: { label: 'Nairobi depot' } },
    customers: [
      { name: 'a', label: 'Shop A', at: at('2026-11-03T10:26:00'), reachedAt: at('2026-11-03T10:26:00'), nearest: null },
      { name: 'b', label: 'Shop B', at: null, reachedAt: null, nearest: { m: 2200, t: at('2026-11-03T09:00:00') } },
      { name: 'c', label: 'Gone', missing: true },
    ],
  };
  const o = { from: at('2026-11-02T07:00:00'), at: at('2026-11-03T20:00:00'), fleet: 'Menengai', orgCode: 'MENENGAI', now: NOW };
  it('says what the route did at each stop, dated over several days', () => {
    const d = deliveriesDoc([row], o);
    const [sheet, stops] = tables(d);
    expect(sheet.rows[0][2].text).toBe('1/3');
    expect(stops.rows.map((r) => r[1].text)).toEqual(['Delivered 03.11 10:26', 'Not reached, closest 2.2 km at 03.11 09:00', 'Not on the platform']);
    expect(stops.rows.map((r) => r[1].tone)).toEqual([undefined, 'flag', 'mut']);
    expect(d.blocks.find((b) => b.kind === 'h3')).toMatchObject({ title: 'KDE 136E', aside: '1/3 delivered · left Nairobi depot 03.11 08:33 · back Nairobi depot 03.11 16:23 · 2 not delivered' });
    expect(d.filename).toBe('Deliveries Report Menengai 2026-11-03');
  });
  it('is the table alone when the stops are left out, under the days', () => {
    const d = deliveriesDoc([row], { ...o, stops: false });
    expect(kinds(d)).toEqual(['bar', 'table']);
    expect(d.blocks[0].title).toBe('02/11/2026 to 03/11/2026');
  });
  it('fits the columns to the sheet, and says when there are no vehicles', () => {
    expect(tables(deliveriesDoc([row], o))[0].cols[3].w).toBe(0);
    expect(deliveriesDoc([], o).blocks.some((b) => b.kind === 'none')).toBe(true);
  });
});

describe('the Recovery Report as a document', () => {
  it('includes daily totals, vehicle metrics, route fixes and stop details', () => {
    const report = {
      day: '2026-11-03',
      generatedAt: NOW,
      vehicles: [
        {
          plate: 'KDX 130Y', recoveryType: 'mechanical', available: true, hasTelemetry: true,
          distanceKm: 82.4, fuelConsumedL: 12.5, stopsTotal: 1,
          route: [[-0.1, 34.7], [-0.2, 34.8]],
          stops: [{ arrivedAt: at('2026-11-03T08:00:00'), leftAt: at('2026-11-03T08:10:00'), durationMs: 600_000, location: 'Kakamega', remark: 'Recovery call', lat: -0.15, lng: 34.75 }],
        },
        {
          plate: 'KDX 131Y', recoveryType: 'puncture', available: true, hasTelemetry: false,
          distanceKm: null, fuelConsumedL: null, stopsTotal: null, route: [], stops: [],
        },
      ],
    };
    const d = recoveryDoc(report, { fleet: 'West Kenya', orgCode: 'WK' });
    const [overview, route, stops] = tables(d);
    expect(d.filename).toBe('Recovery Vehicle Report West Kenya 2026-11-03');
    expect(d.blocks[1].items.map((x) => x.value)).toEqual(['1', '82.4', '12.5', '1']);
    expect(overview.rows.map((r) => r.slice(0, 2).map((c) => c.text))).toEqual([
      ['KDX 130Y', 'Mechanical recovery'], ['KDX 131Y', 'Puncture recovery'],
    ]);
    expect(route.rows.map((r) => r.slice(1).map((c) => c.text))).toEqual([['-0.10000', '34.70000'], ['-0.20000', '34.80000']]);
    expect(stops.rows[0].map((c) => c.text)).toEqual(['Kakamega', '08:00', '08:10', '10 min', '-0.15000', '34.75000', 'Recovery call']);
    expect(d.blocks.some((b) => b.kind === 'none' && b.text.includes('No GPS telemetry'))).toBe(true);
  });
});

describe('the Login Activity Report as a document', () => {
  const report = {
    total: 2,
    systemUsers: 5,
    everLoggedIn: 4,
    rows: [
      {
        id: 'login-1', loggedInAt: '2026-11-03T05:30:00.000Z',
        user: { id: 'user-1', fullName: 'Ada Lovelace', email: 'ada@example.test', roles: ['Dispatcher'], groups: ['Dispatch'] },
      },
      {
        id: 'login-2', loggedInAt: '2026-11-03T08:15:00.000Z',
        user: { id: 'user-2', fullName: 'Grace Hopper', email: null, roles: [], groups: [] },
      },
    ],
  };
  const options = { organisation: 'West Kenya', orgCode: 'WK', from: '2026-11-03', to: '2026-11-03', now: NOW };

  it('includes every successful sign-in, scope totals and the selected period', () => {
    const d = loginActivityDoc(report, options);
    const [log] = tables(d);
    expect(d.title).toBe('LOGIN ACTIVITY REPORT');
    expect(d.filename).toBe('Login Activity Report West Kenya 2026-11-03');
    expect(d.meta).toContainEqual({ label: 'Scope', value: 'Successful sign-ins only' });
    expect(d.blocks[1].items.map((item) => item.value)).toEqual(['2', '2', '4', '5']);
    expect(log.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['03 Nov 2026, 08:30', 'Ada Lovelace', 'ada@example.test', 'Dispatcher', 'Dispatch'],
      ['03 Nov 2026, 11:15', 'Grace Hopper', '—', 'No role assigned', 'Ungrouped'],
    ]);
  });

  it('uses a none block for an empty period and refuses a document beyond the server row limit', () => {
    expect(loginActivityDoc({ ...report, rows: [] }, options).blocks.some(
      (block) => block.kind === 'none' && block.text.includes('No successful sign-ins'),
    )).toBe(true);
    expect(() => loginActivityDoc({
      ...report, rows: Array.from({ length: LOGIN_ACTIVITY_PDF_LIMIT + 1 }, (_, i) => ({ id: `login-${i}` })),
    }, options)).toThrow('Narrow the date range');
  });
});

describe('room for the headings', () => {
  const head = ['Reg No', 'Location', 'Distance covered KM (4hrs)'];
  it('widens a column for its heading, out of the one that wraps', () => {
    const out = roomForHeads([{ w: 20 }, { w: 54, wrap: true }, { w: 34 }], head);
    expect(out[2].w).toBeGreaterThan(34);
    expect(out[1].w).toBeLessThan(54);
    expect(out[0].w + out[1].w + out[2].w).toBeCloseTo(108, 1);
  });
  it('leaves columns that fit alone, and has nothing to take where nothing wraps', () => {
    expect(roomForHeads([{ w: 20 }, { w: 60 }], ['A', 'B'])).toEqual([{ w: 20 }, { w: 60 }]);
    expect(roomForHeads([{ w: 20 }, { w: 34 }], ['A', head[2]])).toEqual([{ w: 20 }, { w: 34 }]);
  });
});

describe('the server-worked reports as documents (v47)', () => {
  const now = Date.UTC(2026, 10, 10, 6, 0);
  it('Fuel Consumption Rate draws the server rows as they are, flagging below target', () => {
    const rows = [
      { vehicleId: 'v1', plate: 'KDA 258J', distanceKm: 64.2, startL: 128, filledL: 10.5, theftL: 0, endL: 129.1, consumedL: 9.4, kmPerL: 3.1, target: { kmPerL: 4.7, words: '4.70' }, belowTarget: true, note: '' },
      { vehicleId: 'v2', plate: 'KCX 001A', distanceKm: 12, startL: null, filledL: 0, theftL: 0, endL: null, consumedL: null, kmPerL: null, target: null, belowTarget: null, note: 'No fuel probe' },
    ];
    const d = fcrDoc(rows, { from: '2026-11-06', to: '2026-11-07', fleet: 'Menengai', orgCode: 'MENENGAI', totals: { measured: 1, distanceKm: 64.2, consumedL: 9.4, kmPerL: 6.83 }, now });
    const t = d.blocks.find((b) => b.kind === 'table');
    expect(t.rows[0].map((c) => c.text)).toEqual(['KDA 258J', '4.70', '64.2', '128.0', '10.5', '—', '129.1', '9.4', '3.10', 'Below target']);
    expect(t.rows[0][8]).toMatchObject({ tone: 'flag', bold: true });
    expect(t.rows[1].map((c) => c.text)).toEqual(['KCX 001A', '—', '12.0', '—', '0.0', '—', '—', '—', '—', 'No fuel probe']);
    expect(t.rows[2][8].text).toBe('6.83');
  });
  it('Alarm Distribution says on the page when the counts are partial', () => {
    const row = { plate: 'KDA 258J', total: 2, fatigue: 1, phone: 1, smoking: 0, covered: 0, distracted: 0, seatbelt: 0, other: 0 };
    const notes = (o) => alarmDistDoc([row], { from: '2026-11-06', to: '2026-11-06', fleet: 'Sukari', orgCode: 'SUKARI', now, ...o }).blocks.filter((b) => b.kind === 'note');
    expect(notes({})).toEqual([]);
    expect(notes({ partial: true })[0].text).toMatch(/only part of the alarms/);
  });
});

describe('AI alarms without Other (operator, 11 Nov 2026)', async () => {
  const { withoutOther, alarmDistDoc } = await import('./reportDocs');
  const rows = [
    { plate: 'KCP 073P', total: 9, fatigue: 2, phone: 1, smoking: 0, covered: 0, distracted: 3, seatbelt: 0, other: 3 },
    { plate: 'KDE 268P', total: 4, fatigue: 0, phone: 0, smoking: 0, covered: 0, distracted: 0, seatbelt: 0, other: 4 },
  ];
  it('Total is the six kinds shown, and a unit with Other alone goes', () => {
    const r = withoutOther(rows);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(6);
    expect('other' in r[0]).toBe(false);
  });
  it('the PDF has no Other column', () => {
    const doc = alarmDistDoc(withoutOther(rows), { from: '2026-11-10', to: '2026-11-10', fleet: 'Menengai', orgCode: 'MENENGAI' });
    const table = doc.blocks.find((b) => b.kind === 'table');
    expect(table.head).not.toContain('Other');
    expect(table.head).toHaveLength(8);
  });
});
