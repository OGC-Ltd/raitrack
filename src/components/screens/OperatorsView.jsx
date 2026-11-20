// Drivers › Operators (operator 2026-11-19): Mufindi's machine operators from
// FactorySuite, in the Drivers page's design — the four-cell strip over the
// range, the full-width grid of operators, and a side panel for one operator.
//
// FactorySuite's own operator register is not open to our API key, so the
// roster is read off the work plans: each plan line puts up to three operators
// on a machine for a shift ("Operators: EMMANUEL VICENT MTULO - EXCAVATOR
// OPERATOR"), and the pump records who it fuelled (fleet-server
// planner/factory-operators.ts). Drivers come later, on the Analytics tab.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./DriversScreen.css";
import "./FuelScreen.css";
import { getFactoryOperators } from "../../api/factoryOperators";
import { periodRange, issueFlagged } from "../../lib/factoryFuel";
import { operatorsByDay, operatorTotals, operatorDepartments, machineKind, kindMix, sentence, nameCase, initials, onShiftNow } from "../../lib/factoryOperators";
import { planStage } from "../../lib/workPlanMap";
import { useApiData } from "../../hooks/useApiData";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import StaffLoading from "./StaffLoading";
import "./StaffFilters.css";
import TrendStat from "./TrendStat";
import FuelPeriodPicker from "./FuelPeriodPicker";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { DriversIcon } from "../footer/NavIcons";
import { claimSidePanel, onSidePanelClaim } from "../../lib/sidePanels";
import TablePager from "../body/TablePager";

const fmt = (n, d = 0) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const clock = (s) => /[T ](\d{2}:\d{2})/.exec(String(s ?? ""))?.[1] ?? "";
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

const ALL = "__all";
const GRID_CARDS_QUERY = "(max-width: 700px)";
const GRID_STEP = 15;
const GRID_STEP_PHONE = 10;
const BAR_KEYS = new Set(["shifts", "plannedHours", "days"]);
const GRID_METRICS = [
  { key: "shifts", label: "Shifts" },
  { key: "plannedHours", label: "Hours" },
  { key: "days", label: "Days" },
];

/** The subtitle the Drivers page shows over this tab. */
export function operatorsSubtitle({ data, rows, loading, company }) {
  if (loading && !data) return "Loading the operators…";
  if (!data?.from) return company;
  return `${plural(rows.length, "operator")} · ${data.from === data.to ? fmtDay(data.from) : `${fmtDay(data.from)} to ${fmtDay(data.to)}`} · ${company}`;
}

export default function OperatorsView({ companyId, company, onSubtitle }) {
  const [pick, setPick] = useState("today");
  const { from, to } = useMemo(() => periodRange(pick), [pick]);
  const { data, loading, error, retry } = useApiData(
    () => getFactoryOperators({ companyId, from, to }),
    [companyId, from, to],
    { cacheKey: `ft-factory-operators:${companyId}:${from}:${to}`, keepPreviousData: true },
  );

  const roster = useMemo(() => data?.operators ?? [], [data]);
  const [deptPick, setDeptPick] = useState(ALL);
  const deptOptions = useMemo(() => operatorDepartments(roster), [roster]);
  const dept = deptPick === ALL || deptOptions.some((o) => o.key === deptPick) ? deptPick : ALL;
  // On shift now (operator, 2026-11-19): only those on an approved plan line
  // covering this moment, re-judged each minute; picking it shows Today.
  const [onShift, setOnShift] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!onShift) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [onShift]);
  const rows = useMemo(() => roster.filter((o) => (dept === ALL || o.departments.includes(dept)) && (!onShift || onShiftNow(o, now))),
    [roster, dept, onShift, now]);
  const byDay = useMemo(() => operatorsByDay(data, rows), [data, rows]);
  const totals = useMemo(() => operatorTotals(rows), [rows]);

  useEffect(() => {
    onSubtitle?.(operatorsSubtitle({ data, rows, loading, company }));
  }, [onSubtitle, data, rows, loading, company]);

  const [selected, setSelected] = useState(null);
  const operator = selected ? roster.find((o) => o.key === selected) ?? null : null;
  const closeOperator = useCallback(() => setSelected(null), []);

  const noFactory = !loading && data && data.factory === null;
  const isEmpty = !loading && !noFactory && roster.length === 0;
  const half = Math.max(1, Math.floor(byDay.length / 2));
  const sub = byDay.length > 1 ? `last ${half}d vs previous ${half}d` : "";
  const busy = loading && !data;

  const rangePicker = (
    <>
      <FuelPeriodPicker pick={pick} onPick={(p) => { setPick(p); if (p !== "today") setOnShift(false); }} chips />
      {/* A button like Pick a day beside it, dark while on (DateRangePicker.css drp-field) */}
      <button type="button" className={`drp-field${onShift ? " drp-field--on" : ""}`} aria-pressed={onShift}
              title="Only the operators on an approved work plan shift at this moment"
              onClick={() => { setOnShift((v) => !v); setPick("today"); }}>
        <i className="ti ti-clock-play" aria-hidden="true" />
        <span className="drp-text">On shift</span>
      </button>
    </>
  );

  if (error) return <LoadError label="Operators" onRetry={retry} fullSection />;
  if (noFactory) {
    return <TabEmptyState icon={<DriversIcon size={44} />} title="Operators"
      hint="This organisation's FactorySuite factory keeps no work plans, so there are no operators to show." />;
  }

  return (
    <ErrorBoundary label="Operators">
      {busy ? (
        <StaffLoading what="operators" filters={rangePicker} />
      ) : isEmpty ? (
        <>
          <div className="dr-filters">{rangePicker}</div>
          <TabEmptyState icon={<DriversIcon size={44} />} title="Operators"
            hint={`No operator is named on a FactorySuite work plan or at the pump from ${fmtDay(from)} to ${fmtDay(to)}.`} />
        </>
      ) : (
        <>
          <div className="dr-layout">
            <section className="dr-strip" aria-label="All operators">
              <OperatorsCard totals={totals} loading={busy} />
              <TrendStat title="Shifts planned" series={byDay} valueKey="shifts" unit="shifts" tone="tonnes" type="bar"
                value={busy ? "-" : fmt(totals.shifts)} sub={sub} loading={busy}
                pointWords={(d) => `${fmtDay(d.day)} · ${fmt(d.hours)} h planned`} />
              <TrendStat title="Operators on shift" series={byDay} valueKey="operators" unit="a day" tone="mileage" type="line"
                value={busy ? "-" : fmt(Math.max(0, ...byDay.map((d) => d.operators)))} sub="most on one day"
                loading={busy} pointWords={(d) => `${fmtDay(d.day)} · ${plural(d.operators, "operator")}`} />
              <PumpCard totals={totals} loading={busy} />
            </section>
          </div>
          <OperatorsSection rows={rows} emptyWords={onShift ? "No operator is on shift now." : "No operators match."} selected={selected} onSelect={setSelected} rangePicker={rangePicker}
            deptPicker={<DeptPicker value={dept} options={deptOptions} total={roster.length} onChange={setDeptPick} />} />
        </>
      )}
      {operator && <OperatorPanel key={operator.key} o={operator} from={data?.from ?? from} to={data?.to ?? to} onClose={closeOperator} />}
    </ErrorBoundary>
  );
}

/** The roster cell: operators on the plans, and the kinds of work they do. */
function OperatorsCard({ totals, loading }) {
  if (loading) {
    return <div className="dr-cell dr-fleet"><div className="dr-cell__empty" aria-busy="true">Loading operators…</div></div>;
  }
  const facts = [
    { label: "Machines", value: fmt(totals.machines) },
    { label: "Hours planned", value: fmt(totals.hours) },
    { label: "Only seen at the pump", value: fmt(totals.pumpOnly) },
  ];
  // Two kinds and the rest: the strip has three calm colours (the fourth, low, is red).
  const TONES = ["good", "fair", "new"];
  const mix = kindMix(totals.kinds, 2).map((m, i) => ({ ...m, key: TONES[i] }));
  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head"><span className="dr-statchart__label">Operators</span></div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(totals.onPlans)}</span>
        <span className="dr-summary__caption">on work plans,<br />{plural(totals.departments, "department")}</span>
      </div>
      <dl className="dr-fleet__facts">
        {facts.map((f) => (
          <div key={f.label} className="dr-fleet__fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
        ))}
      </dl>
      <div className="dr-fleet__mix">
        <span className="dr-fleet__mixlabel">Mostly runs</span>
        <span className="dr-fleet__bar" role="img" aria-label={mix.map((m) => `${m.n} ${m.label}`).join(", ")}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.label} className={`dr-fleet__seg dr-fleet__seg--${m.key}`} style={{ flexGrow: m.n }} title={`${m.label}: ${plural(m.n, "operator")}`} />
          ))}
        </span>
        <ul className="dr-fleet__legend">
          {mix.map((m) => (
            <li key={m.label} className={`dr-fleet__key dr-fleet__key--${m.key}`}>
              <span className="dr-fleet__swatch" aria-hidden="true" />{m.label}<b>{fmt(m.n)}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The pump cell: fuellings that named an operator, and the pump's mismatch check. */
function PumpCard({ totals, loading }) {
  if (loading) {
    return <div className="dr-cell dr-summary"><div className="dr-cell__empty" aria-busy="true">Loading…</div></div>;
  }
  const clean = totals.fuellings > 0 && !totals.mismatches;
  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">At the pump</span>
        {clean && <span className="dr-summary__clean">Clean</span>}
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(totals.fuellings)}</span>
        <span className="dr-summary__caption">fuellings that<br />named an operator</span>
      </div>
      <div className="dr-summary__incidents">
        <div className={`dr-summary__incident${totals.mismatches ? " dr-summary__incident--speed" : ""}`}>
          <span className="dr-summary__dot" aria-hidden="true" />
          <span className="dr-summary__name">
            Operator mismatch
            {totals.mismatches > 0 && <span className="dr-summary__who"> · {plural(totals.mismatchOperators, "operator")}</span>}
          </span>
          <span className="dr-summary__count">{fmt(totals.mismatches)}</span>
        </div>
      </div>
    </div>
  );
}

function DeptPicker({ value, options, total, onChange }) {
  return (
    <label className="dr-typepick">
      <span className="dr-typepick__label">Department</span>
      <select className="dr-typepick__select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>All departments ({fmt(total)})</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({fmt(o.count)})</option>)}
      </select>
    </label>
  );
}

const machineWords = (o) => o.machines.map((m) => m.reference).join(", ");

function OperatorsSection({ rows, selected, onSelect, rangePicker, deptPicker, emptyWords = "No operators match." }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("shifts");
  const [sortDir, setSortDir] = useState("desc");
  const cardView = useMediaQuery(GRID_CARDS_QUERY);
  const step = cardView ? GRID_STEP_PHONE : GRID_STEP;
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((o) => !q || [o.name, o.role, machineWords(o), ...o.departments, ...o.supervisors]
    .some((v) => String(v ?? "").toLowerCase().includes(q)));
  const barMax = Math.max(1, ...rows.map((o) => o[sortKey] ?? 0));
  const sorted = [...filtered].sort((a, b) => {
    let cmp;
    if (sortKey === "name") cmp = a.name.localeCompare(b.name);
    else if (sortKey === "department") cmp = String(a.departments[0] ?? "~").localeCompare(String(b.departments[0] ?? "~"));
    else if (sortKey === "machines") cmp = machineWords(a).localeCompare(machineWords(b), undefined, { numeric: true });
    else if (sortKey === "period") cmp = String(a.lastDay ?? "").localeCompare(String(b.lastDay ?? ""));
    else if (sortKey === "fuellings") cmp = a.fuellings.length - b.fuellings.length;
    else cmp = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
    return sortDir === "asc" ? cmp : -cmp;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / step));
  const at = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(at * step, at * step + step);
  const ranked = BAR_KEYS.has(sortKey);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(["name", "department", "machines"].includes(key) ? "asc" : "desc"); }
    setPage(0);
  };
  const rankBy = (key) => { setSortKey(key); setSortDir("desc"); setPage(0); };
  const th = (label, k, num = false) => <GridTh label={label} k={k} sortKey={sortKey} dir={sortDir} onClick={toggleSort} num={num} />;

  return (
    <>
      <div className="dr-filters">
        <div className="dr-filters__chips" role="group" aria-label="Rank operators by">
          <span className="dr-rankby__label" aria-hidden="true">Rank by</span>
          <span className="dr-seg">
            {GRID_METRICS.map((m) => (
              <button key={m.key} type="button" className={`dr-chip${sortKey === m.key ? " dr-chip--active" : ""}`}
                aria-pressed={sortKey === m.key} onClick={() => rankBy(m.key)}>{m.label}</button>
            ))}
          </span>
        </div>
        {rangePicker}
        {/* Department and search as one group: the row's right-hand end, or a line
            of its own, whole (StaffFilters.css). */}
        <div className="dr-filters__tools stf-tools">
          {deptPicker}
          <div className="dr-searchwrap">
            <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input className="dr-search" value={query} aria-label="Search operators"
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search operator, machine, role or supervisor…" />
          </div>
        </div>
      </div>

      <div className="dr-grid-card">
        <div className="dr-grid-scroll">
          <table className="dr-grid">
            <thead>
              <tr>
                {th("Operator", "name")}
                {th("Department", "department")}
                {th("Machines", "machines")}
                {th("Period", "period")}
                {th("Shifts", "shifts", true)}
                {th("Hours", "plannedHours", true)}
                {th("Days", "days", true)}
                {th("Fuellings", "fuellings", true)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o, i) => {
                const pos = at * step + i;
                const rank = sortDir === "desc" ? pos + 1 : sorted.length - pos;
                const on = o.key === selected;
                return (
                  <tr key={o.key} className={on ? "dr-grid__row--selected" : ""} tabIndex={0} aria-selected={on}
                      onClick={() => onSelect(o.key)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(o.key); } }}>
                    <td className="dr-drivercell">
                      <span className="dr-driver">
                        <span className="dr-rank" aria-label={ranked ? `Rank ${rank}` : undefined}>{ranked ? rank : ""}</span>
                        <span className="dr-avatar">{initials(o.name)}</span>
                        <span className="dr-driver__ident">
                          <span className="dr-driver__name">{nameCase(o.name)}</span>
                          <span className="dr-driver__sub">{sentence(o.role) || machineKind(o)}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Department">
                      <span className="fuel-dept">{o.departments.map(sentence).join(", ") || "-"}</span>
                    </td>
                    <td data-label="Machines" title={o.machines.map((m) => [m.reference, m.name, m.plate].filter(Boolean).join(" ")).join("\n")}>
                      <span className="fuel-dept">{o.machines.slice(0, 3).map((m) => m.reference).join(", ") || "-"}</span>
                      {o.machines.length > 3 && <span className="dr-driver__sub">+{fmt(o.machines.length - 3)} more</span>}
                      {o.machines.length > 0 && o.machines.length <= 3 && o.machines[0].name && (
                        <span className="dr-driver__sub">{o.machines[0].name}</span>
                      )}
                    </td>
                    <td className={`dr-when${o.lastDay ? "" : " dr-when--none"}`} data-label="Period"
                        title={o.days ? `${plural(o.days, "day")} on a plan or at the pump` : undefined}>
                      {!o.lastDay ? "-" : o.firstDay && o.firstDay !== o.lastDay ? `${fmtDay(o.firstDay)} – ${fmtDay(o.lastDay)}` : fmtDay(o.lastDay)}
                    </td>
                    <MetricCell label="Shifts" k="shifts" value={o.shifts} sortKey={sortKey} max={barMax} />
                    <MetricCell label="Hours" k="plannedHours" value={o.plannedHours || null} sortKey={sortKey} max={barMax} />
                    <MetricCell label="Days" k="days" value={o.days} sortKey={sortKey} max={barMax} />
                    <td className={"dr-num" + (o.fuellings.length ? "" : " dr-num--zero") + (o.mismatches ? " dr-incident dr-incident--speed" : "")}
                        data-label="Fuellings"
                        title={o.mismatches ? `${plural(o.mismatches, "fuelling")} flagged as the wrong operator for the machine` : undefined}>
                      {o.mismatches > 0 && <span className="dr-incident__dot" aria-hidden="true" />}
                      {o.fuellings.length ? fmt(o.fuellings.length) : "-"}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td colSpan={8} className="dr-grid__empty">{q ? "No operators match." : emptyWords}</td></tr>}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <TablePager label="Operator pages" pager={{
            page: at, pageCount, total: sorted.length,
            from: sorted.length ? at * step + 1 : 0, to: at * step + pageRows.length, setPage,
          }} />
        )}
      </div>
    </>
  );
}

function GridTh({ label, k, sortKey, dir, onClick, num }) {
  const active = sortKey === k;
  return (
    <th className={num ? "dr-num" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="dr-grid__sort" onClick={() => onClick(k)} title={`Sort by ${label.toLowerCase()}`}>
        <span>{label}</span>
        <span className={"dr-caret" + (active ? ` dr-caret--${dir}` : "")} aria-hidden="true" />
      </button>
    </th>
  );
}

function MetricCell({ label, k, value, sortKey, max }) {
  const barred = BAR_KEYS.has(k) && sortKey === k;
  if (value == null) return <td className="dr-num dr-num--zero" data-label={label}>-</td>;
  return (
    <td className={"dr-num" + (barred ? " dr-num--ranked" : "")} data-label={label}>
      <span className="dr-metric">
        <span className="dr-metric__num">{fmt(value)}</span>
        {barred && (
          <span className="dr-metric__track" aria-hidden="true">
            <span className="dr-metric__fill" style={{ "--share": Math.max(0, Math.min(value / max, 1)) }} />
          </span>
        )}
      </span>
    </td>
  );
}

function DayBlock({ day }) {
  const d = new Date(`${day}T00:00:00Z`);
  return (
    <span className="dr-dayblock" aria-hidden="true">
      <span className="dr-dayblock__d">{d.getUTCDate()}</span>
      <span className="dr-dayblock__m">{d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
    </span>
  );
}

const SEAT = { 2: "second operator", 3: "third operator" };

/** One operator, down the right of the page: their machines, shifts and fuellings. */
function OperatorPanel({ o, from, to, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    claimSidePanel("operator");
    return onSidePanelClaim("operator", () => closeRef.current?.());
  }, []);

  const series = useMemo(() => operatorsByDay({ from, to }, [o]), [o, from, to]);
  const headline = [
    { label: "Shifts", value: fmt(o.shifts) },
    { label: "Hours planned", value: fmt(o.plannedHours), unit: "h" },
    { label: "Days", value: fmt(o.days) },
  ];

  return (
    <aside className="dr-panel" role="dialog" aria-label={`${nameCase(o.name)}, operator details`}>
      <header className="dr-panel__head">
        <span className="dr-panel__title">Operator</span>
        <button type="button" className="dr-panel__x" onClick={onClose} aria-label="Close operator details">×</button>
      </header>

      <div className="dr-panel__body">
        <section className="dr-idcard" aria-label="Operator">
          <div className="dr-idcard__who">
            <span className="dr-profile__avatar dr-idcard__avatar">{initials(o.name)}</span>
            <div className="dr-panel__ident">
              <div className="dr-profile__namerow"><span className="dr-panel__name">{nameCase(o.name)}</span></div>
              <div className="dr-profile__meta">{sentence(o.role) || `${machineKind(o)} operator`}</div>
            </div>
          </div>
          <dl className="dr-idcard__facts">
            <div><dt>Mostly runs</dt><dd>{machineKind(o)}</dd></div>
            <div><dt>Department</dt><dd>{o.departments.map(sentence).join(", ") || "-"}</dd></div>
            <div><dt>Supervisor</dt><dd>{o.supervisors.join(", ") || "-"}</dd></div>
            <div><dt>Last on a plan</dt><dd>{o.lastDay ? fmtDay(o.lastDay) : "-"}</dd></div>
          </dl>
          <p className="dr-panel__note">From FactorySuite work plans. Staff number, phone and licence are not shared with us yet.</p>
        </section>

        <section className="dr-panel__sec">
          <h3 className="dr-panel__h">{fmtDay(from)} to {fmtDay(to)}</h3>
          <dl className="dr-window__lead">
            {headline.map((x) => (
              <div key={x.label}><dt>{x.label}</dt><dd>{x.value}{x.unit && <span className="dr-window__unit"> {x.unit}</span>}</dd></div>
            ))}
          </dl>
        </section>

        {o.shifts > 0 && (
          <section className="dr-panel__sec dr-panel__charts">
            <TrendStat title="Shifts per day" series={series} valueKey="shifts" unit="shifts" tone="tonnes" type="bar"
              value={fmt(o.shifts)} sub={plural(o.days, "day") + " worked"} />
          </section>
        )}

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">Machines<span className="dr-panel__count">{fmt(o.machines.length)}</span></h3>
          <ul className="dr-cases">
            {o.machines.map((m) => (
              <li key={m.reference} className="dr-case">
                <span className="dr-case__body">
                  <span className="dr-case__line">
                    <b className="dr-case__qty">{m.reference}</b>
                    <span className="dr-case__plate">{[m.name, m.plate].filter(Boolean).join(", ") || "Not in the register"}</span>
                    <span className="dr-case__time">{m.shifts ? plural(m.shifts, "shift") : "pump only"}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">Work plan shifts<span className="dr-panel__count">{fmt(o.lines.length)}</span></h3>
          {o.lines.length === 0 ? (
            <p className="dr-panel__note">On no work plan in this range; seen only at the pump.</p>
          ) : (
            <ul className="dr-cases">
              {o.lines.map((l) => (
                <li key={`${l.lineId}|${l.day}|${l.seat}`} className="dr-case">
                  <DayBlock day={l.day} />
                  <span className="dr-case__body">
                    <span className="dr-case__line">
                      <b className="dr-case__qty">{l.machine}</b>
                      <span className="dr-case__plate">{l.activity}</span>
                      <span className="dr-case__time">{l.shiftStart ? `Shift ${l.shiftNo ?? 1}, ${l.shiftStart.slice(0, 5)}` : `Shift ${l.shiftNo ?? 1}`}</span>
                    </span>
                    <span className="dr-case__sub">
                      {[l.workLocation && `At ${l.workLocation}`,
                        l.plannedKm != null ? `${fmt(l.plannedKm)} km` : l.plannedHours != null ? `${fmt(l.plannedHours)} h` : null,
                        l.supervisor && `supervisor ${nameCase(l.supervisor)}`,
                        SEAT[l.seat]].filter(Boolean).join(", ")}
                    </span>
                    <span className="dr-case__sub fuel-case__plan">
                      {l.planCode}, {sentence(l.department)}, {planStage(l.planStatus) === "PENDING" ? "pending approval" : sentence(l.planStatus)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">
            At the pump
            <span className={`dr-panel__count${o.mismatches ? " dr-panel__count--theft" : ""}`}>{fmt(o.fuellings.length)}</span>
          </h3>
          {o.fuellings.length === 0 ? (
            <p className="dr-panel__note">The pump named this operator on no fuelling in this range.</p>
          ) : (
            <ul className="dr-cases">
              {o.fuellings.map((i) => (
                <li key={i.id} className={`dr-case${issueFlagged(i) ? " dr-case--on" : ""}`}>
                  <DayBlock day={i.day} />
                  <span className="dr-case__body">
                    <span className="dr-case__line">
                      <b className="dr-case__qty">{i.done ? `${fmt(i.litres)} L` : "Fuelling"}</b>
                      <span className="dr-case__plate">{i.machine}</span>
                      <span className="dr-case__time">{clock(i.at)}</span>
                    </span>
                    <span className="dr-case__sub">{[i.activity, [i.tank, i.pump].filter(Boolean).join(", ")].filter(Boolean).join(", ")}</span>
                    {issueFlagged(i) && (
                      <span className="dr-case__sub fuel-case__flag">{[...(i.flags ?? []), i.note && sentence(i.note)].filter(Boolean).join(". ")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
