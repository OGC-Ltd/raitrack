/**
 * Idle-alert logic — pure functions, no React, no imports from the app.
 *
 * These run on the frontend today; when this moves to the backend, copy this
 * file into the server (Node.js) unchanged and swap the data source.
 *
 * A unit is "idle" when:
 *   - Its speed has been below MOVING_SPEED_KMH for the entire threshold period.
 *   - Idle = not moving. Engine state does not matter — a unit with the engine
 *     off and not moving for 3+ hours is still flagged (it may have broken down
 *     or been abandoned).
 *
 * Alerts do NOT clear automatically. Once an alert is raised it stays until a
 * user explicitly dismisses it. If a unit moves and stops again, a NEW alert
 * is created for that new idle period.
 *
 * ---
 * Backend contract (what /api/v1/idle-alerts should return when it exists):
 * {
 *   alerts: [
 *     {
 *       id:          string,       // e.g. "idle:KCE780B:1700000000"
 *       plate:       string,       // "KCE 780B"
 *       size:        string,       // "PROBOX"
 *       designation: string,       // "GT/MT"
 *       location:    string,       // last known location name
 *       lat:         number|null,
 *       lng:         number|null,
 *       idleSinceMs: number,       // unix ms when the unit stopped moving
 *       durationMs:  number,       // how long it has been stationary
 *       speed:       number,       // km/h at last update
 *       engine:      "on"|"off"|null,
 *       severity:    "warning"|"critical",  // warning=3h, critical=6h
 *       dismissed:   false,        // server always sends false (dismissals stored client-side until DB is ready)
 *     }
 *   ],
 *   generatedAt: number,  // unix ms
 * }
 */

/** Speed below which we treat a unit as not moving (km/h). */
export const MOVING_SPEED_KMH = 2;

/** Idle duration that escalates from warning → critical (6 hours). */
export const CRITICAL_THRESHOLD_MS = 6 * 60 * 60 * 1000;

/**
 * Given a list of unit position snapshots and a threshold, return idle alerts.
 *
 * "idleSinceMs" is the timestamp when the unit last had speed >= MOVING_SPEED_KMH.
 * If the unit has never moved in the data we have, use its firstSeenMs.
 *
 * @param {Array<{
 *   plate: string,
 *   size?: string,
 *   designation?: string,
 *   location?: string,
 *   lat?: number,
 *   lng?: number,
 *   idleSinceMs: number,   // unix ms — when the unit last stopped moving
 *   speed?: number,        // km/h at last check
 *   engine?: "on"|"off",
 * }>} units
 * @param {number} thresholdMs  — idle threshold in ms (default 3 h)
 * @param {number} [nowMs]      — current time in ms (defaults to Date.now())
 * @returns {Array}             — idle alert objects (see backend contract above)
 */
export function detectIdleAlerts(units, thresholdMs, nowMs = Date.now()) {
  const alerts = [];

  for (const unit of units) {
    const { plate, size = "", designation = "", location = "", lat = null, lng = null,
            idleSinceMs, speed = 0, engine = null } = unit;

    // Unit is currently moving — do not create an alert.
    if ((speed ?? 0) >= MOVING_SPEED_KMH) continue;

    const durationMs = nowMs - idleSinceMs;
    if (durationMs < thresholdMs) continue;

    alerts.push({
      id:          `idle:${plate.replace(/\s/g, "")}:${idleSinceMs}`,
      plate,
      size,
      designation,
      location,
      lat,
      lng,
      idleSinceMs,
      durationMs,
      speed,
      engine,
      severity:    durationMs >= CRITICAL_THRESHOLD_MS ? "critical" : "warning",
      dismissed:   false,
    });
  }

  // Sort most critical / longest idle first.
  alerts.sort((a, b) => b.durationMs - a.durationMs);
  return alerts;
}

/**
 * Format idle duration as a human string, e.g. "3 h 42 min" or "1 d 2 h".
 * @param {number} ms
 */
export function idleDuration(ms) {
  const totalMin = Math.floor(ms / 60_000);
  const days  = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins  = totalMin % 60;

  if (days > 0)  return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

/**
 * Merge a backend alert list with locally-stored dismissed IDs.
 * Alerts whose id is in dismissedIds are filtered out.
 *
 * @param {Array} alerts
 * @param {Set<string>} dismissedIds
 */
export function applyDismissals(alerts, dismissedIds) {
  if (!dismissedIds.size) return alerts;
  return alerts.filter((a) => !dismissedIds.has(a.id));
}
