// The Fuel Graph report (operator, 13 Nov 2026: "provide fuel graph snips of units that consumed a
// certain rate ... the fuel graph for the whole day, attached to a single page, and leave a quarter of
// the page for the explanation: vehicle reg, consumption that day, initial and final fuel level,
// distance covered"). One landscape page per unit, on the letterhead: its fuel level over the days
// picked in the top three quarters, the figures of the Fuel Consumption Rate report in the bottom one.
//
// Drawn in the browser from the unit's own readings (lib/vehicleDay), as the Fuel chart on its card is;
// the figures are the report's row, so the page and the table always agree.

const OFFSET = 3 * 3_600_000;   // Nairobi
const p2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => { const d = new Date(ms + OFFSET); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const dmy = (ms) => { const d = new Date(ms + OFFSET); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const dayWords = (day) => { const [y, m, d] = String(day).split('-'); return `${d}/${m}/${y}`; };

/** A fleet day's bounds, [00:00, 24:00) in Nairobi. */
export const dayStart = (day) => Date.parse(`${day}T00:00:00+03:00`);
export const dayEnd = (day) => dayStart(day) + 86_400_000;

/** 80.85 L, 0 L: as Menengai's sheet writes litres. */
const L1 = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Math.round(Number(n) * 100) / 100} L`);

/**
 * The fuel line: litres at each reading, a probe's lone spikes taken out (the middle of each five
 * readings), a reading of nothing left out (a probe that lost its signal reads 0).
 */
export function fuelSeries(pings, { from = -Infinity, to = Infinity } = {}) {
  const raw = (pings ?? [])
    .filter((p) => p.t >= from && p.t < to && Number.isFinite(p.fuelLevelMl) && p.fuelLevelMl > 0)
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ t: p.t, L: p.fuelLevelMl / 1000 }));
  return raw.map((p, i) => {
    const w = raw.slice(Math.max(0, i - 2), i + 3).map((x) => x.L).sort((a, b) => a - b);
    return { t: p.t, L: w[Math.floor(w.length / 2)] };
  });
}

/** Where the tank rose by REFILL_L or more within REFILL_MS: a refill, with its litres. */
export const REFILL_L = 20;
export const REFILL_MS = 45 * 60_000;
export function refillsIn(series) {
  const out = [];
  let i = 0;
  while (i < series.length) {
    let j = i;
    let top = i;
    while (j + 1 < series.length && series[j + 1].t - series[i].t <= REFILL_MS) {
      j += 1;
      if (series[j].L > series[top].L) top = j;
    }
    const gain = series[top].L - series[i].L;
    if (gain >= REFILL_L) {
      const prev = out[out.length - 1];
      // Still rising from the last one: the same refill, filled in more than one go of REFILL_MS
      if (prev && series[i].t - prev.t <= REFILL_MS) Object.assign(prev, { t: series[top].t, to: series[top].L, L: series[top].L - prev.from });
      else out.push({ t: series[top].t, from: series[i].L, to: series[top].L, L: gain });
      i = top + 1;
    } else i += 1;
  }
  return out;
}

/**
 * What the unit was doing along the day (operator, 13 Nov 2026: "colours to show if the unit was parked,
 * driving or …"): driving at MOVING_KMH or more; idling, the engine on and standing; parked, the engine
 * off and standing. Runs of one state, each to the next reading; a gap over GAP_MS is no data.
 */
export const MOVING_KMH = 5;
export const GAP_MS = 2 * 3_600_000;
export const ACTIVITY = {
  driving: { label: 'Driving', color: [22, 163, 74], tint: [214, 240, 221] },
  idling: { label: 'Idling (engine on, standing)', color: [245, 158, 11], tint: [253, 236, 200] },
  parked: { label: 'Parked (engine off)', color: [156, 163, 175], tint: [233, 235, 238] },
};
export function activityRuns(pings, { from = -Infinity, to = Infinity } = {}) {
  const list = (pings ?? []).filter((p) => p.t >= from && p.t < to).sort((a, b) => a.t - b.t);
  const stateOf = (p) => (p.speedKmh >= MOVING_KMH ? 'driving' : p.engineOn === true ? 'idling' : p.engineOn === false ? 'parked' : p.speedKmh != null ? 'parked' : null);
  const runs = [];
  for (let i = 0; i < list.length; i++) {
    const state = stateOf(list[i]);
    const next = list[i + 1];
    const end = next && next.t - list[i].t <= GAP_MS ? next.t : list[i].t;
    if (!state || end <= list[i].t) continue;
    const last = runs[runs.length - 1];
    if (last && last.state === state && last.end === list[i].t) last.end = end;
    else runs.push({ state, start: list[i].t, end });
  }
  return runs;
}

/**
 * The ground's height along the day (operator, 13 Nov 2026: "include an altitude in these graphs"), so a
 * fall in the fuel on a climb, or the probe's level tilting on a slope, can be read against it. Metres
 * at each reading with one; a lone jump of the fix taken out as the fuel's are (the middle of five).
 */
export function altitudeSeries(pings, { from = -Infinity, to = Infinity } = {}) {
  const raw = (pings ?? [])
    .filter((p) => p.t >= from && p.t < to && Number.isFinite(p.altitudeM) && p.altitudeM !== 0)
    .sort((a, b) => a.t - b.t);
  return raw.map((p, i) => {
    const w = raw.slice(Math.max(0, i - 2), i + 3).map((x) => x.altitudeM).sort((a, b) => a - b);
    return { t: p.t, m: w[Math.floor(w.length / 2)] };
  });
}

/** The figures in the bottom quarter, from the Fuel Consumption Rate row. */
export function graphFacts(row, { from, to }) {
  const km = Number(row.distanceKm);
  const kmPerL = row.kmPerL != null ? Number(row.kmPerL) : null;
  return [
    ['Vehicle reg', row.plate ?? ''],
    ['Date', from === to ? dayWords(from) : `${dayWords(from)} – ${dayWords(to)}`],
    ['Target consumption', row.target?.kmPerL != null ? `${row.target.kmPerL} km/L` : (row.target?.words ?? '—')],
    ['Consumption', kmPerL != null ? `${kmPerL.toFixed(2)} km/L  ·  ${(100 / kmPerL).toFixed(1)} L/100 km` : '—'],
    ['Initial fuel level', L1(row.startL)],
    ['Final fuel level', L1(row.endL)],
    ['Amount filled', L1(row.filledL)],
    ['Amount consumed', L1(row.consumedL)],
    ['Suspected theft', L1(row.theftL ?? 0)],
    ['Distance covered', Number.isFinite(km) ? `${Math.round(km * 10) / 10} km` : '—'],
    ['Against target', row.belowTarget === true ? 'Below target' : row.belowTarget === false ? 'On target' : '—'],
    ['Comment', row.note || (kmPerL != null ? 'PROBE OK' : '—')],
  ];
}

// The page: A4 landscape, in points
const W = 842;
const H = 595;
const M = 28;
const BAND_H = 54;
const INK = [17, 17, 17];
const MUT = [107, 114, 128];
const RULE = [209, 213, 219];
const LINE = [31, 58, 95];

/** Nice steps for an axis from 0 to max. */
function ticks(max, n = 5) {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  // Up to the first step at or over the top, so the line stays under the last
  for (let v = 0; ; v += step) { out.push(Math.round(v * 100) / 100); if (v >= max - 1e-9) break; }
  return out;
}

/** One unit's page on `doc` (a jsPDF, points, A4 landscape). */
/** The drains shown as fuel lost: a possible theft, and a drop beyond measured burn. */
export const LOSS_KINDS = new Set(['theft', 'drop']);
const PUMP = [37, 99, 235];
const THEFT = [220, 38, 38];
const DROP = [71, 85, 105];
const ALT = [146, 98, 52];

/** A fuel pump, 10 × 12 pt, its top left at (x, y). */
function fuelPump(doc, x, y, color) {
  doc.setFillColor(...color);
  doc.setDrawColor(...color);
  doc.rect(x, y + 1, 6.5, 11, 'F');                     // the body
  doc.setFillColor(255, 255, 255);
  doc.rect(x + 1.3, y + 2.6, 3.9, 3, 'F');              // its window
  doc.setLineWidth(0.9);
  doc.line(x + 6.5, y + 4, x + 8.8, y + 5.5);           // the hose
  doc.line(x + 8.8, y + 5.5, x + 8.8, y + 10);
  doc.line(x + 8.8, y + 10, x + 7.6, y + 11);
  doc.setLineWidth(0.4);
}

/** A drop, 8 × 12 pt, its top left at (x, y). */
function fuelDrop(doc, x, y, color) {
  doc.setFillColor(...color);
  doc.circle(x + 4, y + 8.2, 3.8, 'F');
  doc.triangle(x + 4, y + 0.5, x + 0.55, y + 6.6, x + 7.45, y + 6.6, 'F');
}

/**
 * One unit's page on `doc` (a jsPDF, points, A4 landscape). `events`: the fuel ledger's episodes
 * (lib/fuelEpisodes: refills, possible thefts, slosh, redistribution, drops), as the unit card's Fuel
 * chart shades them; without them (null), refills are read off the line.
 */
export function drawGraphPage(doc, { row, pings, events = null, from, to, fleet, logos = {}, reportNo = '', now = Date.now() }) {
  const t0 = dayStart(from);
  const t1 = Math.min(dayEnd(to), Math.max(now, t0 + 3_600_000));
  const series = fuelSeries(pings, { from: t0, to: t1 });
  const marks = (events ?? refillsIn(series).map((r) => ({ kind: 'refill', start: r.t - 60_000, end: r.t, litres: r.L })))
    .filter((e) => e.end >= t0 && e.start <= t1);
  const refills = marks.filter((e) => e.kind === 'refill');
  const runs = activityRuns(pings, { from: t0, to: t1 });

  // The letterhead
  doc.setFillColor(34, 34, 34);
  doc.rect(0, 0, W, BAND_H, 'F');
  if (logos.rai) doc.addImage(logos.rai, 'JPEG', M, 6, 36, 42);
  if (logos.ogc) doc.addImage(logos.ogc, 'PNG', W - M - 92, 13, 92, 28);
  let y = BAND_H + 26;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`FUEL GRAPH · ${row.plate ?? ''}`, M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUT);
  doc.text(`${reportNo ? `Report no. ${reportNo}  ·  ` : ''}Date ${dmy(now)}`, W - M, y, { align: 'right' });
  y += 6;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.line(M, y, W - M, y);
  y += 12;
  doc.setFontSize(8.5);
  doc.setTextColor(...MUT);
  doc.text(`${fleet}  ·  ${from === to ? dayWords(from) : `${dayWords(from)} – ${dayWords(to)}`}  ·  fuel in the tank, litres`, M, y);

  // The graph: three quarters of what is left above the footer
  const bottom = H - 30;
  const factsH = (bottom - y) / 4;
  const gx = M + 34;
  const gy = y + 10;
  const alt = altitudeSeries(pings, { from: t0, to: t1 });
  // Room on the right for the altitude's own scale, when there is one
  const gw = W - M - gx - (alt.length > 1 ? 34 : 0);
  // Room under the plot for the hours and the legend
  const gh = bottom - factsH - 30 - gy;
  const maxL = Math.max(50, ...series.map((p) => p.L)) * 1.12;
  const ys = ticks(maxL);
  const top = ys[ys.length - 1] || maxL;
  const X = (t) => gx + ((t - t0) / (t1 - t0)) * gw;
  const Y = (L) => gy + gh - (L / top) * gh;

  // What the unit was doing fills the graph behind the line (operator, 13 Nov 2026): driving,
  // idling, parked, each its own tint; no tint where there were no readings
  for (const r of runs) {
    const x0 = X(Math.max(r.start, t0));
    doc.setFillColor(...ACTIVITY[r.state].tint);
    doc.rect(x0, gy, Math.max(0.6, X(Math.min(r.end, t1)) - x0), gh, 'F');
  }
  doc.setLineWidth(0.4);
  doc.setFontSize(7);
  for (const v of ys) {
    doc.setDrawColor(...RULE);
    doc.line(gx, Y(v), gx + gw, Y(v));
    doc.setTextColor(...MUT);
    doc.text(`${v} L`, gx - 4, Y(v) + 2.4, { align: 'right' });
  }
  // Hours along the bottom, every 2 h on a day, every day's 00:00 on several
  const several = t1 - t0 > 36 * 3_600_000;
  const stepMs = several ? 6 * 3_600_000 : 2 * 3_600_000;
  for (let t = t0; t <= t1; t += stepMs) {
    doc.setDrawColor(...RULE);
    doc.line(X(t), gy, X(t), gy + gh);
    doc.setTextColor(...MUT);
    const label = several && clock(t) === '00:00' ? dmy(t).slice(0, 5) : clock(t);
    doc.text(label, X(t), gy + gh + 10, { align: 'center' });
  }
  doc.setDrawColor(...INK);
  doc.line(gx, gy + gh, gx + gw, gy + gh);
  // The altitude, thin and brown on its own scale at the right, under the fuel line
  if (alt.length > 1) {
    let lo = Math.min(...alt.map((p) => p.m));
    let hi = Math.max(...alt.map((p) => p.m));
    if (hi - lo < 50) { const mid = (hi + lo) / 2; lo = mid - 25; hi = mid + 25; }
    const pad = (hi - lo) * 0.08;
    lo = Math.floor((lo - pad) / 10) * 10;
    hi = Math.ceil((hi + pad) / 10) * 10;
    const A = (m) => gy + gh - ((m - lo) / (hi - lo)) * gh;
    doc.setFontSize(7);
    doc.setTextColor(...ALT);
    for (let k = 0; k <= 4; k++) {
      const m = Math.round(lo + ((hi - lo) * k) / 4);
      doc.text(`${m} m`, gx + gw + 4, A(m) + 2.4);
    }
    doc.setDrawColor(...ALT);
    doc.setLineWidth(0.7);
    for (let i = 1; i < alt.length; i++) {
      if (alt[i].t - alt[i - 1].t > 2 * 3_600_000) continue;
      doc.line(X(alt[i - 1].t), A(alt[i - 1].m), X(alt[i].t), A(alt[i].m));
    }
  }
  if (series.length > 1) {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(1.2);
    for (let i = 1; i < series.length; i++) {
      // A gap of more than 2 h without readings is left open, not bridged
      if (series[i].t - series[i - 1].t > 2 * 3_600_000) continue;
      doc.line(X(series[i - 1].t), Y(series[i - 1].L), X(series[i].t), Y(series[i].L));
    }
  } else {
    doc.setTextColor(...MUT);
    doc.setFontSize(10);
    doc.text('No fuel readings for these days.', gx + gw / 2, gy + gh / 2, { align: 'center' });
  }

  // Refills and drains on the line: a fuel pump with the litres put in, a drop with the litres lost
  const levelAt = (t) => {
    let best = null;
    for (const p of series) if (best == null || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return best?.L ?? 0;
  };
  for (const e of marks) {
    const up = e.kind === 'refill';
    if (!up && !LOSS_KINDS.has(e.kind)) continue;
    const t = Math.min(Math.max(e.end, t0), t1);
    const x = X(t);
    const yLine = Y(levelAt(t));
    const color = up ? PUMP : e.kind === 'theft' ? THEFT : DROP;
    // Above the line, or under it where the line runs near the top
    const iy = yLine - gy < 26 ? yLine + 6 : yLine - 20;
    (up ? fuelPump : fuelDrop)(doc, x - 5, iy, color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...color);
    const words = `${up ? '+' : '-'}${e.litres != null ? Math.round(e.litres) : '?'} L`;
    doc.text(words, x + 7, iy + 9);
    doc.setFont('helvetica', 'normal');
  }

  // The legend: what the tints and the icons mean
  let lx = gx;
  const ly = gy + gh + 22;
  doc.setFontSize(6.8);
  const swatch = (tint, label) => {
    doc.setFillColor(...tint);
    doc.setDrawColor(...RULE);
    doc.rect(lx, ly - 6, 10, 7, 'FD');
    doc.setTextColor(...MUT);
    doc.text(label, lx + 13, ly);
    lx += 13 + doc.getTextWidth(label) + 14;
  };
  for (const a of Object.values(ACTIVITY)) swatch(a.tint, a.label);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(1.2);
  doc.line(lx, ly - 2.5, lx + 12, ly - 2.5);
  doc.setTextColor(...MUT);
  doc.text('Fuel, litres', lx + 15, ly);
  lx += 15 + doc.getTextWidth('Fuel, litres') + 14;
  if (alt.length > 1) {
    doc.setDrawColor(...ALT);
    doc.setLineWidth(0.7);
    doc.line(lx, ly - 2.5, lx + 12, ly - 2.5);
    doc.text('Altitude, m (right)', lx + 15, ly);
    lx += 15 + doc.getTextWidth('Altitude, m (right)') + 14;
  }
  fuelPump(doc, lx, ly - 8, PUMP);
  doc.text('Refill, litres put in', lx + 13, ly);
  lx += 13 + doc.getTextWidth('Refill, litres put in') + 14;
  fuelDrop(doc, lx, ly - 8, THEFT);
  doc.text('Possible theft, litres lost', lx + 13, ly);
  lx += 13 + doc.getTextWidth('Possible theft, litres lost') + 14;
  fuelDrop(doc, lx, ly - 8, DROP);
  doc.text('Other drop, litres lost', lx + 13, ly);

  // The bottom quarter: the figures, in boxes of four across
  const facts = graphFacts(row, { from, to });
  const fy = bottom - factsH + 4;
  const across = 4;
  const rows = Math.ceil(facts.length / across);
  const cw = (W - 2 * M) / across;
  const ch = (factsH - 6) / rows;
  doc.setLineWidth(0.5);
  facts.forEach(([label, value], i) => {
    const cx = M + (i % across) * cw;
    const cy = fy + Math.floor(i / across) * ch;
    doc.setDrawColor(...RULE);
    doc.rect(cx, cy, cw, ch);
    doc.setFontSize(7);
    doc.setTextColor(...MUT);
    doc.setFont('helvetica', 'normal');
    doc.text(label, cx + 6, cy + 10);
    doc.setFontSize(10);
    doc.setTextColor(...(label === 'Against target' && value === 'Below target' ? [192, 0, 0] : INK));
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), cx + 6, cy + 23, { maxWidth: cw - 12 });
  });
  doc.setFont('helvetica', 'normal');

  // The footer
  doc.setDrawColor(...RULE);
  doc.line(M, H - 22, W - M, H - 22);
  doc.setFontSize(7);
  doc.setTextColor(...MUT);
  doc.text(`${fleet} · Fuel Graph Report · ${row.plate ?? ''}${refills.length ? ` · ${refills.length} refill${refills.length === 1 ? '' : 's'} marked` : ''}`, M, H - 12);
  return { readings: series.length, refills: refills.length };
}

/** The whole report: a page per unit, in the order given. `units`: [{ row, pings }]. */
export async function fuelGraphsPdf(units, { from, to, fleet, logos = {}, reportNo = '', now = Date.now() }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  units.forEach((u, i) => {
    if (i > 0) doc.addPage('a4', 'landscape');
    drawGraphPage(doc, { ...u, from, to, fleet, logos, reportNo, now });
    doc.setFontSize(7);
    doc.setTextColor(...MUT);
    doc.text(`Page ${i + 1} of ${units.length}`, W - M, H - 12, { align: 'right' });
  });
  return doc;
}
