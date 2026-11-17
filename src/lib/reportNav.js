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

/** Does Movements carry a Recovery tab for the four supported organisations? */
export const hasRecoveryTab = (can, orgCode) => can('telemetry:read') && templateFor('recovery', orgCode) != null;

/**
 * Does Movements carry a Speed Report tab (each unit over its limit, a day at
 * a time)? Moved under Movements (operator, 4 Nov 2026).
 */
export const hasSpeedTab = (can, orgCode) => can('telemetry:read') && templateFor('speedReport', orgCode) != null;

/**
 * Does Movements carry a Probe Disconnection tab (each time a unit's fuel probe
 * was disconnected)? (operator, 5 Nov 2026)
 */
export const hasProbeTab = (can, orgCode) => can('telemetry:read') && templateFor('probeReport', orgCode) != null;

/** Does Movements carry an AI Alarm Distribution tab? Shown for orgs with VSS cameras (vss:alarms). */
export const hasAlarmDistTab = (can) => can('vss:alarms');

/** Does Movements carry an Unauthorized Passengers tab? Shown for any org with telemetry access. */
export const hasUnauthorizedPassengersTab = (can) => can('telemetry:read');

/**
 * Does Movements carry a Fuel Consumption Rate tab (per-vehicle fuel
 * efficiency over a custom date range)? Menengai only (operator, Nov 2026).
 */
// Fuel Consumption Rate, and with it the Fuel Graphs: every organisation (operator, 13 Nov 2026: "should
// be across all organizations"), was Menengai's alone. Target rates are on file for Menengai's units only;
// elsewhere none is judged against one. Menengai keeps its own sheet (lib/fuelRateMorl)
export const hasFuelConsumptionTab = (can) => can('telemetry:read');

/** The organisations with a Machinery report. */
export const MACHINERY_ORGS = new Set(['KASULU']);

/**
 * Does Movements carry a Machinery tab (the excavators' and dozers' engine
 * hours and fuel against the machine register)? Mufindi (KASULU) alone has
 * the register. A tab under Movements, after Fuel Graphs, not a sidebar node
 * (operator, 16 Nov 2026).
 */
export const hasMachineryTab = (can, orgCode) => can('telemetry:read') && MACHINERY_ORGS.has(String(orgCode ?? '').toUpperCase());

/** Shift hours, beside Machinery: where FactorySuite plans the machines' shifts (Mufindi, operator 17 Nov 2026). */
export const hasShiftHoursTab = hasMachineryTab;

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
