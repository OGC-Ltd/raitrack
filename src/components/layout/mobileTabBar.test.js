/**
 * Only resources the user may access are rendered in the mobile tab bar.
 */

import { describe, it, expect } from "vitest";
import { barTabs } from "./MobileTabBar";

const allow = (...keys) => (key) => keys.includes(key);
const keys = (tabs) => tabs.map((tab) => tab.key);
const centre = (tabs) => tabs.find((tab) => tab.fab)?.key;

const EVERYTHING = ["analytics", "drivers", "fleet", "weighbridges", "maintenance"];

describe("barTabs", () => {
  it("keeps the full bar and Fleet in the centre when all tabs are available", () => {
    const tabs = barTabs(allow(...EVERYTHING));

    expect(keys(tabs)).toEqual(EVERYTHING);
    expect(centre(tabs)).toBe("fleet");
  });

  it("renders only permitted tabs", () => {
    const tabs = barTabs(allow("drivers", "maintenance"));

    expect(keys(tabs)).toEqual(["drivers", "maintenance"]);
    expect(tabs.every((tab) => ["drivers", "maintenance"].includes(tab.key))).toBe(true);
    expect(tabs.filter((tab) => tab.fab)).toHaveLength(1);
  });

  it("does not render Drivers when the caller lacks driver access", () => {
    const tabs = barTabs(allow("fleet", "analytics"));

    expect(keys(tabs)).toEqual(["analytics", "fleet"]);
    expect(keys(tabs)).not.toContain("drivers");
  });

  it("promotes the available screen when Fleet is not available", () => {
    const tabs = barTabs(allow("maintenance"));

    expect(keys(tabs)).toEqual(["maintenance"]);
    expect(centre(tabs)).toBe("maintenance");
  });

  it("renders no entries when nothing is available", () => {
    expect(barTabs(allow())).toEqual([]);
  });

  it("gives every available tab an icon", () => {
    for (const tab of barTabs(allow("maintenance", "fleet"))) {
      expect(tab.icon).toBeTruthy();
    }
  });
});
