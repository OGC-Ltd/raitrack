// Mobile Home tab: live feed — the whole fleet day, continuous, as the desktop
// panel shows it (hooks/useVehicleFeed): today's record paged on scroll, the
// live stream on top, no gap between them.

import { useMemo } from "react";
import "./MobileHomeScreen.css";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import { feedClock, feedDate } from "../../lib/feedTime";
import FeedText from "../shared/FeedText";
import { driverIndex, driverFor } from "../../lib/feedDriver";
import { useVehicleFeed } from "../../hooks/useVehicleFeed";
import FeedFooter, { nearBottom } from "../shared/FeedFooter";

const FEED_CLS = { info: "fi-info", warning: "fi-warning", critical: "fi-critical", success: "fi-success" };
const FEED_ICO = { info: "💬", warning: "⚠", critical: "🔴", success: "✓" };

function FeedContent({ day }) {
  const { vehicles } = useFleetLiveShared();
  const { items: feed, loading, loadingMore, atEnd, loadMore, error, retry } = day;
  // Rebuilt on each SSE flush, which is cheap against a few hundred units and
  // is what keeps a driver assigned mid-shift from waiting for a reload.
  const drivers = useMemo(() => driverIndex(vehicles), [vehicles]);

  if (error && feed.length === 0) {
    return <LoadError label="Live feed" onRetry={retry} fullSection />;
  }

  if (loading && feed.length === 0) {
    return <div className="mobile-home__loading">Loading feed…</div>;
  }

  return (
    <div className="mobile-home__list">
      {feed.length === 0 ? (
        <div className="mobile-home__loading">Waiting for fleet activity…</div>
      ) : feed.map((item) => (
        <div className="mobile-home__item" key={item.id}>
          {/* Date over clock — the buffered feed spans days, so the clock
              alone does not say which one. Same shape as the desktop panel. */}
          <span className="mobile-home__time">
            <span className="mobile-home__date">{feedDate(item)}</span>
            <span className="mobile-home__clock">{feedClock(item)}</span>
          </span>
          <span className={`mobile-home__icon-cell ${FEED_CLS[item.type]}`}>{FEED_ICO[item.type]}</span>
          <span className="mobile-home__text">
            <FeedText
              text={item.text}
              type={item.type}
              plate={item.plate}
              driver={driverFor(drivers, item)}
            />
          </span>
        </div>
      ))}
      <FeedFooter count={feed.length} loadingMore={loadingMore} atEnd={atEnd} loadMore={loadMore} />
    </div>
  );
}

export default function MobileHomeScreen() {
  const { feed: liveFeed = [], orgId } = useFleetLiveShared();
  // Here, not in FeedContent: `.mobile-home` is the element that scrolls.
  const day = useVehicleFeed(null, orgId, liveFeed);
  return (
    <div className="mobile-home" onScroll={nearBottom(day.loadMore)}>
      <div className="mobile-home__heading">Live Feed</div>
      <ErrorBoundary label="Live feed">
        <FeedContent day={day} />
      </ErrorBoundary>
    </div>
  );
}
