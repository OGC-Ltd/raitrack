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
 * Two rings (operator, 2026-10-08: the Logbook PDF came out with no Google
 * names at all): a named place within RADIUS_M is the place itself; failing
 * that, the nearest named place within NEAR_M stands in, labelled with how far
 * away it is ("Nzoia Sugar Company, 0.6 km away") — a village stop or a yard
 * whose pin Google keeps at the gate still gets a name an operator knows.
 *
 * Each answer also says what the place is (lib/placeActivity: a bank is
 * Banking, a garage Mechanical), from its name and Google's types — for a
 * neighbour in the second ring too.
 *
 * Answers are kept in localStorage for 30 days (Google's terms allow caching
 * Places content for that long), misses for 7, at ~11 m, so reopening a
 * logbook asks Google nothing. Never throws: no key, a refused key, or no
 * place near enough all come back as null, and the caller keeps its own name.
 */
import { GOOGLE_BASE_AVAILABLE, loadGoogleApi } from "./googleBase";
import { placeActivity } from "./placeActivity";

/** How far from a place's centre a named Google place may be. A stop cluster's
 *  centre sits within ~100 m of where the vehicle actually stood. */
const RADIUS_M = 150;
/** The second ring: the nearest named place, said with its distance. */
const NEAR_M = 1_000;
const HIT_TTL = 30 * 86_400_000;
const MISS_TTL = 7 * 86_400_000;
// v3: answers carry the place's type; v2 ones did not.
const CACHE_KEY = "ft-gplace3:";

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

/** Errors that every place would get alike: the day's quota spent, a refused key. */
const REFUSED = /RESOURCE_EXHAUSTED|quota|API key|PERMISSION_DENIED|REQUEST_DENIED/i;
/** Google is not asked again until then, once it has refused (ms). */
let pausedUntil = 0;

let lib = null;
const places = () => (lib ??= loadGoogleApi().then(() => window.google.maps.importLibrary("places")).catch((e) => { lib = null; throw e; }));

const metres = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
};

/** The nearest named, non-vague place Google has within `radius`, or null. */
async function nearest(lat, lng, radius) {
  const { Place, SearchNearbyRankPreference } = await places();
  const { places: found } = await Place.searchNearby({
    fields: ["id", "displayName", "location", "types", "primaryType", "primaryTypeDisplayName"],
    locationRestriction: { center: { lat, lng }, radius },
    maxResultCount: 10,
    rankPreference: SearchNearbyRankPreference.DISTANCE,
  });
  const best = found.find((p) => p.displayName && !(p.types ?? []).every((t) => VAGUE.has(t)));
  if (!best) return null;
  const m = Math.round(metres({ lat, lng }, { lat: best.location.lat(), lng: best.location.lng() }));
  return {
    name: best.displayName,
    placeId: best.id,
    m,
    // What it is, for the nearest place some way off too (operator,
    // 2026-10-09: "Diamond Motorcycle Spares, 0.5 km away — should have
    // resolved to mechanical"): where a unit stops beside one named place,
    // that place is the likeliest reason. Google's types are kept, not the
    // group worked out from them, so better rules reach cached answers.
    primaryType: best.primaryType ?? null,
    types: best.types ?? [],
    kind: best.primaryTypeDisplayName ?? null,
  };
}

/** The answer with what the place is worked out now, from its name and types. */
const withActivity = (v) => (v && v.types ? { ...v, activity: placeActivity({ name: v.name, primaryType: v.primaryType, types: v.types }) } : v);

/** Google's name for the place nearest `{lat, lng}`, or null. */
export async function googlePlaceName({ lat, lng }) {
  if (!GOOGLE_BASE_AVAILABLE) return null;
  const hit = readCache(lat, lng);
  if (hit !== undefined) return withActivity(hit);
  if (Date.now() < pausedUntil) return null;
  try {
    // One search, nearest first: the closest named place is the spot itself
    // when within RADIUS_M, else the neighbour said with its distance. (Two
    // searches a place ran the key's daily quota out, 2026-10-09.)
    const v = await nearest(lat, lng, NEAR_M);
    writeCache(lat, lng, v);
    return withActivity(v);
  } catch (e) {
    // A spent quota or a refused key fails every place the same way: stop
    // asking for ten minutes, so the OpenStreetMap names come straight in
    // rather than after thirty refusals.
    if (REFUSED.test(String(e?.message ?? e))) pausedUntil = Date.now() + 10 * 60_000;
    return null; // not cached: next time asks again
  }
}

/** Whether a result is the spot itself, not a neighbour some way off. */
export const googleIsSpot = (g) => !!g && g.m <= RADIUS_M;

/** How a result is written: the place itself, or the nearest one with its distance. */
export function googleLabel(g) {
  if (!g?.name) return null;
  return g.m > RADIUS_M ? `${g.name}, ${(g.m / 1000).toFixed(1)} km away` : g.name;
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
