/**
 * Arrivals at a hub (operator, 2026-10-15): reverse isochrones and every
 * unit's live-traffic drive time to one place — Naitiri, Raiply, Sukari
 * Industries, Oyani, Nyaondo, Opapo — so inbound runs can be coordinated and
 * an arrival promised from a road ETA rather than a straight line.
 *
 *   rings   where the hub can be REACHED from in 15 / 30 / 60 minutes now,
 *           live traffic (Google Isochrones, travel direction TO): inbound
 *           service zones, each outlined with "N min in" on its edge
 *   hub     a target in a white square
 *   list    the units ranked by arrival: drive time, clock time, road km,
 *           the traffic delay, and whether the run is dispatched to the hub or
 *           returning to it. A row takes the camera to the unit.
 *
 * From /routing/hubs and /routing/hubs/:key/inbound (fleet-server
 * hub-arrivals). The answer is refreshed every two minutes while open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../services/api";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import "./HubArrivals.css";

const TZ = "Africa/Nairobi";
const HHMM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });

/* Drawn on map tiles, fixed colours: teal, so inbound rings never read as
   the investigation's purple outbound zones. Deepest for the nearest. */
export const ARRIVAL_COLOR = { 15: "#0f766e", 30: "#0d9488", 60: "#2dd4bf" };
const MINUTES = [15, 30, 60];
const PAGE = 8;
const MODE_KEY = "ft-arr-mode";
const hubKeyOf = (orgId) => `ft-arr-hub:${orgId}`;
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* a remembered choice only */ } };

const mins = (s) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};
const km = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

const svgIcon = (svg, w, h, ax, ay) => ({
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  size: { width: w, height: h }, scaledSize: { width: w, height: h }, anchor: { x: ax, y: ay },
});
const HUB_ICON = svgIcon(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
  '<rect x="1" y="1" width="32" height="32" rx="3" fill="#fff" stroke="#0f766e" stroke-width="2"/>' +
  '<circle cx="17" cy="17" r="9" fill="none" stroke="#0f172a" stroke-width="2.2"/><circle cx="17" cy="17" r="4.5" fill="none" stroke="#0f172a" stroke-width="2.2"/>' +
  '<circle cx="17" cy="17" r="1.4" fill="#0f172a"/></svg>', 34, 34, 17, 17);
/** `west`: anchored by its right edge, so a chip on a ring's west side reads outward. */
const ringChip = (minutes, color, west = false) => {
  const text = `${minutes} min in`;
  const w = 30 + text.length * 7.4;
  return svgIcon(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26" viewBox="0 0 ${w} 26">` +
    `<rect x="1" y="1" width="${w - 2}" height="24" rx="5" fill="#f0fdfa" stroke="${color}" stroke-width="1.6"/>` +
    `<path d="M7 13h9m-3.4-3.6L16.2 13l-3.6 3.6" fill="none" stroke="#042f2e" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="22" y="17.4" font-family="Arial,Helvetica,sans-serif" font-size="12.5" font-weight="700" fill="#042f2e">${text}</text></svg>`,
    w, 26, west ? w : 0, 13);
};
/** Each ring's chip on its own edge (south, west, north), so three never
 *  land together: south-west and west put 30 and 60 on top of each other. */
const CHIP_DIR = { 15: [-1, 0], 30: [0, -1], 60: [1, 0] };
function chipSpot(geometry, minutes) {
  const [wy, wx] = CHIP_DIR[minutes] ?? [-1, -1];
  let best = null;
  let score = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      const s = wy * c[1] + wx * c[0];
      if (s > score) { score = s; best = { lat: c[1], lng: c[0] }; }
    } else c.forEach(walk);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  return best;
}

/** The hubs, the chosen one's answer, and its rings on `map` while open. */
export function useHubArrivals({ map, maps, ready, orgId, open }) {
  const hubsQ = useQuery({
    queryKey: ["routing-hubs", orgId],
    queryFn: ({ signal }) => apiFetch(`/api/v1/organisations/${orgId}/routing/hubs`, { signal }).then((r) => r.data),
    enabled: Boolean(open && orgId),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const hubs = useMemo(() => hubsQ.data?.hubs ?? [], [hubsQ.data]);
  const [hubKey, setHubKeyState] = useState(null);
  useEffect(() => { setHubKeyState(orgId ? read(hubKeyOf(orgId), null) : null); }, [orgId]);
  const hub = hubs.find((h) => h.key === hubKey) ?? hubs[0] ?? null;
  const setHubKey = useCallback((k) => { setHubKeyState(k); if (orgId) write(hubKeyOf(orgId), k); }, [orgId]);
  const [mode, setModeState] = useState(() => read(MODE_KEY, "DRIVE"));
  const setMode = useCallback((m) => { setModeState(m); write(MODE_KEY, m); }, []);

  const q = useQuery({
    queryKey: ["hub-inbound", orgId, hub?.key, mode],
    queryFn: ({ signal }) => apiFetch(
      `/api/v1/organisations/${orgId}/routing/hubs/${encodeURIComponent(hub.key)}/inbound?mode=${mode}&minutes=${MINUTES.join(",")}`,
      { signal },
    ).then((r) => r.data),
    enabled: Boolean(open && orgId && hub && hubsQ.data?.enabled),
    staleTime: 2 * 60_000,
    refetchInterval: open ? 2 * 60_000 : false,
    placeholderData: (prev) => prev,
    retry: 0,
  });
  const data = q.data?.enabled && q.data.hub?.key === hub?.key && q.data.mode === mode ? q.data : null;

  // ── the rings and the hub ──
  const framed = useRef(null);
  useEffect(() => {
    if (!open || !ready || !map || !maps || !hub) return undefined;
    const drawn = [];
    const add = (x) => { drawn.push(x); return x; };
    for (const r of [...(data?.rings ?? [])].sort((a, b) => b.minutes - a.minutes)) {
      const c = ARRIVAL_COLOR[r.minutes] ?? "#14b8a6";
      const d = add(new maps.Data({ map }));
      d.addGeoJson({ type: "Feature", properties: {}, geometry: r.geometry });
      d.setStyle({ fillColor: c, fillOpacity: 0.1, strokeColor: c, strokeOpacity: 1, strokeWeight: 2.5, clickable: false });
      const at = chipSpot(r.geometry, r.minutes);
      if (at) add(new maps.Marker({ map, position: at, icon: ringChip(r.minutes, c, (CHIP_DIR[r.minutes]?.[1] ?? 0) < 0), zIndex: 54, clickable: false, title: `${hub.name} can be reached from inside this line within ${r.minutes} minutes, live traffic` }));
    }
    add(new maps.Marker({ map, position: { lat: hub.lat, lng: hub.lng }, icon: HUB_ICON, zIndex: 63, title: hub.name }));

    // Frame once per hub, on its widest ring.
    if (framed.current !== hub.key && data) {
      framed.current = hub.key;
      const b = new maps.LatLngBounds();
      b.extend({ lat: hub.lat, lng: hub.lng });
      const widest = [...data.rings].sort((a, c) => c.minutes - a.minutes)[0];
      const walk = (c) => { if (typeof c[0] === "number") b.extend({ lat: c[1], lng: c[0] }); else c.forEach(walk); };
      if (widest?.geometry?.coordinates) walk(widest.geometry.coordinates);
      maps.event.trigger(map, "resize");
      map.fitBounds(b, 60);
    }
    return () => { for (const x of drawn) x.setMap(null); };
  }, [open, ready, map, maps, hub, data]);
  useEffect(() => { if (!open) framed.current = null; }, [open]);

  return {
    open,
    hubs, hub, setHubKey, mode, setMode,
    enabled: hubsQ.data ? hubsQ.data.enabled : null,
    loading: (hubsQ.isLoading || q.isLoading || (q.isPlaceholderData && !data)) && open,
    refreshing: q.isFetching && Boolean(data),
    error: hubsQ.error ?? q.error ?? null,
    data,
  };
}

const MIN_KEY = "ft-arr-min";

/**
 * The Arrivals window: which hub, by what, and who gets there when. Docked
 * bottom-right, dragged and remembered like the other map windows; it stays
 * open while the camera moves, so working down the list is one click a unit.
 */
export function ArrivalsWindow({ arrivals, onSelectUnit, onClose }) {
  const { open, hubs, hub, setHubKey, mode, setMode, enabled, loading, refreshing, error, data } = arrivals;
  const { ref, onPointerDown } = useFloatingWindow({ id: "arrivals", dock: "bottom-right", enabled: open });
  const [min, setMin] = useState(() => read(MIN_KEY, "0") === "1");
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [hub?.key, mode]);
  if (!open) return null;

  const units = data?.units ?? [];
  const pages = Math.max(1, Math.ceil(units.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = units.slice(p * PAGE, p * PAGE + PAGE);
  const inRing = (m) => units.filter((u) => u.withinMin != null && u.withinMin <= m).length;
  const stop = (e) => e.stopPropagation();
  const toggleMin = () => setMin((v) => { write(MIN_KEY, v ? "0" : "1"); return !v; });
  const now = Date.now();

  return (
    <section ref={ref} className={`arw${min ? " arw--min" : ""}`} aria-label="Arrivals at a hub">
      <header className="arw__head" onPointerDown={onPointerDown}>
        <i className="ti ti-target-arrow arw__kind" aria-hidden="true" />
        <span className="arw__title">Arrivals</span>
        <select className="arw__hub" value={hub?.key ?? ""} onChange={(e) => setHubKey(e.target.value)}
                onPointerDown={stop} aria-label="Hub" disabled={!hubs.length}>
          {!hubs.length && <option value="">{loading ? "Loading hubs…" : "No hubs"}</option>}
          {hubs.map((h) => <option key={h.key} value={h.key}>{h.name}</option>)}
        </select>
        <span className="arw__tools">
          <button type="button" className="arw__tool" onClick={toggleMin} onPointerDown={stop}
                  aria-expanded={!min} aria-label={min ? "Expand" : "Minimise"} title={min ? "Expand" : "Minimise"}>
            <i className={`ti ti-${min ? "chevron-up" : "minus"}`} aria-hidden="true" />
          </button>
          <button type="button" className="arw__tool" onClick={onClose} onPointerDown={stop}
                  aria-label="Close and clear the map" title="Close and clear the map">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </span>
      </header>

      {!min && (
        <div className="arw__body">
          <div className="arw__modes" role="radiogroup" aria-label="Travel mode">
            {[["DRIVE", "ti-truck", "Truck or car"], ["TWO_WHEELER", "ti-motorbike", "Motorbike"]].map(([m, icon, label]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className="arw__mode"
                      onClick={() => setMode(m)} onPointerDown={stop}>
                <i className={`ti ${icon}`} aria-hidden="true" />{label}
              </button>
            ))}
            {refreshing && <span className="arw__live" aria-live="polite">Updating…</span>}
          </div>

          {enabled === false && (
            <p className="arw__msg"><i className="ti ti-info-circle" aria-hidden="true" />Routing is switched off on this server.</p>
          )}
          {error && (
            <p className="arw__msg arw__msg--error" role="alert">
              <i className="ti ti-alert-circle" aria-hidden="true" />Arrivals could not load: {error.message}
            </p>
          )}
          {loading && !data && (
            <div className="arw__skel" aria-busy="true" aria-label="Loading arrivals"><span /><span /><span /><span /></div>
          )}

          {data && (
            <>
              <dl className="arw__rings">
                {MINUTES.map((m) => (
                  <div key={m} className="arw__ring" style={{ "--ring": ARRIVAL_COLOR[m] }}>
                    <dt>Within {m} min</dt><dd>{inRing(m)}</dd>
                  </div>
                ))}
                <div className="arw__ring arw__ring--at"><dt>At {hub?.name}</dt><dd>{data.atHub.length}</dd></div>
              </dl>
              {data.ringsReason && (
                <p className="arw__msg"><i className="ti ti-info-circle" aria-hidden="true" />No arrival zones. {data.ringsReason}.</p>
              )}

              {units.length === 0 ? (
                <p className="arw__msg">No unit with a recent position is within 250 km of {hub?.name}.</p>
              ) : (
                <>
                <p className="arw__cap">Drive time to {hub?.name} from where each unit is now, soonest first</p>
                <ol className="arw__list" start={p * PAGE + 1}>
                  {shown.map((u) => {
                    const stale = now - Date.parse(u.fixAt) > 15 * 60_000;
                    return (
                      <li key={u.vehicleId}>
                        <button type="button" className="arw__row" onClick={() => onSelectUnit?.(u.vehicleId)}
                                title={`Show ${u.plate ?? "this unit"} on the map`}>
                          <span className="arw__eta" style={{ "--ring": ARRIVAL_COLOR[u.withinMin] ?? "var(--arw-edge-hi)" }}>
                            <b>{mins(u.etaS)}</b><small>{HHMM.format(Date.parse(u.arriveAt))}</small>
                          </span>
                          <span className="arw__unit">
                            <span className="arw__plate">{u.plate ?? "Unnamed unit"}</span>
                            <span className="arw__meta">
                              {km(u.distanceM)} by road
                              {u.delayS >= 60 && <span className={`arw__delay${u.delayS >= 300 ? " arw__delay--hi" : ""}`}>+{mins(u.delayS)} traffic</span>}
                              {stale && <span className="arw__stale">position {mins((now - Date.parse(u.fixAt)) / 1000)} old</span>}
                            </span>
                          </span>
                          {u.run && (
                            <span className={`arw__run arw__run--${u.run}`}>{u.run === "dispatched" ? "Dispatched here" : "Returning"}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
                </>
              )}

              <footer className="arw__foot">
                {pages > 1 && (
                  <span className="arw__pager">
                    <button type="button" className="arw__tool" onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} aria-label="Previous page">
                      <i className="ti ti-chevron-left" aria-hidden="true" />
                    </button>
                    <span>{p + 1} / {pages}</span>
                    <button type="button" className="arw__tool" onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} aria-label="Next page">
                      <i className="ti ti-chevron-right" aria-hidden="true" />
                    </button>
                  </span>
                )}
                <span className="arw__note">
                  Live traffic, {HHMM.format(Date.parse(data.computedAt))}
                  {data.leftOut > 0 && ` · ${data.leftOut} further units not asked`}
                  {data.noRoute > 0 && ` · ${data.noRoute} with no road`}
                </span>
              </footer>
            </>
          )}
        </div>
      )}
    </section>
  );
}
