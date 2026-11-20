/**
 * One plan line, down the right of the Work Plan page (operator 2026-11-20:
 * "on the table for work plan when I click on a row we should get the
 * sidepanel populated"). The Fuel page's machine panel frame (DriversScreen.css
 * .dr-panel, lib/sidePanels): one side panel open at a time, Escape closes it.
 *
 * What it shows is the line as FactorySuite holds it (planner/work-plans,
 * MapWorkPlanLine and its plan): the shift, the work, who runs it, the fuel
 * asked for and issued, then every line this unit has in the dates picked, so
 * the next one is a click away. Nothing here is worked out on the page except
 * the shift's hours, which shiftText already draws for the table.
 */
import { useEffect, useRef } from "react";
import { useAppActions } from "../../context/AppContext";
import { claimSidePanel, onSidePanelClaim } from "../../lib/sidePanels";
import { longDay, shortDay, planStatus } from "../../lib/planSubmissions";
import { nameCase } from "../../lib/factorySupervisors";
import "../screens/DriversScreen.css";
import "./PlanLinePanel.css";

const BADGE = { APPROVED: "active", SUBMITTED: "suspended", DRAFT: "draft", REJECTED: "terminated", WITHDRAWN: "terminated", CANCELLED: "unknown" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtN = (n, d = 0) => Number(n).toLocaleString("en-GB", { maximumFractionDigits: d });
/** FactorySuite's wall clock, offsetless ("2026-11-13T13:35:12") → "13 Nov, 13:35". */
const wall = (s) => {
  if (typeof s !== "string" || s.length < 16) return null;
  return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}, ${s.slice(11, 16)}`;
};
const sentence = (s) => (s ? String(s).toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);

function Badge({ status }) {
  return (
    <span className={`dr-grid__badge dr-grid__badge--${BADGE[status] ?? "unknown"}`}>
      <span className="dr-grid__dot" aria-hidden="true" />
      {planStatus(status).label}
    </span>
  );
}

/** Label and value rows; a row with no value is left out, a section with none says so. */
function Facts({ rows, none }) {
  const shown = rows.filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (!shown.length) return <p className="dr-panel__note">{none}</p>;
  return (
    <dl className="psl-facts">
      {shown.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(", ") : v}</dd></div>
      ))}
    </dl>
  );
}

/**
 * @param {{ row: object, lines: object[], onPick: (key: string) => void, onClose: () => void }} props
 *   `row` is a UnitsTable row (lib/planSubmissions unitRows, with its day);
 *   `lines` every row of the same unit in the dates picked.
 */
export default function PlanLinePanel({ row, lines, onPick, onClose }) {
  const { setSelectedVehicleId, setDesktopActiveTab } = useAppActions();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") closeRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    claimSidePanel("plans");
    return onSidePanelClaim("plans", () => closeRef.current?.());
  }, []);

  const l = row.line ?? {};
  const p = row.plan ?? {};
  const planned = [l.plannedHours != null && `${fmtN(l.plannedHours, 1)} h`, l.plannedKm != null && `${fmtN(l.plannedKm)} km`].filter(Boolean).join(", ");
  const output = l.expectedOutput != null ? `${fmtN(l.expectedOutput, 1)}${l.outputUnit ? ` ${l.outputUnit.toLowerCase()}` : ""}` : null;
  const asked = l.fullTank ? "A full tank" : l.litresRequested != null ? `${fmtN(l.litresRequested)} L` : null;
  const issues = l.pump?.issues ?? [];
  const issued = issues.reduce((n, i) => n + (i.litres ?? 0), 0);
  const meta = [row.machineName, l.plate].filter(Boolean).join(", ");

  const showOnMap = () => {
    setSelectedVehicleId(l.vehicleId);
    setDesktopActiveTab("fleet");
  };

  return (
    <aside className="dr-panel psl" role="dialog" aria-label={`${row.machine}, plan line for ${longDay(row.day)}`}>
      <header className="dr-panel__head">
        <span className="dr-panel__title">Plan line</span>
        <button type="button" className="dr-panel__x" onClick={onClose} aria-label="Close plan line">×</button>
      </header>

      <div className="dr-panel__body">
        <section className="psl-id" aria-label="Unit">
          <div className="psl-id__who">
            <span className="psl-id__name">{row.machine}</span>
            <span className="psl-id__meta">{meta || "Not in the register"}</span>
          </div>
          <p className="psl-id__when">{longDay(row.day)}{row.shift ? `, ${row.shift}` : ""}</p>
          <dl className="psl-id__facts">
            <div className="psl-id__status"><dt>Status</dt><dd><Badge status={row.status} /></dd></div>
            <div><dt>Department</dt><dd>{nameCase(row.department)}</dd></div>
            <div><dt>Plan</dt><dd>{row.planCode ?? "-"}</dd></div>
            <div><dt>Shift</dt><dd>{row.shiftNo != null ? `Shift ${row.shiftNo}` : "-"}</dd></div>
            <div><dt>Planned</dt><dd>{planned || "-"}</dd></div>
          </dl>
          {l.downReason && <p className="psl-id__down">{sentence(l.downReason)}</p>}
        </section>

        <section className="dr-panel__sec psl-sec">
          <h3 className="dr-panel__h">The work</h3>
          <Facts none="FactorySuite names no work on this line." rows={[
            ["Activity", l.activity],
            ["Work location", l.workLocation],
            ["Expected output", output],
            ["Notes", l.notes],
          ]} />
        </section>

        <section className="dr-panel__sec psl-sec">
          <h3 className="dr-panel__h">People</h3>
          <Facts none="No one is named on this line." rows={[
            ["Operators", row.operators],
            ["Supervisor", l.supervisor && nameCase(l.supervisor)],
            ["Sent by", p.submittedBy && [nameCase(p.submittedBy), wall(p.submittedAt)].filter(Boolean).join(", ")],
            ["Reviewed by", p.reviewedBy && [nameCase(p.reviewedBy), wall(p.reviewedAt)].filter(Boolean).join(", ")],
          ]} />
        </section>

        <section className="dr-panel__sec psl-sec">
          <h3 className="dr-panel__h">Fuel</h3>
          <Facts none="No fuel asked for on this line." rows={[
            ["Asked for", asked],
            ["Shift needs", l.needLitres != null ? `About ${fmtN(l.needLitres)} L` : null],
            ["Tank", l.tankLitres != null ? `${fmtN(l.tankLitres)} L` : null],
            ["Fuelling at", l.fuelingLocation],
            ["Request", l.pump ? sentence(l.pump.status) ?? "Raised" : asked ? "Not raised yet" : null],
            ["Issued", issues.length ? `${fmtN(issued, 1)} L in ${issues.length} fuelling${issues.length === 1 ? "" : "s"}` : null],
          ]} />
          {issues.length > 0 && (
            <ul className="psl-issues">
              {issues.map((i, n) => (
                <li key={`${i.at}|${n}`}>
                  <span className="psl-issues__l">{i.done ? (i.litres != null ? `${fmtN(i.litres, 1)} L` : "Done") : "Fuelling"}</span>
                  <span className="psl-issues__at">{[wall(i.at), i.pump ?? i.tank].filter(Boolean).join(", ")}</span>
                  {(i.flags?.length > 0 || i.note) && (
                    <span className="psl-issues__flag">{[...(i.flags ?? []), i.note && sentence(i.note)].filter(Boolean).join(". ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dr-panel__sec psl-sec">
          <h3 className="dr-panel__h">
            Lines for {row.machine}
            <span className="dr-panel__count">{lines.length}</span>
          </h3>
          <ul className="psl-lines">
            {lines.map((r) => {
              const on = r.key === row.key;
              return (
                <li key={r.key}>
                  <button type="button" className={`psl-line${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}
                    onClick={() => onPick(r.key)}>
                    <span className="psl-line__day">{shortDay(r.day)}</span>
                    <span className="psl-line__what">
                      <span className="psl-line__job">{r.activity ?? "No activity named"}</span>
                      <span className="psl-line__sub">{[r.shift, r.workLocation].filter(Boolean).join(", ") || nameCase(r.department)}</span>
                      <span className="psl-line__badge"><Badge status={r.status} /></span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {l.vehicleId && (
        <footer className="dr-panel__foot">
          <button type="button" className="psl-map" onClick={showOnMap}>Show on the map</button>
        </footer>
      )}
    </aside>
  );
}
