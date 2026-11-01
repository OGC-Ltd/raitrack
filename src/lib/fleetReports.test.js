import { describe, it, expect } from 'vitest';
import {
  behaviourRows, overspeedRows, nightRows, utilisationRows, sections, summariseWindows,
  nightWindows, hourColumns, presetRange, daysCovering, fromLocalInput, toLocalInput, fleetDay, minutesWords, periodWords,
} from './fleetReports';
import { scopeUnits, groupsFor, unitKey, vehicleKeys } from './fleetGroups';

const at = (s) => Date.parse(`${s}+03:00`);

const vehicles = [
  { id: 'VS - Menengai - KCS 082M', vehicleId: 'v1', regPlate: 'KCS 082M' },
  { id: 'CPO - KCN 901F', vehicleId: 'v2' },
  { id: 'CPO - KCN 901F-CAMERA', vehicleId: 'v3' },
  { id: 'RAIMDF - FL 01', vehicleId: 'v4' },
  { id: 'OTHER - KAA 111A', vehicleId: 'v5' },
];
const groups = [
  { name: 'Van Sales', units: [['KCS 082M', 'Hino'], ['KDE 999X', 'Hino']] },
  { name: 'Tankers', units: [['KCN 901F', 'Tanker', 0]] },
  { name: 'RAI MDF Equipment', units: [['FL 01', 'Forklift']] },
];

describe('groups', () => {
  it('reports only the listed units, under their group', () => {
    const { units, missing } = scopeUnits(vehicles, groups);
    expect(units.map((u) => [u.plate, u.group])).toEqual([['KCS 082M', 'Van Sales'], ['KCN 901F', 'Tankers'], ['FL 01', 'RAI MDF Equipment']]);
    expect(missing).toEqual([{ plate: 'KDE 999X', group: 'Van Sales' }]);
  });

  it('keeps a truck with two trackers as one unit', () => {
    const { units } = scopeUnits(vehicles, groups, 'Tankers');
    expect(units).toHaveLength(1);
    expect(units[0].vehicles.map((v) => v.vehicleId)).toEqual(['v2', 'v3']);
  });

  it('without a list, every unit is reported, one group', () => {
    const { units } = scopeUnits(vehicles, null);
    expect(units.map((u) => u.plate)).toEqual(['KCS 082M', 'KCN 901F', 'RAIMDF - FL 01', 'KAA 111A']);
    expect(units[1].vehicles).toHaveLength(2);
  });

  it('Menengai has its list; others do not', () => {
    expect(groupsFor('MENENGAI').map((g) => g.name)).toEqual(
      ['Tankers', 'Finished Goods', 'Van Sales', 'Light Vehicles', 'Equipment', 'Farm Equipment', 'RAI MDF FG', 'RAI MDF Equipment']);
    expect(groupsFor('SUKARI')).toBeNull();
    expect(unitKey('kcs 082m')).toBe('KCS082M');
    expect(vehicleKeys({ id: 'RAIMDF - FL 01' }).has('FL01')).toBe(true);
  });
});

describe('fleet time', () => {
  it('presets', () => {
    const now = at('2026-11-01T13:00:00');
    expect(presetRange('yesterday', now)).toEqual({ from: at('2026-10-31T00:00:00'), to: at('2026-11-01T00:00:00') });
    expect(presetRange('lastNight', now)).toEqual({ from: at('2026-10-31T12:00:00'), to: at('2026-11-01T12:00:00') });
  });

  it('night windows cut the period to 19:00–05:00, across midnight', () => {
    const w = nightWindows(at('2026-10-31T12:00:00'), at('2026-11-01T12:00:00'));
    expect(w).toEqual([[at('2026-10-31T19:00:00'), at('2026-11-01T05:00:00')]]);
    const two = nightWindows(at('2026-10-30T00:00:00'), at('2026-11-01T00:00:00'));
    expect(two).toEqual([
      [at('2026-10-30T00:00:00'), at('2026-10-30T05:00:00')],
      [at('2026-10-30T19:00:00'), at('2026-10-31T05:00:00')],
      [at('2026-10-31T19:00:00'), at('2026-11-01T00:00:00')],
    ]);
  });

  it('hour columns follow the period, or the whole day for longer ones', () => {
    expect(hourColumns(at('2026-11-01T06:00:00'), at('2026-11-01T09:30:00'))).toEqual([6, 7, 8, 9]);
    expect(hourColumns(at('2026-10-30T00:00:00'), at('2026-11-01T00:00:00'))).toHaveLength(24);
  });

  it('days, inputs', () => {
    expect(daysCovering(at('2026-10-31T19:00:00'), at('2026-11-01T05:00:00'))).toEqual(['2026-10-31', '2026-11-01']);
    expect(fromLocalInput(toLocalInput(at('2026-11-01T05:00:00')))).toBe(at('2026-11-01T05:00:00'));
    expect(fleetDay(at('2026-11-01T00:30:00'))).toBe('2026-11-01');
    expect(minutesWords(125)).toBe('2 h 05 min');
  });
});

describe('driver behaviour', () => {
  const day = { from: at('2026-11-01T00:00:00'), to: at('2026-11-02T00:00:00') };
  const ev = (vehicleId, ts, alertType = 'HARSH_ACCELERATION') => ({ vehicleId, alertType, ts: new Date(at(ts)).toISOString() });
  const alarm = (vehicleId, ts, code) => ({ vehicleId, code, occurredMs: at(ts) });
  const withDrivers = vehicles.map((v) => (v.vehicleId === 'v1' ? { ...v, driver: 'Osero Monari' } : v));
  const { units } = scopeUnits(withDrivers, groups);

  it('counts the four kinds per vehicle, with its driver', () => {
    const rows = behaviourRows(units, [
      ev('v1', '2026-11-01T06:10:00'), ev('v1', '2026-11-01T06:50:00'), ev('v1', '2026-11-01T08:00:00', 'HARSH_BRAKING'),
      ev('v5', '2026-11-01T07:00:00'),                  // not on the list
      ev('v1', '2026-10-31T23:00:00'),                  // outside the period
    ], [
      alarm('v1', '2026-11-01T09:00:00', 125), alarm('v1', '2026-11-01T09:30:00', 51),   // no seatbelt
      alarm('v1', '2026-11-01T10:00:00', 116),                                            // on phone
      alarm('v1', '2026-11-01T10:05:00', 999),                                            // another alarm: not counted
    ], day);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accel: 2, brake: 1, seatbelt: 2, phone: 1, total: 6, driver: 'Osero Monari', dashcam: true, suspect: false });
  });

  it('a truck reporting through two units is counted once', () => {
    const rows = behaviourRows(units, [ev('v2', '2026-11-01T07:00:00'), ev('v3', '2026-11-01T07:00:00'), ev('v3', '2026-11-01T07:30:00')], [], day);
    expect(rows.map((r) => [r.unit.plate, r.accel])).toEqual([['KCN 901F', 2]]);
  });

  it('a vehicle without a dashcam has no seatbelt or phone count', () => {
    const [r] = behaviourRows(units, [ev('v2', '2026-11-01T07:00:00')], [alarm('v2', '2026-11-01T08:00:00', 116)], day);
    expect(r).toMatchObject({ dashcam: false, total: 1 });
    const none = behaviourRows(units, [ev('v1', '2026-11-01T07:00:00')], [alarm('v1', '2026-11-01T08:00:00', 116)], { ...day, dashcams: false });
    expect(none[0]).toMatchObject({ dashcam: false, total: 1 });
  });

  it('flags a count no driver could make', () => {
    const many = Array.from({ length: 150 }, (_, i) => ev('v1', `2026-11-01T10:${String(i % 60).padStart(2, '0')}:00`));
    const [r] = behaviourRows(units, many, [], day);
    expect(r.suspect).toBe(true);
  });
  it('counts covered cameras from the dashcam', () => {
    const [r] = behaviourRows(units, [], [alarm('v1', '2026-11-01T09:00:00', 123), alarm('v1', '2026-11-01T09:10:00', 3)], day);
    expect(r).toMatchObject({ covered: 2, total: 2 });
  });

  it('adds what operators logged, once when the camera caught it too', () => {
    const log = (kind, ts, plate = 'KCS 082M') => ({ id: `${kind}${ts}`, kind, at: at(ts), plate, vehicleId: null });
    const rows = behaviourRows(units, [], [alarm('v1', '2026-11-01T14:55:00', 116)], { ...day, logged: [
      log('phone', '2026-11-01T14:56:00'),   // the same incident as the 14:55 alarm
      log('phone', '2026-11-01T16:00:00'),   // a second one, no alarm
      log('covered', '2026-11-01T12:00:00'),
      log('other', '2026-11-01T12:30:00'),   // listed, not counted
      log('phone', '2026-10-30T12:00:00'),   // outside the period
    ] });
    expect(rows[0]).toMatchObject({ phone: 2, covered: 1, logged: 2, total: 3 });
    expect(rows.logged.map((e) => [e.kind, e.matched, e.counted])).toEqual([
      ['covered', false, true], ['other', false, false], ['phone', true, false], ['phone', false, true]]);
  });

  it('an operator entry counts even on a vehicle with no dashcam', () => {
    const [r] = behaviourRows(units, [], [], { ...day, logged: [{ id: 'x', kind: 'seatbelt', at: at('2026-11-01T10:00:00'), vehicleId: 'v2' }] });
    expect(r).toMatchObject({ dashcam: false, seatbelt: 1, total: 1 });
  });
});

describe('overspeeding over 5 minutes', () => {
  const { units } = scopeUnits(vehicles, groups);
  it('counts only unbroken overspeeds longer than 5 minutes, with their distance', () => {
    const rows = overspeedRows(units, new Map([
      ['v1', [
        { durationSec: 301, distanceM: 7_500, peakKmh: 92, limitKmh: 80, driverName: 'Osero' },
        { durationSec: 300, distanceM: 6_000, peakKmh: 99, limitKmh: 80 },   // exactly 5 min: out
        { durationSec: 600, distanceM: 15_000, peakKmh: 88, limitKmh: 80 },
      ]],
      ['v4', [{ durationSec: 120, distanceM: 2_000, peakKmh: 70, limitKmh: 60 }]],
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, seconds: 901, km: 22.5, peakKmh: 92, driver: 'Osero' });
  });
});

describe('distance inside windows', () => {
  // A unit moving east at about 60 km/h, a reading a minute.
  const pings = (from, n) => Array.from({ length: n }, (_, i) => ({ t: from + i * 60_000, lat: -0.3, lng: 36 + i * 0.009, speedKmh: 60, engineOn: true }));
  it('counts only what falls inside each window', () => {
    const p = pings(at('2026-10-31T18:00:00'), 180); // 18:00 → 21:00
    const all = summariseWindows(p, [[at('2026-10-31T18:00:00'), at('2026-10-31T21:00:00')]]);
    const night = summariseWindows(p, [[at('2026-10-31T19:00:00'), at('2026-10-31T21:00:00')]]);
    expect(all.km).toBeGreaterThan(170);
    expect(night.km / all.km).toBeGreaterThan(0.64);
    expect(night.km / all.km).toBeLessThan(0.69);
  });

  it('night lists movers only; utilisation lists everyone, idle units included', () => {
    const { units } = scopeUnits(vehicles, groups);
    const per = new Map([['v1', { km: 120, movingMin: 140, engineOnMin: 160, idleMin: 20, readings: 300 }],
                         ['v2', { km: 0.1, readings: 50 }], ['v3', { km: 0, readings: 0 }]]);
    expect(nightRows(units, per).map((r) => r.unit.plate)).toEqual(['KCS 082M']);
    const u = utilisationRows(units, per);
    expect(u.map((r) => [r.unit.plate, r.km, r.noData])).toEqual([['KCS 082M', 120, false], ['KCN 901F', 0.1, false], ['FL 01', 0, true]]);
    const s = sections(u, groups.map((g) => g.name), (r) => r.km);
    expect(s.map((x) => [x.name, x.rows.length, x.total])).toEqual([['Van Sales', 1, 120], ['Tankers', 1, 0.1], ['RAI MDF Equipment', 1, 0]]);
  });
});

describe('fuel in the utilisation report', () => {
  const run = (from, n, startL, perMinL) => Array.from({ length: n }, (_, i) => ({
    t: from + i * 60_000, lat: -0.3, lng: 36 + i * 0.009, speedKmh: 60, engineOn: true, fuelLevelMl: (startL - i * perMinL) * 1000,
  }));
  it('adds up the fuel used and says when there is no sensor', () => {
    const p = run(at('2026-10-31T08:00:00'), 120, 300, 0.5); // ~60 L over 2 hours
    const s = summariseWindows(p, [[at('2026-10-31T00:00:00'), at('2026-11-01T00:00:00')]]);
    expect(s.fuelSensor).toBe(true);
    expect(s.fuelSeen).toBe(true);
    expect(s.usedL).toBeGreaterThan(55); // the ends are medians of five readings, so a little under 59.5
    expect(s.usedL).toBeLessThan(60);
    const none = summariseWindows(p.map((x) => ({ ...x, fuelLevelMl: undefined })), [[at('2026-10-31T00:00:00'), at('2026-11-01T00:00:00')]]);
    expect(none.fuelSensor).toBe(false);
  });
});

describe('period words', () => {
  it('names the day once when the period is one day', () => {
    expect(periodWords(at('2026-10-31T12:00:00'), at('2026-10-31T13:00:00'))).toBe('31 Oct 2026, 12:00hrs – 13:00hrs');
    expect(periodWords(at('2026-10-31T00:00:00'), at('2026-11-01T00:00:00'))).toBe('31 Oct 2026, 00:00hrs – 24:00hrs');
  });
  it('names both days when it spans two', () => {
    expect(periodWords(at('2026-10-31T19:00:00'), at('2026-11-01T05:00:00'))).toBe('31 Oct 2026, 19:00hrs – 1 Nov 2026, 05:00hrs');
  });
});
