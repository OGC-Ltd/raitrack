import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./vssAlarms', () => ({ fetchVssIncidents: vi.fn(), fetchVssCameraCount: vi.fn(), fetchVssWindow: vi.fn() }));
const vss = await import('./vssAlarms');
const { loadDashcamAlarms, DASHCAM_DAYS } = await import('./fleetReports');

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-11-24T12:00:00+03:00');
const alarm = (id, ms) => ({ id, occurredMs: ms, code: 214 });

describe('the dashcam alarms of a Driver conduct report', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const f of Object.values(vss)) f.mockReset();
    vss.fetchVssCameraCount.mockResolvedValue(55);
  });
  afterEach(() => vi.useRealTimers());

  it('reaches back 14 days', () => expect(DASHCAM_DAYS).toBe(14));

  it('a day or less: one request, as before', async () => {
    vss.fetchVssIncidents.mockResolvedValue([alarm('a', NOW - H)]);
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 10 * H, to: NOW });
    expect(vss.fetchVssIncidents).toHaveBeenCalledTimes(1);
    expect(vss.fetchVssWindow).not.toHaveBeenCalled();
    expect(r).toMatchObject({ cameras: 55, failed: false, failedDays: 0, untyped: 0 });
    expect(r.alarms).toHaveLength(1);
  });

  it('a month: a day at a time from 14 days back, one after another, every alarm once', async () => {
    let running = 0;
    let most = 0;
    vss.fetchVssWindow.mockImplementation(async ({ sinceIso }) => {
      running += 1; most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      const a = Date.parse(sinceIso);
      return { alarms: [alarm(`x${a}`, a + H), alarm('same', NOW - 2 * DAY)], untyped: 2, partial: false };
    });
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 24 * DAY, to: NOW });
    const calls = vss.fetchVssWindow.mock.calls.map(([q]) => q);
    expect(calls).toHaveLength(14);
    expect(Date.parse(calls[0].sinceIso)).toBe(NOW - 14 * DAY);
    for (const q of calls) expect(Date.parse(q.untilIso) - Date.parse(q.sinceIso)).toBeLessThanOrEqual(DAY);
    expect(most).toBe(1);
    expect(r.alarms).toHaveLength(15);
    expect(r.untyped).toBe(28);
    expect(r.failed).toBe(false);
  });

  it('counts the days it could not read, and is failed only when it read none', async () => {
    vss.fetchVssWindow.mockImplementation(async ({ sinceIso }) => {
      if (Date.parse(sinceIso) === NOW - 3 * DAY) throw new Error('busy');
      if (Date.parse(sinceIso) === NOW - 2 * DAY) return { alarms: [], untyped: 0, partial: true };
      return { alarms: [], untyped: 0, partial: false };
    });
    expect(await loadDashcamAlarms({ orgId: 'o', from: NOW - 3 * DAY, to: NOW })).toMatchObject({ failed: false, failedDays: 2 });
    vss.fetchVssWindow.mockRejectedValue(new Error('down'));
    expect(await loadDashcamAlarms({ orgId: 'o', from: NOW - 3 * DAY, to: NOW })).toMatchObject({ failed: true, failedDays: 0 });
  });

  it('a fleet with no dashcams asks for nothing', async () => {
    vss.fetchVssCameraCount.mockResolvedValue(0);
    expect(await loadDashcamAlarms({ orgId: 'o', from: NOW - 20 * DAY, to: NOW })).toMatchObject({ cameras: 0, alarms: [] });
    expect(vss.fetchVssWindow).not.toHaveBeenCalled();
  });
});
