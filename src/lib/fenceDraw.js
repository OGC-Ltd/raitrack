/**
 * The geometry behind the Logbook map's fence tool: which fences count as
 * sites, how big a drawn ring is, which fence it sits inside, and whether its
 * edges cross. Pure — points in, answers out.
 *
 * Points are { lat, lng }. Fences are the GeoJSON features useEstateZones
 * serves ([lng, lat] rings, circles as a Point with properties.radiusM).
 */

import { fenceContains } from "./zoneContainment";

/** Bigger than this is a region ("Selia Region", a town), not a site — the
 *  server's MAX_FENCE_HA in usage-review.areas, so the map shows exactly the
 *  fences the Logbook counts as work areas. */
export const MAX_SITE_HA = 2_000;

const R = 6_371_008.8;
const rad = Math.PI / 180;

/** Area of a ring of { lat, lng } in hectares (spherical excess, small-area). */
export function ringAreaHa(points) {
  if (!points || points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    s += (b.lng - a.lng) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
  }
  return Math.abs((s * R * R) / 2) / 10_000;
}

/** A feature's area in hectares: polygon ring or circle; 0 for anything else. */
export function featureAreaHa(f) {
  const g = f?.geometry;
  if (g?.type === "Polygon") return ringAreaHa((g.coordinates?.[0] ?? []).map(([lng, lat]) => ({ lat, lng })));
  if (g?.type === "Point") {
    const r = f.properties?.radiusM;
    return Number.isFinite(r) && r > 0 ? (Math.PI * r * r) / 10_000 : 0;
  }
  return 0;
}

/** Does this fence count as a site — an area, not a road, not a region? */
export function isSiteFence(f) {
  const g = f?.geometry;
  if (g?.type === "Point") return Number.isFinite(f.properties?.radiusM) && f.properties.radiusM > 0;
  if (g?.type !== "Polygon") return false;
  const a = featureAreaHa(f);
  return a > 0 && a <= MAX_SITE_HA;
}

/** A fence's outline as { lat, lng } points; a circle as a 48-gon. */
export function outlineOf(f) {
  const g = f?.geometry;
  if (g?.type === "Polygon") {
    const ring = (g.coordinates?.[0] ?? []).map(([lng, lat]) => ({ lat, lng }));
    // Drawn open: the map closes a polygon itself.
    const a = ring[0], z = ring[ring.length - 1];
    if (ring.length > 1 && a.lat === z.lat && a.lng === z.lng) ring.pop();
    return ring;
  }
  if (g?.type === "Point") {
    const [lng, lat] = g.coordinates ?? [];
    const r = f.properties?.radiusM ?? 0;
    const out = [];
    for (let k = 0; k < 48; k++) {
      const t = (k / 48) * 2 * Math.PI;
      out.push({
        lat: lat + ((r * Math.cos(t)) / R) / rad,
        lng: lng + ((r * Math.sin(t)) / (R * Math.cos(lat * rad))) / rad,
      });
    }
    return out;
  }
  return [];
}

/** [south, west, north, east] around some points. */
export function boxOf(points) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng;
  }
  return [s, w, n, e];
}

/** Do two [s, w, n, e] boxes overlap? */
export const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * The smallest site fence that holds every corner of `points` — the premises a
 * new inside area belongs to ("Sukari Industries" for its weighbridge). Null
 * when it stands inside none.
 */
export function parentFence(points, features, exceptId = null) {
  let best = null, bestHa = Infinity;
  for (const f of features ?? []) {
    if (f.properties?.id === exceptId || !isSiteFence(f)) continue;
    if (!points.every((p) => fenceContains(p, f))) continue;
    const ha = featureAreaHa(f);
    if (ha < bestHa) { best = f; bestHa = ha; }
  }
  return best;
}

/** The name a new fence starts with: its premises' name, then a separator. */
export const SUB_SEP = " · ";
export const suggestName = (parent) => (parent?.properties?.name ? `${parent.properties.name}${SUB_SEP}` : "");

/** Do any two edges of the closed ring cross? A bow-tie is not an area. */
export function selfCrosses(points) {
  const n = points.length;
  if (n < 4) return false;
  const seg = (i) => [points[i], points[(i + 1) % n]];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Neighbouring edges share a corner; that is not a crossing.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (cross(...seg(i), ...seg(j))) return true;
    }
  }
  return false;
}

function cross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** "3.4 ha", "640 m²" — a fence's size the way a yard is talked about. */
export function areaText(ha) {
  if (!(ha > 0)) return "—";
  if (ha < 1) return `${Math.round(ha * 10_000).toLocaleString("en-GB")} m²`;
  return `${ha < 10 ? ha.toFixed(1) : Math.round(ha).toLocaleString("en-GB")} ha`;
}
