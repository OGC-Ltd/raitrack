/**
 * Workshop: the Vehicle Support and Repair Workflow, one screen.
 *
 * Opened on `repair:read` alone, not on `sensor:read` like Maintenance, because
 * two of the three Control Room roles (operator, supervisor) hold no sensor
 * grant and they are the people who flag, assess, book and verify.
 *
 *   Jobs           every job on the workflow, filtered by who acts next
 *   ControlTech    the queue ControlTech technicians claim from (repair:claim)
 *   Workshop day   one day's intake against the 3-a-day cap
 *   Security       investigations opened by suspected malicious damage
 *                  (security_case:read: the Head of Security)
 *
 * A row opens the job in the shared DetailSidebar (RepairWorkflowJob), the
 * same side panel every other page uses. Built from the Sensor Monitor's parts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../body/SensorPanel.css";
import "./SystemScreen.css";
import "../body/RepairWorkflow.css";
import { usePermissions } from "../../hooks/usePermissions";
import { useAuth } from "../../context/AuthContext";
import { REPAIRS_CHANGED, STAGE_LABEL, STAGE_PILL } from "../../api/repairs";
import {
  listWorkflowJobs, fetchQueue, fetchWorkshops, fetchWorkshopDay, fetchInvestigations, fetchSecurityHolders,
  claimJob, updateInvestigation, NEXT_STEP, INVESTIGATION_LABEL, INVESTIGATION_PILL, isoDay,
} from "../../api/repairWorkflow";
import RepairWorkflowJob, { PhaseLadder, jobLabel, at } from "../body/RepairWorkflowJob";
import FlagRepairDialog from "../body/FlagRepairDialog";
import TableToolbar from "../body/TableToolbar";
import FilterBar from "../body/FilterBar";
import EmptyNote from "../shared/EmptyNote";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { watchTableLabels } from "../../lib/tableLabels";

/** Who acts next, as the Jobs filter groups it. */
const BUCKETS = [
  ["control_room", "Control Room", ["pending", "awaiting_assessment", "booked", "towing", "completed"]],
  ["controltech",  "ControlTech",  ["forwarded", "remote_fix", "spare_outsourced"]],
  ["workshop",     "Workshop",     ["in_workshop", "field_inspection", "fixing"]],
];
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
  return h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

// ── Jobs ────────────────────────────────────────────────────────────────────

function JobsTab({ orgId, can, onOpen, openId, onToast }) {
  const [state, setState] = useState("open");
  const [bucket, setBucket] = useState("all");
  const [flagging, setFlagging] = useState(false);
  const jobs = useLive(() => listWorkflowJobs(orgId, { status: state === "closed" ? "all" : state }), [orgId, state]);
  const all = (jobs.data ?? []).filter((j) => (state === "closed" ? !!j.resolvedAt : true));
  const counts = Object.fromEntries(BUCKETS.map(([k]) => [k, all.filter((j) => bucketOf(j.stage) === k).length]));
  const rows = bucket === "all" ? all : all.filter((j) => bucketOf(j.stage) === bucket);

  return (
    <>
      <TableToolbar
        summary={<><b>{rows.length}</b> job{rows.length === 1 ? "" : "s"}</>}
        loading={jobs.loading}
        onReload={jobs.read}
        actions={can("repair:flag") ? (
          <button type="button" className="sp4-submit-btn wf-flag-btn" onClick={() => setFlagging(true)}>
            <i className="ti ti-flag" aria-hidden="true" /> Flag for repair
          </button>
        ) : null}
      />
      <FilterBar label="Filters" activeCount={(state !== "open" ? 1 : 0) + (bucket !== "all" ? 1 : 0)}>
        <div className="sp4-filter-group">
          <span className="sp4-filter-label">Jobs</span>
          {[["open", "Open"], ["closed", "Closed"]].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={state === id}
                    className={"sp4-filter-chip" + (state === id ? " sp4-filter-chip--on" : "")}
                    onClick={() => { setState(id); setBucket("all"); }}>{label}</button>
          ))}
        </div>
        {state === "open" && (
          <div className="sp4-filter-group">
            <span className="sp4-filter-label">Next</span>
            <button type="button" aria-pressed={bucket === "all"} className={"sp4-filter-chip" + (bucket === "all" ? " sp4-filter-chip--on" : "")}
                    onClick={() => setBucket("all")}>Everyone<span className="sys-chip-n">{all.length}</span></button>
            {BUCKETS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={bucket === id}
                      className={"sp4-filter-chip" + (bucket === id ? " sp4-filter-chip--on" : "")}
                      onClick={() => setBucket(id)}>{label}<span className="sys-chip-n">{counts[id]}</span></button>
            ))}
          </div>
        )}
      </FilterBar>

      {rows.length === 0 && jobs.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Jobs">Repair jobs and where each one stands.</EmptyNote>
      ) : rows.length === 0 && jobs.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Jobs Could Not Be Loaded" action={{ label: "Try again", onClick: jobs.read }}>{jobs.error}</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title={state === "open" ? "No Open Repairs" : "No Closed Repairs Yet"}
                   action={state === "open" && can("repair:flag") ? { label: "Flag for repair", onClick: () => setFlagging(true) } : null}>
          {state === "open" ? "No unit is waiting on a repair." : "Nothing has been verified, signed off or voided yet."}
        </EmptyNote>
      ) : (
        <div className="sp4-table-scroll">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable wf-table">
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit Reg</th>
                <th className="sp4-th--left">Fault</th>
                <th className="sp4-th--left">Stage</th>
                <th className="sp4-th--left">Ticket</th>
                <th className="sp4-th--left">Workshop day</th>
                <th className="sp4-th--left">Next</th>
                <th className="sp4-th--right">In stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const booking = j.bookings?.[0];
                const next = NEXT_STEP[j.stage];
                const open = () => onOpen(j.id);
                return (
                  <tr key={j.id} data-job={j.id} tabIndex={0}
                      className={"sp4-tr sp4-tr--incident wf-tr" + (openId === j.id ? " wf-tr--open" : "")}
                      aria-expanded={openId === j.id} onClick={open}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
                    <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{j.vehicle?.registrationPlate ?? "-"}</span></td>
                    <td className="sp4-td--left">
                      <span className="wf-cell-fault">{jobLabel(j)}</span>
                      {(j.suspectedFault ?? j.problemNote) && <span className="wf-cell-sub">{j.suspectedFault ?? j.problemNote}</span>}
                    </td>
                    <td className="sp4-td--left">
                      <span className="wf-cell-stage">
                        <span className={`sp4-pill sp4-pill--${STAGE_PILL[j.stage] ?? "none"}`}>{STAGE_LABEL[j.stage] ?? j.stage}</span>
                        <PhaseLadder stage={j.stage} compact />
                      </span>
                    </td>
                    <td className="sp4-td--left"><span className="wf-mono">{j.ticketNo ?? "-"}</span></td>
                    <td className="sp4-td--left sys-num">{booking ? isoDay(booking.bookingDate) : "-"}</td>
                    <td className="sp4-td--left">{j.resolvedAt ? <span className="sp4-muted">Closed</span> : next?.who ?? "-"}</td>
                    <td className="sp4-td--right sys-num">{since(j.stageChangedAt ?? j.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <FlagRepairDialog
        orgId={orgId}
        open={flagging}
        onClose={() => setFlagging(false)}
        onFlagged={(made, route) => {
          onToast({ tone: "ok", text: `${made.length} unit${made.length === 1 ? "" : "s"} flagged${route === "controltech" ? " and sent to ControlTech" : route === "workshop" ? " and sent to the workshop" : ""}.` });
          if (made.length === 1 && made[0]?.id) onOpen(made[0].id);
        }}
      />
    </>
  );
}

// ── ControlTech queue ───────────────────────────────────────────────────────

function QueueTab({ orgId, userId, onOpen, onToast }) {
  const q = useLive(() => fetchQueue(orgId), [orgId]);
  const [busy, setBusy] = useState(null);
  const rows = q.data ?? [];
  const unclaimed = rows.filter((r) => !r.assignedToId);
  const mine = rows.filter((r) => r.assignedToId === userId);

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

  return (
    <>
      <TableToolbar summary={<><b>{unclaimed.length}</b> waiting to be claimed · <b>{mine.length}</b> yours</>} loading={q.loading} onReload={q.read} />
      {rows.length === 0 && q.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Queue">Jobs forwarded to ControlTech.</EmptyNote>
      ) : rows.length === 0 && q.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Queue Could Not Be Loaded" action={{ label: "Try again", onClick: q.read }}>{q.error}</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-inbox" title="The Queue Is Empty">Nothing has been forwarded to ControlTech.</EmptyNote>
      ) : (
        <div className="sp4-table-scroll">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable wf-table">
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit Reg</th>
                <th className="sp4-th--left">Fault</th>
                <th className="sp4-th--left">Suspected fault</th>
                <th className="sp4-th--right">Waiting</th>
                <th className="sp4-th--left">Claimed by</th>
                <th className="sp4-th--right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="sp4-tr wf-tr" tabIndex={0} onClick={() => onOpen(r.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onOpen(r.id); }}>
                  <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{r.vehicle?.registrationPlate}</span></td>
                  <td className="sp4-td--left">{jobLabel(r)}</td>
                  <td className="sp4-td--left wf-cell-wrap">{r.suspectedFault ?? r.problemNote ?? "-"}</td>
                  <td className="sp4-td--right sys-num">{since(r.forwardedAt ?? r.createdAt)}</td>
                  <td className="sp4-td--left">{r.assignedTo?.fullName ?? <span className="sp4-muted">Nobody yet</span>}</td>
                  <td className="sp4-td--right">
                    {!r.assignedToId ? (
                      <button type="button" className="sp4-submit-btn wf-row-btn" disabled={busy === r.id}
                              onClick={(e) => { e.stopPropagation(); claim(r); }}>{busy === r.id ? "Claiming…" : "Claim"}</button>
                    ) : (
                      <button type="button" className="sp4-ghost-btn" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>Open</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Workshop day board ──────────────────────────────────────────────────────

function DayTab({ orgId, onOpen }) {
  const [workshops, setWorkshops] = useState(null);
  const [wid, setWid] = useState(null);
  const [date, setDate] = useState(() => isoDay(Date.now()));
  useEffect(() => {
    fetchWorkshops(orgId).then((w) => { setWorkshops(w); setWid(w[0]?.id ?? null); }).catch(() => setWorkshops([]));
  }, [orgId]);
  const day = useLive(() => (wid ? fetchWorkshopDay(orgId, wid, date) : null), [orgId, wid, date]);
  const shift = (n) => setDate(isoDay(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000));
  const d = day.data;
  const live = (d?.bookings ?? []).filter((b) => b.status === "booked" || b.status === "arrived");
  const other = (d?.bookings ?? []).filter((b) => b.status === "no_show");
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));

  return (
    <div className="wf-day-board">
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

      {day.loading && !d ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Day">Bookings and arrivals.</EmptyNote>
      ) : live.length === 0 && (d?.unbookedArrivals?.length ?? 0) === 0 ? (
        <EmptyNote icon="ti-calendar" title="Nothing Booked">No unit is booked into the workshop on this day.</EmptyNote>
      ) : (
        <ol className="wf-board">
          {live.map((b) => (
            <BoardRow key={b.id} job={b.repairItem} onOpen={onOpen}
                      tag={b.status === "arrived" ? "Arrived" : "Booked"} tagTone={b.status === "arrived" ? "con" : "info"} />
          ))}
          {d.unbookedArrivals.map((j) => <BoardRow key={j.id} job={j} onOpen={onOpen} tag="Arrived, unbooked" tagTone="warn" />)}
          {other.map((b) => <BoardRow key={b.id} job={b.repairItem} onOpen={onOpen} tag="No show" tagTone="inc" />)}
        </ol>
      )}
    </div>
  );
}

function BoardRow({ job, onOpen, tag, tagTone }) {
  return (
    <li>
      <button type="button" className="wf-board__row" onClick={() => onOpen(job.id)}>
        <span className="wf-board__plate">{job.vehicle?.registrationPlate}</span>
        <span className="wf-board__fault">{jobLabel(job)}</span>
        <span className="wf-mono wf-board__ticket">{job.ticketNo ?? "No ticket yet"}</span>
        <span className="wf-board__tech">{job.workshopTechnician?.fullName ?? job.workshopTechnicianName ?? "No technician"}</span>
        <span className={`sp4-pill sp4-pill--${tagTone}`}>{tag}</span>
      </button>
    </li>
  );
}

// ── Security cases ──────────────────────────────────────────────────────────

function SecurityTab({ orgId, openCase, setOpenCase }) {
  const [state, setState] = useState("open");
  const list = useLive(() => fetchInvestigations(orgId, state), [orgId, state]);
  const rows = list.data ?? [];
  return (
    <>
      <TableToolbar summary={<><b>{rows.length}</b> investigation{rows.length === 1 ? "" : "s"}</>} loading={list.loading} onReload={list.read} />
      <FilterBar label="State" activeCount={state !== "open" ? 1 : 0}>
        <div className="sp4-filter-group">
          <span className="sp4-filter-label">State</span>
          {[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={state === id}
                    className={"sp4-filter-chip" + (state === id ? " sp4-filter-chip--on" : "")} onClick={() => setState(id)}>{label}</button>
          ))}
        </div>
      </FilterBar>
      {rows.length === 0 && list.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Investigations">Suspected malicious damage found in repairs.</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-shield-check" title={state === "open" ? "No Open Investigations" : "No Investigations"}>
          An investigation opens when a technician classes damage as suspected malicious.
        </EmptyNote>
      ) : (
        <div className="sp4-table-scroll">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable wf-table">
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit Reg</th>
                <th className="sp4-th--left">Ticket</th>
                <th className="sp4-th--left">Damage</th>
                <th className="sp4-th--left">Warranty</th>
                <th className="sp4-th--left">State</th>
                <th className="sp4-th--left">Held by</th>
                <th className="sp4-th--right">Opened</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} tabIndex={0} className={"sp4-tr wf-tr" + (openCase?.id === c.id ? " wf-tr--open" : "")}
                    onClick={() => setOpenCase(c)} onKeyDown={(e) => { if (e.key === "Enter") setOpenCase(c); }}>
                  <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{c.vehicle?.registrationPlate}</span></td>
                  <td className="sp4-td--left"><span className="wf-mono">{c.repairItem?.ticketNo ?? "-"}</span></td>
                  <td className="sp4-td--left wf-cell-wrap">{c.repairItem?.damageNote ?? "-"}</td>
                  <td className="sp4-td--left">{c.repairItem?.warrantyVoid ? "Void" : "Stands"}</td>
                  <td className="sp4-td--left"><span className={`sp4-pill sp4-pill--${INVESTIGATION_PILL[c.status] ?? "none"}`}>{INVESTIGATION_LABEL[c.status] ?? c.status}</span></td>
                  <td className="sp4-td--left">{c.assignedTo?.fullName ?? <span className="sp4-muted">Nobody yet</span>}</td>
                  <td className="sp4-td--right sys-num">{at(c.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <ol className="wf-log wf-log--trail">
            {history.map((h, i) => (
              <li key={i} className="wf-log__e">
                <span className="wf-log__when">{at(h.at)}</span>
                <span className="wf-log__kind">{INVESTIGATION_LABEL[h.status] ?? h.status}</span>
                <span className="wf-log__text">{h.note ?? ""}</span>
                <span className="wf-log__by">{h.byName ?? ""}</span>
              </li>
            ))}
          </ol>
        </DetailSidebarSection>
      )}
    </>
  );
}

// ── The screen ──────────────────────────────────────────────────────────────

export default function WorkshopScreen() {
  const { orgId, can } = usePermissions();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [toast, setToast] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [openCase, setOpenCase] = useState(null);

  const tabs = useMemo(() => [
    { key: "jobs",     label: "Jobs",          allow: can("repair:read") },
    { key: "queue",    label: "ControlTech",   allow: can("repair:claim") },
    { key: "day",      label: "Workshop Day",  allow: can("repair:read") },
    { key: "security", label: "Security Cases", allow: can("security_case:read") },
  ].filter((t) => t.allow), [can]);
  const [tab, setTab] = useState("jobs");
  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

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
      <div className="sp4-tabs" role="tablist" aria-label="Workshop">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
                  className={"sp4-tab" + (active === t.key ? " sp4-tab--on" : "")}
                  onClick={() => { setTab(t.key); setOpenId(null); setOpenCase(null); }}>{t.label}</button>
        ))}
      </div>

      <div className="sp4-body">
        {active === "jobs" && <JobsTab orgId={orgId} can={can} onOpen={setOpenId} openId={openId} onToast={setToast} />}
        {active === "queue" && <QueueTab orgId={orgId} userId={userId} onOpen={setOpenId} onToast={setToast} />}
        {active === "day" && <DayTab orgId={orgId} onOpen={setOpenId} />}
        {active === "security" && <SecurityTab orgId={orgId} openCase={openCase} setOpenCase={setOpenCase} />}
      </div>

      {openId && (
        <DetailSidebar title="Repair job" label="Repair job" itemKey={openId} onClose={() => setOpenId(null)} wide>
          <RepairWorkflowJob orgId={orgId} itemId={openId} can={can} userId={userId} onToast={setToast} />
        </DetailSidebar>
      )}
      {openCase && (
        <DetailSidebar title="Security investigation" itemKey={openCase.id} onClose={() => setOpenCase(null)}>
          <CaseDetail key={openCase.id + (openCase.updatedAt ?? "")} orgId={orgId} c={openCase}
                      canUpdate={can("security_case:update")} onToast={setToast}
                      onSaved={(saved) => setOpenCase((prev) => ({ ...prev, ...saved }))} />
        </DetailSidebar>
      )}
    </div>
  );
}
