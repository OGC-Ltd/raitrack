/**
 * The Fuel page's Plan updates (operator 2026-11-19: "if an item was drafted
 * and awaiting approval we should update it based on the new changes either
 * accepted or rejected no point of having duplicates records").
 *
 * fleet-server's work plan watch keeps one row per FactorySuite plan line,
 * updated in place (planner/work-plan-watch): the line's status now, the status
 * it had before its last status change, and the fields its last edit changed.
 * This turns those into words, and finds in the Fuel data the plans for a day
 * already gone that nobody approved or rejected.
 */

const sentence = (s) => {
  const t = String(s ?? "").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

/** A plan status as the page names it: draft and submitted are both pending. */
export function statusLabel(status) {
  const s = String(status ?? "").toUpperCase();
  if (s === "DRAFT" || s === "SUBMITTED") return "Pending";
  return sentence(s) || "Unknown";
}

/** The badge tone of a status. */
export function statusTone(status) {
  const s = String(status ?? "").toUpperCase();
  if (s === "APPROVED" || s === "RELEASED") return "good";
  if (s === "REJECTED" || s === "CANCELLED") return "bad";
  return "info";
}

/** Line fields, as the list names them. */
export const FIELD_LABELS = {
  machine: "Machine", shiftNo: "Shift", shiftStart: "Start", plannedHours: "Hours", fullTank: "Full tank",
  litresRequested: "Litres", plannedKm: "Km", activity: "Job", workLocation: "Works at",
  fuelingLocation: "Fuelled at", operator: "Operator", secondOperator: "Second operator",
  thirdOperator: "Third operator", supervisor: "Supervisor", expectedOutput: "Expected output",
  decision: "Line decision", notes: "Notes", day: "Day",
};

function value(field, v) {
  if (v == null || v === "") return "none";
  if (v === "true") return "yes";
  if (v === "false") return "no";
  if (field === "shiftStart") return String(v).slice(0, 5);
  if (field === "decision") return sentence(v);
  return String(v);
}

/** One field edit in words: "Hours 10 → 8". */
export function editWords(e) {
  const label = FIELD_LABELS[e.field] ?? e.field;
  return `${label} ${value(e.field, e.from)} → ${value(e.field, e.to)}`;
}

/** The line's last edit, status aside (the status has its own column). */
export function lineEdits(item) {
  return (Array.isArray(item?.lastEdits) ? item.lastEdits : []).filter((e) => e.field !== "status").map(editWords);
}

/**
 * The status line of an item: "Pending → Approved" when the watch saw it
 * change, else the status alone. Draft → Submitted reads as no change.
 */
export function statusWords(item) {
  const now = statusLabel(item?.status);
  const was = item?.previousStatus ? statusLabel(item.previousStatus) : null;
  return was && was !== now ? `${was} → ${now}` : now;
}

/** Plans for a day before `today` still DRAFT or SUBMITTED: never decided. Oldest first. */
export function undecidedPlans(lines, today) {
  const by = new Map();
  for (const l of lines ?? []) {
    if (!(l.day < today) || !/^(DRAFT|SUBMITTED)$/i.test(l.planStatus ?? "")) continue;
    const p = by.get(l.planCode) ?? by.set(l.planCode, { planCode: l.planCode, day: l.day, status: l.planStatus, department: l.department ?? null, lines: 0 }).get(l.planCode);
    p.lines += 1;
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day) || a.planCode.localeCompare(b.planCode, undefined, { numeric: true }));
}
