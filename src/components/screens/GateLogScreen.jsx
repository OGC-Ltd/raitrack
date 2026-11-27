// The Gate log (operator, 2026-11-25): the sign-outs and returns at the gate,
// one fleet day at a time, for the Ops Room Operator. View only.
//
// Read from fleet-server's own route on `gate_log:read` (api/gateLog), not the
// live feed: the Ops Room Operator holds no `notification:read`. Today's log
// is read again every minute while the page is open and the browser tab is
// in front; a past day is read once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { usePermissions } from "../../hooks/usePermissions";
import { getGateLogDay } from "../../api/gateLog";
import { gateRows, searchGate, shiftDay, bySource, GATE_SOURCES, gateTrips, gateUnits, durationWords, byHours, ACK_WORDS } from "../../lib/gateLog";
import { fleetDay } from "../../lib/alertsView";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import GateEventPanel from "./GateEventPanel";
import DateRangePicker from "../layout/DateRangePicker";
import "./DriversScreen.css";
import "./FuelScreen.css";
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
  if (ms == null) return <span className="gl-none">-</span>;
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
      .then((res) => { if (live && res) setState({ status: "ready", events: res.events, cut: res.cut, more: false, key, gate: res.gate ?? null }); })
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


/** The Acknowledged cell: what was said of the event and by whom, else a dash. */
function AckCell({ row }) {
  const a = row.ack;
  if (!a) return <span className="gl-none">-</span>;
  const w = ACK_WORDS[row.way]?.[a.outcome];
  const at = Date.parse(a.at);
  return (
    <span className="gl-ack__cell" title={a.note ? `${a.by}: ${a.note}` : a.by}>
      <span className={`dr-grid__badge gl-ack--${a.outcome === "DISPUTED" ? "no" : "yes"}`}>{w?.cell ?? a.outcome}</span>
      <span className="gl-ack__by">{a.by}{Number.isFinite(at) ? `, ${clock(at)}` : ""}</span>
    </span>
  );
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

  // Acknowledgements made here, laid over the rows until the next read brings them.
  const [acked, setAcked] = useState(() => new Map());
  const all = useMemo(() => {
    const rows = gateRows(log.events);
    return acked.size ? rows.map((r) => (acked.has(r.key) ? { ...r, ack: acked.get(r.key) } : r)) : rows;
  }, [log.events, acked]);
  const onAcked = useCallback((key, ack) => setAcked((m) => new Map(m).set(key, ack)), []);
  const { can } = usePermissions();
  const canAck = Boolean(can?.("gate_log:acknowledge"));
  // Each unit's sign-out paired with its next return, over the whole day whatever the filter (lib/gateLog gateTrips).
  const trips = useMemo(
    () => gateTrips(prevEvents ? [...gateRows(prevEvents), ...all] : all),
    [all, prevEvents],
  );
  const rows = useMemo(() => searchGate(byHours(bySource(all, source), fromH, toH), q), [all, source, fromH, toH, q]);
  const pager = usePager(rows, `${day}|${q}|${source}|${fromH}|${toValue}`);

  // The line last clicked stays marked, and opens its panel (operator, 2026-11-26).
  const [focusId, setFocusId] = useState(null);
  const focusRow = useMemo(() => (focusId ? all.find((r) => r.key === focusId) ?? null : null), [all, focusId]);
  const closePanel = useCallback(() => setFocusId(null), []);

  // The figures wait until the whole day is read; a part-read day would undercount.
  const ready = log.status === "ready" && !log.more;
  const figure = (n) => (ready ? n.toLocaleString("en-GB") : "-");
  const busy = log.status === "loading" || Boolean(log.more);
  const failed = log.status === "error";
  // The figures: hours and search applied, every source (a trip needs both its ends).
  const figureRows = useMemo(() => searchGate(byHours(all, fromH, toH), q), [all, fromH, toH, q]);
  const units = useMemo(() => gateUnits(figureRows), [figureRows]);
  const yesterday = shiftDay(today, -1);

  return (
    <div className="drivers-page gl-page">
      <div className="drivers-page__inner">
        {/* The Fuel page's head, strip, toolbar and table (operator, 2026-11-26: "adopt the theme and typography … use the fuel page to match"). */}
        <div className="dr-head">
          <div>
            <h1 className="dr-title">Gate log</h1>
          </div>
        </div>

        <div className="dr-layout">
          {/* The units that went out, once or more, and where each stands now (lib/gateLog
              gateUnits; operator, 2026-11-27: "numbers that are straightforward"). Each unit once,
              by its latest sign-out; every row and column adds up. */}
          <section className="gl-figures" aria-label="Units at the gate">
            <table className="gl-units">
              <thead>
                <tr><th scope="col" /><th scope="col">Units</th><th scope="col">Back</th><th scope="col">Still out</th></tr>
              </thead>
              <tbody>
                {[
                  ["Signed out once", units.once],
                  ["Signed out twice or more", units.twice],
                ].map(([label, r]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{busy || failed ? "-" : figure(r.units)}</td>
                    <td>{busy || failed ? "-" : figure(r.back)}</td>
                    <td>{busy || failed ? "-" : figure(r.out)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td>{busy || failed ? "-" : figure(units.total.units)}</td>
                  <td>{busy || failed ? "-" : figure(units.total.back)}</td>
                  <td>{busy || failed ? "-" : figure(units.total.out)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        </div>

        <div className="dr-filters gl-filters">
          <div className="dr-filters__chips" role="group" aria-label="Source">
            <span className="dr-rankby__label" aria-hidden="true">Source</span>
            <span className="dr-seg">
              {[["all", "All"], ["factorysuite", GATE_SOURCES.factorysuite.label], ["geofence", GATE_SOURCES.geofence.label]].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={source === k}
                        className={`dr-chip${source === k ? " dr-chip--active" : ""}`} onClick={() => setSource(k)}>{label}</button>
              ))}
            </span>
          </div>

          <span className="fuel-period">
            <span className="dr-seg" role="group" aria-label="Day shown">
              <button type="button" aria-pressed={day === today} className={`dr-chip${day === today ? " dr-chip--active" : ""}`} onClick={() => setDay(today)}>Today</button>
              <button type="button" aria-pressed={day === yesterday} className={`dr-chip${day === yesterday ? " dr-chip--active" : ""}`} onClick={() => setDay(yesterday)}>Yesterday</button>
            </span>
            {/* One day at a time: the app's calendar with no range (maxDays 1). */}
            <DateRangePicker from={day} to={day} today={today} maxDays={1} quickPicks={false} align="left"
              label="Pick a day" text={day === today || day === yesterday ? "Pick a day" : undefined}
              on={day !== today && day !== yesterday}
              onChange={(f) => { if (/^\d{4}-\d{2}-\d{2}$/.test(f) && f <= today) setDay(f); }} />
          </span>

          <span className="gl-hours">
            <label className="dr-typepick">
              <span className="dr-typepick__label">From</span>
              <select className="dr-typepick__select" value={fromH} aria-label="From hour"
                      onChange={(e) => setFromH(Number(e.target.value))}>
                {HOURS_FROM.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
              </select>
            </label>
            <label className="dr-typepick">
              <span className="dr-typepick__label">To</span>
              <select className="dr-typepick__select" value={toValue} aria-label="To time"
                      onChange={(e) => setToPicked(e.target.value === NOW ? null : Number(e.target.value))}>
                {toChoices.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
                {isToday && <option value={NOW}>{nowText}</option>}
              </select>
            </label>
            {!timeIsDefault && (
              <button type="button" className="dr-chip gl-tool" onClick={() => { setFromH(0); setToPicked(null); }} title="Back to 00:00 to now">Reset hours</button>
            )}
            <button type="button" className="dr-chip gl-tool" onClick={log.reload} disabled={log.status === "loading"} title="Read the day again">
              <i className="ti ti-refresh" aria-hidden="true" /> Refresh
            </button>
          </span>

          <div className="dr-searchwrap">
            <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input className="dr-search" type="text" aria-label="Search the gate log" placeholder="Search unit or details…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" className="gl-search-clear" onClick={() => setQ("")} aria-label="Clear the search">✕</button>}
          </div>
        </div>

        {log.status === "loading" ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Gate Log">Sign-outs and returns for {dayWords(day)}.</EmptyNote>
        ) : log.status === "error" ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Gate Log Could Not Be Loaded" action={{ label: "Try again", onClick: log.reload }}>{log.message}</EmptyNote>
        ) : rows.length === 0 ? (
          <EmptyNote icon="ti-door-exit" tone="info" title="No Gate Events">{q ? `Nothing matches “${q}”.` : `No unit signed out or in on ${dayWords(day)}.`}</EmptyNote>
        ) : (
          <>
            {(log.more || log.cut) && (
              <p className="dr-subtitle gl-note" role="status">
                {log.more ? "Reading earlier lines…" : "The newest lines only: this day is longer than the page reads."}
              </p>
            )}
            <div className="dr-grid-card">
              <div className="dr-grid-scroll">
                <table className="dr-grid gl-grid">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Unit</th>
                      <th>Event</th>
                      <th>Details</th>
                      <th>Out</th>
                      <th>In</th>
                      <th>Time out</th>
                      <th>Source</th>
                      <th>Acknowledged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.pageRows.map((r) => {
                      const t = trips.get(r.key);
                      return (
                        <tr key={r.key} data-gl-row={r.key} className={focusId === r.key ? "dr-grid__row--selected" : undefined} tabIndex={0}
                            aria-label={`${r.plate ?? "Unit"}, ${r.label} at ${clock(r.at)}: open its details`}
                            onClick={() => setFocusId(r.key)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFocusId(r.key); } }}>
                          <td className="dr-num gl-time" data-label="Time">{clock(r.at)}</td>
                          <td className="gl-unit"><span className="dr-driver__name">{r.plate ?? "-"}</span></td>
                          <td className="gl-event">
                            <span className={`dr-grid__badge gl-event--${r.way}`}>{r.label}</span>
                          </td>
                          <td className="gl-text" data-label="Details">{r.text}</td>
                          {/* A sign-out always shows its own time out, paired or not. */}
                          <td className="dr-num gl-time" data-label="Out"><TripTime ms={t?.outAt ?? (r.way === "out" ? r.at : null)} day={day} /></td>
                          {/* A return always shows its own time in, paired or not (operator, 2026-11-25). */}
                          <td className="dr-num gl-time" data-label="In"><TripTime ms={t?.inAt ?? (r.way === "in" ? r.at : null)} day={day} /></td>
                          <td className="dr-num gl-time" data-label="Time out">
                            {/* Not back yet: a dash, as for In (operator, 2026-11-25). */}
                            {!t || t.open ? <span className="gl-none">-</span>
                              : <b className="gl-dur">{durationWords(t.outMs)}</b>}
                          </td>
                          <td className="gl-source" data-label="Source">{GATE_SOURCES[r.source].label}</td>
                          <td className="gl-ack" data-label="Acknowledged"><AckCell row={r} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePager pager={pager} label="Gate log pages" />
            </div>
          </>
        )}
      </div>
      {focusRow && (
        <GateEventPanel key={focusRow.key} row={focusRow} trip={trips.get(focusRow.key) ?? null} day={day}
          orgId={orgId} gate={log.gate ?? null} onClose={closePanel} canAck={canAck} onAcked={onAcked} />
      )}
    </div>
  );
}
