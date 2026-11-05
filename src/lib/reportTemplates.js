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

/**
 * West Kenya's report lists these, and only West Kenya's does (operator, 4 Nov
 * 2026): from Sukari or Kabras the report is about Sukari or Kabras alone.
 * Olepito and Naitiri are not organisations: they are sites of West Kenya Sugar,
 * told apart by the unit's name, misspellings included.
 */
const WEST_KENYA = {
  name: 'West Kenya',
  home: 'WESTSUGAR',
  members: [
    { key: 'SUKARI', label: 'Sukari', org: 'SUKARI' },
    { key: 'KABRAS', label: 'Kabras', org: 'KABRAS' },
    { key: 'NZOIA', label: 'Nzoia', org: 'NZOIA' },
    { key: 'OLEPITO', label: 'Olepito', unit: /ole?i?p(?:i?t|ti)/i },
    { key: 'NAITIRI', label: 'Naitiri', unit: /nait[ir]/i },
  ],
};

/**
 * The sheet also lists West Sugar's other sites beside them (operator, 4 Nov
 * 2026: they were under its Units list, which now says the kind of vehicle).
 */
const WEST_KENYA_SITES = {
  ...WEST_KENYA,
  members: [
    ...WEST_KENYA.members,
    { key: 'AMUKA', label: 'Amuka', unit: /amuka/i },
    { key: 'KHALABA', label: 'Khalaba', unit: /khalaba/i },
    { key: 'LAKE_AGRO', label: 'Lake Agro', unit: /lake/i },
    { key: 'MAGUT', label: 'Magut', unit: /magut/i },
    { key: 'MISIKHU', label: 'Misikhu', unit: /misikhu/i },
    { key: 'NAIROBI', label: 'Nairobi', unit: /nairobi/i },
    { key: 'SELIA', label: 'Selia', unit: /seli/i },
  ],
};

export const TEMPLATES = {
  // Menengai's Finished Goods and Van Sales deliveries, the vehicles shared on
  // a day and their customers (DeliveriesReport; operator, 4 Nov 2026)
  deliveries: {
    orgs: { MENENGAI: {} },
  },
  // Menengai's tankers on the road from the Mombasa depot to MORL (TankersReport)
  tankers: {
    orgs: { MENENGAI: { group: 'Tankers' } },
  },
  // Every visit to a geofence over a period (GeofenceReport). West Kenya's
  // first (operator, 3 Nov 2026); any organisation with geofences can have it.
  geofences: {
    orgs: { SUKARI: {}, WESTSUGAR: {}, KABRAS: {}, NZOIA: {} },
    families: [WEST_KENYA],
  },
  // Each trip signed back in on a day, with its fuel and distance
  // (TatFuelReport): West Kenya's daily sheet, Sukari too (operator, 4 Nov 2026).
  tatFuel: {
    orgs: { SUKARI: {}, WESTSUGAR: {}, KABRAS: {}, NZOIA: {} },
    families: [WEST_KENYA_SITES],
  },
  // Each unit over its limit on a day (SpeedReport): West Kenya's daily sheet,
  // Sukari, Kabras and Nzoia too (operator, 4 Nov 2026).
  speedReport: {
    orgs: { SUKARI: {}, WESTSUGAR: {}, KABRAS: {}, NZOIA: {} },
    families: [WEST_KENYA],
  },
  // Each time a unit's fuel probe was disconnected (ProbeReport): West Kenya's
  // Wialon sheet, Sukari and Kabras too (operator, 5 Nov 2026). The family lists
  // Nzoia and Naitiri, whose trucks are on that sheet.
  probeReport: {
    orgs: { SUKARI: {}, WESTSUGAR: {}, KABRAS: {} },
    families: [WEST_KENYA],
  },
  // The vehicles whose trackers have stopped sending (OfflineReport): West
  // Kenya's sheet, and Menengai's too (operator, 3 Nov 2026).
  offline: {
    orgs: { SUKARI: {}, WESTSUGAR: {}, KABRAS: {}, NZOIA: {}, MENENGAI: {} },
    families: [WEST_KENYA],
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

/** The family this organisation's report lists, or null: only its home organisation lists one. */
export function familyOf(key, orgCode) {
  const code = up(orgCode);
  return TEMPLATES[key]?.families?.find((f) => f.home === code) ?? null;
}

/** The family's members this user can see; a site goes with its home organisation. */
export const familyMembers = (family, canSee) => family.members.filter((m) => !m.org || canSee(m.org));

/**
 * What to read for what is ticked (null: all of them): each organisation, with
 * `unit` a test of a unit's name where only some of it is wanted. All of them
 * read the home organisation whole, its other sites too.
 */
export function familyRuns(family, ticked, canSee) {
  const members = familyMembers(family, canSee);
  const on = ticked == null ? members : members.filter((m) => ticked.includes(m.key));
  const sites = on.filter((m) => m.unit);
  const home = ticked == null ? [{ code: family.home, unit: null }]
    : sites.length ? [{ code: family.home, unit: new RegExp(sites.map((m) => m.unit.source).join('|'), 'i') }] : [];
  return [...home, ...on.filter((m) => m.org).map((m) => ({ code: m.org, unit: null }))];
}
