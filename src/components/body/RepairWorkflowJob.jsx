/**
 * One repair job on the Vehicle Support and Repair Workflow, in the detail
 * sidebar of the Workshop screen.
 *
 * Read top to bottom it answers three questions, in the order people ask them:
 *
 *   1. Where is it?        the six-phase ladder (Flagged ... Verification)
 *   2. What happens next?  ONE block naming who acts and what, holding the
 *                          action itself when this person may take it. Every
 *                          other step's controls are absent, not disabled:
 *                          a panel of greyed buttons reads as a broken panel.
 *   3. What has happened?  the ticket: assessment, booking, damage and
 *                          warranty, parts, work log, trail. The record the
 *                          workflow's step 7 asks the ticket to keep.
 *
 * The server decides every rule (repairs.workflow); this only draws the step
 * a person can take and says the server's refusal in a toast when it comes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { REPAIRS_CHANGED, STAGE_LABEL, STAGE_PILL, PART_STATUS } from "../../api/repairs";
import {
  fetchTicket, fetchAvailability, fetchWorkshops, fetchAssignees, forwardJob, claimJob, decidePath, assessJob,
  bookJob, cancelBooking, arriveJob, assignWorkshop, classifyDamage, voidWarranty, clearWarranty, addWork,
  completeJob, verifyJob, voidJob, requestPart, sourcePart, issuePart, fitPart,
  CATEGORY_LABEL, PHASES, PHASE_OF_STAGE, NEXT_STEP, PATH_LABEL, INTERVENTION_LABEL, DAMAGE_LABEL,
  INVESTIGATION_LABEL, INVESTIGATION_PILL, WORK_KIND_LABEL, componentLabel, routeOf,
} from "../../api/repairWorkflow";
import "./RepairWorkflow.css";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
export const at = (iso) => (iso ? WHEN.format(new Date(iso)) : "-");
const dayLabel = (iso) => (iso ? DAY.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : "-");

export function jobLabel(job) {
  return CATEGORY_LABEL[job?.faultCategory] ?? (job?.targetKind === "probe" ? "Fuel probe" : "Fault");
}

/** The six phases as a hairline ladder: done, current, to come. */
export function PhaseLadder({ stage, compact = false }) {
  const phase = PHASE_OF_STAGE[stage] ?? "flag";
  const reached = PHASES.findIndex(([k]) => k === phase);
  const closed = stage === "fixed" || stage === "void" || stage === "failed";
  return (
    <ol className={"wf-ladder" + (compact ? " wf-ladder--compact" : "")} aria-label={`Phase: ${PHASES[reached]?.[1] ?? ""}`}>
      {PHASES.map(([k, label], i) => {
        const state = i < reached || (closed && i === reached) ? "done" : i === reached ? "now" : "todo";
        return (
          <li key={k} className={`wf-ladder__step wf-ladder__step--${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="wf-ladder__tick" aria-hidden="true" />
            {!compact && <span className="wf-ladder__label">{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ label, children }) {
  if (children == null || children === "" || children === "-") return null;
  return <div className="wf-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function Section({ title, aside, children }) {
  return (
    <section className="wf-sec">
      <h3 className="wf-sec__h">{title}{aside && <span className="wf-sec__aside">{aside}</span>}</h3>
      {children}
    </section>
  );
}

/** A labelled text area; `required` says so beside the label. */
function Note({ label, value, onChange, rows = 2, placeholder, required = false, max = 1000 }) {
  return (
    <label className="sp4-field wf-field">
      <span className="sp4-label">{label}{required && <span className="wf-req"> required</span>}</span>
      <textarea className="sp4-textarea" rows={rows} maxLength={max} value={value} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A segmented choice: one of a few, every option visible. */
function Choice({ label, value, onChange, options }) {
  return (
    <div className="wf-field">
      <span className="sp4-label">{label}</span>
      <div className="wf-seg" role="radiogroup" aria-label={label}>
        {options.map(([id, text]) => (
          <button key={String(id)} type="button" role="radio" aria-checked={value === id}
                  className={"wf-seg__opt" + (value === id ? " wf-seg__opt--on" : "")} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One submit, with its own busy state, reporting through the panel's toast. */
function useAct(onToast, onDone) {
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, ok) => {
    if (busy) return false;
    setBusy(key);
    try {
      const out = await fn();
      if (ok) onToast?.({ tone: "ok", text: typeof ok === "function" ? ok(out) : ok });
      onDone?.();
      return true;
    } catch (e) {
      onToast?.({ tone: "crit", text: e?.message || "That did not go through. Try again." });
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, onToast, onDone]);
  return [busy, run];
}

// ── The next-step actions, one per stage ────────────────────────────────────

function PathStep({ orgId, job, act, busy, from }) {
  const [note, setNote] = useState("");
  return (
    <div className="wf-form">
      <Note label={from === "remote_fix" ? "Why a remote fix did not work" : "What you found"} value={note} onChange={setNote}
            placeholder={from === "remote_fix" ? "Reconfigured twice, still no fuel readings" : "Probe offline since Tuesday, no power on the feed"} />
      <div className="wf-actions">
        {from !== "remote_fix" && (
          <button type="button" className="sp4-ghost-btn" disabled={!!busy}
                  onClick={() => act("remote", () => decidePath(orgId, job.id, "remote", note), "Fixing remotely.")}>
            {busy === "remote" ? "Saving…" : "Fix remotely"}
          </button>
        )}
        <button type="button" className="sp4-submit-btn" disabled={!!busy}
                onClick={() => act("physical", () => decidePath(orgId, job.id, "physical", note), "Sent to the Control Room for a physical inspection.")}>
          {busy === "physical" ? "Saving…" : "Needs physical inspection"}
        </button>
      </div>
    </div>
  );
}

function AssessStep({ orgId, job, act, busy }) {
  const [roadworthy, setRoadworthy] = useState(true);
  const [intervention, setIntervention] = useState("tow");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const ok = roadworthy || reason.trim().length > 0;
  const send = () => act("assess", () => assessJob(orgId, job.id, {
    roadworthy, intervention: roadworthy ? "workshop" : intervention, reason,
    detail: roadworthy ? undefined : intervention === "tow" ? { towProvider: detail } : { team: detail },
  }), roadworthy ? "Assessed roadworthy. Book a workshop day." : "Assessment recorded.");
  return (
    <div className="wf-form">
      <Choice label="Can it safely reach the Auto Workshop?" value={roadworthy} onChange={setRoadworthy}
              options={[[true, "Yes, it can be driven"], [false, "No, it is immobile"]]} />
      {!roadworthy && (
        <>
          <Note label="Why it cannot be driven" required value={reason} onChange={setReason}
                placeholder="Brake lines cut, unit stood at Field 14" />
          <Choice label="Intervention" value={intervention} onChange={setIntervention}
                  options={[["tow", "Tow to the workshop"], ["field_inspection", "Inspect on site"]]} />
          <label className="sp4-field wf-field">
            <span className="sp4-label">{intervention === "tow" ? "Tow provider" : "Who goes"}</span>
            <input className="sp4-input" value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} />
          </label>
        </>
      )}
      <div className="wf-actions">
        {!ok && <span className="wf-hint">Say why the unit cannot reach the workshop</span>}
        <button type="button" className="sp4-submit-btn" disabled={!ok || !!busy} onClick={send}>
          {busy === "assess" ? "Saving…" : "Record assessment"}
        </button>
      </div>
    </div>
  );
}

/**
 * The booking strip: the next 14 days, each with its intake as n of 3. A
 * full day cannot be picked, so the 3-a-day rule is visible before anybody
 * runs into it, and the server's lock still decides a race for the last slot.
 */
function BookStep({ orgId, job, act, busy }) {
  const [workshops, setWorkshops] = useState(null);
  const [wid, setWid] = useState(null);
  const [avail, setAvail] = useState(null);
  const [pick, setPick] = useState(null);

  useEffect(() => {
    fetchWorkshops(orgId).then((w) => { setWorkshops(w); setWid((cur) => cur ?? w[0]?.id ?? null); }).catch(() => setWorkshops([]));
  }, [orgId]);
  const readAvail = useCallback(() => {
    if (wid) fetchAvailability(orgId, wid, 14).then(setAvail).catch(() => setAvail(null));
  }, [orgId, wid]);
  useEffect(readAvail, [readAvail]);

  if (!workshops) return <p className="wf-muted">Reading the workshop calendar…</p>;
  return (
    <div className="wf-form">
      {workshops.length > 1 && (
        <Choice label="Workshop" value={wid} onChange={(v) => { setWid(v); setPick(null); }}
                options={workshops.map((w) => [w.id, w.name])} />
      )}
      <div className="wf-field">
        <span className="sp4-label">
          {avail?.workshop?.name ?? "Workshop"} · {avail?.workshop?.dailyCapacity ?? 3} vehicles a day
        </span>
        <div className="wf-days" role="radiogroup" aria-label="Workshop day">
          {(avail?.days ?? []).map((d) => {
            const full = d.free === 0;
            return (
              <button key={d.date} type="button" role="radio" aria-checked={pick === d.date} disabled={full}
                      className={"wf-day" + (pick === d.date ? " wf-day--on" : "") + (full ? " wf-day--full" : "")}
                      aria-label={`${dayLabel(d.date)}: ${d.booked} of ${d.capacity} booked${full ? ", full" : ""}`}
                      onClick={() => setPick(d.date)}>
                <span className="wf-day__dow">{dayLabel(d.date).split(" ")[0]}</span>
                <span className="wf-day__n">{dayLabel(d.date).split(" ")[1]}</span>
                <span className="wf-day__meter" aria-hidden="true">
                  {Array.from({ length: d.capacity }, (_, i) => <i key={i} className={i < d.booked ? "is-taken" : ""} />)}
                </span>
                <span className="wf-day__cap">{full ? "Full" : `${d.booked}/${d.capacity}`}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="wf-actions">
        <button type="button" className="sp4-submit-btn" disabled={!pick || !!busy}
                onClick={() => act("book", () => bookJob(orgId, job.id, wid, pick), `Booked for ${dayLabel(pick)}.`).then((ok) => { if (!ok) readAvail(); })}>
          {busy === "book" ? "Booking…" : pick ? `Book ${dayLabel(pick)}` : "Pick a day"}
        </button>
      </div>
    </div>
  );
}

function ReasonButton({ label, busyLabel, placeholder, onSend, busy, tone = "ghost" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return <button type="button" className={tone === "danger" ? "sp4-danger-btn" : "sp4-ghost-btn"} onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <div className="wf-form wf-form--inline">
      <Note label="Reason" required value={reason} onChange={setReason} placeholder={placeholder} />
      <div className="wf-actions">
        <button type="button" className="sp4-ghost-btn" onClick={() => setOpen(false)}>Keep it</button>
        <button type="button" className={tone === "danger" ? "sp4-danger-btn" : "sp4-submit-btn"} disabled={!reason.trim() || !!busy}
                onClick={async () => { if (await onSend(reason)) setOpen(false); }}>
          {busy ? busyLabel : label}
        </button>
      </div>
    </div>
  );
}

function DamageStep({ orgId, job, act, busy }) {
  const [cls, setCls] = useState("genuine");
  const [note, setNote] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const malicious = cls === "suspected_malicious";
  const ok = !malicious || note.trim().length > 0;
  return (
    <div className="wf-form">
      <Choice label="Damage" value={cls} onChange={setCls}
              options={[["genuine", "Genuine wear or fault"], ["suspected_malicious", "Suspected malicious"]]} />
      {malicious && (
        <Note label="Describe the damage" required value={note} onChange={setNote} rows={3}
              placeholder="Probe cable cut clean at the tank entry; seal broken" />
      )}
      <Note label="Diagnosis" value={diagnosis} onChange={setDiagnosis} rows={3} max={4000}
            placeholder="What is wrong, and what the repair will be" />
      {malicious && (
        <p className="wf-callout wf-callout--crit">
          The Head of Security is notified and an investigation opens. The repair goes ahead.
        </p>
      )}
      <div className="wf-actions">
        <button type="button" className="sp4-submit-btn" disabled={!ok || !!busy}
                onClick={() => act("damage", () => classifyDamage(orgId, job.id, { damageClass: cls, note, diagnosis }),
                  malicious ? "Recorded. The Head of Security has been notified." : "Recorded. The repair is under way.")}>
          {busy === "damage" ? "Saving…" : "Record and start the repair"}
        </button>
      </div>
    </div>
  );
}

function CompleteStep({ orgId, job, act, busy }) {
  const [result, setResult] = useState("pass");
  const [testNote, setTestNote] = useState("");
  const [fixNote, setFixNote] = useState("");
  const [rec, setRec] = useState("");
  const ok = fixNote.trim().length > 0;
  return (
    <div className="wf-form">
      <Choice label="Test result" value={result} onChange={setResult} options={[["pass", "Passed"], ["fail", "Failed"]]} />
      <Note label="How it was tested" value={testNote} onChange={setTestNote} placeholder="Road test, 3 km: holds under load" />
      <Note label="What was done" required value={fixNote} onChange={setFixNote} rows={3} max={2000}
            placeholder="What you replaced, adjusted or refitted" />
      {result === "pass" && <Note label="Recommendation" value={rec} onChange={setRec} max={2000} />}
      <div className="wf-actions">
        <button type="button" className="sp4-submit-btn" disabled={!ok || !!busy}
                onClick={() => act("complete", () => completeJob(orgId, job.id, {
                  testResult: result, testNote, fixNote, recommendation: result === "pass" ? rec : undefined,
                }), (out) => (out?.testFailed ? "Failed test recorded on the work log. Keep working." : "Completed. Sent to the Control Room to verify."))}>
          {busy === "complete" ? "Saving…" : result === "pass" ? "Complete and send to verify" : "Record the failed test"}
        </button>
      </div>
    </div>
  );
}

function VerifyStep({ orgId, job, act, busy, isCompleter }) {
  const [note, setNote] = useState("");
  if (isCompleter) return <p className="wf-muted">You completed this repair. Someone else in the Control Room verifies it.</p>;
  return (
    <div className="wf-form">
      <dl className="wf-facts wf-facts--tight">
        <Fact label="Completed">{[job.completedByName, at(job.completedAt)].filter(Boolean).join(" · ")}</Fact>
        <Fact label="Test">{job.testResult === "pass" ? "Passed" : job.testResult}{job.testNote ? ` · ${job.testNote}` : ""}</Fact>
        <Fact label="What was done">{job.fixNote}</Fact>
      </dl>
      <Note label="Note" value={note} onChange={setNote} placeholder="Required to reject: what does not match" />
      <div className="wf-actions">
        <button type="button" className="sp4-ghost-btn" disabled={!note.trim() || !!busy}
                onClick={() => act("reject", () => verifyJob(orgId, job.id, "reject", note), "Sent back to the technician.")}>
          {busy === "reject" ? "Sending…" : "Reject"}
        </button>
        <button type="button" className="sp4-submit-btn" disabled={!!busy}
                onClick={() => act("accept", () => verifyJob(orgId, job.id, "accept", note), "Verified. The unit is fixed and available.")}>
          {busy === "accept" ? "Verifying…" : "Verify: fixed and available"}
        </button>
      </div>
    </div>
  );
}

// ── The ticket record ───────────────────────────────────────────────────────

function Parts({ orgId, job, act, busy, canWork, canIssue, canSource }) {
  const [adding, setAdding] = useState(false);
  const [p, setP] = useState({ name: "", quantity: 1, source: "inventory", itemCode: "", note: "" });
  const parts = job.spareParts ?? [];
  const add = async () => {
    if (await act("part", () => requestPart(orgId, job.id, p),
      p.source === "inventory" ? (canIssue ? "Issued from stores." : "Requested from stores.") : "Requested from ControlTech.")) {
      setAdding(false);
      setP({ name: "", quantity: 1, source: "inventory", itemCode: "", note: "" });
    }
  };
  return (
    <Section title="Spare parts" aside={parts.length ? `${parts.length}` : null}>
      {parts.length === 0 && !adding && <p className="wf-muted">No parts recorded on this ticket.</p>}
      {parts.length > 0 && (
        <ul className="wf-parts">
          {parts.map((part) => {
            const st = PART_STATUS[part.status] ?? { label: part.status, pill: "none" };
            return (
              <li key={part.id} className="wf-part">
                <div className="wf-part__main">
                  <span className="wf-part__name">{part.quantity > 1 ? `${part.quantity} × ` : ""}{part.name}</span>
                  <span className="wf-part__meta">
                    {part.source === "inventory" ? "From stores" : "Via ControlTech"}
                    {part.supplier ? ` · ${part.supplier}` : ""}{part.fsIssueId ? ` · issue ${part.fsIssueId}` : ""}
                    {part.orderRef ? ` · order ${part.orderRef}` : ""}
                  </span>
                </div>
                <span className={`sp4-pill sp4-pill--${st.pill}`}>{st.label}</span>
                <span className="wf-part__acts">
                  {part.status === "requested" && part.source === "inventory" && canIssue && (
                    <button type="button" className="sp4-ghost-btn" disabled={!!busy}
                            onClick={() => act(`issue-${part.id}`, () => issuePart(orgId, job.id, part.id, {}), "Issued from stores.")}>Issue</button>
                  )}
                  {part.status === "requested" && part.source === "controltech" && canSource && (
                    <button type="button" className="sp4-ghost-btn" disabled={!!busy}
                            onClick={() => act(`src-${part.id}`, () => sourcePart(orgId, job.id, part.id, { status: "ordered" }), "Marked ordered.")}>Mark ordered</button>
                  )}
                  {(part.status === "issued" || part.status === "received") && canWork && (
                    <button type="button" className="sp4-ghost-btn" disabled={!!busy}
                            onClick={() => act(`fit-${part.id}`, () => fitPart(orgId, job.id, part.id), "Fitted.")}>Fitted</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {canWork && !job.resolvedAt && (adding ? (
        <div className="wf-form wf-form--inline">
          <Choice label="In stock?" value={p.source} onChange={(source) => setP({ ...p, source })}
                  options={[["inventory", "Yes, from stores"], ["controltech", "No, ControlTech sources it"]]} />
          <div className="wf-row">
            <label className="sp4-field wf-field wf-grow">
              <span className="sp4-label">Part</span>
              <input className="sp4-input" value={p.name} maxLength={200} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </label>
            <label className="sp4-field wf-field wf-qty">
              <span className="sp4-label">Qty</span>
              <input className="sp4-input" type="number" min={1} max={1000} value={p.quantity} onChange={(e) => setP({ ...p, quantity: e.target.value })} />
            </label>
          </div>
          {p.source === "inventory" && (
            <label className="sp4-field wf-field">
              <span className="sp4-label">Stores item code</span>
              <input className="sp4-input" value={p.itemCode} maxLength={100} onChange={(e) => setP({ ...p, itemCode: e.target.value })} />
            </label>
          )}
          <div className="wf-actions">
            <button type="button" className="sp4-ghost-btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="sp4-submit-btn" disabled={!p.name.trim() || !!busy} onClick={add}>
              {busy === "part" ? "Saving…" : p.source === "inventory" ? (canIssue ? "Issue from stores" : "Request from stores") : "Request from ControlTech"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="sp4-ghost-btn wf-add" onClick={() => setAdding(true)}>
          <i className="ti ti-plus" aria-hidden="true" /> Add a part
        </button>
      ))}
    </Section>
  );
}

function WorkLog({ orgId, job, act, busy, canWork }) {
  const [kind, setKind] = useState("repair");
  const [text, setText] = useState("");
  const [mins, setMins] = useState("");
  const entries = job.workEntries ?? [];
  return (
    <Section title="Work log" aside={entries.length ? `${entries.length}` : null}>
      {entries.length === 0 && <p className="wf-muted">Nothing logged yet.</p>}
      {entries.length > 0 && (
        <ol className="wf-log">
          {entries.map((e) => (
            <li key={e.id} className="wf-log__e">
              <span className="wf-log__when">{at(e.at)}</span>
              <span className="wf-log__kind">{WORK_KIND_LABEL[e.kind] ?? e.kind}</span>
              <span className="wf-log__text">{e.text}{e.labourMinutes ? ` · ${e.labourMinutes} min` : ""}</span>
              <span className="wf-log__by">{e.byName ?? ""}</span>
            </li>
          ))}
        </ol>
      )}
      {canWork && !job.resolvedAt && (
        <div className="wf-form wf-form--inline">
          <div className="wf-row">
            <Choice label="Entry" value={kind} onChange={setKind}
                    options={[["diagnosis", "Diagnosis"], ["repair", "Repair"], ["test", "Test"], ["note", "Note"]]} />
            <label className="sp4-field wf-field wf-qty">
              <span className="sp4-label">Minutes</span>
              <input className="sp4-input" type="number" min={0} value={mins} onChange={(e) => setMins(e.target.value)} />
            </label>
          </div>
          <Note label="What was done" value={text} onChange={setText} max={4000} />
          <div className="wf-actions">
            <button type="button" className="sp4-ghost-btn" disabled={!text.trim() || !!busy}
                    onClick={async () => {
                      if (await act("work", () => addWork(orgId, job.id, { kind, text, labourMinutes: mins === "" ? undefined : Number(mins) }), null)) {
                        setText(""); setMins("");
                      }
                    }}>
              {busy === "work" ? "Logging…" : "Log it"}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function DamageRecord({ orgId, job, act, busy, canWork, canSecurity }) {
  const [voiding, setVoiding] = useState(false);
  const [note, setNote] = useState("");
  const [parts, setParts] = useState([]);
  if (!job.damageClass && !job.diagnosis) return null;
  const malicious = job.damageClass === "suspected_malicious";
  return (
    <Section title="Damage and warranty">
      <dl className="wf-facts">
        <Fact label="Damage">{DAMAGE_LABEL[job.damageClass] ?? job.damageClass}</Fact>
        <Fact label="Note">{job.damageNote}</Fact>
        <Fact label="Diagnosis">{job.diagnosis}</Fact>
        <Fact label="Classified">{[job.damageClassifiedByName, job.damageClassifiedAt && at(job.damageClassifiedAt)].filter(Boolean).join(" · ")}</Fact>
        <Fact label="Warranty">
          {job.warrantyVoid
            ? `Void: ${job.warrantyVoidComponents?.length ? job.warrantyVoidComponents.map(componentLabel).join(", ") : "the whole unit"} · ${job.warrantyVoidNote}`
            : malicious ? "Stands" : null}
        </Fact>
        {job.securityInvestigation && (
          <Fact label="Investigation">
            <span className={`sp4-pill sp4-pill--${INVESTIGATION_PILL[job.securityInvestigation.status] ?? "none"}`}>
              {INVESTIGATION_LABEL[job.securityInvestigation.status] ?? job.securityInvestigation.status}
            </span>
          </Fact>
        )}
      </dl>
      {malicious && !job.warrantyVoid && canWork && !job.resolvedAt && (voiding ? (
        <div className="wf-form wf-form--inline">
          {(job.checklist?.length ?? 0) > 0 && (
            <div className="wf-field">
              <span className="sp4-label">Components (none = the whole unit)</span>
              <div className="wf-checks">
                {job.checklist.map((c) => (
                  <label key={c} className="wf-check">
                    <input type="checkbox" checked={parts.includes(c)}
                           onChange={(e) => setParts(e.target.checked ? [...parts, c] : parts.filter((x) => x !== c))} />
                    {componentLabel(c)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Note label="Why the warranty is void" required value={note} onChange={setNote} />
          <div className="wf-actions">
            <button type="button" className="sp4-ghost-btn" onClick={() => setVoiding(false)}>Cancel</button>
            <button type="button" className="sp4-danger-btn" disabled={!note.trim() || !!busy}
                    onClick={async () => { if (await act("wv", () => voidWarranty(orgId, job.id, note, parts), "Warranty marked void.")) setVoiding(false); }}>
              {busy === "wv" ? "Saving…" : "Mark warranty void"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="sp4-ghost-btn wf-add" onClick={() => setVoiding(true)}>Mark warranty void</button>
      ))}
      {job.warrantyVoid && canSecurity && (
        <ReasonButton label="Clear the void" busyLabel="Clearing…" placeholder="Investigation closed: damage was not deliberate"
                      busy={busy === "wc"} onSend={(r) => act("wc", () => clearWarranty(orgId, job.id, r), "Warranty void cleared.")} />
      )}
    </Section>
  );
}

function Trail({ job }) {
  const events = (Array.isArray(job.stageHistory) ? job.stageHistory : []).filter((e) => e?.stage || e?.kind);
  if (events.length === 0) return null;
  return (
    <Section title="Trail">
      <ol className="wf-log wf-log--trail">
        {[...events].reverse().map((e, i) => (
          <li key={i} className="wf-log__e">
            <span className="wf-log__when">{at(e.at)}</span>
            <span className="wf-log__kind">
              {e.stage ? STAGE_LABEL[e.stage] ?? e.stage
                : e.kind === "assignment" ? "Assigned" : e.kind === "assignment_response" ? (e.status === "accepted" ? "Accepted" : "Declined")
                  : e.kind === "escalation" ? "Escalated" : e.kind}
            </span>
            <span className="wf-log__text">{e.note ?? (e.assignedToName ? `to ${e.assignedToName}` : "")}</span>
            <span className="wf-log__by">{e.byName ?? (e.auto ? "Automatic" : "")}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** A plain printable ticket in a new window: the paper the workshop can keep. */
function printTicket(job) {
  const w = window.open("", "_blank", "noopener=no,width=760,height=900");
  if (!w) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>` : "");
  const parts = (job.spareParts ?? []).map((p) => `<tr><td>${esc(p.quantity)} × ${esc(p.name)}</td><td>${esc(p.source === "inventory" ? "Stores" : "ControlTech")}</td><td>${esc(PART_STATUS[p.status]?.label ?? p.status)}</td></tr>`).join("");
  const log = (job.workEntries ?? []).map((e) => `<tr><td>${esc(at(e.at))}</td><td>${esc(WORK_KIND_LABEL[e.kind] ?? e.kind)}</td><td>${esc(e.text)}</td><td>${esc(e.byName)}</td></tr>`).join("");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(job.ticketNo ?? "Repair ticket")}</title>
<style>body{font:13px/1.5 Inter,system-ui,sans-serif;color:#0f172a;margin:32px}h1{font:600 22px 'JetBrains Mono',monospace;margin:0}
p{margin:4px 0 18px;color:#475569}h2{font-size:13px;margin:20px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:3px 10px 3px 0;vertical-align:top}th{color:#475569;font-weight:500;width:160px}</style>
<h1>${esc(job.ticketNo ?? "No ticket number yet")}</h1><p>${esc(job.vehicle?.registrationPlate)} · ${esc(jobLabel(job))} · ${esc(STAGE_LABEL[job.stage] ?? job.stage)}</p>
<h2>Fault</h2><table>${row("Suspected fault", job.suspectedFault ?? job.problemNote)}${row("Flagged", `${job.report?.reportedBy?.fullName ?? ""} · ${at(job.report?.reportedAt)}`)}${row("ControlTech", job.assignedTo?.fullName)}${row("Workshop technician", job.workshopTechnicianName)}${row("Path", PATH_LABEL[job.path])}</table>
<h2>Inspection</h2><table>${row("Damage", DAMAGE_LABEL[job.damageClass])}${row("Damage note", job.damageNote)}${row("Diagnosis", job.diagnosis)}${row("Warranty", job.warrantyVoid ? `Void · ${job.warrantyVoidNote}` : "")}</table>
<h2>Parts</h2><table>${parts || "<tr><td>None</td></tr>"}</table>
<h2>Work</h2><table>${log || "<tr><td>None</td></tr>"}</table>
<h2>Outcome</h2><table>${row("Completed", job.completedAt ? `${job.completedByName ?? ""} · ${at(job.completedAt)}` : "")}${row("What was done", job.fixNote)}${row("Verified", job.verifiedAt ? `${job.verifiedByName ?? ""} · ${at(job.verifiedAt)}` : "")}${row("Final status", STAGE_LABEL[job.stage] ?? job.stage)}</table>`);
  w.document.close();
  w.focus();
  w.print();
}

// ── The panel ───────────────────────────────────────────────────────────────

export default function RepairWorkflowJob({ orgId, itemId, can, userId, onToast }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [assignees, setAssignees] = useState(null);

  const read = useCallback(() => {
    fetchTicket(orgId, itemId).then((t) => { setJob(t); setError(null); }).catch((e) => setError(e?.message || "Could not load the job"));
  }, [orgId, itemId]);
  useEffect(() => {
    read();
    window.addEventListener(REPAIRS_CHANGED, read);
    return () => window.removeEventListener(REPAIRS_CHANGED, read);
  }, [read]);

  if (error) return <p className="wf-muted">{error}</p>;
  if (!job) return <p className="wf-muted">Reading the job…</p>;
  return <JobView orgId={orgId} job={job} can={can} userId={userId} onToast={onToast} onChanged={read}
                  assignees={assignees} setAssignees={setAssignees} />;
}

/** May this person work this job? The server's requireWorkableJob, restated to decide what to draw. */
export function mayWork(job, can, userId) {
  if (!job || !can("repair:resolve")) return false;
  if (can("repair:work_any")) return true;
  if (job.workshopTechnicianId && job.workshopTechnicianId === userId) return true;
  return job.assignedToId === userId && job.assignmentStatus === "accepted";
}

/** The panel for a job already read. Pure of fetching, so it renders in a test. */
export function JobView({ orgId, job, can, userId, onToast, onChanged, assignees = null, setAssignees = () => {} }) {
  const [busy, act] = useAct(onToast, onChanged);
  const canWork = useMemo(() => mayWork(job, can, userId), [job, can, userId]);

  const s = job.stage;
  const next = NEXT_STEP[s] ?? { who: null, what: STAGE_LABEL[s] ?? s };
  const lastAssessment = job.assessments?.at(-1) ?? null;
  const needsBooking = s === "awaiting_assessment" && lastAssessment?.roadworthy;
  const booking = (job.bookings ?? []).filter((b) => b.status === "booked" || b.status === "arrived").at(-1) ?? null;
  const malicious = job.damageClass === "suspected_malicious";

  /** The action for this stage, when this person may take it; else null. */
  let action = null;
  if (s === "pending" && can("repair:flag")) {
    action = (
      <div className="wf-actions">
        <button type="button" className="sp4-submit-btn" disabled={!!busy}
                onClick={() => act("fwd", () => forwardJob(orgId, job.id), "Forwarded.")}>
          {busy === "fwd" ? "Forwarding…" : routeOf(job.faultCategory ?? "fuel_probe") === "controltech" ? "Forward to ControlTech" : "Send to the workshop"}
        </button>
      </div>
    );
  } else if (s === "forwarded" && !job.assignedToId && can("repair:claim")) {
    action = (
      <div className="wf-actions">
        <button type="button" className="sp4-submit-btn" disabled={!!busy}
                onClick={() => act("claim", () => claimJob(orgId, job.id), "Claimed. It is yours.")}>
          {busy === "claim" ? "Claiming…" : "Claim this job"}
        </button>
      </div>
    );
  } else if ((s === "forwarded" || s === "pending") && canWork) {
    action = <PathStep orgId={orgId} job={job} act={act} busy={busy} from={s} />;
  } else if (s === "remote_fix" && canWork) {
    action = (
      <>
        <CompleteStep orgId={orgId} job={job} act={act} busy={busy} />
        <details className="wf-alt"><summary>A remote fix is not possible</summary>
          <PathStep orgId={orgId} job={job} act={act} busy={busy} from="remote_fix" />
        </details>
      </>
    );
  } else if (needsBooking && can("repair:book")) {
    action = (
      <>
        <BookStep orgId={orgId} job={job} act={act} busy={busy} />
        {can("repair:assess") && (
          <details className="wf-alt"><summary>It can no longer be driven: reassess</summary>
            <AssessStep orgId={orgId} job={job} act={act} busy={busy} />
          </details>
        )}
      </>
    );
  } else if (s === "awaiting_assessment" && !needsBooking && can("repair:assess")) {
    action = <AssessStep orgId={orgId} job={job} act={act} busy={busy} />;
  } else if ((s === "booked" || s === "towing") && can("repair:book")) {
    action = (
      <div className="wf-actions">
        {s === "booked" && (
          <ReasonButton label="Cancel booking" busyLabel="Cancelling…" placeholder="Unit needed on the haul today"
                        busy={busy === "cancel"} onSend={(r) => act("cancel", () => cancelBooking(orgId, job.id, r), "Booking cancelled.")} />
        )}
        <button type="button" className="sp4-submit-btn" disabled={!!busy}
                onClick={() => act("arrive", () => arriveJob(orgId, job.id), (t) => `Checked in. Ticket ${t?.ticketNo ?? ""}.`)}>
          {busy === "arrive" ? "Checking in…" : "Unit has arrived: issue the ticket"}
        </button>
      </div>
    );
  } else if ((s === "in_workshop" || s === "field_inspection") && canWork) {
    action = <DamageStep orgId={orgId} job={job} act={act} busy={busy} />;
  } else if (s === "fixing" && canWork) {
    action = <CompleteStep orgId={orgId} job={job} act={act} busy={busy} />;
  } else if (s === "completed" && can("repair:verify")) {
    action = <VerifyStep orgId={orgId} job={job} act={act} busy={busy} isCompleter={job.completedById === userId} />;
  }

  const closed = !!job.resolvedAt;
  const nextWhat = needsBooking ? "Book a workshop day" : next.what;
  const nextWho = needsBooking ? "Control Room" : next.who;

  return (
    <div className="wf-job">
      <header className="wf-job__head">
        <div className="wf-job__id">
          <span className="wf-job__plate">{job.vehicle?.registrationPlate}</span>
          <span className="wf-job__fault">{jobLabel(job)}</span>
        </div>
        {job.ticketNo
          ? <span className="wf-ticket" title="Repair ticket number">{job.ticketNo}</span>
          : <span className="wf-ticket wf-ticket--none">No ticket yet</span>}
      </header>

      <PhaseLadder stage={s} />

      {malicious && (
        <div className="wf-banner" role="note">
          <i className="ti ti-shield-exclamation" aria-hidden="true" />
          <span>
            <b>Suspected malicious damage.</b> Head of Security notified
            {job.securityInvestigation ? ` · investigation ${INVESTIGATION_LABEL[job.securityInvestigation.status]?.toLowerCase()}` : ""}
            {job.warrantyVoid ? " · warranty void" : ""}. The repair continues.
          </span>
        </div>
      )}

      <section className={"wf-next" + (closed ? " wf-next--closed" : "")} aria-label="Next step">
        <div className="wf-next__head">
          <span className={`sp4-pill sp4-pill--${STAGE_PILL[s] ?? "none"}`}>{STAGE_LABEL[s] ?? s}</span>
          {!closed && nextWho && <span className="wf-next__who">Next · {nextWho}</span>}
        </div>
        <p className="wf-next__what">{closed ? (s === "fixed" ? "Verified fixed and available" : next.what) : nextWhat}</p>
        {s === "void" && job.voidReason && <p className="wf-muted">{job.voidReason}</p>}
        {action}
        {!action && !closed && (
          <p className="wf-muted">
            {s === "forwarded" && job.assignedToId ? `Claimed by ${job.assignedTo?.fullName ?? "a technician"}.` : "Waiting on the people above. Nothing for you to do here."}
          </p>
        )}
      </section>

      <Section title="The fault">
        <dl className="wf-facts">
          <Fact label="Suspected fault">{job.suspectedFault ?? job.problemNote}</Fact>
          <Fact label="Flagged">{[job.report?.reportedBy?.fullName, at(job.report?.reportedAt)].filter(Boolean).join(" · ")}</Fact>
          <Fact label="Route">{job.queue === "controltech" ? "ControlTech queue" : job.queue === "workshop" ? "Workshop" : null}</Fact>
          <Fact label="ControlTech">{job.assignedTo?.fullName}</Fact>
          <Fact label="Path">{job.path ? `${PATH_LABEL[job.path]}${job.pathNote ? ` · ${job.pathNote}` : ""}` : null}</Fact>
        </dl>
      </Section>

      {(job.assessments?.length ?? 0) > 0 && (
        <Section title="Assessment">
          <ul className="wf-plain">
            {job.assessments.map((a) => (
              <li key={a.id}>
                <b>{a.roadworthy ? "Roadworthy" : "Not roadworthy"}</b> · {INTERVENTION_LABEL[a.intervention]}
                {a.reason ? ` · ${a.reason}` : ""}
                <span className="wf-muted"> · {a.assessedBy ?? ""} {at(a.assessedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(booking || job.ticketNo || job.workshopTechnicianName) && (
        <Section title="Workshop">
          <dl className="wf-facts">
            <Fact label="Booked">{booking ? `${booking.workshop?.name ?? "Workshop"} · ${dayLabel(booking.bookingDate)}${booking.status === "arrived" ? " · arrived" : ""}` : null}</Fact>
            <Fact label="Ticket">{job.ticketNo ? [job.ticketNo, job.ticketIssuedAt && at(job.ticketIssuedAt)].filter(Boolean).join(" · ") : null}</Fact>
            <Fact label="Technician">{job.workshopTechnicianName}</Fact>
          </dl>
          {job.ticketNo && !closed && can("repair:book") && (
            <WorkshopTech orgId={orgId} job={job} act={act} busy={busy} assignees={assignees} setAssignees={setAssignees} />
          )}
        </Section>
      )}

      <DamageRecord orgId={orgId} job={job} act={act} busy={busy} canWork={canWork} canSecurity={can("security_case:update")} />

      {(job.ticketNo || (job.spareParts?.length ?? 0) > 0) && (
        <Parts orgId={orgId} job={job} act={act} busy={busy}
               canWork={canWork && ["in_workshop", "field_inspection", "fixing", "spare_outsourced"].includes(s)}
               canIssue={can("repair:parts_issue")} canSource={can("repair:parts_source")} />
      )}

      <WorkLog orgId={orgId} job={job} act={act} busy={busy} canWork={canWork} />
      <Trail job={job} />

      <footer className="wf-job__foot">
        <button type="button" className="sp4-ghost-btn" onClick={() => printTicket(job)}>
          <i className="ti ti-printer" aria-hidden="true" /> Print ticket
        </button>
        {!closed && can("repair:verify") && (
          <ReasonButton label="Void this job" busyLabel="Voiding…" tone="danger" placeholder="Raised in error: duplicate of another job"
                        busy={busy === "void"} onSend={(r) => act("void", () => voidJob(orgId, job.id, r), "Job void.")} />
        )}
      </footer>
    </div>
  );
}

function WorkshopTech({ orgId, job, act, busy, assignees, setAssignees }) {
  const [open, setOpen] = useState(false);
  const [techId, setTechId] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (open && assignees === null) fetchAssignees(orgId).then(setAssignees).catch(() => setAssignees([]));
  }, [open, assignees, orgId, setAssignees]);
  if (!open) {
    return (
      <button type="button" className="sp4-ghost-btn wf-add" onClick={() => setOpen(true)}>
        {job.workshopTechnicianName ? "Change technician" : "Assign a technician"}
      </button>
    );
  }
  return (
    <div className="wf-form wf-form--inline">
      <label className="sp4-field wf-field">
        <span className="sp4-label">Technician with an account</span>
        <select className="sp4-input" value={techId} onChange={(e) => setTechId(e.target.value)}>
          <option value="">Not listed</option>
          {(assignees ?? []).map((a) => <option key={a.id} value={a.id}>{a.fullName ?? a.email}</option>)}
        </select>
      </label>
      {!techId && (
        <label className="sp4-field wf-field">
          <span className="sp4-label">Or the mechanic's name</span>
          <input className="sp4-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <div className="wf-actions">
        <button type="button" className="sp4-ghost-btn" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="sp4-submit-btn" disabled={(!techId && !name.trim()) || !!busy}
                onClick={async () => { if (await act("ws", () => assignWorkshop(orgId, job.id, techId ? { technicianId: techId } : { name }), "Technician assigned.")) setOpen(false); }}>
          {busy === "ws" ? "Saving…" : "Assign"}
        </button>
      </div>
    </div>
  );
}
