/**
 * The overhaul audit of one unit's open probe repair, on the Fuel Audit page.
 *
 * Three things a unit waiting on repair needs, in the order they happen:
 *   - who has the job (assign a technician),
 *   - the inspection checklist: each component OK / Faulty / Replaced,
 *   - the spare parts outsourced for the fix, Ordered → Received → Fitted.
 *
 * The job's stage follows its parts on the server (repairs.overhaul): the
 * first order moves it to "Spare outsourced", the last arrival to "Fixing",
 * and it cannot be signed off fixed while a part is outstanding. So nothing
 * here moves the stage by hand; the tracking line above does that, and the
 * sign-off.
 *
 * Every failure goes to the page's toast (`onToast`), as everywhere on Audit.
 */

import { useEffect, useState } from "react";
import OrderSparePartForm, { longDay } from "./OrderSparePartForm";
import {
  INSPECTION_COMPONENTS, INSPECTION_VERDICTS, PART_STATUS,
  assignRepairItem, listRepairAssignees, setRepairInspection, updateRepairSparePart, localDayISO,
} from "../../api/repairs";

const kes = (n) => (n == null ? "—" : `KES ${Number(n).toLocaleString("en-KE")}`);
const day = (v) => (v ? String(v).slice(0, 10) : "—");
// Quick fix dates beside the picker: the usual answers, one tap each.
const FIX_PICKS = [["Today", 0, "Today"], ["+1d", 1, "Tomorrow"], ["+3d", 3, "In 3 days"], ["+1w", 7, "In 1 week"]];


function Assign({ orgId, job, canAssign, onToast, onChanged }) {
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!canAssign) return;
    let live = true;
    listRepairAssignees(orgId).then((p) => { if (live) setPeople(p); }).catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [orgId, canAssign]);

  const pick = async (technicianId) => {
    setBusy(true);
    try {
      await assignRepairItem({ orgId, itemId: job.id, technicianId: technicianId || null });
      onToast({ tone: "ok", text: technicianId ? "Technician assigned." : "Assignment removed." });
      onChanged();
    } catch (e) {
      onToast({ tone: "crit", text: e?.message || "Could not assign this job." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aud-ov-row">
      <span className="sp4-label">Technician</span>
      {canAssign ? (
        <select
          className="sp4-assignment-select aud-ov-select"
          value={job.assignedTo?.id ?? ""}
          disabled={busy || !people}
          onChange={(e) => pick(e.target.value)}
        >
          <option value="">{people ? "Not assigned" : "Loading…"}</option>
          {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </select>
      ) : (
        <span>{job.assignedTo?.fullName ?? "Not assigned yet"}</span>
      )}
    </div>
  );
}

/*
 * One short row per component: its name and a dropdown for the verdict. The
 * note stays out of the way behind "+ Note" (operator, 2026-09-30: the inputs
 * were too long), and a saved note shows as one line under the row.
 */
function Checklist({ orgId, job, inspections, canWork, onToast, onChanged }) {
  const byComponent = Object.fromEntries(inspections.map((i) => [i.component, i]));
  const [editing, setEditing] = useState(null); // component whose note box is open
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(null);

  const save = async (component, verdict, note) => {
    setBusy(component);
    try {
      await setRepairInspection({ orgId, itemId: job.id, component, verdict, note });
      onChanged();
      return true;
    } catch (e) {
      onToast({ tone: "crit", text: e?.message || "Could not save that check." });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openNote = (key) => { setEditing(key); setDraft(byComponent[key]?.note ?? ""); };
  const saveNote = async (key) => {
    const i = byComponent[key];
    if (!i) { onToast({ tone: "warn", text: "Pick a result for this component first, then add the note." }); return; }
    if (await save(key, i.verdict, draft)) setEditing(null);
  };

  const done = inspections.length;
  return (
    <section className="aud-sec">
      <div className="aud-check-head">
        <h3 className="aud-h">Inspection checklist</h3>
        {/* One segment per component, in the checklist's order, coloured by
            its result; the count beside it says the same in words. */}
        <span className="aud-check-meter" aria-hidden="true">
          {INSPECTION_COMPONENTS.map(([key]) => {
            const tone = INSPECTION_VERDICTS.find(([v]) => v === byComponent[key]?.verdict)?.[2];
            return <i key={key} className={tone ? `is-${tone}` : ""} />;
          })}
        </span>
        <span className="aud-check-count">{done} of {INSPECTION_COMPONENTS.length} checked</span>
      </div>
      <ul className="aud-check">
        {INSPECTION_COMPONENTS.map(([key, label]) => {
          const i = byComponent[key];
          const tone = INSPECTION_VERDICTS.find(([v]) => v === i?.verdict)?.[2];
          return (
            <li key={key} className="aud-check-row">
              <span className="aud-check-name">{label}</span>
              {canWork ? (
                <select
                  className={`aud-check-select${tone ? ` aud-check-select--${tone}` : ""}`}
                  aria-label={`${label} result`}
                  value={i?.verdict ?? ""}
                  disabled={busy === key}
                  onChange={(e) => e.target.value && save(key, e.target.value, i?.note)}
                >
                  {!i && <option value="">Not checked</option>}
                  {INSPECTION_VERDICTS.map(([v, vLabel]) => <option key={v} value={v}>{vLabel}</option>)}
                </select>
              ) : (
                <span className={`sp4-pill sp4-pill--${tone ?? "none"}`}>
                  {INSPECTION_VERDICTS.find(([v]) => v === i?.verdict)?.[1] ?? "Not checked"}
                </span>
              )}
              {canWork && editing !== key && (
                <button type="button" className="aud-link" onClick={() => openNote(key)}>
                  {i?.note ? "Edit note" : "+ Note"}
                </button>
              )}
              {editing === key && (
                <div className="aud-check-noteedit">
                  <textarea
                    className="sp4-textarea"
                    autoFocus
                    rows={4}
                    maxLength={1000}
                    value={draft}
                    aria-label={`${label} note`}
                    placeholder={`What was found on the ${label.toLowerCase()}: condition, readings, what was done`}
                    onChange={(e) => setDraft(e.target.value)}
                    // Enter is a new line in a note; Ctrl/Cmd+Enter saves, Escape closes.
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote(key);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <div className="aud-check-notefoot">
                    <span className="sp4-muted">{draft.length}/1000</span>
                    <button type="button" className="sp4-ghost-btn" onClick={() => setEditing(null)} disabled={busy === key}>Cancel</button>
                    <button type="button" className="sp4-submit-btn" onClick={() => saveNote(key)} disabled={busy === key}>
                      {busy === key ? "Saving…" : "Save note"}
                    </button>
                  </div>
                </div>
              )}
              {(i?.note && editing !== key) || i ? (
                <span className="aud-check-meta sp4-muted">
                  {i?.note && editing !== key && <span className="aud-check-notetext">{i.note} · </span>}
                  {i && `${i.inspectedBy ?? "—"}, ${day(i.inspectedAt)}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* A part's journey, as the three steps of its tracking card. */
const PART_STEPS = [
  ["ordered",  "Ordered",  "orderedAt"],
  ["received", "Received", "receivedAt"],
  ["fitted",   "Fitted",   "fittedAt"],
];
const STEP_INDEX = { ordered: 0, received: 1, fitted: 2 };

/** One spare part, tracked: what it is, where it has got to, what is next. */
function PartCard({ p, canWork, busy, collecting, fixDate, setFixDate, onCollect, onCancelCollect, onMove }) {
  const st = PART_STATUS[p.status] ?? { label: p.status, pill: "none" };
  const cancelled = p.status === "cancelled";
  const reached = STEP_INDEX[p.status] ?? -1;
  const late = p.status === "ordered" && p.expectedAt && day(p.expectedAt) < localDayISO();
  return (
    <li className={`aud-part${cancelled ? " aud-part--cancelled" : ""}${late ? " aud-part--late" : ""}`}>
      <div className="aud-part-top">
        <span className="aud-part-name">{p.quantity > 1 && <span className="aud-part-qty">{p.quantity} ×</span>}{p.name}</span>
        <span className={`sp4-pill sp4-pill--${st.pill}`}>{st.label}</span>
      </div>
      <div className="aud-part-facts">
        {p.supplier && <span><i className="ti ti-building-store" aria-hidden="true" />{p.supplier}</span>}
        {p.costKes != null && <span><i className="ti ti-cash" aria-hidden="true" />{kes(p.costKes)}</span>}
        {p.status === "ordered" && p.expectedAt && (
          <span className={late ? "aud-late" : ""}>
            <i className="ti ti-calendar-due" aria-hidden="true" />Due {longDay(p.expectedAt)}{late && " · overdue"}
          </span>
        )}
        {p.fixPlannedAt && p.status !== "cancelled" && (
          <span><i className="ti ti-tool" aria-hidden="true" />Fix {longDay(p.fixPlannedAt)}</span>
        )}
      </div>

      {!cancelled && (
        <ol className="aud-steps" aria-label="Progress">
          {PART_STEPS.map(([key, label, at], idx) => (
            <li key={key} className={`aud-step${idx <= reached ? " aud-step--done" : ""}${idx === reached ? " aud-step--now" : ""}`}>
              <span className="aud-step-dot" aria-hidden="true" />
              <span className="aud-step-label">{label}</span>
              <span className="aud-step-at">{p[at] ? longDay(p[at]) : "—"}</span>
            </li>
          ))}
        </ol>
      )}
      {p.note && <p className="aud-part-note">{p.note}</p>}

      {canWork && collecting && (
        <div className="aud-collect" role="group" aria-label={`Collect ${p.name}`}>
          <div className="aud-collect-head">
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>Collected. When will the fix happen?</span>
          </div>
          {/* One compact row (operator, 2026-10-01): a date-sized input, the
              usual picks beside it, and the buttons on the same line. */}
          <div className="aud-collect-row">
            <input className="sp4-input sp4-input--date aud-collect-date" type="date" min={localDayISO()} value={fixDate}
                   onChange={(e) => setFixDate(e.target.value)} aria-label="Fix date" autoFocus />
            <div className="aud-collect-quick" role="group" aria-label="Quick fix dates">
              {FIX_PICKS.map(([label, n, title]) => {
                const d = localDayISO(n);
                return (
                  <button key={n} type="button" disabled={busy} aria-pressed={fixDate === d}
                          title={title} aria-label={title}
                          className={"sp4-filter-chip aud-collect-chip" + (fixDate === d ? " sp4-filter-chip--on" : "")}
                          onClick={() => setFixDate(d)}>{label}</button>
                );
              })}
            </div>
            <div className="aud-collect-btns">
              <button type="button" className="sp4-ghost-btn" onClick={onCancelCollect} disabled={busy}>Cancel</button>
              <button type="button" className="sp4-submit-btn" disabled={busy || !fixDate}
                      title={fixDate ? undefined : "Pick the fix date first"}
                      onClick={() => onMove(p, "received", fixDate)}>
                {busy ? "Saving…" : "Confirm collected"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canWork && !collecting && (p.status === "ordered" || p.status === "received") && (
        <div className="aud-part-actions">
          {p.status === "ordered" && (
            <button type="button" className="sp4-ghost-btn aud-part-next" disabled={busy} onClick={onCollect}>
              <i className="ti ti-package-import" aria-hidden="true" /> Mark received
            </button>
          )}
          {p.status === "received" && (
            <button type="button" className="sp4-ghost-btn aud-part-next" disabled={busy} onClick={() => onMove(p, "fitted")}>
              <i className="ti ti-circle-check" aria-hidden="true" /> Mark fitted
            </button>
          )}
          <button type="button" className="aud-link aud-link--crit" disabled={busy} onClick={() => onMove(p, "cancelled")}>
            Cancel order
          </button>
        </div>
      )}
    </li>
  );
}

/*
 * The overhaul panel's second column: order a spare part, and track every
 * part ordered for the job (operator, 2026-09-30: "the second column is about
 * making a spare part order and tracking it").
 */
/** The spare-parts column: order one, then track it. Also used by Maintenance > Repairs (RepairJobDetail). */
export function SpareParts({ orgId, job, plate, parts, suppliers, canWork, onToast, onChanged }) {
  const [ordering, setOrdering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(null); // part id
  const [fixDate, setFixDate] = useState("");
  const live = parts.filter((p) => p.status !== "cancelled");
  const total = live.reduce((n, p) => n + (p.costKes ?? 0), 0);
  const outstanding = live.filter((p) => p.status !== "fitted").length;
  // Waiting parts first, then the rest in order placed.
  const order = { ordered: 0, received: 1, fitted: 2, cancelled: 3 };
  const sorted = [...parts].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  const move = async (p, status, date) => {
    setBusy(true);
    try {
      await updateRepairSparePart({ orgId, itemId: job.id, partId: p.id, status, fixDate: date });
      if (status === "received") onToast({ tone: "ok", text: `${p.name} collected. Fix planned for ${longDay(date)}.` });
      if (status === "fitted") onToast({ tone: "ok", text: `${p.name} fitted.` });
      setCollecting(null);
      setFixDate("");
      onChanged();
    } catch (e) {
      onToast({ tone: "crit", text: e?.message || "Could not update that part." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="aud-ov-col aud-ov-col--parts" aria-label="Spare parts">
      <div className="aud-col-head">
        <h3 className="aud-h">Spare parts</h3>
        {live.length > 0 && (
          <span className="aud-col-kpis">
            <span><b>{outstanding}</b> outstanding</span>
            <span><b>{kes(total)}</b></span>
          </span>
        )}
      </div>

      {canWork && !ordering && (
        <button type="button" className="sp4-submit-btn aud-order-btn" onClick={() => setOrdering(true)}>
          <i className="ti ti-plus" aria-hidden="true" />
          Order a spare part
        </button>
      )}
      {canWork && ordering && (
        <OrderSparePartForm
          orgId={orgId}
          job={job}
          plate={plate}
          suppliers={suppliers}
          onCancel={() => setOrdering(false)}
          onDone={() => { setOrdering(false); onChanged(); }}
          onToast={onToast}
        />
      )}

      {parts.length === 0 && !ordering && (
        <div className="aud-parts-empty">
          <i className="ti ti-package" aria-hidden="true" />
          <span>No spare parts ordered for this job yet.</span>
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="aud-parts">
          {sorted.map((p) => (
            <PartCard
              key={p.id}
              p={p}
              canWork={canWork}
              busy={busy}
              collecting={collecting === p.id}
              fixDate={fixDate}
              setFixDate={setFixDate}
              onCollect={() => { setCollecting(p.id); setFixDate(""); }}
              onCancelCollect={() => setCollecting(null)}
              onMove={move}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AuditOverhaul({ orgId, job, plate, overhaul, suppliers = [], canWork, canAssign, onToast, onChanged }) {
  const parts = overhaul?.parts ?? [];
  const inspections = overhaul?.inspections ?? [];
  return (
    <div className="frv-card aud-ov">
      <h3 className="frv-card__t">Overhaul audit</h3>
      <div className="aud-ov-grid">
        {/* Left: the work on the unit. Right: the parts it needs. */}
        <div className="aud-ov-col">
          <Assign orgId={orgId} job={job} canAssign={canAssign} onToast={onToast} onChanged={onChanged} />
          <Checklist orgId={orgId} job={job} inspections={inspections} canWork={canWork} onToast={onToast} onChanged={onChanged} />
        </div>
        <SpareParts orgId={orgId} job={job} plate={plate} parts={parts} suppliers={suppliers} canWork={canWork} onToast={onToast} onChanged={onChanged} />
      </div>
    </div>
  );
}
