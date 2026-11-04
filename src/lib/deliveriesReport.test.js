import { describe, it, expect } from 'vitest';
import { findStorages, customersIn, tripOf, deliveries, deliveryRow, rowCells, csvTable, deliveriesPdfBody, stamp, notLeftWords, readOrders } from './deliveriesReport';
import { addVehicle, removeVehicle, setCustomers, emptyPlan } from './deliveryPlan';
import { reportKeysFor, hasDeliveriesTab } from './reportNav';

const at = (s) => Date.parse(`${s}+03:00`);
const sq = (name, lat, lng, d = 0.001) => ({ type: 'Feature', properties: { name },
  geometry: { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] } });
const MORL = { lat: -0.288, lng: 36.0449 };              // MORL in Wialon Logistics
const NBI = { lat: -1.30246, lng: 36.86617 };
const A = { lat: -0.40, lng: 36.10 };
const B = { lat: -0.45, lng: 36.15 };
const ROAD = { lat: -0.37, lng: 36.09 };
const zones = { features: [
  sq('Menengai Yard - Nakuru HQ', MORL.lat, MORL.lng, 0.003), sq('MENENGAI_FG: NAIROBI DEPOT', NBI.lat, NBI.lng, 0.0002),
  sq('MENENGAI_VS: JOJAC INVESTMENTS', A.lat, A.lng), sq('MENENGAI_FG:THANJU SHOP', B.lat, B.lng),
  sq('MENENGAI_VS: DUR DUR COSMETICS', NBI.lat + 0.0005, NBI.lng),       // drawn on the depot
  sq('Some farm', 0, 36),
] };
const p = (s, where) => ({ t: at(s), ...where });

describe('Deliveries Report', () => {
  const storages = findStorages(zones);
  const customers = customersIn(zones, storages);
  const byName = new Map(customers.map((c) => [c.name, c]));

  it('finds the two storages and the customers, the depot itself left out', () => {
    expect(storages.map((s) => s.label)).toEqual(['MORL', 'Nairobi depot']);
    expect(customers.map((c) => c.label)).toEqual(['DUR DUR COSMETICS', 'JOJAC INVESTMENTS', 'Some farm', 'THANJU SHOP']);
    expect(customers.find((c) => c.label === 'Some farm').kind).toBe('Geofence');
    expect(customers.find((c) => c.label === 'DUR DUR COSMETICS').nearStorage).toBe(true);
    expect(customers.find((c) => c.label === 'THANJU SHOP').kind).toBe('FG');
  });

  it('reads when it left storage, ignoring a wander at the gate, and when it came back', () => {
    const pings = [
      p('2026-10-30T03:00:00', MORL), p('2026-10-30T03:30:00', ROAD), p('2026-10-30T03:32:00', MORL),   // 2 min out: the gate
      p('2026-10-30T04:05:02', ROAD), p('2026-10-30T06:00:00', A), p('2026-10-30T12:00:00', ROAD), p('2026-10-30T15:00:00', MORL),
    ];
    const trip = tripOf(pings, storages, { to: at('2026-10-30T16:00:00') });
    expect(stamp(trip.leftAt)).toBe('30.10.2026 04:05:02');
    expect(trip.leftFrom.label).toBe('MORL');
    expect(stamp(trip.arrivedAt)).toBe('30.10.2026 15:00:00');
    expect(tripOf(pings, storages, { to: at('2026-10-30T10:00:00') }).arrivedAt).toBeNull();
    expect(tripOf([p('2026-10-30T05:00:00', ROAD)], storages, { to: at('2026-10-30T10:00:00') }).need).toBe(true);
  });

  it('counts the road outside the small Nairobi depot fence as the depot, and takes the last storage left', () => {
    const nearDepot = { lat: NBI.lat + 0.0009, lng: NBI.lng };      // ~100 m off the 35 m fence
    const pings = [
      p('2026-11-02T08:00:00', MORL), p('2026-11-02T08:30:00', ROAD),                 // left MORL
      p('2026-11-03T18:00:00', nearDepot), p('2026-11-04T06:00:00', nearDepot),       // night at the depot gate
      p('2026-11-04T06:20:00', { lat: NBI.lat + 0.02, lng: NBI.lng }),                // out on delivery
    ];
    const trip = tripOf(pings, storages, { to: at('2026-11-04T12:00:00') });
    expect(trip.leftFrom.label).toBe('Nairobi depot');
    expect(stamp(trip.leftAt)).toBe('04.11.2026 06:20:00');
  });

  it('takes MORL as 1 km round its Logistics point', () => {
    const m = storages.find((s) => s.key === 'morl');
    expect(m.feature.geometry.coordinates).toEqual([36.04494759379902, -0.28802969095623043]);
    expect(m.fence).toBeTruthy();
    const nearby = { lat: -0.288 + 0.008, lng: 36.0449 };     // ~900 m off the point
    const out = { lat: -0.288 + 0.011, lng: 36.0449 };        // ~1.2 km off
    const trip = tripOf([p('2026-11-04T06:00:00', nearby), p('2026-11-04T06:30:00', out), p('2026-11-04T09:00:00', ROAD)], storages, { to: at('2026-11-04T10:00:00') });
    expect(trip.leftFrom.label).toBe('MORL');
    expect(stamp(trip.leftAt)).toBe('04.11.2026 06:30:00');
  });

  it('takes the Nairobi depot (STO) as 1 km round its Logistics point', () => {
    const sto = storages.find((s) => s.key === 'nairobi');
    expect(sto.feature.geometry.coordinates).toEqual([36.8660916, -1.3029466]);
    const trip = tripOf([p('2026-11-04T06:00:00', { lat: -1.3029466 + 0.008, lng: 36.8660916 }), p('2026-11-04T06:30:00', { lat: -1.3029466 + 0.011, lng: 36.8660916 })],
      storages, { to: at('2026-11-04T10:00:00') });
    expect(trip.leftFrom.label).toBe('Nairobi depot');
    expect(stamp(trip.leftAt)).toBe('04.11.2026 06:30:00');
  });

  it('says why there is no departure', () => {
    expect(notLeftWords(tripOf([p('2026-11-04T06:00:00', MORL), p('2026-11-04T09:00:00', MORL)], storages, { to: at('2026-11-04T10:00:00') }))).toBe('At MORL, not left');
    expect(notLeftWords(tripOf([p('2026-11-04T06:00:00', ROAD)], storages, { to: at('2026-11-04T10:00:00') }))).toBe('Not at MORL/STO in 10 days');
  });

  it('trusts Movements for where the vehicle is now: a quiet tracker at MORL is at MORL', () => {
    const plan = { plate: 'KDE 127E', customers: [] };
    const quiet = deliveryRow(plan, [p('2026-11-01T06:00:00', ROAD)], storages, byName, { to: at('2026-11-04T17:00:00'), atMorl: true });
    expect(rowCells(quiet)[1]).toBe('At MORL, not left');
    // Its last position, newer than the readings, is used: back at MORL
    const back = deliveryRow(plan, [p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', ROAD)], storages, byName,
      { to: at('2026-11-04T17:00:00'), lastFix: { t: at('2026-11-04T16:00:00'), ...MORL } });
    expect(rowCells(back)[4]).toBe('04.11.2026 16:00:00');
  });

  it('counts a customer only after 1½ minutes inside its geofence', () => {
    const pings = [p('2026-10-30T06:00:00', A), p('2026-10-30T06:00:30', A), p('2026-10-30T06:01:40', ROAD),
      p('2026-10-30T07:00:00', B), p('2026-10-30T07:00:30', B), p('2026-10-30T07:01:00', ROAD)];
    const got = deliveries(pings, customers, { from: at('2026-10-30T05:00:00'), to: at('2026-10-30T09:00:00') });
    expect([...got.keys()]).toEqual(['MENENGAI_VS: JOJAC INVESTMENTS']);
  });

  it('builds the sheet’s row: 1/2, still out, where it is', () => {
    const plan = { plate: 'KCP 136P', vehicleId: 'v1', customers: ['MENENGAI_VS: JOJAC INVESTMENTS', 'MENENGAI_FG:THANJU SHOP'] };
    const pings = [p('2026-10-30T03:00:00', MORL), p('2026-10-30T04:05:02', ROAD), p('2026-10-30T06:00:00', A), p('2026-10-30T06:02:00', A), p('2026-10-30T06:03:00', ROAD)];
    const r = deliveryRow(plan, pings, storages, byName, { to: at('2026-10-30T10:00:00'), place: 'Thanju' });
    expect(rowCells(r)).toEqual(['KCP 136P', '30.10.2026 04:05:02 (MORL)', '1/2', 'Thanju', '']);
    expect(r.customers.map((c) => Boolean(c.at))).toEqual([true, false]);
    expect(csvTable([r]).body[0].slice(-2)).toEqual(['JOJAC INVESTMENTS 06:00', 'THANJU SHOP']);
    const body = deliveriesPdfBody([r], { from: at('2026-10-30T07:00:00'), at: at('2026-10-30T10:00:00'), fleet: 'Menengai Oil Refineries Ltd' });
    expect(body).toMatchObject({ fleet: 'Menengai Oil Refineries Ltd', group: 'all', stops: true });
    expect(body.rows[0]).toMatchObject({ plate: 'KCP 136P', fulfilled: 1, planned: 2, place: 'Thanju', notLeft: null, arrivedAt: null, arrivedTo: null });
    expect(body.rows[0].leftFrom).toEqual({ short: 'MORL', label: 'MORL' });
    expect(body.rows[0].customers.map((c) => c.label)).toEqual(['JOJAC INVESTMENTS', 'THANJU SHOP']);
    // Only what the server's schema names: no geofence shapes go up with the customers
    expect(Object.keys(body.rows[0].customers[0]).sort()).toEqual(['at', 'label']);
    expect(deliveriesPdfBody([r], { from: 1, at: 2, fleet: 'M', group: 'Van Sales', stops: false })).toMatchObject({ group: 'Van Sales', stops: false });
  });

  it('keeps the day’s list: vehicles once each, their customers', () => {
    const unit = { key: 'KCP136P', plate: 'KCP 136P', vehicles: [{ vehicleId: 'v1' }] };
    let plan = addVehicle(addVehicle(emptyPlan(), unit), unit);
    expect(plan.vehicles).toHaveLength(1);
    plan = setCustomers(plan, 'KCP136P', ['a', 'a', 'b']);
    expect(plan.vehicles[0].customers).toEqual(['a', 'b']);
    expect(removeVehicle(plan, 'KCP136P').vehicles).toEqual([]);
  });

  it('reads a typed Orders fulfilled: 8/10, not 11/10 or words', () => {
    expect(readOrders('8/10')).toEqual({ fulfilled: 8, planned: 10 });
    expect(readOrders(' 8 / 10 ')).toEqual({ fulfilled: 8, planned: 10 });
    expect(readOrders('0/0')).toEqual({ fulfilled: 0, planned: 0 });
    expect(readOrders('11/10')).toBeNull();
    expect(readOrders('eight')).toBeNull();
    expect(readOrders('')).toBeNull();
  });

  it('is a tab under Movements for Menengai only', () => {
    expect(hasDeliveriesTab(() => true, 'MENENGAI')).toBe(true);
    expect(hasDeliveriesTab(() => true, 'KABRAS')).toBe(false);
    expect(reportKeysFor(() => true, 'MENENGAI')).not.toContain('deliveries');
  });
});

describe('the report window', () => {
  const storages = findStorages(zones);
  const byName = new Map(customersIn(zones, storages).map((c) => [c.name, c]));
  const plan = { plate: 'KDE 127E', customers: ['MENENGAI_VS: JOJAC INVESTMENTS'] };
  const pings = [
    { t: at('2026-11-03T07:00:00'), ...MORL }, { t: at('2026-11-03T08:00:00'), ...ROAD },
    { t: at('2026-11-03T09:00:00'), ...A }, { t: at('2026-11-03T09:05:00'), ...A }, { t: at('2026-11-03T10:00:00'), ...ROAD },
    { t: at('2026-11-04T10:00:00'), ...ROAD },
  ];
  const to = at('2026-11-04T12:00:00');
  it('counts a delivery inside the window', () => {
    expect(deliveryRow(plan, pings, storages, byName, { to }).fulfilled).toBe(1);
  });
  it('does not count one before the window', () => {
    expect(deliveryRow(plan, pings, storages, byName, { from: at('2026-11-04T07:00:00'), to }).fulfilled).toBe(0);
  });
});
