// Axis scaling: pick a round step from the data's own range, so a chart keeps a
// readable number of gridlines whatever the numbers happen to be.
//
// The problem this solves: a HARDCODED step only suits one order of magnitude.
// A 500 L step is right for a fleet peaking at 4,000 L, gives three gridlines
// for a quiet week peaking at 900, and gives forty-one — a chart taller than the
// viewport — the day the peak hits 20,000. Deriving the step from the range
// keeps the tick count (and therefore the chart's height) roughly constant
// instead of letting it track the size of the numbers.
//
// Steps come from the 1 / 2 / 2.5 / 5 ladder scaled by a power of ten, which is
// the set people read fluently: 25, 50, 100, 250, 500, 1000 … Anything else
// (a 300 or 700 step) forces the reader to do arithmetic to place a bar.

const NICE_MULTIPLES = [1, 2, 2.5, 5, 10]

/** Kill float dust from repeated addition: 0.1+0.2 style artefacts in labels. */
const tidy = (v, step) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  return Number(v.toFixed(Math.min(decimals, 10)))
}

/**
 * Choose a round step and the tick values for an axis spanning `min`…`max`.
 *
 * @param {number} max   Largest value that must fit on the axis.
 * @param {object} [opts]
 * @param {number} [opts.min=0]         Smallest value that must fit.
 * @param {number} [opts.targetTicks=6] Preferred number of gridlines.
 * @param {number} [opts.maxTicks=9]    Hard ceiling; the step grows until the
 *                                      tick count is at or under this.
 * @returns {{min:number, max:number, step:number, ticks:number[]}}
 *          `min`/`max` are the ROUNDED bounds (the axis ends on a step), which
 *          is what should be handed to the chart's domain so the top gridline
 *          is also the top of the plot.
 */
export function niceScale(max, { min = 0, targetTicks = 6, maxTicks = 9 } = {}) {
  const hiIn = Number.isFinite(max) ? max : 0
  const loIn = Number.isFinite(min) ? Math.min(min, hiIn) : 0

  // A flat or empty series still needs a drawable axis rather than a zero-height
  // domain, which would put every gridline on top of the baseline.
  if (hiIn === loIn) {
    const step = hiIn === 0 ? 1 : Math.abs(hiIn) / 2
    return { min: loIn, max: loIn + step * 2, step, ticks: [loIn, loIn + step, loIn + step * 2] }
  }

  let step = 0
  let lo = loIn
  let hi = hiIn
  let ticks = []

  // Start from the target density and coarsen until the axis fits maxTicks.
  // Rounding the bounds outward can add a tick, so this is a loop rather than a
  // single calculation.
  for (let want = targetTicks; want >= 2; want--) {
    const rough = (hiIn - loIn) / want
    const magnitude = 10 ** Math.floor(Math.log10(rough))
    const normalised = rough / magnitude
    const multiple = NICE_MULTIPLES.find((m) => normalised <= m) ?? 10
    step = multiple * magnitude

    lo = Math.floor(loIn / step) * step
    hi = Math.ceil(hiIn / step) * step

    ticks = []
    // The `step / 2` slack absorbs float error so the final tick isn't dropped.
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(tidy(v, step))

    if (ticks.length <= maxTicks) break
  }

  return { min: tidy(lo, step), max: tidy(hi, step), step, ticks }
}
