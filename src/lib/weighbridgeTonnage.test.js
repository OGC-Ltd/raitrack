import { describe, it, expect } from 'vitest';
import { creditTonnage, ticketLoad, withWeighbridgeTonnes, nameWords } from './weighbridgeTonnage';

const H = 3_600_000;
const T0 = Date.parse('2026-10-20T06:00:00+03:00');
const iso = (t) => new Date(t).toISOString();

const drivers = [
  { id: 'd1', fullName: 'CALVIN LESOIYAN LENASO' },
  { id: 'd2', fullName: 'Denish Onyango Mangila' },
  { id: 'd3', fullName: 'Peter Otieno' },
  { id: 'd4', fullName: 'Peter Otieno' },     // a second Peter Otieno
];
const trips = [
  { id: 't1', driverId: 'd1', vehicleId: 'v715', plate: 'KDL 715E', from: T0, to: T0 + 6 * H },
  { id: 't2', driverId: 'd1', vehicleId: 'v715', plate: 'KDL 715E', from: T0 + 24 * H, to: T0 + 30 * H },
  { id: 't3', driverId: 'd2', vehicleId: 'v240', plate: 'KDL 240X', from: T0, to: T0 + 5 * H },
];
const ticket = (o) => ({
  id: o.id, token: o.id, tokenAt: iso(o.at), tareAt: iso(o.at - 0.5 * H), grossAt: iso(o.at),
  vehicleId: o.vid ?? null, vehiclePlate: o.plate, driverName: o.driver ?? '', netWeightKg: o.net ?? null,
  factoryNetWeightKg: o.fnet ?? null, centerName: o.centre ?? 'Naitiri',
});

describe('ticketLoad', () => {
  it('uses the mill net when the load reached the mill, else the outstation net', () => {
    expect(ticketLoad(ticket({ id: 'a', at: T0, plate: 'X', net: 21000, fnet: 20500 }))).toMatchObject({ kg: 20500, toMill: true });
    expect(ticketLoad(ticket({ id: 'b', at: T0, plate: 'X', net: 21000 }))).toMatchObject({ kg: 21000, toMill: false });
  });
  it('a ticket with no net weight, or an impossible one, is not a load', () => {
    expect(ticketLoad(ticket({ id: 'c', at: T0, plate: 'X' }))).toBeNull();
    expect(ticketLoad(ticket({ id: 'd', at: T0, plate: 'X', net: 250000 }))).toBeNull();
  });
});

describe('nameWords', () => {
  it('drops initials and punctuation', () => {
    expect(nameWords('C. Lesoiyan-Lenaso')).toEqual(['LESOIYAN', 'LENASO']);
  });
});

describe('creditTonnage', () => {
  const tickets = [
    // during trip t1, by vehicle id, name spelt differently but sharing a word
    ticket({ id: 'k1', at: T0 + 2 * H, vid: 'v715', plate: 'KDL715E', driver: 'Calvin Lenaso', net: 22000, fnet: 21500 }),
    // during trip t2, matched by plate only (no vehicle id on the ticket)
    ticket({ id: 'k2', at: T0 + 25 * H, plate: 'KDL715E', driver: 'CALVIN', net: 19000 }),
    // just after trip t3 ends (inside the slack)
    ticket({ id: 'k3', at: T0 + 6 * H, vid: 'v240', plate: 'KDL240X', driver: 'Denish Mangila', net: 18000 }),
    // KDL 715E during t1 but the ticket names somebody else entirely: set aside
    ticket({ id: 'k4', at: T0 + 3 * H, vid: 'v715', plate: 'KDL715E', driver: 'John Kamau', net: 20000 }),
    // no trip at that time: matched by the name on the ticket
    ticket({ id: 'k5', at: T0 + 80 * H, vid: 'v999', plate: 'KCA1A', driver: 'denish  onyango MANGILA', net: 15000 }),
    // no trip, and the name belongs to two drivers: matched to nobody
    ticket({ id: 'k6', at: T0 + 80 * H, plate: 'KCA2B', driver: 'Peter Otieno', net: 14000 }),
    // duplicate of k1
    ticket({ id: 'k1', at: T0 + 2 * H, vid: 'v715', plate: 'KDL715E', driver: 'Calvin Lenaso', net: 22000, fnet: 21500 }),
    // not weighed out yet
    ticket({ id: 'k7', at: T0 + 2 * H, vid: 'v240', plate: 'KDL240X', driver: 'Denish' }),
  ];
  const c = creditTonnage({ tickets, trips, drivers });

  it('credits each ticket once, by the trip the truck was on', () => {
    expect(c.byDriver.get('d1').kg).toBe(21500 + 19000);
    expect(c.byDriver.get('d1').loads.map((l) => [l.tripId, l.via])).toEqual([['t1', 'trip'], ['t2', 'trip']]);
    expect(c.byDriver.get('d2').loads.map((l) => l.via)).toEqual(['trip', 'name']);
    expect(c.byDriver.get('d2').kg).toBe(18000 + 15000);
  });
  it('sets aside a ticket naming a different driver from the trip', () => {
    expect(c.review.map((r) => r.id)).toEqual(['k4']);
  });
  it('a name shared by two drivers matches nobody', () => {
    expect(c.byDriver.has('d3')).toBe(false);
    expect(c.byDriver.has('d4')).toBe(false);
  });
  it('counts what happened', () => {
    expect(c.stats).toEqual({ tickets: 6, viaTrip: 3, viaName: 1, unmatched: 1, review: 1 });
  });
  it('files each load under the fleet day it was weighed, not the day its trip began', () => {
    const long = [{ id: 'w', driverId: 'd1', vehicleId: 'v715', plate: 'KDL 715E', from: T0, to: T0 + 72 * H }];
    const c2 = creditTonnage({
      tickets: [
        ticket({ id: 'p', at: T0 + 2 * H, vid: 'v715', plate: 'KDL715E', net: 20000 }),
        ticket({ id: 'q', at: T0 + 49 * H, vid: 'v715', plate: 'KDL715E', net: 21000 }),
        // 23:30 EAT on the 20th is still the 20th, though it is the 20th 20:30 UTC
        ticket({ id: 'r', at: Date.parse('2026-10-20T23:30:00+03:00'), vid: 'v715', plate: 'KDL715E', net: 19000 }),
      ],
      trips: long, drivers,
    });
    expect(c2.byDriver.get('d1').loads.map((l) => l.day)).toEqual(['2026-10-20', '2026-10-22', '2026-10-20']);
  });
});

describe('withWeighbridgeTonnes', () => {
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const overview = {
    drivers: [
      { id: 'd2', fullName: 'Denish', tonnes: 0, trips: 1 },
      { id: 'd1', fullName: 'Calvin', tonnes: 29, trips: 2 },   // 29 t typed on a sales run
      { id: 'd9', fullName: 'Nobody', tonnes: 5, trips: 1 },
    ],
    details: {
      d1: { driver: { id: 'd1' }, totals: { tonnes: 29, trips: 2 }, heaviestLoad: { tonnes: 29, date: '2026-10-01', route: 'Raiply' },
            byDay: [{ day: day(T0), tonnes: 0, mileageKm: 120 }, { day: day(T0 + 24 * H), tonnes: 0, mileageKm: 110 }] },
      d2: { driver: { id: 'd2' }, totals: { tonnes: 0, trips: 1 }, heaviestLoad: null, byDay: [{ day: day(T0), tonnes: 0, mileageKm: 90 }] },
    },
  };
  const credit = creditTonnage({
    tickets: [
      ticket({ id: 'a', at: T0 + 2 * H, vid: 'v715', plate: 'KDL715E', driver: 'Calvin', net: 22000, fnet: 21500 }),
      ticket({ id: 'b', at: T0 + 25 * H, vid: 'v715', plate: 'KDL715E', driver: 'Calvin', net: 19000 }),
      ticket({ id: 'c', at: T0 + 2 * H, vid: 'v240', plate: 'KDL240X', driver: 'Denish', net: 31000 }),
    ],
    trips, drivers,
  });
  const out = withWeighbridgeTonnes(overview, credit);

  it('adds the weighbridge tonnes to the typed tonnes, roster and detail alike', () => {
    const d1 = out.drivers.find((d) => d.id === 'd1');
    expect(d1.tonnes).toBe(69.5);
    expect(out.details.d1.totals).toMatchObject({ tonnes: 69.5, weighbridgeTonnes: 40.5, weighbridgeLoads: 2 });
    expect(out.details.d1.byDay.map((d) => d.tonnes)).toEqual([21.5, 19]);
    expect(out.details.d1.byDay[0].mileageKm).toBe(120);
  });
  it('each day lists its loads and where they were weighed, for the bar hover', () => {
    expect(out.details.d1.byDay[0].loads).toEqual([{ tonnes: 21.5, where: 'Naitiri', toMill: true, at: T0 + 2 * H, token: 'a' }]);
    expect(out.details.d2.byDay[0].loads.map((l) => [l.where, l.tonnes])).toEqual([['Naitiri', 31]]);
  });
  it('the table row and the panel count the same loads, even one after the latest trip', () => {
    const late = creditTonnage({
      tickets: [
        ticket({ id: 'a', at: T0 + 2 * H, vid: 'v715', plate: 'KDL715E', driver: 'Calvin', net: 22000 }),
        // weighed four days after the last trip: no trip, matched by the full name
        ticket({ id: 'z', at: T0 + 100 * H, vid: 'v715', plate: 'KDL715E', driver: 'Calvin Lesoiyan Lenaso', net: 20000 }),
      ],
      trips, drivers,
    });
    const o = withWeighbridgeTonnes(overview, late);
    const row = o.drivers.find((d) => d.id === 'd1');
    expect(row.tonnes).toBe(71);
    expect(o.details.d1.totals.tonnes).toBe(row.tonnes);
    expect(o.details.d1.totals).toMatchObject({ weighbridgeTonnes: 42, weighbridgeLoads: 2 });
  });
  it('the heaviest load moves only when a ticket beats it', () => {
    expect(out.details.d1.heaviestLoad.tonnes).toBe(29);
    expect(out.details.d2.heaviestLoad).toMatchObject({ tonnes: 31, route: 'Weighed at Naitiri' });
  });
  it('re-sorts the roster by tonnes and leaves drivers without tickets alone', () => {
    expect(out.drivers.map((d) => d.id)).toEqual(['d1', 'd2', 'd9']);
    expect(out.drivers[2]).toBe(overview.drivers[2]);
  });
  it('no credit changes nothing', () => {
    expect(withWeighbridgeTonnes(overview, null)).toBe(overview);
  });
});
