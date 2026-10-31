import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/api', () => ({
  apiFetch: vi.fn(async (path) => {
    const u = new URL(`http://x${path}`);
    if (!u.searchParams.get('cursor')) {
      return { data: [{ id: 't1', driverId: 'd1', vehicleId: 'v715', vehicle: { registrationPlate: 'KDL 715E' }, beganAt: '2026-10-20T03:00:00Z', endedAt: '2026-10-20T09:00:00Z' }],
        meta: { hasNextPage: true, cursor: 't1' } };
    }
    return { data: [{ id: 't2', driverId: 'd2', vehicleId: 'v240', vehicle: { registrationPlate: 'KDL 240X' }, beganAt: '2026-10-20T03:00:00Z', endedAt: '2026-10-20T08:00:00Z' }],
      meta: { hasNextPage: false } };
  }),
}));
vi.mock('./notifications', () => ({ fleetToday: () => '2026-10-31' }));
const { getWeighmentDay } = vi.hoisted(() => ({ getWeighmentDay: vi.fn(async ({ day }) => ({
  rows: day === '2026-10-20' ? [
    { id: 'aaaaaaaaaaaaaaaa', token: '11', tokenAt: '2026-10-20T05:00:00Z', grossAt: '2026-10-20T05:00:00Z', vehicleId: 'v715', vehiclePlate: 'KDL715E', driverName: 'Calvin Lenaso', netWeightKg: 22000, factoryNetWeightKg: 21500, centerName: 'Naitiri' },
    { id: 'bbbbbbbbbbbbbbbb', token: '12', tokenAt: '2026-10-20T06:00:00Z', grossAt: '2026-10-20T06:00:00Z', vehicleId: 'v240', vehiclePlate: 'KDL240X', driverName: 'Denish', netWeightKg: 18000, factoryNetWeightKg: null, centerName: 'Kamukuywa' },
  ] : [],
})) }));
vi.mock('./weighments', () => ({ getWeighmentDay: (...a) => getWeighmentDay(...a) }));

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };

const { loadWeighbridgeCredit, fleetDays } = await import('./weighbridgeTonnage');
const drivers = [{ id: 'd1', fullName: 'Calvin Lesoiyan Lenaso' }, { id: 'd2', fullName: 'Denish Onyango Mangila' }];

describe('loadWeighbridgeCredit', () => {
  beforeEach(() => { getWeighmentDay.mockClear(); });
  it('reads every day and every page of trips, and credits the tickets', async () => {
    const progress = [];
    const partial = [];
    const c = await loadWeighbridgeCredit({ orgId: 'o', drivers, days: 15, onProgress: (p) => progress.push(p), onPartial: (x) => partial.push(x) });
    expect(getWeighmentDay).toHaveBeenCalledTimes(15);
    expect(progress.filter((p) => p.step === 'tickets').at(-1)).toEqual({ step: 'tickets', done: 15, total: 15 });
    // name-only first (neither ticket name matches a whole roster name), then by trip
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ partial: true, tripsRead: false });
    expect(partial[0].stats.viaTrip).toBe(0);
    expect(c.tripsRead).toBe(true);
    expect(c.byDriver.get('d1').kg).toBe(21500);
    expect(c.byDriver.get('d2').kg).toBe(18000);
    expect(c.stats.viaTrip).toBe(2);
  });
  it('keeps settled days in the browser and reads only the fresh ones again', async () => {
    const c = await loadWeighbridgeCredit({ orgId: 'o', drivers, days: 15 });
    expect(getWeighmentDay).toHaveBeenCalledTimes(4);           // today and the 3 days before it
    expect(c.byDriver.get('d1').kg).toBe(21500);               // read back from the cache
    expect(store.get('ft-wb-day2:o:2026-10-20')).toContain('KDL715E');
  });
  it('lists the days oldest first, ending today', () => {
    expect(fleetDays(3, '2026-10-31')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
  });
});
