// Depots marked on the Movements report (operator, 4 Nov 2026: "the units
// based in Nairobi depot be highlighted in blue"). A depot is one of the
// organisation's own geofences, found by name, so nothing is typed in here
// but the name: when the fence is moved or resized in Wialon and copied
// across, the report follows it.
//
// A unit is at the depot when its last position is inside the fence or within
// `radiusM` of its edge: the fence is drawn round the yard alone, and a van at
// the gate or on the road outside is at the depot too (operator: "an extra
// margin of a radius of 1 km"). Only the groups named are marked.
//
// Pure: no React, no network.

import { fenceContains } from './zoneContainment';

/** By organisation code: the depots its Movements report marks. */
export const DEPOTS = {
  MENENGAI: [
    { key: 'nairobi', name: /nairobi\s*depot/i, label: 'Nairobi depot', radiusM: 1000, groups: [/^van\s*sales$/i], who: 'Van Sales', fill: '#9cc7f5' },
  ],
};

/** The depots the organisation's report marks, before their fences are found. */
export const depotsFor = (orgCode) => DEPOTS[String(orgCode ?? '').trim().toUpperCase()] ?? [];

const fenceName = (f) => String(f?.properties?.name ?? f?.properties?.title ?? f?.properties?.label ?? '').trim();

/**
 * The depots with their fences, from the organisation's geofences
 * (FeatureCollection). `missing`: the depots whose fence is not on the platform.
 */
export function findDepots(orgCode, featureCollection) {
  const found = [];
  const missing = [];
  for (const d of depotsFor(orgCode)) {
    const feature = (featureCollection?.features ?? []).find((f) => d.name.test(fenceName(f)) && f?.geometry);
    if (feature) found.push({ ...d, feature, fence: fenceName(feature) });
    else missing.push(d);
  }
  return { found, missing };
}

const R = 6_371_000;
const rad = (x) => (x * Math.PI) / 180;
function haversine(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Metres from the point to a segment [a, b] ([lng, lat] pairs), flat over the few km that matter here. */
function toSegment(p, a, b) {
  const kx = R * rad(1) * Math.cos(rad(p.lat));
  const ky = R * rad(1);
  const ax = (a[0] - p.lng) * kx; const ay = (a[1] - p.lat) * ky;
  const bx = (b[0] - p.lng) * kx; const by = (b[1] - p.lat) * ky;
  const dx = bx - ax; const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Metres from the point to the fence: 0 inside; otherwise to its edge. Infinity for a shape it cannot read. */
export function metresToFence(point, feature) {
  const g = feature?.geometry;
  if (!g || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return Infinity;
  if (fenceContains(point, feature)) return 0;
  if (g.type === 'Point') {
    const [lng, lat] = g.coordinates ?? [];
    const r = feature.properties?.radiusM;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Infinity;
    return Math.max(0, haversine(point, { lat, lng }) - (Number.isFinite(r) ? r : 0));
  }
  const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? (g.coordinates ?? []).flat() : g.type === 'LineString' ? [g.coordinates] : null;
  if (!rings?.length) return Infinity;
  let best = Infinity;
  for (const ring of rings) for (let i = 1; i < (ring?.length ?? 0); i++) best = Math.min(best, toSegment(point, ring[i - 1], ring[i]));
  return best;
}

/**
 * The depot a row is at, or null: its last position inside the fence or
 * within the depot's margin, in one of the groups the depot marks.
 */
export function depotAt(row, groupName, depots) {
  if (!depots?.length || row?.lat == null || row?.lng == null || row.lastAt == null) return null;
  for (const d of depots) {
    if (!d.groups.some((re) => re.test(String(groupName ?? '')))) continue;
    if (metresToFence({ lat: row.lat, lng: row.lng }, d.feature) <= d.radiusM) return d;
  }
  return null;
}
