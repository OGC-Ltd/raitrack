// Small vehicle summary chip.

import "./VehicleChip.css";

export default function VehicleChip({
  plate,
  driver,
  tonnage,
  dotColor = "#22c55e",
  tonnageColor = "#22c55e",
}) {
  return (
    <div className="vehicle-chip">
      <span
        className="vehicle-chip__dot"
        style={{ backgroundColor: dotColor }}
      />
      <span className="vehicle-chip__plate">{plate}</span>
      <span className="vehicle-chip__driver">{driver}</span>
      <span className="vehicle-chip__tonnage" style={{ color: tonnageColor }}>
        {tonnage}t
      </span>
      <span className="vehicle-chip__arrow">›</span>
    </div>
  );
}
