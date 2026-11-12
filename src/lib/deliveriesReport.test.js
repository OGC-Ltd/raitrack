import { describe, it, expect } from 'vitest';
import { findStorages, storageAt, customersIn, tripOf, tripsOf, originOf, deliveryRun, backShort, runWords, matchGeofences, deliveries, deliveryRow, rowCells, csvTable, deliveriesPdfBody, stamp, notLeftWords, readOrders, stopCheck, stopWords, pinStop, periodDays, pinCode, fencedPinNames, dayRuns, daysFrom, plateWords } from './deliveriesReport';
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

  it('takes MORL as the Menengai yard geofence alone (operator, 12 Nov 2026)', () => {
    const m = storages.find((s) => s.key === 'morl');
    expect(m.feature.properties.name).toBe('Menengai Yard - Nakuru HQ');
    expect(m.name).toBe('geofence Menengai Yard - Nakuru HQ');
    const inside = { lat: -0.288 + 0.002, lng: 36.0449 };     // ~220 m off the point, in the yard
    const out = { lat: -0.288 + 0.0036, lng: 36.0449 };       // ~400 m off, out of the yard
    const trip = tripOf([p('2026-11-04T06:00:00', inside), p('2026-11-04T06:30:00', out), p('2026-11-04T09:00:00', ROAD)], storages, { to: at('2026-11-04T10:00:00') });
    expect(trip.leftFrom.label).toBe('MORL');
    expect(stamp(trip.leftAt)).toBe('04.11.2026 06:30:00');
  });
  it('MORL HOME counts as MORL too, beside the yard (operator, 12 Nov 2026)', () => {
    const home = sq('MORL HOME', MORL.lat - 0.006, MORL.lng, 0.002);   // south of the yard, ~670 m off the point
    const both = findStorages({ features: [home, ...zones.features] });
    const m = both.find((s) => s.key === 'morl');
    expect(m.name).toBe('geofences Menengai Yard - Nakuru HQ, MORL HOME');
    const inHome = { lat: MORL.lat - 0.006, lng: MORL.lng };
    const inYard = { lat: MORL.lat, lng: MORL.lng };
    const out = { lat: MORL.lat - 0.012, lng: MORL.lng };
    expect(storageAt(inHome, both)?.key).toBe('morl');
    expect(storageAt(inYard, both)?.key).toBe('morl');
    expect(storageAt(out, both)).toBeNull();
    // Alone, it is MORL; a fence that only begins "MORL" is not
    expect(findStorages({ features: [home] })[0].name).toBe('geofence MORL HOME');
    expect(findStorages({ features: [sq('MORL HOME YARD 2', 0, 37)] })[0].feature.geometry.type).toBe('Point');
  });
  it('inside Nakuru HQ is at the yard even where a fence is named MORL (operator, 12 Nov 2026: KBB 880A)', () => {
    const named = sq('MORL', MORL.lat + 0.01, MORL.lng, 0.001);         // a small "MORL" fence ~1 km off the yard
    const all = findStorages({ features: [named, sq('MORL HOME', MORL.lat - 0.006, MORL.lng, 0.002), ...zones.features] });
    expect(storageAt({ lat: MORL.lat, lng: MORL.lng }, all)?.key).toBe('morl');                 // Nakuru HQ
    expect(storageAt({ lat: MORL.lat + 0.01, lng: MORL.lng }, all)?.key).toBe('morl');          // MORL
    expect(storageAt({ lat: MORL.lat - 0.006, lng: MORL.lng }, all)?.key).toBe('morl');         // MORL HOME
    // and its trip ends there, from its own readings alone
    const trip = tripOf([p('2026-11-11T05:00:00', MORL), p('2026-11-11T06:14:10', ROAD), p('2026-11-12T09:30:00', MORL)], all,
      { from: at('2026-11-11T00:00:00'), to: at('2026-11-11T23:59:59'), upTo: at('2026-11-12T18:00:00') });
    expect(trip.arrivedAt).toBe(at('2026-11-12T09:30:00'));
  });
  it('without the yard geofence, MORL is 500 m round its Logistics point', () => {
    const m = findStorages(null).find((s) => s.key === 'morl');
    expect(m.feature.geometry.coordinates).toEqual([36.04494759379902, -0.28802969095623043]);
    expect(m.feature.properties.radiusM).toBe(500);
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
    expect(notLeftWords(tripOf([p('2026-11-04T06:00:00', MORL), p('2026-11-04T09:00:00', MORL)], storages, { to: at('2026-11-04T10:00:00') }))).toBe('At MORL');
    expect(notLeftWords(tripOf([p('2026-11-04T06:00:00', ROAD)], storages, { to: at('2026-11-04T10:00:00') }))).toBe('Not at MORL/STO in 10 days');
  });

  it('trusts Movements for where the vehicle is now: a quiet tracker at MORL is at MORL', () => {
    const plan = { plate: 'KDE 127E', customers: [] };
    const quiet = deliveryRow(plan, [p('2026-11-01T06:00:00', ROAD)], storages, byName, { to: at('2026-11-04T17:00:00'), atMorl: true });
    expect(rowCells(quiet)[1]).toBe('At MORL');
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
    expect(csvTable([r]).body[0].slice(-2)).toEqual(['Jojac Investments 06:00', expect.stringMatching(/^Thanju Shop \(Not reached, closest /)]);
    const body = deliveriesPdfBody([r], { from: at('2026-10-30T07:00:00'), at: at('2026-10-30T10:00:00'), fleet: 'Menengai Oil Refineries Ltd' });
    expect(body).toMatchObject({ fleet: 'Menengai Oil Refineries Ltd', group: 'all', stops: true });
    expect(body.rows[0]).toMatchObject({ plate: 'KCP 136P', fulfilled: 1, planned: 2, place: 'Thanju', notLeft: null, arrivedAt: null, arrivedTo: null });
    expect(body.rows[0].leftFrom).toEqual({ short: 'MORL', label: 'MORL' });
    expect(body.rows[0].customers.map((c) => c.label)).toEqual(['Jojac Investments', 'Thanju Shop']);
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
    expect(rowCells(r)[1]).toBe('At MORL');
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
    // The stand rule, with the temporary pass rule (PASS_COUNTS) off
    const strict = { from, to, passCounts: false };
    expect(stopCheck([drive], town, strict)).toMatchObject({ at: null, reachedAt: from });
    const stand = [0, 1, 2, 3].map((m) => ({ t: from + m * 60_000, ...A, speedKmh: m === 3 ? 30 : 0 }));
    expect(stopCheck([stand], town, strict).at).toBe(from);
    const crawl = [{ t: from, ...A, speedKmh: 0 }, { t: from + 30_000, ...A, speedKmh: 40 }, { t: from + 60_000, ...A, speedKmh: 0 }, { t: from + 90_000, ...A, speedKmh: 40 }];
    expect(stopCheck([crawl], town, strict).at).toBeNull();
    // Temporary (operator, 11 Nov 2026): driving through counts
    expect(stopCheck([drive], town, { from, to }).at).toBe(from);
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
  it('reached: drove through without stopping (stand rule, pass rule off)', () => {
    const r = stopCheck([[{ t: t0, ...away }, { t: t0 + min, ...SHOP }, { t: t0 + min + 30_000, ...away }]], stop, { ...window, passCounts: false });
    expect(r).toMatchObject({ at: null, reachedAt: t0 + min });
    expect(stopWords(r)).toMatch(/^Reached \d\d:\d\d, did not stop$/);
  });
  it('temporary: driving through the stop counts as delivered', () => {
    const r = stopCheck([[{ t: t0, ...away }, { t: t0 + min, ...SHOP }, { t: t0 + min + 30_000, ...away }]], stop, window);
    expect(r).toMatchObject({ at: t0 + min, reachedAt: t0 + min, nearest: null });
    expect(stopWords(r)).toBe(`Delivered ${stamp(t0 + min).slice(11, 16)}`);
  });
  it('temporary: passing within 100 m counts, 230 m does not', () => {
    const small = pinStop({ name: 'Kiosk', ...SHOP, radiusM: 50 }, storages);
    const near = { lat: SHOP.lat - 0.00072, lng: SHOP.lng };   // about 80 m
    const far = { lat: SHOP.lat - 0.00207, lng: SHOP.lng };    // about 230 m
    expect(stopCheck([[{ t: t0, ...away }, { t: t0 + min, ...near, speedKmh: 60 }, { t: t0 + 2 * min, ...away }]], small, window).at).toBe(t0 + min);
    const missed = stopCheck([[{ t: t0, ...away }, { t: t0 + min, ...far, speedKmh: 60 }, { t: t0 + 2 * min, ...away }]], small, window);
    expect(missed.at).toBeNull();
    expect(stopWords(missed)).toMatch(/^Not reached, closest 230 m/);
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
    // A single reading there at 19:59 counts under the temporary pass rule
    expect(row([{ t: day(2, 19, 59), ...SHOP }, { t: day(3, 7, 30), ...away }]).at).toBe(day(2, 19, 59));
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

describe('a hand-listed vehicle: when it left the customer (operator, 11 Nov 2026)', () => {
  it('reached 08:49, gone by the next reading away, back at MORL after', async () => {
    const { deliveryRow, findStorages, pinStop } = await import('./deliveriesReport');
    const storages = findStorages(null);
    const t = (hm) => Date.parse(`2026-11-11T${hm}:00+03:00`);
    const shop = { lat: -0.30, lng: 36.10 };
    const pin = { name: 'MOONLIGHT EXPRESS', ...shop, radiusM: 50 };
    const MORL = { lat: -0.28802969095623043, lng: 36.04494759379902 };
    const p = (hm, at, kmh = 30) => ({ t: t(hm), lat: at.lat, lng: at.lng, speedKmh: kmh });
    const pings = [p('06:00', MORL, 0), p('06:30', MORL, 0), p('08:38', { lat: -0.29, lng: 36.07 }), p('08:49', shop, 0), p('08:51', shop, 0),
      p('08:55', { lat: -0.302, lng: 36.103 }), p('10:00', { lat: -0.29, lng: 36.07 }), p('14:27', MORL, 0), p('14:50', MORL, 0)];
    const r = deliveryRow({ plate: 'KDM 138L', customers: [], pins: [pin] }, pings, storages, new Map(), { from: t('07:00'), to: t('16:00') });
    const c = r.customers[0];
    expect(c.at).toBe(t('08:49'));
    expect(c.leftAt).toBe(t('08:55'));
    expect(pinStop(pin).label).toBe('MOONLIGHT EXPRESS');
  });
});

describe('a delivery sheet into one vehicle’s stops (Import from Excel)', async () => {
  const { sheetStops } = await import('./deliveriesReport');
  const fences = [{ name: 'MENENGAI_VS: JOJAC INVESTMENTS' }, { name: 'Naivas Nakuru' }];
  const preview = {
    header: { plate: 'KDE 128E', planDate: '2026-11-09' },
    stops: [
      { sequence: 1, customerCode: 'C1', customerName: 'MAGUNA ANDU', lat: -0.0951, lng: 36.1271, keptPoint: null, fenceName: null },
      { sequence: 2, customerCode: 'C2', customerName: 'RAFIKI', lat: null, lng: null, keptPoint: { lat: -0.3, lng: 36.07 }, fenceName: null },
      { sequence: 3, customerCode: 'C3', customerName: 'JOJAC INVESTMENTS', lat: null, lng: null, keptPoint: null, fenceName: null },
      { sequence: 4, customerCode: 'C4', customerName: 'NAKURU SHOP', lat: null, lng: null, keptPoint: null, fenceName: 'Naivas Nakuru' },
      { sequence: 5, customerCode: 'C5', customerName: 'UNKNOWN DUKA', lat: null, lng: null, keptPoint: null, fenceName: null },
    ],
  };
  it('a point on the sheet, or the customer’s kept point, is a pin; else its geofence; the rest are named', () => {
    const r = sheetStops(preview, fences, 200);
    expect(r.pins).toEqual([
      { name: 'MAGUNA ANDU', lat: -0.0951, lng: 36.1271, radiusM: 200 },
      { name: 'RAFIKI', lat: -0.3, lng: 36.07, radiusM: 200 },
    ]);
    expect(r.names).toEqual(['MENENGAI_VS: JOJAC INVESTMENTS', 'Naivas Nakuru']);
    expect(r.unplaced).toEqual(['UNKNOWN DUKA']);
    expect(r).toMatchObject({ plate: 'KDE 128E', planDate: '2026-11-09' });
  });
  it('a radius out of range is held to the paste box’s limits', () => {
    expect(sheetStops(preview, fences, 'x').pins[0].radiusM).toBeGreaterThan(0);
    expect(sheetStops({ stops: [] }, fences).pins).toEqual([]);
  });
});

describe('a pasted point fenced in the Planner (operator, 12 Nov 2026)', () => {
  const pin = { name: '', lat: 0.0107497411311564, lng: 37.07514009999999, radiusM: 100 };
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'f1', name: 'Kamau Stores' }, geometry: null }] };

  it('keys the point as the server does', () => {
    expect(pinCode(pin)).toBe('PIN:0.01075,37.07514');
  });

  it('takes the fence’s current name, else the customer’s; unfenced and non-point customers are left out', () => {
    const names = fencedPinNames([
      { customerCode: 'PIN:0.01075,37.07514', name: 'old name', geofenceId: 'f1' },
      { customerCode: 'PIN:-1.00000,36.00000', name: 'Gone Fence Shop', geofenceId: 'f9' },
      { customerCode: 'PIN:-2.00000,36.00000', name: '-2.00000, 36.00000', geofenceId: null },
      { customerCode: '10023', name: 'Sheet customer', geofenceId: 'f1' },
    ], fc);
    expect([...names]).toEqual([['PIN:0.01075,37.07514', 'Kamau Stores'], ['PIN:-1.00000,36.00000', 'Gone Fence Shop']]);
  });

  it('the report names the stop by its fence, before the name pasted with it', () => {
    const names = new Map([['PIN:0.01075,37.07514', 'Kamau Stores']]);
    expect(pinStop(pin, [], names).label).toBe('Kamau Stores');
    expect(pinStop({ ...pin, name: 'pasted' }, [], names).label).toBe('Kamau Stores');
    expect(pinStop({ ...pin, name: 'pasted' }).label).toBe('pasted');
    expect(pinStop(pin).label).toBe('0.01075, 37.07514');
    const r = deliveryRow({ plate: 'X', customers: [], pins: [pin] }, [], findStorages(null), new Map(), { to: Date.now(), pinNames: names });
    expect(r.customers[0].label).toBe('Kamau Stores');
  });
});

describe('a range of days: every day with its own list and hours (operator, 12 Nov 2026)', () => {
  const KCA = { key: 'kca', plate: 'KCA 226M', customers: ['MENENGAI_VS: JOJAC INVESTMENTS'] };
  const KDE = { key: 'kde', plate: 'KDE 136E', customers: ['MENENGAI_FG:THANJU SHOP'] };
  const lists = { '2026-11-11': [KCA], '2026-11-12': [KCA, KDE] };
  const sel = { mode: 'days', fromDay: '2026-11-11', toDay: '2026-11-12', start: 7, end: 20 };

  it('11/11 to 12/11 is both days, each its own hours, the last day included', () => {
    const runs = dayRuns(sel, lists, { today: '2026-11-12', now: at('2026-11-12T23:00:00') });
    expect(runs.map((r) => [r.day, r.from, r.to, r.vehicles.map((v) => v.plate)])).toEqual([
      ['2026-11-11', at('2026-11-11T07:00:00'), at('2026-11-11T20:00:00'), ['KCA 226M']],
      ['2026-11-12', at('2026-11-12T07:00:00'), at('2026-11-12T20:00:00'), ['KCA 226M', 'KDE 136E']],
    ]);
  });

  it('whole days run midnight to midnight in Nairobi time, not UTC', () => {
    const runs = dayRuns({ ...sel, start: 0, end: 24 }, lists, { today: '2026-11-13', now: at('2026-11-13T08:00:00') });
    expect(runs.map((r) => [r.from, r.to])).toEqual([
      [Date.parse('2026-11-10T21:00:00Z'), Date.parse('2026-11-11T21:00:00Z')],
      [Date.parse('2026-11-11T21:00:00Z'), Date.parse('2026-11-12T21:00:00Z')],
    ]);
  });

  it('today ends at now, and a day whose hours have not begun is left out', () => {
    const now = at('2026-11-12T10:30:00');
    expect(dayRuns(sel, lists, { today: '2026-11-12', now }).map((r) => [r.day, r.to]))
      .toEqual([['2026-11-11', at('2026-11-11T20:00:00')], ['2026-11-12', now]]);
    expect(dayRuns(sel, lists, { today: '2026-11-12', now: at('2026-11-12T06:59:00') }).map((r) => r.day)).toEqual(['2026-11-11']);
  });

  it('a longer range: seven days across a month end, empty days kept as days with no vehicles', () => {
    const runs = dayRuns({ ...sel, fromDay: '2026-10-30', toDay: '2026-11-05' }, { '2026-11-01': [KDE] }, { today: '2026-11-12', now: at('2026-11-12T12:00:00') });
    expect(runs.map((r) => r.day)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(runs.map((r) => r.vehicles.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(daysFrom('2026-11-11', '2026-11-12')).toEqual(['2026-11-11', '2026-11-12']);
    expect(daysFrom('2026-11-12', '2026-11-11')).toEqual([]);
  });

  it('the last hours: one run with today\u2019s list', () => {
    const now = at('2026-11-12T10:00:00');
    expect(dayRuns({ mode: 'last', hours: 2 }, lists, { today: '2026-11-12', now }))
      .toEqual([{ day: '2026-11-12', from: now - 2 * 3_600_000, to: now, vehicles: [KCA, KDE] }]);
  });

  it('each day\u2019s row counts only that day\u2019s delivery; the edges of the hours hold', () => {
    const storages = findStorages(zones);
    const byName = new Map(customersIn(zones, storages).map((c) => [c.name, c]));
    const pings = [
      p('2026-11-11T05:00:00', MORL), p('2026-11-11T06:30:00', ROAD),
      p('2026-11-11T06:58:00', A), p('2026-11-11T06:59:30', A),            // before 07:00 on the 11th: not that day's
      p('2026-11-11T07:30:00', ROAD), p('2026-11-11T09:00:00', MORL), p('2026-11-12T06:00:00', MORL),
      p('2026-11-12T08:00:00', ROAD), p('2026-11-12T19:58:00', A), p('2026-11-12T19:59:59', A), // just inside 20:00 on the 12th
      p('2026-11-12T21:00:00', MORL),
    ];
    const rows = dayRuns(sel, lists, { today: '2026-11-12', now: at('2026-11-12T23:00:00') })
      .flatMap((run) => run.vehicles.filter((v) => v.key === 'kca').map((v) => ({ day: run.day,
        row: deliveryRow(v, pings, storages, byName, { from: run.from, to: run.to, windows: [{ from: run.from, to: run.to }] }) })));
    expect(rows.map((x) => [x.day, x.row.fulfilled, x.row.planned])).toEqual([['2026-11-11', 0, 1], ['2026-11-12', 1, 1]]);
  });

  it('KDE 141E (12 Nov): set out from the depot it was at when the day began, not the first one read', () => {
    const storages = findStorages(zones);
    const byName = new Map(customersIn(zones, storages).map((c) => [c.name, c]));
    const AWAY = { lat: -1.2, lng: 36.7 };
    // Its real route: MORL to the Nairobi depot on the 9th, back to MORL on the 10th, out of MORL on the 12th
    const pings = [
      p('2026-11-09T00:00:00', MORL), p('2026-11-09T05:00:00', MORL), p('2026-11-09T05:07:00', ROAD),
      p('2026-11-09T09:22:00', NBI), p('2026-11-10T06:00:00', NBI), p('2026-11-10T06:22:00', AWAY),
      p('2026-11-10T16:15:00', NBI), p('2026-11-10T17:00:00', NBI), p('2026-11-10T17:23:00', ROAD),
      p('2026-11-10T21:32:00', MORL), p('2026-11-11T12:00:00', MORL), p('2026-11-12T04:00:00', MORL),
      p('2026-11-12T04:23:00', ROAD), p('2026-11-12T09:00:00', A), p('2026-11-12T09:05:00', A), p('2026-11-12T10:00:00', ROAD),
    ];
    const from = at('2026-11-12T00:00:00');
    const to = at('2026-11-12T12:00:00');
    expect(originOf(pings, storages, { to }).key).toBe('morl');                // the first stay read: also MORL here
    expect(originOf(pings.slice(3), storages, { to }).key).toBe('nairobi');    // read from the 9th's depot onwards…
    expect(originOf(pings.slice(3), storages, { to, from }).key).toBe('morl'); // …but the 12th began at MORL
    const row = deliveryRow({ plate: 'KDE 141E', customers: ['MENENGAI_VS: JOJAC INVESTMENTS'] }, pings.slice(3), storages, byName, { from, to, windows: [{ from, to }] });
    expect(stamp(row.trip.leftAt)).toBe('12.11.2026 04:23:00');
    expect(row.trip.leftFrom.key).toBe('morl');
    expect(row.fulfilled).toBe(1);
    // On the 10th it set out from the Nairobi depot and came back there
    const day10 = deliveryRow({ plate: 'KDE 141E', customers: [] }, pings.slice(3), storages, byName,
      { from: at('2026-11-10T00:00:00'), to: at('2026-11-10T20:00:00'), windows: [{ from: at('2026-11-10T00:00:00'), to: at('2026-11-10T20:00:00') }] });
    expect([stamp(day10.trip.leftAt), day10.trip.leftFrom.key, stamp(day10.trip.arrivedAt)]).toEqual(['10.11.2026 06:22:00', 'nairobi', '10.11.2026 16:15:00']);
  });

  it('a row of a range says its day beside the plate, on screen, CSV and PDF', () => {
    const r = { plate: 'KCA 226M', day: '2026-11-12', trip: { leftAt: null }, fulfilled: 0, planned: 1, customers: [] };
    expect(plateWords(r)).toBe('KCA 226M (12.11.2026)');
    expect(rowCells(r)[0]).toBe('KCA 226M (12.11.2026)');
    expect(deliveriesPdfBody([r], { from: at('2026-11-11T07:00:00'), at: at('2026-11-12T20:00:00'), fleet: 'Menengai' }).rows[0].plate).toBe('KCA 226M (12.11.2026)');
    expect(plateWords({ plate: 'KCA 226M' })).toBe('KCA 226M');
  });
});

describe('a trip in the window, back at the yard after it (operator, 12 Nov 2026)', () => {
  it('reads the return past the window\'s end when told to', async () => {
    const { deliveryRow, findStorages, MORL_POINT } = await import('./deliveriesReport');
    const storages = findStorages(null);
    const t = (d, hm) => Date.parse(`2026-11-${d}T${hm}:00+03:00`);
    const p = (d, hm, at, kmh = 40) => ({ t: t(d, hm), lat: at.lat, lng: at.lng, speedKmh: kmh });
    const away = { lat: -0.20, lng: 35.90 };
    const pings = [p('11', '03:00', MORL_POINT, 0), p('11', '03:40', MORL_POINT, 0), p('11', '04:11', { lat: -0.27, lng: 36.02 }),
      p('11', '12:00', away), p('11', '19:00', away), p('11', '21:40', MORL_POINT, 0), p('11', '22:30', MORL_POINT, 0)];
    const opts = { from: t('11', '07:00'), to: t('11', '20:00') };
    expect(deliveryRow({ plate: 'KCA 226M', customers: [] }, pings, storages, new Map(), opts).trip.arrivedAt).toBeNull();
    const row = deliveryRow({ plate: 'KCA 226M', customers: [] }, pings, storages, new Map(), { ...opts, upTo: t('12', '13:00') });
    expect(row.trip.arrivedAt).toBe(t('11', '21:40'));
  });
});

