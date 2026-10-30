// A vehicle's day for the report picker beside the Trip report button: the
// day's trips to choose from, and a report for one of them or for the whole
// day, downloaded as the same one-page PDF as a dispatch's report.
//
// Read through routes the dashboard already uses — the day's readings
// (lib/vehicleDay), Playback's events, the alert feed, the weighbridge and the
// dashcam — so it needs nothing new from the server. A source that fails or is
// not permitted leaves its part of the report empty rather than stopping it.

import { apiFetch } from "../services/api";
import { loadDay } from "../lib/vehicleDay";
import { getNotifications, fleetToday } from "./notifications";
import { getWeighmentDay } from "./weighments";
import { getVehicleCamera } from "./vehicleCamera";
import { fetchVssIncidents } from "./vssAlarms";
import { HARSH_TYPES } from "../lib/harshDriving";
import { dayTrips, dayReportData } from "../lib/dayTrips";
import { downloadReportPdf } from "./tripReport";
import { googlePlaceName, googleLabel } from "../lib/googlePlaceNames";
import { Geocoder } from "../lib/mapEngine";

export { fleetToday };

const DAY_MS = 86_400_000;
const plateKey = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const quiet = (p, fallback) => Promise.resolve(p).catch(() => fallback);

/** Midnight to midnight on the fleet's calendar (Africa/Nairobi, UTC+3). */
export function dayBounds(day) {
  const from = Date.parse(`${day}T00:00:00+03:00`);
  return { from, to: from + DAY_MS };
}


const held = new Map();   // `${org}|${vehicle}|${day}` → Promise of the day's ingredients

async function vehicleOf(orgId, vehicleId) {
  const [v, org] = await Promise.all([
    quiet(apiFetch(`/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(vehicleId)}`), null),
    quiet(apiFetch(`/api/v1/organisations/${orgId}`), null),
  ]);
  const d = v?.data ?? {};
  return {
    vehicle: { plate: d.registrationPlate ?? d.name ?? "", type: d.vehicleType ?? null, driver: null },
    companyName: org?.data?.name ?? null,
  };
}

async function dashcamOf(orgId, vehicleId, plate, from, to) {
  const cam = await quiet(getVehicleCamera(orgId, vehicleId), null);
  if (!cam || cam.state === "no_camera" || cam.state === "not_configured") return null;
  const all = await quiet(fetchVssIncidents({ orgId, sinceIso: new Date(from).toISOString() }), null);
  if (!all) return { complete: false, alarms: [] };
  const key = plateKey(plate);
  return {
    complete: true,
    alarms: all.filter((a) => (a.vehicleId === vehicleId || (key && plateKey(a.plate) === key)) && a.occurredMs >= from && a.occurredMs < to),
  };
}

/**
 * A short name for a trip end no zone or sign-out names. Google's nearest
 * named place first (lib/googlePlaceNames, the Places search the Maps key
 * allows; the plain Geocoder is refused on it), then OpenStreetMap's area name
 * (lib/mapEngine's Nominatim queue, one a second), then the coordinates.
 */
const placeCache = new Map();
const osmArea = (p) => new Promise((resolve) => {
  new Geocoder().geocode({ location: { lat: p.lat, lng: p.lng } }, (res, status) => {
    const parts = status === "OK" ? String(res?.[0]?.formatted_address ?? "").split(",").map((x) => x.trim()).filter(Boolean) : [];
    resolve(parts.length ? parts.slice(0, 2).join(", ") : null);
  });
});
async function placeName(p, { osm = true } = {}) {
  const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const g = googleLabel(await quiet(googlePlaceName(p), null));
  const name = g ?? (osm ? await quiet(osmArea(p), null) : null);
  if (name) placeCache.set(key, name);
  return name;
}

/** Names for trip ends no zone or sign-out names. */
async function nameEnds(trips) {
  const want = [];
  for (const t of trips) {
    if (!t.fromName && t.start) want.push([t, "fromName", t.start]);
    if (!t.toName && t.end) want.push([t, "toName", t.end]);
  }
  // Google answers quickly and in parallel; OpenStreetMap is paced at one a
  // second, so only the first few misses go to it.
  await Promise.all(want.map(async (x) => { x[0][x[1]] = await placeName(x[2], { osm: false }); }));
  const miss = want.filter(([t, key]) => !t[key]);
  for (const [t, key, p] of miss.slice(0, 6)) t[key] = await placeName(p);
  for (const [t, key, p] of miss) t[key] ??= `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
  return trips;
}

/** Everything the day's reports are made from. Held for the session, so picking trips is instant. */
export function loadDayIngredients({ orgId, vehicleId, day }) {
  const key = `${orgId}|${vehicleId}|${day}`;
  if (held.has(key) && day !== fleetToday()) return held.get(key);
  const p = (async () => {
    const { from, to } = dayBounds(day);
    const { vehicle, companyName } = await vehicleOf(orgId, vehicleId);
    const [pings, events, harsh, weighments, dashcam] = await Promise.all([
      quiet(loadDay(orgId, vehicleId, day).then((r) => r.pings), []),
      quiet(apiFetch(`/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(vehicleId)}/playback?day=${day}`).then((r) => r.data?.events ?? []), []),
      quiet(getNotifications({ orgId, vehicleId, day, limit: 500, alertTypes: HARSH_TYPES }).then((r) => r.items), []),
      vehicle.plate
        ? quiet(getWeighmentDay({ orgId, day, q: vehicle.plate }).then((r) => (r?.rows ?? []).filter((w) => w.vehicleId === vehicleId || plateKey(w.vehiclePlate) === plateKey(vehicle.plate))), [])
        : [],
      quiet(dashcamOf(orgId, vehicleId, vehicle.plate, from, to), null),
    ]);
    return { vehicle, companyName, dayFrom: from, dayTo: to, pings, events, harsh, weighments, dashcam };
  })();
  held.set(key, p);
  p.catch(() => held.delete(key));
  return p;
}

/** The day's trips, named, for the picker's list. */
export async function listDayTrips({ orgId, vehicleId, day }) {
  const ing = await loadDayIngredients({ orgId, vehicleId, day });
  const trips = dayTrips({ pings: ing.pings, events: ing.events, dayFrom: ing.dayFrom, dayTo: ing.dayTo });
  return nameEnds(trips);
}

/** Downloads the report for one of the day's trips, or the whole day when `trip` is null. */
export async function downloadDayReport({ orgId, vehicleId, day, trip = null }) {
  const ing = await loadDayIngredients({ orgId, vehicleId, day });
  await downloadReportPdf(dayReportData({ ...ing, trip }));
}
