// Geofence exits on the Alerts page (operator, 5 Nov 2026: "are we able to pull
// the geofence alerts ... and put them here"; "geofence exits, that's what I
// meant"; "only the current day"). The server already records each time a unit
// leaves one of its organisation's geofences (ZONE_EXIT, lib/zone-presence on
// fleet-server, from live positions) in the notification history, which any
// page may read (GET /organisations/:org/notifications?alertType=ZONE_EXIT&day=).
// They are shown, searched and counted here; the server keeps no decision for
// them, so they cannot be escalated. Read marks are the bell's (lib/feedReads),
// kept per organisation in this browser: an exit is the same line there.
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
      rows.push({ key, orgId, at, id: n.id ?? null, ts: new Date(at).toISOString(), plate: n.plate ?? null, vehicleId: n.vehicleId ?? null, zoneId: zoneIdOf(n.id), text: String(n.text ?? '').trim() || 'Left a geofence' });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

/**
 * The geofence an exit was announced for. The server names each crossing
 * `zn-<vehicle>-<geofence>-o-<ms>` (fleet-server lib/zone-presence), and the
 * geofence is the part before `-o-`: geofence ids are cuids, with no dash.
 */
export function zoneIdOf(id) {
  const m = /-([^-]+)-o-\d+$/.exec(String(id ?? ''));
  return m ? m[1] : null;
}

/**
 * Geofence id → { name, category } from the organisations' /geofences/geojson
 * collections. The category is the server's own (lib/zone-taxonomy), so the
 * column says what the map's colours say.
 */
export function zoneIndex(collections) {
  const index = new Map();
  for (const fc of collections ?? []) {
    for (const f of fc?.features ?? []) {
      const p = f?.properties;
      if (p?.id) index.set(p.id, { name: p.name ?? null, category: p.category ?? 'other' });
    }
  }
  return index;
}

/**
 * One exit as text to paste into a chat or a report: what, who, when, where.
 * `type` is the geofence type's label, `org` the organisation's name.
 */
export function exitCopyText(row, { type, zone, org } = {}) {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(row.at);
  return [
    `Geofence exit · ${row.plate ?? 'unit'}`,
    `When: ${when}`,
    zone || type ? `Geofence: ${[zone, type && `(${type})`].filter(Boolean).join(' ')}` : null,
    org ? `Organisation: ${org}` : null,
    `Details: ${row.text}`,
  ].filter(Boolean).join('\n');
}

/** The rows a plate search keeps ("kde127", "KDE 127E"); the wording too, for a geofence's name, and the geofence type. */
export function searchExits(rows, q, typeOf = () => '') {
  const s = String(q ?? '').trim();
  if (!s) return rows;
  const squash = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const plate = squash(s);
  const words = s.toLowerCase();
  return rows.filter((r) => (plate && squash(r.plate).includes(plate)) || r.text.toLowerCase().includes(words)
    || String(typeOf(r) ?? '').toLowerCase().includes(words));
}

/**
 * The Read filter ("all" | "unread" | "read"), as on the alerts. `keep` holds
 * rows opened under the filter: they stay listed until it changes, so opening
 * an unread exit does not pull it from under the reader.
 */
export function byRead(rows, read, unread, keep = new Set()) {
  if (read !== 'unread' && read !== 'read') return rows;
  return rows.filter((r) => keep.has(r.key) || (read === 'unread') === Boolean(unread(r)));
}
