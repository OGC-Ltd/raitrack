// The Fuel Usage Report as letterhead HTML (lib/letterhead, A4 landscape):
// the blocks of lib/fuelUsageReport's figures, dealt onto pages by the
// letterhead's pager. White and black, greys for rules; colour only for
// meaning: red for fuel with no pump record and machines down, green for
// within plan, amber for the pump's own flags.
//
// Pure: returns an HTML string.

import { renderLetterheadHtml, esc } from './letterhead';
import { reportNumber, CONTACT_LINE } from './reportLetterhead';

const INK = '#111';
const MUTED = '#5f5f5f';
const RULE = '#c8c8c8';
const RULE_LIGHT = '#e8e8e8';
const RED = '#a33030';
const GREEN = '#1e6b3a';
const AMBER = '#8a5a00';
// Column tints for the three fuel columns (operator 2026-11-26): probe records, pump records, not at pump
const TINT_IN = '#e6eef8';
const TINT_PUMP = '#e6f2ea';
const TINT_NOT = '#f8e6e6';
/** The chart's Used line (operator 2026-11-26). */
const USED = '#2b5c8a';

/** 12,345 (whole litres), or a dash. */
export const n0 = (x) => (x == null || !Number.isFinite(x) ? '–' : Math.round(x).toLocaleString('en-GB'));
const n1 = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (x) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x * 100)}%`);
/** KES 7.98 M, KES 845,000. */
export const kes = (x) => (x == null || !Number.isFinite(x) ? '–' : x >= 1e6 ? `KES ${(x / 1e6).toFixed(2)} M` : `KES ${n0(x)}`);
/** A variance in brackets when negative: (2,531). */
const vary = (x) => (x == null || !Number.isFinite(x) ? '–' : x < 0 ? `(${n0(-x)})` : n0(x));

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const monthLong = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' });
const asDay = (key) => new Date(`${key}T12:00:00Z`);

/** "16 – 22 November 2026", "28 October – 3 November 2026". */
export function periodWords(from, to) {
  if (!from || !to) return '';
  const a = asDay(from);
  const b = asDay(to);
  if (from === to) return longDay.format(a);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${a.getUTCDate()} – ${longDay.format(b)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${a.getUTCDate()} ${monthLong.format(a)} – ${longDay.format(b)}`;
  return `${longDay.format(a)} – ${longDay.format(b)}`;
}

const STYLE = `<style>
.fu, .fu * { box-sizing: border-box; }
.fu { color: ${INK}; font-variant-numeric: tabular-nums; }
.fu h2 { font-size: 12pt; font-weight: 600; margin: 4mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 0.5mm solid ${INK}; display: flex; justify-content: space-between; align-items: baseline; }
.fu h2 small { font-size: 7.5pt; font-weight: 400; color: ${MUTED}; }
.fu-band { display: grid; grid-template-columns: repeat(6, 1fr); background: ${INK}; color: #fff; margin: 2mm 0 3mm; }
.fu-band > div { padding: 3mm 3.5mm; border-left: 0.3mm solid #444; }
.fu-band > div:first-child { border-left: 0; }
.fu-band .k { font-size: 6.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: #cfcfcf; }
.fu-band .v { font-size: 15pt; margin: 1mm 0 0.6mm; white-space: nowrap; }
.fu-band .s { font-size: 6.8pt; color: #cfcfcf; }
.fu-band .red .v { color: #ff8c8c; }
.fu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }
.fu-t { width: 100%; border-collapse: collapse; font-size: 7.6pt; }
.fu-t th { font-size: 6.4pt; letter-spacing: 0.05em; text-transform: uppercase; color: ${MUTED}; text-align: left; font-weight: 600; padding: 1mm 1.2mm; border-bottom: 0.3mm solid ${RULE}; }
.fu-t td { padding: 0.9mm 1.2mm; border-bottom: 0.2mm solid ${RULE_LIGHT}; vertical-align: top; }
.fu-t .r { text-align: right; }
.fu-t .t-in { background: ${TINT_IN}; }
.fu-t .t-pump { background: ${TINT_PUMP}; }
.fu-t .t-not { background: ${TINT_NOT}; }
.fu-t .b { font-weight: 600; }
.fu-t tr.tot td { font-weight: 700; border-top: 0.3mm solid ${INK}; border-bottom: 0; }
.fu .red { color: ${RED}; }
.fu .green { color: ${GREEN}; }
.fu .amber { color: ${AMBER}; font-weight: 600; }
.fu .muted { color: ${MUTED}; }
.fu-bar { display: inline-block; height: 2.2mm; background: ${INK}; vertical-align: middle; }
.fu-bar.red { background: ${RED}; }
.fu-barbox { display: inline-block; width: 22mm; height: 2.2mm; background: ${RULE_LIGHT}; vertical-align: middle; }
.fu-note { font-size: 7pt; color: ${MUTED}; margin-top: 1.5mm; line-height: 1.35; }
.fu-basis { font-size: 7.4pt; margin: 0; padding-left: 4mm; line-height: 1.45; }
.fu-down { color: ${RED}; font-size: 6.5pt; font-weight: 600; margin-left: 1mm; }
</style>`;

/** `tint` maps a column index to 'in', 'pump' or 'not': a light band down that column. */
const table = (head, rows, { right = [], total = null, tint = {} } = {}) => {
  const cls = (i) => {
    const c = [isR(i) && 'r', tint[i] && `t-${tint[i]}`].filter(Boolean).join(' ');
    return c ? ` class="${c}"` : '';
  };
  const isR = (i) => right.includes(i);
  return `<table class="fu-t"><thead><tr>${head.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${c}</td>`).join('')}</tr>`).join('')
  }${total ? `<tr class="tot">${total.map((c, i) => `<td${cls(i)}>${c}</td>`).join('')}</tr>` : ''}</tbody></table>`;
};

/** The cumulative chart: need dashed grey, probe records solid black, pump records solid grey, used blue; one axis. */
export function cumulativeSvg(cumulative) {
  const W = 520, H = 210, L = 46, R = 96, T = 10, B = 26;
  const pts = cumulative ?? [];
  if (!pts.length) return '';
  const hasUsed = pts.some((p) => p.used != null);
  const hasProbe = pts.some((p) => p.probe != null);
  const max = Math.max(1, ...pts.map((p) => Math.max(p.need, p.probe ?? 0, p.issued, p.used ?? 0)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const line = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k] ?? 0).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const every = Math.max(1, Math.ceil(pts.length / 8));
  const last = pts.at(-1);
  // End labels, kept at least 11 apart so lines that finish close together stay readable
  const ends = [
    { v: last.need, text: 'Need', cls: `fill="${MUTED}"` },
    ...(hasProbe ? [{ v: last.probe ?? 0, text: 'Probe records', cls: `fill="${INK}" font-weight="600"` }] : []),
    ...(hasUsed ? [{ v: last.used ?? 0, text: 'Used', cls: `fill="${USED}" font-weight="600"` }] : []),
    { v: last.issued, text: 'Pump records', cls: 'fill="#7a7a7a"' },
  ].map((e) => ({ ...e, at: y(e.v) + 3 })).sort((a, b) => a.at - b.at);
  for (let i = 1; i < ends.length; i++) ends[i].at = Math.max(ends[i].at, ends[i - 1].at + 11);
  const labels = ends.map((e) => `<text x="${(x(pts.length - 1) + 6).toFixed(1)}" y="${e.at.toFixed(1)}" font-size="9" ${e.cls}>${esc(e.text)} ${n0(e.v)}</text>`).join('');
  const area = `${line('need')} ${[...pts].reverse().map((p, j) => `L${x(pts.length - 1 - j).toFixed(1)},${y(p.probe ?? p.issued ?? 0).toFixed(1)}`).join(' ')} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="inherit">
${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${RULE_LIGHT}" stroke-width="0.8"/><text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" font-size="8.5" text-anchor="end" fill="${MUTED}">${n0(v)}</text>`).join('')}
<path d="${area}" fill="#ececec"/>
<path d="${line('need')}" fill="none" stroke="${MUTED}" stroke-width="1.6" stroke-dasharray="5 4"/>
<path d="${line('issued')}" fill="none" stroke="#9a9a9a" stroke-width="1.4"/>
${hasProbe ? `<path d="${line('probe')}" fill="none" stroke="${INK}" stroke-width="2"/>` : ''}
${hasUsed ? `<path d="${line('used')}" fill="none" stroke="${USED}" stroke-width="2"/>` : ''}
${pts.map((p, i) => (i % every === 0 || i === pts.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="8.5" text-anchor="middle" fill="${MUTED}">${esc(dayFmt.format(asDay(p.day)).replace(',', ''))}</text>` : '')).join('')}
${labels}
</svg>`;
}

/**
 * The report's letterhead HTML.
 *
 * @param {object} rep   buildFuelUsage()
 * @param {object} o     { companyName, orgCode, siteWords, logos, now }
 */
export function fuelUsageHtml(rep, { companyName, orgCode, siteWords = 'All sites', logos, now = Date.now() }) {
  const t = rep.totals;
  const period = periodWords(rep.from, rep.to);
  const probe = t.probeKnown;
  const flow = [STYLE];

  // Page 1: the band
  flow.push(`<div class="fu"><div class="fu-band">
<div><div class="k">Probe records</div><div class="v">${probe ? `${n0(t.probe)} L` : '–'}</div><div class="s">${probe ? `${pct(t.probeShare)} of the plans' ${n0(t.need)} L · ${n0(t.probeMachines)} machines with a probe` : 'probe fills not read'}</div></div>
<div><div class="k">Pump records</div><div class="v">${n0(t.issued)} L</div><div class="s">${n0(t.issues)} fills in FactorySuite</div></div>
<div class="red"><div class="k">Not at pump</div><div class="v">${probe ? `${n0(t.unrecorded.litres)} L` : '–'}</div><div class="s">${probe ? `${n0(t.unrecorded.fills)} fills · ${n0(t.unrecorded.machines)} machines` : 'probe fills not read'}</div></div>
<div><div class="k">Shifts planned</div><div class="v">${n0(t.shifts)}</div><div class="s">${n0(t.onPlans)} machines · ${n0(t.multiShiftDays)} days with 2+ shifts</div></div>
<div><div class="k">Shifts completed</div><div class="v">${t.shiftsCompleted == null ? '–' : n0(t.shiftsCompleted)}</div><div class="s">${t.shiftsCompleted == null ? 'tracker hours not read' : `ran all planned hours · of ${n0(t.shiftsJudged)} the tracker could check`}</div></div>
<div><div class="k">Planned, no fuel recorded</div><div class="v">${n0(t.plannedNotFuelled.machines)} machines</div><div class="s">${n0(t.plannedNotFuelled.need)} L of need · ${n0(t.down.machines)} down on plan</div></div>
</div></div>`);

  // Chart and by site
  const maxSite = Math.max(1, ...rep.bySite.map((s) => Math.max(s.need, s.probe ?? 0)));
  const siteRows = rep.bySite.map((s) => [
    esc(s.site), `${n0(s.fuelled)} / ${n0(s.machines)}`, n0(s.need), probe ? `<b>${n0(s.probe)}</b>` : '–',
    `<span class="fu-barbox"><span class="fu-bar" style="width:${Math.min(100, ((s.probe ?? 0) / maxSite) * 100).toFixed(0)}%"></span></span>`,
    n0(s.issued), s.unrecorded > 0 ? `<span class="red">${n0(s.unrecorded)}</span>` : '–', s.probeVariance == null ? '–' : vary(s.probeVariance),
  ]);
  const siteTot = ['Total', '', n0(t.need), probe ? n0(t.probe) : '–', '', n0(t.issued), `<span class="red">${n0(t.unrecorded.litres)}</span>`, t.probeVariance == null ? '–' : vary(t.probeVariance)];
  flow.push(`<div class="fu fu-grid">
<div><h2>Probe records against the plans' need <small>cumulative, litres</small></h2>${cumulativeSvg(rep.cumulative)}
<div class="fu-note">Need: dashed. Probe records: black (fills the fuel probes saw). Used: blue (each machine's tank: level at the start of the day + fuel in − fuel drained − level at the end${t.used ? `; ${n0(t.used.machines)} machines with a fuel probe` : ''}). Pump records: grey (FactorySuite).</div></div>
<div><h2>By site <small>litres</small></h2>${table(['Site', 'Fuelled', 'Need', 'Probe records', '', 'Pump records', 'Not at pump', 'Variance'], siteRows, { right: [1, 2, 3, 5, 6, 7], total: siteTot, tint: { 3: 'in', 4: 'in', 5: 'pump', 6: 'not' } })}</div>
</div>`);

  // No pump record, by machine type
  const un = rep.exceptions.unrecorded;
  const unRows = un.slice(0, 14).map((u) => [`<b>${esc(u.machine)}</b>`, esc(u.type), esc(u.site), n0(u.fills), `<span class="red b">${n0(u.litres)}</span>`, u.pumpFills ? `${n0(u.pumpFills)} · ${n0(u.pumpL)} L` : '<span class="red">none</span>']);
  const typeRows = rep.byType.slice(0, 14).map((x) => [esc(x.type), n0(x.units), n0(x.shifts), x.completed == null ? '–' : n0(x.completed), n0(x.need), probe && x.probed ? `<b>${n0(x.probe)}</b>` : '<span class="muted">no probe</span>', n0(x.issued), x.unrecorded > 0 ? `<span class="red">${n0(x.unrecorded)}</span>` : '–']);
  flow.push(`<div class="fu fu-grid">
<div><h2>Probe records not at pump <small>${probe ? `${n0(t.unrecorded.machines)} machines · top ${Math.min(14, un.length)}` : 'probe fills not read'}</small></h2>${
  probe ? table(['Machine', 'Type', 'Site', 'Fills', 'Litres', 'Pump records'], unRows, { right: [3, 4], tint: { 4: 'not', 5: 'pump' }, total: un.length ? ['Total', '', '', n0(t.unrecorded.fills), `<span class="red">${n0(t.unrecorded.litres)}</span>`, ''] : null }) : '<p class="fu-note">The probe fills could not be read.</p>'}
<div class="fu-note">A fill the fuel probe saw that no pump issue in FactorySuite matches (same machine, from 30 minutes before to 2 hours after).${t.otherProbe?.fills ? ` A further ${n0(t.otherProbe.litres)} L in ${n0(t.otherProbe.fills)} fills went into ${n0(t.otherProbe.vehicles)} tracked vehicles that were on no plan and at no pump.` : ''}</div></div>
<div><h2>By machine type <small>litres</small></h2>${table(['Type', 'Units', 'Shifts', 'Completed', 'Need', 'Probe records', 'Pump records', 'Not at pump'], typeRows, { right: [1, 2, 3, 4, 5, 6, 7], tint: { 5: 'in', 6: 'pump', 7: 'not' } })}</div>
</div>`);

  // Fill checks and machines down
  const ps = rep.exceptions.probeShort;
  const ot = rep.exceptions.overTank;
  const dn = rep.exceptions.downOnPlan;
  const fl = rep.exceptions.flagged;
  const fillRows = [
    ...ps.map((x) => [shortDay.format(asDay(x.issue.day)), `<b>${esc(x.machine)}</b>`, esc(x.issue.pump ?? ''), n0(x.issue.litres), '<span class="amber">Probe saw less</span>', `probe rise ${n0(x.issue.sensor?.riseL)} L, ${n0(x.shortL)} L not seen`]),
    ...ot.map((x) => [shortDay.format(asDay(x.issue.day)), `<b>${esc(x.machine)}</b>`, esc(x.issue.pump ?? ''), n0(x.issue.litres), '<span class="amber">More than the tank</span>', x.over.kind === 'tank' ? `tank ${n0(x.tankLitres)} L` : `room in tank ${n0(x.over.limit)} L (probe)`]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const flagCounts = {};
  for (const x of fl) for (const f of x.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  flow.push(`<div class="fu fu-grid">
<div><h2>Checks at the pump <small>${n0(ps.length)} probe · ${n0(ot.length)} tank</small></h2>${fillRows.length ? table(['Day', 'Machine', 'Pump', 'Litres', 'Check', 'Detail'], fillRows, { right: [3] }) : '<p class="fu-note">No pump fill failed a probe or tank check.</p>'}
<div class="fu-note">Pump flags this period: ${Object.entries(flagCounts).map(([f, c]) => `${esc(f)} ${n0(c)}`).join(', ') || 'none'}${t.flags.offPlanL ? ` (Off plan ${n0(t.flags.offPlanL)} L)` : ''}. Shown for reference: what FactorySuite means by each flag is still to be confirmed.</div></div>
<div><h2>Machines down, still on the plan <small>${n0(dn.length)} machines</small></h2>${dn.length ? table(['Machine', 'Type', 'Shifts', 'Need L', 'Pump L'], dn.map((x) => [`<b>${esc(x.machine)}</b><span class="fu-down">down</span>`, esc(x.type), n0(x.shifts), n0(x.need), x.issued > 0 ? `<span class="red">${n0(x.issued)}</span>` : '–']), { right: [2, 3, 4] }) : '<p class="fu-note">None.</p>'}</div>
</div>`);

  // By operator, planned but nothing in
  const op = rep.byOperator.slice(0, 16);
  const pn = rep.exceptions.plannedNotFuelled;
  flow.push(`<div class="fu fu-grid">
<div><h2>At the pump, by operator <small>${n0(rep.byOperator.length)} operators</small></h2>${table(['Operator', 'Fills', 'Litres', 'Machines', 'Flags', 'Probe saw less L'], op.map((o) => [esc(o.operator), n0(o.fills), n0(o.litres), n0(o.machines), o.flags ? `<span class="amber">${n0(o.flags)}</span>` : '–', o.probeShortL > 0 ? n0(o.probeShortL) : '–']), { right: [1, 2, 3, 4, 5] })}</div>
<div><h2>Planned, no fuel recorded <small>${n0(pn.length)} machines</small></h2>${pn.length ? table(['Machine', 'Type', 'Site', 'Shifts', 'Need L'], pn.slice(0, 16).map((x) => [`<b>${esc(x.machine)}</b>${x.down ? '<span class="fu-down">down</span>' : ''}`, esc(x.type), esc(x.site), n0(x.shifts), n0(x.need)]), { right: [3, 4] }) : '<p class="fu-note">None.</p>'}
${pn.length > 16 ? `<div class="fu-note">And ${n0(pn.length - 16)} more in the register.</div>` : ''}</div>
</div>`);

  // Basis of preparation
  flow.push(`<div class="fu"><h2>Basis of preparation</h2><ul class="fu-basis">
<li><b>Need</b>: FactorySuite's figure on each work-plan shift: planned hours × the register's litres per hour, or planned km ÷ km per litre.</li>
<li><b>Probe records</b>: every fill the machine's fuel probe recorded (fuel moving in the tank left out). Machines without a probe show "no probe".</li>
<li><b>Pump records</b>: fuel issues recorded in FactorySuite against each machine. <b>Not at pump</b>: a probe fill that no pump issue matches, same machine, 30 minutes before to 2 hours after.</li>
<li><b>Site</b>: each shift's work location; a pump issue counts at the site of the shift it was requested for. Probe records count at the machine's main site for the period. <b>Variance</b>: probe records less the need of the machines with a probe.</li>
<li><b>Shifts completed</b>: the tracker shows the engine ran at least the shift's planned hours inside the shift. Shifts the tracker could not check (no tracker, no signal, no planned hours) are not counted either way.</li>
</ul><div class="fu-note">${esc(CONTACT_LINE)}</div></div>`);

  // The machine register: one table, split across pages with its header repeated (class lst)
  const regRows = rep.register.map((r) => `<tr><td><b>${esc(r.machine)}</b>${r.down ? '<span class="fu-down">down</span>' : ''}</td><td>${esc(r.type)}</td><td>${esc(r.site)}</td><td class="r">${n0(r.days)}</td><td class="r">${n0(r.shifts)}</td><td class="r">${r.completed == null ? '–' : n0(r.completed)}</td><td class="r">${n1(r.plannedHours)}</td><td class="r">${n0(r.need)}</td><td class="r t-in">${r.probe == null ? '<span class="muted">no probe</span>' : `<b>${n0(r.probe)}</b>`}</td><td class="r t-pump">${n0(r.issued)}</td><td class="r t-not">${r.unrecorded > 0 ? `<span class="red">${n0(r.unrecorded)}</span>` : '–'}</td><td class="r">${r.probeDifference == null ? '–' : vary(r.probeDifference)}</td><td>${r.tracker ? '' : '<span class="muted">no tracker</span>'}</td></tr>`);
  flow.push(`<h2 class="fu" style="font-size:12pt;font-weight:600;border-bottom:0.5mm solid ${INK};margin:4mm 0 1.5mm;padding-bottom:1mm">Machine register <small style="font-size:7.5pt;font-weight:400;color:${MUTED}">all ${n0(rep.register.length)} machines on the plans or at the pumps, by site · litres</small></h2>`);
  flow.push(`<table class="lst fu-t fu"><thead><tr><th>Machine</th><th>Type</th><th>Site</th><th class="r">Days</th><th class="r">Shifts</th><th class="r">Completed</th><th class="r">Plan h</th><th class="r">Need</th><th class="r t-in">Probe records</th><th class="r t-pump">Pump records</th><th class="r t-not">Not at pump</th><th class="r">Variance</th><th></th></tr></thead><tbody>${regRows.join('')}</tbody></table>`);

  const reportNo = reportNumber('FU', orgCode, now);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  const info = [
    ['Fleet', esc(companyName)],
    ['Period', esc(period)],
    ['Sites', esc(siteWords)],
    ['Machines', esc(`${n0(t.machines)} on the plans or at the pumps`)],
    ['Generated', esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now))],
  ];
  return renderLetterheadHtml({
    title: 'FUEL USAGE REPORT', reportNo, date, companyName, info, flow,
    footNote: `${companyName} · Fuel usage report · ${period}`, logos, landscape: true,
  });
}

/** The register as an Excel table: head and body for downloadTableCsv/Xlsx. */
export function registerTable(rep) {
  return {
    head: ['Machine', 'Type', 'Site', 'Department', 'Days', 'Shifts', 'Shifts completed', 'Planned hours', 'Need L', 'Probe records L', 'Pump records L', 'Pump fills', 'Not at pump L', 'Not at pump fills', 'Variance L', 'Down', 'Tracker'],
    body: rep.register.map((r) => [
      r.machine, r.type, r.site, r.department, r.days, r.shifts, r.completed ?? '', Math.round((r.plannedHours ?? 0) * 10) / 10,
      Math.round(r.need ?? 0), r.probe == null ? 'no probe' : Math.round(r.probe), Math.round(r.issued ?? 0), r.fills,
      r.unrecorded == null ? '' : Math.round(r.unrecorded), r.unrecordedFills, r.probeDifference == null ? '' : Math.round(r.probeDifference),
      r.down ? 'Yes' : '', r.tracker ? 'Yes' : 'No',
    ]),
  };
}

/** Every fill not at pump (no pump record), for the Excel file's second sheet. */
export function unrecordedTable(rep) {
  return {
    head: ['Machine', 'Type', 'Site', 'When (EAT)', 'Litres', 'Tank before L', 'Tank after L'],
    body: rep.exceptions.unrecorded.flatMap((u) => u.list.map((p) => [u.machine, u.type, u.site, clock.format(p.at).replace(',', ''), Math.round(p.litres ?? 0), p.before == null ? '' : Math.round(p.before), p.after == null ? '' : Math.round(p.after)])),
  };
}
