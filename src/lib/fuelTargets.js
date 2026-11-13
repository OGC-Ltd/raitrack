// A target km/L for a unit the server found none for (operator, 13 Nov 2026: "I thought this file has
// listed the types of vehicles and their models under the TYPE column"): the server holds a target by
// registration (FUEL_RATES_FOR_FLEET_2.xlsx, Sheet 1) or by the model the platform records, and most
// units have no model recorded. The fleet Excel's TYPE names it: HINO, HYUNDAI, TATA, FH, FN, FUSO,
// MANCLA, PICK UP. Matched here to the rate sheet's models (Sheet 2), loaded and empty; the loaded rate is
// the target, as the server takes it, so a unit is only below target when below even that.
//
// TANKER and FG name no make, and the light vehicles' and equipment's types are not on the rate sheet:
// those stay without a target until the fleet Excel gives their make.
//
// Pure: no React, no network.

import { fleetListEntry, fleetListMap } from './probeHealthReport';
import { groupsFor, unitKey } from './fleetGroups';

/** FUEL_RATES_FOR_FLEET_2.xlsx Sheet 2, as the server has it (fleet-server reports/fuel-target-rates). */
export const MODEL_RATES = {
  'PICKUP HILUX': { loaded: 8, empty: 10 },
  TATA: { loaded: 7.2, empty: 8 },
  HYUNDAI: { loaded: 7, empty: 7.5 },
  'HINO 500': { loaded: 5.5, empty: 6.5 },
  'MITSUBISHI FH': { loaded: 5.8, empty: 6.2 },
  'MITSUBISHI FN': { loaded: 3.2, empty: 3.8 },
  'MAN CLA': { loaded: 3, empty: 3.2 },
  'TATA 2518': { loaded: 3.5, empty: 4 },
  FUSO: { loaded: 6, empty: 6.5 },
  'MERC ACTROS 3340': { loaded: 1.8, empty: 2.1 },
  'MERC ACTROS 3350': { loaded: 1.6, empty: 1.9 },
  MAN: { loaded: 1.9, empty: 2.5 },
};

/** The fleet Excel's TYPE, as the rate sheet names the model. */
export const TYPE_MODELS = {
  HINO: 'HINO 500',
  'HINO 500': 'HINO 500',
  HYUNDAI: 'HYUNDAI',
  TATA: 'TATA',
  'TATA 2518': 'TATA 2518',
  FH: 'MITSUBISHI FH',
  FN: 'MITSUBISHI FN',
  FUSO: 'FUSO',
  MANCLA: 'MAN CLA',
  'MAN CLA': 'MAN CLA',
  MAN: 'MAN',
  'PICK UP': 'PICKUP HILUX',
  PICKUP: 'PICKUP HILUX',
  HILUX: 'PICKUP HILUX',
  'MERC ACTROS 3340': 'MERC ACTROS 3340',
  'MERC ACTROS 3350': 'MERC ACTROS 3350',
};

const norm = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/** The target for a TYPE, or null: { kmPerL, words, source: 'type', model }. */
export function targetForType(type) {
  const model = TYPE_MODELS[norm(type)];
  const r = model && MODEL_RATES[model];
  return r ? { kmPerL: r.loaded, words: `${r.loaded}-${r.empty}`, source: 'type', model } : null;
}

/**
 * The rows with a target from the fleet Excel's TYPE where the server gave none, and below target
 * judged against it. `entries`: the organisation's fleet list (lib/fleetListFile fleetEntriesFor);
 * none, and the rows are as the server gave them.
 */
export function withTypeTargets(rows, entries = null) {
  if (!entries) return rows ?? [];
  const list = fleetListMap(entries);
  return (rows ?? []).map((r) => {
    if (r.target) return r;
    const target = targetForType(fleetListEntry(r, list)?.type);
    if (!target) return r;
    return { ...r, target, belowTarget: r.kmPerL != null ? r.kmPerL < target.kmPerL : null };
  });
}

// ── By category (operator, 13 Nov 2026: "run the report by a specific category, Tankers, FG or all") ──

/** The organisation's categories (its fleet groups), or null where it has none. */
export const fuelGroupsFor = (orgCode) => groupsFor(orgCode);

/** The rows of one category: a unit is in it when its plate is on the group's list. Null: every row. */
export function rowsInGroup(rows, orgCode, name) {
  if (!name) return rows ?? [];
  const g = (groupsFor(orgCode) ?? []).find((x) => x.name === name);
  if (!g) return rows ?? [];
  const keys = new Set(g.units.map(([plate]) => unitKey(plate)));
  return (rows ?? []).filter((r) => keys.has(unitKey(r.plate)));
}

/** How many of the rows each category holds, for the picker. */
export function groupCounts(rows, orgCode) {
  return Object.fromEntries((groupsFor(orgCode) ?? []).map((g) => [g.name, rowsInGroup(rows, orgCode, g.name).length]));
}

/** The totals over these rows, as the server works them for the whole fleet: only units with a measured rate. */
export function totalsOf(rows) {
  const measured = (rows ?? []).filter((r) => r.consumedL != null && r.consumedL > 0 && r.distanceKm >= 1);
  const distanceKm = Math.round(measured.reduce((n, r) => n + r.distanceKm, 0) * 10) / 10;
  const consumedL = Math.round(measured.reduce((n, r) => n + r.consumedL, 0) * 10) / 10;
  return { units: (rows ?? []).length, measured: measured.length, distanceKm, consumedL, kmPerL: consumedL > 0 ? Math.round((distanceKm / consumedL) * 100) / 100 : null };
}
