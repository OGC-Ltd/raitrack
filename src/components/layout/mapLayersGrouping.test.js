/**
 * Which layers are "site plans", and therefore which organisations get the node.
 *
 * Mufindi was the org this went wrong on. It has no `site:` layers at all —
 * SITE_PLANS carries entries for westsugar, sukari and menengai only — so its
 * two surveyed layers, Estate areas and Planting plan, fell through to the
 * ungrouped list and rendered as bare switches under no heading, while every
 * other org's survey sat under Site plans. A per-org difference nobody chose.
 */

import { describe, it, expect } from 'vitest'
import { groupLayers } from './MapLayersTree.jsx'

const layer = (id, over = {}) => ({ id, label: id, on: false, ...over })

describe('groupLayers', () => {
  it('puts Mufindi\'s estate areas and planting plan under site plans', () => {
    const { sitePlans, other } = groupLayers([layer('zones'), layer('plan')])
    expect(sitePlans.map(l => l.id)).toEqual(['zones', 'plan'])
    // The bug: both of these used to land here, which is what rendered them
    // as loose switches with no heading.
    expect(other).toEqual([])
  })

  it('still groups every other org the way it did', () => {
    const { sitePlans, bridgeLayer, other } = groupLayers([
      layer('site:kabras'), layer('site:nzoia'), layer('bridges'),
    ])
    expect(sitePlans.map(l => l.id)).toEqual(['site:kabras', 'site:nzoia'])
    expect(bridgeLayer.id).toBe('bridges')
    expect(other).toEqual([])
  })

  it('keeps the scales out of the site plans', () => {
    // `bridges` has its own node with its own rows; folding it in would bury
    // the scale list.
    const { sitePlans, bridgeLayer } = groupLayers([layer('bridges'), layer('zones')])
    expect(sitePlans.map(l => l.id)).toEqual(['zones'])
    expect(bridgeLayer.id).toBe('bridges')
  })

  it('shows an unrecognised layer rather than dropping it', () => {
    // The reason this is a prefix test and not a fixed list: whatever FleetMap
    // publishes next still reaches the reader.
    const { other } = groupLayers([layer('weather-radar')])
    expect(other.map(l => l.id)).toEqual(['weather-radar'])
  })

  it('preserves the order FleetMap published', () => {
    const { sitePlans } = groupLayers([layer('site:b'), layer('zones'), layer('site:a'), layer('plan')])
    expect(sitePlans.map(l => l.id)).toEqual(['site:b', 'zones', 'site:a', 'plan'])
  })

  it('handles an empty or junk layer list without throwing', () => {
    expect(groupLayers()).toEqual({ sitePlans: [], bridgeLayer: null, other: [] })
    expect(() => groupLayers([null, undefined])).not.toThrow()
  })
})

import { groupBridges, bridgeActivity } from './MapLayersTree.jsx';

describe('Quick links: scales grouped by site', () => {
  const b = (id, centerCode, centerName, bridgeNo, at = null) =>
    ({ id, centerCode, centerName, bridgeNo, last: at ? { at } : null });

  it('puts a site with two scales on one row, in bridge order', () => {
    const sites = groupBridges([b('2', 101, 'FACTORY', 2), b('3', 102, 'OPAPO', 3), b('1', 101, 'FACTORY', 1)]);
    expect(sites.map(s => s.name)).toEqual(['FACTORY', 'OPAPO']);
    expect(sites[0].scales.map(s => s.bridgeNo)).toEqual([1, 2]);
  });

  it('colours a scale by how recently it weighed', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(bridgeActivity(b('1', 1, 'X', 1, '2026-09-25T11:30:00Z'), now)).toBe('live');
    expect(bridgeActivity(b('1', 1, 'X', 1, '2026-09-25T01:00:00Z'), now)).toBe('today');
    expect(bridgeActivity(b('1', 1, 'X', 1, '2026-09-20T01:00:00Z'), now)).toBe('idle');
    expect(bridgeActivity(b('1', 1, 'X', 1), now)).toBe('idle');
  });
});
