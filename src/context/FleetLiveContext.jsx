// One live fleet, shared app-wide. useFleetLive opens a snapshot fetch + SSE
// stream per instance, so components must NOT each call it — this provider
// mounts it once for the active company and the header, map, side panels and
// maintenance screen all read the same realtime stream (vehicles update on
// every SSE position flush).

import { createContext, useContext, useMemo } from "react";
import { useFleetLive } from "../hooks/useFleetLive";
import { useAppContext } from "./AppContext";
import { useDismissedIncidents, withoutDismissed } from "../lib/fuelDismissals";
import { deriveStatus } from "../lib/vehicleMap";

const FleetLiveContext = createContext(null);

export function FleetLiveProvider({ children }) {
  const { activeCompanyId } = useAppContext();
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
