// The idle watch's shared state (lib/idleAlerts says what it is): Menengai's
// units idle now, as the server sends them, the ones dismissed in this
// browser, and whether the Alerts page should open on them. Written by the
// runner (components/shared/IdleAlertBadge), read by the badge and the
// Alerts page's Idle units list.
//
// Dismissals stay in this browser until the server keeps them: each names one
// stop, so a unit that moves and stops again is a new alert.

import { useSyncExternalStore } from 'react';
import { liveDismissals } from '../lib/idleAlerts';

const DISMISSED_KEY = 'raitrack:idle-dismissed-v2';

function readDismissed() {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {
    // Private window or storage full: dismissals last until the page closes
  }
}

let state = {
  status: 'idle', alerts: [], notReporting: [], notOnPlatform: [], rule: null,
  checkedAt: null, message: null, dismissed: readDismissed(), open: 0,
};
const listeners = new Set();

export const idleWatchState = () => state;
function set(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

export function useIdleWatch() {
  return useSyncExternalStore(subscribe, idleWatchState, idleWatchState);
}

/** The server's answer (or a status alone: loading, off, error). */
export function setIdleWatch(patch) {
  if (Array.isArray(patch.alerts) && patch.status === 'done') {
    // Forget dismissals of stops that have ended
    const kept = liveDismissals(state.dismissed, patch.alerts);
    if (kept.size !== state.dismissed.size) { saveDismissed(kept); patch = { ...patch, dismissed: kept }; }
  }
  set(patch);
}

export function dismissIdle(key) {
  const next = new Set(state.dismissed).add(key);
  saveDismissed(next);
  set({ dismissed: next });
}

export function undismissIdle(key) {
  const next = new Set(state.dismissed);
  next.delete(key);
  saveDismissed(next);
  set({ dismissed: next });
}

/** Ask the Alerts page to show the idle units (the badge's "Open"). */
export const requestIdleView = () => set({ open: state.open + 1 });
