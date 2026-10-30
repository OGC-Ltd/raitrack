import { describe, it, expect } from 'vitest';
import { splitTrips, parseDispatch, dispatchesOf, zoneVisits, dayTrips, dayReportData, BREAK_MS } from './dayTrips';
import { buildTripReport } from './tripReport';
import { renderTripReportHtml } from './tripReportHtml';

const DAY = Date.parse('2026-10-30T00:00:00+03:00');
const M = 60_000, H = 60 * M;
const logos = { rai: '', ogc: '' };

// About 0.009° of latitude per km. A ping a minute.
function drive(t0, minutes, lat0, lng, kmh = 40, extra = {}) {
  const out = [];
  for (let i = 0; i <= minutes; i++) {
    out.push({ t: t0 + i * M, lat: lat0 + (i * kmh / 60) * 0.009, lng, speedKmh: kmh, engineOn: true, fuelLevelMl: 200_000 - i * 200, altitudeM: 1500 + i, ...extra });
  }
  return out;
}
function park(t0, minutes, lat, lng) {
  const out = [];
  for (let i = 1; i <= minutes; i++) out.push({ t: t0 + i * M, lat, lng, speedKmh: 0, engineOn: false, fuelLevelMl: 190_000, altitudeM: 1500 });
  return out;
}

// 07:00 yard → 08:00 Raiply (40 km); parked 2 h; 10:00 back to the yard; a
// 10-minute stop at 10:30 stays inside the return trip.
const leg1 = drive(DAY + 7 * H, 60, 0.50, 34.9);
const end1 = leg1.at(-1);
const stand = park(end1.t, 120, end1.lat, end1.lng);
const leg2a = drive(DAY + 10 * H, 30, end1.lat, 34.9, -40);
const end2a = leg2a.at(-1);
const shortStop = park(end2a.t, 10, end2a.lat, end2a.lng);
const leg2b = drive(DAY + 10 * H + 41 * M, 30, end2a.lat, 34.9, -40);
const pings = [...leg1, ...stand, ...leg2a, ...shortStop, ...leg2b];

const events = [
  { t: DAY + 6 * H + 40 * M, kind: 'dispatch', label: 'Dispatch', detail: 'KCP 134P · Dickson Kiplagat signed out to RAIPLY and left the premises.' },
  { t: DAY + 7 * H + 2 * M, kind: 'zone', label: 'Left zone', detail: 'KCP 134P left NAITIRI YARD' },
  { t: DAY + 7 * H + 59 * M, kind: 'zone', label: 'Entered zone', detail: 'KCP 134P arrived at RAIPLY' },
  { t: DAY + 7 * H + 30 * M, endT: DAY + 7 * H + 33 * M, kind: 'speeding', detail: 'peak 74 km/h, limit 60 km/h' },
  { t: DAY + 9 * H + 50 * M, kind: 'zone', label: 'Left zone', detail: 'KCP 134P left RAIPLY' },
  { t: DAY + 9 * H, kind: 'theft', ml: 20_000 },
];

describe('splitTrips', () => {
  it('ends a trip on a stand of 30 min or more and keeps a short stop inside', () => {
    const trips = splitTrips(pings);
    expect(trips).toHaveLength(2);
    expect(trips[0].from).toBe(DAY + 7 * H);
    expect(trips[0].to).toBe(DAY + 8 * H);
    expect(trips[0].distanceM / 1000).toBeCloseTo(40, 0);
    expect(trips[1].from).toBe(DAY + 10 * H);
    expect(trips[1].to).toBe(DAY + 11 * H + 11 * M);
  });
  it('a stop just under the break joins the trips; at the break it splits them', () => {
    const a = drive(DAY, 20, 0.5, 34.9);
    const gap = (min) => drive(a.at(-1).t + min * M, 20, a.at(-1).lat, 34.9);
    expect(splitTrips([...a, ...gap(29)])).toHaveLength(1);
    expect(splitTrips([...a, ...gap(BREAK_MS / M + 1)])).toHaveLength(2);
  });
  it('shuffling about a yard is not a trip', () => {
    const yard = [];
    for (let i = 0; i < 30; i++) yard.push({ t: DAY + i * M, lat: 0.5 + (i % 2) * 0.0003, lng: 34.9 });
    expect(splitTrips(yard)).toHaveLength(0);
  });
  it('a dead speed line does not hide the driving', () => {
    expect(splitTrips(drive(DAY, 30, 0.5, 34.9, 40, { speedKmh: 0 }))).toHaveLength(1);
  });
});

describe('sign-out lines', () => {
  it('reads cane and sales sign-outs', () => {
    expect(parseDispatch('KCP 134P · Dickson Kiplagat signed out to RAIPLY and left the premises.'))
      .toEqual({ driver: 'Dickson Kiplagat', at: null, tonnes: null, destination: 'RAIPLY' });
    expect(parseDispatch('KDA 1A · Peter signed out at Naitiri with 29.0 t bound for Eldoret and left the premises.'))
      .toEqual({ driver: 'Peter', at: 'Naitiri', tonnes: 29, destination: 'Eldoret' });
    expect(parseDispatch('Engine on')).toBeNull();
  });
  it('picks dispatch events, including the sales label', () => {
    const d = dispatchesOf([...events, { t: DAY, kind: 'other', label: 'SALE_DISPATCH', detail: 'X · A signed out at Y with 10 t bound for Z and left the premises.' }]);
    expect(d.map((x) => x.destination)).toEqual(['Z', 'RAIPLY']);
  });
});

describe('zoneVisits', () => {
  it('pairs entries and exits; a visit open at midnight starts at midnight', () => {
    const v = zoneVisits(events, DAY, DAY + 24 * H);
    expect(v.map((x) => x.name)).toEqual(['NAITIRI YARD', 'RAIPLY']);
    expect(v[0]).toMatchObject({ enteredAt: DAY, leftAt: DAY + 7 * H + 2 * M });
    expect(v[1]).toMatchObject({ enteredAt: DAY + 7 * H + 59 * M, leftAt: DAY + 9 * H + 50 * M });
  });
});

describe('dayTrips', () => {
  const trips = dayTrips({ pings, events, dayFrom: DAY, dayTo: DAY + 24 * H });
  it('names the ends from zones and the sign-out, and gives the sign-out to its trip', () => {
    expect(trips[0]).toMatchObject({ n: 1, fromName: 'NAITIRI YARD', toName: 'RAIPLY' });
    expect(trips[0].dispatch).toMatchObject({ driver: 'Dickson Kiplagat', destination: 'RAIPLY' });
  });
  it('a trip no zone or sign-out names is left for the map to name', () => {
    expect(trips[1]).toMatchObject({ n: 2, dispatch: null, toName: null });
    expect(trips[1].end).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  });
});

describe('dayReportData → trip report', () => {
  const vehicle = { plate: 'KCP 134P', type: 'TRUCK' };
  const base = { vehicle, companyName: 'Rai Group', dayFrom: DAY, dayTo: DAY + 24 * H, pings, events, now: DAY + 20 * H };
  const trips = dayTrips({ pings, events, dayFrom: DAY, dayTo: DAY + 24 * H });

  it('one trip: only what happened inside it', () => {
    const r = buildTripReport(dayReportData({ ...base, trip: trips[0] }));
    expect(r.mode).toBe('trip');
    expect(r.from.at).toBe(DAY + 7 * H);
    expect(r.to.name).toBe('RAIPLY');
    expect(r.vehicle.driver).toBe('Dickson Kiplagat');
    // The speeding at 07:30 is on it; the drain at 09:00, while parked after arrival, is not.
    expect(r.breaches.counts.speed).toBe(1);
    expect(r.fuel.drainL).toBe(0);
  });

  it('the whole day: midnight to now, with the drain while parked', () => {
    const d = dayReportData({ ...base, trip: null });
    expect(d.mode).toBe('day');
    expect(d.window).toMatchObject({ from: DAY, to: DAY + 20 * H });
    const r = buildTripReport(d);
    expect(r.mode).toBe('day');
    expect(r.breaches.counts.speed).toBe(1);
    expect(r.fuel.drainL).toBe(20);
    const html = renderTripReportHtml(r, { toolbar: false, logos });
    expect(html).toContain('DAY REPORT');
    expect(html).toContain('1. Day summary');
    expect(html).not.toContain('1. Trip summary');
  });

  it('a trip report from a day keeps the trip wording', () => {
    const html = renderTripReportHtml(buildTripReport(dayReportData({ ...base, trip: trips[0] })), { toolbar: false, logos });
    expect(html).toContain('1. Trip summary');
    expect(html).toContain('RAIPLY');
  });

  it('maps weighbridge rows and dashcam alarms into the report shape', () => {
    const d = dayReportData({
      ...base,
      weighments: [{ token: 'T1', tokenAt: '2026-10-30T06:30:00+03:00', netWeightKg: 29000, productName: 'Plywood',
        grossWeightKg: 40000, grossAt: '2026-10-30T06:45:00+03:00', grossBridgeNo: 2, centerName: 'Naitiri',
        tareWeightKg: 11000, tareAt: '2026-10-30T06:35:00+03:00', tareBridgeNo: 1 }],
      dashcam: { complete: true, alarms: [{ occurredMs: DAY + 7 * H + 10 * M, label: 'No seatbelt', lat: 0.5, lng: 34.9, speed: 40 }, { occurredMs: DAY, label: 'Lens covered' }] },
    });
    expect(d.weighments[0]).toMatchObject({ ticket: 'T1', netKg: 29000, cargo: 'Plywood' });
    expect(d.weighments[0].weighings.map((w) => w.kind)).toEqual(['Tare', 'Gross']);
    expect(d.weighments[0].weighings[1].bridge).toBe('Naitiri · bridge 2');
    expect(d.dashcam.alarms).toHaveLength(1);
    expect(d.dashcam.alarms[0].kind).toBe('seatbelt');
  });
});
