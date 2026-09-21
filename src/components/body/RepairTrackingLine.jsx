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
 * ## Reached is read out of the history
 *
 * Never inferred from position — see `trackingLine()` in api/repairs.js. A job
 * filed as "Fixing" was never pending, and ticking off the two rungs below it
 * would invent a past the unit did not have.
 *
 * No stylesheet of its own, for the reason ProbeHealthPanel gives: every class
 * here is SensorPanel's, and the rules live in SensorPanel.css.
 */

import { useMemo, useState } from "react";
import { trackingLine, STAGE_LABEL, estimateState } from "../../api/repairs";
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

  /* Only an OPEN job can be closed, and only by somebody holding the grant.
     The server holds both rules too — this just avoids offering a button that
     would come back 403 or 409. */
  const canMark = canResolve && !!item && !item.resolvedAt && !!orgId;

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
            className={`sp4-track-row sp4-track-row--${n.state} sp4-track-row--${n.tone}`}
            /* The only non-visual signal that this is where the job is. The
               dot and the weight say it to everybody else. */
            {...(n.state === "current" ? { "aria-current": "step" } : {})}
          >
            <span className="sp4-track-rail" aria-hidden="true" style={{ "--track-index": index }}>
              <span className="sp4-track-dot" />
              {index < nodes.length - 1 && (
                <span className={"sp4-track-connector" + (n.state === "done" ? " sp4-track-connector--filled" : "")} />
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
                      : [stamp(n.at), n.by].filter(Boolean).join(" · ") || "Recorded"}
              </div>
              {n.note && !n.auto && <p className="sp4-track-note">{n.note}</p>}
            </div>
          </li>
        ))}
      </ol>

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
      />
    </section>
  );
}
