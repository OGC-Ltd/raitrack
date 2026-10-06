// Mobile top bar: company + fleet status counts.

import "./MobileTopBar.css";
import { useCompanies } from "../../context/AppContext";
import { useApiData } from "../../hooks/useApiData";
import { getFleetStatusCounts } from "../../api/vehicles";

export default function MobileTopBar({ onOpenSwitcher }) {
  const { activeCompany } = useCompanies();
  const { data, error, retry } = useApiData(
    () => getFleetStatusCounts({ companyId: activeCompany?.id }),
    [activeCompany?.id]
  );
  const counts = data || { ok: 0, warning: 0, critical: 0, offline: 0 };

  const online = counts.ok + counts.warning + counts.critical;
  const offline = counts.offline;
  const total = online + offline;

  return (
    <header className="mobile-topbar">
      <button
        className="mobile-topbar__company"
        onClick={onOpenSwitcher}
        aria-label="Switch company"
      >
        <span
          className="mobile-topbar__avatar"
          style={{ background: activeCompany?.avatarColor || "#3b82f6" }}
        >
          {activeCompany?.avatarLetter || "?"}
        </span>
        <span className="mobile-topbar__company-info">
          <span className="mobile-topbar__name">
            {activeCompany?.short || "Loading…"}
          </span>
          <span className="mobile-topbar__units">
            {total} unit{total === 1 ? "" : "s"}
          </span>
        </span>
        <span className="mobile-topbar__chevron">▾</span>
      </button>

      <div className="mobile-topbar__status">
        {error ? (
          <button
            type="button"
            className="mobile-topbar__status-pill mobile-topbar__status-pill--offline"
            onClick={retry}
            aria-label="Status failed to load — tap to retry"
            title="Status failed to load — tap to retry"
          >
            <span className="mobile-topbar__dot" />
            !
          </button>
        ) : (
          <>
            <span className="mobile-topbar__status-pill mobile-topbar__status-pill--online">
              <span className="mobile-topbar__dot" />
              {online}
            </span>
            <span className="mobile-topbar__status-pill mobile-topbar__status-pill--offline">
              <span className="mobile-topbar__dot" />
              {offline}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
