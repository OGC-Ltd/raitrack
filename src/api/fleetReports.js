// What the Reports page reads. All of it already exists on the server; nothing
// new is asked of the backend.
//
//   Driver behaviour    GET /notifications?alertType=HARSH_ACCELERATION,HARSH_BRAKING&day=…
//                       a fleet day at a time, paged; and the dashcam alarms,
//                       GET /vss/alarms?org=…&since=… (no seatbelt, on phone),
//                       which reach back 7 days
//   Overspeeding        GET /incidents/speeding/summary (which units), then
//                       GET /incidents/speeding?vehicleId=… (their episodes,
//                       each with its length and distance)
//   Night driving,      GET /vehicles/:id/telemetry/day (lib/vehicleDay), a
//   Utilisation         unit-day at a time, kept for the session: a finished
//                       day is read once however many reports use it
//
// Every loader reports progress as { done, total } and survives a failed
// request: a unit or day that cannot be read is counted in `failed`, not fatal.

import { getNotifications } from './notifications';
import { fetchVssIncidents, fetchVssCameraCount } from './vssAlarms';
import { getSpeedingSummary, getSpeedingIncidents } from './incidents';
import { loadDay } from '../lib/vehicleDay';
import { settleLimited } from '../lib/settleLimited';
import { daysCovering, summariseWindows } from '../lib/fleetReports';

const DAY_PAGE = 500;

export const HARSH_TYPES = ['HARSH_ACCELERATION', 'HARSH_BRAKING'];

/** Every harsh acceleration and harsh brake in [from, to). */
export async function loadHarshEvents({ orgId, from, to, alertTypes = HARSH_TYPES, onProgress = () => {} }) {
  const days = daysCovering(from, to);
  let done = 0;
  let failed = 0;
  onProgress({ done, total: days.length });
  const parts = await settleLimited(days, 3, async (day) => {
    const items = [];
    let before;
    for (let page = 0; page < 60; page++) {
      const r = await getNotifications({ orgId, day, limit: DAY_PAGE, before, alertTypes });
      items.push(...r.items);
      if (!r.nextBefore) break;
      before = r.nextBefore;
    }
    done += 1;
    onProgress({ done, total: days.length });
    return items;
  });
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
 * The organisation's dashcam alarms since `from` (VSS keeps them 7 days), and
 * whether it has dashcams at all. Never throws: a dashcam service that cannot
 * be reached leaves the seatbelt and phone columns unread, not the report.
 */
export async function loadDashcamAlarms({ orgId, from }) {
  const cameras = await fetchVssCameraCount(orgId);
  if (!cameras) return { alarms: [], cameras: 0, failed: false };
  try {
    const alarms = await fetchVssIncidents({ orgId, sinceIso: new Date(from).toISOString() });
    return { alarms, cameras, failed: false };
  } catch {
    return { alarms: [], cameras, failed: true };
  }
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
