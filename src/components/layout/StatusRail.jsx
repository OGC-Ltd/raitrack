/**
 * The status filters, for screens with no room for the sidebar.
 *
 * Below 1024px the sidebar is a 56px icon rail or gone entirely, and its stat
 * grid went with it — which took ONLINE, IDLING and OFFLINE off every tablet
 * and phone. The map used to answer that with two chips, CRITICAL and WARNING,
 * so the other four buckets were simply unreachable on a phone.
 *
 * ## It renders inside FleetMap, not beside it
 *
 * Google Maps puts its own panes at very high z-indexes inside the map
 * container. A rail mounted as a sibling of `<FleetMap>` sat in a different
 * stacking context and was painted over by the map tiles — present in the DOM,
 * invisible on screen. Mounting it where the map's other floating controls
 * live puts it in their context, at their z-index, and it behaves like them.
 *
 * ## It is presentational
 *
 * `onFilter` is FleetMap's `handleFilter` — the one that hides the other
 * markers AND moves the camera onto what is left. Passing it in rather than
 * reaching for the context keeps this component honest about the fact that it
 * decides nothing: tapping CRITICAL here does exactly what clicking the
 * sidebar's CRITICAL card does, because it is the same function.
 */

import { useRef, useEffect } from 'react';
import { STATUS_STATS, countStatuses } from '../../lib/fleetStatusStats';
import './StatusRail.css';

export default function StatusRail({ vehicles = [], loading = false, activeFilter = 'all', onFilter, afterToggle = false }) {
  const scrollerRef = useRef(null);

  const counts  = countStatuses(vehicles);
  const waiting = loading && vehicles.length === 0;

  /* Keep the lit chip in view.
   *
   * Only four of the six chips fit on a phone, so a filter restored from a
   * previous session — or set from the sidebar on a tablet — routinely lights
   * one that is scrolled off the right. The rail then reads as "no filter is
   * on" over a map showing 59 of 597 units.
   *
   * `scrollLeft` rather than `scrollIntoView`: the latter walks up and scrolls
   * every scrollable ancestor to bring the element into view, and this rail
   * sits inside the map body, so it moved the map's own container instead of
   * the strip. It also did nothing at all on the first paint, before the
   * scroller had been laid out. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const chip = scroller?.querySelector('.status-rail__chip--active');
    if (!scroller || !chip) return;
    const target = chip.offsetLeft - (scroller.clientWidth - chip.offsetWidth) / 2;
    scroller.scrollTo({
      left: Math.max(0, target),
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [activeFilter]);

  return (
    // `afterToggle`: the base-map toggle holds the row's left end, so the
    // chips start past it; without it they start at the map's edge.
    <div className={`status-rail${afterToggle ? '' : ' status-rail--alone'}`} role="group" aria-label="Filter the map by status">
      <div className="status-rail__scroller" ref={scrollerRef}>
        {STATUS_STATS.map((s) => {
          const isActive = activeFilter === s.filterKey;
          return (
            <button
              key={s.key}
              type="button"
              className={`status-rail__chip${isActive ? ' status-rail__chip--active' : ''}`}
              style={{ '--chip-color': s.color }}
              aria-pressed={isActive}
              title={`Show ${s.label.toLowerCase()} on the map`}
              // Tapping the lit chip clears back to the whole fleet, which is
              // what ALL does — so it can never leave the map filtered with
              // nothing on screen showing as filtered.
              onClick={() => onFilter?.(isActive ? 'all' : s.filterKey)}
            >
              <span className="status-rail__dot" aria-hidden="true" />
              <span className="status-rail__label">{s.short}</span>
              <span className="status-rail__count">{waiting ? '–' : counts[s.key]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
