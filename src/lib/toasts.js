// The toast queue (operator, 10 Nov 2026: "the toast should stack on each
// other that first in first out should render for 8s and disappear").
//
// The server makes every toast (fleet-server lib/toasts) and sends it down
// the live stream (hooks/useFleetLive, `toast` frames); this only queues and
// times them. First in, first out: up to MAX_VISIBLE show at once, oldest on
// top, and each leaves LIFE_MS after it came into view. While a pointer rests
// on the stack the clocks stand still, so Copy or Open can be reached.
//
// Pure apart from timers: no React, no network.

export const LIFE_MS = 8_000;
export const MAX_VISIBLE = 4;
/** Beyond this many waiting, the oldest waiting are dropped: a flood is not worth replaying. */
const MAX_WAITING = 30;
/** Ids already seen, so a stream replay or a second frame does not show one twice. */
const SEEN_MAX = 500;

let entries = [];          // { toast, left, startedAt, timer }
let paused = false;
const seen = new Set();
let snapshot = { shown: [], waiting: 0 };
const listeners = new Set();

function emit() {
  snapshot = { shown: entries.slice(0, MAX_VISIBLE).map((e) => e.toast), waiting: Math.max(0, entries.length - MAX_VISIBLE) };
  for (const l of listeners) l();
}

function start(e) {
  e.startedAt = Date.now();
  e.timer = setTimeout(() => dismissToast(e.toast.id), e.left);
}

/** Start the clock of each toast that has come into view. */
function promote() {
  if (paused) return;
  for (const e of entries.slice(0, MAX_VISIBLE)) if (!e.timer) start(e);
}

/** Queue a toast from the server. Returns false when it was seen already. */
export function addToast(toast) {
  if (!toast?.id || seen.has(toast.id)) return false;
  seen.add(toast.id);
  if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
  entries.push({ toast, left: LIFE_MS, startedAt: null, timer: null });
  const over = entries.length - MAX_VISIBLE - MAX_WAITING;
  if (over > 0) entries.splice(MAX_VISIBLE, over);
  promote();
  emit();
  return true;
}

export function dismissToast(id) {
  const i = entries.findIndex((e) => e.toast.id === id);
  if (i < 0) return;
  clearTimeout(entries[i].timer);
  entries.splice(i, 1);
  promote();
  emit();
}

/** Hold every running clock (pointer on the stack), or let them run again. */
export function pauseToasts(on) {
  if (on === paused) return;
  paused = on;
  if (on) {
    const now = Date.now();
    for (const e of entries) {
      if (!e.timer) continue;
      clearTimeout(e.timer);
      e.timer = null;
      e.left = Math.max(400, e.left - (now - e.startedAt));
    }
  } else {
    promote();
  }
}

export const toastsSnapshot = () => snapshot;
export function subscribeToasts(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** For tests: forget everything. */
export function resetToasts() {
  for (const e of entries) clearTimeout(e.timer);
  entries = [];
  paused = false;
  seen.clear();
  emit();
}
