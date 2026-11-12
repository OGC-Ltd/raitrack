// The customers' geofences a Finished Goods or Van Sales unit went through
// (operator, 12 Nov 2026: "a tab that can show the list of customers geofence
// that vehicle passed through the last three days ... only for the FG and VS").
//
// Read from the unit's own readings, by the Deliveries report's rule
// (lib/deliveriesReport stopCheck): inside the geofence, or within
// PASS_RADIUS_M of it (from a pasted point's centre, from a drawn geofence's
// edge). So the card and the report never disagree about a customer.
//
// A visit: from the first reading there to the first reading away again. Two
// stretches there with less than VISIT_GAP_MS between are one visit (the fix
// wandering at the gate); `stoodMs` is the time in it at STAND_KMH or under.
//
// Pure: no React, no network.

import { menengaiGroup } from './vehicleMap';
import { middleOf, storageAt, PASS_RADIUS_M, STAND_KMH } from './deliveriesReport';
import { fenceContains } from './zoneContainment';
import { metresToFence } from './movementDepots';

export const VISIT_DAYS = 3;
export const VISIT_GAP_MS = 20 * 60_000;
/** The units the tab is for: Menengai's Finished Goods and Van Sales lists. */
export const VISIT_GROUPS = ['mg:Finished Goods', 'mg:Van Sales'];

export const isFgVs = (vehicle) => VISIT_GROUPS.includes(menengaiGroup(vehicle));

const R = 6_371_000;
const rad = (x) => (x * Math.PI) / 180;
const metres = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const fix = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && !(p.lat === 0 && p.lng === 0);

/** "Dashama wholesalers" from "menengai: Dashama wholesalers" or "MENENGAI_VS: DEVAM". */
export const customerLabel = (name) => String(name ?? '').replace(/^\s*menengai(?:_(?:vs|fg))?\s*:\s*/i, '').trim() || String(name ?? '');

/** How far out a reading can be and still be near the fence: its own size, then PASS_RADIUS_M. */
function reachOf(f, mid) {
  if (f?.geometry?.type === 'Point') return (f.properties?.radiusM ?? 0) + PASS_RADIUS_M;
  const rings = f?.geometry?.type === 'Polygon' ? f.geometry.coordinates : f?.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
  let far = 0;
  for (const ring of rings) for (const [lng, lat] of ring) far = Math.max(far, metres(mid, { lat, lng }));
  return far + PASS_RADIUS_M;
}

/** Near a customer, by stopCheck's measure. */
function near(p, c) {
  if (fenceContains(p, c.feature)) return true;
  return (c.point ? metres(p, c.mid) : metresToFence(p, c.feature)) <= PASS_RADIUS_M;
}

/**
 * The visits in [from, to], latest first.
 * @param {object[]} pings      the unit's readings
 * @param {object[]} customers  lib/deliveriesReport customersIn(), storages and their yards left out
 * @returns {Array<{ name, label, kind, enteredAt, leftAt, stoodMs }>} leftAt null: still there at the last reading
 */
export function customerVisits(pings, customers, { from, to }) {
  const list = (pings ?? []).filter((p) => p.t >= from && p.t <= to && fix(p)).sort((a, b) => a.t - b.t);
  const fences = (customers ?? []).map((c) => {
    const mid = middleOf(c.feature);
    return mid ? { ...c, mid, point: c.feature?.geometry?.type === 'Point', reach: reachOf(c.feature, mid) } : null;
  }).filter(Boolean);
  const open = new Map();   // name → the visit under way
  const runs = [];
  const close = (name, leftAt) => { const v = open.get(name); v.leftAt = leftAt; runs.push(v); open.delete(name); };
  let prev = null;
  for (const p of list) {
    const here = new Set();
    for (const c of fences) {
      if (metres(p, c.mid) > c.reach || !near(p, c)) continue;
      here.add(c.name);
      if (!open.has(c.name)) open.set(c.name, { name: c.name, label: customerLabel(c.label ?? c.name), kind: c.kind, enteredAt: p.t, lastAt: p.t, leftAt: null, stoodMs: 0 });
      const cur = open.get(c.name);
      if (prev && cur.lastAt === prev.t && !(p.speedKmh > STAND_KMH) && !(prev.speedKmh > STAND_KMH)) cur.stoodMs += p.t - prev.t;
      cur.lastAt = p.t;
    }
    // Away from a customer it was at: it left at this reading
    for (const name of [...open.keys()]) if (!here.has(name)) close(name, p.t);
    prev = p;
  }
  for (const v of open.values()) runs.push(v);
  // Back within VISIT_GAP_MS of leaving: the same visit
  const visits = [];
  const last = new Map();
  for (const r of runs.sort((a, b) => a.enteredAt - b.enteredAt)) {
    const before = last.get(r.name);
    if (before && before.leftAt != null && r.enteredAt - before.leftAt <= VISIT_GAP_MS) {
      before.leftAt = r.leftAt;
      before.stoodMs += r.stoodMs;
      continue;
    }
    const v = { name: r.name, label: r.label, kind: r.kind, enteredAt: r.enteredAt, leftAt: r.leftAt, stoodMs: r.stoodMs };
    visits.push(v);
    last.set(r.name, v);
  }
  return visits.sort((a, b) => b.enteredAt - a.enteredAt);
}

/**
 * Its stays at MORL HQ in [from, to] (operator, 12 Nov 2026: "include when it's at MORL HQ and
 * highlight the same with green"), by the Deliveries report's own test of being at MORL
 * (lib/deliveriesReport storageAt), so the tab and its Arrived at yard agree. Shaped as visits,
 * with `home` set; back within VISIT_GAP_MS of leaving is the same stay.
 */
export function yardStays(pings, storages, { from, to }, key = 'morl') {
  const list = (pings ?? []).filter((p) => p.t >= from && p.t <= to && fix(p)).sort((a, b) => a.t - b.t);
  const runs = [];
  let open = null;
  let prev = null;
  for (const p of list) {
    if (storageAt(p, storages ?? [])?.key === key) {
      if (!open) open = { enteredAt: p.t, lastAt: p.t, leftAt: null, stoodMs: 0 };
      else if (open.lastAt === prev?.t && !(p.speedKmh > STAND_KMH) && !(prev.speedKmh > STAND_KMH)) open.stoodMs += p.t - prev.t;
      open.lastAt = p.t;
    } else if (open) {
      open.leftAt = p.t;
      runs.push(open);
      open = null;
    }
    prev = p;
  }
  if (open) runs.push(open);
  const stays = [];
  for (const r of runs) {
    const last = stays[stays.length - 1];
    if (last && last.leftAt != null && r.enteredAt - last.leftAt <= VISIT_GAP_MS) { last.leftAt = r.leftAt; last.stoodMs += r.stoodMs; continue; }
    stays.push({ name: `yard:${key}`, label: 'MORL HQ', kind: 'HQ', home: true, enteredAt: r.enteredAt, leftAt: r.leftAt, stoodMs: r.stoodMs });
  }
  return stays.sort((a, b) => b.enteredAt - a.enteredAt);
}

/** The customers the tab reads: every area geofence but the storages and the yards beside them. */
export const visitCustomers = (customers) => (customers ?? []).filter((c) => !c.nearStorage);
