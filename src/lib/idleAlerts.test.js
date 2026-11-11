import { describe, it, expect } from 'vitest';
import { alertText, eatWords, idleWords, liveDismissals, searchAlerts, whereWords } from './idleAlerts';

const at = (s) => Date.parse(`${s}+03:00`);
const alert = {
  key: 'v1|idle|1', vehicleId: 'v1', plate: 'KDE 138E', size: 'HYUNDAI', designation: 'RETAIL',
  since: at('2026-11-10T20:53:06'), sinceExact: true, idleMs: 3.5 * 3_600_000, severity: 'warning',
  lat: -0.2760716, lng: 36.1032066, engineOn: false, nearest: { name: 'Gilani’s go-down.', category: 'customer', metres: 6400 },
};

describe('idle alert words', () => {
  it('words a stop as the server measures it', () => {
    expect(idleWords(3 * 3_600_000 + 5 * 60_000)).toBe('3 h 05 min');
    expect(idleWords(28 * 3_600_000)).toBe('1 d 4 h');
    expect(idleWords(42 * 60_000)).toBe('42 min');
    expect(idleWords(3 * 3_600_000)).toBe('3 h');
    expect(eatWords(at('2026-11-10T20:53:06'))).toBe('10 Nov 20:53');
    expect(eatWords(null)).toBe('—');
  });

  it('says where: at a place, a distance from it, or the coordinates', () => {
    expect(whereWords(alert)).toBe('6.4 km from Gilani’s go-down.');
    expect(whereWords({ ...alert, nearest: { name: 'Naivas HQ', metres: 0 } })).toBe('at Naivas HQ');
    expect(whereWords({ ...alert, nearest: { name: 'Naivas HQ', metres: 240 } })).toBe('240 m from Naivas HQ');
    expect(whereWords({ ...alert, nearest: null })).toBe('-0.27607, 36.10321');
  });

  it('copies as a message, saying "at least" when the server did not see it stop', () => {
    const text = alertText({ ...alert, sinceExact: false });
    expect(text).toContain('Idle unit — KDE 138E (HYUNDAI · RETAIL)');
    expect(text).toContain('Stopped since: 10 Nov 20:53 (at least)');
    expect(text).toContain('Idle in working hours: 3 h 30 min');
    expect(text).toContain('Map: https://www.google.com/maps?q=-0.2760716,36.1032066');
  });

  it('searches by plate, size or place', () => {
    const list = [alert, { ...alert, key: 'b', plate: 'KCH 467T', size: 'HINO', nearest: { name: 'Naivas HQ', metres: 0 } }];
    expect(searchAlerts(list, 'kch467').map((a) => a.plate)).toEqual(['KCH 467T']);
    expect(searchAlerts(list, 'naivas').map((a) => a.plate)).toEqual(['KCH 467T']);
    expect(searchAlerts(list, 'hyundai').map((a) => a.plate)).toEqual(['KDE 138E']);
    expect(searchAlerts(list, '')).toHaveLength(2);
  });

  it('forgets dismissals of stops that have ended', () => {
    expect([...liveDismissals(new Set(['v1|idle|1', 'v9|idle|5']), [alert])]).toEqual(['v1|idle|1']);
  });
});
