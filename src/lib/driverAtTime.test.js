import { describe, it, expect } from 'vitest';
import { runAt, driversAt, behaviourRows } from './fleetReports';
import { casesFromRun } from './followUp';

const at = (s) => Date.parse(`${s}+03:00`);
const iso = (s) => new Date(at(s)).toISOString();
const run = (driverName, out, back, over = {}) => ({ id: driverName, vehicleId: 'v1', plate: 'KDX 130Y', driverName, kind: 'CANE', status: 'COMPLETED',
  dispatchedAt: iso(out), actualReturnAt: back ? iso(back) : null, ...over });
const unit = (over = {}) => ({ key: 'KDX130Y', plate: 'KDX 130Y', type: 'TRUCK', group: null, vehicles: [{ vehicleId: 'v1', driver: 'Today Driver' }], ...over });
const braking = (ts) => ({ vehicleId: 'v1', plate: 'KDX 130Y', ts: iso(ts), alertType: 'HARSH_BRAKING' });

const tuesday = run('Tuesday Driver', '2026-11-10T06:00:00', '2026-11-10T14:00:00');
const today = run('Today Driver', '2026-11-16T06:00:00', null);

describe('runAt', () => {
  it('finds the run that had the unit out at the moment', () => {
    expect(runAt([tuesday, today], at('2026-11-10T09:00:00'))).toBe(tuesday);
    expect(runAt([tuesday, today], at('2026-11-16T09:00:00'))).toBe(today);
  });

  it('finds none between runs, before the first, or after a run came back', () => {
    expect(runAt([tuesday, today], at('2026-11-10T15:00:00'))).toBeNull();
    expect(runAt([tuesday, today], at('2026-11-09T09:00:00'))).toBeNull();
  });

  it('ends a run never signed back in where the next one starts', () => {
    const open = run('Left Open', '2026-11-12T06:00:00', null);
    expect(runAt([open, today], at('2026-11-14T09:00:00'))).toBe(open);
    expect(runAt([open, today], at('2026-11-16T09:00:00'))).toBe(today);
  });
});

describe('driversAt', () => {
  it('names the driver at the time, not the one on the unit now', () => {
    expect(driversAt(unit(), [at('2026-11-10T09:00:00')], [tuesday, today])).toBe('Tuesday Driver');
  });

  it('names each driver once, the one with the most incidents first', () => {
    const t = [at('2026-11-10T09:00:00'), at('2026-11-16T09:00:00'), at('2026-11-16T10:00:00')];
    expect(driversAt(unit(), t, [tuesday, today])).toBe('Today Driver, Tuesday Driver');
  });

  it('has no driver for an incident outside every run (driven within the premises)', () => {
    expect(driversAt(unit(), [at('2026-11-10T15:00:00')], [tuesday, today])).toBeNull();
  });

  it('matches a run by plate where the gate wrote a plate the platform holds no id for', () => {
    expect(driversAt(unit(), [at('2026-11-10T09:00:00')], [{ ...tuesday, vehicleId: null }])).toBe('Tuesday Driver');
    expect(driversAt(unit(), [at('2026-11-10T09:00:00')], [{ ...tuesday, vehicleId: 'other', plate: 'KAA 111A' }])).toBeNull();
  });

  it('without the runs, names the open run’s driver only for incidents after it set off', () => {
    const u = unit({ vehicles: [{ vehicleId: 'v1', driver: 'Today Driver', trip: { driverName: 'Today Driver', departedAt: iso('2026-11-16T06:00:00') } }] });
    expect(driversAt(u, [at('2026-11-16T09:00:00')], null)).toBe('Today Driver');
    expect(driversAt(u, [at('2026-11-10T09:00:00')], null)).toBeNull();
    // A vehicle with no run open names no one: the assignment is not the person who took the keys
    expect(driversAt(unit(), [at('2026-11-16T09:00:00')], null)).toBeNull();
  });

  it('keeps the old behaviour when the caller passes no runs at all', () => {
    expect(driversAt(unit(), [at('2026-11-10T09:00:00')], undefined)).toBe('Today Driver');
  });
});

describe('the conduct report, by the driver at the time', () => {
  const week = { from: at('2026-11-10T00:00:00'), to: at('2026-11-17T00:00:00') };

  it('puts last Tuesday’s braking on Tuesday’s driver', () => {
    const rows = behaviourRows([unit()], [braking('2026-11-10T09:00:00')], [], { ...week, runs: [tuesday, today] });
    expect(rows[0].driver).toBe('Tuesday Driver');
  });

  it('leaves the driver blank where no run covered the incident, so the row greys', () => {
    const rows = behaviourRows([unit()], [braking('2026-11-10T16:00:00')], [], { ...week, runs: [tuesday, today] });
    expect(rows[0].driver).toBeNull();
  });

  it('carries the driver at the time into the follow-up cases', () => {
    const harsh = ['07', '08', '09', '10', '11'].map((h) => braking(`2026-11-10T${h}:00:00`));
    const cases = casesFromRun([unit()], harsh, [], { ...week, dashcams: true, logged: [], runs: [tuesday, today] });
    expect(cases.map((c) => [c.day, c.driver])).toEqual([['2026-11-10', 'Tuesday Driver']]);
  });
});
