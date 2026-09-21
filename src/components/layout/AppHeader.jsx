// AppHeader — light top bar: logo, org switcher, search, notifications, avatar.

import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import { usePermissions } from '../../hooks/usePermissions';
import LiveFeed from './LiveFeed';
import './AppHeader.css';
import raiLogo from '../../assets/rai-group-logo.jpeg';
import { companyMark as companyLogo } from '../../lib/companyLogos';

// Never opened in this browser → count only the last 24 hours, so a first
// visit isn't greeted with every alert in the replayed history.
function readSeen(key) {
  let v = 0;
  try { v = Number(localStorage.getItem(key)) || 0; } catch { /* storage off */ }
  return v || Date.now() - 24 * 3600_000;
}

// "Online" for a live unit, otherwise when it was last heard from.
function lastSeenLabel(v) {
  if (v.online) return 'Online';
  const ms = v.capturedAtMs;
  if (!Number.isFinite(ms)) return 'Never reported';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1)    return 'Last seen just now';
  if (mins < 60)   return `Last seen ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)    return `Last seen ${days}d ago`;
  return `Last seen ${new Date(ms).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
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
  const { activeCompany, companies, setActiveCompanyId, activeCompanyId, setAccountOpen, setUserAdminOpen, selectedVehicleId, setSelectedVehicleId } = useAppContext();
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
  const { feed, vehicles = [] } = useFleetLiveShared();
  const { focusVehicle } = useMapLayers();

  const [orgOpen,        setOrgOpen]        = useState(false);
  const [feedOpen,       setFeedOpen]       = useState(false);
  const [userOpen,       setUserOpen]       = useState(false);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [searchResults,  setSearchResults]  = useState([]);
  const [searchOpen,     setSearchOpen]     = useState(false);

  const orgRef  = useRef(null);
  const userRef = useRef(null);

  // Unread = warning/critical feed items newer than the last time this
  // operator opened the feed, remembered per organisation in this browser.
  const seenKey = `ft-feed-seen:${activeCompanyId}`;
  const [lastSeen, setLastSeen] = useState(() => readSeen(seenKey));
  useEffect(() => { setLastSeen(readSeen(seenKey)); }, [seenKey]);
  const markSeen = () => {
    const now = Date.now();
    setLastSeen(now);
    try { localStorage.setItem(seenKey, String(now)); } catch { /* storage off */ }
  };
  const unreadCount = (feed ?? []).filter(f => {
    if (f.type !== 'warning' && f.type !== 'critical') return false;
    const t = Date.parse(f.ts);
    return Number.isFinite(t) && t > lastSeen;
  }).length;
  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  // The live feed and the vehicle detail panel share the right edge — only one
  // may be open. Selecting a vehicle (map pin, search, feed row) closes the feed…
  useEffect(() => {
    if (selectedVehicleId) setFeedOpen(false);
  }, [selectedVehicleId]);

  // …and opening the feed closes the vehicle panel.
  const toggleFeed = () => {
    if (!feedOpen) setSelectedVehicleId(null);
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

  const handleSearchInput = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    const matches = vehicles.filter(v =>
      v.id?.toLowerCase().includes(q.toLowerCase()) ||
      v.driver?.toLowerCase().includes(q.toLowerCase()) ||
      v.name?.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 6);
    setSearchResults(matches);
    setSearchOpen(matches.length > 0);
  };

  const handleSelectVehicle = (v) => {
    focusVehicle(v.id);
    setSearchQuery(v.id);
    setSearchOpen(false);
    setSearchResults([]);
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

        {/* Search */}
        <div className="app-header__search-wrap">
          <div className="app-header__search">
            <i className="ti ti-search app-header__search-icon" aria-hidden="true" />
            <input
              type="text"
              className="app-header__search-input"
              placeholder="Search plate or driver..."
              value={searchQuery}
              onChange={handleSearchInput}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            />
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="app-header__search-dropdown">
              {searchResults.map(v => (
                <button
                  key={v.id}
                  className="app-header__search-result"
                  onMouseDown={() => handleSelectVehicle(v)}
                >
                  <span className="app-header__search-result-plate">{v.id}</span>
                  <span className="app-header__search-result-driver">{v.driver}</span>
                  <span className={`app-header__search-result-seen${v.online ? ' app-header__search-result-seen--on' : ''}`}>
                    {lastSeenLabel(v)}
                  </span>
                  <span
                    className="app-header__search-result-dot"
                    style={{ background: v.online ? (v.status === 'speeding' || v.status === 'theft' ? '#ef4444' : '#22c55e') : '#9ca3af' }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notification bell */}
        <button
          className={`app-header__bell${feedOpen ? ' app-header__bell--active' : ''}`}
          onClick={toggleFeed}
          aria-label="Notifications"
        >
          <i className="ti ti-bell" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="app-header__bell-count" aria-label={`${unreadCount} unread alerts`}>{badge}</span>
          )}
        </button>

        {/* User avatar */}
        <div className="app-header__user-wrap" ref={userRef}>
          <button
            className="app-header__avatar"
            onClick={() => setUserOpen(o => !o)}
            aria-label="User menu"
          >
            <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="30" height="30">
              <circle cx="18" cy="18" r="18" fill="#e2e8f0"/>
              <circle cx="18" cy="14" r="6" fill="#94a3b8"/>
              <ellipse cx="18" cy="30" rx="10" ry="7" fill="#94a3b8"/>
            </svg>
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
      <LiveFeed open={feedOpen} onClose={() => setFeedOpen(false)} />
    </>
  );
}
