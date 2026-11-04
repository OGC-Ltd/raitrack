// The TAT and Fuel Report (operator, 4 Nov 2026; West Kenya's daily sheet, made
// first for Sukari): one row per trip finished on the day, and one row
// for each other unit saying why it has none. The server does the working
// (fleet-server reports/tat-fuel-report.service); this lays out the rows.
//
// Pure: no React, no network.

const OFFSET = 3 * 3600_000;

export const COLUMNS = [
  'Registration No', 'Trip Duration', 'Initial Volume', 'Top Ups (System)', 'Total Fuel', 'Consumption', 'Theft',
  'Final Volume', 'Station', 'Distance (KM)', 'Rate (KM/L)', 'Fuel Tank Capacity in L', 'Comment', 'Base',
];
/** The columns that hold a figure. */
export const FIGURES = new Set([2, 3, 4, 5, 6, 7, 9, 10, 11]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Nov 18:41" in Nairobi. */
export function whenWords(ms) {
  const s = new Date(ms + OFFSET).toISOString();
  return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(11, 16)}`;
}

/** "23 h 50 min". */
export function tatWords(ms) {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** The trip, from leaving the premises to being signed back in, and how long it took. */
export function durationWords(r) {
  if (r.returnedAt == null) return r.dispatchedAt == null ? '' : `Dispatched ${whenWords(r.dispatchedAt)}`;
  return `${whenWords(r.leftAt)} to ${whenWords(r.returnedAt)} (${tatWords(r.returnedAt - r.leftAt)})`;
}

// As Vehicle analytics writes them: litres to 0.1, kilometres to 0.01.
const litres = (v) => (v == null ? '-' : v.toFixed(1));
const kms = (v) => (v == null ? '-' : v.toFixed(2));
const whole = (v) => (v == null ? '-' : String(Math.round(v)));

export function rowCells(r) {
  const f = r.fuel;
  return [
    r.plate, durationWords(r), litres(f?.initial), litres(f?.topUps), litres(f?.total), litres(f?.consumption), litres(f?.theft),
    litres(f?.final), r.station || '-', kms(r.km), r.rate == null ? '-' : r.rate.toFixed(2), whole(r.tankL), r.comment, r.base,
  ];
}

/** Prime movers come first, as on the server. */
const rank = (g) => (g === 'Prime Movers' ? 0 : 1);

/** Reports for several organisations as one: a unit's rows together, in the server's order. */
export const mergeRows = (lists) => lists.flat().sort((a, b) => rank(a.group) - rank(b.group) || b.group.localeCompare(a.group)
  || a.plate.localeCompare(b.plate) || (a.leftAt ?? 0) - (b.leftAt ?? 0));

/** Only these units, or all of them for 'all'. */
export const rowsOfGroup = (rows, group) => (group === 'all' ? rows : rows.filter((r) => r.group === group));

/** Rows by the kind of unit, in the order they came. */
export function sections(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.group)) out.set(r.group, []);
    out.get(r.group).push(r);
  }
  return [...out].map(([group, list]) => ({ group, rows: list }));
}

/** The figures over the rows; the rate only from trips whose probe could be trusted. */
export function summary(rows) {
  const trips = rows.filter((r) => r.returnedAt != null);
  const ok = trips.filter((r) => r.comment === 'PROBE OK');
  const km = ok.reduce((s, r) => s + r.km, 0);
  const used = ok.reduce((s, r) => s + (r.fuel.consumption ?? 0), 0);
  return {
    trips: trips.length,
    units: new Set(trips.map((r) => r.vehicleId)).size,
    measured: ok.length,
    litres: used,
    km,
    rate: used > 0 ? km / used : null,
    theft: trips.reduce((s, r) => s + (r.fuel?.theft ?? 0), 0),
    noTrip: rows.filter((r) => r.comment === 'NO TRIP').length,
    notUpdating: rows.filter((r) => r.comment === 'NOT UPDATING').length,
    incomplete: rows.filter((r) => r.comment === 'INCOMPLETE TRIP').length,
  };
}

/** "3 November 2026". */
export function dayWords(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** The day before `now` in Nairobi, as YYYY-MM-DD: a day's sheet is read once it has closed. */
export const yesterday = (now = Date.now()) => new Date(now + OFFSET - 86_400_000).toISOString().slice(0, 10);

export const csvTable = (rows) => ({ head: COLUMNS, body: rows.map(rowCells) });

/** What the server draws the PDF from (fleet-server reports/template-report.pdf). */
export const tatPdfBody = (rows, { day, fleet, group = 'all' }) => ({ day, fleet, group, rows });
