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
import ManualIcon from './ManualIcon';
import MapMoreMenu from '../body/MapMoreMenu';

export default function MobileHeader({ onSearchOpen, onFeedOpen, onProfileOpen }) {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { setActiveCompanyId, setAccountOpen, setUserAdminOpen } = useAppActions();
  const { activeCompany, companies } = useCompanies();
  const { user, logout } = useAuth();
  const { can, orgsWhere } = usePermissions();
  // Alerts, its count, the pages and the account all live in the ☰ (MapMoreMenu).
  const { vehicles = [] } = useFleetLiveShared();
  const { focusVehicle, layers, revealMap } = useMapLayers();
  // Work plans is the map's own layer (published by FleetMap): picked from
  // any page, it puts the map on screen with the layer on.
  const plansLayer = layers.find((l) => l.id === 'workplans');
  const workPlans = plansLayer ? {
    on: plansLayer.on,
    onToggle: plansLayer.onToggle,
    onShow: () => { revealMap(); if (!plansLayer.on) plansLayer.onToggle(); },
  } : null;


  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef(null);

  // Limited access (no map:read): the bell counts 0, as on the desktop header.
  const unreadCount = !can('map:read') ? 0 : vehicles.filter(v =>
    v.status === 'speeding' || v.status === 'theft'
  ).length;

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* `fullName`, not `name` — see the note in AppHeader.jsx. The bug showed up
   * twice on this header: the menu printed the email where the name goes, and
   * the avatar drew its initials from the email, so everyone at one company
   * got the same two letters. */
  const displayName = user?.fullName?.trim() || user?.name?.trim() || '';

  // The account, as the ☰'s last group: who is signed in, then what the
  // avatar's menu held.
  const account = user ? {
    name: displayName || user.email || 'Signed in',
    email: displayName ? user.email : null,
    initials: initialsOf(displayName, user.email),
    hue: avatarHue(displayName || user.email),
    items: [
      { key: 'owner', label: 'Owner', icon: <i className="ti ti-user-circle" aria-hidden="true" />, onClick: () => setAccountOpen(true) },
      ...(orgsWhere('user:read').length > 0
        ? [{ key: 'iam', label: 'IAM', icon: <i className="ti ti-users" aria-hidden="true" />, onClick: () => setUserAdminOpen(true) }]
        : []),
      { key: 'guide', label: 'Guide', icon: <ManualIcon />, onClick: () => requestTour() },
      { key: 'signout', label: 'Sign out', icon: <i className="ti ti-logout" aria-hidden="true" />, onClick: () => logout() },
    ],
  } : null;

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

      {/* Right — search, bell, then the ☰ */}
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
        {/* Holds the bell's place so the ☰ does not move. */}
        {!can('map:read') && <span className="mobile-header__icon-btn" aria-hidden="true" style={{ visibility: 'hidden', pointerEvents: 'none' }} />}
        {/* The ☰ closes the row (operator, 19 Nov 2026): the pages the five
            tabs have no room for, and the account the avatar used to open,
            in one menu (MapMoreMenu). */}
        <MapMoreMenu workPlans={workPlans} account={account} />
      </div>
    </header>
  );
}