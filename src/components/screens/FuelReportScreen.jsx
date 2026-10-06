/**
 * Fuel › Report — advanced fuel analysis for one unit over a period.
 *
 * The page the operators know from ControlTech's "Advanced Fuel Analysis
 * Report": pick a unit and an interval, Execute, and read what the tank did —
 * statistics, the fuel graph with trips / stops / parkings behind it, every
 * filling and drain, the trips themselves, and the track on a map.
 *
 * Every figure is worked out in lib/fuelReport from the same readings the
 * vehicle panel's chart draws (lib/vehicleDay) and the same fuel ledger the
 * alerts are judged on (hooks/useVehicleFuelEvents). Nothing here is a second
 * opinion about a drop: drains carry the adjudicator's verdict as given.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceDot,
} from "recharts";
import "../body/SensorPanel.css";
import "./FuelReportScreen.css";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { loadDay } from "../../lib/vehicleDay";
import { loadVehicleFuelEvents } from "../../hooks/useVehicleFuelEvents";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { fleetDaysBetween } from "../../lib/weighbridgeBoard";
import { settleLimited } from "../../lib/settleLimited";
import { buildFuelReport, chartSeries, durationLabel, haversineM } from "../../lib/fuelReport";
import { loadMapEngine, maps as mapsNs } from "../../lib/mapEngine";
import { installOsmBase, OSM_TYPE_ID, OSM_ATTRIBUTION } from "../../lib/osmBase";
import MapStatusBar from "../body/MapStatusBar";
import { spriteIcon, bearingDeg } from "../../lib/fleetSprite";
import { spriteKind } from "../../lib/vehicleMap";
import { zoomView, panView, isWholeDay, wheelPixels, zoomFactor } from "../../lib/chartView";
import { pumpSvg, stopSvg, svgUrl, FILL_COLOR, DRAIN_COLOR } from "../../lib/fuelIcons";
import { downloadTableCsv } from "../../utils/tableExport";
import { buildSensorReport } from "../../utils/sensorReport";
import TableToolbar from "../body/TableToolbar";
import EmptyNote from "../shared/EmptyNote";
import UnitPicker from "../body/UnitPicker";
import FuelReportOverview from "./FuelReportOverview";
import { TripsView, ParkingsView } from "./FuelReportSegments";
import { watchTableLabels } from "../../lib/tableLabels";
import {
  unitChosen, spanChosen, executed, tabChosen, headerToggled, layerToggled,
} from "../../store/fuelReportSlice";

const H = 3_600_000;
const DAY = 86_400_000;
/** One report reads at most a month of days — each is one request. */
const MAX_DAYS = 31;
const TZ = "Africa/Nairobi";

const fmtNum = (n, d = 1) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-KE", { maximumFractionDigits: d, minimumFractionDigits: d });
const L = (n) => (n == null ? "—" : `${fmtNum(n, 1)} L`);
const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ,
});
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const dayMon = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
const at = (ms) => (Number.isFinite(ms) ? stamp.format(ms) : "—");

/** "YYYY-MM-DDTHH:mm" in Nairobi for an instant — the datetime-local value. */
function localInput(ms) {
  return new Date(ms + 3 * H).toISOString().slice(0, 16);
}
/** A datetime-local value read as Nairobi time. */
function parseLocal(v) {
  const t = Date.parse(`${v}:00.000+03:00`);
  return Number.isFinite(t) ? t : null;
}
const dayStart = (key) => Date.parse(`${key}T00:00:00.000+03:00`);

/** The four quick spans, as [from, to) instants. */
function preset(id) {
  const today = fleetDayKey();
  const t0 = dayStart(today);
  const now = Date.now();
  if (id === "today") return [t0, now];
  if (id === "yesterday") return [t0 - DAY, t0];
  if (id === "week") return [t0 - 6 * DAY, now];
  // This calendar month, to now.
  return [dayStart(`${today.slice(0, 8)}01`), now];
}
const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "Week"], ["month", "Month"]];

const BACKGROUNDS = {
  trip:    { label: "Trips",    color: "#fecaca" },
  parking: { label: "Parkings", color: "#fef3c7" },
  stop:    { label: "Stops",    color: "#dbeafe" },
};
const LINES = {
  fuelL:     { label: "Fuel level, L",    color: "#dc2626", axis: "fuel" },
  speedKmh:  { label: "Speed, km/h",      color: "#2563eb", axis: "right" },
  mileageKm: { label: "Mileage in trips, km", color: "#16a34a", axis: "right" },
};

// The event marks, drawn once: green pump = filling, red pump = drain, the
// stop sign = a stop (lib/fuelIcons).
const ICON = {
  fill:  svgUrl(pumpSvg(FILL_COLOR)),
  drain: svgUrl(pumpSvg(DRAIN_COLOR)),
  stop:  svgUrl(stopSvg()),
};

/** The marks the operator can switch on and off, on the graph and the map. */
const MARKS = {
  fill:  { label: "Fillings", icon: ICON.fill },
  drain: { label: "Drains",   icon: ICON.drain },
  stop:  { label: "Stop signs", icon: ICON.stop },
};

/** A ReferenceDot shape that draws one of the icons centred on the point. */
const iconShape = (href, title, size = 18) => function IconShape({ cx, cy }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <image href={href} x={cx - size / 2} y={cy - size / 2} width={size} height={size} style={{ cursor: "default" }}>
      <title>{title}</title>
    </image>
  );
};

const VERDICT_WORD = {
  DRAIN: "Drain", REDISTRIBUTION: "Came back", REFILL: "Refill", PENDING: "Not yet checked",
  BURNED: "Burned", UNDECIDABLE: "Undecided",
};
const CAUSE_WORD = { SIPHON: "Possible theft", SLOSH: "Slosh", SETTLING: "Settling", UNEXPLAINED_BURN: "Fuel rate" };
const dropWord = (d) => (d.probeDropout ? "Probe dropout" : (d.cause && CAUSE_WORD[d.cause]) || VERDICT_WORD[d.verdict] || d.verdict);

// ── map ────────────────────────────────────────────────────────────────────

const HEADING_MIN_M = 8;   // closer fixes than this are GPS jitter, not a direction

/** Which way the unit faced at pings[i]: the bearing of the nearest real move through it. */
function headingAt(pings, i) {
  const ok = (p) => p && Number.isFinite(p.lat) && p.lat !== 0;
  const here = pings[i];
  if (!ok(here)) return 0;
  // Forward first (where it was going), then back (where it came from).
  for (let j = i + 1; j < pings.length && j <= i + 60; j += 1) {
    if (ok(pings[j]) && haversineM(here, pings[j]) >= HEADING_MIN_M) return bearingDeg(here, pings[j]);
  }
  for (let j = i - 1; j >= 0 && j >= i - 60; j -= 1) {
    if (ok(pings[j]) && haversineM(pings[j], here) >= HEADING_MIN_M) return bearingDeg(pings[j], here);
  }
  return 0;
}

// How the map frames a report: margin round the track, and the closest it zooms.
const FRAME_PAD_PX = 60;
const FRAME_MAX_ZOOM = 13;          // ~4 km across a 400 px map
const FRAME_MIN_SPAN_M = 3_000;     // tracks shorter than this get that view

function TrackMap({ pings, report, cursor, marks, unit }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef([]);
  const markLayers = useRef([]);
  const cursorMarker = useRef(null);
  const [failed, setFailed] = useState(null);
  const [mapObj, setMapObj] = useState(null);

  useEffect(() => {
    let alive = true;
    loadMapEngine()
      .then((maps) => {
        if (!alive || !el.current || map.current) return;
        // OpenStreetMap on the Leaflet engine (lib/mapEngine), as on the live
        // map: one base map, so no type control. +/− and full screen stay for
        // a touchpad-less desk; wheel, drag and pinch move the map too.
        map.current = new maps.Map(el.current, {
          center: { lat: -0.8, lng: 34.4 }, zoom: 11,
          zoomControl: true, fullscreenControl: true,
        });
        installOsmBase(maps, map.current);
        map.current.setMapTypeId(OSM_TYPE_ID);
        setMapObj(map.current);
        setFailed(false);
      })
      .catch((e) => alive && setFailed(e.message || "Map unavailable"));
    return () => { alive = false; };
  }, []);

  // The track and the parkings, redrawn — and the map framed — per report.
  useEffect(() => {
    const m = map.current;
    const maps = mapsNs;
    if (!m || !maps || failed !== false) return;
    layers.current.forEach((x) => x.setMap(null));
    layers.current = [];
    const path = pings.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0)
      .map((p) => ({ lat: p.lat, lng: p.lng }));
    if (!path.length) return;
    layers.current.push(new maps.Polyline({ map: m, path, strokeColor: "#2563eb", strokeOpacity: 0.9, strokeWeight: 3 }));
    const dot = (pos, color, label, title) => new maps.Marker({
      map: m, position: pos, title,
      label: label ? { text: label, color: "#fff", fontSize: "10px", fontWeight: "700" } : undefined,
      icon: { path: maps.SymbolPath.CIRCLE, scale: label ? 9 : 6, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
    });
    report.parkings.forEach((s) => s.from && layers.current.push(dot(s.from, "#ca8a04", "P", `Parking ${at(s.start)} · ${durationLabel(s.durationMs)}`)));
    // Start is a plain A; the end is the unit itself, drawn as the live map
    // draws it — its own machine, facing the way it last moved.
    let last = pings.length - 1;
    while (last > 0 && !(Number.isFinite(pings[last].lat) && pings[last].lat !== 0)) last -= 1;
    layers.current.push(
      dot(path[0], "#16a34a", "A", "Start"),
      new maps.Marker({
        map: m, position: path[path.length - 1], zIndex: 60, title: `${unit?.id ?? "Unit"} · end of the period`,
        icon: spriteIcon(maps, spriteKind(unit ?? {}), { heading: headingAt(pings, last) }),
      }),
    );
    // Framed with room around the track, and never at street level: a unit
    // that worked one field, or stood all day, has a track a few hundred
    // metres across, and fitting THAT edge to edge zooms in until nothing
    // around it says where it is. Short tracks get a fixed farm-scale view.
    const b = new maps.LatLngBounds();
    path.forEach((p) => b.extend(p));
    const ne = b.getNorthEast(); const sw = b.getSouthWest();
    const spanM = haversineM({ lat: ne.lat(), lng: ne.lng() }, { lat: sw.lat(), lng: sw.lng() });
    if (spanM < FRAME_MIN_SPAN_M) {
      m.setCenter(b.getCenter());
      m.setZoom(FRAME_MAX_ZOOM);
    } else {
      m.fitBounds(b, FRAME_PAD_PX);
    }
  }, [pings, report, failed, unit]);

  // The fillings, drains and stops: their own layer, so switching one off
  // redraws the marks without re-framing the map the operator has zoomed.
  useEffect(() => {
    const m = map.current;
    const maps = mapsNs;
    markLayers.current.forEach((x) => x.setMap(null));
    markLayers.current = [];
    if (!m || !maps || failed !== false) return;
    const posAt = (t) => {
      let best = null; let bd = Infinity;
      for (const p of pings) { const d = Math.abs(p.t - t); if (d < bd && Number.isFinite(p.lat)) { bd = d; best = p; } }
      return best ? { lat: best.lat, lng: best.lng } : null;
    };
    const icon = (pos, url, title, size = 24) => new maps.Marker({
      map: m, position: pos, title, zIndex: 50,
      icon: { url, scaledSize: new maps.Size(size, size), anchor: new maps.Point(size / 2, size / 2) },
    });
    const add = (x) => markLayers.current.push(x);
    if (marks.stop) report.stops.forEach((s) => s.from && add(icon(s.from, ICON.stop, `Stop ${at(s.start)} · ${durationLabel(s.durationMs)}`, 20)));
    if (marks.fill) report.fillings.forEach((f) => { const pos = posAt(f.at); if (pos) add(icon(pos, ICON.fill, `Filling ${at(f.at)} · ${L(f.volumeL)}`)); });
    if (marks.drain) report.drains.forEach((d) => { const pos = posAt(d.at); if (pos) add(icon(pos, ICON.drain, `${dropWord(d)} ${at(d.at)} · ${L(d.volumeL)}`)); });
  }, [pings, report, failed, marks]);

  // Where the chart's crosshair is, on the map.
  useEffect(() => {
    const m = map.current;
    const maps = mapsNs;
    if (!m || !maps) return;
    if (!cursor) { cursorMarker.current?.setMap(null); return; }
    if (!cursorMarker.current) cursorMarker.current = new maps.Marker({ zIndex: 999, clickable: false });
    // The unit as the live map draws it: green while it moves, the idling
    // blue while it stands, turned the way it was heading.
    cursorMarker.current.setIcon(spriteIcon(maps, spriteKind(unit ?? {}), {
      heading: cursor.heading, status: cursor.moving ? "ok" : "idling",
    }));
    cursorMarker.current.setPosition(cursor);
    cursorMarker.current.setMap(m);
  }, [cursor, unit]);

  return (
    <div className="frp-map">
      <div ref={el} className="frp-map__canvas" />
      <MapStatusBar map={mapObj} attribution={OSM_ATTRIBUTION} className="map-status--panel" />
      {failed && <div className="frp-map__msg">The map could not load: {failed}</div>}
    </div>
  );
}

// ── chart ──────────────────────────────────────────────────────────────────

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="frp-tip">
      <b>{at(p.t)}</b>
      {p.fuelL != null && <span style={{ color: LINES.fuelL.color }}>Fuel {fmtNum(p.fuelL, 1)} L</span>}
      {p.speedKmh != null && <span style={{ color: LINES.speedKmh.color }}>Speed {fmtNum(p.speedKmh, 0)} km/h</span>}
      <span style={{ color: LINES.mileageKm.color }}>Mileage {fmtNum(p.mileageKm, 1)} km</span>
    </div>
  );
}

// The plot's edges inside the chart box: the Litres axis on the left, the
// speed/mileage axis (or a margin) on the right.
const PLOT_LEFT = 42;
const plotRight = (right) => (right ? 44 : 16);
const WHEEL_MIN_MS = 5 * 60_000;    // the narrowest the wheel zooms: ~20 readings

/**
 * The fuel graph. The mouse wheel (or a trackball, or a trackpad pinch) zooms
 * about the pointer, Shift + wheel or a sideways swipe pans, a drag pans the
 * zoomed graph, double-click or "Whole period" zooms back out — the vehicle
 * panel's chart, with the same view arithmetic (lib/chartView).
 */
function FuelGraph({ series, report, bg, lines, marks, onCursor, spanMs }) {
  const right = lines.speedKmh || lines.mileageKm;
  const full = useMemo(() => [series[0]?.t ?? 0, series[series.length - 1]?.t ?? 0], [series]);
  const [zoom, setZoom] = useState(null);           // [from, to] ms, or null = whole period
  useEffect(() => { setZoom(null); }, [series]);
  const view = zoom ?? full;

  // What is in view: the readings (one either side, so the line runs to the
  // edges) and the marks.
  const shown = useMemo(() => {
    if (!zoom) return series;
    let i = series.findIndex((p) => p.t >= zoom[0]);
    if (i < 0) i = series.length;
    let j = series.length;
    for (let k = i; k < series.length; k += 1) if (series[k].t > zoom[1]) { j = k + 1; break; }
    return series.slice(Math.max(0, i - 1), j);
  }, [series, zoom]);
  const inView = (t) => t >= view[0] && t <= view[1];

  const tick = (t) => ((zoom ? view[1] - view[0] : spanMs) > 1.5 * DAY
    ? `${dayMon.format(t)} ${clock.format(t)}` : clock.format(t));
  // The level's range is taken from what is in view, so a zoom on a small
  // fall makes it big enough to read.
  const fuelVals = shown.filter((p) => !zoom || inView(p.t)).map((p) => p.fuelL).filter((v) => v != null);
  const fuelMax = fuelVals.length ? Math.max(...fuelVals) : 100;
  const fuelMin = fuelVals.length ? Math.min(...fuelVals) : 0;
  // Zoomed to the range the level covered, as ControlTech draws it: from 0 a
  // 5 L fall on a 400 L tank is a flat line.
  const pad = Math.max(1, (fuelMax - fuelMin) * 0.08);
  const yLo = Math.max(0, Math.floor(fuelMin - pad));
  // Headroom over the line for two rows of marks: stops on top, fuel events
  // under them, both clear of the level.
  const yHi = Math.ceil(fuelMax + pad * 3.2);
  const stopRow = fuelMax + pad * 2.5;
  const eventRow = fuelMax + pad * 1.3;

  // The wheel and the drag. The wheel is attached by hand: React's onWheel is
  // passive and cannot stop the page scrolling under the chart. At the whole
  // period, rolling out is left to the page, so the chart never traps a scroll.
  const boxRef = useRef(null);
  const live = useRef(null);
  live.current = { view, full, right };
  const fracAt = (clientX) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r?.width) return null;
    const w = r.width - PLOT_LEFT - plotRight(live.current.right);
    return { f: Math.min(1, Math.max(0, (clientX - r.left - PLOT_LEFT) / w)), w };
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const { view: v, full: day } = live.current;
      const hit = fracAt(e.clientX);
      if (!hit || !(day[1] > day[0])) return;
      const px = wheelPixels(e);
      const next = Math.abs(px.x) > Math.abs(px.y)
        ? panView(v, day, (px.x / hit.w) * (v[1] - v[0]))
        : zoomView(v, day, v[0] + hit.f * (v[1] - v[0]), zoomFactor(px.y), WHEEL_MIN_MS);
      if (!next) return;
      e.preventDefault();
      setZoom(isWholeDay(next, day) ? null : next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A drag slides the zoomed graph along the period.
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (!zoom || e.button !== 0) return;
    const hit = fracAt(e.clientX);
    if (!hit) return;
    drag.current = { x: e.clientX, view: zoom, w: hit.w };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const next = panView(d.view, full, -((e.clientX - d.x) / d.w) * (d.view[1] - d.view[0]));
    if (next) setZoom(next);
  };
  const endDrag = () => { drag.current = null; };
  const step = (factor) => {
    const next = zoomView(view, full, (view[0] + view[1]) / 2, factor, WHEEL_MIN_MS);
    if (next) setZoom(isWholeDay(next, full) ? null : next);
  };

  return (
    <div className="frp-chart">
      <div className="frp-zoom" role="group" aria-label="Graph zoom">
        <button type="button" className="sp4-ghost-btn frp-zoom__btn" onClick={() => step(0.6)}
                aria-label="Zoom in" title="Zoom in — or roll the wheel over the graph">+</button>
        <button type="button" className="sp4-ghost-btn frp-zoom__btn" onClick={() => step(1 / 0.6)} disabled={!zoom}
                aria-label="Zoom out" title="Zoom out">−</button>
        {zoom && (
          <button type="button" className="sp4-ghost-btn" onClick={() => setZoom(null)}
                  title="Show the whole period — or double-click the graph">Whole period</button>
        )}
        <span className="frp-zoom__hint">
          {zoom ? `${at(view[0])} – ${at(view[1])} · drag to move` : "Scroll over the graph to zoom"}
        </span>
      </div>
      <div
        className={`frp-chart__plot${zoom ? " frp-chart__plot--zoomed" : ""}`}
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setZoom(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={shown}
            margin={{ top: 22, right: right ? 4 : 16, bottom: 4, left: 0 }}
            onMouseMove={(e) => onCursor(e?.activePayload?.[0]?.payload?.t ?? null)}
            onMouseLeave={() => onCursor(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp4-line, #e2e8f0)" />
            <XAxis dataKey="t" type="number" scale="time" domain={zoom ?? ["dataMin", "dataMax"]} allowDataOverflow
                   tickFormatter={tick} tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis yAxisId="fuel" domain={[yLo, yHi]} tick={{ fontSize: 10 }} width={42} allowDataOverflow
                   label={{ value: "Litres", angle: -90, position: "insideLeft", fontSize: 10, offset: 10 }} />
            <YAxis yAxisId="right" orientation="right" hide={!right} tick={{ fontSize: 10 }} width={right ? 40 : 0} />
            {Object.entries(BACKGROUNDS).flatMap(([kind, b]) => (bg[kind]
              ? report.segments.filter((s) => s.kind === kind && s.end >= view[0] && s.start <= view[1]).map((s) => (
                <ReferenceArea key={`${kind}-${s.start}`} yAxisId="fuel"
                               x1={Math.max(s.start, view[0])} x2={Math.min(Math.max(s.end, s.start + 60_000), view[1])}
                               fill={b.color} fillOpacity={0.6} strokeOpacity={0} ifOverflow="hidden" />
              ))
              : []))}
            {Object.entries(LINES).map(([key, l]) => lines[key] && (
              <Line key={key} yAxisId={l.axis} dataKey={key} stroke={l.color} dot={false} strokeWidth={key === "fuelL" ? 1.6 : 1.2}
                    isAnimationActive={false} connectNulls={false} />
            ))}
            {marks.stop && report.stops.filter((st) => inView(st.start)).map((st) => (
              <ReferenceDot key={`s-${st.start}`} yAxisId="fuel" x={st.start} y={stopRow} ifOverflow="hidden"
                            shape={iconShape(ICON.stop, `Stop ${at(st.start)} · ${durationLabel(st.durationMs)}`, 16)} />
            ))}
            {marks.fill && report.fillings.filter((f) => inView(f.at)).map((f) => (
              <ReferenceDot key={`f-${f.id}`} yAxisId="fuel" x={f.at} y={eventRow} ifOverflow="hidden"
                            shape={iconShape(ICON.fill, `Filling ${at(f.at)} · ${L(f.volumeL)}`)} />
            ))}
            {marks.drain && report.drains.filter((d) => inView(d.at)).map((d) => (
              <ReferenceDot key={`d-${d.id}`} yAxisId="fuel" x={d.at} y={eventRow} ifOverflow="hidden"
                            shape={iconShape(ICON.drain, `${dropWord(d)} ${at(d.at)} · ${L(d.volumeL)}`)} />
            ))}
            <Tooltip content={<ChartTip />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────
//
// Laid out like every other screen on this dashboard (Audit, Weighbridges,
// Maintenance): the KPI strip, the filter bar, the tab strip, the table
// toolbar, then the tab's own content — built from SensorPanel's sp4 classes,
// so it follows the theme and the phone layouts those pages already have.

const EVENTS_HEAD = ["Time", "Event", "Verdict", "Before (L)", "After (L)", "Volume (L)", "Location"];
const TRIPS_HEAD = ["Start", "End", "Duration", "Distance (km)", "Max speed (km/h)", "Fuel start (L)", "Fuel end (L)"];
const PARKINGS_HEAD = ["Start", "End", "Duration", "Fuel start (L)", "Fuel end (L)"];

const TABS = [
  { key: "graph",    label: "Graph & map" },
  // Statistics and the fuel events are one tab (operator, 2026-10-02): the
  // pictures of the period above the events that explain them.
  { key: "stats",    label: "Statistics & events" },
  { key: "trips",    label: "Trips" },
  { key: "parkings", label: "Parkings" },
];

/**
 * One end of the period: a field in the panel's own style that SHOWS the time
 * as the rest of the page writes it ("02 Oct, 00:00", Nairobi) and opens the
 * browser's own date-and-time picker when tapped. The native input sits over
 * it, invisible, so the picker, typing and the keyboard all still work — only
 * the browser's "10/02/2026 12:00 AM" face and its grey glyph are gone.
 */
function WhenField({ label, value, onChange, max, min }) {
  const t = parseLocal(value);
  const open = (e) => { try { e.currentTarget.showPicker?.(); } catch { /* typing still works */ } };
  return (
    <label className="frp-when">
      <span className="frp-when__l">{label}</span>
      <span className="frp-when__v">{t != null ? at(t) : "—"}</span>
      <svg className="frp-when__i" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <input type="datetime-local" className="frp-when__input" value={value} min={min} max={max}
             aria-label={label} onClick={open} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

/**
 * Read one unit's period: every fleet day's readings and fuel ledger, three
 * days at a time, cut to the period and worked into the report. A day that
 * fails is counted, not fatal — the report says how many are missing.
 */
async function runReport({ orgId, unit, from, to }, onProgress) {
  const days = fleetDaysBetween(fleetDayKey(new Date(from)), fleetDayKey(new Date(to - 1)));
  let done = 0;
  onProgress({ done, total: days.length });
  const parts = await settleLimited(days, 3, async (day) => {
    const [tel, fuel] = await Promise.all([
      loadDay(orgId, unit.vehicleId, day),
      loadVehicleFuelEvents(orgId, unit.vehicleId, day),
    ]);
    done += 1;
    onProgress({ done, total: days.length });
    return { pings: tel.pings, drains: fuel.drains, fillings: fuel.fillings };
  });
  const ok = parts.filter((p) => p.status === "fulfilled").map((p) => p.value);
  const failedDays = parts.length - ok.length;
  const pings = ok.flatMap((p) => p.pings).filter((p) => p.t >= from && p.t < to).sort((a, b) => a.t - b.t);
  const inSpan = (iso) => { const t = Date.parse(iso); return t >= from && t < to; };
  const uniq = (xs) => [...new Map(xs.map((x) => [x.id, x])).values()];
  const fillings = uniq(ok.flatMap((p) => p.fillings)).filter((f) => inSpan(f.filledAt));
  const drains = uniq(ok.flatMap((p) => p.drains)).filter((d) => inSpan(d.beganAt));
  const report = buildFuelReport({ pings, fillings, drains, from, to });
  return { report, pings, series: chartSeries(pings), unit, from, to, failedDays };
}

/** A preset's dates as of now — worked out on each visit, never stored. */
const presetSpan = (id) => { const [a, b] = preset(id); return { from: localInput(a), to: localInput(b), id }; };

/** The header's fold: a bare chevron — up folds the figures and filters away, down brings them back. */
function FoldChevron({ collapsed, onToggle, className = "" }) {
  // Says what it does in words: a still chevron beside "Hide filters" /
  // "Show filters", turning with the state rather than pulsing at rest.
  const what = collapsed ? "Show the figures and filters" : "Hide the figures and filters";
  return (
    <button type="button" className={`frp-fold ${className}`} aria-expanded={!collapsed}
            onClick={onToggle} aria-label={what} title={what}>
      <svg className="frp-fold__chev" width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 15l6-6 6 6" />
      </svg>
      <span className="frp-fold__l" aria-hidden="true">{collapsed ? "Show filters" : "Hide filters"}</span>
    </button>
  );
}

function Kpi({ n, label, tone, title }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ""}`} title={title}>
      <span className="sp4-kpi-n">{n}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

export default function FuelReportScreen() {
  const { vehicles = [], orgId } = useFleetLiveShared();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  // Selection and layout live in the store (store/fuelReportSlice): the
  // selection for the session, so the page comes back as it was left; the
  // layout for good, as this viewer's preference.
  const {
    unitByOrg, presetId, span: keptSpan, request, tab, bg, lines, marks, headerCollapsed: collapsed,
  } = useSelector((st) => st.fuelReport);
  // Opening the page: the period preset last picked, as of today.
  const [defaultSpan] = useState(() => presetSpan(presetId));
  const span = keptSpan ?? defaultSpan;
  const setSpan = (next) => dispatch(spanChosen(typeof next === "function" ? next(span) : next));
  // The unit last picked in THIS organisation, remembered across visits.
  const unitId = (orgId && unitByOrg[orgId]) || null;
  const setUnitId = (id) => dispatch(unitChosen(orgId, id));
  const setTab = (t) => dispatch(tabChosen(t));
  // A viewer who last left the page on the old "Fuel events" tab lands on the
  // merged one.
  const activeTab = tab === "events" ? "stats" : tab;
  const toggle = (group) => (key) => dispatch(layerToggled({ group, key }));
  const toggleHeader = () => dispatch(headerToggled());
  const [cursorT, setCursorT] = useState(null);
  const rootRef = useRef(null);
  // Labels for the tables' phone card layout, as on the other screens.
  useEffect(() => watchTableLabels(rootRef.current), []);

  const unit = useMemo(() => vehicles.find((v) => v.vehicleId === unitId) ?? null, [unitId, vehicles]);

  const from = parseLocal(span.from);
  const to = parseLocal(span.to);
  const days = useMemo(() => (from != null && to != null && to > from
    ? fleetDaysBetween(fleetDayKey(new Date(from)), fleetDayKey(new Date(to - 1)))
    : []), [from, to]);
  const tooLong = days.length > MAX_DAYS;
  const canRun = Boolean(unit?.vehicleId && orgId && days.length && !tooLong);

  // The report is a query keyed by what was executed: running the same unit
  // and period again within a few minutes — or coming back to the page — is
  // served from the cache, and only Execute on an unchanged request re-reads.
  const live = request && request.orgId === orgId ? request : null;
  const runUnit = useMemo(() => (live ? vehicles.find((v) => v.vehicleId === live.unitId) ?? null : null), [live, vehicles]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const reportKey = ["fuel-report", live?.orgId, live?.unitId, live?.from, live?.to];
  const reportQuery = useQuery({
    queryKey: reportKey,
    enabled: Boolean(live && runUnit),
    queryFn: () => runReport({ orgId: live.orgId, unit: runUnit, from: live.from, to: live.to }, setProgress),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const state = reportQuery.isFetching ? { status: "loading", ...progress }
    : reportQuery.isError ? { status: "error", error: reportQuery.error?.message || "Could not build the report" }
    : reportQuery.data ? { status: "ready", ...reportQuery.data }
    : { status: "idle" };

  const execute = useCallback(() => {
    if (!canRun) return;
    const next = { orgId, unitId: unit.vehicleId, from, to };
    const same = live && live.unitId === next.unitId && live.from === next.from && live.to === next.to;
    if (same) queryClient.refetchQueries({ queryKey: reportKey, exact: true });
    else dispatch(executed(next));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun, orgId, unit, from, to, live, queryClient, dispatch]);

  const choose = (id) => { const [a, b] = preset(id); setSpan({ from: localInput(a), to: localInput(b), id }); };

  const ready = state.status === "ready" ? state : null;
  const r = ready?.report;
  const cursor = useMemo(() => {
    if (!ready || cursorT == null) return null;
    let best = -1; let bd = Infinity;
    const ps = ready.pings;
    for (let i = 0; i < ps.length; i += 1) {
      const d = Math.abs(ps[i].t - cursorT);
      if (d < bd && Number.isFinite(ps[i].lat) && ps[i].lat !== 0) { bd = d; best = i; }
      if (ps[i].t > cursorT && d > bd) break;
    }
    if (best < 0) return null;
    const p = ps[best];
    return { lat: p.lat, lng: p.lng, heading: headingAt(ps, best), moving: Number(p.speedKmh) >= 3 };
  }, [ready, cursorT]);

  const events = useMemo(() => (r ? [
    ...r.fillings.map((f) => ({ ...f, kind: "filling" })),
    ...r.drains.map((d) => ({ ...d, kind: "drain" })),
  ].sort((a, b) => a.at - b.at) : []), [r]);

  const eventRows = () => events.map((e) => [
    at(e.at), e.kind === "filling" ? "Filling" : "Drain", e.kind === "filling" ? VERDICT_WORD[e.verdict] ?? e.verdict : dropWord(e),
    fmtNum(e.beforeL), fmtNum(e.afterL), fmtNum(e.volumeL), e.location ?? "",
  ]);
  const tripRows = () => (r?.trips ?? []).map((s) => [
    at(s.start), at(s.end), durationLabel(s.durationMs), fmtNum(s.distanceKm), fmtNum(s.maxSpeedKmh, 0), fmtNum(s.fuelStartL), fmtNum(s.fuelEndL),
  ]);
  const parkingRows = () => (r?.parkings ?? []).map((s) => [
    at(s.start), at(s.end), durationLabel(s.durationMs), fmtNum(s.fuelStartL), fmtNum(s.fuelEndL),
  ]);
  const slug = ready ? `fuel-report-${ready.unit.id}-${fleetDayKey(new Date(ready.from))}` : "fuel-report";
  const consumption = r
    ? (r.stats.lPer100Km != null ? `${fmtNum(r.stats.lPer100Km)} L/100 km` : r.stats.lPerHour != null ? `${fmtNum(r.stats.lPerHour)} L/h` : "—")
    : "—";
  const statCards = r ? [
    { label: "Fuel at start", value: L(r.stats.fuelStartL) },
    { label: "Fuel at end", value: L(r.stats.fuelEndL) },
    { label: "Filled", value: `${L(r.stats.filledL)} · ${r.stats.fillingCount}` },
    { label: "Possible theft", value: `${L(r.stats.theftL)} · ${r.stats.theftCount}` },
    { label: "Consumed", value: L(r.stats.consumedL) },
    { label: "Distance", value: `${fmtNum(r.stats.distanceKm)} km` },
    { label: "Engine hours", value: `${fmtNum(r.stats.engineHours)} h` },
    { label: "Consumption", value: consumption },
  ] : [];
  const exportPdf = () => {
    if (!r) return;
    buildSensorReport({
      companyName: "Fleet Tracking",
      reportTitle: "Advanced fuel analysis",
      filenameSlug: slug,
      filterNote: `${ready.unit.id}${ready.unit.name ? ` (${ready.unit.name})` : ""} · ${at(ready.from)} – ${at(ready.to)}`,
      cards: statCards,
      sections: [
        { title: "Fuel events", head: EVENTS_HEAD, body: eventRows() },
        { title: "Trips", head: TRIPS_HEAD, body: tripRows() },
        { title: "Parkings", head: PARKINGS_HEAD, body: parkingRows() },
      ],
    });
  };
  const csvFor = {
    stats:    () => downloadTableCsv({ head: EVENTS_HEAD, body: eventRows(), filenameSlug: `${slug}-events` }),
    trips:    () => downloadTableCsv({ head: TRIPS_HEAD, body: tripRows(), filenameSlug: `${slug}-trips` }),
    parkings: () => downloadTableCsv({ head: PARKINGS_HEAD, body: parkingRows(), filenameSlug: `${slug}-parkings` }),
  };
  const tabCount = { stats: events.length, trips: r?.trips.length, parkings: r?.parkings.length };
  // Before a report: a quiet dash, not a full stop floating in the tile.
  const dot = <span className="frp-kpi-none">—</span>;

  return (
    <div className="sp4-root frp-root" ref={rootRef}>
      {/* ── KPI strip and filter bar, which fold away to one line so the
           graph and the map get the screen. ── */}
      {!collapsed && (
        <>
          <div className="sp4-header">
            <div className="sp4-header-kpis">
              {/* The tank's balance, read left to right as the sum it is:
                  start + filled − possible theft − consumed = end. Each term
                  is rounded before consumed is derived, so it closes exactly. */}
              <Kpi n={r ? fmtNum(r.stats.fuelStartL) : dot} label="Start, L" tone="fleet"
                   title="The level at the start of the period — the median of the first readings, so one slosh does not set it." />
              <Kpi n={r ? fmtNum(r.stats.filledL) : dot} label="+ Filled, L" tone="live"
                   title="Fillings the server's ledger counts as fuel put in." />
              {r?.stats.unrecordedL > 0 && (
                <Kpi n={fmtNum(r.stats.unrecordedL)} label="+ Unrecorded rise, L" tone="live"
                     title="The tank ended higher than start + fillings − theft allow: a rise no recorded filling explains. Likely a filling missing from the ledger." />
              )}
              <Kpi n={r ? fmtNum(r.stats.theftL) : dot} label="− Possible theft, L" tone="speed"
                   title="Drains the server judged a possible theft. A fall that ends on a dead probe is not counted." />
              <Kpi n={r ? fmtNum(r.stats.consumedL) : dot} label="− Consumed, L" tone="fuel"
                   title="Start + filled − possible theft − end: what the engine burned." />
              <Kpi n={r ? fmtNum(r.stats.fuelEndL) : dot} label="= End, L" tone="fleet"
                   title="The level at the end of the period, read the same way as the start." />
              <Kpi n={r ? fmtNum(r.stats.distanceKm) : dot} label="Distance, km" tone="stat" />
            </div>
          </div>

          {/* ── Filter bar: which unit, over what period ── */}
          <div className="sp4-filterbar frp-filterbar">
            <UnitPicker vehicles={vehicles} value={unitId} onChange={setUnitId} />
            <div className="sp4-filter-divider" />
            <div className="sp4-filter-group frp-period" role="group" aria-label="Period">
              {PRESETS.map(([id, label]) => (
                <button key={id} type="button" className={`sp4-filter-chip${span.id === id ? " sp4-filter-chip--on" : ""}`}
                        aria-pressed={span.id === id} onClick={() => choose(id)}>{label}</button>
              ))}
            </div>
            <div className="frp-range">
              <WhenField label="From" value={span.from} max={span.to}
                         onChange={(v) => setSpan((s) => ({ ...s, from: v, id: null }))} />
              <span className="frp-range__dash" aria-hidden="true">–</span>
              <WhenField label="To" value={span.to} min={span.from}
                         onChange={(v) => setSpan((s) => ({ ...s, to: v, id: null }))} />
            </div>
            <button type="button" className="sp4-submit-btn frp-run" onClick={execute} disabled={!canRun || state.status === "loading"}
                    title={!unit ? "Choose a unit first" : tooLong ? `${MAX_DAYS} days at most` : "Build the report"}>
              {state.status === "loading" ? `Reading ${state.done}/${state.total}…` : "Execute"}
            </button>
            <FoldChevron collapsed={false} onToggle={toggleHeader} className="frp-fold--bar" />
          </div>
        </>
      )}

      <div className="sp4-body frp-body">
        {collapsed && !ready && <FoldChevron collapsed onToggle={toggleHeader} className="frp-fold--float" />}
        {!ready && (
          state.status === "loading" ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Building the Report"
                        progress={state.total ? state.done / state.total : 0}>
              Reading day {Math.min(state.done + 1, state.total)} of {state.total} — readings, fillings and drains.
            </EmptyNote>
          ) : state.status === "error" ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Built"
                        action={canRun ? { label: "Try again", onClick: execute } : null}>
              {state.error}
            </EmptyNote>
          ) : tooLong ? (
            <EmptyNote icon="ti-calendar-off" tone="warn" title="That Period Is Too Long">
              One report covers up to {MAX_DAYS} days. Shorten the period, then Execute.
            </EmptyNote>
          ) : (
            <EmptyNote icon="ti-gas-station" title={unit ? `Ready for ${unit.id}` : "Advanced Fuel Analysis"}>
              {unit
                ? "Press Execute to read the tank over this period: its balance, every filling and drain, the trips, parkings and track."
                : "Choose a unit and a period, then Execute: the tank's balance, every filling and drain, the trips and parkings, and the track."}
            </EmptyNote>
          )
        )}

        {ready && (
          <>
            <div className="sp4-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
                        className={`sp4-tab${activeTab === t.key ? " sp4-tab--on" : ""}`} onClick={() => setTab(t.key)}>
                  {t.label}
                  {tabCount[t.key] != null && <span className="sp4-tab-n">{tabCount[t.key]}</span>}
                </button>
              ))}
              {collapsed && <FoldChevron collapsed onToggle={toggleHeader} className="frp-fold--tabs" />}
            </div>

            <TableToolbar
              summary={<>
                <b>{ready.unit.id}</b>{ready.unit.machineName || ready.unit.name ? ` · ${ready.unit.machineName || ready.unit.name}` : ""}
                {" · "}{at(ready.from)} – {at(ready.to)}
                {ready.failedDays > 0 && <span className="frp-warn"> · {ready.failedDays} day(s) failed to load</span>}
              </>}
              loading={false}
              onReload={execute}
              onCsv={csvFor[activeTab]}
              onPdf={exportPdf}
            />

            {activeTab === "graph" && (
              <div className="frp-graphmap">
                <TrackMap pings={ready.pings} report={r} cursor={cursor} marks={marks} unit={ready.unit} />
                <div className="frp-graph">
                  <div className="sp4-filterbar frp-graph__bar">
                    <div className="sp4-filter-group">
                      <span className="sp4-filter-label">Behind</span>
                      {Object.entries(BACKGROUNDS).map(([k, b]) => (
                        <button key={k} type="button" aria-pressed={bg[k]}
                                className={`sp4-filter-chip frp-chip${bg[k] ? " sp4-filter-chip--on" : ""}`}
                                onClick={() => toggle("bg")(k)}>
                          <i className="frp-swatch" style={{ background: b.color }} aria-hidden="true" />{b.label}
                        </button>
                      ))}
                    </div>
                    <div className="sp4-filter-group">
                      <span className="sp4-filter-label">Lines</span>
                      {Object.entries(LINES).map(([k, l]) => (
                        <button key={k} type="button" aria-pressed={lines[k]}
                                className={`sp4-filter-chip frp-chip${lines[k] ? " sp4-filter-chip--on" : ""}`}
                                onClick={() => toggle("lines")(k)}>
                          <i className="frp-swatch frp-swatch--line" style={{ background: l.color }} aria-hidden="true" />{l.label}
                        </button>
                      ))}
                    </div>
                    <div className="sp4-filter-group">
                      <span className="sp4-filter-label">Marks</span>
                      {Object.entries(MARKS).map(([k, mk]) => (
                        <button key={k} type="button" aria-pressed={marks[k]}
                                className={`sp4-filter-chip frp-chip${marks[k] ? " sp4-filter-chip--on" : ""}`}
                                onClick={() => toggle("marks")(k)}
                                title={`${marks[k] ? "Hide" : "Show"} ${mk.label.toLowerCase()} on the graph and the map`}>
                          <img src={mk.icon} alt="" width="15" height="15" className={marks[k] ? "" : "frp-mark--off"} />{mk.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {ready.series.length === 0
                    ? <EmptyNote icon="ti-map-pin-off" title="No Readings in This Period">
                        The unit did not report between these times, so there is no fuel level to draw.
                      </EmptyNote>
                    : <FuelGraph series={ready.series} report={r} bg={bg} lines={lines} marks={marks} onCursor={setCursorT} spanMs={ready.to - ready.from} />}
                </div>
              </div>
            )}

            {activeTab === "stats" && (
              <FuelReportOverview
                report={r} unit={ready.unit} from={ready.from} to={ready.to} series={ready.series}
                events={events} fmtNum={fmtNum} at={at} dropWord={dropWord} onHoverAt={setCursorT}
              />
            )}

            {activeTab === "trips" && (r.trips.length === 0
              ? <div className="sp4-empty">The unit did not move in this period.</div>
              : <TripsView report={r} from={ready.from} to={ready.to} fmtNum={fmtNum} at={at} onHoverAt={setCursorT} />)}

            {activeTab === "parkings" && (r.parkings.length === 0
              ? <div className="sp4-empty">No parking in this period.</div>
              : <ParkingsView report={r} from={ready.from} to={ready.to} fmtNum={fmtNum} at={at} onHoverAt={setCursorT} />)}
          </>
        )}
      </div>
    </div>
  );
}
