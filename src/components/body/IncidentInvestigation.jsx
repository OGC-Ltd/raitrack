/**
 * A fuel alert's investigation, drawn on the live map while its incident
 * window is open (operator, 2026-10-15: "it should run automatically on the
 * map, hence no need for extra modals"). From /fuel/thefts/:id/investigation:
 *
 *   the point   where the unit stood as the fuel began to fall (red)
 *   the route   the RECORDED fixes an hour either side, with a white casing and
 *               start/end dots; silences dotted, never drawn as a road
 *   zones       where a vehicle could drive from the point in 5 / 10 / 15
 *               minutes (red / amber / green) — search areas, not evidence
 *
 * The road-matched copy of the track is not drawn here: on the live map,
 * beside the real track, it read as a second route.
 *
 * Opening an alert frames the route, the point and the 10-minute zone once;
 * after that the camera is the operator's. Closing the window clears it all.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTheftInvestigation } from "../../api/fuelInvestigation";
import "./IncidentInvestigation.css";

const TZ = "Africa/Nairobi";
const HHMM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });

/* Fixed colours: drawn on map tiles, which do not follow the theme. */
export const INVESTIGATION_COLOR = {
  track: "#2563eb",
  gap: "#94a3b8",
  point: "#dc2626",
  ring: "#0f172a",
  zone: { 5: "#dc2626", 10: "#f59e0b", 15: "#16a34a" },
};
const C = INVESTIGATION_COLOR;

function metresBetween(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const metres = (m) => (m == null ? "—" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** Recorded stretches split at every silence, the silences, and the distance driven. */
function shape(track) {
  const runs = [];
  const holes = [];
  track.forEach((p, i) => {
    if (p.gapBefore && i > 0) holes.push([track[i - 1], p]);
    if (p.gapBefore || !runs.length) runs.push([p]);
    else runs[runs.length - 1].push(p);
  });
  let d = 0;
  for (const r of runs) for (let i = 1; i < r.length; i++) d += metresBetween(r[i - 1], r[i]);
  return { runs, holes, travelledM: Math.round(d) };
}

/**
 * Draws the alert's investigation on `map` while `theftId` is set.
 * Returns what the key needs: the investigation, its shape, and load state.
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

  useEffect(() => {
    if (!ready || !map || !maps || !inv || !shaped) return undefined;
    const drawn = [];
    const add = (x) => { drawn.push(x); return x; };
    const ll = (p) => ({ lat: p.lat, lng: p.lng });
    const { runs, holes } = shaped;
    const track = inv.track;

    // Largest first, so the 5-minute zone sits on top.
    for (const z of [...inv.zones.items].sort((a, b) => b.minutes - a.minutes)) {
      const d = add(new maps.Data({ map }));
      d.addGeoJson({ type: "Feature", properties: {}, geometry: z.geometry });
      const c = C.zone[z.minutes] ?? "#64748b";
      d.setStyle({ fillColor: c, fillOpacity: 0.1, strokeColor: c, strokeOpacity: 0.95, strokeWeight: 2.5, clickable: false });
    }
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
    const dot = (p, title, fill, scale, stroke = "#ffffff", z = 60) => add(new maps.Marker({
      map, position: ll(p), title, zIndex: z,
      icon: { path: maps.SymbolPath.CIRCLE, scale, fillColor: fill, fillOpacity: 1, strokeColor: stroke, strokeWeight: 2.5 },
    }));
    if (track.length > 1) {
      dot(track[0], `Recorded from ${HHMM.format(track[0].t)}`, C.track, 5);
      dot(track[track.length - 1], `Recorded to ${HHMM.format(track[track.length - 1].t)}`, C.track, 5);
    }
    if (inv.zones.from) dot(inv.zones.from, "Drive zones measured from here (the point is off-road)", "#ffffff", 6, C.ring, 61);
    if (inv.point) dot(inv.point, "Where the fuel began to fall", C.point, 8, "#ffffff", 62);

    // Frame once per alert: the route, the point and the 10-minute zone (else
    // the largest), so the zones are on screen. Later redraws leave the
    // camera where the operator put it.
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

    return () => { for (const x of drawn) x.setMap(null); };
  }, [ready, map, maps, inv, shaped]);

  // A closed window lets the next opening of the same alert frame again.
  useEffect(() => { if (!theftId) framed.current = null; }, [theftId]);

  return { inv, shaped, loading: Boolean(theftId) && q.isLoading, error: theftId ? q.error : null };
}

/** The key for what is drawn, in the map's top-left corner. */
export function InvestigationKey({ inv, shaped, loading, error }) {
  if (!loading && !error && !inv) return null;
  if (loading) return <div className="ivk" role="status"><span className="ivk__busy">Drawing the alert&apos;s route and drive zones…</span></div>;
  if (error) return <div className="ivk" role="status"><span className="ivk__busy">The alert&apos;s route and zones could not load: {error.message}</span></div>;
  const zones = inv.zones.items.map((z) => z.minutes).sort((a, b) => a - b);
  const still = (shaped?.travelledM ?? 0) < 200;
  return (
    <div className="ivk" role="status" aria-label="Fuel alert on the map">
      <div className="ivk__row">
        <i className="ivk__pin" aria-hidden="true" />
        <span>Fuel fell here{inv.point ? `, ${HHMM.format(Date.parse(inv.beganAt))}` : ""}</span>
      </div>
      <div className="ivk__row">
        <i className="ivk__line" aria-hidden="true" />
        <span>
          {inv.track.length === 0 ? "No GPS fixes around the alert"
            : still ? `Stood still ${HHMM.format(inv.track[0].t)}–${HHMM.format(inv.track[inv.track.length - 1].t)}`
            : `Route ${HHMM.format(inv.track[0].t)}–${HHMM.format(inv.track[inv.track.length - 1].t)}, ${metres(shaped.travelledM)}`}
          {shaped?.holes.length ? ` · signal lost ${shaped.holes.length}×` : ""}
        </span>
      </div>
      {zones.length > 0 ? (
        <div className="ivk__row">
          {zones.map((m) => <i key={m} className="ivk__zone" style={{ borderColor: C.zone[m], background: `${C.zone[m]}22` }} aria-hidden="true" />)}
          <span>Drive {zones.join(" / ")} min{inv.zones.from ? `, from a road ${metres(inv.zones.from.offsetM)} away` : ""}</span>
        </div>
      ) : (
        inv.zones.reason && <div className="ivk__row ivk__row--muted"><span>No drive zones: {inv.zones.reason}</span></div>
      )}
    </div>
  );
}
