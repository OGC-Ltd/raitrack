// Which report the Reports page shows, shared with the sidebar, where Reports
// is a tree with a node per report (operator, 2026-11-02): pick a node and the
// page opens on that report; pick a tab on the page and the node lights up.
// Each load starts on End of shift (operator, 2026-11-02): the choice lasts
// while the app is open and is not remembered past it.

import { useSyncExternalStore } from 'react';
import { REPORTS, REPORT_ORDER } from './reportTables';
import { isTemplated, templateFor } from './reportTemplates';

/**
 * Every report, A–Z by name, in the sidebar and on the page (operator,
 * 2 Nov 2026: "arranged in ascending order"). Shift and Movements are made by
 * the server.
 */
export const REPORT_NODES = [
  { key: 'shift', label: 'Shift' },
  { key: 'movements', label: 'Movements' },
  ...REPORT_ORDER.map((k) => ({ key: k, label: REPORTS[k].label })),
].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));

/**
 * Does Movements carry a Tankers tab for this organisation? Menengai's
 * tankers out of MORL, 4 hours at a time (operator, 2–3 Nov 2026), are a tab
 * under Movements, not a report of their own (operator, 3 Nov 2026).
 */
export const hasTankersTab = (can, orgCode) => can('telemetry:read') && templateFor('tankers', orgCode) != null;

/** Does Movements carry a Deliveries tab (the day's shared vehicles and their customers)? (operator, 4 Nov 2026) */
export const hasDeliveriesTab = (can, orgCode) => can('telemetry:read') && templateFor('deliveries', orgCode) != null;

/**
 * Does Movements carry a Dormant Assets tab (trackers that have stopped
 * sending, by the day of their last message)? Renamed from Non-Updating
 * Assets and moved under Movements (operator, 3 Nov 2026).
 */
export const hasDormantTab = (can, orgCode) => can('telemetry:read') && templateFor('offline', orgCode) != null;

/**
 * Does Movements carry a Geofences tab (every visit to a geofence over a
 * period)? Moved under Movements (operator, 4 Nov 2026).
 */
export const hasGeofencesTab = (can, orgCode) => can('telemetry:read') && templateFor('geofences', orgCode) != null;

/**
 * Does Movements carry a TAT and Fuel tab (each trip's turnaround, fuel and
 * distance, a day at a time)? Moved under Movements (operator, 4 Nov 2026).
 */
export const hasTatFuelTab = (can, orgCode) => can('telemetry:read') && templateFor('tatFuel', orgCode) != null;

/**
 * Does Movements carry a Speed Report tab (each unit over its limit, a day at
 * a time)? Moved under Movements (operator, 4 Nov 2026).
 */
export const hasSpeedTab = (can, orgCode) => can('telemetry:read') && templateFor('speedReport', orgCode) != null;

/** The report a load opens on: Shift, where the grants allow it, though it is no longer first. */
export const firstReport = (keys) => (keys.includes('shift') ? 'shift' : keys[0]);
const KEYS = new Set(REPORT_NODES.map((n) => n.key));

/**
 * The reports this user may open: the server needs analytics and weighbridge
 * grants for End of shift, telemetry for Movements; the rest are read here.
 * Templated reports are for the organisations that
 * lib/reportTemplates gives them to, and read the vehicles' positions.
 */
export function reportKeysFor(can, orgCode = null) {
  return REPORT_NODES.map((n) => n.key).filter((k) =>
    k === 'shift' ? can('analytics:read') && can('weighbridge:read')
      : k === 'movements' ? can('telemetry:read')
        : isTemplated(k) ? can('telemetry:read') && templateFor(k, orgCode) != null
          : true);
}

let current = null;
const listeners = new Set();

/** The report last picked, on the page or in the sidebar; null before any (the first the grants allow shows). */
export const currentReport = () => current;

export function chooseReport(key) {
  if (!KEYS.has(key) || key === current) return;
  current = key;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCurrentReport() {
  return useSyncExternalStore(subscribe, currentReport);
}
