// The day's delivery list for the Deliveries Report (operator, 4 Nov 2026:
// "just for specific vehicles that have been shared during the day"; "for now
// let's keep it in the browser"): which vehicles, and each one's customers.
// Kept in this browser (localStorage), a list per organisation per day; a
// browser that cannot keep it holds it for as long as the page is open.
//
// A plan: { vehicles: [{ key, plate, vehicleIds: [..], customers: [names], pins: [{ name, lat, lng, radiusM }] }] }
// `pins`: delivery points pasted as coordinates (operator, 4 Nov 2026), for
// places with no geofence or one that cannot be trusted.

const KEY = (orgCode, day) => `ft-deliveries:${String(orgCode ?? '').toUpperCase()}:${day}`;
const memory = new Map();
const KEEP_DAYS = 14;
/** How far round a pasted point still counts as being at it, unless the operator says otherwise. */
export const PIN_RADIUS_M = 200;
export const PIN_RADIUS_MIN_M = 20;
export const PIN_RADIUS_MAX_M = 5000;

export const emptyPlan = () => ({ vehicles: [] });

export function loadPlan(orgCode, day) {
  const k = KEY(orgCode, day);
  try {
    const raw = localStorage.getItem(k);
    if (raw) return { ...emptyPlan(), ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return memory.get(k) ?? emptyPlan();
}

export function savePlan(orgCode, day, plan) {
  const k = KEY(orgCode, day);
  memory.set(k, plan);
  try {
    localStorage.setItem(k, JSON.stringify(plan));
    // Lists older than KEEP_DAYS go
    const cut = new Date(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const prefix = KEY(orgCode, '');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && key.slice(prefix.length) < cut) localStorage.removeItem(key);
    }
  } catch { /* storage full or blocked: kept in memory */ }
}

/** The most recent earlier day with a list, within KEEP_DAYS, or null. */
export function lastPlanBefore(orgCode, day) {
  for (let n = 1; n <= KEEP_DAYS; n++) {
    const d = new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const p = loadPlan(orgCode, d);
    if (p.vehicles.length) return { day: d, plan: p };
  }
  return null;
}

// ── changes, each returning a new plan ──
export const addVehicle = (plan, unit) => (plan.vehicles.some((v) => v.key === unit.key) ? plan
  : { ...plan, vehicles: [...plan.vehicles, { key: unit.key, plate: unit.plate, vehicleIds: unit.vehicles.map((x) => x.vehicleId), customers: [] }] });
export const setPins = (plan, key, pins) => ({ ...plan, vehicles: plan.vehicles.map((v) => (v.key === key ? { ...v, pins } : v)) });
export const removeVehicle = (plan, key) => ({ ...plan, vehicles: plan.vehicles.filter((v) => v.key !== key) });
export const setCustomers = (plan, key, customers) => ({ ...plan, vehicles: plan.vehicles.map((v) => (v.key === key ? { ...v, customers: [...new Set(customers)] } : v)) });

// ── pasted coordinates ──
// A pair needs its decimals: a shop number or a date in the same cell is not a coordinate.
const PAIR = /(-?\d{1,3}\.\d+)°?\s*[,;|/\s]\s*(?:l(?:ng|on|ong)\w*\s*[:=]?\s*)?(-?\d{1,3}\.\d+)/gi;

/**
 * Latitude first, or GIS's longitude first: this fleet runs in East Africa,
 * where latitudes are small and longitudes are not, so the order shows itself.
 */
function ordered(a, b) {
  const swap = Math.abs(a) > 90 || (Math.abs(a) >= 25 && Math.abs(b) <= 15);
  const [lat, lng] = swap ? [b, a] : [a, b];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
}

/**
 * Delivery points from pasted text, one a line in any of the shapes a sheet or
 * a map gives: "-0.28, 36.04", "Naivas Nakuru<tab>-0.28<tab>36.04", "lat: -0.28
 * lng: 36.04", a Google Maps link, or KML's "36.04,-0.28,0 36.05,-0.29,0". The
 * words on the line name the point.
 * @returns {{ pins: Array<{name, lat, lng, radiusM}>, bad: string[] }} `bad`: the lines with no coordinates
 */
export function readCoordinates(text, radiusM = PIN_RADIUS_M) {
  const r = Number(radiusM);
  const radius = Number.isFinite(r) && r > 0 ? Math.min(PIN_RADIUS_MAX_M, Math.max(PIN_RADIUS_MIN_M, Math.round(r))) : PIN_RADIUS_M;
  const pins = [];
  const bad = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\u2212/g, '-').trim();
    if (!line) continue;
    const found = [...line.matchAll(PAIR)].map((m) => ({ m, at: ordered(Number(m[1]), Number(m[2])) })).filter((x) => x.at);
    if (!found.length) {
      // A sheet's header row is not a line that failed
      if (/\d/.test(line) || !/\b(lat|latitude|lon|lng|long|longitude)\b/i.test(line)) bad.push(raw.trim());
      continue;
    }
    const words = /https?:\/\//i.test(line) ? '' : found.reduce((s, x) => s.replace(x.m[0], ' '), line)
      .replace(/\b(latitude|longitude|lat|lng|lon|long)\b\s*[:=]?/gi, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s,;|:=-]+|[\s,;|:=-]+$/g, '').slice(0, 120);
    // Words name it; a bare number left over is an altitude or a zoom
    const name = found.length === 1 && /\p{L}/u.test(words) ? words : '';
    for (const { at } of found) pins.push({ name, ...at, radiusM: radius });
  }
  return { pins, bad };
}

/** The list with more points on it: the same place twice is one stop, the later paste's name and radius standing. */
export function mergePins(have, more) {
  const key = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const byPlace = new Map((have ?? []).map((p) => [key(p), p]));
  for (const p of more ?? []) byPlace.set(key(p), p);
  return [...byPlace.values()];
}
