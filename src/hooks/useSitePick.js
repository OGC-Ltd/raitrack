// A Site picker for the reports of an organisation with sites told apart by a
// list or a name (lib/siteLists REPORT_SITES): West Kenya's sites, "Naitiri"
// and "Naitiri trucks" from the client's Excel files among them (operator, 12 Nov
// 2026: "I should be able to generate all reports I'm able to get from West
// Kenya ... with a title of Naitiri").
//
// For the reports without the organisations picker (hooks/useReportOrgs): the
// fleet reports, Movements, Alarm Distribution, Unauthorized Passengers.

import { useMemo, useState } from 'react';
import { REPORT_SITES, SITE_LISTS, siteFleet, vehicleOnSite } from '../lib/siteLists';

/**
 * @param orgCode  the organisation's code; only those in REPORT_SITES get a picker
 * @param initial  the sites picked when the report opens (Movements keeps them with its tables)
 */
export function useSitePick(orgCode, initial = null) {
  const code = String(orgCode ?? '').toUpperCase();
  const [picked, setSite] = useState(initial);       // null: every unit; else the site keys ticked
  return useMemo(() => {
    const sites = REPORT_SITES[code] ?? null;
    const keys = sites?.keys ?? [];
    const ticked = Array.isArray(picked) ? picked.filter((k) => keys.includes(k)) : null;
    const on = ticked?.length ? ticked : null;
    const tests = on ? on.map((k) => SITE_LISTS[k].test) : null;
    return {
      /** The site keys picked, or null for every unit. */
      site: on,
      setSite,
      /** Is this live unit in the report? On any of the sites picked. */
      keepVehicle: (v) => !on || on.some((k) => vehicleOnSite(v, k)),
      /** Is a server row in the report, by any of its names (plate, grouping, unit name)? */
      keepRow: (...labels) => !tests || labels.some((l) => l && tests.some((t) => t.test(l))),
      /**
       * The report's fleet: the organisation's when every unit is in, the sites' own name when
       * they share one (Naitiri's three), else their names (lib/useReportOrgs pickedWords' rule).
       */
      fleetWords: (orgName) => (!on ? orgName : siteFleet(on) ?? on.map((k) => SITE_LISTS[k].label).join(', ')),
      /**
       * Props for a CheckPicker, as the Organisations picker on Geofences and TAT and Fuel has
       * them (operator, 12 Nov 2026: "match those in geofences, TAT & Fuel"): "West Kenya (12)"
       * with every site in, a West Kenya chip to put them all back. Null when the organisation
       * has no sites.
       */
      picker: keys.length ? {
        icon: 'ti-map-pin', label: 'Sites', noun: 'sites', allWord: sites.allWord, minOne: true,
        options: keys.map((k) => ({ value: k, label: SITE_LISTS[k].label })),
        picked: on,
        onChange: setSite,
      } : null,
    };
  }, [code, picked]);
}
