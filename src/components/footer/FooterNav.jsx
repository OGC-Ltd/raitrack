// Desktop footer nav: Drivers, Weighbridges, Fleet, Maintenance, Analytics.
//
// The five buttons used to be hand-written JSX, which made "show only what this
// account may open" impossible without repeating the check five times. They are
// a list now, graded by permission before rendering.
//
// ## Disabled, not absent
//
// All five always render. A tab the account cannot open is disabled and says
// why on hover, rather than being dropped.
//
// This is a deliberate exception to the rule the rest of the app follows
// (DownloadReportButton: a control you cannot use should be absent, not
// disabled). It is the operator's call, and the reasoning holds better here
// than it does for a button inside a page: the footer is the map of the
// product. An operator who sees three buttons where a colleague sees five has
// no way to tell that the other two exist, and "can I get Analytics?" is a
// question they can only ask if they know Analytics is there. A greyed button
// is an answer; a missing one is a silence.
//
// The permission check is still the thing that protects the screen — App.jsx
// grades `show()` independently, so nothing renders behind a disabled button
// even if one were somehow clicked.
//
// ## The single-tab swap
//
// When exactly one tab is openable, that tab and Fleet exchange places — the
// live one takes the centre FAB, Fleet takes its slot on the rim. The rule
// above survives it: five buttons still render and still explain themselves.
// See the comment on `solo` below.
//
// Disabling is NOT the whole of it. `ft-desktop-tab` restores the last screen
// from localStorage on load, so a returning user whose access changed would
// land straight on a tab they can no longer open — see AppContext, which
// filters the restore, and App.jsx, which guards the render.

import "./FooterNav.css";
import NavItem from "./NavItem";
import NavFab from "./NavFab";
import { DriversIcon, FleetIcon, MaintenanceIcon, AnalyticsIcon, WeighbridgeIcon } from "./NavIcons";
import { useAppContext } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";

/**
 * The nav, as data.
 *
 * `side` places each item relative to the centre FAB. The two side groups are
 * equal-flex, so they keep the FAB centred even when one of them empties out —
 * which is exactly what happens to an accountant, who gets neither Drivers nor
 * Weighbridges.
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
 * ONE LIVE TAB: it trades places with Fleet.
 *
 * The centre FAB is the most prominent thing on the bar, and on a role with a
 * single openable screen it was spent on Fleet — a button that account can
 * never press — while the one screen they actually work in sat out on the rim.
 * A technician saw four dead buttons around a dead centrepiece.
 *
 * So the live tab takes the middle and the FAB's styling, and Fleet takes the
 * slot and the ordinary tab styling it vacated. A genuine SWAP, not a
 * promotion: the positions exchange, so Fleet lands exactly where the live tab
 * was rather than at the head of its group. Swapping only the `side` values
 * would look right for a tab that happens to be first in its group and wrong
 * for any other, which is the sort of thing that ships.
 *
 * This does NOT break the disabled-not-absent rule this file argues for above.
 * All five buttons still render, still grey, still say on hover which
 * permission they need — an operator can still see that Analytics exists and
 * ask for it. What changes is only which of them gets the loudest position.
 *
 * Two tabs live and the bar is navigation again, so the swap stops. And when
 * the single live tab IS Fleet there is nothing to exchange.
 *
 * Pure, and exported, so the arrangement can be tested without standing up two
 * React contexts to ask what a technician's footer looks like.
 *
 * @param {Array<{key: string, side: string, allowed: boolean}>} graded
 */
export function arrangeNav(graded) {
  const live = graded.filter((t) => t.allowed);
  if (live.length !== 1) return graded;

  const solo = live[0];
  if (solo.side === "fab") return graded;

  const i = graded.findIndex((t) => t.key === solo.key);
  const j = graded.findIndex((t) => t.side === "fab");
  if (i === -1 || j === -1) return graded;

  // Both read from `graded`, never from `out`: assigning out[i] first would
  // clobber the entry out[j] still needs.
  const out = graded.slice();
  out[i] = { ...graded[j], side: solo.side };
  out[j] = { ...graded[i], side: "fab" };
  return out;
}

export default function FooterNav() {
  const { desktopActiveTab, setDesktopActiveTab } = useAppContext();
  const { can } = usePermissions();

  // The Maint icon used to carry an "attention" badge counting Overdue + Due
  // Soon + In Service. All three were graded against invented service
  // intervals (see lib/vehicleReadings), so the badge asserted urgency that
  // nothing measured. There is no honest count to put here until a
  // maintenance system is connected, so the badge is gone rather than
  // reworded.
  const maintAlertCount = 0;

  // Every tab, in order, each carrying whether this account may open it.
  const graded = NAV_TABS.map((t) => ({ ...t, allowed: can(t.permission) }));

  const tabs = arrangeNav(graded);

  const side = (which) => tabs.filter((t) => t.side === which);
  const fab = tabs.find((t) => t.side === "fab");

  // Named after the permission rather than the tab, because that is what an
  // administrator needs to hear to grant it.
  const why = (tab) => `${tab.label} needs the ${tab.permission} permission, which this account does not have`;

  const render = (tab) => (
    <NavItem
      key={tab.key}
      icon={<tab.Icon active={desktopActiveTab === tab.key} />}
      label={tab.label}
      active={desktopActiveTab === tab.key}
      disabled={!tab.allowed}
      title={tab.allowed ? undefined : why(tab)}
      onClick={() => setDesktopActiveTab(tab.key)}
      {...(tab.key === "maintenance" ? { badge: maintAlertCount } : {})}
    />
  );

  return (
    <nav className="footer-nav" role="navigation" aria-label="Main navigation">
      {/* Equal-flex side groups around a fixed-width FAB keep the centre
          button pinned to the exact horizontal centre of the bar. Usually
          Fleet — but `arrangeNav` can put another tab here, and the layout
          neither knows nor cares which. Both groups are rendered even when
          empty, which the swap makes likelier than it used to be. */}
      <div className="footer-nav__items">
        <div className="footer-nav__side">{side("left").map(render)}</div>

        {fab && (
          <NavFab
            icon={<fab.Icon active={desktopActiveTab === fab.key} size={24} />}
            label={fab.label}
            active={desktopActiveTab === fab.key}
            disabled={!fab.allowed}
            title={fab.allowed ? undefined : why(fab)}
            onClick={() => setDesktopActiveTab(fab.key)}
          />
        )}

        <div className="footer-nav__side">{side("right").map(render)}</div>
      </div>
    </nav>
  );
}
