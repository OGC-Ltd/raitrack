// The join behind the single-vehicle fuel chart.
//
// Two halves of one unit's fuel day arrive from two different aggregates:
//
//   · the LEDGER (/analytics/fuel-cost) — what was put in and what was drained,
//     present for every day in the window;
//   · the measured BALANCE (/analytics/vehicle-fuel-days) — kilometres, engine
//     hours and the tank's own burn, present only for a day that cleared the
//     probe guards, which is 11 to 13 days in 30 for a single unit.
//
// They are joined on the fleet-day key, and the ledger is the spine: it carries
// the whole window, so joining the other way round would shorten the axis to
// whatever the probe managed and hide the gaps the chart exists to show.
//
// Extracted from the component because this join is the one part that can fail
// SILENTLY. The two halves are anchored by different code paths — the ledger on
// the newest filling, the balance on the fleet day — and if those ever disagree
// about what a day is called, every measured value drops out and the chart
// still renders: bars, axes, legend, and a flat empty line where the distance
// should be. `measured` is returned so the caller can say so out loud.

/**
 * @param {Array<{day:string, litres?:number, lost?:number, cost?:number,
 *                lossCost?:number}>} fuelDays  the ledger series
 * @param {{days?: Array<{day:string, km?:number|null, litres?:number|null,
 *          hours?:number|null, litresPerKm?:number|null,
 *          litresPerHour?:number|null}>}|null} unitFuel
 * @returns {{rows: Array<object>, measured: number}}
 *   `measured` counts rows that actually picked up a distance — what the
 *   caveat under the chart reports.
 */
export function joinUnitFuelDays(fuelDays, unitFuel) {
  const byDay = new Map(
    (unitFuel?.days ?? []).map((d) => [d.day, d]),
  );

  const rows = (fuelDays ?? []).map((d) => {
    const m = byDay.get(d.day);

    return {
      day: d.day,
      litres: d.litres ?? null,
      lost: d.lost ?? null,
      cost: d.cost ?? null,
      lossCost: d.lossCost ?? null,
      // `?? null` on every measured field, never `?? 0`: a day the guards
      // rejected has no reading, and a zero would draw a unit that ran nowhere
      // and burnt nothing. That is a claim about the day rather than the
      // absence of one — see the service header.
      km: m?.km ?? null,
      perKm: m?.litresPerKm ?? null,
      used: m?.litres ?? null,
      hours: m?.hours ?? null,
      // The server publishes this wherever the balance closed — the guard
      // already required an engine hour, so it never divides by a rounding
      // error. Derived here only if an older payload omits it.
      perHour:
        m?.litresPerHour ??
        (m?.litres != null && m?.hours ? m.litres / m.hours : null),
    };
  });

  return {
    rows,
    measured: rows.filter((r) => r.km != null).length,
  };
}
