// The day, in the fuel incident window: a tank ledger and the day's events.
//
// Replaces the "Record / Movement / Came back / Rule" rows, which said how the
// verdict was reached and left the reader to reconstruct the day. The ledger
// is lib/fuelDay's arithmetic; the event list is what happened, in order,
// with the incident being looked at marked.

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
const l1 = (v) => (v == null ? "—" : v.toFixed(1));

function hoursLabel(h) {
  if (h == null) return null;
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

function Row({ label, sub, value, unit = "L", tone, strong }) {
  return (
    <div className={"fd-row" + (strong ? " fd-row--strong" : "")}>
      <span className="fd-lbl">{label}</span>
      <span className="fd-sub">{sub}</span>
      <span className={"fd-val" + (tone ? ` fd-val--${tone}` : "")}>
        {value}{value !== "—" && unit ? <span className="fd-unit"> {unit}</span> : null}
      </span>
    </div>
  );
}

export default function FuelDayBreakdown({ incident, vehicleId }) {
  const { orgId } = useFleetLiveShared();
  const day = incident?.beganAt ? fleetDayOf(incident.beganAt) : null;
  const { tank, fillings, drops, loading, error } = useFuelDay(orgId, vehicleId, day);
  if (!day) return null;

  const today = day >= fleetDayOf(new Date().toISOString());
  const b = dayBreakdown({ tank, fillings, drops });
  const gap = unexplainedMatters(b);

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
        <div className="fd-ledger">
          <Row label="Opening level" sub={`${WEEKDAY.format(prevDay(day))}'s close`} value={l1(b.opening)} />
          <Row
            label="Refuelled"
            sub={b.refuelCount === 0 ? "none" : `${b.refuelCount} refuel${b.refuelCount === 1 ? "" : "s"}`}
            value={b.refuelCount === 0 ? "0.0" : `+${l1(b.refuelled)}`}
            tone={b.refuelCount ? "ok" : null}
          />
          <Row label={today ? "Level now" : "Closing level"} sub={today ? CLOCK.format(new Date()) : "end of day"} value={l1(b.closing)} />

          <div className="fd-rule" />

          <Row label="Fuel used" sub="opening + refuelled − closing" value={l1(b.used)} strong />
          <Row
            label="Engine should use"
            sub={b.engineHours != null
              ? `ran ${hoursLabel(b.engineHours)}${b.engineRate != null ? ` at ${b.engineRate.toFixed(1)} L/h` : ""}`
              : "no engine hours"}
            value={l1(b.engine)}
          />
          <Row
            label="Not explained"
            sub={b.unexplained == null ? "" : gap
              ? "more than the engine's running accounts for"
              : b.unexplained < 0 ? "used less than its usual rate" : "within the normal range"}
            value={b.unexplained == null ? "—" : `${b.unexplained > 0 ? "+" : ""}${l1(b.unexplained)}`}
            tone={gap ? "warn" : "muted"}
            strong={gap}
          />
          {b.distanceKm != null && (
            <Row label="Distance" sub="" value={b.distanceKm.toFixed(1)} unit="km" />
          )}
        </div>
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
