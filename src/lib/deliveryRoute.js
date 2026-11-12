// Is a unit out on today's delivery route? (operator, 12 Nov 2026: "any unit
// that is on the delivery route from the start should say Carrying load".)
//
// The fleet has no load cells, so without a FactorySuite dispatch a unit's
// cargo reads "Empty". A Planner plan for the day (an uploaded sheet, a
// Logistics itinerary, or a list keyed in on Deliveries) says the truck was
// loaded for its customers, so from the start of that day it is carrying a load.
//
// Pure: no React, no network.

const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The day's plan with stops for this unit, matched by vehicle id, else by plate; or null. */
export function routePlanFor(plans, vehicle) {
  if (!vehicle || !plans?.length) return null;
  const key = plateKey(vehicle.id);
  return plans.find((p) => (p.stopCount ?? 0) > 0 && (
    (vehicle.vehicleId && p.vehicleId === vehicle.vehicleId)
    // "Menengai - KDE 141E" as the unit's key, "KDE 141E" on the plan
    || (plateKey(p.plate).length >= 6 && key.endsWith(plateKey(p.plate)))
  )) ?? null;
}

/** "on today's delivery route (6 stops)" */
export function routeWords(plan) {
  const n = plan?.stopCount ?? 0;
  return `on today's delivery route (${n} ${n === 1 ? 'stop' : 'stops'})`;
}
