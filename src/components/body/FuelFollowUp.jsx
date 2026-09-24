/**
 * Follow-ups on deleted fuel alerts: the case window and the map button that
 * lists them. See lib/fuelFollowUps for the rules and the store.
 *
 * The case window is mounted once, in the header (FuelFollowUpHost), so it can
 * be opened from anywhere — the map button, the Live Feed, a phone's feed
 * sheet — including by a technician, whose screens have no map.
 */

import { useEffect, useId, useRef, useState } from "react";
import "./FuelFollowUp.css";
import { usePermissions } from "../../hooks/usePermissions";
import {
  ACTION_LABEL, STATUS_LABEL, acceptFollowUp, closeFollowUp, deescalateFollowUp,
  escalateFollowUp, fetchFollowUp, followUpAbilities, noteFollowUp, openFollowUp,
  useFollowUps, useOpenFollowUp,
} from "../../lib/fuelFollowUps";

const TZ = "Africa/Nairobi";
const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const when = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? WHEN.format(t) : "—";
};
const litres = (ml) => (ml == null ? "—" : `${(ml / 1000).toFixed(1)} L`);

const WHY_NOT = {
  "deleted-it":   "You deleted this alert, so someone else has to accept its follow-up.",
  "someone-else": null, // filled with the owner's name below
  "no-rights":    "Your role cannot take on fuel follow-ups.",
  closed:         null,
};

/** A readable error from an ApiError, preferring the server's own sentence. */
function errorText(err) {
  if (err?.status === 403 && !err?.message) return "You don't have permission to do that.";
  return err?.message || "That didn't go through. Try again.";
}

function StatusChip({ status }) {
  return <span className={`ffu-chip ffu-chip--${status?.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>;
}

// ── The case window ────────────────────────────────────────────────────────

function FollowUpWindow({ id, orgId, canTriage }) {
  const [f, setF] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null); // 'escalate' | 'deescalate'
  const titleId = useId();
  const dialogRef = useRef(null);

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
    const onKey = (e) => { if (e.key === "Escape") closeFollowUp(); };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const can = followUpAbilities(f, canTriage);

  const run = async (kind, fn) => {
    setBusy(kind);
    setError(null);
    try {
      const next = await fn();
      if (next) setF(next);
      if (kind !== "accept") setNote("");
      setConfirming(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const noteOk = note.trim().length >= 3;
  const inc = f?.incident;

  return (
    <div className="ffu-overlay" role="presentation"
         onMouseDown={(e) => { if (e.target === e.currentTarget) closeFollowUp(); }}>
      <div className="ffu-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
           tabIndex={-1} ref={dialogRef}>
        <div className="ffu-bar">
          <span className="ffu-title" id={titleId}>Follow-up · {inc?.plate ?? "…"}</span>
          {f && <StatusChip status={f.status} />}
          <button type="button" className="ffu-x" onClick={closeFollowUp} aria-label="Close">✕</button>
        </div>

        <div className="ffu-body">
          {!f && !loadError && <p className="ffu-muted">Loading…</p>}
          {loadError && <p className="ffu-error" role="alert">{loadError}</p>}

          {f && (
            <>
              <dl className="ffu-facts">
                <div><dt>Volume</dt><dd>{litres(inc.volumeMl)}</dd></div>
                <div><dt>Happened</dt><dd>{when(inc.beganAt)}</dd></div>
                <div><dt>Reported</dt><dd>{when(inc.detectedAt)}</dd></div>
                <div><dt>Deleted by</dt><dd>{f.dismissedBy?.fullName ?? "—"}</dd></div>
                <div><dt>Accepted by</dt><dd>{f.acceptedBy?.fullName ?? "Nobody yet"}</dd></div>
                {inc.location && <div className="ffu-wide"><dt>Where</dt><dd>{inc.location}</dd></div>}
              </dl>

              <h3 className="ffu-h">What was done</h3>
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

              {error && <p className="ffu-error" role="alert">{error}</p>}

              {can.accept && (
                <div className="ffu-actions">
                  <p className="ffu-muted">Accepting makes you responsible for deciding this one.</p>
                  <button type="button" className="ffu-btn ffu-btn--primary"
                          disabled={busy != null}
                          onClick={() => run("accept", () => acceptFollowUp(orgId, id))}>
                    {busy === "accept" ? "Accepting…" : "Accept follow-up"}
                  </button>
                </div>
              )}

              {can.act && (
                <div className="ffu-actions">
                  <label className="ffu-label" htmlFor={`${titleId}-note`}>
                    {confirming ? "Reason for the decision (required)" : "Note or reason"}
                  </label>
                  <textarea id={`${titleId}-note`} className="ffu-note" rows={3} maxLength={2000}
                            value={note} onChange={(e) => setNote(e.target.value)}
                            placeholder="What did you find? Who did you speak to?" />
                  {confirming ? (
                    <div className="ffu-row">
                      <span className="ffu-confirm-text">
                        {confirming === "escalate"
                          ? "Record this as a CONFIRMED THEFT?"
                          : "Close this as NOT a theft?"}
                      </span>
                      <button type="button" className="ffu-btn" onClick={() => setConfirming(null)} disabled={busy != null}>Back</button>
                      <button type="button"
                              className={`ffu-btn ${confirming === "escalate" ? "ffu-btn--danger" : "ffu-btn--primary"}`}
                              disabled={!noteOk || busy != null}
                              onClick={() => run(confirming, () => (confirming === "escalate"
                                ? escalateFollowUp(orgId, id, note.trim())
                                : deescalateFollowUp(orgId, id, note.trim())))}>
                        {busy === confirming ? "Saving…" : "Confirm"}
                      </button>
                    </div>
                  ) : (
                    <div className="ffu-row">
                      <button type="button" className="ffu-btn" disabled={!noteOk || busy != null}
                              onClick={() => run("note", () => noteFollowUp(orgId, id, note.trim()))}>
                        {busy === "note" ? "Adding…" : "Add note"}
                      </button>
                      <span className="ffu-spacer" />
                      <button type="button" className="ffu-btn" disabled={busy != null}
                              onClick={() => setConfirming("deescalate")}>De-escalate</button>
                      <button type="button" className="ffu-btn ffu-btn--danger" disabled={busy != null}
                              onClick={() => setConfirming("escalate")}>Escalate: confirmed theft</button>
                    </div>
                  )}
                  {!noteOk && confirming && <p className="ffu-muted">A reason is required: give at least a few words.</p>}
                </div>
              )}

              {!can.accept && !can.act && can.why && can.why !== "closed" && (
                <p className="ffu-muted">
                  {can.why === "someone-else"
                    ? `${f.acceptedBy?.fullName ?? "Someone else"} accepted this follow-up; only they can decide it.`
                    : WHY_NOT[can.why]}
                </p>
              )}
            </>
          )}
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

// ── The map button ─────────────────────────────────────────────────────────

function CaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5h6V7H9zM8.5 12l2.2 2.2L15.5 9.5M8.5 17.5h7" />
    </svg>
  );
}

/**
 * The organisation's outstanding follow-ups, behind one button. Like the fuel
 * alerts button beside it, it is not there at all when there is nothing to do
 * or the viewer has no case rights.
 */
export default function FuelFollowUpsMenu() {
  const { orgId, can } = usePermissions();
  const canTriage = can("fuel_theft:triage");
  const { items } = useFollowUps(orgId, canTriage);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canTriage || items.length === 0) return null;
  const waiting = items.filter((f) => f.status === "OPEN").length;

  return (
    <div className="fuel-alerts ffu-menu" ref={wrapRef}>
      <button type="button"
              className={`map-cam-btn fuel-alerts__btn ffu-menu__btn${open ? " fuel-alerts__btn--open" : ""}`}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open} aria-controls={panelId}
              aria-label={`Fuel follow-ups, ${items.length} outstanding, ${waiting} waiting to be accepted`}
              title="Fuel follow-ups">
        <CaseIcon />
        <span className="fuel-alerts__count ffu-menu__count" data-digits={String(items.length).length}>{items.length}</span>
      </button>

      {open && (
        <div className="fuel-alerts__panel ffu-menu__panel" id={panelId} role="group" aria-label="Fuel follow-ups">
          <div className="fuel-alerts__head">
            <span className="fuel-alerts__title">Fuel follow-ups</span>
            <span className="ffu-muted">{waiting} waiting</span>
          </div>
          <div className="fuel-alerts__list">
            {items.map((f) => (
              <button type="button" key={f.id} className="ffu-menu__row"
                      onClick={() => { setOpen(false); openFollowUp(f.id); }}>
                <span className="ffu-menu__plate">{f.incident.plate}</span>
                <span className="ffu-menu__vol">{litres(f.incident.volumeMl)}</span>
                <StatusChip status={f.status} />
                <span className="ffu-menu__who">
                  {f.status === "OPEN"
                    ? `Deleted by ${f.dismissedBy?.fullName ?? "—"} · ${when(f.openedAt)}`
                    : `With ${f.acceptedBy?.fullName ?? "—"} · since ${when(f.acceptedAt)}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
