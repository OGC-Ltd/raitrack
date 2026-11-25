// The Gate log's rows (operator, 2026-11-25): pure, and tested.
//
// The gate's four events, as fleet-server sends them (modules/gate-log):
//   DISPATCH        "… signed out to X and left the premises."
//   MOVEMENT_ENTRY  "… returned to the yard."
//   SALE_DISPATCH   a sales run signed out
//   SALE_RETURN     a sales run signed back in

export const GATE_EVENTS = {
  DISPATCH:       { label: "Signed out",       way: "out" },
  MOVEMENT_ENTRY: { label: "Returned",         way: "in" },
  SALE_DISPATCH:  { label: "Sales signed out", way: "out" },
  SALE_RETURN:    { label: "Sales returned",   way: "in" },
};

/**
 * Where a line came from (operator, 2026-11-25: a badge on each row, and a filter):
 *   controltech  FactorySuite's gate events (modules/webhooks/raifactorysuite-events)
 *   telemetry    the tracker seen at the gate's geofence (lib/yard-departure)
 * A line merging a unit's crossings within five minutes carries its latest one's source.
 */
export const GATE_SOURCES = {
  factorysuite: { label: "FactorySuite" },
  geofence:     { label: "Geofence" },
  other:        { label: "Other" },
};
export const sourceKey = (source) => (source === "controltech" ? "factorysuite" : source === "telemetry" ? "geofence" : "other");

/** Rows from one source, or all of them for "all". */
export function bySource(rows, key) {
  return key && key !== "all" ? rows.filter((r) => r.source === key) : rows;
}

/** Feed items → table rows, newest first. Anything not a gate event is dropped. */
export function gateRows(events) {
  return (events ?? [])
    .filter((e) => GATE_EVENTS[e?.alertType])
    .map((e) => ({
      key: e.id,
      at: Date.parse(e.ts),
      plate: e.plate ?? null,
      alertType: e.alertType,
      label: GATE_EVENTS[e.alertType].label,
      way: GATE_EVENTS[e.alertType].way,
      source: sourceKey(e.source),
      text: e.text ?? "",
    }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at);
}

const squash = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");

/** Rows whose plate or details hold the search, spaces and case ignored. */
export function searchGate(rows, q) {
  const needle = squash(q);
  if (!needle) return rows;
  return rows.filter((r) => squash(r.plate).includes(needle) || squash(r.text).includes(needle));
}

const EAT_MS = 3 * 3_600_000;

/**
 * Rows within hours of the day, Nairobi time (operator, 2026-11-25: "a time
 * range picker next to the date", picked by the hour). `fromH` 0-23 is the
 * hour the window opens, `toH` the hour it closes (24 = the day's end; a
 * fraction for "now", 13.95 = 13:57): From 06 To 14 is 06:00 up to 14:00, not
 * including 14:00. Either may be null
 * for "from the start" / "to the end"; given the wrong way round, they are
 * read the right way round.
 */
export function byHours(rows, fromH, toH) {
  let a = Number.isFinite(fromH) ? Math.round(fromH * 60) : null;
  let b = Number.isFinite(toH) ? Math.round(toH * 60) : null;
  if (a == null && b == null) return rows;
  if (a != null && b != null && a >= b) [a, b] = [b, a === b ? a + 60 : a];
  return rows.filter((r) => {
    const m = Math.floor(((((r.at + EAT_MS) % 86_400_000) + 86_400_000) % 86_400_000) / 60_000);
    return (a == null || m >= a) && (b == null || m < b);
  });
}

/** How many lines went out and came in. */
export function gateCounts(rows) {
  let out = 0;
  let inn = 0;
  for (const r of rows) {
    if (r.way === "out") out++;
    else inn++;
  }
  return { out, in: inn };
}

/**
 * Trips (operator, 2026-11-25: "for the units that have the time in and out,
 * columns of time in and out, and the hours the unit was out"; "even if it
 * left yesterday it should be captured").
 *
 * Per unit, in time order, over the day shown AND the day before it (so a
 * unit signed out last night has its sign-out):
 *   - a sign-out opens a trip (a second one before any sign-in replaces it:
 *     the gate signed the unit out again);
 *   - a FactorySuite sign-in ("returned to the yard") closes it;
 *   - a Geofence line ("arrived at the gate") is the tracker seeing the unit at
 *     the gate while it is signed out. It shows the open trip's out time and
 *     how long the unit has been out, as the server's own "having been out for
 *     17.1 h" counts, but does NOT close the trip: one unit was seen at the
 *     gate seven times on one trip without ever being signed in (KBV 403X,
 *     24-25 Nov 2026).
 * Only recorded times; nothing is estimated (operator: "we should not estimate").
 *
 * A sign-out's row shows the trip's first return of either kind; `open` when
 * there is none yet. A return with no sign-out open before it shows no trip.
 *
 * → Map(row key → { outAt, inAt, outMs, open }), times in ms.
 */
export function gateTrips(rows, now = Date.now()) {
  const byUnit = new Map();
  for (const r of rows ?? []) {
    const unit = squash(r.plate);
    if (!unit) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(r);
  }
  const trips = new Map();
  for (const list of byUnit.values()) {
    list.sort((a, b) => a.at - b.at);
    let open = null;
    for (const r of list) {
      if (r.way === "out") {
        open = r;
        continue;
      }
      if (!open) continue;
      trips.set(r.key, { outAt: open.at, inAt: r.at, outMs: r.at - open.at, open: false });
      if (!trips.has(open.key)) trips.set(open.key, { outAt: open.at, inAt: r.at, outMs: r.at - open.at, open: false });
      if (r.source === "factorysuite") open = null;
    }
    if (open && !trips.has(open.key)) trips.set(open.key, { outAt: open.at, inAt: null, outMs: Math.max(0, now - open.at), open: true });
  }
  return trips;
}

/** 45 min, 2 h 05 min, 1 d 3 h. */
export function durationWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** A YYYY-MM-DD day moved by n days. */
export function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
