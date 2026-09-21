// Header dropdown for switching companies.

import { useState, useRef, useEffect } from "react";
import BrandLogo from "./BrandLogo";
import { useAppContext } from "../../context/AppContext";
import { useFleetCount } from "../../hooks/useFleetCount";
import "./CompanySwitcherDropdown.css";

export default function CompanySwitcherDropdown() {
  const { companies, activeCompany, activeCompanyId, setActiveCompanyId } = useAppContext();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Real fleet size from the backend for the active company; falls back to the
  // mock companyData count while loading or for companies with no backend org.
  const liveCount = useFleetCount(activeCompanyId);

  useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const handleSelect = (companyId) => {
    setActiveCompanyId(companyId);
    setOpen(false);
  };

  return (
    <div className="company-switcher" ref={wrapRef}>
      <button
        type="button"
        className="company-switcher__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch company"
      >
        <BrandLogo
          avatarLetter={activeCompany?.avatarLetter ?? "S"}
          avatarColor={activeCompany?.avatarColor}
          name={activeCompany?.name ?? "Sukari Industries"}
          suffix={activeCompany?.suffix ?? "Ltd · KE"}
          vehicleCount={liveCount ?? activeCompany?.vehicleCount ?? 0}
        />
        <span className={`company-switcher__chevron${open ? " company-switcher__chevron--open" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="company-switcher__menu" role="listbox">
          {companies.map((company) => {
            const isActive = company.id === activeCompanyId;
            return (
              <button
                key={company.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`company-switcher__item${isActive ? " company-switcher__item--active" : ""}`}
                onClick={() => handleSelect(company.id)}
              >
                <span
                  className="company-switcher__item-avatar"
                  style={{ background: company.avatarColor }}
                >
                  {company.avatarLetter}
                </span>
                <span className="company-switcher__item-info">
                  <span className="company-switcher__item-name">
                    {company.name} <span className="company-switcher__item-suffix">{company.suffix}</span>
                  </span>
                  <span className="company-switcher__item-tagline">{company.tagline}</span>
                </span>

                {isActive && <span className="company-switcher__item-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
