// Grouping the geofence layer when zoomed out.
//
// Menengai alone has 6,169 fences, most of them shops 100 m across: below street
// zoom they are specks on top of each other. A fence is drawn once it is big
// enough on screen to read as a fence; until then it counts towards the icon of
// its grid cell. Pure, like markerCluster: FleetMap owns the shapes and markers.

import { clusterByGrid } from "./markerCluster";

/** On-screen size at which a fence is drawn as itself: past a speck, it reads as a fence. */
export const FENCE_DRAW_PX = 12;

/** Wider than the units' cell: these are background, and must not crowd the vehicles. */
export const FENCE_CELL_PX = 96;

/** Web Mercator at zoom 0, where the world is 256 px wide. */
function worldPoint(lat, lng) {
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * 256,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256,
  };
}

/**
 * Where a fence is and how big, from its [lng, lat] points. `size` is in world
 * pixels at zoom 0, so a pass over thousands of fences is arithmetic only.
 */
export function fenceExtent(points) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [lng, lat] of points) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
  }
  const lat = (s + n) / 2, lng = (w + e) / 2;
  const a = worldPoint(s, w), b = worldPoint(n, e);
  return { lat, lng, s, w, n, e, ...worldPoint(lat, lng), size: Math.max(b.x - a.x, a.y - b.y) };
}

/**
 * Which fences are drawn at this zoom, and the groups standing in for the rest.
 * A group of one is still a group: a lone shop is no more visible than a crowd.
 *
 * @param {{id: any, lat: number, lng: number, x: number, y: number, size: number,
 *          s: number, w: number, n: number, e: number}[]} fences
 * @returns {{drawn: Set<object>, groups: {key: string, members: object[], lat: number,
 *          lng: number, s: number, w: number, n: number, e: number}[]}}
 */
export function clusterFences(fences, zoom, { drawPx = FENCE_DRAW_PX, cellPx = FENCE_CELL_PX } = {}) {
  const sizeScale = 2 ** zoom;
  // Whole zooms for the cells, so a fractional wheel stop does not re-cut them.
  const whole = Math.round(zoom);
  const scale = 2 ** whole;
  const drawn = new Set();
  const small = [];
  for (const f of fences) {
    if (f.size * sizeScale >= drawPx) drawn.add(f);
    else small.push(f);
  }
  const cells = clusterByGrid(small, {
    project: (f) => ({ x: f.x * scale, y: f.y * scale }),
    cellPx,
  });
  const groups = cells.map((c) => ({
    key: `${whole}:${c.key}`,
    members: c.members,
    lat: c.lat,
    lng: c.lng,
    s: Math.min(...c.members.map((f) => f.s)),
    w: Math.min(...c.members.map((f) => f.w)),
    n: Math.max(...c.members.map((f) => f.n)),
    e: Math.max(...c.members.map((f) => f.e)),
  }));
  return { drawn, groups };
}

/** A group's fence names for its tooltip, A to Z, numbers in number order. */
export function fenceNames(members) {
  return members
    .map((f) => String(f.name ?? "").replace(/\s+/g, " ").trim())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** Exact while it fits; a fence count, unlike a unit count, runs to thousands. */
export function fenceBadgeLabel(count) {
  if (count < 1000) return String(count);
  const k = count / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
}
