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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useWeighments, MAX_DAYS } from "../../hooks/useWeighments";
import WeighbridgeTotals from "../body/WeighbridgeTotals";
import { useDispatchedUnits } from "../../hooks/useDispatchedUnits";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { tonnes, kilos, gapLabel, clockLabel, stampLabel } from "../../api/weighments";
import { WeighbridgeIcon } from "../footer/NavIcons";
import WeighbridgeBoard from "../body/WeighbridgeBoard";
import WeighbridgeCoverage from "../body/WeighbridgeCoverage";
import EmptyNote from "../shared/EmptyNote";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { useAppActions } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import { downloadTableCsv } from "../../utils/tableExport";
import { ticketsByBridge } from "../../lib/weighbridgeSheets";
// The PDF, JPEG and Preview the Movements tabs make, drawn by the server (operator, 18 Nov 2026)
import ReportFilesBar from "../body/ReportFilesBar";
import { ticketsDoc, spanWords } from "../../lib/weighbridgeDocs";
import { useLetterheadFleet } from "../../hooks/useLetterheadFleet";
import "../body/SensorPanel.css";
/* For its TOKENS, not for its layout: the `an-*` chart palette the board draws
   in is declared on `.analytics-page` rather than on :root. Importing the
   sheet here does not restyle this screen — every rule in it is scoped under
   that class, which only the analytics view's own wrapper carries. */
import "./AnalyticsScreen.css";
import "./WeighbridgesScreen.css";

/**
 * The spans the filter bar offers as one click, as buttons beside the date
 * field (operator, 2026-10-08: outside the calendar, not inside it).
 *
 * Deliberately short. The provider serves a rolling two days and cannot be
 * backfilled, so anything past a week is mostly days we hold nothing for —
 * these three are the ones that return tickets today, and the calendar beside
 * them reaches everything else.
 */
const SPANS = [
  { label: "Today",       range: () => [fleetDayKey(), fleetDayKey()] },
  { label: "Yesterday",   range: () => { const d = backDays(1); return [d, d]; } },
  { label: "Last 7 days", range: () => [backDays(6), fleetDayKey()] },
  // A month at a time (operator, 17 Nov 2026: "the whole month or even longer")
  { label: "This month",  range: () => { const t = fleetDayKey(); return [`${t.slice(0, 8)}01`, t]; } },
  { label: "Last month",  range: () => monthBefore(fleetDayKey()) },
];

/** The calendar month before the one `day` is in: its first and last day. */
function monthBefore(day) {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

/**
 * A date with its calendar (operator, 17 Nov 2026: "on the date part it has
 * no date picker"). Some browsers draw no calendar in a narrow date field, so
 * the field carries its own button, and a click anywhere on the field opens
 * the calendar too; typing a date still works.
 */
function DateField({ label, value, min, max, onChange }) {
  const input = useRef(null);
  const open = () => { try { input.current?.showPicker?.(); } catch { /* not from this gesture: typing still works */ } };
  return (
    <label className="wb-date">
      <span>{label}</span>
      <span className="wb-date__field">
        <input ref={input} type="date" value={value} min={min} max={max}
               onClick={open}
               onChange={(e) => { if (e.target.value) onChange(e.target.value); }} />
        <button type="button" className="wb-date__pick" onClick={open} aria-label={`Pick the ${label.toLowerCase()} date`} tabIndex={-1}>
          <i className="ti ti-calendar" aria-hidden="true" />
        </button>
      </span>
    </label>
  );
}

/** The fleet day N days before today. */
function backDays(n) {
  return fleetDayKey(new Date(Date.now() - n * 86_400_000));
}

/** The bridge the page opens on: all of them (operator, 2026-11-25: "All
 *  weighbridges should be the default"). It used to open on the factory (101). */
const DEFAULT_CENTRE = null;

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
        <div><dt>Captured</dt><dd>{at ? `${stampLabel(at, day)}` : "-"}</dd></div>
        <div><dt>Bridge</dt><dd>{bridgeNo != null ? `#${bridgeNo}` : "-"}</dd></div>
        <div><dt>Operator</dt><dd>{operator || "-"}</dd></div>
      </dl>
    </div>
  );
}

/**
 * The open ticket, in the app's detail sidebar (shared/DetailSidebar: the
 * Drivers page's panel, as on Alerts and Maintenance). Picking a row opens it
 * beside the grid; another row swaps the ticket in place; × or Esc closes it.
 * Everything in it is on the row already, so opening it costs no request.
 */
function WeighmentPanel({ row, day, onClose, onShowOnMap }) {
  const transfer = row.category === "CANE_TRANSFER";
  // Centre against factory. Weighing the same load twice is the entire reason
  // a transfer exists as its own flow, so the difference between the two nets
  // is the number the reader came for — not a rounding artefact to hide.
  const drift = transfer && row.netWeightKg != null && row.factoryNetWeightKg != null
    ? row.factoryNetWeightKg - row.netWeightKg
    : null;

  return (
    <DetailSidebar
      title="Weighbridge ticket"
      label={`Weighbridge ticket ${row.token}, ${row.vehicleNo}`}
      itemKey={row.id}
      onClose={onClose}
      footer={onShowOnMap ? (
        <button type="button" className="sp4-ghost-btn" onClick={onShowOnMap}>
          <i className="ti ti-map-pin" aria-hidden="true" /> View on Map
        </button>
      ) : null}
    >
      <DetailSidebarIdent
        kind={<TypeChip category={row.category} />}
        name={row.vehicleNo}
        sub={`Token ${row.token} · ${row.centerName} · ${row.driverName}`}
      />

      <DetailSidebarFacts facts={[
        { label: transfer ? "Net at centre" : "Net", value: kilos(row.netWeightKg) },
        { label: "Payload", value: tonnes(row.netWeightKg) },
        { label: "Tare → gross", value: gapLabel(row.turnaroundMs) },
        { label: "This lorry today", value: `${row.seq} of ${row.vehicleTickets}` },
        // Null on a first ticket, and it says so rather than "0m": there is
        // no earlier weighment to measure from.
        { label: row.seq === 1 ? "First today" : "Since previous", value: gapLabel(row.sincePreviousMs) },
      ]} />

      <DetailSidebarSection title={transfer ? "At the centre" : "At the bridge"}>
        <Leg label="Tare (empty)"  kg={row.tareWeightKg}  at={row.tareAt}  day={day} bridgeNo={row.tareBridgeNo}  operator={row.tareOperator} />
        <Leg label="Gross (laden)" kg={row.grossWeightKg} at={row.grossAt} day={day} bridgeNo={row.grossBridgeNo} operator={row.grossOperator} />
      </DetailSidebarSection>

      {transfer && (
        <DetailSidebarSection title="At the factory">
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
        </DetailSidebarSection>
      )}

      <DetailSidebarSection title="Ticket">
        <p className="wb-ticket-note">
          Raised {stampLabel(row.tokenAt, day)}
          {row.productName ? ` · ${row.productName}` : ""}
          {/* Said plainly rather than left as a blank: most of this traffic is
              contractors' lorries and farmers' tractors, which carry no tracker
              and appear in no fleet we hold. */}
          {row.vehicleId ? " · tracked unit" : " · not a tracked unit"}
        </p>
      </DetailSidebarSection>
    </DetailSidebar>
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
  "Date", "Time", "Vehicle", "Driver", "Type", "Token", "Centre",
  "Tare (kg)", "Tare at", "Gross (kg)", "Gross at", "Net (kg)", "Payload (t)",
  "Load time", "Ticket no. today", "Tickets today", "Since previous",
];

const exportDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "2-digit", year: "numeric" });
const exportBody = (rows) => rows.map(r => [
  r.tokenAt ? exportDay.format(new Date(r.tokenAt)) : "",
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


/** Tickets per page — the Drivers roster's step. */
const GRID_STEP = 15;

export default function WeighbridgesScreen() {
  const { orgId } = useFleetLiveShared();
  const [view,     setView]     = useState(VIEWS[0].key);
  /* The range, both ends inclusive. It opens on the previous day through today
     (operator, 2026-11-25: "the default from date is the previous date"). */
  const [from,     setFrom]     = useState(() => backDays(1));
  const [to,       setTo]       = useState(fleetDayKey());
  const [centre,   setCentre]   = useState(DEFAULT_CENTRE);
  const [search,   setSearch]   = useState("");
  /* Coverage: the Tickets view's tickets as each unit's trips and kilometres a day, by the
     Coverage button in its filter bar (operator, 18 Nov 2026: "a button for coverage that will
     replace the metrics"). It follows the weighbridge picked, and searches units on the page. */
  const [coverage, setCoverage] = useState(false);
  // Coverage folded to one row per unit over the whole span (operator, 18 Nov 2026)
  const [consolidate, setConsolidate] = useState(false);
  const [selected, setSelected] = useState(null);
  const { can } = usePermissions();
  const { setDesktopActiveTab, setPendingFocusId } = useAppActions();

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
  const fleet = useLetterheadFleet();
  const { data, loading, error, reload, clamped, progress } = useWeighments({
    orgId,
    from,
    to,
    centre: view === "tickets" ? centre : null,
    search: view === "tickets" && !coverage ? search : "",
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

  // Units FactorySuite dispatched and not yet signed back. Only while the board
  // is up and its span reaches today: a closed day has nothing "out".
  const dispatched = useDispatchedUnits(orgId, { enabled: view === "analytics" && to >= fleetDayKey() });

  // Close the breakdown when the set behind it changes. Leaving it open across
  // a day or centre change left a ticket on screen that the grid behind it no
  // longer contained.
  useEffect(() => { setSelected(null); }, [from, to, centre, search, view, coverage]);

  // Pages of fifteen, Prev / Next — the Drivers roster's pager and step, so
  // the two grids page alike (operator, 2026-10-03). Back to the first page
  // whenever the set behind the grid changes; clamped too, so a refresh that
  // returns fewer tickets can never leave the grid on a page past the end.
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [from, to, centre, search]);

  const openRow = useCallback((row) => setSelected(row), []);
  // The heaviest or lightest ticket, from the strip: its side panel opens
  // whichever bridge it was on. The panel lives in the Tickets view, so from
  // Analytics the view changes first, then the panel opens.
  const pendingTicket = useRef(null);
  const showTicket = useCallback((row) => {
    if (!row) return;
    if (view !== "tickets" || coverage) { pendingTicket.current = row; setCoverage(false); setView("tickets"); }
    else setSelected(row);
  }, [view, coverage]);
  useEffect(() => {
    if (view === "tickets" && !coverage && pendingTicket.current) { setSelected(pendingTicket.current); pendingTicket.current = null; }
  }, [view, coverage]);
  const closeRow = useCallback(() => setSelected(null), []);
  const selectedRow = useMemo(
    () => (selected ? rows.find(r => r.id === selected.id) ?? selected : null),
    [selected, rows],
  );

  const centreName = centres.find(c => c.code === centre)?.name ?? "";
  const pageCount = Math.max(1, Math.ceil(rows.length / GRID_STEP));
  const at        = Math.min(page, pageCount - 1);
  const pageRows  = rows.slice(at * GRID_STEP, at * GRID_STEP + GRID_STEP);

  // What a downloaded file is a set OF is said on it: the PDF's facts name the
  // days, the bridge and the search (lib/weighbridgeDocs ticketsDoc).
  const filenameSlug = ["weighbridge", from, from === to ? "" : to, (centreName || "all").toLowerCase()]
    .join("-").replace(/[^a-z0-9-]/gi, "");
  // Weighed in the rows ON SCREEN — not the day's total, which the strip above
  // already states. The bar describes what it would export.
  const shownNetKg = rows.reduce((sum, r) => sum + (r.netWeightKg ?? 0), 0);
  // All weighbridges: the Excel file's sheet 1 holds every ticket, then a sheet
  // for each weighbridge (operator, 17 Nov 2026). The CSV stays one table.
  const exportCsv = () => downloadTableCsv({
    head: EXPORT_HEAD, body: exportBody(rows), filenameSlug,
    ...(centre == null && {
      title: "Weighbridge Tickets",
      sheetName: "All weighbridges",
      meta: [["Weighbridges", "All"]],
      sheets: ticketsByBridge(rows, centres).map(g => ({
        name: g.name,
        title: `Weighbridge Tickets: ${g.name}`,
        body: exportBody(g.rows),
        meta: [["Weighbridge", g.name]],
      })),
    }),
  });

  return (
    <div className="sp4-root sp4-root--framed wb-root">
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
          <li data-tour="wb-views" className="wb-crumbs__item wb-crumbs__item--views">
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

      {/* --- Figures ----------------------------------------------------
          The day across every bridge, then a card per bridge that also picks
          the bridge the tickets show (operator, 3 Nov 2026: "fix the
          weighbridges ui"). The day's figures cover EVERY bridge whatever
          bridge is picked, so picking one never moves them; a search for a
          unit or a driver does narrow them (operator, 25 Nov 2026). */}
      <WeighbridgeTotals
        stats={stats}
        centres={centres}
        loading={loading || !data}
        periodLabel={spanLabel(from, to)}
        search={view === "tickets" && !coverage ? search : ""}
        showBridges={view === "tickets"}
        centre={centre}
        onPickCentre={setCentre}
        onOpenTicket={showTicket}
      />

      {/* ── Filter bar ─────────────────────────────────────── */}
      <div data-tour="wb-filters" className="sp4-filterbar">
        {view !== "analytics" && (
        <div className="sp4-search-wrap">
          <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="sp4-search"
            type="text"
            placeholder={coverage ? "Search unit…" : "Search token, vehicle or driver…"}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="sp4-search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        )}
        {view !== "analytics" && <div className="sp4-filter-divider" />}

        <div className="sp4-filter-group">
          {/* One field, one calendar (operator, 2026-10-08: "one date picker
              for single date selection to date ranges"), the same picker the
              unit panel uses. A click picks a day; a second click makes the
              range between the two, both ends inclusive. It cannot reach past
              today, nor before the first day we hold tickets for (the
              provider keeps about two days and everything earlier is outside
              the record rather than quiet), nor further than the span the
              hook will fetch. Today, Yesterday and Last 7 days are buttons
              beside it rather than inside the calendar, so the common spans
              stay one click away. */}
          {/* From and To as two plain dates (operator, 17 Nov 2026: "a custom
              picker that can take to and from ... the whole month or even
              longer"), up to MAX_DAYS. Not before the first day we hold
              tickets for, not after today. A To before the From moves the
              From with it, and the other way round. */}
          <DateField label="From" value={from} min={bounds.min ?? undefined} max={fleetDayKey()}
                     onChange={(f) => { setFrom(f); if (f > to) setTo(f); }} />
          <DateField label="To" value={to} min={bounds.min ?? undefined} max={fleetDayKey()}
                     onChange={(t) => { setTo(t); if (t < from) setFrom(t); }} />
          {/* One weighbridge, or all of them (operator, 17 Nov 2026: "download
              the report as per specific weighbridge"). The same choice as the
              bridge cards above; the table and every download follow it. */}
          {view === "tickets" && centres.length > 0 && (
            <label className="wb-date wb-bridge">
              <span>Weighbridge</span>
              <select value={centre ?? ""} onChange={(e) => setCentre(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">All weighbridges</option>
                {centres.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
          )}
          {view === "tickets" && (
            <button
              type="button"
              className={"sp4-filter-chip" + (coverage ? " sp4-filter-chip--on" : "")}
              aria-pressed={coverage}
              title="Each unit's trips and the kilometres its odometer counted, a day at a time"
              onClick={() => setCoverage((c) => !c)}
            >Coverage</button>
          )}
          {view === "tickets" && coverage && (
            <button
              type="button"
              className={"sp4-filter-chip" + (consolidate ? " sp4-filter-chip--on" : "")}
              aria-pressed={consolidate}
              title="One row per unit over the whole span, its days summed"
              onClick={() => setConsolidate((c) => !c)}
            >Consolidate</button>
          )}
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
              Showing the last {clamped.shown} of {clamped.asked} days: {MAX_DAYS} days at most
            </span>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="sp4-body">
        {view === "tickets" && !coverage && selectedRow && (
          <WeighmentPanel
            row={selectedRow}
            day={from === to ? from : null}
            onClose={closeRow}
            // Only a tracked unit is on the map: most lorries over these
            // bridges are contractors' and carry no tracker.
            onShowOnMap={selectedRow.vehicleId && can("map:read")
              ? () => { setDesktopActiveTab("fleet"); setPendingFocusId(selectedRow.vehicleId); }
              : null}
          />
        )}
        {view === "analytics" ? (
          /* `.analytics-page` on the wrapper is not decoration: the `an-*`
             colour tokens the board draws its marks from are declared on that
             class rather than on :root, so without it the chart renders in
             unresolved variables. */
          <div className="analytics-page wb-analytics">
            {noBridges ? (
              <EmptyNote icon="ti-scale" title="No Weighbridges on This Fleet">
                This company has no weighbridge records. Weighbridges report from one fleet
                only, so switch company to see them.
              </EmptyNote>
            ) : error ? (
              <EmptyNote icon="ti-cloud-off" tone="error" title="Weighbridge Tickets Unavailable"
                         action={{ label: "Try again", onClick: reload }}>
                {error}
              </EmptyNote>
            ) : (
              <>
                <WeighbridgeBoard rows={rows} from={from} to={to} centres={centres} loading={loading} dispatched={dispatched}
                                  files={{ orgId, fleet, span: spanWords(from, to), onReload: reload }} />
              </>
            )}
          </div>
        ) : coverage ? (
          noBridges ? (
            <EmptyNote icon="ti-scale" title="No Weighbridges on This Fleet">
              This company has no weighbridge records. Weighbridges report from one fleet
              only, so switch company to see them.
            </EmptyNote>
          ) : error ? (
            <EmptyNote icon="ti-cloud-off" tone="error" title="Weighbridge Tickets Unavailable"
                       action={{ label: "Try again", onClick: reload }}>
              {error}
            </EmptyNote>
          ) : loading && !data ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Tickets">
              {progress && progress.total > 1
                ? `Reading day ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : "Fetching the weighbridge tickets for this span…"}
            </EmptyNote>
          ) : rows.length === 0 ? (
            <EmptyNote icon="ti-receipt-off" tone="ok" title="No Trips in This Span">
              No unit crossed a weighbridge on these days.
            </EmptyNote>
          ) : (
            <WeighbridgeCoverage
              orgId={orgId}
              tickets={rows}
              from={from}
              to={to}
              search={search}
              canKm={can("telemetry:read")}
              fleet={fleet}
              span={spanLabel(from, to)}
              centre={centre}
              centreName={centreName}
              centres={centres}
              consolidate={consolidate}
              loading={loading}
              onReload={reload}
            />
          )
        ) : (
          <>

            {error ? (
              <EmptyNote icon="ti-cloud-off" tone="error" title="Weighbridge Tickets Unavailable"
                         action={{ label: "Try again", onClick: reload }}>
                {error}
              </EmptyNote>
            ) : loading && !data ? (
              <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Tickets">
                {progress && progress.total > 1
                  ? `Reading day ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : "Fetching the weighbridge tickets for this span…"}
              </EmptyNote>
            ) : rows.length === 0 ? (
              /* Three different silences, and they are not the same news:
                 a search that matched nothing, a bridge that was quiet, and
                 a feed that has never delivered anything at all. */
              <EmptyNote
                icon={search ? "ti-search-off" : noBridges ? "ti-scale" : "ti-receipt-off"}
                tone={search ? "warn" : "ok"}
                title={search
                  ? "No Ticket Matches"
                  : noBridges
                    ? "No Weighbridges on This Fleet"
                    : data?.total
                      ? `Nothing Weighed at ${centreName || "This Bridge"}`
                      : "No Tickets in This Span"}
              >
                  {search
                    ? `Nothing on this day matches “${search}”. Tokens, plates and driver names are all searched.`
                    : noBridges
                      /* Not "no tickets today" — this company has never had a
                         ticket, and saying it plainly is the difference between
                         "your bridges stopped reporting" and "your fleet does
                         not have bridges". Switch company to reach one that
                         does. */
                      ? "This company has no weighbridge records. Weighbridges report from one fleet only, so switch company to see them."
                      : data?.total
                        ? `${data.total} ticket${data.total === 1 ? "" : "s"} were raised elsewhere. Try another bridge.`
                        : "Nothing was captured for these days. The provider serves about two days of tickets, so days before we began recording are outside the record rather than quiet."}
              </EmptyNote>
            ) : (
              <>
                {/* The panel's own export bar, the same one Probes, Fuel FSL,
                    Speed and Malfunction wear — same three buttons, same
                    order, same wording. A fifth tab with its own affordance
                    for getting data out is how the five drift apart. */}
                <ReportFilesBar
                  orgId={orgId}
                  source={rows}
                  title="Weighbridge tickets"
                  summary={
                    <>
                      <b>{data.matched}</b> ticket{data.matched === 1 ? "" : "s"} ·{" "}
                      {tonnes(shownNetKg)} weighed
                    </>
                  }
                  loading={loading}
                  onReload={reload}
                  onCsv={exportCsv}
                  sheet={(landscape) => ticketsDoc({
                    head: EXPORT_HEAD, body: exportBody(rows),
                    fleet: fleet.companyName, orgCode: fleet.orgCode,
                    bridge: centreName, span: spanWords(from, to), search,
                    netKg: shownNetKg, landscape,
                  })}
                  disabled={!rows.length}
                />

                {/* A table at every width. From a tablet up it scrolls sideways
                    with the vehicle held at the left edge; on a phone it keeps
                    the five columns a clerk checks (time, vehicle, type, net,
                    payload) and fits the screen. The `wb-col-full` columns are
                    in the ticket a tap opens (WeighbridgesScreen.css). */}
                {/* The Drivers roster's card: one rounded frame holding the
                    scroller and the pager (WeighbridgesScreen.css). */}
                <div className="wb-grid-card">
                <div data-tour="page-table" className="sp4-table-scroll sp4-keep-table wb-grid">
                  {/* `sp4-probe-table` is not decoration — the panel's cell
                      padding, alignment and density rules are scoped to it, so
                      claiming the class is what makes this grid sit at the
                      same rhythm as the one two tabs over. `--comfortable` is
                      the density Probes ships at. */}
                  <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
                    <thead>
                      <tr>
                        <th className="sp4-th--left">Time</th>
                        <th className="sp4-th--left sp4-th--pin">Vehicle</th>
                        <th className="sp4-th--left wb-col-full">Driver</th>
                        <th className="sp4-th--left">Type</th>
                        <th className="sp4-th--left wb-col-full">Token</th>
                        {/* Tare before gross: that is the order 715 of 729
                            tickets were actually weighed in — empty first,
                            loaded later — so the row reads as the lorry's
                            morning rather than as a form. */}
                        <th className="sp4-th--right wb-col-full">Tare</th>
                        <th className="sp4-th--right wb-col-full">Tare at</th>
                        <th className="sp4-th--right wb-col-full">Gross</th>
                        <th className="sp4-th--right wb-col-full">Gross at</th>
                        <th className="sp4-th--right">Net</th>
                        <th className="sp4-th--right">Payload</th>
                        <th className="sp4-th--right wb-col-full">Load time</th>
                        <th className="sp4-th--right wb-col-full">Ticket</th>
                        <th className="sp4-th--right wb-col-full">Since previous</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map(r => (
                        <tr
                          key={r.id}
                          className={"sp4-tr" + (selectedRow?.id === r.id ? " sp4-tr--selected" : "")}
                          aria-selected={selectedRow?.id === r.id}
                          onClick={() => openRow(r)}
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(r); } }}
                        >
                          <td className="sp4-td--left wb-mono">
                            {from === to ? clockLabel(r.tokenAt) : stampLabel(r.tokenAt, null)}
                          </td>
                          <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{r.vehicleNo}</span></td>
                          <td className="sp4-td--left wb-td-driver wb-col-full">{r.driverName}</td>
                          <td className="sp4-td--left"><TypeChip category={r.category} /></td>
                          <td className="sp4-td--left wb-mono sp4-muted wb-col-full">{r.token}</td>
                          <td className="sp4-td--right sp4-num wb-col-full">{kilos(r.tareWeightKg)}</td>
                          {/* One fact per cell, like every other grid on this
                              screen. The weight and the moment it was captured
                              used to share a cell in two stacked lines, which
                              is a shape nothing else here uses — and the stamp
                              is a column somebody sorts by eye, not a footnote
                              to the number above it. */}
                          <td className="sp4-td--right wb-mono wb-col-full">{stampLabel(r.tareAt, from === to ? from : null)}</td>
                          <td className="sp4-td--right sp4-num wb-col-full">{kilos(r.grossWeightKg)}</td>
                          <td className="sp4-td--right wb-mono wb-col-full">{stampLabel(r.grossAt, from === to ? from : null)}</td>
                          <td className="sp4-td--right sp4-num wb-td-net">{kilos(r.netWeightKg)}</td>
                          <td className="sp4-td--right sp4-num">{tonnes(r.netWeightKg)}</td>
                          <td className="sp4-td--right sp4-num wb-col-full">{gapLabel(r.turnaroundMs)}</td>
                          {/* "3 of 4" rather than "3": the position is only
                              meaningful against the lorry's whole day, and that
                              day may run across other bridges than this tab. */}
                          <td className="sp4-td--right sp4-num wb-col-full">{r.seq} of {r.vehicleTickets}</td>
                          <td className="sp4-td--right sp4-num wb-col-full">
                            {r.seq === 1
                              ? <span className="sp4-muted">first</span>
                              : gapLabel(r.sincePreviousMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pageCount > 1 && (
                  <nav className="wb-pager" aria-label="Ticket pages">
                    <button type="button" className="wb-pager__btn"
                            onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>
                      ← Prev
                    </button>
                    <span className="wb-pager__info" aria-live="polite">
                      Page {at + 1} of {pageCount}
                      <span className="wb-pager__range">
                        {" · "}{at * GRID_STEP + 1}–{at * GRID_STEP + pageRows.length} of {rows.length}
                      </span>
                    </span>
                    <button type="button" className="wb-pager__btn"
                            onClick={() => setPage(Math.min(pageCount - 1, at + 1))} disabled={at >= pageCount - 1}>
                      Next →
                    </button>
                  </nav>
                )}
                {/* The count line is the card's foot, so the card can run
                    down to the footer nav with nothing hanging under it. */}
                <div className="sp4-grid-footer">
                  {data.matched} of {data.total} ticket{data.total === 1 ? "" : "s"} in {spanLabel(from, to)}
                  {centreName ? ` · ${centreName}` : ""}
                  {loading && <span className="sp4-muted"> · refreshing…</span>}
                </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
