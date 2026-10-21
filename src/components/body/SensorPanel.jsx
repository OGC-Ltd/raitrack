// SensorPanel.jsx — Sensor Monitor
// Updated 2026-08-07: search, time filter, engine filter, view on map

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useAppActions } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import IncidentReport, { SORTS as INCIDENT_SORTS } from "./IncidentReport";
import { rangeFor } from "../../lib/analyticsFilter";
import {
  getSpeedingSummary, getSpeedingIncidents, getSpeedingInsights,
  getFaultSummary, getFaultEpisodes, getFaultInsights,
  durationLabel, distanceLabel, whenLabel, faultLabel,
  faultSensor, faultSensors, coordLabel, motionLabel,
  dateLabel, timeLabel,
} from "../../api/incidents";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useSensorHealth } from "../../hooks/useSensorHealth";
// Fetched here rather than inside the panel so the tab strip can carry the
// fault count — a count you only see after opening the tab is a count nobody
// reads. Both the badge and the panel read this one object.
import { useProbeHealth } from "../../hooks/useProbeHealth";
import { useFuelEvents, fleetDayKey } from "../../hooks/useFuelEvents";
import { useVehicleTelemetry } from "../../hooks/useVehicleTelemetry";
import { useWindowTelemetry } from "../../hooks/useWindowTelemetry";
import { readingCoverage } from "../../lib/vehicleReadings";
import { downloadTableCsv, downloadTablePdf } from "../../utils/tableExport";
import TableToolbar from "./TableToolbar";
import TablePager, { usePager, PAGE_STEP } from "./TablePager";
import FilterBar from "./FilterBar";
// The HISTORICAL view of the same probes. The grid below renders the live
// snapshot and structurally cannot say when a channel stopped — see the panel.
import ProbeHealthPanel, { ProbeReportActions } from "./ProbeHealthPanel";
import RepairJobsPanel from "./RepairJobsPanel";
import RepairTrackingLine from "./RepairTrackingLine";
import { latestRepairForVehicle, mayWorkJob } from "../../api/repairs";
import { faultAction } from "../../api/probeHealth";
import { usePermissions } from "../../hooks/usePermissions";
import { useOpenRepairs } from "../../hooks/useOpenRepairs";
import { restoreChoice, persistChoice } from "../../lib/navMemory";
import { watchTableLabels } from "../../lib/tableLabels";
import EmptyNote from "../shared/EmptyNote";
import DetailSidebar, { DetailSidebarIdent } from "../shared/DetailSidebar";
import "./SensorPanel.css";

/* Every tab this build has, and where the choice is stored. The allow-list is
   what stops a key written by an older build — or one since renamed — from
   reaching a `find` that returns undefined. */
const SENSOR_TABS   = ["probes", "fuel", "speed", "malfunction", "repairs"];
const SENSOR_TAB_KEY = "ft-sensor-tab";

// ── Sensor columns ─────────────────────────────────────────────────────────────
const SENSOR_COLUMNS = [
  { key: "capturedAt", label: "Time",        format: v => { if (!v) return "-"; const d = new Date(v); const p = n => String(n).padStart(2,"0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }, flag: () => false },
  { key: "speedKmh",   label: "Speed (km/h)",format: v => v != null ? Math.round(v) : "-", flag: (v, r) => v != null && v > 5 && r.engineOn === false },
  { key: "engineOn",   label: "Engine",      format: v => v == null ? "-" : v ? "ON" : "OFF", flag: () => false },
  { key: "fuelLevelMl",label: "Fuel (L)",    format: v => v != null ? (v/1000).toFixed(1) : "-", flag: v => v != null && v < 20000 },
];

const ANOMALY_META = {
  signal_lost:        { icon: "📡", color: "#8b5cf6", type: "malfunction" },
  /**
   * These two are MALFUNCTIONS, not speeding.
   *
   * They were typed "speed" — which is why "units with their sensors offline
   * while in transit" rendered on the Speed tab, alongside nothing that was
   * actually about going too fast. Both are a sensor contradicting itself: the
   * unit reports motion while its ignition line says the engine is off. The
   * Speed tab now holds overspeeding incidents and nothing else.
   */
  speed_no_engine:    { icon: "⚡", color: "#ef4444", type: "malfunction" },
  transit_no_engine:  { icon: "🚛", color: "#ef4444", type: "malfunction" },
  fuel_anomaly:       { icon: "⛽", color: "#f59e0b", type: "fuel"        },
  frozen_gps:         { icon: "🛰", color: "#06b6d4", type: "malfunction" },
  low_accuracy:       { icon: "📍", color: "#f59e0b", type: "malfunction" },
  /**
   * A vehicle with no tracker bound is NOT a malfunction, and counting it as
   * one was making this panel report a number nobody could act on.
   *
   * Measured against Sukari on 2026-08-10, cross-checked against the Wialon
   * account itself: of 597 active vehicles, 284 carry a `wialon:<id>` device
   * and every one of those 284 exists among the account's 1,504 units and has
   * reported telemetry. The remaining 313 carry a UUID device id, appear in
   * Wialon zero times, and have never sent a single ping. They are registry
   * rows without a tracker — a COVERAGE gap, not a fault.
   *
   * Those 313 were 77% of the Malfunction tab's 407 rows, so the tab read
   * 407 when the number of units actually reporting something wrong was 94.
   * `coverage` keeps them out of that count; the panel's Coverage KPI is where
   * the 284-of-597 story already lives.
   */
  no_tracker:         { icon: "🚫", color: "#64748b", type: "coverage"    },
};

/* EXPORT_CHOICES is gone with the header's "Download PDF" menu.
 *
 * That menu exported the FULL monitored fleet and said so in the subtitle —
 * "on-screen filters not applied" — because honouring four tables' filters
 * from one place would have meant re-implementing four predicates that could
 * drift out of step with the tables they claimed to mirror. The honest label
 * did not make it a useful document: the reader who has just filtered to nine
 * units does not want 284, and there was no way to ask for the nine.
 *
 * So the export moved down to the tabs, which already hold their filtered
 * rows, and each one carries the same Refresh · CSV · PDF bar the probes tab
 * has always had. See TableToolbar and utils/tableExport.
 */

const TIME_FILTERS = [
  { key: "all",  label: "All"    },
  { key: "15",   label: "15 min" },
  { key: "30",   label: "30 min" },
  { key: "45",   label: "45 min" },
  { key: "60",   label: "1 hr"   },
];

const ENGINE_FILTERS = [
  { key: "all",  label: "All"        },
  { key: "on",   label: "Engine ON"  },
  { key: "off",  label: "Engine OFF" },
];

/* The PROBES column table is gone with the header's PDF export.
 *
 * It was the last reader of it. The live probe GRID it once described was
 * replaced by ProbeHealthPanel — which answers "is this channel working", not
 * just "what does it read now" — and the only thing still walking these
 * definitions was the whole-fleet PDF above. The probes tab exports through
 * utils/probeReport.js, whose nineteen columns are a superset of these seven,
 * so nothing was left for this table to say.
 */



// 20 by default. The grid is sorted worst-first, so page 1 is the units that
// need attention — paging is for working through the tail, not for finding the
// problems, and a page that fits on screen without scrolling is worth more here
// than a longer one.

/** How long ago a unit last said anything, in the compact form used elsewhere. */
// ── View on map button ─────────────────────────────────────────────────────────
function ViewOnMapBtn({ vehicleId, vehicleName }) {
  const { can } = usePermissions();
  const { setDesktopActiveTab, setPendingFocusId } = useAppActions();
  if (!can("map:read")) return null;

  return (
    <button
      className="sp4-map-btn"
      title={"View " + vehicleName + " on map"}
      onClick={e => {
        e.stopPropagation();
        setDesktopActiveTab("fleet");        // switch to map tab
        setPendingFocusId(vehicleId);        // FleetMap will zoom + pan to this vehicle
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11" />
      </svg>
      Map
    </button>
  );
}

// ── Fuel FSL table ─────────────────────────────────────────────────────────────
// ── FSL verdicts, as the server decided them ────────────────────────────────
// The vocabulary changed on 2026-08-11: the server no longer has LOSS or
// UNVERIFIED verdicts. What happened to the fuel is now one of REFILL, DRAIN or
// REDISTRIBUTION, and how sure we are rides alongside as `confirmed` rather
// than replacing the description. See modules/fuel/fuel-adjudication.
//
// Three colours, one meaning each:
//
//   RED    a suspicious drain — fuel went down and did not come back
//   AMBER  undulation — the level moved and returned, so nothing left the tank
//   GREEN  a refill — fuel went IN
//
// Every drain is red, confirmed or not. The confirmed/unconfirmed split still
// exists on the server and still decides how loudly a drain is announced, but
// it is not a colour here: whether our telemetry happened to be watching that
// vehicle says something about our coverage, not about the fuel, and a softer
// colour invited the unconfirmed ones to be read as less serious.
const FSL_STATUS = {
  loss:       "Suspicious drain",
  open:       "Settling",
  undulating: "Undulating",
  refill:     "Refill",
};
const FSL_PILL = {
  loss:       "sp4-pill--inc",    // red
  open:       "sp4-pill--none",   // grey — no verdict yet, so no colour
  undulating: "sp4-pill--warn",   // amber
  refill:     "sp4-pill--con",    // green
};

/**
 * Which colour a transmission chip takes. See FSL_STATUS above.
 *
 * The SIGN decides first, and nothing downstream may override it. A chip
 * reading "-27.7L" was once drawn green, because the server had given that
 * drain a REFILL verdict — its recovery window had been closed by "fillings"
 * that were the same oscillating probe. The server no longer does that, but a
 * colour contradicting the number beside it is the kind of thing that must be
 * impossible rather than merely fixed: green means fuel arrived, and a negative
 * volume cannot mean that whatever any verdict says.
 */
function chipKind(e) {
  // Green means fuel ARRIVED. A filling our own levels contradict did not, so
  // it takes undulation's amber rather than a refill's green — the tank is no
  // fuller and nothing was delivered.
  if (e.type === "refill") return e.verdict === "REDISTRIBUTION" ? "settled" : "refill";
  // Everything below is a reported DROP, so it can never be green.
  if (e.verdict === "REDISTRIBUTION") return "settled";                 // amber, it came back
  if (e.verdict === "DRAIN")          return "drain";                   // red, always
  return "open";                                       // PENDING / SENSOR_FAULT
}

function chipTitle(e) {
  const when = e.atIso ? new Date(e.atIso).toLocaleString() : "";
  if (e.type === "refill") {
    const seen = e.observedMl != null ? ` · our levels saw ${(e.observedMl / 1000).toFixed(1)} L arrive` : "";
    if (e.verdict === "REDISTRIBUTION")
      return `Undulating, fuel was reported added and the tank is no fuller${seen} · ${when}`;
    if (e.confirmed) return `Refill, confirmed by our own levels${seen} · ${when}`;
    return `Refill, reported by the tracker, no telemetry to confirm it · ${when}`;
  }
  // Only when the figure would actually read as a volume. A handful of
  // REDISTRIBUTION rows recovered tens of MILLILITRES against a claim of tens
  // of litres (KTCC 850B: 19 ml against 25.8 L) — the adjudicator judged a
  // recovery ratio against a drop our own telemetry barely saw, so the verdict
  // is thinner than it looks. Rendering that as "0.0 L came back" beside "the
  // level recovered" hands the reader a contradiction and hides the real
  // problem, which is a server-side one.
  const back = e.recoveredMl >= 50 ? ` · ${(e.recoveredMl / 1000).toFixed(1)} L came back` : "";
  // Never "loss", "theft" or "stolen". The probe sees a level fall; it does not
  // see where the fuel went, and the old wording decided that for the reader.
  //
  // The confirmed/unconfirmed split is not a colour any more, but it belongs in
  // the TOOLTIP: someone deciding whether to act on a specific row should be
  // able to see whether our own readings showed the fall or we are repeating
  // the tracker.
  const verdict = e.verdict === "DRAIN"
    ? (e.confirmed
        ? "Suspicious drain, our own readings show it went down and stayed down"
        : "Suspicious drain, reported by the tracker, our readings could not check it")
    : {
        REDISTRIBUTION: "Undulating, the level came back, the fuel never left the tank",
        REFILL:         "A refill explains it, fuel went in",
        SENSOR_FAULT:   "The fuel probe failed, not a tank event",
        PENDING:        "Too recent to judge (settling)",
      }[e.verdict] ?? "No verdict recorded";
  return `${verdict}${back} · ${when}`;
}

/** "2 suspicious drains · 1 undulating (27.8 L back) · 3 refills" */
function splitTitle(s) {
  if (!s) return undefined;
  return [
    s.loss    ? `${s.loss} suspicious drain${s.loss === 1 ? "" : "s"}` : null,
    s.settled ? `${s.settled} undulating${s.recoveredL ? ` (${s.recoveredL} L back)` : ""}` : null,
    s.refill  ? `${s.refill} refill${s.refill === 1 ? "" : "s"}` : null,
    s.open    ? `${s.open} settling` : null,
  ].filter(Boolean).join(" · ") || undefined;
}

// `flagged`/`loading`/`error` arrive as props rather than from useFuelEvents
// here: the panel above needs the same rows to put them in the PDF, and that
// hook has no cache — calling it in both places would fire the fillings and
// thefts requests twice over, against a 100 req/60s limit.
function FuelTable({ flagged, tankState = {}, day, loading, error, onReload, vehicles, search, timeFilter, engineFilter, fuelFilter, onSelect, selectedId }) {
  const dayLabel = !day || day === fleetDayKey() ? "today" : day;
  const pad = n => String(n).padStart(2, "0");
  const fmtTime = iso => { if (!iso) return "-"; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const plateFor    = vehicleId => vehicles.find(v => v.vehicleId === vehicleId || v.id === vehicleId)?.id ?? vehicleId.slice(0,8) + "…";
  const engineFor   = vehicleId => { const v = vehicles.find(x => x.vehicleId === vehicleId || x.id === vehicleId); return v?.engine === 'on'; };
  /**
   * The tank pair and the working turbulence, from the server's fuel-tank-state.
   *
   * INITIAL is the PREVIOUS day's closing level and CURRENT is this day's —
   * the latest reading, when the day is today. Their difference is what the
   * tank fell by over the day, and because one day's Current is the next day's
   * Initial the column reconciles down a week without gaps.
   *
   * On a day carrying a refuel the difference is NOT what the machine burned:
   * fuel went in as well as out, and it reads negative. The refill chips beside
   * it are the other half of that story.
   *
   * TURBULENCE is how far the level ranged per half hour WHILE WORKING, which
   * describes ground and load; the PARKED equivalent is what the drain trust
   * gate uses to decide whether a probe can be believed at all.
   *
   * Blank rather than zero when unknown. A vehicle that reported nothing the
   * previous day has no opening balance, and an invented zero would report a
   * whole tank as consumed.
   */
  const L = ml => ml == null ? "" : `${Math.round(ml / 1000)} L`;
  const tankFor       = vehicleId => L(tankState[vehicleId]?.initialMl);
  const currentFor    = vehicleId => L(tankState[vehicleId]?.currentMl);
  /** Ground covered today. Blank, not 0, when the unit sent no positions. */
  const mileageFor = vehicleId => {
    const m = tankState[vehicleId]?.distanceM;
    return m == null ? "" : `${(m / 1000).toFixed(1)} km`;
  };
  /**
   * TWO expectations, on two different drivers, deliberately side by side.
   *
   * "Expected (km)" is distance ÷ 2 km/L. "Expected (hrs)" is engine hours ×
   * the rate measured on that unit. Neither is a measurement and neither is
   * derived from the other — Initial−Current is what the tank actually did,
   * and the gaps are the question worth asking.
   *
   * The km one diverges hard on plant: a dozer burns fuel while covering
   * almost no ground, so it reads near zero against a real shift. That is why
   * the hours one exists and why both are shown rather than one replacing the
   * other — a truck where they disagree is interesting, a dozer where they
   * disagree is just a dozer.
   *
   * This column was labelled "Engine burn" when it was the only one. It is the
   * DISTANCE expectation and is now named so, because the server has a field
   * called engineBurnMl that means the other thing.
   */
  const distanceBurnFor = vehicleId => {
    const ml = tankState[vehicleId]?.expectedBurnMl;
    return ml == null ? "" : `${(ml / 1000).toFixed(1)} L`;
  };
  /**
   * The unit's ENGINE-HOUR METER at the close of the day — its own cumulative
   * counter, the way an odometer reads.
   *
   * The final reading for the day, matching Current for fuel. NOT the hours it
   * ran today: that is a duration, it lives behind the Expected (hrs) tooltip,
   * and only the duration can be multiplied by a rate.
   *
   * Blank for the roughly one unit in four whose tracker never reports the
   * counter — a 0 there would read as a brand-new machine.
   */
  const engineHoursFor = vehicleId => {
    const s = tankState[vehicleId]?.engineSeconds;
    if (s == null) return "";
    // h:mm:ss, which is how the operator reads it off the provider's report —
    // "2:16:16", not "2.3 h". Decimal hours hid a real error: the figure was
    // 11 minutes out and rounded to the same 2.3 either way.
    const pad = n => String(n).padStart(2, "0");
    return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.round(s % 60))}`;
  };
  const engineHoursTitle = vehicleId => {
    const t = tankState[vehicleId];
    if (!t) return undefined;
    if (t.engineSeconds == null) {
      return "Running time could not be established, this unit's tracker reports no "
        + "engine-hour counter, and its ignition flag is contradicted by the fact that "
        + "it moved. Blank rather than 0, which would read as a machine that never ran.";
    }
    const meter = t.engineHoursMeter == null ? ""
      : ` The unit's counter stood at ${t.engineHoursMeter.toFixed(1)} h at the close of the day.`;
    return `Time the engine ran that day, from the machine's own engine-hour counter.${meter}`;
  };
  const turbulenceFor = vehicleId => {
    const t = tankState[vehicleId]?.turbulenceMl;
    return t == null ? "" : `±${(t / 1000).toFixed(1)} L`;
  };
  /**
   * How much the turbulence figure is standing on. A mean over one moving
   * half-hour is not the same claim as one over eight, and the number alone
   * cannot say which it is.
   */
  const turbulenceTitle = vehicleId => {
    const w = tankState[vehicleId]?.stopsAveraged;
    if (!w) return undefined;
    return `Moving average of per-run slosh, over the last ${w} stop${w === 1 ? "" : "s"}. `
      + "A run is the motion between two stops; its slosh is the mean level swing per half hour "
      + "while moving. Fuel shifting inside the tank, not entering or leaving it, "
      + "trend only, never used to judge a drain.";
  };

  const filtered = flagged.filter(row => {
    const plate = plateFor(row.vehicleId);
    if (search && !plate.toLowerCase().includes(search.toLowerCase())) return false;
    if (engineFilter !== "all") {
      const eng = engineFor(row.vehicleId);
      if (engineFilter === "on"  && eng !== true)  return false;
      if (engineFilter === "off" && eng !== false) return false;
    }
    if (timeFilter !== "all") {
      const latestEvent = row.events[row.events.length - 1];
      const eventAt = latestEvent?.at ?? 0;
      if (!eventAt || Date.now() - eventAt > parseInt(timeFilter) * 60000) return false;
    }
    // Fuel-specific filters
    if (fuelFilter === "loss")       return row.status === "loss";
    if (fuelFilter === "undulating") return row.status === "undulating";
    if (fuelFilter === "has_drains") return row.drainCount > 0;
    return true;
  });

  /* The rows on screen, as a file. Thirteen columns render here; eleven go out
     — the FSL chip strip is a row of coloured pills whose meaning is the
     colour, and the trailing cell is a button. Both are spelled out instead:
     each transmission becomes a signed volume and a time, which is what the
     chip was showing, and the "View on map" column simply has no CSV form. */
  const pager = usePager(filtered, `${search}|${timeFilter}|${engineFilter}|${fuelFilter}|${day}`);
  const EXPORT_HEAD = [
    "Unit Reg", "Initial", "Current", "Mileage (km)", "Expected (km)", "Engine hrs",
    "Turbulence", "Recent FSL transmissions (last 5)", "Pattern", "Refills", "Drains", "Status",
  ];
  const exportBody = () => filtered.map(row => [
    plateFor(row.vehicleId),
    tankFor(row.vehicleId),
    currentFor(row.vehicleId),
    mileageFor(row.vehicleId),
    distanceBurnFor(row.vehicleId),
    engineHoursFor(row.vehicleId),
    turbulenceFor(row.vehicleId),
    row.events.slice(-5)
      .map(e => `${e.type === "refill" ? "+" : "-"}${e.litres ?? "?"}L ${fmtTime(e.atIso)}`)
      .join("; "),
    row.pattern,
    row.refillCount,
    row.drainCount,
    FSL_STATUS[row.status] ?? row.status,
  ]);
  const filterNote = `Fuel Sensor (FSL) events for ${dayLabel}`
    + (fuelFilter !== "all" ? ` · ${fuelFilter === "loss" ? "suspicious drains" : fuelFilter}` : "")
    + (search ? ` · matching "${search}"` : "");
  const exportSlug = `fuel-fsl-${day}` + (fuelFilter !== "all" ? `-${fuelFilter}` : "");

  return (
    <div className="sp4-table-scroll">
      {/* The caption and the export bar are one row, the same shape the probes
          tab has always had. Above the loading and error states deliberately:
          Refresh is the thing to reach for when the day failed to load, and a
          bar that disappears on failure takes the recovery with it. */}
      <TableToolbar
        summary={<><b>{filtered.length}</b> unit{filtered.length === 1 ? "" : "s"} with fuel events</>}
        note={filterNote}
        loading={loading}
        onReload={onReload}
        onCsv={() => downloadTableCsv({ head: EXPORT_HEAD, body: exportBody(), filenameSlug: exportSlug })}
        onPdf={() => downloadTablePdf({
          reportTitle: "Sensor Monitor: Fuel FSL",
          sectionTitle: `${filtered.length} unit${filtered.length === 1 ? "" : "s"} with fuel events`,
          filterNote,
          cards: [
            { label: "Units in report", value: String(filtered.length) },
            { label: "Refills",         value: String(filtered.reduce((n, r) => n + (r.refillCount ?? 0), 0)) },
            { label: "Drains",          value: String(filtered.reduce((n, r) => n + (r.drainCount ?? 0), 0)) },
          ],
          head: EXPORT_HEAD,
          body: exportBody(),
          filenameSlug: exportSlug,
        })}
        disabled={loading || !!error || !filtered.length}
      />

      {loading ? <div className="sp4-loading"><div className="sp4-spinner" />Loading fuel events…</div>
       : error ? <div className="sp4-error">⚠ {error}</div>
       : !filtered.length ? <div className="sp4-empty-tab">No fuel events match your filters</div>
       : (
      /* Its own sideways scroller, so the toolbar above stays put on a phone
         (`.sp4-keep-table`, SensorPanel.css). */
      <div className="sp4-keep-table">
      <table className="sp4-table">
        <thead>
          <tr>
            <th className="sp4-th--pin">Unit Reg</th>
            <th title="Closing fuel level of the previous day">Initial</th>
            <th title="Closing fuel level of this day, the latest reading, for today">Current</th>
            <th title="Ground covered today, summed from the position fixes">Mileage (km)</th>
            <th title="Fuel EXPECTED to have burned over that ground, at 2 km per litre. An expectation, not a measurement, and it reads near zero on plant, a dozer burns fuel while covering almost no ground. Compare against Initial minus Current.">Expected (km)</th>
            <th title="Time the engine ran that day, taken from the machine's own engine-hour counter, the same figure the provider reports. Blank when the tracker has no counter and the running time cannot be established.">Engine hrs</th>
            <th title="Moving average of per-run slosh, the level swing while moving, averaged over the last few stops. Trend only; never used to judge a drain.">Turbulence</th>
            <th>Recent FSL Transmissions (last 5)</th>
            <th>Pattern</th>
            <th>Refills</th>
            <th>Drains</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pager.pageRows.map((row, i) => {
            const plate = plateFor(row.vehicleId);
            const last5 = row.events.slice(-5);
            return (
              <tr key={i} className={"sp4-tr sp4-tr--fuel" + (selectedId === row.vehicleId ? " sp4-tr--selected" : "")} onClick={() => onSelect({ vehicleId: row.vehicleId, vehicleName: plate, type: "fuel_anomaly", detail: row.pattern, recordDay: day })}>
                <td className="sp4-reg sp4-td--pin">{plate}</td>
                <td className="sp4-tank">{tankFor(row.vehicleId)}</td>
                <td className="sp4-tank">{currentFor(row.vehicleId)}</td>
                <td className="sp4-tank">{mileageFor(row.vehicleId)}</td>
                <td className="sp4-tank">{distanceBurnFor(row.vehicleId)}</td>
                <td className="sp4-tank" title={engineHoursTitle(row.vehicleId)}>{engineHoursFor(row.vehicleId)}</td>
                <td className="sp4-tank" title={turbulenceTitle(row.vehicleId)}>{turbulenceFor(row.vehicleId)}</td>
                <td>
                  <div className="sp4-fsl-events">
                    {last5.map((e, j) => (
                      // A drain the server has cleared must not stay red — that
                      // colour is the whole reason the row read as an accusation.
                      <span key={j} className={"sp4-fsl-chip sp4-fsl-chip--" + chipKind(e)} title={chipTitle(e)}>
                        {e.type === "refill" ? "+" : "-"}{e.litres ?? "?"}L
                        <span className="sp4-fsl-time">{fmtTime(e.atIso)}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="sp4-muted">{row.pattern}</td>
                {/* The panel's ok / crit inks, not the dark theme's pastels: on
                    white #86efac and #fca5a5 read at ~1.6:1. Zero stays muted. */}
                <td className={"sp4-count" + (row.refillCount ? " sp4-count--ok" : "")}>{row.refillCount}</td>
                <td className={"sp4-count" + (row.drainCount ? " sp4-count--crit" : "")} title={splitTitle(row.verdictSplit)}>{row.drainCount}</td>
                <td><span className={"sp4-pill " + FSL_PILL[row.status]}>{FSL_STATUS[row.status]}</span></td>
                <td><ViewOnMapBtn vehicleId={plate} vehicleName={plate} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      )}
      {!loading && !error && <TablePager pager={pager} label="Fuel FSL pages" />}
    </div>
  );
}

/**
 * Loading placeholder shared by every tab in this panel.
 *
 * It exists because the alternative is worse than a spinner. Every tab here
 * derives from the same vehicles snapshot, which takes ~1.6 s against the live
 * fleet; until it lands, `anomalies` is an empty array. Speed and Malfunction
 * had no loading branch at all, so for that second and a half they rendered
 * "No speed anomalies match your filters" — an empty state is a CLAIM, and
 * that one was false. Then the data arrived and the tab jumped from "nothing
 * here" to 8 and 407 rows. That flash of a confident wrong answer is what
 * reads as a rendering delay; the wait itself is unremarkable.
 *
 * aria-busy + aria-live tell a screen reader the same thing the shimmer tells
 * a sighted user: this is not the answer yet.
 */
/**
 * Columns for the two incident reports.
 *
 * Declared here rather than inside the component so they are built once, not
 * on every render, and so the honesty rules live beside the values they
 * qualify — "policy limit", "peak observed", "at least this long".
 */
/**
 * The earliest month the incident ledgers can answer for.
 *
 * Capture began in September 2026; days before it are not quiet days, they are
 * outside the record. The day picker takes it as `min`, so the browser greys
 * those days out rather than letting a click return a structural zero — and
 * the report says the same thing in words if a window still reaches back past
 * the first recorded case.
 */
const INCIDENT_MIN_DAY = "2026-09-01";

const SPEED_SUMMARY_COLUMNS = [
  { key: "plate",  label: "Unit",   render: r => r.plate ?? r.vehicleId },
  { key: "cases",  label: "Cases",  numeric: true, render: r => r.incidents },
  { key: "days",   label: "Days",   numeric: true, title: "Distinct days with at least one case", render: r => r.days },
  { key: "peak",   label: "Peak speed", numeric: true, title: "Fastest speed OBSERVED, the true peak between two fixes is unknowable",
    render: r => `${Math.round(r.peakKmh)} km/h` },
  /* "+12" was a number with no unit anywhere on the row to borrow one from,
     sitting under a header that did not supply it either. Both halves fixed:
     the header says what it is over, the cell says what it is measured in. */
  { key: "over",   label: "Avg over limit", numeric: true, title: "Average amount over the fleet's policy limit, across this unit's cases",
    render: r => `+${Math.round(r.avgOverKmh)} km/h` },
  /* Was "Total" — total WHAT. It is the time this unit spent above the limit,
     summed over its cases in the window. */
  { key: "time",   label: "Time over limit", numeric: true, title: "Summed across every case. At least this long, both ends of a case are real fixes, so the true time is never shorter",
    render: r => durationLabel(r.totalSeconds) },
  { key: "last",   label: "Last case", render: r => whenLabel(r.lastAt) },
  /* Repeat or one-off, on the definition this codebase already uses for
     `repeatUnits` — two or more cases. No new threshold, and it is the
     distinction that decides whether anybody speaks to a driver: once may be
     bad luck, twice is a pattern. */
  { key: "status", label: "Status",
    title: "Repeat means two or more cases in the window, the same test the analysis strip used for repeat units",
    render: r => (r.incidents >= 2
      ? <span className="sp4-pill sp4-pill--warn">Repeat</span>
      : <span className="sp4-pill sp4-pill--none">One-off</span>),
    /* A pill is a colour and a word; a CSV cell can only carry the word. Every
       column whose `render` returns markup states its export text here rather
       than leaving the exporter to guess — see IncidentReport's `exportable`. */
    text: r => (r.incidents >= 2 ? "Repeat" : "One-off") },
  /* The row ends on the way to the map, as the fuel and malfunction rows do.
     Driver leaves the glance list: it is one name per UNIT here — the most
     recent case's — while a month of cases can have several drivers, so the
     column quietly implied an attribution the summary cannot make. The detail
     table keeps it, where it belongs to a single incident and is the driver
     who was actually assigned at that moment. */
  { key: "map", label: "",
    render: r => {
      const plate = r.plate ?? r.vehicleId;
      return <ViewOnMapBtn vehicleId={plate} vehicleName={plate} />;
    } },
];

const SPEED_DETAIL_COLUMNS = [
  { key: "started", label: "Started", render: r => whenLabel(r.startedAt) },
  { key: "for",     label: "Duration", numeric: true, title: "How long this case ran. At least this long, both ends are observed fixes",
    render: r => durationLabel(r.durationSec) },
  { key: "peak",    label: "Peak",    numeric: true, render: r => `${Math.round(r.peakKmh)} km/h` },
  { key: "limit",   label: "Policy limit", numeric: true,
    title: "The fleet's own limit for this machine type, NOT a posted road limit",
    render: r => `${Math.round(r.limitKmh)} km/h` },
  { key: "over",    label: "Over by", numeric: true, render: r => `+${Math.round(r.overByKmh)} km/h` },
  { key: "dist",    label: "Distance", numeric: true,
    title: "Blank when a fix was missing or the gap too long to measure across",
    render: r => distanceLabel(r.distanceM) },
  { key: "driver",  label: "Driver",  render: r => r.driverName ?? "-" },
  { key: "frames",  label: "Fixes",   numeric: true,
    title: "Over-limit fixes behind this case, how much evidence there is",
    render: r => r.frames },
];

const FAULT_SUMMARY_COLUMNS = [
  { key: "plate",  label: "Unit",     render: r => r.plate ?? r.vehicleId },
  /* The component, not the verdict. "Fuel probe dead" is what happened;
     "Fuel probe" is the part somebody has to go and look at, and it is what
     the workshop sorts by. A silent tracker takes every channel with it, so a
     row can name several. */
  { key: "sensor", label: "Sensor",   title: "The sensor affected. A unit with several faults lists each affected sensor once",
    render: r => faultSensors(r.kinds) },
  { key: "eps",    label: "Episodes", numeric: true, render: r => r.episodes },
  { key: "open",   label: "Still open", numeric: true, title: "Episodes with no recovery yet, unresolved at this moment, not merely at the end of the day shown",
    render: r => (r.openNow ? r.openNow : "-") },
  /* Both durations are CLIPPED to the chosen day. An episode that spans it —
     a unit dark for three weeks — contributes at most 24 hours here, because
     "faulty for 21 days" under a heading that says one day is not an answer to
     the question asked. The server does the clipping; see clippedSeconds. */
  { key: "total",  label: "Time faulty", numeric: true, title: "How long this unit was in a fault state on the day shown, summed across its episodes. An episode that began earlier counts only the part falling inside the day",
    render: r => durationLabel(r.totalSeconds) },
  { key: "worst",  label: "Longest episode", numeric: true, title: "The longest single unbroken episode, counted only within the day shown",
    render: r => durationLabel(r.longestSeconds) },
  { key: "kinds",  label: "Faults",
    /* Chips, not a comma-separated sentence — the same treatment the fuel
       table gives its FSL transmissions. A unit carrying four faults read as
       one long wrapped phrase in which no single fault could be picked out.
       `signal_lost` is coloured because every other verdict on a silent unit
       is downstream of it. */
    render: r => (r.kinds
      ? <span className="sp4-kind-chips">
          {r.kinds.split(",").map(k => (
            <span key={k} className={"sp4-kind-chip" + (k === "signal_lost" ? " sp4-kind-chip--silent" : "")}>
              {faultLabel(k)}
            </span>
          ))}
        </span>
      : "-"),
    text: r => (r.kinds ? r.kinds.split(",").map(faultLabel).join("; ") : "-") },
  /* Where the sensor was last working — the three columns that decide whether
     anyone drives out, and to where. Taken from this unit's most recent
     episode that has a position at all; all three are blank together when
     none does, because the fix behind an old episode is swept at 30 days.
     That is the whole reason the position is copied onto the episode when it
     opens rather than looked up now. */
  /* WHEN, split so each column says one thing — a column headed "Date" that
     prints a time is not a date column.

     Both read `lastAt`, the start of the most recent episode. That is the
     moment the row is already about, and it is populated for every episode
     ever written; the fix timestamp behind the coordinates is the more precise
     anchor but only exists on episodes opened after that capture shipped, so
     sourcing these from it would have left the columns empty on the whole
     existing ledger. `lastFixAt` is still recorded — see the model — and can
     be surfaced beside these the day the distinction matters. */
  { key: "fixdate", label: "Date",
    title: "Date the most recent episode on this unit began, on the fleet clock (EAT)",
    render: r => dateLabel(r.lastAt) },
  { key: "fixtime", label: "Timestamp",
    title: "Time that same episode began, on the fleet clock (EAT)",
    render: r => timeLabel(r.lastAt) },
  /* Coordinates live on the CHILD rows only. On the glance list they were a
     raw lat/lng pair per unit that nobody reads at a glance — the decoded
     Location beside them answers the same question in words, and the exact
     figures are one click away on the episode that actually carries them. */
  { key: "place",  label: "Location",
    title: "Those coordinates, reverse-geocoded. Blank while the lookup is still pending, the geocoder is rate-limited and runs behind the capture",
    render: r => r.lastPlace ?? "-" },
  { key: "motion", label: "Motion",
    title: "What the unit was doing at that fix. Blank means there was no fix to judge, which is not the same as parked",
    render: r => motionLabel(r.lastMoving, r.lastSpeedKmh) },
  /* The verdict, as a pill — the fuel table ends its data on one and these
     tables ended on nothing, which is most of why they read as a different
     grid. Straight from `openNow`, no threshold invented: a unit with an
     unrecovered episode is the one somebody has to do something about. */
  { key: "status", label: "Status",
    title: "Open while any episode on this unit is unrecovered; resolved once every one has closed",
    render: r => (r.openNow
      ? <span className="sp4-pill sp4-pill--warn">Open</span>
      : <span className="sp4-pill sp4-pill--con">Resolved</span>),
    text: r => (r.openNow ? "Open" : "Resolved") },
  /* The row ends where a fuel row ends: on the way to the map. "Last episode"
     printed the same moment the Date and Timestamp columns now carry between
     them, so it was a third restatement rather than a column. What the row
     could not do was take you to the unit. */
  { key: "map", label: "",
    render: r => {
      const plate = r.plate ?? r.vehicleId;
      return <ViewOnMapBtn vehicleId={plate} vehicleName={plate} />;
    } },
];

const FAULT_DETAIL_COLUMNS = [
  { key: "kind",      label: "Fault",     render: r => faultLabel(r.kind) },
  { key: "sensor",    label: "Sensor",    title: "The sensor this episode is about",
    render: r => faultSensor(r.kind) },
  { key: "started",   label: "Started",   render: r => whenLabel(r.startedAt) },
  /* The pair this screen exists for. "Ongoing" is not a missing value — it is
     a fault that has not been fixed, and the duration is counted from now. */
  { key: "recovered", label: "Recovered",
    render: r => (r.recoveredAt ? whenLabel(r.recoveredAt) : "ongoing") },
  { key: "for",       label: "Duration", numeric: true,
    title: "Start to recovery. An episode still open is counted from its start to now, which is why the figure grows while you watch it",
    render: r => (r.recoveredAt
      ? durationLabel(r.durationSec)
      : durationLabel((Date.now() - Date.parse(r.startedAt)) / 1000)) },
  { key: "detail",    label: "Detail",    render: r => r.detail },
  /* Exact here, where the summary's are "the most recent episode's": this row
     IS one episode, so these are the position and motion at the moment that
     particular sensor stopped. */
  { key: "coords",    label: "Coordinates",
    title: "Where the unit was when this sensor was last working",
    render: r => coordLabel(r.lastLat, r.lastLng) },
  { key: "place",     label: "Location",
    title: "Those coordinates, reverse-geocoded. Blank while the lookup is still pending",
    render: r => r.lastPlace ?? "-" },
  { key: "motion",    label: "Motion",
    title: "What the unit was doing at that fix. Blank means there was no fix to judge, which is not the same as parked",
    render: r => motionLabel(r.lastMoving, r.lastSpeedKmh) },
  /* "Seen by" printed the detector that opened the episode — `poller` or
     `sweep`. That is a fact about our own plumbing, not about the vehicle, and
     nobody reading a fault has a decision that turns on it. Removed. */
];

// The readings history pages like every other table (TablePager): fifteen.
const PAGE_SIZE = PAGE_STEP;

// ── Fuel drain detail panel ────────────────────────────────────────────────────
//
// Shown when a row in FuelTable is clicked. For each drain event on that
// vehicle it fetches telemetry for the drain window and checks whether the
// engine was off — the clearest theft signal available without backend changes.
//
// One telemetry fetch per drain event, fired only on demand (not upfront for
// every row). The window is beganAt-10min → detectedAt+15min so we see the
// engine state just before, during, and just after the drain.

// ── DrainIncidentRow ───────────────────────────────────────────────────────────
// One table row per drain event. Renders the Incident cell itself, then
// delegates the remaining three cells to DrainEngineCheck which has access
// to the telemetry window data needed to populate them.
function DrainIncidentRow({ drain, verdict, vehicleId, orgId, fmtTime, fmtLitres, rowKey, onLoadingChange }) {
  return (
    <tr className="sp4-incident-tr">
      {/* Col 1 — Incident */}
      <td className="sp4-incident-td sp4-incident-td--incident">
        <div className="sp4-incident-time">{fmtTime(drain.atIso)}</div>
        <div className="sp4-incident-vol">−{fmtLitres(drain.litres != null ? drain.litres * 1000 : null)}</div>
        {/* The server's verdict on this specific event. It was being computed
            by the caller and dropped on the floor, so the detail table showed
            a list of drops with no indication that half of them had been ruled
            undulation. */}
        {verdict && <div className={"sp4-verdict " + verdict.cls}>{verdict.text}</div>}
        {drain.location && (
          <div className="sp4-drain-row__loc" title={drain.location}>📍 {drain.location}</div>
        )}
      </td>
      {/* Cols 2-4 — Engine Status, Ping Coverage, Details (from telemetry) */}
      <DrainEngineCheck
        vehicleId={vehicleId} orgId={orgId} event={drain}
        rowKey={rowKey} onLoadingChange={onLoadingChange}
      />
    </tr>
  );
}

// ── PostRestartCheck ───────────────────────────────────────────────────────────
// Fetches 25 minutes of telemetry after engine restart and reports what
// happened to fuel: further drain, refill, or stable.
function PostRestartCheck({ vehicleId, orgId, restartMs, fmtHM }) {
  const fromMs = restartMs;
  const toMs   = restartMs + 25 * 60_000;
  const { pings, loading, error } = useWindowTelemetry(vehicleId, orgId, fromMs, toMs, 200);

  // A secondary line inside an already-loaded row. It resolves after the table
  // is on screen, so it stays silent until it has something to say rather than
  // adding a second spinner under the one the panel already showed.
  if (loading) return null;
  if (error || !pings.length) return null;

  const withFuel = pings.filter(p => p.fuelLevelMl != null).sort(
    (a, b) => new Date(a.capturedAt) - new Date(b.capturedAt)
  );
  if (withFuel.length < 2) return null;

  const firstFuel = withFuel[0].fuelLevelMl;
  const lastFuel  = withFuel[withFuel.length - 1].fuelLevelMl;
  const deltaL    = (lastFuel - firstFuel) / 1000;
  const fromTime  = fmtHM(withFuel[0].capturedAt);
  const toTime    = fmtHM(withFuel[withFuel.length - 1].capturedAt);

  let msg, cls;
  if (deltaL < -2) {
    msg = `Post-restart (${fromTime}–${toTime}): further drain of ${Math.abs(deltaL).toFixed(1)}L detected, possible continued theft.`;
    cls = "sp4-post-restart--drain";
  } else if (deltaL > 2) {
    msg = `Post-restart (${fromTime}–${toTime}): refill of +${deltaL.toFixed(1)}L recorded.`;
    cls = "sp4-post-restart--refill";
  } else {
    const levelPct = lastFuel != null ? ` Fuel level stable at ${(lastFuel / 1000).toFixed(1)}L.` : "";
    msg = `Post-restart (${fromTime}–${toTime}): fuel level stable.${levelPct}`;
    cls = "sp4-post-restart--stable";
  }

  return <div className={`sp4-post-restart ${cls}`}>{msg}</div>;
}

function DrainEngineCheck({ vehicleId, orgId, event, rowKey, onLoadingChange }) {
  const fromMs = event.at - 10 * 60_000;
  // Extended to +60min so we can detect engine restart even if it happens
  // well after the drain window closes. Engine-off analysis still uses only
  // pings within the drain window; the extra time is for restart detection only.
  const toMs   = event.at + 60 * 60_000;
  const { pings, loading, error } = useWindowTelemetry(vehicleId, orgId, fromMs, toMs, 500);

  const p2 = n => String(n).padStart(2, "0");
  const fmtHM = iso => {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };

  const emptyTds = (msg) => (
    <>
      <td className="sp4-incident-td"><span className="sp4-engine-check sp4-engine-check--unknown">{msg}</span></td>
      <td className="sp4-incident-td">-</td>
      <td className="sp4-incident-td">-</td>
    </>
  );

  // Each row owns its own telemetry fetch, so the parent cannot know when the
  // table as a whole is ready unless the rows say so. Reporting up is what
  // lets FuelDrainDetail show ONE spinner for the lot, the way All Probes
  // does, instead of every row narrating its own progress in its own cells.
  useEffect(() => { onLoadingChange?.(rowKey, loading); }, [rowKey, loading, onLoadingChange]);

  // While the parent is showing that spinner the whole table is hidden, so
  // what these cells say during the wait is never seen. They keep the plain
  // text rather than a shimmer: a skeleton behind a spinner is two loading
  // idioms for one wait.
  if (loading) return emptyTds("Checking engine…");
  if (error)   return emptyTds("Engine state unknown");
  if (!pings.length) return emptyTds("No telemetry in window");

  const withEngine = pings.filter(p => p.engineOn != null);
  if (!withEngine.length) return emptyTds("Engine state unknown");

  // ── Scope drain-window pings to first 25 min (engine-off analysis) ─────────
  // The full fetch goes to +60min for restart detection; engine-off verdict
  // should only be based on the window immediately around the drain.
  const drainWindowEnd = event.at + 15 * 60_000;
  const drainWindowPings = withEngine.filter(
    p => p.capturedAt && new Date(p.capturedAt).getTime() <= drainWindowEnd
  );

  const offPings   = drainWindowPings.filter(p => p.engineOn === false);
  const onCount    = drainWindowPings.filter(p => p.engineOn === true).length;
  const offCount   = offPings.length;
  const totalPings = drainWindowPings.length;
  const engineOff  = offCount > onCount;

  const drainTime = event.atIso ? fmtHM(event.atIso) : null;

  if (engineOff) {
    const offTimes = offPings
      .map(p => p.capturedAt ? new Date(p.capturedAt).getTime() : null)
      .filter(Boolean)
      .sort((a, b) => a - b);

    let firstStr    = null;
    let lastStr     = null;
    let durationStr = null;
    let intervalStr = null;

    if (offTimes.length >= 2) {
      const first   = offTimes[0];
      const last    = offTimes[offTimes.length - 1];
      const spanMs  = last - first;
      const mins    = Math.round(spanMs / 60_000);
      const avgSecs = Math.round(spanMs / (offTimes.length - 1) / 1000);
      firstStr    = fmtHM(new Date(first).toISOString());
      lastStr     = fmtHM(new Date(last).toISOString());
      durationStr = mins > 0 ? `${mins} min` : null;
      if (avgSecs > 0) {
        intervalStr = avgSecs < 120
          ? `every ~${avgSecs}s`
          : `every ~${Math.round(avgSecs / 60)} min`;
      }
    }

    // ── Odometer comparison across engine-off window ──────────────────────────
    // Sort all off-pings by time and compare first vs last odometer reading.
    const offPingsSorted = [...offPings]
      .filter(p => p.capturedAt)
      .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));

    const odomFirst = offPingsSorted.find(p => p.odometerKm != null)?.odometerKm ?? null;
    const odomLast  = [...offPingsSorted].reverse().find(p => p.odometerKm != null)?.odometerKm ?? null;
    const odomDelta = odomFirst != null && odomLast != null ? +(odomLast - odomFirst).toFixed(2) : null;
    const vehicleMoved = odomDelta != null && odomDelta > 0.1; // >100m movement = meaningful

    // ── Engine restart time ───────────────────────────────────────────────────
    // Search the FULL 60-min window (withEngine, not drainWindowPings) so we
    // catch restarts that happen after the 25-min drain window closes.
    const allSorted  = [...withEngine]
      .filter(p => p.capturedAt)
      .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
    const lastOffTime = offTimes.length ? Math.max(...offTimes) : null;
    const restartPing = lastOffTime
      ? allSorted.find(p => p.engineOn === true && new Date(p.capturedAt).getTime() > lastOffTime)
      : null;
    const restartTime = restartPing?.capturedAt ? fmtHM(restartPing.capturedAt) : null;
    const restartMs   = restartPing?.capturedAt ? new Date(restartPing.capturedAt).getTime() : null;

    // ── Plain-English details sentence ────────────────────────────────────────
    const sentences = [];

    if (drainTime && firstStr && lastStr) {
      sentences.push(
        `Fuel drain of ${event.litres != null ? event.litres.toFixed(1) + "L " : ""}detected at ${drainTime}hrs while engine had been off from ${firstStr} to ${lastStr}hrs.`
      );
    } else if (drainTime) {
      sentences.push(`Fuel drain detected at ${drainTime}hrs.`);
    }

    if (odomDelta != null && vehicleMoved) {
      sentences.push(
        `Odometer moved ${odomDelta} km during engine-off period, vehicle was in motion; possible sensor malfunction.`
      );
    }

    if (restartTime) {
      sentences.push(`Engine restarted at ${restartTime}hrs.`);
    }

    const detailMsg = sentences.join(" ");

    return (
      <>
        {/* Col 2 — Engine Status */}
        <td className="sp4-incident-td">
          <div className="sp4-ec-status sp4-ec-status--off">OFF</div>
          {firstStr && lastStr && (
            <div className="sp4-ec-range">
              {firstStr} – {lastStr}
              {durationStr && <span className="sp4-ec-duration"> ({durationStr})</span>}
            </div>
          )}
          {restartTime && (
            <div className="sp4-ec-restart">Restarted {restartTime}hrs</div>
          )}
          {odomDelta != null ? (
            <div className={`sp4-ec-odometer ${vehicleMoved ? "sp4-ec-odometer--moved" : "sp4-ec-odometer--still"}`}>
              {vehicleMoved ? `Odometer +${odomDelta} km, moved` : "Odometer unchanged, stationary"}
            </div>
          ) : (
            <div className="sp4-ec-odometer sp4-ec-odometer--na">Odometer unavailable</div>
          )}
        </td>

        {/* Col 3 — Ping Coverage */}
        <td className="sp4-incident-td">
          <div className="sp4-ec-pings">
            {totalPings} pings done{intervalStr ? ` at intervals of ${intervalStr.replace("every ~", "~")}` : ""}
          </div>
          <div className="sp4-ec-verdict">no engine ON recorded</div>
        </td>

        {/* Col 4 — Details */}
        <td className="sp4-incident-td sp4-incident-td--details">
          <div className="sp4-ec-detail-text">{detailMsg}</div>
          {restartMs && (
            <PostRestartCheck
              vehicleId={vehicleId}
              orgId={orgId}
              restartMs={restartMs}
              fmtHM={fmtHM}
            />
          )}
        </td>
      </>
    );
  }

  // Engine ON
  const drainVol  = event.litres != null ? `${event.litres.toFixed(1)}L ` : "";
  const detailOn  = drainTime
    ? `Fuel drain of ${drainVol}detected at ${drainTime}hrs while engine was running.`
    : "Engine was on throughout this window.";

  return (
    <>
      <td className="sp4-incident-td">
        <div className="sp4-ec-status sp4-ec-status--on">ON</div>
      </td>
      <td className="sp4-incident-td">
        <div className="sp4-ec-pings">{totalPings} pings</div>
        <div className="sp4-ec-verdict sp4-ec-verdict--on">no engine OFF recorded</div>
      </td>
      <td className="sp4-incident-td sp4-incident-td--details">
        <div className="sp4-ec-detail-text">{detailOn}</div>
      </td>
    </>
  );
}

/** "Wed 8 Oct 2026" (or "Wed 8 Oct") for a fleet day key, or "Today". */
function fuelDayName(day, { year = true } = {}) {
  if (!day || day === fleetDayKey()) return "Today";
  // Spelled out rather than toLocaleDateString, which puts a comma after the
  // weekday only when the year is shown, and not in every engine alike. Noon
  // UTC is the same calendar day everywhere, so no zone can shift it.
  const d = new Date(`${day}T12:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mo}` + (year ? ` ${d.getUTCFullYear()}` : "");
}

/**
 * One unit's fuel events for the day picked above.
 *
 * The picker stays live while this is open, so the day can change under it —
 * and a unit with events on one day very often has none on the next. `fuelRow`
 * is therefore OPTIONAL: it was read unguarded, and stepping a unit back to a
 * day it had no events on threw on `fuelRow.events` and took the whole
 * Maintenance screen down to its error boundary.
 *
 * Three states besides the record itself, all inside the panel so the unit and
 * the close button stay where they were:
 *   pending   the new day is still being read — never the old day's rows
 *   error     the read failed; Try again re-asks
 *   no row    the unit recorded nothing that day, with the way back to the last
 *             day it did (`recordDay`) and to every unit on this one
 */
export function FuelDrainDetail({
  vehicleId, vehicleName, orgId, fuelRow, onClose,
  day, pending = false, error = null, onReload, tank, recordDay, onPickDay, inPanel = false,
}) {
  const { can } = usePermissions();
  const { setDesktopActiveTab, setPendingFocusId } = useAppActions();
  const pad = n => String(n).padStart(2, "0");
  const fmtTime = iso => {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtLitres = ml => ml != null ? `${(ml / 1000).toFixed(1)} L` : "?L";

  const events  = fuelRow?.events ?? [];
  const drains  = events.filter(e => e.type === "drain");
  const refills = events.filter(e => e.type === "refill");
  const dayName = fuelDayName(day);
  const isToday = !day || day === fleetDayKey();

  /* What the tank did on a day with no events, so the empty state is still an
     answer about the unit: a quiet day and a day the unit sent nothing are not
     the same thing. Only the parts the server actually has. */
  const tankLine = (() => {
    if (!tank || tank.initialMl == null || tank.currentMl == null) return null;
    const L = ml => `${Math.round(ml / 1000)} L`;
    const km = tank.distanceM != null ? `, over ${(tank.distanceM / 1000).toFixed(1)} km` : "";
    return isToday
      ? `The tank opened the day at ${L(tank.initialMl)} and stands at ${L(tank.currentMl)}${km}.`
      : `The tank opened the day at ${L(tank.initialMl)} and closed it at ${L(tank.currentMl)}${km}.`;
  })();

  /**
   * One spinner for the whole incident table, matching All Probes.
   *
   * Each incident row fetches its own telemetry window, so there is no single
   * flag to read — the rows report their state up here and this aggregates
   * them. A row that has not reported yet counts as pending, which is what
   * makes the first frame show the spinner rather than an empty table.
   *
   * The table is HIDDEN rather than unmounted while that runs. Unmounting it
   * would remove the very rows whose fetches we are waiting on, and nothing
   * would ever load.
   */
  const [rowLoading, setRowLoading] = useState({});
  const noteRowLoading = useCallback((key, isLoading) => {
    setRowLoading(prev => (prev[key] === isLoading ? prev : { ...prev, [key]: isLoading }));
  }, []);
  const incidentsLoading = drains.length > 0 && (
    Object.keys(rowLoading).length < drains.length ||
    Object.values(rowLoading).some(Boolean)
  );

  // Verdict label for each drain. Same three colours as the chips above: every
  // drain red and called a suspicious drain, undulation amber, refill green.
  // Never "loss", "theft" or "stolen" — the probe sees a level fall, not where
  // the fuel went.
  const verdictLabel = v => ({
    DRAIN:          { text: "Suspicious drain", cls: "sp4-verdict--loss"    },
    REDISTRIBUTION: { text: "Undulating",       cls: "sp4-verdict--undul"   },
    REFILL:         { text: "Refill",           cls: "sp4-verdict--settled" },
    SENSOR_FAULT:   { text: "Probe fault",      cls: "sp4-verdict--none"    },
    PENDING:        { text: "Settling…",        cls: "sp4-verdict--none"    },
  })[v] ?? { text: v ?? "Unknown", cls: "sp4-verdict--none" };

  const subLine = (
    <>
      Fuel events · {dayName}
      {fuelRow && !pending && !error && (
        <> · {drains.length} drain{drains.length !== 1 ? "s" : ""} · {refills.length} refill{refills.length !== 1 ? "s" : ""}</>
      )}
    </>
  );

  return (
    <div className={"sp4-detail" + (inPanel ? " sp4-detail--panel" : "")}>
      {inPanel ? (
        /* In the detail sidebar: the unit heads the panel, its × closes it and
           View on Map sits in the panel's foot (SensorPanel). */
        <DetailSidebarIdent name={vehicleName} sub={subLine} />
      ) : (
      <div className="sp4-detail-head">
        {/* Classed so the stylesheet can give it a floor. As a bare <div> it
            carried min-width:auto, and the actions beside it are shrink:0, so
            the title box was the only thing in the row that could give — and
            it gave all the way down to its longest word. */}
        <div className="sp4-detail-titles">
          <div className="sp4-detail-reg">{vehicleName}</div>
          <div className="sp4-detail-sub">{subLine}</div>
        </div>
        <div className="sp4-detail-actions">
          {can("map:read") && (
            <button className="sp4-map-btn sp4-map-btn--lg" onClick={() => { setDesktopActiveTab("fleet"); setPendingFocusId(vehicleName); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
              View on Map
            </button>
          )}
          <button className="sp4-detail-close" onClick={onClose}>✕</button>
        </div>
      </div>
      )}

      {pending ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Day's Fuel Events">
          Refills and drains for {vehicleName} {isToday ? "today" : `on ${dayName}`}.
        </EmptyNote>
      ) : error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="Fuel Events Could Not Be Loaded"
                   action={onReload ? { label: "Try again", icon: "ti-refresh", onClick: onReload } : null}>
          {error}
        </EmptyNote>
      ) : !fuelRow ? (
        <EmptyNote icon="ti-calendar-off" tone="info"
                   title={isToday ? "No Fuel Events Today" : `No Fuel Events on ${dayName}`}
                   actions={[
                     recordDay && recordDay !== day && onPickDay
                       ? { label: `Back to ${fuelDayName(recordDay, { year: false })}`, icon: "ti-arrow-back-up", onClick: () => onPickDay(recordDay) }
                       : null,
                     { label: isToday ? "Every unit today" : `Every unit on ${fuelDayName(day, { year: false })}`, icon: "ti-list", onClick: onClose },
                   ]}>
          {vehicleName} recorded no refills or drains {isToday ? "today" : "that day"}.
          {tankLine && <> {tankLine}</>}
        </EmptyNote>
      ) : (<>
      {/* Summary strip */}
      <div className="sp4-drain-summary">
        <div className="sp4-drain-summary__item">
          <span className="sp4-drain-summary__label">Pattern</span>
          <span className="sp4-drain-summary__value">{fuelRow.pattern}</span>
        </div>
        <div className="sp4-drain-summary__item">
          <span className="sp4-drain-summary__label">Drains</span>
          <span className="sp4-drain-summary__value" style={{ color: "#fca5a5" }}>{fuelRow.drainCount}</span>
        </div>
        <div className="sp4-drain-summary__item">
          <span className="sp4-drain-summary__label">Refills</span>
          <span className="sp4-drain-summary__value" style={{ color: "#86efac" }}>{fuelRow.refillCount}</span>
        </div>
        <div className="sp4-drain-summary__item">
          <span className="sp4-drain-summary__label">Suspicious</span>
          <span className="sp4-drain-summary__value" style={{ color: fuelRow.verdictSplit.loss > 0 ? "#ef4444" : "var(--text-2)" }}>
            {fuelRow.verdictSplit.loss}
          </span>
        </div>
        <div className="sp4-drain-summary__item">
          {/* Amber: nothing was taken, but the level did move. */}
          <span className="sp4-drain-summary__label">Undulating</span>
          <span className="sp4-drain-summary__value" style={{ color: "#fbbf24" }}>{fuelRow.verdictSplit.settled}</span>
        </div>
      </div>

      {/* Drain events — unified incident table */}
      {drains.length === 0 ? (
        <div className="sp4-empty-tab">No drain events for this vehicle {isToday ? "today" : `on ${dayName}`}.</div>
      ) : (
        <div className="sp4-drain-list">
          <div className="sp4-drain-list__heading">Drain events: engine state check</div>
          <div className="sp4-drain-list__hint">
            Engine state is read from telemetry pings in a 25-minute window around each drain.
            Engine off during a drain is a strong theft indicator.
          </div>
          {incidentsLoading && (
            <div className="sp4-loading"><div className="sp4-spinner" />Loading drain details…</div>
          )}
          <table
            className="sp4-incident-table"
            style={incidentsLoading ? { display: "none" } : undefined}
            aria-hidden={incidentsLoading || undefined}
          >
            <thead>
              <tr>
                <th className="sp4-incident-th">Incident</th>
                <th className="sp4-incident-th">Engine Status</th>
                <th className="sp4-incident-th">Ping Coverage</th>
                <th className="sp4-incident-th">Details</th>
              </tr>
            </thead>
            <tbody>
              {drains.map((drain, i) => {
                const vd = verdictLabel(drain.verdict);
                return (
                  <DrainIncidentRow
                    key={i}
                    rowKey={i}
                    onLoadingChange={noteRowLoading}
                    drain={drain}
                    verdict={vd}
                    vehicleId={vehicleId}
                    orgId={orgId}
                    fmtTime={fmtTime}
                    fmtLitres={fmtLitres}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Refill events for context */}
      {refills.length > 0 && (
        <div className="sp4-drain-list">
          <div className="sp4-drain-list__heading">Refill events</div>
          {refills.map((refill, i) => (
            <div key={i} className="sp4-drain-row">
              <div className="sp4-drain-row__top">
                <span className="sp4-drain-row__time">{fmtTime(refill.atIso)}</span>
                <span className="sp4-drain-row__vol" style={{ color: "#86efac" }}>+{fmtLitres(refill.litres != null ? refill.litres * 1000 : null)}</span>
                {refill.location && <span className="sp4-drain-row__loc" title={refill.location}>📍 {refill.location}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

/** When a unit was last heard from, in words: "3 h ago", "4 days ago", "never". */
function lastHeard(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const h = ms / 3600000;
  if (h < 48) return `${Math.max(1, Math.round(h))} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function SensorDetail({
  vehicleId, vehicleName, orgId, onClose,
  canSeeRepairs = false, canResolveRepairs = false, faulty = false, repairNonce = 0, inPanel = false,
  // In the sidebar: the Fixing / Needs a spare part / Cannot be fixed buttons
  // (ProbeReportActions), and when the unit last reported, for the empty state.
  reportActions = null, lastReportedAt = null,
}) {
  const { can } = usePermissions();
  const { user } = useAuth();
  const { pings, loading, error } = useVehicleTelemetry(vehicleId, orgId, 50);
  const { setDesktopActiveTab, setPendingFocusId } = useAppActions();
  const [page, setPage] = useState(0);

  /*
   * The unit's newest repair, open or closed — the tracking line's subject.
   *
   * Its own fetch rather than a read of the open-jobs map SensorPanel already
   * holds, because that map drops a job the instant it is signed off and the
   * line would go blank in the same click that put "Fixed" on the end of it.
   *
   * `repairNonce` is the invalidation: it changes when a report is filed or a
   * stage moves, and this re-asks. Nothing else can make the answer stale.
   */
  const [repair, setRepair] = useState(null);
  // Bumped by the sign-off below, so closing a job re-reads it and the ladder
  // lands on Fixed without a page reload.
  const [repairTick, setRepairTick] = useState(0);
  useEffect(() => {
    if (!canSeeRepairs || !orgId || !vehicleId) { setRepair(null); return undefined; }
    let cancelled = false;
    void latestRepairForVehicle({ orgId, vehicleId })
      .then((r) => { if (!cancelled) setRepair(r); })
      // Silent: a missing tracking line is a panel with one fewer card on it,
      // and an error banner over the telemetry table — which loaded fine —
      // would be about the wrong thing.
      .catch(() => { if (!cancelled) setRepair(null); });
    return () => { cancelled = true; };
  }, [orgId, vehicleId, canSeeRepairs, repairNonce, repairTick]);

  const totalPages = Math.ceil((pings.length || 0) / PAGE_SIZE);
  const pagePings  = pings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handlePrint = () => window.print();

  const handlePDF = () => {
    const rows = pings.map(ping =>
      SENSOR_COLUMNS.map(col => col.format(ping[col.key], ping)).join("\t")
    ).join("\n");
    const header = SENSOR_COLUMNS.map(c => c.label).join("\t");
    const content = `Sensor Report: ${vehicleName}\n${new Date().toLocaleString()}\n\n${header}\n${rows}`;
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sensor-${vehicleName}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className={"sp4-detail" + (inPanel ? " sp4-detail--panel" : "")}>
      {inPanel ? (
        /* In the detail sidebar: the unit heads the panel, its × closes it and
           View on Map sits in the panel's foot (SensorPanel). */
        <DetailSidebarIdent name={vehicleName} sub={`Sensor readings, past 1 hour · ${pings.length} pings`}>
          <span className="sp4-detail-panel-actions">
            <button className="sp4-ghost-btn" onClick={handlePDF} title="Download as text file">Export</button>
            <button className="sp4-ghost-btn" onClick={handlePrint} title="Print this table">Print</button>
          </span>
        </DetailSidebarIdent>
      ) : (
      <div className="sp4-detail-head">
        {/* Classed so the stylesheet can give it a floor. As a bare <div> it
            carried min-width:auto, and the actions beside it are shrink:0, so
            the title box was the only thing in the row that could give — and
            it gave all the way down to its longest word. */}
        <div className="sp4-detail-titles">
          <div className="sp4-detail-reg">{vehicleName}</div>
          <div className="sp4-detail-sub">Sensor readings: past 1 hour · {pings.length} pings</div>
        </div>
        <div className="sp4-detail-actions">
          <button className="sp4-action-btn" onClick={handlePDF} title="Download as text file">
            ⬇ Export
          </button>
          <button className="sp4-action-btn" onClick={handlePrint} title="Print this table">
            🖨 Print
          </button>
          {can("map:read") && (
            <button className="sp4-map-btn sp4-map-btn--lg" onClick={() => { setDesktopActiveTab("fleet"); setPendingFocusId(vehicleName); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
              View on Map
            </button>
          )}
          <button className="sp4-detail-close" onClick={onClose}>✕</button>
        </div>
      </div>
      )}
      {/* Above the readings, not below them. The question "what is being done
          about this unit" is why somebody opened this panel on a faulty one;
          fifty rows of telemetry is the evidence, and evidence sits under the
          answer. Absent entirely when the unit has never been reported. */}
      {/* Rendered for a FAULTY unit even with no repair against it: that is
          the first rung, not an absence. A healthy unit still gets nothing. */}
      {(repair || faulty) && (
        <RepairTrackingLine
          item={repair}
          faulty={faulty}
          orgId={orgId}
          canResolve={mayWorkJob(repair, { canResolve: canResolveRepairs, canWorkAny: can("repair:work_any"), userId: user?.id ?? null })}
          onChanged={() => setRepairTick((n) => n + 1)}
        />
      )}
      {/* One line, under the progress card: a label and its two buttons. */}
      {reportActions && (
        <section className="sp4-report" aria-label="Report a repair">
          <span className="sp4-report-title">Report a repair</span>
          {reportActions}
        </section>
      )}

      {loading ? (
        <div className="sp4-loading"><div className="sp4-spinner" />Loading sensor readings…</div>
      ) : error ? (
        <div className="sp4-error">⚠ {error}</div>
      ) : !pings.length ? (
        /* An icon over the words (operator, 2026-10-20), so a silent unit
           reads as a state at a glance, with when it was last heard from. */
        <div className="sp4-empty-tab sp4-empty-tab--silent">
          <i className="ti ti-wifi-off sp4-silent-icon" aria-hidden="true" />
          <span>No telemetry in the past hour</span>
          {lastReportedAt !== null && (
            <span className="sp4-muted">Last report {lastHeard(lastReportedAt)}</span>
          )}
        </div>
      ) : (
        <div className="sp4-detail-table-wrap">
          {/* The table needs its own scroller.
              It used to sit directly in the wrap, which is `overflow: hidden`
              so the footer below stays put — and on a phone that clipped the
              table's last column instead of letting anyone reach it. The wrap
              still owns the footer; this owns the rows. */}
          <div className="sp4-detail-scroll">
          <table className="sp4-table sp4-print-table">
            <thead>
              <tr>{SENSOR_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {pagePings.map((ping, i) => (
                <tr key={i} className={"sp4-tr" + (page === 0 && i === 0 ? " sp4-tr--latest" : "")}>
                  {SENSOR_COLUMNS.map(col => {
                    const val = ping[col.key];
                    const flagged = col.flag(val, ping);
                    return (
                      <td key={col.key} className={"sp4-td" + (flagged ? " sp4-td--flagged" : "")}>
                        {col.format(val, ping)}{flagged && <span className="sp4-flag">⚑</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="sp4-detail-footer">
            <TablePager
              label="Reading pages"
              pager={{
                page,
                pageCount: Math.max(1, totalPages),
                total: pings.length,
                from: pings.length ? page * PAGE_SIZE + 1 : 0,
                to: page * PAGE_SIZE + pagePings.length,
                setPage,
              }}
            />
            <span className="sp4-flag-hint">⚑ flagged cells indicate anomalous values</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function SensorPanel() {
  const { orgId, vehicles } = useFleetLiveShared();
  const { user } = useAuth();
  const { anomalies, loading } = useSensorHealth();
  const probeHealth = useProbeHealth();

  /* Which of these four resources this account may see at all.
     The screen itself is already behind `sensor:read` — FooterNav grades the
     Maint button on it and App.jsx grades the screen behind it — so Probes and
     Malfunction need no further test. Fuel FSL and Speed do: they read feeds
     this account may not hold, and a tab that loads and then fails is worse
     than a tab that was never offered. */
  const { can } = usePermissions();
  const canRepairRead   = can("repair:read");
  const canRepairAssign  = can("repair:assign");
  const openRepairs = useOpenRepairs(canRepairRead);
  // Lifted out of FuelTable: the PDF export needs these same rows, and one
  // fetch has to serve both — see the note on FuelTable.
  /**
   * Which fleet DAY the fuel tab is showing. Defaults to today.
   *
   * Was a rolling 24 hours, so the table never lined up with a shift and two
   * people opening it an hour apart saw different sets. Fleet days are Kenyan,
   * matching how the server buckets them — see fleetDayKey.
   */
  const [fuelDay, setFuelDay] = useState(fleetDayKey());
  const { flaggedVehicles, loading: fuelLoading, error: fuelError, loadedDay: fuelLoadedDay, tankState, reload: fuelReload } = useFuelEvents(orgId, fuelDay);
  const fuelFlagged = flaggedVehicles();
  /* Still reading — including the render right after the picker moves, when
     the rows on hand are the PREVIOUS day's and `loading` has not caught up.
     Every reader of the fuel rows waits on this, so none of them shows one
     day's events under another day's date. A failed read is not pending: it
     has its own state, with a retry. */
  const fuelPending = fuelLoading || (!fuelError && fuelLoadedDay !== fuelDay);
  /**
   * The window the two incident reports read.
   *
   * ONE FLEET DAY, the same unit the Fuel FSL tab reads in and picked with the
   * same control. It was a whole month, chosen with the analytics month grid,
   * which made three tabs of one panel answer over three different spans; a
   * day is what operations actually works in, and it is the span the reader
   * has already learned one tab to the left.
   *
   * Still `rangeFor`, and still the analytics filter shape — a single day is
   * just a RANGE whose ends are equal, which that function already resolves to
   * 00:00:00 → 23:59:59 at +03:00. No endpoint learned a new date contract,
   * and a day means the same instants here as it would on a chart.
   */
  const [incidentDay, setIncidentDay] = useState(fleetDayKey);
  const incidentRange = useMemo(
    () => rangeFor({ mode: "range", from: incidentDay, to: incidentDay }, "Africa/Nairobi"),
    [incidentDay],
  );
  const [speedInsights, setSpeedInsights] = useState(null);
  const [faultInsights, setFaultInsights] = useState(null);

  // Insights are fetched once per window and handed to the report, so the
  // header figures and the table underneath cannot disagree about the period.
  useEffect(() => {
    if (!orgId) return undefined;
    let cancelled = false;
    void getSpeedingInsights({ orgId, ...incidentRange })
      .then(d => { if (!cancelled) setSpeedInsights(d); })
      .catch(() => { if (!cancelled) setSpeedInsights(null); });
    void getFaultInsights({ orgId, ...incidentRange })
      .then(d => { if (!cancelled) setFaultInsights(d); })
      .catch(() => { if (!cancelled) setFaultInsights(null); });
    return () => { cancelled = true; };
  }, [orgId, incidentRange]);

  /*
   * Which tab of the Sensor Monitor is open, remembered across a reload.
   *
   * This is the screen somebody WORKS in — a technician lives in Malfunction
   * and Repairs — and resetting it to Probes on every refresh made the app
   * walk them back to a tab they had left on purpose. Durable rather than
   * per-tab (unlike the Account and User Accounts overlays), because unlike
   * those there is nothing surprising about opening tomorrow where you closed.
   *
   * The allow-list is the FULL set of tab keys rather than the permitted ones:
   * grading here would silently rewrite a stored tab whenever permissions load
   * a beat late, and the effect below already moves off a tab this account
   * cannot open. Restoring says where somebody resumes, not what they may see.
   */
  const [activeTab,     setActiveTab]     = useState(
    () => restoreChoice(SENSOR_TAB_KEY, SENSOR_TABS, "probes")
  );
  useEffect(() => { persistChoice(SENSOR_TAB_KEY, activeTab); }, [activeTab]);
  const [selectedAnomaly, setSelectedAnomaly] = useState(null);

  /*
   * Is the unit on screen actually broken?
   *
   * `faultAction` is the same predicate the Probes table prints in its "What to
   * do" column, read off the same rows — so the detail panel and the table
   * cannot disagree about whether a unit is faulty. It is what puts an
   * unreported unit on the tracking line's first rung; a healthy one gets no
   * ladder at all, because a ladder on a working probe is four greyed-out
   * stages answering a question nobody asked.
   */
  const selectedProbeRow = useMemo(() => {
    const id = selectedAnomaly?.vehicleId;
    return id ? probeHealth.data?.rows?.find((r) => r.vehicleId === id) ?? null : null;
  }, [selectedAnomaly, probeHealth.data]);
  const selectedIsFaulty = useMemo(() => {
    const id = selectedAnomaly?.vehicleId;
    if (!id) return false;
    const row = probeHealth.data?.rows?.find((r) => r.vehicleId === id);
    return row ? !!faultAction(row) : false;
  }, [selectedAnomaly, probeHealth.data]);
  const [search,        setSearch]        = useState("");
  const [timeFilter,    setTimeFilter]    = useState("all");
  const [engineFilter,  setEngineFilter]  = useState("all");
  const [fuelFilter,    setFuelFilter]    = useState("all"); // fuel-tab-only filter
  // Speed and Malfunction sort the same way over the same shape of ledger, so
  // one setting serves both and switching between the tabs keeps the reader's
  // ordering. It lives here rather than inside IncidentReport because the
  // control that sets it is in the filter bar above, alongside the month.
  const [incidentSort,  setIncidentSort]  = useState("count");
  const maltCount  = anomalies.filter(a => ANOMALY_META[a.type]?.type === "malfunction").length;

  // Coverage — both figures are Wialon's own, not ours.
  //
  // `connectionOnline` is netconn, the provider's ONLINE/OFFLINE verdict,
  // carried per unit by the server (fleet-server lib/connection-state) and kept
  // raw on the mapped vehicle. It is TRI-state, and the third state is the one
  // that matters here: null means Wialon has no verdict for that unit at all —
  // which is exactly what a vehicle with no Wialon unit bound looks like.
  //
  // So monitoring is "units Wialon knows", not "rows in our database". Counting
  // rows claimed 597 against the 280 Wialon actually tracks; the other 317 are
  // records the provider has never heard of, and calling them monitored
  // overstated coverage by more than the real figure itself.
  //
  // Both stay live without any work here: the vehicles array is re-published on
  // every SSE position frame, and useFleetLive additionally re-reads the
  // snapshot every 60s (applyConnectionRefresh) precisely because a unit that
  // goes offline STOPS emitting frames, so its verdict can only change on a
  // poll. Deriving from `vehicles` inherits both.
  //
  // ## Why this comes from readingCoverage and not a local filter
  //
  // "Reporting now" is also the name of the headline figure on the Sensor
  // Coverage strip, and the two used to disagree flatly — 64 here against 171
  // there — because they measured different things under one word. This panel
  // counted Wialon's CONNECTION verdict (`v.online`, netconn); coverage counted
  // MESSAGE AGE (a frame inside the last hour). Both are legitimate, and the
  // ~107 vehicles between them are real: units that posted a fix earlier in the
  // hour and have since dropped their GPRS session.
  //
  // What was not legitimate was calling both "Reporting now". They share one
  // source now, so the label means one thing across the dashboard and the two
  // panels cannot drift apart again. The connection verdict keeps its own tile
  // below under the name it actually deserves.
  const coverage       = readingCoverage(vehicles);
  const monitoredTotal = coverage.tracked;
  const reportingNow   = coverage.reporting;
  const unboundCount   = coverage.untracked;
  // Wialon's netconn verdict — a live session right now, which is a stricter
  // and more perishable claim than "sent something recently". This is the same
  // count the map's ONLINE filter shows.
  const connectedNow   = vehicles.filter(v => v.online).length;

  // Tabs whose window and ordering are chosen in the filter bar. Grouped once
  // so the bar and the body cannot disagree about which tabs those are.
  const isIncidentTab = activeTab === "speed" || activeTab === "malfunction";
  // Same phrasing the fuel caption uses, so all three tabs name the day the
  // same way rather than one saying "today" and another printing a date.
  const incidentDayLabel = incidentDay === fleetDayKey() ? "today" : incidentDay;

  const handleTabChange = (key) => {
    setActiveTab(key);
    if (key !== "fuel") setFuelFilter("all");
    // A unit open in the sidebar belongs to the tab that opened it.
    setSelectedAnomaly(null);
    // Leaving both incident tabs drops their ordering the way leaving fuel
    // drops its drain filter — a filter that survives out of sight is a filter
    // the reader is not told about on the way back in.
    if (key !== "speed" && key !== "malfunction") setIncidentSort("count");
  };

  const handleSelect = useCallback(anomaly => {
    setSelectedAnomaly(prev =>
      prev?.vehicleId === anomaly.vehicleId && prev?.type === anomaly.type ? null : anomaly
    );
  }, []);
  const closeSelected = useCallback(() => setSelectedAnomaly(null), []);
  // A Fuel FSL unit opens beside the list, and only while that tab shows it.
  const fuelOpen = selectedAnomaly?.type === "fuel_anomaly" && activeTab === "fuel";
  // Any other unit (a probe row) opens beside the list while Probes shows it.
  const sensorOpen = !!selectedAnomaly && selectedAnomaly.type !== "fuel_anomaly" && activeTab === "probes";
  const { setDesktopActiveTab, setPendingFocusId } = useAppActions();

  /*
   * The open unit's row for the picked day, once that day has been read.
   *
   * Undefined while reading, and undefined on a day the unit recorded nothing —
   * the detail panel draws both. `recordDay` follows the unit to the latest day
   * it was seen WITH events, so the empty state's way back leads somewhere that
   * has something to show rather than to wherever the panel was first opened.
   */
  const selectedFuelRow = selectedAnomaly?.type === "fuel_anomaly" && !fuelPending && !fuelError
    ? fuelFlagged.find(r => r.vehicleId === selectedAnomaly.vehicleId)
    : undefined;
  const selectedFuelFound = !!selectedFuelRow;
  useEffect(() => {
    if (selectedFuelFound) {
      setSelectedAnomaly(prev => (prev && prev.recordDay !== fuelDay ? { ...prev, recordDay: fuelDay } : prev));
    }
  }, [selectedFuelFound, fuelDay]);

  // A count of 0 mid-fetch is a wrong answer, not a neutral one: the badge sat
  // at 0 for the ~1.6 s the snapshot takes and then jumped to 8 and 407, which
  // is the other half of what reads as a rendering delay. "·" says "not yet".
  //
  // Fuel used to be a hard-coded "—" that never resolved, so that tab alone
  // never showed a count even once its 69 rows were on screen. It has its own
  // fetch, so it tracks its own loading flag rather than the snapshot's.
  const pending = "·";
  /*
   * Every tab this screen has, each carrying whether this account may open it.
   * Filtered rather than greyed: inside a screen a dead button is clutter, and
   * the footer's disabled-not-hidden rule is about the NAV, where a greyed
   * button is telling you an organisation exists that you cannot reach.
   */
  const allTabs = [
    // First, and the default: every probe on every unit, live reading AND
    // condition in one row. This used to be two tabs — All Probes for what a
    // channel reads now, Probe Health for whether it works — split by TIME
    // rather than by subject, so both answered "the state of every probe" and
    // you had to know which was which. Merged, the badge is the population and
    // the fault count sits inside it.
    { key: "probes",      allow: true,      label: "Probes",
      count: probeHealth.loading ? pending : (probeHealth.data?.summary?.total ?? monitoredTotal),
      /* One hint per tab, because one hint for four tabs was wrong on three of
         them. "Click any row to inspect sensor readings" describes the probes
         tab exactly — a row there IS one unit's channels, and clicking opens
         its readings. On Fuel FSL a click opens that day's drain trace; on
         Speed and Malfunction it opens every case for that unit. Three
         different destinations under one promise, and the two incident tabs
         do not show sensor readings at all.
         Probes has none now (operator, 2026-10-03: remove "Click any row to
         inspect that unit's live sensor readings"). */
      hint: null },
    // The tab reads /fuel/tank-state and /fuel/fillings, both on this slug.
    { key: "fuel",        allow: can("fuel_filling:read"),
      label: "Fuel FSL",    count: fuelPending ? pending : fuelFlagged.length,
      hint: "Click any row to trace the day's fuel level and its events" },
    /* The badge counts the events the SERVER emitted over the window on screen,
       the way Fuel FSL's counts the fuel events for its day. It used to count
       browser-detected anomalies off the live snapshot — a different measure
       over a different period, which is how it came to show a number above an
       empty table. That local count had no other reader and is gone; the PDF
       export derives its own speed rows from `anomalies` and is unaffected. */
    // Speeding is driver-conduct analytics, and /incidents/speeding guards it
    // with the same slug that opens the Analytics screen.
    { key: "speed",       allow: can("analytics:read"),
      label: "Speed",       count: speedInsights ? speedInsights.incidents : pending,
      hint: "Click any unit to see every overspeeding case in the window" },
    { key: "malfunction", allow: true,
      label: "Malfunction", count: loading     ? pending : maltCount,
      hint: "Click any unit to see every fault episode in the window" },
    /* The outstanding work, and where "Resolved" lives. It is a tab rather
       than a button on the probe row because a job is signed off days after it
       is raised, by which time the unit's HEALTH has moved and the row that
       raised it may no longer be under the filter that found it. */
    { key: "repairs",     allow: canRepairRead,
      label: "Repairs",     count: openRepairs.loading ? pending : openRepairs.openCount,
      hint: "Open repair jobs, sign one off once the fix has held" },
  ];
  const tabs = allTabs.filter((t) => t.allow);

  /*
   * Move off a tab this account cannot open, rather than merely hiding it.
   *
   * The same correction App.jsx makes for the nav, and for the same reason: a
   * company switch under a session already sitting on Speed would otherwise
   * leave the body rendering a tab that has no button to leave it by. The
   * effect lands one render late, so the body switch below tests the
   * permission too — belt and braces on two lines.
   */
  useEffect(() => {
    if (!tabs.some((t) => t.key === activeTab)) setActiveTab(tabs[0]?.key ?? "probes");
  }, [tabs, activeTab]);


  const filterProps = { search, timeFilter, engineFilter, fuelFilter, vehicles };

  /* Every grid on this screen turns into a stack of labelled cards below 768px
     (SensorPanel.css). The labels are the column headers, copied onto the cells
     they head — see lib/tableLabels for why they are read from the DOM rather
     than written into each panel's markup, and why this watches for rows
     instead of running on this component's own renders. */
  const rootRef = useRef(null);
  useEffect(() => watchTableLabels(rootRef.current), []);

  return (
    <div className="sp4-root sp4-root--framed" ref={rootRef}>

      {/* ── Header ─────────────────────────────────────────────
          No title here. The sub-tab that selects this panel is already
          labelled "Sensor Monitor" and sits directly above, so a heading
          repeating it named the same thing twice in adjacent rows. The KPI
          row is the header's content now. */}
      <div className="sp4-header">
        <div data-tour="page-kpis" className="sp4-header-kpis">
          <div
            className="sp4-kpi sp4-kpi--fleet"
            title={
              `${monitoredTotal} units have a Wialon tracker bound and reporting a connection verdict.` +
              (unboundCount > 0
                ? ` ${unboundCount} more exist on record but Wialon has no unit for them, so nothing here can monitor them.`
                : "")
            }
          >
            <span className="sp4-kpi-n">{monitoredTotal}</span>
            <span className="sp4-kpi-l">Units monitored</span>
          </div>
          <div
            className="sp4-kpi sp4-kpi--live"
            title={`${reportingNow} of ${monitoredTotal} tracked units sent a reading in the last hour. Same measure as the Sensor Coverage strip.`}
          >
            <span className="sp4-kpi-n">{reportingNow}</span>
            <span className="sp4-kpi-l">Reporting now</span>
          </div>
          <div
            className="sp4-kpi sp4-kpi--live"
            title={`${connectedNow} of ${monitoredTotal} tracked units hold a live connection right now, as Wialon's netconn reports it. Lower than "Reporting now" because a tracker can post a fix and then drop its session.`}
          >
            <span className="sp4-kpi-n">{connectedNow}</span>
            <span className="sp4-kpi-l">Connected</span>
          </div>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────── */}
      {/* Activity narrows the two LIVE tables — probes and fuel, by how
          recently the unit last moved. It does not reach the incident
          ledgers, which are paged from the server, so Speed and Malfunction
          get their own two groups below instead. Search does reach them
          (2026-10-21): the box is handed to IncidentReport, which sends it to
          the server so a unit on a later page is still found.

          On a phone the groups fold behind a Filters button and the search
          stays out — see FilterBar. The count is what is narrowed away from
          where each tab starts: Activity "all", today's date, the default sort,
          and no drain filter. A typed search is not counted; it is visible. */}
      <FilterBar
        peek={(
          <div className="sp4-search-wrap">
            <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="sp4-search"
              type="text"
              placeholder={isIncidentTab ? "Search plate or name…" : "Search vehicle reg…"}
              aria-label="Search units"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="sp4-search-clear" onClick={() => setSearch("")}>✕</button>}
          </div>
        )}
        activeCount={
          (!isIncidentTab && timeFilter !== "all" ? 1 : 0)
          + (isIncidentTab && incidentDay !== fleetDayKey() ? 1 : 0)
          + (isIncidentTab && incidentSort !== INCIDENT_SORTS[0].key ? 1 : 0)
          + (activeTab === "fuel" && fuelDay !== fleetDayKey() ? 1 : 0)
          + (activeTab === "fuel" && fuelFilter !== "all" ? 1 : 0)
        }
      >
        {!isIncidentTab && (
        <>
        <div className="sp4-filter-divider" />

        {/* Time filter */}
        <div className="sp4-filter-group">
          <span className="sp4-filter-label">Activity</span>
          {TIME_FILTERS.map(f => (
            <button key={f.key} className={"sp4-filter-chip" + (timeFilter === f.key ? " sp4-filter-chip--on" : "")} onClick={() => setTimeFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        </>
        )}

        {/* Speed- and Malfunction-tab filters — the same two-group shape the
            fuel tab uses one line down: the WINDOW first, then what to do
            within it. Same day picker, same bounds, same "Today" reset beside
            it, because a reader moving between these three tabs is asking one
            question about one day and should not have to re-learn the control
            each time. */}
        {isIncidentTab && (
          <>
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Day</span>
              <input
                type="date"
                className="sp4-date-input"
                value={incidentDay}
                /* Same two bounds the fuel picker sets, for the same two
                   reasons: no future days, because there is nothing there and
                   an empty table reads as a fault rather than as tomorrow; and
                   no days before capture, because those are outside the record
                   rather than quiet. */
                min={INCIDENT_MIN_DAY}
                max={fleetDayKey()}
                onChange={e => setIncidentDay(e.target.value || fleetDayKey())}
              />
              {incidentDay !== fleetDayKey() && (
                <button className="sp4-filter-chip" onClick={() => setIncidentDay(fleetDayKey())}>
                  Today
                </button>
              )}
            </div>
            <div className="sp4-filter-divider" />
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Sort</span>
              {INCIDENT_SORTS.map(f => (
                <button
                  key={f.key}
                  className={"sp4-filter-chip" + (incidentSort === f.key ? " sp4-filter-chip--on" : "")}
                  aria-pressed={incidentSort === f.key}
                  onClick={() => setIncidentSort(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Fuel-tab filter — only shown on the fuel tab */}
        {activeTab === "fuel" && (
          <>
            <div className="sp4-filter-divider" />
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Day</span>
              <input
                type="date"
                className="sp4-date-input"
                value={fuelDay}
                /* No future days: there is nothing there, and an empty table
                   reads as a fault rather than as tomorrow. */
                max={fleetDayKey()}
                onChange={e => setFuelDay(e.target.value || fleetDayKey())}
              />
              {fuelDay !== fleetDayKey() && (
                <button className="sp4-filter-chip" onClick={() => setFuelDay(fleetDayKey())}>
                  Today
                </button>
              )}
            </div>
            <div className="sp4-filter-divider" />
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Drains</span>
              {[
                { key: "all",        label: "All"        },
                // The two filters that matter now mirror the two colours: red
                // is fuel that went and did not come back, amber is fuel that
                // moved and returned. The old pair ("Suspicious"/"Unresolved")
                // split on whether we could CORROBORATE a drain, which is no
                // longer a distinction the table draws.
                { key: "loss",       label: "Suspicious drain" },
                { key: "undulating", label: "Undulating" },
              ].map(f => (
                <button
                  key={f.key}
                  className={"sp4-filter-chip" + (fuelFilter === f.key ? " sp4-filter-chip--on" : "")}
                  onClick={() => setFuelFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}

      </FilterBar>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="sp4-body">
        {/* A Fuel FSL unit opens in the app's detail sidebar (operator,
            2026-10-20: the Drivers page's panel, as on Alerts, Repairs, Speed
            and Malfunction), so the day's list stays beside it and another row
            swaps the unit in place. Wide: its drain table and summary strip
            are drawn to a chart's width. Probes still open in place. */}
        {fuelOpen && (
          <DetailSidebar
            title="Fuel events"
            label={`Fuel events, ${selectedAnomaly.vehicleName}`}
            itemKey={`${selectedAnomaly.vehicleId}|${fuelDay}`}
            onClose={closeSelected}
            wide
            footer={can("map:read") ? (
              <button type="button" className="sp4-ghost-btn"
                      onClick={() => { setDesktopActiveTab("fleet"); setPendingFocusId(selectedAnomaly.vehicleName); }}>
                <i className="ti ti-map-pin" aria-hidden="true" /> View on Map
              </button>
            ) : null}
          >
            <FuelDrainDetail
              /* Keyed by day: each drain row owns a telemetry fetch and reports
                 its loading up by index, and a fresh mount per day stops one
                 day's half-finished rows holding the next day's spinner open. */
              key={`${selectedAnomaly.vehicleId}|${fuelDay}`}
              vehicleId={selectedAnomaly.vehicleId}
              vehicleName={selectedAnomaly.vehicleName}
              orgId={orgId}
              fuelRow={selectedFuelRow}
              day={fuelDay}
              pending={fuelPending}
              error={fuelError}
              onReload={fuelReload}
              tank={fuelPending ? undefined : tankState[selectedAnomaly.vehicleId]}
              recordDay={selectedAnomaly.recordDay}
              onPickDay={setFuelDay}
              onClose={closeSelected}
              inPanel
            />
          </DetailSidebar>
        )}
        {/* A probe unit opens in the same sidebar (operator, 2026-10-20: "the
            probes to also be on the sidebar"): its repair line and the past
            hour's readings beside the list, at the shared sidebar width now
            that the readings table is four columns. */}
        {sensorOpen && (
          <DetailSidebar
            title="Sensor readings"
            label={`Sensor readings, ${selectedAnomaly.vehicleName}`}
            itemKey={selectedAnomaly.vehicleId}
            onClose={closeSelected}
            footer={can("map:read") ? (
              <button type="button" className="sp4-ghost-btn"
                      onClick={() => { setDesktopActiveTab("fleet"); setPendingFocusId(selectedAnomaly.vehicleName); }}>
                <i className="ti ti-map-pin" aria-hidden="true" /> View on Map
              </button>
            ) : null}
          >
            <SensorDetail
              key={selectedAnomaly.vehicleId}
              vehicleId={selectedAnomaly.vehicleId}
              vehicleName={selectedAnomaly.vehicleName}
              orgId={orgId}
              canSeeRepairs={can("repair:read")}
              canResolveRepairs={can("repair:resolve")}
              faulty={selectedIsFaulty}
              repairNonce={openRepairs.rows.length}
              onClose={closeSelected}
              inPanel
              lastReportedAt={selectedProbeRow ? selectedProbeRow.lastReportedAt ?? "" : null}
              // A unit with a repair already open moves through that job's
              // own controls, above; filing a second is refused anyway.
              reportActions={(can("repair:flag") || can("repair:resolve")) && selectedProbeRow && !openRepairs.byVehicle?.has(selectedProbeRow.vehicleId) ? (
                <ProbeReportActions
                  row={selectedProbeRow}
                  orgId={orgId}
                  onFiled={() => { openRepairs.reload(); probeHealth.reload(); }}
                />
              ) : null}
            />
          </DetailSidebar>
        )}
        {(
          <>
            <div data-tour="page-tabs" className="sp4-tabs">
              {tabs.map(t => (
                <button key={t.key} className={"sp4-tab" + (activeTab === t.key ? " sp4-tab--on" : "")} onClick={() => handleTabChange(t.key)}>
                  {t.label}
                  <span className="sp4-tab-n">{t.count}</span>
                </button>
              ))}
              <div className="sp4-tabs-hint">{tabs.find(t => t.key === activeTab)?.hint}</div>
            </div>

            {activeTab === "probes"      && <ProbeHealthPanel search={search} data={probeHealth.data} loading={probeHealth.loading} error={probeHealth.error} onReload={probeHealth.reload} onSelect={handleSelect} selectedId={selectedAnomaly?.vehicleId} openByVehicle={openRepairs.byVehicle} />}
            {activeTab === "fuel" && can("fuel_filling:read") && <FuelTable        flagged={fuelFlagged} tankState={tankState} day={fuelDay} loading={fuelPending} error={fuelError} onReload={fuelReload} {...filterProps} onSelect={handleSelect} selectedId={selectedAnomaly?.vehicleId} />}
            {activeTab === "speed" && can("analytics:read") && (
              <IncidentReport
                orgId={orgId}
                range={incidentRange}
                sort={incidentSort}
                summaryColumns={SPEED_SUMMARY_COLUMNS}
                detailColumns={SPEED_DETAIL_COLUMNS}
                fetchSummary={getSpeedingSummary}
                fetchDetail={getSpeedingIncidents}
                captureStartedAt={speedInsights?.captureStartedAt}
                caption={`Overspeeding incidents for ${incidentDayLabel}`}
                loadingLabel="Loading overspeeding incidents…"
                reportTitle="Sensor Monitor: Speed"
                panelTitle="Overspeeding cases"
                exportSlug={`speed-${incidentDay}-${incidentSort}`}
                selectedId={selectedAnomaly?.vehicleId}
                search={search}
                emptyLabel="No overspeeding recorded on this day."
              />
            )}
            {activeTab === "malfunction" && (
              <IncidentReport
                orgId={orgId}
                range={incidentRange}
                sort={incidentSort}
                summaryColumns={FAULT_SUMMARY_COLUMNS}
                detailColumns={FAULT_DETAIL_COLUMNS}
                fetchSummary={getFaultSummary}
                fetchDetail={getFaultEpisodes}
                captureStartedAt={faultInsights?.captureStartedAt}
                caption={`Sensor fault episodes for ${incidentDayLabel}`}
                loadingLabel="Loading sensor faults…"
                reportTitle="Sensor Monitor: Malfunction"
                panelTitle="Fault episodes"
                timeline
                exportSlug={`malfunction-${incidentDay}-${incidentSort}`}
                selectedId={selectedAnomaly?.vehicleId}
                search={search}
                emptyLabel="No sensor faults recorded on this day."
              />
            )}
            {/* The panel fetches its OWN list, because the bucket the reader
                picks has to reach the server — `openRepairs` is the open set
                and nothing else, and filtering it client-side for "Resolved"
                or "Unresolved" searched a list that could not contain them.
                `onReload` stays: a sign-off releases the unit, and the Probes
                table's badge has to clear with it. */}
            {activeTab === "repairs" && (
              <RepairJobsPanel
                orgId={orgId}
                onReload={openRepairs.reload}
                canResolve={can("repair:resolve")}
                canWorkAny={can("repair:work_any")}
                canAssign={canRepairAssign}
                currentUserId={user?.id ?? null}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}