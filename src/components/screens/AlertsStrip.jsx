/* Hallmark · component: alerts stats strip · genre: modern-minimal
 * theme: in-project tokens, preserved (DriversScreen.css .dr-tones / .dr-strip)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · loading (counts, history) · clear (nothing open) · zero
 *   segment hidden · chart hover + focus (TrendStat) · rising = red delta
 * contrast: figures ink / --text-2 on --card; tones on dots, bars and counts
 *   that also carry a word, so none is read by colour alone
 *
 * The Drivers strip, read for alerts (operator, 2026-11-06: "the stats cards
 * redesigned to match that of drivers pages"). One frame, four cells split by
 * hairlines: the alerts in the period with how they were decided, fuel and
 * overspeeding a day each, and what is still waiting. It replaces three
 * gauges and an all-time chart; the gauges spent a circle on one number each.
 */
import TrendStat from "./TrendStat";
import { countWhere, orgsWhere } from "../../lib/alertsView";

const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString());
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// How the period's alerts were decided, in the Ratings bar's tones: waiting is
// amber, confirmed is red, cleared is green.
const DECISIONS = [
  { key: "escalated", label: "Escalated", mix: "low" },
  { key: "open", label: "Open", mix: "fair" },
  { key: "deescalated", label: "De-escalated", mix: "good" },
];

/**
 * counts: the server's per-org counts (countWhere). series: alertDays for the
 * period, or null while the history is read. orgs / kind / read: the page's
 * filters; the strip follows them, as the chips' numbers do.
 */
export default function AlertsStrip({ counts, countsLoading, series, seriesLoading, orgs, kind, read, scope }) {
  const days = series?.length ?? 0;
  const half = Math.max(1, Math.floor(days / 2));
  const sub = days > 1 ? `last ${half}d vs previous ${half}d, ${scope}` : days ? `one day, ${scope}` : "";
  const sum = (k) => (series ?? []).reduce((t, d) => t + d[k], 0);
  const pointWords = (k) => (at) => `${fmtDay(at.day)} · ${fmt(at[k])} ${plural(at[k], "alert")}`;

  return (
    <section className="dr-strip alr-strip" aria-label="Alerts in the period">
      <DecisionsCell counts={counts} loading={countsLoading} orgs={orgs} kind={kind} read={read} />
      <TrendStat
        title="Fuel alerts"
        series={series ?? []}
        valueKey="fuel"
        value={series ? fmt(sum("fuel")) : "-"}
        unit={plural(sum("fuel"), "alert")}
        tone="theft"
        type="bar"
        what="fuel alerts"
        sub={sub}
        upIsBad
        pointWords={pointWords("fuel")}
        loading={seriesLoading}
      />
      <TrendStat
        title="Overspeeding"
        series={series ?? []}
        valueKey="speeding"
        value={series ? fmt(sum("speeding")) : "-"}
        unit={plural(sum("speeding"), "alert")}
        tone="speed"
        type="line"
        sub={sub}
        upIsBad
        pointWords={pointWords("speeding")}
        loading={seriesLoading}
      />
      <WaitingCell counts={counts} loading={countsLoading} orgs={orgs} read={read} />
    </section>
  );
}

/** The period's alerts: how many, what kind, and how they were decided. */
function DecisionsCell({ counts, loading, orgs, kind, read }) {
  if (loading && !counts) {
    return (
      <div className="dr-cell dr-fleet">
        <div className="dr-cell__empty" aria-busy="true">Reading alerts…</div>
      </div>
    );
  }
  const n = (q) => countWhere(counts, { orgs, kind, read, status: "all", ...q });
  const total = n({});
  const facts = [
    { label: "Fuel", value: n({ kind: kind === "speeding" ? "none" : "fuel" }) },
    { label: "Overspeeding", value: n({ kind: kind === "fuel" ? "none" : "speeding" }) },
    { label: "Unread", value: countWhere(counts, { orgs, kind, status: "all", read: "unread" }) },
  ];
  const mix = DECISIONS.map((d) => ({ ...d, n: n({ status: d.key }) ?? 0 }));

  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Alerts</span>
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(total)}</span>
        <span className="dr-summary__caption">in the period,<br />{fmt(facts[2].value)} unread</span>
      </div>
      <dl className="dr-fleet__facts">
        {facts.map((f) => (
          <div key={f.label} className="dr-fleet__fact">
            <dt>{f.label}</dt>
            <dd>{fmt(f.value)}</dd>
          </div>
        ))}
      </dl>
      <div className="dr-fleet__mix">
        <span className="dr-fleet__mixlabel">Decisions</span>
        <span className="dr-fleet__bar" role="img"
              aria-label={total ? mix.map((m) => `${m.n} ${m.label.toLowerCase()}`).join(", ") : "No alerts in the period"}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.key} className={`dr-fleet__seg dr-fleet__seg--${m.mix}`}
                  style={{ flexGrow: m.n }}
                  title={`${m.label}: ${fmt(m.n)} ${plural(m.n, "alert")}`} />
          ))}
        </span>
        <ul className="dr-fleet__legend">
          {mix.map((m) => (
            <li key={m.key} className={`dr-fleet__key dr-fleet__key--${m.mix}`}>
              <span className="dr-fleet__swatch" aria-hidden="true" />{m.label}<b>{fmt(m.n)}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * What is still waiting for somebody, and what was confirmed: the strip's
 * exceptions, the only rows allowed colour. Both kinds, whatever the Kind chip
 * says, so a fuel-only view still shows overspeeding piling up.
 */
function WaitingCell({ counts, loading, orgs, read }) {
  if (loading && !counts) {
    return (
      <div className="dr-cell dr-summary">
        <div className="dr-cell__empty" aria-busy="true">Reading…</div>
      </div>
    );
  }
  const q = { orgs, read };
  const rows = [
    { name: "Fuel theft open", kind: "fuel", status: "open", tone: "theft" },
    { name: "Overspeeding open", kind: "speeding", status: "open", tone: "speed" },
    { name: "Theft escalated", kind: "fuel", status: "escalated", tone: "theft" },
    { name: "Speeding escalated", kind: "speeding", status: "escalated", tone: "speed" },
  ].map((r) => ({ ...r, n: countWhere(counts, { ...q, kind: r.kind, status: r.status }) ?? 0, who: orgsWhere(counts, { ...q, kind: r.kind, status: r.status }) ?? 0 }));
  const open = countWhere(counts, { ...q, status: "open" }) ?? 0;
  const waitingOrgs = orgsWhere(counts, { ...q, status: "open" }) ?? 0;

  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Waiting</span>
        {counts && !open && <span className="dr-summary__clean">Clear</span>}
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(open)}</span>
        <span className="dr-summary__caption">
          to decide,<br />{waitingOrgs ? `in ${fmt(waitingOrgs)} ${plural(waitingOrgs, "organisation")}` : "in no organisation"}
        </span>
      </div>
      <div className="dr-summary__incidents">
        {rows.map((r) => (
          <div key={r.name} className={`dr-summary__incident${r.n ? ` dr-summary__incident--${r.tone}` : ""}`}>
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">
              {r.name}
              {r.n > 0 && <span className="dr-summary__who"> · {fmt(r.who)} {plural(r.who, "org")}</span>}
            </span>
            <span className="dr-summary__count">{fmt(r.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
