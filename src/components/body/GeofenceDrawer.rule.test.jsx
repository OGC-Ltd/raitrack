import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The drawer's Rule section, drawn as the form opens on a fence that has one.
vi.mock('../../context/AppContext', () => ({ useCompanies: () => ({ activeCompany: { code: 'MENENGAI' } }) }));
vi.mock('../../hooks/useEstateZones', () => ({ reloadEstateZones: async () => {} }));

const { default: GeofenceDrawer } = await import('./GeofenceDrawer');

const fence = (rule) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[36.0, 0], [36.1, 0]] },
  properties: { id: 'g1', name: 'Tanker no-go road', purpose: 'restricted', category: 'restricted', fenceType: 'LINE', widthM: 40, source: 'app', rule },
});
const vehicles = [
  { vehicleId: 'v1', id: 'KCT 507W', name: 'KCT 507W', vehicleType: 'TANKER' },
  { vehicleId: 'v2', id: 'KBT 112R', name: 'KBT 112R', vehicleType: 'LORRY' },
];
const draw = (editing) => renderToStaticMarkup(
  <GeofenceDrawer map={null} maps={null} DomMarker={null} orgId="o" fences={[]} vehicles={vehicles}
                  editing={editing} canDelete clickRef={{ current: null }} onClose={() => {}} />,
);

describe('the geofence form\'s rule', () => {
  it('says a saved rule back in words, with its picks pressed', () => {
    const html = draw(fence({ trigger: 'enter', vehicleTypes: [], fleets: ['Tankers'], vehicleIds: ['v1'], hours: null, alert: { type: 'nogo', severity: 'critical' } }));
    expect(html).toContain('Tankers must not enter. Raise a no-go alert.');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Tankers/);
    expect(html).toContain('TANKER');       // the Wialon classes to pick from
    expect(html).toContain('Remove the rule');
  });

  it('offers a rule on a fence without one', () => {
    const html = draw(fence(null));
    expect(html).toContain('Say who may not use it');
    expect(html).not.toContain('must not enter');
  });
});
