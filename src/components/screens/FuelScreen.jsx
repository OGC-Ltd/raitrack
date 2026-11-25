// Fuel — FactorySuite's fuel module, machine by machine (operator,
// 2026-11-14: "use the same design as our drivers page", data from
// FactorySuite). The Drivers page's grammar and its stylesheet: a four-cell
// strip over the whole range, the full-width grid of machines, and a side
// panel for one machine. The figures come from lib/factoryFuel.
//
// FactorySuite fuels by work plan: a department plans a machine's shift, the
// plan is approved, the line is released at 17:00 the evening before as the
// machine's fuel request, and the pump issues against it. So the range ends on
// tomorrow, the day being planned today.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./DriversScreen.css";
import "./FuelScreen.css";
import { getFactoryFuel, getFuelRefills, getFuelShifts, getProbeFillings, getTankDays } from "../../api/factoryFuel";
import { fuelRoster, fuelByDay, fuelTotals, departmentOptions, machineState, periodRange, issueFlagged, withFuelNow, reconcileFills, withConsumed, odometerUnit, refillMeterUnit, refillFigures, withRefillColumns, withConsumedSinceRefill, withFuelBeforeWaiting, withFuelBeforeShift, withWorkConsumption, withFuelAfterSum, fuelBeforeShown, withProbeUsed, varianceBand, issuedByShift, shiftLineKey } from "../../lib/factoryFuel";
import { fleetDay } from "../../lib/fleetReports";
import { addDays } from "../../lib/dayRange";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { planStage } from "../../lib/workPlanMap";
import { nameCase } from "../../lib/factorySupervisors";
import { useAppSelector, useCompanies } from "../../context/AppContext";
import { useApiData } from "../../hooks/useApiData";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import TrendStat from "./TrendStat";
import FuelPeriodPicker from "./FuelPeriodPicker";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { claimSidePanel, onSidePanelClaim } from "../../lib/sidePanels";
import TablePager from "../body/TablePager";

// Figures as they come, not rounded to whole litres (operator 2026-11-20: the
// probe's 77.66 L showed as 78 L beside FactorySuite's 77 L — "let us not round
// off at all"). Probe levels are in millilitres, so two places are exact; a
// whole number shows no decimals. `d` fixes the places where one is wanted.
const fmt = (n, d = null) =>
  Number(n ?? 0).toLocaleString(undefined, d == null
    ? { maximumFractionDigits: 2 }
    : { minimumFractionDigits: d, maximumFractionDigits: d });
const litres = (n) => (n == null ? "-" : `${fmt(n)} L`);
/** An odometer reading with its unit: "5,086.5 h", "12,340 km"; to one decimal, as the pump reads it. */
/** A refill meter with its own unit: km off the tracker, the pump's unit off the pump. */
const meterText = (n, unit) =>
  (n == null ? "-" : `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`);
const odometerText = (n, basis) => {
  if (n == null) return "-";
  const u = odometerUnit(basis);
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })}${u ? ` ${u}` : ""}`;
};
/**
 * A variance (actual fill less probe refill) in words (operator 2026-11-17:
 * "either it tells us probe recorded more than actual fill or less, then in
 * brackets the amount"): "Probe less (20 L)", "Probe more (15 L)", "Same".
 * Coloured by varianceBand: 2 L or less green, to 5 L amber, past that red.
 */
const NBSP = "\u00a0";
const probeWords = (n) => {
  if (n == null) return "-";
  // Unrounded like every litre on the page (operator 2026-11-20), so the
  // 2 L / 5 L colour bands read true against the figure shown.
  const l = Math.round(n * 100) / 100;
  // Non-breaking inside each half, so a narrow column wraps only between "Probe less" and "(20 L)".
  return l > 0 ? `Probe${NBSP}less (${fmt(l)}${NBSP}L)` : l < 0 ? `Probe${NBSP}more (${fmt(-l)}${NBSP}L)` : "Same";
};
const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const sentence = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "");
/** FactorySuite's offsetless wall clock, "2026-11-13T05:34:19" → "05:34". */
const clock = (s) => /[T ](\d{2}:\d{2})/.exec(String(s ?? ""))?.[1] ?? "";

/** The machine's kind as the register's code starts: "EX" for EX-10, "CTR" for CTR-02. */
const badge = (ref) => (/^[A-Z]+/i.exec(ref)?.[0] ?? ref).slice(0, 3).toUpperCase();

const ALL = "__all";
const GRID_CARDS_QUERY = "(max-width: 700px)";
const GRID_STEP = 15;
const GRID_STEP_PHONE = 10;
const BAR_KEYS = new Set(["need", "issued", "shifts", "planned"]);
const GRID_METRICS = [
  { key: "shifts", label: "Shifts" },
  { key: "issued", label: "Issued" },
];

export default function FuelScreen() {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { activeCompany } = useCompanies();
  const [pick, setPick] = useState("today");
  const { from, to } = useMemo(() => periodRange(pick), [pick]);

  const { data, loading, error, retry } = useApiData(
    () => getFactoryFuel({ companyId: activeCompanyId, from, to }),
    [activeCompanyId, from, to],
    { cacheKey: `ft-factory-fuel:${activeCompanyId}:${from}:${to}`, keepPreviousData: true },
  );

  const roster = useMemo(() => fuelRoster(data), [data]);
  const [deptPick, setDeptPick] = useState(ALL);
  const deptOptions = useMemo(() => departmentOptions(roster), [roster]);
  // A department the new range does not have falls back to all of them.
  const dept = deptPick === ALL || deptOptions.some((o) => o.key === deptPick) ? deptPick : ALL;
  const rows = useMemo(() => (dept === ALL ? roster : roster.filter((r) => (r.department ?? "") === dept)), [roster, dept]);
  const byDay = useMemo(() => fuelByDay(data, dept === ALL ? null : rows), [data, rows, dept]);
  const totals = useMemo(() => fuelTotals(rows), [rows]);
  // The tank right now, as Maintenance's "Fuel now" (lib/factoryFuel withFuelNow).
  const { vehicles } = useFleetLiveShared();
  // What the fuel probes recorded going in over the same days, for pump against
  // probe (lib/factoryFuel reconcileFills). Read apart from FactorySuite's data:
  // when it fails the page still stands, and says the probe side is unknown.
  const probe = useApiData(
    () => getProbeFillings({ companyId: activeCompanyId, from, to }),
    [activeCompanyId, from, to],
    { cacheKey: `ft-factory-fuel-probe:${activeCompanyId}:${from}:${to}`, keepPreviousData: true },
  );
  const fillings = probe.error ? null : probe.data ?? null;
  // Each probed machine's tank day by day, for Consumed (lib/factoryFuel
  // withConsumed). Apart too: when it fails, Consumed reads "-" and nothing else moves.
  // From the day before the period: its closing is the period's first opening,
  // which today has no row for until tonight (withFuelBeforeWaiting). Not on a
  // full 31 days: the server reads at most that many.
  const tankFrom = from && to && (Date.parse(to) - Date.parse(from)) / 86_400_000 < 30 ? addDays(from, -1) : from;
  const tank = useApiData(
    () => getTankDays({ companyId: activeCompanyId, from: tankFrom, to }),
    [activeCompanyId, tankFrom, to],
    { cacheKey: `ft-factory-fuel-tank:${activeCompanyId}:${tankFrom}:${to}`, keepPreviousData: true },
  );
  const tankDays = tank.error ? null : tank.data ?? null;
  // The tracker's meter either side of each fuelling, for the table's refill
  // columns (lib/factoryFuel withRefillColumns). Apart too: when it fails,
  // Odometer before reads "-" and nothing else moves.
  const meterRead = useApiData(
    () => getFuelRefills({ companyId: activeCompanyId, from, to }),
    [activeCompanyId, from, to],
    { cacheKey: `ft-factory-fuel-meters:${activeCompanyId}:${from}:${to}`, keepPreviousData: true },
  );
  const meters = meterRead.error ? null : meterRead.data ?? null;
  // The tank at the start of each planned shift, by the probe, for Fuel before
  // (lib/factoryFuel withFuelBeforeShift). Apart too: when it fails, Fuel
  // before falls back to the refill's reading or the day's opening.
  const shiftRead = useApiData(
    () => getFuelShifts({ companyId: activeCompanyId, from, to }),
    [activeCompanyId, from, to],
    { cacheKey: `ft-factory-fuel-shifts:${activeCompanyId}:${from}:${to}`, keepPreviousData: true },
  );
  const shifts = shiftRead.error ? null : shiftRead.data ?? null;
  const today = fleetDay(Date.now());
  const checked = useMemo(
    // Consumed runs from the latest refill (operator 2026-11-20), the period
    // balance kept beside it as consumedPeriod. Probe used is the standard
    // rate times the run since that refill (withProbeUsed). Fuel before is the
    // tank before the day's planned work (withFuelBeforeShift, 2026-11-23);
    // Consumed and Probe used then cover that work (withWorkConsumption).
    () => withFuelAfterSum(withWorkConsumption(withProbeUsed(withFuelBeforeShift(withFuelBeforeWaiting(withConsumedSinceRefill(
      withRefillColumns(withConsumed(reconcileFills(withFuelNow(roster, vehicles), fillings, meters), tankDays, vehicles, today), meters),
      tankDays, today,
    ), tankDays, today), shifts, today)), shifts, today)),
    [roster, vehicles, fillings, tankDays, today, meters, shifts],
  );
  const tableRows = useMemo(() => (dept === ALL ? checked : checked.filter((r) => (r.department ?? "") === dept)), [checked, dept]);

  const [selected, setSelected] = useState(null);
  const machine = selected ? checked.find((r) => r.reference === selected) ?? null : null;
  const closeMachine = useCallback(() => setSelected(null), []);

  const deptName = dept === ALL ? null : deptOptions.find((o) => o.key === dept)?.label;
  const company = activeCompany?.name || "Fleet";
  const noFactory = !loading && data && data.factory === null;
  const isEmpty = !loading && !noFactory && roster.length === 0;
  const half = Math.max(1, Math.floor(byDay.length / 2));
  const sub = byDay.length > 1 ? `last ${half}d vs previous ${half}d` : "";

  // On the filter row, as on Staffs › Operators (operator, 19 Nov 2026).
  const rangePicker = <FuelPeriodPicker pick={pick} onPick={setPick} chips />;

  return (
    <div className="drivers-page fuel-page">
      <div className="drivers-page__inner">
        <div className="dr-head">
          <div>
            <h1 className="dr-title">Fuel</h1>
            <div className="dr-subtitle">
              {loading && !data
                ? "Loading…"
                : `${fmt(rows.length)} machine${rows.length === 1 ? "" : "s"}${deptName ? ` · ${deptName}` : ""} · ${from === to ? fmtDay(from) : `${fmtDay(from)} to ${fmtDay(to)}`} · ${company}`}            </div>
          </div>
        </div>

        {error ? (
          <LoadError label="Fuel" onRetry={retry} fullSection />
        ) : noFactory ? (
          <TabEmptyState icon={<i className="ti ti-gas-station" aria-hidden="true" />} title="Fuel"
            hint="This organisation's FactorySuite factory does not fuel by work plan, so there is nothing to show here." />
        ) : isEmpty ? (
          <>
            <div className="dr-filters">{rangePicker}</div>
            <TabEmptyState icon={<i className="ti ti-gas-station" aria-hidden="true" />} title="Fuel"
              hint={`No work plans or pump issues in FactorySuite from ${fmtDay(from)} to ${fmtDay(to)}.`} />
          </>
        ) : (
          <ErrorBoundary label="Fuel">
            <div className="dr-layout">
              <section className="dr-strip" aria-label="All machines">
                <MachinesCard totals={totals} loading={loading && !data} />
                <TrendStat title="Fuel needed" series={byDay} valueKey="need" unit="L" tone="tonnes" type="bar"
                  value={loading && !data ? "-" : fmt(totals.need)} sub={sub} loading={loading && !data}
                  pointWords={(d) => `${fmtDay(d.day)} · ${fmt(d.shifts)} shift${d.shifts === 1 ? "" : "s"} planned`} />
                <TrendStat title="Fuel issued" series={byDay} valueKey="issued" unit="L" tone="mileage" type="line"
                  value={loading && !data ? "-" : fmt(totals.issued)} sub={totals.issues ? sub : "nothing issued at the pump yet"}
                  loading={loading && !data}
                  pointWords={(d) => `${fmtDay(d.day)} · ${fmt(d.issued)} L issued`} />
                <PumpSummary totals={totals} loading={loading && !data} />
              </section>
            </div>

            <MachinesSection
              rows={tableRows}
              selected={selected}
              onSelect={setSelected}
              rangePicker={rangePicker}
              deptPicker={<DeptPicker value={dept} options={deptOptions}
                total={{ count: roster.length, shifts: roster.reduce((n, r) => n + (r.shifts ?? 0), 0) }} onChange={setDeptPick} />}
            />
          </ErrorBoundary>
        )}
      </div>
      {machine && <MachinePanel key={machine.reference} m={machine} from={from} to={to} onClose={closeMachine} />}
    </div>
  );
}

/** The roster cell: machines on the plans, and how their shifts stand. */
function MachinesCard({ totals, loading }) {
  if (loading) {
    return <div className="dr-cell dr-fleet"><div className="dr-cell__empty" aria-busy="true">Loading machines…</div></div>;
  }
  const facts = [
    { label: "Shifts planned", value: fmt(totals.shifts) },
    { label: "Full tank asked", value: fmt(totals.fullTanks) },
    { label: "Broken down or away", value: fmt(totals.broken) },
  ];
  const mix = [
    { key: "good", label: "Approved", n: totals.approved },
    { key: "fair", label: "Pending", n: totals.pending },
  ];
  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head"><span className="dr-statchart__label">Machines</span></div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(totals.onPlans)}</span>
        <span className="dr-summary__caption">on work plans,<br />{fmt(totals.departments)} department{totals.departments === 1 ? "" : "s"}</span>
      </div>
      <dl className="dr-fleet__facts">
        {facts.map((f) => (
          <div key={f.label} className="dr-fleet__fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
        ))}
      </dl>
      <div className="dr-fleet__mix">
        <span className="dr-fleet__mixlabel">Shifts</span>
        <span className="dr-fleet__bar" role="img" aria-label={mix.map((m) => `${m.n} ${m.label}`).join(", ")}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.key} className={`dr-fleet__seg dr-fleet__seg--${m.key}`} style={{ flexGrow: m.n }}
                  title={`${m.label}: ${fmt(m.n)} shift${m.n === 1 ? "" : "s"}`} />
          ))}
        </span>
        <ul className="dr-fleet__legend">
          {mix.map((m) => (
            <li key={m.key} className={`dr-fleet__key dr-fleet__key--${m.key}`}>
              <span className="dr-fleet__swatch" aria-hidden="true" />{m.label}<b>{fmt(m.n)}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The pump cell: requests released, and what the pump's own checks flagged. */
function PumpSummary({ totals, loading }) {
  if (loading) {
    return <div className="dr-cell dr-summary"><div className="dr-cell__empty" aria-busy="true">Loading…</div></div>;
  }
  const checks = [
    { name: "Off plan", n: totals.flags["Off plan"], who: totals.flaggedMachines["Off plan"], tone: "theft" },
    { name: "Operator mismatch", n: totals.flags["Operator mismatch"], who: totals.flaggedMachines["Operator mismatch"], tone: "speed" },
    { name: "Job mismatch", n: totals.flags["Job mismatch"], who: totals.flaggedMachines["Job mismatch"], tone: "speed" },
    { name: "Pump note", n: totals.flags.note, who: totals.flaggedMachines.note, tone: "speed" },
  ];
  const clean = totals.issues > 0 && checks.every((c) => !c.n);
  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">At the pump</span>
        {clean && <span className="dr-summary__clean">Clean</span>}
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(totals.issues)}</span>
        <span className="dr-summary__caption">fuellings, against<br />{fmt(totals.requests)} request{totals.requests === 1 ? "" : "s"} released</span>
      </div>
      <div className="dr-summary__incidents">
        {checks.map((c) => (
          <div key={c.name} className={`dr-summary__incident${c.n ? ` dr-summary__incident--${c.tone}` : ""}`}>
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">
              {c.name}
              {c.n > 0 && <span className="dr-summary__who"> · {fmt(c.who)} machine{c.who === 1 ? "" : "s"}</span>}
            </span>
            <span className="dr-summary__count">{fmt(c.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Each department with its plan lines (shifts), as FactorySuite counts them,
 * and its machines: "Irrigation (35 shifts, 24 machines)" (operator
 * 2026-11-19: FactorySuite showed 96 approved where we showed 80 machines).
 */
const deptCount = ({ shifts, count }) =>
  `${fmt(shifts)} shift${shifts === 1 ? "" : "s"}, ${fmt(count)} machine${count === 1 ? "" : "s"}`;

function DeptPicker({ value, options, total, onChange }) {
  return (
    <label className="dr-typepick">
      <span className="dr-typepick__label">Department</span>
      <select className="dr-typepick__select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>All departments ({deptCount(total)})</option>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({deptCount(o)})</option>)}
      </select>
    </label>
  );
}

function MachinesSection({ rows, selected, onSelect, rangePicker, deptPicker }) {
  const [query, setQuery] = useState("");
  // Ranked by litres issued first (operator, 2026-11-20: "by default lets pick by issued").
  const [sortKey, setSortKey] = useState("issued");
  const [sortDir, setSortDir] = useState("desc");
  const cardView = useMediaQuery(GRID_CARDS_QUERY);
  const step = cardView ? GRID_STEP_PHONE : GRID_STEP;
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => !q || [r.reference, r.name, r.plate, r.activity, r.workLocation]
    .some((v) => String(v ?? "").toLowerCase().includes(q)));
  const barMax = Math.max(1, ...rows.map((r) => r[sortKey] ?? 0));
  const sorted = [...filtered].sort((a, b) => {
    let cmp;
    if (sortKey === "machine") cmp = a.reference.localeCompare(b.reference, undefined, { numeric: true });
    else if (sortKey === "department") cmp = String(a.department ?? "~").localeCompare(String(b.department ?? "~"));
    else if (sortKey === "status") cmp = machineState(a).label.localeCompare(machineState(b).label);
    else if (sortKey === "period") cmp = String(a.lastDay ?? "").localeCompare(String(b.lastDay ?? ""));
    // L/h and km/L do not compare: hour-rated machines together, then km-rated, each by rate.
    else if (sortKey === "rate") cmp = String(a.basis ?? "~").localeCompare(String(b.basis ?? "~")) || (a.rate ?? -1) - (b.rate ?? -1);
    else cmp = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
    return sortDir === "asc" ? cmp : -cmp;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / step));
  const at = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(at * step, at * step + step);
  const ranked = BAR_KEYS.has(sortKey);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(["machine", "department", "status"].includes(key) ? "asc" : "desc"); }
    setPage(0);
  };
  const rankBy = (key) => { setSortKey(key); setSortDir("desc"); setPage(0); };
  const th = (label, k, num = false) => <GridTh label={label} k={k} sortKey={sortKey} dir={sortDir} onClick={toggleSort} num={num} />;

  return (
    <>
      <div className="dr-filters">
        <div className="dr-filters__chips" role="group" aria-label="Rank machines by">
          <span className="dr-rankby__label" aria-hidden="true">Rank by</span>
          <span className="dr-seg">
            {GRID_METRICS.map((m) => (
              <button key={m.key} type="button" className={`dr-chip${sortKey === m.key ? " dr-chip--active" : ""}`}
                aria-pressed={sortKey === m.key} onClick={() => rankBy(m.key)}>{m.label}</button>
            ))}
          </span>
        </div>
        {rangePicker}
        {deptPicker}
        <div className="dr-searchwrap">
          <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input className="dr-search" value={query} aria-label="Search machines"
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search machine, plate, job or place…" />
        </div>
      </div>

      <div className="dr-grid-card">
        <div className="dr-grid-scroll">
          <table className="dr-grid fuel-grid">
            <thead>
              <tr>
                {th("Machine", "machine")}
                {th("Department", "department")}
                {th("Status", "status")}
                {th("Period", "period")}
                {th("Shifts", "shifts", true)}
                {th("Planned", "planned", true)}
                {/* In the order a fuelling happens: the tank before, what the pump
                    issued, what the probe saw go in, the tank after (operator
                    2026-11-19). Fuel before/after and the odometers are the
                    latest refill's, as in the machine panel. */}
                {th("Fuel before", "fuelBefore", true)}
                {th("Issued", "issued", true)}
                {th("Probe filled", "probeFilled", true)}
                {th("Fuel after", "fuelAfter", true)}
                {th("Consumed", "consumed", true)}
                {/* Fuel used over the planned shifts, by the probe, with the hours run
                    (operator 2026-11-20). In the place the hidden Probe consumed held,
                    so the phone card's cell positions do not move. */}
                {th("Probe used", "probeUsed", true)}
                {th("Odometer before", "odometerBefore", true)}
                {/* Burn rate, the register's standard, in Odometer after's place
                    (operator 2026-11-20: "remove the odometer after and replace it
                    with burn rate value the standard"); the machine panel keeps the meter. */}
                {th("Burn rate", "rate", true)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const st = machineState(r);
                const pos = at * step + i;
                const rank = sortDir === "desc" ? pos + 1 : sorted.length - pos;
                const on = r.reference === selected;
                return (
                  <tr key={r.reference} className={on ? "dr-grid__row--selected" : ""} tabIndex={0} aria-selected={on}
                      onClick={() => onSelect(r.reference)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.reference); } }}>
                    <td className="dr-drivercell">
                      <span className="dr-driver">
                        <span className="dr-rank" aria-label={ranked ? `Rank ${rank}` : undefined}>{ranked ? rank : ""}</span>
                        <span className="dr-avatar fuel-avatar">{badge(r.reference)}</span>
                        <span className="dr-driver__ident">
                          <span className="dr-driver__name">{r.reference}</span>
                          <span className="dr-driver__sub" title={[r.name, r.plate].filter(Boolean).join(", ")}>
                            {[r.name, r.plate].filter(Boolean).join(", ") || "Not in the register"}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Department" title={r.activity ?? undefined}>
                      <span className="fuel-dept">{sentence(r.department) || "-"}</span>
                      {r.activity && <span className="dr-driver__sub fuel-job">{r.activity}</span>}
                    </td>
                    <td data-label="Status">
                      <span className={`dr-grid__badge dr-grid__badge--${st.tone}`} title={r.downReason ? sentence(r.downReason) : undefined}>
                        <span className="dr-grid__dot" aria-hidden="true" />{st.label}
                      </span>
                    </td>
                    <td className={`dr-when${r.lastDay ? "" : " dr-when--none"}`} data-label="Period"
                        title={r.days ? `${r.days} day${r.days === 1 ? "" : "s"} on a plan` : undefined}>
                      {!r.lastDay ? "No plan" : r.firstDay && r.firstDay !== r.lastDay ? `${fmtDay(r.firstDay)} – ${fmtDay(r.lastDay)}` : fmtDay(r.lastDay)}
                    </td>
                    <MetricCell label="Shifts" k="shifts" value={r.shifts} sortKey={sortKey} max={barMax} />
                    <PlannedCell r={r} sortKey={sortKey} max={barMax} />
                    <RefillLevelCell r={r} which="fuelBefore" label="Fuel before" />
                    <MetricCell label="Issued" k="issued" value={r.issues ? r.issued : null} sortKey={sortKey} max={barMax} />
                    {/* Pump against probe (lib/factoryFuel reconcileFills): totals over the
                        fuellings that have both figures; the machine panel lists each one. */}
                    <td className={r.probeFilled != null ? "dr-num" : "dr-num dr-num--zero"} data-label="Probe filled"
                        title="What the fuel probe recorded going in, for the fuellings the pump recorded">
                      {r.probeFilled != null ? `${fmt(r.probeFilled)} L` : "-"}
                    </td>
                    {/* Fuel before + Issued (lib/factoryFuel withFuelAfterSum, operator
                        2026-11-26). The Fuel now column went the same day (operator). */}
                    <td className={r.fuelAfter != null ? "dr-num" : "dr-num dr-num--zero"} data-label="Fuel after"
                        title={r.fuelAfterSum
                          ? `Fuel before ${fmt(r.fuelAfterSum.before)} L + issued ${fmt(r.fuelAfterSum.issued)} L`
                          : fuelBeforeShown(r) == null ? "No Fuel before to add the issued fuel to" : "Nothing issued at the pump in this range"}>
                      {r.fuelAfter != null ? `${fmt(r.fuelAfter)} L` : "-"}
                    </td>
                    {/* Burnt over the planned work: start − end + issued (lib/factoryFuel
                        withWorkConsumption, operator 2026-11-23); since the latest
                        refill while the shifts are unread. */}
                    <td className={r.consumed != null ? "dr-num" : "dr-num dr-num--zero"} data-label="Consumed"
                        title={consumedTitle(r)}>
                      {r.consumed != null ? `${fmt(r.consumed)} L` : "-"}
                    </td>
                    <ProbeUsedCell r={r} />
                    <OdometerBeforeCell r={r} />
                    <BurnRateCell r={r} />
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td colSpan={14} className="dr-grid__empty">No machines match.</td></tr>}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <TablePager label="Machine pages" pager={{
            page: at, pageCount, total: sorted.length,
            from: sorted.length ? at * step + 1 : 0, to: at * step + pageRows.length, setPage,
          }} />
        )}
      </div>
    </>
  );
}

/** Where a refill column's figure came from, and which refill it is when the period has several. */
const refillTitle = (r, source) => [
  source,
  r.lastRefill?.at != null ? `at the fuelling of ${fmtFillWhen.format(r.lastRefill.at)}` : null,
  r.refillCount > 1 ? `the latest of ${r.refillCount}; the machine panel lists each` : null,
].filter(Boolean).join(", ");

/** Consumed's hover: where the running figure starts and ends, or why it is blank. */
function consumedTitle(r) {
  const w = r.consumedWork;
  if (w && r.consumed != null) {
    const endWords = w.open ? "now"
      : w.gap ? `when the tracker came back (${fmtFillWhen.format(w.endAt)}; it was silent as the last shift ended)`
      : `at the end of the last shift (${fmtFillWhen.format(w.endAt)})`;
    if (w.perShift) {
      // Shift by shift, added up (operator 2026-11-26): each shift's start − end + what was issued in it.
      const parts = w.perShift.filter((s) => s.used != null)
        .map((s) => `${fmtFillWhen.format(Date.parse(s.start))}: ${fmt(s.startL)} − ${fmt(s.endL)} + ${fmt(s.issued)} = ${fmt(s.used)} L`);
      return `Fuel used shift by shift, from the fuel probe (tank at the start − tank at the end + litres issued in that shift), added up: ${parts.join("; ")}. Total ${fmt(r.consumed)} L${w.missing ? `; ${w.missing} shift${w.missing === 1 ? "" : "s"} without a figure left out` : ""}.${w.open ? " The last shift is still running, so it counts to now." : w.gap ? " The tracker was silent as the last shift ended, so its end is the first reading back." : ""}`;
    }
    return `Fuel used over the planned work, from the fuel probe: ${fmt(w.startL)} L in the first 10 minutes of work (${fmtFillWhen.format(w.startAt)}) − ${fmt(w.endL)} L ${endWords} + ${fmt(w.issued)} L issued at the pump in between${w.fuellings ? ` (${w.fuellings} fuelling${w.fuellings === 1 ? "" : "s"})` : ""} = ${fmt(r.consumed)} L.`;
  }
  if (r.workWhy === "negative") {
    return `The readings disagree: ${fmt(w.startL)} L at the start − ${fmt(w.endL)} L at the end + ${fmt(w.issued)} L issued comes out below nothing. Fuel probably went in that the pump did not record, or the probe misread.`;
  }
  if (r.workWhy === "no-shift") return "No planned shift has started in the period, so no work to count.";
  if (r.workWhy === "no-probe") return "No fuel probe reading at the start or the end of the planned work.";
  const since = r.lastRefill?.at ? fmtFillWhen.format(r.lastRefill.at) : null;
  if (r.consumed != null) {
    return `Fuel used since the refill on ${since}, from the fuel probe: tank after the refill + later fills − drains − tank ${r.consumedEnd === "now" ? "now" : `at the end of ${fmtDay(r.consumedEnd)}`}.`;
  }
  if (!r.lastRefill) return "No refill in the period, so nothing to count from.";
  return `No probe reading after the refill on ${since} or at the end of the period.`;
}

/**
 * Probe used (operator 2026-11-20: "the standard burn rate * the hours worked
 * so far (odometer reading after fill and before fill)"): the register's rate
 * times the run between Odometer before and Odometer after, from
 * lib/factoryFuel withProbeUsed. The litres alone; the hover shows the sum.
 */
function ProbeUsedCell({ r }) {
  const u = r.probeUse;
  if (r.probeUsed == null) {
    const why = u?.source === "work"
      ? (u.rate == null ? "No standard burn rate in the register for this machine" : "No engine hours (or km) reading in the planned shifts")
      : r.workWhy === "no-shift" ? "No planned shift has started in the period, so no hours to count"
      : !r.lastRefill ? "No refill in the period, so no hours to count"
      : u?.run == null ? "No odometer reading before or after the latest refill"
      : "No standard burn rate in the register for this machine";
    return <td className="dr-num dr-num--zero" data-label="Probe used" title={why}>-</td>;
  }
  return (
    <td className="dr-num" data-label="Probe used" title={probeUsedTitle(u)}>
      {fmt(r.probeUsed)} L
    </td>
  );
}

/** Probe used's hover: the run since the refill and the standard it was multiplied by. */
function probeUsedTitle(u) {
  const run = `${fmt(u.run, u.unit === "h" ? 1 : 0)} ${u.unit}`;
  const sum = u.unit === "h"
    ? `${run} worked × standard ${fmt(u.rate, 1)} L/h`
    : `${run} run ÷ standard ${fmt(u.rate, 2)} km/L`;
  if (u.source === "work") {
    return `Fuel the standard rate allows for the planned work${u.open ? ", so far" : ""}: ${sum} = ${fmt(u.litres)} L. The ${u.unit === "h" ? "engine hours" : "kilometres"} are the tracker's, over the ${u.shifts} planned shift${u.shifts === 1 ? "" : "s"} in the period.`;
  }
  return `Fuel the standard rate allows since the latest refill${u.open ? ", so far" : ""}: ${sum} = ${fmt(u.litres)} L. The run is the meter now (or after the refill) less Odometer before.`;
}

const eatClock = (iso) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(11, 16);
/**
 * Fuel before from the ten minutes before a shift (lib/factoryFuel
 * withFuelBeforeShift, 2026-11-25): before the work began, or before the
 * refill when one came first.
 */
const beforeTitle = (b, what) =>
  `Fuel before ${what}: the tank over the 10 minutes before ${b.by === "refill" ? "the refill" : "the work began"}, `
  + `${eatClock(b.at)} on ${fmtDay(b.day)}, from the fuel probe`
  + (b.readAt ? `. The tracker sent nothing in those 10 minutes, so its last reading before, at ${eatClock(b.readAt)}` : "");

/** Fuel before's hover while the machine waits for its refill. */
const waitingTitle = (w) => (w.source === "opening"
  ? `No refill on ${fmtDay(w.day)}: the tank at the start of that day, from the fuel probe. The day's first refill then gives its own before reading`
  : w.source === "live"
  ? "No refill yet today: the tank now, from the fuel probe. It follows the probe until the day's first refill, whose before reading then takes over"
  : `No refill on ${fmtDay(w.day)}: the tank's closing level that day, from the fuel probe`);

/** The tank before or after the machine's latest refill in the period (lib/factoryFuel withRefillColumns). */
function RefillLevelCell({ r, which, label }) {
  // Before the day's planned work (lib/factoryFuel withFuelBeforeShift).
  const shift = which === "fuelBefore" ? r.fuelBeforeShift : null;
  if (shift?.before) {
    return (
      <td className="dr-num" data-label={label} title={beforeTitle(shift, "its first planned shift")}>
        {fmt(shift.litres)} L
      </td>
    );
  }
  if (shift) {
    const at = new Date(Date.parse(shift.at) + 3 * 3_600_000).toISOString().slice(11, 16);
    const pump = r.lastRefill?.day === shift.day ? r.lastRefill.fuelBefore : null;
    const title = (shift.firstTen && shift.from === "engine"
      ? `First 10 minutes of work: the tank from ${at} on ${fmtDay(shift.day)}, when the engine came on for its first planned shift, from the fuel probe`
      : `Before work: the tank ${shift.firstTen ? "over the first 10 minutes" : "at the start"} of its first planned shift, from ${at} on ${fmtDay(shift.day)} (no ignition reading to time the engine), from the fuel probe`)
      + (pump ? `. At the pump it read ${fmt(pump.litres)} L (${levelSource(pump)})` : "");
    return (
      <td className="dr-num" data-label={label} title={title}>
        {fmt(shift.litres)} L
      </td>
    );
  }
  const level = r.lastRefill?.[which];
  // Waiting for the day's refill: the tank from the probe (lib/factoryFuel withFuelBeforeWaiting).
  const waiting = which === "fuelBefore" && !level ? r.fuelBeforeWaiting : null;
  if (waiting) {
    return (
      <td className="dr-num" data-label={label} title={waitingTitle(waiting)}>
        {fmt(waiting.litres)} L
      </td>
    );
  }
  if (!level) {
    const why = r.lastRefill ? "No probe reading for this fuelling"
      : which === "fuelBefore" && r.fuelNow == null ? "No refill yet, and no fuel probe reading for this machine"
      : "No fuelling at the pump in this range";
    return <td className="dr-num dr-num--zero" data-label={label} title={why}>-</td>;
  }
  return (
    <td className="dr-num" data-label={label} title={refillTitle(r, levelSource(level))}>
      {fmt(level.litres)} L
    </td>
  );
}

/** The tracker's meter just before the machine's latest refill in the period. */
function OdometerBeforeCell({ r }) {
  const m = r.lastRefill?.odometerBefore;
  // Waiting for the day's refill: the meter now (lib/factoryFuel withFuelBeforeWaiting).
  const waiting = !m ? r.odometerBeforeWaiting : null;
  if (waiting) {
    return (
      <td className="dr-num" data-label="Odometer before" title={`No refill yet today: ${trackerMeter(waiting.unit).toLowerCase()} now. It follows the tracker until the day's first refill, whose before reading then takes over`}>
        {meterText(waiting.value, waiting.unit)}
      </td>
    );
  }
  if (!m) {
    // Never the pump's hours (operator 2026-11-20: "never render the pump hours on the odometer").
    const why = (!r.lastRefill ? (r.meterNow?.unit === "km" ? "No refill yet: the live GPS odometer runs on another count than the refills', so it waits for the refill's reading"
        : r.meterNow ? "No fuelling at the pump in this range" : "No refill yet, and no tracker reading for this machine")
      : r.lastRefill.tracked === false ? "No meter reading: not one of our tracked units"
      : r.lastRefill.tracked == null ? "The tracker's figures could not be read"
      : "No meter reading: the tracker sent none just before the fuelling");
    return <td className="dr-num dr-num--zero" data-label="Odometer before" title={why}>-</td>;
  }
  return (
    <td className="dr-num" data-label="Odometer before" title={`${refillTitle(r, beforeSource(m, r.lastRefill.tracked, false))}${meterNote(r.lastRefill)}`}>
      {meterText(m.value, m.unit)}
    </td>
  );
}

function GridTh({ label, k, sortKey, dir, onClick, num }) {
  const active = sortKey === k;
  return (
    <th className={num ? "dr-num" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="dr-grid__sort" onClick={() => onClick(k)} title={`Sort by ${label.toLowerCase()}`}>
        <span>{label}</span>
        <span className={"dr-caret" + (active ? ` dr-caret--${dir}` : "")} aria-hidden="true" />
      </button>
    </th>
  );
}

/** A litre or shift figure; "-" where FactorySuite gave none. The ranked column draws its bar. */
function MetricCell({ label, k, value, sortKey, max, suffix = "" }) {
  const barred = BAR_KEYS.has(k) && sortKey === k;
  if (value == null) {
    return <td className="dr-num dr-num--zero" data-label={label}>{suffix ? suffix.replace(/^ \+ /, "") : "-"}</td>;
  }
  return (
    <td className={"dr-num" + (barred ? " dr-num--ranked" : "")} data-label={label}>
      <span className="dr-metric">
        <span className="dr-metric__num">{fmt(value)}{suffix && <span className="fuel-full">{suffix}</span>}</span>
        {barred && (
          <span className="dr-metric__track" aria-hidden="true">
            <span className="dr-metric__fill" style={{ "--share": Math.max(0, Math.min(value / max, 1)) }} />
          </span>
        )}
      </span>
    </td>
  );
}

/**
 * What the plan lines asked for (operator 2026-11-19: "rename requested to
 * planned and fill in the value … either full or the actual value"). A line is
 * either a full tank or a number of litres; most are full tanks, so "Full"
 * shows in full, not as a muted note. Several full-tank lines read "Full ×2".
 *
 * Later the same day (operator: "reflect planned value"): a full tank counts at
 * the litres on its fuel request (lib/factoryFuel plannedLitres), so the column
 * is a figure; "Full" is left only for a full tank whose request has none yet.
 */
function PlannedCell({ r, sortKey, max }) {
  const full = r.plannedFull ? `Full${r.plannedFull > 1 ? ` ×${r.plannedFull}` : ""}` : "";
  const title = r.plannedFull ? `${r.plannedFull} full-tank line${r.plannedFull === 1 ? "" : "s"} with no litres on a request yet` : undefined;
  if (r.planned == null) {
    return <td className={full ? "dr-num" : "dr-num dr-num--zero"} data-label="Planned" title={title}>{full || "-"}</td>;
  }
  return <MetricCell label="Planned" k="planned" value={r.planned} sortKey={sortKey} max={max}
    suffix={full ? ` + ${full}` : ""} />;
}

function DayBlock({ day }) {
  const d = new Date(`${day}T00:00:00Z`);
  return (
    <span className="dr-dayblock" aria-hidden="true">
      <span className="dr-dayblock__d">{d.getUTCDate()}</span>
      <span className="dr-dayblock__m">{d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
    </span>
  );
}

/** One machine, down the right of the page: its plans' shifts and its fuellings. */
const fmtFillWhen = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Fuel data comparison (operator 2026-11-17: "comparison, not reconciliation"): each fuelling the pump recorded against the refill the
 * machine's fuel probe recorded for it, as one plain table (operator
 * 2026-11-17: "a simple table showing the Actual fuel filled, Probe refill data
 * and the variance"; "too much explanation"). A row is red when its variance
 * is past tolerance or the probe has no refill for it; the foot totals the
 * fuellings both recorded. lib/factoryFuel reconcileFills.
 */
function FillCheck({ m }) {
  const rows = m.fills ?? [];

  return (
    <section className="dr-panel__sec fuel-fills">
      {/* No count beside the title (operator 2026-11-17): the red rows say it. */}
      <h3 className="dr-panel__h">Fuel data comparison</h3>

      {!m.vehicleId && !m.plate ? (
        <p className="dr-panel__note">Not linked to a tracked unit: no probe data.</p>
      ) : rows.length === 0 ? (
        <p className="dr-panel__note">No fuelling recorded at the pump in this period.</p>
      ) : (
        <>
          <table className="fuel-rec">
            <thead>
              <tr>
                <th>Date</th>
                <th className="r">Actual fill</th>
                <th className="r" title="The tank over the 10 minutes after each refill less the 10 minutes before it, by the fuel probe">Probe refill</th>
                <th className="r">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const band = f.state === "no-probe" ? "bad" : varianceBand(f.variance);
                return (
                  <tr key={f.key} className={band ? `is-${band}` : undefined}>
                    <td>{f.at != null ? fmtFillWhen.format(f.at) : f.day ? fmtDay(f.day) : "-"}</td>
                    <td className="r">{f.actual != null ? `${fmt(f.actual)} L` : "-"}</td>
                    <td className="r">
                      {f.probe != null ? `${fmt(f.probe)} L` : f.state === "unknown" ? "-" : <span className="fuel-rec__none">No record</span>}
                    </td>
                    <td className="r fuel-rec__var">{probeWords(f.variance)}</td>
                  </tr>
                );
              })}
            </tbody>
            {m.variance != null && (
              <tfoot>
                <tr className={varianceBand(m.variance) ? `is-${varianceBand(m.variance)}` : undefined}>
                  <th scope="row">Total</th>
                  <td className="r">{fmt(m.pumpMatched)} L</td>
                  <td className="r">{fmt(m.probeFilled)} L</td>
                  <td className="r fuel-rec__var">{probeWords(m.variance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </>
      )}
    </section>
  );
}

const ELLIPSIS = "…";

/**
 * Refills (operator 2026-11-19, after the EX-17 test of that day): each
 * fuelling's seven figures, in the order asked: fuel before and after the
 * refill, consumed, planned, odometer before and after, issued. The tank before
 * and after each fill was a table of its own under the comparison (#132); its
 * two figures are the first two rows here. lib/factoryFuel refillFigures; the
 * tracker's figures (fleet-server fuel-refills) are read when the panel opens.
 */
function Refills({ m, from, to }) {
  const companyId = useAppSelector((a) => a.activeCompanyId);
  const any = (m.fills ?? []).some((f) => f.key?.startsWith("pump-"));
  const tracker = useApiData(
    () => (any ? getFuelRefills({ companyId, from, to, machine: m.reference }) : Promise.resolve({ refills: [] })),
    [companyId, from, to, m.reference, any],
    { cacheKey: `ft-factory-fuel-refills:${companyId}:${from}:${to}:${m.reference}` },
  );
  const server = tracker.error ? null : tracker.data ?? null;
  const refills = useMemo(() => refillFigures(m, server), [m, server]);
  if (!refills.length) return null;
  const waiting = tracker.loading && !tracker.data;

  return (
    <section className="dr-panel__sec fuel-refills">
      <h3 className="dr-panel__h">Refills<span className="dr-panel__count">{fmt(refills.length)}</span></h3>
      {refills.map((r, k) => (
        <table key={r.key} className="fuel-rec fuel-refill">
          <caption>
            {r.at != null ? fmtFillWhen.format(r.at) : r.day ? fmtDay(r.day) : "-"}
            {r.siv && <span className="fuel-refill__siv">{r.siv}</span>}
          </caption>
          <tbody>
            <tr>
              <th scope="row">Fuel before refill</th>
              <td className="r" title={levelSource(r.fuelBefore)}>{r.fuelBefore ? `${fmt(r.fuelBefore.litres)} L` : "-"}</td>
            </tr>
            <tr>
              <th scope="row">Fuel after refill</th>
              {/* Fuel before + issued (operator 2026-11-26), as the table's Fuel after */}
              <td className="r" title={r.fuelBefore && r.issued != null ? `Fuel before ${fmt(r.fuelBefore.litres)} L + issued ${fmt(r.issued)} L` : "Needs both the fuel before and the issued figure"}>
                {r.fuelBefore && r.issued != null ? `${fmt(Math.round((r.fuelBefore.litres + r.issued) * 100) / 100)} L` : "-"}
              </td>
            </tr>
            <tr>
              <th scope="row">Consumed</th>
              <ConsumedCell r={r} used={usedAfter(m, refills, k)} />
            </tr>
            <tr>
              <th scope="row">Planned</th>
              <td className="r" title={r.planned ? plannedTitle(r.planned) : "No plan line for this fuelling"}>
                {!r.planned ? "-" : r.planned.litres != null ? `${fmt(r.planned.litres)} L` : r.planned.full ? "Full tank" : "-"}
                {r.planned?.full && r.planned.litres != null && <span className="fuel-refill__note">, full tank</span>}
              </td>
            </tr>
            <tr>
              <th scope="row">Odometer before refill</th>
              <td className="r" title={r.odometerBefore ? `${beforeSource(r.odometerBefore, r.tracked)}${meterNote(r)}`
                : waiting ? undefined : trackerWhy(r, "The tracker sent no reading just before the fuelling")}>
                {r.odometerBefore ? meterText(r.odometerBefore.value, r.odometerBefore.unit) : waiting ? ELLIPSIS : "-"}
              </td>
            </tr>
            <tr>
              <th scope="row">Odometer after refill</th>
              <OdometerAfterCell r={r} />
            </tr>
            <tr>
              <th scope="row">Issued</th>
              <td className="r">{r.issued != null ? `${fmt(r.issued)} L` : "-"}</td>
            </tr>
          </tbody>
        </table>
      ))}
    </section>
  );
}

const fmtClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
const clockOf = (iso) => (iso ? fmtClock.format(new Date(iso)) : "");
const levelSource = (x) => (!x ? undefined : x.source === "probe" ? "Our fuel probe"
  : x.source === "pump" ? "From the pump: a full tank less the litres issued" : "FactorySuite's probe check");
const plannedTitle = (p) => [
  `Shift ${p.shiftNo}${p.shiftStart ? ` from ${p.shiftStart.slice(0, 5)}` : ""}`,
  p.hours != null ? `${fmt(p.hours)} h` : p.km != null ? `${fmt(p.km)} km` : null,
  p.need != null ? `needs about ${fmt(p.need)} L` : null,
].filter(Boolean).join(", ");

/** The tracker's meter in words: engine hours on an hour-rated machine, else its GPS odometer. */
const trackerMeter = (unit) => (unit === "h" ? "The tracker's engine hours" : "The tracker's GPS odometer");

/** Where an Odometer before came from: the tracker, or the pump for a machine with no tracker. */
const beforeSource = (m, tracked, when = true) => (m.source === "pump"
  ? `Keyed in at the pump${when && m.at ? ` at this fuelling, ${fmtFillWhen.format(Date.parse(m.at))}` : ""}${tracked === false ? " (no tracker on this machine)" : ""}`
  : `${trackerMeter(m.unit)}, ${clockOf(m.at)}`);

/** Why a tracker figure is "-": the read failed, the machine is not tracked, or the tracker gave none. */
const trackerWhy = (r, none) =>
  r.tracked == null ? "The tracker's figures could not be read" : r.tracked === false ? "Not one of our tracked units" : none;

/**
 * Consumed after one refill, the table's own figure (operator 2026-11-20:
 * "pull that from the consumed row"). The latest refill takes the row's
 * Consumed as it stands (lib/factoryFuel withConsumedSinceRefill: fuel after +
 * later fills − drains − tank now). An earlier refill runs to the next one:
 * its fuel after less the next refill's fuel before.
 */
function usedAfter(m, refills, k) {
  if (k === 0) {
    // Since the refill, not the table's figure over the work (withWorkConsumption keeps it).
    const litres = m.consumedSinceRefill !== undefined ? m.consumedSinceRefill : m.consumed;
    const end = m.consumedSinceRefill !== undefined ? m.consumedSinceRefillEnd : m.consumedEnd;
    if (m.lastRefill?.key !== refills[0]?.key || litres == null) return null;
    return { litres, end };
  }
  const after = refills[k].fuelAfter?.litres;
  const next = refills[k - 1].fuelBefore?.litres;
  if (after == null || next == null || after < next) return null;
  return { litres: Math.round((after - next) * 100) / 100, end: "next" };
}

function ConsumedCell({ r, used }) {
  if (!used) {
    const why = !r.fuelAfter ? "No fuel level after this refill" : "No probe level at the end to count to";
    return <td className="r" title={why}>-</td>;
  }
  const title = used.end === "next" ? "Fuel after this refill − fuel before the next refill"
    : `Fuel after the refill + later fills − drains − tank ${used.end === "now" ? "now" : `at the end of ${fmtDay(used.end)}`}, from the fuel probe; the table's Consumed`;
  return (
    <td className="r" title={title}>
      {fmt(used.litres)} L
      {used.end === "now" && <span className="fuel-refill__note"> so far</span>}
    </td>
  );
}

/**
 * Odometer after the refill (lib/factoryFuel withMeterAfter), on the same
 * meter as Odometer before: by default the pump's (operator 2026-11-20), so
 * the next fuelling's pump reading, or for the latest refill the pump reading
 * plus what the tracker has run since ("meter now"). Where the pump has no
 * reading, the tracker's own meter.
 */
const meterNote = (r) => (r?.odometerBefore?.source === "pump" && r.trackerBefore?.value != null
  ? `; the tracker read ${meterText(r.trackerBefore.value, r.trackerBefore.unit ?? "km")} at the fuelling` : "");
const afterSource = (a) => (a.source === "now"
  ? `${trackerMeter(a.unit)} now${a.at ? `, last read ${fmtFillWhen.format(Date.parse(a.at))}` : ""}`
  : a.source === "now-pump"
    ? `The pump reading plus the ${meterText(a.run, a.unit)} the tracker has run since${a.at ? `, last read ${fmtFillWhen.format(Date.parse(a.at))}` : ""}`
    : a.source === "next-refill-pump"
      ? `Keyed in at the pump at the next fuelling, ${fmtFillWhen.format(Date.parse(a.at))}`
      : `${trackerMeter(a.unit)} just before the next refill, ${clockOf(a.at)}`);
const afterWhy = (r) => (r.odometerBefore?.source === "pump"
  ? (r.tracked === false ? "No tracker on this machine: the next fuelling's pump reading gives it, and there is none yet"
    : r.trackerBefore?.value == null ? trackerWhy(r, "The tracker gave no reading at the fuelling, so its run since cannot be added")
    : "The tracker gives no later reading")
  : r.odometerBefore ? "The tracker gives no later reading" : trackerWhy(r, "The tracker gives no reading"));

function OdometerAfterCell({ r }) {
  const a = r.meterAfter;
  if (!a) return <td className="r" title={`${afterWhy(r)}${meterNote(r)}`}>-</td>;
  return (
    <td className="r" title={`${afterSource(a)}${meterNote(r)}`}>
      {meterText(a.value, a.unit)}
      {(a.source === "now" || a.source === "now-pump") && <span className="fuel-refill__note"> now</span>}
    </td>
  );
}

/** The register's standard burn rate, in its own unit: litres an hour, or km a litre. */
const rateText = (m) => (m.rate == null ? null : m.basis === "KM_PER_LITRE" ? `${fmt(m.rate, 1)} km/L` : m.basis === "HOUR" ? `${fmt(m.rate, 1)} L/h` : null);
const rateWords = (m) => (m.basis === "HOUR" ? "Litres an hour" : "Kilometres a litre");

/** The table's Burn rate: the standard from the FactorySuite register (/machines). */
function BurnRateCell({ r }) {
  const text = rateText(r);
  if (!text) return <td className="dr-num dr-num--zero" data-label="Burn rate" title="No standard burn rate in the register for this machine">-</td>;
  return <td className="dr-num" data-label="Burn rate" title={`${rateWords(r)}, the standard from the FactorySuite register`}>{text}</td>;
}

/** The headline's Planned: litres, and any full tank whose request carries none yet ("+ Full"). */
function plannedLead(m) {
  const full = m.plannedFull ? `Full${m.plannedFull > 1 ? ` ×${m.plannedFull}` : ""}` : "";
  if (m.planned == null) return { label: "Planned", value: full || "-" };
  return { label: "Planned", value: fmt(m.planned), unit: `L${full ? ` + ${full}` : ""}` };
}

/** Probe filled in words: where its two readings came from. */
const probeFilledTitle = (pf) => (pf?.source !== "after-ten" ? "The fuel probe's recorded fill"
  : `The fuel probe: the tank over the 10 minutes after the refill less the 10 minutes before it${pf.fallback ? " (the tracker sent nothing in one of them, so the nearest readings within 30 minutes)" : ""}`);

/** A shift's fuellings: the server's (kept once the shift settled) where it sent them, else placed here. */
const shiftIssuedOf = (c, s) => (c?.fuellingList
  ? {
    litres: c.issued, probe: c.probeFilled,
    fuellings: c.fuellingList.map((f) => ({ id: f.issueId, litres: f.litres, done: true, at: f.at ? Date.parse(f.at) : null, siv: f.siv, probe: f.probeFilledL, probeFill: f.probeFilledL != null ? { source: "after-ten" } : null })),
  }
  : s);

/**
 * What the pump issued in one plan shift and what the probe saw go in
 * (operator 2026-11-26): each fuelling on the shift it happened in.
 */
function ShiftIssued({ s }) {
  if (!s?.fuellings.length) return <span className="dr-case__sub">Nothing issued in this shift</span>;
  const done = s.fuellings.filter((f) => f.done);
  return (
    <span className="dr-case__sub" title={done.map((f) => [f.siv, f.at != null ? clockOf(new Date(f.at).toISOString()) : null, f.litres != null ? `${fmt(f.litres)} L` : null].filter(Boolean).join(" ")).join("; ") || undefined}>
      {done.length ? `Issued ${fmt(s.litres)} L` : "Fuelling now"}
      {done.length === 1 && done[0].at != null ? ` at ${clockOf(new Date(done[0].at).toISOString())}` : done.length > 1 ? ` in ${fmt(done.length)} fuellings` : ""}
      {done.length === 1 && done[0].siv ? ` (${done[0].siv})` : ""}
      {s.probe != null && <span title={probeFilledTitle(done.find((f) => f.probeFill)?.probeFill)}>, probe filled {fmt(s.probe)} L</span>}
    </span>
  );
}

/**
 * One shift's Consumed (operator 2026-11-26: "(fuel start - fuel end) + issued
 * on the individual shift"), lib/factoryFuel withWorkConsumption; the row's
 * Consumed is these added up.
 */
function ShiftConsumed({ c }) {
  if (!c) return null;
  const startWords = c.startBy === "refill" ? "before its refill" : c.startBy === "before" ? "before work began" : c.startBy === "first-ten" ? "in the first 10 minutes of work" : "at the start";
  const endWords = c.open ? "now" : c.gap ? "when the tracker came back" : "at the end";
  if (c.used == null) {
    return (
      <span className="dr-case__sub" title={c.why === "negative"
        ? `${fmt(c.startL)} L ${startWords} − ${fmt(c.endL)} L ${endWords} + ${fmt(c.issued)} L issued comes out below nothing: fuel went in that the pump did not record, or the probe misread.`
        : "No fuel probe reading at the start or the end of this shift."}>
        Consumed -
      </span>
    );
  }
  return (
    <span className="dr-case__sub" title={`From the fuel probe: ${fmt(c.startL)} L ${startWords} (${fmtFillWhen.format(c.startAt)}) − ${fmt(c.endL)} L ${endWords} (${fmtFillWhen.format(c.endAt)}) + ${fmt(c.issued)} L issued in the shift`}>
      Consumed {fmt(c.used)} L{c.open ? " so far" : ""}
      <span className="fuel-refill__note"> ({fmt(c.startL)} − {fmt(c.endL)} + {fmt(c.issued)})</span>
    </span>
  );
}

/** One shift's Probe used: its own hours (or km) at the register's standard; the row's is all of them. */
function ShiftProbeUsed({ c }) {
  if (!c || (c.run == null && c.rate == null)) return null;
  if (c.probeUsed == null) {
    return <span className="dr-case__sub" title={c.rate == null ? "No standard burn rate in the register" : "The tracker counted no hours in this shift"}>Probe used -</span>;
  }
  const how = c.runUnit === "km" ? `${fmt(c.run)} km ÷ ${fmt(c.rate)} km/L` : `${fmt(c.run)} h × ${fmt(c.rate)} L/h`;
  return (
    <span className="dr-case__sub" title={`The standard burn rate times the ${c.runUnit === "km" ? "kilometres" : "engine hours"} the tracker counted in this shift${c.open ? ", so far" : ""}`}>
      Probe used {fmt(c.probeUsed)} L<span className="fuel-refill__note"> ({how})</span>
    </span>
  );
}

function MachinePanel({ m, from, to, onClose }) {
  const ref = useRef(null);
  const st = machineState(m);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    claimSidePanel("fuel");
    return onSidePanelClaim("fuel", () => closeRef.current?.());
  }, []);

  const series = useMemo(() => fuelByDay({ from, to }, [m]), [m, from, to]);
  // Short units, so the figure holds one line in its third of the card (operator 2026-11-20: "fix the un alligend text").
  const rate = rateText(m);
  const headline = [
    { label: "Shifts", value: fmt(m.shifts) },
    // "Planned", not "Need" (operator 2026-11-19): what the plan lines asked
    // for, a full tank at its request's litres (lib/factoryFuel plannedLitres).
    plannedLead(m),
    { label: "Issued", value: fmt(m.issued), unit: "L" },
    // Moved here from the grid (operator 2026-11-19); the table below lists each fuelling.
    { label: "Variance, pump less probe", value: probeWords(m.variance), band: varianceBand(m.variance), wide: true },
  ];
  const odoUnit = refillMeterUnit(m.basis);
  const odoNow = [m.lastRefill?.trackerNow, m.meterNow].find((x) => x?.value != null && (x.unit ?? "km") === odoUnit) ?? null;
  const lines = [...m.lines].sort((a, b) => b.day.localeCompare(a.day) || (a.shiftNo ?? 1) - (b.shiftNo ?? 1));
  // Each fuelling on the shift it happened in (lib/factoryFuel issuedByShift), not on the request it was keyed to.
  const perShift = useMemo(() => issuedByShift(m), [m]);

  return (
    <aside className="dr-panel fuel-panel" role="dialog" aria-label={`${m.reference}, fuel details`}>
      <header className="dr-panel__head">
        <span className="dr-panel__title">Machine</span>
        <button type="button" className="dr-panel__x" onClick={onClose} aria-label="Close machine details">×</button>
      </header>

      <div className="dr-panel__body" ref={ref}>
        <section className="dr-idcard" aria-label="Machine">
          <div className="dr-idcard__who">
            <span className="dr-profile__avatar dr-idcard__avatar fuel-avatar">{badge(m.reference)}</span>
            <div className="dr-panel__ident">
              <div className="dr-profile__namerow"><span className="dr-panel__name">{m.reference}</span></div>
              <div className="dr-profile__meta">{[...new Map([m.name, m.category && sentence(m.category), m.plate].filter(Boolean).map((x) => [x.toLowerCase(), x])).values()].join(", ") || "Not in the register"}</div>
            </div>
          </div>
          <dl className="dr-idcard__facts">
            <div>
              <dt>Status</dt>
              <dd><span className={`dr-grid__badge dr-grid__badge--${st.tone}`}><span className="dr-grid__dot" aria-hidden="true" />{st.label}</span></dd>
            </div>
            <div><dt>Department</dt><dd>{sentence(m.department) || "-"}</dd></div>
            <div><dt>Rated use</dt><dd title={rate ? `${rateWords(m)}, from the FactorySuite register` : undefined}>{rate ?? "-"}</dd></div>
            <div><dt>Tank</dt><dd>{litres(m.tankLitres)}</dd></div>
            <div>
              <dt>{odoUnit === "h" ? "Hour meter" : "Odometer"}</dt>
              {/* The machine's own meter (lib/factoryFuel refillMeterUnit): engine hours on an hour-rated machine, else km.
                  The refills' telemetry meter where there is one, the same counter as the Odometer columns, else the pump's reading. */}
              {odoNow?.value != null ? (
                <dd title={`${trackerMeter(odoUnit)}${odoNow.at ? `, last read ${fmtFillWhen.format(Date.parse(odoNow.at))}` : ""}${m.odometer != null && odometerUnit(m.basis) === odoUnit ? `; at the pump on ${fmtDay(m.odometerDay)}: ${odometerText(m.odometer, m.basis)}` : ""}`}>
                  {meterText(odoNow.value, odoUnit)}<span className="dr-window__unit"> now</span>
                </dd>
              ) : m.odometer != null && odometerUnit(m.basis) === odoUnit ? (
                <dd title={`Read at the pump on ${fmtDay(m.odometerDay)} (FactorySuite)`}>
                  {odometerText(m.odometer, m.basis)}<span className="dr-window__unit">, {fmtDay(m.odometerDay)}</span>
                </dd>
              ) : (
                <dd title="No meter reading for this machine">-</dd>
              )}
            </div>
          </dl>
          {m.downReason && <p className="fuel-down">{sentence(m.downReason)}</p>}
        </section>

        <section className="dr-panel__sec">
          <h3 className="dr-panel__h">{fmtDay(from)} to {fmtDay(to)}</h3>
          <dl className="dr-window__lead">
            {headline.map((x) => (
              <div key={x.label} className={x.wide ? "fuel-lead--wide" : undefined}><dt>{x.label}</dt><dd className={x.band ? `fuel-lead--${x.band}` : undefined}>{x.value}{x.unit && <span className="dr-window__unit"> {x.unit}</span>}</dd></div>
            ))}
          </dl>
        </section>

        <FillCheck m={m} />

        <Refills m={m} from={from} to={to} />

        {m.shifts > 0 && (
          <section className="dr-panel__sec dr-panel__charts">
            {/* Need per day went 2026-11-20 (operator); Issued per day stays. */}
            <TrendStat title="Issued per day" series={series} valueKey="issued" unit="L" tone="mileage" type="line"
              value={fmt(m.issued)} sub={m.issues ? `${fmt(m.issues)} fuelling${m.issues === 1 ? "" : "s"}` : "nothing issued yet"} />
          </section>
        )}

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">Work plan shifts<span className="dr-panel__count">{fmt(lines.length)}</span></h3>
          {lines.length === 0 ? (
            <p className="dr-panel__note">On no work plan in this range.</p>
          ) : (
            <ul className="dr-cases">
              {lines.map((l) => (
                <li key={`${l.lineId}|${l.day}`} className="dr-case">
                  <DayBlock day={l.day} />
                  <span className="dr-case__body">
                    <span className="dr-case__line">
                      <b className="dr-case__qty">{l.fullTank ? "Full tank" : litres(l.litresRequested)}</b>
                      <span className="dr-case__plate">{l.activity}</span>
                      <span className="dr-case__time">{l.shiftStart ? `Shift ${l.shiftNo ?? 1}, ${l.shiftStart.slice(0, 5)}` : `Shift ${l.shiftNo ?? 1}`}</span>
                    </span>
                    <span className="dr-case__sub">
                      {[l.workLocation && `At ${l.workLocation}`,
                        l.plannedKm != null ? `${fmt(l.plannedKm)} km` : l.plannedHours != null ? `${fmt(l.plannedHours)} h` : null,
                        l.needLitres != null ? `needs about ${fmt(l.needLitres)} L` : null,
                        l.operator && nameCase(l.operator)].filter(Boolean).join(", ")}
                    </span>
                    {m.beforeByLine?.[l.lineId] && (
                      <span className="dr-case__sub" title={beforeTitle(m.beforeByLine[l.lineId], `shift ${l.shiftNo ?? 1}`)}>
                        Fuel before {fmt(m.beforeByLine[l.lineId].litres)} L
                        {m.beforeByLine[l.lineId].by === "refill" ? ", before its refill" : ", before work began"}
                        {` (${eatClock(m.beforeByLine[l.lineId].at)})`}
                      </span>
                    )}
                    <span className="dr-case__sub fuel-case__plan">
                      {l.planCode}, {planStage(l.planStatus) === "PENDING" ? "pending approval" : sentence(l.planStatus)}
                      {l.requestId ? `, request ${sentence(l.requestStatus ?? "released").toLowerCase()}` : ", no fuel request yet"}
                    </span>
                    <ShiftIssued s={shiftIssuedOf(m.consumedByLine?.[l.lineId], perShift.byLine.get(shiftLineKey(l)))} />
                    <ShiftConsumed c={m.consumedByLine?.[l.lineId]} />
                    <ShiftProbeUsed c={m.consumedByLine?.[l.lineId]} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {perShift.unplaced.length > 0 && (
            <p className="dr-panel__note">
              {fmt(perShift.unplaced.length)} fuelling{perShift.unplaced.length === 1 ? "" : "s"} on a day with no shift:{" "}
              {perShift.unplaced.map((f) => `${f.done ? litres(f.litres) : "fuelling"}${f.at != null ? ` at ${fmtFillWhen.format(f.at)}` : ""}`).join(", ")}
            </p>
          )}
        </section>

        <section className="dr-panel__sec dr-cases-sec">
          <h3 className="dr-panel__h">
            At the pump
            <span className={`dr-panel__count${m.flagged ? " dr-panel__count--theft" : ""}`}>{fmt(m.pumpIssues.length)}</span>
          </h3>
          {m.pumpIssues.length === 0 ? (
            <p className="dr-panel__note">No fuel issued to this machine in this range.</p>
          ) : (
            <ul className="dr-cases">
              {m.pumpIssues.map((i) => (
                <li key={i.id} className={`dr-case${issueFlagged(i) ? " dr-case--on" : ""}`}>
                  <DayBlock day={i.day} />
                  <span className="dr-case__body">
                    <span className="dr-case__line">
                      <b className="dr-case__qty">{i.done ? litres(i.litres) : "Fuelling"}</b>
                      <span className="dr-case__plate">{[i.tank, i.pump].filter(Boolean).join(", ") || "Pump"}</span>
                      <span className="dr-case__time">{clock(i.at)}</span>
                    </span>
                    <span className="dr-case__sub">
                      {[i.activity, i.operator && nameCase(i.operator),
                        i.readings?.physical != null ? `${odometerUnit(m.basis) === "h" ? "hour meter" : "odometer"} ${odometerText(i.readings.physical, m.basis)}${i.readings.estimated != null ? ` (expected ${odometerText(i.readings.estimated, m.basis)})` : ""}` : null,
                        i.minutes != null ? `${fmt(i.minutes)} min` : null].filter(Boolean).join(", ")}
                    </span>
                    {issueFlagged(i) && (
                      <span className="dr-case__sub fuel-case__flag">{[...(i.flags ?? []), i.note && sentence(i.note)].filter(Boolean).join(". ")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
