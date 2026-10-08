/**
 * Logbook › day playback (operator, 2026-10-08: "a playback for that day that
 * shall open the map as a modal … with the highlights of that day").
 *
 * The day's GPS fixes come from the review the server already built
 * (usage-review/day), so playing a day costs no Wialon read. The vehicle
 * moves along them at a chosen multiple of real time; parked spells can be
 * skipped. Beside the map, the day's figures and its stops and drives in
 * order: the one under the playhead is lit, and picking one jumps to it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { loadMapEngine, maps as mapsNs } from "../../lib/mapEngine";
import { installOsmBase, OSM_TYPE_ID, OSM_ATTRIBUTION } from "../../lib/osmBase";
import { installGoogleBase, GOOGLE_TYPE_ID, GOOGLE_BASE_AVAILABLE, GOOGLE_ATTRIBUTION } from "../../lib/googleBase";
import { getUsageReviewDay } from "../../api/usageReview";
import MapStatusBar from "../body/MapStatusBar";
import "./LogbookPlayback.css";
import StopSign, { stopSignIcon } from "./StopSign";

const TZ = "Africa/Nairobi";
const clockS = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const nf = (n, d = 1) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }));
const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const minutes = (m) => (m < 60 ? `${Math.round(m)} min` : hm(m / 60));
const eatDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

/** Multiples of real time on offer; 120× plays an hour's driving in 30 s. */
const SPEEDS = [30, 60, 120, 300, 600];
/** A gap between fixes longer than this is not driven through: the vehicle waits. */
const JOIN_MS = 5 * 60_000;
const BASE_MAP_KEY = "ft-map-base";

/** The vehicle: an arrow along its heading while it moves, a dot when it stands. */
class Puck extends mapsNs.OverlayView {
  constructor(color) {
    super();
    this.color = color;
    this.pos = null;
    this.course = 0;
    this.moving = false;
    this.div = null;
  }
  onAdd() {
    this.div = document.createElement("div");
    this.div.className = "lbp-puck";
    this.getPanes().floatPane.appendChild(this.div);
    this.paint();
  }
  onRemove() { this.div?.remove(); this.div = null; }
  set(pos, course, moving) {
    const changed = moving !== this.moving;
    this.pos = pos; this.course = course ?? this.course; this.moving = moving;
    if (changed) this.paint();
    this.draw();
  }
  paint() {
    if (!this.div) return;
    this.div.innerHTML = this.moving
      ? `<svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${this.color}" stroke="#fff" stroke-width="2.5"/><path d="M15 6 L21 21 L15 17.5 L9 21 Z" fill="#fff"/></svg>`
      : `<svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="11" fill="#111827" stroke="#fff" stroke-width="2.5"/><rect x="11" y="11" width="8" height="8" rx="1.5" fill="#fff"/></svg>`;
  }
  draw() {
    const proj = this.getProjection();
    if (!this.div || !proj || !this.pos) return;
    const p = proj.fromLatLngToDivPixel(this.pos);
    const rot = this.moving ? this.course : 0;
    this.div.style.transform = `translate(${Math.round(p.x - 15)}px, ${Math.round(p.y - 15)}px) rotate(${rot}deg)`;
  }
}

/**
 * @param {object} props
 * @param {string} props.date            the EAT day to play
 * @param {object} props.review          the page's review (stops, trips, days, places)
 * @param {{orgId,vehicleId,from,to}} props.req  what the review was built for
 * @param {string} props.unitLabel       the vehicle's plate / name
 * @param {(id:number)=>string} props.placeName
 * @param {object} props.pal             the page's series colours
 * @param {()=>void} props.onClose
 * @param {Element} [props.host]         where to mount (keeps the theme)
 */
export default function LogbookPlayback({ date, review, req, unitLabel, placeName, pal, onClose, host }) {
  const q = useQuery({
    queryKey: ["usage-review-day", req.orgId, req.vehicleId, req.from, req.to, date],
    queryFn: ({ signal }) => getUsageReviewDay({ ...req, date, signal }),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  // Fixes as parallel arrays: cheap to search and interpolate every frame.
  const pts = useMemo(() => {
    const rows = q.data?.points ?? [];
    return {
      n: rows.length,
      t: rows.map((r) => r[0]), lat: rows.map((r) => r[1]), lng: rows.map((r) => r[2]),
      v: rows.map((r) => r[3]), c: rows.map((r) => r[4]),
    };
  }, [q.data]);

  const day = review.days.find((d) => d.date === date) ?? { date };
  const events = useMemo(() => [
    ...review.stops.filter((s) => eatDay(s.start) === date).map((x) => ({ kind: "stop", x })),
    ...(review.trips ?? []).filter((t) => eatDay(t.start) === date).map((x) => ({ kind: "trip", x })),
  ].sort((a, b) => a.x.start - b.x.start), [review, date]);
  const stopsOfDay = useMemo(() => events.filter((e) => e.kind === "stop").map((e) => e.x), [events]);

  const t0 = pts.n ? pts.t[0] : 0;
  const t1 = pts.n ? pts.t[pts.n - 1] : 0;
  const topSpeed = useMemo(() => (pts.n ? Math.max(...pts.v) : null), [pts]);

  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(120);
  const [skipStops, setSkipStops] = useState(true);
  const [follow, setFollow] = useState(true);
  const [base, setBase] = useState(() => {
    try { return GOOGLE_BASE_AVAILABLE && localStorage.getItem(BASE_MAP_KEY) === "google" ? "google" : "osm"; } catch { return "osm"; }
  });
  const tRef = useRef(0);
  useEffect(() => { if (pts.n) { tRef.current = t0; setNow(t0); setPlaying(true); } }, [pts, t0]);

  // ── map ──
  const el = useRef(null);
  const map = useRef(null);
  const puck = useRef(null);
  const done = useRef(null);
  const lastIdx = useRef(-1);
  const [ready, setReady] = useState(false);
  const [mapObj, setMapObj] = useState(null);

  useEffect(() => {
    let alive = true;
    loadMapEngine().then((maps) => {
      if (!alive || !el.current || map.current) return;
      const m = new maps.Map(el.current, { center: { lat: 0.5, lng: 34.6 }, zoom: 9, zoomControl: true, scrollwheel: false });
      installOsmBase(maps, m);
      m.setMapTypeId(OSM_TYPE_ID);
      map.current = m;
      setMapObj(m);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return undefined;
    let dead = false;
    if (base === "google") {
      installGoogleBase(m).then(() => { if (!dead) m.setMapTypeId(GOOGLE_TYPE_ID); }).catch(() => { if (!dead) setBase("osm"); });
    } else m.setMapTypeId(OSM_TYPE_ID);
    return () => { dead = true; };
  }, [base, ready]);
  const chooseBase = (id) => { try { localStorage.setItem(BASE_MAP_KEY, id); } catch { /* remembered choice only */ } setBase(id); };

  // The whole day faded, what has been driven so far in the route colour,
  // and the day's stops numbered as in the list beside the map.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !pts.n) return undefined;
    const path = pts.t.map((_, i) => ({ lat: pts.lat[i], lng: pts.lng[i] }));
    const all = new mapsNs.Polyline({ map: m, path, strokeColor: pal.fade, strokeOpacity: 0.55, strokeWeight: 3 });
    done.current = new mapsNs.Polyline({ map: m, path: [], strokeColor: pal.route, strokeOpacity: 0.95, strokeWeight: 4.5, zIndex: 2 });
    lastIdx.current = -1;
    const marks = stopsOfDay.map((s, k) => new mapsNs.Marker({
      map: m, position: { lat: s.lat, lng: s.lng }, zIndex: 150,
      title: `Stop ${k + 1} · ${clock.format(s.start)}–${clock.format(s.end)} · ${s.place != null ? placeName(s.place) : ""}`,
      ...(s.overnight
        ? { icon: { path: mapsNs.SymbolPath.CIRCLE, scale: 10, fillColor: "#d97706", fillOpacity: 0.95, strokeColor: "#fff", strokeWeight: 2 },
            label: { text: String(k + 1), color: "#fff", fontSize: "10px", fontWeight: "700" } }
        : { icon: stopSignIcon(24, String(k + 1)) }),
    }));
    marks.forEach((mk, k) => mk.addListener("click", () => seek(stopsOfDay[k].start)));
    puck.current = new Puck(pal.route);
    puck.current.setMap(m);
    const b = new mapsNs.LatLngBounds();
    path.forEach((p) => b.extend(p));
    m.fitBounds(b, 50);
    if (m.getZoom() > 15) m.setZoom(15);
    return () => {
      all.setMap(null); done.current?.setMap(null); marks.forEach((mk) => mk.setMap(null));
      puck.current?.setMap(null); puck.current = null;
    };
    // seek is stable (below); placeName only labels titles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pts, stopsOfDay, pal]);

  /** Index of the last fix at or before `t`. */
  const idxAt = useCallback((t) => {
    let lo = 0, hi = pts.n - 1, at = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts.t[mid] <= t) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    return at;
  }, [pts]);

  // Draw the playhead: the puck, the driven line, and the camera if following.
  const paint = useCallback((t) => {
    if (!pts.n || !puck.current) return;
    const i = idxAt(t);
    const j = Math.min(i + 1, pts.n - 1);
    let lat = pts.lat[i], lng = pts.lng[i];
    const gap = pts.t[j] - pts.t[i];
    if (j > i && gap > 0 && gap < JOIN_MS) {
      const f = Math.min(1, Math.max(0, (t - pts.t[i]) / gap));
      lat += (pts.lat[j] - lat) * f; lng += (pts.lng[j] - lng) * f;
    }
    const moving = (pts.v[i] ?? 0) >= 3 && gap < JOIN_MS;
    puck.current.set({ lat, lng }, pts.c[i], moving);
    if (i !== lastIdx.current && done.current) {
      lastIdx.current = i;
      done.current.setPath(pts.t.slice(0, i + 1).map((_, k) => ({ lat: pts.lat[k], lng: pts.lng[k] })).concat([{ lat, lng }]));
    }
    const m = map.current;
    if (follow && m && !m.getBounds().contains({ lat, lng })) m.panTo({ lat, lng });
    else if (follow && m) {
      // Keep it off the edges: re-centre once it leaves the middle 70 %.
      const bb = m.getBounds();
      const ne = bb.getNorthEast(), sw = bb.getSouthWest();
      const fx = (lng - sw.lng()) / (ne.lng() - sw.lng()), fy = (lat - sw.lat()) / (ne.lat() - sw.lat());
      if (fx < 0.15 || fx > 0.85 || fy < 0.15 || fy > 0.85) m.panTo({ lat, lng });
    }
  }, [pts, idxAt, follow]);

  const seek = useCallback((t) => {
    const c = Math.min(t1, Math.max(t0, t));
    tRef.current = c;
    setNow(c);
    paint(c);
  }, [t0, t1, paint]);

  // The clock: real time × speed, hopping over parked spells when asked.
  useEffect(() => {
    if (!playing || !pts.n) return undefined;
    let raf, last = performance.now();
    const tick = (ts) => {
      const dt = Math.min(1000, ts - last);
      last = ts;
      let t = tRef.current + dt * speed;
      if (skipStops) {
        const s = stopsOfDay.find((x) => t > x.start + 20_000 && t < x.end - 20_000);
        if (s) t = s.end - 20_000;
      }
      if (t >= t1) { t = t1; setPlaying(false); }
      tRef.current = t;
      setNow(t);
      paint(t);
      if (t < t1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, skipStops, stopsOfDay, t1, paint, pts.n]);

  useEffect(() => { if (ready && pts.n) paint(tRef.current); }, [ready, pts, paint]);

  // Space plays and pauses; Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " " && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const i = pts.n ? idxAt(now) : 0;
  const curSpeed = pts.n ? pts.v[i] : null;
  const current = events.findIndex((e) => now >= e.x.start && now < e.x.end);
  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.querySelector(".is-now")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // Driving shaded on the scrubber, so the parked stretches show at a glance.
  const track = useMemo(() => {
    if (!pts.n || t1 <= t0) return undefined;
    const span = t1 - t0;
    const stops = [];
    for (const e of events) {
      if (e.kind !== "trip") continue;
      const a = ((Math.max(e.x.start, t0) - t0) / span) * 100, b = ((Math.min(e.x.end, t1) - t0) / span) * 100;
      if (b > a) stops.push(`transparent ${a}%`, `var(--lbp-drive) ${a}%`, `var(--lbp-drive) ${b}%`, `transparent ${b}%`);
    }
    return stops.length ? `linear-gradient(90deg, ${stops.join(", ")})` : undefined;
  }, [events, pts.n, t0, t1]);

  const restart = () => { seek(t0); setPlaying(true); };
  const jump = (t) => { seek(t); setPlaying(true); };
  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  const body = (
    <div className="lbp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp4-root lbp" role="dialog" aria-modal="true" aria-label={`Playback of ${dayLabel}`}>
        <header className="lbp-head">
          <div className="lbp-title">
            <i className="ti ti-player-play" aria-hidden="true" />
            <div>
              <b>Playback · {dayLabel}</b>
              <span>{unitLabel}</span>
            </div>
          </div>
          <div className="lbp-head__acts">
            {GOOGLE_BASE_AVAILABLE && (
              <div className="urv-seg lbp-seg" role="group" aria-label="Base map">
                {[["osm", "OpenStreetMap"], ["google", "Satellite"]].map(([id, label]) => (
                  <button key={id} type="button" className={base === id ? "is-on" : ""} aria-pressed={base === id} onClick={() => chooseBase(id)}>{label}</button>
                ))}
              </div>
            )}
            <button type="button" className="lbp-x" onClick={onClose} aria-label="Close" title="Close (Esc)"><i className="ti ti-x" aria-hidden="true" /></button>
          </div>
        </header>

        <div className="lbp-body">
          <div className="lbp-stage">
            <div className="lbp-map">
              <div ref={el} className="lbp-map__canvas" />
              <MapStatusBar map={mapObj} attribution={base === "google" ? GOOGLE_ATTRIBUTION : OSM_ATTRIBUTION} className="map-status--panel" />
              {q.isLoading && <div className="lbp-msg">Loading the day&apos;s track…</div>}
              {q.isError && <div className="lbp-msg">The day&apos;s track could not load: {q.error?.message ?? "error"}</div>}
              {q.isSuccess && !pts.n && <div className="lbp-msg">No GPS fixes on this day.</div>}
              {pts.n > 0 && (
                <div className="lbp-hud">
                  <b>{clockS.format(now)}</b>
                  <span>{curSpeed != null ? `${curSpeed} km/h` : ""}</span>
                </div>
              )}
            </div>

            <div className="lbp-ctrl">
              <button type="button" className="lbp-play" onClick={() => (now >= t1 ? restart() : setPlaying((p) => !p))} disabled={!pts.n}
                      aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
                <i className={`ti ${playing ? "ti-player-pause-filled" : "ti-player-play-filled"}`} aria-hidden="true" />
              </button>
              <button type="button" className="lbp-icon" onClick={restart} disabled={!pts.n} aria-label="From the start" title="From the start">
                <i className="ti ti-player-skip-back" aria-hidden="true" />
              </button>
              <span className="lbp-time">{pts.n ? clock.format(t0) : "--:--"}</span>
              <input type="range" className="lbp-scrub" min={t0} max={t1 || 1} step={1000} value={now} disabled={!pts.n}
                     style={{ backgroundImage: track }}
                     onChange={(e) => seek(Number(e.target.value))} aria-label="Playback position" />
              <span className="lbp-time">{pts.n ? clock.format(t1) : "--:--"}</span>
              <div className="urv-seg lbp-seg" role="group" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" className={speed === s ? "is-on" : ""} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
                ))}
              </div>
              <label className="lbp-check"><input type="checkbox" checked={skipStops} onChange={(e) => setSkipStops(e.target.checked)} /> Skip stops</label>
              <label className="lbp-check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
            </div>
          </div>

          <aside className="lbp-side">
            <h3 className="frv-card__t">Highlights</h3>
            <div className="lbp-stats">
              <div><b>{nf(day.km, 1)}<small> km</small></b><span>Distance</span></div>
              <div><b>{day.driveH != null ? hm(day.driveH) : "—"}</b><span>Driving</span></div>
              <div><b>{day.engineH != null ? hm(day.engineH) : "—"}</b><span>Engine on</span></div>
              <div><b>{topSpeed != null ? topSpeed : "—"}<small> km/h</small></b><span>Top speed</span></div>
              <div><b>{day.firstMove ? clock.format(day.firstMove) : "—"}</b><span>First move</span></div>
              <div><b>{day.lastMove ? clock.format(day.lastMove) : "—"}</b><span>Last move</span></div>
            </div>
            <h3 className="frv-card__t lbp-side__h">Stops and drives <span>{stopsOfDay.length} stops · {events.length - stopsOfDay.length} drives</span></h3>
            <ol className="lbp-list" ref={listRef}>
              {events.map(({ kind, x }, k) => {
                const stopNo = kind === "stop" ? stopsOfDay.indexOf(x) + 1 : null;
                return (
                  <li key={`${kind}${x.id}`} className={k === current ? "is-now" : now >= x.end ? "is-past" : ""}>
                    <button type="button" onClick={() => jump(x.start)} title="Play from here">
                      <span className={`urv-kind urv-kind--${kind === "trip" ? "drive" : x.overnight ? "night" : "stop"}`}>
                        {kind === "stop" && !x.overnight ? <StopSign /> : <i className={`ti ${kind === "trip" ? "ti-road" : "ti-moon"}`} aria-hidden="true" />}
                        {kind === "trip" ? "Drive" : stopNo}
                      </span>
                      <span className="lbp-ev">
                        <b>{kind === "trip" ? `${placeName(x.fromPlace)} → ${placeName(x.toPlace)}` : x.place != null ? placeName(x.place) : "Stop"}</b>
                        <span>{clock.format(x.start)}–{clock.format(x.end)} · {kind === "trip" ? `${nf(x.km, 1)} km · ` : ""}{minutes(x.min)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {!events.length && <li className="lbp-empty">No stops or drives recorded on this day.</li>}
            </ol>
          </aside>
        </div>
      </div>
    </div>
  );
  return createPortal(body, host ?? document.body);
}
