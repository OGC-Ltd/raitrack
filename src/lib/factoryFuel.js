/**
 * The Fuel page's sums (operator 2026-11-14): FactorySuite's fuel module, as
 * fleet-server planner/factory-fuel returns it (plan lines with their request,
 * pump issues, the machines), added up per machine for the table and per day
 * for the strip. Pure, so the page and its tests read the same figures.
 *
 * "Need" is the register's rate times the plan (planned km ÷ km/L, or hours ×
 * L/h), FactorySuite's own sum; "requested" is what a line asked for when it
 * did not ask for a full tank; "issued" is what the pump put in.
 */

import { planStage } from "./workPlanMap";
import { vehicleReadings } from "./vehicleReadings";
import { addDays } from "./dayRange";

/** A plate for matching: capitals, letters and digits only ("MUFINDI - EX 16" → "MUFINDIEX16"). */
const plateKey = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Fuel consumed over each machine's own plan period (operator 2026-11-18:
 * Pump flags out, "fuel consumed" in), from its fuel probe, as a balance:
 *
 *   consumed = level at the period's start + fills − drains − level at its end
 *
 * `tankDays` is fleet-server planner/factory-fuel/tank-days (one row per unit
 * and fleet day). The start is the first day's opening level; the end the last
 * day's closing level, or, when the period runs to today, the live reading
 * (`fuelNow`, from withFuelNow), since today's row is only written tonight.
 * The period is the row's Period column, cut at today.
 *
 * Null ("-" on the page) when the machine has no tracked unit, no level at
 * either end, or the balance comes out below zero, which only a bad reading
 * can give; never a guess.
 *
 * @param {object[]} rows      fuelRoster rows, after withFuelNow
 * @param {object[]} tankDays  [{ vehicleId, day, openingL, closingL, fillL, drainL }]
 * @param {object[]} vehicles  the live fleet, to match a row by plate when it has no vehicleId
 * @param {string}   today     the fleet day today, YYYY-MM-DD
 */
export function withConsumed(rows, tankDays, vehicles, today) {
  const byVehicle = new Map();
  for (const d of tankDays ?? []) {
    const k = String(d.vehicleId);
    if (!byVehicle.has(k)) byVehicle.set(k, new Map());
    byVehicle.get(k).set(d.day, d);
  }
  const idByPlate = new Map();
  for (const v of vehicles ?? []) {
    const plate = plateKey(v?.id ?? v?.plate ?? v?.registrationPlate);
    if (plate && v?.vehicleId) idByPlate.set(plate, String(v.vehicleId));
  }
  return (rows ?? []).map((row) => ({ ...row, consumed: consumedFor(row, byVehicle, idByPlate, today) }));
}

function consumedFor(row, byVehicle, idByPlate, today) {
  const id = row.vehicleId ? String(row.vehicleId) : idByPlate.get(plateKey(row.plate));
  const days = id && byVehicle.get(id);
  if (!days || !row.firstDay || row.firstDay > today) return null;
  const end = !row.lastDay || row.lastDay > today ? today : row.lastDay;
  const start = days.get(row.firstDay)?.openingL;
  const finish = end === today ? row.fuelNow : days.get(end)?.closingL;
  if (start == null || finish == null) return null;
  let fills = 0;
  let drains = 0;
  for (const [day, d] of days) {
    if (day >= row.firstDay && day <= end) { fills += d.fillL ?? 0; drains += d.drainL ?? 0; }
  }
  const used = start + fills - drains - finish;
  // To the hundredth, the probe's own step (10 ml), only to drop float noise;
  // not to whole litres (operator 2026-11-20: "let us not round off at all").
  return used < 0 ? null : Math.round(used * 100) / 100;
}

/**
 * Each machine's tank right now, from its fuel probe (operator 2026-11-17:
 * the Maintenance page's "Fuel now" column, on the Fuel page too). From the
 * live fleet snapshot, read through vehicleReadings exactly as Maintenance
 * reads it, so the two pages never disagree on a figure.
 *
 * Matched on the register's `vehicleId` (the server's own link from machine to
 * tracked unit), else on the plate. A machine with no unit, no probe, or a
 * reading vehicleReadings rejects gets null: "-" on the page, never 0.
 */
export function withFuelNow(rows, vehicles) {
  const byId = new Map();
  const byPlate = new Map();
  for (const v of vehicles ?? []) {
    const r = vehicleReadings(v);
    if (v?.vehicleId) byId.set(String(v.vehicleId), r);
    const plate = plateKey(v?.id ?? v?.plate ?? v?.registrationPlate);
    if (plate) byPlate.set(plate, r);
  }
  return (rows ?? []).map((row) => {
    const live = (row.vehicleId && byId.get(String(row.vehicleId)))
      || (row.plate && byPlate.get(plateKey(row.plate)))
      || null;
    // The meter now, on the machine's own meter (operator 2026-11-20: "meter
    // now"): the live GPS odometer in km, or the live engine-hours counter on
    // an hour-rated machine, the same counter the server's refills read gives
    // (DG-08 967.62 h live, 967.6 h there).
    const unit = refillMeterUnit(row.basis);
    const meter = unit === "km" ? live?.odometerKm : live?.engineHours;
    return {
      ...row,
      fuelNow: live?.fuelLitres ?? null,
      fuelNowPct: live?.fuelLitres != null ? live.fuelPct ?? null : null,
      meterNow: meter != null ? { value: meter, unit, at: live?.lastReportedAt != null ? new Date(live.lastReportedAt).toISOString() : null } : null,
    };
  });
}

/** Every day from `from` to `to`, both inclusive. */
export function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const fold = (s) => String(s ?? "").trim().toUpperCase();
const add = (a, b) => (b == null ? a : (a ?? 0) + b);

/**
 * The litres a plan line plans (operator 2026-11-19: "Need" to "Planned", with
 * the planned value): what it asked for, or, for a full tank, the litres on its
 * fuel request, as FactorySuite puts a figure there (EX-17, 19 Nov: 650 L).
 * Null for a full tank whose request has none yet.
 */
export const plannedLitres = (l) => (l.fullTank ? l.requestLitres ?? null : l.litresRequested ?? l.requestLitres ?? null);

/** An issue the pump flagged: one of its three checks failed, or it wrote a note. */
export const issueFlagged = (i) => (i.flags?.length ?? 0) > 0 || Boolean(i.note);

/** Whether fuelling `i` was after the row's current odometer reading (day, then pump time). */
const readingAfter = (i, r) =>
  i.day > r.odometerDay || (i.day === r.odometerDay && String(i.at ?? "") > String(r.odometerAt ?? ""));

/** The odometer's unit: hours for an hour-rated machine, km for a km-rated one, none when not rated. */
export const odometerUnit = (basis) => (/^HOURS?$/i.test(String(basis ?? "").trim()) ? "h" : basis === "KM_PER_LITRE" ? "km" : "");

/**
 * The meter the refill figures read (fleet-server planner/fuel-refills): engine
 * hours on an hour-rated machine (generators, excavators, loaders), else the
 * tracker's GPS odometer in km. A standing generator's GPS odometer only drifts
 * (operator 2026-11-20: "why is a generator having odometer in KM").
 */
export const refillMeterUnit = (basis) => (odometerUnit(basis) === "h" ? "h" : "km");

/**
 * One row per machine on the range's plans or at its pumps, with its
 * department and activity as on its latest plan line.
 */
export function fuelRoster(data) {
  if (!data?.lines) return [];
  const byRef = new Map();
  const row = (ref) => {
    const k = fold(ref);
    if (!byRef.has(k)) {
      const m = (data.machines ?? []).find((x) => fold(x.reference) === k) ?? {};
      byRef.set(k, {
        reference: m.reference ?? ref, name: m.name ?? null, category: m.category ?? null,
        status: m.status ?? null, downReason: m.downReason ?? null,
        basis: m.basis ?? null, rate: m.rate ?? null, tankLitres: m.tankLitres ?? null,
        vehicleId: m.vehicleId ?? null, plate: m.plate ?? null,
        department: null, activity: null, workLocation: null, lastDay: null,
        shifts: 0, approved: 0, pending: 0, fullTanks: 0, days: new Set(),
        requested: null, need: null, issued: 0, issues: 0, flagged: 0,
        // plannedLitres over the lines; full tanks with no litres yet counted apart.
        planned: null, plannedFull: 0,
        odometer: null, odometerDay: null, odometerAt: null,
        lines: [], pumpIssues: [],
      });
    }
    return byRef.get(k);
  };
  for (const l of data.lines) {
    const r = row(l.machine);
    r.lines.push(l);
    r.shifts += 1;
    r.days.add(l.day);
    if (planStage(l.planStatus) === "PENDING") r.pending += 1; else r.approved += 1;
    if (l.fullTank) r.fullTanks += 1; else r.requested = add(r.requested, l.litresRequested);
    r.need = add(r.need, l.needLitres);
    const planned = plannedLitres(l);
    if (planned != null) r.planned = add(r.planned, planned); else if (l.fullTank) r.plannedFull += 1;
    if (!r.lastDay || l.day >= r.lastDay) {
      r.lastDay = l.day; r.department = l.department; r.activity = l.activity; r.workLocation = l.workLocation;
    }
  }
  for (const i of data.issues ?? []) {
    const r = row(i.machine);
    r.pumpIssues.push(i);
    r.issues += 1;
    r.issued += i.litres ?? 0;
    if (issueFlagged(i)) r.flagged += 1;
    // The odometer (operator 2026-11-19: "capture the odometer from factory
    // suite"): the meter the pump attendant reads at each fuelling, km or
    // hours as the machine is rated. The latest reading in the range stands.
    const reading = i.readings?.physical;
    if (Number.isFinite(reading) && (r.odometerDay == null || readingAfter(i, r))) {
      r.odometer = reading; r.odometerDay = i.day; r.odometerAt = i.at ?? null;
    }
    if (!r.department) r.department = i.department ?? null;
    if (!r.lastDay || i.day > r.lastDay) r.lastDay = i.day;
  }
  return [...byRef.values()]
    .map((r) => ({ ...r, days: r.days.size, firstDay: r.lines.reduce((m, l) => (!m || l.day < m ? l.day : m), null) }))
    .sort((a, b) => String(a.department ?? "~").localeCompare(String(b.department ?? "~"))
      || a.reference.localeCompare(b.reference, undefined, { numeric: true }));
}

/** The range day by day: shifts planned, litres needed and requested, litres issued. */
export function fuelByDay(data, rows = null) {
  if (!data?.from || !data?.to) return [];
  const lines = rows ? rows.flatMap((r) => r.lines) : data.lines ?? [];
  const issues = rows ? rows.flatMap((r) => r.pumpIssues) : data.issues ?? [];
  const days = new Map(daysBetween(data.from, data.to).map((day) => [day, { day, shifts: 0, need: 0, requested: 0, issued: 0 }]));
  for (const l of lines) {
    const d = days.get(l.day);
    if (!d) continue;
    d.shifts += 1;
    d.need += l.needLitres ?? 0;
    d.requested += l.fullTank ? 0 : l.litresRequested ?? 0;
  }
  for (const i of issues) {
    const d = days.get(i.day);
    if (d) d.issued += i.litres ?? 0;
  }
  return [...days.values()];
}

/** The strip's figures over the rows on screen. */
export function fuelTotals(rows) {
  const t = {
    machines: rows.length, onPlans: 0, shifts: 0, approved: 0, pending: 0, fullTanks: 0,
    need: 0, requested: 0, issued: 0, issues: 0, broken: 0, requests: 0,
    flags: { "Off plan": 0, "Operator mismatch": 0, "Job mismatch": 0, note: 0 },
    flaggedMachines: { "Off plan": 0, "Operator mismatch": 0, "Job mismatch": 0, note: 0 },
    departments: new Set(),
  };
  for (const r of rows) {
    if (r.shifts) t.onPlans += 1;
    t.shifts += r.shifts; t.approved += r.approved; t.pending += r.pending; t.fullTanks += r.fullTanks;
    t.need += r.need ?? 0; t.requested += r.requested ?? 0; t.issued += r.issued; t.issues += r.issues;
    t.requests += r.lines.filter((l) => l.requestId).length;
    if (r.status) t.broken += 1;
    if (r.department) t.departments.add(r.department);
    const seen = new Set();
    for (const i of r.pumpIssues) {
      for (const f of i.flags ?? []) { t.flags[f] = (t.flags[f] ?? 0) + 1; seen.add(f); }
      if (i.note) { t.flags.note += 1; seen.add("note"); }
    }
    for (const f of seen) t.flaggedMachines[f] = (t.flaggedMachines[f] ?? 0) + 1;
  }
  return { ...t, departments: t.departments.size };
}

/** The department filter's options: each department with its machine count. */
export function departmentOptions(rows) {
  // `count` is machines; `shifts` is plan lines, as FactorySuite counts them
  // (operator 2026-11-19: FactorySuite "96 approved", we showed 80 machines;
  // a machine on the day and the night shift is two lines).
  const counts = new Map();
  for (const r of rows) {
    const k = r.department ?? "";
    const c = counts.get(k) ?? counts.set(k, { count: 0, shifts: 0 }).get(k);
    c.count += 1;
    c.shifts += r.shifts ?? 0;
  }
  return [...counts.entries()]
    .map(([key, c]) => ({ key, label: key ? key.charAt(0) + key.slice(1).toLowerCase() : "No department", ...c }))
    .sort((a, b) => (a.key === "") - (b.key === "") || a.label.localeCompare(b.label));
}

/** The machine's state as the table's badge says it. */
export function machineState(r) {
  if (!r.status) return { label: "Available", tone: "active" };
  const words = r.status.charAt(0) + r.status.slice(1).toLowerCase().replace(/_/g, " ");
  return { label: words, tone: r.status === "BROKEN_DOWN" ? "terminated" : "suspended" };
}

/**
 * The days a Fuel or Operators period reads (operator, 19 Nov 2026: "select a
 * custom day and by default it should be on today"). `pick` is "today", a
 * number of days (7, 14, 31: fuelRange, so tomorrow's plans are in), one
 * fleet day ('YYYY-MM-DD'), or a range picked on the calendar
 * ('YYYY-MM-DD..YYYY-MM-DD', operator 20 Nov 2026: "pick a single date or a
 * range of dates").
 */
export function periodRange(pick, now = Date.now()) {
  if (typeof pick === "number") return fuelRange(pick, now);
  if (typeof pick === "string" && pick.includes("..")) {
    const [a, b] = pick.split("..");
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  const day = pick === "today" ? new Date(now + 3 * 3_600_000).toISOString().slice(0, 10) : pick;
  return { from: day, to: day };
}

/** The calendar's pick as a `pick`: one day as itself, a range as 'from..to'. */
export const calendarPick = (from, to) => (!to || to === from ? from : `${from}..${to}`);

/** The range that ends on the plans' day: tomorrow is planned today, so it is in. */
export function fuelRange(days, now = Date.now()) {
  const to = new Date(now + 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Pump against probe (operator 2026-11-17): each fuelling the pump recorded,
 * beside the fill the machine's fuel probe recorded, and the difference.
 * "We should have requested amount (Request), what is in the tank (Tank
 * Value), Filling Actual, Filling Probe, Variance."
 *
 * - Request: the plan line's fuel request the issue was made against
 *   (`requestId`): litres, or a full tank. A full tank expects the tank's
 *   size less what was in it before.
 * - Tank before: the probe's level just before its fill.
 * - Actual: litres the pump issued (FactorySuite).
 * - Probe: litres the probe's fill recorded (fuel/fillings `filledMl`).
 * - Variance: actual less probe. Positive: the pump says more went in than
 *   the probe saw.
 *
 * Matching: same machine (the register's vehicleId, else the plate), the probe
 * fill nearest in time from FILL_BEFORE_MS before the pump's time to
 * FILL_AFTER_MS after it (a probe settles after the nozzle is out), each fill
 * used once. Fuellings only: a probe fill no fuelling claims, and a reading
 * our check found was no real fill, are left out (operator 2026-11-17).
 */
export const FILL_BEFORE_MS = 30 * 60_000;
export const FILL_AFTER_MS = 2 * 3_600_000;
/** A variance is flagged past the larger of these: probes read to a few percent. */
export const VARIANCE_LITRES = 20;
export const VARIANCE_SHARE = 0.05;

/** FactorySuite's offsetless wall clock is Nairobi time; an ISO with a zone is taken as it is. */
export function pumpTimeMs(at) {
  if (!at) return null;
  const s = String(at);
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}+03:00`);
  return Number.isFinite(t) ? t : null;
}

/**
 * The colour a variance shows in (operator 2026-11-20): 2 L or less green,
 * over 2 L up to 5 L amber, past 5 L red. Judged on the litres as recorded,
 * either way round. null when there is no variance.
 */
export const VARIANCE_GREEN_L = 2;
export const VARIANCE_AMBER_L = 5;
export const varianceBand = (variance) => {
  if (variance == null || !Number.isFinite(Number(variance))) return null;
  const a = Math.round(Math.abs(Number(variance)) * 100) / 100;
  return a <= VARIANCE_GREEN_L ? "ok" : a <= VARIANCE_AMBER_L ? "warn" : "bad";
};

/** Over tolerance: more than VARIANCE_LITRES and more than VARIANCE_SHARE of what the pump issued. */
export const varianceFlagged = (actual, variance) =>
  // On the whole litres the page shows: 20.3 L reads "20 L" and is not past 20 L.
  variance != null && Math.round(Math.abs(variance)) > Math.max(VARIANCE_LITRES, VARIANCE_SHARE * Math.abs(actual ?? 0));

const ml = (v) => (Number.isFinite(v) ? v / 1000 : null);

/** A probe fill, in litres and milliseconds. Our verdict that it was no real fill marks it doubtful. */
function probeFill(f) {
  return {
    id: f.id,
    at: Date.parse(f.filledAt),
    litres: ml(f.filledMl),
    before: ml(f.initialFuelLevelMl),
    after: ml(f.finalFuelLevelMl),
    observed: ml(f.observedRiseMl),
    doubtful: f.verdict === "REDISTRIBUTION",
    verdict: f.verdict ?? null,
  };
}

/**
 * Each refill's seven figures (operator 2026-11-19, from the EX-17 test of that
 * day): fuel before and after the refill, consumed, planned, the odometer
 * before and after, and issued. One per fuelling the pump finished, newest
 * first.
 *
 * - Fuel before: FactorySuite's own probe check of the fuelling, else the
 *   probe fill matched to it (reconcileFills).
 * - Fuel after: the probe fill matched to the fuelling, else FactorySuite's.
 * - Consumed: fuel burned in the shift the fuelling was for, with the engine
 *   hours run (fleet-server fuel-refills); to now while the shift runs.
 * - Planned: the plan line the fuelling's request came from.
 * - Odometer before: the tracker's meter just before the nozzle went in.
 * - Odometer after: the meter read at the pump, with the tracker's beside it.
 * - Issued: what the pump put in, and its voucher.
 *
 * The odometer is hours on an hour-rated machine and km on a km-rated one.
 *
 * @param {object} row     a reconcileFills row (fills, pumpIssues, lines)
 * @param {object} server  getFuelRefills' answer, or null while it loads or when it failed
 */
/**
 * Odometer after a refill: the meter once the machine has done the work that
 * tank was for (operator 2026-11-20: "the after refill is for when the unit
 * completed its shifts after the refill" — "meter now"), on the same meter as
 * Odometer before so the two never cross:
 *
 * - pump meter (the default, operator 2026-11-20): an earlier refill takes the
 *   next fuelling's pump reading; the latest takes its pump reading plus what
 *   the tracker has run since (tracker now less tracker at the fuelling);
 * - tracker meter (no pump reading): the next refill's tracker before, or the
 *   tracker now for the latest.
 *
 * Mixed meters, or an after below the before, show as nothing.
 */
function withMeterAfter(refills, now) {
  return refills.map((r, k) => {
    const b = r.odometerBefore;
    let after = null;
    if (b?.value != null && k > 0) {
      const n = refills[k - 1].odometerBefore;
      if (n?.value != null && n.source === b.source && n.unit === b.unit) {
        after = { value: n.value, at: n.at ?? null, unit: b.unit, source: b.source === "pump" ? "next-refill-pump" : "next-refill" };
      }
    } else if (b?.value != null && now?.value != null) {
      if (now.unit !== b.unit) after = null;
      else if (b.source !== "pump") after = { value: now.value, at: now.at ?? null, unit: b.unit, source: "now" };
      else if (r.trackerBefore?.unit === b.unit && r.trackerBefore.value != null && now.value >= r.trackerBefore.value) {
        const run = now.value - r.trackerBefore.value;
        after = { value: Math.round((b.value + run) * 100) / 100, at: now.at ?? null, unit: b.unit, source: "now-pump", run: Math.round(run * 100) / 100 };
      }
    }
    return { ...r, meterAfter: after && after.value >= b.value ? after : null };
  });
}

/** One fuelling's Odometer before, with its source and unit (see refillFigures). */
function odometerBeforeOf(row, issue, tracker, fill) {
  const physical = issue.readings?.physical ?? null;
  const pump = physical != null
    ? { value: physical, at: fill.at != null ? new Date(fill.at).toISOString() : null, source: "pump", unit: odometerUnit(row?.basis) }
    : null;
  // On the machine's own meter only: hours on an hour-rated machine, km on the
  // rest. A reading on the other meter (an older server sent km for every
  // machine) is left out rather than shown under the wrong unit.
  const unit = refillMeterUnit(row?.basis);
  if (pump && pump.unit === unit) return pump;
  if (tracker?.meterBefore?.unit === unit) return { ...tracker.meterBefore, source: "tracker", unit };
  return null;
}

export function refillFigures(row, server) {
  const issueOf = new Map((row?.pumpIssues ?? []).map((i) => [i.id, i]));
  const lineOf = new Map((row?.lines ?? []).filter((l) => l.requestId).map((l) => [l.requestId, l]));
  const trackerOf = new Map((server?.refills ?? []).map((r) => [r.issueId, r]));
  const unit = refillMeterUnit(row?.basis);
  const list = (row?.fills ?? [])
    .filter((f) => f.key?.startsWith("pump-"))
    .map((f) => {
      const id = f.key.slice("pump-".length);
      const i = issueOf.get(id) ?? {};
      const line = i.requestId ? lineOf.get(i.requestId) ?? null : null;
      const t = trackerOf.get(id) ?? null;
      const s = i.sensor ?? null;
      const level = (probe, fs, pump) =>
        probe != null ? { litres: probe, source: "probe" } : fs != null ? { litres: fs, source: "factorysuite" }
          : pump != null ? { litres: pump, source: "pump" } : null;
      // From the pump alone (operator 2026-11-20: "fuel before, if we can get
      // it from the pump"): a full-tank fuelling ends at the tank's size, so it
      // began at the size less what went in. Only where neither probe read it.
      const issuedL = f.actual ?? i.litres ?? null;
      const tank = row?.tankLitres ?? null;
      const fullFill = Boolean(line?.fullTank) && tank != null && issuedL != null && issuedL <= tank;
      const shift = t?.shift ?? null;
      return {
        key: f.key,
        id,
        at: f.at,
        day: f.day,
        siv: i.siv ?? null,
        // FactorySuite's figure first (operator 2026-11-23: "the column for fuel
        // before should come from factory suite"): the tank level its probe
        // check read just before the nozzle (sensorBeforeLitres). Ours, then the
        // pump's full-tank sum, only where FactorySuite read none.
        fuelBefore: s?.beforeL != null
          ? { litres: s.beforeL, source: "factorysuite" }
          : level(f.probeFill?.before ?? f.before, null, fullFill ? Math.round((tank - issuedL) * 100) / 100 : null),
        fuelAfter: level(f.probeFill?.after, s?.afterL, fullFill ? tank : null),
        consumed: shift
          ? { litres: shift.consumedL ?? null, engineHours: shift.engineHours ?? null, open: Boolean(shift.open), ahead: Boolean(shift.ahead) }
          : null,
        planned: line
          ? {
            full: Boolean(line.fullTank), litres: plannedLitres(line),
            need: line.needLitres ?? null, shiftNo: line.shiftNo ?? 1, shiftStart: line.shiftStart ?? null,
            hours: line.plannedHours ?? null, km: line.plannedKm ?? null,
          }
          : null,
        // On the machine's meter (refillMeterUnit): the reading keyed in at
        // the pump ("by default lets use the odometer value keyed at the
        // pump"), else the tracker's: km on a km-rated machine (operator
        // 2026-11-20: "do conversion into km for the odometers"), engine hours
        // on an hour-rated one. trackerBefore stays for the latest refill's
        // after and the hover.
        odometerBefore: odometerBeforeOf(row, i, t, f),
        trackerBefore: t?.meterBefore?.unit === unit ? t.meterBefore : null,
        odometerAfter: i.readings?.physical ?? null,
        trackerAfter: t?.meterAfter ?? null,
        trackerNow: t?.meterNow?.unit === unit ? t.meterNow : null,
        issued: f.actual ?? i.litres ?? null,
        tracked: t ? Boolean(t.tracked) : null,
      };
    })
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  // The odometer now off the server's telemetry, the same column as the
  // before figures: the live snapshot's mileage is Wialon's own counter on
  // another base (MTR-21: 37,488 km there, 1,815 km here) and is never mixed in.
  return withMeterAfter(list, list.find((x) => x.trackerNow)?.trackerNow ?? null);
}

/**
 * The refill figures as table columns (operator 2026-11-19: "we should also
 * have the columns on the table, not on the side panels alone"): each row
 * takes its machine's latest refill in the period, as the Odometer column
 * takes the latest pump reading. `fuelBefore`, `fuelAfter` and
 * `odometerBefore` are plain numbers so the columns sort; `lastRefill` keeps
 * where each came from, and `refillCount` how many the panel lists.
 *
 * @param {object[]} rows    reconcileFills rows
 * @param {object}   meters  getFuelRefills' answer for every machine, or null
 */
export function withRefillColumns(rows, meters) {
  return (rows ?? []).map((row) => {
    const all = refillFigures(row, meters);
    const last = all[0] ?? null;
    return {
      ...row,
      lastRefill: last,
      refillCount: all.length,
      fuelBefore: last?.fuelBefore?.litres ?? null,
      fuelAfter: last?.fuelAfter?.litres ?? null,
      odometerBefore: last?.odometerBefore?.value ?? null,
      odometerAfter: last?.meterAfter?.value ?? null,
    };
  });
}

/**
 * Consumed since the latest refill (operator 2026-11-20: "consumed should be
 * accumulative" — since the last refill): what the tank held just after the
 * machine's latest refill in the period, less what it holds at the period's
 * end, as one running figure that grows until the next refill.
 *
 *   consumed = fuel after the refill + later fills − later drains − level at the end
 *
 * The end is the live probe reading when the row's Period runs to today, else
 * the closing level of its last day. "Later" is the days after the refill's
 * day (tank days are whole days, and the refill's own day already holds the
 * refill); fuel drained out is not counted as burnt. The period balance
 * withConsumed gave stays on the row as `consumedPeriod`.
 *
 * Null ("-") with no refill in the period, no level after it or at the end,
 * or a balance below zero, which only a bad reading can give.
 *
 * @param {object[]} rows      withRefillColumns rows
 * @param {object[]} tankDays  [{ vehicleId, day, openingL, closingL, fillL, drainL }], or null
 * @param {string}   today     the fleet day today, YYYY-MM-DD
 */
export function withConsumedSinceRefill(rows, tankDays, today) {
  const byVehicle = new Map();
  for (const d of tankDays ?? []) {
    const k = String(d.vehicleId);
    if (!byVehicle.has(k)) byVehicle.set(k, new Map());
    byVehicle.get(k).set(d.day, d);
  }
  return (rows ?? []).map((row) => {
    const out = { ...row, consumedPeriod: row.consumed ?? null, consumed: null, consumedEnd: null };
    const refill = row.lastRefill;
    const after = refill?.fuelAfter?.litres;
    if (after == null || !refill.day) return out;
    const days = row.vehicleId ? byVehicle.get(String(row.vehicleId)) : null;
    const end = !row.lastDay || row.lastDay >= today ? today : row.lastDay;
    if (end < refill.day) return out;
    const endL = end === today ? row.fuelNow ?? null : days?.get(end)?.closingL ?? null;
    if (endL == null) return out;
    let fills = 0;
    let drains = 0;
    for (const [day, d] of days ?? []) {
      if (day > refill.day && day <= end) { fills += d.fillL ?? 0; drains += d.drainL ?? 0; }
    }
    const used = after + fills - drains - endL;
    if (used < 0) return out;
    return { ...out, consumed: Math.round(used * 100) / 100, consumedEnd: end === today ? "now" : end };
  });
}

/**
 * Fuel before and Odometer before while a machine waits for its refill
 * (operator 2026-11-20: "fuel before it should be their closing fuel level
 * that continuously updates until their first refill for the day which will
 * also be captured during the refill stage"; "we don't expect the fuel before
 * to be empty, neither the odometer before"). For a row with no fuelling on
 * its period's last day:
 *
 *  - fuel: the tank at the START of that day, from the fuel probe (operator
 *    2026-11-23: BH-01, unfuelled, "about 104 L of fuel before", the level it
 *    began the day with, not the 74.6 L left after its shift): the day's
 *    opening level, or the day before's closing (today's row is written only
 *    at night). With neither, the live tank on today, else the day's closing;
 *  - meter: the live engine hours (withFuelNow) on an hour-rated machine,
 *    today only: the tank days carry no meter for a past day, and the live
 *    km counter runs on another base than the refills' (MTR-21: 37,488 km
 *    live, 1,815 km there), so a km figure would jump at the refill.
 *
 * Once the day's refill comes in, the refill's own before readings take over.
 * Kept as `fuelBeforeWaiting` / `odometerBeforeWaiting` beside the refill's,
 * and in `fuelBefore` / `odometerBefore` so the columns sort. Untouched when
 * the day had a refill whose before nobody read: the level now is after it.
 *
 * @param {object[]} rows      withConsumedSinceRefill rows
 * @param {object[]} tankDays  [{ vehicleId, day, openingL, closingL }], or null;
 *                             from the day before the period, for today's opening
 * @param {string}   today     the fleet day today, YYYY-MM-DD
 */
export function withFuelBeforeWaiting(rows, tankDays, today) {
  const byDay = new Map();
  for (const d of tankDays ?? []) byDay.set(`${d.vehicleId}|${d.day}`, d);
  return (rows ?? []).map((row) => {
    const end = !row.lastDay || row.lastDay >= today ? today : row.lastDay;
    if (row.lastRefill?.day && row.lastRefill.day >= end) return row;
    const live = end === today;
    const out = { ...row };
    if (row.fuelBefore == null) {
      const id = row.vehicleId ? String(row.vehicleId) : null;
      const opening = id ? byDay.get(`${id}|${end}`)?.openingL ?? byDay.get(`${id}|${addDays(end, -1)}`)?.closingL ?? null : null;
      const fallback = live ? row.fuelNow ?? null : id ? byDay.get(`${id}|${end}`)?.closingL ?? null : null;
      const litres = opening ?? fallback;
      if (litres != null) {
        out.fuelBefore = litres;
        out.fuelBeforeWaiting = { litres, source: opening != null ? "opening" : live ? "live" : "closing", day: end };
      }
    }
    if (row.odometerBefore == null && live && row.meterNow?.unit === "h" && row.meterNow.value != null) {
      out.odometerBefore = row.meterNow.value;
      out.odometerBeforeWaiting = { ...row.meterNow, source: "live" };
    }
    return out;
  });
}

/**
 * Fuel before as the tank before the day's work (operator 2026-11-23: "the
 * reading should be before it started working as per the work plan for
 * instance ex 17, before 06:00 it was at +191L that is before work is done and
 * before refuel was done"): the fuel probe's level over the first ten minutes
 * of the machine's first planned shift that day, from the shifts read
 * (fleet-server planner/factory-fuel/shifts, each window's `firstTenL`, else
 * its `startL`).
 *
 * The day is the latest refill's, else the period's last day up to today. A
 * refill that came before that shift started keeps its own before reading (the
 * tank before the pump), since the shift's start is already after it. A shift
 * not started yet, unmeasured, or a machine with no plan line that day, leaves
 * the row's Fuel before as it was (refill, then the day's opening).
 *
 * @param {object[]} rows    withFuelBeforeWaiting rows
 * @param {object}   shifts  getFuelShifts' answer, or null
 * @param {string}   today   the fleet day today, YYYY-MM-DD
 */
const foldRef = (s) => String(s ?? "").trim().toUpperCase();
/** The fleet day (EAT) an instant falls on. */
const eatDay = (iso) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);
/** Each machine's shift windows from the shifts read, by folded reference. */
const shiftWindowsOf = (shifts) => new Map((shifts?.machines ?? []).map((m) => [foldRef(m.machine), m.windows ?? []]));

export function withFuelBeforeShift(rows, shifts, today) {
  const windowsOf = shiftWindowsOf(shifts);
  return (rows ?? []).map((row) => {
    const windows = windowsOf.get(foldRef(row.reference));
    if (!windows?.length) return row;
    const end = !row.lastDay || row.lastDay >= today ? today : row.lastDay;
    const day = row.lastRefill?.day ?? end;
    const first = windows
      .filter((w) => w.start && eatDay(w.start) === day)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    // Over the shift's first ten minutes (operator 2026-11-23: "we need to
    // capture the fuel level first 10 minutes of work"), else the shift's
    // opening readings from a server without that figure.
    const litres = first?.firstTenL ?? first?.startL ?? null;
    if (!first || first.ahead || litres == null) return row;
    const refill = row.lastRefill?.day === day ? row.lastRefill : null;
    if (refill?.at != null && refill.at < Date.parse(first.start)) return row;
    return {
      ...row,
      fuelBefore: litres,
      fuelBeforeShift: {
        litres, at: first.firstTenAt ?? first.start, day, firstTen: first.firstTenL != null,
        // where the ten minutes began: the engine coming on, or the planned start
        from: first.firstTenL != null ? first.firstTenFrom ?? "shift" : "shift",
      },
    };
  });
}

/**
 * Consumed and Probe used over the planned work (operator 2026-11-23:
 * "consumption then should be the start - end + issued (start we have
 * determined is [the first ten] minutes of work), and for probe used it
 * should also be covering the working hours"), from the shifts read:
 *
 *   Consumed   = start − end + issued
 *     start    the tank over the first ten minutes of work in the period's
 *              first measured shift (Fuel before's figure on a one-day period)
 *     end      the tank at the end of the last measured shift, or now while it runs
 *     issued   litres the pump put in between the two; a fuelling before the
 *              work began is already in the start, one after it ended is not
 *              in the end, so neither is added
 *   Probe used = the register's standard × the engine hours worked in those
 *              shifts (km ÷ km/L on a km-rated machine)
 *
 * The figure from the latest refill stays as `consumedSinceRefill` for the
 * machine panel's refill card. With no shifts read (loading, or the read
 * failed) the rows are left as they were; a machine with no measured shift in
 * the period gets nothing, with `workWhy` saying why.
 *
 * @param {object[]} rows    withProbeUsed rows
 * @param {object}   shifts  getFuelShifts' answer, or null
 * @param {string}   today   the fleet day today, YYYY-MM-DD
 * @param {number}   now     ms, for a shift still running
 */
export function withWorkConsumption(rows, shifts, today, now = Date.now()) {
  if (!shifts) return rows ?? [];
  const windowsOf = shiftWindowsOf(shifts);
  const r2 = (v) => Math.round(v * 100) / 100;
  return (rows ?? []).map((row) => {
    const out = { ...row, consumedSinceRefill: row.consumed ?? null, consumedSinceRefillEnd: row.consumedEnd ?? null };
    const end = !row.lastDay || row.lastDay >= today ? today : row.lastDay;
    const first = row.firstDay && row.firstDay <= end ? row.firstDay : end;
    const ws = (windowsOf.get(foldRef(row.reference)) ?? [])
      .filter((w) => w.start && !w.ahead && eatDay(w.start) >= first && eatDay(w.start) <= end)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const startW = ws.find((w) => (w.firstTenL ?? w.startL) != null);
    const endW = [...ws].reverse().find((w) => w.endL != null);
    // Probe used: the hours (or km) the tracker counted in the shifts.
    const byKm = refillMeterUnit(row.basis) === "km";
    const runs = ws.map((w) => (byKm ? w.km : w.hours)).filter((v) => v != null);
    const run = runs.length ? r2(runs.reduce((s, v) => s + v, 0)) : null;
    const rate = row.rate != null && row.rate > 0 ? row.rate : null;
    const usedL = run == null || rate == null ? null : r2(byKm ? run / rate : run * rate);
    const open = ws.some((w) => w.open);
    out.probeUsed = usedL;
    out.probeUse = run == null && rate == null ? null : { run, unit: byKm ? "km" : "h", rate, litres: usedL, open, source: "work", shifts: ws.length };
    if (!startW || !endW) {
      return { ...out, consumed: null, consumedEnd: null, consumedWork: null, workWhy: ws.length ? "no-probe" : "no-shift" };
    }
    const startL = startW.firstTenL ?? startW.startL;
    const startAt = Date.parse(startW.firstTenAt ?? startW.start);
    // A shift that ended while the tracker was silent is read at its first
    // reading back (fleet-server fuel-shifts endedInGap): endAt says when.
    const endAt = endW.open ? now : Date.parse(endW.endAt ?? endW.end);
    const issuedIn = (row.pumpIssues ?? [])
      .filter((i) => i.done !== false)
      .map((i) => ({ t: pumpTimeMs(i.startedAt ?? i.at), litres: i.litres ?? 0 }))
      .filter((i) => i.t != null && i.t >= startAt && i.t <= endAt);
    const issued = r2(issuedIn.reduce((s, i) => s + i.litres, 0));
    const used = r2(startL - endW.endL + issued);
    const work = { startL, startAt, endL: endW.endL, endAt, open: Boolean(endW.open), gap: Boolean(endW.endGap), issued, fuellings: issuedIn.length };
    // Below nothing, the readings contradict each other (a fuelling the pump
    // did not record, or a probe fault): no figure rather than a wrong one.
    if (used < 0) return { ...out, consumed: null, consumedEnd: null, consumedWork: work, workWhy: "negative" };
    return { ...out, consumed: used, consumedEnd: endW.open ? "now" : eatDay(endW.end), consumedWork: work, workWhy: null };
  });
}

/**
 * The Probe used column (operator 2026-11-20: "make the probe used the
 * standard burn rate * the hours worked so far (odometer reading after fill
 * and before fill)"): the fuel the machine should have burnt since its latest
 * refill, at the register's standard rate.
 *
 *   hour-rated:  probeUsed = rate (L/h) × (Odometer after − Odometer before)
 *   km-rated:    probeUsed = (Odometer after − Odometer before) ÷ rate (km/L)
 *
 * Odometer before is the meter at the refill, Odometer after the meter now (or
 * at the next refill), both from the refill itself (refillFigures), never the
 * live reading a waiting row borrows. `probeUse` keeps the run and the rate for
 * the hover; it is null, and the cell "-", with no refill, no after reading,
 * or no standard rate.
 */
export function withProbeUsed(rows) {
  return (rows ?? []).map((r) => {
    const before = r.lastRefill?.odometerBefore?.value;
    const after = r.lastRefill?.meterAfter?.value;
    const byKm = refillMeterUnit(r.basis) === "km";
    const rate = r.rate != null && r.rate > 0 ? r.rate : null;
    const run = before != null && after != null && after >= before ? Math.round((after - before) * 100) / 100 : null;
    const litres = run == null || rate == null ? null : Math.round((byKm ? run / rate : run * rate) * 100) / 100;
    const probeUse = run == null && rate == null ? null : { run, unit: byKm ? "km" : "h", rate, litres, open: r.lastRefill?.meterAfter?.source?.startsWith("now") ?? false };
    return { ...r, probeUse, probeUsed: litres };
  });
}

/**
 * @param {object[]} rows      fuelRoster rows (with vehicleId, plate, pumpIssues, lines, tankLitres)
 * @param {object[]} fillings  fuel/fillings rows for the period, or null when they could not be read
 * @returns rows with `fills` (one per fuelling or unclaimed probe fill, newest first) and
 *   `probeFilled`, `variance`, `varianceFlags`, `probeKnown`
 */
export function reconcileFills(rows, fillings) {
  const known = Array.isArray(fillings);
  const byId = new Map();
  const byPlate = new Map();
  for (const f of fillings ?? []) {
    const p = probeFill(f);
    // Fuellings only (operator 2026-11-17: "just make the comparisons of fuel
    // fillings only"): a reading our check found was no real fill, fuel moving
    // in the tank, is never a fuelling's match.
    if (!Number.isFinite(p.at) || p.doubtful) continue;
    const push = (m, k) => { if (k) m.set(k, [...(m.get(k) ?? []), p]); };
    push(byId, f.vehicleId && String(f.vehicleId));
    push(byPlate, plateKey(f.vehicle?.registrationPlate));
  }

  return (rows ?? []).map((row) => {
    const probes = (row.vehicleId && byId.get(String(row.vehicleId)))
      || (row.plate && byPlate.get(plateKey(row.plate)))
      || [];
    const requestOf = new Map((row.lines ?? []).filter((l) => l.requestId).map((l) => [l.requestId, l]));
    const used = new Set();

    const issues = [...(row.pumpIssues ?? [])]
      .filter((i) => i.done)
      .map((i) => ({ i, t: pumpTimeMs(i.at) ?? pumpTimeMs(`${i.day}T12:00:00`) }))
      .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

    // One row a fuelling the pump recorded; a probe fill no fuelling claims is
    // not listed and not counted.
    const fills = issues.map(({ i, t }) => {
      let best = null;
      for (const p of probes) {
        if (used.has(p.id) || t == null) continue;
        const d = p.at - t;
        if (d < -FILL_BEFORE_MS || d > FILL_AFTER_MS) continue;
        if (!best || Math.abs(d) < Math.abs(best.at - t)) best = p;
      }
      if (best) used.add(best.id);
      const line = i.requestId ? requestOf.get(i.requestId) : null;
      const before = best?.before ?? null;
      const actual = i.litres ?? null;
      const probe = best ? best.litres : null;
      const variance = actual != null && probe != null ? actual - probe : null;
      return {
        key: `pump-${i.id}`,
        at: t, day: i.day,
        request: line ? (line.fullTank ? { full: true } : { litres: line.litresRequested ?? null }) : null,
        expected: line?.fullTank && row.tankLitres != null && before != null ? Math.max(0, row.tankLitres - before) : null,
        before, actual, probe, variance,
        probeFill: best,
        state: !known ? "unknown"
          : !best ? "no-probe"
          : varianceFlagged(actual, variance) ? "over" : "ok",
      };
    }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

    // The period's figures, over the fuellings the probe saw too, so pump and
    // probe compare like for like: Pump is what the pump issued in those,
    // Probe what the probe recorded for them, Variance the one less the other.
    const paired = fills.filter((f) => f.variance != null);
    const pumpMatched = paired.length ? paired.reduce((s, f) => s + f.actual, 0) : null;
    const probeFilled = paired.length ? paired.reduce((s, f) => s + f.probe, 0) : null;
    const variance = paired.length ? pumpMatched - probeFilled : null;
    return {
      ...row,
      fills,
      probeKnown: known,
      pumpMatched,
      probeFilled,
      variance,
      varianceOver: varianceFlagged(pumpMatched ?? 0, variance),
      varianceFlags: fills.filter((f) => f.state === "over" || f.state === "no-probe").length,
    };
  });
}
