// useWindowTelemetry.js — Telemetry pings for a specific time window
// ADDED 2026-08-09
//
// Like useVehicleTelemetry but accepts explicit from/to timestamps instead of
// the hardcoded "last 1 hour". Used by FuelDrainDetail to check engine state
// during a specific drain event window.
//
// Backend endpoint (same as useVehicleTelemetry):
//   GET /api/v1/organisations/:orgId/vehicles/:vehicleId/telemetry?from=<iso>&to=<iso>&limit=N

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../services/api";

/**
 * @param {string|null} vehicleId  — backend cuid of the vehicle
 * @param {string|null} orgId      — backend cuid of the org
 * @param {number|null} fromMs     — window start as ms-since-epoch
 * @param {number|null} toMs       — window end as ms-since-epoch
 * @param {number}      limit      — max pings to fetch (default 20)
 */
export function useWindowTelemetry(vehicleId, orgId, fromMs, toMs, limit = 20) {
  const [pings,   setPings]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!vehicleId || !orgId || !fromMs || !toMs) { setPings([]); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    const from = new Date(fromMs).toISOString();
    const to   = new Date(toMs).toISOString();

    apiFetch(
      `/api/v1/organisations/${orgId}/vehicles/${vehicleId}/telemetry?from=${from}&to=${to}&limit=${limit}`,
      { signal: ctrl.signal }
    )
      .then(res => {
        if (ctrl.signal.aborted) return;
        setPings(res.data ?? []);
        setLoading(false);
      })
      .catch(err => {
        if (err?.name === "AbortError" || ctrl.signal.aborted) return;
        setError(err.message ?? "Failed to load telemetry");
        setLoading(false);
      });

    return () => ctrl.abort();
  }, [vehicleId, orgId, fromMs, toMs, limit]);

  return { pings, loading, error };
}