/* Hallmark · component: annotated line · genre: modern-minimal · theme: in-project
 * states: default · hover · focus · empty · loading · gap
 */

// What the measurable machines spend per unit of work, day by day.
//
// ## The numerator is measured from the tank, and was not always
//
// Until 2026-08-28 it summed the MODELLED burn — a rate times engine hours,
// where the rate is a type median for most of the fleet. Against the measured
// balance on the same days that ran 1.4x-1.6x high on KASULU and 2.2x-3.4x on
// SUKARI, and it wandered: SUKARI's measured L/km held between 0.47 and 0.56
// across the whole window while the modelled figure swung 0.74 to 1.21.
//
// ## It is not the whole yard, and the footer says so
//
// A tank balance only closes for a machine-day that clears the physical guards
// — about 77 of 218 active on a KASULU day. The distance and ground in the
// denominators are summed over exactly those same machine-days, so the ratio
// describes one population rather than dividing part of the fleet's fuel by all
// of its work. `vehicles` carries the count per day and the foot prints it,
// because a rate whose population is unstated invites being read as the yard's.
//
// Read the kilometre view knowing what is in it. Plant that digs all day
// reports almost no distance while burning, because position freezes at speed 0
// on this telemetry, and that fuel is still in the numerator. On a digging day
// the hectare view is the one that means something.
//
// ## The annotations are computed, not authored
//
// The band is the series' own mean ± one standard deviation, the dashed line is
// its mean, and the marked point is its worst day. None of it is a note
// somebody typed about an event they remembered: a chart shipped with authored
// annotations starts lying the first time the data moves, and this one redraws
// every fifteen minutes.
//
// ## Gaps are gaps
//
// A day with too little ground or distance behind it carries null, and the line
// breaks there rather than dropping to the axis. A zero would read as a day the
// fleet worked for nothing, which is the opposite of what a missing denominator
// means.

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ReferenceDot, ResponsiveContainer,
} from "recharts";

const VIEWS = [
  { key: "litresPerHectare", label: "L / hectare", stat: "perHectare",
    unit: "L/ha", denom: "hectares", denomLabel: "ha",
    // Not "the whole fleet's" any more, which is what these said while the
    // numerator was modelled and therefore existed for every machine.
    note: "Measured from the tank, over the ground those machines covered" },
  { key: "litresPerKm", label: "L / kilometre", stat: "perKm",
    unit: "L/km", denom: "km", denomLabel: "km",
    note: "Measured from the tank, over the distance those machines drove" },
];

const fmtDay = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", timeZone: "UTC" });

const fmt = (n, d = 1) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

/**
 * @param views  Which denominators to offer, by key. Defaults to all of them.
 *               A haulage fleet passes ["litresPerKm"]: the hectare view is
 *               excavator work and means nothing to a truck, so it is not
 *               offered rather than offered and left empty. With one view the
 *               toggle disappears entirely — a group of one button is a label
 *               pretending to be a control.
 */
export default function FuelRateChart({ series, views }) {
  const shown = useMemo(
    () => (views?.length ? VIEWS.filter(v => views.includes(v.key)) : VIEWS),
    [views],
  );
  const [viewKey, setViewKey] = useState(null);
  // Resolved rather than stored, so a `views` prop that no longer contains the
  // selected denominator falls back instead of rendering an empty chart.
  const view = shown.find(v => v.key === viewKey) ?? shown[0] ?? VIEWS[0];
  const setView = (v) => setViewKey(v.key);
  const stats = series?.[view.stat];

  const data = useMemo(
    () => (series?.days ?? []).map(d => ({
      day: d.day,
      v: d[view.key],
      denom: d[view.denom],
      litres: d.litres,
      vehicles: d.vehicles,
    })),
    [series, view],
  );

  const hasAny = data.some(d => d.v != null);

  /**
   * Days the fleet worked but that carry no rate, and the denominator that
   * kept them out.
   *
   * A break in the line is indistinguishable from a broken chart, and this one
   * breaks for a real reason: the server refuses to divide by a denominator too
   * small to divide by. On KASULU, 23-25 August came back at 1.1, 2.3 and 1.6
   * hectares against a 5 ha floor — the yard nearly stopped for three days
   * (engine hours fell from ~1,300 to ~380) and dividing a day's fuel by one
   * hectare would have produced a spike, not a measurement.
   *
   * So the gap is correct and the chart has to SAY so. Lowering the floor would
   * fill the line in with exactly the fiction the floor exists to prevent.
   */
  const gaps = useMemo(
    () => data.filter(d => d.v == null && d.litres != null),
    [data],
  );

  const gapSpan = gaps.length === 0 ? null
    : gaps.length === 1 ? fmtDay(gaps[0].day)
    : `${fmtDay(gaps[0].day)} – ${fmtDay(gaps[gaps.length - 1].day)}`;

  // The median day's machine count, not the mean: a couple of thin days at the
  // window's edge would drag a mean down and understate what the line rests on.
  const typicalMachines = useMemo(() => {
    const v = data.filter(d => d.v != null && d.vehicles > 0)
      .map(d => d.vehicles).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [data]);

  return (
    <div className="an-rate">
      <div className="an-card__head an-rate__head">
        <span className="an-card__title">
          {shown.length === 1 ? "Fuel per distance covered" : "Fuel per unit of work"}
        </span>
        {/* The toggle sits where a chart toolbar would, but it changes the
            QUESTION rather than the zoom — these are two denominators, not two
            renderings of one series. Hidden when there is only one to choose. */}
        {shown.length > 1 && (
        <div className="an-rate__views" role="group" aria-label="Choose denominator">
          {shown.map(v => (
            <button
              key={v.key}
              type="button"
              className={"an-chip" + (v.key === view.key ? " an-chip--on" : "")}
              aria-pressed={v.key === view.key}
              onClick={() => setView(v)}
            >{v.label}</button>
          ))}
        </div>
        )}
      </div>

      {!hasAny ? (
        <div className="an-rate__empty">
          {series ? `No day in this window has enough ${view.denomLabel} behind it to give a rate.`
                  : "Reading fuel rates…"}
        </div>
      ) : (
        <>
          <div className="an-rate__chart">
            <ResponsiveContainer width="100%" height="100%">
              {/* left: 0, not -14. A negative left margin pulls the plot area
                  outside the SVG's own box, which costs nothing while the axis
                  carries only tick numbers and clips anything placed at the
                  left edge of the axis band — which is exactly where a rotated
                  axis label sits. */}
              <LineChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  tickFormatter={fmtDay}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tick={{ fontSize: 9.5, fill: "var(--text-3)" }}
                />
                {/* The axis says what the numbers ARE.
                    The denominator is a choice here — litres per hectare or per
                    kilometre — so a bare column of figures is only readable by
                    someone who already knows which chip is pressed. The label
                    tracks the selected view, so the axis cannot describe one
                    denominator while the line plots another.

                    `width` covers the ticks AND the label: the rotated label is
                    laid out inside the axis band, so a band sized for the
                    numbers alone puts the two on top of each other. `offset: 0`
                    pins the label to the outer edge of that band and
                    `textAnchor: middle` centres it along the axis rather than
                    hanging it from the top. */}
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  tick={{ fontSize: 9.5, fill: "var(--text-3)" }}
                  label={{
                    value: view.unit,
                    angle: -90,
                    position: "insideLeft",
                    // 10, not 0. `insideLeft` puts the label's CENTRE on the
                    // axis band's left edge, and a rotated glyph is ~12px wide,
                    // so at offset 0 half of it renders outside the SVG and is
                    // clipped — measured: label box x=9-21 against an svg that
                    // starts at x=16. The offset walks that centre inward.
                    offset: 10,
                    style: { textAnchor: "middle" },
                    fontSize: 9.5,
                    fill: "var(--text-3)",
                  }}
                />

                {/* The band an ordinary day sits in — mean ± 1 SD of this very
                    series. A day outside it is the one worth a question. */}
                {stats?.bandLow != null && (
                  <ReferenceArea
                    y1={stats.bandLow}
                    y2={stats.bandHigh}
                    fill="var(--chart-1)"
                    fillOpacity={0.07}
                    stroke="none"
                    label={{ value: "usual range", position: "insideTopRight",
                             fontSize: 9, fill: "var(--text-3)" }}
                  />
                )}

                {stats?.mean != null && (
                  <ReferenceLine
                    y={stats.mean}
                    stroke="var(--chart-1)"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    label={{ value: `mean ${fmt(stats.mean, view.key === "litresPerKm" ? 2 : 1)}`,
                             position: "left", fontSize: 9, fill: "var(--chart-1)" }}
                  />
                )}

                <Tooltip
                  cursor={{ stroke: "var(--border-hi)", strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active) return null;
                    // A null day has no point, so recharts hands over an empty
                    // payload — and the tooltip used to return nothing, leaving
                    // the reader hovering a gap with no explanation of it.
                    const p = payload?.length
                      ? payload[0].payload
                      : data.find(d => d.day === label);
                    if (!p) return null;
                    if (p.v == null) {
                      return (
                        <div className="an-rate__tip">
                          <b>{fmtDay(p.day)}</b>
                          <div>no rate for this day</div>
                          <div className="an-rate__tip-sub">
                            {fmt(p.denom)} {view.denomLabel} is too little to
                            divide {fmt(p.litres)} L by
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="an-rate__tip">
                        <b>{fmtDay(p.day)}</b>
                        <div>{fmt(p.v, view.key === "litresPerKm" ? 2 : 1)} {view.unit}</div>
                        <div className="an-rate__tip-sub">
                          {fmt(p.litres)} L over {fmt(p.denom)} {view.denomLabel}
                        </div>
                        {/* Whose fuel this is. A day drawn from 23 machines and
                            one drawn from 90 are different claims, and the line
                            between them looks identical without this. */}
                        {p.vehicles > 0 && (
                          <div className="an-rate__tip-sub">
                            {fmt(p.vehicles)} machines measured
                          </div>
                        )}
                      </div>
                    );
                  }}
                />

                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  isAnimationActive={false}
                  // The line BREAKS on a null rather than bridging it. A day
                  // with no denominator is not a day between two others; it is
                  // a day nobody measured.
                  connectNulls={false}
                  dot={false}
                  activeDot={{ r: 3.5, fill: "var(--chart-1)", strokeWidth: 0 }}
                />

                {/* The series' own worst day, marked the way the reference marks
                    a point of interest — a ring, not a filled dot, so it reads
                    as a callout rather than as another data point. */}
                {stats?.peakDay && (
                  <ReferenceDot
                    x={stats.peakDay}
                    y={stats.peakValue}
                    r={5}
                    fill="var(--card)"
                    stroke="var(--chart-8)"
                    strokeWidth={2}
                    label={{
                      value: `worst ${fmt(stats.peakValue, view.key === "litresPerKm" ? 2 : 1)}`,
                      position: "top", fontSize: 9, fill: "var(--chart-8)",
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="an-rate__foot">
            <span>{view.note}</span>
            <span>
              {stats?.measured ?? 0} of {series?.windowDays ?? 0} days measured
              {typicalMachines != null && <> · from <b>{fmt(typicalMachines)}</b> machines on a typical day</>}
              {stats?.mean != null && <> · mean <b>{fmt(stats.mean, view.key === "litresPerKm" ? 2 : 1)} {view.unit}</b></>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
