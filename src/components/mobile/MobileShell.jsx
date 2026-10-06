// Mobile app shell: top bar, tabs, screens.

import { useState } from "react";
import "./MobileShell.css";

import { useAppFields } from "../../context/AppContext";
import ErrorBoundary from "../shared/ErrorBoundary";

import MobileTopBar from "./MobileTopBar";
import MobileBottomNav from "./MobileBottomNav";
import CompanySwitcherSheet from "./CompanySwitcherSheet";
import MobileVehicleSheet from "./MobileVehicleSheet";
import MobileHomeScreen from "./MobileHomeScreen";
import MobileSearchScreen from "./MobileSearchScreen";
import MobileDriversScreen from "./MobileDriversScreen";

import FleetMap from "../body/FleetMap";

export default function MobileShell() {
  const { mobileActiveTab, mapEverMounted, selectedVehicleId } = useAppFields("mobileActiveTab", "mapEverMounted", "selectedVehicleId");
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const [dismissedVehicleId, setDismissedVehicleId] = useState(null);

  const showVehicleSheet =
    mobileActiveTab === "map" &&
    selectedVehicleId &&
    selectedVehicleId !== dismissedVehicleId;

  return (
    <div className="mobile-shell">
      <MobileTopBar onOpenSwitcher={() => setSwitcherOpen(true)} />

      <main className="mobile-shell__content">
        {mobileActiveTab === "home" && (
          <ErrorBoundary label="Home" fullSection>
            <MobileHomeScreen />
          </ErrorBoundary>
        )}

        {mobileActiveTab === "search" && (
          <ErrorBoundary label="Search" fullSection>
            <MobileSearchScreen />
          </ErrorBoundary>
        )}

        {mobileActiveTab === "drivers" && (
          <ErrorBoundary label="Drivers" fullSection>
            <MobileDriversScreen />
          </ErrorBoundary>
        )}

        {mapEverMounted && (
          <div
            className="mobile-shell__map-wrap"
            style={{ display: mobileActiveTab === "map" ? "block" : "none" }}
          >
            <ErrorBoundary label="Map" fullSection>
              <FleetMap />
            </ErrorBoundary>

            {showVehicleSheet && (
              <MobileVehicleSheet
                vehicleId={selectedVehicleId}
                onClose={() => setDismissedVehicleId(selectedVehicleId)}
              />
            )}
          </div>
        )}
      </main>

      <MobileBottomNav />

      <CompanySwitcherSheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </div>
  );
}
