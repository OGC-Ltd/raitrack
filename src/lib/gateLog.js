// The Gate log's rows (operator, 2026-11-25): pure, and tested.
//
// The gate's four events, as fleet-server sends them (modules/gate-log):
//   DISPATCH        "… signed out to X and left the premises."
//   MOVEMENT_ENTRY  "… returned to the yard."
//   SALE_DISPATCH   a sales run signed out
//   SALE_RETURN     a sales run signed back in

import { fenceColor, isDummyFence } from "./zoneLegend";

export const GATE_EVENTS = {
  DISPATCH:       { label: "Signed out",       way: "out" },
  // "Signed in", not "Returned" (operator, 2026-11-26: "use signed in").
  MOVEMENT_ENTRY: { label: "Signed in",        way: "in" },
  SALE_DISPATCH:  { label: "Sales signed out", way: "out" },
  SALE_RETURN:    { label: "Sales signed in",  way: "in" },
};

/**
 * Where a line came from (operator, 2026-11-25: a badge on each row, and a filter):
 *   controltech  FactorySuite's gate events (modules/webhooks/raifactorysuite-events)
 *   telemetry    the tracker seen at the gate's geofence (lib/yard-departure)
 * A line merging a unit's crossings within five minutes carries its latest one's source.
 */
export const GATE_SOURCES = {
  factorysuite: { label: "FactorySuite" },
  geofence:     { label: "Geofence" },
  other:        { label: "Other" },
};
export const sourceKey = (source) => (source === "controltech" ? "factorysuite" : source === "telemetry" ? "geofence" : "other");

/** Rows from one source, or all of them for "all". */
export function bySource(rows, key) {
  return key && key !== "all" ? rows.filter((r) => r.source === key) : rows;
}

/** Feed items → table rows, newest first. Anything not a gate event is dropped. */
/**
 * Names in capitals put in normal case (operator, 2026-11-26: "drivers name
 * and the locations name to be capitalized"): FactorySuite sends "KTCB 450R ·
 * EMMANUEL BARASA signed out to ADEK", read as "KTCB 450R · Emmanuel Barasa
 * signed out to Adek". A word of two or more capitals becomes Capitalised
 * (each part of a hyphenated name too); the plate's own words, and any word
 * with a digit, are left as they are.
 */
export function nameCase(text, plate) {
  const keep = new Set(String(plate ?? "").toUpperCase().split(/\s+/).filter(Boolean));
  return String(text ?? "").replace(/(?<![\p{L}\p{N}])\p{Lu}[\p{Lu}'’]+(?![\p{L}\p{N}])/gu, (w) => (
    keep.has(w) ? w : w.toLowerCase().replace(/(^|['’])\p{L}/gu, (c) => c.toUpperCase())
  ));
}

export function gateRows(events) {
  return (events ?? [])
    .filter((e) => GATE_EVENTS[e?.alertType])
    .map((e) => ({
      key: e.id,
      at: Date.parse(e.ts),
      plate: e.plate ?? null,
      vehicleId: e.vehicleId ?? null,
      alertType: e.alertType,
      label: GATE_EVENTS[e.alertType].label,
      way: GATE_EVENTS[e.alertType].way,
      source: sourceKey(e.source),
      text: nameCase(e.text ?? "", e.plate),
      // The event's acknowledgement: null where none, undefined where the
      // server sent none at all (not read, or a server without them).
      ack: e.acknowledgement,
    }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at);
}

const squash = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");

/** Rows whose plate or details hold the search, spaces and case ignored. */
export function searchGate(rows, q) {
  const needle = squash(q);
  if (!needle) return rows;
  return rows.filter((r) => squash(r.plate).includes(needle) || squash(r.text).includes(needle));
}

const EAT_MS = 3 * 3_600_000;

/**
 * Rows within hours of the day, Nairobi time (operator, 2026-11-25: "a time
 * range picker next to the date", picked by the hour). `fromH` 0-23 is the
 * hour the window opens, `toH` the hour it closes (24 = the day's end; a
 * fraction for "now", 13.95 = 13:57): From 06 To 14 is 06:00 up to 14:00, not
 * including 14:00. Either may be null
 * for "from the start" / "to the end"; given the wrong way round, they are
 * read the right way round.
 */
export function byHours(rows, fromH, toH) {
  let a = Number.isFinite(fromH) ? Math.round(fromH * 60) : null;
  let b = Number.isFinite(toH) ? Math.round(toH * 60) : null;
  if (a == null && b == null) return rows;
  if (a != null && b != null && a >= b) [a, b] = [b, a === b ? a + 60 : a];
  return rows.filter((r) => {
    const m = Math.floor(((((r.at + EAT_MS) % 86_400_000) + 86_400_000) % 86_400_000) / 60_000);
    return (a == null || m >= a) && (b == null || m < b);
  });
}

/** How many lines went out and came in. */
export function gateCounts(rows) {
  let out = 0;
  let inn = 0;
  for (const r of rows) {
    if (r.way === "out") out++;
    else inn++;
  }
  return { out, in: inn };
}

/**
 * Trips (operator, 2026-11-25: "for the units that have the time in and out,
 * columns of time in and out, and the hours the unit was out"; "even if it
 * left yesterday it should be captured").
 *
 * Per unit, in time order, over the day shown AND the day before it (so a
 * unit signed out last night has its sign-out):
 *   - a sign-out opens a trip (a second one before any sign-in replaces it:
 *     the gate signed the unit out again);
 *   - a FactorySuite sign-in ("returned to the yard") closes it;
 *   - a Geofence line ("arrived at the gate") is the tracker seeing the unit at
 *     the gate while it is signed out. It shows the open trip's out time and
 *     how long the unit has been out, as the server's own "having been out for
 *     17.1 h" counts, but does NOT close the trip: one unit was seen at the
 *     gate seven times on one trip without ever being signed in (KBV 403X,
 *     24-25 Nov 2026).
 * Only recorded times; nothing is estimated (operator: "we should not estimate").
 *
 * A sign-out's row shows the trip's first return of either kind; `open` when
 * there is none yet. A return with no sign-out open before it shows no trip.
 *
 * → Map(row key → { outAt, inAt, outMs, open }), times in ms.
 */
export function gateTrips(rows, now = Date.now()) {
  const byUnit = new Map();
  for (const r of rows ?? []) {
    const unit = squash(r.plate);
    if (!unit) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(r);
  }
  const trips = new Map();
  for (const list of byUnit.values()) {
    list.sort((a, b) => a.at - b.at);
    let open = null;
    for (const r of list) {
      if (r.way === "out") {
        open = r;
        continue;
      }
      if (!open) continue;
      trips.set(r.key, { outAt: open.at, inAt: r.at, outMs: r.at - open.at, open: false });
      if (!trips.has(open.key)) trips.set(open.key, { outAt: open.at, inAt: r.at, outMs: r.at - open.at, open: false });
      if (r.source === "factorysuite") open = null;
    }
    if (open && !trips.has(open.key)) trips.set(open.key, { outAt: open.at, inAt: null, outMs: Math.max(0, now - open.at), open: true });
  }
  return trips;
}

/**
 * The strip's figures, made to balance (operator, 2026-11-27: "make these figures make sense, they
 * should balance"). Everything is counted in TRIPS: a sign-out and its FIRST return of either kind
 * (a FactorySuite sign-in, or the tracker seen arriving at the gate), each trip once.
 *
 *   sign-outs in the window = back + stillOut + noReturn
 *       back      its first return is in the window
 *       noReturn  signed out again before any return was recorded (FactorySuite often records no
 *                 sign-in: KTCC 769G, 27 Nov, seen at the gate twice, then signed out again)
 *       stillOut  neither, by the window's end
 *   cameBack (by hour)  = back + earlier (trips signed out before the window, back in it)
 *   within2h + 2to8h + over8h = cameBack
 *   return records in the window = cameBack + extra (repeat sightings of a trip already back, and
 *                                  returns with no sign-out on record)
 *   outTwice / inTwice  units signed out two or more times in the window / with two or more trips
 *                       back in it (each trip's first return, so repeat sightings do not count)
 *
 * `windowRows` are the rows shown (hours and search applied, every source: a trip needs both
 * ends); `contextRows` every row read, the day before included, so a trip that left yesterday
 * has its sign-out. Pure.
 */
const GATE_SHORT_MS = 2 * 3_600_000;
const GATE_LONG_MS = 8 * 3_600_000;
export function gateBalance(windowRows, contextRows) {
  const inWindow = new Set((windowRows ?? []).map((r) => r.key));
  const firstReturn = new Map(); // sign-out key -> its first return row
  const superseded = new Map();  // sign-out key -> the next sign-out, where no return came between
  const tripOf = new Map();      // return key -> its trip's sign-out row (first returns only)
  const byUnit = new Map();
  for (const r of contextRows ?? []) {
    const unit = squash(r.plate);
    if (!unit) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(r);
  }
  for (const list of byUnit.values()) {
    list.sort((a, b) => a.at - b.at);
    let open = null;
    for (const r of list) {
      if (r.way === "out") {
        if (open && !firstReturn.has(open.key)) superseded.set(open.key, r);
        open = r;
      } else if (open && !firstReturn.has(open.key)) {
        firstReturn.set(open.key, r);
        tripOf.set(r.key, open);
      }
    }
  }
  const units = new Set();
  const records = { out: 0, in: 0 };
  let back = 0, stillOut = 0, noReturn = 0, earlier = 0, extra = 0;
  let within2h = 0, from2to8h = 0, over8h = 0, longest = 0;
  const backBySource = { factorysuite: 0, geofence: 0, other: 0 };
  const returns = [];
  const outsByUnit = new Map();
  const backsByUnit = new Map();
  const bump = (m, unit) => m.set(unit, (m.get(unit) ?? 0) + 1);
  for (const r of windowRows ?? []) {
    if (r.plate) units.add(squash(r.plate));
    if (r.way === "out") {
      records.out += 1;
      if (r.plate) bump(outsByUnit, squash(r.plate));
      const ret = firstReturn.get(r.key);
      const next = superseded.get(r.key);
      if (ret && inWindow.has(ret.key)) back += 1;
      else if (!ret && next && inWindow.has(next.key)) noReturn += 1;
      else stillOut += 1;
      continue;
    }
    records.in += 1;
    const out = tripOf.get(r.key);
    if (!out) { extra += 1; continue; }
    returns.push(r);
    if (r.plate) bump(backsByUnit, squash(r.plate));
    if (!inWindow.has(out.key)) earlier += 1;
    backBySource[r.source in backBySource ? r.source : "other"] += 1;
    const ms = r.at - out.at;
    if (ms <= GATE_SHORT_MS) within2h += 1;
    else if (ms <= GATE_LONG_MS) from2to8h += 1;
    else over8h += 1;
    longest = Math.max(longest, ms);
  }
  return {
    units: units.size, records, signedOut: records.out, back, stillOut, noReturn,
    cameBack: returns.length, earlier, extra, backBySource,
    within2h, from2to8h, over8h, longest, returns,
    outTwice: [...outsByUnit.values()].filter((k) => k >= 2).length,
    inTwice: [...backsByUnit.values()].filter((k) => k >= 2).length,
  };
}

/**
 * The units that went out in the window, once or more, and where each stands now (operator,
 * 2026-11-27: "numbers that are straightforward"). Each unit is counted once, by its LATEST
 * sign-out in the window: back when a return of either kind (FactorySuite sign-in, or the tracker
 * at the gate) is in the window after it, else still out. Every row and column adds up:
 *   once.units  = once.back  + once.out
 *   twice.units = twice.back + twice.out      ("twice" = signed out two or more times)
 *   total       = once + twice, column by column
 * `windowRows` the rows shown (hours and search, every source); pure.
 */
export function gateUnits(windowRows) {
  const byUnit = new Map();
  for (const r of windowRows ?? []) {
    const unit = squash(r.plate);
    if (!unit) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(r);
  }
  const row = () => ({ units: 0, back: 0, out: 0 });
  const once = row();
  const twice = row();
  for (const list of byUnit.values()) {
    const outs = list.filter((r) => r.way === "out");
    if (!outs.length) continue;
    const last = outs.reduce((a, b) => (b.at > a.at ? b : a));
    const back = list.some((r) => r.way === "in" && r.at > last.at);
    const into = outs.length >= 2 ? twice : once;
    into.units += 1;
    if (back) into.back += 1; else into.out += 1;
  }
  const total = { units: once.units + twice.units, back: once.back + twice.back, out: once.out + twice.out };
  return { once, twice, total };
}

/**
 * The moves behind gateUnits, one per unit, for the hourly cards (operator, 2026-11-28: "the
 * values here have to balance as in the previous logic"): each unit's LATEST sign-out in the
 * window, and, for a unit that is back, its first return after it. So `outs.length` is
 * gateUnits' total.units and `backs.length` its total.back, hour by hour; pure.
 */
export function gateUnitMoves(windowRows) {
  const byUnit = new Map();
  for (const r of windowRows ?? []) {
    const unit = squash(r.plate);
    if (!unit) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(r);
  }
  const outs = [];
  const backs = [];
  for (const list of byUnit.values()) {
    const sent = list.filter((r) => r.way === "out");
    if (!sent.length) continue;
    const last = sent.reduce((a, b) => (b.at > a.at ? b : a));
    outs.push(last);
    const back = list.filter((r) => r.way === "in" && r.at > last.at).reduce((a, b) => (a && a.at <= b.at ? a : b), null);
    if (back) backs.push(back);
  }
  return { outs, backs };
}

/** 45 min, 2 h 05 min, 1 d 3 h. */
export function durationWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** A YYYY-MM-DD day moved by n days. */
export function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The event panel's map (operator, 2026-11-26: "a map that shows where it was
 * at that moment and the gate"). The tracker's fixes round the event, oldest
 * first, with a usable coordinate; the route sends them newest first.
 */
export function fixesOf(pings) {
  return (pings ?? [])
    .map((p) => ({ at: Date.parse(p.capturedAt ?? p.ts ?? p.recordedAt ?? ""), lat: Number(p.lat), lng: Number(p.lng), speedKmh: p.speedKmh ?? null, headingDeg: p.headingDeg ?? null }))
    .filter((f) => Number.isFinite(f.at) && Number.isFinite(f.lat) && Number.isFinite(f.lng) && !(f.lat === 0 && f.lng === 0))
    .sort((a, b) => a.at - b.at);
}

/** The fix nearest the moment, or null; `gapMs` is how far from it that fix was. */
export function fixAt(fixes, at) {
  let best = null;
  for (const f of fixes ?? []) {
    if (!best || Math.abs(f.at - at) < Math.abs(best.at - at)) best = f;
  }
  return best ? { ...best, gapMs: Math.abs(best.at - at) } : null;
}

/** Metres between two points (haversine). */
export function metresBetween(a, b) {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The fence kinds that make up a site's premises; roads, routes and keep-outs are not drawn round the gate. */
const SITE_KINDS = new Set(["perimeter", "factory", "gate", "weighing", "parking", "fuel", "logistics", "facility"]);
/** A site fence further than this from the gate (or the unit) belongs to another site. */
const SITE_REACH_M = 3000;

const ringsOf = (g) => (g?.type === "Polygon" ? g.coordinates : g?.type === "MultiPolygon" ? g.coordinates.flat() : []);

/** A fence's middle: the centre of its box, or a circle's own centre. */
function fenceMiddle(f) {
  const g = f.geometry;
  if (g?.type === "Point") return { lat: g.coordinates[1], lng: g.coordinates[0] };
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const ring of ringsOf(g)) for (const [lng, lat] of ring) {
    s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng);
  }
  return Number.isFinite(s) ? { lat: (s + n) / 2, lng: (w + e) / 2 } : null;
}

/**
 * The organisation's premises from its /geofences/geojson: the site fences
 * (perimeter, factory, gate, weighbridge and the like; polygons and circles),
 * within 3 km of `near` when given. Perimeters first, so they draw underneath.
 */
export function siteFences(fc, near) {
  const out = [];
  for (const f of fc?.features ?? []) {
    const p = f?.properties ?? {};
    const kind = p.purpose ?? p.category;
    if (!SITE_KINDS.has(kind) || isDummyFence(p.name)) continue;
    const g = f.geometry;
    const circle = g?.type === "Point" && p.radiusM > 0 ? { lat: g.coordinates[1], lng: g.coordinates[0], radiusM: p.radiusM } : null;
    if (!circle && !ringsOf(g).length) continue;
    const mid = fenceMiddle(f);
    if (!mid || (near && metresBetween(mid, near) > SITE_REACH_M)) continue;
    out.push({ id: String(p.id ?? p.name ?? out.length), name: String(p.name ?? "Fence").trim(), kind, color: fenceColor(f), feature: f, circle, mid });
  }
  const rank = (k) => (k === "perimeter" ? 0 : k === "gate" ? 2 : 1);
  return out.sort((a, b) => rank(a.kind) - rank(b.kind));
}

/**
 * A works-site survey (lib/sitePlans, public/<org>-site.geojson) as fences of
 * the same shape as siteFences: its boundary as the perimeter and its gate
 * point as the gate (operator, 2026-11-26: "use the sukari sitemap and the
 * gate to be always at the place shown"). Within 3 km of `near` when given.
 */
export function planFences(fc, planId, near) {
  const out = [];
  (fc?.features ?? []).forEach((f, i) => {
    const p = f?.properties ?? {};
    const g = f?.geometry;
    const kind = p.category === "perimeter" || p.kind === "boundary" ? "perimeter" : p.category === "gate" ? "gate" : null;
    if (!kind) return;
    if (kind === "perimeter" && !ringsOf(g).length) return;
    if (kind === "gate" && g?.type !== "Point") return;
    const mid = fenceMiddle(f);
    if (!mid || (near && metresBetween(mid, near) > SITE_REACH_M)) return;
    out.push({
      id: `${planId}:${i}`, name: String(p.name ?? "Site").trim(), kind, plan: planId,
      color: fenceColor({ properties: { category: "perimeter" }, geometry: g }), feature: f, circle: null, mid,
    });
  });
  return out;
}

/** The one fence the map draws: the perimeter, else the factory, else the first site fence (never the gate's own). */
export function premisesOf(fences, near) {
  const site = (fences ?? []).filter((f) => f.kind !== "gate");
  const closest = (list) => (near && list.length > 1
    ? [...list].sort((a, b) => metresBetween(a.mid, near) - metresBetween(b.mid, near))[0]
    : list[0]) ?? null;
  return closest(site.filter((f) => f.plan && f.kind === "perimeter"))
    ?? closest(site.filter((f) => f.kind === "perimeter"))
    ?? closest(site.filter((f) => f.kind === "factory"))
    ?? site[0] ?? null;
}

/** Is the point inside the fence: a circle by distance, a polygon by even-odd over its rings. */
export function insideFence(fence, pt) {
  if (!fence || !pt) return false;
  if (fence.circle) return metresBetween(fence.circle, pt) <= fence.circle.radiusM;
  let inside = false;
  for (const ring of ringsOf(fence.feature?.geometry)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt.lat) !== (yj > pt.lat) && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The fence's edges as [lng, lat] pairs (a circle as 48 of them). */
function edgesOf(fence) {
  let rings = ringsOf(fence.feature?.geometry);
  if (fence.circle) {
    const { lat, lng, radiusM } = fence.circle;
    const dLat = radiusM / 111_320, dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    rings = [Array.from({ length: 49 }, (_, k) => [lng + dLng * Math.cos((k / 48) * 2 * Math.PI), lat + dLat * Math.sin((k / 48) * 2 * Math.PI)])];
  }
  const out = [];
  for (const ring of rings) for (let i = 1; i < ring.length; i++) out.push([ring[i - 1], ring[i]]);
  return out;
}

/** Where segment a→b ({lat, lng}) first meets the fence's edge, or null. */
function edgeCrossing(fence, a, b) {
  let best = null;
  for (const [[x3, y3], [x4, y4]] of edgesOf(fence)) {
    const x1 = a.lng, y1 = a.lat, x2 = b.lng, y2 = b.lat;
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (d === 0) continue;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, lat: y1 + t * (y2 - y1), lng: x1 + t * (x2 - x1) };
  }
  return best;
}

/** The point on the fence's edge nearest pt (planar, fine across a site). */
function nearestOnEdge(fence, pt) {
  let best = null;
  for (const [[x1, y1], [x2, y2]] of edgesOf(fence)) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((pt.lng - x1) * dx + (pt.lat - y1) * dy) / len)) : 0;
    const q = { lat: y1 + t * dy, lng: x1 + t * dx };
    const m = metresBetween(q, pt);
    if (!best || m < best.m) best = { ...q, m };
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

/**
 * Where the gate is, so the map always has one:
 *   recorded  the organisation's gate point (fleet-server gate-log `gate`)
 *   plan      the gate on the works-site survey (Sukari's Main Gate)
 *   fence     the middle of a fence drawn as the gate
 *   track     where the unit's track crossed the premises fence nearest the event
 *   edge      the point of the premises fence nearest the unit
 * null only with no gate, no fence and no position.
 */
export function findGate({ gate, fences, premises, fixes, at, here }) {
  if (gate && Number.isFinite(gate.lat) && Number.isFinite(gate.lng)) return { lat: gate.lat, lng: gate.lng, from: "recorded" };
  // A surveyed gate, else a fence drawn as the gate: the one of the drawn
  // premises' own survey, else the nearest to the premises.
  const gates = (fences ?? []).filter((f) => f.kind === "gate");
  const own = premises?.plan ? gates.find((f) => f.plan === premises.plan) : null;
  const ref = premises?.mid ?? here;
  const drawn = own ?? (ref && gates.length > 1 ? [...gates].sort((a, b) => metresBetween(a.mid, ref) - metresBetween(b.mid, ref))[0] : gates[0]);
  if (drawn) return { ...drawn.mid, from: drawn.plan ? "plan" : "fence" };
  if (!premises) return null;
  let best = null;
  const fx = fixes ?? [];
  for (let i = 1; i < fx.length; i++) {
    const a = fx[i - 1], b = fx[i];
    if (insideFence(premises, a) === insideFence(premises, b)) continue;
    const c = edgeCrossing(premises, a, b);
    if (!c) continue;
    const when = a.at + c.t * (b.at - a.at);
    if (!best || Math.abs(when - at) < Math.abs(best.when - at)) best = { lat: c.lat, lng: c.lng, when };
  }
  if (best) return { lat: best.lat, lng: best.lng, from: "track" };
  const edge = here ? nearestOnEdge(premises, here) : null;
  return edge ? { ...edge, from: "edge" } : null;
}

/** Where the gate is: the recorded point, else the middle of a fence drawn as the gate. */
export function gateSpot(gate, fences) {
  const g = findGate({ gate, fences });
  return g ? { lat: g.lat, lng: g.lng } : null;
}

/**
 * Which way the unit is drawn facing: out through the gate for a sign-out,
 * in through it for a return. Along the line between the unit and the gate
 * when the unit was clear of the gate's circle (`nearM`); else across the
 * gate from the premises' middle.
 */
export function gateFacing(way, here, spot, premises, nearM = 60) {
  if (!spot) return null;
  const inner = premises?.mid ?? null;
  // Inside the gate's circle which side of the fence line a fix falls is GPS
  // noise, so there the premises' middle says which way is in.
  if (here && metresBetween(here, spot) > nearM) {
    // Still inside on the way out, it is heading for the gate; outside, away
    // from it. A return mirrors that.
    const inside = premises ? insideFence(premises, here) : way === "in";
    const toGate = way === "out" ? inside : !inside;
    return toGate ? bearing(here, spot) : bearing(spot, here);
  }
  if (inner && metresBetween(inner, spot) > 1) return way === "out" ? bearing(inner, spot) : bearing(spot, inner);
  return null;
}

/** Compass bearing from a to b, degrees. */
function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/**
 * Which way the unit faced at the fix: the tracker's own heading when it sent
 * one, else from the last fix before that is more than jitter away, else
 * towards the first one after. 0 (north) when it never moved.
 */
export function headingAt(fixes, here) {
  if (!here) return 0;
  if (Number.isFinite(here.headingDeg) && here.headingDeg !== 0) return here.headingDeg;
  const far = (f) => metresBetween(f, here) > 15;
  const prev = (fixes ?? []).filter((f) => f.at < here.at && far(f)).pop();
  if (prev) return bearing(prev, here);
  const next = (fixes ?? []).find((f) => f.at > here.at && far(f));
  return next ? bearing(here, next) : 0;
}

/**
 * The words for an acknowledgement, by the way the event went (operator,
 * 2026-11-26: "acknowledge it truly left or got into the premises").
 */
export const ACK_WORDS = {
  out: {
    CONFIRMED: { pick: "It signed out", cell: "Signed out", confirm: "Confirm it signed out", placeholder: "Anything to add? Optional." },
    DISPUTED:  { pick: "It did not sign out", cell: "Did not sign out", confirm: "Record that it did not sign out", placeholder: "Why? e.g. still parked in the yard, signed out by mistake" },
  },
  in: {
    CONFIRMED: { pick: "It signed in", cell: "Signed in", confirm: "Confirm it signed in", placeholder: "Anything to add? Optional." },
    DISPUTED:  { pick: "It did not sign in", cell: "Did not sign in", confirm: "Record that it did not sign in", placeholder: "Why? e.g. still out on the road, signed in by mistake" },
  },
};

/** A dispute needs a reason; a confirmation does not. */
export const ackNoteOk = (outcome, note) => outcome === "CONFIRMED" || String(note ?? "").trim().length >= 3;
