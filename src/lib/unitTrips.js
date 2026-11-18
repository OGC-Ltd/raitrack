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

import { fleetDayKey } from "../hooks/useFuelEvents";

/**
 * One row per unit per fleet day, the latest day first, then the most trips.
 *
 * @param {object[]} tickets weighment rows ({ tokenAt, vehiclePlate, vehicleNo, vehicleId, driverName, netWeightKg })
 * @param {Map<string, Map<string, {km: number, source: string|null}>>} kmByDay fleet day → vehicleId → the day's distance, for the days read
 * @returns {{ day, plate, unit, vehicleId, drivers: string[], bridges: string[], trips, netKg, firstAt, lastAt,
 *   loadMs, loadN, km: number|null, kmSource: string|null, noFixes: boolean }[]}
 *   `bridges` the weighbridges its tickets were raised at, `firstAt`/`lastAt` its first and last ticket's
 *   time (ISO), `loadMs`/`loadN` the summed load time (tare to gross) over the tickets that have one.
 *   `km` is null when the unit carries no tracker or its day was not read.
 */
export function unitTripRows(tickets, kmByDay = new Map()) {
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
        firstAt: t.tokenAt, lastAt: t.tokenAt, loadMs: 0, loadN: 0 };
      byKey.set(key, row);
    }
    row.trips += 1;
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
        km: null, kmTrips: 0, kmDays: 0, kmSource: null, noFixes: false };
      byPlate.set(r.plate, u);
    }
    u.days.push(r.day);
    u.perDay.push(r);
    u.trips += r.trips;
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
      u.kmTrips += r.trips;
      u.kmDays += 1;
      u.kmSource = u.kmSource == null || u.kmSource === r.kmSource ? r.kmSource : "mixed";
    }
  }
  return [...byPlate.values()]
    .sort((a, b) => b.trips - a.trips || (b.km ?? -1) - (a.km ?? -1) || a.unit.localeCompare(b.unit));
}

/** Kilometres per trip, where the unit is tracked and moved: over the trips of the days that have a distance. */
export const kmPerTrip = (r) => {
  const trips = r.kmTrips ?? r.trips;
  return r.km == null || !trips ? null : Math.round((r.km / trips) * 10) / 10;
};

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
  const trackedTrips = tracked.reduce((n, r) => n + (r.kmTrips ?? r.trips), 0);
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
    // Over the tracked units' trips only: an untracked unit's trips have no distance to share
    kmPerTrip: trackedTrips ? Math.round((km / trackedTrips) * 10) / 10 : null,
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
