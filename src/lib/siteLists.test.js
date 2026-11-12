import { describe, it, expect } from 'vitest';
import { listTest, vehicleOnSite, siteFleet, siteKind, NAITIRI_ALL, NAITIRI_TRUCKS_ALL, SITE_LISTS } from './siteLists';
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
    expect(vehicleOnSite({ id: 'x1', name: 'WKS - KTCC 692E' }, 'NAITIRI_EX')).toBe(true);
    expect(vehicleOnSite({ id: 'x2', regPlate: 'KCY 523U' }, 'NAITIRI_TRUCKS_EX')).toBe(true);
    expect(vehicleOnSite({ id: 'x3', name: 'WKS - Magut - KDL 489D' }, 'NAITIRI_EX')).toBe(false);
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
  it('one Trucks rule: the trucks list and the Truck tab, in the kind and in "Naitiri trucks Ex"', () => {
    expect(NAITIRI_TRUCKS_ALL).toHaveLength(58);
    for (const p of ['KBV 405X', 'KCJ 987A', 'KCJ 049H']) {
      expect(NAITIRI_TRUCKS).not.toContain(p);              // the Truck tab's three more
      expect(SITE_LISTS.NAITIRI_TRUCKS_EX.test.test(`WKS - Naitiri - ${p}`)).toBe(true);
      expect(siteKind(['NAITIRI_EX'], p)).toBe('Trucks');
    }
    expect(NAITIRI_UNITS.Truck.every((p) => SITE_LISTS.NAITIRI_TRUCKS_EX.test.test(p))).toBe(true);
  });
  it('only for a unit the Ex sites picked hold', () => {
    // With "Naitiri trucks Ex" and Sukari, a tractor on Naitiri's list keeps its own group
    expect(siteKind(['NAITIRI_TRUCKS_EX', 'SUKARI'], 'KTCC 573E')).toBe(null);
    expect(siteKind(['NAITIRI_TRUCKS_EX', 'SUKARI'], 'KCY 523U')).toBe('Trucks');
    expect(siteKind(['NAITIRI_EX', 'SUKARI'], 'KTCC 573E')).toBe('Tractors');
  });
  it('leaves the group alone otherwise', () => {
    expect(siteKind(null, 'WKS - Naitiri - KCY 520U')).toBe(null);
    expect(siteKind(['NAITIRI'], 'WKS - Naitiri - KCY 520U')).toBe(null);
    expect(siteKind(['NAITIRI_EX'], 'WKS - Kabras - KAA 111A')).toBe(null);
  });
});
