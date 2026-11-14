/**
 * The unit's work plan, on hover while the map's Work plans switch is on
 * (operator 2026-11-14). It wears the weighbridge card's `.mapcard` block, so
 * the map's hover cards stay one design; the words are lib/workPlanCard's.
 *
 * It hangs from the unit: a pointer at the top centre aims up at the cursor
 * (operator 2026-11-14, "the top middle pointer arrow"). FleetMap places it
 * through `nodeRef` (placeHangingCard): the card's position as a transform,
 * the pointer's offset as `--wpm-tail-x`, and `data-side="above"` on the rare
 * hover with no room underneath, where the card turns over and the pointer
 * goes to its foot. It takes no pointer, so it never comes between the cursor
 * and the map.
 */
import { memo } from "react";
import { planCard } from "../../lib/workPlanCard";
import "./WorkPlansOnMap.css";

/** One row of the card: its label in the left column, its lines on the right. */
function Part({ label, children }) {
  return (
    <div className="mapcard__part">
      <dt className="mapcard__partk">{label}</dt>
      <dd className="mapcard__partv">{children}</dd>
    </div>
  );
}

const Line = ({ children, strong = false, mono = false, warn = false }) => (children
  ? <p className={"mapcard__line" + (strong ? " mapcard__line--main" : "") + (mono ? " mapcard__line--mono" : "") + (warn ? " mapcard__line--warn" : "")}>{children}</p>
  : null);

const WorkPlanHoverCard = memo(function WorkPlanHoverCard({ entry, nodeRef }) {
  const c = planCard(entry);
  const pending = c.status === "Pending";
  return (
    <div ref={nodeRef} className="wpm-hover" data-place="hang" data-side="below" role="tooltip">
      <article className="mapcard mapcard--workplan">
        <header className="mapcard__head">
          <h3 className="mapcard__title">
            {c.machine.code}
            {c.machine.name && <span className="mapcard__titlesub">{c.machine.name}</span>}
          </h3>
          <span className={`mapcard__state mapcard__state--${pending ? "pending" : "approved"}`}>{c.status}</span>
        </header>

        <div className="mapcard__job">
          <Line strong>{c.machine.activity}</Line>
          <Line>{c.machine.expected}</Line>
        </div>

        {c.machine.fuelFigures.length > 0 && (
          <dl className="mapcard__fuel">
            {c.machine.fuelFigures.map((f) => (
              <div key={f.k} className="mapcard__fuelcell">
                <dt className="mapcard__fuelk">{f.k}</dt>
                <dd className="mapcard__fuelv">{f.v}</dd>
              </div>
            ))}
          </dl>
        )}

        <dl className="mapcard__parts">
          <Part label="Plan">
            <p className="mapcard__planhead">
              <span className="mapcard__plancode">{c.plan.code}</span>
              <span className="mapcard__planabout">{c.plan.about}</span>
            </p>
            <Line mono>{c.plan.task}</Line>
            <Line>{c.plan.sent}</Line>
            <Line>{c.plan.decided}</Line>
          </Part>
          <Part label="Where">
            <Line>{c.where.fuelled}</Line>
            <Line>{c.where.works}</Line>
          </Part>
          <Part label="Shift">
            <Line strong>{c.shift.when}</Line>
            <Line>{c.shift.operators}</Line>
            <Line>{c.shift.supervisors}</Line>
          </Part>
          <Part label="At the pump">
            {c.pump.map((p) => <Line key={p}>{p}</Line>)}
          </Part>
        </dl>

        {(c.flags || c.notes) && (
          <footer className="mapcard__foot mapcard__foot--notes">
            {c.flags && <Line warn>{c.flags}</Line>}
            {c.downReason && <Line>{c.downReason}</Line>}
            {c.notes && <Line>Department&apos;s note: {c.notes}</Line>}
          </footer>
        )}
      </article>
    </div>
  );
});

export default WorkPlanHoverCard;
