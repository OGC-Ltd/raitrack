// Desktop footer navigation. Tabs the signed-in user cannot access are
// omitted; App.jsx independently guards each screen.

import "./FooterNav.css";
import NavItem from "./NavItem";
import NavFab from "./NavFab";
import { DriversIcon, FleetIcon, MaintenanceIcon, AnalyticsIcon, WeighbridgeIcon } from "./NavIcons";
import { useAppSelector, useAppActions } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";

/**
 * The nav, as data.
 *
 * `side` places each available item relative to the centre FAB. Unavailable
 * resources are omitted rather than shown as disabled navigation.
 */
export const NAV_TABS = [
  { key: "drivers",      label: "Drivers",      permission: "driver:read",      side: "left",  Icon: DriversIcon },
  { key: "weighbridges", label: "Weighbridges", permission: "weighbridge:read", side: "left",  Icon: WeighbridgeIcon },
  { key: "fleet",        label: "Fleet",        permission: "map:read",         side: "fab",   Icon: FleetIcon },
  /* `sensor:read`, NOT `vehicle:read`.
   *
   * Every tracking role holds vehicle:read — it is what puts a unit on the map
   * — so gating on it let an OPERATOR, whose whole role is "activity and
   * nothing else", open a screen of service intervals and probe diagnostics.
   * This tab is Service Status and Sensor Monitor, and sensor:read is the
   * permission that names that data. Supervisor loses it for the same reason
   * and by the same rule; super_admin keeps it through the platform:admin
   * wildcard in usePermissions.can.
   *
   * App.jsx's `show()` resolves the gate from this table too, so the SCREEN is
   * closed by the same edit as the button — a stored desktopActiveTab of
   * "maintenance" cannot render it for someone who may not see it. */
  { key: "maintenance",  label: "Maint",        permission: "sensor:read",      side: "right", Icon: MaintenanceIcon },
  { key: "analytics",    label: "Analytics",    permission: "analytics:read",   side: "right", Icon: AnalyticsIcon },
];

/**
 * Omit unavailable tabs and place the remaining resources around the centre
 * FAB. When Fleet is unavailable, an available tab takes the centre instead.
 *
 * @param {Array<{key: string, side: string, allowed: boolean}>} graded
 */
export function arrangeNav(graded) {
  const visible = graded.filter((tab) => tab.allowed);
  if (visible.length === 0) return [];
  if (visible.some((tab) => tab.side === "fab")) return visible;

  const centreIndex = Math.floor(visible.length / 2);
  return visible.map((tab, index) => ({
    ...tab,
    side: index === centreIndex ? "fab" : index < centreIndex ? "left" : "right",
  }));
}

export default function FooterNav() {
  const desktopActiveTab = useAppSelector((a) => a.desktopActiveTab);
  const { setDesktopActiveTab } = useAppActions();
  const { can } = usePermissions();

  // The Maint icon used to carry an "attention" badge counting Overdue + Due
  // Soon + In Service. All three were graded against invented service
  // intervals (see lib/vehicleReadings), so the badge asserted urgency that
  // nothing measured. There is no honest count to put here until a
  // maintenance system is connected, so the badge is gone rather than
  // reworded.
  const maintAlertCount = 0;

  // Grade once, then arrangeNav removes every tab this account cannot open.
  const graded = NAV_TABS.map((t) => ({ ...t, allowed: can(t.permission) }));

  const tabs = arrangeNav(graded);

  const side = (which) => tabs.filter((t) => t.side === which);
  const fab = tabs.find((t) => t.side === "fab");
  if (tabs.length === 0) return null;

  const render = (tab) => (
    <NavItem
      key={tab.key}
      icon={<tab.Icon active={desktopActiveTab === tab.key} />}
      label={tab.label}
      active={desktopActiveTab === tab.key}
      onClick={() => setDesktopActiveTab(tab.key)}
      {...(tab.key === "maintenance" ? { badge: maintAlertCount } : {})}
    />
  );

  return (
    <nav className="footer-nav" role="navigation" aria-label="Main navigation">
      {/* Equal-flex side groups around a fixed-width FAB keep the centre
          button pinned to the exact horizontal centre of the bar. */}
      <div className="footer-nav__items">
        <div className="footer-nav__side">{side("left").map(render)}</div>

        {fab && (
          <NavFab
            icon={<fab.Icon active={desktopActiveTab === fab.key} size={24} />}
            label={fab.label}
            active={desktopActiveTab === fab.key}
            onClick={() => setDesktopActiveTab(fab.key)}
          />
        )}

        <div className="footer-nav__side">{side("right").map(render)}</div>
      </div>
    </nav>
  );
}
