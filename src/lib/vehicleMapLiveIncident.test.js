/**
 * The CRITICAL count moves without a page reload.
 *
 * A unit is critical when it carries an open fuel THEFT incident, and that
 * incident used to arrive from one place only: the snapshot read at page load.
 * Position frames cannot carry a fuel verdict, and the minute-by-minute
 * snapshot re-read took the connection verdict alone, carrying the old theft
 * state forward. A theft raised with the page open never reached the count.
 *
 * It now arrives two ways: pushed (`fuel_incident`, applyFuelIncident) the
 * moment the server rebuilds the snapshot, and on that same re-read
 * (applyConnectionRefresh) as the backstop.
 */

import { describe, it, expect } from "vitest";
import { mapSnapshotVehicle, applyFuelIncident, applyConnectionRefresh } from "./vehicleMap";
import { countStatuses } from "./fleetStatusStats";

const snapshotRow = (over = {}) => ({
  vehicleId: "v1", plate: "KTCC 206P", lat: -0.5, lng: 34.5,
  speedKmh: 0, engineOn: false, connectionOnline: true,
  capturedAt: new Date().toISOString(), movement: { state: "parked" },
  zones: { inside: [] }, fuelIncident: null, ...over,
});
const theft = (id = "inc-1", over = {}) => ({ id, mayUseTheftWording: true, confidence: 0.9, ...over });

describe("a fuel incident pushed on the stream", () => {
  it("turns a quiet unit critical, and the count with it", () => {
    const before = mapSnapshotVehicle(snapshotRow());
    expect(countStatuses([before]).critical).toBe(0);

    const after = applyFuelIncident(before, theft());
    expect(after.status).toBe("theft");
    expect(after.fuelIncident.id).toBe("inc-1");
    expect(countStatuses([after]).critical).toBe(1);
  });

  it("clears it again when the incident is retracted", () => {
    const red = mapSnapshotVehicle(snapshotRow({ fuelIncident: theft() }));
    const cleared = applyFuelIncident(red, null);
    expect(cleared.status).not.toBe("theft");
    expect(cleared.fuelIncident).toBeNull();
    expect(countStatuses([cleared]).critical).toBe(0);
  });

  it("ignores a finding that is not a theft case (FUEL DOWN goes to the daily summary)", () => {
    const v = mapSnapshotVehicle(snapshotRow());
    expect(applyFuelIncident(v, { id: "inc-2", mayUseTheftWording: false })).toBe(v);
  });

  it("leaves the unit untouched when nothing changed, so nothing redraws", () => {
    const red = mapSnapshotVehicle(snapshotRow({ fuelIncident: theft() }));
    expect(applyFuelIncident(red, theft())).toBe(red);
  });

  it("takes a review on the same incident in place", () => {
    const red = mapSnapshotVehicle(snapshotRow({ fuelIncident: theft() }));
    const reviewed = applyFuelIncident(red, theft("inc-1", { review: { status: "CONFIRMED_THEFT" } }));
    expect(reviewed.fuelIncident.review.status).toBe("CONFIRMED_THEFT");
    expect(reviewed.status).toBe("theft");
  });
});

describe("the minute-by-minute snapshot re-read", () => {
  it("picks up a theft raised since page load, even when the connection is unchanged", () => {
    const v = mapSnapshotVehicle(snapshotRow());
    const after = applyConnectionRefresh(v, snapshotRow({ fuelIncident: theft() }));
    expect(after.status).toBe("theft");
    expect(countStatuses([after]).critical).toBe(1);
  });

  it("drops a theft the server no longer holds open", () => {
    const red = mapSnapshotVehicle(snapshotRow({ fuelIncident: theft() }));
    const after = applyConnectionRefresh(red, snapshotRow({ fuelIncident: null }));
    expect(after.status).not.toBe("theft");
  });

  it("returns the same unit when neither the connection nor the incident moved", () => {
    const red = mapSnapshotVehicle(snapshotRow({ fuelIncident: theft() }));
    expect(applyConnectionRefresh(red, snapshotRow({ fuelIncident: theft() }))).toBe(red);
  });

  it("keeps the incident it holds when a row carries no incident field at all", () => {
    const red = mapSnapshotVehicle(snapshotRow({ fuelIncident: theft() }));
    const row = snapshotRow({ connectionOnline: false });
    delete row.fuelIncident;
    const after = applyConnectionRefresh(red, row);
    expect(after.status).toBe("theft");
  });
});
