// One fleet day — or a run of them — of weighbridge tickets, for the
// Weighbridges screen.
//
// The centre and the search go to the SERVER rather than being applied to rows
// already on screen. That is not symmetry for its own sake: each response also
// carries the day's stats and the per-centre tab counts, and those describe
// every bridge regardless of what the grid is showing. Filtering locally would
// leave the tabs counting the rows that survived the filter — so the tab you
// are not looking at would read 0 while holding 200 tickets.
//
// ## A range is N days, fetched and merged here
//
// The endpoint answers about ONE fleet day, because that is the unit the
// bridges, the server's day bounds and the provider's own feed all work in.
// A range is therefore N requests, run together and folded into a payload of
// exactly the shape a single day returns — so everything downstream (the grid,
// the board, the export) reads one object and never learns whether it came
// from one day or ten.
//
// The merge is not a concatenation. Four of the fields cannot be added up:
//
//   uniqueVehicles  the same lorry works every day, so summing the daily
//                   counts counts it once per day. Recounted over the merged
//                   rows, on the normalised plate.
//   heaviest        the largest load of the RANGE, which is the largest of the
//                   days' largest — but its ticket has to travel with it or
//                   the figure cannot be checked.
//   centres         a bridge that worked on two of the days has two rows and
//                   one tab; the counts add, the name does not.
//   captured        the outer edges of the days we actually hold.
//
// Days are capped (see MAX_DAYS): the whole point of this screen is that one
// day is one request, and a picker that could quietly fire ninety of them is a
// control that takes the server down by accident.

import { useCallback, useEffect, useRef, useState } from "react";
import { getWeighmentDay } from "../api/weighments";
import { fleetDayKey } from "./useFuelEvents";
import { fleetDaysBetween } from "../lib/weighbridgeBoard";

/** The most days one reading of this screen will ask for.
 *
 *  Thirty-one covers a calendar month, which is the longest span anybody has
 *  asked for; beyond it the picker clamps and says so rather than silently
 *  fetching a different range from the one on screen. The provider serves
 *  about two days of tickets anyway, so most of a long range is empty — the
 *  cap is about requests, not about data. */
export const MAX_DAYS = 31;

/** Distinct lorries across the merged rows, matched on the normalised plate so
 *  "KTCC 849B" and "KTCC849B" are one machine rather than two. */
function countVehicles(rows) {
  const seen = new Set();
  for (const r of rows) seen.add(r.vehiclePlate || r.vehicleNo);
  return seen.size;
}

/** N days' responses as one day-shaped payload. */
function merge(parts, days) {
  const live = parts.filter(Boolean);
  if (live.length === 0) return null;
  if (live.length === 1 && days.length === 1) return live[0];

  // Newest first, which is the order the grid is written for. Each response is
  // already in that order within its own day, so this only orders the days.
  const rows = live.flatMap(p => p.rows ?? []);
  rows.sort((a, b) => new Date(b.tokenAt) - new Date(a.tokenAt));

  const counts = new Map();
  const names  = new Map();
  for (const p of live) {
    for (const c of p.centres ?? []) {
      counts.set(c.code, (counts.get(c.code) ?? 0) + c.count);
      names.set(c.code, c.name);
    }
  }
  const centres = [...counts.entries()]
    .map(([code, count]) => ({ code, name: names.get(code) ?? `Centre ${code}`, count }))
    .sort((a, b) => a.code - b.code);

  let heaviest = null;
  let heaviestNetKg = null;
  let totalNetKg = 0;
  for (const p of live) {
    const s = p.stats;
    if (!s) continue;
    totalNetKg += s.totalNetKg ?? 0;
    if (s.heaviestNetKg != null && (heaviestNetKg == null || s.heaviestNetKg > heaviestNetKg)) {
      heaviestNetKg = s.heaviestNetKg;
      heaviest = s.heaviest;
    }
  }

  const captured = live.map(p => p.captured).filter(Boolean);
  const first = captured.length ? captured.reduce((a, c) => (c.first < a ? c.first : a), captured[0].first) : null;
  const last  = captured.length ? captured.reduce((a, c) => (c.last  > a ? c.last  : a), captured[0].last)  : null;

  return {
    day: days[days.length - 1],
    from: days[0],
    to: days[days.length - 1],
    days,
    centres,
    stats: {
      weighments:     live.reduce((n, p) => n + (p.stats?.weighments ?? 0), 0),
      uniqueVehicles: countVehicles(rows),
      heaviestNetKg,
      heaviest,
      totalNetKg,
    },
    rows,
    matched: live.reduce((n, p) => n + (p.matched ?? 0), 0),
    total:   live.reduce((n, p) => n + (p.total ?? 0), 0),
    captured: first ? { first, last } : null,
  };
}

/**
 * @param from  first fleet day, YYYY-MM-DD. Defaults to today.
 * @param to    last fleet day, inclusive. Defaults to `from` — one day.
 */
export function useWeighments({
  orgId,
  from = fleetDayKey(),
  to = from,
  centre = null,
  search = "",
}) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  /** True when the range asked for was longer than MAX_DAYS and what is on
   *  screen is the tail of it. The screen has to say so: figures under a
   *  heading naming a span they do not cover is the worst way to be wrong. */
  const [clamped, setClamped] = useState(null);

  // The last request wins. Typing in the search box fires one of these per
  // keystroke-ish, and without this a slow early response can land after a
  // fast later one and put the previous query's rows under the current text.
  const runRef = useRef(0);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const run = ++runRef.current;
    setLoading(true);
    setError(null);

    const all = fleetDaysBetween(from, to);
    // The TAIL of an over-long range, not the head: a reader who drags the
    // picker back too far is looking for recent days, and the most recent are
    // also the only ones the provider still holds.
    const days = all.length > MAX_DAYS ? all.slice(-MAX_DAYS) : all;

    try {
      const parts = await Promise.all(
        days.map(d => getWeighmentDay({ orgId, day: d, centre, q: search || undefined })),
      );
      if (run !== runRef.current) return;
      setData(merge(parts, days));
      setClamped(all.length > MAX_DAYS ? { asked: all.length, shown: days.length } : null);
    } catch (e) {
      if (run !== runRef.current) return;
      setError(e?.message ?? "Could not load weighbridge tickets");
    } finally {
      if (run === runRef.current) setLoading(false);
    }
  }, [orgId, from, to, centre, search]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload, clamped };
}
