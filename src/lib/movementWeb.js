/**
 * The movement web: which places a unit drives between, how often, and how
 * long the drive takes (operator, 2026-10-09). Built from the Logbook's trips
 * (the driving between two stops of 10 minutes or more), so every connection
 * is a real drive from one place to the next.
 *
 * Pure: the review in, connections out, plus the arc geometry the map draws
 * them with — A→B and B→A bow to opposite sides, so both directions show.
 */

/**
 * @returns {{ edges: Array<{ key: string, from: number, to: number, trips: number,
 *   km: number, avgMin: number, avgKm: number, first: number, last: number }>,
 *   loops: Map<number, number> }}
 *   `edges` most trips first; `loops` counts the drives that came back to the
 *   place they left (round trips), per place.
 */
export function buildWeb(trips) {
  const by = new Map();
  const loops = new Map();
  for (const t of trips ?? []) {
    if (t.fromPlace == null || t.toPlace == null) continue;
    if (t.fromPlace === t.toPlace) { loops.set(t.fromPlace, (loops.get(t.fromPlace) ?? 0) + 1); continue; }
    const key = `${t.fromPlace}>${t.toPlace}`;
    const e = by.get(key) ?? { key, from: t.fromPlace, to: t.toPlace, trips: 0, km: 0, min: 0, first: t.start, last: t.start };
    e.trips += 1; e.km += t.km; e.min += t.min;
    e.first = Math.min(e.first, t.start); e.last = Math.max(e.last, t.start);
    by.set(key, e);
  }
  const edges = [...by.values()]
    .map(({ min, ...e }) => ({ ...e, km: Math.round(e.km * 10) / 10, avgMin: Math.round(min / e.trips), avgKm: Math.round((e.km / e.trips) * 10) / 10 }))
    .sort((a, b) => b.trips - a.trips || b.km - a.km);
  return { edges, loops };
}

const rad = Math.PI / 180;

/**
 * A bowed path from a to b ({lat, lng}), `n` points, bending to the LEFT of
 * the direction of travel by `bend` × the distance — so the return drive,
 * travelling the other way, bows to the other side.
 */
export function arc(a, b, bend = 0.16, n = 24) {
  const k = Math.cos(((a.lat + b.lat) / 2) * rad);
  const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay;
  // Left of (dx, dy), north up: (-dy, dx).
  const cx = mx - dy * bend, cy = my + dx * bend;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx;
    const y = u * u * ay + 2 * u * t * cy + t * t * by;
    out.push({ lat: y, lng: x / k });
  }
  return out;
}

/** Compass bearing (degrees, north = 0, clockwise) from p to q. */
export function bearing(p, q) {
  const k = Math.cos(((p.lat + q.lat) / 2) * rad);
  return (Math.atan2((q.lng - p.lng) * k, q.lat - p.lat) * 180) / Math.PI;
}

/** The line's width for a connection of `trips`, against the busiest one. */
export const edgeWidth = (trips, max) => 2 + 7 * Math.sqrt(trips / Math.max(1, max));
