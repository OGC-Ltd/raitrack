// Small pill button (legacy, unused).

import "./NavAgentPill.css";

export default function NavAgentPill({ label = "Kimi Agent", onClick }) {
  return (
    <button className="nav-agent-pill" onClick={onClick} aria-label={label}>
      <span className="nav-agent-pill__icon">✦</span>
      <span className="nav-agent-pill__label">{label}</span>
    </button>
  );
}
