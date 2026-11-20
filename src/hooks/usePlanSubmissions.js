// The Maintenance page's Plan submissions board.
//
// Live the same way as the map's Work plans layer (hooks/useWorkPlans): every
// FactorySuite work plan event (fuelplan.created, .submitted, .decided…) and
// the server's 5-minute plan watch clear the server's cache and send
// `work_plans_changed`, which hooks/useFleetLive turns into WORK_PLANS_CHANGED,
// and this re-reads at once. It also re-reads when the tab comes back into
// focus. Only a failed read is retried on a timer.

import { useEffect } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchPlanSubmissions } from "../api/planSubmissions";
import { WORK_PLANS_CHANGED } from "../api/workPlans";

const RETRY_MS = 60_000;

export function usePlanSubmissions(orgId, day, enabled = true) {
  const on = Boolean(orgId && enabled);
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["plan-submissions", orgId, day ?? "next"],
    queryFn: ({ signal }) => fetchPlanSubmissions(orgId, day, { signal }),
    enabled: on,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.status === "error" ? RETRY_MS : false),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!on) return undefined;
    const onChange = () => { refetch(); };
    window.addEventListener(WORK_PLANS_CHANGED, onChange);
    return () => window.removeEventListener(WORK_PLANS_CHANGED, onChange);
  }, [on, refetch]);

  return { data: data ?? null, loading: isLoading && on, fetching: isFetching, error: isError, refetch, updatedAt: dataUpdatedAt || null };
}
