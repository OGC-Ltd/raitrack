// Vehicle list flyout panel (legacy, unused).

import VehicleChip from "./VehicleChip";
import "./VehiclePanel.css";

export default function VehiclePanel({
  open = false,
  title,
  vehicles = [],
  onClose,
  dotColor,
  tonnageColor,
}) {
  return (
    <div className={`vehicle-panel${open ? " vehicle-panel--open" : ""}`}>
      <div className="vehicle-panel__inner">
        <div className="vehicle-panel__header">
          <span className="vehicle-panel__title">{title}</span>
          <button
            className="vehicle-panel__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ×
          </button>
        </div>

        <div className="vehicle-panel__chips">
          {vehicles.map((v) => (
            <VehicleChip
              key={v.plate}
              plate={v.plate}
              driver={v.driver}
              tonnage={v.tonnage}
              dotColor={v.dotColor ?? dotColor}
              tonnageColor={v.tonnageColor ?? tonnageColor}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
