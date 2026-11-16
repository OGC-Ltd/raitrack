import { describe, it, expect } from 'vitest';
import { machineKind, machineryRows, dayWindows, hourWindows, machineWindows, engineHoursOf, meterAdvance } from './fleetReports';
import { REPORTS, csvTable, shownColumns } from './reportTables';
import { reportKeysFor, hasMachineryTab, REPORT_NODES } from './reportNav';

const at = (s) => Date.parse(`${s}+03:00`);
const unit = (plate, vehicleId) => ({ key: plate.replace(/\W/g, ''), plate, type: '', group: null, vehicles: [{ vehicleId, id: plate }] });
const ex = unit('MUFINDI - EX 04', 'v1');
const dz = unit('MUFINDI: DZ 07', 'v2');

/** A reading every 10 minutes from `from` to `to`, engine on, the hour meter ticking with it. */
function running(from, to, { meterAt = 1000, meter = true } = {}) {
  const out = [];
  for (let t = at(from); t <= at(to); t += 600_000) {
    out.push({ t, engineOn: true, speedKmh: 0, lat: -8.6, lng: 35.3, ...(meter ? { engineHoursMeter: meterAt + (t - at(from)) / 3_600_000 } : {}) });
  }
  return out;
}

describe('machineKind', () => {
  it('takes excavators and dozers by the server’s own plate test, and nothing else', () => {
    expect(machineKind(ex)).toBe('Excavators');
    expect(machineKind(dz)).toBe('Dozers');
    expect(machineKind(unit('MUFINDI - CTR 03', 'v3'))).toBeNull();
    expect(machineKind(unit('EXCAVATOR001', 'v4'))).toBeNull();
  });
});

describe('dayWindows', () => {
  it('cuts the period at fleet midnight', () => {
    const w = dayWindows(at('2026-11-14T00:00:00'), at('2026-11-16T00:00:00'));
    expect(w.map((d) => d.day)).toEqual(['2026-11-14', '2026-11-15']);
    expect(w[1].from).toBe(at('2026-11-15T00:00:00'));
  });

  it('keeps a period of an hour as one short window', () => {
    const w = dayWindows(at('2026-11-16T14:00:00'), at('2026-11-16T15:00:00'));
    expect(w).toEqual([{ day: '2026-11-16', from: at('2026-11-16T14:00:00'), to: at('2026-11-16T15:00:00') }]);
  });
});

describe('engineHoursOf', () => {
  it('prefers the hour meter, falls back to ignition, and ignores a meter that jumped', () => {
    expect(engineHoursOf({ engineHoursToday: 6.5, engineOnMin: 300 })).toEqual({ hours: 6.5, from: 'meter' });
    expect(engineHoursOf({ engineHoursToday: null, engineOnMin: 300 })).toEqual({ hours: 5, from: 'ignition' });
    expect(engineHoursOf({ engineHoursToday: 4000, engineOnMin: 120 })).toEqual({ hours: 2, from: 'ignition' });
  });
});

describe('machineryRows', () => {
  const days = dayWindows(at('2026-11-14T00:00:00'), at('2026-11-16T00:00:00'));
  const pings = new Map([['v1', [...running('2026-11-14T07:00:00', '2026-11-14T13:00:00'), ...running('2026-11-15T08:00:00', '2026-11-15T10:00:00')]]]);

  it('makes a row per machine per day it ran, and names the machines that did not run', () => {
    const { rows, idle } = machineryRows([ex, dz], pings, days);
    expect(rows.map((r) => [r.unit.plate, r.day])).toEqual([['MUFINDI - EX 04', '2026-11-14'], ['MUFINDI - EX 04', '2026-11-15']]);
    expect(rows[0].hours).toBeCloseTo(6, 5);
    expect(rows[0].hoursFrom).toBe('meter');
    expect(rows[0].section).toBe('Excavators');
    expect(idle.map((u) => u.plate)).toEqual(['MUFINDI: DZ 07']);
  });

  it('reads the table: hours, and L/h left blank without sound fuel', () => {
    const { rows } = machineryRows([ex], pings, days);
    const def = REPORTS.machinery;
    const cells = def.cells(rows[0]);
    expect(def.columns({ byDay: true })).toEqual(['Machine', 'Type', 'Day', 'Engine hours', 'Fuel used, L', 'Burn rate, L/h', 'Actual, L/h']);
    expect(def.columns({ byDay: false })[2]).toBe('Hour');
    expect(cells).toHaveLength(7);
    expect(cells[0]).toBe('MUFINDI - EX 04');
    expect(cells[2]).toBe('Sat 14 Nov');
    expect(cells[3]).toBe('6.0');
    expect(cells[5]).toBe('-');
    expect(cells[6]).toBe('-');
    expect(def.countWords(rows)).toBe('1 machine');
    const kpi = Object.fromEntries(def.kpis(rows).map((k) => [k.label, k.value]));
    expect(kpi['Engine hours']).toBe('8.0 h');
    expect(csvTable(def, [{ name: 'Excavators', rows }], {}).body).toHaveLength(2);
  });

  it('marks hours read from the ignition', () => {
    const p = new Map([['v1', running('2026-11-14T07:00:00', '2026-11-14T09:00:00', { meter: false })]]);
    const { rows } = machineryRows([ex], p, days);
    expect(REPORTS.machinery.cells(rows[0])[3]).toBe('2.0*');
  });

  it('opens on today, not yesterday', () => {
    expect(REPORTS.machinery.preset).toBe('today');
  });
});

describe('by the hour', () => {
  it('cuts the period at each clock hour, Nairobi', () => {
    const w = hourWindows(at('2026-11-16T13:20:00'), at('2026-11-16T15:40:00'));
    expect(w.map((x) => [x.hour, x.from, x.to])).toEqual([
      [13, at('2026-11-16T13:20:00'), at('2026-11-16T14:00:00')],
      [14, at('2026-11-16T14:00:00'), at('2026-11-16T15:00:00')],
      [15, at('2026-11-16T15:00:00'), at('2026-11-16T15:40:00')],
    ]);
  });

  it('counts the meter from the reading before the hour, so the hours add up to the day', () => {
    const p = running('2026-11-14T07:05:00', '2026-11-14T10:05:00');
    const day = machineryRows([ex], new Map([['v1', p]]), dayWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00'))).rows;
    const hrs = machineryRows([ex], new Map([['v1', p]]), hourWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00'))).rows;
    expect(hrs.map((r) => r.hour)).toEqual([7, 8, 9, 10]);
    expect(hrs.every((r) => r.hoursFrom === 'meter')).toBe(true);
    expect(hrs.reduce((s, r) => s + r.hours, 0)).toBeCloseTo(day[0].hours, 5);
    expect(hrs[1].hours).toBeCloseTo(1, 5);
  });

  it('labels each hour, and an hour cut short by the period where it ends', () => {
    const p = running('2026-11-14T07:00:00', '2026-11-14T08:30:00');
    const { rows } = machineryRows([ex], new Map([['v1', p]]), hourWindows(at('2026-11-14T07:00:00'), at('2026-11-14T08:30:00')));
    expect(rows.map((r) => REPORTS.machinery.cells(r)[2])).toEqual(['Sat 14 Nov 07:00–08:00', 'Sat 14 Nov 08:00–08:30']);
    expect(REPORTS.machinery.countWords(rows)).toBe('1 machine');
  });

  it('ignores a meter that ran backwards or past the window', () => {
    expect(meterAdvance(null, [{ engineHoursMeter: 10 }, { engineHoursMeter: 9 }])).toBeNull();
    expect(engineHoursOf({ engineOnMin: 30 }, 5, 1)).toEqual({ hours: 0.5, from: 'ignition' });
  });
});

describe('the hours picked, on each day, to the minute', () => {
  const from = at('2026-11-14T00:00:00');
  const to = at('2026-11-17T00:00:00');

  it('keeps those hours on every day, not one stretch from the first morning to the last afternoon', () => {
    const w = machineWindows(from, to, { start: 6, end: 14 });
    expect(w).toHaveLength(24);
    expect(new Set(w.map((x) => x.hour))).toEqual(new Set([6, 7, 8, 9, 10, 11, 12, 13]));
    expect([...new Set(w.map((x) => x.day))]).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
  });

  it('cuts at the minute: 06:30 to 08:15 is 06:30–07:00, 07:00–08:00, 08:00–08:15', () => {
    const w = machineWindows(at('2026-11-16T00:00:00'), at('2026-11-17T00:00:00'), { start: 6.5, end: 8.25 });
    expect(w.map((x) => [x.from, x.to])).toEqual([
      [at('2026-11-16T06:30:00'), at('2026-11-16T07:00:00')],
      [at('2026-11-16T07:00:00'), at('2026-11-16T08:00:00')],
      [at('2026-11-16T08:00:00'), at('2026-11-16T08:15:00')],
    ]);
  });

  it('cuts each day row to the hours', () => {
    const w = machineWindows(from, to, { start: 6, end: 14, byDay: true });
    expect(w.map((x) => [x.day, x.from, x.to])).toEqual([
      ['2026-11-14', at('2026-11-14T06:00:00'), at('2026-11-14T14:00:00')],
      ['2026-11-15', at('2026-11-15T06:00:00'), at('2026-11-15T14:00:00')],
      ['2026-11-16', at('2026-11-16T06:00:00'), at('2026-11-16T14:00:00')],
    ]);
  });

  it('runs a night shift overnight, counted on the day it starts', () => {
    // The period as the page makes it for the 14th to the 15th, 19:30 to 07:30: to the morning of the 16th
    const w = machineWindows(at('2026-11-14T19:30:00'), at('2026-11-16T07:30:00'), { start: 19.5, end: 7.5, byDay: true });
    expect(w.map((x) => [x.day, x.from, x.to])).toEqual([
      ['2026-11-14', at('2026-11-14T19:30:00'), at('2026-11-15T07:30:00')],
      ['2026-11-15', at('2026-11-15T19:30:00'), at('2026-11-16T07:30:00')],
    ]);
    expect(machineWindows(at('2026-11-14T19:30:00'), at('2026-11-15T07:30:00'), { start: 19.5, end: 7.5 })).toHaveLength(13);
  });

  it('takes the whole day, and a custom range, as one stretch', () => {
    expect(machineWindows(from, to, { byDay: true })).toEqual(dayWindows(from, to));
    expect(machineWindows(from, to)).toEqual(hourWindows(from, to));
    const c = machineWindows(at('2026-11-15T10:20:00'), at('2026-11-16T09:40:00'), { byDay: true });
    expect(c.map((x) => [x.from, x.to])).toEqual([
      [at('2026-11-15T10:20:00'), at('2026-11-16T00:00:00')],
      [at('2026-11-16T00:00:00'), at('2026-11-16T09:40:00')],
    ]);
  });
});

describe('against the burn rate', () => {
  /** Two hours' running, the tank falling `litres` over them, on a machine rated `rate` L/h. */
  function run(litres, rate, basis = 'HOURS') {
    const u = { ...ex, vehicles: [{ vehicleId: 'v1', id: ex.plate, ratedBurn: rate == null ? null : { value: rate, basis } }] };
    const p = running('2026-11-14T07:00:00', '2026-11-14T09:00:00').map((x, i, all) => ({ ...x, fuelLevelMl: Math.round((300 - (litres * i) / (all.length - 1)) * 1000) }));
    const { rows } = machineryRows([u], new Map([['v1', p]]), dayWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00')));
    return rows[0];
  }
  const def = REPORTS.machinery;
  const tone = (r) => def.rowTone(r);

  it('shows the register’s rate and the actual beside it', () => {
    const r = run(40, 25);
    expect(r.std).toBe(25);
    expect(r.actual).toBeCloseTo(r.usedL / r.hours, 5);
    const cells = def.cells(r);
    expect(cells[5]).toBe('25.0');
    expect(cells[6]).toBe(r.actual.toFixed(1));
  });

  it('is green at or below the rate and red above it', () => {
    const low = run(40, 15);
    const high = run(60, 15);
    expect(low.actual).toBeLessThan(15);
    expect(high.actual).toBeGreaterThan(15);
    expect(tone(low)).toBe('good');
    expect(tone(high)).toBe('bad');
    // Exactly on the rate is within it
    expect(tone(run(40, low.actual))).toBe('good');
  });

  it('works out the actual however short the running, as it is', () => {
    const u = { ...ex, vehicles: [{ vehicleId: 'v1', id: ex.plate, ratedBurn: { value: 12, basis: 'HOURS' } }] };
    // A reading a minute for twelve minutes, the meter and the tank moving with it
    const p = Array.from({ length: 13 }, (_, i) => ({
      t: at('2026-11-14T07:00:00') + i * 60_000, engineOn: true, speedKmh: 0, lat: -8.6, lng: 35.3,
      engineHoursMeter: 1000 + i / 60, fuelLevelMl: 300_000 - i * 300,
    }));
    const r = machineryRows([u], new Map([['v1', p]]), dayWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00'))).rows[0];
    // Twelve minutes: well under the half hour the report used to need
    expect(r.hours).toBeLessThan(0.5);
    expect(r.actual).not.toBeNull();
    expect(r.actual).toBeCloseTo(r.usedL / r.hours, 5);
    expect(def.cells(r)[6]).toBe(r.actual.toFixed(1));
    expect(tone(r)).not.toBeNull();
  });

  it('lists the greens first, best at the top, then the reds, worst at the foot, then the rest', () => {
    const mk = (plate, id, rate, litres) => {
      const u = { key: plate, plate, type: '', group: null, vehicles: [{ vehicleId: id, id: plate, ratedBurn: rate == null ? null : { value: rate, basis: 'HOURS' } }] };
      const p = running('2026-11-14T07:00:00', '2026-11-14T09:00:00').map((x, i, all) => ({ ...x, fuelLevelMl: Math.round((300 - (litres * i) / (all.length - 1)) * 1000) }));
      return { u, p };
    };
    const set = [mk('MUFINDI - EX 01', 'a', 15, 60), mk('MUFINDI - EX 02', 'b', 15, 30), mk('MUFINDI - EX 03', 'c', null, 30),
      mk('MUFINDI - EX 04', 'd', 15, 90), mk('MUFINDI - EX 05', 'e', 15, 40)];
    const { rows } = machineryRows(set.map((x) => x.u), new Map(set.map((x) => [x.u.vehicles[0].vehicleId, x.p])),
      dayWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00')));
    expect(rows.map((r) => [r.unit.plate.slice(-5), r.vsStd])).toEqual([
      ['EX 02', 'within'], ['EX 05', 'within'], ['EX 01', 'above'], ['EX 04', 'above'], ['EX 03', null],
    ]);
  });

  it('deepens the colour the further from the rate', () => {
    const r = (actual, vsStd) => ({ std: 10, actual, vsStd });
    expect(def.rowDepth(r(10, 'within'))).toBe(0);
    expect(def.rowDepth(r(5, 'within'))).toBeCloseTo(0.5, 5);
    expect(def.rowDepth(r(0, 'within'))).toBe(1);
    expect(def.rowDepth(r(13, 'above'))).toBeCloseTo(0.3, 5);
    expect(def.rowDepth(r(30, 'above'))).toBe(1);
    expect(def.rowDepth({ std: null, actual: 5, vsStd: null })).toBe(0);
  });

  it('colours nothing without an hourly rate', () => {
    expect(tone(run(40, null))).toBeNull();
    expect(tone(run(40, 0.4, 'DISTANCE'))).toBeNull();
  });

  it('counts the rows within and above the rate', () => {
    const kpi = Object.fromEntries(def.kpis([run(40, 15), run(60, 15)]).map((k) => [k.label, k.value]));
    expect(kpi['Within burn rate']).toBe('1');
    expect(kpi['Above burn rate']).toBe('1');
  });
});

describe('saying no more than the period does', () => {
  const p = running('2026-11-16T14:00:00', '2026-11-16T17:00:00');
  const def = REPORTS.machinery;

  it('leaves the Hour column out over a single hour', () => {
    const w = hourWindows(at('2026-11-16T14:00:00'), at('2026-11-16T15:00:00'));
    const { rows } = machineryRows([ex], new Map([['v1', p]]), w);
    const ctx = { oneWindow: true, oneDay: true };
    expect(shownColumns(def, rows, ctx).map((i) => def.columns(ctx)[i])).not.toContain('Hour');
  });

  it('gives the hour alone within one day, and the day too across several', () => {
    const w = hourWindows(at('2026-11-16T14:00:00'), at('2026-11-16T16:00:00'));
    const { rows } = machineryRows([ex], new Map([['v1', p]]), w);
    expect(def.cells(rows[0], { oneWindow: false, oneDay: true })[2]).toBe('14:00–15:00');
    expect(def.cells(rows[0], { oneWindow: false, oneDay: false })[2]).toBe('Mon 16 Nov 14:00–15:00');
  });
});

describe('a tie as printed', () => {
  it('is within the burn rate: 12.04 L/h reads 12.0 against 12.0 (MUFINDI - EX 02)', () => {
    const u = { ...ex, vehicles: [{ vehicleId: 'v1', id: ex.plate, ratedBurn: { value: 12, basis: 'HOURS' } }] };
    const p = running('2026-11-14T07:00:00', '2026-11-14T09:00:00').map((x, i, all) => ({ ...x, fuelLevelMl: Math.round((300 - (36 * i) / (all.length - 1)) * 1000) }));
    const { rows } = machineryRows([u], new Map([['v1', p]]), dayWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00')));
    const r = rows[0];
    // A burn rate a hair under the actual, as EX 02's was: above it unrounded, the same as printed
    const near = { ...u, vehicles: [{ ...u.vehicles[0], ratedBurn: { value: r.actual - 0.001, basis: 'HOURS' } }] };
    const again = machineryRows([near], new Map([['v1', p]]), dayWindows(at('2026-11-14T00:00:00'), at('2026-11-15T00:00:00'))).rows[0];
    expect(again.actual).toBeGreaterThan(again.std);
    expect(Math.round(again.actual * 10) / 10).toBe(Math.round(again.std * 10) / 10);
    expect(REPORTS.machinery.rowTone(again)).toBe('good');
  });
});

describe('Machinery as a tab under Movements', () => {
  const can = () => true;
  it('is a Movements tab for Mufindi alone', () => {
    expect(hasMachineryTab(can, 'KASULU')).toBe(true);
    expect(hasMachineryTab(can, 'SUKARI')).toBe(false);
    expect(hasMachineryTab((p) => p !== 'telemetry:read', 'KASULU')).toBe(false);
  });

  it('is not a report in the sidebar', () => {
    expect(REPORT_NODES.map((n) => n.key)).not.toContain('machinery');
    expect(reportKeysFor(can, 'KASULU')).not.toContain('machinery');
  });
});
