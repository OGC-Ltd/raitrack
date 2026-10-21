/**
 * Which tab gets the raised centre button on a phone.
 *
 * The centre slot is the one a thumb reaches without looking, and it was nailed
 * to the Live Map. A technician holds `sensor:read` and nothing else of the
 * five, so for them the best position on the bar was a dead button and the
 * screen they actually work in was a small tab in the corner.
 *
 * The rule is a SWAP, not a removal: whatever is promoted leaves its old slot
 * to the map, so the bar is always five wide and nothing shifts sideways. That
 * is the property most of these tests are really checking.
 */

import { describe, it, expect } from "vitest";
import { barTabs } from "./MobileTabBar";

/** The signature the component passes: a predicate on a tab key. */
const allow = (...keys) => (key) => keys.includes(key);

const keys   = (tabs) => tabs.map((t) => t.key);
const centre = (tabs) => tabs.find((t) => t.fab)?.key;

const EVERYTHING = ["analytics", "drivers", "fleet", "weighbridges", "maintenance"];
const DEFAULT    = EVERYTHING;

describe("barTabs, when the map is open", () => {
  it("leaves the bar exactly as it was", () => {
    const tabs = barTabs(allow(...EVERYTHING));
    expect(keys(tabs)).toEqual(DEFAULT);
    expect(centre(tabs)).toBe("fleet");
  });

  it("keeps the map in the centre even if it is the ONLY thing open", () => {
    const tabs = barTabs(allow("fleet"));
    expect(keys(tabs)).toEqual(DEFAULT);
    expect(centre(tabs)).toBe("fleet");
  });
});

describe("barTabs, when the map is closed", () => {
  it("gives the centre to the technician's one screen", () => {
    const tabs = barTabs(allow("maintenance"));
    expect(centre(tabs)).toBe("maintenance");
  });

  it("puts the map in the slot the promoted tab came from", () => {
    // Maintenance was last; the map takes that place rather than vanishing.
    expect(keys(barTabs(allow("maintenance"))))
      .toEqual(["analytics", "drivers", "maintenance", "weighbridges", "fleet"]);
  });

  it("is still five tabs, and still the same five", () => {
    for (const open of [[], ["maintenance"], ["drivers"], ["analytics", "weighbridges"]]) {
      const tabs = barTabs(allow(...open));
      expect(tabs).toHaveLength(5);
      expect([...keys(tabs)].sort()).toEqual([...DEFAULT].sort());
      // Exactly one centre, always.
      expect(tabs.filter((t) => t.fab)).toHaveLength(1);
    }
  });

  it("promotes the FIRST open tab in bar order, not the last", () => {
    expect(centre(barTabs(allow("drivers", "maintenance")))).toBe("drivers");
    expect(centre(barTabs(allow("weighbridges", "maintenance")))).toBe("weighbridges");
  });

  it("changes nothing when nothing at all is open", () => {
    // Every button will be drawn dimmed, which is the honest picture. Promoting
    // one the account cannot use either would just move the dead button.
    const tabs = barTabs(allow());
    expect(keys(tabs)).toEqual(DEFAULT);
    expect(centre(tabs)).toBe("fleet");
  });
});

describe("barTabs, the promoted tab can still be drawn", () => {
  it("gives every tab an icon, including a demoted Fleet", () => {
    // Fleet used to carry `icon: null` because the centre drew a truck SVG.
    // Once it can be demoted into an ordinary slot it needs a real one, or it
    // renders as a bare label.
    for (const t of barTabs(allow("maintenance"))) {
      expect(t.icon).toBeTruthy();
    }
  });
});
