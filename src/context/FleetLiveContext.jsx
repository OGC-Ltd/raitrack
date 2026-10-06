// One live fleet, shared app-wide. The fleet itself lives in the TanStack Query
// cache (hooks/useFleetLive's fleetKeys), but the SSE stream that keeps it
// current must be opened ONCE — this provider mounts it for the active company.
// It also applies the dismissed-incident filter once, here, rather than in each
// of the ~36 components that read the fleet (vehicles update on every SSE
// position flush, so doing it per reader would repeat it per frame).

import { createContext, useContext, useMemo } from "react";
import { useFleetLive } from "../hooks/useFleetLive";
import { useAppSelector } from "./AppContext";
import { useDismissedIncidents, withoutDismissed } from "../lib/fuelDismissals";
import { deriveStatus } from "../lib/vehicleMap";

const FleetLiveContext = createContext(null);

export function FleetLiveProvider({ children }) {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const live = useFleetLive(activeCompanyId);
  // Incidents deleted in the incident window leave the fleet here, once, so the
  // alerts list, the map, the side panel and the window all drop them together.
  // UI only: see lib/fuelDismissals.
  const dismissed = useDismissedIncidents();
  const vehicles = useMemo(
    () => withoutDismissed(live.vehicles, dismissed, deriveStatus),
    [live.vehicles, dismissed],
  );
  const fleet = useMemo(
    () => (vehicles === live.vehicles ? live : { ...live, vehicles }),
    [live, vehicles],
  );
  return <FleetLiveContext.Provider value={fleet}>{children}</FleetLiveContext.Provider>;
}

/** { vehicles, orgId, loading, error, retry, feed } for the active company. */
export function useFleetLiveShared() {
  const ctx = useContext(FleetLiveContext);
  if (!ctx) throw new Error("useFleetLiveShared must be used inside FleetLiveProvider");
  return ctx;
}
