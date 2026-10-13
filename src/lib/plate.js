/**
 * Kenyan registration plates in unit names (operator, 2026-10-13: "for the
 * vehicle names we can use regex to extract the actual plate number such as
 * KCS 969P, or KHMA 826T that is the format").
 *
 * K, two or three letters, three digits, a letter: "KCS 969P", "KHMA 826T".
 * Most units already carry exactly that as their plate. A few carry it inside
 * a longer provider name, "CPO - Menengai - KCC 386Z - FMB140" or "WKS -
 * Naitiri - SEM 9685(KHMA 324X)-18L/H", and those show the plate alone.
 * Machines with no plate ("MUFINDI: 012", "CAT 214B") keep their name.
 *
 * For DISPLAY only. The unit's id stays what it was: two trackers on one
 * truck (its own and a fuel unit or camera) carry the same plate, and would
 * otherwise become one unit.
 */

// Not inside a longer code either side; letters are matched as written, so
// "KCS 649Gl" reads "KCS 649G" and a lower-case word is never taken for one.
const PLATE = /(?<![A-Za-z0-9])(K[A-Z]{2,3}) ?(\d{3}) ?([A-Z])(?![A-Z0-9])/;

/** The first plate in any of `texts`, written "KCS 969P", or null. */
export function plateIn(...texts) {
  for (const t of texts) {
    const m = typeof t === "string" ? PLATE.exec(t) : null;
    if (m) return `${m[1]} ${m[2]}${m[3]}`;
  }
  return null;
}

/** What to print for a unit: its plate where it has one, else its id. */
export const displayPlate = (v) => v?.regPlate ?? v?.id ?? "";
