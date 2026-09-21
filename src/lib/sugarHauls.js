/**
 * Narrowing the sugar-haul table to a date range.
 *
 * Lives beside `analyticsFilter` for the same reason that one does: it is the
 * arithmetic behind what an operator sees after touching a control, and a
 * decision that changes a reported tonnage should be pinned by a test rather
 * than buried in a component's render path.
 *
 * ## Re-derive; never scale
 *
 * A range filters each unit's RUNS and then recomputes that unit's figures from
 * exactly the runs left standing. The tempting shortcut — take the window's
 * totals and scale them by the fraction of days chosen — is wrong on every
 * column: runs are not evenly spread, and litres per kilometre is a ratio whose
 * two halves move independently.
 *
 * ## The three populations survive the filter
 *
 * `runs` is the paperwork, `runsWeighed` the runs carrying a tonnage, and
 * `runsMeasured` the runs a trip was built from. They differ inside a range
 * exactly as they differ over the window — a transport run has no weight in
 * either — so each is counted here rather than assumed equal to `runs`.
 */

const FLEET_TZ = "Africa/Nairobi";

/**
 * The fleet-local calendar day an instant belongs to, as YYYY-MM-DD.
 *
 * The date inputs speak calendar days and a run carries a UTC instant, so the
 * comparison has to happen in the fleet's own timezone. Compared as STRINGS
 * afterwards, which is safe only because the format is zero-padded and
 * big-endian — the same reason the server keys its day buckets this way.
 */
export const fleetDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: FLEET_TZ }).format(new Date(iso));

/**
 * Runs whose SIGN-OUT falls inside the range. Either end may be blank.
 *
 * Keyed on the dispatch and not on the return: a run is dated by the day it
 * went out, which is the day it appears under on the tonnage chart beside this
 * table. Keying on the return would move an overnight haul onto the next day on
 * one surface and not the other.
 */
export function runsInRange(runs, from, to) {
  if (!from && !to) return runs ?? [];
  return (runs ?? []).filter((r) => {
    const day = fleetDay(r.dispatchedAt);
    return (!from || day >= from) && (!to || day <= to);
  });
}

/**
 * A unit's figures over a set of runs.
 *
 * Mirrors the server's own aggregation, including litres per kilometre as a
 * RATIO OF TOTALS rather than a mean of per-run rates: a 2 km repositioning
 * move and a 240 km haul are not two equal opinions about what a kilometre
 * costs, and averaging the two rates gives the short move equal say.
 *
 * Null, never zero, wherever the population behind a figure is empty. A unit
 * whose runs were all unweighed did not carry nothing.
 */
export function aggregateRuns(plate, runs) {
  let tonnes = 0, bags = 0, weighed = 0, measured = 0, km = 0, litres = 0, kmForFuel = 0;
  const dests = new Map();
  let driver = null;
  let lastRunAt = null;

  for (const r of runs) {
    if (r.tonnes != null) { weighed += 1; tonnes += r.tonnes; bags += r.bags ?? 0; }
    if (r.km != null)     { measured += 1; km += r.km; }
    if (r.litres != null && r.km > 0) { litres += r.litres; kmForFuel += r.km; }
    if (r.destination) dests.set(r.destination, (dests.get(r.destination) ?? 0) + 1);
    // Newest crew wins, as it does on the server: the provider names whoever
    // took the keys, and the newest is the one an operator is asking about.
    if (lastRunAt == null || r.dispatchedAt >= lastRunAt) {
      lastRunAt = r.dispatchedAt;
      driver = r.driver ?? driver;
    }
  }

  return {
    plate,
    driver,
    destination: [...dests.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    destinations: dests.size,
    runs: runs.length,
    runsMeasured: measured,
    runsWeighed: weighed,
    tonnes: weighed > 0 ? Math.round(tonnes * 10) / 10 : null,
    bags:   weighed > 0 ? bags : null,
    km:     measured > 0 ? Math.round(km * 10) / 10 : null,
    litresPerKm: kmForFuel > 0 ? Math.round((litres / kmForFuel) * 100) / 100 : null,
    lastRunAt,
    history: runs,
  };
}

/**
 * The unit rows for a date range.
 *
 * A unit with no run inside the range is dropped rather than shown as a row of
 * dashes: it is not a unit that carried nothing in those days, it is a unit the
 * question does not concern.
 */
export function unitsInRange(units, from, to) {
  return (units ?? [])
    .map((u) => {
      const runs = runsInRange(u.history, from, to);
      return runs.length ? aggregateRuns(u.plate, runs) : null;
    })
    .filter(Boolean);
}

/**
 * Totals across the rows on screen, so the footer and the table agree.
 *
 * Summed over the ROWS rather than over the server's own totals, because a
 * search box can narrow the rows without narrowing anything the server sent.
 */
export function totalsOf(rows) {
  let runs = 0, runsWeighed = 0, tonnes = 0, bags = 0, km = 0, measured = 0;
  for (const u of rows) {
    runs += u.runs;
    runsWeighed += u.runsWeighed;
    tonnes += u.tonnes ?? 0;
    bags   += u.bags ?? 0;
    if (u.km != null) { km += u.km; measured += 1; }
  }
  return {
    runs,
    runsWeighed,
    units: rows.length,
    tonnes: runsWeighed > 0 ? Math.round(tonnes * 10) / 10 : null,
    bags:   runsWeighed > 0 ? bags : null,
    km:     measured > 0 ? Math.round(km * 10) / 10 : null,
  };
}
