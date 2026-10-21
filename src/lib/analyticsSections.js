/* Which sections of the Analytics page have something to say.
 *
 * The page used to render every section it could and let each one print its own
 * "nothing here" — so a narrow filter, or a fleet that does not do a particular
 * kind of work, produced a column of cards apologising. Asked for 2026-09-14:
 * a section with no records should not be drawn at all, and its space should
 * close up behind it.
 *
 * ## Three answers, and only ONE of them hides anything
 *
 * The reason this is a module rather than a handful of `&& rows.length` in the
 * JSX is that "empty" is three different states wearing one face, and hiding
 * the wrong one is how a page starts lying:
 *
 *   · LOADING — the feed has not answered yet. Hiding here makes the page
 *     rearrange itself under the reader's hands as each request lands, and a
 *     card that appears two seconds in is a card nobody was looking at.
 *   · ERROR — the feed failed. Hiding here is the worst of the three: the page
 *     looks complete and is short of a card, so nobody asks why. A failed
 *     section stays and says it is unavailable.
 *   · EMPTY — the feed answered, and the answer is that there is nothing in
 *     this window for this selection. This is the only one that is hidden.
 *
 * ## Hidden is not the same as absent, so the page says what it withheld
 *
 * A section removed silently cannot be told from a section this account may not
 * see, or from one that was never built. `withheldFrom` collects what was
 * dropped and why, and the page prints it in a line at the foot. That is the
 * difference between a page that is shorter because there is less to say and a
 * page that is shorter because something broke.
 */

/** A feed's answer, in the three states above. `error` wins, then `loading`. */
export function sectionState({ loading = false, error = null, hasRows = false } = {}) {
  if (error) return "error";
  if (loading) return "loading";
  return hasRows ? "ready" : "empty";
}

/** Draw it? Everything but a definite, answered emptiness. */
export const showSection = (state) => state !== "empty";

/* ───────────────────────────── the feeds ─────────────────────────────────
 *
 * One predicate per section, each naming the rows THAT SECTION draws rather
 * than asking whether the payload exists. A feed can arrive perfectly well
 * formed and carry nothing to plot — an org with no sales runs gets
 * `{ days: [], units: [], totals: {…} }` — and it is the plot that decides
 * whether there is a card worth showing.
 */

/** The fuel-rate chart: a day with a rate behind it, not merely a day. */
export const hasRateDays = (series) =>
  (series?.days ?? []).some((d) => d && (d.litresPerKm != null || d.litresPerHa != null));

/** Sales hauls — the tonnage chart's days, and the unit table's rows. */
export const hasHaulDays = (hauls) => (hauls?.days ?? []).length > 0;
export const hasHaulUnits = (hauls) => (hauls?.units ?? []).length > 0;

/** Fleet state, after the page's own filtering — the table draws `units`. */
export const hasFleetUnits = (state) => (state?.units ?? []).length > 0;

/**
 * The per-hour histogram needs units with BOTH an hours figure and a fuel one;
 * a fleet of units reporting hours and no litres draws an empty axis.
 */
export const hasFuelPerHour = (state) =>
  (state?.units ?? []).some((u) => (u.hoursMonthAvg ?? u.hoursWeekAvg ?? 0) > 0
                               && (u.fuelBurnL ?? u.fuelDropL ?? 0) > 0);

/** The delivery heatmap: a day the fleet actually ran. */
export const hasActiveDays = (byDay) => (byDay ?? []).some((d) => (d?.trips ?? 0) > 0);

/**
 * The plant daily-activity heatmap, which plots ground worked.
 *
 * `m2`, not `areaM2`. The excavator-area service returns TWO shapes and they
 * do not share a field name: each UNIT carries `areaM2` (the fleet-state
 * table's area columns read that one), and each DAY carries `m2` — see
 * excavator-area.service, `areaByDay`. This gate is handed the day rows and
 * was reading the unit's name off them, so `d.areaM2` was undefined on every
 * row, `?? 0` made it a zero, and the test could never pass.
 *
 * The cost was not a blank card. `show()` turns a failed gate into the
 * "empty" state, so Daily Activity was withheld from the one fleet it is built
 * for and then NAMED in the withheld-sections note at the foot — telling an
 * operator no ground had been measured while the table held 1,013 measured
 * day-rows over 20.3 km² (Mufindi, read 2026-09-14).
 */
export const hasAreaDays = (areaDays) =>
  (areaDays?.days ?? []).some((d) => (d?.m2 ?? 0) > 0);

/** Ground worked per unit, for the fleet-state section's area columns. */
export const hasArea = (area) => (area?.units ?? []).length > 0;

/**
 * What was dropped, for the note at the foot.
 *
 * Takes the same `{ label, state }` records the page built its decisions from,
 * so the note can never disagree with what was rendered — it is a reading of
 * the decisions, not a second guess at them.
 */
export const withheldFrom = (sections) =>
  sections.filter((s) => s && s.state === "empty").map((s) => s.label);

/**
 * The note itself, as a sentence.
 *
 * Says WHY in the same breath, because "3 sections hidden" invites exactly the
 * question it fails to answer. Null when nothing was withheld, so the caller
 * renders nothing rather than an empty line.
 *
 * Fronted with "Not shown:" rather than made into "X is not shown", because
 * the verb in that form has to agree with the LABEL and all this function can
 * count is the labels. A single plural label — "Units ferrying sugar" — took
 * the singular and read "Units ferrying sugar is not shown". Naming the
 * sections in a list after a colon removes the agreement from the sentence
 * instead of guessing at each label's grammatical number.
 */
export function withheldNote(labels, { filtered = false, window: win } = {}) {
  if (!labels?.length) return null;
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const where = win ? ` in ${win}` : " in this window";
  const why = filtered
    ? `${where} for the units and types selected`
    : where;
  return `Not shown: ${list}, no records${why}.`;
}
