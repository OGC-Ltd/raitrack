/* Hallmark · redesign · genre: modern-minimal · macrostructure: Workbench
 * tone: utilitarian · anchor hue: in-project --chart-* (preserved)
 * states: default · hover · focus · active · sorted · filtered · empty · loading
 * pre-emit critique: P5 H5 E4 S5 R4 V5
 */

import { useMemo, useState } from "react";

/**
 * The four states displayed in the rail and on rows.
 * - In Transit  : engine on, moving (speed > threshold)
 * - Stationary  : engine on, not moving (speed ≤ threshold) – includes both
 *                 the old STATIONARY (plant and tractors, whose work is done
 *                 standing still) and IDLING (road vehicles, where it is waste).
 * - Parked      : reporting, engine off
 * - Offline     : no recent report
 */
const STATES = [
  { key: "WORKING",    label: "In Transit", color: "var(--chart-3)" },
  { key: "STATIONARY", label: "Stationary", color: "var(--chart-7)" },
  { key: "PARKED",     label: "Parked",     color: "var(--chart-1)" },
  { key: "OFFLINE",    label: "Offline",    color: "var(--chart-8)" },
];

/**
 * Sortable columns, keyed to the row field they read.
 */
const COLS = [
  { key: "plate",                label: "Unit",       align: "l", type: "text" },
  { key: "state",                label: "State",      align: "l", type: "text" },
  // ─── Operational Status ─────────────────────────────────────────────
  { key: "operational",          label: "Status",     align: "l", type: "text",
    hint: "Operational if hours today > 0" },
  // ─── Hours ──────────────────────────────────────────────────────────
  { key: "hoursToday",           label: "Hours",      align: "r", type: "num", hint: "Hours run today" },
  { key: "hoursWeekAvg",         label: "Wk avg",     align: "r", type: "num", hint: "Mean hours per reporting day, this week" },
  { key: "hoursMonthAvg",        label: "SPAN avg",   align: "r", type: "num", win: true, hint: "Mean hours per reporting day over WINDOW" },
  { key: "stationaryHoursToday", label: "Stationary", align: "r", type: "num", hint: "Engine on, not moving" },
  { key: "idleHoursToday",       label: "Idle",       align: "r", type: "num", hint: "Stationary where travel is the work" },
  // Fuel, on every category.
  { key: "fuelBurnL",     label: "Fuel L",  align: "r", type: "num", win: true,
    hint: "Litres over WINDOW, modelled from this unit's own burn rate" },
  { key: "litresPerHour", label: "L/hr",    align: "r", type: "num", hint: "Litres per engine hour" },
  { key: "sensorHealth",  label: "Sensor",  align: "l", type: "text", hint: "Fuel probe and tracker health" },
];

/** Swapped in when the filter is excavators — distance is noise on a machine
 *  that covers 0.55 km per engine hour, and area is noise on a truck. */
const AREA_COLS = [
  { key: "areaKm2",         label: "km² day", align: "r", type: "num", hint: "Last complete day, ground the bucket could reach" },
  { key: "areaWeekAvgKm2",  label: "km² wk",  align: "r", type: "num", hint: "Mean per day measured digging, this week" },
  { key: "areaMonthAvgKm2", label: "km² SPAN", align: "r", type: "num", win: true, hint: "Mean per day measured digging over WINDOW" },
  { key: "km2PerHour",      label: "km²/hr",  align: "r", type: "num", hint: "Ground per digging hour, last complete day" },
  { key: "hectares",         label: "ha",     align: "r", type: "num", win: true, hint: "Hectares the bucket covered over WINDOW" },
  { key: "litresPerHectare", label: "L/ha",   align: "r", type: "num", hint: "Litres per hectare worked, separates deep digging from surface work" },
];

const DIST_COLS = [
  { key: "distanceTodayKm",    label: "km",     align: "r", type: "num" },
  { key: "distanceWeekAvgKm",  label: "km wk",  align: "r", type: "num" },
  { key: "distanceMonthAvgKm", label: "km SPAN", align: "r", type: "num", win: true, hint: "Mean per reporting day over WINDOW" },
  { key: "litresPerKm",        label: "L/km",   align: "r", type: "num", hint: "Litres per kilometre, travel units only" },
];

const fmt = (n, d = 0) =>
  n == null ? "-" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

const fmtFleetDay = (day) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB",
        { day: "numeric", month: "short", timeZone: "UTC" })
    : "-";

export default function FleetStateSection({ state, area, windowSpan, windowLabel }) {
  const [cat, setCat]     = useState("all");
  const [stateFilter, setStateFilter] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort]   = useState({ key: "hoursToday", dir: "desc" });

  const counts = state?.counts ?? {};
  // We merge IDLING into STATIONARY for display in the rail.
  const mergedStationaryCount = (counts.STATIONARY ?? 0) + (counts.IDLING ?? 0);
  const total = STATES.reduce((a, s) => {
    if (s.key === "STATIONARY") return a + mergedStationaryCount;
    return a + (counts[s.key] ?? 0);
  }, 0);

  const areaByPlate = useMemo(() => {
    const m = new Map();
    for (const u of area?.units ?? []) m.set(u.plate, u);
    return m;
  }, [area]);

  const showArea = cat === "EX";

  const fleetAreaAvg = useMemo(() => {
    const v = (state?.units ?? [])
      .map(u => u.areaMonthAvgKm2)
      .filter(x => x != null);
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
  }, [state]);

  const cols = useMemo(
    () => [...COLS, ...(showArea ? AREA_COLS : DIST_COLS)].map((c) => (
      c.win
        ? {
            ...c,
            label: c.label.replace("SPAN", windowSpan ?? "period"),
            hint:  c.hint?.replace("WINDOW", windowLabel ?? "the selected period"),
          }
        : c
    )),
    [showArea, windowSpan, windowLabel],
  );

  const categories = state?.byCategory ?? [];

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    let out = (state?.units ?? []).map((u) => {
      const a = areaByPlate.get(u.plate);
      const op = u.hoursToday != null && u.hoursToday > 0;
      return {
        ...u,
        areaKm2:    a ? a.areaM2 / 1e6 : null,
        digHours:   a?.digHours ?? null,
        km2PerHour: a ? a.m2PerHour / 1e6 : null,
        operational: op,
      };
    });
    if (cat !== "all")   out = out.filter(u => u.category === cat);
    if (stateFilter) {
      if (stateFilter === 'STATIONARY_GROUP') {
        out = out.filter(u => u.state === 'STATIONARY' || u.state === 'IDLING');
      } else {
        out = out.filter(u => u.state === stateFilter);
      }
    }
    if (q)               out = out.filter(u => (u.plate ?? "").toUpperCase().includes(q));

    const col = [...COLS, ...AREA_COLS, ...DIST_COLS].find(c => c.key === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((x, y) => {
      const a = x[sort.key], b = y[sort.key];
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (sort.key === "operational") {
        return (a === b ? 0 : a ? -1 : 1) * dir;
      }
      return col?.type === "num"
        ? (a - b) * dir
        : String(a).localeCompare(String(b)) * dir;
    });
  }, [state, areaByPlate, cat, stateFilter, query, sort]);

  const toggleSort = (key) =>
    setSort(s => s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "plate" || key === "state" || key === "operational" ? "asc" : "desc" });

  const filtered = cat !== "all" || stateFilter || query.trim();

  return (
    <div className="an-card an-card--wide an-fleet">
      <div className="an-card__head">
        <span className="an-card__title">Fleet state</span>
        <span className="an-card__hint">
          {state
            ? <>{fmt(rows.length)}{filtered ? ` of ${fmt(state?.units?.length ?? 0)}` : ""} units · live
                {windowLabel ? <> · totals over {windowLabel}</> : null}</>
            : "loading…"}
        </span>
      </div>

      {/* State rail */}
      <div className="an-rail" role="group" aria-label="Filter by state">
        {STATES.map((s) => {
          let n;
          if (s.key === "STATIONARY") {
            n = mergedStationaryCount;
          } else {
            n = counts[s.key] ?? 0;
          }
          if (n === 0) return null;
          const on = stateFilter === s.key || (s.key === "STATIONARY" && stateFilter === "STATIONARY_GROUP");
          return (
            <button
              key={s.key}
              type="button"
              className={"an-rail__seg" + (on ? " an-rail__seg--on" : "")}
              style={{ "--seg": s.color, flexGrow: n }}
              aria-pressed={on}
              onClick={() => {
                if (s.key === "STATIONARY") {
                  setStateFilter(on ? null : "STATIONARY_GROUP");
                } else {
                  setStateFilter(on ? null : s.key);
                }
              }}
              title={`${s.label}: ${fmt(n)} of ${fmt(total)}, click to ${on ? "clear" : "filter"}`}
            >
              <span className="an-rail__bar" />
              <span className="an-rail__k">{s.label}</span>
              <span className="an-rail__v">{fmt(n)}</span>
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="an-fleet__bar">
        <div className="an-fleet__search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a plate…"
            aria-label="Find a plate"
            className="an-fleet__input"
          />
        </div>

        <div className="an-fleet__cats">
          <button
            type="button"
            className={"an-chip" + (cat === "all" ? " an-chip--on" : "")}
            aria-pressed={cat === "all"}
            onClick={() => setCat("all")}
          >All <span>{fmt(state?.units?.length ?? 0)}</span></button>
          {categories.slice(0, 8).map((c) => {
            const n = c.working + c.idling + c.parked + c.offline;
            return (
              <button
                key={c.category}
                type="button"
                className={"an-chip" + (cat === c.category ? " an-chip--on" : "")}
                aria-pressed={cat === c.category}
                onClick={() => setCat(c.category)}
                title={`${c.working} In Transit · ${c.idling} Stationary · ${c.parked} Parked · ${c.offline} Offline`}
              >{c.category} <span>{n}</span></button>
            );
          })}
        </div>

        {filtered && (
          <button type="button" className="an-chip an-chip--clear" onClick={() => {
            setCat("all"); setStateFilter(null); setQuery("");
          }}>Clear</button>
        )}
      </div>

      <div className="an-fleet__scroll">
        <table className="an-tbl">
          <thead>
            <tr>
              {cols.map((c) => {
                const on = sort.key === c.key;
                return (
                  <th key={c.key} className={c.align === "r" ? "r" : ""}
                      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="an-tbl__sort" onClick={() => toggleSort(c.key)}
                            title={c.hint ? `${c.hint}, click to sort` : "Click to sort"}>
                      <span>{c.label}</span>
                      <span className={"an-tbl__caret" + (on ? ` an-tbl__caret--${sort.dir}` : "")} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="an-tbl__empty">
                {state ? "No unit matches these filters." : "Loading fleet state…"}
              </td></tr>
            ) : rows.slice(0, 120).map((u) => (
              <tr key={u.vehicleId} tabIndex={0}>
                <td>
                  <span className="an-tbl__plate">{u.plate}</span>
                  <span className="an-tbl__cat">{u.category}</span>
                </td>
                <td><StatePill state={u.state} /></td>
                <td><OperationalPill operational={u.operational} hours={u.hoursToday} /></td>
                <td className="r">{fmt(u.hoursToday, 1)}</td>
                <td className="r">{fmt(u.hoursWeekAvg, 1)}</td>
                <td className="r">{fmt(u.hoursMonthAvg, 1)}</td>
                <td className="r">{fmt(u.stationaryHoursToday, 1)}</td>
                <td className="r">
                  {u.idleHoursToday == null
                    ? <span className="an-tbl__na" title="Not idle time on this machine: its work is done standing still. Plant and tractors, see Stationary beside it">-</span>
                    : fmt(u.idleHoursToday, 1)}
                </td>
                <td className="r">{fmt(u.fuelBurnL)}</td>
                <td className="r">{fmt(u.litresPerHour, 1)}</td>
                <td><SensorPill health={u.sensorHealth} /></td>
                {showArea ? (
                  <>
                    <td className="r">{fmt(u.areaKm2, 4)}</td>
                    <td className="r">{u.areaWeekAvgKm2 == null
                      ? <span className="an-tbl__na" title="Not measured digging this week">-</span>
                      : fmt(u.areaWeekAvgKm2, 4)}</td>
                    <td className="r">{u.areaMonthAvgKm2 == null
                      ? <span className="an-tbl__na" title="Not measured digging this month">-</span>
                      : fmt(u.areaMonthAvgKm2, 4)}</td>
                    <td className="r">{fmt(u.km2PerHour, 4)}</td>
                    <td className="r">{fmt(u.hectares, 1)}</td>
                    <td className="r">{fmt(u.litresPerHectare)}</td>
                  </>
                ) : (
                  <>
                    <td className="r">{fmt(u.distanceTodayKm)}</td>
                    <td className="r">{fmt(u.distanceWeekAvgKm, 1)}</td>
                    <td className="r">{fmt(u.distanceMonthAvgKm, 1)}</td>
                    <td className="r">
                      {u.litresPerKm == null
                        ? <span className="an-tbl__na" title="Not a rate for this machine: its work is not the kilometres. Plant reports almost none, position freezes at speed 0, and a tractor's fuel goes into the field rather than the travel. Read L/hr instead">-</span>
                        : fmt(u.litresPerKm, 1)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="an-fleet__foot">
        {area?.units?.length > 0 && (
          <span>
            Excavators worked <b>{fmt(area.totalM2 / 1e6, 4)} km²</b> on{" "}
            {fmtFleetDay(area.day)}, across {area.units.length} machines at {area.reachMetres} m reach
            {fleetAreaAvg != null && (
              <>, averaging <b>{fmt(fleetAreaAvg, 4)} km²</b> per machine per day it dug, this month</>
            )}.
          </span>
        )}
      </div>
    </div>
  );
}

/** Sensor pills */
const SENSOR = {
  OK:             { label: "OK",        tone: "work", title: "Fuel probe reporting and calibrated" },
  DIED:           { label: "Dead",      tone: "off",  title: "Probe stopped reporting, workshop job" },
  SILENT:         { label: "Silent",    tone: "off",  title: "Probe quiet on a unit that is still reporting" },
  UNCALIBRATED:   { label: "No cal.",   tone: "idle", title: "Fitted but carries no calibration table" },
  TRACKER_SILENT: { label: "No signal", tone: "off",  title: "The tracker itself has said nothing" },
  NOT_FITTED:     { label: "None",      tone: "park", title: "No fuel sensor on this unit" },
  UNKNOWN:        { label: "Too few",   tone: "park", title: "Too little telemetry to judge" },
};

function SensorPill({ health }) {
  if (!health) return <span className="an-tbl__na">-</span>;
  const s = SENSOR[health] ?? SENSOR.UNKNOWN;
  return <span className={`an-pill an-pill--${s.tone}`} title={s.title}>{s.label}</span>;
}

function StatePill({ state }) {
  let tone, label;
  switch (state) {
    case "WORKING":
      tone = "work";
      label = "In Transit";
      break;
    case "STATIONARY":
    case "IDLING":
      tone = "stat";
      label = "Stationary";
      break;
    case "PARKED":
      tone = "park";
      label = "Parked";
      break;
    case "OFFLINE":
      tone = "off";
      label = "Offline";
      break;
    default:
      tone = "park";
      label = state?.charAt(0) + state?.slice(1).toLowerCase() || "Unknown";
  }
  return <span className={`an-pill an-pill--${tone}`}>{label}</span>;
}

function OperationalPill({ operational, hours }) {
  const isOp = operational === true;
  const tone = isOp ? "work" : "off";
  const label = isOp ? "Operational" : "Non‑op";
  const title = isOp
    ? "Has run today (hours > 0)"
    : hours == null ? "No hours recorded today" : "No run time today";
  return <span className={`an-pill an-pill--${tone}`} title={title}>{label}</span>;
}