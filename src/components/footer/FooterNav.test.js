import { describe, it, expect } from "vitest";
import { arrangeNav, NAV_TABS } from "./FooterNav";

/*
 * The footer's one piece of arithmetic: which tab sits in the centre.
 *
 * Written against the real NAV_TABS rather than a fixture, because the thing
 * most likely to break this is somebody reordering that list or moving a tab
 * between sides — and a fixture would keep passing while the bar went wrong.
 */
const grade = (held) =>
  NAV_TABS.map((t) => ({ ...t, allowed: held.includes(t.permission) }));

const layout = (tabs) => ({
  left:  tabs.filter((t) => t.side === "left").map((t) => t.key),
  fab:   tabs.find((t) => t.side === "fab")?.key,
  right: tabs.filter((t) => t.side === "right").map((t) => t.key),
});

/** Every tab still present exactly once, whatever moved. */
const stillAllFive = (tabs) => {
  expect(tabs).toHaveLength(NAV_TABS.length);
  expect(new Set(tabs.map((t) => t.key))).toEqual(new Set(NAV_TABS.map((t) => t.key)));
};

describe("arrangeNav", () => {
  it("puts a technician's one live tab in the centre and Fleet in its slot", () => {
    // The technician holds sensor:read and nothing else the footer grades on.
    const tabs = arrangeNav(grade(["sensor:read"]));

    expect(layout(tabs)).toEqual({
      left:  ["drivers", "weighbridges"],
      fab:   "maintenance",
      // Fleet lands where Maint was — first in the right group, not appended.
      right: ["fleet", "analytics"],
    });
    stillAllFive(tabs);
  });

  it("swaps into the exact vacated slot, not the head of the group", () => {
    // Analytics is SECOND in the right group. Swapping only the `side` values
    // would put Fleet first here; a positional swap keeps Analytics first.
    const tabs = arrangeNav(grade(["analytics:read"]));

    expect(layout(tabs)).toEqual({
      left:  ["drivers", "weighbridges"],
      fab:   "analytics",
      right: ["maintenance", "fleet"],
    });
  });

  it("carries the permission and the allowed flag across with the tab", () => {
    const tabs = arrangeNav(grade(["sensor:read"]));
    const centre = tabs.find((t) => t.side === "fab");
    const fleet  = tabs.find((t) => t.key === "fleet");

    // The centre is live and still gated on its own slug; Fleet is still dead
    // and still explains itself by map:read wherever it has landed.
    expect(centre).toMatchObject({ key: "maintenance", permission: "sensor:read", allowed: true });
    expect(fleet).toMatchObject({ permission: "map:read", allowed: false, side: "right" });
  });

  it("leaves the bar alone when two tabs are live", () => {
    // Two live and it is navigation again, so the centre goes back to Fleet
    // even though Fleet is not one of the two.
    const graded = grade(["sensor:read", "analytics:read"]);
    expect(arrangeNav(graded)).toEqual(graded);
    expect(layout(arrangeNav(graded)).fab).toBe("fleet");
  });

  it("leaves the bar alone when the single live tab is already Fleet", () => {
    const graded = grade(["map:read"]);
    expect(arrangeNav(graded)).toEqual(graded);
  });

  it("leaves the bar alone when nothing is live", () => {
    // App.jsx owns the empty case with its own message; the footer must not
    // invent a centrepiece out of a tab that cannot be opened either.
    const graded = grade([]);
    expect(arrangeNav(graded)).toEqual(graded);
    expect(layout(graded).fab).toBe("fleet");
  });

  it("does not mutate what it was given", () => {
    const graded = grade(["sensor:read"]);
    const before = JSON.stringify(graded);
    arrangeNav(graded);
    expect(JSON.stringify(graded)).toBe(before);
  });
});
