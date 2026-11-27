// Every report as a document the operator edits (operator, 4 Nov 2026: "make all
// pdf editable just like end of shift"): the same document End of Shift paints
// (lib/shiftDoc, ShiftDocument) and the server draws (POST reports/document.pdf).
//
// A report nobody edited keeps its own PDF. These are read only when Edit is
// pressed, so each one mirrors its own PDF: Dormant Assets, Geofences, TAT and
// Fuel and Speed mirror fleet-server reports/template-report.pdf; the letterhead
// reports (Driver Conduct, Night Driving, Overspeeding, Utilisation, Tankers) are
// read off the very flow their PDF is laid out from, so nothing is said twice.
//
// Deliveries mirrors the same file's renderDeliveriesPdf.
//
// Pure but for flowDoc's `parse`, which a browser's DOMParser fills in.

import { reportNumber } from './reportLetterhead';
import { textMm } from './shiftDoc';
import { SECTIONS, offlineCount, rowCells as dormantCells, sectionDays, asAtWords } from './offlineReport';
import { counts as geofenceCounts, endsNow, periodWords as geofencePeriod, rowCells as geofenceCells } from './geofenceReport';
import { dayWords, periodWords, rowCells as tatCells, sections as tatSections, summary as tatSummary } from './tatFuelReport';
import { PEAK_COLUMN, peakUrl, rowCells as speedCells, sections as speedSections, summary as speedSummary } from './speedReport';
import { RUN_FIGURES, RUN_HEADS, PLACE_COLUMN, UNIT_FIGURES, UNIT_HEADS, byUnit, mapUrl, runCells, summary as probeSummary, unitCells } from './probeReport';
import { KEY as HEALTH_KEY, NOT_WORKING, WORKING, partStates, byGroup as healthByGroup, cellsFor as healthCells, headsFor as healthHeads, hasFleetList, summary as healthSummary } from './probeHealthReport';
import { reportGroupsFor } from './fleetGroups';
import { FIGURES as FUEL_FILLED_FIGURES, HEADS as FUEL_FILLED_HEADS, rowCells as fuelFilledCells, summary as fuelFilledSummary } from './fuelFilledReport';
import { RECON_FIGURES, RECON_HEADS, dmyOf, reconCells, reconSummary } from './probeRecon';
import { COLUMNS as DELIVERY_HEADS, rowCells as deliveryCells, runWords, sheetSub, spansDays, stopWords, SHEET_STOP_HEADS, sheetStopCells } from './deliveriesReport';

const OFFSET = 3 * 3600_000;
const PORTRAIT_MM = 184;
const LANDSCAPE_MM = 271;
const fmt = (n) => Number(n).toLocaleString('en-GB');
const fmtFixed = (n, digits = 1) => Number(n).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const dmyhm = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`; };
const dmy = (ms) => dmyhm(ms).slice(0, 10);
const plural = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`;
const meta = (pairs) => pairs.map(([label, value]) => ({ label, value: String(value) }));
const textCell = (text, bold = false) => ({ text: String(text ?? ''), ...(bold ? { bold: true } : {}) });
const recoveryTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false });
const loginTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const loginDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
});
export const LOGIN_ACTIVITY_PDF_LIMIT = 5000;

/** Columns from the PDF's own widths, stretched to the sheet. */
function columns(widths, body, { figures = new Set(), wrap = new Set() } = {}) {
  const used = widths.reduce((a, x) => a + x, 0);
  return widths.map((x, i) => ({
    w: Math.round(((x * body) / used) * 10) / 10,
    ...(figures.has(i) ? { align: 'right' } : {}),
    ...(wrap.has(i) ? { wrap: true } : {}),
  }));
}

export function dormantDoc(rep, { fleet, now, orgCode }) {
  const n = offlineCount(rep);
  const asAt = asAtWords(now);
  const cols = [{ w: 52, wrap: true }, { w: 32 }, { w: 0, wrap: true }];
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: `as at ${asAt}` },
    { kind: 'figures', items: [
      ...SECTIONS.map((s) => ({ label: s.words, value: fmt(rep.sections[s.key].length) })),
      { label: 'Not updating', value: `${fmt(n)} of ${fmt(rep.total)}` },
    ] },
    { kind: 'h2', title: '2. Dormant Assets' },
  ];
  for (const s of SECTIONS) {
    const list = rep.sections[s.key];
    blocks.push({ kind: 'bar', title: s.title, aside: `${sectionDays(s, now)} · ${plural(list.length, 'vehicle')}` });
    if (!list.length) blocks.push({ kind: 'none', text: 'None.' });
    else blocks.push({ kind: 'table', cols, head: ['Registration', 'Last message', 'Location'], size: 7.8,
      rows: list.map((r) => dormantCells(r).map((t, i) => textCell(t, i === 0))) });
  }
  if (rep.never.length) blocks.push({ kind: 'note', text: `${plural(rep.never.length, 'vehicle')} ${rep.never.length === 1 ? 'has' : 'have'} never reported to the platform and ${rep.never.length === 1 ? 'is' : 'are'} not listed.` });
  blocks.push({ kind: 'note', text: 'A tracker that stopped sending on the day of the report is not listed yet: it shows the next day, as offline yesterday.' });
  return {
    title: 'DORMANT ASSETS REPORT', docName: `Dormant Assets Report ${fleet}`, pairs: true,
    filename: `Dormant Assets Report ${fleet} ${new Date(now + OFFSET).toISOString().slice(0, 10)}`,
    reportNo: reportNumber('NU', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], ['As at', asAt], ['Vehicles', `${fmt(rep.total)} on the platform`], ['Not updating', fmt(n)]]),
    blocks,
    footer: `${fleet} · Dormant Assets Report · ${asAt}`,
  };
}

export function geofenceDoc(rows, { from, to, fleet, places = null, failed = 0, orgCode, now = Date.now() }) {
  const period = geofencePeriod({ from, to }, now);
  const c = geofenceCounts(rows);
  const live = endsNow(to, now);
  const cols = [{ w: 50, wrap: true }, { w: 0, wrap: true }, { w: 31 }, { w: 31 }, { w: 29, align: 'right' }];
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: period },
    { kind: 'figures', items: [
      { label: 'Visits', value: fmt(c.visits) }, { label: 'Vehicles', value: fmt(c.vehicles) }, { label: 'Geofences visited', value: fmt(c.places) },
      ...(live ? [{ label: 'Still inside', value: fmt(c.still) }] : []),
    ] },
    { kind: 'h2', title: '2. Geofence Visits', aside: plural(rows.length, 'visit') },
    rows.length
      ? { kind: 'table', cols, head: ['Registration', 'Geofence', 'Time in', 'Time out', 'Duration in geofence'], size: 7.8,
        rows: rows.map((r) => geofenceCells(r, { to, now }).map((t, i) => textCell(t, i === 0))) }
      : { kind: 'none', text: 'No vehicle was in a geofence in the period.' },
  ];
  if (failed) blocks.push({ kind: 'note', text: `${plural(failed, 'vehicle')} could not be read and ${failed === 1 ? 'is' : 'are'} left out.` });
  const first = new Date(from + OFFSET).toISOString().slice(0, 10);
  const last = new Date(Math.max(from, to - 1) + OFFSET).toISOString().slice(0, 10);
  return {
    title: 'GEOFENCE REPORT', docName: `Geofence Report ${fleet}`, pairs: true,
    filename: `Geofence Report ${fleet} ${first === last ? first : `${first} to ${last}`}`,
    reportNo: reportNumber('GF', orgCode, now), date: dmy(Math.max(from, to - 1)),
    meta: meta([
      ['Fleet', fleet], ['Period', period], ['Geofences', places == null ? 'All' : `${fmt(places.length)} picked`],
      ['Visits', `${fmt(rows.length)} by ${plural(c.vehicles, 'vehicle')}`], ['Generated', dmyhm(now)],
    ]),
    blocks,
    footer: `${fleet} · Geofence Report · ${period}`,
  };
}

const TAT_HEADS = ['Reg No', 'Trip Duration', 'Initial (L)', 'Top Ups (L)', 'Total (L)', 'Consumption', 'Theft (L)', 'Final (L)', 'Station', 'KM', 'KM/L', 'Tank (L)', 'Comment', 'Base'];
const TAT_WIDTHS = [20, 48, 14, 17, 14, 20, 15, 14, 25, 10, 11, 13, 30, 14];
const TAT_COLS = { figures: new Set([2, 3, 4, 5, 6, 7, 9, 10, 11]), wrap: new Set([0, 1, 8, 12, 13]) };

export function tatDoc(rows, { day, to = day, fleet, group = 'all', orgCode, now = Date.now() }) {
  const s = tatSummary(rows);
  const several = to !== day;
  const date = to.split('-').reverse().join('/');
  const words = periodWords(day, to);
  const cols = columns(TAT_WIDTHS, LANDSCAPE_MM, TAT_COLS);
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Trips', value: fmt(s.trips) }, { label: 'Units on trips', value: fmt(s.units) },
      { label: 'Fuel used, L', value: fmt(Math.round(s.litres)) }, { label: 'Distance, km', value: fmt(Math.round(s.km)) },
      { label: 'Rate, km/L', value: s.rate == null ? '-' : s.rate.toFixed(2) }, { label: 'Not updating', value: fmt(s.notUpdating) },
    ] },
  ];
  tatSections(rows).forEach((sec, i) => {
    blocks.push({ kind: 'h2', title: `${i + 2}. ${sec.group}`, aside: plural(sec.rows.length, 'row') });
    blocks.push({ kind: 'table', cols, head: TAT_HEADS, size: 6.8, rows: sec.rows.map((r) => tatCells(r).map((t, k) => textCell(t, k === 0))) });
  });
  return {
    title: 'TAT AND FUEL REPORT', docName: `TAT and Fuel Report ${fleet}`, pairs: true, landscape: true,
    filename: `TAT and Fuel Report ${fleet} ${day}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('TF', orgCode, now), date,
    meta: meta([['Fleet', fleet], ['Units', group === 'all' ? 'All units' : group], [several ? 'Days' : 'Day', words], ['Trips', `Finished ${several ? 'on these days' : 'on the day'} (${fmt(s.trips)})`]]),
    blocks,
    footer: `${fleet} · TAT and Fuel Report · ${several ? words : date}`,
  };
}

const SPEED_HEADS = ['Registration', 'Group', 'Mileage (km)', 'Max. Speed', 'Limit', 'Exceeded By', 'Over Distance (km)', 'Occurrences'];
const SPEED_WIDTHS = [50, 15, 20, 18, 15, 20, 28, 19];
const SPEED_FIGURES = new Set([2, 3, 4, 5, 6, 7]);

export function speedDoc(rows, { day, fleet, group = 'all', orgCode, now = Date.now() }) {
  const s = speedSummary(rows);
  const date = day.split('-').reverse().join('/');
  const words = dayWords(day);
  // The Registration column takes what is left, so the pages can be turned for the JPEG
  const cols = columns(SPEED_WIDTHS, PORTRAIT_MM, { figures: SPEED_FIGURES, wrap: new Set([0, 1]) }).map((c, i) => (i === 0 ? { ...c, w: 0 } : c));
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Units over the limit', value: fmt(s.units) }, { label: 'Occurrences', value: fmt(s.occurrences) },
      { label: 'Highest speed', value: s.fastest ? `${Math.round(s.fastest)} km/h` : '-' },
      { label: 'Distance over, km', value: s.overKm.toLocaleString('en-GB', { maximumFractionDigits: 1 }) }, { label: 'Mileage, km', value: fmt(Math.round(s.km)) },
    ] },
  ];
  speedSections(rows).forEach((sec, i) => {
    blocks.push({ kind: 'h2', title: `${i + 2}. ${sec.group}`, aside: plural(sec.rows.length, 'unit') });
    blocks.push({ kind: 'table', cols, head: SPEED_HEADS, size: 7.8, rows: sec.rows.map((r) => speedCells(r).map((t, k) => {
      const link = k === PEAK_COLUMN ? peakUrl(r) : null;
      return { ...textCell(t, k === 0), ...(link ? { link } : {}) };
    })) });
  });
  return {
    title: 'SPEED REPORT', docName: `Speed Report ${fleet}`, pairs: true,
    filename: `Speed Report ${fleet} ${day}`,
    reportNo: reportNumber('SP', orgCode, now), date,
    meta: meta([['Fleet', fleet], ['Units', group === 'all' ? 'All units' : group], ['Day', words], ['Over the limit', plural(s.units, 'unit')]]),
    blocks,
    footer: `${fleet} · Speed Report · ${date}`,
  };
}

export function recoveryDoc(report, { fleet, orgCode, now = report.generatedAt ?? Date.now() }) {
  const vehicles = report.vehicles ?? [];
  const measured = vehicles.filter((v) => v.available && v.hasTelemetry);
  const total = (key) => measured.some((v) => v[key] != null)
    ? measured.reduce((sum, v) => sum + (v[key] ?? 0), 0)
    : null;
  const day = report.day;
  const dayDate = day.split('-').reverse().join('/');
  const dayWordsText = dayWords(day);
  const distance = total('distanceKm');
  const fuel = total('fuelConsumedL');
  const stopCount = total('stopsTotal');
  const heads = ['Registration', 'Recovery type', 'Distance (km)', 'Fuel (L)', 'Stops'];
  const summaryCols = columns([32, 38, 34, 32, 20], PORTRAIT_MM, {
    figures: new Set([2, 3, 4]), wrap: new Set([0, 1]),
  });
  const blocks = [
    { kind: 'h2', title: '1. Daily overview', aside: dayWordsText },
    { kind: 'figures', items: [
      { label: 'Vehicles with GPS', value: fmt(measured.length) },
      { label: 'Distance, km', value: distance == null ? '-' : fmtFixed(distance) },
      { label: 'Fuel consumed, L', value: fuel == null ? '-' : fmtFixed(fuel) },
      { label: 'Stops over 5 min', value: stopCount == null ? '-' : fmt(stopCount) },
    ] },
    { kind: 'table', cols: summaryCols, head: heads, size: 7.8, rows: vehicles.map((v) => [
      textCell(v.plate, true),
      textCell(v.recoveryType === 'puncture' ? 'Puncture recovery' : 'Mechanical recovery'),
      textCell(v.distanceKm == null ? '-' : fmtFixed(v.distanceKm)),
      textCell(v.fuelConsumedL == null ? '-' : fmtFixed(v.fuelConsumedL)),
      textCell(v.stopsTotal == null ? '-' : fmt(v.stopsTotal)),
    ]) },
    { kind: 'note', text: 'Stops are GPS stands of at least five minutes. Fuel is shown only when the day’s readings support a measurement. The route trace joins GPS fixes and is not a road map.' },
  ];

  vehicles.forEach((v, i) => {
    const type = v.recoveryType === 'puncture' ? 'Puncture' : 'Mechanical';
    blocks.push({ kind: 'h2', title: `${i + 2}. ${v.plate}`, aside: `${type} recovery` });
    if (!v.available) {
      blocks.push({ kind: 'none', text: 'Vehicle data is unavailable for this organisation or your vehicle access scope.' });
      return;
    }
    if (!v.hasTelemetry) {
      blocks.push({ kind: 'none', text: `No GPS telemetry was recorded on ${dayWordsText}.` });
      return;
    }

    const route = v.route ?? [];
    if (route.length) {
      const maxPoints = 25;
      const stride = Math.max(1, Math.ceil(route.length / maxPoints));
      const points = route.filter((_, j) => j % stride === 0);
      if (points[points.length - 1] !== route[route.length - 1]) points.push(route[route.length - 1]);
      blocks.push({ kind: 'h3', title: 'GPS route', aside: `${plural(route.length, 'fix')}${points.length < route.length ? ` · ${points.length} shown` : ''}` });
      blocks.push({ kind: 'table', cols: columns([20, 42, 42], PORTRAIT_MM), head: ['Point', 'Latitude', 'Longitude'], size: 7.8,
        rows: points.map(([lat, lng], j) => [textCell(j + 1), textCell(Number(lat).toFixed(5)), textCell(Number(lng).toFixed(5))]) });
    } else {
      blocks.push({ kind: 'none', text: 'No GPS route was recorded.' });
    }

    const stops = v.stops ?? [];
    blocks.push({ kind: 'h3', title: 'Stops over 5 minutes', aside: plural(stops.length, 'stop') });
    if (!stops.length) {
      blocks.push({ kind: 'none', text: 'No stops over five minutes.' });
    } else {
      blocks.push({ kind: 'table', cols: columns([0, 20, 20, 20, 25, 25, 74], PORTRAIT_MM, { wrap: new Set([0, 6]) }),
        head: ['Location', 'Arrived', 'Left', 'Duration', 'Latitude', 'Longitude', 'Remark'], size: 7.4,
        rows: stops.map((s) => [
          textCell(s.location ?? '–'),
          textCell(recoveryTime.format(s.arrivedAt)),
          textCell(recoveryTime.format(s.leftAt)),
          textCell(`${Math.round(s.durationMs / 60_000)} min`),
          textCell(s.lat == null ? '–' : Number(s.lat).toFixed(5)),
          textCell(s.lng == null ? '–' : Number(s.lng).toFixed(5)),
          textCell(s.remark ?? '–'),
        ]) });
    }
  });

  return {
    title: 'RECOVERY VEHICLE REPORT', docName: `Recovery Vehicle Report ${fleet}`, pairs: true,
    filename: `Recovery Vehicle Report ${fleet} ${day}`,
    reportNo: reportNumber('RC', orgCode, now), date: dayDate,
    meta: meta([['Fleet', fleet], ['Day', dayWordsText], ['Vehicles', fmt(vehicles.length)], ['Vehicles with GPS', fmt(measured.length)]]),
    blocks,
    footer: `${fleet} · Recovery Vehicle Report · ${dayDate}`,
  };
}

/** Successful organisation-scoped sign-ins as an editable report document. */
export function loginActivityDoc(report, { organisation, orgCode, from, to, now = Date.now() }) {
  const rows = report.rows ?? [];
  if (rows.length > LOGIN_ACTIVITY_PDF_LIMIT) {
    throw new Error(`This PDF supports up to ${fmt(LOGIN_ACTIVITY_PDF_LIMIT)} successful sign-ins. Narrow the date range.`);
  }

  const fleet = String(organisation ?? 'Fleet').trim() || 'Fleet';
  const safeFleet = fleet.replace(/[^\w .-]/g, '') || 'Fleet';
  const fromWords = loginDay.format(new Date(`${from}T00:00:00Z`));
  const toWords = loginDay.format(new Date(`${to}T00:00:00Z`));
  const period = from === to ? fromWords : `${fromWords} to ${toWords}`;
  const uniqueUsers = new Set(rows.map((row) => row.user?.id).filter(Boolean)).size;
  const cols = columns([34, 36, 39, 39, 36], PORTRAIT_MM, { wrap: new Set([1, 2, 3, 4]) });
  const blocks = [
    { kind: 'h2', title: '1. Successful Sign-ins', aside: period },
    { kind: 'figures', items: [
      { label: 'Successful sign-ins', value: fmt(rows.length) },
      { label: 'Users with sign-ins', value: fmt(uniqueUsers) },
      { label: 'Accounts ever logged in', value: fmt(report.everLoggedIn ?? 0) },
      { label: 'System accounts', value: fmt(report.systemUsers ?? 0) },
    ] },
    { kind: 'h2', title: '2. Sign-in log', aside: plural(rows.length, 'successful sign-in') },
    rows.length
      ? {
        kind: 'table', cols, head: ['Date and time (EAT)', 'User', 'Email', 'Role', 'Groups'], size: 7.8,
        rows: rows.map((row) => {
          const groups = Array.isArray(row.user?.groups) ? row.user.groups : [];
          const roles = Array.isArray(row.user?.roles) ? row.user.roles : [];
          return [
            textCell(loginTime.format(new Date(row.loggedInAt))),
            textCell(row.user?.fullName || 'Unknown user', true),
            textCell(row.user?.email || '—'),
            textCell(roles.length ? roles.join(', ') : 'No role assigned'),
            textCell(groups.length ? groups.join(', ') : 'Ungrouped'),
          ];
        }),
      }
      : { kind: 'none', text: 'No successful sign-ins in this date range.' },
    { kind: 'note', text: 'This report includes successful sign-ins only. Failed sign-in attempts are not recorded in this report.' },
  ];

  return {
    title: 'LOGIN ACTIVITY REPORT',
    docName: `Login Activity Report ${fleet}`,
    pairs: true,
    filename: `Login Activity Report ${safeFleet} ${from}${from === to ? '' : ` to ${to}`}`,
    reportNo: reportNumber('LA', orgCode, now),
    date: dmy(now),
    meta: meta([
      ['Organisation', fleet],
      ['Period', period],
      ['Scope', 'Successful sign-ins only'],
      ['Time zone', 'Africa/Nairobi'],
      ['Ever logged in', fmt(report.everLoggedIn ?? 0)],
    ]),
    blocks,
    footer: `${fleet} · Login Activity Report · ${period}`,
  };
}

/** Not a mirror: this report has no PDF of its own, the server draws this document. */
export function probeDoc(rows, { from, to, fleet, orgCode, now = Date.now() }) {
  const s = probeSummary(rows);
  const several = from !== to;
  const words = periodWords(from, to);
  const align = (i, figures) => (figures.has(i) ? { align: 'right' } : {});
  const unitCols = [{ w: 0, wrap: true }, { w: 26 }, { w: 16 }, { w: 34 }, { w: 34 }].map((c, i) => ({ ...c, ...align(i, UNIT_FIGURES) }));
  const runCols = [{ w: 50, wrap: true }, { w: 32 }, { w: 32 }, { w: 14 }, { w: 16 }, { w: 0, wrap: true }].map((c, i) => ({ ...c, ...align(i, RUN_FIGURES) }));
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Units', value: fmt(s.units) }, { label: 'Disconnections', value: fmt(s.runs) }, { label: 'Alerts', value: fmt(s.alerts) },
    ] },
    { kind: 'h2', title: '2. By unit', aside: plural(s.units, 'unit') },
    { kind: 'table', cols: unitCols, head: UNIT_HEADS, size: 7.8, rows: byUnit(rows).map((u) => unitCells(u).map((t, k) => textCell(t, k === 0))) },
    { kind: 'h2', title: '3. Each disconnection', aside: plural(s.runs, 'disconnection') },
    { kind: 'table', cols: runCols, head: RUN_HEADS, size: 7.8, rows: rows.map((r) => runCells(r).map((t, k) => {
      const link = k === PLACE_COLUMN ? mapUrl(r) : '';
      return { ...textCell(t, k === 0), ...(link ? { link } : {}) };
    })) },
  ];
  return {
    title: 'PROBE DISCONNECTION REPORT', docName: `Probe Disconnection Report ${fleet}`, pairs: true,
    filename: `Probe Disconnection Report ${fleet} ${from}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('PD', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], [several ? 'Days' : 'Day', words], ['Units', plural(s.units, 'unit')], ['Disconnections', fmt(s.runs)]]),
    blocks,
    footer: `${fleet} · Probe Disconnection Report · ${words}`,
  };
}

/**
 * The Probe & Sensor Health report: the Probes table's filtered rows, `note`
 * saying which filter. `trucks` names it for the Trucks filter. Grouped by the
 * fleet's list (lib/fleetGroups) when it has one.
 */
export function probeHealthDoc(rows, { note = '', fleet, trucks = false, orgCode, groups = reportGroupsFor(orgCode), now = Date.now(), landscape = false, fleetList = undefined }) {
  const asAt = dmyhm(now);
  const items = healthSummary(rows).map((x) => ({ label: x.label, value: fmt(x.value), ...(x.flag ? { flag: true } : {}) }));
  const blocks = [{ kind: 'h2', title: '1. Overview', aside: `as at ${asAt}` }];
  for (let i = 0; i < items.length; i += 3) blocks.push({ kind: 'figures', items: items.slice(i, i + 3) });
  blocks.push({ kind: 'h2', title: '2. Hardware by unit', aside: note || plural(rows.length, 'unit') });
  // Driver and Status from the client's fleet list, when its units are on it (operator, 13 Nov 2026)
  const listed = hasFleetList(rows, fleetList);
  const head = healthHeads(rows, fleetList);
  const info = listed ? 4 : 2;             // the columns before the parts
  // Across the whole page, upright or turned (operator, 13 Nov 2026: "the columns are so squeezed")
  const body = landscape ? LANDSCAPE_MM : PORTRAIT_MM;
  const cols = listed
    ? columns([22, 24, 38, 21, 19, 19, 19, 19], body, { wrap: new Set([0, 2]) })
    : columns([40, 28, 29, 29, 29, 29], body, { wrap: new Set([0]) });
  // A part's cell is its last reading; the verdict decides how it looks: a
  // stopped part stands out, what cannot be judged steps back. A truck in an
  // accident stands out too
  const cell = (t, i, states) => {
    if (i < info) return listed && i === 3 && t === 'Accident' ? { text: t, bold: true, tone: 'flag' } : textCell(t, i === 0);
    const st = states[i - info];
    return st === NOT_WORKING ? { text: t, bold: true, tone: 'flag', fill: '#fbe3e0' }
      : st === WORKING ? textCell(t) : { text: t, tone: 'mut' };
  };
  const table = (list) => ({ kind: 'table', cols, head, size: 7.8,
    rows: list.map((r) => { const states = partStates(r); return healthCells(r, listed, fleetList).map((t, i) => cell(t, i, states)); }) });
  // By the client's fleet-list groups (Tankers, Finished Goods, ...) where the
  // fleet has a list; one table otherwise.
  const grouped = healthByGroup(rows, groups);
  if (!rows.length) blocks.push({ kind: 'none', text: 'Nothing matched the current filters.' });
  else if (!grouped) blocks.push(table(rows));
  else for (const g of grouped) blocks.push({ kind: 'bar', title: g.name, aside: plural(g.rows.length, 'unit') }, table(g.rows));
  if (rows.length) blocks.push({ kind: 'note', text: HEALTH_KEY });
  const name = trucks ? 'Trucks Probe & Sensor Health' : 'Probe & Sensor Health';
  return {
    title: name.toUpperCase(), docName: `${name} ${fleet}`, pairs: true,
    filename: `${name} ${fleet} ${new Date(now + OFFSET).toISOString().slice(0, 10)}`,
    reportNo: reportNumber('PH', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], ['As at', asAt], ['Units', fmt(rows.length)], ['Filter', note || 'All']]),
    blocks,
    footer: `${fleet} · ${name} · ${asAt}`,
  };
}

const DELIVERY_WIDTHS = [22, 42, 24, 52, 44];
/** A sheet's stop table: the server's SHEET_STOP_WIDTHS, so an edited PDF reads as the drawn one. */
const SHEET_STOP_WIDTHS = [6, 19, 20, 17, 12, 14, 14, 28, 17, 8, 15, 15];
const sheetStopCols = columns(SHEET_STOP_WIDTHS, PORTRAIT_MM, { figures: new Set([0, 5, 6, 9]), wrap: new Set([1, 2, 3, 4, 7, 8, 10, 11]) });

/** The Deliveries Report. `stops: false` is the sheet's table alone, as its PDF. */
export function deliveriesDoc(rows, { from, at, fleet, group = null, stops = true, orgCode, now = Date.now() }) {
  const withDay = spansDays(from, at);
  const orders = `${fmt(rows.reduce((n, r) => n + r.fulfilled, 0))}/${fmt(rows.reduce((n, r) => n + r.planned, 0))}`;
  const period = `${dmyhm(from)} to ${dmyhm(at)}`;
  // Current location takes what is left, so the pages can be turned for the JPEG
  const cols = columns(DELIVERY_WIDTHS, PORTRAIT_MM, { figures: new Set([2]), wrap: new Set([0, 1, 3, 4]) }).map((c, i) => (i === 3 ? { ...c, w: 0 } : c));
  const sheet = rows.length
    ? { kind: 'table', cols, head: DELIVERY_HEADS, size: 7.8, rows: rows.map((r) => deliveryCells(r).map((t, i) => textCell(t, i === 0))) }
    : { kind: 'none', text: 'No vehicles in the report.' };
  const blocks = [];
  if (!stops) {
    blocks.push({ kind: 'bar', title: withDay ? `${dmy(from)} to ${dmy(at)}` : dmy(at), aside: plural(rows.length, 'vehicle') }, sheet);
  } else {
    blocks.push(
      { kind: 'h2', title: '1. Overview', aside: `as at ${dmyhm(at)}` },
      { kind: 'figures', items: [
        { label: 'Vehicles', value: fmt(rows.length) },
        { label: 'Out on delivery', value: fmt(rows.filter((r) => r.trip.leftAt != null && r.trip.arrivedAt == null).length) },
        { label: 'Back at storage', value: fmt(rows.filter((r) => r.trip.arrivedAt != null).length) },
        { label: 'Orders fulfilled', value: orders },
      ] },
      { kind: 'h2', title: '2. Deliveries', aside: period },
      sheet,
      { kind: 'h2', title: '3. Customers by vehicle' },
    );
    for (const r of rows) {
      blocks.push({ kind: 'h3', title: r.plate, aside: runWords(r, withDay) });
      if (r.sheet) blocks.push({ kind: 'note', text: sheetSub(r) });
      if (!r.customers.length) { blocks.push({ kind: 'none', text: 'No customers given.' }); continue; }
      // A Planner sheet: its own columns, customer ID and name first
      if (r.customers.some((c) => c.stop)) {
        blocks.push({ kind: 'table', cols: sheetStopCols, head: SHEET_STOP_HEADS, size: 6.2,
          rows: r.customers.map((c) => sheetStopCells(c, withDay).map((t, i) => (i === 7
            ? { text: t, ...(c.at != null ? { bold: true } : { tone: 'flag' }) } : textCell(t)))) });
        continue;
      }
      blocks.push({ kind: 'table', cols: [{ w: 0, wrap: true }, { w: 68, wrap: true }], head: ['Stop', 'Result'], size: 7.8,
        rows: r.customers.map((c) => [textCell(c.label),
          { text: stopWords(c, withDay), ...(c.at != null ? { bold: true } : c.missing ? { tone: 'mut' } : { tone: 'flag' }) }]) });
    }
  }
  return {
    title: 'DELIVERIES REPORT', docName: `Deliveries Report ${fleet}`, pairs: true,
    filename: `Deliveries Report ${fleet} ${new Date(at + OFFSET).toISOString().slice(0, 10)}`,
    reportNo: reportNumber('DL', orgCode, now), date: dmy(at),
    meta: meta([['Fleet', fleet], ['Window', period], ['Units', group ?? 'All groups'], ['Vehicles', fmt(rows.length)], ['As at', dmyhm(at)], ['Orders fulfilled', orders]]),
    blocks,
    footer: `${fleet} · Deliveries Report · ${dmyhm(at)}`,
  };
}

// ── the letterhead reports: read off the flow their PDF is laid out from ─────

const HEX = /#[0-9a-f]{6}/i;

/** A cell's words, with any tag beside them set off: "KCS 082M · Check sensor". */
function wordsOf(el) {
  const out = [];
  el.childNodes.forEach((n) => {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  });
  return out.join(' · ');
}

/** The PDF prints a heading on one line, in 7.2 pt bold, in the room its column has. */
const HEAD_PT = 7.2;
const HEAD_PAD_MM = 3.8;

/** Columns wide enough for their headings, the room taken from those whose text wraps. */
export function roomForHeads(cols, head) {
  const out = cols.map((c) => ({ ...c }));
  out.forEach((c, i) => {
    if (!c.w) return;
    const short = textMm(head[i], HEAD_PT, true) + HEAD_PAD_MM - c.w;
    if (short <= 0) return;
    const giver = out.reduce((best, g, k) => (k !== i && g.wrap && g.w > (best?.w ?? 0) ? g : best), null);
    const need = (t) => textMm(head[out.indexOf(t)], HEAD_PT, true) + HEAD_PAD_MM;
    const spare = giver ? Math.max(0, giver.w - need(giver)) : 0;
    const moved = Math.min(short, spare);
    if (!moved) return;
    c.w = Math.round((c.w + moved) * 10) / 10;
    giver.w = Math.round((giver.w - moved) * 10) / 10;
  });
  return out;
}

/** One `table.lst` as a document table. */
function tableOf(el, inner) {
  const widths = [...el.querySelectorAll('col')].map((c) => {
    const m = /width:\s*([\d.]+)mm/.exec(c.getAttribute('style') ?? '');
    return m ? Number(m[1]) : 0;
  });
  const heads = [...el.querySelectorAll('th')];
  const trs = [...el.querySelectorAll('tbody tr')];
  const wraps = new Set();
  const rows = trs.map((tr) => [...tr.querySelectorAll('td')].map((td, i) => {
    if (td.classList.contains('wrap')) wraps.add(i);
    const fill = HEX.exec(td.getAttribute('style') ?? '')?.[0];
    return {
      text: wordsOf(td),
      ...(td.classList.contains('b') ? { bold: true } : {}),
      ...(td.classList.contains('m') ? { tone: 'mut' } : {}),
      ...(fill ? { fill } : {}),
    };
  }));
  const used = widths.reduce((a, x) => a + x, 0);
  const head = heads.map((h) => h.textContent.trim());
  return {
    kind: 'table',
    // Scaled only when they would not fit; a report with room keeps its own widths
    cols: roomForHeads(widths.map((w, i) => ({
      w: used > inner ? Math.round(((w * inner) / used) * 10) / 10 : w,
      ...(heads[i]?.classList.contains('r') ? { align: 'right' } : heads[i]?.classList.contains('c') ? { align: 'center' } : {}),
      ...(wraps.has(i) ? { wrap: true } : {}),
    })), head),
    head,
    rows,
    size: 7.8,
  };
}

/** The flow's blocks: headings, figures, tables and notes. */
export function flowBlocks(flow, inner, parse) {
  const root = parse(flow.join(''));
  const blocks = [];
  for (const el of [...root.children]) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script') continue;
    if (tag === 'h2') {
      const small = el.querySelector('small');
      const aside = small?.textContent.trim();
      small?.remove();
      blocks.push({ kind: 'h2', title: el.textContent.trim(), ...(aside ? { aside } : {}) });
    } else if (el.matches('table.cells')) {
      blocks.push({ kind: 'figures', items: [...el.querySelectorAll('td')].map((td) => {
        const label = td.querySelector('span');
        const name = label?.textContent.trim() ?? '';
        label?.remove();
        return { label: name, value: td.textContent.trim() };
      }) });
    } else if (el.matches('table.lst')) {
      blocks.push(tableOf(el, inner));
    } else if (el.classList.contains('none')) {
      blocks.push({ kind: 'none', text: el.textContent.trim() });
    } else {
      const text = el.textContent.trim();
      if (text) blocks.push({ kind: 'note', text });
    }
  }
  return blocks;
}

/** The six alarm kinds the AI Alarm Distribution report shows. */
export const ALARM_KINDS = ['fatigue', 'phone', 'smoking', 'covered', 'distracted', 'seatbelt'];

/**
 * The rows without the server's Other (operator, 11 Nov 2026: "let's remove others in the AI alarms
 * report"): each Total is the six kinds shown, so the columns add up, and a unit with Other alone goes.
 * Sorted again as the server sorts (most alarms first, then plate): its order was by the old Total.
 */
export function withoutOther(rows) {
  return (rows ?? []).map((r) => {
    const rest = { ...r };
    delete rest.other;
    return { ...rest, total: ALARM_KINDS.reduce((n, k) => n + (r[k] ?? 0), 0) };
  }).filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || String(a.plate ?? '').localeCompare(String(b.plate ?? '')));
}

/** AI Alarm Distribution Report — per-vehicle breakdown of dashcam alarm types. */
export function alarmDistDoc(rows, { from, to, fleet, orgCode, partial = false, now = Date.now() }) {
  const several = from !== to;
  const period = several ? `${from} – ${to}` : from;
  const totalAlarms = rows.reduce((s, r) => s + r.total, 0);
  const ALARM_COLS = [
    { key: 'fatigue',    label: 'Fatigue Driving' },
    { key: 'phone',      label: 'Phone Call' },
    { key: 'smoking',    label: 'Smoking' },
    { key: 'covered',    label: 'Camera Covered' },
    { key: 'distracted', label: 'Distracted Driving' },
    { key: 'seatbelt',   label: 'No Seat Belt' },
  ];
  // Widths: device name wide, then 7 numeric columns equal
  const NUM_COLS = ALARM_COLS.length + 1; // Total + each alarm type
  const nameW = 46;
  const numW = Math.round((LANDSCAPE_MM - nameW) / NUM_COLS * 10) / 10;
  const cols = [
    { w: nameW, wrap: true },
    ...Array(NUM_COLS).fill({ w: numW, align: 'right' }),
  ];
  const head = ['Device Name', 'Total', ...ALARM_COLS.map((c) => c.label)];
  const tableRows = rows.map((r) => [
    textCell(r.plate, true),
    textCell(fmt(r.total)),
    ...ALARM_COLS.map((c) => textCell(fmt(r[c.key] ?? 0))),
  ]);
  // Footer totals row
  tableRows.push([
    { text: 'Total', bold: true },
    { text: fmt(totalAlarms), bold: true },
    ...ALARM_COLS.map((c) => ({ text: fmt(rows.reduce((s, r) => s + (r[c.key] ?? 0), 0)), bold: true })),
  ]);
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: period },
    { kind: 'figures', items: [
      { label: 'Vehicles', value: fmt(rows.length) },
      { label: 'Total Alarms', value: fmt(totalAlarms) },
      ...ALARM_COLS.slice(0, 4).map((c) => ({ label: c.label, value: fmt(rows.reduce((s, r) => s + (r[c.key] ?? 0), 0)) })),
    ]},
    { kind: 'h2', title: '2. By vehicle', aside: plural(rows.length, 'vehicle') },
    { kind: 'table', cols, head, size: 7.5, rows: tableRows },
    // The dashcam server gave only part: the counts are short, and the reader must know.
    ...(partial ? [{ kind: 'note', text: 'The dashcam server returned only part of the alarms for this period, so these counts are lower than the true figures.' }] : []),
  ];
  return {
    title: 'AI ALARM DISTRIBUTION REPORT',
    docName: `AI Alarm Distribution Report ${fleet}`,
    filename: `AI Alarm Distribution Report ${fleet} ${from}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('AD', orgCode, now),
    date: dmy(now),
    meta: meta([['Fleet', fleet], [several ? 'Days' : 'Day', period], ['Vehicles', fmt(rows.length)], ['Total Alarms', fmt(totalAlarms)]]),
    blocks,
    footer: `${fleet} · AI Alarm Distribution · ${period}`,
    landscape: true,
  };
}

/** Unauthorized Passengers Report — portrait, one row per logged incident. */
export function uprDoc(rows, { from, to, fleet, orgCode, now = Date.now() }) {
  const several = from !== to;
  const period = several ? `${from} – ${to}` : from;
  const fmtAt = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms + OFFSET);
    const s = d.toISOString();
    return `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)} ${s.slice(11,16)}`;
  };
  const cols = [
    { w: 32 },
    { w: 42, wrap: true },
    { w: 36 },
    { w: 60, wrap: true },
    { w: 24 },
  ];
  const head = ['Registration', 'Client / Location', 'Time of Event', 'Violation', 'Shared'];
  const tableRows = rows.map((r) => [
    textCell(r.plate || '—'),
    textCell(r.location || fleet || '—', false),
    textCell(fmtAt(r.at)),
    textCell('Unauthorized Passengers'),
    textCell(r._shared ? 'Shared ✓' : '—'),
  ]);
  const blocks = [
    { kind: 'h2', title: '1. Summary', aside: period },
    { kind: 'figures', items: [
      { label: 'Incidents', value: fmt(rows.length) },
      { label: 'Fleet', value: fleet || '—' },
    ]},
    { kind: 'h2', title: '2. Incidents', aside: plural(rows.length, 'incident') },
    { kind: 'table', cols, head, size: 8, rows: tableRows },
  ];
  return {
    title: 'UNAUTHORIZED PASSENGERS REPORT',
    docName: `Unauthorized Passengers Report ${fleet}`,
    filename: `Unauthorized Passengers Report ${fleet} ${from}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('UP', orgCode, now),
    date: dmy(now),
    meta: meta([['Fleet', fleet], [several ? 'Days' : 'Day', period], ['Incidents', fmt(rows.length)]]),
    blocks,
    footer: `${fleet} · Unauthorized Passengers · ${period}`,
    landscape: false,
  };
}

/**
 * Fuel Consumption Rate Report — per-vehicle efficiency over a date range, as
 * the server works it out (fleet-server reports/range-reports): `rows` and
 * `totals` are its answer; nothing is recomputed here.
 */
export function fcrDoc(rows, { from, to, fleet, orgCode, totals = null, now = Date.now() }) {
  const several = from !== to;
  const period = several ? `${from} – ${to}` : from;
  const L = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));
  const R = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));
  const totalFilled = rows.reduce((s, r) => s + (r.filledL || 0), 0);
  const words = (r) => r.note || (r.belowTarget === true ? 'Below target' : r.belowTarget === false ? 'On target' : '');

  const nameW = 34;
  const commentW = 44;
  const numW = Math.round(((LANDSCAPE_MM - nameW - commentW) / 8) * 10) / 10;
  const cols = [{ w: nameW, wrap: true }, ...Array(8).fill({ w: numW, align: 'right' }), { w: commentW, wrap: true }];
  const head = ['Registration', 'Target (km/L)', 'Distance (km)', 'Initial (L)', 'Filled (L)', 'Theft (L)', 'Final (L)', 'Consumed (L)', 'Rate (km/L)', 'Comment'];
  const tableRows = rows.map((r) => [
    textCell(r.plate, true),
    textCell(r.target?.words ?? '—'),
    textCell(L(r.distanceKm)),
    textCell(L(r.startL)),
    textCell(L(r.filledL)),
    textCell(r.theftL ? L(r.theftL) : '—'),
    textCell(L(r.endL)),
    textCell(L(r.consumedL)),
    r.belowTarget ? { text: R(r.kmPerL), bold: true, tone: 'flag' } : textCell(R(r.kmPerL)),
    r.note ? { text: words(r), tone: 'mut' } : textCell(words(r)),
  ]);
  tableRows.push([
    { text: 'Total / Fleet', bold: true }, { text: '—' },
    { text: L(totals?.distanceKm), bold: true }, { text: '—' },
    { text: L(totalFilled), bold: true }, { text: '—' }, { text: '—' },
    { text: L(totals?.consumedL), bold: true }, { text: R(totals?.kmPerL), bold: true },
    { text: totals ? `${fmt(totals.measured)} of ${fmt(rows.length)} measured` : '' },
  ]);
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: period },
    { kind: 'figures', items: [
      { label: 'Vehicles', value: fmt(rows.length) },
      { label: 'Measured', value: fmt(totals?.measured ?? 0) },
      { label: 'Distance, km', value: L(totals?.distanceKm) },
      { label: 'Fuel consumed, L', value: L(totals?.consumedL) },
      { label: 'Fleet rate, km/L', value: R(totals?.kmPerL) },
      { label: 'Below target', value: fmt(rows.filter((r) => r.belowTarget).length) },
    ] },
    { kind: 'h2', title: '2. By vehicle', aside: plural(rows.length, 'vehicle') },
    { kind: 'table', cols, head, size: 7.5, rows: tableRows },
    { kind: 'note', text: "Each unit's fuel over the whole period: the tank at the start and end, the refills and suspected thefts on record, and the distance driven. The fleet rate counts only units with a measured figure." },
  ];
  return {
    title: 'FUEL CONSUMPTION RATE REPORT',
    docName: `Fuel Consumption Rate Report ${fleet}`,
    filename: `Fuel Consumption Rate Report ${fleet} ${from}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('FC', orgCode, now),
    date: dmy(now),
    meta: meta([['Fleet', fleet], [several ? 'Days' : 'Day', period], ['Vehicles', fmt(rows.length)], ['Fleet rate', `${R(totals?.kmPerL)} km/L`]]),
    blocks,
    footer: `${fleet} · Fuel Consumption Rate · ${period}`,
    landscape: true,
  };
}

const browserParse = (html) => new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body;

/** A letterhead report's parts (reportHtml, tankersHtml) as a document. */
export function flowDoc({ parts, landscape, filename }, parse = browserParse) {
  const strip = (html) => parse(`<div>${html}</div>`).textContent.trim();
  return {
    title: parts.title,
    docName: filename.replace(/\.pdf$/, ''),
    pairs: true,
    ...(landscape ? { landscape: true } : {}),
    filename: filename.replace(/\.pdf$/, ''),
    reportNo: parts.reportNo,
    date: parts.date,
    meta: parts.info.slice(0, 8).map(([label, value]) => ({ label, value: strip(value) })),
    blocks: flowBlocks(parts.flow, landscape ? LANDSCAPE_MM : PORTRAIT_MM, parse),
    footer: parts.footNote,
  };
}

/** Fuel filled (Movements › Fuel): each refuel and the litres the fuel probe saw go in. */
/**
 * Fuel reconciliation (Fuel Filled › Reconcile a sheet): the sheet's rows with
 * the probe's litres beside the records' and the variance (lib/probeRecon).
 */
export function probeReconDoc(rows, { fleet, unit = '', orgCode, sheet = '', now = Date.now() }) {
  const s = reconSummary(rows);
  const words = s.from ? (s.from === s.to ? dmyOf(s.from) : `${dmyOf(s.from)} to ${dmyOf(s.to)}`) : '';
  const cols = [{ w: 18 }, { w: 20 }, { w: 22 }, { w: 24 }, { w: 18 }, { w: 30 }, { w: 0, wrap: true }]
    .map((c, i) => (RECON_FIGURES.has(i) ? { ...c, align: 'right' } : c));
  const notes = [
    s.noFill > 0 && `${plural(s.noFill, 'row')} had no probe refuel for that unit on that day: left blank.`,
    s.before > 0 && `${plural(s.before, 'row')} are dated before the fuel records begin and were not checked; the sheet's figures are kept.`,
    s.notOnPlatform > 0 && `${plural(s.notOnPlatform, 'row')} are on units not on the platform; the sheet's figures are kept.`,
    'Variance is the records less the probe. Totals are over the rows a probe refuel was found for.',
  ].filter(Boolean);
  const name = unit ? `${fleet} ${unit}` : fleet;
  return {
    title: 'FUEL RECONCILIATION REPORT', docName: `Fuel Reconciliation ${name}`, pairs: true,
    filename: `Fuel Reconciliation ${name}${s.from ? ` ${s.from}${s.to !== s.from ? ` to ${s.to}` : ''}` : ''}`,
    reportNo: reportNumber('FR', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], ...(unit ? [['Unit', unit]] : []), ...(sheet ? [['Sheet', sheet]] : []), ['Days', words], ['Rows', fmt(s.rows)]]),
    blocks: [
      { kind: 'h2', title: '1. Overview', aside: words },
      { kind: 'figures', items: [
        { label: 'Rows checked', value: `${fmt(s.filled)} of ${fmt(s.rows)}` },
        { label: 'Records, L', value: fmtFixed(s.recordsL, 2) },
        { label: 'Probes, L', value: fmtFixed(s.probeL, 2) },
        { label: 'Variance, L', value: fmtFixed(s.varianceL, 2) },
      ] },
      { kind: 'h2', title: '2. Each row', aside: plural(s.rows, 'row') },
      { kind: 'table', cols, head: RECON_HEADS, size: 7.4, rows: rows.map((r) => reconCells(r).map((t, k) => textCell(t, k === 1))) },
      ...notes.map((text) => ({ kind: 'note', text })),
    ],
    footer: `${fleet} · Fuel Reconciliation Report · ${words}`,
  };
}

export function fuelFilledDoc(rows, { from, to, fleet, unit = '', orgCode, now = Date.now() }) {
  const s = fuelFilledSummary(rows);
  const several = from !== to;
  const words = periodWords(from, to);
  const cols = [{ w: 20 }, { w: 11 }, { w: 24, wrap: true }, { w: 44 }, { w: 15 }, { w: 15 }, { w: 0, wrap: true }]
    .map((c, i) => (FUEL_FILLED_FIGURES.has(i) ? { ...c, align: 'right' } : c));
  const notes = [
    s.joined > 0 && `${plural(s.joined, 'ledger row')} at the same fill as another (several sensors, or a split ramp) were counted once.`,
    s.pending > 0 && `* ${plural(s.pending, 'refuel')} still within the verifier's wait; the figure may yet move.`,
  ].filter(Boolean);
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Units', value: fmt(s.units) }, { label: 'Refuels', value: fmt(s.refuels) }, { label: 'Filled, L', value: fmtFixed(s.litres) },
    ] },
    { kind: 'h2', title: '2. Each refuel', aside: plural(s.refuels, 'refuel') },
    { kind: 'table', cols, head: FUEL_FILLED_HEADS, size: 7.8, rows: rows.map((r) => fuelFilledCells(r).map((t, k) => textCell(t, k === 2))) },
    ...notes.map((text) => ({ kind: 'note', text })),
  ];
  const name = unit ? `${fleet} ${unit}` : fleet;
  return {
    title: 'FUEL FILLED REPORT', docName: `Fuel Filled Report ${name}`, pairs: true,
    filename: `Fuel Filled Report ${name} ${from}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('FF', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], ...(unit ? [['Unit', unit]] : []), [several ? 'Days' : 'Day', words], ['Refuels', fmt(s.refuels)], ['Filled', `${fmtFixed(s.litres)} L`]]),
    blocks,
    footer: `${fleet} · Fuel Filled Report · ${words}`,
  };
}
