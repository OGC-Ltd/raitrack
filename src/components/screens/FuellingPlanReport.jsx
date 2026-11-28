/*
 * Fuelling Plan, a tab under Movements › Fuel (operator 2026-11-27, after
 * FactorySuite's own "Fuelling: plan vs actual" for Mufindi): one day or a range
 * of up to 14 days (each day judged against its own plan, the days added), every
 * machine an approved work plan or vehicle request asked fuel for, against what
 * FactorySuite's pumps put in. fleet-server planner/fuelling-plan works it out;
 * this page shows it, and the PDF is the server's, drawn with the logos as the
 * Logbook's is. The status key and the plate search narrow the machine list
 * here; the PDF is always every machine over the days picked.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { fuellingPlanPdf, getFuellingPlan } from '../../api/fuellingPlan';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { dayWords, periodWords, plateHas, yesterday } from '../../lib/fuelFilledReport';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import PlateFind from './PlateFind';
import DateRangePicker from '../layout/DateRangePicker';
import './FuellingPlanReport.css';

const fmt = (n) => Math.round(n).toLocaleString('en-GB');
const fmtL = (n) => n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const signed = (n) => (n > 0 ? `+${fmtL(n)}` : fmtL(n));
const pct = (n, of) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '-');
const plural = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`;
const DAY_MS = 86_400_000;
const OFF_PLAN = 'Off plan';
// The bar's order, as FactorySuite's: the ones to chase first
const STATUSES = ['Not fuelled', 'Fuelling now', 'Short', 'Over', 'As planned'];
const TONE = { 'Not fuelled': 'crit', 'Fuelling now': 'info', Short: 'warn', Over: 'over', 'As planned': 'ok', [OFF_PLAN]: 'idle' };
// The list's order: what is still moving, then the ones to chase, then the done
const LIST_ORDER = ['Fuelling now', 'Short', 'Over', 'Not fuelled', 'As planned'];
const HEADS = ['Machine', 'Type', 'Site', 'Department', 'Plan', 'Planned L', 'Fuelled L', 'Variance L'];
const FIGURES = new Set([5, 6, 7]);
const titleCase = (s) => String(s ?? '').toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

function Kpi({ value, label, tone }) {
  return (
    <div className="sp4-kpi">
      <span className={`sp4-kpi-n${tone ? ` fpr-n--${tone}` : ''}`}>{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

/** A labelled track and its fill, the figure on the right. */
function Meter({ name, figure, of, fill, max, tone = 'accent', faint = false }) {
  const track = max > 0 ? Math.max(2, (of / max) * 100) : 100;
  const filled = max > 0 && fill > 0 ? Math.max(1.5, Math.min(100, (fill / max) * 100)) : 0;
  return (
    <li className="fpr-meter">
      <span className={`fpr-meter__name${faint ? ' fpr-meter__name--faint' : ''}`}>{name}</span>
      <span className="fpr-meter__fig">{figure}</span>
      <span className="fpr-meter__track" style={{ width: `${track}%` }} aria-hidden="true" />
      {filled > 0 && <span className={`fpr-meter__fill fpr-fill--${tone}`} style={{ width: `${filled}%` }} aria-hidden="true" />}
    </li>
  );
}

/** At most 14 days, as the server takes. */
const MAX_RANGE_DAYS = 14;
/** How often a period that is not over yet reads the pumps again. */
const REFRESH_MS = 120_000;
const shortDay = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const cellsOf = (m) => m.status === OFF_PLAN
  ? [m.machine, m.type ?? 'Unspecified', m.site ?? '-', m.department ? titleCase(m.department) : '-', 'Off plan', '', fmtL(m.fuelledL), '']
  : [m.machine, m.type ?? 'Unspecified', m.site ?? '-', m.department ? titleCase(m.department) : '-',
    m.plannedL == null ? 'Full tank' : m.request ? 'Request' : 'Litres',
    m.plannedL == null ? '' : fmtL(m.plannedL), fmtL(m.fuelledL), m.diffL == null ? '' : signed(m.diffL)];

export default function FuellingPlanReport({ orgId, companyName, orgCode, active = true }) {
  const today = yesterday(Date.now() + DAY_MS);
  const quick = [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: yesterday(Date.now()), to: yesterday(Date.now()) },
    { key: 'week', label: 'Last 7 days', from: yesterday(Date.now() - 5 * DAY_MS), to: today },
  ];
  const [days, setDays] = useState(() => ({ from: today, to: today }));
  const [run, setRun] = useState({ status: 'idle' });
  const [status, setStatus] = useState(null);
  const [find, setFind] = useState('');
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);
  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a day' : days.to > today ? 'That day has not happened yet' : null;

  // A quick chip passes its own days: they are always a real, past period.
  // `quiet`: a refresh of the days on screen; the report stays up while it reads,
  // the status filter is kept, and a failed refresh leaves the figures as they were.
  const execute = async (d = days, quiet = false) => {
    if (!orgId || (problem && d === days)) return;
    const id = ++runId.current;
    if (!quiet) setRun({ status: 'loading' });
    try {
      const plan = await getFuellingPlan({ orgId, from: d.from, to: d.to });
      if (id !== runId.current) return;
      setRun({ status: 'done', plan });
      if (!quiet) setStatus(null);
    } catch (err) {
      if (id === runId.current && !quiet) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = run.status === 'done' && run.plan?.factory ? run.plan : null;

  // The figures are read once per run, and the pumps keep fuelling: the page fell
  // behind the PDF, which is read fresh on each click (operator 2026-11-28: "the
  // values here are not updated, to what the pdf has"). So a PDF, JPEG or preview
  // refreshes the page with it, and a period that is not over yet refreshes
  // every two minutes and when the tab comes back into view.
  const refresh = useRef(() => {});
  refresh.current = () => { if (plan) execute({ from: plan.from ?? plan.day, to: plan.to ?? plan.day }, true); };
  const live = Boolean(plan) && !plan.closed && active;
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') refresh.current(); };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [live]);
  const t = plan?.totals;
  const from = plan?.from ?? plan?.day, to = plan?.to ?? plan?.day;
  const several = Boolean(plan) && from !== to;
  const period = plan ? (several ? periodWords(from, to) : dayWords(from)) : '';
  const everyRow = useMemo(() => (plan ? [...plan.machines, ...plan.offPlan.map((m) => ({ ...m, status: OFF_PLAN }))] : []), [plan]);
  const picked = useMemo(() => (status ? everyRow.filter((m) => m.status === status) : everyRow), [everyRow, status]);
  const rows = useMemo(() => (find.trim() ? picked.filter((m) => plateHas(m.machine, find)) : picked), [picked, find]);
  const groups = useMemo(() => [...LIST_ORDER, OFF_PLAN]
    .map((s) => ({ status: s, rows: rows.filter((m) => m.status === s) }))
    .filter((g) => g.rows.length), [rows]);
  const typeMax = useMemo(() => Math.max(0, ...(plan?.byType ?? []).map((g) => Math.max(g.plannedL, g.fuelledL))), [plan]);
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, plan?.machines.filter((m) => m.status === s).length ?? 0])), [plan]);

  const values = t
    // Litres delivered: every litre the pumps issued, full tanks and off plan too (25 Nov: 6,651 L, not 5,960)
    ? [`${fmt(t.fuelled)} of ${fmt(t.planned)}`, fmt(t.deliveredL ?? (t.fuelledL + (t.offPlanL ?? 0))),fmt(t.notFuelled), fmt(t.short), fmt(t.asPlanned)]
    : [0, 1, 2, 3, 4].map((i) => <span key={i} className="frp-kpi-none">-</span>);

  const makePdf = () => {
    refresh.current();
    return fuellingPlanPdf({ orgId, from: plan.from ?? plan.day, to: plan.to ?? plan.day });
  };
  const preview = usePdfPreview(makePdf);
  const save = async (as) => {
    if (!plan || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makePdf();
      if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };
  const saveCsv = () => {
    if (!plan) return;
    downloadTableCsv({
      head: ['Day', 'Status', ...HEADS],
      body: rows.map((m) => [m.day, m.status, ...cellsOf(m)]),
      filenameSlug: `fuelling-plan-vs-actual-${from}${several ? `-to-${to}` : ''}`,
    });
  };
  const fleet = companyName ?? orgCode ?? '';

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          <Kpi label="Machines fuelled" value={values[0]} />
          <Kpi label="Litres delivered" value={values[1]} />
          <Kpi label="Not fuelled" value={values[2]} tone={t?.notFuelled ? 'crit' : undefined} />
          <Kpi label="Fuelled short" value={values[3]} tone={t?.short ? 'warn' : undefined} />
          <Kpi label="As planned" value={values[4]} tone={t?.asPlanned ? 'ok' : undefined} />
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Day">
          {quick.map((q) => {
            const on = days.from === q.from && days.to === q.to;
            return (
              <button key={q.key} type="button" aria-pressed={on} disabled={!orgId || run.status === 'loading'}
                      className={`sp4-filter-chip${on ? ' sp4-filter-chip--on' : ''}`}
                      onClick={() => { const d = { from: q.from, to: q.to }; setDays(d); execute(d); }}>
                {q.label}
              </button>
            );
          })}
        </div>
        <DateRangePicker from={days.from} to={days.to} today={today} maxDays={MAX_RANGE_DAYS} spans={[]} quickPicks={false} label="Days"
                         on={!quick.some((q) => days.from === q.from && days.to === q.to)} onChange={(from, to) => setDays({ from, to: to ?? from })} />
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => execute()}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for these days'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="fuellingPlan" />} title="Fuelling Plan">
            The work plans and vehicle requests against what the pumps put in, for a day or a range of days.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">Reading the plans and fuellings from FactorySuite…</EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: () => execute() }}>
            {run.message}
          </EmptyNote>
        )}
        {run.status === 'done' && !plan && (
          <EmptyNote icon={<ReportIcon name="fuellingPlan" />} title="No Fuel Plans">
            {fleet || 'This organisation'} has no FactorySuite work plans to report on.
          </EmptyNote>
        )}
        {plan && !t.planned && !plan.offPlan.length && (
          <EmptyNote icon={<ReportIcon name="fuellingPlan" />} title="Nothing Planned">
            No machine was on an approved work plan or vehicle request on {period}, and the pumps fuelled none.
          </EmptyNote>
        )}
        {plan && (t.planned > 0 || plan.offPlan.length > 0) && (
          <>
            <TableToolbar
              summary={<>
                Fuelling Plan · <strong>{plural(t.fuelled, 'machine')} fuelled</strong> of {fmt(t.planned)}
                <span className="rpt-sub"> · {fleet} · {period}{plan.closed ? '' : ', so far'}</span>
                {several && <span className="rpt-sub" title="Each day is judged against its own plan: a machine counts once for each day it was planned"> · counted day by day</span>}
                {plan.pendingLines > 0 && <span className="rpt-sub" title="Plan lines still waiting for approval are not counted"> · {plural(plan.pendingLines, 'line')} awaiting approval</span>}
              </>}
              onCsv={saveCsv}
              actions={<>
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <button type="button" className="sp4-ghost-btn" onClick={() => save('jpeg')} disabled={Boolean(file.busy)} title="The PDF report as an image">
                  <i className="ti ti-photo" aria-hidden="true" /> JPEG
                </button>
                <button type="button" className="sp4-ghost-btn" onClick={() => save('pdf')} disabled={Boolean(file.busy)} title="Every machine over these days as a PDF, with the logos">
                  <i className="ti ti-file-type-pdf" aria-hidden="true" /> PDF
                </button>
                <button type="button" className="sp4-ghost-btn" onClick={() => preview.open(false)} disabled={Boolean(file.busy)} title="See the PDF before you download it">
                  <i className="ti ti-eye" aria-hidden="true" /> Preview
                </button>
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Fuelling plan vs actual" edited={0} onRetry={preview.retry} onClose={preview.close} />}

            <section className="fpr-overview" aria-label="The days at a glance">
              <p className="fpr-lead">{plan.lead}</p>
              {t.planned > 0 && (
                <div className="fpr-stand">
                  <div className="fpr-bar" role="img" aria-label={STATUSES.filter((s) => counts[s]).map((s) => `${s} ${counts[s]}`).join(', ')}>
                    {STATUSES.filter((s) => counts[s]).map((s) => (
                      <span key={s} className={`fpr-bar__part fpr-fill--${TONE[s]}`} style={{ flexGrow: counts[s] }} />
                    ))}
                  </div>
                  <div className="fpr-key" role="group" aria-label="Show machines by status">
                    {[...STATUSES.filter((s) => counts[s]), ...(plan.offPlan.length ? [OFF_PLAN] : [])].map((s) => {
                      const n = s === OFF_PLAN ? plan.offPlan.length : counts[s];
                      const on = status === s;
                      return (
                        <button key={s} type="button" className={`fpr-key__item${on ? ' fpr-key__item--on' : ''}`} aria-pressed={on}
                                onClick={() => setStatus(on ? null : s)} title={on ? 'Show every machine' : `Show only ${s.toLowerCase()}`}>
                          <span className={`fpr-key__dot fpr-fill--${TONE[s]}`} aria-hidden="true" />
                          {s} <strong>{fmt(n)}</strong>{s !== OFF_PLAN && <span className="fpr-key__pct">{pct(n, t.planned)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="fpr-panels">
                {plan.bySite.length > 0 && (
                  <div className="fpr-panel">
                    <h3 className="fpr-panel__title">Progress by site</h3>
                    <p className="fpr-panel__note">Machines fuelled out of machines planned at each site</p>
                    <ul className="fpr-meters">
                      {plan.bySite.map((g) => (
                        <Meter key={g.name} name={g.name} figure={`${fmt(g.fuelled)} of ${fmt(g.planned)} fuelled`} of={g.planned} fill={g.fuelled} max={g.planned} faint={/no site/i.test(g.name)} />
                      ))}
                    </ul>
                  </div>
                )}
                {plan.byType.length > 0 && (
                  <div className="fpr-panel">
                    <h3 className="fpr-panel__title">Litres by equipment type</h3>
                    <p className="fpr-panel__note">Litres fuelled against litres planned; full tanks with no litre figure are left out</p>
                    <ul className="fpr-meters">
                      {plan.byType.map((g) => (
                        <Meter key={g.name} name={g.name} figure={`${fmtL(g.fuelledL)} / ${fmtL(g.plannedL)} L`} of={g.plannedL} fill={g.fuelledL} max={typeMax}
                               tone={g.fuelledL > g.plannedL * 1.1 ? 'over' : 'accent'} faint={g.name === 'Unspecified'} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            <PlateFind value={find} onChange={setFind} shown={rows.length} total={picked.length} noun="machine"
                       follows="The PDF has every machine." placeholder="Find a machine, e.g. EX-28" label="Find a machine by its code" none="No machine matches that code." />
            {rows.length > 0 && (
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table">
                <thead><tr>{several && <th scope="col">Day</th>}{HEADS.map((h, i) => <th key={h} scope="col" className={FIGURES.has(i) ? 'rpt-num' : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {groups.map((g) => {
                    const planned = g.rows.reduce((a, m) => a + (m.plannedL ?? 0), 0);
                    const fuelled = g.rows.reduce((a, m) => a + m.fuelledL, 0);
                    return (
                      <Fragment key={g.status}>
                        <tr className="rpt-group">
                          <th colSpan={HEADS.length + (several ? 1 : 0)} scope="rowgroup">
                            <span className="rpt-group__name"><span className={`fpr-key__dot fpr-fill--${TONE[g.status]}`} aria-hidden="true" /> {g.status}</span>
                            <span className="rpt-group__meta">
                              {plural(g.rows.length, 'machine')}
                              {g.status === OFF_PLAN ? `, ${fmtL(fuelled)} L fuelled, not on any approved plan or request` : `, ${fmtL(fuelled)} of ${fmtL(planned)} L planned`}
                            </span>
                          </th>
                        </tr>
                        {g.rows.map((m) => {
                          const cells = cellsOf(m);
                          return (
                            <tr key={`${g.status}|${m.day}|${m.machine}`} className="sp4-tr">
                              {several && <td className="rpt-nowrap">{shortDay(m.day)}</td>}
                              {cells.map((v, i) => (
                                <td key={HEADS[i]} className={[i === 0 && 'rpt-unit', FIGURES.has(i) && 'rpt-num', (i === 1 && !m.type) || (i === 4 && v !== 'Litres') ? 'rpt-sub' : null, i === 7 && m.diffL < 0 ? 'fpr-short' : null].filter(Boolean).join(' ') || undefined}
                                    title={i === 4 && v === 'Request' ? 'A vehicle request no work plan names' : i === 4 && v === 'Full tank' ? 'A full tank with no litre figure: counted in machines, not in litres' : undefined}>
                                  {v === '' ? '-' : v}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </Fragment>
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
