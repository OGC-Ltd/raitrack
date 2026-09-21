// The playback transport: day picker, scrubber, rate.
//
// Rendered over the map when a vehicle's route is opened in playback mode. It
// owns no map objects — it reports a cursor, and FleetMap moves the marker.

import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYBACK_RATES } from "../../hooks/useRoutePlayback";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import "./RoutePlayback.css";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Clock time in the FLEET's timezone, not the viewer's.
 *
 * A day here is a Kenyan calendar day — the server bucketed it that way and the
 * scrubber's ends are its midnights. Formatting the cursor in the browser's
 * zone would put "02:00" under a scrubber whose left edge is labelled 00:00,
 * for anyone not sitting in EAT.
 */
const HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false,
});
const HHMMSS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

const fmtDur = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
};

/** YYYY-MM-DD shifted by `delta` days, staying on the fleet calendar. */
export function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(d);
}

export const todayFleetDay = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

export default function RoutePlayback({
  plate, day, onDay,
  cursor, t0, t1, playing, rate, skipped, subscribe, events,
  onToggle, onSeek, onRate, onClose,
  loading, error, summary,
}) {
  const isToday = day >= todayFleetDay();

  const [minimized, setMinimized] = useState(false);

  /**
   * The clock and the scrubber are written DIRECTLY, not rendered.
   *
   * `cursor` reaches React eight times a second (see UI_PUBLISH_MS); the
   * subscription reaches these sixty. Rendering a read-out and a range input at
   * 60 Hz meant re-rendering this panel, FleetMap and every panel MapOverlay
   * owns on every frame — which is what made the thumb crawl at 100x. Two
   * property writes cost nothing and are what the browser would have done
   * anyway.
   *
   * `cursor` is still the source of truth for the FIRST paint and for a paused
   * panel that mounts mid-day; the subscription fires once on subscribe, so the
   * two can never disagree for longer than a frame.
   */
  const clockRef = useRef(null);
  const minClockRef = useRef(null);
  const barRef = useRef(null);
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((t) => {
      const text = HHMMSS.format(t);
      if (clockRef.current) clockRef.current.textContent = text;
      if (minClockRef.current) minClockRef.current.textContent = text;
      // Never fight the operator's own drag: while the thumb is held, the
      // element's value IS the input, and writing to it would snap it back.
      const bar = barRef.current;
      if (bar && document.activeElement !== bar) bar.value = String(t);
    });
  }, [subscribe]);

  /**
   * Placement, dragging and persistence all come from the shared hook — the
   * same one the fuel incident window uses. This panel previously carried its
   * own copy of each, which is how it ended up with a drag that moved on hover
   * and a clamp that disagreed with the other window's.
   *
   * Docked bottom-centre, where a transport belongs and where the hook's inset
   * clears the fixed footer nav. The earlier version sat at the bottom too and
   * went UNDER that nav, because it anchored to the map box and nothing
   * accounted for furniture the map does not own.
   */
  const { ref: panelRef, onPointerDown } = useFloatingWindow({
    id: "playback",
    dock: "bottom-center",
  });

  // Gap ticks, so the silences are visible on the bar rather than only felt as
  // the marker jumping. Positioned as a percentage of the day's span.
  const gapTicks = useMemo(() => {
    if (!summary?.gapSpans?.length || t1 <= t0) return [];
    return summary.gapSpans.map((g) => ({
      left: ((g.from - t0) / (t1 - t0)) * 100,
      width: Math.max(0.4, ((g.to - g.from) / (t1 - t0)) * 100),
      ms: g.to - g.from,
    }));
  }, [summary, t0, t1]);

  /**
   * The day's events as marks on the scrubber, one per event.
   *
   * Positioned the same way the gap ticks are, so a reader compares like with
   * like: everything on this bar is "when", as a fraction of the day. A span
   * (a stop, a speeding run) gets a width; an instant gets the minimum, which
   * is a pixel or two rather than nothing.
   *
   * Capped for the bar only. A day can carry up to 300 events and 300 marks on
   * a 400px scrubber is a smear — the TIMELINE below still lists them all,
   * which is where the answer to "what happened" actually lives. Severity
   * decides who survives, matching the server's own cap.
   */
  /**
   * What has happened SO FAR.
   *
   * Everything below reads this rather than `events`. A replay whose timeline
   * is fully populated at t0 has already told you the day's story before the
   * unit sets off — the drain is listed, the marks are on the bar — so pressing
   * play only animates a conclusion the panel gave away. Revealing them as the
   * cursor reaches them is what makes it a replay rather than a report.
   *
   * `cursor` is React state published at 8 Hz (see UI_PUBLISH_MS), not the 60 Hz
   * subscription — a list re-rendering on every animation frame is exactly what
   * that split exists to prevent, and a tenth of a second late is invisible on
   * an event that took a minute.
   */
  const seen = useMemo(
    () => (events ?? []).filter((e) => e.t <= cursor),
    [events, cursor],
  );

  const eventTicks = useMemo(() => {
    if (!seen.length || t1 <= t0) return [];
    const rank = { critical: 0, warning: 1, info: 2 };
    return [...seen]
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .slice(0, 60)
      .map((e, i) => ({
        key: `${e.t}-${i}`,
        kind: e.kind,
        severity: e.severity,
        left: ((e.t - t0) / (t1 - t0)) * 100,
        width: Math.max(0.35, (((e.endT ?? e.t) - e.t) / (t1 - t0)) * 100),
        title: `${HHMMSS.format(e.t)} · ${e.label}${e.detail ? ` — ${e.detail}` : ""}`,
      }));
  }, [seen, t0, t1]);

  const empty = !loading && !error && (!summary || summary.points === 0);

  return (
    <div ref={panelRef} className={"rp" + (minimized ? " rp--min" : "")}>
      <div
        className="rp__head"
        onPointerDown={onPointerDown}
        title="Hold and drag to move"
      >
        <span className="rp__grip" aria-hidden="true">⠿</span>
        <span className="rp__plate">{plate}</span>

        {/* Minimised, the clock stays visible — the panel is out of the way but
            the replay is still running, and a collapsed control that shows
            nothing looks like it stopped. */}
        {minimized && !loading && !error && (
          <span ref={minClockRef} className="rp__clock rp__clock--min">{HHMMSS.format(cursor)}</span>
        )}

        <div className="rp__day">
          <button type="button" onClick={() => onDay(shiftDay(day, -1))} aria-label="Previous day">‹</button>
          <input
            type="date"
            value={day}
            max={todayFleetDay()}
            onChange={(e) => e.target.value && onDay(e.target.value)}
          />
          <button
            type="button"
            onClick={() => onDay(shiftDay(day, 1))}
            disabled={isToday}
            aria-label="Next day"
            title={isToday ? "No later day to show" : "Next day"}
          >›</button>
        </div>

        <button
          type="button"
          className="rp__min"
          onClick={() => setMinimized(m => !m)}
          aria-expanded={!minimized}
          aria-label={minimized ? "Expand playback controls" : "Minimize playback controls"}
          title={minimized ? "Expand" : "Minimize"}
        >{minimized ? "▲" : "▬"}</button>

        <button type="button" className="rp__close" onClick={onClose} aria-label="Close playback">✕</button>
      </div>

      {/* Minimised hides the CONTROLS, never the playback: the cursor keeps
          running and the marker keeps moving, which is the point of getting the
          panel out of the way. */}
      {!minimized && loading && <div className="rp__note">Loading {day}…</div>}
      {!minimized && error   && <div className="rp__note rp__note--err">{error}</div>}
      {!minimized && empty   && <div className="rp__note">This unit reported no positions on {day}.</div>}

      {!minimized && !loading && !error && !empty && (
        <>
          <div className="rp__transport">
            <button
              type="button"
              className="rp__play"
              onClick={onToggle}
              aria-label={playing ? "Pause" : "Play"}
            >{playing ? "❚❚" : "▶"}</button>

            <span ref={clockRef} className="rp__clock">{HHMMSS.format(cursor)}</span>

            <div className="rp__barwrap">
              {/* The silences, drawn UNDER the range input. A day here carries
                  7-64 of them and some are half an hour long; without this the
                  marker's jump looks like a bug rather than like missing data. */}
              {gapTicks.map((g, i) => (
                <span
                  key={i}
                  className="rp__gap"
                  style={{ left: `${g.left}%`, width: `${g.width}%` }}
                  title={`No reports for ${fmtDur(g.ms)}`}
                />
              ))}

              {/* The day's events, under the thumb and over the silences —
                  a silence is the absence of evidence, an event is evidence,
                  and where they overlap the event is the thing to see. */}
              {eventTicks.map((e) => (
                <span
                  key={e.key}
                  className={`rp__ev rp__ev--${e.kind} rp__ev--${e.severity}`}
                  style={{ left: `${e.left}%`, width: `${e.width}%` }}
                  title={e.title}
                />
              ))}
              {/* UNCONTROLLED, and written by the subscription above.
                  `key` on the day's bounds so a new day re-mounts the input
                  with a defaultValue that matches it — an uncontrolled input
                  ignores a changed defaultValue otherwise, and the thumb would
                  stay where yesterday left it. */}
              <input
                key={`${t0}-${t1}`}
                ref={barRef}
                className="rp__bar"
                type="range"
                min={t0}
                max={t1}
                defaultValue={cursor}
                step={1000}
                onChange={(e) => onSeek(Number(e.target.value))}
                aria-label="Seek"
              />
            </div>

            {/* Labelled, not just a bare multiplier. The steps are logarithmic
                because the useful range is not linear: 1x is for inspecting one
                incident, and a 10-hour day only becomes watchable somewhere
                around 25-50x. */}
            <label className="rp__ratewrap" title="Playback speed">
              <span className="rp__ratelbl">Speed</span>
              <select
                className="rp__rate"
                value={rate}
                onChange={(e) => onRate(Number(e.target.value))}
                aria-label="Playback speed"
              >
                {PLAYBACK_RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
              </select>
            </label>
          </div>

          {/* THE TIMELINE. The scrubber says when things happened; this says
              what they were, which is the question a replay is usually opened
              to answer. Every event, not the 60 the bar can hold — the list
              scrolls, and a drain that did not fit on a smear of marks is
              exactly the one somebody is looking for.

              A row seeks the cursor to its event, so "what happened at 11:40"
              and "show me 11:40" are one gesture. */}
          {events?.length > 0 && (
            <div className="rp__events">
              {/* Both numbers, because either alone misleads: "3 events" hides
                  that the day holds twelve, and "12 events" over a list of
                  three reads as a list that failed to load. */}
              <div className="rp__events-head">
                {seen.length} of {events.length} event{events.length === 1 ? "" : "s"}
                {seen.length === 0 && " · none yet"}
              </div>
              <div className="rp__events-list">
                {seen.map((e, i) => (
                  <button
                    type="button"
                    key={`${e.t}-${i}`}
                    className={`rp__event rp__event--${e.severity}`}
                    onClick={() => onSeek(e.t)}
                    title="Jump the playback here"
                  >
                    <span className={`rp__event-dot rp__event-dot--${e.kind}`} aria-hidden="true" />
                    <span className="rp__event-time">{HHMMSS.format(e.t)}</span>
                    <span className="rp__event-label">{e.label}</span>
                    {e.detail && <span className="rp__event-detail">{e.detail}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rp__foot">
            <span>{HHMM.format(t0)}–{HHMM.format(t1)}</span>
            {summary?.distanceM != null && <span>{(summary.distanceM / 1000).toFixed(1)} km</span>}
            <span>{summary?.points} pts · {summary?.fixes} fixes</span>
            {summary?.truncated && (
              <span
                className="rp__warn"
                title="This unit sent more fixes than one request may read, so the day is cut short at its late end."
              >day truncated</span>
            )}
            {/* Named rather than silent: the cursor jumped, and an interface
                that moves on its own without saying why reads as broken. */}
            {skipped && <span className="rp__skip">skipped {fmtDur(skipped.ms)} of silence</span>}
          </div>
        </>
      )}
    </div>
  );
}
