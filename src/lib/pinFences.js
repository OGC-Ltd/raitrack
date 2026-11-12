// Delivery points turned into geofences (operator, 13 Nov 2026: "the selected
// vehicles to run a report on have the geofences configured"). A point added
// to a vehicle on the Deliveries list, from an Excel sheet or pasted as
// coordinates, becomes a geofence stop: the fence it already has, else a
// circle drawn at it named after the customer, as the Planner draws one for a
// sheet's new customer. The list then holds geofences only, and the Planner
// plan made from it is fenced too. A point with no name is never fenced
// (operator, 13 Nov 2026: "pasting coordinates but also the name should be
// provided"): it waits, a point, until it is given one.
//
// Pure: no React, no network. The page draws the fences this plans.

import { matchGeofences, middleOf, pinCode } from './deliveriesReport';
import { metres } from './plannerActual';
import { readCoordinates } from './deliveryPlan';

/** The circle drawn for a point with no fence, as the Planner's (fleet-server planner CUSTOMER_RADIUS_M). */
export const FENCE_RADIUS_M = 100;
/** A fence of the same name this close to the point is that customer's: taken, not drawn again (the Planner's 1 km). */
export const SAME_PLACE_M = 1000;
const RADIUS_MIN_M = 10;
const RADIUS_MAX_M = 5000;
const NAME_MAX = 120;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** A point's name: the words given with it, '' when none were. */
export const pinName = (pin) => String(pin?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/**
 * What to do with each point.
 * @param {Array<{ name?, lat, lng, radiusM? }>} pins
 * @param {Array<{ name, feature }>} customers  the geofences a stop can be (lib/deliveriesReport customersIn)
 * @param {Map<string, string>} [fencedNames]   pin code → the name of the fence drawn for it in the Planner
 * @returns {{ use: string[], draw: Array<{ pin, body }>, unnamed: object[] }}
 *   `use`: geofence names to put on the vehicle as they are; `draw`: a fence
 *   to draw for each named point left, its body ready for api/geofences
 *   createFence; `unnamed`: the points left with no name, not fenced
 */
export function pinFencePlan(pins, customers, fencedNames = new Map()) {
  const list = customers ?? [];
  const byName = new Map(list.map((c) => [norm(c.name), c]));
  const taken = new Set(byName.keys());
  const use = [];
  const draw = [];
  const unnamed = [];
  for (const pin of pins ?? []) {
    if (!Number.isFinite(pin?.lat) || !Number.isFinite(pin?.lng)) continue;
    // Fenced in the Planner already: that fence
    const fenced = byName.get(norm(fencedNames?.get(pinCode(pin))));
    if (fenced) { use.push(fenced.name); continue; }
    // A fence of its name at the same place: the customer's own
    const name = pinName(pin);
    if (!name) { unnamed.push(pin); continue; }
    const hit = matchGeofences([name], list).names[0];
    const mid = hit ? middleOf(byName.get(norm(hit))?.feature) : null;
    if (mid && metres(mid, pin) <= SAME_PLACE_M) { use.push(hit); continue; }
    // Else a new circle; a name another fence already goes by gets a number, so a stop picked by name is this one
    let fenceName = name;
    for (let i = 2; taken.has(norm(fenceName)); i++) fenceName = `${name.slice(0, NAME_MAX - 6)} (${i})`;
    taken.add(norm(fenceName));
    const r = Number(pin.radiusM);
    const radiusM = Number.isFinite(r) && r > 0 ? Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, Math.round(r))) : FENCE_RADIUS_M;
    draw.push({ pin, body: { name: fenceName, type: 'CIRCLE', mode: 'ALLOWLIST', purpose: 'shop', centerLat: round6(pin.lat), centerLng: round6(pin.lng), radiusM } });
  }
  return { use: [...new Set(use)], draw, unnamed };
}

/**
 * Draw the planned fences, one after another (a failure leaves the rest to try).
 * @param {(body) => Promise<{ name }>} create  api/geofences createFence bound to the organisation
 * @returns {Promise<{ names: string[], kept: object[], error: string|null }>}
 *   `names`: the fences drawn; `kept`: the points whose fence could not be drawn, still points
 */
export async function drawPinFences(draw, create) {
  const names = [];
  const kept = [];
  let error = null;
  for (const { pin, body } of draw ?? []) {
    try {
      const f = await create(body);
      names.push(f?.name ?? body.name);
    } catch (err) {
      kept.push(pin);
      error = error ?? (err?.message ?? String(err));
    }
  }
  return { names, kept, error };
}

/**
 * A paste read a line at a time, each coordinates line needing the customer's
 * name with it (operator, 13 Nov 2026: "pasting coordinates but also the name
 * should be provided").
 * @returns {{ pins: object[], bad: string[], nameless: string[] }}
 *   `pins`: named points; `bad`: lines with no coordinates (a geofence's name,
 *   or nothing readable); `nameless`: coordinates lines with no name, left to be named
 */
export function readNamedPaste(text, radiusM) {
  const pins = [];
  const bad = [];
  const nameless = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const got = readCoordinates(raw, radiusM);
    bad.push(...got.bad);
    if (!got.pins.length) continue;
    if (got.pins.every((p) => pinName(p))) pins.push(...got.pins);
    else nameless.push(raw.trim());
  }
  return { pins, bad, nameless };
}
