import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../services/api";
import { isOpenTheftCase, latestCase, furthestUnit, pickDefaultUnit } from "./fuelReportDefault";

const siphon = (o = {}) => ({ id: "d", vehicleId: "v1", verdict: "DRAIN", drainCause: "SIPHON", beganAt: "2026-10-07T07:30:00Z", finalFuelLevelMl: 120000, measuredDropMl: 24000, ...o });
const known = new Set(["v1", "v2", "v3"]);

describe("isOpenTheftCase", () => {
  it("takes a standing siphon", () => expect(isOpenTheftCase(siphon())).toBe(true));
  it("drops other causes and verdicts", () => {
    expect(isOpenTheftCase(siphon({ drainCause: "SLOSH" }))).toBe(false);
    expect(isOpenTheftCase(siphon({ verdict: "REDISTRIBUTION" }))).toBe(false);
  });
  it("drops dismissed, reviewed-away and dead-probe cases", () => {
    expect(isOpenTheftCase(siphon({ dismissedAt: "2026-10-07T09:00:00Z" }))).toBe(false);
    expect(isOpenTheftCase(siphon({ reviewStatus: "NOT_THEFT" }))).toBe(false);
    expect(isOpenTheftCase(siphon({ reviewStatus: "PROBE_FAULT" }))).toBe(false);
    expect(isOpenTheftCase(siphon({ finalFuelLevelMl: 0 }))).toBe(false);
    expect(isOpenTheftCase(siphon({ reviewStatus: "CONFIRMED_THEFT" }))).toBe(true);
  });
});

describe("latestCase / furthestUnit", () => {
  it("picks the newest open case on a known unit", () => {
    const rows = [
      siphon({ vehicleId: "zz", beganAt: "2026-10-08T05:00:00Z" }),
      siphon({ vehicleId: "v2", beganAt: "2026-10-06T05:00:00Z" }),
      siphon({ vehicleId: "v3", beganAt: "2026-10-07T05:00:00Z" }),
    ];
    expect(latestCase(rows, known).vehicleId).toBe("v3");
  });
  it("picks the most km today, ignoring units that did not move", () => {
    const units = [{ vehicleId: "v1", distanceTodayKm: 12 }, { vehicleId: "v2", distanceTodayKm: 80 }, { vehicleId: "zz", distanceTodayKm: 900 }];
    expect(furthestUnit(units, known).vehicleId).toBe("v2");
    expect(furthestUnit([{ vehicleId: "v1", distanceTodayKm: 0 }], known)).toBe(null);
  });
});

describe("pickDefaultUnit", () => {
  const now = Date.parse("2026-10-08T09:00:00Z"); // 12:00 in Nairobi
  beforeEach(() => apiFetch.mockReset());

  it("opens on the latest case, over its fleet day", async () => {
    apiFetch.mockResolvedValueOnce({ data: [siphon({ vehicleId: "v2" })], hasNextPage: false });
    const pick = await pickDefaultUnit({ orgId: "o", vehicleIds: [...known], now });
    expect(pick).toMatchObject({ unitId: "v2", reason: "theft", litres: 24 });
    expect(pick.from).toBe(Date.parse("2026-10-07T00:00:00+03:00"));
    expect(pick.to).toBe(Date.parse("2026-10-08T00:00:00+03:00"));
  });

  it("reads further pages before giving up on a case", async () => {
    apiFetch
      .mockResolvedValueOnce({ data: [siphon({ drainCause: "SLOSH" })], hasNextPage: true, cursor: "c1" })
      .mockResolvedValueOnce({ data: [siphon({ vehicleId: "v3" })], hasNextPage: false });
    const pick = await pickDefaultUnit({ orgId: "o", vehicleIds: [...known], now });
    expect(pick.unitId).toBe("v3");
    expect(apiFetch.mock.calls[1][0]).toContain("cursor=c1");
  });

  it("falls back to the furthest unit today, to now", async () => {
    apiFetch
      .mockResolvedValueOnce({ data: [], hasNextPage: false })
      .mockResolvedValueOnce({ data: { units: [{ vehicleId: "v1", distanceTodayKm: 40 }, { vehicleId: "v3", distanceTodayKm: 95 }] } });
    const pick = await pickDefaultUnit({ orgId: "o", vehicleIds: [...known], now });
    expect(pick).toMatchObject({ unitId: "v3", reason: "distance", km: 95, to: now });
    expect(pick.from).toBe(Date.parse("2026-10-08T00:00:00+03:00"));
  });

  it("returns null when nothing qualifies", async () => {
    apiFetch.mockResolvedValueOnce({ data: [], hasNextPage: false }).mockResolvedValueOnce({ data: { units: [] } });
    expect(await pickDefaultUnit({ orgId: "o", vehicleIds: [...known], now })).toBe(null);
  });
});
