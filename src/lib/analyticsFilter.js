/* The Analytics page's filter, in one place.
 *
 * Three controls — a WINDOW (a whole month, or an explicit from–to range), a
 * set of VEHICLE TYPES, and a set of UNITS — and one rule about how they reach
 * each card:
 *
 *   · The window becomes `{ days, to }`, which is the shape every analytics
 *     endpoint already takes. No endpoint learned a new date contract.
 *   · The types become `categories` and the units become `vehicles`, both of
 *     which the server resolves to vehicle ids for the aggregates it has to
 *     recompute (deliveries, fuel cost, machine summary, area-by-day, fuel
 *     rates, operations-today).
 *
 * THE TWO VEHICLE SELECTIONS INTERSECT — the units you picked, among the types
 * you left ticked — and the rule lives on the server, in vehicle-filter, so
 * there is one definition of what a filtered figure describes. This module only
 * carries the selections and applies the same intersection to the feeds it
 * narrows in the browser.
 *
 * THE FEEDS THAT ARE FILTERED HERE INSTEAD, and why that is not an
 * inconsistency: /fleet-state, /machine-starts and /excavator-area already
 * answer at per-unit or per-category grain — the whole fleet's rows are on the
 * wire either way. Filtering those in the browser keeps them on the server's
 * WARM CACHE, which matters twice over: they are the feeds this page polls
 * every sixty seconds, and the page shares a 100-request-a-minute budget with
 * every other card on it. Sending a filtered request for data we are already
 * holding would spend a request and a live query to be handed a subset of
 * bytes we could compute for free.
 *
 * The category rule is the server's machinePrefix, and it is not reimplemented
 * here: fleet-state labels every unit with it, machine-starts groups by it, and
 * this module only ever compares those labels.
 */

import { UNPREFIXED_CODE } from "./vehicleMap";

export { UNPREFIXED_CODE };

/** Y-M-D of `now` in a timezone. en-CA gives YYYY-MM-DD. */
const ymd = (tz, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

export const monthKeyOf = (iso) => iso.slice(0, 7);

/** Calendar length of "YYYY-MM". Day 0 of the next month is the last of this. */
export const daysInMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const DAY_MS = 86_400_000;
const asUtc = (iso) => new Date(`${iso}T00:00:00Z`).getTime();

/** Whole days from `from` to `to`, inclusive of both ends. */
export const spanDays = (from, to) =>
  Math.floor((asUtc(to) - asUtc(from)) / DAY_MS) + 1;

/**
 * The `{ days, to }` an endpoint wants, for either kind of window.
 *
 * ## The current month, and any range ending today, send NO `to`
 *
 * That is the path the server serves from its warmed cache — an explicit
 * anchor is an unbounded key space and computes live — and it is the window
 * every visitor loads. `days=N` with no anchor is exactly "the N days ending
 * today", so a custom range that happens to end today is the same request as
 * the equivalent trailing window and gets the same cached answer.
 *
 * ## A past window anchors at MIDDAY on its last day
 *
 * Not midnight and not 23:59. The server takes the fleet-day the anchor falls
 * in, and midday is the only choice that lands on the intended date whichever
 * way a boundary instant gets nudged by an offset.
 */
export function windowFor(filter, tz, now = new Date()) {
  const today = ymd(tz, now);
  if (filter.mode === "range") {
    const { from, to } = filter;
    if (!from || !to) return { days: 30, to: undefined };
    // A range running past today is clamped to it: the fleet has no readings
    // from the future, and the extra cells would draw as days it stood still.
    const end = to > today ? today : to;
    const days = Math.max(1, spanDays(from, end));
    return { days, to: end === today ? undefined : `${end}T12:00:00+03:00` };
  }
  const key = filter.month;
  if (key === monthKeyOf(today)) return { days: Number(today.slice(8, 10)), to: undefined };
  const len = daysInMonth(key);
  return { days: len, to: `${key}-${String(len).padStart(2, "0")}T12:00:00+03:00` };
}

/**
 * The `{ from, to }` an INCIDENT endpoint wants, as ISO instants.
 *
 * A separate function from `windowFor` rather than a change to it. That one
 * returns `{ days, to }` — a trailing window with an optional anchor — because
 * that is the shape the analytics endpoints and their warm cache take, and six
 * cards depend on it. The incident reports take an explicit half-open range
 * instead: they read a ledger by `started_at`, and "30 days ending today" is
 * not expressible as an index scan without first turning it into two instants.
 *
 * Both derive from the SAME filter, the same MONTH/RANGE modes and the same
 * clamp-to-today rule, so the month picker cannot mean one thing to a chart and
 * another to the table beneath it.
 *
 * `to` is the END of its last day, not midnight at its start — a month whose
 * `to` was `2026-09-30T00:00` would silently drop everything that happened on
 * the 30th.
 */
export function rangeFor(filter, tz, now = new Date()) {
  const today = ymd(tz, now);

  if (filter.mode === "range") {
    const { from, to } = filter;
    if (!from || !to) {
      // Same default as windowFor's: the trailing 30 days.
      const end = today;
      const start = new Date(asUtc(end) - 29 * DAY_MS).toISOString().slice(0, 10);
      return { from: `${start}T00:00:00+03:00`, to: `${end}T23:59:59+03:00` };
    }
    // The fleet has no readings from the future.
    const end = to > today ? today : to;
    return { from: `${from}T00:00:00+03:00`, to: `${end}T23:59:59+03:00` };
  }

  const key = filter.month;
  const len = daysInMonth(key);
  // A month still running ends TODAY, not on its 31st: asking for the rest of
  // it is asking for days that have not happened.
  const isCurrent = key === monthKeyOf(today);
  const endDay = isCurrent ? today.slice(8, 10) : String(len).padStart(2, "0");
  return {
    from: `${key}-01T00:00:00+03:00`,
    to:   `${key}-${endDay}T23:59:59+03:00`,
  };
}

/** A stable cache key for one window. */
export const rangeKey = (r) => `${r.from}..${r.to}`;

/** The filter as a query value, or undefined when nothing is selected.
 *  Empty is NOT an empty selection — it means the whole fleet. */
export const categoriesParam = (categories) =>
  categories?.length ? categories.join(",") : undefined;

/** The unit selection, by the same convention: absent means the whole fleet. */
export const vehiclesParam = (vehicles) =>
  vehicles?.length ? vehicles.join(",") : undefined;

/** Stable, so a cache key and a request agree however the chips were clicked. */
export const categoriesKey = (categories) =>
  categories?.length ? [...categories].sort().join(",") : "all";

export const vehiclesKey = (vehicles) =>
  vehicles?.length ? [...vehicles].sort().join(",") : "all";

/** Both selections in one cache key, mirroring the server's. */
export const selectionKey = (categories, vehicles) =>
  `${categoriesKey(categories)}|${vehiclesKey(vehicles)}`;

export const isFiltered = (categories, vehicles) =>
  Boolean(categories?.length || vehicles?.length);

/**
 * The filter to use once the organisation has changed underneath it.
 *
 * Vehicle categories are organisation-scoped: the options come from the fleet,
 * so a plant fleet offers EXCAVATOR and DOZER and a haulage fleet offers
 * neither. A selection carried across a switch sends every analytics request
 * out with a `cats` parameter nothing in the new organisation matches, and the
 * page renders correctly around nothing — zeroed tiles and empty charts that
 * read as a fleet which has stopped rather than as a filter which no longer
 * applies.
 *
 * The date window is deliberately kept. A month or a range means the same thing
 * in every organisation, and switching organisations is usually how the same
 * period gets compared twice; clearing it would discard the question being
 * asked.
 *
 * Returns the SAME OBJECT when there is nothing to clear. The caller applies
 * this during render, so a fresh object every time would set state on every
 * pass and spin.
 */
export function filterForOrgChange(filter, orgChanged) {
  if (!orgChanged) return filter;
  const hasCats = Boolean(filter?.categories?.length);
  // A VEHICLE ID is org-scoped in the strongest sense of the three: a category
  // carried across at least names something the new fleet might have, while an
  // id names a lorry that organisation does not own. The server intersects it
  // away to nothing, so carrying it would draw a page of zeroes — the same
  // failure as a stale category, arrived at more certainly.
  const hasUnits = Boolean(filter?.vehicles?.length);
  if (!hasCats && !hasUnits) return filter;
  return { ...filter, categories: [], vehicles: [] };
}

/* ─────────────────────────── client-side filters ─────────────────────────── */

/**
 * fleet-state, narrowed to the chosen categories.
 *
 * `counts` and `byCategory` are RECOMPUTED from the surviving units by the same
 * rule the server used, rather than scaled or left alone — see the service,
 * where they are folds over `units` and nothing else. Returning the fleet's
 * counts beside one category's units is how a donut ends up claiming 218
 * machines above a list of 32.
 *
 * `monitoring` is rebuilt from the units too, and there is one honest caveat in
 * it: `untracked` counts vehicles with no device bound, which never appear in
 * `units` at all, so a filtered view cannot see them. It is reported as 0. That
 * is exact on KASULU, where all 218 units are tracked and this filter lives;
 * the coverage ring that would care is drawn only for haulage fleets, which
 * carry no machine-family vocabulary and therefore never filter.
 */
export function filterFleetState(state, categories, vehicles) {
  if (!state || !isFiltered(categories, vehicles)) return state;
  const wanted = categories?.length ? new Set(categories) : null;
  const picked = vehicles?.length ? new Set(vehicles) : null;
  const units = (state.units ?? []).filter(
    (u) => (wanted == null || wanted.has(u.category || UNPREFIXED_CODE))
        && (picked == null || picked.has(u.vehicleId)),
  );

  const counts = { WORKING: 0, IDLING: 0, STATIONARY: 0, PARKED: 0, OFFLINE: 0 };
  const cats = new Map();
  for (const u of units) {
    if (u.state in counts) counts[u.state] += 1;
    const key = u.category || UNPREFIXED_CODE;
    if (!cats.has(key)) cats.set(key, { category: key, working: 0, idling: 0, parked: 0, offline: 0 });
    const c = cats.get(key);
    if (u.state === "WORKING") c.working += 1;
    else if (u.state === "IDLING" || u.state === "STATIONARY") c.idling += 1;
    else if (u.state === "PARKED") c.parked += 1;
    else c.offline += 1;
  }

  // OFFLINE is exactly "no ping inside the online window", which is the same
  // test `trackedSilent` is counted on — so the split follows from the states
  // rather than needing a second query.
  const offline = counts.OFFLINE;
  return {
    ...state,
    counts,
    units,
    byCategory: [...cats.values()].sort(
      (a, b) =>
        b.working + b.idling + b.parked + b.offline -
        (a.working + a.idling + a.parked + a.offline),
    ),
    monitoring: {
      total: units.length,
      reportingNow: units.length - offline,
      connected: units.length - offline,
      trackedSilent: offline,
      untracked: 0,
    },
  };
}

/**
 * machine-starts, narrowed. `totalStarted` is re-summed from the surviving
 * categories so the ledger figure above the chart matches the bars in it.
 *
 * TAKES NO UNIT SELECTION, and cannot. This feed answers at CATEGORY grain —
 * "nine excavators started before 05:00" — with no per-unit rows behind it, so
 * there is nothing here to match a vehicle id against. Narrowing it by picking
 * the categories the chosen units belong to would be worse than not narrowing:
 * the card would show every excavator's start under a filter naming one
 * excavator. The caller hides the card instead; see the Analytics page.
 */
export function filterMachineStarts(starts, categories) {
  if (!starts || !isFiltered(categories)) return starts;
  const wanted = new Set(categories);
  const kept = (starts.categories ?? []).filter((c) => wanted.has(c.category || UNPREFIXED_CODE));
  return {
    ...starts,
    categories: kept,
    totalStarted: kept.reduce((a, c) => a + (c.started ?? 0), 0),
  };
}

/**
 * excavator-area, narrowed by matching its vehicle ids against the ones
 * fleet-state has already labelled.
 *
 * Matched through a lookup rather than by re-deriving a prefix from the plate:
 * the derivation lives on the server and a second copy here is a rule that can
 * drift. Both feeds describe the same vehicles, and both carry `vehicleId`.
 */
export function filterExcavatorArea(area, categories, state, vehicles) {
  if (!area || !isFiltered(categories, vehicles)) return area;
  const wanted = categories?.length ? new Set(categories) : null;
  const picked = vehicles?.length ? new Set(vehicles) : null;
  const keep = new Set(
    (state?.units ?? [])
      .filter((u) => (wanted == null || wanted.has(u.category || UNPREFIXED_CODE))
                  && (picked == null || picked.has(u.vehicleId)))
      .map((u) => u.vehicleId),
  );
  const units = (area.units ?? []).filter((u) => keep.has(u.vehicleId));
  return { ...area, units, totalM2: units.reduce((a, u) => a + (u.areaM2 ?? 0), 0) };
}

/**
 * Has this unit done anything the page could show you?
 *
 * The question the ordering below turns on, and it is deliberately generous:
 * ANY measured work in the window — hours run, ground covered, ground worked,
 * fuel burnt or dropped — counts. A unit is only called silent when every one
 * of those is zero or missing, which is what a tracker fitted last week, a
 * machine laid up for the season, or a plate on the books with no device
 * against it all look like.
 *
 * Deliberately NOT `lastSeenAt`: a parked unit whose tracker still reports has
 * a recent fix and nothing to show, and putting it above a machine that worked
 * all month would invert exactly the ordering this is for.
 */
export const hasHistory = (u) =>
  (u?.hoursToday ?? 0) > 0
  || (u?.hoursWeekAvg ?? 0) > 0
  || (u?.hoursMonthAvg ?? 0) > 0
  || (u?.distanceTodayKm ?? 0) > 0
  || (u?.distanceWeekAvgKm ?? 0) > 0
  || (u?.distanceMonthAvgKm ?? 0) > 0
  || (u?.areaWeekAvgKm2 ?? 0) > 0
  || (u?.areaMonthAvgKm2 ?? 0) > 0
  || (u?.fuelBurnL ?? 0) > 0
  || (u?.fuelDropL ?? 0) > 0;

/**
 * The unit filter's options: every unit this organisation has, as the page
 * already knows them.
 *
 * Read from fleet-state rather than from a list endpoint of its own. That feed
 * is already on the page, carries the id, the plate and the category of every
 * unit, and is the same source the type filter's counts come from — so the two
 * controls can never disagree about what the fleet contains.
 *
 * ## The ones with a history come first
 *
 * Asked for 2026-09-14, and it is the difference between a usable list and a
 * long one. A third of a fleet can be units that have not moved in the window —
 * laid up, newly fitted, or carrying a tracker that has never reported — and
 * picking one of those produces a page of zeroes that looks like a bug in the
 * filter rather than an answer about the unit. Plate order alone scatters them
 * evenly through the list, so the first thing an operator scrolls past is as
 * likely to be a dead end as not.
 *
 * So: two tiers, `hasHistory` first, and PLATE ORDER INSIDE EACH. Ranking the
 * top tier by how much work it did would be the obvious next step and is the
 * wrong one — the list is something you scan for a plate you already have in
 * mind, and an order that changes with the window is an order you cannot scan.
 * The tier a unit is in changes with the window; its place within the tier does
 * not.
 *
 * The tier travels on the option as `silent`, so the control can separate the
 * two visibly rather than leaving a reader to infer a boundary from a change of
 * ordering nobody announced.
 */
export function unitOptions(state) {
  return (state?.units ?? [])
    .map((u) => ({
      id: u.vehicleId,
      plate: u.plate ?? u.registrationPlate ?? u.vehicleId,
      category: u.category || UNPREFIXED_CODE,
      silent: !hasHistory(u),
    }))
    .sort((a, b) => Number(a.silent) - Number(b.silent)
                 || a.plate.localeCompare(b.plate, undefined, { numeric: true }));
}
