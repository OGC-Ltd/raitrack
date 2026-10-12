/**
 * The Alerts page's wording and arithmetic, kept out of the component so it
 * can be tested: the period presets, the counts behind every filter chip, how
 * an alert's decision is named, and the words on each decision button.
 *
 * The server sends one count per organisation, kind and status (only with the
 * first page); every chip's number is a sum over those, under the OTHER
 * filters, so a chip says what picking it would show.
 */

import { ORG_CODE_BY_COMPANY } from "../api/org";
import { ESCALATION_REASONS, OUTCOME } from "./fuelReview";

const DAY_MS = 86_400_000;
/** Nairobi is UTC+3 all year: no daylight saving to step over. */
const FLEET_OFFSET_MS = 3 * 3_600_000;

/** Midnight on the fleet's clock, `daysBack` days before today. */
export function fleetMidnight(now, daysBack = 0) {
  const local = now + FLEET_OFFSET_MS;
  return local - (local % DAY_MS) - FLEET_OFFSET_MS - daysBack * DAY_MS;
}

/**
 * The period chips. Each opens at a fleet midnight and runs to "now", which is
 * left to the server, so a refresh an hour later still catches the hour's
 * alerts without the filter changing.
 */
export const PERIODS = [
  { id: "today", label: "Today", days: 0 },
  { id: "7d", label: "7 days", days: 6 },
  { id: "30d", label: "30 days", days: 29 },
  { id: "90d", label: "90 days", days: 89 },
];

export function periodFrom(id, now = Date.now()) {
  const p = PERIODS.find((x) => x.id === id) ?? PERIODS[1];
  return new Date(fleetMidnight(now, p.days)).toISOString();
}

/** Speeding only: how far over the limit an episode must have gone to be listed. */
export const OVER_BY = [0, 10, 20, 30];

export const KINDS = [
  { id: "all", label: "All" },
  { id: "fuel", label: "Fuel" },
  { id: "speeding", label: "Overspeeding" },
];

export const STATUSES = [
  { id: "open", label: "Open" },
  { id: "escalated", label: "Escalated" },
  { id: "deescalated", label: "De-escalated" },
  { id: "all", label: "All" },
];

/**
 * The sum of the counts that match: `orgs` (empty = every one), `kind` and
 * `status` ("all" = any). Null while there are no counts to sum.
 */
export function countWhere(counts, { orgs = [], kind = "all", status = "all" } = {}) {
  if (!Array.isArray(counts)) return null;
  let n = 0;
  for (const c of counts) {
    if (orgs.length && !orgs.includes(c.orgId)) continue;
    if (kind !== "all" && c.kind !== kind) continue;
    if (status !== "all" && c.status !== status) continue;
    n += c.n;
  }
  return n;
}

// ── An alert's decision, in words ───────────────────────────────────────────

const FUEL_REASON_WORDS = { theft: "confirmed theft", probe_fault: "faulty fuel probe" };

/**
 * The status pill: what it says, its tone (sp4-pill--*), and the longer
 * meaning for its tooltip and the detail.
 */
export function statusOf(alert) {
  const d = alert.decision;
  if (alert.status === "escalated") {
    const what = alert.kind === "fuel" ? FUEL_REASON_WORDS[d?.reason] ?? "confirmed theft" : "confirmed overspeed";
    return { label: "Escalated", tone: "inc", meaning: what };
  }
  if (alert.status === "deescalated") {
    return { label: "De-escalated", tone: "con", meaning: alert.kind === "fuel" ? "not a theft" : "not an overspeed" };
  }
  // Open. A fuel alert can be open and off the map: cleared with a newer
  // alert on its unit, or deleted into a case before Delete was retired.
  const meaning = alert.cleared === "case" ? "deleted from the map, waiting in its case"
    : alert.cleared === "unit" ? "cleared from the map with another alert on this unit"
    : alert.kind === "fuel" && alert.fuel?.live ? "on the map now"
    : "waiting for a decision";
  return { label: "Open", tone: "warn", meaning };
}

/** One decision as a sentence's head: "Escalated as confirmed theft". */
export function decisionWords(kind, d) {
  if (!d) return "";
  if (d.outcome === "DEESCALATED") return kind === "fuel" ? "De-escalated as not a theft" : "De-escalated as not an overspeed";
  if (kind === "fuel") return `Escalated as ${FUEL_REASON_WORDS[d.reason] ?? "confirmed theft"}`;
  return "Escalated as a confirmed overspeed";
}

/**
 * The words for one decision an alert may take: the chip that picks it, the
 * confirm button, the note's prompt and what happens next. Fuel takes them
 * from the incident window's own (lib/fuelReview), so the two places that
 * decide a fuel alert say the same thing.
 */
export function choiceWords(kind, choice) {
  if (kind === "fuel") {
    if (choice.outcome === "DEESCALATED") {
      return {
        label: "Not a theft",
        confirm: OUTCOME.DEESCALATED.confirm,
        placeholder: OUTCOME.DEESCALATED.placeholder,
        hint: "Recorded as not a theft with your reason. If it is on the map, it leaves the map.",
      };
    }
    const r = ESCALATION_REASONS.find((x) => x.id === choice.reason) ?? ESCALATION_REASONS[0];
    return {
      label: r.label,
      confirm: r.confirm,
      placeholder: r.placeholder,
      hint: r.id === "probe_fault"
        ? "Not a theft. A case opens in Fuel Audit and a pending probe job in Maintenance › Repairs; it closes when the job is signed off fixed."
        : "Recorded as a confirmed theft with your reason, and the organisation's feed is told.",
    };
  }
  if (choice.outcome === "DEESCALATED") {
    return {
      label: "Not an overspeed",
      confirm: "De-escalate as not an overspeed",
      placeholder: "Why is this not an overspeed? e.g. GPS jump, wrong limit for the road, authorised run",
      hint: "Recorded as not an overspeed with your reason.",
    };
  }
  return {
    label: "Confirmed overspeed",
    confirm: "Escalate as a confirmed overspeed",
    placeholder: "What happens next? e.g. warned the driver, sent to the transport manager",
    hint: "Recorded as a confirmed overspeed with your reason, and the organisation's feed is told.",
  };
}

// ── Figures ─────────────────────────────────────────────────────────────────

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

/** "12 Oct 14:05" on the fleet's clock, or "—". */
export function when(iso) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "—";
  return `${DAY_FMT.format(t)} ${TIME_FMT.format(t)}`;
}

/** "45 s", "3 min", "1 h 05 min". */
export function duration(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

export const litres = (l) => (l == null ? "—" : `${l.toFixed(1)} L`);
export const kmh = (v) => (v == null ? "—" : `${Math.round(v)} km/h`);

/** The one figure that says what happened, for the table's Alert column. */
export function headline(alert) {
  if (alert.kind === "fuel") return { figure: litres(alert.fuel?.litres), words: "lost" };
  const s = alert.speeding ?? {};
  return { figure: kmh(s.peakKmh), words: `in ${Math.round(s.limitKmh ?? 0)} km/h` };
}

/** The fuel rule's slug in words; the slug itself when it is one we have not named. */
const RULE_WORDS = {
  "fell-while-standing": "Fell while standing",
  "fell-after-refuel": "Fell after a refuel",
};
export const ruleWords = (slug) => (slug ? RULE_WORDS[slug] ?? slug.replace(/-/g, " ") : "Possible theft");

// ── Where an alert's unit lives on this dashboard ───────────────────────────

const COMPANY_BY_ORG_CODE = Object.fromEntries(
  Object.entries(ORG_CODE_BY_COMPANY).map(([companyId, code]) => [code, companyId]),
);

/** The dashboard's company id for an organisation code, or null if it has none. */
export const companyForOrgCode = (code) => COMPANY_BY_ORG_CODE[String(code ?? "").toUpperCase()] ?? null;
