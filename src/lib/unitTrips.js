// Weighbridges › Unit trips (operator, 18 Nov 2026): each unit's trips on a day
// and the kilometres it covered that day.
//
// A trip is one weighbridge ticket. A delivery is weighed twice and a transfer
// four times, but each is one ticket, one load carried, so the ticket is the
// count. Tickets fall on the fleet day of their token, which is the day the
// server files them under, and a unit is its normalised plate, the key the
// server already uses for a lorry's day.
//
// The kilometres are the tracker's own odometer (io_16) over the fleet day:
// stored per fix from 18 Nov 2026, and pulled from Wialon, then stored, for a
// day we hold none of (operator: "we need to pull that from wialon; if we don't
// have it we pull, then store"). A unit that sends no odometer keeps the sum
// over its GPS fixes. A lorry with no tracker has no distance, shown as such,
// never as a zero.
//
// Km per trip is measured trip by trip (operator, 18 Nov 2026): the odometer
// when the unit comes back laden, minus the odometer when it left empty, which
// is mostly the same ticket's tare (tripLegs, tripKmByTicket).

import { fleetDayKey } from "../hooks/useFuelEvents";

/**
 * One row per unit per fleet day, the latest day first, then the most trips.
 *
 * @param {object[]} tickets weighment rows ({ tokenAt, vehiclePlate, vehicleNo, vehicleId, driverName, netWeightKg })
 * @param {Map<string, Map<string, {km: number, source: string|null}>>} kmByDay fleet day → vehicleId → the day's distance, for the days read
 * @param {Map<string, number>} tripKm ticket id → the measured trip that arrived for it, km (tripKmByTicket)
 * @returns {{ day, plate, unit, vehicleId, drivers: string[], bridges: string[], trips, netKg, firstAt, lastAt,
 *   loadMs, loadN, tripKm, tripN, km: number|null, kmSource: string|null, noFixes: boolean }[]}
 *   `tripKm`/`tripN` the measured trips' kilometres and count.
 *   `bridges` the weighbridges its tickets were raised at, `firstAt`/`lastAt` its first and last ticket's
 *   time (ISO), `loadMs`/`loadN` the summed load time (tare to gross) over the tickets that have one.
 *   `km` is null when the unit carries no tracker or its day was not read.
 */
export function unitTripRows(tickets, kmByDay = new Map(), tripKm = new Map()) {
  const byKey = new Map();
  for (const t of tickets ?? []) {
    if (!t?.tokenAt) continue;
    const day = fleetDayKey(new Date(t.tokenAt));
    const plate = t.vehiclePlate || t.vehicleNo;
    if (!plate) continue;
    const key = `${day}|${plate}`;
    let row = byKey.get(key);
    if (!row) {
      row = { day, plate, unit: t.vehicleNo || plate, vehicleId: null, drivers: [], bridges: [], trips: 0, netKg: 0,
        firstAt: t.tokenAt, lastAt: t.tokenAt, loadMs: 0, loadN: 0, tripKm: 0, tripN: 0 };
      byKey.set(key, row);
    }
    row.trips += 1;
    const legKm = tripKm.get(t.id);
    if (legKm != null) { row.tripKm += legKm; row.tripN += 1; }
    row.netKg += t.netWeightKg ?? 0;
    if (Date.parse(t.tokenAt) < Date.parse(row.firstAt)) row.firstAt = t.tokenAt;
    if (Date.parse(t.tokenAt) > Date.parse(row.lastAt)) row.lastAt = t.tokenAt;
    if (Number.isFinite(t.turnaroundMs) && t.turnaroundMs >= 0) { row.loadMs += t.turnaroundMs; row.loadN += 1; }
    const bridge = String(t.centerName ?? "").trim();
    if (bridge && !row.bridges.includes(bridge)) row.bridges.push(bridge);
    if (!row.vehicleId && t.vehicleId) row.vehicleId = t.vehicleId;
    const driver = String(t.driverName ?? "").trim();
    if (driver && !row.drivers.includes(driver)) row.drivers.push(driver);
  }
  return [...byKey.values()]
    .map((r) => {
      const d = r.vehicleId ? kmByDay.get(r.day)?.get(r.vehicleId) : undefined;
      const km = d?.km;
      // Nothing summed for a unit the bridge weighed that day: its tracker sent no fixes (all 88 such
      // unit-days on 17 Nov 2026 had none), not a unit that stood still, so no figure rather than 0.
      const noFixes = km != null && km <= 0;
      const none = km == null || noFixes;
      return { ...r, km: none ? null : Math.round(km * 10) / 10, kmSource: none ? null : d.source ?? null, noFixes };
    })
    // In a day: the most trips, then the furthest, a unit with no distance after those with one
    .sort((a, b) => (a.day === b.day
      ? b.trips - a.trips || (b.km ?? -1) - (a.km ?? -1) || a.unit.localeCompare(b.unit)
      : a.day < b.day ? 1 : -1));
}

/**
 * The span's unit-days as one row per unit (operator, 18 Nov 2026: "a toggle that consolidates it
 * all ... pick a single car and sum up its collective data"). Trips, net, load times and kilometres
 * are summed over its days; `days` lists them, `kmDays` the days that had a distance and `kmTrips`
 * those days' trips, so km per trip is never diluted by a day with no distance read; `perDay` its
 * unit-day rows, oldest first, for the side panel.
 */
export function consolidateUnitRows(rows) {
  const byPlate = new Map();
  // Oldest day first, so drivers and bridges are listed in the order they came
  for (const r of [...(rows ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    let u = byPlate.get(r.plate);
    if (!u) {
      u = { ...r, day: null, days: [], perDay: [], drivers: [], bridges: [], trips: 0, netKg: 0, loadMs: 0, loadN: 0,
        km: null, kmDays: 0, kmSource: null, noFixes: false, tripKm: 0, tripN: 0 };
      byPlate.set(r.plate, u);
    }
    u.days.push(r.day);
    u.perDay.push(r);
    u.trips += r.trips;
    u.tripKm += r.tripKm ?? 0;
    u.tripN += r.tripN ?? 0;
    u.netKg += r.netKg;
    u.loadMs += r.loadMs ?? 0;
    u.loadN += r.loadN ?? 0;
    if (!u.vehicleId && r.vehicleId) u.vehicleId = r.vehicleId;
    if (Date.parse(r.firstAt) < Date.parse(u.firstAt)) u.firstAt = r.firstAt;
    if (Date.parse(r.lastAt) > Date.parse(u.lastAt)) u.lastAt = r.lastAt;
    for (const d of r.drivers ?? []) if (!u.drivers.includes(d)) u.drivers.push(d);
    for (const b of r.bridges ?? []) if (!u.bridges.includes(b)) u.bridges.push(b);
    if (r.km != null) {
      u.km = Math.round(((u.km ?? 0) + r.km) * 10) / 10;
      u.kmDays += 1;
      u.kmSource = u.kmSource == null || u.kmSource === r.kmSource ? r.kmSource : "mixed";
    }
  }
  return [...byPlate.values()]
    .sort((a, b) => b.trips - a.trips || (b.km ?? -1) - (a.km ?? -1) || a.unit.localeCompare(b.unit));
}

/**
 * Kilometres per trip, measured (operator, 18 Nov 2026: a true distance per trip): the average of
 * the trips whose two ends the odometer read, never the day's distance shared over its tickets.
 * None where no trip was measured: an untracked unit, a GPS-only tracker, a load not yet weighed.
 */
export const kmPerTrip = (r) => (r.tripN ? Math.round((r.tripKm / r.tripN) * 10) / 10 : null);

/** A trip longer than this is a unit parked or away, not a run to the field and back. */
export const TRIP_MAX_MS = 24 * 3_600_000;
/** A trip shorter than this is a re-weigh at the same bridge, not a run. */
export const TRIP_MIN_KM = 1;
/** Faster on average than this between the two readings is an odometer jump, not a run. */
export const TRIP_MAX_KMH = 120;

const at = (x) => (x ? Date.parse(x) : NaN);
const stamps = (...xs) => xs.map(at).filter(Number.isFinite);

/**
 * A ticket's weighings and the trip it closes, unix ms. Measured on 2,307 Sukari tickets
 * (10-17 Nov 2026): 95% of deliveries weigh tare first, the lorry empty on its way out, and the
 * same ticket closes with the gross when it comes back laden; a transfer tares at the factory,
 * passes the field centre and closes with the factory's gross (148 of 163). So the run to the
 * field and back is inside one ticket: `start` its empty weighing, `end` its laden one.
 *
 * `end` is the gross (a transfer's factory gross), null until the load has been weighed. `start`
 * is null where the laden weighing came first (the unit arrived laden, then tared): that trip
 * began when the unit left after its previous ticket, which tripLegs supplies. `first`/`last`
 * are the ticket's first and last weighing.
 */
export function ticketTrip(t) {
  const ts = stamps(t?.tareAt, t?.grossAt, t?.factoryGrossAt, t?.factoryTareAt);
  if (!ts.length) return null;
  const transfer = t?.category === "CANE_TRANSFER" || Number.isFinite(at(t?.factoryGrossAt)) || Number.isFinite(at(t?.factoryTareAt));
  const empty = transfer ? at(t?.factoryTareAt) : at(t?.tareAt);
  const laden = transfer ? at(t?.factoryGrossAt) : at(t?.grossAt);
  const end = Number.isFinite(laden) ? laden : null;
  const start = end != null && Number.isFinite(empty) && empty < end ? empty : null;
  return { first: Math.min(...ts), last: Math.max(...ts), start, end };
}

/**
 * Each tracked unit's trips (operator, 18 Nov 2026: "the odometer when the unit comes back to the
 * bridge, minus the odometer when it left"): from the ticket's empty weighing, the unit leaving,
 * to its laden one, the unit back, wherever midnight falls (ticketTrip). Where the laden weighing
 * came first, the trip runs from the unit's last weighing on its previous ticket, at any bridge,
 * so `tickets` must be every bridge's and reach back a day before the span. A trip belongs to the
 * ticket that closes it.
 *
 * @returns {{ ticketId, vehicleId, startMs: number, endMs: number }[]}
 */
export function tripLegs(tickets) {
  const byUnit = new Map();
  const seen = new Set();
  for (const t of tickets ?? []) {
    if (!t?.vehicleId || t.id == null || seen.has(t.id)) continue;
    const trip = ticketTrip(t);
    if (!trip) continue;
    seen.add(t.id);
    if (!byUnit.has(t.vehicleId)) byUnit.set(t.vehicleId, []);
    byUnit.get(t.vehicleId).push({ id: t.id, ...trip });
  }
  const legs = [];
  for (const [vehicleId, list] of byUnit) {
    list.sort((a, b) => a.first - b.first || a.last - b.last);
    list.forEach((cur, i) => {
      if (cur.end == null) return;
      let startMs = cur.start;
      if (startMs == null) {
        const prev = list[i - 1];
        // None before it, or weighed before the one ahead of it had left (overlapping stamps)
        if (!prev || cur.first <= prev.last) return;
        startMs = prev.last;
      }
      if (cur.end > startMs && cur.end - startMs <= TRIP_MAX_MS) legs.push({ ticketId: cur.id, vehicleId, startMs, endMs: cur.end });
    });
  }
  return legs;
}

/** The odometer key a reading is filed under: unit and moment. */
export const odoKey = (vehicleId, ms) => `${vehicleId}|${ms}`;

/**
 * Each measured trip's kilometres by the ticket it arrives for, from the readings at its two ends
 * (`readings` odoKey → metres, or null where none was read). A trip under TRIP_MIN_KM or faster
 * than TRIP_MAX_KMH on average is left out.
 */
export function tripKmByTicket(legs, readings) {
  const out = new Map();
  for (const l of legs ?? []) {
    const a = readings.get(odoKey(l.vehicleId, l.startMs));
    const b = readings.get(odoKey(l.vehicleId, l.endMs));
    if (a == null || b == null) continue;
    const km = (b - a) / 1000;
    const hours = (l.endMs - l.startMs) / 3_600_000;
    if (km < TRIP_MIN_KM || km / hours > TRIP_MAX_KMH) continue;
    out.set(l.ticketId, km);
  }
  return out;
}

/**
 * The table's order (operator, 18 Nov 2026: "records with distance on top but still in
 * ascending order by the date time"): rows with a distance first, then the rest, each
 * part by its first ticket, earliest first.
 */
export function distanceFirst(rows) {
  return [...rows].sort((a, b) => (a.km == null) - (b.km == null)
    || Date.parse(a.firstAt) - Date.parse(b.firstAt)
    || a.unit.localeCompare(b.unit));
}

/** The average net load a trip carried, kg. */
export const avgLoadKg = (r) => (r.trips ? r.netKg / r.trips : null);

/** The average load time (tare to gross) over the tickets that have one, ms. */
export const avgLoadMs = (r) => (r.loadN ? r.loadMs / r.loadN : null);

/** From the first ticket to the last, ms; none for a single trip. */
export const workSpanMs = (r) => (r.trips > 1 ? Date.parse(r.lastAt) - Date.parse(r.firstAt) : null);

/** The span's totals: trips, net, and the kilometres of the tracked unit-days. */
export function unitTripTotals(rows) {
  const tracked = rows.filter((r) => r.km != null);
  const trips = rows.reduce((n, r) => n + r.trips, 0);
  const netKg = rows.reduce((n, r) => n + r.netKg, 0);
  const km = Math.round(tracked.reduce((n, r) => n + r.km, 0) * 10) / 10;
  const tripKm = rows.reduce((n, r) => n + (r.tripKm ?? 0), 0);
  const tripN = rows.reduce((n, r) => n + (r.tripN ?? 0), 0);
  const loadMs = rows.reduce((n, r) => n + (r.loadMs ?? 0), 0);
  const loadN = rows.reduce((n, r) => n + (r.loadN ?? 0), 0);
  return {
    unitDays: rows.length,
    units: new Set(rows.map((r) => r.plate)).size,
    trips,
    netKg,
    tracked: tracked.length,
    odometer: tracked.filter((r) => r.kmSource === "odometer").length,
    km,
    avgLoadKg: trips ? netKg / trips : null,
    avgLoadMs: loadN ? loadMs / loadN : null,
    // The measured trips' average: a trip with no reading at either end has no distance
    kmPerTrip: kmPerTrip({ tripKm, tripN }),
    measuredTrips: tripN,
    tripsPerUnit: rows.length ? Math.round((trips / rows.length) * 10) / 10 : null,
  };
}

/**
 * One day's Fuel Consumption Rate response ({ rows: [{ vehicleId, distanceKm, distanceSource }] }) by
 * vehicle. A server from before the odometer sends no source: its figure is the GPS sum.
 */
export function kmOfDay(report) {
  const rows = Array.isArray(report) ? report : report?.rows ?? [];
  return new Map(rows.filter((r) => r?.vehicleId)
    .map((r) => [r.vehicleId, { km: Number(r.distanceKm ?? 0), source: r.distanceSource ?? "gps" }]));
}

/** One day's unit-distance response ({ rows: [{ vehicleId, distanceKm, source }] }) by vehicle. */
export function kmOfUnitDistance(rows) {
  return new Map((rows ?? []).filter((r) => r?.vehicleId)
    .map((r) => [r.vehicleId, { km: Number(r.distanceKm ?? 0), source: r.source ?? "gps" }]));
}

/** Each fleet day's tracked units, for asking the server their distances. */
export function trackedIdsByDay(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!r.vehicleId) continue;
    if (!out.has(r.day)) out.set(r.day, new Set());
    out.get(r.day).add(r.vehicleId);
  }
  return new Map([...out].map(([d, ids]) => [d, [...ids].sort()]));
}
