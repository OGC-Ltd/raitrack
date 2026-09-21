/* Hallmark · component: bar series · genre: modern-minimal · theme: in-project
 * states: default · hover · focus · empty · loading
 */

// Sugar out of the factory gate, day by day.
//
// ## Tonnage is counted on the PAPERWORK, not on the trip
//
// The sibling delivery charts count trips, and a trip exists only once a
// dispatch has closed AND the vehicle reported enough fixes to measure. That is
// the right frame for distance and the wrong one for a load: a sales run's
// weight is known the moment the sales office raises it, and a truck whose
// tracker was dark still carried its sugar. So this is summed over the
// dispatches — see the server's sugar-hauls service, which carries the same
// note against the same decision.
//
// ## Bags are not a second series
//
// A bag count is the tonnage restated in the unit the yard counts in, so
// plotting both would draw one quantity twice at a 20x scale difference and
// flatten the tonnes to the axis. Bags ride in the tooltip and the footer
// instead, derived server-side through the same bagsFromTonnes the feed line
// and the cargo card use — one load cannot round three ways.
//
// ## Zero days are drawn
//
// A day with no run is a real zero: no sugar left the gate. Dropping it would
// shorten the axis and redraw the shape of the week, which is the one thing a
// daily series is for.

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";

const fmtDay = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", timeZone: "UTC" });

const fmt = (n, d = 1) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

function TipBody({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="an-rate__tip">
      <div className="an-rate__tip-sub">{fmtDay(d.day)}</div>
      <div className="an-rate__tip-sub">
        <span>Delivered</span><strong>{fmt(d.tonnes)} t</strong>
      </div>
      <div className="an-rate__tip-sub">
        <span>Bags</span><strong>{fmt(d.bags, 0)} × 50 kg</strong>
      </div>
      <div className="an-rate__tip-sub">
        <span>Runs</span><strong>{fmt(d.runs, 0)}</strong>
      </div>
    </div>
  );
}

export default function SugarTonnageChart({ hauls, loading }) {
  const { days, total, bags, runs, mean, activeDays } = useMemo(() => {
    const rows = hauls?.days ?? [];
    const active = rows.filter((d) => d.runs > 0);
    const total = rows.reduce((s, d) => s + d.tonnes, 0);
    return {
      days: rows,
      total,
      bags: rows.reduce((s, d) => s + d.bags, 0),
      runs: rows.reduce((s, d) => s + d.runs, 0),
      // Averaged over the days that actually ran, not over the window: a mean
      // dragged down by a fortnight of zeroes describes no working day.
      mean: active.length ? total / active.length : null,
      activeDays: active.length,
    };
  }, [hauls]);

  const origin = hauls?.origin;

  return (
    <div className="an-hist">
      <div className="an-card__head">
        <span className="an-card__title">Sugar Delivered per Day</span>
        <span className="an-card__hint">
          {runs > 0 ? `${fmt(total)} t · ${fmt(bags, 0)} bags` : "—"}
        </span>
      </div>

      {runs === 0 ? (
        <div className="an-hist__empty">
          {/* Three different nothings, and they must not read alike. Still
              fetching; the server cannot answer at all (an older build with no
              /sugar-hauls route); and a real, measured zero. Collapsing the
              middle case into "reading…" leaves a spinner that never resolves. */}
          {loading
            ? "Reading sales runs…"
            : hauls
              ? "No sales run has left the gate in this window."
              : "Sales-run data is not available from this server yet."}
        </div>
      ) : (
        <>
          <div className="an-hist__chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
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
                  label={{
                    value: "t", position: "insideTopLeft",
                    offset: 0, style: { fontSize: 10, fill: "var(--muted)" },
                  }}
                />
                <Tooltip content={<TipBody />} cursor={{ fill: "var(--hover, rgba(127, 127, 127, 0.12))" }} />
                {mean != null && (
                  // The mean of the WORKING days, so the line is something a
                  // day can be compared against rather than an artefact of how
                  // long the window is.
                  <ReferenceLine
                    y={mean}
                    stroke="var(--chart-4)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                  />
                )}
                <Bar dataKey="tonnes" fill="var(--chart-4)" radius={[3, 3, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="an-rate__foot">
            {fmt(runs, 0)} run{runs === 1 ? "" : "s"} over {activeDays} working day
            {activeDays === 1 ? "" : "s"}
            {origin ? ` out of ${origin}` : ""}
            {mean != null && <> · {fmt(mean)} t on a working day</>}
            . Counted on the sign-out, so a run whose tracker stayed dark is still in here.
          </div>
        </>
      )}
    </div>
  );
}
