/**
 * Fuel › Report › Trips and Parkings — each a picture of WHEN over the
 * period, then the rows, with the row's own measure drawn in its cell.
 *
 *   Trips     a timeline of the trips across the period (each block where
 *             and how long it ran); the table draws duration and distance
 *             as bars against the longest, and gives each trip its fuel rate.
 *   Parkings  the same timeline for the parkings, a chart of how long they
 *             lasted (each bar filters the table), and what the tank did
 *             while the unit stood: a fall of FALL_L or more is flagged, as
 *             fuel only leaves a standing tank by hand or by a leak.
 *
 * Nothing here repeats the page's KPI strip (the tank's balance and the
 * distance): these are per-trip and per-parking readings only. A block on the
 * timeline and its row are one thing: hovering either lifts the other, and
 * clicking a block brings its row into view.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { durationLabel } from "../../lib/fuelReport";

const H = 3_600_000;
const DAY = 24 * H;
const TZ = "Africa/Nairobi";
const NAIROBI_OFFSET = 3 * H;
/** A change smaller than this across a parking is the probe, not fuel. */
const FALL_L = 5;

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const dayMon = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: TZ });

// ── timeline ───────────────────────────────────────────────────────────────

/** Tick step for a span: the smallest that keeps the axis to ~7 labels. */
const STEPS = [H, 2 * H, 3 * H, 6 * H, 12 * H, DAY, 2 * DAY, 7 * DAY];
function ticksFor(from, to) {
  const span = to - from;
  const step = STEPS.find((s) => span / s <= 7) ?? 7 * DAY;
  // Align to Nairobi's clock, so ticks fall on whole hours and midnights.
  let t = Math.ceil((from + NAIROBI_OFFSET) / step) * step - NAIROBI_OFFSET;
  const out = [];
  for (; t <= to; t += step) {
    const midnight = (t + NAIROBI_OFFSET) % DAY === 0;
    out.push({ t, label: step >= DAY || midnight ? dayMon.format(t) : clock.format(t), strong: midnight });
  }
  return out;
}

/**
 * The period as one lane; each segment a block at its time, as wide as it
 * lasted (never under 2px, so a five-minute stop on a month still shows).
 */
function Timeline({ from, to, segments, tone, hot, picked, onHot, onPick, describe, ariaLabel, shown = null }) {
  const span = Math.max(1, to - from);
  const pos = (t) => Math.min(100, Math.max(0, ((t - from) / span) * 100));
  const ticks = useMemo(() => ticksFor(from, to), [from, to]);
  const tip = segments.find((s) => s.start === hot);

  return (
    <div className="frs-tl" role="img" aria-label={ariaLabel}>
      <div className="frs-tl__lane">
        {ticks.map((k) => (
          <i key={k.t} className={`frs-tl__grid${k.strong ? " frs-tl__grid--day" : ""}`} style={{ left: `${pos(k.t)}%` }} />
        ))}
        {segments.map((s) => (
          <span
            key={s.start}
            className={`frs-tl__seg frs-tl__seg--${tone}${hot === s.start ? " is-hot" : ""}${picked === s.start ? " is-on" : ""}${shown && !shown.has(s.start) ? " is-out" : ""}`}
            style={{ left: `${pos(s.start)}%`, width: `${pos(s.end) - pos(s.start)}%` }}
            onMouseEnter={() => onHot(s.start)}
            onMouseLeave={() => onHot(null)}
            onClick={() => onPick(picked === s.start ? null : s.start)}
          />
        ))}
        {tip && (
          <div className={`frs-tl__tip${pos(tip.start) > 70 ? " frs-tl__tip--end" : pos(tip.end) < 30 ? " frs-tl__tip--start" : ""}`}
               style={{ left: `${pos((tip.start + tip.end) / 2)}%` }} aria-hidden="true">
            {describe(tip)}
          </div>
        )}
      </div>
      <div className="frs-tl__axis" aria-hidden="true">
        {/* A label hard against either end would hang off the card: those
            keep their grid line and lose only the words. */}
        {ticks.filter((k) => pos(k.t) > 4 && pos(k.t) < 96).map((k) => (
          <span key={k.t} className={k.strong ? "is-day" : ""} style={{ left: `${pos(k.t)}%` }}>{k.label}</span>
        ))}
      </div>
    </div>
  );
}

/** A cell's value with a bar under it, against the column's largest. */
function CellBar({ children, ratio, tone }) {
  return (
    <span className="frs-cellbar">
      <span>{children}</span>
      <i aria-hidden="true"><b className={`frs-cellbar--${tone}`} style={{ width: `${Math.max(2, Math.min(1, ratio) * 100)}%` }} /></i>
    </span>
  );
}

/** Shared hover / pick state, and the row a pick scrolls to. */
function useLink(onHoverAt) {
  const [hot, setHot] = useState(null);
  const [picked, setPicked] = useState(null);
  const rows = useRef(new Map());
  useEffect(() => {
    if (picked != null) rows.current.get(picked)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked]);
  const hover = (t) => { setHot(t); onHoverAt(t); };
  const rowProps = (s) => ({
    ref: (el) => { if (el) rows.current.set(s.start, el); else rows.current.delete(s.start); },
    className: `sp4-tr frs-tr${hot === s.start ? " is-hot" : ""}${picked === s.start ? " is-on" : ""}`,
    onMouseEnter: () => hover(s.start),
    onMouseLeave: () => hover(null),
    onClick: () => setPicked(picked === s.start ? null : s.start),
  });
  return { hot, picked, hover, setPicked, rowProps };
}

// ── trips ──────────────────────────────────────────────────────────────────

export function TripsView({ report: r, from, to, fmtNum, at, onHoverAt }) {
  const trips = r.trips;
  const { hot, picked, hover, setPicked, rowProps } = useLink(onHoverAt);
  const longestMs = Math.max(...trips.map((s) => s.durationMs), 1);
  const farthestKm = Math.max(...trips.map((s) => s.distanceKm), 0.001);

  // Fuel a trip used, and its rate where it covered enough road to mean one.
  const usedOf = (s) => (s.fuelStartL != null && s.fuelEndL != null ? s.fuelStartL - s.fuelEndL : null);
  const rateOf = (s) => {
    const u = usedOf(s);
    return u != null && u > 0 && s.distanceKm >= 1 ? (u / s.distanceKm) * 100 : null;
  };

  return (
    <div className="frv frs">
      <section className="frv-card">
        <h3 className="frv-card__t">When it moved</h3>
        <Timeline
          from={from} to={to} segments={trips} tone="trip" hot={hot} picked={picked}
          onHot={hover} onPick={setPicked}
          describe={(s) => <><b>{clock.format(s.start)} – {clock.format(s.end)}</b> · {durationLabel(s.durationMs)} · {fmtNum(s.distanceKm)} km</>}
          ariaLabel={`${trips.length} trips between ${at(from)} and ${at(to)}; the table below lists each.`}
        />
        <p className="frv-card__note">Each block is a trip, as long as it ran. Click one to find its row.</p>
      </section>

      <div className="sp4-table-scroll frv-table">
        <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
          <thead><tr>
            <th className="sp4-th--left">Start</th>
            <th className="sp4-th--left">End</th>
            <th className="sp4-th--left frs-th--bar">Duration</th>
            <th className="sp4-th--left frs-th--bar">Distance</th>
            <th className="sp4-th--right">Max speed</th>
            <th className="sp4-th--right">Fuel</th>
            <th className="sp4-th--right" title="Litres per 100 km over the trip, where it covered at least a kilometre and the tank fell">Rate</th>
          </tr></thead>
          <tbody>
            {trips.map((s) => {
              const used = usedOf(s);
              const rate = rateOf(s);
              return (
                <tr key={s.start} {...rowProps(s)}>
                  <td className="sp4-td--left sp4-num">{at(s.start)}</td>
                  <td className="sp4-td--left sp4-num">{at(s.end)}</td>
                  <td className="sp4-td--left"><CellBar ratio={s.durationMs / longestMs} tone="trip">{durationLabel(s.durationMs)}</CellBar></td>
                  <td className="sp4-td--left"><CellBar ratio={s.distanceKm / farthestKm} tone="trip">{fmtNum(s.distanceKm)} km</CellBar></td>
                  <td className="sp4-td--right sp4-num">{fmtNum(s.maxSpeedKmh, 0)} km/h</td>
                  <td className="sp4-td--right sp4-num">
                    {fmtNum(s.fuelStartL)} → {fmtNum(s.fuelEndL)} L
                    {used != null && Math.abs(used) >= 0.1 && <small className="frs-delta">{used > 0 ? "−" : "+"}{fmtNum(Math.abs(used))}</small>}
                  </td>
                  <td className="sp4-td--right sp4-num">{rate != null ? <>{fmtNum(rate)} <small className="frs-unit">L/100 km</small></> : <span className="sp4-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── parkings ───────────────────────────────────────────────────────────────

const BINS = [
  { key: "short", label: "Under 30 min", min: 0,        max: 0.5 * H },
  { key: "mid",   label: "30 min – 2 h", min: 0.5 * H,  max: 2 * H },
  { key: "long",  label: "2 – 8 h",      min: 2 * H,    max: 8 * H },
  { key: "night", label: "8 h or more",  min: 8 * H,    max: Infinity },
];
const binOf = (ms) => BINS.find((b) => ms >= b.min && ms < b.max)?.key;

export function ParkingsView({ report: r, from, to, fmtNum, at, onHoverAt }) {
  const parkings = r.parkings;
  const { hot, picked, hover, setPicked, rowProps } = useLink(onHoverAt);
  const [bin, setBin] = useState(null);
  const [fellOnly, setFellOnly] = useState(false);

  const changeOf = (s) => (s.fuelStartL != null && s.fuelEndL != null ? s.fuelEndL - s.fuelStartL : null);
  const fell = (s) => { const c = changeOf(s); return c != null && c <= -FALL_L; };

  const bins = BINS.map((b) => {
    const these = parkings.filter((s) => binOf(s.durationMs) === b.key);
    return { ...b, count: these.length, hours: these.reduce((n, s) => n + s.durationMs, 0) / H };
  });
  const most = Math.max(...bins.map((b) => b.count), 1);
  const fellCount = parkings.filter(fell).length;
  const longestMs = Math.max(...parkings.map((s) => s.durationMs), 1);

  const shown = parkings.filter((s) => (!bin || binOf(s.durationMs) === bin) && (!fellOnly || fell(s)));
  const filtered = bin || fellOnly;

  return (
    <div className="frv frs">
      <div className="frs-grid">
        <section className="frv-card">
          <h3 className="frv-card__t">When it stood</h3>
          <Timeline
            from={from} to={to} segments={parkings} tone="park" hot={hot} picked={picked}
            onHot={hover} onPick={setPicked}
            shown={filtered ? new Set(shown.map((s) => s.start)) : null}
            describe={(s) => {
              const c = changeOf(s);
              return <><b>{clock.format(s.start)} – {clock.format(s.end)}</b> · {durationLabel(s.durationMs)}
                {c != null && Math.abs(c) >= FALL_L && <> · {c < 0 ? "fell" : "rose"} {fmtNum(Math.abs(c))} L</>}</>;
            }}
            ariaLabel={`${parkings.length} parkings between ${at(from)} and ${at(to)}; the table below lists each.`}
          />
          <p className="frv-card__note">Each block is a parking, as long as it lasted. Click one to find its row.</p>
        </section>

        <section className="frv-card">
          <h3 className="frv-card__t">How long it stood</h3>
          <div className="frs-bins" role="group" aria-label="Parkings by length. Choose one to filter the table">
            {bins.map((b) => (
              <button key={b.key} type="button" aria-pressed={bin === b.key} disabled={b.count === 0}
                      className={`frs-bin${bin === b.key ? " is-on" : ""}`}
                      onClick={() => setBin(bin === b.key ? null : b.key)}
                      title={`${b.count} parking${b.count === 1 ? "" : "s"}, ${fmtNum(b.hours)} h in all. Click to ${bin === b.key ? "show every parking" : "show only these"}.`}>
                <span className="frs-bin__k">{b.label}</span>
                <span className="frs-bin__bar" aria-hidden="true"><b style={{ width: `${(b.count / most) * 100}%` }} /></span>
                <span className="frs-bin__v">{b.count}<small> · {fmtNum(b.hours)} h</small></span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="frs-filters">
        <button type="button" aria-pressed={fellOnly} disabled={fellCount === 0}
                className={`sp4-filter-chip frs-chip${fellOnly ? " sp4-filter-chip--on" : ""}`}
                onClick={() => setFellOnly(!fellOnly)}
                title={`Parkings across which the tank fell ${FALL_L} L or more: fuel leaves a standing tank only by hand or by a leak`}>
          <i className="ti ti-droplet-down" aria-hidden="true" />Fuel fell while parked<span className="sp4-tab-n">{fellCount}</span>
        </button>
        {filtered && (
          <span className="frv-filter">
            Showing {shown.length} of {parkings.length}
            <button type="button" className="sp4-ghost-btn" onClick={() => { setBin(null); setFellOnly(false); }}>Show all</button>
          </span>
        )}
      </div>

      <div className="sp4-table-scroll frv-table">
        <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
          <thead><tr>
            <th className="sp4-th--left">Start</th>
            <th className="sp4-th--left">End</th>
            <th className="sp4-th--left frs-th--bar">Duration</th>
            <th className="sp4-th--right">Fuel</th>
            <th className="sp4-th--right">While parked</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={5} className="sp4-empty">No parking matches.</td></tr>
            )}
            {shown.map((s) => {
              const c = changeOf(s);
              return (
                <tr key={s.start} {...rowProps(s)}>
                  <td className="sp4-td--left sp4-num">{at(s.start)}</td>
                  <td className="sp4-td--left sp4-num">{at(s.end)}</td>
                  <td className="sp4-td--left"><CellBar ratio={s.durationMs / longestMs} tone="park">{durationLabel(s.durationMs)}</CellBar></td>
                  <td className="sp4-td--right sp4-num">{fmtNum(s.fuelStartL)} → {fmtNum(s.fuelEndL)} L</td>
                  <td className="sp4-td--right">
                    {c == null ? <span className="sp4-muted">No reading</span>
                      : c <= -FALL_L ? <span className="frs-change frs-change--fell"><i className="ti ti-arrow-down-right" aria-hidden="true" />Fell {fmtNum(-c)} L</span>
                      : c >= FALL_L ? <span className="frs-change frs-change--rose"><i className="ti ti-arrow-up-right" aria-hidden="true" />Rose {fmtNum(c)} L</span>
                      : <span className="sp4-muted">Steady</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
