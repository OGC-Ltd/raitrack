// The Dormant Assets Report (operator, 3 Nov 2026; was Non-Updating Assets; West Kenya's sheet,
// Menengai too): the vehicles whose trackers have stopped sending, in three
// sections by the calendar day of their last message, counted back from the
// day the report is made, as the sheet has them:
//
//   OFFLINE YESTERDAY         last message yesterday
//   OFFLINE FOR 48 HRS        the two days before that
//   OFFLINE FOR OVER 48 HRS   earlier, however long ago
//
// A tracker silent since earlier today is not listed: it shows tomorrow, as
// offline yesterday (operator: as the sheet). One that has never sent a
// message is not in the sections either; it is counted under them.
//
// Each section: Registration, Last message, Location; newest first.
//
// Read from the Movements report's rows (fleet-server reports/movements): the
// unit's name, the time of its last reading and the place it was read at.
//
// Pure: no React, no network.

const OFFSET = 3 * 3600_000;
const DAY = 86_400_000;

export const SECTIONS = [
  { key: 'yesterday', title: 'OFFLINE YESTERDAY', words: 'Offline yesterday', days: [1, 1] },
  { key: 'two', title: 'OFFLINE FOR 48 HRS', words: 'Offline for 48 hrs', days: [2, 3] },
  { key: 'over', title: 'OFFLINE FOR OVER 48 HRS', words: 'Offline for over 48 hrs', days: [4, Infinity] },
];
export const COLUMNS = ['Registration', 'Last message', 'Location'];
/** The sheet's section bars. */
export const BAR = '#00b0f0';

/** The moment a report for a day is made as at: now for today, else that day's last moment. */
export function asAtOf(day, now = Date.now()) {
  const end = Date.parse(`${day}T00:00:00Z`) - OFFSET + DAY - 1;
  return end >= now ? now : end;
}

/** The calendar day (Nairobi) a time falls on, as a day number. */
const dayNo = (ms) => Math.floor((ms + OFFSET) / DAY);
/** How many calendar days before `now` the time falls: 0 today, 1 yesterday. */
export const daysBefore = (ms, now = Date.now()) => dayNo(now) - dayNo(ms);

/** Which section a last message puts a vehicle in, or null (today, or never). */
export function sectionOf(lastAt, now = Date.now()) {
  if (!Number.isFinite(lastAt)) return null;
  const d = daysBefore(lastAt, now);
  return SECTIONS.find((s) => d >= s.days[0] && d <= s.days[1])?.key ?? null;
}

const natural = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/**
 * The report from the Movements rows (`{ vehicleId, plate, grouping, lastAt, location }`),
 * of one organisation or several.
 *
 * @returns {{ sections: Record<string, object[]>, never: object[], total: number }}
 */
export function offlineReport(rows, now = Date.now()) {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s.key, []]));
  const never = [];
  const seen = new Set();
  for (const r of rows ?? []) {
    if (!r || seen.has(r.vehicleId)) continue;
    seen.add(r.vehicleId);
    const row = { vehicleId: r.vehicleId, name: String(r.grouping ?? r.plate ?? r.vehicleId ?? '').trim(), lastAt: r.lastAt ?? null, location: r.location ?? null };
    if (row.lastAt == null) { never.push(row); continue; }
    const key = sectionOf(row.lastAt, now);
    if (key) sections[key].push(row);
  }
  for (const list of Object.values(sections)) list.sort((a, b) => b.lastAt - a.lastAt || natural(a.name, b.name));
  never.sort((a, b) => natural(a.name, b.name));
  return { sections, never, total: seen.size };
}

/** Every vehicle in the sections. */
export const offlineCount = (rep) => SECTIONS.reduce((n, s) => n + rep.sections[s.key].length, 0);

/** "2026-10-30 11:42:05", in Nairobi time, as the sheet writes it. */
export const stampWords = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 19).replace('T', ' ');
export const rowCells = (r) => [r.name, stampWords(r.lastAt), r.location ?? '-'];

const dmyhm = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`; };
export const asAtWords = (now) => dmyhm(now);
/** The days a section covers, for its heading: "30/10/2026", "28/10/2026 – 29/10/2026", "27/10/2026 and earlier". */
export function sectionDays(s, now = Date.now()) {
  const d = (n) => dmyhm(now - n * DAY).slice(0, 10);
  if (s.days[1] === Infinity) return `${d(s.days[0])} and earlier`;
  return s.days[0] === s.days[1] ? d(s.days[0]) : `${d(s.days[1])} – ${d(s.days[0])}`;
}

export function csvTable(rep) {
  return {
    head: ['Section', ...COLUMNS],
    body: SECTIONS.flatMap((s) => rep.sections[s.key].map((r) => [s.words, ...rowCells(r)])),
  };
}

/** What the server draws the PDF from (fleet-server reports/template-report.pdf). */
export const offlinePdfBody = (rep, { fleet, now }) => ({
  fleet, now, total: rep.total, never: rep.never.length,
  sections: Object.fromEntries(SECTIONS.map((s) => [s.key, rep.sections[s.key].map(({ name, lastAt, location }) => ({ name, lastAt, location }))])),
});
