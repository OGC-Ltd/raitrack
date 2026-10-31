// The end-of-shift report (lib/endOfShiftReport) on the letterhead, in the
// trip report's look. Unlike the trip report it runs to as many A4 pages as
// the shift needs: the sections are written as one flow, and a small script
// in the page deals them onto pages, splitting a long table between rows and
// repeating its header. api/endOfShiftReport then draws each page into the PDF.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NBO = 'Africa/Nairobi';
const fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: NBO, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: NBO, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDayHM = new Intl.DateTimeFormat('en-GB', { timeZone: NBO, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const num = (v, d = 0) => (v == null ? '-' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const dash = '-';

export function dur(msv) {
  if (msv == null || !Number.isFinite(msv)) return dash;
  const m = Math.max(0, Math.round(msv / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const tag = (text, tone) => `<span class="tag ${tone}">${esc(text)}</span>`;

/** A table: `cols` = [{ h, w, r? }]; each row an array of cell HTML (already escaped). */
function table(cols, rows, cls = '') {
  const cg = cols.map((c) => `<col style="width:${c.w}">`).join('');
  const th = cols.map((c) => `<th class="${c.r ? 'r' : ''}">${c.h}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((v, i) => `<td class="${cols[i].r ? 'r ' : ''}${cols[i].c ?? ''}">${v}</td>`).join('')}</tr>`).join('');
  return `<table class="lst ${cls}"><colgroup>${cg}</colgroup><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

const CSS = `
@page { size: A4; margin: 0 }
:root { --bg:#fff; --ink:#1c1c1c; --mut:#5c5c5c; --rule:#bfbfbf; --soft:#e6e6e6; --shade:#f3f3f3; --hd:#1f3a5f; --flag:#b42318 }
* { box-sizing:border-box; margin:0; padding:0 }
html, body { background:var(--bg); color:var(--ink); font-family:Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size:8.6pt; line-height:1.28;
  -webkit-print-color-adjust:exact; print-color-adjust:exact }
@media screen { html { background:#8a8f96 } body { background:transparent; padding:24px 0 } .page { margin:0 auto 18px; box-shadow:0 2px 18px rgba(0,0,0,.35) } }
.page { width:210mm; height:297mm; display:flex; flex-direction:column; overflow:hidden; background:var(--bg); position:relative }
.lh { background:#212121; height:21mm; display:flex; align-items:center; justify-content:space-between; padding:0 12mm; flex:none }
.lh .rai { height:15.5mm } .lh .ogc { height:9.5mm; opacity:.78 }
.lh2 { display:flex; justify-content:space-between; align-items:baseline; border-bottom:1.2pt solid var(--ink); margin:6mm 13mm 0; padding-bottom:1.2mm; flex:none }
.lh2 b { font-size:10pt; letter-spacing:.04em } .lh2 span { color:var(--mut); font-size:7.6pt }
.body { padding:5mm 13mm 0; flex:1; min-height:0; overflow:hidden }
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
h3 { font-size:7.8pt; font-weight:700; margin:1.6mm 0 .6mm; display:flex; justify-content:space-between }
h3 span { font-weight:400; color:var(--mut) }
.cells td { border:.6pt solid var(--rule); padding:1mm 1.6mm 1.1mm; font-weight:700; font-size:9.4pt; vertical-align:top }
.cells td span { display:block; font-weight:400; font-size:7pt; color:var(--mut) }
.cells td b.flag { color:var(--flag) }
.lst { table-layout:fixed }
.lst th { text-align:left; font-weight:700; font-size:7.6pt; color:var(--mut); border-bottom:.6pt solid var(--rule); padding:.6mm 1.4mm }
.lst td { padding:.6mm 1.4mm; border-bottom:.4pt solid var(--soft); vertical-align:top; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.lst th { overflow:hidden; white-space:nowrap }
.lst tbody tr:last-child td { border-bottom:.6pt solid var(--rule) }
.lst .r { text-align:right } .lst td:first-child, .lst th:first-child { padding-left:0 }
.lst td.wrap { white-space:normal } .lst td.b { font-weight:700 } .lst td.flag, .flag { color:var(--flag); font-weight:700 }
.cnt th { font-weight:400; font-size:7.2pt; color:var(--mut); border:.6pt solid var(--rule); padding:.6mm 1mm; text-align:center; background:var(--shade) }
.cnt td { border:.6pt solid var(--rule); text-align:center; font-weight:700; font-size:10pt; padding:.6mm 0 }
.cnt td.u { font-weight:400; font-size:7pt; color:var(--mut) }
.grid2 { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:0 6mm }
.tag { display:inline-block; font-size:6.6pt; font-weight:700; padding:0 1.2mm; border:.5pt solid currentColor; border-radius:2px; line-height:1.5 }
.tag.c { color:var(--flag) } .tag.o { color:#9a6700 } .tag.d { color:#1a7f37 } .tag.m { color:var(--mut) }
.none { color:var(--mut); font-style:italic; padding:1mm 0 }
.note { font-size:7pt; color:var(--mut); margin-top:.8mm }
.lines div { border-bottom:.6pt solid var(--rule); height:7mm }
.sign { display:grid; grid-template-columns:1fr 1fr; gap:5mm; margin-top:10mm }
.sign div { border-bottom:.6pt solid var(--ink); height:9mm; font-size:7.4pt; color:var(--mut) }
.foot { display:flex; justify-content:space-between; color:var(--mut); font-size:7pt; padding:2mm 13mm 4mm; border-top:.6pt solid var(--rule); flex:none }
#flow { position:absolute; left:-10000px; top:0; width:184mm }
`;

// Deals the blocks of #flow onto A4 pages. A block that does not fit moves to
// the next page; a table that does not fit is split between rows, its header
// repeated. Runs inside the report's own document.
const PAGER = `
(function () {
  var flow = document.getElementById('flow');
  var tpl = document.getElementById('tpl-next').innerHTML;
  var pages = [document.querySelector('.page')];
  var body = pages[0].querySelector('.body');
  function room() { return body.scrollHeight <= body.clientHeight + 1; }
  function newPage() {
    var p = document.createElement('div'); p.className = 'page'; p.innerHTML = tpl;
    document.body.insertBefore(p, flow); pages.push(p); body = p.querySelector('.body');
  }
  function place(el) {
    body.appendChild(el);
    if (room()) return;
    body.removeChild(el);
    var tbl = el.tagName === 'TABLE' && el.classList.contains('lst') ? el : null;
    var rows = tbl ? Array.prototype.slice.call(tbl.tBodies[0].rows) : null;
    if (tbl && rows.length > 1) {
      // As many rows as fit here, the rest onto the next page.
      var part = tbl.cloneNode(true); var pb = part.tBodies[0]; pb.innerHTML = '';
      body.appendChild(part);
      var i = 0;
      for (; i < rows.length; i++) { pb.appendChild(rows[i].cloneNode(true)); if (!room()) { pb.removeChild(pb.lastChild); break; } }
      if (i === 0) { body.removeChild(part); } else if (i === rows.length) { return; }
      var restT = tbl.cloneNode(true); var rb = restT.tBodies[0]; rb.innerHTML = '';
      for (var j = i; j < rows.length; j++) rb.appendChild(rows[j]);
      newPage(); place(restT); return;
    }
    // A heading is not left alone at the foot of a page.
    var prev = body.lastElementChild;
    newPage();
    if (prev && /^H[23]$/.test(prev.tagName)) { body.appendChild(prev); }
    body.appendChild(el);
  }
  var blocks = Array.prototype.slice.call(flow.children);
  blocks.forEach(function (b) { flow.removeChild(b); place(b); });
  flow.remove();
  var n = pages.length;
  pages.forEach(function (p, k) { var f = p.querySelector('.pn'); if (f) f.textContent = 'Page ' + (k + 1) + ' of ' + n; });
  document.body.setAttribute('data-pages', String(n));
})();
`;

/**
 * @param {ReturnType<import('./endOfShiftReport').buildEndOfShift>} r
 * @param {{ companyName: string, reportNo: string, logos: {rai: string, ogc: string}, generatedAt?: number }} o
 */
export function renderEndOfShiftHtml(r, { companyName, reportNo, logos, generatedAt = Date.now() }) {
  const date = fmtDate.format(r.from);
  const span = `${fmtHM.format(r.from)} to ${fmtHM.format(r.to)}`;
  const theftN = r.theft.length;

  const cells = [
    ['Fuel refills', `${num(r.fuel.refills)} · ${num(r.fuel.refillL)} L`],
    ['Fuel drains', `${num(r.fuel.drains.length)} · ${num(r.fuel.drainL, 1)} L`],
    ['Escalated thefts', theftN ? `<b class="flag">${theftN}</b>` : '0'],
    ['Policy breaches', num(r.breachTotal)],
    ['Units reporting since ' + fmtHM.format(r.from), `${num(r.fleet.reporting)} of ${num(r.fleet.units)}`],
  ].map(([k, v]) => `<td>${v}<span>${k}</span></td>`).join('');

  const theft = theftN
    ? table([{ h: 'Time', w: '11mm' }, { h: 'Unit', w: '18mm', c: 'b' }, { h: 'Driver', w: '30mm' }, { h: 'Lost', w: '14mm', r: true },
        { h: 'Where', w: '51mm' }, { h: 'Unit was', w: '20mm' }, { h: 'Status', w: '40mm' }],
      r.theft.map((d) => [fmtHM.format(d.t), esc(d.plate), esc(d.driver ?? 'Not recorded'), `<span class="flag">${num(d.litres, 1)} L</span>`,
        esc(d.place ?? dash), d.stationary ? 'Standing' : 'Moving', tag(d.status, d.tone)]))
    : '<div class="none">No theft escalated in the shift.</div>';

  const counts = `<table class="cnt"><tr>${r.breaches.map((b) => `<th>${b.label}</th>`).join('')}</tr>
    <tr>${r.breaches.map((b) => `<td>${b.fromDashcam && !r.dashcam ? dash : num(b.total)}</td>`).join('')}</tr>
    <tr>${r.breaches.map((b) => `<td class="u">${b.fromDashcam && !r.dashcam ? 'no dashcams' : `${num(b.units)} unit${b.units === 1 ? '' : 's'}`}</td>`).join('')}</tr></table>`;

  const top5 = (b) => {
    const head = `<h3>${b.label}<span>${b.units ? (b.units > b.top.length ? `top ${b.top.length} of ${b.units} units` : `all ${b.units} unit${b.units === 1 ? '' : 's'}`) : ''}</span></h3>`;
    if (!b.top.length) return `<div>${head}<div class="none">${b.fromDashcam && !r.dashcam ? 'No dashcams in this fleet.' : 'None in the shift.'}</div></div>`;
    const speed = b.key === 'speed';
    const cols = speed
      ? [{ h: 'Unit', w: '17mm', c: 'b' }, { h: 'Driver', w: '20mm' }, { h: 'Time over', w: '15mm', r: true, c: 'b' }, { h: 'Avg over', w: '16mm', r: true }, { h: 'Top / limit', w: '17mm', r: true }]
      : [{ h: 'Unit', w: '18mm', c: 'b' }, { h: 'Driver', w: '53mm' }, { h: 'Times', w: '13mm', r: true, c: 'b' }];
    const rows = b.top.map((x) => speed
      ? [esc(x.plate), esc(x.driver ?? 'Not recorded'), dur((x.overSec ?? 0) * 1000),
        x.avgOver != null ? `+${num(x.avgOver)} km/h` : dash,
        x.peak ? `<span class="${x.limit && x.peak - x.limit >= 30 ? 'flag' : ''}">${num(x.peak)} / ${num(x.limit)}</span>` : dash]
      : [esc(x.plate), esc(x.driver ?? 'Not recorded'), num(x.times)]);
    return `<div>${head}${table(cols, rows)}</div>`;
  };
  // Two breach kinds side by side per block, so the pager keeps each pair together.
  const pairs = [];
  for (let i = 0; i < r.breaches.length; i += 2) pairs.push(`<div class="grid2">${top5(r.breaches[i])}${r.breaches[i + 1] ? top5(r.breaches[i + 1]) : ''}</div>`);

  const ob = r.outAndBack;
  const outCells = `<table class="cells"><tr>${[
    ['Left and still out', num(r.outside.length)],
    ['Units out and back', num(ob.units)],
    ['Longest time out', ob.longest ? `${dur(ob.longest.ms)}<span>${esc(ob.longest.plate)}, from ${esc(ob.longest.zone)}</span>` : dash],
  ].map(([k, v]) => `<td>${v}<span>${k}</span></td>`).join('')}</tr></table>`;
  const outside = r.outside.length
    ? table([{ h: 'Unit', w: '18mm', c: 'b' }, { h: 'Driver', w: '28mm' }, { h: 'Left', w: '32mm' }, { h: 'At', w: '12mm' },
        { h: 'Out for', w: '18mm', r: true }, { h: 'Now near', w: '50mm' }, { h: 'Dispatch', w: '26mm' }],
      r.outside.map((o) => [esc(o.plate), esc(o.driver ?? 'Unassigned'), esc(o.left), fmtHM.format(o.since),
        `<span class="${o.long ? 'flag' : ''}">${dur(o.forMs)}</span>`,
        esc(o.silentSince ? `No signal since ${fmtHM.format(o.silentSince)}` : (o.near ?? (o.lat != null ? `${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}` : dash))),
        o.dispatch ? tag(`Tag ${o.dispatch}`, 'm') : tag('No dispatch', 'c')]))
    : '<div class="none">No unit that left a geofence in the shift is still out.</div>';

  const wb = r.weighbridge;
  const weighBlocks = !wb ? [] : [
    `<h2>5. Weighbridge <small>${span}</small></h2>`,
    `<table class="cells"><tr>${[['Tickets weighed', num(wb.tickets)], ['Net weighed', `${num(wb.tonnes, 1)} t`], ['Units weighed', num(wb.units)],
      ['Units with 2+ trips', num(wb.multiUnits)], ['Bridges in use', num(wb.bridges.length)]].map(([k, v]) => `<td>${v}<span>${k}</span></td>`).join('')}</tr></table>`,
    `<h3>By bridge<span>net weight</span></h3>`,
    wb.bridges.length ? table([{ h: 'Bridge', w: '60mm' }, { h: 'Tickets', w: '20mm', r: true }, { h: 'Net (t)', w: '25mm', r: true }, { h: 'Busiest hour', w: '30mm', r: true }],
      wb.bridges.map((b) => [esc(b.name), num(b.tickets), num(b.tonnes, 1), esc(b.busiest ?? dash)])) : '<div class="none">Nothing weighed in the shift.</div>',
    `<h3>Units with more than one trip<span>${wb.multi.length ? `${num(wb.multi.length)} units, most trips first` : ''}</span></h3>`,
    wb.multi.length ? table([{ h: 'Unit', w: '20mm', c: 'b' }, { h: 'Driver', w: '42mm' }, { h: 'Trips', w: '14mm', r: true, c: 'b' }, { h: 'Net (t)', w: '18mm', r: true }, { h: 'Weighed at', w: '90mm' }],
      wb.multi.map((u) => [esc(u.plate), esc(u.driver ?? 'Not recorded'), num(u.trips), num(u.tonnes, 1), esc(u.bridges.join(', ') || dash)]))
      : '<div class="none">No unit was weighed more than once.</div>',
    '<div class="note">A trip here is one load weighed: the mill net when the load reached the mill, otherwise the outstation net.</div>',
  ];
  const n7 = wb ? 6 : 5;
  const productBlocks = [
    `<h2>${n7}. Products ferried <small>${span}</small></h2>`,
    r.products.length
      ? table([{ h: 'Product', w: '30mm', c: 'b' }, { h: 'Loads', w: '13mm', r: true }, { h: 'Units', w: '12mm', r: true }, { h: 'Weight (t)', w: '19mm', r: true, c: 'b' },
          { h: 'Bags', w: '14mm', r: true }, { h: 'Where it went', w: '66mm', c: 'wrap' }, { h: 'Read from', w: '30mm' }],
        [...r.products.map((p) => [esc(p.product), num(p.loads), num(p.units), num(p.tonnes, 1), p.bags ? num(p.bags) : dash, esc(p.where || dash), esc(p.source)]),
          ['<b>Total</b>', `<b>${num(r.products.reduce((n, p) => n + p.loads, 0))}</b>`, '', `<b>${num(r.products.reduce((n, p) => n + p.tonnes, 0), 1)}</b>`, '', '', '']])
      : '<div class="none">No load recorded in the shift.</div>',
    '<div class="note">Cane weights come from the weighbridge; sugar and other sales loads from the tonnage typed on each sales dispatch.</div>',
  ];

  const flow = [
    `<h2>1. Overview <small>${date}, ${span}</small></h2>`,
    `<table class="cells"><tr>${cells}</tr></table>`,
    `<h2>2. Critical: escalated thefts <small>${theftN} of ${num(r.fuel.drains.length)} drain${r.fuel.drains.length === 1 ? '' : 's'} in the shift</small></h2>`,
    theft,
    `<h2>3. Policy breaches <small>${num(r.breachTotal)} in the shift · top 5 units for each</small></h2>`,
    counts,
    ...pairs,
    r.dashcam ? '<div class="note">On phone, no seatbelt and camera covered come from the dashcams, so only units with a camera are counted.</div>' : '',
    `<h2>4. Out of geofence <small>Left a geofence since ${fmtHM.format(r.from)}</small></h2>`,
    ...(r.zonesKnown ? [
      outCells,
      `<h3>Left and still out<span>${r.outside.length ? 'no dispatch first, then longest out' : ''}</span></h3>`,
      outside,
      r.outside.length ? '<div class="note">Red: no dispatch, or out longer than 12 hours. A unit already outside at the start of the shift is not counted.</div>' : '',
    ] : ['<div class="none">No geofences are set up for this fleet.</div>']),
    ...weighBlocks,
    ...productBlocks,
    `<h2>${wb ? 7 : 6}. Handover to the next shift</h2>`,
    '<div class="lines"><div></div><div></div><div></div><div></div></div>',
    '<div class="sign"><div>Prepared by (outgoing operator)</div><div>Received by (incoming operator)</div></div>',
  ].filter(Boolean);

  const foot = `<div class="foot"><span>${esc(companyName)} · End of shift report · ${date} · made ${fmtDayHM.format(generatedAt)}</span><span class="pn"></span></div>`;
  const first = `<div class="lh"><img class="rai" src="${logos.rai}" alt="RAI Group"><img class="ogc" src="${logos.ogc}" alt="OGC Monitoring"></div>
<div class="body">
  <div class="title"><h1>END OF SHIFT REPORT</h1><div class="ref">Report no. <b>${esc(reportNo)}</b> &nbsp;·&nbsp; Date <b>${date}</b></div></div>
  <table class="info"><tr><th>Fleet</th><td>${esc(companyName)}</td><th>Shift</th><td>${span}</td></tr>
  <tr><th>Units</th><td>${num(r.fleet.units)} (${num(r.fleet.reporting)} reported in the shift)</td><th>Operator</th><td>&nbsp;</td></tr></table>
</div>${foot}`;
  const next = `<div class="lh2"><b>END OF SHIFT REPORT</b><span>${esc(companyName)} · ${date}, ${span} · ${esc(reportNo)}</span></div><div class="body"></div>${foot}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>End of shift report ${esc(companyName)} ${date}</title><style>${CSS}</style></head><body>
<div class="page">${first}</div>
<template id="tpl-next">${next}</template>
<div id="flow">${flow.join('\n')}</div>
<script>${PAGER}</script>
</body></html>`;
}
