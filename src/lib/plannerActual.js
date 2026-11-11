// Planner: plan against actual (operator, 2026-11-11). A truck's delivery
// sheet for a day, each line a customer with a geofence of its own, against
// what the truck's track did that day: when it left MORL or the Nairobi depot,
// when it arrived at each customer, how long it stood there, how far it drove
// from the stop before, and when it came home. Laid out as Wialon Logistics'
// route table.
//
// The rules are the Deliveries report's (lib/deliveriesReport): a stop is
// standing inside the customer's fence STOP_MS at STAND_KMH or under; the run
// is out of the origin on the trip holding the first stop and back from the
// one holding the last. The order of stops is shown, not judged.
//
// Pure: no React, no network.

import { fenceContains } from './zoneContainment';
import { STOP_MS, STAND_KMH, originOf, tripsOf, deliveryRun, stopCheck, leftStopAt } from './deliveriesReport';

/** A customer's fence when the zones have none for it: a circle at its point. */
export const FALLBACK_RADIUS_M = 100;

/** How long before the plan day the track is read, to find where the truck started. */
export const LOOKBACK_MS = 24 * 3_600_000;
/**
 * How long after the sheet was printed its stops are judged. The sheet's Date
 * is when sales booked it, and the truck usually drives it the day after
 * (KDE 128E: printed 9 Nov 09:36, all 14 customers on 10 Nov), so the plan's
 * own day alone would find nothing.
 */
export const SPAN_MS = 48 * 3_600_000;

/** The span a plan's stops are judged over: from its printing (or its day's start) for SPAN_MS, never past now. */
export function planWindow(plan, dayStartOf, now = Date.now()) {
  const printed = plan?.sheetAt ? Date.parse(plan.sheetAt) : NaN;
  const from = Number.isFinite(printed) ? printed : dayStartOf(plan.planDate);
  return { from, to: Math.min(from + SPAN_MS, now) };
}

const R = 6_371_000;
const rad = (x) => (x * Math.PI) / 180;
export const metres = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const ok = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && !(p.lat === 0 && p.lng === 0);

/** The customer's fence: its geofence from the zones, else a circle at its point. */
export function fenceOf(customer, zonesById) {
  const f = customer?.geofenceId ? zonesById?.get(customer.geofenceId) : null;
  if (f) return f;
  return { type: 'Feature', properties: { name: customer?.name ?? '', radiusM: FALLBACK_RADIUS_M },
    geometry: { type: 'Point', coordinates: [customer?.lng, customer?.lat] } };
}

/** Distance driven up to each reading, metres, along a sorted track. */
export function cumulative(track) {
  const out = new Array(track.length).fill(0);
  for (let i = 1; i < track.length; i++) out[i] = out[i - 1] + metres(track[i - 1], track[i]);
  return out;
}

/** Metres driven by time t: the distance at the last reading at or before it. */
export function odometerAt(track, cum, t) {
  if (!track.length || t == null) return null;
  let lo = 0; let hi = track.length - 1;
  if (track[0].t > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return cum[lo];
}

/**
 * The first stand at a stop in [from, to] on one track: from the first
 * standing reading inside, held STOP_MS, to the first reading outside after it.
 * @returns {{ at, leftAt }|null} leftAt null: still there at the last reading
 */
export function standAt(track, feature, { from, to }) {
  const list = track.filter((p) => p.t >= from && p.t <= to);
  let inAt = null;
  for (let i = 0; i <= list.length; i++) {
    const p = list[i];
    const inside = p ? fenceContains(p, feature) : false;
    const standing = inside && !(p.speedKmh > STAND_KMH);
    if (standing && inAt == null) inAt = p.t;
    if (!standing && inAt != null) {
      const until = p ? p.t : list[list.length - 1].t;
      if (until - inAt >= STOP_MS) {
        // Standing ended; it left when it was last outside the fence
        let j = i;
        while (j < list.length && fenceContains(list[j], feature)) j++;
        return { at: inAt, leftAt: j < list.length ? list[j].t : null };
      }
      inAt = null;
    }
  }
  return null;
}

/**
 * Plan against actual.
 * @param {object} plan      { stops: [{ id, sequence, customer: { name, lat, lng, geofenceId } }] }
 * @param {object[][]} routes each of the truck's trackers' readings, sorted ({ t, lat, lng, speedKmh })
 * @param {object[]} storages from findStorages
 * @param {Map} zonesById    geofence id → GeoJSON feature
 * @param {{ from, to }} window the plan day's span
 * @returns {{
 *   telemetry: boolean, origin, leftAt, backAt, back, km, durationMs,
 *   stops: Array<{ id, at, leftAt, stayMs, kmFromPrev, visit, reachedAt, nearestM }>,
 *   visited, missed
 * }}
 */
export function planActual(plan, routes, storages, zonesById, { from, to }) {
  const tracks = (routes ?? []).map((r) => (r ?? []).filter(ok));
  // The tracker with the most readings in the day is the one driven along
  const main = tracks.reduce((best, r) => {
    const n = r.filter((p) => p.t >= from && p.t <= to).length;
    return n > best.n ? { r, n } : best;
  }, { r: [], n: 0 }).r;
  const stops = plan?.stops ?? [];
  if (!main.length || !main.some((p) => p.t >= from && p.t <= to)) {
    return { telemetry: false, origin: null, leftAt: null, backAt: null, back: null, km: null, durationMs: null,
      stops: stops.map((s) => ({ id: s.id, at: null, leftAt: null, stayMs: null, kmFromPrev: null, visit: null, reachedAt: null, nearestM: null })),
      visited: 0, missed: stops.length };
  }
  const cum = cumulative(main);
  const odo = (t) => odometerAt(main, cum, t);

  const judged = stops.map((s) => {
    const feature = fenceOf(s.customer, zonesById);
    // The main track decides, or any of the truck's trackers when it saw nothing
    let stand = standAt(main, feature, { from, to });
    let check = null;
    if (!stand) {
      check = stopCheck(tracks, { feature }, { from, to });
      // Got there without standing (the 100 m pass rule): it left at its first reading away again
      if (check.at != null) stand = { at: check.at, leftAt: leftStopAt(tracks, feature, check.at, to) };
    }
    return {
      id: s.id, at: stand?.at ?? null, leftAt: stand?.leftAt ?? null,
      stayMs: stand?.at != null && stand.leftAt != null ? stand.leftAt - stand.at : null,
      reachedAt: check?.reachedAt ?? stand?.at ?? null,
      nearestM: stand ? null : (check?.nearest ? Math.round(check.nearest.m) : null),
    };
  });

  // The run: out from the origin on the trip holding the first stop, home on the one holding the last
  const origin = originOf(main, storages, { to });
  const anchored = origin ? [origin] : storages;
  const { trips } = tripsOf(main, anchored, { to });
  const times = judged.filter((j) => j.at != null).map((j) => j.at);
  const run = deliveryRun(trips, times, { from, to });
  const leftAt = run?.leftAt ?? null;
  const backAt = run?.arrivedAt != null && run.arrivedAt <= to ? run.arrivedAt : null;

  // Kilometres from the stop visited before (in time), or from the origin.
  // A departure is the first reading outside, so the distance counts from the
  // last reading before it: the drive out of the fence is part of the leg.
  const odoLeaving = (t) => odo(t - 1);
  const order = judged.filter((j) => j.at != null).sort((a, b) => a.at - b.at);
  let prevKm = leftAt != null ? odoLeaving(leftAt) : null;
  order.forEach((j, i) => {
    j.visit = i + 1;
    const b = odo(j.at);
    j.kmFromPrev = b != null ? Math.max(0, b - (prevKm ?? b)) / 1000 : null;
    prevKm = j.leftAt != null ? odoLeaving(j.leftAt) : b;
  });
  const lastKm = order.length ? prevKm : null;
  const homeKm = backAt != null && lastKm != null ? Math.max(0, odo(backAt) - lastKm) / 1000 : null;

  const startKm = leftAt != null ? odoLeaving(leftAt) : order.length ? odo(order[0].at) : null;
  const endKm = backAt != null ? odo(backAt) : lastKm;
  const start = leftAt ?? order[0]?.at ?? null;
  const end = backAt ?? (order.length ? (order[order.length - 1].leftAt ?? order[order.length - 1].at) : null);
  return {
    telemetry: true,
    origin: origin ? { key: origin.key, label: origin.label, short: origin.short } : null,
    leftAt, backAt, homeKm,
    km: startKm != null && endKm != null ? Math.max(0, endKm - startKm) / 1000 : null,
    durationMs: start != null && end != null ? end - start : null,
    stops: judged.map((j) => ({ visit: null, kmFromPrev: null, ...j })),
    visited: order.length,
    missed: judged.length - order.length,
  };
}

const p2 = (n) => String(n).padStart(2, '0');
/** "1 h 27 min", "31 min", as Wialon writes a span. */
export function spanWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${p2(m)} min`;
  return `${Math.floor(m / 60)} h ${p2(m % 60)} min`;
}

/** "10.11.2026 07:28" in fleet time (EAT). */
export function clockWords(ms) {
  if (!Number.isFinite(ms)) return '-';
  const d = new Date(ms + 3 * 3_600_000);
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export const kmWords = (km) => (Number.isFinite(km) ? (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`) : '-');

export const OUTCOMES = [
  { id: 'FULL', label: 'Full' },
  { id: 'PARTLY', label: 'Partly' },
  { id: 'REJECTED', label: 'Rejected' },
];

/** The sheet with its actuals, as CSV rows. */
export function planCsvRows(plan, actual) {
  const byId = new Map((actual?.stops ?? []).map((s) => [s.id, s]));
  const itin = isItinerary(plan);
  const head = ['No.', 'Customer ID', 'Customer', 'Location', 'Invoice', 'Amount', 'Tonnage',
    ...(itin ? ['Planned arrival', 'Window', 'Against plan'] : []),
    'Arrived', 'Left', 'Time there', 'Km from previous', 'Visit order', 'Outcome', 'Remarks'];
  const rows = (plan?.stops ?? []).map((s) => {
    const a = byId.get(s.id) ?? {};
    const v = itin ? plannedVs(s, a) : null;
    return [s.sequence, s.customer.code, s.customer.name, s.customer.location, s.invoiceNo, s.amount ?? '', s.tonnage ?? '',
      ...(itin ? [v ? clockWords(v.plannedAt) : '', windowWords(s) ?? '',
        v?.words ? `${v.words}${v.inWindow === false ? ', outside window' : ''}` : ''] : []),
      a.at ? clockWords(a.at) : a.reachedAt != null ? `Passed ${clockWords(a.reachedAt)}, did not stop`
        : (a.nearestM != null ? `Not reached, closest ${kmWords(a.nearestM / 1000)}` : 'Not reached'),
      a.leftAt ? clockWords(a.leftAt) : '', a.stayMs != null ? spanWords(a.stayMs) : '',
      a.kmFromPrev != null ? a.kmFromPrev.toFixed(1) : '', a.visit ?? '',
      OUTCOMES.find((o) => o.id === s.outcome)?.label ?? '', s.remarks ?? ''];
  });
  return [head, ...rows];
}

// A Wialon Logistics itinerary uploaded as a plan (source 'itinerary') carries
// a planned arrival, window, service time and leg for each stop; these set
// them against what the truck did.

/** Within this of the planned arrival is on time. */
export const ON_TIME_MS = 15 * 60_000;

export const isItinerary = (plan) => plan?.source === 'itinerary';

const hhmm = (ms) => { const d = new Date(ms + 3 * 3_600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const mins = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** "04:00–22:00", or null when the stop has no window. */
export const windowWords = (s) => (s?.windowFrom && s?.windowTo ? `${s.windowFrom}–${s.windowTo}` : null);

/** Whether an arrival (ms) falls in the stop's delivery window, read in EAT; null when either is unknown. */
export function inWindow(stop, at) {
  const from = mins(stop?.windowFrom); const to = mins(stop?.windowTo);
  if (from == null || to == null || !Number.isFinite(at)) return null;
  const t = hhmm(at);
  return from <= to ? t >= from && t <= to : t >= from || t <= to;
}

/**
 * A stop's arrival against its plan.
 * @returns {{ plannedAt, lateMs, words, tone, inWindow }|null} null without a planned arrival
 */
export function plannedVs(stop, actualStop) {
  const plannedAt = stop?.plannedAt ? Date.parse(stop.plannedAt) : NaN;
  if (!Number.isFinite(plannedAt)) return null;
  const at = actualStop?.at;
  if (!Number.isFinite(at)) return { plannedAt, lateMs: null, words: null, tone: null, inWindow: null };
  const lateMs = at - plannedAt;
  const m = Math.round(Math.abs(lateMs) / 60_000);
  const span = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  const words = Math.abs(lateMs) <= ON_TIME_MS ? 'On time' : lateMs > 0 ? `${span} late` : `${span} early`;
  return { plannedAt, lateMs, words, tone: lateMs > ON_TIME_MS ? 'warn' : 'ok', inWindow: inWindow(stop, at) };
}

/** Stops reached within ON_TIME_MS of plan or earlier, of those reached. */
export function onTimeCount(plan, actual) {
  const byId = new Map((actual?.stops ?? []).map((s) => [s.id, s]));
  let onTime = 0; let judged = 0;
  for (const s of plan?.stops ?? []) {
    const v = plannedVs(s, byId.get(s.id));
    if (v?.lateMs == null) continue;
    judged += 1;
    if (v.lateMs <= ON_TIME_MS) onTime += 1;
  }
  return { onTime, judged };
}
