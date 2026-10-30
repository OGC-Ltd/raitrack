import { describe, it, expect } from 'vitest';
import { buildEndOfDay, alarmKind } from './endOfDayReport';

const DAY = Date.parse('2026-10-30T00:00:00+03:00');
const H = 3_600_000;
const iso = (t) => new Date(t).toISOString();

const vehicles = [
  { vehicleId: 'v1', plate: 'KCP 134P', driver: 'Dickson Kiplagat' },
  { vehicleId: 'v2', plate: 'KDA 001A', driver: 'Unassigned' },
  { vehicleId: 'v3', plate: 'KBZ 900X', driver: 'Peter' },
];

const input = {
  dayFrom: DAY,
  dayTo: DAY + 24 * H,
  vehicles,
  totals: { km: 4321.6, hours: 210.44, vehicles: 2 },
  speeding: [
    { vehicleId: 'v1', plate: 'KCP 134P', incidents: 3, peakKmh: 92, limitKmh: 60, totalSeconds: 400, driverName: null },
    { vehicleId: 'v2', plate: 'KDA 001A', incidents: 1, peakKmh: 71, limitKmh: 60, totalSeconds: 60, driverName: 'Jane' },
  ],
  harsh: [
    { id: 'h1', ts: iso(DAY + 8 * H), alertType: 'HARSH_BRAKING', plate: 'KCP 134P', vehicleId: 'v1', text: 'Harsh braking — KCP 134P at Turbo 38 km/h' },
    { id: 'h1', ts: iso(DAY + 8 * H), alertType: 'HARSH_BRAKING', plate: 'KCP 134P', vehicleId: 'v1', text: 'duplicate' },
    { id: 'h2', ts: iso(DAY + 9 * H), alertType: 'HARSH_ACCELERATION', plate: 'KCP134P', vehicleId: null, text: 'Harsh acceleration — KCP 134P' },
    { id: 'h3', ts: iso(DAY - H), alertType: 'HARSH_BRAKING', vehicleId: 'v3', text: 'yesterday' },
  ],
  alarms: [
    { code: 125, label: 'No seat belt', vehicleId: 'v3', plate: 'KBZ 900X', occurredMs: DAY + 10 * H, speed: 54 },
    { code: 116, label: 'Phone call', vehicleId: 'v3', plate: 'KBZ 900X', occurredMs: DAY + 11 * H },
    { code: 115, label: 'Fatigue driving', vehicleId: 'v3', occurredMs: DAY + 12 * H },
    { code: 0, label: 'Texting on phone', vehicleId: 'v1', occurredMs: DAY + 30 * H },
  ],
  fillings: [
    { vehicleId: 'v1', filledAt: iso(DAY + 6 * H), filledMl: 150_000, location: 'Naitiri', verdict: 'REFILL' },
    { vehicleId: 'v2', filledAt: iso(DAY + 7 * H), filledMl: 40_000, verdict: 'REDISTRIBUTION' },
  ],
  thefts: [
    { vehicleId: 'v2', beganAt: iso(DAY + 13 * H), stolenMl: 22_000, cleanDropMl: 20_500, initialLocation: 'Webuye', verdict: 'DRAIN' },
    { vehicleId: 'v1', beganAt: iso(DAY + 14 * H), stolenMl: 8_000, verdict: 'PENDING' },
    { vehicleId: 'v3', beganAt: iso(DAY + 15 * H), stolenMl: 9_000, verdict: 'SENSOR_FAULT' },
  ],
  faults: [
    { vehicleId: 'v2', plate: 'KDA 001A', kinds: 'signal_lost', episodes: 1, totalSeconds: 7200, openNow: 0 },
    { vehicleId: 'v3', plate: 'KBZ 900X', kinds: 'fuel_probe_dead,signal_lost', episodes: 2, totalSeconds: 3600, openNow: 1 },
  ],
};

describe('alarmKind', () => {
  it('reads the dashcam codes, then the label', () => {
    expect(alarmKind({ code: 125 })).toBe('seatbelt');
    expect(alarmKind({ code: 51 })).toBe('seatbelt');
    expect(alarmKind({ code: 116 })).toBe('phone');
    expect(alarmKind({ code: 264 })).toBe('phone');
    expect(alarmKind({ code: 9, label: 'Driver not wearing seat belt' })).toBe('seatbelt');
    expect(alarmKind({ code: 115, label: 'Fatigue driving' })).toBeNull();
  });
});

describe('buildEndOfDay', () => {
  const r = buildEndOfDay(input);

  it('fleet summary', () => {
    expect(r.fleet).toEqual({ units: 3, withData: 2, km: 4322, hours: 210.4, litres: null });
  });

  it('counts safety events in the day only, once each', () => {
    expect(r.safety.counts).toEqual({ speed: 4, brake: 1, accel: 1, seatbelt: 1, phone: 1 });
    expect(r.safety.total).toBe(8);
  });

  it('one row per vehicle, matched by id or plate, worst first', () => {
    expect(r.safety.units.map((u) => [u.plate, u.total])).toEqual([['KCP 134P', 5], ['KBZ 900X', 2], ['KDA 001A', 1]]);
    const kcp = r.safety.units[0];
    expect(kcp).toMatchObject({ speed: 3, brake: 1, accel: 1, peakKmh: 92, limitKmh: 60, overSec: 400, driver: 'Dickson Kiplagat' });
    expect(r.safety.units[2].driver).toBe('Jane');
  });

  it('lists harsh events and dashcam alarms in time order', () => {
    expect(r.safety.events.map((e) => e.kind)).toEqual(['brake', 'accel', 'seatbelt', 'phone']);
    expect(r.safety.events[0].detail).toBe('KCP 134P at Turbo 38 km/h');
    expect(r.safety.events[2].detail).toBe('No seat belt, 54 km/h');
    expect(r.safety.dashcam).toBe(true);
  });

  it('fuel: real refills, confirmed and pending drains', () => {
    expect(r.fuel.refills).toHaveLength(1);
    expect(r.fuel.refillL).toBe(150);
    expect(r.fuel.drains.map((d) => [d.plate, d.litres, d.status])).toEqual([['KDA 001A', 20.5, 'Confirmed drain'], ['KCP 134P', 8, 'Being checked']]);
    expect(r.fuel.drainL).toBe(28.5);
    expect(r.fuel.confirmedDrains).toBe(1);
  });

  it('device health: still down first, faults named', () => {
    expect(r.devices.rows[0]).toMatchObject({ plate: 'KBZ 900X', stillDown: true, episodes: 2 });
    expect(r.devices.rows[0].faults).toContain('Tracker silent');
    expect(r.devices.stillDown).toBe(1);
  });

  it('no dashcams: seatbelt and phone are not counted and it says so', () => {
    const r2 = buildEndOfDay({ ...input, alarms: null });
    expect(r2.safety.dashcam).toBe(false);
    expect(r2.safety.counts.seatbelt).toBe(0);
  });

  it('an empty day', () => {
    const r3 = buildEndOfDay({ dayFrom: DAY, dayTo: DAY + 24 * H });
    expect(r3.safety.total).toBe(0);
    expect(r3.safety.units).toEqual([]);
    expect(r3.fleet.km).toBeNull();
  });
});
