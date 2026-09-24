// The day, in the fuel incident window: a tank ledger and the day's events.
//
// The ledger is built from the SAME `Tile` as the incident figures above it,
// which the window draws as the unit card's boxed KPI tiles (see "The unit
// card's type" in MapOverlay.css), so the two cannot drift apart.
//
// Replaces the "Record / Movement / Came back / Rule" rows, which said how the
// verdict was reached and left the reader to reconstruct the day. The ledger
// is lib/fuelDay's arithmetic; the event list is what happened, in order,
// with the incident being looked at marked.

import { Tile } from "../cards/VehicleStatsCard";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useFuelDay } from "../../hooks/useFuelDay";
import { dayBreakdown, eventLabel, fleetDayOf, unexplainedMatters } from "../../lib/fuelDay";
import "./FuelDayBreakdown.css";

const TZ = "Africa/Nairobi";
const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });

const at = (day) => new Date(`${day}T12:00:00Z`);
const prevDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000);
// Rounded before the sign is read, so -0.04 prints "0.0", not "-0.0".
const l1 = (v) => (v == null ? "—" : (Math.round(v * 10) / 10 || 0).toFixed(1));

function hoursLabel(h) {
  if (h == null) return null;
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export default function FuelDayBreakdown({ incident, vehicleId }) {
  const { orgId } = useFleetLiveShared();
  const day = incident?.beganAt ? fleetDayOf(incident.beganAt) : null;
  const { tank, fillings, drops, loading, error } = useFuelDay(orgId, vehicleId, day);
  if (!day) return null;

  const today = day >= fleetDayOf(new Date().toISOString());
  const b = dayBreakdown({ tank, fillings, drops });
  const gap = unexplainedMatters(b);
  // Tenths are what is printed; a difference that rounds away is none.
  const diff = b.unexplained == null ? null : Math.round(b.unexplained * 10) / 10 || 0;

  return (
    <section className="fd" aria-label="The day">
      <div className="fd-hdr">
        <span className="fd-title">The day</span>
        <span className="fd-day">
          {DAY.format(at(day))}{today ? ` · so far, to ${CLOCK.format(new Date())}` : ""}
        </span>
      </div>

      {loading && !tank && <p className="fd-note">Loading the day{"…"}</p>}
      {error && <p className="fd-note">Could not load the day: {error}</p>}

      {tank && (
        <>
          <div className="vt-tiles fd-ledger">
            <Tile label="Opening level" value={l1(b.opening)} unit={b.opening != null ? " L" : ""}
                  sub={`${WEEKDAY.format(prevDay(day))}'s close`} />
            <Tile label="Refuelled"
                  value={b.refuelCount === 0 ? "0.0" : `+${l1(b.refuelled)}`} unit=" L"
                  sub={b.refuelCount === 0 ? "none" : `${b.refuelCount} refuel${b.refuelCount === 1 ? "" : "s"}`}
                  valColor={b.refuelCount ? "var(--accent-ok)" : undefined} />
            <Tile label={today ? "Level now" : "Closing level"} value={l1(b.closing)} unit={b.closing != null ? " L" : ""}
                  sub={today ? CLOCK.format(new Date()) : "end of day"} />
          </div>

          <div className="vt-divider" />

          <div className="vt-tiles">
            <Tile label="Fuel used" value={l1(b.used)} unit={b.used != null ? " L" : ""}
                  sub={"opening + refuelled \u2212 closing"} />
            <Tile label="Engine should use" value={l1(b.engine)} unit={b.engine != null ? " L" : ""}
                  sub={b.engineHours != null
                    ? `${hoursLabel(b.engineHours)}${b.engineRate != null ? ` at ${b.engineRate.toFixed(1)} L/h` : ""}`
                    : "no engine hours"} />
            <Tile label="Not explained"
                  value={diff == null ? "\u2014" : `${diff > 0 ? "+" : ""}${l1(diff)}`}
                  unit={diff != null ? " L" : ""}
                  sub={diff == null ? "" : gap
                    ? "not covered by engine hours"
                    : diff === 0 ? "matches the engine hours"
                    : diff < 0 ? "below its usual rate" : "within normal"}
                  valColor={gap ? "var(--accent-warn)" : "var(--text-muted)"} />
            {b.distanceKm != null && (
              <Tile label="Distance" value={b.distanceKm.toFixed(1)} unit=" km" />
            )}
          </div>
        </>
      )}

      {b.events.length > 0 && (
        <>
          <div className="fd-events-hdr">
            <span className="fd-title">Events</span>
            <span className="fd-day">{b.events.length}</span>
          </div>
          <ol className="fd-events">
            {b.events.map((e) => {
              const mine = e.id === incident.id;
              const kind = e.type === "refuel"
                ? (e.verdict === "REDISTRIBUTION" ? "muted" : "ok")
                : e.verdict === "REDISTRIBUTION" ? "muted" : e.verdict === "DRAIN" ? "warn" : "muted";
              return (
                <li key={e.id} className={"fd-ev" + (mine ? " fd-ev--mine" : "")}>
                  <span className="fd-ev-time">{CLOCK.format(new Date(e.at))}</span>
                  <span className={`fd-ev-dot fd-ev-dot--${kind}`} aria-hidden="true" />
                  <span className="fd-ev-lbl">
                    {eventLabel(e)}
                    {mine && <span className="fd-ev-this">this one</span>}
                  </span>
                  <span className={`fd-ev-val fd-val--${kind}`}>
                    {e.type === "refuel" ? "+" : "−"}{l1(e.litres)} L
                  </span>
                </li>
              );
            })}
          </ol>
          {b.events.length > 1 && (
            <p className="fd-note">
              Events overlap and re-measure the same fall, so they are not added up: the tank figures above are the day{"’"}s total.
            </p>
          )}
        </>
      )}
    </section>
  );
}
