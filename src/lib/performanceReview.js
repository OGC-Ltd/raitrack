/**
 * Fuel performance review — what the server's figures SAY, in the shape of
 * the operator's Kasulu "Fuel Issuance – Performance Review" (2026-10-08).
 *
 * The server (GET …/fuel/performance-review) does the arithmetic: each unit's
 * median refill against its register standard, excess litres, groups, months
 * and record reliability. This file only reads that result into the
 * document's lists — units needing attention, benchmark performers, meters to
 * correct, groups whose standards cannot be trusted, and the actions — so the
 * screen, the PDF and the dashboard panel say the same thing.
 */

export const OVER = 1.10;

export const pct = (r) => (r == null ? "-" : `${Math.round(r * 100)}%`);

export function litres(n, { short = false } = {}) {
  if (n == null || !Number.isFinite(n)) return "-";
  if (short) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M L`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k L`;
  }
  return `${Math.round(n).toLocaleString("en-KE")} L`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (key) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

/**
 * Daily pace: the last month against the full months before it. A month is
 * full when at least 28 of its days are in the period; the first and last are
 * usually partial, and the latest pace is read off whatever days it has.
 */
export function pace(months = []) {
  const withFuel = months.filter((m) => m.litres > 0);
  if (withFuel.length < 2) return null;
  const latest = withFuel.at(-1);
  const base = withFuel.slice(0, -1).filter((m) => m.days >= 28);
  if (!base.length) return null;
  const typical = base.reduce((s, m) => s + m.perDay, 0) / base.length;
  return { latest, typicalPerDay: typical, change: typical ? latest.perDay / typical - 1 : null };
}

/** The low-ratio threshold under which a group's standard, not its machines, is wrong. */
const STANDARD_TOO_HIGH = 0.4;

export function readReview(review) {
  if (!review) return null;
  const units = review.units ?? [];
  const assessed = units.filter((u) => u.ratio != null);
  const byGroup = new Map();
  for (const u of units) byGroup.set(u.group, [...(byGroup.get(u.group) ?? []), u]);

  // Groups whose standards are set so high that every unit "beats" them —
  // judging those machines would praise them for nothing.
  const suspectGroups = review.groups
    .filter((g) => g.assessed >= 3 && g.ratio != null && g.ratio < STANDARD_TOO_HIGH)
    .map((g) => g.group);
  const suspect = new Set(suspectGroups);

  const attention = assessed
    .filter((u) => u.status === "over" && !suspect.has(u.group))
    .sort((a, b) => b.excessL - a.excessL || b.ratio - a.ratio);

  // Per group: the best performer and, when it is within standard, the
  // busiest — heavy use that is not waste.
  const benchmarks = [];
  for (const [group, us] of byGroup) {
    if (suspect.has(group)) continue;
    const ok = us.filter((u) => u.ratio != null && u.ratio <= 1).sort((a, b) => a.ratio - b.ratio);
    if (!ok.length) continue;
    const busiest = [...us].sort((a, b) => b.litres - a.litres)[0];
    const picks = [ok[0]];
    if (busiest && busiest.ratio != null && busiest.ratio <= 1 && busiest.id !== ok[0].id) picks.push(busiest);
    benchmarks.push({ group, units: picks, busiestId: busiest?.id ?? null });
  }
  benchmarks.sort((a, b) => sumLitres(byGroup.get(b.group)) - sumLitres(byGroup.get(a.group)));

  // Most refills logged against next to no hours or km — a tracker whose
  // hour meter or odometer is not reporting, not a machine burning fuel
  // standing still. Half, not less: excavators top up twice a day, so a
  // third of refills after little work is normal for them (Kasulu, 90 days:
  // 53 units at 30%, 9 at 50%, every one a silent meter).
  const meterFixes = units
    .filter((u) => u.refills >= 5 && u.nearZeroWork / Math.max(1, u.refills - 1) >= 0.5)
    .sort((a, b) => b.litres - a.litres);

  // Fuel that cannot be measured: units with no standard at all.
  const unmeasured = units.filter((u) => u.rate == null || u.basis == null);
  const unmeasuredL = unmeasured.reduce((s, u) => s + u.litres, 0);

  const recordsTotal = Object.values(review.records ?? {}).reduce((s, n) => s + n, 0);
  const reliableShare = recordsTotal ? ((review.records.near ?? 0) + (review.records.over ?? 0)) / recordsTotal : null;

  const p = pace(review.months);
  const topGroups = review.groups.slice(0, 5);
  const topShare = topGroups.reduce((s, g) => s + g.share, 0);
  const biggest = [...units].sort((a, b) => b.litres - a.litres)[0] ?? null;
  const worstGroup = [...review.groups].sort((a, b) => b.excessL - a.excessL)[0] ?? null;
  const covered = review.coveredDays ?? review.days;
  const excessPerMonth = covered ? (review.totals.excessL / covered) * 30 : 0;

  const actions = [];
  if (attention.length) {
    actions.push(`Inspect ${listRefs(attention.slice(0, 6))} for mechanical faults, leaks or excessive idling.`);
  }
  if (worstGroup && worstGroup.overCount >= 3) {
    actions.push(`Review ${singular(worstGroup.group).toLowerCase()} operations: idling at loading points, load limits and haul-road condition.`);
  }
  if (meterFixes.length) {
    actions.push(`Check the trackers' hour and km readings on ${listRefs(meterFixes.slice(0, 6))}: refills are logged against next to no work.`);
  }
  if (suspectGroups.length || unmeasured.length) {
    const parts = [];
    if (unmeasured.length) parts.push(`set standards for the ${unmeasured.length} unit${unmeasured.length === 1 ? "" : "s"} without one`);
    if (suspectGroups.length) parts.push(`reset the standards for ${suspectGroups.join(" and ")}`);
    actions.push(`${cap(parts.join(", and "))}.`);
  }

  return {
    attention, benchmarks, meterFixes, suspectGroups, unmeasured, unmeasuredL,
    reliableShare, recordsTotal, pace: p, topGroups, topShare, biggest, worstGroup,
    excessPerMonth, actions, byGroup,
  };
}

/** "Trucks" → "Truck", "Diesel generators" → "Diesel generator". */
export const singular = (group) => group.replace(/s$/, "");

const sumLitres = (us = []) => us.reduce((s, u) => s + u.litres, 0);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function listRefs(units) {
  const refs = units.map((u) => u.ref);
  return refs.length <= 1 ? refs.join("") : `${refs.slice(0, -1).join(", ")} and ${refs.at(-1)}`;
}

/** Bar colour band, as the document's exhibit legend. */
export function band(u) {
  if (u.ratio == null) return "none";
  if (u.ratio >= OVER) return "over";
  if (u.ratio > 1) return "slight";
  return "within";
}
