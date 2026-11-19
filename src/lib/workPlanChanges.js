/**
 * The Fuel page's Plan changes section (operator 2026-11-19: "we need to
 * ensure that we monitor any changes happening on the workplan from factory
 * suite"). fleet-server's work plan watch compares FactorySuite's plans every
 * few minutes and records each change (planner/work-plan-watch); this turns
 * those rows into sentences, and finds in the Fuel data what is wrong with the
 * plans as they stand: a machine planned twice for one shift, and plans for a
 * day already gone that nobody approved or rejected.
 */

const sentence = (s) => {
  const t = String(s ?? "").trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

/** Line and plan fields, as the list names them. */
export const FIELD_LABELS = {
  machine: "Machine", shiftNo: "Shift", shiftStart: "Start", plannedHours: "Hours", fullTank: "Full tank",
  litresRequested: "Litres", plannedKm: "Km", activity: "Job", workLocation: "Works at",
  fuelingLocation: "Fuelled at", operator: "Operator", secondOperator: "Second operator",
  thirdOperator: "Third operator", supervisor: "Supervisor", crews: "Crews", expectedOutput: "Expected output",
  decision: "Line decision", decisionNote: "Decision note", active: "Active", notes: "Notes",
  startDate: "Day", endDate: "End day", department: "Department", title: "Title",
  submittedBy: "Sent by", reviewedBy: "Decided by", status: "Status",
};

function value(field, v) {
  if (v == null || v === "") return "none";
  if (v === "true") return "yes";
  if (v === "false") return "no";
  if (field === "shiftStart") return String(v).slice(0, 5);
  if (field === "status" || field === "decision") return sentence(v);
  return String(v);
}

/** One recorded change as a short sentence: "Hours 10 → 8", "Draft → Cancelled". */
export function changeWords(c) {
  switch (c.kind) {
    case "plan_added": {
      const [status, lines] = String(c.toValue ?? "").split(", ");
      return `New plan, ${sentence(status).toLowerCase() || "status unknown"}${lines ? `, ${lines}` : ""}`;
    }
    case "plan_status":
      return `${sentence(c.fromValue) || "None"} → ${sentence(c.toValue) || "None"}`;
    case "plan_removed":
      return `Deleted in FactorySuite${c.fromValue ? ` (was ${sentence(c.fromValue).toLowerCase()})` : ""}`;
    case "plan_restored":
      return "Back in FactorySuite";
    case "line_added":
      return `Line added: ${c.toValue ?? ""}`.trim();
    case "line_removed":
      return `Line removed: ${c.fromValue ?? ""}`.trim();
    case "plan_changed":
    case "line_changed": {
      const label = FIELD_LABELS[c.field] ?? c.field ?? "Changed";
      return `${label} ${value(c.field, c.fromValue)} → ${value(c.field, c.toValue)}`;
    }
    default:
      return sentence(c.kind);
  }
}

/** How much a change matters for fuel: drives the row's tone. */
export function changeTone(c) {
  if (c.kind === "plan_removed" || c.kind === "line_removed") return "bad";
  if (c.kind === "plan_status") return /CANCEL|REJECT/i.test(c.toValue ?? "") ? "bad" : /APPROV/i.test(c.toValue ?? "") ? "good" : "info";
  if (c.kind === "line_changed" && ["machine", "shiftNo", "shiftStart", "plannedHours", "fullTank", "litresRequested"].includes(c.field)) return "warn";
  return "info";
}

/**
 * Machines on two or more lines for the same day and shift, in plans that
 * still stand (the Fuel data has no cancelled plan). Newest day first.
 * [{ day, machine, shiftNo, lines: [{ planCode, planStatus, taskId, operator, shiftStart, plannedHours }] }]
 */
export function planDoubles(lines) {
  const by = new Map();
  for (const l of lines ?? []) {
    if (!l?.machine) continue;
    const k = `${l.day}|${String(l.machine).toUpperCase()}|${l.shiftNo ?? ""}`;
    (by.get(k) ?? by.set(k, []).get(k)).push(l);
  }
  return [...by.values()]
    .filter((ls) => ls.length > 1)
    .map((ls) => ({
      day: ls[0].day, machine: ls[0].machine, shiftNo: ls[0].shiftNo ?? null,
      lines: ls.map((l) => ({
        planCode: l.planCode, planStatus: l.planStatus, taskId: l.taskId, operator: l.operator ?? null,
        shiftStart: l.shiftStart ?? null, plannedHours: l.plannedHours ?? null, department: l.department ?? null,
      })),
    }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.machine.localeCompare(b.machine, undefined, { numeric: true }));
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
