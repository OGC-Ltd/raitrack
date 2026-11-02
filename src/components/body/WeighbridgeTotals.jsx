// The Weighbridges page's figures (operator, 3 Nov 2026: "fix the
// weighbridges ui"): the day across every bridge, then a card per bridge.
//
// The day reads as one sentence of numbers: what was weighed in, how much of
// it the trucks brought in against what the tractors took out, and the
// heaviest and lightest tickets, each a button that opens its ticket. Each
// bridge card is also the bridge picker for the ticket grid, carrying its own
// tonnage and its own trucks and tractors, so nothing has to be read twice.
//
// Every figure comes from the server (weighments.service) or the range merge
// (useWeighments). Nothing here is computed beyond a share for a bar.

import { tonnes, tonnesTotal } from "../../api/weighments";
import "./WeighbridgeTotals.css";

const plural = (n, one) => `${n.toLocaleString("en-GB")} ${one}${n === 1 ? "" : "s"}`;

/** Trucks against tractors as one bar; empty when nothing weighed yet. */
function MixBar({ trucks, tractors, size = "lg" }) {
  const total = (trucks?.netKg ?? 0) + (tractors?.netKg ?? 0);
  const share = total > 0 ? (trucks.netKg / total) * 100 : 0;
  return (
    <div className={`wbt-bar wbt-bar--${size}`} aria-hidden="true">
      {total > 0 && <span className="wbt-bar__truck" style={{ width: `${share}%` }} />}
      {total > 0 && <span className="wbt-bar__tractor" style={{ width: `${100 - share}%` }} />}
    </div>
  );
}

/** Heaviest or Lightest: the weight, the plate and the bridge; a click opens the ticket. */
function TicketFigure({ label, kg, ticket, onOpen }) {
  const can = Boolean(ticket?.row);
  return (
    <button type="button" className="wbt-tick" disabled={!can} onClick={() => can && onOpen(ticket.row)}
            title={can ? `Token ${ticket.token}. Open the ticket.` : undefined}>
      <span className="wbt-tick__l">{label}</span>
      <span className="wbt-tick__n">{kg != null ? tonnes(kg) : "-"}</span>
      <span className="wbt-tick__who">{ticket ? `${ticket.vehicleNo} · ${ticket.centerName}` : "No ticket yet"}</span>
      {can && <i className="ti ti-chevron-right wbt-tick__go" aria-hidden="true" />}
    </button>
  );
}

/**
 * @param {{
 *   stats: object|undefined, centres: object[], loading: boolean,
 *   periodLabel: string,
 *   showBridges: boolean, centre: number|null, onPickCentre: (code: number) => void,
 *   onOpenTicket: (row: object) => void,
 * }} p
 */
export default function WeighbridgeTotals({ stats, centres, loading, periodLabel, showBridges, centre, onPickCentre, onOpenTicket }) {
  const ready = Boolean(stats);
  return (
    <section className="wbt" aria-label="Weighbridge totals">
      <div className="wbt-day" data-tour="page-kpis">
        <div className="wbt-total">
          <span className="wbt-total__n">{ready ? tonnesTotal(stats.totalNetKg) : "·"}</span>
          <span className="wbt-total__l">
            Weighed in, every bridge · {ready ? plural(stats.weighments, "weighment") : "…"} · {periodLabel}
          </span>
        </div>

        <div className="wbt-mix">
          <MixBar trucks={stats?.trucks} tractors={stats?.tractors} />
          <dl className="wbt-mix__keys">
            <div className="wbt-key wbt-key--truck">
              <dt><i className="ti ti-truck" aria-hidden="true" />Trucks · cane in</dt>
              <dd><b>{ready && stats.trucks ? tonnesTotal(stats.trucks.netKg) : "·"}</b>
                {ready && stats.trucks && <span>{plural(stats.trucks.tickets, "ticket")}</span>}</dd>
            </div>
            <div className="wbt-key wbt-key--tractor">
              <dt><i className="ti ti-tractor" aria-hidden="true" />Tractors · out</dt>
              <dd><b>{ready && stats.tractors ? tonnesTotal(stats.tractors.netKg) : "·"}</b>
                {ready && stats.tractors && <span>{plural(stats.tractors.tickets, "ticket")}</span>}</dd>
            </div>
          </dl>
        </div>

        <div className="wbt-ticks">
          <TicketFigure label="Heaviest load" kg={stats?.heaviestNetKg} ticket={stats?.heaviest} onOpen={onOpenTicket} />
          <TicketFigure label="Lightest load" kg={stats?.lightestNetKg} ticket={stats?.lightest} onOpen={onOpenTicket} />
        </div>
      </div>

      {showBridges && (
        <div className="wbt-bridges" data-tour="page-tabs" role="group" aria-label="Bridge shown in the tickets">
          {centres.map((c) => {
            const on = centre === c.code;
            const from = c.fromCentres?.tickets > 0 ? c.fromCentres : null;
            return (
              <button key={c.code} type="button" aria-pressed={on}
                      className={`wbt-bridge${on ? " wbt-bridge--on" : ""}`} onClick={() => onPickCentre(c.code)}>
                <span className="wbt-bridge__head">
                  <span className="wbt-bridge__name">{c.name}</span>
                  <span className="wbt-bridge__count">{plural(c.count, "ticket")}</span>
                </span>
                <span className="wbt-bridge__n">{c.netKg != null ? tonnesTotal(c.netKg) : "-"}</span>
                {c.trucks && (
                  <>
                    <MixBar trucks={c.trucks} tractors={c.tractors} size="sm" />
                    <span className="wbt-bridge__split">
                      <span className="wbt-key--truck"><i className="ti ti-truck" aria-hidden="true" />{tonnesTotal(c.trucks.netKg)}</span>
                      <span className="wbt-key--tractor"><i className="ti ti-tractor" aria-hidden="true" />{tonnesTotal(c.tractors.netKg)}</span>
                    </span>
                    {/* At the Factory: the trucks the centres sent on, at the Factory's weight */}
                    {from && <span className="wbt-bridge__note">Incl. {tonnesTotal(from.netKg)} on {plural(from.tickets, "truck")} from the centres</span>}
                  </>
                )}
              </button>
            );
          })}
          {centres.length === 0 && loading && <span className="wbt-bridges__hint">Loading bridges…</span>}
        </div>
      )}
    </section>
  );
}
