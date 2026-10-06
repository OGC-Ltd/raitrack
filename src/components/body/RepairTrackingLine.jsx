/**
 * Where a repair has got to, drawn as a line rather than said as a word.
 *
 * ## Why a line and not a pill
 *
 * "Needs a spare part" is the outcome that takes a fortnight, and for that
 * fortnight the only honest answers to "what is happening to my unit" are
 * ordered ones: reported, part ordered, being worked on, done. A pill saying
 * `Pending` answers none of them — it says where the job is and nothing about
 * how long it has been there or what it is waiting for. The dates are the
 * point of this component; without them it would be a row of nouns.
 *
 * ## VERTICAL, at every width
 *
 * The recognisable parcel-tracker shape is horizontal, and a horizontal one
 * was the first draft. It was dropped for a measured reason rather than a
 * taste: four rungs with labels under them, at 375px, is 93px per label, and
 * "Spare outsourced" does not fit on one line in 93px. The two escapes are
 * truncation — which hides the stage that matters most — and a breakpoint that
 * flips to vertical, which means two layouts to keep honest for one component.
 * Vertical reads the same at 320 and at 1600, carries the date and the actor
 * on the same row as the stage, and has no width at which it fails.
 *
 * ## Sequential
 *
 * Pending -> Spare outsourced -> Fixing -> Fixed, always all four. Rungs below
 * the job's stage are done, rungs above it are to come (`trackingLine()` in
 * api/repairs.js), and a connector fills only once the rung it leads to is
 * reached, so the line never runs ahead of the job.
 *
 * No stylesheet of its own, for the reason ProbeHealthPanel gives: every class
 * here is SensorPanel's, and the rules live in SensorPanel.css.
 */

import { useMemo, useState } from "react";
import {
  trackingLine, STAGE_LABEL, SETTABLE_STAGES, estimateState, setRepairStage, stageChipState, STAGE_CHIP_CLASS,
} from "../../api/repairs";
import RepairSignOffDialog from "./RepairSignOffDialog";

/** `16 Sep · 14:02`. Local, because the technician reading it is standing in
 *  the yard the unit is in. */
function stamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export default function RepairTrackingLine({
  item,
  /** True when the unit is FAULTY but nothing has been filed against it — the
   *  first rung, which has no row of its own. See trackingLine(). */
  faulty = false,
  orgId,
  canResolve = false,
  onChanged,
  /** Given, errors go here (a page's toast) instead of under the control. */
  onError,
  title = "Repair progress",
}) {
  const nodes = useMemo(
    () => (item || faulty ? trackingLine(item ?? null) : []),
    [item, faulty],
  );

  const progressKey = [
    item?.id ?? "fault",
    item?.stage ?? "pending",
    item?.stageHistory?.length ?? 0,
    item?.stageHistory?.at?.(-1)?.at ?? "",
  ].join(":");

  /* null = closed; "fixed" | "failed" = the dialog, seeded with that verdict.
     The two buttons only CHOOSE which end the dialog opens on — it stays
     changeable in there, because "unsuccessful" is a thing people click and
     then reconsider once they have to write down why. */
  const [marking, setMarking] = useState(null);

  /* The one-click stage move, and the one place it can fail out loud. The
     Repairs tab has a toast for this; here the ladder is the whole component,
     so the message sits under the control that caused it. */
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState(null);

  async function move(stage) {
    if (moving) return;
    setMoving(true);
    setMoveError(null);
    try {
      await setRepairStage({ orgId, itemId: item.id, stage });
      onChanged?.();
    } catch (e) {
      const msg = e?.message ?? "Could not move this job";
      if (onError) onError(msg); else setMoveError(msg);
    } finally {
      setMoving(false);
    }
  }

  /* Only an OPEN job can be closed, and only by somebody holding the grant.
     The server holds both rules too — this just avoids offering a button that
     would come back 403 or 409. */
  const canMark = canResolve && !!item && !item.resolvedAt && !!orgId;

  /*
   * Moving BACK is a normal thing to do, not a correction of a mistake.
   *
   * A job goes to "Fixing" and the part turns out to be the wrong one; the
   * unit goes back to waiting on a spare. The stage is a statement about where
   * the unit is NOW, and if that stops being true it has to be able to stop
   * being true in either direction. The server has always allowed it and the
   * Repairs tab has always offered it — but somebody reading ONE unit's ladder
   * had to leave the unit they were looking at, find it again in a list of
   * jobs, and move it there. Same control, same permission, put where the
   * question is asked.
   *
   * The full settable set is offered, not only the rungs behind: a stage that
   * was skipped is not drawn on the ladder any more (see trackingLine), and a
   * reader who now DOES need a part must still be able to say so.
   */
  const canMove = canMark;

  /*
   * The history only appears when the rails cannot tell the truth alone.
   *
   * A job that went pending -> fixing -> pending -> fixing has FOUR moves and
   * three rungs, and the rails would show the last of each as though the loop
   * never happened. A job that climbed once has nothing extra to say, and a
   * duplicate list under it would be the same four lines twice.
   */
  const loops = useMemo(() => {
    const h = Array.isArray(item?.stageHistory) ? item.stageHistory : [];
    const distinct = new Set(h.map((e) => e?.stage));
    return h.length > distinct.size ? h : null;
  }, [item]);

  /* Computed above the early return so the hook order is unconditional — the
     pending case has no item at all, and `estimateState` answers "—" for it. */
  const estimate = estimateState(item);

  if (!item && !faulty) return null;

  return (
    <section className="sp4-track" aria-label={title}>
      <div className="sp4-track-head">
        <span className="sp4-track-title">{title}</span>
        {/* Optional chaining, not `item.sparePart`: the pending case has no item
            at all, and this header renders for it. */}
        {item?.sparePart && (
          <span className="sp4-track-part">Part: {item.sparePart}</span>
        )}
        {/* The estimate belongs beside the part, here as on the Repairs tab:
            somebody opening one unit's tracking line is asking when it is back,
            and the ladder alone can only say where it got to. Painted only
            once it has slipped — `estimateState` already refuses to call a
            signed-off job overdue. */}
        {estimate.text !== "—" && (
          <span className={"sp4-track-part" + (estimate.overdue ? " sp4-track-part--late" : "")}>
            Fix date: {estimate.text}
          </span>
        )}
      </div>

      <ol className="sp4-track-list" key={progressKey}>
        {nodes.map((n, index) => (
          <li
            key={n.key}
            className={`sp4-track-row sp4-track-row--${n.state} sp4-track-row--${n.tone}${n.passedWithout ? " sp4-track-row--skipped" : ""}`}
            /* The only non-visual signal that this is where the job is. The
               dot and the weight say it to everybody else. */
            {...(n.state === "current" ? { "aria-current": "step" } : {})}
          >
            <span className="sp4-track-rail" aria-hidden="true" style={{ "--track-index": index }}>
              <span className="sp4-track-dot" />
              {index < nodes.length - 1 && (
                /* Filled only when the job has got all the way to the NEXT
                   rung, so the line never runs ahead of the job. */
                <span className={"sp4-track-connector"
                  + (nodes[index + 1].state !== "todo" ? " sp4-track-connector--filled" : "")
                  /* Amber through a stage the job went past without (no spare
                     was outsourced): the line into it and out of it. */
                  + (nodes[index + 1].state !== "todo" && (n.passedWithout || nodes[index + 1].passedWithout)
                    ? " sp4-track-connector--skipped" : "")} />
              )}
            </span>
            <div className="sp4-track-body">
              <div className="sp4-track-name">
                {n.label}
                {n.state === "current" && <span className="sp4-track-now">now</span>}
              </div>
              <div className="sp4-track-blurb">{n.blurb}</div>
              <div className="sp4-track-meta">
                {/* Three states, three different sentences — "not yet" has to
                    be said, because a row with no date beside three rows that
                    have one reads as a date we failed to load. */}
                {n.state === "todo"
                  ? "Not yet"
                  /* Two rungs carry no date, and they are not the same rung —
                     see `implied` and `unreported` in trackingLine(). When the
                     fault STARTED is probe health's question, not this
                     table's, so neither invents one. */
                  : n.unreported
                    ? "Not reported yet"
                    : n.implied
                      ? "Until it was reported"
                      : n.passedWithout
                        ? (n.key === "spare_outsourced" ? "Not needed" : "Not recorded")
                      : [stamp(n.at), n.by].filter(Boolean).join(" · ") || "Recorded"}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {canMove && (
        <div className="sp4-track-move">
          <span className="sp4-track-mark-label">Move this job</span>
          {SETTABLE_STAGES.map((st) => (
            <button
              key={st}
              type="button"
              className={"sp4-filter-chip" + (STAGE_CHIP_CLASS[stageChipState(item, st)] ?? "")}
              aria-pressed={stageChipState(item, st) != null}
              title={stageChipState(item, st) === "skipped" ? "Skipped: went to Fixing without a spare part" : undefined}
              /* The stage it is already on is shown as the answer, not offered
                 as a move — the server treats it as a no-op anyway. */
              disabled={moving || item.stage === st}
              onClick={() => move(st)}
            >{STAGE_LABEL[st]}</button>
          ))}
          {moveError && <span className="sp4-track-move-error" role="alert">{moveError}</span>}
        </div>
      )}

      {canMark && (
        /* The sign-off, reached from the ladder.
           It also lives on the Repairs tab, which is the right place to work
           through six units whose parts arrived on six different days. This is
           the other half: you are looking at ONE unit's ladder and the thing
           you want to do is end it. Same dialog, so there is one sign-off in
           the product rather than one per doorway. */
        <div className="sp4-track-mark">
          <span className="sp4-track-mark-label">Close this job</span>
          <button type="button" className="sp4-ghost-btn"
                  onClick={() => setMarking("fixed")}>
            Mark fixed
          </button>
          <button type="button" className="sp4-ghost-btn sp4-ghost-btn--crit"
                  onClick={() => setMarking("failed")}>
            Mark unsuccessful
          </button>
        </div>
      )}

      <RepairSignOffDialog
        open={marking !== null}
        item={item}
        orgId={orgId}
        initialVerdict={marking ?? "fixed"}
        onClose={() => setMarking(null)}
        onDone={onChanged}
        onError={onError}
      />
    </section>
  );
}
