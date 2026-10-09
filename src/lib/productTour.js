/**
 * The first-time tour (operator, 2026-10-09: "guide a first time user on how
 * they can use the application"), drawn by driver.js in components/shared/
 * ProductTour. This file holds what the tour SAYS and to whom, so that can be
 * tested without a browser.
 *
 * ## Steps point at `data-tour` marks, not at classes
 *
 * Each step names the `data-tour` value of the control it is about — set on
 * that control in AppHeader, SidePanel, MapToolRail, App, MobileHeader and
 * MobileTabBar. The classes on those controls are styling and change with
 * every restyle; the mark is there for the tour alone and says so.
 *
 * ## One list for every screen size and every account
 *
 * A step may name several marks — the desktop control and the phone one — and
 * takes the first that is actually on screen when the tour starts. A step
 * whose control is not on screen is dropped: the sidebar's status cards on a
 * tablet, where the sidebar is an icon rail; the map tools for an account that
 * cannot open the map. Permissions are tested as well as presence, so a step
 * never describes a screen the account cannot open even where its control is
 * drawn disabled.
 *
 * ## Seen once, per person, per browser
 *
 * The server keeps no per-user preferences, so "has seen it" lives in this
 * browser under the user's id. A new device shows it once more, which for a
 * one-minute tour is the better mistake. Bump TOUR_VERSION when the app
 * changes enough that everybody should see it again.
 *
 * Copy follows the app's empty-state rule: Title Case titles, no em dashes.
 */

export const TOUR_VERSION = 1;

const keyFor = (userId) => `ft-tour:v${TOUR_VERSION}:${userId ?? "anon"}`;

/** Has this person finished or closed this version of the tour here? */
export function tourSeen(userId) {
  try { return localStorage.getItem(keyFor(userId)) != null; } catch { return false; }
}

export function markTourSeen(userId) {
  try { localStorage.setItem(keyFor(userId), String(Date.now())); } catch { /* storage off: shown again next time */ }
}

// ── replay ────────────────────────────────────────────────────────────────
// The account menu asks; ProductTour, mounted once in the app shell, listens.

const bus = new EventTarget();
export function requestTour() { bus.dispatchEvent(new Event("tour")); }
export function onTourRequest(cb) {
  bus.addEventListener("tour", cb);
  return () => bus.removeEventListener("tour", cb);
}

// ── what the tour says ────────────────────────────────────────────────────

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const list = (rows) => `<ul class="ft-tour__list">${rows.map((r) => `<li>${r}</li>`).join("")}</ul>`;

/** One line per screen in the sidebar, for the screens step. */
export const SCREEN_LINES = {
  fleet:        "<b>Live Map</b>: every unit, where it is now",
  drivers:      "<b>Drivers</b>: each driver's trips, tonnes, distance and incidents",
  analytics:    "<b>Analytics</b>: fuel use and cost, daily activity and sugar haulage over the days you pick",
  maintenance:  "<b>Maintenance</b>: probe health, fuel events, speeding, faults and repairs",
  weighbridges: "<b>Weighbridges</b>: every ticket each scale weighed, and the day across all of them",
};

/**
 * The tour for this account, as driver.js steps.
 *
 *   can        permission test, as usePermissions gives it
 *   firstName  for the welcome; may be empty
 *   orgName    the organisation on screen
 *   multiOrg   whether the account can switch organisation
 *   visible    (mark) → the Element carrying data-tour=mark if it is on
 *              screen, else null. Injected so this can be tested without a DOM.
 */
export function buildTourSteps({ can = () => true, firstName = "", orgName = "", multiOrg = false, visible = () => null } = {}) {
  const first = (...marks) => {
    for (const m of marks) { const el = visible(m); if (el) return el; }
    return null;
  };
  const map = can("map:read");
  const steps = [];
  const add = (element, popover, when = true) => {
    if (!when) return;
    if (element === null) return;          // a step about a control that is not on screen
    steps.push(element === undefined ? { popover } : { element, popover });
  };

  add(undefined, {
    title: firstName ? `Welcome, ${esc(firstName)}` : "Welcome to Rai Operations",
    description:
      "A one-minute look at where things are. Use the buttons or your arrow keys, "
      + "and close it whenever you like: it is always in your account menu, top right.",
  });

  add(first("org", "m-org"), {
    title: multiOrg ? "Your Organisations" : "Your Organisation",
    description: multiOrg
      ? `You are looking at <b>${esc(orgName) || "one organisation"}</b>. Switch here, and the map, the lists and every report follow.`
      : `Everything you see belongs to <b>${esc(orgName) || "your organisation"}</b>.`,
    side: "bottom", align: "start",
  });

  add(first("status"), {
    title: "The Fleet at a Glance",
    description:
      "How many units are online, offline or idling, and how many carry a warning or a critical alert. "
      + "Click a card to show only those units on the map; click it again to show them all.",
    side: "right", align: "start",
  }, map);

  const screens = Object.keys(SCREEN_LINES).filter((k) => can(PERMISSION_OF[k]));
  add(first("nav", "m-tabs"), {
    title: "The Screens",
    description: screens.length
      ? `Move between the parts of the app here.${list(screens.map((k) => SCREEN_LINES[k]))}`
      : "Move between the parts of the app here.",
    side: "right", align: "start",
  });

  const reports = [
    can("telemetry:read")    && "<b>Logbook</b>: how one unit was used over a period, with a PDF and a workbook",
    can("fuel_audit:read")   && "<b>Fuel Audit</b>: fuel alerts found to be a faulty probe, and their repairs",
    can("fuel_filling:read") && "<b>Fuel Report</b>: one unit's fuel over a period, fillings and drains included",
  ].filter(Boolean);
  add(first("fleets"), {
    title: "Fleets and Reports",
    description: "Choose which machine types and units the map is about."
      + (reports.length ? ` The unit reports are here too:${list(reports)}` : ""),
    side: "right", align: "start",
  }, map);

  add(first("map-search", "m-search"), {
    title: "Find Anything",
    description: "Search for a plate, a driver, a place or a road. A unit that belongs to another of your organisations is found too.",
    side: "right", align: "start",
  }, map);

  const tools = [
    "<b>Maps</b>: OpenStreetMap or satellite, and layers such as site plans and weighbridges",
    "<b>Measure</b> a distance, or show a unit's <b>Route covered</b>",
    "<b>Geofences</b> on or off",
    visible("map-halted") && "<b>Halted</b>: units that stopped mid-journey",
    visible("map-fuel")   && "<b>Fuel alerts</b>: open fuel theft alerts",
  ].filter(Boolean);
  add(first("map-tools"), {
    title: "Map Tools",
    description: `${list(tools)}The arrow at the bottom shows every tool's name.`,
    side: "right", align: "center",
  }, map);

  add(first("map"), {
    title: "Open a Unit",
    description:
      "Click any unit on the map to open its panel: where it is, its fuel, today's trips, its driver and its alerts. "
      + "Numbered circles are groups of units; zoom in or click one to spread them out.",
  }, map);

  add(first("alerts", "m-alerts"), {
    title: "Notifications",
    description: "The fleet's events as they happen: arrivals, departures, fuel and alerts. The number is what is new since you last looked.",
    side: "bottom", align: "end",
  }, map);

  add(first("account", "m-account"), {
    title: "Your Account",
    description: "Your profile and password are here, and so is <b>Take the tour</b>, whenever you want this again.",
    side: "bottom", align: "end",
  });

  return steps;
}

/** The permission each sidebar screen asks for (SidePanel NAV_ITEMS). */
export const PERMISSION_OF = {
  fleet: "map:read",
  drivers: "driver:read",
  analytics: "analytics:read",
  maintenance: "sensor:read",
  weighbridges: "weighbridge:read",
};

/**
 * The element marked `data-tour=mark` if it is actually on screen: in the
 * document, laid out, not hidden, and with a size. A tablet's folded sidebar
 * and a phone's hidden desktop header are in the DOM but not on screen.
 */
export function visibleMark(mark, doc = typeof document === "undefined" ? null : document) {
  if (!doc) return null;
  for (const el of doc.querySelectorAll(`[data-tour="${mark}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = doc.defaultView?.getComputedStyle(el);
    if (cs && (cs.visibility === "hidden" || cs.display === "none")) continue;
    if (el.closest(".app-tab-panel--hidden, [inert]")) continue;
    return el;
  }
  return null;
}
