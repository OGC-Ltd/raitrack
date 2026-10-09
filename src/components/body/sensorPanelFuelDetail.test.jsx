import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The detail's own hooks, stubbed: the subject is what it draws for each state
// of the picked day, not the permission store or a telemetry fetch.
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock('../../context/AppContext', () => ({ useAppActions: () => ({}) }));
vi.mock('../../hooks/useWindowTelemetry', () => ({
  useWindowTelemetry: () => ({ pings: [], loading: false, error: null }),
}));

const { FuelDrainDetail } = await import('./SensorPanel');

const base = { vehicleId: 'v1', vehicleName: 'KDE 585S', orgId: 'o1', onClose: () => {}, onPickDay: () => {} };
const row = {
  vehicleId: 'v1', pattern: 'Refills only', status: 'refill', drainCount: 0, refillCount: 1,
  verdictSplit: { loss: 0, settled: 0, refill: 0, open: 0, recoveredL: 0 },
  events: [{ vehicleId: 'v1', type: 'refill', at: 1, atIso: '2026-10-09T05:00:00Z', litres: 120 }],
};

describe('FuelDrainDetail across a day change', () => {
  // The crash: a unit opened on a day with events, then the picker moved to a
  // day it had none — `fuelRow` arrives undefined and `.events` threw.
  it('draws an empty state, not a crash, on a day the unit recorded nothing', () => {
    const html = renderToStaticMarkup(h(FuelDrainDetail, {
      ...base, fuelRow: undefined, day: '2026-10-08', recordDay: '2026-10-07',
      tank: { initialMl: 120000, currentMl: 95000, distanceM: 34200 },
    }));
    expect(html).toContain('No Fuel Events on Thu 8 Oct 2026');
    expect(html).toContain('KDE 585S recorded no refills or drains that day.');
    expect(html).toContain('opened the day at 120 L and closed it at 95 L, over 34.2 km');
    expect(html).toContain('Back to Wed 7 Oct');
    expect(html).toContain('Every unit on Thu 8 Oct');
    expect(html).not.toContain('sp4-drain-summary');
  });

  it('offers no way back when the unit has never been seen with events', () => {
    const html = renderToStaticMarkup(h(FuelDrainDetail, { ...base, fuelRow: undefined, day: '2026-10-08' }));
    expect(html).not.toContain('Back to');
    expect(html).toContain('Every unit on Thu 8 Oct');
  });

  it('shows the reading state, never the previous day, while the new day loads', () => {
    const html = renderToStaticMarkup(h(FuelDrainDetail, { ...base, fuelRow: row, day: '2026-10-08', pending: true }));
    expect(html).toContain('Reading the Day&#x27;s Fuel Events');
    expect(html).not.toContain('Refill events');
  });

  it('shows a retry when the day failed to load', () => {
    const html = renderToStaticMarkup(h(FuelDrainDetail, { ...base, day: '2026-10-08', error: 'Network down', onReload: () => {} }));
    expect(html).toContain('Fuel Events Could Not Be Loaded');
    expect(html).toContain('Try again');
  });

  it('still draws the record on a day that has one, named by its date', () => {
    const html = renderToStaticMarkup(h(FuelDrainDetail, { ...base, fuelRow: row, day: '2026-10-08' }));
    expect(html).toContain('Fuel events · Thu 8 Oct 2026');
    expect(html).toContain('sp4-drain-summary');
    expect(html).toContain('Refill events');
  });
});
