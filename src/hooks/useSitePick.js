// A Units picker for the reports of an organisation with sites told apart by a
// list (lib/siteLists REPORT_SITES): West Kenya's "Naitiri all units Ex" and
// "Naitiri trucks Ex" (operator, 12 Nov 2026: "I should be able to generate all
// reports I'm able to get from West Kenya ... with a title of Naitiri").
//
// For the reports without the organisations picker (hooks/useReportOrgs): the
// fleet reports, Movements, Alarm Distribution, Unauthorized Passengers.

import { useMemo, useState } from 'react';
import { REPORT_SITES, SITE_LISTS, vehicleOnSite } from '../lib/siteLists';

export function useSitePick(orgCode) {
  const keys = REPORT_SITES[String(orgCode ?? '').toUpperCase()] ?? [];
  const [site, setSite] = useState(null);           // null: every unit
  const on = site && keys.includes(site) ? site : null;
  const test = on ? SITE_LISTS[on].test : null;
  return useMemo(() => ({
    site: on,
    setSite,
    /** Is this live unit in the report? */
    keepVehicle: (v) => !test || vehicleOnSite(v, on),
    /** Is a server row in the report, by any of its names (plate, grouping, unit name)? */
    keepRow: (...labels) => !test || labels.some((l) => l && test.test(l)),
    /** The report's fleet: the site's name when one is picked, else the organisation's. */
    fleetWords: (orgName) => (on ? SITE_LISTS[on].fleet : orgName),
    /** Props for a ChoicePicker; null when the organisation has no sites. */
    picker: keys.length ? {
      icon: 'ti-map-pin', label: 'Units', align: 'right', value: on,
      options: [{ value: null, label: 'All units' }, ...keys.map((k) => ({ value: k, label: SITE_LISTS[k].label }))],
    } : null,
  }), [on, test, keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}
