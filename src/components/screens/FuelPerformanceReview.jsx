/**
 * Fuel › Report › Fleet review — every unit's refills against its standard.
 *
 * The operator's Kasulu "Fuel Issuance – Performance Review" (2026-10-08) as a
 * live page: where the fuel goes, whether it is used efficiently, the units
 * needing attention and the benchmarks, what to do, and the exhibit — each
 * unit's median refill as a share of its standard, worst at the top of its
 * group. The PDF export follows the same document page for page.
 *
 * Figures are the server's (fuel-performance-review.ts); the lists and the
 * wording are lib/performanceReview's, shared with the PDF and the dashboard.
 *
 * Litres put in are FactorySuite's pump issues (the SIV) where they are kept,
 * with the tank's rise on the probe beside them, and the work behind a pump
 * refill is the issue's own meter step. The fuel probes' refills and the
 * trackers' hours and km stand in on the days before the pump records start
 * (operator 2026-11-28: "for the days we don't have value the previous days
 * we use the fuel probes"). The source chip says which the period holds.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import "../body/SensorPanel.css";
import "./FuelReportScreen.css";
import "./FuelPerformanceReview.css";
import { getPerformanceReview } from "../../api/fuelReview";
import { readReview, pct, litres, monthLabel, band, listRefs, judgedWords, notAssessedWhy, mtdSpan } from "../../lib/performanceReview";
import { buildPerformanceReviewPdf } from "../../utils/performanceReviewPdf";
import { downloadTableCsv } from "../../utils/tableExport";
import TableToolbar from "../body/TableToolbar";
import EmptyNote from "../shared/EmptyNote";
import DateRangePicker from "../layout/DateRangePicker";

const DAY = 86_400_000;
const EAT = 3 * 3_600_000;
const todayKey = () => new Date(Date.now() + EAT).toISOString().slice(0, 10);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** The server judges at most this many days at once (fuel-performance-review.service MAX_DAYS). */
const MAX_DAYS = 366;
const PRESETS = [[30, "30 days"], [60, "60 days"], [90, "90 days"]];
const fmtDay = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function presetSpan(n) {
  const to = addDays(todayKey(), -1);
  return { id: n, from: addDays(to, -(n - 1)), to };
}

function Kpi({ n, label, tone, title }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ""}`} title={title}>
      <span className="sp4-kpi-n">{n}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

/** Horizontal bars, one per row, scaled to the largest. */
function Bars({ rows, tone, format }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="fpr-bars">
      {rows.map((r) => (
        <li key={r.label} className="fpr-bars__row">
          <span className="fpr-bars__l">{r.label}</span>
          <span className="fpr-bars__track">
            <span className={`fpr-bars__fill fpr-bars__fill--${r.tone ?? tone}`} style={{ width: `${(r.value / max) * 100}%` }} />
            <span className="fpr-bars__v">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Litres a day by month; a month with pump issues shows them as the solid part of its column. */
function MonthColumns({ months }) {
  const max = Math.max(...months.map((m) => m.perDay), 1);
  return (
    <div className="fpr-cols" role="img" aria-label="Average litres per day, by month, pump issues and probe refills">
      {months.map((m, i) => {
        const pump = m.litres ? (m.pumpL ?? 0) / m.litres : 0;
        return (
          <div key={m.month} className="fpr-cols__col"
               title={`${monthLabel(m.month)}: ${litres(m.litres)} over ${m.days} days${m.pumpL ? `, ${litres(m.pumpL)} issued at the pumps` : ""}${m.litres - (m.pumpL ?? 0) > 0.5 ? `, ${litres(m.litres - (m.pumpL ?? 0))} seen by the fuel probes` : ""}`}>
            <span className="fpr-cols__v">{m.perDay ? `${(m.perDay / 1000).toFixed(1)}k` : "-"}</span>
            <span className={`fpr-cols__bar${i === months.length - 1 ? " fpr-cols__bar--last" : ""}${pump > 0 ? " fpr-cols__bar--split" : ""}`}
                  style={{ height: `${(m.perDay / max) * 100}%`, "--pump": `${pump * 100}%` }} />
            <span className="fpr-cols__l">{monthLabel(m.month)}<small>{m.days} days</small></span>
          </div>
        );
      })}
    </div>
  );
}

/** What the period's litres are, in words: the pumps, the probes or both. */
function sourceWords(review) {
  if (!review || review.source === "telemetry") return { icon: "ti-antenna", text: "Fuel probes: sensor-confirmed refills, tracker hours and km" };
  if (review.source === "pump") return { icon: "ti-gas-station", text: "Pump issues (SIV), pump meter hours and km, tank rise on the probe" };
  return { icon: "ti-gas-station", text: `Pump issues from ${fmtDay(review.pumpFrom)}, fuel probes before` };
}

/** Issued litres against what the tank rose by, over the issues the probe read. */
const reached = (u) => (u.issuedWithTankL > 0 ? u.tankL / u.issuedWithTankL : null);

const SCALE = 2.5; // the exhibit's axis runs to 250%…
const TRACK = 78;  // …across this share of the row, leaving room for the figure

/** One group's units, worst at the top, against the 100% standard line. */
function Exhibit({ group, units, busiestId, suspect, onOpen }) {
  const assessed = units.filter((u) => u.ratio != null).sort((a, b) => b.ratio - a.ratio);
  // Units that cannot be judged go in one line under the chart, not a bar
  // each: a column of "0 usable refills" rows was most of some charts' height.
  const rest = units.filter((u) => u.ratio == null);
  const rows = assessed;
  const best = assessed.at(-1);
  return (
    <section className="fpr-ex">
      <h4 className="fpr-ex__t">{group} <span>{units.length} unit{units.length === 1 ? "" : "s"}</span></h4>
      {suspect && <p className="fpr-ex__note">Every unit is far under standard: the standards look set too high to judge these machines.</p>}
      <ul className="fpr-ex__rows">
        {rows.map((u) => (
          <li key={u.id}>
            <button type="button" className="fpr-ex__row" onClick={() => onOpen?.(u.id)}
                    title={`${u.name} - ${u.ratio != null ? `${pct(u.ratio)} of standard over ` : ""}${judgedWords(u)}, ${litres(u.litres)} put in. Open its vehicle analytics.`}>
              <span className="fpr-ex__ref">{u.ref}{u.id === busiestId && <i aria-label="largest fuel user"> ★</i>}</span>
              <span className="fpr-ex__track">
                <span className="fpr-ex__std" aria-hidden="true" style={{ left: `${TRACK / SCALE}%` }} />
                {u.ratio != null
                  ? <span className={`fpr-ex__bar fpr-ex__bar--${suspect ? "none" : band(u)}`} style={{ width: `${Math.min(u.ratio / SCALE, 1) * TRACK}%` }} />
                  : null}
                <span className="fpr-ex__v">
                  {pct(u.ratio)}
                  {!suspect && assessed.length > 1 && u.id === assessed[0]?.id && u.ratio >= 1.1 && <b className="fpr-ex__tag fpr-ex__tag--worst"> ← worst</b>}
                  {!suspect && assessed.length > 1 && u.id === best?.id && <b className="fpr-ex__tag fpr-ex__tag--best"> ← best</b>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <p className="fpr-ex__rest">
          <b>Not assessed ({rest.length}):</b>{" "}
          {rest.map((u, i) => {
            const why = notAssessedWhy(u);
            return (
              <span key={u.id}>{i > 0 && ", "}<button type="button" onClick={() => onOpen?.(u.id)} title={why.long}>{u.ref}</button>{why.short ? ` (${why.short})` : ""}</span>
            );
          })}
        </p>
      )}
    </section>
  );
}

export default function FuelPerformanceReview({ orgId, orgName, onOpenUnit }) {
  // A machine the pumps fuel that is no unit of ours (server id "machine:…",
  // hired vehicles, untracked generators) has no vehicle analytics to open.
  const openOwn = (id) => { if (!String(id).startsWith("machine:")) onOpenUnit?.(id); };
  const [span, setSpan] = useState(() => presetSpan(90));
  const { data: review, status, error, refetch, isFetching } = useQuery({
    queryKey: ["fuel-performance-review", orgId, span.from, span.to],
    queryFn: () => getPerformanceReview({ orgId, from: span.from, to: span.to }),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const read = useMemo(() => readReview(review), [review]);

  const exportPdf = () => review && buildPerformanceReviewPdf({ review, read, orgName });
  const exportCsv = () => review && downloadTableCsv({
    head: ["Unit", "Name", "Group", "Standard", "Litres", "Issued at pump L", "Probe refills L", "Tank rise L", "Issued, probe read L",
           "Refills", "Usable refills", "Planned shifts", "Shifts judged", "Shift hours", "Burned in shifts L", "Shift standard L",
           "Judged on", "Litres judged", "% of standard", "Excess L", "Hours / km", "Refills against no work", "Not assessed because"],
    body: review.units.map((u) => [
      u.ref, u.name, u.group,
      u.rate == null ? "" : `${u.rate} ${u.basis === "HOURS" ? "L/h" : "km/L"}`,
      Math.round(u.litres), Math.round(u.pumpL ?? 0), Math.round(u.probeL ?? u.litres), Math.round(u.tankL ?? 0), Math.round(u.issuedWithTankL ?? 0),
      u.refills, u.usableRefills,
      u.shifts ?? 0, u.judgedShifts ?? 0, Math.round((u.shiftHours ?? 0) * 10) / 10, Math.round(u.consumedL ?? 0), Math.round(u.shiftStandardL ?? 0),
      u.judgedOn ?? "", Math.round(u.judgedL ?? 0),
      u.ratio == null ? "" : Math.round(u.ratio * 100), Math.round(u.excessL), Math.round(u.work), u.nearZeroWork,
      u.ratio == null ? notAssessedWhy(u).long : "",
    ]),
    filenameSlug: `fuel-performance-review-${span.from}-${span.to}`,
  });

  const t = review?.totals;
  const dot = <span className="frp-kpi-none">-</span>;
  const p = read?.pace;
  const src = sourceWords(review);
  const pumped = Boolean(t?.pumpL);
  const tankShare = t?.issuedWithTankL ? t.tankL / t.issuedWithTankL : null;
  const checks = t?.checks;

  return (
    <div className="sp4-root frp-root fpr-root">
      <div className="sp4-header">
        <div data-tour="fpr-kpis" className="sp4-header-kpis">
          <Kpi n={t ? litres(t.litres, { short: true }) : dot} label="Put in" tone="fleet"
               title={!t ? "" : pumped
                 ? `${litres(t.pumpL)} issued at the pumps${t.probeL > 0.5 ? ` and ${litres(t.probeL)} seen by the fuel probes before the pump records` : ""}, over ${review.days} days`
                 : `Litres the fuel sensors saw go in over ${review.days} days`} />
          {pumped && (
            <Kpi n={tankShare != null ? `${Math.round(tankShare * 100)}%` : dot} label="Reached the tank" tone={tankShare != null && tankShare < 0.9 ? "speed" : "live"}
                 title={tankShare != null ? `The tanks rose ${litres(t.tankL)} on the probes for ${litres(t.issuedWithTankL)} issued, over the issues a probe read` : "No probe read a pump issue in this period"} />
          )}
          {/* Counted, not projected (operator 2026-11-28: "if its a cooked number
              get rid of it"): every litre put in from the 1st to the last day. */}
          <Kpi n={review?.monthToDate ? litres(review.monthToDate.litres, { short: true }) : dot}
               label={review?.monthToDate ? mtdSpan(review.monthToDate) : "Month to date"} tone="stat"
               title={review?.monthToDate ? `Litres put in from ${review.monthToDate.from} to ${review.monthToDate.to}, counted off the pump issues (and probe refills before them)` : ""} />
          <Kpi n={p?.change != null ? `${p.change >= 0 ? "+" : ""}${Math.round(p.change * 100)}%` : dot}
               label={p ? `${monthLabel(p.latest.month)} pace` : "Pace"} tone={p?.change > 0.05 ? "fuel" : "live"}
               title="The latest month's litres a day against the full months before it" />
          <Kpi n={t ? litres(t.excessL, { short: true }) : dot} label={t ? `Above standard · ${(t.excessShare * 100).toFixed(1)}%` : "Above standard"} tone="speed"
               title={t ? `${litres(t.excessL)} above standard, of the ${litres(t.judgedL ?? 0)} judged against a standard (burned in planned shifts, or put in on usable refills)` : ""} />
        </div>
      </div>

      <div data-tour="fpr-period" className="sp4-filterbar frp-filterbar">
        <div className="sp4-filter-group frp-period" role="group" aria-label="Period">
          {PRESETS.map(([n, label]) => (
            <button key={n} type="button" className={`sp4-filter-chip${span.id === n ? " sp4-filter-chip--on" : ""}`}
                    aria-pressed={span.id === n} onClick={() => setSpan(presetSpan(n))}>{label}</button>
          ))}
        </div>
        {/* Any days up to today, as the other reports' picker (operator 2026-11-28:
            "we also need to custom pick the date"); the chips stay as quick picks. */}
        <DateRangePicker from={span.from} to={span.to} today={todayKey()} maxDays={MAX_DAYS} spans={[]} quickPicks={false}
                         label="Days" on={span.id == null}
                         onChange={(from, to) => setSpan({ id: null, from, to: to ?? from })} />
        <span className="fpr-source" title={src.text}>
          <i className={`ti ${src.icon}`} aria-hidden="true" /> {src.text}
        </span>
      </div>

      <div className="sp4-body fpr-body">
        {status === "pending" ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Building the Review">
            Judging every unit's refills against its standard.
          </EmptyNote>
        ) : status === "error" ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Review Could Not Be Built" action={{ label: "Try again", onClick: () => refetch() }}>
            {error?.message ?? "The server did not answer."}
          </EmptyNote>
        ) : !review || !review.units.length ? (
          <EmptyNote icon="ti-gas-station-off" title="No Refills in This Period">
            No pump issued fuel and the fuel sensors confirmed no refills between these dates, so there is nothing to judge.
          </EmptyNote>
        ) : !review.totals.unitsWithStandard ? (
          // No unit has a standard rate (L/h or km/L) on record, so there is
          // nothing to judge against — say so rather than listing every unit
          // as "not assessed". Standards come from FactorySuite's machine
          // register, which covers Kasulu only today.
          <EmptyNote icon="ti-ruler-off" title="No Standards on Record">
            Performance compares each unit's refills with its standard fuel rate (litres an hour or km a litre).
            None of {orgName ? `${orgName}'s` : "this organisation's"} {review.totals.units} refuelled units has a standard yet.
            Once standards are added to the machine register, this page fills in.
          </EmptyNote>
        ) : (
          <>
            <TableToolbar
              summary={<><b>{t.units}</b> units · <b>{t.refills.toLocaleString("en-KE")}</b> refills{t.shifts?.worked ? <> · <b>{t.shifts.worked}</b> planned shifts</> : null} · {fmtDay(review.from)} – {fmtDay(review.to)} · <b>{t.assessedUnits}</b> judged against a standard</>}
              loading={isFetching}
              onReload={() => refetch()}
              onCsv={exportCsv}
              onPdf={exportPdf}
            />

            {/* The verdict first, in a sentence, then the review in three
                movements read top to bottom: where the fuel goes, who to act
                on, and the exhibit. Hairline sections, not a wall of cards. */}
            <p className="fpr-lede">
              <b>{litres(t.litres, { short: true })}</b> went in over {review.days === 1 ? "the day" : `${review.days} days`}
              {p?.change != null && <>, {p.change >= 0 ? "rising" : "falling"} ({p.change >= 0 ? "+" : ""}{Math.round(p.change * 100)}% a day in {monthLabel(p.latest.month)})</>}.
              {" "}Of the <b>{litres(t.judgedL ?? 0, { short: true })}</b> judged against a standard, <em>{litres(t.excessL, { short: true })}</em> was above the expected rate
              {read.attention.length > 0 && <>, and most of that traces back to {read.attention.length} named unit{read.attention.length === 1 ? "" : "s"}</>}.
            </p>

            <section className="fpr-sec" aria-labelledby="fpr-where">
              <h3 className="fpr-sec__h" id="fpr-where">Where the Fuel Goes</h3>
              <div className="fpr-strip">
                <section data-tour="fpr-perday" className="fpr-panel fpr-panel--months">
                  <h4 className="fpr-panel__t">Litres Put In per Day</h4>
                  <MonthColumns months={review.months} />
                </section>
                <section data-tour="fpr-share" className="fpr-panel">
                  <h4 className="fpr-panel__t">Share of All Fuel</h4>
                  <Bars format={(v) => `${(v * 100).toFixed(1)}%`} tone="fleet"
                        rows={[...read.topGroups.map((g) => ({ label: g.group, value: g.share })),
                               ...(review.groups.length > 5 ? [{ label: "All other equipment", value: 1 - read.topShare, tone: "muted" }] : [])]} />
                </section>
                <section data-tour="fpr-above" className="fpr-panel">
                  <h4 className="fpr-panel__t">Litres Above Standard</h4>
                  <Bars format={(v) => litres(v, { short: true })} tone="crit"
                        rows={[...review.groups].filter((g) => g.excessL > 0).sort((a, b) => b.excessL - a.excessL).slice(0, 6)
                          .map((g) => ({ label: g.group, value: g.excessL }))} />
                </section>
                <section data-tour="fpr-refills" className="fpr-panel">
                  <h4 className="fpr-panel__t">Refill Records <span>{read.recordsTotal.toLocaleString("en-KE")}</span></h4>
                  <Bars format={(v) => `${Math.round((v / Math.max(1, read.recordsTotal)) * 100)}%`} tone="fleet"
                        rows={[
                          { label: "At or near standard", value: review.records.near, tone: "ok" },
                          { label: "Well over standard", value: review.records.over, tone: "crit" },
                          { label: "Implausible", value: review.records.implausible, tone: "warn" },
                          { label: "Data missing", value: review.records.missing, tone: "muted" },
                        ]} />
                </section>
              </div>
              {pumped && (
                // The pumps against the tanks: what was issued and what the
                // probe saw arrive, over the issues a probe read, and how
                // FactorySuite's own sensor check came out on each issue.
                <div className="fpr-strip fpr-strip--two">
                  <section data-tour="fpr-tank" className="fpr-panel">
                    <h4 className="fpr-panel__t">Issued against Tank Rise <span>{tankShare != null ? `${Math.round(tankShare * 100)}% reached the tank` : "no probe readings"}</span></h4>
                    <Bars format={(v) => litres(v, { short: true })} tone="fleet"
                          rows={[
                            { label: "Issued at the pumps", value: t.pumpL, tone: "fleet" },
                            { label: "Issued, probe read", value: t.issuedWithTankL, tone: "muted" },
                            { label: "Tank rise on the probe", value: t.tankL, tone: tankShare != null && tankShare < 0.9 ? "warn" : "ok" },
                          ]} />
                  </section>
                  <section data-tour="fpr-checks" className="fpr-panel">
                    <h4 className="fpr-panel__t">Pump Issues by Probe Check <span>{(checks.match + checks.mismatch + checks.noSensor + checks.noReading).toLocaleString("en-KE")}</span></h4>
                    <Bars format={(v) => `${v.toLocaleString("en-KE")}`} tone="fleet"
                          rows={[
                            { label: "Tank rise matches", value: checks.match, tone: "ok" },
                            { label: "Tank rise does not match", value: checks.mismatch, tone: "crit" },
                            { label: "No fuel sensor", value: checks.noSensor, tone: "muted" },
                            { label: "Sensor gave no reading", value: checks.noReading, tone: "warn" },
                          ]} />
                  </section>
                </div>
              )}
            </section>

            <section className="fpr-sec" aria-labelledby="fpr-act">
              <h3 className="fpr-sec__h" id="fpr-act">What to Act On</h3>
              <div className="fpr-act">
                <div data-tour="fpr-attention" className="fpr-act__main">
                  <h4 className="fpr-panel__t">
                    Units Needing Attention
                    {read.attention.length > 0 && <span>{read.attention.length} at 10% or more over</span>}
                  </h4>
                  {read.attention.length ? (
                    <table className="fpr-att">
                      <thead><tr>
                        <th>Unit</th><th>Against standard</th><th className="fpr-num" title="Usable refills, or planned shifts (sh) for a machine judged on the work plan">Judged on</th>{pumped && <th className="fpr-num" title="Tank rise on the probe against litres issued">In tank</th>}<th className="fpr-num">Above</th>
                      </tr></thead>
                      <tbody>
                        {read.attention.slice(0, Math.max(6, Math.min(8, read.benchmarks.length))).map((u) => (
                          <tr key={u.id} onClick={() => openOwn(u.id)} title={`Open ${u.name}'s vehicle analytics`}>
                            <td>
                              <button type="button" className="fpr-unit" onClick={(e) => { e.stopPropagation(); openOwn(u.id); }}>{u.ref}</button>
                              <small>{u.group.replace(/s$/, "")}</small>
                            </td>
                            <td>
                              <span className="fpr-gauge" aria-hidden="true">
                                <span className="fpr-gauge__std" style={{ left: `${100 / SCALE}%` }} />
                                <span className={`fpr-gauge__fill fpr-gauge__fill--${band(u)}`} style={{ width: `${Math.min(u.ratio / SCALE, 1) * 100}%` }} />
                              </span>
                              <b className="fpr-gauge__v">{pct(u.ratio)}</b>
                            </td>
                            <td className="fpr-num" title={judgedWords(u)}>{u.judgedOn === "shifts" ? `${u.judgedShifts} sh` : u.usableRefills}</td>
                            {pumped && <td className="fpr-num">{reached(u) != null ? `${Math.round(reached(u) * 100)}%` : "-"}</td>}
                            <td className="fpr-num fpr-num--crit">{litres(u.excessL)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="fpr-quiet">No unit is 10% or more over standard.</p>}
                </div>

                <div data-tour="fpr-benchmark" className="fpr-act__side">
                  <h4 className="fpr-panel__t">Benchmark Performers</h4>
                  {read.benchmarks.length ? (
                    <dl className="fpr-bench">
                      {read.benchmarks.slice(0, 8).map((b) => (
                        <div key={b.group}>
                          <dt>{b.group}</dt>
                          <dd>
                            {b.units.map((u, i) => (
                              <span key={u.id}>{i > 0 && " · "}<button type="button" className="fpr-unit" onClick={() => openOwn(u.id)}>{u.ref}</button> {pct(u.ratio)}{u.id === b.busiestId && <i title="Largest fuel user in the group"> ★</i>}</span>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="fpr-quiet">No unit is within standard yet.</p>}
                </div>
              </div>

              {read.actions.length > 0 && (
                <div data-tour="fpr-todo" className="fpr-todo">
                  <h4 className="fpr-panel__t">What to Do <span>about {litres(read.excessPerMonth, { short: true })} a month goes in above standard</span></h4>
                  <ol>{read.actions.map((a) => <li key={a}>{a}</li>)}</ol>
                  {read.meterFixes.length > 0 && (
                    <p className="fpr-todo__note"><i className="ti ti-gauge" aria-hidden="true" /> <b>Readings to check:</b> {listRefs(read.meterFixes.slice(0, 8))}: most refills were logged against next to no hours or km: a meter keyed at the pump the same as last time, or a tracker meter that is not reporting.</p>
                  )}
                </div>
              )}
            </section>

            <section data-tour="fpr-each" className="fpr-sec" aria-labelledby="fpr-each">
              <h3 className="fpr-sec__h" id="fpr-each">How Each Unit Compares with Its Standard</h3>
              <div className="fpr-legend">
                <span><i className="fpr-sw fpr-sw--over" />10% or more above</span>
                <span><i className="fpr-sw fpr-sw--slight" />Up to 10% above</span>
                <span><i className="fpr-sw fpr-sw--within" />Within standard</span>
                <span><i className="fpr-sw fpr-sw--none" />Cannot be assessed</span>
                <span><i className="fpr-sw fpr-sw--std" />Standard (100%)</span>
                <span>★ Largest fuel user in group</span>
              </div>
              <div className="fpr-exhibits">
                {review.groups.map((g) => (
                  <Exhibit key={g.group} group={g.group} units={read.byGroup.get(g.group) ?? []}
                           busiestId={[...(read.byGroup.get(g.group) ?? [])].sort((a, b) => b.litres - a.litres)[0]?.id}
                           suspect={read.suspectGroups.includes(g.group)} onOpen={openOwn} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
