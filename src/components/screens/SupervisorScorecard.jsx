// Scorecard › Supervisors (operator 2026-11-19: "work on the supervisor
// alignment to the machines they have assigned and the shift they have
// assigned — the goal is to derive the performing supervisors"; first,
// "populate the supervisors records on the score card").
//
// One row per FactorySuite supervisor named on the work plans: the machines
// and shifts they had, the hours those lines planned and the hours the
// machines ran in them (fleet-server planner/factory-supervisors), with the
// lines that did not run, started late, sent no signal or are on a machine we
// do not track. Figures only: no rank and no badge says who performs, until
// the operator settles how that is judged. Clicking a row opens the side panel
// (operator 2026-11-19: "whenever I click on a line the data should appear on
// the side panel"): the supervisor's machines, shifts, operators and lines.
//
// Drawn in the Driver scorecard's grammar (DriverScorecard.jsx and .css, which
// borrow the Analytics roster's): `dr-filters`, the `dr-strip`, the `dr-grid`
// datagrid with sortable heads, and the roster's `dr-panel` down the right.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./DriversScreen.css";
import "./DriverScorecard.css";
import "./SupervisorScorecard.css";
import { getFactorySupervisors } from "../../api/factorySupervisors";
import DateRangePicker from "../layout/DateRangePicker";
import { useApiData } from "../../hooks/useApiData";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import LoadError from "../shared/LoadError";
import { downloadTableCsv } from "../../utils/tableExport";
import { claimSidePanel, onSidePanelClaim } from "../../lib/sidePanels";
import { LINE_STATE, linesByDay, nameCase, operatorName, shiftLabel, supervisorPeriods, supervisorTotals } from "../../lib/factorySupervisors";

const MAX_DAYS = 31;
const PAGE = 15;
const PAGE_PHONE = 10;
const CARDS_QUERY = "(max-width: 700px)";
const COLS = 12;

const fmt = (n, dp = 0) => (n == null || !Number.isFinite(n) ? "–" : n.toLocaleString("en-KE", { maximumFractionDigits: dp, minimumFractionDigits: 0 }));
const hrs = (n) => (n == null ? "–" : `${fmt(n, 1)} h`);
const pct = (n) => (n == null ? "–" : `${fmt(n)}%`);
const initialsOf = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" }) : "–");
const shortDay = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "–");
const sentence = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "");

const SORTS = {
  supervisor: (s) => s.name.toLowerCase(),
  machines: (s) => s.machines.length,
  lines: (s) => s.lines,
  days: (s) => s.days,
  planned: (s) => s.plannedHours,
  run: (s) => s.runHours,
  delivered: (s) => s.deliveredPct ?? -1,
  ran: (s) => s.ran,
  notRun: (s) => s.notRun,
  late: (s) => s.lateStarts,
  silent: (s) => s.silent,
  untracked: (s) => s.untracked,
};

export default function SupervisorScorecard({ companyId, lead = null }) {
  const options = useMemo(() => supervisorPeriods(), []);
  const today = options[0].to;
  const [periodKey, setPeriodKey] = useState("14d");
  const [custom, setCustom] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const closePanel = useCallback(() => setOpen(null), []);
  const [sortKey, setSortKey] = useState("lines");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const cards = useMediaQuery(CARDS_QUERY);
  const step = cards ? PAGE_PHONE : PAGE;
  const period = custom ?? options.find((p) => p.key === periodKey) ?? options[0];
  const pickPeriod = (next) => { setPeriodKey(next.key ?? null); setCustom(next.key ? null : next); setOpen(null); setPage(0); };

  const { data, loading, stale, error, retry } = useApiData(
    () => getFactorySupervisors({ companyId, from: period.from, to: period.to }),
    [companyId, period.from, period.to],
    { cacheKey: `ft-factory-supervisors:${companyId}:${period.from}:${period.to}`, keepPreviousData: true }
  );

  const all = useMemo(() => data?.supervisors ?? [], [data]);
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter((s) => !q
      || s.name.toLowerCase().includes(q)
      || s.machines.some((m) => String(m.reference).toLowerCase().includes(q))
      || s.operators.some((o) => o.toLowerCase().includes(q)));
    const key = SORTS[sortKey] ?? SORTS.lines;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a.name.localeCompare(b.name);
    });
  }, [all, query, sortKey, sortDir]);
  const totals = useMemo(() => supervisorTotals(all), [all]);
  const openRec = open ? all.find((s) => s.key === open) ?? null : null;

  const pageCount = Math.max(1, Math.ceil(sorted.length / step));
  const at = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(at * step, at * step + step);

  const toggleSort = (k) => {
    setPage(0);
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "supervisor" ? "asc" : "desc"); }
  };

  const downloadCsv = () => downloadTableCsv({
    head: ["Supervisor", "Departments", "Machines", "Plan lines", "Days", "Planned hours", "Judged lines", "Planned hours judged", "Hours run",
      "Delivered %", "Ran", "Did not run", "Late starts", "No signal", "Not tracked", "Shift not over"],
    body: sorted.map((s) => [nameCase(s.name), s.departments.map(sentence).join(" · "), s.machines.map((m) => m.reference).join(" · "), s.lines, s.days,
      s.plannedHours, s.judged, s.judgedPlannedHours, s.runHours, s.deliveredPct ?? "", s.ran, s.notRun, s.lateStarts, s.silent, s.untracked, s.open]),
    filenameSlug: `supervisor-scorecard-${period.from}${period.to !== period.from ? `-to-${period.to}` : ""}`,
  });

  if (error && !data) return <LoadError label="Supervisor scorecard" onRetry={retry} fullSection />;
  if (data && data.factory === null) {
    return <p className="sc-status" role="status">This organisation has no FactorySuite work plans, so it has no supervisors to show.</p>;
  }

  const waiting = loading && !data;
  const refreshing = Boolean(stale);
  const late = data?.rules?.lateStartMinutes ?? 60;
  const skipped = (data?.skipped?.draft ?? 0) + (data?.skipped?.cancelled ?? 0);

  return (
    <section className="sc" aria-label="Supervisor scorecard">
      <div className="dr-filters">
        <div className="dr-filters__chips" role="group" aria-label="Period">
          {lead}
          <span className="dr-rankby__label" aria-hidden="true">Period</span>
          <span className="dr-seg">
            {options.map((p) => (
              <button key={p.key} type="button"
                      className={`dr-chip${!custom && p.key === periodKey ? " dr-chip--active" : ""}`}
                      aria-pressed={!custom && p.key === periodKey} onClick={() => pickPeriod(p)}>
                {p.label}
              </button>
            ))}
          </span>
          <DateRangePicker from={period.from} to={period.to} today={today} maxDays={MAX_DAYS} quickPicks={false}
                           label="Scorecard dates" onChange={(from, to) => pickPeriod({ key: null, from, to })} />
        </div>
        <div className="sc-pdf">
          <button type="button" className="dr-pager__btn" disabled={!sorted.length} onClick={downloadCsv}
                  title="Every supervisor in the list as a CSV (opens in Excel)">
            CSV
          </button>
        </div>
        <div className="dr-searchwrap">
          <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input className="dr-search" type="search" value={query}
                 onChange={(e) => { setQuery(e.target.value); setPage(0); setOpen(null); }}
                 placeholder="Search supervisor, machine, operator…" aria-label="Search supervisor, machine or operator" />
        </div>
      </div>

      <section className="dr-strip sc-strip" aria-label="Supervisor totals">
        <StatCell label="Supervisors" loading={waiting} value={fmt(totals.supervisors)}
                  sub={`${fmt(totals.machines)} machines · ${fmt(totals.lines)} plan lines`} />
        <StatCell label="Hours run" loading={waiting} value={hrs(totals.runHours)}
                  sub={`of ${hrs(totals.judgedPlannedHours)} planned on ${fmt(totals.judged)} tracked lines · ${pct(totals.deliveredPct)}`} />
        <StatCell label="Did not run" loading={waiting} value={fmt(totals.notRun)} tone={totals.notRun ? "sc-down" : ""}
                  sub={`${fmt(totals.lateStarts)} started over ${late} min late`} />
        <StatCell label="Not judged" loading={waiting} value={fmt(totals.silent + totals.untracked + totals.open)}
                  sub={`${fmt(totals.untracked)} not tracked · ${fmt(totals.silent)} no signal · ${fmt(totals.open)} shift not over`} />
      </section>

      {data && (
        <ul className="sc-notes">
          <li>
            A plan line&rsquo;s shift runs from its start time for its planned hours. Hours run are the machine&rsquo;s engine hours inside that window;
            a line under {fmt(data.rules?.notRunHours ?? 0.25, 2)} h did not run, and one whose machine first worked more than {late} minutes after the start is a late start.
          </li>
          {skipped > 0 && (
            <li className="sc-notes__quiet">
              {fmt(data.skipped.draft)} draft and {fmt(data.skipped.cancelled)} cancelled plan lines are left out.
            </li>
          )}
        </ul>
      )}

      {waiting && <p className="sc-status" role="status" aria-live="polite">Loading supervisors and the hours their machines ran…</p>}

      <div className={`dr-grid-card sc-card${refreshing ? " sc-card--refreshing" : ""}`} aria-busy={waiting || refreshing}>
        {refreshing && <div className="sc-progress" role="progressbar" aria-label="Updating supervisors" />}
        <div className="dr-grid-scroll">
          <table className="dr-grid sv-grid">
            <thead>
              <tr>
                <SortTh label="Supervisor" k="supervisor" {...{ sortKey, sortDir }} onClick={toggleSort} />
                <SortTh label="Machines" k="machines" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Plan lines" k="lines" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Days" k="days" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Planned" k="planned" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Run" k="run" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Delivered" k="delivered" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Ran" k="ran" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Did not run" k="notRun" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Late starts" k="late" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="No signal" k="silent" {...{ sortKey, sortDir }} onClick={toggleSort} num />
                <SortTh label="Not tracked" k="untracked" {...{ sortKey, sortDir }} onClick={toggleSort} num />
              </tr>
            </thead>
            <tbody>
              {waiting && Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="sc-skel" aria-hidden="true">
                  <td className="dr-drivercell"><span className="dr-driver"><span className="sc-skel__avatar" /><span className="sc-skel__lines"><span style={{ width: `${110 + (i * 37) % 60}px` }} /><span /></span></span></td>
                  {Array.from({ length: COLS - 1 }, (_, j) => <td key={j} className="dr-num"><span className="sc-skel__bar" /></td>)}
                </tr>
              ))}
              {data && sorted.length === 0 && (
                <tr><td colSpan={COLS} className="dr-grid__empty">
                  {query ? "No supervisor matches." : "No work plan in this period names a supervisor."}
                </td></tr>
              )}
              {pageRows.map((s) => {
                const isOpen = open === s.key;
                const toggle = () => setOpen(isOpen ? null : s.key);
                const refs = s.machines.map((m) => m.reference);
                return (
                    <tr key={s.key} className={isOpen ? "dr-grid__row--selected" : ""} onClick={toggle} tabIndex={0} aria-selected={isOpen}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
                      <td className="dr-drivercell">
                        <span className="dr-driver">
                          <span className="dr-avatar">{initialsOf(nameCase(s.name))}</span>
                          <span className="dr-driver__ident">
                            <span className="dr-driver__name">{nameCase(s.name)}</span>
                            <span className="dr-driver__sub">{s.departments.map(sentence).join(" · ") || "–"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="dr-num" data-label="Machines" title={refs.join(", ")}>
                        {fmt(refs.length)}<span className="sv-sub">{refs.slice(0, 2).join(" · ")}{refs.length > 2 ? ` +${refs.length - 2}` : ""}</span>
                      </td>
                      <td className="dr-num" data-label="Plan lines">{fmt(s.lines)}</td>
                      <td className="dr-num" data-label="Days">{fmt(s.days)}</td>
                      <td className="dr-num" data-label="Planned">{hrs(s.plannedHours)}</td>
                      <td className="dr-num" data-label="Run" title={`${hrs(s.runHours)} of ${hrs(s.judgedPlannedHours)} planned on ${s.judged} tracked lines`}>{hrs(s.judged ? s.runHours : null)}</td>
                      <td className="dr-num" data-label="Delivered">{pct(s.deliveredPct)}</td>
                      <td className="dr-num" data-label="Ran">{fmt(s.ran)}</td>
                      <CountCell n={s.notRun} label="Did not run" />
                      <CountCell n={s.lateStarts} label="Late starts" tone="speed" />
                      <td className={`dr-num${s.silent ? "" : " dr-num--zero"}`} data-label="No signal">{fmt(s.silent)}</td>
                      <td className={`dr-num${s.untracked ? "" : " dr-num--zero"}`} data-label="Not tracked">{fmt(s.untracked)}</td>
                    </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="dr-pager" aria-label="Supervisor pages">
            <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>← Prev</button>
            <span className="dr-pager__info" aria-live="polite">
              Page {at + 1} of {pageCount}
              <span className="dr-pager__range">{" · "}{fmt(at * step + 1)}–{fmt(at * step + pageRows.length)} of {fmt(sorted.length)}</span>
            </span>
            <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.min(pageCount - 1, at + 1))} disabled={at >= pageCount - 1}>Next →</button>
          </nav>
        )}
      </div>
      {openRec && <SupervisorPanel key={openRec.key} s={openRec} late={late} from={data?.from} to={data?.to} onClose={closePanel} />}
    </section>
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
    { label: "Run", value: s.judged ? fmt(s.runHours, 1) : "–", unit: s.judged ? "h" : null },
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

function SortTh({ label, k, sortKey, sortDir, onClick, num }) {
  const active = sortKey === k;
  return (
    <th className={num ? "dr-num" : undefined} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="dr-grid__sort" onClick={() => onClick(k)} title={`Sort by ${label.toLowerCase()}`}>
        <span>{label}</span>
        <span className={"dr-caret" + (active ? ` dr-caret--${sortDir}` : "")} aria-hidden="true" />
      </button>
    </th>
  );
}

/** The roster's incident cell: a dot as well as the colour. */
function CountCell({ n, label, tone = "theft" }) {
  if (!n) return <td className="dr-num dr-num--zero" data-label={label}>0</td>;
  return (
    <td className={`dr-num dr-incident dr-incident--${tone}`} data-label={label}>
      <span className="dr-incident__dot" aria-hidden="true" />{fmt(n)}
    </td>
  );
}

function StatCell({ label, value, sub, tone = "", loading = false }) {
  return (
    <div className="dr-cell">
      <div className="dr-statchart__head"><span className="dr-statchart__label">{label}</span></div>
      <div className={`dr-statchart__value ${tone}`}>
        {loading ? <span className="sc-skel__bar sc-skel__bar--figure" aria-label="Loading" /> : value}
      </div>
      <div className="dr-statchart__sub">{loading ? <span className="sc-skel__bar sc-skel__bar--caption" /> : sub}</div>
    </div>
  );
}
