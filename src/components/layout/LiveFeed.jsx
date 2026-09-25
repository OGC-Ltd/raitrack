// LiveFeed — slides in from the right edge.
// The whole fleet day, continuous: the server's record of today paged as it is
// scrolled, with the live stream on top and no gap between them (see
// hooks/useVehicleFeed). Idle while closed.

import { useMemo } from 'react';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useMapLayers } from '../../context/MapLayersContext';
import FeedText from '../shared/FeedText';
import { feedClock, feedDate } from '../../lib/feedTime';
import { driverIndex, driverFor } from '../../lib/feedDriver';
import { feedItemFollowUp, openFollowUp } from '../../lib/fuelFollowUps';
import { useVehicleFeed } from '../../hooks/useVehicleFeed';
import FeedFooter, { nearBottom } from '../shared/FeedFooter';
import './LiveFeed.css';

// Server feed types: info | success | warning | critical
const ALERT_TYPES = new Set(['warning', 'critical']);

function dotColor(type) {
  if (type === 'critical') return '#b91c1c';
  if (type === 'warning')  return '#b7791f';
  if (type === 'success')  return '#2f855a';
  return '#94a3b8';
}

export default function LiveFeed({ open, onClose }) {
  const { feed: liveFeed = [], vehicles = [], orgId } = useFleetLiveShared();
  const { items: feed, loading, loadingMore, atEnd, loadMore } = useVehicleFeed(null, open ? orgId : null, liveFeed);
  const { focusVehicle } = useMapLayers();
  const drivers = useMemo(() => driverIndex(vehicles), [vehicles]);
  const alerts  = feed.filter(f => ALERT_TYPES.has(f.type)).length;

  return (
    <div className={`live-feed${open ? ' live-feed--open' : ''}`}>

      <div className="live-feed__top">
        <div>
          <div className="live-feed__title">Live feed</div>
          <div className="live-feed__sub">
            {alerts > 0 ? `${alerts} alert${alerts > 1 ? 's' : ''}` : 'All clear'}
          </div>
        </div>
        <div className="live-feed__top-actions">
          <button className="live-feed__close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      <div className="live-feed__list" onScroll={nearBottom(loadMore)}>
        {feed.length === 0 && (
          <div className="live-feed__empty">{loading ? 'Loading activity…' : 'No activity yet'}</div>
        )}
        {feed.map((item, i) => {
          const isAlert = ALERT_TYPES.has(item.type);
          // A follow-up item opens its case; anything else with a unit shows it.
          const followUp = feedItemFollowUp(item);
          const clickable = typeof followUp === 'string' || Boolean(item.vehicleId);
          return (
            <div
              key={item.id ?? i}
              className={`live-feed__item${isAlert ? ' live-feed__item--unread' : ''}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onClick={clickable
                ? () => (typeof followUp === 'string' ? openFollowUp(followUp) : focusVehicle?.(item.vehicleId))
                : undefined}
            >
              <span className="live-feed__dot-indicator" style={{ background: dotColor(item.type) }} />
              <div className="live-feed__body">
                <div className="live-feed__plate">{item.plate ?? 'Fleet'}</div>
                <div className="live-feed__msg">
                  <FeedText text={item.text} type={item.type} plate={item.plate} driver={driverFor(drivers, item)} />
                </div>
                <div className="live-feed__time">{feedDate(item)} · {feedClock(item)}</div>
              </div>
            </div>
          );
        })}
        <FeedFooter count={feed.length} loadingMore={loadingMore} atEnd={atEnd} loadMore={loadMore} />
      </div>
    </div>
  );
}
