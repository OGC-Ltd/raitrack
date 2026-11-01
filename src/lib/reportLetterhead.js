// A Reports-page report on the letterhead (lib/letterhead): the facts under
// the title, the figures as boxed cells, then one section per group.
// The cells are the screen's own (lib/reportTables), so the PDF and the
// screen read the same.
//
// Pure: returns the HTML and what the PDF needs to know about it.

import { renderLetterheadHtml, table, cells, tag, esc } from './letterhead';
import { fuelSuspect, RATES, DEFAULT_RATE, isFigure, shownColumns, overStandard } from './reportTables';
import { ACTIONS, incidentWords, isOverdue, needsEscalation, ESCALATE_CASES, ESCALATE_DAYS } from './followUp';

const fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtGenerated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** "HA-MENENGAI-20261101-1320". */
export function reportNumber(prefix, orgCode, now) {
  const s = new Date(now + 3 * 3600_000).toISOString();
  const org = String(orgCode ?? 'FLEET').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${org}-${s.slice(0, 10).replace(/-/g, '')}-${s.slice(11, 16).replace(':', '')}`;
}

/** The closing line of every report. */
export const CONTACT_LINE = 'This is a system-generated report. For any queries about its contents, please contact OGC Monitoring at operations@offgridconsultingltd.com.';

const PREFIX = { behaviour: 'DB', night: 'ND', overspeed: 'OS', utilisation: 'VU' };

/**
 * Column widths in mm, by report, for the page's inner width. Only the columns
 * shown (keep) are returned, widened in proportion to fill the page.
 */
function columnsFor(def, ctx, keep, inner) {
  const heads = def.columns(ctx);
  const right = (i) => isFigure(def, heads, i);
  const widths = {
    behaviour: [23, 13, 22, 23, 19, 16, 14, 20, 12, 22],
    night: [48, 40, 48, 48],
    overspeed: [30, 22, 44, 20, 22, 22, 24],
    utilisation: [32, 28, 26, 28, 30, 40],
    utilisationRated: [42, 21, 18, 18, 19, 22, 22, 22],
  }[def.key === 'utilisation' && ctx?.rated ? 'utilisationRated' : def.key];
  const used = keep.reduce((s, i) => s + widths[i], 0);
  return keep.map((i) => ({ h: heads[i], r: right(i), w: `${((widths[i] * inner) / used).toFixed(1)}mm` }));
}

/** The vehicle cell: plate, then its notes as tags. */
function vehicleCell(r) {
  return {
    cls: 'b',
    html: esc(r.unit.plate)
      + (r.suspect ? tag('Check sensor', true) : '')
      + (r.basis !== undefined && overStandard(r) ? tag('Over standard', true) : ''),
  };
}

const fmtAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDayWords = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The Driver Behaviour Report's follow-up: how many cases were actioned, the
 * pending ones oldest first, what was done, and the actions by type.
 * ctx.cases: the period's cases; ctx.allCases: every stored case (escalation
 * and the last 7 days of actions look beyond the period).
 */
function followUpFlow(done, ctx, now, start, inner) {
  const cases = ctx.cases ?? [];
  const all = ctx.allCases ?? cases;
  const out = [];
  let k = start;
  const actioned = cases.filter((c) => c.status === 'done');
  const pending = cases.filter((c) => c.status === 'pending').sort((a, b) => a.openedAt - b.openedAt);
  const overdue = pending.filter((c) => isOverdue(c, now));
  const escalate = cases.filter((c) => needsEscalation(c, all));
  const words = `${actioned.length} of ${cases.length} case${cases.length === 1 ? '' : 's'} actioned`;
  const b = (s) => ({ html: esc(s), cls: 'b' });
  const w = (s) => ({ html: esc(s), cls: 'wrap' });
  const days = [...new Set(cases.map((c) => c.day))].sort();
  const dayWords = days.length === 1 ? fmtDayWords.format(Date.parse(`${days[0]}T12:00:00+03:00`)) : `${days.length} days`;

  out.push(`<h2>${k++}. Follow-up <small>${cases.length ? `Cases for ${esc(dayWords)}` : 'No cases'}</small></h2>`);
  out.push(cells([
    ['Cases opened', String(cases.length)], ['Action taken', String(actioned.length)], ['Pending', String(pending.length)],
    ['Overdue (over 24 hrs)', String(overdue.length)], [`Escalate (${ESCALATE_CASES}+ cases in ${ESCALATE_DAYS} days)`, String(escalate.length)],
  ]));

  if (pending.length) {
    out.push(`<h2>${k++}. Pending cases <small>oldest first</small></h2>`);
    // Overdue and Escalate ride beside the plate, only where they apply.
    const drivers = pending.some((c) => c.driver);
    out.push(table([
      { h: 'Opened', w: '24mm' }, { h: 'Vehicle', w: '46mm' }, ...(drivers ? [{ h: 'Driver', w: '40mm' }] : []),
      { h: 'Incidents', w: `${inner - 70 - (drivers ? 40 : 0)}mm` },
    ], pending.map((c) => [
      esc(fmtAt.format(c.openedAt)),
      { cls: 'b', html: esc(c.plate) + (isOverdue(c, now) ? tag('Overdue', true) : '') + (needsEscalation(c, all) ? tag('Escalate', true) : '') },
      ...(drivers ? [w(c.driver)] : []), w(incidentWords(c)),
    ])));
  }

  if (actioned.length) {
    out.push(`<h2>${k++}. Actions taken</h2>`);
    const drivers = actioned.some((c) => c.driver);
    out.push(table([
      { h: 'Vehicle', w: '19mm' }, ...(drivers ? [{ h: 'Driver', w: '34mm' }] : []), { h: 'Incidents', w: '32mm' }, { h: 'Action', w: '29mm' },
      { h: 'Note', w: `${inner - 80 - (drivers ? 34 : 0)}mm` },
    ], [...actioned].sort((a, b2) => a.actedAt - b2.actedAt).map((c) => [
      b(c.plate), ...(drivers ? [w(c.driver || '-')] : []), w(incidentWords(c)), b(c.action), w(c.note || '-'),
    ])));
  }

  const since = now - 7 * 86_400_000;
  const recent = all.filter((c) => c.status === 'done' && c.actedAt >= since);
  if (recent.length) {
    const count = new Map(ACTIONS.map((a) => [a, 0]));
    for (const c of recent) count.set(c.action, (count.get(c.action) ?? 0) + 1);
    const list = [...count].filter(([, n]) => n > 0).sort((a, b2) => b2[1] - a[1]);
    out.push(`<h2>${k++}. Actions by type <small>last 7 days</small></h2>`);
    out.push(table([{ h: 'Action', w: '60mm' }, { h: 'Cases', w: '20mm', r: true }, { h: 'Share', w: '20mm', r: true }],
      list.map(([a, n]) => [esc(a), String(n), `${Math.round((n / recent.length) * 100)}%`])));
  }
  return { flow: out, next: k, words };
}

/**
 * @param {object} def   REPORTS[key]
 * @param {object} done  the page's finished run { rows, secs, ctx, missing, units, failed }
 * @param {object} o     { companyName, orgCode, groupWords, periodWords, nightWords, logos, now }
 * @returns {{ html: string, landscape: boolean, filename: string }}
 */
export function reportHtml(def, done, { companyName, orgCode, groupWords, periodWords, nightWords, logos, now = Date.now() }) {
  const { ctx } = done;
  const landscape = false;
  const inner = 184;
  const keep = shownColumns(def, done.rows, ctx);
  const cols = columnsFor(def, ctx, keep, inner);
  const reportNo = reportNumber(PREFIX[def.key] ?? 'RP', orgCode, now);
  const date = fmtDate.format(ctx.from);

  const heads = def.columns(ctx);
  const rowCells = (r) => def.cells(r, ctx).map((c, i) => {
    if (i === 0) return vehicleCell(r);
    if (r.noData && i >= def.num) return { html: esc(c), cls: 'm' };
    if (c === '–') return { html: c, cls: 'm' };
    if (def.key === 'behaviour' && heads[i] === 'Total') return { html: esc(c), cls: 'b' };
    if (def.key === 'behaviour' && heads[i] === 'Follow-up') {
      if (c === 'Overdue' || c === 'Pending') return { html: tag(c, c === 'Overdue').replace('class="tag', 'style="margin-left:0" class="tag') };
      return { html: esc(c), cls: c === 'No case' ? 'm' : '' };
    }
    return esc(c);
  }).filter((_, i) => keep.includes(i));

  const kpis = def.kpis(done.rows);
  const flow = [
    `<h2>1. Overview <small>${esc(periodWords)}</small></h2>`,
    cells(kpis.map((k) => [k.label, esc(k.value)])),
  ];
  if (!done.rows.length) flow.push(`<div class="none">${esc(def.empty)}</div>`);
  done.secs.forEach((s, i) => {
    const head = s.name ?? 'All vehicles';
    flow.push(`<h2>${i + 2}. ${esc(head)} <small>${s.rows.length} vehicle${s.rows.length === 1 ? '' : 's'} · ${esc(def.sumWords(s.total))}</small></h2>`);
    flow.push(table(cols, s.rows.map(rowCells)));
  });

  const notes = [];
  if (def.key === 'behaviour') {
    if (done.rows.some((r) => r.suspect)) notes.push('Check sensor: more than 100 harsh accelerations or brakes a day, far more than a driver makes. Most likely a faulty sensor.');
    if (ctx.dashcamFailed) notes.push('The dashcam alarms could not be read: no seatbelt, on phone and camera covered count only what operators logged.');
    else if (!ctx.dashcams) notes.push('This fleet has no dashcams: no seatbelt, on phone and camera covered count only what operators logged.');
    else if (done.rows.some((r) => !r.dashcam)) notes.push('–: the vehicle has no dashcam and no operator logged one.');
    if (done.logged?.length) notes.push('Operator entries are counted once: one within 5 minutes of a dashcam alarm of the same kind on the same vehicle is that alarm.');
  }
  if (def.key === 'utilisation' && done.rows.some(fuelSuspect)) {
    notes.push(ctx.rated
      ? 'Check sensor: a vehicle covered 50 km or more, or a machine ran 2 hours or more, but its fuel level hardly moved. Most likely a stuck or faulty fuel sensor.'
      : 'Check sensor: the vehicle covered 50 km or more but its fuel level hardly moved. Most likely a stuck or faulty fuel sensor.');
  }
  if (def.key === 'overspeed') notes.push('Only overspeeding that lasted more than 5 minutes without a break is counted.');
  if (done.failed) notes.push(`${done.failed} could not be read and ${done.failed === 1 ? 'is' : 'are'} left out.`);
  if (notes.length) flow.push(...notes.map((t) => `<div class="note">${esc(t)}</div>`));

  let next = done.secs.length + 2;
  const fu = def.key === 'behaviour' ? followUpFlow(done, ctx, now, next, inner) : null;
  if (fu) { flow.push(...fu.flow); next = fu.next; }

  if (done.missing.length) {
    const byGroup = new Map();
    for (const m of done.missing) byGroup.set(m.group, [...(byGroup.get(m.group) ?? []), m.plate]);
    flow.push(`<h2>${next++}. Not tracked on the platform <small>${done.missing.length} on the list</small></h2>`);
    flow.push(table([{ h: 'Group', w: '38mm' }, { h: 'Vehicles', w: `${inner - 38}mm` }],
      [...byGroup].map(([g, plates]) => [{ html: `${esc(g)} (${plates.length})`, cls: 'b' }, { html: esc(plates.join(', ')), cls: 'wrap' }])));
  }

  // Last of all: who to ask (operator, 1 Nov 2026).
  flow.push(`<div class="contact">${esc(CONTACT_LINE)}</div>`);

  const info = [
    ['Fleet', esc(companyName)],
    ['Period', esc(periodWords)],
    ['Group', esc(groupWords)],
    ...(def.key === 'utilisation' && ctx.rated ? [['Consumption', 'As rated on the register: L/h for machines, L/km for vehicles']] : []),
    ...(def.key === 'utilisation' && !ctx.rated ? [['Consumption', esc(`${(RATES[ctx.rate] ?? RATES[DEFAULT_RATE]).label} (${(RATES[ctx.rate] ?? RATES[DEFAULT_RATE]).unit})`)]] : []),
    ['Vehicles', `${done.rows.length} reported${def.key === 'utilisation' || def.key === 'night' ? ` of ${done.units}` : ''}`],
    ...(nightWords ? [['Night', esc(nightWords.replace(/^Night hours /, ''))]] : []),
    ['Generated', esc(fmtGenerated.format(now))],
    ...(fu ? [['Follow-up', esc(fu.words)]] : []),
  ];

  const html = renderLetterheadHtml({
    title: def.title.toUpperCase(),
    reportNo,
    date,
    companyName,
    info,
    flow,
    footNote: `${companyName} · ${def.title} · ${periodWords}`,
    logos,
    landscape,
  });
  const stamp = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  return { html, landscape, filename: `${def.title} ${companyName} ${stamp}.pdf` };
}
