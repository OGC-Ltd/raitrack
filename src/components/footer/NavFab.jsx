// Raised centre nav button.
//
// Fleet's, usually — but not always its own: when an account can open only one
// screen, that screen's tab takes this position and Fleet takes the ordinary
// one it vacated. See the swap in FooterNav. Nothing here assumes which tab it
// is drawing.

import "./NavFab.css";

export default function NavFab({ icon, label, active, onClick, disabled = false, title }) {
  return (
    <button
      className={`nav-fab${active ? " nav-fab--active" : ""}${disabled ? " nav-fab--disabled" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
    >
      <span className="nav-fab__circle">{icon}</span>
      <span className="nav-fab__label">{label}</span>
    </button>
  );
}
