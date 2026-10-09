// The first-time tour, drawn by driver.js. What it says and to whom is in
// lib/productTour; this mounts it once in the app shell, starts it for a
// person who has not seen it, and runs it again from the account menu.

import { useCallback, useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./ProductTour.css";
import { useAppFields, useAppActions, useAppSelector, useCompanies } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { usePermissions } from "../../hooks/usePermissions";
import { buildTourSteps, markTourSeen, onTourRequest, tourSeen, visibleMark } from "../../lib/productTour";

/** After the fleet has drawn, so the status cards show figures and not dashes;
 *  never longer than this, so a slow snapshot does not keep the tour away. */
const FIRST_RUN_MAX_WAIT_MS = 6000;
const FIRST_RUN_SETTLE_MS = 900;

export default function ProductTour() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { activeCompany, companies } = useCompanies();
  const { loading } = useFleetLiveShared();
  const { desktopActiveTab } = useAppFields("desktopActiveTab");
  const overlayOpen = useAppSelector((a) => a.accountOpen || a.userAdminOpen);
  const { setDesktopActiveTab, setAccountOpen, setUserAdminOpen } = useAppActions();

  const canMap = can("map:read");
  // The latest of everything, for a start that runs from a timer or an event.
  const live = useRef({});
  live.current = { user, can, canMap, activeCompany, companies, desktopActiveTab, overlayOpen, setDesktopActiveTab, setAccountOpen, setUserAdminOpen };

  const tourRef = useRef(null);

  const start = useCallback(() => {
    if (tourRef.current?.isActive()) return;
    const c = live.current;
    // Most of the tour is about the map, so it runs on the map — and over
    // nothing: the Account and User accounts pages open on top of the app.
    const moving = c.canMap && c.desktopActiveTab !== "fleet";
    if (moving) c.setDesktopActiveTab("fleet");
    if (c.overlayOpen) { c.setAccountOpen?.(false); c.setUserAdminOpen?.(false); }

    // Measured after the switch has laid out, because which steps survive
    // depends on what is on screen.
    setTimeout(() => {
      const now = live.current;
      const steps = buildTourSteps({
        can: now.can,
        firstName: (now.user?.fullName || now.user?.name || "").trim().split(/\s+/)[0] ?? "",
        orgName: now.activeCompany?.name ?? "",
        multiOrg: (now.companies?.length ?? 0) > 1,
        visible: (mark) => visibleMark(mark),
      });
      const userId = now.user?.id;
      const tour = driver({
        steps,
        popoverClass: "ft-tour",
        showProgress: true,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        stagePadding: 6,
        stageRadius: 10,
        overlayOpacity: 0.5,
        smoothScroll: true,
        // The highlighted control is shown, not live: a click on a sidebar item
        // mid-tour would change the screen out from under the next step.
        disableActiveInteraction: true,
        // A stray click on the dimmed map must not end a first-timer's tour;
        // the close button and Esc still do.
        overlayClickBehavior: () => {},
        onDestroyed: () => {
          // Finished or closed, it is not offered again here — the account
          // menu has it.
          markTourSeen(userId);
          tourRef.current = null;
        },
      });
      tourRef.current = tour;
      tour.drive();
    }, moving ? 350 : 60);
  }, []);

  // First run: once per person, when the app has something to show.
  const startedFor = useRef(null);
  useEffect(() => {
    const id = user?.id;
    if (!id || startedFor.current === id || tourSeen(id)) return undefined;
    if (!activeCompany?.id || overlayOpen) return undefined;
    const ready = !canMap || !loading;
    const t = setTimeout(() => { startedFor.current = id; start(); }, ready ? FIRST_RUN_SETTLE_MS : FIRST_RUN_MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [user?.id, activeCompany?.id, overlayOpen, canMap, loading, start]);

  // Again, from the account menu.
  useEffect(() => onTourRequest(start), [start]);

  // Signed out or unmounted mid-tour: take the overlay with it.
  useEffect(() => () => { tourRef.current?.destroy(); }, []);

  return null;
}
