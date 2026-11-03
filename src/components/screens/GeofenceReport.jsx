/*
 * Geofence Report (operator, 3 Nov 2026; West Kenya's sheet first): every
 * visit a vehicle made to a geofence over a period the operator picks, one
 * row a visit (Registration, Geofence, Time in, Time out, Duration in
 * geofence). A template (lib/reportTemplates): each organisation that has it
 * makes its own, and where it is one of a family (West Kenya: West Sugar,
 * Kabras, Nzoia) the operator may tick the others to make it for them
 * together. lib/geofenceReport does the reading; this is the page, its
 * pickers, and the PDF, JPEG and CSV.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSnapshot } from '../../services/snapshot';
import { mapSnapshotVehicle } from '../../lib/vehicleMap';
import { dayStart, fleetDay, toLocalInput, fromLocalInput } from '../../lib/fleetReports';
import { useReportOrgs } from '../../hooks/useReportOrgs';
import {
  LEAD_MS, MAX_DAYS, COLUMNS, placesIn, placeNames, geofenceRows, rowCells, counts, periodProblem, periodWords, endsNow, csvTable, geofenceHtml,
} from '../../lib/geofenceReport';
import { loadPings } from '../../api/fleetReports';
import { loadZones } from '../../hooks/useEstateZones';
import { saveLetterheadPdf, letterheadLogos } from '../../api/letterheadPdf';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import CheckPicker from './CheckPicker';

const DAY = 86_400_000;

function Kpi({ value, label, tone }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ''}`}>
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

export default function GeofenceReport({ orgId, orgCode, vehicles, companyName }) {
  // This organisation, or several of its family together (hooks/useReportOrgs)
  const { code, picked: pickedOrgs, several, orgIdOf, nameOf, fleetWords, picker } = useReportOrgs('geofences', { orgId, orgCode, companyName });

  // The period: from today's midnight to now, unless picked
  const today = fleetDay(Date.now());
  const [from, setFrom] = useState(() => dayStart(today));
  const [to, setTo] = useState(null);               // null: now
  const now = Date.now();
  const period = { from, to: to ?? now };

  // The geofences of the organisations picked, for the geofence picker
  const [zonesBy, setZonesBy] = useState({});      // code → FeatureCollection | 'error'
  useEffect(() => {
    if (!orgId) return undefined;
    let live = true;
    pickedOrgs.filter((c) => !zonesBy[c]).forEach(async (c) => {
      try {
        const id = await orgIdOf(c);
        const z = id ? await loadZones(id) : null;
        if (live) setZonesBy((m) => ({ ...m, [c]: z ?? { features: [] } }));
      } catch {
        if (live) setZonesBy((m) => ({ ...m, [c]: 'error' }));
      }
    });
    return () => { live = false; };
  }, [orgId, pickedOrgs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => [...new Set(pickedOrgs.flatMap((c) => (zonesBy[c] && zonesBy[c] !== 'error' ? placeNames(zonesBy[c]) : [])))]
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })), [zonesBy, pickedOrgs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [places, setPlaces] = useState(null);       // null: every geofence
  // Other organisations, other geofences: the pick starts over
  useEffect(() => { setPlaces(null); }, [pickedOrgs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const zonesReady = pickedOrgs.every((c) => zonesBy[c]);

  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);

  const problem = !orgId ? 'Waiting for the organisation to load'
    : periodProblem(period, now)
      ?? (zonesReady && !names.length ? 'There are no geofences on the platform for this organisation' : null)
      ?? (places && !places.length ? 'Pick at least one geofence' : null);

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    const live = () => id === runId.current;
    const ctx = { from: period.from, to: to ?? Date.now() };
    const rows = [];
    let failed = 0;
    let unread = [];
    try {
      for (const [n, c] of pickedOrgs.entries()) {
        const who = several ? `${nameOf(c)}: ` : '';
        setRun({ status: 'loading', words: `${who}Finding the geofences and vehicles`, done: 0, total: 0, part: [n + 1, pickedOrgs.length] });
        const oid = await orgIdOf(c);
        if (!oid) { unread.push(c); continue; }
        const [zones, fleet] = await Promise.all([
          loadZones(oid),
          c === code ? vehicles : fetchSnapshot(oid).then((r) => (Array.isArray(r.data) ? r.data : []).map(mapSnapshotVehicle)),
        ]);
        if (!live()) return;
        const list = placesIn(zones, places);
        const units = fleet.filter((v) => v.vehicleId);
        if (!list.length || !units.length) continue;
        const r = await loadPings({
          orgId: oid, vehicles: units, from: ctx.from - LEAD_MS, to: ctx.to,
          onProgress: ({ done, total }) => { if (live()) setRun({ status: 'loading', words: `${who}Reading each vehicle’s positions`, done, total, part: [n + 1, pickedOrgs.length] }); },
        });
        if (!live()) return;
        rows.push(...geofenceRows(units, (vid) => r.pings.get(vid), list, ctx));
        failed += r.failed.size;
      }
      if (several) rows.sort((a, b) => a.vehicle.localeCompare(b.vehicle, 'en', { sensitivity: 'base', numeric: true }) || a.in - b.in);
      setRun({ status: 'done', rows, ctx, failed, unread, orgs: pickedOrgs, places });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const done = run.status === 'done' ? run : null;
  const c = done ? counts(done.rows) : null;
  const stillShown = done && endsNow(done.ctx.to);
  const kpis = [
    { label: 'Visits', value: c?.visits },
    { label: 'Vehicles', value: c?.vehicles },
    { label: 'Geofences visited', value: c?.places },
    ...(stillShown || !done ? [{ label: 'Still inside', value: c?.still, tone: c?.still ? 'live' : undefined }] : []),
  ];

  const save = async (as) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { html, filename } = geofenceHtml(done.rows, {
        ...done.ctx, fleet: fleetWords(done.orgs), orgCode: code, logos: letterheadLogos(), places: done.places, failed: done.failed,
      });
      if (as === 'jpeg') {
        const pdf = await saveLetterheadPdf(html, { filename, keep: true });
        await savePdfAsJpeg(pdf.blob, pdf.filename);
      } else {
        await saveLetterheadPdf(html, { filename });
      }
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };
  const saveCsv = () => {
    if (!done) return;
    downloadTableCsv({ ...csvTable(done.rows, done.ctx), filenameSlug: `geofences-${fleetDay(done.ctx.from)}` });
  };

  const quick = [
    { key: 'today', label: 'Today', on: to == null && from === dayStart(today), go: () => { setFrom(dayStart(today)); setTo(null); } },
    { key: 'yesterday', label: 'Yesterday', on: from === dayStart(today) - DAY && to === dayStart(today),
      go: () => { setFrom(dayStart(today) - DAY); setTo(dayStart(today)); } },
  ];

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone}
                 value={c ? k.value.toLocaleString('en-GB') : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="rpt-field gfr-period" role="group" aria-label="Period">
          <span className="rpt-field__l">Period</span>
          {quick.map((q) => (
            <button key={q.key} type="button" aria-pressed={q.on}
                    className={`sp4-filter-chip${q.on ? ' sp4-filter-chip--on' : ''}`} onClick={q.go}>{q.label}</button>
          ))}
          <label className="gfr-when">
            <span className="rpt-sub">From</span>
            <input type="datetime-local" className="rpt-select tkr-when" aria-label="Period starts"
                   value={toLocalInput(from)} max={toLocalInput(now)}
                   onChange={(e) => { const t = fromLocalInput(e.target.value); if (Number.isFinite(t)) setFrom(t); }} />
          </label>
          <label className="gfr-when">
            <span className="rpt-sub">To</span>
            <input type="datetime-local" className="rpt-select tkr-when" aria-label="Period ends"
                   value={toLocalInput(to ?? now)} max={toLocalInput(now)}
                   onChange={(e) => { const t = fromLocalInput(e.target.value); if (Number.isFinite(t)) setTo(t >= now - 60_000 ? null : t); }} />
          </label>
          <button type="button" aria-pressed={to == null}
                  className={`sp4-filter-chip${to == null ? ' sp4-filter-chip--on' : ''}`} onClick={() => setTo(null)}
                  title="The period runs up to the moment the report is made">Up to now</button>
        </div>
        {picker && <CheckPicker {...picker} />}
        <CheckPicker icon="ti-map-pin" label="Geofences" noun="geofences" allWord="All geofences" search
                     options={names.map((n) => ({ value: n, label: n }))} picked={places}
                     onChange={setPlaces} />
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="geofences" />} title="Geofences">
            Every visit a vehicle made to a geofence over the period: when it went in, when it came out, and how long it stayed.
            Pick the period ({MAX_DAYS} days at most) and the geofences, then press Run report.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report" progress={run.total ? run.done / run.total : null}>
            {run.part?.[1] > 1 ? `Organisation ${run.part[0]} of ${run.part[1]}. ` : ''}
            {run.total ? `${run.words}: ${Math.min(run.done + 1, run.total)} of ${run.total}.` : `${run.words}…`}
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}

        {done && (
          <>
            <TableToolbar
              summary={<>
                Geofence Visits · <strong>{done.rows.length.toLocaleString('en-GB')}</strong> visit{done.rows.length === 1 ? '' : 's'}
                <span className="rpt-sub"> · {fleetWords(done.orgs)} · {periodWords(done.ctx)}</span>
                {done.failed > 0 && <span className="rpt-warn"> · {done.failed} vehicle{done.failed === 1 ? '' : 's'} could not be read</span>}
                {done.unread.length > 0 && <span className="rpt-warn"> · {done.unread.join(', ')} could not be opened</span>}
              </>}
              onCsv={done.rows.length ? saveCsv : undefined}
              onPdf={file.busy ? undefined : () => save('pdf')}
              actions={<>
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <button type="button" className="sp4-ghost-btn" onClick={() => save('jpeg')} disabled={Boolean(file.busy)}
                        title="The PDF report as an image">
                  <i className="ti ti-photo" aria-hidden="true" /> JPEG
                </button>
              </>}
            />
            {!done.rows.length ? (
              <EmptyNote icon="ti-circle-check" title="Nothing to Report">
                No vehicle was in {done.places ? 'the geofences picked' : 'a geofence'} over the period.
              </EmptyNote>
            ) : (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table gfr-table">
                  <thead>
                    <tr>{COLUMNS.map((h, i) => <th key={h} scope="col" className={i === 4 ? 'rpt-num' : undefined}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {done.rows.map((r, k) => {
                      const v = rowCells(r, done.ctx);
                      return (
                        <tr key={`${r.vehicleId}-${r.place}-${r.in}-${k}`} className="sp4-tr">
                          {v.map((x, i) => (
                            <td key={i} className={i === 0 ? 'rpt-unit' : i === 4 ? 'rpt-num' : undefined}>
                              {i === 3 && x === 'Still inside' ? <b>{x}</b> : x}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
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
