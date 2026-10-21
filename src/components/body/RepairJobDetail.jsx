/**
 * One repair job, opened from its row on Maintenance > Repairs.
 *
 * The Fuel Audit's shape (operator, 2026-10-01) without its overhaul: no
 * probe inspection checklist, because a job here can be any fault (a dead
 * probe, a silent tracker, an ignition wire) and the checklist is a probe's.
 * Everything on it is about the ONE job picked:
 *
 *   left   what it is: the fault, the outcome filed, the note, who filed it
 *          and who has it, then its repair progress (move, sign off)
 *   right  its spare parts: order one (the list matches the fault) and track
 *          each ordered -> received -> fitted, with the fix date
 *
 * Reads the job's parts itself and again whenever a repair changes anywhere
 * (REPAIRS_CHANGED), so the Fuel Audit and this stay in step.
 */

import { useCallback, useEffect, useState } from "react";
import {
  fetchRepairOverhaul, humanKind, OUTCOME_LABEL, REPAIRS_CHANGED, estimateState,
} from "../../api/repairs";
import RepairTrackingLine from "./RepairTrackingLine";
import { SpareParts } from "../screens/AuditOverhaul";
import "../screens/SystemScreen.css";
import "../screens/AuditScreen.css";
import "./RepairJobDetail.css";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const at = (iso) => (iso ? WHEN.format(new Date(iso)) : null);

/** What the job is about, in words: the probe, or the sensor fault. */
const FAULT_SUBJECT = {
  fuel_probe_dead: "Fuel probe dead",
  gps_not_reporting: "GPS not reporting",
  signal_lost: "Tracker signal lost",
  ignition_not_reporting: "Ignition not reporting",
  odometer_not_reporting: "Odometer not reporting",
  engine_hours_not_reporting: "Engine hours not reporting",
};
export function jobSubject(job) {
  if (job?.targetKind === "probe") return "Fuel probe";
  return FAULT_SUBJECT[job?.faultKind] ?? humanKind(job?.faultKind);
}

function Fact({ label, children }) {
  if (children == null || children === "") return null;
  return (
    <div className="rjd-fact">
      <span className="rjd-fact-label">{label}</span>
      <span className="rjd-fact-value">{children}</span>
    </div>
  );
}

/**
 * `inPanel`: inside the detail sidebar (RepairJobsPanel), where the unit and
 * the fault already head the panel. One column, under hairlines, no frame.
 */
export default function RepairJobDetail({ orgId, job, canResolve = false, onToast, onChanged, inPanel = false }) {
  const [parts, setParts] = useState(null);
  const plate = job.vehicle?.registrationPlate ?? "this unit";

  const read = useCallback(() => {
    fetchRepairOverhaul({ orgId, itemId: job.id })
      .then((o) => setParts(o?.parts ?? []))
      .catch((e) => onToast?.({ tone: "crit", text: e?.message ? `Could not load the spare parts: ${e.message}` : "Could not load the spare parts." }));
  }, [orgId, job.id, onToast]);

  useEffect(() => {
    read();
    window.addEventListener(REPAIRS_CHANGED, read);
    return () => window.removeEventListener(REPAIRS_CHANGED, read);
  }, [read]);

  const est = estimateState(job);
  const suppliers = [...new Set((parts ?? []).map((p) => p.supplier).filter(Boolean))];

  return (
    <div className={"rjd" + (inPanel ? " rjd--panel" : "")}>
      <div className="rjd-grid">
        <div className="rjd-col">
          <section className="rjd-facts" aria-label="The job">
            <h3 className="aud-h">{inPanel ? "The Job" : `${jobSubject(job)} · ${plate}`}</h3>
            <Fact label="Outcome">{OUTCOME_LABEL[job.outcome] ?? job.outcome}</Fact>
            <Fact label="Problem">{job.problemNote}</Fact>
            <Fact label="Filed">
              {[job.report?.reportedBy?.fullName, at(job.report?.reportedAt)].filter(Boolean).join(" · ") || null}
            </Fact>
            <Fact label="Assigned to">{job.assignedTo?.fullName ?? "Nobody yet"}</Fact>
            {est.text !== "-" && (
              <Fact label="Fix date">
                <span className={est.overdue ? "rjd-late" : undefined}>{est.text}</span>
              </Fact>
            )}
            {job.resolvedAt && (
              <>
                <Fact label="Signed off">
                  {[job.resolvedBy?.fullName, at(job.resolvedAt)].filter(Boolean).join(" · ")}
                </Fact>
                <Fact label="What was done">{job.fixNote}</Fact>
                <Fact label="Recommendation">{job.recommendation}</Fact>
              </>
            )}
          </section>

          <RepairTrackingLine
            item={job}
            orgId={orgId}
            canResolve={canResolve}
            onChanged={onChanged}
            onError={(text) => onToast?.({ tone: "crit", text })}
          />
        </div>

        {parts === null
          ? <div className="aud-ov-col aud-ov-col--parts"><p className="sp4-muted">Loading the spare parts…</p></div>
          : (
            <SpareParts
              orgId={orgId}
              job={job}
              plate={plate}
              parts={parts}
              suppliers={suppliers}
              canWork={canResolve && !job.resolvedAt}
              onToast={onToast}
              onChanged={read}
            />
          )}
      </div>
    </div>
  );
}
