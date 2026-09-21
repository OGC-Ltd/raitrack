// Mobile vehicle detail bottom sheet.

import "./MobileVehicleSheet.css";
import { getVehicleById } from "../../api/vehicles";
import { getAssetDetail } from "../../api/assetDetail";
import { useApiData } from "../../hooks/useApiData";
import ErrorBoundary from "../shared/ErrorBoundary";
import { ONLINE_COLORS } from "../../lib/vehicleMap";
import LoadError from "../shared/LoadError";

// `idling` and `stationary` were absent, so the two commonest ONLINE states on
// this fleet arrived here as undefined — no dot colour, no label. Stationary
// is the pale green, idling the sky blue; `parked` means OFFLINE and is slate.
const STATUS_COLORS = {
  ok: ONLINE_COLORS.transit, idling: ONLINE_COLORS.idling, stationary: ONLINE_COLORS.stationary,
  speeding: "#f59e0b", theft: "#ef4444", parked: "#94a3b8",
};
const STATUS_LABELS = {
  ok: "Online", idling: "Idling", stationary: "Online · stopped",
  speeding: "Speeding", theft: "Fuel Theft Alert", parked: "Parked",
};

function SheetContent({ vehicleId, onClose }) {
  const { data, error, retry } = useApiData(
    () => Promise.all([getVehicleById(vehicleId), getAssetDetail(vehicleId)]),
    [vehicleId]
  );
  const [vehicle, detail] = data || [null, null];

  if (error) {
    return <LoadError label="Vehicle details" onRetry={retry} fullSection />;
  }

  if (!vehicle) {
    return <div className="mvs__loading">Loading…</div>;
  }

  const color = STATUS_COLORS[vehicle.status] || "#22c55e";
  const speedOk = vehicle.speed <= vehicle.speedLimit;

  return (
    <>
      <div className="mvs__header">
        <div className="mvs__title-row">
          <span className="mvs__reg">{vehicle.id}</span>
          <span
            className="mvs__badge"
            style={{ color, background: color + "1a", borderColor: color + "44" }}
          >
            {STATUS_LABELS[vehicle.status]}
          </span>
        </div>
        <div className="mvs__driver">{vehicle.driver}</div>
        {vehicle.location && <div className="mvs__location">📍 {vehicle.location}</div>}
        <button className="mvs__close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="mvs__stats">
        <div className="mvs__stat">
          <span className="mvs__stat-label">Speed</span>
          <span className="mvs__stat-value" style={{ color: speedOk ? "#22c55e" : "#f59e0b" }}>
            {vehicle.speed} km/h
          </span>
        </div>
        <div className="mvs__stat">
          <span className="mvs__stat-label">Engine</span>
          <span className="mvs__stat-value">{vehicle.engine === "on" ? "ON" : "OFF"}</span>
        </div>
        <div className="mvs__stat">
          <span className="mvs__stat-label">Fuel</span>
          <span className="mvs__stat-value">
            {detail ? `${detail.telemetry?.siloLevel ?? "—"}%` : "—"}
          </span>
        </div>
        <div className="mvs__stat">
          <span className="mvs__stat-label">Cargo</span>
          <span className="mvs__stat-value">{vehicle.weight}t</span>
        </div>
      </div>

      {vehicle.departure && (
        <div className="mvs__route">
          <span className="mvs__route-row"><span className="mvs__dot mvs__dot--dep" /> {vehicle.departure}</span>
          <span className="mvs__route-line" />
          <span className="mvs__route-row"><span className="mvs__dot mvs__dot--dest" /> {vehicle.destination}</span>
        </div>
      )}
    </>
  );
}

export default function MobileVehicleSheet({ vehicleId, onClose }) {
  if (!vehicleId) return null;

  return (
    <div className="mvs-overlay" onClick={onClose}>
      <div className="mvs" onClick={(e) => e.stopPropagation()}>
        <div className="mvs__handle" />
        <ErrorBoundary label="Vehicle details">
          <SheetContent vehicleId={vehicleId} onClose={onClose} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
