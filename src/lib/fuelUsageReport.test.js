import { describe, it, expect } from 'vitest';
import {
  buildFuelUsage, machineType, lineSite, mainSites, issueSites, siteOptions, forSite,
  earlyRefills, overTank, probeShortL, pumpFlagsOf, lastFullWeek, isDown,
} from './fuelUsageReport';
import { fuelRoster, fuelTotals } from './factoryFuel';

const line = (o) => ({
  lineId: o.id ?? `${o.machine}-${o.day}-${o.shiftNo ?? 1}`, machine: 'EX-01', day: '2026-11-16', shiftNo: 1,
  planStatus: 'APPROVED', department: 'IRRIGATION', workLocation: 'Zone 4', activity: 'Desilting',
  plannedHours: 8, plannedKm: null, fullTank: false, litresRequested: 128, needLitres: 128,
  requestId: null, requestLitres: null, issuedLitres: 0, ...o,
});
const issue = (o) => ({
  id: o.id ?? `${o.machine}-${o.day}-${o.at ?? ''}`, machine: 'EX-01', day: '2026-11-16', at: '2026-11-16T06:30:00',
  startedAt: '2026-11-16T06:20:00', litres: 120, done: true, operator: 'J. Mwita', flags: [], note: null,
  requestId: null, department: 'IRRIGATION', pump: 'Zone 4', readings: { previous: null, estimated: null, physical: 1000 }, sensor: null, ...o,
});
const machine = (o) => ({ reference: 'EX-01', name: 'Excavator', category: 'Excavator', basis: 'HOUR', rate: 16, status: null, tankLitres: 300, vehicleId: 'v1', plate: 'EX 01', ...o });

const week = (o = {}) => ({ factory: 'MUFINDI', from: '2026-11-16', to: '2026-11-22', lines: [], issues: [], machines: [], ...o });

describe('machine types', () => {
  it('one type whatever the register calls it', () => {
    expect(machineType('DIESEL GENERATORS')).toBe('Diesel generator');
    expect(machineType('Diesel Generator')).toBe('Diesel generator');
    expect(machineType('SMALL DIESEL GENERATORS')).toBe('Diesel generator');
    expect(machineType('Concret Mixer')).toBe('Concrete mixer');
    expect(machineType('CONCRETE MIXER')).toBe('Concrete mixer');
    expect(machineType(null)).toBe('Unspecified');
  });
  it('a machine is down when broken down or in the workshop', () => {
    expect(isDown('BROKEN_DOWN')).toBe(true);
    expect(isDown('IN_WORKSHOP')).toBe(true);
    expect(isDown(null)).toBe(false);
  });
});

describe('sites', () => {
  const data = week({
    lines: [
      line({ machine: 'EX-01', day: '2026-11-16', workLocation: 'Zone 4', requestId: 'R1', needLitres: 128 }),
      line({ machine: 'EX-01', day: '2026-11-17', workLocation: 'Zone 4', needLitres: 128 }),
      line({ machine: 'EX-01', day: '2026-11-18', workLocation: 'Factory Site', requestId: 'R3', needLitres: 64 }),
      line({ machine: 'DG-01', day: '2026-11-16', workLocation: '', department: 'FACTORY', needLitres: 88 }),
    ],
    issues: [
      issue({ machine: 'EX-01', day: '2026-11-18', requestId: 'R3', litres: 60 }),
      issue({ machine: 'EX-01', day: '2026-11-19', requestId: null, litres: 100 }),
      issue({ machine: 'MCM-01', day: '2026-11-19', requestId: null, litres: 40, department: 'CIVIL' }),
    ],
  });

  it('a line counts at its own work location, the department where it has none', () => {
    expect(lineSite(data.lines[0])).toBe('Zone 4');
    expect(lineSite(data.lines[3])).toBe('FACTORY');
  });

  it('a machine working at two sites counts under the one with most shifts', () => {
    expect(mainSites(data).get('EX-01')).toBe('Zone 4');
  });

  it('an issue counts at the site of the shift it was requested for, else the machine’s main site, else its department', () => {
    const s = issueSites(data);
    expect(s.get(data.issues[0])).toBe('Factory Site');
    expect(s.get(data.issues[1])).toBe('Zone 4');
    expect(s.get(data.issues[2])).toBe('CIVIL');
  });

  it('one site keeps only its own lines and issues; the site list is busiest first', () => {
    const z = forSite(data, 'Zone 4');
    expect(z.lines).toHaveLength(2);
    expect(z.issues.map((i) => i.litres)).toEqual([100]);
    expect(siteOptions(data)).toEqual(['Zone 4', 'FACTORY', 'Factory Site', 'CIVIL']);
  });
});

describe('the totals are the Fuel page’s', () => {
  const data = week({
    machines: [machine({}), machine({ reference: 'FT-01', category: 'Truck', basis: 'KM_PER_LITRE', rate: 2.8, tankLitres: 400 })],
    lines: [
      line({ machine: 'EX-01', day: '2026-11-16', needLitres: 128 }),
      line({ machine: 'EX-01', day: '2026-11-16', shiftNo: 2, needLitres: 64, plannedHours: 4 }),
      // A full tank with planned hours still has a need; one without hours has none
      line({ machine: 'EX-01', day: '2026-11-17', fullTank: true, litresRequested: null, needLitres: 128 }),
      line({ machine: 'EX-01', day: '2026-11-18', fullTank: true, litresRequested: null, plannedHours: null, needLitres: null }),
      // A km-based truck: planned km ÷ km/L
      line({ machine: 'FT-01', day: '2026-11-17', plannedHours: null, plannedKm: 280, needLitres: 100, workLocation: 'Logistics Centre 2' }),
    ],
    issues: [issue({ machine: 'EX-01', litres: 200 }), issue({ machine: 'FT-01', day: '2026-11-17', litres: 90, done: true })],
  });
  const r = buildFuelUsage(data, { price: 214.03 });

  it('need, issued, shifts and fills match fuelTotals over the same rows', () => {
    const t = fuelTotals(fuelRoster(data));
    expect(r.totals.need).toBe(t.need);
    expect(r.totals.issued).toBe(t.issued);
    expect(r.totals.need).toBe(128 + 64 + 128 + 100);
    expect(r.totals.issued).toBe(290);
    expect(r.totals.shifts).toBe(5);
    expect(r.totals.multiShiftDays).toBe(1);
    expect(r.totals.issuedShare).toBeCloseTo(290 / 420, 5);
    expect(r.totals.issuedCost).toBeCloseTo(290 * 214.03, 2);
  });

  it('the running totals reach the period’s need and issued, a day with no plans adding nothing', () => {
    expect(r.cumulative).toHaveLength(7);
    expect(r.cumulative.at(-1)).toMatchObject({ need: 420, issued: 290 });
    expect(r.cumulative[6].need).toBe(r.cumulative[5].need);
  });

  it('by site and by type add up to the totals', () => {
    expect(r.bySite.reduce((s, x) => s + x.need, 0)).toBe(420);
    expect(r.bySite.reduce((s, x) => s + x.issued, 0)).toBe(290);
    expect(r.byType.map((x) => x.type)).toEqual(['Excavator', 'Truck']);
  });

  it('no price, no cost', () => {
    expect(buildFuelUsage(data).totals.issuedCost).toBeNull();
  });
});

describe('fills too early for what the plan used', () => {
  const ex = (lines, issues, o = {}) => fuelRoster(week({ machines: [machine(o)], lines, issues }))[0];

  it('a full fill followed next morning after a 2-hour shift is too early', () => {
    const row = ex(
      [line({ day: '2026-11-16', plannedHours: 2, needLitres: 32 }), line({ day: '2026-11-17', plannedHours: 8 })],
      [issue({ day: '2026-11-16', at: '2026-11-16T06:00:00', litres: 280 }), issue({ day: '2026-11-17', at: '2026-11-17T06:00:00', litres: 250 })],
    );
    const e = earlyRefills(row);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ plannedUse: 32, lastFill: 280 });
    expect(e[0].fill.litres).toBe(250);
  });

  it('a refill after the plan used most of the last fill is fine', () => {
    const row = ex(
      [line({ day: '2026-11-16', plannedHours: 10 }), line({ day: '2026-11-17', plannedHours: 8 })],
      [issue({ day: '2026-11-16', litres: 200 }), issue({ day: '2026-11-17', at: '2026-11-17T06:30:00', litres: 160 })],
    );
    expect(earlyRefills(row)).toEqual([]);
  });

  it('a km-based truck reads planned km ÷ km/L; an unrated machine is not judged', () => {
    const truck = ex(
      [line({ day: '2026-11-16', plannedHours: null, plannedKm: 56 })],
      [issue({ day: '2026-11-16', litres: 200 }), issue({ day: '2026-11-17', at: '2026-11-17T06:30:00', litres: 180 })],
      { basis: 'KM_PER_LITRE', rate: 2.8 },
    );
    expect(earlyRefills(truck)).toHaveLength(1);
    expect(earlyRefills(truck)[0].plannedUse).toBeCloseTo(20, 5);
    const unrated = ex([line({ day: '2026-11-16' })], [issue({ day: '2026-11-16', litres: 200 }), issue({ day: '2026-11-17', at: '2026-11-17T06:30:00', litres: 180 })], { rate: null });
    expect(earlyRefills(unrated)).toEqual([]);
  });
});

describe('fills bigger than the tank', () => {
  it('more than the tank holds', () => {
    expect(overTank(issue({ litres: 330 }), 300)).toMatchObject({ kind: 'tank', limit: 300, over: 30 });
    expect(overTank(issue({ litres: 310 }), 300)).toBeNull();           // within 5%
  });
  it('more than the room the probe saw before the fill', () => {
    expect(overTank(issue({ litres: 250, sensor: { beforeL: 120 } }), 300)).toMatchObject({ kind: 'room', limit: 180, over: 70 });
    expect(overTank(issue({ litres: 190, sensor: { beforeL: 120 } }), 300)).toBeNull();   // within 20 L
  });
  it('no tank size, no judgement', () => {
    expect(overTank(issue({ litres: 900 }), null)).toBeNull();
  });
});

describe('fuel the probe did not see arrive', () => {
  it('a probe mismatch: issued less the rise', () => {
    expect(probeShortL(issue({ litres: 300, sensor: { check: 'MISMATCH', riseL: 180 } }))).toBe(120);
  });
  it('a match, no sensor, or no rise is not counted', () => {
    expect(probeShortL(issue({ litres: 300, sensor: { check: 'MATCH', riseL: 295 } }))).toBeNull();
    expect(probeShortL(issue({ litres: 300, sensor: { check: 'NO_SENSOR' } }))).toBeNull();
    expect(probeShortL(issue({ litres: 300, sensor: { check: 'MISMATCH', riseL: null } }))).toBeNull();
    expect(probeShortL(issue({ litres: 300, sensor: null }))).toBeNull();
  });
});

describe('pump flags and the rest of the exceptions', () => {
  const data = week({
    machines: [machine({}), machine({ reference: 'DZ-05', category: 'Bull Dozer', status: 'BROKEN_DOWN', rate: 21 }), machine({ reference: 'DG-04', category: 'DIESEL GENERATORS', rate: 11, vehicleId: null })],
    lines: [
      line({ machine: 'EX-01', day: '2026-11-16' }),
      line({ machine: 'DZ-05', day: '2026-11-16', needLitres: 168 }),
      line({ machine: 'DG-04', day: '2026-11-16', needLitres: 88 }), line({ machine: 'DG-04', day: '2026-11-17', needLitres: 88 }),
    ],
    issues: [
      issue({ machine: 'EX-01', litres: 120, note: 'tank was low' }),
      issue({ machine: 'DZ-05', litres: 380, flags: ['Off plan'] }),
      issue({ machine: 'EX-01', day: '2026-11-17', at: '2026-11-17T07:00:00', litres: 100, flags: ['Operator mismatch'], operator: 'P. Lema' }),
    ],
  });
  const r = buildFuelUsage(data);

  it('a note alone is not a pump flag', () => {
    expect(pumpFlagsOf(data.issues[0])).toEqual([]);
    expect(r.totals.flags).toEqual({ fills: 2, offPlanL: 380 });
  });

  it('planned but not fuelled, with its need', () => {
    expect(r.exceptions.plannedNotFuelled).toEqual([expect.objectContaining({ machine: 'DG-04', type: 'Diesel generator', shifts: 2, need: 176, down: false })]);
  });

  it('a broken-down machine on the plan, and what it was issued', () => {
    expect(r.exceptions.downOnPlan).toEqual([expect.objectContaining({ machine: 'DZ-05', type: 'Bull dozer', issued: 380 })]);
  });

  it('by operator: fills, litres and flags', () => {
    const lema = r.byOperator.find((o) => o.operator === 'P. Lema');
    expect(lema).toMatchObject({ fills: 1, litres: 100, flags: 1, machines: 1 });
  });

  it('the register: every machine, with tracker and down marks', () => {
    const dg = r.register.find((x) => x.machine === 'DG-04');
    expect(dg).toMatchObject({ shifts: 2, days: 2, need: 176, issued: 0, fills: 0, difference: -176, tracker: false, down: false });
    expect(r.register.find((x) => x.machine === 'DZ-05').down).toBe(true);
  });
});

describe('the default period', () => {
  it('is the last complete Monday to Sunday', () => {
    expect(lastFullWeek('2026-11-24')).toEqual({ from: '2026-11-16', to: '2026-11-22' });   // a Tuesday
    expect(lastFullWeek('2026-11-23')).toEqual({ from: '2026-11-16', to: '2026-11-22' });   // a Monday
    expect(lastFullWeek('2026-11-22')).toEqual({ from: '2026-11-09', to: '2026-11-15' });   // a Sunday
  });
});

describe('fuel into tanks, and fuel with no pump record', () => {
  const at = (s) => new Date(`${s}+03:00`).toISOString();
  const fill = (o) => ({ id: o.id, vehicleId: o.vehicleId ?? 'v1', filledAt: at(o.at), filledMl: o.litres * 1000, initialFuelLevelMl: 50_000, finalFuelLevelMl: 50_000 + o.litres * 1000, observedRiseMl: null, verdict: o.verdict ?? 'REFILL', vehicle: { registrationPlate: o.plate ?? 'EX 01' } });
  const data = week({
    machines: [machine({}), machine({ reference: 'DG-04', category: 'DIESEL GENERATORS', rate: 11, vehicleId: null, plate: null })],
    lines: [line({ machine: 'EX-01', day: '2026-11-16', needLitres: 128 }), line({ machine: 'EX-01', day: '2026-11-17', needLitres: 128 }), line({ machine: 'DG-04', day: '2026-11-16', needLitres: 88 })],
    issues: [
      issue({ machine: 'EX-01', day: '2026-11-16', at: '2026-11-16T06:30:00', litres: 200 }),          // the probe saw it at 06:40
      issue({ machine: 'DG-04', day: '2026-11-16', at: '2026-11-16T07:00:00', litres: 90 }),           // no tracker: pump only
    ],
  });
  const fillings = [
    fill({ id: 'p1', at: '2026-11-16T06:40:00', litres: 195 }),                // the pump's fill
    fill({ id: 'p2', at: '2026-11-17T18:10:00', litres: 150 }),                // no pump record
    fill({ id: 'p3', at: '2026-11-18T09:00:00', litres: 40, verdict: 'REDISTRIBUTION' }),   // fuel moving in the tank: ignored
    fill({ id: 'p4', vehicleId: 'v9', at: '2026-11-18T09:00:00', litres: 60, plate: 'LMV 9' }),   // a vehicle on no plan
  ];
  const r = buildFuelUsage(data, { fillings, price: 200 });

  it('into the tank: every real probe fill, plus pump fills the probe could not see', () => {
    expect(r.register.find((x) => x.machine === 'EX-01')).toMatchObject({ intoTank: 345, unrecorded: 150, unrecordedFills: 1, issued: 200, difference: 345 - 256 });
    expect(r.register.find((x) => x.machine === 'DG-04')).toMatchObject({ intoTank: 90, unrecorded: 0, issued: 90 });
    expect(r.totals.intoTank).toBe(435);
    expect(r.totals.intoTankShare).toBeCloseTo(435 / 344, 5);
    expect(r.totals.recordedShare).toBeCloseTo(290 / 435, 5);
  });

  it('fuel with no pump record: the probe fills no pump fill claims, with cost', () => {
    expect(r.totals.unrecorded).toEqual({ machines: 1, fills: 1, litres: 150, cost: 30_000 });
    expect(r.exceptions.unrecorded[0]).toMatchObject({ machine: 'EX-01', fills: 1, litres: 150, pumpFills: 1, pumpL: 200 });
  });

  it('a vehicle on no plan and at no pump is counted apart', () => {
    expect(r.totals.otherProbe).toEqual({ fills: 1, litres: 60, vehicles: 1 });
  });

  it('the running total of fuel into tanks follows the fills’ days', () => {
    expect(r.cumulative.map((d) => d.intoTank).slice(0, 3)).toEqual([285, 435, 435]);
  });

  it('a machine with fuel into its tank is not "planned but not fuelled"', () => {
    expect(r.exceptions.plannedNotFuelled).toEqual([]);
  });

  it('without the probe fillings the pump stands alone', () => {
    const p = buildFuelUsage(data);
    expect(p.totals.probeKnown).toBe(false);
    expect(p.totals.intoTank).toBe(290);
    expect(p.totals.unrecorded).toMatchObject({ machines: 0, litres: 0 });
    expect(p.totals.otherProbe).toBeNull();
  });
});
