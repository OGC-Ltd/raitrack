/* Which sections the Analytics page draws, and which it drops.
 *
 * The rule being pinned is not "hide empty things" — it is WHICH emptiness may
 * be hidden. A section that is still loading, or one whose feed failed, must
 * survive; only a feed that answered and answered with nothing goes. Getting
 * that wrong does not look broken: it produces a page that appears complete and
 * is quietly missing a card, which is the failure nobody reports.
 */

import { describe, it, expect } from "vitest";
import {
  sectionState, showSection, withheldFrom, withheldNote,
  hasRateDays, hasHaulDays, hasHaulUnits, hasFleetUnits, hasFuelPerHour,
  hasActiveDays, hasAreaDays, hasArea,
} from "./analyticsSections";

describe("sectionState", () => {
  it("is loading before the feed answers, whatever it is holding", () => {
    expect(sectionState({ loading: true, hasRows: false })).toBe("loading");
    expect(sectionState({ loading: true, hasRows: true })).toBe("loading");
  });

  it("is an error even while a retry is in flight", () => {
    // A failed section that flipped to "loading" on retry would blink between
    // two explanations; the failure is the thing worth saying.
    expect(sectionState({ loading: true, error: new Error("500") })).toBe("error");
  });

  it("is empty only when the feed answered with nothing", () => {
    expect(sectionState({ hasRows: false })).toBe("empty");
    expect(sectionState({ hasRows: true })).toBe("ready");
  });

  it("treats a bare call as empty rather than throwing", () => {
    expect(sectionState()).toBe("empty");
  });
});

describe("showSection", () => {
  it("draws everything but a definite emptiness", () => {
    expect(showSection("ready")).toBe(true);
    expect(showSection("loading")).toBe(true);
    // The one that matters: a broken feed must not vanish. A page that looks
    // complete and is short of a card is a page nobody questions.
    expect(showSection("error")).toBe(true);
    expect(showSection("empty")).toBe(false);
  });
});

describe("the feeds' own predicates", () => {
  it("wants a day with a RATE, not merely a day", () => {
    // The series carries one entry per day in the window whether or not the
    // day had enough behind it to measure — so a month of unmeasured days is a
    // full array and an empty chart.
    expect(hasRateDays({ days: [{ day: "2026-09-01", litresPerKm: null, litresPerHa: null }] }))
      .toBe(false);
    expect(hasRateDays({ days: [{ day: "2026-09-01", litresPerKm: 0.42 }] })).toBe(true);
    expect(hasRateDays(null)).toBe(false);
  });

  it("tells a haulage fleet's two sections apart", () => {
    // Days without units happens: a run is dispatched and no unit on it is
    // tracked. The chart has something to draw and the table does not.
    const hauls = { days: [{ day: "2026-09-01", tonnes: 40 }], units: [] };
    expect(hasHaulDays(hauls)).toBe(true);
    expect(hasHaulUnits(hauls)).toBe(false);
  });

  it("wants hours AND litres before drawing litres per hour", () => {
    const hours = { units: [{ hoursMonthAvg: 6, fuelBurnL: null, fuelDropL: null }] };
    const both  = { units: [{ hoursMonthAvg: 6, fuelBurnL: 120 }] };
    expect(hasFuelPerHour(hours)).toBe(false);
    expect(hasFuelPerHour(both)).toBe(true);
  });

  it("counts a day the fleet ran, not a day on the calendar", () => {
    expect(hasActiveDays([{ day: "2026-09-01", trips: 0 }])).toBe(false);
    expect(hasActiveDays([{ day: "2026-09-01", trips: 3 }])).toBe(true);
    expect(hasActiveDays([])).toBe(false);
  });

  it("counts ground actually worked", () => {
    // `m2`, which is what a DAY row carries. This test used to say `areaM2`
    // here — the same wrong field the gate itself was reading — so it passed
    // against a shape the server has never sent and the bug it was meant to
    // catch lived behind it.
    expect(hasAreaDays({ days: [{ day: "2026-09-01", m2: 0 }] })).toBe(false);
    expect(hasAreaDays({ days: [{ day: "2026-09-01", m2: 12_000 }] })).toBe(true);
    expect(hasArea({ units: [] })).toBe(false);
    expect(hasArea({ units: [{ vehicleId: "v1", areaM2: 400 }] })).toBe(true);
  });

  it("reads a day row as the server actually sends one", () => {
    // The whole shape, verbatim from excavator-area.service's areaByDay, with
    // the figures of a real Mufindi day (2026-09-09, read 2026-09-14). The
    // point is the field NAMES: a unit carries `areaM2` and a day carries
    // `m2`, the two live in one service, and reading one off the other is
    // silent — `?? 0` turns the undefined into a zero and the section is
    // withheld from the only fleet it exists for.
    const fromServer = {
      days: [
        { day: "2026-09-08", m2: 502052, km2: 0.502, machines: 25 },
        { day: "2026-09-09", m2: 453126, km2: 0.453, machines: 27 },
      ],
      totalM2: 955178, measuredDays: 2, windowDays: 30,
    };
    expect(hasAreaDays(fromServer)).toBe(true);
    // And the unit's name must NOT satisfy it, or the next rename puts the
    // card back behind the same gate.
    expect(hasAreaDays({ days: [{ day: "2026-09-09", areaM2: 453126 }] })).toBe(false);
  });

  it("still withholds a month that was measured and empty", () => {
    // The reason this gate exists at all: a run of days with a reading of zero
    // is not the same as a run of days with ground on them, and drawing an
    // empty heatmap over the first is what it was added to stop.
    expect(hasAreaDays({
      days: [{ day: "2026-09-08", m2: 0, km2: 0, machines: 0 },
             { day: "2026-09-09", m2: 0, km2: 0, machines: 0 }],
      measuredDays: 2, windowDays: 30,
    })).toBe(false);
    expect(hasAreaDays({ days: [] })).toBe(false);
    expect(hasAreaDays(null)).toBe(false);
  });

  it("reads the fleet table's own rows", () => {
    expect(hasFleetUnits({ units: [] })).toBe(false);
    expect(hasFleetUnits({ units: [{ vehicleId: "v1" }] })).toBe(true);
    expect(hasFleetUnits(null)).toBe(false);
  });
});

describe("the note at the foot", () => {
  const S = (label, state) => ({ label, state });

  it("names only what was hidden", () => {
    expect(withheldFrom([
      S("Daily activity", "empty"),
      S("Fuel rates", "ready"),
      S("Sales hauls", "empty"),
      S("Fleet state", "error"),
      S("Tonnage", "loading"),
    ])).toEqual(["Daily activity", "Sales hauls"]);
  });

  it("says why, not just how many", () => {
    // "3 sections hidden" invites exactly the question it fails to answer.
    const note = withheldNote(["Daily activity"], { window: "September 2026" });
    expect(note).toBe("Not shown: Daily activity — no records in September 2026.");
  });

  it("blames the filter when there is one", () => {
    // The difference between "this fleet does not do this" and "you narrowed
    // it away" is the difference between reading on and clearing the filter.
    const note = withheldNote(["Sales hauls", "Tonnage"], {
      filtered: true, window: "September 2026",
    });
    expect(note).toBe(
      "Not shown: Sales hauls and Tonnage — no records in September 2026 " +
      "for the units and types selected.",
    );
  });

  it("joins three the way a person would", () => {
    const note = withheldNote(["A", "B", "C"], { window: "August" });
    expect(note).toContain("A, B and C");
  });

  it("is nothing at all when nothing was withheld", () => {
    expect(withheldNote([])).toBeNull();
    expect(withheldNote(undefined)).toBeNull();
  });
});
