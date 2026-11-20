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
  LINE_STATE, linesByDay, shiftsWithDays, nameCase, operatorName, shiftLabel,
  supervisorDepartments, supervisorsByDay, supervisorTotals,
} from "../../lib/factorySupervisors";
import TablePager from "../body/TablePager";

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
  // The two problem counts always draw their bar (operator 2026-11-20: "the did
  // not run have a red line ... also under late starts"), against the worst row.
  const worst = { notRun: Math.max(1, ...rows.map((s) => s.notRun ?? 0)), lateStarts: Math.max(1, ...rows.map((s) => s.lateStarts ?? 0)) };
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
                    <CountCell n={s.notRun} label="Did not run" tone="theft" max={worst.notRun} />
                    <CountCell n={s.lateStarts} label="Late starts" tone="speed" max={worst.lateStarts} />
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td colSpan={9} className="dr-grid__empty">No supervisors match.</td></tr>}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <TablePager label="Supervisor pages" pager={{
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

/** The roster's incident cell: the count, with a bar in its colour against the worst row. */
function CountCell({ n, label, tone, max }) {
  if (!n) return <td className="dr-num dr-num--zero" data-label={label}>-</td>;
  return (
    <td className={`dr-num dr-incident dr-incident--${tone}`} data-label={label}>
      <span className="dr-metric">
        <span className="dr-metric__num">{fmt(n)}</span>
        <span className="dr-metric__track" aria-hidden="true">
          <span className={`dr-metric__fill sv-fill--${tone}`} style={{ "--share": Math.max(0, Math.min(n / max, 1)) }} />
        </span>
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

/** One supervisor down the right of the page: their machines, shifts, operators and every plan line. */
/** "Fri 21 Nov". */
const dayWords = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Hours run against hours planned, on the lines whose hours were read. Where
 * some lines were not (not tracked, no signal, shift not over), all the hours
 * planned are said beside it, so the two figures are never set against lines
 * that could not be read.
 */
function RunAgainstPlan({ t, small = false }) {
  const share = t.judgedPlanned > 0 ? Math.min(t.runHours / t.judgedPlanned, 1) : 0;
  const part = t.judgedPlanned < t.plannedHours;
  const words = t.judged === 0
    ? `${hrs(t.plannedHours)} planned, no hours read yet`
    : small
      ? `${fmt(t.runHours, 1)} of ${hrs(t.judgedPlanned)}${part ? `, ${hrs(t.plannedHours)} in all` : ""}`
      : `${hrs(t.runHours)} run of ${hrs(t.judgedPlanned)} planned${part ? ` on tracked lines, ${hrs(t.plannedHours)} in all` : ""}`;
  return (
    <span className={`sv-run${small ? " sv-run--small" : ""}${t.judged === 0 ? " is-unread" : ""}`}>
      <span className="sv-run__words">{words}</span>
      <span className="sv-run__track" aria-hidden="true">
        <span className="sv-run__fill" style={{ "--share": share }} />
      </span>
      {t.judged > 0 && <span className="sv-run__pct">{fmt(Math.round((100 * t.runHours) / t.judgedPlanned))}%</span>}
    </span>
  );
}

/** Which of the panel's lists are open: folded to start (operator 2026-11-20:
 *  "by default they should be collapsed"), and remembered for the visit, so
 *  opening one keeps it open as you go from one supervisor to the next. */
const foldMemo = { machines: false, operators: false, lines: false };
function useFold(key) {
  const [open, setOpen] = useState(foldMemo[key] ?? false);
  const toggle = () => setOpen((was) => { foldMemo[key] = !was; return !was; });
  return [open, toggle];
}

/** A section head that folds its list away (operator 2026-11-20: Plan lines,
 *  then "machines and operators should also be collapsible"). */
function FoldHead({ id, open, onToggle, label, count }) {
  return (
    <h3 className="sv-h sv-h--fold">
      <button type="button" className="sv-fold" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {label}<span className="sv-count">{fmt(count)}</span>
        <svg className="sv-fold__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </h3>
  );
}

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
  // Every line ends in exactly one of these; late starts are a part of Ran,
  // so they are said under the bar, not drawn as a sixth piece of it.
  const outcomes = [
    { key: "ran", label: "Ran", n: s.ran, tone: "ok" },
    { key: "not-run", label: "Did not run", n: s.notRun, tone: "bad" },
    { key: "silent", label: "No signal", n: s.silent, tone: "quiet" },
    { key: "untracked", label: "Not tracked", n: s.untracked, tone: "faint" },
    { key: "open", label: "Shift not over", n: s.open, tone: "warn" },
  ];
  const ended = outcomes.reduce((n, o) => n + (o.n ?? 0), 0);
  const lines = linesByDay(s.history).flatMap((d) => d.lines);
  const shiftWords = (no, at) => shiftLabel(no, at).replace(" · ", ", ");
  const shifts = shiftsWithDays(s.history);
  // Plan lines folds away (operator 2026-11-20); open by default, kept across supervisors.
  const [machinesOpen, toggleMachines] = useFold("machines");
  const [operatorsOpen, toggleOperators] = useFold("operators");
  const [linesOpen, toggleLines] = useFold("lines");

  return (
    <aside className="dr-panel sv-panel" role="dialog" aria-label={`${name}, supervisor details`}>
      <header className="dr-panel__head">
        <span className="dr-panel__title">Supervisor</span>
        <button type="button" className="dr-panel__x" onClick={onClose} aria-label="Close supervisor details">×</button>
      </header>

      <div className="dr-panel__body">
        <section className="sv-id" aria-label="Supervisor">
          <div className="sv-id__who">
            <span className="sv-id__avatar" aria-hidden="true">{initialsOf(name)}</span>
            <div className="sv-id__ident">
              <span className="sv-id__name">{name}</span>
              <span className="sv-id__meta">{s.departments.map(sentence).join(", ") || "Supervisor"}</span>
            </div>
          </div>
          <dl className="sv-id__facts">
            <div><dt>Machines</dt><dd>{fmt(s.machines.length)}</dd></div>
            <div><dt>Operators</dt><dd>{fmt(s.operators.length)}</dd></div>
            <div><dt>Days on plans</dt><dd>{fmt(s.days)}</dd></div>
            <div><dt>Last on a plan</dt><dd>{shortDay(s.lastDay)}</dd></div>
          </dl>
          <p className="sv-id__note">From FactorySuite work plans. Hours run are each machine&rsquo;s engine hours inside the line&rsquo;s shift.</p>
        </section>

        <section className="sv-sec">
          <h3 className="sv-h">{shortDay(from)} to {shortDay(to)}</h3>
          <dl className="sv-lead">
            {headline.map((x) => (
              <div key={x.label}><dt>{x.label}</dt><dd>{x.value}{x.unit && <span className="sv-lead__unit"> {x.unit}</span>}</dd></div>
            ))}
          </dl>
          {ended > 0 && (
            <div className="sv-split" role="img"
              aria-label={outcomes.filter((o) => o.n).map((o) => `${o.label} ${fmt(o.n)}`).join(", ")}>
              {outcomes.filter((o) => o.n).map((o) => (
                <span key={o.key} className={`sv-split__part sv-tone--${o.tone}`} style={{ flexGrow: o.n }} />
              ))}
            </div>
          )}
          <dl className="sv-outcomes">
            {outcomes.map((o) => (
              <div key={o.key} className={o.n ? undefined : "is-zero"}>
                <dt><span className={`sv-key sv-tone--${o.tone}`} aria-hidden="true" />{o.label}</dt>
                <dd>{fmt(o.n)}</dd>
              </div>
            ))}
            <div className={`sv-outcomes__late${s.lateStarts ? "" : " is-zero"}`}>
              <dt>Of those that ran, over {late} min late</dt>
              <dd>{fmt(s.lateStarts)}</dd>
            </div>
          </dl>
        </section>

        <section className="sv-sec">
          <FoldHead id="sv-machines" open={machinesOpen} onToggle={toggleMachines} label="Machines" count={s.machines.length} />
          {machinesOpen && <ul className="sv-list sv-folded" id="sv-machines">
            {s.machines.map((m) => (
              <li key={m.reference}>
                <b className="sv-list__key">{m.reference}</b>
                <span className="sv-list__what">{[m.name, m.plate].filter(Boolean).join(", ") || "Not one of our units"}</span>
                <span className="sv-list__n">{plural(m.lines, "line")}</span>
              </li>
            ))}
          </ul>}
        </section>

        {/* Each shift's hours run against its hours planned, then each date it was
            planned for (operator 2026-11-20: "show their actual dates and hours
            done on each shift against the planned hours"). */}
        <section className="sv-sec">
          <h3 className="sv-h">Shifts<span className="sv-count">{fmt(shifts.length)}</span></h3>
          <ul className="sv-shifts">
            {shifts.map((x) => (
              <li key={x.key} className="sv-shift">
                <div className="sv-shift__head">
                  <b>{shiftWords(x.shiftNo, x.shiftStart)}</b>
                  <span className="sv-list__n">{plural(x.days.length, "day")}, {plural(x.lines, "line")}</span>
                </div>
                <RunAgainstPlan t={x} />
                <ul className="sv-shift__days">
                  {x.days.map((d) => (
                    <li key={d.day}>
                      <span className="sv-shift__day">{dayWords(d.day)}</span>
                      <span className="sv-shift__n">{plural(d.lines, "line")}</span>
                      <RunAgainstPlan t={d} small />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <section className="sv-sec">
          <FoldHead id="sv-operators" open={operatorsOpen} onToggle={toggleOperators} label="Operators" count={s.operators.length} />
          {operatorsOpen && (s.operators.length ? (
            <ul className="sv-names sv-folded" id="sv-operators">
              {s.operators.map((o) => <li key={o}>{operatorName(o)}</li>)}
            </ul>
          ) : <p className="sv-none sv-folded" id="sv-operators">No operator named on these lines.</p>)}
        </section>

        <section className="sv-sec">
          <FoldHead id="sv-plan-lines" open={linesOpen} onToggle={toggleLines} label="Plan lines" count={lines.length} />
          {linesOpen && <ul className="sv-lines sv-folded" id="sv-plan-lines">
            {lines.map((l) => {
              const st = LINE_STATE[l.state] ?? LINE_STATE.untracked;
              const isLate = l.lateMinutes != null && l.lateMinutes > late;
              const flag = l.state === "not-run" ? "bad" : isLate ? "warn" : null;
              return (
                <li key={`${l.lineId}|${l.day}`} className={`sv-line${flag ? ` sv-line--${flag}` : ""}`}>
                  <DayBlock day={l.day} />
                  <div className="sv-line__body">
                    <div className="sv-line__top">
                      <span className="sv-line__what"><b>{l.machine}</b> {l.activity}</span>
                      <span className="sv-line__shift">{shiftWords(l.shiftNo, l.shiftStart)}</span>
                    </div>
                    <p className="sv-line__sub">
                      {[l.workLocation && `At ${l.workLocation}`,
                        l.runHours != null ? `${hrs(l.runHours)} run of ${hrs(l.plannedHours)}` : `${hrs(l.plannedHours)} planned`,
                        l.state === "ran" && l.firstWorkAt && `first worked ${hhmm(l.firstWorkAt)}`]
                        .filter(Boolean).join(", ")}
                    </p>
                    {l.operators.length > 0 && <p className="sv-line__sub">{l.operators.map(operatorName).join(", ")}</p>}
                    <div className="sv-line__tags">
                      <span className={`dr-grid__badge dr-grid__badge--${st.tone}`}><span className="dr-grid__dot" aria-hidden="true" />{st.label}</span>
                      {isLate && <span className="dr-grid__badge dr-grid__badge--suspended">{l.lateMinutes} min late</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>}
        </section>
      </div>
    </aside>
  );
}
