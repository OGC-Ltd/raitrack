/**
 * Highlights — how one unit was used over a chosen period.
 *
 * The four figures the operators asked for on the August–September reviews
 * (drive hours a day, total km, km a day, fuel a day) and the places it spent
 * its time, worked out on the server from the unit's Wialon history
 * (fleet-server modules/usage-review) with the method those reviews were
 * proofread on. The page draws it and ties every view together: pick a day on
 * the distance chart or the map and the others follow; pick a place on
 * the map or in the list and the days it was there light up.
 *
 * The workbook (every row, Power BI-ready) and the PDF (figures and pictures)
 * are drawn by the server from the same build.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import "../body/SensorPanel.css";
import "./FuelReportScreen.css";
import "./UsageReviewScreen.css";
import StopSign, { stopSignIcon } from "./StopSign";
import LogbookPlayback from "./LogbookPlayback";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { loadMapEngine, maps as mapsNs } from "../../lib/mapEngine";
import { installOsmBase, OSM_TYPE_ID, OSM_ATTRIBUTION } from "../../lib/osmBase";
import { installGoogleBase, GOOGLE_TYPE_ID, GOOGLE_BASE_AVAILABLE, GOOGLE_ATTRIBUTION } from "../../lib/googleBase";
import MapStatusBar from "../body/MapStatusBar";
import EmptyNote from "../shared/EmptyNote";
import UnitPicker from "../body/UnitPicker";
import TablePager, { usePager, PAGE_STEP } from "../body/TablePager";
import { getUsageReview, downloadUsageReview, getPlaceActivities } from "../../api/usageReview";
import { googlePlaceNames, googleLabel, googleIsSpot } from "../../lib/googlePlaceNames";
import { osmPlaceNames } from "../../lib/osmPlaceNames";
import { defaultLogbookUnit } from "../../lib/logbookDefault";
import { placeCase, labelOf, PlaceNames } from "./logbookPlaces";
import { buildWeb, arc, bearing, edgeWidth } from "../../lib/movementWeb";

export { placeCase };
import { watchTableLabels } from "../../lib/tableLabels";

const TZ = "Africa/Nairobi";
const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
const UNIT_KEY = "ft-usage-review-unit:";
/** The period last built, per organisation: a preset id, or its two days. */
const SPAN_KEY = "ft-usage-review-span:";
function readSpan(orgId) {
  try {
    const s = orgId ? JSON.parse(localStorage.getItem(SPAN_KEY + orgId) ?? "null") : null;
    if (s?.id) return preset(s.id);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s?.from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(s?.to ?? "")) return { from: s.from, to: s.to, id: null };
  } catch { /* per-viewer nicety only */ }
  return null;
}
/** Session flag per organisation: the operator picked or built something here
 *  this session, so the default vehicle (lib/logbookDefault) no longer applies. */
const PICKED_KEY = "ft-logbook-picked:";
const picked = (orgId) => { try { return sessionStorage.getItem(PICKED_KEY + orgId) === "1"; } catch { return false; } };
const markPicked = (orgId) => { try { if (orgId) sessionStorage.setItem(PICKED_KEY + orgId, "1"); } catch { /* session nicety only */ } };

const BUILT_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
const fmtBuilt = (ms) => BUILT_FMT.format(ms);

const nf = (n, d = 1) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "24 Sep" from "2026-09-24"; with the weekday, "Thu 24 Sep". */
const dayLabel = (d, weekday = false) => {
  if (!d) return "—";
  const s = `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
  return weekday ? `${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${s}` : s;
};
const hm = (h) => {
  if (h == null) return "—";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const minutes = (m) => (m < 60 ? `${Math.round(m)} min` : hm(m / 60));
/** Rows a table page holds: what fits the shared card height (--urv-card-h). */
const PAGE_ROWS = 5;

// ── period ──────────────────────────────────────────────────────────────────

const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysIn = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
const PRESETS = [
  ["d7", "7 days"], ["d30", "30 days"], ["month", "This month"], ["last", "Last month"], ["two", "Last 2 months"],
];
function preset(id) {
  const today = fleetDayKey();
  const first = `${today.slice(0, 8)}01`;
  if (id === "d7") return { from: addDays(today, -6), to: today, id };
  if (id === "d30") return { from: addDays(today, -29), to: today, id };
  if (id === "month") return { from: first, to: today, id };
  const lastEnd = addDays(first, -1);
  const lastStart = `${lastEnd.slice(0, 8)}01`;
  if (id === "last") return { from: lastStart, to: lastEnd, id };
  const prevEnd = addDays(lastStart, -1);
  return { from: `${prevEnd.slice(0, 8)}01`, to: lastEnd, id };
}

function DateField({ label, value, onChange, min, max }) {
  const open = (e) => { try { e.currentTarget.showPicker?.(); } catch { /* typing still works */ } };
  return (
    <label className="frp-when">
      <span className="frp-when__l">{label}</span>
      <span className="frp-when__v">{value ? `${dayLabel(value)} ${value.slice(0, 4)}` : "—"}</span>
      <svg className="frp-when__i" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <input type="date" className="frp-when__input" value={value} min={min} max={max} aria-label={label}
             onClick={open} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

function Kpi({ n, unit, label, sub, tone, title }) {
  return (
    <div className={`sp4-kpi urv-kpi${tone ? ` sp4-kpi--${tone}` : ""}`} title={title}>
      <span className="sp4-kpi-n">{n}{unit && <small className="urv-kpi__u">{unit}</small>}</span>
      <span className="sp4-kpi-l">{label}</span>
      {sub && <span className="urv-kpi__sub">{sub}</span>}
    </div>
  );
}

const STAGE_WORD = {
  queued: "Waiting for a free slot",
  loading: "Reading the unit's history",
  computing: "Working out the figures",
  naming: "Naming the places",
};

// ── map ─────────────────────────────────────────────────────────────────────

/**
 * The theme's series colours (FuelReportScreen.css, `--frv-*`), read off the
 * page so the map, whose markers are drawn outside CSS, and the charts wear
 * the same blue, orange and green as the Fuel Report, in either theme.
 */
const PALETTE_FALLBACK = { route: "#2a78d6", place: "#eb6834", base: "#1baf7a", fade: "#94a3b8", faint: "#cbd5e1", ink: "#4b5563" };
function readPalette(el) {
  if (!el) return PALETTE_FALLBACK;
  const cs = getComputedStyle(el);
  const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
  return {
    route: v("--frv-s1", PALETTE_FALLBACK.route),
    place: v("--frv-s2", PALETTE_FALLBACK.place),
    base: v("--frv-s3", PALETTE_FALLBACK.base),
    fade: v("--frv-neutral", PALETTE_FALLBACK.fade),
    faint: v("--frv-neutral-2", PALETTE_FALLBACK.faint),
    ink: v("--sp4-text-3", PALETTE_FALLBACK.ink),
  };
}
const MAX_PLACES_ON_MAP = 30;
/** Connections drawn on the map's web; the rest are in the table. */
const MAX_WEB_EDGES = 40;

/** The base map picked here and on the live map's Maps panel (one choice). */
const BASE_MAP_KEY = "ft-map-base";
const readBase = () => {
  try { return GOOGLE_BASE_AVAILABLE && localStorage.getItem(BASE_MAP_KEY) === "google" ? "google" : "osm"; } catch { return "osm"; }
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A place's name: Google's exact name when it has one, else OpenStreetMap's. */
// Google's name, else the OpenStreetMap business the server found there, else the area.
const nameOf = (p, gnames) => (p ? gnames?.get(p.id) ?? p.exactName ?? placeCase(p.name) : null);
const hasExact = (p, gnames) => !!(gnames?.has(p.id) || p.exactName);
function ReviewMap({ review, sel, setSel, placeDays, pal, gnames, mode, setMode, web, webEdge, setWebEdge }) {
  const el = useRef(null);
  const wrap = useRef(null);
  const map = useRef(null);
  const tracks = useRef([]);
  const placeMarks = useRef([]);
  const stopMarks = useRef([]);
  const names = useRef(null);
  // The selection the tracks were drawn under, and whether the review's first
  // pick (the default, place 1) is still to come: neither moves the camera,
  // so a new review opens on the whole route.
  const selNow = useRef(sel);
  selNow.current = sel;
  const drawnWith = useRef(null);
  const fresh = useRef(false);
  const framedSel = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(null);
  const [mapObj, setMapObj] = useState(null);
  const [base, setBase] = useState(readBase);
  const [baseNote, setBaseNote] = useState(null);
  // What the pointer is over (a place, a day's route or a stop) and where.
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let alive = true;
    loadMapEngine().then((maps) => {
      if (!alive || !el.current || map.current) return;
      // No wheel zoom: the map sits in a scrolling page, and the wheel is for
      // the page (operator, 2026-10-08). The +/- buttons and double-click zoom.
      map.current = new maps.Map(el.current, {
        center: { lat: 0.5, lng: 34.6 }, zoom: 9, zoomControl: true, fullscreenControl: true, scrollwheel: false,
      });
      installOsmBase(maps, map.current);
      map.current.setMapTypeId(OSM_TYPE_ID);
      names.current = new PlaceNames();
      names.current.setMap(map.current);
      setMapObj(map.current);
      setReady(true);
    }).catch((e) => alive && setFailed(e.message || "Map unavailable"));
    return () => { alive = false; };
  }, []);

  // The base map. Google's imagery loads on first use; if it cannot (a refused
  // key, offline) the map stays on OpenStreetMap and says why.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return undefined;
    let dead = false;
    if (base === "google") {
      installGoogleBase(m)
        .then(() => { if (!dead) { m.setMapTypeId(GOOGLE_TYPE_ID); setBaseNote(null); } })
        .catch((e) => {
          if (dead) return;
          setBaseNote(`Satellite is unavailable: ${e.message}.`);
          setBase("osm");
        });
    } else {
      m.setMapTypeId(OSM_TYPE_ID);
    }
    return () => { dead = true; };
  }, [base, ready]);

  const chooseBase = (id) => {
    try { localStorage.setItem(BASE_MAP_KEY, id); } catch { /* a remembered choice only */ }
    setBaseNote(null);
    setBase(id);
  };

  const fitTo = useCallback((pts, maxZoom = 14) => {
    const m = map.current;
    if (!m || !pts.length) return;
    const b = new mapsNs.LatLngBounds();
    pts.forEach(([lat, lng]) => b.extend({ lat, lng }));
    m.fitBounds(b, 50);
    if (m.getZoom() > maxZoom) m.setZoom(maxZoom);
  }, []);

  /** The pointer's position inside the map box, for the hover card. */
  const at = useCallback((ev) => {
    const box = wrap.current?.getBoundingClientRect();
    const d = ev?.domEvent;
    return box && d ? { x: d.clientX - box.left, y: d.clientY - box.top, w: box.width, h: box.height } : null;
  }, []);

  // Tracks and places: drawn once per review.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    tracks.current.forEach((t) => { t.line.setMap(null); t.hit.setMap(null); });
    placeMarks.current.forEach((p) => p.marker.setMap(null));
    setHover(null);
    const dayOf = new Map(review.days.map((d) => [d.date, d]));
    tracks.current = review.tracks.map((t) => {
      const path = t.path.map(([lat, lng]) => ({ lat, lng }));
      const line = new mapsNs.Polyline({ map: m, path, strokeColor: pal.route, strokeOpacity: 0.6, strokeWeight: 2.5 });
      // A wide, all-but-invisible twin takes the pointer: the drawn line is
      // too thin to hover or click reliably.
      const hit = new mapsNs.Polyline({ map: m, path, strokeColor: "#000", strokeOpacity: 0.01, strokeWeight: 14, clickable: true, zIndex: 3 });
      const rec = { date: t.date, line, hit, w: 2.5 };
      hit.addListener("click", () => setSel((s) => ({ ...s, day: s.day === t.date ? null : t.date })));
      hit.addListener("mouseover", (ev) => {
        line.setOptions({ strokeWeight: 5 });
        setHover({ kind: "day", day: dayOf.get(t.date) ?? { date: t.date }, pos: at(ev) });
      });
      hit.addListener("mouseout", () => {
        line.setOptions({ strokeWeight: rec.w });
        setHover((h) => (h?.kind === "day" ? null : h));
      });
      return rec;
    });
    const top = review.places.slice(0, MAX_PLACES_ON_MAP);
    const ref = Math.max(1, ...top.slice(0, 2).map((p) => p.hours));
    placeMarks.current = top.map((p) => {
      const marker = new mapsNs.Marker({ map: m, position: { lat: p.lat, lng: p.lng }, zIndex: 100 - p.id });
      marker.addListener("click", () => setSel((s) => ({ ...s, place: s.place === p.id ? null : p.id })));
      marker.addListener("mouseover", (ev) => setHover({ kind: "place", place: p, pos: at(ev) }));
      marker.addListener("mouseout", () => setHover((h) => (h?.kind === "place" ? null : h)));
      return { id: p.id, marker, scale: 7 + 9 * Math.sqrt(Math.min(1, p.hours / ref)) };
    });
    fitTo(review.tracks.flatMap((t) => t.path).concat(top.slice(0, 10).map((p) => [p.lat, p.lng])), 13);
    drawnWith.current = selNow.current;
    fresh.current = true;
  }, [ready, review, setSel, fitTo, at, pal]);

  // Selection: restyle, show the day's stops, and frame what was picked.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const daysOfPlace = sel.place != null ? placeDays.get(sel.place) ?? new Set() : null;
    const on = (date) => (sel.day ? date === sel.day : daysOfPlace ? daysOfPlace.has(date) : true);
    const focused = sel.day != null || daysOfPlace != null;
    for (const t of tracks.current) {
      // The web draws connections instead of the day-by-day route.
      t.line.setVisible(mode !== "web");
      t.hit.setVisible(mode !== "web");
      const lit = on(t.date);
      t.w = lit && focused ? 4 : 2.5;
      t.line.setOptions({
        strokeColor: lit ? pal.route : pal.fade,
        strokeOpacity: lit ? (focused ? 0.95 : 0.6) : 0.22,
        strokeWeight: t.w,
        zIndex: lit ? 2 : 1,
      });
    }
    const dayPlaces = sel.day ? new Set(review.stops.filter((s) => dayKeyOf(s.start) === sel.day).map((s) => s.place)) : null;
    for (const p of placeMarks.current) {
      const chosen = sel.place === p.id;
      const dim = (dayPlaces && !dayPlaces.has(p.id)) || (sel.place != null && !chosen);
      p.marker.setOptions({
        icon: {
          path: mapsNs.SymbolPath.CIRCLE, scale: chosen ? p.scale + 3 : p.scale,
          fillColor: p.id === 1 ? pal.base : pal.place, fillOpacity: dim ? 0.3 : 0.92,
          strokeColor: chosen ? "#111827" : "#ffffff", strokeWeight: chosen ? 3 : 2,
        },
        label: p.id <= 15 ? { text: String(p.id), color: "#fff", fontSize: "10px", fontWeight: "700" } : undefined,
      });
    }
    stopMarks.current.forEach((s) => s.setMap(null));
    stopMarks.current = [];
    if (sel.day) {
      const st = review.stops.filter((s) => dayKeyOf(s.start) === sel.day);
      stopMarks.current = st.map((s) => {
        const mk = new mapsNs.Marker({
          map: m, position: { lat: s.lat, lng: s.lng }, zIndex: 200,
          icon: stopSignIcon(14),
        });
        mk.addListener("mouseover", (ev) => setHover({ kind: "stop", stop: s, pos: at(ev) }));
        mk.addListener("mouseout", () => setHover((h) => (h?.kind === "stop" ? null : h)));
        mk.addListener("click", () => { if (s.place != null) setSel((x) => ({ ...x, place: x.place === s.place ? null : s.place })); });
        return mk;
      });
    }
    const stale = sel === drawnWith.current;
    const firstPick = !stale && fresh.current;
    if (!stale) fresh.current = false;
    // Frame only on a new pick, not when a theme switch redraws the same one.
    const changed = sel !== framedSel.current;
    framedSel.current = sel;
    if (stale || firstPick || !changed) return;
    if (sel.day) {
      const st = review.stops.filter((s) => dayKeyOf(s.start) === sel.day);
      const path = review.tracks.filter((t) => t.date === sel.day).flatMap((t) => t.path);
      fitTo(path.length ? path : st.map((s) => [s.lat, s.lng]), 15);
    } else if (sel.place != null) {
      // Bring it into view without throwing away the zoom the operator chose.
      const p = review.places.find((x) => x.id === sel.place);
      if (p) {
        if (m.getZoom() < 12) { m.setCenter({ lat: p.lat, lng: p.lng }); m.setZoom(12); }
        else m.panTo({ lat: p.lat, lng: p.lng });
      }
    }
  }, [ready, sel, setSel, review, placeDays, fitTo, at, pal, mode]);

  // ── the movement web: a bowed arrow per connection, width by trips ──
  const webLayers = useRef([]);
  useEffect(() => {
    const m = map.current;
    webLayers.current.forEach((l) => l.setMap(null));
    webLayers.current = [];
    if (!ready || !m || mode !== "web") return;
    const byId = new Map(review.places.map((p) => [p.id, p]));
    const edges = web.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).slice(0, MAX_WEB_EDGES);
    const max = Math.max(1, ...edges.map((e) => e.trips));
    const focused = webEdge != null || sel.place != null;
    const out = [];
    // Quietest first, so the busy connections draw on top.
    for (const e of [...edges].reverse()) {
      const a = byId.get(e.from), b = byId.get(e.to);
      const lit = webEdge ? webEdge === e.key : sel.place != null ? e.from === sel.place || e.to === sel.place : true;
      const path = arc(a, b);
      const w = edgeWidth(e.trips, max);
      const color = webEdge === e.key ? pal.place : pal.route;
      const line = new mapsNs.Polyline({ map: m, path, strokeColor: color, strokeOpacity: lit ? (focused ? 0.9 : 0.6) : 0.12, strokeWeight: w, zIndex: lit ? 4 : 2 });
      const hit = new mapsNs.Polyline({ map: m, path, strokeColor: "#000", strokeOpacity: 0.01, strokeWeight: Math.max(14, w + 6), clickable: true, zIndex: 5 });
      hit.addListener("mouseover", (ev) => { line.setOptions({ strokeOpacity: 1 }); setHover({ kind: "edge", edge: e, pos: at(ev) }); });
      hit.addListener("mouseout", () => { line.setOptions({ strokeOpacity: lit ? (focused ? 0.9 : 0.6) : 0.12 }); setHover((h) => (h?.kind === "edge" ? null : h)); });
      hit.addListener("click", () => setWebEdge((k) => (k === e.key ? null : e.key)));
      // The arrowhead, two thirds of the way along, turned to the way it goes.
      const i = Math.round(path.length * 0.62);
      const deg = bearing(path[i - 1], path[i + 1] ?? path[i]);
      const size = Math.round(15 + 1.5 * w);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20"><path d="M10 2 L17 17 L10 13 L3 17 Z" transform="rotate(${deg.toFixed(1)} 10 10)" fill="${color}" fill-opacity="${lit ? 0.95 : 0.2}" stroke="#fff" stroke-width="1.2"/></svg>`;
      const head = new mapsNs.Marker({
        map: m, position: path[i], clickable: false, zIndex: lit ? 60 : 20,
        icon: { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size: { width: size, height: size }, anchor: { x: size / 2, y: size / 2 } },
      });
      out.push(line, hit, head);
    }
    webLayers.current = out;
    return () => out.forEach((l) => l.setMap(null));
  }, [ready, mode, review, web, webEdge, sel.place, pal, at, setWebEdge]);

  // The names beside the circles: their own effect, so a Google name arriving
  // relabels the map without reframing it.
  useEffect(() => {
    if (!ready) return;
    const dayPlaces = sel.day ? new Set(review.stops.filter((s) => dayKeyOf(s.start) === sel.day).map((s) => s.place)) : null;
    const byId = new Map(review.places.map((p) => [p.id, p]));
    names.current?.set(placeMarks.current.map((pm) => {
      const p = byId.get(pm.id);
      const chosen = sel.place === pm.id;
      return {
        id: pm.id, lat: p.lat, lng: p.lng, text: labelOf(p, gnames) || `Place ${p.id}`,
        gap: (chosen ? pm.scale + 3 : pm.scale) + 5,
        dim: (dayPlaces && !dayPlaces.has(pm.id)) || (sel.place != null && !chosen),
        strong: chosen,
      };
    }));
  }, [ready, sel, review, gnames]);

  const placeName = (id) => nameOf(review.places.find((p) => p.id === id), gnames) ?? `Place ${id}`;
  const picked = sel.place != null ? review.places.find((p) => p.id === sel.place) : null;
  const pickedDay = sel.day ? review.days.find((d) => d.date === sel.day) : null;
  const dayStops = sel.day ? review.stops.filter((s) => dayKeyOf(s.start) === sel.day).length : 0;

  let tip = null;
  if (hover?.pos) {
    const { x, y, w, h } = hover.pos;
    const style = {
      ...(x > w - 230 ? { right: w - x + 12 } : { left: x + 14 }),
      ...(y > h - 110 ? { bottom: h - y + 12 } : { top: y + 14 }),
    };
    if (hover.kind === "place") {
      const p = hover.place;
      tip = (
        <div className="urv-tip" style={style}>
          <b>{p.id}. {nameOf(p, gnames) ?? "Place"}</b>
          {hasExact(p, gnames) && p.name && <span>{placeCase(p.name)}</span>}
          <span>{nf(p.hours, 1)} h · {plural(p.visits, "stop")} · {plural(p.days, "day")}</span>
          {p.county && <span>{p.county}</span>}
          <em>{sel.place === p.id ? "Click to clear" : "Click to light up its days"}</em>
        </div>
      );
    } else if (hover.kind === "day") {
      const d = hover.day;
      tip = (
        <div className="urv-tip" style={style}>
          <b>{dayLabel(d.date, true)}</b>
          {d.km != null && <span>{nf(d.km, 1)} km · {hm(d.driveH)} driving</span>}
          <em>{sel.day === d.date ? "Click to clear" : "Click to follow this day"}</em>
        </div>
      );
    } else if (hover.kind === "edge") {
      const e = hover.edge;
      tip = (
        <div className="urv-tip" style={style}>
          <b>{placeName(e.from)} → {placeName(e.to)}</b>
          <span>{plural(e.trips, "trip")} · about {minutes(e.avgMin)} and {nf(e.avgKm, 1)} km each</span>
          <span>{nf(e.km, 0)} km in all · {dayLabel(dayKeyOf(e.first))}{e.trips > 1 ? ` – ${dayLabel(dayKeyOf(e.last))}` : ""}</span>
          <em>{webEdge === e.key ? "Click to clear" : "Click to pick this connection"}</em>
        </div>
      );
    } else if (hover.kind === "stop") {
      const s = hover.stop;
      tip = (
        <div className="urv-tip" style={style}>
          <b>Stop {clock.format(s.start)}–{clock.format(s.end)}</b>
          <span>{minutes(s.min)}{s.place != null ? ` · ${placeName(s.place)}` : ""}</span>
        </div>
      );
    }
  }

  return (
    <div data-tour="logbook-map" className="urv-map" ref={wrap}>
      <div ref={el} className="urv-map__canvas" />
      <MapStatusBar map={mapObj} attribution={base === "google" ? GOOGLE_ATTRIBUTION : OSM_ATTRIBUTION} className="map-status--panel" />
      <div className="urv-map__top">
        <div className="urv-map__legend" aria-hidden="true">
          {mode === "web"
            ? <span><i style={{ background: pal.route }} className="urv-line" />Connection · width = trips</span>
            : <span><i style={{ background: pal.route }} className="urv-line" />Route</span>}
          <span><i style={{ background: pal.base }} />Base (most time)</span>
          <span><i style={{ background: pal.place }} />Other places · size = hours</span>
        </div>
        <div className="urv-map__base urv-map__mode" role="group" aria-label="Show on the map">
          {[["route", "Route", "Each day's route"], ["web", "Web", "Movement web: which places it drives between, and how often"]].map(([id, label, t]) => (
            <button key={id} type="button" className={mode === id ? "is-on" : ""} aria-pressed={mode === id} title={t}
                    onClick={() => { setMode(id); if (id !== "web") setWebEdge(null); }}>{label}</button>
          ))}
        </div>
        {GOOGLE_BASE_AVAILABLE && (
          <div className="urv-map__base" role="group" aria-label="Base map">
            {[["osm", "OpenStreetMap"], ["google", "Satellite"]].map(([id, label]) => (
              <button key={id} type="button" className={base === id ? "is-on" : ""} aria-pressed={base === id} onClick={() => chooseBase(id)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      {baseNote && <div className="urv-map__note">{baseNote}</div>}
      {(picked || pickedDay) && (
        <div className="urv-map__pick">
          <div>
            {pickedDay ? (
              <>
                <b>{dayLabel(pickedDay.date, true)}</b>
                <span>{nf(pickedDay.km, 1)} km · {hm(pickedDay.driveH)} driving · {plural(dayStops, "stop")}</span>
              </>
            ) : (
              <>
                <b>{picked.id}. {nameOf(picked, gnames) ?? "Place"}</b>
                <span>{nf(picked.hours, 1)} h · {plural(picked.visits, "stop")} · {plural(picked.days, "day")}{picked.county ? ` · ${picked.county}` : ""}</span>
              </>
            )}
          </div>
          <button type="button" aria-label="Clear" title="Clear"
                  onClick={() => setSel((x) => (x.day ? { ...x, day: null } : { ...x, place: null }))}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}
      {tip}
      {failed && <div className="frp-map__msg">The map could not load: {failed}</div>}
    </div>
  );
}

/** The EAT day of an instant. */
function dayKeyOf(ms) { return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10); }

// ── charts ────────────────────────────────────────────────────────────────

const AXIS_TICK = { fontSize: 10, fill: "var(--sp4-text-3)" };
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

function DailyTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="frp-tip">
      <div className="frp-tip__head"><span className="frp-tip__when">{dayLabel(d.date, true)}</span></div>
      <dl className="frp-tip__rows">
        <div className="frp-tip__row"><dt>Distance</dt><dd>{nf(d.km, 1)}<span className="frp-tip__unit">km</span></dd></div>
        <div className="frp-tip__row"><dt>Driving</dt><dd>{hm(d.driveH)}</dd></div>
        {d.engineH != null && <div className="frp-tip__row"><dt>Engine on</dt><dd>{hm(d.engineH)}</dd></div>}
        {d.firstMove && <div className="frp-tip__row"><dt>First to last move</dt><dd>{clock.format(d.firstMove)} – {clock.format(d.lastMove)}</dd></div>}
      </dl>
    </div>
  );
}

function DailyChart({ days, sel, setSel, placeDays, pal }) {
  const daysOfPlace = sel.place != null ? placeDays.get(sel.place) : null;
  const fill = (d) => {
    if (sel.day) return d.date === sel.day ? pal.route : pal.faint;
    if (daysOfPlace) return daysOfPlace.has(d.date) ? pal.place : pal.faint;
    return d.moved ? pal.route : pal.faint;
  };
  // Recharts 3 no longer hands the chart's click the hovered row; its
  // `activeLabel` is the hovered date, which also covers a click in the gap
  // above a short bar. (Not the Bar's own click as well: both fire, and the
  // second toggled the day straight back off.)
  const pick = (date) => date && setSel((s) => ({ ...s, day: s.day === date ? null : date }));
  return (
    <div className="urv-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={days} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}
                       onClick={(e) => pick(e?.activeLabel)}>
          <CartesianGrid stroke="var(--sp4-line, #e2e8f0)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => dayLabel(d)} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis yAxisId="km" tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
          <YAxis yAxisId="h" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={24} />
          <Tooltip content={<DailyTip />} cursor={{ fill: "rgba(37,99,235,0.08)" }} isAnimationActive={false} />
          <Bar yAxisId="km" dataKey="km" isAnimationActive={false} radius={[2, 2, 0, 0]} style={{ cursor: "pointer" }}>
            {days.map((d) => <Cell key={d.date} fill={fill(d)} />)}
          </Bar>
          <Line yAxisId="h" dataKey="driveH" stroke={pal.ink} strokeWidth={0} dot={{ r: 2, fill: pal.ink, strokeWidth: 0 }}
                activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Driving time in an hour slot: seconds under a minute, so a short move is
 *  never shown as "0 min" beside a visible bar. */
const slotTime = (m) => {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m <= 0) return "None";
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
  return `${nf(m, m < 10 ? 1 : 0)} min`;
};

function HourTip({ active, payload, focus, pal }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="frp-tip">
      <div className="frp-tip__head">
        <span className="frp-tip__when">{hh(d.hour)}–{hh((d.hour + 1) % 24)}</span>
        <span className="frp-tip__state">Driving, average per day</span>
      </div>
      <dl className="frp-tip__rows">
        {focus && (
          <div className="frp-tip__row">
            <dt><i className="frp-tip__sw" style={{ background: focus.color }} />{focus.label}</dt>
            <dd>{slotTime(d.focus)}</dd>
          </div>
        )}
        <div className="frp-tip__row">
          <dt><i className="frp-tip__sw" style={{ background: focus ? pal.faint : pal.route }} />Whole period</dt>
          <dd>{slotTime(d.avg)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * When in the day it drives: 24 bars, the average minutes of driving in each
 * hour over the period. With a day picked, the bars are that day and the
 * average stays behind them, faint; with a place picked, the average over the
 * days it was there.
 */
function HourChart({ days, hourly, sel, placeDays, pal, placeName }) {
  const data = useMemo(() => {
    const n = Math.max(1, days.length);
    const sum = (rows) => Array.from({ length: 24 }, (_, h) => rows.reduce((acc, r) => acc + (r?.[h] ?? 0), 0));
    const avg = sum(hourly).map((v) => v / n);
    let focus = null;
    if (sel.day) {
      const i = days.findIndex((d) => d.date === sel.day);
      focus = i >= 0 ? hourly[i] : null;
    } else if (sel.place != null) {
      const set = placeDays.get(sel.place) ?? new Set();
      const rows = days.map((d, i) => (set.has(d.date) ? hourly[i] : null)).filter(Boolean);
      focus = rows.length ? sum(rows).map((v) => v / rows.length) : null;
    }
    return avg.map((v, h) => ({ hour: h, avg: v, focus: focus ? focus[h] ?? 0 : null }));
  }, [days, hourly, sel.day, sel.place, placeDays]);
  const focused = data[0].focus != null;
  // What the coloured bars are, in the tooltip: the picked day, or the days
  // the unit stopped at the picked place, by its name and how many there were.
  const nPlaceDays = sel.place != null ? placeDays.get(sel.place)?.size ?? 0 : 0;
  const focus = !focused ? null
    : sel.day ? { label: dayLabel(sel.day, true), color: pal.route }
    : { label: `${placeName(sel.place)} (${nPlaceDays} ${nPlaceDays === 1 ? "day" : "days"})`, color: pal.place };
  return (
    <div className="urv-chart urv-chart--hours">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barGap={-10}>
          <CartesianGrid stroke="var(--sp4-line, #e2e8f0)" vertical={false} />
          <XAxis dataKey="hour" tickFormatter={(h) => String(h).padStart(2, "0")} tick={AXIS_TICK} tickLine={false} axisLine={false} interval={2} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} unit="m" />
          <Tooltip content={<HourTip focus={focus} pal={pal} />} cursor={{ fill: "var(--sp4-raised)" }} isAnimationActive={false} />
          <Bar dataKey="avg" fill={focused ? pal.faint : pal.route} radius={[3, 3, 0, 0]} maxBarSize={10} isAnimationActive={false} />
          {focused && <Bar dataKey="focus" fill={sel.day ? pal.route : pal.place} radius={[3, 3, 0, 0]} maxBarSize={10} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function UsageReviewScreen() {
  const { vehicles = [], orgId } = useFleetLiveShared();
  const queryClient = useQueryClient();
  const [unitId, setUnitIdState] = useState(null);
  useEffect(() => {
    try { setUnitIdState(orgId ? localStorage.getItem(UNIT_KEY + orgId) : null); } catch { setUnitIdState(null); }
  }, [orgId]);
  const setUnitId = (id) => {
    markPicked(orgId);
    setUnitIdState(id);
    try { if (orgId) localStorage.setItem(UNIT_KEY + orgId, id ?? ""); } catch { /* per-viewer nicety only */ }
  };
  const unit = useMemo(() => vehicles.find((v) => v.vehicleId === unitId) ?? null, [vehicles, unitId]);
  const [span, setSpan] = useState(() => preset("last"));
  // The period last built here comes back with the unit, so its saved review
  // can be shown on arrival (below).
  useEffect(() => { const s = readSpan(orgId); if (s) setSpan(s); }, [orgId]);
  const [kmplText, setKmplText] = useState("");
  const [request, setRequest] = useState(null);
  const [sel, setSel] = useState({ day: null, place: null });
  // The map's view — each day's route, or the movement web — and the web's
  // picked connection ("from>to").
  const [mapMode, setMapMode] = useState("route");
  const [webEdge, setWebEdge] = useState(null);
  // The day open in the playback modal, if any.
  const [playDay, setPlayDay] = useState(null);
  const [busy, setBusy] = useState(null);
  const [dlError, setDlError] = useState(null);
  const freshRef = useRef(false);
  const rootRef = useRef(null);
  const [pal, setPal] = useState(PALETTE_FALLBACK);
  // Labels for the tables' phone card layout, as on the other screens.
  useEffect(() => watchTableLabels(rootRef.current), []);

  const today = fleetDayKey();
  const nDays = span.from && span.to ? daysIn(span.from, span.to) : 0;
  const tooLong = nDays > MAX_DAYS;
  const backwards = nDays < 1;
  const canRun = Boolean(unit?.vehicleId && orgId && !tooLong && !backwards);
  const live = request && request.orgId === orgId ? request : null;

  const q = useQuery({
    queryKey: ["usage-review", live?.orgId, live?.vehicleId, live?.from, live?.to],
    enabled: Boolean(live),
    queryFn: ({ signal }) => {
      const fresh = freshRef.current;
      freshRef.current = false;
      return getUsageReview({ ...live, fresh, signal });
    },
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false),
    // Keep asking while the tab is in the background: a build takes up to a
    // minute, and the operator who switches away should come back to it done.
    refetchIntervalInBackground: true,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  // A review already built for the unit and period picked is shown at once,
  // without Build (operator, 2026-10-13: "on the logbook we can render the
  // cached data"). The server is asked only for what it holds or is building
  // (`cached`), never to start one; what it has becomes the page's review.
  const pick = canRun ? { orgId, vehicleId: unit.vehicleId, from: span.from, to: span.to } : null;
  const showing = Boolean(live && pick && live.vehicleId === pick.vehicleId && live.from === pick.from && live.to === pick.to);
  const peek = useQuery({
    queryKey: ["usage-review-peek", pick?.orgId, pick?.vehicleId, pick?.from, pick?.to],
    enabled: Boolean(pick) && !showing,
    queryFn: ({ signal }) => getUsageReview({ ...pick, cached: true, signal }),
    staleTime: 60_000,
    retry: 0,
  });
  useEffect(() => {
    const d = peek.data;
    if (!pick || showing || (d?.status !== "ready" && d?.status !== "running")) return;
    queryClient.setQueryData(["usage-review", pick.orgId, pick.vehicleId, pick.from, pick.to], d);
    setRequest(pick);
  // `pick` is rebuilt every render; its fields are in the peek's key
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek.data, showing]);

  const st = q.data;
  const review = st?.status === "ready" ? st.review : null;
  const web = useMemo(() => buildWeb(review?.trips), [review]);
  useEffect(() => { setWebEdge(null); }, [review]);
  const runUnit = useMemo(() => (live ? vehicles.find((v) => v.vehicleId === live.vehicleId) : null), [live, vehicles]);

  // A new review opens with its first place (most time) picked, so the
  // detail table has something to show (operator, 2026-10-08).
  useEffect(() => { setSel({ day: null, place: review?.places.length ? review.places[0].id : null }); setPlayDay(null); }, [review]);
  // Google's exact names for the places on the map, filled in as they arrive;
  // the OpenStreetMap name stands until then, and wherever Google has none.
  const [gnames, setGnames] = useState(() => new Map());
  // And what each is (Banking, Food and drink…), from Google's type for it:
  // id → { activity, kind }, where kind is Google's own word ("Bank").
  const [gacts, setGacts] = useState(() => new Map());
  // The lookup in flight, so a download can wait for the names to land; and
  // the names as they arrive, read by the download after that wait.
  const namingRef = useRef(Promise.resolve());
  const gnamesRef = useRef(new Map());
  useEffect(() => {
    setGnames(new Map());
    setGacts(new Map());
    gnamesRef.current = new Map();
    if (!review) { namingRef.current = Promise.resolve(); return undefined; }
    const ac = new AbortController();
    // Not the places the server named from a site plan or geofence (`nameFrom`,
    // operator 2026-10-09): inside Raiply's fence is Raiply, and the nearest
    // business Google finds there is the wrong name, not a better one.
    const list = review.places.slice(0, MAX_PLACES_ON_MAP).filter((p) => !p.nameFrom);
    // Google's own word for each place at the spot ("Gas station"): the hint
    // OpenAI reads beside the name.
    const hints = new Map();
    const google = googlePlaceNames(list,
      (id, g) => {
        const label = googleLabel(g);
        if (!label) return;
        if (g.kind) hints.set(id, g.kind);
        // A neighbour "0.6 km away" does not beat the business OpenStreetMap
        // has at the spot itself.
        if (!googleIsSpot(g) && review.places.find((p) => p.id === id)?.exactName) return;
        gnamesRef.current.set(id, g.activity ? { name: label, activity: g.activity } : label);
        setGnames((m) => new Map(m).set(id, label));
        if (g.activity) setGacts((m) => new Map(m).set(id, { activity: g.activity, kind: g.kind }));
      },
      { signal: ac.signal }).catch(() => {});
    // What each named place is, read by the server's model from its exact
    // name (operator, 2026-10-09): "Ka mwalimu jim", "Rodesa Filling Station",
    // where Google types them only as a point of interest. Until it answers,
    // or if it cannot, the reading of the name and Google's type stands.
    const readActivities = (ids) => {
      const named = list.filter((p) => ids.has(p.id)).map((p) => {
        const g = gnamesRef.current.get(p.id);
        // "…, 0.5 km away" too: the server reads the name without the distance.
        const name = (typeof g === "string" ? g : g?.name) ?? p.exactName;
        return name ? { id: p.id, name, hint: hints.get(p.id) ?? null } : null;
      }).filter(Boolean);
      if (!named.length || ac.signal.aborted || !orgId) return Promise.resolve();
      return getPlaceActivities({ orgId, vehicleId: review.vehicle.vehicleId, places: named.map(({ name, hint }) => ({ name, hint })), signal: ac.signal })
        .then(({ activities } = {}) => {
          if (ac.signal.aborted || !activities) return;
          for (const n of named) {
            const a = activities[n.name];
            if (!a) continue;
            const g = gnamesRef.current.get(n.id);
            if (g != null) gnamesRef.current.set(n.id, { name: typeof g === "string" ? g : g.name, activity: a });
            setGacts((m) => new Map(m).set(n.id, { activity: a, kind: m.get(n.id)?.kind ? `${m.get(n.id).kind} · read from the name` : "Read from the name" }));
          }
        })
        .catch(() => {});
    };
    // Once Google has answered, two things at once (2026-10-09: Build to PDF
    // took three minutes, a minute of it this chain run one after another):
    // the model reads the names there are, and OpenStreetMap is asked about
    // the places nobody has named — only those the server has not already
    // asked it about on the build (`poiTried`), which was 15 s a batch for the
    // same answer. The model then reads what OpenStreetMap found.
    namingRef.current = google.then(() => Promise.all([
      readActivities(new Set(list.map((p) => p.id))),
      (() => {
        const found = new Set();
        return osmPlaceNames(
          list.filter((p) => {
            if (p.exactName || p.poiTried) return false;
            const g = gnamesRef.current.get(p.id);
            // A Google neighbour "0.6 km away" gives way to a business at the spot.
            return g == null || (typeof g === "string" && / km away$/.test(g));
          }),
          (id, v) => {
            if (ac.signal.aborted) return;
            found.add(id);
            gnamesRef.current.set(id, v.activity ? { name: v.name, activity: v.activity } : v.name);
            setGnames((m) => new Map(m).set(id, v.name));
            if (v.activity) setGacts((m) => new Map(m).set(id, { activity: v.activity, kind: "OpenStreetMap" }));
          },
          { signal: ac.signal }).catch(() => {}).then(() => readActivities(found));
      })(),
    ])).catch(() => {});
    return () => ac.abort();
  }, [review, orgId]);
  // The theme's colours, read once the page is up and again on a theme switch.
  useEffect(() => {
    const read = () => setPal((old) => {
      const next = readPalette(rootRef.current);
      return JSON.stringify(next) === JSON.stringify(old) ? old : next;
    });
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const app = rootRef.current?.closest(".app-container");
    if (app) mo.observe(app, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Opening the Logbook with nothing picked or built here this session: the
  // organisation's default vehicle (lib/logbookDefault), built straight away
  // over the default period. The operator's remembered unit is left as it is.
  const defaultedRef = useRef(null);
  useEffect(() => {
    if (!orgId || !vehicles.length || defaultedRef.current === orgId || picked(orgId)) return;
    defaultedRef.current = orgId;
    const v = defaultLogbookUnit(vehicles);
    if (!v) return;
    setUnitIdState(v.vehicleId);
    setRequest({ orgId, vehicleId: v.vehicleId, from: span.from, to: span.to });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, vehicles]);

  const build = () => {
    if (!canRun) return;
    markPicked(orgId);
    const next = { orgId, vehicleId: unit.vehicleId, from: span.from, to: span.to };
    try { localStorage.setItem(SPAN_KEY + orgId, JSON.stringify(span.id ? { id: span.id } : { from: span.from, to: span.to })); } catch { /* per-viewer nicety only */ }
    const same = live && live.vehicleId === next.vehicleId && live.from === next.from && live.to === next.to;
    if (same) {
      freshRef.current = true;
      queryClient.refetchQueries({ queryKey: ["usage-review", next.orgId, next.vehicleId, next.from, next.to], exact: true });
    } else setRequest(next);
  };

  const kmplIn = Number(kmplText);
  const kmpl = kmplText && kmplIn > 0 && kmplIn < 100 ? kmplIn : review?.vehicle.kmpl ?? null;
  const s = review?.summary;
  const fuelTotal = s && kmpl ? s.km / kmpl : null;

  // Hours and stops by what the places are (Banking, Food and drink…), most first.
  const byActivity = useMemo(() => {
    const m = new Map();
    for (const p of review?.places ?? []) {
      const a = gacts.get(p.id)?.activity ?? (gnames.has(p.id) ? null : p.activity);
      if (!a) continue;
      const r = m.get(a) ?? { activity: a, hours: 0, stops: 0 };
      r.hours += p.hours; r.stops += p.visits;
      m.set(a, r);
    }
    return [...m.values()].sort((x, y) => y.hours - x.hours);
  }, [review, gnames, gacts]);

  // place → the days it was visited, for the linked highlights.
  const placeDays = useMemo(() => {
    const m = new Map();
    for (const st2 of review?.stops ?? []) {
      const d = dayKeyOf(st2.start);
      if (!m.has(st2.place)) m.set(st2.place, new Set());
      m.get(st2.place).add(d);
    }
    return m;
  }, [review]);

  const download = async (kind) => {
    if (!live || !review) return;
    setBusy(kind); setDlError(null);
    try {
      // Google's and OpenStreetMap's names go into the file: wait for any
      // still on their way, 25 seconds at most — a name that has not come by
      // then is left out.
      await Promise.race([namingRef.current, new Promise((r) => setTimeout(r, 25_000))]);
      await downloadUsageReview({
        orgId: live.orgId, vehicleId: live.vehicleId, from: live.from, to: live.to, kind,
        kmpl: kmplText && kmplIn > 0 ? kmplIn : undefined,
        names: Object.fromEntries(gnamesRef.current),
        // The report's subject: the driver on the vehicle, as the map shows it.
        driver: runUnit?.driver && runUnit.driver !== "Unassigned" ? runUnit.driver : undefined,
        fallbackName: `${review.vehicle.plate.replace(/\s+/g, "")}_${live.from}_${live.to}_${kind === "pdf" ? "tracking-report" : "logbook"}.${kind}`,
      });
    } catch (e) { setDlError(e.message || "Download failed"); }
    finally { setBusy(null); }
  };

  const selDay = sel.day ? review?.days.find((d) => d.date === sel.day) : null;
  const selPlace = sel.place != null ? review?.places.find((p) => p.id === sel.place) : null;
  const detailStops = useMemo(() => (review?.stops ?? []).filter((x) =>
    (!sel.day || dayKeyOf(x.start) === sel.day) && (sel.place == null || x.place === sel.place)), [review, sel]);
  const detailTrips = useMemo(() => (sel.day ? (review?.trips ?? []).filter((t) => dayKeyOf(t.start) === sel.day) : []), [review, sel.day]);
  const [detailKind, setDetailKind] = useState("all");
  useEffect(() => { setDetailKind("all"); }, [sel.day, sel.place]);
  const detailAll = useMemo(() => [
    ...detailStops.map((x) => ({ t: x.start, kind: "stop", x })),
    ...detailTrips.map((x) => ({ t: x.start, kind: "trip", x })),
  ].sort((a, b) => a.t - b.t), [detailStops, detailTrips]);
  const detailRows = useMemo(() => (detailKind === "all" ? detailAll : detailAll.filter((r) => r.kind === detailKind)), [detailAll, detailKind]);
  // Columns that would only repeat the title or stand empty are left out: a
  // place's list is all that place, and a list without drives has no km.
  const showKm = detailRows.some((r) => r.kind === "trip");
  // For a place's stops: the drive that brought it there and the one that took
  // it on, so the list says where it came from and went next.
  const legs = useMemo(() => {
    const trips = [...(review?.trips ?? [])].sort((a, b) => a.start - b.start);
    const before = (t) => { let lo = 0, hi = trips.length - 1, at = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (trips[mid].start <= t) { at = mid; lo = mid + 1; } else hi = mid - 1; } return at; };
    return (stop) => {
      const i = before(stop.start);
      const inn = i >= 0 && trips[i].toPlace === stop.place && stop.start - trips[i].end < 3_600_000 ? trips[i] : null;
      const j = before(stop.end - 1) + 1;
      const out = trips[j] && trips[j].fromPlace === stop.place && trips[j].start - stop.end < 3_600_000 ? trips[j] : null;
      return { from: inn?.fromPlace ?? null, to: out?.toPlace ?? null };
    };
  }, [review]);
  const placePager = usePager(review?.places ?? [], review, PAGE_ROWS);
  // Up to 15 rows a page, and the card grows to hold them.
  const dayIndex = useMemo(() => new Map((review?.days ?? []).map((d) => [d.date, d])), [review]);
  const detailPager = usePager(detailRows, `${sel.day}|${sel.place}|${detailKind}`, PAGE_STEP);
  // A place picked on the map opens the list on its page.
  const setPlacePage = placePager.setPage;
  useEffect(() => {
    if (sel.place != null) setPlacePage(Math.floor((sel.place - 1) / PAGE_ROWS));
  }, [sel.place, setPlacePage]);
  const pname = (id) => nameOf(review?.places.find((p) => p.id === id), gnames) ?? `Place ${id}`;

  const dash = <span className="frp-kpi-none">—</span>;
  const top = review?.places[0];

  return (
    <div className="sp4-root frp-root urv-root" ref={rootRef}>
      <div className="sp4-header">
        <div data-tour="page-kpis" className="sp4-header-kpis">
          <Kpi n={s ? nf(s.driveHPerDay, 2) : dash} unit={s ? " h" : ""} label="Drive time / day" tone="live"
               sub={s?.driveHPerActiveDay != null ? `${nf(s.driveHPerActiveDay, 2)} h per active day` : null}
               title="Time moving at 5 km/h or more, averaged over every calendar day of the period" />
          <Kpi n={s ? nf(s.km, 0) : dash} unit={s ? " km" : ""} label="Total distance" tone="stat"
               sub={s ? `${nf(s.driveH, 1)} h driving` : null} />
          <Kpi n={s ? nf(s.kmPerDay, 1) : dash} unit={s ? " km" : ""} label="Distance / day" tone="fleet"
               sub={s?.kmPerActiveDay != null ? `${nf(s.kmPerActiveDay, 1)} km per active day` : null} />
          <Kpi n={fuelTotal != null ? nf(fuelTotal / s.calendarDays, 1) : dash} unit={fuelTotal != null ? " L" : ""}
               label="Fuel / day (est.)" tone="fuel"
               sub={s ? (kmpl ? `${nf(fuelTotal, 0)} L at ${kmpl} km/L` : "Enter a km/L rate") : null}
               title="An estimate: distance ÷ the km/L rate. Change the rate in the bar below." />
          <Kpi n={s ? `${s.activeDays}/${s.calendarDays}` : dash} label="Days it moved" tone="fleet"
               sub={s?.longestDay ? `Longest ${nf(s.longestDay.km, 0)} km, ${dayLabel(s.longestDay.date)}` : null} />
          <Kpi n={top ? nf(top.hours, 0) : dash} unit={top ? " h" : ""} label="At its base" tone="stat"
               sub={top ? nameOf(top, gnames) : null} title={top ? `${top.lat.toFixed(5)}, ${top.lng.toFixed(5)}` : undefined} />
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar">
        <UnitPicker vehicles={vehicles} value={unitId} onChange={setUnitId} />
        <div className="sp4-filter-divider" />
        <div className="sp4-filter-group frp-period" role="group" aria-label="Period">
          {PRESETS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={span.id === id}
                    className={`sp4-filter-chip${span.id === id ? " sp4-filter-chip--on" : ""}`}
                    onClick={() => setSpan(preset(id))}>{label}</button>
          ))}
        </div>
        <div data-tour="page-range" className="frp-range">
          <DateField label="From" value={span.from} max={span.to || today} onChange={(v) => setSpan((x) => ({ ...x, from: v, id: null }))} />
          <span className="frp-range__dash" aria-hidden="true">–</span>
          <DateField label="To" value={span.to} min={span.from} max={today} onChange={(v) => setSpan((x) => ({ ...x, to: v, id: null }))} />
        </div>
        <label data-tour="logbook-kmpl" className="frp-when urv-kmpl" title="km per litre for the fuel estimate. Empty uses the vehicle's own rate.">
          <span className="frp-when__l">km/L</span>
          <input type="number" min="1" max="99" step="0.5" inputMode="decimal" value={kmplText}
                 placeholder={review?.vehicle.kmpl != null ? String(review.vehicle.kmpl) : "—"}
                 onChange={(e) => setKmplText(e.target.value)} aria-label="Kilometres per litre" />
        </label>
        <button data-tour="page-run" type="button" className="sp4-submit-btn frp-run" onClick={build}
                disabled={!canRun || st?.status === "running"}
                title={!unit ? "Choose a unit first" : tooLong ? `${MAX_DAYS} days at most` : backwards ? "The period ends before it starts" : "Build the review"}>
          {st?.status === "running" ? "Building…" : "Build"}
        </button>
      </div>

      <div className="sp4-body urv-body">
        {!review && (
          q.isError ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="The Review Could Not Be Built"
                       action={canRun ? { label: "Try again", onClick: build } : null}>
              {q.error?.message}
            </EmptyNote>
          ) : st?.status === "failed" ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="The Review Could Not Be Built"
                       action={canRun ? { label: "Try again", onClick: build } : null}>
              {st.error}
            </EmptyNote>
          ) : (st?.status === "running" || q.isFetching) && live ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title={`Building the Review for ${runUnit?.id ?? "the unit"}`}
                       progress={st?.progress?.total ? st.progress.done / st.progress.total : 0}>
              {STAGE_WORD[st?.stage] ?? "Starting"}
              {st?.stage === "loading" && st.progress.total ? ` — ${st.progress.done.toLocaleString("en-GB")} of ${st.progress.total.toLocaleString("en-GB")} messages` : ""}
              {st?.stage === "naming" && st.progress.total ? ` — ${st.progress.done} of ${st.progress.total}` : ""}
              .
            </EmptyNote>
          ) : tooLong ? (
            <EmptyNote icon="ti-calendar-off" tone="warn" title="That Period Is Too Long">
              One review covers up to {MAX_DAYS} days. Shorten the period, then Build.
            </EmptyNote>
          ) : (
            <EmptyNote icon="ti-car" title={unit ? `Ready for ${unit.id}` : "Logbook"}>
              {unit
                ? `Build to see how ${unit.id} was used from ${dayLabel(span.from)} to ${dayLabel(span.to)} (${nDays} days): drive hours, distance, fuel and where it spent its time.`
                : "Choose a unit and a period, then Build: drive hours a day, distance, fuel a day and where it spent its time, on a map, with the workbook and a PDF."}
            </EmptyNote>
          )
        )}

        {review && (
          <>
            <div data-tour="logbook-bar" className="urv-bar">
              <span className="urv-bar__what">
                <b>{review.vehicle.plate}</b>
                {review.vehicle.wialonName && review.vehicle.wialonName !== review.vehicle.plate ? ` · ${review.vehicle.wialonName}` : ""}
                {" · "}{dayLabel(review.period.from)} {review.period.from.slice(0, 4)} – {dayLabel(review.period.to)} {review.period.to.slice(0, 4)}
                {" · "}{review.period.days} days
                {/* A saved review of a period still running, built a while ago */}
                {st?.outdated && review.builtAt && (
                  <span className="urv-bar__old" title="Saved earlier. The refresh button reads the history again.">
                    {" · "}saved {fmtBuilt(review.builtAt)}, refresh for the latest
                  </span>
                )}
              </span>
              {(sel.day || sel.place != null) && (
                <span className="urv-chips">
                  {sel.day && <button type="button" className="urv-chip" onClick={() => setSel((x) => ({ ...x, day: null }))}>{dayLabel(sel.day, true)} <i className="ti ti-x" aria-hidden="true" /></button>}
                  {sel.place != null && <button type="button" className="urv-chip urv-chip--place" onClick={() => setSel((x) => ({ ...x, place: null }))}>{sel.place}. {pname(sel.place)} <i className="ti ti-x" aria-hidden="true" /></button>}
                </span>
              )}
              <span data-tour="logbook-downloads" className="urv-bar__acts">
                {dlError && <span className="frp-warn">{dlError}</span>}
                <button type="button" className="sp4-ghost-btn" onClick={() => download("xlsx")} disabled={busy != null}
                        title="Every row behind the review — daily, places, stops, trips, hourly, GPS points — ready for Power BI">
                  <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {busy === "xlsx" ? "Preparing…" : "Excel"}
                </button>
                <button type="button" className="sp4-ghost-btn" onClick={() => download("pdf")} disabled={busy != null}
                        title="Vehicle tracking report: Executive Summary and key findings, where the vehicle spent its time, Daily Distance, Driving Patterns, Most Frequent Routes, Top Sites at a Glance, Overnight Locations, and the Route Map and Key Locations">
                  <i className="ti ti-file-type-pdf" aria-hidden="true" /> {busy === "pdf" ? "Preparing…" : "PDF"}
                </button>
                <button type="button" className="sp4-ghost-btn" onClick={build} title="Read the history again and rebuild">
                  <i className="ti ti-refresh" aria-hidden="true" />
                </button>
              </span>
            </div>

            {review.incompleteDays.length > 0 && (
              <div className="urv-note urv-note--warn">
                Wialon could not be reached, so this review was read from the FleetTrack database.{" "}
                {review.incompleteDays.length} day(s) have gaps there and may read low: {review.incompleteDays.map((d) => dayLabel(d)).join(", ")}.
              </div>
            )}

            <div className="urv-grid urv-grid--top">
              <ReviewMap review={review} sel={sel} setSel={setSel} placeDays={placeDays} pal={pal} gnames={gnames}
                         mode={mapMode} setMode={setMapMode} web={web} webEdge={webEdge} setWebEdge={setWebEdge} />

              <section data-tour="logbook-days" className="frv-card urv-card urv-card--top">
                <h3 className="frv-card__t">Distance per Day</h3>
                <DailyChart days={review.days} sel={sel} setSel={setSel} placeDays={placeDays} pal={pal} />
                <p className="frv-card__note">Bars are km, dots are hours driving. Click a day to follow it on the map.</p>
              </section>
            </div>

            <div className="urv-grid urv-grid--lower">
              <section data-tour="logbook-places" className="frv-card urv-card urv-card--table">
                <h3 className="frv-card__t">Where It Spent Its Time</h3>
                <p className="urv-card__sub">{s.places} places · {nf(s.stoppedH, 0)} h stopped in stops of 10 min or more · click a place</p>
                {byActivity.length > 0 && (
                  <p className="urv-card__sub urv-acts" title="What the places are, from Google Maps: hours stopped and stops at each kind">
                    {byActivity.map((a) => <span key={a.activity}><b>{a.activity}</b> {nf(a.hours, 1)} h · {plural(a.stops, "stop")}</span>)}
                  </p>
                )}
                <div className="sp4-table-scroll urv-table">
                  <table className="sp4-table">
                    <thead><tr><th>#</th><th>Exact location</th><th>Activity</th><th>Area</th><th>County</th><th className="urv-num">Hours</th><th className="urv-num">Stops</th><th className="urv-num">Days</th><th>Coordinates</th></tr></thead>
                    <tbody>
                      {placePager.pageRows.map((p) => (
                        <tr key={p.id} className={`urv-row${sel.place === p.id ? " urv-row--on" : ""}`}
                            onClick={() => setSel((x) => ({ ...x, place: x.place === p.id ? null : p.id }))}>
                          <td>{p.id}</td>
                          <td className="urv-exact"
                              title={p.nameFrom === "site-plan" ? `Inside the ${p.site} site plan` : p.nameFrom === "geofence" ? `Inside the ${p.site} geofence` : undefined}>
                            {gnames.get(p.id) ?? p.exactName ?? <span className="frp-kpi-none" title="No named business on Google Maps or OpenStreetMap at this spot">—</span>}</td>
                          <td title={gacts.get(p.id)?.kind ?? undefined}>{gacts.get(p.id)?.activity ?? (gnames.has(p.id) ? null : p.activity) ?? <span className="frp-kpi-none" title="Nothing on Google Maps or OpenStreetMap says what this place is">—</span>}</td>
                          <td title={p.address ?? undefined}>{placeCase(p.name) ?? `Place ${p.id}`}</td>
                          <td>{p.county ?? ""}</td>
                          <td className="urv-num">
                            <span className="urv-hbar" style={{ "--w": `${Math.min(100, (p.hours / review.places[0].hours) * 100)}%` }} />
                            {nf(p.hours, 1)}
                          </td>
                          <td className="urv-num">{p.visits}</td>
                          <td className="urv-num">{p.days}</td>
                          <td className="urv-mono">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager pager={placePager} label="Places pages" />
              </section>

              <section data-tour="logbook-hours" className="frv-card urv-card urv-card--fixed">
                <h3 className="frv-card__t">Driving by Hour</h3>
                <HourChart days={review.days} hourly={review.hourly} sel={sel} placeDays={placeDays} pal={pal}
                           placeName={(id) => nameOf(review.places.find((p) => p.id === id), gnames) ?? `Place ${id}`} />
                <p className="frv-card__note">
                  {sel.day ? `Driving in each hour on ${dayLabel(sel.day, true)}, against the whole period's average.`
                    : sel.place != null ? "Driving in each hour, averaged over the days it stopped at the picked place, against the whole period's average."
                    : "Average minutes driving in each hour of the day (EAT) over the period."}
                </p>
              </section>
            </div>

            {playDay && live && (
              <LogbookPlayback
                date={playDay} review={review} req={live} vehicle={runUnit} pal={pal} gnames={gnames}
                unitLabel={review.vehicle.plate}
                host={rootRef.current?.closest(".app-root") ?? rootRef.current?.closest(".app-container") ?? undefined}
                onClose={() => setPlayDay(null)}
              />
            )}

            <div className="urv-grid urv-grid--detail">
              <section data-tour="logbook-detail" className="frv-card urv-card urv-card--detail">
                <div className="urv-detail__head">
                  <div>
                    <h3 className="frv-card__t">{selDay ? dayLabel(selDay.date, true) : selPlace ? `${selPlace.id}. ${nameOf(selPlace, gnames) ?? "Place"}` : "Day and Place Detail"}</h3>
                    <p className="urv-card__sub">
                      {selDay && <span>{nf(selDay.km, 1)} km · {hm(selDay.driveH)} driving{selDay.engineH != null ? ` · ${hm(selDay.engineH)} engine` : ""}{kmpl ? ` · ~${nf(selDay.km / kmpl, 1)} L` : ""}{selPlace ? ` · stops at ${selPlace.id}. ${nameOf(selPlace, gnames)}` : ""}</span>}
                      {!selDay && selPlace && <span>{nf(selPlace.hours, 1)} h · {selPlace.visits} stops · {selPlace.days} days{selPlace.name && hasExact(selPlace, gnames) ? ` · ${placeCase(selPlace.name)}` : ""}</span>}
                      {!selDay && !selPlace && <span>Nothing picked yet</span>}
                    </p>
                  </div>
                  {selDay && (
                    <button type="button" className="urv-playbtn" onClick={() => setPlayDay(selDay.date)} title="Play this day on the map">
                      <i className="ti ti-player-play-filled" aria-hidden="true" /> Play day
                    </button>
                  )}
                  {(selDay || selPlace) && (
                    <div className="urv-seg" role="group" aria-label="Show">
                      {[["all", "All", detailAll.length], ["stop", "Stops", detailStops.length], ["trip", "Drives", detailTrips.length]]
                        .filter(([k, , n]) => k === "all" || n > 0 || (k === "trip" && selDay))
                        .map(([k, label, n]) => (
                          <button key={k} type="button" className={detailKind === k ? "is-on" : ""} aria-pressed={detailKind === k}
                                  onClick={() => setDetailKind(k)}>
                            {label} <span className="urv-seg__n">{n}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {!selDay && !selPlace ? (
                  <div className="urv-hint">Pick a day on the distance chart or the map, or a place in the list or on the map, to see its drives and stops here.</div>
                ) : detailRows.length === 0 ? (
                  <div className="urv-hint">Nothing to show for this pick.</div>
                ) : (
                  <div className="sp4-table-scroll urv-table">
                    <table className="sp4-table urv-detail">
                      <thead><tr>
                        <th className="urv-tl" aria-label="Sequence" />
                        <th>Time</th><th>What</th>
                        {selDay ? <th className="urv-wide">Where</th> : <><th className="urv-wide">Came from</th><th className="urv-wide">Went to</th></>}
                        {showKm && <th className="urv-num">km</th>}
                        <th className="urv-num">Duration</th>
                        {selDay && <th aria-label="Open" />}
                      </tr></thead>
                      <tbody>
                        {(() => {
                          // A ledger, read top to bottom: a rail down the left
                          // joins one entry to the next (a drive is the road,
                          // a stop the sign on it), and in a place's list the
                          // entries sit under the day they happened, each day
                          // with its own figures and its own Play.
                          const cols = (selDay ? 6 : 6) + (showKm ? 1 : 0);
                          const page = detailPager.pageRows;
                          const longest = Math.max(1, ...page.map((r) => r.x.min));
                          const out = [];
                          page.forEach(({ kind, x }, k) => {
                            const day = dayKeyOf(x.start);
                            const newDay = !selDay && (k === 0 || dayKeyOf(page[k - 1].x.start) !== day);
                            const endsDay = selDay ? k === page.length - 1 : k === page.length - 1 || dayKeyOf(page[k + 1].x.start) !== day;
                            if (newDay) {
                              const d = dayIndex.get(day);
                              out.push(
                                <tr key={`d${day}`} className="urv-dayrow">
                                  <td colSpan={cols}>
                                    <div className="urv-dayrow__in">
                                      <b>{dayLabel(day, true)}</b>
                                      {d && <span>{nf(d.km, 1)} km · {hm(d.driveH)} driving{d.firstMove ? ` · ${clock.format(d.firstMove)}–${clock.format(d.lastMove)}` : ""}</span>}
                                      <button type="button" className="urv-dayplay" onClick={() => setPlayDay(day)} title={`Play ${dayLabel(day, true)} on the map`}>
                                        <i className="ti ti-player-play-filled" aria-hidden="true" /> Play
                                      </button>
                                    </div>
                                  </td>
                                </tr>,
                              );
                            }
                            // In a day's list a stop opens its place; in a
                            // place's list a row plays the day it happened.
                            const go = !selDay
                              ? { label: "Play this day", run: () => setPlayDay(day) }
                              : kind === "stop" && x.place != null
                                ? { label: sel.place === x.place ? "Show the whole day" : "This place only", run: () => setSel((v) => ({ ...v, place: v.place === x.place ? null : x.place })) }
                                : null;
                            const placeLink = (id) => (
                              <button type="button" className="urv-link" title="Pick this place"
                                      onClick={(e) => { e.stopPropagation(); setSel((v) => ({ day: v.day, place: v.place === id ? null : id })); }}>
                                {id}. {pname(id)}
                              </button>
                            );
                            const tone = kind === "trip" ? "drive" : x.overnight ? "night" : "stop";
                            const l = !selDay && kind === "stop" ? legs(x) : null;
                            out.push(
                              <tr key={`${kind}${x.id}`} className={`urv-row urv-row--${tone}`} onClick={go?.run} title={go?.label}>
                                <td className={`urv-tl urv-tl--${tone}${newDay || (selDay && k === 0) ? " is-first" : ""}${endsDay ? " is-last" : ""}`}>
                                  <span className="urv-tl__node">
                                    {tone === "stop" ? <StopSign size={14} /> : <i className={`ti ${tone === "drive" ? "ti-road" : "ti-moon"}`} aria-hidden="true" />}
                                  </span>
                                </td>
                                <td className="urv-when"><b>{clock.format(x.start)}</b><span>{clock.format(x.end)}</span></td>
                                <td className={`urv-what urv-what--${tone}`}>{tone === "drive" ? "Drive" : tone === "night" ? "Overnight" : "Stop"}</td>
                                {!selDay && (
                                  <>
                                    <td className="urv-where">{l?.from != null ? placeLink(l.from) : kind === "trip" ? placeLink(x.fromPlace) : <span className="urv-none">—</span>}</td>
                                    <td className="urv-where">{l?.to != null ? placeLink(l.to) : kind === "trip" ? placeLink(x.toPlace) : <span className="urv-none">—</span>}</td>
                                  </>
                                )}
                                {selDay && (
                                  <td className="urv-where">
                                    {kind === "trip"
                                      ? <>{placeLink(x.fromPlace)} <span className="urv-arrow">→</span> {placeLink(x.toPlace)}</>
                                      : x.place != null ? placeLink(x.place) : <span className="urv-none">—</span>}
                                  </td>
                                )}
                                {showKm && <td className="urv-num">{kind === "trip" ? nf(x.km, 1) : ""}</td>}
                                <td className="urv-num urv-dur">
                                  <span className={`urv-dur__bar urv-dur__bar--${tone}`} style={{ "--w": `${Math.max(4, Math.round((x.min / longest) * 100))}%` }} aria-hidden="true" />
                                  {minutes(x.min)}
                                </td>
                                {selDay && <td className="urv-go">{go && <i className="ti ti-chevron-right" aria-hidden="true" />}</td>}
                              </tr>,
                            );
                          });
                          return out;
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
                {(selDay || selPlace) && <TablePager pager={detailPager} label="Detail pages" />}
              </section>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
