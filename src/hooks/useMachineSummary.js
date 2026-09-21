// The week's machine figures for a plant fleet: hours, distance, blocks worked,
// plus the per-day series the stat cards plot.
//
// Data only, deliberately. The cards themselves are rendered in AnalyticsScreen
// with the SAME StatCard and AvgTile the delivery row uses — a hook rather than
// a component is what lets that happen without a circular import, and reusing
// those components is the difference between this row belonging to the page and
// merely resembling it.

import { useCallback, useEffect, useState } from "react";
import { getMachineSummary } from "../api/machineOps";

/**
 * Fleets whose plates carry a MACHINE FAMILY and whose work is measured in
 * engine hours rather than trips.
 *
 * KASULU plates read "MUFINDI - EX 26" — the prefix is the machine type. SUKARI
 * plates are ordinary Kenyan registrations, so the same grouping yields KTCC
 * and KDL: registration series, not machine types. A list rather than a shape
 * heuristic, because guessing from the plate would silently mis-handle whichever
 * fleet arrives next.
 */
export const PLANT_FLEETS = new Set(["kasulu"]);

export const isPlantFleet = (companyId) =>
  PLANT_FLEETS.has(String(companyId ?? "").toLowerCase());

/**
 * @param window `{ days, to, categories, vehicles }` — the Analytics page's
 *        filter: the date window, the machine-type selection and the unit
 *        selection. The last two narrow independently and the server
 *        intersects them.
 *
 * It used to take none of these and always ask for the trailing seven days of
 * the whole fleet, which made this card the ONE thing on that page the filter
 * bar could not move: paging back to July left a Summary headline describing
 * August above July's charts, and picking "Excavator" narrowed every card but
 * this one.
 *
 * Defaults reproduce the old behaviour exactly, so a caller that passes nothing
 * still gets the fleet's week.
 */
export function useMachineSummary(companyId, { days = 7, to, categories, vehicles } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // True while a request for a NEW window or selection is in flight. This hook
  // already keeps the last good figures on screen rather than blanking, so
  // without this the card would sit on the previous selection's numbers with
  // nothing saying so.
  const [pending, setPending] = useState(false);

  // Arrays are new objects on every render, so the identity of `categories`
  // cannot be a dependency — the effect below would refetch on each paint and
  // spend the page's whole request budget. Its CONTENTS are what matter, and
  // sorted so the same selection made in a different order is the same key.
  const categoryKey = categories?.length ? [...categories].sort().join(",") : "";
  const vehicleKey  = vehicles?.length ? [...vehicles].sort().join(",") : "";

  const load = useCallback(async () => {
    if (!isPlantFleet(companyId)) return;
    setError(null);
    setPending(true);
    try {
      setData(await getMachineSummary({
        companyId, days, to,
        categories: categoryKey ? categoryKey.split(",") : undefined,
        vehicles: vehicleKey ? vehicleKey.split(",") : undefined,
      }));
    }
    catch (e) { setError(e?.message ?? "unavailable"); }
    finally { setPending(false); }
  }, [companyId, days, to, categoryKey, vehicleKey]);

  useEffect(() => { load(); }, [load]);

  // Kept in step with the fleet.
  //
  // The delivery cards beside these are stale-while-revalidate with no timer,
  // which is right for a month-to-date window that barely moves. These carry
  // TODAY — hours run and ground covered since midnight — so they go stale
  // within minutes of being drawn, and a page left open on a wall display would
  // sit on breakfast's numbers all afternoon.
  //
  // Sixty seconds, matching the interval useApiData uses for the other live
  // feeds on the same page, and matching the server's own warm-cache sweep:
  // asking faster returns the same bytes.
  //
  // Paused while the tab is hidden, for the same reason useApiData pauses. A
  // dashboard on a second monitor otherwise spends all day drawing down a
  // 100-request-a-minute budget shared with every other feed on the page, for
  // numbers nobody is looking at — and it refreshes once on the way back,
  // because a tab hidden for an hour is showing the least trustworthy figure it
  // will ever show.
  useEffect(() => {
    if (!isPlantFleet(companyId)) return undefined;
    // A past window has no live half to refresh — the server skips today's
    // integration entirely when the anchor is not today — so polling one would
    // redraw identical bytes against a shared request budget.
    if (to) return undefined;

    let id = null;
    const start = () => { if (id == null) id = setInterval(load, 60_000); };
    const stop  = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { load(); start(); } else { stop(); }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [companyId, to, load]);

  return { data, error, pending, reload: load };
}
