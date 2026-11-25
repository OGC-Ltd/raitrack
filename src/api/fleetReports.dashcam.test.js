import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./vssAlarms', () => ({ fetchVssCameraCount: vi.fn(), fetchVssWindow: vi.fn() }));
vi.mock('./notifications', () => ({ getNotifications: vi.fn() }));
vi.mock('./driverConduct', () => ({ listDays: vi.fn() }));
const vss = await import('./vssAlarms');
const notes = await import('./notifications');
const conduct = await import('./driverConduct');
const { loadDashcamAlarms, loadHarshEvents, loadConductPeriod, stretchesLeft, DASHCAM_DAYS } = await import('./fleetReports');

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-11-24T12:00:00+03:00');
const alarm = (id, ms) => ({ id, occurredMs: ms, code: 214 });
const answer = (alarms = [], o = {}) => ({ alarms, untyped: 0, partial: false, ...o });

describe('the dashcam alarms of a Driver conduct report', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const f of Object.values(vss)) f.mockReset();
    vss.fetchVssCameraCount.mockResolvedValue(55);
  });
  afterEach(() => vi.useRealTimers());

  it('reaches back 14 days', () => expect(DASHCAM_DAYS).toBe(14));

  it('a day or less up to now: one search up to now, the Alarms tab’s, with the untyped alarms counted', async () => {
    vss.fetchVssWindow.mockResolvedValue(answer([alarm('a', NOW - H)], { untyped: 3 }));
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 10 * H, to: NOW });
    expect(vss.fetchVssWindow).toHaveBeenCalledTimes(1);
    expect(vss.fetchVssWindow.mock.calls[0][0].untilIso).toBeUndefined();
    expect(r).toMatchObject({ cameras: 55, failed: false, failedDays: 0, untyped: 3, window: { from: NOW - 10 * H, to: NOW } });
    expect(r.alarms).toHaveLength(1);
    expect(r.read).toEqual([[NOW - 10 * H, NOW]]);
  });

  it('a single past day asks for that day only, never from then to now', async () => {
    vss.fetchVssWindow.mockResolvedValue(answer());
    const from = Date.parse('2026-11-12T00:00:00+03:00');
    await loadDashcamAlarms({ orgId: 'o', from, to: from + DAY });
    expect(vss.fetchVssWindow).toHaveBeenCalledTimes(1);
    const q = vss.fetchVssWindow.mock.calls[0][0];
    expect(Date.parse(q.sinceIso)).toBe(from);
    expect(Date.parse(q.untilIso)).toBe(from + DAY);
  });

  it('a period that ends before the dashcam’s reach asks for nothing, and has no window', async () => {
    const from = Date.parse('2026-11-01T00:00:00+03:00');
    const r = await loadDashcamAlarms({ orgId: 'o', from, to: from + 5 * DAY });
    expect(vss.fetchVssWindow).not.toHaveBeenCalled();
    expect(r).toMatchObject({ cameras: 55, failed: false, window: null, read: [], alarms: [], reach: NOW - 14 * DAY });
  });

  it('a period partly before the reach asks for the part within it, a day at a time', async () => {
    vss.fetchVssWindow.mockResolvedValue(answer());
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 20 * DAY, to: NOW - 12 * DAY });
    const calls = vss.fetchVssWindow.mock.calls.map(([q]) => q);
    expect(calls).toHaveLength(2);
    expect(Date.parse(calls[0].sinceIso)).toBe(NOW - 14 * DAY);
    expect(Date.parse(calls[1].untilIso)).toBe(NOW - 12 * DAY);
    expect(r.window).toEqual({ from: NOW - 14 * DAY, to: NOW - 12 * DAY });
  });

  it('a month: a day at a time from 14 days back, one after another, every alarm once', async () => {
    let running = 0;
    let most = 0;
    vss.fetchVssWindow.mockImplementation(async ({ sinceIso }) => {
      running += 1; most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      const a = Date.parse(sinceIso);
      return answer([alarm(`x${a}`, a + H), alarm('same', NOW - 2 * DAY)], { untyped: 2 });
    });
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 24 * DAY, to: NOW + 6 * H });
    const calls = vss.fetchVssWindow.mock.calls.map(([q]) => q);
    expect(calls).toHaveLength(14);
    expect(Date.parse(calls[0].sinceIso)).toBe(NOW - 14 * DAY);
    for (const q of calls) expect(Date.parse(q.untilIso) - Date.parse(q.sinceIso)).toBeLessThanOrEqual(DAY);
    expect(most).toBe(1);
    expect(r.alarms).toHaveLength(15);
    expect(r.untyped).toBe(28);
    expect(r.failed).toBe(false);
    // Read whole from the reach to the period’s end: nothing after now was there to read
    expect(r.read.at(-1)[1]).toBe(NOW + 6 * H);
    expect(r.window).toEqual({ from: NOW - 14 * DAY, to: NOW });
  });

  it('the reach and window are fixed when the reading begins, not when it ends', async () => {
    vss.fetchVssWindow.mockImplementation(async () => { vi.setSystemTime(Date.now() + 20 * 60_000); return answer(); });
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 20 * DAY, to: NOW });
    expect(r.reach).toBe(NOW - 14 * DAY);
    expect(r.window.to).toBe(NOW);
  });

  it('counts the days it could not read, leaves them out of what was read, and is failed only when it read none', async () => {
    vss.fetchVssWindow.mockImplementation(async ({ sinceIso }) => {
      if (Date.parse(sinceIso) === NOW - 3 * DAY) throw new Error('busy');
      if (Date.parse(sinceIso) === NOW - 2 * DAY) return answer([], { partial: true });
      return answer();
    });
    const r = await loadDashcamAlarms({ orgId: 'o', from: NOW - 3 * DAY, to: NOW });
    expect(r).toMatchObject({ failed: false, failedDays: 2 });
    expect(r.read).toEqual([[NOW - DAY, NOW]]);
    vss.fetchVssWindow.mockRejectedValue(new Error('down'));
    expect(await loadDashcamAlarms({ orgId: 'o', from: NOW - 3 * DAY, to: NOW })).toMatchObject({ failed: true, failedDays: 0, read: [] });
  });

  it('stops when the run is cancelled: no further day is asked for', async () => {
    const ctl = new AbortController();
    vss.fetchVssWindow.mockImplementation(async ({ signal }) => {
      if (vss.fetchVssWindow.mock.calls.length === 2) ctl.abort();
      signal.throwIfAborted();
      return answer();
    });
    await expect(loadDashcamAlarms({ orgId: 'o', from: NOW - 10 * DAY, to: NOW, signal: ctl.signal })).rejects.toThrow();
    expect(vss.fetchVssWindow).toHaveBeenCalledTimes(2);
    expect(vss.fetchVssWindow.mock.calls[0][0].signal).toBe(ctl.signal);
  });

  it('a fleet with no dashcams asks for nothing', async () => {
    vss.fetchVssCameraCount.mockResolvedValue(0);
    expect(await loadDashcamAlarms({ orgId: 'o', from: NOW - 20 * DAY, to: NOW })).toMatchObject({ cameras: 0, alarms: [] });
    expect(vss.fetchVssWindow).not.toHaveBeenCalled();
  });
});

describe('the harsh driving of a Driver conduct report', () => {
  beforeEach(() => { notes.getNotifications.mockReset(); });

  it('stops when the run is cancelled', async () => {
    const ctl = new AbortController();
    notes.getNotifications.mockImplementation(async ({ signal }) => {
      ctl.abort();
      signal.throwIfAborted();
      return { items: [], nextBefore: null };
    });
    await expect(loadHarshEvents({ orgId: 'o', from: NOW - 20 * DAY, to: NOW, signal: ctl.signal })).rejects.toThrow();
    // At most the three asked at once; none of the other 18 days
    expect(notes.getNotifications.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('a month of Driver conduct from the days built on the server (operator, 25 Nov 2026)', () => {
  // Fleet days: 24 Nov 2026 is today; the period is 10 Nov 00:00 to now
  const dayAt = (d) => Date.parse(`${d}T00:00:00+03:00`);
  const from = dayAt('2026-11-10');
  const built = (d, o = {}) => ({ day: d, captured: true, untyped: 0, ...o });
  const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const f of [...Object.values(vss), notes.getNotifications, conduct.listDays]) f.mockReset();
    vss.fetchVssCameraCount.mockResolvedValue(55);
    vss.fetchVssWindow.mockResolvedValue(answer([alarm('today', NOW - H)]));
    notes.getNotifications.mockResolvedValue({ items: [{ id: 'n1', vehicleId: 'v1', alertType: 'HARSH_BRAKING', ts: new Date(NOW - 2 * H).toISOString() }], nextBefore: null });
  });
  afterEach(() => vi.useRealTimers());

  it('one request for the built days; only today is read live, its dashcam in the one search up to now', async () => {
    conduct.listDays.mockResolvedValue({
      days: days.map((d) => built(d, d === '2026-11-12' ? { captured: false } : { untyped: 1 })),
      rows: [{ day: '2026-11-11', vehicleId: 'v1', plate: 'KCS 082M', times: { accel: [dayAt('2026-11-11') + H], brake: [], seatbelt: [dayAt('2026-11-11') + 2 * H], phone: [], covered: [] } }],
    });
    const r = await loadConductPeriod({ orgId: 'o', from, to: NOW, now: NOW });
    expect(conduct.listDays).toHaveBeenCalledWith('o', '2026-11-10', '2026-11-24', undefined);
    expect(notes.getNotifications.mock.calls.map(([q]) => q.day)).toEqual(['2026-11-24']);
    expect(vss.fetchVssWindow).toHaveBeenCalledTimes(1);
    expect(vss.fetchVssWindow.mock.calls[0][0].untilIso).toBeUndefined();
    expect(r.builtDays).toBe(14);
    expect(r.harsh.events.map((e) => e.alertType).sort()).toEqual(['HARSH_ACCELERATION', 'HARSH_BRAKING']);
    expect(r.cam.alarms.find((a) => a.vehicleId === 'v1')).toMatchObject({ code: 125, occurredMs: dayAt('2026-11-11') + 2 * H });
    // The built days reach back past VSS's two weeks
    expect(r.cam.reach).toBe(from);
    expect(r.cam.window).toEqual({ from, to: NOW });
    // 12 Nov's capture was not whole: not read, and counted
    expect(r.cam.failedDays).toBe(1);
    expect(r.cam.untyped).toBe(13);
    expect(r.cam.read.some(([a, b]) => a <= dayAt('2026-11-12') && b >= dayAt('2026-11-13'))).toBe(false);
  });

  it('every day live when the built days cannot be read (an older server)', async () => {
    conduct.listDays.mockRejectedValue(new Error('404'));
    const r = await loadConductPeriod({ orgId: 'o', from, to: NOW, now: NOW });
    expect(notes.getNotifications).toHaveBeenCalledTimes(15);
    expect(vss.fetchVssWindow).toHaveBeenCalledTimes(14);
    expect(r.builtDays).toBe(0);
  });

  it('a day or less does not ask for built days; a day cut by the period’s hours is read live', async () => {
    await loadConductPeriod({ orgId: 'o', from: NOW - 5 * H, to: NOW, now: NOW });
    expect(conduct.listDays).not.toHaveBeenCalled();
    notes.getNotifications.mockClear();
    conduct.listDays.mockResolvedValue({ days: days.map((d) => built(d)), rows: [] });
    await loadConductPeriod({ orgId: 'o', from: dayAt('2026-11-20') + 6 * H, to: NOW, now: NOW });
    expect(notes.getNotifications.mock.calls.map(([q]) => q.day).sort()).toEqual(['2026-11-20', '2026-11-24']);
  });

  it('what is left of a period once the built days are taken out', () => {
    expect(stretchesLeft(0, 10, [[2, 4], [4, 6], [8, 9]])).toEqual([[0, 2], [6, 8], [9, 10]]);
    expect(stretchesLeft(0, 10, [[0, 10]])).toEqual([]);
  });
});
