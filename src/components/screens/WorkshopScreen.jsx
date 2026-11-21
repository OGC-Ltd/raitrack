/**
 * Workshop: the Vehicle Support and Repair Workflow, one screen.
 *
 * Opened on `repair:read` alone, not on `sensor:read` like Maintenance, because
 * two of the three Control Room roles (operator, supervisor) hold no sensor
 * grant and they are the people who flag, assess, book and verify.
 *
 *   Jobs           every job on the workflow, filtered by who acts next
 *   My jobs        a technician's own jobs: open, assessment, workshop and
 *                  closed; Open also holds the ControlTech queue's unclaimed
 *                  jobs, to claim (repair:claim)
 *   Workshop day   one day's intake against the 3-a-day cap
 *   Security       investigations opened by suspected malicious damage
 *                  (security_case:read: the Head of Security)
 *   Auto Workshop  FactorySuite's workshop floor and stores (KASULU only);
 *                  its job cards are worked as jobs on the Jobs tab
 *
 * A row opens the job in the shared DetailSidebar (RepairWorkflowJob), the
 * same side panel every other page uses. Built from the Sensor Monitor's parts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../body/SensorPanel.css";
import "./SystemScreen.css";
import "./DriversScreen.css";
import "./WorkshopScreen.css";
import "../body/RepairWorkflow.css";
import { usePermissions, FACTORY_WORKSHOP_ORGS } from "../../hooks/usePermissions";
import { useAuth } from "../../context/AuthContext";
import { REPAIRS_CHANGED, STAGE_LABEL, stageLabelOf, stagePillOf } from "../../api/repairs";
import {
  listWorkflowJobs, listWorkflowJobsSince, fetchQueue, fetchMyJobs, fetchWorkshops, fetchWorkshopDay, fetchInvestigations, fetchSecurityHolders,
  claimJob, updateInvestigation, viewOnly, NEXT_STEP, INVESTIGATION_LABEL, INVESTIGATION_PILL, isoDay,
  takeWorkshopHandoff, WORKSHOP_OPEN, shortCard, TELEMATICS,
} from "../../api/repairWorkflow";
import FactoryWorkshopTab, { StateLine } from "./FactoryWorkshopTab";
import { JobsStrip, ControlTechStrip, MineStrip, DayStrip, SecurityStrip, STAT_DAYS, windowDays, eatDay, dayCounts, dayStay, dayHasRecords } from "./WorkshopStats";
import RepairWorkflowJob, { PhaseLadder, TrailList, jobLabel, at } from "../body/RepairWorkflowJob";
import FlagRepairDialog from "../body/FlagRepairDialog";
import { usePager } from "../body/TablePager";
import { WfFilters, WfGrid, Reload, rowProps, Badge, Ident } from "./WorkshopParts";
import EmptyNote from "../shared/EmptyNote";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { watchTableLabels } from "../../lib/tableLabels";

/** Who acts next, as the Jobs filter groups it. */
const BUCKETS = [
  ["control_room", "Control Room", ["pending", "awaiting_assessment", "booked", "towing", "completed"]],
  ["controltech",  "ControlTech",  ["forwarded", "remote_fix", "spare_outsourced"]],
  ["workshop",     "Workshop",     ["in_workshop", "field_inspection", "fixing"]],
];
/** Each view's title and the line under it, as the Staffs page heads its views. */
const VIEW_HEAD = {
  jobs:     ["Repair jobs", "Every repair job, where it stands and who acts next"],
  controltech: ["ControlTech", "Units flagged with a telematics fault, for ControlTech to fix"],
  mine:     ["My jobs", "Jobs assigned to you, open and closed"],
  day:      ["Workshop day", "Each workshop's bookings, one day at a time"],
  security: ["Security cases", "Suspected malicious damage found in repairs"],
  factory:  ["Auto Workshop", "FactorySuite job cards in the workshop, and the stores"],
};
/** Any one of these opens the Jobs and Workshop Day tabs. */
const BOARD_VERBS = ["repair:flag", "repair:assess", "repair:book", "repair:verify", "repair:work_any"];
const bucketOf = (stage) => BUCKETS.find(([, , list]) => list.includes(stage))?.[0] ?? null;

/** Re-read on mount, on demand, and whenever any repair changes (SSE or a write here). */
function useLive(fetchFn, deps) {
  const [s, setS] = useState({ data: null, loading: true, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useCallback(() => {
    setS((p) => ({ ...p, loading: true }));
    Promise.resolve(fetchFn())
      .then((data) => setS({ data, loading: false, error: null }))
      .catch((e) => setS((p) => ({ ...p, loading: false, error: e?.message || "Could not load" })));
  }, deps);
  useEffect(() => {
    read();
    window.addEventListener(REPAIRS_CHANGED, read);
    return () => window.removeEventListener(REPAIRS_CHANGED, read);
  }, [read]);
  return { ...s, read };
}

const since = (iso) => {
  if (!iso) return "-";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? `${Math.max(0, Math.floor(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

// ── Jobs ────────────────────────────────────────────────────────────────────

/** What the Jobs search reads: reg, ticket, fault, the suspected fault, stage and who is next. */
export function jobText(j) {
  return [
    j.vehicle?.registrationPlate, j.vehicle?.name, j.ticketNo, jobLabel(j), j.suspectedFault, j.problemNote,
    stageLabelOf(j), NEXT_STEP[j.stage]?.who,
    ...(j.fsJobCards ?? []).map((c) => c.cardNumber),
  ].filter(Boolean).join(" ").toLowerCase();
}

function JobsTab({ orgId, can, onOpen, openId, onToast }) {
  const [state, setState] = useState("open");
  const [bucket, setBucket] = useState("all");
  const [flagging, setFlagging] = useState(false);
  const [search, setSearch] = useState("");
  const jobs = useLive(() => listWorkflowJobs(orgId, { status: state === "closed" ? "all" : state }), [orgId, state]);
  // The strip's history: every job raised in the window and a month before it,
  // so a job closed in the window counts though it was flagged earlier.
  // On Closed the strip still counts the open jobs, from the open read: the
  // all-jobs read under Closed is capped and leaves some open ones out.
  const openRead = useLive(() => (state === "open" ? null : listWorkflowJobs(orgId, { status: "open" })), [orgId, state]);
  const openJobs = state === "open" ? jobs : openRead;
  const history = useLive(() => listWorkflowJobsSince(orgId, Date.now() - (STAT_DAYS + 31) * 86_400_000), [orgId]);
  // The search narrows before the counts, so each chip says how many match.
  const q = search.trim().toLowerCase();
  const all = (jobs.data ?? [])
    .filter((j) => (state === "closed" ? !!j.resolvedAt : true))
    .filter((j) => !q || jobText(j).includes(q));
  const counts = Object.fromEntries(BUCKETS.map(([k]) => [k, all.filter((j) => bucketOf(j.stage) === k).length]));
  const rows = bucket === "all" ? all : all.filter((j) => bucketOf(j.stage) === bucket);
  const pager = usePager(rows, `${state}|${bucket}|${q}`);

  return (
    <>
      {/* The same strip on Open and Closed. */}
      <JobsStrip open={(openJobs.data ?? []).filter((j) => !j.resolvedAt)} history={history.data}
                 bucketOf={bucketOf} loading={openJobs.loading && !openJobs.data} />
      <WfFilters
        label="Search jobs" placeholder="Search reg, ticket or fault…" search={search} onSearch={setSearch}
        groups={[
          { label: "Jobs", value: state, onPick: (id) => { setState(id); setBucket("all"); }, options: [["open", "Open"], ["closed", "Closed"]] },
          ...(state === "open" ? [{ label: "Next", value: bucket, onPick: setBucket,
            options: [["all", "Everyone", all.length], ...BUCKETS.filter(([id]) => id !== "control_room").map(([id, label]) => [id, label, counts[id]])] }] : []),
        ]}
        tools={<>
          {can("repair:flag") && (
            <button type="button" className="sp4-submit-btn wf-flag-btn" onClick={() => setFlagging(true)}>
              <i className="ti ti-flag" aria-hidden="true" /> Flag for repair
            </button>
          )}
          <Reload loading={jobs.loading} onReload={jobs.read} />
        </>}
      />

      {rows.length === 0 && jobs.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Jobs">Repair jobs and where each one stands.</EmptyNote>
      ) : rows.length === 0 && jobs.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Jobs Could Not Be Loaded" action={{ label: "Try again", onClick: jobs.read }}>{jobs.error}</EmptyNote>
      ) : rows.length === 0 && q ? (
        <EmptyNote icon="ti-search" title="No Jobs Match" action={{ label: "Clear search", onClick: () => setSearch("") }}>
          Nothing {state === "open" ? "open" : "closed"} matches “{search.trim()}”. The search reads the reg, ticket, fault, stage and who is next.
        </EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title={state === "open" ? "No Open Repairs" : "No Closed Repairs Yet"}
                   action={state === "open" && can("repair:flag") ? { label: "Flag for repair", onClick: () => setFlagging(true) } : null}>
          {state === "open" ? "No unit is waiting on a repair." : "Nothing has been verified, signed off or voided yet."}
        </EmptyNote>
      ) : (
        <WfGrid label="Job pages" pager={pager}
                head={[["Unit reg"], ["Fault"], ["Status"], ["Stage"], ["Ticket"], ["Workshop day"], ["Checked in"], ["Checked out"], ["Next"], ["In stage", true]]}>
              {pager.pageRows.map((j) => {
                const booking = j.bookings?.[0];
                const next = NEXT_STEP[j.stage];
                const open = () => onOpen(j.id);
                return (
                  <tr key={j.id} data-job={j.id} {...rowProps(openId === j.id, open)}>
                    <td><Ident name={j.vehicle?.registrationPlate ?? "-"} sub={j.vehicle?.name !== j.vehicle?.registrationPlate ? j.vehicle?.name : null} /></td>
                    <td>
                      <span className="wf-cell-fault">{jobLabel(j)}</span>
                      {(j.suspectedFault ?? j.problemNote) && <span className="wf-cell-sub">{j.suspectedFault ?? j.problemNote}</span>}
                    </td>
                    <td><Badge tone={stagePillOf(j)}>{stageLabelOf(j)}</Badge></td>
                    <td><PhaseLadder stage={j.stage} compact /></td>
                    <td>
                      <span className="dr-veh">{j.ticketNo ?? "-"}</span>
                      {j.fsJobCards?.length > 0 && shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber) !== j.ticketNo && <span className="wf-cell-sub" title="FactorySuite job card">FactorySuite <span className="dr-veh">{shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber)}</span></span>}
                    </td>
                    <td className="sys-num">{booking ? isoDay(booking.bookingDate) : "-"}</td>
                    <td className="sys-num">{inOut(j).in ? at(inOut(j).in) : <span className="sp4-muted">-</span>}</td>
                    <td className="sys-num">{inOut(j).out ? at(inOut(j).out) : <span className="sp4-muted">-</span>}</td>
                    <td>{j.resolvedAt ? <span className="sp4-muted">Closed</span> : next?.who ?? "-"}</td>
                    <td className="dr-num sys-num">{since(j.stageChangedAt ?? j.createdAt)}</td>
                  </tr>
                );
              })}
        </WfGrid>
      )}

      <FlagRepairDialog
        orgId={orgId}
        open={flagging}
        onClose={() => setFlagging(false)}
        onFlagged={(made, route) => {
          const units = new Set(made.map((j) => j?.vehicleId ?? j?.id)).size;
          onToast({ tone: "ok", text: `${units} unit${units === 1 ? "" : "s"} flagged${route === "controltech" ? " and sent to ControlTech" : route === "workshop" ? " and sent to the workshop" : route === "both" ? " and sent to ControlTech and the workshop" : ""}.` });
          if (made.length === 1 && made[0]?.id) onOpen(made[0].id);
        }}
      />
    </>
  );
}

/**
 * When the unit checked into the workshop and out of it, from its FactorySuite
 * card(s): the first card's check-in, and the latest card's release once it has
 * one, a dash until then. A job with no card has neither.
 */
const inOut = (j) => {
  const cards = j.fsJobCards ?? [];
  const last = cards[cards.length - 1];
  return { in: cards[0]?.checkedInAt ?? null, out: last?.releasedAt ?? null };
};

// ── My jobs ─────────────────────────────────────────────────────────────────

/** Stages a job reaches only by going physical: assessment, booking, the workshop. */
const WORKSHOP_STAGES = ["booked", "towing", "field_inspection", "in_workshop"];
/** Where one of my jobs stands: open with me, waiting on its assessment, sent on to the workshop, or closed. */
export const mineGroup = (j) => (j.resolvedAt ? "closed"
  : j.stage === "awaiting_assessment" ? "assessment"
  : j.path === "physical" || j.queue === "workshop" || WORKSHOP_STAGES.includes(j.stage) ? "workshop" : "open");
const MINE_GROUPS = [["open", "Open"], ["assessment", "Assessment"], ["workshop", "Workshop"], ["closed", "Closed"]];
const MINE_EMPTY = {
  open: ["No Open Jobs", "Nothing is waiting to be claimed, and no open job is assigned to you."],
  assessment: ["None Awaiting Assessment", "None of your jobs is waiting on the Control Room to assess the unit."],
  workshop: ["None in the Workshop", "None of your jobs has gone on to the workshop."],
  closed: ["None Closed Yet", "None of your jobs has closed yet."],
};

/**
 * A technician's own jobs (operator, 2026-10-27): what is assigned to them,
 * what went on to the workshop after they had it, and what has closed. Open
 * also carries the ControlTech queue's unclaimed jobs, each with its Claim
 * button: the queue is no longer a tab of its own (operator, 2026-10-27).
 * Jobs another technician has claimed are theirs, not shown here.
 */
export function MyJobsTab({ orgId, userId, onOpen, openId, onToast, canClaim = true }) {
  const jobs = useLive(() => Promise.all([fetchMyJobs(orgId), fetchQueue(orgId)]).then(([mine, queue]) => {
    const own = new Set(mine.map((j) => j.id));
    return [...queue.filter((r) => !r.assignedToId && !own.has(r.id)).map((r) => ({ ...r, fromQueue: true })), ...mine];
  }), [orgId]);
  const [busy, setBusy] = useState(null);
  const claim = async (r) => {
    setBusy(r.id);
    try {
      await claimJob(orgId, r.id);
      onToast({ tone: "ok", text: `${r.vehicle?.registrationPlate ?? "The job"} is yours.` });
      onOpen(r.id);
    } catch (e) {
      onToast({ tone: "crit", text: e?.message || "Could not claim the job." });
    } finally {
      setBusy(null);
    }
  };
  const [group, setGroup] = useState("open");
  const [search, setSearch] = useState("");
  // The search narrows before the counts, so each chip says how many match.
  const q = search.trim().toLowerCase();
  const all = (jobs.data ?? []).filter((j) => !q || jobText(j).includes(q));
  const counts = Object.fromEntries(MINE_GROUPS.map(([k]) => [k, all.filter((j) => mineGroup(j) === k).length]));
  const rows = all.filter((j) => mineGroup(j) === group);
  const pager = usePager(rows, `${group}|${q}`);

  return (
    <>
      <MineStrip rows={jobs.data ?? []} groupOf={mineGroup} loading={jobs.loading && !jobs.data} />
      <WfFilters
        label="Search my jobs" placeholder="Search reg, ticket or fault…" search={search} onSearch={setSearch}
        groups={[{ label: "Jobs", value: group, onPick: setGroup, options: MINE_GROUPS.map(([id, text]) => [id, text, counts[id]]) }]}
        tools={<Reload loading={jobs.loading} onReload={jobs.read} />}
      />
      {rows.length === 0 && jobs.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Your Jobs">Jobs assigned to you, open and closed.</EmptyNote>
      ) : rows.length === 0 && jobs.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="Your Jobs Could Not Be Loaded" action={{ label: "Try again", onClick: jobs.read }}>{jobs.error}</EmptyNote>
      ) : rows.length === 0 && q ? (
        <EmptyNote icon="ti-search" title="No Jobs Match" action={{ label: "Clear search", onClick: () => setSearch("") }}>
          None of your jobs here matches “{search.trim()}”. The search reads the reg, ticket, fault and stage.
        </EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title={MINE_EMPTY[group][0]}>{MINE_EMPTY[group][1]}</EmptyNote>
      ) : (
        <WfGrid label="Job pages" pager={pager}
                head={[["Unit reg"], ["Fault"], ["Status"], ["Stage"], ["Ticket"], [group === "workshop" ? "Workshop" : "Your part"], [group === "closed" ? "Closed" : "In stage", true]]}>
              {pager.pageRows.map((j) => {
                const booking = j.bookings?.[0];
                const open = () => onOpen(j.id);
                const where = [booking?.workshop?.name, booking ? isoDay(booking.bookingDate) : null,
                  j.workshopTechnician?.fullName ?? j.workshopTechnicianName].filter(Boolean).join(" · ");
                return (
                  <tr key={j.id} data-job={j.id} {...rowProps(openId === j.id, open)}>
                    <td><Ident name={j.vehicle?.registrationPlate ?? "-"} sub={j.vehicle?.name !== j.vehicle?.registrationPlate ? j.vehicle?.name : null} /></td>
                    <td>
                      <span className="wf-cell-fault">{jobLabel(j)}</span>
                      {(j.suspectedFault ?? j.problemNote) && <span className="wf-cell-sub">{j.suspectedFault ?? j.problemNote}</span>}
                    </td>
                    <td><Badge tone={stagePillOf(j)}>{stageLabelOf(j)}</Badge></td>
                    <td><PhaseLadder stage={j.stage} compact /></td>
                    <td>
                      <span className="dr-veh">{j.ticketNo ?? "-"}</span>
                      {j.fsJobCards?.length > 0 && shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber) !== j.ticketNo && <span className="wf-cell-sub" title="FactorySuite job card">FactorySuite <span className="dr-veh">{shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber)}</span></span>}
                    </td>
                    <td>
                      {group === "workshop" ? (where || <span className="sp4-muted">Not booked yet</span>)
                        : !j.assignedToId && !j.workshopTechnicianId ? (!canClaim ? <span className="sp4-muted">Unclaimed</span> : (
                          <button type="button" className="sp4-submit-btn wf-row-btn" disabled={busy === j.id}
                                  onClick={(e) => { e.stopPropagation(); claim(j); }}>{busy === j.id ? "Claiming…" : "Claim"}</button>
                        )) : j.workshopTechnicianId === userId ? "Workshop technician" : "Assigned to you"}
                    </td>
                    <td className="dr-num sys-num">{j.resolvedAt ? at(j.resolvedAt) : since(j.stageChangedAt ?? j.forwardedAt ?? j.createdAt)}</td>
                  </tr>
                );
              })}
        </WfGrid>
      )}
    </>
  );
}

// ── ControlTech ─────────────────────────────────────────────────────────────

/** Where an open ControlTech job stands: not forwarded yet, waiting to be claimed, or with a technician. */
export const ctGroup = (j) => (j.stage === "pending" ? "held" : !j.assignedToId ? "waiting" : "working");
const CT_GROUPS = [["waiting", "Waiting"], ["working", "With a technician"], ["held", "Not forwarded"]];
/**
 * A job of ControlTech's. Open: on its queue, or a telematics flag the Control
 * Room has not forwarded yet. Closed: it was on the queue, or was a telematics
 * fault, wherever it ended.
 */
export const isControlTech = (j) => (j.resolvedAt
  ? j.queue === "controltech" || TELEMATICS.has(j.faultCategory)
  : j.queue === "controltech" || (j.stage === "pending" && TELEMATICS.has(j.faultCategory)));

/**
 * ControlTech's page (operator, 2026-11-21: "when a unit or units are flagged
 * for repair they will be displayed on the control tech page in workshop"),
 * laid out as the Jobs tab (operator, same day: "design the controltech page
 * to match that of jobs"): the same strip, Open and Closed, the same columns,
 * with Flagged and Technician where Jobs has the workshop's day and times,
 * which a remote fix never has. Oldest first, as the queue is worked;
 * unclaimed jobs carry the Claim button for whoever may claim.
 */
function ControlTechTab({ orgId, can, onOpen, openId, onToast, canClaim }) {
  const [state, setState] = useState("open");
  const [group, setGroup] = useState("all");
  const [flagging, setFlagging] = useState(false);
  const [search, setSearch] = useState("");
  const jobs = useLive(() => listWorkflowJobs(orgId, { status: state === "closed" ? "all" : "open" }).then((r) => r.filter(isControlTech)), [orgId, state]);
  const openRead = useLive(() => (state === "open" ? null : listWorkflowJobs(orgId, { status: "open" }).then((r) => r.filter(isControlTech))), [orgId, state]);
  const openJobs = state === "open" ? jobs : openRead;
  const history = useLive(() => listWorkflowJobsSince(orgId, Date.now() - (STAT_DAYS + 31) * 86_400_000).then((r) => r.filter(isControlTech)), [orgId]);
  const [busy, setBusy] = useState(null);
  const claim = async (r) => {
    setBusy(r.id);
    try {
      await claimJob(orgId, r.id);
      onToast({ tone: "ok", text: `${r.vehicle?.registrationPlate ?? "The job"} is yours.` });
      onOpen(r.id);
    } catch (e) {
      onToast({ tone: "crit", text: e?.message || "Could not claim the job." });
    } finally {
      setBusy(null);
    }
  };
  const q = search.trim().toLowerCase();
  const all = (jobs.data ?? [])
    .filter((j) => (state === "closed" ? !!j.resolvedAt : true))
    .filter((j) => !q || jobText(j).includes(q))
    .sort((a, b) => (state === "closed"
      ? new Date(b.resolvedAt) - new Date(a.resolvedAt)
      : new Date(a.forwardedAt ?? a.createdAt) - new Date(b.forwardedAt ?? b.createdAt)));
  const counts = Object.fromEntries(CT_GROUPS.map(([k]) => [k, all.filter((j) => ctGroup(j) === k).length]));
  const rows = state === "closed" || group === "all" ? all : all.filter((j) => ctGroup(j) === group);
  const pager = usePager(rows, `${state}|${group}|${q}`);

  return (
    <>
      <ControlTechStrip open={(openJobs.data ?? []).filter((j) => !j.resolvedAt)} history={history.data}
                        groupOf={ctGroup} loading={openJobs.loading && !openJobs.data} />
      <WfFilters
        label="Search ControlTech jobs" placeholder="Search reg, ticket or fault…" search={search} onSearch={setSearch}
        groups={[
          { label: "Jobs", value: state, onPick: (id) => { setState(id); setGroup("all"); }, options: [["open", "Open"], ["closed", "Closed"]] },
          ...(state === "open" ? [{ label: "Stands", value: group, onPick: setGroup,
            options: [["all", "Everyone", all.length], ...CT_GROUPS.map(([id, label]) => [id, label, counts[id]])] }] : []),
        ]}
        tools={<>
          {can("repair:flag") && (
            <button type="button" className="sp4-submit-btn wf-flag-btn" onClick={() => setFlagging(true)}>
              <i className="ti ti-flag" aria-hidden="true" /> Flag for repair
            </button>
          )}
          <Reload loading={jobs.loading} onReload={jobs.read} />
        </>}
      />

      {rows.length === 0 && jobs.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the ControlTech Jobs">Units flagged with a telematics fault.</EmptyNote>
      ) : rows.length === 0 && jobs.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="ControlTech Jobs Could Not Be Loaded" action={{ label: "Try again", onClick: jobs.read }}>{jobs.error}</EmptyNote>
      ) : rows.length === 0 && q ? (
        <EmptyNote icon="ti-search" title="No Jobs Match" action={{ label: "Clear search", onClick: () => setSearch("") }}>
          Nothing {state === "open" ? "open" : "closed"} matches “{search.trim()}”. The search reads the reg, ticket, fault, stage and who is next.
        </EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title={state === "open" ? "Nothing With ControlTech" : "No Closed ControlTech Jobs Yet"}
                   action={state === "open" && can("repair:flag") ? { label: "Flag for repair", onClick: () => setFlagging(true) } : null}>
          {state === "open"
            ? "No unit is flagged with a telematics fault. A flag for a fuel probe, tracker, GPS, ignition or sensor lands here."
            : "No telematics job has been verified, signed off or voided yet."}
        </EmptyNote>
      ) : (
        <WfGrid label="ControlTech job pages" pager={pager}
                head={[["Unit reg"], ["Fault"], ["Status"], ["Stage"], ["Ticket"], ["Flagged"], ["Technician"], ["Next"], [state === "closed" ? "Closed" : "In stage", true]]}>
              {pager.pageRows.map((j) => {
                const next = NEXT_STEP[j.stage];
                const open = () => onOpen(j.id);
                const by = j.report?.reportedBy?.fullName;
                return (
                  <tr key={j.id} data-job={j.id} {...rowProps(openId === j.id, open)}>
                    <td><Ident name={j.vehicle?.registrationPlate ?? "-"} sub={j.vehicle?.name !== j.vehicle?.registrationPlate ? j.vehicle?.name : null} /></td>
                    <td>
                      <span className="wf-cell-fault">{jobLabel(j)}</span>
                      {(j.suspectedFault ?? j.problemNote) && <span className="wf-cell-sub">{j.suspectedFault ?? j.problemNote}</span>}
                    </td>
                    <td><Badge tone={stagePillOf(j)}>{stageLabelOf(j)}</Badge></td>
                    <td><PhaseLadder stage={j.stage} compact /></td>
                    <td>
                      <span className="dr-veh">{j.ticketNo ?? "-"}</span>
                      {j.fsJobCards?.length > 0 && shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber) !== j.ticketNo && <span className="wf-cell-sub" title="FactorySuite job card">FactorySuite <span className="dr-veh">{shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber)}</span></span>}
                    </td>
                    <td className="sys-num">
                      {at(j.report?.reportedAt ?? j.createdAt)}
                      {by && <span className="wf-cell-sub">{by}</span>}
                    </td>
                    <td>
                      {j.assignedTo?.fullName ?? (j.resolvedAt || !canClaim ? <span className="sp4-muted">Unclaimed</span> : (
                        <button type="button" className="sp4-submit-btn wf-row-btn" disabled={busy === j.id}
                                onClick={(e) => { e.stopPropagation(); claim(j); }}>{busy === j.id ? "Claiming…" : "Claim"}</button>
                      ))}
                    </td>
                    <td>{j.resolvedAt ? <span className="sp4-muted">Closed</span> : next?.who ?? "-"}</td>
                    <td className="dr-num sys-num">{j.resolvedAt ? at(j.resolvedAt) : since(j.stageChangedAt ?? j.forwardedAt ?? j.createdAt)}</td>
                  </tr>
                );
              })}
        </WfGrid>
      )}

      <FlagRepairDialog
        orgId={orgId}
        open={flagging}
        onClose={() => setFlagging(false)}
        presetCategories={["fuel_probe"]}
        onFlagged={(made, route) => {
          const units = new Set(made.map((j) => j?.vehicleId ?? j?.id)).size;
          onToast({ tone: "ok", text: `${units} unit${units === 1 ? "" : "s"} flagged${route === "controltech" ? " and sent to ControlTech" : route === "workshop" ? " and sent to the workshop" : route === "both" ? " and sent to ControlTech and the workshop" : ""}.` });
          if (made.length === 1 && made[0]?.id) onOpen(made[0].id);
        }}
      />
    </>
  );
}

// ── Workshop day board ──────────────────────────────────────────────────────

const dayShift = (date, n) => isoDay(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000);

/** Workshop days, cached per workshop and date so stepping back and forth is
 *  instant. Each answer lands under its own key, so a slow reply for a day the
 *  user already left can never paint over the day on screen. Once a day is in,
 *  the day either side is read ahead. A repair change re-reads the day on
 *  screen in place (old rows stay until the new ones arrive) and drops the rest. */
function useWorkshopDay(orgId, wid, date) {
  const cache = useRef(new Map());
  const pending = useRef(new Map());
  const [, repaint] = useState(0);
  const key = wid ? `${orgId}|${wid}|${date}` : null;

  const load = useCallback((k, force = false) => {
    if (!k || pending.current.has(k) || (!force && cache.current.has(k))) return pending.current.get(k) ?? Promise.resolve();
    const [o, w, d] = k.split("|");
    const p = Promise.resolve(fetchWorkshopDay(o, w, d))
      .then((data) => cache.current.set(k, { data, error: null }))
      .catch((e) => { if (!cache.current.get(k)?.data) cache.current.set(k, { data: null, error: e?.message || "Could not load" }); })
      .finally(() => { pending.current.delete(k); repaint((n) => n + 1); });
    pending.current.set(k, p);
    return p;
  }, []);

  useEffect(() => {
    if (!key) return;
    load(key).then(() => {
      load(`${orgId}|${wid}|${dayShift(date, 1)}`);
      load(`${orgId}|${wid}|${dayShift(date, -1)}`);
    });
  }, [key, load, orgId, wid, date]);

  useEffect(() => {
    const changed = () => {
      for (const k of cache.current.keys()) if (k !== key) cache.current.delete(k);
      load(key, true);
    };
    window.addEventListener(REPAIRS_CHANGED, changed);
    return () => window.removeEventListener(REPAIRS_CHANGED, changed);
  }, [key, load]);

  const hit = key ? cache.current.get(key) : null;
  return {
    data: hit?.data ?? null,
    error: hit?.error ?? null,
    loading: !!key && !hit,
    retry: () => { cache.current.delete(key); repaint((n) => n + 1); load(key); },
  };
}

/** The day's shape while it loads: three rows, so the page
 *  holds its height and nothing jumps when the bookings arrive. */
function DaySkeleton() {
  return (
    <div aria-busy="true" aria-label="Reading the day">
      <ol className="wf-board wf-board--skel" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="wf-board__row">
            <span className="sp4-skel-cell" />
            <span className="sp4-skel-cell" />
            <span className="sp4-skel-cell" />
            <span className="sp4-skel-cell" />
            <span className="sp4-skel-cell wf-skel--pill" />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The strip's window: the {STAT_DAYS} days up to the day on screen, for one
 *  workshop. A past day does not change, so it is read once and kept; today
 *  and later are read again whenever a repair changes. */
const pastDays = new Map();
function useDayWindow(orgId, wid, date) {
  const days = useMemo(() => windowDays(date), [date]);
  const [got, setGot] = useState({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener(REPAIRS_CHANGED, again);
    return () => window.removeEventListener(REPAIRS_CHANGED, again);
  }, []);
  useEffect(() => {
    if (!wid) return undefined;
    let live = true;
    const today = eatDay(Date.now());
    days.forEach((d) => {
      const key = `${orgId}|${wid}|${d}`;
      if (d < today && pastDays.has(key)) { setGot((g) => (g[key] ? g : { ...g, [key]: pastDays.get(key) })); return; }
      fetchWorkshopDay(orgId, wid, d).then((data) => {
        if (d < today) pastDays.set(key, data);
        if (live) setGot((g) => ({ ...g, [key]: data }));
      }).catch(() => {});
    });
    return () => { live = false; };
  }, [orgId, wid, days, tick]);
  return days.map((d) => ({ day: d, data: wid ? got[`${orgId}|${wid}|${d}`] ?? null : null }));
}

function DayTab({ orgId, onOpen }) {
  const [workshops, setWorkshops] = useState(null);
  const [wid, setWid] = useState(null);
  const [date, setDate] = useState(() => isoDay(Date.now()));
  useEffect(() => {
    fetchWorkshops(orgId).then((w) => { setWorkshops(w); setWid(w[0]?.id ?? null); }).catch(() => setWorkshops([]));
  }, [orgId]);
  const day = useWorkshopDay(orgId, wid, date);
  const week = useDayWindow(orgId, wid, date);
  // The board opens on the last day with records in the strip's window, not
  // on an empty today; once someone moves the day it is theirs.
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current || !week.length || !week.every((w) => w.data)) return;
    moved.current = true;
    const last = [...week].reverse().find((w) => dayHasRecords(w.data));
    if (last && last.day !== date) setDate(last.day);
  }, [week, date]);
  const pick = (next) => { moved.current = true; setDate(next); };
  const shift = (n) => pick(dayShift(date, n));
  const d = day.data;
  const live = (d?.bookings ?? []).filter((b) => b.status === "booked" || b.status === "arrived");
  const other = (d?.bookings ?? []).filter((b) => b.status === "no_show");
  const today = isoDay(Date.now());
  const dayWords = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
  // One row a unit on the day: booked first, then FactorySuite check-ins (the
  // card is their booking), then true walk-ins, then the no-shows.
  const dayRows = [
    ...live.map((b) => ({ key: b.id, job: b.repairItem, booking: b, kind: b.status === "arrived" ? "arrived" : "booked" })),
    ...(d?.unbookedArrivals ?? []).map((j) => ({ key: j.id, job: j, kind: j.fsJobCards?.length ? "factorysuite" : "unbooked" })),
    ...other.map((b) => ({ key: b.id, job: b.repairItem, booking: b, kind: "no_show" })),
  ];
  const [show, setShow] = useState("all");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const found = dayRows.filter((r) => !q || [r.job?.vehicle?.registrationPlate, r.job?.vehicle?.name, r.job?.ticketNo, jobLabel(r.job),
    r.job?.workshopTechnician?.fullName ?? r.job?.workshopTechnicianName].filter(Boolean).join(" ").toLowerCase().includes(q));
  const nKind = (k) => found.filter((r) => k === "all" || r.kind === k).length;
  const rows = found.filter((r) => show === "all" || r.kind === show);
  const dayPager = usePager(rows, `${wid}|${date}|${show}|${q}`);
  const counted = dayCounts(d);
  const nUnbooked = dayRows.filter((r) => r.kind === "unbooked").length;

  return (
    <div className="fsw-tab">
      <DayStrip current={day.data} week={week} date={date} loading={workshops === null || (day.loading && !day.data)} />

      <WfFilters
        label="Search the day" placeholder="Search reg, ticket, fault or technician…" search={search} onSearch={setSearch}
        groups={[{ label: "Show", value: show, onPick: setShow,
          options: [["all", "All", nKind("all")], ...DAY_KINDS.map(([k, text]) => [k, text, nKind(k)])] }]}
        tools={<>
          <span className="dr-seg wf-day-step" role="group" aria-label="Day">
            <button type="button" className="dr-chip" onClick={() => shift(-1)} aria-label="Previous day"><i className="ti ti-chevron-left" aria-hidden="true" /></button>
            <button type="button" className={`dr-chip${date === today ? " dr-chip--active" : ""}`} onClick={() => pick(today)}
                    title={date === today ? "Today" : "Back to today"} aria-pressed={date === today}>{date === today ? "Today" : dayWords}</button>
            <button type="button" className="dr-chip" onClick={() => shift(1)} aria-label="Next day"><i className="ti ti-chevron-right" aria-hidden="true" /></button>
          </span>
          {(workshops?.length ?? 0) > 1 && (
            <select className="sp4-input wf-ws-pick" value={wid ?? ""} onChange={(e) => { moved.current = true; setWid(e.target.value); }} aria-label="Workshop">
              {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <Reload loading={day.loading} onReload={day.retry} />
        </>}
      />
      {d && (
        <p className="wf-count">
          <b>{counted.booked}</b> booked into {d.workshop?.name ?? "the workshop"} on {dayWords}, <b>{counted.checkedOut}</b> checked out the same day
          {nUnbooked ? <>, <b>{nUnbooked}</b> arrived without a booking</> : null}
          {other.length ? <>, <b>{other.length}</b> {other.length === 1 ? "no-show" : "no-shows"}</> : null}
        </p>
      )}

      {workshops === null || day.loading ? (
        <DaySkeleton />
      ) : workshops.length === 0 ? (
        <EmptyNote icon="ti-building-warehouse" title="No Workshop Yet">This organisation has no workshop set up, so there is no day board.</EmptyNote>
      ) : day.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Day Could Not Be Loaded" action={{ label: "Try again", onClick: day.retry }}>{day.error}</EmptyNote>
      ) : dayRows.length === 0 ? (
        <EmptyNote icon="ti-calendar" title="Nothing Booked">No unit is booked into the workshop on this day.</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-search" title="No Units Match" action={{ label: "Clear the filters", onClick: () => { setSearch(""); setShow("all"); } }}>
          Nothing on this day matches the search and filters picked.
        </EmptyNote>
      ) : (
        <WfGrid label="Day pages" pager={dayPager}
                head={[["Unit reg"], ["Fault"], ["Ticket"], ["Technician"], ["Arrived"], ["Left"], ["Status"]]}>
          {dayPager.pageRows.map((r) => <BoardRow key={r.key} job={r.job} booking={r.booking} day={date} onOpen={onOpen} kind={r.kind} />)}
        </WfGrid>
      )}
    </div>
  );
}

/** A unit's place on the day, as the Show filter names it, and its line's tone (the Auto Workshop board's). */
const DAY_KINDS = [
  ["booked", "Booked", "waiting"],
  ["arrived", "Arrived", "repair"],
  ["factorysuite", "Checked in", "repair"],
  ["unbooked", "Arrived, unbooked", "parts"],
  ["no_show", "No show", "late"],
];

function BoardRow({ job, booking, day, onOpen, kind }) {
  const tech = job.workshopTechnician?.fullName ?? job.workshopTechnicianName;
  const stay = kind === "no_show" ? { in: null, out: null } : dayStay(job, booking, day);
  const [, text, tone] = DAY_KINDS.find(([k]) => k === kind) ?? [kind, kind, "waiting"];
  return (
    <tr {...rowProps(false, () => onOpen(job.id))}>
      <td><Ident name={job.vehicle?.registrationPlate ?? "-"} sub={job.vehicle?.name !== job.vehicle?.registrationPlate ? job.vehicle?.name : null} /></td>
      <td><span className="wf-cell-fault">{jobLabel(job)}</span></td>
      <td><span className="dr-veh">{job.ticketNo ?? "No ticket yet"}</span></td>
      <td>{tech ?? <span className="sp4-muted">No technician</span>}</td>
      <td className="sys-num">{stay.in ? at(stay.in) : <span className="sp4-muted">-</span>}</td>
      <td className="sys-num">{stay.out ? at(stay.out) : <span className="sp4-muted">-</span>}</td>
      <td><StateLine tone={tone}>{text}</StateLine></td>
    </tr>
  );
}

// ── Security cases ──────────────────────────────────────────────────────────

function SecurityTab({ orgId, openCase, setOpenCase }) {
  const [state, setState] = useState("open");
  const list = useLive(() => fetchInvestigations(orgId, state), [orgId, state]);
  const rows = list.data ?? [];
  const pager = usePager(rows, state);
  // The strip counts every case, whichever state the table shows.
  const everything = useLive(() => fetchInvestigations(orgId, "all"), [orgId]);
  return (
    <>
      <SecurityStrip cases={everything.data} />
      <WfFilters
        groups={[{ label: "State", value: state, onPick: setState, options: [["open", "Open"], ["closed", "Closed"], ["all", "All"]] }]}
        tools={<Reload loading={list.loading} onReload={list.read} />}
      />
      {rows.length === 0 && list.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Investigations">Suspected malicious damage found in repairs.</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-shield-check" title={state === "open" ? "No Open Investigations" : "No Investigations"}>
          An investigation opens when a technician classes damage as suspected malicious.
        </EmptyNote>
      ) : (
        <WfGrid label="Investigation pages" pager={pager}
                head={[["Unit reg"], ["Ticket"], ["Damage"], ["Warranty"], ["State"], ["Held by"], ["Opened", true]]}>
              {pager.pageRows.map((c) => (
                <tr key={c.id} {...rowProps(openCase?.id === c.id, () => setOpenCase(c))}>
                  <td><Ident name={c.vehicle?.registrationPlate ?? "-"} /></td>
                  <td><span className="dr-veh">{c.repairItem?.ticketNo ?? "-"}</span></td>
                  <td className="wf-cell-wrap">{c.repairItem?.damageNote ?? "-"}</td>
                  <td>{c.repairItem?.warrantyVoid ? "Void" : "Stands"}</td>
                  <td><Badge tone={INVESTIGATION_PILL[c.status]}>{INVESTIGATION_LABEL[c.status] ?? c.status}</Badge></td>
                  <td>{c.assignedTo?.fullName ?? <span className="sp4-muted">Nobody yet</span>}</td>
                  <td className="dr-num sys-num">{at(c.openedAt)}</td>
                </tr>
              ))}
        </WfGrid>
      )}
    </>
  );
}

function CaseDetail({ orgId, c, canUpdate, onToast, onSaved }) {
  const [status, setStatus] = useState(c.status);
  const [findings, setFindings] = useState(c.findings ?? "");
  const [holder, setHolder] = useState(c.assignedToId ?? "");
  const [note, setNote] = useState("");
  const [holders, setHolders] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchSecurityHolders(orgId).then(setHolders).catch(() => setHolders([])); }, [orgId]);
  const changed = status !== c.status || findings !== (c.findings ?? "") || holder !== (c.assignedToId ?? "") || note.trim();
  const save = async () => {
    setBusy(true);
    try {
      const saved = await updateInvestigation(orgId, c.id, {
        status: status !== c.status ? status : undefined,
        findings: findings !== (c.findings ?? "") ? findings : undefined,
        assignedToId: holder !== (c.assignedToId ?? "") ? (holder || null) : undefined,
        note,
      });
      setNote("");
      onToast({ tone: "ok", text: "Investigation updated." });
      onSaved(saved);
    } catch (e) {
      onToast({ tone: "crit", text: e?.message || "Could not update the investigation." });
    } finally {
      setBusy(false);
    }
  };
  const history = Array.isArray(c.history) ? [...c.history].reverse() : [];
  return (
    <>
      <DetailSidebarIdent kind={<span className={`sp4-pill sp4-pill--${INVESTIGATION_PILL[c.status] ?? "none"}`}>{INVESTIGATION_LABEL[c.status]}</span>}
                          name={c.vehicle?.registrationPlate} sub={c.repairItem?.ticketNo ?? "No ticket"} />
      <DetailSidebarFacts facts={[
        { label: "Damage", value: c.repairItem?.damageNote ?? "-" },
        { label: "Diagnosis", value: c.repairItem?.diagnosis ?? "-" },
        { label: "Warranty", value: c.repairItem?.warrantyVoid ? `Void · ${c.repairItem.warrantyVoidNote ?? ""}` : "Stands" },
        { label: "Repair", value: STAGE_LABEL[c.repairItem?.stage] ?? c.repairItem?.stage ?? "-" },
        { label: "Opened", value: at(c.openedAt) },
      ]} />
      <p className="wf-muted wf-pad">The repair goes ahead whatever this investigation finds.</p>
      {canUpdate && (
        <DetailSidebarSection title="Update">
          <div className="wf-form">
            <div className="wf-field">
              <span className="sp4-label">State</span>
              <div className="wf-seg wf-seg--wrap" role="radiogroup" aria-label="State">
                {Object.entries(INVESTIGATION_LABEL).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={status === id}
                          className={"wf-seg__opt" + (status === id ? " wf-seg__opt--on" : "")} onClick={() => setStatus(id)}>{label}</button>
                ))}
              </div>
            </div>
            <label className="sp4-field wf-field">
              <span className="sp4-label">Held by</span>
              <select className="sp4-input" value={holder} onChange={(e) => setHolder(e.target.value)}>
                <option value="">Nobody yet</option>
                {holders.map((h) => <option key={h.id} value={h.id}>{h.fullName ?? h.email}</option>)}
              </select>
            </label>
            <label className="sp4-field wf-field">
              <span className="sp4-label">Findings</span>
              <textarea className="sp4-textarea" rows={5} maxLength={8000} value={findings} onChange={(e) => setFindings(e.target.value)} />
            </label>
            <label className="sp4-field wf-field">
              <span className="sp4-label">Note for the trail</span>
              <input className="sp4-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="wf-actions">
              <button type="button" className="sp4-submit-btn" disabled={!changed || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </DetailSidebarSection>
      )}
      {history.length > 0 && (
        <DetailSidebarSection title="Trail">
          <TrailList items={history.map((h) => ({ at: h.at, label: INVESTIGATION_LABEL[h.status] ?? h.status, note: h.note ?? "", by: h.byName ?? "" }))} />
        </DetailSidebarSection>
      )}
    </>
  );
}

// ── The screen ──────────────────────────────────────────────────────────────

export default function WorkshopScreen() {
  const { orgId, orgCode, can } = usePermissions();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [toast, setToast] = useState(null);
  const [openId, setOpenId] = useState(() => takeWorkshopHandoff());
  const [openCase, setOpenCase] = useState(null);

  // Jobs and Workshop Day are the Control Room's and the workshop's boards:
  // drawn for whoever holds one of their verbs. A technician holds none, and
  // sees only My jobs, which holds the ControlTech queue's unclaimed jobs too
  // (operator, 2026-10-26 and 2026-10-27).
  const board = can("repair:read") && can(BOARD_VERBS);
  // Tabs follow the person's own verbs; everything inside them is view-only.
  const look = useMemo(() => viewOnly(can), [can]);
  const tabs = useMemo(() => [
    // Auto Workshop leads where the org has it (operator, 2026-11-21).
    { key: "factory",  label: "Auto Workshop", allow: can("repair:read") && FACTORY_WORKSHOP_ORGS.includes(orgCode) },
    { key: "jobs",     label: "Jobs",          allow: board },
    // Flagged units for ControlTech to see (operator, 2026-11-21).
    { key: "controltech", label: "ControlTech", allow: board || can("repair:claim") },
    { key: "mine",     label: "My jobs",       allow: can("repair:claim") },
    { key: "day",      label: "Workshop Day",  allow: board },
    { key: "security", label: "Security Cases", allow: can("security_case:read") },
  ].filter((t) => t.allow), [can, board, orgCode]);
  // No pick yet: the first view this role can open, Auto Workshop where there is one.
  const [tab, setTab] = useState(null);
  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  // "Open in Workshop" from Maintenance or Fuel Audit while this screen is mounted.
  useEffect(() => {
    const onOpen = (e) => { takeWorkshopHandoff(); setTab("jobs"); setOpenCase(null); setOpenId(e.detail); };
    window.addEventListener(WORKSHOP_OPEN, onOpen);
    return () => window.removeEventListener(WORKSHOP_OPEN, onOpen);
  }, []);

  const rootRef = useRef(null);
  useEffect(() => watchTableLabels(rootRef.current), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.tone === "crit" ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  if (tabs.length === 0) {
    return (
      <div className="sp4-root sys-root wf-root">
        <EmptyNote icon="ti-lock" tone="warn" title="Workshop Is Not Open to Your Role">
          Ask an administrator for access if you flag, book or repair units.
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="sp4-root sys-root wf-root" ref={rootRef}>
      {toast && (
        <div className={`sp4-toast sp4-toast--${toast.tone}`} role="status" aria-live="polite">
          <span className="sp4-toast-text">{toast.text}</span>
          <button type="button" className="sp4-toast-x" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      {/* The Staffs page's frame: the view's title and what it holds, the
          view switch at the head's right edge, then the view. */}
      <div className="drivers-page wf-page">
        <div className="drivers-page__inner">
          <div className="dr-head">
            <div>
              <h1 className="dr-title">{VIEW_HEAD[active][0]}</h1>
              <div className="dr-subtitle">{VIEW_HEAD[active][1]}</div>
            </div>
            <div className="dr-viewswitch" role="tablist" aria-label="Workshop view">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
                        className={`dr-viewswitch__btn${active === t.key ? " is-on" : ""}`}
                        onClick={() => { setTab(t.key); setOpenId(null); setOpenCase(null); }}>{t.label}</button>
              ))}
            </div>
          </div>

          <div className="dr-layout wf-layout">
            {active === "jobs" && <JobsTab orgId={orgId} can={look} onOpen={setOpenId} openId={openId} onToast={setToast} />}
            {active === "controltech" && <ControlTechTab orgId={orgId} can={look} onOpen={setOpenId} openId={openId} onToast={setToast} canClaim={look("repair:claim")} />}
            {active === "mine" && <MyJobsTab orgId={orgId} userId={userId} onOpen={setOpenId} openId={openId} onToast={setToast} canClaim={look("repair:claim")} />}
            {active === "day" && <DayTab orgId={orgId} onOpen={setOpenId} />}
            {active === "security" && <SecurityTab orgId={orgId} openCase={openCase} setOpenCase={setOpenCase} />}
            {active === "factory" && <FactoryWorkshopTab orgId={orgId} onOpen={setOpenId} openId={openId} />}
          </div>
        </div>
      </div>

      {openId && (
        <DetailSidebar title="Repair job" label="Repair job" itemKey={openId} onClose={() => setOpenId(null)} wide>
          {/* View-only, but for one field: when the unit is supposed to be back (operator, 21 Nov). */}
          <RepairWorkflowJob orgId={orgId} itemId={openId} can={look} userId={userId} onToast={setToast} />
        </DetailSidebar>
      )}
      {openCase && (
        <DetailSidebar title="Security investigation" itemKey={openCase.id} onClose={() => setOpenCase(null)}>
          <CaseDetail key={openCase.id + (openCase.updatedAt ?? "")} orgId={orgId} c={openCase}
                      canUpdate={look("security_case:update")} onToast={setToast}
                      onSaved={(saved) => setOpenCase((prev) => ({ ...prev, ...saved }))} />
        </DetailSidebar>
      )}
    </div>
  );
}
