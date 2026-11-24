// Reports › Movements › Fuel › Fuel usage (Mufindi, operator 2026-11-24): what
// the work plans needed, what went into the tanks, and the fuel the pumps never
// recorded, over any period of up to 31 days. A PDF on the letterhead and the
// machine register as Excel. Figures: lib/fuelUsageReport; layout:
// lib/fuelUsageReportPdf.

import { useMemo, useState } from 'react';
import { getFactoryFuel, getProbeFillings } from '../../api/factoryFuel';
import { getFuelCost } from '../../api/analytics';
import { saveLetterheadPdf, letterheadLogos } from '../../api/letterheadPdf';
import { buildFuelUsage, siteOptions, lastFullWeek } from '../../lib/fuelUsageReport';
import { fuelUsageHtml, registerTable, unrecordedTable, periodWords, n0, kes } from '../../lib/fuelUsageReportPdf';
import { daysBetween } from '../../lib/dayRange';
import { fleetDay } from '../../lib/fleetReports';

/** The longest period the plans' endpoint answers for. */
const MAX_DAYS = 31;

export default function FuelUsageReport({ companyId, orgCode, companyName }) {
  const week = lastFullWeek(fleetDay(Date.now()));
  const [from, setFrom] = useState(week.from);
  const [to, setTo] = useState(week.to);
  const [site, setSite] = useState('');
  const [run, setRun] = useState({ status: 'idle' });
  const [saving, setSaving] = useState(null);

  const problem = !from || !to ? 'Pick both days'
    : from > to ? 'The period ends before it starts'
    : daysBetween(from, to).length > MAX_DAYS ? `${MAX_DAYS} days at most`
    : to > fleetDay(Date.now()) ? 'The period cannot end in the future'
    : null;

  const execute = async () => {
    setRun({ status: 'loading' });
    try {
      // The plans and pumps, the probes' fills, and the pump price, side by side.
      // The fills and the price are optional: the report says when they could not be read.
      const [data, fillings, cost] = await Promise.all([
        getFactoryFuel({ companyId, from, to }),
        getProbeFillings({ companyId, from, to }).catch(() => null),
        getFuelCost({ companyId, days: 7 }).catch(() => null),
      ]);
      if (!data?.factory) {
        setRun({ status: 'error', message: 'This fleet does not fuel by FactorySuite work plans.' });
        return;
      }
      setSite((s) => (s && siteOptions(data).includes(s) ? s : ''));
      setRun({ status: 'done', data, fillings, price: cost?.price?.pricePerLitre ?? null, at: Date.now() });
    } catch (err) {
      setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const rep = useMemo(() => (run.status === 'done' ? buildFuelUsage(run.data, { site: site || null, price: run.price, fillings: run.fillings }) : null), [run, site]);
  const sites = useMemo(() => (run.status === 'done' ? siteOptions(run.data) : []), [run]);
  const html = useMemo(() => (rep ? fuelUsageHtml(rep, {
    companyName: companyName ?? orgCode ?? 'Fleet', orgCode, siteWords: site || `All · ${sites.length} sites`, logos: letterheadLogos(), now: run.at,
  }) : null), [rep, companyName, orgCode, site, sites.length, run.at]);

  const fileBase = rep ? `Fuel Usage Report ${companyName ?? orgCode ?? ''}${site ? ` ${site}` : ''} ${rep.from} to ${rep.to}` : 'Fuel Usage Report';
  const save = async (kind) => {
    if (!rep) return;
    setSaving(kind);
    try {
      if (kind === 'pdf') {
        await saveLetterheadPdf(html, { filename: `${fileBase}.pdf`, landscape: true });
      } else {
        const { downloadTableXlsx } = await import('../../utils/xlsxExport');
        const t = kind === 'register' ? registerTable(rep) : unrecordedTable(rep);
        await downloadTableXlsx({
          ...t,
          title: kind === 'register' ? 'Fuel usage — machine register' : 'Fuel usage — no pump record',
          filenameSlug: `fuel-usage-${kind === 'register' ? 'register' : 'no-pump-record'}-${String(orgCode ?? 'fleet').toLowerCase()}${site ? `-${site.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}`,
          meta: [['Period', periodWords(rep.from, rep.to)], ['Sites', site || 'All']],
        });
      }
    } finally {
      setSaving(null);
    }
  };

  const t = rep?.totals;
  return (
    <div className="sp4-root rpt-root" aria-label="Fuel usage">
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <label className="rpt-sub">From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="rpt-sub">To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="rpt-sub">Site{' '}
          <select value={site} onChange={(e) => setSite(e.target.value)} disabled={!sites.length}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={!companyId || run.status === 'loading' || Boolean(problem)} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && <span className="rpt-problem" role="status">{problem}</span>}
        {rep && (
          <>
            <button type="button" className="sp4-ghost-btn" onClick={() => save('pdf')} disabled={Boolean(saving)}>{saving === 'pdf' ? 'Saving…' : 'PDF'}</button>
            <button type="button" className="sp4-ghost-btn" onClick={() => save('register')} disabled={Boolean(saving)}>{saving === 'register' ? 'Saving…' : 'Excel: register'}</button>
            {t.probeKnown && t.unrecorded.fills > 0 && (
              <button type="button" className="sp4-ghost-btn" onClick={() => save('unrecorded')} disabled={Boolean(saving)}>{saving === 'unrecorded' ? 'Saving…' : 'Excel: no pump record'}</button>
            )}
          </>
        )}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && <p className="rpt-sub">Pick the period (the last full week to begin with), then press Run report.</p>}
        {run.status === 'loading' && <p className="rpt-sub" role="status">Reading the work plans, the pumps and the fuel probes…</p>}
        {run.status === 'error' && <p className="rpt-warn" role="alert">The report could not be made: {run.message}</p>}
        {rep && (
          <>
            <p className="rpt-sub">
              {periodWords(rep.from, rep.to)} · {site || 'all sites'} · into tanks <b>{n0(t.probeKnown ? t.intoTank : t.issued)} L</b> against
              {' '}{n0(t.need)} L of need · pump <b>{n0(t.issued)} L</b>
              {t.probeKnown ? <> · no pump record <b style={{ color: '#a33030' }}>{n0(t.unrecorded.litres)} L</b> ({kes(t.unrecorded.cost)})</> : ' · the fuel probes could not be read'}
            </p>
            <iframe title="Fuel usage report preview" srcDoc={html}
                    style={{ width: '100%', height: '78vh', border: '1px solid #c8c8c8', background: '#f4f4f4' }} />
          </>
        )}
      </div>
    </div>
  );
}
