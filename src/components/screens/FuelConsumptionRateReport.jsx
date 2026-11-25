/*
 * Fuel Consumption Rate Report — per-vehicle fuel efficiency over a range of
 * fleet days, for Menengai.
 *
 * Worked out on the server (fleet-server reports/range-reports,
 * GET …/reports/fuel-consumption-rate): each unit's fuel balance over the
 * whole range (start and end tank, the ledger's refills and thefts) and the
 * distance it drove, against the target km/L from FUEL_RATES_FOR_FLEET_2.xlsx
 * (per registration, else per model). The page draws what comes back. It used
 * to stitch TAT trip rows together as if they were days, which lost the fuel
 * and the kilometres between trips.
 */

import { useMemo, useRef, useState } from 'react';
import './FuelConsumptionRateReport.css';
import { withTypeTargets, fuelGroupsFor, rowsInGroup, groupCounts, totalsOf } from '../../lib/fuelTargets';
import ChoicePicker from './ChoicePicker';
import { fleetEntriesFor } from '../../lib/fleetListFile';
import { useQueryClient } from '@tanstack/react-query';
import { fleetListEntries } from '../../hooks/useFleetList';
import { loadFuelConsumptionRate, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { fcrDoc } from '../../lib/reportDocs';
import { useReportEditor } from './ReportEditor';
import DateRangePicker from '../layout/DateRangePicker';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import PdfPreview from '../shared/PdfPreview';
import TableToolbar from '../body/TableToolbar';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';
import { isMorlFcr, fcrMorlDoc, morlFcrSheet, morlFcrTable, MORL_FCR_COLUMNS, RATE_COL, EXPECT_COL } from '../../lib/fuelRateMorl';

const MAX_DAYS = 31;
/** Which of their head colours a column's band is (lib/fuelRateMorl): blue, orange (with thefts) or green (minus thefts). */
const bandOf = (fill) => ({ '#ffc000': 'with', '#00b050': 'minus' }[String(fill).toLowerCase()] ?? 'base');
/** One empty list, so the editor (which resets when its rows change) sees the same one each render. */
const NONE = [];
/** The figures over the report, in the reports' own wording (Speed, Probe): sentence case, the unit after a comma. */
const KPI_LABELS = ['Vehicles', 'Distance measured, km', 'Filled, L', 'Consumed, L', 'Fleet rate, km/L'];

function Kpi({ value, label }) {
  return (
    <div className="sp4-kpi">
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

/** A fleet day, YYYY-MM-DD in Nairobi, whatever the browser's own zone. */
const fleetDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

export const litres = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));
export const kms = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));
export const rate = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));

/** The comment a row shows: why a figure is missing, or how it stands against the target. */
export function comment(r) {
  if (r.note) return r.note;
  if (r.belowTarget === true) return 'Below target';
  if (r.belowTarget === false) return 'On target';
  return '';
}

function toCsv(rows, period) {
  const head = ['Registration', 'Target (km/L)', 'Distance (km)', 'Initial Level (L)', 'Amount Filled (L)',
    'Suspected Theft (L)', 'Final Level (L)', 'Amount Consumed (L)', 'Consumption Rate (km/L)', 'Comment'];
  const data = rows.map((r) => [r.plate, r.target?.words ?? '—', kms(r.distanceKm), litres(r.startL), litres(r.filledL),
    litres(r.theftL), litres(r.endL), litres(r.consumedL), rate(r.kmPerL), comment(r)]);
  return { head, rows: data, filenameSlug: `fuel-consumption-rate-${period.replace(/\s/g, '')}` };
}

export default function FuelConsumptionRateReport({ orgId, orgCode, companyName }) {
  const today = fleetDay(Date.now());
  // Today until another day is picked (operator, 13 Nov 2026)
  const [days, setDays] = useState({ from: today, to: today });
  const [run, setRun] = useState({ status: 'idle' });
  // One category or all (operator, 13 Nov 2026): the organisation's fleet groups, Tankers, Finished Goods …
  const [group, setGroup] = useState(null);
  const groups = fuelGroupsFor(orgCode);
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);
  const qc = useQueryClient();

  const fleet = companyName ?? orgCode ?? '';

  const execute = async () => {
    if (!orgId) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const [data, uploadedList] = await Promise.all([
        loadFuelConsumptionRate({ orgId, from: days.from, to: days.to }),
        fleetListEntries(qc, orgId),
      ]);
      if (id !== runId.current) return;
      const period = days.from === days.to ? days.from : `${days.from} – ${days.to}`;
      // A target from the fleet Excel's TYPE where none is set by registration (operator, 13 Nov 2026)
      const rows = withTypeTargets(data.rows ?? [], fleetEntriesFor(orgCode, uploadedList));
      setRun({ status: 'done', rows, totals: data.totals, period, from: days.from, to: days.to });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const done = run.status === 'done' ? run : null;
  const allRows = done?.rows ?? NONE;
  const rows = useMemo(() => (group ? rowsInGroup(allRows, orgCode, group) : allRows), [allRows, orgCode, group]);
  // The whole fleet's as the server gave them; one category's worked out the same way over its rows
  const totals = group ? totalsOf(rows) : (done?.totals ?? null);
  const counts = useMemo(() => groupCounts(allRows, orgCode), [allRows, orgCode]);

  // Menengai's own sheet, their columns and colours (operator, 13 Nov 2026); the general one elsewhere
  const morl = isMorlFcr(orgCode);
  const fleetWords = group ? `${fleet} · ${group}` : fleet;
  const sheet = () => (morl ? fcrMorlDoc(rows, { from: done.from, to: done.to, fleet: fleetWords, orgCode })
    : fcrDoc(rows, { from: done.from, to: done.to, fleet: fleetWords, orgCode, totals }));
  const editor = useReportEditor({ orgId, source: rows, build: sheet });

  // Menengai's fifteen columns are laid out across a landscape page (lib/fuelRateMorl): the server turns
  // the page only when asked, so their sheet is always asked for landscape, whichever way is picked
  const makePdf = (picked = true) => {
    const landscape = morl || picked;
    return editor.edited ? editor.make(landscape) : makeReportDoc({ orgId, landscape, doc: sheet() });
  };
  const preview = usePdfPreview(makePdf);

  const save = async (as, landscape = true) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makePdf(landscape);
      if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };

  const saveCsv = () => {
    if (!done) return;
    const { head, rows: data, filenameSlug: slug } = toCsv(rows, done.period);
    const filenameSlug = group ? `${slug}-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : slug;
    if (morl) {
      const s = morlFcrSheet(rows);
      downloadTableCsv({ head: s.head, headFills: s.headFills, body: s.body, filenameSlug });
      return;
    }
    downloadTableCsv({ head, body: data, filenameSlug });
  };

  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a date range' : null;
  const totalFilled = rows.reduce((s, r) => s + (r.filledL || 0), 0);
  const whole = (n) => Math.round(n ?? 0).toLocaleString('en-GB');
  // Over the report, as on Speed and Probe: dashes until there are rows to count
  const values = done && rows.length
    ? [rows.length, whole(totals?.distanceKm), whole(totalFilled), whole(totals?.consumedL), rate(totals?.kmPerL)]
    : KPI_LABELS.map((label) => <span key={label} className="frp-kpi-none">-</span>);

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker
          from={days.from} to={days.to} today={today}
          maxDays={MAX_DAYS} spans={[7, 14, 31]} label="Date range"
          onChange={(from, to) => setDays({ from, to: to ?? from })}
        />
        {groups && (
          <ChoicePicker icon="ti-users-group" label="Category" value={group}
                        options={[{ value: null, label: 'All', ...(done ? { note: allRows.length } : {}) },
                          ...groups.map((g) => ({ value: g.name, label: g.name, ...(done ? { note: counts[g.name] ?? 0 } : {}) }))]}
                        onChange={setGroup} />
        )}
        <button
          type="button" className="sp4-submit-btn frp-run rpt-run"
          onClick={execute}
          disabled={Boolean(problem) || run.status === 'loading'}
          title={problem ?? 'Make the report for this date range'}
        >
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
      {run.status === 'idle' && (
        <EmptyNote icon={<ReportIcon name="fuelRate" />} title="Fuel Consumption Rate">
          Pick a date range and run the report to see per-vehicle fuel consumption rates.
        </EmptyNote>
      )}
      {run.status === 'loading' && (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">
          The server is balancing each unit&apos;s fuel over the range. A long range takes longer the first time.
        </EmptyNote>
      )}
      {run.status === 'error' && (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
          {run.message}
        </EmptyNote>
      )}

      {done && rows.length === 0 && (
        <EmptyNote icon={<ReportIcon name="fuelRate" />} title="No Units to Report">
          {group ? `No ${group} units to report in this period.` : 'No units to report in this period.'}
        </EmptyNote>
      )}

      {done && rows.length > 0 && (
        <>
          <TableToolbar
            summary={<>
              Fuel Consumption Rate · <strong>{rows.length}</strong> vehicle{rows.length === 1 ? '' : 's'}
              <span className="rpt-sub"> · {fleetWords} · {done.period} · fleet rate over the {totals?.measured ?? 0} units with a measured figure</span>
            </>}
            onCsv={saveCsv}
            onPdf={file.busy ? undefined : (landscape) => save('pdf', landscape)} pdfWays
            actions={<>
              {editor.button}
              {file.busy
                ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                : file.error ? <span className="rpt-warn">{file.error}</span> : null}
              <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
              <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
            </>}
          />
          {preview.state && <PdfPreview state={preview.state} title="Fuel Consumption Rate report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}

          {morl ? (
            <div className="sp4-table-scroll rpt-scroll">
              {/* Menengai's sheet: their columns and their head colours, as a band over each head, in the app's type */}
              <table className="sp4-table rpt-table fcr-morl" aria-describedby="fcr-morl-range">
                <caption id="fcr-morl-range" className="fcr-morl__range">{done.from === done.to ? done.from : `${done.from} to ${done.to}`}</caption>
                <thead>
                  <tr>{MORL_FCR_COLUMNS.map((c, i) => (
                    <th key={c.head} scope="col" className={`fcr-morl__th${c.fill ? ` fcr-morl__th--${bandOf(c.fill)}` : ''}${i > 0 && i < EXPECT_COL ? ' sp4-th--right' : ''}`}>{c.head}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {morlFcrTable(rows).body.map((cells, ri) => (
                    <tr key={ri} className="sp4-tr">
                      {cells.map((c, i) => (
                        <td key={i} className={i === 0 ? 'fcr-plate' : i === EXPECT_COL ? `fcr-morl__expect${c.fill ? ' fcr-morl__expect--above' : ''}` : i < MORL_FCR_COLUMNS.length - 1 ? `fcr-morl__num${i === RATE_COL ? ' fcr-morl__rate' : ''}` : 'fcr-morl__words'}
                            style={i === RATE_COL && c.fill ? { '--fcr-scale': c.fill } : undefined}>{c.text}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="sp4-table-scroll rpt-scroll">
            <table className="sp4-table rpt-table fcr-table">
              <thead>
                <tr>
                  <th className="fcr-reg">Registration</th>
                  <th className="fcr-num">Target (km/L)</th>
                  <th className="fcr-num">Distance (km)</th>
                  <th className="fcr-num">Initial Level (L)</th>
                  <th className="fcr-num">Amount Filled (L)</th>
                  <th className="fcr-num">Suspected Theft (L)</th>
                  <th className="fcr-num">Final Level (L)</th>
                  <th className="fcr-num fcr-consumed">Amount Consumed (L)</th>
                  <th className="fcr-num fcr-rate">Rate (km/L)</th>
                  <th className="fcr-comment">Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vehicleId} className="sp4-tr">
                    <td className="fcr-reg fcr-plate">{r.plate}</td>
                    <td className="fcr-num">{r.target?.words ?? '—'}</td>
                    <td className="fcr-num">{kms(r.distanceKm)}</td>
                    <td className="fcr-num">{litres(r.startL)}</td>
                    <td className="fcr-num">{litres(r.filledL)}</td>
                    <td className="fcr-num">{r.theftL ? litres(r.theftL) : '—'}</td>
                    <td className="fcr-num">{litres(r.endL)}</td>
                    <td className={`fcr-num fcr-consumed${r.consumedL == null ? ' fcr-zero' : ''}`}>{litres(r.consumedL)}</td>
                    <td className={`fcr-num fcr-rate${r.kmPerL == null ? ' fcr-zero' : r.belowTarget ? ' fcr-below' : ' fcr-ok'}`}>
                      {rate(r.kmPerL)}
                    </td>
                    <td className="fcr-comment">{comment(r) || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fcr-total-row">
                  <td className="fcr-reg">Total / Fleet</td>
                  <td className="fcr-num" />
                  <td className="fcr-num">{kms(totals?.distanceKm)}</td>
                  <td className="fcr-num" />
                  <td className="fcr-num">{litres(totalFilled)}</td>
                  <td className="fcr-num" />
                  <td className="fcr-num" />
                  <td className="fcr-num fcr-consumed">{litres(totals?.consumedL)}</td>
                  <td className="fcr-num fcr-rate">{rate(totals?.kmPerL)}</td>
                  <td className="fcr-comment" />
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </>
      )}
      </div>
    </>
  );
}
