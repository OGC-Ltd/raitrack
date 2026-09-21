/* Hallmark · component: donut chart · genre: modern-minimal · theme: in-project (an-* tokens)
 * studied: yes · DNA-source: image (user reference — regional revenue donut)
 * states: default · hover · focus · empty · loading
 *         (active/disabled/success do not exist for a chart — see the note below)
 * contrast: no text is drawn on a slice; every label sits on the card surface
 */

// What the fleet is MADE OF, drawn the way the reference draws it.
//
// ## What was taken from the reference
//
// A donut rather than a solid pie; category names OUTSIDE the ring on elbow
// leader lines; the share carried beside each name; no separate legend block,
// because the leader lines are the legend.
//
// The total sits in the hole rather than above the chart. It began as the
// tile's own headline with a rule under it, and that arrangement cost about
// fifty vertical pixels — enough that six labels could not be laid out without
// two of them colliding, measured on KASULU at a zero-pixel gap with MTR and
// CTR clipped. The hole was empty anyway. Moving the number into it gives the
// ring the height it needed and removes a heading that was naming a figure
// sitting right beside it.
//
// ## What was NOT taken, and why
//
// The reference prints each share in white INSIDE its slice. Its hues are dark
// enough to carry white text; this page's validated palette is not. Measured
// against white: --chart-4 #eda100 is about 1.9:1, --chart-3 #1baf7a about
// 2.6:1, --chart-2 #eb6834 about 3.0:1. Three of the six slots would have
// shipped a number nobody could read, so the share moved out to the label,
// where it sits on the card surface and passes on every slot. Same information,
// same leader-line language, legible everywhere.
//
// ## Why the labels can collide, and what stops them
//
// The reference's five slices run 7.5%–33.5% — evenly enough spread that no two
// leader lines land near each other. Real fleets are not that tidy: SUKARI is
// 481 of 597 tractors, so 80.6% of the ring is one slice and the other two are
// crowded into a fifth of the circle. Labels are therefore pushed apart
// vertically after layout (see `spread`), never dropped — a chart that silently
// hides its smallest categories is worse than one that looks slightly busy.
//
// ## Why seven slices and a remainder
//
// The palette has eight validated slots per surface. The provider's vocabulary is
// per-fleet and grows without warning — SUKARI reports three types, KASULU
// twenty-five prefixes — so one-colour-per-type would run out and the next
// fleet onboarded would silently reuse a hue. Seven named plus a labelled
// remainder fills the palette exactly and cannot overflow. The remainder's
// composition is on its tooltip.
//
// ## Which states a chart actually has
//
// Hover, focus and empty are real. `active`, `disabled` and `success` are not:
// nothing is pressed, nothing is switched off, nothing succeeds. The slices are
// a readout, not a control. Inventing those three would be dressing.

import { useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

/** The page's validated slots, in the palette's own fixed order.
 *
 *  In slot order rather than an order that looked good: the palette's rule is
 *  "assign by slot number, never by picking a hue that looks right", and now
 *  that slots 5 and 6 exist there are eight of them, which is exactly what an
 *  eight-wedge chart needs. */
const SLICES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
                "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];

/** Named types drawn individually; everything past this is the remainder.
 *
 *  Seven, because the palette carries eight validated slots and the remainder
 *  needs one of them. That is what shows KASULU's whole working vocabulary —
 *  EX, OPTIM, LMV, MTR, CTR, FT, FTT — rather than five of it. */
const NAMED = 7;

/**
 * The label beside a leader line, shortened to fit.
 *
 * The tile is one of four columns, so there are about 60px either side of the
 * ring. A plate-prefix category is already short enough — EX, OPTIM, FTT — and
 * is used as it stands. A provider type is not: "Company vehicle" is 14
 * characters, so it is cut to its first word and capitalised, which is how the
 * fleet says it anyway. The full name and the count stay on the row below.
 */
function shortLabel(name) {
  const first = String(name).trim().split(/[\s-]+/)[0];
  return first.length <= 8 ? first.toUpperCase() : first.slice(0, 8).toUpperCase();
}

/** Ring geometry, as a fraction of the available radius. 0.58 matches the
 *  reference's proportion — thin enough to read as a ring, thick enough that a
 *  2% slice is still a visible band.
 *
 *  The OUTER radius is deliberately well under the box. Recharts sizes a
 *  percentage radius off the smaller of width and height, so a tall tile grows
 *  the ring sideways too and eats the margin the leader labels run into —
 *  measured on KASULU, a 111px ring left 44px for "OPTIM 11%" and clipped it.
 *  The ring is sized to leave the labels their column, not to fill the box.
 *  The binding case is KASULU at 320px: a 235px canvas, six labels, and
 *  "OTHER 46%" at 59px needing to sit clear of both the ring and the edge. */
const INNER = 0.58;

/** Minimum vertical gap between two labels on the same side, px.
 *
 *  Sized for the STACKED label: two lines of 9.5px type occupy about 20px, so
 *  anything under that overlaps its neighbour rather than merely crowding it. */
const LABEL_GAP = 21;

/** Width to reserve for a stacked label, px. Measured on the widest the two
 *  fleets actually produce: "COMPANY" over "8%" at 9.5px comes to 45. */
const LABEL_W = 45;

const RAD = Math.PI / 180;
const fmt = (n) => new Intl.NumberFormat("en-GB").format(n ?? 0);

/**
 * Push labels apart without reordering them.
 *
 * Each label wants to sit at its slice's mid-angle. Where two want the same
 * place, the later one is nudged down and the whole column is then shifted back
 * up if it has run past the bottom. Order is preserved, so a leader line never
 * crosses its neighbour.
 */
function spread(items, height) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap < LABEL_GAP) sorted[i].y = sorted[i - 1].y + LABEL_GAP;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - (height - 8) : 0;
  if (overflow > 0) for (const s of sorted) s.y -= overflow;
  const under = sorted.length ? 8 - sorted[0].y : 0;
  if (under > 0) for (const s of sorted) s.y += under;
  return items;
}

export default function FleetMixPie({ byType, total, typeLabel, caption = "vehicles", tailKeys }) {
  const [focused, setFocused] = useState(null);
  /** Label positions for the current render pass — see renderLabel. */
  const layout = useRef({});

  const slices = useMemo(() => {
    const sorted = Object.entries(byType ?? {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return [];

    // Some keys can never take a named slot however large they are. On KASULU
    // the plates with no recognisable prefix come to 14 units — enough to
    // outrank FTT and claim the seventh wedge, where they drew as a second
    // slice labelled "OTHER" beside the real remainder. They are not a category
    // anybody operates; they are plates nobody has named yet, so they belong in
    // the remainder with the rest of the tail.
    const forced = tailKeys instanceof Set ? tailKeys : new Set(tailKeys ?? []);
    const rankable = sorted.filter(([k]) => !forced.has(k));
    const head = rankable.slice(0, NAMED);
    const headKeys = new Set(head.map(([k]) => k));
    const tail = sorted.filter(([k]) => !headKeys.has(k));
    const out = head.map(([type, value], i) => ({
      key: type, name: typeLabel(type), value, color: SLICES[i],
    }));

    if (tail.length > 0) {
      out.push({
        key: "__rest",
        name: "Other",
        value: tail.reduce((a, [, n]) => a + n, 0),
        color: SLICES[NAMED],
        // Never dropped, only folded — the composition rides on the tooltip.
        detail: tail.map(([t, n]) => `${typeLabel(t)} ${fmt(n)}`).join(" · "),
      });
    }
    return out;
  }, [byType, typeLabel]);

  // The chart's own total, not the caller's. They can disagree — the server's
  // `active` count and the sum of its type buckets are separate figures — and a
  // share computed against a denominator the ring does not add up to is the
  // kind of small lie that survives for months.
  const drawn = slices.reduce((a, s) => a + s.value, 0);

  /** Identity of the current slice set — see the key on the container below. */
  const sliceKey = slices.map(s => s.key).join("|");

  if (slices.length === 0) {
    return (
      <div className="an-mix an-mix--empty">
        {total == null ? "Fleet composition loading…" : "No vehicle types reported"}
      </div>
    );
  }

  /**
   * One slice's label: an elbow leader line out to the side, then the name and
   * its share. Drawn per slice by recharts, which hands us the geometry.
   *
   * The whole column is laid out on the FIRST call of each render pass, because
   * collision resolution cannot be done one label at a time — a label only
   * knows it is too close to its neighbour once the neighbour has a position.
   * Recharts calls this in index order with identical geometry, so index 0
   * computes the set and the rest read it.
   */
  const renderLabel = (p) => {
    const { cx, cy, outerRadius, index } = p;
    const s = slices[index];

    // Recharts can call this with an index from the PREVIOUS dataset while the
    // new one is shorter, and reading .key off the gap throws hard enough to
    // unmount the whole card. Switching KASULU (eight slices) to SUKARI (three)
    // did exactly that: "Cannot read properties of undefined (reading 'key')",
    // and Today on the ground vanished from the page.
    if (!s) return null;
    // Budgeted from the geometry, not guessed at.
    //
    // Everything on this side of the ring shares one measurement: the distance
    // from the centre to the canvas edge, which recharts hands us as cx. The
    // ring takes its radius out of that, the label takes LABEL_W, and the
    // leader gets whatever is left. Fixed lengths kept clipping because the
    // canvas is not a fixed width — 261px on a desktop tile, 235px at 320px —
    // so a leader that fitted on one clipped on the other.
    //
    // Clamped at both ends: too short and the elbow stops reading as a leader,
    // too long and it wanders without adding clarity.
    const crowded = slices.length > 4;
    const budget = cx - outerRadius - LABEL_W;
    const lead = Math.max(8, Math.min(crowded ? 32 : 16, budget));
    const legOut = Math.round(lead * 0.62);
    const legAcross = Math.round(lead * 0.38);

    if (index === 0) {
      let acc = 0;
      const placed = slices.map((sl) => {
        const mid = 90 - ((acc + sl.value / 2) / drawn) * 360;
        acc += sl.value;
        const sinM = Math.sin(-mid * RAD);
        const cosM = Math.cos(-mid * RAD);
        return {
          key: sl.key,
          right: cosM >= 0,
          x0: cx + (outerRadius + 3) * cosM, y0: cy + (outerRadius + 3) * sinM,
          x1: cx + (outerRadius + legOut) * cosM,
          y: cy + (outerRadius + legOut) * sinM,
        };
      });
      // Each side is its own column — a label on the left cannot collide with
      // one on the right however close their angles are.
      spread(placed.filter((q) => q.right), cy * 2);
      spread(placed.filter((q) => !q.right), cy * 2);
      layout.current = Object.fromEntries(placed.map((q) => [q.key, q]));
    }

    const q = layout.current[s.key];
    if (!q) return null;
    const { right, x0, y0, x1 } = q;
    const y1 = q.y;
    const x2 = x1 + (right ? legAcross : -legAcross);

    const dim = focused != null && focused !== s.key;
    // Whole percents on the chart. "46.3%" is four glyphs wider than "46%",
    // and at this ring size that difference is the whole margin between a label
    // that fits beside the tile and one the tile clips — measured on KASULU,
    // CTR and OTHER were losing their tails. The decimal survives on the
    // tooltip, where there is room for it.
    const pct = drawn > 0 ? Math.round((s.value / drawn) * 100) : 0;

    return (
      <g className="an-mix__lbl" opacity={dim ? 0.35 : 1}>
        <polyline
          points={`${x0},${y0} ${x1},${y1} ${x2},${y1}`}
          stroke={s.color}
          strokeWidth={1}
          fill="none"
        />
        {/* Two lines, not one. The ring can only be as big as the labels
            leave room for, and beside it "OPTIM 11%" is 58px where "OPTIM"
            over "11%" is 40px — eighteen pixels per side that go straight
            into the radius. Stacking keeps the share on the chart instead of
            trading it away for size. */}
        <text
          x={x2 + (right ? 4 : -4)}
          textAnchor={right ? "start" : "end"}
          className="an-mix__lbl-name"
        >
          <tspan x={x2 + (right ? 4 : -4)} y={y1 - 4}>{shortLabel(s.name)}</tspan>
          <tspan x={x2 + (right ? 4 : -4)} y={y1 + 6} className="an-mix__lbl-pct">{pct}%</tspan>
        </text>
      </g>
    );
  };

  return (
    <div className="an-mix">
      <div className="an-mix__chart" aria-hidden="true">
        {/* Keyed on the slice set, which forces a remount whenever the
            categories change.

            Recharts keeps label state of its own alongside the data, and when
            the array SHRINKS it renders labels for entries that are gone:
            switching KASULU (eight slices) to SUKARI (three) threw "Cannot read
            properties of undefined (reading 'key')" from inside its PieLabels,
            the Analytics error boundary caught it, and Today on the ground
            disappeared from the page. The throw is above our own label
            renderer, so guarding there is not enough — the stale state has to
            not exist. Remounting is cheap here: a few hundred nodes, rebuilt
            only when the fleet actually changes. */}
        <ResponsiveContainer width="100%" height="100%" key={sliceKey}>
          {/* Asymmetric on purpose. The labels run OUTWARD from the ring, so
              the side margins are the room they need; top and bottom are pure
              overhead and every pixel spent there comes straight off the ring's
              diameter, which is the one thing that has to stay legible in a
              77px box. */}
          <PieChart margin={{ top: 2, right: 6, bottom: 2, left: 6 }}>
            <Tooltip
              cursor={false}
              wrapperStyle={{ outline: "none", zIndex: 40 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const s = payload[0].payload;
                const pct = drawn > 0 ? Math.round((s.value / drawn) * 1000) / 10 : 0;
                return (
                  <div className="an-mix__tip">
                    <b>{s.name}</b> {fmt(s.value)} · {pct}%
                    {s.detail && <div className="an-mix__tip-sub">{s.detail}</div>}
                  </div>
                );
              }}
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="62%"
              innerRadius={`${Math.round(62 * INNER)}%`}
              /* PINNED, and load-bearing. The label pass computes each slice's
                 mid-angle itself, so it has to know where recharts starts and
                 which way it turns. Left at the defaults it starts at 3 o'clock
                 and sweeps ANTI-clockwise: SUKARI's Tractor slice sits at 145°
                 while the label pass placed its line at −55°, so every name
                 pointed at a wedge that was not its own. 90 → −270 is one turn
                 clockwise from 12 o'clock, which is what the pass assumes. */
              startAngle={90}
              endAngle={-270}
              paddingAngle={1}
              stroke="var(--elevated)"
              strokeWidth={2}
              isAnimationActive={false}
              label={renderLabel}
              /* Our own polyline is drawn inside the label, so recharts' is off
                 — two lines to the same point is the tell that a chart was
                 assembled rather than drawn. */
              labelLine={false}
              onMouseEnter={(_, i) => setFocused(slices[i].key)}
              onMouseLeave={() => setFocused(null)}
            >
              {slices.map((s) => (
                <Cell
                  key={s.key}
                  fill={s.color}
                  /* Dimmed, never moved. Exploding or growing a wedge changes
                     the very quantity the ring encodes — its angle and area. */
                  opacity={focused == null || focused === s.key ? 1 : 0.35}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* The centre label is HTML over the SVG, not an SVG <text>: it has to
            pick up the same numeric styling as the rest of the card, and a
            foreignObject would not inherit it. */}
        <div className="an-mix__centre">
          <div className="an-mix__centre-v">{fmt(total ?? drawn)}</div>
          <div className="an-mix__centre-l">{caption}</div>
        </div>
      </div>

      {/* Visually hidden, deliberately. The leader lines already name every
          slice and give its share — that is what the reference's lines are FOR
          — so a legend repeating them underneath was redundant, and it was the
          redundancy that made this tile 379px and stretched every sibling in
          the row to match. The list stays in the DOM as the accessible copy of
          an aria-hidden canvas, and as the only way a keyboard reaches the
          slices; the exact counts ride on the tooltip. */}
      <ul className="an-mix__sr">
        {slices.map((s) => {
          const pct = drawn > 0 ? Math.round((s.value / drawn) * 1000) / 10 : 0;
          return (
            <li key={s.key}>
              <button
                type="button"
                className="an-mix__srrow"
                title={s.detail || undefined}
                onMouseEnter={() => setFocused(s.key)}
                onMouseLeave={() => setFocused(null)}
                onFocus={() => setFocused(s.key)}
                onBlur={() => setFocused(null)}
              >
                <span className="an-mix__dot" style={{ background: s.color }} aria-hidden="true" />
                <span className="an-mix__k">{s.name}</span>
                <span className="an-mix__v">{fmt(s.value)}</span>
                <span className="an-mix__p">{pct}%</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Exported for the collision test — the spread rule is the part most likely
 *  to break silently when the label type size changes. */
export { spread as __spreadLabels, LABEL_GAP as __LABEL_GAP };
