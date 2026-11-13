import { describe, it, expect } from 'vitest';
import { listTest, vehicleOnSite, siteFleet, siteKind, keptByKind, kindPicker, unitSite, NAITIRI_ALL, NAITIRI_TRUCKS_ALL, SITE_LISTS, REPORT_SITES, SITE_KINDS } from './siteLists';
import { NAITIRI_TRUCKS, NAITIRI_UNITS } from '../data/naitiriUnits';

describe('Naitiri\'s units (operator, 12 Nov 2026)', () => {
  it('holds both of the client\'s lists', () => {
    expect(NAITIRI_TRUCKS).toHaveLength(55);
    expect(NAITIRI_ALL).toHaveLength(647);                 // each plate once
    expect(new Set(NAITIRI_ALL).size).toBe(NAITIRI_ALL.length);
  });
  it('finds a plate wherever the platform\'s name puts it, spaces aside', () => {
    const t = listTest(['KCY 523U', 'BCH 14591']);
    for (const n of ['KCY 523U', 'kcy523u', 'WKS - Naitiri - KCY 523U', 'KCY-523U / ZG 7017', 'BELL BCH14591']) expect(t.test(n)).toBe(true);
    for (const n of ['KCY 52', 'KCY 524U', 'Naitiri']) expect(t.test(n)).toBe(false);
  });
  it('a live unit by its plate, name or id', () => {
    expect(vehicleOnSite({ id: 'x1', name: 'WKS - KTCC 692E' }, 'NAITIRI')).toBe(true);
    expect(vehicleOnSite({ id: 'x2', regPlate: 'KCY 523U' }, 'NAITIRI_TRUCKS')).toBe(true);
    expect(vehicleOnSite({ id: 'x3', name: 'WKS - Magut - KDL 489D' }, 'NAITIRI')).toBe(false);
  });
});

describe('the report\'s title for the sites (operator, 12 Nov 2026)', () => {
  it('Naitiri for any of Naitiri\'s options alone; nothing to say otherwise', () => {
    expect(siteFleet(['NAITIRI'])).toBe('Naitiri');
    expect(siteFleet(['NAITIRI', 'NAITIRI_TRUCKS'])).toBe('Naitiri');
    expect(siteFleet(['NAITIRI', 'OLEPITO'])).toBeNull();
    expect(siteFleet([])).toBeNull();
  });
});

describe('siteKind: the kind on the client lists, for the Naitiri options', () => {
  it('names the kind from the lists, trucks list first', () => {
    expect(siteKind(['NAITIRI'], 'WKS - Naitiri - KCY 520U')).toBe('Trucks');
    expect(siteKind(['NAITIRI'], 'WKS - Naitiri - KCS 649Gl')).toBe('Trucks');
    expect(siteKind(['NAITIRI'], 'WKS - Naitiri - KTCC 646F')).toBe('Tractors');
    expect(siteKind(['NAITIRI'], 'WKS - Amuka- KCD 395D')).toBe('Light vehicles');
    expect(siteKind(['NAITIRI'], 'WKS - Winches-KTCC 450L')).toBe('Winches, Bell and shovels');
  });
  it('one Trucks rule: the trucks list and the Truck tab, in the kind and in "Naitiri trucks"', () => {
    expect(NAITIRI_TRUCKS_ALL).toHaveLength(58);
    for (const p of ['KBV 405X', 'KCJ 987A', 'KCJ 049H']) {
      expect(NAITIRI_TRUCKS).not.toContain(p);              // the Truck tab's three more
      expect(SITE_LISTS.NAITIRI_TRUCKS.test.test(`WKS - Naitiri - ${p}`)).toBe(true);
      expect(siteKind(['NAITIRI'], p)).toBe('Trucks');
    }
    expect(NAITIRI_UNITS.Truck.every((p) => SITE_LISTS.NAITIRI_TRUCKS.test.test(p))).toBe(true);
  });
  it('only for a unit the Ex sites picked hold', () => {
    // With "Naitiri trucks" and Sukari, a tractor on Naitiri's list keeps its own group
    expect(siteKind(['NAITIRI_TRUCKS', 'SUKARI'], 'KTCC 573E')).toBe(null);
    expect(siteKind(['NAITIRI_TRUCKS', 'SUKARI'], 'KCY 523U')).toBe('Trucks');
    expect(siteKind(['NAITIRI', 'SUKARI'], 'KTCC 573E')).toBe('Tractors');
  });
  it('leaves the group alone otherwise', () => {
    expect(siteKind(null, 'WKS - Naitiri - KCY 520U')).toBe(null);
    expect(siteKind(['OLEPITO'], 'WKS - Naitiri - KCY 520U')).toBe(null);
    expect(siteKind(['NAITIRI'], 'WKS - Naitiri - KAS 447G')).toBe(null);        // named Naitiri, on neither file
    expect(siteKind(['NAITIRI'], 'WKS - Kabras - KAA 111A')).toBe(null);
  });
});

describe("West Kenya's Site picker (operator, 12 Nov 2026)", () => {
  it("names the whole fleet first, then every site with units, Naitiri's lists among them", () => {
    expect(REPORT_SITES.WESTSUGAR.allWord).toBe('West Kenya');
    expect(REPORT_SITES.WESTSUGAR.keys.map((k) => SITE_LISTS[k].label)).toEqual([
      'Kabras', 'Olepito', 'Naitiri',
      'Amuka', 'Khalaba', 'Lake Agro', 'Magut', 'Misikhu', 'Nairobi', 'Selia',
    ]);
    expect(REPORT_SITES.SUKARI).toBeUndefined();
  });
  it("a named site by the unit's name, misspellings included, and titled by it", () => {
    expect(vehicleOnSite({ id: 'k', name: 'WKS - kabaras - KDE 321Q' }, 'KABRAS_SITE')).toBe(true);
    expect(vehicleOnSite({ id: 'm', name: 'WKS -Misikhu - KDL 607F' }, 'MISIKHU')).toBe(true);
    expect(vehicleOnSite({ id: 'm', name: 'WKS - Misikhu - KDL 607F' }, 'OLEPITO')).toBe(false);
    expect(siteFleet(['MISIKHU'])).toBe('Misikhu');
    expect(siteFleet(['KABRAS_SITE'])).toBe('Kabras');
  });
});

describe('SITE_KINDS', () => {
  it('Trucks first, then the assets file tabs', () => {
    expect(SITE_KINDS[0]).toBe('Trucks');
    expect(SITE_KINDS).toContain('Tractors');
    expect(SITE_KINDS).not.toContain('Truck');
  });
});

describe('Naitiri by unit type (operator, 13 Nov 2026: Naitiri and Trucks, not "Naitiri trucks")', () => {
  it('keeps only the types picked, among Naitiri units', () => {
    expect(keptByKind(['NAITIRI'], ['Trucks'], ['KCY 523U'])).toBe(true);
    expect(keptByKind(['NAITIRI'], ['Trucks'], ['KTCC 573E'])).toBe(false);   // a tractor
    expect(keptByKind(['NAITIRI'], ['Tractors'], ['KTCC 573E'])).toBe(true);
  });
  it('Naitiri and Trucks is exactly what "Naitiri trucks" was', () => {
    const plates = [...NAITIRI_ALL, 'KDW 548J', 'KMGJ 377W'];
    const viaType = plates.filter((p) => SITE_LISTS.NAITIRI.test.test(p) && keptByKind(['NAITIRI'], ['Trucks'], [p]));
    expect(new Set(viaType)).toEqual(new Set(NAITIRI_TRUCKS_ALL));
  });
  it('leaves every other unit alone, and everything while no type is picked', () => {
    expect(keptByKind(['NAITIRI', 'OLEPITO'], ['Trucks'], ['WKS - Olepito - KDE 1A'])).toBe(true);
    expect(keptByKind(['NAITIRI'], null, ['KTCC 573E'])).toBe(true);
  });
  it('offers the kinds, Trucks first, and needs one ticked', () => {
    const p = kindPicker(null, () => {});
    expect(p.options.map((o) => o.value)).toEqual(SITE_KINDS);
    expect(p.options[0].value).toBe('Trucks');
    expect(p.minOne).toBe(true);
  });
});

describe('unitSite: the site badge on the map (operator, 13 Nov 2026)', () => {
  it('names a West Kenya unit by its site', () => {
    expect(unitSite({ name: 'WKS - Olepito - KDA 123B' }, 'WESTSUGAR')).toBe('Olepito');
    expect(unitSite({ regPlate: 'KTCC 573E', name: 'KTCC573E' }, 'WESTSUGAR')).toBe('Naitiri');
  });
  it('lets the Excel files win over a name for another site', () => {
    expect(unitSite({ name: `WKS - Amuka - ${NAITIRI_TRUCKS[0]}` }, 'WESTSUGAR')).toBe('Naitiri');
  });
  it('is null for another organisation, and for a unit no site claims', () => {
    expect(unitSite({ name: 'WKS - Olepito - KDA 123B' }, 'MENENGAI')).toBeNull();
    expect(unitSite({ name: 'West Sugar - KZZ 999Z' }, 'WESTSUGAR')).toBeNull();
    expect(unitSite(null, 'WESTSUGAR')).toBeNull();
  });
});
