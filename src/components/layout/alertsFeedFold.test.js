import { describe, it, expect } from 'vitest';
import { foldRepeats, alertIcon } from './AlertsFeed';

const alert = (t, title, body, severity = 'critical', extra = {}) =>
  ({ type: 'alert', t, title, body, severity, kind: 'zone', litres: null, ...extra });

describe('foldRepeats', () => {
  it('folds the same alert raised back to back into one entry with every time', () => {
    const body = 'Entered Main river malagarasi3, a restricted zone.';
    const out = foldRepeats([
      alert(4, 'Over speed', 'Peak 87 km/h, limit 80 km/h', 'warning', { kind: 'speeding' }),
      alert(3, 'Restricted', body),
      alert(2, 'Restricted', body),
      alert(1, 'Restricted', body),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].times).toEqual([3, 2, 1]);
    expect(out[1].t).toBe(3);
  });

  it('keeps apart alerts that differ, or are not next to each other', () => {
    const out = foldRepeats([
      alert(3, 'Restricted', 'Entered A'),
      alert(2, 'Restricted', 'Entered B'),
      alert(1, 'Restricted', 'Entered A'),
    ]);
    expect(out.map(e => e.times.length)).toEqual([1, 1, 1]);
  });

  it('never folds two stops, even of the same length', () => {
    const stop = (t) => alert(t, 'Stopped', '6 min', 'info', { kind: 'stop' });
    expect(foldRepeats([stop(2), stop(1)])).toHaveLength(2);
  });

  it('never folds a fuel loss or an alert carrying litres', () => {
    const loss = { type: 'loss', t: 2, title: 'Possible theft', severity: 'critical', reports: [] };
    const out = foldRepeats([loss, { ...loss, t: 1 }, alert(0, 'Refill', null, 'info', { litres: 40 }), alert(-1, 'Refill', null, 'info', { litres: 40 })]);
    expect(out).toHaveLength(4);
  });
});

describe('alertIcon', () => {
  it('reads restricted zones as no-entry and a loss as fuel', () => {
    expect(alertIcon(alert(1, 'Restricted', 'Entered X, a restricted zone.'))).toBe('hand-stop');
    expect(alertIcon(alert(1, 'Entered zone', 'Entered workshop', 'info'))).toBe('map-pin');
    expect(alertIcon({ type: 'loss', severity: 'critical' })).toBe('droplet-off');
    expect(alertIcon({ type: 'alert', kind: 'speeding', severity: 'warning' })).toBe('gauge');
  });
});
