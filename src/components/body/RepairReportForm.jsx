/**
 * The form a technician fills in after working through a selection.
 *
 * ## A DIALOG, and what had to be built first
 *
 * This was an inline card in its first version, for a stated reason: nothing
 * in this app implemented a focus trap, so a modal would have been a keyboard
 * user's dead end — `UserAdminPanel` turned its own access editor into a row
 * on the same ground. The objection was about the missing trap, not about
 * dialogs, so the trap is now written (`hooks/useFocusTrap.js`) and this is a
 * dialog. It follows `MapOverlay`'s fuel-incident window, which is where the
 * app's overlay grammar already lives: a fixed backdrop, Escape, a click
 * outside, `role="dialog"` and `aria-modal`.
 *
 * What the dialog buys over the card is HEADER AND FOOTER THAT DO NOT SCROLL.
 * A twelve-unit report is taller than the screen, and on the card the submit
 * button and the count of what was still missing were somewhere below the
 * fold — the technician scrolled to find out whether they were finished. Here
 * the list scrolls between them and both stay put.
 *
 * ## ONE FORM, ALWAYS, whichever of the three buttons opened it
 *
 * The button seeds every row's outcome and nothing more. That is what makes
 * the mixed batch work: four fixed, two waiting on a part and one that has to
 * come off the road is one trip, one report and one email, and the two
 * exceptions are two clicks rather than three separate submissions. The
 * alternative — "Fix" submitting straight away and the other two opening a
 * form — would mean the technician has to predict which button costs them a
 * form.
 *
 * ## The spare part is chosen, not typed
 *
 * A free-text box asked every technician to invent a name for the same part,
 * which is how one stores order arrives for a "float sender", a "fuel float"
 * and a "LS5 sender". The list is `api/spareParts.js`, sorted so the parts
 * that serve this unit's failing channel sit at the top — and it can still be
 * escaped by typing, because a catalogue with no way out gets escaped by
 * picking the nearest wrong entry instead. `SparePartPicker` owns both.
 *
 * ## A part on order needs a date, and that is why the field is here
 *
 * `needs_spare` is the one outcome that hands the job to somebody else and
 * then waits. Without a stated end that wait cannot be chased: "outsourced"
 * and "outsourced three weeks ago" are the same row on the Repairs tab, and
 * only the second is anybody's problem. So the date is asked for beside the
 * part — one instruction, "order this, it is wanted by then" — and it is
 * required by the same three-places rule the part itself follows: this
 * predicate, a zod refinement, and a Postgres CHECK.
 *
 * The picker sits in the HEAD beside the batch buttons rather than on each
 * row, and sets every waiting unit at once. One report is one round of the
 * yard and its parts go to one stores on one order, so a date box per row
 * would be the same value typed n times — and on a twelve-unit list it pushed
 * the thing the technician came to do below the fold. Two genuinely different
 * waits cost a second report, which is the rarer case paying the cost.
 *
 * It has no stylesheet of its own, for the reason ProbeHealthPanel gives:
 * every class here is SensorPanel's, and the rules live in SensorPanel.css.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { OUTCOMES, OUTCOME_LABEL, utcTodayISO } from "../../api/repairs";
import { listSpareParts, OTHER_PART } from "../../api/spareParts";
import SparePartPicker from "./SparePartPicker";
import useFocusTrap from "../../hooks/useFocusTrap";

/** What this row will actually send as `sparePart` — a catalogue name, or the
 *  typed one when the technician chose "Other". Blank means "not answered", so
 *  the three predicates below can treat both cases identically. */
function sparePartOf(row) {
  if (row.sparePartId === OTHER_PART) return row.sparePartOther.trim();
  if (!row.sparePartId) return "";
  return listSpareParts().find((p) => p.id === row.sparePartId)?.name ?? "";
}

/** The three predicates zod and Postgres also hold. Kept in one place so the
 *  disabled button and the per-row warning cannot disagree about why. */
function incompleteReason(row) {
  if (!row.outcome) return "Choose an outcome";
  // One message, not two. The old form could reach "chose Other, named
  // nothing" because Other was a choice and the name was a second field;
  // SparePartPicker commits the typed name WITH the choice, so that state no
  // longer exists and a branch for it would be a comment claiming otherwise.
  if (row.outcome === "needs_spare" && !sparePartOf(row)) return "Choose the spare part";
  // Asked for the same outcome as the part and checked immediately after it,
  // so a technician who has answered neither is told about the part first and
  // meets one instruction at a time rather than a list.
  if (row.outcome === "needs_spare" && !row.expectedResolutionAt) return "Set the fix date";
  if (row.outcome === "cannot_fix" && !row.problemNote.trim()) return "Say what stopped the repair";
  return null;
}

export default function RepairReportForm({
  open,
  items,
  defaultOutcome = "fixing",
  busy = false,
  error = "",
  onCancel,
  onSubmit,
}) {
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState("");
  // A long form must not evaporate on a stray click outside it. Arming the
  // discard is the same shape the fuel-incident window uses for Delete.
  const [discarding, setDiscarding] = useState(false);

  const dialogRef = useRef(null);
  const titleId = useId();

  useFocusTrap(dialogRef, open);

  // Re-seed whenever the selection or the button that opened this changes. The
  // key is the item's own key, so a technician who closes the form, deselects
  // one unit and reopens does not carry a stale row back in with them.
  useEffect(() => {
    setRows(items.map((i) => ({
      ...i,
      outcome: defaultOutcome,
      sparePartId: "",
      sparePartOther: "",
      // Deliberately blank rather than defaulted to a fortnight out. A
      // pre-filled estimate is one every technician accepts without reading,
      // which produces a column full of dates nobody stands behind — and a
      // date nobody meant is worse than the empty column this replaced.
      expectedResolutionAt: "",
      problemNote: "",
    })));
    setDiscarding(false);
  }, [items, defaultOutcome]);

  /*
   * Hold the page still behind the backdrop.
   *
   * Without this a wheel over the overlay scrolls the table underneath, so
   * dismissing the dialog reveals a page that has moved — and on the Sensor
   * Monitor the thing that moved is the row the technician is describing.
   */
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const patch = (key, fields) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...fields } : r)));

  const setAll = (outcome) =>
    setRows((prev) => prev.map((r) => ({ ...r, outcome })));

  /*
   * One date for the trip, not one per unit.
   *
   * The state stays per-row — the API and the table are both per-item, and a
   * job that slips is one job — but nothing in this form writes them apart.
   * That is a judgement about the work rather than a shortcut: a technician
   * files one report after one round of the yard, and the parts on it go to
   * the same stores on the same order. Two different waits is a real case and
   * it is a rare one, and it costs a second report rather than a date box on
   * every row of a twelve-unit list.
   */
  const setAllExpected = (value) =>
    setRows((prev) => prev.map((r) => ({ ...r, expectedResolutionAt: value })));

  /* Whether the picker is needed at all, and what it shows. Read off the rows
     rather than held separately, so it cannot drift from what will be sent. */
  const waiting  = rows.filter((r) => r.outcome === "needs_spare");
  const expected = waiting[0]?.expectedResolutionAt ?? "";

  const incomplete = useMemo(
    () => rows.filter((r) => incompleteReason(r) !== null).length,
    [rows],
  );

  /* Anything typed or chosen. Only asked when the dialog is being dismissed,
     so an untouched form still closes on the first Escape. */
  const dirty = useMemo(
    () => note.trim() !== "" || rows.some(
      (r) => r.outcome !== defaultOutcome || r.sparePartId
        || r.sparePartOther.trim() || r.problemNote.trim() || r.expectedResolutionAt,
    ),
    [rows, note, defaultOutcome],
  );

  /** Escape, the backdrop and Cancel all arrive here. */
  function requestClose() {
    if (busy) return;
    if (dirty && !discarding) { setDiscarding(true); return; }
    onCancel?.();
  }

  /* Deliberately un-memoised: `requestClose` closes over `dirty`, `discarding`
     and `busy`, and a dependency array that missed one would arm the discard
     against a form that had since been emptied. Re-binding one listener per
     render is cheaper than that being wrong. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // An open spare-part list stops Escape itself (SparePartPicker's own
      // keydown), so this only ever sees the presses meant for the dialog.
      e.stopPropagation();
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (busy || incomplete > 0 || rows.length === 0) return;
    onSubmit?.({
      note: note.trim(),
      items: rows.map((r) => {
        const spare = sparePartOf(r);
        return {
          targetKind: r.targetKind,
          vehicleId:  r.vehicleId,
          outcome:    r.outcome,
          ...(r.faultEpisodeId ? { faultEpisodeId: r.faultEpisodeId } : {}),
          ...(r.faultKind      ? { faultKind:      r.faultKind }      : {}),
          ...(spare               ? { sparePart:   spare }                 : {}),
          ...(r.problemNote.trim() ? { problemNote: r.problemNote.trim() } : {}),
          /* Only for the outcome that asked for it. A technician who set a
             date and then changed the chip to "Cannot be fixed" is no longer
             looking at the field, and sending a value they can no longer see
             would put a deadline on a job that has none. */
          ...(r.outcome === "needs_spare" && r.expectedResolutionAt
            ? { expectedResolutionAt: r.expectedResolutionAt }
            : {}),
        };
      }),
    });
  }

  if (!open) return null;

  return (
    <div
      className="sp4-modal-overlay"
      role="presentation"
      /* Only a press on the backdrop ITSELF closes — a drag that began inside
         the dialog and released out here must not, which is the bug a plain
         onClick on the overlay always has. */
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        className="sp4-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sp4-modal-head">
          <span className="sp4-repair-title" id={titleId}>
            Repair report · {rows.length} unit{rows.length === 1 ? "" : "s"}
          </span>
          {/* Not in the brief, and the most useful thing here. The mixed batch
              had to be POSSIBLE; the uniform batch will be COMMON, and without
              this it is one click per unit to say the same thing about all.

              Only above one unit, and that is not tidiness. The head is PINNED
              now, so its height is charged against every screen of the list for
              as long as the dialog is open — 78px of a 375px-wide phone, where
              the same three chips sit an inch below in the row itself. "Set all"
              of one thing is the row's own control wearing a second hat. */}
          {rows.length > 1 && (
            <span className="sp4-repair-setall">
              <span className="sp4-label">Set all to</span>
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={"sp4-filter-chip sp4-out-chip sp4-out-chip--" + o}
                  onClick={() => setAll(o)}
                  disabled={busy}
                >{OUTCOME_LABEL[o]}</button>
              ))}
            </span>
          )}
          {/* Beside the batch buttons, and only once something is waiting on a
              part. It is one narrow input with a label and no hint: the head is
              PINNED, so anything added here is charged against every screen of
              the list for as long as the dialog is open, and on a 375px phone
              that budget is already most of what the strip can afford.

              It was briefly pushed to the far right of the head with a
              `margin-left: auto`. Measured at the dialog's own 760px, the
              chips and the title leave 175px there and the group needs 200, so
              it wrapped to a second row and sat mid-head — further from the
              chips it belongs to and no further right. Left where it is.

              NOT gated on `rows.length > 1` the way "Set all to" is. A single
              unit still has to say when its part lands, and the row below has
              no date field any more — this is the only place to say it. */}
          {waiting.length > 0 && (
            <span className="sp4-repair-setall">
              <label className="sp4-label" htmlFor={`${titleId}-eta`}>
                Fix date
              </label>
              {/* `min` is today: an estimate in the past is not an estimate.
                  The server refuses one too — a browser attribute is a
                  courtesy, not a rule. */}
              <input
                id={`${titleId}-eta`}
                type="date"
                className="sp4-input sp4-input--date"
                value={expected}
                min={utcTodayISO()}
                onChange={(e) => setAllExpected(e.target.value)}
                disabled={busy}
                aria-invalid={waiting.some((r) => !r.expectedResolutionAt) || undefined}
              />
            </span>
          )}
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
            <div className="sp4-repair-list">
              {rows.map((r) => {
                const why = incompleteReason(r);

                return (
                  <div className="sp4-repair-item" key={r.key}>
                    <div className="sp4-repair-itemhead">
                      <span className="sp4-repair-reg">{r.plate}</span>
                      <span className="sp4-repair-fault">{r.label}</span>
                    </div>

                    <div className="sp4-repair-outcomes" role="group" aria-label={`Outcome for ${r.plate}`}>
                      {OUTCOMES.map((o) => (
                        <button
                          key={o}
                          type="button"
                          className={"sp4-filter-chip sp4-out-chip sp4-out-chip--" + o
                                     + (r.outcome === o ? " sp4-out-chip--on" : "")}
                          aria-pressed={r.outcome === o}
                          onClick={() => patch(r.key, { outcome: o })}
                          disabled={busy}
                        >{OUTCOME_LABEL[o]}</button>
                      ))}
                    </div>

                    {r.outcome === "needs_spare" && (
                      <div className="sp4-field">
                        <span className="sp4-label" id={`${titleId}-sp-${r.key}`}>
                          Spare part needed
                        </span>
                        <SparePartPicker
                          labelId={`${titleId}-sp-${r.key}`}
                          value={r.sparePartId}
                          otherText={r.sparePartOther}
                          channels={r.channels}
                          disabled={busy}
                          invalid={why === "Choose the spare part"}
                          /* The field appears because the chip was clicked, so
                             the cursor belongs in it — otherwise every
                             technician clicks the chip and then the box. */
                          autoFocus
                          onChange={(fields) => patch(r.key, fields)}
                        />
                      </div>
                    )}

                    <label className="sp4-field">
                      <span className="sp4-label">
                        What you found{r.outcome === "fixing" ? " (optional)" : ""}
                      </span>
                      <textarea
                        className="sp4-textarea"
                        value={r.problemNote}
                        onChange={(e) => patch(r.key, { problemNote: e.target.value })}
                        placeholder={r.outcome === "cannot_fix"
                          ? "What stopped the repair, and what it would take"
                          : "Anything the next person should know"}
                        disabled={busy}
                        rows={2}
                      />
                    </label>

                    {why && <span className="sp4-repair-why">{why}</span>}
                  </div>
                );
              })}
            </div>

            <label className="sp4-field sp4-repair-note">
              <span className="sp4-label">About the trip (optional)</span>
              <textarea
                className="sp4-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Access, weather, why part of the list could not be reached"
                disabled={busy}
                rows={2}
              />
            </label>
          </div>

          <div className="sp4-modal-foot">
            {error && <div className="sp4-banner sp4-banner--crit sp4-modal-err">{error}</div>}

            {discarding ? (
              /* The armed state REPLACES the footer's buttons rather than
                 stacking a second dialog on the first — there is nowhere for
                 a second one to go, and this app has one focus trap. */
              <>
                <span className="sp4-repair-pending">Discard this report?</span>
                <button type="button" className="sp4-ghost-btn" onClick={() => setDiscarding(false)}>
                  Keep editing
                </button>
                <button type="button" className="sp4-danger-btn" onClick={() => onCancel?.()}>
                  Discard
                </button>
              </>
            ) : (
              <>
                {/* A dead button with no reason is the worst thing in a long
                    form, so the count of what is still missing sits beside
                    it. */}
                {incomplete > 0 && (
                  <span className="sp4-repair-pending">
                    {incomplete} unit{incomplete === 1 ? " still needs" : "s still need"} detail
                  </span>
                )}
                <button type="button" className="sp4-ghost-btn" onClick={requestClose} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sp4-submit-btn"
                  disabled={busy || incomplete > 0 || rows.length === 0}
                >
                  {busy ? "Filing…" : "File report"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
