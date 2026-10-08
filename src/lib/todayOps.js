/* The day's three figures, from the per-unit fleet state.
 *
 * Derived on the client rather than fetched: fleet-state already carries one
 * row per unit with the hours its engine ran today and the ground it covered,
 * it is warm-cached, and the Analytics page has already narrowed it by the
 * vehicle filter. A server endpoint for the same three numbers would spend a
 * request and introduce a second definition of "operational" that could drift
 * from the one the table below them draws.
 *
 * The definitions are the operator's, stated 2026-08-22, and each one has a
 * failure mode it exists to avoid — see the notes on the function itself.
 */

/**
 * @param units  fleet-state rows: `{ hoursToday, distanceTodayKm }` per unit
 * @returns `null` when there are no units at all — which is "not loaded yet",
 *   a different thing from a fleet where nothing has run, and the caller shows
 *   a dash for it rather than a zero.
 */
export function summariseToday(units) {
  if (!units || units.length === 0) return null;

  /**
   * OPERATIONAL — the unit WORKED today.
   *
   * Engine ran, or it moved. Both, because the operator's wording for the
   * other side is "parked all day, not even moved or engine ignited once", so
   * either one is enough to count as working.
   *
   * Moving vs standing with the engine on makes NO difference, and on plant
   * that is the whole point: an excavator digs without going anywhere, so a
   * definition built on movement would report a working pit as an idle one.
   * That is the same distinction fleet-state draws between STATIONARY and
   * PARKED, applied over the day instead of at this instant.
   *
   * Counted ONCE per unit. A machine that started, stopped at midday and
   * started again is one operational machine, not two — the rows are per unit,
   * so the de-duplication falls out of the shape rather than needing a pass.
   */
  const worked = units.filter(
    (u) => (u.hoursToday ?? 0) > 0 || (u.distanceTodayKm ?? 0) > 0,
  );

  const hours = worked.reduce((a, u) => a + (u.hoursToday ?? 0), 0);

  return {
    operational: worked.length,
    /** The REMAINDER, so the two always add to the fleet on screen and no unit
     *  can fall between them however the states are labelled. */
    nonOperational: units.length - worked.length,
    /**
     * AVERAGE HOURS across the machines that WORKED, not across the yard.
     *
     * Ten machines running out of twenty is a fleet averaging a half-day each,
     * not a whole fleet averaging half of one. Dividing by the yard reports a
     * busy morning as an idle one, and gets worse the larger the fleet — on 218
     * units with 34 working it understates by a factor of six.
     *
     * Null, not zero, when nothing has run: no machine has averaged zero hours,
     * the fleet simply has not started.
     */
    avgHours: worked.length > 0 ? hours / worked.length : null,
    /** The numerator, for callers that want to state what the mean is over. */
    totalHours: hours,
  };
}

/**
 * The units that ran today, split by how long their engines ran.
 *
 * The fourth tile of Today on the ground for fleets that have nothing else to
 * put there: no dispatch paperwork, so no Trucks or Tractors tile, and no
 * machine families, so no early-starts chart. Hours today come off the
 * fleet-state rows every tracked organisation already has, so this is the one
 * figure every fleet can answer.
 *
 * "Ran" is `summariseToday`'s definition, so the tile and the ledger above it
 * agree. A unit that moved but logged no engine time (no ignition input wired)
 * ran, but has no hours to bucket; it is counted apart rather than filed under
 * "under 1 h", which would say something the telemetry never measured.
 *
 * @returns `null` before anything has loaded, as `summariseToday` does.
 */
/* Six bands, not four: the tile draws them as the spokes of a radar, and four
   spokes only ever make a diamond. Two-hour steps through the working day keep
   the shape readable as "short runs" against "full shifts". */
export const HOUR_BANDS = [
  { key: "lt1", label: "<1 h", lo: 0, hi: 1 },
  { key: "h1", label: "1–2 h", lo: 1, hi: 2 },
  { key: "h2", label: "2–4 h", lo: 2, hi: 4 },
  { key: "h4", label: "4–6 h", lo: 4, hi: 6 },
  { key: "h6", label: "6–8 h", lo: 6, hi: 8 },
  { key: "h8", label: "8 h+", lo: 8, hi: Infinity },
];

export function hoursRunBands(units) {
  if (!units || units.length === 0) return null;

  const counts = Object.fromEntries(HOUR_BANDS.map((b) => [b.key, 0]));
  let ran = 0;
  let movedNoHours = 0;

  for (const u of units) {
    const h = u.hoursToday ?? 0;
    if (h > 0) {
      ran++;
      const band = HOUR_BANDS.find((b) => h >= b.lo && h < b.hi);
      counts[band.key]++;
    } else if ((u.distanceTodayKm ?? 0) > 0) {
      ran++;
      movedNoHours++;
    }
  }

  return {
    units: units.length,
    ran,
    movedNoHours,
    bands: HOUR_BANDS.map((b) => ({ key: b.key, label: b.label, n: counts[b.key] })),
  };
}
