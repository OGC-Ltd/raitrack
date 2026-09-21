// The weighbridges, for the map's own layer.
//
// Fetched once per organisation and cached, like the estate zones beside it:
// the SCALES do not move, and the only thing on the response that changes is
// which ticket each one last took. That last ticket is worth a few minutes of
// staleness — a marker is an orientation device, and the Weighbridges screen is
// where an operator goes for the live grid.
//
// An org with no bridges gets an empty array and the layer never offers itself.
// Only Sukari's four centres weigh anything today, but the gate is the RESPONSE
// rather than an org name: the day another mill's scales start reporting, its
// markers appear without an edit here.

import { useEffect, useState } from "react";
import { getWeighbridges } from "../api/weighments";
import { readCache, writeCache } from "../services/cache";

const cacheKey = (orgId) => `ft-weighbridges:${orgId}`;

// Module-level, so two components asking at once make one request.
const inflight = new Map();

function load(orgId) {
  if (!inflight.has(orgId)) {
    inflight.set(
      orgId,
      getWeighbridges({ orgId })
        .then((rows) => {
          writeCache(cacheKey(orgId), rows);
          return rows;
        })
        // Dropped from the map on failure, so a retry is possible. A cached
        // rejection would make one bad response permanent for the session.
        .catch((err) => { inflight.delete(orgId); throw err; }),
    );
  }
  return inflight.get(orgId);
}

/**
 * @param {string|null} orgId
 * @returns {{ bridges: Array|null, loading: boolean, error: Error|null }}
 */
export function useWeighbridges(orgId) {
  // Seeded from the cache so a revisit draws immediately rather than flashing
  // an empty layer while the request is in flight.
  const [bridges, setBridges] = useState(() => (orgId ? readCache(cacheKey(orgId)) ?? null : null));
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!orgId) { setBridges(null); return undefined; }

    let alive = true;
    const cached = readCache(cacheKey(orgId));
    setBridges(cached ?? null);
    setError(null);
    setLoading(true);

    load(orgId)
      .then((rows) => { if (alive) { setBridges(rows); setLoading(false); } })
      .catch((err) => { if (alive) { setError(err); setLoading(false); } });

    return () => { alive = false; };
  }, [orgId]);

  return { bridges, loading, error };
}
