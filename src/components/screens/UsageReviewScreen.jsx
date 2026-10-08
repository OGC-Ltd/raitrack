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
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { loadMapEngine, maps as mapsNs } from "../../lib/mapEngine";
import { installOsmBase, OSM_TYPE_ID, OSM_ATTRIBUTION } from "../../lib/osmBase";
import { installGoogleBase, GOOGLE_TYPE_ID, GOOGLE_BASE_AVAILABLE, GOOGLE_ATTRIBUTION } from "../../lib/googleBase";
import MapStatusBar from "../body/MapStatusBar";
import EmptyNote from "../shared/EmptyNote";
import UnitPicker from "../body/UnitPicker";
import TablePager, { usePager } from "../body/TablePager";
import { getUsageReview, downloadUsageReview } from "../../api/usageReview";
import { googlePlaceNames } from "../../lib/googlePlaceNames";
import { watchTableLabels } from "../../lib/tableLabels";

const TZ = "Africa/Nairobi";
const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
const UNIT_KEY = "ft-usage-review-unit:";

const nf = (n, d = 1) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const stamp = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
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
/**
 * A place name in Title Case: OpenStreetMap spells many in lower case ("riat
 * centre, Kanyikela"). Only the name is touched — a trailing "(north-west,
 * 0.9 km)" stays as written — and only first letters are raised, so "KDW" or
 * "C103" are left alone.
 */
export const placeCase = (name) => {
  if (!name) return name;
  const cut = name.indexOf(" (");
  const head = cut >= 0 ? name.slice(0, cut) : name;
  const tail = cut >= 0 ? name.slice(cut) : "";
  return head.replace(/(^|[\s,/–-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toUpperCase()) + tail;
};
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

/** The base map picked here and on the live map's Maps panel (one choice). */
const BASE_MAP_KEY = "ft-map-base";
const readBase = () => {
  try { return GOOGLE_BASE_AVAILABLE && localStorage.getItem(BASE_MAP_KEY) === "google" ? "google" : "osm"; } catch { return "osm"; }
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The places' names, drawn beside their circles (operator, 2026-10-08). One
 * layer for all of them so the names can give way to each other: a name that
 * would overlap one already placed is left out, the picked place first and
 * then by rank (most hours), so zooming in brings the hidden ones back.
 */
/**
 * A place's name as the map label shows it: the exact name's first part, in
 * full ("Bukembe East, Kanduyi (NE, 1.2 km)" → "Bukembe East"). The ward and
 * the direction that tells two same-named places apart stay in the hover card
 * and the table; on the map the number beside it already does that.
 */
/** A place's name: Google's exact name when it has one, else OpenStreetMap's. */
const nameOf = (p, gnames) => (p ? gnames?.get(p.id) ?? placeCase(p.name) : null);
/** The map label: Google's name as it is, OpenStreetMap's shortened. */
const labelOf = (p, gnames) => gnames?.get(p.id) ?? shortPlace(placeCase(p.name));

const shortPlace = (name) => {
  if (!name) return name;
  const cut = name.indexOf(" (");
  return (cut >= 0 ? name.slice(0, cut) : name).split(",")[0].trim();
};

class PlaceNames extends mapsNs.OverlayView {
  constructor() { super(); this.items = []; this.div = null; }
  /** items: { id, lat, lng, text, gap (px from the centre), dim, strong } */
  set(items) { this.items = items; this.render(); }
  onAdd() {
    this.div = document.createElement("div");
    this.div.className = "urv-names";
    this.getPanes().overlayLayer.appendChild(this.div);
    this.render();
  }
  onRemove() { this.div?.remove(); this.div = null; }
  render() {
    if (!this.div) return;
    this.div.replaceChildren();
    this.spans = this.items.map((it) => {
      const sp = document.createElement("span");
      sp.className = `urv-name${it.dim ? " is-dim" : ""}${it.strong ? " is-on" : ""}`;
      sp.textContent = it.text;
      this.div.appendChild(sp);
      return { it, sp, w: sp.offsetWidth, h: sp.offsetHeight };
    });
    this.draw();
  }
  draw() {
    const proj = this.getProjection();
    if (!this.div || !proj || !this.spans) return;
    const at = new Map(this.spans.map((s) => [s, proj.fromLatLngToDivPixel({ lat: s.it.lat, lng: s.it.lng })]));
    // The circles are in the way too: a name never covers another place.
    const circles = this.spans.map((s) => {
      const p = at.get(s), r = s.it.gap - 5;
      return { s, x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
    });
    const hits = (box, own) => (k) => k.s !== own && box.x < k.x + k.w + 2 && k.x < box.x + box.w + 2 && box.y < k.y + k.h && k.y < box.y + box.h;
    const kept = [];
    const order = [...this.spans].sort((a, b) => (b.it.strong - a.it.strong) || (a.it.id - b.it.id));
    for (const s of order) {
      const p = at.get(s);
      const y = p.y - s.h / 2;
      // Right of the circle, else left of it, else left out.
      const box = [{ x: p.x + s.it.gap, y, w: s.w, h: s.h }, { x: p.x - s.it.gap - s.w, y, w: s.w, h: s.h }]
        .find((bx) => !kept.some(hits(bx, s)) && !circles.some(hits(bx, s)));
      s.sp.style.display = box ? "" : "none";
      if (!box) continue;
      s.sp.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      kept.push({ ...box, s });
    }
  }
}

function ReviewMap({ review, sel, setSel, placeDays, pal, gnames }) {
  const el = useRef(null);
  const wrap = useRef(null);
  const map = useRef(null);
  const tracks = useRef([]);
  const placeMarks = useRef([]);
  const stopMarks = useRef([]);
  const names = useRef(null);
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
  }, [ready, review, setSel, fitTo, at, pal]);

  // Selection: restyle, show the day's stops, and frame what was picked.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const daysOfPlace = sel.place != null ? placeDays.get(sel.place) ?? new Set() : null;
    const on = (date) => (sel.day ? date === sel.day : daysOfPlace ? daysOfPlace.has(date) : true);
    const focused = sel.day != null || daysOfPlace != null;
    for (const t of tracks.current) {
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
          icon: { path: mapsNs.SymbolPath.CIRCLE, scale: 4.5, fillColor: "#111827", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 1.5 },
        });
        mk.addListener("mouseover", (ev) => setHover({ kind: "stop", stop: s, pos: at(ev) }));
        mk.addListener("mouseout", () => setHover((h) => (h?.kind === "stop" ? null : h)));
        mk.addListener("click", () => { if (s.place != null) setSel((x) => ({ ...x, place: x.place === s.place ? null : s.place })); });
        return mk;
      });
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
  }, [ready, sel, setSel, review, placeDays, fitTo, at, pal]);

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
          {gnames?.has(p.id) && p.name && <span>{placeCase(p.name)}</span>}
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
    <div className="urv-map" ref={wrap}>
      <div ref={el} className="urv-map__canvas" />
      <MapStatusBar map={mapObj} attribution={base === "google" ? GOOGLE_ATTRIBUTION : OSM_ATTRIBUTION} className="map-status--panel" />
      <div className="urv-map__top">
        <div className="urv-map__legend" aria-hidden="true">
          <span><i style={{ background: pal.route }} className="urv-line" />Route</span>
          <span><i style={{ background: pal.base }} />Base (most time)</span>
          <span><i style={{ background: pal.place }} />Other places · size = hours</span>
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
      <b>{dayLabel(d.date, true)}</b>
      <span>{nf(d.km, 1)} km · {hm(d.driveH)} driving</span>
      {d.engineH != null && <span>{hm(d.engineH)} engine on</span>}
      {d.firstMove && <span>{clock.format(d.firstMove)} – {clock.format(d.lastMove)}</span>}
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

function HourTip({ active, payload, focusLabel }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="frp-tip">
      <b>{hh(d.hour)}–{hh((d.hour + 1) % 24)}</b>
      {focusLabel && <span>{focusLabel}: {nf(d.focus, 0)} min driving</span>}
      <span>Period average: {nf(d.avg, 1)} min</span>
    </div>
  );
}

/**
 * When in the day it drives: 24 bars, the average minutes of driving in each
 * hour over the period. With a day picked, the bars are that day and the
 * average stays behind them, faint; with a place picked, the average over the
 * days it was there.
 */
function HourChart({ days, hourly, sel, placeDays, pal }) {
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
  const focusLabel = sel.day ? dayLabel(sel.day, true) : sel.place != null ? "Days at this place" : null;
  return (
    <div className="urv-chart urv-chart--hours">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barGap={-10}>
          <CartesianGrid stroke="var(--sp4-line, #e2e8f0)" vertical={false} />
          <XAxis dataKey="hour" tickFormatter={(h) => String(h).padStart(2, "0")} tick={AXIS_TICK} tickLine={false} axisLine={false} interval={2} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} unit="m" />
          <Tooltip content={<HourTip focusLabel={focusLabel} />} cursor={{ fill: "var(--sp4-raised)" }} isAnimationActive={false} />
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
    setUnitIdState(id);
    try { if (orgId) localStorage.setItem(UNIT_KEY + orgId, id ?? ""); } catch { /* per-viewer nicety only */ }
  };
  const unit = useMemo(() => vehicles.find((v) => v.vehicleId === unitId) ?? null, [vehicles, unitId]);
  const [span, setSpan] = useState(() => preset("last"));
  const [kmplText, setKmplText] = useState("");
  const [request, setRequest] = useState(null);
  const [sel, setSel] = useState({ day: null, place: null });
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
  const st = q.data;
  const review = st?.status === "ready" ? st.review : null;
  const runUnit = useMemo(() => (live ? vehicles.find((v) => v.vehicleId === live.vehicleId) : null), [live, vehicles]);

  useEffect(() => { setSel({ day: null, place: null }); }, [review]);
  // Google's exact names for the places on the map, filled in as they arrive;
  // the OpenStreetMap name stands until then, and wherever Google has none.
  const [gnames, setGnames] = useState(() => new Map());
  useEffect(() => {
    setGnames(new Map());
    if (!review) return undefined;
    const ac = new AbortController();
    googlePlaceNames(review.places.slice(0, MAX_PLACES_ON_MAP),
      (id, g) => setGnames((m) => new Map(m).set(id, g.name)), { signal: ac.signal });
    return () => ac.abort();
  }, [review]);
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

  const build = () => {
    if (!canRun) return;
    const next = { orgId, vehicleId: unit.vehicleId, from: span.from, to: span.to };
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
      await downloadUsageReview({
        orgId: live.orgId, vehicleId: live.vehicleId, from: live.from, to: live.to, kind,
        kmpl: kmplText && kmplIn > 0 ? kmplIn : undefined,
        fallbackName: `${review.vehicle.plate.replace(/\s+/g, "")}_${live.from}_${live.to}_highlights.${kind}`,
      });
    } catch (e) { setDlError(e.message || "Download failed"); }
    finally { setBusy(null); }
  };

  const selDay = sel.day ? review?.days.find((d) => d.date === sel.day) : null;
  const selPlace = sel.place != null ? review?.places.find((p) => p.id === sel.place) : null;
  const detailStops = useMemo(() => (review?.stops ?? []).filter((x) =>
    (!sel.day || dayKeyOf(x.start) === sel.day) && (sel.place == null || x.place === sel.place)), [review, sel]);
  const detailTrips = useMemo(() => (sel.day ? (review?.trips ?? []).filter((t) => dayKeyOf(t.start) === sel.day) : []), [review, sel.day]);
  const detailRows = useMemo(() => [
    ...detailStops.map((x) => ({ t: x.start, kind: "stop", x })),
    ...detailTrips.map((x) => ({ t: x.start, kind: "trip", x })),
  ].sort((a, b) => a.t - b.t), [detailStops, detailTrips]);
  const placePager = usePager(review?.places ?? [], review, PAGE_ROWS);
  const detailPager = usePager(detailRows, `${sel.day}|${sel.place}`, PAGE_ROWS);
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
        <div className="sp4-header-kpis">
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
        <div className="frp-range">
          <DateField label="From" value={span.from} max={span.to || today} onChange={(v) => setSpan((x) => ({ ...x, from: v, id: null }))} />
          <span className="frp-range__dash" aria-hidden="true">–</span>
          <DateField label="To" value={span.to} min={span.from} max={today} onChange={(v) => setSpan((x) => ({ ...x, to: v, id: null }))} />
        </div>
        <label className="frp-when urv-kmpl" title="km per litre for the fuel estimate. Empty uses the vehicle's own rate.">
          <span className="frp-when__l">km/L</span>
          <input type="number" min="1" max="99" step="0.5" inputMode="decimal" value={kmplText}
                 placeholder={review?.vehicle.kmpl != null ? String(review.vehicle.kmpl) : "—"}
                 onChange={(e) => setKmplText(e.target.value)} aria-label="Kilometres per litre" />
        </label>
        <button type="button" className="sp4-submit-btn frp-run" onClick={build}
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
            <div className="urv-bar">
              <span className="urv-bar__what">
                <b>{review.vehicle.plate}</b>
                {review.vehicle.wialonName && review.vehicle.wialonName !== review.vehicle.plate ? ` · ${review.vehicle.wialonName}` : ""}
                {" · "}{dayLabel(review.period.from)} {review.period.from.slice(0, 4)} – {dayLabel(review.period.to)} {review.period.to.slice(0, 4)}
                {" · "}{review.period.days} days
              </span>
              {(sel.day || sel.place != null) && (
                <span className="urv-chips">
                  {sel.day && <button type="button" className="urv-chip" onClick={() => setSel((x) => ({ ...x, day: null }))}>{dayLabel(sel.day, true)} <i className="ti ti-x" aria-hidden="true" /></button>}
                  {sel.place != null && <button type="button" className="urv-chip urv-chip--place" onClick={() => setSel((x) => ({ ...x, place: null }))}>{sel.place}. {pname(sel.place)} <i className="ti ti-x" aria-hidden="true" /></button>}
                </span>
              )}
              <span className="urv-bar__acts">
                {dlError && <span className="frp-warn">{dlError}</span>}
                <button type="button" className="sp4-ghost-btn" onClick={() => download("xlsx")} disabled={busy != null}
                        title="Every row behind the review — daily, places, stops, trips, hourly, GPS points — ready for Power BI">
                  <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {busy === "xlsx" ? "Preparing…" : "Excel"}
                </button>
                <button type="button" className="sp4-ghost-btn" onClick={() => download("pdf")} disabled={busy != null}
                        title="Two pages: the figures, the map and the charts">
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
              <ReviewMap review={review} sel={sel} setSel={setSel} placeDays={placeDays} pal={pal} gnames={gnames} />

              <section className="frv-card urv-card urv-card--top">
                <h3 className="frv-card__t">Distance per day</h3>
                <DailyChart days={review.days} sel={sel} setSel={setSel} placeDays={placeDays} pal={pal} />
                <p className="frv-card__note">Bars are km, dots are hours driving. Click a day to follow it on the map.</p>
              </section>
            </div>

            <div className="urv-grid urv-grid--lower">
              <section className="frv-card urv-card urv-card--table">
                <h3 className="frv-card__t">Where it spent its time</h3>
                <p className="urv-card__sub">{s.places} places · {nf(s.stoppedH, 0)} h stopped in stops of 10 min or more · click a place</p>
                <div className="sp4-table-scroll urv-table">
                  <table className="sp4-table">
                    <thead><tr><th>#</th><th>Exact location</th><th>Area</th><th>County</th><th className="urv-num">Hours</th><th className="urv-num">Stops</th><th className="urv-num">Days</th><th>Coordinates</th></tr></thead>
                    <tbody>
                      {placePager.pageRows.map((p) => (
                        <tr key={p.id} className={`urv-row${sel.place === p.id ? " urv-row--on" : ""}`}
                            onClick={() => setSel((x) => ({ ...x, place: x.place === p.id ? null : p.id }))}>
                          <td>{p.id}</td>
                          <td className="urv-exact">{gnames.get(p.id) ?? <span className="frp-kpi-none" title="Google has no named place within 150 m">—</span>}</td>
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

              <section className="frv-card urv-card urv-card--fixed">
                <h3 className="frv-card__t">When it drives</h3>
                <HourChart days={review.days} hourly={review.hourly} sel={sel} placeDays={placeDays} pal={pal} />
                <p className="frv-card__note">
                  {sel.day ? `Minutes driving in each hour on ${dayLabel(sel.day, true)}, over the period's average.`
                    : sel.place != null ? "Minutes driving in each hour on the days it was at this place, over the period's average."
                    : "Average minutes driving in each hour of the day (EAT) over the period."}
                </p>
              </section>
            </div>

            <div className="urv-grid urv-grid--detail">
              <section className="frv-card urv-card urv-card--table">
                <h3 className="frv-card__t">{selDay ? dayLabel(selDay.date, true) : selPlace ? `${selPlace.id}. ${nameOf(selPlace, gnames) ?? "Place"}` : "Day and place detail"}</h3>
                <p className="urv-card__sub">
                  {selDay && <span>{nf(selDay.km, 1)} km · {hm(selDay.driveH)} driving{selDay.engineH != null ? ` · ${hm(selDay.engineH)} engine` : ""}{kmpl ? ` · ~${nf(selDay.km / kmpl, 1)} L` : ""}</span>}
                  {!selDay && selPlace && <span>{nf(selPlace.hours, 1)} h · {selPlace.visits} stops · {selPlace.days} days</span>}
                  {!selDay && !selPlace && <span>Nothing picked yet</span>}
                </p>
                {!selDay && !selPlace ? (
                  <div className="urv-hint">Pick a day on the distance chart or the map, or a place in the list or on the map, to see its drives and stops here.</div>
                ) : (
                  <div className="sp4-table-scroll urv-table">
                    <table className="sp4-table">
                      <thead><tr><th>{selDay ? "Time" : "Date"}</th><th>What</th><th>Where</th><th className="urv-num">km</th><th className="urv-num">Duration</th></tr></thead>
                      <tbody>
                        {detailPager.pageRows.map(({ kind, x }) => (
                          <tr key={`${kind}${x.id}`} className={kind === "trip" ? "urv-trip" : ""}>
                            <td className="urv-mono">{selDay ? `${clock.format(x.start)}–${clock.format(x.end)}` : stamp.format(x.start)}</td>
                            <td>{kind === "trip" ? "Drive" : x.overnight ? "Stop (overnight)" : "Stop"}</td>
                            <td>{kind === "trip" ? `${pname(x.fromPlace)} → ${pname(x.toPlace)}` : pname(x.place)}</td>
                            <td className="urv-num">{kind === "trip" ? nf(x.km, 1) : ""}</td>
                            <td className="urv-num">{minutes(x.min)}</td>
                          </tr>
                        ))}
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
