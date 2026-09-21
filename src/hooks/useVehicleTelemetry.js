// useVehicleTelemetry.js — Last N telemetry pings for a single vehicle
// ADDED 2026-08-06
//
// BACKEND INTEGRATION NOTE:
// This hook already calls the REAL backend endpoint:
//   GET /api/v1/organisations/:orgId/vehicles/:vehicleId/telemetry?limit=5&from=<1h ago>
//
// The endpoint exists and returns rows with these fields (from findPings()):
//   capturedAt, lat, lng, speedKmh, engineOn, fuelLevelMl, fuelUsedMl,
//   cargoWeightKg, headingDeg, accuracyM, altitudeM
//
// When the backend adds more sensor fields (e.g. temperature, RPM, battery),
// just add them to the SENSOR_COLUMNS array in SensorTable.jsx — no hook changes needed.

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../services/api";

export function useVehicleTelemetry(vehicleId, orgId, limit = 5) {
  const [pings,   setPings]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!vehicleId || !orgId) { setPings([]); return; }

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    const from = new Date(Date.now() - 3600_000).toISOString(); // last 1 hour
    apiFetch(
      `/api/v1/organisations/${orgId}/vehicles/${vehicleId}/telemetry?limit=${limit}&from=${from}`,
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
  }, [vehicleId, orgId, limit]);

  return { pings, loading, error };
}
