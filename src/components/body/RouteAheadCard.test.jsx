import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RouteAheadCard from './RouteAheadCard';

const noop = () => {};
const base = {
  plate: 'KDE 585S', picking: false, onPick: noop, onCancelPick: noop, onClearPicked: noop,
  reachOn: false, onToggleReach: noop, reach: { status: 'idle' }, stale: false,
};
const data = {
  lengthM: 31_200, travelS: 2_700, noTrafficS: 2_400, delayS: 300,
  arrivalMs: Date.parse('2026-10-15T06:45:00Z'), fetchedAt: Date.now(), points: [], jams: null, source: 'Google',
};
const render = (p) => renderToStaticMarkup(h(RouteAheadCard, { ...base, ...p }));

describe('RouteAheadCard', () => {
  it('shows destination, ETA, road distance and the traffic delay', () => {
    const html = render({
      target: { towards: 'destination', to: { name: 'NYAONDO' } },
      route: { data, isPending: false, isError: false },
    });
    expect(html).toContain('NYAONDO');
    expect(html).toContain('31.2 km by road');
    expect(html).toContain('Traffic adds 5 m');
    expect(html).toContain('Pick destination');
  });
  it('asks for a destination when the unit is not on a dispatch', () => {
    const html = render({ target: null, route: { isPending: false, isError: false } });
    expect(html).toContain('Not on a dispatch');
  });
  it("shows Google's refusal instead of an ETA", () => {
    const html = render({
      target: { towards: 'picked', to: { name: 'Picked point' } },
      route: { isPending: false, isError: true, error: new Error('Google: API key not valid') },
    });
    expect(html).toContain('Google: API key not valid');
    expect(html).toContain('Clear');
  });
  it('lists the reach rings when reach is on', () => {
    const html = render({ target: null, route: {}, reachOn: true, reach: { status: 'ok' } });
    expect(html).toContain('15 min');
    expect(html).toContain('60 min');
    expect(html).toContain('Isochrones');
  });
});
