import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let allowed = new Set();
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (p) => [].concat(p).some((x) => allowed.has(x)) }) }));
vi.mock('../../context/AppContext', () => ({ useAppActions: () => ({ setDesktopActiveTab: () => {} }) }));
vi.mock('../../hooks/useFuelAlarm', () => ({ useFuelAlarm: () => false }));
vi.mock('../../hooks/useAlertSummary', () => ({ useAlertSummary: () => ({ open: 3 }), badgeText: (n) => String(n) }));
vi.mock('../layout/SidePanel', () => ({
  NAV_ITEMS: [
    { key: 'alerts', permission: ['alerts:read', 'fuel_theft:read', 'analytics:read'] },
    { key: 'usageReview', permission: 'logbook:read' },
    { key: 'fuel', permission: 'factory_fuel:read' },
    { key: 'audit', permission: 'fuel_audit:read' },
    { key: 'fuelReport', permission: 'fuel_filling:read' },
    { key: 'reports', permission: 'analytics:read' },
  ],
}));

const { default: MapMoreMenu, morePages } = await import('./MapMoreMenu');
const can = (p) => [].concat(p).some((x) => allowed.has(x));

describe('MapMoreMenu', () => {
  it('lists Alerts, Fuel, Fuel audit, Fuel metrics, Logbook and Reports, each only with its right', () => {
    allowed = new Set(['factory_fuel:read', 'fuel_audit:read', 'fuel_filling:read', 'analytics:read', 'logbook:read']);
    expect(morePages(can).map((p) => p.label)).toEqual(['Alerts', 'Fuel', 'Fuel audit', 'Fuel metrics', 'Logbook', 'Reports']);
    allowed = new Set(['fuel_filling:read']);
    expect(morePages(can).map((p) => p.label)).toEqual(['Fuel metrics']);
    allowed = new Set(['alerts:read']);
    expect(morePages(can).map((p) => p.label)).toEqual(['Alerts']);
  });

  it('marks the ☰ with a dot while there are unread alerts', () => {
    allowed = new Set(['alerts:read']);
    expect(renderToStaticMarkup(h(MapMoreMenu, { workPlans: null }))).toContain('map-more__dot');
    allowed = new Set(['logbook:read']);
    expect(renderToStaticMarkup(h(MapMoreMenu, { workPlans: null }))).not.toContain('map-more__dot');
  });

  it('shows the ☰ when there is a page or work plans, and nothing when there is neither', () => {
    allowed = new Set();
    expect(renderToStaticMarkup(h(MapMoreMenu, { workPlans: null }))).toBe('');
    expect(renderToStaticMarkup(h(MapMoreMenu, { workPlans: { on: false, onToggle: () => {} } }))).toContain('aria-label="Menu');
    allowed = new Set(['analytics:read']);
    expect(renderToStaticMarkup(h(MapMoreMenu, { workPlans: null }))).toContain('aria-label="Menu');
  });

  it('shows the ☰ for a signed-in account even with no pages', () => {
    allowed = new Set();
    const account = { name: 'A', email: null, initials: 'A', hue: 0, items: [] };
    expect(renderToStaticMarkup(h(MapMoreMenu, { workPlans: null, account }))).toContain('aria-label="Menu');
  });
});
