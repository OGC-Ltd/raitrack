import { describe, it, expect } from 'vitest';
import {
  findMorlFence, morlFenceProblem, depotTrip, markSlow, tankerRows, rowCells, leftWords, periodWords, tankersHtml, counts, DEPOT,
} from './tankersReport';
import { MOMBASA_LOADING } from './movementReport';

const at = (s) => Date.parse(`${s}+03:00`);
// MORL: a square near Nakuru. A fix at lat -0.25 is inside.
const fence = { type: 'Feature', properties: { name: 'MORL Factory' },
  geometry: { type: 'Polygon', coordinates: [[[36.000, -0.255], [36.010, -0.255], [36.010, -0.245], [36.000, -0.245], [36.000, -0.255]]] } };
const MORL = { lat: -0.25, lng: 36.005 };
const DEPOT_AT = { lat: MOMBASA_LOADING.lat, lng: MOMBASA_LOADING.lng };
// On the Mombasa road, `km` from the depot (about 0.009° a km).
const road = (km) => ({ lat: MOMBASA_LOADING.lat + km * 0.009, lng: MOMBASA_LOADING.lng - km * 0.0005 });
const ping = (ts, where) => ({ t: at(ts), ...where, speedKmh: 40 });
/** A reading every 2 minutes from `a` to `b`, driving from km `k0` to `k1` out of the depot. */
function drive(a, b, k0, k1) {
  const out = [];
  const t0 = at(a); const t1 = at(b);
  for (let t = t0; t <= t1; t += 120_000) {
    const k = k0 + ((k1 - k0) * (t - t0)) / (t1 - t0 || 1);
    out.push({ t, ...road(k), speedKmh: k1 === k0 ? 0 : 60 });
  }
  return out;
}

describe('Tankers Report: from the Mombasa depot', () => {
  const to = at('2026-11-03T12:30:00');
  const ctx = { from: to - 4 * 3600_000, to };

  it('finds MORL as the server does', () => {
    expect(findMorlFence({ features: [fence] }, null)).toBe(fence);
    const yard = { properties: { name: 'Menengai Yard - Nakuru HQ', isActive: false }, geometry: fence.geometry };
    expect(findMorlFence({ features: [yard] }, 'MORL HQ')).toBe(yard);
    expect(morlFenceProblem({ features: [] }, 'MORL HQ')).toContain('sent 0 geofences');
  });

  it('reads when a tanker left the depot, the 4 hours and the whole trip', () => {
    const pings = [
      ping('2026-11-02T14:00:00', DEPOT_AT), ping('2026-11-02T15:54:00', DEPOT_AT),
      ping('2026-11-02T15:54:53', road(1.2)), ...drive('2026-11-02T15:56:53', '2026-11-02T20:00:00', 1.3, 200),
      ...drive('2026-11-03T08:30:00', '2026-11-03T12:30:00', 300, 400),
    ];
    const { trip } = depotTrip(pings, DEPOT, fence, ctx);
    expect(leftWords(trip.leftAt)).toBe('02.11.2026 15:54:53');
    expect(trip.status).toBe('transit');
    expect(trip.windowKm).toBeGreaterThan(90);
    expect(trip.tripKm).toBeGreaterThan(trip.windowKm);
  });

  it('is green when it reached MORL, and off the report once that was over a day ago', () => {
    const back = [ping('2026-11-02T10:00:00', DEPOT_AT), ping('2026-11-02T10:30:00', road(2)), ping('2026-11-03T11:00:00', MORL)];
    expect(depotTrip(back, DEPOT, fence, ctx).trip.status).toBe('completed');
    const old = [ping('2026-11-01T06:00:00', DEPOT_AT), ping('2026-11-01T06:30:00', road(2)), ping('2026-11-02T08:00:00', MORL), ping('2026-11-03T12:00:00', MORL)];
    expect(depotTrip(old, DEPOT, fence, ctx).trip).toBeNull();
    // Reached MORL before these 4 hours but within the day: still listed, for the operator to leave out
    const lastReport = [ping('2026-11-02T10:00:00', DEPOT_AT), ping('2026-11-02T10:30:00', road(2)), ping('2026-11-03T07:00:00', MORL)];
    expect(depotTrip(lastReport, DEPOT, fence, ctx).trip.status).toBe('completed');
  });

  it('leaves out a tanker still at the depot, and asks for more days when the depot is not in what was read', () => {
    const loading = [ping('2026-11-03T08:00:00', DEPOT_AT), ping('2026-11-03T12:00:00', DEPOT_AT)];
    expect(depotTrip(loading, DEPOT, fence, ctx)).toEqual({ need: false, trip: null });
    const onRoad = drive('2026-11-03T08:30:00', '2026-11-03T12:30:00', 300, 400);
    expect(depotTrip(onRoad, DEPOT, fence, ctx).need).toBe(true);
    const atMorlLong = [ping('2026-11-01T08:00:00', MORL), ping('2026-11-03T12:00:00', MORL)];
    expect(depotTrip(atMorlLong, DEPOT, fence, ctx)).toEqual({ need: false, trip: null });
  });

  it('builds the rows: on the road by time left, then completed; the sheet’s cells', () => {
    const unit = (plate, vid) => ({ key: plate, plate, vehicles: [{ vehicleId: vid }] });
    const pings = {
      a: [ping('2026-11-02T15:00:00', DEPOT_AT), ping('2026-11-02T16:00:00', road(2)), ...drive('2026-11-03T09:00:00', '2026-11-03T12:00:00', 100, 200)],
      b: [ping('2026-11-02T14:00:00', DEPOT_AT), ping('2026-11-02T14:45:00', road(2)), ping('2026-11-03T11:00:00', MORL)],
      c: [ping('2026-11-03T08:00:00', DEPOT_AT)],
      d: [],
    };
    const { rows, need } = tankerRows([unit('KCH 123B', 'a'), unit('KCV 053A', 'b'), unit('KCF 186A', 'c'), unit('KCM 234S', 'd')],
      (v) => pings[v], DEPOT, fence, ctx, () => 'Konza Rest Stop');
    expect(rows.map((r) => r.unit.plate)).toEqual(['KCH 123B', 'KCV 053A']);
    expect(need.map((u) => u.plate)).toEqual(['KCM 234S']);
    expect(rowCells(rows[1], ctx.from, ctx.to)).toEqual(['KCV 053A', '02.11.2026 14:45:00', '08:30-12:30', 'MORL', 'COMPLETED TRIP', '']);
    const first = rowCells(rows[0], ctx.from, ctx.to);
    expect(first.slice(0, 4)).toEqual(['KCH 123B', '02.11.2026 16:00:00', '08:30-12:30', 'Konza Rest Stop']);
    expect(Number(first[5].replace(/,/g, ''))).toBeGreaterThanOrEqual(Number(first[4].replace(/,/g, '')));
    expect(counts(rows)).toMatchObject({ all: 2, completed: 1, transit: 1 });
    const { html, filename } = tankersHtml(rows, { ...ctx, companyName: 'Menengai Oil Refineries Ltd', orgCode: 'MENENGAI', logos: { rai: '', ogc: '' }, now: to, tankers: 48 });
    expect(html).toContain('TANKERS REPORT');
    expect(html).toContain('Mombasa depot');
    expect(html).toContain('2 in transit to HQ');
    expect(html).not.toContain('system-generated');
    expect(html).toContain('background:#c6efce');
    expect(html).not.toContain('No movement in 4 hours');
    expect(filename).toBe('Tankers Report Menengai Oil Refineries Ltd 2026-11-03 0830-1230.pdf');
  });

  it('marks red the tankers under half of what the middle one covered', () => {
    const r = (plate, km) => ({ unit: { plate }, status: 'transit', windowKm: km });
    const rows = [r('A', 130), r('B', 120), r('C', 110), r('D', 50), r('E', 0), { unit: { plate: 'F' }, status: 'completed', windowKm: 5 }];
    const { median, line } = markSlow(rows);
    expect(median).toBe(110);
    expect(line).toBe(55);
    expect(rows.map((x) => x.status)).toEqual(['transit', 'transit', 'transit', 'still', 'still', 'completed']);
    // Nobody moved: still red, the line never under half a kilometre
    const parked = [r('G', 0), r('H', 0.1)];
    expect(markSlow(parked).line).toBe(0.5);
    expect(parked.map((x) => x.status)).toEqual(['still', 'still']);
  });

  it('speaks the sheet’s words', () => {
    expect(periodWords(at('2026-09-17T08:30:00'), at('2026-09-17T12:30:00'))).toBe('08:30-12:30');
  });
});
