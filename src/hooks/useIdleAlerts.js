/**
 * Idle-alert hook.
 *
 * HOW IT WORKS NOW (before backend):
 * ----------------------------------
 * - Polls /api/v1/idle-alerts every POLL_MS.
 * - If the endpoint returns 404/501 (not live yet), falls back to the
 *   FRONTEND STORE: idle alerts are detected from live vehicle data and
 *   persisted in localStorage so they survive page refreshes.
 * - Dismissals are stored in localStorage under DISMISSED_KEY.
 * - Alerts do NOT auto-clear when a unit moves. They stay until dismissed.
 *
 * HOW TO MOVE TO BACKEND:
 * -----------------------
 * 1. Implement GET /api/v1/idle-alerts on the fleet-server (see lib/idleAlerts.js
 *    for the response shape and detectIdleAlerts() for the detection logic).
 * 2. The endpoint returns alerts. This hook will automatically stop using the
 *    localStorage fallback and consume the real endpoint instead.
 * 3. Store dismissals in the DB (POST /api/v1/idle-alerts/:id/dismiss).
 * 4. Delete the localStorage fallback block below (marked FALLBACK).
 *
 * ALERT RULES:
 * - A unit is idle when speed < 2 km/h and has been so for >= 3 hours.
 * - Engine state does not matter.
 * - Alerts do NOT clear when the unit moves — dismiss manually.
 * - After 6 hours the severity escalates from "warning" to "critical".
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "../services/api";
import { detectIdleAlerts, applyDismissals, MOVING_SPEED_KMH } from "../lib/idleAlerts";
import { MENENGAI_IDLE_UNITS, IDLE_THRESHOLD_MS, IDLE_UNIT_PLATES } from "../data/menengaiIdleUnits";

/** How often to re-poll and re-check (ms). */
const POLL_MS = 2 * 60_000; // 2 minutes

// ---------------------------------------------------------------------------
// Shared open-request store (mirrors useStopWatch's pattern).
// IdleAlertBadge calls requestIdleView(); AlertsScreen listens with
// useIdleOpenRequest() and switches to the idle tab when it increments.
// ---------------------------------------------------------------------------
let _openReq = 0;
const _openListeners = new Set();
const _openSnap = () => _openReq;
const _openSub = (fn) => { _openListeners.add(fn); return () => _openListeners.delete(fn); };

/** Call this to ask AlertsScreen to switch to the idle tab. */
export const requestIdleView = () => {
  _openReq += 1;
  for (const l of _openListeners) l();
};

/** Returns an ever-incrementing counter; AlertsScreen useEffect-reacts to it. */
export function useIdleOpenRequest() {
  return useSyncExternalStore(_openSub, _openSnap, _openSnap);
}

/**
 * localStorage key for the dismissed alert IDs.
 * Format: JSON array of strings, e.g. ["idle:KCE780B:1700000000", ...]
 */
const DISMISSED_KEY = "raitrack:idle-dismissed-v1";

/**
 * localStorage key for the frontend alert store.
 * Format: JSON array of alert objects (same shape as backend response).
 * We persist these so alerts survive page refresh.
 */
const STORE_KEY = "raitrack:idle-alerts-v1";

// --- localStorage helpers (safe — never throw) ---

function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch { return new Set(); }
}

function saveDismissed(set) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])); } catch {}
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
  } catch { return []; }
}

function saveStore(alerts) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(alerts)); } catch {}
}

/**
 * FALLBACK: Build unit snapshots from whatever vehicle data is available.
 *
 * The app doesn't yet expose a live per-unit timestamp, so we simulate
 * idleSinceMs from what we have:
 *   - If a unit's speed is 0 and we have a stored "stopped at" time → use it.
 *   - Otherwise, if speed is 0 we record "now" as the stopped-at time and
 *     store it; on the next poll we'll see how long it has been.
 *
 * The stopped-at times survive page refresh via localStorage.
 *
 * IMPORTANT: When a unit is seen moving (speed >= MOVING_SPEED_KMH), its
 * stopped-at time is cleared AND its plate is included in movingPlates so
 * the caller can purge stale alerts for it from the store.
 */
const STOPPED_AT_KEY = "raitrack:idle-stopped-at-v1";

function readStoppedAt() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(STOPPED_AT_KEY) ?? "{}"))); }
  catch { return new Map(); }
}
function saveStoppedAt(map) {
  try { localStorage.setItem(STOPPED_AT_KEY, JSON.stringify(Object.fromEntries(map))); } catch {}
}

/**
 * Merge live vehicle data with the stopped-at store and return
 * unit snapshots ready for detectIdleAlerts(), plus the set of plates
 * that are currently moving (so their stale alerts can be purged).
 *
 * Accepts vehicles from useFleetLiveShared() — fields: speedKmh, engineOn,
 * capturedAtMs, lat, lng, location, plate (or id).
 *
 * @param {Array}  vehicles    — from useFleetLiveShared()
 * @param {number} nowMs
 * @returns {{ snapshots: Array, movingPlates: Set<string> }}
 */
function buildSnapshots(vehicles, nowMs) {
  const stoppedAt   = readStoppedAt();
  const updated     = new Map(stoppedAt);
  const snapshots   = [];
  const movingPlates = new Set();

  for (const u of MENENGAI_IDLE_UNITS) {
    const v = vehicles?.find((veh) => (veh.plate ?? veh.id) === u.plate);

    // Normalise field names from useFleetLiveShared to our internal format.
    const speed  = v?.speedKmh  ?? v?.speed  ?? null;
    const engine = v?.engineOn != null ? (v.engineOn ? "on" : "off") : (v?.engine ?? null);

    // Only treat as moving if we have a confirmed speed reading above threshold.
    // If speed is null (no live data yet) we leave the unit in its current state.
    if (speed !== null && speed >= MOVING_SPEED_KMH) {
      // Unit is moving — clear its stopped-at time so a future stop is fresh.
      updated.delete(u.plate);
      movingPlates.add(u.plate);
      continue;
    }

    // Unit is stationary (or no live data). Record when it stopped if we haven't yet.
    if (!updated.has(u.plate)) {
      updated.set(u.plate, nowMs);
    }

    snapshots.push({
      plate:        u.plate,
      size:         u.size,
      designation:  u.designation,
      location:     v?.location ?? "",
      lat:          v?.lat ?? null,
      lng:          v?.lng ?? null,
      idleSinceMs:  updated.get(u.plate),
      speed:        speed ?? 0,
      engine,
    });
  }

  saveStoppedAt(updated);
  return { snapshots, movingPlates };
}

// --- The hook ---

/**
 * @typedef {{
 *   id: string,
 *   plate: string,
 *   size: string,
 *   designation: string,
 *   location: string,
 *   lat: number|null,
 *   lng: number|null,
 *   idleSinceMs: number,
 *   durationMs: number,
 *   speed: number,
 *   engine: "on"|"off"|null,
 *   severity: "warning"|"critical",
 * }} IdleAlert
 */

/**
 * @param {{ vehicles?: Array }} [opts]
 *   Pass the current vehicle list from the app so the fallback can check speeds.
 *
 * @returns {{
 *   status: "loading"|"ok"|"error",
 *   alerts: IdleAlert[],       // already-dismissed alerts excluded
 *   allAlerts: IdleAlert[],    // includes dismissed (for count display)
 *   generatedAt: number|null,
 *   error: string|null,
 *   source: "backend"|"local",
 *   dismiss: (id: string) => void,
 *   undismiss: (id: string) => void,
 *   dismissedIds: Set<string>,
 *   refresh: () => void,
 * }}
 */
export function useIdleAlerts({ vehicles } = {}) {
  const [state, setState] = useState({
    status: "loading",
    allAlerts: [],
    generatedAt: null,
    error: null,
    source: "local",
  });
  const [dismissedIds, setDismissedIds] = useState(() => readDismissed());
  const tickRef = useRef(0);

  const load = useCallback(async () => {
    const tick = ++tickRef.current;
    const nowMs = Date.now();

    // 1. Try the backend endpoint first.
    try {
      const data = await apiFetch("/api/v1/idle-alerts?orgCode=menengai");
      if (tick !== tickRef.current) return;

      const incoming = data?.alerts ?? [];

      // Merge with stored alerts so we keep alerts the backend no longer
      // returns (backend only sends currently-idle; we keep dismissed history).
      const stored = readStore();
      const storedById = new Map(stored.map((a) => [a.id, a]));
      for (const a of incoming) storedById.set(a.id, { ...storedById.get(a.id), ...a });
      const merged = [...storedById.values()];
      saveStore(merged);

      setState({
        status: "ok",
        allAlerts: merged,
        generatedAt: data?.generatedAt ?? nowMs,
        error: null,
        source: "backend",
      });
      return;
    } catch (err) {
      if (tick !== tickRef.current) return;
      const isPending = err?.status === 404 || err?.status === 501 || err?.status === 405 || err?.status === 403;
      if (!isPending) {
        setState((prev) => ({ ...prev, status: "error", error: err?.message ?? "Could not load idle alerts." }));
        return;
      }
      // FALLBACK — backend not live yet, use local detection.
    }

    // 2. FALLBACK: detect from vehicle data, persist in localStorage.
    const { snapshots, movingPlates } = buildSnapshots(vehicles, nowMs);
    const fresh = detectIdleAlerts(snapshots, IDLE_THRESHOLD_MS, nowMs);

    // Merge fresh alerts with stored ones, but PURGE alerts for units that
    // are currently confirmed moving — they are no longer idle.
    const stored = readStore();
    const byId   = new Map(
      stored
        .filter((a) => !movingPlates.has(a.plate ?? ""))
        .map((a) => [a.id, a])
    );
    for (const a of fresh) {
      // Update durationMs on existing alerts so they keep ticking.
      byId.set(a.id, { ...byId.get(a.id), ...a, durationMs: a.durationMs });
    }
    const merged = [...byId.values()];
    saveStore(merged);

    if (tick !== tickRef.current) return;
    setState({
      status: "ok",
      allAlerts: merged,
      generatedAt: nowMs,
      error: null,
      source: "local",
    });
  }, [vehicles]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => { clearInterval(id); tickRef.current++; };
  }, [load]);

  // Dismiss an alert (persists across refreshes).
  const dismiss = useCallback((id) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const undismiss = useCallback((id) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const alerts = applyDismissals(state.allAlerts, dismissedIds);

  return {
    ...state,
    alerts,
    dismissedIds,
    dismiss,
    undismiss,
    refresh: load,
  };
}
