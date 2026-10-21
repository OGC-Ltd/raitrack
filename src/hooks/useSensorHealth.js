// useSensorHealth.js — Sensor anomaly detection from live snapshot
// ADDED 2026-08-06 · Updated 2026-08-07
//
// WHAT THIS DETECTS (all from live snapshot — no extra API calls):
//   1. signal_lost      — no ping for > DARK_THRESHOLD (1h by default)
//   2. speed_no_engine  — speedKmh > 2 but engineOn === false right now
//   3. transit_no_engine— movement.state === 'moving' but engineOn === false
//                         for more than 5 minutes (sensor appears stuck/off)
//   4. frozen_gps       — unit online but lat/lng is 0,0 or null
//   5. low_accuracy     — GPS accuracy > 200m (fix is unreliable)
//   6. fuel_anomaly     — fuelUsedMl < -15L while stationary (slosh excluded)
//
// WHAT REQUIRES BACKEND TELEMETRY HISTORY (not detectable from snapshot):
//   - duplicate_ping    — same capturedAt sent multiple times to ingest.
//     These never reach the frontend (SSE only emits when capturedAt advances).
//     Backend needs to flag these at ingest time and expose via /sensor-health.
//     When that endpoint exists, replace detectAnomalies() contents with:
//       const res = await apiFetch(`/api/v1/organisations/${orgId}/sensor-health`)
//       return res.data
//
// BACKEND INTEGRATION NOTE:
// The shape returned by detectAnomalies matches what a real /sensor-health
// endpoint should return so the UI needs no changes when it's added:
// [{
//   vehicleId:   string,   // cuid
//   vehicleName: string,   // plate
//   type:        string,   // see types above
//   label:       string,   // human-readable
//   severity:    'critical' | 'warning',
//   detail:      string,   // description for the feed
//   detectedAt:  number,   // ms timestamp
// }]

import { useMemo } from "react";
import { useFleetLiveShared } from "../context/FleetLiveContext";
import { isDark, darkAgeLabel } from "../lib/vehicleMap";

const FIVE_MINS_MS = 5 * 60 * 1000;

function detectAnomalies(vehicles) {
  const anomalies = [];
  const now = Date.now();

  for (const v of vehicles) {
    const vid  = v.vehicleId ?? v.id;
    const name = v.id;

    // ── 1. Signal lost ───────────────────────────────────────────────────────
    //
    // Three genuinely different situations, and "last seen ? ago" described
    // none of them. isDark() returns true when a vehicle has NO timestamp at
    // all, and darkAgeLabel() returns '?' in that same case — so every unit
    // that never reported read as though we had simply mislaid the duration.
    // Measured on the live Sukari fleet: 313 of 406 rows said "? ago", one for
    // every vehicle with no Wialon unit bound. There is no elapsed time to
    // print for those, because nothing ever arrived to start the clock.
    //
    // So say which it is — and, since 2026-08-10, classify it differently too.
    // A unit with no tracker is not a fault, so it no longer carries
    // signal_lost and no longer lands in the Malfunction tab; see the
    // `no_tracker` note in SensorPanel's ANOMALY_META for the measurements.
    if (isDark(v)) {
      const age = darkAgeLabel(v);              // '?' when nothing ever arrived
      const everReported = age !== "?";

      // The device id is the ground truth, and it is the only test that works
      // on every backend. `connectionOnline` — the previous test — is the
      // provider's netconn verdict, which an API-only fleet-server never
      // populates at all, so on one of those EVERY vehicle read as "no tracker
      // fitted". Verified against Wialon 2026-08-10: all 284 Sukari vehicles
      // with a `wialon:` device exist in the account; all 313 with a UUID
      // device exist in it zero times. `connectionOnline` stays as a fallback
      // for a provider that does not use the `wialon:` prefix.
      const hasTracker = typeof v.deviceId === "string"
        ? /^wialon:/.test(v.deviceId)
        : v.connectionOnline != null;

      const [label, detail] =
        everReported ? ["Signal Lost",       `No ping received, last seen ${age} ago`]
      : hasTracker   ? ["Never Reported",    "Tracker is bound but has never sent a ping"]
      :                ["No Tracker Fitted", "No tracker is bound to this vehicle, nothing can report"];

      anomalies.push({
        vehicleId:   vid,
        vehicleName: name,
        // Only the first two are sensor faults. The third is a gap in fleet
        // coverage and belongs to the Coverage KPI, not to Malfunction.
        type:        hasTracker || everReported ? "signal_lost" : "no_tracker",
        label,
        severity:    hasTracker || everReported ? "warning" : "info",
        detail,
        detectedAt:  now,
      });
    }

    // ── 2. Speed reported but engine off (current ping) ──────────────────────
    if (v.speed != null && v.speed > 2 && v.engine === 'off') {
      anomalies.push({
        vehicleId:   vid,
        vehicleName: name,
        type:        "speed_no_engine",
        label:       "Speed Without Engine",
        severity:    "critical",
        detail:      `${Math.round(v.speed ?? 0)} km/h reported while engine is off`,
        detectedAt:  now,
      });
    }

    // ── 3. In transit but engine sensor off for > 5 minutes ─────────────────
    // movement.state === 'moving' means the backend's movement tracker
    // confirmed this vehicle is moving. movement.since = when that started.
    // If the engine reads OFF during sustained movement, the engine sensor
    // is likely malfunctioning or disconnected.
    if (
      v.movement?.state === "moving" &&
      v.engine === 'off' &&
      v.movement?.since != null
    ) {
      const movingSince = new Date(v.movement.since).getTime();
      const movingDuration = now - movingSince;
      if (movingDuration > FIVE_MINS_MS) {
        const mins = Math.round(movingDuration / 60000);
        anomalies.push({
          vehicleId:   vid,
          vehicleName: name,
          type:        "transit_no_engine",
          label:       "Engine Sensor Off in Transit",
          severity:    "warning",
          detail:      `Vehicle moving for ${mins} min but engine sensor reads OFF, sensor may be disconnected`,
          detectedAt:  now,
        });
      }
    }

    // ── 4. GPS frozen (0,0 or null while online) ─────────────────────────────
    if (v.online && (v.lat == null || v.lng == null || (v.lat === 0 && v.lng === 0))) {
      anomalies.push({
        vehicleId:   vid,
        vehicleName: name,
        type:        "frozen_gps",
        label:       "GPS Not Reporting",
        severity:    "warning",
        detail:      "Unit is online but sending no valid GPS coordinates",
        detectedAt:  now,
      });
    }

    // ── 5. Low GPS accuracy ──────────────────────────────────────────────────
    if (v.accuracyM != null && v.accuracyM > 200) {
      anomalies.push({
        vehicleId:   vid,
        vehicleName: name,
        type:        "low_accuracy",
        label:       "Poor GPS Accuracy",
        severity:    "warning",
        detail:      `Last fix accuracy: ${Math.round(v.accuracyM)}m, position unreliable`,
        detectedAt:  now,
      });
    }

    // ── 6. Fuel anomaly — stationary only, 15L threshold ────────────────────
    // Only flagged when stationary (speedKmh < 2) to exclude terrain slosh.
    // fuelUsedMl < 0 = sensor reported MORE fuel than before without a refill.
    const isStationary = v.speed == null || v.speed < 2;
    if (v.fuelUsedMl != null && v.fuelUsedMl < -15000 && isStationary) {
      anomalies.push({
        vehicleId:   vid,
        vehicleName: name,
        type:        "fuel_anomaly",
        label:       "Fuel Sensor Anomaly",
        severity:    "warning",
        detail:      `Fuel jumped +${Math.abs(Math.round(v.fuelUsedMl / 1000))}L while stationary, no matching refill event`,
        detectedAt:  now,
      });
    }
  }

  return anomalies;
}

export function useSensorHealth() {
  const { vehicles, loading, error } = useFleetLiveShared();

  const anomalies = useMemo(() => {
    if (!vehicles?.length) return [];
    return detectAnomalies(vehicles);
  }, [vehicles]);

  return { anomalies, loading, error: error?.message ?? null };
}
