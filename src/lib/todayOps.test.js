/* The day's three figures.
 *
 * Worth pinning because every one of these rules exists to avoid a specific
 * wrong answer, and each would still "work" if it were broken — the figures
 * would just be quietly too low, or count the same machine twice.
 *
 * Proportions are KASULU's, measured 2026-08-22: 218 units, 34 of which had
 * run at some point in the day, 23.1 engine hours between them.
 */

import { describe, it, expect } from "vitest";
import { summariseToday } from "./todayOps";

const unit = (hoursToday, distanceTodayKm = 0) => ({ hoursToday, distanceTodayKm });

describe("summariseToday", () => {
  it("is null before anything has loaded, which is not the same as an idle fleet", () => {
    expect(summariseToday(undefined)).toBeNull();
    expect(summariseToday([])).toBeNull();
  });

  it("counts a unit whose engine ran as operational, moving or not", () => {
    // The excavator case: hours on the clock, nowhere travelled. A definition
    // built on movement would call this pit idle.
    const out = summariseToday([unit(6.2, 0), unit(0, 0)]);
    expect(out.operational).toBe(1);
    expect(out.nonOperational).toBe(1);
  });

  it("counts a unit that moved as operational even with no engine hours", () => {
    const out = summariseToday([unit(0, 4.5), unit(0, 0)]);
    expect(out.operational).toBe(1);
  });

  it("counts a unit that never ran and never moved as non-operational", () => {
    const out = summariseToday([unit(0, 0), unit(0, 0), unit(3, 1)]);
    expect(out.nonOperational).toBe(2);
    expect(out.operational).toBe(1);
  });

  it("always adds up to the fleet on screen", () => {
    const units = [unit(1), unit(0), unit(0, 2), unit(0), unit(9.5, 40)];
    const out = summariseToday(units);
    expect(out.operational + out.nonOperational).toBe(units.length);
  });

  it("counts a machine that stopped and resumed ONCE, with all of its hours", () => {
    // The operator's example: the row already carries the day's total, so a
    // mid-day stand-down is not a second machine.
    const out = summariseToday([unit(7.5), unit(0)]);
    expect(out.operational).toBe(1);
    expect(out.totalHours).toBe(7.5);
    expect(out.avgHours).toBe(7.5);
  });

  it("averages over the machines that WORKED, not over the yard", () => {
    // Ten of twenty running four hours each is a four-hour average, not two.
    const units = [
      ...Array.from({ length: 10 }, () => unit(4)),
      ...Array.from({ length: 10 }, () => unit(0)),
    ];
    const out = summariseToday(units);
    expect(out.operational).toBe(10);
    expect(out.avgHours).toBe(4);
  });

  it("holds that average as the fleet grows around it", () => {
    // The understating bug at fleet scale: 34 working out of 218. Dividing by
    // the yard would report 0.11 h against a true 0.68.
    const units = [
      ...Array.from({ length: 34 }, () => unit(23.1 / 34)),
      ...Array.from({ length: 184 }, () => unit(0)),
    ];
    const out = summariseToday(units);
    expect(out.operational).toBe(34);
    expect(out.avgHours).toBeCloseTo(0.679, 3);
    expect(out.totalHours).toBeCloseTo(23.1, 6);
  });

  it("reports no average at all when nothing has run", () => {
    // Not zero: no machine has averaged zero hours, the fleet has not started.
    const out = summariseToday([unit(0), unit(0)]);
    expect(out.avgHours).toBeNull();
    expect(out.operational).toBe(0);
    expect(out.nonOperational).toBe(2);
  });

  it("treats missing figures as not having run rather than throwing", () => {
    const out = summariseToday([{ }, { hoursToday: null, distanceTodayKm: null }, unit(2)]);
    expect(out.operational).toBe(1);
    expect(out.nonOperational).toBe(2);
  });
});
