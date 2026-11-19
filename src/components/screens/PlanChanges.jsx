/**
 * Fuel › Plan changes: what changed on FactorySuite's work plans for the days
 * shown, and what is wrong with them as they stand (operator 2026-11-19:
 * "we need to ensure that we monitor any changes happening on the workplan
 * from factory suite").
 *
 *   • Planned twice: a machine on two lines for one day and shift.
 *   • Not decided: plans for a day already gone, still draft or submitted.
 *   • Changes: fleet-server's work plan watch (planner/work-plan-watch) reads
 *     the plans every few minutes and on FactorySuite's events, and records
 *     each difference. Nothing before the watch started is known.
 *
 * Built in the Drivers page grammar (dr-grid-card, dr-grid, badges).
 */
import { useMemo, useState } from "react";
import { getWorkPlanChanges } from "../../api/factoryFuel";
import { useApiData } from "../../hooks/useApiData";
import { changeTone, changeWords, planDoubles, undecidedPlans } from "../../lib/workPlanChanges";

const TONE_BADGE = { good: "active", warn: "suspended", bad: "terminated", info: "unknown" };
const STEP = 12;

const sentence = (s) => {
  const t = String(s ?? "").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};
const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtWhen = (iso) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

/**
 * @param {{ companyId: string, from: string, to: string, lines: object[], dept: string|null, today: string }} props
 *   `lines` is the Fuel data's lines (cancelled plans already out), `dept` the
 *   department picked on the page (null for all).
 */
export default function PlanChanges({ companyId, from, to, lines, dept, today }) {
  const { data, loading, error } = useApiData(
    () => getWorkPlanChanges({ companyId, from, to }),
    [companyId, from, to],
    { cacheKey: `ft-work-plan-changes:${companyId}:${from}:${to}`, keepPreviousData: true },
  );

  const inDept = (d) => !dept || (d ?? "") === dept;
  const scoped = useMemo(() => (lines ?? []).filter((l) => inDept(l.department)), [lines, dept]); // eslint-disable-line react-hooks/exhaustive-deps
  const doubles = useMemo(() => planDoubles(scoped), [scoped]);
  const undecided = useMemo(() => undecidedPlans(scoped, today), [scoped, today]);
  const changes = useMemo(() => (data?.changes ?? []).filter((c) => inDept(c.department)), [data, dept]); // eslint-disable-line react-hooks/exhaustive-deps

  const [shown, setShown] = useState(STEP);
  const rows = changes.slice(0, shown);

  return (
    <section className="dr-grid-card plan-changes" aria-labelledby="plan-changes-title">
      <div className="plan-changes__head">
        <h2 id="plan-changes-title" className="plan-changes__title">Plan changes</h2>
        <span className="plan-changes__meta">
          {error ? "Change history unavailable"
            : loading && !data ? "Loading…"
            : !data?.watching ? "Not watching yet"
            : `${changes.length} change${changes.length === 1 ? "" : "s"}${data.watchedSince ? `, watched since ${fmtWhen(data.watchedSince)}` : ""}`}
        </span>
      </div>

      {(doubles.length > 0 || undecided.length > 0) && (
        <div className="plan-changes__flags">
          {doubles.length > 0 && (
            <div className="plan-flag">
              <h3 className="plan-flag__title">
                <span className="dr-grid__badge dr-grid__badge--suspended"><span className="dr-grid__dot" aria-hidden="true" />Planned twice</span>
                <span className="plan-flag__count">{doubles.length}</span>
              </h3>
              <ul className="plan-flag__list">
                {doubles.map((d) => (
                  <li key={`${d.day}|${d.machine}|${d.shiftNo}`}>
                    <b>{d.machine}</b>, {fmtDay(d.day)}, shift {d.shiftNo ?? "?"}:{" "}
                    {d.lines.map((l) => `${l.planCode} (${sentence(l.planStatus).toLowerCase()}${l.operator ? `, ${l.operator}` : ""})`).join(" and ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {undecided.length > 0 && (
            <div className="plan-flag">
              <h3 className="plan-flag__title">
                <span className="dr-grid__badge dr-grid__badge--unknown"><span className="dr-grid__dot" aria-hidden="true" />Never decided</span>
                <span className="plan-flag__count">{undecided.length}</span>
              </h3>
              <ul className="plan-flag__list">
                {undecided.map((p) => (
                  <li key={p.planCode}>
                    <b>{p.planCode}</b>, {fmtDay(p.day)}, still {sentence(p.status).toLowerCase()}, {p.lines} line{p.lines === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {changes.length === 0 ? (
        <p className="plan-changes__empty">
          {error ? "The change history could not be read. Planned twice and never decided above are from the plans themselves."
            : !data?.watching ? "Changes are recorded from when the watch first reads the plans."
            : `No changes to plans for ${from === to ? fmtDay(from) : `${fmtDay(from)} to ${fmtDay(to)}`}.`}
        </p>
      ) : (
        <div className="dr-grid-scroll">
          <table className="dr-grid plan-changes__grid">
            <thead>
              <tr>
                <th scope="col">Seen</th>
                <th scope="col">Plan</th>
                <th scope="col">Machine</th>
                <th scope="col">What changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="dr-when" data-label="Seen" title={c.source === "hook" ? `After FactorySuite's ${c.event ?? "event"}` : "Found by the regular check"}>
                    {fmtWhen(c.detectedAt)}
                  </td>
                  <td data-label="Plan">
                    <span className="fuel-dept">{c.planCode}</span>
                    <span className="dr-driver__sub">{[sentence(c.department), fmtDay(c.day)].filter(Boolean).join(", ")}</span>
                  </td>
                  <td data-label="Machine">
                    {c.machine ? <>{c.machine}{c.shiftNo != null && <span className="dr-driver__sub">Shift {c.shiftNo}</span>}</> : <span className="plan-changes__none">Whole plan</span>}
                  </td>
                  <td data-label="What changed">
                    <span className={`dr-grid__badge dr-grid__badge--${TONE_BADGE[changeTone(c)]} plan-changes__what`}>
                      <span className="dr-grid__dot" aria-hidden="true" />{changeWords(c)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changes.length > shown && (
        <nav className="dr-pager" aria-label="More plan changes">
          <button type="button" className="dr-pager__btn" onClick={() => setShown((n) => n + STEP * 2)}>
            Show more ({changes.length - shown} left)
          </button>
        </nav>
      )}
    </section>
  );
}
