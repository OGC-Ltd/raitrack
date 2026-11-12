// Sites of an organisation told apart by a list of their units (operator, 12 Nov
// 2026: Naitiri's units are under West Kenya; reports for Naitiri's units or its
// trucks alone). Not a filter on the Fleets block: the operator does not want a
// Naitiri pill there (12 Nov 2026). Beside the name rule the
// report templates already had for a site (/nait[ir]/i), not instead of it.
//
// A unit is on a list when one of its plates is: the platform's name for a
// unit carries its plate somewhere ("WKS - Naitiri - KCY 523U", "KTCC573E"), so
// the name is searched for every listed plate, spaces and dashes aside.
//
// Pure: no React, no network.

import { NAITIRI_UNITS, NAITIRI_TRUCKS } from '../data/naitiriUnits';

/** "KCY 523U" → "KCY523U". */
const keyOf = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * A test of a unit's name: on the list, or matching `name` (a RegExp) where one is given.
 * Plates are looked up at each "K" of the name (6 to 8 characters); a listed
 * serial, which has no K plate, is looked for anywhere in it.
 * No boundary after the plate, on purpose: a trailer or a stray letter after it
 * ("KCY523U ZG 7017", "KCS 649Gl") still matches. The price: a 6-character plate
 * ("KVA 250") also matches a longer one that starts with it ("KVA 2501").
 */
export function listTest(plates, name = null) {
  const keys = new Set(plates.map(keyOf).filter((k) => k.length >= 5));
  const serials = [...keys].filter((k) => !/^K[A-Z]{2,3}\d{3}[A-Z]?$/.test(k));
  const onList = (label) => {
    const k = keyOf(label);
    for (let i = k.indexOf('K'); i >= 0; i = k.indexOf('K', i + 1)) {
      for (let n = 6; n <= 8; n++) if (keys.has(k.slice(i, i + n))) return true;
    }
    return serials.some((s) => k.includes(s));
  };
  return { test: (label) => Boolean(name?.test(String(label ?? ''))) || onList(label) };
}

/** Every Naitiri plate: all the units' tabs, and the trucks list. */
export const NAITIRI_ALL = [...new Set([...Object.values(NAITIRI_UNITS).flat(), ...NAITIRI_TRUCKS])];

/**
 * Naitiri's trucks: the trucks list, and the assets file's Truck tab, which has three more
 * (KBV 405X, KCJ 987A, KCJ 049H). One rule, so a unit grouped as a truck under "Naitiri all
 * units Ex" is in "Naitiri trucks Ex" too (review, 12 Nov 2026).
 */
export const NAITIRI_TRUCKS_ALL = [...new Set([...NAITIRI_TRUCKS, ...NAITIRI_UNITS.Truck])];

/**
 * The sites, by key. `fleet`: what a report made for the site alone calls its fleet (operator,
 * 12 Nov 2026: "the reports should have a title of Naitiri and not West Kenya").
 *   NAITIRI            by the unit's name, as production has always read it (/nait[ir]/i)
 *   NAITIRI_EX         every unit on the client's two lists, and only those ("Naitiri all units Ex")
 *   NAITIRI_TRUCKS_EX  the trucks, NAITIRI_TRUCKS_ALL ("Naitiri trucks Ex")
 */
const NAITIRI_NAME = /nait[ir]/i;
export const SITE_LISTS = {
  NAITIRI: { label: 'Naitiri', fleet: 'Naitiri', test: { test: (label) => NAITIRI_NAME.test(String(label ?? '')) } },
  NAITIRI_EX: { label: 'Naitiri all units Ex', fleet: 'Naitiri', test: listTest(NAITIRI_ALL), kinds: true },
  NAITIRI_TRUCKS_EX: { label: 'Naitiri trucks Ex', fleet: 'Naitiri', test: listTest(NAITIRI_TRUCKS_ALL), kinds: true },
};

/**
 * Each unit's kind as the client's lists have it (operator, 12 Nov 2026: "a column that shows the type of
 * vehicle"), as a report's heading. The trucks first (the same list as "Naitiri trucks Ex"), then the
 * other tabs in the file's order.
 */
const KIND_HEADING = { Tractor: 'Tractors', Motorbike: 'Motorbikes', 'Light vehicle': 'Light vehicles', 'Winch / Bell / shovel': 'Winches, Bell and shovels' };
const KIND_TESTS = [
  ['Trucks', listTest(NAITIRI_TRUCKS_ALL)],
  ...Object.entries(NAITIRI_UNITS).filter(([k]) => k !== 'Truck').map(([k, plates]) => [KIND_HEADING[k] ?? k, listTest(plates)]),
];

/**
 * The unit's kind on the client's lists, else null. Only for a unit one of the Ex sites picked holds:
 * with Sukari ticked too, a Sukari unit keeps its own group even when its plate is on a Naitiri list.
 */
export function siteKind(keys, label) {
  const lists = (keys ?? []).map((k) => SITE_LISTS[k]).filter((s) => s?.kinds);
  if (!lists.some((s) => s.test.test(label))) return null;
  return KIND_TESTS.find(([, t]) => t.test(label))?.[0] ?? null;
}

/** The organisations whose reports offer these sites in a Site picker (hooks/useSitePick). */
export const REPORT_SITES = { WESTSUGAR: ['NAITIRI_EX', 'NAITIRI_TRUCKS_EX'] };

/** What a report for these sites calls its fleet: their own name when they share one, else null. */
export function siteFleet(keys) {
  const names = [...new Set((keys ?? []).map((k) => SITE_LISTS[k]?.fleet).filter(Boolean))];
  return names.length === 1 && (keys ?? []).every((k) => SITE_LISTS[k]) ? names[0] : null;
}

/** Is this live unit on the site's list? By its plate, its id and its name. */
export function vehicleOnSite(v, siteKey) {
  const t = SITE_LISTS[siteKey]?.test;
  if (!t) return false;
  return [v?.regPlate, v?.name, v?.id].some((label) => label && t.test(label));
}
