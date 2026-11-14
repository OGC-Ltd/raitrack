/**
 * The work plan hover card: what FactorySuite planned for one unit today, as
 * its own Work Plans row shows it (operator 2026-11-14), read while the map's
 * Work plans switch is on and the pointer rests on the unit.
 *
 * Five parts, in FactorySuite's order: the machine and its job, the plan it is
 * on, where it is fuelled and works, its shift and crew, and what the pump has
 * issued. Each line is worked out here, not in the component, so the wording
 * is pinned by a test: "Not fuelled yet" and "Not approved for the pump" are
 * different claims, and a missing figure is left out rather than guessed.
 */

import { lineNow, planStage } from "./workPlanMap";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * FactorySuite's own wall clock ("2026-11-13T13:35:12.587") as
 * "13 Nov 2026, 13:35". The time is offsetless local time already, so it is
 * read as written and never shifted through a timezone.
 */
export function wallClock(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s ?? ""));
  if (!m) return "";
  const date = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return m[4] ? `${date}, ${m[4]}:${m[5]}` : date;
}

/** Just the time of a wall clock, "05:10". */
const clockTime = (s) => /[T ](\d{2}:\d{2})/.exec(String(s ?? ""))?.[1] ?? "";

/** "14 Nov", the plan's day. */
function dayShort(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day ?? ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : "";
}

const sentence = (s) => {
  const t = String(s).trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** The plan and the line a unit is on today, or null. A machine on two shifts
 *  shows the shift on now, else the next, else the last. */
export function planEntryFor(data, vehicleId, now = Date.now()) {
  if (!data?.plans || !vehicleId) return null;
  const mine = [];
  for (const plan of data.plans) {
    for (const line of plan.lines ?? []) if (line.vehicleId === vehicleId) mine.push({ plan, line });
  }
  if (mine.length === 0) return null;
  const { line } = lineNow(mine.map((e) => e.line), now);
  const { plan } = mine.find((e) => e.line === line);
  return { plan, line, shifts: mine.length };
}

/**
 * The card's text, part by part. Lines that would only say "unknown" are
 * left out; the parts themselves always show, so the card keeps its shape.
 */
export function planCard({ plan, line, shifts = 1 }) {
  const pending = planStage(plan.status) === "PENDING";

  const fuel = [
    line.fullTank ? "Full" : line.litresRequested != null ? `${num(line.litresRequested)} L` : null,
    line.tankLitres != null ? `tank ${num(line.tankLitres)} L` : null,
    line.needLitres != null ? `need ≈ ${num(line.needLitres)} L` : null,
  ].filter(Boolean).join(" · ");

  const planned = line.plannedKm != null ? `${num(line.plannedKm)} km`
    : line.plannedHours != null ? `${num(line.plannedHours)} h` : null;
  const shift = [
    line.shiftNo != null ? `Shift ${line.shiftNo}` : "Shift",
    line.shiftStart ? ` from ${line.shiftStart.slice(0, 5)}` : "",
    planned ? `, ${planned}` : "",
  ].join("");

  const operators = [line.operator, line.secondOperator, line.thirdOperator].filter(Boolean).join(", ") || "none";

  // The line's fuel request and the pump's issues against it (server
  // work-plan-match: request by machine, day and shift; issues by request).
  let pump;
  if (!line.pump) pump = [pending ? "Not approved for the pump" : "Not fuelled yet"];
  else if (line.pump.issues.length === 0) {
    const st = String(line.pump.status ?? "").toUpperCase();
    pump = [!st || st === "APPROVED" ? "Not fuelled yet" : `Request ${sentence(st.replace(/_/g, " ")).toLowerCase()}`];
  } else {
    pump = line.pump.issues.map((i) => [
      i.done ? `${i.litres != null ? num(i.litres) : "-"} L at ${clockTime(i.at) || "-"}` : `Fuelling since ${clockTime(i.at) || "-"}`,
      i.tank ? ` from ${i.tank}` : "",
      i.pump ? `, ${i.pump}` : "",
      i.flags?.length ? ` (${i.flags.join(", ").toLowerCase()})` : "",
    ].join(""));
  }

  // The same three fuel facts as figures, for the card's strip: each a label
  // and its value, so the card never strings them together with dots.
  const fuelFigures = [
    line.fullTank ? { k: "Fuel", v: "Full" } : line.litresRequested != null ? { k: "Fuel", v: `${num(line.litresRequested)} L` } : null,
    line.tankLitres != null ? { k: "Tank", v: `${num(line.tankLitres)} L` } : null,
    line.needLitres != null ? { k: "Need", v: `≈ ${num(line.needLitres)} L` } : null,
  ].filter(Boolean);

  return {
    status: pending ? "Pending" : "Approved",
    machine: {
      code: line.machine,
      name: line.machineName ?? null,
      activity: line.activity,
      fuel: fuel || null,
      fuelFigures,
      expected: line.expectedOutput != null ? `Expected ${num(line.expectedOutput)}${line.outputUnit ? ` ${line.outputUnit}` : ""}` : null,
    },
    plan: {
      head: [plan.planCode, plan.department, dayShort(plan.day)].filter(Boolean).join(" · "),
      code: plan.planCode ?? null,
      about: [plan.department ? sentence(plan.department) : null, dayShort(plan.day)].filter(Boolean).join(", ") || null,
      task: line.taskId ? `Task ${line.taskId}` : null,
      sent: plan.submittedBy ? `Sent by ${plan.submittedBy}${plan.submittedAt ? `, ${wallClock(plan.submittedAt)}` : ""}` : null,
      decided: plan.reviewedBy ? `Decided by ${plan.reviewedBy}${plan.reviewedAt ? `, ${wallClock(plan.reviewedAt)}` : ""}` : null,
    },
    where: {
      fuelled: `Fuelled at ${line.fuelingLocation ?? "-"}`,
      works: `Works at ${line.workLocation ?? "-"}`,
    },
    shift: {
      when: shift + (shifts > 1 ? ` (1 of ${shifts} shifts today)` : ""),
      operators: `Operators: ${operators}`,
      supervisors: `Supervisors: ${line.supervisor || "none"}`,
    },
    pump,
    flags: line.flags?.length ? `Flags: ${line.flags.join("; ")}` : null,
    // The register shouts its reasons ("ELECTRICAL FAULT, LOW LEVEL OF
    // ENGINE OIL"); the card says them in a sentence.
    downReason: line.flags?.length && line.downReason ? sentence(line.downReason) : null,
    notes: line.notes || null,
  };
}
