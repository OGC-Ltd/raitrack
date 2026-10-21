/* Hallmark · component: measure-switched bar series + bridge rail
 * genre: modern-minimal · theme: in-project (an-* tokens, preserved)
 * states: default · hover · focus-visible · switched · gapped · empty
 *         · loading · uncaptured
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 * contrast: pass — all ink via --ink / --text-2 / --text-3, both themes
 */

// The weighbridges over the window, in place of the sales paperwork.
//
// This card took the slot Sugar Delivered per Day held. The two answer the same
// question — how much left the gate — from opposite ends: that one summed the
// dispatches the sales office raised, this one sums what the scales actually
// weighed. For a mill running four bridges the scale is the better witness, and
// it carries three things the paperwork cannot: how many lorries it took, how
// long each waited between its two weighings, and which bridge did the work.
//
// ## A gap is not a zero, and they must not look alike
//
// The one rule this card exists to keep. The provider's feed serves a rolling
// two days and cannot be backfilled, so the table holds only the days the
// ingest was running for — six at the time of writing, against a default
// window of thirty. The server marks every day `captured` or not and sends
// NULLS for the ones it cannot speak for.
//
// Here that becomes: an uncaptured day is not in the series at all, so the bar
// chart draws nothing over it and the axis shows the break. A captured day with
// no ticket IS in the series, at zero, sitting on the axis. One reads as "we
// were not listening", the other as "nothing crossed". Drawing the first as a
// zero would report a factory idle for most of a month, and the heading above
// the card would be standing over three weeks that never happened — which is
// why the subtitle states the captured span rather than the window asked for.
//
// ## Four measures, one at a time
//
// Tonnes, tickets, lorries and the wait are four different questions about the
// same days, not four series to overlay: the first is in thousands of
// kilogrammes and the last in hours, and plotting them together would flatten
// three of them to the axis. The switch is the sibling FuelRateChart's, which
// changes the question rather than the zoom, for the same reason.
//
// ## The wait is a median with its tail beside it
//
// And it is NOT loading time, whatever the scale software calls it. Measured
// over the live table the middle ticket is 7h 39m between its two weighings,
// the 90th 20h 37m: a lorry weighs empty at an outstation, drives out to the
// cane, and comes back loaded. That is a haulage cycle, and the card says so —
// a label reading "loading" over seven hours would have an operator hunting a
// bottleneck at the scale that is really a distance to the farm.
//
// A mean would follow that tail and describe no lorry. The median is the lorry
// in the middle, and the 90th is drawn beside it as a paired, paler bar — so
// the spread is one glance rather than a second chart, and the gap between the
// two bars IS the spread.

import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";

const HOUR = 3_600_000;

/** The four questions. `axis` is what the Y axis is counting IN — it is the
 *  unit, not a label for the card. */
const MEASURES = [
  {
    key: "netT", label: "Tonnes", axis: "t",
    /* Kilogrammes to tonnes here rather than server-side: the API speaks in the
       unit the scale records in, and every other reader of it should not have
       to know this card divides by a thousand. */
    of: (d) => (d.netKg == null ? null : d.netKg / 1000),
    digits: 0,
    tip: (v) => `${fmt(v, 1)} t`,
    blurb: "weighed in",
  },
  {
    key: "tickets", label: "Tickets", axis: "",
    of: (d) => d.tickets,
    digits: 0,
    tip: (v) => `${fmt(v, 0)} tickets`,
    blurb: "raised",
  },
  {
    key: "lorries", label: "Lorries", axis: "",
    of: (d) => d.lorries,
    digits: 0,
    tip: (v) => `${fmt(v, 0)} lorries`,
    blurb: "at the scales",
  },
  {
    key: "wait", label: "Wait", axis: "h",
    of: (d) => (d.turnaroundP50Ms == null ? null : d.turnaroundP50Ms / HOUR),
    /* The only measure with a second series: the 90th, paired beside the
       median. The height difference between the two bars is the spread, which
       is the thing worth acting on — a middle of 7h with a tail at 10h is a
       different operation from the same middle with a tail at 25h. */
    of2: (d) => (d.turnaroundP90Ms == null ? null : d.turnaroundP90Ms / HOUR),
    digits: 1,
    tip: (v) => hours(v * HOUR),
    blurb: "between weighings",
  },
];

const fmt = (n, d = 1) =>
  n == null ? "-" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

/** Milliseconds as an operator says them: "7h 39m", and "48m" under the hour.
 *  Never "0.5 h" — nobody at a weighbridge says that. */
function hours(ms) {
  if (ms == null) return "-";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/* en-US, like every other date on the Analytics page. en-GB was giving
   "14 Sept" — day first, and a four-letter abbreviation for the one month
   Intl spells that way — two rows under a card head reading "Sep 14". */
const fmtDay = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US",
    { month: "short", day: "numeric", timeZone: "UTC" });

/** "Sep 8" or "Sep 8–13", and across a month boundary both months are named. */
function span(first, last) {
  if (!first) return null;
  if (first === last) return fmtDay(first);
  const a = new Date(`${first}T00:00:00Z`);
  const b = new Date(`${last}T00:00:00Z`);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${fmtDay(first)}–${b.getUTCDate()}`
    : `${fmtDay(first)} – ${fmtDay(last)}`;
}

function TipBody({ active, payload, measure }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="an-rate__tip">
      <div className="an-rate__tip-sub">{fmtDay(d.day)}</div>
      <div className="an-rate__tip-sub">
        <span>{measure.label}</span><strong>{measure.tip(d.v)}</strong>
      </div>
      {measure.of2 && (
        <div className="an-rate__tip-sub">
          <span>Slowest tenth</span><strong>{measure.tip(d.v2)}</strong>
        </div>
      )}
      {/* Every measure carries its own denominator, because three of them rest
          on different counts: a day's wait stands on the tickets that had both
          stamps, which is not always the tickets it raised. */}
      <div className="an-rate__tip-sub">
        <span>{measure.key === "wait" ? "Timed" : "Tickets"}</span>
        <strong>
          {measure.key === "wait"
            ? `${fmt(d.ticketsTimed, 0)} of ${fmt(d.tickets, 0)}`
            : fmt(d.tickets, 0)}
        </strong>
      </div>
    </div>
  );
}

export default function WeighbridgeAnalytics({ data, loading }) {
  const [measure, setMeasure] = useState(MEASURES[0]);

  const { points, gaps, hasAny } = useMemo(() => {
    const all = data?.days ?? [];
    // Only the captured days become points. An uncaptured day is left OUT of
    // the series rather than plotted as null: recharts would still reserve its
    // slot on a category axis, and a run of reserved slots reads as a stretch
    // of flat zeroes. Out of the series, the axis simply does not mention it.
    const kept = all.filter((d) => d.captured);
    return {
      points: kept.map((d) => ({
        day: d.day,
        v:   measure.of(d),
        v2:  measure.of2 ? measure.of2(d) : null,
        tickets: d.tickets,
        ticketsTimed: d.ticketsTimed,
      })),
      gaps: all.length - kept.length,
      hasAny: kept.some((d) => (d.tickets ?? 0) > 0),
    };
  }, [data, measure]);

  // The mean of the days that WORKED, as the sibling tonnage chart draws it:
  // a line dragged down by days nobody weighed on is not something a day can
  // be compared against.
  const mean = useMemo(() => {
    const vals = points.map((p) => p.v).filter((v) => v != null && v > 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [points]);

  const t = data?.totals;
  const captured = data?.captured;
  const topNet = Math.max(1, ...(data?.centres ?? []).map((c) => c.netKg));

  return (
    <div className="an-hist an-wb">
      <div className="an-card__head an-rate__head">
        <span className="an-card__title">Weighbridge analytics</span>
        <div className="an-rate__views" role="group" aria-label="Choose measure">
          {MEASURES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={"an-chip" + (m.key === measure.key ? " an-chip--on" : "")}
              aria-pressed={m.key === measure.key}
              onClick={() => setMeasure(m)}
            >{m.label}</button>
          ))}
        </div>
      </div>

      {!hasAny ? (
        <div className="an-hist__empty">
          {/* Three different nothings, and they must not read alike — the same
              rule the tonnage chart it replaced was built on. Still fetching;
              the server is too old to have the route at all; and a real,
              measured quiet at the scales. */}
          {loading
            ? "Reading the bridges…"
            : data
              ? "No ticket was raised at any bridge in the days we hold."
              : "Weighbridge data is not available from this server yet."}
        </div>
      ) : (
        <>
          {/* Said BEFORE the chart, not in the footer. The window on the filter
              bar above may be 30 or 90 days and this is drawing six, and a
              reader who takes the heading at face value reads the fall from
              4,529 t to 232 t as a collapse in throughput rather than as the
              ingest window closing. */}
          <div className="an-wb__span">
            {captured && <><b>{span(captured.first, captured.last)}</b> - </>}
            {fmt(data?.capturedDays, 0)} day{data?.capturedDays === 1 ? "" : "s"} of
            tickets in a {fmt(data?.days?.length, 0)}-day window
            {gaps > 0 && (
              <span className="an-wb__gap">
                {" "}· {fmt(gaps, 0)} day{gaps === 1 ? "" : "s"} not captured, drawn as a break
              </span>
            )}
          </div>

          <div className="an-hist__chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--grid)" />
                <XAxis
                  dataKey="day"
                  tickFormatter={fmtDay}
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={18}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={34}
                  label={measure.axis ? {
                    value: measure.axis, position: "insideTopLeft",
                    offset: 0, style: { fontSize: 10, fill: "var(--muted)" },
                  } : undefined}
                />
                <Tooltip content={<TipBody measure={measure} />} cursor={{ fill: "var(--hover, rgba(127, 127, 127, 0.12))" }} />
                {mean != null && (
                  <ReferenceLine
                    y={mean}
                    stroke="var(--chart-4)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                  />
                )}
                {/* Paler, and always the taller of the pair — it is the same
                    quantity at a different point in the distribution, not a
                    second measurement, so it must not compete with the median
                    beside it for the eye. */}
                {measure.of2 && (
                  <Bar dataKey="v2" fill="var(--chart-4)" fillOpacity={0.26}
                       radius={[3, 3, 0, 0]} maxBarSize={26} />
                )}
                <Bar dataKey="v" fill="var(--chart-4)" radius={[3, 3, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* The four bridges, ranked by what they weighed.
              A rail rather than a second chart: this is one number per bridge
              over the whole window, and four bars on their own axis would be a
              chart carrying four data points. The rule under each is the
              tonnage said again as a length, so the ranking is readable without
              comparing digits. */}
          {(data?.centres ?? []).length > 0 && (
            <ul className="an-wb__rail">
              {data.centres.map((c) => (
                <li key={c.code} className="an-wb__bridge"
                    style={{ "--c-share": c.netKg / topNet }}>
                  <span className="an-wb__name">{c.name}</span>
                  <span className="an-wb__fig">{fmt(c.netKg / 1000, 0)} t</span>
                  <span className="an-wb__sub">
                    {fmt(c.tickets, 0)} tickets · {fmt(c.lorries, 0)} lorries ·{" "}
                    {hours(c.turnaroundP50Ms)} wait
                    {/* A bridge that worked two of six days is a different
                        statement from one that worked all six for the same
                        tonnage, and the weight alone cannot tell them apart. */}
                    {data.capturedDays > 0 && c.activeDays < data.capturedDays && (
                      <> · {c.activeDays} of {data.capturedDays} days</>
                    )}
                  </span>
                  <i className="an-wb__rule" aria-hidden="true" />
                </li>
              ))}
            </ul>
          )}

          <div className="an-rate__foot">
            <span>
              <b>{fmt((t?.netKg ?? 0) / 1000, 0)} t</b> over{" "}
              <b>{fmt(t?.tickets, 0)}</b> tickets and{" "}
              <b>{fmt(t?.lorries, 0)}</b> lorries
              {/* Not the sum of the day column. The same contractor comes back
                  most days, so summing it counts one machine six times. */}
              {" "}on {fmt(t?.activeDays, 0)} working day{t?.activeDays === 1 ? "" : "s"}.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
