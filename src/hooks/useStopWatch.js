// The stop watch's shared state (lib/stopWatch says what it flags): what is
// flagged now, when it was last checked, and whether the Alerts page should
// open on it. Written by the StopWatch runner (components/shared/StopWatch),
// read by the Alerts page.

import { useSyncExternalStore } from 'react';

let state = { status: 'idle', flags: [], checkedAt: null, message: null, open: 0 };
const listeners = new Set();

export const stopWatchState = () => state;
export function setStopWatch(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

export function useStopWatch() {
  return useSyncExternalStore(subscribe, stopWatchState, stopWatchState);
}

/** Ask the Alerts page to show the stops (from a pop-up's "Open"). */
export const requestStopsView = () => setStopWatch({ open: state.open + 1 });
