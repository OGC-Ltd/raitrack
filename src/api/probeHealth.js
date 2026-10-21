// Probe and sensor health — what is fitted to each unit, whether it works,
// when it last worked and what it last read.
//
// Distinct from the live snapshot the probe grid renders. That answers "what is
// this channel reading now" and cannot answer "when did it stop", so a probe
// dead for a week and one never installed both draw a dash. Every question an
// operator asks about a faulty probe is a question about history, and the
// history lives on the server.
//
// The server crosses two independent facts per unit:
//
//   FITTED  the provider's own sensor configuration. A fuel sensor with no
//           calibration table can never produce litres and reports no fault
//           either, so nothing else on the fleet can see it.
//   ALIVE   telemetry over the last 30 days: last reading, last non-zero
//           reading, and the value that came with it.
//
// Crossed, they separate a probe to service from a Wialon record to finish.

import { apiFetch } from "../services/api";

/**
 * @param {{ orgId: string, state?: 'faulty'|'healthy' }} opts
 * @returns {Promise<{rows: object[], summary: object, generatedAt: string}|null>}
 */
export async function getProbeHealth({ orgId, state } = {}) {
  if (!orgId) return null;
  const qs = state ? `?state=${encodeURIComponent(state)}` : "";
  const res = await apiFetch(`/api/v1/organisations/${orgId}/fuel/probe-health${qs}`);
  return res.data ?? null;
}

// ── how the states read ──────────────────────────────────────────────────────
//
// Labels describe what was OBSERVED, never what we guess caused it. The first
// version said "Never reported" for SILENT and "No probe fitted" for
// NOT_FITTED, and both were wrong in ways that sent people to the wrong place.
//
// Measured across the fleet on 2026-08-20, every combination that actually
// occurs:
//
//     probe        sensor          units
//     OK           calibrated       307
//     SILENT       calibrated        30
//     NOT_FITTED   uncalibrated      24
//     UNKNOWN      calibrated        18
//     DIED         calibrated        12
//     (three singletons)              3
//
// Two things fall out of that table, and both changed the wording.
//
// SILENT does NOT mean the probe said nothing. It means the unit sends a fuel
// reading and every one of them is zero — `KTCC 202G` has 23,740 readings, a
// 32-point calibration table, and has never once been above 0 L. "Never
// reported" described silence that is not there.
//
// NOT_FITTED × calibrated is ZERO units. Every NOT_FITTED row has an
// uncalibrated sensor, which is the mechanism: no calibration table means
// `calibrateFuel` returns null, so no level is ever stored, so the classifier
// sees no fuel channel. Calling that "no probe fitted" asserted the hardware is
// absent when the real fault is a record nobody finished.

export const PROBE_STATE_LABEL = {
  OK:         "Reading",
  DIED:       "Stopped reading",
  // The correction that matters: it reports, and it reports empty.
  SILENT:     "Always reads 0 L",
  // What we can actually see. Whether hardware exists is a separate question,
  // answered by the sensor column beside it.
  NOT_FITTED: "No level reported",
  UNKNOWN:    "Too few readings",
};

export const CHANNEL_STATE_LABEL = {
  REPORTING:     "Working",
  NOT_REPORTING: "Stopped reporting",
  NOT_FITTED:    "Not fitted",
  UNKNOWN:       "Too few readings",
};

/** Which states mean somebody should go and look. NOT_FITTED is not one of
 *  them on its own: the sensor column decides whether that is a fault. */
export const FAULTY_PROBE_STATES = new Set(["DIED", "SILENT"]);

/**
 * What to do about this unit, in the words of whoever has to do it.
 *
 * Decided on the CROSS of probe state and sensor configuration, never on the
 * probe state alone — that is the whole reason both are carried. The same
 * "no fuel reading" symptom is a workshop visit in one row and ten minutes in
 * the Wialon account in the next, and the earlier version could not tell them
 * apart because it only looked at the probe.
 *
 * Ordered by how specific the diagnosis is. The calibration fault is tested
 * first because it EXPLAINS the probe state sitting beside it: with no table
 * no level can be computed, so the probe necessarily reads as absent, and
 * sending a fitter to that machine finds nothing wrong with the hardware.
 */
export function faultAction(row) {
  const probe  = row.fuelProbe?.state;
  const sensor = row.fuelSensor;

  // First, because it is upstream of every other question here. A tracker that
  // has said nothing for weeks makes every channel on the unit unjudgeable, so
  // "the fuel probe is unknown" is a symptom and this is the cause. 66 of
  // SUKARI's 284 tracked units are in this state.
  if (row.trackerSilent) return "Tracker silent, check the device";

  // A record nobody finished. Desk work, not a workshop job.
  if (sensor?.uncalibrated) return "Add calibration table in Wialon";

  // Calibrated, the unit is reporting, and the reading is zero every time.
  // The configuration is sound, so the fault is between the tank and the probe.
  if (probe === "SILENT") return "Probe reads empty, check probe fitting and wiring";

  // Read real levels, then went flat. The date it stopped is in the row.
  if (probe === "DIED") return "Probe stopped, inspect probe and wiring";

  // A channel that has gone quiet is a fault, and it comes before the two
  // fuel lines below, which are not: a unit with a dead GPS read "No fuel
  // monitoring" or "barely reporting" (KBL 126W, 2026-10-21) — and a dead GPS
  // is what starves a unit of telemetry in the first place.
  const quiet = Object.entries(row.channels ?? {})
    .filter(([, c]) => c.state === "NOT_REPORTING")
    .map(([k]) => k);
  if (quiet.length) return `Stopped reporting: ${quiet.join(", ")}`;

  // No sensor on the unit at all: nothing is broken, nothing is monitored.
  if (probe === "NOT_FITTED" && !sensor?.fitted) return "No fuel monitoring on this unit";

  // Not enough telemetry to judge the fuel channel — the tracker is the
  // problem before the probe is.
  if (probe === "UNKNOWN") return "Unit barely reporting, check the tracker";

  return "";
}
