// What each probe row MEANS, and what somebody should do about it.
//
// This exists because the first version of that wording was wrong on the
// screen: rows carrying a 30-point calibration table and working GPS were
// labelled "Check install — never read". The mistake was deciding the action
// from the probe state alone, when the same "no fuel reading" symptom is a
// workshop visit in one row and ten minutes in the Wialon account in the next.
//
// Every case below is a population that actually exists. Measured across the
// fleet on 2026-08-20:
//
//     probe        sensor          units
//     OK           calibrated       307
//     SILENT       calibrated        30
//     NOT_FITTED   uncalibrated      24
//     UNKNOWN      calibrated        18
//     DIED         calibrated        12
//     (three singletons)              3
//
// Nothing here is hypothetical, and NOT_FITTED × calibrated is deliberately
// absent because it occurs zero times — no calibration table means no level is
// ever stored, so an uncalibrated sensor is the only way to reach NOT_FITTED.

import { describe, it, expect } from "vitest";
import { faultAction, PROBE_STATE_LABEL, FAULTY_PROBE_STATES } from "./probeHealth";

/** A row in the shape the endpoint returns. */
const row = ({
  probe = "OK",
  calibrationPoints = 30,
  fitted = true,
  channels = {},
} = {}) => ({
  plate: "KTCC 202G",
  fuelProbe: { state: probe, lastAliveAt: null, lastValueMl: null },
  fuelSensor: {
    fitted,
    calibrationPoints,
    uncalibrated: fitted && calibrationPoints === 0,
  },
  channels: {
    gps:         { state: "REPORTING" },
    ignition:    { state: "REPORTING" },
    odometer:    { state: "REPORTING" },
    engineHours: { state: "REPORTING" },
    ...channels,
  },
});

describe("faultAction, the same symptom, different jobs", () => {
  it("blames a silent tracker before anything downstream of it", () => {
    // 66 of SUKARI's 284 tracked units: provisioned, bound, and saying nothing
    // for weeks. Every channel reads UNKNOWN because there is nothing to judge,
    // so reporting the probe would name a symptom and hide the cause.
    expect(faultAction({ ...row({ probe: "UNKNOWN" }), trackerSilent: true }))
      .toBe("Tracker silent, check the device");
  });

  it("names a dead GPS ahead of the fuel lines that are not faults", () => {
    // KBL 126W, 2026-10-21: a dead GPS starves the unit of rows, so its fuel
    // probe reads UNKNOWN — and that line used to win, hiding the GPS.
    const gps = { gps: { state: "NOT_REPORTING" } };
    expect(faultAction(row({ probe: "UNKNOWN", channels: gps }))).toBe("Stopped reporting: gps");
    expect(faultAction(row({ probe: "NOT_FITTED", fitted: false, channels: gps }))).toBe("Stopped reporting: gps");
  });

  it("outranks even an uncalibrated sensor", () => {
    // Calibration is the next-most-explanatory fault, but you cannot calibrate
    // your way out of a device that is not transmitting.
    expect(faultAction({
      ...row({ probe: "NOT_FITTED", calibrationPoints: 0 }), trackerSilent: true,
    })).toBe("Tracker silent, check the device");
  });

  it("sends an uncalibrated sensor to Wialon, not to the workshop", () => {
    // 24 units. The sensor exists with no calibration table, so no level can
    // ever be computed — a record nobody finished, not a probe to service.
    expect(faultAction(row({ probe: "NOT_FITTED", calibrationPoints: 0 })))
      .toBe("Add calibration table in Wialon");
  });

  it("tests calibration BEFORE the probe state, because it explains it", () => {
    // The ordering that fixes the original bug. With no table the probe MUST
    // read as absent, so a fitter sent here finds nothing wrong. Even if the
    // probe state looks like a hardware fault, the calibration is the cause.
    expect(faultAction(row({ probe: "SILENT", calibrationPoints: 0 })))
      .toBe("Add calibration table in Wialon");
    expect(faultAction(row({ probe: "DIED", calibrationPoints: 0 })))
      .toBe("Add calibration table in Wialon");
  });

  it("sends a calibrated probe that reads empty to the workshop", () => {
    // 30 units. KTCC 202G: 23,740 readings, a 32-point table, never once above
    // zero. The configuration is sound, so the fault is between tank and probe.
    expect(faultAction(row({ probe: "SILENT", calibrationPoints: 32 })))
      .toBe("Probe reads empty, check probe fitting and wiring");
  });

  it("sends a probe that stopped to the workshop", () => {
    // 12 units. Read real levels, then went flat.
    expect(faultAction(row({ probe: "DIED" })))
      .toBe("Probe stopped, inspect probe and wiring");
  });

  it("does not call a unit with no sensor broken", () => {
    // Nothing is fitted, so nothing is faulty — it is simply unmonitored, and
    // saying so stops it being triaged as a fault every week.
    expect(faultAction(row({ probe: "NOT_FITTED", fitted: false, calibrationPoints: 0 })))
      .toBe("No fuel monitoring on this unit");
  });

  it("blames the tracker before the probe when there is barely any data", () => {
    // 18 units. Too few readings to judge the fuel channel at all.
    expect(faultAction(row({ probe: "UNKNOWN" })))
      .toBe("Unit barely reporting, check the tracker");
  });

  it("says nothing about a healthy unit", () => {
    // 307 units — the overwhelming majority. An action here would be noise on
    // four rows in five.
    expect(faultAction(row())).toBe("");
  });

  it("names a non-fuel channel that has gone quiet", () => {
    expect(faultAction(row({ channels: { gps: { state: "NOT_REPORTING" } } })))
      .toBe("Stopped reporting: gps");
  });

  it("survives a row with fields missing", () => {
    // The endpoint is cached and versioned separately from this bundle; a
    // partial row must not throw and blank the panel.
    expect(() => faultAction({})).not.toThrow();
    expect(faultAction({})).toBe("");
  });
});

describe("labels state the observation, not a guess at the cause", () => {
  it("does not claim a silent probe never reported", () => {
    // It reports constantly. Every reading is zero. "Never reported" described
    // a silence that is not there and sent people looking for a dead unit.
    expect(PROBE_STATE_LABEL.SILENT).toBe("Always reads 0 L");
    expect(PROBE_STATE_LABEL.SILENT).not.toMatch(/never|not reporting/i);
  });

  it("does not claim hardware is absent when only the level is", () => {
    // NOT_FITTED is what the telemetry shows — no level came through. Whether
    // a probe exists is the sensor column's question, not this one's.
    expect(PROBE_STATE_LABEL.NOT_FITTED).toBe("No level reported");
    expect(PROBE_STATE_LABEL.NOT_FITTED).not.toMatch(/fitted|install/i);
  });

  it("keeps every state labelled", () => {
    for (const s of ["OK", "DIED", "SILENT", "NOT_FITTED", "UNKNOWN"]) {
      expect(PROBE_STATE_LABEL[s], `${s} has no label`).toBeTruthy();
    }
  });

  it("counts only the two states that mean a probe is at fault", () => {
    // NOT_FITTED is excluded on purpose: on its own it is a configuration
    // question, and counting it would put 24 desk jobs on a workshop list.
    expect([...FAULTY_PROBE_STATES].sort()).toEqual(["DIED", "SILENT"]);
  });
});
