/**
 * Fuel › Plan updates: FactorySuite plan lines that changed on the days shown,
 * one row per line, as it stands now (operator 2026-11-19: "if an item was
 * drafted and awaiting approval we should update it based on the new changes
 * either accepted or rejected no point of having duplicates records").
 *
 *   • Updates: fleet-server's work plan watch (planner/work-plan-watch) keeps
 *     every plan line and updates it in place, so a pending line approved or
 *     rejected is the same row, reading "Pending → Approved". A machine can be
 *     on any number of plans; each of its lines is its own row. Nothing before
 *     the watch started is known.
 *   • Never decided: plans for a day already gone, still draft or submitted.
 *
 * Built in the Drivers page grammar (dr-grid-card, dr-grid, badges).
 */
import { useMemo, useState } from "react";
import { getWorkPlanUpdates } from "../../api/factoryFuel";
import { useApiData } from "../../hooks/useApiData";
import { lineEdits, statusTone, statusWords, undecidedPlans } from "../../lib/workPlanUpdates";

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
export default function PlanUpdates({ companyId, from, to, lines, dept, today }) {
  const { data, loading, error } = useApiData(
    () => getWorkPlanUpdates({ companyId, from, to }),
    [companyId, from, to],
    { cacheKey: `ft-work-plan-updates:${companyId}:${from}:${to}`, keepPreviousData: true },
  );

  const inDept = (d) => !dept || (d ?? "") === dept;
  const undecided = useMemo(() => undecidedPlans((lines ?? []).filter((l) => inDept(l.department)), today), [lines, dept, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => (data?.items ?? []).filter((c) => inDept(c.department)), [data, dept]); // eslint-disable-line react-hooks/exhaustive-deps

  const [shown, setShown] = useState(STEP);
  const rows = items.slice(0, shown);

  return (
    <section className="dr-grid-card plan-changes" aria-labelledby="plan-updates-title">
      <div className="plan-changes__head">
        <h2 id="plan-updates-title" className="plan-changes__title">Plan updates</h2>
        <span className="plan-changes__meta">
          {error ? "Updates unavailable"
            : loading && !data ? "Loading…"
            : !data?.watching ? "Not watching yet"
            : `${items.length} line${items.length === 1 ? "" : "s"} updated${data.watchedSince ? `, watched since ${fmtWhen(data.watchedSince)}` : ""}`}
        </span>
      </div>

      {undecided.length > 0 && (
        <div className="plan-changes__flags">
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
        </div>
      )}

      {items.length === 0 ? (
        <p className="plan-changes__empty">
          {error ? "The plan updates could not be read. Never decided above is from the plans themselves."
            : !data?.watching ? "Updates are recorded from when the watch first reads the plans."
            : `No plan line changed for ${from === to ? fmtDay(from) : `${fmtDay(from)} to ${fmtDay(to)}`}.`}
        </p>
      ) : (
        <div className="dr-grid-scroll">
          <table className="dr-grid plan-changes__grid">
            <thead>
              <tr>
                <th scope="col">Updated</th>
                <th scope="col">Plan</th>
                <th scope="col">Machine</th>
                <th scope="col">Status</th>
                <th scope="col">Line changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const edits = lineEdits(c);
                return (
                  <tr key={c.id}>
                    <td className="dr-when" data-label="Updated">{fmtWhen(c.editedAt)}</td>
                    <td data-label="Plan">
                      <span className="fuel-dept">{c.planCode}</span>
                      <span className="dr-driver__sub">{[sentence(c.department), fmtDay(c.day)].filter(Boolean).join(", ")}</span>
                    </td>
                    <td data-label="Machine">
                      {c.machine}{c.shiftNo != null && <span className="dr-driver__sub">Shift {c.shiftNo}</span>}
                    </td>
                    <td data-label="Status"
                        title={c.statusChangedAt ? `Status changed ${fmtWhen(c.statusChangedAt)}${c.reviewedBy ? ` by ${c.reviewedBy}` : ""}` : undefined}>
                      <span className={`dr-grid__badge dr-grid__badge--${TONE_BADGE[statusTone(c.status)]} plan-changes__what`}>
                        <span className="dr-grid__dot" aria-hidden="true" />{statusWords(c)}
                      </span>
                    </td>
                    <td data-label="Line changes" className="plan-changes__what">
                      {edits.length ? edits.join("; ") : <span className="plan-changes__none">None</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {items.length > shown && (
        <nav className="dr-pager" aria-label="More plan updates">
          <button type="button" className="dr-pager__btn" onClick={() => setShown((n) => n + STEP * 2)}>
            Show more ({items.length - shown} left)
          </button>
        </nav>
      )}
    </section>
  );
}
