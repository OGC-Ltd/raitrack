// Open repair jobs for this organisation, fetched once per screen.
//
// Lifted into SensorPanel for the same reason useProbeHealth is: two different
// surfaces need the same answer and must not be able to disagree about it. The
// Probes tab greys out a unit somebody has already reported; the Repairs tab
// lists those same jobs so they can be signed off. One fetch, two readers.
//
// Small by construction — these are OUTSTANDING jobs, not history. A fleet
// with two hundred open repairs has a problem this hook is not going to fix.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFleetLiveShared } from "../context/FleetLiveContext";
import { listRepairItems, REPAIRS_CHANGED } from "../api/repairs";

export function useOpenRepairs(enabled = true) {
  const { orgId } = useFleetLiveShared();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const reload = useCallback(async () => {
    // `enabled` is the permission gate. A role without repair:read would get a
    // 403 on every screen load, which is noise in the log and a red herring
    // for whoever reads it next.
    if (!orgId || !enabled) { setRows([]); return; }
    setLoading(true);
    setError(null);
    try {
      setRows((await listRepairItems({ orgId, status: "open" })) ?? []);
    } catch (e) {
      setError(e?.message ?? "Could not load open repairs");
    } finally {
      setLoading(false);
    }
  }, [orgId, enabled]);

  useEffect(() => { reload(); }, [reload]);

  // Changed elsewhere (Fuel > Audit, another person, a fuel case raising a
  // probe job): read again. See REPAIRS_CHANGED in api/repairs.
  useEffect(() => {
    window.addEventListener(REPAIRS_CHANGED, reload);
    window.addEventListener("ft-fuel-followup-changed", reload);
    return () => {
      window.removeEventListener(REPAIRS_CHANGED, reload);
      window.removeEventListener("ft-fuel-followup-changed", reload);
    };
  }, [reload]);

  /**
   * vehicleId -> the open item on it.
   *
   * A Map rather than a list because the probe table asks "is this one
   * reported?" once per row, on every render and every keystroke of the
   * search box.
   */
  const byVehicle = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (!m.has(r.vehicleId)) m.set(r.vehicleId, r);
    return m;
  }, [rows]);

  return { rows, byVehicle, openCount: rows.length, loading, error, reload };
}
