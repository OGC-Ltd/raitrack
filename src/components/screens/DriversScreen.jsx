// Desktop Drivers tab — real driver analytics from the fleet-server DB
// (/analytics/drivers). An analytics-focused roster on the left; the selected
// driver (first row by default) is profiled on the right with a rating gauge,
// KPI tiles, heaviest-load callout, and tonnes/mileage trend charts. A
// full-width leaderboard compares all drivers. Design mirrors the Analytics and
// Maintenance pages (cards, KPI tiles, ranked bars, Inter, --color-* tokens).

import { useState, useEffect, useId } from "react";
import "./DriversScreen.css";
import { getDriversOverview } from "../../api/drivers";
import { useAppContext } from "../../context/AppContext";
import { pendingDriver, clearPendingDriver, driverNameMatches } from "../../lib/driverHandoff";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useApiData } from "../../hooks/useApiData";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { createReport, addSectionTitle, addSummaryCards, addTable, downloadReport } from "../../utils/pdfReport";
import DownloadReportButton from "../shared/DownloadReportButton";
import { downloadOrgReportPdf } from "../../api/reports";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { DriversIcon } from "../footer/NavIcons";

// Report-only. The on-screen charts take their colour from --tone-tonnes /
// --tone-mileage on .drivers-page; jsPDF cannot resolve a CSS variable, so the
// PDF summary cards still need a literal.
const TONNES_COLOR = "#22c55e";
const MILEAGE_COLOR = "#06b6d4";

const fmt = (n, d = 0) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const initialsOf = (name = "") =>
  name.split(" ").map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "–";

// Rating → performance tier (drives the avatar ring + pill colour), mirroring the
// dash ManagerCard's status pill. A driver who hasn't earned any rating yet
// (score still at its 0 default) reads as "NEW", not a judgment call. Below
// "FAIR" (rating < 3) never shows a pill — the UI intentionally hides any
// "Needs Work" style label for low performers.
const ratingTier = (r = 0) => {
  if (r === 0) return { label: "NEW", color: "#94a3b8" };
  if (r >= 4.5) return { label: "EXCELLENT", color: "#22c55e" };
  if (r >= 4) return { label: "GOOD", color: "#22c55e" };
  if (r >= 3) return { label: "FAIR", color: "#f59e0b" };
  return { label: "", color: "#94a3b8" };
};

/**
 * A person's name, drawn as a name.
 *
 * The registry is synced from RaiFactorySuite and typed by hand for the orgs
 * the sync does not cover, so the same roster carries "JOSEPH OTIENO", "joseph
 * otieno" and "Joseph Otieno" — three spellings of one person, and a column of
 * them reads as three different kinds of record rather than one list.
 *
 * Case is REPAIRED, not forced. A word that already mixes cases is left exactly
 * as it was typed, because that is the only case a human chose on purpose —
 * "McOmbaka" and "DeSouza" survive, where a blanket `text-transform:
 * capitalize` would have kept "JOSEPH" shouting and a blanket lowercase-then-
 * capitalise would have flattened them. Hyphens and apostrophes are word
 * boundaries: "achieng'-odhiambo" is two names, not one.
 *
 * The stored value is untouched — this is a rendering, so search, sort and
 * every export still see what the server sent.
 */
const titleCase = (name = "") =>
  String(name).replace(/[^\s'’-]+/g, (w) =>
    (/[a-z]/.test(w) && /[A-Z]/.test(w))
      ? w
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The window a driver's figures actually cover.
 *
 * The roster is pulled over a fixed 90-day window, so "the period" as a page
 * fact is the same sentence on every row and worth no column. What differs per
 * driver is when they were ACTIVE inside it — `byDay` is only the days that
 * carry a trip — and that is the fact the grid was missing: a driver with 12
 * trips over three days and one with 12 over three months read identically.
 *
 * Taken from `details[id].byDay`, which the overview already returns in the
 * same payload as the roster, so this costs no request. Nothing is invented:
 * a driver with no activity gets no window and the cell says so.
 */
const activeWindow = (detail) => {
  const byDay = detail?.byDay ?? [];
  if (byDay.length === 0) return null;
  const from = byDay[0].day, to = byDay.at(-1).day;
  return { from, to, days: byDay.length, label: from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}` };
};

// Roster table shows the top drivers a page at a time; the rest paginate.
const ROSTER_PAGE_SIZE = 6;

// Full driver datagrid (search + metric filter + sort + load-more), mirroring
// the Maintenance grid. The metric chips rank the grid by one of the numbers.
//
// LOAD MORE, not pages — `.sp4-table-more`, which is what the tables on that
// tab do. A roster is a list you read down, and paging cuts it into arbitrary
// slices: rank by tonnes, and the answer to "who is behind the top fifteen" is
// a control that throws the top fifteen away to show you. Growing the list
// keeps what has already been read on screen, and the tally beside the button
// says how much is left rather than how many slices there are.
//
// The step is smaller on a phone because a row IS bigger there: the table
// becomes a stack of cards, each about 133px tall, so 15 of those is a
// ~2,000px scroll. The query is the same 700px the stylesheet switches on (see
// DriversScreen.css) — the step and the row shape have to change at the same
// width, or a tablet gets table rows counted out for cards.
const GRID_CARDS_QUERY = "(max-width: 700px)";
const GRID_STEP = 15;
const GRID_STEP_PHONE = 10;
const GRID_METRICS = [
  { key: "tonnes", label: "Tonnes" },
  { key: "mileageKm", label: "Mileage" },
  { key: "trips", label: "Trips" },
  { key: "rating", label: "Rating" },
];

// Driver employment status (UserStatus enum) → label + tone for the grid badge.
/* The status badge carries a TONE NAME, not a hex.
 *
 * These were three literals handed to the cell as an inline `--tone`, which
 * made the badge the one thing in the grid the theme could not reach: #22c55e
 * measures 2.3:1 on the light page and #f59e0b 2.1:1, both far under the 4.5
 * an 11px label needs, and no stylesheet could correct them because the value
 * arrived after the cascade. The name goes to a class and the colour lives in
 * DriversScreen.css, per theme, like every other colour on this page. */
const DRIVER_STATUS = {
  ACTIVE: { label: "Active", tone: "active" },
  SUSPENDED: { label: "Suspended", tone: "suspended" },
  TERMINATED: { label: "Terminated", tone: "terminated" },
};
const statusMeta = (s) => DRIVER_STATUS[s] || { label: s || "—", tone: "unknown" };

// Trend delta over a daily series — this half vs the previous half. Mirrors the
// stat cards on the Analytics page so the driver trend charts read as siblings.
function periodDelta(values) {
  if (values.length < 2) return null;
  const half = Math.max(1, Math.floor(values.length / 2));
  const cur = values.slice(-half);
  const prev = values.slice(-2 * half, -half);
  const total = (arr) => arr.reduce((s, x) => s + x, 0);
  const c = total(cur), p = total(prev);
  if (p <= 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}

export default function DriversScreen() {
  const { activeCompanyId, activeCompany } = useAppContext();

  // Live fleet (shared SSE stream) — powers the selected driver's realtime
  // gauges/radar. Same list the map renders, no extra request.
  const { vehicles: liveVehicles } = useFleetLiveShared();

  // One batched request: roster + EVERY driver's analytics (kept warm on the
  // server). Selecting a driver is then a pure in-memory lookup — instant,
  // no per-selection fetch — and the localStorage cache repaints the whole
  // page on revisit without waiting on the network.
  const { data: overview, loading, error, retry } = useApiData(
    () => getDriversOverview({ companyId: activeCompanyId }),
    [activeCompanyId],
    { cacheKey: `ft-drivers-ov:${activeCompanyId}` }
  );
  const drivers = overview?.drivers ?? [];

  const [selectedId, setSelectedId] = useState(null);
  const [leaderView, setLeaderView] = useState("top"); // "top" | "bottom" 6 by tonnes

  // Default to the first driver in the table; keep a valid selection on refresh.
  useEffect(() => {
    const list = overview?.drivers ?? [];
    if (list.length === 0) { setSelectedId(null); return; }
    // Opened from a vehicle's driver link → select that driver once.
    const wanted = pendingDriver();
    if (wanted) {
      const hit = list.find((d) => driverNameMatches(d.fullName, wanted));
      clearPendingDriver();
      if (hit) { setSelectedId(hit.id); return; }
    }
    setSelectedId((prev) => (prev && list.some((d) => d.id === prev) ? prev : list[0].id));
  }, [overview]);

  const detail = (selectedId && overview?.details?.[selectedId]) || null;
  const detailLoading = loading;

  // The selected driver's vehicle in the live fleet — matched by driver name
  // (the telemetry stream carries the assigned driver on every vehicle).
  const selectedName = detail?.driver?.fullName
    ?? drivers.find((d) => d.id === selectedId)?.fullName;
  const liveVehicle = selectedName
    ? liveVehicles.find((v) => v.driver === selectedName) ?? null
    : null;

  // Leaderboard shows the top or bottom 6 drivers by tonnes ferried — the list
  // arrives already sorted by tonnes, highest first.
  const leaderDrivers =
    leaderView === "bottom" ? drivers.slice(-ROSTER_PAGE_SIZE) : drivers.slice(0, ROSTER_PAGE_SIZE);

  // Sub caption for the trend stat charts — the delta pill's "this half vs
  // previous half" framing, matching the Analytics page.
  const dayCount = detail?.byDay?.length ?? 0;
  const dHalf = Math.max(1, Math.floor(dayCount / 2));
  const detailSub = !detail ? "" : dayCount > 1 ? `last ${dHalf}d vs previous ${dHalf}d` : "single day";

  // ── PDF reports (utils/pdfReport.js — same builder as the Warehouse tab) ──
  const accent = activeCompany?.accentColor || "#22c55e";

  // Whole roster — server-rendered template report (kind 'drivers'), same
  // 90-day window the on-screen roster uses (api/drivers getDriversOverview).
  const handleAllDriversReport = () =>
    downloadOrgReportPdf({
      companyId: activeCompanyId,
      kind: "drivers",
      days: 90,
      filename: `${activeCompany?.short || "Fleet"}-Drivers-Report.pdf`,
    });

  // Selected driver: the performance statement + daily activity, from the same
  // /analytics/drivers/:id payload the profile cards render.
  //
  // This is where the statement lives now. The card that used to print it
  // beside the grid is gone — it was the third copy of figures the grid and
  // the Summary card above already carry — but it held two things they do not:
  // hours on road, and the heaviest load with its date and route. Both are
  // still in this PDF, which is the artefact a statement should be anyway.
  const handleDriverReport = () => {
    if (!detail?.driver) return;
    const { driver, totals, heaviestLoad, byDay = [] } = detail;
    const tier = ratingTier(driver.rating);
    const period = byDay.length ? `${fmtDay(byDay[0].day)} – ${fmtDay(byDay.at(-1).day)}` : "no activity";
    const doc = createReport({
      companyName: activeCompany?.name || "Fleet",
      reportTitle: "Driver Report",
      subtitle:    `${titleCase(driver.fullName)}${driver.employeeId ? ` · #${driver.employeeId}` : ""} · ${period}`,
      accentColor: accent,
    });
    addSummaryCards(doc, [
      { value: `${fmt(driver.rating, 1)} / 5`,   label: tier.label ? `Rating — ${tier.label}` : "Rating", color: tier.color },
      { value: fmt(totals.trips),                label: "Trips",                  color: "#3b82f6" },
      { value: `${fmt(totals.tonnes, 1)} t`,     label: "Tonnes ferried",         color: TONNES_COLOR },
      { value: `${fmt(totals.mileageKm)} km`,    label: "Mileage",                color: MILEAGE_COLOR },
    ]);
    addSectionTitle(doc, "Performance Statement");
    addTable(doc, {
      accentColor: accent,
      head: ["Metric", "Value"],
      body: [
        ["Trips completed",    fmt(totals.trips)],
        ["Tonnes ferried",     `${fmt(totals.tonnes, 1)} t`],
        ["Distance covered",   `${fmt(totals.mileageKm)} km`],
        ["Hours on road",      `${fmt(totals.hoursOnRoad, 1)} h`],
        ["Fuel-theft cases",   fmt(totals.fuelTheftCases)],
        ["Overspeeding cases", fmt(totals.overspeedingCases)],
        ["Heaviest load",      heaviestLoad ? `${fmt(heaviestLoad.tonnes, 1)} t · ${fmtDay(heaviestLoad.date)} · ${heaviestLoad.route}` : "—"],
      ],
    });
    if (byDay.length > 0) {
      addSectionTitle(doc, "Daily Activity");
      addTable(doc, {
        accentColor: accent,
        head: ["Date", "Tonnes", "Mileage (km)"],
        body: byDay.map((d) => [fmtDay(d.day), fmt(d.tonnes, 1), fmt(d.mileageKm)]),
      });
    }
    downloadReport(doc, `${activeCompany?.short || "Fleet"}-Driver-Report-${titleCase(driver.fullName).replace(/\s+/g, "")}.pdf`);
  };

  const isEmpty = !loading && drivers.length === 0;

  return (
    <div className="drivers-page">
      <div className="drivers-page__inner">
        {/* The empty state already names the page — no header needed then. */}
        {!isEmpty && (
          <div className="dr-head">
            <div>
              <h1 className="dr-title">Driver Analytics</h1>
              <div className="dr-subtitle">
                {loading ? "Loading…" : `${fmt(drivers.length)} driver${drivers.length === 1 ? "" : "s"} · ${activeCompany?.name || "Fleet"}`}
              </div>
            </div>
            {/* The two PDF buttons used to sit here, beside the page title.
                They are on the TABLE now — see AllDriversSection — because
                that is what they export and it is where Sensor Monitor keeps
                its own: an export control at the top of a page claims the
                page, and a reader looking at a roster should not have to
                travel back up to a header to take it away. */}
          </div>
        )}

        {error ? (
          <LoadError label="Drivers" onRetry={retry} fullSection />
        ) : !loading && drivers.length === 0 ? (
          <TabEmptyState
            icon={<DriversIcon size={44} />}
            title="Drivers"
            hint="No drivers yet. Driver profiles and analytics will appear here once the live integration is connected."
          />
        ) : (
          <ErrorBoundary label="Drivers">
            <div className="dr-layout">
              {/* Selected-driver detail — the four KPI cards sit at the top as the
                  main summary area; the full driver grid follows below. */}
              <div className="dr-detail">
                <DriverCard detail={detail} loading={detailLoading} liveVehicle={liveVehicle} />
                <TrendStat
                  title="Tonnes ferried"
                  series={detail?.byDay ?? []}
                  valueKey="tonnes"
                  value={detail ? fmt(detail.totals.tonnes, 1) : "—"}
                  unit="t"
                  tone="tonnes"
                  type="bar"
                  sub={detailSub}
                  loading={detailLoading}
                />
                <TrendStat
                  title="Mileage covered"
                  series={detail?.byDay ?? []}
                  valueKey="mileageKm"
                  value={detail ? fmt(detail.totals.mileageKm) : "—"}
                  unit="km"
                  tone="mileage"
                  type="line"
                  sub={detailSub}
                  loading={detailLoading}
                />
                <SummaryCard detail={detail} loading={detailLoading} />
              </div>
            </div>

            {/* All drivers — the datagrid, full width, in the Maintenance
                tab's grid grammar. It used to be a master-detail pair with a
                Performance statement card beside it at 38%; that card restated
                the selected driver's trips, tonnes, mileage, incidents and
                rating, all of which are columns in the grid it sat next to and
                most of which are also in the Summary card above. The grid gets
                the whole row now, which is the width eight columns needed. */}
            <AllDriversSection
              drivers={drivers}
              details={overview?.details}
              selectedId={selectedId}
              onSelect={setSelectedId}
              selectedName={selectedName}
              onDriverReport={detail?.driver ? handleDriverReport : null}
              onAllDriversReport={handleAllDriversReport}
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}

function DriverCard({ detail, loading, liveVehicle }) {
  if (!detail || !detail.driver) {
    return (
      <div className="dr-card dr-profile">
        <div className="dr-card__empty">{loading ? "Loading driver…" : "Select a driver to see their analytics."}</div>
      </div>
    );
  }
  const { driver } = detail;
  const tier = ratingTier(driver.rating);

  // Live telemetry off the shared SSE stream — the gauges/radar track the
  // driver's vehicle in realtime. Engine off (or no assigned vehicle in this
  // fleet) renders the card's grey engine-off state.
  const v        = liveVehicle;
  const engineOn = v?.engine === "on";
  const speed    = v?.speed ?? 0;
  const fuel     = v?.fuelLevel ?? 0;
  const loadPct  = v?.maxPayload > 0 ? Math.min(100, Math.round(((v?.weight ?? 0) / v.maxPayload) * 100)) : 0;
  const temp     = v?.engineTemp ?? 0;
  const oil      = v?.oilLevel ?? 0;

  const speedColor = speed > (v?.speedLimit ?? 80) ? "#ef4444" : "#22c55e";
  const fuelColor  = fuel < 15 ? "#ef4444" : fuel < 40 ? "#f59e0b" : "#22c55e";
  const loadColor  = loadPct > 95 ? "#ef4444" : loadPct > 80 ? "#f59e0b" : "#06b6d4";

  const radarVals  = engineOn
    ? [Math.min(speed / 120, 1), fuel / 100, Math.min(temp / 120, 1), oil / 100, loadPct / 100]
    : [0, 0, 0, 0, 0];
  const radarLabel = !v ? "NO VEHICLE" : engineOn ? `LIVE · ${v.id}` : "ENGINE OFF";

  return (
    <div className="dr-card dr-profile">
      <div className="dr-profile__head">
        <span
          className="dr-profile__avatar"
          style={{ borderColor: tier.color, boxShadow: `0 0 0 2px ${tier.color}26` }}
        >
          {initialsOf(driver.fullName)}
        </span>
        <div className="dr-profile__ident">
          <div className="dr-profile__namerow">
            <span className="dr-profile__name">{titleCase(driver.fullName)}</span>
            {tier.label && (
              <span
                className="dr-profile__pill"
                style={{ color: tier.color, background: `${tier.color}1f`, border: `1px solid ${tier.color}55` }}
              >
                {tier.label}
              </span>
            )}
          </div>
          <div className="dr-profile__meta">
            {driver.employeeId ? `#${driver.employeeId}` : "Driver"}
            {driver.licenceNumber ? ` · Lic ${driver.licenceNumber}` : ""}
            {v ? ` · ${v.id}` : ""}
          </div>
          <StarRating value={driver.rating} />
        </div>
      </div>

      {/* Gauges + radar — mirrors the dash RightPanel ManagerCard, now driven
          by the vehicle's live telemetry (speed / fuel / load + the 5-axis
          health radar). Grey engine-off state when the engine is off. */}
      <div className="dr-gaugewrap">
        <div className="dr-gauges">
          <DriverGauge label="SPEED"  value={speed}   max={120} color={speedColor} off={!engineOn} />
          <DriverGauge label="FUEL %" value={fuel}    max={100} color={fuelColor}  off={!engineOn} />
          <DriverGauge label="LOAD %" value={loadPct} max={100} color={loadColor}  off={!engineOn} />
        </div>
        <DriverRadar
          axes={["Speed", "Fuel", "Temp", "Oil", "Load"]}
          vals={radarVals}
          label={radarLabel}
          off={!engineOn}
        />
      </div>
    </div>
  );
}

function StarRating({ value }) {
  const v = Number(value ?? 0);
  return (
    <div className="dr-rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 24 24" fill={i <= Math.round(v) ? "#f59e0b" : "none"} stroke="#f59e0b" strokeWidth="1.5">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
      <span className="dr-rating__num">{fmt(v, 1)}/5</span>
    </div>
  );
}

const GAUGE_OFF = "#4b5563"; // ManagerCard's engine-off grey

// Circular progress gauge — ported from the dash ManagerCard. `value/max` fills
// the ring; in the `off` state the ring is empty and the centre shows "—".
function DriverGauge({ value = 0, max = 100, label, color = "#22c55e", off = false }) {
  const r = 18, cx = 22, cy = 22, stroke = 3.5;
  const circ = 2 * Math.PI * r;
  const dash = off ? 0 : circ * Math.max(0, Math.min(value / max, 1));
  return (
    <div className="dr-gauge">
      <div className="dr-gauge__ring">
        {/* No width/height attributes: the ring sizes it, so one media query
            can grow all three gauges at once. The viewBox keeps the geometry. */}
        <svg className="dr-gauge__svg" viewBox="0 0 44 44">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
          <circle
            cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </svg>
        <div className="dr-gauge__val" style={off ? { color: GAUGE_OFF } : undefined}>{off ? "—" : Math.round(value)}</div>
      </div>
      <span className="dr-gauge__lbl">{label}</span>
    </div>
  );
}

// Vehicle-health radar — ported from the dash ManagerCard. Each `vals` entry is a
// 0–1 spoke length; the `off` state greys the plot out.
function DriverRadar({ axes, vals, label, off = false }) {
  const n = axes.length;
  const CX = 36, CY = 32, R = 22;
  const angleStep = (2 * Math.PI) / n;
  const offset = -Math.PI / 2;
  const pt = (i, rr) => [CX + rr * Math.cos(offset + i * angleStep), CY + rr * Math.sin(offset + i * angleStep)];
  const gridLevels = [0.33, 0.66, 1].map((lvl) => {
    const pts = Array.from({ length: n }, (_, i) => pt(i, R * lvl));
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + "Z";
  });
  const dataPath =
    vals.map((v, i) => { const p = pt(i, R * Math.max(v, 0.02)); return `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`; }).join(" ") + "Z";
  return (
    <div className="dr-radar">
      <svg className="dr-radar__svg" viewBox="0 0 72 68">
        {gridLevels.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--border)" strokeWidth="0.8" />)}
        {Array.from({ length: n }, (_, i) => {
          const p = pt(i, R);
          return <line key={i} x1={CX} y1={CY} x2={p[0].toFixed(1)} y2={p[1].toFixed(1)} stroke="var(--border)" strokeWidth="0.8" />;
        })}
        <path d={dataPath} fill={off ? "rgba(75,85,99,0.15)" : "rgba(34,197,94,0.2)"} stroke={off ? GAUGE_OFF : "#22c55e"} strokeWidth="1.5" strokeLinejoin="round" />
        {vals.map((v, i) => { const p = pt(i, R * Math.max(v, 0.02)); return <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={off ? GAUGE_OFF : "#22c55e"} />; })}
        {axes.map((a, i) => {
          const p = pt(i, R + 9);
          return <text key={i} x={p[0].toFixed(1)} y={p[1].toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="6.5" fill="var(--text-2)">{a}</text>;
        })}
      </svg>
      <span className="dr-radar__lbl">{label}</span>
    </div>
  );
}

// Summary card — total trips, fuel-theft and overspeeding cases for the selected
// driver. Sits beside the mileage trend in the detail grid.
function SummaryCard({ detail, loading }) {
  if (!detail || !detail.driver) {
    return (
      <div className="dr-card dr-summary">
        <div className="dr-card__empty">{loading ? "Loading…" : "Select a driver to see their summary."}</div>
      </div>
    );
  }
  const { totals } = detail;
  // Trips is the scale of the window; the other two are exceptions to it. The
  // version this replaces gave all three the same 20px figure in three
  // different hues - purple for "Total trips", which means nothing, next to a
  // red and an amber that mean a great deal. Colour is spent on the exceptions
  // now, and only when there are any.
  const incidents = [
    { name: "Fuel theft", n: totals.fuelTheftCases, tone: "theft" },
    { name: "Overspeeding", n: totals.overspeedingCases, tone: "speed" },
  ];
  const clean = incidents.every((i) => !i.n);

  return (
    <div className="dr-card dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Summary</span>
        {clean && <span className="dr-summary__clean">Clean</span>}
      </div>

      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(totals.trips)}</span>
        <span className="dr-summary__caption">trips completed<br />in this window</span>
      </div>

      <div className="dr-summary__incidents">
        {incidents.map((i) => (
          <div
            key={i.name}
            className={`dr-summary__incident${i.n ? ` dr-summary__incident--${i.tone}` : ""}`}
          >
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">{i.name}</span>
            <span className="dr-summary__count">{fmt(i.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// "All drivers" section — mirrors the Maintenance page's vehicle datagrid: a
// full-width filter row (metric chips + word search) above the edge-to-edge
// grid card — sticky header, sortable, paginated — which takes the whole row.
function AllDriversSection({
  drivers, details, selectedId, onSelect,
  selectedName, onDriverReport, onAllDriversReport,
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("mileageKm");
  const [sortDir, setSortDir] = useState("desc");
  const cardView = useMediaQuery(GRID_CARDS_QUERY);
  const step = cardView ? GRID_STEP_PHONE : GRID_STEP;
  const [shown, setShown] = useState(GRID_STEP);

  const q = query.trim().toLowerCase();
  const filtered = drivers.filter((d) =>
    !q ||
    d.fullName.toLowerCase().includes(q) ||
    String(d.employeeId ?? "").toLowerCase().includes(q) ||
    String(d.licenceNumber ?? "").toLowerCase().includes(q) ||
    String(d.vehicle ?? "").toLowerCase().includes(q)
  );

  const windowFor = (id) => activeWindow(details?.[id]);

  const sorted = [...filtered].sort((a, b) => {
    let cmp;
    if (sortKey === "driver") cmp = a.fullName.localeCompare(b.fullName);
    else if (sortKey === "status") cmp = String(a.status ?? "").localeCompare(String(b.status ?? ""));
    // By the LAST active day, not by the length of the window: the question a
    // reader asks of this column is "who has been driving lately". ISO days
    // compare correctly as strings, and a driver with no activity sorts to the
    // bottom of a descending sort rather than to the top of it.
    // `vehicle` IS the plate — a string, the way the filter above it and the
    // cell that renders it both read it. This reached for `.plate`, a shape it
    // has not had since the roster started sending the registration itself, so
    // every row resolved to undefined, every comparison returned 0, and the
    // column kept whatever order it was already in. A dead sort looks exactly
    // like a sort on a column whose values happen to be tied.
    // By PLATE, not by whether the posting is open: sorting a column of
    // registrations on a hidden boolean puts two units of the same fleet
    // number in different halves of the list for a reason nothing on screen
    // explains. Rows with no vehicle sort last either way.
    else if (sortKey === "vehicle") cmp = String(a.vehicle ?? "\uffff").localeCompare(String(b.vehicle ?? "\uffff"));
    else if (sortKey === "period") cmp = String(windowFor(a.id)?.to ?? "").localeCompare(String(windowFor(b.id)?.to ?? ""));
    else cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
    return sortDir === "asc" ? cmp : -cmp;
  });

  // At least one step is always on screen. Rotating a tablet into portrait
  // changes the step under a count that was set with the other one, and a grid
  // that answers a rotation by showing FEWER rows than its own minimum is a
  // grid that has lost the reader's place.
  const pageRows = sorted.slice(0, Math.max(shown, step));
  const rest = sorted.length - pageRows.length;
  // "Load less" is only offered once the list HAS been grown. Before that it
  // would be a control for collapsing a list to the size it is already at.
  const grown = pageRows.length > step;

  // Re-ranking collapses the list back to one step. What is on screen after a
  // sort is the TOP of the new order, which is what the reader just asked for;
  // keeping sixty rows open would bury it under rows grown for the old one.
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "driver" ? "asc" : "desc"); }
    setShown(step);
  };
  // Metric chips rank the grid by that number, highest first.
  const rankBy = (key) => { setSortKey(key); setSortDir("desc"); setShown(step); };
  const update = (fn) => { fn(); setShown(step); };

  return (
    <>
      {/* Filters — chips + search, full width above the row (like maint-filters). */}
      <div className="dr-filters">
        {/* `display: contents` at every width above 768px, so the chips still
            lay out as direct children of the wrapping flex row and the desktop
            bar is unchanged. Below 768 the wrapper becomes a real box and takes
            one horizontally-scrolling line — see DriversScreen.css. */}
        <div className="dr-filters__chips">
          {GRID_METRICS.map((m) => (
            <GridChip key={m.key} active={sortKey === m.key} onClick={() => rankBy(m.key)} label={m.label} />
          ))}
        </div>
        {/* The glyph is drawn, not imported — the page carries no icon set, and
            it is the same two elements the Sensor Monitor bar and the User
            accounts roster draw, so the three search fields cannot fall out of
            step with each other. */}
        <div className="dr-searchwrap">
          <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            className="dr-search"
            value={query}
            onChange={(e) => update(() => setQuery(e.target.value))}
            placeholder="Search driver, ID or licence…"
          />
        </div>
        {/* The two exports, inline with the search that precedes them: this row
            is the table's toolbar, and a control that acts on the table belongs
            in it. They used to sit beside the page title, four cards above the
            grid they export.

            The titles say what each one covers, because neither follows this
            row's search box or chips — one is the selected driver's statement,
            the other the whole registry. */}
        <div className="dr-filters__tools">
          {onDriverReport && selectedName && (
            <DownloadReportButton
              onGenerate={onDriverReport}
              permission="driver:export"
              label={`${titleCase(selectedName).split(" ")[0]} PDF`}
            />
          )}
          <DownloadReportButton
            onGenerate={onAllDriversReport}
            permission="driver:export"
            label="All Drivers PDF"
          />
        </div>
      </div>

      <div className="dr-grid-card">
        <div className="dr-grid-scroll">
          <table className="dr-grid">
            <thead>
              <tr>
                <GridTh label="Driver" k="driver" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                {/* The unit they were last in, beside the person who drove it. */}
                <GridTh label="Vehicle" k="vehicle" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <GridTh label="Status" k="status" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                {/* The window the row's figures cover. It sits with the WORDS,
                    before the measurements, because it qualifies all six of
                    them — the same place Sensor Monitor puts the day its fuel
                    columns are counted over. */}
                <GridTh label="Period" k="period" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <GridTh label="Rating" k="rating" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <GridTh label="Trips" k="trips" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <GridTh label="Tonnes" k="tonnes" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <GridTh label="Mileage" k="mileageKm" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <GridTh label="Fuel theft" k="fuelTheftCases" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <GridTh label="Overspeed" k="overspeedingCases" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d) => {
                const st = statusMeta(d.status);
                // The row IS the control — this is a master-detail grid and
                // picking a driver is the point of it. It was mouse-only: no
                // tabindex, no key handler, no selected state announced.
                return (
                  <tr
                    key={d.id}
                    className={d.id === selectedId ? "dr-grid__row--selected" : ""}
                    onClick={() => onSelect(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(d.id); }
                    }}
                    tabIndex={0}
                    aria-selected={d.id === selectedId}
                  >
                    <td>
                      <span className="dr-driver">
                        {/* Neutral, not per-driver. An identity hash paints a
                            colour that means nothing, and the eye reads it as
                            a status — next to the status badge and the two
                            incident columns, which DO carry colour, that is
                            six hues competing in one row. The initials are
                            the identifier; grey lets them be. */}
                        <span className="dr-avatar">
                          {initialsOf(d.fullName)}
                        </span>
                        <span className="dr-driver__name">{titleCase(d.fullName)}</span>
                      </span>
                    </td>
                    <VehicleCell plate={d.vehicle} from={d.vehicleFrom} />
                    <td>
                      <span className={`dr-grid__badge dr-grid__badge--${st.tone}`}>{st.label}</span>
                    </td>
                    <PeriodCell w={windowFor(d.id)} />
                    {/* `data-label` is what lets a row become a card under
                        768px: with no table head above it, each figure has to
                        carry the column name it came from. Inert on a desk,
                        where the head is still doing that job. */}
                    <td className="dr-num" data-label="Rating"><span className="dr-star">★</span> {fmt(d.rating, 1)}</td>
                    <td className="dr-num" data-label="Trips">{fmt(d.trips)}</td>
                    <td className="dr-num" data-label="Tonnes">{fmt(d.tonnes, 1)}</td>
                    <td className="dr-num" data-label="Mileage">{fmt(d.mileageKm)}</td>
                    {/* Incidents carry a DOT as well as a colour. Red-on-amber
                        is exactly the pair a red-green dichromat cannot
                        separate, and these two columns sit side by side. The
                        marker says "there is something here" without asking
                        the reader to name the hue. */}
                    <IncidentCell n={d.fuelTheftCases} tone="theft" label="Fuel theft" />
                    <IncidentCell n={d.overspeedingCases} tone="speed" label="Overspeed" />
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={10} className="dr-grid__empty">No drivers match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* `.sp4-table-more`: the buttons centred under the last row, with the
            tally beside them — the one fact the pager carried that is worth
            keeping is how much of the roster is on screen.

            "Load less" appears only once the list has been grown, and gives
            back exactly one step, so the two controls are each other's undo
            rather than one growing by a step and the other collapsing the lot.
            It disappears again at one step, which is where it came in.

            The three sit together in the middle — "Load less · 30 of 549 ·
            Load more" — rather than a button pinned to each end of the row:
            the tally is what both buttons act on, and it reads as one sentence
            with them beside it. */}
        {(rest > 0 || grown) && (
          <div className="dr-grid-more">
            {grown && (
              <button
                type="button"
                className="dr-morebtn dr-morebtn--less"
                onClick={() => setShown((n) => Math.max(step, Math.max(n, step) - step))}
              >
                Load less
              </button>
            )}
            <span className="dr-grid-more__count">
              {fmt(pageRows.length)} of {fmt(sorted.length)}
            </span>
            {rest > 0 && (
              <button
                type="button"
                className="dr-morebtn dr-morebtn--more"
                onClick={() => setShown((n) => Math.max(n, step) + step)}
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}


function GridChip({ label, active, onClick, color }) {
  return (
    <button
      className={`dr-chip${active ? " dr-chip--active" : ""}`}
      style={active && color ? { background: `${color}22`, borderColor: `${color}66`, color } : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function GridTh({ label, k, sortKey, dir, onClick, num }) {
  const active = sortKey === k;
  return (
    <th
      className={num ? "dr-num" : undefined}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {/* A real button, not a th with onClick. Sorting is this grid's second
          interaction after selection, and it was reachable only by mouse.
          aria-sort goes on the header cell, where a screen reader looks for it. */}
      <button type="button" className="dr-grid__sort" onClick={() => onClick(k)}
              title={`Sort by ${label.toLowerCase()}`}>
        <span>{label}</span>
        {/* Drawn in CSS rather than ▲/▼: those sit on a different baseline in
            every fallback font and drift against the label. */}
        <span className={"dr-caret" + (active ? ` dr-caret--${dir}` : "")} aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * The unit this driver is on.
 *
 * The registration from their most recent trip — the truck they actually got
 * into — and where the roster holds no trip for them, the unit they are
 * POSTED to, which the server hands over as `vehicleFrom: 'assignment'`. A
 * driver who has not driven inside the history the payload covers is not a
 * driver on no lorry, and a column of em-dashes down the night shift is worse
 * than the weaker fact, so the weaker fact is shown and marked: dimmer, with
 * the distinction in the title rather than in a second line of type.
 *
 * An em-dash is left for the case where the data genuinely has no answer —
 * neither a trip nor a posting, or a server that predates the field. That is
 * a roster gap to be filled by attaching a vehicle to the driver, not by this
 * page inventing a plate for them.
 */
function VehicleCell({ plate, from }) {
  if (!plate) {
    return (
      <td className="dr-veh dr-veh--none" data-label="Vehicle" title="No trip on record and no vehicle assigned">
        —
      </td>
    );
  }
  const posted = from === "assignment";
  return (
    <td
      className={`dr-veh${posted ? " dr-veh--posted" : ""}`}
      data-label="Vehicle"
      title={posted ? "Assigned to this unit — no trip on record yet" : "Last unit driven"}
    >
      {plate}
    </td>
  );
}

/**
 * The active window, or an honest blank.
 *
 * The count of active days rides in the title rather than in the cell: two
 * dates already tell the reader where the row sits in the quarter, and a third
 * figure in the same cell would be the only column here carrying two numbers.
 */
function PeriodCell({ w }) {
  if (!w) return <td className="dr-when dr-when--none" data-label="Period">No activity</td>;
  return (
    <td className="dr-when" data-label="Period" title={`${w.days} active day${w.days === 1 ? "" : "s"} in the last 90`}>
      {w.label}
    </td>
  );
}

/** A count that is zero, or a count that wants attention. */
function IncidentCell({ n, tone, label }) {
  if (!n) return <td className="dr-num dr-num--zero" data-label={label}>0</td>;
  return (
    <td className={`dr-num dr-incident dr-incident--${tone}`} data-label={label}>
      <span className="dr-incident__dot" aria-hidden="true" />
      {fmt(n)}
    </td>
  );
}


// Selected-driver trend as a stat chart - muted title + trend delta pill, big
// total value, a sub caption, and a daily chart underneath.
//
// The card's own headline IS the chart's readout. Moving the cursor over the
// line rewrites the value and the caption in place rather than floating a
// tooltip over the plot: the number is already set in the size the card wants
// it read at, the caption row already exists, and nothing moves when the
// pointer does. A tooltip would have been a second, smaller copy of both.
function TrendStat({ title, series, valueKey, unit, value, tone, type, sub, loading }) {
  const deltaPct = periodDelta(series.map((s) => s[valueKey]));
  const up = (deltaPct ?? 0) >= 0;
  const [cursor, setCursor] = useState(null);

  const at = cursor != null && series[cursor] ? series[cursor] : null;
  const decimals = unit === "t" ? 1 : 0;

  return (
    <div className={`dr-card dr-statchart dr-statchart--${tone}`}>
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">{title}</span>
        {deltaPct != null && (
          <span className={`dr-statchart__delta ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className={"dr-statchart__value" + (at ? " dr-statchart__value--reading" : "")}>
        {at ? fmt(at[valueKey], decimals) : value}
        {unit && <span className="dr-statchart__unit"> {unit}</span>}
      </div>
      <div className="dr-statchart__sub">{at ? `${fmtDay(at.day)} · one day` : sub}</div>
      {type === "line" ? (
        <TrendLine
          series={series} valueKey={valueKey} unit={unit} title={title}
          decimals={decimals} loading={loading} cursor={cursor} onCursor={setCursor}
        />
      ) : (
        <TrendMini series={series} valueKey={valueKey} unit={unit} loading={loading} />
      )}
    </div>
  );
}

/* Monotone cubic interpolation (Fritsch-Carlson).
 *
 * Not Catmull-Rom, which is the usual reach for "make the line smooth": it
 * overshoots between points, and on a series that touches zero - which an idle
 * day does, most weeks - the overshoot dips the curve and its area fill BELOW
 * the baseline. A distance chart that draws negative kilometres is worse than
 * a jagged one. Monotone cubic is smooth and cannot overshoot: between two
 * samples the curve stays between their two values. */
function smoothPath(pts) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;

  const dx = [], slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  // Tangents: zero at every local extremum (that is what kills the overshoot),
  // a weighted harmonic mean of the neighbouring slopes everywhere else.
  const m = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  m[n - 1] = slope[n - 2];

  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h}` +
         ` ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h}` +
         ` ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/* The plot's aspect ratio IS the card's height, because the SVG scales
 * uniformly (height:auto) — so this ratio is what has to agree with Analytics,
 * not a pixel height. .an-kpi__spark measures 115px inside a 324px card at
 * 1440; 264/84 lands the same plot at 116px there and 97px on a phone. At the
 * 96 it was, the chart came out 130px and made every card in the row 14px
 * taller than the KPI tiles it sits under on the next tab. */
/* The plot is PAD_T..H-PAD_B, and only the bottom band has changed: 84/15
   became 73/4, so `base` is still 69 and every point, bar and crosshair lands
   exactly where it did. What went is the 11 units under the baseline that
   existed to seat two date ticks, which is ~11px of card height at this
   chart's width — on a four-up row of equal-height cards, off all four.
   4 rather than 0 because a marker sitting on the baseline has r=3.2. */
const CHART = { W: 264, H: 73, PAD_X: 7, PAD_T: 10, PAD_B: 4 };

// Per-day mileage as a smooth, readable line.
function TrendLine({ series, valueKey, unit, title, decimals, loading, cursor, onCursor }) {
  // useId, not a module counter: a duplicated gradient id would make the second
  // chart's fill resolve to the first one's stops.
  const gid = useId();

  if (loading) return <div className="dr-chart__empty" aria-busy="true">Loading…</div>;
  if (!series || series.length === 0) return <div className="dr-chart__empty">No activity in window</div>;
  // A series of nothing but zeros draws a flat line pinned to the axis inside a
  // full-height plot — a 110px box holding one horizontal rule. Say it instead.
  if (series.every((s) => !s[valueKey])) return <div className="dr-chart__empty">Nothing recorded in this window</div>;

  const { W, H, PAD_X, PAD_T, PAD_B } = CHART;
  const n = series.length;
  const step = n > 1 ? (W - PAD_X * 2) / (n - 1) : 0;
  const max = Math.max(1, ...series.map((s) => s[valueKey]));
  const base = H - PAD_B;
  const xOf = (i) => (n > 1 ? PAD_X + i * step : W / 2);
  const yOf = (v) => PAD_T + (1 - v / max) * (base - PAD_T);

  const pts = series.map((s, i) => [xOf(i), yOf(s[valueKey])]);
  const line = smoothPath(pts);
  const area = n > 1 ? `${line} L${xOf(n - 1)},${base} L${xOf(0)},${base} Z` : "";

  const clamp = (i) => Math.max(0, Math.min(n - 1, i));
  const pick = (e) => {
    if (n < 2) return onCursor(0);
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return undefined;
    // Client px -> viewBox units. The SVG scales uniformly, so one ratio does it.
    const vx = ((e.clientX - box.left) / box.width) * W;
    return onCursor(clamp(Math.round((vx - PAD_X) / step)));
  };
  const onKeyDown = (e) => {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (move === undefined) {
      if (e.key === "Escape") onCursor(null);
      return;
    }
    e.preventDefault();
    onCursor(clamp((cursor ?? n - 1) + move));
  };

  const read = cursor != null && series[cursor];

  return (
    /* Focusable and arrow-driven, not hover-only. This is the one chart on the
       page carrying a per-day number, and a pointer was the only way to get at
       it. role=img with a label so a screen reader is told the shape rather
       than handed thirty unlabelled path nodes. */
    <svg
      className={"dr-spark" + (read ? " dr-spark--reading" : "")}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      tabIndex={0}
      /* The window's dates live here now rather than under the plot. They were
         two 7.5px ticks that never changed while the cursor moved and cost the
         card the band they sat in; the day a reader actually wants is the one
         under the pointer, and that is written into the caption above in the
         size the card sets its numbers. Nothing is lost to a screen reader. */
      aria-label={`${title} by day, ${fmtDay(series[0].day)} to ${fmtDay(series.at(-1).day)}. ${n} day${n === 1 ? "" : "s"}, highest ${fmt(max, decimals)} ${unit}. Arrow keys read each day.`}
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => onCursor(null)}
      onFocus={() => onCursor((c) => (c == null ? n - 1 : c))}
      onBlur={() => onCursor(null)}
      onKeyDown={onKeyDown}
    >
      <defs>
        <linearGradient id={`dr-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="dr-spark__stop-a" />
          <stop offset="100%" className="dr-spark__stop-b" />
        </linearGradient>
      </defs>

      <line className="dr-spark__base" x1={PAD_X} y1={base} x2={W - PAD_X} y2={base} />
      {area && <path className="dr-spark__area" d={area} fill={`url(#dr-fill-${gid})`} />}
      {/* non-scaling-stroke so the line is the same weight at every card width -
          the SVG is laid out fluid and would otherwise thin out on a phone. */}
      <path className="dr-spark__line" d={line} vectorEffect="non-scaling-stroke" />
      {n === 1 && <circle className="dr-spark__marker" cx={xOf(0)} cy={pts[0][1]} r="3" />}

      {read && (
        <g className="dr-spark__cursor">
          <line
            className="dr-spark__crosshair" vectorEffect="non-scaling-stroke"
            x1={pts[cursor][0]} y1={PAD_T - 5} x2={pts[cursor][0]} y2={base}
          />
          <circle className="dr-spark__marker" cx={pts[cursor][0]} cy={pts[cursor][1]} r="3.2" />
        </g>
      )}
    </svg>
  );
}

// Per-day tonnes as bars. A bar carries its own hit target and its <title>
// answers "which day", which is why this one needed no cursor of its own — and
// why the date ticks came off it too.
function TrendMini({ series, valueKey, unit, loading }) {
  if (loading) return <div className="dr-chart__empty" aria-busy="true">Loading…</div>;
  if (!series || series.length === 0) return <div className="dr-chart__empty">No activity in window</div>;
  // Every bar zero-height is an empty box, not a chart. Same call as TrendLine.
  if (series.every((s) => !s[valueKey])) return <div className="dr-chart__empty">Nothing recorded in this window</div>;
  const { W, H, PAD_X, PAD_T, PAD_B } = CHART;
  const n = series.length;
  const stepX = (W - PAD_X * 2) / n;
  const base = H - PAD_B;
  const max = Math.max(1, ...series.map((s) => s[valueKey]));

  return (
    <svg className="dr-spark" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`${fmt(n)} days of tonnage, ${fmtDay(series[0].day)} to ${fmtDay(series.at(-1).day)}, highest ${fmt(max, 1)} ${unit}. Each bar names its own day.`}>
      <line className="dr-spark__base" x1={PAD_X} y1={base} x2={W - PAD_X} y2={base} />
      {series.map((s, i) => {
        const bh = (s[valueKey] / max) * (base - PAD_T);
        return (
          <rect
            key={i} className="dr-spark__bar"
            x={PAD_X + i * stepX + 0.5} y={base - bh}
            width={Math.max(1, stepX - 1.5)} height={bh} rx="1.5"
          >
            <title>{fmtDay(s.day)}: {fmt(s[valueKey], unit === "t" ? 1 : 0)} {unit}</title>
          </rect>
        );
      })}
    </svg>
  );
}