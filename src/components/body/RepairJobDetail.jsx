/**
 * One repair job, opened from its row on Maintenance > Repairs.
 *
 * Read only (operator, 2026-10-27): what the job is, then its repair progress
 * as the Workshop has it, the phase ladder and the steps taken. The job is
 * worked, signed off and given its spare parts in Workshop, so this has no
 * close-job controls and no spare parts of its own.
 */

import {
  humanKind, OUTCOME_LABEL, estimateState,
} from "../../api/repairs";
import { PhaseLadder, Trail } from "./RepairWorkflowJob";
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
export default function RepairJobDetail({ job, inPanel = false }) {
  const plate = job.vehicle?.registrationPlate ?? "this unit";
  const est = estimateState(job);

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

          <div className="wf-root rjd-progress">
            <Trail job={job} title="Repair progress" lead={<PhaseLadder stage={job.stage} />} />
          </div>
        </div>
      </div>
    </div>
  );
}
