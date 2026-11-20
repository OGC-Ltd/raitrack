// Maintenance › Plan submissions (operator 2026-11-20): FactorySuite's own
// board of which department sent tomorrow's work plan, and whether by 16:00
// the day before. The board is built on the server (planner/plan-submissions)
// and kept live by FactorySuite's work plan hooks (hooks/usePlanSubmissions).
//
// Top: the chosen day, one card per department. Below: the 14 days ending on
// the picked date; a square opens its day in the cards above.

import { useMemo, useState } from "react";
import { usePlanSubmissions } from "../../hooks/usePlanSubmissions";
import { STATES, LEGEND, cellDetail, cellIndex, cellTitle, dayOfMonth, isWeekend, longDay, weekday } from "../../lib/planSubmissions";
import LoadError from "../shared/LoadError";
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

  if (error && !data) return <div className="psb"><LoadError label="Plan submissions" onRetry={refetch} fullSection /></div>;
  if (loading || !data) return <div className="psb"><div className="psb__empty">Loading plan submissions…</div></div>;
  if (data.factory == null) {
    return <div className="psb"><div className="psb__empty">This organisation keeps no FactorySuite work plans.</div></div>;
  }

  const isTomorrow = selected && data.today && selected > data.today;
  const pickDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setWindowDay(value);
    setPicked(value);
  };

  return (
    <div className="psb">
      <section className="psb-card" aria-labelledby="psb-title">
        <header className="psb-head">
          <span className="psb-head__icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 11h6M9 15h4" />
            </svg>
          </span>
          <div className="psb-head__text">
            <h2 id="psb-title" className="psb-head__title">Plan submissions</h2>
            <p className="psb-head__sub">
              {isTomorrow ? "Work plans for tomorrow" : `Work plans for ${longDay(selected)}`}, due by {String(data.dueHour).padStart(2, "0")}:00 the day before
            </p>
          </div>
          <div className="psb-head__progress" aria-label={`${sentOnSelected} of ${departments.length} departments sent`}>
            <span className="psb-meter"><span className="psb-meter__fill" style={{ width: `${departments.length ? (sentOnSelected / departments.length) * 100 : 0}%` }} /></span>
            <span className="psb-head__count">{sentOnSelected}/{departments.length} sent</span>
          </div>
          <span className="psb-head__spacer" />
          <span className={"psb-live" + (fetching ? " psb-live--busy" : "")} title="Updates as soon as FactorySuite reports a plan created, sent, approved or sent back">
            <span className="psb-live__dot" aria-hidden="true" />
            {fetching ? "Updating…" : `Live, updated ${fmtUpdated(updatedAt) ?? "now"}`}
          </span>
          <label className="psb-date">
            <span className="psb-sr">Show the two weeks ending on</span>
            <input type="date" value={lastDay ?? ""} onChange={(e) => pickDate(e.target.value)} />
          </label>
        </header>

        <div className="psb-depts">
          {departments.map((dept) => {
            const cell = index.get(dept)?.get(selected);
            const state = cell?.state ?? "none";
            return (
              <div key={dept} className={`psb-dept psb-tone--${state}`} title={cell ? cellTitle(cell, dept) : undefined}>
                <span className="psb-dept__icon"><StateIcon state={state} size={18} /></span>
                <span className="psb-dept__text">
                  <span className="psb-dept__name">{dept}</span>
                  <span className="psb-dept__state">{cellDetail(cell)}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="psb-grid-head">
          <h3 className="psb-grid-head__title">Last two weeks</h3>
          <span className="psb-grid-head__hint">Tap a square to open that day</span>
        </div>

        <div className="psb-grid-wrap">
          <table className="psb-grid">
            <thead>
              <tr>
                <th scope="col" className="psb-grid__dept">Department</th>
                {days.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className={"psb-grid__day" + (isWeekend(d) ? " is-weekend" : "") + (d === selected ? " is-selected" : "")}
                  >
                    <span className="psb-grid__wd">{weekday(d)}</span>
                    <span className={"psb-grid__dom" + (d === data.today ? " is-today" : "")} title={d === data.today ? "Today" : undefined}>{dayOfMonth(d)}</span>
                  </th>
                ))}
                <th scope="col" className="psb-grid__ontime">On time</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept}>
                  <th scope="row" className="psb-grid__dept">{dept}</th>
                  {days.map((d) => {
                    const cell = index.get(dept)?.get(d);
                    const state = cell?.state ?? "none";
                    return (
                      <td key={d} className={(isWeekend(d) ? "is-weekend" : "") + (d === selected ? " is-selected" : "")}>
                        <button
                          type="button"
                          className={`psb-sq psb-tone--${state}` + (d === selected ? " psb-sq--selected" : "")}
                          title={cell ? cellTitle(cell, dept) : `${dept}, ${longDay(d)}: Not started`}
                          aria-label={`${dept}, ${longDay(d)}: ${STATES[state].label}`}
                          aria-pressed={d === selected}
                          onClick={() => setPicked(d)}
                        >
                          <StateIcon state={state} size={14} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="psb-grid__ontime">
                    <span className="psb-ontime">
                      <span className="psb-meter psb-meter--small"><span className="psb-meter__fill psb-meter__fill--bad" style={{ width: `${((data.onTime?.[dept] ?? 0) / days.length) * 100}%` }} /></span>
                      <span className="psb-ontime__n">{data.onTime?.[dept] ?? 0}/{days.length}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="psb-grid__dept">Sent</th>
                {days.map((d) => (
                  <td key={d} className={"psb-grid__sent" + (isWeekend(d) ? " is-weekend" : "") + (d === selected ? " is-selected" : "") + ((data.sent?.[d] ?? 0) === 0 ? " is-zero" : "")}>
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
              <span className={`psb-sq psb-sq--key psb-tone--${s}`}><StateIcon state={s} size={11} /></span>
              {STATES[s].label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
