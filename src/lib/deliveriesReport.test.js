import { describe, it, expect } from 'vitest';
import { findStorages, customersIn, tripOf, tripsOf, originOf, deliveryRun, backShort, runWords, matchGeofences, deliveries, deliveryRow, rowCells, csvTable, deliveriesPdfBody, stamp, notLeftWords, readOrders, stopCheck, stopWords, pinStop, periodDays } from './deliveriesReport';
import { readCoordinates, mergePins } from './deliveryPlan';
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

  it('finds the two storages and the customers, MORL left out, the Nairobi depot a stop like any', () => {
    expect(storages.map((s) => s.label)).toEqual(['MORL', 'Nairobi depot']);
    expect(customers.map((c) => c.label)).toEqual(['DUR DUR COSMETICS', 'JOJAC INVESTMENTS', 'NAIROBI DEPOT', 'Some farm', 'THANJU SHOP']);
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
    expect(rowCells(back)[4]).toBe('04.11.2026 16:00:00 (MORL)');
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
    expect(csvTable([r]).body[0].slice(-2)).toEqual(['JOJAC INVESTMENTS 06:00', expect.stringMatching(/^THANJU SHOP \(Not reached, closest /)]);
    const body = deliveriesPdfBody([r], { from: at('2026-10-30T07:00:00'), at: at('2026-10-30T10:00:00'), fleet: 'Menengai Oil Refineries Ltd' });
    expect(body).toMatchObject({ fleet: 'Menengai Oil Refineries Ltd', group: 'all', stops: true });
    expect(body.rows[0]).toMatchObject({ plate: 'KCP 136P', fulfilled: 1, planned: 2, place: 'Thanju', notLeft: null, arrivedAt: null, arrivedTo: null });
    expect(body.rows[0].leftFrom).toEqual({ short: 'MORL', label: 'MORL' });
    expect(body.rows[0].customers.map((c) => c.label)).toEqual(['JOJAC INVESTMENTS', 'THANJU SHOP']);
    // Only what the server's schema names: no geofence shapes go up with the customers
    expect(Object.keys(body.rows[0].customers[0]).sort()).toEqual(['at', 'label', 'note']);
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

describe('every trip in the window, and only there', () => {
  const NO_STOP = sq('MORL: BATCHUMA/MIASENYI -TOTAL NO STOP ZONE', -3.67, 38.94, 0.01);
  const storages = findStorages({ features: [NO_STOP, ...zones.features] });
  const byName = new Map(customersIn(zones, storages).map((c) => [c.name, c]));
  const plan = { plate: 'KDE 127E', customers: ['MENENGAI_VS: JOJAC INVESTMENTS'] };
  const today = at('2026-11-04T07:00:00');
  const to = at('2026-11-04T12:00:00');

  it('never takes a no-stop zone for MORL', () => {
    expect(storages.find((s) => s.key === 'morl').fence.properties.name).toBe('Menengai Yard - Nakuru HQ');
    const onMombasaRoad = { lat: -3.67, lng: 38.94 };
    const pings = [p('2026-11-04T07:00:00', MORL), p('2026-11-04T08:00:00', ROAD), p('2026-11-04T10:00:00', onMombasaRoad), p('2026-11-04T11:00:00', onMombasaRoad)];
    expect(tripOf(pings, storages, { to }).arrivedAt).toBeNull();
  });

  it('takes the HQ yard over another Menengai Yard, and never makes one up', () => {
    const other = sq('Menengai yard', 0, 37);
    expect(findStorages({ features: [other, ...zones.features] })[0].fence.properties.name).toBe('Menengai Yard - Nakuru HQ');
    expect(findStorages({ features: [NO_STOP] })[0].fence).toBeNull();
  });

  it('does not credit today with yesterday’s trip', () => {
    const pings = [
      p('2026-11-03T06:00:00', MORL), p('2026-11-03T08:00:00', ROAD), p('2026-11-03T09:00:00', A), p('2026-11-03T09:05:00', A),
      p('2026-11-03T10:00:00', ROAD), p('2026-11-03T11:00:00', MORL), p('2026-11-04T11:00:00', MORL),
    ];
    const r = deliveryRow(plan, pings, storages, byName, { from: today, to });
    expect(r.fulfilled).toBe(0);
    expect(rowCells(r)[1]).toBe('At MORL, not left');
    expect(r.trip.arrivedAt).toBeNull();
  });

  it('keeps a trip begun yesterday and still out', () => {
    const pings = [p('2026-11-03T06:00:00', MORL), p('2026-11-03T08:00:00', ROAD), p('2026-11-04T09:00:00', A), p('2026-11-04T09:05:00', A), p('2026-11-04T10:00:00', ROAD)];
    const r = deliveryRow(plan, pings, storages, byName, { from: today, to });
    expect(stamp(r.trip.leftAt)).toBe('03.11.2026 08:00:00');
    expect(r.fulfilled).toBe(1);
  });

  it('shows the delivery run when a second trip begins after it', () => {
    const pings = [
      p('2026-11-04T07:00:00', MORL), p('2026-11-04T07:30:00', ROAD), p('2026-11-04T08:00:00', A), p('2026-11-04T08:05:00', A),
      p('2026-11-04T08:30:00', ROAD), p('2026-11-04T09:00:00', MORL), p('2026-11-04T10:00:00', MORL), p('2026-11-04T10:30:00', ROAD),
    ];
    const r = deliveryRow(plan, pings, storages, byName, { from: today, to });
    expect(r.fulfilled).toBe(1);
    expect(stamp(r.trip.leftAt)).toBe('04.11.2026 07:30:00');
    expect(stamp(r.trip.arrivedAt)).toBe('04.11.2026 09:00:00');
    expect(r.trip.outAgain).toBe(true);
  });

  it('does not end a trip driving past a storage', () => {
    const atSto = { lat: -1.3029, lng: 36.866 };
    const beyond = { lat: -1.33, lng: 36.9 };
    const pings = [
      p('2026-11-04T07:00:00', MORL), p('2026-11-04T07:30:00', ROAD), p('2026-11-04T08:00:00', A), p('2026-11-04T08:05:00', A),
      p('2026-11-04T10:00:00', atSto), p('2026-11-04T10:02:00', beyond), p('2026-11-04T11:00:00', beyond),
    ];
    const r = deliveryRow(plan, pings, storages, byName, { from: today, to });
    expect(r.trip.leftFrom.label).toBe('MORL');
    expect(stamp(r.trip.leftAt)).toBe('04.11.2026 07:30:00');
    expect(r.trip.arrivedAt).toBeNull();
    expect(r.fulfilled).toBe(1);
  });

  it('reads a van just back as back', () => {
    const pings = [p('2026-11-04T07:00:00', MORL), p('2026-11-04T07:30:00', ROAD), p('2026-11-04T11:58:00', MORL)];
    expect(stamp(tripOf(pings, storages, { to }).arrivedAt)).toBe('04.11.2026 11:58:00');
  });
});

describe('pasted coordinates', () => {
  it('reads what a sheet or a map gives, and says what it could not', () => {
    const { pins, bad } = readCoordinates([
      'Name, Latitude, Longitude',
      'Naivas Nakuru, -0.28802, 36.04494',
      'Shop 12\t-1.30294\t36.86609',
      '36.91000,-1.25000,0',
      'lat: -0.5 lng: 35.25',
      'https://www.google.com/maps/place/x/@-0.91234,34.5,17z',
      'Kisumu town',
      '',
    ].join('\n'), 150);
    expect(pins).toEqual([
      { name: 'Naivas Nakuru', lat: -0.28802, lng: 36.04494, radiusM: 150 },
      { name: 'Shop 12', lat: -1.30294, lng: 36.86609, radiusM: 150 },
      { name: '', lat: -1.25, lng: 36.91, radiusM: 150 },
      { name: '', lat: -0.5, lng: 35.25, radiusM: 150 },
      { name: '', lat: -0.91234, lng: 34.5, radiusM: 150 },
    ]);
    expect(bad).toEqual(['Kisumu town']);
  });
  it('reads several points on a line, and keeps the radius sensible', () => {
    expect(readCoordinates('36.04,-0.28,0 36.05,-0.29,0').pins.map((p) => [p.lat, p.lng])).toEqual([[-0.28, 36.04], [-0.29, 36.05]]);
    expect(readCoordinates('-0.28, 36.04', 'x').pins[0].radiusM).toBe(200);
    expect(readCoordinates('-0.28, 36.04', 1).pins[0].radiusM).toBe(20);
    expect(readCoordinates('-0.28, 36.04', 99999).pins[0].radiusM).toBe(5000);
  });
  it('holds the same place once', () => {
    const a = { name: 'A', lat: -1, lng: 36, radiusM: 200 };
    expect(mergePins([a], [{ ...a, name: 'B' }, { name: 'C', lat: -2, lng: 36, radiusM: 200 }]).map((p) => p.name)).toEqual(['B', 'C']);
  });
});

describe('MORL and the Nairobi depot are different places, found by playing the route back', () => {
  const storages = findStorages(zones);
  const byName = new Map(customersIn(zones, storages).map((c) => [c.name, c]));
  const AWAY = { lat: -1.2, lng: 36.7 };
  const sto = storages.find((s) => s.key === 'nairobi');
  const from = at('2026-11-04T06:00:00');
  const to = at('2026-11-04T20:00:00');
  const JOJAC = 'MENENGAI_VS: JOJAC INVESTMENTS';
  const THANJU = 'MENENGAI_FG:THANJU SHOP';
  const NEAR_NBI = { lat: NBI.lat + 0.0005, lng: NBI.lng };

  it('takes the first stay as the origin', () => {
    expect(originOf([p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', MORL), p('2026-11-04T08:00:00', ROAD)], storages, { to }).key).toBe('morl');
    expect(originOf([p('2026-11-04T06:00:00', NBI), p('2026-11-04T07:00:00', NBI), p('2026-11-04T08:00:00', AWAY)], storages, { to }).key).toBe('nairobi');
    expect(originOf([p('2026-11-04T08:00:00', ROAD)], storages, { to })).toBeNull();
  });
  it('a truck from MORL is not back at the Nairobi depot: it is still out', () => {
    const pings = [p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', ROAD), p('2026-11-04T12:00:00', NBI), p('2026-11-04T14:00:00', NBI), p('2026-11-04T15:00:00', AWAY)];
    const r = deliveryRow({ plate: 'X', customers: [] }, pings, storages, byName, { from, to, place: 'On the road' });
    expect(r.trip.leftFrom.key).toBe('morl');
    expect(stamp(r.trip.leftAt)).toBe('04.11.2026 07:00:00');
    expect(r.trip.arrivedAt).toBeNull();
    expect(rowCells(r)[3]).toBe('On the road');
  });
  it('a van from the depot stays the depot’s through a visit to MORL, and is back only there', () => {
    const pings = [p('2026-11-04T06:00:00', NBI), p('2026-11-04T07:00:00', AWAY), p('2026-11-04T10:00:00', MORL), p('2026-11-04T11:00:00', MORL), p('2026-11-04T12:00:00', AWAY), p('2026-11-04T16:00:00', NBI)];
    const r = deliveryRow({ plate: 'X', customers: [] }, pings, storages, byName, { from, to });
    expect(rowCells(r)[1]).toBe('04.11.2026 07:00:00 (STO)');
    expect(rowCells(r)[4]).toBe('04.11.2026 16:00:00 (STO)');
    expect(deliveriesPdfBody([r], { from, at: to, fleet: 'M' }).rows[0]).toMatchObject({ arrivedTo: 'Nairobi depot', arrivedShort: 'STO' });
    expect(sto.short).toBe('STO');
  });
  it('a short outing after the run keeps the run, and says where it is now', () => {
    const pings = [
      p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', ROAD), p('2026-11-04T09:00:00', A), p('2026-11-04T09:05:00', A), p('2026-11-04T10:00:00', ROAD),
      p('2026-11-04T14:00:00', MORL), p('2026-11-04T15:00:00', MORL), p('2026-11-04T15:30:00', ROAD),
    ];
    const r = deliveryRow({ plate: 'X', customers: [JOJAC] }, pings, storages, byName, { from, to, place: 'Fuel station' });
    expect(stamp(r.trip.leftAt)).toBe('04.11.2026 07:00:00');
    expect(stamp(r.trip.arrivedAt)).toBe('04.11.2026 14:00:00');
    expect(rowCells(r)[3]).toBe('Fuel station');
    const body = deliveriesPdfBody([r], { from, at: to, fleet: 'M' }).rows[0];
    expect(body).toMatchObject({ arrivedTo: null, arrivedShort: 'MORL', place: 'Fuel station' });
  });
  it('with no deliveries, the longest trip in the window', () => {
    const trips = [{ leftAt: at('2026-11-04T07:00:00'), arrivedAt: at('2026-11-04T14:00:00') }, { leftAt: at('2026-11-04T15:00:00'), arrivedAt: at('2026-11-04T15:40:00') }];
    expect(deliveryRun(trips, [], { from, to })).toMatchObject({ leftAt: trips[0].leftAt, outAgain: true });
    expect(deliveryRun([], [], { from, to })).toBeNull();
  });
  it('over two trips: out on the first delivery’s, back from the last’s', () => {
    const trips = tripsOf([p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', ROAD), p('2026-11-04T09:00:00', MORL), p('2026-11-04T10:00:00', MORL), p('2026-11-04T11:00:00', ROAD), p('2026-11-04T13:00:00', MORL)], [storages[0]], { to }).trips;
    const run = deliveryRun(trips, [at('2026-11-04T12:00:00'), at('2026-11-04T08:00:00')], { from, to });
    expect(stamp(run.leftAt)).toBe('04.11.2026 07:00:00');
    expect(stamp(run.arrivedAt)).toBe('04.11.2026 13:00:00');
    expect(run.outAgain).toBe(false);
  });
  it('back with stops undelivered says so', () => {
    const pings = [p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', ROAD), p('2026-11-04T09:00:00', A), p('2026-11-04T09:05:00', A), p('2026-11-04T10:00:00', ROAD), p('2026-11-04T14:00:00', MORL)];
    const r = deliveryRow({ plate: 'X', customers: [JOJAC, THANJU] }, pings, storages, byName, { from, to });
    expect([r.fulfilled, r.planned, backShort(r)]).toEqual([1, 2, 1]);
    expect(runWords(r)).toBe('1/2 delivered · left MORL 07:00 · back MORL 14:00 · 1 not delivered');
    expect(deliveriesPdfBody([r], { from, at: to, fleet: 'M' }).rows[0].run).toBe(runWords(r));
    expect(backShort({ ...r, fulfilled: 2 })).toBe(0);
  });
  it('driving through a large geofence is not a delivery; standing in it is', () => {
    const town = { name: 'Town', label: 'Town', feature: sq('Town', A.lat, A.lng, 0.05) };
    const drive = [0, 1, 2, 3, 4].map((m) => ({ t: from + m * 60_000, ...A, speedKmh: 50 }));
    expect(stopCheck([drive], town, { from, to })).toMatchObject({ at: null, reachedAt: from });
    const stand = [0, 1, 2, 3].map((m) => ({ t: from + m * 60_000, ...A, speedKmh: m === 3 ? 30 : 0 }));
    expect(stopCheck([stand], town, { from, to }).at).toBe(from);
    const crawl = [{ t: from, ...A, speedKmh: 0 }, { t: from + 30_000, ...A, speedKmh: 40 }, { t: from + 60_000, ...A, speedKmh: 0 }, { t: from + 90_000, ...A, speedKmh: 40 }];
    expect(stopCheck([crawl], town, { from, to }).at).toBeNull();
  });
  it('parked in the origin’s yard delivers nothing to a stop on its ground; a visit from the road does', () => {
    const yardShop = { lat: MORL.lat + 0.001, lng: MORL.lng };
    const pin = { name: 'Yard shop', ...yardShop, radiusM: 200 };
    const out = { lat: MORL.lat + 0.1, lng: MORL.lng };
    const parked = deliveryRow({ plate: 'X', customers: [], pins: [pin] }, [p('2026-11-04T06:00:00', yardShop), p('2026-11-04T16:00:00', yardShop)], storages, byName, { from, to });
    expect(parked.fulfilled).toBe(0);
    expect(stopWords(parked.customers[0])).toBe('No stop away from MORL');
    const visit = deliveryRow({ plate: 'X', customers: [], pins: [pin] }, [p('2026-11-04T06:00:00', yardShop), p('2026-11-04T07:00:00', out), p('2026-11-04T09:00:00', yardShop), p('2026-11-04T09:03:00', yardShop), p('2026-11-04T09:05:00', out)], storages, byName, { from, to });
    expect(visit.fulfilled).toBe(1);
  });
  it('a stop at the other depot is judged as any shop', () => {
    const pin = { name: 'Depot', ...NEAR_NBI, radiusM: 200 };
    const r = deliveryRow({ plate: 'X', customers: [], pins: [pin] }, [p('2026-11-04T06:00:00', MORL), p('2026-11-04T07:00:00', ROAD), p('2026-11-04T12:00:00', NEAR_NBI), p('2026-11-04T13:00:00', NEAR_NBI), p('2026-11-04T14:00:00', AWAY)], storages, byName, { from, to });
    expect(r.fulfilled).toBe(1);
  });
  it('finds pasted geofences by either name, and leaves what is none', () => {
    const list = customersIn(zones, storages);
    expect(matchGeofences(['jojac  investments', 'MENENGAI_FG:THANJU SHOP', 'Nowhere'], list)).toEqual({ names: [JOJAC, THANJU], rest: ['Nowhere'] });
  });
});

describe('the whole route against each stop', () => {
  const storages = findStorages({ type: 'FeatureCollection', features: [] });
  const SHOP = { lat: -0.5, lng: 35.5 };
  const pin = { name: 'Shop', ...SHOP, radiusM: 200 };
  const stop = pinStop(pin, storages);
  const t0 = Date.parse('2026-11-02T08:00:00+03:00');
  const min = 60_000;
  const window = { from: t0, to: t0 + 48 * 60 * min };
  const away = { lat: -0.52, lng: 35.5 };   // about 2.2 km south

  it('delivered: stood 1½ minutes within the distance', () => {
    const r = stopCheck([[{ t: t0, ...away }, { t: t0 + min, ...SHOP }, { t: t0 + 3 * min, ...SHOP }, { t: t0 + 4 * min, ...away }]], stop, window);
    expect(r.at).toBe(t0 + min);
    expect(stopWords(r)).toBe(`Delivered ${stamp(t0 + min).slice(11, 16)}`);
  });
  it('reached: drove through without stopping', () => {
    const r = stopCheck([[{ t: t0, ...away }, { t: t0 + min, ...SHOP }, { t: t0 + min + 30_000, ...away }]], stop, window);
    expect(r).toMatchObject({ at: null, reachedAt: t0 + min });
    expect(stopWords(r)).toMatch(/^Reached \d\d:\d\d, did not stop$/);
  });
  it('missed: how close it came, and when', () => {
    const r = stopCheck([[{ t: t0, lat: -0.6, lng: 35.5 }, { t: t0 + min, ...away }]], stop, window);
    expect(r).toMatchObject({ at: null, reachedAt: null, nearest: { t: t0 + min } });
    expect(stopWords(r)).toMatch(/^Not reached, closest 2\.2 km at /);
  });
  it('says so when there is nothing to read, rather than that it missed', () => {
    expect(stopWords(stopCheck([[]], stop, window))).toBe('No readings in the window');
  });
  it('puts the date on the time when the report spans days', () => {
    const r = stopCheck([[{ t: t0 + 26 * 60 * min, ...SHOP }, { t: t0 + 28 * 60 * min, ...SHOP }, { t: t0 + 29 * 60 * min, ...away }]], stop, window);
    expect(stopWords(r, true)).toBe('Delivered 03.11 10:00');
    expect(periodDays(window.from, window.to)).toBe('02.11.2026 to 04.11.2026');
  });
  it('takes the tracker that was there when a unit has two', () => {
    const dead = [{ t: t0, ...away }, { t: t0 + 10 * min, ...away }];
    const there = [{ t: t0 + min, ...SHOP }, { t: t0 + 3 * min, ...SHOP }, { t: t0 + 4 * min, ...away }];
    expect(stopCheck([dead, there], stop, window).at).toBe(t0 + min);
  });
  it('counts a delivery by a van never seen leaving MORL or the depot', () => {
    const route = [{ t: t0, ...away }, { t: t0 + min, ...SHOP }, { t: t0 + 3 * min, ...SHOP }, { t: t0 + 4 * min, ...away }];
    const r = deliveryRow({ plate: 'KDE 127E', customers: [], pins: [pin] }, route, storages, new Map(), { from: window.from, to: window.to });
    expect(r.trip.leftAt).toBeNull();
    expect([r.fulfilled, r.planned]).toEqual([1, 1]);
    expect(r.customers[0].label).toBe('Shop');
  });
  it('reads only the hours picked on each day, a stand not running across the night', () => {
    const day = (d, h, m = 0) => Date.parse(`2026-11-0${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
    const windows = [{ from: day(2, 7), to: day(2, 20) }, { from: day(3, 7), to: day(3, 20) }];
    const row = (route) => deliveryRow({ plate: 'KDE 127E', customers: [], pins: [pin] }, route, storages, new Map(), { from: windows[0].from, to: windows[1].to, windows }).customers[0];
    expect(row([{ t: day(2, 21), ...SHOP }, { t: day(2, 22), ...SHOP }, { t: day(2, 23), ...away }])).toMatchObject({ at: null, reachedAt: null, nearest: null });
    expect(row([{ t: day(2, 19, 59), ...SHOP }, { t: day(3, 7, 30), ...away }]).at).toBeNull();
    expect(row([{ t: day(2, 8), ...away }, { t: day(3, 9), ...SHOP }, { t: day(3, 9, 3), ...SHOP }, { t: day(3, 9, 4), ...away }])).toMatchObject({ at: day(3, 9), nearest: null });
  });
  it('sends only what the server names, the words included', () => {
    const route = [{ t: t0, ...away }];
    const r = deliveryRow({ plate: 'KDE 127E', customers: [], pins: [pin] }, route, storages, new Map(), { from: window.from, to: window.to });
    const c = deliveriesPdfBody([r], { from: window.from, at: window.to, fleet: 'M' }).rows[0].customers[0];
    expect(Object.keys(c).sort()).toEqual(['at', 'label', 'note']);
    expect(c.note).toMatch(/^Not reached, closest 2\.2 km at 02\.11 /);
  });
});
