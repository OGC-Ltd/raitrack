import { describe, it, expect, vi } from 'vitest';

const at = (s) => Date.parse(`${s}+03:00`);
// A unit driving 23:00–01:00 across midnight, at 60 km/h, a reading a minute
const drive = (from, to) => {
  const out = [];
  for (let t = from; t <= to; t += 60_000) out.push({ t, speedKmh: 60, lat: -0.3 + (t - from) / 3.6e8, lng: 36, ignition: true });
  return out;
};
const night = drive(at('2026-10-01T23:00:00'), at('2026-10-02T01:00:00'));
const reads = [];

vi.mock('../lib/vehicleDay', async (orig) => ({
  ...(await orig()),
  readDayOnce: vi.fn(async (orgId, vehicleId, day) => {
    reads.push(day);
    const from = Date.parse(`${day}T00:00:00+03:00`);
    return { pings: night.filter((p) => p.t >= from && p.t < from + 86_400_000), complete: true };
  }),
}));

const { loadUsage } = await import('./fleetReports');

describe('a long period, a unit-day at a time', () => {
  it('reads each day once, in order, and a night across midnight counts whole', async () => {
    const steps = [];
    const { usage, failed } = await loadUsage({
      orgId: 'o', vehicles: [{ vehicleId: 'v1' }], from: at('2026-10-01T00:00:00'), to: at('2026-10-04T00:00:00'),
      onProgress: (p) => steps.push(p),
    });
    expect(failed).toBe(0);
    expect(reads).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(steps.at(-1)).toEqual({ done: 3, total: 3 });
    const u = usage.get('v1');
    const nightOf = (s) => u.nights.find((n) => n.from === at(s));
    // the night of the 1st: 22:00–04:00, both days' readings
    expect(nightOf('2026-10-01T22:00:00').km).toBeGreaterThan(u.days['2026-10-01'].km);
    expect(nightOf('2026-10-01T22:00:00').km).toBeCloseTo(u.days['2026-10-01'].km + u.days['2026-10-02'].km, 0);
    expect(nightOf('2026-10-02T22:00:00').km).toBe(0);
    // the day shift (07:30–19:30) saw none of it
    expect(u.days['2026-10-01'].dayShiftKm).toBe(0);
    expect(u.days['2026-10-02'].lastAt).toBe(at('2026-10-02T01:00:00'));
    expect(u.days['2026-10-03'].readings).toBe(0);
  });
});
