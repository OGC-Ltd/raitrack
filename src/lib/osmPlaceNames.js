/**
 * The business or building at a spot, from OpenStreetMap — where Google has
 * none or its daily quota has run out (operator, 2026-10-09: "exact location
 * is null and activity is none"). Asked from the browser, like the Google
 * names, so the page shows them without waiting on the server.
 *
 * One Overpass query per ten places: the named businesses within RADIUS_M of
 * each, and the named premises each stands inside (a factory's grounds, a
 * hospital's). A place takes the nearest named business within RADIUS_M, else
 * the smallest premises around it. Same groups as lib/placeActivity, read from
 * the OSM tags; the server's usage-review.poi does the same at build time.
 *
 * Kept in localStorage for 30 days (misses for 3) at ~11 m. Never throws.
 */

const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const RADIUS_M = 150;
const BATCH = 10;
const HIT_TTL = 30 * 86_400_000;
const MISS_TTL = 3 * 86_400_000;
const CACHE_KEY = "ft-osmpoi1:";
const KEYS = ["amenity", "shop", "office", "craft", "healthcare", "tourism", "industrial", "man_made", "leisure"];
const LANDUSE = /^(industrial|commercial|retail|military|farmyard|railway)$/;

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

const has = (t, k, re) => t[k] != null && re.test(t[k]);

/** What an OSM feature is, in lib/placeActivity's groups; null when its tags do not say. */
export function osmActivity(t) {
  if (has(t, "amenity", /^(fuel|charging_station)$/)) return "Fuel";
  if (has(t, "shop", /^(car_repair|car|car_parts|tyres|motorcycle)$/) || has(t, "amenity", /^(car_wash|vehicle_inspection)$/) || has(t, "craft", /^(car_repair|mechanic)$/)) return "Vehicle service";
  if (has(t, "amenity", /^(bank|atm|bureau_de_change|money_transfer|microfinance)$/) || has(t, "office", /^(financial|insurance|accountant)$/)) return "Banking";
  if (has(t, "amenity", /^(hospital|clinic|doctors|dentist|pharmacy|health_post|veterinary)$/) || t.healthcare || has(t, "shop", /^(chemist|medical_supply)$/)) return "Medical";
  if (has(t, "tourism", /^(hotel|motel|guest_house|hostel|camp_site|apartment)$/)) return "Lodging";
  if (has(t, "amenity", /^(restaurant|cafe|fast_food|bar|pub|food_court|biergarten|nightclub)$/) || has(t, "shop", /^(bakery|butcher)$/)) return "Food and drink";
  if (has(t, "amenity", /^place_of_worship$/)) return "Worship";
  if (has(t, "amenity", /^(school|college|university|kindergarten|library|training)$/)) return "Education";
  if (has(t, "amenity", /^(police|townhall|courthouse|post_office|fire_station|prison)$/) || has(t, "office", /^government$/)) return "Government";
  if (t.shop || has(t, "amenity", /^marketplace$/) || has(t, "landuse", /^(retail|commercial)$/)) return "Shopping";
  if (has(t, "amenity", /^(bus_station|parking|taxi|ferry_terminal)$/) || has(t, "landuse", /^railway$/)) return "Transport";
  if (t.industrial || t.craft || has(t, "landuse", /^industrial$/) || has(t, "man_made", /^(works|silo|storage_tank|water_works|wastewater_plant)$/)) return "Industrial / works";
  if (has(t, "landuse", /^farmyard$/) || has(t, "place", /^farm$/)) return "Farm";
  if (t.office) return "Offices";
  if (has(t, "leisure", /^(stadium|park|sports_centre|pitch)$/)) return "Leisure";
  return null;
}

const metres = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6_371_000;
};
const isBusiness = (t) => KEYS.some((k) => t[k] != null) || has(t, "landuse", LANDUSE);
const at = (e) => (e.lat != null ? { lat: e.lat, lng: e.lon } : e.center ? { lat: e.center.lat, lng: e.center.lon } : null);
const inside = (e, p) => !!e.bounds && p.lat >= e.bounds.minlat && p.lat <= e.bounds.maxlat && p.lng >= e.bounds.minlon && p.lng <= e.bounds.maxlon;
const boxArea = (e) => (e.bounds ? (e.bounds.maxlat - e.bounds.minlat) * (e.bounds.maxlon - e.bounds.minlon) : Infinity);
/** "WEST KENYA SUGAR COMPANY" → "West Kenya Sugar Company". */
const tidy = (s) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s,/–-])(\p{Ll})/gu, (_, a, c) => a + c.toUpperCase()) : s);

/** The business at `p` among Overpass `els`, or null. */
export function pickPoi(p, els) {
  const named = els.filter((e) => e.tags?.name && isBusiness(e.tags));
  let best = null;
  for (const e of named) {
    const q = at(e);
    if (!q) continue;
    const m = metres(p, q);
    if (m <= RADIUS_M && (!best || m < best.m)) best = { e, m };
  }
  const pick = best?.e ?? named.filter((e) => e.type !== "node" && inside(e, p)).sort((a, b) => boxArea(a) - boxArea(b))[0];
  return pick ? { name: tidy(pick.tags.name.trim()), activity: osmActivity(pick.tags) } : null;
}

function query(pts) {
  const f = (p) => `(around:${RADIUS_M},${p.lat.toFixed(6)},${p.lng.toFixed(6)})`;
  const near = pts.map((p) => KEYS.map((k) => `nwr${f(p)}[name][${k}];`).join("") + `wr${f(p)}[name][landuse];`).join("\n");
  const within = pts.map((p, i) => `is_in(${p.lat.toFixed(6)},${p.lng.toFixed(6)})->.a${i};`).join("\n");
  const areas = pts.map((_, i) => `area.a${i}[name];`).join("");
  return `[out:json][timeout:50];\n${within}\n(${areas})->.in;\n(\n${near}\nway(pivot.in);rel(pivot.in);\n);\nout tags center bb;`;
}

async function overpass(data, signal) {
  for (const wait of [0, 6_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    for (const url of SERVERS) {
      if (signal?.aborted) return null;
      try {
        const res = await fetch(url, { method: "POST", body: new URLSearchParams({ data }), signal });
        if (res.ok) return (await res.json()).elements ?? [];
      } catch { /* the next server */ }
    }
  }
  return null;
}

/**
 * OpenStreetMap businesses for `list` ([{ id, lat, lng }]); `onName(id,
 * { name, activity })` fires for each found, cached ones first.
 */
export async function osmPlaceNames(list, onName, { signal } = {}) {
  const ask = [];
  for (const p of list) {
    const hit = readCache(p.lat, p.lng);
    if (hit === undefined) ask.push(p);
    else if (hit) onName(p.id, hit);
  }
  for (let i = 0; i < ask.length && !signal?.aborted; i += BATCH) {
    const part = ask.slice(i, i + BATCH);
    const els = await overpass(query(part), signal);
    if (!els) continue; // not cached: next time asks again
    for (const p of part) {
      const v = pickPoi(p, els);
      writeCache(p.lat, p.lng, v);
      if (v && !signal?.aborted) onName(p.id, v);
    }
  }
}
