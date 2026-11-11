// A delivery plan shown on the Live Map (Planner, operator 2026-11-11: "the
// map should be the live map, and the planner page should not render any
// map"). The Planner puts a plan here and switches to the map; FleetMap draws
// its customers' fences, numbered, and the truck's run, until it is cleared.
//
// A fence redraw goes the same way: the Planner asks for a fence by id and the
// map opens its own geofence tool on it once its zones are loaded.
//
// Module-level, like lib/mapBridge: one map, one plan on it.

import { useSyncExternalStore } from 'react';

let state = { overlay: null, editFence: null };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;

/**
 * Put a plan on the map.
 * @param {{ planId, title, sub?, stops: Array<{ id, n, label, feature, tone }>, track: Array<{lat, lng}>, focusStopId? }} overlay
 */
export const showPlanOnMap = (overlay) => set({ overlay: { ...overlay, at: Date.now() } });
export const clearPlanOnMap = () => set({ overlay: null, editFence: null });
/** Bring one of the plan's stops into view. */
export const focusPlanStop = (stopId) => state.overlay && set({ overlay: { ...state.overlay, focusStopId: stopId, at: Date.now() } });
/** Ask the map to open its geofence tool on this fence. */
export const requestFenceEdit = (fenceId) => set({ editFence: fenceId ? { id: fenceId, at: Date.now() } : null });
export const fenceEditTaken = () => set({ editFence: null });

// A plan to open when the Planner next mounts (the Deliveries report's "Open in Planner")
let planToOpen = null;
export const openPlanNext = (planId) => { planToOpen = planId ?? null; };
export const takePlanToOpen = () => { const id = planToOpen; planToOpen = null; return id; };

export function usePlanOverlay() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export const planOverlayNow = () => state;

/** A circle as a ring of {lat, lng} (the map engine has no circle). */
export function circlePath(lat, lng, radiusM, n = 48) {
  const out = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push({ lat: lat + dLat * Math.sin(a), lng: lng + dLng * Math.cos(a) });
  }
  return out;
}

/** A fence feature as a path the map engine draws, or null. */
export function pathOf(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  if (g.type === 'Point') return circlePath(g.coordinates[1], g.coordinates[0], feature.properties?.radiusM || 100);
  if (g.type === 'Polygon') return g.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
  return null;
}

/** Where a fence's number goes: a circle's centre, or the middle of a polygon's corners. */
export function middleOfPath(feature, path) {
  const g = feature?.geometry;
  if (g?.type === 'Point') return { lat: g.coordinates[1], lng: g.coordinates[0] };
  if (!path?.length) return null;
  return path.reduce((a, p) => ({ lat: a.lat + p.lat / path.length, lng: a.lng + p.lng / path.length }), { lat: 0, lng: 0 });
}

export const TONE_COLOR = { ok: '#16a34a', crit: '#dc2626', warn: '#d97706', new: '#ea580c' };
