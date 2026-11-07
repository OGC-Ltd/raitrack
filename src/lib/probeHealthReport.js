// Probe & Sensor Health report (operator, 7 Nov 2026): the Probes tab's
// download, on the report template (lib/reportDocs). It carries what the old
// jsPDF export did, the filtered table's units with their probe and sensor
// state, without the Action column: the report says what is wrong, not what to
// do about it.
//
// Pure: no React, no network.

import { PROBE_STATE_LABEL } from '../api/probeHealth';
import { unitKey, vehicleKeys } from './fleetGroups';

const OFFSET = 3 * 3600_000;

/** EAT, as the rest of the report. */
const stamp = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = new Date(t + OFFSET).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
};

const sensorWord = (s) => (!s?.fitted ? 'Not configured' : s.uncalibrated ? 'Uncalibrated' : 'Calibrated');

export const HEADS = ['Plate', 'Unit', 'Fuel probe', 'Probe last worked', 'Last reading (L)', 'Fuel sensor'];

export const rowCells = (r) => [
  r.plate || r.name || '',
  r.deviceId ?? '',
  PROBE_STATE_LABEL[r.fuelProbe?.state] ?? r.fuelProbe?.state ?? '',
  stamp(r.fuelProbe?.lastAliveAt),
  r.fuelProbe?.lastValueMl == null ? '' : (r.fuelProbe.lastValueMl / 1000).toFixed(1),
  sensorWord(r.fuelSensor),
];

/** The overview figures, for the rows in the report (not the fleet). */
export function summary(rows) {
  const count = (f) => rows.filter(f).length;
  return [
    { label: 'Units in report', value: rows.length },
    { label: 'Tracker silent', value: count((r) => r.trackerSilent) },
    { label: 'Stopped reading', value: count((r) => r.fuelProbe?.state === 'DIED') },
    { label: 'Reads empty', value: count((r) => r.fuelProbe?.state === 'SILENT') },
    { label: 'Uncalibrated', value: count((r) => r.fuelSensor?.uncalibrated) },
    { label: 'Working', value: count((r) => r.fuelProbe?.state === 'OK' && !r.trackerSilent) },
  ];
}

export const NOT_ON_LIST = 'Not on the list';

const byPlate = (a, b) => String(a.plate ?? '').localeCompare(String(b.plate ?? ''), 'en', { numeric: true });

/**
 * The rows under the client's fleet-list groups (data/fleetGroups: Tankers,
 * Finished Goods, ...), in the list's order, matched as the Movement report's
 * Group picker matches them. Units the list does not name come last, under
 * "Not on the list"; empty groups are left out. Null when the fleet has no list.
 */
export function byGroup(rows, groups) {
  if (!groups?.length) return null;
  const groupOf = new Map();
  for (const g of groups) for (const [label] of g.units) if (!groupOf.has(unitKey(label))) groupOf.set(unitKey(label), g.name);
  const buckets = new Map([...groups.map((g) => [g.name, []]), [NOT_ON_LIST, []]]);
  for (const r of rows) {
    let name = NOT_ON_LIST;
    for (const k of vehicleKeys({ regPlate: r.plate, id: r.vehicleId, name: r.name })) {
      if (groupOf.has(k)) { name = groupOf.get(k); break; }
    }
    buckets.get(name).push(r);
  }
  return [...buckets.entries()].filter(([, list]) => list.length).map(([name, list]) => ({ name, rows: [...list].sort(byPlate) }));
}
