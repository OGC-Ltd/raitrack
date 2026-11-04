// The Deliveries Report (operator, 4 Nov 2026; Menengai's Finished Goods and
// Van Sales sheet): for the vehicles shared on a day, when each left its
// storage (MORL HQ in Nakuru, or the Nairobi depot), how many of the customers
// it was given it has delivered to, where it is now, and when it came back.
//
// The orders come from an app with no API, so the operator gives each vehicle
// its customers (lib/deliveryPlan): customer geofences on the platform
// (MENENGAI_VS / MENENGAI_FG). A customer is delivered to when the vehicle
// stood inside its geofence for at least STOP_MS after leaving storage
// (operator: "about a minute and a half").
//
// Pure: no React, no network.

import { fenceContains } from './zoneContainment';
import { metresToFence } from './movementDepots';

/** At least this long inside a customer's geofence is a delivery. */
export const STOP_MS = 90_000;
/** Out of storage and back within this is the fix wandering at the gate, not a trip. */
export const BLIP_MS = 10 * 60_000;
/** Shorter than this in a storage's circle is driving past it, not coming back to it: the road runs through the 1 km. */
export const MIN_STAY_MS = 10 * 60_000;
/** Read first: the last days, which hold most trips under way; then a day further back at a time, up to MAX_LOOKBACK_DAYS. */
export const LOOKBACK_DAYS = 3;
export const MAX_LOOKBACK_DAYS = 10;
/**
 * Around each storage, still the storage: the Nairobi depot's fence is drawn
 * round the yard alone (about 35 m), and a van at the gate or parked on the
 * road outside is at the depot. Not the 1 km of Movements' blue: shops within
 * a kilometre of the depot would then read as the van back at storage, its
 * trip ended, and their deliveries lost.
 */
export const STORAGE_MARGIN_M = { morl: 200, nairobi: 150 };
/**
 * MORL as Wialon Logistics has it (operator, 4 Nov 2026: "we have used this
 * coordinate as the depot for Menengai and 1 km radius"): a vehicle within
 * MORL_RADIUS_M of this point is at MORL. MORL's own geofence counts too.
 */
export const MORL_POINT = { lat: -0.28802969095623043, lng: 36.04494759379902 };
export const MORL_RADIUS_M = 1000;
/** The Nairobi depot (STO) as Wialon Logistics has it, the same way: 1 km round its point, its geofence too. */
export const STO_POINT = { lat: -1.3029466, lng: 36.8660916 };
export const STO_RADIUS_M = 1000;
/** A customer this close to a storage reads as being at it, and is flagged. */
export const NEAR_STORAGE_M = 200;


/** The vehicles' groups on Menengai's fleet list. */
export const GROUPS = ['Finished Goods', 'Van Sales'];
export const COLUMNS = ['Reg', 'Time left MORL/STO', 'Orders fulfilled', 'Current location', 'Time arrived MORL/STO'];

const OFFSET = 3 * 3600_000;
const nameOf = (f) => String(f?.properties?.name ?? f?.properties?.title ?? '').trim();
const isArea = (f) => {
  const t = f?.geometry?.type;
  return t === 'Polygon' || t === 'MultiPolygon' || (t === 'Point' && Number.isFinite(f?.properties?.radiusM) && f.properties.radiusM > 0);
};

/**
 * The storages: MORL HQ as the Movements report names its fence (`morlName`),
 * else a fence named MORL, else the HQ yard, and the Nairobi depot. Never any
 * fence with MORL in its name: "MORL: BATCHUMA/MIASENYI -TOTAL NO STOP ZONE"
 * lies on the Mombasa road, some 400 km from Nakuru.
 */
export function findStorages(featureCollection, morlName = null) {
  const areas = (featureCollection?.features ?? []).filter(isArea);
  const byName = (re) => areas.find((f) => re.test(nameOf(f)));
  const morl = (morlName && areas.find((f) => nameOf(f) === morlName))
    ?? byName(/^morl$/i) ?? byName(/nakuru\s*hq/i) ?? byName(/menengai\s*yard/i);
  const nairobi = byName(/nairobi\s*depot/i);
  return [
    { key: 'morl', label: 'MORL', short: 'MORL', marginM: 0, fence: morl ?? null,
      feature: { type: 'Feature', properties: { name: 'MORL', radiusM: MORL_RADIUS_M }, geometry: { type: 'Point', coordinates: [MORL_POINT.lng, MORL_POINT.lat] } },
      name: `${MORL_POINT.lat.toFixed(5)}, ${MORL_POINT.lng.toFixed(5)}, ${MORL_RADIUS_M / 1000} km round${morl ? `; geofence ${nameOf(morl)}` : ''}` },
    { key: 'nairobi', label: 'Nairobi depot', short: 'STO', marginM: 0, fence: nairobi ?? null,
      feature: { type: 'Feature', properties: { name: 'STO', radiusM: STO_RADIUS_M }, geometry: { type: 'Point', coordinates: [STO_POINT.lng, STO_POINT.lat] } },
      name: `${STO_POINT.lat.toFixed(5)}, ${STO_POINT.lng.toFixed(5)}, ${STO_RADIUS_M / 1000} km round${nairobi ? `; geofence ${nameOf(nairobi)}` : ''}` },
  ];
}

/** The storage a reading is at: inside its fence, or within its margin of it. */
export function storageAt(p, storages) {
  for (const s of storages) if (fenceContains(p, s.feature) || (s.fence && fenceContains(p, s.fence)) || metresToFence(p, s.feature) <= (s.marginM ?? 0)) return s;
  return null;
}

const R = 6_371_000;
const rad = (x) => (x * Math.PI) / 180;
const metres = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** A fence's middle: a circle's centre, or the average of a polygon's corners. */
export function middleOf(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === 'Point') return { lat: g.coordinates[1], lng: g.coordinates[0] };
  const ring = g.type === 'Polygon' ? g.coordinates?.[0] : g.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : null;
  if (!ring?.length) return null;
  const s = ring.reduce((a, [lng, lat]) => ({ lat: a.lat + lat, lng: a.lng + lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / ring.length, lng: s.lng / ring.length };
}

/**
 * The stops a vehicle can be given: every geofence of the organisation
 * (operator, 4 Nov 2026: "pull all geofences"), the storages left out, A–Z.
 * Customer points (MENENGAI_VS / MENENGAI_FG) read without that prefix and
 * are marked VS or FG. `nearStorage`: within NEAR_STORAGE_M of a storage.
 */
export function customersIn(featureCollection, storages = []) {
  const skip = new Set(storages.flatMap((s) => [s.feature, s.fence].filter(Boolean)));
  const mids = storages.map((s) => ({ m: middleOf(s.feature), r: Math.max(NEAR_STORAGE_M, s.marginM ?? 0, s.feature?.properties?.radiusM ?? 0) })).filter((x) => x.m);
  const seen = new Set();
  const out = [];
  for (const f of featureCollection?.features ?? []) {
    const name = nameOf(f);
    if (!isArea(f) || skip.has(f) || !name || seen.has(name)) continue;
    seen.add(name);
    const mid = middleOf(f);
    const kind = /^menengai_vs/i.test(name) ? 'VS' : /^menengai_fg/i.test(name) ? 'FG' : 'Geofence';
    out.push({ name, label: name.replace(/^menengai_(vs|fg)\s*:\s*/i, '').trim() || name, kind, feature: f,
      nearStorage: Boolean(mid && mids.some((x) => metres(mid, x.m) <= x.r)) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true }));
}

/**
 * Every trip out of storage up to `to`, from the vehicle's readings (sorted).
 * A stay in a storage lasts MIN_STAY_MS, or is where the vehicle is now; out of
 * storage and back within BLIP_MS is the fix wandering at the gate, one stay.
 * @returns {{ trips: Array<{leftAt, leftFrom, arrivedAt, arrivedTo}>, inStorage, need }}
 *   `inStorage`: the storage it is in at the end; `need`: no stay in what was
 *   read (read further back).
 */
export function tripsOf(pings, storages, { to }) {
  const marks = [];
  for (const p of pings ?? []) {
    if (p.t > to || !Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue;
    marks.push({ t: p.t, at: storageAt(p, storages) });
  }
  const stays = [];
  let run = null;
  const close = (end) => {
    if (end == null || end - run.start >= MIN_STAY_MS) stays.push({ ...run, end });
    run = null;
  };
  for (const m of marks) {
    if (run && m.at?.key !== run.at.key) close(m.t);
    if (m.at && !run) run = { at: m.at, start: m.t };
  }
  if (run) close(null);    // still there: end null, however short so far

  const merged = [];
  for (const s of stays) {
    const last = merged[merged.length - 1];
    if (last && last.at.key === s.at.key && s.start - last.end < BLIP_MS) last.end = s.end;
    else merged.push({ ...s });
  }
  const trips = [];
  merged.forEach((s, i) => {
    if (s.end == null) return;
    const back = merged[i + 1];
    trips.push({ leftAt: s.end, leftFrom: s.at, arrivedAt: back?.start ?? null, arrivedTo: back?.at ?? null });
  });
  const last = merged[merged.length - 1];
  return { trips, inStorage: last?.end == null ? last?.at ?? null : null, need: !merged.length };
}

const overlaps = (trip, from, to) => trip.leftAt <= to && (trip.arrivedAt == null || trip.arrivedAt >= from);

/**
 * The trip the report shows: the last one in [from, to], or, with none, where
 * it stood: a trip that ended before the window is not this report's.
 * @returns {{ leftAt, leftFrom, arrivedAt, arrivedTo, need, inStorage? }}
 */
export function tripOf(pings, storages, { from = -Infinity, to }) {
  const { trips, inStorage, need } = tripsOf(pings, storages, { to });
  const shown = [...trips].reverse().find((x) => overlaps(x, from, to));
  if (shown) return { ...shown, need: false };
  return { leftAt: null, leftFrom: null, arrivedAt: null, arrivedTo: null, need, ...(inStorage ? { inStorage } : {}) };
}

/**
 * The customers delivered to in [from, to]: inside each one's geofence for at
 * least STOP_MS, from the first reading inside to the first outside after it.
 * @returns {Map<string, number>} customer name → when the delivery began
 */
export function deliveries(pings, customers, { from, to }) {
  const got = new Map();
  const list = (pings ?? []).filter((p) => p.t >= from && p.t <= to && Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  for (const c of customers) {
    let inAt = null;
    for (let i = 0; i <= list.length; i++) {
      const p = list[i];
      const inside = p ? fenceContains(p, c.feature) : false;
      if (inside && inAt == null) inAt = p.t;
      if (!inside && inAt != null) {
        const outAt = p ? p.t : list[list.length - 1].t;
        if (outAt - inAt >= STOP_MS) { got.set(c.name, inAt); break; }
        inAt = null;
      }
    }
  }
  return got;
}

/**
 * One row: the vehicle's trip, its customers ticked off, where it is.
 * @param {object} plan     { plate, customers: [names] }
 * @param {object[]} pings  its readings, sorted
 * @param {number} [o.from]  the report's window starts here: every trip in the
 *   window counts, a delivery before it does not. Not given: the last trip alone.
 */
export function deliveryRow(plan, pings, storages, customerByName, { from = null, to, place = null, lastFix = null, atMorl = false, unread = false }) {
  // Its last position as Movements has it, when newer than the readings: a
  // parked tracker can go quiet for days
  const all = lastFix && Number.isFinite(lastFix.lat) && Number.isFinite(lastFix.t) && lastFix.t <= to
    && !(pings ?? []).some((p) => p.t >= lastFix.t) ? [...(pings ?? []), lastFix] : (pings ?? []);
  let trip = tripOf(all, storages, { from: from ?? -Infinity, to });
  // Movements reads it at MORL (the server's own MORL geofence): it is, whatever the readings missed
  if (atMorl && trip.leftAt == null && !trip.inStorage) {
    trip = { ...trip, need: false, inStorage: storages.find((s) => s.key === 'morl') ?? { key: 'morl', label: 'MORL', short: 'MORL' } };
  }
  pings = all;
  // Its trackers could not be read at all: say so, rather than that it was nowhere
  if (unread && !all.length) trip = { ...trip, need: false, unread: true };
  const picked = [
    ...(plan.customers ?? []).map((n) => customerByName.get(n) ?? { name: n, label: n, missing: true }),
  ];
  const known = picked.filter((c) => !c.missing);
  // Each trip in the window, the earliest visit to a customer standing
  const start = from ?? trip.leftAt;
  const done = new Map();
  if (start != null) {
    for (const x of tripsOf(pings, storages, { to }).trips.filter((y) => overlaps(y, start, to))) {
      for (const [name, when] of deliveries(pings, known, { from: Math.max(x.leftAt, start), to: Math.min(x.arrivedAt ?? to, to) })) {
        if (!done.has(name)) done.set(name, when);
      }
    }
  }
  const last = [...(pings ?? [])].reverse().find((p) => p.t <= to && Number.isFinite(p.lat));
  return {
    plate: plan.plate, vehicleId: plan.vehicleId, trip, place,
    lastAt: last?.t ?? null,
    customers: picked.map((c) => ({ ...c, at: done.get(c.name) ?? null })),
    fulfilled: done.size, planned: picked.length,
  };
}

const p2 = (n) => String(n).padStart(2, '0');
/** "30.10.2026 04:05:02", as the sheet writes it. */
export function stamp(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + OFFSET);
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
const hm = (ms) => (Number.isFinite(ms) ? stamp(ms).slice(11, 16) : '');
export const dayWords = (ms) => stamp(ms).slice(0, 10);

/** Why there is no time left: in a storage since the readings began, or not at one in them. */
export function notLeftWords(trip, days = MAX_LOOKBACK_DAYS) {
  if (trip.unread) return 'Positions could not be read';
  if (trip.inStorage) return `At ${trip.inStorage.label}, not left`;
  return `Not at MORL/STO in ${days} days`;
}

/**
 * "8/10" typed in the Orders fulfilled box: { fulfilled, planned }, or null
 * when it does not read (then the report's own count stands). 8 of 10 at most 10.
 */
export function readOrders(text) {
  const m = /^\s*(\d{1,4})\s*\/\s*(\d{1,4})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const fulfilled = Number(m[1]);
  const planned = Number(m[2]);
  return fulfilled <= planned ? { fulfilled, planned } : null;
}

export function rowCells(r) {
  return [
    r.plate,
    r.trip.leftAt != null ? `${stamp(r.trip.leftAt)} (${r.trip.leftFrom?.short ?? ''})` : notLeftWords(r.trip),
    `${r.fulfilled}/${r.planned}`,
    r.trip.arrivedAt != null && r.trip.arrivedTo ? r.trip.arrivedTo.label : (r.place ?? '-'),
    r.trip.arrivedAt != null ? stamp(r.trip.arrivedAt) : '',
  ];
}

export function csvTable(rows) {
  return {
    head: [...COLUMNS, 'Left from', 'Customers delivered', 'Customers not yet'],
    body: rows.map((r) => [...rowCells(r), r.trip.leftFrom?.label ?? '',
      r.customers.filter((c) => c.at).map((c) => `${c.label} ${hm(c.at)}`).join('; '),
      r.customers.filter((c) => !c.at).map((c) => c.label).join('; ')]),
  };
}

/**
 * What the server draws the PDF from (POST reports/deliveries.pdf, the JPEG
 * comes from that PDF). Rows, not figures to work out again: the trips are read
 * here, and an operator may have typed over the orders.
 * `stops: false` (operator, 4 Nov 2026: "I should be able to select if I want
 * the pick up locations to be shown on the report or not"): the table alone.
 */
export function deliveriesPdfBody(rows, { from, at, fleet, group = null, stops = true }) {
  return {
    fleet, from: Math.round(from), at: Math.round(at), group: group ?? 'all', stops,
    rows: rows.map((r) => ({
      plate: r.plate,
      leftAt: r.trip.leftAt ?? null,
      leftFrom: r.trip.leftFrom ? { short: r.trip.leftFrom.short, label: r.trip.leftFrom.label } : null,
      notLeft: r.trip.leftAt != null ? null : notLeftWords(r.trip),
      fulfilled: r.fulfilled,
      planned: r.planned,
      place: r.place ?? null,
      arrivedAt: r.trip.arrivedAt ?? null,
      arrivedTo: r.trip.arrivedTo?.label ?? null,
      customers: r.customers.map((c) => ({ label: c.label, at: c.at ?? null, ...(c.missing ? { missing: true } : {}) })),
    })),
  };
}
