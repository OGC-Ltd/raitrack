/**
 * The map's left tool rail, beside the sidebar.
 *
 * Tools in three groups — finding (search, names, layers, fit), the map's
 * tools (Tools, geofences, alerts, arrivals) and the rail's own
 * expander. Since 2026-11-21 (operator) two buttons open menus like the
 * Geofences one: Tools (a toolbox: Measure, Live traffic, Weather, Work plans)
 * and Alerts
 * (Halted, Fuel alerts, Dashcam alarms).
 * Route covered left the rail on 2026-10-28 (operator): the route opens from
 * the unit itself. Geofences came back on 2026-11-04 (operator); their row in
 * the Maps panel stays, since it carries the colour key. Desktop only:
 * FleetMap renders it where the sidebar exists (not `isCompact`), because a
 * phone already has its own controls and no room for a second column of them.
 *
 * Presentational apart from the search box, which owns its query and its
 * results; everything that touches the map is a callback from FleetMap.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import MapLayersMenu from "./MapLayersMenu";
import { findVehicleByQuery } from "../../lib/vehicleMap";
import { matchFences, fenceDetail } from "../../lib/fenceSearch";
import { useAppSelector, useAppActions, useCompanies } from "../../context/AppContext";
import { useCrossOrgUnitHandoff } from "../../hooks/useCrossOrgUnits";
import UnitTypeIcon from "../shared/UnitTypeIcon";
import { usePermissions } from "../../hooks/usePermissions";
import { claimMapWindow, onMapWindowClaim } from "../../lib/sidePanels";
import "./MapToolRail.css";
import "./MapToolFences.css";

/* OpenStreetMap's geocoder: free, keyless, and limited to one request a second
   per client, which the 600 ms debounce on typing respects. */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** From here a rail badge stops writing its count and becomes a dot that
 *  ripples (operator, 3 Nov 2026: "172" spilled off the camera's corner). */
const RIPPLE_FROM = 30;

// `tour`: the first-time tour's mark for this button (lib/productTour).
function RailButton({ icon, glyph = null, label, title, on = false, disabled = false, expanded, onClick, count = null, tone = "warn", tour, menuOpen, btnRef }) {
  // A button that opens a menu says so, and whether it is open, rather than
  // being pressed.
  const menu = menuOpen !== undefined;
  // `glyph` is a drawn icon, for one the icon font does not have.
  const mark = glyph ?? <i className={`ti ${icon}`} aria-hidden="true" />;
  return (
    <button
      ref={btnRef}
      type="button"
      className={`mtr-btn${on ? " mtr-btn--on" : ""}`}
      data-tour={tour}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={menu ? undefined : on}
      aria-haspopup={menu ? "menu" : undefined}
      aria-expanded={menu ? menuOpen : undefined}
      aria-label={count > 0 ? `${label}, ${count}` : label}
      title={count >= RIPPLE_FROM ?`${title ?? label} (${count})` : title ?? label}
    >
      {count > 0 ? (
        // The count rides the icon's corner, as on the Maps button.
        <span className="mtr-btn__icon">
          {mark}
          {count >= RIPPLE_FROM
            ? <span className={`mtr-btn__dot mtr-btn__dot--${tone}`} aria-hidden="true" />
            : <span className={`mtr-btn__count mtr-btn__count--${tone}`} data-digits={String(count).length}>{count}</span>}
        </span>
      ) : (
        mark
      )}
      {expanded && <span className="mtr-btn__label">{label}</span>}
    </button>
  );
}

/**
 * The Geofences menu, beside its button: whether the org's geofences are on
 * the map, whether only the ones drawn here are, and the way into drawing one
 * (where that is allowed). One menu, because all three are about the same
 * thing and the rail had them as buttons in a row.
 */
function FencesMenu({ top, zones, drawFence, onDone }) {
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  // Up and Down move between the two items, as in any menu.
  const onKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll("[role^=menuitem]:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div className="mtr-pop mtr-fences" role="menu" aria-label="Geofences" style={{ marginTop: top }} onKeyDown={onKey}>
      {/* Each switch is a right of its own (map:geofences, map:custom_geos):
          a switch this person does not hold is left out. */}
      {(!zones || zones.canAll !== false) && <button
        ref={first} type="button" role="menuitemcheckbox" className="mtr-fences__item"
        aria-checked={Boolean(zones?.on)} disabled={!zones}
        onClick={() => zones?.onToggle()}
      >
        <i className="ti ti-eye" aria-hidden="true" />
        <span className="mtr-fences__text">
          Show on the map
          {!zones && <span className="mtr-fences__sub">None are drawn for this company</span>}
        </span>
        <span className="mtr-fences__switch" aria-hidden="true" />
      </button>}
      {/* Custom geos: the fences drawn here, not the ones imported from
          Wialon (operator, 2026-11-12). Independent of Show on the map. */}
      {zones?.canOwn !== false && <button
        ref={zones?.canAll === false ? first : undefined}
        type="button" role="menuitemcheckbox" className="mtr-fences__item"
        aria-checked={Boolean(zones?.ownOnly)} disabled={!zones?.ownCount && !zones?.ownOnly}
        onClick={() => zones?.onOwnOnly()}
      >
        <i className="ti ti-pencil-pin" aria-hidden="true" />
        <span className="mtr-fences__text">
          Custom geos
          <span className="mtr-fences__sub">
            {zones?.ownCount
              ? `The ${zones.ownCount.toLocaleString()} drawn here, not Wialon's`
              : "None drawn here yet"}
          </span>
        </span>
        <span className="mtr-fences__switch" aria-hidden="true" />
      </button>}
      {drawFence && <button
        type="button" role="menuitem" className="mtr-fences__item"
        onClick={() => { drawFence.onToggle(); onDone(); }}
      >
        <i className={`ti ${drawFence.on ? "ti-x" : "ti-shape"}`} aria-hidden="true" />
        <span className="mtr-fences__text">
          {drawFence.on ? "Stop drawing" : "Draw a geofence"}
          <span className="mtr-fences__sub">{drawFence.on ? "Close the drawing panel" : "Polygon, rectangle, circle or road"}</span>
        </span>
      </button>}
    </div>
  );
}

/**
 * A toolbox (operator, 2026-11-21: "use a toolbox icon"). Drawn, because the
 * app's icon font (Tabler 3.19) has none; on its 24-unit grid at its 2px
 * stroke, so it sits among the font's icons as one of them.
 */
function ToolboxGlyph() {
  return (
    <svg className="mtr-btn__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M3 13h18" />
      <path d="M8 12v2M16 12v2" />
    </svg>
  );
}

/** Up and Down move between a menu's rows, as in any menu. */
function menuKeys(e) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll("[role^=menuitem]:not(:disabled)")];
  const i = items.indexOf(document.activeElement);
  items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
}

/**
 * The Tools menu, beside its toolbox button (operator, 2026-11-21: "group
 * together weather, traffic and measure"): Measure, Live traffic and Weather,
 * each a switch, in the Geofences menu's rows. The Planner sat here for a few
 * hours on 2026-11-21 and went back to the sidebar (operator). Measure closes
 * the menu, since the next thing happens elsewhere; the layers keep it open,
 * as the Geofences switches do. Work plans (operator,
 * 2026-11-21: "add the factorysuite plan on the rail into the toolbox") is
 * the FactorySuite plans layer, only where the organisation keeps work plans
 * (Kasulu), as its rail switch was. Traffic and Weather are rights of their
 * own (map:traffic, map:weather): a row this person does not hold is left out.
 */
function ToolsMenu({ top, measuring, onToggleMeasure, traffic, weather, showTraffic, showWeather, workPlans, onDone }) {
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div className="mtr-pop mtr-fences" role="menu" aria-label="Tools" style={{ marginTop: top }} onKeyDown={menuKeys}>
      <button
        ref={first} type="button" role="menuitemcheckbox" className="mtr-fences__item"
        aria-checked={Boolean(measuring)}
        onClick={() => { onToggleMeasure(); onDone(); }}
      >
        <i className="ti ti-ruler-measure" aria-hidden="true" />
        <span className="mtr-fences__text">
          Measure
          <span className="mtr-fences__sub">{measuring ? "Measuring now: Esc ends" : "Click points on the map"}</span>
        </span>
        <span className="mtr-fences__switch" aria-hidden="true" />
      </button>
      {showTraffic && (
        <button
          type="button" role="menuitemcheckbox" className="mtr-fences__item"
          aria-checked={Boolean(traffic?.on)} disabled={!traffic}
          onClick={() => traffic?.onToggle()}
        >
          <i className="ti ti-traffic-lights" aria-hidden="true" />
          <span className="mtr-fences__text">
            Live traffic
            <span className="mtr-fences__sub">{traffic ? "Congestion on the roads, live" : "Not available"}</span>
          </span>
          <span className="mtr-fences__switch" aria-hidden="true" />
        </button>
      )}
      {showWeather && (
        <button
          type="button" role="menuitemcheckbox" className="mtr-fences__item"
          aria-checked={Boolean(weather?.on)} disabled={!weather}
          onClick={() => weather?.onToggle()}
        >
          <i className="ti ti-cloud-rain" aria-hidden="true" />
          <span className="mtr-fences__text">
            Weather
            <span className="mtr-fences__sub">
              {!weather ? "Not available" : weather.on && weather.note ? weather.note : "Wind, rain and storms, live"}
            </span>
          </span>
          <span className="mtr-fences__switch" aria-hidden="true" />
        </button>
      )}
      {workPlans && (
        <button
          type="button" role="menuitemcheckbox" className="mtr-fences__item"
          aria-checked={Boolean(workPlans.on)}
          onClick={() => workPlans.onToggle()}
        >
          <i className="ti ti-clipboard-list" aria-hidden="true" />
          <span className="mtr-fences__text">
            Work plans
            <span className="mtr-fences__sub">Today&rsquo;s FactorySuite plans, each machine against its place</span>
          </span>
          <span className="mtr-fences__switch" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** "3 units" / "1 unit". */
const unitCount = (n) => `${n.toLocaleString()} ${n === 1 ? "unit" : "units"}`;

/**
 * The Alerts menu, beside its button (operator, 2026-11-21: "group alerts
 * together to one alert icon ... a modal like that for the geofence"): Halted,
 * Fuel alerts and Dashcam alarms, each with what is waiting in it. A row opens
 * its list or page, as its own rail button used to, and the menu closes. Each
 * row is a right of its own, so a row this person does not hold is left out.
 * Drawn in the Geofences menu's rows (MapToolFences.css).
 */
function AlertsMenu({ top, halted, fuelAlerts, dashcam, onDone }) {
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const rows = [
    halted && {
      key: "halted", icon: "ti-alert-triangle", label: "Halted", tone: "warn",
      count: halted.count, open: halted.open, onOpen: halted.onOpen,
      sub: halted.count ? `${unitCount(halted.count)} stopped mid-journey` : "No unit stopped mid-journey",
      title: "Units that stopped mid-journey, on the highway or outside their geofences",
    },
    fuelAlerts && {
      key: "fuel", icon: "ti-gas-station", label: "Fuel alerts", tone: "alert",
      count: fuelAlerts.count, open: fuelAlerts.open, onOpen: fuelAlerts.onOpen,
      sub: fuelAlerts.count ? `${unitCount(fuelAlerts.count)} with an open theft alert` : "No open fuel theft alert",
      title: "Units with an open fuel theft alert",
    },
    dashcam && {
      key: "dashcam", icon: "ti-video", label: "Dashcam alarms", tone: dashcam.critical ? "alert" : "warn",
      count: dashcam.count, open: false, onOpen: dashcam.onOpen,
      sub: dashcam.count
        ? `${dashcam.count.toLocaleString()} today not yet reviewed${dashcam.critical ? `, ${dashcam.critical.toLocaleString()} critical` : ""}`
        : "Nothing waiting today",
      title: "The Alarms page, each alarm with its clip",
    },
  ].filter(Boolean);
  return (
    <div className="mtr-pop mtr-fences mtr-alerts" role="menu" aria-label="Alerts" style={{ marginTop: top }} onKeyDown={menuKeys}>
      {rows.map((r, i) => (
        <button
          key={r.key} ref={i === 0 ? first : undefined}
          type="button" role="menuitem"
          className={`mtr-fences__item${r.open ? " mtr-alerts__item--open" : ""}`}
          title={r.open ? `${r.label}: close the list` : r.title}
          onClick={() => { r.onOpen(); onDone(); }}
        >
          <i className={`ti ${r.icon}`} aria-hidden="true" />
          <span className="mtr-fences__text">
            {r.label}
            <span className="mtr-fences__sub">{r.sub}</span>
          </span>
          {r.count > 0 && (
            <span className={`mtr-alerts__count mtr-alerts__count--${r.tone}`} aria-hidden="true">
              {r.count > 99 ? "99+" : r.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Every unit whose plate, name or DRIVER contains the term — the Units
 *  panel's search (from the first character, no cap), plus the driver, which
 *  the header's retired box (2026-10-07) also matched. An exact plate or name
 *  leads, then plates that start with the term, then the rest by plate. */
function matchUnits(vehicles, term) {
  const t = term.toLowerCase();
  const exact = findVehicleByQuery(vehicles, term);
  const rank = (v) => (v === exact ? 0 : String(v.id ?? "").toLowerCase().startsWith(t) ? 1 : 2);
  return (vehicles ?? [])
    .filter((v) => v === exact || [v.id, v.name, v.driver].some((f) => String(f ?? "").toLowerCase().includes(t)))
    .sort((a, b) => rank(a) - rank(b) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

/** "Online" for a live unit, otherwise when it was last heard from. */
function lastSeenLabel(v) {
  if (v.online) return "Online";
  const ms = v.capturedAtMs;
  if (!Number.isFinite(ms)) return "Never reported";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${new Date(ms).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Vehicles first (they are what this map is for), then geofences, then places. */
function SearchPanel({ vehicles, fences, getBias, onPickVehicle, onPickFence, onPickPlace, onClose }) {
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState([]);
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const term = q.trim();
  // Deferred like the Units panel: the match runs over the whole fleet.
  const unitTerm = useDeferredValue(term);
  const units = useMemo(() => (unitTerm ? matchUnits(vehicles, unitTerm) : []), [vehicles, unitTerm]);
  const fenceHits = useMemo(() => matchFences(fences, unitTerm), [fences, unitTerm]);

  /* A unit in another of the operator's organisations, as in the Units panel:
     asked only once this fleet has no unit or geofence match, since one answer
     switches there and focuses it by itself, which would carry off a fence search.
     Several are listed to pick from. */
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { setActiveCompanyId, setPendingFocusId } = useAppActions();
  const { activeCompany, companies } = useCompanies();
  const { companies: elsewhere, loading: lookingElsewhere, move } = useCrossOrgUnitHandoff({
    query: unitTerm,
    enabled: Boolean(unitTerm) && units.length === 0 && fenceHits.total === 0,
    activeCompanyId,
    visibleCompanies: companies,
    setActiveCompanyId,
    setPendingFocusId,
  });

  useEffect(() => {
    if (term.length < 3) { setPlaces([]); setState("idle"); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setState("loading");
      try {
        const params = new URLSearchParams({ format: "jsonv2", limit: "6", q: term, "accept-language": "en" });
        // Biased to what is on screen, not bounded by it: a yard name finds the
        // nearby yard first, and a town two countries away still works.
        const b = getBias?.();
        if (b) params.set("viewbox", `${b.west},${b.north},${b.east},${b.south}`);
        const r = await fetch(`${NOMINATIM}?${params}`, { signal: ctl.signal });
        const rows = r.ok ? await r.json() : [];
        setPlaces(rows.map((row) => ({
          id: row.place_id,
          name: row.name || String(row.display_name).split(",")[0],
          detail: row.display_name,
          lat: Number(row.lat),
          lng: Number(row.lon),
          bbox: row.boundingbox?.map(Number) ?? null,   // [south, north, west, east]
        })));
        setState("done");
      } catch (e) {
        if (e.name !== "AbortError") setState("error");
      }
    }, 600);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [term, getBias]);

  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    if (e.key === "Enter") {
      if (units[0]) onPickVehicle(units[0].id);
      else if (places[0]) onPickPlace(places[0]);
    }
  };

  return (
    <div className="mtr-pop mtr-search" role="dialog" aria-label="Search the map">
      <div className="mtr-search__field">
        <i className="ti ti-search" aria-hidden="true" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Plate, driver, place or road"
          aria-label="Plate, driver, place or road"
        />
        {q && (
          <button type="button" className="mtr-search__clear" onClick={() => setQ("")} aria-label="Clear">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>

      {units.length > 0 && (
        <div className="mtr-search__group">
          <div className="mtr-search__head">Vehicles</div>
          {units.map((v) => (
            <button type="button" key={v.id} className="mtr-search__row" onClick={() => onPickVehicle(v.id)}>
              <UnitTypeIcon vehicle={v} size={24} />
              <span className="mtr-search__text">
                <span className="mtr-search__name">{v.name || v.id}</span>
                <span className="mtr-search__detail">
                  {[v.name && v.name !== v.id ? v.id : null, v.driver].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={`mtr-search__seen${v.online ? " mtr-search__seen--on" : ""}`}>{lastSeenLabel(v)}</span>
            </button>
          ))}
        </div>
      )}

      {unitTerm && units.length === 0 && (lookingElsewhere || elsewhere.length > 0) && (
        <div className="mtr-search__group">
          <div className="mtr-search__head">Vehicles</div>
          {lookingElsewhere
            ? <div className="mtr-search__note">Checking your other organisations…</div>
            : (
              <>
                <div className="mtr-search__note">Not in {activeCompany?.short || "this organisation"}. Found in:</div>
                {elsewhere.map(({ company, units: found }) => (
                  <button
                    type="button" key={company.id} className="mtr-search__row"
                    onClick={() => { move(company, found[0]); onClose(); }}
                    title={`Switch to ${company.name} and open ${found[0].plate}`}
                  >
                    <i className="ti ti-building" aria-hidden="true" />
                    <span className="mtr-search__text">
                      <span className="mtr-search__name">{company.short || company.name}</span>
                      <span className="mtr-search__detail">
                        {found.slice(0, 3).map((u) => u.plate).join(", ")}
                        {found.length > 3 ? ` +${found.length - 3}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </>
            )}
        </div>
      )}

      {unitTerm && units.length === 0 && fenceHits.total === 0 && !lookingElsewhere && elsewhere.length === 0 && term.length < 3 && (
        <div className="mtr-search__note">No unit matches that search.</div>
      )}

      {fenceHits.total > 0 && (
        <div className="mtr-search__group">
          <div className="mtr-search__head">Geofences</div>
          {fenceHits.hits.map((f) => (
            <button type="button" key={f.properties.id ?? f.properties.name} className="mtr-search__row" onClick={() => onPickFence(f)}>
              <i className="ti ti-map-pins" aria-hidden="true" />
              <span className="mtr-search__text">
                <span className="mtr-search__name">{f.properties.name}</span>
                <span className="mtr-search__detail">{fenceDetail(f)}</span>
              </span>
            </button>
          ))}
          {fenceHits.total > fenceHits.hits.length && (
            <div className="mtr-search__note">
              Showing {fenceHits.hits.length} of {fenceHits.total.toLocaleString()}. Keep typing to narrow it.
            </div>
          )}
        </div>
      )}

      {term.length >= 3 && (
        <div className="mtr-search__group">
          <div className="mtr-search__head">Places</div>
          {state === "loading" && places.length === 0 && <div className="mtr-search__note">Searching…</div>}
          {state === "error" && <div className="mtr-search__note">Place search is unavailable right now.</div>}
          {state === "done" && places.length === 0 && <div className="mtr-search__note">No Places Found</div>}
          {places.map((p) => (
            <button type="button" key={p.id} className="mtr-search__row" onClick={() => onPickPlace(p)}>
              <i className="ti ti-map-pin" aria-hidden="true" />
              <span className="mtr-search__text">
                <span className="mtr-search__name">{p.name}</span>
                <span className="mtr-search__detail">{p.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!term && (
        <div className="mtr-search__note">
          Type a plate, a driver, {fences?.length ? "a geofence, " : ""}a place or a road.
        </div>
      )}
    </div>
  );
}

/**
 * A rail menu closes as the Geofences one does: a press outside the rail,
 * Escape (caught first, so it closes only the menu, focus back to its button),
 * or another map window opening (lib/sidePanels).
 */
function useRailMenu(name, open, setOpen, btnRef, wrapRef) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [open, setOpen, btnRef, wrapRef]);
  useEffect(() => { if (open) claimMapWindow(name); }, [open, name]);
  useEffect(() => onMapWindowClaim(name, () => setOpen(false)), [name, setOpen]);
}

export default function MapToolRail({
  expanded, onToggleExpanded,
  vehicles, getBias, onPickVehicle, onPickPlace,
  namesOn, onToggleNames,
  layers,
  bases, base, onBase, baseNote,   // base map choice, shown in the Maps panel
  onFitFleet,
  measuring, measureText, onToggleMeasure,
  traffic,          // the "traffic" map layer ({ on, onToggle }) or null
  weather,          // the "weather" map layer ({ on, onToggle, note }) or null
  zones,            // the "zones" map layer ({ on, onToggle }) or null
  workPlans,        // the "workplans" map layer ({ on, onToggle }) or null where none are kept
  drawFence,        // { on, onToggle } or null without geofence:create
  halted,          // { count, open, onOpen } or null without map:filter
  fuelAlerts,       // { count, open, onOpen } or null without map:fuel_alerts
  arrivals,         // { open, onOpen } or null while Google routing is off
  dashcam,          // { count, critical, onOpen } or null where there are no VSS cameras
  fences,           // the geofences the search can find, or null where the layer is not offered
  onPickFence,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  // The Geofences menu: show them all, the custom ones, or draw one.
  const [fencesOpen, setFencesOpen] = useState(false);
  const fencesBtn = useRef(null);
  // The Alerts menu: Halted, Fuel alerts and Dashcam alarms.
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsBtn = useRef(null);
  // The Tools menu: Measure, Live traffic, Weather.
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsBtn = useRef(null);
  const wrapRef = useRef(null);
  // Each tool is a right of its own since 2026-11-14 (map:traffic,
  // map:weather, map:geofences / map:custom_geos, map:arrivals): a tool the
  // person does not hold is removed, not drawn disabled. Technicians lost
  // these by a fixed rule until then (operator, 2026-10-27); every role
  // starts with them now and IAM takes one away per person.
  const { can } = usePermissions();
  const mayFences = can("map:geofences") || can("map:custom_geos");

  // The search panel closes on a press outside the rail, like the layers menu.
  useEffect(() => {
    if (!searchOpen) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setSearchOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen]);

  // The Geofences menu closes the same way, and on Escape, back to its button.
  useEffect(() => {
    if (!fencesOpen) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setFencesOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // Caught first, on the way down, so Escape closes only the menu and not
      // a drawing open behind it.
      e.preventDefault();
      e.stopPropagation();
      setFencesOpen(false);
      fencesBtn.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [fencesOpen]);
  // One map window at a time: the menu opening closes Fuel alerts, Halted and
  // the rest, and another window opening closes the menu.
  useEffect(() => { if (fencesOpen) claimMapWindow("geofence-menu"); }, [fencesOpen]);
  useEffect(() => onMapWindowClaim(["geofence-menu", "geofence"], () => setFencesOpen(false)), []);

  useRailMenu("alerts-menu", alertsOpen, setAlertsOpen, alertsBtn, wrapRef);
  useRailMenu("tools-menu", toolsOpen, setToolsOpen, toolsBtn, wrapRef);
  // One rail pop at a time: opening one closes the others.
  const only = (which) => {
    setSearchOpen((v) => (which === "search" ? !v : false));
    setFencesOpen((v) => (which === "fences" ? !v : false));
    setAlertsOpen((v) => (which === "alerts" ? !v : false));
    setToolsOpen((v) => (which === "tools" ? !v : false));
  };
  const showTraffic = can("map:traffic");
  const showWeather = can("map:weather");
  // The toolbox is lit while any of its layers is on, and says which.
  const toolsOn = [
    showTraffic && traffic?.on && "traffic on",
    showWeather && weather?.on && "weather on",
    workPlans?.on && "work plans on",
  ].filter(Boolean);
  const toolsTitle = "Tools: " + [
    "measure a distance", showTraffic && "live traffic", showWeather && "weather",
    workPlans && "work plans",
  ].filter(Boolean).join(", ");
  // What the one button carries: every alert waiting, red while a fuel alert
  // or a critical dashcam alarm is among them; lit while Halted or Fuel
  // alerts is open.
  const alertsAny = Boolean(halted || fuelAlerts || dashcam);
  const alertsCount = (halted?.count ?? 0) + (fuelAlerts?.count ?? 0) + (dashcam?.count ?? 0);
  const alertsTone = fuelAlerts?.count || dashcam?.critical ? "alert" : "warn";
  const alertsTitle = alertsCount
    ? "Alerts: " + [
        halted?.count ? `${halted.count} halted` : null,
        fuelAlerts?.count ? `${fuelAlerts.count} fuel` : null,
        dashcam?.count ? `${dashcam.count} dashcam` : null,
      ].filter(Boolean).join(", ")
    : "Alerts: halted units, fuel alerts and dashcam alarms";
  const canDrawFence = Boolean(drawFence);
  // The menu wherever there is something in it: the layer's two switches, and
  // Draw a geofence where that is allowed.
  const fencesMenu = canDrawFence || Boolean(zones);

  const close = () => setSearchOpen(false);

  return (
    <div className={`mtr${expanded ? " mtr--expanded" : ""}`} ref={wrapRef}>
      <div className="mtr-card" role="toolbar" aria-label="Map tools" aria-orientation="vertical" data-tour="map-tools">
        <div className="mtr-group">
          <RailButton
            icon="ti-search" label="Search" title={fences?.length ? "Search for a plate, driver, geofence, place or road" : "Search for a plate, driver, place or road"} tour="map-search"
            on={searchOpen} expanded={expanded} onClick={() => only("search")}
          />
          <RailButton
            icon={namesOn ? "ti-eye" : "ti-eye-off"} label={namesOn ? "Hide names" : "Show names"}
            title={namesOn ? "Hide vehicle names on the map" : "Show vehicle names on the map"}
            on={namesOn} expanded={expanded} onClick={onToggleNames}
          />
          <MapLayersMenu
            layers={layers} rail label={expanded ? "Maps" : null}
            bases={bases} base={base} onBase={onBase} baseNote={baseNote}
          />
          <RailButton
            icon="ti-scan" label="Fit fleet" title="Fit the whole fleet in view"
            expanded={expanded} onClick={onFitFleet}
          />
        </div>

        <div className="mtr-group">
          {/* Tools (operator, 2026-11-21): Measure, Live traffic, Weather and
              Work plans, buttons here until then, as one toolbox that opens a
              menu like Geofences. Lit while any of them is on. */}
          <RailButton
            btnRef={toolsBtn}
            glyph={<ToolboxGlyph />} label="Tools" tour="map-toolbox"
            title={measuring ? "Tools: measuring now (Esc ends)"
              : toolsOn.length ? `Tools: ${toolsOn.join(", ")}` : toolsTitle}
            on={Boolean(measuring) || toolsOn.length > 0}
            expanded={expanded}
            menuOpen={toolsOpen}
            onClick={() => only("tools")}
          />
          {/* Geofences: one button (operator, 2026-11-10: not two on one
              strip). It opens a menu: Show on the map, Custom geos and,
              where geofences can be drawn, Draw a geofence. Drawn for every
              company, disabled where there is nothing to offer: a tool that
              comes and goes between companies reads as a broken rail. */}
          {(mayFences || canDrawFence) && (fencesMenu ? (
            <RailButton
              btnRef={fencesBtn}
              icon="ti-map-pins" label="Geofences"
              title={drawFence?.on ? "Geofences: drawing one now"
                : canDrawFence ? "Geofences: show them, or draw one" : "Geofences: show all, or the custom ones"}
              on={Boolean(zones?.on) || Boolean(zones?.ownOnly) || Boolean(drawFence?.on)} expanded={expanded}
              menuOpen={fencesOpen}
              onClick={() => only("fences")}
            />
          ) : (
            <RailButton
              icon="ti-map-pins" label={zones?.on ? "Hide geofences" : "Show geofences"}
              title={zones
                ? `${zones.on ? "Hide" : "Show"} geofences on the map`
                : "No geofences are drawn for this company"}
              on={Boolean(zones?.on)} disabled={!zones} expanded={expanded} onClick={zones?.onToggle}
            />
          ))}
          {/* Alerts (operator, 2026-11-21): Halted, Fuel alerts and Dashcam
              alarms, three buttons here until then, as one that opens a menu
              like Geofences. Halted stays first in it (operator, 2026-10-07:
              "right below geofences"), then Fuel alerts, then Dashcam alarms. */}
          {alertsAny && (
            <RailButton
              btnRef={alertsBtn}
              icon="ti-bell-ringing" label="Alerts" tour="map-alerts"
              title={alertsTitle}
              on={Boolean(halted?.open) || Boolean(fuelAlerts?.open)}
              count={alertsCount} tone={alertsTone} expanded={expanded}
              menuOpen={alertsOpen}
              onClick={() => only("alerts")}
            />
          )}
          {/* Arrivals at a hub: every unit's live drive time in. */}
          {arrivals && can("map:arrivals") && (
            <RailButton
              icon="ti-target-arrow" label="Arrivals" tour="map-arrivals"
              title="Arrivals: who can reach a hub, and when, with live traffic"
              on={arrivals.open} expanded={expanded} onClick={arrivals.onOpen}
            />
          )}
        </div>

        <div className="mtr-group">
          <RailButton
            icon={expanded ? "ti-chevron-left" : "ti-chevron-right"} label={expanded ? "Collapse" : "Expand"}
            title={expanded ? "Collapse the tools" : "Show tool names"}
            expanded={expanded} onClick={onToggleExpanded}
          />
        </div>
      </div>

      {searchOpen && (
        <SearchPanel
          vehicles={vehicles}
          fences={fences}
          getBias={getBias}
          onPickVehicle={(id) => { close(); onPickVehicle(id); }}
          onPickFence={(f) => { close(); onPickFence?.(f); }}
          onPickPlace={(p) => { close(); onPickPlace(p); }}
          onClose={close}
        />
      )}

      {fencesOpen && fencesMenu && (
        <FencesMenu
          top={fencesBtn.current?.offsetTop ?? 0}
          zones={zones}
          drawFence={drawFence}
          onDone={() => setFencesOpen(false)}
        />
      )}

      {toolsOpen && (
        <ToolsMenu
          top={toolsBtn.current?.offsetTop ?? 0}
          measuring={measuring}
          onToggleMeasure={onToggleMeasure}
          traffic={traffic}
          weather={weather}
          showTraffic={showTraffic}
          showWeather={showWeather}
          workPlans={workPlans}
          onDone={() => setToolsOpen(false)}
        />
      )}

      {alertsOpen && alertsAny && (
        <AlertsMenu
          top={alertsBtn.current?.offsetTop ?? 0}
          halted={halted}
          fuelAlerts={fuelAlerts}
          dashcam={dashcam}
          onDone={() => setAlertsOpen(false)}
        />
      )}

      {measuring && (
        <div className="mtr-pop mtr-measure" role="status" aria-live="polite">
          <i className="ti ti-ruler-measure" aria-hidden="true" />
          <span className="mtr-measure__value">{measureText ?? "Click the map to start"}</span>
          <span className="mtr-measure__hint">Backspace undoes · Esc ends</span>
        </div>
      )}
    </div>
  );
}
