/**
 * Google's name for a spot: the nearest named place Google Maps knows within a
 * short walk ("West Kenya Sugar - Lake Agro workshop"), where OpenStreetMap
 * can only give the area ("Bukembe East, Kanduyi"). Operator, 2026-10-08.
 *
 * Runs in the browser through the Maps JavaScript API with the site's Maps key
 * (lib/googleBase): that key is referrer-restricted and the server has none.
 * Places API (New) — `Place.searchNearby` — is the one the key's project
 * allows; the legacy PlacesService and the Geocoder answer REQUEST_DENIED.
 *
 * Answers are kept in localStorage for 30 days (Google's terms allow caching
 * Places content for that long), misses for 7, at ~11 m, so reopening a
 * logbook asks Google nothing. Never throws: no key, a refused key, or no
 * place near enough all come back as null, and the caller keeps its own name.
 */
import { GOOGLE_BASE_AVAILABLE, loadGoogleApi } from "./googleBase";

/** How far from a place's centre a named Google place may be. A stop cluster's
 *  centre sits within ~100 m of where the vehicle actually stood. */
const RADIUS_M = 150;
const HIT_TTL = 30 * 86_400_000;
const MISS_TTL = 7 * 86_400_000;
const CACHE_KEY = "ft-gplace:";

/** Google's types that are not a place anyone would call by name. */
const VAGUE = new Set(["route", "street_address", "locality", "sublocality", "political", "plus_code", "premise", "bus_stop", "transit_station"]);

const key = (lat, lng) => `${CACHE_KEY}${lat.toFixed(4)},${lng.toFixed(4)}`;

function readCache(lat, lng) {
  try {
    const raw = localStorage.getItem(key(lat, lng));
    if (!raw) return undefined;
    const { v, t } = JSON.parse(raw);
    return Date.now() - t < (v ? HIT_TTL : MISS_TTL) ? v : undefined;
  } catch { return undefined; }
}
function writeCache(lat, lng, v) {
  try { localStorage.setItem(key(lat, lng), JSON.stringify({ v, t: Date.now() })); } catch { /* a cache only */ }
}

let lib = null;
const places = () => (lib ??= loadGoogleApi().then(() => window.google.maps.importLibrary("places")).catch((e) => { lib = null; throw e; }));

const metres = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
};

/** Google's name for the place nearest `{lat, lng}`, or null. */
export async function googlePlaceName({ lat, lng }) {
  if (!GOOGLE_BASE_AVAILABLE) return null;
  const hit = readCache(lat, lng);
  if (hit !== undefined) return hit;
  try {
    const { Place, SearchNearbyRankPreference } = await places();
    const { places: found } = await Place.searchNearby({
      fields: ["id", "displayName", "location", "types"],
      locationRestriction: { center: { lat, lng }, radius: RADIUS_M },
      maxResultCount: 10,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
    });
    const best = found.find((p) => p.displayName && !(p.types ?? []).every((t) => VAGUE.has(t)));
    const v = best ? {
      name: best.displayName,
      placeId: best.id,
      m: Math.round(metres({ lat, lng }, { lat: best.location.lat(), lng: best.location.lng() })),
    } : null;
    writeCache(lat, lng, v);
    return v;
  } catch {
    return null; // not cached: next time asks again
  }
}

/**
 * Google names for many places, a few at a time. `onName(id, result)` fires
 * as each arrives, so the page can show them as they come in.
 */
export async function googlePlaceNames(list, onName, { concurrency = 3, signal } = {}) {
  const queue = [...list];
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const p = queue.shift();
      const got = await googlePlaceName(p);
      if (got && !signal?.aborted) onName(p.id, got);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
