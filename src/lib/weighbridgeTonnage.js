// Tonnes per driver from the weighbridge (operator, 2026-10-31: "the same
// driver was at the weighbridge and weighed a certain amount of cargo").
//
// The server counts a trip's tonnage only from the cargo manifest, and it
// writes one only for a SALES run with a typed tonnage (fleet-server
// lib/trip-builder writeManifest). A cane run has no weight field at the gate,
// so every cane driver read 0 t. The weight is on the weighbridge ticket; this
// credits it to the driver, in the browser, until the server does it itself.
//
// Pure: tickets, trips and the roster come in, tonnes per driver come out.
// api/weighbridgeTonnage gathers the inputs. Tested in weighbridgeTonnage.test.js.
//
// ## How a ticket finds its driver
//
// 1. By the trip: the same truck (vehicle id, or the plate) on a trip whose
//    time covers the weighing, give or take TRIP_SLACK_MS. The trip already
//    belongs to a driver. If the name on the ticket shares no word with that
//    driver's name, the ticket is set aside for review rather than credited.
// 2. Failing a trip, by the name on the ticket, when it matches exactly one
//    driver on the roster.
//
// One ticket is one load, counted once: the mill's net weight when the load
// reached the mill, otherwise the outstation's. A ticket with no net weight
// (not yet weighed out), or one past MAX_LOAD_KG, is not counted.

export const TRIP_SLACK_MS = 2 * 3_600_000;
export const MAX_LOAD_KG = 80_000;

const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ms = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));
/** The fleet day (Africa/Nairobi, UTC+3) a moment falls on. */
const fleetDay = (t) => new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);

/** The words of a name, upper case, initials and punctuation dropped. */
export function nameWords(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z\s'-]/g, ' ').split(/[\s'-]+/).filter((w) => w.length >= 2);
}
const nameKey = (s) => [...new Set(nameWords(s))].sort().join(' ');

/** A weighbridge row as one load, or null when it carries no usable weight. */
export function ticketLoad(w) {
  const factory = Number(w.factoryNetWeightKg);
  const centre = Number(w.netWeightKg);
  const kg = factory > 0 ? factory : centre > 0 ? centre : null;
  if (kg == null || kg > MAX_LOAD_KG) return null;
  const times = [w.tokenAt, w.tareAt, w.grossAt, w.factoryGrossAt, w.factoryTareAt].map(ms).filter(Number.isFinite);
  if (!times.length) return null;
  return {
    id: String(w.id ?? `${w.centerCode}-${w.token}`),
    token: w.token ?? null,
    at: ms(w.grossAt) ?? ms(w.tokenAt) ?? Math.min(...times),
    first: Math.min(...times),
    last: Math.max(...times),
    vehicleId: w.vehicleId ?? null,
    plate: plateKey(w.vehiclePlate ?? w.vehicleNo),
    driver: w.driverName ?? '',
    kg,
    where: w.centerName ?? null,
    toMill: factory > 0,
  };
}

/**
 * @param {object} p
 * @param {object[]} p.tickets  weighbridge rows (api/weighments getWeighmentDay rows), any days
 * @param {{id, driverId, vehicleId, plate, from, to}[]} p.trips  trips, times in ms
 * @param {{id, fullName}[]} p.drivers  the roster
 * @returns {{ byDriver: Map<string, {kg, loads: object[]}>, stats: object, review: object[] }}
 */
export function creditTonnage({ tickets = [], trips = [], drivers = [] }) {
  const roster = new Map(drivers.map((d) => [d.id, d]));
  const byKey = new Map();
  for (const d of drivers) {
    const k = nameKey(d.fullName);
    if (!k) continue;
    byKey.set(k, byKey.has(k) ? null : d);   // a shared name matches nobody
  }

  const tripsOf = new Map();   // vehicle id or plate → trips
  const add = (k, t) => { if (!k) return; const l = tripsOf.get(k); if (l) l.push(t); else tripsOf.set(k, [t]); };
  for (const t of trips) {
    add(t.vehicleId, t);
    const p = plateKey(t.plate);
    if (p) add(`P:${p}`, t);
  }

  const byDriver = new Map();
  const credit = (driverId, load, via, trip) => {
    let d = byDriver.get(driverId);
    if (!d) byDriver.set(driverId, (d = { kg: 0, loads: [] }));
    d.kg += load.kg;
    // Filed under the day it was WEIGHED: a dispatch can stay open for days, and
    // filing every load under the day it began stacked a week on one bar.
    d.loads.push({ ...load, via, tripId: trip?.id ?? null, day: fleetDay(load.at) });
  };

  const stats = { tickets: 0, viaTrip: 0, viaName: 0, unmatched: 0, review: 0 };
  const review = [];
  const seen = new Set();

  for (const row of tickets) {
    const load = ticketLoad(row);
    if (!load || seen.has(load.id)) continue;
    seen.add(load.id);
    stats.tickets += 1;

    // 1. The trip the truck was on when it was weighed.
    const pool = [...(tripsOf.get(load.vehicleId) ?? []), ...(tripsOf.get(`P:${load.plate}`) ?? [])];
    let best = null, bestGap = Infinity;
    for (const t of pool) {
      if (load.last < t.from - TRIP_SLACK_MS || load.first > t.to + TRIP_SLACK_MS) continue;
      const gap = load.at < t.from ? t.from - load.at : load.at > t.to ? load.at - t.to : 0;
      if (gap < bestGap) { best = t; bestGap = gap; }
    }
    if (best?.driverId && roster.has(best.driverId)) {
      const words = nameWords(load.driver);
      const theirs = new Set(nameWords(roster.get(best.driverId).fullName));
      if (words.length && !words.some((w) => theirs.has(w))) {
        stats.review += 1;
        review.push({ ...load, tripDriverId: best.driverId, tripId: best.id });
        continue;
      }
      credit(best.driverId, load, 'trip', best);
      stats.viaTrip += 1;
      continue;
    }

    // 2. The name on the ticket, when exactly one driver has it.
    const d = byKey.get(nameKey(load.driver));
    if (d) {
      credit(d.id, load, 'name', null);
      stats.viaName += 1;
      continue;
    }
    stats.unmatched += 1;
  }
  return { byDriver, stats, review };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The drivers overview (api/drivers getDriversOverview) with the weighbridge
 * tonnes added: roster rows, each driver's totals, per-day series and heaviest
 * load. Typed sales tonnage stays as it is; the weighbridge only carries cane,
 * so nothing is counted twice. The roster row and the driver's detail count
 * the same loads: every one credited over the days read (api/weighbridgeTonnage,
 * the last 90 up to today).
 */
export function withWeighbridgeTonnes(overview, credit) {
  if (!overview || !credit?.byDriver?.size) return overview;
  const details = { ...(overview.details ?? {}) };
  const drivers = (overview.drivers ?? []).map((row) => {
    const c = credit.byDriver.get(row.id);
    if (!c) return row;
    const det = details[row.id];
    if (det) {
      const byDayIn = det.byDay ?? [];
      // The same loads as the roster row: the last `windowDays` days up to
      // today. The server's own window ends at the driver's latest trip, and
      // a load weighed after it (a dispatch not yet built into a trip) would
      // otherwise count in the table and not in the panel.
      const loads = c.loads;
      const kg = c.kg;
      const days = new Map(byDayIn.map((d) => [d.day, { ...d }]));
      for (const l of loads) {
        const d = days.get(l.day) ?? { day: l.day, tonnes: 0, mileageKm: 0 };
        d.tonnes = round1((Number(d.tonnes) || 0) + l.kg / 1000);
        // What the bar's hover lists: each load, where it was weighed.
        d.loads = [...(d.loads ?? []), { tonnes: round1(l.kg / 1000), where: l.where, toMill: l.toMill, at: l.at, token: l.token }]
          .sort((a, b) => a.at - b.at);
        days.set(l.day, d);
      }
      const top = loads.reduce((b, l) => (!b || l.kg > b.kg ? l : b), null);
      const heaviest = top && (!det.heaviestLoad || top.kg / 1000 > det.heaviestLoad.tonnes)
        ? { tonnes: round1(top.kg / 1000), date: l10(top.at), route: top.where ? `Weighed at ${top.where}${top.toMill ? ', net at the mill' : ''}` : 'Weighbridge ticket' }
        : det.heaviestLoad;
      details[row.id] = {
        ...det,
        totals: { ...det.totals, tonnes: round1((Number(det.totals?.tonnes) || 0) + kg / 1000), weighbridgeTonnes: round1(kg / 1000), weighbridgeLoads: loads.length },
        byDay: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
        heaviestLoad: heaviest,
      };
    }
    return { ...row, tonnes: round1((Number(row.tonnes) || 0) + c.kg / 1000), weighbridgeTonnes: round1(c.kg / 1000) };
  });
  // The roster arrives sorted by tonnes, and the leaderboard reads it in order.
  drivers.sort((a, b) => (Number(b.tonnes) || 0) - (Number(a.tonnes) || 0));
  return { ...overview, drivers, details, weighbridge: credit.stats };
}

const l10 = (t) => fleetDay(t);
