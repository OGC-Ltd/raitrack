/* Hallmark · component: gauge · genre: modern-minimal · theme: in-project
 * states: default · hover · focus · empty · loading
 */

// How much of the fleet's fuel-sensing is actually working, right now.
//
// ## Why a gauge and not another number
//
// The tile row already carries two proportions as rings. This is a third
// proportion, but it is the only one with a TARGET: a fleet mix is whatever the
// yard bought, and a working/idling split is whatever the day is doing, while
// sensor health has a right answer and it is 100%. A gauge is the shape that
// says "against a full scale" — the empty grey to the right of the needle is
// the part of the fleet nobody can measure fuel on, and it is meant to look
// like a shortfall rather than like a slice.
//
// ## What counts as working
//
// `sensorHealth === 'OK'` — the probe is fitted, calibrated, reporting, and its
// tracker is alive. Everything else is a fault with a name: the tracker has
// gone quiet, the probe has died or fallen silent, or it was never calibrated.
//
// The denominator excludes NOT_FITTED. A machine with no probe on it is not a
// broken probe, and counting it as one would make the yard look worse than it
// is for a decision nobody took today. Measured on KASULU 2026-08-21 that is
// one unit of 218, so the two readings differ by a fifth of a point — the
// reason is the principle, not the arithmetic.
//
// ## Drawn, not charted
//
// Plain SVG. recharts has no gauge, and the RadialBarChart people press into
// service for one cannot draw a needle or lay ticks outside its own arc. The
// geometry here is nine lines of trigonometry and it holds its shape at every
// width, which a ResponsiveContainer in a fixed-height tile does not.

import { useMemo } from "react";

// The faults, in the order an engineer would work through them: the ones that
// need a visit to the machine before the ones that need a calibration run.
const FAULTS = [
  { key: "TRACKER_SILENT", label: "Tracker silent" },
  { key: "DIED",           label: "Probe dead" },
  { key: "SILENT",         label: "Probe silent" },
  { key: "UNCALIBRATED",   label: "Uncalibrated" },
  { key: "UNKNOWN",        label: "Unknown" },
];

// Geometry. The arc is a semicircle from due west (0%) to due east (100%).
const CX = 110, CY = 112, R = 78, BAND = 15, TICK_R = 97;

const polar = (r, pct) => {
  const a = ((180 - pct * 180) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};

/** An arc of the band, as a path. Always the minor sweep — the gauge never
 *  spans more than 180 degrees, so large-arc is constant. */
function arc(from, to) {
  const [x1, y1] = polar(R, from);
  const [x2, y2] = polar(R, to);
  return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`;
}

export default function SensorGauge({ state }) {
  const g = useMemo(() => {
    const units = state?.units ?? [];
    if (units.length === 0) return null;

    const counts = {};
    for (const u of units) {
      const h = u.sensorHealth ?? "UNKNOWN";
      counts[h] = (counts[h] ?? 0) + 1;
    }
    const ok       = counts.OK ?? 0;
    const notFitted = counts.NOT_FITTED ?? 0;
    // Every unit that is SUPPOSED to be measuring fuel — see the header.
    const expected = units.length - notFitted;
    if (expected <= 0) return null;

    return {
      ok,
      expected,
      notFitted,
      pct: Math.round((ok / expected) * 100),
      faults: FAULTS.map(f => ({ ...f, n: counts[f.key] ?? 0 })).filter(f => f.n > 0),
    };
  }, [state]);

  if (!g) {
    return (
      <div className="an-gauge an-gauge--empty">
        <div className="an-card__head">
          <span className="an-card__title an-gauge__title">Probes &amp; sensors working</span>
        </div>
        <div className="an-gauge__empty">
          {state ? "No unit reports a sensor state." : "Reading sensor health…"}
        </div>
      </div>
    );
  }

  const v = g.pct / 100;
  // The needle is a wedge, not a line: wide across the hub and pointed at the
  // reading, so the end that carries the value is the end the eye lands on.
  const [tipX, tipY]   = polar(R - 12, v);
  const [baseAX, baseAY] = polar(7, v + 0.25);
  const [baseBX, baseBY] = polar(7, v - 0.25);

  // Every tenth, outside the band. Labelled rather than ticked — the reference
  // has no tick marks, only figures, and a mark plus a figure would be two
  // encodings of the same thing.
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);

  return (
    <div className="an-gauge">
      <div className="an-card__head">
        <span className="an-card__title an-gauge__title">Probes &amp; sensors working</span>
        <span className="an-card__hint">{g.ok} of {g.expected}</span>
      </div>

      <div className="an-gauge__plot">
        <svg
          viewBox="0 0 220 150"
          className="an-gauge__svg"
          role="img"
          aria-label={`${g.pct} per cent of fuel sensors working: ${g.ok} of ${g.expected} units`}
        >
          {/* The full scale first, so the reading is drawn ON a whole. */}
          <path
            d={arc(0, 1)}
            className="an-gauge__track"
            strokeWidth={BAND}
            fill="none"
            strokeLinecap="butt"
          />
          <path
            d={arc(0, v)}
            className="an-gauge__value"
            strokeWidth={BAND}
            fill="none"
            strokeLinecap="butt"
          />

          {ticks.map((t) => {
            const [x, y] = polar(TICK_R, t);
            return (
              <text
                key={t}
                x={x}
                y={y}
                className="an-gauge__tick"
                // Labels hug the arc: the ones on the left end are right-aligned
                // and the ones on the right end left-aligned, so none of them
                // reaches back across the band it belongs to.
                textAnchor={t < 0.42 ? "end" : t > 0.58 ? "start" : "middle"}
                dominantBaseline={t < 0.42 || t > 0.58 ? "middle" : "auto"}
              >
                {Math.round(t * 100)}%
              </text>
            );
          })}

          <polygon
            points={`${tipX},${tipY} ${baseAX},${baseAY} ${baseBX},${baseBY}`}
            className="an-gauge__needle"
          />

          <text x={CX} y={CY + 30} className="an-gauge__read" textAnchor="middle">
            {g.pct}
            <tspan className="an-gauge__read-unit">%</tspan>
          </text>
        </svg>
      </div>

      {/* What the grey is made of. A gauge that only says 66% invites the
          question this answers, and the answer is the actionable half: these
          are named faults with a machine attached to each. */}
      <div className="an-gauge__faults">
        {g.faults.map(f => (
          <span key={f.key} className="an-gauge__fault" title={`${f.n} ${f.label.toLowerCase()}`}>
            <b>{f.n}</b> {f.label.toLowerCase()}
          </span>
        ))}
        {g.notFitted > 0 && (
          <span className="an-gauge__fault an-gauge__fault--muted">
            <b>{g.notFitted}</b> no probe fitted
          </span>
        )}
      </div>
    </div>
  );
}
