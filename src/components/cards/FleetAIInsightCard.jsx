// AI insight card for the map side panel.

import { useEffect } from "react";
import "./FleetAIInsightCard.css";
import { getFleetInsight } from "../../api/fleetInsight";
import { useApiData } from "../../hooks/useApiData";
import LoadError from "../shared/LoadError";

const RISK_COLOR = { Low: "var(--accent-ok)", Medium: "var(--accent-warn)", High: "var(--accent-crit)" };

// The server regenerates each org's AI brief hourly in the background and
// always answers from memory, so refreshing here is instant. Poll every
// 15 min to pick the new brief up soon after it lands; the SWR cacheKey
// means every render paints from the last-known brief with no flicker.
const REFRESH_MS = 15 * 60_000;

export default function FleetAIInsightCard({ companyId }) {
  const { data: insight, loading, error, retry } = useApiData(
    () => getFleetInsight({ companyId }),
    [companyId],
    { cacheKey: `ft-ai-insight:${companyId}` }
  );

  useEffect(() => {
    const t = setInterval(retry, REFRESH_MS);
    return () => clearInterval(t);
  }, [retry]);

  if (error) {
    return (
      <div className="fleet-ai-card">
        <LoadError label="Fleet AI insight" onRetry={retry} />
      </div>
    );
  }
  if (!loading && !insight) return null;
  if (loading || !insight) {
    return (
      <div className="fleet-ai-card">
        <div className="fai-header">
          <span className="fai-star">✦</span>
          <span className="fai-title">Fleet AI Insight</span>
        </div>
        <div className="fai-body">Analysing fleet activity…</div>
      </div>
    );
  }

  return (
    <div className="fleet-ai-card">
      <div className="fai-header">
        <span className="fai-star">✦</span>
        <span className="fai-title">Fleet AI Insight</span>
      </div>
      {/* The brief alone. The card used to open with an "N/M active:" ratio
          (engines on over the fleet that reports), but the first sentence of
          the brief already says how the fleet is running — online, in transit,
          idling, parked — and those are the counts an operator acts on. The
          ratio only invited the question of which of the two numbers to trust. */}
      <div className="fai-body">{insight.msg}</div>
      <div className="fai-footer">
        <span className="fai-meta" style={{ color: RISK_COLOR[insight.risk] }}>
          ↗ Risk: {insight.risk}
        </span>
        {insight.generatedAt && (
          <span className="fai-meta" style={{ color: "var(--text-secondary)" }}>
            Updated {new Date(insight.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
}
