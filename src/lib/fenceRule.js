// A geofence's rule: who may not use it and the alert it raises (operator,
// 2026-11-11: purpose = no-go zone; rule = tankers must not use this route;
// when a tanker does, a no-go alert is raised). The server keeps it on the
// fence and checks it on every live position (fleet-server lib/fence-rules,
// lib/fence-rule-watch); this is the form's half, and its sentence is the
// server's sentence.
//
// Pure: no React, no network.

import { groupsFor, scopeUnits } from './fleetGroups';

export const TRIGGERS = [
  { id: 'enter', label: 'Enters it', verb: 'must not enter', allowed: 'may enter' },
  { id: 'inside', label: 'Is inside it', verb: 'must not be inside', allowed: 'may be inside' },
];

export const SEVERITIES = [
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
];

/** A new rule, before anything is picked: everyone, on entry, a critical no-go alert. */
export function blankRule() {
  return { trigger: 'enter', vehicleTypes: [], fleets: [], vehicleIds: [], hours: null, alert: { type: 'nogo', severity: 'critical' } };
}

/** A stored rule (from the GeoJSON properties) as the form's state, or null. */
export function ruleOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const b = blankRule();
  return {
    trigger: raw.trigger === 'inside' ? 'inside' : 'enter',
    vehicleTypes: Array.isArray(raw.vehicleTypes) ? raw.vehicleTypes : [],
    fleets: Array.isArray(raw.fleets) ? raw.fleets : [],
    vehicleIds: Array.isArray(raw.vehicleIds) ? raw.vehicleIds : [],
    hours: raw.hours?.from && raw.hours?.to ? { from: raw.hours.from, to: raw.hours.to } : null,
    alert: { type: 'nogo', severity: raw.alert?.severity === 'warning' ? 'warning' : b.alert.severity },
  };
}

const upper = (t) => String(t ?? '').trim().toUpperCase();

/** "Tankers", "Tankers and TANKER units", "No unit" (every unit is barred). */
export function whoWords(rule) {
  const parts = [...(rule.fleets ?? []), ...(rule.vehicleTypes ?? []).map((t) => `${upper(t)} units`)];
  const named = rule.fleets?.length ? 0 : new Set(rule.vehicleIds ?? []).size;
  if (named) parts.push(`${named} chosen ${named === 1 ? 'unit' : 'units'}`);
  if (!parts.length) return 'No unit';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "Tankers must not enter. Raise a no-go alert." — fleet-server lib/fence-rules ruleWords. */
export function ruleWords(rule) {
  const who = whoWords(rule);
  const t = TRIGGERS.find((x) => x.id === rule.trigger) ?? TRIGGERS[0];
  const verb = who === 'No unit' ? t.allowed : t.verb;
  const when = rule.hours ? ` between ${rule.hours.from} and ${rule.hours.to}` : '';
  const level = rule.alert?.severity === 'warning' ? ' (warning)' : '';
  return `${who} ${verb}${when}. Raise a no-go alert${level}.`;
}

/** What is wrong with the rule, for the form; null when it can be saved. */
export function ruleProblem(rule) {
  if (!rule) return null;
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (rule.hours) {
    if (!clock.test(rule.hours.from) || !clock.test(rule.hours.to)) return 'Give the hours as HH:MM.';
    if (rule.hours.from === rule.hours.to) return 'The hours start and end at the same time.';
  }
  if (rule.fleets.length && !rule.vehicleIds.length) return 'None of the chosen fleets’ units are on the platform.';
  return null;
}

/** The organisation's Wialon vehicle classes, most units first: [{ type, n }]. */
export function vehicleTypesOf(vehicles) {
  const n = new Map();
  for (const v of vehicles ?? []) {
    const t = upper(v?.vehicleType);
    if (t) n.set(t, (n.get(t) ?? 0) + 1);
  }
  return [...n].map(([type, count]) => ({ type, n: count })).sort((a, b) => b.n - a.n || a.type.localeCompare(b.type));
}

/** The organisation's fleet lists (data/fleetGroups), or [] when it has none. */
export function fleetsOf(orgCode) {
  return (groupsFor(orgCode) ?? []).map((g) => g.name);
}

/**
 * The platform's unit ids in these fleets — what the server matches on, since
 * the fleet lists live here. Every tracker on a listed truck is included (a
 * truck can carry a camera unit beside its own).
 */
export function fleetVehicleIds(vehicles, orgCode, fleets) {
  const groups = groupsFor(orgCode);
  if (!groups || !fleets?.length) return [];
  const ids = new Set();
  for (const name of fleets) {
    for (const u of scopeUnits(vehicles, groups, name).units) {
      for (const v of u.vehicles) if (v?.vehicleId) ids.add(String(v.vehicleId));
    }
  }
  return [...ids].sort();
}

/** The rule as the API takes it: the fleets' units filled in from the live list. */
export function rulePayload(rule, { vehicles, orgCode } = {}) {
  if (!rule) return null;
  const fromFleets = fleetVehicleIds(vehicles, orgCode, rule.fleets);
  return {
    trigger: rule.trigger,
    vehicleTypes: [...new Set(rule.vehicleTypes.map(upper).filter(Boolean))],
    fleets: rule.fleets,
    // A fleet's units now; while the list cannot be read, the ids saved before
    vehicleIds: rule.fleets.length ? (fromFleets.length ? fromFleets : rule.vehicleIds) : [],
    hours: rule.hours,
    alert: { type: 'nogo', severity: rule.alert.severity },
  };
}
