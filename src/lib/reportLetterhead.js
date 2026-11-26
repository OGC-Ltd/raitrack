// A Reports-page report on the letterhead (lib/letterhead): the facts under
// the title, the figures as boxed cells, then one section per group.
// The cells are the screen's own (lib/reportTables), so the PDF and the
// screen read the same.
//
// Pure: returns the HTML and what the PDF needs to know about it.

import { renderLetterheadHtml, table, cells, tag, esc, ruledLines } from './letterhead';
import { fuelSuspect, RATES, DEFAULT_RATE, isFigure, shownColumns, overStandard, overspeedEventTable, SHOW_FOLLOW_UP, SHOW_FOLLOW_UP_COLUMN, noDispatchDriver, noDispatchKey, dashcamReachWords, dashcamWindowWords, CORNER_SKIPPED_WORDS } from './reportTables';
import { incidentWords } from './followUp';
import { OVERSPEED_MIN_SEC } from './fleetReports';
import { textMm } from './shiftDoc';

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

const PREFIX = { behaviour: 'DC', night: 'ND', overspeed: 'OS', utilisation: 'VU', machinery: 'MR', shiftHours: 'WP' };

/** Driver conduct: the grey of a row with incidents and no driver on record. Dark enough to survive printing. */
export const NO_DISPATCH_GREY = '#dcdcdc';

/**
 * Overspeeding (operator, 16 Nov 2026: "columns are not evenly distributed,
 * words are truncated"): widths from what the columns hold, not fixed shares.
 * Each column is given room for its heading (one line, bold, as the PDF prints
 * it) and its longest value, and what room is left is shared out evenly (then:
 * "the location still takes much space"). Too little room, and Location wraps
 * and gives way first, down to FLEX_MIN_MM; past that the
 * word columns that can wrap (Driver, Top speed at, Type) give way too.
 * Measured in the PDF's own font (shiftDoc textMm), which the letterhead's
 * Calibri is narrower than, so what fits one fits both.
 */
const FIT = {
  overspeed: { flex: 'Location', wrap: ['Driver', 'Top speed at', 'Type'] },
};
const HEAD_PT = 7.2;
const CELL_PT = 7.8;
const PAD_MM = 3.8;
/** Location's least before others wrap: a place wraps at its commas, a date and time read badly split. */
const FLEX_MIN_MM = 24;
/** Narrowest a wrapping column is squeezed to: a short word a line. */
const WRAP_MIN_MM = 16;

/** Widths (mm) of the shown columns, fitted to their contents; `wrap` names the columns now wrapping. */
export function fitColumns(heads, cellRows, keep, inner, { flex, wrap = [], bold = [0] }) {
  const need = keep.map((i) => {
    const head = textMm(heads[i], HEAD_PT, true);
    const cells = cellRows.reduce((m, row) => Math.max(m, textMm(row[i], CELL_PT, bold.includes(i))), 0);
    return Math.max(head, cells) + PAD_MM;
  });
  const at = keep.findIndex((i) => heads[i] === flex);
  const widths = [...need];
  const wraps = new Set(at >= 0 ? [flex] : []);
  const total = need.reduce((s, w) => s + w, 0);
  if (total <= inner) {
    // Room to spare: shared out evenly, so no one column (Location, operator 16 Nov) sits half empty
    const each = (inner - total) / widths.length;
    return { widths: widths.map((w) => Math.round((w + each) * 10) / 10), wraps };
  }
  // Too little: Location gives way first, to FLEX_MIN_MM (or less when its longest place needs less)
  const fixed = widths.reduce((s, w, k) => s + (k === at ? 0 : w), 0);
  if (at >= 0) widths[at] = Math.max(Math.min(FLEX_MIN_MM, need[at]), inner - fixed);
  let over = widths.reduce((s, w) => s + w, 0) - inner;
  // Too wide even with Location at its least: the word columns wrap, widest first
  if (over > 0) {
    const givers = keep.map((i, k) => ({ k, h: heads[i] })).filter((g) => wrap.includes(g.h))
      .sort((a, b) => widths[b.k] - widths[a.k]);
    for (const g of givers) {
      if (over <= 0) break;
      const floor = Math.max(WRAP_MIN_MM, textMm(heads[keep[g.k]], HEAD_PT, true) + PAD_MM);
      const give = Math.min(over, Math.max(0, widths[g.k] - floor));
      if (give > 0) { widths[g.k] -= give; over -= give; wraps.add(g.h); }
    }
  }
  // Still over (a fleet with very long names): everything in proportion, as before
  const sum = widths.reduce((s, w) => s + w, 0);
  const k = sum > inner ? inner / sum : 1;
  return { widths: widths.map((w) => Math.round(w * k * 10) / 10), wraps };
}

/**
 * Column widths in mm, by report, for the page's inner width. Only the columns
 * shown (keep) are returned, widened in proportion to fill the page; a report
 * in FIT is fitted to its contents instead (`cellRows`: its rows' cells).
 */
function columnsFor(def, ctx, keep, inner, cellRows = []) {
  const heads = def.columns(ctx);
  const right = (i) => isFigure(def, heads, i);
  const fit = FIT[def.key];
  if (fit) {
    const { widths, wraps } = fitColumns(heads, cellRows, keep, inner, fit);
    return keep.map((i, k) => ({
      h: heads[i],
      ...(right(i) ? { r: true } : {}),
      w: `${widths[k]}mm`,
      ...(wraps.has(heads[i]) ? { wrap: true } : {}),
    }));
  }
  const widths = {
    // Vehicle/Type/Driver widened (operator, 9 Nov 2026: columns were truncating).
    // Type widened further (9 Nov 2026: "COMPANY_VEHICLE" still truncated).
    // Incident columns are centred rather than right-aligned.
    // Follow-up column removed from main table (9 Nov 2026: redundant with the section below).
    behaviour: [32, 26, 36, 14, 14, 14, 12, 11, 14, 10, ...(SHOW_FOLLOW_UP_COLUMN ? [18] : [])],
    night: [40, 34, 36, 34, 56],
    // Location (11 Nov 2026): the place of the top speed, the widest words
    overspeed: [28, 27, 30, 16, 16, 17, 22, 30, 46],
    utilisation: [32, 28, 26, 28, 30, 40],
    utilisationRated: [42, 21, 18, 18, 19, 22, 22, 22],
    // Machine, Type, Hour (or Day), Engine hours, Fuel used, Burn rate, Actual
    machinery: [38, 20, 40, 22, 24, 24, 24],
    // Machine, Type, Shift, Shift hours, Elapsed, Engine hours, Fuel used
    shiftHours: [30, 30, 32, 22, 22, 26, 22],
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

const fmtDayWords = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The Driver Conduct Report's follow-up: how many cases were actioned, the
 * pending ones oldest first, what was done, and the actions by type.
 * ctx.cases: the period's cases; ctx.allCases: every stored case (escalation
 * and the last 7 days of actions look beyond the period).
 */
function followUpFlow(done, ctx, now, start, inner) {
  const cases = ctx.cases ?? [];
  const out = [];
  let k = start;
  const actioned = cases.filter((c) => c.status === 'done');
  const pending = cases.filter((c) => c.status === 'pending').sort((a, b) => a.openedAt - b.openedAt);
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
    out.push(`<h2>${k++}. Feedback received <small>${esc(dayWords)}</small></h2>`);
    out.push(table([
      { h: 'Vehicle', w: '19mm' }, ...(drivers ? [{ h: 'Driver', w: '30mm' }] : []),
      { h: 'Incidents', w: '44mm' }, { h: 'Feedback', w: `${inner - 103 - (drivers ? 30 : 0)}mm` },
      { h: 'Responded by', w: '20mm' },
    ], [...recent].sort((a, b2) => a.actedAt - b2.actedAt).map((c) => [
      b(c.plate), ...(drivers ? [w(c.driver || '-')] : []),
      w(incidentWords(c)),
      w([c.action, c.note].filter(Boolean).join(' — ') || '-'),
      // Who gave the feedback, as the operator typed it (not who recorded it).
      w(c.feedbackBy || '-'),
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
  const cols = columnsFor(def, ctx, keep, inner, done.rows.map((r) => def.cells(r, ctx)));
  const wrapAt = new Set(cols.map((c, k) => (c.wrap ? keep[k] : -1)));
  const reportNo = reportNumber(PREFIX[def.key] ?? 'RP', orgCode, now);
  const date = fmtDate.format(ctx.from);

  const heads = def.columns(ctx);
  // The whole row against the burn rate: green at or below, red above (Machinery, operator 16 Nov 2026)
  // Deeper the further from the rate, mixed with white as solid colours: the PDF prints them as set
  // warn: amber, Shift hours' 50-69% (operator, 17 Nov 2026)
  const ROW_TONE = { good: [[220, 252, 231], [74, 222, 128], '#14532d'], warn: [[254, 243, 199], [251, 191, 36], '#78350f'], bad: [[254, 226, 226], [248, 113, 113], '#7f1d1d'] };
  const rowShade = (r) => {
    const t = ROW_TONE[def.rowTone?.(r)];
    if (!t) return null;
    const d = def.rowDepth?.(r) ?? 0;
    const [lo, hi, ink] = t;
    const c = lo.map((x, k) => Math.round(x + (hi[k] - x) * d));
    return `background:rgb(${c.join(',')});color:${ink}`;
  };
  const cellsOf = (r) => def.cells(r, ctx).map((c, i) => {
    if (i === 0) return vehicleCell(r);
    if (r.noData && i >= def.num) return { html: esc(c), cls: 'm' };
    if (c === '–') return { html: c, cls: 'm' };
    if (def.key === 'behaviour' && heads[i] === 'Total') return { html: esc(c), cls: 'b' };
    if (def.key === 'behaviour' && heads[i] === 'Follow-up') {
      if (c === 'Pending') return { html: tag(c, false).replace('class="tag', 'style="margin-left:0" class="tag') };
      return { html: esc(c), cls: c === 'No case' ? 'm' : '' };
    }
    // A fitted column given too little room for its words wraps them rather than cut them short
    if (wrapAt.has(i)) return { html: esc(c), cls: 'wrap' };
    return esc(c);
  }).filter((_, i) => keep.includes(i));
  // Driver conduct: a row with incidents and no driver on record is shaded grey, every cell of it.
  // Machinery: the row's tone against the burn rate. Either is added to a cell's own style.
  const GREY = `background:${NO_DISPATCH_GREY}`;
  const rowCells = (r) => {
    const shade = def.key === 'behaviour' && noDispatchDriver(r) ? GREY : rowShade(r);
    if (!shade) return cellsOf(r);
    return cellsOf(r).map((v) => {
      const cell = typeof v === 'object' && v ? v : { html: v };
      return { ...cell, style: cell.style ? `${cell.style};${shade}` : shade };
    });
  };

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
    const count = def.countWords ? def.countWords(s.rows) : `${s.rows.length} vehicle${s.rows.length === 1 ? '' : 's'}`;
    flow.push(`<h2>${i + 2}. ${esc(head)} <small>${esc(count)} · ${esc(def.sumWords(s.total))}</small></h2>`);
    flow.push(table(cols, rows.map(rowCells)));
  });
  // A report made for one unit lists each overspeed (operator, 2 Nov 2026)
  const events = ctx.events?.length ? overspeedEventTable(ctx.events) : null;
  if (events) {
    flow.push(`<h2>${done.secs.length + 2}. Each overspeed <small>${events.rows.length} · ${esc(ctx.unit ?? '')}</small></h2>`);
    // #, Started, Ended, Peak at, Duration, Peak / limit, Avg, Distance, [Driver], Where: 184 mm upright
    const widths = [8, 24, 16, 16, 18, 20, 14, 15, ...(events.driver ? [22] : []), events.driver ? 30 : 52];
    flow.push(table(events.head.map((h, i) => ({ h: esc(h), w: `${widths[i]}mm`, r: events.num(i) })),
      events.rows.map((r) => r.map((c) => (c === '-' ? { html: c, cls: 'm' } : esc(c))))));
  }

  const notes = [];
  if (def.key === 'overspeed') {
    notes.push(`Top speed at: the ${ctx.to - ctx.from <= 86_400_000 ? 'time' : 'date and time'} of the GPS reading on which each vehicle reached its top speed in the period, Nairobi time; Location: where that reading was.`);
    if (ctx.peaksFailed) notes.push(`The readings of ${ctx.peaksFailed} vehicle${ctx.peaksFailed === 1 ? '' : 's'} could not be read: their top speed time shows as -.`);
  }
  if (def.key === 'behaviour') {
    if (done.rows.some(noDispatchDriver)) notes.push(noDispatchKey(ctx));
    if (ctx.runsFailed) notes.push('The dispatch runs could not be read: a driver is named only for incidents on the run out now.');
    if (done.rows.some((r) => r.suspect)) notes.push('Check sensor: more than 100 harsh accelerations or brakes a day, far more than a driver makes. Most likely a faulty sensor.');
    if (ctx.cornerSkipped) notes.push(CORNER_SKIPPED_WORDS + '.');
    else if (ctx.cornerFailed) notes.push('Harsh cornering could not be read and is not counted.');
    if (dashcamReachWords(ctx)) notes.push(dashcamReachWords(ctx) + '.');
    if (ctx.dashcamDaysFailed) notes.push(`The dashcam alarms of ${ctx.dashcamDaysFailed} day${ctx.dashcamDaysFailed === 1 ? '' : 's'} could not all be read.`);
    if (ctx.dashcamUntyped) notes.push(`${ctx.dashcamUntyped.toLocaleString('en-GB')} dashcam alarms had no type from the dashcam system and are not counted.`);
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
  if (def.key === 'machinery') {
    notes.push('Burn rate: the machine’s rated litres per engine hour, from the register. A row is green when its actual is at or below it and red when above it, and left plain where the register has no hourly rate for the machine or there is no fuel reading. Actual is fuel used over engine hours, as read, however short the running.');
    notes.push('Engine hours are from the machine’s hour meter; a figure marked * is from the ignition signal, where the meter sent nothing in that row.');
    if (ctx.idle?.length) notes.push(`Did not run in the period: ${ctx.idle.join(', ')}.`);
  }
  if (def.key === 'shiftHours') {
    if (done.rows.some((r) => r.hoursFrom === 'ignition')) notes.push('* From the ignition signal, where the hour meter sent nothing.');
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

  // The report's key: a swatch for each row colour, then a line for each column (operator, 17 Nov 2026)
  if (def.legend) {
    flow.push(`<h2>${next++}. Key</h2>`);
    if (def.legend.tones?.length) {
      const swatch = (tone) => {
        const t = ROW_TONE[tone];
        const bg = t ? `rgb(${t[0].join(',')})` : '#ffffff';
        return `<span style="display:inline-block;width:3.4mm;height:3.4mm;border:0.25mm solid #9ca3af;border-radius:0.6mm;background:${bg};vertical-align:-0.7mm;margin-right:1.6mm"></span>`;
      };
      flow.push(table([{ h: 'Colour', w: '34mm' }, { h: 'Meaning', w: `${inner - 34}mm` }],
        def.legend.tones.map(([tone, name, words]) => [{ html: swatch(tone) + esc(name), cls: 'b' }, { html: esc(words), cls: 'wrap' }])));
    }
    if (def.legend.columns?.length) {
      flow.push(table([{ h: 'Column', w: '34mm' }, { h: 'What it shows', w: `${inner - 34}mm` }],
        def.legend.columns.map(([col, words]) => [{ html: esc(col), cls: 'b' }, { html: esc(words), cls: 'wrap' }])));
    }
  }

  // Room to write by hand on the printed copy
  if (def.key === 'behaviour') flow.push(`<h2>${next++}. Notes</h2>`, ruledLines());

  // Contact line removed (operator, 9 Nov 2026: "remove these words this is a system generated").

  const info = [
    ['Fleet', esc(companyName)],
    ['Period', esc(periodWords)],
    // Driver conduct: the stretch its dashcam alarms cover (operator, 24 Nov 2026)
    ...(def.key === 'behaviour' ? [['Dashcam alarms', esc(dashcamWindowWords(ctx, now))]] : []),
    ['Group', esc(groupWords)],
    // One unit picked (operator, 2 Nov 2026: "generate by the unit")
    ...(ctx.unit ? [['Unit', esc(ctx.unit)]] : []),
    ...(def.key === 'utilisation' && ctx.rated ? [['Consumption', 'As rated on the register: L/h for machines, L/km for vehicles']] : []),
    ...(def.key === 'utilisation' && !ctx.rated ? [['Consumption', esc(`${(RATES[ctx.rate] ?? RATES[DEFAULT_RATE]).label} (${(RATES[ctx.rate] ?? RATES[DEFAULT_RATE]).unit})`)]] : []),
    def.key === 'shiftHours' ? ['Shifts', esc(`${done.rows.length} on approved plans`)]
    : def.countWords ? ['Machines', esc(`${new Set(done.rows.map((r) => r.unit.key)).size} of ${done.units} ran`)]
      : ['Vehicles', `${done.rows.length} reported${def.key === 'utilisation' || def.key === 'night' ? ` of ${done.units}` : ''}`],
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
