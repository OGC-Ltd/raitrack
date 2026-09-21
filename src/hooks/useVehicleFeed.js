// The Live Feed panel's list — the live stream on top of history read from the
// server, in whichever of its two scopes is in force.
//
// Two sources, because neither alone answers either question. The SSE stream
// is current but capped at ~200 items in the browser (see useFleetLive); the
// history endpoint has everything but stops at the moment it was read. Merged,
// the panel opens with real history and keeps ticking.
//
// ## Two scopes, one list
//
// ONE UNIT, when the operator has clicked a marker: its whole history, paged
// back as far as the store goes. The live buffer is org-wide and a single unit
// is a couple of hundredths of that traffic — Kasulu emits roughly thirteen
// zone crossings a minute across 224 vehicles — so filtering the buffer to one
// of them usually yields nothing at all.
//
// THE FLEET, otherwise: everything logged TODAY. The same cap bites from the
// other side here — 200 items against thirteen a minute is about a quarter of
// an hour, so scrolling the buffer reached the bottom of the browser's memory
// and stopped, with no way to tell that from a quiet afternoon. The day is
// paged from the store like a unit's history is, and the list is bounded to
// the fleet day at both ends so the foot of it means what it says.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNotifications, fleetToday } from "../api/notifications";

/**
 * One page. The endpoint caps at 200 (500 for a day read); 100 fills the panel
 * several times over and keeps the first paint cheap, which is the read that
 * happens on every marker click.
 */
const PAGE = 100;

/**
 * One page of the fleet day, which is a much denser read than a unit's
 * history — a Kasulu day runs to several thousand rows, so 100 at a time
 * would be forty round trips to scroll it. The server allows 500 on a day
 * query (it treats a day as a complete answer rather than a page); 200 is
 * two-thirds of a screen-hour and keeps each response inside a second.
 */
const DAY_PAGE = 200;

/**
 * Is this item's timestamp inside the given fleet day?
 *
 * Formatted in Africa/Nairobi and compared as a string, because that is the
 * boundary the server cut the page on (see api/notifications.fleetToday) — a
 * local-midnight comparison in a browser set to another zone would disagree
 * with the rows it was handed.
 */
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit",
});
function onFleetDay(item, day) {
  const t = Date.parse(item?.ts);
  return Number.isNaN(t) ? false : dayFmt.format(t) === day;
}

/**
 * Does this feed item belong to `vehicle`?
 *
 * The cuid is the real key — every emitter that knows its vehicle sets it. The
 * plate fallback catches items published before the vehicle was resolved (the
 * org-attribution pass links a plate to a vehicle on a later cycle, and until
 * it does the item carries a plate and a null vehicleId).
 */
export function feedItemMatchesVehicle(item, vehicle) {
  if (!item || !vehicle) return false;
  if (item.vehicleId && vehicle.vehicleId) return item.vehicleId === vehicle.vehicleId;
  return Boolean(item.plate) && item.plate === vehicle.id;
}

/**
 * @param {object|null} vehicle  the selected mapped vehicle, or null for the fleet
 * @param {string|null} orgId    backend organisation cuid
 * @param {Array}       liveFeed the shared org-wide live feed
 * @returns {{ items: Array, loading: boolean, error: Error|null, retry: () => void }}
 */
export function useVehicleFeed(vehicle, orgId, liveFeed) {
  // Depend on the IDENTITY strings, not on the vehicle object: every SSE
  // position flush hands back a new object for the same unit, so memoising on
  // the object would re-merge the whole feed a few times a second for a
  // selection that has not changed.
  const vehicleId = vehicle?.vehicleId ?? null;
  const plate     = vehicle?.id ?? null;
  // The fleet scope reads one day; the unit scope reads all of that unit's
  // history and passes no day at all. Recomputed per render rather than held
  // in state — it is a string, so it is only a new dependency once a night,
  // and the rollover then resets the read the same way a new selection does.
  const day = vehicleId ? null : fleetToday();

  /**
   * Pages of history, accumulated as the operator scrolls.
   *
   * Held here rather than through useApiData because this read GROWS: each
   * page is appended to what is already on screen, and that hook is built to
   * replace its result. Deliberately not localStorage-cached either, unlike
   * the fleet snapshot and the org feed — those are one entry each, whereas
   * this would be one per vehicle clicked, and hundreds of items across 224
   * units is several megabytes. Exhausting the quota makes the writes that
   * actually matter for first paint fail silently (see services/cache).
   */
  const [pages, setPages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Guards a page request against the scroll handler firing again before the
  // one in flight lands — a fast scroll otherwise issues the same `before`
  // several times and appends the same page twice.
  const inFlight = useRef(false);
  // Bumped on every selection change, and checked when a response lands, so a
  // reply for the truck you just clicked away from cannot append itself to the
  // list for the one you are looking at now.
  const runRef = useRef(0);

  const fetchPage = useCallback(async (before) => {
    if (!orgId || inFlight.current) return;
    inFlight.current = true;
    const run = runRef.current;
    setLoading(true);
    try {
      const { items, nextBefore } = await getNotifications({
        orgId, vehicleId, day, limit: day ? DAY_PAGE : PAGE, before,
      });
      if (run !== runRef.current) return;
      setPages((prev) => (before ? [...prev, items] : [items]));
      setCursor(nextBefore);
      setDone(!nextBefore);
      setError(null);
    } catch (err) {
      if (run === runRef.current) setError(err);
    } finally {
      if (run === runRef.current) setLoading(false);
      inFlight.current = false;
    }
  }, [orgId, vehicleId, day]);

  // A new selection — or a new day — starts a new history. Everything resets,
  // including the cursor: carrying one over would page into the previous
  // unit's timeline, or into yesterday.
  useEffect(() => {
    runRef.current += 1;
    inFlight.current = false;
    setPages([]); setCursor(null); setDone(false); setError(null);
    if (orgId) fetchPage(undefined);
  }, [orgId, vehicleId, day, fetchPage]);

  /** Ask for the next page. A no-op at the end of the history. */
  const loadMore = useCallback(() => {
    if (done || loading || !cursor) return;
    fetchPage(cursor);
  }, [done, loading, cursor, fetchPage]);

  const data = useMemo(() => pages.flat(), [pages]);
  const retry = useCallback(() => fetchPage(undefined), [fetchPage]);

  const items = useMemo(() => {
    // THE FLEET, today. History merged with the live buffer the same way a
    // unit's is, then bounded to the day: the buffer holds up to twelve hours
    // and so reaches back past midnight, and an item from last night sitting
    // under a list that ends "everything logged today" would make the foot of
    // the panel a lie.
    if (!vehicleId && !plate) {
      const byId = new Map();
      for (const it of data ?? []) byId.set(it.id, it);
      for (const it of liveFeed) if (onFleetDay(it, day)) byId.set(it.id, it);
      return [...byId.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    }

    const subject = { vehicleId, id: plate };

    // Keyed by id so a live item that the history also returned appears once,
    // with the LIVE copy winning — a republished notification carries the
    // corrected wording (see the server's publishNotification dedupe).
    const byId = new Map();
    for (const it of data ?? []) byId.set(it.id, it);
    for (const it of liveFeed) {
      if (feedItemMatchesVehicle(it, subject)) byId.set(it.id, it);
    }

    // `ts` is an ISO-8601 UTC string server-side, so a lexical compare is a
    // chronological one — same ordering rule the org feed uses.
    return [...byId.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }, [vehicleId, plate, day, data, liveFeed]);

  return {
    items,
    /**
     * True only while the FIRST page is in flight, so the panel shows its
     * loading state on open and never blanks the history already on screen to
     * announce that more of it is coming.
     */
    loading: loading && data.length === 0,
    /** A page beyond the first is arriving — for a footer, not for the list. */
    loadingMore: loading && data.length > 0,
    /** Nothing older remains: the end of the unit's history, or of the day. */
    atEnd: done,
    loadMore,
    error,
    retry,
  };
}
