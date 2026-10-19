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
//
// Icons back, 2026-10-15 (operator: "return the icons… apply them with
// caution"). Four, each where it carries meaning a word alone does not: the
// sparkles that mark an AI brief (and only an AI brief), a shape per risk
// level so the badge reads without its colour, a clock on the time, and the
// chevron that says which way Show more goes. Tabler, like the rest of the app.
//
// One unit at a time, 2026-10-19 (operator: "the fleet ai insight should be
// for individual car, that i click on the map"). With a unit picked the card
// is that unit's brief (fleet-server vehicles/:id/brief, measured facts the
// model only phrases); with none it is the fleet's. The title stays "Fleet AI
// Insight" either way (operator: "the title should remain as it was").
//
// Computed per click (operator, same day): each pick asks the server for a
// fresh brief, measured anew, and shows it at once; the model's wording is
// asked for at the same time and lands a few seconds later, so the card reads
// again every few seconds for a minute until it does.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./FleetAIInsightCard.css";
import { getFleetInsight } from "../../api/fleetInsight";
import { getVehicleBrief } from "../../api/vehicleBrief";
import { useApiData } from "../../hooks/useApiData";
import LoadError from "../shared/LoadError";

// A different shape per level, so the badge reads without its colour.
const RISK_ICON = { Low: "shield-check", Medium: "alert-triangle", High: "alert-octagon" };

// The server regenerates each org's AI brief in the background and
// always answers from memory, so refreshing here is instant. Poll every
// 5 min: the server rewrites each brief every 10 (2026-10-16), and asking is
// also what keeps this org on its refresh list. The SWR cacheKey
// means every render paints from the last-known brief with no flicker.
const REFRESH_MS = 5 * 60_000;

/* After a click, how often and how long to look for the model's wording. */
const MODEL_LOOK_MS = 4_000;
const MODEL_WAIT_MS = 60_000;

/* The head's mark. Sparkles only when the model wrote the brief; the
   fixed-sentence summary gets a plain info mark, so the AI sign is never
   worn by text no model touched. */
function Mark({ ai }) {
  return <i className={`ti ti-${ai ? "sparkles" : "info-circle"} fai-mark`} aria-hidden="true" />;
}

/** `unit`: the picked unit ({ orgId, vehicleId, plate }), or null for the fleet. */
export default function FleetAIInsightCard({ companyId, unit = null, className = "" }) {
  const unitId = unit?.orgId && unit?.vehicleId ? unit.vehicleId : null;
  // One per click: a new pick is a new question, never last pick's answer.
  const pickedAt = useMemo(() => Date.now(), [unitId]); // eslint-disable-line react-hooks/exhaustive-deps
  const askedFresh = useRef(null);
  const { data: insight, loading, error, retry } = useApiData(
    () => {
      if (!unitId) return getFleetInsight({ companyId });
      const fresh = askedFresh.current !== pickedAt;
      askedFresh.current = pickedAt;
      return getVehicleBrief({ orgId: unit.orgId, vehicleId: unitId, fresh });
    },
    [companyId, unitId, pickedAt],
    { cacheKey: unitId ? null : `ft-ai-insight:${companyId}` }
  );

  // Until the model's wording lands, read again every few seconds.
  const waitingOnModel = unitId != null && insight != null && insight.source !== "model";
  // An interval, not a timeout per answer: an unchanged answer comes back as
  // the same object, so nothing would re-arm a timeout.
  useEffect(() => {
    if (!waitingOnModel) return undefined;
    const t = setInterval(() => {
      if (Date.now() - pickedAt > MODEL_WAIT_MS) clearInterval(t);
      else retry();
    }, MODEL_LOOK_MS);
    return () => clearInterval(t);
  }, [waitingOnModel, pickedAt, retry]);

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
          <Mark ai />
          <h3 className="fai-title">Fleet AI Insight</h3>
        </header>
        <div className="fai-skeleton" aria-hidden="true">
          <span /><span /><span />
        </div>
      </section>
    );
  }

  const risk = RISK_ICON[insight.risk] ? insight.risk : null;
  // Not the model's: the browser's own summary (`local`), or the server's
  // facts-only brief, which it sends whenever the model failed or its reply
  // was rejected (`source: "facts"`).
  const notAi = insight.local || insight.source === "facts";
  const title = notAi ? "Fleet summary" : "Fleet AI Insight";

  return (
    <section className={cardClass} data-local={notAi ? "" : undefined} aria-label={title}>
      <header className="fai-head">
        <Mark ai={!notAi} />
        {/* Only the server's brief is the model's. The local fallback is the
            same counts in fixed sentences, and is titled as what it is. */}
        <h3 className="fai-title">{title}</h3>
        {risk && (
          <span className="fai-risk" data-risk={risk.toLowerCase()} title={`Fleet risk: ${risk}`}>
            <i className={`ti ti-${RISK_ICON[risk]}`} aria-hidden="true" />
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
        id={`fai-body-${unitId ?? companyId ?? "org"}`}
        className={`fai-body${expanded ? " fai-body--open" : ""}`}
      >
        {msg}
      </p>

      <footer className="fai-foot">
        <span className="fai-meta">
          {insight.generatedAt && <i className="ti ti-clock" aria-hidden="true" />}
          {insight.generatedAt
            ? `${notAi ? "AI unavailable · " : ""}Updated ${new Date(insight.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
            : notAi ? "AI unavailable" : null}
        </span>
        {(clamped || expanded) && (
          <button
            type="button"
            className="fai-more"
            aria-expanded={expanded}
            aria-controls={`fai-body-${unitId ?? companyId ?? "org"}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : "Show more"}
            <i className={`ti ti-chevron-${expanded ? "up" : "down"}`} aria-hidden="true" />
          </button>
        )}
      </footer>
    </section>
  );
}
