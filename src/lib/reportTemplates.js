// Report templates (operator, 3 Nov 2026): a report is built once and given
// to organisations here, each with its own settings, rather than written for
// one company. Giving a report to another organisation is one more line in
// `orgs`; nothing in the report itself changes.
//
//   orgs      the organisations that have the report, by code, and what is
//             theirs in it (a group, a place, a title). {} when nothing is.
//   families  organisations that are one customer on the platform but
//             separate organisations in it (West Kenya: West Sugar, Kabras
//             and Nzoia). An operator who can see more than one of them may
//             make the report for them together.
//
// Pure: no React, no network.

export const TEMPLATES = {
  // Menengai's tankers on the road from the Mombasa depot to MORL (TankersReport)
  tankers: {
    orgs: { MENENGAI: { group: 'Tankers' } },
  },
  // Every visit to a geofence over a period (GeofenceReport). West Kenya's
  // first (operator, 3 Nov 2026); any organisation with geofences can have it.
  geofences: {
    orgs: { WESTSUGAR: {}, KABRAS: {}, NZOIA: {} },
    families: [{ name: 'West Kenya', orgs: ['WESTSUGAR', 'KABRAS', 'NZOIA'] }],
  },
  // Each trip signed back in on a day, with its fuel and distance
  // (TatFuelReport): West Kenya's daily sheet, Sukari too (operator, 4 Nov 2026).
  tatFuel: {
    orgs: { SUKARI: {}, WESTSUGAR: {}, KABRAS: {}, NZOIA: {} },
    families: [{ name: 'West Kenya', orgs: ['WESTSUGAR', 'KABRAS', 'NZOIA'] }],
  },
  // The vehicles whose trackers have stopped sending (OfflineReport): West
  // Kenya's sheet, and Menengai's too (operator, 3 Nov 2026).
  offline: {
    orgs: { WESTSUGAR: {}, KABRAS: {}, NZOIA: {}, MENENGAI: {} },
    families: [{ name: 'West Kenya', orgs: ['WESTSUGAR', 'KABRAS', 'NZOIA'] }],
  },
};

const up = (code) => String(code ?? '').trim().toUpperCase();

/** Is `key` a templated report? (The rest of the reports are for every organisation.) */
export const isTemplated = (key) => Object.hasOwn(TEMPLATES, key);

/** The organisation's settings for a report, or null when it does not have it. */
export function templateFor(key, orgCode) {
  const t = TEMPLATES[key];
  if (!t) return null;
  return t.orgs[up(orgCode)] ?? null;
}

/** The family the organisation belongs to for a report, or null. */
export function familyOf(key, orgCode) {
  const code = up(orgCode);
  return TEMPLATES[key]?.families?.find((f) => f.orgs.includes(code)) ?? null;
}
