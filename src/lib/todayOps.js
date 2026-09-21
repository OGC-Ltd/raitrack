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
