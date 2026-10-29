import { describe, expect, it } from 'vitest';
import { buildTripReport, BREACH_KINDS } from './tripReport';
import { renderTripReportHtml } from './tripReportHtml';

const T0 = Date.parse('2026-10-28T05:00:00Z');
const MIN = 60_000;
// ~1.1 km per 0.01° of latitude near the equator.
const yard = { lat: -0.8234, lng: 34.3845, name: 'Ndhiwa' };
const dest = { lat: -0.7234, lng: 34.3845, name: 'NYAONDO', spreadM: 300 };

/** Drive north from the yard for 60 min, stand 20 min at a road side, drive on, stand 40 min at the destination. */
function trackFixture() {
  const pts = [];
  let t = T0, lat = yard.lat;
  const push = (speed, ign = 1) => pts.push([t, lat, yard.lng, speed, ign]);
  for (let i = 0; i < 30; i++) { push(40); lat += 0.0015; t += 2 * MIN; }
  for (let i = 0; i < 10; i++) { push(0, 0); t += 2 * MIN; }            // 20 min standing, engine off
  for (let i = 0; i < 25; i++) { push(45); lat += 0.0022; t += 2 * MIN; }
  lat = dest.lat;
  for (let i = 0; i < 21; i++) { push(0, 1); t += 2 * MIN; }             // 40 min at the destination, engine on
  return pts;
}

function fixture(over = {}) {
  const track = trackFixture();
  return {
    generatedAt: T0 + 6 * 60 * MIN,
    companyName: 'SUKARI',
    vehicle: { id: 'v1', plate: 'KCP 145P', type: 'TRACTOR' },
    dispatch: { externalId: 'd-1', serialNumber: null, kind: 'CANE', status: 'DISPATCHED', driverName: 'Joel Kibet',
      destination: 'NYAONDO', dispatchedAt: T0, returnedAt: null, tonnageT: null, bags: null, cargoName: null },
    window: { from: T0, to: track[track.length - 1][0], clipped: false },
    yard, dest, arrivedAt: T0 + 140 * MIN,
    track,
    fuel: { hasProbe: true, series: [[T0, 200], [T0 + 80 * MIN, 180], [T0 + 172 * MIN, 150]], usedByCounterL: null,
      fillings: [], drains: [{ t: T0 + 70 * MIN, litres: 12, after: 180, place: null, review: null }] },
    speeding: [{ t: T0 + 10 * MIN, durationSec: 120, peakKmh: 62, limitKmh: 40, lat: null, lng: null }],
    harsh: [{ t: T0 + 100 * MIN, type: 'brake', lat: null, lng: null, speedKmh: 38, ms2: 4 }],
    camera: { fitted: false, complete: true, alarms: [] },
    zones: { timedOut: false, visits: [{ name: 'Nyaondo estate', enteredAt: T0 + 135 * MIN, leftAt: T0 + 180 * MIN, enforced: false }] },
    weighments: [],
    ...over,
  };
}

describe('buildTripReport', () => {
  const r = buildTripReport(fixture());

  it('measures distance and time from moving segments only', () => {
    expect(r.summary.distanceKm).toBeGreaterThan(10);
    expect(r.summary.movingMs).toBe(110 * MIN);
    expect(r.summary.maxKmh).toBe(45);
  });

  it('finds stops of 5 minutes or more and names the destination', () => {
    expect(r.stops).toHaveLength(2);
    expect(r.stops[0].remark).toBe('Unscheduled stop');
    expect(r.stops[0].ms).toBe(20 * MIN);
    expect(r.stops[0].flag).toBe(false);
    expect(r.stops[1].place).toBe('NYAONDO');
    expect(r.stops[1].remark).toBe('At destination, engine running');
  });

  it('works out fuel used from the probe, less the drain', () => {
    expect(r.fuel.startL).toBe(200);
    expect(r.fuel.endL).toBe(150);
    expect(r.summary.fuelUsedL).toBe(38);
    expect(r.fuel.rows[0]).toMatchObject({ kind: 'drain', label: 'Suspected theft', flag: true });
  });

  it('counts breaches per kind and leaves dashcam columns to the page', () => {
    expect(r.breaches.counts).toEqual({ speed: 1, accel: 0, brake: 1, turn: 0, seatbelt: 0 });
    expect(r.breaches.total).toBe(2);
    expect(r.breaches.dashcam).toBe(false);
    expect(BREACH_KINDS.map((k) => k.key)).toEqual(Object.keys(r.breaches.counts));
  });

  it('lists zone crossings inside the window', () => {
    expect(r.geo.rows.map((g) => g.label)).toEqual(['Entered']);
  });

  it('uses the declared load before any weighbridge ticket', () => {
    const s = buildTripReport(fixture({ dispatch: { ...fixture().dispatch, kind: 'SALES', tonnageT: 29, bags: 580, cargoName: 'Processed Sugar' } }));
    expect(s.load[0]).toMatchObject({ source: 'dispatch', netKg: 29000, bags: 580 });
  });

  it('renders one page with the plate, report number and every section', () => {
    const html = renderTripReportHtml(r, { logos: { rai: 'rai.jpg', ogc: 'ogc.png' } });
    expect(html).toContain('KCP 145P');
    expect(html).toContain('TR-KCP145P-20261028-0800');
    for (const h of ['1. Trip summary', '2. Load details', '3. Route', '4. Stops', '5. Fuel', '6. Policy breaches', '7. Geofence alerts']) {
      expect(html).toContain(h);
    }
    expect(html).toContain('No dashcam');
  });

  it('says so when the zone timeline could not be read', () => {
    const t = buildTripReport(fixture({ zones: { timedOut: true, visits: [] } }));
    expect(renderTripReportHtml(t, { logos: { rai: '', ogc: '' } })).toContain('could not be read in time');
  });
});
