// The day's FactorySuite work plans while the map's Work plans switch is on.
//
// Driven by FactorySuite's work plan webhook, not by polling: the server hears
// a fuelplan.* event, clears its cached plans and sends `work_plans_changed`,
// which hooks/useFleetLive turns into WORK_PLANS_CHANGED, and this re-reads.
// It also re-reads when the switch is turned on, when the live stream
// reconnects (a hook may have fired while it was down) and when the tab comes
// back into focus. Only a failed read is retried on a timer. The units'
// positions are not read here; they are the map's own live stream.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkPlans, WORK_PLANS_CHANGED } from "../api/workPlans";

const RETRY_MS = 60_000;

export function useWorkPlans(orgId, enabled) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["work-plans", orgId],
    queryFn: ({ signal }) => fetchWorkPlans(orgId, undefined, { signal }),
    enabled: Boolean(orgId && enabled),
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.status === "error" ? RETRY_MS : false),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!orgId || !enabled) return undefined;
    const onChange = () => { refetch(); };
    window.addEventListener(WORK_PLANS_CHANGED, onChange);
    return () => window.removeEventListener(WORK_PLANS_CHANGED, onChange);
  }, [orgId, enabled, refetch]);

  return { data: data ?? null, loading: isLoading && Boolean(enabled), error: isError };
}
