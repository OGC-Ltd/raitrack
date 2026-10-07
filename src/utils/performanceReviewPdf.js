// Fuel performance review as a PDF, laid out after the operator's Kasulu
// "Fuel Issuance – Performance Review" (2026-10-08):
//
//   Page 1  title + period line, the headline sentence, four figure tiles,
//           WHERE THE FUEL GOES (litres a day by month · share by type),
//           IS FUEL BEING USED EFFICIENTLY? (above standard by type ·
//           record reliability), UNITS NEEDING ATTENTION | BENCHMARK
//           PERFORMERS, WHAT THIS MEANS.
//   Page 2+ EXHIBIT — each equipment type's units against the 100% line,
//           worst at the top, two charts a row, then the method note.
//
// Drawn with jsPDF primitives (rects and text), so the bars are vectors and
// the file stays small. Every figure and sentence comes from the review and
// lib/performanceReview — nothing is worked out here.

import { jsPDF } from "jspdf";
import { pct, litres, monthLabel, band, listRefs } from "../lib/performanceReview";

const C = {
  ink: "#1d1d1b", sub: "#5f6368", faint: "#9aa0a6", rule: "#d9dcd6",
  green: "#1e7a55", greenDeep: "#0d3d2b", red: "#b3261e", redBar: "#c0362c",
  amber: "#d4900a", grey: "#bdbdbd", tile: "#f3f4f2", tint: "#fdf3f2", tintGood: "#eef6f1",
};
const M = 36;           // page margin
const W = 595.28;       // A4 width, pt
const H = 841.89;

const fmtDay = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const BAND = { over: C.redBar, slight: C.amber, within: C.green, none: C.grey };

function text(doc, s, x, y, { size = 9, bold = false, color = C.ink, align = "left", maxWidth } = {}) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(color);
  doc.text(String(s), x, y, { align, ...(maxWidth ? { maxWidth } : {}) });
}

/** Wrapped paragraph; returns the y under it. `runs` may mix bold and plain. */
function para(doc, runs, x, y, width, { size = 8.6, color = C.ink, lead = 1.38, draw = true } = {}) {
  const parts = typeof runs === "string" ? [{ t: runs }] : runs;
  doc.setFontSize(size);
  const lineH = size * lead;
  let cx = x;
  let cy = y;
  for (const part of parts) {
    doc.setFont("helvetica", part.b ? "bold" : "normal");
    doc.setTextColor(part.c ?? color);
    for (const word of part.t.split(/(\s+)/)) {
      if (!word) continue;
      const w = doc.getTextWidth(word);
      if (/^\s+$/.test(word)) { if (cx > x) cx += w; continue; }
      if (cx + w > x + width && cx > x) { cx = x; cy += lineH; }
      if (draw) doc.text(word, cx, cy);
      cx += w;
    }
  }
  return cy + lineH;
}

function sectionHead(doc, label, y) {
  text(doc, label, M, y, { size: 10, bold: true, color: C.greenDeep });
  doc.setDrawColor(C.green); doc.setLineWidth(1);
  doc.line(M, y + 4, W - M, y + 4);
  return y + 18;
}

/** Horizontal bars inside [x, x+w]; label column `lw` wide. Returns y under. */
function hbars(doc, rows, x, y, w, { lw = 120, rowH = 13, format, title }) {
  if (title) { text(doc, title, x + w / 2, y, { size: 8.6, bold: true, align: "center" }); y += 12; }
  const max = Math.max(...rows.map((r) => r.value), 1);
  const bw = w - lw - 46;
  for (const r of rows) {
    text(doc, r.label, x + lw - 6, y + 8, { size: 7.6, color: C.sub, align: "right" });
    doc.setFillColor(r.color);
    doc.rect(x + lw, y + 1.5, Math.max(1, (r.value / max) * bw), rowH - 5, "F");
    text(doc, format(r.value), x + lw + (r.value / max) * bw + 4, y + 8, { size: 7.4, bold: true });
    y += rowH;
  }
  return y + 4;
}

function monthColumns(doc, months, x, y, w, h) {
  text(doc, "Average litres put in per day", x, y, { size: 8.6, bold: true });
  y += 10;
  const max = Math.max(...months.map((m) => m.perDay), 1);
  const gap = 14;
  const cw = (w - gap * (months.length - 1)) / Math.max(1, months.length);
  const base = y + h - 24;
  months.forEach((m, i) => {
    const bh = (m.perDay / max) * (h - 44);
    const cx = x + i * (cw + gap);
    doc.setFillColor(i === months.length - 1 ? C.greenDeep : C.green);
    doc.rect(cx, base - bh, cw, Math.max(1, bh), "F");
    text(doc, m.perDay ? `${(m.perDay / 1000).toFixed(1)}k` : "—", cx + cw / 2, base - bh - 4, { size: 8, bold: true, align: "center" });
    text(doc, monthLabel(m.month), cx + cw / 2, base + 10, { size: 8, color: C.sub, align: "center" });
    text(doc, `(${m.days} days)`, cx + cw / 2, base + 19, { size: 7, color: C.faint, align: "center" });
  });
  doc.setDrawColor(C.rule); doc.setLineWidth(0.6);
  doc.line(x, base, x + w, base);
  return y + h;
}

function tiles(doc, items, y) {
  const gap = 0;
  const tw = (W - 2 * M - gap * 3) / 4;
  doc.setFillColor(C.tile); doc.setDrawColor(C.rule);
  doc.rect(M, y, W - 2 * M, 54, "FD");
  items.forEach((it, i) => {
    const x = M + i * tw;
    if (i) { doc.setDrawColor(C.rule); doc.line(x, y + 8, x, y + 46); }
    text(doc, it.value, x + tw / 2, y + 22, { size: 15, bold: true, color: it.color ?? C.greenDeep, align: "center" });
    const lines = doc.setFontSize(7.2).splitTextToSize(it.label, tw - 16);
    lines.slice(0, 2).forEach((l, j) => text(doc, l, x + tw / 2, y + 34 + j * 8.5, { size: 7.2, color: C.sub, align: "center" }));
  });
  return y + 66;
}

/** Height a box needs for its items — the boxes are as tall as their content. */
function boxHeight(doc, items, w) {
  let cy = 28;
  for (const runs of items) cy = para(doc, runs, 16, cy, w - 24, { size: 7.8, draw: false }) + 1;
  return cy + 2;
}

function box(doc, title, color, tint, items, x, y, w, h) {
  doc.setFillColor(color); doc.rect(x, y, w, 16, "F");
  text(doc, title, x + 8, y + 11, { size: 8.4, bold: true, color: "#ffffff" });
  doc.setFillColor(tint); doc.setDrawColor(C.rule);
  doc.rect(x, y + 16, w, h - 16, "FD");
  let cy = y + 28;
  for (const runs of items) {
    doc.setFillColor(color); doc.rect(x + 8, cy - 5, 3.2, 3.2, "F");
    cy = para(doc, runs, x + 16, cy, w - 24, { size: 7.8 }) + 1;
  }
}

/** One exhibit chart: units sorted worst first, the 100% line dashed. */
const EX_ROW = 8.6;

/** Units that cannot be judged, as one line under the chart rather than a row each. */
function restRuns(units) {
  const rest = units.filter((u) => u.ratio == null);
  if (!rest.length) return null;
  return [{ t: `Not assessed (${rest.length}): `, b: true, c: C.sub },
          { t: rest.map((u) => `${u.ref}${u.rate == null ? " (no standard)" : ""}`).join(", "), c: C.sub }];
}

/** Height one exhibit block takes: title, bars, axis, the not-assessed line and the note. */
function exhibitHeight(doc, units, note, w, rowH = EX_ROW) {
  const n = units.filter((u) => u.ratio != null).length;
  let h = 14 + n * rowH + 16;
  const rest = restRuns(units);
  if (rest) h = para(doc, rest, 0, h + 4, w, { size: 6.6, draw: false });
  if (note) h = para(doc, note, 0, h + 2, w, { size: 7.4, draw: false });
  return h;
}

function exhibit(doc, group, units, busiestId, suspect, x, y, w, rowH = EX_ROW) {
  const rows = units.filter((u) => u.ratio != null).sort((a, b) => b.ratio - a.ratio);
  const assessed = rows;
  const best = assessed.at(-1);
  const lw = w < 200 ? 46 : 58;
  const pw = w - lw - (w < 200 ? 40 : 50);
  const scale = 2.5;
  text(doc, `${group} (${units.length} unit${units.length === 1 ? "" : "s"})`, x + w / 2, y, { size: 9, bold: true, align: "center" });
  y += 10;
  const top = y;
  const stdX = x + lw + pw / scale;
  text(doc, "Standard", stdX, y, { size: 6.4, color: C.sub, align: "center" });
  y += 4;
  // The standard line first, so the bars and their figures are drawn over it
  // and it passes behind a label instead of through it.
  doc.setDrawColor(C.sub); doc.setLineWidth(0.5); doc.setLineDashPattern([2, 2], 0);
  doc.line(stdX, top + 2, stdX, y + rows.length * rowH);
  doc.setLineDashPattern([], 0);
  rows.forEach((u) => {
    const ref = `${u.ref}${u.id === busiestId ? " *" : ""}`;
    text(doc, ref, x + lw - 4, y + rowH - 2.6, { size: 6.4, color: C.sub, align: "right" });
    if (u.ratio != null) {
      const bw = Math.min(u.ratio / scale, 1) * pw;
      doc.setFillColor(suspect ? C.grey : BAND[band(u)]);
      doc.rect(x + lw, y + 1.2, Math.max(1, bw), rowH - 2.4, "F");
      let label = pct(u.ratio);
      const narrow = w < 200;
      if (!suspect && assessed.length > 1 && u.id === assessed[0].id && u.ratio >= 1.1) label += narrow ? " worst" : "  < WORST";
      else if (!suspect && assessed.length > 1 && u.id === best?.id) label += narrow ? " best" : "  < BEST";
      doc.setFont("helvetica", /worst|best/i.test(label) ? "bold" : "normal").setFontSize(6.2);
      doc.setFillColor("#ffffff");
      doc.rect(x + lw + bw + 1.5, y + 1, doc.getTextWidth(label) + 3, rowH - 2, "F");
      text(doc, label, x + lw + bw + 3, y + rowH - 2.6, { size: 6.2, bold: /worst|best/i.test(label),
        color: /worst/i.test(label) ? C.red : /best/i.test(label) ? C.green : C.ink });
    }
    y += rowH;
  });
  // axis
  doc.setDrawColor(C.rule); doc.line(x + lw, y + 1, x + lw + pw, y + 1);
  (w < 200 ? [0, 1, 2] : [0, 0.5, 1, 1.5, 2, 2.5]).forEach((t) => text(doc, `${Math.round(t * 100)}%`, x + lw + (t / scale) * pw, y + 9, { size: 5.8, color: C.faint, align: "center" }));
  if (suspect) {
    text(doc, "Not assessable: standards look set too high", x + lw + pw * 0.55, top + 12, { size: 6.8, color: C.sub, align: "center" });
  }
  y += 16;
  const rest = restRuns(units);
  if (rest) y = para(doc, rest, x, y + 4, w, { size: 6.6 });
  return y;
}

function exhibitNote(group, read, review) {
  const g = review.groups.find((x) => x.group === group);
  const us = (read.byGroup.get(group) ?? []).filter((u) => u.ratio != null).sort((a, b) => b.ratio - a.ratio);
  if (!g) return "";
  if (read.suspectGroups.includes(group)) return `${group}: every unit reports far under standard (median ${pct(g.ratio)}). The standards look wrong and should be reset before these machines are judged.`;
  if (!us.length) return `${group}: no unit has a standard and enough refills to be judged.`;
  const over = us.filter((u) => u.status === "over");
  if (!over.length) return `${group}: every assessed unit is within 10% of standard; ${us.at(-1).ref} is the best at ${pct(us.at(-1).ratio)}.`;
  return `${group}: ${over.length} of ${us.length} ${over.length === 1 ? "is" : "are"} 10% or more over standard; ${listRefs(over.slice(0, 3))} ${over.length === 1 ? "is" : "are"} the worst (${pct(over[0].ratio)}${over.length > 1 ? `–${pct(over[Math.min(2, over.length - 1)].ratio)}` : ""}).`;
}

export function buildPerformanceReviewPdf({ review, read, orgName }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const t = review.totals;
  const p = read.pace;

  // ── Page 1 ────────────────────────────────────────────────────────────────
  let y = 44;
  text(doc, "FUEL PERFORMANCE REVIEW", M, y, { size: 19, bold: true, color: C.greenDeep });
  y += 15;
  text(doc, `${orgName ? `${orgName}  |  ` : ""}${fmtDay(review.from)} – ${fmtDay(review.to)}  |  ${t.refills.toLocaleString("en-KE")} refills to ${t.units} units  |  telemetry`,
       M, y, { size: 8.2, color: C.sub });
  y += 6;
  doc.setDrawColor(C.greenDeep); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 16;
  y = para(doc, [
    { t: `Fuel is going in at about ${litres(t.perMonth, { short: true })} a month${p?.change != null ? ` and ${p.change >= 0 ? "rising" : "falling"}` : ""}. Around ${litres(t.excessL, { short: true })} went in above the expected rate`, b: true },
    { t: read.attention.length ? `, and most of that gap traces back to a short list of named units.` : ".", b: true },
  ], M, y, W - 2 * M, { size: 10.2, color: C.greenDeep });
  y += 4;
  y = tiles(doc, [
    { value: litres(t.litres, { short: true }), label: `put in over ${review.days} days to ${t.units} units` },
    { value: `~${litres(t.perMonth, { short: true })}`, label: "a typical month (average a day × 30)" },
    { value: p?.change != null ? `${p.change >= 0 ? "+" : ""}${Math.round(p.change * 100)}%` : "—",
      label: p ? `${monthLabel(p.latest.month)} pace vs the full months before` : "pace needs two months", color: "#b9600b" },
    { value: litres(t.excessL, { short: true }), label: `above standard rates — ${(t.excessShare * 100).toFixed(1)}% of all fuel`, color: C.red },
  ], y);

  y = sectionHead(doc, "WHERE THE FUEL GOES", y);
  const colW = (W - 2 * M - 24) / 2;
  const yA = monthColumns(doc, review.months, M, y, colW * 0.82, 120);
  const shareRows = [
    ...read.topGroups.map((g) => ({ label: g.group, value: g.share, color: C.green })),
    ...(review.groups.length > 5 ? [{ label: "All other equipment", value: Math.max(0, 1 - read.topShare), color: C.grey }] : []),
  ];
  const yB = hbars(doc, shareRows, M + colW + 24, y, colW, { lw: 104, rowH: 14, format: (v) => `${(v * 100).toFixed(1)}%`, title: "Share of all fuel, by equipment type" });
  y = Math.max(yA, yB) + 6;
  const top = read.topGroups.slice(0, 2);
  y = para(doc, [
    { t: "A few equipment types dominate. ", b: true },
    { t: `${read.topGroups.length} types take ${(read.topShare * 100).toFixed(1)}% of the fuel; ${top.map((g) => `${g.group.toLowerCase()} (${litres(g.litres, { short: true })})`).join(" and ")} lead. ` },
    ...(read.biggest ? [{ t: `${read.biggest.ref} took ${litres(read.biggest.litres, { short: true })} on its own, ${((read.biggest.litres / t.litres) * 100).toFixed(1)}% of the total.` }] : []),
  ], M, y, W - 2 * M);
  y += 4;

  y = sectionHead(doc, "IS FUEL BEING USED EFFICIENTLY?", y);
  const excessRows = [...review.groups].filter((g) => g.excessL > 0).sort((a, b) => b.excessL - a.excessL).slice(0, 5)
    .map((g) => ({ label: g.group, value: g.excessL, color: C.redBar }));
  const total = Math.max(1, read.recordsTotal);
  const relRows = [
    { label: "Plausible, at or near standard", value: review.records.near, color: C.green },
    { label: "Plausible, well over standard", value: review.records.over, color: C.redBar },
    { label: "Implausible — needs checking", value: review.records.implausible, color: C.amber },
    { label: "Hours, km or standard missing", value: review.records.missing, color: C.grey },
  ];
  const yC = hbars(doc, excessRows, M, y, colW, { lw: 96, rowH: 14, format: (v) => litres(v, { short: true }), title: "Litres above standard, by equipment type" });
  const yD = hbars(doc, relRows, M + colW + 24, y, colW, { lw: 128, rowH: 14, format: (v) => `${Math.round((v / total) * 100)}%`, title: `How reliable are the ${read.recordsTotal.toLocaleString("en-KE")} refill records?` });
  y = Math.max(yC, yD) + 4;
  if (read.worstGroup && read.worstGroup.excessL > 0) {
    const g = read.worstGroup;
    y = para(doc, [
      { t: `${g.group} are the biggest problem. `, b: true },
      { t: `${g.overCount} of ${g.assessed} assessed are at least 10% over standard, accounting for ${litres(g.excessL, { short: true })} of excess (typical unit ${pct(g.ratio)}).` },
      ...(g.overCount >= 3 ? [{ t: " As the gap is group-wide, likely causes are operational (idling, overloading, haul roads) rather than individual drivers." }] : []),
    ], M, y, W - 2 * M);
  }
  if (read.reliableShare != null) {
    y = para(doc, [
      { t: "Not every record can be relied on. ", b: true },
      { t: `${Math.round(read.reliableShare * 100)}% of refills are complete and plausible; the rest show likely tracker gaps or have no hours, km or standard.` },
    ], M, y, W - 2 * M);
  }
  y += 6;

  // Attention / benchmarks
  const attention = read.attention.slice(0, 6).map((u) => [
    { t: `${u.ref} `, b: true }, { t: `(${u.group.replace(/s$/, "").toLowerCase()}): ${pct(u.ratio)} of standard over ${u.usableRefills} refills, ${litres(u.excessL)} above.` },
  ]);
  if (read.meterFixes.length) attention.push([{ t: "Readings to check: ", b: true }, { t: `${listRefs(read.meterFixes.slice(0, 6))} — refills logged against next to no hours or km.` }]);
  // As many benchmark groups as there are attention lines, so the two boxes
  // come out about the same height.
  const bench = read.benchmarks.slice(0, Math.max(5, Math.min(8, Math.min(6, read.attention.length) + (read.meterFixes.length ? 2 : 0)))).map((b) => [
    { t: `${b.group}: `, b: true },
    { t: b.units.map((u) => `${u.ref} (${pct(u.ratio)})${u.id === b.busiestId ? ", the busiest" : ""}`).join(" and ") + "." },
  ]);
  const attItems = attention.length ? attention : [[{ t: "No unit is 10% or more over standard." }]];
  const benchItems = bench.length ? bench : [[{ t: "No unit is within standard yet." }]];
  const bh = Math.max(boxHeight(doc, attItems, colW + 12), boxHeight(doc, benchItems, colW + 12));
  if (y + bh > H - 120) { doc.addPage(); y = 44; }
  box(doc, "UNITS NEEDING ATTENTION", C.red, C.tint, attItems, M, y, colW + 12, bh);
  box(doc, "BENCHMARK PERFORMERS", C.green, C.tintGood, benchItems, M + colW + 12, y, colW + 12, bh);
  y += bh + 10;

  if (read.actions.length) {
    const startY = y;
    let cy = y + 14;
    text(doc, "WHAT THIS MEANS", M + 10, cy, { size: 8.6, bold: true, color: C.green });
    cy += 12;
    cy = para(doc, [{ t: `About ${litres(read.excessPerMonth, { short: true })} a month goes in above standard, mostly to the units above. ` }, { t: "Recommended actions:", b: true }], M + 10, cy, W - 2 * M - 20, { size: 8.2 });
    read.actions.forEach((a, i) => { cy = para(doc, [{ t: `${i + 1}. `, b: true }, { t: a }], M + 10, cy, W - 2 * M - 20, { size: 8.2 }); });
    doc.setFillColor(C.green); doc.rect(M, startY, 3, cy - startY, "F");
    y = cy;
  }

  // ── Exhibit pages ─────────────────────────────────────────────────────────
  // The exhibit follows straight on when page 1 has room for its heading and
  // a chart, rather than leaving the foot of the page blank.
  if (y + 220 > H - 40) { doc.addPage(); y = 44; } else { y += 18; }
  text(doc, "EXHIBIT — HOW EACH UNIT COMPARES WITH ITS STANDARD", M, y, { size: 13, bold: true, color: C.greenDeep });
  y += 13;
  y = para(doc, "Each bar shows a unit's typical refill as a percentage of its standard rate. 100% = on standard; higher is worse. The worst unit sits at the top of each chart. Units with at least 5 usable refills (3 for CASE tractors). * = largest fuel user in its group.",
           M, y, W - 2 * M, { size: 7.8, color: C.sub });
  // legend
  let lx = M;
  [["10% or more above standard", C.redBar], ["Up to 10% above standard", C.amber], ["Within standard", C.green], ["Cannot be assessed", C.grey]].forEach(([l, c]) => {
    doc.setFillColor(c); doc.rect(lx, y - 1, 9, 9, "F");
    text(doc, l, lx + 13, y + 6.5, { size: 7.4 });
    lx += 26 + doc.setFontSize(7.4).getTextWidth(l);
  });
  y += 20;

  const groups = review.groups.filter((g) => (read.byGroup.get(g.group) ?? []).length);
  // Packed columns: each chart goes under whichever column is shortest, and
  // a chart too tall for what is left of the page gives way to the next one
  // that fits. Two columns or three — whichever needs fewer pages — and then
  // the tallest bar rows (within a readable cap) that keep that page count,
  // so the last page is filled rather than left half blank.
  const bottom = H - 34;
  const GAP = 16;
  const items = groups.map((g) => ({ g, units: read.byGroup.get(g.group), note: exhibitNote(g.group, read, review) }));
  const plan = (rowH, n) => {
    const cw = (W - 2 * M - GAP * (n - 1)) / n;
    const queue = items.map((it) => ({ ...it, need: exhibitHeight(doc, it.units, it.note, cw, rowH) }));
    const placed = [];
    let page = 0;
    let cols = Array(n).fill(y);
    while (queue.length) {
      let pick = -1;
      let j = 0;
      const order = cols.map((v, k) => k).sort((p, q) => cols[p] - cols[q]);
      for (let i = 0; i < queue.length && pick < 0; i++) {
        const c = order.find((k) => cols[k] + queue[i].need <= bottom);
        if (c != null) { pick = i; j = c; }
      }
      if (pick < 0) { page++; cols = Array(n).fill(44); pick = 0; j = 0; }
      const [q] = queue.splice(pick, 1);
      placed.push({ ...q, page, j, y: cols[j] });
      cols[j] += q.need + 14;
    }
    // How full the last page is: its tallest column against the page.
    const last = placed.filter((p) => p.page === page);
    const fill = Math.max(...last.map((p) => p.y + p.need)) ;
    return { placed, pages: page + 1, cw, n, fill };
  };
  const MIN_ROW = 7.6;
  const MAX_ROW = 10.4;
  const two = plan(MIN_ROW, 2);
  const three = plan(MIN_ROW, 3);
  const n = three.pages < two.pages ? 3 : 2;
  let rowH = MIN_ROW;
  let best = n === 3 ? three : two;
  for (let r = MIN_ROW + 0.2; r <= MAX_ROW + 1e-9; r += 0.2) {
    const tryPlan = plan(r, n);
    if (tryPlan.pages > best.pages) break;
    rowH = r;
    best = tryPlan;
  }
  const cw = best.cw;
  let page = 0;
  for (const it of best.placed) {
    while (page < it.page) { doc.addPage(); page++; }
    const busiest = [...it.units].sort((a, b) => b.litres - a.litres)[0]?.id;
    const x = M + it.j * (cw + GAP);
    const by = exhibit(doc, it.g.group, it.units, busiest, read.suspectGroups.includes(it.g.group), x, it.y, cw, rowH);
    para(doc, it.note, x, by + 2, cw, { size: 7.4, color: C.ink });
  }


  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    text(doc, `Fuel performance review · page ${i} of ${pages}`, W - M, H - 20, { size: 6.8, color: C.faint, align: "right" });
  }
  doc.save(`fuel-performance-review-${review.from}-${review.to}.pdf`);
}
