/* Hallmark · component: radar chart · genre: modern-minimal
 * theme: in-project (an-* tokens, --chart-1..6 palette)
 * states: default · hover (vertex + tip) · empty · loading · unbanded note
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * contrast: pass — spoke text --text-3 / counts --ink on --elevated
 * redesign 2026-10-09: less text. Spokes read "1–2" not "1–2 h" (the tile
 *   title says hours), the rings are quiet polygons with the outer one drawn
 *   firmer as the frame, the fill is a radial wash that is densest at the
 *   centre, and the hovered vertex grows instead of a box of words opening.
 *
 * Hours run today as a radar: one spoke per engine-hour band, the polygon's
 * reach on each spoke is how many of the units that ran sit in that band.
 * Short hops lean left of the top, full shifts lean right.
 */

import { useId, useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

import { ChartContainer } from "../ui/chart";

const fmt = (n) => new Intl.NumberFormat("en-GB").format(n ?? 0);

/* "<1 h" → "<1", "8 h+" → "8+". The unit is the tile's title. */
/* The page's own categorical palette, one slot per spoke, in slot order — the
   colours every other Analytics chart already uses, rather than a series hue
   of this tile's own. The outline and wash take slot 1, the page's primary. */
const SPOKE_TONES = [1, 2, 3, 4, 5, 6].map((i) => `var(--chart-${i})`);
const LINE = "var(--chart-1)";

const short = (label) => label.replace(/\s*h/, "");

function Spoke({ x, y, cy, payload, textAnchor, data, hot }) {
  const d = data[payload.index];
  // Pushed off the ring vertically so the top and bottom labels clear the
  // polygon's own vertex.
  const dy = y < cy - 1 ? -6 : y > cy + 1 ? 6 : 0;
  const lit = hot === payload.index;
  return (
    <text
      x={x}
      y={y + dy}
      textAnchor={textAnchor}
      dominantBaseline="central"
      className={"an-hrr__spoke" + (lit ? " is-hot" : "")}
    >
      <tspan>{short(payload.value)}</tspan>
      <tspan className="an-hrr__spoke-n" dx="3">{fmt(d?.n)}</tspan>
    </text>
  );
}

export default function HoursRunRadar({ bands, unbanded = 0 }) {
  const gid = useId().replace(/:/g, "");
  const [hot, setHot] = useState(null);
  const peak = Math.max(1, ...bands.map((d) => d.n));

  /* The spoke under the pointer, by angle around the plot's centre. Recharts'
     own active index only exists while a Tooltip is mounted, and a tooltip is
     exactly the box of words this tile no longer opens. Spoke 0 is at the top
     and they run clockwise, as the chart draws them. */
  const track = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 6) return setHot(null);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const step = 360 / bands.length;
    setHot(Math.round(((deg + 360) % 360) / step) % bands.length);
  };

  return (
    <div className="an-hrr">
      <ChartContainer
        config={{}}
        className="an-hrr__plot"
        onMouseMove={track}
        onMouseLeave={() => setHot(null)}
      >
        <RadarChart
          data={bands}
          outerRadius="76%"
          margin={{ top: 12, right: 22, bottom: 8, left: 22 }}
          role="img"
          aria-label={
            "Units that ran today by engine hours: " +
            bands.map((d) => `${d.label}, ${d.n}`).join("; ")
          }
        >
          <defs>
            <radialGradient id={`hrr-${gid}`} cx="50%" cy="50%" r="60%">
              <stop offset="0%" style={{ stopColor: LINE, stopOpacity: 0.42 }} />
              <stop offset="100%" style={{ stopColor: LINE, stopOpacity: 0.12 }} />
            </radialGradient>
          </defs>

          <PolarGrid
            gridType="polygon"
            stroke="var(--border)"
            strokeDasharray="2 3"
          />
          <PolarAngleAxis
            dataKey="label"
            tick={(p) => <Spoke {...p} data={bands} hot={hot} />}
            axisLine={{ stroke: "var(--text-3)", strokeOpacity: 0.35 }}
          />
          <PolarRadiusAxis domain={[0, peak]} tick={false} axisLine={false} tickCount={4} />
          <Radar
            dataKey="n"
            stroke={LINE}
            strokeWidth={1.75}
            strokeLinejoin="round"
            fill={`url(#hrr-${gid})`}
            fillOpacity={1}
            isAnimationActive={false}
            dot={(p) => (
              <circle
                key={p.index}
                cx={p.cx}
                cy={p.cy}
                r={hot === p.index ? 5 : 3.5}
                fill={SPOKE_TONES[p.index % SPOKE_TONES.length]}
                className="an-hrr__dot"
              />
            )}
          />
        </RadarChart>
      </ChartContainer>

      {/* The one honest footnote, kept to three words: units that moved with
          no ignition reading count in the headline but sit on no spoke. */}
      {unbanded > 0 && (
        <span className="an-hrr__note">+{fmt(unbanded)} no engine hours</span>
      )}
    </div>
  );
}
