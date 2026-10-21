// The Fuel › Report graph's three tools (operator, 2026-10-21): capture a
// stretch of the period to compare with another, zoom to a drawn box, and
// pin one reading for its detail. The figures for both come from here, over
// the graph's own series (lib/fuelReport chartSeries) and the report's
// fillings, drains and segments, so a captured stretch reads the same way
// the whole period does.

const MIN = 60_000;
/** A gap between readings longer than this is a gap, not engine time. */
const ENGINE_GAP_MS = 30 * MIN;
/** Moving, for the average speed: the same 3 km/h the trips use. */
const MOVING_KMH = 3;
/** How far either side of a pinned reading the level's trend is read. */
export const TREND_MS = 10 * MIN;
/** How far from a pinned reading a filling or drain counts as near it. */
export const NEAR_MS = 30 * MIN;

/** The tank's level at a reading: the processed line, else the raw one. */
export const levelOf = (p) => (p == null ? null : p.fuelSmoothL ?? p.fuelL ?? null);

/** Overlap in ms of [a0, a1] and [b0, b1]. */
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Index of the reading nearest `t` in a time-ordered series, or -1. */
export function nearestIndex(series, t) {
  if (!series.length || !Number.isFinite(t)) return -1;
  let lo = 0, hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && t - series[lo - 1].t <= series[lo].t - t ? lo - 1 : lo;
}

/**
 * What the unit and its tank did over [from, to]. Consumed is the tank's own
 * balance, start + filled − drained − end, never under nil; per 100 km and per
 * engine hour only where there was distance or engine time to divide by.
 */
export function rangeStats(series, report, [from, to]) {
  const pts = series.filter((p) => p.t >= from && p.t <= to);
  const withLevel = pts.filter((p) => levelOf(p) != null);
  const levels = withLevel.map(levelOf);
  const startL = levels.length ? levels[0] : null;
  const endL = levels.length ? levels[levels.length - 1] : null;

  const fills = (report?.fillings ?? []).filter((f) => f.at >= from && f.at <= to);
  const drains = (report?.drains ?? []).filter((d) => d.at >= from && d.at <= to && !d.probeDropout);
  const sum = (xs) => xs.reduce((n, x) => n + (Number(x.volumeL) || 0), 0);
  const filledL = sum(fills);
  const drainedL = sum(drains);

  let engineMs = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dt = pts[i].t - pts[i - 1].t;
    if (pts[i - 1].engineOn === 1 && dt <= ENGINE_GAP_MS) engineMs += dt;
  }
  const km = pts.filter((p) => Number.isFinite(p.mileageKm));
  const distanceKm = km.length ? km[km.length - 1].mileageKm - km[0].mileageKm : 0;
  const speeds = pts.map((p) => p.speedKmh).filter((v) => Number.isFinite(v));
  const moving = speeds.filter((v) => v >= MOVING_KMH);

  const time = { trip: 0, parking: 0, stop: 0 };
  for (const s of report?.segments ?? []) {
    if (s.kind in time) time[s.kind] += overlap(from, to, s.start, s.end);
  }

  const consumedL = startL == null || endL == null ? null : Math.max(0, startL + filledL - drainedL - endL);
  return {
    from,
    to,
    durationMs: to - from,
    readings: pts.length,
    startL,
    endL,
    changeL: startL == null || endL == null ? null : endL - startL,
    minL: levels.length ? Math.min(...levels) : null,
    maxL: levels.length ? Math.max(...levels) : null,
    filledL,
    fillCount: fills.length,
    drainedL,
    drainCount: drains.length,
    consumedL,
    distanceKm,
    engineMs,
    maxSpeedKmh: speeds.length ? Math.max(...speeds) : null,
    avgMovingKmh: moving.length ? moving.reduce((n, v) => n + v, 0) / moving.length : null,
    per100Km: consumedL != null && distanceKm >= 1 ? (consumedL / distanceKm) * 100 : null,
    perEngineH: consumedL != null && engineMs >= 10 * MIN ? consumedL / (engineMs / 3_600_000) : null,
    tripMs: time.trip,
    parkingMs: time.parking,
    stopMs: time.stop,
  };
}

/**
 * One reading in detail: the reading itself, the one before it, what the level
 * did over TREND_MS either side, the segment it fell in, and the fillings and
 * drains within NEAR_MS of it.
 */
export function pointDetail(series, report, t) {
  const i = nearestIndex(series, t);
  if (i < 0) return null;
  const p = series[i];
  const prev = i > 0 ? series[i - 1] : null;
  const levelNear = (at) => {
    const k = nearestIndex(series, at);
    const q = series[k];
    return q && Math.abs(q.t - at) <= TREND_MS / 2 ? levelOf(q) : null;
  };
  const here = levelOf(p);
  const before = levelNear(p.t - TREND_MS);
  const after = levelNear(p.t + TREND_MS);
  const near = (rows, kind) => rows
    .filter((e) => Math.abs(e.at - p.t) <= NEAR_MS)
    .map((e) => ({ ...e, kind, offsetMs: e.at - p.t }));
  return {
    point: p,
    index: i,
    prevGapMs: prev ? p.t - prev.t : null,
    stepL: prev && here != null && levelOf(prev) != null ? here - levelOf(prev) : null,
    trendBeforeL: before != null && here != null ? here - before : null,
    trendAfterL: after != null && here != null ? after - here : null,
    segment: (report?.segments ?? []).find((s) => p.t >= s.start && p.t <= s.end) ?? null,
    events: [...near(report?.fillings ?? [], "fill"), ...near(report?.drains ?? [], "drain")]
      .sort((a, b) => Math.abs(a.offsetMs) - Math.abs(b.offsetMs)),
  };
}
