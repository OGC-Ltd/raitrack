import { describe, it, expect } from 'vitest';
import { showPlanOnMap, clearPlanOnMap, focusPlanStop, requestFenceEdit, fenceEditTaken, planOverlayNow, pathOf, middleOfPath, circlePath } from './planOverlay';

describe('planOverlay', () => {
  it('holds one plan for the map, a stop to focus, and a fence to redraw, until cleared', () => {
    showPlanOnMap({ planId: 'p1', title: 'KDE 128E', stops: [], track: [] });
    expect(planOverlayNow().overlay.planId).toBe('p1');
    focusPlanStop('s3');
    expect(planOverlayNow().overlay.focusStopId).toBe('s3');
    requestFenceEdit('g1');
    expect(planOverlayNow().editFence.id).toBe('g1');
    fenceEditTaken();
    expect(planOverlayNow().editFence).toBeNull();
    clearPlanOnMap();
    expect(planOverlayNow()).toEqual({ overlay: null, editFence: null });
  });

  it('draws a circle fence as a ring around its centre, and a polygon as its corners', () => {
    const circle = { geometry: { type: 'Point', coordinates: [36.1, -0.2] }, properties: { radiusM: 100 } };
    const ring = pathOf(circle);
    expect(ring).toHaveLength(48);
    expect(ring[0].lng).toBeCloseTo(36.1 + 100 / (111_320 * Math.cos((-0.2 * Math.PI) / 180)), 8);
    expect(middleOfPath(circle, ring)).toEqual({ lat: -0.2, lng: 36.1 });
    const poly = { geometry: { type: 'Polygon', coordinates: [[[36, 0], [36.2, 0], [36.2, 0.2], [36, 0.2]]] } };
    expect(pathOf(poly)[1]).toEqual({ lat: 0, lng: 36.2 });
    expect(pathOf({ geometry: { type: 'LineString', coordinates: [] } })).toBeNull();
    expect(circlePath(0, 0, 10, 4)).toHaveLength(4);
  });
});
