// The trip report as a printable page: one A4 sheet on the RAI Group / OGC
// letterhead, light or dark. Takes the data lib/tripReport builds and returns
// a complete HTML document; api/tripReport opens it in a window where it is
// printed or saved as PDF by the browser. The layout is the one signed off on
// 28 Oct 2026 (plain document style, numbered sections, ruled tables).

import { BREACH_KINDS } from './tripReport';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TZ = 'Africa/Nairobi';
const fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDayHM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

const dash = '–';
const num = (v, dp = 0) => (v == null || !Number.isFinite(v) ? dash : v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export function dur(ms) {
  if (ms == null || !Number.isFinite(ms)) return dash;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}
const coords = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : dash);
const place = (x) => esc(x.place ?? coords(x.lat, x.lng));

/** The track drawn to scale in its own box: no base map, nothing invented. */
function routeSvg(r) {
  const W = 300, H = 150, PAD = 14;
  const pts = r.track;
  const extra = [r.yard, r.dest].filter(Boolean).map((p) => [p.lat, p.lng]);
  const all = [...pts, ...extra];
  if (pts.length < 2) {
    return `<svg class="map" viewBox="0 0 ${W} ${H}"><text x="${W / 2}" y="${H / 2}" class="tw" text-anchor="middle">No positions recorded for this trip</text></svg>`;
  }
  const lat0 = all.reduce((a, p) => a + p[0], 0) / all.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p[1] * kx), ys = all.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, (maxY - minY) * ((W - 2 * PAD) / (H - 2 * PAD)), 1e-4);
  const s = (W - 2 * PAD) / span;
  const ox = PAD + ((W - 2 * PAD) - (maxX - minX) * s) / 2;
  const oy = PAD + ((H - 2 * PAD) - (maxY - minY) * s) / 2;
  const P = ([lat, lng]) => [ox + (lng * kx - minX) * s, oy + (maxY - lat) * s];
  const line = pts.map((p) => P(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  // Scale bar: a round number of km near a quarter of the width.
  const kmPerPx = 111.32 / s;
  const target = kmPerPx * (W / 4);
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((k) => k >= target * 0.6) ?? 200;
  const barPx = nice / kmPerPx;
  const [ax, ay] = P(pts[0]);
  const [bx, by] = P(pts[pts.length - 1]);
  const stops = r.stops.filter((x) => x.lat != null).map((x) => {
    const [x0, y0] = P([x.lat, x.lng]);
    return `<circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="4.6" class="st${x.flag ? ' fl' : ''}"/><text x="${x0.toFixed(1)}" y="${(y0 + 2).toFixed(1)}" class="sn" text-anchor="middle">${x.n}</text>`;
  }).join('');
  const dest = r.dest ? (() => { const [dx, dy] = P([r.dest.lat, r.dest.lng]); return `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="7" class="dz"/>`; })() : '';
  return `<svg class="map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${dest}<polyline points="${line}" class="rt"/>${stops}
    <rect x="${(ax - 5).toFixed(1)}" y="${(ay - 5).toFixed(1)}" width="10" height="10" class="se"/><text x="${ax.toFixed(1)}" y="${(ay + 2.2).toFixed(1)}" class="sn" text-anchor="middle">A</text>
    <rect x="${(bx - 5).toFixed(1)}" y="${(by - 5).toFixed(1)}" width="10" height="10" class="se b"/><text x="${bx.toFixed(1)}" y="${(by + 2.2).toFixed(1)}" class="sn" text-anchor="middle">B</text>
    <line x1="${W - PAD - barPx}" x2="${W - PAD}" y1="${H - 6}" y2="${H - 6}" class="sb"/><text x="${W - PAD}" y="${H - 9}" class="tw" text-anchor="end">${nice} km</text>
    <path d="M${PAD} ${PAD + 10} L${PAD + 3} ${PAD + 2} L${PAD + 6} ${PAD + 10}" class="na"/><text x="${PAD + 3}" y="${PAD - 1}" class="tw" text-anchor="middle">N</text>
  </svg>`;
}

function fuelSvg(f, w) {
  const W = 260, H = 70, pl = 26, pr = 6, pt = 5, pb = 12;
  const pts = f.series;
  if (pts.length < 2) return '';
  const vals = pts.map((p) => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(5, (hi - lo) * 0.12); lo = Math.max(0, lo - pad); hi += pad;
  const X = (t) => pl + ((t - w.from) / Math.max(1, w.to - w.from)) * (W - pl - pr);
  const Y = (v) => pt + ((hi - v) / (hi - lo)) * (H - pt - pb);
  const line = pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const ticks = [lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.8].map((v) => Math.round(v / 5) * 5);
  const grid = ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/><text x="${pl - 3}" y="${(Y(v) + 2.5).toFixed(1)}" class="ax" text-anchor="end">${v}</text>`).join('');
  const multi = dayOf.format(w.from) !== dayOf.format(w.to);
  const fmt = multi ? fmtDayHM : fmtHM;
  const tk = [0, 0.5, 1].map((k) => {
    const t = w.from + (w.to - w.from) * k;
    return `<text x="${X(t).toFixed(1)}" y="${H - 2}" class="ax" text-anchor="${k === 0 ? 'start' : k === 1 ? 'end' : 'middle'}">${fmt.format(t)}</text>`;
  }).join('');
  const marks = f.rows.filter((r) => r.kind === 'drain').map((r) => {
    const near = pts.reduce((b, p) => (Math.abs(p[0] - r.t) < Math.abs(b[0] - r.t) ? p : b), pts[0]);
    return `<circle cx="${X(r.t).toFixed(1)}" cy="${Y(near[1]).toFixed(1)}" r="2" class="fd"/>`;
  }).join('');
  return `<div class="sub">Fuel level (litres)</div><svg class="chart" viewBox="0 0 ${W} ${H}">${grid}<line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="axl"/><polyline points="${line}" class="fl"/>${marks}${tk}</svg>`;
}

const CSS = `
@page { size: A4; margin: 0 }
:root { --bg:#fff; --ink:#1c1c1c; --mut:#5c5c5c; --rule:#bfbfbf; --soft:#e6e6e6; --shade:#f3f3f3; --hd:#1f3a5f;
  --flag:#b42318; --route:#1f3a5f; --dz:#e4edf3; --st:#1c1c1c; --stt:#fff }
html[data-theme=dark] { --bg:#1a1c1f; --ink:#e4e4e4; --mut:#a3a3a3; --rule:#4a4d52; --soft:#33363a; --shade:#232629; --hd:#a9c1dd;
  --flag:#f07a6e; --route:#8fb3dc; --dz:#24313b; --st:#e4e4e4; --stt:#1a1c1f }
* { box-sizing:border-box; margin:0; padding:0 }
html, body { background:var(--bg); color:var(--ink); font-family:Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size:8.6pt; line-height:1.28;
  -webkit-print-color-adjust:exact; print-color-adjust:exact }
@media screen { html { background:#8a8f96 } body { background:transparent; padding:56px 0 24px } .page { margin:0 auto; box-shadow:0 2px 18px rgba(0,0,0,.35) } }
.page { width:210mm; height:297mm; display:flex; flex-direction:column; overflow:hidden; background:var(--bg) }
.lh { background:#212121; height:21mm; display:flex; align-items:center; justify-content:space-between; padding:0 12mm; flex:none }
.lh .rai { height:15.5mm } .lh .ogc { height:9.5mm; opacity:.78 }
.body { padding:5mm 13mm 0; flex:1; display:flex; flex-direction:column; min-height:0 }
.title { display:flex; justify-content:space-between; align-items:baseline; border-bottom:1.2pt solid var(--ink); padding-bottom:1.2mm }
.title h1 { font-size:15pt; font-weight:700; letter-spacing:.04em }
.title .ref { color:var(--mut); font-size:8pt } .title .ref b { color:var(--ink) }
table { width:100%; border-collapse:collapse }
.info { margin-top:2.2mm }
.info th { text-align:left; font-weight:400; color:var(--mut); width:23mm; padding:.55mm 0; vertical-align:top }
.info td { padding:.55mm 3mm .55mm 0; font-weight:700 }
h2 { font-size:8.6pt; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--hd);
  border-bottom:.6pt solid var(--rule); padding-bottom:.6mm; margin:3.2mm 0 1.4mm }
h2 small { float:right; text-transform:none; letter-spacing:0; font-weight:400; color:var(--mut); font-size:7.6pt }
.cells td { border:.6pt solid var(--rule); padding:1mm 1.6mm 1.1mm; font-weight:700; font-size:9.4pt; vertical-align:top }
.cells td span { display:block; font-weight:400; font-size:7pt; color:var(--mut) }
.lst th { text-align:left; font-weight:700; font-size:7.6pt; color:var(--mut); border-bottom:.6pt solid var(--rule); padding:.6mm 1.4mm }
.lst td { padding:.7mm 1.4mm; border-bottom:.4pt solid var(--soft); vertical-align:top }
.lst tr:last-child td { border-bottom:.6pt solid var(--rule) }
.lst .r { text-align:right } .lst td:first-child, .lst th:first-child { padding-left:0 } .nw { white-space:nowrap }
.lst { table-layout:fixed } .lst td, .lst th { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.lst td.wrap { white-space:normal }
.flag { color:var(--flag); font-weight:700 }
.kv th { text-align:left; font-weight:400; color:var(--mut); width:27mm; padding:.6mm 0; border-bottom:.4pt solid var(--soft) }
.kv td { padding:.6mm 2mm .6mm 0; border-bottom:.4pt solid var(--soft); font-weight:700 }
.two { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6mm }
.two.w { grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr) }
.map { width:100%; height:44mm; display:block; border:.6pt solid var(--rule) }
.rt { fill:none; stroke:var(--route); stroke-width:1.7; stroke-linejoin:round; stroke-linecap:round }
.dz { fill:var(--dz) } .sb { stroke:var(--mut); stroke-width:1 } .na { fill:none; stroke:var(--mut); stroke-width:1 }
.tw { font-size:6.4px; fill:var(--mut); font-family:Calibri, Carlito, sans-serif }
.st, .se { fill:var(--st) } .st.fl { fill:var(--flag) } .se.b { fill:var(--route) }
.sn { font-size:5.8px; font-weight:700; fill:var(--stt); font-family:Calibri, Carlito, sans-serif }
.cap { font-size:7pt; color:var(--mut); margin-top:.8mm }
.sub { font-size:7.4pt; color:var(--mut); margin-top:2.4mm }
.chart { width:100%; height:22mm; display:block; margin-top:.6mm }
.chart .gl { stroke:var(--soft); stroke-width:.5 } .chart .axl { stroke:var(--rule); stroke-width:.6 }
.chart .ax { font-size:6px; fill:var(--mut); font-family:Calibri, Carlito, sans-serif }
.chart .fl { fill:none; stroke:var(--route); stroke-width:1.2; stroke-linejoin:round } .chart .fd { fill:var(--flag) }
.cnt th { font-weight:400; font-size:7.2pt; color:var(--mut); border:.6pt solid var(--rule); padding:.6mm 1mm; text-align:center; background:var(--shade) }
.cnt td { border:.6pt solid var(--rule); text-align:center; font-weight:700; font-size:10pt; padding:.6mm 0 }
.cnt tr td:last-child, .cnt tr th:last-child { background:var(--shade) }
.cnt td.na { font-weight:400; font-size:7pt; color:var(--mut) }
.none { color:var(--mut); font-style:italic; padding:1mm 0 }
.more { font-size:7pt; color:var(--mut); margin-top:.8mm }
.lines div { border-bottom:.6pt solid var(--rule); height:7mm }
.lines { margin-bottom:3mm }
.sign { display:grid; grid-template-columns:1fr 1fr; gap:5mm }
.sign div { border-bottom:.6pt solid var(--ink); height:9mm; font-size:7.4pt; color:var(--mut) }
.lst td.nw.flag { color:var(--flag) }
.foot { display:flex; justify-content:space-between; color:var(--mut); font-size:7pt; padding:2mm 13mm 4mm; border-top:.6pt solid var(--rule); flex:none }
.bar { position:fixed; top:0; left:0; right:0; height:44px; display:flex; align-items:center; gap:8px; padding:0 16px;
  background:#1f2328; color:#fff; font:13px "Segoe UI", Arial, sans-serif; z-index:5 }
.bar b { margin-right:auto; font-weight:600 }
.bar button { font:inherit; border:1px solid #4a5059; background:#2c3238; color:#fff; border-radius:6px; padding:6px 12px; cursor:pointer }
.bar button[aria-pressed=true] { background:#fff; color:#1f2328 }
.bar button.go { background:#1f3a5f; border-color:#1f3a5f }
@media print { .bar { display:none } }
`;

/**
 * @param {object} r  lib/tripReport buildTripReport()
 * @param {{theme?: 'light'|'dark', logos: {rai: string, ogc: string}, toolbar?: boolean}} opts
 */
export function renderTripReportHtml(r, { theme = 'light', logos, toolbar = true } = {}) {
  const w = r.window;
  const multi = dayOf.format(w.from) !== dayOf.format(w.to);
  const T = (t) => (t == null ? dash : (multi ? fmtDayHM : fmtHM).format(t));
  const S = r.summary;

  const summary = [
    ['Distance', S.distanceKm != null ? `${num(S.distanceKm, 1)} km` : dash],
    ['Moving time', dur(S.movingMs)],
    ['Stopped time', dur(S.stoppedMs)],
    ['Average speed', S.avgKmh != null ? `${num(S.avgKmh, 1)} km/h` : dash],
    ['Maximum speed', S.maxKmh != null ? `${num(S.maxKmh)} km/h` : dash],
    ['Fuel used', S.fuelUsedL != null ? `${num(S.fuelUsedL, 1)} L` : dash],
  ].map(([k, v]) => `<td><span>${k}</span>${v}</td>`).join('');

  // Conduct and tickets: from the start of the departure day to the end of the trip.
  const span = `${fmtDayHM.format(r.day.from)} to end of trip, ${fmtDayHM.format(r.day.to)}`;

  // ── load: what the dispatch declared, and every weighbridge ticket that day ──
  const Dl = r.declared;
  const declared = Dl
    ? `<table class="kv" style="margin-bottom:1.4mm"><tr><th>Declared load</th><td>${esc(Dl.cargo ?? dash)}${Dl.bags ? `, ${num(Dl.bags)} bags` : ''}, ${Dl.netKg != null ? `${num(Dl.netKg / 1000, 2)} t` : dash} &nbsp;<span style="font-weight:400;color:var(--mut)">dispatch no. ${esc(Dl.ref ?? dash)}</span></td></tr></table>`
    : '';
  const WB = r.weighbridge;
  const load = declared + (WB.rows.length
    ? `<table class="cells" style="margin-bottom:1.4mm"><tr><td><span>Weighbridge</span>${esc(WB.bridges.join(', ') || dash)}</td><td><span>Tickets</span>${WB.tickets}</td><td><span>Weighings</span>${WB.weighings}</td><td><span>Net tonnage</span>${num(WB.netKg / 1000, 2)} t</td></tr></table>
      <table class="lst"><colgroup><col style="width:22mm"><col style="width:22mm"><col><col style="width:20mm"><col style="width:24mm"><col style="width:22mm"><col style="width:15mm"></colgroup><tr><th>Ticket</th><th>Weighing</th><th>Weighbridge</th><th class="r">Weight</th><th>Time</th><th>Since previous</th><th class="r">Net</th></tr>${
      WB.rows.map((x) => `<tr><td class="nw">${x.sameTicketAsPrev ? '' : esc(x.ticket)}</td><td>${esc(x.kind)}</td><td>${esc(x.bridge ?? dash)}</td><td class="r">${num(x.kg)} kg</td><td class="nw${x.doubtful ? ' flag' : ''}"${x.doubtful ? ' title="Stamped before its ticket was raised; the weighbridge clock is wrong"' : ''}>${fmtDayHM.format(x.at)}${x.doubtful ? ' *' : ''}</td><td class="nw">${x.sinceMs != null ? dur(x.sinceMs) : dash}</td><td class="r">${x.netKg != null ? `${num(x.netKg / 1000, 2)} t` : ''}</td></tr>`).join('')}</table>${
      WB.more ? `<div class="more">+ ${WB.more} more weighings.</div>` : ''}${
      WB.doubtful ? '<div class="more"><span class="flag">*</span> Time as stamped by the weighbridge, which is before its own ticket was raised; not used for the time differences.</div>' : ''}`
    : `<div class="none">No weighbridge ticket for this unit, ${span}.</div>`);

  // ── stops ──
  const stops = r.stops.length
    ? `<table class="lst"><colgroup><col style="width:4mm"><col><col style="width:${multi ? 22 : 11.5}mm"><col style="width:${multi ? 22 : 11.5}mm"><col style="width:17mm"><col style="width:${multi ? 20 : 31}mm"></colgroup><tr><th>#</th><th>Location</th><th>Arrived</th><th>Left</th><th>Duration</th><th>Remark</th></tr>${
      r.stops.map((s) => `<tr><td>${s.n}</td><td class="pl">${place(s)}</td><td class="nw">${T(s.t)}</td><td class="nw">${T(s.endT)}</td><td class="nw">${dur(s.ms)}</td><td${s.flag ? ' class="flag"' : ''} title="${esc(s.remark)}">${esc(s.remark)}</td></tr>`).join('')}</table>${
      r.stopsTotal > r.stops.length ? `<div class="more">Showing the ${r.stops.length} longest of ${r.stopsTotal} stops over 5 min.</div>` : ''}`
    : '<div class="none">No stops over 5 minutes.</div>';

  // ── fuel ──
  const F = r.fuel;
  const fuelRows = [
    F.startL != null ? `<tr><td class="nw">${T(w.from)}</td><td>Start level</td><td></td><td class="r"></td><td class="r">${num(F.startL)} L</td></tr>` : '',
    ...F.rows.map((x) => `<tr><td class="nw">${T(x.t)}</td><td${x.flag ? ' class="flag"' : ''}>${x.label}</td><td class="pl">${place(x)}</td><td class="r">${x.litres != null ? `${x.kind === 'refill' ? '+' : '−'}${num(x.litres)} L` : dash}</td><td class="r">${x.after != null ? `${num(x.after)} L` : ''}</td></tr>`),
    F.endL != null ? `<tr><td class="nw">${T(w.to)}</td><td>Level now</td><td></td><td class="r"></td><td class="r">${num(F.endL)} L</td></tr>` : '',
  ].join('');
  const fuel = !F.hasProbe && !F.rows.length
    ? '<div class="none">No fuel level sensor readings for this trip.</div>'
    : `<table class="lst"><colgroup><col style="width:${multi ? 22 : 10}mm"><col style="width:22mm"><col><col style="width:13mm"><col style="width:12mm"></colgroup><tr><th>Time</th><th>Event</th><th>Location</th><th class="r">Litres</th><th class="r">Level</th></tr>${fuelRows}</table>${
      F.more ? `<div class="more">+ ${F.more} more fuel events.</div>` : ''}${
      F.drainL > 0 ? `<div class="more"><span class="flag">Note:</span> ${num(F.drainL)} L recorded as drained during this trip.</div>` : ''}`;

  // ── driver conduct, for the day ──
  const B = r.breaches;
  const dayT = (t) => fmtDayHM.format(t);
  const cnt = `<table class="cnt"><tr>${BREACH_KINDS.map((k) => `<th>${k.label}</th>`).join('')}<th>Time overspeeding</th><th>Distance overspeeding</th></tr><tr>${
    BREACH_KINDS.map((k) => `<td>${B.counts[k.key]}</td>`).join('')}<td>${B.counts.speed ? dur(B.overspeedMs) : '0 min'}</td><td>${B.overspeedKm != null ? `${num(B.overspeedKm, 1)} km` : dash}</td></tr></table>`;
  const breachRows = B.rows.length
    ? `<table class="lst" style="margin-top:1.4mm"><colgroup><col style="width:22mm"><col style="width:27mm"><col><col style="width:36mm"></colgroup><tr><th>Time</th><th>Event</th><th>Location</th><th>Detail</th></tr>${
      B.rows.map((b) => `<tr><td class="nw">${dayT(b.t)}</td><td class="nw${b.key === 'theft' ? ' flag' : ''}">${b.label}</td><td class="pl">${place(b)}</td><td>${esc(b.detail ?? '')}</td></tr>`).join('')}</table>${
      B.more ? `<div class="more">+ ${B.more} more.</div>` : ''}`
    : '<div class="none" style="margin-top:1.4mm">Nothing recorded against the unit in this time.</div>';

  // ── geofence ──
  const G = r.geo;
  const geo = G.rows.length
    ? `<table class="lst"><colgroup><col style="width:${multi ? 22 : 10}mm"><col style="width:27mm"><col></colgroup><tr><th>Time</th><th>Alert</th><th>Zone</th></tr>${
      G.rows.map((g) => `<tr><td class="nw">${T(g.t)}</td><td${g.flag ? ' class="flag"' : ''}>${esc(g.label)}</td><td class="pl">${esc(g.zone ?? dash)}</td></tr>`).join('')}</table>${
      G.more ? `<div class="more">+ ${G.more} more zone crossings.</div>` : ''}`
    : G.timedOut
      ? '<div class="none">Zone crossings could not be read in time for this report.</div>'
      : '<div class="none">No geofence alerts during this trip.</div>';

  const arrived = r.to.arrivedAt ? `${r.to.name ?? dash}, arrived ${T(r.to.arrivedAt)}` : `${r.to.name ?? dash} (not yet arrived)`;
  const taken = r.toDestinationMs != null ? dur(r.toDestinationMs) : `${dur(S.durationMs)} so far`;
  const tripDate = w.from ? fmtDate.format(w.from) : dash;
  const title = `Trip Report ${r.vehicle.plate} ${dayOf.format(w.from)}`;

  const bar = toolbar ? `<div class="bar"><b>${esc(title)}</b>
    <button type="button" data-theme-set="light" aria-pressed="${theme === 'light'}">Light</button>
    <button type="button" data-theme-set="dark" aria-pressed="${theme === 'dark'}">Dark</button>
    <button type="button" class="go" data-print>Save as PDF / Print</button></div>
    <script>
      document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.addEventListener('click', function () {
        document.documentElement.dataset.theme = b.dataset.themeSet;
        document.querySelectorAll('[data-theme-set]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      }); });
      document.querySelector('[data-print]').addEventListener('click', function () { window.print(); });
    </script>` : '';

  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
${bar}
<div class="page">
<div class="lh"><img class="rai" src="${logos.rai}" alt="RAI Group"><img class="ogc" src="${logos.ogc}" alt="Off-Grid Consulting"></div>
<div class="body">
  <div class="title"><h1>TRIP REPORT</h1><div class="ref">Report no. <b>${esc(r.reportNo)}</b> &nbsp;·&nbsp; Trip date <b>${tripDate}</b></div></div>
  <table class="info"><tr>
    <th>Vehicle</th><td>${esc(r.vehicle.plate)}${r.vehicle.type ? `, ${esc(r.vehicle.type)}` : ''}</td><th>From</th><td>${esc(r.from.name ?? dash)}, departed ${T(r.from.at)}</td></tr><tr>
    <th>Driver</th><td>${esc(r.vehicle.driver ?? 'Not recorded')}</td><th>To</th><td>${esc(arrived)}</td></tr><tr>
    <th>Fleet</th><td>${esc(r.companyName ?? dash)}</td><th>Time taken</th><td>${taken}</td></tr></table>
  ${r.window.clipped ? '<div class="more">This dispatch is older than 7 days; the report covers its last 7 days.</div>' : ''}

  <h2>1. Trip summary <small>${T(w.from)} to ${T(w.to)}</small></h2>
  <table class="cells"><tr>${summary}</tr></table>

  <h2>2. Weighbridge <small>${span}</small></h2>
  ${load}

  <div class="two w">
    <div><h2>3. Route</h2>${routeSvg(r)}
      <div class="cap">A: departure &nbsp; B: latest position${r.stops.length ? ` &nbsp; ${r.stops.length > 1 ? `1–${r.stops.length}: stops` : '1: stop'}` : ''}${r.dest ? ' &nbsp; Shaded: destination' : ''}</div>
      ${fuelSvg(r.fuel, w)}</div>
    <div><h2>4. Stops <small>Stopped ${dur(S.stoppedMs)}${S.idleMs != null ? ` · idling ${dur(S.idleMs)}` : ''}</small></h2>
      ${stops}
      <h2>5. Fuel <small>Used on trip: ${S.fuelUsedL != null ? `${num(S.fuelUsedL, 1)} L` : dash}</small></h2>
      ${fuel}
    </div>
  </div>

  <h2>6. Driver conduct <small>${esc(r.vehicle.driver ?? 'Driver not recorded')} on ${esc(r.vehicle.plate)}, ${span}</small></h2>
  ${cnt}${breachRows}

  <h2>7. Geofence alerts</h2>
  ${geo}

  <h2>8. Summary</h2>
  <div class="lines"><div></div><div></div><div></div><div></div></div>
  <div class="sign"><div>Reviewed by</div><div>Signature &amp; date</div></div>
</div>
<div class="foot"><span></span><span>Page 1 of 1</span></div>
</div>
<script>
  // One page, whatever the trip: if the content is taller than the sheet,
  // shrink it to fit rather than let the bottom be cut off.
  (function () {
    var b = document.querySelector('.body');
    var z = b.clientHeight / b.scrollHeight;
    if (z < 1) b.style.zoom = String(Math.max(0.72, z - 0.01));
  })();
</script></body></html>`;
}
