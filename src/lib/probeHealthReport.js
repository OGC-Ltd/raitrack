// Probe & Sensor Health report (operator, 7 Nov 2026): the Probes tab's
// download, on the report template (lib/reportDocs). It carries what the old
// jsPDF export did, the filtered table's units with their probe and sensor
// state, without the Action column: the report says what is wrong, not what to
// do about it.
//
// Pure: no React, no network.

import { PROBE_STATE_LABEL } from '../api/probeHealth';

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
