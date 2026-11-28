/**
 * Monthly Fleet Report: every figure on its five pages, from each report's own
 * rows, broken down by the groups on the map's Fleets filter (fleetType).
 *
 * Pure: no React, no network. The screen reads each report for the month with
 * its own loader and hands the results in; this sums them.
 *
 * Every unit counts once, in the group the map puts it in (fleetType of its
 * first tracker), so the groups always add up to the fleet.
 */

import { fleetType, fleetTypeOptions, fleetTypeLabel } from './vehicleMap';
import { scopeUnits, vehicleKeys, keyOf } from './fleetGroups';
import { dayStart, fleetDay, nightWindows, overspeedRows, OVERSPEED_MIN_SEC } from './fleetReports';
import { sectionOf } from './offlineReport';
import { templateFor } from './reportTemplates';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// ── The month ───────────────────────────────────────────────────────────────

/** Day shift, as the Shift report's Day preset (07:30–19:30). */
export const DAY_SHIFT = { start: 7.5, end: 19.5 };
/** A unit moved in the month when it covered this much (Vehicle utilization's own rule). */
export const MOVED_KM = 1;
/** A night counts as a night-driving trip from this distance (Night driving's own rule). */
export const NIGHT_MIN_KM = 0.5;
/** Rates per 1,000 km are left out below this distance: a few km make a meaningless rate. */
export const RATE_MIN_KM = 100;

/** "2026-10" → { key, from, to, end, days, label } in fleet time; `to` stops at now for the month in progress. */
export function monthPeriod(key, now = Date.now()) {
  const [y, m] = String(key).split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const from = dayStart(first);
  const end = dayStart(next);
  const days = Math.round((end - from) / DAY);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key: first.slice(0, 7), from, end, to: Math.min(end, now), days, label, complete: end <= now };
}

/** The month before "YYYY-MM". */
export function previousMonth(key) {
  const [y, m] = String(key).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The last complete month at `now`. */
export const lastCompleteMonth = (now = Date.now()) => previousMonth(fleetDay(now).slice(0, 7));

/** The month's weeks: 1–7, 8–14, 15–21 and 22 to the end (the last is longer). */
export function monthWeeks(period) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = i * 7 + 1;
    const b = i === 3 ? period.days : a + 6;
    out.push({ index: i, firstDay: a, lastDay: b, days: b - a + 1, label: `${a}–${b}`, from: period.from + (a - 1) * DAY, to: period.from + b * DAY });
  }
  return out;
}

/** Which week (0–3) a fleet day "YYYY-MM-DD" or a moment falls in. */
export function weekOf(dayOrMs) {
  const day = typeof dayOrMs === 'number' ? fleetDay(dayOrMs) : dayOrMs;
  return Math.min(3, Math.floor((Number(day.slice(8, 10)) - 1) / 7));
}

// ── Which blocks the organisation has ────────────────────────────────────────

/**
 * The blocks an organisation's report carries: the templated ones only where
 * it has that report (lib/reportTemplates), the rest as the Reports menu
 * offers them (lib/reportNav), so the report never shows a block its own
 * Reports page does not have.
 */
export function monthlyBlocks(orgCode, can) {
  const tel = can('telemetry:read');
  const t = (k) => tel && templateFor(k, orgCode) != null;
  return {
    tankers: t('tankers'), deliveries: t('deliveries'),
    tatFuel: t('tatFuel'), geofences: t('geofences'), recovery: t('recovery'), speedReport: t('speedReport'), probeReport: t('probeReport'),
    dormant: t('offline'),
    alarms: can('vss:alarms'), passengers: tel, fuelRate: tel,
    thefts: can('fuel_theft:read'), probes: can('sensor:read'),
  };
}

// ── Units and their groups ──────────────────────────────────────────────────

/**
 * The organisation's units, one per plate (lib/fleetGroups scopeUnits, every
 * unit), each with its map group, and the groups biggest first
 * (fleetTypeOptions over the units).
 */
export function monthUnits(vehicles) {
  const { units } = scopeUnits(vehicles ?? [], null);
  const out = units.map((u) => ({ ...u, kind: fleetType(u.vehicles[0]) }));
  const groups = fleetTypeOptions(out.map((u) => u.vehicles[0])).map((g) => ({ kind: g.kind, label: g.label }));
  return { units: out, groups };
}

/** A unit for an item naming its vehicle by id, else by plate. */
export function unitFinder(units) {
  const byId = new Map();
  const byKey = new Map();
  for (const u of units) {
    for (const v of u.vehicles) {
      if (v.vehicleId) byId.set(v.vehicleId, u);
      for (const k of vehicleKeys(v)) if (!byKey.has(k)) byKey.set(k, u);
    }
    if (!byKey.has(u.key)) byKey.set(u.key, u);
  }
  return (it) => byId.get(it?.vehicleId) ?? byKey.get(keyOf(it?.plate)) ?? byKey.get(keyOf(it?.name)) ?? null;
}

// ── Sums ────────────────────────────────────────────────────────────────────

const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
/** Breaches per 1,000 km, or null where the distance is too short to mean anything. */
export const per1000 = (breaches, km, minKm = RATE_MIN_KM) => (km >= minKm ? (breaches / km) * 1000 : null);

/** The unit's tracker with the most distance over the month: one tracker per unit, as Vehicle utilization picks it. */
function usageOf(u, usage) {
  let best = null;
  let bestKm = -1;
  for (const v of u.vehicles) {
    const r = usage?.get(v.vehicleId);
    if (!r) continue;
    const km = sum(Object.values(r.days ?? {}), (d) => d.km);
    if (km > bestKm) { best = r; bestKm = km; }
  }
  return best;
}

/** Each group's figure from per-unit values, in the group order, plus the fleet's. */
function byGroup(groups, units, value) {
  const rows = groups.map((g) => ({ kind: g.kind, label: g.label, value: 0 }));
  const at = new Map(rows.map((r) => [r.kind, r]));
  for (const u of units) at.get(u.kind).value += value(u) || 0;
  return rows;
}

// ── Per-unit figures ────────────────────────────────────────────────────────

/** Theft rows (GET /fuel/thefts) as the report counts them: confirmed, suspected or another drain; null = not a loss. */
export function drainKind(t) {
  if (t?.reviewStatus === 'CONFIRMED_THEFT') return 'confirmed';
  if (t?.reviewStatus === 'NOT_THEFT' || t?.reviewStatus === 'PROBE_FAULT') return null;
  if (t?.verdict !== 'DRAIN') return null;
  return t.drainCause === 'SIPHON' ? 'suspected' : 'drain';
}
export const drainLitres = (t) => (Number(t?.cleanDropMl ?? t?.stolenMl) || 0) / 1000;

/** Overspeed episodes over OVERSPEED_MIN_SEC, per unit, by week: overspeedRows per week. */
function overspeedByWeek(units, byVehicle, weeks) {
  return weeks.map((w) => {
    const part = new Map();
    for (const [id, list] of byVehicle ?? []) {
      part.set(id, (list ?? []).filter((e) => { const t = Date.parse(e.startedAt); return t >= w.from && t < w.to; }));
    }
    return new Map(overspeedRows(units, part, OVERSPEED_MIN_SEC).map((r) => [r.unit.key, r.count]));
  });
}

/**
 * Every unit's month: its distance, use, night trips, breaches and fuel,
 * overall and by week. The rows of each report are matched to units here once.
 */
export function unitFigures(period, units, input) {
  const weeks = monthWeeks(period);
  const find = unitFinder(units);
  const nightSpans = nightWindows(period.from, period.to);

  const overRows = new Map(overspeedRows(units, input.overspeeds ?? new Map(), OVERSPEED_MIN_SEC).map((r) => [r.unit.key, r]));
  const overWeeks = overspeedByWeek(units, input.overspeeds, weeks);
  const conduct = new Map((input.conduct ?? []).map((r) => [r.unit.key, r]));
  const passengers = new Map();
  for (const r of input.passengers ?? []) {
    const u = find(r);
    if (u) passengers.set(u.key, (passengers.get(u.key) ?? 0) + (Number(r.total ?? r.count ?? 1) || 0));
  }
  const rates = new Map();
  for (const r of input.fuelRate ?? []) { const u = find(r); if (u && !rates.has(u.key)) rates.set(u.key, r); }
  const drains = new Map();
  for (const t of input.thefts ?? []) {
    const kind = drainKind(t);
    const at = Date.parse(t.beganAt);
    if (!kind || !(at >= period.from && at < period.to)) continue;
    const u = find({ vehicleId: t.vehicleId, plate: t.vehicle?.registrationPlate ?? t.vehicle?.name });
    if (!u) continue;
    if (!drains.has(u.key)) drains.set(u.key, []);
    drains.get(u.key).push({ kind, litres: drainLitres(t), week: weekOf(at), at });
  }
  const alarms = new Map();
  for (const r of input.alarms ?? []) { const u = find(r); if (u) alarms.set(u.key, r); }
  const probes = new Map();
  for (const r of input.probes ?? []) { const u = find(r); if (u && r.fuelSensor?.fitted) probes.set(u.key, r); }

  return units.map((u) => {
    const use = usageOf(u, input.usage);
    const days = Object.entries(use?.days ?? {}).filter(([d]) => dayStart(d) >= period.from && dayStart(d) < period.to);
    const km = sum(days, ([, d]) => d.km);
    const wk = (f) => weeks.map((w) => sum(days.filter(([d]) => weekOf(d) === w.index), ([, d]) => f(d)));
    const nights = (use?.nights ?? []).filter((n) => nightSpans.some(([a]) => a === n.from));
    const trips = nights.filter((n) => n.km >= NIGHT_MIN_KM);
    const nightKm = sum(nights, (n) => n.km);
    const nightUnit = nightKm >= NIGHT_MIN_KM;
    const nightWeek = weeks.map((w) => trips.filter((n) => weekOf(n.from) === w.index).length);
    const c = conduct.get(u.key);
    const harshWeek = weeks.map((w) => sum(Object.entries(c?.days ?? {}).filter(([d]) => weekOf(d) === w.index), ([, x]) => x.harsh));
    const camWeek = weeks.map((w) => sum(Object.entries(c?.days ?? {}).filter(([d]) => weekOf(d) === w.index), ([, x]) => x.dashcam));
    const o = overRows.get(u.key);
    const overWeek = overWeeks.map((m) => m.get(u.key) ?? 0);
    const harsh = (c?.accel ?? 0) + (c?.brake ?? 0) + (c?.corner ?? 0);
    const dashcam = (c?.seatbelt ?? 0) + (c?.phone ?? 0) + (c?.covered ?? 0);
    const night = nightUnit ? trips.length : 0;
    const pass = passengers.get(u.key) ?? 0;
    const lastAt = days.reduce((m, [, d]) => (Number.isFinite(d.lastAt) && d.lastAt > m ? d.lastAt : m), -Infinity);
    const lastWeek = weeks[3];
    const fuelReadLast = sum(days.filter(([d]) => weekOf(d) === lastWeek.index), ([, d]) => d.fuelReadings);
    const probe = probes.get(u.key);
    const myDrains = drains.get(u.key) ?? [];
    const litres = (k, w = null) => sum(myDrains.filter((x) => x.kind === k && (w == null || x.week === w)), (x) => x.litres);
    return {
      unit: u, kind: u.kind,
      readings: sum(days, ([, d]) => d.readings),
      km, kmWeek: wk((d) => d.km), kmDays: Object.fromEntries(days.map(([d, x]) => [d, x.km || 0])),
      movedDays: days.filter(([, d]) => d.km >= MOVED_KM).length,
      moved: km >= MOVED_KM,
      movingMin: sum(days, ([, d]) => d.movingMin), idleMin: sum(days, ([, d]) => d.idleMin), engineOnMin: sum(days, ([, d]) => d.engineOnMin),
      dayShiftKm: sum(days, ([, d]) => d.dayShiftKm), nightShiftKm: Math.max(0, km - sum(days, ([, d]) => d.dayShiftKm)),
      reportingWeek: weeks.map((w) => days.some(([d, x]) => weekOf(d) === w.index && x.readings > 0)),
      fuelWeek: weeks.map((w) => days.some(([d, x]) => weekOf(d) === w.index && x.fuelReadings > 0)),
      lastAt: Number.isFinite(lastAt) ? lastAt : null,
      overspeed: o?.count ?? 0, overSeconds: o?.seconds ?? 0, overWeek,
      accel: c?.accel ?? 0, brake: c?.brake ?? 0, corner: c?.corner ?? 0,
      seatbelt: c?.seatbelt ?? 0, phone: c?.phone ?? 0, covered: c?.covered ?? 0,
      harsh, dashcam, harshWeek, camWeek,
      night, nightKm: nightUnit ? nightKm : 0, nightWeek: nightUnit ? nightWeek : [0, 0, 0, 0],
      passengers: pass,
      breaches: (o?.count ?? 0) + harsh + dashcam + night + pass,
      breachWeek: weeks.map((w, i) => overWeek[i] + harshWeek[i] + camWeek[i] + (nightUnit ? nightWeek[i] : 0)),
      rate: rates.get(u.key) ?? null,
      confirmedL: litres('confirmed'), suspectedL: litres('suspected'), drainL: litres('drain'),
      confirmedWeek: weeks.map((w) => litres('confirmed', w.index)), suspectedWeek: weeks.map((w) => litres('suspected', w.index)),
      confirmedCount: myDrains.filter((x) => x.kind === 'confirmed').length,
      alarms: alarms.get(u.key) ?? null,
      probe: probe ? (probe.fuelSensor.uncalibrated ? 'uncalibrated' : fuelReadLast > 0 ? 'working' : 'notReporting') : null,
    };
  });
}

// ── The report ──────────────────────────────────────────────────────────────

/** The kinds the Alarm Distribution report counts (its Other is left out). */
export const ALARM_KINDS = [
  { key: 'fatigue', label: 'Fatigue Driving' }, { key: 'phone', label: 'Phone Call' }, { key: 'smoking', label: 'Smoking' },
  { key: 'covered', label: 'Camera Covered' }, { key: 'distracted', label: 'Distracted Driving' }, { key: 'seatbelt', label: 'No Seat Belt' },
];

/** How far below its target a unit's km/L is, in bands (navy tints light to dark). */
export const BELOW_BANDS = [
  { key: 'b5', label: '0–5%', max: 0.05 }, { key: 'b10', label: '5–10%', max: 0.10 },
  { key: 'b20', label: '10–20%', max: 0.20 }, { key: 'over', label: 'Over 20%', max: Infinity },
];
export function belowBand(r) {
  if (!r?.target?.kmPerL || r.kmPerL == null || !(r.kmPerL < r.target.kmPerL)) return null;
  const short = (r.target.kmPerL - r.kmPerL) / r.target.kmPerL;
  return BELOW_BANDS.find((b) => short <= b.max)?.key ?? 'over';
}
/** A Fuel Consumption Rate row with a measured rate (lib/fuelTargets totalsOf's rule). */
const measured = (r) => r && r.consumedL != null && r.consumedL > 0 && r.distanceKm >= 1;

/**
 * Every figure on the five pages.
 *
 * @param {object} o
 * @param {string} o.month  "YYYY-MM"
 * @param {object[]} o.vehicles  the organisation's live units (map shape)
 * @param {object} o.blocks  which blocks the organisation has: { [key]: true }
 * @param {Map} o.usage  vehicleId → { days: { day: { km, movingMin, idleMin, engineOnMin, readings, fuelReadings, dayShiftKm, lastAt } }, nights: [{ from, km }] }
 * @param {Map} o.overspeeds  vehicleId → speeding incidents (loadOverspeeds byVehicle)
 * @param {object[]} o.conduct  behaviourRows over the month
 * @param {object[]} [o.passengers]  Unauthorised Passengers rows, where the organisation has it
 * @param {object[]} o.fuelRate  Fuel Consumption Rate rows, with withTypeTargets
 * @param {object[]} o.thefts  GET /fuel/thefts rows for the month
 * @param {object[]|null} o.alarms  Alarm Distribution rows, or null where it cannot be read
 * @param {object[]} o.probes  probe-health rows (what each unit has fitted, as it stands now)
 * @param {object[]} [o.ops]  the organisation's two operations cards: [{ key, label, value, icon, sub }]
 * @param {object|null} o.previous  the previous month's report, or null (first month)
 */
export function buildMonthlyReport(o) {
  const period = monthPeriod(o.month, o.now);
  const weeks = monthWeeks(period);
  const { units, groups } = monthUnits(o.vehicles);
  const rows = unitFigures(period, units, o);
  const g = (f) => byGroup(groups, rows, f);
  const total = (f) => sum(rows, f);

  // Policy breaches, by group, with the distance they are rated on
  const km = total((r) => r.km);
  const breaches = total((r) => r.breaches);
  const groupTable = groups.map((grp) => {
    const mine = rows.filter((r) => r.kind === grp.kind);
    const t = (f) => sum(mine, f);
    const b = t((r) => r.breaches);
    const k = t((r) => r.km);
    return {
      kind: grp.kind, label: grp.label, units: mine.length, moved: mine.filter((r) => r.moved).length, km: k,
      overspeed: t((r) => r.overspeed), harsh: t((r) => r.harsh), night: t((r) => r.night), dashcam: t((r) => r.dashcam),
      passengers: t((r) => r.passengers), breaches: b, per1000: per1000(b, k),
    };
  });
  const allGroups = {
    kind: null, label: 'All groups', units: rows.length, moved: rows.filter((r) => r.moved).length, km,
    overspeed: total((r) => r.overspeed), harsh: total((r) => r.harsh), night: total((r) => r.night), dashcam: total((r) => r.dashcam),
    passengers: total((r) => r.passengers), breaches, per1000: per1000(breaches, km),
  };

  const weekly = weeks.map((w, i) => {
    const b = total((r) => r.breachWeek[i]);
    const k = total((r) => r.kmWeek[i]);
    return {
      ...w, breaches: b, km: k, per1000: per1000(b, k),
      overspeed: total((r) => r.overWeek[i]), night: total((r) => r.nightWeek[i]),
      confirmedL: total((r) => r.confirmedWeek[i]), suspectedL: total((r) => r.suspectedWeek[i]),
      reporting: rows.length ? rows.filter((r) => r.reportingWeek[i]).length / rows.length : null,
    };
  });

  // Movements and utilisation
  const dayKeys = [];
  for (let d = period.from; d < period.to; d += DAY) dayKeys.push(fleetDay(d));
  const kmByDay = dayKeys.map((d) => ({ day: d, km: total((r) => r.kmDays[d]) }));
  const busiest = kmByDay.reduce((m, x) => (!m || x.km > m.km ? x : m), null);
  const movedRows = rows.filter((r) => r.moved);
  const noData = rows.filter((r) => !r.readings).length;
  const engineOn = total((r) => r.engineOnMin);
  const unitDays = total((r) => r.movedDays);

  // Fuel
  const rated = rows.filter((r) => measured(r.rate));
  const fuelGroups = groups.map((grp) => {
    const mine = rated.filter((r) => r.kind === grp.kind);
    const dist = sum(mine, (r) => r.rate.distanceKm);
    const used = sum(mine, (r) => r.rate.consumedL);
    const withTarget = mine.filter((r) => r.rate.target?.kmPerL);
    // The group's target: the litres its units' own targets allow over the same distance
    const allowed = sum(withTarget, (r) => r.rate.distanceKm / r.rate.target.kmPerL);
    const targetDist = sum(withTarget, (r) => r.rate.distanceKm);
    return {
      kind: grp.kind, label: grp.label, units: mine.length, distanceKm: dist, usedL: used,
      kmPerL: used > 0 ? dist / used : null,
      target: allowed > 0 ? targetDist / allowed : null,
      below: mine.filter((r) => r.rate.belowTarget === true).length,
    };
  }).filter((x) => x.units > 0);
  const lost = {
    confirmedL: total((r) => r.confirmedL), suspectedL: total((r) => r.suspectedL), drainL: total((r) => r.drainL),
    byGroup: groups.map((grp) => {
      const mine = rows.filter((r) => r.kind === grp.kind);
      return { kind: grp.kind, label: grp.label, confirmedL: sum(mine, (r) => r.confirmedL), suspectedL: sum(mine, (r) => r.suspectedL), drainL: sum(mine, (r) => r.drainL) };
    }),
  };
  lost.totalL = lost.confirmedL + lost.suspectedL + lost.drainL;
  const theftUnits = rows.filter((r) => r.confirmedL > 0)
    .map((r) => ({ plate: r.unit.plate, group: fleetTypeLabel(r.kind), kind: r.kind, litres: r.confirmedL, count: r.confirmedCount }))
    .sort((a, b) => b.litres - a.litres);
  const probeRows = rows.filter((r) => r.probe);
  const probes = {
    fitted: probeRows.length,
    working: probeRows.filter((r) => r.probe === 'working').length,
    notReporting: probeRows.filter((r) => r.probe === 'notReporting').length,
    uncalibrated: probeRows.filter((r) => r.probe === 'uncalibrated').length,
  };
  const calibrated = probeRows.filter((r) => r.probe !== 'uncalibrated');
  weekly.forEach((w, i) => { w.probesWorking = calibrated.length ? calibrated.filter((r) => r.fuelWeek[i]).length / calibrated.length : null; });
  const bands = Object.fromEntries(BELOW_BANDS.map((b) => [b.key, 0]));
  for (const r of rated) { const k = belowBand(r.rate); if (k) bands[k] += 1; }

  // Dormant at the month's end: the Dormant Assets sections, as at the last moment of the month
  const asAt = period.to - 1;
  const dormantRows = rows.map((r) => ({ r, section: r.lastAt == null ? 'over' : sectionOf(r.lastAt, asAt) }))
    .filter((x) => x.section);
  const dormantSet = new Set(dormantRows.map((x) => x.r));
  const dormant = {
    asAt, total: dormantRows.length,
    byGroup: g((r) => (dormantSet.has(r) ? 1 : 0)),
    top: dormantRows.map(({ r }) => ({ plate: r.unit.plate, group: fleetTypeLabel(r.kind), lastAt: r.lastAt }))
      .sort((a, b) => (a.lastAt ?? -Infinity) - (b.lastAt ?? -Infinity)).slice(0, 5),
  };

  const alarmRows = rows.filter((r) => r.alarms);
  const alarms = o.alarms == null ? null : {
    byKind: ALARM_KINDS.map((k) => ({ ...k, value: sum(alarmRows, (r) => r.alarms[k.key]) })),
    byGroup: g((r) => (r.alarms ? ALARM_KINDS.reduce((s, k) => s + (Number(r.alarms[k.key]) || 0), 0) : 0)),
  };
  if (alarms) alarms.total = sum(alarms.byKind, (k) => k.value);

  const overUnits = rows.filter((r) => r.overspeed > 0);
  const nightUnits = rows.filter((r) => r.night > 0);
  const report = {
    period, weeks, groups, units: rows.length,
    first: !o.previous || o.previous.empty,
    empty: !rows.some((r) => r.readings > 0),
    blocks: o.blocks ?? {},
    cards: {
      units: rows.length, moved: movedRows.length,
      km, kmPerUnitDay: unitDays ? km / unitDays : null,
      breaches, per1000: per1000(breaches, km),
      ops: o.ops ?? [],
    },
    breachesByGroup: g((r) => r.breaches),
    rateByGroup: groupTable.map((x) => ({ kind: x.kind, label: x.label, value: x.per1000 })),
    groupTable, allGroups, weekly,
    overspeed: {
      events: allGroups.overspeed, units: overUnits.length, hours: total((r) => r.overSeconds) / 3600,
      byGroup: g((r) => r.overspeed),
      top: overUnits.sort((a, b) => b.overspeed - a.overspeed || b.overSeconds - a.overSeconds).slice(0, 5)
        .map((r) => ({ plate: r.unit.plate, group: fleetTypeLabel(r.kind), events: r.overspeed, hours: r.overSeconds / 3600 })),
    },
    night: { trips: allGroups.night, units: nightUnits.length, km: total((r) => r.nightKm), byGroup: g((r) => r.night) },
    conduct: {
      byType: [
        { key: 'accel', label: 'Harsh acceleration', value: total((r) => r.accel) },
        { key: 'brake', label: 'Harsh braking', value: total((r) => r.brake) },
        { key: 'corner', label: 'Harsh cornering', value: total((r) => r.corner) },
        { key: 'seatbelt', label: 'No seatbelt', value: total((r) => r.seatbelt) },
        { key: 'phone', label: 'On phone', value: total((r) => r.phone) },
        { key: 'covered', label: 'Camera covered', value: total((r) => r.covered) },
      ],
      dashcamByGroup: g((r) => r.dashcam),
    },
    movements: { moved: movedRows.length, km, busiest, kmByDay, kmByGroup: g((r) => r.km) },
    utilisation: {
      moved: movedRows.length, notMoved: rows.length - movedRows.length - noData, noData,
      movedShare: groupTable.map((x) => ({ kind: x.kind, label: x.label, value: x.units ? x.moved / x.units : 0 })),
      idleShare: engineOn > 0 ? total((r) => r.idleMin) / engineOn : null,
    },
    shift: {
      dayKm: total((r) => r.dayShiftKm), nightKm: total((r) => r.nightShiftKm),
      byGroup: groups.map((grp) => {
        const mine = rows.filter((r) => r.kind === grp.kind);
        return { kind: grp.kind, label: grp.label, dayKm: sum(mine, (r) => r.dayShiftKm), nightKm: sum(mine, (r) => r.nightShiftKm) };
      }),
    },
    fuel: {
      groups: fuelGroups, rated: rated.length,
      below: rated.filter((r) => r.rate.belowTarget === true).length, bands,
      usedL: sum(rated, (r) => r.rate.consumedL),
      lost, theftUnits, probes,
    },
    dormant, alarms,
  };
  report.dataAvailability = weekly.map((w) => ({ label: w.label, reporting: w.reporting, probesWorking: w.probesWorking }));
  report.variance = o.previous && !o.previous.empty ? variance(report, o.previous) : null;
  report.summary = summaryPoints(report);
  report.attention = attentionPoints(report, rows);
  return report;
}

// ── Previous month ──────────────────────────────────────────────────────────

/** Higher is better for these figures; lower for the rest (breaches, rates, fuel lost). */
const HIGHER_IS_BETTER = new Set(['units', 'moved', 'km', 'kmPerUnitDay']);

/** One figure against last month: { now, before, change, good } (good: favourable, null when unchanged). */
export function against(key, now, before) {
  if (now == null || before == null) return { now, before, change: null, good: null };
  const change = now - before;
  if (Math.abs(change) < 1e-9) return { now, before, change: 0, good: null };
  return { now, before, change, good: HIGHER_IS_BETTER.has(key) ? change > 0 : change < 0 };
}

function variance(now, before) {
  const card = (k) => against(k, now.cards[k], before.cards[k]);
  const ops = Object.fromEntries((now.cards.ops ?? []).map((c) => [c.key, against('ops', c.value, (before.cards.ops ?? []).find((x) => x.key === c.key)?.value ?? null)]));
  // An operations card counts things done (trips, deliveries): more is better
  for (const v of Object.values(ops)) if (v.change) v.good = v.change > 0;
  const groupRow = (x) => {
    const b = x.kind == null ? before.allGroups : before.groupTable.find((y) => y.kind === x.kind);
    return { breaches: against('breaches', x.breaches, b?.breaches ?? null), per1000: against('per1000', x.per1000, b?.per1000 ?? null), km: against('km', x.km, b?.km ?? null) };
  };
  return {
    cards: { units: card('units'), moved: card('moved'), km: card('km'), kmPerUnitDay: card('kmPerUnitDay'), breaches: card('breaches'), per1000: card('per1000'), ops },
    groups: Object.fromEntries(now.groupTable.map((x) => [x.kind, groupRow(x)])),
    all: groupRow(now.allGroups),
  };
}

// ── Summary and attention points, from rules ────────────────────────────────

const n0 = (x) => Math.round(x).toLocaleString('en-GB');
const n2 = (x) => x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x) => `${Math.round(x * 100)}%`;
const andList = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** The three summary points. */
export function summaryPoints(rep) {
  const out = [];
  const total = rep.allGroups.breaches;
  if (total > 0) {
    const top = [...rep.groupTable].filter((x) => x.breaches > 0).sort((a, b) => b.breaches - a.breaches).slice(0, 2);
    const share = top.reduce((s, x) => s + x.breaches, 0) / total;
    const worst = [...rep.groupTable].filter((x) => x.per1000 != null).sort((a, b) => b.per1000 - a.per1000)[0];
    out.push(`${andList(top.map((x) => x.label))} account for ${pct(share)} of the ${n0(total)} policy breaches`
      + (worst ? `; ${worst.label} has the highest rate at ${n2(worst.per1000)} per 1,000 km.` : '.'));
  } else out.push('No policy breaches were recorded this month.');

  const rated = rep.weekly.filter((w) => w.per1000 != null);
  if (rated.length >= 2) {
    const a = rated[0];
    const b = rated[rated.length - 1];
    const dir = b.per1000 > a.per1000 * 1.05 ? 'rose' : b.per1000 < a.per1000 * 0.95 ? 'fell' : 'held steady';
    out.push(`The breach rate ${dir} from ${n2(a.per1000)} per 1,000 km in days ${a.label} to ${n2(b.per1000)} in days ${b.label}.`);
  } else out.push('Too little distance was recorded to compare the weeks.');

  const below = rep.fuel.groups.filter((x) => x.kmPerL != null && x.target != null && x.kmPerL < x.target).map((x) => x.label);
  const lossOf = (x) => x.confirmedL + x.suspectedL + x.drainL;
  const most = [...rep.fuel.lost.byGroup].sort((a, b) => lossOf(b) - lossOf(a))[0];
  const parts = [below.length ? `${andList(below)} ${below.length === 1 ? 'is' : 'are'} below fuel target` : 'Every group is at or above its fuel target'];
  if (most && lossOf(most) > 0) parts.push(`${most.label} lost the most fuel to drains (${n0(lossOf(most))} L)`);
  out.push(`${parts.join('; ')}.`);
  return out;
}

/** The three points for management attention. */
export function attentionPoints(rep, rows) {
  const out = [];
  const theft = new Map();
  for (const u of rep.fuel.theftUnits) {
    const t = theft.get(u.kind) ?? { label: u.group, litres: 0, units: 0 };
    t.litres += u.litres; t.units += 1;
    theft.set(u.kind, t);
  }
  const t = [...theft.values()].sort((a, b) => b.litres - a.litres)[0];
  out.push(t ? `${t.label}: ${n0(t.litres)} L of confirmed theft on ${t.units} unit${t.units === 1 ? '' : 's'}.` : 'No confirmed theft this month.');

  const worst = [...rep.groupTable].filter((x) => x.per1000 != null).sort((a, b) => b.per1000 - a.per1000)[0];
  out.push(worst ? `${worst.label}: the highest breach rate, ${n2(worst.per1000)} per 1,000 km (${n0(worst.breaches)} breaches).` : 'No group covered enough distance to rate its breaches.');

  const dormantKeys = new Set(rows.filter((r) => r.lastAt == null || sectionOf(r.lastAt, rep.dormant.asAt)).map((r) => r.unit.key));
  const idle = rep.groups.map((grp) => {
    const mine = rows.filter((r) => r.kind === grp.kind);
    return { label: grp.label, n: mine.filter((r) => !r.moved || dormantKeys.has(r.unit.key)).length, of: mine.length };
  }).sort((a, b) => b.n - a.n)[0];
  out.push(idle && idle.n > 0 ? `${idle.label}: ${idle.n} of ${idle.of} units did not move or have dormant trackers.` : 'Every unit moved and reported this month.');
  return out;
}

// ── Reading a unit's day ────────────────────────────────────────────────────

/** The day-shift window of a fleet day. */
export const dayShiftOf = (day) => [dayStart(day) + DAY_SHIFT.start * HOUR, dayStart(day) + DAY_SHIFT.end * HOUR];
