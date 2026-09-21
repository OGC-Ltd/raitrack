/* Hallmark · redesign (single-page, consistency-led) · component: data-grid
 * genre: modern-minimal · theme: in-project (sp4-* tokens, preserved)
 * fingerprint: adopted, not invented — the target WAS the Sensor Monitor's
 *   grid, so diversification is suspended and the axes are matched rather
 *   than differed: same gridbar, same table classes, same cell rhythm, same
 *   chip vocabulary, same footer.
 * removed: the bespoke `.wb-table` voice — stacked weight/stamp cells, a
 *   private badge, and alignment overrides that re-implemented rules the
 *   shared sheet already had.
 * pre-emit critique: P5 H5 E5 S5 R5 V3 (V low BY DESIGN — see fingerprint)
 * contrast: inherited from SensorPanel.css, unchanged
 * mobile: pass (34) — measured, no page-level horizontal scroll; the 14
 *   columns scroll inside `.sp4-table-scroll`
 */

// Weighbridges — what crossed Sukari's four scales, ticket by ticket.
//
// Built on the Sensor Monitor's furniture on purpose: the same KPI strip, the
// same filter bar, the same tab strip with a count in each, the same table and
// the same row→detail move (see SensorPanel.css, whose `sp4-` classes this
// reuses rather than restyles). An operator who has learned one of these two
// screens has learned both, and a second visual language for the same shape of
// question would be a second thing to learn for nothing.
//
// What differs is what the tabs MEAN. On Sensor Monitor a tab is a kind of
// fault; here it is a PLACE — Factory, Opapo, Oyani, Nyaondo — because a
// weighbridge question is always asked about a bridge.
//
// ## The one thing to know before reading the numbers
//
// A row is a TICKET (a token), not a crossing of the scale. Every ticket
// carries at least two weighings — the lorry crosses empty and loaded — and a
// cane TRANSFER carries four, because it is weighed at the outstation and
// again at the factory. So "731 weighments today" means 731 tickets, which is
// how the bridges themselves count, and it is the only count under which "how
// many did this lorry do" has an answer.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useWeighments } from "../../hooks/useWeighments";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { tonnes, kilos, gapLabel, clockLabel, stampLabel } from "../../api/weighments";
import { WeighbridgeIcon } from "../footer/NavIcons";
import TableToolbar from "../body/TableToolbar";
import WeighbridgeBoard from "../body/WeighbridgeBoard";
import { downloadTableCsv, downloadTablePdf } from "../../utils/tableExport";
import "../body/SensorPanel.css";
/* For its TOKENS, not for its layout: the `an-*` chart palette the board draws
   in is declared on `.analytics-page` rather than on :root. Importing the
   sheet here does not restyle this screen — every rule in it is scoped under
   that class, which only the analytics view's own wrapper carries. */
import "./AnalyticsScreen.css";
import "./WeighbridgesScreen.css";

/**
 * The spans the filter bar offers as one click.
 *
 * Deliberately short. The provider serves a rolling two days and cannot be
 * backfilled, so anything past a week is mostly days we hold nothing for —
 * these three are the ones that return tickets today, and the two date inputs
 * beside them reach everything else.
 */
const SPANS = [
  { label: "Today",     range: () => [fleetDayKey(), fleetDayKey()] },
  { label: "Yesterday", range: () => { const d = backDays(1); return [d, d]; } },
  { label: "Last 7d",   range: () => [backDays(6), fleetDayKey()] },
];

/** The fleet day N days before today. */
function backDays(n) {
  return fleetDayKey(new Date(Date.now() - n * 86_400_000));
}

/** The bridge the page opens on. The factory takes about three quarters of the
 *  traffic (570 of 729 tickets on 2026-09-09), so it is the tab most readers
 *  wanted anyway — and an empty first tab reads as a broken page. */
const DEFAULT_CENTRE = 101;

/**
 * The two ways to read the same bridges.
 *
 * TICKETS is the ledger — one row per token, on one day, which is what a
 * dispute or a query about a particular lorry is settled from. ANALYTICS is
 * the shape over a window — tonnes, tickets, lorries and the wait per day,
 * ranked by bridge.
 *
 * They are one screen rather than two tabs on the footer nav because they are
 * the same subject read at two distances, and an operator who has found the
 * grid should not have to know that the trend for it lives on another page.
 * The crumb is the move between them.
 */
const VIEWS = [
  { key: "tickets",   label: "Tickets",   hint: "One row per token on a single day" },
  { key: "analytics", label: "Analytics", hint: "The day across every bridge: flow, road and activity" },
];


/**
 * What the picker may reach.
 *
 * `max` is today in every case — there is nothing in the future and an empty
 * grid there reads as a fault rather than as tomorrow.
 *
 * `min` is the earliest day we hold a ticket for, so the calendar does not
 * offer a month of days that were never recorded. But ONLY once we know it:
 * it used to fall back to *today* while the first response was still in
 * flight, and for any organisation with no tickets at all — which set
 * `min === max` and disabled every date on the calendar except one. The day
 * you actually wanted was greyed out, on a control whose whole job is to
 * reach it. An unknown floor is now no floor: `undefined` leaves the calendar
 * open, which is the harmless direction to be wrong in.
 */
function dayBounds(captured) {
  const today = fleetDayKey();
  return {
    min: captured?.first ? fleetDayKey(new Date(captured.first)) : undefined,
    max: today,
  };
}

/**
 * "today", or the date — because the strip below says one of them out loud.
 *
 * The three KPIs describe the day being VIEWED, not the calendar day, and
 * labelling them "today" while a reader has last Tuesday open would be a
 * caption contradicting its own number.
 */
function dayLabel(day) {
  if (day === fleetDayKey()) return "today";
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/**
 * The span being viewed, said the way somebody would say it: "today",
 * "08 Sep", "08 Sep – 14 Sep".
 *
 * One label for both cases rather than a ternary at each of the six places
 * that needs it — the strip, the export note, the filename and the board's
 * heading all have to agree about what they are describing, and the way they
 * stop agreeing is each deciding for itself.
 */
function spanLabel(from, to) {
  if (from === to) return dayLabel(from);
  return `${dayLabel(from)} \u2013 ${dayLabel(to)}`;
}

/**
 * Delivery or transfer. The provider states it — `category` on the payload —
 * so this is a label, not a deduction.
 *
 * `sp4-kind-chip` rather than a chip of its own: the Malfunction tab already
 * carries a neutral KIND chip in this exact slot, and neither of these two
 * values is good or bad news, so the status pills (`sp4-pill--con/warn`) would
 * be colouring a distinction that carries no verdict. A transfer takes the
 * one modifier the chip has, because it is the rarer flow and the one whose
 * row hides a second pair of weighings.
 */
function TypeChip({ category }) {
  const transfer = category === "CANE_TRANSFER";
  return (
    <span className={"sp4-kind-chip" + (transfer ? " sp4-kind-chip--silent" : "")}>
      {transfer ? "Transfer" : "Delivery"}
    </span>
  );
}

// ── the breakdown behind one ticket ────────────────────────────────────────

/** One weighing, spelled out: what the scale read, when, which scale, who was
 *  on it. This is the row a dispute is settled from. */
function Leg({ label, kg, at, day, bridgeNo, operator, muted }) {
  return (
    <div className={"wb-leg" + (muted ? " wb-leg--muted" : "")}>
      <div className="wb-leg__label">{label}</div>
      <div className="wb-leg__kg">{kilos(kg)}</div>
      <dl className="wb-leg__meta">
        <div><dt>Captured</dt><dd>{at ? `${stampLabel(at, day)}` : "—"}</dd></div>
        <div><dt>Bridge</dt><dd>{bridgeNo != null ? `#${bridgeNo}` : "—"}</dd></div>
        <div><dt>Operator</dt><dd>{operator || "—"}</dd></div>
      </dl>
    </div>
  );
}

function WeighmentDetail({ row, day, onClose }) {
  const transfer = row.category === "CANE_TRANSFER";
  // Centre against factory. Weighing the same load twice is the entire reason
  // a transfer exists as its own flow, so the difference between the two nets
  // is the number the reader came for — not a rounding artefact to hide.
  const drift = transfer && row.netWeightKg != null && row.factoryNetWeightKg != null
    ? row.factoryNetWeightKg - row.netWeightKg
    : null;

  return (
    <div className="sp4-detail wb-detail">
      <div className="sp4-detail-head">
        <button type="button" className="sp4-back-btn" onClick={onClose}>← Back</button>
        {/* Classed so the stylesheet can stop this box competing with the Back
            button for the row. It was a bare <div>, which means min-width:auto,
            which means a long driver name won the argument. */}
        <div className="sp4-detail-titles">
          <div className="sp4-detail-reg">
            {row.vehicleNo} <TypeChip category={row.category} />
          </div>
          <div className="sp4-detail-sub">
            Token {row.token} · {row.centerName} · {row.driverName}
          </div>
        </div>
      </div>

      <div className="wb-detail__strip">
        <div className="wb-stat">
          <span className="wb-stat__n">{kilos(row.netWeightKg)}</span>
          <span className="wb-stat__l">Net{transfer ? " at centre" : ""}</span>
        </div>
        <div className="wb-stat">
          <span className="wb-stat__n">{tonnes(row.netWeightKg)}</span>
          <span className="wb-stat__l">Payload</span>
        </div>
        <div className="wb-stat">
          <span className="wb-stat__n">{gapLabel(row.turnaroundMs)}</span>
          <span className="wb-stat__l">Tare → gross</span>
        </div>
        <div className="wb-stat">
          <span className="wb-stat__n">{row.seq} of {row.vehicleTickets}</span>
          <span className="wb-stat__l">This lorry today</span>
        </div>
        <div className="wb-stat">
          <span className="wb-stat__n">{gapLabel(row.sincePreviousMs)}</span>
          {/* Null on a first ticket, and it says so rather than "0m": there is
              no earlier weighment to measure from. */}
          <span className="wb-stat__l">{row.seq === 1 ? "First today" : "Since previous"}</span>
        </div>
      </div>

      <div className="wb-legs">
        <div className="wb-legs__group">
          <h4 className="wb-legs__title">{transfer ? "At the centre" : "At the bridge"}</h4>
          <Leg label="Tare (empty)"  kg={row.tareWeightKg}  at={row.tareAt}  day={day} bridgeNo={row.tareBridgeNo}  operator={row.tareOperator} />
          <Leg label="Gross (laden)" kg={row.grossWeightKg} at={row.grossAt} day={day} bridgeNo={row.grossBridgeNo} operator={row.grossOperator} />
        </div>

        {transfer && (
          <div className="wb-legs__group">
            <h4 className="wb-legs__title">At the factory</h4>
            <Leg label="Gross (laden)" kg={row.factoryGrossWeightKg} at={row.factoryGrossAt} day={day} bridgeNo={row.factoryGrossBridgeNo} operator={row.factoryGrossOperator} />
            <Leg label="Tare (empty)"  kg={row.factoryTareWeightKg}  at={row.factoryTareAt}  day={day} bridgeNo={row.factoryTareBridgeNo}  operator={row.factoryTareOperator} />
            <div className="wb-drift">
              <span>Factory net</span>
              <strong>{kilos(row.factoryNetWeightKg)}</strong>
              {drift != null && (
                <em className={drift < 0 ? "wb-drift--down" : "wb-drift--up"}>
                  {drift >= 0 ? "+" : "−"}{kilos(Math.abs(drift))} against the centre
                </em>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="sp4-detail-footer">
        Ticket raised {stampLabel(row.tokenAt, day)}
        {row.productName ? ` · ${row.productName}` : ""}
        {/* Said plainly rather than left as a blank: most of this traffic is
            contractors' lorries and farmers' tractors, which carry no tracker
            and appear in no fleet we hold. */}
        {row.vehicleId ? " · tracked unit" : " · not a tracked unit"}
      </div>
    </div>
  );
}

/**
 * The export's columns, and the rows under them.
 *
 * Written out rather than derived from the grid's JSX, because the two answer
 * different questions: the grid abbreviates for the eye ("3 of 4"), the file
 * is read in a spreadsheet where a planner sorts and totals it, so the same
 * fact goes in as two plain numbers. Same rows, same order, same filters — an
 * export that quietly widened to the whole day would be a document nobody
 * could reconcile with the screen it came from.
 */
const EXPORT_HEAD = [
  "Time", "Vehicle", "Driver", "Type", "Token", "Centre",
  "Tare (kg)", "Tare at", "Gross (kg)", "Gross at", "Net (kg)", "Payload (t)",
  "Load time", "Ticket no. today", "Tickets today", "Since previous",
];

const exportBody = (rows) => rows.map(r => [
  clockLabel(r.tokenAt),
  r.vehicleNo,
  r.driverName,
  r.category === "CANE_TRANSFER" ? "Transfer" : "Delivery",
  r.token,
  r.centerName,
  r.tareWeightKg  ?? "",
  stampLabel(r.tareAt, null),
  r.grossWeightKg ?? "",
  stampLabel(r.grossAt, null),
  r.netWeightKg   ?? "",
  r.netWeightKg == null ? "" : (r.netWeightKg / 1000).toFixed(2),
  gapLabel(r.turnaroundMs),
  r.seq,
  r.vehicleTickets,
  r.seq === 1 ? "first" : gapLabel(r.sincePreviousMs),
]);

// ── the screen ─────────────────────────────────────────────────────────────

export default function WeighbridgesScreen() {
  const { orgId } = useFleetLiveShared();
  const [view,     setView]     = useState(VIEWS[0].key);
  /* The range, both ends inclusive. They start equal, which is one day — the
     reading this screen opens on and the one most visits never leave. */
  const [from,     setFrom]     = useState(fleetDayKey());
  const [to,       setTo]       = useState(fleetDayKey());
  const [centre,   setCentre]   = useState(DEFAULT_CENTRE);
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState(null);

  /* The grid reads ONE bridge; the board reads them all.
   *
   * Same endpoint and same day — the centre and the search are applied
   * server-side, so asking for the analytics view is asking for the
   * unnarrowed day. That is what the board needs and could not be faked from
   * the grid's rows: a board built from Opapo's tickets alone would report the
   * mill as having received nothing all day.
   *
   * It is one request either way (787 tickets on the busiest day measured), so
   * this is a re-read on a view change rather than a second live feed. */
  const { data, loading, error, reload, clamped } = useWeighments({
    orgId,
    from,
    to,
    centre: view === "analytics" ? null : centre,
    search: view === "analytics" ? "" : search,
  });

  // Memoised because the breakdown's re-lookup below depends on it, and a
  // fresh [] on every render would re-run that on every render.
  const rows    = useMemo(() => data?.rows ?? [], [data]);
  // Same reason, one step further: the board derives a whole day from these
  // two, and a new array identity on every render would rebuild it on every
  // render — including the elapsed times, which would then jump about.
  const centres = useMemo(() => data?.centres ?? [], [data]);
  const stats   = data?.stats;
  const bounds  = dayBounds(data?.captured);
  // The most recent day we actually hold tickets for. Taken off the same
  // `captured` span the picker is bounded by, so the offer below can never
  // point at a day the picker would refuse.
  // The tab exists for every company; the bridges belong to one. No captured
  // span means this organisation has never held a ticket — a different thing
  // from a quiet day, and the only one of the two the reader can act on.
  const noBridges = Boolean(data) && !data.captured;

  // Close the breakdown when the set behind it changes. Leaving it open across
  // a day or centre change left a ticket on screen that the grid behind it no
  // longer contained.
  useEffect(() => { setSelected(null); }, [from, to, centre, search, view]);

  const openRow = useCallback((row) => setSelected(row), []);
  const selectedRow = useMemo(
    () => (selected ? rows.find(r => r.id === selected.id) ?? selected : null),
    [selected, rows],
  );

  const centreName = centres.find(c => c.code === centre)?.name ?? "";

  // What a downloaded file is a set OF. An export with no filter control on it
  // has to say so out loud — the same rule the probes tab's note follows.
  const exportNote = [
    spanLabel(from, to),
    centreName || null,
    search ? `matching “${search}”` : null,
  ].filter(Boolean).join(" · ");
  const filenameSlug = ["weighbridge", from, from === to ? "" : to, (centreName || "all").toLowerCase()]
    .join("-").replace(/[^a-z0-9-]/gi, "");
  // Weighed in the rows ON SCREEN — not the day's total, which the strip above
  // already states. The bar describes what it would export.
  const shownNetKg = rows.reduce((sum, r) => sum + (r.netWeightKg ?? 0), 0);

  return (
    <div className="sp4-root wb-root">
      {/* --- Breadcrumb ------------------------------------------------
          Where you are, and the one place you can go from here.

          Maintenance's crumb is the model - same band, same separator, same
          size - with the one difference that screen explicitly did not need:
          there, both crumbs named things with nowhere to click, so they are
          plain text. Here the trailing crumb is a real choice between two
          readings of the same bridges, so each is a button and the open one is
          MARKED rather than merely coloured.

          Buttons rather than links: this is a view switch inside one screen,
          not a route, and an anchor with no href is a thing a keyboard cannot
          reach. `aria-current="page"` is what tells a screen reader which of
          the two is open. */}
      <nav className="wb-crumbs" aria-label="Breadcrumb">
        <ol className="wb-crumbs__list">
          <li className="wb-crumbs__item">
            <WeighbridgeIcon size={13} />
            <span>Weighbridges</span>
          </li>
          <li className="wb-crumbs__item wb-crumbs__item--views">
            {VIEWS.map(v => (
              <button
                key={v.key}
                type="button"
                title={v.hint}
                className={"wb-crumb" + (view === v.key ? " wb-crumb--on" : "")}
                aria-current={view === v.key ? "page" : undefined}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </li>
        </ol>
      </nav>

      {/* The rule under the crumb.
          An <hr> rather than a border on the band above it: it is a break
          between the navigation and the screen's contents, which is what the
          element means, and a screen reader announces it as one. It also sits
          a shade stronger than the hairlines inside the panel below, so the
          two crumbs read as chrome and everything under it as the page. */}
      <hr className="wb-rule" />

      {/* --- Header ----------------------------------------------------
          The day's three numbers, and they hold for both views because both
          are about the same day: the grid reads one bridge of it, the board
          reads every bridge at once. All three are computed across EVERY
          bridge before the centre filter narrows the grid, so switching bridge
          tabs never moves them. */}
      <div className="sp4-header">
        <div className="sp4-header-kpis">
          <div
            className="sp4-kpi sp4-kpi--fleet"
            title="Tickets raised across all four bridges on the day being viewed. A ticket is one token — the lorry crossing empty and laden — not one trip over a scale."
          >
            <span className="sp4-kpi-n">{stats ? stats.weighments : "·"}</span>
            <span className="sp4-kpi-l">Weighments {spanLabel(from, to)}</span>
          </div>
          {/* <div
            className="sp4-kpi sp4-kpi--live"
            title="Distinct lorries that weighed anywhere on this day, matched on the plate with its spacing removed so one machine typed two ways counts once."
          >
            <span className="sp4-kpi-n">{stats ? stats.uniqueVehicles : "·"}</span>
            <span className="sp4-kpi-l">Unique vehicles</span>
          </div> */}
          <div
            className="sp4-kpi sp4-kpi--stat"
            title={
              stats?.heaviest
                ? `Token ${stats.heaviest.token} — ${stats.heaviest.vehicleNo} at ${stats.heaviest.centerName}. Total weighed in today: ${tonnes(stats.totalNetKg)}.`
                : "The largest net load recorded on any bridge on this day."
            }
          >
            <span className="sp4-kpi-n">{stats ? tonnes(stats.heaviestNetKg) : "·"}</span>
            <span className="sp4-kpi-l">Heaviest load</span>
          </div>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────── */}
      <div className="sp4-filterbar">
        {view === "tickets" && (
        <div className="sp4-search-wrap">
          <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="sp4-search"
            type="text"
            placeholder="Search token, vehicle or driver…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="sp4-search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        )}
        {view === "tickets" && <div className="sp4-filter-divider" />}

        <div className="sp4-filter-group">
          {/* Two ends, both inclusive.
              A native range picker does not exist — <input type="date"> is one
              day, and every "range picker" is a component somebody wrote. Two
              date inputs ARE the range control here: they are the same native
              widget an operator already uses on this screen, they are
              keyboard-reachable and typeable, and on a phone they open the
              platform's own calendar. What they need instead of cleverness is
              for neither end to be settable past the other, which is what the
              bounds below do — you cannot drag the start past the finish and
              end up looking at nothing. */}
          {/* Each end is label + field in ONE box. See the .wb-range-leg rule
              in the stylesheet: `display: contents` above 768px, so the bar is
              element-for-element what it was on a desktop, and a real box
              below it, so a wrap can never put "to" at the end of one line and
              the field it names at the start of the next. */}
          <span className="wb-range-leg">
          <span className="sp4-filter-label">From</span>
          <input
            type="date"
            className="sp4-date-input"
            value={from}
            /* Bounded at both ends. No future days, because there is nothing
               there and an empty grid reads as a fault rather than as
               tomorrow; nothing before the first ticket we ever captured,
               because the provider keeps about two days and everything earlier
               is outside the record rather than quiet; and never past the
               other end of the range. */
            min={bounds.min}
            max={to || bounds.max}
            onChange={e => {
              const v = e.target.value || fleetDayKey();
              setFrom(v);
              // Dragging the start past the finish is a reader moving the
              // whole window, not asking for an empty one.
              if (v > to) setTo(v);
            }}
          />
          </span>
          <span className="wb-range-leg">
          <span className="sp4-filter-label">to</span>
          <input
            type="date"
            className="sp4-date-input"
            value={to}
            min={from || bounds.min}
            max={bounds.max}
            onChange={e => {
              const v = e.target.value || fleetDayKey();
              setTo(v);
              if (v < from) setFrom(v);
            }}
          />
          </span>

          {/* The three spans anybody actually asks for, so the common case is
              one click rather than two calendars. "Today" is also the way back
              from a range, which two date inputs on their own do not offer. */}
          {SPANS.map(sp => {
            const [a, b] = sp.range();
            const on = from === a && to === b;
            return (
              <button
                key={sp.label}
                type="button"
                className={"sp4-filter-chip" + (on ? " sp4-filter-chip--on" : "")}
                aria-pressed={on}
                onClick={() => { setFrom(a); setTo(b); }}
              >{sp.label}</button>
            );
          })}

          {/* What a long range actually fetched. The hook caps the number of
              days it will ask for, and a strip of figures under a heading
              naming a span it does not cover is the worst way for this screen
              to be wrong. */}
          {clamped && (
            <span className="wb-clamp" role="status">
              Showing the last {clamped.shown} of {clamped.asked} days
            </span>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="sp4-body">
        {view === "analytics" ? (
          /* `.analytics-page` on the wrapper is not decoration: the `an-*`
             colour tokens the board draws its marks from are declared on that
             class rather than on :root, so without it the chart renders in
             unresolved variables. */
          <div className="analytics-page wb-analytics">
            {noBridges ? (
              <div className="sp4-state">
                <div className="sp4-state-title">No weighbridges on this fleet</div>
                <p className="sp4-state-body">
                  This company has no weighbridge records at all. Weighbridges report from one
                  fleet only - switch company to see them.
                </p>
              </div>
            ) : error ? (
              <div className="sp4-state" role="alert">
                <div className="sp4-state-title">Weighbridge tickets unavailable</div>
                <p className="sp4-state-body">{error}</p>
                <button type="button" className="sp4-state-btn" onClick={reload}>Try again</button>
              </div>
            ) : (
              <>
                <WeighbridgeBoard rows={rows} from={from} to={to} centres={centres} loading={loading} />
              </>
            )}
          </div>
        ) : selectedRow ? (
          <WeighmentDetail row={selectedRow} day={from === to ? from : null} onClose={() => setSelected(null)} />
        ) : (
          <>
            <div className="sp4-tabs">
              {centres.map(c => (
                <button
                  key={c.code}
                  className={"sp4-tab" + (centre === c.code ? " sp4-tab--on" : "")}
                  onClick={() => setCentre(c.code)}
                >
                  {c.name}
                  <span className="sp4-tab-n">{c.count}</span>
                </button>
              ))}
              {centres.length === 0 && (loading || !data) && (
                // Before the first response there is nothing to draw tabs
                // from, and inventing four from a hardcoded list would show
                // bridges we have not confirmed exist on this day.
                //
                // Gated on `loading` as well as on emptiness: a company with
                // no bridges also has no tabs, and it sat under "Loading
                // bridges…" for ever — a spinner for something that is never
                // going to arrive. That case is now the state block below.
                <span className="sp4-tabs-hint">Loading bridges…</span>
              )}
              <div className="sp4-tabs-hint">
                Click any ticket for its weighings — each weight with the moment it was captured.
              </div>
            </div>

            {error ? (
              <div className="sp4-state" role="alert">
                <div className="sp4-state-title">Weighbridge tickets unavailable</div>
                <p className="sp4-state-body">{error}</p>
                <button type="button" className="sp4-state-btn" onClick={reload}>Try again</button>
              </div>
            ) : loading && !data ? (
              <div className="sp4-loading">
                <div className="sp4-spinner" />
                Reading the day’s tickets…
              </div>
            ) : rows.length === 0 ? (
              <div className="sp4-state">
                {/* Three different silences, and they are not the same news:
                    a search that matched nothing, a bridge that was quiet, and
                    a feed that has never delivered anything at all. */}
                <div className="sp4-state-title">
                  {search
                    ? "No ticket matches"
                    : noBridges
                      ? "No weighbridges on this fleet"
                      : data?.total
                        ? `Nothing weighed at ${centreName || "this bridge"}`
                        : "No tickets in this span"}
                </div>
                <p className="sp4-state-body">
                  {search
                    ? `Nothing on this day matches “${search}”. Tokens, plates and driver names are all searched.`
                    : noBridges
                      /* Not "no tickets today" — this company has never had a
                         ticket, and saying it plainly is the difference between
                         "your bridges stopped reporting" and "your fleet does
                         not have bridges". Switch company to reach one that
                         does. */
                      ? "This company has no weighbridge records at all. Weighbridges report from one fleet only — switch company to see them."
                      : data?.total
                        ? `${data.total} ticket${data.total === 1 ? "" : "s"} were raised elsewhere — try another bridge.`
                        : "Nothing was captured for these days. The provider serves about two days of tickets, so days before we began recording are outside the record rather than quiet."}
                </p>
                {!search && !data?.total && !noBridges && (
                  <p className="sp4-state-body">
                    <WeighbridgeIcon size={20} /> Factory · Opapo · Oyani · Nyaondo
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* The panel's own export bar, the same one Probes, Fuel FSL,
                    Speed and Malfunction wear — same three buttons, same
                    order, same wording. A fifth tab with its own affordance
                    for getting data out is how the five drift apart. */}
                <TableToolbar
                  summary={
                    <>
                      <b>{data.matched}</b> ticket{data.matched === 1 ? "" : "s"} ·{" "}
                      {tonnes(shownNetKg)} weighed
                    </>
                  }
                  note={exportNote}
                  loading={loading}
                  onReload={reload}
                  onCsv={() => downloadTableCsv({ head: [EXPORT_HEAD], body: exportBody(rows), filenameSlug })}
                  onPdf={() => downloadTablePdf({
                    reportTitle:  "Weighbridges",
                    sectionTitle: `${centreName || "All bridges"} — ${spanLabel(from, to)}`,
                    filterNote:   exportNote,
                    head: [EXPORT_HEAD], body: exportBody(rows), filenameSlug,
                  })}
                  disabled={!rows.length}
                />

                <div className="sp4-table-scroll">
                  {/* `sp4-probe-table` is not decoration — the panel's cell
                      padding, alignment and density rules are scoped to it, so
                      claiming the class is what makes this grid sit at the
                      same rhythm as the one two tabs over. `--comfortable` is
                      the density Probes ships at. */}
                  <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
                    <thead>
                      <tr>
                        <th className="sp4-th--left">Time</th>
                        <th className="sp4-th--left">Vehicle</th>
                        <th className="sp4-th--left">Driver</th>
                        <th className="sp4-th--left">Type</th>
                        <th className="sp4-th--left">Token</th>
                        {/* Tare before gross: that is the order 715 of 729
                            tickets were actually weighed in — empty first,
                            loaded later — so the row reads as the lorry's
                            morning rather than as a form. */}
                        <th className="sp4-th--right">Tare</th>
                        <th className="sp4-th--right">Tare at</th>
                        <th className="sp4-th--right">Gross</th>
                        <th className="sp4-th--right">Gross at</th>
                        <th className="sp4-th--right">Net</th>
                        <th className="sp4-th--right">Payload</th>
                        <th className="sp4-th--right">Load time</th>
                        <th className="sp4-th--right">Ticket</th>
                        <th className="sp4-th--right">Since previous</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr
                          key={r.id}
                          className="sp4-tr"
                          onClick={() => openRow(r)}
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(r); } }}
                        >
                          <td className="sp4-td--left wb-mono">
                            {from === to ? clockLabel(r.tokenAt) : stampLabel(r.tokenAt, null)}
                          </td>
                          <td className="sp4-td--left"><span className="sp4-reg">{r.vehicleNo}</span></td>
                          <td className="sp4-td--left wb-td-driver">{r.driverName}</td>
                          <td className="sp4-td--left"><TypeChip category={r.category} /></td>
                          <td className="sp4-td--left wb-mono sp4-muted">{r.token}</td>
                          <td className="sp4-td--right sp4-num">{kilos(r.tareWeightKg)}</td>
                          {/* One fact per cell, like every other grid on this
                              screen. The weight and the moment it was captured
                              used to share a cell in two stacked lines, which
                              is a shape nothing else here uses — and the stamp
                              is a column somebody sorts by eye, not a footnote
                              to the number above it. */}
                          <td className="sp4-td--right wb-mono">{stampLabel(r.tareAt, from === to ? from : null)}</td>
                          <td className="sp4-td--right sp4-num">{kilos(r.grossWeightKg)}</td>
                          <td className="sp4-td--right wb-mono">{stampLabel(r.grossAt, from === to ? from : null)}</td>
                          <td className="sp4-td--right sp4-num wb-td-net">{kilos(r.netWeightKg)}</td>
                          <td className="sp4-td--right sp4-num">{tonnes(r.netWeightKg)}</td>
                          <td className="sp4-td--right sp4-num">{gapLabel(r.turnaroundMs)}</td>
                          {/* "3 of 4" rather than "3": the position is only
                              meaningful against the lorry's whole day, and that
                              day may run across other bridges than this tab. */}
                          <td className="sp4-td--right sp4-num">{r.seq} of {r.vehicleTickets}</td>
                          <td className="sp4-td--right sp4-num">
                            {r.seq === 1
                              ? <span className="sp4-muted">first</span>
                              : gapLabel(r.sincePreviousMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sp4-grid-footer">
                  {data.matched} of {data.total} ticket{data.total === 1 ? "" : "s"} in {spanLabel(from, to)}
                  {centreName ? ` · ${centreName}` : ""}
                  {loading && <span className="sp4-muted"> · refreshing…</span>}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
