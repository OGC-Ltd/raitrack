// The end-of-shift report for one organisation (operator, 2026-10-31): from
// 06:00 to the moment it is made, what the control room hands over. Fuel at
// the top, theft as the one critical section, policy breaches as counts with
// the top five units for each kind, every unit still outside a geofence with
// when it left, then the weighbridge and the products ferried.
//
// Pure: the shift's records come in (api/endOfShiftReport gathers them), the
// report's sections come out. lib/endOfShiftHtml lays them out. Tested in
// endOfShiftReport.test.js.


const H = 3_600_000;
export const SHIFT_START_HOUR = 6;
/** Out longer than this, or with no dispatch, is marked red. */
export const LONG_OUT_MS = 12 * H;
export const TOP = 5;

const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ms = (v) => (v == null ? NaN : typeof v === 'number' ? v : Date.parse(v));
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * A weighbridge row as one load, or null when it has no usable weight: the
 * mill's net when the load reached the mill, otherwise the outstation's.
 * (The Drivers page's lib/weighbridgeTonnage counts a load the same way.)
 */
function ticketLoad(w) {
  const factory = Number(w.factoryNetWeightKg);
  const centre = Number(w.netWeightKg);
  const kg = factory > 0 ? factory : centre > 0 ? centre : null;
  const at = Number.isFinite(ms(w.grossAt)) ? ms(w.grossAt) : ms(w.tokenAt);
  if (kg == null || kg > 80_000 || !Number.isFinite(at)) return null;
  return { id: String(w.id ?? `${w.centerCode}-${w.token}`), at, vehicleId: w.vehicleId ?? null, kg, where: w.centerName ?? null, toMill: factory > 0 };
}
const eatHour = (t) => new Date(t + 3 * H).getUTCHours();

/** 06:00 Nairobi today, or yesterday when it is not yet six. */
export function shiftStart(now = Date.now()) {
  const day = new Date(now + 3 * H).toISOString().slice(0, 10);
  const six = Date.parse(`${day}T0${SHIFT_START_HOUR}:00:00+03:00`);
  return now >= six ? six : six - 24 * H;
}

/** Dashcam alarm codes (fleet-server dashcam/vss-events). */
const PHONE = new Set([116, 264]);
const SEATBELT = new Set([125, 51]);
const COVERED = new Set([123, 3]);
export function alarmKind(a) {
  if (PHONE.has(a?.code)) return 'phone';
  if (SEATBELT.has(a?.code)) return 'seatbelt';
  if (COVERED.has(a?.code)) return 'covered';
  const s = String(a?.label ?? '').toLowerCase();
  if (/phone|texting/.test(s)) return 'phone';
  if (/seat\s*belt/.test(s)) return 'seatbelt';
  if (/camera covered|video cover|lens cover/.test(s)) return 'covered';
  return null;
}

export const BREACHES = [
  { key: 'speed', label: 'Overspeeding' },
  { key: 'phone', label: 'On phone' },
  { key: 'seatbelt', label: 'No seatbelt' },
  { key: 'brake', label: 'Harsh braking' },
  { key: 'accel', label: 'Harsh acceleration' },
  { key: 'covered', label: 'Camera covered' },
];

const NOT_REAL = new Set(['REDISTRIBUTION', 'SENSOR_FAULT']);
const DRAIN_STATUS = {
  DRAIN: 'Theft, not yet reviewed', PENDING: 'Being checked', REFILL: 'Was a refill',
  REDISTRIBUTION: 'Probe swing, came back', SENSOR_FAULT: 'Probe fault',
};
const REVIEW = {
  CONFIRMED_THEFT: ['Confirmed theft', 'c'], UNDER_REVIEW: ['Escalated', 'c'],
  NOT_THEFT: ['De-escalated', 'm'], PROBE_FAULT: ['Probe fault', 'm'], DISMISSED: ['Dismissed', 'm'],
};

/** Commodity by the factory a sales run signs out at (fleet-server webhooks/factory-map). */
const FACTORY_PRODUCT = { NAITIRI: 'Processed sugar', NDHIWA: 'Raw sugarcane' };

/** "KDL 715E · Jane signed out at Naitiri with 29.0t (580 × 50 kg bags) bound for Raiply and left the premises." */
export function parseSale(text) {
  const s = String(text ?? '');
  const t = /with ([\d.]+)\s*t\b/i.exec(s);
  const bags = /\(([\d,]+)\s*×/.exec(s);
  const at = /signed out at (.+?)(?= with | bound for | and left|$)/i.exec(s)?.[1]?.trim() ?? null;
  const dest = /bound for (.+?)(?= and left|\.$|$)/i.exec(s)?.[1]?.trim() ?? null;
  return {
    tonnes: t ? Number(t[1]) : null,
    bags: bags ? Number(bags[1].replace(/,/g, '')) : null,
    at, destination: dest,
    product: FACTORY_PRODUCT[String(at ?? '').toUpperCase()] ?? 'Sales load',
  };
}

/** "KDL 715E left NAITIRI YARD." → "NAITIRI YARD"; an exit into another zone is not a way out. */
export function exitZone(text) {
  const s = String(text ?? '');
  if (/ is now in /i.test(s)) return null;
  return /\bleft (.+?)(?: and .+)?\.?$/i.exec(s)?.[1]?.trim() ?? null;
}

const titleName = (s) => String(s ?? '').trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const mostCommon = (xs) => {
  const m = new Map();
  for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/**
 * @param {object} p
 * @param {number} p.from, p.to   the shift, ms
 * @param {object[]} p.vehicles   mapped snapshot vehicles (lib/vehicleMap mapSnapshotVehicle)
 * @param {object[]} p.fillings, p.thefts   fuel/fillings and fuel/thefts rows
 * @param {object[]} p.speeding   incidents/speeding/summary rows over the shift
 * @param {object[]} p.harsh      feed items HARSH_BRAKING / HARSH_ACCELERATION
 * @param {object[]|null} p.alarms   dashcam alarms (api/vssAlarms rows); null without dashcams
 * @param {object[]} p.zones      feed items ZONE_EXIT and ZONE_ENTRY over the shift, any order
 * @param {object[]|null} p.tickets  weighbridge rows; null for a fleet without weighbridges
 * @param {object[]} p.sales      feed items SALE_DISPATCH
 * @param {Map<string,string>} [p.places]  vehicleId → place name, for "Now near"
 */
export function buildEndOfShift({
  from, to, vehicles = [], fillings = [], thefts = [], speeding = [], harsh = [], alarms = null,
  zones = [], tickets = null, sales = [], places = new Map(),
}) {
  const inShift = (t) => Number.isFinite(t) && t >= from && t <= to;
  const byId = new Map(vehicles.map((v) => [v.vehicleId, v]));
  const byPlate = new Map(vehicles.map((v) => [plateKey(v.regPlate ?? v.id), v]));
  const unitOf = (vehicleId, plate) => byId.get(vehicleId) ?? byPlate.get(plateKey(plate)) ?? null;
  const plateOf = (vehicleId, plate) => { const v = unitOf(vehicleId, plate); return v ? (v.regPlate ?? v.id) : (plate || '?'); };
  const driverOf = (vehicleId, plate) => { const d = unitOf(vehicleId, plate)?.driver; return d && d !== 'Unassigned' ? d : null; };

  // ── fuel ──
  const refills = fillings
    .map((f) => ({ t: ms(f.filledAt), plate: plateOf(f.vehicleId), litres: f.filledMl != null ? round1(f.filledMl / 1000) : 0, place: f.location ?? null, real: !NOT_REAL.has(f.verdict) }))
    .filter((f) => inShift(f.t) && f.real);
  const drainsAll = thefts.map((d) => {
    const ml = d.cleanDropMl ?? d.stolenMl;
    const review = REVIEW[d.reviewStatus] ?? null;
    return {
      t: ms(d.beganAt ?? d.detectedAt), plate: plateOf(d.vehicleId), driver: driverOf(d.vehicleId),
      litres: ml != null ? round1(ml / 1000) : 0, place: d.initialLocation ?? null,
      verdict: d.verdict ?? 'PENDING', stationary: d.initialSpeedKmh === 0,
      status: review?.[0] ?? DRAIN_STATUS[d.verdict ?? 'PENDING'] ?? d.verdict, tone: review?.[1] ?? (d.verdict === 'DRAIN' ? 'c' : d.verdict === 'PENDING' ? 'o' : 'm'),
      escalated: d.reviewStatus === 'CONFIRMED_THEFT' || d.reviewStatus === 'UNDER_REVIEW',
    };
  }).filter((d) => inShift(d.t)).sort((a, b) => a.t - b.t);
  const sumL = (xs) => round1(xs.reduce((n, x) => n + (x.litres || 0), 0));

  // ── policy breaches ──
  const per = Object.fromEntries(BREACHES.map((b) => [b.key, new Map()]));
  const bump = (kind, vehicleId, plate, extra = {}) => {
    const p = plateOf(vehicleId, plate);
    const m = per[kind];
    const r = m.get(p) ?? { plate: p, driver: driverOf(vehicleId, plate), times: 0 };
    r.times += extra.times ?? 1;
    if (extra.peak != null) { r.peak = Math.max(r.peak ?? 0, extra.peak); r.limit = extra.limit ?? r.limit; }
    if (extra.overSec != null) {
      // Average over the limit, weighted by cases, across the unit's rows.
      const n0 = r.cases ?? 0, n1 = extra.times ?? 1;
      if (extra.avgOver != null) r.avgOver = ((r.avgOver ?? 0) * n0 + extra.avgOver * n1) / (n0 + n1);
      r.cases = n0 + n1;
      r.overSec = (r.overSec ?? 0) + extra.overSec;
    }
    if (!r.driver && extra.driver) r.driver = extra.driver;
    m.set(p, r);
  };
  for (const s of speeding) {
    bump('speed', s.vehicleId, s.plate, { times: s.incidents ?? 1, peak: s.peakKmh, limit: s.limitKmh, driver: s.driverName,
      overSec: s.totalSeconds ?? 0, avgOver: s.avgOverKmh ?? null });
  }
  const seen = new Set();
  for (const h of harsh) {
    const t = ms(h.ts ?? h.time);
    if (!inShift(t) || seen.has(h.id)) continue;
    seen.add(h.id);
    if (h.alertType === 'HARSH_BRAKING') bump('brake', h.vehicleId, h.plate);
    else if (h.alertType === 'HARSH_ACCELERATION') bump('accel', h.vehicleId, h.plate);
  }
  for (const a of alarms ?? []) {
    const k = alarmKind(a);
    if (k && inShift(a.occurredMs)) bump(k, a.vehicleId, a.plate);
  }
  const breaches = BREACHES.map((b) => {
    // Overspeeding ranks by time spent over the limit; the rest by how often.
    const rank = b.key === 'speed'
      ? (x, y) => (y.overSec ?? 0) - (x.overSec ?? 0) || (y.peak ?? 0) - (x.peak ?? 0)
      : (x, y) => y.times - x.times;
    const rows = [...per[b.key].values()].sort((x, y) => rank(x, y) || x.plate.localeCompare(y.plate));
    return { ...b, total: rows.reduce((n, r) => n + r.times, 0), units: rows.length, top: rows.slice(0, TOP),
      fromDashcam: ['phone', 'seatbelt', 'covered'].includes(b.key) };
  });

  // ── out of geofence during the shift ──
  // Only what happened in the shift (operator, 2026-10-31): a unit that left a
  // geofence after 06:00 and is still outside is listed; one that left and
  // came back is counted, with how long it was out. A unit already outside at
  // 06:00 is neither.
  const zoneEvents = zones
    .map((e) => ({ t: ms(e.ts ?? e.time), v: unitOf(e.vehicleId, e.plate), exit: e.alertType === 'ZONE_EXIT', text: e.text }))
    .filter((e) => e.v && inShift(e.t))
    .sort((a, b) => a.t - b.t);
  const open = new Map();      // vehicleId → { at, zone } while out
  const trips = [];            // out and back: { plate, out, back, zone }
  for (const e of zoneEvents) {
    const id = e.v.vehicleId;
    if (e.exit) {
      const zone = exitZone(e.text);
      if (zone && !open.has(id)) open.set(id, { at: e.t, zone });
    } else if (open.has(id)) {
      const o = open.get(id);
      trips.push({ plate: e.v.regPlate ?? e.v.id, out: o.at, back: e.t, ms: e.t - o.at, zone: titleName(o.zone) });
      open.delete(id);
    }
  }
  const zonesKnown = zones.length > 0 || vehicles.some((v) => v.zones?.known && v.zones.inside?.length);
  const outside = [...open].map(([id, o]) => ({ v: byId.get(id), o }))
    // The snapshot has the last word: a unit it places inside a zone is back, whatever the feed missed.
    .filter(({ v }) => v && !(v.zones?.known && (v.zones.inside ?? []).some((z) => z.area !== false)))
    .map(({ v, o }) => {
      const seenAt = v.capturedAtMs ?? ms(v.capturedAt);
      const tag = v.trip?.externalId ?? null;
      const forMs = to - o.at;
      return {
        plate: v.regPlate ?? v.id, driver: v.driver && v.driver !== 'Unassigned' ? v.driver : null,
        left: titleName(o.zone), since: o.at, forMs,
        near: places.get(v.vehicleId) ?? null, lat: v.lat, lng: v.lng,
        silentSince: Number.isFinite(seenAt) && to - seenAt > 2 * H ? seenAt : null,
        dispatch: tag, noDispatch: !tag, long: forMs > LONG_OUT_MS,
      };
    })
    .sort((a, b) => Number(b.noDispatch) - Number(a.noDispatch) || a.since - b.since);
  const backUnits = new Set(trips.map((x) => x.plate));
  const totalOutMs = trips.reduce((n, x) => n + x.ms, 0);
  const longest = trips.reduce((b, x) => (!b || x.ms > b.ms ? x : b), null);
  const outAndBack = {
    units: backUnits.size, times: trips.length, totalMs: totalOutMs,
    avgMs: trips.length ? totalOutMs / trips.length : null, longest,
  };

  // ── weighbridge ──
  let weighbridge = null;
  const loads = [];
  if (tickets) {
    const seenT = new Set();
    for (const w of tickets) {
      const l = ticketLoad(w);
      if (!l || seenT.has(l.id) || !inShift(l.at)) continue;
      seenT.add(l.id);
      loads.push({ ...l, product: w.productName || 'Sugarcane', plate: plateOf(l.vehicleId, w.vehiclePlate ?? w.vehicleNo), driverName: w.driverName });
    }
    const bridges = new Map();
    for (const l of loads) {
      const b = bridges.get(l.where ?? 'Unknown') ?? { name: l.where ?? 'Unknown', tickets: 0, kg: 0, hours: new Map() };
      b.tickets += 1; b.kg += l.kg;
      const h = eatHour(l.at); b.hours.set(h, (b.hours.get(h) ?? 0) + 1);
      bridges.set(b.name, b);
    }
    const units = new Map();
    for (const l of loads) {
      const u = units.get(l.plate) ?? { plate: l.plate, trips: 0, kg: 0, bridges: new Set(), names: [] };
      u.trips += 1; u.kg += l.kg; if (l.where) u.bridges.add(l.where); u.names.push(l.driverName);
      units.set(l.plate, u);
    }
    const multi = [...units.values()].filter((u) => u.trips > 1)
      .map((u) => ({ plate: u.plate, driver: driverOfPlate(u.plate) ?? (titleName(mostCommon(u.names)) || null), trips: u.trips, tonnes: round1(u.kg / 1000), bridges: [...u.bridges].map(titleName) }))
      .sort((a, b) => b.trips - a.trips || b.tonnes - a.tonnes);
    weighbridge = {
      tickets: loads.length,
      tonnes: round1(loads.reduce((n, l) => n + l.kg, 0) / 1000),
      units: units.size,
      multiUnits: multi.length,
      bridges: [...bridges.values()].map((b) => {
        const [hr] = [...b.hours].sort((x, y) => y[1] - x[1])[0] ?? [];
        return { name: titleName(b.name), tickets: b.tickets, tonnes: round1(b.kg / 1000), busiest: hr != null ? `${String(hr).padStart(2, '0')}:00–${String((hr + 1) % 24).padStart(2, '0')}:00` : null };
      }).sort((a, b) => b.tonnes - a.tonnes),
      multi,
    };
  }
  function driverOfPlate(p) { const d = byPlate.get(plateKey(p))?.driver; return d && d !== 'Unassigned' ? d : null; }

  // ── products ferried ──
  const prod = new Map();
  const add = (name, row) => {
    const p = prod.get(name) ?? { product: name, loads: 0, units: new Set(), kg: 0, bags: 0, where: new Map(), source: row.source };
    p.loads += 1; p.units.add(row.plate); p.kg += row.kg ?? 0; p.bags += row.bags ?? 0;
    if (row.to) p.where.set(row.to, (p.where.get(row.to) ?? 0) + 1);
    prod.set(name, p);
  };
  for (const l of loads) add(titleName(l.product), { plate: l.plate, kg: l.kg, to: l.toMill ? 'Mill' : titleName(l.where), source: 'Weighbridge tickets' });
  const seenS = new Set();
  for (const s of sales) {
    const t = ms(s.ts ?? s.time);
    if (!inShift(t) || seenS.has(s.id)) continue;
    seenS.add(s.id);
    const p = parseSale(s.text);
    add(p.product, { plate: plateOf(s.vehicleId, s.plate), kg: p.tonnes != null ? p.tonnes * 1000 : 0, bags: p.bags, to: p.destination ? titleName(p.destination) : null, source: 'Sales dispatches' });
  }
  const products = [...prod.values()].map((p) => ({
    product: p.product, loads: p.loads, units: p.units.size, tonnes: round1(p.kg / 1000), bags: p.bags || null,
    where: [...p.where].sort((a, b) => b[1] - a[1]).map(([w, n]) => (p.where.size > 1 ? `${w} ${n}` : w)).join(', '), source: p.source,
  })).sort((a, b) => b.tonnes - a.tonnes);

  // Reporting = the tracker sent something since the shift began, not "engine on now".
  const reported = vehicles.filter((v) => { const t = v.capturedAtMs ?? ms(v.capturedAt); return Number.isFinite(t) && t >= from; }).length;
  return {
    from, to,
    fleet: { units: vehicles.length, reporting: reported },
    fuel: {
      refills: refills.length, refillL: sumL(refills), topRefills: [...refills].sort((a, b) => b.litres - a.litres).slice(0, TOP),
      drains: drainsAll, drainL: sumL(drainsAll),
    },
    // Critical: only the drains a reviewer escalated (operator, 2026-10-31).
    theft: drainsAll.filter((d) => d.escalated),
    breaches, breachTotal: breaches.reduce((n, b) => n + b.total, 0), dashcam: alarms != null,
    outside, outAndBack, zonesKnown,
    weighbridge,
    products,
  };
}
