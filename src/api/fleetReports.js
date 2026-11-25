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
import { fetchVssCameraCount, fetchVssWindow } from './vssAlarms';
import { getSpeedingSummary, getSpeedingIncidents } from './incidents';
import { apiFetch } from '../services/api';
import { loadDay } from '../lib/vehicleDay';
import { settleLimited } from '../lib/settleLimited';
import { daysCovering, summariseWindows, peakFix } from '../lib/fleetReports';

const DAY_PAGE = 500;

export const HARSH_TYPES = ['HARSH_ACCELERATION', 'HARSH_BRAKING'];

/** Every harsh acceleration and harsh brake in [from, to). */
export async function loadHarshEvents({ orgId, from, to, alertTypes = HARSH_TYPES, onProgress = () => {}, signal }) {
  const days = daysCovering(from, to);
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
export async function loadDashcamAlarms({ orgId, from, to = Date.now(), onProgress = () => {}, signal, now = Date.now() }) {
  const reach = now - DASHCAM_DAYS * DAY_MS;
  const none = { alarms: [], failed: false, failedDays: 0, untyped: 0, reach, window: null, read: [] };
  const cameras = await fetchVssCameraCount(orgId);
  signal?.throwIfAborted();
  if (!cameras) return { ...none, cameras: 0 };
  const start = Math.max(from, reach);
  const end = Math.min(to, now);
  if (end <= start) return { ...none, cameras };
  // A stretch read up to now covers the rest of the period too: nothing after now was there to read
  const upTo = (b) => (b >= end && end === now ? Math.max(b, to) : b);
  const iso = (ms) => new Date(ms).toISOString();

  const windows = [];
  if (end === now && end - start <= DAY_MS) windows.push([start, end, false]);
  else for (let a = start; a < end; a += DAY_MS) windows.push([a, Math.min(a + DAY_MS, end), true]);
  const seen = new Map();
  const read = [];
  let failedDays = 0;
  let untyped = 0;
  onProgress({ done: 0, total: windows.length });
  for (const [i, [a, b, until]] of windows.entries()) {
    try {
      const got = await fetchVssWindow({ orgId, sinceIso: iso(a), untilIso: until ? iso(b) : undefined, signal });
      for (const x of got.alarms) if (!(x.occurredMs < start) && !(x.occurredMs >= end)) seen.set(x.id, x);
      untyped += got.untyped;
      if (got.partial) failedDays += 1;
      else read.push([a, upTo(b)]);
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
