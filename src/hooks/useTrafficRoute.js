// The traffic-aware route for a unit on an active trip, from where it is now to
// the end it is heading for. One TanStack Query entry per unit and target, so
// the Active Trip card and the map's route overlay share a single request.
//
// The key deliberately leaves the POSITION out. A moving truck changes position
// every few seconds, and keying on it would re-route on every tick; instead the
// query re-routes every ROUTE_REFRESH_MS from wherever the unit is by then
// (queryFn reads the newest position through a ref).

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTrafficRoute, ROUTE_REFRESH_MS, TRAFFIC_AVAILABLE } from "../lib/tomtomTraffic";

/**
 * Where a trip is heading, or null when it is not on the road between its two
 * ends. Same rule as tripProgress tripEta: the destination while outbound, the
 * yard while returning, nothing while at either end or never heard from.
 *
 * @param {object|null} trip  a trip from liveTrip()
 * @returns {{to:{lat:number,lng:number}, towards:'destination'|'yard'}|null}
 */
export function routeTarget(trip) {
  if (!trip) return null;
  if (trip.leg === "outbound" && trip.destinationLat != null && trip.destinationLng != null) {
    return { to: { lat: trip.destinationLat, lng: trip.destinationLng }, towards: "destination" };
  }
  if (trip.leg === "returning" && trip.yardLat != null && trip.yardLng != null) {
    return { to: { lat: trip.yardLat, lng: trip.yardLng }, towards: "yard" };
  }
  return null;
}

/** Older than this, a position is history and an ETA from it is fiction. */
const FRESH_MS = 30 * 60_000;

/**
 * Is the unit's position current enough to route from? An offline unit's last
 * fix can be weeks old (KBV 789M: 516 h), and "arrives 04:51" from there would
 * be a confident answer about a truck nobody can see.
 */
export function positionFresh(v, now = Date.now()) {
  if (!v || v.online === false) return false;
  return !Number.isFinite(v.capturedAtMs) || now - v.capturedAtMs <= FRESH_MS;
}

/**
 * @param {object} p
 * @param {string|null} p.vehicleId
 * @param {number|null} p.lat
 * @param {number|null} p.lng
 * @param {{lat:number,lng:number}|null} p.to
 * @param {'car'|'truck'} [p.travelMode]
 * @param {boolean} [p.enabled]
 */
export function useTrafficRoute({ vehicleId, lat, lng, to, travelMode = "truck", enabled = true }) {
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const hereRef = useRef(here);
  hereRef.current = here;

  return useQuery({
    queryKey: ["traffic-route", vehicleId, to?.lat, to?.lng, travelMode],
    queryFn: ({ signal }) => fetchTrafficRoute(hereRef.current, to, { travelMode, signal }),
    enabled: TRAFFIC_AVAILABLE && enabled && vehicleId != null && here != null && to != null,
    staleTime: ROUTE_REFRESH_MS - 10_000,
    refetchInterval: ROUTE_REFRESH_MS,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
