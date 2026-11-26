import { describe, it, expect } from 'vitest';
import { listOf, tagList, listView, withList, planList, plansOnList, judgedOnList } from './deliveriesLists';
import { addVehicle, setCustomers } from './deliveryPlan';
import { planStopChoices, stopsPicked } from './plannerReport';

// A Van Sales truck of Menengai's fleet list, with two trackers
const unit = { key: 'KDE268P', plate: 'KDE 268P', vehicles: [{ vehicleId: 'w1' }, { vehicleId: 'w2' }] };
const VS_STOPS = Array.from({ length: 11 }, (_, i) => `MENENGAI_VS: SHOP ${i + 1}`);
const FG_STOPS = ['MENENGAI_FG: NAIVAS NAKURU', 'MENENGAI_FG: QUICKMART NAIVASHA'];
const groupOf = (p) => ({ KDE268P: 'Van Sales', KCA224M: 'Finished Goods' }[String(p.plate).replace(/\s+/g, '').toUpperCase()] ?? null);
// The Planner's plans for the day: KDE 268P's Van Sales itinerary (11 stops), KCA 224M's sales sheet
const itinerary = { id: 'it1', plate: 'KDE 268P', source: 'itinerary', list: null };
const sheet = { id: 'sh1', plate: 'KCA 224M', source: 'sheet', list: null };

/** A report adding a unit and its stops, as DeliveriesReport does: on its own view, then merged back. */
const addOn = (full, list, u, stops) => {
  const mine = addVehicle(listView(full, list), u);
  return withList(full, list, setCustomers(mine, u.key, stops));
};

describe('a unit on Van Sales only', () => {
  const full = addOn({ vehicles: [] }, 'vs', unit, VS_STOPS);

  it('is on the VS list with its 11 stops, and not on FG', () => {
    expect(full.vehicles).toHaveLength(1);
    expect(listView(full, 'vs').vehicles[0]).toMatchObject({ key: 'KDE268P', list: 'vs', customers: VS_STOPS });
    expect(listView(full, 'fg').vehicles).toEqual([]);
  });

  it('VS reads its itinerary in its place; FG reads no plan for it', () => {
    expect(plansOnList([itinerary, sheet], 'vs', groupOf).map((p) => p.id)).toEqual(['it1']);
    expect(judgedOnList(listView(full, 'vs').vehicles, ['KDE 268P'])).toEqual([]);
    expect(plansOnList([itinerary], 'fg', groupOf)).toEqual([]);
  });
});

describe('a unit on Finished Goods only', () => {
  const fgUnit = { key: 'KCA224M', plate: 'KCA 224M', vehicles: [{ vehicleId: 'w3' }] };
  const full = addOn({ vehicles: [] }, 'fg', fgUnit, FG_STOPS);

  it('goes untagged on the FG list, as every list before the split', () => {
    expect(full.vehicles[0]).not.toHaveProperty('list');
    expect(listOf(full.vehicles[0])).toBe('fg');
    expect(listView(full, 'vs').vehicles).toEqual([]);
  });

  it('its own FG sales sheet still stands in for it on FG', () => {
    expect(plansOnList([itinerary, sheet], 'fg', groupOf).map((p) => p.id)).toEqual(['sh1']);
    expect(judgedOnList(listView(full, 'fg').vehicles, ['kca224m'])).toEqual([]);
    expect(judgedOnList(listView(full, 'fg').vehicles, [])).toHaveLength(1);
  });
});

describe('a unit on Van Sales, then added to Finished Goods (operator, 2026-11-25)', () => {
  const onVs = addOn({ vehicles: [] }, 'vs', unit, VS_STOPS);
  const both = addOn(onVs, 'fg', unit, FG_STOPS);

  it('keeps its VS entry and 11 stops as they were', () => {
    expect(listView(both, 'vs')).toEqual(listView(onVs, 'vs'));
  });

  it('has its own FG entry, with only the 2 FG stops', () => {
    const fg = listView(both, 'fg').vehicles;
    expect(fg).toHaveLength(1);
    expect(fg[0]).toMatchObject({ key: 'KDE268P', customers: FG_STOPS });
    expect(fg[0].customers.some((c) => VS_STOPS.includes(c))).toBe(false);
  });

  it('starts on FG with no stops: none come over from VS', () => {
    const added = withList(onVs, 'fg', addVehicle(listView(onVs, 'fg'), unit));
    expect(listView(added, 'fg').vehicles[0].customers).toEqual([]);
    expect(listView(added, 'vs').vehicles[0].customers).toEqual(VS_STOPS);
  });

  it('its VS itinerary neither ticks stops onto FG nor stands in for the FG line', () => {
    expect(plansOnList([itinerary], 'fg', groupOf)).toEqual([]);
    // The FG report's sheets are only those read on FG: the VS itinerary is not among them
    const fgSheetPlates = plansOnList([itinerary, sheet], 'fg', groupOf).map((p) => p.plate);
    expect(judgedOnList(listView(both, 'fg').vehicles, fgSheetPlates).map((v) => v.plate)).toEqual(['KDE 268P']);
    // ...while on VS the itinerary is still the unit's row, as before
    const vsSheetPlates = plansOnList([itinerary, sheet], 'vs', groupOf).map((p) => p.plate);
    expect(judgedOnList(listView(both, 'vs').vehicles, vsSheetPlates)).toEqual([]);
  });

  it('a change on FG leaves the VS entry alone, and taking it off FG leaves it on VS', () => {
    const fewer = withList(both, 'fg', setCustomers(listView(both, 'fg'), unit.key, [FG_STOPS[0]]));
    expect(listView(fewer, 'vs').vehicles[0].customers).toEqual(VS_STOPS);
    const off = withList(both, 'fg', { vehicles: [] });
    expect(off.vehicles).toEqual(listView(onVs, 'vs').vehicles);
  });

  it('an itinerary moved to FG in the Planner is read on FG', () => {
    expect(planList({ ...itinerary, list: 'fg' }, groupOf)).toBe('fg');
    expect(planList(itinerary, groupOf)).toBe('vs');
  });
});

describe('a Van Sales unit on Finished Goods, its FG routes picked from its VS itinerary (operator, 2026-11-25)', () => {
  // The VS itinerary's 11 stops, each a VS geofence, in route order
  const fc = { features: VS_STOPS.map((name, i) => ({ properties: { id: `g${i + 1}`, name } })) };
  const full11 = { stops: VS_STOPS.map((name, i) => ({ sequence: i + 1, customer: { name, geofenceId: `g${i + 1}`, lat: -0.3, lng: 36 + i / 100 } })).reverse() };
  const choices = planStopChoices(full11, fc, new Set(VS_STOPS));
  const onVs = addOn({ vehicles: [] }, 'vs', unit, VS_STOPS);
  const pick = [choices[2].key, choices[6].key];
  const { names, pins } = stopsPicked(choices, pick);
  const full = addOn(onVs, 'fg', unit, names);

  it('offers all 11 VS stops in route order, none ticked', () => {
    expect(choices.map((c) => c.label)).toEqual(VS_STOPS);
    expect(stopsPicked(choices, []).names).toEqual([]);
  });

  it('FG gets only the 2 routes picked', () => {
    expect(names).toEqual([VS_STOPS[2], VS_STOPS[6]]);
    expect(pins).toEqual([]);
    expect(listView(full, 'fg').vehicles[0].customers).toEqual([VS_STOPS[2], VS_STOPS[6]]);
  });

  it('VS keeps all 11 of its own, untouched', () => {
    expect(listView(full, 'vs').vehicles[0].customers).toEqual(VS_STOPS);
  });

  it('a stop with no geofence is offered as a point, and a fence passed twice once', () => {
    const plan = { stops: [
      { sequence: 1, customer: { name: VS_STOPS[0], geofenceId: 'g1', lat: -0.3, lng: 36 } },
      { sequence: 2, customer: { name: 'NEW DUKA', geofenceId: null, lat: -0.4, lng: 36.1 } },
      { sequence: 3, customer: { name: VS_STOPS[0], geofenceId: 'g1', lat: -0.3, lng: 36 } },
    ] };
    const c = planStopChoices(plan, fc, new Set(VS_STOPS));
    expect(c.map((x) => x.label)).toEqual([VS_STOPS[0], 'NEW DUKA']);
    expect(stopsPicked(c, [c[1].key])).toEqual({ names: [], pins: [{ name: 'NEW DUKA', lat: -0.4, lng: 36.1, radiusM: 100 }] });
  });
});

describe('tags', () => {
  it('VS carries the tag; FG drops one', () => {
    expect(tagList({ key: 'a', list: 'fg' }, 'vs')).toEqual({ key: 'a', list: 'vs' });
    expect(tagList({ key: 'a', list: 'vs' }, 'fg')).toEqual({ key: 'a' });
  });
});
