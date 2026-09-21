// KPI alert card primitive (legacy, unused).

import "./KpiAlertCard.css";

const SEVERITY_STYLES = {
  critical: { border: "#ef4444", badgeBg: "#ef4444", badgeText: "#fff" },
  high:     { border: "#ef4444", badgeBg: "#ef4444", badgeText: "#fff" },
  warning:  { border: "#f59e0b", badgeBg: "#f59e0b", badgeText: "#1a1206" },
  down:     { border: "#4b5563", badgeBg: "#374151", badgeText: "#cbd5e1" },
};

export default function KpiAlertCard({ severity, badgeLabel, icon, value, unit, title, subLines = [] }) {
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.down;

  return (
    <div className="kpi-alert-card" style={{ borderColor: style.border }}>
      <div className="kpi-alert-card__top">
        <span
          className="kpi-alert-card__badge"
          style={{ background: style.badgeBg, color: style.badgeText }}
        >
          {badgeLabel}
        </span>
        <span className="kpi-alert-card__icon" style={{ color: style.border }}>{icon}</span>
      </div>

      <div className="kpi-alert-card__title">{title}</div>

      <div className="kpi-alert-card__value-row">
        <span className="kpi-alert-card__value">{value}</span>
        {unit && <span className="kpi-alert-card__unit">{unit}</span>}
      </div>

      {subLines.map((line, i) => (
        <div key={i} className="kpi-alert-card__subline">{line}</div>
      ))}
    </div>
  );
}
