// One live fleet, shared app-wide. The fleet itself lives in the TanStack Query
// cache (hooks/useFleetLive's fleetKeys), but the SSE stream that keeps it
// current must be opened ONCE — this provider mounts it for the active company.
// It also applies the dismissed-incident filter once, here, rather than in each
// of the ~36 components that read the fleet (vehicles update on every SSE
// position flush, so doing it per reader would repeat it per frame).

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useFleetLive } from "../hooks/useFleetLive";
import { useWorkPlans } from "../hooks/useWorkPlans";
import { linesByVehicle, withPlanDrivers, eatYesterday } from "../lib/shiftOperators";

/** The one company whose FactorySuite keeps work plans: Mufindi, our Kasulu. */
const PLAN_COMPANY = "kasulu";

/** The time, to the minute, while `on`: a shift starts or ends without a reload. */
function useMinute(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
import { useAppSelector } from "./AppContext";
import { useDismissedIncidents, withoutDismissed } from "../lib/fuelDismissals";
import { deriveStatus } from "../lib/vehicleMap";
import { usePermissions } from "../hooks/usePermissions";

// A technician's Live Feed is the repair notices on their flagged units; the
// server sends only those, and this drops any tracking items a browser kept
// from before (operator, 2026-10-27).
const REPAIR_SOURCES = new Set(["repair", "repair_flag", "repair_verified"]);
const repairOnly = (feed) => feed?.filter((f) => REPAIR_SOURCES.has(f?.source)) ?? feed;

const FleetLiveContext = createContext(null);

export function FleetLiveProvider({ children }) {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { flaggedOnly, repairFeedOnly, vehicleIds } = usePermissions();
  const live = useFleetLive(activeCompanyId, { keepFeed: repairFeedOnly });
  // Incidents deleted in the incident window leave the fleet here, once, so the
  // alerts list, the map, the side panel and the window all drop them together.
  // UI only: see lib/fuelDismissals.
  const dismissed = useDismissedIncidents();
  // A technician's fleet is the units flagged for repair, everywhere a list,
  // a count or a type chip reads it (operator, 2026-10-27). The server sends
  // only those; this also keeps a fleet cached in the browser from before out.
  const flagged = useMemo(() => (flaggedOnly && vehicleIds ? new Set(vehicleIds) : null), [flaggedOnly, vehicleIds]);
  // Mufindi's units on a work-plan shift take its operators as their driver
  // where the tracker has none (operator, 2026-11-19: "the drivers name to
  // appear even when searching", alike everywhere). lib/shiftOperators.
  const planDrivers = activeCompanyId === PLAN_COMPANY;
  // Yesterday's plans too: a night shift (18:00 to 04:00) is on yesterday's
  // plan until 04:00 today (operator, 2026-11-20: EX 16 read Unassigned at 02:53
  // on its 19 Nov night shift).
  const minute = useMinute(planDrivers);
  const yesterday = eatYesterday(minute);
  const workPlans = useWorkPlans(live.orgId, planDrivers);
  const lastNight = useWorkPlans(live.orgId, planDrivers, yesterday);
  const byVehicle = useMemo(
    () => (planDrivers ? linesByVehicle({ plans: [...(lastNight.data?.plans ?? []), ...(workPlans.data?.plans ?? [])] }) : null),
    [planDrivers, workPlans.data, lastNight.data],
  );
  const vehicles = useMemo(() => {
    const kept = withoutDismissed(live.vehicles, dismissed, deriveStatus);
    const mine = flagged && kept ? kept.filter((v) => flagged.has(v.vehicleId)) : kept;
    return withPlanDrivers(mine, byVehicle, minute);
  }, [live.vehicles, dismissed, flagged, byVehicle, minute]);
  // Repair notices only without notification:all_events (since 2026-11-14).
  const feed = useMemo(() => (repairFeedOnly ? repairOnly(live.feed) : live.feed), [repairFeedOnly, live.feed]);
  const fleet = useMemo(
    () => (vehicles === live.vehicles && feed === live.feed ? live : { ...live, vehicles, feed }),
    [live, vehicles, feed],
  );
  return <FleetLiveContext.Provider value={fleet}>{children}</FleetLiveContext.Provider>;
}

/** { vehicles, orgId, loading, error, retry, feed } for the active company. */
export function useFleetLiveShared() {
  const ctx = useContext(FleetLiveContext);
  if (!ctx) throw new Error("useFleetLiveShared must be used inside FleetLiveProvider");
  return ctx;
}
