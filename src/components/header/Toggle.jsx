// Simple labeled on/off switch.

import "../../index.css";

export default function Toggle({ label, checked = false, onChange }) {
  return (
    <div className="toggle">
      {label && <span className="toggle__label">{label}</span>}
      <div
        className={`toggle__track${checked ? " toggle__track--on" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" || e.key === " " ? onChange(!checked) : null}
      >
        <div className={`toggle__thumb${checked ? " toggle__thumb--on" : ""}`} />
      </div>
    </div>
  );
}
