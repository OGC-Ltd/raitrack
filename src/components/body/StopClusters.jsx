/* Hallmark · component: analysis card · genre: modern-minimal · theme: in-project
 * states: default · hover · focus-visible · loading · empty · unavailable
 *         · one-place · two-places · axis-meaningless
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · contrast: pass, both themes
 */

// Where this fleet's units actually stop.
//
// The yard's drawing says where things are meant to be. This says where the
// lorries put themselves: the places many different units stop at, ranked by
// how many units use them, and — for the busiest — whether it is ONE place.
//
// ## Why the shape is the point
//
// This card exists because of a measurement, not a design idea. Kabras' two
// weighbridges were placed by exactly this pass: the busy stop the operations
// survey drew as one pin turned out to be two stops nineteen metres apart, and
// nothing in the paperwork was ever going to say so. The coordinates were the
// smaller half of that. The half worth putting on a page is that a yard's
// busiest stop has a shape, and the shape is readable.
//
// ## Two pictures, because they answer different halves
//
// The scatter is WHERE — a 120 m square of the busiest place, every stationary
// fix drawn, so an operator recognises their own yard in it. The profile is
// WHETHER — the same fixes projected onto the cloud's long axis and binned
// every 3 m, which is the only view in which two stops side by side stop
// looking like one wide stop.
//
// ## It does not name the place
//
// The server knows that 93 units stopped inside 25 m of a point for a median
// of a few minutes. Whether that is a weighbridge, a gate or a canteen is the
// operator's to say. Printing a guess would be the one part of this card that
// could be confidently wrong, so the card prints a coordinate and a count and
// lets the person who works there supply the noun.
//
// ## Its own window, not the page's
//
// The page's selector runs to 90 days; this reads at most a fortnight, because
// the pass behind it scans every fix in the window and the box has two vCPUs.
// Rather than silently rounding 90 down to 14 and labelling it "90 days", the
// card states its own window in its own hint and leaves the page's alone.

import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  BarChart, Bar, Cell, ReferenceLine, ResponsiveContainer,
} from "recharts";

const fmt = (n, d = 0) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d }).format(n);

/**
 * Is the long axis worth binning along?
 *
 * A round cloud's principal axis is arbitrary — the maths returns a number
 * either way — so a profile drawn along it is a slice in a direction nothing
 * chose. Below this the card says so rather than inviting a reading of it.
 */
const AXIS_MEANS_SOMETHING = 1.25;

/** The axis, said the way a person would. */
function axisWords(deg) {
  const d = ((deg % 180) + 180) % 180;
  if (d < 22.5 || d >= 157.5) return "east–west";
  if (d < 67.5) return "northeast–southwest";
  if (d < 112.5) return "north–south";
  return "northwest–southeast";
}

export default function StopClusters({ data, loading }) {
  const focus = data?.focus ?? null;

  const { points, profile, tallest } = useMemo(() => {
    const pts = (focus?.points ?? []).map(p => ({ e: p.e, n: p.n }));
    const prof = focus?.profile ?? [];
    return {
      points: pts,
      profile: prof,
      tallest: prof.reduce((m, b) => Math.max(m, b.n), 0),
    };
  }, [focus]);

  const split = focus?.split ?? null;
  const axisReal = (focus?.spreadRatio ?? 1) >= AXIS_MEANS_SOMETHING;

  // Three different nothings, and they must not read alike: still fetching, a
  // server too old to carry the route, and a fleet that genuinely has no place
  // this busy. Collapsing the middle into "reading…" leaves a spinner that
  // never resolves.
  if (!data || !focus) {
    return (
      <div className="an-card an-card--wide an-stops">
        <Head data={data} focus={null} />
        <div className="an-stops__empty">
          {loading
            ? "Reading where the fleet stops…"
            : data
              ? "No place in this window was used by enough different units to describe."
              : "Stop-cluster data is not available from this server yet."}
        </div>
      </div>
    );
  }

  return (
    <div className="an-card an-card--wide an-stops">
      <Head data={data} focus={focus} />

      <div className="an-stops__panels">
        {/* WHERE */}
        <figure className="an-stops__panel">
          <figcaption className="an-stops__cap">
            The busiest place, {fmt(focus.radiusM * 2)} m across
          </figcaption>
          <div className="an-stops__plot">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 6, right: 8, bottom: 2, left: -22 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
                {/* Both axes on the same fixed domain, so a metre east is a
                    metre north. An auto domain would stretch the cloud to the
                    box and quietly redraw the geometry the card is about. */}
                <XAxis
                  type="number" dataKey="e" domain={[-focus.radiusM, focus.radiusM]}
                  ticks={[-50, -25, 0, 25, 50]} tick={{ fontSize: 9 }} stroke="var(--muted)"
                />
                <YAxis
                  type="number" dataKey="n" domain={[-focus.radiusM, focus.radiusM]}
                  ticks={[-50, -25, 0, 25, 50]} tick={{ fontSize: 9 }} stroke="var(--muted)"
                  width={40}
                />
                <ZAxis range={[6, 6]} />
                <Scatter
                  data={points}
                  fill="var(--chart-1)"
                  fillOpacity={0.28}
                  isAnimationActive={false}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </figure>

        {/* WHETHER */}
        <figure className="an-stops__panel">
          <figcaption className="an-stops__cap">
            The same fixes, along the {axisWords(focus.axisDeg)} axis, in 3 m bins
          </figcaption>
          <div className="an-stops__plot">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profile} margin={{ top: 6, right: 8, bottom: 2, left: -22 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="at" tick={{ fontSize: 9 }} stroke="var(--muted)"
                  interval="preserveStartEnd" minTickGap={16}
                  tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
                />
                <YAxis tick={{ fontSize: 9 }} width={40} stroke="var(--muted)" />
                <Bar dataKey="n" isAnimationActive={false}>
                  {profile.map((b) => (
                    /* The two peaks and the trough between them are coloured
                       because they are the reading, not because tall bars are
                       interesting. On a single-peaked profile nothing is
                       highlighted and the bars are all one colour — which is
                       itself the answer. */
                    <Cell
                      key={b.at}
                      fill={
                        split && (b.at === split.a.at || b.at === split.b.at)
                          ? "var(--chart-1)"
                          : split && b.at === split.trough.at
                            ? "var(--chart-2)"
                            : "var(--chart-1)"
                      }
                      fillOpacity={
                        split
                          ? (b.at === split.a.at || b.at === split.b.at || b.at === split.trough.at
                              ? 1 : 0.34)
                          : 0.7
                      }
                    />
                  ))}
                </Bar>
                {tallest > 0 && <ReferenceLine y={0} stroke="var(--grid)" />}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className={"an-stops__verdict" + (split ? " an-stops__verdict--split" : "")}>
            {!axisReal ? (
              <>
                This cloud is round — it has no long axis, so the profile beside
                it is a slice in a direction nothing chose. Read it as one place.
              </>
            ) : split ? (
              <>
                <b>Two places, {fmt(split.apartM)} m apart.</b> Peaks of{" "}
                {fmt(split.a.n)} and {fmt(split.b.n)} fixes with {fmt(split.trough.n)}{" "}
                between them. Two bays, two lanes, or two machines — the traffic
                treats them as separate.
              </>
            ) : (
              <><b>One place.</b> A single peak: the fixes fall off either side
                of one centre rather than gathering at two.</>
            )}
          </p>
        </figure>
      </div>

      <div className="an-stops__scroll">
        <table className="an-tbl an-stops__tbl">
          <thead>
            <tr>
              <th>Place</th>
              <th className="r">Units</th>
              <th className="r">Stationary fixes</th>
              <th className="r">Cells</th>
            </tr>
          </thead>
          <tbody>
            {data.clusters.map((c, i) => (
              <tr key={`${c.lat},${c.lng}`} className={i === 0 ? "an-stops__row--focus" : undefined}>
                <td className="an-stops__coord">
                  {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                  {i === 0 && <span className="an-stops__drawn">drawn above</span>}
                </td>
                <td className="r">{fmt(c.units)}</td>
                <td className="r">{fmt(c.fixes)}</td>
                <td className="r">{fmt(c.cells)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="an-rate__foot">
        Every stationary fix in the last {fmt(data.days)} days, gathered into 11 m
        cells and then into places; a place is kept only where at least six
        different units stopped. Units is the greatest count any one of a
        place&rsquo;s cells saw, never the sum — the same lorry appears in every
        cell it drifted across. The card names no place: it knows where the
        fleet stops, not what is standing there.
      </div>
    </div>
  );
}

function Head({ data, focus }) {
  return (
    <div className="an-card__head">
      <span className="an-card__title">Where Units Actually Stop</span>
      <span className="an-card__hint">
        {focus
          ? `${fmt(data.clusters.length)} place${data.clusters.length === 1 ? "" : "s"} · busiest used by ${fmt(focus.units)} units · last ${fmt(data?.days)} days`
          : "—"}
      </span>
    </div>
  );
}
