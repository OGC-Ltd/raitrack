/**
 * Monthly Fleet Report as a document: five A4 landscape pages of HTML with
 * plain SVG charts, from lib/monthlyReport's figures. The screen shows it in a
 * frame and the PDF is drawn from the same HTML (api/letterheadPdf), so the
 * preview and the download cannot differ.
 *
 * Pure: figures in, HTML out.
 */

import { esc } from './letterhead';
import { reportNumber, CONTACT_LINE } from './reportLetterhead';

// ── Colours (the brief: corporate, restrained; nothing else) ───────────────

export const C = {
  ink: '#111', mut: '#5f5f5f', rule: '#c8c8c8',
  navy: '#1f3a56', gold: '#c8963e', grey: '#9aa3ab',
  tints: ['#c9d6e3', '#8fa9c2', '#5a7c9e', '#1f3a56'],
  fav: '#1e6b3a', adv: '#a33030',
};

// ── Numbers ─────────────────────────────────────────────────────────────────

export const n0 = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-GB') : '–');
export const n1 = (x) => (Number.isFinite(x) ? x.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
export const n2 = (x) => (Number.isFinite(x) ? x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
export const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');

/** An axis top a little over the largest value, on a round step: [top, step]. */
export function niceScale(max, ticks = 4) {
  if (!(max > 0)) return [1, 0.25];
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return [Math.ceil(max / step) * step, step];
}

// ── Icons: Tabler's line style, inline so the PDF needs no font ─────────────

const ICONS = {
  truck: '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5"/>',
  road: '<path d="M4 19l4 -14"/><path d="M16 5l4 14"/><path d="M12 8v-2"/><path d="M12 13v-2"/><path d="M12 18v-2"/>',
  shield: '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M12 11v2"/><path d="M12 17v.01"/>',
  drop: '<path d="M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546z"/>',
  box: '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/>',
  gauge: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M13.41 10.59l2.59 -2.59"/><path d="M7 12a5 5 0 0 1 5 -5"/>',
  moon: '<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>',
  wheel: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M12 14l0 7"/><path d="M10 12l-6.75 -2"/><path d="M14 12l6.75 -2"/>',
  pin: '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"/>',
  clock: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>',
  sun: '<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/>',
  pump: '<path d="M14 11h1a2 2 0 0 1 2 2v3a1.5 1.5 0 0 0 3 0v-7l-3 -3"/><path d="M4 20v-14a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v14"/><path d="M3 20l12 0"/><path d="M18 7v1a1 1 0 0 0 1 1h1"/><path d="M4 11l10 0"/>',
  warning: '<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/>',
  nosignal: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 5.17 -2.69"/><path d="M19 13a10 10 0 0 0 -2.007 -1.523"/><path d="M12 20h.01"/>',
  bell: '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>',
  bars: '<path d="M6 18l0 -3"/><path d="M10 18l0 -6"/><path d="M14 18l0 -9"/><path d="M18 18l0 -12"/>',
};

export const icon = (name, size = 16, colour = 'currentColor') =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

// ── Charts: one scale each, from zero, values on the bars ──────────────────

/**
 * Horizontal bars, one series: [{ label, value, text? }]. Width and height in px
 * of the SVG's own box (it scales to its column).
 */
export function hbars(items, { width = 520, row = 18, labelW = 130, valueW = 46, colour = C.navy, fmt = n0, size = 9 } = {}) {
  const list = items.filter((x) => x.value != null);
  if (!list.length) return '<p class="none">Nothing recorded.</p>';
  const max = Math.max(...list.map((x) => x.value), 0) || 1;
  const barW = width - labelW - valueW - 8;
  const h = list.length * row;
  const rows = list.map((x, i) => {
    const y = i * row;
    const w = Math.max(x.value > 0 ? 1.5 : 0, (x.value / max) * barW);
    return `<text x="${labelW - 6}" y="${y + row / 2 + 3}" text-anchor="end" font-size="${size}" fill="${C.ink}">${esc(x.label)}</text>`
      + `<rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="${row - 6}" fill="${colour}"/>`
      + `<text x="${labelW + w + 5}" y="${y + row / 2 + 3}" font-size="${size}" font-weight="700" fill="${C.ink}">${esc(x.text ?? fmt(x.value))}</text>`;
  }).join('');
  return `<svg class="ch" viewBox="0 0 ${width} ${h}" width="100%" preserveAspectRatio="xMinYMin meet">${rows}</svg>`;
}

/**
 * Vertical bars over a few columns, one or two stacked parts: cols [{ label, parts: [v, v2?] }].
 * `legend`: names for the parts, shown where there are two.
 */
export function vbars(cols, { width = 220, height = 120, colours = [C.navy, C.gold], fmt = n0, legend = null, size = 8 } = {}) {
  const totals = cols.map((c) => c.parts.reduce((s, v) => s + (v || 0), 0));
  const [top, step] = niceScale(Math.max(...totals, 0));
  const left = 34; const bottom = 16; const topPad = 12;
  const plotH = height - bottom - topPad; const plotW = width - left - 4;
  const slot = plotW / cols.length; const bw = Math.min(26, slot * 0.6);
  const y = (v) => topPad + plotH - (v / top) * plotH;
  let out = '';
  for (let t = 0; t <= top + 1e-9; t += step) {
    out += `<text x="${left - 5}" y="${y(t) + 3}" text-anchor="end" font-size="${size - 1}" fill="${C.mut}">${esc(fmt(t))}</text>`
      + `<line x1="${left}" x2="${width - 4}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.mut : '#e6e6e6'}" stroke-width="${t === 0 ? 0.8 : 0.5}"/>`;
  }
  cols.forEach((c, i) => {
    const x = left + slot * i + (slot - bw) / 2;
    let base = 0;
    c.parts.forEach((v, k) => {
      if (!(v > 0)) return;
      out += `<rect x="${x.toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" fill="${colours[k]}"/>`;
      base += v;
    });
    out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y(totals[i]) - 3).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${C.ink}">${esc(c.text ?? fmt(totals[i]))}</text>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="${size - 1}" fill="${C.mut}">${esc(c.label)}</text>`;
  });
  const key = legend && legend.length > 1
    ? `<div class="legend">${legend.map((l, k) => `<span><i style="background:${colours[k]}"></i>${esc(l)}</span>`).join('')}</div>` : '';
  return `<svg class="ch" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMinYMin meet">${out}</svg>${key}`;
}

// ── Page parts ──────────────────────────────────────────────────────────────

/** A card: navy, white text, a line icon in a faint circle. `vs`: last month's variance, from the second month. */
function card({ label, value, sub, icon: ic, vs }) {
  return `<div class="card"><div class="card-ic">${icon(ic, 18, '#fff')}</div>
    <div class="card-l">${esc(label)}</div><div class="card-v">${value}</div>
    <div class="card-s">${esc(sub ?? '')}${vs ? ` ${varianceTag(vs)}` : ''}</div></div>`;
}

/** Last month's figure and the change, a decrease in brackets, F or A. */
export function varianceTag(v, fmt = n0) {
  if (!v || v.change == null) return '';
  const ch = v.change < 0 ? `(${fmt(-v.change)})` : fmt(v.change);
  const mark = v.good == null ? '' : `<b class="fa ${v.good ? 'f' : 'a'}">${v.good ? 'F' : 'A'}</b>`;
  return `<span class="vs">last month ${fmt(v.before)} · ${ch}${mark}</span>`;
}

const head = (title, note = '', ic = null) =>
  `<div class="bh"><h2>${ic ? icon(ic, 15, C.navy) : ''}${esc(title)}</h2>${note ? `<span>${esc(note)}</span>` : ''}</div>`;

const CSS = `
@page { size: A4 landscape; margin: 0 }
* { box-sizing:border-box; margin:0; padding:0 }
html, body { background:#fff; color:${C.ink}; font-family:Carlito, Calibri, "Segoe UI", Arial, sans-serif; font-size:8.6pt; line-height:1.3;
  font-variant-numeric: tabular-nums; -webkit-print-color-adjust:exact; print-color-adjust:exact }
@media screen { html { background:#8a8f96 } body { padding:18px 0 } .page { margin:0 auto 18px; box-shadow:0 2px 18px rgba(0,0,0,.35) } }
.page { width:297mm; height:210mm; display:flex; flex-direction:column; overflow:hidden; background:#fff; position:relative }
.lh { background:#212121; height:17mm; display:flex; align-items:center; justify-content:space-between; padding:0 12mm; flex:none; border-bottom:1.2mm solid #b5b5b5 }
.lh .rai { height:12.5mm } .lh .ogc { height:7.5mm; opacity:.85 }
.lh .sec { color:#e8e8e8; font-family:Lora, Georgia, serif; font-size:11pt; letter-spacing:.08em; text-transform:uppercase }
.body { padding:5mm 13mm 0; flex:1; min-height:0; overflow:hidden }
.top { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:3.5mm }
.top .kick { font-size:7.6pt; letter-spacing:.14em; text-transform:uppercase; color:${C.mut}; font-weight:700 }
.top h1 { font-family:Lora, Georgia, serif; font-weight:400; font-size:24pt; line-height:1.1 }
.facts { display:flex; gap:9mm } .facts div { font-size:8pt } .facts span { display:block; font-size:6.6pt; letter-spacing:.1em; text-transform:uppercase; color:${C.mut} }
.cards { display:grid; grid-template-columns:repeat(var(--n, 5), 1fr); gap:3.5mm; margin-bottom:4mm }
.card { background:${C.navy}; color:#fff; border-radius:1.2mm; padding:2.6mm 3.4mm 2.8mm; position:relative; min-height:22mm }
.card-ic { position:absolute; right:3mm; top:2.6mm; width:9mm; height:9mm; border-radius:50%; background:rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center }
.card-l { font-size:6.8pt; letter-spacing:.1em; text-transform:uppercase; opacity:.9 }
.card-v { font-family:Lora, Georgia, serif; font-size:17pt; margin:1mm 0 .6mm; white-space:nowrap }
.card-s { font-size:7pt; opacity:.92 }
.cols { display:grid; grid-template-columns:1.45fr 1fr; gap:9mm }
.bh { display:flex; justify-content:space-between; align-items:baseline; border-bottom:.7pt solid ${C.ink}; padding-bottom:1mm; margin:0 0 2.2mm }
.bh h2 { font-family:Lora, Georgia, serif; font-weight:400; font-size:12.5pt; display:flex; align-items:center; gap:1.6mm }
.bh span { font-size:7pt; color:${C.mut} }
.blk { margin-bottom:4mm }
.trio { display:grid; grid-template-columns:repeat(3, 1fr); gap:5mm }
.trio h3 { font-size:7.6pt; font-weight:700; margin-bottom:1mm }
.note { font-size:6.8pt; color:${C.mut}; margin-top:1.2mm }
.none { color:${C.mut}; font-style:italic; padding:1mm 0 }
ol.pts { padding-left:4.2mm } ol.pts li { margin-bottom:1.6mm; font-size:8.4pt }
.legend { display:flex; gap:4mm; font-size:7pt; margin-top:.8mm } .legend i { display:inline-block; width:2.6mm; height:2.6mm; margin-right:1.2mm; vertical-align:-.3mm }
.vs { opacity:.92 } .fa { display:inline-block; font-size:6pt; color:#fff; border-radius:.6mm; padding:0 .8mm; margin-left:1mm }
.fa.f { background:${C.fav} } .fa.a { background:${C.adv} }
.ic { flex:none }
.foot { display:flex; justify-content:space-between; color:${C.mut}; font-size:7pt; padding:2mm 13mm 3.5mm; border-top:.6pt solid ${C.rule}; flex:none }
`;

function page({ section, body, n, total, ctx }) {
  return `<div class="page">
<div class="lh"><img class="rai" src="${ctx.logos.rai}" alt="RAI Group"><span class="sec">${esc(section)}</span><img class="ogc" src="${ctx.logos.ogc}" alt="OGC Monitoring"></div>
<div class="body">${body}</div>
<div class="foot"><span>${esc(ctx.companyName)} · ${esc(ctx.reportNo)}</span><span>${esc(CONTACT_LINE)}</span><span>Page ${n} of ${total}</span></div>
</div>`;
}

const dayWords = (rep) => {
  const p = rep.period;
  const last = Math.round((p.to - p.from) / 86_400_000);
  return `1 – ${last} ${p.label}${p.complete ? '' : ' (to date)'}`;
};

// ── Page 1: Overview ────────────────────────────────────────────────────────

export function pageOverview(rep, ctx) {
  const c = rep.cards;
  const v = rep.variance?.cards;
  const ops = (c.ops ?? []).slice(0, 2);
  const cards = [
    card({ label: 'Units monitored', value: n0(c.units), sub: `${rep.groups.length} fleet group${rep.groups.length === 1 ? '' : 's'} · ${n0(c.moved)} moved`, icon: 'truck', vs: v?.units }),
    card({ label: 'Distance', value: `${n0(c.km)} km`, sub: c.kmPerUnitDay != null ? `${n0(c.kmPerUnitDay)} km per active unit a day` : 'No unit moved', icon: 'road', vs: v?.km }),
    card({ label: 'Policy breaches', value: n0(c.breaches), sub: c.per1000 != null ? `${n2(c.per1000)} per 1,000 km` : 'Too little distance for a rate', icon: 'shield', vs: v?.breaches }),
    ...ops.map((o) => card({ label: o.label, value: o.value == null ? '–' : n0(o.value), sub: o.sub, icon: o.icon, vs: v?.ops?.[o.key] })),
  ].join('');

  const weeks = rep.weekly;
  const lastNote = `${rep.first ? 'first month: weeks compared with each other' : 'against last month on page 2'} · last week has ${weeks[3].days} days`;
  const breachBars = hbars(rep.breachesByGroup.map((g) => ({ label: g.label, value: g.value })), { width: 560, row: 17, labelW: 120 });
  const rateBars = hbars(rep.rateByGroup.filter((g) => g.value != null).sort((a, b) => b.value - a.value)
    .map((g) => ({ label: g.label, value: g.value })), { width: 400, row: 17, labelW: 120, fmt: n2 });
  const trio = `<div class="trio">
    <div><h3>Breaches per 1,000 km</h3>${vbars(weeks.map((w) => ({ label: w.label, parts: [w.per1000 ?? 0], text: w.per1000 == null ? '–' : n2(w.per1000) })), { fmt: n1 })}</div>
    <div><h3>Distance driven, km</h3>${vbars(weeks.map((w) => ({ label: w.label, parts: [w.km] })))}</div>
    <div><h3>Fuel lost, L</h3>${vbars(weeks.map((w) => ({ label: w.label, parts: [w.confirmedL, w.suspectedL] })), { legend: ['Theft', 'Suspected'] })}</div>
  </div>`;

  const body = `
<div class="top">
  <div><div class="kick">Monthly fleet report</div><h1>${esc(rep.period.label)}</h1></div>
  <div class="facts">
    <div><span>Organisation</span>${esc(ctx.companyName)}</div>
    <div><span>Period</span>${esc(dayWords(rep))}</div>
    <div><span>Fleet groups</span>as on the map's Fleets filter</div>
    <div><span>Reference</span>${esc(ctx.reportNo)}</div>
  </div>
</div>
<div class="cards" style="--n:${3 + ops.length}">${cards}</div>
<div class="cols">
  <div>
    <div class="blk">${head('Policy breaches by fleet group', "the groups on the map's Fleets filter")}${breachBars}
      <p class="note">Over-speeding, harsh driving, night driving and dashcam alerts${rep.allGroups.passengers ? ', and unauthorised passengers' : ''}. Each group's breakdown by type is on page 2.</p></div>
    <div class="blk">${head('The month week by week', lastNote)}${trio}</div>
  </div>
  <div>
    <div class="blk">${head('Summary')}<ol class="pts">${rep.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
    <div class="blk">${head('For management attention')}<ol class="pts">${rep.attention.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
    <div class="blk">${head('Breaches per 1,000 km, by group')}${rateBars}</div>
  </div>
</div>`;
  return page({ section: 'Overview', body, n: 1, total: ctx.total, ctx });
}

// ── The document ────────────────────────────────────────────────────────────

/** Every page built so far, as one HTML document (the PDF and the preview). */
export function monthlyReportHtml(rep, { companyName, orgCode, logos, now = Date.now() }) {
  const ctx = { companyName, logos, reportNo: reportNumber('MR', orgCode, now), total: 5 };
  const pages = [pageOverview(rep, ctx)];
  return {
    reportNo: ctx.reportNo,
    filename: `Monthly-Fleet-Report-${String(orgCode ?? 'fleet').toUpperCase()}-${rep.period.key}.pdf`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Monthly Fleet Report ${esc(companyName)} ${esc(rep.period.label)}</title><style>${CSS}</style></head><body>${pages.join('\n')}</body></html>`,
  };
}
