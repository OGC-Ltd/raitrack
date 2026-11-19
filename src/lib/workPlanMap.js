// FactorySuite work plans on the Live Map (operator, 2026-11-14: "a toggle
// just like that for geofence that we can plot the plans and render them on
// the map in realtime"). Pure: the server's plans, the live units and the
// org's fences in; what to draw out.
//
// Each planned machine is judged against where it is NOW, frame by frame:
//   here      inside the work location its plan names
//   away      on shift and reporting, but somewhere else
//   offshift  somewhere else outside its shift hours (before or after), which
//             is not a problem: at 03:00 the whole plan is "elsewhere"
//   silent    not reporting (offline, or never placed)
//   unplaced  its work location has no shape, so nothing to judge against
//
// A location's shape is its geofence (matched by the server), else the area of
// the same name in Kasulu's estate drawing (operator, 2026-11-14: "use the
// drawing"), which holds ground no fence does, such as Commercial area (1600).
// A machine with two shifts is one unit on the map; the shift on now (else the
// next one, else the last) decides which location it is judged against.

import { fenceContains } from "./zoneContainment";

// The app's status tokens (index.css --accent-ok / -warn / -info / -off), so
// white tag text clears 4.5:1 on every tone; WorkPlansOnMap.css mirrors them.
export const WP_TONE = { here: "#15803d", away: "#b45309", pending: "#be185d", offshift: "#0369a1", silent: "#4b5563", unplaced: "#64748b" };
export const WP_LABEL = { here: "At its work location", away: "Elsewhere on shift", pending: "Pending approval", offshift: "Off shift", silent: "Not reporting", unplaced: "Location not on the map" };
/** The order the card and the map's key list them in. */
export const WP_ORDER = ["here", "away", "pending", "offshift", "silent", "unplaced"];
export const WP_PLACE_COLOR = "#7c3aed";

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/** The drawing's classes that are places a machine works in; its roads,
 *  rivers, mains and 507 planted blocks are not plan locations. */
const DRAWING_AREAS = new Set(["zone", "headcontrol", "nursery", "factory", "reservoir", "rainfed"]);
/** A zone stands before a head-control block of the same name, then the larger. */
const DRAWING_RANK = { zone: 0 };

/** Lower case, letters and digits only; the server's fold (work-plan-match.ts). */
const fold = (s) => String(s ?? "").toLowerCase()
  .replace(/centre/g, "center").replace(/resevoir/g, "reservoir").replace(/[^a-z0-9]/g, "");

/** The estate drawing's area polygons, from its FeatureCollection. */
export function drawingAreas(fc) {
  return (fc?.features ?? []).filter((f) => DRAWING_AREAS.has(f.properties?.c) && f.geometry?.type === "Polygon");
}

/**
 * The estate drawing's area for a plan's work location, or null.
 *  - By name: "Commercial Area (1600)" is the drawing's "Commercial area (1600)",
 *    its zone rather than the head-control block that shares the name.
 *  - "Zone (424 ha)": most of the drawing's zones are an unnamed "Zone", so a
 *    plan that names one by its size takes the one zone within 1 ha of it
 *    (operator, 2026-11-14: the 423.9 ha zone is Zone (424 ha)). Two such
 *    zones and it is left unmatched rather than guessed.
 */
export function drawingAreaFor(name, areas) {
  const full = fold(name);
  if (!full || !areas?.length) return null;
  const named = areas.filter((f) => fold(f.properties.n) === full);
  if (named.length) {
    return named.sort((a, b) => (DRAWING_RANK[a.properties.c] ?? 1) - (DRAWING_RANK[b.properties.c] ?? 1)
      || (b.properties.a ?? 0) - (a.properties.a ?? 0))[0];
  }
  const m = /^\s*zone\s*\(\s*(\d+(?:\.\d+)?)\s*ha\s*\)\s*$/i.exec(String(name));
  if (m) {
    const ha = Number(m[1]);
    const hits = areas.filter((f) => f.properties.c === "zone" && fold(f.properties.n) === "zone"
      && Math.abs((f.properties.a ?? NaN) - ha) <= 1);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** The line that decides where a machine should be at `now`. */
export function lineNow(lines, now) {
  const on = lines.find((l) => ms(l.shiftFrom) <= now && now < ms(l.shiftTo));
  if (on) return { line: on, onShift: true };
  const next = lines
    .filter((l) => ms(l.shiftFrom) > now)
    .sort((a, b) => ms(a.shiftFrom) - ms(b.shiftFrom))[0];
  if (next) return { line: next, onShift: false };
  const last = [...lines].sort((a, b) => (ms(b.shiftTo) || 0) - (ms(a.shiftTo) || 0))[0];
  return { line: last ?? lines[0], onShift: false };
}

/** "06:00–16:00" in East Africa time, from the line's shift. */
export function shiftText(line) {
  const f = ms(line.shiftFrom);
  const t = ms(line.shiftTo);
  if (!Number.isFinite(f)) return line.shiftStart?.slice(0, 5) ?? "";
  const hm = (x) => new Date(x + 3 * 3_600_000).toISOString().slice(11, 16);
  return Number.isFinite(t) ? `${hm(f)}–${hm(t)}` : hm(f);
}

/**
 * @param data      the server's work plans ({ plans, locations, unplacedMachines }) or null
 * @param vehicles  the map's live vehicles (vehicleId, id, lat, lng, online)
 * @param features  the org's geofence features (properties.id)
 * @param now       ms
 * @param drawing   the estate drawing's areas (drawingAreas), for locations
 *                  with no geofence; empty where the org has no drawing
 */
export function workPlanView(data, vehicles, features, now = Date.now(), drawing = []) {
  if (!data?.plans) return null;
  const fenceById = new Map((features ?? []).map((f) => [f.properties?.id, f]));
  // A location's shape: its geofence, else its area in the drawing
  const drawnByName = new Map();
  const shapeOf = (fenceId, location) => {
    if (fenceId && fenceById.has(fenceId)) return { id: fenceId, feature: fenceById.get(fenceId), drawn: false };
    if (!drawnByName.has(location)) {
      const area = drawingAreaFor(location, drawing);
      drawnByName.set(location, area ? { id: `drawing:${fold(location)}`, feature: area, drawn: true } : null);
    }
    return drawnByName.get(location);
  };
  const liveById = new Map((vehicles ?? []).filter((v) => v.vehicleId).map((v) => [v.vehicleId, v]));

  // Every line, carrying its plan's department and status
  const lines = data.plans.flatMap((p) => p.lines.map((l) => ({ ...l, department: p.department, planCode: p.planCode, planStatus: p.status })));

  // One entry per machine
  const byMachine = new Map();
  for (const l of lines) {
    const key = l.vehicleId ?? `m:${l.machine}`;
    if (!byMachine.has(key)) byMachine.set(key, []);
    byMachine.get(key).push(l);
  }

  const units = [...byMachine.entries()].map(([key, ls]) => {
    const { line, onShift } = lineNow(ls, now);
    const live = line.vehicleId ? liveById.get(line.vehicleId) : null;
    const shape = shapeOf(line.fenceId, line.workLocation);
    const fence = shape?.feature ?? null;
    const pos = live && Number.isFinite(live.lat) && Number.isFinite(live.lng) ? { lat: live.lat, lng: live.lng } : null;
    let tone;
    if (!pos || !live.online) tone = "silent";
    else if (!fence) tone = "unplaced";
    else tone = fenceContains(pos, fence) ? "here" : onShift ? "away" : "offshift";
    // A machine on a plan nobody has approved yet is awaiting approval,
    // wherever it is (operator 2026-11-14: "a draft is a unit awaiting
    // approval"); where it stands is judged once its plan is approved.
    if (planStage(line.planStatus) === "PENDING") tone = "pending";
    return {
      key, machine: line.machine, machineName: line.machineName, vehicleId: line.vehicleId ?? null,
      plate: line.plate ?? null, position: pos, online: Boolean(live?.online), tone, onShift,
      line, lines: ls, fenceId: shape?.id ?? null,
    };
  }).sort(byDepartmentThenHere);

  // Each placed work location with how many of its machines are on it
  const places = new Map();
  for (const loc of data.locations ?? []) {
    const shape = shapeOf(loc.fenceId, loc.name);
    if (!shape || places.has(shape.id)) continue;
    places.set(shape.id, { fenceId: shape.id, name: loc.name, feature: shape.feature, drawn: shape.drawn, planned: 0, here: 0 });
  }
  for (const u of units) {
    const p = u.fenceId && places.get(u.fenceId);
    if (!p) continue;
    p.planned += 1;
    if (u.tone === "here") p.here += 1;
  }

  const plans = data.plans.map((p) => ({ planCode: p.planCode, department: p.department, status: planStage(p.status) }));
  // Departments count plan lines, as FactorySuite counts them (operator
  // 2026-11-19: FactorySuite "96 approved", we read 80 machines; a machine on
  // the day and the night shift is two lines), with their machines beside.
  const depts = new Map();
  for (const l of lines) {
    const d = depts.get(l.department) ?? depts.set(l.department, { name: l.department, lines: 0, pending: 0, machines: new Set() }).get(l.department);
    d.lines += 1;
    if (planStage(l.planStatus) === "PENDING") d.pending += 1;
    d.machines.add(l.vehicleId ?? `m:${l.machine}`);
  }
  return {
    day: data.day,
    units,
    lines,
    places: [...places.values()].filter((p) => p.planned > 0),
    ...tally(units, plans, lines),
    plans,
    departments: [...depts.values()]
      .map((d) => ({ name: d.name, lines: d.lines, pending: d.pending, units: d.machines.size }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unplacedLocations: (data.locations ?? []).filter((l) => !shapeOf(l.fenceId, l.name)).map((l) => l.name),
    noGps: data.unplacedMachines ?? [],
  };
}

/**
 * A plan's stage in one word. A draft and a submitted plan both wait for
 * approval, so both read "PENDING"; anything else keeps FactorySuite's word.
 */
const PENDING_STATUSES = new Set(["DRAFT", "SUBMITTED", "PENDING", "PENDING_APPROVAL", "AWAITING_APPROVAL"]);
export function planStage(status) {
  const s = String(status ?? "").toUpperCase();
  return !s || PENDING_STATUSES.has(s) ? "PENDING" : s;
}

/**
 * Machines by department A to Z; inside one, those at their work location
 * first, then the rest, each part by machine code A to Z (numbers in order).
 */
export function byDepartmentThenHere(a, b) {
  return a.line.department.localeCompare(b.line.department)
    || (a.tone === "here" ? 0 : 1) - (b.tone === "here" ? 0 : 1)
    || a.machine.localeCompare(b.machine, undefined, { numeric: true });
}

/**
 * Which department tabs fit the strip; the rest go under "More". Widths are
 * the measured tabs: `all` (the All tab), `depts` (one per department, in the
 * strip's order) and `more` (the More button), with `gap` between tabs. The
 * picked department (`current`, an index, or -1) always keeps its tab. The
 * answer is the indices shown, in order; every index means no More button.
 */
export function fitDepartments({ all, depts, more, gap, avail, current = -1 }) {
  const every = depts.map((_, i) => i);
  if (all + depts.reduce((n, w) => n + gap + w, 0) <= avail) return every;
  let budget = avail - all - gap - more;
  const shown = new Set();
  if (current >= 0 && current < depts.length) { shown.add(current); budget -= depts[current] + gap; }
  for (const i of every) {
    if (shown.has(i)) continue;
    if (depts[i] + gap > budget) break;
    shown.add(i);
    budget -= depts[i] + gap;
  }
  return every.filter((i) => shown.has(i));
}

/** The counts and plan statuses for a set of machines, plans and plan lines. */
function tally(units, plans, lines) {
  const count = (t) => units.filter((u) => u.tone === t).length;
  const statuses = {};
  for (const p of plans) statuses[p.status] = (statuses[p.status] ?? 0) + 1;
  return {
    counts: { plans: plans.length, units: units.length, lines: lines.length,
              pendingLines: lines.filter((l) => planStage(l.planStatus) === "PENDING").length,
              approvedUnits: units.filter((u) => u.tone !== "pending").length,
              here: count("here"), away: count("away"), pending: count("pending"), offshift: count("offshift"), silent: count("silent"), unplaced: count("unplaced"),
              onShift: units.filter((u) => u.onShift).length },
    statuses,
  };
}

/**
 * The view narrowed to one department (the side panel's tabs): its machines,
 * its plans, and only the locations its machines are planned at, recounted
 * for them. No department, or one the day does not plan, is the whole view.
 */
export function scopeView(view, department) {
  if (!view || !department || !view.departments.some((d) => d.name === department)) return view;
  // A machine belongs to every department it has a line with today.
  const units = view.units.filter((u) => u.lines.some((l) => l.department === department));
  const plans = view.plans.filter((p) => p.department === department);
  const lines = view.lines.filter((l) => l.department === department);
  const places = view.places.map((p) => {
    const mine = units.filter((u) => u.fenceId === p.fenceId);
    return { ...p, planned: mine.length, here: mine.filter((u) => u.tone === "here").length };
  }).filter((p) => p.planned > 0);
  const machines = new Set(units.map((u) => u.machine));
  return {
    ...view,
    units,
    places,
    lines,
    ...tally(units, plans, lines),
    plans,
    unplacedLocations: view.unplacedLocations.filter((name) => units.some((u) => !u.fenceId && u.line.workLocation === name)),
    noGps: view.noGps.filter((m) => machines.has(m)),
  };
}
