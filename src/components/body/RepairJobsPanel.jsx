/**
 * Outstanding repair jobs, and where one gets signed off.
 *
 * A TAB RATHER THAN A BUTTON ON THE PROBE ROW. A job is closed days after it
 * is raised — that is the whole point of "needs a spare part" — and by then
 * the unit's HEALTH has moved on. The row that raised it may read differently,
 * sit under a different channel filter, or have dropped out of the fault list
 * entirely because the probe started reporting again while the part was in the
 * post. Asking a technician to re-find it there would be asking them to search
 * a list that is sorted by something other than what they are looking for.
 *
 * Resolution is PER ITEM. Six units reported in one trip get six sign-offs,
 * because their spares arrive on six different days.
 *
 * ## The Fix date column is what this tab is FOR
 *
 * A list of open jobs sorted by when they were filed answers "what is
 * outstanding", which nobody has to be told — the count is on the tab. The
 * question somebody actually arrives with is "what has gone quiet", and only
 * the technician's FIX DATE can answer it: a part due last Tuesday that has
 * not arrived is a supplier to ring, and it is indistinguishable from a part
 * ordered this morning without that date. So overdue rows are SORTED TO THE
 * TOP and painted, and the sort is not a preference the user has to find.
 *
 * Classes are SensorPanel's, like every other panel on this screen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import TableToolbar from "./TableToolbar";
import {
  assignRepairItem, assignmentToast, respondToRepairAssignment, setRepairStage, OUTCOME_LABEL, OUTCOME_PILL,
  STAGE_LABEL, STAGE_PILL, SETTABLE_STAGES, humanKind, estimateState, daysUntil,
  escalationOf, escalationPhrase,
} from "../../api/repairs";
import { listOrgUsers } from "../../api/users";
import RepairSignOffDialog from "./RepairSignOffDialog";
import { useRepairJobs } from "../../hooks/useRepairJobs";

const TRIAGE_ROLE_SLUGS = new Set(["technician", "admin", "super_admin"]);

function canReceiveRepairAssignment(user, orgId) {
  return (user?.userRoles ?? []).some(({ role }) => {
    if (!role || !TRIAGE_ROLE_SLUGS.has(role.slug)) return false;
    // Organisation admins and technicians must hold the role in this tenant.
    // A platform super admin has no organisation id and is valid everywhere.
    return role.slug === "super_admin" || role.organisationId === orgId;
  });
}

/*
 * Four buckets, because "signed off" is two different outcomes and lumping
 * them lost one of them.
 *
 * A job signed off UNSUCCESSFULLY was filed under "Resolved" — the one word it
 * is not. The unit was correctly released (the partial unique index keys on
 * `resolved_at IS NULL`, so it can be reported again the same day), but the
 * record went where nobody would look for it, and from the outside that is
 * indistinguishable from the record being thrown away.
 *
 * So "Resolved" now means the unit went back into service, "Unresolved" means
 * it did not, and the unit is released either way. Postgres guarantees a
 * signed-off job sits on one of the two terminal stages, so nothing can fall
 * between them; `All` remains the union.
 */
const STATES = [
  ["open",       "Open"],
  ["resolved",   "Resolved"],
  ["unresolved", "Unresolved"],
  ["all",        "All"],
];

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

export default function RepairJobsPanel({
  orgId, onReload, canResolve = false, canAssign = false, currentUserId = null,
}) {
  /*
   * The bucket being read, and the thing that makes it real.
   *
   * This used to filter a `rows` prop that the parent fetched once with
   * `status: "open"` — so "Resolved", and now "Unresolved", filtered a set
   * that could not contain what they were looking for, and every signed-off
   * job looked like it had been thrown away. The state drives a FETCH now.
   */
  const [state, setState] = useState("open");
  /* No permission argument: SensorPanel only renders this tab for a role
     holding repair:read, so being mounted IS the gate. */
  const jobs = useRepairJobs(orgId, state);
  const { rows, loading, error } = jobs;

  /* A sign-off changes two lists: this one, and the OPEN set the Probes tab
     greys rows from. Reloading only this one leaves a released unit still
     wearing its "Reported" badge until the screen is remounted. */
  const reloadJobs = jobs.reload;
  const reloadAll = useCallback(() => {
    reloadJobs();
    onReload?.();
  }, [reloadJobs, onReload]);
  /* The job being signed off, or null. The dialog owns the note, the verdict
     and the request — see RepairSignOffDialog for why this is not an inline
     card any more. */
  const [signOff, setSignOff] = useState(null);
  // The id of the row whose stage is mid-flight, so one moving chip does not
  // grey out every other row's.
  const [moving,  setMoving]  = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [assignment, setAssignment] = useState({});
  const [assigning, setAssigning] = useState(null);
  const [responding, setResponding] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!canAssign || !orgId) {
      setAssignees([]);
      return undefined;
    }
    setAssigneesLoading(true);
    listOrgUsers(orgId, { access: "system", limit: 100 })
      .then(({ users }) => {
        if (!cancelled) {
          setAssignees((users ?? []).filter((u) =>
            u.status !== "SUSPENDED" && canReceiveRepairAssignment(u, orgId),
          ));
        }
      })
      .catch(() => { if (!cancelled) setAssignees([]); })
      .finally(() => { if (!cancelled) setAssigneesLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, canAssign]);

  const shown = useMemo(() => {
    /* Mirrors the server's own `status` filter so a locally-held list and a
       refetched one agree. `stage` rather than `resolvedAt` alone for the two
       closed buckets — the terminal stage is what says WHICH kind of finished
       a job is. */
    const kept = rows.filter((r) => {
      if (state === "open")       return !r.resolvedAt;
      if (state === "resolved")   return !!r.resolvedAt && r.stage === "fixed";
      if (state === "unresolved") return !!r.resolvedAt && r.stage === "failed";
      return true;
    });
    /*
     * Overdue first, most overdue at the top, then everything else in the
     * order the server sent (newest filed first).
     *
     * `sort` is in place and `filter` already gave us a fresh array, so this
     * cannot mutate the caller's `rows` — worth stating, because sorting the
     * prop directly is the version of this that works until the parent
     * re-renders.
     *
     * A stable sort is assumed and guaranteed: every engine this ships to
     * implements the ES2019 requirement, so rows that tie on lateness keep the
     * server's ordering rather than shuffling on each render.
     */
    const lateness = (r) => {
      if (r.resolvedAt) return -1;                 // closed jobs are history
      const d = daysUntil(r.expectedResolutionAt); // negative once it has passed
      return d === null || d >= 0 ? -1 : -d;
    };
    return kept.sort((a, b) => lateness(b) - lateness(a));
  }, [rows, state]);

  const summary = useMemo(() => {
    const spares  = shown.filter((r) => r.outcome === "needs_spare").length;
    const blocked = shown.filter((r) => r.outcome === "cannot_fix").length;
    return (
      <>
        <b>{shown.length}</b> job{shown.length === 1 ? "" : "s"}
        {spares  > 0 && <> · <span className="sp4-flag-hint">{spares} awaiting a part</span></>}
        {blocked > 0 && <> · <span className="sp4-probe--fault">{blocked} cannot be fixed</span></>}
      </>
    );
  }, [shown]);

  /* A stage move is a one-click write with no form behind it, so it reports
     its own failure through the toast — the one place this panel says anything
     about a write that did not land. It used to own a banner instead, which
     meant the same failure could be on screen twice at once. */
  async function moveStage(itemId, stage) {
    if (moving) return;
    setMoving(itemId);
    setToast(null);
    try {
      await setRepairStage({ orgId, itemId, stage });
      reloadAll();
    } catch (e) {
      setToast({ tone: "crit", text: e?.message ?? "Could not move this job" });
    } finally {
      setMoving(null);
    }
  }

  async function assignJob(itemId, technicianId) {
    if (assigning) return;
    // Work is given to a person BY a person. There is no longer a path that
    // leaves the choice to the server, so there is nothing sensible to send.
    if (!technicianId) return;
    setAssigning(itemId);
    setToast(null);
    try {
      const result = await assignRepairItem({ orgId, itemId, technicianId });
      setAssignment((prev) => ({ ...prev, [itemId]: "" }));
      const email = result?.assignmentEmail;
      const assignedName = result?.assignedTo?.fullName ?? "the selected person";
      /* QUEUED IS NOT SENT — see assignmentToast, which owns the wording so
         that a test can reach it. */
      setToast(assignmentToast(email, assignedName));
      reloadAll();
    } catch (e) {
      setToast({ tone: "crit", text: e?.message ?? "Could not assign this job" });
    } finally {
      setAssigning(null);
    }
  }

  async function revokeAssignment(itemId) {
    if (assigning) return;
    setAssigning(itemId);
    setToast(null);
    try {
      await assignRepairItem({ orgId, itemId, technicianId: null, reason: "Assignment revoked" });
      setToast({ tone: "ok", text: "Assignment revoked." });
      reloadAll();
    } catch (e) {
      const message = "Could not revoke the assignment. Please try again.";
      setToast({ tone: "crit", text: message });
    } finally {
      setAssigning(null);
    }
  }

  async function respondToJob(itemId, status) {
    if (responding) return;
    setResponding(itemId);
    setToast(null);
    try {
      await respondToRepairAssignment({ orgId, itemId, status });
      setToast({
        tone: status === "accepted" ? "ok" : "warn",
        text: status === "accepted" ? "Triage accepted." : "Triage declined.",
      });
      reloadAll();
    } catch (e) {
      setToast({ tone: "crit", text: e?.message ?? "Could not respond to this assignment" });
    } finally {
      setResponding(null);
    }
  }

  return (
    <section className="sp4-repair-jobs">
      {toast && (
        <div className={`sp4-toast sp4-toast--${toast.tone}`} role="status" aria-live="polite">
          <span className="sp4-toast-text">{toast.text}</span>
          <button type="button" className="sp4-toast-x" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      <TableToolbar summary={summary} loading={loading} onReload={reloadAll} disabled={!shown.length} />

      <div className="sp4-filterbar">
        <div className="sp4-filter-group">
          <span className="sp4-filter-label">State</span>
          {STATES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={"sp4-filter-chip" + (state === id ? " sp4-filter-chip--on" : "")}
              aria-pressed={state === id}
              onClick={() => setState(id)}
            >{label}</button>
          ))}
        </div>
      </div>

      {error && <div className="sp4-banner sp4-banner--crit">{error}</div>}
      {/* A second crit banner stood here, fed by a `err` state that every
          failed write set ALONGSIDE the toast — so one failure was announced
          twice, in two places, in the same words. The toast is the survivor:
          it is dismissable, it does not shove the table down the page, and it
          is already how a SUCCESSFUL write reports itself, so success and
          failure now arrive in the same spot. The banner above stays, because
          it is not a write failing but the LIST failing to load — nothing on
          screen can be trusted then, which is worth the space a banner takes
          and is not something the reader should be able to dismiss. */}

      {!loading && shown.length === 0 && (
        <div className="sp4-empty">
          {state === "open"
            ? "No repair jobs outstanding."
            : state === "unresolved"
              ? "No jobs have been signed off unsuccessfully."
              : "Nothing here for this state."}
        </div>
      )}

      {shown.length > 0 && (
        <div className="sp4-table-scroll">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <thead>
              <tr>
                <th className="sp4-th--left">Unit Reg</th>
                <th className="sp4-th--left">What was wrong</th>
                <th className="sp4-th--left">Outcome</th>
                {/* The outcome is what the technician found on the day and
                    never changes; the stage is where the job is now. Adjacent
                    so the pair reads as the one sentence it is. */}
                <th className="sp4-th--left">Stage</th>
                <th className="sp4-th--left">Spare part</th>
                {/* Beside the part it is waiting on, because the two are one
                    fact: this is on order, and it was wanted by then. */}
                <th className="sp4-th--left">Fix date</th>
                <th className="sp4-th--left">Filed by</th>
                <th className="sp4-th--left">Assigned to</th>
                <th className="sp4-th--right">Filed</th>
                <th className="sp4-th--right">{canResolve ? "Sign off" : "State"}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                /* Was a Fragment wrapping the row and an inline sign-off card
                   below it. The card is a dialog now, so the row is the only
                   child and the fragment has nothing left to hold together. */
                <tr className="sp4-tr sp4-tr--static" key={r.id}>
                    <td className="sp4-td--left">
                      <span className="sp4-reg">{r.vehicle?.registrationPlate ?? "—"}</span>
                    </td>
                    <td className="sp4-td--left">
                      {humanKind(r.faultKind)}
                      {/* Raised past a threshold and still open.
                          Beside the FAULT rather than beside the stage,
                          because the stage is a control here and a badge that
                          sat among three clickable chips would read as a
                          fourth. The level is on the badge: an escalation that
                          has been raised three times and is still open is a
                          different row from one raised this morning. */}
                      {(() => {
                        const esc = escalationOf(r);
                        if (!esc || r.resolvedAt) return null;
                        return (
                          <span
                            className={"sp4-pill sp4-pill--crit rj-esc" + (esc.level >= 2 ? " rj-esc--again" : "")}
                            title={`Escalated ${esc.level} time${esc.level === 1 ? "" : "s"} — ${escalationPhrase(esc)}. The job is still open.`}
                          >
                            Escalated{esc.level > 1 ? ` ×${esc.level}` : ""}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="sp4-td--left">
                      <span className={"sp4-pill sp4-pill--" + (OUTCOME_PILL[r.outcome] ?? "none")}>
                        {OUTCOME_LABEL[r.outcome] ?? r.outcome}
                      </span>
                    </td>
                    <td className="sp4-td--left">
                      {r.resolvedAt || !canResolve
                        ? (
                          <span className={"sp4-pill sp4-pill--" + (STAGE_PILL[r.stage] ?? "none")}>
                            {STAGE_LABEL[r.stage] ?? r.stage ?? "—"}
                          </span>
                        )
                        : (
                          /* Open and resolvable: the stage is a control, not a
                             read-out. Three chips rather than a <select>,
                             because the whole ladder being visible is what
                             tells a technician there IS a stage between
                             "reported" and "being worked on". */
                          <span className="sp4-stage-set">
                            {SETTABLE_STAGES.map((st) => (
                              <button
                                key={st}
                                type="button"
                                className={"sp4-filter-chip" + (r.stage === st ? " sp4-filter-chip--on" : "")}
                                aria-pressed={r.stage === st}
                                disabled={moving === r.id}
                                onClick={() => moveStage(r.id, st)}
                              >{STAGE_LABEL[st]}</button>
                            ))}
                            {r.stage === "failed" && (
                              <span className="sp4-pill sp4-pill--inc">{STAGE_LABEL.failed}</span>
                            )}
                          </span>
                        )}
                    </td>
                    <td className="sp4-td--left">
                      {r.sparePart || <span className="sp4-muted">—</span>}
                    </td>
                    <td className="sp4-td--left">
                      {(() => {
                        const est = estimateState(r);
                        if (est.tone === "none" && est.text === "—") {
                          return <span className="sp4-muted">—</span>;
                        }
                        /* A pill only once it has slipped. An estimate that is
                           still ahead of itself is information, not an alarm,
                           and painting every open job would leave nothing for
                           the overdue ones to stand out against. */
                        return est.overdue
                          ? <span className="sp4-pill sp4-pill--inc">{est.text}</span>
                          : <span className={"sp4-est sp4-est--" + est.tone}>{est.text}</span>;
                      })()}
                    </td>
                    <td className="sp4-td--left">
                      {r.report?.reportedBy?.fullName ?? <span className="sp4-muted">—</span>}
                    </td>
                    <td className="sp4-td--left">
                      <div className="sp4-assignment">
                        <span className="sp4-assignment-current">
                          {r.assignedTo?.fullName ?? "Unassigned"}
                          {r.assignedToId && r.assignmentStatus && r.assignmentStatus !== "accepted" && (
                            <span className={"sp4-pill sp4-pill--" + (r.assignmentStatus === "declined" ? "inc" : "warn")}>
                              {r.assignmentStatus === "declined" ? "Declined" : "Awaiting response"}
                            </span>
                          )}
                        </span>
                        {r.assignedToId === currentUserId && r.assignmentStatus === "pending" && !r.resolvedAt && (
                          <div className="sp4-assignment-actions">
                            <button type="button" className="sp4-ghost-btn" disabled={responding === r.id} onClick={() => respondToJob(r.id, "accepted")}>
                              {responding === r.id ? "Saving…" : "Accept"}
                            </button>
                            <button type="button" className="sp4-ghost-btn sp4-ghost-btn--crit" disabled={responding === r.id} onClick={() => respondToJob(r.id, "declined")}>
                              Decline
                            </button>
                          </div>
                        )}
                        {canAssign && !r.resolvedAt && (
                            <div className="sp4-assignment-actions">
                              <select
                                className="sp4-assignment-select"
                                value={assignment[r.id] ?? r.assignedToId ?? ""}
                                disabled={assigning === r.id || assigneesLoading}
                                aria-label={`Assign ${r.vehicle?.registrationPlate ?? "repair job"}`}
                                onChange={(e) => setAssignment((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              >
                                {/* "Automatic triage (least loaded)" stood here, and sending
                                    no id asked the server to rank every user in the tenant by
                                    open-item count and pick the lowest. On a roster that is
                                    mostly drivers synced from the registry that is a near
                                    guarantee of the wrong person: they hold no open items, so
                                    they sort first. The server no longer accepts a body without
                                    an id. A placeholder that cannot be submitted replaces it —
                                    the select must name somebody. */}
                                <option value="" disabled>Choose a person…</option>
                                {currentUserId && <option value={currentUserId}>Assign to me</option>}
                                {assignees
                                  .filter((u) => u.id !== currentUserId)
                                  .map((u) => {
                                    const role = (u.userRoles ?? [])
                                      .find(({ role: held }) => held && TRIAGE_ROLE_SLUGS.has(held.slug))?.role;
                                    return (
                                      <option key={u.id} value={u.id}>
                                        {u.fullName || u.email || u.id}{role?.name ? ` · ${role.name}` : ""}
                                      </option>
                                    );
                                  })}
                              </select>
                              <button
                                type="button"
                                className="sp4-ghost-btn"
                                disabled={assigning === r.id || !(assignment[r.id] ?? r.assignedToId)}
                                onClick={() => assignJob(r.id, assignment[r.id] || r.assignedToId)}
                              >
                                {assigning === r.id ? "Assigning…" : "Assign person"}
                              </button>
                              {r.assignedToId && (
                                <button
                                  type="button"
                                  className="sp4-ghost-btn sp4-ghost-btn--crit"
                                  disabled={assigning === r.id}
                                  onClick={() => revokeAssignment(r.id)}
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                        )}
                      </div>
                    </td>
                    <td className="sp4-td--right">{when(r.report?.reportedAt)}</td>
                    <td className="sp4-td--right">
                      {r.resolvedAt
                        ? <span className="sp4-pill sp4-pill--con">Resolved</span>
                        : canResolve
                          ? (
                            <button type="button" className="sp4-ghost-btn"
                                    onClick={() => { setSignOff(r); }}>
                              Sign off
                            </button>
                          )
                          : <span className="sp4-pill sp4-pill--warn">Open</span>}
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RepairSignOffDialog
        open={signOff !== null}
        item={signOff}
        orgId={orgId}
        onClose={() => setSignOff(null)}
        onDone={reloadAll}
      />
    </section>
  );
}
