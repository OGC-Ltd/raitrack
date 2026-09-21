// Desktop Maintenance tab — renders the full fleetdash-style Maintenance
// dashboard (3 history charts, filters, data grid, and the per-vehicle Full
// Checklist + Service History Report) fed by REAL backend data: the live
// vehicles snapshot (for odometer-derived status) plus the org's persisted
// /maintenance history and per-vehicle service records.
//
// SCROLL OWNERSHIP, and it is not obvious. This root is a flex column that
// clips (`overflow: hidden`) so the sub-tab bar stays pinned while the panel
// under it scrolls. SensorPanel is built for exactly that — its .sp4-root is
// `flex:1; min-height:0; overflow:hidden` with its own inner scrollers — so it
// mounts as a direct flex child. MaintenancePage is NOT: it is a plain
// full-height block that expects its container to scroll, so it gets the
// .maint-screen-panel wrapper to scroll in. Without that wrapper the page is
// simply clipped at the fold and the data grid loses most of its rows.

import { useState, useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import MaintenancePage from "../body/MaintenancePage";
import SensorPanel from "../body/SensorPanel";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { MaintenanceIcon } from "../footer/NavIcons";
import "./MaintenanceScreen.css";

/**
 * Service Status is hidden for now — Sensor Monitor is the only sub-tab.
 *
 * Flip this to true to bring it back; nothing below it was removed, so the
 * MaintenancePage branch, its data fetching and its styles all still work.
 *
 * Two things follow from hiding it, and both are handled below rather than
 * left to chance. The sub-tab BAR is hidden too, because a tab strip with one
 * tab in it is chrome that does nothing. And the persisted view is overridden:
 * `maintenanceView` lives in AppContext and survives a refresh, so anyone who
 * last left the tab on "service" would otherwise come back to a Service Status
 * panel with no visible control to leave it.
 */
const SHOW_SERVICE_STATUS = false;

export default function MaintenanceScreen() {
  const { vehicles, orgId, loading, error, retry } = useFleetLiveShared();
  const [selectedId, setSelectedId] = useState(null);
  // Held in AppContext so it survives a refresh — see the restore helpers there.
  const { maintenanceView: savedView, setMaintenanceView: setActiveTab } = useAppContext();

  /**
   * The sub-views, and which of them this person can actually open.
   *
   * This replaces `activeTab = SHOW_SERVICE_STATUS ? savedView : "sensors"`,
   * which ignored the saved view entirely and pinned everything to Sensor
   * Monitor — so the value AppContext went to the trouble of persisting was
   * read and thrown away.
   *
   * User Accounts was a third view here and has moved to the avatar menu
   * (UserAdminScreen): administering people has nothing to do with servicing
   * vehicles, and it was reachable only by admins who already knew this tab
   * grew an extra sub-tab for them. A stored `maintenanceView` of "users"
   * therefore no longer matches anything available — which the resolution
   * below already handles, and the effect after it corrects on disk.
   */
  const VIEWS = [
    { key: "service", label: "Service Status", enabled: SHOW_SERVICE_STATUS },
    { key: "sensors", label: "Sensor Monitor", enabled: true },
  ];
  const available = VIEWS.filter((v) => v.enabled);
  const activeTab = available.some((v) => v.key === savedView) ? savedView : available[0].key;

  // Write the resolved choice back, so a stored view that is no longer
  // available stops being wrong — the same correction App.jsx applies to the
  // desktop tab, and for the same reason: a permission set can change under a
  // stored choice.
  useEffect(() => {
    if (activeTab !== savedView) setActiveTab(activeTab);
  }, [activeTab, savedView, setActiveTab]);

  // A lookup, not a ternary: the old `=== "service" ? … : "Sensor Monitor"`
  // labelled every view that was not Service Status as Sensor Monitor.
  const crumbLabel = VIEWS.find((v) => v.key === activeTab)?.label ?? "Maintenance";

  return (
    <div className="maint-screen-scroll">
      {/* Orientation line. It carries real weight now that the sub-tab bar is
          hidden: without it the panel opens with no statement of where you are,
          and "Sensor Monitor" existed nowhere on screen. Not links — Maintenance
          is this tab, so there is nowhere for a click to go, and a crumb that
          looks clickable and isn't is worse than plain text. */}
      <nav className="maint-crumbs" aria-label="Breadcrumb">
        <ol className="maint-crumbs__list">
          <li className="maint-crumbs__item">Maintenance</li>
          <li className="maint-crumbs__item maint-crumbs__item--current" aria-current="page">
            {crumbLabel}
          </li>
        </ol>
      </nav>

      {/* Shown only when there is a genuine choice — "a tab strip with one tab
          in it is chrome that does nothing". With User Accounts moved out and
          Service Status hidden, that is nobody today; it comes back the moment
          SHOW_SERVICE_STATUS is flipped. */}
      {available.length > 1 && (
        <div className="maint-subtabs">
          {available.map((v) => (
            <button
              key={v.key}
              className={"maint-subtab" + (activeTab === v.key ? " maint-subtab--active" : "")}
              onClick={() => setActiveTab(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "service" && (
        <div className="maint-screen-panel">
          {error ? (
            <LoadError label="Maintenance data" onRetry={retry} fullSection />
          ) : loading && vehicles.length === 0 ? (
            <div className="maint-screen-loading">Loading maintenance data…</div>
          ) : vehicles.length === 0 ? (
            <TabEmptyState
              icon={<MaintenanceIcon size={44} />}
              title="Maintenance"
              hint="No maintenance records yet. Vehicle service status and history will appear here once the live integration is connected."
            />
          ) : (
            <MaintenancePage
              vehicles={vehicles}
              selectedId={selectedId}
              onSelectVehicle={(v) => setSelectedId(v.id)}
              orgId={orgId}
            />
          )}
        </div>
      )}

      {activeTab === "sensors" && (
        <SensorPanel />
      )}
    </div>
  );
}
