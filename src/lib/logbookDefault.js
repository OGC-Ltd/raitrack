/**
 * The vehicle the Logbook opens on in each organisation (operator, 2026-10-08):
 * the first of PREFERRED the organisation has, else the first of FALLBACK it
 * has (one per factory: Nzoia, Sukari, Kabras, Menengai), else none.
 *
 * Matched on the plate with spaces and case ignored, against the unit's
 * plate, its id and its name ("NZOIA - KDX 568Z" carries the plate in it).
 */

export const PREFERRED = [
  "KDP 365T", "KDZ 448M", "KDW 648X", "KDX 379J", "KDU 472H",
  "KDW 634X", "KDW 646X", "KDW 662X", "KDU 155C", "KDW 023H",
];
export const FALLBACK = [
  "KDX 568Z", // Nzoia
  "KBM 256W", // Sukari
  "KBJ 159G", // Kabras
  "KCG 233A", // Menengai
];

const squash = (s) => String(s ?? "").replace(/[\s-]+/g, "").toUpperCase();

/** Does unit `v` carry plate `plate`? */
export function hasPlate(v, plate) {
  const p = squash(plate);
  return [v?.plate, v?.id, v?.name].some((f) => squash(f) === p || squash(f).includes(p));
}

/** The unit to open on among `vehicles`, or null. */
export function defaultLogbookUnit(vehicles = []) {
  for (const plate of [...PREFERRED, ...FALLBACK]) {
    const v = vehicles.find((u) => hasPlate(u, plate));
    if (v) return v;
  }
  return null;
}
