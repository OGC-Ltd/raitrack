// Company switcher tab (legacy, unused).

import "./CompanyTab.css";

export default function CompanyTab({ company, active, onClick }) {
  return (
    <button
      className={`company-tab${active ? " company-tab--active" : ""}`}
      onClick={onClick}
      aria-label={company.name}
      style={{ "--tab-color": company.accentColor }}
    >
      <span
        className="company-tab__avatar"
        style={{ background: company.avatarColor }}
      >
        {company.avatarLetter}
      </span>
      <span className="company-tab__name">{company.short}</span>
      {active && <span className="company-tab__bar" />}
    </button>
  );
}
