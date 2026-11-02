// Which units a report covers, and under which group.
//
// An organisation with a client-supplied list (data/fleetGroups: Menengai)
// is reported by that list only: its groups, in its order, and none of the
// organisation's other units. Every other organisation is reported as one
// group of all its units.
//
// One truck can carry two trackers (its own and a camera or fuel unit), and
// both show up as units with the same plate ("CPO - KCN 901F" and "CPO - KCN
// 901F-CAMERA"). A report row is the TRUCK: its trackers are kept together
// here and the report takes the one with the most to say (lib/fleetReports).
//
// Pure: no React, no network.

import { FLEET_GROUPS } from '../data/fleetGroups';
import { plateIn } from './plate';

/** "kcs 082m" → "KCS082M". */
export const keyOf = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A list entry's key: its plate, or the whole label for a machine with none ("FL 01"). */
export function unitKey(label) {
  return keyOf(plateIn(String(label ?? '').toUpperCase()) ?? label);
}

/** Every key a platform unit may be listed under. */
export function vehicleKeys(v) {
  const keys = new Set();
  const plate = plateIn(v?.regPlate, v?.id, v?.name);
  if (plate) keys.add(keyOf(plate));
  for (const label of [v?.id, v?.name]) {
    const k = keyOf(label);
    if (k.length >= 3) keys.add(k);
    // "RAIMDF - FL 01" / "MUFINDI: EX 11" → the part after the last separator.
    const tail = /(?:\s-\s|:|-)\s*([^:-]+)$/.exec(String(label ?? ''));
    if (tail) { const t = keyOf(tail[1]); if (t.length >= 3) keys.add(t); }
    const short = machineKey(label);
    if (short) keys.add(short);
  }
  return keys;
}

/**
 * A machine the platform names in full, under the short name the client's
 * list uses: "WLOADER 01" → WL 01, "FORKLIFT 04" → FL 04, "EXCAVATOR001" →
 * EX 01, "JCB 1 H00052413" → JCB 01 (Menengai's MORL FLEET sheet, 2 Nov).
 */
const MACHINE_SHORT = [
  [/\b(?:W(?:HEEL)?\s*LOADER)\s*0*(\d{1,2})\b/i, 'WL'],
  [/\bFORK\s*LIFT\s*0*(\d{1,2})\b/i, 'FL'],
  [/\bEXCAVATOR\s*0*(\d{1,2})\b/i, 'EX'],
  [/\bJCB\s*0*(\d{1,2})\b/i, 'JCB'],
];
export function machineKey(label) {
  const s = String(label ?? '');
  for (const [re, short] of MACHINE_SHORT) {
    const m = re.exec(s);
    if (m) return keyOf(`${short} ${m[1].padStart(2, '0')}`);
  }
  return null;
}

/** The unit's display plate: the registration where it has one. */
export function displayOf(v) {
  return plateIn(v?.regPlate, v?.id, v?.name) ?? v?.id ?? '';
}

/** The organisation's groups, or null when it has no list. */
export function groupsFor(orgCode) {
  const g = FLEET_GROUPS[String(orgCode ?? '').toUpperCase()];
  return Array.isArray(g) && g.length ? g : null;
}

/**
 * The units a report covers.
 *
 * @param {object[]} vehicles  the organisation's live units (FleetLiveContext)
 * @param {object[]|null} groups  groupsFor(); null = every unit, one group
 * @param {string|null} only    one group's name, or null for all
 * @returns {{ units: Array<{key, plate, type, group, vehicles}>, missing: Array<{plate, group}> }}
 *   `missing`: listed units with no tracker on the platform, said on the page
 *   so an empty row is never mistaken for a unit that did nothing.
 */
export function scopeUnits(vehicles, groups, only = null) {
  const list = vehicles ?? [];
  if (!groups) {
    const byKey = new Map();
    for (const v of list) {
      const plate = displayOf(v);
      const key = keyOf(plate) || keyOf(v.vehicleId);
      if (!byKey.has(key)) byKey.set(key, { key, plate, type: v.vehicleType ?? '', group: null, vehicles: [] });
      byKey.get(key).vehicles.push(v);
    }
    return { units: [...byKey.values()], missing: [] };
  }

  const index = new Map();
  for (const v of list) {
    for (const k of vehicleKeys(v)) {
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(v);
    }
  }
  const units = [];
  const missing = [];
  for (const g of groups) {
    if (only && g.name !== only) continue;
    for (const [plate, type, cam] of g.units) {
      const key = unitKey(plate);
      const found = [...new Set(index.get(key) ?? [])];
      // dashcam: true / false from the client's list; undefined where it does not say.
      const dashcam = cam === 1 ? true : cam === 0 ? false : undefined;
      if (found.length) units.push({ key, plate, type, group: g.name, vehicles: found, dashcam });
      else missing.push({ plate, group: g.name });
    }
  }
  return { units, missing };
}
