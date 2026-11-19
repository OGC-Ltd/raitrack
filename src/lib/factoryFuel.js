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
    return {
      ...row,
      fuelNow: live?.fuelLitres ?? null,
      fuelNowPct: live?.fuelLitres != null ? live.fuelPct ?? null : null,
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
export const odometerUnit = (basis) => (basis === "HOUR" ? "h" : basis === "KM_PER_LITRE" ? "km" : "");

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
 * number of days (7, 14, 31: fuelRange, so tomorrow's plans are in), or one
 * fleet day ('YYYY-MM-DD').
 */
export function periodRange(pick, now = Date.now()) {
  if (typeof pick === "number") return fuelRange(pick, now);
  const day = pick === "today" ? new Date(now + 3 * 3_600_000).toISOString().slice(0, 10) : pick;
  return { from: day, to: day };
}

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
 * - Fuel before and after: the probe fill matched to the fuelling
 *   (reconcileFills), else FactorySuite's own probe check of it.
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
export function refillFigures(row, server) {
  const issueOf = new Map((row?.pumpIssues ?? []).map((i) => [i.id, i]));
  const lineOf = new Map((row?.lines ?? []).filter((l) => l.requestId).map((l) => [l.requestId, l]));
  const trackerOf = new Map((server?.refills ?? []).map((r) => [r.issueId, r]));
  return (row?.fills ?? [])
    .filter((f) => f.key?.startsWith("pump-"))
    .map((f) => {
      const id = f.key.slice("pump-".length);
      const i = issueOf.get(id) ?? {};
      const line = i.requestId ? lineOf.get(i.requestId) ?? null : null;
      const t = trackerOf.get(id) ?? null;
      const s = i.sensor ?? null;
      const level = (probe, fs) =>
        probe != null ? { litres: probe, source: "probe" } : fs != null ? { litres: fs, source: "factorysuite" } : null;
      const shift = t?.shift ?? null;
      return {
        key: f.key,
        id,
        at: f.at,
        day: f.day,
        siv: i.siv ?? null,
        fuelBefore: level(f.probeFill?.before ?? f.before, s?.beforeL),
        fuelAfter: level(f.probeFill?.after, s?.afterL),
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
        odometerBefore: t?.meterBefore ?? null,
        odometerAfter: i.readings?.physical ?? null,
        trackerAfter: t?.meterAfter ?? null,
        issued: f.actual ?? i.litres ?? null,
        tracked: t ? Boolean(t.tracked) : null,
      };
    })
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
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
    };
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
