import { describe, it, expect } from 'vitest';
import { planActual, planWindow, SPAN_MS, fenceOf, spanWords, clockWords, kmWords, planCsvRows, cumulative, odometerAt } from './plannerActual';
import { findStorages } from './deliveriesReport';

const at = (s) => Date.parse(`2026-11-10T${s}:00+03:00`);
const MORL = { lat: -0.28802969, lng: 36.04494759 };
const A = { lat: -0.20, lng: 36.10 };
const B = { lat: -0.10, lng: 36.15 };
const C = { lat: -0.05, lng: 36.30 };   // never visited
const storages = findStorages({ features: [] });
const zonesById = new Map([['gA', { type: 'Feature', properties: { name: 'A', radiusM: 100 }, geometry: { type: 'Point', coordinates: [A.lng, A.lat] } }]]);
const plan = { stops: [
  { id: 's1', sequence: 1, invoiceNo: '1', amount: 100, tonnage: 0.1, outcome: 'FULL', remarks: '', customer: { code: '1', name: 'A', location: 'X', lat: A.lat, lng: A.lng, geofenceId: 'gA' } },
  { id: 's2', sequence: 2, invoiceNo: '2', amount: 200, tonnage: 0.2, outcome: null, remarks: '', customer: { code: '2', name: 'B', location: 'Y', lat: B.lat, lng: B.lng, geofenceId: null } },
  { id: 's3', sequence: 3, invoiceNo: '3', amount: 300, tonnage: 0.3, outcome: null, remarks: '', customer: { code: '3', name: 'C', location: 'Z', lat: C.lat, lng: C.lng, geofenceId: null } },
] };
const ping = (time, where, speedKmh = 0) => ({ t: at(time), ...where, speedKmh });
const mid = (a, b) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

// Parked at MORL overnight, out at 06:00, A 07:00–07:30, B 08:30–09:00, home 10:00
const track = [
  ping('04:00', MORL), ping('05:00', MORL), ping('05:59', MORL),
  ping('06:00', mid(MORL, A), 60), ping('06:30', mid(MORL, A), 60),
  ping('07:00', A), ping('07:10', A), ping('07:29', A), ping('07:30', mid(A, B), 50),
  ping('08:30', B), ping('08:45', B), ping('09:00', mid(B, MORL), 60),
  ping('10:00', MORL), ping('11:00', MORL), ping('12:00', MORL),
];
const day = { from: at('00:00'), to: at('23:59') };

describe('planActual', () => {
  const r = planActual(plan, [track], storages, zonesById, day);

  it('finds the origin, the run out and home, and the stops visited', () => {
    expect(r.telemetry).toBe(true);
    expect(r.origin.short).toBe('MORL');
    expect(r.leftAt).toBe(at('06:00'));
    expect(r.backAt).toBe(at('10:00'));
    expect([r.visited, r.missed]).toEqual([2, 1]);
  });

  it('gives each stop its arrival, departure, time there and visit order', () => {
    const [a, b, c] = r.stops;
    expect(a).toMatchObject({ at: at('07:00'), leftAt: at('07:30'), stayMs: 30 * 60_000, visit: 1 });
    expect(b).toMatchObject({ at: at('08:30'), leftAt: at('09:00'), visit: 2 });
    expect(c.at).toBeNull();
    expect(c.nearestM).toBeGreaterThan(10_000);
  });

  it('measures km from the origin, then from the stop before', () => {
    const [a, b] = r.stops;
    // MORL → A straight line is ~10.3 km; the track goes via the midpoint
    expect(a.kmFromPrev).toBeGreaterThan(9);
    expect(a.kmFromPrev).toBeLessThan(12);
    expect(b.kmFromPrev).toBeGreaterThan(11);
    expect(r.km).toBeGreaterThan(a.kmFromPrev + b.kmFromPrev);
    expect(r.durationMs).toBe(4 * 3_600_000);
  });

  it('says there is no telemetry when the truck sent nothing that day', () => {
    const none = planActual(plan, [[]], storages, zonesById, day);
    expect(none.telemetry).toBe(false);
    expect(none.missed).toBe(3);
  });

  it('a pass through the fence counts while the temporary pass rule is on (11 Nov 2026)', () => {
    const passing = [ping('05:00', MORL), ping('06:00', mid(MORL, A), 60), ping('07:00', A, 40), ping('07:05', A, 40), ping('07:10', mid(A, B), 60)];
    const p = planActual(plan, [passing], storages, zonesById, day);
    expect(p.stops[0].at).toBe(passing[2].t);
  });
});

describe('helpers', () => {
  it('fenceOf uses the geofence, or a circle at the point', () => {
    expect(fenceOf(plan.stops[0].customer, zonesById).properties.name).toBe('A');
    expect(fenceOf(plan.stops[1].customer, zonesById).geometry.coordinates).toEqual([B.lng, B.lat]);
  });
  it('odometer reads the distance at the last reading', () => {
    const t = [{ t: 0, ...MORL }, { t: 10, ...A }];
    const cum = cumulative(t);
    expect(odometerAt(t, cum, 5)).toBe(0);
    expect(odometerAt(t, cum, 10)).toBeGreaterThan(10_000);
  });
  it('writes times and spans as Wialon does', () => {
    expect(spanWords(87 * 60_000)).toBe('1 h 27 min');
    expect(spanWords(31 * 60_000)).toBe('31 min');
    expect(clockWords(at('07:28'))).toBe('10.11.2026 07:28');
    expect(kmWords(0.4)).toBe('400 m');
    expect(kmWords(45.43)).toBe('45.4 km');
  });
  it('CSV carries the sheet and its actuals', () => {
    const rows = planCsvRows(plan, planActual(plan, [track], storages, zonesById, day));
    expect(rows[0][0]).toBe('No.');
    expect(rows[1].slice(0, 3)).toEqual([1, '1', 'A']);
    expect(rows[1][12]).toBe('Full');
    expect(rows[3][7]).toMatch(/^Not reached, closest/);
  });
});

describe('planWindow', () => {
  it('runs from when the sheet was printed, 48 hours on, since the truck drives it the day after', () => {
    const w = planWindow({ planDate: '2026-11-09', sheetAt: '2026-11-09T09:36:16+03:00' }, () => 0, Infinity);
    expect(w.from).toBe(Date.parse('2026-11-09T09:36:16+03:00'));
    expect(w.to - w.from).toBe(SPAN_MS);
  });
  it('falls back to the start of the plan day, and never runs past now', () => {
    const w = planWindow({ planDate: '2026-11-09', sheetAt: null }, () => 1000, 5000);
    expect(w).toEqual({ from: 1000, to: 5000 });
  });
});

describe('the time it left a stop it only passed (operator, 11 Nov 2026)', async () => {
  const { leftStopAt } = await import('./deliveriesReport');
  const shop = { type: 'Feature', properties: { radiusM: 50 }, geometry: { type: 'Point', coordinates: [36.0, -0.3] } };
  const t0 = Date.parse('2026-11-11T10:00:00+03:00');
  const pt = (min, dLat) => ({ t: t0 + min * 60_000, lat: -0.3 + dLat, lng: 36.0, speedKmh: 20 });
  it('the first reading more than 100 m away after getting there', () => {
    const track = [pt(0, 0.01), pt(5, 0), pt(6, 0.0005), pt(8, 0.0003), pt(10, 0.0015), pt(12, 0.01)];
    expect(leftStopAt([track], shop, pt(5, 0).t)).toBe(pt(10, 0).t);
  });
  it('still there at the last reading: none', () => {
    const track = [pt(0, 0.01), pt(5, 0), pt(9, 0.0002)];
    expect(leftStopAt([track], shop, pt(5, 0).t)).toBeNull();
  });
  it('a track that never saw it there does not count', () => {
    expect(leftStopAt([[pt(4, 0.01), pt(10, 0.02)]], shop, pt(5, 0).t)).toBeNull();
  });
});
