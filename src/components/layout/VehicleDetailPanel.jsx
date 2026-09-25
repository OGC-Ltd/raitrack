// VehicleDetailPanel — corporate right panel, wired to live server data.
// Tabs: Overview | Fuel | Alerts | Safety | Faults
//
// Data sources
//   vehicle (prop)      FleetLiveContext snapshot + SSE, normalised by lib/vehicleMap
//   telemetry per day   GET /organisations/:org/vehicles/:id/telemetry  (fuel curve, overspeed, fuel used, idle)
//   playback per day    GET /organisations/:org/vehicles/:id/playback   (Alerts tab, date range)
//   place name          GET /reverse-geocode                            (subtitle)
//
// Anything the server does not provide yet is shown as "Not available" — never invented.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useAppContext } from '../../context/AppContext';
import { useMapLayers } from '../../context/MapLayersContext';
import { usePermissions } from '../../hooks/usePermissions';
import { requestOpenDriver } from '../../lib/driverHandoff';
import { createReport, addSectionTitle, addSummaryCards, addTable, downloadReport } from '../../utils/pdfReport';
import { usePlaceName } from '../../hooks/usePlaceName';
import { fleetDayKey } from '../../hooks/useFuelEvents';
import { vehicleReadings } from '../../lib/vehicleReadings';
import { cachedDay, dayBounds, loadDay, summariseDay } from '../../lib/vehicleDay';
import './VehicleDetailPanel.css';

// ── Config ──────────────────────────────────────────────────────────────────
const FUEL_PRICE_KSH = 190;          // KSh per litre, for the cost estimate
const RESERVE_PCT    = 25;           // fuel reserve threshold (%)
const NA             = 'Not available';
const TODAY_REFRESH_MS = 60_000;     // re-read today's tail while the panel is open

// ── Helpers ─────────────────────────────────────────────────────────────────

function initials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(name).slice(0, 2).toUpperCase() || '?';
}

// status comes from lib/vehicleMap deriveStatus(): theft | speeding | parked | idling | ok
function statusTag(v) {
  if (v.status === 'theft')    return { text: 'Fuel theft', tone: 'danger' };
  if (v.status === 'speeding') return { text: 'Speeding',   tone: 'danger' };
  if (!v.online)               return { text: 'Offline',    tone: 'muted'  };
  if (v.status === 'idling')   return { text: 'Idling',     tone: 'idle'   };  // cyan, as on the map and the status chips
  if ((v.speed ?? 0) > 0)      return { text: 'Moving',     tone: 'ok'     };
  return { text: 'Parked', tone: 'muted' };
}

const HHMM = new Intl.DateTimeFormat('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtTime = (ms) => (Number.isFinite(ms) ? HHMM.format(ms) : '—');

function fmtMinutes(min) {
  if (min == null || !Number.isFinite(min)) return NA;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function num(n, digits = 0) {
  return n == null || !Number.isFinite(n)
    ? NA
    : Number(n).toLocaleString('en-KE', { maximumFractionDigits: digits });
}

function timeAgo(ms) {
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Today's telemetry (fuel series, fuel used, idle time) ───────────────────

// Fleet days run on Nairobi time (UTC+3), same calendar as hooks/useFuelEvents
const dayStart = (dayKey) => new Date(dayBounds(dayKey).start);
function addDays(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromKey, toKey) {
  const out = [];
  for (let k = fromKey; k <= toKey && out.length < 31; k = addDays(k, 1)) out.push(k);
  return out;
}
const DAY_LABEL = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDay = (key) => DAY_LABEL.format(new Date(`${key}T00:00:00.000Z`));

// One day of this unit's readings, via lib/vehicleDay: one request, kept for
// the session. What is already held draws at once; today's tail is re-read in
// the background and every TODAY_REFRESH_MS while the panel is open.
function useDayTelemetry(orgId, vehicleId, dayKey) {
  const initial = () => {
    const held = orgId && vehicleId && dayKey ? cachedDay(orgId, vehicleId, dayKey) : null;
    return { pings: held?.pings ?? [], loading: Boolean(orgId && vehicleId && dayKey && !held), error: null };
  };
  const [state, setState] = useState(initial);

  useEffect(() => {
    if (!orgId || !vehicleId || !dayKey) { setState({ pings: [], loading: false, error: null }); return undefined; }
    let live = true;
    setState(initial());
    const pull = () => loadDay(orgId, vehicleId, dayKey)
      .then(r => { if (live) setState(s => (s.pings === r.pings && !s.loading ? s : { pings: r.pings, loading: false, error: null })); return r; })
      .catch(err => {
        if (!live) return null;
        // Keep what is already drawn; only an empty chart reports the failure.
        setState(s => (s.pings.length ? { ...s, loading: false } : { pings: [], loading: false, error: err?.message ?? 'Could not load telemetry' }));
        return null;
      });
    let timer = null;
    pull().then(r => {
      if (live && r && !r.complete) timer = setInterval(pull, TODAY_REFRESH_MS);
    });
    return () => { live = false; if (timer) clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, vehicleId, dayKey]);

  return state;
}

/**
 * Today's telemetry, kept live.
 *
 * The day's pings are fetched once when the panel opens. After that, every
 * live frame the map receives for this unit (SSE `position`, merged onto the
 * vehicle by lib/vehicleMap) is added as another ping. That way the fuel line
 * and the overspeed marks keep growing while the panel is open, without
 * re-fetching the day.
 *
 * A frame is added only if it is newer than the last ping held, so a fetch
 * that already includes it doesn't draw it twice. The fetch replacing `pings`
 * starts the live tail again. Live frames don't carry the consumption counter
 * (`fuelUsedMl`), so "fuel used" still comes from the fetched pings only.
 */
export function appendLiveFrame(tail, fetched, vehicle) {
  const t = vehicle?.capturedAtMs;
  if (!Number.isFinite(t)) return tail;
  const last = tail.length ? tail[tail.length - 1].t
    : fetched.length ? fetched[fetched.length - 1].t : -Infinity;
  if (t <= last) return tail;
  return [...tail, {
    t,
    speedKmh:    Number.isFinite(vehicle.speed) ? vehicle.speed : null,
    fuelLevelMl: Number.isFinite(vehicle.fuelLitres) ? vehicle.fuelLitres * 1000 : null,
    engineOn:    vehicle.engine === 'on' ? true : vehicle.engine === 'off' ? false : null,
    // The snapshot's limit is the one where the unit is now
    limitKmh:    Number.isFinite(vehicle.speedLimit) ? vehicle.speedLimit : null,
  }];
}

function useLiveTelemetry(tele, vehicle) {
  const [tail, setTail] = useState([]);
  const unitId = vehicle?.id;

  useEffect(() => { setTail([]); }, [tele.pings, unitId]);

  const t = vehicle?.capturedAtMs;
  useEffect(() => {
    if (tele.loading || !Number.isFinite(t)) return;
    // Only today's frames belong on today's chart
    if (t < dayStart(fleetDayKey()).getTime()) return;
    setTail(prev => appendLiveFrame(prev, tele.pings, vehicle));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tele.loading, tele.pings]);

  return useMemo(
    () => (tail.length ? { ...tele, pings: [...tele.pings, ...tail] } : tele),
    [tele, tail],
  );
}

// Overspeed runs: consecutive pings above the limit, merged into one event
// Each ping is judged by its own limit where the server sent one (an org whose
// limit depends on place), else by the unit's single `limit`.
function overspeedRuns(pings, limit) {
  const runs = [];
  let cur = null;
  for (const p of pings) {
    const spd = p.speedKmh ?? 0;
    const lim = Number.isFinite(p.limitKmh) ? p.limitKmh : limit;
    if (spd > lim) {
      if (cur && p.t - cur.end <= 2 * 60_000) {
        cur.end = p.t;
        if (spd > cur.max) { cur.max = spd; cur.limit = lim; }
      } else { cur = { start: p.t, end: p.t, max: spd, limit: lim }; runs.push(cur); }
    } else if (cur && p.t - cur.end > 2 * 60_000) {
      cur = null;
    }
  }
  return runs;
}

// "80", or "60–100 by zone" where the day's readings carry more than one limit
function limitLabel(pings, limit) {
  const seen = new Set(pings.map(p => p.limitKmh).filter(Number.isFinite));
  if (seen.size < 2) return String(seen.size ? [...seen][0] : limit);
  return `${Math.min(...seen)}–${Math.max(...seen)} by zone`;
}

// Fuel used, with where the figure came from when it is not the device counter
function usedText(sum) {
  if (sum.usedL == null) return NA;
  return `${num(sum.usedL, 1)} L${sum.usedSource === 'level' ? ' (from tank level)' : ''}`;
}

// ── AI summary (written locally from live fields) ───────────────────────────

function AISummary({ vehicle, readings, place, usedL }) {
  const parts = [];
  const where = place ? ` near ${place}` : '';
  if (!vehicle.online) {
    const ago = timeAgo(readings.lastReportedAt);
    parts.push(`${vehicle.id} is offline${ago ? ` — last reported ${ago}` : ''}${where}.`);
  } else if ((vehicle.speed ?? 0) > 0) {
    parts.push(`${vehicle.id} is moving at ${vehicle.speed} km/h${where}.`);
  } else {
    parts.push(`${vehicle.id} is stationary${where}${vehicle.engine === 'on' ? ' with the engine running' : ''}.`);
  }
  if (vehicle.status === 'theft')    parts.push('A fuel incident is flagged on this unit — review it and consider dispatching security.');
  if (vehicle.status === 'speeding' && vehicle.speedLimit) parts.push(`It is over the ${vehicle.speedLimit} km/h limit.`);
  if (readings.fuelPct != null) {
    parts.push(`Fuel is at ${readings.fuelPct}%${readings.fuelPct < RESERVE_PCT ? ', below reserve' : ''}.`);
  } else if (readings.fuelProbeFault) {
    parts.push('The fuel probe is reporting a fault.');
  }
  if (usedL != null) parts.push(`${num(usedL, 1)} L used today.`);
  const loaded = vehicle.cargo && vehicle.cargo !== 'Empty' && vehicle.cargo !== 'No load expected';
  if (loaded) parts.push(`Carrying ${vehicle.cargo}${vehicle.weight ? ` (${vehicle.weight} t)` : ''}.`);
  else if (vehicle.cargo === 'Empty') parts.push('Running empty.');
  if (vehicle.destination) parts.push(`Heading to ${vehicle.destination}.`);

  return (
    <div className="vdp-ai">
      <div className="vdp-ai-title">AI summary</div>
      <p className="vdp-ai-text">{parts.join(' ')}</p>
    </div>
  );
}

// ── Fuel level chart (today, real readings) ─────────────────────────────────

// Nearest item to `t` in a time-ordered array (binary search)
function nearestByT(arr, t) {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid; else hi = mid;
  }
  return Math.abs(arr[lo].t - t) <= Math.abs(arr[hi].t - t) ? arr[lo] : arr[hi];
}

const MIN_ZOOM_MS    = 10 * 60_000;  // narrowest stretch a drag can zoom to
const READING_NEAR_MS = 15 * 60_000; // a fuel reading further off than this is "none"
const FUEL_COLOR  = '#f59e0b';  // amber
const SPEED_COLOR = '#0ea5e9';  // sky blue

// `unit` is '%' when the tank size is known, else 'L' (litres, scaled to the day).
// `pings` supply speed and ignition for the readout under the cursor.
function FuelChart({ series, unit = '%', loading, overspeeds = [], dayLabel = 'today', pings = [], limit = 80 }) {
  const speeds = useMemo(() => pings.filter(p => Number.isFinite(p.speedKmh)).map(p => ({ t: p.t, v: p.speedKmh })), [pings]);
  if (loading) return <div className="vdp-empty">Loading fuel readings…</div>;
  // A unit with no fuel probe still gets the chart, drawn from its speed alone
  if (series.length < 2 && speeds.length < 2) return <div className="vdp-empty">No readings for this unit {dayLabel}.</div>;
  return <FuelChartPlot series={series} speeds={speeds} unit={unit} overspeeds={overspeeds} pings={pings} limit={limit} />;
}

/*
 * Interactive: move over it (or drag a finger along it) to read the time, fuel,
 * speed and engine state at that moment; drag with the mouse to zoom into a
 * stretch; tap an overspeed mark to zoom to it. Arrow keys step the cursor,
 * Escape clears it, double-click or "Whole day" zooms back out.
 */
function FuelChartPlot({ series, speeds, unit, overspeeds, pings, limit }) {
  const svgRef = useRef(null);
  const [cursor, setCursor] = useState(null);     // ms under the pointer, or null
  const [pinnedRun, setPinnedRun] = useState(null);
  const [zoom, setZoom] = useState(null);         // [from, to] ms, or null = whole day
  const [drag, setDrag] = useState(null);         // { a, b } ms while mouse-dragging
  const dragRef = useRef(null);                   // same, readable between renders

  const pct = unit === '%';
  const W = 320, H = 118, PL = 24, PT = 6, PB = 18;
  const cW = W - PL, cH = H - PT - PB;
  const hasFuel = series.length >= 2;
  const ends = [series[0]?.t, series[series.length - 1]?.t, speeds[0]?.t, speeds[speeds.length - 1]?.t].filter(Number.isFinite);
  const dayT0 = Math.min(...ends), dayT1 = Math.max(...ends);
  const [t0, t1] = zoom ?? [dayT0, dayT1];
  const span = Math.max(1, t1 - t0);
  const visible = useMemo(() => series.filter(p => p.t >= t0 && p.t <= t1), [series, t0, t1]);
  // Litres: the top of the axis is the day's highest reading, rounded up.
  const top = useMemo(
    () => (pct ? 100 : Math.max(10, Math.ceil(series.reduce((m, p) => Math.max(m, p.v), 0) / 10) * 10)),
    [pct, series],
  );
  // Speed shares the plot on its own scale (right-hand axis), up to the day's
  // top speed or a little over the limit, whichever is higher.
  const sTop = useMemo(
    () => Math.max(20, Math.ceil(Math.max(limit * 1.25, speeds.reduce((m, p) => Math.max(m, p.v), 0)) / 20) * 20),
    [limit, speeds],
  );
  const x = (t) => PL + ((t - t0) / span) * cW;
  const y = (v) => PT + cH - (Math.min(top, Math.max(0, v)) / top) * cH;
  const ys = (v) => PT + cH - (Math.min(sTop, Math.max(0, v)) / sTop) * cH;

  // Thin to ~160 points so a busy day stays light to draw
  const step = Math.max(1, Math.floor(visible.length / 160));
  const pts = visible.filter((_, i) => i % step === 0 || i === visible.length - 1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${x(pts[pts.length - 1].t)},${PT + cH} L${x(pts[0].t)},${PT + cH} Z` : '';
  const reserveY = y(RESERVE_PCT);
  const cross = pct && pts.find((p, i) => i > 0 && pts[i - 1].v >= RESERVE_PCT && p.v < RESERVE_PCT);
  const runs = overspeeds.filter(o => o.end >= t0 && o.start <= t1);
  const sVisible = speeds.filter(p => p.t >= t0 && p.t <= t1);
  const sStep = Math.max(1, Math.floor(sVisible.length / 240));
  const speedLine = sVisible
    .filter((_, i) => i % sStep === 0 || i === sVisible.length - 1)
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${ys(p.v).toFixed(1)}`).join(' ');

  // Pointer position -> time, clamped to the plotted window
  const tAt = (clientX) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    const vx = ((clientX - r.left) / r.width) * W;
    return Math.round(t0 + ((Math.min(W, Math.max(PL, vx)) - PL) / cW) * span);
  };

  const onPointerDown = (e) => {
    const t = tAt(e.clientX);
    if (t == null) return;
    setPinnedRun(null);
    if (e.pointerType === 'mouse') {
      if (e.button === 0) { dragRef.current = { a: t, b: t }; setDrag(dragRef.current); }
    }
    else setCursor(t);
  };
  const onPointerMove = (e) => {
    const t = tAt(e.clientX);
    if (t == null) return;
    setCursor(t);
    if (dragRef.current) { dragRef.current = { ...dragRef.current, b: t }; setDrag(dragRef.current); }
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    const a = Math.min(d.a, d.b), b = Math.max(d.a, d.b);
    dragRef.current = null;
    setDrag(null);
    // A click is not a zoom; a drag has to cover a real stretch of time
    if (b - a >= Math.max(MIN_ZOOM_MS, span * 0.03)) setZoom([a, b]);
  };
  const onLeave = (e) => {
    if (e.pointerType === 'mouse') { setCursor(null); dragRef.current = null; setDrag(null); }
  };
  const onKeyDown = (e) => {
    const stepMs = Math.max(60_000, span / 60);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();   // the panel uses ← → to step tracked units
      const from = cursor ?? (e.key === 'ArrowRight' ? t0 : t1);
      setCursor(Math.min(t1, Math.max(t0, from + (e.key === 'ArrowRight' ? stepMs : -stepMs))));
    } else if (e.key === 'Escape' && (cursor != null || pinnedRun)) {
      e.stopPropagation();   // clear the cursor first; the next Escape closes the panel
      setCursor(null);
      setPinnedRun(null);
    }
  };
  const zoomOut = () => { setZoom(null); setPinnedRun(null); };
  const zoomToRun = (o) => {
    const pad = Math.max(5 * 60_000, (o.end - o.start) * 2);
    setZoom([Math.max(dayT0, o.start - pad), Math.min(dayT1, o.end + pad)]);
    setPinnedRun(o);
    setCursor(null);
  };

  const fuelAt = cursor != null ? nearestByT(series, cursor) : null;
  const fuelNear = fuelAt && Math.abs(fuelAt.t - cursor) <= READING_NEAR_MS ? fuelAt : null;
  const pingAt = cursor != null ? nearestByT(pings, cursor) : null;
  const runAt = pinnedRun ?? (cursor != null ? runs.find(o => cursor >= o.start - 60_000 && cursor <= o.end + 60_000) : null);
  const fmtV = (v) => (pct ? `${Math.round(v)}%` : `${num(v, 0)} L`);

  let readout;
  if (runAt) {
    const mins = Math.round((runAt.end - runAt.start) / 60_000);
    // One reading over the limit has no duration to report
    const when = fmtTime(runAt.start) === fmtTime(runAt.end)
      ? `at ${fmtTime(runAt.start)}`
      : `${fmtTime(runAt.start)}–${fmtTime(runAt.end)}`;
    readout = (
      <span className="vdp-readout-run">
        Overspeed {when} · max {Math.round(runAt.max)} km/h{Number.isFinite(runAt.limit) ? ` (limit ${runAt.limit})` : ''}{mins >= 1 ? ` · ${mins} min` : ''}
      </span>
    );
  } else if (cursor != null) {
    readout = (<>
      <b>{fmtTime(cursor)}</b>
      {hasFuel && <span>{fuelNear ? fmtV(fuelNear.v) : 'no fuel reading'}</span>}
      {pingAt && Number.isFinite(pingAt.speedKmh) && <span>{Math.round(pingAt.speedKmh)} km/h</span>}
      {pingAt && pingAt.engineOn != null && <span>engine {pingAt.engineOn ? 'on' : 'off'}</span>}
    </>);
  } else {
    readout = (
      <span className="vdp-readout-hint">
        Hover or slide along the chart to read it{runs.length ? ' · tap a red mark for the overspeed' : ''}
      </span>
    );
  }

  const cx = cursor != null ? x(cursor) : null;
  return (
    <div className="vdp-chart-wrap">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        className={`vdp-chart vdp-chart--live${drag ? ' vdp-chart--dragging' : ''}`}
        tabIndex={0}
        role="img"
        aria-label={`${hasFuel ? 'Fuel level and speed' : 'Speed'} from ${fmtTime(t0)} to ${fmtTime(t1)}. Use the arrow keys to read values.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onLeave}
        onDoubleClick={zoomOut}
        onKeyDown={onKeyDown}
      >
        <defs>
          <clipPath id="vdp-plot-clip"><rect x={PL} y={0} width={cW} height={H} /></clipPath>
        </defs>
        {[top, top / 2, 0].map(p => (
          <g key={p}>
            <line x1={PL} y1={y(p)} x2={W} y2={y(p)} stroke="#eef1f4" strokeWidth="1" />
            {hasFuel && <text x={0} y={y(p) + 3} fontSize="8" fill="#94a3b8">{Math.round(p)}</text>}
          </g>
        ))}
        <text x={W - 2} y={PT + 8} fontSize="7.5" fill="#94a3b8" textAnchor="end">{sTop} km/h</text>
        <g clipPath="url(#vdp-plot-clip)">
          <path d={speedLine} fill="none" stroke={SPEED_COLOR} strokeWidth="1.2" strokeLinejoin="round" opacity="0.85" />
          {hasFuel && <path d={area} fill="rgba(245,158,11,0.10)" />}
          {pct && hasFuel && <line x1={PL} y1={reserveY} x2={W} y2={reserveY} stroke="#b91c1c" strokeWidth="1" strokeDasharray="4 3" />}
          {hasFuel && <path d={line} fill="none" stroke={FUEL_COLOR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
          {cross && <circle cx={x(cross.t)} cy={y(cross.v)} r="3.5" fill="#b91c1c" />}
          {runs.map((o, i, arr) => {
            // label only when there's room since the previous marker
            const showLabel = i === 0 || x(o.start) - x(arr[i - 1].start) > 26;
            const active = runAt === o;
            return (
              <g key={o.start} className="vdp-run"
                 onPointerDown={(e) => e.stopPropagation()}
                 onClick={(e) => { e.stopPropagation(); zoomToRun(o); }}>
                <rect x={x(o.start)} y={PT} width={Math.max(2, x(o.end) - x(o.start))} height={cH} fill="#b91c1c" opacity={active ? 0.18 : 0.08} />
                <line x1={x(o.start)} y1={PT} x2={x(o.start)} y2={PT + cH} stroke="#b91c1c" strokeWidth="1" strokeDasharray="2 2" />
                {/* a wider, invisible target so a finger can hit the mark */}
                <rect x={x(o.start) - 8} y={PT - 2} width="16" height="16" fill="transparent" />
                <circle cx={x(o.start)} cy={PT + 4} r={active ? 4 : 3} fill="#b91c1c" />
                {showLabel && <text x={x(o.start) + 4} y={PT + 7} fontSize="7.5" fill="#b91c1c">{Math.round(o.max)}</text>}
              </g>
            );
          })}
          {drag && (
            <rect x={x(Math.min(drag.a, drag.b))} y={PT} width={Math.abs(x(drag.b) - x(drag.a))} height={cH} fill="rgba(37,99,235,0.12)" />
          )}
          {cx != null && (
            <g pointerEvents="none">
              <line x1={cx} y1={PT} x2={cx} y2={PT + cH} stroke="#334155" strokeWidth="0.8" />
              {fuelNear && <circle cx={x(fuelNear.t)} cy={y(fuelNear.v)} r="3" fill="#fff" stroke={FUEL_COLOR} strokeWidth="1.5" />}
              {pingAt && Number.isFinite(pingAt.speedKmh) && Math.abs(pingAt.t - cursor) <= READING_NEAR_MS && (
                <circle cx={x(pingAt.t)} cy={ys(pingAt.speedKmh)} r="2.5" fill="#fff" stroke={SPEED_COLOR} strokeWidth="1.2" />
              )}
            </g>
          )}
        </g>
        {pct && hasFuel && <text x={PL + 4} y={reserveY - 4} fontSize="8" fill="#b91c1c" pointerEvents="none">reserve {RESERVE_PCT}%</text>}
        <text x={PL} y={H - 3} fontSize="8" fill="#94a3b8">{fmtTime(t0)}</text>
        <text x={W} y={H - 3} fontSize="8" fill="#94a3b8" textAnchor="end">{fmtTime(t1)}</text>
      </svg>
      <div className="vdp-readout" aria-live="polite">
        <span className="vdp-readout-vals">{readout}</span>
        {zoom && <button type="button" className="vdp-readout-reset" onClick={zoomOut}>Whole day</button>}
      </div>
    </div>
  );
}

// ── Alerts tab (recorded events over a date range) ──────────────────────────

const ALERT_SEVERITIES = new Set(['warning', 'critical']);
const MAX_RANGE_DAYS   = 14;

function useRangeEvents(orgId, vehicleId, fromKey, toKey) {
  const [state, setState] = useState({ events: [], distanceM: null, loading: false, error: null });

  useEffect(() => {
    if (!orgId || !vehicleId || !fromKey || !toKey) { setState({ events: [], distanceM: null, loading: false, error: null }); return undefined; }
    const ctrl = new AbortController();
    setState(s => ({ ...s, loading: true, error: null }));
    const days = daysBetween(fromKey, toKey).slice(0, MAX_RANGE_DAYS);
    Promise.all(days.map(day =>
      apiFetch(`/api/v1/organisations/${orgId}/vehicles/${vehicleId}/playback?day=${day}`, { signal: ctrl.signal })
        .then(res => res.data ?? null)
        .catch(err => { if (err?.name === 'AbortError') throw err; return null; }),
    ))
      .then(results => {
        if (ctrl.signal.aborted) return;
        const events = results.flatMap(r => r?.events ?? []).sort((a, b) => b.t - a.t);
        const distanceM = results.reduce((sum, r) => sum + (Number.isFinite(r?.distanceM) ? r.distanceM : 0), 0);
        const allFailed = results.every(r => r == null);
        setState({ events, distanceM, loading: false, error: allFailed ? 'Could not load alerts for this range' : null });
      })
      .catch(err => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        setState({ events: [], distanceM: null, loading: false, error: err?.message ?? 'Could not load alerts' });
      });
    return () => ctrl.abort();
  }, [orgId, vehicleId, fromKey, toKey]);

  return state;
}

function sevColor(sev) {
  if (sev === 'critical') return '#b91c1c';
  if (sev === 'warning')  return '#b7791f';
  return '#94a3b8';
}

const DT = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

function AlertsTab({ orgId, vehicleId }) {
  const today = fleetDayKey();
  const [from, setFrom] = useState(today);
  const [to,   setTo]   = useState(today);
  const [showAll, setShowAll] = useState(false);

  const setRange = (f, t) => {
    // keep from <= to and the span within MAX_RANGE_DAYS
    if (f > t) [f, t] = [t, f];
    if (daysBetween(f, t).length > MAX_RANGE_DAYS) f = addDays(t, -(MAX_RANGE_DAYS - 1));
    setFrom(f); setTo(t);
  };

  const { events, distanceM, loading, error } = useRangeEvents(orgId, vehicleId, from, to);
  const shown = showAll ? events : events.filter(e => ALERT_SEVERITIES.has(e.severity));
  const multiDay = from !== to;
  const presets = [
    { label: 'Today',   f: today,              t: today },
    { label: '7 days',  f: addDays(today, -6), t: today },
    { label: '14 days', f: addDays(today, -13), t: today },
  ];

  return (
    <section className="vdp-block vdp-block--last">
      <div className="vdp-block-head">
        <div className="vdp-block-title">Alerts</div>
        <span className="vdp-meta">{distanceM ? `${num(distanceM / 1000, 1)} km driven` : ''}</span>
      </div>

      {/* Range filter */}
      <div className="vdp-range">
        <div className="vdp-presets">
          {presets.map(p => (
            <button
              key={p.label}
              className={`vdp-chip${from === p.f && to === p.t ? ' vdp-chip--active' : ''}`}
              onClick={() => setRange(p.f, p.t)}
            >{p.label}</button>
          ))}
        </div>
        <div className="vdp-dates">
          <input type="date" className="vdp-date" value={from} max={today} onChange={e => e.target.value && setRange(e.target.value, to)} aria-label="From date" />
          <span className="vdp-date-sep">to</span>
          <input type="date" className="vdp-date" value={to} max={today} onChange={e => e.target.value && setRange(from, e.target.value)} aria-label="To date" />
        </div>
        <label className="vdp-toggle">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show all activity (stops, zones)
        </label>
      </div>

      {!vehicleId && <div className="vdp-empty">{NA}</div>}
      {vehicleId && loading && <div className="vdp-empty">Loading alerts…</div>}
      {vehicleId && !loading && error && <div className="vdp-empty">{error}</div>}
      {vehicleId && !loading && !error && shown.length === 0 && (
        <div className="vdp-empty">No {showAll ? 'activity' : 'alerts'} {from === today && to === today ? 'today' : `from ${fmtDay(from)} to ${fmtDay(to)}`}.</div>
      )}
      {!loading && shown.length > 0 && (
        <table className="vdp-events">
          <tbody>
            {shown.map((ev, i) => (
              <tr key={`${ev.t}-${i}`}>
                <td className="vdp-ev-time">{multiDay ? DT.format(ev.t) : fmtTime(ev.t)}</td>
                <td className="vdp-ev-dot"><span style={{ background: sevColor(ev.severity) }} /></td>
                <td className="vdp-ev-label">
                  {ev.label}
                  {ev.detail && <span className="vdp-ev-detail"> — {ev.detail}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Fuel tab (one day, custom date) ─────────────────────────────────────────

function FuelTab({ orgId, vehicle, vehicleId, readings, todayTele }) {
  const today = fleetDayKey();
  const [day, setDay] = useState(today);
  const isToday = day === today;
  // Reuse the Overview's request for today rather than fetching it twice
  const other = useDayTelemetry(orgId, isToday ? null : vehicleId, isToday ? null : day);
  const tele  = isToday ? todayTele : other;
  const limit = vehicle.speedLimit ?? 80;

  const sum   = useMemo(() => summariseDay(tele.pings, vehicle.tankCapacityL), [tele.pings, vehicle.tankCapacityL]);
  const runs  = useMemo(() => overspeedRuns(tele.pings, limit), [tele.pings, limit]);
  const topSpeed = sum.topSpeed ?? 0;
  const cost  = sum.usedL != null ? sum.usedL * FUEL_PRICE_KSH : null;
  const dayLabel = isToday ? 'today' : `on ${fmtDay(day)}`;

  return (<>
    <section className="vdp-block">
      <div className="vdp-block-head">
        <div className="vdp-block-title">
          Fuel &amp; overspeed
          {isToday && vehicle.online && <span className="vdp-live">live</span>}
        </div>
        <input
          type="date"
          className="vdp-date"
          value={day}
          max={today}
          onChange={e => e.target.value && setDay(e.target.value)}
          aria-label="Chart date"
        />
      </div>
      <FuelChart key={day} series={sum.series} unit={sum.unit} loading={tele.loading} overspeeds={runs} dayLabel={dayLabel} pings={tele.pings} limit={limit} />
      <div className="vdp-legend">
        <span><i className="vdp-legend-line" /> Fuel level ({sum.unit === '%' ? '%' : 'litres'})</span>
        <span><i className="vdp-legend-speed" /> Speed</span>
        <span><i className="vdp-legend-dot" /> Overspeed (km/h, limit {limitLabel(tele.pings, limit)})</span>
      </div>
    </section>
    <section className="vdp-block vdp-block--last">
      <div className="vdp-block-title">{isToday ? 'Today' : fmtDay(day)}</div>
      <dl className="vdp-kv">
        <div><dt>Fuel used</dt><dd>{usedText(sum)}</dd></div>
        <div><dt>Est. cost</dt><dd>{cost != null ? `KSh ${num(Math.round(cost))}` : NA}</dd></div>
        <div><dt>Refuelled</dt><dd>{sum.refilledL != null ? `${num(sum.refilledL, 0)} L` : NA}</dd></div>
        <div><dt>Distance</dt><dd>{sum.distanceKm != null ? `${num(sum.distanceKm, 1)} km` : NA}</dd></div>
        <div><dt>Moving time</dt><dd>{sum.movingMin != null ? fmtMinutes(sum.movingMin) : NA}</dd></div>
        <div><dt>Idle time</dt><dd>{sum.idleMin != null ? fmtMinutes(sum.idleMin) : NA}</dd></div>
        <div><dt>Engine hours</dt><dd>{sum.engineHoursToday != null ? `${num(sum.engineHoursToday, 1)} h` : NA}</dd></div>
        <div><dt>Overspeed events</dt><dd className={runs.length ? 'vdp-kv--danger' : ''}>{tele.pings.length ? runs.length : NA}</dd></div>
        <div><dt>Top speed</dt><dd className={topSpeed > limit ? 'vdp-kv--danger' : ''}>{tele.pings.length ? `${Math.round(topSpeed)} km/h` : NA}</dd></div>
        <div><dt>Current level</dt><dd>{readings.fuelPct != null ? `${readings.fuelPct}%` : readings.fuelLitres != null ? `${num(readings.fuelLitres)} L` : NA}</dd></div>
        <div><dt>Tank capacity</dt><dd>{vehicle.tankCapacityL != null ? `${num(vehicle.tankCapacityL)} L` : 'Not recorded'}</dd></div>
        <div><dt>Fuel probe</dt><dd className={readings.fuelProbeFault ? 'vdp-kv--danger' : ''}>{readings.fuelProbeFault ? 'Fault reported' : readings.fuelLitres != null ? 'Reporting' : 'No reading'}</dd></div>
      </dl>
    </section>
  </>);
}

// ── Quick-action helpers ────────────────────────────────────────────────────

async function buildVehicleReport({ orgId, vehicle, readings, today, runs, place, companyName }) {
  // Today's recorded events for the report body
  let events = [];
  try {
    const res = await apiFetch(`/api/v1/organisations/${orgId}/vehicles/${vehicle.vehicleId}/playback?day=${fleetDayKey()}`);
    events = res.data?.events ?? [];
  } catch { /* report still useful without events */ }

  const doc = createReport({
    companyName: companyName || 'Fleet',
    reportTitle: 'Vehicle Report',
    subtitle: `${vehicle.id} · ${fmtDay(fleetDayKey())}`,
  });
  addSummaryCards(doc, [
    { label: 'Fuel level',   value: readings.fuelPct != null ? `${readings.fuelPct}%` : '—' },
    { label: 'Fuel used',    value: today.usedL != null ? `${num(today.usedL, 1)} L` : '—' },
    { label: 'Engine hours', value: readings.engineHours != null ? `${num(readings.engineHours)} h` : '—' },
    { label: 'Odometer',     value: readings.odometerKm != null ? `${num(readings.odometerKm)} km` : '—' },
  ]);
  addSectionTitle(doc, 'Vehicle');
  addTable(doc, {
    head: ['Item', 'Value'],
    body: [
      ['Plate', vehicle.id],
      ['Driver', vehicle.driver ?? 'Unassigned'],
      ['Type', vehicle.vehicleType ?? '—'],
      ['Status', statusTag(vehicle).text],
      ['Location', place ?? vehicle.location ?? '—'],
      ['Last report', readings.lastReportedAt ? new Date(readings.lastReportedAt).toLocaleString('en-KE') : '—'],
      ['Load', vehicle.cargo ?? '—'],
      ['Idle time today', today.idleMin != null ? fmtMinutes(today.idleMin) : '—'],
      ['Distance today', today.distanceKm != null ? `${num(today.distanceKm, 1)} km` : '—'],
      ['Overspeed events today', String(runs.length)],
      ['Fuel probe', readings.fuelProbeFault ? 'Fault reported' : readings.fuelPct != null ? 'OK' : '—'],
    ],
  });
  if (events.length) {
    addSectionTitle(doc, "Today's events");
    addTable(doc, {
      head: ['Time', 'Event', 'Detail', 'Severity'],
      body: events.map(e => [fmtTime(e.t), e.label ?? '', e.detail ?? '', e.severity ?? '']),
    });
  }
  downloadReport(doc, `Vehicle-Report-${vehicle.id.replace(/\s+/g, '')}-${fleetDayKey()}.pdf`);
}

// ── Main component ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'fuel',     label: 'Fuel'     },
  { key: 'alerts',   label: 'Alerts'   },
  { key: 'safety',   label: 'Safety'   },
  { key: 'faults',   label: 'Faults'   },
];

export default function VehicleDetailPanel({ vehicle, onClose }) {
  const [tab, setTab] = useState('overview');
  const { orgId, vehicles = [] } = useFleetLiveShared();
  const { trackedIds, setTrackedIds, activeCompany, setDesktopActiveTab } = useAppContext();
  const { focusVehicle, startPlayback } = useMapLayers() ?? {};
  const { can } = usePermissions();
  const [reporting, setReporting] = useState(false);

  // Tracked list — only units that still exist in the live fleet, in the order added
  const trackedList = useMemo(() => {
    const live = new Set(vehicles.map(v => v.id));
    return (trackedIds ?? []).filter(id => live.has(id));
  }, [trackedIds, vehicles]);
  const isTracked = vehicle ? (trackedIds ?? []).includes(vehicle.id) : false;
  const navIndex  = vehicle ? trackedList.indexOf(vehicle.id) : -1;
  const canNav    = trackedList.length >= 2;

  const toggleTrack = () => {
    if (!vehicle) return;
    const ids = trackedIds ?? [];
    setTrackedIds(isTracked ? ids.filter(x => x !== vehicle.id) : [...ids, vehicle.id]);
  };

  // Step through the tracked list (wraps). If the open unit isn't tracked,
  // "next" starts at the first tracked unit and "previous" at the last.
  const step = useCallback((dir) => {
    if (trackedList.length < 2) return;
    const i = navIndex === -1 ? (dir > 0 ? -1 : 0) : navIndex;
    const next = trackedList[(i + dir + trackedList.length) % trackedList.length];
    focusVehicle?.(next);
  }, [trackedList, navIndex, focusVehicle]);

  // ← / → keys while the panel is open (ignored while typing in a field)
  useEffect(() => {
    if (!vehicle || !canNav) return undefined;
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vehicle, canNav, step]);

  /* Escape closes it.
   *
   * Separate from the arrow-key effect above because that one is gated on
   * `canNav` — with fewer than two tracked units it does not run at all, and
   * Escape has to work whether or not anything is tracked. On a tablet the
   * panel covers the map, which makes a keyboard dismissal the difference
   * between a panel and a trap. */
  useEffect(() => {
    if (!vehicle) return undefined;
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      const tag = e.target?.tagName;
      // Escape inside a field means "clear what I typed", not "close the
      // panel I typed it in".
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      onClose?.();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [vehicle, onClose]);

  const vehicleId = vehicle?.vehicleId ?? null;
  const readings  = useMemo(() => vehicleReadings(vehicle), [vehicle]);
  const place     = usePlaceName(
    Number.isFinite(vehicle?.lat) ? vehicle.lat : null,
    Number.isFinite(vehicle?.lng) ? vehicle.lng : null,
  );
  const dayTele = useDayTelemetry(orgId, vehicleId, fleetDayKey());
  const tele  = useLiveTelemetry(dayTele, vehicle);
  const today = useMemo(
    () => summariseDay(tele.pings, vehicle?.tankCapacityL),
    [tele.pings, vehicle?.tankCapacityL],
  );
  // Where today's driving began, for the header when no trip is on record
  const startPlace = usePlaceName(
    vehicle?.departure ? null : today.firstMove?.lat ?? null,
    vehicle?.departure ? null : today.firstMove?.lng ?? null,
  );

  const todayRuns = useMemo(() => overspeedRuns(tele.pings, vehicle?.speedLimit ?? 80), [tele.pings, vehicle?.speedLimit]);

  useEffect(() => { setTab('overview'); }, [vehicle?.id]);

  if (!vehicle) return <div className="vdp" />;

  const tag      = statusTag(vehicle);
  const hasDriver = Boolean(vehicle.driver && vehicle.driver !== 'Unassigned');
  const fuelPct  = readings.fuelPct;
  const lowFuel  = fuelPct != null && fuelPct < RESERVE_PCT;
  const cost     = today.usedL != null ? today.usedL * FUEL_PRICE_KSH : null;
  const updated  = readings.lastReportedAt ? fmtTime(readings.lastReportedAt) : null;
  const subtitle = [vehicle.driver ?? 'Unassigned', place ?? vehicle.location, updated].filter(Boolean).join(' · ');
  const rating   = Number.isFinite(vehicle.driverRatingScore) ? `${num(vehicle.driverRatingScore, 1)} / 5` : null;
  const lastSeen = timeAgo(readings.lastReportedAt);
  const gps = !readings.hasTracker
    ? { label: 'No tracker', sub: 'no GPS unit fitted', alert: false }
    : readings.isReporting
      ? { label: 'Reporting', sub: lastSeen ? `last fix ${lastSeen}` : 'live', alert: false }
      : { label: 'Not reporting', sub: lastSeen ? `last fix ${lastSeen}` : 'no fix received', alert: true };

  const fuelSub = fuelPct != null
    ? (lowFuel ? `below ${RESERVE_PCT}% reserve` : readings.fuelLitres != null ? `${num(readings.fuelLitres)} L in tank` : 'above reserve')
    : readings.fuelProbeFault ? 'fuel probe fault'
      : readings.fuelLitres != null ? 'in tank · tank size not recorded' : 'no calibrated probe';

  return (
    <div className="vdp vdp--open">

      {/* ── Header ── */}
      <div className="vdp-header">
        <div className="vdp-header-top">
          <div className="vdp-title">
            <span className="vdp-plate" title={vehicle.name && vehicle.name !== vehicle.id ? `${vehicle.id} — ${vehicle.name}` : vehicle.id}>{vehicle.id}</span>
            <span className={`vdp-tag vdp-tag--${tag.tone}`}>{tag.text}</span>
          </div>
          <div className="vdp-header-actions">
            {canNav && (
              <div className="vdp-nav" title="Step through tracked vehicles (← →)">
                <button className="vdp-nav-btn" onClick={() => step(-1)} aria-label="Previous tracked vehicle">‹</button>
                <span className="vdp-nav-count">{navIndex === -1 ? '–' : navIndex + 1} of {trackedList.length}</span>
                <button className="vdp-nav-btn" onClick={() => step(1)} aria-label="Next tracked vehicle">›</button>
              </div>
            )}
            <button className="vdp-close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" />
            </button>
          </div>
        </div>
        <div className="vdp-subtitle">{subtitle}</div>

        {/* Trip: where it left from and where it's heading */}
        <div className="vdp-trip">
          <div className="vdp-trip-row">
            <span className="vdp-trip-lbl">Departed</span>
            <span className="vdp-trip-val" title={vehicle.departure ?? ''}>
              {vehicle.departure
                ?? (today.firstMove ? `${startPlace ?? 'Moved'} · ${fmtTime(today.firstMove.t)}` : tele.loading ? '…' : 'Not moved today')}
            </span>
          </div>
          <div className="vdp-trip-row">
            <span className="vdp-trip-lbl">Destination</span>
            <span className="vdp-trip-val" title={vehicle.destination ?? ''}>{vehicle.destination ?? 'No trip assigned'}</span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="vdp-actions">
          <button
            className={`vdp-action${isTracked ? ' vdp-action--on' : ''}`}
            onClick={toggleTrack}
            title={isTracked ? 'Stop tracking this vehicle' : 'Add to tracked vehicles'}
          >
            {/* Says what pressing it again does: "✓ Tracking" read as a status. */}
            {isTracked ? 'Stop tracking' : 'Track'}
          </button>
          <button
            className="vdp-action"
            onClick={() => startPlayback?.(vehicle.id)}
            title="Replay today's route on the map"
          >
            Playback
          </button>
          {can('report:export') && (
            <button
              className="vdp-action"
              disabled={reporting || !vehicle.vehicleId || !orgId}
              onClick={async () => {
                setReporting(true);
                try {
                  await buildVehicleReport({ orgId, vehicle, readings, today, runs: todayRuns, place, companyName: activeCompany?.name });
                } finally {
                  setReporting(false);
                }
              }}
              title="Download today's vehicle report (PDF)"
            >
              {reporting ? 'Preparing…' : 'Report'}
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="vdp-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`vdp-tab${tab === t.key ? ' vdp-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="vdp-body">

        {/* ═════ OVERVIEW ═════ */}
        {tab === 'overview' && (<>

          {/* Driver + AI summary */}
          <section className="vdp-block">
            <div className="vdp-block-title">Driver</div>
            <div className="vdp-driver">
              <div className="vdp-av">{vehicle.driver && vehicle.driver !== 'Unassigned' ? initials(vehicle.driver) : '—'}</div>
              <div className="vdp-driver-info">
                {hasDriver && can('driver:read') ? (
                  <button
                    type="button"
                    className="vdp-driver-name vdp-driver-link"
                    onClick={() => { requestOpenDriver(vehicle.driver); setDesktopActiveTab('drivers'); onClose?.(); }}
                    title="Open this driver on the Drivers page"
                  >
                    {vehicle.driver}
                  </button>
                ) : (
                  <div className="vdp-driver-name">{vehicle.driver ?? 'Unassigned'}</div>
                )}
                <div className="vdp-driver-sub">
                  {rating ? `Rating ${rating}` : 'Rating not available'}
                  {vehicle.driverSource === 'last-dispatch' ? ' · drove today' : ''}
                </div>
              </div>
            </div>

            <AISummary vehicle={vehicle} readings={readings} place={place} usedL={today.usedL} />
          </section>

          {/* KPI cards */}
          <section className="vdp-block">
            <div className="vdp-kpis">
              <div className={`vdp-kpi${lowFuel ? ' vdp-kpi--alert' : ''}`}>
                <div className="vdp-kpi-lbl">Fuel level</div>
                <div className="vdp-kpi-val">{fuelPct != null ? `${fuelPct}%` : readings.fuelLitres != null ? `${num(readings.fuelLitres)} L` : '—'}</div>
                <div className="vdp-kpi-sub">{fuelSub}</div>
              </div>
              <div className={`vdp-kpi${gps.alert ? ' vdp-kpi--alert' : ''}`}>
                <div className="vdp-kpi-lbl">GPS status</div>
                <div className="vdp-kpi-val">{gps.label}</div>
                <div className="vdp-kpi-sub">{gps.sub}</div>
              </div>
              <div className="vdp-kpi">
                <div className="vdp-kpi-lbl">Engine hours</div>
                <div className="vdp-kpi-val">{readings.engineHours != null ? `${num(readings.engineHours)} h` : '—'}</div>
                <div className="vdp-kpi-sub">{readings.engineHours != null ? `engine ${readings.engineOn ? 'on' : readings.engineOn === false ? 'off' : 'state unknown'}` : NA}</div>
              </div>
              <div className="vdp-kpi">
                <div className="vdp-kpi-lbl">Odometer</div>
                <div className="vdp-kpi-val">{readings.odometerKm != null ? `${num(readings.odometerKm)} km` : '—'}</div>
                <div className="vdp-kpi-sub">{readings.odometerKm != null ? 'total mileage' : NA}</div>
              </div>
            </div>
          </section>

          {/* Fuel & overspeed — today, growing with every live frame */}
          <section className="vdp-block">
            <div className="vdp-block-head">
              <div className="vdp-block-title">
                Fuel &amp; overspeed
                {vehicle.online && <span className="vdp-live">live</span>}
              </div>
              <span className="vdp-meta">{updated ? `updated ${timeAgo(readings.lastReportedAt)}` : ''}</span>
            </div>
            <FuelChart key={vehicle.id} series={today.series} unit={today.unit} loading={tele.loading} overspeeds={todayRuns} pings={tele.pings} limit={vehicle.speedLimit ?? 80} />
            <div className="vdp-legend">
              <span><i className="vdp-legend-line" /> Fuel level ({today.unit === '%' ? '%' : 'litres'})</span>
              <span><i className="vdp-legend-speed" /> Speed</span>
              <span><i className="vdp-legend-dot" /> Overspeed (km/h, limit {limitLabel(tele.pings, vehicle.speedLimit ?? 80)})</span>
            </div>
          </section>

          {/* Vehicle */}
          <section className="vdp-block">
            <div className="vdp-block-title">Vehicle</div>
            <dl className="vdp-kv">
              <div><dt>Type</dt><dd>{vehicle.vehicleType ? vehicle.vehicleType.charAt(0) + vehicle.vehicleType.slice(1).toLowerCase() : NA}</dd></div>
              <div><dt>Fuel used today</dt><dd>{usedText(today)}</dd></div>
              <div><dt>Est. fuel cost today</dt><dd>{cost != null ? `KSh ${num(Math.round(cost))}` : NA}</dd></div>
              <div><dt>Load</dt><dd>{vehicle.cargo ? `${vehicle.cargo}${vehicle.weight ? ` · ${vehicle.weight} t` : ''}` : 'No load recorded'}</dd></div>
              <div><dt>Odometer</dt><dd>{readings.odometerKm != null ? `${num(readings.odometerKm)} km` : NA}</dd></div>
            </dl>
          </section>

          {/* Today, from the day's readings (lib/vehicleDay) */}
          <section className="vdp-block vdp-block--last">
            <div className="vdp-block-title">Today so far</div>
            <dl className="vdp-kv">
              <div><dt>Distance</dt><dd>{today.distanceKm != null ? `${num(today.distanceKm, 1)} km` : NA}</dd></div>
              <div><dt>Moving time</dt><dd>{today.movingMin != null ? fmtMinutes(today.movingMin) : NA}</dd></div>
              <div><dt>Idle time</dt><dd>{today.idleMin != null ? fmtMinutes(today.idleMin) : NA}</dd></div>
              <div><dt>Engine hours</dt><dd>{today.engineHoursToday != null ? `${num(today.engineHoursToday, 1)} h` : NA}</dd></div>
              <div><dt>Refuelled</dt><dd>{today.refilledL != null ? `${num(today.refilledL, 0)} L` : NA}</dd></div>
            </dl>
          </section>
        </>)}

        {/* ═════ FUEL ═════ */}
        {tab === 'fuel' && (
          <FuelTab orgId={orgId} vehicle={vehicle} vehicleId={vehicleId} readings={readings} todayTele={tele} />
        )}

        {/* ═════ ALERTS ═════ */}
        {tab === 'alerts' && <AlertsTab key={vehicleId} orgId={orgId} vehicleId={vehicleId} />}

        {/* ═════ SAFETY ═════ */}
        {tab === 'safety' && (
          <section className="vdp-block vdp-block--last">
            <div className="vdp-block-title">Speed &amp; safety</div>
            <dl className="vdp-kv">
              <div><dt>Current speed</dt><dd className={vehicle.status === 'speeding' ? 'vdp-kv--danger' : ''}>{vehicle.speed ?? 0} km/h</dd></div>
              <div><dt>Speed limit</dt><dd>{vehicle.speedLimit != null ? `${vehicle.speedLimit} km/h` : NA}</dd></div>
              <div><dt>Engine</dt><dd>{readings.engineOn == null ? NA : readings.engineOn ? 'On' : 'Off'}</dd></div>
              <div><dt>Driver rating</dt><dd>{rating ?? NA}</dd></div>
              <div><dt>Top speed today</dt><dd className={(today.topSpeed ?? 0) > (vehicle.speedLimit ?? 80) ? 'vdp-kv--danger' : ''}>{today.topSpeed != null ? `${Math.round(today.topSpeed)} km/h` : NA}</dd></div>
              <div><dt>Overspeed events today</dt><dd className={todayRuns.length ? 'vdp-kv--danger' : ''}>{tele.pings.length ? todayRuns.length : NA}</dd></div>
            </dl>
          </section>
        )}

        {/* ═════ FAULTS ═════ */}
        {tab === 'faults' && (
          <section className="vdp-block vdp-block--last">
            <div className="vdp-block-title">Diagnostics</div>
            <dl className="vdp-kv">
              <div><dt>Fuel probe</dt><dd className={readings.fuelProbeFault ? 'vdp-kv--danger' : ''}>{readings.fuelProbeFault ? 'Fault reported' : 'No fault reported'}</dd></div>
              <div><dt>Tracker</dt><dd>{!readings.hasTracker ? 'No tracker fitted' : readings.isReporting ? 'Reporting' : 'Not reporting'}</dd></div>
              <div><dt>Last report</dt><dd>{readings.lastReportedAt ? `${fmtTime(readings.lastReportedAt)} · ${timeAgo(readings.lastReportedAt)}` : NA}</dd></div>
              <div><dt>Engine hours</dt><dd>{readings.engineHours != null ? `${num(readings.engineHours)} h` : NA}</dd></div>
            </dl>
          </section>
        )}

      </div>
    </div>
  );
}