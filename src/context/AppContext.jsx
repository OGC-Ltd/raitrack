

// Global app state: company, theme, active tabs, filters.

import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { getCompanies } from "../api/companies";
import { ORG_CODE_BY_COMPANY } from "../api/org";
import { useAuth } from "./AuthContext";
import { restoreChoice, persistChoice, restoreOverlay, persistOverlay } from "../lib/navMemory";

const AppContext = createContext(undefined);

// ── Where the user was, across a refresh ───────────────────────────────────
//
// Every id that may be restored is listed here, and anything else is thrown
// away rather than trusted. That matters more than it looks: a tab renamed or
// dropped in a later release would otherwise be read back out of a returning
// user's storage and select a screen that no longer renders — a blank shell
// with no way out except clearing site data, on a machine we cannot inspect.
// An unknown value costs the user their last tab; a trusted one costs them
// the app.
const DESKTOP_TABS   = ["fleet", "drivers", "weighbridges", "maintenance", "analytics"];
const MOBILE_TABS    = ["home", "map", "search", "drivers"];
// "users" is deliberately gone: User Accounts left Maintenance for the avatar
// menu, so a value stored by an older build is now unknown — which is exactly
// the case this allow-list exists to absorb, and it costs the reader nothing
// more than landing on Sensor Monitor once.
const MAINT_VIEWS    = ["service", "sensors"];

const DESKTOP_TAB_KEY = "ft-desktop-tab";
const MOBILE_TAB_KEY  = "ft-mobile-tab";
const MAINT_VIEW_KEY  = "ft-maint-view";

// The two full-screen pages that sit OVER the app. Session-scoped rather than
// durable — lib/navMemory explains why these alone are not in localStorage
// with the rest of the navigation.
const ACCOUNT_OPEN_KEY    = "ft-account-open";
const USER_ADMIN_OPEN_KEY = "ft-user-admin-open";

/** The Fleets funnel is per-ORGANISATION: Sukari's tractors and Kasulu's
 *  excavators are different lists, and a selection carried across a switch
 *  would filter the new fleet by machines it does not own. */
const fleetTypesKey = (orgId) => `ft-fleet-types:${orgId}`;

/** Which units the map has been narrowed to. Per-org for the same reason the
 *  funnel is: a plate is only a plate inside one fleet, and carrying Sukari's
 *  three tracked trucks into Kasulu would leave the map showing nothing. */
const trackedUnitsKey = (orgId) => `ft-tracked-units:${orgId}`;

/**
 * A saved list of strings, or [] — for the same reason restoreChoice is
 * wrapped: this runs in a useState initialiser and localStorage THROWS rather
 * than returning null where storage is unavailable.
 */
function restoreStringList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** The saved fleet-type selection for one org. [] means "every type". */
function restoreFleetTypes(orgId) {
  return restoreStringList(fleetTypesKey(orgId));
}

/** The saved tracked-unit selection for one org. [] means "the whole fleet". */
function restoreTrackedUnits(orgId) {
  return restoreStringList(trackedUnitsKey(orgId));
}

const THEME_PREF_KEY = "ft-theme-pref";

export function AppProvider({ children }) {
  /**
   * Theme — light, and only light.
   *
   * This used to be a three-way preference (system / dark / light) resolved
   * against `prefers-color-scheme`, with a header switch and a row of buttons
   * on the account page feeding it. The app now ships one theme, so the
   * preference, the media-query listener and the resolved boolean are all
   * gone: what is left is two constants and a setter that clamps.
   *
   * `themePref` and `setThemePref` stay in the context rather than being
   * deleted because the account page still draws the Appearance row — Match
   * system and Dark are rendered disabled there, so the reader can see the
   * choice was made rather than wondering where it went, and `themePref` is
   * what marks Light as the one that is on.
   *
   * `setThemePref` is deliberately not a no-op that ignores its argument: it
   * accepts "light" and refuses anything else. A future caller asking for dark
   * gets light, which is the truth, instead of silently appearing to work.
   */
  const themePref = "light";
  const darkMode = false;

  const setThemePref = useCallback(() => {
    persistChoice(THEME_PREF_KEY, "light");
  }, []);

  /** Kept for callers that think in a boolean. Both positions mean light. */
  const setDarkMode = useCallback(() => {
    setThemePref("light");
  }, [setThemePref]);

  useEffect(() => {
    /* Both keys are still written, and written to light, so a browser holding
       "dark" from before this change is CORRECTED on the next load rather than
       carrying a stale value that some later reader could act on. */
    persistChoice(THEME_PREF_KEY, "light");
    localStorage.setItem("ft-dark-mode", "false");
    // Mirrored onto <html> so the page background follows: the .app--light
    // class lives on a descendant, which html/body cannot style from, and on
    // mobile the body scrolls so its colour is visible.
    document.documentElement.dataset.theme = "light";
  }, []);

  // Selected company survives a refresh: an explicit ?company= URL param wins
  // (shareable links), then the last selection saved in localStorage, then the
  // default. Changes are written back to both below.
  const [activeCompanyId, setActiveCompanyId] = useState(
    () =>
      new URLSearchParams(window.location.search).get("company") ||
      localStorage.getItem("ft-active-company") ||
      "sukari"
  );

  /**
   * The organisation that was open before this one.
   *
   * A switch is not always something the operator asked for: searching a plate
   * that is not in this fleet MOVES the dashboard to the tenant holding it
   * (hooks/useCrossOrgUnits). That is the right behaviour and it is what makes
   * a way back necessary — the operator did not choose to leave, so "where was
   * I" has to be something the app knows rather than something they remember.
   *
   * Recorded in an effect rather than inside a wrapped setter so it stays true
   * however the company changed: the switcher, the cross-org handoff, a
   * ?company= link, and the correction below that replaces an organisation the
   * account cannot open all go through the same state.
   *
   * Session-only on purpose. "Back" means back within this sitting; restoring
   * it from storage would offer a return to somewhere they left days ago.
   */
  const [previousCompanyId, setPreviousCompanyId] = useState(null);
  const lastCompanyRef = useRef(activeCompanyId);
  useEffect(() => {
    if (lastCompanyRef.current !== activeCompanyId) {
      setPreviousCompanyId(lastCompanyRef.current);
      lastCompanyRef.current = activeCompanyId;
    }
  }, [activeCompanyId]);

  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  // pendingFocusId: set by any page to request FleetMap zoom to a vehicle.
  // FleetMap watches this, calls handleFocusVehicle, then clears it.
  const [pendingFocusId, setPendingFocusId] = useState(null);
  // Which vehicle the Live Feed is scoped to, if any.
  //
  // Deliberately NOT the same thing as `selectedVehicleId`, even though a map
  // marker click sets both. Selection means "show me this unit's details", and
  // three paths reach it — a marker click, a feed row, a search. Only the
  // marker click is a statement about the FEED; clicking a feed row or
  // searching should fly the camera there and open the panel while leaving the
  // feed showing the whole fleet, or you lose the rest of the activity as a
  // side effect of looking at one item of it.
  const [feedVehicleId, setFeedVehicleId] = useState(null);
  /**
   * Is a floating window currently held open over the map?
   *
   * Shared state because the surfaces that open one and the surface that has
   * to yield to it are SIBLINGS: the fuel incident window lives in MapOverlay
   * and the hover card lives in FleetMap, so neither can see the other's
   * state. Without this the two coexist — a card describing the unit under the
   * cursor, floating over a window the operator deliberately pinned about a
   * different one.
   *
   * Set by the window's owner, read by anything transient enough to get out of
   * the way. Not a count: the rule is "is anything committed open", and a
   * boolean cannot leak a reference the way an unbalanced counter can.
   */
  const [windowOpen, setWindowOpen] = useState(false);

  /**
   * An explicit request to open a unit's fuel incident window.
   *
   * Shared for the same reason as `windowOpen`: the fuel-alerts menu is in
   * FleetMap and the window is owned by MapOverlay's RightPanel, siblings that
   * cannot see each other.
   *
   * It replaces an effect that opened the window BY ITSELF the first time a
   * flagged unit was selected. That was the whole complaint — selecting a
   * vehicle to look at it is not a request to be shown a dialog about it. Now
   * nothing opens unless something asked, and this is the asking.
   *
   * `{ id, n }` rather than a bare id: asking twice for the same unit — click a
   * row, close the window, click it again — has to be two requests, and an
   * unchanged id is not a change React can see.
   */
  const [incidentRequest, setIncidentRequest] = useState(null);
  const requestIncident = useCallback((vehicleId) => {
    setIncidentRequest((prev) => ({ id: vehicleId, n: (prev?.n ?? 0) + 1 }));
  }, []);

  /**
   * The surveys the map is offering right now, and a way to ask it for one.
   *
   * Two directions, because the header and the map are SIBLINGS and neither
   * can see the other's state — the same reason `windowOpen` and
   * `incidentRequest` live here. The quick-link menu in the header has to
   * list what the map would draw, and the map is the only thing that knows:
   * the list is this organisation's own surveys PLUS whichever of another
   * tenant's it is currently lending (see lib/guestSitePlans), which changes
   * on its own as lorries arrive and leave.
   *
   * `sitePlanLinks` is published by FleetMap and read by the header. It
   * carries the WEIGHBRIDGES too — same menu, same round trip, and the only
   * difference is the `kind` that tells the map which camera move to make.
   * `requestSitePlan` goes the other way: it switches the layer on and takes
   * the camera to the place. Counted rather than a bare id, like requestIncident, so
   * that asking for the SAME survey twice is two requests — the second one is
   * an operator saying "take me back there" after panning away, and an
   * unchanged value would be no event at all.
   */
  const [sitePlanLinks, setSitePlanLinks] = useState([]);
  const [sitePlanRequest, setSitePlanRequest] = useState(null);
  /* `kind` distinguishes the two sorts of destination the menu offers, because
     they need different camera work at the far end: a survey is an AREA whose
     bounds get framed, a weighbridge is a POINT the camera drops onto. It
     defaults to "site" so the name of this function stays honest for the
     caller that only ever wanted a survey. */
  const requestSitePlan = useCallback((planId, kind = "site") => {
    setSitePlanRequest((prev) => ({ id: planId, kind, n: (prev?.n ?? 0) + 1 }));
  }, []);

  const [companies, setCompanies] = useState([]);

  const [mobileActiveTab, setMobileActiveTab] = useState(
    () => restoreChoice(MOBILE_TAB_KEY, MOBILE_TABS, "home")
  );
  // The map mounts lazily and ONLY via handleMobileTabChange, which a restored
  // session never goes through. Landing straight on the Map tab with this
  // false renders the tab as selected and nothing underneath it, so seed it
  // from where we are actually landing.
  const [mapEverMounted, setMapEverMounted] = useState(
    () => mobileActiveTab === "map"
  );

  const [desktopActiveTab, setDesktopActiveTab] = useState(
    () => restoreChoice(DESKTOP_TAB_KEY, DESKTOP_TABS, "fleet")
  );

  // Which Maintenance sub-tab is open — Service Status or Sensor Monitor.
  // Lives here rather than in MaintenanceScreen's own state for the same
  // reason analyticsView does: it is a navigation choice, and this is where
  // navigation is remembered.
  // Default "sensors", not "service": Service Status is behind a flag and is
  // not currently reachable, so defaulting to it meant the screen had to
  // correct the stored value on every first load.
  const [maintenanceView, setMaintenanceView] = useState(
    () => restoreChoice(MAINT_VIEW_KEY, MAINT_VIEWS, "sensors")
  );

  const [activeRange, setActiveRange] = useState("Today");

  const [analyticsView, setAnalyticsView] = useState("Fleet");

  // The account page is a full screen rather than a dialog, so whether it is
  // open is app-level navigation — the header menu opens it, and the screen
  // itself closes it. Remembered for the life of the TAB and no longer, which
  // keeps "coming back tomorrow lands on the fleet, not on your own settings"
  // while still surviving a refresh — see lib/navMemory.
  const [accountOpen, setAccountOpen] = useState(() => restoreOverlay(ACCOUNT_OPEN_KEY));

  // User accounts, on the same terms. It used to be a sub-tab of Maintenance,
  // which put administering PEOPLE inside the tab about servicing VEHICLES and
  // hid it behind a tab strip that only admins ever saw two entries in. It is
  // reached from the avatar menu now, beside Account, because both are about
  // who can use this dashboard rather than about the fleet.
  //
  // Restored on the same terms as accountOpen, and safely: UserAdminGate
  // re-checks `user:create` on every render and closes itself, so a tab
  // reloaded into an organisation where that grant has since gone lands on the
  // app rather than on a roster the server would refuse every write to. The
  // restore cannot widen what anybody can reach — only where they resume.
  const [userAdminOpen, setUserAdminOpen] = useState(() => restoreOverlay(USER_ADMIN_OPEN_KEY));

  // ── Fleets funnel ─────────────────────────────────────────────────────────
  // Which machine types the map is showing. [] is "no filter", not "hide
  // everything" — see matchesTypeFilter.
  const [fleetTypes, setFleetTypesState] = useState(() => restoreFleetTypes(activeCompanyId));

  // Swap in the new org's own selection on a company switch.
  useEffect(() => { setFleetTypesState(restoreFleetTypes(activeCompanyId)); }, [activeCompanyId]);

  /**
   * Persist from the SETTER rather than from an effect on [fleetTypes, orgId].
   * That effect would also fire on the org switch above — running with the new
   * orgId but the previous fleet's list, stamping Sukari's tractors onto
   * Kasulu's key before the load effect had replaced them. Writing where the
   * change is made keeps the value and the key from ever disagreeing.
   *
   * Takes a plain array, never an updater: the funnel computes its next list
   * from the rows it is already rendering.
   */
  const setFleetTypes = useCallback((kinds) => {
    const next = Array.isArray(kinds) ? kinds : [];
    setFleetTypesState(next);
    persistChoice(fleetTypesKey(activeCompanyId), JSON.stringify(next));
  }, [activeCompanyId]);

  // ── Tracked units ─────────────────────────────────────────────────────────
  /**
   * The units the operator has picked out of the fleet to watch.
   *
   * [] is "the whole fleet", not "nothing" — the same rule as fleetTypes, and
   * for the same reason: an empty selection is the absence of a narrowing, and
   * a map that blanks itself because a stored plate no longer exists is
   * indistinguishable from a broken one.
   *
   * An ARRAY, not a Set. This is what goes through JSON.stringify, and it is
   * what a memo dependency array can compare — a Set rebuilt each render
   * defeats every memo downstream of it. Consumers that need membership derive
   * their own Set from it.
   */
  const [trackedIds, setTrackedIdsState] = useState(() => restoreTrackedUnits(activeCompanyId));

  useEffect(() => { setTrackedIdsState(restoreTrackedUnits(activeCompanyId)); }, [activeCompanyId]);

  // Persisted from the setter, never from an effect on [trackedIds, orgId] —
  // see the note on setFleetTypes above for the bug that shape produces.
  const setTrackedIds = useCallback((ids) => {
    const next = Array.isArray(ids) ? ids : [];
    setTrackedIdsState(next);
    persistChoice(trackedUnitsKey(activeCompanyId), JSON.stringify(next));
  }, [activeCompanyId]);

  /**
   * Show only units that are actually moving.
   *
   * Deliberately NOT persisted, unlike every other filter here. It is a
   * momentary lens — "what is rolling right now" — and a session restored
   * tomorrow showing 40 of 597 units, with no memory of having asked for that,
   * is the worst kind of stale state: one the user has to diagnose before they
   * can trust anything on the screen.
   */
  const [inTransitOnly, setInTransitOnly] = useState(false);

  // Remember the screen the user is on, so a refresh — or a tab restored days
  // later — comes back where they left it instead of at the fleet map.
  useEffect(() => { persistChoice(DESKTOP_TAB_KEY, desktopActiveTab) }, [desktopActiveTab]);
  useEffect(() => { persistChoice(MOBILE_TAB_KEY,  mobileActiveTab)  }, [mobileActiveTab]);
  useEffect(() => { persistChoice(MAINT_VIEW_KEY,  maintenanceView)  }, [maintenanceView]);

  // The overlay pages, per tab. Both are written on close as well as on open,
  // so shutting one is remembered too — a stored "1" that nothing ever clears
  // would reopen the page on every reload for the rest of the session.
  useEffect(() => { persistOverlay(ACCOUNT_OPEN_KEY,    accountOpen)   }, [accountOpen]);
  useEffect(() => { persistOverlay(USER_ADMIN_OPEN_KEY, userAdminOpen) }, [userAdminOpen]);

  // Persist the selection and mirror it into the URL (without a navigation) so
  // both a refresh and a copied link land on the same company.
  useEffect(() => {
    localStorage.setItem("ft-active-company", activeCompanyId);
    const url = new URL(window.location.href);
    if (url.searchParams.get("company") !== activeCompanyId) {
      url.searchParams.set("company", activeCompanyId);
      window.history.replaceState(null, "", url);
    }
  }, [activeCompanyId]);

  // A selected vehicle belongs to ONE company's fleet — carrying the selection
  // across an org switch leaves the right panel pointing at a vehicle the new
  // fleet doesn't contain (blank panel). Reset so the fleet-overview default
  // renders instead.
  useEffect(() => {
    setSelectedVehicleId(null);
    // Same reasoning for the feed scope: a plate from the previous fleet would
    // filter the new organisation's feed down to nothing.
    setFeedVehicleId(null);
  }, [activeCompanyId]);

  useEffect(() => {
    let cancelled = false;
    getCompanies().then((data) => {
      if (!cancelled) setCompanies(data);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Only the organisations this account may open ─────────────────────────
  //
  // The roster in companyData is the whole platform; membership decides which
  // of it this person sees. Filtering here rather than in the switcher covers
  // every consumer at once — the dropdown, the mobile sheet, and the header —
  // and, crucially, the SEED above, which reads `?company=` before localStorage
  // and would otherwise walk straight past a filtered dropdown into another
  // tenant's map. The server refuses those requests either way; this stops the
  // dash asking, and stops it presenting an empty screen as if it were a fault.
  const { orgs: authOrgs, booting: authBooting } = useAuth();

  const visibleCompanies = useMemo(() => {
    if (authBooting) return [];
    const allowed = new Set(authOrgs.map((o) => o.code));
    // An account with no membership at all sees nothing; that is a real state
    // (a user created but not yet granted an organisation) and it must not
    // silently fall back to the full list.
    return companies.filter((c) => allowed.has(ORG_CODE_BY_COMPANY[c.id] ?? String(c.id).toUpperCase()));
  }, [companies, authOrgs, authBooting]);

  // A stored or link-supplied company the account cannot open is replaced by
  // the first one it can, rather than left selected and rendering blank.
  useEffect(() => {
    if (authBooting || visibleCompanies.length === 0) return;
    if (!visibleCompanies.some((c) => c.id === activeCompanyId)) {
      setActiveCompanyId(visibleCompanies[0].id);
    }
  }, [visibleCompanies, activeCompanyId, authBooting]);

  const activeCompany = useMemo(
    () => visibleCompanies.find((c) => c.id === activeCompanyId) || visibleCompanies[0],
    [visibleCompanies, activeCompanyId]
  );

  const handleMobileTabChange = (tab) => {
    if (tab === "map") setMapEverMounted(true);
    setMobileActiveTab(tab);
  };

  const value = useMemo(
    () => ({
      darkMode,
      setDarkMode,
      themePref,
      setThemePref,
      accountOpen,
      setAccountOpen,
      userAdminOpen,
      setUserAdminOpen,
      activeCompanyId,
      setActiveCompanyId,
      activeCompany,
      previousCompanyId,
      // The FILTERED roster. Consumers keep the name they already used, so the
      // switcher, the sheet and the header are all narrowed by construction
      // rather than each remembering to filter.
      companies: visibleCompanies,
      allCompanies: companies,
      selectedVehicleId,
      setSelectedVehicleId,
      pendingFocusId,
      setPendingFocusId,
      feedVehicleId,
      setFeedVehicleId,
      windowOpen,
      setWindowOpen,
      incidentRequest,
      requestIncident,
      sitePlanLinks,
      setSitePlanLinks,
      sitePlanRequest,
      requestSitePlan,
      mobileActiveTab,
      setMobileActiveTab: handleMobileTabChange,
      mapEverMounted,
      desktopActiveTab,
      setDesktopActiveTab,
      maintenanceView,
      setMaintenanceView,
      activeRange,
      setActiveRange,
      analyticsView,
      setAnalyticsView,
      fleetTypes,
      setFleetTypes,
      trackedIds,
      setTrackedIds,
      inTransitOnly,
      setInTransitOnly,
    }),
    [darkMode, themePref, setThemePref, setDarkMode, accountOpen, userAdminOpen, activeCompanyId, activeCompany, previousCompanyId, companies, visibleCompanies, selectedVehicleId, feedVehicleId, windowOpen, incidentRequest, requestIncident, sitePlanLinks, sitePlanRequest, requestSitePlan, mobileActiveTab, mapEverMounted, desktopActiveTab, maintenanceView, activeRange, analyticsView, pendingFocusId, fleetTypes, setFleetTypes, trackedIds, setTrackedIds, inTransitOnly]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (ctx === undefined) {
    throw new Error("useAppContext must be used within an <AppProvider>");
  }
  return ctx;
}
