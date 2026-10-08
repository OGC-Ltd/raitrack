// AppHeader — light top bar: logo, org switcher, search, notifications, avatar.

import { useState, useRef, useEffect } from 'react';
import { useAppFields, useAppActions, useCompanies } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { usePermissions } from '../../hooks/usePermissions';
import LiveFeed from './LiveFeed';
import { FuelFollowUpHost } from '../body/FuelFollowUp';
import './AppHeader.css';
import raiLogo from '../../assets/rai-group-logo.jpeg';
import { companyMark as companyLogo } from '../../lib/companyLogos';
import { initialsOf, avatarHue } from '../../lib/avatar';

// Never opened in this browser → count only the last 24 hours, so a first
// visit isn't greeted with every alert in the replayed history.
function readSeen(key) {
  let v = 0;
  try { v = Number(localStorage.getItem(key)) || 0; } catch { /* storage off */ }
  return v || Date.now() - 24 * 3600_000;
}

/**
 * How many feed items this operator has not seen, and whether any of them is
 * a problem.
 *
 * EVERY unseen item counts, not just the warning/critical ones. The filter
 * here used to admit those two severities and nothing else, and almost
 * nothing this fleet produces is either: a dispatch, a gate crossing and both
 * halves of a sale are published `info` or `success`
 * (raifactorysuite-events.service), and the telemetry narration spends
 * `warning` on a service redirect and `critical` on suspected theft. So the
 * feed filled all day behind a badge that sat at zero — the counter was
 * working, on a set that is empty on almost every fleet-day.
 *
 * The bell OPENS the feed, so its badge has to count what the feed holds.
 * Bounded twice over: pruneFeed caps the panel at MAX_FEED_ITEMS across a
 * 12-hour horizon, and bellBadgeLabel caps the glyph at "20".
 *
 * It returns a COUNT and nothing else. There was an `alarming` flag beside it,
 * colouring the badge red only when a warning or a critical was among the
 * unseen; the badge is now always red, so the flag drove nothing and is gone
 * rather than left computed on every render for a caller that ignores it.
 *
 * Exported because it is the whole of the rule and none of the rendering,
 * the same reason groupLayers is exported from MapLayersTree.
 */
export function summariseUnread(feed, lastSeen) {
  let unreadCount = 0;
  for (const f of feed ?? []) {
    const t = Date.parse(f?.ts);
    // A malformed or missing timestamp cannot be placed against `lastSeen`,
    // and counting it would make the badge tick up on every reconnect that
    // replays it. Silently not-new is the safe reading.
    if (!Number.isFinite(t) || t <= lastSeen) continue;
    unreadCount += 1;
  }
  return { unreadCount };
}

/**
 * What the bell's badge says: the exact count, stopping at 20.
 *
 * The badge answers "is there news, and roughly how much" — past twenty the
 * operator is going to open the feed either way, and a number still climbing
 * in the corner of the header is noise, not information.
 *
 * No "+" on the capped figure. "20+" was tried: it needs a third glyph in a
 * ring sized for two, and every way of fitting it — a bigger ring, smaller
 * type, a shrunken plus — made the badge worse to look at. The accessible
 * label still says "20 or more", so the cap is not hidden from anyone.
 */
export const BELL_CAP = 20;
export function bellBadgeLabel(count) {
  return String(Math.min(count, BELL_CAP));
}

// Company logo, or its coloured letter when there's no logo on file.
function CompanyMark({ company, size = 'md' }) {
  if (!company) return null;
  const logo = companyLogo(company);
  return (
    <span className={`app-header__co-mark app-header__co-mark--${size}`}>
      {logo
        ? <img src={logo} alt="" />
        : <span className="app-header__co-letter" style={{ background: company.avatarColor ?? '#64748b' }}>
            {company.avatarLetter ?? company.name?.[0] ?? '?'}
          </span>}
    </span>
  );
}

export default function AppHeader() {
  const { activeCompanyId, selectedVehicleId } = useAppFields("activeCompanyId", "selectedVehicleId");
  const { setActiveCompanyId, setAccountOpen, setUserAdminOpen, setSelectedVehicleId } = useAppActions();
  const { activeCompany, companies } = useCompanies();
  const { can } = usePermissions();
  const { user, logout } = useAuth();

  /* The server's field is `fullName`. This header asked for `user.name`, which
   * is not on the object and never was — api/account.js writes `fullName`, and
   * UserAdminPanel, RepairJobsPanel and header/UserMenu all read it. So the
   * name line fell through to the email on every account, and the menu printed
   * the same address twice: once where the person's name belongs and once as
   * the address underneath it.
   *
   * `||` rather than `??`, because an account synced from the driver registry
   * can carry an empty string here, which `??` would happily render as a blank
   * line. */
  const displayName = user?.fullName?.trim() || user?.name?.trim() || '';
  const { feed } = useFleetLiveShared();

  const [orgOpen,        setOrgOpen]        = useState(false);
  const [feedOpen,       setFeedOpen]       = useState(false);
  const [feedUnreadSince, setFeedUnreadSince] = useState(() => Date.now());
  const [userOpen,       setUserOpen]       = useState(false);

  const orgRef  = useRef(null);
  const userRef = useRef(null);

  // Unread = feed items newer than the last time this operator opened the
  // feed, remembered per organisation in this browser.
  const seenKey = `ft-feed-seen:${activeCompanyId}`;
  const [lastSeen, setLastSeen] = useState(() => readSeen(seenKey));
  useEffect(() => { setLastSeen(readSeen(seenKey)); }, [seenKey]);
  const markSeen = () => {
    const now = Date.now();
    setLastSeen(now);
    try { localStorage.setItem(seenKey, String(now)); } catch { /* storage off */ }
  };
  // No rights to the fleet (no map:read, operator 2026-10-01): no bell and no
  // feed at all. The feed is the fleet's events, which such an account is not
  // shown anywhere else (the sidebar dashes its counts).
  const limited = !can('map:read');
  const { unreadCount } = limited ? { unreadCount: 0 } : summariseUnread(feed, lastSeen);
  const badge = bellBadgeLabel(unreadCount);
  // The bell swings once when the count goes up — news arrived — and not when
  // it falls (opening the feed) or on a re-render with the same count.
  const prevUnread = useRef(unreadCount);
  const [swing, setSwing] = useState(0);
  useEffect(() => {
    if (unreadCount > prevUnread.current) setSwing(n => n + 1);
    prevUnread.current = unreadCount;
  }, [unreadCount]);
  const bellWords = unreadCount === 0 ? 'Notifications'
    : unreadCount >= BELL_CAP ? `Notifications, ${BELL_CAP} or more new events`
    : `Notifications, ${unreadCount} new event${unreadCount === 1 ? '' : 's'}`;

  // The live feed and the vehicle detail panel share the right edge — only one
  // may be open. Selecting a vehicle (map pin, search, feed row) closes the feed…
  useEffect(() => {
    if (selectedVehicleId) setFeedOpen(false);
  }, [selectedVehicleId]);

  // …and opening the feed closes the vehicle panel.
  const toggleFeed = () => {
    if (!feedOpen) {
      setSelectedVehicleId(null);
      // What was unread at the moment of opening: the panel marks those (and
      // anything arriving while it is open) as new. Captured BEFORE markSeen,
      // which would otherwise leave the panel nothing to mark.
      setFeedUnreadSince(lastSeen);
    }
    // Opening or closing the feed counts as having seen everything in it.
    markSeen();
    setFeedOpen(!feedOpen);
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (orgRef.current  && !orgRef.current.contains(e.target))  setOrgOpen(false);
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOrgSelect = (id) => {
    setActiveCompanyId(id);
    setOrgOpen(false);
  };

  return (
    <>
      <header className="app-header">

        {/* Logo */}
        {/* Active company's logo (RAI Group logo if the company has none).
            Its left edge lines up with the side panel's cards below. */}
        <img
          src={companyLogo(activeCompany) ?? raiLogo}
          alt={activeCompany?.name ?? 'RAI Group'}
          className="app-header__logo"
        />
        <span className="app-header__divider" />

        {/* Org switcher */}
        <div className="app-header__org-wrap" ref={orgRef}>
          <button
            className="app-header__org-btn"
            onClick={() => setOrgOpen(o => !o)}
            aria-haspopup="listbox"
            aria-expanded={orgOpen}
          >
            {activeCompany?.name ?? 'Select organisation'}
            <span className="app-header__org-chevron">▾</span>
          </button>

          {orgOpen && (
            <div className="app-header__org-menu" role="listbox">
              <div className="app-header__org-menu-label">Switch organisation</div>
              {companies.map(c => (
                <button
                  key={c.id}
                  role="option"
                  aria-selected={c.id === activeCompanyId}
                  className={`app-header__org-item${c.id === activeCompanyId ? ' app-header__org-item--active' : ''}`}
                  onClick={() => handleOrgSelect(c.id)}
                >
                  <CompanyMark company={c} size="sm" />
                  <span className="app-header__org-name">{c.name}</span>
                  {c.id === activeCompanyId && <span className="app-header__org-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* No search box here since 2026-10-07: vehicle, driver and place search
            live in the map's tool rail (MapToolRail), beside the sidebar. */}

        {/* Notification bell — not rendered without rights to the fleet. */}
        {!limited && (
        <button
          className={`app-header__bell${feedOpen ? ' app-header__bell--active' : ''}${unreadCount > 0 ? ' app-header__bell--news' : ''}`}
          onClick={toggleFeed}
          // The count lives in the name: a label on the badge inside a labelled
          // button is never read out.
          aria-label={bellWords}
          aria-expanded={feedOpen}
        >
          {/* The badge's notch is cut from this still frame, so the bell swings
              behind the badge instead of dragging the notch with it. */}
          <span className="app-header__bell-glyph" aria-hidden="true">
            <i
              key={`icon-${swing}`}
              className={`ti ${feedOpen ? 'ti-bell-filled' : 'ti-bell'}${swing ? ' app-header__bell-icon--swing' : ''}`}
            />
          </span>
          {unreadCount > 0 && (
            // Keyed on the figure so it pops when the figure changes
            <span key={`count-${badge}`} className="app-header__bell-count" data-len={badge.length} aria-hidden="true">{badge}</span>
          )}
        </button>
        )}
        {/* Holds the bell's place so the avatar stays where it always sits. */}
        {limited && <span className="app-header__bell" aria-hidden="true" style={{ visibility: 'hidden', pointerEvents: 'none' }} />}

        {/* User avatar */}
        <div className="app-header__user-wrap" ref={userRef}>
          {/* Initials in a small tinted circle, in a target the bell's size: the
              old grey silhouette filled 30px solid and outweighed the bell's
              outline icon (operator, 2026-10-02). */}
          <button
            className={`app-header__avatar${userOpen ? ' app-header__avatar--open' : ''}`}
            onClick={() => setUserOpen(o => !o)}
            aria-label="User menu"
            aria-haspopup="menu"
            aria-expanded={userOpen}
          >
            {user
              ? (
                <span className="app-header__avatar-face" style={{ '--ua': avatarHue(displayName || user.email) }} aria-hidden="true">
                  {initialsOf(displayName, user.email)}
                </span>
              )
              : <i className="ti ti-user-circle" aria-hidden="true" />}
          </button>

          {userOpen && (
            <div className="app-header__user-menu">
              <div className="app-header__user-info">
                <div className="app-header__user-name" title={displayName || user?.email || undefined}>
                  {displayName || user?.email || 'Signed in'}
                </div>
                {/* Only when it is saying something the line above did not. With
                    no name on the account the address IS the identity, and
                    repeating it just makes the menu look broken. */}
                {displayName && user?.email && (
                  <div className="app-header__user-email" title={user.email}>{user.email}</div>
                )}
              </div>
              <div className="app-header__user-divider" />
              <button className="app-header__user-item" onClick={() => { setAccountOpen(true); setUserOpen(false); }}>
                <i className="ti ti-user-circle" aria-hidden="true" />
                Account
              </button>
              {can('user:create') && (
                <button className="app-header__user-item" onClick={() => { setUserAdminOpen(true); setUserOpen(false); }}>
                  <i className="ti ti-users" aria-hidden="true" />
                  User accounts
                </button>
              )}
              <div className="app-header__user-divider" />
              <button className="app-header__user-item" onClick={logout}>
                <i className="ti ti-logout" aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
        </div>

      </header>

      {/* Live feed panel — slides in from right */}
      {!limited && <LiveFeed open={feedOpen} onClose={() => setFeedOpen(false)} unreadSince={feedUnreadSince} />}
      {/* The fuel follow-up case window. Here rather than on the map because
          it opens from the Live Feed too, and technicians have no map. */}
      <FuelFollowUpHost />
    </>
  );
}
