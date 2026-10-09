// MobileTabBar — bottom navigation for mobile, mirrors the React Native app exactly.
// Only visible on screens < 768px. Desktop is unaffected.
//
// ## It is gated, and it reads the same list the sidebar does
//
// This bar had no permission check at all, which made it the one way round the
// nav on the desktop side: a technician holds sensor:read and nothing else of
// the five, so SidePanel draws four of its five items disabled — and then the
// phone drew the same four live, with the Fleet map as the big green button in
// the middle. Tapping one did not open it (App's guard sends an unpermitted tab
// straight back to the first allowed one), so the result was a bar that bounced
// you off it without saying why, which is worse than a control that is plainly
// not for you.
//
// The permission for each key comes from NAV_ITEMS rather than a second list
// here. Two lists is how the phone came to disagree with the sidebar.
//
// ## The centre button belongs to whoever can use it
//
// The raised button in the middle is the one a thumb reaches without looking,
// and it was nailed to the Live Map. For an account without map:read that made
// the best position on the bar a dead one, and left the screen they actually
// work in as a small tab in the corner.
//
// So when the map is closed to somebody, the centre is SWAPPED with the first
// screen that is open to them: they get the reachable button, and the map takes
// the ordinary slot its replacement came from, dimmed like the rest. Five
// positions either way, so nothing else moves — and anybody who has the map
// sees exactly what they saw before.

import { useAppSelector, useAppActions } from '../../context/AppContext';
import { usePermissions } from '../../hooks/usePermissions';
import { NAV_ITEMS } from './SidePanel';
import './MobileTabBar.css';

/** The raised slot. An index rather than a key, because which tab sits in it is
 *  the thing that varies. */
const CENTRE = 2;

/* `fleet` carries a map icon for the case where it is NOT in the centre — the
   truck is drawn for the centre position only, and a demoted Fleet tab with no
   icon at all would render as a bare label. */
const TABS = [
  { key: 'analytics',    label: 'Analytics',    icon: 'chart-bar' },
  { key: 'drivers',      label: 'Drivers',      icon: 'users'     },
  { key: 'fleet',        label: 'Fleet',        icon: 'map-2'     },
  { key: 'weighbridges', label: 'Weighbridges', icon: 'scale'     },
  { key: 'maintenance',  label: 'Maintenance',  icon: 'tool'      },
];

const permissionFor = (key) => NAV_ITEMS.find((n) => n.key === key)?.permission;

/**
 * The five buttons in order, each marked with whether it is the centre one.
 *
 * Pure and exported for test: this is the whole ordering decision, and the rest
 * of this file is markup. `allowed` is a predicate on a tab key.
 *
 * A swap happens only when the centre tab is closed AND something else is open.
 * An account with nothing open keeps the default arrangement — every button
 * dimmed, which is the honest picture — rather than being handed a promoted
 * button it cannot use either.
 */
export function barTabs(allowed) {
  const centre = TABS[CENTRE];
  const mark = (list) => list.map((t, i) => ({ ...t, fab: i === CENTRE }));

  if (allowed(centre.key)) return mark(TABS);

  const promoted = TABS.find((t) => t.key !== centre.key && allowed(t.key));
  if (!promoted) return mark(TABS);

  const out = [...TABS];
  out[CENTRE] = promoted;
  out[TABS.indexOf(promoted)] = centre;
  return mark(out);
}

export default function MobileTabBar() {
  const desktopActiveTab = useAppSelector((a) => a.desktopActiveTab);
  const { setDesktopActiveTab } = useAppActions();
  const { can } = usePermissions();

  /* An unknown key is allowed rather than blocked: a tab this bar knows about
     and NAV_ITEMS does not is a bug in the two lists, and failing it closed
     would hide a working screen. The screens themselves are gated in App,
     which is the check that decides anything. */
  const allowed = (key) => {
    const perm = permissionFor(key);
    return perm ? can(perm) : true;
  };

  return (
    <nav className="mobile-tab-bar" data-tour="m-tabs">
      {barTabs(allowed).map(tab => {
        const isActive = desktopActiveTab === tab.key;
        const isOpen   = allowed(tab.key);

        if (tab.fab) {
          return (
            <button
              key={tab.key}
              className={[
                'mobile-tab-bar__fab',
                isActive ? 'mobile-tab-bar__fab--active'   : '',
                !isOpen  ? 'mobile-tab-bar__fab--disabled' : '',
              ].join(' ').trim()}
              onClick={() => setDesktopActiveTab(tab.key)}
              disabled={!isOpen}
              aria-label={tab.key === 'fleet' ? 'Fleet map' : tab.label}
            >
              {tab.key === 'fleet' ? (
                /* Truck SVG — same as RN app */
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                </svg>
              ) : (
                <i className={`ti ti-${tab.icon} mobile-tab-bar__fab-icon`} aria-hidden="true" />
              )}
              <span className="mobile-tab-bar__fab-label">{tab.label}</span>
            </button>
          );
        }

        return (
          <button
            key={tab.key}
            className={[
              'mobile-tab-bar__item',
              isActive ? 'mobile-tab-bar__item--active'   : '',
              !isOpen  ? 'mobile-tab-bar__item--disabled' : '',
            ].join(' ').trim()}
            onClick={() => setDesktopActiveTab(tab.key)}
            disabled={!isOpen}
          >
            <i className={`ti ti-${tab.icon} mobile-tab-bar__icon`} aria-hidden="true" />
            <span className="mobile-tab-bar__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
