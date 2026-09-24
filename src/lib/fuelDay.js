// One unit's fuel for one fleet day, as a ledger an operator can check.
//
// Replaces the fuel incident window's "Record / Movement / Came back / Rule"
// rows, which described how the verdict was reached and left the reader to
// work out what the day actually looked like. This answers that directly:
//
//   opening level + refuelled − closing level = fuel used, by the tank
//   engine hours × the unit's own burn rate  = what the engine should use
//   the difference                            = what the engine does not explain
//
// and lists the day's events in order, the one being looked at marked.
//
// ## Why the events are listed and not added up
//
// Flagged events overlap and re-measure the same fall. MUFINDI - DZ 20 on
// 2026-09-25 had four in an hour, one of them an undulation where the fuel
// never left, and their volumes summed to 95.7 L against a tank that fell
// 58.2 L. A total built from them would be a number nothing measured. The tank
// ledger above them is the arithmetic; the events are when and what.

/** Fleet days are Kenyan (EAT, UTC+3, no DST), as the server buckets them. */
const FLEET_OFFSET_MS = 3 * 3_600_000;

/** "2026-09-25", the fleet day containing `iso`. */
export function fleetDayOf(iso) {
  return new Date(new Date(iso).getTime() + FLEET_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) of a fleet day, as ISO instants. */
export function fleetDayBounds(day) {
  const start = Date.parse(`${day}T00:00:00Z`) - FLEET_OFFSET_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() };
}

/**
 * A refuel only counts when the fuel arrived. REDISTRIBUTION on a filling means
 * the tracker reported one and the tank is no fuller: a probe swing, not a
 * delivery (see chipKind in SensorPanel for the same rule).
 */
const realRefuel = (f) => f.verdict !== "REDISTRIBUTION";

/** How an event reads in the timeline. Never "theft": the probe sees a level
 *  fall, not where the fuel went. */
export function eventLabel(e) {
  if (e.type === "refuel") return e.verdict === "REDISTRIBUTION" ? "Refuel reported, tank no fuller" : "Refuelled";
  if (e.verdict === "REDISTRIBUTION") return "Level dipped and came back";
  if (e.verdict === "SENSOR_FAULT") return "Probe fault";
  if (e.verdict === "PENDING" || !e.verdict) return "Drop, still settling";
  return {
    SIPHON: "Drop while parked",
    HIGH_BURN: "Burn above normal",
    UNEXPLAINED_BURN: "Burn far above normal",
  }[e.cause] ?? "Drop, stayed down";
}

/**
 * The day, from the three sources.
 *
 * `tank`     the unit's row from /fuel/tank-state?date= (initialMl, currentMl,
 *            engineBurnMl, engineSeconds, engineRateLPerHour, distanceM)
 * `fillings` /fuel/fillings for the unit and day
 * `drops`    /fuel/thefts for the unit and day
 *
 * Litres throughout. Any figure whose inputs are missing is null, never a
 * guess: a ledger line with an invented end is worse than a dash.
 */
export function dayBreakdown({ tank, fillings = [], drops = [] }) {
  const L = (ml) => (ml == null ? null : ml / 1000);

  const refuels = fillings.filter(realRefuel);
  const refuelled = refuels.reduce((s, f) => s + (f.filledMl ?? 0), 0) / 1000;
  const opening = L(tank?.initialMl);
  const closing = L(tank?.currentMl);
  const used = opening != null && closing != null ? opening + refuelled - closing : null;
  const engine = L(tank?.engineBurnMl);
  const unexplained = used != null && engine != null ? used - engine : null;

  const events = [
    ...fillings.map((f) => ({
      id: f.id, type: "refuel", at: f.filledAt, litres: L(f.filledMl), verdict: f.verdict,
    })),
    ...drops.map((d) => ({
      id: d.id, type: "drop", at: d.beganAt, litres: L(d.stolenMl), verdict: d.verdict,
      cause: d.drainCause, cameBack: L(d.recoveredMl),
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return {
    opening,
    refuelled,
    refuelCount: refuels.length,
    closing,
    used,
    engine,
    engineHours: tank?.engineSeconds != null ? tank.engineSeconds / 3600 : null,
    engineRate: tank?.engineRateLPerHour ?? null,
    unexplained,
    distanceKm: tank?.distanceM != null ? tank.distanceM / 1000 : null,
    events,
  };
}

/**
 * Whether the unexplained part is worth drawing attention to. A few litres
 * either way is the probe and the rate estimate disagreeing, not an event:
 * flagged at 5 L and 10 % of what the engine should have used, whichever is
 * larger.
 */
export function unexplainedMatters(b) {
  if (b.unexplained == null) return false;
  return b.unexplained > Math.max(5, 0.1 * (b.engine ?? 0));
}
