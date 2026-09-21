// One live fleet, shared app-wide. useFleetLive opens a snapshot fetch + SSE
// stream per instance, so components must NOT each call it — this provider
// mounts it once for the active company and the header, map, side panels and
// maintenance screen all read the same realtime stream (vehicles update on
// every SSE position flush).

import { createContext, useContext } from "react";
import { useFleetLive } from "../hooks/useFleetLive";
import { useAppContext } from "./AppContext";

const FleetLiveContext = createContext(null);

export function FleetLiveProvider({ children }) {
  const { activeCompanyId } = useAppContext();
  const fleet = useFleetLive(activeCompanyId);
  return <FleetLiveContext.Provider value={fleet}>{children}</FleetLiveContext.Provider>;
}

/** { vehicles, orgId, loading, error, retry, feed } for the active company. */
export function useFleetLiveShared() {
  const ctx = useContext(FleetLiveContext);
  if (!ctx) throw new Error("useFleetLiveShared must be used inside FleetLiveProvider");
  return ctx;
}
