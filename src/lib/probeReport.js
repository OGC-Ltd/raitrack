// The Probe Disconnection Report (operator, 5 Nov 2026; West Kenya's Wialon
// sheet): each time a unit's fuel probe was disconnected. The server reads the
// alerts and joins them into disconnections (fleet-server reports/
// probe-disconnection.service); this lays out the rows.
//
// Pure: no React, no network.

export { dayWords, periodWords, yesterday } from './tatFuelReport';

export const MAX_DAYS = 31;
const OFFSET = 3 * 3600_000;
const DASH = '-';

/** "30/10/2026 06:09:12", in Nairobi. */
export const stamp = (ms) => {
  const s = new Date(ms + OFFSET).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 19)}`;
};

export const UNIT_HEADS = ['Registration', 'Disconnections', 'Alerts', 'First alert', 'Last alert'];
/** The figures in the units' table. */
export const UNIT_FIGURES = new Set([1, 2]);
export const RUN_HEADS = ['Registration', 'From', 'To', 'Alerts', 'Speed', 'Location'];
export const RUN_FIGURES = new Set([3, 4]);
/** The Location column, which links to where it happened. */
export const PLACE_COLUMN = 5;

export const mapUrl = (r) => (r.lat != null && r.lng != null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : '');

export function runCells(r) {
  return [
    r.name, stamp(r.at), stamp(r.to), String(r.alerts),
    Number.isFinite(r.speedKmh) ? `${Math.round(r.speedKmh)} km/h` : DASH,
    r.place ?? (r.lat != null && r.lng != null ? `${r.lat}, ${r.lng}` : DASH),
  ];
}

/** Each unit's totals, most disconnections first. */
export function byUnit(rows) {
  const units = new Map();
  for (const r of rows) {
    const u = units.get(r.vehicleId) ?? { vehicleId: r.vehicleId, name: r.name, runs: 0, alerts: 0, first: r.at, last: r.to };
    u.runs += 1;
    u.alerts += r.alerts;
    u.first = Math.min(u.first, r.at);
    u.last = Math.max(u.last, r.to);
    units.set(r.vehicleId, u);
  }
  return [...units.values()].sort((a, b) => b.runs - a.runs || b.alerts - a.alerts || a.name.localeCompare(b.name));
}

export const unitCells = (u) => [u.name, String(u.runs), String(u.alerts), stamp(u.first), stamp(u.last)];

export const summary = (rows) => ({
  units: new Set(rows.map((r) => r.vehicleId)).size,
  runs: rows.length,
  alerts: rows.reduce((n, r) => n + r.alerts, 0),
});

/** Reports for several organisations as one, by unit and then by time. */
export const mergeRows = (lists) => lists.flat().sort((a, b) => a.name.localeCompare(b.name) || a.at - b.at);
