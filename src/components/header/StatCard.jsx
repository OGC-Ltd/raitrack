// Header stat card — one per cargo group in transit.

import { TruckIcon } from "./Icons";
import "./StatCard.css";

export default function StatCard({
  label,
  value,
  unit,
  trucks,
  accentColor,
  iconBgColor,
  icon = null,           // cargo-specific icon (emoji or element); truck if absent
  active = false,
  onToggle,
}) {
  return (
    <div
      className={`stat-card${active ? " stat-card--active" : ""}`}
      style={{ "--stat-card-accent": accentColor }}
      onClick={onToggle}
    >
      <button
        className="stat-card__close"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label="Close"
      >
        ×
      </button>

      <div
        className="stat-card__icon"
        style={{ backgroundColor: iconBgColor, color: accentColor }}
      >
        {icon ?? <TruckIcon />}
      </div>

      <div className="stat-card__body">
        <span className="stat-card__label">{label}</span>
        <div className="stat-card__value-row">
          <span className="stat-card__value" style={{ color: accentColor }}>
            {value}
          </span>
          <span className="stat-card__unit">{unit}</span>
          <span className="stat-card__trucks">({trucks})</span>
        </div>
      </div>
    </div>
  );
}
