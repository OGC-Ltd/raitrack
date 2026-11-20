// Maintenance › Plan (operator 2026-11-20): FactorySuite's own board of which
// department sent the day's work plan, and whether by 16:00 the day before.
// The board is built on the server (planner/plan-submissions) and kept live by
// FactorySuite's work plan hooks (hooks/usePlanSubmissions).
//
// One sheet (Hallmark redesign, 2026-11-20): a row a department, the picked
// day spelled out beside its name, then the 14 days ending on the picked date
// as squares. A square picks its day; the date field moves the two weeks.

import { useMemo, useState } from "react";
import { usePlanSubmissions } from "../../hooks/usePlanSubmissions";
import { STATES, LEGEND, cellDetail, cellIndex, cellTitle, dayOfMonth, isWeekend, longDay, weekday, planStats, unitRows, filterUnitRows, planStatus, dailySent } from "../../lib/planSubmissions";
import TrendStat from "../screens/TrendStat";
import { useWorkPlans } from "../../hooks/useWorkPlans";
import { shiftText } from "../../lib/workPlanMap";
import { nameCase } from "../../lib/factorySupervisors";
import { operatorName } from "../../lib/shiftOperators";
import LoadError from "../shared/LoadError";
import "../screens/DriversScreen.css";
import "../screens/FuelScreen.css";
import "./plan/tokens.css";
import "./PlanSubmissions.css";

const ICONS = {
  check:  <path d="M5 12.5l4.5 4.5L19 7.5" />,
  double: <><path d="M2.5 12.5l4.5 4.5L16.5 7.5" /><path d="M11.5 16.5l.5.5L21.5 7.5" /></>,
  clock:  <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  pencil: <><path d="M15.5 5.5l3 3L9 18H6v-3z" /><path d="M5 21h14" /></>,
  back:   <><path d="M9 7L5 11l4 4" /><path d="M5 11h9a5 5 0 010 10h-2" /></>,
  x:      <path d="M7 7l10 10M17 7L7 17" />,
};
const ICON_OF = { approved: "double", sent: "check", approved_late: "clock", sent_late: "clock", draft: "pencil", sent_back: "back", none: "x" };

function StateIcon({ state, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[ICON_OF[state] ?? "x"]}
    </svg>
  );
}

const fmtUpdated = (ms) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null);

export default function PlanSubmissions({ orgId }) {
  // undefined = the server's default: tomorrow, the day plans are being sent for.
  const [windowDay, setWindowDay] = useState(undefined);
  const [picked, setPicked] = useState(null);
  const { data, loading, error, fetching, refetch, updatedAt } = usePlanSubmissions(orgId, windowDay);

  const index = useMemo(() => cellIndex(data), [data]);
  const days = data?.days ?? [];
  const departments = data?.departments ?? [];
  const lastDay = days.at(-1) ?? null;
  const selected = picked && days.includes(picked) ? picked : lastDay;
  const sentOnSelected = selected ? data?.sent?.[selected] ?? 0 : 0;
  // The picked day's plans, every status, line by line: the cards and the units table.
  const dayPlans = useWorkPlans(orgId, Boolean(selected), selected ?? undefined);

  if (error && !data) return <div className="psb"><LoadError label="Plan" onRetry={refetch} fullSection /></div>;
  if (loading || !data) return <div className="psb"><p className="psb__empty">Loading the plan…</p></div>;
  if (data.factory == null) {
    return <div className="psb"><p className="psb__empty">This organisation keeps no FactorySuite work plans.</p></div>;
  }

  const isTomorrow = selected && data.today && selected > data.today;
  const pickDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setWindowDay(value);
    setPicked(value);
  };
  const due = `${String(data.dueHour).padStart(2, "0")}:00`;
  const allSent = departments.length > 0 && sentOnSelected === departments.length;

  return (
    <div className="psb dr-tones">
      <PlanStats plans={dayPlans.data?.plans} loading={dayPlans.loading} board={data} day={selected} />

      <section className="psb-sheet" aria-labelledby="psb-title">
        <header className="psb-head">
          <div className="psb-head__text">
            <h2 id="psb-title" className="psb-head__title">
              {isTomorrow ? "Plan for tomorrow" : `Plan for ${longDay(selected)}`}
            </h2>
            <p className="psb-head__sub">
              {isTomorrow ? `${longDay(selected)}. ` : ""}Due by {due} the day before.
            </p>
          </div>
          <p className={"psb-head__figure" + (allSent ? " is-done" : "")} aria-live="polite">
            <span className="psb-head__n">{sentOnSelected}</span>
            <span className="psb-head__of">of {departments.length} departments sent</span>
          </p>
          <div className="psb-head__tools">
            <span className="psb-updated" title="Updates as soon as FactorySuite reports a plan created, sent, approved or sent back">
              {fetching ? "Updating…" : `Updated ${fmtUpdated(updatedAt) ?? "now"}`}
            </span>
            <label className="psb-date">
              <span className="psb-date__label">Two weeks to</span>
              <input type="date" value={lastDay ?? ""} onChange={(e) => pickDate(e.target.value)} />
            </label>
          </div>
        </header>

        <div className="psb-scroll">
          <table className="psb-grid">
            <caption className="psb-sr">Which department sent its work plan, by day, for the two weeks ending {longDay(lastDay)}</caption>
            <thead>
              <tr>
                <th scope="col" className="psb-grid__dept">Department</th>
                <th scope="col" className="psb-grid__pick">{longDay(selected)}</th>
                {days.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className={"psb-grid__day" + (isWeekend(d) ? " is-weekend" : "") + (weekday(d) === "Mo" ? " is-week" : "") + (d === selected ? " is-selected" : "")}
                  >
                    <span className="psb-grid__wd">{weekday(d)}</span>
                    <span className={"psb-grid__dom" + (d === data.today ? " is-today" : "")} title={d === data.today ? "Today" : undefined}>{dayOfMonth(d)}</span>
                  </th>
                ))}
                <th scope="col" className="psb-grid__ontime">On time</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => {
                const pickedCell = index.get(dept)?.get(selected);
                const pickedState = pickedCell?.state ?? "none";
                return (
                  <tr key={dept}>
                    <th scope="row" className="psb-grid__dept">{dept}</th>
                    <td className={`psb-grid__pick psb-tone--${pickedState}`} title={pickedCell ? cellTitle(pickedCell, dept) : undefined}>
                      <span className="psb-pick">
                        <span className="psb-pick__icon"><StateIcon state={pickedState} size={14} /></span>
                        {cellDetail(pickedCell)}
                      </span>
                    </td>
                    {days.map((d) => {
                      const cell = index.get(dept)?.get(d);
                      const state = cell?.state ?? "none";
                      return (
                        <td key={d} className={(isWeekend(d) ? "is-weekend" : "") + (weekday(d) === "Mo" ? " is-week" : "") + (d === selected ? " is-selected" : "")}>
                          <button
                            type="button"
                            className={`psb-sq psb-tone--${state}` + (d === selected ? " psb-sq--selected" : "")}
                            title={cell ? cellTitle(cell, dept) : `${dept}, ${longDay(d)}: Not started`}
                            aria-label={`${dept}, ${longDay(d)}: ${STATES[state].label}`}
                            aria-pressed={d === selected}
                            onClick={() => setPicked(d)}
                          >
                            <StateIcon state={state} size={13} />
                          </button>
                        </td>
                      );
                    })}
                    <td className="psb-grid__ontime">
                      <span className="psb-ontime__n">{data.onTime?.[dept] ?? 0}</span>
                      <span className="psb-ontime__of">/{days.length}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="psb-grid__dept">Sent</th>
                <td className="psb-grid__pick psb-grid__pick--foot">{sentOnSelected} of {departments.length}</td>
                {days.map((d) => (
                  <td key={d} className={"psb-grid__sent" + (isWeekend(d) ? " is-weekend" : "") + (weekday(d) === "Mo" ? " is-week" : "") + (d === selected ? " is-selected" : "") + ((data.sent?.[d] ?? 0) === 0 ? " is-zero" : "")}>
                    {data.sent?.[d] ?? 0}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <ul className="psb-legend" aria-label="Key">
          {LEGEND.map((s) => (
            <li key={s}>
              <span className={`psb-sq psb-sq--key psb-tone--${s}`}><StateIcon state={s} size={10} /></span>
              {STATES[s].label}
            </li>
          ))}
        </ul>
      </section>

      <UnitsTable plans={dayPlans.data?.plans} loading={dayPlans.loading} error={dayPlans.error} day={selected} departments={departments} />
    </div>
  );
}

/**
 * The picked day's plans in the Operators page's strip (operator 2026-11-20):
 * a lead cell with its facts and the plans' status mix, the departments that
 * sent and those on time across the two weeks as charts, and what was sent back.
 */
const fmtN = (n, d = 0) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const shortDay = (day) => longDay(day).split(" ").slice(1).join(" ");
const plural = (n, one, many = `${one}s`) => `${fmtN(n)} ${n === 1 ? one : many}`;

function PlanStats({ plans, loading, board, day }) {
  const st = planStats(plans ?? []);
  const busy = loading && !plans;
  const series = dailySent(board);
  const deptCount = board?.departments?.length ?? 0;
  const at = series.find((d) => d.day === day);
  return (
    <div className="dr-layout psb-strip">
      <section className="dr-strip" aria-label="The day's plans">
        <PlansCell st={st} busy={busy} day={day} />
        <TrendStat title="Departments sent" series={series} valueKey="sent" unit={`of ${deptCount}`} tone="tonnes" type="bar"
          value={at ? fmtN(at.sent) : "-"} sub={day ? `for ${shortDay(day)}` : ""} loading={!board}
          pointWords={(d) => `${shortDay(d.day)}: ${plural(d.sent, "department")} sent`} />
        <TrendStat title="Sent on time" series={series} valueKey="onTime" unit={`of ${deptCount}`} tone="mileage" type="line"
          value={at ? fmtN(at.onTime) : "-"} sub={`by ${String(board?.dueHour ?? 16).padStart(2, "0")}:00 the day before`} loading={!board}
          pointWords={(d) => `${shortDay(d.day)}: ${plural(d.onTime, "department")} on time`} />
        <ChangesCell st={st} busy={busy} />
      </section>
    </div>
  );
}

/** The lead cell: approved plans, what they put to work, and the status mix. */
function PlansCell({ st, busy, day }) {
  if (busy) return <div className="dr-cell dr-fleet"><div className="dr-cell__empty" aria-busy="true">Loading plans…</div></div>;
  const facts = [
    { label: "Machines", value: fmtN(st.machines) },
    { label: "Hours planned", value: fmtN(st.hours) },
    { label: "Plan lines", value: fmtN(st.lines) },
  ];
  const mix = [
    { key: "good", label: "Approved", n: st.approved },
    { key: "fair", label: "Draft", n: st.drafts },
    { key: "new", label: "Other", n: st.plans - st.approved - st.drafts },
  ];
  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head"><span className="dr-statchart__label">Plans approved</span></div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmtN(st.approved)}</span>
        <span className="dr-summary__caption">of {plural(st.plans, "plan")} for {day ? shortDay(day) : "the day"},<br />{plural(st.departments, "department")}</span>
      </div>
      <dl className="dr-fleet__facts">
        {facts.map((f) => (
          <div key={f.label} className="dr-fleet__fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
        ))}
      </dl>
      <div className="dr-fleet__mix">
        <span className="dr-fleet__mixlabel">Plan status</span>
        <span className="dr-fleet__bar" role="img" aria-label={mix.map((m) => `${m.n} ${m.label.toLowerCase()}`).join(", ")}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.key} className={`dr-fleet__seg dr-fleet__seg--${m.key}`} style={{ flexGrow: m.n }} title={`${m.label}: ${plural(m.n, "plan")}`} />
          ))}
        </span>
        <ul className="dr-fleet__legend">
          {mix.map((m) => (
            <li key={m.key} className={`dr-fleet__key dr-fleet__key--${m.key}`}>
              <span className="dr-fleet__swatch" aria-hidden="true" />{m.label}<b>{fmtN(m.n)}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The summary cell: plans sent back, and the ones still waiting or called off. */
function ChangesCell({ st, busy }) {
  if (busy) return <div className="dr-cell dr-summary"><div className="dr-cell__empty" aria-busy="true">Loading…</div></div>;
  const clean = st.plans > 0 && !st.changes;
  const rows = [
    { key: "waiting", name: "Waiting for approval", n: st.waiting, tone: "speed" },
    { key: "cancelled", name: "Cancelled", n: st.cancelled, tone: "theft" },
  ];
  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Changes asked for</span>
        {clean && <span className="dr-summary__clean">Clean</span>}
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmtN(st.changes)}</span>
        <span className="dr-summary__caption">{st.changes === 1 ? "plan" : "plans"} sent back<br />to the department</span>
      </div>
      <div className="dr-summary__incidents">
        {rows.map((r) => (
          <div key={r.key} className={`dr-summary__incident${r.n ? ` dr-summary__incident--${r.tone}` : ""}`}>
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">{r.name}</span>
            <span className="dr-summary__count">{fmtN(r.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The status filter, in the order a plan goes through FactorySuite. */
const STATUS_FILTERS = ["APPROVED", "SUBMITTED", "DRAFT", "REJECTED", "WITHDRAWN", "CANCELLED"];
/** A plan status as the Drivers grid's badge tone. */
const BADGE = { APPROVED: "active", SUBMITTED: "suspended", DRAFT: "draft", REJECTED: "terminated", WITHDRAWN: "terminated", CANCELLED: "unknown" };
const PAGE = 25;
const ALL = "__all";

function SortTh({ label, k, sortKey, dir, onClick }) {
  const active = sortKey === k;
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="dr-grid__sort" onClick={() => onClick(k)} title={`Sort by ${label.toLowerCase()}`}>
        <span>{label}</span>
        <span className={"dr-caret" + (active ? ` dr-caret--${dir}` : "")} aria-hidden="true" />
      </button>
    </th>
  );
}

const SORTS = {
  unit: (r) => r.machine,
  department: (r) => r.department,
  status: (r) => STATUS_FILTERS.indexOf(r.status),
  shift: (r) => r.shift,
  location: (r) => r.workLocation ?? "",
};

/**
 * Every unit on the picked day's plans, whatever the plan's status, in the
 * Drivers page's grid: the filter row (status, department, search), then the
 * table and its pager.
 */
function UnitsTable({ plans, loading, error, day, departments }) {
  const [dept, setDept] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("department");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => unitRows(plans ?? [], { shift: shiftText, name: operatorName }), [plans]);
  const deptOptions = useMemo(() => [...new Set([...departments, ...rows.map((r) => r.department)])]
    .map((d) => ({ key: d, label: nameCase(d), count: rows.filter((r) => r.department === d).length })), [departments, rows]);
  const inDept = useMemo(() => filterUnitRows(rows, { departments: dept === ALL ? [] : [dept], q }), [rows, dept, q]);
  const shown = useMemo(() => {
    const out = status === ALL ? inDept : inDept.filter((r) => r.status === status);
    const key = SORTS[sortKey];
    if (sortKey === "department") return out; // unitRows' own order: department, status, unit, shift
    const sign = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = key(a), y = key(b);
      return sign * (typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }));
    });
  }, [inDept, status, sortKey, sortDir]);
  const ordered = sortKey === "department" && sortDir === "desc" ? [...shown].reverse() : shown;
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE));
  const at = Math.min(page, pages - 1);
  const pageRows = ordered.slice(at * PAGE, at * PAGE + PAGE);
  const units = new Set(ordered.map((r) => r.machine)).size;
  const statusOptions = STATUS_FILTERS.filter((s) => rows.some((r) => r.status === s));
  const dayWords = day ? longDay(day) : "the day";

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
    setPage(0);
  };
  const pickStatus = (s) => { setStatus(s); setPage(0); };
  const clear = () => { setDept(ALL); setStatus(ALL); setQ(""); setPage(0); };

  return (
    <section className="psb-units" aria-labelledby="psb-units-title">
      <div className="psb-units__head">
        <h3 id="psb-units-title" className="dr-title">Units on the plans for {dayWords}</h3>
        <p className="dr-subtitle">
          {loading && !plans ? "Loading…" : `${units} ${units === 1 ? "unit" : "units"} on ${ordered.length} ${ordered.length === 1 ? "line" : "lines"}${ordered.length !== rows.length ? `, of ${rows.length}` : ""}`}
        </p>
      </div>

      <div className="dr-filters">
        <div className="dr-filters__chips" role="group" aria-label="Plan status">
          <span className="dr-rankby__label" aria-hidden="true">Status</span>
          <span className="dr-seg">
            <button type="button" className={`dr-chip${status === ALL ? " dr-chip--active" : ""}`} aria-pressed={status === ALL} onClick={() => pickStatus(ALL)}>
              All
            </button>
            {statusOptions.map((s) => (
              <button key={s} type="button" className={`dr-chip${status === s ? " dr-chip--active" : ""}`} aria-pressed={status === s} onClick={() => pickStatus(s)}>
                {planStatus(s).label} <span className="psb-units__n">{inDept.filter((r) => r.status === s).length}</span>
              </button>
            ))}
          </span>
        </div>
        <label className="dr-typepick">
          <span className="dr-typepick__label">Department</span>
          <select className="dr-typepick__select" value={dept} onChange={(e) => { setDept(e.target.value); setPage(0); }}>
            <option value={ALL}>All departments ({rows.length})</option>
            {deptOptions.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
          </select>
        </label>
        <div className="dr-searchwrap">
          <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input className="dr-search" value={q} aria-label="Search units" onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search unit, operator, location or plan…" />
        </div>
      </div>

      <div className="dr-grid-card">
        {error && !plans ? (
          <p className="dr-grid__empty psb-units__state">The plans for {dayWords} could not be read. They load again on the next FactorySuite update.</p>
        ) : loading && !plans ? (
          <p className="dr-grid__empty psb-units__state" aria-busy="true">Loading the plans for {dayWords}…</p>
        ) : rows.length === 0 ? (
          <p className="dr-grid__empty psb-units__state">No department has started a plan for {dayWords} yet.</p>
        ) : (
          <>
            <div className="dr-grid-scroll">
              <table className="dr-grid psb-units__grid">
                <thead>
                  <tr>
                    <SortTh label="Unit" k="unit" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortTh label="Department" k="department" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortTh label="Status" k="status" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortTh label="Shift" k="shift" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <th>Activity</th>
                    <SortTh label="Work location" k="location" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <th>Operator</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const st = planStatus(r.status);
                    return (
                      <tr key={r.key}>
                        <td className="dr-drivercell">
                          <span className="dr-driver__ident">
                            <span className="dr-driver__name">{r.machine}</span>
                            {r.machineName && <span className="dr-driver__sub">{r.machineName}</span>}
                          </span>
                        </td>
                        <td data-label="Department">
                          <span className="fuel-dept">{nameCase(r.department)}</span>
                          {r.planCode && <span className="dr-driver__sub psb-units__code">{r.planCode}</span>}
                        </td>
                        <td data-label="Status">
                          <span className={`dr-grid__badge dr-grid__badge--${BADGE[r.status] ?? "unknown"}`}>
                            <span className="dr-grid__dot" aria-hidden="true" />
                            {st.label}
                          </span>
                        </td>
                        <td className="dr-when" data-label="Shift">
                          {r.shift || "-"}
                          {r.shiftNo != null && <span className="dr-driver__sub">Shift {r.shiftNo}</span>}
                        </td>
                        <td className="psb-units__wrap" data-label="Activity">{r.activity ?? "-"}</td>
                        <td className="psb-units__wrap" data-label="Work location">{r.workLocation ?? "-"}</td>
                        <td className="psb-units__wrap" data-label="Operator">
                          {r.operators.length ? r.operators.join(", ") : <span className="psb-units__none">None named</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {ordered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="dr-grid__empty">
                        No unit matches these filters. <button type="button" className="psb-link" onClick={clear}>Show all</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <nav className="dr-pager" aria-label="Unit pages">
                <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>Previous</button>
                <span className="dr-pager__info" aria-live="polite">
                  Page {at + 1} of {pages}
                  <span className="dr-pager__range">{", "}{at * PAGE + 1} to {at * PAGE + pageRows.length} of {ordered.length}</span>
                </span>
                <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.min(pages - 1, at + 1))} disabled={at >= pages - 1}>Next</button>
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  );
}
