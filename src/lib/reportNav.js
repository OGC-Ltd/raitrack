// Which report the Reports page shows, shared with the sidebar, where Reports
// is a tree with a node per report (operator, 2026-11-02): pick a node and the
// page opens on that report; pick a tab on the page and the node lights up.
// Each load starts on End of shift (operator, 2026-11-02): the choice lasts
// while the app is open and is not remembered past it.

import { useSyncExternalStore } from 'react';
import { REPORTS, REPORT_ORDER } from './reportTables';

/** Every report, in the page's tab order. The first two are made by the server. */
export const REPORT_NODES = [
  { key: 'shift', label: 'End of shift' },
  { key: 'movements', label: 'CPO movements' },
  ...REPORT_ORDER.map((k) => ({ key: k, label: REPORTS[k].label })),
];
const KEYS = new Set(REPORT_NODES.map((n) => n.key));

/**
 * The reports this user may open: the server needs analytics and weighbridge
 * grants for End of shift, telemetry for CPO movements; the rest are read here.
 */
export function reportKeysFor(can) {
  return REPORT_NODES.map((n) => n.key).filter((k) =>
    k === 'shift' ? can('analytics:read') && can('weighbridge:read')
      : k === 'movements' ? can('telemetry:read')
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
