// The organisation's brief, at the foot of the left sidebar.
//
// Redesigned 2026-10-15 (Hallmark, component scope):
//
//   · Risk is a tinted badge in the head, beside the title, where it is read
//     first — not a coloured "↗ Risk:" line under the text.
//   · The brief is held to four lines with "Show more", where it used to
//     scroll inside the card. The card is pinned at the sidebar's foot, so
//     its height is taken from the menu above it; a toggle the operator
//     chooses beats a second scrollbar inside the first.
//   · Loading is three placeholder lines in the brief's own shape, so the
//     foot does not jump when the brief lands.
//   · The local fallback says what it is. "Fleet summary", and an
//     "AI unavailable" note where the time would be: it is the same counts
//     in fixed sentences, written whenever the server has no brief.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./FleetAIInsightCard.css";
import { getFleetInsight } from "../../api/fleetInsight";
import { useApiData } from "../../hooks/useApiData";
import LoadError from "../shared/LoadError";

const RISKS = new Set(["Low", "Medium", "High"]);

// The server regenerates each org's AI brief hourly in the background and
// always answers from memory, so refreshing here is instant. Poll every
// 15 min to pick the new brief up soon after it lands; the SWR cacheKey
// means every render paints from the last-known brief with no flicker.
const REFRESH_MS = 15 * 60_000;

function Spark() {
  return (
    <svg className="fai-spark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5c.4 2.9 1.6 4.1 4.5 4.5-2.9.4-4.1 1.6-4.5 4.5-.4-2.9-1.6-4.1-4.5-4.5 2.9-.4 4.1-1.6 4.5-4.5Z" />
      <path d="M12.5 10c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2Z" />
    </svg>
  );
}

export default function FleetAIInsightCard({ companyId, className = "" }) {
  const { data: insight, loading, error, retry } = useApiData(
    () => getFleetInsight({ companyId }),
    [companyId],
    { cacheKey: `ft-ai-insight:${companyId}` }
  );

  useEffect(() => {
    const t = setInterval(retry, REFRESH_MS);
    return () => clearInterval(t);
  }, [retry]);

  const msg = insight?.msg ?? "";
  const bodyRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // A new brief starts folded again.
  useEffect(() => { setExpanded(false); }, [msg]);

  // "Show more" only when the fold actually hides something. Measured folded,
  // when the text changes (hourly) and when the window does (the sidebar's
  // width follows it). No ResizeObserver, as elsewhere in this app.
  useLayoutEffect(() => {
    const measure = () => {
      const el = bodyRef.current;
      if (!el || el.classList.contains("fai-body--open")) return;
      const next = el.scrollHeight > el.clientHeight + 1;
      setClamped((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [msg, expanded, loading]);

  const cardClass = `fleet-ai-card${className ? ` ${className}` : ""}`;

  if (error) {
    return (
      <div className={cardClass}>
        <LoadError label="Fleet AI insight" onRetry={retry} />
      </div>
    );
  }
  if (!loading && !insight) return null;

  if (loading || !insight) {
    return (
      <section className={cardClass} aria-busy="true" aria-label="Fleet AI insight, loading">
        <header className="fai-head">
          <Spark />
          <h3 className="fai-title">Fleet AI Insight</h3>
        </header>
        <div className="fai-skeleton" aria-hidden="true">
          <span /><span /><span />
        </div>
      </section>
    );
  }

  const risk = RISKS.has(insight.risk) ? insight.risk : null;
  const title = insight.local ? "Fleet summary" : "Fleet AI Insight";

  return (
    <section className={cardClass} data-local={insight.local ? "" : undefined} aria-label={title}>
      <header className="fai-head">
        <Spark />
        {/* Only the server's brief is the model's. The local fallback is the
            same counts in fixed sentences, and is titled as what it is. */}
        <h3 className="fai-title">{title}</h3>
        {risk && (
          <span className="fai-risk" data-risk={risk.toLowerCase()} title={`Fleet risk: ${risk}`}>
            {risk}
          </span>
        )}
      </header>

      {/* The brief alone. The card used to open with an "N/M active:" ratio
          (engines on over the fleet that reports), but the first sentence of
          the brief already says how the fleet is running — online, in transit,
          idling, parked — and those are the counts an operator acts on. The
          ratio only invited the question of which of the two numbers to trust. */}
      <p
        ref={bodyRef}
        id={`fai-body-${companyId ?? "org"}`}
        className={`fai-body${expanded ? " fai-body--open" : ""}`}
      >
        {msg}
      </p>

      <footer className="fai-foot">
        <span className="fai-meta">
          {insight.local
            ? "AI unavailable"
            : insight.generatedAt
              ? `Updated ${new Date(insight.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : null}
        </span>
        {(clamped || expanded) && (
          <button
            type="button"
            className="fai-more"
            aria-expanded={expanded}
            aria-controls={`fai-body-${companyId ?? "org"}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </footer>
    </section>
  );
}
