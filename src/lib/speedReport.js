// The Speed Report (operator, 4 Nov 2026; West Kenya's daily sheet): one row for
// each unit that went over its limit on a day. The server does the working
// (fleet-server reports/speed-report.service); this lays out the rows.
//
// Pure: no React, no network.

import { dayWords, yesterday } from './tatFuelReport';

export { dayWords, yesterday };

export const COLUMNS = [
  'Registration', 'Group', 'Mileage (km)', 'Max. Speed', 'Speed Limit', 'Speed Exceeded By',
  'Overspeeding Distance (km)', 'No of Overspeeding Occurrences',
];
/** The columns that hold a figure. */
export const FIGURES = new Set([2, 3, 4, 5, 6, 7]);
/** The Max. Speed column, which links to where it happened. */
export const PEAK_COLUMN = 3;

export function rowCells(r) {
  return [
    r.name, r.group, r.km.toFixed(2), `${Math.round(r.maxKmh)} km/h`, `${Math.round(r.limitKmh)} km/h`,
    `+${Math.round(r.overByKmh)} km/h`, r.overKm.toFixed(2), String(r.occurrences),
  ];
}

/** Where the unit was at its peak, on a map; empty when the fix was missing. */
export const peakUrl = (r) => (r.peak ? `https://www.google.com/maps?q=${r.peak.lat},${r.peak.lng}` : '');

const rank = (g) => (g === 'Trucks' ? 0 : 1);

/** Reports for several organisations as one, in the server's order: trucks first, then by name. */
export const mergeRows = (lists) => lists.flat().sort((a, b) => rank(a.group) - rank(b.group)
  || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

/** Only these units, or all of them for 'all'. */
export const rowsOfGroup = (rows, group) => (group === 'all' ? rows : rows.filter((r) => r.group === group));

/** Rows by heading, in the order they came. */
export function sections(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.group)) out.set(r.group, []);
    out.get(r.group).push(r);
  }
  return [...out].map(([group, list]) => ({ group, rows: list }));
}

export function summary(rows) {
  return {
    units: rows.length,
    occurrences: rows.reduce((n, r) => n + r.occurrences, 0),
    fastest: rows.reduce((m, r) => Math.max(m, r.maxKmh), 0),
    overKm: rows.reduce((n, r) => n + r.overKm, 0),
    km: rows.reduce((n, r) => n + r.km, 0),
  };
}

export const csvTable = (rows) => ({ head: COLUMNS, body: rows.map(rowCells) });

/** What the server draws the PDF from (fleet-server reports/template-report.pdf). */
export const speedPdfBody = (rows, { day, fleet, group = 'all' }) => ({ day, fleet, group, rows });
