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

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import TablePager, { usePager } from "./TablePager";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import {
  PROBE_STATE_LABEL, CHANNEL_STATE_LABEL, UNKNOWN_WHY,
} from "../../api/probeHealth";
import { downloadProbeCsv } from "../../utils/probeReport";
import { probeHealthDoc } from "../../lib/reportDocs";
import { fleetListMap } from "../../lib/probeHealthReport";
import { readFleetWorkbook, builtInFleetList } from "../../lib/fleetListFile";
import { useFleetList } from "../../hooks/useFleetList";
import { fleetListFileLink, MAX_FLEET_FILE_BYTES } from "../../api/fleetList";
import "./ProbeFleetList.css";
import { makeReportDoc } from "../../api/reports";
import { saveFile } from "../../api/tripReport";
import { savePdfAsJpeg } from "../../api/pdfJpeg";
import { ORG_CODE_BY_COMPANY } from "../../api/org";
import { useCompanies } from "../../context/AppContext";
import JpegButton, { PreviewButton } from "../shared/JpegButton";
import { usePdfPreview } from "../../hooks/usePdfPreview";
import PdfPreview from "../shared/PdfPreview";
import { useReportEditor } from "../screens/ReportEditor";
import TableToolbar from "./TableToolbar";
import FlagRepairDialog from "./FlagRepairDialog";
import { categoriesForProbeRow } from "../../api/repairWorkflow";
import { usePermissions } from "../../hooks/usePermissions";
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
  if (!Number.isFinite(ms)) return "-";
  const h = ms / 3600000;
  if (h < 1)  return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${(h / 24).toFixed(0)}d ago`;
};

/*
 * Last worked and Last report as lines (operator, 2026-11-21: "last worked
 * we can use line for visuals", "add a line on the last report"). The
 * "Last reading" column was taken off the same day. The line is the 30 days the server reads, now at its right
 * end; the coloured stretch runs from the last time to now, so a long red run is
 * a long-dead probe or tracker. Green under an hour, amber under a day,
 * red past that; nothing in the window is red end to end. The words stay beside it.
 */
const SINCE_WINDOW_MS = 30 * 24 * 3600000;
function SinceLine({ at }) {
  const ms = at ? Date.now() - new Date(at).getTime() : Infinity;
  const tone = !Number.isFinite(ms) ? "crit" : ms < 3600000 ? "ok" : ms < 24 * 3600000 ? "warn" : "crit";
  // At least a sliver, so a probe that worked a minute ago still shows its mark.
  const gap = Number.isFinite(ms) ? Math.min(100, Math.max(3, (ms / SINCE_WINDOW_MS) * 100)) : 100;
  return (
    <span className={`sp4-ph-since sp4-ph-since--${tone}`}>
      <span className="sp4-ph-since__line" aria-hidden="true">
        <span className="sp4-ph-since__gap" style={{ inlineSize: `${gap}%` }} />
      </span>
      <span className="sp4-ph-since__words">{ago(at)}</span>
    </span>
  );
}


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
  <span className={`sp4-pill sp4-pill--${PILL[state] ?? "none"}`} title={state === "UNKNOWN" ? UNKNOWN_WHY : undefined}>{label ?? state ?? "-"}</span>
);

/*
 * One form per status column (operator, 2026-11-21: "status chips of
 * different types across columns to avoid duplication"). Four filled pills
 * side by side read as one run of chips, so the colour keeps its meaning
 * (green working, amber warning, red fault, grey unknown) and the form tells
 * the columns apart: Fuel probe keeps the filled pill (the column the table
 * is for), Fuel sensor an icon and a short word, GPS a satellite and word, Ignition a word
 * on a short bar.
 */
const TONE = { con: "ok", inc: "crit", warn: "warn", none: "none" };
const Mark = ({ form, tone = "none", label, icon, title }) => (
  <span className={`sp4-ph-st sp4-ph-st--${form} sp4-ph-st--${tone}`} title={title}>
    {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
    {label}
  </span>
);
// The icon in its tone with a short word beside it (operator, 2026-11-21:
// "along the icon we can say OK or Warn"); the full state is the tooltip.
const SensorIcon = ({ tone, icon, word, label, title }) => (
  <span className={`sp4-ph-st sp4-ph-st--glyph sp4-ph-st--${tone}`} title={title ?? label}>
    <i className={`ti ${icon}`} aria-hidden="true" />
    <span aria-hidden="true">{word}</span>
    <span className="sp4-ph-sr">{label}</span>
  </span>
);
const channelMark = (form, icon, ch) => (
  <Mark form={form} icon={icon} tone={TONE[PILL[ch?.state] ?? "none"]}
        label={CHANNEL_STATE_LABEL[ch?.state] ?? ch?.state ?? "-"}
        title={ch?.state === "UNKNOWN" ? UNKNOWN_WHY : undefined} />
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
 * That is the whole design constraint. `reported` and `isSelected`
 * are booleans the parent computes, rather than the Set and the id being
 * handed down to be searched here — a Set prop changes identity on every
 * selection and would defeat the memo for every row at once. `onOpen` is
 * useCallback-stable, and `onOpen` takes the row so the parent
 * builds the payload without a closure per row.
 *
 * `r` is stable between fetches. `live` is NOT — `vehicleReadings` builds a
 * new object every frame — so the comparator reads the two fields this row
 * actually renders instead of trusting identity.
 */
const ProbeRow = memo(
  function ProbeRow({ r, reported, isSelected, onOpen, tickable, ticked, onTick }) {
    return (
      <tr
        className={"sp4-tr sp4-tr--probe" + (isSelected ? " sp4-tr--selected" : "")}
        // Same drill-in the grid had: a row opens the last hour
        // of readings for that unit. Losing it in the merge
        // would have cost the one thing health cannot show —
        // the individual pings behind a verdict.
        onClick={() => onOpen(r)}
      >
        <td className="sp4-td--left sp4-td--pin">
          <span className="sp4-ph-unit">
            {/* Ticks the unit for the selection bar; the row itself still
                opens the unit, so the box keeps its click to itself. */}
            {tickable && (
              <input
                type="checkbox" className="sp4-ph-tick"
                checked={ticked}
                onChange={() => onTick(r.vehicleId)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${r.plate}`}
              />
            )}
            <span>
              <span className="sp4-reg">{r.plate}</span>
              <div className="sp4-muted">{r.deviceId ?? "-"}</div>
              {/* A repair already open on the unit. It sat in the Action
                  column, taken off on 2026-11-21 (operator: "remove the
                  column for action"), so it moved under the plate. */}
              {reported && <div className="sp4-ph-reported">Reported</div>}
            </span>
          </span>
        </td>
        {/* The same 30-day line as Last worked (operator, 2026-11-21: "add a
            line on the last report"): the coloured stretch is the time since
            the tracker last reported. */}
        <td className="sp4-td--right"><SinceLine at={r.lastReportedAt} /></td>
        <td className="sp4-td--left">
          <Pill state={r.fuelProbe?.state} label={PROBE_STATE_LABEL[r.fuelProbe?.state]} />
        </td>
        <td className="sp4-td--right"><SinceLine at={r.fuelProbe?.lastAliveAt} /></td>
        <td className="sp4-td--left">
          {/* An icon alone, coloured, in place of a chip (operator,
              2026-11-21), with OK, Warn or None beside it. A shape per state
              as well as a colour; the full state is the tooltip and label.
              The calibrated count stays in the tooltip and the CSV. */}
          {!r.fuelSensor?.fitted
            ? <SensorIcon tone="none" icon="ti-circle-dashed" word="None" label="Not configured" />
            : r.fuelSensor.uncalibrated
              ? <SensorIcon tone="warn" icon="ti-alert-triangle" word="Warn" label="Uncalibrated" />
              : <SensorIcon tone="ok" icon="ti-circle-check" word="OK" label="Calibrated"
                  title={`Calibrated: ${r.fuelSensor.calibrationPoints}-point calibration table${r.fuelSensor.parameter ? ` on ${r.fuelSensor.parameter}` : ""}`} />}
        </td>
        <td className="sp4-td--left">
          {channelMark("icon", "ti-satellite", r.channels?.gps)}
        </td>
        <td className="sp4-td--left">
          {channelMark("rule", null, r.channels?.ignition)}
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
    a.reported === b.reported &&
    a.isSelected === b.isSelected &&
    a.onOpen === b.onOpen &&
    a.tickable === b.tickable &&
    a.ticked === b.ticked &&
    a.onTick === b.onTick,
);

export default function ProbeHealthPanel({
  search = "", data, loading, error, onReload, onSelect, selectedId,
  // Which units already have a repair open, for the Reported mark. Filing one
  // happens in the unit's sidebar (ProbeReportActions, below).
  openByVehicle,
}) {
  // The "Fuel now" column, the one live reading merged in per row, was taken
  // off on 2026-11-21 (operator: "remove the column for fuel now"), so the
  // table reads probe health alone and no longer re-renders on each frame.
  const { orgId } = useFleetLiveShared();
  const [channel, setChannel] = useState("all");
  // Opens on the fault list. A list somebody has to filter to reach is a list
  // they stop reaching for.
  const [status,  setStatus]  = useState("faulty");
  // Trucks only, as West Kenya's sheet (WSK TRUCKS FAULTY PROBE REPORT). Shown
  // once the server marks trucks on the rows.
  const [kind,    setKind]    = useState("all");
  const knowsTrucks = useMemo(() => (data?.rows ?? []).some((r) => typeof r.truck === "boolean"), [data]);
  const trucksOnly = knowsTrucks && kind === "trucks";

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    const chan = CHANNELS.find(c => c.id === channel) ?? CHANNELS[0];
    return all.filter((r) => {
      if (trucksOnly && !r.truck) return false;
      if (q && !`${r.plate} ${r.name ?? ""} ${r.deviceId ?? ""}`.toLowerCase().includes(q)) return false;
      // "All" asks whether ANYTHING on the unit is wrong; a named channel asks
      // only about that one, so a unit with a dead probe does not surface under
      // an Ignition filter.
      const bad = chan.bad(r);
      if (status === "faulty")  return bad;
      if (status === "working") return !bad;
      return true;
    });
  }, [data, search, channel, status, trucksOnly]);
  const pager = usePager(rows, `${search}|${channel}|${status}|${trucksOnly}`);

  /* Stable, so the memoised row does not see a new function every render.
     Takes the ROW rather than a pre-built payload for the same reason: a
     closure per row would change identity on every pass. */
  const openRow = useCallback((r) => {
    onSelect?.({
      vehicleId: r.vehicleId, vehicleName: r.plate,
      type: "probe_row", detail: "Probes",
    });
  }, [onSelect]);

  /*
   * Several units at once (operator, 2026-11-21: "select multiple probes").
   * Kept by vehicle id across pages and filters, like the Alerts selection,
   * and pruned to the units the latest read still lists. What it does: flag
   * every picked unit for repair in one go, through the same dialog one unit
   * uses. Only for a role that may flag.
   */
  const { can } = usePermissions();
  const mayFlag = can("repair:flag");
  const [picked, setPicked] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNote, setBulkNote] = useState(null);
  const tick = useCallback((id) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    const live = new Set((data?.rows ?? []).map((r) => r.vehicleId));
    setPicked((cur) => {
      const kept = [...cur].filter((id) => live.has(id));
      return kept.length === cur.size ? cur : new Set(kept);
    });
  }, [data]);
  useEffect(() => {
    if (!bulkNote) return undefined;
    const t = setTimeout(() => setBulkNote(null), 6000);
    return () => clearTimeout(t);
  }, [bulkNote]);
  const pageIds = pager.pageRows.map((r) => r.vehicleId);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const pageSome = pageIds.some((id) => picked.has(id));
  const togglePage = () => setPicked((cur) => {
    const next = new Set(cur);
    if (pageAll) pageIds.forEach((id) => next.delete(id)); else pageIds.forEach((id) => next.add(id));
    return next;
  });
  const shownIds = new Set(rows.map((r) => r.vehicleId));
  const offView = [...picked].filter((id) => !shownIds.has(id)).length;
  // A unit with a repair already open is refused by the server; it stays
  // picked but is left out of the flag, and the bar says so.
  const flaggable = [...picked].filter((id) => !openByVehicle?.has(id));
  const alreadyOpen = picked.size - flaggable.length;
  const bulkCategories = (() => {
    const c = [...new Set((data?.rows ?? []).filter((r) => flaggable.includes(r.vehicleId)).flatMap(categoriesForProbeRow))];
    return c.length ? c : ["fuel_probe"];
  })();

  const filterNote = useMemo(() => {
    const chan = CHANNELS.find(c => c.id === channel)?.label ?? "All";
    const st = status === "faulty" ? "not working" : status === "working" ? "working" : "all states";
    return `${trucksOnly ? "Trucks · " : ""}${chan} · ${st}${search.trim() ? ` · matching "${search.trim()}"` : ""} · ${rows.length} units`;
  }, [channel, status, search, rows.length, trucksOnly]);

  // The filter, in the filename. Both exports carry ONLY the filtered rows, so
  // three downloads of three different filters are three different documents —
  // and all three landing in one folder as "probes.csv" would be
  // indistinguishable the moment they leave the screen that made them.
  const filenameSlug = useMemo(() => {
    const parts = ["probes"];
    if (trucksOnly) parts.push("trucks");
    if (channel !== "all") parts.push(channel.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase());
    if (status !== "all")  parts.push(status === "faulty" ? "not-working" : "working");
    return parts.join("-");
  }, [channel, status, trucksOnly]);

  // The Probe & Sensor Health report, on the report template (lib/reportDocs):
  // the table's filtered rows, as the CSV, with no Action column.
  const { activeCompany } = useCompanies();
  const orgCode = activeCompany?.code ?? ORG_CODE_BY_COMPANY[activeCompany?.id] ?? null;
  const fleet = activeCompany?.name ?? orgCode ?? "Fleet";
  // Drivers and statuses: the fleet Excel uploaded for the organisation, kept by the server for every
  // user (operator, 13 Nov 2026), else the list built in
  const mayUpload = can("vehicle:update");
  const shared = useFleetList(orgId);
  const uploaded = shared.data?.current ?? null;
  const history = shared.data?.history ?? [];
  // The built-in list is Menengai's alone: another organisation reads only a file uploaded for it
  const builtIn = builtInFleetList(orgCode);
  const fleetList = useMemo(() => fleetListMap(uploaded?.entries ?? builtIn ?? {}), [uploaded, builtIn]);
  const fileInput = useRef(null);
  const [listNote, setListNote] = useState(null);
  const busy = Boolean(listNote?.busy) || shared.saving;
  const takeFleetFile = async (f) => {
    if (!f) return;
    if (f.size > MAX_FLEET_FILE_BYTES) {
      setListNote({ error: `The file is over ${MAX_FLEET_FILE_BYTES / 1024 / 1024} MB, the most that can be kept.` });
      return;
    }
    setListNote({ busy: true });
    let got;
    try {
      got = await readFleetWorkbook(f);
      if (!Object.keys(got.entries).length) throw new Error("no sheet with TRUCK NO and DRIVER NAME columns was found");
    } catch (err) {
      setListNote({ error: `The file could not be read: ${err?.message ?? err}` });
      return;
    }
    try {
      const saved = await shared.upload({ file: f, fileName: f.name, entries: got.entries, sheets: got.sheets, conflicts: got.conflicts });
      const count = saved?.current?.count ?? Object.keys(got.entries).length;
      setListNote({ words: `${count} units read from ${got.sheets.length} sheet${got.sheets.length === 1 ? "" : "s"}, saved for everyone in ${fleet}`
        + (got.conflicts.length ? `; ${got.conflicts.length} plate${got.conflicts.length === 1 ? " is" : "s are"} on two sheets, the first kept (${got.conflicts.map((c) => c.plate).join(", ")})` : "") });
    } catch (err) {
      setListNote({ error: `The list could not be saved: ${err?.message ?? err}` });
    }
  };
  // The Excel as it was uploaded, kept in S3: a short-lived link the browser downloads (the server names the file)
  const [fetching, setFetching] = useState(null);
  const downloadList = async (v) => {
    setFetching(v.id);
    try {
      const { url } = await fleetListFileLink(orgId, v.id);
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setListNote({ error: `${v.fileName ?? "The file"} could not be downloaded: ${err?.message ?? err}` });
    } finally {
      setFetching(null);
    }
  };
  const putBack = async () => {
    setListNote(null);
    try { await shared.reset(); } catch (err) { setListNote({ error: `The list could not be changed: ${err?.message ?? err}` }); }
  };
  const when = (ms) => new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const sheet = (landscape = false) => probeHealthDoc(rows, { note: filterNote, fleet, trucks: trucksOnly, orgCode, landscape, fleetList });
  const editor = useReportEditor({ orgId, source: rows, build: sheet });
  const makePdf = (landscape) => (editor.edited ? editor.make(landscape) : makeReportDoc({ orgId, landscape, doc: sheet(landscape) }));
  const preview = usePdfPreview(makePdf);
  const [file, setFile] = useState({ busy: false, error: null });
  const save = async (as, landscape = false) => {
    if (file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makePdf(landscape);
      if (as === "jpeg") await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === "jpeg" ? "JPEG" : "PDF"} could not be made: ${err?.message ?? err}` });
    }
  };
  const ready = Boolean(data && orgId);

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
        onReload={() => editor.guard("Reload the probes", onReload)}
        onCsv={() => downloadProbeCsv(rows, { filenameSlug, fleetList })}
        disabled={!rows.length}
        actions={ready && <>
          {editor.button}
          {file.busy ? <span className="rpt-sub">{file.busy === "jpeg" ? "Making the JPEG…" : "Making the PDF…"}</span>
            : file.error ? <span className="rpt-warn">{file.error}</span> : null}
          <JpegButton onSave={(landscape) => save("jpeg", landscape)} disabled={Boolean(file.busy)} title="Probe & Sensor Health as an image" />
          <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save("pdf", landscape)} disabled={Boolean(file.busy)} title={`Probe & Sensor Health: ${rows.length} units`} />
          <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
        </>}
      />
      {/* The drivers and statuses the report's Driver and Status columns read: upload the fleet Excel before making it */}
      <div className="pfl" role="group" aria-label="Fleet list for the Driver and Status columns">
        <i className="ti ti-file-spreadsheet pfl__icon" aria-hidden="true" />
        <p className="pfl__what">
          <span className="pfl__label">Drivers and status</span>
          {shared.isLoading ? (
            <span className="pfl__src">Reading the organisation&apos;s list…</span>
          ) : uploaded ? (
            <span className="pfl__src"><b>{uploaded.fileName}</b>, {uploaded.count} units, uploaded {when(uploaded.at)}{uploaded.by ? ` by ${uploaded.by}` : ""}</span>
          ) : builtIn ? (
            <span className="pfl__src"><b>Built-in fleet list</b>, {Object.keys(builtIn).length} units from MORL_FLEET of 13 Nov 2026</span>
          ) : (
            <span className="pfl__src pfl__src--none">No fleet list for this organisation.{mayUpload ? " Upload one to add the Driver and Status columns." : ""}</span>
          )}
          {shared.error && <span className="pfl__src pfl__src--error">The organisation&apos;s list could not be read, so the built-in one is used.</span>}
        </p>
        {mayUpload && (
        <div className="pfl__acts">
          <input ref={fileInput} type="file" hidden tabIndex={-1}
                 accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; takeFleetFile(f); }} />
          <button type="button" className="sp4-ghost-btn pfl__btn" disabled={busy || editor.edited}
                  aria-busy={busy} onClick={() => fileInput.current?.click()}
                  title={editor.edited ? "Discard your edits to read a new list" : `Upload the fleet Excel (laid out as MORL_FLEET.xlsx): its drivers and statuses are used for everyone in ${fleet}`}>
            <i className={`ti ${busy ? "ti-loader-2 pfl__spin" : "ti-upload"}`} aria-hidden="true" />
            {listNote?.busy ? "Reading…" : shared.saving ? "Saving…" : "Upload fleet Excel"}
          </button>
          {uploaded?.file && (
            <button type="button" className="sp4-ghost-btn pfl__btn" disabled={fetching === uploaded.id} aria-busy={fetching === uploaded.id}
                    onClick={() => downloadList(uploaded)} title={`Download ${uploaded.fileName} as it was uploaded`}>
              <i className={`ti ${fetching === uploaded.id ? "ti-loader-2 pfl__spin" : "ti-download"}`} aria-hidden="true" />
              Download
            </button>
          )}
          {uploaded && (
            <button type="button" className="sp4-ghost-btn pfl__btn" disabled={busy || editor.edited} onClick={putBack}
                    title="Stop using the uploaded list; it stays on record">
              {builtIn ? "Use built-in list" : "Stop using this list"}
            </button>
          )}
        </div>
        )}
        {history.length > 1 && (
          <details className="pfl__history">
            <summary>Earlier lists ({history.length - 1})</summary>
            <ul>
              {history.slice(1).map((h) => (
                <li key={h.id}>
                  {h.reset ? "Back to the built-in list" : `${h.fileName}, ${h.count} units`}, {when(h.at)}{h.by ? ` by ${h.by}` : ""}
                  {mayUpload && h.file && (
                    <button type="button" className="pfl__link" disabled={fetching === h.id} aria-busy={fetching === h.id}
                            onClick={() => downloadList(h)} aria-label={`Download ${h.fileName}, uploaded ${when(h.at)}`}>
                      {fetching === h.id ? "Downloading…" : "Download"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        {(listNote?.words || listNote?.error) && (
          <p className={`pfl__note${listNote.error ? " pfl__note--error" : ""}`} role="status">{listNote.error ?? listNote.words}</p>
        )}
      </div>
      {editor.overlay}
      {preview.state && <PdfPreview state={preview.state} title="Probe & sensor health" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}

      {/* Channel "all" and State "faulty" are where this panel starts, so
          neither counts as a narrowing the reader needs warning about. */}
      <FilterBar
        label="Channel & state"
        activeCount={(channel !== "all" ? 1 : 0) + (status !== "faulty" ? 1 : 0) + (trucksOnly ? 1 : 0)}
      >
        {knowsTrucks && (
          <>
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Vehicles</span>
              {[["all", "All"], ["trucks", "Trucks"]].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={"sp4-filter-chip" + (kind === v ? " sp4-filter-chip--on" : "")}
                  aria-pressed={kind === v}
                  onClick={() => setKind(v)}
                >{label}</button>
              ))}
            </div>
            <div className="sp4-filter-divider" />
          </>
        )}
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
              {mayFlag && picked.size > 0 && (
                <div className="sp4-ph-selbar" role="region" aria-label="Selected units">
                  <span className="sp4-ph-selbar__n">
                    <b>{picked.size}</b> selected
                    {offView > 0 && <span className="sp4-muted">, {offView} hidden by the filter</span>}
                    {alreadyOpen > 0 && <span className="sp4-muted">, {alreadyOpen} already reported</span>}
                  </span>
                  <span className="sp4-ph-selbar__acts">
                    <button type="button" className="sp4-act-btn sp4-act-btn--warn"
                            disabled={!flaggable.length} onClick={() => setBulkOpen(true)}
                            title={flaggable.length ? `Flag ${flaggable.length} for repair in one go` : "Every selected unit already has a repair open"}>
                      Flag {flaggable.length} for repair
                    </button>
                    <button type="button" className="sp4-ghost-btn" onClick={() => setPicked(new Set())}>Clear</button>
                  </span>
                </div>
              )}
              {bulkNote && (
                <div className="sp4-toast sp4-toast--ok" role="status" aria-live="polite">
                  <span className="sp4-toast-text">{bulkNote}</span>
                  <button type="button" className="sp4-toast-x" aria-label="Dismiss" onClick={() => setBulkNote(null)}>×</button>
                </div>
              )}
              {bulkOpen && (
                <FlagRepairDialog
                  orgId={orgId}
                  open
                  presetVehicleIds={flaggable}
                  presetCategories={bulkCategories}
                  onClose={() => setBulkOpen(false)}
                  onFlagged={(_, route) => {
                    setBulkNote(`${flaggable.length} unit${flaggable.length === 1 ? "" : "s"} flagged and sent to ${route === "workshop" ? "the workshop" : route === "both" ? "ControlTech and the workshop" : "ControlTech"}.`);
                    setPicked(new Set());
                    onReload?.();
                  }}
                />
              )}
              <div className="sp4-table-scroll sp4-ph-scroll sp4-keep-table">
                <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
                  <thead>
                    <tr>
                      <th className="sp4-th--left sp4-th--pin">
                        {mayFlag ? (
                          <label className="sp4-ph-unit">
                            <input
                              type="checkbox" className="sp4-ph-tick"
                              checked={pageAll} onChange={togglePage}
                              ref={(el) => { if (el) el.indeterminate = pageSome && !pageAll; }}
                              aria-label="Select every unit on this page"
                            />
                            <span>Unit Reg</span>
                          </label>
                        ) : "Unit Reg"}
                      </th>
                      <th className="sp4-th--right">Last report</th>
                      <th className="sp4-th--left">Fuel probe</th>
                      <th className="sp4-th--right">Last worked</th>
                      <th className="sp4-th--left">Fuel sensor</th>
                      <th className="sp4-th--left">GPS</th>
                      <th className="sp4-th--left">Ignition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.pageRows.map(r => (
                      <ProbeRow
                        key={r.vehicleId}
                        r={r}
                        reported={openByVehicle?.has(r.vehicleId) ?? false}
                        isSelected={selectedId === r.vehicleId}
                        onOpen={openRow}
                        tickable={mayFlag}
                        ticked={picked.has(r.vehicleId)}
                        onTick={tick}
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

/**
 * Repairs on ONE unit, from its sidebar. Every repair runs through the
 * Workshop workflow (2026-10-21): the old Fixing / Needs a spare / Cannot fix
 * buttons made jobs no ticket, damage check or verification would see.
 *
 *   Flag for repair    the Flag dialog with this unit and "Fuel probe" chosen;
 *                      ControlTech claims it from there.
 *
 * "Fixed on the spot" was taken off this sidebar on 2026-10-27 (operator):
 * every repair now starts as a flag.
 */
export function ProbeReportActions({ row, orgId, onFiled }) {
  const { can } = usePermissions();
  const [flagOpen, setFlagOpen] = useState(false);
  const [banner, setBanner] = useState(null);

  // The receipt clears itself.
  useEffect(() => {
    if (!banner) return undefined;
    const t = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!row) return null;
  if (!can("repair:flag")) return null;
  return (
    <>
      <div className="sp4-probe-report">
        <button type="button" className="sp4-act-btn sp4-act-btn--warn" onClick={() => setFlagOpen(true)}>Flag for repair</button>
      </div>
      {banner && (
        <div className="sp4-toast sp4-toast--ok" role="status" aria-live="polite">
          <span className="sp4-toast-text">{banner}</span>
          <button type="button" className="sp4-toast-x" aria-label="Dismiss"
                  onClick={() => setBanner(null)}>×</button>
        </div>
      )}
      <FlagRepairDialog
        key={`flag-${row.vehicleId}`}
        orgId={orgId}
        open={flagOpen}
        presetVehicleId={row.vehicleId}
        presetCategories={(() => { const c = categoriesForProbeRow(row); return c.length ? c : ["fuel_probe"]; })()}
        onClose={() => setFlagOpen(false)}
        onFlagged={(_, route) => {
          setBanner(`${row.plate} flagged and sent to ${route === "workshop" ? "the workshop" : route === "both" ? "ControlTech and the workshop" : "ControlTech"}.`);
          onFiled?.();
        }}
      />
    </>
  );
}
