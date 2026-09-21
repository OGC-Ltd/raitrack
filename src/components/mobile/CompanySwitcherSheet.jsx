// Mobile bottom sheet for switching companies.

import "./CompanySwitcherSheet.css";
import { useAppContext } from "../../context/AppContext";

export default function CompanySwitcherSheet({ open, onClose }) {
  const { companies, activeCompanyId, setActiveCompanyId } = useAppContext();

  if (!open) return null;

  const handleSelect = (companyId) => {
    setActiveCompanyId(companyId);
    onClose();
  };

  return (
    <div className="company-sheet-overlay" onClick={onClose}>
      <div
        className="company-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="company-sheet__handle" />
        <div className="company-sheet__title">Switch Company</div>

        <div className="company-sheet__list">
          {companies.map((company) => {
            const isActive = company.id === activeCompanyId;
            return (
              <button
                key={company.id}
                className={`company-sheet__row${isActive ? " company-sheet__row--active" : ""}`}
                onClick={() => handleSelect(company.id)}
              >
                <span
                  className="company-sheet__avatar"
                  style={{ background: company.avatarColor }}
                >
                  {company.avatarLetter}
                </span>
                <span className="company-sheet__info">
                  <span className="company-sheet__name">
                    {company.name} <span className="company-sheet__suffix">{company.suffix}</span>
                  </span>
                  <span className="company-sheet__tagline">{company.tagline}</span>
                </span>
                <span className="company-sheet__count">{company.vehicleCount}</span>
                {isActive && <span className="company-sheet__check">✓</span>}
              </button>
            );
          })}
        </div>

        <button className="company-sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
