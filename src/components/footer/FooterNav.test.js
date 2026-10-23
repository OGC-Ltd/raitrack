import { describe, it, expect } from "vitest";
import { arrangeNav, NAV_TABS } from "./FooterNav";

const grade = (held) =>
  NAV_TABS.map((tab) => ({ ...tab, allowed: held.includes(tab.permission) }));

const layout = (tabs) => ({
  left:  tabs.filter((tab) => tab.side === "left").map((tab) => tab.key),
  fab:   tabs.find((tab) => tab.side === "fab")?.key,
  right: tabs.filter((tab) => tab.side === "right").map((tab) => tab.key),
});

describe("arrangeNav", () => {
  it("renders only the available tab and gives it the centre", () => {
    const tabs = arrangeNav(grade(["sensor:read"]));

    expect(layout(tabs)).toEqual({ left: [], fab: "maintenance", right: [] });
    expect(tabs.map((tab) => tab.permission)).toEqual(["sensor:read"]);
  });

  it("omits Fleet when map access is not granted", () => {
    const tabs = arrangeNav(grade(["analytics:read"]));

    expect(layout(tabs)).toEqual({ left: [], fab: "analytics", right: [] });
    expect(tabs.map((tab) => tab.key)).toEqual(["analytics"]);
  });

  it("keeps only granted tabs when several permissions are present", () => {
    const tabs = arrangeNav(grade(["driver:read", "analytics:read"]));

    expect(layout(tabs)).toEqual({ left: ["drivers"], fab: "analytics", right: [] });
    expect(tabs.map((tab) => tab.permission)).toEqual(["driver:read", "analytics:read"]);
  });

  it("keeps Fleet in the centre when the caller can open it", () => {
    const tabs = arrangeNav(grade(["map:read", "driver:read"]));

    expect(layout(tabs).fab).toBe("fleet");
    expect(tabs.map((tab) => tab.key)).toEqual(["drivers", "fleet"]);
  });

  it("renders no entries when no tab permission is granted", () => {
    expect(arrangeNav(grade([]))).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const graded = grade(["sensor:read", "analytics:read"]);
    const before = JSON.stringify(graded);

    arrangeNav(graded);

    expect(JSON.stringify(graded)).toBe(before);
  });
});
