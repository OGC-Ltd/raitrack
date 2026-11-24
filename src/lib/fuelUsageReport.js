// Mufindi Fuel Usage Report (operator 2026-11-24): what the work plans needed,
// what the pumps issued, and where fuel did not go into work, over a period
// of up to 31 days. Version 1 is built from the plans and the pumps alone
// (FactorySuite via planner/factory-fuel): engine hours from the trackers come
// later, as 27 of Mufindi's 131 machines have no tracker.
//
// Pure: no React, no network. The Fuel page's own sums (lib/factoryFuel
// fuelRoster, fuelByDay, fuelTotals) are reused, so the report's need and
// issued are the Fuel page's for the same days and the same site.

import { fuelRoster, fuelByDay, fuelTotals } from './factoryFuel';

const fold = (s) => String(s ?? '').trim().toUpperCase();
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);

/** The register states that keep a machine from working. */
export const DOWN_STATUSES = new Set(['BROKEN_DOWN', 'IN_WORKSHOP', 'WORKSHOP']);
export const isDown = (status) => DOWN_STATUSES.has(fold(status));

/** The pump's own checks that count as flags. A note alone is not one: most fills carry a note. */
export const PUMP_FLAGS = ['Off plan', 'Operator mismatch', 'Job mismatch'];
export const pumpFlagsOf = (i) => (i.flags ?? []).filter((f) => PUMP_FLAGS.includes(f));

/** A refill this soon (planned use since the last fill under this share of it) is too early. */
export const EARLY_SHARE = 0.5;
/** A fill this much over the tank's size is more than it holds. */
export const OVER_TANK_SHARE = 1.05;
/** Litres a fill may exceed the room the probe saw before it is called more than the tank could take. */
export const ROOM_SLACK_L = 20;

/**
 * One machine type, whatever the register's spelling: "DIESEL GENERATORS",
 * "Diesel Generator" and "SMALL DIESEL GENERATORS" are one type; "Concret
 * Mixer" is a Concrete mixer.
 */
export function machineType(category) {
  const s = String(category ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/^small\s+/, '').replace(/\bconcret\b/, 'concrete');
  if (!s) return 'Unspecified';
  const one = s.replace(/s$/, '');
  return one.charAt(0).toUpperCase() + one.slice(1);
}

/** The work location of a plan line: its site; the department where FactorySuite gives none. */
export const lineSite = (l) => String(l.workLocation ?? '').trim() || String(l.department ?? '').trim() || 'No site';

/**
 * Each machine's main site over the period: the work location with the most
 * planned shifts (a machine can work several in a week: 31 of 131 did, 16–22 Nov).
 */
export function mainSites(data) {
  const by = new Map();
  for (const l of data?.lines ?? []) {
    const m = fold(l.machine);
    const s = lineSite(l);
    if (!by.has(m)) by.set(m, new Map());
    by.get(m).set(s, (by.get(m).get(s) ?? 0) + 1);
  }
  const out = new Map();
  for (const [m, sites] of by) out.set(m, [...sites].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  return out;
}

/**
 * The site each pump issue counts under: the site of the shift it was
 * requested for; else the machine's main site; else its department.
 */
export function issueSites(data) {
  const byRequest = new Map((data?.lines ?? []).filter((l) => l.requestId).map((l) => [l.requestId, lineSite(l)]));
  const main = mainSites(data);
  const out = new Map();
  for (const i of data?.issues ?? []) {
    out.set(i, (i.requestId && byRequest.get(i.requestId)) || main.get(fold(i.machine)) || String(i.department ?? '').trim() || 'No site');
  }
  return out;
}

/** The sites in the period, busiest first by need. */
export function siteOptions(data) {
  const need = new Map();
  for (const l of data?.lines ?? []) need.set(lineSite(l), (need.get(lineSite(l)) ?? 0) + (l.needLitres ?? 0));
  for (const [, s] of issueSites(data)) if (!need.has(s)) need.set(s, 0);
  return [...need].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
}

/** The period's data for one site (lines by their own site, issues by theirs); all of it for no site. */
export function forSite(data, site) {
  if (!site || !data) return data;
  const sites = issueSites(data);
  return {
    ...data,
    lines: (data.lines ?? []).filter((l) => lineSite(l) === site),
    issues: (data.issues ?? []).filter((i) => sites.get(i) === site),
  };
}

/** A fill's place in time: its day, then its pump time. */
const whenOf = (i) => `${i.day ?? ''} ${i.startedAt ?? i.at ?? ''}`;

/** What a machine's plan says it would use on one day: planned hours × L/h, or planned km ÷ km/L. */
function plannedUse(lines, basis, rate) {
  if (!(rate > 0)) return null;
  if (/^HOURS?$/i.test(String(basis ?? ''))) return sum(lines, (l) => (l.plannedHours ?? 0) * rate);
  if (fold(basis) === 'KM_PER_LITRE') return sum(lines, (l) => (l.plannedKm ?? 0) / rate);
  return null;
}

/**
 * Refills that came before the last fill could have been used: the plan's
 * work between the two fills (shifts from the last fill's day up to the day
 * before this one; that day's shifts when both are on one day) would burn
 * under EARLY_SHARE of the last fill.
 */
export function earlyRefills(row) {
  const fills = row.pumpIssues.filter((i) => (i.litres ?? 0) > 0).sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
  const out = [];
  for (let k = 1; k < fills.length; k++) {
    const prev = fills[k - 1];
    const next = fills[k];
    const between = prev.day === next.day
      ? row.lines.filter((l) => l.day === prev.day)
      : row.lines.filter((l) => l.day >= prev.day && l.day < next.day);
    const use = plannedUse(between, row.basis, row.rate);
    if (use == null) continue;
    if (use < EARLY_SHARE * prev.litres) out.push({ machine: row.reference, prev, fill: next, plannedUse: use, lastFill: prev.litres });
  }
  return out;
}

/** A fill larger than the machine's tank, or than the room the probe saw in it before. */
export function overTank(issue, tankLitres) {
  const litres = issue.litres ?? 0;
  if (!(tankLitres > 0) || !(litres > 0)) return null;
  if (litres > tankLitres * OVER_TANK_SHARE) return { kind: 'tank', limit: tankLitres, over: litres - tankLitres };
  const before = issue.sensor?.beforeL;
  if (Number.isFinite(before) && before >= 0 && before < tankLitres) {
    const room = tankLitres - before;
    if (litres > room + ROOM_SLACK_L) return { kind: 'room', limit: room, over: litres - room };
  }
  return null;
}

/** Litres a fill put in that the probe did not see arrive, where FactorySuite's own probe check failed. */
export function probeShortL(issue) {
  if (String(issue.sensor?.check ?? '').toUpperCase() !== 'MISMATCH') return null;
  const rise = issue.sensor?.riseL;
  if (!Number.isFinite(rise) || !((issue.litres ?? 0) > 0)) return null;
  return Math.max(0, issue.litres - Math.max(0, rise));
}

/**
 * The whole report for the period (and site, when one is picked).
 *
 * @param {object} data   planner/factory-fuel: { from, to, lines, issues, machines }
 * @param {object} [o]    { site, price } price per litre, or null when unknown
 */
export function buildFuelUsage(data, { site = null, price = null } = {}) {
  const scoped = forSite(data, site);
  const rows = fuelRoster(scoped);
  const totals = fuelTotals(rows);
  const days = fuelByDay(scoped, rows);
  const sites = issueSites(scoped);
  const main = mainSites(scoped);

  // Running totals day by day, for the chart
  let needRun = 0;
  let issuedRun = 0;
  const cumulative = days.map((d) => ({ day: d.day, need: (needRun += d.need), issued: (issuedRun += d.issued) }));

  // Shifts: how many, and how many machine-days carried two or more
  const perMachineDay = new Map();
  for (const l of scoped?.lines ?? []) {
    const k = `${fold(l.machine)}|${l.day}`;
    perMachineDay.set(k, (perMachineDay.get(k) ?? 0) + 1);
  }
  const multiShiftDays = [...perMachineDay.values()].filter((n) => n > 1).length;

  // By site
  const siteMap = new Map();
  const siteRow = (s) => {
    if (!siteMap.has(s)) siteMap.set(s, { site: s, machines: new Set(), fuelled: new Set(), shifts: 0, need: 0, issued: 0, fills: 0 });
    return siteMap.get(s);
  };
  for (const l of scoped?.lines ?? []) {
    const r = siteRow(lineSite(l));
    r.machines.add(fold(l.machine)); r.shifts += 1; r.need += l.needLitres ?? 0;
  }
  for (const i of scoped?.issues ?? []) {
    const r = siteRow(sites.get(i));
    r.issued += i.litres ?? 0; r.fills += 1;
    if ((i.litres ?? 0) > 0) r.fuelled.add(fold(i.machine));
  }
  const bySite = [...siteMap.values()]
    .map((r) => ({ ...r, machines: r.machines.size, fuelled: r.fuelled.size, variance: r.issued - r.need }))
    .sort((a, b) => b.need - a.need || a.site.localeCompare(b.site));

  // By machine type
  const typeMap = new Map();
  for (const r of rows) {
    const t = machineType(r.category);
    if (!typeMap.has(t)) typeMap.set(t, { type: t, units: 0, shifts: 0, need: 0, issued: 0, fills: 0 });
    const x = typeMap.get(t);
    x.units += 1; x.shifts += r.shifts; x.need += r.need ?? 0; x.issued += r.issued; x.fills += r.issues;
  }
  const byType = [...typeMap.values()].sort((a, b) => b.issued - a.issued || b.need - a.need || a.type.localeCompare(b.type));

  // Exceptions
  const early = rows.flatMap(earlyRefills);
  const overTankFills = rows.flatMap((r) => r.pumpIssues.map((i) => ({ machine: r.reference, issue: i, tankLitres: r.tankLitres, over: overTank(i, r.tankLitres) })).filter((x) => x.over));
  const probeShort = rows.flatMap((r) => r.pumpIssues.map((i) => ({ machine: r.reference, issue: i, shortL: probeShortL(i) })).filter((x) => x.shortL > 0));
  const flagged = rows.flatMap((r) => r.pumpIssues.filter((i) => pumpFlagsOf(i).length).map((i) => ({ machine: r.reference, issue: i, flags: pumpFlagsOf(i) })));
  const offPlanL = sum(flagged.filter((x) => x.flags.includes('Off plan')), (x) => x.issue.litres);
  const plannedNotFuelled = rows.filter((r) => r.shifts > 0 && !(r.issued > 0))
    .map((r) => ({ machine: r.reference, type: machineType(r.category), site: main.get(fold(r.reference)) ?? r.department ?? '', days: r.days, shifts: r.shifts, need: r.need ?? 0, down: isDown(r.status) }))
    .sort((a, b) => b.need - a.need || a.machine.localeCompare(b.machine, undefined, { numeric: true }));
  const downOnPlan = rows.filter((r) => isDown(r.status) && (r.shifts > 0 || r.issued > 0))
    .map((r) => ({ machine: r.reference, type: machineType(r.category), status: r.status, reason: r.downReason ?? null, shifts: r.shifts, need: r.need ?? 0, issued: r.issued }));

  // By operator, from who was at the pump
  const opMap = new Map();
  for (const r of rows) {
    for (const i of r.pumpIssues) {
      const name = String(i.operator ?? '').trim() || 'Not recorded';
      if (!opMap.has(name)) opMap.set(name, { operator: name, fills: 0, litres: 0, machines: new Set(), flags: 0, probeShortL: 0 });
      const o = opMap.get(name);
      o.fills += 1; o.litres += i.litres ?? 0; o.machines.add(r.reference);
      if (pumpFlagsOf(i).length) o.flags += 1;
      o.probeShortL += probeShortL(i) ?? 0;
    }
  }
  const byOperator = [...opMap.values()].map((o) => ({ ...o, machines: o.machines.size })).sort((a, b) => b.litres - a.litres || a.operator.localeCompare(b.operator));

  // The register: every machine on the plans or at the pumps
  const register = rows.map((r) => ({
    machine: r.reference,
    type: machineType(r.category),
    site: main.get(fold(r.reference)) ?? r.department ?? '',
    department: r.department ?? '',
    days: r.days,
    shifts: r.shifts,
    plannedHours: sum(r.lines, (l) => l.plannedHours),
    need: r.need,
    issued: r.issued,
    fills: r.issues,
    difference: r.need == null ? null : r.issued - r.need,
    basis: r.basis,
    rate: r.rate,
    tracker: Boolean(r.vehicleId),
    down: isDown(r.status),
  })).sort((a, b) => a.site.localeCompare(b.site) || a.machine.localeCompare(b.machine, undefined, { numeric: true }));

  const cost = (litres) => (price > 0 ? litres * price : null);
  return {
    from: data?.from ?? null,
    to: data?.to ?? null,
    site,
    price: price > 0 ? price : null,
    totals: {
      ...totals,
      multiShiftDays,
      machineDays: perMachineDay.size,
      sites: siteMap.size,
      issuedShare: totals.need > 0 ? totals.issued / totals.need : null,
      issuedCost: cost(totals.issued),
      early: { machines: new Set(early.map((x) => x.machine)).size, fills: early.length, litres: sum(early, (x) => x.fill.litres) },
      overTank: { fills: overTankFills.length, litres: sum(overTankFills, (x) => x.over.over) },
      probeShort: { fills: probeShort.length, litres: sum(probeShort, (x) => x.shortL), cost: cost(sum(probeShort, (x) => x.shortL)) },
      flags: { fills: flagged.length, offPlanL },
      plannedNotFuelled: { machines: plannedNotFuelled.length, need: sum(plannedNotFuelled, (x) => x.need) },
      down: { machines: downOnPlan.length, issued: sum(downOnPlan, (x) => x.issued) },
    },
    cumulative,
    bySite,
    byType,
    exceptions: { early, overTank: overTankFills, probeShort, flagged, plannedNotFuelled, downOnPlan },
    byOperator,
    register,
  };
}

/** The last complete Monday–Sunday week before `today` (fleet days, YYYY-MM-DD). */
export function lastFullWeek(today) {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;            // Monday 0 … Sunday 6
  const monday = new Date(d.getTime() - (dow + 7) * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
