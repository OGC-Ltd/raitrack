// Probe & Sensor Health report (operator, 7 Nov 2026): the Probes tab's
// download, on the report template (lib/reportDocs). One line a unit, one
// column a part (GPS tracker, ignition, odometer, fuel probe), each Working or
// Not working, Not working highlighted because it is faulty hardware. No
// course of action: the report says what is wrong, not what to do about it.
//
// Pure: no React, no network.

import { unitKey, vehicleKeys } from './fleetGroups';

export const WORKING = 'Working';
export const NOT_WORKING = 'Not working';
export const NOT_FITTED = 'Not fitted';
export const NO_DATA = 'No data';
export const NOT_SET_UP = 'Not set up';

/** Ignition and odometer, as the Probes tab judges them. A silent tracker
 *  sends nothing, so its channels cannot be judged. */
function channel(r, id) {
  if (r.trackerSilent) return NO_DATA;
  const st = r.channels?.[id]?.state;
  if (st === 'NOT_REPORTING') return NOT_WORKING;
  if (st === 'REPORTING') return WORKING;
  if (st === 'NOT_FITTED') return NOT_FITTED;
  return NO_DATA;
}

/** The tracker itself: silent, or its GPS stopped. */
function tracker(r) {
  if (r.trackerSilent) return NOT_WORKING;
  return channel(r, 'gps');
}

/** The fuel probe. A sensor with no calibration table is a Wialon record to
 *  finish, not a fault in the hardware, so it is Not set up. */
function fuelProbe(r) {
  if (r.trackerSilent) return NO_DATA;
  const st = r.fuelProbe?.state;
  if (st === 'DIED' || st === 'SILENT') return NOT_WORKING;
  if (st === 'OK') return WORKING;
  if (r.fuelSensor?.uncalibrated) return NOT_SET_UP;
  if (st === 'NOT_FITTED') return NOT_FITTED;
  return NO_DATA;
}

export const PARTS = [
  { label: 'GPS tracker', read: tracker },
  { label: 'Ignition', read: (r) => channel(r, 'ignition') },
  { label: 'Odometer', read: (r) => channel(r, 'odometer') },
  { label: 'Fuel probe', read: fuelProbe },
];

export const HEADS = ['Plate', 'Unit', ...PARTS.map((p) => p.label)];

export const rowCells = (r) => [r.plate || r.name || '', r.deviceId ?? '', ...PARTS.map((p) => p.read(r))];

/** What the words mean, under the table. */
export const KEY = 'Not working: the part has stopped and needs a technician. No data: the tracker is silent, so the part cannot be judged. '
  + 'Not set up: the fuel sensor has no calibration table in Wialon. Not fitted: the unit has no such part.';

/** The overview figures, for the rows in the report (not the fleet). */
export function summary(rows) {
  const down = (p) => rows.filter((r) => p.read(r) === NOT_WORKING).length;
  return [
    { label: 'Units in report', value: rows.length },
    ...PARTS.map((p) => ({ label: `${p.label} not working`, value: down(p), flag: down(p) > 0 })),
    { label: 'All working', value: rows.filter((r) => PARTS.every((p) => p.read(r) !== NOT_WORKING)).length },
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
