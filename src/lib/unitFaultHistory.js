// One unit's fault history as messages, newest first (operator, 2026-11-27:
// "probe disconnected, probe reconnected. such messages"). Two sources:
//
//   - our fault episodes (sensor_fault_episodes): a start, and a recovery once
//     the unit reads normally again. The tracker's own probe fault carries its
//     reason in `detail` ("Fuel probe: Lost Contact with Tubes Error ...").
//   - Wialon's "Fuel Probe Disconnection Alert" rules, read for this one unit:
//     runs of alerts. A disconnected probe alerts about once a minute, so the
//     alerts stopping is the reconnection.
//
// Pure: the panel fetches, this only words and orders.

import { faultLabel } from "../api/incidents";

/** Alerts this far apart are separate disconnections (server RUN_GAP_MS). */
export const WIALON_RUN_GAP_MS = 30 * 60_000;

const BACK = {
  fuel_probe_fault:           "Fuel probe reading again",
  fuel_probe_dead:            "Fuel probe reading again",
  fuel_probe_status:          "Fuel probe status normal",
  fuel_probe_battery:         "Fuel probe battery OK",
  gnss_fault:                 "GPS fix back",
  signal_lost:                "Tracker back online",
  frozen_gps:                 "Position fix back",
  low_accuracy:               "Position accurate again",
  gps_not_reporting:          "GPS reporting again",
  ignition_not_reporting:     "Ignition reporting again",
  odometer_not_reporting:     "Odometer reporting again",
  engine_hours_not_reporting: "Engine hours reporting again",
  transit_no_engine:          "Ignition back to normal",
  speed_no_engine:            "Ignition back to normal",
};

/** Kinds whose record carries the tracker's own words ("Fuel probe: Status Error", "GPS: On without Fix"). */
const TRACKER_WORDS = new Set(["fuel_probe_fault", "fuel_probe_status", "fuel_probe_battery", "gnss_fault"]);

const ms = (v) => {
  const t = typeof v === "number" ? v : Date.parse(v ?? "");
  return Number.isFinite(t) ? t : null;
};

/**
 * @param {Array} episodes  fault episodes as the incidents list returns them
 * @param {Array} disconnections  probe report rows: { at, to, alerts } in ms
 * @returns {Array<{ key, at, text, ok, open, source, durationMs }>} newest first
 */
export function faultMessages(episodes = [], disconnections = [], now = Date.now()) {
  const out = [];
  for (const e of episodes) {
    const start = ms(e.startedAt);
    if (start == null) continue;
    const end = ms(e.recoveredAt);
    const fault = TRACKER_WORDS.has(e.kind) && e.detail ? e.detail : faultLabel(e.kind);
    out.push({ key: `${e.id}:start`, at: start, text: fault, ok: false, open: end == null, source: "System", durationMs: null });
    if (end != null) {
      out.push({ key: `${e.id}:end`, at: end, text: BACK[e.kind] ?? `${faultLabel(e.kind)}: cleared`, ok: true, open: false, source: "System", durationMs: end - start });
    }
  }
  for (const d of disconnections) {
    const start = ms(d.at);
    if (start == null) continue;
    const last = ms(d.to) ?? start;
    // Still alerting (within one run gap of now): not reconnected yet.
    const open = now - last < WIALON_RUN_GAP_MS;
    out.push({ key: `w:${start}:start`, at: start, text: "Probe disconnected", ok: false, open, source: "Wialon", durationMs: null });
    if (!open) out.push({ key: `w:${start}:end`, at: last, text: "Probe reconnected", ok: true, open: false, source: "Wialon", durationMs: last - start });
  }
  // Newest first; at the same moment the recovery reads above the fault it ends.
  return out.sort((a, b) => b.at - a.at || Number(b.ok) - Number(a.ok));
}
