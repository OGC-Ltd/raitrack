import { describe, it, expect } from 'vitest';
import { buildEndOfShift, shiftStart, alarmKind, parseSale, exitZone } from './endOfShiftReport';
import { renderEndOfShiftHtml } from './endOfShiftHtml';

const H = 3_600_000;
const FROM = Date.parse('2026-10-31T06:00:00+03:00');
const NOW = Date.parse('2026-10-31T18:00:00+03:00');
const iso = (t) => new Date(t).toISOString();
const at = (h) => FROM + h * H;

const veh = (id, plate, o = {}) => ({ vehicleId: id, id: plate, regPlate: plate, driver: o.driver ?? 'Unassigned', online: o.online ?? true,
  zones: o.zones ?? { known: true, inside: [{ id: 'z1', name: 'NAITIRI YARD', area: true }] }, trip: o.trip ?? null,
  lat: 0.78, lng: 34.87, capturedAtMs: o.seen ?? NOW - 60_000 });
const OUT = { known: true, inside: [] };

export const fixture = {
  from: FROM, to: NOW,
  vehicles: [
    veh('v1', 'KDL 715E', { driver: 'Calvin Lenaso', zones: OUT, trip: { externalId: '48831' } }),
    veh('v2', 'KDL 240X', { driver: 'Denish Mangila', zones: OUT }),
    veh('v3', 'KDL 208X', { driver: 'Samwel Mugo' }),
    veh('v4', 'FT 13', { seen: at(5.8), online: false }),
    veh('v5', 'KCU 512T', { driver: 'Moses Kibet' }),
    veh('v6', 'KDL 713E', { driver: 'Ndago Okoth', zones: OUT, trip: { externalId: '48790' } }),
  ],
  fillings: [
    { vehicleId: 'v1', filledAt: iso(at(0.7)), filledMl: 312000, location: 'Depot', verdict: 'REFILL' },
    { vehicleId: 'v3', filledAt: iso(at(5)), filledMl: 255000, location: 'Depot', verdict: 'REFILL' },
    { vehicleId: 'v5', filledAt: iso(at(6)), filledMl: 40000, verdict: 'REDISTRIBUTION' },
    { vehicleId: 'v5', filledAt: iso(at(-2)), filledMl: 90000, verdict: 'REFILL' },
  ],
  thefts: [
    { vehicleId: 'v4', beganAt: iso(at(4.6)), stolenMl: 24500, initialLocation: 'Field 14', verdict: 'DRAIN', initialSpeedKmh: 0 },
    { vehicleId: 'v6', beganAt: iso(at(6.1)), stolenMl: 13200, verdict: 'REDISTRIBUTION' },
    { vehicleId: 'v5', beganAt: iso(at(9.4)), stolenMl: 11000, verdict: 'DRAIN', reviewStatus: 'NOT_THEFT' },
    { vehicleId: 'v2', beganAt: iso(at(10.8)), stolenMl: 9300, verdict: 'DRAIN', reviewStatus: 'UNDER_REVIEW', initialSpeedKmh: 0 },
  ],
  speeding: [
    { vehicleId: 'v5', plate: 'KCU 512T', incidents: 9, peakKmh: 88, limitKmh: 60, totalSeconds: 300, avgOverKmh: 12 },
    { vehicleId: 'v1', plate: 'KDL 715E', incidents: 3, peakKmh: 96, limitKmh: 60, totalSeconds: 840, avgOverKmh: 22 },
    { vehicleId: 'v1', plate: 'KDL 715E', incidents: 1, peakKmh: 70, limitKmh: 60, totalSeconds: 60, avgOverKmh: 10 },
  ],
  harsh: [
    { id: 'h1', ts: iso(at(2)), alertType: 'HARSH_BRAKING', vehicleId: 'v3', plate: 'KDL 208X' },
    { id: 'h1', ts: iso(at(2)), alertType: 'HARSH_BRAKING', vehicleId: 'v3', plate: 'KDL 208X' },
    { id: 'h2', ts: iso(at(3)), alertType: 'HARSH_ACCELERATION', vehicleId: 'v5', plate: 'KCU512T' },
    { id: 'h3', ts: iso(at(-1)), alertType: 'HARSH_BRAKING', vehicleId: 'v5' },
  ],
  alarms: [
    { code: 116, label: 'Phone call', vehicleId: 'v1', plate: 'KDL 715E', occurredMs: at(1) },
    { code: 125, label: 'No seat belt', vehicleId: 'v6', plate: 'KDL 713E', occurredMs: at(2) },
    { code: 125, label: 'No seat belt', vehicleId: 'v6', plate: 'KDL 713E', occurredMs: at(3) },
    { code: 123, label: 'Driver camera covered', vehicleId: 'v2', plate: 'KDL 240X', occurredMs: at(4) },
    { code: 115, label: 'Fatigue driving', vehicleId: 'v2', occurredMs: at(4) },
  ],
  zones: [   // any order
    { ts: iso(at(9.6)), alertType: 'ZONE_EXIT', vehicleId: 'v2', plate: 'KDL 240X', text: 'KDL 240X left NAITIRI YARD.' },
    { ts: iso(at(2.2)), alertType: 'ZONE_EXIT', vehicleId: 'v1', plate: 'KDL 715E', text: 'KDL 715E left NAITIRI YARD.' },
    { ts: iso(at(1.5)), alertType: 'ZONE_EXIT', vehicleId: 'v1', plate: 'KDL 715E', text: 'KDL 715E left WEIGHBRIDGE and is now in NAITIRI YARD.' },
    // KDL 713E left before the shift: not counted
    { ts: iso(at(-8.3)), alertType: 'ZONE_EXIT', vehicleId: 'v6', plate: 'KDL 713E', text: 'KDL 713E left NAITIRI YARD.' },
    // KDL 208X out and back twice, KCU 512T once
    { ts: iso(at(1)), alertType: 'ZONE_EXIT', vehicleId: 'v3', plate: 'KDL 208X', text: 'KDL 208X left NAITIRI YARD.' },
    { ts: iso(at(3)), alertType: 'ZONE_ENTRY', vehicleId: 'v3', plate: 'KDL 208X', text: 'KDL 208X arrived at OPAPO OUTSTATION.' },
    { ts: iso(at(4)), alertType: 'ZONE_EXIT', vehicleId: 'v3', plate: 'KDL 208X', text: 'KDL 208X left OPAPO OUTSTATION.' },
    { ts: iso(at(5)), alertType: 'ZONE_ENTRY', vehicleId: 'v3', plate: 'KDL 208X', text: 'KDL 208X arrived at NAITIRI YARD.' },
    { ts: iso(at(6)), alertType: 'ZONE_EXIT', vehicleId: 'v5', plate: 'KCU 512T', text: 'KCU 512T left NAITIRI YARD.' },
    { ts: iso(at(10)), alertType: 'ZONE_ENTRY', vehicleId: 'v5', plate: 'KCU 512T', text: 'KCU 512T arrived at NAITIRI YARD.' },
    // FT 13 left in the shift and the feed has it out, but the snapshot places it inside: back
    { ts: iso(at(4.2)), alertType: 'ZONE_EXIT', vehicleId: 'v4', plate: 'FT 13', text: 'FT 13 left FIELD BLOCK 14.' },
  ],
  tickets: [
    { id: 't1', tokenAt: iso(at(2)), grossAt: iso(at(2)), vehicleId: 'v1', vehiclePlate: 'KDL715E', driverName: 'CALVIN LENASO', netWeightKg: 29000, factoryNetWeightKg: 28600, centerName: 'KAMUKUYWA' },
    { id: 't2', tokenAt: iso(at(6)), grossAt: iso(at(6)), vehicleId: 'v1', vehiclePlate: 'KDL715E', driverName: 'CALVIN LENASO', netWeightKg: 30000, centerName: 'KAMUKUYWA' },
    { id: 't3', tokenAt: iso(at(4)), grossAt: iso(at(4)), vehicleId: 'v3', vehiclePlate: 'KDL208X', driverName: 'SAMWEL MUGO', netWeightKg: 27000, centerName: 'OPAPO' },
    { id: 't4', tokenAt: iso(at(-3)), grossAt: iso(at(-3)), vehicleId: 'v3', vehiclePlate: 'KDL208X', netWeightKg: 27000, centerName: 'OPAPO' },
  ],
  sales: [
    { id: 's1', ts: iso(at(3)), vehicleId: 'v5', plate: 'KCU 512T', text: 'KCU 512T · Moses Kibet signed out at Naitiri with 29.0t (580 × 50 kg bags) bound for Raiply and left the premises.' },
    { id: 's2', ts: iso(at(5)), vehicleId: 'v3', plate: 'KDL 208X', text: 'KDL 208X · Samwel signed out at Naitiri with 30.0t (600 × 50 kg bags) bound for Kitale and left the premises.' },
  ],
  places: new Map([['v1', 'Kamukuywa outstation']]),
};

describe('helpers', () => {
  it('the shift starts at 06:00 Nairobi, or yesterday 06:00 before six', () => {
    expect(shiftStart(Date.parse('2026-10-31T14:00:00+03:00'))).toBe(FROM);
    expect(shiftStart(Date.parse('2026-10-31T04:30:00+03:00'))).toBe(FROM - 24 * H);
    expect(shiftStart(FROM)).toBe(FROM);
  });
  it('reads the dashcam alarms the report counts', () => {
    expect([116, 264, 125, 51, 123, 3, 115].map((code) => alarmKind({ code }))).toEqual(['phone', 'phone', 'seatbelt', 'seatbelt', 'covered', 'covered', null]);
  });
  it('reads a sales sign-out', () => {
    expect(parseSale(fixture.sales[0].text)).toEqual({ tonnes: 29, bags: 580, at: 'Naitiri', destination: 'Raiply', product: 'Processed sugar' });
  });
  it('an exit into another zone is not a way out', () => {
    expect(exitZone('KDL 715E left NAITIRI YARD.')).toBe('NAITIRI YARD');
    expect(exitZone('X left WEIGHBRIDGE and is now in NAITIRI YARD.')).toBeNull();
  });
});

describe('buildEndOfShift', () => {
  const r = buildEndOfShift(fixture);

  it('units reporting: any report since 06:00, engine on or not', () => {
    expect(r.fleet).toEqual({ units: 6, reporting: 6 });
    const r3 = buildEndOfShift({ ...fixture, vehicles: fixture.vehicles.map((v, i) => ({ ...v, online: false, capturedAtMs: i < 2 ? FROM - H : v.capturedAtMs })) });
    expect(r3.fleet.reporting).toBe(4);
  });
  it('fuel: real refills in the shift, every drain with its status', () => {
    expect(r.fuel).toMatchObject({ refills: 2, refillL: 567 });
    expect(r.fuel.topRefills.map((f) => f.plate)).toEqual(['KDL 715E', 'KDL 208X']);
    expect(r.fuel.drains.map((d) => [d.plate, d.status])).toEqual([
      ['FT 13', 'Theft, not yet reviewed'], ['KDL 713E', 'Probe swing, came back'], ['KCU 512T', 'De-escalated'], ['KDL 240X', 'Escalated']]);
  });
  it('theft: only the drains a reviewer escalated', () => {
    expect(r.theft.map((d) => d.plate)).toEqual(['KDL 240X']);
  });
  it('policy breaches: counts and top units for each kind', () => {
    const b = Object.fromEntries(r.breaches.map((x) => [x.key, x]));
    expect(b.speed).toMatchObject({ total: 13, units: 2 });
    // Ranked by time over the limit; the average over is weighted by cases.
    expect(b.speed.top[0]).toMatchObject({ plate: 'KDL 715E', overSec: 900, peak: 96, limit: 60, avgOver: 19 });
    expect(b.speed.top[1]).toMatchObject({ plate: 'KCU 512T', overSec: 300, avgOver: 12, driver: 'Moses Kibet' });
    expect([b.phone.total, b.seatbelt.total, b.brake.total, b.accel.total, b.covered.total]).toEqual([1, 2, 1, 1, 1]);
    expect(b.seatbelt.top[0]).toMatchObject({ plate: 'KDL 713E', times: 2 });
    expect(r.breachTotal).toBe(19);
  });
  it('out of geofence: units that left in the shift and are still out, no dispatch first', () => {
    expect(r.outside.map((o) => o.plate)).toEqual(['KDL 240X', 'KDL 715E']);
    const o = Object.fromEntries(r.outside.map((x) => [x.plate, x]));
    expect(o['KDL 715E']).toMatchObject({ left: 'Naitiri Yard', since: at(2.2), forMs: NOW - at(2.2), dispatch: '48831', near: 'Kamukuywa outstation' });
    expect(o['KDL 240X']).toMatchObject({ noDispatch: true, forMs: NOW - at(9.6) });
  });
  it('out and back: units, times, average and longest time out', () => {
    expect(r.outAndBack).toMatchObject({ units: 2, times: 3, totalMs: 7 * H, avgMs: 7 * H / 3 });
    expect(r.outAndBack.longest).toMatchObject({ plate: 'KCU 512T', ms: 4 * H, zone: 'Naitiri Yard' });
  });
  it('weighbridge: loads in the shift, by bridge, units with more than one trip', () => {
    expect(r.weighbridge).toMatchObject({ tickets: 3, tonnes: 85.6, units: 2, multiUnits: 1 });
    expect(r.weighbridge.multi[0]).toMatchObject({ plate: 'KDL 715E', trips: 2, tonnes: 58.6, driver: 'Calvin Lenaso', bridges: ['Kamukuywa'] });
    expect(r.weighbridge.bridges[0]).toMatchObject({ name: 'Kamukuywa', tickets: 2, busiest: '08:00–09:00' });
  });
  it('products: cane from the weighbridge, sugar from the sales runs', () => {
    expect(r.products.map((p) => [p.product, p.loads, p.tonnes, p.bags])).toEqual([['Sugarcane', 3, 85.6, null], ['Processed sugar', 2, 59, 1180]]);
    expect(r.products[1].where).toBe('Raiply 1, Kitale 1');
  });
  it('a fleet without weighbridges or zones leaves those sections out', () => {
    const r2 = buildEndOfShift({ ...fixture, tickets: null, zones: [], vehicles: fixture.vehicles.map((v) => ({ ...v, zones: null })) });
    expect(r2.weighbridge).toBeNull();
    expect(r2.zonesKnown).toBe(false);
    expect(r2.outside).toEqual([]);
  });
});

describe('renderEndOfShiftHtml', () => {
  const html = renderEndOfShiftHtml(buildEndOfShift(fixture), { companyName: 'West Sugar', reportNo: 'ES-WS-20261031-1800', logos: { rai: '', ogc: '' }, generatedAt: NOW });
  it('has every section, numbered in order', () => {
    for (const h of ['1. Overview', '2. Critical: escalated thefts', '3. Policy breaches', '4. Out of geofence', '5. Weighbridge', '6. Products ferried', '7. Handover to the next shift']) {
      expect(html).toContain(h);
    }
    expect(html).toContain('06:00 to 18:00');
    expect(html).not.toContain('Out of geofence now');
    expect(html).not.toContain('3. Fuel drains');
    expect(html).toContain('Units out and back');
    expect(html).not.toContain('Fuel refills <small>');
    expect(html).not.toContain('Times out and back');
    expect(html).not.toContain('Average time out');
    expect(html).toContain('Time over');
    expect(html).toContain('+19 km/h');
  });
  it('without a weighbridge, products and handover move up', () => {
    const h2 = renderEndOfShiftHtml(buildEndOfShift({ ...fixture, tickets: null }), { companyName: 'X', reportNo: 'R', logos: { rai: '', ogc: '' } });
    expect(h2).not.toContain('Weighbridge <small>');
    expect(h2).toContain('5. Products ferried');
    expect(h2).toContain('6. Handover');
  });
});
