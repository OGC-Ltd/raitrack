// The Gate log (operator, 2026-11-25): the sign-outs and returns at the gate,
// one fleet day at a time, for the Ops Room Operator. View only.
//
// Read from fleet-server's own route on `gate_log:read` (api/gateLog), not the
// live feed: the Ops Room Operator holds no `notification:read`. Today's log
// is read again every minute while the page is open and the browser tab is
// in front; a past day is read once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { getGateLogDay } from "../../api/gateLog";
import { gateRows, searchGate, gateCounts, shiftDay, bySource, GATE_SOURCES, gateTrips, durationWords, byHours } from "../../lib/gateLog";
import { fleetDay } from "../../lib/alertsView";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import "../body/SensorPanel.css";
import "./WeighbridgesScreen.css";
import "./GateLogScreen.css";

const REFRESH_MS = 60_000;

/** The hour lists: a window opens on 00:00-23:00 and closes on 01:00-24:00 (today: the hours gone, then now). */
const HOURS_FROM = Array.from({ length: 24 }, (_, h) => h);
const HOURS_TO = Array.from({ length: 24 }, (_, h) => h + 1);
const hourText = (h) => `${String(h).padStart(2, "0")}:00`;
const NOW = "now";

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
/** A trip's time: the clock, with the date in front when it is not the day shown. */
function TripTime({ ms, day }) {
  if (ms == null) return <span className="sp4-muted">–</span>;
  const onDay = fleetDay(ms) === day;
  const date = onDay ? "" : `${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" }).format(ms)} `;
  return <span>{date}{clock(ms)}</span>;
}

const dayWords = (day) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`));

/** state: { status: "loading" | "ready" | "error", events, cut, message } */
function useGateLog(orgId, day) {
  const [state, setState] = useState({ status: "loading", events: [], cut: false, key: null });
  const [tick, setTick] = useState(0);
  const key = `${orgId}|${day}`;
  const busy = useRef(false);

  useEffect(() => {
    if (!orgId) return undefined;
    let live = true;
    busy.current = true;
    // A re-read of the same day keeps the table on screen; a new day shows the loading note.
    setState((s) => (s.key === key ? s : { status: "loading", events: [], cut: false, key }));
    // Each page is shown as it lands, newest first; `more` while earlier lines are read.
    // A re-read keeps the full table it had until the new day is complete.
    const onPage = (events) => {
      if (!live) return;
      setState((s) => (s.key === key && s.status === "ready" && !s.more ? s : { status: "ready", events, cut: false, more: true, key }));
    };
    getGateLogDay({ orgId, day, isLive: () => live, onPage })
      .then((res) => { if (live && res) setState({ status: "ready", events: res.events, cut: res.cut, more: false, key }); })
      .catch((err) => { if (live) setState((s) => (s.key === key && s.status === "ready" ? s : { status: "error", events: [], cut: false, key, message: err?.message ?? "The request failed." })); })
      .finally(() => { if (live) busy.current = false; });
    return () => { live = false; busy.current = false; };
  }, [orgId, day, key, tick]);

  // Today only: read again every minute, while the browser tab is in front and no read is running.
  const isToday = day === fleetDay();
  useEffect(() => {
    if (!isToday) return undefined;
    const t = setInterval(() => {
      if (!busy.current && document.visibilityState === "visible") setTick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [isToday]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...(state.key === key ? state : { status: "loading", events: [], cut: false }), reload };
}

/**
 * The day before the one shown, read once, for its sign-outs only: a unit
 * signed out last night has its time out on today's return (operator,
 * 2026-11-25). Not shown, not refreshed; a failed read only leaves those
 * trips blank. A past day is complete, so it is kept per day while the page is open.
 */
const PREV_CACHE = new Map();
function usePrevDayEvents(orgId, day) {
  const prev = shiftDay(day, -1);
  const key = `${orgId}|${prev}`;
  const [got, setGot] = useState(() => PREV_CACHE.get(key) ?? null);
  useEffect(() => {
    if (!orgId) return undefined;
    if (PREV_CACHE.has(key)) { setGot(PREV_CACHE.get(key)); return undefined; }
    let live = true;
    setGot(null);
    getGateLogDay({ orgId, day: prev, isLive: () => live })
      .then((res) => { if (res) { const out = { key, events: res.events }; PREV_CACHE.set(key, out); if (live) setGot(out); } })
      .catch(() => {});
    return () => { live = false; };
  }, [orgId, prev, key]);
  return got?.key === key ? got.events : null;
}

export default function GateLogScreen() {
  const { orgId } = useFleetLiveShared();
  const today = fleetDay();
  const [day, setDay] = useState(today);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  // Hours within the day, picked from lists (operator, 2026-11-25): by default
  // 00:00 to the current time on today ("i want the current time", not the
  // next full hour), 00:00 to 24:00 on a past day. `toPicked` null keeps To
  // on now, following the clock, until an hour is picked.
  const isToday = day === today;
  const [fromH, setFromH] = useState(0);
  const [toPicked, setToPicked] = useState(null);
  const nowText = clock(Date.now());
  const [nowH, nowM] = nowText.split(":").map(Number);
  // Through the current minute, so a line stamped now is in.
  const nowHours = nowH + (nowM + 1) / 60;
  const toChoices = isToday ? HOURS_TO.filter((h) => h <= nowH) : HOURS_TO;
  const toValue = toPicked != null && (!isToday || toPicked <= nowH) ? toPicked : (isToday ? NOW : 24);
  const toH = toValue === NOW ? nowHours : toValue;
  const timeIsDefault = fromH === 0 && toPicked == null;
  const log = useGateLog(orgId, day);
  const prevEvents = usePrevDayEvents(orgId, day);

  const all = useMemo(() => gateRows(log.events), [log.events]);
  // Each unit's sign-out paired with its next return, over the whole day whatever the filter (lib/gateLog gateTrips).
  const trips = useMemo(
    () => gateTrips(prevEvents ? [...gateRows(prevEvents), ...all] : all),
    [all, prevEvents],
  );
  const rows = useMemo(() => searchGate(byHours(bySource(all, source), fromH, toH), q), [all, source, fromH, toH, q]);
  const counts = useMemo(() => gateCounts(rows), [rows]);
  const pager = usePager(rows, `${day}|${q}|${source}|${fromH}|${toValue}`);

  // The line last clicked stays marked.
  const [focusId, setFocusId] = useState(null);

  return (
    <div className="sp4-root sp4-root--framed wb-root gl-root">
      {/* The page's head as one white card, the table card's frame (operator, 2026-11-25). */}
      <div className="gl-head">
      <nav className="wb-crumbs" aria-label="Breadcrumb">
        <ol className="wb-crumbs__list">
          <li className="wb-crumbs__item">
            <i className="ti ti-door-exit" aria-hidden="true" />
            <span>Gate log</span>
          </li>
        </ol>
      </nav>
      <hr className="wb-rule" />

      <dl className="gl-figures">
        <div><dt>Signed out</dt><dd>{log.status === "ready" && !log.more ? counts.out.toLocaleString("en-GB") : "–"}</dd></div>
        <div><dt>Returned</dt><dd>{log.status === "ready" && !log.more ? counts.in.toLocaleString("en-GB") : "–"}</dd></div>
        <div><dt>Day</dt><dd className="gl-figures__day">{dayWords(day)}</dd></div>
      </dl>

      <div className="sp4-filterbar">
        <div className="sp4-search-wrap">
          <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="sp4-search" type="text" placeholder="Search unit or details…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" className="sp4-search-clear" onClick={() => setQ("")} aria-label="Clear the search">✕</button>}
        </div>
        <div className="sp4-filter-divider" />
        <div className="sp4-filter-group" role="group" aria-label="Source">
          {[["all", "All"], ["factorysuite", GATE_SOURCES.factorysuite.label], ["geofence", GATE_SOURCES.geofence.label]].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={source === k}
                    className={"sp4-filter-chip" + (source === k ? " sp4-filter-chip--on" : "")} onClick={() => setSource(k)}>{label}</button>
          ))}
        </div>
        <div className="sp4-filter-divider" />
        <div className="sp4-filter-group">
          <label className="gl-day">
            <span className="gl-day__label">Day</span>
            <input type="date" className="gl-day__input" value={day} max={today}
                   onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= today) setDay(e.target.value); }} />
          </label>
          <label className="gl-day">
            <span className="gl-day__label">From</span>
            <select className="gl-day__input gl-day__input--time" value={fromH} aria-label="From hour"
                    onChange={(e) => setFromH(Number(e.target.value))}>
              {HOURS_FROM.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
            </select>
          </label>
          <label className="gl-day">
            <span className="gl-day__label">To</span>
            <select className="gl-day__input gl-day__input--time" value={toValue} aria-label="To time"
                    onChange={(e) => setToPicked(e.target.value === NOW ? null : Number(e.target.value))}>
              {toChoices.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
              {isToday && <option value={NOW}>{nowText}</option>}
            </select>
          </label>
          {!timeIsDefault && (
            <button type="button" className="sp4-filter-chip" onClick={() => { setFromH(0); setToPicked(null); }} title="Back to 00:00 to now">Reset hours</button>
          )}
          <button type="button" className={"sp4-filter-chip" + (day === today ? " sp4-filter-chip--on" : "")} onClick={() => setDay(today)}>Today</button>
          <button type="button" className={"sp4-filter-chip" + (day === shiftDay(today, -1) ? " sp4-filter-chip--on" : "")} onClick={() => setDay(shiftDay(today, -1))}>Yesterday</button>
          <button type="button" className="sp4-filter-chip" onClick={log.reload} disabled={log.status === "loading"} title="Read the day again">
            <i className="ti ti-refresh" aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      </div>

      <div className="sp4-body gl-body">
        {log.status === "loading" ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Gate Log">Sign-outs and returns for {dayWords(day)}.</EmptyNote>
        ) : log.status === "error" ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Gate Log Could Not Be Loaded" action={{ label: "Try again", onClick: log.reload }}>{log.message}</EmptyNote>
        ) : rows.length === 0 ? (
          <EmptyNote icon="ti-door-exit" tone="info" title="No Gate Events">{q ? `Nothing matches “${q}”.` : `No unit signed out or returned on ${dayWords(day)}.`}</EmptyNote>
        ) : (
          <>
            {(log.more || log.cut) && (
              <p className="sp4-muted gl-note" role="status">
                {log.more ? "Reading earlier lines…" : "The newest lines only: this day is longer than the page reads."}
              </p>
            )}
            {/* The Weighbridges page's card (operator, 2026-11-25): a frame with a
                gutter, so the table does not run into the side menu. */}
            <div className="wb-grid-card">
            <div className="sp4-table-scroll sp4-keep-table wb-grid gl-table">
              <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
                <thead>
                  <tr>
                    <th className="sp4-th--left">Time</th>
                    <th className="sp4-th--left sp4-th--pin">Unit</th>
                    <th className="sp4-th--left">Event</th>
                    <th className="sp4-th--left">Details</th>
                    <th className="sp4-th--left">Out</th>
                    <th className="sp4-th--left">In</th>
                    <th className="sp4-th--left">Time out</th>
                    <th className="sp4-th--left">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((r) => (
                    <tr key={r.key} data-gl-row={r.key} className={"sp4-tr" + (focusId === r.key ? " sp4-tr--selected" : "")} onClick={() => setFocusId(r.key)}>
                      <td className="sp4-td--left gl-time">{clock(r.at)}</td>
                      <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{r.plate ?? "-"}</span></td>
                      <td className="sp4-td--left"><span className={`gl-event gl-event--${r.way}`}>{r.label}</span></td>
                      <td className="sp4-td--left gl-text">{r.text}</td>
                      {(() => {
                        const t = trips.get(r.key);
                        return (
                          <>
                            {/* A sign-out always shows its own time out, paired or not. */}
                            <td className="sp4-td--left gl-time"><TripTime ms={t?.outAt ?? (r.way === "out" ? r.at : null)} day={day} /></td>
                            {/* A return always shows its own time in, paired or not (operator, 2026-11-25). */}
                            <td className="sp4-td--left gl-time"><TripTime ms={t?.inAt ?? (r.way === "in" ? r.at : null)} day={day} /></td>
                            <td className="sp4-td--left gl-time">
                              {/* Not back yet: a dash, as for In (operator, 2026-11-25). */}
                              {!t || t.open ? <span className="sp4-muted">–</span>
                                : <b className="gl-dur">{durationWords(t.outMs)}</b>}
                            </td>
                          </>
                        );
                      })()}
                      <td className="sp4-td--left"><span className={`gl-source gl-source--${r.source}`}>{GATE_SOURCES[r.source].label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager pager={pager} label="Gate log pages" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
