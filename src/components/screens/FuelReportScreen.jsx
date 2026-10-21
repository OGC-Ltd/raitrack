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
import { useDispatch, useSelector, useStore } from "react-redux";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceDot, ReferenceLine,
} from "recharts";
import "../body/SensorPanel.css";
import "./FuelReportScreen.css";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { loadDay, decodeColumns } from "../../lib/vehicleDay";
import { apiFetch } from "../../services/api";
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
import { rangeStats, pointDetail, levelOf, TREND_MS } from "../../lib/chartCapture";
import { pumpSvg, stopSvg, svgUrl, FILL_COLOR, DRAIN_COLOR } from "../../lib/fuelIcons";
import { downloadTableCsv } from "../../utils/tableExport";
import { buildSensorReport } from "../../utils/sensorReport";
import TableToolbar from "../body/TableToolbar";
import EmptyNote from "../shared/EmptyNote";
import UnitPicker from "../body/UnitPicker";
import FuelReportOverview from "./FuelReportOverview";
import FuelPerformanceReview from "./FuelPerformanceReview";
import { useCompanies } from "../../context/AppContext";
import { TripsView, ParkingsView } from "./FuelReportSegments";
import { watchTableLabels } from "../../lib/tableLabels";
import { pickDefaultUnit } from "../../lib/fuelReportDefault";
import { nameParts } from "../../lib/plateLabel";
import {
  unitChosen, spanChosen, executed, autoPicked, tabChosen, layerToggled, allLinesSet, linesWithDefaults,
} from "../../store/fuelReportSlice";

const H = 3_600_000;
const DAY = 86_400_000;
/** One report reads at most a month of days — each is one request. */
const MAX_DAYS = 31;
const TZ = "Africa/Nairobi";

const fmtNum = (n, d = 1) =>
  n == null || !Number.isFinite(n) ? "-" : n.toLocaleString("en-KE", { maximumFractionDigits: d, minimumFractionDigits: d });
const L = (n) => (n == null ? "-" : `${fmtNum(n, 1)} L`);
const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ,
});
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const dayMon = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
const at = (ms) => (Number.isFinite(ms) ? stamp.format(ms) : "-");

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

// The bands behind the graph take the theme's own tints (FuelReportScreen.css
// --frp-band-*): the light pastels at 60% turned to mud on the dark canvas.
const BACKGROUNDS = {
  trip:    { label: "Trips",    color: "var(--frp-band-trip)" },
  parking: { label: "Parkings", color: "var(--frp-band-park)" },
  stop:    { label: "Stops",    color: "var(--frp-band-stop)" },
};
// The graph's lines, listed down its left side to switch on and off (operator,
// 2026-10-13, ControlTech's list as the model). Litres on the left axis; speed
// and mileage share the right one; altitude, metres in the thousands, has an
// axis of its own, unlabelled, so its shape shows and the tooltip gives the
// figure. The two supply voltages share a volts axis of their own the same way
// (stored from 2026-10-13; an older day is filled from Wialon by the server).
// `dp` is the tooltip's decimals.
const LINES = {
  extVoltageV: { label: "External battery voltage, V", color: "#ea580c", axis: "volt", dp: 2 },
  intVoltageV: { label: "Internal battery voltage, V", color: "#0d9488", axis: "volt", dp: 2 },
  fuelL:       { label: "Fuel level, L",           color: "#dc2626", axis: "fuel",  dp: 1 },
  fuelSmoothL: { label: "Processed fuel level, L", color: "#9333ea", axis: "fuel",  dp: 1 },
  mileageKm:   { label: "Mileage in trips, km",    color: "#16a34a", axis: "right", dp: 1 },
  speedKmh:    { label: "Speed, km/h",             color: "#2563eb", axis: "right", dp: 0 },
  altitudeM:   { label: "Altitude, m",             color: "#f59e0b", axis: "alt",   dp: 0 },
  // The engine check line (operator, 2026-10-20): a step along the foot of the
  // graph, up while the ignition is on, down while it is off, so a fall in
  // the fuel line can be read against whether the engine was running.
  engineOn:    { label: "Engine",                  color: "#334155", axis: "eng",   dp: 0, step: true,
                 word: (v) => (v ? "On" : "Off") },
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
    if (marks.stop) report.stops.forEach((s) => s.from && add(icon(s.from, ICON.stop, `Stop ${at(s.start)} · ${durationLabel(s.durationMs)}`, 24)));
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

/** What the unit was doing at a moment, from the report's own segments. */
const SEGMENT_WORD = { trip: "On a trip", parking: "Parked", stop: "Stopped" };

/**
 * The graph's hover card. One row a line: a short swatch of the line's colour,
 * its name, and the figure with its unit. The colour is carried by the swatch
 * only; the figures are ink, because the lines' own hues (amber, green) on the
 * card read at under 3:1 as text. Litres first, then the rest under a hairline.
 */
function ChartTip({ active, payload, lines, segments }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const seg = segments?.find((x) => p.t >= x.start && p.t <= x.end);
  const rows = Object.entries(LINES).filter(([k]) => lines[k] && p[k] != null).map(([k, l]) => {
    const [name, unit] = l.label.split(/,\s*/);
    return { k, name, unit, color: l.color, value: l.word ? l.word(p[k]) : fmtNum(p[k], l.dp), litres: l.axis === "fuel" };
  });
  const groups = [rows.filter((r) => r.litres), rows.filter((r) => !r.litres)].filter((g) => g.length);
  return (
    <div className="frp-tip" role="status">
      <div className="frp-tip__head">
        <span className="frp-tip__when">{at(p.t)}</span>
        {seg && <span className={`frp-tip__state frp-tip__state--${seg.kind}`}>{SEGMENT_WORD[seg.kind] ?? seg.kind}</span>}
      </div>
      {groups.length === 0
        ? <p className="frp-tip__none">No line has a reading here.</p>
        : groups.map((g, i) => (
          <dl key={i} className="frp-tip__rows">
            {g.map((r) => (
              <div key={r.k} className="frp-tip__row">
                <dt><i className="frp-tip__sw" style={{ background: r.color }} aria-hidden="true" />{r.name}</dt>
                <dd>{r.value}<span className="frp-tip__unit">{r.unit}</span></dd>
              </div>
            ))}
          </dl>
        ))}
    </div>
  );
}

/**
 * The period's fuel in a few lines, under the line list (operator, 2026-10-13,
 * ControlTech's side summary as the model). "Drained" is every fall the
 * server recorded except those that ended on a dead probe, which the report
 * shows as dropouts, not as fuel lost.
 */
function SideSummary({ report }) {
  const st = report.stats;
  const drains = report.drains.filter((d) => !d.probeDropout);
  const drained = drains.reduce((n, d) => n + (Number(d.volumeL) || 0), 0);
  const rows = [
    ["Total drained", L(drained)],
    ["Total drains", fmtNum(drains.length, 0)],
    ["Total filled", L(st.filledL)],
    ["Total fillings", fmtNum(st.fillingCount, 0)],
    ["Consumed", L(st.consumedL)],
    ["Total distance", `${fmtNum(st.allDistanceKm, 2)} km`],
    ["Engine hours", durationLabel(st.engineHours * 3_600_000)],
  ];
  return (
    <dl className="frp-side-sum">
      {rows.map(([k, v]) => (
        <div key={k} className="frp-side-sum__row"><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

function LineList({ lines, onToggle, onAll }) {
  const keys = Object.keys(LINES);
  const on = keys.filter((k) => lines[k]).length;
  return (
    <fieldset className="frp-lines">
      <legend className="frp-lines__legend">Lines</legend>
      <label className="frp-lines__row frp-lines__row--all">
        <input type="checkbox" checked={on === keys.length}
               ref={(el) => { if (el) el.indeterminate = on > 0 && on < keys.length; }}
               onChange={() => onAll(on !== keys.length)} />
        All lines
      </label>
      {keys.map((k) => (
        <label key={k} className="frp-lines__row">
          <input type="checkbox" checked={Boolean(lines[k])} onChange={() => onToggle(k)} />
          <i className="frp-lines__swatch" style={{ background: LINES[k].color }} aria-hidden="true" />
          {LINES[k].label}
        </label>
      ))}
    </fieldset>
  );
}

/** The crosshair's litres, in a tag over the Litres axis at the line's height. */
function CrossLabel({ viewBox, text }) {
  if (!viewBox || !Number.isFinite(viewBox.y)) return null;
  const w = text.length * 5.6 + 8;
  const x = Math.max(1, viewBox.x - w + 2);
  return (
    <g pointerEvents="none">
      <rect x={x} y={viewBox.y - 8} width={w} height={16} rx={3} fill="#0f172a" />
      <text x={x + w / 2} y={viewBox.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{text}</text>
    </g>
  );
}

// The plot's edges inside the chart box: the Litres axis on the left, the
// speed/mileage axis (or a margin) on the right.
const PLOT_LEFT = 42;
const plotRight = (right) => (right ? 44 : 16);
const WHEEL_MIN_MS = 5 * 60_000;    // the narrowest the graph zooms: ~20 readings
/** One press of +: the view to this share of itself. */
const STEP = 0.6;
// The plot's top and foot inside the chart box: the chart's top margin, and
// the x-axis (30) over the bottom margin (4).
const PLOT_TOP = 22;
const PLOT_FOOT = 34;
/** A drag shorter than this many pixels is a click. */
const MIN_DRAG_PX = 6;

// The graph's tools (operator, 2026-10-21), beside the zoom buttons. Each is
// on until pressed again; with none on, a drag moves the graph as before.
const TOOL_ICON = {
  capture: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5" /></>,
  zoom: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 9v6M9 12h6" />,
  point: <><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M8 8.5h8M8 11.5h5" /></>,
};
const TOOLS = {
  capture: { label: "Capture a period", hint: "Drag across the graph to capture a period · up to four · point at Compare to see them" },
  zoom:    { label: "Zoom to an area",  hint: "Drag a box round the part to zoom in on" },
  point:   { label: "Point detail",     hint: "Click a reading for its detail" },
};
// The captured periods, lettered in turn. Hues clear of the lines' own.
const CAPTURE_COLORS = ["#0284c7", "#c2410c", "#047857", "#7c3aed"];
const MAX_CAPTURES = CAPTURE_COLORS.length;
const LETTERS = "ABCD";

const signed = (n, d = 1, unit = "") => {
  if (n == null || !Number.isFinite(n)) return "-";
  // Signed as shown: a difference that rounds to nothing has no sign.
  const r = Math.round(n * 10 ** d) / 10 ** d;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${fmtNum(Math.abs(r), d)}${unit}`;
};
const dur = (ms) => (ms > 0 ? durationLabel(ms) : "-");

// The rows of the comparison: a label, the figure as shown, and the number
// the difference column takes (null where a difference says nothing).
const COMPARE_ROWS = [
  ["Duration",          (s) => dur(s.durationMs),                            (s) => s.durationMs, "ms"],
  ["Start level",       (s) => L(s.startL),                                  (s) => s.startL, "L"],
  ["End level",         (s) => L(s.endL),                                    (s) => s.endL, "L"],
  ["Change",            (s) => signed(s.changeL, 1, " L"),                   (s) => s.changeL, "L"],
  ["Lowest · highest",  (s) => `${fmtNum(s.minL, 1)} · ${fmtNum(s.maxL, 1)} L`, null],
  ["Filled",            (s) => `${L(s.filledL)} (${s.fillCount})`,           (s) => s.filledL, "L"],
  ["Drained",           (s) => `${L(s.drainedL)} (${s.drainCount})`,         (s) => s.drainedL, "L"],
  ["Consumed",          (s) => L(s.consumedL),                               (s) => s.consumedL, "L"],
  ["Distance",          (s) => `${fmtNum(s.distanceKm, 2)} km`,              (s) => s.distanceKm, "km"],
  ["Engine on",         (s) => dur(s.engineMs),                              (s) => s.engineMs, "ms"],
  ["On trips",          (s) => dur(s.tripMs),                                (s) => s.tripMs, "ms"],
  ["Parked",            (s) => dur(s.parkingMs),                             (s) => s.parkingMs, "ms"],
  ["L / 100 km",        (s) => fmtNum(s.per100Km, 1),                        (s) => s.per100Km, ""],
  ["L / engine hour",   (s) => fmtNum(s.perEngineH, 1),                      (s) => s.perEngineH, ""],
  ["Top speed",         (s) => (s.maxSpeedKmh == null ? "-" : `${fmtNum(s.maxSpeedKmh, 0)} km/h`), (s) => s.maxSpeedKmh, "km/h"],
  ["Average moving",    (s) => (s.avgMovingKmh == null ? "-" : `${fmtNum(s.avgMovingKmh, 0)} km/h`), (s) => s.avgMovingKmh, "km/h"],
];
const diffText = (a, b, unit) => {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "-";
  const d = b - a;
  if (unit === "ms") return d === 0 ? "0" : `${d > 0 ? "+" : "−"}${durationLabel(Math.abs(d))}`;
  return signed(d, unit === "km" ? 2 : unit === "km/h" ? 0 : 1, unit ? ` ${unit}` : "");
};

/**
 * The captured periods side by side, in a card over the graph (operator,
 * 2026-10-21: a tooltip, so the graph keeps its height). A chip in the
 * plot's corner names the periods; pointing at it opens the card, a click
 * keeps it open. With two, a last column gives the second less the first.
 */
function CaptureCompare({ captures, stats, onRemove, onClear, onZoom }) {
  const two = captures.length === 2;
  const [kept, setKept] = useState(false);
  const [hover, setHover] = useState(false);
  const open = kept || hover;
  return (
    <div className="frp-cmp-wrap" style={{ left: PLOT_LEFT + 8, top: PLOT_TOP + 6 }}
         onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
         onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className={`frp-cmp-chip${kept ? " is-on" : ""}`} aria-expanded={open}
              onClick={() => setKept((k) => !k)}
              title={kept ? "Close the comparison" : "Keep the comparison open"}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TOOL_ICON.capture}</svg>
        Compare
        {captures.map((c) => (
          <span key={c.id} className="frp-cmp-chip__p" style={{ background: c.color }}>{c.letter}</span>
        ))}
      </button>
      {open && (
        <section className="frp-cmp" aria-label="Captured periods">
          <div className="frp-cmp__head">
            <span className="frp-cmp__title">Compare periods</span>
            {captures.length < 2 && <span className="frp-cmp__note">Capture another period to compare.</span>}
            <button type="button" className="sp4-ghost-btn frp-cmp__clear" onClick={onClear}>Clear all</button>
          </div>
          <div className="frp-cmp__scroll">
            <table className="frp-cmp__table">
              <thead>
                <tr>
                  <td />
                  {captures.map((c, i) => (
                    <th key={c.id} scope="col">
                      <div className="frp-cmp__col">
                        <i className="frp-cmp__sw" style={{ background: c.color }} aria-hidden="true" />
                        <span className="frp-cmp__letter">{c.letter}</span>
                        <button type="button" className="frp-cmp__x" onClick={() => onRemove(c.id)}
                                aria-label={`Remove period ${c.letter}`} title="Remove">×</button>
                      </div>
                      <button type="button" className="frp-cmp__when" onClick={() => onZoom(c)} title="Zoom the graph to this period">
                        {at(stats[i].from)} – {at(stats[i].to)}
                      </button>
                    </th>
                  ))}
                  {two && <th scope="col" className="frp-cmp__diffh">{captures[1].letter} − {captures[0].letter}</th>}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map(([label, show, num, unit]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {stats.map((s, i) => <td key={captures[i].id}>{show(s)}</td>)}
                    {two && <td className="frp-cmp__diff">{num ? diffText(num(stats[0]), num(stats[1]), unit) : ""}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

const EVENT_WORD = { fill: "Filling", drain: "Drain" };
const offsetWord = (ms) => {
  const m = Math.round(Math.abs(ms) / 60_000);
  return m === 0 ? "at this reading" : `${m} min ${ms < 0 ? "before" : "after"}`;
};

/**
 * One pinned reading in full (the point tool): every line's figure, whether
 * or not the line is drawn, what the level did either side, the stretch the
 * unit was in, and any filling or drain near it.
 */
function PointCard({ detail, style, onClose }) {
  const p = detail.point;
  const seg = detail.segment;
  const rows = Object.entries(LINES).filter(([k]) => p[k] != null).map(([k, l]) => {
    const [name, unit] = l.label.split(/,\s*/);
    return { k, name, unit, color: l.color, value: l.word ? l.word(p[k]) : fmtNum(p[k], l.dp) };
  });
  const trendMin = TREND_MS / 60_000;
  return (
    <div className="frp-pin" style={style} role="dialog" aria-label={`Reading at ${at(p.t)}`}
         onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="frp-tip__head">
        <span className="frp-tip__when">{at(p.t)}</span>
        <button type="button" className="frp-pin__x" onClick={onClose} aria-label="Close the reading">×</button>
      </div>
      {seg && (
        <p className="frp-pin__seg">
          {SEGMENT_WORD[seg.kind] ?? seg.kind} {clock.format(seg.start)} – {clock.format(seg.end)}
          <span> · {durationLabel(seg.end - seg.start)}</span>
        </p>
      )}
      <dl className="frp-tip__rows">
        {rows.map((r) => (
          <div key={r.k} className="frp-tip__row">
            <dt><i className="frp-tip__sw" style={{ background: r.color }} aria-hidden="true" />{r.name}</dt>
            <dd>{r.value}<span className="frp-tip__unit">{r.unit}</span></dd>
          </div>
        ))}
      </dl>
      <dl className="frp-tip__rows">
        <div className="frp-tip__row"><dt>Since last reading</dt>
          <dd>{signed(detail.stepL, 1)}<span className="frp-tip__unit">L in {detail.prevGapMs == null ? "-" : durationLabel(detail.prevGapMs)}</span></dd></div>
        <div className="frp-tip__row"><dt>{trendMin} min before</dt><dd>{signed(detail.trendBeforeL, 1)}<span className="frp-tip__unit">L</span></dd></div>
        <div className="frp-tip__row"><dt>{trendMin} min after</dt><dd>{signed(detail.trendAfterL, 1)}<span className="frp-tip__unit">L</span></dd></div>
      </dl>
      {detail.events.length > 0 && (
        <ul className="frp-pin__events">
          {detail.events.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <img src={ICON[e.kind]} alt="" width={14} height={14} />
              <span>{e.kind === "drain" ? dropWord(e) : EVENT_WORD[e.kind]} {L(e.volumeL)}</span>
              <span className="frp-pin__off">{offsetWord(e.offsetMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The fuel graph (operator, 2026-10-13):
 *
 *   · press and drag moves the graph back and forth along the period at
 *     the same zoom (operator, 2026-10-20), the way a map is dragged;
 *   · the wheel or trackball zooms about the point under the pointer
 *     (operator, 2026-10-20: "use the track ball to scroll within the chart
 *     itself"), and the page does not scroll while the pointer is on the
 *     graph; a trackpad pinch arrives as Ctrl + wheel and zooms the same;
 *   · Shift + wheel, or a sideways swipe, moves along the period;
 *   · a crosshair follows the pointer, with the litres at the reading under
 *     it on the Litres axis;
 *   · double-click or "Whole period" zooms back out.
 *
 * And three tools (operator, 2026-10-21), each turning the drag to its own use:
 *
 *   · capture: drag across a period to capture it; up to four, lettered,
 *     shaded on the graph and compared figure by figure under it;
 *   · zoom to an area: drag a box, and the graph shows that stretch of time
 *     and that band of litres;
 *   · point detail: click a reading to pin it, with every line's figure and
 *     what the level did either side of it.
 *
 * View arithmetic as the vehicle panel's chart (lib/chartView).
 */
function FuelGraph({ series, report, bg, lines, marks, onCursor, spanMs }) {
  const right = lines.speedKmh || lines.mileageKm;
  const full = useMemo(() => [series[0]?.t ?? 0, series[series.length - 1]?.t ?? 0], [series]);
  const [zoom, setZoom] = useState(null);           // [from, to] ms, or null = whole period
  const [yZoom, setYZoom] = useState(null);         // [low, high] litres from a drawn box, or null
  const [tool, setTool] = useState(null);           // a key of TOOLS, or null = drag moves
  const [sel, setSel] = useState(null);             // the drag being drawn, box px {x0, y0, x1, y1}
  const [captures, setCaptures] = useState([]);     // [{id, letter, color, from, to}]
  const [pin, setPin] = useState(null);             // the pinned reading's t
  useEffect(() => { setZoom(null); setYZoom(null); setCaptures([]); setPin(null); }, [series]);
  const view = zoom ?? full;
  const unzoom = () => { setZoom(null); setYZoom(null); };

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

  // The reading under the pointer, for the crosshair: the fuel line shown
  // (the raw level, else the processed one) at that reading.
  const [hover, setHover] = useState(null);
  const crossKey = lines.fuelL || !lines.fuelSmoothL ? "fuelL" : "fuelSmoothL";
  const crossL = hover && (lines.fuelL || lines.fuelSmoothL) && Number.isFinite(hover[crossKey]) ? hover[crossKey] : null;

  const tick = (t) => ((zoom ? view[1] - view[0] : spanMs) > 1.5 * DAY
    ? `${dayMon.format(t)} ${clock.format(t)}` : clock.format(t));
  // The level's range is taken from what is in view, so a zoom on a small
  // fall makes it big enough to read.
  const fuelVals = shown.filter((p) => !zoom || inView(p.t))
    .flatMap((p) => [lines.fuelL || !lines.fuelSmoothL ? p.fuelL : null, lines.fuelSmoothL ? p.fuelSmoothL : null])
    .filter((v) => v != null);
  const fuelMax = fuelVals.length ? Math.max(...fuelVals) : 100;
  const fuelMin = fuelVals.length ? Math.min(...fuelVals) : 0;
  // Zoomed to the range the level covered, as ControlTech draws it: from 0 a
  // 5 L fall on a 400 L tank is a flat line.
  const pad = Math.max(1, (fuelMax - fuelMin) * 0.08);
  // A box drawn with the zoom tool sets the band of litres itself.
  const yLo = yZoom ? yZoom[0] : Math.max(0, Math.floor(fuelMin - pad));
  // Headroom over the line for two rows of marks: stops on top, fuel events
  // under them, both clear of the level.
  const yHi = yZoom ? yZoom[1] : Math.ceil(fuelMax + pad * 3.2);
  const stopRow = fuelMax + pad * 2.5;
  const eventRow = fuelMax + pad * 1.3;

  // The wheel and the drag. The wheel is attached by hand: React's onWheel is
  // passive and cannot stop the page scrolling under the chart. At the whole
  // period, rolling out is left to the page, so the chart never traps a scroll.
  const boxRef = useRef(null);
  const live = useRef(null);
  live.current = { view, full, right, yLo, yHi };
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
      // Shift + wheel (a mouse's way of scrolling sideways) or a sideways
      // swipe moves along the period; the wheel itself zooms about the point
      // under the pointer.
      const sideways = e.shiftKey ? (px.x || px.y) : Math.abs(px.x) > Math.abs(px.y) ? px.x : 0;
      const next = sideways
        ? panView(v, day, (sideways / hit.w) * (v[1] - v[0]))
        : zoomView(v, day, v[0] + hit.f * (v[1] - v[0]), zoomFactor(px.y), WHEEL_MIN_MS);
      // The wheel is the graph's while the pointer is on it: the page does
      // not scroll under a zoom, even one that has nowhere further to go.
      e.preventDefault();
      if (!next) return;
      setZoom(isWholeDay(next, day) ? null : next);
      // A new span of time takes its litres from what is in it again.
      if (!sideways) setYZoom(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Press and drag. Measured from where the drag began, so going back the
  // way it came returns to the view it started from.
  const drag = useRef(null);
  // The pointer inside the plot, in the chart box's pixels, held to its edges.
  const plotPx = (e) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r?.width) return null;
    const xHi = r.width - plotRight(live.current.right);
    const yHi = r.height - PLOT_FOOT;
    return {
      x: Math.min(xHi, Math.max(PLOT_LEFT, e.clientX - r.left)),
      y: Math.min(yHi, Math.max(PLOT_TOP, e.clientY - r.top)),
      w: xHi - PLOT_LEFT,
      h: yHi - PLOT_TOP,
    };
  };
  const timeAt = (x, w) => { const v = live.current.view; return v[0] + ((x - PLOT_LEFT) / w) * (v[1] - v[0]); };
  const litresAt = (y, h) => { const { yLo: lo, yHi: hi } = live.current; return hi - ((y - PLOT_TOP) / h) * (hi - lo); };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (tool) {
      const p = plotPx(e);
      if (!p) return;
      drag.current = { tool, ...p };
      setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    const hit = fracAt(e.clientX);
    if (!hit) return;
    drag.current = { x: e.clientX, view, w: hit.w, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  // A tool's drag ends: a period captured, a box zoomed to, a reading pinned.
  const finishTool = (d, end) => {
    const x0 = Math.min(d.x, end.x), x1 = Math.max(d.x, end.x);
    const y0 = Math.min(d.y, end.y), y1 = Math.max(d.y, end.y);
    if (d.tool === "point") { setPin(timeAt(end.x, d.w)); return; }
    if (x1 - x0 < MIN_DRAG_PX) return;
    let from = Math.round(timeAt(x0, d.w)), to = Math.round(timeAt(x1, d.w));
    if (d.tool === "capture") {
      setCaptures((cs) => {
        // A fifth takes the place of the oldest, and its letter and colour.
        const kept = cs.length >= MAX_CAPTURES ? cs.slice(1) : cs;
        const free = CAPTURE_COLORS.findIndex((_, i) => !kept.some((c) => c.slot === i));
        return [...kept, { id: `${from}-${to}-${Date.now()}`, slot: free, letter: LETTERS[free], color: CAPTURE_COLORS[free], from, to }]
          .sort((a, b) => a.slot - b.slot);
      });
      return;
    }
    // Zoom: never narrower than the wheel goes, widened about the box's middle.
    if (to - from < WHEEL_MIN_MS) {
      const mid = (from + to) / 2;
      from = Math.round(mid - WHEEL_MIN_MS / 2); to = from + WHEEL_MIN_MS;
    }
    setZoom(isWholeDay([from, to], full) ? null : [from, to]);
    // A box with height sets the litres too; a flat one keeps them.
    setYZoom(y1 - y0 >= MIN_DRAG_PX
      ? [Math.max(0, Math.floor(litresAt(y1, d.h))), Math.ceil(litresAt(y0, d.h))]
      : null);
  };
  // The graph is held and moved like a sheet: drag right to see earlier,
  // left to see later, at the same zoom. Zooming is the wheel's and the
  // buttons' (operator, 2026-10-20: "click and hold … only drag the chart
  // back and forth, not zoom").
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.tool) {
      const p = plotPx(e);
      if (p) setSel({ x0: d.x, y0: d.y, x1: p.x, y1: p.y });
      return;
    }
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;   // a click, not a drag
    d.moved = true;
    const next = panView(d.view, full, (-dx / d.w) * (d.view[1] - d.view[0]));
    if (next) setZoom(next);
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (d) e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    if (d?.tool) {
      setSel(null);
      const p = e?.type === "pointerup" ? plotPx(e) : null;
      if (p) finishTool(d, p);
    }
  };
  const step = (factor) => {
    const next = zoomView(view, full, (view[0] + view[1]) / 2, factor, WHEEL_MIN_MS);
    if (next) { setZoom(isWholeDay(next, full) ? null : next); setYZoom(null); }
  };
  const pickTool = (k) => setTool((t) => (t === k ? null : k));

  // Escape lets go of a drag being drawn, else of the tool, else of the pin.
  useEffect(() => {
    if (!tool && pin == null) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (drag.current?.tool) { drag.current = null; setSel(null); } else if (tool) setTool(null); else setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, pin]);

  const captureStats = useMemo(
    () => captures.map((c) => rangeStats(series, report, [c.from, c.to])),
    [captures, series, report],
  );
  const detail = useMemo(() => (pin == null ? null : pointDetail(series, report, pin)), [pin, series, report]);
  const pinT = detail?.point.t;
  const pinL = detail ? levelOf(detail.point) : null;
  // The card opens on the side of the pin with the more room.
  const pinStyle = (() => {
    if (pinT == null) return null;
    const f = Math.min(1, Math.max(0, (pinT - view[0]) / (view[1] - view[0] || 1)));
    const inner = `(100% - ${PLOT_LEFT + plotRight(right)}px)`;
    return f > 0.5
      ? { right: `calc(${plotRight(right)}px + ${1 - f} * ${inner} + 12px)` }
      : { left: `calc(${PLOT_LEFT}px + ${f} * ${inner} + 12px)` };
  })();
  const hint = tool ? TOOLS[tool].hint
    : zoom ? "Scroll to zoom · drag to move" : "Scroll over the graph to zoom";

  return (
    <div className="frp-chart">
      <div className="frp-zoom" role="group" aria-label="Graph zoom">
        <button type="button" className="sp4-ghost-btn frp-zoom__btn" onClick={() => step(STEP)}
                aria-label="Zoom in" title="Zoom in, or scroll over the graph">+</button>
        <button type="button" className="sp4-ghost-btn frp-zoom__btn" onClick={() => step(1 / STEP)} disabled={!zoom}
                aria-label="Zoom out" title="Zoom out, or scroll over the graph">−</button>
        {(zoom || yZoom) && (
          <button type="button" className="sp4-ghost-btn" onClick={unzoom}
                  title="Show the whole period, or double-click the graph">Whole period</button>
        )}
        <span className="frp-zoom__hint">
          {zoom ? `${at(view[0])} – ${at(view[1])} · ` : ""}
          {hint}
        </span>
        <div className="frp-tools" role="toolbar" aria-label="Graph tools">
          {Object.entries(TOOLS).map(([k, t]) => (
            <button key={k} type="button" className={`frp-tools__btn${tool === k ? " is-on" : ""}`}
                    aria-pressed={tool === k} aria-label={t.label} title={t.label} onClick={() => pickTool(k)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TOOL_ICON[k]}</svg>
            </button>
          ))}
        </div>
      </div>
      <div
        className={`frp-chart__plot${tool ? ` frp-chart__plot--${tool}` : ""}`}
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { if (tool !== "point") unzoom(); }}
      >
        {sel && (
          <div className={`frp-sel frp-sel--${tool}`} aria-hidden="true" style={tool === "zoom"
            ? { left: Math.min(sel.x0, sel.x1), width: Math.abs(sel.x1 - sel.x0), top: Math.min(sel.y0, sel.y1), height: Math.abs(sel.y1 - sel.y0) }
            : { left: Math.min(sel.x0, sel.x1), width: Math.abs(sel.x1 - sel.x0), top: PLOT_TOP, bottom: PLOT_FOOT }} />
        )}
        {detail && <PointCard detail={detail} style={pinStyle} onClose={() => setPin(null)} />}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={shown}
            margin={{ top: 22, right: right ? 4 : 16, bottom: 4, left: 0 }}
            onMouseMove={(e) => {
              // Recharts 3 hands the index under the pointer, not the
              // reading (its v2 `activePayload` is gone).
              const i = Number(e?.activeTooltipIndex ?? e?.activeIndex);
              const p = e?.activePayload?.[0]?.payload ?? (Number.isInteger(i) ? shown[i] : null) ?? null;
              onCursor(p?.t ?? null);
              setHover(p);
            }}
            onMouseLeave={() => { onCursor(null); setHover(null); }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp4-line, #e2e8f0)" />
            <XAxis dataKey="t" type="number" scale="time" domain={zoom ?? ["dataMin", "dataMax"]} allowDataOverflow
                   tickFormatter={tick} tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis yAxisId="fuel" domain={[yLo, yHi]} tick={{ fontSize: 10 }} width={42} allowDataOverflow
                   label={{ value: "Litres", angle: -90, position: "insideLeft", fontSize: 10, offset: 10 }} />
            <YAxis yAxisId="right" orientation="right" hide={!right} tick={{ fontSize: 10 }} width={right ? 40 : 0} />
            <YAxis yAxisId="alt" orientation="right" hide domain={["dataMin - 20", "dataMax + 20"]} />
            <YAxis yAxisId="volt" orientation="right" hide domain={[0, "dataMax + 2"]} />
            {/* On is 1 on a 0–10 scale: the step stays in the bottom tenth,
                clear of the fuel line. */}
            <YAxis yAxisId="eng" orientation="right" hide domain={[-0.15, 10]} allowDataOverflow />
            {Object.entries(BACKGROUNDS).flatMap(([kind, b]) => (bg[kind]
              ? report.segments.filter((s) => s.kind === kind && s.end >= view[0] && s.start <= view[1]).map((s) => (
                <ReferenceArea key={`${kind}-${s.start}`} yAxisId="fuel"
                               x1={Math.max(s.start, view[0])} x2={Math.min(Math.max(s.end, s.start + 60_000), view[1])}
                               fill={b.color} fillOpacity={1} strokeOpacity={0} ifOverflow="hidden" />
              ))
              : []))}
            {captures.filter((c) => c.to >= view[0] && c.from <= view[1]).map((c) => (
              <ReferenceArea key={c.id} yAxisId="fuel" x1={Math.max(c.from, view[0])} x2={Math.min(c.to, view[1])}
                             fill={c.color} fillOpacity={0.12} stroke={c.color} strokeOpacity={0.7} strokeDasharray="4 3"
                             ifOverflow="hidden"
                             label={{ value: c.letter, position: "insideTopLeft", fontSize: 11, fontWeight: 700, fill: c.color }} />
            ))}
            {Object.entries(LINES).map(([key, l]) => lines[key] && (
              <Line key={key} yAxisId={l.axis} dataKey={key} stroke={l.color} dot={false} strokeWidth={l.axis === "fuel" || l.step ? 1.6 : 1.2}
                    type={l.step ? "stepAfter" : "linear"} isAnimationActive={false} connectNulls={false} />
            ))}
            {marks.stop && report.stops.filter((st) => inView(st.start)).map((st) => (
              <ReferenceDot key={`s-${st.start}`} yAxisId="fuel" x={st.start} y={stopRow} ifOverflow="hidden"
                            shape={iconShape(ICON.stop, `Stop ${at(st.start)} · ${durationLabel(st.durationMs)}`)} />
            ))}
            {marks.fill && report.fillings.filter((f) => inView(f.at)).map((f) => (
              <ReferenceDot key={`f-${f.id}`} yAxisId="fuel" x={f.at} y={eventRow} ifOverflow="hidden"
                            shape={iconShape(ICON.fill, `Filling ${at(f.at)} · ${L(f.volumeL)}`)} />
            ))}
            {marks.drain && report.drains.filter((d) => inView(d.at)).map((d) => (
              <ReferenceDot key={`d-${d.id}`} yAxisId="fuel" x={d.at} y={eventRow} ifOverflow="hidden"
                            shape={iconShape(ICON.drain, `${dropWord(d)} ${at(d.at)} · ${L(d.volumeL)}`)} />
            ))}
            {/* The crosshair's level: across at the fuel under the pointer,
                its litres on the Litres axis. The upright is the tooltip's
                cursor below. */}
            {crossL != null && (
              <ReferenceLine yAxisId="fuel" y={crossL} ifOverflow="hidden"
                             stroke="var(--sp4-text-3)" strokeWidth={1} strokeDasharray="3 3"
                             label={<CrossLabel text={`${fmtNum(crossL, 1)} L`} />} />
            )}
            {crossL != null && (
              <ReferenceDot yAxisId="fuel" x={hover.t} y={crossL} r={3.5} ifOverflow="hidden"
                            fill={LINES[crossKey].color} stroke="#fff" strokeWidth={1.5} />
            )}
            {pinT != null && (
              <ReferenceLine yAxisId="fuel" x={pinT} ifOverflow="hidden" stroke="var(--sp4-accent)" strokeWidth={1.5} />
            )}
            {pinT != null && pinL != null && (
              <ReferenceDot yAxisId="fuel" x={pinT} y={pinL} r={4.5} ifOverflow="hidden"
                            fill="var(--sp4-accent)" stroke="#fff" strokeWidth={2} />
            )}
            {/* No hover card while a box or a period is being drawn. */}
            <Tooltip content={sel ? () => null : <ChartTip lines={lines} segments={report.segments} />} isAnimationActive={false}
                     cursor={{ stroke: "var(--sp4-text-3)", strokeWidth: 1, strokeDasharray: "3 3" }} />
          </ComposedChart>
        </ResponsiveContainer>
        {captures.length > 0 && (
          <CaptureCompare captures={captures} stats={captureStats}
                          onRemove={(id) => setCaptures((cs) => cs.filter((c) => c.id !== id))}
                          onClear={() => setCaptures([])}
                          onZoom={(c) => { setZoom(isWholeDay([c.from, c.to], full) ? null : [c.from, c.to]); setYZoom(null); }} />
        )}
      </div>
    </div>
  );
}

/**
 * The fuel summary under the graph: the period in one row, ControlTech's
 * summary table as the model (operator, 2026-10-13: "below the graph we can
 * add the fuel summary"). Consumption is per 100 km where the unit travelled
 * and per engine hour where it worked standing, as on the figures above;
 * "Possible theft" is ControlTech's "Stolen", in this app's word for it.
 */
function FuelSummary({ unit, stats: st }) {
  const km = (v) => (v == null ? "-" : `${fmtNum(v, 2)} km`);
  const hm = (h) => (h == null ? "-" : durationLabel(h * 3_600_000));
  const consumedPer = st.lPer100Km != null
    ? `${fmtNum(st.lPer100Km, 1)} L/100 km`
    : st.lPerHour != null ? `${fmtNum(st.lPerHour, 1)} L/h` : "-";
  const kmPerL = st.consumedL > 0 && st.distanceKm >= 1 ? `${fmtNum(st.distanceKm / st.consumedL, 2)} km` : "-";
  const cols = [
    ["Unit", nameParts(unit?.name ?? unit?.id) || "-"],
    ["Mileage in trips", km(st.distanceKm)],
    ["Mileage in all readings", km(st.allDistanceKm)],
    ["Avg speed", st.avgSpeedKmh == null ? "-" : `${fmtNum(st.avgSpeedKmh, 0)} km/h`],
    ["Max speed", `${fmtNum(st.maxSpeedKmh, 0)} km/h`],
    ["Time in trips", hm(st.movingHours)],
    ["Engine hours", hm(st.engineHours)],
    ["Consumed", L(st.consumedL)],
    ["Avg consumption", consumedPer],
    ["Km per litre", kmPerL],
    ["Initial fuel level", L(st.fuelStartL)],
    ["Final fuel level", L(st.fuelEndL)],
    ["Filled", L(st.filledL)],
    ["Possible theft", L(st.theftL)],
  ];
  return (
    <section className="frp-sum" aria-label="Fuel summary">
      <dl className="frp-sum__tiles">
        {cols.map(([h, v]) => (
          <div key={h} className={`frp-sum__tile${h === "Unit" ? " frp-sum__tile--unit" : ""}`}>
            <dt>{h}</dt>
            <dd className={h === "Possible theft" && st.theftL > 0 ? "frp-sum__theft" : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
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
      <span className="frp-when__v">{t != null ? at(t) : "-"}</span>
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
 * A server older than the one-request route: every fleet day's readings and
 * fuel ledger, three days at a time. A day that fails is counted, not fatal.
 */
async function readByDay({ orgId, unit, from, to }, onProgress) {
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
  return {
    pings: ok.flatMap((p) => p.pings),
    drains: ok.flatMap((p) => p.drains),
    fillings: ok.flatMap((p) => p.fillings),
    failedDays: parts.length - ok.length,
  };
}

/**
 * Read one unit's period and work it into the report: ONE request for every
 * fleet day's readings and the period's drains and fillings (server
 * fuel-report-data, 2026-10-10). A month used to be 90 requests, nine at a
 * time, each a query of its own; finished days now come from a cache the
 * server keeps for everyone. A day the server could not read is counted, not
 * fatal — the report says how many are missing.
 */
async function runReport({ orgId, unit, from, to }, onProgress) {
  let got;
  onProgress({ done: 0, total: 1 });
  try {
    const res = await apiFetch(`/api/v1/organisations/${orgId}/fuel/report-data/vehicles/${unit.vehicleId}?from=${from}&to=${to}`);
    const d = res?.data ?? {};
    got = {
      pings: (d.days ?? []).flatMap((day) => decodeColumns(day)),
      drains: d.drains ?? [],
      fillings: d.fillings ?? [],
      failedDays: d.failedDays ?? 0,
    };
    onProgress({ done: 1, total: 1 });
  } catch (err) {
    // A server without the route answers 404: the old reading, a day at a time.
    if (err?.status !== 404) throw err;
    got = await readByDay({ orgId, unit, from, to }, onProgress);
  }
  const { failedDays } = got;
  const seen = new Set();
  const pings = got.pings
    .filter((p) => p.t >= from && p.t < to && !seen.has(p.t) && seen.add(p.t))
    .sort((a, b) => a.t - b.t);
  const inSpan = (iso) => { const t = Date.parse(iso); return t >= from && t < to; };
  const uniq = (xs) => [...new Map(xs.map((x) => [x.id, x])).values()];
  const fillings = uniq(got.fillings).filter((f) => inSpan(f.filledAt));
  const drains = uniq(got.drains).filter((d) => inSpan(d.beganAt));
  const report = buildFuelReport({ pings, fillings, drains, from, to });
  return { report, pings, series: chartSeries(pings), unit, from, to, failedDays };
}

/** A preset's dates as of now — worked out on each visit, never stored. */
const presetSpan = (id) => { const [a, b] = preset(id); return { from: localInput(a), to: localInput(b), id }; };

function Kpi({ n, label, tone, title }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ""}`} title={title}>
      <span className="sp4-kpi-n">{n}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

function UnitFuelReport() {
  const { vehicles = [], orgId } = useFleetLiveShared();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  // Selection and layout live in the store (store/fuelReportSlice): the
  // selection for the session, so the page comes back as it was left; the
  // layout for good, as this viewer's preference.
  const {
    unitByOrg, presetId, span: keptSpan, request, tab, bg, lines: savedLines, marks, 
    touched, autoPick,
  } = useSelector((st) => st.fuelReport);
  const lines = useMemo(() => linesWithDefaults(savedLines), [savedLines]);
  const store = useStore();
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

  // Opening the page with nothing picked or run this session: show the latest
  // possible-theft case, or failing that the unit that covered the most ground
  // today (lib/fuelReportDefault). A pick made while this looks wins: the
  // reducer ignores the default once the organisation is touched.
  const untouched = Boolean(orgId) && !touched[orgId];
  const haveUnits = vehicles.length > 0;
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!untouched || !haveUnits) return undefined;
    let gone = false;
    setPicking(true);
    pickDefaultUnit({ orgId, vehicleIds: vehicles.map((v) => v.vehicleId) })
      .then((pick) => {
        if (gone || !pick || store.getState().fuelReport.touched[orgId]) return;
        dispatch(autoPicked({ orgId, pick: { ...pick, fromInput: localInput(pick.from), toInput: localInput(pick.to) } }));
      })
      .catch(() => { /* the page simply waits for a pick, as before */ })
      .finally(() => { if (!gone) setPicking(false); });
    return () => { gone = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, untouched, haveUnits]);
  const why = (() => {
    const a = orgId ? autoPick[orgId] : null;
    if (!a || !live || live.unitId !== a.unitId || live.from !== a.from || live.to !== a.to) return null;
    return a.reason === "theft"
      ? <> · <span className="frp-why frp-why--theft">Latest possible theft: {fmtNum(a.litres)} L at {clock.format(a.at)}</span></>
      : <> · <span className="frp-why">Most ground covered today: {fmtNum(a.km, 0)} km</span></>;
  })();

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
    ? (r.stats.lPer100Km != null ? `${fmtNum(r.stats.lPer100Km)} L/100 km` : r.stats.lPerHour != null ? `${fmtNum(r.stats.lPerHour)} L/h` : "-")
    : "-";
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
      filterNote: `${nameParts(ready.unit.id)}${nameParts(ready.unit.name, ready.unit.id) ? ` (${nameParts(ready.unit.name, ready.unit.id)})` : ""} · ${at(ready.from)} – ${at(ready.to)}`,
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
  const dot = <span className="frp-kpi-none">-</span>;

  return (
    <div className="sp4-root frp-root frp-unit" ref={rootRef}>
      {/* ── KPI strip and filter bar. They used to fold away behind a "Hide
           filters" button, removed on request (operator, 2026-10-13); the
           Graph & map tab fits the screen with them shown. ── */}
      <>
          <div className="sp4-header">
            <div data-tour="page-kpis" className="sp4-header-kpis">
              {/* The tank's balance, read left to right as the sum it is:
                  start + filled − possible theft − consumed = end. Each term
                  is rounded before consumed is derived, so it closes exactly. */}
              <Kpi n={r ? fmtNum(r.stats.fuelStartL) : dot} label="Start, L" tone="fleet"
                   title="The level at the start of the period, the median of the first readings, so one slosh does not set it." />
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
            <div data-tour="page-range" className="frp-range">
              <WhenField label="From" value={span.from} max={span.to}
                         onChange={(v) => setSpan((s) => ({ ...s, from: v, id: null }))} />
              <span className="frp-range__dash" aria-hidden="true">–</span>
              <WhenField label="To" value={span.to} min={span.from}
                         onChange={(v) => setSpan((s) => ({ ...s, to: v, id: null }))} />
            </div>
            <button data-tour="page-run" type="button" className="sp4-submit-btn frp-run" onClick={execute} disabled={!canRun || state.status === "loading"}
                    title={!unit ? "Choose a unit first" : tooLong ? `${MAX_DAYS} days at most` : "Build the report"}>
              {state.status === "loading" ? (state.total > 1 ? `Reading ${state.done}/${state.total}…` : "Reading…") : "Execute"}
            </button>
          </div>
      </>

      <div className="sp4-body frp-body">
        {!ready && (
          picking && untouched ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Finding a Unit to Show">
              Looking for the latest possible theft, or else the unit that covered the most ground today.
            </EmptyNote>
          ) : state.status === "loading" ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Building the Report"
                        progress={state.total > 1 ? state.done / state.total : null}>
              {/* One request for the whole period, or (an older server) a day at a time. */}
              {state.total > 1
                ? `Reading day ${Math.min(state.done + 1, state.total)} of ${state.total}: readings, fillings and drains.`
                : "Reading the period's readings, fillings and drains."}
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
            <div data-tour="page-tabs" className="sp4-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
                        className={`sp4-tab${activeTab === t.key ? " sp4-tab--on" : ""}`} onClick={() => setTab(t.key)}>
                  {t.label}
                  {tabCount[t.key] != null && <span className="sp4-tab-n">{tabCount[t.key]}</span>}
                </button>
              ))}
            </div>

            <TableToolbar
              summary={<>
                <b>{nameParts(ready.unit.id)}</b>{nameParts(ready.unit.machineName || ready.unit.name, ready.unit.id) ? ` · ${nameParts(ready.unit.machineName || ready.unit.name, ready.unit.id)}` : ""}
                {" · "}{at(ready.from)} – {at(ready.to)}
                {why}
                {ready.failedDays > 0 && <span className="frp-warn"> · {ready.failedDays} day(s) failed to load</span>}
              </>}
              loading={false}
              onReload={execute}
              onCsv={csvFor[activeTab]}
              onPdf={exportPdf}
            />

            {activeTab === "graph" && (
              <div className={`frp-graphmap${ready.series.length ? "" : " frp-graphmap--empty"}`}>
                {/* The lines and the period's fuel, down the left of graph and
                    map, so all of it reads at a glance (operator, 2026-10-13). */}
                {ready.series.length > 0 && (
                  <aside className="frp-rail" aria-label="Graph lines and fuel summary">
                    <LineList lines={lines} onToggle={toggle("lines")} onAll={(on) => dispatch(allLinesSet(on))} />
                    <SideSummary report={r} />
                  </aside>
                )}
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
                {ready.series.length > 0 && <FuelSummary unit={ready.unit} stats={r.stats} />}
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

/**
 * Two views of the fleet's fuel: the FLEET REVIEW (every unit against its
 * standard — the operator's performance review) and the UNIT ANALYSIS (one
 * tank, one period). Selecting a unit in the review opens its analysis.
 */
const MODE_KEY = "fuelReport.mode";
export default function FuelReportScreen() {
  const { orgId } = useFleetLiveShared();
  const { activeCompany } = useCompanies();
  const dispatch = useDispatch();
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) === "unit" ? "unit" : "review"; } catch { return "review"; }
  });
  const setMode = (m) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* per-viewer nicety only */ }
  };
  const openUnit = (vehicleId) => {
    if (orgId) dispatch(unitChosen(orgId, vehicleId));
    setMode("unit");
  };
  return (
    <div className="sp4-root frp-shell">
      <div data-tour="page-modes" className="frp-modes" role="tablist" aria-label="Fuel report view">
        {[["review", "Performance"], ["unit", "Vehicle analytics"]].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k}
                  className={`frp-mode${mode === k ? " frp-mode--on" : ""}`} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>
      {mode === "review"
        ? <FuelPerformanceReview orgId={orgId} orgName={activeCompany?.name} onOpenUnit={openUnit} />
        : <UnitFuelReport />}
    </div>
  );
}
