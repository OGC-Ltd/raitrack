// The stop watch: Menengai's units standing where they should not (operator,
// 5 Nov 2026: "any stop longer than 10 minutes outside the RestStops,
// Customers, Sites and weighbridges"; "check within the no-go zone and
// unauthorised stop and see if there are units there and flag them"; "for
// Menengai units only ... on the alerts page"; "updating in the background").
//
// From each unit's live position and the server's movement state (moving /
// idling / resting, since when), on every refresh of the fleet:
//   · No-go zone: standing inside one of NO_GO for NOGO_MIN_MS or more.
//   · Unauthorised stop: standing UNAUTHORISED_MIN_MS or more outside every
//     authorised place: the file's (data/menengaiStopPlaces), Menengai's own
//     geofences on the platform (its customers and yards), and MORL and the
//     Nairobi depot (STO), 1 km round each as the Deliveries Report has them.
// A unit whose position is older than STALE_MS is not judged: it may have
// moved since. A unit moving again drops off.
//
// Pure: no React, no network.

import { fenceContains } from './zoneContainment';
import { metresToFence } from './movementDepots';

export const ORG_CODE = 'MENENGAI';
export const NOGO_MIN_MS = 2 * 60_000;
export const UNAUTHORISED_MIN_MS = 10 * 60_000;
export const STALE_MS = 6 * 3_600_000;
/** Standing: slower than this (km/h), and not moving by the server's state. */
const STAND_KMH = 3;

/** MORL and STO, as the Deliveries Report reads them (lib/deliveriesReport). */
export const STORES = [
  { name: 'MORL', lat: -0.28802969095623043, lng: 36.04494759379902, radiusM: 1000, category: 'factory' },
  { name: 'STO (Nairobi depot)', lat: -1.3029466, lng: 36.8660916, radiusM: 1000, category: 'storage' },
];

function boxOf(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates;
    const r = (f.properties?.radiusM ?? 0) / 111_000 + 0.0005;
    return { minLat: lat - r, maxLat: lat + r, minLng: lng - r / Math.cos((lat * Math.PI) / 180), maxLng: lng + r / Math.cos((lat * Math.PI) / 180) };
  }
  const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : null;
  if (!rings?.length) return null;
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  for (const ring of rings) for (const [lng, lat] of ring) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Places ready to test: each with its box, for a quick first look. */
export function placesOf(features) {
  return (features ?? []).map((f) => ({ name: String(f?.properties?.name ?? '').trim() || 'Unnamed', feature: f, box: boxOf(f) })).filter((p) => p.box);
}
export const storePlaces = () => placesOf(STORES.map((s) => ({ type: 'Feature', properties: { name: s.name, radiusM: s.radiusM, category: s.category }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })));

const inBox = (p, b) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
/** The first place holding the point, or null. */
export function placeAt(p, places) {
  for (const pl of places) {
    if (!inBox(p, pl.box)) continue;
    const g = pl.feature.geometry;
    if (g.type === 'Point' ? metresToFence(p, pl.feature) === 0 : fenceContains(p, pl.feature)) return pl;
  }
  return null;
}

/**
 * The units flagged now, longest standing first.
 * @param vehicles  the fleet as the map has it (lib/vehicleMap): lat, lng, speed, movement { state, since }, capturedAt
 * @param o.authorised  placesOf(...) of every authorised place (the file's and the platform's geofences)
 * @param o.noGo        placesOf(NO_GO)
 * @returns {{ key, vehicleId, plate, name, kind: 'nogo'|'unauthorised', zone, since, lat, lng }[]}
 */
export function flaggedUnits(vehicles, { authorised = [], noGo = [], now = Date.now() } = {}) {
  const allowed = [...storePlaces(), ...authorised];
  const out = [];
  for (const v of vehicles ?? []) {
    if (!Number.isFinite(v?.lat) || !Number.isFinite(v?.lng)) continue;
    const seen = Date.parse(v.capturedAt ?? '') || v.capturedAtMs || null;
    if (seen != null && now - seen > STALE_MS) continue;
    const state = v.movement?.state;
    if (state === 'moving' || (v.speed ?? 0) >= STAND_KMH) continue;
    const since = Date.parse(v.movement?.since ?? '');
    if (!Number.isFinite(since)) continue;
    const standing = now - since;
    const p = { lat: v.lat, lng: v.lng };
    const plate = v.regPlate ?? v.id ?? v.vehicleId;
    const base = { vehicleId: v.vehicleId, plate, name: v.name ?? null, since, lat: v.lat, lng: v.lng };
    const bad = placeAt(p, noGo);
    if (bad) {
      if (standing >= NOGO_MIN_MS) out.push({ ...base, key: `${v.vehicleId}|nogo|${bad.name}|${since}`, kind: 'nogo', zone: bad.name });
      continue;
    }
    if (standing >= UNAUTHORISED_MIN_MS && !placeAt(p, allowed)) {
      out.push({ ...base, key: `${v.vehicleId}|stop|${since}`, kind: 'unauthorised', zone: null });
    }
  }
  return out.sort((a, b) => a.since - b.since);
}

/** "2 h 05 min", "12 min". */
export function standingWords(since, now = Date.now()) {
  const min = Math.max(0, Math.round((now - since) / 60_000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

/** What the pop-up and the browser notification say. */
export function flagWords(f, now = Date.now()) {
  return f.kind === 'nogo'
    ? `${f.plate} has stood ${standingWords(f.since, now)} in the no-go zone ${f.zone}.`
    : `${f.plate} has stood ${standingWords(f.since, now)} outside any authorised place.`;
}

// ---- On the Alerts page: the stop's place type, a copy, and read marks.

/** The places file's types as the map's categories (lib/zoneLegend ZONE_STYLE). */
const FILE_TYPES = { Customer: 'customer', RestStop: 'parking', Site: 'facility', Other: 'weighing', NoGoZone: 'restricted' };

/** A place's category: the platform's own (lib/zone-taxonomy), else the file's type. */
export function placeCategory(feature) {
  const p = feature?.properties ?? {};
  return p.category ?? FILE_TYPES[p.type] ?? 'other';
}

const metresToBox = (p, b) => {
  const lat = Math.min(Math.max(p.lat, b.minLat), b.maxLat);
  const lng = Math.min(Math.max(p.lng, b.minLng), b.maxLng);
  const k = 111_320;
  return Math.hypot((p.lat - lat) * k, (p.lng - lng) * k * Math.cos((p.lat * Math.PI) / 180));
};

/**
 * The authorised place nearest a stop: { name, category, metres }, or null.
 * The boxes pick a shortlist, and only those are measured to their edge, so
 * Menengai's six thousand fences cost a few hundred measurements a unit.
 */
export function nearestPlace(point, places, shortlist = 24) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  const near = (places ?? [])
    .map((pl) => ({ pl, d: metresToBox(point, pl.box) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, shortlist);
  let best = null;
  for (const { pl } of near) {
    const metres = metresToFence(point, pl.feature);
    if (Number.isFinite(metres) && (!best || metres < best.metres)) best = { name: pl.name, category: placeCategory(pl.feature), metres };
  }
  return best;
}

/** "350 m", "1.2 km", "38 km". */
export function distanceWords(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return m < 10_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
}

/** The read marks' own store (lib/feedReads), apart from any organisation's feed. */
export const STOP_READS = 'menengai-stops';

/**
 * A flag as a line with read marks: its key, and the time it became a stop
 * to flag (2 minutes in a no-go zone, 10 outside), so "Mark all read" covers
 * only the stops that had been flagged by then.
 */
export function stopLine(f) {
  const at = f.since + (f.kind === 'nogo' ? NOGO_MIN_MS : UNAUTHORISED_MIN_MS);
  return { ...f, orgId: STOP_READS, id: f.key, ts: new Date(at).toISOString() };
}

/**
 * One stop as text to paste into a chat or a report. `area` is the place's
 * name (reverse-geocoded), `place` the nearest authorised place's words.
 */
export function stopCopyText(f, { now = Date.now(), place, area } = {}) {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(f.since);
  return [
    `${f.kind === 'nogo' ? 'No-go zone stop' : 'Unauthorised stop'} · ${f.plate}`,
    `Standing since: ${when}`,
    `For: ${standingWords(f.since, now)}`,
    `Where: ${[area, f.kind === 'nogo' ? `no-go zone ${f.zone}` : 'outside any authorised place'].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}`,
    place ? `Nearest place: ${place}` : null,
    `Location: ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)} · https://www.google.com/maps?q=${f.lat},${f.lng}`,
  ].filter(Boolean).join('\n');
}

/**
 * Desktop alerts on or off, per browser (operator, 2026-11-06: turning them on
 * needs a way to turn them off). A page cannot take back the browser's
 * permission, so this is the platform's own switch, read before each one.
 * On unless turned off, so a browser that allowed them keeps them.
 */
const DESKTOP_KEY = 'ft-stopwatch-desktop';
export function desktopAlertsOn() {
  try { return localStorage.getItem(DESKTOP_KEY) !== 'off'; } catch { return true; }
}
export function setDesktopAlerts(on) {
  try { localStorage.setItem(DESKTOP_KEY, on ? 'on' : 'off'); } catch { /* storage off: stays as it was */ }
}
