// Suspected theft apart from the rest of what drained (operator, 28 Sep, on
// the Fuel Consumption & Cost chart: "one of these should read suspected theft
// ... if it was initially added into Fuel Drained we will have to subtract and
// have it as independent").
//
// The fuel-cost endpoint counts every drain in `litresLost` / `lossCost` /
// `thefts`, and carries the suspected theft among them — drains whose cause was
// judged SIPHON, the only ones the product calls possible theft — as
// `litresSuspectedTheft` / `suspectedTheftCost` / `suspectedThefts`. Here the
// two are pulled apart so each litre is shown once: in "Drained" or in
// "Suspected theft", never both. A server without the new fields reads as no
// suspected theft, and "Drained" stays what it was.

const tenth = (n) => Math.round(n * 10) / 10;

/**
 * One level of the payload (a day, a vehicle or the totals) as the two parts:
 * `lost` / `lossCost` the drains that are not suspected theft, `theft` /
 * `theftCost` the ones that are; `drains` / `thefts` their counts.
 */
export function splitDrained(level) {
  const theft = level?.litresSuspectedTheft ?? 0;
  const theftCost = level?.suspectedTheftCost ?? 0;
  const thefts = level?.suspectedThefts ?? 0;
  return {
    lost: Math.max(0, tenth((level?.litresLost ?? 0) - theft)),
    lossCost: Math.max(0, (level?.lossCost ?? 0) - theftCost),
    drains: Math.max(0, (level?.thefts ?? 0) - thefts),
    theft,
    theftCost,
    thefts,
  };
}
