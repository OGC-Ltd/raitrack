/* Hallmark · component: overlaid histogram · genre: modern-minimal · theme: in-project
 * states: default · hover · focus · empty · loading
 */

// What each machine ACTUALLY burns per engine hour, measured from its tank.
//
// ## This reads `litresPerHourMeasured`, never `litresPerHour`
//
// The modelled field beside it is `engine_burn_ml / engine_hours`, and
// `engine_burn_ml` is a rate times those same hours — so it hands back the rate
// the model was given, and 689 of 815 vehicles borrow that rate from their
// org+type median. On KASULU it put an identical 9.7 L/h on 13 excavators, 9
// bulldozers, 2 graders and 2 wheel loaders at once, which is exactly why the
// chart was not realistic for heavy plant. A bulldozer and an excavator
// agreeing to one decimal place is a fallback, not a finding.
//
// The measured figure closes the tank's own balance —
// (opening - closing) + refills - drains — turbulence-corrected per fleet day
// and medianed per machine. The refill term is what makes it work: without it
// every day a machine was refuelled reads as no consumption, and those are the
// days a hard-working machine has. See fuel-burn-rate.service for the four
// physical guards and the machines that earned each one.
//
// ## Why a distribution and not an average
//
// The yard holds two populations with different jobs, and one mean across both
// describes no machine on site. Measured on KASULU 2026-08-21: bulldozers run a
// median 13.1 L/h, wheel loaders 7.6, excavators 7.2, against travel units at 2
// to 6.
//
// ## Overlaid, not stacked and not side by side
//
// The two series are drawn over each other at partial opacity, the way the
// reference does it. Stacking would add the counts, which is a different and
// meaningless number — there is no sense in which one excavator plus one lorry
// is "two machines at 9 L/h". Grouping them side by side would halve the bar
// width and hide the thing the chart is for: the region where the two
// populations OVERLAP, which is where a lorry is drinking like a digger.
//
// The overlay is done with a second, hidden x-axis rather than by pulling the
// two together with a negative barGap. recharts measures a percentage barGap
// against the BAND rather than against the bar, and then feeds it back into the
// solver that picks bar width, so no value lands them on the same pixel:
// -100% overshoots by the category gap and leaves 2px, -90% leaves about 1px.
// Two axes over the same categories each lay out ONE bar, centred in its band,
// so both land on the same pixel at every width.
//
// ## Binning
//
// Two-litre bins from zero. Fine enough to separate plant from travel — their
// medians sit about six litres apart — and coarse enough that the machines do
// not scatter into single-member bars.

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// Which side a machine falls on is `worksByTravel`, sent per row by the server
// from `resolveBasis` — the same answer the classifier judges its fuel with.
//
// This used to be a local set of plate prefixes, LMV/FT/FTT/MTR/BUS/TRK, copied
// from the fleet table. It was wrong in three directions at once and the
// comment claiming it matched the table outlived the table's own copy:
//
//   · MTR is a TRACTOR — 20 machines that work a field standing still, filed
//     here as travel.
//   · HFT, at 24.1 km per engine hour the most road-going code in the fleet
//     after the buses, was filed as plant. So were DB, WB and SPY.
//   · SUKARI plates are ordinary registrations with no equipment code in them,
//     so NONE of them could ever match. That fleet's entire road population
//     landed in "Excavators, dozers & plant", and the two-series premise this
//     chart is built on quietly collapsed on it.
//
// A prefix is not even reliably the machine: `MUFINDI: OPTIM - CM 01` yields
// OPTIM, a site.

const BIN_L = 2;

// "Plant" is every machine whose work is not travel — excavators, dozers,
// loaders, graders, backhoes, crushers, compactors. Measured on KASULU that is
// 82 machines across fifteen category codes, not the 32 excavators alone.
const SERIES = [
  { key: "plant",  label: "Excavators, dozers & plant", color: "var(--chart-2)" },
  { key: "travel", label: "Lorries, tankers & travel",  color: "var(--chart-1)" },
];

const fmt = (n, d = 1) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

const medianOf = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);

export default function FuelPerHourHistogram({ state }) {
  const { bins, plantStats, travelStats, total, fleet, dayCount } = useMemo(() => {
    const all   = state?.units ?? [];
    const units = all.filter(u => u.litresPerHourMeasured != null);
    const plant  = units.filter(u => !u.worksByTravel).map(u => u.litresPerHourMeasured);
    const travel = units.filter(u =>  u.worksByTravel).map(u => u.litresPerHourMeasured);

    if (units.length === 0) {
      return { bins: [], plantStats: null, travelStats: null, total: 0, fleet: all.length,
               dayCount: 0 };
    }

    // How much evidence the chart stands on, summed rather than claimed: every
    // machine carries the count of qualifying days behind its own median. A
    // distribution built from three days per machine and one built from thirty
    // are different claims and should not look alike.
    const dayCount = units.reduce((a, u) => a + (u.measuredDays ?? 0), 0);

    const max  = Math.max(...units.map(u => u.litresPerHourMeasured));
    const last = Math.ceil(max / BIN_L) * BIN_L;
    const out  = [];
    for (let lo = 0; lo < last; lo += BIN_L) {
      out.push({
        // The bin's own label, not its midpoint: an axis reading 9 for a bin
        // holding 8-to-10 invites a precision the binning threw away.
        bin: `${lo}–${lo + BIN_L}`,
        lo,
        plant:  plant.filter(v => v >= lo && v < lo + BIN_L).length,
        travel: travel.filter(v => v >= lo && v < lo + BIN_L).length,
      });
    }
    return {
      bins: out,
      plantStats:  plant.length  ? { n: plant.length,  median: medianOf(plant) }   : null,
      travelStats: travel.length ? { n: travel.length, median: medianOf(travel) } : null,
      total: units.length,
      fleet: all.length,
      dayCount,
    };
  }, [state]);

  return (
    <div className="an-hist">
      <div className="an-card__head">
        <span className="an-card__title">Fuel per operating hour</span>
        <span className="an-card__hint">
          {total > 0 ? `${total} machines · measured` : "—"}
        </span>
      </div>

      {bins.length === 0 ? (
        <div className="an-hist__empty">
          {state ? "No machine has an hourly rate yet." : "Reading hourly rates…"}
        </div>
      ) : (
        <>
          <div className="an-hist__chart">
            <ResponsiveContainer width="100%" height="100%">
              {/* left: 0 — see the note on the same margin in FuelRateChart.
                  At -14 the axis band starts outside the SVG box and the
                  rotated label was clipped against it. */}
              <BarChart data={bins} margin={{ top: 6, right: 10, bottom: 14, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="var(--border)" />
                {/* One axis per series — see the note at the top. The second is
                    hidden; it exists only so its bar gets a band of its own to
                    centre in, landing on the same pixel as the first. */}
                <XAxis
                  dataKey="bin"
                  xAxisId="plant"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={4}
                  tick={{ fontSize: 9, fill: "var(--text-2)" }}
                  // The bins are labelled 0–2, 2–4 … and a reader who does not
                  // already know the chart cannot tell what those are RANGES OF.
                  // Naming the unit is the difference between a distribution
                  // and a row of anonymous bars.
                  label={{
                    value: "litres per engine hour",
                    position: "insideBottom",
                    offset: -12,
                    fontSize: 9.5,
                    fill: "var(--text-2)",
                  }}
                />
                <XAxis dataKey="bin" xAxisId="travel" hide />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  // Wide enough for the tick numbers AND the rotated label,
                  // which Recharts lays out inside this same band — 34px held
                  // the counts and put the label straight through them.
                  width={54}
                  tick={{ fontSize: 9.5, fill: "var(--text-2)" }}
                  // "machines" alone read as a label for the whole chart rather
                  // than for the count on this axis.
                  //
                  // offset 0, not 18: the offset walks the label INWARD from the
                  // outer edge of the band, so 18 drove it into the ticks it was
                  // meant to sit beside. textAnchor centres it on the axis
                  // instead of anchoring it at one end.
                  label={{ value: "machines in bin", angle: -90, position: "insideLeft",
                           // 10, not 0 — see FuelRateChart: at 0 the rotated
                           // label centres on the band's left edge and half of
                           // it falls outside the SVG.
                           fontSize: 9.5, fill: "var(--text-2)", offset: 10,
                           style: { textAnchor: "middle" } }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(127,127,127,0.08)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div className="an-hist__tip">
                        <b>{label} L/h</b>
                        <div>{p.plant} plant · {p.travel} travel</div>
                      </div>
                    );
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={20}
                  iconType="square"
                  wrapperStyle={{ fontSize: 10, color: "var(--text-3)" }}
                />
                {SERIES.map(s => (
                  <Bar
                    key={s.key}
                    xAxisId={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="an-hist__foot">
            {plantStats && (
              <span>Plant <b>{plantStats.n}</b> machines, median <b>{fmt(plantStats.median)} L/h</b></span>
            )}
            {travelStats && (
              <span>Travel <b>{travelStats.n}</b> units, median <b>{fmt(travelStats.median)} L/h</b></span>
            )}
            {/* What the chart stands on, stated in the chart. */}
            {dayCount > 0 && (
              <span className="an-hist__src">
                From the tank: <b>{fmt(dayCount, 0)}</b> machine-days, refills and
                drains balanced
              </span>
            )}
            {/* The machines that are NOT here, counted. A histogram that quietly
                drops a third of the fleet reads as complete when it is not:
                these are units that burned no measurable fuel over an engine
                hour in the window, so they have no rate to bin. */}
            {fleet > total && (
              <span className="an-hist__gap">
                <b>{fleet - total}</b> of {fleet} with no trustworthy probe
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
