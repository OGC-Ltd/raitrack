// Words and helpers for the Plan submissions board (components/body/PlanSubmissions).
// The states come from fleet-server planner/plan-submissions.

export const STATES = {
  approved:      { label: "Approved",                  short: "Approved" },
  sent:          { label: "Sent",                      short: "Sent" },
  approved_late: { label: "Approved (sent late)",      short: "Approved, late" },
  sent_late:     { label: "Sent late",                 short: "Sent late" },
  draft:         { label: "Draft, not sent",           short: "Draft" },
  sent_back:     { label: "Sent back, not sent again", short: "Sent back" },
  none:          { label: "Not started",               short: "Not started" },
};
export const LEGEND = ["approved", "sent", "approved_late", "sent_late", "draft", "sent_back", "none"];
export const SENT_STATES = ["approved", "approved_late", "sent", "sent_late"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-11-21" as a UTC date, so the weekday never shifts with the browser's zone. */
const utc = (day) => new Date(`${day}T00:00:00Z`);
export const weekday = (day) => WEEKDAYS[utc(day).getUTCDay()];
export const isWeekend = (day) => [0, 6].includes(utc(day).getUTCDay());
export const dayOfMonth = (day) => Number(day.slice(8, 10));
export const longDay = (day) => `${WEEKDAYS_LONG[utc(day).getUTCDay()]} ${dayOfMonth(day)} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
export const addDays = (day, n) => new Date(utc(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * FactorySuite's own wall clock (EAT, no offset) as "19 Nov 15:44", or "15:44"
 * when it is on `sameDay`. Read as text: a Date would move it to the browser's zone.
 */
export function wallClock(at, sameDay) {
  if (!at || at.length < 16) return null;
  const time = at.slice(11, 16);
  const day = at.slice(0, 10);
  return day === sameDay ? time : `${dayOfMonth(day)} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${time}`;
}

/** One line under a department's name: what happened and when. */
export function cellDetail(cell) {
  if (!cell) return STATES.none.label;
  const when = wallClock(cell.submittedAt, addDays(cell.day, -1));
  switch (cell.state) {
    case "approved": case "sent": case "approved_late": case "sent_late":
      return when ? `${STATES[cell.state].short}, sent ${when}` : STATES[cell.state].short;
    case "sent_back":
      return when ? `Sent back (sent ${when})` : "Sent back";
    case "draft":
      return cell.plans.length > 1 ? `${cell.plans.length} drafts, not sent` : "Draft, not sent";
    default:
      return "Not started";
  }
}

const STATUS_WORDS = { APPROVED: "approved", SUBMITTED: "waiting for approval", DRAFT: "draft", REJECTED: "rejected", WITHDRAWN: "withdrawn" };

/** The hover text for a square: the state, then each plan behind it. */
export function cellTitle(cell, department) {
  const head = `${department}, ${longDay(cell.day)}: ${STATES[cell.state].label}`;
  const lines = cell.plans.map((p) => {
    const parts = [p.planCode, STATUS_WORDS[p.status] ?? String(p.status).toLowerCase()];
    const sent = wallClock(p.submittedAt, addDays(cell.day, -1));
    if (sent) parts.push(`sent ${sent}${p.submittedBy ? ` by ${p.submittedBy}` : ""}`);
    const reviewed = wallClock(p.reviewedAt, addDays(cell.day, -1));
    if (reviewed && p.status === "APPROVED") parts.push(`approved ${reviewed}${p.reviewedBy ? ` by ${p.reviewedBy}` : ""}`);
    if (p.note) parts.push(`"${p.note}"`);
    return parts.join(", ");
  });
  return [head, ...lines].join("\n");
}

/** The board's cells as department → day → cell. */
export function cellIndex(board) {
  const out = new Map();
  for (const c of board?.cells ?? []) {
    if (!out.has(c.department)) out.set(c.department, new Map());
    out.get(c.department).set(c.day, c);
  }
  return out;
}
