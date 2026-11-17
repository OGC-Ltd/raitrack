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
 * @returns {{ day, plate, unit, vehicleId, drivers: string[], trips, netKg, km: number|null, kmSource: string|null, noFixes: boolean }[]}
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
      row = { day, plate, unit: t.vehicleNo || plate, vehicleId: null, drivers: [], trips: 0, netKg: 0 };
      byKey.set(key, row);
    }
    row.trips += 1;
    row.netKg += t.netWeightKg ?? 0;
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

/** Kilometres per trip, where the unit is tracked and moved. */
export const kmPerTrip = (r) => (r.km == null || !r.trips ? null : Math.round((r.km / r.trips) * 10) / 10);

/** The span's totals: trips, net, and the kilometres of the tracked unit-days. */
export function unitTripTotals(rows) {
  const tracked = rows.filter((r) => r.km != null);
  return {
    unitDays: rows.length,
    units: new Set(rows.map((r) => r.plate)).size,
    trips: rows.reduce((n, r) => n + r.trips, 0),
    netKg: rows.reduce((n, r) => n + r.netKg, 0),
    tracked: tracked.length,
    odometer: tracked.filter((r) => r.kmSource === "odometer").length,
    km: Math.round(tracked.reduce((n, r) => n + r.km, 0) * 10) / 10,
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
