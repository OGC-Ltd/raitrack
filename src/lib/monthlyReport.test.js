import { describe, it, expect } from 'vitest';
import {
  monthPeriod, monthWeeks, weekOf, previousMonth, lastCompleteMonth, monthUnits, buildMonthlyReport, per1000,
  drainKind, belowBand, against, monthlyBlocks, RATE_MIN_KM,
} from './monthlyReport';
import { dayStart, nightWindows } from './fleetReports';

const at = (s) => Date.parse(`${s}+03:00`);
const NOW = at('2026-11-27T12:00:00');

// Menengai: two Tankers, one Finished Goods, one Menengai unit not on the list
const MENENGAI = [
  { id: 'TANKER - MENENGAI - KCH 012A', name: 'TANKER - MENENGAI - KCH 012A', vehicleId: 'v1', regPlate: 'KCH 012A', vehicleType: 'TRUCK' },
  { id: 'TANKER - MENENGAI - KCK 456G', name: 'TANKER - MENENGAI - KCK 456G', vehicleId: 'v2', regPlate: 'KCK 456G', vehicleType: 'TRUCK' },
  { id: 'FG - MENENGAI - KBT 112R', name: 'FG - MENENGAI - KBT 112R', vehicleId: 'v3', regPlate: 'KBT 112R', vehicleType: 'TRUCK' },
  { id: 'MENENGAI - KZZ 999Z', name: 'MENENGAI - KZZ 999Z', vehicleId: 'v4', regPlate: 'KZZ 999Z', vehicleType: 'TRUCK' },
];

/** A day's usage record. */
const dayRec = (km, x = {}) => ({ km, movingMin: km, idleMin: 10, engineOnMin: 60, readings: 100, fuelReadings: 50, dayShiftKm: km * 0.75, lastAt: null, ...x });

/** A unit's month: `km` on each listed day of October 2026. */
function usageOf(perDay) {
  const days = {};
  for (const [d, km] of Object.entries(perDay)) days[`2026-10-${String(d).padStart(2, '0')}`] = dayRec(km, { lastAt: at(`2026-10-${String(d).padStart(2, '0')}T18:00:00`) });
  return { days, nights: [] };
}

const base = (o = {}) => ({
  month: '2026-10', now: NOW, vehicles: MENENGAI, blocks: {},
  usage: new Map([
    ['v1', usageOf({ 1: 500, 9: 500, 16: 500, 25: 500 })],
    ['v2', usageOf({ 2: 250, 30: 250 })],
    ['v3', usageOf({ 3: 1000 })],
    ['v4', usageOf({ 31: 0 })],
  ]),
  overspeeds: new Map([
    ['v1', [
      { startedAt: '2026-10-01T06:00:00Z', durationSec: 30, distanceM: 500 },
      { startedAt: '2026-10-23T06:00:00Z', durationSec: 60, distanceM: 1000 },
      { startedAt: '2026-10-23T07:00:00Z', durationSec: 3, distanceM: 50 }, // too short: not counted
    ]],
    ['v3', [{ startedAt: '2026-10-10T06:00:00Z', durationSec: 10, distanceM: 200 }]],
  ]),
  conduct: [],
  fuelRate: [],
  thefts: [],
  alarms: null,
  probes: [],
  previous: null,
  ...o,
});

describe('the month and its weeks', () => {
  it('runs on fleet time, midnight to midnight', () => {
    const p = monthPeriod('2026-10', NOW);
    expect(p.from).toBe(at('2026-10-01T00:00:00'));
    expect(p.to).toBe(at('2026-11-01T00:00:00'));
    expect(p.days).toBe(31);
    expect(p.label).toBe('October 2026');
    expect(p.complete).toBe(true);
  });
  it('the month in progress stops at now', () => {
    const p = monthPeriod('2026-11', NOW);
    expect(p.to).toBe(NOW);
    expect(p.complete).toBe(false);
  });
  it('weeks are 1–7, 8–14, 15–21 and 22 to the end, in 31-, 30- and 28-day months', () => {
    expect(monthWeeks(monthPeriod('2026-10', NOW)).map((w) => [w.label, w.days])).toEqual([['1–7', 7], ['8–14', 7], ['15–21', 7], ['22–31', 10]]);
    expect(monthWeeks(monthPeriod('2026-09', NOW)).map((w) => w.label)).toEqual(['1–7', '8–14', '15–21', '22–30']);
    expect(monthWeeks(monthPeriod('2026-02', NOW)).map((w) => [w.label, w.days])).toEqual([['1–7', 7], ['8–14', 7], ['15–21', 7], ['22–28', 7]]);
    const [, , , last] = monthWeeks(monthPeriod('2026-02', NOW));
    expect(last.to).toBe(at('2026-03-01T00:00:00'));
  });
  it('a day falls in its week', () => {
    expect(['2026-10-01', '2026-10-07', '2026-10-08', '2026-10-21', '2026-10-22', '2026-10-31'].map(weekOf)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(weekOf(at('2026-10-07T23:59:00'))).toBe(0);
    expect(weekOf(at('2026-10-08T00:01:00'))).toBe(1);
  });
  it('the month before, and the last complete month', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(lastCompleteMonth(NOW)).toBe('2026-10');
    expect(lastCompleteMonth(at('2026-12-01T00:30:00'))).toBe('2026-11');
  });
});

describe('the groups', () => {
  it('are the map filter\'s, biggest first, and a unit not on the list still counts', () => {
    const { units, groups } = monthUnits(MENENGAI);
    expect(units).toHaveLength(4);
    expect(groups.map((g) => g.label)).toEqual(['Tankers', 'Finished Goods', 'Not on the list']);
    expect(units.find((u) => u.plate === 'KZZ 999Z').kind).toBe('mg:');
  });
  it('another organisation goes by the vehicle type the map shows', () => {
    const { groups } = monthUnits([
      { id: 'KCA 001A', vehicleId: 'a', regPlate: 'KCA 001A', vehicleType: 'TRUCK' },
      { id: 'KCA 002A', vehicleId: 'b', regPlate: 'KCA 002A', vehicleType: 'TRUCK' },
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Truck']);
  });
});

describe('the report', () => {
  const rep = buildMonthlyReport(base());

  it('group totals equal the fleet totals', () => {
    const t = (k) => rep.groupTable.reduce((s, x) => s + (x[k] ?? 0), 0);
    for (const k of ['units', 'moved', 'km', 'overspeed', 'harsh', 'night', 'dashcam', 'breaches']) expect(t(k)).toBe(rep.allGroups[k]);
    expect(rep.breachesByGroup.reduce((s, x) => s + x.value, 0)).toBe(rep.cards.breaches);
    expect(rep.movements.kmByGroup.reduce((s, x) => s + x.value, 0)).toBe(rep.cards.km);
    expect(rep.weekly.reduce((s, w) => s + w.breaches, 0)).toBe(rep.cards.breaches);
    expect(rep.weekly.reduce((s, w) => s + w.km, 0)).toBe(rep.cards.km);
  });

  it('counts overspeeds over 5 s, by group and by week', () => {
    expect(rep.overspeed.events).toBe(3);
    expect(rep.overspeed.units).toBe(2);
    expect(rep.overspeed.byGroup.map((x) => [x.label, x.value])).toEqual([['Tankers', 2], ['Finished Goods', 1], ['Not on the list', 0]]);
    expect(rep.weekly.map((w) => w.overspeed)).toEqual([1, 1, 0, 1]);
    expect(rep.overspeed.top[0]).toMatchObject({ plate: 'KCH 012A', group: 'Tankers', events: 2 });
  });

  it('works breaches per 1,000 km by group and overall', () => {
    const tankers = rep.groupTable.find((x) => x.label === 'Tankers');
    expect(tankers.km).toBe(2500);
    expect(tankers.per1000).toBeCloseTo((2 / 2500) * 1000);
    expect(rep.allGroups.per1000).toBeCloseTo((3 / 3500) * 1000);
    expect(rep.groupTable.find((x) => x.label === 'Not on the list').per1000).toBeNull();
    expect(per1000(5, RATE_MIN_KM - 1)).toBeNull();
    expect(per1000(5, 1000)).toBe(5);
  });

  it('cards: units monitored and moved, km per active unit-day', () => {
    expect(rep.cards).toMatchObject({ units: 4, moved: 3, km: 3500, breaches: 3 });
    expect(rep.cards.kmPerUnitDay).toBeCloseTo(3500 / 7);
    expect(rep.utilisation).toMatchObject({ moved: 3, notMoved: 1, noData: 0 });
    expect(rep.movements.busiest).toEqual({ day: '2026-10-03', km: 1000 });
  });

  it('adds harsh driving, dashcam alerts and night trips to the breaches', () => {
    const { units } = monthUnits(MENENGAI);
    const fg = units.find((u) => u.plate === 'KBT 112R');
    const usage = base().usage;
    const nights = nightWindows(monthPeriod('2026-10', NOW).from, monthPeriod('2026-10', NOW).to);
    // two nights driven: one in week 1, one in week 4; a third too short to count
    usage.set('v3', { ...usage.get('v3'), nights: [
      { from: nights[3][0], km: 12 }, { from: nights[25][0], km: 4 }, { from: nights[10][0], km: 0.2 },
    ] });
    const r = buildMonthlyReport(base({
      usage,
      conduct: [{ unit: fg, accel: 2, brake: 1, corner: 0, seatbelt: 1, phone: 0, covered: 0, total: 4,
        days: { '2026-10-03': { harsh: 3, dashcam: 0 }, '2026-10-29': { harsh: 0, dashcam: 1 } } }],
    }));
    const row = r.groupTable.find((x) => x.label === 'Finished Goods');
    expect(row).toMatchObject({ overspeed: 1, harsh: 3, dashcam: 1, night: 2, breaches: 7 });
    expect(r.night).toMatchObject({ trips: 2, units: 1 });
    expect(r.night.km).toBeCloseTo(16.2);
    expect(r.weekly.reduce((s, w) => s + w.breaches, 0)).toBe(r.cards.breaches);
    expect(r.weekly.map((w) => w.night)).toEqual([1, 0, 0, 1]);
  });
});

describe('fuel', () => {
  it('a drain is confirmed theft, suspected (siphon, not ruled out) or another drain; ruled-out ones are not a loss', () => {
    expect(drainKind({ reviewStatus: 'CONFIRMED_THEFT', verdict: 'REDISTRIBUTION' })).toBe('confirmed');
    expect(drainKind({ reviewStatus: 'NOT_THEFT', verdict: 'DRAIN', drainCause: 'SIPHON' })).toBeNull();
    expect(drainKind({ reviewStatus: 'PROBE_FAULT', verdict: 'DRAIN' })).toBeNull();
    expect(drainKind({ verdict: 'DRAIN', drainCause: 'SIPHON' })).toBe('suspected');
    expect(drainKind({ reviewStatus: 'DISMISSED', verdict: 'DRAIN', drainCause: 'SIPHON' })).toBe('suspected');
    expect(drainKind({ verdict: 'DRAIN', drainCause: 'INDETERMINATE' })).toBe('drain');
    expect(drainKind({ verdict: 'REFILL' })).toBeNull();
  });

  it('sums the drains by group and week, and lists the confirmed thefts', () => {
    const r = buildMonthlyReport(base({ thefts: [
      { vehicleId: 'v1', beganAt: '2026-10-02T10:00:00Z', reviewStatus: 'CONFIRMED_THEFT', verdict: 'DRAIN', stolenMl: 80_000, cleanDropMl: 60_000 },
      { vehicleId: 'v3', beganAt: '2026-10-20T10:00:00Z', verdict: 'DRAIN', drainCause: 'SIPHON', stolenMl: 30_000 },
      { vehicleId: 'v3', beganAt: '2026-10-20T11:00:00Z', reviewStatus: 'NOT_THEFT', verdict: 'DRAIN', drainCause: 'SIPHON', stolenMl: 99_000 },
      { vehicleId: 'v2', beganAt: '2026-09-30T10:00:00Z', reviewStatus: 'CONFIRMED_THEFT', verdict: 'DRAIN', stolenMl: 50_000 }, // last month
    ] }));
    expect(r.fuel.lost).toMatchObject({ confirmedL: 60, suspectedL: 30, drainL: 0, totalL: 90 });
    expect(r.weekly.map((w) => [w.confirmedL, w.suspectedL])).toEqual([[60, 0], [0, 0], [0, 30], [0, 0]]);
    expect(r.fuel.theftUnits).toEqual([{ plate: 'KCH 012A', group: 'Tankers', kind: 'mg:Tankers', litres: 60, count: 1 }]);
    expect(r.attention[0]).toBe('Tankers: 60 L of confirmed theft on 1 unit.');
  });

  it('rates each group against its units\' targets, and bands the units below', () => {
    const row = (plate, km, l, target) => ({ plate, distanceKm: km, consumedL: l, kmPerL: km / l, target: { kmPerL: target }, belowTarget: km / l < target });
    const r = buildMonthlyReport(base({ fuelRate: [row('KCH 012A', 2000, 1000, 2.5), row('KCK 456G', 500, 200, 2.5), row('KBT 112R', 1000, 200, 4)] }));
    const tankers = r.fuel.groups.find((x) => x.label === 'Tankers');
    expect(tankers.kmPerL).toBeCloseTo(2500 / 1200);
    expect(tankers.target).toBeCloseTo(2.5);
    expect(tankers.below).toBe(1);
    expect(r.fuel.below).toBe(1);
    expect(r.fuel.bands).toEqual({ b5: 0, b10: 0, b20: 1, over: 0 });
    expect(belowBand({ kmPerL: 1.5, target: { kmPerL: 2 } })).toBe('over');
    expect(belowBand({ kmPerL: 2.1, target: { kmPerL: 2 } })).toBeNull();
    expect(r.summary[2]).toMatch(/^Tankers is below fuel target/);
  });

  it('probes: fitted and calibrated now, working by the month\'s own readings', () => {
    const usage = base().usage;
    usage.set('v2', usageOf({ 2: 250 })); // no fuel readings in the last week
    const r = buildMonthlyReport(base({ usage, probes: [
      { vehicleId: 'v1', fuelSensor: { fitted: true, uncalibrated: false } },
      { vehicleId: 'v2', fuelSensor: { fitted: true, uncalibrated: false } },
      { vehicleId: 'v3', fuelSensor: { fitted: true, uncalibrated: true } },
      { vehicleId: 'v4', fuelSensor: { fitted: false } },
    ] }));
    expect(r.fuel.probes).toEqual({ fitted: 3, working: 1, notReporting: 1, uncalibrated: 1 });
    expect(r.dataAvailability.map((w) => w.probesWorking)).toEqual([1, 0.5, 0.5, 0.5]);
  });
});

describe('dormant and alarms', () => {
  it('dormant at the month\'s end, as the Dormant Assets sections count it', () => {
    const r = buildMonthlyReport(base());
    // v2 last seen 30 Oct (offline yesterday), v1 on 25 Oct and v3 on 3 Oct (over 48 hrs); v4 reported on the 31st
    expect(r.dormant.total).toBe(3);
    expect(r.dormant.top.map((x) => x.plate)).toEqual(['KBT 112R', 'KCH 012A', 'KCK 456G']);
    expect(r.dormant.byGroup.map((x) => x.value)).toEqual([2, 1, 0]);
  });
  it('alarms by kind and group, where they can be read', () => {
    expect(buildMonthlyReport(base()).alarms).toBeNull();
    const r = buildMonthlyReport(base({ alarms: [{ plate: 'KCH 012A', total: 5, phone: 3, seatbelt: 2 }] }));
    expect(r.alarms.total).toBe(5);
    expect(r.alarms.byGroup.find((x) => x.label === 'Tankers').value).toBe(5);
  });
});

describe('first month and later months', () => {
  it('with no data the month before, it is the first month: no variance', () => {
    const r = buildMonthlyReport(base());
    expect(r.first).toBe(true);
    expect(r.variance).toBeNull();
    const empty = buildMonthlyReport(base({ month: '2026-09', usage: new Map(), overspeeds: new Map() }));
    expect(empty.empty).toBe(true);
    expect(buildMonthlyReport(base({ previous: empty })).first).toBe(true);
  });
  it('later months carry last month and the variance, favourable or adverse', () => {
    const before = buildMonthlyReport(base());
    const usage = base().usage;
    usage.set('v1', usageOf({ 1: 1000, 9: 1000 }));
    const now = buildMonthlyReport(base({ usage, overspeeds: new Map(), previous: before }));
    expect(now.first).toBe(false);
    expect(now.variance.cards.breaches).toEqual({ now: 0, before: 3, change: -3, good: true });
    expect(now.variance.cards.km.change).toBe(0);
    expect(now.variance.groups['mg:Tankers'].breaches.good).toBe(true);
    expect(against('km', 900, 1000).good).toBe(false);
    expect(against('per1000', 1, 2).good).toBe(true);
  });
});

describe('an organisation\'s blocks', () => {
  const all = () => true;
  it('a templated block only where the organisation has that report', () => {
    expect(monthlyBlocks('MENENGAI', all)).toMatchObject({ tankers: true, deliveries: true, tatFuel: false, dormant: true });
    expect(monthlyBlocks('SUKARI', all)).toMatchObject({ tankers: false, deliveries: false, tatFuel: true, geofences: true, recovery: true, probeReport: true });
    expect(monthlyBlocks('NZOIA', all).probeReport).toBe(false);
    expect(monthlyBlocks('KASULU', all)).toMatchObject({ tankers: false, dormant: false });
  });
  it('what the viewer cannot see is left out', () => {
    expect(monthlyBlocks('MENENGAI', (p) => p !== 'vss:alarms').alarms).toBe(false);
    expect(monthlyBlocks('MENENGAI', () => false).tankers).toBe(false);
  });
});

describe('summary rules', () => {
  it('largest share, highest rate, week direction', () => {
    const r = buildMonthlyReport(base());
    expect(r.summary[0]).toBe('Tankers and Finished Goods account for 100% of the 3 policy breaches; Finished Goods has the highest rate at 1.00 per 1,000 km.');
    expect(r.summary[1]).toMatch(/^The breach rate (rose|fell|held steady) from /);
    expect(r.attention[1]).toMatch(/^Finished Goods: the highest breach rate/);
    expect(r.attention[2]).toBe('Tankers: 2 of 2 units did not move or have dormant trackers.');
  });
  it('a quiet month says so', () => {
    const r = buildMonthlyReport(base({ overspeeds: new Map() }));
    expect(r.summary[0]).toBe('No policy breaches were recorded this month.');
    expect(r.attention[0]).toBe('No confirmed theft this month.');
  });
});

it('fleet days start at Nairobi midnight', () => {
  expect(dayStart('2026-10-01')).toBe(at('2026-10-01T00:00:00'));
});
