/* Fleet-wide Maintenance dashboard — ported from fleetdash. Layout: 3
   historical charts (real day-by-day fleet activity from the server's
   /maintenance/history endpoint) → filters → the data grid + per-vehicle detail
   cards (Full Checklist + Service History Report) as a master-detail pair.
   Every number is derived from real backend data (odometer/service cycle +
   persisted history), not mock.

   The chart row is 3 charts + the calendar tile, which is the control that
   sets the window all three read — period presets (Today/Month/Year/All), a
   single day, or a range. See MaintenanceCalendar. */
import { useState, useRef, memo } from 'react';
import {
  vehicleReadings, readingCoverage, hasWorkingFuelSensor,
  formatKm, formatHours, formatLitres, formatPct, formatSince, NO_READING,
} from '../../lib/vehicleReadings';
import { useMaintenanceHistory } from '../../hooks/useMaintenanceHistory';
import { useVehicleServiceHistory } from '../../hooks/useVehicleServiceHistory';
import { useVehicleGarageVisits } from '../../hooks/useVehicleGarageVisits';
import { useAppSelector, useCompanies } from '../../context/AppContext';
import { createReport, addSectionTitle, addSummaryCards, addTable, downloadReport } from '../../utils/pdfReport';
import DownloadReportButton from '../shared/DownloadReportButton';
import { downloadOrgReportPdf } from '../../api/reports';
import MaintenanceCalendar from './MaintenanceCalendar';
import './MaintenancePage.css';

// Filters describe what the fleet is REPORTING, not a service state we cannot
// know. See lib/vehicleReadings for why the Overdue/Due Soon/Health grading
// this page used to show was removed wholesale.
//
// ONE predicate per filter, used for BOTH the chip's count and the rows it
// opens. They used to be written separately — the count as arithmetic over
// readingCoverage, the filter as its own condition — which is two statements
// of the same rule that nothing kept in agreement.
//
// The fault filters are scoped to vehicles that HAVE a tracker. A vehicle with
// no unit bound cannot report an odometer, so counting it as "No odometer" does
// not describe a fault anyone can fix; it just makes the number large. On
// SUKARI that is 313 registry rows, which is why "Silent" read 426 when the
// number of trackers that actually went quiet is closer to 110. Those rows get
// their own chip rather than being scattered through three others.
const READING_FILTERS = [
  { key: 'reporting',  label: 'Reporting',   color: '#22c55e', test: (r) => r.isReporting },
  { key: 'silent',     label: 'Silent',      color: '#94a3b8', test: (r) => r.hasTracker && !r.isReporting },
  { key: 'noOdometer', label: 'No odometer', color: '#f59e0b', test: (r) => r.hasTracker && r.odometerKm == null },
  // Fuel-sensor fleet view. "Working" means the probe reports AND its reading
  // is calibrated against the tank — see hasWorkingFuelSensor. The
  // uncalibrated chip is hidden when the count is zero, since it is a
  // maintenance job that either exists or does not.
  { key: 'fuelSensor',   label: 'Fuel sensor',    color: '#06b6d4', test: (r) => hasWorkingFuelSensor(r) },
  // "No fuel sensor" means exactly that, so a probe that IS fitted but is
  // reporting a fault is excluded here and counted under Probe fault instead.
  { key: 'noFuelSensor', label: 'No fuel sensor', color: '#94a3b8', test: (r) => r.hasTracker && r.fuelLitres == null && !r.fuelProbeFault },
  { key: 'fuelUncal',    label: 'Fuel uncalibrated', color: '#ef4444', test: (r) => r.fuelLitres != null && r.fuelPct == null, hideWhenZero: true },
  // A fitted probe transmitting a hardware fault — contamination, a short,
  // water in the tank. Actionable in a way "no sensor" is not: the vehicle
  // needs a workshop visit, not an installation.
  { key: 'probeFault',   label: 'Probe fault', color: '#f97316', test: (r) => r.fuelProbeFault, hideWhenZero: true },
  // Not a sensor fault — a vehicle the provider has no unit for. Hidden when
  // zero, so a fully-bound fleet never sees it.
  { key: 'noTracker',    label: 'No tracker', color: '#64748b', test: (r) => !r.hasTracker, hideWhenZero: true },
];

// The movement cards, straight off /maintenance/history — every metric a
// genuine, already-persisted driver of vehicle wear.
//
// Fuel consumed, Overspeeding incidents and Fuel inconsistency incidents were
// removed from this row. The server still returns all six fields, so restoring
// one is a single line here; nothing downstream was cut. Fuel anomalies are
// reported in far more depth on the Sensor Monitor tab (per-unit FSL events,
// refills, drains and drain patterns), which is where someone chasing a fuel
// problem actually goes.
const HISTORY_CHARTS = [
  { field: 'tripCount',              title: 'Trips',                    agg: 'sum', type: 'bar',  color: '#3b82f6', unit: '',   decimals: 0 },
  { field: 'distanceKm',             title: 'Distance driven',          agg: 'sum', type: 'line', color: '#06b6d4', unit: 'km', decimals: 0 },
  { field: 'avgSpeedKmh',            title: 'Average speed',            agg: 'avg', type: 'line', color: '#8b5cf6', unit: 'km/h', decimals: 1 },
];

const PAGE_SIZE = 20;

export default function MaintenancePage({ vehicles = [], selectedId, onSelectVehicle, orgId }) {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { activeCompany } = useCompanies();
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey]           = useState('urgency');
  const [sortDir, setSortDir]           = useState('asc');
  const [query, setQuery]               = useState('');
  const [page, setPage]                 = useState(1);
  const [range, setRange]               = useState(null);   // calendar selection: {start,end} day-keys, or null for the default window
  const detailColRef = useRef(null);

  // Mobile stacks the grid above the detail cards, so picking a vehicle there
  // auto-scrolls to the result (desktop shows both side by side).
  const selectVehicle = (v) => {
    onSelectVehicle?.(v);
    if (window.innerWidth <= 959) {
      requestAnimationFrame(() => {
        detailColRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  // `range` null = the hook's default window (a full year, the server's max
  // single request); the calendar tile is what sets it otherwise.
  const { history } = useMaintenanceHistory(orgId, range);

  const selectedVehicle = vehicles.find(v => v.id === selectedId) ?? null;
  const { services: serviceHistory } = useVehicleServiceHistory(orgId, selectedVehicle?.vehicleId);
  const { visits: garageVisits }     = useVehicleGarageVisits(orgId, selectedVehicle?.vehicleId);

  const rows     = vehicles.map(v => ({ vehicle: v, readings: vehicleReadings(v) }));
  const coverage = readingCoverage(vehicles);

  // Chip counts, measured by running each filter's own predicate over the same
  // rows the grid draws from. This is what keeps a chip's number equal to the
  // number of rows clicking it produces — the two cannot drift, because there
  // is only one rule.
  const filterCounts = Object.fromEntries(
    READING_FILTERS.map(f => [f.key, rows.reduce((n, r) => n + (f.test(r.readings) ? 1 : 0), 0)]),
  );

  // Charts reading a flat 0 with a "▲ 0%" delta are noise, not analytics — they
  // claim a trend that doesn't exist. Until real trips/odometer readings arrive
  // from the provider, show one honest line instead and give the page over to
  // the vehicle registry, which IS real data.
  //
  // Tested against the fields the row still PLOTS. It used to also count fuel
  // and incident activity, which would now open three movement charts of solid
  // zero on the strength of data none of them draw.
  const hasHistory = history.some(d =>
    (d.tripCount ?? 0) > 0 || (d.distanceKm ?? 0) > 0 || (d.avgSpeedKmh ?? 0) > 0);
  // Show the coverage strip only when at least one channel is actually
  // arriving; a row of zeroes tells the operator nothing.
  const hasReadings = coverage.odometer > 0 || coverage.engineHours > 0 || coverage.fuel > 0;

  // The SAME predicate that produced the chip's count above. 'all' matches no
  // entry, which correctly lets every row through.
  const activeFilter = READING_FILTERS.find(f => f.key === statusFilter);

  const filtered = rows
    .filter(r => !activeFilter || activeFilter.test(r.readings))
    .filter(r => !query ||
      r.vehicle.id.toLowerCase().includes(query.toLowerCase()) ||
      (r.vehicle.driver ?? '').toLowerCase().includes(query.toLowerCase()));

  // Vehicles with NO reading always sort to the bottom, in both directions.
  // A null is "not measured", not a low value; letting the direction flip
  // float 97 empty rows to the top would bury every vehicle that does report.
  // So the null test happens BEFORE the direction is applied.
  const NUMERIC_KEYS = {
    odometer:    (r) => r.odometerKm,
    engineHours: (r) => r.engineHours,
    fuel:        (r) => r.fuelPct,
    lastSeen:    (r) => r.lastReportedAt,
  };
  const sorted = [...filtered].sort((a, b) => {
    const pick = NUMERIC_KEYS[sortKey];
    if (pick) {
      const av = pick(a.readings);
      const bv = pick(b.readings);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;          // unreported: always last
      if (bv == null) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    let cmp = 0;
    if (sortKey === 'vehicle') cmp = a.vehicle.id.localeCompare(b.vehicle.id);
    if (sortKey === 'type')    cmp = (a.vehicle.vehicleType ?? '').localeCompare(b.vehicle.vehicleType ?? '');
    if (sortKey === 'driver')  cmp = (a.vehicle.driver ?? '').localeCompare(b.vehicle.driver ?? '');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage  = Math.min(page, pageCount);
  const pageRows  = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const updateFilter = (fn) => { fn(); setPage(1); };

  // ── PDF reports ──
  // Fleet report: the server-rendered template (kind 'maintenance') — same
  // design as the Analytics/Drivers reports, covering the whole fleet.
  const handleFleetReport = () =>
    downloadOrgReportPdf({
      companyId: activeCompanyId,
      kind: 'maintenance',
      filename: `${activeCompany?.short || 'Fleet'}-Maintenance-Report.pdf`,
    });

  // Single-vehicle report: full checklist + the same merged service/garage
  // history the on-screen Service History Report shows (already fetched for
  // the selected vehicle by the hooks above).
  const handleVehicleReport = () => {
    if (!selectedVehicle) return;
    const v = selectedVehicle;
    const r = vehicleReadings(v);
    const historyRows = [
      ...serviceHistory.map(r => ({
        date: r.servicedAt, type: 'Scheduled', odometerKm: r.odometerKm,
        details: `${r.kmCovered != null ? `${Math.round(r.kmCovered).toLocaleString()} km covered since previous` : 'first recorded service'} · next due at ${Math.round(r.nextServiceOdoKm).toLocaleString()} km`,
      })),
      ...garageVisits.map(g => ({
        date: g.exitedAt, type: 'Garage repair', odometerKm: g.odometerKm,
        details: `${g.garageName} · ${g.durationMinutes} min${g.itemsFixed?.length ? ` · ${g.itemsFixed.map(i => i.name).join(', ')}` : ''}`,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const doc = createReport({
      companyName: activeCompany?.name || 'Fleet',
      reportTitle: 'Vehicle Maintenance Report',
      subtitle:    `${v.id} · ${v.vehicleType} · Driver ${v.driver ?? '—'}`,
      accentColor: activeCompany?.accentColor,
    });
    // Only measured channels. The report used to lead with a "Health %" and
    // counts of Overdue/Due-soon items, none of which were measured.
    addSummaryCards(doc, [
      { value: formatKm(r.odometerKm),         label: 'Odometer',      color: '#3b82f6' },
      { value: formatHours(r.engineHours),     label: 'Engine hours',  color: '#8b5cf6' },
      { value: formatLitres(r.fuelLitres),     label: 'Fuel level',    color: '#06b6d4' },
      { value: formatSince(r.lastReportedAt),  label: 'Last reported', color: r.isReporting ? '#22c55e' : '#94a3b8' },
    ]);
    // The "Full Maintenance Checklist" table that used to sit here listed 13
    // items with an interval, a "due in" and a status — none of it measured.
    // A PDF is the worst place for invented figures: it gets forwarded, filed
    // and quoted long after anyone remembers where the numbers came from.
    if (historyRows.length > 0) {
      addSectionTitle(doc, 'Service History');
      addTable(doc, {
        accentColor: activeCompany?.accentColor || '#22c55e',
        head: ['Date', 'Type', 'Odometer', 'Details'],
        body: historyRows.map(r => [fmtReportDate(r.date), r.type, `${Math.round(r.odometerKm).toLocaleString()} km`, r.details]),
      });
    }
    downloadReport(doc, `${activeCompany?.short || 'Fleet'}-Maintenance-Report-${v.id.replace(/\s+/g, '')}.pdf`);
  };

  return (
    <div className="maint-page">
      <div className="maint-page__inner">
        {/* Historical charts — real day-by-day activity, always above the grid.
            The CHARTS are hidden until there is history, so the page opens on
            the registry rather than a wall of zeroes; the calendar beside them
            is not, because it is the control that sets the window being
            reported on. Hiding it together with the charts would strand anyone
            who picked a quiet range: the only way back to a window with data
            would have just disappeared with the data. */}
        <div className="maint-charts">
          <MaintenanceCalendar selection={range} onSelect={setRange} />
          {hasHistory ? (
            HISTORY_CHARTS.map(cfg => (
              <HistoryChartCard key={cfg.field} {...cfg} history={history} />
            ))
          ) : (
            <div className="maint-nohistory maint-nohistory--inrow">
              <span className="maint-nohistory__title">
                {range ? 'No activity in this window' : 'No service history yet'}
              </span>
              <span className="maint-nohistory__hint">
                {range
                  ? <>Nothing was recorded between {range.start} and {range.end}. Pick a
                     wider period on the left — the {rows.length.toLocaleString()}-vehicle
                     registry below is live either way.</>
                  : <>Trip, distance and speed trends appear here once telemetry starts
                     arriving. The {rows.length.toLocaleString()}-vehicle registry below is live.</>}
              </span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="maint-filters">
          <FilterChip active={statusFilter === 'all'} onClick={() => updateFilter(() => setStatusFilter('all'))} label={`All (${rows.length})`} />
          {hasReadings && READING_FILTERS
            .filter(f => !f.hideWhenZero || filterCounts[f.key] > 0)
            .map(f => (
              <FilterChip
                key={f.key}
                active={statusFilter === f.key}
                onClick={() => updateFilter(() => setStatusFilter(f.key))}
                label={`${f.label} (${filterCounts[f.key]})`}
                color={f.color}
              />
            ))}
          <input
            value={query}
            onChange={e => updateFilter(() => setQuery(e.target.value))}
            placeholder="Search plate or driver…"
            style={{
              marginLeft: 'auto', background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 20, padding: '5px 12px', fontSize: 10.5, color: 'var(--text-1)',
              fontFamily: 'var(--font)', outline: 'none', minWidth: 160,
            }}
          />
          <DownloadReportButton onGenerate={handleFleetReport} permission="report:export" label="Fleet PDF" />
          {selectedVehicle && (
            <DownloadReportButton onGenerate={handleVehicleReport} permission="report:export" label={`${selectedVehicle.id} PDF`} />
          )}
        </div>

        {/* Data grid on the LEFT, detail cards (checklist + service history) on
            the RIGHT (master-detail): click a row on the left, both statements
            on the right update immediately. */}
        <div className="maint-bottom-row">
          <div className="maint-grid-card">
            <div className="maint-grid-scroll">
              <table className="maint-grid">
                <thead>
                  <tr>
                    <SortableTh label="Vehicle"    sortKey="vehicle"     activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Type"       sortKey="type"        activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Driver"     sortKey="driver"      activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Odometer"     sortKey="odometer"    activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Engine hours" sortKey="engineHours" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Fuel"         sortKey="fuel"        activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Last reported" sortKey="lastSeen"   activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ vehicle: v, readings: r }) => (
                    <tr
                      key={v.id}
                      className={v.id === selectedId ? 'maint-row--selected' : ''}
                      onClick={() => selectVehicle(v)}
                    >
                      <td data-label="Vehicle" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{v.id}</td>
                      <td data-label="Type">{v.vehicleType}</td>
                      <td data-label="Driver">{v.driver}</td>
                      <td data-label="Odometer" style={{ color: r.odometerKm  == null ? 'var(--text-2)' : undefined }}>{formatKm(r.odometerKm)}</td>
                      <td data-label="Engine hours" style={{ color: r.engineHours == null ? 'var(--text-2)' : undefined }}>{formatHours(r.engineHours)}</td>
                      {/* A faulty probe reads as a fault, not as an empty
                          cell — "—" here would be indistinguishable from a
                          vehicle that never had a sensor fitted. */}
                      <td data-label="Fuel" style={{ color: r.fuelProbeFault ? '#f97316' : r.fuelLitres == null ? 'var(--text-2)' : undefined }}>
                        {r.fuelProbeFault
                          ? <span title="The fuel probe is transmitting, but reporting a fault instead of a level. Needs a workshop visit.">Probe fault</span>
                          : r.fuelPct != null ? `${formatPct(r.fuelPct)} · ${formatLitres(r.fuelLitres)}` : formatLitres(r.fuelLitres)}
                      </td>
                      <td data-label="Last reported" style={{ color: r.isReporting ? undefined : 'var(--text-2)' }}>{formatSince(r.lastReportedAt)}</td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr><td className="maint-grid__empty" colSpan={7} style={{ color: 'var(--text-2)', textAlign: 'center', padding: '20px 0' }}>No vehicles match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {sorted.length > 0 && (
              <Pagination
                page={safePage}
                pageCount={pageCount}
                total={sorted.length}
                pageSize={PAGE_SIZE}
                onPage={setPage}
              />
            )}
          </div>

          <div className="maint-detail-col" ref={detailColRef}>
            {selectedVehicle
              ? <VehicleReadingsCard vehicle={selectedVehicle} />
              : <div className="maint-report-card"><FleetReadingsSummary vehicles={vehicles} /></div>}
            <ServiceHistoryReport vehicle={selectedVehicle} services={serviceHistory} garageVisits={garageVisits} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Per-vehicle sensor readings ─────────────────────────────────────────────
// This replaced a 13-item "Full Checklist" (Engine Oil & Filter, Tyre Rotation,
// Brake Pads…) with a status and a % remaining against each. Not one of those
// figures was measured: they were `odometerKm % <invented interval>` against a
// reset point that is 0 for every vehicle in production. There is no
// maintenance system feeding this platform, so a checklist cannot be honest.
// What the trackers do report is below.
const READING_ROWS = [
  { key: 'odometerKm',  label: 'Odometer',        hint: "unit's own mileage counter",  fmt: formatKm },
  { key: 'engineHours', label: 'Engine hours',    hint: 'engine-hours counter',        fmt: formatHours },
  { key: 'fuelLitres',  label: 'Fuel level',      hint: 'calibrated probe',            fmt: formatLitres },
  { key: 'fuelPct',     label: 'Fuel remaining',  hint: 'of tank capacity',            fmt: formatPct },
];

function VehicleReadingsCard({ vehicle }) {
  const r = vehicle ? vehicleReadings(vehicle) : null;
  const issuedAt = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="maint-report-card">
      <div className="maint-report__head">
        <span className="maint-section-title">Sensor Readings</span>
        <span className="maint-report__subject">{vehicle ? vehicle.id : 'No vehicle selected'}</span>
      </div>

      {!vehicle ? (
        <div className="maint-chart-card__empty">Select a vehicle to see its readings.</div>
      ) : (
        <div className="maint-invoice">
          <div className="maint-invoice__title">Reported Channels</div>
          <div className="maint-invoice__meta-row">
            <span>{vehicle.vehicleType ?? '—'}</span>
            <span>{issuedAt}</span>
          </div>
          <div className="maint-invoice__meta-row">
            <span>Last reported <b style={r.isReporting ? { color: '#22c55e' } : { color: '#94a3b8' }}>
              {formatSince(r.lastReportedAt)}
            </b></span>
            <span>Ignition <b>{r.engineOn == null ? NO_READING : r.engineOn ? 'on' : 'off'}</b></span>
          </div>

          <div className="maint-invoice__rule" />
          <div className="maint-invoice__lines">
            {READING_ROWS.map(({ key, label, hint, fmt }) => {
              const value = r[key];
              return (
                <div className="maint-invoice__line" key={key}>
                  <span className="maint-invoice__line-name">
                    {label}
                    <em style={{ opacity: 0.55, fontStyle: 'normal', marginLeft: 6, fontSize: '0.85em' }}>{hint}</em>
                  </span>
                  <span className="maint-invoice__leader" />
                  <span style={{ fontWeight: 700, color: value == null ? 'var(--text-2)' : undefined }}>
                    {fmt(value)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="maint-invoice__rule" />
          <div className="maint-invoice__totals">
            <span style={{ color: 'var(--text-2)' }}>
              {NO_READING} means this unit does not report that channel — not a zero.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Fleet-wide: which channels are actually arriving. This replaced a per-item
// "how many vehicles have Brake Pads overdue" table, which counted vehicles
// against intervals nobody supplied.
function FleetReadingsSummary({ vehicles }) {
  if (vehicles.length === 0) {
    return <div className="maint-chart-card__empty">No vehicles to summarise.</div>;
  }

  const c = readingCoverage(vehicles);
  const pct = (n) => (c.total ? Math.round((n / c.total) * 100) : 0);
  const rows = [
    { label: 'Reporting now',  n: c.reporting,    hint: 'seen in the last hour' },
    { label: 'Odometer',       n: c.odometer,     hint: 'mileage counter present' },
    { label: 'Engine hours',   n: c.engineHours,  hint: 'hours counter present' },
    { label: 'Fuel sensor',    n: c.fuel,         hint: 'probe fitted and calibrated' },
    ...(c.fuelUncalibrated ? [{ label: 'Fuel uncalibrated', n: c.fuelUncalibrated, hint: 'probe reports, calibration invalid' }] : []),
  ];

  return (
    <div className="maint-invoice">
      <div className="maint-invoice__title">Sensor Coverage</div>
      <div className="maint-invoice__meta-row">
        <span>Vehicles <b>{c.total}</b></span>
        <span>Reporting <b style={c.reporting ? { color: '#22c55e' } : undefined}>{c.reporting}</b></span>
      </div>

      <div className="maint-invoice__rule" />
      <div className="maint-invoice__lines">
        {rows.map(({ label, n, hint }) => (
          <div className="maint-invoice__line" key={label}>
            <span className="maint-invoice__line-name">
              {label}
              <em style={{ opacity: 0.55, fontStyle: 'normal', marginLeft: 6, fontSize: '0.85em' }}>{hint}</em>
            </span>
            <span className="maint-invoice__leader" />
            <span style={{ fontWeight: 700 }}>{n} / {c.total} <em style={{ opacity: 0.6, fontStyle: 'normal' }}>({pct(n)}%)</em></span>
          </div>
        ))}
      </div>

      <div className="maint-invoice__rule" />
      <div className="maint-invoice__totals">
        <span style={{ color: 'var(--text-2)' }}>
          Service scheduling needs a maintenance system; none is connected, so no
          due dates or wear estimates are shown.
        </span>
      </div>
    </div>
  );
}

function ServiceHistoryReport({ vehicle, services, garageVisits }) {
  const entries = [
    ...services.map(s => ({
      kind: 'scheduled',
      id: `svc-${s.id}`,
      date: s.servicedAt,
      odometerKm: s.odometerKm,
      kmCovered: s.kmCovered,
      nextServiceOdoKm: s.nextServiceOdoKm,
    })),
    ...garageVisits.map(v => ({
      kind: 'garage',
      id: `gv-${v.id}`,
      date: v.exitedAt,
      enteredAt: v.enteredAt,
      odometerKm: v.odometerKm,
      garageName: v.garageName,
      durationMinutes: v.durationMinutes,
      severityScore: v.severityScore,
      itemsFixed: v.itemsFixed,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="maint-report-card">
      <div className="maint-report__head">
        <span className="maint-section-title">Service History Report</span>
        <span className="maint-report__subject">{vehicle ? `${vehicle.id} · ${vehicle.vehicleType}` : 'No vehicle selected'}</span>
      </div>

      {!vehicle ? (
        <div className="maint-chart-card__empty">Click a vehicle on the left to see its service history.</div>
      ) : entries.length === 0 ? (
        <div className="maint-chart-card__empty">No service recorded yet for {vehicle.id}.</div>
      ) : (
        <div className="maint-invoice">
          <div className="maint-invoice__title">Service Statement</div>
          <div className="maint-invoice__meta-row">
            <span>Vehicle <b>{vehicle.id}</b></span>
            <span>{entries.length} record{entries.length === 1 ? '' : 's'}</span>
          </div>

          <div className="maint-invoice__rule" />

          <div className="maint-invoice__lines">
            {entries.map(e => e.kind === 'garage'
              ? <GarageVisitEntry key={e.id} entry={e} />
              : <ScheduledServiceEntry key={e.id} entry={e} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtReportDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ScheduledServiceEntry({ entry }) {
  return (
    <div className="maint-invoice__entry">
      <div className="maint-invoice__line">
        <span className="maint-invoice__name">{fmtReportDate(entry.date)}</span>
        <span className="maint-invoice__leader" aria-hidden="true" />
        <span className="maint-invoice__type-tag" style={{ color: '#3b82f6' }}>Scheduled</span>
      </div>
    </div>
  );
}

function GarageVisitEntry({ entry }) {
  return (
    <div className="maint-invoice__entry">
      <div className="maint-invoice__line">
        <span className="maint-invoice__name">{fmtReportDate(entry.date)}</span>
        <span className="maint-invoice__leader" aria-hidden="true" />
        <span className="maint-invoice__type-tag" style={{ color: '#f59e0b' }}>Garage Repair</span>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick, color }) {
  return (
    <button
      className={`maint-chip${active ? ' maint-chip--active' : ''}`}
      style={active && color ? { background: `${color}22`, borderColor: `${color}66`, color } : active ? { background: 'var(--elevated)', borderColor: 'var(--border-hi)' } : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SortableTh({ label, sortKey, activeKey, dir, onClick }) {
  const active = sortKey === activeKey;
  return (
    <th onClick={() => onClick(sortKey)}>
      {label}
      {active && <span className="maint-sort-arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function Pagination({ page, pageCount, total, pageSize, onPage }) {
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);
  return (
    <div className="maint-pagination">
      <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{from}–{to} of {total}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</PageBtn>
        <span style={{ fontSize: 10.5, color: 'var(--text-1)', padding: '0 6px' }}>{page} / {pageCount}</span>
        <PageBtn disabled={page >= pageCount} onClick={() => onPage(page + 1)}>›</PageBtn>
      </div>
    </div>
  );
}

function PageBtn({ children, disabled, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="maint-pagebtn"
      style={{ color: disabled ? 'var(--text-3)' : 'var(--text-1)', cursor: disabled ? 'default' : 'pointer' }}
    >
      {children}
    </button>
  );
}

// ── Historical chart card ────────────────────────────────────────────────
function aggregate(values, agg) {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return agg === 'avg' ? sum / values.length : sum;
}

function fmtDay(dayStr) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/* The two ends of the x-axis, formatted together so they can be told apart.
   Month-and-day alone is ambiguous across a year boundary, and the DEFAULT
   window is exactly 366 days — so it starts and ends on the same month and
   day, and both labels read "Aug 8". The year is added only when the ends
   actually fall in different years, which keeps the common short window
   ("Aug 1" → "Aug 8") free of noise. */
function fmtAxisRange(firstDay, lastDay) {
  const sameYear = firstDay.slice(0, 4) === lastDay.slice(0, 4);
  const fmt = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC',
  });
  return [fmt(firstDay), fmt(lastDay)];
}

function fmtValue(n, decimals) {
  const rounded = decimals > 0 ? n.toFixed(decimals) : Math.round(n).toString();
  return Number(rounded).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Memoized: six 366-point SVG charts re-rendering on every vehicle selection
// (whose props they don't depend on) made selecting a row take ~1s.
const HistoryChartCard = memo(function HistoryChartCard({ field, title, agg, type, color, unit, decimals, history }) {
  const values = history.map(h => h[field] ?? 0);
  const half = Math.max(1, Math.floor(history.length / 2));
  const thisPeriod = values.slice(-half);
  const prevPeriod = values.slice(-2 * half, -half);

  const headline = aggregate(thisPeriod, agg);
  const previous  = aggregate(prevPeriod, agg);
  const deltaPct  = previous > 0 ? Math.round(((headline - previous) / previous) * 100) : (headline > 0 ? 100 : 0);
  const deltaUp   = deltaPct >= 0;

  const max = Math.max(1, ...values);
  const W = 280, H = 52, PAD = 2;
  const n = Math.max(1, values.length);
  const stepX = (W - PAD * 2) / n;

  return (
    <div className="maint-chart-card">
      <div className="maint-chart-card__head">
        <span className="maint-chart-card__title">{title}</span>
        {history.length > 0 && (
          <span className={`maint-chart-card__delta ${deltaUp ? 'up' : 'down'}`}>
            {deltaUp ? '▲' : '▼'} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className="maint-chart-card__value">
        {fmtValue(headline, decimals)}{unit && <span className="maint-chart-card__unit"> {unit}</span>}
      </div>
      <div className="maint-chart-card__sub">last {thisPeriod.length} days vs previous {prevPeriod.length}</div>

      {history.length === 0 ? (
        <div className="maint-chart-card__empty">No history yet</div>
      ) : (
        <div className="maint-chart-card__plot">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
          {type === 'bar' && values.map((v, i) => {
            // Gap scales down with dense histories — a fixed 2px gap makes the
            // width negative once stepX < 2 (e.g. 366-day windows), and a
            // negative <rect> width is an SVG error.
            const barW = Math.max(0.5, stepX - Math.min(2, stepX * 0.25));
            const barH = Math.max(v > 0 ? 2 : 0, (v / max) * (H - 4));
            const x = PAD + i * stepX;
            const y = H - barH;
            return (
              <rect key={i} x={x} y={y} width={barW} height={barH} rx="2" fill={color} opacity="0.9">
                <title>{fmtDay(history[i].day)}: {fmtValue(v, decimals)}{unit ? ` ${unit}` : ''}</title>
              </rect>
            );
          })}
          {type === 'line' && (() => {
            const pts = values.map((v, i) => [PAD + i * stepX + stepX / 2, H - Math.max(2, (v / max) * (H - 4))]);
            const d = `M${pts.map(p => p.join(',')).join(' L')}`;
            return (
              <>
                {/* non-scaling-stroke: the svg stretches to the card, so a
                    plain 2px stroke thins on the vertical and fattens on the
                    horizontal. This keeps it 2px on screen whatever the box. */}
                <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r="7" fill="transparent">
                    <title>{fmtDay(history[i].day)}: {fmtValue(values[i], decimals)}{unit ? ` ${unit}` : ''}</title>
                  </circle>
                ))}
                <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="2.5" fill={color} stroke="var(--card)" strokeWidth="1.5" />
              </>
            );
          })()}
        </svg>
        {/* The date labels live OUT here, in HTML, not as <text> in the svg
            above. That svg is preserveAspectRatio="none" and sized by the
            card, so anything inside it is scaled by a different factor on each
            axis — which left these two dates visibly stretched. HTML text is
            laid out normally and cannot distort, whatever the card's height. */}
        <div className="maint-chart-card__axis">
          {fmtAxisRange(history[0].day, history.at(-1).day).map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
        </div>
      )}
    </div>
  );
})
