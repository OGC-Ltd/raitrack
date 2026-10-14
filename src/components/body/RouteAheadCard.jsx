// Route ahead of the ONE tracked unit: road distance, traffic ETA and where it
// is heading, plus the 15/30/60-minute reach rings. Both come from the unit's
// Wialon fix through the server (lib/googleRouting) — no phone, no driver app.
//
// The destination is the open dispatch's (outbound → destination, returning →
// the gate) unless the operator picks one on the map, which wins until it is
// cleared or the unit stops being tracked.

import { fmtDuration } from "../../lib/tripProgress";
import { REACH_MINUTES } from "../../lib/googleRouting";
import "./RouteCoveredCard.css";
import "./RouteAheadCard.css";

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mins = (s) => fmtDuration(Math.max(0, Math.round(s / 60))) ?? "0 m";

export const REACH_COLORS = { 15: "#16a34a", 30: "#f59e0b", 60: "#ef4444" };

const TOWARDS = { destination: "To", yard: "Back to", picked: "To" };

/**
 * @param {object} p
 * @param {string} p.plate
 * @param {{towards:string,to:{name?:string}}|null} p.target
 * @param {{data?:object,isPending:boolean,isError:boolean,error?:Error}} p.route
 * @param {boolean} p.picking
 * @param {() => void} p.onPick
 * @param {() => void} p.onCancelPick
 * @param {() => void} p.onClearPicked
 * @param {boolean} p.reachOn
 * @param {() => void} p.onToggleReach
 * @param {{status:'idle'|'loading'|'ok'|'error', error?:string}} p.reach
 * @param {boolean} p.stale  position too old to route from
 */
export default function RouteAheadCard({
  plate, target, route, picking, onPick, onCancelPick, onClearPicked,
  reachOn, onToggleReach, reach, stale,
}) {
  const d = route?.data;
  const where = target?.to?.name || (target?.towards === "yard" ? "the gate" : target ? "the picked point" : null);
  const ago = d ? Math.round((Date.now() - d.fetchedAt) / 60_000) : null;

  return (
    <div className="rcov rah" role="status" aria-live="polite">
      <div className="rcov__head">
        <span className="rcov__title">Route ahead · {plate}</span>
      </div>

      {stale && <div className="rcov__muted">No recent position, so there is nothing to route from.</div>}

      {!stale && !target && !picking && (
        <div className="rcov__muted">Not on a dispatch. Pick a destination to see the road and ETA.</div>
      )}

      {!stale && target && (
        <>
          <div className="rah__to">
            {TOWARDS[target.towards] ?? "To"} <b>{where}</b>
            {target.towards === "picked" && (
              <button type="button" className="rah__link" onClick={onClearPicked}>Clear</button>
            )}
          </div>
          {route?.isPending && <div className="rcov__muted">Routing with live traffic…</div>}
          {route?.isError && <div className="rcov__err">{route.error?.message ?? "Route unavailable"}</div>}
          {d && (
            <>
              <div className="rah__eta">
                Arrives <b>{clock(d.arrivalMs)}</b> · {mins(d.travelS)} · {(d.lengthM / 1000).toFixed(1)} km by road
              </div>
              <div className="rcov__sub">
                {d.delayS >= 60 ? `Traffic adds ${mins(d.delayS)} · ` : "No traffic delay · "}
                free flow {mins(d.noTrafficS)}
              </div>
            </>
          )}
        </>
      )}

      <div className="rah__actions">
        {picking ? (
          <>
            <span className="rah__hint">Click the map to set the destination</span>
            <button type="button" className="rah__btn" onClick={onCancelPick}>Cancel</button>
          </>
        ) : (
          <button type="button" className="rah__btn" onClick={onPick} disabled={stale}>
            {target?.towards === "picked" ? "Pick again" : "Pick destination"}
          </button>
        )}
        <button
          type="button"
          className={`rah__btn${reachOn ? " rah__btn--on" : ""}`}
          onClick={onToggleReach}
          disabled={stale}
          aria-pressed={reachOn}
        >
          Reach {REACH_MINUTES.join("/")} min
        </button>
      </div>

      {reachOn && (
        <div className="rah__legend">
          {REACH_MINUTES.map((m) => (
            <span key={m}><i className="rah__sw" style={{ background: REACH_COLORS[m] }} />{m} min</span>
          ))}
          {reach.status === "loading" && <span className="rcov__muted">loading…</span>}
          {reach.status === "error" && <span className="rcov__err">{reach.error}</span>}
        </div>
      )}

      <div className="rcov__src">
        Google Routes{reachOn ? " + Isochrones" : ""} from the tracker&apos;s position
        {ago != null ? ` · ${ago < 1 ? "just now" : `${ago} m ago`}` : ""}
      </div>
    </div>
  );
}
