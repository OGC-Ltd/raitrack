// A Site picker for the reports of an organisation with sites told apart by a
// list (lib/siteLists REPORT_SITES): West Kenya's "Naitiri all units Ex" and
// "Naitiri trucks Ex" (operator, 12 Nov 2026: "I should be able to generate all
// reports I'm able to get from West Kenya ... with a title of Naitiri").
//
// For the reports without the organisations picker (hooks/useReportOrgs): the
// fleet reports, Movements, Alarm Distribution, Unauthorized Passengers.

import { useMemo, useState } from 'react';
import { REPORT_SITES, SITE_LISTS, vehicleOnSite } from '../lib/siteLists';

/**
 * @param orgCode  the organisation's code; only those in REPORT_SITES get a picker
 * @param initial  the site picked when the report opens (Movements keeps it with its tables)
 */
export function useSitePick(orgCode, initial = null) {
  const code = String(orgCode ?? '').toUpperCase();
  const [site, setSite] = useState(initial);        // null: every unit
  return useMemo(() => {
    const keys = REPORT_SITES[code] ?? [];
    const on = site && keys.includes(site) ? site : null;
    const test = on ? SITE_LISTS[on].test : null;
    return {
      site: on,
      setSite,
      /** Is this live unit in the report? */
      keepVehicle: (v) => !test || vehicleOnSite(v, on),
      /** Is a server row in the report, by any of its names (plate, grouping, unit name)? */
      keepRow: (...labels) => !test || labels.some((l) => l && test.test(l)),
      /** The report's fleet: the site's name when one is picked, else the organisation's. */
      fleetWords: (orgName) => (on ? SITE_LISTS[on].fleet : orgName),
      /**
       * Props for a ChoicePicker; null when the organisation has no sites. "Site" and "All sites",
       * not "Units": the sidebar reports have a Unit picker beside it that reads "All units" (review, 12 Nov 2026).
       */
      picker: keys.length ? {
        icon: 'ti-map-pin', label: 'Site', align: 'right', value: on,
        options: [{ value: null, label: 'All sites' }, ...keys.map((k) => ({ value: k, label: SITE_LISTS[k].label }))],
      } : null,
    };
  }, [code, site]);
}
