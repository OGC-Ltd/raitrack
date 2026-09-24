// MobileHeader — matches the React Native AppHeader exactly.
// Shown only on mobile (< 768px). The desktop AppHeader handles larger screens.

import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import './MobileHeader.css';
import { companyMark as companyLogo } from '../../lib/companyLogos';
import { usePermissions } from '../../hooks/usePermissions';
import { needsMe, useFollowUps } from '../../lib/fuelFollowUps';

export default function MobileHeader({ onSearchOpen, onFeedOpen, onProfileOpen }) {
  const { activeCompany, companies, setActiveCompanyId, activeCompanyId, setAccountOpen, setUserAdminOpen, setDesktopActiveTab } = useAppContext();
  const { user, logout } = useAuth();
  const { can, orgId } = usePermissions();
  // The sidebar's System section, for a phone, which has no sidebar.
  const canTriage = can('fuel_theft:triage');
  const systemCount = useFollowUps(orgId, canTriage).items.filter(needsMe).length;
  const { vehicles = [] } = useFleetLiveShared();
  const { focusVehicle } = useMapLayers();


  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const dropRef = useRef(null);
  const userRef = useRef(null);

  const unreadCount = vehicles.filter(v =>
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

  const initials = (name = '', email = '') => {
    const src = String(name).trim() || String(email).trim();
    if (!src) return '?';
    const words = src.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  };

  return (
    <header className="mobile-header">
      {/* Left — company logo + name */}
      <div className="mobile-header__company" ref={dropRef}>
        <button
          className="mobile-header__company-btn"
          onClick={() => setDropdownOpen(o => !o)}
        >
          <div className={`mobile-header__company-logo${companyLogo(activeCompany) ? ' mobile-header__company-logo--img' : ''}`}>
            {companyLogo(activeCompany)
              ? <img src={companyLogo(activeCompany)} alt={activeCompany?.name ?? ''} />
              : <span>RAI</span>}
          </div>
          <div className="mobile-header__company-info">
            <div className="mobile-header__company-name">
              {activeCompany?.name ?? 'Fleet Command'}
            </div>
            <div className="mobile-header__view-profile" onClick={(e) => { e.stopPropagation(); onProfileOpen?.(); }}>
              View Profile ›
            </div>
          </div>
        </button>

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
        <button className="mobile-header__icon-btn" onClick={onSearchOpen} aria-label="Search">
          <i className="ti ti-search" aria-hidden="true" />
        </button>
        <button className="mobile-header__icon-btn" onClick={onFeedOpen} aria-label="Alerts">
          <i className="ti ti-bell" aria-hidden="true" />
          {unreadCount > 0 && <span className="mobile-header__alert-dot" />}
        </button>
        {/* Account menu — the avatar is a BUTTON: on mobile it was a plain
            div, so there was no way to reach Account or to sign out. */}
        <div className="mobile-header__user" ref={userRef}>
          <button
            className="mobile-header__avatar"
            onClick={() => setUserOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={userOpen}
            aria-label={systemCount > 0 ? `Account menu, ${systemCount} system notifications waiting on you` : 'Account menu'}
          >
            {user ? (
              <span className="mobile-header__avatar-initials">{initials(displayName, user.email)}</span>
            ) : (
              <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
                <circle cx="18" cy="18" r="18" fill="#e2e8f0"/>
                <circle cx="18" cy="14" r="6" fill="#94a3b8"/>
                <ellipse cx="18" cy="30" rx="10" ry="7" fill="#94a3b8"/>
              </svg>
            )}
          </button>
          {/* Outside the avatar, which clips to its circle. */}
          {systemCount > 0 && <span className="mobile-header__avatar-dot" aria-hidden="true" />}

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
                <button className="mobile-header__user-item" onClick={() => { setDesktopActiveTab('system'); setUserOpen(false); }}>
                  <i className="ti ti-script" aria-hidden="true" /> System
                  {systemCount > 0 && (
                    <>
                      <span className="mobile-header__user-alertdot" aria-hidden="true" />
                      <span className="mobile-header__user-badge">{systemCount}</span>
                    </>
                  )}
                </button>
              )}
              {can('user:create') && (
                <button className="mobile-header__user-item" onClick={() => { setUserAdminOpen(true); setUserOpen(false); }}>
                  <i className="ti ti-users" aria-hidden="true" /> User accounts
                </button>
              )}
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