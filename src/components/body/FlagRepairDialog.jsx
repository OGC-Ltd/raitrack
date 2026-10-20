/**
 * Flag one or more units for repair: the Control Room's step 2.
 *
 * The dialog says where the flag will go BEFORE it is sent: a telematics
 * fault to the ControlTech queue, a mechanical one straight to the workshop
 * for assessment. That one line is the routing rule (repairs.workflow.schema
 * queueFor), restated where the decision is made.
 *
 * The sp4-modal shell and the focus trap RepairSignOffDialog uses.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import useFocusTrap from "../../hooks/useFocusTrap";
import { CATEGORY_GROUPS, CATEGORY_LABEL, fetchFlaggableUnits, flagUnits, routeOf } from "../../api/repairWorkflow";
import "./RepairWorkflow.css";

export default function FlagRepairDialog({ orgId, open, onClose, onFlagged, presetVehicleId = null, presetCategory = "" }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);

  const [units, setUnits] = useState(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(() => (presetVehicleId ? [presetVehicleId] : []));
  const [category, setCategory] = useState(presetCategory);
  const [fault, setFault] = useState("");
  const [queue, setQueue] = useState("workshop");
  const [forward, setForward] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open || units) return;
    fetchFlaggableUnits(orgId).then(setUnits).catch((e) => { setUnits([]); setErr(e?.message || "Could not load the units"); });
  }, [open, orgId, units]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const byId = useMemo(() => new Map((units ?? []).map((u) => [u.id, u])), [units]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (units ?? []).filter((u) => !picked.includes(u.id)
      && (u.registrationPlate.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q))).slice(0, 8);
  }, [units, query, picked]);

  if (!open) return null;
  const route = category ? routeOf(category, queue) : null;
  const ok = picked.length > 0 && category && fault.trim().length > 0;

  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const jobs = await flagUnits(orgId, { vehicleIds: picked, faultCategory: category, suspectedFault: fault, queue: category === "other" ? queue : undefined, forward });
      onFlagged?.(jobs ?? [], route);
      onClose();
    } catch (e) {
      setErr(e?.message || "The flag did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp4-modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className="sp4-modal sp4-modal--narrow wf-flag" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sp4-modal-head">
          <h2 id={titleId} className="sp4-repair-title">Flag for repair</h2>
          <button type="button" className="sp4-modal-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="sp4-modal-body">
          <div className="wf-field">
            <span className="sp4-label">Units</span>
            {picked.length > 0 && (
              <ul className="wf-chips">
                {picked.map((id) => (
                  <li key={id} className="wf-chip">
                    {byId.get(id)?.registrationPlate ?? "Unit"}
                    <button type="button" aria-label={`Remove ${byId.get(id)?.registrationPlate ?? "unit"}`}
                            onClick={() => setPicked(picked.filter((x) => x !== id))}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <input className="sp4-input" placeholder={units ? "Type a plate or unit name" : "Loading units…"} value={query}
                   onChange={(e) => setQuery(e.target.value)} disabled={!units} aria-label="Find a unit" data-autofocus />
            {matches.length > 0 && (
              <ul className="wf-suggest" role="listbox" aria-label="Matching units">
                {matches.map((u) => (
                  <li key={u.id}>
                    <button type="button" role="option" aria-selected="false" onClick={() => { setPicked([...picked, u.id]); setQuery(""); }}>
                      <b>{u.registrationPlate}</b>{u.name && u.name !== u.registrationPlate ? <span> · {u.name}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="wf-field">
            <span className="sp4-label">Fault</span>
            {CATEGORY_GROUPS.map(([group, list]) => (
              <div key={group} className="wf-catgroup">
                <span className="wf-catgroup__name">{group}</span>
                <div className="wf-seg wf-seg--wrap" role="radiogroup" aria-label={`${group} faults`}>
                  {list.map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={category === id}
                            className={"wf-seg__opt" + (category === id ? " wf-seg__opt--on" : "")} onClick={() => setCategory(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {category === "other" && (
            <div className="wf-field">
              <span className="sp4-label">Send to</span>
              <div className="wf-seg" role="radiogroup" aria-label="Send to">
                {[["controltech", "ControlTech"], ["workshop", "Workshop"]].map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={queue === id}
                          className={"wf-seg__opt" + (queue === id ? " wf-seg__opt--on" : "")} onClick={() => setQueue(id)}>{label}</button>
                ))}
              </div>
            </div>
          )}

          <label className="sp4-field wf-field">
            <span className="sp4-label">Suspected fault<span className="wf-req"> required</span></span>
            <textarea className="sp4-textarea" rows={3} maxLength={1000} value={fault} onChange={(e) => setFault(e.target.value)}
                      placeholder="Grinding from the rear axle under load; driver reports pulling left" />
          </label>

          <label className="wf-check">
            <input type="checkbox" checked={forward} onChange={(e) => setForward(e.target.checked)} />
            Forward it now
          </label>

          {route && (
            <p className="wf-route" role="status">
              <i className={`ti ${route === "controltech" ? "ti-router" : "ti-tool"}`} aria-hidden="true" />
              {!forward ? "Recorded as pending; forward it from the job later."
                : route === "controltech"
                  ? `${CATEGORY_LABEL[category]} goes to the ControlTech queue. A technician claims it and decides remote or physical.`
                  : `${CATEGORY_LABEL[category]} goes straight to the workshop. The Control Room assesses whether it can be driven there.`}
            </p>
          )}
        </div>
        <div className="sp4-modal-foot">
          {err && <p className="sp4-modal-err sp4-repair-pending" role="alert">{err}</p>}
          <button type="button" className="sp4-ghost-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sp4-submit-btn" onClick={send} disabled={!ok || busy}>
            {busy ? "Flagging…" : picked.length > 1 ? `Flag ${picked.length} units` : "Flag unit"}
          </button>
        </div>
      </div>
    </div>
  );
}
