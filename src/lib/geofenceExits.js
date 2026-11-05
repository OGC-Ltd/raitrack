// Geofence exits on the Alerts page (operator, 5 Nov 2026: "are we able to pull
// the geofence alerts ... and put them here"; "geofence exits, that's what I
// meant"; "only the current day"). The server already records each time a unit
// leaves one of its organisation's geofences (ZONE_EXIT, lib/zone-presence on
// fleet-server, from live positions) in the notification history, which any
// page may read (GET /organisations/:org/notifications?alertType=ZONE_EXIT&day=).
// They are shown, searched and counted here; the server keeps no decision or
// read mark for them, so they cannot be escalated or marked read.
//
// Pure: no React, no network.

export const EXIT_TYPES = ['ZONE_EXIT'];
/** Pages of the history read per organisation, PAGE_SIZE each: a busy fleet's day can run to thousands. */
export const PAGE_SIZE = 500;
export const MAX_PAGES = 6;

const timeOf = (n) => Date.parse(n?.ts ?? n?.time ?? '') || null;

/** The server's notifications as the page's rows, newest first, once each. */
export function exitRows(byOrg) {
  const seen = new Set();
  const rows = [];
  for (const { orgId, items } of byOrg) {
    for (const n of items ?? []) {
      const at = timeOf(n);
      const key = `${orgId}|${n.id ?? `${n.plate}|${at}|${n.text}`}`;
      if (seen.has(key) || at == null) continue;
      seen.add(key);
      rows.push({ key, orgId, at, plate: n.plate ?? null, vehicleId: n.vehicleId ?? null, text: String(n.text ?? '').trim() || 'Left a geofence' });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

/** The rows a plate search keeps ("kde127", "KDE 127E"); the wording too, for a geofence's name. */
export function searchExits(rows, q) {
  const s = String(q ?? '').trim();
  if (!s) return rows;
  const squash = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const plate = squash(s);
  const words = s.toLowerCase();
  return rows.filter((r) => (plate && squash(r.plate).includes(plate)) || r.text.toLowerCase().includes(words));
}
