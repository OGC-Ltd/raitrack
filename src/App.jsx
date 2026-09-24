// Root layout — new sidebar shell.
// All tab routing, screen rendering, auth and server wiring unchanged.
// Real authentication: login, set-password links, account and user admin.

import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import { AppProvider, useAppContext } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FleetLiveProvider, useFleetLiveShared } from './context/FleetLiveContext';
import { usePermissions, accessIn } from './hooks/usePermissions';
import { NAV_ITEMS } from './components/layout/SidePanel';
import ErrorBoundary from './components/shared/ErrorBoundary';
import TabEmptyState from './components/shared/TabEmptyState';

import { MapLayersProvider } from './context/MapLayersContext';
// New layout components
import AppHeader          from './components/layout/AppHeader';
import SidePanel          from './components/layout/SidePanel';
import MobileTabBar       from './components/layout/MobileTabBar';
import MobileHeader       from './components/layout/MobileHeader';
import MobileLiveFeedSheet   from './components/layout/MobileLiveFeedSheet';
import MobileCompanyProfile  from './components/layout/MobileCompanyProfile';
import VehicleDetailPanel    from './components/layout/VehicleDetailPanel';
import MobileSearchTray   from './components/layout/MobileSearchTray';

// Screens — unchanged from original
import FleetMap          from './components/body/FleetMap';
import DriversScreen     from './components/screens/DriversScreen';
import MaintenanceScreen from './components/screens/MaintenanceScreen';
import AnalyticsScreen   from './components/screens/AnalyticsScreen';
import WeighbridgesScreen from './components/screens/WeighbridgesScreen';
import SystemScreen      from './components/screens/SystemScreen';

// Auth + account screens
import LoginScreen       from './components/screens/LoginScreen';
import SetPasswordScreen from './components/screens/SetPasswordScreen';
import AccountScreen     from './components/screens/AccountScreen';
import UserAdminScreen   from './components/screens/UserAdminScreen';
import { readSetupToken } from './lib/setupLink';

function AppShell() {
  const {
    activeCompany,
    activeCompanyId,
    previousCompanyId,
    setActiveCompanyId,
    companies,
    desktopActiveTab,
    setDesktopActiveTab,
    selectedVehicleId,
    setSelectedVehicleId,
  } = useAppContext();

  const { can } = usePermissions();
  const { vehicles: _liveVehicles = [] } = useFleetLiveShared();
  const [mobileFeedOpen,    setMobileFeedOpen]    = useState(false);
  const [mobileSearchOpen,  setMobileSearchOpen]  = useState(false);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const { orgs } = useAuth();

  // Keep allowed-tab guard identical to original
  const allowedTabs = NAV_ITEMS.filter(t => can(t.permission));
  const tabAllowed  = allowedTabs.some(t => t.key === desktopActiveTab);

  useEffect(() => {
    if (!tabAllowed && allowedTabs.length > 0) {
      setDesktopActiveTab(allowedTabs[0].key);
    }
  }, [tabAllowed, allowedTabs, setDesktopActiveTab]);

  // Way-out logic for empty-permission orgs — identical to original
  const wayOut = useMemo(() => {
    const opensSomething = (companyId) => {
      const { can: canThere } = accessIn(orgs, companyId);
      return NAV_ITEMS.some(t => canThere(t.permission));
    };
    const back = companies.find(
      c => c.id === previousCompanyId && c.id !== activeCompanyId && opensSomething(c.id)
    );
    return back
      ?? companies.find(c => c.id !== activeCompanyId && opensSomething(c.id))
      ?? null;
  }, [orgs, companies, previousCompanyId, activeCompanyId]);

  const show = (key) => {
    const tab = NAV_ITEMS.find(t => t.key === key);
    return Boolean(tab) && desktopActiveTab === key && can(tab.permission);
  };

  return (
    <MapLayersProvider>
    <div className="app-container app--light">
      {/* Top bar */}
      <ErrorBoundary label="Header" fullSection>
        <AppHeader />
      </ErrorBoundary>

      {/* Mobile header — shown only on mobile (< 768px) */}
      <MobileHeader
        onSearchOpen={() => setMobileSearchOpen(o => !o)}
        onFeedOpen={() => setMobileFeedOpen(true)}
        onProfileOpen={() => setMobileProfileOpen(true)}
      />
      {/* Mobile search tray */}
      <MobileSearchTray open={mobileSearchOpen} onClose={() => setMobileSearchOpen(false)} />

      {/* Body: sidebar + content */}
      <div className="app-body">

        {/* Left sidebar */}
        <ErrorBoundary label="SidePanel" fullSection>
          <SidePanel onLayersClick={() => {/* wire to MapLayersMenu */}} />
        </ErrorBoundary>

        {/* Content area */}
        <div className="app-content">

          {/* Fleet map — always mounted, hidden when not active */}
          {/* `app-map-panel`, NOT `fleet-map-body`. FleetMap's own root element
              already carries that class, and reusing it here put two nested
              elements under every `.fleet-map-body` rule at once — including
              the mobile `overflow: visible`, which stopped this wrapper
              clipping the map, and the margin that holds the map clear of the
              bottom tab bar, which was applied twice. */}
          <div className={`app-map-panel${!show('fleet') ? ' app-tab-panel--hidden' : ''}`}>
            <ErrorBoundary label="Map" fullSection>
              <FleetMap />
            </ErrorBoundary>
          </div>

          {show('drivers') && (
            <div className="app-tab-panel app-tab-panel--screen">
              <ErrorBoundary label="Drivers" fullSection>
                <DriversScreen />
              </ErrorBoundary>
            </div>
          )}

          {show('maintenance') && (
            <div className="app-tab-panel app-tab-panel--screen">
              <ErrorBoundary label="Maintenance" fullSection>
                <MaintenanceScreen />
              </ErrorBoundary>
            </div>
          )}

          {show('analytics') && (
            <div className="app-tab-panel app-tab-panel--screen">
              <ErrorBoundary label="Analytics" fullSection>
                <AnalyticsScreen />
              </ErrorBoundary>
            </div>
          )}

          {show('weighbridges') && (
            <div className="app-tab-panel app-tab-panel--screen">
              <ErrorBoundary label="Weighbridges" fullSection>
                <WeighbridgesScreen />
              </ErrorBoundary>
            </div>
          )}

          {show('system') && (
            <div className="app-tab-panel app-tab-panel--screen">
              <ErrorBoundary label="Follow-ups" fullSection>
                <SystemScreen />
              </ErrorBoundary>
            </div>
          )}

          {allowedTabs.length === 0 && (
            <div className="app-tab-panel app-tab-panel--screen">
              <TabEmptyState
                icon={<span aria-hidden="true" style={{ fontSize: 28 }}>🔒</span>}
                title={`Nothing to open in ${activeCompany?.name ?? 'this organisation'}`}
                hint="This account holds no screen permission here. An administrator can grant access."
                action={wayOut && (
                  <button type="button" onClick={() => setActiveCompanyId(wayOut.id)}>
                    {wayOut.id === previousCompanyId ? 'Back to ' : 'Go to '}
                    {wayOut.short || wayOut.name}
                  </button>
                )}
              />
            </div>
          )}

        </div>

        {/* Vehicle detail — a column beside the map on a desktop, an overlay
            over it on a laptop, a bottom sheet on a phone. One component: the
            shape is a CSS decision, and rendering it here rather than per
            breakpoint is what keeps a tap on a pin from losing its panel on
            the way down to mobile, which it used to (`display: none`). */}
        {(() => {
          const selectedVehicle = selectedVehicleId
            ? _liveVehicles.find(v => v.id === selectedVehicleId) ?? { id: selectedVehicleId }
            : null;
          return (
            <VehicleDetailPanel
              vehicle={selectedVehicle}
              onClose={() => setSelectedVehicleId(null)}
            />
          );
        })()}
      </div>
      {/* Mobile bottom tab bar */}
      <MobileTabBar />
      {/* Mobile live feed sheet */}
      <MobileLiveFeedSheet open={mobileFeedOpen} onClose={() => setMobileFeedOpen(false)} />
      {/* Mobile company profile sheet */}
      <MobileCompanyProfile open={mobileProfileOpen} onClose={() => setMobileProfileOpen(false)} />
    </div>
    </MapLayersProvider>
  );
}

// ── Overlay pages (render beside the app so the map + live stream survive) ──

function AccountGate() {
  const { accountOpen } = useAppContext();
  if (!accountOpen) return null;
  /* Light, whatever the theme preference says.
     This page is where the theme is CHOSEN, and the two dark options in it are
     disabled — so a stored `dark` from before that change would otherwise paint
     the one screen that explains why dark is unavailable in dark. */
  return (
    <div className="app-root app--light">
      <AccountScreen />
    </div>
  );
}

function UserAdminGate() {
  const { userAdminOpen, setUserAdminOpen } = useAppContext();
  const { can } = usePermissions();
  const allowed = can('user:create');

  // Roles are per-organisation: switching company can remove the grant.
  useEffect(() => {
    if (userAdminOpen && !allowed) setUserAdminOpen(false);
  }, [userAdminOpen, allowed, setUserAdminOpen]);

  if (!userAdminOpen || !allowed) return null;
  return (
    <div className="app-root app--light">
      <UserAdminScreen />
    </div>
  );
}

// ── Auth gate ───────────────────────────────────────────────────────────────

function AuthGate() {
  const { booting, isAuthenticated } = useAuth();
  /* One theme. `.app--dark` still exists in the stylesheets and is simply
     never applied — left there rather than stripped out of a dozen CSS files,
     which would be a far larger edit than the decision warrants. */
  const themed = 'app-root app--light';

  // Emailed set-password link (URL fragment). Checked before `booting` so an
  // invite for a different account is never swallowed by an existing session.
  const [setupToken, setSetupToken] = useState(readSetupToken);

  if (setupToken) {
    return (
      <div className={themed}>
        <SetPasswordScreen token={setupToken} onDone={() => setSetupToken(null)} />
      </div>
    );
  }

  // Silent refresh on mount — render nothing rather than flash the login form.
  if (booting) return <div className={themed} />;

  if (!isAuthenticated) {
    return <div className={themed}><LoginScreen /></div>;
  }

  return (
    <FleetLiveProvider>
      <AppShell />
      <AccountGate />
      <UserAdminGate />
    </FleetLiveProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AuthGate />
      </AppProvider>
    </AuthProvider>
  );
}
