/**
 * Generators have no speed (operator, 2026-11-26: "on the generators they do
 * not have speed, should be blank and never have speed limit configurations at
 * all").
 *
 * What these pin: the ten generators on the platform as they arrived that day
 * — Mufindi's "DG nn" and Menengai's "GENSET" units, every one typed
 * UNSPECIFIED and sent an 80 km/h limit — come out with no speed, no limit and
 * never "speeding", and a live frame cannot put either back. A truck beside
 * them keeps both.
 */

import { describe, it, expect } from "vitest";
import { mapSnapshotVehicle, applyLiveUpdate, hasNoSpeed } from "./vehicleMap";

const row = (plate, extra = {}) => ({
  vehicleId: plate, plate, name: plate, vehicleType: "UNSPECIFIED",
  speedKmh: 38, speedLimitKmh: 80, engineOn: true, connectionOnline: true,
  capturedAt: new Date().toISOString(), lat: -4, lng: 30.4, ...extra,
});

describe("generators have no speed", () => {
  it.each([
    "MUFINDI: DG 09", "MUFINDI - DG 13", "MORL FARM EQUIPMENT - GENSET MOLO RIVER", "MORL FARM  - GENSET PACKHOUSE",
  ])("%s is a generator", (plate) => {
    expect(hasNoSpeed({ id: plate, name: plate, vehicleType: "UNSPECIFIED" })).toBe(true);
  });

  it("a generator's tracker speed and the server's limit are dropped", () => {
    const v = mapSnapshotVehicle(row("MUFINDI: DG 09", { speedKmh: 120 }));
    expect(v.noSpeed).toBe(true);
    expect(v.speed).toBeNull();
    expect(v.speedLimit).toBeNull();
    expect(v.status).not.toBe("speeding");
  });

  it("a live frame does not bring speed or overspeeding back", () => {
    const v = mapSnapshotVehicle(row("MUFINDI - DG 13", { speedKmh: 0 }));
    const next = applyLiveUpdate(v, { speedKmh: 95, speedLimitKmh: 80, engineOn: true, flags: { overspeeding: true }, capturedAt: new Date().toISOString() });
    expect(next.speed).toBeNull();
    expect(next.speedLimit).toBeNull();
    expect(next.status).not.toBe("speeding");
  });

  it("a truck keeps its speed and limit", () => {
    const v = mapSnapshotVehicle(row("MUFINDI - FT 13", { speedKmh: 95 }));
    expect(v.noSpeed).toBe(false);
    expect(v.speed).toBe(95);
    expect(v.speedLimit).toBe(80);
    expect(v.status).toBe("speeding");
  });
});
