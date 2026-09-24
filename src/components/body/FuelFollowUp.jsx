/**
 * Follow-ups on deleted fuel alerts: the case window. See lib/fuelFollowUps for
 * the rules and the store, and screens/SystemScreen for the list.
 *
 * The case window is mounted once, in the header (FuelFollowUpHost), so it can
 * be opened from anywhere — the System screen, the Live Feed, a phone's feed
 * sheet.
 *
 * It is the Repair report dialog's shape, built from the same `sp4-modal`
 * parts: a pinned head with the title and ×, the unit as a `sp4-repair-item`
 * card with outcome chips and a "what you found" box, and a pinned foot with
 * the count of what is missing beside Cancel and the one submit button. Those
 * classes read the `--sp4-*` tokens, which live on `.sp4-root`, so the host
 * wraps the dialog in one (`display: contents`, see FuelFollowUp.css).
 */

import { useEffect, useId, useRef, useState } from "react";
import "./SensorPanel.css";
import "./FuelFollowUp.css";
import { usePermissions } from "../../hooks/usePermissions";
import useFocusTrap from "../../hooks/useFocusTrap";
import {
  ACTION_LABEL, STATUS_LABEL, acceptFollowUp, closeFollowUp, deescalateFollowUp,
  escalateFollowUp, fetchFollowUp, followUpAbilities, noteFollowUp, useOpenFollowUp,
} from "../../lib/fuelFollowUps";

const TZ = "Africa/Nairobi";
const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
export const when = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? WHEN.format(t) : "—";
};
export const litres = (ml) => (ml == null ? "—" : `${(ml / 1000).toFixed(1)} L`);

// The System screen's pill tones, so a follow-up reads the same in both.
const STATUS_PILL = { OPEN: "warn", ACCEPTED: "info", ESCALATED: "inc", DEESCALATED: "con" };

/* The two decisions, as the repair dialog's outcome chips. The chip classes
   borrow the repair outcomes that share their colour: red for a theft, green
   for cleared. */
const DECISIONS = [
  { id: "escalate",   label: "Confirmed theft", chip: "cannot_fix" },
  { id: "deescalate", label: "Not a theft",     chip: "fixed" },
];

/** A readable error from an ApiError, preferring the server's own sentence. */
function errorText(err) {
  if (err?.status === 403 && !err?.message) return "You don't have permission to do that.";
  return err?.message || "That didn't go through. Try again.";
}

/** Why this viewer has no buttons, in one line. */
function whyNot(f, why) {
  if (why === "deleted-it") return "You deleted this alert, so someone else has to accept its follow-up.";
  if (why === "someone-else") return `${f.acceptedBy?.fullName ?? "Someone else"} accepted this follow-up; only they can decide it.`;
  if (why === "no-rights") return "Your role cannot take on fuel follow-ups.";
  return null;
}

// ── The case window ────────────────────────────────────────────────────────

function FollowUpWindow({ id, orgId, canTriage }) {
  const [f, setF] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState(null); // 'escalate' | 'deescalate' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const titleId = useId();
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, true);

  // Load, and reload whenever anyone moves this follow-up (SSE → store event).
  useEffect(() => {
    let live = true;
    const read = () => fetchFollowUp(orgId, id)
      .then((d) => { if (live) { setF(d); setLoadError(null); } })
      .catch((e) => { if (live) setLoadError(errorText(e)); });
    read();
    window.addEventListener("ft-fuel-followup-changed", read);
    return () => { live = false; window.removeEventListener("ft-fuel-followup-changed", read); };
  }, [orgId, id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) closeFollowUp(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy]);

  const can = followUpAbilities(f, canTriage);
  const inc = f?.incident;
  const noteOk = note.trim().length >= 3;

  /* What the one submit button does, and what is still missing before it can.
     The repair dialog's rule: a dead button always has its reason beside it. */
  let submit = null;
  let missing = null;
  if (can.accept) {
    submit = { label: "Accept follow-up", busyLabel: "Accepting…", run: () => acceptFollowUp(orgId, id) };
  } else if (can.act) {
    if (decision === "escalate") {
      submit = { label: "Record confirmed theft", busyLabel: "Saving…", danger: true, run: () => escalateFollowUp(orgId, id, note.trim()) };
    } else if (decision === "deescalate") {
      submit = { label: "Close as not a theft", busyLabel: "Saving…", run: () => deescalateFollowUp(orgId, id, note.trim()) };
    } else {
      submit = { label: "Add note", busyLabel: "Adding…", run: () => noteFollowUp(orgId, id, note.trim()) };
    }
    if (!noteOk) missing = decision ? "Say what you found" : "Write a note, or choose an outcome";
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!submit || missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await submit.run();
      if (next) setF(next);
      setNote("");
      setDecision(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp4-root ffu-scope">
      <div
        className="sp4-modal-overlay"
        role="presentation"
        onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) closeFollowUp(); }}
      >
        <div className="sp4-modal sp4-modal--narrow ffu-modal" ref={dialogRef}
             role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="sp4-modal-head">
            <span className="sp4-repair-title" id={titleId}>Fuel follow-up · 1 alert</span>
            <button type="button" className="sp4-modal-x" onClick={closeFollowUp} disabled={busy}
                    aria-label="Close" title="Close">×</button>
          </div>

          <form className="sp4-repair-form" onSubmit={onSubmit} noValidate>
            <div className="sp4-modal-body">
              {!f && !loadError && <p className="ffu-muted">Loading…</p>}
              {loadError && <div className="sp4-banner sp4-banner--crit" role="alert">{loadError}</div>}

              {f && (
                <>
                  <div className="sp4-repair-item">
                    <div className="sp4-repair-itemhead">
                      <span className="sp4-repair-reg">{inc.plate}</span>
                      <span className="sp4-repair-fault">{litres(inc.volumeMl)} lost · {when(inc.beganAt)}</span>
                      <span className={"sp4-pill sp4-pill--" + (STATUS_PILL[f.status] ?? "none") + " ffu-pill"}>
                        {STATUS_LABEL[f.status] ?? f.status}
                      </span>
                    </div>

                    <dl className="ffu-facts">
                      <div><dt className="sp4-label">Deleted by</dt><dd>{f.dismissedBy?.fullName ?? "—"}</dd></div>
                      <div><dt className="sp4-label">Accepted by</dt><dd>{f.acceptedBy?.fullName ?? "Nobody yet"}</dd></div>
                      <div><dt className="sp4-label">Reported</dt><dd>{when(inc.detectedAt)}</dd></div>
                      {inc.location && <div><dt className="sp4-label">Where</dt><dd>{inc.location}</dd></div>}
                    </dl>

                    {can.act && (
                      <>
                        <div className="sp4-repair-outcomes" role="group" aria-label={`Outcome for ${inc.plate}`}>
                          {DECISIONS.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              className={"sp4-filter-chip sp4-out-chip sp4-out-chip--" + d.chip
                                         + (decision === d.id ? " sp4-out-chip--on" : "")}
                              aria-pressed={decision === d.id}
                              onClick={() => setDecision(decision === d.id ? null : d.id)}
                              disabled={busy}
                            >{d.label}</button>
                          ))}
                        </div>

                        <label className="sp4-field">
                          <span className="sp4-label">
                            {decision ? "What you found" : "Note"}
                          </span>
                          <textarea
                            className="sp4-textarea"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={decision === "escalate"
                              ? "What confirms the theft: who, where, what was checked"
                              : decision === "deescalate"
                                ? "Why it is not a theft: a refuel, a sensor fault, a drain on record"
                                : "What you checked, or who you spoke to"}
                            maxLength={2000}
                            disabled={busy}
                            rows={2}
                          />
                        </label>
                        {missing && decision && <span className="sp4-repair-why">{missing}</span>}
                      </>
                    )}

                    {can.accept && (
                      <span className="ffu-muted">Accepting makes you responsible for deciding this one.</span>
                    )}
                    {!can.accept && !can.act && whyNot(f, can.why) && (
                      <span className="ffu-muted">{whyNot(f, can.why)}</span>
                    )}
                  </div>

                  <div className="sp4-field">
                    <span className="sp4-label">What was done</span>
                    <ol className="ffu-log">
                      {f.actions.map((a) => (
                        <li key={a.id} className={`ffu-log-item ffu-log-item--${a.kind.toLowerCase()}`}>
                          <div className="ffu-log-line">
                            <strong>{a.actor?.fullName ?? "Someone"}</strong> {ACTION_LABEL[a.kind] ?? a.kind}
                            <span className="ffu-log-when">{when(a.at)}</span>
                          </div>
                          {a.note && <p className="ffu-log-note">{a.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </div>
                </>
              )}
            </div>

            <div className="sp4-modal-foot">
              {error && <div className="sp4-banner sp4-banner--crit sp4-modal-err" role="alert">{error}</div>}
              {missing && <span className="sp4-repair-pending">{missing}</span>}
              <button type="button" className="sp4-ghost-btn" onClick={closeFollowUp} disabled={busy}>
                {submit ? "Cancel" : "Close"}
              </button>
              {submit && (
                <button
                  type="submit"
                  className={"sp4-submit-btn" + (submit.danger ? " ffu-submit--danger" : "")}
                  disabled={busy || Boolean(missing)}
                >
                  {busy ? submit.busyLabel : submit.label}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Mount once; renders the case window for whichever follow-up is open. */
export function FuelFollowUpHost() {
  const id = useOpenFollowUp();
  const { orgId, can } = usePermissions();
  if (!id || !orgId) return null;
  return <FollowUpWindow key={id} id={id} orgId={orgId} canTriage={can("fuel_theft:triage")} />;
}
