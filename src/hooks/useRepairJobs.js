// Repair jobs for the Repairs tab, fetched for the STATE the reader is looking
// at.
//
// ## Why this is not `useOpenRepairs` with a parameter
//
// They answer different questions and only one of them may ever be wrong.
//
// `useOpenRepairs` feeds the Probes table's "Reported" badge and the disabled
// checkbox beside it. That answer has to be the OPEN set and nothing else: the
// moment it included a signed-off job, a unit that had been released would go
// on reading as already-reported and could never be picked again. It is a
// correctness gate, so it takes no argument and cannot be pointed somewhere
// else by accident.
//
// This one is a reading list. It follows the filter chips, it is allowed to
// hold history, and nothing downstream of it gates anything.
//
// The cost is one extra request while the Repairs tab sits on "Open", where
// the two overlap. That is the right trade for a badge that cannot drift.
//
// ## The filter has to reach the SERVER
//
// It used to be applied in the panel, over a list that only ever contained
// open jobs — so "Resolved" and "All" filtered a set that could not contain
// anything they were looking for, and every signed-off job appeared to have
// been thrown away. Filtering client-side is only honest when the client has
// the whole set.

import { useCallback, useEffect, useState } from "react";
import { listRepairItems } from "../api/repairs";

export function useRepairJobs(orgId, status = "open", enabled = true) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const reload = useCallback(async () => {
    // `enabled` is the permission gate, as in useOpenRepairs: a role without
    // repair:read would otherwise 403 on every screen load.
    if (!orgId || !enabled) { setRows([]); return; }
    setLoading(true);
    setError(null);
    try {
      setRows((await listRepairItems({ orgId, status })) ?? []);
    } catch (e) {
      setError(e?.message ?? "Could not load repair jobs");
    } finally {
      setLoading(false);
    }
  }, [orgId, status, enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { rows, loading, error, reload };
}
