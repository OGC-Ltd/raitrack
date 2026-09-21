// Probe & sensor health for the whole fleet, fetched once per screen.
//
// Lifted out of ProbeHealthPanel so the tab strip can show the fault count
// without the panel being mounted. A count that only exists once you open the
// tab is a count nobody sees — the point of putting it on the tab is that an
// operator learns 45 units need attention while they are looking at something
// else.
//
// One fetch, shared: the panel and the tab badge read the same object, so they
// cannot disagree about how many faults there are. The server caches the build
// for ten minutes (it scans a month of telemetry), so re-fetching on every tab
// change would be wasted work as well as a slower screen.

import { useCallback, useEffect, useState } from "react";
import { useFleetLiveShared } from "../context/FleetLiveContext";
import { getProbeHealth } from "../api/probeHealth";

export function useProbeHealth() {
  const { orgId } = useFleetLiveShared();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const reload = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getProbeHealth({ orgId }));
    } catch (e) {
      setError(e?.message ?? "Could not load probe health");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}
