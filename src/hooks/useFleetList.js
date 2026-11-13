// The organisation's fleet list (api/fleetList), shared by the pages that read it:
// Probe & Sensor Health (drivers and statuses), Fuel Consumption Rate and Fuel
// Graphs (TYPE targets). One cached copy; an upload or a reset replaces it for
// every page at once.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFleetList, resetFleetList, uploadFleetList } from "../api/fleetList";

export const fleetListKey = (orgId) => ["fleet-list", orgId];
const STALE_MS = 60_000;

/** { data: { current, history }, isLoading, error, upload(list), reset(), saving } */
export function useFleetList(orgId) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: fleetListKey(orgId),
    queryFn: () => fetchFleetList(orgId),
    enabled: Boolean(orgId),
    staleTime: STALE_MS,
  });
  const put = (data) => qc.setQueryData(fleetListKey(orgId), data);
  const upload = useMutation({ mutationFn: (list) => uploadFleetList(orgId, list), onSuccess: put });
  const reset = useMutation({ mutationFn: () => resetFleetList(orgId), onSuccess: put });
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ?? null,
    upload: upload.mutateAsync,
    reset: reset.mutateAsync,
    saving: upload.isPending || reset.isPending,
  };
}

/**
 * The list's entries when a report runs (fresh within a minute), or null when none is uploaded or
 * it cannot be read: the report then uses the list built into the app, as before.
 */
export async function fleetListEntries(qc, orgId) {
  if (!orgId) return null;
  try {
    const data = await qc.fetchQuery({ queryKey: fleetListKey(orgId), queryFn: () => fetchFleetList(orgId), staleTime: STALE_MS });
    return data?.current?.entries ?? null;
  } catch {
    return null;
  }
}
