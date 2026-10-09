// MobileHeader — matches the React Native AppHeader exactly.
// Shown only on mobile (< 768px). The desktop AppHeader handles larger screens.

import { useState, useRef, useEffect } from 'react';
import { useAppSelector, useAppActions, useCompanies } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import './MobileHeader.css';
import { companyMark as companyLogo } from '../../lib/companyLogos';
import { usePermissions } from '../../hooks/usePermissions';
import { initialsOf, avatarHue } from '../../lib/avatar';
import { requestTour } from '../../lib/productTour';

export default function MobileHeader({ onSearchOpen, onFeedOpen, onProfileOpen }) {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { setActiveCompanyId, setAccountOpen, setUserAdminOpen, setDesktopActiveTab } = useAppActions();
  const { activeCompany, companies } = useCompanies();
  const { user, logout } = useAuth();
  const { can } = usePermissions();
  // The sidebar's System section, for a phone, which has no sidebar.
  // Fuel Audit readers: the roles the operator named (fuel_audit:read).
  const canTriage = can('fuel_audit:read');
  const { vehicles = [] } = useFleetLiveShared();
  const { focusVehicle } = useMapLayers();


  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const dropRef = useRef(null);
  const userRef = useRef(null);

  // Limited access (no map:read): the bell counts 0, as on the desktop header.
  const unreadCount = !can('map:read') ? 0 : vehicles.filter(v =>
    v.status === 'speeding' || v.status === 'theft'
  ).length;

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropdownOpen(false);
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* `fullName`, not `name` — see the note in AppHeader.jsx. The bug showed up
   * twice on this header: the menu printed the email where the name goes, and
   * the avatar drew its initials from the email, so everyone at one company
   * got the same two letters. */
  const displayName = user?.fullName?.trim() || user?.name?.trim() || '';

  return (
    <header className="mobile-header">
      {/* Left — company logo + name. Two targets, no "View Profile" pill:
          the logo and the chevron switch company, the name opens the profile
          of the company now selected. */}
      <div className="mobile-header__company" ref={dropRef}>
        <div className="mobile-header__company-btn">
          <button
            type="button"
            className="mobile-header__company-switch"
            data-tour="m-org"
            onClick={() => setDropdownOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            aria-label="Switch company"
          >
            <div className={`mobile-header__company-logo${companyLogo(activeCompany) ? ' mobile-header__company-logo--img' : ''}`}>
              {companyLogo(activeCompany)
                ? <img src={companyLogo(activeCompany)} alt="" />
                : <span>RAI</span>}
            </div>
          </button>
          <button
            type="button"
            className="mobile-header__company-name"
            onClick={() => { setDropdownOpen(false); onProfileOpen?.(); }}
            title={`${activeCompany?.name ?? 'Company'} profile`}
          >
            {activeCompany?.name ?? 'Fleet Command'}
          </button>
          {companies.length > 1 && (
            <button
              type="button"
              className="mobile-header__company-chevron"
              onClick={() => setDropdownOpen(o => !o)}
              aria-label="Switch company"
              tabIndex={-1}
            >
              <i className={`ti ti-chevron-${dropdownOpen ? 'up' : 'down'}`} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Company switcher dropdown */}
        {dropdownOpen && (
          <div className="mobile-header__dropdown">
            {companies.map(c => (
              <button
                key={c.id}
                className={`mobile-header__dropdown-item${c.id === activeCompanyId ? ' mobile-header__dropdown-item--active' : ''}`}
                onClick={() => { setActiveCompanyId(c.id); setDropdownOpen(false); }}
              >
                {companyLogo(c)
                  ? <img className="mobile-header__dropdown-logo" src={companyLogo(c)} alt="" />
                  : <span className="mobile-header__dropdown-dot" style={{ background: c.avatarColor ?? '#64748b' }} />}
                <span className="mobile-header__dropdown-name">{c.name}</span>
                {c.id === activeCompanyId && <span className="mobile-header__dropdown-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right — search + bell + avatar */}
      <div className="mobile-header__actions">
        <button className="mobile-header__icon-btn" onClick={onSearchOpen} aria-label="Search" data-tour="m-search">
          <i className="ti ti-search" aria-hidden="true" />
        </button>
        {/* No bell without rights to the fleet (no map:read), as on the desktop. */}
        {can('map:read') && (
          <button className="mobile-header__icon-btn" onClick={onFeedOpen} aria-label="Alerts" data-tour="m-alerts">
            <i className="ti ti-bell" aria-hidden="true" />
            {unreadCount > 0 && <span className="mobile-header__alert-dot" />}
          </button>
        )}
        {/* Holds the bell's place so the avatar does not move. */}
        {!can('map:read') && <span className="mobile-header__icon-btn" aria-hidden="true" style={{ visibility: 'hidden', pointerEvents: 'none' }} />}
        {/* Account menu — the avatar is a BUTTON: on mobile it was a plain
            div, so there was no way to reach Account or to sign out. */}
        <div className="mobile-header__user" ref={userRef}>
          <button
            className="mobile-header__avatar"
            data-tour="m-account"
            onClick={() => setUserOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={userOpen}
            aria-label="Account menu"
          >
            {user ? (
              <span className="mobile-header__avatar-initials" style={{ '--ua': avatarHue(displayName || user.email) }}>
                {initialsOf(displayName, user.email)}
              </span>
            ) : (
              <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
                <circle cx="18" cy="18" r="18" fill="#e2e8f0"/>
                <circle cx="18" cy="14" r="6" fill="#94a3b8"/>
                <ellipse cx="18" cy="30" rx="10" ry="7" fill="#94a3b8"/>
              </svg>
            )}
          </button>

          {userOpen && (
            <div className="mobile-header__user-menu" role="menu">
              <div className="mobile-header__user-info">
                <div className="mobile-header__user-name" title={displayName || user?.email || undefined}>
                  {displayName || user?.email || 'Signed in'}
                </div>
                {displayName && user?.email && (
                  <div className="mobile-header__user-email">{user.email}</div>
                )}
              </div>
              <div className="mobile-header__user-divider" />
              <button className="mobile-header__user-item" onClick={() => { setAccountOpen(true); setUserOpen(false); }}>
                <i className="ti ti-user-circle" aria-hidden="true" /> Account
              </button>
              {canTriage && (
                <button className="mobile-header__user-item" onClick={() => { setDesktopActiveTab('audit'); setUserOpen(false); }}>
                  <i className="ti ti-clipboard-check" aria-hidden="true" /> Fuel audit
                </button>
              )}
              {can('fuel_filling:read') && (
                <button className="mobile-header__user-item" onClick={() => { setDesktopActiveTab('fuelReport'); setUserOpen(false); }}>
                  <i className="ti ti-report-analytics" aria-hidden="true" /> Fuel report
                </button>
              )}
              {can('telemetry:read') && (
                <button className="mobile-header__user-item" onClick={() => { setDesktopActiveTab('usageReview'); setUserOpen(false); }}>
                  <i className="ti ti-car" aria-hidden="true" /> Logbook
                </button>
              )}
              {can('user:create') && (
                <button className="mobile-header__user-item" onClick={() => { setUserAdminOpen(true); setUserOpen(false); }}>
                  <i className="ti ti-users" aria-hidden="true" /> User accounts
                </button>
              )}
              {/* The first-time tour, again (lib/productTour). */}
              <button className="mobile-header__user-item" onClick={() => { setUserOpen(false); requestTour(); }}>
                <i className="ti ti-route-2" aria-hidden="true" /> Take the tour
              </button>
              <div className="mobile-header__user-divider" />
              <button className="mobile-header__user-item" onClick={() => { setUserOpen(false); logout(); }}>
                <i className="ti ti-logout" aria-hidden="true" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}