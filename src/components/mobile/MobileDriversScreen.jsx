// Mobile Drivers tab — real drivers from the live fleet stream (fleet-server
// snapshot + SSE via FleetLiveProvider), NOT the old vehicleData mock. Each row
// is the driver currently assigned to a vehicle, so status/cargo/location stay
// in sync with the map in real time.

import "./MobileDriversScreen.css";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useAppContext } from "../../context/AppContext";
import ErrorBoundary from "../shared/ErrorBoundary";
import { ONLINE_COLORS } from "../../lib/vehicleMap";
import LoadError from "../shared/LoadError";

// A driver is ON DUTY whenever their unit is online, whatever it is doing, so
// the three online states share the duty word and differ by colour. They were
// missing entirely, which left a driver whose truck was idling — the state
// this fleet's operators care most about — with no colour and no words.
const STATUS_COLORS = {
  ok: ONLINE_COLORS.transit, idling: ONLINE_COLORS.idling, stationary: ONLINE_COLORS.stationary,
  speeding: "#f59e0b", theft: "#ef4444", parked: "#94a3b8",
};
const STATUS_LABELS = {
  ok: "On duty", idling: "On duty · idling", stationary: "On duty · stopped",
  speeding: "On duty · speeding", theft: "Alert", parked: "Off duty",
};

function DriversContent() {
  const { setSelectedVehicleId, setMobileActiveTab, setPendingFocusId } = useAppContext();
  const { vehicles, loading, error, retry } = useFleetLiveShared();

  // One row per vehicle with an assigned driver, alphabetical for a stable
  // order across SSE re-renders.
  const drivers = vehicles
    .map((v) => ({
      id: v.vehicleId ?? v.id,
      name: v.driver ?? "Unassigned",
      vehicleId: v.id,          // plate — the map/marker + selection key
      status: v.status,
      cargo: v.cargo,
      location: v.location,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleSelect = (driver) => {
    setSelectedVehicleId(driver.vehicleId);
    // Frame the driver's unit, do not just open its sheet over whatever the
    // map happened to be showing. `vehicleId` is the CUID here; FleetMap's
    // focus matches on that before falling back to the plate.
    setPendingFocusId(driver.vehicleId);
    setMobileActiveTab("map");
  };

  if (error) {
    return <LoadError label="Drivers" onRetry={retry} fullSection />;
  }

  if (loading && drivers.length === 0) {
    return <div className="mobile-drivers__loading">Loading drivers…</div>;
  }

  if (drivers.length === 0) {
    return <div className="mobile-drivers__loading">No drivers found for this company yet.</div>;
  }

  return (
    <div className="mobile-drivers__list">
      {drivers.map((d) => {
        const color = STATUS_COLORS[d.status] || "#22c55e";
        const initials = d.name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        return (
          <button
            key={d.id}
            className="mobile-drivers__row"
            onClick={() => handleSelect(d)}
          >
            <span className="mobile-drivers__avatar">{initials}</span>
            <span className="mobile-drivers__info">
              <span className="mobile-drivers__name">{d.name}</span>
              <span className="mobile-drivers__vehicle">
                {d.vehicleId} · {d.cargo}
              </span>
            </span>
            <span
              className="mobile-drivers__status"
              style={{ color, background: color + "1a" }}
            >
              {STATUS_LABELS[d.status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function MobileDriversScreen() {
  return (
    <div className="mobile-drivers">
      <div className="mobile-drivers__heading">Drivers</div>
      <ErrorBoundary label="Drivers">
        <DriversContent />
      </ErrorBoundary>
    </div>
  );
}
