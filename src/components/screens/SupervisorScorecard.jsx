// Scorecard › Supervisors (operator 2026-11-19: "work on the supervisor
// alignment to the machines they have assigned and the shift they have
// assigned — the goal is to derive the performing supervisors"; first,
// "populate the supervisors records on the score card").
//
// Drawn as the Operators tab is (operator 2026-11-19: "use the same design as
// the operators page"): the four-cell strip over the period, the ranked grid
// under the Rank by chips, and the side panel a row opens (operator: "whenever
// I click on a line the data should appear on the side panel").
//
// One row per FactorySuite supervisor named on the work plans: the machines
// and shifts they had, the hours those lines planned and the hours the
// machines ran in them (fleet-server planner/factory-supervisors), with the
// lines that did not run and the late starts. Rank by orders the grid; no
// badge says who performs until the operator settles how that is judged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./DriversScreen.css";
import "./FuelScreen.css";
import "./SupervisorScorecard.css";
import { getFactorySupervisors } from "../../api/factorySupervisors";
import { periodRange } from "../../lib/factoryFuel";
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
import { downloadTableCsv } from "../../utils/tableExport";
import { claimSidePanel, onSidePanelClaim } from "../../lib/sidePanels";
import {
  LINE_STATE, linesByDay, nameCase, operatorName, shiftLabel,
  supervisorDepartments, supervisorsByDay, supervisorTotals,
} from "../../lib/factorySupervisors";

const ALL = "__all";
const GRID_CARDS_QUERY = "(max-width: 700px)";
const GRID_STEP = 15;
const GRID_STEP_PHONE = 10;
/** The figures Rank by orders the grid on; the ranked column draws its bar. */
const BAR_KEYS = new Set(["lines", "runHours", "deliveredPct"]);
const GRID_METRICS = [
  { key: "lines", label: "Plan lines" },
  { key: "runHours", label: "Hours run" },
  { key: "deliveredPct", label: "Delivered" },
];

const fmt = (n, dp = 0) => (n == null || !Number.isFinite(n) ? "-" : n.toLocaleString("en-KE", { maximumFractionDigits: dp, minimumFractionDigits: 0 }));
const hrs = (n) => (n == null ? "-" : `${fmt(n, 1)} h`);
const pct = (n) => (n == null ? "-" : `${fmt(n)}%`);
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
const initialsOf = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" }) : "-");
const shortDay = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "-");
const sentence = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "");

export default function SupervisorScorecard({ companyId, lead = null }) {
  const [pick, setPick] = useState(7);
  const { from, to } = useMemo(() => periodRange(pick), [pick]);
  const { data, loading, error, retry } = useApiData(
    () => getFactorySupervisors({ companyId, from, to }),
    [companyId, from, to],
    { cacheKey: `ft-factory-supervisors:${companyId}:${from}:${to}`, keepPreviousData: true },
  );

  const roster = useMemo(() => data?.supervisors ?? [], [data]);
  const [deptPick, setDeptPick] = useState(ALL);
  const deptOptions = useMemo(() => supervisorDepartments(roster), [roster]);
  const dept = deptPick === ALL || deptOptions.some((o) => o.key === deptPick) ? deptPick : ALL;
  const rows = useMemo(() => (dept === ALL ? roster : roster.filter((s) => s.departments.includes(dept))), [roster, dept]);
  const byDay = useMemo(() => supervisorsByDay(data, rows), [data, rows]);
  const totals = useMemo(() => supervisorTotals(rows), [rows]);

  const [selected, setSelected] = useState(null);
  const supervisor = selected ? roster.find((s) => s.key === selected) ?? null : null;
  const closePanel = useCallback(() => setSelected(null), []);

  const noFactory = !loading && data && data.factory === null;
  const isEmpty = !loading && !noFactory && roster.length === 0;
  const half = Math.max(1, Math.floor(byDay.length / 2));
  const sub = byDay.length > 1 ? `last ${half}d vs previous ${half}d` : "";
  const busy = loading && !data;
  const late = data?.rules?.lateStartMinutes ?? 60;

  const rangePicker = <FuelPeriodPicker pick={pick} onPick={setPick} chips />;

  if (error && !data) return <LoadError label="Supervisor scorecard" onRetry={retry} fullSection />;
  if (noFactory) {
    return <TabEmptyState icon={<DriversIcon size={44} />} title="Supervisors"
      hint="This organisation's FactorySuite factory keeps no work plans, so there are no supervisors to show." />;
  }

  return (
    <ErrorBoundary label="Supervisors">
      {busy ? (
        <StaffLoading what="supervisors" cols={6} filters={<>{lead}{rangePicker}</>} />
      ) : isEmpty ? (
        <>
          <div className="dr-filters">{lead}{rangePicker}</div>
          <TabEmptyState icon={<DriversIcon size={44} />} title="Supervisors"
            hint={`No FactorySuite work plan names a supervisor from ${shortDay(from)} to ${shortDay(to)}.`} />
        </>
      ) : (
        <>
          <div className="dr-layout">
            <section className="dr-strip" aria-label="All supervisors">
              <SupervisorsCard totals={totals} loading={busy} />
              <TrendStat title="Hours run" series={byDay} valueKey="run" unit="h" tone="tonnes" type="bar"
                value={busy ? "-" : fmt(totals.runHours)} sub={sub} loading={busy}
                pointWords={(d) => `${shortDay(d.day)} · ${fmt(d.run, 1)} of ${fmt(d.planned, 1)} h planned`} />
              <TrendStat title="Supervisors on shift" series={byDay} valueKey="supervisors" unit="a day" tone="mileage" type="line"
                value={busy ? "-" : fmt(Math.max(0, ...byDay.map((d) => d.supervisors)))} sub="most on one day"
                loading={busy} pointWords={(d) => `${shortDay(d.day)} · ${plural(d.supervisors, "supervisor")}, ${plural(d.lines, "line")}`} />
              <DeliveryCard totals={totals} late={late} loading={busy} />
            </section>
          </div>
          <SupervisorsSection rows={rows} selected={selected} onSelect={setSelected} lead={lead} rangePicker={rangePicker}
            period={{ from: data?.from ?? from, to: data?.to ?? to }}
            deptPicker={<DeptPicker value={dept} options={deptOptions} total={roster.length} onChange={setDeptPick} />} />
        </>
      )}
      {supervisor && (
        <SupervisorPanel key={supervisor.key} s={supervisor} late={late} from={data?.from ?? from} to={data?.to ?? to} onClose={closePanel} />
      )}
    </ErrorBoundary>
  );
}

/** The roster cell: supervisors on the plans, and how their lines went. */
function SupervisorsCard({ totals, loading }) {
  if (loading) {
    return <div className="dr-cell dr-fleet"><div className="dr-cell__empty" aria-busy="true">Loading supervisors…</div></div>;
  }
  const facts = [
    { label: "Machines", value: fmt(totals.machines) },
    { label: "Plan lines", value: fmt(totals.lines) },
    { label: "Operators", value: fmt(totals.operators) },
  ];
  const notJudged = totals.silent + totals.untracked + totals.open;
  const mix = [
    { key: "good", label: "Ran", n: totals.ran },
    { key: "low", label: "Did not run", n: totals.notRun },
    { key: "new", label: "Not judged", n: notJudged },
  ];
  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head"><span className="dr-statchart__label">Supervisors</span></div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(totals.supervisors)}</span>
        <span className="dr-summary__caption">on work plans,<br />{plural(totals.departments, "department")}</span>
      </div>
      <dl className="dr-fleet__facts">
        {facts.map((f) => (
          <div key={f.label} className="dr-fleet__fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
        ))}
      </dl>
      <div className="dr-fleet__mix">
        <span className="dr-fleet__mixlabel">Plan lines</span>
        <span className="dr-fleet__bar" role="img" aria-label={mix.map((m) => `${m.n} ${m.label}`).join(", ")}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.label} className={`dr-fleet__seg dr-fleet__seg--${m.key}`} style={{ flexGrow: m.n }} title={`${m.label}: ${plural(m.n, "line")}`} />
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

/** The delivery cell: planned hours run on tracked lines, and what fell short. */
function DeliveryCard({ totals, late, loading }) {
  if (loading) {
    return <div className="dr-cell dr-summary"><div className="dr-cell__empty" aria-busy="true">Loading…</div></div>;
  }
  const incidents = [
    { label: "Did not run", n: totals.notRun, tone: "theft" },
    { label: `Started over ${late} min late`, n: totals.lateStarts, tone: "speed" },
    { label: "No signal", n: totals.silent, tone: null },
  ];
  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head"><span className="dr-statchart__label">Delivered</span></div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{pct(totals.deliveredPct)}</span>
        <span className="dr-summary__caption">{hrs(totals.runHours)} run of<br />{hrs(totals.judgedPlannedHours)} planned</span>
      </div>
      <div className="dr-summary__incidents">
        {incidents.map((x) => (
          <div key={x.label} className={`dr-summary__incident${x.n && x.tone ? ` dr-summary__incident--${x.tone}` : ""}`}>
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">{x.label}</span>
            <span className="dr-summary__count">{fmt(x.n)}</span>
          </div>
        ))}
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

const machineWords = (s) => s.machines.map((m) => m.reference).join(", ");

function SupervisorsSection({ rows, selected, onSelect, lead, rangePicker, deptPicker, period }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("lines");
  const [sortDir, setSortDir] = useState("desc");
  const cardView = useMediaQuery(GRID_CARDS_QUERY);
  const step = cardView ? GRID_STEP_PHONE : GRID_STEP;
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((s) => !q || [s.name, machineWords(s), ...s.departments, ...s.operators]
    .some((v) => String(v ?? "").toLowerCase().includes(q)));
  const barMax = Math.max(1, ...rows.map((s) => s[sortKey] ?? 0));
  const sorted = [...filtered].sort((a, b) => {
    let cmp;
    if (sortKey === "name") cmp = a.name.localeCompare(b.name);
    else if (sortKey === "department") cmp = String(a.departments[0] ?? "~").localeCompare(String(b.departments[0] ?? "~"));
    else if (sortKey === "machines") cmp = a.machines.length - b.machines.length;
    else if (sortKey === "period") cmp = String(a.lastDay ?? "").localeCompare(String(b.lastDay ?? ""));
    else cmp = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
    return (sortDir === "asc" ? cmp : -cmp) || a.name.localeCompare(b.name);
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / step));
  const at = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(at * step, at * step + step);
  const ranked = BAR_KEYS.has(sortKey);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(["name", "department"].includes(key) ? "asc" : "desc"); }
    setPage(0);
  };
  const rankBy = (key) => { setSortKey(key); setSortDir("desc"); setPage(0); };
  const th = (label, k, num = false) => <GridTh label={label} k={k} sortKey={sortKey} dir={sortDir} onClick={toggleSort} num={num} />;

  const downloadCsv = () => downloadTableCsv({
    head: ["Supervisor", "Departments", "Machines", "Plan lines", "Days", "Planned hours", "Judged lines", "Planned hours judged", "Hours run",
      "Delivered %", "Ran", "Did not run", "Late starts", "No signal", "Not tracked", "Shift not over"],
    body: sorted.map((s) => [nameCase(s.name), s.departments.map(sentence).join(", "), machineWords(s), s.lines, s.days,
      s.plannedHours, s.judged, s.judgedPlannedHours, s.runHours, s.deliveredPct ?? "", s.ran, s.notRun, s.lateStarts, s.silent, s.untracked, s.open]),
    filenameSlug: `supervisor-scorecard-${period.from}${period.to !== period.from ? `-to-${period.to}` : ""}`,
  });

  return (
    <>
      <div className="dr-filters">
        {lead && <div className="dr-filters__chips" role="group" aria-label="Scorecard for">{lead}</div>}
        <div className="dr-filters__chips" role="group" aria-label="Rank supervisors by">
          <span className="dr-rankby__label" aria-hidden="true">Rank by</span>
          <span className="dr-seg">
            {GRID_METRICS.map((m) => (
              <button key={m.key} type="button" className={`dr-chip${sortKey === m.key ? " dr-chip--active" : ""}`}
                aria-pressed={sortKey === m.key} onClick={() => rankBy(m.key)}>{m.label}</button>
            ))}
          </span>
        </div>
        {rangePicker}
        {/* Department, search and CSV as one group (operator 2026-11-20: "we cant
            have the wrapped"): it takes the row's right-hand end, or a line of its
            own, whole, when the row is too narrow (StaffFilters.css). */}
        <div className="dr-filters__tools stf-tools">
          {deptPicker}
          <div className="dr-searchwrap">
            <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input className="dr-search" value={query} aria-label="Search supervisors"
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search supervisor, machine, operator…" />
          </div>
          <button type="button" className="dr-pager__btn" disabled={!sorted.length} onClick={downloadCsv}
                  title="The supervisors in the list as a CSV (opens in Excel)">CSV</button>
        </div>
      </div>

      <div className="dr-grid-card">
        <div className="dr-grid-scroll">
          <table className="dr-grid">
            <thead>
              <tr>
                {th("Supervisor", "name")}
                {th("Department", "department")}
                {th("Machines", "machines")}
                {th("Period", "period")}
                {th("Plan lines", "lines", true)}
                {th("Hours run", "runHours", true)}
                {th("Delivered", "deliveredPct", true)}
                {th("Did not run", "notRun", true)}
                {th("Late starts", "lateStarts", true)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s, i) => {
                const pos = at * step + i;
                const rank = sortDir === "desc" ? pos + 1 : sorted.length - pos;
                const on = s.key === selected;
                return (
                  <tr key={s.key} className={on ? "dr-grid__row--selected" : ""} tabIndex={0} aria-selected={on}
                      onClick={() => onSelect(s.key)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.key); } }}>
                    <td className="dr-drivercell">
                      <span className="dr-driver">
                        <span className="dr-rank" aria-label={ranked ? `Rank ${rank}` : undefined}>{ranked ? rank : ""}</span>
                        <span className="dr-avatar">{initialsOf(nameCase(s.name))}</span>
                        <span className="dr-driver__ident">
                          <span className="dr-driver__name">{nameCase(s.name)}</span>
                          <span className="dr-driver__sub">{plural(s.shifts.length, "shift")}, {plural(s.operators.length, "operator")}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Department">
                      <span className="fuel-dept">{s.departments.map(sentence).join(", ") || "-"}</span>
                    </td>
                    <td data-label="Machines" title={s.machines.map((m) => [m.reference, m.name, m.plate].filter(Boolean).join(" ")).join("\n")}>
                      <span className="fuel-dept">{s.machines.slice(0, 3).map((m) => m.reference).join(", ") || "-"}</span>
                      {s.machines.length > 3 && <span className="dr-driver__sub">+{fmt(s.machines.length - 3)} more</span>}
                    </td>
                    <td className={`dr-when${s.lastDay ? "" : " dr-when--none"}`} data-label="Period"
                        title={s.days ? `${plural(s.days, "day")} on a plan` : undefined}>
                      {!s.lastDay ? "-" : s.firstDay && s.firstDay !== s.lastDay ? `${shortDay(s.firstDay)} to ${shortDay(s.lastDay)}` : shortDay(s.lastDay)}
                    </td>
                    <MetricCell label="Plan lines" k="lines" value={s.lines} sortKey={sortKey} max={barMax} />
                    <MetricCell label="Hours run" k="runHours" value={s.judged ? s.runHours : null} sortKey={sortKey} max={barMax} dp={1}
                      title={`${hrs(s.runHours)} of ${hrs(s.judgedPlannedHours)} planned on ${plural(s.judged, "tracked line")}`} />
                    <MetricCell label="Delivered" k="deliveredPct" value={s.deliveredPct} sortKey={sortKey} max={100} suffix="%" />
                    <CountCell n={s.notRun} label="Did not run" tone="theft" />
                    <CountCell n={s.lateStarts} label="Late starts" tone="speed" />
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td colSpan={9} className="dr-grid__empty">No supervisors match.</td></tr>}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="dr-pager" aria-label="Supervisor pages">
            <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>Previous</button>
            <span className="dr-pager__info" aria-live="polite">
              Page {at + 1} of {pageCount}
              <span className="dr-pager__range">{", "}{fmt(at * step + 1)} to {fmt(at * step + pageRows.length)} of {fmt(sorted.length)}</span>
            </span>
            <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.min(pageCount - 1, at + 1))} disabled={at >= pageCount - 1}>Next</button>
          </nav>
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

function MetricCell({ label, k, value, sortKey, max, dp = 0, suffix = "", title }) {
  const barred = BAR_KEYS.has(k) && sortKey === k;
  if (value == null) return <td className="dr-num dr-num--zero" data-label={label}>-</td>;
  return (
    <td className={"dr-num" + (barred ? " dr-num--ranked" : "")} data-label={label} title={title}>
      <span className="dr-metric">
        <span className="dr-metric__num">{fmt(value, dp)}{suffix}</span>
        {barred && (
          <span className="dr-metric__track" aria-hidden="true">
            <span className="dr-metric__fill" style={{ "--share": Math.max(0, Math.min(value / max, 1)) }} />
          </span>
        )}
      </span>
    </td>
  );
}

/** The roster's incident cell: a dot as well as the colour. */
function CountCell({ n, label, tone }) {
  if (!n) return <td className="dr-num dr-num--zero" data-label={label}>-</td>;
  return (
    <td className={`dr-num dr-incident dr-incident--${tone}`} data-label={label}>
      <span className="dr-incident__dot" aria-hidden="true" />{fmt(n)}
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

/** One supervisor down the right of the page: their machines, shifts, operators and every plan line. */
function SupervisorPanel({ s, late, from, to, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    claimSidePanel("supervisor");
    return onSidePanelClaim("supervisor", () => closeRef.current?.());
  }, []);

  const name = nameCase(s.name);
  const headline = [
    { label: "Plan lines", value: fmt(s.lines) },
    { label: "Planned", value: fmt(s.plannedHours, 1), unit: "h" },
    { label: "Run", value: s.judged ? fmt(s.runHours, 1) : "-", unit: s.judged ? "h" : null },
    { label: "Delivered", value: pct(s.deliveredPct) },
  ];
  const outcomes = [
    ["Ran", s.ran], ["Did not run", s.notRun], [`Over ${late} min late`, s.lateStarts],
    ["No signal", s.silent], ["Not tracked", s.untracked], ["Shift not over", s.open],
  ];
  const lines = linesByDay(s.history).flatMap((d) => d.lines);

  return (
    <aside className="dr-panel sv-panel" role="dialog" aria-label={`${name}, supervisor details`}>
      <header className="dr-panel__head">
        <span className="dr-panel__title">Supervisor</span>
        <button type="button" className="dr-panel__x" onClick={onClose} aria-label="Close supervisor details">×</button>
      </header>

      <div className="dr-panel__body">
        <section className="dr-idcard" aria-label="Supervisor">
          <div className="dr-idcard__who">
            <span className="dr-profile__avatar dr-idcard__avatar">{initialsOf(name)}</span>
            <div className="dr-panel__ident">
              <div className="dr-profile__namerow"><span className="dr-panel__name">{name}</span></div>
              <div className="dr-profile__meta">{s.departments.map(sentence).join(", ") || "Supervisor"}</div>
            </div>
          </div>
          <dl className="dr-idcard__facts">
            <div><dt>Machines</dt><dd>{fmt(s.machines.length)}</dd></div>
            <div><dt>Operators</dt><dd>{fmt(s.operators.length)}</dd></div>
            <div><dt>Days on plans</dt><dd>{fmt(s.days)}</dd></div>
            <div><dt>Last on a plan</dt><dd>{shortDay(s.lastDay)}</dd></div>
          </dl>
          <p className="dr-panel__note">From FactorySuite work plans. Hours run are each machine&rsquo;s engine hours inside the line&rsquo;s shift.</p>
        </section>

        <section className="dr-panel__sec">
          <h3 className="dr-panel__h">{shortDay(from)} to {shortDay(to)}</h3>
          <dl className="dr-window__lead">
            {headline.map((x) => (
              <div key={x.label}><dt>{x.label}</dt><dd>{x.value}{x.unit && <span className="dr-window__unit"> {x.unit}</span>}</dd></div>
            ))}
          </dl>
          <dl className="sv-outcomes">
            {outcomes.map(([k, n]) => <div key={k}><dt>{k}</dt><dd>{fmt(n)}</dd></div>)}
          </dl>
        </section>

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">Machines<span className="dr-panel__count">{fmt(s.machines.length)}</span></h3>
          <ul className="dr-cases">
            {s.machines.map((m) => (
              <li key={m.reference} className="dr-case dr-case--nodate">
                <span className="dr-case__body">
                  <span className="dr-case__line">
                    <b className="dr-case__qty">{m.reference}</b>
                    <span className="dr-case__plate">{[m.name, m.plate].filter(Boolean).join(", ") || "Not one of our units"}</span>
                    <span className="dr-case__time">{m.lines} line{m.lines === 1 ? "" : "s"}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">Shifts<span className="dr-panel__count">{fmt(s.shifts.length)}</span></h3>
          <ul className="dr-cases">
            {s.shifts.map((x) => (
              <li key={`${x.shiftNo}@${x.shiftStart}`} className="dr-case dr-case--nodate">
                <span className="dr-case__body">
                  <span className="dr-case__line">
                    <b className="dr-case__qty">{shiftLabel(x.shiftNo, x.shiftStart)}</b>
                    <span className="dr-case__time">{x.lines} line{x.lines === 1 ? "" : "s"}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dr-panel__sec">
          <h3 className="dr-panel__h">Operators<span className="dr-panel__count">{fmt(s.operators.length)}</span></h3>
          <p className="dr-panel__note">{s.operators.length ? s.operators.map(operatorName).join(", ") : "No operator named on these lines."}</p>
        </section>

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">Plan lines<span className="dr-panel__count">{fmt(lines.length)}</span></h3>
          <ul className="dr-cases">
            {lines.map((l) => {
              const st = LINE_STATE[l.state] ?? LINE_STATE.untracked;
              const isLate = l.lateMinutes != null && l.lateMinutes > late;
              return (
                <li key={`${l.lineId}|${l.day}`} className={`dr-case${l.state === "not-run" || isLate ? " dr-case--on" : ""}`}>
                  <DayBlock day={l.day} />
                  <span className="dr-case__body">
                    <span className="dr-case__line">
                      <b className="dr-case__qty">{l.machine}</b>
                      <span className="dr-case__plate">{l.activity}</span>
                      <span className="dr-case__time">{shiftLabel(l.shiftNo, l.shiftStart)}</span>
                    </span>
                    <span className="dr-case__sub">
                      {[l.workLocation && `At ${l.workLocation}`,
                        l.runHours != null ? `${hrs(l.runHours)} run of ${hrs(l.plannedHours)}` : `${hrs(l.plannedHours)} planned`,
                        l.state === "ran" && l.firstWorkAt && `first worked ${hhmm(l.firstWorkAt)}${isLate ? `, ${l.lateMinutes} min late` : ""}`]
                        .filter(Boolean).join(", ")}
                    </span>
                    {l.operators.length > 0 && <span className="dr-case__sub">{l.operators.map(operatorName).join(", ")}</span>}
                    <span className="dr-case__sub">
                      <span className={`dr-grid__badge dr-grid__badge--${st.tone}`}><span className="dr-grid__dot" aria-hidden="true" />{st.label}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </aside>
  );
}

