import { describe, it, expect } from 'vitest';
import { complianceTiles, complianceWords, scoreFor, coveredOn, ITEMS } from './driverCompliance';

const driver = { id: 'u1', fullName: 'Duncan Mwangi Ndegwa' };
const totals = { overspeedingCases: 2, harshAccelerationCases: 0, harshBrakingCases: 1, windowDays: 90 };
const scores = { drivers: [{ driverId: 'u1', name: 'Duncan Mwangi Ndegwa', violations: { phone: 3, seatbelt: 0, freewheel: 1 } }] };
const alarms = [{ code: 123, plate: 'KCB 303Z' }, { code: 3, plate: 'KCB303Z' }, { code: 123, plate: 'KDE 125E' }, { code: 116, plate: 'KCB 303Z' }];

describe('Driver compliance', () => {
  it('lists every breach our reports count', () => {
    expect(ITEMS.map((i) => i.label)).toEqual(['Overspeeding', 'Harsh acceleration', 'Harsh braking', 'On phone', 'No seatbelt', 'Free-wheeling', 'Camera covered']);
  });

  it('counts each breach over the days its source holds', () => {
    const tiles = complianceTiles(totals, { status: 'done', scores, alarms, cameras: 4 }, { driver, vehicle: 'KCB 303Z', windowDays: 90 });
    expect(tiles.map((t) => [t.key, t.count, t.days])).toEqual([
      ['overspeed', 2, 90], ['accel', 0, 90], ['brake', 1, 90],
      ['phone', 3, 7], ['seatbelt', 0, 7], ['freewheel', 1, 7], ['covered', 2, 7],
    ]);
    expect(complianceWords(tiles)).toMatchObject({ total: 9, words: '9 breaches', tone: 'crit' });
  });

  it('leaves the dashcam ones unread while they load, or without dashcams', () => {
    const loading = complianceTiles(totals, { status: 'loading' }, { driver, vehicle: 'KCB 303Z' });
    expect(loading.slice(3).every((t) => t.count == null && t.why === 'Reading…')).toBe(true);
    const none = complianceTiles(totals, { status: 'done', scores, alarms: [], cameras: 0 }, { driver, vehicle: 'KCB 303Z' });
    expect(none[3].why).toBe('No dashcams');
    expect(complianceWords(none).total).toBe(3);
  });

  it('finds the driver’s scorecard line by id, else by name; camera covered by plate', () => {
    expect(scoreFor(scores, { id: 'x', fullName: 'duncan mwangi ndegwa' })?.driverId).toBe('u1');
    expect(coveredOn(alarms, 'KCB 303Z')).toBe(2);
    expect(coveredOn(alarms, null)).toBe(0);
  });

  it('says Compliant when there are none', () => {
    const clean = complianceTiles({ overspeedingCases: 0, harshAccelerationCases: 0, harshBrakingCases: 0 }, { status: 'done', scores: { drivers: [] }, alarms: [], cameras: 2 }, { driver, vehicle: 'KCB 303Z' });
    expect(complianceWords(clean)).toMatchObject({ total: 0, words: 'Compliant: no breaches', tone: 'ok' });
  });
});
