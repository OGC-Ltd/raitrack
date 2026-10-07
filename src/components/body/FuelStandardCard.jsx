/**
 * Analytics › Fuel against standard — the dashboard's view of the fuel
 * performance review (Fuel › Report › Fleet review): the units burning most
 * over their standard, the benchmarks, and the share of fuel above standard,
 * over the page's own window. Selecting it opens the full review.
 *
 * Drawn only when the review judged at least one unit: an org with no
 * standards on its register (only Kasulu has the FactorySuite machine
 * register today) has nothing to say here, and the page hides empty cards.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPerformanceReviewForCompany } from "../../api/fuelReview";
import { readReview, pct, litres, band } from "../../lib/performanceReview";
import "./FuelStandardCard.css";

const DAY = 86_400_000;
const EAT = 3 * 3_600_000;
const keyOf = (ms) => new Date(ms + EAT).toISOString().slice(0, 10);

/** The page's window — `days` ending `to` (an ISO noon) or today — as fleet-day keys. */
export function reviewWindow(days, to) {
  const end = to ? to.slice(0, 10) : keyOf(Date.now());
  const from = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  return { from, to: end };
}

function Row({ u }) {
  return (
    <li className="fsc-row" title={`${u.name}: median refill ${pct(u.ratio)} of standard over ${u.usableRefills} refills`}>
      <span className="fsc-row__ref">{u.ref}</span>
      <span className="fsc-row__track">
        <span className="fsc-row__std" aria-hidden="true" />
        <span className={`fsc-row__bar fsc-row__bar--${band(u)}`} style={{ width: `${Math.min(u.ratio / 2.5, 1) * 80}%` }} />
        <span className="fsc-row__v">{pct(u.ratio)}</span>
      </span>
    </li>
  );
}

export default function FuelStandardCard({ companyId, days, to, windowLabel, onOpen }) {
  const span = useMemo(() => reviewWindow(days, to), [days, to]);
  const { data: review } = useQuery({
    queryKey: ["fuel-performance-review:company", companyId, span.from, span.to],
    queryFn: () => getPerformanceReviewForCompany({ companyId, ...span }),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
  const read = useMemo(() => readReview(review), [review]);
  if (!review || !review.totals.assessedUnits) return null;
  const t = review.totals;
  const worst = read.attention.slice(0, 6);
  const best = read.benchmarks.slice(0, 4);

  return (
    <div className="an-grid">
    <div className="an-card an-card--wide fsc">
      <div className="an-card__head">
        <span className="an-card__title">Fuel Against Standard</span>
        <span className="an-card__hint">{windowLabel} · {t.assessedUnits} units judged</span>
      </div>
      <div className="fsc-figs">
        <div><b>{litres(t.excessL, { short: true })}</b><span>above standard · {(t.excessShare * 100).toFixed(1)}% of fuel</span></div>
        <div><b>{read.attention.length}</b><span>unit{read.attention.length === 1 ? "" : "s"} 10% or more over</span></div>
        <div><b>{read.reliableShare != null ? `${Math.round(read.reliableShare * 100)}%` : "—"}</b><span>refill records usable</span></div>
        {read.worstGroup?.excessL > 0 && <div><b>{read.worstGroup.group}</b><span>most fuel above standard ({litres(read.worstGroup.excessL, { short: true })})</span></div>}
      </div>
      <div className="fsc-cols">
        <section>
          <h4 className="fsc-h fsc-h--bad">Needing attention</h4>
          {worst.length ? <ul className="fsc-list">{worst.map((u) => <Row key={u.id} u={u} />)}</ul>
            : <p className="an-card__empty">No unit is 10% or more over standard.</p>}
        </section>
        <section>
          <h4 className="fsc-h fsc-h--good">Benchmarks</h4>
          {best.length ? (
            <ul className="fsc-list">
              {best.flatMap((b) => b.units.slice(0, 1)).map((u) => <Row key={u.id} u={u} />)}
            </ul>
          ) : <p className="an-card__empty">No unit is within standard yet.</p>}
        </section>
      </div>
      {onOpen && (
        <button type="button" className="fsc-open" onClick={onOpen}>
          Open the full review <i className="ti ti-arrow-right" aria-hidden="true" />
        </button>
      )}
    </div>
    </div>
  );
}
