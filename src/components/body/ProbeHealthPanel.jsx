// Probe & Sensor Health — the Health tab.
//
// ## Why this is a tab and not a band above the grid
//
// It shipped stacked above All Probes, and that was wrong: two dense tables
// rendering at once, the grid sitting behind this one, neither able to use the
// screen. The tab strip is this monitor's own idiom — All Probes, Fuel FSL,
// Speed, Malfunction are each ONE view of the fleet — and health is a peer of
// those, not a preamble to one of them.
//
// As a tab it also gets a count badge, which is the real gain. "45 units need
// attention" was previously invisible until you scrolled to the panel; on the
// strip an operator reads it while looking at something else.
//
// It stays distinct from All Probes because they answer different questions.
// The grid renders the LIVE snapshot — what each channel reads right now — and
// is structurally unable to say when a probe stopped, what it last read, or
// whether a sensor is fitted. Up there a probe dead for a week and one never
// installed both draw a dash.
//
// ## Probe and sensor are separate faults on purpose
//
// A fuel channel that produces nothing can be a broken probe OR a Wialon record
// nobody finished — a sensor configured with no calibration table, which emits
// no level AND no fault, so every other rule on the fleet reads it as healthy.
// Measured on production 2026-08-20: 25 units in exactly that state, all
// carrying a sensor named "2.Main Tank Fuel Level Qty ()" with an empty tank
// size. One is a workshop job, the other is ten minutes at a desk, and sending
// a fitter to the second wastes the trip.
//
// ## Styling
//
// Entirely SensorPanel's own classes — `sp4-gridbar`, `sp4-filter-chip`,
// `sp4-probe-table`, `sp4-pill`, `sp4-state`. It has no stylesheet of its own
// and should not acquire one: it sits directly above that grid, inside those
// tabs, and a second visual language on one screen reads as two products.

import { useCallback, useEffect, useMemo, useState, memo } from "react";
import TablePager, { usePager } from "./TablePager";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { vehicleReadings } from "../../lib/vehicleReadings";
import {
  PROBE_STATE_LABEL, CHANNEL_STATE_LABEL, faultAction,
} from "../../api/probeHealth";
import { downloadProbeCsv, downloadProbePdf } from "../../utils/probeReport";
import TableToolbar from "./TableToolbar";
import RepairReportForm from "./RepairReportForm";
import { submitRepairReport, emailBanner, humanKind, OUTCOME_ACTION } from "../../api/repairs";
import FilterBar from "./FilterBar";

/** What the operator can narrow to. `bad` decides which of that channel's
 *  states count as not working. */
const CHANNELS = [
  { id: "all",         label: "All",          bad: (r) => r.needsAttention },
  // First named channel, because it is upstream of the rest: nothing on a
  // silent unit can be judged at all.
  { id: "tracker",     label: "Tracker",      bad: (r) => r.trackerSilent === true },
  { id: "fuelProbe",   label: "Fuel probe",   bad: (r) => ["DIED", "SILENT"].includes(r.fuelProbe?.state) },
  { id: "fuelSensor",  label: "Fuel sensor",  bad: (r) => r.fuelSensor?.uncalibrated === true },
  { id: "gps",         label: "GPS",          bad: (r) => r.channels?.gps?.state === "NOT_REPORTING" },
  { id: "ignition",    label: "Ignition",     bad: (r) => r.channels?.ignition?.state === "NOT_REPORTING" },
  { id: "odometer",    label: "Odometer",     bad: (r) => r.channels?.odometer?.state === "NOT_REPORTING" },
  { id: "engineHours", label: "Engine hrs",   bad: (r) => r.channels?.engineHours?.state === "NOT_REPORTING" },
];

const STATUSES = [
  ["faulty",  "Not working"],
  ["working", "Working"],
  ["all",     "All"],
];

const ago = (iso) => {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const h = ms / 3600000;
  if (h < 1)  return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${(h / 24).toFixed(0)}d ago`;
};

const litres = (ml) => (ml == null ? "—" : `${(ml / 1000).toFixed(1)} L`);

/**
 * State to pill modifier, in the panel's own vocabulary.
 *
 * NOT_FITTED maps to `--none`, not `--inc`: no hardware is not a fault, and
 * colouring it red sends people to look at machines that were never probed.
 */
const PILL = {
  OK: "con", REPORTING: "con",
  DIED: "inc", SILENT: "inc", NOT_REPORTING: "inc",
  NOT_FITTED: "none", UNKNOWN: "none",
};

const Pill = ({ state, label }) => (
  <span className={`sp4-pill sp4-pill--${PILL[state] ?? "none"}`}>{label ?? state ?? "—"}</span>
);

/**
 * One row of the probe table, and the reason it is its own component.
 *
 * ## The table repaints on every live frame
 *
 * This panel subscribes to the fleet snapshot, so `vehicles` — and with it the
 * `live` reading merged into each row — arrives again on every SSE frame.
 * Inline, that re-rendered all of them: measured on a synthetic table of the
 * same shape and stylesheet, 600 rows cost 370-670 ms of main thread per pass.
 * The tab spent most of its life reconciling a table whose visible content had
 * not changed, and an interaction landing in that queue — a select-all above
 * all, which is one more full pass on top — reads as a freeze rather than as
 * slowness.
 *
 * Memoised, a frame that moves five vehicles re-renders five rows, and ticking
 * one checkbox re-renders one.
 *
 * ## Everything it takes is a primitive, except two objects
 *
 * That is the whole design constraint. `checked`, `reported` and `isSelected`
 * are booleans the parent computes, rather than the Set and the id being
 * handed down to be searched here — a Set prop changes identity on every
 * selection and would defeat the memo for every row at once. `onToggle` and
 * `onOpen` are useCallback-stable, and `onOpen` takes the row so the parent
 * builds the payload without a closure per row.
 *
 * `r` is stable between fetches. `live` is NOT — `vehicleReadings` builds a
 * new object every frame — so the comparator reads the two fields this row
 * actually renders instead of trusting identity.
 */
const ProbeRow = memo(
  function ProbeRow({ r, live, canRepair, checked, reported, isSelected, onToggle, onOpen }) {
    return (
      <tr
        className={"sp4-tr sp4-tr--probe" + (isSelected ? " sp4-tr--selected" : "")}
        // Same drill-in the grid had: a row opens the last hour
        // of readings for that unit. Losing it in the merge
        // would have cost the one thing health cannot show —
        // the individual pings behind a verdict.
        onClick={() => onOpen(r)}
      >
        {canRepair && (
          /* stopPropagation on the CELL, not just the input:
             the whole <tr> is the drill-in target, so a click
             landing on this cell's padding would open the
             detail view instead of ticking the box. */
          <td className="sp4-td--check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="sp4-check"
              aria-label={`Select ${r.plate}`}
              checked={checked}
              disabled={reported}
              title={reported ? "A repair is already open for this unit" : undefined}
              onChange={() => onToggle(r.vehicleId)}
            />
          </td>
        )}
        <td className="sp4-td--left sp4-td--pin">
          <span className="sp4-reg">{r.plate}</span>
          <div className="sp4-muted">{r.deviceId ?? "—"}</div>
        </td>
        <td className="sp4-td--left sp4-td--action">
          {/* The server's partial unique index is the real
              guard against two reports on one probe. This only
              stops the technician filling in a form that was
              going to be refused. */}
          {reported && (
            <div><span className="sp4-pill sp4-pill--warn">Reported</span></div>
          )}
          {faultAction(r) || <span className="sp4-muted">—</span>}
        </td>
        <td className={"sp4-td--right" + (r.trackerSilent ? " sp4-probe--fault" : "")}>
          {ago(r.lastReportedAt)}
        </td>
        <td className="sp4-td--right">
          {live?.fuelLitres != null
            ? `${live.fuelLitres.toFixed(0)} L${live.fuelPct != null ? ` · ${live.fuelPct}%` : ""}`
            : <span className="sp4-muted">—</span>}
        </td>
        <td className="sp4-td--left">
          <Pill state={r.fuelProbe?.state} label={PROBE_STATE_LABEL[r.fuelProbe?.state]} />
        </td>
        <td className="sp4-td--right">{ago(r.fuelProbe?.lastAliveAt)}</td>
        <td className="sp4-td--right">{litres(r.fuelProbe?.lastValueMl)}</td>
        <td className="sp4-td--left">
          {!r.fuelSensor?.fitted
            ? <span className="sp4-pill sp4-pill--none">Not configured</span>
            : r.fuelSensor.uncalibrated
              ? <span className="sp4-pill sp4-pill--warn">Uncalibrated</span>
              : <span
                  className="sp4-pill sp4-pill--con"
                  // The count is real detail — a finer table
                  // converts the raw reading more accurately —
                  // but "30 pts" is jargon on a screen whose
                  // whole job is telling somebody what to do.
                  // The pill answers the question (is this
                  // sensor set up), the tooltip and the CSV
                  // carry the number.
                  title={`${r.fuelSensor.calibrationPoints}-point calibration table${r.fuelSensor.parameter ? ` on ${r.fuelSensor.parameter}` : ""}`}
                >Calibrated</span>}
        </td>
        <td className="sp4-td--left">
          <Pill state={r.channels?.gps?.state} label={CHANNEL_STATE_LABEL[r.channels?.gps?.state]} />
        </td>
        <td className="sp4-td--left">
          <Pill state={r.channels?.ignition?.state} label={CHANNEL_STATE_LABEL[r.channels?.ignition?.state]} />
        </td>
        <td className="sp4-td--right">
          {r.channels?.odometer?.lastValue != null
            ? `${Math.round(r.channels.odometer.lastValue).toLocaleString()} km`
            : <span className="sp4-muted">—</span>}
        </td>
        <td className="sp4-td--right">
          {r.channels?.engineHours?.lastValue != null
            ? `${Math.round(r.channels.engineHours.lastValue).toLocaleString()} h`
            : <span className="sp4-muted">—</span>}
        </td>
      </tr>
    );
  },
  /*
   * True means "skip the re-render". Compared by hand because `live` is a
   * fresh object each frame while every other prop is a primitive, so this is
   * far cheaper than the render it avoids.
   *
   * It is EXHAUSTIVE, and that is the cost of the memo: a field added to the
   * row above has to be added here too, or it will silently stop updating.
   * Stated here rather than discovered later.
   */
  (a, b) =>
    a.r === b.r &&
    a.canRepair === b.canRepair &&
    a.checked === b.checked &&
    a.reported === b.reported &&
    a.isSelected === b.isSelected &&
    a.onToggle === b.onToggle &&
    a.onOpen === b.onOpen &&
    a.live?.fuelLitres === b.live?.fuelLitres &&
    a.live?.fuelPct === b.live?.fuelPct,
);

export default function ProbeHealthPanel({
  search = "", data, loading, error, onReload, onSelect, selectedId,
  // Repair reporting, off unless the account may file one. Everyone else gets
  // exactly the table they had before — no column, no bar, no behaviour change.
  canRepair = false, openByVehicle, onRepairFiled,
}) {
  // The live snapshot, merged in per row. Health answers "is it working"; the
  // snapshot answers "what does it read right now", and the merged tab has to
  // carry both or it is not a merge — it is a replacement that lost half the
  // screen it replaced.
  const { vehicles, orgId } = useFleetLiveShared();
  // Keyed by PLATE, and read through vehicleReadings.
  //
  // Both were wrong first time round and both are worth naming. The snapshot's
  // vehicles carry the plate in `.id` — the grid this replaced did `plate: v.id`
  // — so keying on a cuid matched nothing. And the raw object has no
  // `fuelLevelMl`: vehicleReadings.js says the snapshot's `fuelLevelMl` /
  // `tankCapacityLitres` become `fuelLitres` / `tankCapacityL` on the way
  // through, and that helper is also where the plausibility check on the
  // percentage lives. Reading raw fields skipped it and rendered "—" on every
  // row, healthy ones included.
  const liveByPlate = useMemo(() => {
    const m = new Map();
    for (const v of vehicles ?? []) {
      const plate = v?.id ?? v?.plate ?? v?.registrationPlate;
      if (plate) m.set(String(plate), vehicleReadings(v));
    }
    return m;
  }, [vehicles]);
  const [channel, setChannel] = useState("all");
  // Opens on the fault list. A list somebody has to filter to reach is a list
  // they stop reaching for.
  const [status,  setStatus]  = useState("faulty");

  /* ── Repair selection ───────────────────────────────────────────────────
     Keyed on vehicleId, the row's own key. A Set rather than an array because
     the header checkbox and every row ask "is this one in?" on every render. */
  const [picked,     setPicked]     = useState(() => new Set());
  const [formOpen,   setFormOpen]   = useState(false);
  const [seedOutcome, setSeedOutcome] = useState("fixing");
  const [busy,       setBusy]       = useState(false);
  const [formError,  setFormError]  = useState("");
  const [banner,     setBanner]     = useState(null);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    const chan = CHANNELS.find(c => c.id === channel) ?? CHANNELS[0];
    return all.filter((r) => {
      if (q && !`${r.plate} ${r.name ?? ""} ${r.deviceId ?? ""}`.toLowerCase().includes(q)) return false;
      // "All" asks whether ANYTHING on the unit is wrong; a named channel asks
      // only about that one, so a unit with a dead probe does not surface under
      // an Ignition filter.
      const bad = chan.bad(r);
      if (status === "faulty")  return bad;
      if (status === "working") return !bad;
      return true;
    });
  }, [data, search, channel, status]);
  const pager = usePager(rows, `${search}|${channel}|${status}`);

  /*
   * What SUBMIT sends. Derived from `rows`, never from `picked` directly, so a
   * unit ticked under one filter and then filtered out by a search cannot ride
   * along into a report the technician never saw. This is the correctness half.
   */
  const selectedRows = useMemo(
    () => rows.filter((r) => picked.has(r.vehicleId)),
    [rows, picked],
  );

  /*
   * And prune `picked` itself, which is the HONESTY half. Without it the header
   * checkbox sits at "mixed" over a table where everything visible is ticked,
   * and the count in the action bar names units that are not on screen.
   *
   * Returning the previous Set when nothing was removed keeps the identity
   * stable, so this cannot drive itself in a loop.
   */
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.vehicleId));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  /* Stable, so the memoised row does not see a new function every render.
     Takes the ROW rather than a pre-built payload for the same reason: a
     closure per row would change identity on every pass. */
  const openRow = useCallback((r) => {
    onSelect?.({
      vehicleId: r.vehicleId, vehicleName: r.plate,
      type: "probe_row", detail: "Probes",
    });
  }, [onSelect]);

  const toggleRow = useCallback((id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleFile = useCallback(async ({ items, note }) => {
    setBusy(true);
    setFormError("");
    try {
      const res = await submitRepairReport({ orgId, items, note });
      setBanner(emailBanner(res?.email));
      setPicked(new Set());
      setFormOpen(false);
      onRepairFiled?.();
      onReload?.();
    } catch (e) {
      setFormError(e?.message ?? "Could not file the report");
    } finally {
      setBusy(false);
    }
  }, [orgId, onRepairFiled, onReload]);

  /*
   * The tick clears itself; the warnings do not.
   *
   * "Report filed. Emailed to 2 handlers." is a receipt — it has been read by
   * the time it fades, and leaving it costs a click for nothing. Every other
   * outcome is an INSTRUCTION ("no email was sent … tell an administrator"),
   * and an instruction that removes itself after six seconds is worse than
   * none: it gets half-read and the technician carries on believing somebody
   * was told.
   */
  useEffect(() => {
    if (banner?.tone !== "ok") return undefined;
    const t = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(t);
  }, [banner]);

  /* The three buttons SEED the form rather than submitting. See the header on
     RepairReportForm for why there is one form and not two paths. */
  const openForm = useCallback((outcome) => {
    setSeedOutcome(outcome);
    setFormError("");
    setBanner(null);
    setFormOpen(true);
  }, []);

  const formItems = useMemo(() => selectedRows.map((r) => ({
    key:        r.vehicleId,
    targetKind: "probe",
    vehicleId:  r.vehicleId,
    plate:      r.plate,
    label:      faultAction(r) || humanKind(null),
    /*
     * Which channels are actually failing on this unit, so the form can put
     * the parts that serve them at the top of its dropdown.
     *
     * Read from CHANNELS rather than from a second list of my own — these are
     * the same predicates the filter bar above the table runs, so a unit the
     * operator filtered to "Ignition" cannot arrive at the form ranked by
     * anything else. `all` is skipped: it is a view, not a channel, and its
     * `bad` is the union of every other one.
     *
     * An empty array is a legitimate answer (a unit ticked under "Working",
     * which a technician may do after replacing something pre-emptively), and
     * the form renders one ungrouped list for it.
     */
    channels:   CHANNELS.filter((c) => c.id !== "all" && c.bad(r)).map((c) => c.id),
  })), [selectedRows]);

  const filterNote = useMemo(() => {
    const chan = CHANNELS.find(c => c.id === channel)?.label ?? "All";
    const st = status === "faulty" ? "not working" : status === "working" ? "working" : "all states";
    return `${chan} · ${st}${search.trim() ? ` · matching "${search.trim()}"` : ""} · ${rows.length} units`;
  }, [channel, status, search, rows.length]);

  // The filter, in the filename. Both exports carry ONLY the filtered rows, so
  // three downloads of three different filters are three different documents —
  // and all three landing in one folder as "probes.csv" would be
  // indistinguishable the moment they leave the screen that made them.
  const filenameSlug = useMemo(() => {
    const parts = ["probes"];
    if (channel !== "all") parts.push(channel.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase());
    if (status !== "all")  parts.push(status === "faulty" ? "not-working" : "working");
    return parts.join("-");
  }, [channel, status]);

  const s = data?.summary;

  return (
    <section className="sp4-probe-health">
      {/* The panel's one export bar, shared with Fuel FSL, Speed and
          Malfunction. It used to be hand-rolled here and existed on this tab
          alone — see TableToolbar for why it moved. */}
      <TableToolbar
        summary={s && (
          <>
            <b>{s.total}</b> units ·{" "}
            <span className="sp4-probe--fault">{s.probeDied + s.probeSilent} probes down</span>
            {s.sensorUncalibrated > 0 && (
              <> · <span className="sp4-flag-hint">{s.sensorUncalibrated} sensors uncalibrated</span></>
            )}
          </>
        )}
        note={filterNote}
        loading={loading}
        onReload={onReload}
        onCsv={() => downloadProbeCsv(rows, { filenameSlug })}
        onPdf={() => downloadProbePdf({
          companyName: "Fleet Tracking", rows, filterNote, filenameSlug,
        })}
        disabled={!rows.length}
        actions={canRepair && selectedRows.length > 0 ? (
          <span className="sp4-selbar">
            <span className="sp4-selbar-n">{selectedRows.length} selected</span>
            <button type="button" className="sp4-act-btn"
                    onClick={() => openForm("fixing")}>{OUTCOME_ACTION.fixing}</button>
            <button type="button" className="sp4-act-btn sp4-act-btn--warn"
                    onClick={() => openForm("needs_spare")}>{OUTCOME_ACTION.needs_spare}</button>
            <button type="button" className="sp4-act-btn sp4-act-btn--crit"
                    onClick={() => openForm("cannot_fix")}>{OUTCOME_ACTION.cannot_fix}</button>
          </span>
        ) : null}
      />

      {banner && (
        /* A toast, not the full-bleed banner this was. See the .sp4-toast block
           in SensorPanel.css for why, and for why only the tick goes away by
           itself. `role="status"` and aria-live=polite rather than "alert":
           the report is filed either way, so this is never an interruption. */
        <div className={"sp4-toast sp4-toast--" + banner.tone} role="status" aria-live="polite">
          <span className="sp4-toast-text">{banner.text}</span>
          <button type="button" className="sp4-toast-x" aria-label="Dismiss"
                  onClick={() => setBanner(null)}>×</button>
        </div>
      )}

      {canRepair && (
        <RepairReportForm
          open={formOpen}
          items={formItems}
          defaultOutcome={seedOutcome}
          busy={busy}
          error={formError}
          onCancel={() => setFormOpen(false)}
          onSubmit={handleFile}
        />
      )}

      {/* Channel "all" and State "faulty" are where this panel starts, so
          neither counts as a narrowing the reader needs warning about. */}
      <FilterBar
        label="Channel & state"
        activeCount={(channel !== "all" ? 1 : 0) + (status !== "faulty" ? 1 : 0)}
      >
        <div className="sp4-filter-group">
          <span className="sp4-filter-label">Channel</span>
          {CHANNELS.map(c => (
            <button
              key={c.id}
              type="button"
              className={"sp4-filter-chip" + (channel === c.id ? " sp4-filter-chip--on" : "")}
              aria-pressed={channel === c.id}
              onClick={() => setChannel(c.id)}
            >{c.label}</button>
          ))}
        </div>
        <div className="sp4-filter-divider" />
        <div className="sp4-filter-group">
          <span className="sp4-filter-label">State</span>
          {STATUSES.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={"sp4-filter-chip" + (status === v ? " sp4-filter-chip--on" : "")}
              aria-pressed={status === v}
              onClick={() => setStatus(v)}
            >{label}</button>
          ))}
        </div>
      </FilterBar>

          {error ? (
            <div className="sp4-state" role="alert">
              <div className="sp4-state-title">Probe health unavailable</div>
              <p className="sp4-state-body">{error}</p>
              <button type="button" className="sp4-state-btn" onClick={onReload}>Try again</button>
            </div>
          ) : loading && !data ? (
            // The screen's own loading row, not a bespoke one. The wait is real
            // — the server scans a month of telemetry — so the spinner keeps a
            // short line beside it rather than leaving a bare disc spinning
            // with no account of why.
            <div className="sp4-loading">
              <div className="sp4-spinner" />
              Reading the last 30 days…
            </div>
          ) : !rows.length ? (
            <div className="sp4-state">
              <div className="sp4-state-title">
                {status === "faulty" ? "Nothing needs attention" : "No units match"}
              </div>
              <p className="sp4-state-body">
                {status === "faulty"
                  ? "No probe, sensor or channel is faulty under this filter."
                  : "Widen the channel or state filter to see more units."}
              </p>
            </div>
          ) : (
            <>
              <div className="sp4-table-scroll sp4-ph-scroll sp4-keep-table">
                <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
                  <thead>
                    <tr>
                      {canRepair && (
                        <th className="sp4-th--check">
                          {/* A NATIVE checkbox, unlike UserAdminPanel's ARIA
                              buttons. That idiom is right there, where the
                              control wraps a whole labelled row; here the cell
                              is a bare box in a table, and native brings
                              keyboard focus, Space, accent-color and — the
                              deciding one — a real `indeterminate`. The ARIA
                              button would need aria-checked="mixed" plus a
                              hand-painted third visual state. */}
                          <input
                            type="checkbox"
                            className="sp4-check"
                            aria-label="Select every unit shown"
                            checked={selectedRows.length > 0 && selectedRows.length === rows.length}
                            ref={(el) => {
                              if (el) el.indeterminate =
                                selectedRows.length > 0 && selectedRows.length < rows.length;
                            }}
                            onChange={(e) => setPicked(
                              e.target.checked ? new Set(rows.map((r) => r.vehicleId)) : new Set()
                            )}
                          />
                        </th>
                      )}
                      <th className="sp4-th--left sp4-th--pin">Unit Reg</th>
                      <th className="sp4-th--left sp4-td--action">Action</th>
                      <th className="sp4-th--right">Last report</th>
                      <th className="sp4-th--right">Fuel now</th>
                      <th className="sp4-th--left">Fuel probe</th>
                      <th className="sp4-th--right">Last worked</th>
                      <th className="sp4-th--right">Last reading</th>
                      <th className="sp4-th--left">Fuel sensor</th>
                      <th className="sp4-th--left">GPS</th>
                      <th className="sp4-th--left">Ignition</th>
                      <th className="sp4-th--right">Odometer</th>
                      <th className="sp4-th--right">Engine hrs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.pageRows.map(r => (
                      <ProbeRow
                        key={r.vehicleId}
                        r={r}
                        live={liveByPlate.get(r.plate)}
                        canRepair={canRepair}
                        checked={picked.has(r.vehicleId)}
                        reported={openByVehicle?.has(r.vehicleId) ?? false}
                        isSelected={selectedId === r.vehicleId}
                        onToggle={toggleRow}
                        onOpen={openRow}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePager pager={pager} label="Probe pages" />
        </>
      )}
    </section>
  );
}
