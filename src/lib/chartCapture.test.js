import { describe, it, expect } from 'vitest';
import { nearestIndex, rangeStats, pointDetail } from './chartCapture';

const MIN = 60_000;
const DAYS = 86_400_000;
const T0 = Date.parse('2026-10-20T05:00:00Z');

/** One reading a minute: 30 min driving (fuel 100 → 70, 15 km), 30 min parked off. */
function series() {
  const out = [];
  for (let i = 0; i <= 60; i += 1) {
    const driving = i < 30;
    out.push({
      t: T0 + i * MIN,
      fuelL: driving ? 100 - i : 70,
      fuelSmoothL: driving ? 100 - i : 70,
      speedKmh: driving ? 30 : 0,
      mileageKm: Math.min(i, 30) * 0.5,
      engineOn: driving ? 1 : 0,
    });
  }
  return out;
}
const report = {
  segments: [
    { kind: 'trip', start: T0, end: T0 + 30 * MIN },
    { kind: 'parking', start: T0 + 30 * MIN, end: T0 + 60 * MIN },
  ],
  fillings: [{ id: 'f1', at: T0 + 50 * MIN, volumeL: 20 }],
  drains: [
    { id: 'd1', at: T0 + 10 * MIN, volumeL: 5 },
    { id: 'd2', at: T0 + 12 * MIN, volumeL: 40, probeDropout: true },
  ],
};

describe('nearestIndex', () => {
  it('finds the closest reading either side', () => {
    const s = series();
    expect(nearestIndex(s, T0 + 10 * MIN + 20_000)).toBe(10);
    expect(nearestIndex(s, T0 + 10 * MIN + 40_000)).toBe(11);
    expect(nearestIndex(s, T0 - DAYS)).toBe(0);
    expect(nearestIndex([], T0)).toBe(-1);
  });
});

describe('rangeStats', () => {
  it('reads the drive: level, distance, engine, consumption', () => {
    const r = rangeStats(series(), report, [T0, T0 + 30 * MIN]);
    expect(r.startL).toBe(100);
    expect(r.endL).toBe(70);
    expect(r.changeL).toBe(-30);
    expect(r.distanceKm).toBe(15);
    expect(r.engineMs).toBe(30 * MIN);
    expect(r.drainCount).toBe(1);          // the probe dropout is not a drain
    expect(r.drainedL).toBe(5);
    expect(r.consumedL).toBe(25);          // 100 + 0 − 5 − 70
    expect(r.per100Km).toBeCloseTo(166.7, 1);
    expect(r.tripMs).toBe(30 * MIN);
    expect(r.parkingMs).toBe(0);
  });

  it('a parked stretch has no distance to divide by', () => {
    const r = rangeStats(series(), report, [T0 + 31 * MIN, T0 + 60 * MIN]);
    expect(r.distanceKm).toBe(0);
    expect(r.engineMs).toBe(0);
    expect(r.per100Km).toBeNull();
    expect(r.perEngineH).toBeNull();
    expect(r.fillCount).toBe(1);
    expect(r.consumedL).toBe(20);          // the filling never showed in the level
  });
});

describe('pointDetail', () => {
  it('gives the step, the trend either side and the events near it', () => {
    const d = pointDetail(series(), report, T0 + 20 * MIN);
    expect(d.point.fuelL).toBe(80);
    expect(d.stepL).toBe(-1);
    expect(d.prevGapMs).toBe(MIN);
    expect(d.trendBeforeL).toBe(-10);
    expect(d.trendAfterL).toBe(-10);
    expect(d.segment.kind).toBe('trip');
    expect(d.events.map((e) => e.id)).toEqual(['d2', 'd1', 'f1']);
  });
});
