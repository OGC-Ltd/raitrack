/* The Analytics page's two filters, in the row that already held the month.
 *
 * ## The window control has two modes and one default
 *
 * MONTH is the default and stays the default. The reasoning behind it has not
 * changed — this fleet works about 8 days in any 30, so a trailing 30/90-day
 * picker drew mostly structural zeroes and read as a fleet that had stopped —
 * and a whole month is still the window nearly every question is asked about.
 *
 * RANGE exists because a month cannot answer "what happened over the harvest
 * fortnight". It is a second mode rather than a replacement: dropping the month
 * grid would cost the one-click paging that makes month-over-month comparison
 * possible, to serve the rarer question.
 *
 * ## There are TWO vehicle controls, and they narrow independently
 *
 * TYPE answers "how do the excavators compare", UNIT answers "how did this
 * lorry do" — and no list of machine families expresses the second, which is
 * why a second control exists rather than a longer first one. Both are
 * multi-selects, both treat empty as the whole fleet, and the server
 * intersects them: the units you picked, among the types you left ticked.
 *
 * The unit control carries a SEARCH BOX and the type control does not. That is
 * not a difference in polish, it is a difference in cardinality: a fleet offers
 * five to twenty-five types and two hundred and eighteen units, and a
 * two-hundred-row list you can only scroll is a list you cannot use to find one
 * plate.
 *
 * ## The type control is a MULTI-select, and empty means everything
 *
 * Empty-means-all rather than all-ticked-by-default: with 25 machine families
 * on this fleet, "all ticked" makes the common case a wall of chips and makes
 * clearing the filter a 25-click operation. Empty also matches what the server
 * does with an absent `categories` parameter, so the control's resting state is
 * literally the request the page made before this filter existed — which is
 * what keeps the default view on the warm cache.
 *
 * Options come from the fleet, never from a list in the source. The vocabulary
 * is per-fleet and grows without warning; a hard-coded list would silently drop
 * whatever the provider adds next.
 */

import { Fragment, useState, useRef, useEffect } from "react";
import MonthPicker, { monthLabelOf } from "../header/MonthPicker";
import { machineCategoryLabel } from "../../lib/vehicleMap";
import { spanDays } from "../../lib/analyticsFilter";
import "./AnalyticsFilterBar.css";

const fmt = (n) => Number(n ?? 0).toLocaleString();

/** Closes a popover on an outside click or Escape — the idiom MonthPicker
 *  already uses, so the two controls in this row dismiss the same way. */
function useDismiss(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    const onEscape = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, close]);
  return ref;
}

/**
 * The vehicle-type filter.
 *
 * WHETHER THIS FLEET HAS A MACHINE VOCABULARY AT ALL is decided by the caller,
 * which passes null for a haulage fleet — see the note on `isPlantFleet` in
 * AnalyticsScreen. It cannot be decided here from the options: a plate prefix
 * exists on every plate, so SUKARI would arrive with a healthy-looking five
 * entries that are registration series rather than machine types.
 *
 * The length guard below is only the degenerate case — one option filters
 * nothing, so the control would be furniture.
 */
function VehicleTypeFilter({ options, value, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  if (!options || options.length < 2) return null;

  const selected = new Set(value);

  const total = options.reduce((a, o) => a + o.units, 0);
  const shown = value.length
    ? options.filter((o) => selected.has(o.category)).reduce((a, o) => a + o.units, 0)
    : total;

  const label = value.length === 0
    ? "All vehicles"
    : value.length === 1
      ? machineCategoryLabel(value[0])
      : `${value.length} types`;

  return (
    <div className="an-filter" ref={ref}>
      <button
        type="button"
        className={`an-filter__trigger${open ? " an-filter__trigger--open" : ""}${value.length ? " an-filter__trigger--on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Vehicle type filter: ${label}. Change`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
        <span className="an-filter__value">{label}</span>
        {/* The unit count travels with the label so the filter always says how
            much of the fleet is behind the figures below it. Without it a
            reader has no way to tell a narrow selection from a wide one. */}
        <span className="an-filter__count">{fmt(shown)}</span>
        <span className={`an-filter__chevron${open ? " an-filter__chevron--open" : ""}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="an-filter__panel" role="dialog" aria-label="Choose vehicle types">
          <div className="an-filter__panelhead">
            <span>Vehicle type</span>
            <button
              type="button"
              className="an-filter__clear"
              onClick={onClear}
              disabled={value.length === 0}
            >Clear</button>
          </div>
          <div className="an-filter__list">
            {options.map((o) => {
              const on = selected.has(o.category);
              return (
                <button
                  type="button"
                  key={o.category}
                  className={`an-filter__opt${on ? " an-filter__opt--on" : ""}`}
                  onClick={() => onToggle(o.category)}
                  role="checkbox"
                  aria-checked={on}
                >
                  <span className="an-filter__box" aria-hidden="true">{on ? "✓" : ""}</span>
                  <span className="an-filter__name">{machineCategoryLabel(o.category)}</span>
                  <span className="an-filter__n">{fmt(o.units)}</span>
                </button>
              );
            })}
          </div>
          <div className="an-filter__foot">
            {value.length === 0
              ? `All ${fmt(total)} units`
              : `${fmt(shown)} of ${fmt(total)} units`}
          </div>
        </div>
      )}
    </div>
  );
}

/* Hallmark · component: filter popover · genre: modern-minimal · theme: in-project
 * states: default · hover · focus-visible · active · open · empty · searching
 *         · no-match · selected
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · contrast: pass, both themes
 */

/**
 * The UNIT filter — one vehicle, or several.
 *
 * Deliberately the same control as the type filter beside it, down to the class
 * names: two pickers on one bar that look like two different ideas are two
 * things to learn instead of one. What it adds is a search box, for the reason
 * in the header — and the search is over the PLATE and the TYPE together, so
 * "EX" finds every excavator and "26" finds the one you meant.
 *
 * Options come from the page's fleet-state feed, which is already loaded and
 * already carries every unit's id, plate and family. A list endpoint of its own
 * would be a second source that could disagree with the counts on the control
 * next to it.
 *
 * ORDER IS PART OF THE CONTROL. The units that did something in this window come
 * first (see `unitOptions`), and the boundary is DRAWN rather than left for a
 * reader to infer — an order nobody announced is an order nobody trusts, and the
 * units below the line are the ones whose page comes back all zeroes. They are
 * still listed, and still selectable: "why is this machine showing nothing" is a
 * real question, and a filter that could not ask it would be answering it by
 * hiding the evidence.
 */
function UnitFilter({ options, value, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useDismiss(open, () => setOpen(false));
  const searchRef = useRef(null);

  // The box is the reason the panel is usable on a 218-unit fleet, so it takes
  // the caret as the panel opens rather than waiting to be clicked.
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  // A fleet with one unit has nothing to choose between; on a fleet with none
  // the control would be furniture over an empty list.
  if (!options || options.length < 2) return null;

  const selected = new Set(value);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter(
        (o) => o.plate.toLowerCase().includes(needle)
            || machineCategoryLabel(o.category).toLowerCase().includes(needle),
      )
    : options;
  // Where the worked units stop and the silent ones begin, in the list as it
  // is actually being shown — a search that matches only silent units must not
  // print a heading over the first row of its results.
  const firstSilent = shown.findIndex((o) => o.silent);
  const silentFrom = firstSilent > 0 ? shown[firstSilent].id : null;
  const worked = shown.length - (firstSilent < 0 ? 0 : shown.length - firstSilent);

  const label = value.length === 0
    ? "All units"
    : value.length === 1
      ? (options.find((o) => o.id === value[0])?.plate ?? "1 unit")
      : `${value.length} units`;

  return (
    <div className="an-filter" ref={ref}>
      <button
        type="button"
        className={`an-filter__trigger${open ? " an-filter__trigger--open" : ""}${value.length ? " an-filter__trigger--on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Unit filter: ${label}. Change`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17h2l1-5h12l1 5h2" /><path d="M7 12l1.4-4.2A2 2 0 0 1 10.3 6h3.4a2 2 0 0 1 1.9 1.8L17 12" />
          <circle cx="7.5" cy="18.5" r="1.5" /><circle cx="16.5" cy="18.5" r="1.5" />
        </svg>
        <span className="an-filter__value">{label}</span>
        {/* Same as the type control's: the bar always says how much of the
            fleet is behind the figures below it. */}
        <span className="an-filter__count">{fmt(value.length || options.length)}</span>
        <span className={`an-filter__chevron${open ? " an-filter__chevron--open" : ""}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="an-filter__panel an-filter__panel--units" role="dialog" aria-label="Choose units">
          <div className="an-filter__panelhead">
            <span>Unit</span>
            <button
              type="button"
              className="an-filter__clear"
              onClick={onClear}
              disabled={value.length === 0}
            >Clear</button>
          </div>
          <input
            ref={searchRef}
            type="search"
            className="an-filter__search"
            placeholder="Find a plate…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Find a unit by plate or type"
          />
          <div className="an-filter__list">
            {shown.map((o) => {
              const on = selected.has(o.id);
              return (
                <Fragment key={o.id}>
                  {o.id === silentFrom && (
                    /* Not a disabled group and not a collapsed one: these units
                       are selectable, and the heading is there so that picking
                       one is a decision rather than a surprise. */
                    <p className="an-filter__group">
                      Nothing recorded in this window
                    </p>
                  )}
                  <button
                    type="button"
                    className={`an-filter__opt${on ? " an-filter__opt--on" : ""}${o.silent ? " an-filter__opt--silent" : ""}`}
                    onClick={() => onToggle(o.id)}
                    role="checkbox"
                    aria-checked={on}
                  >
                    <span className="an-filter__box" aria-hidden="true">{on ? "✓" : ""}</span>
                    <span className="an-filter__name">{o.plate}</span>
                    <span className="an-filter__n">{machineCategoryLabel(o.category)}</span>
                  </button>
                </Fragment>
              );
            })}
            {/* A search that matches nothing must say so. An empty list under a
                box you have just typed into reads as a broken control. */}
            {shown.length === 0 && (
              <p className="an-filter__none">No unit matches “{q.trim()}”.</p>
            )}
          </div>
          <div className="an-filter__foot">
            {value.length === 0
              ? `All ${fmt(options.length)} units`
              : `${fmt(value.length)} of ${fmt(options.length)} units`}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The window control: a month, or an explicit from–to range.
 *
 * The range inputs are bounded by the same `min`/`max` the month grid is, and
 * for the same reason — months before the record are not quiet months, they are
 * outside the data, and a range reaching into them would draw a fleet that
 * stood still for a year.
 */
function DateWindowPicker({ filter, onChange, minMonth, maxMonth, today }) {
  const minDay = `${minMonth}-01`;
  const isRange = filter.mode === "range";

  // Functional, like the type toggles — every handler on this bar derives the
  // next filter from the CURRENT one rather than from the render it was built
  // in, so no two interactions can race and drop one another.
  const setMode = (mode) => {
    if (mode === filter.mode) return;
    onChange((prev) => {
      if (mode !== "range") return { ...prev, mode };
      // Seeded from the month currently on screen rather than from nothing, so
      // switching modes shows the same window in a different control instead of
      // blanking every card until two dates are picked.
      const len = prev.month === today.slice(0, 7)
        ? Number(today.slice(8, 10))
        : new Date(Date.UTC(...prev.month.split("-").map(Number), 0)).getUTCDate();
      return {
        ...prev,
        mode,
        from: `${prev.month}-01`,
        to: prev.month === today.slice(0, 7)
          ? today
          : `${prev.month}-${String(len).padStart(2, "0")}`,
      };
    });
  };

  return (
    <div className="an-window">
      <div className="an-window__modes" role="group" aria-label="Window type">
        <button
          type="button"
          className={`an-window__mode${!isRange ? " an-window__mode--on" : ""}`}
          onClick={() => setMode("month")}
          aria-pressed={!isRange}
        >Month</button>
        <button
          type="button"
          className={`an-window__mode${isRange ? " an-window__mode--on" : ""}`}
          onClick={() => setMode("range")}
          aria-pressed={isRange}
        >Range</button>
      </div>

      {isRange ? (
        <div className="an-window__range">
          <input
            type="date"
            className="an-window__date"
            value={filter.from ?? ""}
            min={minDay}
            max={filter.to || today}
            onChange={(e) => { const v = e.target.value; onChange((prev) => ({ ...prev, from: v })); }}
            aria-label="Window start date"
          />
          <span className="an-window__arrow" aria-hidden="true">→</span>
          <input
            type="date"
            className="an-window__date"
            value={filter.to ?? ""}
            min={filter.from || minDay}
            max={today}
            onChange={(e) => { const v = e.target.value; onChange((prev) => ({ ...prev, to: v })); }}
            aria-label="Window end date"
          />
          {filter.from && filter.to && (
            <span className="an-window__span">
              {(() => {
                const n = Math.max(1, spanDays(filter.from, filter.to > today ? today : filter.to));
                return `${fmt(n)} day${n === 1 ? "" : "s"}`;
              })()}
            </span>
          )}
        </div>
      ) : (
        <MonthPicker
          value={filter.month}
          min={minMonth}
          max={maxMonth}
          onChange={(month) => onChange((prev) => ({ ...prev, month }))}
        />
      )}
    </div>
  );
}

/**
 * @param filter    `{ mode, month, from, to, categories, vehicles }`
 * @param options   the fleet's machine families, from /vehicle-categories
 * @param units     every unit in the fleet — `{ id, plate, category }` — from
 *                  the page's own fleet-state feed. Null or a single entry
 *                  hides the unit control rather than showing a choice of one.
 */
export default function AnalyticsFilterBar({
  filter, onChange, options, units, minMonth, maxMonth, today, children, updating,
}) {
  return (
    <div className="an-filterbar">
      <DateWindowPicker
        filter={filter}
        onChange={onChange}
        minMonth={minMonth}
        maxMonth={maxMonth}
        today={today}
      />
      {/* Both handlers are FUNCTIONAL updates, computed from the filter as it
          is at the moment they run rather than from the `filter` this render
          closed over.

          Two ticks in quick succession otherwise both read the pre-update prop
          and the first is lost: deselecting Excavator and selecting Cane
          Tractor in the same breath left BOTH ticked — 50 units under a control
          that had been told to show 18. */}
      <VehicleTypeFilter
        options={options}
        value={filter.categories}
        onToggle={(code) => onChange((prev) => {
          const next = new Set(prev.categories);
          if (next.has(code)) next.delete(code); else next.add(code);
          return { ...prev, categories: [...next] };
        })}
        onClear={() => onChange((prev) => ({ ...prev, categories: [] }))}
      />
      {/* Functional for the same reason, and it matters more here: ticking
          three plates in quick succession is the ordinary way this control is
          used. */}
      <UnitFilter
        options={units}
        value={filter.vehicles ?? []}
        onToggle={(id) => onChange((prev) => {
          const next = new Set(prev.vehicles ?? []);
          if (next.has(id)) next.delete(id); else next.add(id);
          return { ...prev, vehicles: [...next] };
        })}
        onClear={() => onChange((prev) => ({ ...prev, vehicles: [] }))}
      />
      {/* Says the figures below are still the previous selection's.
      
          The cards deliberately keep their last good numbers while a new
          window loads instead of blanking — but numbers from the whole fleet
          sitting silently under a heading that names one machine family would
          be worse than the blank was. This is the half that makes that
          trade-off honest, so it is not decoration and must not be dropped. */}
      {updating && (
        <span className="an-updating" role="status" aria-live="polite">
          <span className="an-updating__dot" aria-hidden="true" />
          Updating…
        </span>
      )}
      {/* The report button and anything else the header carries. */}
      <div className="an-filterbar__tail">{children}</div>
    </div>
  );
}

export { monthLabelOf };
