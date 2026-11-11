/**
 * A delivery plan on the Live Map (Planner, operator 2026-11-11: "the map
 * should be the live map"). Draws what lib/planOverlay holds: each customer's
 * fence with its number on the sheet, green where the truck stopped and red
 * where it did not, and the truck's run between home and home. A card names
 * the plan and takes you back to it or clears it.
 *
 * It also opens the map's own geofence tool on a fence the Planner asked to
 * have redrawn, once the organisation's zones (which hold it) have loaded.
 */
import { useEffect, useRef } from 'react';
import { useAppActions } from '../../context/AppContext';
import {
  usePlanOverlay, clearPlanOnMap, fenceEditTaken, pathOf, middleOfPath, TONE_COLOR,
} from '../../lib/planOverlay';
import './PlanOnMap.css';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function PlanOnMap({ map, maps, DomMarker, zones, onEditFence }) {
  const { overlay, editFence } = usePlanOverlay();
  const { setDesktopActiveTab } = useAppActions();
  const framed = useRef(null);

  // The fences, their numbers and the run
  useEffect(() => {
    if (!map || !maps || !overlay) return undefined;
    const drawn = [];
    const all = [];
    if (overlay.track?.length > 1) {
      drawn.push(new maps.Polyline({ map, path: overlay.track, strokeColor: '#2563eb', strokeOpacity: 0.85, strokeWeight: 4, zIndex: 40 }));
      all.push(...overlay.track);
    }
    for (const s of overlay.stops ?? []) {
      const path = pathOf(s.feature);
      if (!path) continue;
      const color = TONE_COLOR[s.tone] ?? TONE_COLOR.new;
      const on = s.id === overlay.focusStopId;
      drawn.push(new maps.Polygon({ map, paths: path, strokeColor: color, strokeWeight: on ? 3 : 2, fillColor: color, fillOpacity: on ? 0.3 : 0.15, zIndex: 41 }));
      all.push(...path);
      const at = middleOfPath(s.feature, path);
      if (at && DomMarker) {
        const pin = new DomMarker({
          position: at, anchor: 'center', zIndex: on ? 951 : 950,
          html: `<div class="plm-pin${on ? ' plm-pin--on' : ''}" style="--plm:${color}" title="${esc(s.label)}">${s.n}</div>`,
        });
        pin.setMap(map);
        drawn.push(pin);
      }
    }
    // Frame the plan once when it arrives, or the stop asked for. The map may
    // have only just been put on screen, so give it a frame to size itself.
    const key = `${overlay.planId}:${overlay.focusStopId ?? ''}:${overlay.at}`;
    if (framed.current !== key) {
      framed.current = key;
      const focus = (overlay.stops ?? []).find((s) => s.id === overlay.focusStopId);
      const pts = focus ? pathOf(focus.feature) : all;
      if (pts?.length) {
        // Coming from the Planner the map is still hidden, and when it shows it
        // restores its own view: frame once it has a size, and once more after.
        const fit = () => {
          const b = new maps.LatLngBounds();
          pts.forEach((p) => b.extend(p));
          map.fitBounds(b, focus ? 120 : 60);
        };
        const timers = [];
        let tries = 0;
        const whenShown = () => {
          if ((map.getDiv?.()?.offsetWidth ?? 1) > 0 || tries++ > 20) {
            fit();
            timers.push(setTimeout(fit, 700));
          } else timers.push(setTimeout(whenShown, 100));
        };
        timers.push(setTimeout(whenShown, 150));
        drawn.push({ setMap: () => timers.forEach(clearTimeout) });
      }
    }
    return () => drawn.forEach((d) => d.setMap(null));
  }, [map, maps, DomMarker, overlay]);

  // A fence the Planner asked to have redrawn: the map's own tool, on that fence
  useEffect(() => {
    if (!editFence) return;
    const f = zones?.features?.find((x) => x.properties?.id === editFence.id);
    if (!f) return;            // zones still loading: this runs again when they arrive
    fenceEditTaken();
    onEditFence(f);
  }, [editFence, zones, onEditFence]);

  if (!overlay) return null;
  const stopped = (overlay.stops ?? []).filter((s) => s.tone === 'ok').length;
  return (
    <div className="plm-card" role="region" aria-label="Delivery plan on the map">
      <div className="plm-card__head">
        <i className="ti ti-route" aria-hidden="true" />
        <b>{overlay.title}</b>
        <button type="button" className="plm-x" aria-label="Clear the plan from the map" onClick={clearPlanOnMap}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
      {overlay.sub && <div className="plm-card__sub">{overlay.sub}</div>}
      <div className="plm-card__sub">
        {overlay.stops?.length ?? 0} customers{overlay.track?.length ? ` · ${stopped} stopped at` : ''}
      </div>
      <button type="button" className="plm-back" onClick={() => setDesktopActiveTab('planner')}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Back to the plan
      </button>
    </div>
  );
}
