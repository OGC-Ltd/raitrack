/**
 * Ending one repair job — the dialog, and the only place it is done.
 *
 * ## ONE COMPONENT, TWO DOORS
 *
 * A job can be closed from two places, and that is deliberate: the Repairs tab
 * is where somebody works through six units whose parts arrived on six
 * different days, and the tracking line in a unit's detail panel is where
 * somebody looking at ONE ladder wants to end it. Both were growing their own
 * form — two note fields, two resolve calls, two ideas of whether the
 * recommendation was worth asking for. This is that form, once.
 *
 * ## A DIALOG, not an inline card
 *
 * Both callers previously opened a card in the flow of a table, which is what
 * this app did before it had a focus trap (`hooks/useFocusTrap.js`) and a
 * modal grammar. It has both now — `RepairReportForm` moved for the same
 * reason — so the sign-off follows them rather than being the last inline
 * survivor. What the dialog buys here specifically: the note is the whole
 * point of the sign-off, and a textarea in a table row is a textarea people
 * type four words into.
 *
 * ## The verdict is a choice, not two buttons that submit
 *
 * The caller seeds it, because the caller knows which button was pressed. It
 * stays changeable inside the dialog: "mark unsuccessful" is a thing people
 * click and then reconsider once they have to write down why, and making them
 * close the dialog to change their mind would lose the sentence they had
 * already written.
 *
 * No stylesheet of its own, for the reason ProbeHealthPanel gives: every class
 * here is SensorPanel's, and the rules live in SensorPanel.css.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { resolveRepairItem, STAGE_LABEL } from "../../api/repairs";
import useFocusTrap from "../../hooks/useFocusTrap";
import PanelPortal from "./PanelPortal";

/** The two ends of the ladder, and what each one asks for. */
const VERDICTS = [
  {
    id: "fixed",
    chip: STAGE_LABEL.fixed,
    label: "What you did",
    placeholder: "The fix, in enough detail for whoever meets this unit next",
    submit: "Mark fixed",
  },
  {
    id: "failed",
    chip: STAGE_LABEL.failed,
    label: "What stopped the repair",
    placeholder: "Why it could not be repaired, and what happens to the unit now",
    submit: "Mark unsuccessful",
  },
];

export default function RepairSignOffDialog({
  open,
  item,
  orgId,
  initialVerdict = "fixed",
  onClose,
  onDone,
  /** Given, errors go here (a page's toast) instead of the banner in the dialog. */
  onError,
}) {
  const [verdict, setVerdict] = useState(initialVerdict);
  const [note,    setNote]    = useState("");
  const [rec,     setRec]     = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");
  // A written note must not evaporate on a stray click outside. Same shape the
  // report dialog uses, and the same reason.
  const [discarding, setDiscarding] = useState(false);

  const dialogRef = useRef(null);
  const titleId = useId();

  // The dialog mounts a render late (PanelPortal finds its host first), so
  // the trap waits for the node rather than arming on an empty ref.
  const [mounted, setMounted] = useState(false);
  const setDialog = useCallback((el) => { dialogRef.current = el; setMounted(Boolean(el)); }, []);
  useFocusTrap(dialogRef, open && mounted);

  // Re-seed on every opening, so a cancelled sign-off does not carry its note
  // into the next unit.
  useEffect(() => {
    if (!open) return;
    setVerdict(initialVerdict);
    setNote("");
    setRec("");
    setErr("");
    setDiscarding(false);
  }, [open, initialVerdict, item?.id]);

  /* Hold the page still behind the backdrop — without it a wheel over the
     overlay scrolls the table underneath, and dismissing reveals a page that
     has moved. */
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const dirty = note.trim() !== "" || rec.trim() !== "";

  function requestClose() {
    if (busy) return;
    if (dirty && !discarding) { setDiscarding(true); return; }
    onClose?.();
  }

  /* Deliberately un-memoised: this closes over `dirty`, `discarding` and
     `busy`, and a stale listener would arm a discard against a form that had
     since been emptied. One listener per render is cheaper than that. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy || !note.trim() || !item?.id) return;
    setBusy(true);
    setErr("");
    try {
      await resolveRepairItem({
        orgId,
        itemId: item.id,
        fixNote: note.trim(),
        recommendation: rec.trim(),
        verdict,
      });
      onDone?.();
      onClose?.();
    } catch (e2) {
      // Stays open on failure, with the note intact. A 409 here means somebody
      // else closed it first, and throwing the sentence away would be the
      // second loss in a row.
      const msg = e2?.message ?? "Could not close this job";
      if (onError) onError(msg); else setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open || !item) return null;

  const v = VERDICTS.find((x) => x.id === verdict) ?? VERDICTS[0];
  const plate = item.vehicle?.registrationPlate ?? item.plate ?? "this unit";

  return (
    <PanelPortal>
    <div
      className="sp4-modal-overlay"
      role="presentation"
      /* Only a press on the backdrop ITSELF closes — a drag that began inside
         the dialog and released out here must not. */
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        className="sp4-modal sp4-modal--narrow"
        ref={setDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sp4-modal-head">
          <span className="sp4-repair-title" id={titleId}>
            Close this job · {plate}
          </span>
          <button
            type="button"
            className="sp4-modal-x"
            onClick={requestClose}
            disabled={busy}
            aria-label="Close"
            title="Close"
          >×</button>
        </div>

        <form className="sp4-repair-form" onSubmit={handleSubmit} noValidate>
          <div className="sp4-modal-body">
            <div className="sp4-field">
              <span className="sp4-label">How it ended</span>
              <div className="sp4-repair-outcomes" role="group" aria-label="How it ended">
                {VERDICTS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className={"sp4-filter-chip sp4-out-chip sp4-out-chip--" + x.id
                               + (verdict === x.id ? " sp4-out-chip--on" : "")}
                    aria-pressed={verdict === x.id}
                    onClick={() => setVerdict(x.id)}
                    disabled={busy}
                  >{x.chip}</button>
                ))}
              </div>
            </div>

            <label className="sp4-field">
              {/* Required, and the reason the dialog exists: a verdict with no
                  account of what was done is a status change, not a record. */}
              <span className="sp4-label">{v.label}</span>
              <textarea
                className="sp4-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={v.placeholder}
                disabled={busy}
                rows={3}
                /* Not React's `autoFocus`: the focus trap moves focus on open
                   and would take it straight back to the close ×. This is the
                   attribute it looks for — see useFocusTrap. */
                data-autofocus
                required
              />
            </label>

            <label className="sp4-field">
              <span className="sp4-label">Recommendations (optional)</span>
              <textarea
                className="sp4-textarea"
                value={rec}
                onChange={(e) => setRec(e.target.value)}
                placeholder="What would stop this happening again"
                disabled={busy}
                rows={2}
              />
            </label>

            {item.sparePart && (
              <p className="sp4-repair-fault">Part on this job: {item.sparePart}</p>
            )}

            {err && <div className="sp4-banner sp4-banner--crit">{err}</div>}
          </div>

          <div className="sp4-modal-foot">
            {discarding ? (
              <>
                <span className="sp4-repair-pending">Discard what you have written?</span>
                <button type="button" className="sp4-ghost-btn"
                        onClick={() => setDiscarding(false)} disabled={busy}>
                  Keep writing
                </button>
                <button type="button" className="sp4-act-btn sp4-act-btn--crit"
                        onClick={() => onClose?.()} disabled={busy}>
                  Discard
                </button>
              </>
            ) : (
              <>
                {!note.trim() && (
                  <span className="sp4-repair-pending">{v.label} is required</span>
                )}
                <button type="button" className="sp4-ghost-btn"
                        onClick={requestClose} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="sp4-submit-btn"
                        disabled={busy || !note.trim()}>
                  {busy ? "Closing…" : v.submit}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
    </PanelPortal>
  );
}
