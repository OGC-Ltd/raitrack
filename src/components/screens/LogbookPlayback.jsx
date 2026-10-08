/**
 * Logbook › day playback (operator, 2026-10-08).
 *
 * The live map's replay, in a dialog: the same day of fixes and events
 * (useVehiclePlayback → /vehicles/:id/playback), the same clock
 * (useRoutePlayback), the same transport (RoutePlayback) and the same drawing
 * — the unit's own 3D sprite turning along its heading, the trail drawn as it
 * travels, event pins, direction ticks and minute dots revealed as the cursor
 * reaches them (FleetMap's exported pieces). Nothing here re-invents a
 * playback; it only lays one out as two columns: the map and its transport on
 * the left, the day's figures and its events on the right.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadMapEngine } from "../../lib/mapEngine";
import { installOsmBase, OSM_TYPE_ID, OSM_ATTRIBUTION } from "../../lib/osmBase";
import { installGoogleBase, GOOGLE_TYPE_ID, GOOGLE_BASE_AVAILABLE, GOOGLE_ATTRIBUTION } from "../../lib/googleBase";
import { useVehiclePlayback } from "../../hooks/useVehiclePlayback";
import { useRoutePlayback } from "../../hooks/useRoutePlayback";
import { travelledTo, gapsOf, sampleAt, syncReveal, minuteMarks } from "../../lib/playbackPath";
import { markerState, spriteKind } from "../../lib/vehicleMap";
import {
  markerIconHtml, makeDomMarkerClass, eventMarkerHtml, playbackTickHtml, minuteMarker,
  truckFrame, DRAWN_EVENT_KINDS, metresBetween,
} from "../body/FleetMap";
import RoutePlayback from "../body/RoutePlayback";
import MapStatusBar from "../body/MapStatusBar";
import StopSign from "./StopSign";
import { labelOf, PlaceNames } from "./logbookPlaces";
import "./LogbookPlayback.css";

const TZ = "Africa/Nairobi";
const HHMM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const HHMMSS = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });
const nf = (n, d = 1) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }));
const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const BASE_MAP_KEY = "ft-map-base";

/* One glyph per event kind, so the list reads at a glance without colour. */
/* Not pinned on this map: fuel (operator, 2026-10-08) and stops, which the
   Logbook's stop areas show instead. They stay in the events list. */
const PINLESS = new Set(["theft", "refill", "stop"]);
const dayKeyOf = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

const KIND_ICON = {
  speeding: "ti-gauge", refill: "ti-gas-station", theft: "ti-droplet-down", fault: "ti-plug-x",
  zone: "ti-map-pin", dispatch: "ti-truck-delivery",
};

/* The live map's own replay geometry (FleetMap, "WHEN the unit was at a point"). */
const TICK_MAX = 28;
const TICK_MIN_M = 60;
const TICK_Z = 3;
const TICK_OPEN_Z = 9;
/* Stop badges: over the trail's ticks (3), minute dots (2) and event pins (4);
   under the vehicle, which sits on top of whatever it stops at. */
const BADGE_Z = 5;

/**
 * @param {object} props
 * @param {string} props.date         the fleet day to open on
 * @param {object} props.review       the page's review (days, for the figures)
 * @param {{orgId:string, vehicleId:string}} props.req
 * @param {object} [props.vehicle]    the live vehicle, for its sprite and state
 * @param {string} props.unitLabel
 * @param {()=>void} props.onClose
 * @param {Element} [props.host]      where to mount (keeps the theme)
 * @param {object} props.pal          the Logbook map's colours (route, place, base)
 * @param {Map} [props.gnames]        Google's names for the places, by id
 */
export default function LogbookPlayback({ date, review, req, vehicle, unitLabel, onClose, host, pal, gnames }) {
  // One day, the one picked in the Logbook: no stepping to others from here.
  const day = date;
  const { data, points, events, loading, error } = useVehiclePlayback(req.orgId, req.vehicleId, day);
  const pb = useRoutePlayback(points);
  const pbSubscribe = pb.subscribe;
  const gapSpans = useMemo(() => gapsOf(points), [points]);

  // The places it stopped at on this day, as the Logbook numbers them.
  const dayPlaces = useMemo(() => {
    const ids = new Set(review.stops.filter((s) => dayKeyOf(s.start) === day && s.place != null).map((s) => s.place));
    return review.places.filter((p) => ids.has(p.id));
  }, [review, day]);

  // ── map ──
  const el = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const DomMarkerRef = useRef(null);
  const layerRef = useRef(null);
  const unitRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [mapObj, setMapObj] = useState(null);
  const [base, setBase] = useState(() => {
    try { return GOOGLE_BASE_AVAILABLE && localStorage.getItem(BASE_MAP_KEY) === "google" ? "google" : "osm"; } catch { return "osm"; }
  });

  useEffect(() => {
    let alive = true;
    loadMapEngine().then((maps) => {
      if (!alive || !el.current || mapRef.current) return;
      const m = new maps.Map(el.current, { center: { lat: 0.5, lng: 34.6 }, zoom: 9, zoomControl: true, scrollwheel: false });
      installOsmBase(maps, m);
      m.setMapTypeId(OSM_TYPE_ID);
      mapRef.current = m;
      mapsRef.current = maps;
      DomMarkerRef.current = makeDomMarkerClass(maps);
      setMapObj(m);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return undefined;
    let dead = false;
    if (base === "google") {
      installGoogleBase(m).then(() => { if (!dead) m.setMapTypeId(GOOGLE_TYPE_ID); }).catch(() => { if (!dead) setBase("osm"); });
    } else m.setMapTypeId(OSM_TYPE_ID);
    return () => { dead = true; };
  }, [base, ready]);
  const chooseBase = (id) => { try { localStorage.setItem(BASE_MAP_KEY, id); } catch { /* remembered choice only */ } setBase(id); };

  const sprite = spriteKind(vehicle ?? { id: unitLabel });
  const mstate = markerState(vehicle ?? {});

  /**
   * BUILD: everything the replay reveals, made once per day of points — the
   * live map's build effect, with this dialog's own unit marker in place of
   * the fleet marker it borrows there.
   */
  useEffect(() => {
    const map = mapRef.current, maps = mapsRef.current, DomMarker = DomMarkerRef.current;
    if (!ready || !map || !maps || !DomMarker || points.length === 0) return undefined;
    const layers = { trail: [], trailT: -Infinity, timed: [], openTick: null };
    layerRef.current = layers;

    const unit = new DomMarker({
      position: { lat: points[0].lat, lng: points[0].lng },
      html: markerIconHtml(mstate, { heading: points[0].hdg ?? 0, sprite, name: unitLabel }),
      anchor: "bottom",
      zIndex: 8,
    });
    unit.setMap(map);
    unit._headingFrame = truckFrame(points[0].hdg ?? 0);
    unitRef.current = unit;

    const lastT = points[points.length - 1]?.t ?? 0;
    for (const ev of events) {
      if (!DRAWN_EVENT_KINDS.has(ev.kind) || PINLESS.has(ev.kind)) continue;
      const at = sampleAt(points, ev.t);
      if (!at || at.inGap) continue;
      const m = new DomMarker({ position: { lat: at.lat, lng: at.lng }, html: eventMarkerHtml(ev, lastT), anchor: "center", zIndex: 4 });
      layers.timed.push({ marker: m, t: ev.t, shown: false });
    }

    let pathM = 0;
    for (let i = 1; i < points.length; i++) pathM += metresBetween(points[i - 1], points[i]);
    const tickGapM = Math.max(TICK_MIN_M, pathM / TICK_MAX);
    let sinceTick = 0;
    for (let i = 1; i < points.length; i++) {
      sinceTick += metresBetween(points[i - 1], points[i]);
      if (sinceTick < tickGapM) continue;
      sinceTick = 0;
      const pt = points[i];
      if (pt.gapBefore) continue;
      const deg = Number.isFinite(pt.hdg) ? pt.hdg : 0;
      const kmh = Number.isFinite(pt.spd) ? pt.spd : null;
      const m = new DomMarker({
        position: { lat: pt.lat, lng: pt.lng },
        html: playbackTickHtml(deg, pt.t, kmh, false),
        anchor: "center",
        zIndex: TICK_Z,
        onClick: () => {
          const prev = layers.openTick;
          if (prev) { prev.close(); layers.openTick = null; }
          if (prev?.marker === m) return;
          m.setHtml(playbackTickHtml(deg, pt.t, kmh, true));
          m.setZIndex(TICK_OPEN_Z);
          layers.openTick = { marker: m, close: () => { m.setHtml(playbackTickHtml(deg, pt.t, kmh, false)); m.setZIndex(TICK_Z); } };
        },
      });
      layers.timed.push({ marker: m, t: pt.t, shown: false, tick: true });
    }

    for (const mark of minuteMarks(points)) {
      const m = minuteMarker(DomMarker, { mark, plate: unitLabel, features: () => null, maps: () => mapsRef.current, state: layers, zIndex: 2 });
      layers.timed.push({ marker: m, t: mark.t, shown: false, minute: true });
    }

    const bounds = new maps.LatLngBounds();
    for (const p of points) bounds.extend({ lat: p.lat, lng: p.lng });
    for (const p of dayPlaces) bounds.extend({ lat: p.lat, lng: p.lng });
    map.fitBounds(bounds, 40);
    if (map.getZoom() > 16) map.setZoom(16);

    return () => {
      for (const l of layers.trail) l.setMap(null);
      for (const e of layers.timed) e.marker.setMap(null);
      unit.setMap(null);
      unitRef.current = null;
      layerRef.current = null;
    };
    // mstate/sprite/unitLabel dress the marker; a new day of points rebuilds it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, points, events]);

  /**
   * The day's stop areas, revealed by the replay (operator, 2026-10-08). A
   * place's badge is drawn once, at its first stop, with its name beside it.
   * The number on it counts the stops there; its SIZE is the time spent there
   * so far, growing while the unit stands, on the Logbook map's scale (7 → 16
   * px radius, against the day's longest-held place) — one long stop can
   * outgrow three short ones. The place with the most time so far wears the
   * base's green, the rest the place colour, as on the Logbook map.
   */
  useEffect(() => {
    const map = mapRef.current, DomMarker = DomMarkerRef.current;
    if (!ready || !map || !DomMarker || !dayPlaces.length) return undefined;
    const byId = new Map(dayPlaces.map((p) => [p.id, p]));
    const stops = review.stops
      .filter((s) => dayKeyOf(s.start) === day && byId.has(s.place))
      .sort((a, b) => a.start - b.start);
    const held = {};
    for (const s of stops) held[s.place] = (held[s.place] ?? 0) + (s.end - s.start);
    const top = Math.max(60_000, ...Object.values(held));
    const badges = new Map(); // place id → { marker, n, lead, d }
    const names = new PlaceNames({ pane: "overlayMouseTarget", zIndex: BADGE_Z - 1 });
    names.setMap(map);
    let shown = "";

    // The badge is a DOM marker on the same layer as the trail's ticks and
    // minute dots, stacked above all of them (operator: "the route path should
    // not bury the badge whatsoever") and below only the vehicle.
    const paint = (b, p, n, ms, lead, d) => {
      b.n = n; b.lead = lead; b.d = d;
      const mins = ms / 60_000;
      const tip = `${labelOf(p, gnames) || `Place ${p.id}`} · ${n} stop${n === 1 ? "" : "s"} · ${mins < 60 ? `${Math.round(mins)} min` : hm(mins / 60)}`.replace(/"/g, "&quot;");
      b.marker.setHtml(`<div class="lbp-badge${lead ? " is-lead" : ""}" title="${tip}" style="width:${d}px;height:${d}px;background:${lead ? pal.base : pal.place};font-size:${n > 9 ? 9 : 10}px">${n}</div>`);
      b.marker.setZIndex(lead ? BADGE_Z + 1 : BADGE_Z);
    };

    const unsub = pbSubscribe((t) => {
      // Stops the cursor has reached, per place: how many, and the time held
      // so far (a stop in progress counts up to the cursor).
      const sofar = new Map();
      for (const s of stops) {
        if (s.start > t) break;
        const v = sofar.get(s.place) ?? { n: 0, ms: 0 };
        v.n += 1;
        v.ms += Math.min(t, s.end) - s.start;
        sofar.set(s.place, v);
      }
      let leadId = null, leadMs = -1;
      for (const [id, v] of sofar) if (v.ms > leadMs) { leadId = id; leadMs = v.ms; }
      for (const [id, b] of badges) if (!sofar.has(id)) { b.marker.setMap(null); badges.delete(id); }
      for (const [id, v] of sofar) {
        const p = byId.get(id);
        const d = Math.round(2 * (7 + 9 * Math.sqrt(Math.min(1, v.ms / top))));
        let b = badges.get(id);
        if (!b) {
          b = { marker: new DomMarker({ position: { lat: p.lat, lng: p.lng }, html: "", anchor: "center", zIndex: BADGE_Z }) };
          b.marker.setMap(map);
          badges.set(id, b);
          paint(b, p, v.n, v.ms, id === leadId, d);
        } else if (b.n !== v.n || b.d !== d || b.lead !== (id === leadId)) paint(b, p, v.n, v.ms, id === leadId, d);
      }
      const key = [...badges].map(([id, b]) => `${id}:${b.d}:${b.lead ? 1 : 0}`).join(",");
      if (key !== shown) {
        shown = key;
        names.set([...badges].map(([id, b]) => {
          const p = byId.get(id);
          return { id, lat: p.lat, lng: p.lng, text: labelOf(p, gnames) || `Place ${id}`, gap: b.d / 2 + 5, strong: b.lead };
        }));
      }
    });
    return () => { unsub(); for (const b of badges.values()) b.marker.setMap(null); names.setMap(null); };
  }, [ready, dayPlaces, review, day, pal, gnames, pbSubscribe]);

  /** MOVE: the trail, the reveal and the unit, on the clock's subscription. */
  useEffect(() => {
    if (!ready || !points.length) return undefined;
    return pbSubscribe((t, sample) => {
      const map = mapRef.current, maps = mapsRef.current, layers = layerRef.current;
      if (!map || !maps || !layers || !sample) return;
      const runs = travelledTo(points, t);
      while (layers.trail.length > runs.length) layers.trail.pop().setMap(null);
      const rewriteAll = t < layers.trailT || runs.length !== layers.trail.length;
      layers.trailT = t;
      for (let i = 0; i < runs.length; i++) {
        if (!layers.trail[i]) {
          layers.trail[i] = new maps.Polyline({ map, path: runs[i], strokeColor: "#38bdf8", strokeOpacity: 0.95, strokeWeight: 4, zIndex: 2 });
        } else if (rewriteAll || i === runs.length - 1) {
          layers.trail[i].setPath(runs[i]);
        }
      }
      syncReveal(layers.timed, t, (e, due) => {
        e.marker.setMap(due ? map : null);
        if (!due && layers.openTick?.marker === e.marker) { layers.openTick.close(); layers.openTick = null; }
      });
      const unit = unitRef.current;
      if (!unit) return;
      unit.setPosition({ lat: sample.lat, lng: sample.lng });
      const hdg = Number.isFinite(sample.hdg) ? sample.hdg : null;
      const frame = hdg == null ? unit._headingFrame : truckFrame(hdg);
      if (hdg != null && unit._headingFrame !== frame) {
        unit.setTruckFrame(mstate, hdg);
        unit._headingFrame = frame;
      }
      // Keep the unit in view as it drives.
      const bb = map.getBounds();
      if (bb && !bb.contains({ lat: sample.lat, lng: sample.lng })) map.panTo({ lat: sample.lat, lng: sample.lng });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbSubscribe, points, ready]);

  // The transport's calendar only shows the day here: no stepping, no picking.
  const leftRef = useRef(null);
  useEffect(() => {
    const d = leftRef.current?.querySelector(".rp__day");
    if (d) d.inert = true;
  });

  // Esc closes, as the other dialogs do.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── the right column ──
  const logDay = review.days.find((d) => d.date === day) ?? null;
  const topSpeed = useMemo(() => {
    let v = null;
    for (const p of points) if (Number.isFinite(p.spd) && (v == null || p.spd > v)) v = p.spd;
    return v;
  }, [points]);
  const seen = useMemo(() => events.filter((e) => e.t <= pb.cursor), [events, pb.cursor]);
  const counts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }, [events]);
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [seen.length]);

  const empty = !loading && !error && points.length === 0;

  const body = (
    <div className="sp4-root lbp-scope">
      <div className="sp4-modal-overlay" role="presentation"
           onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="sp4-modal lbp" role="dialog" aria-modal="true" aria-labelledby="lbp-title">
          <div className="sp4-modal-head">
            <span className="sp4-repair-title" id="lbp-title">Playback</span>
            <span className="lbp-unit">{unitLabel}</span>
            {GOOGLE_BASE_AVAILABLE && (
              <div className="urv-seg lbp-seg" role="group" aria-label="Base map">
                {[["osm", "Map"], ["google", "Satellite"]].map(([id, label]) => (
                  <button key={id} type="button" className={base === id ? "is-on" : ""} aria-pressed={base === id} onClick={() => chooseBase(id)}>{label}</button>
                ))}
              </div>
            )}
            <button type="button" className="sp4-modal-x" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
          </div>

          <div className="lbp-cols">
            {/* 1 · the map and the live map's own transport under it */}
            <section className="lbp-left" ref={leftRef}>
              <div className="lbp-map">
                <div ref={el} className="lbp-map__canvas" />
                <MapStatusBar map={mapObj} attribution={base === "google" ? GOOGLE_ATTRIBUTION : OSM_ATTRIBUTION} className="map-status--panel" />
                {loading && <div className="lbp-msg">Loading the day…</div>}
                {error && <div className="lbp-msg">The day could not load: {error}</div>}
                {empty && <div className="lbp-msg">No GPS fixes on this day.</div>}
              </div>
              <RoutePlayback
                plate={unitLabel}
                day={day}
                onDay={() => {}}
                cursor={pb.cursor}
                subscribe={pbSubscribe}
                events={events}
                points={points}
                t0={pb.t0}
                t1={pb.t1}
                playing={pb.playing}
                rate={pb.rate}
                skipped={pb.skipped}
                onToggle={pb.toggle}
                onSeek={pb.seek}
                onRate={pb.setRate}
                onClose={onClose}
                loading={loading}
                error={error}
                summary={data && { points: data.points?.length ?? 0, fixes: data.fixes, distanceM: data.distanceM, truncated: data.truncated, gapSpans }}
              />
            </section>

            <aside className="lbp-right">
              {/* 2 · the day's figures */}
              <section className="lbp-sec">
                <h3 className="lbp-h">Day</h3>
                <dl className="lbp-stats">
                  <div className="is-lead"><dt>Distance</dt><dd>{logDay ? nf(logDay.km, 1) : data?.distanceM != null ? nf(data.distanceM / 1000, 1) : "—"}<small>km</small></dd></div>
                  <div><dt>Driving</dt><dd>{logDay?.driveH != null ? hm(logDay.driveH) : "—"}</dd></div>
                  <div><dt>Engine on</dt><dd>{logDay?.engineH != null ? hm(logDay.engineH) : "—"}</dd></div>
                  <div><dt>Top speed</dt><dd>{topSpeed != null ? Math.round(topSpeed) : "—"}<small>km/h</small></dd></div>
                  <div><dt>First move</dt><dd>{logDay?.firstMove ? HHMM.format(logDay.firstMove) : pb.t0 ? HHMM.format(pb.t0) : "—"}</dd></div>
                  <div><dt>Last move</dt><dd>{logDay?.lastMove ? HHMM.format(logDay.lastMove) : pb.t1 ? HHMM.format(pb.t1) : "—"}</dd></div>
                  <div><dt>Stops</dt><dd>{counts.stop ?? 0}</dd></div>
                  <div className={(counts.theft ?? 0) + (counts.refill ?? 0) ? "is-warn" : ""}><dt>Fuel events</dt><dd>{(counts.theft ?? 0) + (counts.refill ?? 0)}</dd></div>
                  <div className={counts.speeding ? "is-crit" : ""}><dt>Speeding</dt><dd>{counts.speeding ?? 0}</dd></div>
                </dl>
              </section>

              {/* 3 · what happened, revealed as the replay reaches it */}
              <section className="lbp-sec lbp-sec--events">
                <h3 className="lbp-h">Events <span>{seen.length} of {events.length}</span></h3>
                <ol className="lbp-events" ref={listRef}>
                  {seen.map((e, i) => (
                    <li key={`${e.t}-${i}`} className={i === seen.length - 1 ? "is-now" : ""}>
                      <button type="button" className={`lbp-ev lbp-ev--${e.severity}`} onClick={() => pb.seek(e.t)} title="Jump the playback here">
                        <span className={`lbp-ev__icon lbp-ev__icon--${e.kind}`} aria-hidden="true">
                          {e.kind === "stop" ? <StopSign size={12} /> : <i className={`ti ${KIND_ICON[e.kind] ?? "ti-point-filled"}`} />}
                        </span>
                        <span className="lbp-ev__what">
                          <b>{e.label}</b>
                          {e.detail && <span>{e.detail}</span>}
                        </span>
                        <time className="lbp-ev__t">{HHMMSS.format(e.t)}</time>
                      </button>
                    </li>
                  ))}
                  {!seen.length && <li className="lbp-empty">{events.length ? "Press play. Events appear as the replay reaches them." : loading ? "" : "No events on this day."}</li>}
                </ol>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(body, host ?? document.body);
}
