/* Hallmark · component: stacked bar series · genre: modern-minimal
 * theme: in-project (an-* tokens; adds the --dawn-* ramp, see AnalyticsScreen.css)
 * states: default · hover · focus-visible · picked · dimmed · empty · loading
 *         · unit-filtered
 * redesign 2026-09-14: three consecutive hours are ORDINAL, so one hue in
 *         three steps replaces three slots of the categorical palette; the
 *         legend is ours, in the order the night runs, because the shipped one
 *         printed the first band last; the row total sits at the end of its
 *         bar instead of being measured off the axis; and the bands, declared
 *         four times, are one list.
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * contrast: pass — ramp 11.6/4.4/3.2:1 light, 3.8/6.5/10.5:1 dark
 */

import { useState } from "react";

import {
  BarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import { ChartContainer } from "../ui/chart";

import { isPlantFleet } from "../../hooks/useMachineSummary";

// ─── Cumulative early-start milestones ──────────────────────────────────
//
// The service values are cumulative:
//
//   before04 = operational before 04:00
//   before05 = operational before 05:00
//   before06 = operational before 06:00
//
// The chart displays ONE horizontal stacked bar.
//
// Example:
//
//   before04 = 7
//   before05 = 8
//   before06 = 11
//
// The visual bar becomes:
//
//   [ 7 ][ 1 ][ 3 ]
//
// where:
//
//   7 = operational before 04:00
//   1 = additional machines operational between 04:00 and 05:00
//   3 = additional machines operational between 05:00 and 06:00
//
// Total bar length = 11 machines.

/* The bands used to be declared FOUR times: here as SERIES, again as the
   chart's `config`, again as SEGMENTS for the picked heading, and a fourth
   time as three hand-written <Bar> blocks. This copy had been dead for long
   enough to drift — it still called the middle band "Before 05:00", the
   cumulative label the bars were corrected away from, because it drew
   before05 - before04 and so meant "inside the 04:00 hour". One list lives in
   the component now, as BANDS. */

const MAX_NAMED = 8;

// ─── Tooltip ─────────────────────────────────────────────────────────────

function StartsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  const hit = payload[0];
  const row = hit.payload;

  // The units are keyed by SLOT — pre04 / h04 / h05 — not by the cumulative
  // milestone. This read `units.before04`, which the payload has never carried,
  // so every tooltip listed nothing and looked merely empty rather than wrong.
  const SLOT_OF = {
    segment04: { key: "pre04", label: "Before 04:00" },
    segment05: { key: "h04", label: "04:00 – 05:00" },
    segment06: { key: "h05", label: "05:00 – 06:00" },
  };
  const { key: slotKey, label: milestoneLabel } =
    SLOT_OF[hit.dataKey] ?? SLOT_OF.segment06;

  const cumulativeValue = row.slots?.[slotKey] ?? 0;
  const units = row.units?.[slotKey] ?? [];

  return (
    <div className="an-mstarts__tip">
      <div className="an-mstarts__tip-head">
        <span
          className="an-mstarts__tip-swatch"
          style={{
            background:
              hit.color ??
              hit.fill,
          }}
        />

        <b>{label}</b>
      </div>

      <div className="an-mstarts__tip-count">
        {milestoneLabel}: {cumulativeValue} machine
        {cumulativeValue === 1 ? "" : "s"} operational
      </div>

      {units.length > 0 && (
        <ul className="an-mstarts__tip-list">
          {units
            .slice(0, MAX_NAMED)
            .map((u) => (
              <li key={u.plate}>
                <span className="an-mstarts__tip-plate">
                  {u.plate}
                </span>

                <span className="an-mstarts__tip-at">
                  {u.at}
                </span>
              </li>
            ))}

          {units.length > MAX_NAMED && (
            <li className="an-mstarts__tip-more">
              and {units.length - MAX_NAMED} more
            </li>
          )}
        </ul>
      )}

      <div className="an-mstarts__tip-foot">
        {row.before06} operational before 06:00
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────

export default function MachineOperations({
  companyId,
  starts,
  unitFiltered = false,
}) {
  // EVERY category that worked early, not a hardcoded pair.
  //
  // This filtered to `c.category === "EX" || c.category === "MUFINDI - EX"`,
  // so the chart drew excavators and nothing else — no bulldozers, no loaders,
  // no graders. The second branch could never match either: `machinePrefix`
  // strips the estate name, so the category is `EX` and never
  // `MUFINDI - EX`. Hardcoding the list is the bug; the server already sorts
  // by how many machines worked, so take the busiest.
  const data = (starts?.categories ?? [])
    .map((c) => {
      const before04 = Math.max(
        0,
        c.before04 ?? 0,
      );

      const before05 = Math.max(
        before04,
        c.before05 ?? 0,
      );

      const before06 = Math.max(
        before05,
        c.before06 ?? 0,
      );

      return {
        category: c.category,

        // Original cumulative values.
        before04,
        before05,
        before06,

        // The three DISCRETE windows, taken from the server rather than
        // subtracted out of the cumulative pair. Same numbers, but the server
        // computes them by bucketing each machine exactly once, so they cannot
        // disagree with the units listed under them.
        segment04: c.slots?.pre04 ?? 0,
        segment05: c.slots?.h04 ?? 0,
        segment06: c.slots?.h05 ?? 0,

        worked: c.worked ?? 0,
        started: c.started,
        continuedOvernight: c.continuedOvernight ?? 0,
        slots: c.slots ?? { pre04: 0, h04: 0, h05: 0 },
        units: c.units ?? {},
      };
    })
    .filter(
      (c) =>
        c.before04 > 0 ||
        c.before05 > 0 ||
        c.before06 > 0,
    )
    .slice(0, 8);

  // Which bar the reader has picked, as {category, slot}. Null is "none".
  const [picked, setPicked] = useState(null);

  /* The card is plant-only, and this guard used to sit at the top of the
     component — above the one hook in the file. React counts hooks per render,
     so switching the org picker from Mufindi to a haulage fleet took this
     instance from one hook to zero and threw "rendered fewer hooks than
     expected" rather than hiding the card. Below the hook it is just a render
     that produces nothing, which is what it was always meant to be. */
  if (!isPlantFleet(companyId)) return null;
  const pickedRow =
    picked && data.find((d) => d.category === picked.category);
  const pickedUnits = pickedRow?.units?.[picked?.slot] ?? [];

  /* The three bands, in the order the night runs.
     One list now, and everything reads from it — the stack, the legend, the
     picked-row heading. They used to be a SEGMENTS map for the heading, a
     `config` object for the legend and three hand-written <Bar> blocks, which
     is how the legend came to print them in a different order from the bars
     (04:00-05:00, 05:00-06:00, Before 04:00, against a stack that starts at
     Before 04:00). Three keys that are a CLOCK cannot be allowed to disagree
     about their own order in two places on one card. */
  const BANDS = [
    { key: "segment04", slot: "pre04", label: "Before 04:00", tone: "var(--dawn-3)" },
    { key: "segment05", slot: "h04",   label: "04:00 – 05:00", tone: "var(--dawn-2)" },
    { key: "segment06", slot: "h05",   label: "05:00 – 06:00", tone: "var(--dawn-1)" },
  ];
  const SEGMENTS = Object.fromEntries(
    BANDS.map((b) => [b.key, { slot: b.slot, label: b.label }]),
  );

  /* Machines out before six, over every family drawn. The card's own subject,
     said once at the top instead of left to be totted up off the axis. */
  const earlyTotal = data.reduce((n, d) => n + d.before06, 0);
  // Recharts hands the clicked datum to the Bar's own onClick, so the segment
  // is known from the closure rather than guessed from the payload.
  const pick = (segKey) => (entry) => {
    const slot = SEGMENTS[segKey].slot;
    if ((entry?.payload?.slots?.[slot] ?? 0) === 0) return;   // nothing to show
    setPicked((p) =>
      p && p.category === entry.payload.category && p.slot === slot
        ? null
        : { category: entry.payload.category, slot });
  };

  return (
    <div className="an-mstarts">
      <div className="an-card__head">
        {/* "started" was the wrong word and the wrong question: a machine that
            ran through midnight never started, and those are the earliest
            machines on site. */}
        <span className="an-card__title an-mstarts__title">
          Machines working early
        </span>
        {/* What "early" means, and how many. The title carries a judgement —
            "early" — and the card never said against what, so a reader had to
            infer the 06:00 cut from the legend's last band. */}
        {data.length > 0 && !unitFiltered && (
          <span className="an-card__hint an-mstarts__hint">
            {earlyTotal} before 06:00
          </span>
        )}
        {picked && (
          <button
            type="button"
            className="an-mstarts__clear"
            onClick={() => setPicked(null)}
          >
            clear
          </button>
        )}
      </div>

      {unitFiltered || data.length === 0 ? (
        <div className="an-mstarts__empty">
          {unitFiltered
            /* The one card on the page a unit filter cannot reach. It counts
               machines by family — there are no per-unit rows behind the bars
               to match an id against — so under a unit selection it must say
               so rather than draw the whole family. */
            ? "This chart counts machines by family, so it cannot be narrowed to particular units. Clear the unit filter to read it."
            : starts
              ? "No machine became operational before 06:00 today."
              : "Reading machine starts…"}
        </div>
      ) : (
        <>
        {/* The legend is a RAMP, and it is ours.
            Three consecutive hours of one night are ordinal, so they are one
            hue in three steps — deepest is earliest — and the swatches sit in
            a single strip reading left to right as the clock does. The shipped
            ChartLegendContent took its order from recharts' payload and put
            the first band last; a legend for a sequence that is out of
            sequence is worse than none.
            Under the chart, not above it: it is a key, consulted after the
            bars raise a question, and the bars are what the card is. */}
        <ChartContainer config={{}} className="an-mstarts__chart">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 34, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              horizontal={false}
              strokeDasharray="2 4"
              stroke="var(--border)"
            />

            <XAxis
              type="number"
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--text-3)" }}
            />

            <YAxis
              type="category"
              dataKey="category"
              tickLine={false}
              axisLine={false}
              width={72}
              tick={{ fontSize: 11, fill: "var(--text-3)" }}
            />

            <Tooltip
              cursor={{ fill: "var(--hover, rgba(127, 127, 127, 0.08))" }}
              content={<StartsTooltip />}
            />

            {BANDS.map((band, i) => (
              <Bar
                key={band.key}
                dataKey={band.key}
                stackId="early"
                name={band.label}
                fill={band.tone}
                /* A hairline in the card's own colour between the bands.
                   On the light surface the last two steps of the ramp are only
                   1.38:1 apart — as far as one hue can go while every step
                   still clears 3:1 on white — so the boundary is DRAWN rather
                   than left to the fills to imply. */
                stroke="var(--card)"
                strokeWidth={1}
                radius={i === 0 ? [4, 0, 0, 4] : i === BANDS.length - 1 ? [0, 4, 4, 0] : 0}
                isAnimationActive={false}
                cursor="pointer"
                onClick={pick(band.key)}
              >
                {/* A picked band stays solid and the rest dim, so the selection
                    is visible on the bar itself and not only in the list. */}
                {data.map((d) => (
                  <Cell
                    key={d.category}
                    fillOpacity={
                      !picked ||
                      (picked.category === d.category && picked.slot === band.slot)
                        ? 1
                        : 0.3
                    }
                  />
                ))}

                {/* The row's total, at the end of the bar. Only on the last
                    band, because a stack's total belongs to the stack and
                    printing it per band would say it three times. It is what
                    every comparison down the column is actually made on, and
                    reading it off the axis is a measurement an operator should
                    not have to perform. */}
                {i === BANDS.length - 1 && (
                  <LabelList
                    dataKey="before06"
                    position="right"
                    offset={7}
                    style={{ fontSize: 10, fontWeight: 700, fill: "var(--ink)" }}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ChartContainer>

        <div className="an-mstarts__key">
          <div className="an-mstarts__ramp" role="list">
            {BANDS.map((b) => (
              <span key={b.key} className="an-mstarts__keyitem" role="listitem">
                <i className="an-mstarts__sw" style={{ background: b.tone }} aria-hidden="true" />
                {b.label}
              </span>
            ))}
          </div>
          {/* The bars have been clickable since they were drawn and nothing
              said so — `cursor: pointer` is not an affordance a reader finds
              without already suspecting it is there. Dropped as soon as one is
              picked, because by then the reader knows. */}
          {!picked && (
            <span className="an-mstarts__cue">Pick a band for the machines in it</span>
          )}
        </div>
        </>
      )}

      {/* The machines behind the picked bar, named.
          A count tells an operator that six excavators were out before four;
          only the names tell them which yard to ask. `continued` is called out
          because "worked at 00:07" and "started at 00:07" are different facts —
          the first is a night shift that never stopped. */}
      {picked && pickedRow && (
        <div className="an-mstarts__picked">
          <div className="an-mstarts__picked-head">
            <b>{picked.category}</b> · {SEGMENTS[
              Object.keys(SEGMENTS).find(
                (k) => SEGMENTS[k].slot === picked.slot,
              )
            ]?.label}
            {" · "}
            {pickedUnits.length}{" "}
            {pickedUnits.length === 1 ? "machine" : "machines"}
          </div>

          {pickedUnits.length === 0 ? (
            <div className="an-mstarts__picked-empty">
              No machine in this window.
            </div>
          ) : (
            <ul className="an-mstarts__picked-list">
              {pickedUnits.map((u) => (
                <li key={u.plate}>
                  <span className="an-mstarts__picked-plate">
                    {u.plate}
                  </span>
                  <span className="an-mstarts__picked-at">
                    {u.at}
                    {u.continued ? " · ran overnight" : " · started"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}