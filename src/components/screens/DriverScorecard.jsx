// Driver scorecard — the pay proposal's speed (§3.2) and safety points per
// driver, from fleet-server /analytics/driver-scores. Each event is credited
// to whoever held the vehicle at that moment; what nobody held is counted in
// the notes rather than dropped. Rates and caps come back with the answer, so
// this screen never restates a number the server decides.
//
// Drawn in the Analytics roster's own grammar (DriversScreen.css): the
// `dr-filters` toolbar with a segmented `dr-seg` and the drawn search, the
// `dr-strip` of stat cells, and the `dr-grid` datagrid with sortable heads,
// the avatar + name driver cell, dotted incident cells and status badges. The
// two views of one page must read as one product, so nothing here invents a
// class the roster does not already style — the only new rules are the day
// breakdown and the phone card's areas (DriverScorecard.css).

import { Fragment, useMemo, useState } from "react";
import "./DriverScorecard.css";
import { getDriverScores } from "../../api/drivers";
import { useAppSelector } from "../../context/AppContext";
import { useApiData } from "../../hooks/useApiData";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import LoadError from "../shared/LoadError";

const DAY = 86_400_000;
/** A fleet day (EAT) as YYYY-MM-DD. */
const eatDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

/** The periods on offer, as inclusive fleet-day ranges ending no later than today. */
function periods(now = Date.now()) {
  const today = eatDay(now);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.parse(`${today}T00:00:00Z`) - dow * DAY;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return [
    { key: "7d", label: "7 days", from: iso(Date.parse(`${today}T00:00:00Z`) - 6 * DAY), to: today },
    { key: "week", label: "This week", from: iso(monday), to: today },
    { key: "last", label: "Last week", from: iso(monday - 7 * DAY), to: iso(monday - DAY) },
    { key: "month", label: "This month", from: `${today.slice(0, 8)}01`, to: today },
  ];
}

const KIND_LABEL = {
  overspeed: "Over the limit",
  speeding: "Speeding > 15",
  seatbelt: "No seat belt",
  phone: "Phone",
  freewheel: "Free-wheel",
  harshBrake: "Harsh braking",
};
const VIOLATIONS = ["speeding", "seatbelt", "phone", "freewheel", "harshBrake"];
/** Ten data columns plus the driver: the empty and detail rows span all of them. */
const COLS = 6 + VIOLATIONS.length;

/** Same paging the roster uses: fewer per page where each row is a card. */
const PAGE = 15;
const PAGE_PHONE = 10;
const CARDS_QUERY = "(max-width: 700px)";

const fmt = (n) => (n == null || !Number.isFinite(n) ? "–" : Math.round(n).toLocaleString("en-KE"));
const kes = (n) => `${n < 0 ? "−" : ""}KES ${fmt(Math.abs(n))}`;
const pts = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const toneOf = (n) => (n > 0 ? "sc-up" : n < 0 ? "sc-down" : "");
/** "JOSEPH OTIENO" and "joseph otieno" both read "Joseph Otieno". */
const titleCase = (s) => String(s ?? "").toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const initialsOf = (name = "") =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });

/** "1 vehicle", "2 vehicles". */
const count = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
/** "a", "a and b", "a, b and c". */
const andList = (items) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

function coverageSentence(cov, unattributed) {
  const first = `${fmt(cov.vehiclesWithDriver)} of the ${count(cov.vehiclesDriven, "vehicle")} driven in this period had an assigned driver.`;
  if (!unattributed) return first;
  const parts = [
    cov.unattributed.overspeed && `${fmt(cov.unattributed.overspeed)} speeding`,
    cov.unattributed.harshBrake && `${fmt(cov.unattributed.harshBrake)} harsh braking`,
    cov.unattributed.dashcam && `${fmt(cov.unattributed.dashcam)} dashcam`,
  ].filter(Boolean);
  return `${first} ${count(unattributed, "event")} (${andList(parts)}) occurred on vehicles without an assigned driver and ${unattributed === 1 ? "has" : "have"} not been scored.`;
}

function rulesSentence(r) {
  const [first, second, third] = r.speed.bandPoints;
  return `Speed points: ${signed(r.speed.compliantPoints)} for a day without speeding; ${signed(first)}, ${signed(second)} and ${signed(third)} `
    + `for the first, second and each further offence of the day between ${r.speed.bufferKmh + 1} and ${r.speed.bandTopKmh} km/h over the limit; `
    + `and ${signed(r.speed.severePoints)} for any offence more than ${r.speed.bandTopKmh} km/h over. Each speed point is worth KES ${fmt(r.speed.kesPerPoint)}. `
    + `Each safety point is worth KES ${fmt(r.safety.kesPerPoint)}, and no more than ${Math.abs(r.safety.dailyFloor)} safety points are deducted in one day.`;
}

/** The server's list of what this page leaves out, as one sentence. */
function manualSentence(items) {
  // An older server sends whole sentences ("Vehicle care (§3.3): …."); show those as they are.
  if (items.some((s) => /\.$/.test(s))) return `Not scored here: ${items.join(" ")}`;
  const list = items.length <= 1 ? items.join("") : `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}`;
  return `The following are not scored here: ${list}.`;
}

/** Standing, worst first, as the roster's status badge — dot inside the pill. */
function standingOf(d) {
  if (d.months.some((m) => m.standing === "termination")) return { tone: "terminated", label: "Termination", rank: 3 };
  if (d.months.some((m) => m.standing === "suspension")) return { tone: "suspended", label: "Suspension", rank: 2 };
  if (d.tripPayDaysLost) return { tone: "suspended", label: `Trip pay lost ×${d.tripPayDaysLost}`, rank: 1 };
  return { tone: "active", label: "Clear", rank: 0 };
}

const SORTS = {
  driver: (d) => d.name.toLowerCase(),
  days: (d) => d.days,
  speed: (d) => d.speedPoints,
  safety: (d) => d.safetyPoints,
  pay: (d) => d.totalKes,
  standing: (d) => standingOf(d).rank,
  ...Object.fromEntries(VIOLATIONS.map((k) => [k, (d) => d.violations[k] ?? 0])),
};

export default function DriverScorecard() {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const options = useMemo(() => periods(), []);
  const [periodKey, setPeriodKey] = useState("7d");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  // Worst pay first: the scorecard's question is "who is losing money, and why".
  const [sortKey, setSortKey] = useState("pay");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);
  const cards = useMediaQuery(CARDS_QUERY);
  const step = cards ? PAGE_PHONE : PAGE;
  const period = options.find((p) => p.key === periodKey) ?? options[0];

  const { data, loading, stale, error, retry } = useApiData(
    () => getDriverScores({ companyId: activeCompanyId, from: period.from, to: period.to }),
    [activeCompanyId, period.from, period.to],
    { cacheKey: `ft-driver-scores:${activeCompanyId}:${period.from}:${period.to}`, keepPreviousData: true }
  );

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.drivers ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));
    const key = SORTS[sortKey] ?? SORTS.pay;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a.name.localeCompare(b.name);
    });
  }, [data, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / step));
  const at = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(at * step, at * step + step);

  const totals = useMemo(() => {
    const list = data?.drivers ?? [];
    return {
      drivers: list.length,
      days: list.reduce((n, d) => n + d.days, 0),
      kes: list.reduce((n, d) => n + d.totalKes, 0),
      violations: list.reduce((n, d) => n + VIOLATIONS.reduce((m, k) => m + (d.violations[k] ?? 0), 0), 0),
      tripPay: list.reduce((n, d) => n + d.tripPayDaysLost, 0),
      flagged: list.filter((d) => d.months.some((m) => m.standing !== "ok")).length,
    };
  }, [data]);

  const toggleSort = (k) => {
    setPage(0);
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "driver" ? "asc" : "desc"); }
  };

  if (error && !data) return <LoadError label="Driver scorecard" onRetry={retry} fullSection />;

  const cov = data?.coverage;
  const rules = data?.rules;
  const unattributed = cov ? cov.unattributed.overspeed + cov.unattributed.harshBrake + cov.unattributed.dashcam : 0;
  // First load: nothing to show yet, so placeholders. A period switch keeps
  // the last figures on screen, dimmed, under a moving bar (`stale`).
  const waiting = loading && !data;
  const refreshing = Boolean(stale);

  return (
    <section className="sc" aria-label="Driver scorecard">
      <div className="dr-filters">
        <div className="dr-filters__chips" role="group" aria-label="Period">
          <span className="dr-rankby__label" aria-hidden="true">Period</span>
          <span className="dr-seg">
            {options.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`dr-chip${p.key === periodKey ? " dr-chip--active" : ""}`}
                aria-pressed={p.key === periodKey}
                onClick={() => { setPeriodKey(p.key); setOpen(null); setPage(0); }}
              >
                {p.label}
              </button>
            ))}
          </span>
        </div>
        <div className="dr-searchwrap">
          <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            className="dr-search"
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search driver…"
            aria-label="Search driver"
          />
        </div>
      </div>

      <section className="dr-strip sc-strip" aria-label="Scorecard totals">
        <StatCell label="Drivers scored" loading={waiting} value={fmt(totals.drivers)}
                  sub={`${fmt(totals.days)} driver-days · ${period.from} – ${period.to}`} />
        <StatCell label="Speed + safety pay" loading={waiting} value={kes(totals.kes)} tone={toneOf(totals.kes)}
                  sub="all drivers, this period" />
        <StatCell label="Safety violations" loading={waiting} value={fmt(totals.violations)}
                  sub={`${fmt(totals.tripPay)} day${totals.tripPay === 1 ? "" : "s"} of trip pay lost`} />
        <StatCell label="Zero-tolerance" loading={waiting} value={fmt(totals.flagged)} tone={totals.flagged ? "sc-down" : ""}
                  sub="5+ violations in a month" />
      </section>

      {cov && (
        <ul className="sc-notes">
          <li>{coverageSentence(cov, unattributed)}</li>
          {cov.dashcam.note && <li className="sc-notes__warn">{cov.dashcam.note}</li>}
          {rules && <li>{rulesSentence(rules)}</li>}
          {data.manual?.length > 0 && <li className="sc-notes__quiet">{manualSentence(data.manual)}</li>}
        </ul>
      )}

      {waiting && (
        <p className="sc-status" role="status" aria-live="polite">
          Loading driver scores. The dashcam check can take up to 30 seconds.
        </p>
      )}

      <div className={`dr-grid-card sc-card${refreshing ? " sc-card--refreshing" : ""}`} aria-busy={waiting || refreshing}>
        {refreshing && <div className="sc-progress" role="progressbar" aria-label="Updating scores" />}
        <div className="dr-grid-scroll">
          <table className="dr-grid sc-grid">
            <thead>
              <tr>
                <SortTh label="Driver" k="driver" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Days" k="days" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <SortTh label="Speed pts" k="speed" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <SortTh label="Safety pts" k="safety" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                <SortTh label="Pay" k="pay" sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                {VIOLATIONS.map((k) => (
                  <SortTh key={k} label={KIND_LABEL[k]} k={k} sortKey={sortKey} dir={sortDir} onClick={toggleSort} num />
                ))}
                <SortTh label="Standing" k="standing" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {waiting && <SkeletonRows n={8} />}
              {data && sorted.length === 0 && (
                <tr><td colSpan={COLS} className="dr-grid__empty">
                  {query ? "No driver matches." : "No assigned driver drove in this period."}
                </td></tr>
              )}
              {pageRows.map((d) => {
                const isOpen = open === d.driverId;
                const st = standingOf(d);
                const plates = [...new Set(d.byDay.flatMap((x) => x.plates))];
                const toggle = () => setOpen(isOpen ? null : d.driverId);
                return (
                  <Fragment key={d.driverId}>
                    <tr
                      className={isOpen ? "dr-grid__row--selected" : ""}
                      onClick={toggle}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                      tabIndex={0}
                      aria-expanded={isOpen}
                    >
                      <td className="dr-drivercell">
                        <span className="dr-driver">
                          <span className="dr-avatar">{initialsOf(d.name)}</span>
                          <span className="dr-driver__ident">
                            <span className="dr-driver__name">{titleCase(d.name)}</span>
                            <span className="dr-driver__sub" title={plates.join(", ")}>
                              {plates.length ? plates.slice(0, 2).join(" · ") + (plates.length > 2 ? ` +${plates.length - 2}` : "") : "–"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="dr-num" data-label="Days">{fmt(d.days)}</td>
                      <td className={`dr-num ${toneOf(d.speedPoints)}`} data-label="Speed pts">{pts(d.speedPoints)}</td>
                      <td className={`dr-num ${toneOf(d.safetyPoints)}`} data-label="Safety pts">{pts(d.safetyPoints)}</td>
                      <td className={`dr-num sc-pay ${toneOf(d.totalKes)}`} data-label="Pay">{kes(d.totalKes)}</td>
                      {VIOLATIONS.map((k) => (
                        <ViolationCell key={k} n={d.violations[k] ?? 0} label={KIND_LABEL[k]} />
                      ))}
                      <td data-label="Standing">
                        <span className={`dr-grid__badge dr-grid__badge--${st.tone}`}>
                          <span className="dr-grid__dot" aria-hidden="true" />
                          {st.label}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="sc-detail">
                        <td colSpan={COLS}><DriverDays days={d.byDay} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="dr-pager" aria-label="Scorecard pages">
            <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>
              ← Prev
            </button>
            <span className="dr-pager__info" aria-live="polite">
              Page {at + 1} of {pageCount}
              <span className="dr-pager__range">
                {" · "}{fmt(at * step + 1)}–{fmt(at * step + pageRows.length)} of {fmt(sorted.length)}
              </span>
            </span>
            <button type="button" className="dr-pager__btn" onClick={() => setPage(Math.min(pageCount - 1, at + 1))} disabled={at >= pageCount - 1}>
              Next →
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}

/** The roster's sortable head (DriversScreen GridTh), same markup and classes. */
function SortTh({ label, k, sortKey, dir, onClick, num }) {
  const active = sortKey === k;
  return (
    <th className={num ? "dr-num" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="dr-grid__sort" onClick={() => onClick(k)} title={`Sort by ${label.toLowerCase()}`}>
        <span>{label}</span>
        <span className={"dr-caret" + (active ? ` dr-caret--${dir}` : "")} aria-hidden="true" />
      </button>
    </th>
  );
}

/** The roster's incident cell: a dot as well as the colour, so the count reads without the hue. */
function ViolationCell({ n, label }) {
  if (!n) return <td className="dr-num dr-num--zero" data-label={label}>0</td>;
  return (
    <td className="dr-num dr-incident dr-incident--theft" data-label={label}>
      <span className="dr-incident__dot" aria-hidden="true" />
      {fmt(n)}
    </td>
  );
}

/** One strip cell, in the Summary / trend cards' head + figure + caption stack. */
/** Placeholder rows in the grid's own shape while the first answer is on its way. */
function SkeletonRows({ n }) {
  return Array.from({ length: n }, (_, i) => (
    <tr key={i} className="sc-skel" aria-hidden="true">
      <td className="dr-drivercell">
        <span className="dr-driver">
          <span className="sc-skel__avatar" />
          <span className="sc-skel__lines"><span style={{ width: `${110 + (i * 37) % 60}px` }} /><span /></span>
        </span>
      </td>
      {Array.from({ length: COLS - 2 }, (_, j) => (
        <td key={j} className="dr-num"><span className="sc-skel__bar" /></td>
      ))}
      <td><span className="sc-skel__pill" /></td>
    </tr>
  ));
}

function StatCell({ label, value, sub, tone = "", loading = false }) {
  return (
    <div className="dr-cell">
      <div className="dr-statchart__head"><span className="dr-statchart__label">{label}</span></div>
      <div className={`dr-statchart__value ${tone}`}>
        {loading ? <span className="sc-skel__bar sc-skel__bar--figure" aria-label="Loading" /> : value}
      </div>
      <div className="dr-statchart__sub">{loading ? <span className="sc-skel__bar sc-skel__bar--caption" /> : sub}</div>
    </div>
  );
}

function DriverDays({ days }) {
  return (
    <ol className="sc-days">
      {days.map((d) => (
        <li key={d.day} className="sc-day">
          <div className="sc-day__head">
            <span className="sc-day__date">
              {new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
            </span>
            <span className="dr-veh">{d.plates.join(", ") || "–"}</span>
            <span className={toneOf(d.speedPoints)}>Speed {pts(d.speedPoints)}</span>
            <span className={toneOf(d.safetyPoints)}>
              Safety {pts(d.safetyPoints)}{d.safetyRaw !== d.safetyPoints ? ` (capped from ${pts(d.safetyRaw)})` : ""}
            </span>
            {d.losesTripPay && (
              <span className="dr-grid__badge dr-grid__badge--suspended">
                <span className="dr-grid__dot" aria-hidden="true" />Trip pay lost
              </span>
            )}
          </div>
          {d.events.length > 0 && (
            <ul className="sc-events">
              {d.events.map((e, i) => (
                <li key={i}>
                  <span className="sc-events__time">{hhmm(e.at)}</span>
                  <span className="sc-events__what">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  <span className="sc-events__value">
                    {e.value == null ? "" : e.kind === "harshBrake" ? `${e.value} m/s²` : `${e.value} km/h over`}
                  </span>
                  <span className="dr-veh">{e.plate}</span>
                  <span className="sc-down">{pts(e.points)} {e.rule}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
