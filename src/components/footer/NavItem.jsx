// Standard footer nav button. `badge` (a count) renders a red pill on the
// icon's corner when > 0 — used by Maint for vehicles needing attention.

import "./NavItem.css";

export default function NavItem({ icon, label, active, onClick, badge = 0, disabled = false, title }) {
  return (
    <button
      className={`nav-item${active ? " nav-item--active" : ""}${disabled ? " nav-item--disabled" : ""}`}
      onClick={onClick}
      disabled={disabled}
      // `title` carries the reason. A disabled control with no explanation is
      // the thing people file bugs about, and the alternative — hiding it —
      // is what this app used to do and what the operator asked to change.
      title={title}
      aria-label={badge > 0 ? `${label} (${badge})` : label}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-item__icon">
        {icon}
        {badge > 0 && <span className="nav-item__badge">{badge}</span>}
      </span>
      <span className="nav-item__label">{label}</span>
      {active && <span className="nav-item__bar" />}
    </button>
  );
}
