/* Hallmark · component: operations control board (stat strip + site cards + rail)
 * genre: modern-minimal · theme: in-project (an-* tokens, inherited from the
 *   `.analytics-page` scope the Weighbridges screen puts this in)
 * states: default · live · quiet · unweighed · empty · loading · closed day
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 * contrast: all ink via --ink / --text-2 / --text-3; marks via --chart-1/2/4
 */

// The day at the bridges, as the yard runs it.
//
// The trend card beside this one answers "how have these bridges been running"
// over a fortnight. This answers the other question, the one somebody asks
// standing in an office at 15:00: what came in, what went out, what is still
// on the road, and which site is about to run out of work.
//
// ## Every figure here is a weighing
//
// There is no model in this panel and no estimate. A number appears because a
// scale printed it: cane is RECEIVED when a machine that weighed empty comes
// back loaded, DISPATCHED when a transfer is weighed loaded at its centre, and
// ARRIVED when the factory weighs that same lorry. See lib/weighbridgeBoard,
// which holds the derivation and the tests that pin it.
//
// Three things a board like this usually carries are therefore missing, and
// their absence is stated on the panel rather than filled in:
//
//   · a PHYSICAL heap. Nothing weighs the ground, so the stock figure is the
//     day's book MOVEMENT — in minus out — and is labelled as a movement.
//   · what is expected FROM THE FIELDS. No harvest feed exists behind these
//     bridges. The only "expected" figure that is real is what is already
//     loaded and on the road, so that is the one shown, at the mill.
//   · whether a lorry is standing ON SITE. A ticket open since 04:00 usually
//     means the machine is out at the farm, not parked at the scale — so the
//     count is called what it measures: a ticket that is still open.
//
// Inventing the other three would make the board look complete and be wrong in
// the direction that costs a mill money: an operator dispatching against cane
// that is not there.

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot, Label,
} from "recharts";
import { buildBoard, roadUnits, FIELDS } from "../../lib/weighbridgeBoard";
import "./WeighbridgeBoard.css";

const HOUR = 3_600_000;

/* Past this, a loaded lorry that the factory has not weighed has stopped being
   a journey. Sukari's outstations are inside an hour of the mill — the median
   centre-to-factory run measured over the live feed is well under two hours —
   so four is generous rather than twitchy: it is the mark at which somebody
   picks up a telephone, not the mark at which a lorry is late. */
const OVERDUE_MS = 4 * HOUR;

/* Blocks a row draws before it starts counting instead. Twelve fits the rail
   at its narrowest; beyond that the blocks stop being countable at a glance,
   which is the only thing they are for — and on this fleet's busiest day a
   yard can have thirty lorries out at once. */
const MAX_BLOCKS = 12;

const fmt = (n, d = 0) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);

/** Tonnes, to one decimal. The board is read at arm's length and a mill's day
 *  runs to four figures, so the kilogramme on the ticket is noise here — the
 *  grid one crumb away is where a ticket is read exactly. */
const t1 = (kg) => (kg == null ? "—" : fmt(kg / 1000, 1));

/** The same tonnage, for the HEADLINE figure on a site card.
 *
 *  That figure gets a third of the card's width and not a pixel more — three
 *  equal tracks, 8px apart — and at 21px it is the widest thing on the card by
 *  a long way. `t1`'s tenth is worth having at 40.6 t. At 15,337.8 t it is
 *  noise carried by two extra characters, and those two characters are exactly
 *  what pushed the mill's book figure out of its column and over the "Expected
 *  in" heading beside it. So the decimal is spent only while the figure is
 *  small enough to carry it; a mill running to four figures reads 15,338 t. */
const tHead = (kg) => (kg == null ? "—" : fmt(kg / 1000, Math.abs(kg) >= 1_000_000 ? 0 : 1));

/** A tonnage that has a DIRECTION: "+41 t" in, "−93 t" out. The book move is
 *  the one figure on the strip that is a difference rather than a total, and a
 *  bare "93 t" under "cane on the ground" would read as a level. */
const signed = (kg) =>
  (kg == null ? "—" : (kg < 0 ? "−" : "+") + fmt(Math.abs(kg) / 1000, 0) + " t");

/** A gap the way the yard says it: "2h 14m", "18m". */
function gap(msVal) {
  if (msVal == null) return "—";
  const mins = Math.round(msVal / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Rows the overdue list draws before it counts instead. */
const MAX_LATE_ROWS = 8;

const TYPE_WORD = { TRUCK: "Truck", TRACTOR: "Tractor" };

/** One vehicle's block: round for a tractor, filled once a scale has weighed
 *  it loaded, red past its run. */
function blockClass(x) {
  return "wbb-block"
    + (x.type === "TRACTOR" ? " wbb-block--tractor" : "")
    + (x.loaded ? "" : " wbb-block--out")
    + (x.overdue ? " wbb-block--late" : "");
}

/** "KDA 512Q · Truck · to OPAPO · loaded 17.6 t · out 3h 12m of a usual 12h 48m" */
function unitTitle(x) {
  return [
    x.plate,
    TYPE_WORD[x.type],
    x.destination && `to ${x.destination}`,
    x.loaded ? (x.netKg != null ? `loaded ${t1(x.netKg)} t` : "loaded") : "signed out",
    `out ${gap(x.elapsedMs)}` + (x.typicalMs != null ? ` of a usual ${gap(x.typicalMs)}` : ""),
  ].filter(Boolean).join(" · ");
}

/* Africa/Nairobi explicitly, not the browser's zone. The fleet day these rows
   are bucketed into is Kenyan, and a viewer in another zone reading "15:28"
   off their own clock beside a chart drawn on Nairobi's would be comparing two
   different afternoons. */
const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Nairobi",
});
/** "28 Sept, 21:35" — a moment that may be days back, in the fleet's zone. */
const dayClockFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Nairobi",
});
const dayClock = (ms) => dayClockFmt.format(ms);

function verdict(site, totals, spanDays, overdueRuns = 0, quiet = null) {
  if (site.silentAllDay) {
    return {
      tone: "none",
      text: spanDays > 1 ? "No weighing at this bridge in these days." : "No weighing at this bridge today.",
    };
  }

  /* The two failures, said last and colouring the whole line. A yard can be
     drawing down, holding a lorry that never arrived and off the air all at
     once; the ones that need a telephone call outrank the one that needs a
     decision. */
  const stalled = quiet?.level === "cold"
    ? ` No weighing since ${clock.format(site.lastAt)}.`
    : "";
  const late = overdueRuns > 0
    ? ` ${overdueRuns} vehicle${overdueRuns === 1 ? " has" : "s have"} been out longer than the run takes.`
    : "";
  const alert = Boolean(stalled || late);

  if (site.factory) {
    const coming = totals.onRoadRuns > 0
      ? `${totals.onRoadRuns} lorr${totals.onRoadRuns === 1 ? "y" : "ies"} loaded and not yet weighed in.`
      : "every transfer weighed out has been weighed in.";
    return {
      tone: alert ? "alert" : "flat",
      text: `Taking cane: ${coming}${late}${stalled}`,
    };
  }

  if (site.bookMoveKg < 0) {
    return {
      tone: alert ? "alert" : "down",
      text: `Drawing down: ${t1(Math.abs(site.bookMoveKg))} t more sent than taken in.${late}${stalled}`
        /* What the direction does NOT say, said once and only where there is
           room for it to be misread. Without it "drawing down" reads as a
           level, and a reader with the heap in mind will take it for one. */
        + (alert ? "" : " What is left on the ground is not weighed."),
    };
  }

  const dir = site.bookMoveKg > 0
    ? (site.dispatchedRuns === 0
        ? `Taking cane in and sending none on: ${t1(site.bookMoveKg)} t added.`
        : `Building: ${t1(site.bookMoveKg)} t more taken in than sent on.`)
    : "In and out level for the day.";

  return { tone: alert ? "alert" : "flat", text: `${dir}${late}${stalled}` };
}

/** How long a site has been silent, and whether that is worth saying.
 *
 *  Only on a day still running: on a closed day every site is "quiet", which
 *  is not news about the site, it is news about the calendar. */
function silence(site, asOf, closed) {
  if (closed) return null;
  if (site.lastAt == null) return { level: "none", label: "No ticket yet" };
  const since = asOf - site.lastAt;
  if (since >= 3 * HOUR) return { level: "cold", label: `Quiet ${gap(since)}` };
  if (since >= 90 * 60_000) return { level: "slow", label: `Last ${gap(since)} ago` };
  return { level: "live", label: "Working" };
}

// ── the strip ──────────────────────────────────────────────────────────────

function Stat({ n, unit, label, sub, tone, title }) {
  return (
    <div className="wbb-stat" title={title}>
      {/* Label above the figure, as the design this follows sets it: seven
          cells read across are seven headings first and seven numbers second,
          and a caption arriving after its number makes the row something you
          read twice. */}
      <div className="wbb-stat__l">{label}</div>
      <div className={"wbb-stat__n" + (tone ? ` wbb-stat__n--${tone}` : "")}>
        {n}{unit && <span className="wbb-stat__u">{unit}</span>}
      </div>
      {sub && <div className="wbb-stat__s">{sub}</div>}
    </div>
  );
}

// ── a site's day, as a line ────────────────────────────────────────────────

/**
 * The yard's stock line: what the BOOK says is standing here, through the day.
 *
 * One series, not two. It is the running balance — cane received off the
 * fields less cane sent on to the mill — because that is the shape an operator
 * reads a yard by: rising means it is filling, falling means the lorries are
 * emptying it faster than the fields fill it. At the mill, which sends nothing
 * on, the same line is simply its intake.
 *
 * Inline SVG rather than a charting component per card: this is one monotone
 * line with no tooltip and no legend, and four recharts instances is a
 * measurable amount of work for a picture whose whole job is to say "steady",
 * "stopped at eleven", or "drawn right down".
 *
 * The zero rule is drawn whenever the line goes below it, because a yard that
 * has sent out more than it took in has crossed a line that matters and a
 * curve with no datum cannot show that it has.
 */
function SiteLine({ site, lastBucket }) {
  const W = 300, H = 62, PAD = 6;
  const { series, top, bottom } = useMemo(() => {
    const out = [];
    let bal = 0;
    for (let i = 0; i <= lastBucket; i += 1) {
      bal += (site.received[i] ?? 0) - (site.factory ? 0 : (site.dispatched[i] ?? 0));
      out.push(bal);
    }
    const hi = Math.max(0, ...out);
    const lo = Math.min(0, ...out);
    // A flat day still needs a scale, or every point divides by zero.
    return { series: out, top: hi === lo ? hi + 1 : hi, bottom: hi === lo ? lo - 1 : lo };
  }, [site, lastBucket]);

  /* A bridge that weighed nothing gets the rule and a word, not a coloured
     line lying on the baseline: a line drawn in the stock hue is a claim that
     there was stock, and at this size the eye reads colour before height. */
  if (site.silentAllDay || series.length < 2) {
    return <div className="wbb-stock__flat"><span>No movement recorded</span></div>;
  }

  const x = (i) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - bottom) / (top - bottom)) * (H - PAD * 2);
  const path = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const zero = y(0);

  return (
    <svg className="wbb-stock__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
         aria-label={`Book stock at ${site.name} through the day`}>
      <path d={`${path}L${x(series.length - 1)},${zero} L${x(0)},${zero}Z`} className="wbb-stock__fill" />
      {bottom < 0 && <line x1="0" x2={W} y1={zero} y2={zero} className="wbb-stock__zero" />}
      <path d={path} className="wbb-stock__path" />
    </svg>
  );
}

// ── one bridge ─────────────────────────────────────────────────────────────

/**
 * What the yard is doing, in a sentence.
 *
 * Read off the same figures the card already shows rather than off a rule of
 * its own, so it can never disagree with the numbers above it. It states the
 * DIRECTION, which is the one thing three static tonnages cannot: a yard at
 * +40 t that has climbed all day and one at +40 t with every lorry gone are
 * the same three numbers and different problems.
 *
 * ## The four tones
 *
 *   amber  DRAWING DOWN. The yard has sent more than it took in, which is the
 *          state an operator acts on: it is the one that ends with a mill
 *          waiting. It does not mean the yard is empty — nothing here counts
 *          the heap — so the line says what it is and the caveat says what it
 *          is not.
 *   red    something has stopped. A bridge that has gone quiet while the day
 *          is still running, or a lorry loaded here that the factory has not
 *          weighed past the mark. Both are failures of the FEED or of the
 *          run, not of the yard's arithmetic, and both need somebody now.
 *   plain  a yard building or level: a direction with nothing outstanding
 *          behind it.
 *   grey   nothing was weighed at this bridge at all.
 *
 * There is no green. Green says "on plan", and a plan is exactly what this
 * feed does not carry — no mill target, no harvest schedule, no count of what
 * is standing on the ground.
 *
 * ## Punctuation
 *
 * Colons introduce the figure that explains the state, and every clause is a
 * finished sentence. No dashes: a dash between a state and its number reads
 * as an aside, and this line is the card's conclusion.
 */
function SiteCard({ site, lastBucket, asOf, closed, totals, spanDays, axis, overdueRuns }) {
  const state = silence(site, asOf, closed);
  const mill  = site.factory;
  const say   = verdict(site, totals, spanDays, overdueRuns, state);
  /* What the card's captions call the span they describe. The two vocabularies
     are written out rather than composed from a suffix: "weighed in" + "in
     span" reads as "weighed in in span", which is how a caption built by
     concatenation gives itself away. */
  const when  = spanDays > 1 ? "span" : "today";

  /* What the mill can expect, and what a yard can.
   *
   * At the MILL it is weighed cane: tonnes loaded at a centre and not yet
   * weighed at the factory. Nothing about it is estimated.
   *
   * At a YARD there is no field-dispatch feed to say what is coming, so the
   * only honest forward figure is the tickets that are OPEN — machines that
   * weighed empty here and have not come back — priced at what a load has
   * actually weighed here today. The line beneath states the arithmetic —
   * how many are out, and what one load has weighed — so the figure is read
   * as what it is. Where nothing has come back yet there is no average to
   * price it with, and the card says that instead of guessing.
   */
  /* Nothing pending is a DASH, not a zero. '0.0 t expected, 0 tickets open'
     is arithmetic on an empty set dressed up as a measurement, and it reads at
     a glance like a yard with nothing coming when what it means is that every
     ticket here is closed. */
  const nothingPending = mill ? totals.onRoadRuns === 0 : site.openTickets === 0;
  const expected = nothingPending
    ? { kg: null, estimate: false, sub: null,
        none: mill ? 'nothing on the road' : 'no ticket open here' }
    : mill
    ? {
        kg: totals.onRoadKg,
        estimate: false,
        sub: `${totals.onRoadRuns} on the road`,
        avg: totals.onRoadRuns > 0 ? totals.onRoadKg / totals.onRoadRuns : null,
      }
    : {
        kg: site.avgLoadKg == null ? null : site.openTickets * site.avgLoadKg,
        estimate: true,
        sub: `${site.openTickets} ticket${site.openTickets === 1 ? "" : "s"} open`,
        avg: site.avgLoadKg,
      };

  return (
    <article className={"wbb-site"
      + (mill ? " wbb-site--mill" : "")
      /* Dimmed and stated, not merely zeroed. A card of zeroes styled like its
         working neighbours reads at a glance as a yard running quietly; this
         one has not weighed anything at all. */
      + (site.silentAllDay ? " wbb-site--silent" : "")}>

      <header className="wbb-site__head">
        <h4 className="wbb-site__name">{site.name}</h4>
        <span className="wbb-site__kind">{mill ? "Mill" : "Yard"}</span>
        {site.silentAllDay
          ? <span className="wbb-chip wbb-chip--none">Nothing weighed</span>
          : state && <span className={`wbb-chip wbb-chip--${state.level}`}>{state.label}</span>}
      </header>

      {/* How current the card is. The board has no push feed — it is the day's
          tickets, re-read — so this says LAST WEIGHING, which is the real
          freshness, rather than "updated", which would be the time of the
          fetch and would tick along happily over a bridge that stopped
          reporting at nine. */}
      <div className="wbb-site__meta">
        {spanDays > 1 ? `${spanDays} days` : closed ? "Closed day" : "Live feed"}
        {site.lastAt
          ? <> · last weighing <b>{clock.format(site.lastAt)}</b></>
          : <> · nothing weighed</>}
      </div>

      <div className="wbb-site__figs">
        {/* PHYSICAL — kept as a column and left empty on purpose.
            Nothing in this feed counts the heap on the ground: a weighbridge
            weighs lorries, and the yard count is a walk round with a tally
            that reaches us nowhere. Putting the book figure under a "physical"
            label, or dropping the column so the card looks whole, are the two
            ways this becomes a number somebody dispatches against. */}
        <div className="wbb-fig wbb-fig--absent">
          <span className="wbb-fig__l">Physical</span>
          <span className="wbb-fig__n">—</span>
          <span className="wbb-fig__s">no yard count in this feed</span>
        </div>

        <div className="wbb-fig">
          <span className="wbb-fig__l">Book</span>
          <span className={"wbb-fig__n" + (!mill && site.bookMoveKg < 0 ? " wbb-fig__n--down" : "")}>
            {tHead(mill ? site.receivedKg + site.arrivedKg : site.bookMoveKg)}<i>t</i>
          </span>
          {/* No "gap" line: a gap is book against physical, and there is no
              physical. What the figure IS gets said instead. */}
          <span className="wbb-fig__s">
            {/* "today" only when it IS today's figure — the picker reaches a
                range, and a caption naming one day under a fortnight's total
                is the quiet way this card starts lying. */}
            {mill
              ? (when === "today" ? "weighed in today" : "weighed in over these days")
              : site.bookMoveKg === 0
                ? (when === "today" ? "in and out level today" : "level over these days")
                : site.bookMoveKg > 0
                  ? (when === "today" ? "in over out today" : "more in than out")
                  : (when === "today" ? "out over in today" : "more out than in")}
          </span>
        </div>

        <div className="wbb-fig">
          <span className="wbb-fig__l">Expected in</span>
          <span className="wbb-fig__n">
            {expected.kg == null
              ? "—"
              : <>{tHead(expected.kg)}<i>t</i></>}
          </span>
          <span className="wbb-fig__s">
            {expected.kg == null
              ? (expected.none ?? "no load weighed here yet")
              : <>{expected.sub}{expected.avg != null && <> · {t1(expected.avg)} t each</>}</>}
          </span>
        </div>
      </div>

      <div className="wbb-stock">
        <div className="wbb-stock__head">
          <span>Yard stock (book){spanDays > 1 ? "" : " today"}</span>
          {/* Where the design this follows offers a physical/book toggle, there
              is one series here and the label says why. */}
          <span className="wbb-stock__hint">book only</span>
        </div>
        <SiteLine site={site} lastBucket={lastBucket} />
        {/* The span's own quarter marks — clock over a day, dates over more —
            rather than three hours typed into the markup, which stopped being
            true the moment the picker could reach a fortnight. */}
        <div className="wbb-stock__axis">
          {/* Keyed by POSITION, not by the label: a two-day span puts the same
              date under two of the three marks, and keying on the text made
              React drop one of them. */}
          {axis.map((a, i) => <span key={i}>{a}</span>)}
        </div>
      </div>

      {/* The ticket's four stations, in the order a lorry passes them: it
          weighs empty and goes out, comes back loaded, is sent on to the mill,
          and is weighed in there. The stage currently holding cane is lit. */}
      <div className="wbb-site__counts">
        <div className={"wbb-count" + (site.openTickets > 0 ? " wbb-count--live" : "")}>
          <span className="wbb-count__n">{site.openTickets}</span>
          <span className="wbb-count__l" title="Weighed empty here and not yet weighed loaded. Most of these machines are out at the farm rather than standing at the scale.">Out empty</span>
        </div>
        <div className="wbb-count">
          <span className="wbb-count__n">{site.receivedTrips}</span>
          <span className="wbb-count__l">Loaded in</span>
        </div>
        <div className="wbb-count">
          <span className="wbb-count__n">{mill ? site.arrivedRuns : site.dispatchedRuns}</span>
          <span className="wbb-count__l">{mill ? "Weighed in" : "Dispatched"}</span>
        </div>
        <div className={"wbb-count" + ((mill ? totals.onRoadRuns : site.onRoadRuns) > 0 ? " wbb-count--on" : "")}>
          <span className="wbb-count__n">{mill ? totals.onRoadRuns : site.onRoadRuns}</span>
          {/* "On road", not "On the road": the four station labels sit on one
              line each in a tile a quarter of the card wide, and this is the
              only one of the six that cannot. The article is the word it can
              afford to lose — the full phrase stays on the tooltip. */}
          <span className="wbb-count__l" title={mill ? "Loaded at an outstation and not yet weighed in here." : "Dispatched from here and not yet weighed in at the mill."}>
            {mill ? "Coming in" : "On road"}
          </span>
        </div>
      </div>

      <footer className="wbb-site__foot">
        <div className="wbb-site__kit">
          {site.bridges.length > 0
            ? <>Scale{site.bridges.length === 1 ? "" : "s"} {site.bridges.map(b => `#${b}`).join(" ")}</>
            : <>No scale recorded</>}
          <i>·</i>{site.lorries} lorr{site.lorries === 1 ? "y" : "ies"}
          <i>·</i>{site.openTransfers} truck / {site.openDeliveries} field open
        </div>
        <div className="wbb-site__kit">
          Received <b>{t1(site.receivedKg)} t</b>
          <i>·</i>{mill ? "Weighed in" : "Dispatched"} <b>{t1(mill ? site.arrivedKg : site.dispatchedKg)} t</b>
        </div>
      </footer>

      <p className={`wbb-say wbb-say--${say.tone}`}>{say.text}</p>
    </article>
  );
}

// ── the rail ───────────────────────────────────────────────────────────────

function FlowTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="wbb-tip">
      <div className="wbb-tip__h">{label}</div>
      <div className="wbb-tip__r"><span>Received from fields</span><b>{t1(d.receivedKg)} t</b></div>
      <div className="wbb-tip__r"><span>Dispatched to mill</span><b>{t1(d.dispatchedKg)} t</b></div>
      <div className="wbb-tip__r"><span>Weighed in at the mill</span><b>{t1(d.arrivedKg)} t</b></div>
    </div>
  );
}

/**
 * One weighing as one sentence: PLACE · WHAT HAPPENED · HOW MUCH.
 *
 * Three segments, always in that order, joined by the same middle dot — so a
 * reader running down the feed finds the site in the same position on every
 * row and the tonnage at the same end, and can scan one column of it without
 * reading the sentences.
 *
 * The weight is its own segment rather than part of the phrase because a third
 * of these rows do not have one: a lorry weighing in EMPTY is an event with no
 * tonnage, and "· 0.0 t" would be a weight that was never recorded.
 */
const KIND_PHRASE = {
  received:   (e) => `${e.vehicleNo} in`,
  dispatched: (e) => `${e.vehicleNo} dispatched`,
  arrived:    (e) => `${e.vehicleNo} weighed in from ${e.from}`,
  empty:      (e) => `${e.vehicleNo} arrived empty`,
};

function FeedRow({ e }) {
  const phrase = (KIND_PHRASE[e.kind] ?? (() => e.kind))(e);
  return (
    <li className={`wbb-feed__row wbb-feed__row--${e.kind}`}>
      <span className="wbb-feed__t">{clock.format(e.at)}</span>
      <span className="wbb-feed__txt">
        {e.site}
        <i className="wbb-feed__dot">·</i>
        {phrase}
        {e.kg != null && (
          <>
            <i className="wbb-feed__dot">·</i>
            <b className="wbb-feed__kg">{t1(e.kg)} t</b>
          </>
        )}
      </span>
    </li>
  );
}

// ── the panel ──────────────────────────────────────────────────────────────

/**
 * @param rows     every ticket in the span, all centres.
 * @param from     first fleet day being viewed, YYYY-MM-DD.
 * @param to       last fleet day, inclusive. Equal to `from` for one day,
 *                 which is what most readings are.
 * @param centres  the fleet's OWN bridges, from its whole ticket history —
 *                 Sukari has four. Every one gets a card, because a bridge
 *                 that weighed nothing is a card somebody needs and a board
 *                 drawn from the rows alone would simply not mention it.
 * @param dispatched the server's /weighments/dispatched answer (the trucks and
 *                 tractors FactorySuite signed out and not yet back), or null.
 */
export default function WeighbridgeBoard({ rows, from, to, centres, loading, dispatched = null }) {
  /* `Date.now()` is read once per build rather than per render: the elapsed
     times below would otherwise disagree between two cards drawn in the same
     paint, and the span's figures do not move between them either. */
  const board = useMemo(
    () => buildBoard(rows ?? [], { from, to: to ?? from, centres: centres ?? [], now: Date.now() }),
    [rows, from, to, centres],
  );
  const { totals, sites, flow, transit, activity, closed, asOf, spanDays, axis } = board;

  /* Every vehicle out on a run to the mill: FactorySuite's dispatches (trucks
     and tractors signed out, from the webhook) merged with the transfer
     tickets loaded at a yard and not yet weighed in. See lib/weighbridgeBoard
     `roadUnits`. A closed span has nothing "out", so only tickets count there. */
  const units = useMemo(
    () => roadUnits(transit, closed ? [] : (dispatched?.units ?? []), OVERDUE_MS),
    [transit, dispatched, closed],
  );
  const unitCounts = useMemo(() => ({
    trucks:   units.filter(u => u.type === "TRUCK").length,
    tractors: units.filter(u => u.type === "TRACTOR").length,
  }), [units]);

  /* Grouped by yard. Built off the SITE list rather than off the units, so a
     yard with nothing out still gets a line saying so — the reading somebody
     is looking for when the mill is short. The mill itself is left out: it is
     where these vehicles are going. Runs sent to a farm get one "Fields" row,
     drawn only when there is one: their cane comes to the mill's own scale. */
  const roadBySite = useMemo(() => {
    const out = sites
      .filter(s => !s.factory)
      .map(s => {
        const trucks = units.filter(u => u.code === s.code);
        return { code: s.code, name: s.name, trucks, kg: trucks.reduce((n, x) => n + (x.netKg ?? 0), 0) };
      });
    const fields = units.filter(u => u.code === FIELDS || !sites.some(s => s.code === u.code && !s.factory));
    if (fields.length) out.push({ code: FIELDS, name: "Fields", trucks: fields, kg: 0 });
    return out;
  }, [sites, units]);

  const overdue = useMemo(() => units.filter(u => u.overdue), [units]);
  /* The SHORTEST wait in the set, which is what makes the header honest as a
     "≥": every vehicle in the panel has been out at least this long. The
     longest would be the more alarming number and the less true one. */
  const overdueFloor = overdue.length ? Math.min(...overdue.map(x => x.elapsedMs)) : null;
  /* Overdue vehicles per yard, keyed by centre — the same set the rail's panel
     lists, so a card and that panel can never disagree about which yards have
     something outstanding. */
  const overdueByCode = useMemo(
    () => overdue.reduce((m, x) => m.set(x.code, (m.get(x.code) ?? 0) + 1), new Map()),
    [overdue],
  );

  /* How live the dispatch feed is. FactorySuite sent no cane dispatch from 20
     to 26 Sep 2026; when that happens the panel must say so, or an empty
     "Fields" row reads as a quiet day rather than a silent feed. */
  const lastDispatchAt = dispatched?.lastDispatchAt ? Date.parse(dispatched.lastDispatchAt) : null;
  const feedQuiet = !closed && dispatched && (lastDispatchAt == null || asOf - lastDispatchAt > 24 * HOUR);

  if (!sites.length) {
    return (
      <div className="wbb-empty">
        {loading ? "Reading the bridges…" : "No ticket was weighed at any bridge in this span."}
      </div>
    );
  }

  /* The last point the day has reached — the end of both lines, and what the
     two figures printed on them and the sentence under the chart all read
     from, so those three can never disagree with each other. */
  const chart = flow.map(p => ({
    label: p.label,
    receivedKg: p.receivedKg,
    dispatchedKg: p.dispatchedKg,
    arrivedKg: p.arrivedKg,
    received: p.receivedKg / 1000,
    dispatched: p.dispatchedKg / 1000,
  }));
  const last = chart.length ? chart[chart.length - 1] : null;

  /* What one load has weighed across the WHOLE fleet today, and what the
     machines still out are therefore worth.
     Fleet-wide rather than per-site because the strip is a zone figure; the
     site cards price their own open tickets at their own average, which is the
     right denominator there and the wrong one here. Null, never zero, when
     nothing has come back yet: there is no average of no loads. */
  const zoneAvgLoadKg = totals.receivedTrips > 0
    ? totals.receivedKg / totals.receivedTrips
    : null;
  const expectedFields = zoneAvgLoadKg == null
    ? null
    : totals.openTickets * zoneAvgLoadKg;

  /* The board's four panels. A mill with many yards keeps them in the rail;
     one with one or two lays them beside its card(s) — see the grid below. */
  const fewSites = sites.length <= 2;
  const roadPanel = (
    <section className="wbb-panel">
      <h4 className="wbb-panel__h">
        Vehicles on the road to the mill
        <span className="wbb-panel__n">{units.length}</span>
      </h4>
      {/* Trucks and tractors, one block each, ranked by yard. FactorySuite's
          dispatches (signed out, from the webhook) and the transfer
          tickets loaded at a yard, as one list — see `roadUnits`. A block
          is filled once a scale has weighed the vehicle loaded, hollow
          while it is only signed out; a tractor is drawn round.

          Every yard gets a line, including the ones with nothing out —
          "None out" is the reading somebody is looking for when the mill
          is short. */}
      <p className="wbb-panel__sub">
        {unitCounts.trucks} truck{unitCounts.trucks === 1 ? "" : "s"} · {unitCounts.tractors} tractor{unitCounts.tractors === 1 ? "" : "s"}
        {units.length - unitCounts.trucks - unitCounts.tractors > 0 && <> · {units.length - unitCounts.trucks - unitCounts.tractors} other</>}
        {" · "}<i className="wbb-key wbb-key--loaded" aria-hidden="true" /> loaded
        {" "}<i className="wbb-key" aria-hidden="true" /> signed out
      </p>
      <ul className="wbb-road">
        {roadBySite.map(r => (
          <li key={r.code} className="wbb-road__row">
            <span className="wbb-road__site">{r.name}</span>
            {r.trucks.length === 0 ? (
              <span className="wbb-road__none">None out</span>
            ) : (
              <span className="wbb-road__blocks">
                {r.trucks.slice(0, MAX_BLOCKS).map(x => (
                  <i key={x.key} className={blockClass(x)} title={unitTitle(x)} />
                ))}
                {r.trucks.length > MAX_BLOCKS && (
                  <em className="wbb-block__more">+{r.trucks.length - MAX_BLOCKS}</em>
                )}
                {r.kg > 0 && <b className="wbb-road__t">{t1(r.kg)} t</b>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {feedQuiet && (
        <p className="wbb-panel__note">
          No dispatch from FactorySuite {lastDispatchAt ? <>since {dayClock(lastDispatchAt)}</> : "yet"}
          {" — "}only lorries weighed loaded at a yard are shown.
        </p>
      )}
    </section>
  );

  /* ── Out longer than a run takes ──────────────────────────────
     A SUBSET of the vehicles above: the ones out past the point where
     the journey explains it. For a dispatched unit that point is
     MEASURED — the median of the completed runs to the same
     destination, from FactorySuite's sign-out and sign-back — so a
     tractor to a farm two hours away and a truck to Opapo are each
     held to their own run. A lorry seen only on a transfer ticket is
     held to the fixed mark: loaded at a yard and not weighed at the
     factory after it. The header reads "≥" because it is the shortest
     of these waits. */
  const overduePanel = (
    <section className="wbb-panel">
      <h4 className="wbb-panel__h">
        Out longer than a run takes
        <span className={"wbb-panel__fig" + (overdue.length ? " wbb-panel__fig--late" : "")}>
          {overdue.length ? <>≥ {gap(overdueFloor)}</> : "none"}
        </span>
      </h4>
      <p className="wbb-panel__sub">
        Past the usual run to its destination, or loaded and not weighed at the factory after {gap(OVERDUE_MS)}
      </p>
      {overdue.length === 0 ? (
        <p className="wbb-panel__empty">
          Nothing is out past its usual run.
        </p>
      ) : (
        <ul className="wbb-late">
          {overdue.slice(0, MAX_LATE_ROWS).map(x => (
            <li key={x.key} className="wbb-late__row" title={unitTitle(x)}>
              <i className={blockClass(x)} aria-hidden="true" />
              <span className="wbb-late__plate">{x.plate}</span>
              <span className="wbb-late__dest">{x.destination ?? "—"}</span>
              <span className="wbb-late__time">
                <b>{gap(x.elapsedMs)}</b>
                {x.typicalMs != null && <> / {gap(x.typicalMs)}</>}
              </span>
            </li>
          ))}
          {overdue.length > MAX_LATE_ROWS && (
            <li className="wbb-late__more">+{overdue.length - MAX_LATE_ROWS} more</li>
          )}
        </ul>
      )}
      {dispatched?.staleCount > 0 && !closed && (
        <p className="wbb-panel__note">
          {dispatched.staleCount} older run{dispatched.staleCount === 1 ? " was" : "s were"} never
          signed back in FactorySuite and {dispatched.staleCount === 1 ? "is" : "are"} not counted.
        </p>
      )}
    </section>
  );

  const livePanel = (
    <section className="wbb-panel">
      <h4 className="wbb-panel__h">
        Live activity
        <span className="wbb-panel__n">{board.activityTotal}</span>
      </h4>
      <ul className="wbb-feed">
        {activity.map((e, i) => (
          <FeedRow key={`${e.at}-${e.vehicleNo}-${e.kind}-${i}`} e={e} />
        ))}
      </ul>
    </section>
  );

  /* ── The zone's day ──────────────────────────────────────────────
     First in the rail, above the two panels that answer what is still
     out — the day, then what is outstanding from it.
     
     It is a taller, quieter panel than it was: the gap between these
     two lines is the whole question — is the mill being fed faster
     than the yards are filling — and at 190px with a Y axis eating
     the left edge that gap was visible without being readable. The
     axis is gone, the plot has its own frame and its own air, and
     each line carries its running total printed where it ends, so
     the two figures are read off the picture rather than hunted for
     in the strip above. */
  const flowPanel = (
    <section className="wbb-panel wbb-flow">
      <div className="wbb-flow__head">
        <h4 className="wbb-flow__h">
      Cane flow{spanDays > 1 ? ` over ${spanDays} days` : closed ? "" : " so far today"}
    </h4>
        <span className="wbb-flow__keys">
          <span className="wbb-flow__key"><i className="wbb-key wbb-key--in" />Received from fields</span>
          <span className="wbb-flow__key"><i className="wbb-key wbb-key--out" />Dispatched to the mill</span>
        </span>
      </div>

      {/* Cumulative, not per-hour. The question is "are we ahead of the mill
          or behind it", which is a question about two running totals — an
          hourly bar chart makes the same two numbers a comparison the reader
          has to do in their head.

          No Y axis. The two figures worth reading off this chart are where
          the lines END, and those are printed on the lines; a column of
          gridline values down the left is then a second way of saying the
          same thing, in the space the chart is trying to give back. */}
      <div className="wbb-flow__plot">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 16, right: 54, bottom: 2, left: 2 }}>
            <defs>
              <linearGradient id="wbbIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--chart-2)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "var(--text-3)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
              minTickGap={34}
            />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip content={<FlowTip />} cursor={{ stroke: "var(--border-hi)" }} />

            {/* Where the day has got to. On a running day that is the clock;
                on a closed one the lines simply end and the rule would be
                marking midnight, which is not news. */}
            {!closed && last && (
              <ReferenceLine x={last.label} stroke="var(--text-3)" strokeDasharray="4 4" strokeOpacity={0.55} />
            )}

            <Area type="monotone" dataKey="received"   stroke="var(--chart-2)" strokeWidth={2.2} fill="url(#wbbIn)" />
            <Area type="monotone" dataKey="dispatched" stroke="var(--chart-1)" strokeWidth={2.2} fill="none" />

            {/* The running total, printed on the line that carries it.
                Dispatched sits above its point and received below, because
                on this fleet the two cross and re-cross through the morning
                and two labels on the same side would collide on exactly the
                days worth looking at. */}
            {last && (
              <ReferenceDot x={last.label} y={last.dispatched} r={3.5}
                            fill="var(--chart-1)" stroke="none" isFront>
                <Label value={`${fmt(last.dispatched, 0)} t`} position="right" offset={10}
                       style={{ fill: "var(--chart-1)", fontSize: 13, fontWeight: 800 }} />
              </ReferenceDot>
            )}
            {last && (
              <ReferenceDot x={last.label} y={last.received} r={3.5}
                            fill="var(--chart-2)" stroke="none" isFront>
                <Label value={`${fmt(last.received, 0)} t`} position="right" offset={10}
                       style={{ fill: "var(--chart-2)", fontSize: 13, fontWeight: 800 }} />
              </ReferenceDot>
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="wbb-flow__foot">
        {/* The gap between the two lines, said in words, because it is the
            reading the chart is FOR and a picture of two lines does not
            state which is ahead. */}
        {last
          ? <>
              <b>{fmt(last.dispatched, 0)} t</b> sent to the mill against{" "}
              <b>{fmt(last.received, 0)} t</b> taken in off the fields
              {" — "}
              {last.dispatched > last.received
                ? <>the yards are <b>{fmt(last.dispatched - last.received, 0)} t</b> down on the day.</>
                : last.dispatched < last.received
                  ? <>the yards are <b>{fmt(last.received - last.dispatched, 0)} t</b> up on the day.</>
                  : <>level on the day.</>}
            </>
          : "Nothing weighed at any bridge on this day."}
      </div>
    </section>
  );

  return (
    <div className="wbb">
      {/* ── The day in seven figures ─────────────────────────────────────
          The order is the cane's own: what is standing on the ground, how far
          the book is from it, what came in, what went out, what the fields
          still owe, what is between a yard and the mill, and how many machines
          did the work. Read left to right it is one day at a sugar zone.

          Two of the seven have no source behind them and are drawn as a dash
          rather than filled in — see the notes on each. A strip where five
          figures are weighings and two are guesses, all set in the same type,
          is the version of this panel that gets somebody to dispatch against
          cane that is not there. */}
      <div className="wbb-strip">
        {/* 1 · CANE ON THE GROUND — physical.
            Nothing in this feed counts the heap: a weighbridge weighs lorries.
            The book figure is stated underneath, which is the same pairing the
            design this follows makes ("Physical · book says 1,179 t") with the
            two halves the other way round, because ours is the half we hold. */}
        <Stat
          n="—"
          label="Cane on the ground"
          sub={`No physical count · book moved ${signed(totals.bookMoveKg)}`}
          title="The heap standing in the yards. Nothing in the weighbridge feed counts it — a scale weighs lorries, and the yard tally is a walk round with a clipboard that reaches us nowhere. The figure underneath is what the day's weighings MOVED at the outstations: cane in off the fields less cane sent to the mill, which is a movement and not a level."
        />

        {/* 2 · BOOK VS PHYSICAL GAP.
            A gap is one figure against another, and the other one does not
            exist. This cell cannot be computed at all rather than computed
            badly — which is why it says what it is waiting for. */}
        <Stat
          n="—"
          label="Book vs physical gap"
          sub="Needs a physical count"
          title="What the book says against what is actually on the ground. It needs both, and the physical count is not in this feed — so there is nothing here to reconcile against yet."
        />

        {/* 3 · RECEIVED TODAY — measured. */}
        <Stat
          n={fmt(totals.receivedKg / 1000, 0)} unit="t" tone="in"
          label={spanDays > 1 ? "Received in span" : "Received today"}
          sub={`${totals.receivedTrips} field trip${totals.receivedTrips === 1 ? "" : "s"}`}
          title="Cane weighed in off the fields across every bridge: a machine that weighed empty here and came back loaded. Counted at the moment it came back, not when its ticket was raised."
        />

        {/* 4 · DISPATCHED TODAY — measured, with what one run carried. */}
        <Stat
          n={fmt(totals.dispatchedKg / 1000, 0)} unit="t" tone="out"
          label={spanDays > 1 ? "Dispatched in span" : "Dispatched today"}
          sub={`${totals.dispatchedRuns} truck${totals.dispatchedRuns === 1 ? "" : "s"}${
            totals.dispatchedRuns > 0 ? ` · ${t1(totals.dispatchedKg / totals.dispatchedRuns)} t avg` : ""}`}
          title="Transfers weighed loaded at an outstation and sent to the factory, with what the average run carried."
        />

        {/* 5 · EXPECTED FROM FIELDS.
            The one derived figure on the strip, and it is derived the way the
            design this follows derives its own: the machines that are OUT —
            weighed empty here and not back — priced at what a load has
            actually weighed today. The count and the average are both on the
            cell, so the arithmetic is visible rather than implied. There is no
            harvest or field-dispatch feed behind these bridges; this is what
            the tickets can say about what is still coming. */}
        <Stat
          n={expectedFields == null ? "—" : fmt(expectedFields / 1000, 0)}
          unit={expectedFields == null ? null : "t"}
          tone="est"
          label="Expected from fields"
          sub={expectedFields == null
            ? "No load weighed yet today"
            : `${totals.openTickets} machine${totals.openTickets === 1 ? "" : "s"} out · ${t1(zoneAvgLoadKg)} t each`}
          title="Machines that weighed empty at a bridge today and have not come back loaded, priced at what a load has actually weighed across the fleet today. It is a count multiplied by a measured average — the only estimate on this board — because no harvest or field-dispatch feed exists behind these bridges. The middle ticket sits about seven hours between its two weighings, so most of these are out at the farm rather than standing at a scale."
        />

        {/* 6 · ON THE ROAD TO MILL — measured, both halves. */}
        <Stat
          n={totals.onRoadRuns} tone="road"
          label="On the road to mill"
          sub={`${fmt(totals.onRoadKg / 1000, 0)} t in transit`}
          title="Loaded at a yard and not yet weighed at the factory. This is the only forward-looking tonnage on the board that rests on a weighing rather than on an estimate."
        />

        {/* 7 · LORRIES AT THE SCALES.
            The design this follows counts trucks standing ON SITE. A ticket
            cannot see a parked lorry — it records a weighing and nothing
            between two of them — so the cell counts the machines that crossed
            a scale today instead, which is the question it can answer. */}
        <Stat
          n={totals.lorries} tone="out"
          label="Lorries at the scales"
          sub={`${totals.bridgesReporting} of ${totals.bridges} bridge${totals.bridges === 1 ? "" : "s"} reporting`}
          title="Distinct lorries that crossed any scale on this fleet today, matched on the plate with its spacing removed so one machine typed two ways counts once. Not machines standing on site: a ticket records a weighing, never the time between two of them."
        />
      </div>

      <div className={"wbb-grid" + (fewSites ? " wbb-grid--few" : "")}>
        {/* ── Every bridge, its own card ───────────────────────────────── */}
        <div className={"wbb-sites" + (fewSites ? " wbb-sites--few" : "")}>
          {sites.map(s => (
            <SiteCard
              key={s.code}
              site={s}
              lastBucket={board.lastBucket}
              asOf={asOf}
              closed={closed}
              totals={totals}
              spanDays={spanDays}
              axis={axis}
              overdueRuns={overdueByCode.get(s.code) ?? 0}
            />
          ))}
          {/* One or two yards (Kabras, Nzoia since 2026-10-07): the card keeps
              its column and the panels fill the row in two stacks, road over
              live activity and overdue over cane flow (operator, 2026-10-07),
              rather than the card stretching across it. */}
          {fewSites && (
            <>
              <div className="wbb-stack">{roadPanel}{livePanel}</div>
              <div className="wbb-stack">{overduePanel}{flowPanel}</div>
            </>
          )}
        </div>

        {/* ── The rail ─────────────────────────────────────────────────── */}
        {!fewSites && (
          <aside className="wbb-rail">
            {flowPanel}
            {roadPanel}
            {overduePanel}
            {livePanel}
          </aside>
        )}
      </div>
    </div>
  );
}
