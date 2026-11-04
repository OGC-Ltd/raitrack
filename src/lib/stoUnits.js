// Menengai's units at the Nairobi depot (STO) on the Movements report
// (operator, 4 Nov 2026: "for now I just want these units that are at Nairobi
// depot current location to just show At STO rather than from/to or
// stopped"). Earlier rules for the Nairobi vans (On delivery by the hour,
// To/From STO) were dropped the same day.
//
// A unit is at STO when its last position is within 1 km of STO's point in
// Wialon Logistics, or within 1 km of the Nairobi depot geofence (the same
// kilometre that fills its Location cell blue). Its Direction then reads
// At STO. A unit at MORL HQ, or not reporting, keeps its state. Any Menengai
// unit may be set At STO by hand.
//
// Pure: no React, no network.

import { metresToFence } from './movementDepots';

/** STO as Wialon Logistics has it, and how far round it counts as at STO. */
export const STO_POINT = { lat: -1.3029466, lng: 36.8660916 };
export const STO_RADIUS_M = 1000;

const rad = (x) => (x * Math.PI) / 180;
function metres(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Is the position at STO: within 1 km of its point, or of the Nairobi depot geofence? */
export function atSto(p, fence = null) {
  if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return false;
  return metres(p, STO_POINT) <= STO_RADIUS_M || Boolean(fence && metresToFence(p, fence) <= STO_RADIUS_M);
}

/**
 * The report with every unit at STO reading At STO, and every row allowed At
 * STO in its Direction menu (`stoSite`). Returns a new report.
 * @param fence  the Nairobi depot geofence, if on the platform
 */
export function withStoDirections(report, fence = null) {
  return {
    ...report,
    groups: report.groups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => {
        const here = r.state !== 'no-fix' && r.state !== 'at' && atSto(r, fence);
        return { ...r, stoSite: true, ...(here ? { state: 'sto-at' } : {}) };
      }),
    })),
  };
}
