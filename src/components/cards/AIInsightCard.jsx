// AI insight summary card (legacy, unused).

import "./AIInsightCard.css";

export default function AIInsightCard({ ai }) {
  return (
    <div className="ai-card">
      <div className="ai-header">
        <span className="ai-star">✦</span>
        <span className="ai-title">AI Insight</span>
      </div>
      <div className="ai-body">
        <strong>{ai.farm}:</strong> {ai.msg}
      </div>
      <div className="ai-footer">
        <span className="ai-meta">⛽ {ai.fuelNote}</span>
        <span className="ai-meta green">↗ Risk: {ai.risk}</span>
      </div>
    </div>
  );
}
