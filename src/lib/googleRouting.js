// Route ahead and reach, from the server's Google Routes / Isochrones proxy
// (fleet-server modules/route-ahead). Both are computed from the unit's own
// Wialon fix on the server, so nothing here sends a position.
//
// Two switches, like every other map provider here: GOOGLE_ROUTING_ENABLED
// below turns the client side off outright, and the server's
// GOOGLE_ROUTING_ENABLED (read through /routing/status) decides whether it is
// actually available. TomTom, when its own flag is on, still wins — see
// hooks/useTrafficRoute.

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../services/api";
import { useFleetLiveShared } from "../context/FleetLiveContext";

/** Client kill switch. False hides route ahead and reach whatever the server says. */
export const GOOGLE_ROUTING_ENABLED = true;

/** The reach rings, smallest first. Google caps a drive at 60 minutes. */
export const REACH_MINUTES = [15, 30, 60];

/** Is the server's Google routing on for this organisation? False while unknown. */
export function useGoogleRoutingOn() {
  const { orgId } = useFleetLiveShared();
  const { data } = useQuery({
    queryKey: ["routing-status", orgId],
    queryFn: ({ signal }) => apiFetch(`/api/v1/organisations/${orgId}/routing/status`, { signal }).then((r) => r.data),
    enabled: GOOGLE_ROUTING_ENABLED && Boolean(orgId),
    staleTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return GOOGLE_ROUTING_ENABLED && data?.enabled === true;
}

/**
 * The road from the unit to `to`, in the same shape tomtomTraffic.parseRoute
 * returns, so every consumer of useTrafficRoute reads it unchanged.
 *
 * `jams` is null rather than empty: Google's basic route carries no traffic
 * sections, and an empty list would read as "no traffic anywhere on it" — see
 * tomtomTraffic delayCause.
 */
export async function fetchRouteAhead(orgId, dbVehicleId, to, { signal } = {}) {
  const q = new URLSearchParams({ destLat: String(to.lat), destLng: String(to.lng) });
  if (to.name) q.set("destName", to.name);
  const res = await apiFetch(`/api/v1/organisations/${orgId}/vehicles/${dbVehicleId}/route-ahead?${q}`, { signal });
  return toTrafficRoute(res.data);
}

/** Server answer → TrafficRoute. Exported for tests. */
export function toTrafficRoute(d) {
  if (!d?.enabled) throw new Error("Route ahead is switched off");
  if (!d.route) throw new Error(d.reason ?? "No route");
  const r = d.route;
  const fetchedAt = Date.parse(d.computedAt) || Date.now();
  return {
    lengthM: r.distanceM,
    travelS: r.durationS,
    noTrafficS: r.staticDurationS,
    delayS: Math.max(0, r.durationS - r.staticDurationS),
    arrivalMs: Date.parse(d.etaAt) || fetchedAt + r.durationS * 1000,
    fetchedAt,
    points: r.path.map(([lat, lng]) => ({ lat, lng })),
    jams: null,
    source: "Google",
    fixAt: d.origin?.fixAt ?? null,
  };
}

/** The 15/30/60-minute reach polygons from where the unit is. */
export async function fetchReach(orgId, dbVehicleId, { signal } = {}) {
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/vehicles/${dbVehicleId}/reach?minutes=${REACH_MINUTES.join(",")}`,
    { signal },
  );
  const d = res.data;
  if (!d?.enabled) throw new Error("Reach is switched off");
  return { origin: d.origin, rings: d.rings ?? [], fetchedAt: Date.now() };
}

/**
 * GeoJSON Polygon / MultiPolygon → one entry per polygon, each a list of rings
 * of {lat,lng} — the `paths` lib/mapEngine Polygon takes (outer ring, holes).
 */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  const ring = (r) => r.map(([lng, lat]) => ({ lat, lng }));
  if (geometry.type === "Polygon") return [geometry.coordinates.map(ring)];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((poly) => poly.map(ring));
  return [];
}
