// Sites of an organisation told apart by a list of their units (operator, 12 Nov
// 2026: Naitiri's units are under West Kenya; a Naitiri pill on the Fleets block,
// and reports for Naitiri's units or its trucks alone). Beside the name rule the
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
export const NAITIRI_ALL = [...Object.values(NAITIRI_UNITS).flat(), ...NAITIRI_TRUCKS];

/**
 * The sites, by key. `fleet`: what a report made for the site alone calls its fleet (operator,
 * 12 Nov 2026: "the reports should have a title of Naitiri and not West Kenya").
 *   NAITIRI            by the unit's name, as production has always read it (/nait[ir]/i)
 *   NAITIRI_EX         every unit on the client's two lists, and only those ("Naitiri all units Ex")
 *   NAITIRI_TRUCKS_EX  the trucks list alone ("Naitiri trucks Ex")
 */
const NAITIRI_NAME = /nait[ir]/i;
export const SITE_LISTS = {
  NAITIRI: { label: 'Naitiri', fleet: 'Naitiri', test: { test: (label) => NAITIRI_NAME.test(String(label ?? '')) } },
  NAITIRI_EX: { label: 'Naitiri all units Ex', fleet: 'Naitiri', test: listTest(NAITIRI_ALL), kinds: true },
  NAITIRI_TRUCKS_EX: { label: 'Naitiri trucks Ex', fleet: 'Naitiri', test: listTest(NAITIRI_TRUCKS), kinds: true },
};

/**
 * Each unit's kind as the client's lists have it (operator, 12 Nov 2026: "a column that shows the type of
 * vehicle"), as a report's heading. The trucks list first, then the units' tabs in the file's order.
 */
const KIND_HEADING = { Tractor: 'Tractors', Truck: 'Trucks', Motorbike: 'Motorbikes', 'Light vehicle': 'Light vehicles', 'Winch / Bell / shovel': 'Winches, Bell and shovels' };
const KIND_TESTS = [['Trucks', listTest(NAITIRI_TRUCKS)], ...Object.entries(NAITIRI_UNITS).map(([k, plates]) => [KIND_HEADING[k] ?? k, listTest(plates)])];

/** The unit's kind on the client's lists, when the sites picked are read from them; else null. */
export function siteKind(keys, label) {
  if (!(keys ?? []).some((k) => SITE_LISTS[k]?.kinds)) return null;
  return KIND_TESTS.find(([, t]) => t.test(label))?.[0] ?? null;
}

/** The organisations whose Fleets block offers these sites as pills: Naitiri by the client's lists. */
export const MAP_SITES = { WESTSUGAR: ['NAITIRI_EX'] };

/** The organisations whose reports offer these sites in a Units picker (hooks/useSitePick). */
export const REPORT_SITES = { WESTSUGAR: ['NAITIRI_EX', 'NAITIRI_TRUCKS_EX'] };

/** What a report for these sites calls its fleet: their own name when they share one, else null. */
export function siteFleet(keys) {
  const names = [...new Set((keys ?? []).map((k) => SITE_LISTS[k]?.fleet).filter(Boolean))];
  return names.length === 1 && (keys ?? []).every((k) => SITE_LISTS[k]) ? names[0] : null;
}

/** The pills' prefix in the map's type filter, beside the machine types: "site:NAITIRI". */
export const SITE_KIND = 'site:';

/** Is this live unit on the site's list? By its plate, its id and its name. */
export function vehicleOnSite(v, siteKey) {
  const t = SITE_LISTS[siteKey]?.test;
  if (!t) return false;
  return [v?.regPlate, v?.name, v?.id].some((label) => label && t.test(label));
}

/** The pills an organisation's Fleets block shows, with how many of its units each holds. */
export function mapSiteOptions(orgCode, vehicles) {
  return (MAP_SITES[String(orgCode ?? '').toUpperCase()] ?? []).map((key) => ({
    kind: `${SITE_KIND}${key}`,
    label: SITE_LISTS[key].fleet,
    count: (vehicles ?? []).filter((v) => vehicleOnSite(v, key)).length,
  }));
}
