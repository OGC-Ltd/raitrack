import { describe, it, expect } from "vitest";
import { buildTourSteps, esc } from "./productTour";

// Stand-in elements: the test cares which steps survive, not what they point at.
const on = (...marks) => (m) => (marks.includes(m) ? { mark: m } : null);
const titles = (steps) => steps.map((s) => s.popover.title);
const DESKTOP = on("org", "status", "nav", "fleets", "map-search", "map-tools", "map", "alerts", "account");

describe("buildTourSteps", () => {
  it("walks a full-access desktop account through every part of the app", () => {
    expect(titles(buildTourSteps({ firstName: "Silas", orgName: "Sukari", visible: DESKTOP }))).toEqual([
      "Welcome, Silas", "Your Organisation", "The Fleet at a Glance", "The Screens", "Fleets and Reports",
      "Find Anything", "Map Tools", "Open a Unit", "Notifications", "Your Account",
    ]);
  });

  // An account without the map sees nothing about it, even where the sidebar
  // still draws those controls disabled.
  it("leaves out the map for an account that cannot open it", () => {
    const can = (p) => p !== "map:read";
    const t = titles(buildTourSteps({ can, visible: DESKTOP }));
    expect(t).toEqual(["Welcome to Rai Operations", "Your Organisation", "The Screens", "Your Account"]);
  });

  it("drops a step whose control is not on screen (a tablet's folded sidebar)", () => {
    const t = titles(buildTourSteps({ visible: on("org", "nav", "map-search", "map-tools", "map", "alerts", "account") }));
    expect(t).not.toContain("The Fleet at a Glance");
    expect(t).not.toContain("Fleets and Reports");
    expect(t).toContain("The Screens");
  });

  it("takes the phone's controls where the desktop's are not on screen", () => {
    const steps = buildTourSteps({ visible: on("m-org", "m-tabs", "m-search", "map", "m-alerts", "m-account") });
    expect(titles(steps)).toEqual([
      "Welcome to Rai Operations", "Your Organisation", "The Screens", "Find Anything", "Open a Unit", "Notifications", "Your Account",
    ]);
    expect(steps[1].element).toEqual({ mark: "m-org" });
  });

  it("lists only the screens and reports this account may open", () => {
    const can = (p) => ["map:read", "weighbridge:read", "telemetry:read"].includes(p);
    const steps = buildTourSteps({ can, visible: DESKTOP });
    const screens = steps.find((s) => s.popover.title === "The Screens").popover.description;
    expect(screens).toContain("Live Map");
    expect(screens).toContain("Weighbridges");
    expect(screens).not.toContain("Analytics");
    const reports = steps.find((s) => s.popover.title === "Fleets and Reports").popover.description;
    expect(reports).toContain("Logbook");
    expect(reports).not.toContain("Fuel Audit");
  });

  it("names Halted and Fuel alerts only when the rail draws them", () => {
    const tools = (vis) => buildTourSteps({ visible: vis }).find((s) => s.popover.title === "Map Tools").popover.description;
    expect(tools(DESKTOP)).not.toContain("Halted");
    expect(tools(on("map-tools", "map-halted", "map-fuel"))).toContain("Halted");
  });

  it("says how to switch organisation only to an account that can", () => {
    const one = buildTourSteps({ orgName: "Sukari", visible: DESKTOP })[1].popover;
    const many = buildTourSteps({ orgName: "Sukari", multiOrg: true, visible: DESKTOP })[1].popover;
    expect(one.title).toBe("Your Organisation");
    expect(many.title).toBe("Your Organisations");
    expect(many.description).toContain("Switch here");
  });

  it("escapes names that reach the popover as HTML", () => {
    expect(esc('<img src=x onerror="1">')).toBe("&lt;img src=x onerror=&quot;1&quot;&gt;");
    expect(buildTourSteps({ firstName: "<b>", visible: DESKTOP })[0].popover.title).toBe("Welcome, &lt;b&gt;");
  });
});
