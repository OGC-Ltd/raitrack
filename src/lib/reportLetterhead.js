// A Reports-page report on the letterhead (lib/letterhead): the facts under
// the title, the figures as boxed cells, then one section per group.
// The cells are the screen's own (lib/reportTables), so the PDF and the
// screen read the same.
//
// Pure: returns the HTML and what the PDF needs to know about it.

import { renderLetterheadHtml, table, cells, tag, esc } from './letterhead';
import { fuelSuspect, RATES, DEFAULT_RATE, isFigure, shownColumns, overStandard, overspeedEventTable, SHOW_FOLLOW_UP, SHOW_FOLLOW_UP_COLUMN } from './reportTables';
import { incidentWords, isOverdue, needsEscalation, ESCALATE_CASES, ESCALATE_DAYS } from './followUp';
import { OVERSPEED_MIN_SEC } from './fleetReports';

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

const PREFIX = { behaviour: 'DC', night: 'ND', overspeed: 'OS', utilisation: 'VU' };

/**
 * Column widths in mm, by report, for the page's inner width. Only the columns
 * shown (keep) are returned, widened in proportion to fill the page.
 */
function columnsFor(def, ctx, keep, inner) {
  const heads = def.columns(ctx);
  const right = (i) => isFigure(def, heads, i);
  const widths = {
    // Vehicle/Type/Driver widened (operator, 9 Nov 2026: columns were truncating).
    // Type widened further (9 Nov 2026: "COMPANY_VEHICLE" still truncated).
    // Incident columns are centred rather than right-aligned.
    // Follow-up column removed from main table (9 Nov 2026: redundant with the section below).
    behaviour: [32, 26, 36, 14, 14, 14, 12, 11, 14, 10, ...(SHOW_FOLLOW_UP_COLUMN ? [18] : [])],
    night: [48, 40, 48, 48],
    overspeed: [30, 22, 44, 20, 22, 22, 24],
    utilisation: [32, 28, 26, 28, 30, 40],
    utilisationRated: [42, 21, 18, 18, 19, 22, 22, 22],
  }[def.key === 'utilisation' && ctx?.rated ? 'utilisationRated' : def.key];
  const used = keep.reduce((s, i) => s + widths[i], 0);
  // Behaviour report: incident/total columns are centred, not right-aligned.
  const centre = def.key === 'behaviour' ? (i) => right(i) : () => false;
  return keep.map((i) => ({
    h: heads[i],
    ...(centre(i) ? { c: true } : right(i) && !centre(i) ? { r: true } : {}),
    w: `${((widths[i] * inner) / used).toFixed(1)}mm`,
  }));
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
 * The Driver Conduct Report's follow-up: how many cases were actioned, the
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
  const escalate = cases.filter((c) => needsEscalation(c, all));
  const words = `${actioned.length} of ${cases.length} case${cases.length === 1 ? '' : 's'} actioned`;
  const b = (s) => ({ html: esc(s), cls: 'b' });
  const w = (s) => ({ html: esc(s), cls: 'wrap' });
  const days = [...new Set(cases.map((c) => c.day))].sort();
  const dayWords = days.length === 1 ? fmtDayWords.format(Date.parse(`${days[0]}T12:00:00+03:00`)) : `${days.length} days`;

  // Summary cells only — pending cases page removed; status badges now on each row (operator, 9 Nov 2026).
  out.push(`<h2>${k++}. Follow-up <small>${cases.length ? `Cases for ${esc(dayWords)}` : 'No cases'}</small></h2>`);
  out.push(cells([
    ['Cases opened', String(cases.length)], ['Action taken', String(actioned.length)], ['Pending', String(pending.length)],
  ]));

  // Only cases from the report period that have been actioned (operator, 9 Nov 2026: show period only, not rolling 7 days).
  const recent = cases.filter((c) => c.status === 'done');
  if (recent.length) {
    const drivers = recent.some((c) => c.driver);
    // Strip system-generated values ("Administrator", emails) — show dash instead (operator, 9 Nov 2026).
    const isSystemBy = (v) => !v || v === 'Administrator' || v.includes('@');
    const cleanBy = (v) => (isSystemBy(v) ? '-' : v);
    out.push(`<h2>${k++}. Feedback received <small>${esc(dayWords)}</small></h2>`);
    out.push(table([
      { h: 'Vehicle', w: '19mm' }, ...(drivers ? [{ h: 'Driver', w: '30mm' }] : []),
      { h: 'Incidents', w: '44mm' }, { h: 'Feedback', w: `${inner - 103 - (drivers ? 30 : 0)}mm` },
      { h: 'Responded by', w: '20mm' },
    ], [...recent].sort((a, b2) => a.actedAt - b2.actedAt).map((c) => [
      b(c.plate), ...(drivers ? [w(c.driver || '-')] : []),
      w(incidentWords(c)),
      w([c.action, c.note].filter(Boolean).join(' — ') || '-'),
      w(cleanBy(c.by)),
    ])));
  }
  return { flow: out, next: k, words };
}

/**
 * @param {object} def   REPORTS[key]
 * @param {object} done  the page's finished run { rows, secs, ctx, missing, units, failed }
 * @param {object} o     { companyName, orgCode, groupWords, periodWords, nightWords, logos, now, landscape }
 * @returns {{ html: string, landscape: boolean, filename: string }}
 */
export function reportHtml(def, done, { companyName, orgCode, groupWords, periodWords, nightWords, logos, now = Date.now(), landscape = false }) {
  const { ctx } = done;
  // The page's inner width in mm: A4 less 13 mm a side, upright or on its side
  const inner = landscape ? 271 : 184;
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
      if (c === 'Pending') return { html: tag(c, false).replace('class="tag', 'style="margin-left:0" class="tag') };
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
    // Behaviour report: sort worst to best by total incidents (operator, 9 Nov 2026).
    const rows = def.key === 'behaviour' ? [...s.rows].sort((a, b) => b.total - a.total) : s.rows;
    flow.push(`<h2>${i + 2}. ${esc(head)} <small>${s.rows.length} vehicle${s.rows.length === 1 ? '' : 's'} · ${esc(def.sumWords(s.total))}</small></h2>`);
    flow.push(table(cols, rows.map(rowCells)));
  });
  // A report made for one unit lists each overspeed (operator, 2 Nov 2026)
  const events = ctx.events?.length ? overspeedEventTable(ctx.events) : null;
  if (events) {
    flow.push(`<h2>${done.secs.length + 2}. Each overspeed <small>${events.rows.length} · ${esc(ctx.unit ?? '')}</small></h2>`);
    const widths = [8, 27, 16, 18, 22, 16, 17, ...(events.driver ? [26] : []), events.driver ? 34 : 60];
    flow.push(table(events.head.map((h, i) => ({ h: esc(h), w: `${widths[i]}mm`, r: events.num(i) })),
      events.rows.map((r) => r.map((c) => (c === '-' ? { html: c, cls: 'm' } : esc(c))))));
  }

  const notes = [];
  if (def.key === 'behaviour') {
    if (done.rows.some((r) => r.suspect)) notes.push('Check sensor: more than 100 harsh accelerations or brakes a day, far more than a driver makes. Most likely a faulty sensor.');
    if (ctx.dashcamFailed) notes.push('The dashcam alarms could not be read: no seatbelt, on phone and camera covered count only what operators logged.');
    else if (!ctx.dashcams) notes.push('This fleet has no dashcams: no seatbelt, on phone and camera covered count only what operators logged.');
    else if (done.rows.some((r) => !r.dashcam)) notes.push('–: the vehicle has no dashcam and no operator logged one.');
    if (done.logged?.length) notes.push('Operator entries are counted once: one within 5 minutes of a dashcam alarm of the same kind on the same vehicle is that alarm.');
    notes.push('Harsh acceleration / braking: A case is opened when a vehicle records 5 or more harsh acceleration or braking events in a single day. Vehicles flagged "Check sensor" with only harsh events are excluded — these are referred to the workshop rather than the driver.');
    notes.push('Harsh cornering: A case is opened when a vehicle records 1 or more harsh cornering events in a single day.');
    notes.push('Seatbelt / On phone / Camera covered: A single event of any of these opens a case immediately.');
  }
  if (def.key === 'utilisation' && done.rows.some(fuelSuspect)) {
    notes.push(ctx.rated
      ? 'Check sensor: a vehicle covered 50 km or more, or a machine ran 2 hours or more, but its fuel level hardly moved. Most likely a stuck or faulty fuel sensor.'
      : 'Check sensor: the vehicle covered 50 km or more but its fuel level hardly moved. Most likely a stuck or faulty fuel sensor.');
  }
  if (def.key === 'overspeed') notes.push(`Only overspeeding that lasted more than ${OVERSPEED_MIN_SEC} seconds without a break is counted.`);
  if (done.failed) notes.push(`${done.failed} could not be read and ${done.failed === 1 ? 'is' : 'are'} left out.`);
  if (notes.length) flow.push(...notes.map((t) => `<div class="note">${esc(t)}</div>`));

  let next = done.secs.length + 2 + (events ? 1 : 0);
  const fu = def.key === 'behaviour' && SHOW_FOLLOW_UP ? followUpFlow(done, ctx, now, next, inner) : null;
  if (fu) { flow.push(...fu.flow); next = fu.next; }

  if (done.missing.length) {
    const byGroup = new Map();
    for (const m of done.missing) byGroup.set(m.group, [...(byGroup.get(m.group) ?? []), m.plate]);
    flow.push(`<h2>${next++}. Not tracked on the platform <small>${done.missing.length} on the list</small></h2>`);
    flow.push(table([{ h: 'Group', w: '38mm' }, { h: 'Vehicles', w: `${inner - 38}mm` }],
      [...byGroup].map(([g, plates]) => [{ html: `${esc(g)} (${plates.length})`, cls: 'b' }, { html: esc(plates.join(', ')), cls: 'wrap' }])));
  }

  // Contact line removed (operator, 9 Nov 2026: "remove these words this is a system generated").

  const info = [
    ['Fleet', esc(companyName)],
    ['Period', esc(periodWords)],
    ['Group', esc(groupWords)],
    // One unit picked (operator, 2 Nov 2026: "generate by the unit")
    ...(ctx.unit ? [['Unit', esc(ctx.unit)]] : []),
    ...(def.key === 'utilisation' && ctx.rated ? [['Consumption', 'As rated on the register: L/h for machines, L/km for vehicles']] : []),
    ...(def.key === 'utilisation' && !ctx.rated ? [['Consumption', esc(`${(RATES[ctx.rate] ?? RATES[DEFAULT_RATE]).label} (${(RATES[ctx.rate] ?? RATES[DEFAULT_RATE]).unit})`)]] : []),
    ['Vehicles', `${done.rows.length} reported${def.key === 'utilisation' || def.key === 'night' ? ` of ${done.units}` : ''}`],
    ...(nightWords ? [['Night', esc(nightWords.replace(/^Night hours /, ''))]] : []),
    ['Generated', esc(fmtGenerated.format(now))],
    ...(fu ? [['Follow-up', esc(fu.words)]] : []),
  ];

  const footNote = `${companyName} · ${def.title} · ${periodWords}`;
  const title = def.title.toUpperCase();
  const html = renderLetterheadHtml({ title, reportNo, date, companyName, info, flow, footNote, logos, landscape });
  const stamp = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  return { html, landscape, parts: { title, reportNo, date, info, flow, footNote }, filename: `${def.title} ${companyName}${ctx.unit ? ` ${ctx.unit}` : ''} ${stamp}.pdf` };
}
