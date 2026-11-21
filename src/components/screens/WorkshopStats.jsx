/* Hallmark · component: Workshop stats strips (Repair jobs, My jobs, Workshop day, Security cases) · genre: modern-minimal
 * theme: in-project tokens, preserved (DriversScreen.css .dr-tones / .dr-strip)
 * redesign: restyle · copy: every figure is counted from rows the view already reads
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · loading · empty (zeros, a bar with no segments) · chart hover + focus (TrendStat)
 *
 * The Auto Workshop strip (WorkshopStrip.jsx), given to the Workshop's other
 * views (operator, 2026-11-21: "apply this design to the stats card for jobs,
 * my jobs, workshop days, security cases"). One frame, four cells: what stands
 * now and in what state, a daily count as bars, a daily count as a line, and
 * the period's watch list.
 */
import TrendStat from "./TrendStat";

export const STAT_DAYS = 14;
const DAY_MS = 86_400_000;
const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString());
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const EAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" });
/** The East Africa day an instant falls on, as YYYY-MM-DD. */
export const eatDay = (t) => (t == null ? null : EAT.format(new Date(t)));
const fmtDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const hoursSince = (t) => (t ? (Date.now() - new Date(t).getTime()) / 3_600_000 : null);
const hoursBetween = (a, b) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000 : null);
export const stay = (h) => (h == null ? "-" : h < 48 ? `${fmt(Math.round(h))} h` : `${fmt(Math.round(h / 24))} days`);
const median = (xs) => {
  const v = xs.filter((x) => x != null && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** The days of the window, oldest first, ending on `end` (YYYY-MM-DD, EAT). */
export function windowDays(end = eatDay(Date.now()), n = STAT_DAYS) {
  const last = new Date(`${end}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(last - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}
/** One row per day: for each key, how many items fall on that day by `when`. */
function series(days, counters) {
  const rows = days.map((day) => ({ day }));
  const at = new Map(days.map((d, i) => [d, i]));
  for (const [key, items, when] of counters) {
    rows.forEach((r) => { r[key] = 0; });
    for (const it of items) {
      const i = at.get(eatDay(when(it)));
      if (i != null) rows[i][key] += 1;
    }
  }
  return rows;
}
const inWindow = (days, t) => t != null && eatDay(t) >= days[0] && eatDay(t) <= days[days.length - 1];
const subOf = (days) => {
  const half = Math.max(1, Math.floor(days.length / 2));
  return `last ${half}d vs previous ${half}d`;
};

// ── Cells ────────────────────────────────────────────────────────────────────

/** What stands now: the figure, three facts and the state bar. */
function LeadCell({ label, figure, caption, facts, mixLabel, mix, loading, busy = "Reading…" }) {
  if (loading) {
    return (
      <div className="dr-cell dr-fleet">
        <div className="dr-cell__empty" aria-busy="true">{busy}</div>
      </div>
    );
  }
  const total = mix.reduce((s, m) => s + m.n, 0);
  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">{label}</span>
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{figure}</span>
        <span className="dr-summary__caption">{caption}</span>
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
        <span className="dr-fleet__mixlabel">{mixLabel}</span>
        <span className="dr-fleet__bar" role="img"
              aria-label={total ? mix.map((m) => `${m.n} ${m.label.toLowerCase()}`).join(", ") : "None"}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.key} className={`dr-fleet__seg dr-fleet__seg--${m.mix}`} style={{ flexGrow: m.n }}
                  title={`${m.label}: ${fmt(m.n)}`} />
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

/** The period's watch list: a headline figure, then rows that take colour only when not zero. */
function WatchCell({ figure, caption, title, rows, clean, loading }) {
  if (loading) {
    return (
      <div className="dr-cell dr-summary">
        <div className="dr-cell__empty" aria-busy="true">Reading…</div>
      </div>
    );
  }
  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Last {STAT_DAYS} days</span>
        {clean && <span className="dr-summary__clean">Clean</span>}
      </div>
      <div className="dr-summary__lead" title={title}>
        <span className="dr-summary__figure">{figure}</span>
        <span className="dr-summary__caption">{caption}</span>
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

function Frame({ label, children }) {
  return (
    <div className="fsw-stats dr-tones">
      <section className="dr-strip fsw-strip" aria-label={label}>{children}</section>
    </div>
  );
}

/** A bar and a line over the same window, as the Auto Workshop strip draws them. */
function Trends({ rows, days, bar, line, loading }) {
  const sub = subOf(days);
  const total = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  return (
    <>
      <TrendStat title={bar.title} series={rows} valueKey={bar.key} value={loading ? "-" : fmt(total(bar.key))}
                 unit={plural(total(bar.key), bar.unit)} tone="mileage" type="bar" what={bar.what} sub={sub}
                 upIsBad={bar.upIsBad} loading={loading}
                 pointWords={(at) => `${fmtDay(at.day)} · ${fmt(at[bar.key])} ${bar.words}`} />
      <TrendStat title={line.title} series={rows} valueKey={line.key} value={loading ? "-" : fmt(total(line.key))}
                 unit={plural(total(line.key), line.unit)} tone="tonnes" type="line" sub={sub} loading={loading}
                 pointWords={(at) => `${fmtDay(at.day)} · ${fmt(at[line.key])} ${line.words}`} />
    </>
  );
}

// ── Repair jobs ──────────────────────────────────────────────────────────────

const NEXT_MIX = [
  { key: "control_room", label: "Control Room", mix: "new" },
  { key: "controltech", label: "ControlTech", mix: "fair" },
  { key: "workshop", label: "Workshop", mix: "good" },
];

/**
 * open: the open jobs. history: every job raised or closed in the window (and
 * the open ones), or null while read. bucketOf: who acts next on a stage.
 */
export function JobsStrip({ open, history, bucketOf, loading }) {
  const days = windowDays();
  const hist = history ?? [];
  const rows = series(days, [
    ["flagged", hist, (j) => j.createdAt],
    ["fixed", hist.filter((j) => j.stage === "fixed"), (j) => j.resolvedAt],
  ]);
  const ages = open.map((j) => hoursSince(j.createdAt)).filter((h) => h != null);
  const longest = ages.length ? Math.max(...ages) : null;
  const closedIn = hist.filter((j) => j.resolvedAt && inWindow(days, j.resolvedAt));
  const raisedIn = hist.filter((j) => inWindow(days, j.createdAt));
  const malicious = raisedIn.filter((j) => j.damageClass === "suspected_malicious").length;
  const failed = closedIn.filter((j) => j.stage === "failed").length;
  return (
    <Frame label="Repair jobs">
      <LeadCell
        label="Open jobs" loading={loading} busy="Reading the jobs…"
        figure={fmt(open.length)}
        caption={<>{plural(open.length, "job")} open now,<br />{longest == null ? "none waiting" : `oldest ${stay(longest)}`}</>}
        facts={[
          { label: "Open over 3 days", value: ages.filter((h) => h > 72).length },
          { label: "Ticketed", value: open.filter((j) => j.ticketNo).length },
          { label: "Suspected malicious", value: open.filter((j) => j.damageClass === "suspected_malicious").length },
        ]}
        mixLabel="Next"
        mix={NEXT_MIX.map((m) => ({ ...m, n: open.filter((j) => bucketOf(j.stage) === m.key).length }))}
      />
      <Trends rows={rows} days={days} loading={!history}
              bar={{ title: "Jobs flagged", key: "flagged", unit: "job", what: "repair jobs flagged", words: "flagged", upIsBad: true }}
              line={{ title: "Fixed", key: "fixed", unit: "job", words: "fixed" }} />
      <WatchCell
        loading={!history}
        figure={stay(median(closedIn.filter((j) => j.stage === "fixed").map((j) => hoursBetween(j.createdAt, j.resolvedAt))))}
        caption={<>median time,<br />flagged to fixed</>}
        title="Jobs fixed in the period, from the flag to the close"
        clean={!malicious && !failed}
        rows={[
          { name: "Suspected malicious", n: malicious, tone: "theft", hint: "Damage a technician classed as suspected malicious" },
          { name: "Closed not fixed", n: failed, tone: "theft" },
          { name: "Voided", n: closedIn.filter((j) => j.stage === "void").length, tone: "speed" },
          { name: "From FactorySuite cards", n: raisedIn.filter((j) => (j.fsJobCards?.length ?? 0) > 0).length, tone: null },
        ]}
      />
    </Frame>
  );
}

// ── My jobs ──────────────────────────────────────────────────────────────────

const MINE_MIX = [
  { key: "open", label: "With you", mix: "fair" },
  { key: "assessment", label: "Assessment", mix: "new" },
  { key: "workshop", label: "Workshop", mix: "good" },
];

/** rows: my jobs plus the queue's unclaimed ones (`fromQueue`). groupOf: mineGroup. */
export function MineStrip({ rows: all, groupOf, loading }) {
  const days = windowDays();
  const mine = all.filter((j) => !j.fromQueue);
  const open = mine.filter((j) => !j.resolvedAt);
  const closedIn = mine.filter((j) => j.resolvedAt && inWindow(days, j.resolvedAt));
  const rows = series(days, [
    ["given", mine, (j) => j.assignedAt ?? j.createdAt],
    ["closed", mine.filter((j) => j.resolvedAt), (j) => j.resolvedAt],
  ]);
  const ages = open.map((j) => hoursSince(j.assignedAt ?? j.createdAt)).filter((h) => h != null);
  const longest = ages.length ? Math.max(...ages) : null;
  const failed = closedIn.filter((j) => j.stage === "failed").length;
  return (
    <Frame label="My jobs">
      <LeadCell
        label="My open jobs" loading={loading} busy="Reading your jobs…"
        figure={fmt(open.length)}
        caption={<>{plural(open.length, "job")} open now,<br />{longest == null ? "none waiting" : `oldest ${stay(longest)}`}</>}
        facts={[
          { label: "Unclaimed in the queue", value: all.filter((j) => j.fromQueue).length },
          { label: "Open over 3 days", value: ages.filter((h) => h > 72).length },
          { label: "Closed", value: mine.filter((j) => j.resolvedAt).length },
        ]}
        mixLabel="Where"
        mix={MINE_MIX.map((m) => ({ ...m, n: open.filter((j) => groupOf(j) === m.key).length }))}
      />
      <Trends rows={rows} days={days} loading={loading}
              bar={{ title: "Given to me", key: "given", unit: "job", what: "jobs given to you", words: "given to you" }}
              line={{ title: "Closed", key: "closed", unit: "job", words: "closed" }} />
      <WatchCell
        loading={loading}
        figure={stay(median(closedIn.map((j) => hoursBetween(j.assignedAt ?? j.createdAt, j.resolvedAt))))}
        caption={<>median time,<br />given to closed</>}
        title="Your jobs closed in the period"
        clean={!failed}
        rows={[
          { name: "Fixed", n: closedIn.filter((j) => j.stage === "fixed").length, tone: null },
          { name: "Closed not fixed", n: failed, tone: "theft" },
          { name: "Voided", n: closedIn.filter((j) => j.stage === "void").length, tone: "speed" },
          { name: "Suspected malicious", n: mine.filter((j) => j.damageClass === "suspected_malicious" && inWindow(days, j.damageClassifiedAt)).length, tone: "theft" },
        ]}
      />
    </Frame>
  );
}

// ── Workshop day ─────────────────────────────────────────────────────────────

/** One day's answer, counted. */
export function dayCounts(d) {
  const bookings = d?.bookings ?? [];
  const arrived = bookings.filter((b) => b.status === "arrived").length;
  // A FactorySuite check-in is booked by its card; a walk-in had no booking at all.
  const unbooked = d?.unbookedArrivals ?? [];
  const fsIns = unbooked.filter((j) => j.fsJobCards?.length).length;
  const walkIns = unbooked.length - fsIns;
  return {
    capacity: d?.capacity ?? 0,
    booked: d?.booked ?? 0,
    arrived, walkIns, fsIns,
    toCome: bookings.filter((b) => b.status === "booked").length,
    noShows: bookings.filter((b) => b.status === "no_show").length,
  };
}

/** current: the day on screen. week: the window's days, oldest first, each { day, data } (data null while read). */
export function DayStrip({ current, week, date, loading }) {
  const c = dayCounts(current);
  const read = week.every((w) => w.data);
  const counts = week.map((w) => ({ day: w.day, ...dayCounts(w.data) }));
  const rows = counts.map((x) => ({ day: x.day, booked: x.booked, arrived: x.arrived + x.walkIns + x.fsIns }));
  const days = week.map((w) => w.day);
  const booked = counts.reduce((s, x) => s + x.booked, 0);
  const cameIn = counts.reduce((s, x) => s + x.arrived, 0);
  const noShows = counts.reduce((s, x) => s + x.noShows, 0);
  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <Frame label="Workshop day">
      <LeadCell
        label="Booked" loading={loading} busy="Reading the day…"
        figure={`${fmt(c.booked)} / ${fmt(c.capacity)}`}
        caption={<>booked on {label},<br />{fmt(Math.max(0, c.capacity - c.booked))} {plural(Math.max(0, c.capacity - c.booked), "slot")} free</>}
        facts={[
          { label: "Arrived", value: c.arrived },
          { label: "Still to come", value: c.toCome },
          { label: "Without a booking", value: c.walkIns },
        ]}
        mixLabel="Bookings"
        mix={[
          { key: "arrived", label: "Arrived", mix: "good", n: c.arrived },
          { key: "to-come", label: "To come", mix: "new", n: c.toCome },
          { key: "no-show", label: "No-show", mix: "low", n: c.noShows },
        ]}
      />
      <Trends rows={rows} days={days} loading={!read}
              bar={{ title: "Booked", key: "booked", unit: "vehicle", what: "vehicles booked", words: "booked" }}
              line={{ title: "Arrived", key: "arrived", unit: "vehicle", words: "arrived" }} />
      <WatchCell
        loading={!read}
        figure={booked ? `${Math.round((cameIn / booked) * 100)}%` : "-"}
        caption={<>of bookings<br />arrived</>}
        title={`Up to ${label}`}
        clean={!noShows}
        rows={[
          { name: "No-shows", n: noShows, tone: "theft", hint: "Booked units that did not arrive on their day" },
          { name: "Arrived without a booking", n: counts.reduce((s, x) => s + x.walkIns, 0), tone: "speed" },
          { name: "Checked in on FactorySuite", n: counts.reduce((s, x) => s + x.fsIns, 0), tone: null,
            hint: "Machines checked into the workshop on a FactorySuite job card: the card is their booking" },
          { name: "Full days", n: counts.filter((x) => x.capacity && x.booked >= x.capacity).length, tone: null },
          { name: "Free slots", n: counts.reduce((s, x) => s + Math.max(0, x.capacity - x.booked), 0), tone: null },
        ]}
      />
    </Frame>
  );
}

// ── Security cases ───────────────────────────────────────────────────────────

const CASE_MIX = [
  { key: "open", label: "Open", mix: "low" },
  { key: "investigating", label: "Investigating", mix: "fair" },
];

/** cases: every investigation, open and closed, or null while read. */
export function SecurityStrip({ cases }) {
  const loading = !cases;
  const all = cases ?? [];
  const days = windowDays();
  const open = all.filter((c) => !c.closedAt);
  const closedIn = all.filter((c) => c.closedAt && inWindow(days, c.closedAt));
  const rows = series(days, [
    ["opened", all, (c) => c.openedAt],
    ["closed", all.filter((c) => c.closedAt), (c) => c.closedAt],
  ]);
  const ages = open.map((c) => hoursSince(c.openedAt)).filter((h) => h != null);
  const longest = ages.length ? Math.max(...ages) : null;
  const confirmed = closedIn.filter((c) => c.status === "closed_confirmed").length;
  return (
    <Frame label="Security cases">
      <LeadCell
        label="Open cases" loading={loading} busy="Reading the cases…"
        figure={fmt(open.length)}
        caption={<>{plural(open.length, "case")} open now,<br />{longest == null ? "none waiting" : `oldest ${stay(longest)}`}</>}
        facts={[
          { label: "Nobody holds it", value: open.filter((c) => !c.assignedTo).length },
          { label: "Open over 7 days", value: ages.filter((h) => h > 168).length },
          { label: "Warranty void", value: open.filter((c) => c.repairItem?.warrantyVoid).length },
        ]}
        mixLabel="State"
        mix={CASE_MIX.map((m) => ({ ...m, n: open.filter((c) => c.status === m.key).length }))}
      />
      <Trends rows={rows} days={days} loading={loading}
              bar={{ title: "Cases opened", key: "opened", unit: "case", what: "cases opened", words: "opened", upIsBad: true }}
              line={{ title: "Closed", key: "closed", unit: "case", words: "closed" }} />
      <WatchCell
        loading={loading}
        figure={stay(median(closedIn.map((c) => hoursBetween(c.openedAt, c.closedAt))))}
        caption={<>median time,<br />opened to closed</>}
        title="Cases closed in the period"
        clean={!confirmed}
        rows={[
          { name: "Confirmed malicious", n: confirmed, tone: "theft" },
          { name: "Unfounded", n: closedIn.filter((c) => c.status === "closed_unfounded").length, tone: null },
          { name: "Warranty voided", n: all.filter((c) => c.repairItem?.warrantyVoid && inWindow(days, c.openedAt)).length, tone: "speed" },
          { name: "Opened", n: all.filter((c) => inWindow(days, c.openedAt)).length, tone: null },
        ]}
      />
    </Frame>
  );
}
