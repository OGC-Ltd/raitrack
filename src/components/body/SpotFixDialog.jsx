/**
 * Fixed on the spot: the technician's short road through the workflow.
 *
 * A technician on a round who fixed the unit there and then has nothing for
 * triage or assessment to decide, so those are skipped. The job is still
 * ticketed, and still waits for the Control Room's verification by someone
 * else. The one condition is the store question asked first: a spare taken
 * from stores is accounted for through the full flow, so "Yes" turns the
 * dialog into a pointer at Flag for repair instead of a form.
 *
 * The sp4-modal shell and the focus trap FlagRepairDialog uses.
 */

import { useEffect, useId, useRef, useState } from "react";
import useFocusTrap from "../../hooks/useFocusTrap";
import { spotFix } from "../../api/repairWorkflow";
import "./RepairWorkflow.css";

export default function SpotFixDialog({ orgId, open, unit, onClose, onDone, onFlagInstead }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);

  const [store, setStore] = useState(null);
  const [wrong, setWrong] = useState("");
  const [done, setDone] = useState("");
  const [test, setTest] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || !unit) return null;
  const ok = store === false && wrong.trim() && done.trim();

  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const jobs = await spotFix(orgId, {
        vehicleIds: [unit.vehicleId], faultCategory: "fuel_probe", suspectedFault: wrong, fixNote: done,
        testNote: test, labourMinutes: minutes, storePartTaken: false,
      });
      onDone?.(jobs ?? []);
      onClose();
    } catch (e) {
      setErr(e?.message || "The fix was not recorded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp4-modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className="sp4-modal sp4-modal--narrow wf-flag" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sp4-modal-head">
          <h2 id={titleId} className="sp4-repair-title">Fixed on the spot · {unit.plate}</h2>
          <button type="button" className="sp4-modal-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="sp4-modal-body">
          <div className="wf-field">
            <span className="sp4-label">Did you take a spare part from stores?</span>
            <div className="wf-seg" role="radiogroup" aria-label="Spare part from stores">
              {[[false, "No"], [true, "Yes"]].map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={store === v} data-autofocus={v === false ? true : undefined}
                        className={"wf-seg__opt" + (store === v ? " wf-seg__opt--on" : "")} onClick={() => setStore(v)}>{label}</button>
              ))}
            </div>
          </div>

          {store === true && (
            <p className="wf-route" role="status">
              <i className="ti ti-package" aria-hidden="true" />
              A part from stores goes through the full flow, so it is accounted for. Flag the unit for repair instead.
            </p>
          )}

          {store === false && (
            <>
              <label className="sp4-field wf-field">
                <span className="sp4-label">What was wrong<span className="wf-req"> required</span></span>
                <textarea className="sp4-textarea" rows={2} maxLength={1000} value={wrong} onChange={(e) => setWrong(e.target.value)}
                          placeholder="Probe cable unplugged at the tank" />
              </label>
              <label className="sp4-field wf-field">
                <span className="sp4-label">What you did<span className="wf-req"> required</span></span>
                <textarea className="sp4-textarea" rows={2} maxLength={2000} value={done} onChange={(e) => setDone(e.target.value)}
                          placeholder="Reconnected and sealed the plug" />
              </label>
              <div className="wf-row">
                <label className="sp4-field wf-field wf-grow">
                  <span className="sp4-label">How you tested it</span>
                  <input className="sp4-input" maxLength={1000} value={test} onChange={(e) => setTest(e.target.value)}
                         placeholder="Level moves on the live feed" />
                </label>
                <label className="sp4-field wf-field wf-qty">
                  <span className="sp4-label">Minutes</span>
                  <input className="sp4-input" type="number" min={0} max={10000} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </label>
              </div>
              <p className="wf-route" role="status">
                <i className="ti ti-circle-check" aria-hidden="true" />
                Skips triage and assessment. The job gets a ticket and waits for the Control Room to verify it.
              </p>
            </>
          )}
        </div>
        <div className="sp4-modal-foot">
          {err && <p className="sp4-modal-err sp4-repair-pending" role="alert">{err}</p>}
          <button type="button" className="sp4-ghost-btn" onClick={onClose} disabled={busy}>Cancel</button>
          {store === true
            ? <button type="button" className="sp4-submit-btn" onClick={() => { onClose(); onFlagInstead?.(); }}>Flag for repair</button>
            : (
              <button type="button" className="sp4-submit-btn" onClick={send} disabled={!ok || busy}>
                {busy ? "Saving…" : "Record and send to verify"}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
