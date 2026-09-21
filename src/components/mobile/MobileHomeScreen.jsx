// Mobile Home tab: live feed — the same real per-org SSE activity stream the
// desktop panel shows, read from the shared FleetLiveProvider connection.

import { useMemo } from "react";
import "./MobileHomeScreen.css";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import { feedClock, feedDate } from "../../lib/feedTime";
import FeedText from "../shared/FeedText";
import { driverIndex, driverFor } from "../../lib/feedDriver";

const FEED_CLS = { info: "fi-info", warning: "fi-warning", critical: "fi-critical", success: "fi-success" };
const FEED_ICO = { info: "💬", warning: "⚠", critical: "🔴", success: "✓" };

function FeedContent() {
  const { feed, loading, error, retry, vehicles } = useFleetLiveShared();
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
    </div>
  );
}

export default function MobileHomeScreen() {
  return (
    <div className="mobile-home">
      <div className="mobile-home__heading">Live Feed</div>
      <ErrorBoundary label="Live feed">
        <FeedContent />
      </ErrorBoundary>
    </div>
  );
}
