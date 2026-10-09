import { describe, it, expect, vi, beforeEach } from "vitest";
import { accountBehind, buildTourSteps, claimFirstRun, esc, tourDue, tourSeen } from "./productTour";

const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
});

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

// Operator, 2026-10-09: the tour came back at every sign-in (recorded only when
// closed by ✕, Esc or Done), and then on every other machine (recorded only in
// the browser).
describe("claimFirstRun", () => {
  beforeEach(() => store.clear());

  it("opens the tour once, and records it as it opens", () => {
    expect(claimFirstRun("u1", null)).toBe(true);
    // Never closed (a reload, a sign-out): still seen at the next sign-in.
    expect(tourSeen("u1")).toBe(true);
    expect(claimFirstRun("u1", null)).toBe(false);
  });

  it("is per person", () => {
    claimFirstRun("u1", null);
    expect(claimFirstRun("u2", null)).toBe(true);
  });

  it("does not open on a new machine once the account has had it", () => {
    expect(tourDue("u1", 1)).toBe(false);
    expect(claimFirstRun("u1", 1)).toBe(false);
  });

  it("opens again for everybody when the tour version is bumped past the account's", () => {
    expect(tourDue("u1", 0)).toBe(true);
  });

  it("falls back to this browser's record on a server that does not keep it", () => {
    expect(claimFirstRun("u1", undefined)).toBe(true);
    expect(claimFirstRun("u1", undefined)).toBe(false);
  });
});

describe("accountBehind", () => {
  beforeEach(() => store.clear());

  it("asks to tell the account about a tour this browser has seen and it has not", () => {
    claimFirstRun("u1", null);
    expect(accountBehind("u1", null)).toBe(true);
    expect(accountBehind("u1", 1)).toBe(false);
  });

  it("has nothing to tell before this browser has seen it, or a server that does not keep it", () => {
    expect(accountBehind("u1", null)).toBe(false);
    claimFirstRun("u1", undefined);
    expect(accountBehind("u1", undefined)).toBe(false);
  });
});
