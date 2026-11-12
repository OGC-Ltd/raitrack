import { describe, it, expect } from 'vitest';
import { listTest, vehicleOnSite, mapSiteOptions, siteFleet, siteKind, NAITIRI_ALL } from './siteLists';
import { NAITIRI_TRUCKS } from '../data/naitiriUnits';
import { matchesTypeFilter } from './vehicleMap';

describe('Naitiri\'s units (operator, 12 Nov 2026)', () => {
  it('holds both of the client\'s lists', () => {
    expect(NAITIRI_TRUCKS).toHaveLength(55);
    expect(NAITIRI_ALL.length).toBeGreaterThan(640);
  });
  it('finds a plate wherever the platform\'s name puts it, spaces aside', () => {
    const t = listTest(['KCY 523U', 'BCH 14591']);
    for (const n of ['KCY 523U', 'kcy523u', 'WKS - Naitiri - KCY 523U', 'KCY-523U / ZG 7017', 'BELL BCH14591']) expect(t.test(n)).toBe(true);
    for (const n of ['KCY 52', 'KCY 524U', 'Naitiri']) expect(t.test(n)).toBe(false);
  });
  it('a live unit by its plate, name or id', () => {
    expect(vehicleOnSite({ id: 'x1', name: 'WKS - KTCC 692E' }, 'NAITIRI_EX')).toBe(true);
    expect(vehicleOnSite({ id: 'x2', regPlate: 'KCY 523U' }, 'NAITIRI_TRUCKS_EX')).toBe(true);
    expect(vehicleOnSite({ id: 'x3', name: 'WKS - Magut - KDL 489D' }, 'NAITIRI_EX')).toBe(false);
  });
  it('the pill: West Kenya only, with its count', () => {
    const vs = [{ id: 'a', name: 'KTCC 573E' }, { id: 'b', name: 'KCY 523U' }, { id: 'c', name: 'KDL 489D' }];
    expect(mapSiteOptions('WESTSUGAR', vs)).toEqual([{ kind: 'site:NAITIRI_EX', label: 'Naitiri', count: 2 }]);
    expect(mapSiteOptions('SUKARI', vs)).toEqual([]);
  });
  it('the map filter: the pill alone, and with a machine type', () => {
    const tractor = { id: 'a', name: 'KTCC 573E', vehicleType: 'Tractor' };
    const other = { id: 'c', name: 'KDL 489D', vehicleType: 'Tractor' };
    expect(matchesTypeFilter(tractor, ['site:NAITIRI_EX'])).toBe(true);
    expect(matchesTypeFilter(other, ['site:NAITIRI_EX'])).toBe(false);
    expect(matchesTypeFilter(other, [])).toBe(true);
  });
});

describe('the report\'s title for the sites (operator, 12 Nov 2026)', () => {
  it('Naitiri for any of Naitiri\'s options alone; nothing to say otherwise', () => {
    expect(siteFleet(['NAITIRI_EX'])).toBe('Naitiri');
    expect(siteFleet(['NAITIRI', 'NAITIRI_TRUCKS_EX'])).toBe('Naitiri');
    expect(siteFleet(['NAITIRI', 'KABRAS'])).toBeNull();
    expect(siteFleet([])).toBeNull();
  });
});

describe('siteKind: the kind on the client lists, for the Ex options', () => {
  it('names the kind from the lists, trucks list first', () => {
    expect(siteKind(['NAITIRI_EX'], 'WKS - Naitiri - KCY 520U')).toBe('Trucks');
    expect(siteKind(['NAITIRI_EX'], 'WKS - Naitiri - KCS 649Gl')).toBe('Trucks');
    expect(siteKind(['NAITIRI_EX'], 'WKS - Naitiri - KTCC 646F')).toBe('Tractors');
    expect(siteKind(['NAITIRI_EX'], 'WKS - Amuka- KCD 395D')).toBe('Light vehicles');
    expect(siteKind(['NAITIRI_EX'], 'WKS - Winches-KTCC 450L')).toBe('Winches, Bell and shovels');
  });
  it('leaves the group alone otherwise', () => {
    expect(siteKind(null, 'WKS - Naitiri - KCY 520U')).toBe(null);
    expect(siteKind(['NAITIRI'], 'WKS - Naitiri - KCY 520U')).toBe(null);
    expect(siteKind(['NAITIRI_EX'], 'WKS - Kabras - KAA 111A')).toBe(null);
  });
});
