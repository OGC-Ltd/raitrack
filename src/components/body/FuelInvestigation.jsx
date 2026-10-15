/**
 * Fuel alert › Investigate (operator, 2026-10-15).
 *
 * One map per alert, from /fuel/thefts/:id/investigation:
 *
 *   the point    where the unit stood as the fuel began to fall (a recorded fix)
 *   the track    the RECORDED fixes an hour either side, silences shown as gaps
 *   on roads     the same track matched to roads by Google — computed, off by
 *                default, and labelled so it is never read as the record
 *   zones        where a vehicle could drive from the point in 5, 10 and 15
 *                minutes — search areas, not evidence
 *
 * A scrubber walks the recorded fixes, so the reader can see where the unit
 * was at any minute around the fall. The dialog shell is the Logbook
 * playback's (LogbookPlayback.css), so the two read as one family.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { loadMapEngine } from "../../lib/mapEngine";
import { installOsmBase, OSM_TYPE_ID, OSM_ATTRIBUTION } from "../../lib/osmBase";
import MapStatusBar from "./MapStatusBar";
import { getTheftInvestigation } from "../../api/fuelInvestigation";
import "./SensorPanel.css";
import "../screens/LogbookPlayback.css";
import "./FuelInvestigation.css";

const TZ = "Africa/Nairobi";
const HHMM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const HHMMSS = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TZ });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });

/* Fixed colours: the layers are drawn on a map tile, not on the panel, so
   they do not follow the theme. Zones go warm to cool with distance. */
const COLOR = {
  track: "#2563eb",
  gap: "#94a3b8",
  snapped: "#7c3aed",
  point: "#dc2626",
  cursor: "#0f172a",
  zone: { 5: "#dc2626", 10: "#f59e0b", 15: "#16a34a" },
};

const offsetText = (s) => {
  if (s == null) return "—";
  const a = Math.abs(s);
  const t = a < 60 ? `${a} s` : `${Math.round(a / 60)} min`;
  return s === 0 ? "at the start of the fall" : s < 0 ? `${t} before the fall began` : `${t} after the fall began`;
};
/** Great-circle metres between two fixes. */
function metresBetween(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const metres = (m) => (m == null ? "—" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export default function FuelInvestigation({ orgId, theftId, plate, onClose }) {
  const q = useQuery({
    queryKey: ["fuel-investigation", orgId, theftId],
    queryFn: ({ signal }) => getTheftInvestigation(orgId, theftId, { signal }),
    enabled: Boolean(orgId && theftId),
    // A saved investigation never changes; a provisional one is rebuilt on
    // the next opening, not while it is being read.
    staleTime: Infinity,
    retry: 0,
  });
  const inv = q.data ?? null;

  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef({ track: [], gaps: [], snapped: [], zones: {}, point: null, cursor: null });
  const [maps, setMaps] = useState(null);
  const [mapObj, setMapObj] = useState(null);
  const [failed, setFailed] = useState(null);
  const [show, setShow] = useState({ track: true, snapped: false, 5: true, 10: true, 15: true });
  const [cursor, setCursor] = useState(null);

  // Esc closes, as every dialog here does.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    loadMapEngine().then((m) => {
      if (!alive || !el.current || map.current) return;
      map.current = new m.Map(el.current, { center: { lat: 0.5, lng: 34.6 }, zoom: 9, zoomControl: true, scrollwheel: true });
      installOsmBase(m, map.current);
      map.current.setMapTypeId(OSM_TYPE_ID);
      setMaps(m);
      setMapObj(map.current);
    }).catch((e) => alive && setFailed(e.message || "Map unavailable"));
    return () => { alive = false; };
  }, []);

  const track = useMemo(() => inv?.track ?? [], [inv]);
  // Recorded stretches, split at every silence; and the silences themselves.
  const { runs, holes } = useMemo(() => {
    const r = [];
    const h = [];
    track.forEach((p, i) => {
      if (p.gapBefore && i > 0) h.push([track[i - 1], p]);
      if (p.gapBefore || !r.length) r.push([p]);
      else r[r.length - 1].push(p);
    });
    return { runs: r, holes: h };
  }, [track]);

  // Draw everything once per investigation; the toggles only show and hide.
  useEffect(() => {
    const m = map.current;
    if (!maps || !m || !inv) return undefined;
    const L = layers.current;
    const ll = (p) => ({ lat: p.lat, lng: p.lng });

    // Largest first, so the 5-minute zone is drawn on top of the others.
    for (const z of [...inv.zones.items].sort((a, b) => b.minutes - a.minutes)) {
      const d = new maps.Data({ map: m });
      d.addGeoJson({ type: "Feature", properties: {}, geometry: z.geometry });
      const c = COLOR.zone[z.minutes] ?? "#64748b";
      d.setStyle({ fillColor: c, fillOpacity: 0.12, strokeColor: c, strokeOpacity: 0.95, strokeWeight: 2.5, clickable: false });
      L.zones[z.minutes] = d;
    }
    L.track = runs.filter((r) => r.length > 1).flatMap((r) => [
      new maps.Polyline({ map: m, path: r.map(ll), strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 8, zIndex: 3 }),
      new maps.Polyline({ map: m, path: r.map(ll), strokeColor: COLOR.track, strokeOpacity: 1, strokeWeight: 5, zIndex: 4 }),
    ]);
    // Start and end of the window, so the direction of travel reads.
    if (track.length > 1) {
      const end = (p, title) => new maps.Marker({
        map: m, position: ll(p), zIndex: 8, title,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 5, fillColor: COLOR.track, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
      });
      L.ends = [end(track[0], `Window start ${HHMM.format(track[0].t)}`), end(track[track.length - 1], `Window end ${HHMM.format(track[track.length - 1].t)}`)];
    }
    // A silence is drawn as dots, never as a road: nobody knows where it went.
    L.gaps = holes.map(([a, b]) => new maps.Polyline({
      map: m, path: [ll(a), ll(b)], strokeOpacity: 0, zIndex: 2,
      icons: [{ icon: { path: maps.SymbolPath.CIRCLE, scale: 1.5, fillColor: COLOR.gap, fillOpacity: 1, strokeOpacity: 0 }, repeat: "8px" }],
    }));
    L.snapped = (inv.snapped.segments ?? []).map((seg) => new maps.Polyline({
      map: null, path: seg.map(([lat, lng]) => ({ lat, lng })), strokeColor: COLOR.snapped, strokeOpacity: 0.9, strokeWeight: 3, zIndex: 4,
    }));
    if (inv.point) {
      L.point = new maps.Marker({
        map: m, position: ll(inv.point), zIndex: 10, title: "Where the fuel began to fall",
        icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: COLOR.point, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 3 },
      });
    }
    // The zones' own start, when the point was off-road (zones.from): hollow,
    // so it never reads as the incident.
    if (inv.zones.from) {
      L.zoneFrom = new maps.Marker({
        map: m, position: ll(inv.zones.from), zIndex: 9, title: "Drive zones measured from here",
        icon: { path: maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#ffffff", fillOpacity: 1, strokeColor: COLOR.cursor, strokeWeight: 2.5 },
      });
    }
    L.cursor = new maps.Marker({
      map: null, position: { lat: 0, lng: 0 }, zIndex: 11,
      icon: { path: maps.SymbolPath.CIRCLE, scale: 5, fillColor: COLOR.cursor, fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
    });

    // Frame the track, the point and the 10-minute zone (else the largest
    // there is), so the zones are on screen when the dialog opens: framed to
    // the track alone, a parked unit opened at street level with the zones'
    // edges kilometres off-screen.
    const b = new maps.LatLngBounds();
    let any = false;
    for (const p of track) { b.extend(ll(p)); any = true; }
    if (inv.point) { b.extend(ll(inv.point)); any = true; }
    if (inv.zones.from) b.extend(ll(inv.zones.from));
    const frameZone = inv.zones.items.find((z) => z.minutes === 10)
      ?? [...inv.zones.items].sort((a, c) => c.minutes - a.minutes)[0];
    const walk = (c) => { if (typeof c[0] === "number") { b.extend({ lat: c[1], lng: c[0] }); any = true; } else c.forEach(walk); };
    if (frameZone?.geometry?.coordinates) walk(frameZone.geometry.coordinates);
    // Measured again first, and once more after layout settles: the dialog
    // can still be sizing itself when the data lands, and a fit against the
    // old size opens the map far too wide or too close.
    const frame = () => {
      if (!any) return;
      maps.event.trigger(m, "resize");
      m.fitBounds(b, 30);
      if (m.getZoom() > 16) m.setZoom(16);
    };
    frame();
    const settle = setTimeout(frame, 250);

    return () => {
      clearTimeout(settle);
      for (const d of Object.values(L.zones)) d.setMap(null);
      for (const x of [...L.track, ...L.gaps, ...L.snapped]) x.setMap(null);
      L.point?.setMap(null);
      L.zoneFrom?.setMap(null);
      for (const x of L.ends ?? []) x.setMap(null);
      L.cursor?.setMap(null);
      layers.current = { track: [], gaps: [], snapped: [], zones: {}, point: null, cursor: null };
    };
  }, [maps, inv, runs, holes, track]);

  // The toggles.
  useEffect(() => {
    const m = map.current;
    const L = layers.current;
    if (!m) return;
    for (const x of [...L.track, ...L.gaps, ...(L.ends ?? [])]) x.setMap(show.track ? m : null);
    for (const x of L.snapped) x.setMap(show.snapped ? m : null);
    for (const [min, d] of Object.entries(L.zones)) d.setMap(show[min] ? m : null);
  }, [show, inv, maps]);

  // Start the scrubber at the fix nearest the fall.
  const startAt = useMemo(() => {
    if (!track.length || !inv) return 0;
    const t = Date.parse(inv.point?.fixAt ?? inv.beganAt);
    let best = 0;
    track.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(track[best].t - t)) best = i; });
    return best;
  }, [track, inv]);
  useEffect(() => { setCursor(null); }, [inv]);
  const idx = cursor ?? startAt;
  const here = track[idx] ?? null;

  useEffect(() => {
    const L = layers.current;
    if (!L.cursor || !map.current) return;
    if (here && cursor != null) { L.cursor.setPosition({ lat: here.lat, lng: here.lng }); L.cursor.setMap(map.current); }
    else L.cursor.setMap(null);
  }, [here, cursor, maps, inv]);

  const began = inv ? Date.parse(inv.beganAt) : null;
  const detected = inv ? Date.parse(inv.detectedAt) : null;
  const relMin = here && began != null ? Math.round((here.t - began) / 60_000) : null;
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));
  // Distance along the recorded track, across no silence.
  const travelledM = useMemo(() => {
    let d = 0;
    for (const r of runs) for (let i = 1; i < r.length; i++) d += metresBetween(r[i - 1], r[i]);
    return Math.round(d);
  }, [runs]);
  const zoneMins = inv?.zones.minutes ?? [5, 10, 15];
  const zoneHas = (m) => inv?.zones.items.some((z) => z.minutes === m);

  const body = (
    <div className="sp4-root lbp-scope fiv-scope">
      <div className="sp4-modal-overlay" role="presentation"
           onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="sp4-modal lbp fiv" role="dialog" aria-modal="true" aria-labelledby="fiv-title">
          <div className="sp4-modal-head">
            <span className="sp4-repair-title" id="fiv-title">Investigation</span>
            <span className="lbp-unit">{plate ?? inv?.plate ?? "Unit"}</span>
            {inv && (
              <span className={`fiv-state${inv.final ? " fiv-state--final" : ""}`}
                    title={inv.final ? `Saved ${HHMM.format(Date.parse(inv.builtAt))}; it will not change.` : "Built now; saved once the hour after the fall is over."}>
                <i className={`ti ti-${inv.final ? "lock" : "clock"}`} aria-hidden="true" />
                {inv.final ? "Saved record" : "Provisional"}
              </span>
            )}
            <button type="button" className="sp4-modal-x" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
          </div>

          <div className="lbp-cols">
            <section className="lbp-left">
              <div className="lbp-map">
                <div ref={el} className="lbp-map__canvas" />
                <MapStatusBar map={mapObj} attribution={OSM_ATTRIBUTION} className="map-status--panel" />
                {failed && <div className="lbp-msg">The map could not load: {failed}</div>}
                {!failed && q.isLoading && <div className="lbp-msg">Building the investigation…</div>}
                {!failed && q.error && <div className="lbp-msg">The investigation could not load: {q.error.message}</div>}
                {inv && !track.length && <div className="lbp-msg">No GPS fixes in the two hours around this alert.</div>}
                {inv && track.length > 0 && (
                  <div className="fiv-chip" role="status">
                    {travelledM < 200
                      ? <><i className="ti ti-parking" aria-hidden="true" /> Stood still the whole window ({metres(travelledM)} moved), so the track is under the pin</>
                      : <><i className="ti ti-route" aria-hidden="true" /> Drove {metres(travelledM)} in the window</>}
                  </div>
                )}
              </div>
              {track.length > 1 && (
                <div className="fiv-scrub">
                  <input type="range" min={0} max={track.length - 1} value={idx} aria-label="Recorded position at time"
                         onChange={(e) => setCursor(Number(e.target.value))} />
                  <div className="fiv-scrub__read" aria-live="polite">
                    <b>{here ? HHMMSS.format(here.t) : "—"}</b>
                    <span>{relMin == null ? "" : relMin === 0 ? "at the fall" : relMin < 0 ? `${-relMin} min before` : `${relMin} min after`}</span>
                    <span>{here?.spd != null ? `${Math.round(here.spd)} km/h` : "speed —"}</span>
                    <span>{here?.eng == null ? "engine —" : here.eng ? "engine on" : "engine off"}</span>
                  </div>
                </div>
              )}
            </section>

            <aside className="lbp-right fiv-right">
              <section className="lbp-sec">
                <h3 className="lbp-h">Alert</h3>
                <dl className="lbp-stats">
                  <div className="is-lead is-warn"><dt>Fuel down</dt><dd>{inv ? inv.litres.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—"}<small>L</small></dd></div>
                  <div><dt>Day</dt><dd>{began ? DAY.format(began) : "—"}</dd></div>
                  <div><dt>Fall</dt><dd>{began ? `${HHMM.format(began)}–${HHMM.format(detected)}` : "—"}</dd></div>
                </dl>
              </section>

              <section className="lbp-sec">
                <h3 className="lbp-h">Where</h3>
                {inv?.point ? (
                  <dl className="fiv-facts">
                    <div><dt>Position</dt><dd>{inv.point.lat.toFixed(5)}, {inv.point.lng.toFixed(5)}</dd></div>
                    <div><dt>Fix</dt><dd>{HHMMSS.format(Date.parse(inv.point.fixAt))}, {offsetText(inv.point.offsetS)}</dd></div>
                    <div><dt>Moved during the fall</dt><dd>{metres(inv.point.movedM)}</dd></div>
                    <p className="fiv-note">{inv.point.basis}.</p>
                  </dl>
                ) : (
                  <p className="fiv-note">{inv ? "No recorded position near the fall." : ""}</p>
                )}
              </section>

              <section className="lbp-sec fiv-layers">
                <h3 className="lbp-h">Layers</h3>
                <label className="fiv-layer">
                  <input type="checkbox" checked={show.track} onChange={() => toggle("track")} />
                  <i className="fiv-sw" style={{ background: COLOR.track }} />
                  <span><b>Recorded track</b><small>{inv ? `${HHMM.format(Date.parse(inv.window.from))}–${HHMM.format(Date.parse(inv.window.to))} · ${track.length} fixes${holes.length ? ` · ${holes.length} silent ${holes.length === 1 ? "stretch" : "stretches"} (dotted)` : ""}` : ""}</small></span>
                </label>
                <label className={`fiv-layer${inv?.snapped.segments.length ? "" : " is-off"}`}>
                  <input type="checkbox" checked={show.snapped} disabled={!inv?.snapped.segments.length} onChange={() => toggle("snapped")} />
                  <i className="fiv-sw fiv-sw--thin" style={{ background: COLOR.snapped }} />
                  <span><b>Matched to roads</b><small>{inv?.snapped.reason ?? "Computed by Google from the record, not recorded"}</small></span>
                </label>
                {zoneMins.map((m) => (
                  <label key={m} className={`fiv-layer${zoneHas(m) ? "" : " is-off"}`}>
                    <input type="checkbox" checked={!!show[m]} disabled={!zoneHas(m)} onChange={() => toggle(m)} />
                    <i className="fiv-sw fiv-sw--area" style={{ background: COLOR.zone[m], borderColor: COLOR.zone[m] }} />
                    <span><b>Drive {m} min</b>{!zoneHas(m) && inv?.zones.reason && <small>{inv.zones.reason}</small>}</span>
                  </label>
                ))}
                {inv?.zones.from && (
                  <p className="fiv-note fiv-note--from">
                    <i className="fiv-ring" aria-hidden="true" />
                    <span>
                      The point is off-road, so the zones start {metres(inv.zones.from.offsetM)} away: {inv.zones.from.basis.toLowerCase()}
                      {inv.zones.from.fixAt ? ` (${HHMM.format(Date.parse(inv.zones.from.fixAt))})` : ""}.
                    </span>
                  </p>
                )}
                <p className="fiv-note">
                  Zones show where a vehicle could drive from the point, without traffic. They are places to search, not evidence of where the fuel went.
                </p>
                {inv?.truncated && <p className="fiv-note fiv-note--warn">The track was cut short: too many fixes in the window.</p>}
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
