/* Hallmark · component: auto workshop stats strip · genre: modern-minimal
 * theme: in-project tokens, preserved (DriversScreen.css .dr-tones / .dr-strip)
 * redesign: restyle · copy: the old five tiles' figures, all kept
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · loading (board) · empty workshop · zero segment hidden ·
 *   chart hover + focus (TrendStat) · more cards = red delta, more released = green
 * contrast: figures ink / --text-2 on --card; tones on bars, dots and counts
 *   that also carry a word, so none is read by colour alone
 *
 * The Drivers strip, read for the FactorySuite workshop (operator, 2026-11-18:
 * "redesign the auto workshop stats cards to match those on the driver page").
 * One frame, four cells split by hairlines: who is in now and in what state,
 * cards opened a day, cards released a day, and the period's watch list. It
 * replaces five bordered tiles that each held one number.
 */
import TrendStat from "./TrendStat";

const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString());
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const stay = (h) => (h == null ? "-" : h < 48 ? `${fmt(Math.round(h))} h` : `${fmt(Math.round(h / 24))} days`);
const hoursSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : null);

/** A card's state on the floor; the same order the server moves the repair job in. */
export const stateOf = (c) =>
  c.status === "AWAITING_PARTS" || (c.partsRequestedAt && !c.partsReceivedAt) ? "parts"
    : c.repairStartedAt ? "repair" : "waiting";

// In the Ratings bar's tones: being repaired is green, waiting on parts amber, not yet started grey.
export const STATES = [
  { key: "repair", label: "Repairing", mix: "good" },
  { key: "waiting", label: "Not started", mix: "new" },
  { key: "parts", label: "Awaiting parts", mix: "fair" },
];

/** open: the cards in the workshop now. summary: the board's period figures, or null while read. */
export default function WorkshopStrip({ open, summary, loading }) {
  const series = summary?.byDay ?? [];
  const days = series.length;
  const half = Math.max(1, Math.floor(days / 2));
  const sub = days > 1 ? `last ${half}d vs previous ${half}d` : "";
  return (
    <div className="fsw-stats dr-tones">
      <section className="dr-strip fsw-strip" aria-label="The workshop">
        <FloorCell open={open} loading={loading && !summary} />
        <TrendStat
          title="Cards opened"
          series={series}
          valueKey="opened"
          value={summary ? fmt(summary.cards) : "-"}
          unit={plural(summary?.cards, "card")}
          tone="mileage"
          type="bar"
          what="job cards opened"
          sub={sub}
          upIsBad
          pointWords={(at) => `${fmtDay(at.day)} · ${fmt(at.opened)} ${plural(at.opened, "card")} opened`}
          loading={loading && !summary}
        />
        <TrendStat
          title="Released"
          series={series}
          valueKey="released"
          value={summary ? fmt(summary.released) : "-"}
          unit={plural(summary?.released, "machine")}
          tone="tonnes"
          type="line"
          sub={sub}
          pointWords={(at) => `${fmtDay(at.day)} · ${fmt(at.released)} released`}
          loading={loading && !summary}
        />
        <WatchCell summary={summary} loading={loading && !summary} />
      </section>
    </div>
  );
}

/** The machines in the workshop now: how many, how long, and what each waits on. */
function FloorCell({ open, loading }) {
  if (loading) {
    return (
      <div className="dr-cell dr-fleet">
        <div className="dr-cell__empty" aria-busy="true">Reading the workshop…</div>
      </div>
    );
  }
  const hours = open.map((c) => hoursSince(c.checkedInAt)).filter((h) => h != null);
  const longest = hours.length ? Math.max(...hours) : null;
  const facts = [
    { label: "Urgent", value: open.filter((c) => c.priority === "Urgent").length },
    { label: "In over 3 days", value: hours.filter((h) => h > 72).length },
    { label: "Not tracked by us", value: open.filter((c) => !c.vehicleId).length },
  ];
  const mix = STATES.map((s) => ({ ...s, n: open.filter((c) => stateOf(c) === s.key).length }));

  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">In the workshop</span>
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(open.length)}</span>
        <span className="dr-summary__caption">
          {plural(open.length, "machine")} in now,<br />{longest == null ? "none waiting" : `longest ${stay(longest)}`}
        </span>
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
        <span className="dr-fleet__mixlabel">State</span>
        <span className="dr-fleet__bar" role="img"
              aria-label={open.length ? mix.map((m) => `${m.n} ${m.label.toLowerCase()}`).join(", ") : "Nothing in the workshop"}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.key} className={`dr-fleet__seg dr-fleet__seg--${m.mix}`}
                  style={{ flexGrow: m.n }}
                  title={`${m.label}: ${fmt(m.n)} ${plural(m.n, "machine")}`} />
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

/** The period's exceptions: the only rows allowed colour, and only when they are not zero. */
function WatchCell({ summary, loading }) {
  if (loading || !summary) {
    return (
      <div className="dr-cell dr-summary">
        <div className="dr-cell__empty" aria-busy="true">Reading…</div>
      </div>
    );
  }
  const rows = [
    { name: "Major repairs", n: summary.major, tone: "theft" },
    { name: "Fuel discrepancies", n: summary.fuelDiscrepancies, tone: "theft",
      hint: "FactorySuite's own flag: fuel in and out of the workshop disagree" },
    { name: "Urgent cards", n: summary.urgent, tone: "speed" },
    { name: "Scheduled services", n: summary.services, tone: null },
  ];
  const clean = !summary.major && !summary.fuelDiscrepancies;

  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Last {fmt(summary.days)} days</span>
        {clean && <span className="dr-summary__clean">Clean</span>}
      </div>
      <div className="dr-summary__lead" title="Check-in to release, machines released in the period">
        <span className="dr-summary__figure">{stay(summary.medianHoursInWorkshop)}</span>
        <span className="dr-summary__caption">median stay,<br />check-in to release</span>
      </div>
      <div className="dr-summary__incidents">
        {rows.map((r) => (
          <div key={r.name} title={r.hint}
               className={`dr-summary__incident${r.n && r.tone ? ` dr-summary__incident--${r.tone}` : ""}`}>
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">{r.name}</span>
            <span className="dr-summary__count">{fmt(r.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
