// Mobile Search tab — the live fleet (fleet-server snapshot + SSE via
// FleetLiveProvider), NOT the old vehicleData mock.
//
// It searched `api/vehicles.searchVehicles`, which filters a checked-in
// fixture of invented plates and driver names. So this tab answered every
// query on every tenant with fiction: units that do not exist, drivers nobody
// employs, and a status that had not changed since the file was written —
// while a real plate typed in full returned "No vehicle or driver found".
//
// Same source as the map, the drivers tab and the units list, so a row here
// cannot disagree with the marker it opens.
//
// ## And the unit in another organisation
//
// An account with several tenants searches from whichever one is open. When
// this fleet has nothing, the server is asked across the account's
// memberships: one answer moves the dashboard there, several are offered.
// Same rule and same hook as the units list — see hooks/useCrossOrgUnits.

import { useMemo, useState } from "react";
import "./MobileSearchScreen.css";
import { useAppSelector, useAppActions, useCompanies } from "../../context/AppContext";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useCrossOrgUnitHandoff } from "../../hooks/useCrossOrgUnits";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import { ONLINE_COLORS } from "../../lib/vehicleMap";
import { displayPlate } from "../../lib/plate";
import UnitTypeIcon from "../shared/UnitTypeIcon";

/* The five states deriveStatus produces, not the four the mock had: 'idling'
   was missing, so every unit burning fuel at a standstill rendered green and
   read "Online". Colours match the map's markers and the drivers tab. */
// Idling was #eab308 here, a yellow belonging to no state this app has: it
// read as a milder SPEEDING on a vehicle standing still with its engine on.
// It takes the app's own sky blue instead. `stationary` was missing outright,
// so an online-but-stopped unit arrived as undefined — see ONLINE_COLORS.
const STATUS_COLORS = {
  ok: ONLINE_COLORS.transit, idling: ONLINE_COLORS.idling, stationary: ONLINE_COLORS.stationary,
  speeding: "#f59e0b", theft: "#ef4444", parked: "#94a3b8",
};
const STATUS_LABELS = {
  ok: "Online", idling: "Idling", stationary: "Online · stopped",
  speeding: "Speeding", theft: "Fuel theft alert", parked: "Offline",
};

/* A phone list nobody scrolls to the end of. A plate narrows to a handful;
   a two-letter prefix should not paint 597 rows to say so. */
const MAX_ROWS = 40;

const norm = (s) => String(s ?? "").toLowerCase();

function SearchContent() {
  const [query, setQuery] = useState("");
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { setSelectedVehicleId, setPendingFocusId, setMobileActiveTab, setActiveCompanyId } = useAppActions();
  const { activeCompany, companies } = useCompanies();
  const { vehicles, loading, error, retry } = useFleetLiveShared();

  const q = norm(query).trim();

  // Plate, machine name and driver — the three things printed on the row, so
  // anything a reader can see here is something they can search by.
  const results = useMemo(() => {
    if (!q) return [];
    return (vehicles ?? [])
      .filter((v) => norm(v.id).includes(q) || norm(v.name).includes(q) || norm(v.driver).includes(q))
      .slice(0, MAX_ROWS);
  }, [vehicles, q]);

  const { companies: elsewhere, loading: lookingElsewhere, move } = useCrossOrgUnitHandoff({
    query,
    enabled: q.length > 0 && results.length === 0 && !loading,
    activeCompanyId,
    visibleCompanies: companies,
    setActiveCompanyId,
    setPendingFocusId,
  });

  const handleSelect = (vehicle) => {
    setSelectedVehicleId(vehicle.id);
    // Frame it on the map as well as open its sheet. Selecting alone left the
    // map wherever it happened to be, which on a 486-unit fleet is nowhere
    // near the unit just searched for.
    setPendingFocusId(vehicle.id);
    setMobileActiveTab("map");
  };

  return (
    <>
      <div className="mobile-search__input-wrap">
        <span className="mobile-search__icon">⌕</span>
        <input
          className="mobile-search__input"
          placeholder="Search plate, machine or driver…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {query && (
          <button
            className="mobile-search__clear"
            onClick={() => setQuery("")}
            aria-label="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* The fleet itself failing is worth saying plainly: an empty result
          list would otherwise read as "no such unit". */}
      {error && <LoadError label="Fleet" onRetry={retry} />}

      {!error && !q && (
        <div className="mobile-search__hint">
          {loading
            ? "Loading the fleet…"
            : `Search ${vehicles.length} units by plate, machine or driver`}
        </div>
      )}

      {!error && q && results.length === 0 && (
        lookingElsewhere
          ? <div className="mobile-search__hint">Checking your other organisations…</div>
          : elsewhere.length === 0
            ? <div className="mobile-search__empty">No unit or driver matches that search</div>
            : (
              <>
                {/* More than one organisation holds a match, so the dashboard
                    does not guess — switching costs the fleet, the feed and
                    the map to undo. */}
                <div className="mobile-search__hint">
                  Not in {activeCompany?.short || "this organisation"}. Found in:
                </div>
                <div className="mobile-search__results">
                  {elsewhere.map(({ company, units }) => (
                    <button
                      key={company.id}
                      className="mobile-search__result"
                      onClick={() => move(company, units[0])}
                    >
                      <span className="mobile-search__result-info">
                        <span className="mobile-search__result-reg">{company.short || company.name}</span>
                        <span className="mobile-search__result-driver">
                          {units.slice(0, 3).map((u) => u.plate).join(", ")}
                          {units.length > 3 ? ` +${units.length - 3}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )
      )}

      <div className="mobile-search__results">
        {results.map((v) => {
          const color = STATUS_COLORS[v.status] || STATUS_COLORS.ok;
          // 'Unassigned' is the absence of a driver, and naming an absence on
          // every second row says nothing — the machine name, or where it is,
          // is the line worth having instead.
          const under = v.driver && v.driver !== "Unassigned"
            ? v.driver
            : (v.name && v.name !== v.id ? v.name : v.location || "No fix");
          return (
            <button
              key={v.id}
              className="mobile-search__result"
              onClick={() => handleSelect(v)}
            >
              <UnitTypeIcon vehicle={v} size={30} />
              <span className="mobile-search__result-info">
                <span className="mobile-search__result-reg">{displayPlate(v)}</span>
                <span className="mobile-search__result-driver">{under}</span>
              </span>
              <span
                className="mobile-search__result-badge"
                style={{ color, background: color + "1a" }}
              >
                {STATUS_LABELS[v.status] || STATUS_LABELS.ok}
              </span>
            </button>
          );
        })}
      </div>

      {results.length === MAX_ROWS && (
        <div className="mobile-search__hint">
          First {MAX_ROWS} matches. Type more of the plate to narrow it.
        </div>
      )}
    </>
  );
}

export default function MobileSearchScreen() {
  return (
    <div className="mobile-search">
      <ErrorBoundary label="Search">
        <SearchContent />
      </ErrorBoundary>
    </div>
  );
}
