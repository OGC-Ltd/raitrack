// Rich vehicle vitals card — the single source for BOTH the map marker hover
// tooltip (FleetMap) and the left-panel search result (MapOverlay), so the two
// always show identical stats. Layout/positioning is the caller's job; this
// renders only the card content.
//
// Most vt-* styles live in FleetMap.css for historical reasons; the ones added
// with this component live in VehicleStatsCard.css, which MUST be imported
// here. It was not, for a long time, so its rules never shipped and the
// elements they targeted fell back to inherited values — 16px black text on a
// dark card.

import { useEffect, useRef, useState } from "react";
// The shared map card parts (the work plan card's), before this card's own.
import "../body/WorkPlansOnMap.css";
import "./VehicleStatsCard.css";
import { usePlaceName } from "../../hooks/usePlaceName";
import { copyText, formatCoords } from "../../lib/copyText";
import { vehicleActivity, isInTransit, isOnline, equipmentLabel, carriesCargo, maxPayloadTonnes, menengaiGroup, fleetTypeLabel, ACTIVITY_LABELS, ACTIVITY_COLORS } from "../../lib/vehicleMap";
import { liveTrip, roundTripKm, LEG_LABEL } from "../../lib/tripProgress";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { useJourneySoFar } from "../../hooks/useJourneySoFar";
import { burnAgainst } from "../../lib/vehicleDay";
import { displayPlate } from "../../lib/plate";
import TripReportButton from "../shared/TripReportButton";
import { useAppSelector } from "../../context/AppContext";
import { ORG_CODE_BY_COMPANY } from "../../api/org";
import { unitSite } from "../../lib/siteLists";
import { useWorkshopUnits } from "../../hooks/useWorkshopUnits";
import OpenInWorkshop from "../body/OpenInWorkshop";


// Provider classes → the words an operator uses. Anything unmapped falls back
// to the raw class, so a new type still shows rather than disappearing.
const VEHICLE_TYPE_LABELS = {
  BUS: 'Bus', TRACTOR: 'Tractor', TRUCK: 'Truck',
  LORRY: 'Lorry', SALOON: 'Saloon', PLANT: 'Plant',
  COMPANY_VEHICLE: 'Company vehicle',
};

/**
 * The state badge — what the vehicle is DOING or what is wrong with it.
 *
 * Connection is NOT in here. It used to be: the badge showed "Online" for
 * status 'ok' and "Parked / In Depot" for 'parked', so connection and activity
 * shared one slot and only one of them could ever be visible. Once `idling`
 * was added as a status this went from confusing to broken — there was no
 * entry for it, so an idling unit rendered a BLANK badge and lost its
 * connection indication entirely. Connection now has its own chip beside this
 * one, and the two are independent, as they are in the data.
 *
 * Deliberately partial: a healthy online vehicle gets NO badge, because the
 * activity chip below already says In Transit / Idling / Resting and a badge
 * reading "Online" beside a chip reading "ONLINE" is noise.
 *
 * IN TRANSIT IS NOT HERE either. It was, above a chip reading "Driving" — the
 * same fact in two places, in two vocabularies. The chip now carries it (and
 * the rippling dot that went with it), so the vehicle's activity is stated
 * exactly once.
 *
 * IDLING IS NOT HERE, for the same reason. The cyan activity chip states it, and
 * the run row underneath states it WITH a duration ("Idling for 2h 14m"), so a
 * badge repeating the bare word was a third copy that added nothing. It also
 * rendered GREEN — STATUS_COLORS has no 'idling' entry, so it fell back to the
 * healthy colour, which is the opposite of what idling means.
 *
 * Only alerts belong here: states that are NOT visible anywhere else on the
 * card and that an operator has to act on.
 */
const STATE_LABELS = {
  speeding: "Speeding",
  theft:    "Fuel Theft Alert",
};

export function Bar({ pct, color }) {
  return (
    <div className="vt-bar-track">
      <div className="vt-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

/**
 * One line of the vitals ledger.
 *
 * `valColor` / `subColor` are for a figure whose COLOUR CARRIES MEANING — a
 * speed over its limit, a tank under 15 %. A reading that means nothing in
 * particular passes neither, and the stylesheet's own `--text-primary` /
 * `--text-secondary` apply: those follow the theme, and an inline style does
 * not. That is not a nicety. Mileage and engine hours used to arrive here as
 * a literal `#e6edf3`, which measures 1.18 against a white card — the figures
 * were not faint in light mode, they were invisible, and no `.app--light`
 * rule could have reached them past the inline style.
 *
 * When a colour IS passed it must be a token — `var(--accent-warn)`, not the
 * hex behind it, for the same reason.
 */
export function Tile({ label, value, unit, sub, subColor, valColor }) {
  return (
    <div className="vt-tile">
      <span className="vt-tile-lbl">{label}</span>
      <span className="vt-tile-fig">
        <span className="vt-tile-val" style={valColor ? { color: valColor } : {}}>
          {value}{unit && <span className="vt-tile-unit">{unit}</span>}
        </span>
        {sub && <span className="vt-tile-sub" style={subColor ? { color: subColor } : {}}>{sub}</span>}
      </span>
    </div>
  );
}

/**
 * Wall-clock HH:MM, with a day offset when the moment falls on a different
 * local day from `relativeTo`.
 *
 * The offset matters here: this fleet's round trips run to about nineteen
 * hours, so a due-back time is routinely the next day and a bare "11:04" under
 * a "23:16" departure reads as already past. Counted on local midnights, so
 * 23:16 → 01:23 is +1d the way a person means it.
 */
function fmtClock(ms, relativeTo) {
  if (ms == null || Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (relativeTo == null) return hhmm;
  const base = new Date(relativeTo);
  if (Number.isNaN(base.getTime())) return hhmm;
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(d) - midnight(base)) / 86_400_000);
  return days === 0 ? hhmm : `${hhmm} ${days > 0 ? "+" : "−"}${Math.abs(days)}d`;
}

// "1d 3h" / "2h 14m" / "34m" / "under a minute" — how long a parked vehicle
// has been stationary (now − last moving telemetry ping).
function fmtDuration(ms) {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "under a minute";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** The over-limit mark on the speed tile. Drawn for the same reason the run
 *  glyphs are: the character it replaces renders as a yellow-and-black emoji
 *  on Windows and a thin monochrome outline elsewhere, and neither of them
 *  took the amber the label beside it is already set in. */
function WarnGlyph() {
  return (
    <svg
      className="vt-warn-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

/**
 * The run row's icon, drawn.
 *
 * These were emoji — a motorway, a parking P, a stopwatch. Emoji as an
 * interface icon is a tell for a reason that is not only taste: each one is a
 * different artist's work at a different optical weight, none of them inherits
 * the row's colour, and the same three characters render as three unrelated
 * pictures across Windows, macOS and Android. The stopwatch in particular
 * arrived as a colour bitmap on one platform and a thin outline on another.
 *
 * Stroke-only paths on a 24-unit grid in `currentColor`, which is the same
 * vocabulary the map's site-plan markers use (see SITE_GLYPH in FleetMap) — so
 * a fleet drawn on the map and a fleet described in a card are drawn by the
 * same hand. `currentColor` is what makes them track the row's state tint and
 * the light theme without a second set of assets.
 */
function RunGlyph({ kind }) {
  const path = {
    // A road narrowing to the horizon, with its centre line dashed.
    road:  <><path d="M7 20 9.5 4M17 20 14.5 4" /><path d="M12 6v2M12 11v2M12 16v2" /></>,
    // A vehicle standing with its engine turning over: the body, and the
    // exhaust above it. Not the parking P, which says the opposite of idling.
    idle:  <><path d="M4 17h12M5.5 17l1.2-3.6A1.7 1.7 0 0 1 8.3 12h4.4a1.7 1.7 0 0 1 1.6 1.4L15.5 17M7 17v1.8M13 17v1.8" />
             <path d="M17.5 9.5c1.6-.6 1.6-2.4 3-3" /></>,
    // A clock, which is the one thing on the card measuring elapsed time.
    clock: <><circle cx="12" cy="12" r="7.5" /><path d="M12 7.6V12l3 1.8" /></>,
  }[kind] ?? null;

  return (
    <svg
      className="vt-run-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

/**
 * How long this vehicle has been in its current state, and since when.
 *
 * Two states, deliberately styled differently because they mean opposite
 * things operationally: a truck that has been ON THE ROAD for six hours is a
 * driver-hours question, and one that has been RESTING for six hours is a
 * utilisation question.
 *
 * Prefers the server's movement tracker (lib/movement-state), which knows when
 * the current run actually began and tolerates a short stop at a junction
 * without ending a journey. Falls back to `lastMovedAtMs` — the last ping that
 * showed movement — for a vehicle parked since before the server started,
 * which is the only thing the old version of this row ever used and the reason
 * it rendered nothing for 95 of 224 vehicles.
 *
 * `exact: false` means the run was already under way when we started watching
 * (a restart mid-journey), so the duration is reported as a lower bound rather
 * than overstated.
 */
function RunRow({ vehicle }) {
  const m = vehicle.movement;

  const sinceMs = m?.since ? Date.parse(m.since)
                : vehicle.lastMovedAtMs != null ? vehicle.lastMovedAtMs
                : null;
  if (sinceMs == null || !Number.isFinite(sinceMs)) return null;

  // Trust the tracker's own verdict when we have it; otherwise the fallback
  // only ever describes a stopped vehicle.
  const state    = m?.state ?? "resting";
  const approx   = m ? m.exact === false : false;
  const duration = fmtDuration(Math.max(0, Date.now() - sinceMs));

  // `idling` is only ever produced when the unit reports a real ignition line
  // (Wialon `engine operation` → io_239). Where it does not, the server sends
  // 'resting' rather than guessing — engine-on would otherwise just be a
  // restatement of "moving". See lib/movement-state.
  const RUN = {
    moving:  { cls: "mapcard__run--transit", glyph: "road",  label: "On the road for " },
    idling:  { cls: "mapcard__run--idle",    glyph: "idle",  label: "Idling for " },
    resting: { cls: "mapcard__run--rest",    glyph: "clock", label: "Resting for " },
  }[state] ?? { cls: "mapcard__run--rest", glyph: "clock", label: "Resting for " };

  // One line of the card's job block (the work plan card's shape, operator
  // 2026-11-21): the glyph, how long, and since when.
  return (
    <p className={`mapcard__line mapcard__run ${RUN.cls}`}>
      <RunGlyph kind={RUN.glyph} />
      <span>
        {RUN.label}
        <b>{approx ? "≥ " : ""}{duration}</b>
        <span className="mapcard__quiet"> · since {fmtClock(sinceMs)}</span>
      </span>
    </p>
  );
}

/** One row of the card: its label in the left column, its lines on the right
 *  (the work plan card's `Part`, WorkPlanHoverCard). */
function Part({ label, children }) {
  return (
    <div className="mapcard__part">
      <dt className="mapcard__partk">{label}</dt>
      <dd className="mapcard__partv">{children}</dd>
    </div>
  );
}

/** A line of a part. `main` is the line you read first; the rest are quiet. */
const Line = ({ children, main = false, mono = false, title }) => (children == null || children === false ? null
  : <p className={"mapcard__line" + (main ? " mapcard__line--main" : "") + (mono ? " mapcard__line--mono" : "")} title={title}>{children}</p>);

/** One cell of the figures strip: what, how much, and a word on it. */
function Figure({ label, value, unit, note, valColor, noteColor, meter }) {
  return (
    <div className="mapcard__fuelcell">
      <dt className="mapcard__fuelk">{label}</dt>
      <dd className="mapcard__fuelv" style={valColor ? { color: valColor } : undefined}>
        {value}{unit && <span className="mapcard__unit">{unit}</span>}
      </dd>
      {note && <dd className="mapcard__fueln" style={noteColor ? { color: noteColor } : undefined}>{note}</dd>}
      {meter && (
        <dd className="mapcard__meter" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, meter.pct))}%`, background: meter.color }} />
        </dd>
      )}
    </div>
  );
}

/* The assigned-geofence row lived here.
 *
 * It reported which keep-out zones a unit was inside, and it goes with the
 * fences themselves: every geofence we hold came from the tracking provider,
 * none of them is drawn on the map any more, and a hover card is the wrong
 * place to be the last surviving view of a layer the product no longer shows.
 * It was also the only row here that was usually absent — the clear case
 * rendered nothing — so the card changed height with the data, which is what
 * makes a card feel unstable under a pointer that is already on it.
 *
 * The containment test itself is NOT gone. `zoneTestFor` in FleetMap still
 * computes it, and it still decides whether a stopped unit raises the
 * stranded-stop flag — which is the alarm that actually needed it.
 */

/**
 * `withDay` is for a card somebody clicked (the pinned map card, the fuel
 * incident window): it reads the unit's day for the start row. A hover card
 * leaves it off and shows the start only where the day is already held.
 */
export default function VehicleStatsCard({ vehicle, withDay = false, onAlertClick }) {
  // ── Derived colour values (same thresholds as fleetdash) ──────────────────
  // The alert pills and the speed figure take their colours from the
  // stylesheet's tokens (VehicleStatsCard.css), which follow the theme.
  const engineOn    = vehicle.engine === "on";

  // Engine-temperature and oil-level grading used to be computed here for two
  // of the vitals tiles. The trackers report neither channel — the Wialon
  // adapter nulls both on every frame — so those tiles now show MILEAGE and
  // ENGINE HRS, which are real counters, and this grading had no consumer left.

  const fuel      = vehicle.fuelLevel ?? 0;
  const fuelColor = fuel < 15 ? "var(--accent-crit)"
                  : fuel < 40 ? "var(--accent-warn)"
                  : "var(--accent-ok)";

  // Generators, motorbikes, plant and light vehicles never carry a load, so
  // they get no payload row at all rather than "No load expected 0 / 30 t".
  const hasPayload = carriesCargo(vehicle);
  const maxPay    = vehicle.maxPayload ?? maxPayloadTonnes(vehicle.vehicleType);
  const loadPct   = maxPay > 0 ? Math.round((vehicle.weight / maxPay) * 100) : 0;
  /* A FULL TRUCK IS THE GOAL, not an alarm.
     This graded the load like the fuel bar above it — red past 95%, amber
     past 80 — which reads the wrong way round: a unit signed out with 29 t on
     a 30 t bed is doing exactly what it was sent to do, and the card said so
     in the same red it uses for a dry tank. 580 bags of sugar is a good day.
     The only number that is news here is one OVER the legal payload, which is
     an offence rather than a full load, so that is the only one that shouts.
     (maxPayloadTonnes is the legal figure per type — see lib/vehicleMap.) */
  const loadColor = loadPct > 100 ? "var(--accent-crit)" : "var(--accent-ok)";

  // The open dispatch, as a round trip, recomputed from the live position —
  // the same source and the same helpers the Active Trip card uses, so hover
  // and panel can never disagree.
  //
  // This block used to read `vehicle.leg`, the retired simulator's journey
  // object, and had not rendered for anyone since the cutover. Sourcing
  // departure/destination from the dispatch brought it back to life with the
  // OTHER leg fields still unmapped, so it returned showing "0 / 0 km" and a
  // blank ETA. Everything it displays now comes from the trip.
  const trip    = liveTrip(vehicle.trip, vehicle.lat, vehicle.lng);
  const hasLeg  = trip != null;
  const total   = roundTripKm(trip);
  const distPct = trip?.percent ?? 0;
  // Ground actually driven today — the server's figure, the same one the
  // vehicle brief and the Active Trip card quote. Only the fallback for
  // OUTBOUND below, where the day's readings are not to hand.
  const drivenToday = trip?.distanceTodayKm ?? null;
  // The FactorySuite serial for the unit's open dispatch, when one has come in
  const serial = (trip?.serialNumber ?? vehicle.sealSerial ?? "").trim() || null;

  // A place name is what an operator can act on; "-6.8530, 39.2266" is not.
  // Resolves in the background and falls back to the coordinates until it lands.
  const placeName = usePlaceName(vehicle.lat, vehicle.lng);

  /* START → NOW, on every unit (operator, 28 Sep: "all the cards when I click
     on a unit should include the start and the current location, departed
     will be the time they start, outbound will be the distance covered since
     start, the serial should be removed").

     This block used to show only on a unit with an open dispatch, and then as
     the dispatch's yard ⇄ destination, its paperwork departure and a position
     along the round trip. KCB 303Z on 28 Sep read DEPARTED 05:43 under "On
     the road since 05:23", and "distance not measured" beside 0.2 km driven
     today at 45 km/h. Now the start is where and when the unit actually set
     off today, read off its own readings (lib/vehicleDay journeySoFar — the
     same start the vehicle panel's "Departed" names), and OUTBOUND is the
     ground covered since then. */
  const { orgId } = useFleetLiveShared() ?? {};
  const journey = useJourneySoFar(orgId, vehicle.vehicleId, withDay, vehicle.tankCapacityL ?? null);
  // Today's burn rate, off the same readings (lib/vehicleDay burnRate)
  const burn = journey?.burn ?? null;
  // Against the register's standard, where FactorySuite rates the unit
  const vsStd = burnAgainst(burn, vehicle.ratedBurn);
  const start = journey?.start ?? null;
  const startName = usePlaceName(start?.lat ?? null, start?.lng ?? null);
  const dayPending = withDay && journey == null;
  const outboundKm = journey ? journey.km : drivenToday;
  const showJourney = withDay || journey != null || hasLeg;

  // ── Copy coordinates ──────────────────────────────────────────────────────
  //
  // `idle` → `copied` → `idle`, or `failed` if the clipboard refused. The
  // handler used to mutate the button's own classList and title inside a
  // `.then()`, which is why it never worked on the box: see lib/copyText for
  // what `navigator.clipboard?.writeText(...).then(...)` actually does on a
  // page served over plain HTTP. State also survives the re-render a live
  // telemetry tick forces through this card, which a DOM class did not — the
  // flash used to vanish mid-flash on a moving unit.
  const coords = formatCoords(vehicle.lat, vehicle.lng);
  const [copyState, setCopyState] = useState("idle");
  const flashRef = useRef(null);

  useEffect(() => () => clearTimeout(flashRef.current), []);

  const onCopyCoords = async (e) => {
    // The card sits inside a marker, a search row and a pinned window, all of
    // which act on a click. Copying a coordinate is not selecting a vehicle.
    e.stopPropagation();
    if (!coords) return;
    const ok = await copyText(coords);
    setCopyState(ok ? "copied" : "failed");
    clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setCopyState("idle"), ok ? 1800 : 2600);
  };

  // The row's own tooltip carries the pair as TEXT, because on the hover card
  // the button cannot be reached — see the note at the button. `placeName`
  // falls back to the coordinates until it resolves, and often never does, so
  // appending them unconditionally produced "-0.2877, 36.0446 — -0.287683,
  // 36.044650": the same fix twice at two precisions.
  // A comma alone would not do it — "Nakuru, Kenya" is a name and reads like
  // a pair. Two signed decimals and nothing else is a fix.
  const place = placeName ?? vehicle.location ?? "";
  const isFix = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(place);
  const locTitle = !coords ? (vehicle.location || undefined)
    : place && !isFix ? `${place} - ${coords}`
    : coords;

  const copyTitle = !coords ? "No coordinates available"
    : copyState === "copied" ? `Copied ${coords}`
    : copyState === "failed" ? "Could not copy, the coordinates are in the tooltip"
    : `Copy coordinates: ${coords}`;

  // Connection, straight from the provider — see isOnline in lib/vehicleMap.
  const online = vehicle.online ?? isOnline(vehicle);

  // The SAME classification the marker and the filter counts use, so the chip,
  // the truck on the map and the IN TRANSIT / IDLING / PARKED numbers can never
  // describe this vehicle differently. See vehicleActivity in lib/vehicleMap.
  //
  // Green in transit, blue idling, slate parked — and because the three are
  // mutually exclusive, a vehicle that stops with its engine running turns blue
  // here at the same moment it moves out of the in-transit count.
  //
  // Gated on the connection: an offline unit's last frame could still carry
  // engine-on, which would show a blue "Idling" chip for a tracker we have not
  // heard from. Offline reports Parked, as the marker does.
  const activity     = online ? vehicleActivity(vehicle) : "parked";
  const driverColor  = ACTIVITY_COLORS[activity];
  const activityLabel = ACTIVITY_LABELS[activity];

  const inTransit = isInTransit(vehicle);

  const typeLabel = equipmentLabel(vehicle)
    ?? (vehicle.vehicleType && vehicle.vehicleType !== "UNSPECIFIED"
          ? VEHICLE_TYPE_LABELS[vehicle.vehicleType] ?? vehicle.vehicleType
          : null);

  // Menengai's fleet-list group (Tankers, Van Sales, …), highlighted on the
  // card (operator, 2 Nov 2026); null for any other organisation's unit.
  const group = menengaiGroup(vehicle);
  // West Kenya's site (Naitiri, Olepito, …), the same chip (operator, 13 Nov
  // 2026); null for another organisation's unit or one no site claims.
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const site = unitSite(vehicle, ORG_CODE_BY_COMPANY[activeCompanyId]);

  // Where the unit stands with the workshop (operator, 2026-11-21): booked in,
  // in, being fixed, waiting on parts, work done — from its open repair job and
  // FactorySuite card. The same shared read as the units list and the unit
  // panel (hooks/useWorkshopUnits), so the three never disagree; empty for a
  // role without repair:read.
  const ws = useWorkshopUnits().get(vehicle.vehicleId) ?? null;
  const wsSince = ws?.since
    ? new Date(ws.since).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })
    : null;

  // Alerts only. Activity belongs to the one chip below, so it is stated once.
  const stateLabel = STATE_LABELS[vehicle.status];

  // The figures strip: fuel, speed, burn rate — the three numbers a glance at
  // a unit is for, framed the way the work plan card frames its fuel.
  const fuelValue = vehicle.fuelLitres != null ? Math.round(vehicle.fuelLitres).toLocaleString()
    : vehicle.fuelLevel != null ? `${fuel}` : "-";
  const fuelUnit = vehicle.fuelLitres != null ? " L" : vehicle.fuelLevel != null ? "%" : "";
  // Litres out of tank capacity makes the percentage meaningful — 50% of a
  // 20 L saloon tank is not 50% of a 400 L tractor.
  const fuelNote = vehicle.fuelLitres != null && vehicle.tankCapacityL != null
    ? `${fuel}% of ${Math.round(vehicle.tankCapacityL).toLocaleString()} L`
    : vehicle.fuelLitres != null && vehicle.fuelLevel != null ? `${fuel}%`
    : vehicle.fuelLevel == null && vehicle.fuelLitres == null ? "no reading" : null;

  const limit = vehicle.speedLimit ?? 80;
  const over = engineOn && vehicle.speed > limit;
  const speedNote = !engineOn ? "sensor off"
    : vehicle.speedLimit != null ? (over ? <><WarnGlyph />{` limit ${vehicle.speedLimit}`}</> : `limit ${vehicle.speedLimit}`)
    : null;

  // A unit the FactorySuite register rates shows its standard burn rate only
  // (operator 2026-11-20). Any other unit: litres per engine hour today, with
  // litres per km once it has driven far enough to say (lib/vehicleDay burnRate).
  const burnFig = vsStd
    ? { value: vsStd.std.toFixed(vsStd.digits), unit: ` ${vsStd.unit}`, note: "standard" }
    : {
        value: burn?.lPerH != null ? burn.lPerH.toFixed(1) : burn?.lPerKm != null ? burn.lPerKm.toFixed(2) : "-",
        unit: burn?.lPerH != null ? " L/h" : burn?.lPerKm != null ? " L/km" : "",
        note: burn?.lPerH != null && burn.lPerKm != null ? `${burn.lPerKm.toFixed(2)} L/km`
          : burn ? "today"
          : dayPending ? "reading…" : "not enough today",
      };

  const startPlace = start ? startName ?? formatCoords(start.lat, start.lng) ?? "the start" : null;

  return (
    <article className="mapcard mapcard--unit">
      {/* ── Head: the unit, what it is, and whether its tracker is talking ── */}
      <header className="mapcard__head">
        <h3 className="mapcard__title" title={vehicle.name || vehicle.id}>
          {displayPlate(vehicle)}
          {/* What this machine actually is. KASULU units take the name off
              RaiFactorySuite's machine register ("CASE PUMA", "Bull Dozer");
              otherwise the SPECIFIC equipment name off the unit's code — an EX
              is an "Excavator", not the "Plant" its class says. */}
          {typeLabel && <span className="mapcard__titlesub">{typeLabel}</span>}
        </h3>
        <div className="mapcard__states">
          {/* ALERT — only when something is wrong (STATE_LABELS). The theft
              pill opens the unit's fuel theft window when the card's owner
              offers a way to (a clicked map card does; a hover card and the
              window's own copy do not). */}
          {stateLabel && (onAlertClick && vehicle.status === "theft" ? (
            <button
              type="button"
              className={`mapcard__state mapcard__state--${vehicle.status} mapcard__state--action`}
              onClick={onAlertClick}
              title="Open the fuel theft alert"
            >
              {stateLabel}
            </button>
          ) : (
            <span className={`mapcard__state mapcard__state--${vehicle.status}`}>{stateLabel}</span>
          ))}
          {/* CONNECTION — always shown, the provider's own verdict (Wialon's
              netconn), independent of what the unit is doing. */}
          <span className={`mapcard__state mapcard__state--${online ? "online" : "offline"}`}>
            {online ? "Online" : "Offline"}
          </span>
        </div>
      </header>

      {/* ── What it is doing, and for how long ── */}
      <div className="mapcard__job">
        {/* The SAME classification the marker and the filter counts use
            (vehicleActivity), gated on the connection: an offline unit's last
            frame could still carry engine-on. */}
        <p className="mapcard__line mapcard__line--main mapcard__activity" style={{ "--vt-transit-color": driverColor }}>
          {inTransit
            ? <span className="vt-transit-dot" aria-hidden="true" />
            : <span className="vt-dot" style={{ background: driverColor }} aria-hidden="true" />}
          <span style={{ color: driverColor }}>{activityLabel}</span>
          <span className="mapcard__activity-engine">· engine {engineOn ? "on" : "off"}</span>
        </p>
        <RunRow vehicle={vehicle} />
      </div>

      {/* ── Figures ── */}
      <dl className="mapcard__fuel">
        <Figure
          label="Fuel"
          value={fuelValue}
          unit={fuelUnit}
          note={fuelNote}
          valColor={vehicle.fuelLevel != null || vehicle.fuelLitres != null ? fuelColor : undefined}
          meter={vehicle.fuelLevel != null ? { pct: fuel, color: fuelColor } : null}
        />
        <Figure
          label="Speed"
          value={engineOn ? vehicle.speed : "-"}
          unit={engineOn ? " km/h" : ""}
          note={speedNote}
          valColor={!engineOn ? undefined : vehicle.speed > 100 ? "var(--accent-crit)" : over ? "var(--accent-warn)" : undefined}
          noteColor={over ? "var(--accent-warn)" : undefined}
        />
        <Figure label="Burn rate" value={burnFig.value} unit={burnFig.unit} note={burnFig.note} />
      </dl>

      {/* ── The rest, as a two-column list ── */}
      <dl className="mapcard__parts">
        {/* First of the parts: a unit in the workshop is not out working,
            whatever its tracker says, and that is the first thing to know. */}
        {ws && (
          <Part label="Workshop">
            <p className={`mapcard__line mapcard__line--main mapcard__ws mapcard__ws--${ws.tone}`}>
              <span className="mapcard__ws-dot" aria-hidden="true" />
              {ws.label}{ws.fix ? `: ${ws.fix}` : ""}
            </p>
            {ws.detail && <Line>{ws.detail}</Line>}
            <Line>{[ws.card, ws.major ? "major repair" : null, wsSince ? `since ${wsSince}` : null].filter(Boolean).join(" · ") || null}</Line>
            {/* The job, from a clicked card only: the hover card takes no pointer. */}
            {withDay && (
              <span className="mapcard__ws-open-row">
                <OpenInWorkshop itemId={ws.jobId} className={`mapcard__ws-open mapcard__ws--${ws.tone}`}>Open job</OpenInWorkshop>
              </span>
            )}
          </Part>
        )}

        <Part label="Driver">
          <Line main>{vehicle.driver || "Unassigned"}</Line>
          {/* Menengai's fleet-list group (Tankers, Van Sales, …), highlighted
              (operator, 2 Nov 2026), and West Kenya's site (Naitiri, Olepito,
              …) the same way (13 Nov 2026); null elsewhere. */}
          {(group || site) && (
            <p className="mapcard__tags">
              {group && (
                <span className={`mapcard__tag${group === "mg:" ? " mapcard__tag--none" : ""}`} title="Group on the fleet list">
                  {fleetTypeLabel(group)}
                </span>
              )}
              {site && <span className="mapcard__tag" title="Site">{site}</span>}
            </p>
          )}
        </Part>

        <Part label="Where">
          {/* The pin copies the pair. A live control on the clicked card and
              the incident window; on the hover card (pointer-events:none) it is
              decoration, which is why the coordinates are also in the title. */}
          <p className="mapcard__line mapcard__line--main mapcard__where" title={locTitle}>
            <button
              type="button"
              className={"vt-loc-icon-btn"
                + (copyState === "copied" ? " vt-loc-icon-btn--copied" : "")
                + (copyState === "failed" ? " vt-loc-icon-btn--failed" : "")}
              title={copyTitle}
              onClick={onCopyCoords}
              disabled={!coords}
              aria-label={coords ? "Copy vehicle coordinates to clipboard" : "No coordinates to copy"}
            >
              <svg className="vt-loc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {copyState === "copied" ? (
                  <path d="M20 6L9 17l-5-5" />
                ) : copyState === "failed" ? (
                  <>
                    <path d="M12 3L1.8 20.5h20.4L12 3z" />
                    <path d="M12 10v4M12 17.5v.01" />
                  </>
                ) : (
                  <>
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                    <circle cx="12" cy="9" r="2.5"/>
                  </>
                )}
              </svg>
            </button>
            <span className="vt-sr-only" role="status" aria-live="polite">
              {copyState === "copied" ? `Copied ${coords}`
                : copyState === "failed" ? "Could not copy the coordinates"
                : ""}
            </span>
            <span>{place || coords || "-"}</span>
          </p>
        </Part>

        {/* START → NOW (operator, 28 Sep): where and when the unit set off
            today, off its own readings, and the ground covered since. Departed
            only on a FactorySuite dispatch; otherwise it simply started work
            (operator, 2026-10-27). */}
        {showJourney && (
          <Part label="Today">
            <Line main title={start ? formatCoords(start.lat, start.lng) ?? undefined : undefined}>
              {start ? `${hasLeg ? "Departed" : "Started"} ${fmtClock(start.t)} from ${startPlace}`
                : dayPending ? "…" : "Not moved today"}
            </Line>
            <Line>
              {journey && !start ? "0 km outbound"
                : outboundKm != null ? `${(+outboundKm).toFixed(1)} km since start`
                : dayPending ? "…" : "Distance not measured"}
            </Line>
            {/* An open dispatch keeps its round trip. No position without a
                measured destination: an empty figure would read as "nowhere
                yet" rather than "unmeasurable". */}
            {hasLeg && trip.destination && (
              <Line>
                {[LEG_LABEL[trip.leg],
                  trip.percent != null && total != null ? `${trip.percent}% of the ${total} km round trip to ${trip.destination}` : `trip to ${trip.destination}`,
                ].filter(Boolean).join(" · ")}
              </Line>
            )}
            {hasLeg && trip.percent != null && (
              <span className="mapcard__meter mapcard__meter--trip" aria-hidden="true">
                <i style={{ width: `${Math.max(0, Math.min(100, distPct))}%` }} />
              </span>
            )}
          </Part>
        )}

        {/* Generators, motorbikes, plant and light vehicles never carry a
            load, so they get no load row at all. A full truck is the goal,
            not an alarm: only a load OVER the legal payload shouts. */}
        {hasPayload && (
          <Part label="Load">
            <Line main>
              <span>{vehicle.cargo}</span>
              <span style={{ color: loadColor }}>{` · ${vehicle.weight} / ${maxPay} t`}</span>
            </Line>
            <Line>{loadPct}% of payload capacity</Line>
          </Part>
        )}

        <Part label="Meters">
          <Line main>
            {vehicle.odometerKm != null ? `${Math.round(vehicle.odometerKm).toLocaleString()} km` : "-"}
            <span className="mapcard__quiet"> total distance</span>
          </Line>
          <Line main>
            {vehicle.engineHours != null ? `${Math.round(vehicle.engineHours).toLocaleString()} h` : "-"}
            <span className="mapcard__quiet"> engine run time</span>
          </Line>
        </Part>

        {/* Only once RaiFactorySuite has sent a serial for the unit's open
            dispatch (operator, 28 Sep); until then the row is not drawn. */}
        {serial && (
          <Part label="Seal">
            <Line mono>{serial}</Line>
          </Part>
        )}
      </dl>

      {/* The printable report for this run, or the unit's last one when it is
          not out on a dispatch. Clicked card only. */}
      {withDay && orgId && vehicle.vehicleId && (
        <footer className="mapcard__foot mapcard__foot--report">
          <TripReportButton
            report={{ orgId, vehicleId: vehicle.vehicleId, dispatch: vehicle.trip?.externalId ?? null }}
            label={hasLeg ? "Trip report" : "Last trip report"}
          />
        </footer>
      )}
    </article>
  );
}
