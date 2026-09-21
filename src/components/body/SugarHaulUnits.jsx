/* Hallmark · component: data table + grouped run log · genre: modern-minimal
 * theme: in-project (an-* tokens, preserved)
 * states: default · hover · focus-visible · sorted · expanded · filtered
 *         · empty · loading · unmeasurable · still-out · crossed-midnight
 * redesign 2026-09-14a: the measure leads (proportional rule under the
 *         tonnage), the unit stays put while the measures scroll, and a figure
 *         standing on a subset of the runs says so in words under itself
 *         rather than as a second number beside itself.
 * redesign 2026-09-14b (RunList, the dropdown): grouped by the day the run
 *         went out. The date was printed in full TWICE per row and was most of
 *         the ink; it is a heading said once per group now, carrying that
 *         day's run count and totals, and the row keeps the pair of clocks as
 *         one span. Seven columns to five: "raised by" folded into the blank
 *         it was explaining, so a transport run's missing weight carries its
 *         own reason instead of stating the two facts a column apart.
 * pre-emit critique: P5 H5 E5 S5 R4 V5
 * contrast: pass — all ink via --ink / --text-2 / --text-3, both themes
 */

// Which units ferried the sugar, what each one moved, and when each run went.
//
// The sibling Fleet-state table answers "what is every machine doing"; this
// answers the narrower question the operation actually asks — of the units that
// took sugar out of the gate, who carried how much, how far, and at what fuel
// cost.
//
// ## Two rows deep, because they are two different questions
//
// The unit row is the summary: this truck, over the window. Opening it lists
// that truck's RUNS — each with the clock at both ends, the gate's sign-out and
// its sign-in. A window total can never answer "when did it go", and a flat log
// of every run can never answer "which truck is expensive"; the table carries
// both rather than picking one and losing the other.
//
// ## Three populations in one row, and the row says so
//
// `runs` counts the paperwork: every run signed out, whether or not the truck's
// tracker was reporting and whichever office raised it. `km` is measured, so it
// covers only the runs that produced a trip. `tonnes` covers only the runs that
// carry a weight — the provider sends one on a sales payload and none on a
// transport dispatch, so a gate whose transport team raises its own runs has
// tonnage standing on a subset of the runs beside it. Where any two of those
// differ the cell carries the count it rests on, rather than letting a reader
// divide one by the other and get a per-run figure that is quietly wrong.
//
// ## An unmeasurable figure is blank, never zero
//
// A unit whose tank could not be balanced across its runs shows "—" for L/km,
// not 0. Most often it refuelled mid-run, which makes initial-minus-final a
// statement about the tank rather than about the engine — see the server's
// tripFuelMl. A 0 there would report a truck that hauled 29 tonnes for nothing,
// and it would drag any column average with it. The same rule is why an
// unweighed transport run shows "—" tonnes and not "0 t".
//
// ## The date filter re-derives; it does not narrow a total
//
// Picking a date range filters each unit's RUNS and then computes that unit's
// figures from exactly the runs left standing — tonnage, distance, and L/km as
// a fresh ratio of totals. Scaling the window's totals down would be the easy
// version and it would be wrong: the runs inside a range are not a uniform
// slice of the window's fuel.

import { Fragment, useMemo, useState } from "react";
// The range arithmetic lives in lib beside analyticsFilter, where it is under
// test: it decides what tonnage an operator reads after picking two dates.
import { unitsInRange, totalsOf } from "../../lib/sugarHauls";

const COLS = [
  { key: "plate",       label: "Unit" },
  { key: "driver",      label: "Driver" },
  { key: "destination", label: "Destination" },
  { key: "runs",        label: "Runs",   r: true },
  { key: "tonnes",      label: "Tonnes", r: true },
  { key: "bags",        label: "Bags",   r: true },
  { key: "km",          label: "Distance", r: true },
  { key: "litresPerKm", label: "L / km", r: true },
];

/** The table is one column wider than COLS — the disclosure sits in its own. */
const SPAN = COLS.length + 1;

const FLEET_TZ = "Africa/Nairobi";

const fmt = (n, d = 1) =>
  n == null ? null : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

const NA = <span className="an-tbl__na">—</span>;

/* The date and the clock, separately.
 *
 * They used to be one string — "09 Sep 2026 · 09:58" — printed in both the
 * dispatched and the concluded column, so a three-run day spent six cells
 * saying "09 Sep 2026" and the two figures that actually differ, the times,
 * were the short tail of a long constant. The date is a heading now and the
 * clock is the cell; see RunList.
 */

/** "09 Sep 2026", in the fleet's timezone. */
const dateOf = (iso) => new Intl.DateTimeFormat("en-GB", {
  timeZone: FLEET_TZ, day: "2-digit", month: "short", year: "numeric",
}).format(new Date(iso));

/** "09:58", 24-hour, in the fleet's timezone. */
const clockOf = (iso) => new Intl.DateTimeFormat("en-GB", {
  timeZone: FLEET_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(iso));

/** A sortable fleet-day key, "2026-09-09".
 *
 *  Built from the formatter's own parts rather than by shifting the instant:
 *  the grouping and the heading above each group must agree about which day a
 *  06:00 run belongs to, and deriving both from one formatter is how they
 *  cannot drift. `en-CA` because its short date IS ISO order. */
const dayKeyOf = (iso) => new Intl.DateTimeFormat("en-CA", {
  timeZone: FLEET_TZ, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(iso));

/** Whole minutes between the two ends of a run, when it has both. */
const runMinutes = (r) =>
  r.returnedAt == null ? null
    : Math.max(0, Math.round((new Date(r.returnedAt) - new Date(r.dispatchedAt)) / 60000));

const duration = (mins) => {
  if (mins == null) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
};

export default function SugarHaulUnits({ hauls, loading }) {
  const [query, setQuery] = useState("");
  const [sort, setSort]   = useState({ key: "tonnes", dir: "desc" });
  const [from, setFrom]   = useState("");
  const [to, setTo]       = useState("");
  const [open, setOpen]   = useState(() => new Set());

  const dated = from !== "" || to !== "";

  /**
   * The window's outer dates, offered to the inputs as their own bounds.
   *
   * A picker that lets an operator choose a month the fetched window does not
   * contain answers "nothing ran" to a question about data that was never
   * asked for. The bounds keep the range inside what is on the client.
   */
  const bounds = useMemo(() => {
    const days = hauls?.days ?? [];
    return days.length ? { min: days[0].day, max: days[days.length - 1].day } : {};
  }, [hauls]);

  /**
   * Unit rows, re-derived whenever a date range is on.
   *
   * With no range the server's own rows are used unchanged — it computed them
   * over the same runs, and recomputing to get the same answer is a second
   * implementation waiting to drift from the first.
   */
  const units = useMemo(() => {
    const all = hauls?.units ?? [];
    return dated ? unitsInRange(all, from, to) : all;
  }, [hauls, dated, from, to]);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const out = units.filter(
      (u) =>
        !q ||
        u.plate.toUpperCase().includes(q) ||
        (u.driver ?? "").toUpperCase().includes(q) ||
        (u.destination ?? "").toUpperCase().includes(q),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      // Nulls sort last in BOTH directions. They are absent measurements, not
      // small ones, and letting them lead an ascending sort would put the units
      // we know least about at the top of a table about performance.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === "string" ? dir * x.localeCompare(y) : dir * (x - y);
    });
  }, [units, query, sort]);

  /** Totals over what is on screen, so the foot and the rows agree. */
  const totals = useMemo(() => {
    if (!dated && !query.trim()) return hauls?.totals;
    return totalsOf(rows);
  }, [hauls, rows, dated, query]);

  const origin = hauls?.origin;

  const onSort = (key) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );

  const toggle = (plate) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(plate)) next.delete(plate); else next.add(plate);
      return next;
    });

  const clearDates = () => { setFrom(""); setTo(""); };

  /* The heaviest hauler in what is on screen, which is what the tonnage rule in
   * each row is drawn against.
   *
   * Off `rows` rather than off the window, so it follows the search and the
   * dates: a rule scaled to a unit the filter has removed would leave every
   * visible row short and say nothing about the units being compared. Ranking
   * is the whole job of the rule — it is a ratio of two real figures, never a
   * score — so a table with no tonnage anywhere draws none of them. */
  const topTonnes = useMemo(
    () => rows.reduce((m, u) => (u.tonnes != null && u.tonnes > m ? u.tonnes : m), 0),
    [rows],
  );

  return (
    <div className="an-card an-card--wide an-fleet">
      <div className="an-card__head">
        <span className="an-card__title">
          Units Ferrying Sugar{origin ? ` from ${origin}` : ""}
        </span>
        <span className="an-card__hint">
          {totals?.runs > 0
            ? `${fmt(totals.units, 0)} unit${totals.units === 1 ? "" : "s"}${
                totals.tonnes != null ? ` · ${fmt(totals.tonnes)} t` : ""
              }`
            : "—"}
        </span>
      </div>

      {!hauls ? (
        <div className="an-tbl__empty">
          {/* See SugarTonnageChart: "not yet fetched" and "this server has no
              such route" are different facts and one of them never resolves. */}
          {loading
            ? "Reading gate runs…"
            : "Gate-run data is not available from this server yet."}
        </div>
      ) : (hauls.units ?? []).length === 0 ? (
        <div className="an-tbl__empty">
          No unit has carried sugar out of the gate in this window.
        </div>
      ) : (
        <>
          <div className="an-fleet__bar">
            <div className="an-fleet__search">
              <input
                className="an-fleet__input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by unit, driver or destination"
                aria-label="Filter sugar hauls"
              />
            </div>

            {/* Two bare date inputs rather than a range widget. The question is
                "between these dates", both halves are optional, and the native
                control already carries a calendar, a keyboard path and the
                operator's own locale. */}
            <div className="an-dates">
              <label className="an-dates__f">
                <span>From</span>
                <input
                  type="date"
                  className="an-dates__in"
                  value={from}
                  min={bounds.min}
                  max={to || bounds.max}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="an-dates__f">
                <span>To</span>
                <input
                  type="date"
                  className="an-dates__in"
                  value={to}
                  min={from || bounds.min}
                  max={bounds.max}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              {dated && (
                <button type="button" className="an-dates__clear" onClick={clearDates}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="an-fleet__scroll">
            <table className="an-tbl an-tbl--runs">
              <thead>
                <tr>
                  <th className="an-tbl__disc" aria-label="Expand runs" />
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      className={[c.r ? "r" : "", sort.key === c.key ? "is-sorted" : ""]
                        .filter(Boolean).join(" ") || undefined}
                      aria-sort={sort.key === c.key
                        ? (sort.dir === "asc" ? "ascending" : "descending")
                        : "none"}
                    >
                      <button
                        type="button"
                        className="an-tbl__sort"
                        onClick={() => onSort(c.key)}
                        aria-label={`Sort by ${c.label}`}
                      >
                        {c.label}
                        <span
                          className={[
                            "an-tbl__caret",
                            sort.key === c.key
                              ? sort.dir === "asc"
                                ? "an-tbl__caret--asc"
                                : "an-tbl__caret--desc"
                              : "",
                          ].filter(Boolean).join(" ")}
                        />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isOpen = open.has(u.plate);
                  return (
                    <Fragment key={u.plate}>
                      <tr
                        className={isOpen ? "an-tbl__row--open" : undefined}
                        /* 0-1 of the heaviest visible hauler. The cell draws
                           its own rule from this; no width is computed in JS. */
                        style={
                          u.tonnes != null && topTonnes > 0
                            ? { "--u-share": u.tonnes / topTonnes }
                            : undefined
                        }
                      >
                        <td className="an-tbl__disc">
                          <button
                            type="button"
                            className={"an-tbl__toggle" + (isOpen ? " an-tbl__toggle--on" : "")}
                            onClick={() => toggle(u.plate)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} the ${u.runs} run${
                              u.runs === 1 ? "" : "s"
                            } for ${u.plate}`}
                          >
                            <span className="an-tbl__chev" aria-hidden="true" />
                          </button>
                        </td>
                        <td className="an-tbl__plate">{u.plate}</td>
                        <td>{u.driver ?? NA}</td>
                        <td>
                          {u.destination ?? NA}
                          {u.destinations > 1 && (
                            <span className="an-tbl__cat">+{u.destinations - 1}</span>
                          )}
                        </td>
                        <td className="r">{fmt(u.runs, 0)}</td>
                        <td className="r an-tbl__measure">
                          <span className="an-tbl__fig">
                            {u.tonnes == null ? NA : fmt(u.tonnes)}
                          </span>
                          {/* Only when the tonnage rests on fewer runs than the
                              row counts — saying "3 of 3 weighed" everywhere is
                              noise, and on a pure sales gate it always would.
                              In words, under the figure: as "3/5" beside it, at
                              10px and right-aligned, it read as part of the
                              number rather than as a caveat about it. */}
                          {u.tonnes != null && u.runsWeighed < u.runs && (
                            <span className="an-tbl__rests">
                              {u.runsWeighed} of {u.runs} weighed
                            </span>
                          )}
                          {/* The rule. Drawn only where there is a tonnage to
                              rank, and hidden from the reading order — it is
                              the figure above it, said again as a length. */}
                          {u.tonnes != null && <i className="an-tbl__rule" aria-hidden="true" />}
                        </td>
                        <td className="r">{u.bags == null ? NA : fmt(u.bags, 0)}</td>
                        <td className="r an-tbl__measure">
                          <span className="an-tbl__fig">
                            {u.km == null ? NA : `${fmt(u.km)} km`}
                          </span>
                          {u.km != null && u.runsMeasured < u.runs && (
                            <span className="an-tbl__rests">
                              {u.runsMeasured} of {u.runs} measured
                            </span>
                          )}
                        </td>
                        <td className="r">{u.litresPerKm == null ? NA : fmt(u.litresPerKm, 2)}</td>
                      </tr>

                      {isOpen && (
                        <tr className="an-tbl__runs">
                          <td colSpan={SPAN}>
                            <RunList runs={u.history ?? []} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td className="an-tbl__empty" colSpan={SPAN}>
                      {query.trim()
                        ? `Nothing matches “${query}”.`
                        : "No run in these dates."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </>
      )}
    </div>
  );
}

/**
 * A unit's runs, grouped by the day they went out.
 *
 * ## The date was most of the ink
 *
 * This was a flat table with a Dispatched column and a Concluded column, each
 * printing a full "09 Sep 2026 · 09:58". Two consequences, both bad. A unit
 * that ran three times on one day spent six cells repeating that date, and
 * what varied — the times — was four characters at the end of a nineteen-
 * character string, which is the hardest place in a cell for the eye to find
 * anything. And the runs had no visible shape: a log of twelve rows over four
 * days looked exactly like a log of twelve rows in one afternoon.
 *
 * The date is a heading over its own group now, said once, with that day's
 * totals beside it. The row keeps the pair of clocks — "09:58 → 14:20" — which
 * is the one thing the summary row above can never answer, and reads as a span
 * rather than as two independent stamps.
 *
 * Days run newest first, because a unit's recent work is what is being looked
 * for. Runs INSIDE a day run earliest first, because within a day the question
 * changes to how the shift went, and a shift is read forwards.
 *
 * ## The office that raised the run moved into the load
 *
 * It had a column of its own, and it was really a caveat about the column
 * beside it: only the sales office records a weight, so a transport run's
 * tonnage is blank, and the two facts were being stated a column apart. The
 * blank now carries its own reason — "—" with `transport` under it — which is
 * the same rule the summary table above already follows, where a figure
 * standing on a subset of its runs says so in words beneath itself.
 *
 * That also buys a column back. This table renders inside a cell spanning the
 * summary table, which already scrolls horizontally on a laptop; six columns
 * fit where seven did not.
 *
 * ## A run still out is not a missing timestamp
 *
 * Unchanged in substance and louder in form: an empty cell reads as data we
 * lost, and this is a truck on the road. It says so where its conclusion would
 * be, and the duration beside it is blank rather than counted up to now —
 * a run that has not ended has no length yet.
 */
function RunList({ runs }) {
  const days = useMemo(() => {
    const byDay = new Map();
    for (const r of runs) {
      const key = dayKeyOf(r.dispatchedAt);
      const g = byDay.get(key);
      if (g) g.runs.push(r);
      else byDay.set(key, { key, label: dateOf(r.dispatchedAt), runs: [r] });
    }
    for (const g of byDay.values()) {
      g.runs.sort((a, b) => new Date(a.dispatchedAt) - new Date(b.dispatchedAt));
      /* The day's own totals, summed over the runs standing in it — not a
         share of the unit's window total. A day with two weighed runs and one
         transport run totals the two, and says nothing about the third. */
      g.tonnes = g.runs.reduce((t, r) => (r.tonnes == null ? t : (t ?? 0) + r.tonnes), null);
      g.km     = g.runs.reduce((t, r) => (r.km == null ? t : (t ?? 0) + r.km), null);
      g.open   = g.runs.some((r) => !r.returnedAt);
    }
    return [...byDay.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [runs]);

  if (runs.length === 0) {
    return <div className="an-runs__empty">No run recorded for this unit.</div>;
  }

  return (
    <table className="an-runs">
      <thead>
        <tr>
          <th>Out → back</th>
          <th className="r">Duration</th>
          <th>Destination</th>
          <th className="r">Tonnes</th>
          <th className="r">Distance</th>
        </tr>
      </thead>
      {/* One tbody per day. A heading ROW inside the table rather than a
          separate element above it, so the columns under every heading stay on
          one set of widths — a stack of little tables would let each day size
          its own columns and the figures would stop lining up down the card. */}
      {days.map((g) => (
        <tbody key={g.key} className="an-runs__day">
          <tr className="an-runs__dayrow">
            <th className="an-runs__date" scope="colgroup" colSpan={3}>
              {g.label}
              <span className="an-runs__count">
                {g.runs.length} run{g.runs.length === 1 ? "" : "s"}
                {g.open && <span className="an-runs__open"> · one still out</span>}
              </span>
            </th>
            {/* The day's totals sit in the columns they total, so the heading
                row is readable as a footer for the rows under it without
                labelling either figure twice. */}
            <th className="an-runs__daytot r">{g.tonnes == null ? "" : `${fmt(g.tonnes)} t`}</th>
            <th className="an-runs__daytot r">{g.km == null ? "" : `${fmt(g.km)} km`}</th>
          </tr>

          {g.runs.map((r) => {
            const mins = runMinutes(r);
            return (
              <tr key={r.id}>
                <td className="an-runs__span">
                  <span className="an-runs__at">{clockOf(r.dispatchedAt)}</span>
                  <span className="an-runs__arrow" aria-hidden="true">→</span>
                  {r.returnedAt
                    ? <span className="an-runs__at">{clockOf(r.returnedAt)}</span>
                    : <span className="an-runs__open">still out</span>}
                  {/* A run that crossed midnight ends on a date its heading
                      does not name, and "23:40 → 02:15" alone would read as a
                      truck that came back before it left. */}
                  {r.returnedAt && dayKeyOf(r.returnedAt) !== g.key && (
                    <span className="an-runs__next">+{dateOf(r.returnedAt).slice(0, 6)}</span>
                  )}
                </td>
                <td className="r">{duration(mins) ?? NA}</td>
                <td className="an-runs__dest">{r.destination ?? NA}</td>
                <td className="r an-runs__load">
                  <span>{r.tonnes == null ? NA : `${fmt(r.tonnes)} t`}</span>
                  {/* Only where the weight is missing. On a sales run the
                      figure speaks for itself and a badge saying so on every
                      row would be forty repetitions of the default. */}
                  {r.tonnes == null && r.kind !== "SALES" && (
                    <span className="an-runs__by an-runs__by--cane">transport</span>
                  )}
                </td>
                <td className="r">{r.km == null ? NA : `${fmt(r.km)} km`}</td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}
