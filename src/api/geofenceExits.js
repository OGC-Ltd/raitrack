// Today's geofence exits for the Alerts page, from the notification history
// (lib/geofenceExits says why). Each organisation is read on its own; one
// that cannot be read is named, the others still show.

import { getNotifications, fleetToday } from './notifications';
import { EXIT_TYPES, PAGE_SIZE, MAX_PAGES } from '../lib/geofenceExits';
import { settleLimited } from '../lib/settleLimited';

/**
 * @param {string[]} orgIds
 * @returns {Promise<{ byOrg: {orgId, items}[], failed: string[], cut: string[], day: string }>}
 *   `cut`: organisations with more exits today than MAX_PAGES × PAGE_SIZE (the newest are shown).
 */
export async function loadGeofenceExits(orgIds, { day = fleetToday() } = {}) {
  const parts = await settleLimited(orgIds, 3, async (orgId) => {
    const items = [];
    let before;
    let more = false;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await getNotifications({ orgId, day, limit: PAGE_SIZE, before, alertTypes: EXIT_TYPES });
      items.push(...page.items);
      if (!page.nextBefore) { more = false; break; }
      before = page.nextBefore;
      more = true;
    }
    return { orgId, items, more };
  });
  const byOrg = [];
  const failed = [];
  const cut = [];
  parts.forEach((p, i) => {
    if (p.status !== 'fulfilled') { failed.push(orgIds[i]); return; }
    byOrg.push({ orgId: p.value.orgId, items: p.value.items });
    if (p.value.more) cut.push(p.value.orgId);
  });
  return { byOrg, failed, cut, day };
}
