// What the Reports page reads. All of it already exists on the server; nothing
// new is asked of the backend.
//
//   Driver conduct      GET /notifications?alertType=HARSH_ACCELERATION,HARSH_BRAKING&day=…
//                       a fleet day at a time, paged; and the dashcam alarms,
//                       GET /vss/alarms?org=…&since=…[&until=…] (no seatbelt,
//                       on phone), which reach back DASHCAM_DAYS (14)
//   Overspeeding        GET /incidents/speeding/summary (which units), then
//                       GET /incidents/speeding?vehicleId=… (their episodes,
//                       each with its length and distance)
//   Night driving,      GET /vehicles/:id/telemetry/day (lib/vehicleDay), a
//   Utilisation,        unit-day at a time, kept for the session: a finished
//   Machinery           day is read once however many reports use it
//
// Every loader reports progress as { done, total } and survives a failed
// request: a unit or day that cannot be read is counted in `failed`, not fatal.

import { getNotifications } from './notifications';
import { listDays } from './driverConduct';
import { fetchVssCameraCount, fetchVssWindow } from './vssAlarms';
import { getSpeedingSummary, getSpeedingIncidents } from './incidents';
import { apiFetch } from '../services/api';
import { loadDay } from '../lib/vehicleDay';
import { settleLimited } from '../lib/settleLimited';
import { daysCovering, summariseWindows, peakFix, dayStart, fleetDay } from '../lib/fleetReports';

const DAY_PAGE = 500;

export const HARSH_TYPES = ['HARSH_ACCELERATION', 'HARSH_BRAKING'];

/** Every harsh acceleration and harsh brake in [from, to), or on the fleet days in `days`. */
export async function loadHarshEvents({ orgId, from, to, days: only = null, alertTypes = HARSH_TYPES, onProgress = () => {}, signal }) {
  const days = only ?? daysCovering(from, to);
  let done = 0;
  let failed = 0;
  onProgress({ done, total: days.length });
  const parts = await settleLimited(days, 3, async (day) => {
    const items = [];
    let before;
    for (let page = 0; page < 60; page++) {
      signal?.throwIfAborted();
      const r = await getNotifications({ orgId, day, limit: DAY_PAGE, before, alertTypes, signal });
      items.push(...r.items);
      if (!r.nextBefore) break;
      before = r.nextBefore;
    }
    done += 1;
    onProgress({ done, total: days.length });
    return items;
  });
  signal?.throwIfAborted();
  const events = [];
  for (const p of parts) {
    if (p.status === 'fulfilled') events.push(...p.value);
    else failed += 1;
  }
  const seen = new Set();
  return {
    events: events.filter((e) => alertTypes.includes(e?.alertType) && !seen.has(e.id) && seen.add(e.id)),
    failed,
  };
}

/**
 * The organisation's dashcam alarms over [from, to) as far back as the server
 * reaches (DASHCAM_DAYS), and whether it has dashcams at all.
 *
 * A period of up to a day that runs to now is one search up to now, the one
 * the Alarms tab shares. Anything else is read with `until`, a day at a time,
 * one after another (VSS answers one search per 10 s, and the proxy waits
 * 30 s), each day with every alarm's type: a search from a past day to now
 * could run past the proxy's 30 s. A period that ends before the reach asks
 * for nothing.
 *
 * `window` is the stretch the alarms were asked for, fixed when the reading
 * began (null: none of the period is within reach); `read` the parts of it
 * that came back whole, which a run's follow-up cases need (lib/followUp
 * casesFromRun). A day that cannot be read is counted in `failedDays`, and
 * none read at all is `failed`; it throws only when `signal` is aborted.
 */
export async function loadDashcamAlarms({ orgId, from, to = Date.now(), stretches = null, onProgress = () => {}, signal, now = Date.now() }) {
  const reach = now - DASHCAM_DAYS * DAY_MS;
  const none = { alarms: [], failed: false, failedDays: 0, untyped: 0, reach, window: null, read: [] };
  const cameras = await fetchVssCameraCount(orgId);
  signal?.throwIfAborted();
  if (!cameras) return { ...none, cameras: 0 };
  // Only these parts of the period, when the rest is built already (loadConductPeriod)
  const parts = (stretches ?? [[from, to]])
    .map(([a, b]) => [Math.max(a, reach), Math.min(b, now), b])
    .filter(([a, b]) => b > a);
  if (!parts.length) return { ...none, cameras };
  const start = parts[0][0];
  const end = parts[parts.length - 1][1];
  const iso = (ms) => new Date(ms).toISOString();

  // [from, to, with until, read up to]: a stretch read up to now covers the rest of
  // the period too, since nothing after now was there to read
  const windows = [];
  for (const [s, e, asked] of parts) {
    const upTo = (b) => (b >= e && e === now ? Math.max(b, asked) : b);
    if (e === now && e - s <= DAY_MS) windows.push([s, e, false, upTo(e)]);
    else for (let a = s; a < e; a += DAY_MS) windows.push([a, Math.min(a + DAY_MS, e), true, upTo(Math.min(a + DAY_MS, e))]);
  }
  const seen = new Map();
  const read = [];
  let failedDays = 0;
  let untyped = 0;
  onProgress({ done: 0, total: windows.length });
  for (const [i, [a, b, until, upTo]] of windows.entries()) {
    try {
      const got = await fetchVssWindow({ orgId, sinceIso: iso(a), untilIso: until ? iso(b) : undefined, signal });
      for (const x of got.alarms) if (!(x.occurredMs < a) && !(x.occurredMs >= b)) seen.set(x.id, x);
      untyped += got.untyped;
      if (got.partial) failedDays += 1;
      else read.push([a, upTo]);
    } catch (err) {
      signal?.throwIfAborted();
      if (err?.name === 'AbortError') throw err;
      failedDays += 1;
    }
    onProgress({ done: i + 1, total: windows.length });
  }
  const alarms = [...seen.values()].sort((x, y) => (y.occurredMs ?? 0) - (x.occurredMs ?? 0));
  const failed = failedDays === windows.length;
  return { alarms, cameras, failed, failedDays: failed ? 0 : failedDays, untyped, reach, window: { from: start, to: end }, read };
}

const DAY_MS = 86_400_000;

/** How far back the server reads the dashcam alarms (fleet-server dashcam.service MAX_DAYS; VSS keeps about two weeks). */
export const DASHCAM_DAYS = 14;

/** The code a built day's alarm of each kind stands for (lib/fleetReports PHONE_CODES, SEATBELT_CODES, COVER_CODES). */
const KIND_CODE = { phone: 116, seatbelt: 125, covered: 123 };
const KIND_ALERT = { accel: 'HARSH_ACCELERATION', brake: 'HARSH_BRAKING' };

/** [from, to) less the stretches in `out` (sorted, apart): what is left, in order. */
export function stretchesLeft(from, to, out) {
  const left = [];
  let at = from;
  for (const [a, b] of out) {
    if (a > at) left.push([at, Math.min(a, to)]);
    at = Math.max(at, b);
  }
  if (at < to) left.push([at, to]);
  return left.filter(([a, b]) => b > a);
}

/**
 * Driver conduct's harsh driving and dashcam alarms over [from, to), the
 * fleet days the server built in advance first (fleet-server
 * driver-conduct-days, operator 25 Nov 2026: "cache the drivers conduct on a
 * daily basis for a consolidated monthly driver conduct"), one request for
 * them all; what is not built (today, a day cut by the period's hours, a day
 * not built yet or expired) is read live as before. Without the built days
 * (an older server, a failed read) every day is read live.
 *
 * Answers as loadHarshEvents and loadDashcamAlarms do, the dashcam's `read`,
 * `window` and `reach` taking in the built days whose capture was whole, and
 * `builtDays`: how many came from the server.
 */
export async function loadConductPeriod({ orgId, from, to, signal, onBuilt = () => {}, onHarsh = () => {}, onDashcam = () => {}, now = Date.now() }) {
  const today = fleetDay(now);
  const wanted = daysCovering(from, to);
  let built = null;
  if (wanted.length > 1) {
    onBuilt({ done: 0, total: 0 });
    try {
      built = await listDays(orgId, wanted[0], wanted[wanted.length - 1], signal);
    } catch {
      signal?.throwIfAborted();
      built = null;
    }
  }
  // Whole days inside the period, ended, built
  const whole = new Map((built?.days ?? [])
    .filter((d) => d.day < today && dayStart(d.day) >= from && dayStart(d.day) + DAY_MS <= to)
    .map((d) => [d.day, d]));
  if (wanted.length > 1) onBuilt({ done: 0, total: 0, note: whole.size ? `${whole.size} day${whole.size === 1 ? '' : 's'} already built` : 'No days built yet: each day is read' });
  const builtStretches = [...whole.keys()].sort().map((d) => [dayStart(d), dayStart(d) + DAY_MS]);
  const live = stretchesLeft(from, to, builtStretches);
  const liveDays = [...new Set(live.flatMap(([a, b]) => daysCovering(a, b)))];

  const [h, cam] = await Promise.all([
    liveDays.length ? loadHarshEvents({ orgId, days: liveDays, signal, onProgress: onHarsh }) : { events: [], failed: 0 },
    loadDashcamAlarms({ orgId, from, to, stretches: live, signal, onProgress: onDashcam, now }),
  ]);

  // The built days' records, in the shapes behaviourRows reads
  const events = [...h.events];
  const alarms = [...cam.alarms];
  for (const r of built?.rows ?? []) {
    if (!whole.has(r.day)) continue;
    const key = r.vehicleId ?? r.plate;
    for (const [kind, alertType] of Object.entries(KIND_ALERT)) {
      (r.times?.[kind] ?? []).forEach((t, i) => events.push({ id: `day:${r.day}:${key}:${kind}:${i}`, vehicleId: r.vehicleId, plate: r.plate, alertType, ts: new Date(t).toISOString() }));
    }
    for (const [kind, code] of Object.entries(KIND_CODE)) {
      (r.times?.[kind] ?? []).forEach((t, i) => alarms.push({ id: `day:${r.day}:${key}:${kind}:${i}`, vehicleId: r.vehicleId, plate: r.plate, code, occurredMs: t }));
    }
  }
  if (!cam.cameras) return { harsh: { events, failed: h.failed }, cam: { ...cam, alarms }, builtDays: whole.size };

  // A built day whose capture was whole counts as read; one that was not, within reach, could not all be read
  const captured = [...whole.values()].filter((d) => d.captured);
  const read = [...cam.read, ...captured.map((d) => [dayStart(d.day), dayStart(d.day) + DAY_MS])];
  const reach = Math.min(cam.reach, ...captured.map((d) => dayStart(d.day)));
  const unread = [...whole.values()].filter((d) => !d.captured && dayStart(d.day) >= reach).length;
  const asked = [cam.window, ...captured.map((d) => ({ from: dayStart(d.day), to: dayStart(d.day) + DAY_MS }))].filter(Boolean);
  const window = asked.length ? { from: Math.min(...asked.map((w) => w.from)), to: Math.min(Math.max(...asked.map((w) => w.to)), to, now) } : null;
  const failed = cam.failed && !captured.length;
  return {
    harsh: { events, failed: h.failed },
    cam: {
      ...cam, alarms, read, reach, window, failed,
      failedDays: failed ? 0 : (cam.failed ? 0 : cam.failedDays) + unread,
      untyped: cam.untyped + captured.reduce((n, d) => n + (d.untyped || 0), 0),
    },
    builtDays: whole.size,
  };
}

/** Every overspeed episode of the units in `vehicleIds`, in [from, to). */
export async function loadOverspeeds({ orgId, from, to, vehicleIds, onProgress = () => {} }) {
  const f = new Date(from).toISOString();
  const t = new Date(to).toISOString();
  const want = new Set(vehicleIds);

  // Which units overspeed at all: the summary, a row per unit.
  const offenders = [];
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const r = await getSpeedingSummary({ orgId, from: f, to: t, sort: 'duration', cursor, limit: 200 });
    for (const row of r.rows) if (want.has(row.vehicleId)) offenders.push(row.vehicleId);
    if (!r.hasNextPage || !r.cursor) break;
    cursor = r.cursor;
  }

  let done = 0;
  let failed = 0;
  onProgress({ done, total: offenders.length });
  const byVehicle = new Map();
  const parts = await settleLimited(offenders, 4, async (vehicleId) => {
    const list = [];
    let c = null;
    for (let page = 0; page < 20; page++) {
      const r = await getSpeedingIncidents({ orgId, vehicleId, from: f, to: t, cursor: c, limit: 200 });
      list.push(...r.rows);
      if (!r.hasNextPage || !r.cursor) break;
      c = r.cursor;
    }
    done += 1;
    onProgress({ done, total: offenders.length });
    return [vehicleId, list];
  });
  for (const p of parts) {
    if (p.status === 'fulfilled') byVehicle.set(p.value[0], p.value[1]);
    else failed += 1;
  }
  return { byVehicle, failed };
}

/**
 * Distance and time per unit inside `windows` ([[from, to], …]), from each
 * unit's readings over the fleet days the windows touch.
 */
export async function loadDistances({ orgId, vehicles, windows, onProgress = () => {} }) {
  if (!windows.length) return { perVehicle: new Map(), failed: 0 };
  const days = daysCovering(windows[0][0], windows[windows.length - 1][1]);
  const jobs = [];
  for (const v of vehicles) for (const day of days) jobs.push({ v, day });

  let done = 0;
  onProgress({ done, total: jobs.length });
  const parts = await settleLimited(jobs, 6, async ({ v, day }) => {
    const r = await loadDay(orgId, v.vehicleId, day);
    done += 1;
    if (done % 5 === 0 || done === jobs.length) onProgress({ done, total: jobs.length });
    return r.pings;
  });

  const pings = new Map();
  const failedUnits = new Set();
  parts.forEach((p, i) => {
    const id = jobs[i].v.vehicleId;
    if (p.status !== 'fulfilled') { failedUnits.add(id); return; }
    if (!pings.has(id)) pings.set(id, []);
    pings.get(id).push(...p.value);
  });

  const perVehicle = new Map();
  for (const v of vehicles) {
    const list = (pings.get(v.vehicleId) ?? []).sort((a, b) => a.t - b.t);
    perVehicle.set(v.vehicleId, summariseWindows(list, windows));
  }
  return { perVehicle, failed: failedUnits.size };
}

/**
 * Every reading of each tracker over [from, to], sorted, from its days of
 * telemetry (the Tankers Report reads a trip from them). `failed`: trackers
 * whose readings could not all be read.
 */
export async function loadPings({ orgId, vehicles, from, to, onProgress = () => {} }) {
  const days = daysCovering(from, to);
  const jobs = [];
  for (const v of vehicles) for (const day of days) jobs.push({ v, day });
  let done = 0;
  onProgress({ done, total: jobs.length });
  const parts = await settleLimited(jobs, 6, async ({ v, day }) => {
    const r = await loadDay(orgId, v.vehicleId, day);
    done += 1;
    if (done % 5 === 0 || done === jobs.length) onProgress({ done, total: jobs.length });
    return r.pings;
  });
  const pings = new Map();
  const failed = new Set();
  parts.forEach((p, i) => {
    const id = jobs[i].v.vehicleId;
    if (!pings.has(id)) pings.set(id, []);
    if (p.status !== 'fulfilled') { failed.add(id); return; }
    pings.get(id).push(...p.value.filter((x) => x.t >= from && x.t <= to));
  });
  for (const list of pings.values()) list.sort((a, b) => a.t - b.t);
  return { pings, failed };
}

/**
 * When each overspeed peaked: the fastest reading inside it (lib/fleetReports
 * peakFix). `items` are overspeeds ({vehicleId, startedAt, endedAt, peakKmh,
 * lat, lng}); each tracker's readings are read once, over all of its own.
 * Answers a Map from each item to {at, kmh}, or null where no reading is found.
 */
export async function loadPeakTimes({ orgId, items, onProgress = () => {} }) {
  const byVehicle = new Map();
  for (const it of items) {
    if (!it?.vehicleId || !Number.isFinite(it.startedAt) || !Number.isFinite(it.endedAt)) continue;
    if (!byVehicle.has(it.vehicleId)) byVehicle.set(it.vehicleId, []);
    byVehicle.get(it.vehicleId).push(it);
  }
  const out = new Map(items.map((it) => [it, null]));
  let done = 0;
  let failed = 0;
  onProgress({ done, total: byVehicle.size });
  await settleLimited([...byVehicle], 4, async ([vehicleId, list]) => {
    const from = Math.min(...list.map((it) => it.startedAt)) - 60_000;
    const to = Math.max(...list.map((it) => it.endedAt)) + 60_000;
    const r = await loadPings({ orgId, vehicles: [{ vehicleId }], from, to });
    if (r.failed.size) failed += 1;
    const pings = r.pings.get(vehicleId) ?? [];
    for (const it of list) out.set(it, peakFix(pings, it));
    done += 1;
    onProgress({ done, total: byVehicle.size });
  });
  return { peaks: out, failed };
}

/**
 * Every dispatch run over [from, to), with the driver the gate wrote, for the
 * Driver Conduct Report to name the driver at the time of each incident
 * (fleet-server GET /dispatches/runs). Null when the server cannot give them:
 * a server without the endpoint yet, no grant to read it, or a failed
 * request. The report then names only the driver of the run open now, and
 * only for incidents after it set off (lib/fleetReports driversAt).
 */
export async function loadDispatchRuns({ orgId, from, to, signal }) {
  try {
    const qs = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    const res = await apiFetch(`/api/v1/organisations/${orgId}/dispatches/runs?${qs}`, signal ? { signal } : undefined);
    return Array.isArray(res?.data) ? res.data : null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}
