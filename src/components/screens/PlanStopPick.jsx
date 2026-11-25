// The other report's Planner plan for a unit on this list too (operator, 2026-11-25: a Van Sales unit added
// to Finished Goods should "custom pick the routes and not even bother the original VS routes"): its stops in
// route order, none ticked; the ones ticked are added to this list's entry only. The other list keeps all of
// its own. Styled as the stops picker's rows (mvr-type).

import { useState } from 'react';

export default function PlanStopPick({ plate, from, here, what, day, choices, has, busy = false, onAdd, onClose }) {
  const [chosen, setChosen] = useState(() => new Set());
  const open = choices.filter((c) => !has(c));
  const flip = (k) => setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const n = chosen.size;
  return (
    <div className="dlv-pick" role="group" aria-label={`Routes from ${plate}'s ${from} plan for ${here}`}>
      <p className="dlv-pick__head">
        <b>{plate}</b>’s {from} {what} of {day}: {choices.length} stop{choices.length === 1 ? '' : 's'}.
        {' '}Tick the ones it delivers for {here}. {from} keeps all of its own.
      </p>
      <div className="drp-quick">
        <button type="button" className="drp-chip" disabled={!open.length || open.every((c) => chosen.has(c.key))}
                onClick={() => setChosen(new Set(open.map((c) => c.key)))}>All</button>
        <button type="button" className="drp-chip" disabled={!n} onClick={() => setChosen(new Set())}>Clear</button>
      </div>
      <ol className="mvr-types__list dlv-pick__list">
        {choices.map((c, i) => {
          const on = has(c);
          const ticked = on || chosen.has(c.key);
          return (
            <li key={c.key}>
              <button type="button" role="menuitemcheckbox" aria-checked={ticked} disabled={on || busy}
                      className={`mvr-type${ticked ? ' mvr-type--on' : ''}`} onClick={() => flip(c.key)}
                      title={on ? `Already on ${here}` : c.label}>
                <span className="mvr-type__box" aria-hidden="true"><i className="ti ti-check" /></span>
                <span className="mvr-type__n dlv-pick__seq">{i + 1}</span>
                <span className="mvr-type__name">{c.label}{c.pin ? ' (point)' : ''}</span>
                {on && <span className="mvr-type__n">on {here}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="dlv-pick__foot">
        <button type="button" className="sp4-ghost-btn" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="sp4-submit-btn" disabled={!n || busy}
                onClick={() => onAdd(choices.filter((c) => chosen.has(c.key)).map((c) => c.key))}>
          {busy ? 'Adding…' : n ? `Add ${n} stop${n === 1 ? '' : 's'} to ${here}` : 'Tick the stops to add'}
        </button>
      </div>
    </div>
  );
}
