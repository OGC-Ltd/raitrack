/*
 * Reports (operator, 1 Nov 2026): four fleet reports on one page, each for a
 * period the reader picks, by the organisation's groups where it has them.
 *
 *   Driver conduct       harsh acceleration, harsh braking, no seatbelt and on phone, per vehicle
 *   Night driving        distance covered in the night hours (19:00–05:00 unless changed)
 *   Overspeeding         overspeeds lasting more than 5 seconds unbroken, and their distance
 *   Vehicle utilisation  every vehicle's distance, time moving and fuel, stationary ones included
 *
 * The figures come from records the server already keeps (api/fleetReports);
 * how each report reads as a table is lib/reportTables, so the screen, the PDF
 * and the CSV are the same rows. The PDF is the End of shift letterhead (lib/letterhead).
 *
 * A report runs when Run is pressed, not on every change: the distance
 * reports read every unit's day of readings, which is a minute or two for a
 * large fleet, and a half-chosen period should not start that.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useCompanies } from '../../context/AppContext';
import { ORG_CODE_BY_COMPANY } from '../../api/org';
import { loadHarshEvents, loadDashcamAlarms, loadOverspeeds, loadDistances } from '../../api/fleetReports';
import { groupsFor, scopeUnits } from '../../lib/fleetGroups';
import {
  presetRange, nightWindows, behaviourRows, overspeedRows, nightRows, utilisationRows, sections, RATED_SECTIONS,
  NIGHT, hourLabel, periodWords as periodText, fleetDay, dayStart,
} from '../../lib/fleetReports';
import { addDays } from '../../lib/dayRange';
import { REPORTS, csvTable, RATES, DEFAULT_RATE, isFigure, shownColumns, overStandard } from '../../lib/reportTables';
import { reportHtml } from '../../lib/reportLetterhead';
import { saveLetterheadPdf, letterheadLogos } from '../../api/letterheadPdf';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import { IncidentDialog, LoggedIncidents } from './OperatorIncidents';
import { upsert, remove } from '../../lib/operatorLog';
import * as conductApi from '../../api/driverConduct';
import { moveBrowserFollowUp } from '../../lib/conductMove';
import { ActionDialog, FollowUpPanel } from './FollowUp';
import { casesFromRun, periodCases } from '../../lib/followUp';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { loadEndOfShiftDoc, downloadEditedEndOfShift, makeEditedEndOfShift } from '../../api/endOfShiftReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { isEdited as isDocEdited, pdfDoc } from '../../lib/shiftDoc';
import ShiftDocument from './ShiftDocument';
import { loadMovementReport, downloadEditedMovementReport, makeEditedMovementReport } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import ReportIcon from '../shared/ReportIcon';
import PdfPages from '../shared/PdfPages';
import DateRangePicker, { pickedText } from '../layout/DateRangePicker';
import { reportKeysFor, useCurrentReport } from '../../lib/reportNav';
import { directionWords, byFleetList, splitsByType, STATES, TINT, stamp, applyEdits, pdfRequests, isEdited, isMoving, isLoading, locationChanged, LAST_HOURS, MAX_MOVEMENT_DAYS, movementWindows, windowsProblem, vehicleTypes, defaultTypes, onlyTypes } from '../../lib/movementReport';
import '../body/SensorPanel.css';
import './FuelReportScreen.css';
import './ReportsScreen.css';
import './OperatorIncidents.css';

const DAY = 86_400_000;
/** The reports that can be made for one unit (operator, 2 Nov 2026: Overspeeding "by the unit"). */
const UNIT_REPORTS = new Set(['overspeed']);

/** The reports drawn here that also save as a JPEG; Shift and Movements always do. */
const JPEG_REPORTS = new Set(['behaviour', 'overspeed', 'utilisation']);

/** The End of Shift and Movements tabs: made by the server, not from REPORTS. */
const SHIFT = 'shift';
const MOVEMENTS = 'movements';
const SERVER_TABS = {
  [SHIFT]: { label: 'Shift' },
  [MOVEMENTS]: { label: 'Movements' },
};


/** The days and hours a report's period stands for, for the picker. */
function daysOf(key, span, night) {
  if (key === 'night') return { fromDay: fleetDay(span.from), toDay: fleetDay(Math.max(span.from, span.to - 1 - 12 * HOUR_MS)), start: night.start, end: night.end || 24 };
  return { fromDay: fleetDay(span.from), toDay: fleetDay(Math.max(span.from, span.to - 1)), start: 0, end: 24 };
}

const spanFor = (key) => {
  const id = (REPORTS[key] ?? REPORTS.behaviour).preset;
  return { id, ...presetRange(id) };
};


/** The longest period the server makes it for (fleet-server END_OF_SHIFT_MAX_DAYS). */
const SHIFT_MAX_DAYS = 7;
/** End-of-shift sheets and their edits, by organisation, while this browser tab is open. */
const shiftKept = new Map();

/**
 * The shift's period from days and hours, as Movements picks them (operator,
 * 2 Nov: "let it be like what we have in movements"): the first day at the
 * start hour to the last day at the end hour, past midnight when the end is at
 * or before the start, and up to now when it would run past it. Today 00:00 to
 * 24:00 is the default: the shift so far.
 */
const SHIFT_TODAY = (today) => ({ fromDay: today, toDay: today, start: 0, end: 24 });
function shiftPeriod(d, now = Date.now()) {
  const from = dayStart(d.fromDay) + d.start * HOUR_MS;
  const to = dayStart(d.toDay) + (d.end > d.start ? d.end : d.end + 24) * HOUR_MS;
  return { from, to: Math.min(to, now), live: to >= now };
}
const HOUR_MS = 3_600_000;

/** Why a period cannot be made, or null. */
function shiftProblem(orgId, span, now = Date.now()) {
  return !orgId ? 'Waiting for the organisation to load'
    : span.from >= now ? 'These hours have not begun yet'
    : !(span.to > span.from) ? 'The period ends before it starts'
    : span.to > now + 60_000 ? 'The period cannot end in the future'
    : span.to - span.from > SHIFT_MAX_DAYS * DAY ? `${SHIFT_MAX_DAYS} days at most for this report`
    : null;
}

/**
 * The end-of-shift report (moved here from the sidebar, operator 1 Nov 2026).
 * It opens made: today from midnight up to the current time, painted as the
 * page it prints as (ShiftDocument), every text on it editable. Picking
 * another period, a week at most, makes it again; Download PDF has the server
 * draw the sheet as edited (operator, 2 Nov 2026).
 */
/** An A4 page at full size, px: the sheet is 210 mm wide and reads a page at a time. */
const SHEET_PX = { width: 794, height: 1123 };

/**
 * The shift sheet as it sits on the page (operator, 2 Nov: "zoomed out by
 * default but when I need to edit it I will click on it and fully open on a
 * dim layer then edit it"): scaled down so a whole A4 page is in view, and
 * not editable here. A click, or Enter, opens it at full size on the dimmed
 * page to edit; Done, Escape or a click on the dim layer puts it back with
 * the edits on it.
 *
 * A sheet longer than the view is cut where the view ends, faded, rather than
 * scrolled (operator: "cut it to about a section"): opening it shows all of
 * it, and Download PDF prints all of it, cut here or not.
 */
function ShiftSheet({ doc, version, onChange }) {
  const deskRef = useRef(null);
  const [fit, setFit] = useState(null);           // { scale, height }: the view, in the sheet's own px
  const [cut, setCut] = useState(false);
  const sheetRef = useRef(null);
  const [open, setOpen] = useState(false);
  // Opened, it is zoomed out too (operator, 2 Nov: "zoom-out the shift report
  // when open full report"): a whole page in the window's height, the rest a
  // scroll away, every text still editable.
  const openRef = useRef(null);
  const [openScale, setOpenScale] = useState(1);
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const el = openRef.current;
      if (!el) return;
      setOpenScale(Math.min(1, (el.clientHeight - 24) / SHEET_PX.height, el.clientWidth / SHEET_PX.width));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  useEffect(() => {
    const measure = () => {
      const el = deskRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const scale = Math.min(1, w / SHEET_PX.width, h / SHEET_PX.height);
      setFit({ scale, height: h / scale });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // Cut when the sheet runs past the view
  useEffect(() => {
    if (fit && sheetRef.current) setCut(sheetRef.current.scrollHeight > fit.height + 1);
  }, [fit, doc, version, open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div className="sdoc-fit" ref={deskRef}>
      {fit != null && (
        <div className={`sdoc-thumb${cut ? ' sdoc-thumb--cut' : ''}`} role="button" tabIndex={0}
             aria-label={cut ? 'Open the full shift report to read and edit it' : 'Open the shift report to edit it'}
             title="Click to open and edit" style={{ zoom: fit.scale, maxHeight: `${fit.height}px` }}
             onClick={() => setOpen(true)}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}>
          <div inert="" ref={sheetRef}>
            <ShiftDocument key={version} doc={doc} onChange={onChange} />
          </div>
          {cut && (
            // Where the sheet is cut: a perforation, and the way to the rest (operator: only "Open the full report")
            <div className="sdoc-tear" aria-hidden="true">
              <span className="sdoc-tear__go">Open the full report <i className="ti ti-arrow-up-right" /></span>
            </div>
          )}
        </div>
      )}
      {open && (
        <div className="sp4-modal-overlay sdoc-open" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sdoc-open__frame" role="dialog" aria-modal="true" aria-labelledby="sdoc-open-title">
            <header className="mvr-pv__head sdoc-open__head">
              <i className="ti ti-file-text mvr-pv__icon" aria-hidden="true" />
              <div className="mvr-pv__what">
                <h2 id="sdoc-open-title" className="mvr-pv__title">Shift report</h2>
                <p className="mvr-pv__facts"><span>Click any text to change it</span></p>
              </div>
              <button type="button" className="sp4-submit-btn frp-run mvr-pv__save" onClick={() => setOpen(false)} autoFocus>
                <i className="ti ti-check" aria-hidden="true" /> Done
              </button>
            </header>
            <div className="sdoc-open__scroll" ref={openRef} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
              <div className="sdoc-open__sheet" style={{ zoom: openScale }}>
                <ShiftDocument key={version} doc={doc} onChange={onChange} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftReport({ orgId }) {
  // Mounted afresh for each organisation (key={orgId}), from what was kept for it.
  const [saved] = useState(() => shiftKept.get(orgId));
  const today = fleetDay(Date.now());
  const [draft, setDraft] = useState(() => saved?.draft ?? SHIFT_TODAY(today));   // the days and hours on the picker
  const [span, setSpan] = useState(() => saved?.span ?? shiftPeriod(saved?.draft ?? SHIFT_TODAY(today)));
  const [run, setRun] = useState(() => (saved ? { status: 'done', original: saved.original } : { status: 'idle' }));
  const [doc, setDoc] = useState(saved?.doc ?? null);
  const [version, setVersion] = useState(0);              // a new sheet: the editable texts start over
  const [confirm, setConfirm] = useState(null);           // { words, go }
  const [pdf, setPdf] = useState({ busy: false, error: null });
  const runId = useRef(0);
  const edited = run.status === 'done' && isDocEdited(run.original, doc);

  const load = async (days) => {
    // A period reaching now is made up to the moment it is asked for.
    const period = shiftPeriod(days);
    setDraft(days);
    setSpan(period);
    if (shiftProblem(orgId, period)) return;
    const id = ++runId.current;
    setRun({ status: 'loading' }); setPdf({ busy: false, error: null });
    try {
      const answer = await loadEndOfShiftDoc({ orgId, from: period.from, to: period.to });
      if (id !== runId.current) return;
      setRun({ status: 'done', original: answer }); setDoc(answer); setVersion((v) => v + 1);
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // Opens made, unless a sheet was kept for this organisation.
  useEffect(() => { if (!saved && orgId) load(draft); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!orgId) return;
    if (run.status === 'done') shiftKept.set(orgId, { draft, span, original: run.original, doc });
    else shiftKept.delete(orgId);
  }, [orgId, draft, span, run, doc]);

  // Closing or reloading the browser tab would lose the edits: the browser asks first.
  useEffect(() => {
    if (!edited) return undefined;
    const warn = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited]);

  // A new period replaces the sheet: with edits on it, ask first.
  const guard = (words, go) => (edited ? setConfirm({ words, go }) : go());
  const pick = (days, words) => guard(words, () => load(days));
  const problem = shiftProblem(orgId, span);
  // What the picker holds, before it is made
  const [picking, setPicking] = useState(null);
  const shown = picking ?? draft;
  const pickingProblem = shiftProblem(orgId, shiftPeriod(shown));

  const download = async () => {
    if (pdf.busy || !doc) return;
    setPdf({ busy: true, error: null });
    try {
      await downloadEditedEndOfShift({ orgId, doc: pdfDoc(doc) });
      setPdf({ busy: false, error: null });
    } catch (err) {
      setPdf({ busy: false, error: `The PDF could not be made: ${err?.message ?? err}` });
    }
  };
  const downloadJpeg = async () => {
    if (pdf.busy || !doc) return;
    setPdf({ busy: 'jpeg', error: null });
    try {
      const { blob, filename } = await makeEditedEndOfShift({ orgId, doc: pdfDoc(doc) });
      await savePdfAsJpeg(blob, filename);
      setPdf({ busy: false, error: null });
    } catch (err) {
      setPdf({ busy: false, error: `The JPEG could not be made: ${err?.message ?? err}` });
    }
  };

  return (
    <>
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        {/* One field for the period: the days on the calendar, the hours under it, as Movements has it */}
        <DateRangePicker
          from={shown.fromDay} to={shown.toDay} today={today} maxDays={SHIFT_MAX_DAYS} spans={[SHIFT_MAX_DAYS]}
          label="Shift period" on
          text={`${pickedText(draft.fromDay, draft.toDay, today)} · ${span.live ? `${hh(draft.start)}–now` : hoursText(draft.start, draft.end)}`}
          onChange={(f, t) => setPicking({ ...shown, fromDay: f, toDay: t })}
        >
          {({ close }) => (
            <>
              <HourWindow start={shown.start} end={shown.end} onChange={(a, b) => setPicking({ ...shown, start: a, end: b })} />
              <div className="mvr-hours__foot">
                {pickingProblem && <span className="rpt-problem" role="status">{pickingProblem}</span>}
                <button type="button" className="sp4-submit-btn frp-run"
                        disabled={run.status === 'loading' || Boolean(pickingProblem)}
                        onClick={() => { close(); setPicking(null); pick(shown, 'Make the report for the new period'); }}>
                  Make report
                </button>
              </div>
            </>
          )}
        </DateRangePicker>
        <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => pick(draft, span.live ? 'Make it again up to now' : 'Make it again')}
                disabled={Boolean(problem) || run.status === 'loading'} title={span.live ? 'Make it again, up to the current time' : 'Make it again'}>
          <i className="ti ti-refresh" aria-hidden="true" /> Refresh
        </button>
        {edited && (
          <button type="button" className="sp4-ghost-btn rpt-log"
                  onClick={() => { setDoc(run.original); setVersion((v) => v + 1); }}>
            Undo edits
          </button>
        )}
        <button type="button" className="sp4-ghost-btn rpt-log" onClick={downloadJpeg}
                disabled={Boolean(pdf.busy) || run.status !== 'done'} aria-busy={pdf.busy === 'jpeg'}
                title="The PDF report as an image">
          <i className="ti ti-photo" aria-hidden="true" /> {pdf.busy === 'jpeg' ? 'Making the JPEG…' : 'JPEG'}
        </button>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={download}
                disabled={Boolean(pdf.busy) || run.status !== 'done'} aria-busy={pdf.busy === true}>
          {pdf.busy === true ? 'Making the PDF…' : 'Download PDF'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
        {pdf.error && <span className="rpt-problem" role="alert">{pdf.error}</span>}
      </div>

      {confirm && (
        <div className="mvr-confirm" role="alertdialog" aria-labelledby="sdoc-confirm-words">
          <span id="sdoc-confirm-words">{confirm.words} and lose your edits?</span>
          <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setConfirm(null)} autoFocus>Keep editing</button>
          <button type="button" className="sp4-submit-btn frp-run mvr-confirm__go"
                  onClick={() => { const { go } = confirm; setConfirm(null); go(); }}>Discard edits</button>
        </div>
      )}

      <div className="sp4-body rpt-body sdoc-desk">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name={SHIFT} />} title="Shift">
            {problem ?? 'Pick the period.'}
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">
            The server is gathering the shift. It takes a few seconds.
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made"
                     action={{ label: 'Try again', onClick: () => load(draft) }}>
            {run.message}
          </EmptyNote>
        )}
        {run.status === 'done' && doc && <ShiftSheet doc={doc} version={version} onChange={setDoc} />}
      </div>
    </>
  );
}

/** Movements tables and their edits, by organisation, while this browser tab is open. */
const movementsKept = new Map();

/** "5 vehicles", or "4 of 5 vehicles" once some are left out. */
function groupWords(g, edits) {
  const kept = g.rows.filter((r) => !edits[r.vehicleId]?.removed).length;
  const all = g.rows.length;
  return `${kept === all ? all : `${kept} of ${all}`} vehicle${all === 1 ? '' : 's'}`;
}

const lastWords = (h) => (h === 1 ? 'Last hour' : `Last ${h} hours`);
// The day's end reads 24:00, so a whole day is 00:00–24:00, not 00:00–00:00
const hh = (h) => (h === 24 ? '24:00' : `${hourLabel(h % 24)}:00`);
/** "07:00–20:00", "20:00–06:00 next day". */
const hoursText = (start, end) => `${hh(start)}–${hh(end)}${end <= start ? ' next day' : ''}`;

/**
 * The hours each day, as a ruler of the day's 24 hours (operator, 2 Nov: "a
 * single date picker ... and select a hour window period"). It works as the
 * calendar above it does: click an hour for that one hour, then a second hour
 * for the span between them, both hours included. Hours that run past
 * midnight (20:00–06:00) are set in the From and To boxes under it.
 */
function HourWindow({ start, end, onChange, label = 'Hours each day' }) {
  const [anchor, setAnchor] = useState(null);
  const lastHour = (end + 23) % 24;
  const inWindow = (h) => (end > start ? h >= start && h < end : h >= start || h < end);
  const click = (h) => {
    if (anchor == null) { setAnchor(h); onChange(h, h + 1); return; }
    onChange(Math.min(anchor, h), Math.max(anchor, h) + 1);
    setAnchor(null);
  };
  const exact = (s, e) => { setAnchor(null); onChange(s, e); };
  const span = ((end - start + 23) % 24) + 1;
  return (
    <div className="mvr-hours" role="group" aria-label={label}>
      <div className="mvr-hours__head">
        <span className="mvr-hours__l">{label}</span>
        <button type="button" className={`drp-chip${start === 0 && end === 24 ? ' drp-chip--on' : ''}`}
                onClick={() => exact(0, 24)}>Whole day</button>
      </div>
      <div className="mvr-hours__ruler">
        {Array.from({ length: 24 }, (_, h) => {
          const cls = ['mvr-hour',
            inWindow(h) && 'mvr-hour--in',
            h === start && 'mvr-hour--lo',
            h === lastHour && 'mvr-hour--hi',
            anchor === h && 'mvr-hour--anchor'].filter(Boolean).join(' ');
          return (
            <button key={h} type="button" className={cls} onClick={() => click(h)}
                    aria-pressed={inWindow(h)} aria-label={`${hh(h)} to ${hh(h + 1)}`}>
              {hourLabel(h)}
            </button>
          );
        })}
      </div>
      <div className="mvr-hours__exact">
        <label>From
          <select className="rpt-select" value={start} onChange={(e) => exact(Number(e.target.value), end)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </label>
        <label>To
          <select className="rpt-select" value={end} onChange={(e) => exact(start, Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </label>
        <span className="mvr-hours__span">{span === 1 ? '1 hour' : `${span} hours`}{end <= start ? ', past midnight' : ''}</span>
      </div>
    </div>
  );
}
/** "Sat 1 Nov", in Nairobi time. */
const dayWords = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short' }).format(ms);

/** The vehicle types to show: a dropdown of checkboxes, with All and CPO only. */
/** Prints a PDF from a frame of its own, out of sight, that goes once it has printed. */
function printPdf(url) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 60_000); };
  document.body.appendChild(f);
}
const kb = (bytes) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/**
 * The PDF as the server makes it, edits and all, shown on the page before it
 * is saved (operator, 2 Nov: "add a pdf preview"). Download saves this same
 * file, so what was looked at is what is filed.
 *
 * It opens at once and is made inside it. The pages are drawn to fill the
 * window's width (shared/PdfPages), not left to the browser's PDF viewer,
 * whose zoom differs from one browser to another; print, a tab of its own and
 * download sit in the head with what the file is: its window, pages, size and
 * edits.
 */
function PdfPreview({ state, title = 'Movement report', caption, edited, onRetry, onClose }) {
  const [url, setUrl] = useState(null);
  const [pages, setPages] = useState(null);
  const [drawError, setDrawError] = useState(null);
  const file = state.status === 'done' ? state : null;
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    setPages(null);
    setDrawError(null);
    return () => { URL.revokeObjectURL(u); setUrl(null); };
  }, [file]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const facts = [caption,
    pages && `${pages} page${pages === 1 ? '' : 's'}`,
    file && kb(file.blob.size),
    edited > 0 && `${edited} edit${edited === 1 ? '' : 's'} included`].filter(Boolean);
  return (
    <div className="sp4-modal-overlay mvr-pv-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mvr-pv" role="dialog" aria-modal="true" aria-labelledby="mvr-pv-title" aria-describedby="mvr-pv-facts">
        <header className="mvr-pv__head">
          <i className="ti ti-file-type-pdf mvr-pv__icon" aria-hidden="true" />
          <div className="mvr-pv__what">
            <h2 id="mvr-pv-title" className="mvr-pv__title">{title}</h2>
            <p id="mvr-pv-facts" className="mvr-pv__facts">
              {facts.map((f, i) => <span key={i}>{f}</span>)}
            </p>
          </div>
          <div className="mvr-pv__tools">
            <button type="button" className="mvr-pv__tool" disabled={!url} title="Print"
                    onClick={() => printPdf(url)}>
              <i className="ti ti-printer" aria-hidden="true" /><span className="mvr-sr">Print</span>
            </button>
            <a className={`mvr-pv__tool${url ? '' : ' is-off'}`} href={url ?? undefined} target="_blank" rel="noreferrer"
               title="Open in a tab of its own" aria-disabled={!url}>
              <i className="ti ti-external-link" aria-hidden="true" /><span className="mvr-sr">Open in a new tab</span>
            </a>
            <button type="button" className="sp4-submit-btn frp-run mvr-pv__save" disabled={!file} autoFocus
                    onClick={() => saveFile(file.blob, file.filename)}>
              <i className="ti ti-download" aria-hidden="true" /> Download
            </button>
            <button type="button" className="sp4-modal-x mvr-pv__x" onClick={onClose} aria-label="Close the preview">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="mvr-pv__desk" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && (
            <div className="mvr-pv__note" role="status">
              <span className="mvr-pv__sheet" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              Making the PDF…
            </div>
          )}
          {state.status === 'error' && (
            <div className="mvr-pv__note mvr-pv__note--error" role="alert">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>The PDF could not be made: {state.message}</span>
              <button type="button" className="sp4-ghost-btn" onClick={onRetry}>Try again</button>
            </div>
          )}
          {file && !drawError && (
            <PdfPages blob={file.blob} gutter={0} onLoad={setPages} onError={(err) => setDrawError(err?.message ?? String(err))} />
          )}
          {drawError && (
            <div className="mvr-pv__note mvr-pv__note--error" role="alert">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>The PDF was made but could not be shown here: {drawError}. Download or open it in a tab.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One choice from a short list (a group, a consumption unit), in the field and
 * card the Type list uses (operator, 2 Nov: "the drop down list on each node
 * to match that in the movements"): the picked one ticked, with what it holds
 * beside it where there is something real to say.
 */
function ChoicePicker({ icon, label, value, options, onChange, align = 'left', search = false }) {
  const [open, setOpen] = useState(false);
  // A long list (a fleet's units) takes a search box: typed words narrow it
  const [term, setTerm] = useState('');
  useEffect(() => { if (!open) setTerm(''); }, [open]);
  const needle = term.trim().toLowerCase().replace(/\s+/g, '');
  const listed = needle ? options.filter((o) => o.value == null || String(o.label).toLowerCase().replace(/\s+/g, '').includes(needle)) : options;
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const picked = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className={`drp drp--${align} mvr-types`} ref={rootRef}>
      <button type="button" className={`drp-field${open ? ' drp-field--open' : ''}`}
              onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}
              aria-label={`${label}: ${picked.label}`}>
        <i className={`ti ${icon}`} aria-hidden="true" />
        <span className="drp-text mvr-types__v">{picked.label}</span>
        <i className="ti ti-chevron-down drp-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="drp-pop mvr-types__pop" role="listbox" aria-label={label}>
          {search && (
            <input className="sp4-search mvr-types__search" type="text" placeholder={`Search ${label.toLowerCase()}…`}
                   aria-label={`Search ${label.toLowerCase()}`} value={term} autoFocus onChange={(e) => setTerm(e.target.value)} />
          )}
          <ul className="mvr-types__list">
            {listed.map((o) => {
              const on = o.value === value;
              return (
                <li key={String(o.value)}>
                  <button type="button" role="option" aria-selected={on}
                          className={`mvr-type mvr-type--one${on ? ' mvr-type--on' : ''}`}
                          onClick={() => { onChange(o.value); setOpen(false); }}>
                    <span className="mvr-type__name">{o.label}</span>
                    {o.note != null && <span className="mvr-type__n">{o.note}</span>}
                    <i className="ti ti-check mvr-type__tick" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function TypePicker({ types, picked, counts, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const set = new Set(picked);
  const cpo = defaultTypes(types);
  const all = picked.length === types.length;
  const onlyCpo = picked.length === cpo.length && cpo.every((t) => set.has(t));
  const label = !picked.length ? 'No types' : all ? 'All types' : picked.length === 1 ? picked[0] : `${picked.length} of ${types.length} types`;
  const vehicles = picked.reduce((n, t) => n + (counts[t] ?? 0), 0);

  // A press outside closes it, and Escape, as the calendar beside it does.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = (t) => onChange(set.has(t) ? picked.filter((x) => x !== t) : types.filter((x) => set.has(x) || x === t));
  return (
    <div className="drp drp--right mvr-types" ref={rootRef}>
      <button type="button" className={`drp-field${open ? ' drp-field--open' : ''}`}
              onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}
              aria-label={`Vehicle types: ${label}`}>
        <i className="ti ti-truck" aria-hidden="true" />
        <span className="drp-text mvr-types__v">{label}</span>
        <i className="ti ti-chevron-down drp-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="drp-pop mvr-types__pop" role="group" aria-label="Vehicle types">
          <div className="drp-quick">
            <button type="button" className={`drp-chip${all ? ' drp-chip--on' : ''}`} onClick={() => onChange(types)}>All types</button>
            {cpo.length < types.length && (
              <button type="button" className={`drp-chip${onlyCpo && !all ? ' drp-chip--on' : ''}`} onClick={() => onChange(cpo)}>CPO only</button>
            )}
            <button type="button" className="drp-chip" onClick={() => onChange([])} disabled={!picked.length}>Clear</button>
          </div>
          <ul className="mvr-types__list">
            {types.map((t) => (
              <li key={t}>
                <button type="button" role="menuitemcheckbox" aria-checked={set.has(t)}
                        className={`mvr-type${set.has(t) ? ' mvr-type--on' : ''}`} onClick={() => toggle(t)}>
                  <span className="mvr-type__box" aria-hidden="true"><i className="ti ti-check" /></span>
                  <span className="mvr-type__name">{t}</span>
                  <span className="mvr-type__n">{counts[t] ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="drp-hint" aria-live="polite">
            {picked.length ? `${vehicles.toLocaleString('en-GB')} vehicle${vehicles === 1 ? '' : 's'} in the table and the PDF.` : 'Pick a type to fill the table.'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Movements (operator, 2 Nov 2026): where every unit was and whether it
 * was heading to or from MORL over a window, as a table first. The page opens
 * made for the last hour; the last 2 or 4 hours, or the same hours on every
 * day of a range (07:00 to 08:00, 07:00 to 20:00…, a week at most) make it
 * again, one table a day. The vehicle types (the units' groupings, CPO by
 * default) pick what the table and the PDF show. The operator may correct a
 * row's location or direction, or leave a row out, before the PDF; the server
 * draws the PDF from the tables as edited (lib/movementReport), one day after
 * another, counting each overview again from what is kept.
 */
function MovementsReport({ orgId }) {
  // Mounted afresh for each organisation (key={orgId}), from what was kept for it.
  const [saved] = useState(() => movementsKept.get(orgId));
  const today = fleetDay(Date.now());
  const [sel, setSel] = useState(saved?.sel ?? { mode: 'last', hours: LAST_HOURS[0] });
  const [draft, setDraft] = useState(saved?.draft ?? { fromDay: today, toDay: today, start: 7, end: 20 });
  const [daysOpen, setDaysOpen] = useState(saved?.sel?.mode === 'days');
  const [run, setRun] = useState(saved ? { status: 'done', reports: saved.reports } : { status: 'idle' });
  const [edits, setEdits] = useState(saved?.edits ?? []);   // per day: by vehicleId { location?, state?, removed? }
  const [day, setDay] = useState(saved?.day ?? 0);
  const [types, setTypes] = useState(saved?.types ?? null);
  const [pdf, setPdf] = useState({ busy: false, error: null });
  const [confirm, setConfirm] = useState(null);              // { words, go }: waits for the operator's yes
  const runId = useRef(0);

  // The tables and their edits outlive this page: another report or page and
  // back finds them as they were. Only finished tables are kept.
  useEffect(() => {
    if (!orgId) return;
    if (run.status === 'done') movementsKept.set(orgId, { sel, draft, reports: run.reports, edits, day, types });
    else movementsKept.delete(orgId);
  }, [orgId, sel, draft, run, edits, day, types]);

  const execute = async (next) => {
    if (!orgId) return;
    const windows = movementWindows(next);
    if (!windows.length) return;
    const id = ++runId.current;
    setSel(next);
    setRun({ status: 'loading', done: 0, of: windows.length });
    try {
      const reports = [];
      for (const w of windows) {
        const r = await loadMovementReport({ orgId, from: w.from, to: w.to });
        // Menengai by its fleet list (Tankers, Finished Goods, …); the others come by vehicle type
        reports.push(splitsByType(r) ? r : byFleetList(r, groupsFor(r.orgCode)));
        if (id !== runId.current) return;
        setRun({ status: 'loading', done: reports.length, of: windows.length });
      }
      const all = vehicleTypes(reports);
      setTypes((t) => (t?.some((x) => all.includes(x)) ? t.filter((x) => all.includes(x)) : defaultTypes(all)));
      setEdits(reports.map(() => ({})));
      setDay(reports.length - 1);
      setRun({ status: 'done', reports });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // Opens made for the last hour, unless tables were kept for this organisation.
  useEffect(() => { if (!saved && orgId) execute(sel); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reports = run.status === 'done' ? run.reports : null;
  const allTypes = useMemo(() => (reports ? vehicleTypes(reports) : []), [reports]);
  const picked = useMemo(() => types ?? [], [types]);
  // Menengai's fleet list, when its report is grouped by it: the menu lists every group of it
  const fleetList = reports?.some((r) => r.byList) ? groupsFor(reports[0].orgCode) : null;
  // Vehicles of each type on the day shown, before the type filter
  const typeCounts = useMemo(() => Object.fromEntries((reports?.[day] ?? reports?.[0])?.groups.map((g) => [g.name, g.rows.length]) ?? []), [reports, day]);
  const report = useMemo(() => (reports ? onlyTypes(reports[day] ?? reports[0], picked) : null), [reports, day, picked]);
  const dayEdits = useMemo(() => edits[day] ?? {}, [edits, day]);
  const kept = useMemo(() => (report ? applyEdits(report, dayEdits) : null), [report, dayEdits]);
  const changed = reports
    ? reports.reduce((n, r, i) => n + r.groups.reduce((m, g) => m + g.rows.filter((x) => isEdited(x, edits[i]?.[x.vehicleId])).length, 0), 0)
    : 0;
  const edit = (vehicleId, patch) => setEdits((all) => all.map((e, i) => (i === day ? { ...e, [vehicleId]: { ...e[vehicleId], ...patch } } : e)));

  // Closing or reloading the browser tab would lose them: the browser asks first.
  useEffect(() => {
    if (!changed) return undefined;
    const warn = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  // A new run replaces the tables: with edits on them, ask first.
  const guard = (words, go) => (changed ? setConfirm({ words, go }) : go());
  const daysProblem = windowsProblem({ mode: 'days', ...draft });
  const problem = daysOpen ? daysProblem : null;
  const runDays = () => guard('Make the report for these days', () => execute({ mode: 'days', ...draft }));

  const pdfBody = () => {
    const each = pdfRequests(reports, edits, picked);
    return each.length === 1 ? each[0] : { reports: each };
  };
  const downloadPdf = async () => {
    if (!reports || pdf.busy) return;
    setPdf({ busy: true, error: null });
    try {
      await downloadEditedMovementReport({ orgId, request: pdfBody() });
      setPdf({ busy: false, error: null });
    } catch (err) {
      setPdf({ busy: false, error: `The PDF could not be made: ${err?.message ?? err}` });
    }
  };
  const downloadJpeg = async () => {
    if (!reports || pdf.busy) return;
    setPdf({ busy: 'jpeg', error: null });
    try {
      const { blob, filename } = await makeEditedMovementReport({ orgId, request: pdfBody() });
      await savePdfAsJpeg(blob, filename);
      setPdf({ busy: false, error: null });
    } catch (err) {
      setPdf({ busy: false, error: `The JPEG could not be made: ${err?.message ?? err}` });
    }
  };
  const [preview, setPreview] = useState(null);   // { status: loading | done (blob, filename) | error }
  const previewId = useRef(0);
  const previewPdf = async () => {
    if (!reports) return;
    const id = ++previewId.current;
    setPreview({ status: 'loading' });
    try {
      const file = await makeEditedMovementReport({ orgId, request: pdfBody() });
      if (id === previewId.current) setPreview({ status: 'done', ...file });
    } catch (err) {
      if (id === previewId.current) setPreview({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  const closePreview = () => { previewId.current++; setPreview(null); };
  const previewCaption = !reports ? null : reports.length === 1
    ? periodText(reports[0].from, reports[0].to)
    : `${reports.length} days, ${dayWords(reports[0].from)} – ${dayWords(reports[reports.length - 1].from)}`;

  // The site the directions read against: MORL for Menengai, the organisation's own elsewhere
  const site = report?.site ?? 'MORL';
  const words = directionWords(site);
  const n = kept?.counts;
  const silentCount = n ? n.stale + n['no-fix'] : 0;
  const kpis = [
    { label: 'Vehicles', value: n?.total },
    { label: `To ${site}`, value: n?.to, tone: n?.to ? 'live' : undefined },
    { label: `From ${site}`, value: n?.from },
    { label: `At ${site}`, value: n?.at },
    { label: 'Not reporting', value: silentCount, tone: silentCount ? 'speed' : undefined },
  ];

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone} value={n ? k.value.toLocaleString('en-GB') : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Window">
          {LAST_HOURS.map((h) => {
            const on = !daysOpen && sel.mode === 'last' && sel.hours === h;
            return (
              <button key={h} type="button" aria-pressed={on}
                      className={`sp4-filter-chip${on ? ' sp4-filter-chip--on' : ''}`}
                      onClick={() => { setDaysOpen(false); guard(`Show the ${lastWords(h).toLowerCase()}`, () => execute({ mode: 'last', hours: h })); }}>
                {lastWords(h)}
              </button>
            );
          })}
        </div>

        {/* One field for the days and the hours: a day or a range on the calendar, the hours under it */}
        <DateRangePicker
          from={draft.fromDay} to={draft.toDay} today={today} maxDays={MAX_MOVEMENT_DAYS} spans={[MAX_MOVEMENT_DAYS]}
          label="Days and hours" on={daysOpen} disabled={!orgId}
          text={`${pickedText(draft.fromDay, draft.toDay, today)} · ${hoursText(draft.start, draft.end)}`}
          onChange={(f, t) => { setDaysOpen(true); setDraft((d) => ({ ...d, fromDay: f, toDay: t })); }}
        >
          {({ close }) => (
            <>
              <HourWindow start={draft.start} end={draft.end}
                          onChange={(s, e) => { setDaysOpen(true); setDraft((d) => ({ ...d, start: s, end: e })); }} />
              <div className="mvr-hours__foot">
                {daysProblem && <span className="rpt-problem" role="status">{daysProblem}</span>}
                <button type="button" className="sp4-submit-btn frp-run"
                        disabled={run.status === 'loading' || Boolean(daysProblem)}
                        onClick={() => { close(); runDays(); }}>
                  {run.status === 'loading' ? 'Running…' : 'Run report'}
                </button>
              </div>
            </>
          )}
        </DateRangePicker>

        {fleetList ? (
          // Menengai: one group at a time from its fleet list, every group listed even with no
          // unit tracked (operator, 2 Nov: "ensure the list has these items"); All groups also
          // shows the units the list does not name, last
          <ChoicePicker icon="ti-users-group" label="Group" align="right"
                        value={picked.length === 1 && fleetList.some((g) => g.name === picked[0]) ? picked[0] : null}
                        options={[{ value: null, label: 'All groups', note: Object.values(typeCounts).reduce((a, b) => a + b, 0) },
                          ...fleetList.map((g) => ({ value: g.name, label: g.name, note: typeCounts[g.name] ?? 0 }))]}
                        onChange={(v) => setTypes(v == null ? allTypes : [v])} />
        ) : allTypes.length > 0 && <TypePicker types={allTypes} picked={picked} counts={typeCounts} onChange={setTypes} />}

        <button type="button" className="sp4-submit-btn frp-run rpt-run"
                onClick={daysOpen ? runDays : () => guard('Run the report again', () => execute(sel))}
                disabled={!orgId || run.status === 'loading' || Boolean(problem)} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {confirm && (
        <div className="mvr-confirm" role="alertdialog" aria-labelledby="mvr-confirm-words">
          <span id="mvr-confirm-words">{confirm.words} and lose your {changed} edit{changed === 1 ? '' : 's'}?</span>
          <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setConfirm(null)} autoFocus>Keep editing</button>
          <button type="button" className="sp4-submit-btn frp-run mvr-confirm__go"
                  onClick={() => { const { go } = confirm; setConfirm(null); go(); }}>Discard edits</button>
        </div>
      )}

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name={MOVEMENTS} />} title="Movements">
            {orgId ? 'Choose the window, then press Run report.' : 'Waiting for the organisation to load.'}
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report"
                     progress={run.of > 1 ? run.done / run.of : null}>
            {run.of > 1 ? `Day ${Math.min(run.done + 1, run.of)} of ${run.of}. ` : ''}Reading where every unit was. Up to half a minute while new places are named.
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made"
                     action={{ label: 'Try again', onClick: () => execute(sel) }}>
            {run.message}
          </EmptyNote>
        )}

        {report && (
          <>
            {reports.length > 1 && (
              <div className="sp4-filter-group mvr-daytabs" role="tablist" aria-label="Day">
                {reports.map((r, i) => (
                  <button key={r.from} type="button" role="tab" aria-selected={i === day}
                          className={`sp4-filter-chip${i === day ? ' sp4-filter-chip--on' : ''}`} onClick={() => setDay(i)}>
                    {dayWords(r.from)}
                  </button>
                ))}
              </div>
            )}
            <TableToolbar
              summary={<>
                <strong>{kept.counts.total.toLocaleString('en-GB')}</strong> vehicle{kept.counts.total === 1 ? '' : 's'}
                <span className="rpt-sub"> · {periodText(report.from, report.to)} · {report.morl ? `${report.morl} geofence` : `no ${site} geofence, so no direction`}</span>
                {changed > 0 && <span className="rpt-edited"> · {changed} edited</span>}
              </>}
              onPdf={pdf.busy ? undefined : downloadPdf}
              actions={<>
                {changed > 0 && <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setEdits((all) => all.map(() => ({})))}>Undo edits</button>}
                {pdf.busy ? <span className="rpt-sub">{pdf.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span> : pdf.error ? <span className="rpt-warn">{pdf.error}</span> : null}
                <button type="button" className="sp4-ghost-btn" onClick={downloadJpeg} disabled={Boolean(pdf.busy) || !kept.counts.total}
                        title="The PDF report, with your edits, as an image">
                  <i className="ti ti-photo" aria-hidden="true" /> JPEG
                </button>
                <button type="button" className="sp4-ghost-btn" onClick={previewPdf} disabled={Boolean(pdf.busy) || !kept.counts.total}
                        title="See the PDF, with your edits, before you download it">
                  <i className="ti ti-eye" aria-hidden="true" /> Preview
                </button>
              </>}
            />
            {preview && <PdfPreview state={preview} caption={previewCaption} edited={changed} onRetry={previewPdf} onClose={closePreview} />}
            {!report.groups.length ? (
              <EmptyNote icon="ti-circle-check" title="Nothing to Report">
                {fleetList && picked.length === 1 && !typeCounts[picked[0]]
                  ? `None of the ${picked[0]} units on the list is tracked on the platform.`
                  : picked.length ? 'No units of the types picked.' : 'Pick a vehicle type.'}
              </EmptyNote>
            ) : (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table mvr-table">
                  <thead>
                    <tr>
                      <th scope="col">Grouping</th>
                      <th scope="col">Last coordinates</th>
                      <th scope="col">Location</th>
                      <th scope="col" className="rpt-num">Speed</th>
                      <th scope="col">Direction</th>
                      <th scope="col"><span className="mvr-sr">Keep or leave out</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.groups.map((g) => (
                      <Fragment key={g.name}>
                        <tr className="rpt-group">
                          <th colSpan={6} scope="rowgroup">
                            <span className="rpt-group__name">{g.name}</span>
                            <span className="rpt-group__meta">{groupWords(g, dayEdits)}</span>
                          </th>
                        </tr>
                        {g.rows.map((row) => {
                          const e = dayEdits[row.vehicleId];
                          const out = Boolean(e?.removed);
                          const state = e?.state ?? row.state;
                          const location = e?.location ?? row.location ?? '';
                          const silent = row.stale || row.state === 'no-fix';
                          return (
                            <tr key={row.vehicleId} className={`sp4-tr${out ? ' mvr-row--out' : ''}`}
                                style={!out && TINT[state] ? { background: TINT[state] } : undefined}>
                              <td className={`rpt-unit${silent ? ' mvr-silent' : ''}`}>{row.grouping}</td>
                              <td className={row.stale ? 'mvr-silent' : undefined}>{stamp(row.lastAt)}</td>
                              <td className={out ? undefined : isLoading(row) ? 'mvr-cell--loading' : state === 'at' ? 'mvr-cell--morl' : isMoving({ ...row, state }) ? 'mvr-cell--moving' : undefined}>
                                <input type="text" className={`mvr-edit${locationChanged(row, location) ? ' mvr-edit--changed' : ''}`}
                                       value={location} placeholder="-" maxLength={200} disabled={out}
                                       aria-label={`Location of ${row.plate}`}
                                       onChange={(ev) => edit(row.vehicleId, { location: ev.target.value })} />
                              </td>
                              <td className="rpt-num">{row.speedKmh != null ? `${row.speedKmh} km/h` : '-'}</td>
                              <td>
                                <select className={`rpt-select mvr-edit${state !== row.state ? ' mvr-edit--changed' : ''}`}
                                        value={state} disabled={out} aria-label={`Direction of ${row.plate}`}
                                        onChange={(ev) => edit(row.vehicleId, { state: ev.target.value })}>
                                  {STATES.map((s) => <option key={s} value={s}>{words[s]}</option>)}
                                </select>
                              </td>
                              <td className="mvr-keep">
                                <button type="button" className="mvr-keep__btn"
                                        onClick={() => edit(row.vehicleId, { removed: !out })}
                                        title={out ? 'Put this unit back in the report' : 'Leave this unit out of the PDF'}
                                        aria-label={out ? `Put ${row.plate} back` : `Leave ${row.plate} out`}>
                                  <i className={`ti ${out ? 'ti-arrow-back-up' : 'ti-x'}`} aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ value, label, tone }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ''}`}>
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

export default function ReportsScreen() {
  const { vehicles = [], orgId } = useFleetLiveShared();
  const { activeCompany } = useCompanies();
  const orgCode = activeCompany?.code ?? ORG_CODE_BY_COMPANY[activeCompany?.id] ?? null;
  const groups = useMemo(() => groupsFor(orgCode), [orgCode]);
  // Mufindi (KASULU) has the machine register: utilization reads each unit
  // against its own rated burn, L/h or L/km, rather than one picked unit.
  const rated = String(orgCode ?? '').toUpperCase() === 'KASULU';

  const { can } = usePermissions();
  // Which tabs the grants allow (lib/reportNav); the sidebar's Reports tree
  // lists the same and picks among them too.
  const tabs = reportKeysFor(can);
  // End of shift first, where the grants allow it.
  const chosen = useCurrentReport() ?? tabs[0];
  const key = tabs.includes(chosen) ? chosen : tabs[0];
  const isServer = Boolean(SERVER_TABS[key]);
  const def = REPORTS[isServer ? 'behaviour' : key];
  const [span, setSpan] = useState(() => spanFor(key));
  const [group, setGroup] = useState(null);
  // One unit, on the reports that take it (UNIT_REPORTS); null = every unit in the group
  const [unit, setUnit] = useState(null);
  const [night, setNight] = useState(NIGHT);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [run, setRun] = useState({ status: 'idle' });
  const runId = useRef(0);

  // Incidents operators logged by hand (lib/operatorLog), kept in this browser.
  const me = useAuth().user;
  const by = me?.name || me?.email || '';
  // The follow-up cases and the incidents operators logged, on the server
  // (api/driverConduct) so every machine sees the same; what this browser
  // kept before is moved there first (lib/conductMove). Read again when the
  // window comes back into view and every minute, for other machines' work.
  const [entries, setEntries] = useState([]);
  const [cases, setCases] = useState([]);
  const [storeError, setStoreError] = useState(null);
  const [dialog, setDialog] = useState(null);   // null | { entry? }
  const [acting, setActing] = useState(null);   // the case id in the action form
  const [now, setNow] = useState(() => Date.now());
  const failed = (what) => (err) => setStoreError(`${what}: ${err?.message ?? err}`);
  useEffect(() => {
    if (!orgId) { setEntries([]); setCases([]); return undefined; }
    let live = true;
    const read = () => Promise.all([conductApi.listCases(orgId), conductApi.listIncidents(orgId)])
      .then(([c, e]) => { if (live) { setCases(c); setEntries(e); setStoreError(null); } })
      .catch((err) => { if (live) failed('The follow-up could not be read')(err); });
    moveBrowserFollowUp(orgId).catch((err) => { if (live) failed('What this browser kept could not be moved to the server; it is kept here and tried again next time')(err); })
      .finally(read);
    const onShow = () => { if (document.visibilityState === 'visible') read(); };
    const tick = setInterval(() => { setNow(Date.now()); read(); }, 60_000);
    document.addEventListener('visibilitychange', onShow);
    return () => { live = false; clearInterval(tick); document.removeEventListener('visibilitychange', onShow); };
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEntry = (e) => {
    const entry = upsert([], e)[0];   // checked, with an id
    if (!entry) return;
    conductApi.saveIncident(orgId, entry).then((saved) => setEntries((l) => upsert(l, saved))).catch(failed('The incident could not be saved'));
  };
  const dropEntry = (id) => {
    conductApi.deleteIncident(orgId, id).then(() => setEntries((l) => remove(l, id))).catch(failed('The incident could not be deleted'));
  };
  const importEntries = (list) => {
    conductApi.importIncidents(orgId, list).then((r) => setEntries(r.entries)).catch(failed('The incidents could not be imported'));
  };
  const importCaseList = (list) => {
    conductApi.importCases(orgId, list).then((r) => setCases(r.cases)).catch(failed('The follow-up could not be imported'));
  };
  const saveAction = (id, a) => {
    conductApi.recordAction(orgId, id, a).then((c) => setCases((l) => l.map((x) => (x.id === c.id ? c : x)))).catch(failed('The action could not be saved'));
  };

  // A different organisation starts over: its groups and units differ.
  useEffect(() => {
    runId.current += 1;
    setRun({ status: 'idle' });
    setGroup(null);
    setUnit(null);
  }, [orgId]);

  const reset = () => { runId.current += 1; setRun({ status: 'idle' }); };
  // Picked in the sidebar's Reports tree: the new report starts on its own period.
  const showing = useRef(key);
  useEffect(() => {
    if (showing.current === key) return;
    showing.current = key;
    setSpan(spanFor(key)); reset();
  }, [key]);
  const conduct = key === 'behaviour';
  const byUnit = UNIT_REPORTS.has(key);
  // The units of the group picked, by plate, for the Unit picker
  const unitChoices = useMemo(() => (byUnit
    ? scopeUnits(vehicles, groups, group).units
      .map((u) => ({ value: u.key, label: u.plate, note: u.group ?? undefined }))
      .sort((x, y) => x.label.localeCompare(y.label, 'en', { numeric: true }))
    : []), [byUnit, vehicles, groups, group]);
  const today = fleetDay(Date.now());
  // Every report here takes its period on one calendar with the hours under it,
  // as Movements does (operator, 2 Nov): the first day at the start hour to the
  // last day at the end hour, up to now. Night driving's hours are the night
  // itself, and a day picked there runs from its noon to the next noon.
  const isNight = key === 'night';
  const [days, setDays] = useState(() => daysOf(key, span, night));
  const [picking, setPicking] = useState(null);
  const shownDays = picking ?? days;
  useEffect(() => { setDays(daysOf(key, spanFor(key), night)); setPicking(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodOf = (d) => (isNight
    ? { from: dayStart(d.fromDay) + 12 * HOUR_MS, to: Math.min(Date.now(), dayStart(d.toDay) + 36 * HOUR_MS) }
    : shiftPeriod(d));
  const applyDays = (d) => {
    const sp = { id: null, ...periodOf(d) };
    const nt = isNight ? { ...night, start: d.start, end: d.end % 24 } : night;
    setDays(d); setPicking(null); setSpan(sp); setNight(nt);
    execute({ span: sp, night: nt });
  };

  const problemFor = (sp) => (!orgId ? 'Waiting for the organisation to load'
    : sp.from >= Date.now() ? 'These hours have not begun yet'
    : !(sp.to > sp.from) ? 'The period ends before it starts'
    : (sp.to - sp.from) / DAY > def.maxDays + (isNight ? 1 : 0) ? `${def.maxDays} days at most for this report`
    : def.reachDays && sp.from < Date.now() - def.reachDays * DAY ? `The dashcam keeps its alarms ${def.reachDays} days: start the period within them`
    : null);
  const problem = problemFor(span);
  const pickingProblem = problemFor(periodOf(shownDays));

  // `over` carries a period (and night) just picked, before the state has it
  const execute = async (over = {}) => {
    const sp = over.span ?? span;
    const nt = over.night ?? night;
    if (problemFor(sp)) return;
    const id = ++runId.current;
    const live = () => id === runId.current;
    const scoped = scopeUnits(vehicles, groups, group);
    const one = byUnit && unit ? scoped.units.find((u) => u.key === unit) : null;
    const units = one ? [one] : scoped.units;
    const missing = one ? [] : scoped.missing;
    const ctx = { from: sp.from, to: sp.to, group, unit: one?.plate ?? null, night: { ...nt }, rate, rated: rated && key === 'utilisation' };
    if (!units.length) {
      setRun({ status: 'done', rows: [], secs: [], ctx, missing, failed: 0, units: 0 });
      return;
    }
    const step = (words) => ({ done, total }) => { if (live()) setRun({ status: 'loading', words, done, total }); };
    setRun({ status: 'loading', words: 'Starting', done: 0, total: 0 });
    try {
      let rows;
      let failed = 0;
      if (key === 'behaviour') {
        const [h, cam] = await Promise.all([
          loadHarshEvents({ orgId, from: ctx.from, to: ctx.to, onProgress: step('Reading harsh driving, day') }),
          loadDashcamAlarms({ orgId, from: ctx.from }),
        ]);
        ctx.dashcams = cam.cameras > 0;
        ctx.dashcamFailed = cam.failed;
        if (!live()) return;
        // The rows are worked out below, with the operators' entries, so a
        // new entry shows in the report without running it again.
        setRun({ status: 'done', raw: { events: h.events, alarms: cam.alarms, dashcams: ctx.dashcams && !cam.failed },
                 unitList: units, ctx, missing, failed: h.failed, units: units.length });
        return;
      } else if (key === 'overspeed') {
        const ids = units.flatMap((u) => u.vehicles.map((v) => v.vehicleId));
        const r = await loadOverspeeds({ orgId, from: ctx.from, to: ctx.to, vehicleIds: ids, onProgress: step('Reading overspeeds, vehicle') });
        rows = overspeedRows(units, r.byVehicle); failed = r.failed;
      } else {
        const windows = key === 'night' ? nightWindows(ctx.from, ctx.to, ctx.night) : [[ctx.from, ctx.to]];
        ctx.windows = windows;
        const r = await loadDistances({ orgId, vehicles: units.flatMap((u) => u.vehicles), windows, onProgress: step('Reading each vehicle’s day') });
        rows = key === 'night' ? nightRows(units, r.perVehicle) : utilisationRows(units, r.perVehicle, { rated: ctx.rated });
        failed = r.failed;
      }
      if (!live()) return;
      const secs = sections(rows, ctx.rated ? RATED_SECTIONS : groups?.map((g) => g.name), def.sum);
      setRun({ status: 'done', rows, secs, ctx, missing, failed, units: units.length });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  // Every report here opens made for its own default period, once the units
  // are in, as Movements does (operator, 2 Nov: "able to generate a report by
  // default just like movements"). A report is only emptied by opening it, a
  // new organisation, or a new group or consumption unit, and each of those
  // makes it again at once. Opening one passes its own period: on a switch
  // from another report the state still holds that one's.
  const opened = useRef(null);
  useEffect(() => {
    if (isServer || !orgId || !vehicles.length || run.status !== 'idle') return;
    const fresh = opened.current !== key;
    opened.current = key;
    execute(fresh ? { span: spanFor(key), night } : {});
  }, [isServer, key, orgId, vehicles.length, run.status, group, unit, rate]); // eslint-disable-line react-hooks/exhaustive-deps

  // A behaviour run (and any new operator entry) opens the cases it finds;
  // what operators recorded on cases already there stays.
  // Sent only when what was found changes: the entries are read again every
  // minute, and the same cases need not go to the server each time.
  const sentFound = useRef('');
  useEffect(() => {
    if (run.status !== 'done' || !run.raw || !orgId) return;
    const found = casesFromRun(run.unitList, run.raw.events, run.raw.alarms, { ...run.ctx, dashcams: run.raw.dashcams, logged: entries });
    const sig = `${orgId}:${JSON.stringify(found)}`;
    if (sig === sentFound.current || !found.length) return;
    sentFound.current = sig;
    // The server folds them in, keeping what operators recorded, and answers with every case
    conductApi.sendFound(orgId, found).then(setCases).catch((err) => { sentFound.current = ''; failed('The follow-up cases could not be saved')(err); });
  }, [run, entries, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = useMemo(() => {
    if (run.status !== 'done') return null;
    if (!run.raw) return run;
    const rows = behaviourRows(run.unitList, run.raw.events, run.raw.alarms, { ...run.ctx, dashcams: run.raw.dashcams, logged: entries });
    const inScope = new Set(run.unitList.map((u) => u.key));
    const period = periodCases(cases, run.ctx).filter((c) => inScope.has(c.unitKey));
    const followUp = new Map();
    for (const c of period) followUp.set(c.unitKey, [...(followUp.get(c.unitKey) ?? []), c]);
    const ctx = { ...run.ctx, followUp, cases: period, allCases: cases, now };
    return { ...run, ctx, rows, logged: rows.logged, secs: sections(rows, groups?.map((g) => g.name), REPORTS.behaviour.sum) };
  }, [run, entries, groups, cases, now]);

  // The case the report's Follow-up cell opens: the oldest pending, else the latest.
  const openCaseFor = (unitKey) => {
    const list = done?.ctx.followUp?.get(unitKey) ?? [];
    const c = list.find((x) => x.status === 'pending') ?? list[list.length - 1];
    if (c) setActing(c.id);
  };
  const actingCase = acting ? cases.find((c) => c.id === acting) : null;
  const ctx = done?.ctx ?? { from: span.from, to: span.to };
  const allKpis = def.kpis(done?.rows ?? []);
  // Driver conduct leads with the total, and leaves the vehicles to the line over the table.
  const kpis = conduct
    ? [...allKpis.filter((k) => k.label === 'Total incidents'), ...allKpis.filter((k) => k.label !== 'Total incidents' && k.label !== 'Vehicles')]
    : allKpis;
  const columns = def.columns(ctx);
  // Type or Driver blank for every vehicle (e.g. all "UNSPECIFIED"): left out.
  const shown = done ? shownColumns(def, done.rows, done.ctx) : columns.map((_, i) => i);
  const groupWords = done?.ctx.group ?? (groups ? 'All groups' : 'All vehicles');
  const periodWords = periodText(ctx.from, ctx.to);
  const nightWords = key === 'night' ? `Night hours ${hourLabel((done?.ctx.night ?? night).start)}:00hrs – ${hourLabel((done?.ctx.night ?? night).end)}:00hrs` : null;
  const slugOf = (w) => `-${w.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const slug = `${def.key}-${String(orgCode ?? 'fleet').toLowerCase()}${done?.ctx.group ? slugOf(done.ctx.group) : ''}${done?.ctx.unit ? slugOf(done.ctx.unit) : ''}`;

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const downloadPdf = async () => {
    if (!done || pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { html, landscape, filename } = reportHtml(def, done, {
        companyName: activeCompany?.name ?? orgCode ?? 'Fleet',
        orgCode, groupWords, periodWords, nightWords, logos: letterheadLogos(),
      });
      await saveLetterheadPdf(html, { filename, landscape });
    } catch (err) {
      setPdfError(`The PDF could not be made: ${err?.message ?? err}`);
    } finally {
      setPdfBusy(false);
    }
  };

  // The same PDF as an image (operator, 2 Nov), on the reports named for it.
  const [jpegBusy, setJpegBusy] = useState(false);
  const downloadJpeg = async () => {
    if (!done || pdfBusy || jpegBusy) return;
    setJpegBusy(true);
    setPdfError(null);
    try {
      const { html, landscape, filename } = reportHtml(def, done, {
        companyName: activeCompany?.name ?? orgCode ?? 'Fleet',
        orgCode, groupWords, periodWords, nightWords, logos: letterheadLogos(),
      });
      const file = await saveLetterheadPdf(html, { filename, landscape, keep: true });
      await savePdfAsJpeg(file.blob, file.filename);
    } catch (err) {
      setPdfError(`The JPEG could not be made: ${err?.message ?? err}`);
    } finally {
      setJpegBusy(false);
    }
  };

  // The PDF on screen before it is saved (operator, 2 Nov), as Movements has it.
  const [preview, setPreview] = useState(null);
  const previewId = useRef(0);
  const previewPdf = async () => {
    if (!done) return;
    const id = ++previewId.current;
    setPreview({ status: 'loading' });
    try {
      const { html, landscape, filename } = reportHtml(def, done, {
        companyName: activeCompany?.name ?? orgCode ?? 'Fleet',
        orgCode, groupWords, periodWords, nightWords, logos: letterheadLogos(),
      });
      const file = await saveLetterheadPdf(html, { filename, landscape, keep: true });
      if (id === previewId.current) setPreview({ status: 'done', ...file });
    } catch (err) {
      if (id === previewId.current) setPreview({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  const closePreview = () => { previewId.current++; setPreview(null); };

  const downloadCsv = () => {
    if (!done) return;
    downloadTableCsv({ ...csvTable(def, done.secs, done.ctx), filenameSlug: slug });
  };

  return (
    <div className="sp4-root rpt-root" aria-label={(SERVER_TABS[key] ?? REPORTS[key]).label}>
      {/* No tab strip (operator, 2026-11-02): the sidebar's Reports tree picks the report. */}
      {key === SHIFT ? <ShiftReport key={orgId ?? 'none'} orgId={orgId} /> : key === MOVEMENTS ? <MovementsReport key={orgId ?? 'none'} orgId={orgId} /> : (<>

      <div className={`sp4-header rpt-header${conduct ? ' rpt-header--conduct' : ''}`}>
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone} value={done ? k.value : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        {/* One field for the period: days on the calendar, hours under it, as Movements has it */}
        <DateRangePicker
          from={shownDays.fromDay} to={shownDays.toDay} today={today}
          maxDays={def.reachDays ?? def.maxDays} spans={[def.reachDays ?? def.maxDays]}
          minDay={def.reachDays ? addDays(today, -(def.reachDays - 1)) : null}
          label="Period" on
          text={isNight
            ? `${pickedText(days.fromDay, days.toDay, today)} · nights ${hoursText(night.start, night.end || 24)}`
            : `${pickedText(days.fromDay, days.toDay, today)} · ${span.to >= Date.now() - 60_000 && days.toDay === today ? `${hh(days.start)}–now` : hoursText(days.start, days.end)}`}
          onChange={(f, t) => setPicking({ ...shownDays, fromDay: f, toDay: t })}
        >
          {({ close }) => (
            <>
              <HourWindow start={shownDays.start} end={shownDays.end} label={isNight ? 'Night hours' : 'Hours each day'}
                          onChange={(a, b) => setPicking({ ...shownDays, start: a, end: b })} />
              <div className="mvr-hours__foot">
                {pickingProblem && <span className="rpt-problem" role="status">{pickingProblem}</span>}
                <button type="button" className="sp4-submit-btn frp-run"
                        disabled={run.status === 'loading' || Boolean(pickingProblem)}
                        onClick={() => { close(); applyDays(shownDays); }}>
                  {run.status === 'loading' ? 'Running…' : 'Run report'}
                </button>
              </div>
            </>
          )}
        </DateRangePicker>

        {groups && (
          <ChoicePicker icon="ti-users-group" label="Group" value={group}
                        options={[{ value: null, label: 'All groups', note: groups.reduce((n, g) => n + g.units.length, 0) },
                          ...groups.map((g) => ({ value: g.name, label: g.name, note: g.units.length }))]}
                        onChange={(v) => { setGroup(v); setUnit(null); reset(); }} />
        )}

        {byUnit && (
          <ChoicePicker icon="ti-truck" label="Unit" value={unit} search
                        options={[{ value: null, label: 'All units', note: unitChoices.length }, ...unitChoices]}
                        onChange={(v) => { setUnit(v); reset(); }} />
        )}

        {key === 'utilisation' && !rated && (
          <ChoicePicker icon="ti-gas-station" label="Consumption" value={rate}
                        options={Object.entries(RATES).map(([k, r]) => ({ value: k, label: r.label, note: r.unit }))}
                        onChange={(v) => { setRate(v); reset(); }} />
        )}

        {key === 'behaviour' && (
          <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setDialog({})}>Log incident</button>
        )}
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => execute()}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name={def.key} />} title={def.title}>
            Choose the period{groups ? ' and group' : ''}, then press Run report.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report"
                     progress={run.total ? run.done / run.total : null}>
            {run.total ? `${run.words} ${Math.min(run.done + 1, run.total)} of ${run.total}.` : `${run.words}…`}
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made"
                     action={{ label: 'Try again', onClick: () => execute() }}>
            {run.message}
          </EmptyNote>
        )}

        {done && (
          <>
            <TableToolbar
              summary={<>
                <strong>{done.rows.length.toLocaleString('en-GB')}</strong> vehicle{done.rows.length === 1 ? '' : 's'}
                {key === 'utilisation' || key === 'night' ? ` of ${done.units.toLocaleString('en-GB')}` : ''}
                <span className="rpt-sub"> · {periodWords} · {groupWords}{done.ctx.unit ? ` · ${done.ctx.unit}` : ''}{nightWords ? ` · ${nightWords}` : ''}</span>
                {done.failed > 0 && <span className="rpt-warn"> · {done.failed} could not be read</span>}
                {key === 'behaviour' && done.ctx.dashcamFailed && <span className="rpt-warn"> · the dashcam alarms could not be read; seatbelt and phone are not counted</span>}
                {key === 'behaviour' && !done.ctx.dashcams && !done.ctx.dashcamFailed && <span className="rpt-sub"> · no dashcams in this fleet</span>}
              </>}
              onCsv={done.rows.length ? downloadCsv : undefined}
              onPdf={pdfBusy || jpegBusy ? undefined : downloadPdf}
              actions={<>
                {pdfBusy ? <span className="rpt-sub">Making the PDF…</span>
                  : jpegBusy ? <span className="rpt-sub">Making the JPEG…</span>
                  : pdfError ? <span className="rpt-warn">{pdfError}</span> : null}
                {JPEG_REPORTS.has(key) && (
                  <button type="button" className="sp4-ghost-btn" onClick={downloadJpeg} disabled={pdfBusy || jpegBusy}
                          title="The PDF report as an image">
                    <i className="ti ti-photo" aria-hidden="true" /> JPEG
                  </button>
                )}
                {conduct && (
                  <button type="button" className="sp4-ghost-btn" onClick={previewPdf} disabled={pdfBusy}
                          title="See the PDF before you download it">
                    <i className="ti ti-eye" aria-hidden="true" /> Preview
                  </button>
                )}
              </>}
            />
            {preview && (
              <PdfPreview state={preview} title={`${def.label} report`}
                          caption={`${periodWords} · ${groupWords}${done.ctx.unit ? ` · ${done.ctx.unit}` : ''}`} onRetry={previewPdf} onClose={closePreview} />
            )}
            {!done.rows.length ? (
              <EmptyNote icon="ti-circle-check" title="Nothing to Report">{def.empty}</EmptyNote>
            ) : (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className={`sp4-table rpt-table${def.wide ? ' rpt-table--grid' : ''}`}>
                  <thead>
                    <tr>
                      {shown.map((i) => (
                        <th key={columns[i]} className={isFigure(def, columns, i) ? 'rpt-num' : undefined} scope="col">{columns[i]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {done.secs.map((s) => (
                      <Fragment key={s.name ?? 'all'}>
                        {s.name && (
                          <tr className="rpt-group">
                            <th colSpan={shown.length} scope="rowgroup">
                              <span className="rpt-group__name">{s.name}</span>
                              <span className="rpt-group__meta">{s.rows.length} vehicle{s.rows.length === 1 ? '' : 's'} · {def.sumWords(s.total)}</span>
                            </th>
                          </tr>
                        )}
                        {s.rows.map((r) => {
                          const cells = def.cells(r, done.ctx);
                          return (
                            <tr key={r.unit.key} className={`sp4-tr${r.noData ? ' rpt-row--nodata' : ''}`}>
                              {shown.map((i) => {
                                const c = cells[i];
                                if (i === 0) {
                                  return (
                                    <td key={i} className="rpt-unit">
                                      {r.unit.plate}
                                      {key === 'utilisation' && overStandard(r) && <span className="rpt-tag rpt-tag--warn" title="More than 15% over the standard on the register">Over standard</span>}
                                      {r.suspect && <span className="rpt-tag rpt-tag--warn" title="More than 100 harsh events a day, far more than a driver makes: most likely a faulty sensor">Check sensor</span>}
                                    </td>
                                  );
                                }
                                if (key === 'behaviour' && columns[i] === 'Follow-up') {
                                  return (
                                    <td key={i}>
                                      {c === 'No case' ? <span className="rpt-fu-none">No case</span> : (
                                        <button type="button" className={`rpt-fu rpt-fu--${c === 'Overdue' ? 'overdue' : c === 'Pending' ? 'pending' : 'done'}`}
                                                onClick={() => openCaseFor(r.unit.key)}
                                                title={c === 'Action taken' ? 'See or change the action taken' : 'Record the action taken'}>{c}</button>
                                      )}
                                    </td>
                                  );
                                }
                                const cls = [isFigure(def, columns, i) && 'rpt-num',
                                  conduct && columns[i] === 'Driver' && 'rpt-driver',
                                  conduct && isFigure(def, columns, i) && c === '0' && 'rpt-zero'].filter(Boolean).join(' ');
                                return <td key={i} className={cls || undefined}>{c}</td>;
                              })}
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {done.missing.length > 0 && (
                  <details className="rpt-missing">
                    <summary>{done.missing.length} unit{done.missing.length === 1 ? '' : 's'} on the list {done.missing.length === 1 ? 'is' : 'are'} not tracked on the platform</summary>
                    <p>{done.missing.map((m) => `${m.plate} (${m.group})`).join(', ')}</p>
                  </details>
                )}
              </div>
            )}
          </>
        )}

        {key === 'behaviour' && (
          <FollowUpPanel cases={cases} orgCode={orgCode} now={now} saveFailed={storeError}
                         onOpen={(c) => setActing(c.id)} onReplace={importCaseList} />
        )}
        {key === 'behaviour' && (
          <LoggedIncidents entries={entries} orgCode={orgCode} saveFailed={storeError}
                           onLog={() => setDialog({})} onEdit={(entry) => setDialog({ entry })}
                           onDelete={dropEntry} onReplace={importEntries} />
        )}
      </div>

      </>)}

      {actingCase && (
        <ActionDialog key={actingCase.id} kase={actingCase} by={by} onClose={() => setActing(null)}
                      onSave={(a) => { saveAction(actingCase.id, a); setActing(null); }} />
      )}
      {dialog && (
        <IncidentDialog vehicles={vehicles} entry={dialog.entry} by={by}
                        onClose={() => setDialog(null)}
                        onSave={(e) => { saveEntry(e); setDialog(null); }} />
      )}
    </div>
  );
}
