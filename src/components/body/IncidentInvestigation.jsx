/**
 * A fuel alert's investigation, drawn on the live map while its incident
 * window is open (operator, 2026-10-15: "it should run automatically on the
 * map, hence no need for extra modals"), in the style the operator showed
 * (isochrone with a "⏱ XX minutes" chip; route with P stops and their
 * came / left / duration; a playback bar with time, speed and mileage).
 * From /fuel/thefts/:id/investigation:
 *
 *   the point   where the unit stood as the fuel began to fall: a pin in a
 *               white square
 *   zones       where a vehicle could drive from the point in 5 / 10 / 15
 *               minutes, each outlined with its minutes on a chip — search
 *               areas, not evidence
 *   the route   the RECORDED fixes an hour either side; silences dotted, never
 *               drawn as a road; A at the start, B at the end
 *   stops       every halt of 3 min or more on that route, a P marker whose
 *               popup gives the address, position, came, left and duration
 *   playback    a pin that walks the route, with time, speed and mileage
 *
 * The road-matched copy of the track is not drawn here: on the live map,
 * beside the real track, it read as a second route.
 *
 * Opening an alert frames the route, the point and the 10-minute zone once;
 * after that the camera is the operator's. Closing the window clears it all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTheftInvestigation } from "../../api/fuelInvestigation";
import "./IncidentInvestigation.css";

const TZ = "Africa/Nairobi";
const HHMM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const HHMMSS = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });
const STAMP = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });

/* Fixed colours: drawn on map tiles, which do not follow the theme. One hue
   for the zones, as in the operator's example, deepest for the nearest. */
export const INVESTIGATION_COLOR = {
  track: "#2563eb",
  gap: "#94a3b8",
  point: "#0f172a",
  stop: "#1d4ed8",
  start: "#16a34a",
  end: "#dc2626",
  zone: { 5: "#6d28d9", 10: "#8b5cf6", 15: "#a78bfa" },
};
const C = INVESTIGATION_COLOR;

/** A halt this long or longer is a stop. */
const STOP_MIN_MS = 3 * 60_000;
/** Below this the unit is standing. */
const STILL_KMH = 3;
/** Playback: simulated seconds per real second. */
const PLAY_RATE = 120;

function metresBetween(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const metres = (m) => (m == null ? "—" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const duration = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** An SVG as a marker icon. */
const svgIcon = (svg, w, h, ax, ay) => ({
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  size: { width: w, height: h }, scaledSize: { width: w, height: h }, anchor: { x: ax, y: ay },
});
const PIN_SQUARE = svgIcon(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
  '<rect x="1" y="1" width="32" height="32" rx="3" fill="#fff" stroke="#cbd5e1"/>' +
  '<path d="M17 26s-7-6.6-7-11.6a7 7 0 0 1 14 0C24 19.4 17 26 17 26Z" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="round"/>' +
  '<circle cx="17" cy="14.4" r="2.6" fill="none" stroke="#0f172a" stroke-width="2.2"/></svg>', 34, 34, 17, 17);
const letter = (ch, fill) => svgIcon(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="4" fill="${fill}" stroke="#fff" stroke-width="2"/>` +
  `<text x="12" y="16.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="#fff">${ch}</text></svg>`, 24, 24, 12, 12);
const STOP_ICON = letter("P", C.stop);
const START_ICON = letter("A", C.start);
const END_ICON = letter("B", C.end);
/** "⏱ 5 min" on the zone's edge, as in the operator's example. */
const zoneChip = (minutes, color) => {
  const text = `${minutes} min`;
  const w = 30 + text.length * 7.6;
  return svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26" viewBox="0 0 ${w} 26">` +
    `<rect x="1" y="1" width="${w - 2}" height="24" rx="5" fill="#f5f3ff" stroke="${color}" stroke-width="1.6"/>` +
    `<circle cx="13" cy="13" r="5.6" fill="none" stroke="#1e1b4b" stroke-width="1.6"/><path d="M13 10v3.2l2 1.4" fill="none" stroke="#1e1b4b" stroke-width="1.6" stroke-linecap="round"/>` +
    `<text x="24" y="17.4" font-family="Arial,Helvetica,sans-serif" font-size="12.5" font-weight="700" fill="#1e1b4b">${text}</text></svg>`,
    w, 26, 0, 13);
};

/** The zone's outermost corner toward the north-east, where its chip sits. */
function chipSpot(geometry) {
  let best = null;
  let score = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      const s = c[1] + c[0];
      if (s > score) { score = s; best = { lat: c[1], lng: c[0] }; }
    } else c.forEach(walk);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  return best;
}

/** The route's shape: stretches, silences, stops, and mileage at each fix. */
function shape(track) {
  const runs = [];
  const holes = [];
  const km = new Array(track.length).fill(0);
  let d = 0;
  track.forEach((p, i) => {
    if (p.gapBefore && i > 0) holes.push([track[i - 1], p]);
    if (p.gapBefore || !runs.length) runs.push([p]);
    else { d += metresBetween(track[i - 1], p); runs[runs.length - 1].push(p); }
    km[i] = d / 1000;
  });
  const stops = [];
  let s = null;
  const close = (endT) => {
    if (s && endT - s.came >= STOP_MIN_MS) stops.push({ ...s, left: endT, ms: endT - s.came });
    s = null;
  };
  track.forEach((p, i) => {
    const still = (p.spd ?? 0) < STILL_KMH && !(i > 0 && metresBetween(track[i - 1], p) > 60);
    if (still && !p.gapBefore) { if (!s) s = { came: p.t, lat: p.lat, lng: p.lng }; }
    else close(p.t);
  });
  if (s) close(track[track.length - 1].t);
  return { runs, holes, stops, km, travelledM: Math.round(d) };
}

/** The stop's popup, in the map's own InfoWindow. */
function stopCard(stop, plate, onClose) {
  const div = document.createElement("div");
  div.className = "ivp";
  div.innerHTML =
    `<button type="button" class="ivp__x" aria-label="Close">×</button>` +
    `<dl>` +
    `<div><dt>Object</dt><dd>${esc(plate ?? "—")}</dd></div>` +
    `<div><dt>Address</dt><dd class="ivp__addr">Looking up…</dd></div>` +
    `<div><dt>Position</dt><dd>${stop.lat.toFixed(6)}°, ${stop.lng.toFixed(6)}°</dd></div>` +
    `<div><dt>Came</dt><dd>${STAMP.format(stop.came)}</dd></div>` +
    `<div><dt>Left</dt><dd>${STAMP.format(stop.left)}</dd></div>` +
    `<div><dt>Duration</dt><dd>${duration(stop.ms)}</dd></div>` +
    `</dl>`;
  div.querySelector(".ivp__x").addEventListener("click", onClose);
  return div;
}

const addresses = new Map();

/**
 * Draws the alert's investigation on `map` while `theftId` is set.
 * Returns what the key and the playback bar need.
 */
export function useIncidentInvestigation({ map, maps, ready, orgId, theftId }) {
  const q = useQuery({
    queryKey: ["fuel-investigation", orgId, theftId],
    queryFn: ({ signal }) => getTheftInvestigation(orgId, theftId, { signal }),
    enabled: Boolean(orgId && theftId),
    staleTime: Infinity,
    retry: 0,
  });
  const inv = theftId && q.data?.theftId === theftId ? q.data : null;
  const shaped = useMemo(() => (inv ? shape(inv.track) : null), [inv]);
  const framed = useRef(null);
  const cursorMarker = useRef(null);

  // ── playback ──
  const [cursor, setCursor] = useState(null); // ms, or null = not started
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setCursor(null); setPlaying(false); }, [inv]);
  const t0 = inv?.track[0]?.t ?? null;
  const t1 = inv?.track[inv.track.length - 1]?.t ?? null;
  useEffect(() => {
    if (!playing || t0 == null) return undefined;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const step = (now - last) * PLAY_RATE;
      last = now;
      setCursor((c) => {
        const next = (c ?? t0) + step;
        if (next >= t1) { setPlaying(false); return t1; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, t0, t1]);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && (cursor == null || cursor >= t1)) setCursor(t0);
      return !p;
    });
  }, [cursor, t0, t1]);
  const seek = useCallback((t) => { setCursor(t); }, []);
  // The last fix at or before the cursor.
  const hereIdx = useMemo(() => {
    if (!inv || cursor == null) return -1;
    const tr = inv.track;
    let lo = 0, hi = tr.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tr[mid].t <= cursor) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }, [inv, cursor]);
  const here = hereIdx >= 0 ? inv.track[hereIdx] : null;

  // ── the static layers ──
  useEffect(() => {
    if (!ready || !map || !maps || !inv || !shaped) return undefined;
    const drawn = [];
    const add = (x) => { drawn.push(x); return x; };
    const ll = (p) => ({ lat: p.lat, lng: p.lng });
    const { runs, holes, stops } = shaped;
    const track = inv.track;

    // Zones, largest first so the nearest sits on top, each with its chip.
    for (const z of [...inv.zones.items].sort((a, b) => b.minutes - a.minutes)) {
      const c = C.zone[z.minutes] ?? "#7c3aed";
      const d = add(new maps.Data({ map }));
      d.addGeoJson({ type: "Feature", properties: {}, geometry: z.geometry });
      d.setStyle({ fillColor: c, fillOpacity: 0.12, strokeColor: c, strokeOpacity: 1, strokeWeight: 2.5, clickable: false });
      const at = chipSpot(z.geometry);
      if (at) add(new maps.Marker({ map, position: at, icon: zoneChip(z.minutes, c), zIndex: 55, clickable: false, title: `Reachable by road within ${z.minutes} minutes` }));
    }

    // The route: white casing, then the line; silences dotted.
    for (const r of runs) {
      if (r.length < 2) continue;
      add(new maps.Polyline({ map, path: r.map(ll), strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 8, zIndex: 40 }));
      add(new maps.Polyline({ map, path: r.map(ll), strokeColor: C.track, strokeOpacity: 1, strokeWeight: 5, zIndex: 41 }));
    }
    for (const [a, b] of holes) {
      add(new maps.Polyline({
        map, path: [ll(a), ll(b)], strokeOpacity: 0, zIndex: 40,
        icons: [{ icon: { path: maps.SymbolPath.CIRCLE, scale: 1.5, fillColor: C.gap, fillOpacity: 1, strokeOpacity: 0 }, repeat: "8px" }],
      }));
    }

    // Stops, each with its popup.
    const popup = new maps.InfoWindow({});
    const geocoder = new maps.Geocoder();
    for (const s of stops) {
      const mk = add(new maps.Marker({ map, position: ll(s), icon: STOP_ICON, zIndex: 58, title: `Stopped ${duration(s.ms)} from ${HHMM.format(s.came)}` }));
      mk.addListener("click", () => {
        const card = stopCard(s, inv.plate, () => popup.close());
        popup.setContent(card);
        popup.open({ map, anchor: mk });
        const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
        const fill = (txt) => { const el = card.querySelector(".ivp__addr"); if (el) el.textContent = txt; };
        if (addresses.has(key)) fill(addresses.get(key));
        else geocoder.geocode({ location: ll(s) }, (res, status) => {
          const txt = status === "OK" && res[0] ? res[0].formatted_address : "No address found";
          addresses.set(key, txt);
          fill(txt);
        });
      });
    }

    if (track.length > 1) {
      add(new maps.Marker({ map, position: ll(track[0]), icon: START_ICON, zIndex: 59, title: `Start of the window, ${HHMM.format(track[0].t)}` }));
      add(new maps.Marker({ map, position: ll(track[track.length - 1]), icon: END_ICON, zIndex: 59, title: `End of the window, ${HHMM.format(track[track.length - 1].t)}` }));
    }
    if (inv.zones.from) {
      add(new maps.Marker({
        map, position: ll(inv.zones.from), zIndex: 61, title: "Drive zones measured from here (the point is off-road)",
        icon: { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#ffffff", fillOpacity: 1, strokeColor: C.point, strokeWeight: 2.5 },
      }));
    }
    if (inv.point) add(new maps.Marker({ map, position: ll(inv.point), icon: PIN_SQUARE, zIndex: 62, title: `Fuel began to fall here, ${HHMM.format(Date.parse(inv.beganAt))}` }));

    // Frame once per alert: the route, the point and the 10-minute zone.
    if (framed.current !== inv.theftId) {
      framed.current = inv.theftId;
      const b = new maps.LatLngBounds();
      let any = false;
      for (const p of track) { b.extend(ll(p)); any = true; }
      if (inv.point) { b.extend(ll(inv.point)); any = true; }
      if (inv.zones.from) b.extend(ll(inv.zones.from));
      const zone = inv.zones.items.find((z) => z.minutes === 10)
        ?? [...inv.zones.items].sort((a, c) => c.minutes - a.minutes)[0];
      const walk = (c) => { if (typeof c[0] === "number") { b.extend({ lat: c[1], lng: c[0] }); any = true; } else c.forEach(walk); };
      if (zone?.geometry?.coordinates) walk(zone.geometry.coordinates);
      if (any) {
        // Measured first: a map whose box changed since it last looked fits
        // against the old size and lands far too wide.
        maps.event.trigger(map, "resize");
        map.fitBounds(b, 60);
        if (map.getZoom() > 16) map.setZoom(16);
      }
    }

    return () => {
      popup.close();
      for (const x of drawn) x.setMap(null);
    };
  }, [ready, map, maps, inv, shaped]);

  // ── the playback pin ──
  useEffect(() => {
    if (!ready || !map || !maps) return undefined;
    if (!here) { cursorMarker.current?.setMap(null); return undefined; }
    if (!cursorMarker.current) cursorMarker.current = new maps.Marker({ zIndex: 70, clickable: false });
    cursorMarker.current.setPosition({ lat: here.lat, lng: here.lng });
    if (cursorMarker.current.getMap() !== map) cursorMarker.current.setMap(map);
    return undefined;
  }, [ready, map, maps, here]);
  useEffect(() => () => { cursorMarker.current?.setMap(null); cursorMarker.current = null; }, [theftId]);

  // A closed window lets the next opening of the same alert frame again.
  useEffect(() => { if (!theftId) framed.current = null; }, [theftId]);

  return {
    inv, shaped, loading: Boolean(theftId) && q.isLoading, error: theftId ? q.error : null,
    playback: {
      t0, t1, cursor, playing, toggle, seek, here,
      km: hereIdx >= 0 ? shaped?.km[hereIdx] ?? 0 : null,
    },
  };
}

/** The key and the playback bar, in the map's top-centre band. */
export function InvestigationKey({ inv, shaped, loading, error, playback }) {
  if (!loading && !error && !inv) return null;
  if (loading) return <div className="ivk" role="status"><span className="ivk__busy">Drawing the alert&apos;s route and drive zones…</span></div>;
  if (error) return <div className="ivk" role="status"><span className="ivk__busy">The alert&apos;s route and zones could not load: {error.message}</span></div>;
  const zones = inv.zones.items.map((z) => z.minutes).sort((a, b) => a - b);
  const still = (shaped?.travelledM ?? 0) < 200;
  const tr = inv.track;
  const p = playback;
  return (
    <div className="ivk" aria-label="Fuel alert on the map">
      <div className="ivk__legend">
        <span className="ivk__item"><i className="ivk__pin" aria-hidden="true" />Fuel fell {HHMM.format(Date.parse(inv.beganAt))}</span>
        <span className="ivk__item">
          <i className="ivk__line" aria-hidden="true" />
          {tr.length === 0 ? "No GPS fixes" : still ? "Stood still" : `Route ${metres(shaped.travelledM)}`}
          {shaped?.stops.length ? <> · <b className="ivk__p">P</b> {shaped.stops.length} {shaped.stops.length === 1 ? "stop" : "stops"}</> : null}
        </span>
        {zones.length > 0 ? (
          <span className="ivk__item">
            <i className="ivk__zone" aria-hidden="true" />
            Drive {zones.join(" / ")} min{inv.zones.from ? `, from a road ${metres(inv.zones.from.offsetM)} away` : ""}
          </span>
        ) : inv.zones.reason ? <span className="ivk__item ivk__item--muted">No drive zones: {inv.zones.reason}</span> : null}
      </div>
      {tr.length > 1 && (
        <div className="ivk__play">
          <button type="button" className="ivk__btn" onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"}>
            <i className={`ti ti-player-${p.playing ? "pause" : "play"}-filled`} aria-hidden="true" />
            {p.playing ? "Pause" : "Play"}
          </button>
          <input
            type="range" className="ivk__range" min={p.t0} max={p.t1} step={1000}
            value={p.cursor ?? p.t0} aria-label="Time along the route"
            onChange={(e) => p.seek(Number(e.target.value))}
          />
          <span className="ivk__read" aria-live="off">
            {p.here ? (
              <>
                <b>{HHMMSS.format(p.here.t)}</b>
                <span>{p.here.spd != null ? `${p.here.spd.toFixed(1)} km/h` : "— km/h"}</span>
                <span>{(p.km ?? 0).toFixed(2)} km</span>
              </>
            ) : <span>{HHMM.format(p.t0)}–{HHMM.format(p.t1)}</span>}
          </span>
        </div>
      )}
    </div>
  );
}
