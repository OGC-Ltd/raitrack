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
import { REPAIRS_CHANGED, STAGE_LABEL, STAGE_PILL } from "../../api/repairs";
import {
  listWorkflowJobs, listWorkflowJobsSince, fetchQueue, fetchMyJobs, fetchWorkshops, fetchWorkshopDay, fetchInvestigations, fetchSecurityHolders,
  claimJob, updateInvestigation, viewOnly, NEXT_STEP, INVESTIGATION_LABEL, INVESTIGATION_PILL, isoDay,
  takeWorkshopHandoff, WORKSHOP_OPEN, shortCard,
} from "../../api/repairWorkflow";
import FactoryWorkshopTab from "./FactoryWorkshopTab";
import { JobsStrip, MineStrip, DayStrip, SecurityStrip, STAT_DAYS, windowDays, eatDay } from "./WorkshopStats";
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
    STAGE_LABEL[j.stage] ?? j.stage, NEXT_STEP[j.stage]?.who,
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
      {state === "open" && (
        <JobsStrip open={(jobs.data ?? []).filter((j) => !j.resolvedAt)} history={history.data}
                   bucketOf={bucketOf} loading={jobs.loading && !jobs.data} />
      )}
      <WfFilters
        label="Search jobs" placeholder="Search reg, ticket or fault…" search={search} onSearch={setSearch}
        groups={[
          { label: "Jobs", value: state, onPick: (id) => { setState(id); setBucket("all"); }, options: [["open", "Open"], ["closed", "Closed"]] },
          ...(state === "open" ? [{ label: "Next", value: bucket, onPick: setBucket,
            options: [["all", "Everyone", all.length], ...BUCKETS.map(([id, label]) => [id, label, counts[id]])] }] : []),
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
                head={[["Unit reg"], ["Fault"], ["Stage"], ["Ticket"], ["Workshop day"], ["Next"], ["In stage", true]]}>
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
                    <td>
                      <span className="wf-cell-stage">
                        <Badge tone={STAGE_PILL[j.stage]}>{STAGE_LABEL[j.stage] ?? j.stage}</Badge>
                        <PhaseLadder stage={j.stage} compact />
                      </span>
                    </td>
                    <td>
                      <span className="dr-veh">{j.ticketNo ?? "-"}</span>
                      {j.fsJobCards?.length > 0 && shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber) !== j.ticketNo && <span className="wf-cell-sub" title="FactorySuite job card">FactorySuite <span className="dr-veh">{shortCard(j.fsJobCards[j.fsJobCards.length - 1].cardNumber)}</span></span>}
                    </td>
                    <td className="sys-num">{booking ? isoDay(booking.bookingDate) : "-"}</td>
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
                head={[["Unit reg"], ["Fault"], ["Stage"], ["Ticket"], [group === "workshop" ? "Workshop" : "Your part"], [group === "closed" ? "Closed" : "In stage", true]]}>
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
                    <td>
                      <span className="wf-cell-stage">
                        <Badge tone={STAGE_PILL[j.stage]}>{STAGE_LABEL[j.stage] ?? j.stage}</Badge>
                        <PhaseLadder stage={j.stage} compact />
                      </span>
                    </td>
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

/** The day's shape while it loads: capacity line and three rows, so the page
 *  holds its height and nothing jumps when the bookings arrive. */
function DaySkeleton() {
  return (
    <div aria-busy="true" aria-label="Reading the day">
      <div className="wf-capacity" aria-hidden="true">
        <span className="sp4-skel-cell wf-skel wf-skel--n" />
        <span className="sp4-skel-cell wf-skel wf-skel--bar" />
        <span className="sp4-skel-cell wf-skel wf-skel--txt" />
      </div>
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
  const shift = (n) => setDate(dayShift(date, n));
  const d = day.data;
  const live = (d?.bookings ?? []).filter((b) => b.status === "booked" || b.status === "arrived");
  const other = (d?.bookings ?? []).filter((b) => b.status === "no_show");
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));
  // One row a unit on the day, booked first, then the unbooked arrivals, then the no-shows.
  const dayRows = [
    ...live.map((b) => ({ key: b.id, job: b.repairItem, tag: b.status === "arrived" ? "Arrived" : "Booked", tone: b.status === "arrived" ? "con" : "info" })),
    ...(d?.unbookedArrivals ?? []).map((j) => ({ key: j.id, job: j, tag: "Arrived, unbooked", tone: "warn" })),
    ...other.map((b) => ({ key: b.id, job: b.repairItem, tag: "No show", tone: "inc" })),
  ];
  const dayPager = usePager(dayRows, `${wid}|${date}`);

  return (
    <div className="wf-day-board">
      <DayStrip current={day.data} week={week} date={date} loading={workshops === null || (day.loading && !day.data)} />
      <div className="wf-day-board__head">
        <div className="wf-day-board__nav">
          <button type="button" className="sp4-ghost-btn" onClick={() => shift(-1)} aria-label="Previous day"><i className="ti ti-chevron-left" aria-hidden="true" /></button>
          <h2 className="wf-day-board__date">{label}</h2>
          <button type="button" className="sp4-ghost-btn" onClick={() => shift(1)} aria-label="Next day"><i className="ti ti-chevron-right" aria-hidden="true" /></button>
          {date !== isoDay(Date.now()) && <button type="button" className="sp4-ghost-btn" onClick={() => setDate(isoDay(Date.now()))}>Today</button>}
        </div>
        {(workshops?.length ?? 0) > 1 && (
          <select className="sp4-input wf-ws-pick" value={wid ?? ""} onChange={(e) => setWid(e.target.value)} aria-label="Workshop">
            {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {d && (
        <p className="wf-capacity" aria-label={`${d.booked} of ${d.capacity} booked`}>
          <span className="wf-capacity__n">{d.booked}<span>/{d.capacity}</span></span>
          <span className="wf-capacity__bar" aria-hidden="true">
            {Array.from({ length: d.capacity }, (_, i) => <i key={i} className={i < d.booked ? "is-taken" : ""} />)}
          </span>
          <span className="wf-capacity__txt">
            {d.workshop?.name} · booked vehicles
            {d.unbookedArrivals.length ? ` · ${d.unbookedArrivals.length} arrived without a booking` : ""}
          </span>
        </p>
      )}

      {workshops === null || day.loading ? (
        <DaySkeleton />
      ) : workshops.length === 0 ? (
        <EmptyNote icon="ti-building-warehouse" title="No Workshop Yet">This organisation has no workshop set up, so there is no day board.</EmptyNote>
      ) : day.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Day Could Not Be Loaded" action={{ label: "Try again", onClick: day.retry }}>{day.error}</EmptyNote>
      ) : live.length === 0 && (d?.unbookedArrivals?.length ?? 0) === 0 ? (
        <EmptyNote icon="ti-calendar" title="Nothing Booked">No unit is booked into the workshop on this day.</EmptyNote>
      ) : (
        <WfGrid label="Day pages" pager={dayPager}
                head={[["Unit reg"], ["Fault"], ["Ticket"], ["Technician"], ["Status"]]}>
          {dayPager.pageRows.map((r) => <BoardRow key={r.key} job={r.job} onOpen={onOpen} tag={r.tag} tagTone={r.tone} />)}
        </WfGrid>
      )}
    </div>
  );
}

function BoardRow({ job, onOpen, tag, tagTone }) {
  const tech = job.workshopTechnician?.fullName ?? job.workshopTechnicianName;
  return (
    <tr {...rowProps(false, () => onOpen(job.id))}>
      <td><Ident name={job.vehicle?.registrationPlate ?? "-"} sub={job.vehicle?.name !== job.vehicle?.registrationPlate ? job.vehicle?.name : null} /></td>
      <td><span className="wf-cell-fault">{jobLabel(job)}</span></td>
      <td><span className="dr-veh">{job.ticketNo ?? "No ticket yet"}</span></td>
      <td>{tech ?? <span className="sp4-muted">No technician</span>}</td>
      <td><Badge tone={tagTone}>{tag}</Badge></td>
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
            {active === "mine" && <MyJobsTab orgId={orgId} userId={userId} onOpen={setOpenId} openId={openId} onToast={setToast} canClaim={look("repair:claim")} />}
            {active === "day" && <DayTab orgId={orgId} onOpen={setOpenId} />}
            {active === "security" && <SecurityTab orgId={orgId} openCase={openCase} setOpenCase={setOpenCase} />}
            {active === "factory" && <FactoryWorkshopTab orgId={orgId} onOpen={setOpenId} openId={openId} />}
          </div>
        </div>
      </div>

      {openId && (
        <DetailSidebar title="Repair job" label="Repair job" itemKey={openId} onClose={() => setOpenId(null)} wide>
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
