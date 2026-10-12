import { describe, it, expect } from "vitest";
import {
  choiceWords, companyForOrgCode, countWhere, decisionWords, duration, fleetMidnight, headline, periodFrom, statusOf,
} from "./alertsView";

describe("periods", () => {
  it("opens at midnight on the fleet's clock, not the browser's", () => {
    // 01:30 in Nairobi on 12 Oct is 22:30 UTC on the 11th.
    const now = Date.parse("2026-10-11T22:30:00Z");
    expect(new Date(fleetMidnight(now)).toISOString()).toBe("2026-10-11T21:00:00.000Z");
    expect(periodFrom("today", now)).toBe("2026-10-11T21:00:00.000Z");
    // Seven days is today and the six before it.
    expect(periodFrom("7d", now)).toBe("2026-10-05T21:00:00.000Z");
  });
});

describe("countWhere", () => {
  const counts = [
    { orgId: "a", kind: "fuel", status: "open", n: 2 },
    { orgId: "a", kind: "speeding", status: "open", n: 5 },
    { orgId: "b", kind: "speeding", status: "escalated", n: 1 },
  ];

  it("sums what the other filters let through", () => {
    expect(countWhere(counts, { status: "open" })).toBe(7);
    expect(countWhere(counts, { orgs: ["b"] })).toBe(1);
    expect(countWhere(counts, { kind: "speeding", status: "open" })).toBe(5);
    expect(countWhere(counts, { orgs: ["a"], kind: "fuel" })).toBe(2);
  });

  it("has nothing to say before the counts arrive", () => {
    expect(countWhere(null, {})).toBeNull();
  });
});

describe("an alert's decision in words", () => {
  it("names the escalation's reason, and a de-escalation by its kind", () => {
    expect(statusOf({ kind: "fuel", status: "escalated", decision: { reason: "probe_fault" } }))
      .toEqual({ label: "Escalated", tone: "inc", meaning: "faulty fuel probe" });
    expect(statusOf({ kind: "speeding", status: "deescalated", decision: {} }).meaning).toBe("not an overspeed");
    expect(decisionWords("fuel", { outcome: "ESCALATED", reason: "theft" })).toBe("Escalated as confirmed theft");
    expect(decisionWords("speeding", { outcome: "DEESCALATED" })).toBe("De-escalated as not an overspeed");
  });

  it("says why an open fuel alert is off the map", () => {
    expect(statusOf({ kind: "fuel", status: "open", cleared: "unit" }).meaning).toMatch(/another alert on this unit/);
    expect(statusOf({ kind: "fuel", status: "open", cleared: null, fuel: { live: true } }).meaning).toBe("on the map now");
  });

  it("words each decision for the button that makes it", () => {
    expect(choiceWords("fuel", { outcome: "ESCALATED", reason: "probe_fault" }).confirm).toBe("Escalate as faulty fuel probe");
    expect(choiceWords("fuel", { outcome: "DEESCALATED", reason: null }).label).toBe("Not a theft");
    expect(choiceWords("speeding", { outcome: "ESCALATED", reason: null }).confirm).toBe("Escalate as a confirmed overspeed");
  });
});

describe("figures", () => {
  it("states what happened in one figure", () => {
    expect(headline({ kind: "fuel", fuel: { litres: 23.44 } })).toEqual({ figure: "23.4 L", words: "lost" });
    expect(headline({ kind: "speeding", speeding: { peakKmh: 104.4, limitKmh: 80 } })).toEqual({ figure: "104 km/h", words: "in 80 km/h" });
  });

  it("reads a duration the way a person would say it", () => {
    expect(duration(45)).toBe("45 s");
    expect(duration(190)).toBe("3 min");
    expect(duration(3900)).toBe("1 h 05 min");
  });

  it("finds the dashboard's company for an organisation code", () => {
    expect(companyForOrgCode("WESTSUGAR")).toBe("westsugar");
    expect(companyForOrgCode("nowhere")).toBeNull();
  });
});
