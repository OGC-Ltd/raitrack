// Incident reports — overspeeding episodes and sensor fault episodes.
//
// Both come in two shapes: a SUMMARY (one row per unit, aggregated over the
// window) for the glance list, and a per-unit LIST for the detail table behind
// a click. They page differently and that is deliberate — see the note on
// `cursor` below.

import { apiFetch } from "../services/api";

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

/**
 * The cursor is opaque HERE on purpose.
 *
 * The server hands back an offset for the aggregate lists and a row id for the
 * detail lists, because a `GROUP BY` has no row to key on. Callers pass back
 * whatever they were given and never construct one — the day the summary moves
 * to a keyset cursor (the upgrade path is written into the repository), nothing
 * in this file or above it has to change.
 */
async function page(path, params) {
  const res = await apiFetch(`${path}?${qs(params)}`);
  return {
    rows:        res.data ?? [],
    cursor:      res.meta?.cursor ?? null,
    hasNextPage: Boolean(res.meta?.hasNextPage),
  };
}

const base = (orgId) => `/api/v1/organisations/${orgId}/incidents`;

/* ── overspeeding ─────────────────────────────────────────────────────────── */

/** One page of the glance list: a row per offending unit. */
export function getSpeedingSummary({ orgId, from, to, sort = "count", cursor, limit = 50 }) {
  if (!orgId) return Promise.resolve({ rows: [], cursor: null, hasNextPage: false });
  return page(`${base(orgId)}/speeding/summary`, { from, to, sort, cursor, limit });
}

/** Every case for ONE unit in the window, newest first. */
export function getSpeedingIncidents({ orgId, vehicleId, from, to, cursor, limit = 50 }) {
  if (!orgId || !vehicleId) return Promise.resolve({ rows: [], cursor: null, hasNextPage: false });
  return page(`${base(orgId)}/speeding`, { vehicleId, from, to, cursor, limit });
}

/** The analysis block, computed over the SAME window as the table. */
export async function getSpeedingInsights({ orgId, from, to }) {
  if (!orgId) return null;
  const res = await apiFetch(`${base(orgId)}/speeding/insights?${qs({ from, to })}`);
  return res.data ?? null;
}

/* ── sensor faults ────────────────────────────────────────────────────────── */

export function getFaultSummary({ orgId, from, to, kind, sort = "count", cursor, limit = 50 }) {
  if (!orgId) return Promise.resolve({ rows: [], cursor: null, hasNextPage: false });
  return page(`${base(orgId)}/faults/summary`, { from, to, kind, sort, cursor, limit });
}

export function getFaultEpisodes({ orgId, vehicleId, from, to, kind, cursor, limit = 50 }) {
  if (!orgId || !vehicleId) return Promise.resolve({ rows: [], cursor: null, hasNextPage: false });
  return page(`${base(orgId)}/faults`, { vehicleId, from, to, kind, cursor, limit });
}

export async function getFaultInsights({ orgId, from, to }) {
  if (!orgId) return null;
  const res = await apiFetch(`${base(orgId)}/faults/insights?${qs({ from, to })}`);
  return res.data ?? null;
}

/* ── shared presentation helpers ──────────────────────────────────────────── */

/** A duration an operator can read at a glance. Seconds only below a minute. */
export function durationLabel(sec) {
  if (sec == null || !Number.isFinite(sec)) return "-";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 48) return rem ? `${h}h ${rem}m` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Metres, at the precision the measurement actually supports. */
export function distanceLabel(m) {
  if (m == null || !Number.isFinite(m)) return "-";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** The fleet clock — these are Kenyan and Tanzanian operations. */
const HHMM = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZone: "Africa/Nairobi",
});
export function whenLabel(iso) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? HHMM.format(t) : "-";
}

/* The fleet clock again, split.
 *
 * `whenLabel` above is the COMPACT form ("08 Sep, 05:12") and stays where
 * space is tight. These are the explicit forms: a date on its own, a time on
 * its own, and the two together — because a column headed "Date" that prints a
 * time is not a date column.
 *
 * `hourCycle: "h23"` rather than `hour12: false`: the latter renders midnight
 * as 24:00 in several runtimes, which reads as an hour that does not exist and
 * lands on the wrong day.
 */
const DMY = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Nairobi",
});
const HM = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Nairobi",
});
const parsed = (iso) => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? t : null; };

/** "09/09/2026" — day first, as both operations write it. */
export function dateLabel(iso) { const t = parsed(iso); return t == null ? "-" : DMY.format(t); }
/** "02:15 hrs" — 24-hour, the way the radio log reads. */
export function timeLabel(iso) { const t = parsed(iso); return t == null ? "-" : `${HM.format(t)} hrs`; }
/* A combined "09/09/2026 02:15 hrs" formatter lived here briefly, for the
   Last episode column. That column is the map button now and the moment is
   carried by the two above, so nothing consumed it. */

/** The malfunction kinds, as prose. */
export const FAULT_LABELS = {
  transit_no_engine:          "In transit, ignition off",
  speed_no_engine:            "Speed with ignition off",
  frozen_gps:                 "No position fix",
  low_accuracy:               "Position too coarse",
  signal_lost:                "Tracker silent",
  gps_not_reporting:          "GPS stopped reporting",
  ignition_not_reporting:     "Ignition stopped reporting",
  odometer_not_reporting:     "Odometer stopped reporting",
  engine_hours_not_reporting: "Engine hours stopped reporting",
  fuel_probe_dead:            "Fuel probe dead",
};
export const faultLabel = (kind) => FAULT_LABELS[kind] ?? kind;

/**
 * The SENSOR each fault is about, as a fitter would name the part.
 *
 * Separate from the fault label because they answer different questions:
 * "Fuel probe dead" is the verdict, "Fuel probe" is the component somebody has
 * to go and look at. A row can carry several — a tracker that went silent took
 * every channel with it — so the plural form dedupes rather than repeating
 * "GPS" three times.
 */
export const FAULT_SENSORS = {
  transit_no_engine:          "Ignition",
  speed_no_engine:            "Ignition",
  frozen_gps:                 "GPS",
  low_accuracy:               "GPS",
  signal_lost:                "Tracker",
  gps_not_reporting:          "GPS",
  ignition_not_reporting:     "Ignition",
  odometer_not_reporting:     "Odometer",
  engine_hours_not_reporting: "Engine hours",
  fuel_probe_dead:            "Fuel probe",
};
export const faultSensor  = (kind) => FAULT_SENSORS[kind] ?? "-";
export const faultSensors = (kinds) =>
  kinds ? [...new Set(kinds.split(",").map(faultSensor))].join(", ") : "-";

/**
 * Coordinates, at five decimal places — about a metre, which is finer than any
 * fix here and coarse enough to read. Em dash when the position is unknown:
 * an episode opened before capture recorded one, or one whose telemetry had
 * already aged out of the 30-day window. Never 0,0 — that is the Atlantic.
 */
export function coordLabel(lat, lng) {
  if (lat == null || lng == null) return "-";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * What the unit was doing where the sensor last worked — and how fast.
 *
 * The SPEED is always printed, including when the verdict is stationary. This
 * column is read for possible theft: "Stationary" alone hides the difference
 * between a machine parked in the yard and one that was rolling at 3 km/h as
 * its tracker went quiet, and that difference is the whole signal. A zero that
 * was measured is evidence; the absence of a number is not.
 *
 * Three states, not two: null is "no fix to judge", which is not the same
 * claim as "it was parked".
 */
export function motionLabel(moving, speedKmh) {
  if (moving == null) return "-";
  const speed = speedKmh == null ? null : `${Math.round(speedKmh)} km/h`;
  const state = moving ? "Moving" : "Stationary";
  return speed ? `${state} · ${speed}` : state;
}
