import { describe, it, expect } from 'vitest';
import { fuelSeries, refillsIn, graphFacts, fuelGraphsPdf, dayStart, activityRuns, altitudeSeries } from './fuelGraphPdf';

const t0 = dayStart('2026-11-12');
const min = 60_000;
// A day's tank: 120 L down to 60 L by noon, a 150 L refill at 12:30, down to 160 L by night; a lone spike and a 0
const day = () => {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 10) {
    let L = m < 720 ? 120 - (m / 720) * 60 : m < 750 ? 60 + ((m - 720) / 30) * 150 : 210 - ((m - 750) / 690) * 50;
    if (m === 300) L = 400;
    const moving = (m > 360 && m < 690) || (m > 780 && m < 1100);
    const idle = !moving && ((m >= 690 && m < 720) || (m >= 1100 && m < 1140));
    out.push({ t: t0 + m * min, fuelLevelMl: m === 400 ? 0 : L * 1000, lat: -0.3, lng: 36, speedKmh: moving ? 50 : 0, engineOn: moving || idle, altitudeM: m === 500 ? 9000 : 1850 + 120 * Math.sin(m / 200) });
  }
  return out;
};
const ROW = { vehicleId: 'v1', plate: 'KDA 258J', target: { kmPerL: 6.5 }, distanceKm: 958, startL: 80.85, filledL: 364.76, endL: 109.44,
  theftL: 0, consumedL: 336.17, kmPerL: 2.85, belowTarget: true };

describe('the Fuel Graph report (operator, 13 Nov 2026)', () => {
  it('the fuel line: a lone spike and a 0 reading left out', () => {
    const s = fuelSeries(day());
    expect(s.some((p) => p.L > 300)).toBe(false);
    expect(s.every((p) => p.L > 0)).toBe(true);
  });
  it('a refill marked with its litres', () => {
    const r = refillsIn(fuelSeries(day()));
    expect(r).toHaveLength(1);
    expect(r[0].L).toBeGreaterThan(130);
  });
  it('the bottom quarter: reg, consumption, levels, distance', () => {
    const f = Object.fromEntries(graphFacts(ROW, { from: '2026-11-12', to: '2026-11-12' }));
    expect(f['Vehicle reg']).toBe('KDA 258J');
    expect(f.Date).toBe('12/11/2026');
    expect(f.Consumption).toBe('2.85 km/L  ·  35.1 L/100 km');
    expect(f['Initial fuel level']).toBe('80.85 L');
    expect(f['Final fuel level']).toBe('109.44 L');
    expect(f['Distance covered']).toBe('958 km');
    expect(f['Against target']).toBe('Below target');
    expect(f.Comment).toBe('PROBE OK');
  });
  it('driving, idling and parked along the day', () => {
    const at = (m, speedKmh, engineOn) => ({ t: t0 + m * min, speedKmh, engineOn });
    const runs = activityRuns([at(0, 0, false), at(60, 0, false), at(70, 0, true), at(80, 40, true), at(140, 30, true), at(150, 0, true), at(160, 0, false), at(170, 0, false)]);
    expect(runs.map((r) => r.state)).toEqual(['parked', 'idling', 'driving', 'idling', 'parked']);
    expect(runs[2]).toMatchObject({ start: t0 + 80 * min, end: t0 + 150 * min });
    // A gap of over 2 h is no data, not parked
    expect(activityRuns([at(0, 0, false), at(300, 0, false)])).toEqual([]);
  });
  it('the altitude: a lone jump of the fix and a 0 taken out', () => {
    const a = altitudeSeries([...day(), { t: t0 + 5 * min, altitudeM: 0 }]);
    expect(a.length).toBe(144);
    expect(Math.max(...a.map((p) => p.m))).toBeLessThan(2000);
  });
  it('a page per unit', async () => {
    const events = [{ kind: 'refill', start: t0 + 720 * min, end: t0 + 750 * min, litres: 146 }, { kind: 'theft', start: t0 + 1000 * min, end: t0 + 1010 * min, litres: 30 }];
    const doc = await fuelGraphsPdf([{ row: ROW, pings: day(), events }, { row: { ...ROW, plate: 'KBB 880A' }, pings: [] }],
      { from: '2026-11-12', to: '2026-11-12', fleet: 'Menengai Oil Refineries Ltd', now: t0 + 30 * 3_600_000 });
    expect(doc.getNumberOfPages()).toBe(2);
    if (globalThis.process?.env?.FG_OUT) (await import('fs')).writeFileSync(globalThis.process.env.FG_OUT, new Uint8Array(doc.output('arraybuffer')));
  });
});

describe('the figures under the graph (review, 13 Nov 2026)', async () => {
  const { graphFacts } = await import('./fuelGraphPdf');
  it('no consumption figure for a rate of 0, never Infinity L/100 km', () => {
    const facts = Object.fromEntries(graphFacts({ plate: 'KAA 001A', kmPerL: 0, distanceKm: 0 }, { from: '2026-11-13', to: '2026-11-13' }));
    expect(facts.Consumption).toBe('—');
  });
});
