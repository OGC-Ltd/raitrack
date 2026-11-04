// The Geofence Report (operator, 3 Nov 2026; West Kenya's sheet): every visit
// a vehicle made to a geofence over a period the operator picks, one row a
// visit: Registration, Geofence, Time in, Time out, Duration in geofence.
//
// Read from the vehicles' own positions, not the arrival notifications: every
// position is kept, so any period can be made again, a server restart leaves
// no visit without its Time in, and the times are those of the readings.
//
// As the sheet has it:
//   · a visit is cut at the period's edges (a truck in the station overnight,
//     on a report from 00:00, reads Time in 00:00:00);
//   · every visit is a row, short ones and a return a few minutes later too;
//   · rows by vehicle, then by time in.
// A vehicle still inside when the period ends at the current time reads
// "Still inside"; a period in the past ends at its end.
//
// Places only: polygons and circles. Corridors (roads) are not places to be
// in (lib/zoneContainment).
//
// Pure: no React, no network.

import { fenceContains } from './zoneContainment';

/** Read this long before the period too, to know who was already inside when it began. */
export const LEAD_MS = 2 * 3600_000;
/**
 * The period the picker holds: from the hour on the first day to the hour on the
 * last, one stretch, not those hours each day. `to` is null where it runs to now.
 */
export function pickedPeriod({ fromDay, toDay, start, end }, now = Date.now()) {
  const at = (key, h) => Date.parse(`${key}T00:00:00Z`) - 3 * 3600_000 + h * 3600_000;
  const to = at(toDay, end <= start ? end + 24 : end);
  return { from: at(fromDay, start), to: to >= now ? null : to };
}

/** The longest period it is made for, days. */
export const MAX_DAYS = 7;
/** A period ending this close to now ends "now": who is inside is still inside. */
const NOW_SLACK_MS = 5 * 60_000;
const DAY = 86_400_000;
const OFFSET = 3 * 3600_000;

export const COLUMNS = ['Registration', 'Geofence', 'Time in', 'Time out', 'Duration in geofence'];

const nameOf = (f) => String(f?.properties?.name ?? f?.properties?.title ?? f?.properties?.label ?? '').trim();

/** The fence's bounds, for a quick "nowhere near" before the exact test. */
function boxOf(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates ?? [];
    const r = f.properties?.radiusM;
    if (![lat, lng, r].every(Number.isFinite) || r <= 0) return null;
    const dLat = r / 111_000;
    const dLng = r / (111_000 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
  }
  const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? (g.coordinates ?? []).flat() : null;
  if (!rings?.length) return null;
  const b = { s: Infinity, n: -Infinity, w: Infinity, e: -Infinity };
  for (const ring of rings) for (const [lng, lat] of ring) {
    if (lat < b.s) b.s = lat; if (lat > b.n) b.n = lat;
    if (lng < b.w) b.w = lng; if (lng > b.e) b.e = lng;
  }
  return Number.isFinite(b.s) ? b : null;
}

/**
 * The places in a geofence collection, named, ready to test: polygons and
 * circles only, nameless ones left out. `pick` (names) keeps those alone;
 * null keeps every one.
 */
export function placesIn(featureCollection, pick = null) {
  const keep = pick ? new Set(pick) : null;
  const out = [];
  for (const f of featureCollection?.features ?? []) {
    const name = nameOf(f);
    const box = boxOf(f);
    if (!name || !box || (keep && !keep.has(name))) continue;
    out.push({ name, box, feature: f });
  }
  return out;
}

/** Every place's name, A–Z, once each: the geofence picker's list. */
export const placeNames = (featureCollection) =>
  [...new Set(placesIn(featureCollection).map((p) => p.name))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }));

const inside = (place, p) => p.lat >= place.box.s && p.lat <= place.box.n && p.lng >= place.box.w && p.lng <= place.box.e
  && fenceContains(p, place.feature);

/**
 * One vehicle's visits over [from, to] from its readings (sorted; those
 * before `from` tell who was already inside). In: the first reading inside;
 * out: the first reading outside after it. Cut at the period's edges.
 *
 * @returns {Array<{ place: string, in: number, out: number, open: boolean }>}
 *          `open`: still inside at the period's end.
 */
export function visitsOf(pings, places, { from, to }) {
  const opened = new Map();         // place index → time in
  const out = [];
  const close = (i, at, open) => {
    const a = opened.get(i);
    opened.delete(i);
    if (at <= from || a >= to) return;
    out.push({ place: places[i].name, in: Math.max(a, from), out: Math.min(at, to), open });
  };
  for (const p of pings ?? []) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng) || p.t > to) continue;
    places.forEach((place, i) => {
      const isIn = inside(place, p);
      if (isIn && !opened.has(i)) opened.set(i, p.t);
      else if (!isIn && opened.has(i)) close(i, p.t, false);
    });
  }
  for (const i of [...opened.keys()]) close(i, to, true);
  return out.sort((a, b) => a.in - b.in || a.place.localeCompare(b.place));
}

/** What a vehicle is called on the report: its name as the platform has it ("WKS - Kabras - KCY 596T"). */
export const vehicleName = (v) => String(v?.name ?? v?.regPlate ?? v?.id ?? v?.vehicleId ?? '').trim();

const natural = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/**
 * The report's rows: every vehicle's visits, by vehicle then time in.
 * `pingsOf(vehicleId)`: the vehicle's readings.
 */
export function geofenceRows(vehicles, pingsOf, places, ctx) {
  const rows = [];
  for (const v of vehicles) {
    const name = vehicleName(v);
    for (const visit of visitsOf(pingsOf(v.vehicleId) ?? [], places, ctx)) rows.push({ vehicle: name, vehicleId: v.vehicleId, ...visit });
  }
  return rows.sort((a, b) => natural(a.vehicle, b.vehicle) || a.in - b.in || natural(a.place, b.place));
}

/** "2026-10-30 07:59:04", in Nairobi time, as the sheet writes it. */
export const stampWords = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 19).replace('T', ' ');
/** "2:02:31": hours, minutes, seconds; the hours run past 24. */
export function durationWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** Does the period end now? Then whoever is inside is still inside. */
export const endsNow = (to, now = Date.now()) => to >= now - NOW_SLACK_MS;

export function rowCells(r, { to, now = Date.now() }) {
  const still = r.open && endsNow(to, now);
  return [r.vehicle, r.place, stampWords(r.in), still ? 'Still inside' : stampWords(r.out), durationWords(r.out - r.in)];
}

/** The figures over the table. */
export function counts(rows) {
  return {
    visits: rows.length,
    vehicles: new Set(rows.map((r) => r.vehicleId ?? r.vehicle)).size,
    places: new Set(rows.map((r) => r.place)).size,
    still: rows.filter((r) => r.open).length,
  };
}

/** Why a period cannot be made, or null. */
export function periodProblem({ from, to }, now = Date.now()) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'Pick when the period starts and ends';
  if (from >= now) return 'The period has not begun yet';
  if (to <= from) return 'The period ends before it starts';
  if (to > now + 60_000) return 'The period cannot end in the future';
  if (to - from > MAX_DAYS * DAY) return `${MAX_DAYS} days at most for this report`;
  return null;
}

const dmyhm = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`; };
/** "30/10/2026 00:00 to 30/10/2026 23:59", or "… to now". */
export const periodWords = ({ from, to }, now = Date.now()) => `${dmyhm(from)} to ${endsNow(to, now) ? `now (${dmyhm(to)})` : dmyhm(to)}`;

export function csvTable(rows, ctx) {
  return { head: COLUMNS, body: rows.map((r) => rowCells(r, ctx)) };
}

/** What the server draws the PDF from (fleet-server reports/template-report.pdf). */
export const geofencePdfBody = (rows, { from, to, fleet, places = null, failed = 0 }) => ({
  fleet, from: Math.round(from), to: Math.round(to), places: places == null ? null : places.length, failed,
  rows: rows.map((r) => ({ vehicle: r.vehicle, vehicleId: r.vehicleId, place: r.place, in: Math.round(r.in), out: Math.round(r.out), open: Boolean(r.open) })),
});
