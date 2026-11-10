// The Drivers page's two PDFs as letterhead documents, drawn by the server
// (POST reports/document.pdf) like every other report: the whole roster, and
// one driver's statement.
//
// Both are read off what the page already shows — the roster with its
// weighbridge tonnes, under the vehicle-type filter — so the PDF and the
// screen agree to the unit. Pure: nothing here fetches.

import { reportNumber } from './reportLetterhead';

const OFFSET = 3 * 3600_000;
const DAY = 86_400_000;
const num = (n, d = 0) => Number(n ?? 0).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const plural = (n, one) => `${num(n)} ${one}${n === 1 ? '' : 's'}`;
/**
 * Text the server's Helvetica can draw. Its standard fonts carry only the
 * WinAnsi set, so a minus sign or an arrow (in a typed route name, say)
 * would print as a missing glyph.
 */
export const drawable = (text) => String(text ?? '')
  .replace(/\s*[→⟶⇒]\s*/g, ' to ')
  .replace(/[−‐‑]/g, '-');
const cell = (text, bold = false) => ({ text: drawable(text), ...(bold ? { bold: true } : {}) });
const meta = (pairs) => pairs.filter(([, v]) => v != null && v !== '').map(([label, value]) => ({ label, value: drawable(value) }));
const fleetDay = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
/** YYYY-MM-DD → DD/MM/YYYY. */
const dmyDay = (day) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '-');
const dmyhm = (iso) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  const s = new Date(ms + OFFSET).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
};
const span = (from, to) => (from === to ? dmyDay(from) : `${dmyDay(from)} – ${dmyDay(to)}`);

/**
 * A person's name, with its case repaired the way the page draws it: a word
 * that already mixes cases is left as typed ("McOmbaka"), the rest are
 * capitalised.
 */
export const nameCase = (name = '') =>
  String(name).replace(/[^\s'’-]+/g, (w) =>
    (/[a-z]/.test(w) && /[A-Z]/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const STATUS = { ACTIVE: 'Active', SUSPENDED: 'Suspended', TERMINATED: 'Terminated' };
const unrated = (d) => !(Number(d?.rating) > 0) && d?.ratingBand !== 'Poor';
const ratingText = (d) => (unrated(d) ? 'New' : num(d.rating, 1));
const cases = (d) => (Number(d.fuelTheftCases) || 0) + (Number(d.overspeedingCases) || 0)
  + (Number(d.harshAccelerationCases) || 0) + (Number(d.harshBrakingCases) || 0);

/** The window the roster is read over: the last `days` fleet days to today. */
function windowOf(days, now) {
  const to = fleetDay(now);
  return { from: fleetDay(now - (days - 1) * DAY), to };
}

/** When a driver was active inside the window: their first and last day with a trip. */
function activeSpan(detail) {
  const byDay = detail?.byDay ?? [];
  return byDay.length ? span(byDay[0].day, byDay.at(-1).day) : '-';
}

/**
 * The whole roster (the page's "All Drivers PDF"). `drivers` is the list the
 * grid holds, biggest tonnage first; `details` the overview's per-driver
 * analytics, for each driver's active days.
 */
export function driversDoc(drivers, { details = {}, fleet, orgCode, days = 90, typeName = null, weighbridge = false, now = Date.now() }) {
  const win = windowOf(days, now);
  const period = span(win.from, win.to);
  const sum = (k) => drivers.reduce((n, d) => n + (Number(d[k]) || 0), 0);
  const rated = drivers.filter((d) => !unrated(d));
  const avg = rated.length ? rated.reduce((n, d) => n + Number(d.rating), 0) / rated.length : null;
  const theft = sum('fuelTheftCases');

  // Landscape: 271 mm inside the margins.
  const cols = [
    { w: 8, align: 'right' }, { w: 46, wrap: true }, { w: 24 }, { w: 18 }, { w: 32, wrap: true },
    { w: 14, align: 'right' }, { w: 14, align: 'right' }, { w: 18, align: 'right' }, { w: 20, align: 'right' },
    { w: 16, align: 'right' }, { w: 18, align: 'right' }, { w: 20, align: 'right' }, { w: 23, align: 'right' },
  ];
  const head = ['#', 'Driver', 'Vehicle', 'Status', 'Active', 'Rating', 'Trips', 'Tonnes', 'Mileage (km)',
    'Fuel theft', 'Overspeed', 'Harsh accel.', 'Hard braking'];
  const rows = drivers.map((d, i) => [
    cell(i + 1),
    cell(`${nameCase(d.fullName)}${d.employeeId ? ` #${d.employeeId}` : ''}`, true),
    cell(d.vehicle || '-'),
    cell(STATUS[d.status] ?? d.status ?? '-'),
    cell(activeSpan(details?.[d.id])),
    cell(ratingText(d)),
    cell(num(d.trips)),
    cell(num(d.tonnes, 1)),
    cell(num(d.mileageKm)),
    cell(num(d.fuelTheftCases)),
    cell(num(d.overspeedingCases)),
    cell(num(d.harshAccelerationCases)),
    cell(num(d.harshBrakingCases)),
  ]);
  rows.push([
    cell(''), cell('Total', true), cell(''), cell(''), cell(''), cell(''),
    cell(num(sum('trips')), true), cell(num(sum('tonnes'), 1), true), cell(num(sum('mileageKm')), true),
    cell(num(theft), true), cell(num(sum('overspeedingCases')), true),
    cell(num(sum('harshAccelerationCases')), true), cell(num(sum('harshBrakingCases')), true),
  ]);

  const flagged = drivers.filter((d) => cases(d) > 0).sort((a, b) => cases(b) - cases(a));
  const conductCols = [
    { w: 86, wrap: true }, { w: 32 }, { w: 28, align: 'right' }, { w: 28, align: 'right' },
    { w: 32, align: 'right' }, { w: 32, align: 'right' }, { w: 33, align: 'right' },
  ];

  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: period },
    { kind: 'figures', items: [
      { label: 'Drivers', value: num(drivers.length) },
      { label: 'Trips', value: num(sum('trips')) },
      { label: 'Tonnes ferried', value: `${num(sum('tonnes'), 1)} t` },
      { label: 'Mileage', value: `${num(sum('mileageKm'))} km` },
      { label: 'Average rating', value: avg == null ? '-' : `${num(avg, 1)} / 5` },
      { label: 'Fuel theft cases', value: num(theft), ...(theft > 0 ? { flag: true } : {}) },
      { label: 'Overspeeding', value: num(sum('overspeedingCases')) },
      { label: 'Harsh driving', value: num(sum('harshAccelerationCases') + sum('harshBrakingCases')) },
    ] },
    { kind: 'h2', title: '2. Driver Roster', aside: plural(drivers.length, 'driver') },
    drivers.length
      ? { kind: 'table', cols, head, size: 7.2, rows }
      : { kind: 'none', text: 'No drivers on the roster.' },
    { kind: 'h2', title: '3. Conduct', aside: flagged.length ? `${plural(flagged.length, 'driver')} with cases` : 'no cases' },
    flagged.length
      ? { kind: 'table', cols: conductCols, head: ['Driver', 'Vehicle', 'Fuel theft', 'Overspeed', 'Harsh accel.', 'Hard braking', 'Total'], size: 7.8,
        rows: flagged.map((d) => [
          cell(nameCase(d.fullName), true), cell(d.vehicle || '-'),
          cell(num(d.fuelTheftCases)), cell(num(d.overspeedingCases)),
          cell(num(d.harshAccelerationCases)), cell(num(d.harshBrakingCases)), cell(num(cases(d)), true),
        ]) }
      : { kind: 'none', text: 'No driver had a fuel theft, overspeeding or harsh driving case in the period.' },
    { kind: 'note', text: `Figures cover ${period}. Active is each driver's first and last day with a trip in that window. Rating is out of 5; New means not rated yet.` },
    ...(weighbridge ? [{ kind: 'note', text: 'Tonnes include cane weighed at the weighbridge, credited to the driver of the trip the truck was on.' }] : []),
  ];

  const scope = typeName ? `${fleet} · ${typeName}` : fleet;
  return {
    title: 'DRIVERS REPORT',
    docName: `Drivers Report ${fleet}`,
    filename: `Drivers Report ${fleet}${typeName ? ` ${typeName}` : ''} ${win.to}`,
    reportNo: reportNumber('DR', orgCode, now),
    date: dmyDay(win.to),
    meta: meta([['Fleet', fleet], ['Vehicles', typeName], ['Period', period], ['Drivers', num(drivers.length)]]),
    blocks,
    footer: drawable(`${scope} · Drivers · ${period}`),
    landscape: true,
  };
}

const THEFT_STANDING = { confirmed: 'Confirmed theft', not_theft: 'De-escalated', probe_fault: 'Probe fault' };
const HARSH_KIND = { acceleration: 'Harsh acceleration', braking: 'Hard braking' };
const byTime = (a, b) => String(a.at).localeCompare(String(b.at));

/**
 * One driver's statement (the page's "<name> PDF"): the figures, then every
 * flagged case with its date, time and unit, so each can be traced.
 * `detail` is the overview's /analytics/drivers/:id payload for them.
 */
export function driverDoc(detail, { fleet, orgCode, vehicle = null, now = Date.now() }) {
  const { driver, totals = {}, heaviestLoad, byDay = [], incidents = {} } = detail;
  const name = nameCase(driver.fullName);
  const active = byDay.length ? span(byDay[0].day, byDay.at(-1).day) : 'no activity';
  const windowDays = totals.windowDays ?? 90;
  const win = windowOf(windowDays, now);
  const period = span(win.from, win.to);
  const per = (n, d) => (d > 0 ? n / d : null);
  const dash = (v, dec, unit) => (v == null ? '-' : `${num(v, dec)}${unit}`);

  const thefts = (incidents.thefts ?? []).filter((t) => t.cause === 'SIPHON' || t.review === 'confirmed').sort(byTime);
  const overspeeds = [...(incidents.overspeeds ?? [])].sort(byTime);
  const harsh = [...(incidents.harsh ?? [])].sort(byTime);
  const confirmed = thefts.filter((t) => t.review === 'confirmed');

  const pairCols = [{ w: 72 }, { w: 112, align: 'right', wrap: true }];
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: period },
    { kind: 'figures', items: [
      { label: 'Rating', value: unrated(driver) ? 'New' : `${num(driver.rating, 1)} / 5` },
      { label: 'Trips', value: num(totals.trips) },
      { label: 'Tonnes ferried', value: `${num(totals.tonnes, 1)} t` },
      { label: 'Mileage', value: `${num(totals.mileageKm)} km` },
      { label: 'Active days', value: num(byDay.length) },
      { label: 'Fuel theft cases', value: num(thefts.length), ...(thefts.length ? { flag: true } : {}) },
    ] },
    { kind: 'h2', title: '2. Performance Statement' },
    { kind: 'table', cols: pairCols, head: ['Metric', 'Value'], size: 8.5, rows: [
      ['Trips completed', num(totals.trips)],
      ['Tonnes ferried', `${num(totals.tonnes, 1)} t`],
      ['Distance covered', `${num(totals.mileageKm)} km`],
      ['Hours on road', `${num(totals.hoursOnRoad, 1)} h`],
      ['Tonnes per trip', dash(per(totals.tonnes, totals.trips), 1, ' t')],
      ['Km per trip', dash(per(totals.mileageKm, totals.trips), 0, ' km')],
      ['Km per active day', dash(per(totals.mileageKm, byDay.length), 0, ' km')],
      ['Fuel theft cases', num(thefts.length)],
      ['Overspeeding cases', num(totals.overspeedingCases)],
      ['Harsh acceleration', num(totals.harshAccelerationCases)],
      ['Hard braking', num(totals.harshBrakingCases)],
      ['Heaviest load', heaviestLoad ? `${num(heaviestLoad.tonnes, 1)} t · ${dmyDay(String(heaviestLoad.date).slice(0, 10))} · ${heaviestLoad.route ?? '-'}` : '-'],
    ].map(([k, v]) => [cell(k, true), cell(v)]) },

    { kind: 'h2', title: '3. Fuel Theft', aside: thefts.length ? `${plural(thefts.length, 'case')}, ${num(confirmed.length)} confirmed` : 'none' },
    thefts.length
      ? { kind: 'table', size: 7.8,
        cols: [{ w: 30 }, { w: 24 }, { w: 20, align: 'right' }, { w: 28, align: 'right' }, { w: 52, wrap: true }, { w: 30 }],
        head: ['Time', 'Unit', 'Litres lost', 'Tank (L)', 'Where', 'Review'],
        rows: thefts.map((t) => [
          cell(dmyhm(t.at)), cell(t.plate ?? '-', true), cell(num(t.litres, 1)),
          cell(t.fromL != null && t.toL != null ? `${num(t.fromL)} to ${num(t.toL)}` : '-'),
          cell(t.where ?? '-'), cell(THEFT_STANDING[t.review] ?? 'Awaiting review'),
        ]) }
      : { kind: 'none', text: 'No fuel theft was flagged on their units in the period.' },

    { kind: 'h2', title: '4. Overspeeding', aside: overspeeds.length ? plural(overspeeds.length, 'case') : 'none' },
    overspeeds.length
      ? { kind: 'table', size: 7.8,
        cols: [{ w: 34 }, { w: 28 }, { w: 30, align: 'right' }, { w: 30, align: 'right' }, { w: 62, wrap: true }],
        head: ['Time', 'Unit', 'Top speed (km/h)', 'Limit (km/h)', 'Route'],
        rows: overspeeds.map((o) => [
          cell(dmyhm(o.at)), cell(o.plate ?? '-', true),
          cell(o.peakKmh != null ? num(o.peakKmh) : '-'), cell(o.limitKmh != null ? num(o.limitKmh) : '-'),
          cell(o.route ?? '-'),
        ]) }
      : { kind: 'none', text: 'No overspeeding on their trips in the period.' },

    { kind: 'h2', title: '5. Harsh Driving', aside: harsh.length ? plural(harsh.length, 'report') : 'none' },
    harsh.length
      ? { kind: 'table', size: 7.8,
        cols: [{ w: 46 }, { w: 46 }, { w: 92 }],
        head: ['Time', 'Unit', 'Kind'],
        rows: harsh.map((h) => [cell(dmyhm(h.at)), cell(h.plate ?? '-', true), cell(HARSH_KIND[h.kind] ?? h.kind ?? '-')]) }
      : { kind: 'none', text: 'No harsh acceleration or hard braking reported on their trips in the period.' },
  ];

  if (byDay.length) {
    blocks.push(
      { kind: 'h2', title: '6. Daily Activity', aside: plural(byDay.length, 'active day') },
      { kind: 'table', size: 7.8, cols: [{ w: 62 }, { w: 61, align: 'right' }, { w: 61, align: 'right' }],
        head: ['Date', 'Tonnes', 'Mileage (km)'],
        rows: byDay.map((d) => [cell(dmyDay(d.day)), cell(num(d.tonnes, 1)), cell(num(d.mileageKm))]) },
    );
  }
  const posted = [...thefts, ...overspeeds].filter((x) => x.attributedBy === 'posted').length;
  if (posted) {
    blocks.push({ kind: 'note', text: `${plural(posted, 'case')} happened before anyone was posted to the unit and ${posted === 1 ? 'is' : 'are'} listed against the driver posted to it now.` });
  }
  blocks.push({ kind: 'note', text: `Figures cover ${period}; the driver was active ${byDay.length ? `from ${active}` : 'on no day'} in that window. Times are East Africa Time.` });

  return {
    title: 'DRIVER REPORT',
    docName: `Driver Report ${name}`,
    filename: `Driver Report ${name} ${win.to}`,
    reportNo: reportNumber('DS', orgCode, now),
    date: dmyDay(win.to),
    meta: meta([
      ['Driver', name], ['Employee no.', driver.employeeId], ['Licence', driver.licenceNumber],
      ['Vehicle', vehicle], ['Fleet', fleet], ['Period', period],
    ]),
    blocks,
    footer: drawable(`${fleet} · Driver Report · ${name}`),
    landscape: false,
  };
}
