import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./reports', () => ({ loadMovementEvents: vi.fn() }));
const { loadMovementEvents } = await import('./reports');
const { loadCornering } = await import('./fleetReports');

const H = 3_600_000;
const T0 = Date.parse('2026-11-01T00:00:00+03:00');

describe('harsh cornering over a long period', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 10 * 24 * H });
    loadMovementEvents.mockReset();
  });

  it('asks the server 24 hours at a time, never more, and puts the days together', async () => {
    loadMovementEvents.mockImplementation(async ({ from }) => ({ events: [{ kind: 'cornering', vehicleId: 'v1', at: from + H }] }));
    const r = await loadCornering({ orgId: 'o1', from: T0, to: T0 + 3 * 24 * H });
    const calls = loadMovementEvents.mock.calls.map(([q]) => q);
    expect(calls).toHaveLength(3);
    for (const q of calls) expect(q.to - q.from).toBeLessThanOrEqual(24 * H);
    expect(calls.map((q) => q.kinds)).toEqual([['cornering'], ['cornering'], ['cornering']]);
    expect(r).toEqual({ events: expect.any(Array), failed: 0 });
    expect(r.events).toHaveLength(3);
  });

  it('counts the days it could not read, and is null when it could read none', async () => {
    loadMovementEvents.mockImplementation(async ({ from }) => {
      if (from === T0) throw new Error('refused');
      return { events: [] };
    });
    expect((await loadCornering({ orgId: 'o1', from: T0, to: T0 + 2 * 24 * H })).failed).toBe(1);
    loadMovementEvents.mockRejectedValue(new Error('down'));
    expect(await loadCornering({ orgId: 'o1', from: T0, to: T0 + 2 * 24 * H })).toBeNull();
  });

  it('stops at now', async () => {
    loadMovementEvents.mockResolvedValue({ events: [] });
    await loadCornering({ orgId: 'o1', from: T0 + 9 * 24 * H, to: T0 + 12 * 24 * H });
    expect(loadMovementEvents).toHaveBeenCalledTimes(1);
  });
});
