import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { useMachineSummary, isPlantFleet as isPlant } from "../../hooks/useMachineSummary";
import MachineOperations from "../body/MachineOperations";
import FleetStateSection from "../body/FleetStateSection";
import FleetMixPie from "../body/FleetMixPie";
import FleetStateDonut from "../body/FleetStateDonut";
import SensorGauge from "../body/SensorGauge";
import FuelRateChart from "../body/FuelRateChart";
import FuelPerHourHistogram from "../body/FuelPerHourHistogram";
import {
  getFleetState, getAreaByDay, getExcavatorArea, getMachineStarts,
  getFuelRateSeries, getVehicleCategories,
} from "../../api/machineOps";

/** Plates with no recognisable prefix — counted in the fleet, never a category. */
const UNPREFIXED = "__unprefixed";
const UNPREFIXED_SET = new Set([UNPREFIXED]);
import {
  BarChart, Bar, ComposedChart, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ChartContainer, ChartTooltipContent, ChartLegendContent } from "../ui/chart";
import { niceScale } from "../../lib/niceScale";
import "./AnalyticsScreen.css";
import {
  getDeliveryAnalytics, getFuelCost, getOperationsToday,
} from "../../api/analytics";
import { useAppContext } from "../../context/AppContext";
import { useApiData } from "../../hooks/useApiData";
import DownloadReportButton from "../shared/DownloadReportButton";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { AnalyticsIcon } from "../footer/NavIcons";
import { monthLabelOf } from "../header/MonthPicker";
import AnalyticsFilterBar from "./AnalyticsFilterBar";
import { summariseToday } from "../../lib/todayOps";
import {
  windowFor, categoriesParam, categoriesKey, isFiltered,
  filterFleetState, filterMachineStarts, filterExcavatorArea,
} from "../../lib/analyticsFilter";
import { downloadAnalyticsReport } from "../../lib/clientAnalyticsReport";

const FLEET_TZ = "Africa/Nairobi";
const RECORD_START_MONTH = "2026-07";

const fleetToday = (now = new Date()) => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: FLEET_TZ })
    .format(now)
    .split("-")
    .map(Number);
  return { y, m, d };
};

const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

const currentMonthKey = (now = new Date()) => {
  const { y, m } = fleetToday(now);
  return monthKey(y, m);
};

const fleetTodayIso = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: FLEET_TZ }).format(now);

function useSettledFilter(filter, delayMs = 350) {
  const [settled, setSettled] = useState(filter);
  const dateKey = filter.mode === "range" ? `${filter.from}|${filter.to}` : "";
  const rest = { ...filter, from: null, to: null };
  const restKey = JSON.stringify(rest);

  useEffect(() => {
    setSettled((prev) => ({ ...rest, from: prev.from, to: prev.to }));
  }, [restKey]);

  useEffect(() => {
    if (filter.mode !== "range") {
      setSettled(filter);
      return undefined;
    }
    const id = setTimeout(() => setSettled(filter), delayMs);
    return () => clearTimeout(id);
  }, [dateKey, filter.mode, delayMs]);

  return settled;
}

const windowLabel = (filter) =>
  filter.mode === "range"
    ? `${fmtDay(filter.from)} – ${fmtDay(filter.to)}`
    : monthLabelOf(filter.month);

const PRODUCT_COLOR = "var(--chart-3)";
const DEPOT_COLOR = "var(--chart-2)";
const TRIPS_COLOR = "var(--chart-1)";

const fmt = (n, d = 0) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtOrDash = (n, d = 0) => (n == null ? "—" : fmt(n, d));

const days_ = (n) => `${fmt(n)} day${n === 1 ? "" : "s"}`;

export default function AnalyticsScreen() {
  const { activeCompanyId, activeCompany } = useAppContext();
  const darkMode =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  const isPlantFleet = isPlant(activeCompanyId);

  const LIVE_MS = 60_000;
  const nowMonth = currentMonthKey();
  const todayIso = fleetTodayIso();

  const [filter, setFilter] = useState(() => ({
    mode: "month",
    month: nowMonth,
    from: todayIso,
    to: todayIso,
    categories: [],
  }));
  const settledFilter = useSettledFilter(filter);
  const { categories } = settledFilter;

  const { days, to } = windowFor(settledFilter, FLEET_TZ);
  const endsToday = to == null;
  const month = windowLabel(settledFilter);
  const catParam = categoriesParam(categories);
  const filtered = isFiltered(categories);

  const windowKey = `${to ?? "now"}:${categoriesKey(categories)}`;

  const { data: machineWeek, pending: weekPending } = useMachineSummary(activeCompanyId, {
    days, to, categories,
  });

  const { data: vehicleCategories } = useApiData(
    () => (isPlantFleet ? getVehicleCategories({ companyId: activeCompanyId }) : Promise.resolve(null)),
    [activeCompanyId, isPlantFleet],
    { cacheKey: `ft-vehicle-cats:${activeCompanyId}` }
  );

  const { data, loading, error, retry, stale: dataStale } = useApiData(
    () => getDeliveryAnalytics({ companyId: activeCompanyId, days, to, categories }),
    [activeCompanyId, days, to, catParam],
    { cacheKey: `ft-analytics:${activeCompanyId}:${days}:${windowKey}`, keepPreviousData: true }
  );

  const { data: fuel, loading: fuelLoading, stale: fuelStale } = useApiData(
    () => getFuelCost({ companyId: activeCompanyId, days, to, categories }),
    [activeCompanyId, days, to, catParam],
    { cacheKey: `ft-fuel-cost:${activeCompanyId}:${days}:${windowKey}`, keepPreviousData: true }
  );

  const { data: opsData, stale: opsStale } = useApiData(
    () => getOperationsToday({ companyId: activeCompanyId, categories }),
    [activeCompanyId, catParam],
    {
      cacheKey: `ft-ops-today:${activeCompanyId}:${categoriesKey(categories)}`,
      pollMs: LIVE_MS,
      keepPreviousData: true,
    }
  );
  const ops = opsData ?? {};

  const { data: fleetStateAll } = useApiData(
    () => getFleetState({ companyId: activeCompanyId, days, to }),
    [activeCompanyId, days, to],
    {
      cacheKey: `ft-fleet-state:${activeCompanyId}:${days}:${to ?? "now"}`,
      pollMs: LIVE_MS,
      keepPreviousData: true,
    }
  );

  const { data: exAreaAll } = useApiData(
    () => getExcavatorArea({ companyId: activeCompanyId }),
    [activeCompanyId],
    { cacheKey: `ft-ex-area:${activeCompanyId}` }
  );

  const { data: fuelRates, stale: ratesStale } = useApiData(
    () => (isPlantFleet ? getFuelRateSeries({ companyId: activeCompanyId, days, to, categories }) : Promise.resolve(null)),
    [activeCompanyId, isPlantFleet, days, to, catParam],
    { cacheKey: `ft-fuel-rates:${activeCompanyId}:${days}:${windowKey}`, keepPreviousData: true }
  );

  const { data: machineStartsAll } = useApiData(
    () => (isPlantFleet ? getMachineStarts({ companyId: activeCompanyId }) : Promise.resolve(null)),
    [activeCompanyId, isPlantFleet],
    { cacheKey: `ft-machine-starts:${activeCompanyId}`, pollMs: LIVE_MS }
  );

  const fleetState = useMemo(
    () => filterFleetState(fleetStateAll, categories),
    [fleetStateAll, catParam]
  );
  const machineStarts = useMemo(
    () => filterMachineStarts(machineStartsAll, categories),
    [machineStartsAll, catParam]
  );
  const exArea = useMemo(
    () => filterExcavatorArea(exAreaAll, categories, fleetStateAll),
    [exAreaAll, fleetStateAll, catParam]
  );

  const { data: areaDays, stale: areaStale } = useApiData(
    () => (isPlantFleet ? getAreaByDay({ companyId: activeCompanyId, days, to, categories }) : Promise.resolve(null)),
    [activeCompanyId, isPlantFleet, days, to, catParam],
    { cacheKey: `ft-area-days:${activeCompanyId}:${days}:${windowKey}`, keepPreviousData: true }
  );

  const todayOps = useMemo(
    () => summariseToday(fleetState?.units) ?? { operational: 0, nonOperational: 0, avgHours: 0 },
    [fleetState]
  );

  const perMachine = useMemo(() => {
    const n = machineWeek?.unitsReporting ?? 0;
    if (!machineWeek || n === 0) return null;
    return {
      hours: (machineWeek.totalHours ?? 0) / n,
      distanceKm: (machineWeek.totalDistanceKm ?? 0) / n,
    };
  }, [machineWeek]);

  const { areaBest, areaAvgKm2, areaMaxMachines } = useMemo(() => {
    const d = areaDays?.days ?? [];
    if (d.length === 0) return { areaBest: null, areaAvgKm2: 0, areaMaxMachines: 0 };
    return {
      areaBest: d.reduce((a, x) => (x.m2 > a.m2 ? x : a), d[0]),
      areaAvgKm2: d.reduce((a, x) => a + x.m2, 0) / d.length / 1e6,
      areaMaxMachines: Math.max(...d.map((x) => x.machines)),
    };
  }, [areaDays]);

  const mixByCategory = useMemo(() => {
    if (!isPlantFleet || !fleetState?.byCategory) return null;
    const out = {};
    for (const c of fleetState.byCategory) {
      const n = (c.working ?? 0) + (c.idling ?? 0) + (c.parked ?? 0) + (c.offline ?? 0);
      const key = (c.category || "").trim() || UNPREFIXED;
      if (n > 0) out[key] = (out[key] ?? 0) + n;
    }
    return Object.keys(out).length > 0 ? out : null;
  }, [isPlantFleet, fleetState]);

  const fleetTypes = (() => {
    const byType = ops?.fleet?.byType ?? {};
    const active = ops?.fleet?.active ?? 0;
    const tractors = byType.TRACTOR ?? 0;
    const trucks = byType.TRUCK ?? 0;
    const otherKinds = Object.entries(byType)
      .filter(([t]) => t !== "TRACTOR" && t !== "TRUCK")
      .sort((a, b) => b[1] - a[1]);
    return {
      active,
      tractors,
      trucks,
      other: Math.max(0, active - tractors - trucks),
      otherKinds,
      otherTooltip: otherKinds.map(([t, n]) => `${typeLabel(t)} ${fmt(n)}`).join(" · "),
    };
  })();

  const updating = Boolean(
    dataStale || fuelStale || areaStale || ratesStale || opsStale || weekPending
  );

  const totals = data?.totals ?? { trips: 0, tonnes: 0, distanceKm: 0, activeDays: 0 };
  const byDay = data?.byDay ?? [];
  const distance = data?.distance ?? { totalKm: 0, perDayKm: 0, perWeekKm: 0, perMonthKm: 0 };

  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: FLEET_TZ }).format(new Date());
  const trendByDay = byDay.length > 1 && byDay[byDay.length - 1].day === todayKey
    ? byDay.slice(0, -1)
    : byDay;

  const halfDays = Math.max(1, Math.floor(trendByDay.length / 2));
  const subCaption = trendByDay.length > 1 ? `last ${halfDays}d vs previous ${halfDays}d` : "single day";

  const fuelTotals = fuel?.totals ?? {
    litresFilled: 0, litresLost: 0, cost: 0, lossCost: 0, fillings: 0, thefts: 0,
  };
  const fuelAverages = fuel?.averages ?? { perDayLitres: 0, perDayCost: 0 };
  const fuelPrice = fuel?.price ?? null;
  const fuelByDay = (fuel?.byDay ?? []).map((d) => ({
    day: d.day,
    litres: d.litresFilled,
    cost: d.cost,
    lost: d.litresLost,
    lossCost: d.lossCost,
  }));
  const hasFuel = fuelLoading || fuelTotals.fillings > 0 || fuelTotals.thefts > 0;
  const lossPct = fuelTotals.litresFilled > 0
    ? (fuelTotals.litresLost / fuelTotals.litresFilled) * 100
    : 0;

  const hasData = !loading && !fuelLoading && (totals.trips > 0 || hasFuel);
  const hasDeliveries = loading || totals.trips > 0;

  const activeDaysList = byDay.filter((d) => d.trips > 0);
  const busiestDay = activeDaysList.reduce(
    (best, d) => (!best || d.trips > best.trips ? d : best),
    null
  );
  const furthestDay = activeDaysList.reduce(
    (best, d) => (!best || d.distanceKm > best.distanceKm ? d : best),
    null
  );
  const avgTripsPerActiveDay = activeDaysList.length ? totals.trips / activeDaysList.length : 0;
  const longestStreak = (() => {
    if (activeDaysList.length === 0) return 0;
    const times = activeDaysList
      .map((d) => new Date(`${d.day}T00:00:00Z`).getTime())
      .sort((a, b) => a - b);
    let best = 1;
    let run = 1;
    for (let i = 1; i < times.length; i++) {
      run = times[i] - times[i - 1] === 86_400_000 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return best;
  })();
  const perTripKm = totals.trips ? distance.totalKm / totals.trips : 0;

  // Refs for chart capture
  const operationalRef = useRef(null);
  const sensorRef = useRef(null);
  const fuelHistogramRef = useRef(null);
  const fuelConsumptionRef = useRef(null);

  const handleDownloadReport = () => {
    if (!hasData) return;
    downloadAnalyticsReport({
      isPlantFleet,
      darkMode,
      companyName: activeCompany?.short || activeCompany?.name || "Fleet",
      windowLabel: month,
      filename: `${activeCompany?.short || "Fleet"}-Analytics-Report.pdf`,
      chartRefs: {
        operational: operationalRef.current,
        sensor: sensorRef.current,
        fuelHistogram: fuelHistogramRef.current,
        fuelConsumption: fuelConsumptionRef.current,
      },
      // Plant data
      machineWeek,
      areaDays,
      perMachine,
      fleetState,
      mixByCategory,
      todayOps,
      // Haulage data
      totals,
      byDay,
      distance,
      perTripKm,
      busiestDay,
      furthestDay,
      avgTripsPerActiveDay,
      longestStreak,
      // Shared fuel data
      fuelTotals,
      fuelAverages,
      fuelPrice,
      fuelByDay,
    });
  };

  if (error) {
    return (
      <div className="analytics-page">
        <div className="analytics-page__inner">
          <LoadError label="Analytics" onRetry={retry} fullSection />
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-page">
      <div className="analytics-page__inner">
        <div className="an-head an-head--bare">
          <AnalyticsFilterBar
            filter={filter}
            onChange={setFilter}
            options={isPlantFleet ? vehicleCategories : null}
            minMonth={RECORD_START_MONTH}
            maxMonth={nowMonth}
            today={todayIso}
            updating={updating}
          >
            {hasData && (
              <DownloadReportButton
                onGenerate={handleDownloadReport}
                label="PDF Report"
              />
            )}
          </AnalyticsFilterBar>
        </div>

        {!hasData && !loading ? (
          <TabEmptyState
            icon={<AnalyticsIcon size={44} />}
            title="Analytics"
            hint={
              filtered
                ? `No delivery or fuel history for ${month} on the vehicle types selected. Clear the filter or pick a wider window.`
                : "No delivery or fuel history yet. Analytics will appear here once the live integration is connected."
            }
          />
        ) : (
          <ErrorBoundary label="Analytics">
            <div className={`an-body${updating ? " an-body--updating" : ""}`}>
              {/* PLANT FLEET TOP ROW */}
              {isPlantFleet && (
                <div className="an-top">
                  <div className="an-card an-distance">
                    <div className="an-card__head">
                      <span className="an-card__title">Summary</span>
                      <span className="an-card__hint">
                        {!machineWeek
                          ? "—"
                          : !endsToday
                            ? month
                            : machineWeek.days === 1
                              ? "today, still running"
                              : `${days_(machineWeek.days)} to today`}
                      </span>
                    </div>
                    <div className="an-dist-body">
                      <div className="an-dist-total">
                        <div className="an-dist-total__value">
                          {fmtOrDash(machineWeek?.avgHoursPerDay, 1)}<span> h</span>
                        </div>
                        <div className="an-dist-total__label">
                          average hours per machine, per day worked
                        </div>
                      </div>
                      <div className="an-avgs an-avgs--pair">
                        <AvgTile
                          label="Average Hours per machine"
                          value={fmtOrDash(perMachine?.hours, 1)}
                          unit="h"
                        />
                        <AvgTile
                          label="Average Distance per machine"
                          value={fmtOrDash(perMachine?.distanceKm)}
                          unit="km"
                        />
                      </div>
                      <div className="an-dist-foot">
                        {endsToday
                          ? machineWeek?.days === 1
                            ? "Today so far, whether or not a machine worked"
                            : `Today and the ${days_((machineWeek?.days ?? 7) - 1)} before it, whether or not a machine worked`
                          : `${month}, whether or not a machine worked`}{" "}
                        · {fmtOrDash(machineWeek?.totalHours)} h and{" "}
                        {fmtOrDash(machineWeek?.totalDistanceKm)} km across{" "}
                        {fmtOrDash(machineWeek?.unitsReporting)} units reporting · the average is{" "}
                        {machineWeek
                          ? Math.round(
                              (machineWeek.avgHoursPerDay / machineWeek.expectedHoursPerDay) * 100
                            )
                          : "—"}
                        % of the {machineWeek?.expectedHoursPerDay} h day
                      </div>
                    </div>
                  </div>

                  <div className="an-kpis">
                    <StatCard
                      label="Distance covered"
                      value={fmtOrDash(machineWeek?.distanceTodayKm)}
                      unit="km today"
                      series={machineWeek?.byDay.map((d) => d.distanceKm)}
                      days={machineWeek?.byDay.map((d) => d.day)}
                      agg="sum"
                      type="line"
                      color={DEPOT_COLOR}
                      sub={
                        machineWeek
                          ? `${fmt(machineWeek.totalDistanceKm)} km over ${machineWeek.days} days`
                          : "not reported yet"
                      }
                      tipFormat={(v) => `${fmt(v)} km`}
                    />
                    <StatCard
                      label="Area worked (avg)"
                      value={
                        areaDays?.days?.length
                          ? fmt(
                              areaDays.days.reduce((sum, d) => sum + d.m2 / 1e4, 0) /
                                areaDays.days.length,
                              1
                            )
                          : "—"
                      }
                      unit="ha / day"
                      series={areaDays?.days.map((d) => d.m2 / 1e4)}
                      days={areaDays?.days.map((d) => d.day)}
                      agg="avg"
                      type="bar"
                      color={PRODUCT_COLOR}
                      sub={
                        areaDays
                          ? `avg over ${areaDays.measuredDays} measured day${
                              areaDays.measuredDays === 1 ? "" : "s"
                            }`
                          : "not yet measured"
                      }
                      tipFormat={(v) => `${fmt(v, 1)} ha`}
                    />
                    <StatCard
                      label="Working hours per day (avg)"
                      value={fmtOrDash(machineWeek?.avgHoursPerDay, 1)}
                      unit="h"
                      series={machineWeek?.byDay.map((d) => d.hours)}
                      days={machineWeek?.byDay.map((d) => d.day)}
                      agg="avg"
                      type="bar"
                      color={TRIPS_COLOR}
                      sub={`against ${machineWeek?.expectedHoursPerDay} h expected`}
                      tipFormat={(v) => `${fmt(v, 1)} h`}
                    />
                  </div>
                </div>
              )}

              {/* HAULAGE FLEET TOP ROW */}
              {hasDeliveries && !isPlantFleet && (
                <div className="an-top">
                  <div className="an-card an-distance">
                    <div className="an-card__head">
                      <span className="an-card__title">Summary</span>
                      <span className="an-card__hint">
                        {totals.activeDays} day{totals.activeDays === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="an-dist-body">
                      <div className="an-dist-total">
                        <div className="an-dist-total__value">
                          {fmt(distance.totalKm)}<span> km</span>
                        </div>
                        <div className="an-dist-total__label">total distance</div>
                      </div>
                      <div className="an-avgs an-avgs--pair">
                        <AvgTile label="Distance per day" value={fmt(distance.perDayKm)} unit="km" />
                        <AvgTile
                          label="Average distance per trip"
                          value={fmt(perTripKm)}
                          unit="km"
                        />
                      </div>
                      <div className="an-dist-foot">
                        <span>{fmt(totals.trips)} completed trips</span>
                      </div>
                    </div>
                  </div>

                  <div className="an-kpis">
                    <StatCard
                      label="Completed trips"
                      value={fmt(totals.trips)}
                      series={trendByDay.map((d) => d.trips)}
                      days={trendByDay.map((d) => d.day)}
                      agg="sum"
                      type="bar"
                      color={TRIPS_COLOR}
                      sub={subCaption}
                      tipFormat={(v) => `${fmt(v)} trip${v === 1 ? "" : "s"}`}
                    />
                    <StatCard
                      label="Distance covered"
                      value={fmt(totals.distanceKm)}
                      unit="km"
                      series={trendByDay.map((d) => d.distanceKm)}
                      days={trendByDay.map((d) => d.day)}
                      agg="sum"
                      type="line"
                      color={DEPOT_COLOR}
                      sub={subCaption}
                      tipFormat={(v) => `${fmt(v)} km`}
                    />
                    <StatCard
                      label="Trips per day"
                      value={fmt(avgTripsPerActiveDay, 1)}
                      series={trendByDay.map((d) => d.trips)}
                      days={trendByDay.map((d) => d.day)}
                      agg="avg"
                      type="bar"
                      color={PRODUCT_COLOR}
                      sub={`over ${totals.activeDays} day${
                        totals.activeDays === 1 ? "" : "s"
                      } with trips`}
                      tipFormat={(v) => `${fmt(v)} trip${v === 1 ? "" : "s"}`}
                    />
                  </div>
                </div>
              )}

              {/* TODAY ON THE GROUND */}
              {ops && (
                <>
                  <div className="an-today an-card an-card--wide">
                    <div className="an-card__head">
                      <span className="an-card__title">Today on the ground</span>
                      <span className="an-card__hint">
                        {fmtDay(ops.day)} · since 00:00{" "}
                        {FLEET_TZ.split("/")[1].replace("_", " ")}
                      </span>
                    </div>

                    {isPlantFleet && (
                      <OpsLedger
                        items={[
                          { k: "operational", v: fmtOrDash(todayOps?.operational) },
                          { k: "non-operational", v: fmtOrDash(todayOps?.nonOperational) },
                          { k: "avg hours run", v: fmtOrDash(todayOps?.avgHours, 1), unit: "h" },
                        ]}
                      />
                    )}

                    <div className="an-today__grid">
                      <OpsBlock accent="var(--chart-1)" chartOnly title="Fleet composition">
                        <FleetMixPie
                          byType={mixByCategory ?? ops.fleet?.byType}
                          total={fleetTypes.active}
                          typeLabel={mixByCategory ? (c) => c : typeLabel}
                          tailKeys={mixByCategory ? UNPREFIXED_SET : undefined}
                        />
                      </OpsBlock>

                      <OpsBlock
                        accent="var(--chart-2)"
                        chartOnly
                        title={isPlantFleet ? "Operational today" : "Fleet coverage"}
                        containerRef={operationalRef}
                      >
                        {fleetState && fleetState.units?.length > 0 ? (
                          <FleetStateDonut
                            state={fleetState}
                            ops={todayOps}
                            mode={isPlantFleet ? "operational" : "coverage"}
                          />
                        ) : (
                          <div className="an-card__empty">Loading fleet state…</div>
                        )}
                      </OpsBlock>

                      {isPlantFleet && (
                        <OpsBlock
                          accent="var(--chart-3)"
                          chartOnly
                          className="an-ops--gauge"
                          containerRef={sensorRef}
                        >
                          {fleetState && fleetState.units?.length > 0 ? (
                            <SensorGauge state={fleetState} />
                          ) : (
                            <div className="an-card__empty">Loading sensors…</div>
                          )}
                        </OpsBlock>
                      )}

                      {!isPlantFleet && (
                        <OpsBlock
                          accent="var(--chart-3)"
                          label="Tractors dispatched early"
                          value={fmt(ops.earlyDepartures?.before06)}
                          sub="before 06:00"
                        >
                          <OpsBar
                            k="Before 04:00"
                            n={ops.earlyDepartures?.before04 ?? 0}
                            of={ops.earlyDepartures?.tractorsOut ?? 0}
                            color="var(--chart-3)"
                          />
                          <OpsBar
                            k="Before 05:00"
                            n={ops.earlyDepartures?.before05 ?? 0}
                            of={ops.earlyDepartures?.tractorsOut ?? 0}
                            color="var(--chart-3)"
                          />
                          <OpsBar
                            k="Before 06:00"
                            n={ops.earlyDepartures?.before06 ?? 0}
                            of={ops.earlyDepartures?.tractorsOut ?? 0}
                            color="var(--chart-3)"
                          />
                          <OpsLine
                            k="Total tractors dispatched"
                            v={fmt(ops.earlyDepartures?.tractorsOut)}
                            em
                          />
                        </OpsBlock>
                      )}

                      {!isPlantFleet && (
                        <OpsBlock
                          accent="var(--chart-4)"
                          label="Trucks dispatched"
                          value={fmt(ops.dispatches?.trucks)}
                        >
                          <OpsBar
                            k="Of fleet trucks"
                            n={ops.dispatches?.trucks ?? 0}
                            of={ops.fleet?.byType?.TRUCK ?? 0}
                            color="var(--chart-4)"
                          />
                          <OpsLine k="Fleet trucks" v={fmt(ops.fleet?.byType?.TRUCK ?? 0)} />
                          <OpsLine
                            k="Latest"
                            v={
                              ops.dispatches?.truckList?.[0]
                                ? clockFmt.format(new Date(ops.dispatches.truckList[0].at))
                                : "—"
                            }
                            em
                          />
                          {ops.dispatches?.plateUnresolved > 0 && (
                            <OpsLine k="Plate unresolved" v={fmt(ops.dispatches.plateUnresolved)} />
                          )}
                        </OpsBlock>
                      )}

                      <MachineOperations companyId={activeCompanyId} starts={machineStarts} />
                    </div>

                    <div className="an-today__note">
                      {isPlantFleet ? (
                        <>
                          A start is the first work after an hour&rsquo;s stand-down, measured from
                          the machine&rsquo;s own telemetry. A unit that ran through the night has no
                          start today rather than a midnight one.
                        </>
                      ) : (
                        <>
                          Two clocks here, and they are not meant to agree. The dispatch figures are
                          on the SIGN-OUT clock — the record the factory keeps, which every vehicle
                          produces whether or not it carries a tracker. The machine charts are on the
                          machines&rsquo; own telemetry.
                        </>
                      )}
                      {ops.earlyDepartures?.gateConfirmed > 0 && (
                        <>
                          {" "}
                          {fmt(ops.earlyDepartures.gateConfirmed)} of the pre-06:00 runs
                          {ops.earlyDepartures.gateConfirmed === 1 ? " was" : " were"} also watched
                          clearing the gate by GPS (ticked, hover for the measured time).
                        </>
                      )}
                    </div>

                    {isPlantFleet && (
                      <div className="an-fuelrow">
                        <FuelRateChart series={fuelRates} />
                        <div ref={fuelHistogramRef}>
                          <FuelPerHourHistogram state={fleetState} />
                        </div>
                      </div>
                    )}
                  </div>

                  {isPlantFleet && (
                    <FleetStateSection
                      state={fleetState}
                      area={exArea}
                      windowSpan={`${days}d`}
                      windowLabel={month}
                    />
                  )}
                </>
              )}

              {/* GRID: FUEL + DAILY ACTIVITY */}
              <div className="an-grid">
                {hasFuel && (
                  <Card
                    title="Fuel consumption &amp; cost"
                    hint={`${fmt(fuelTotals.litresFilled)} L · ${fmt(fuelTotals.fillings)} fillings`}
                  >
                    <div ref={fuelConsumptionRef}>
                      <FuelChart series={fuelByDay} currency={fuelPrice?.currency ?? "KES"} />
                    </div>

                    <div className="an-calc">
                      <div className="an-calc__row">
                        <span className="an-calc__k">Fuel put in</span>
                        <span className="an-calc__v">{fmt(fuelTotals.litresFilled)} L</span>
                      </div>
                      <div className="an-calc__row an-calc__row--em">
                        <span className="an-calc__k">
                          Fuel cost{" "}
                          <em>
                            (@ {fuelPrice?.currency ?? "KES"}{" "}
                            {fmt(fuelPrice?.pricePerLitre ?? 0, 2)} / L)
                          </em>
                        </span>
                        <span className="an-calc__v">
                          {fuelPrice?.currency ?? "KES"} {fmt(fuelTotals.cost)}
                        </span>
                      </div>
                      <div className="an-calc__row">
                        <span className="an-calc__k">
                          Fuel lost to drains <em>({fmt(fuelTotals.thefts)} events)</em>
                        </span>
                        <span className="an-calc__v">
                          {fmt(fuelTotals.litresLost)} L · {fmt(lossPct, 1)}%
                        </span>
                      </div>
                      <div className="an-calc__row an-calc__row--em">
                        <span className="an-calc__k">Value of fuel lost</span>
                        <span className="an-calc__v">
                          {fuelPrice?.currency ?? "KES"} {fmt(fuelTotals.lossCost)}
                        </span>
                      </div>
                      <div className="an-calc__row">
                        <span className="an-calc__k">Average per active day</span>
                        <span className="an-calc__v">
                          {fmt(fuelAverages.perDayLitres)} L · {fuelPrice?.currency ?? "KES"}{" "}
                          {fmt(fuelAverages.perDayCost)}
                        </span>
                      </div>
                      <div className="an-calc__note">
                        Litres are measured by the vehicles’ own fuel probes —{" "}
                        {fmt(fuelTotals.fillings)} filling{fuelTotals.fillings === 1 ? "" : "s"} and{" "}
                        {fmt(fuelTotals.thefts)} drain{fuelTotals.thefts === 1 ? "" : "s"} over the
                        window. Cost is those litres priced at the rate above, which the server
                        supplies; nothing records what the fuel was actually bought for.
                      </div>
                    </div>
                  </Card>
                )}

                {hasDeliveries && (
                  <>
                    <Card
                      title="Daily activity"
                      hint={`${totals.activeDays ?? 0} of ${days} days active`}
                    >
                      <div className="an-daily">
                        <div className="an-daily__heat">
                          <DailyHeatmap series={byDay} />
                        </div>
                        <div className="an-daily__side">
                          <Highlight
                            label="Busiest day"
                            value={busiestDay ? fmtDay(busiestDay.day) : "—"}
                            sub={
                              busiestDay
                                ? `${busiestDay.trips} trip${busiestDay.trips === 1 ? "" : "s"}`
                                : "no activity"
                            }
                          />
                          <Highlight
                            label="Avg / active day"
                            value={fmt(avgTripsPerActiveDay, 1)}
                            sub="trips per day"
                          />
                          <Highlight
                            label="Furthest day"
                            value={furthestDay ? `${fmt(furthestDay.distanceKm)} km` : "—"}
                            sub={furthestDay ? fmtDay(furthestDay.day) : "no activity"}
                          />
                          <Highlight
                            label="Longest streak"
                            value={`${longestStreak}`}
                            sub={`day${longestStreak === 1 ? "" : "s"} running`}
                          />
                        </div>
                      </div>
                    </Card>
                  </>
                )}

                {isPlantFleet && (areaDays == null || areaDays.days.length > 0) && (
                  <Card
                    title="Daily activity"
                    hint={
                      areaDays
                        ? `${areaDays.measuredDays} of ${areaDays.windowDays} days measured`
                        : "measuring…"
                    }
                  >
                    <div className="an-daily">
                      <div className="an-daily__heat">
                        <DailyHeatmap
                          series={areaDays?.days ?? []}
                          value={(d) => d.m2}
                          empty="No ground measured yet"
                          label={(c) =>
                            c.rec
                              ? `${fmtDay(c.iso)} · ${fmt(c.rec.km2, 3)} km² · ${
                                  c.rec.machines
                                } machine${c.rec.machines === 1 ? "" : "s"}`
                              : `${fmtDay(c.iso)} · not measured`
                          }
                        />
                      </div>
                      <div className="an-daily__side">
                        <Highlight
                          label="Most ground"
                          value={areaBest ? `${fmt(areaBest.km2, 3)} km²` : "—"}
                          sub={areaBest ? fmtDay(areaBest.day) : "no activity"}
                        />
                        <Highlight
                          label="Avg / measured day"
                          value={`${fmt(areaAvgKm2, 3)} km²`}
                          sub="ground turned over"
                        />
                        <Highlight
                          label="Total"
                          value={areaDays ? `${fmt(areaDays.totalM2 / 1e6, 2)} km²` : "—"}
                          sub={
                            areaDays
                              ? `over ${areaDays.measuredDays} day${
                                  areaDays.measuredDays === 1 ? "" : "s"
                                }`
                              : "no reading yet"
                          }
                        />
                        <Highlight
                          label="Machines"
                          value={`${areaMaxMachines}`}
                          sub="most in one day"
                        />
                      </div>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}

// ─── Helper components and functions ─────────────────────────────────────────

function periodDelta(values, agg) {
  if (values.length < 2) return null;
  const half = Math.max(1, Math.floor(values.length / 2));
  const cur = values.slice(-half);
  const prev = values.slice(-2 * half, -half);
  const total = (arr) => arr.reduce((s, x) => s + x, 0);
  const a = (arr) => (arr.length === 0 ? 0 : agg === "avg" ? total(arr) / arr.length : total(arr));
  const c = a(cur), p = a(prev);
  if (p <= 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}

function StatCard({ label, value, unit, series = [], days = [], agg, type, color, sub, tipFormat }) {
  const deltaPct = periodDelta(series, agg);
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="an-kpi">
      <div className="an-kpi__head">
        <span className="an-kpi__label">{label}</span>
        {deltaPct != null && (
          <span className={`an-kpi__delta ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className="an-kpi__value">
        {value}
        {unit && <span className="an-kpi__unit"> {unit}</span>}
      </div>
      <div className="an-kpi__sub">{sub}</div>
      <Sparkline values={series} days={days} type={type} color={color} tipFormat={tipFormat} />
    </div>
  );
}

function Sparkline({ values, days, type, color, tipFormat }) {
  if (!values || values.length === 0) return null;
  const data = values.map((v, i) => ({ i, day: days[i] ?? "", value: v }));
  const config = { value: { label: "", color } };
  const label = (_v, payload) => {
    const day = payload?.[0]?.payload?.day;
    return day ? fmtDay(day) : "";
  };
  const value = (v) => (tipFormat ? tipFormat(v) : fmt(v));

  return (
    <ChartContainer config={config} className="an-kpi__spark mt-1.5">
      {type === "bar" ? (
        <BarChart data={data} margin={SPARK_MARGIN} barCategoryGap={1}>
          <Tooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel={false} labelFormatter={label} formatter={value} />}
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      ) : (
        <LineChart data={data} margin={SPARK_MARGIN}>
          <Tooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel={false} labelFormatter={label} formatter={value} />}
          />
          <Line
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      )}
    </ChartContainer>
  );
}

const SPARK_MARGIN = { top: 4, right: 2, bottom: 2, left: 2 };

function fmtDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Card({ title, hint, children, wide }) {
  return (
    <div className={`an-card${wide ? " an-card--wide" : ""}`}>
      <div className="an-card__head">
        <span className="an-card__title">{title}</span>
        {hint && <span className="an-card__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const HEAT_HUE = "57,135,229";

function heatFill(trips, max, inRange) {
  if (!inRange) return "transparent";
  if (trips <= 0) return "var(--elevated)";
  const a = 0.18 + 0.82 * (trips / max);
  return `rgba(${HEAT_HUE},${a.toFixed(3)})`;
}

function DailyHeatmap({ series, value = (d) => d.trips, label, empty = "No daily activity yet" }) {
  if (series.length === 0) return <div className="an-card__empty">{empty}</div>;

  const DAY_MS = 86_400_000;
  const parse = (iso) => new Date(`${iso}T00:00:00Z`);
  const byDayMap = new Map(series.map((d) => [d.day, d]));
  const monOffset = (dt) => (dt.getUTCDay() + 6) % 7;

  const first = parse(series[0].day);
  const last = parse(series[series.length - 1].day);
  const max = Math.max(1, ...series.map((d) => value(d) || 0));

  const weeks = [];
  let week = [];
  for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) {
    const dt = new Date(t);
    const iso = dt.toISOString().slice(0, 10);
    const rec = byDayMap.get(iso);
    week.push({ iso, dt, v: rec ? value(rec) ?? 0 : null, rec, inRange: true });
    if (monOffset(dt) === 6) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week);

  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthDay = (dt) =>
    dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="an-heat">
      <div className="an-heat__grid">
        <div className="an-heat__corner" />
        {WEEKDAYS.map((w) => (
          <div className="an-heat__wd" key={w}>{w}</div>
        ))}
        {weeks.map((week, wi) => {
          const prev = weeks[wi - 1];
          const newMonth = wi === 0 || week[0].dt.getUTCMonth() !== prev[0].dt.getUTCMonth();
          return (
            <Fragment key={week[0].iso}>
              <div className="an-heat__rowlbl">
                {newMonth ? monthDay(week[0].dt) : week[0].dt.getUTCDate()}
              </div>
              {week.map((c, ci) => (
                <div
                  key={c.iso}
                  className="an-heat__cell"
                  style={{
                    background: heatFill(c.v ?? 0, max, c.inRange),
                    ...(ci === 0 ? { gridColumnStart: monOffset(c.dt) + 2 } : null),
                  }}
                  title={
                    !c.inRange
                      ? undefined
                      : label
                        ? label(c)
                        : `${fmtDay(c.iso)} · ${c.v ?? 0} trip${c.v === 1 ? "" : "s"}${
                            c.rec ? ` · ${fmt(c.rec.distanceKm)} km` : ""
                          }`
                  }
                />
              ))}
            </Fragment>
          );
        })}
      </div>
      <div className="an-heat__legend">
        <span>Less</span>
        <span className="an-heat__swatch" style={{ background: "var(--elevated)" }} />
        <span className="an-heat__swatch" style={{ background: `rgba(${HEAT_HUE},0.34)` }} />
        <span className="an-heat__swatch" style={{ background: `rgba(${HEAT_HUE},0.6)` }} />
        <span className="an-heat__swatch" style={{ background: `rgba(${HEAT_HUE},0.82)` }} />
        <span className="an-heat__swatch" style={{ background: `rgba(${HEAT_HUE},1)` }} />
        <span>More</span>
      </div>
    </div>
  );
}

const FUEL_MA_DAYS = 7;

function movingAverage(series, days = FUEL_MA_DAYS) {
  return series.map((row, i) => {
    const from = Math.max(0, i - days + 1);
    const span = i - from + 1;
    let litres = 0,
      cost = 0;
    for (let k = from; k <= i; k++) {
      litres += series[k].litres ?? 0;
      cost += series[k].cost ?? 0;
    }
    return { ...row, avg: litres / span, avgCost: cost / span, avgDays: span };
  });
}

function FuelChart({ series, currency = "KES" }) {
  if (series.length === 0) return <div className="an-card__empty">No fuel activity yet</div>;

  const showAvg = series.length > 1;
  const data = showAvg ? movingAverage(series) : series;

  const config = {
    litres: { label: "Fuel in", color: "var(--chart-1)" },
    lost: { label: "Drained", color: "var(--chart-8)" },
    ...(showAvg ? { avg: { label: `${FUEL_MA_DAYS}-day average`, color: "var(--chart-7)" } } : {}),
  };

  const formatValue = (value, key, item) => {
    const row = item?.payload;
    if (key === "avg") {
      const span = row?.avgDays ?? FUEL_MA_DAYS;
      const over = span < FUEL_MA_DAYS ? ` (${span}d so far)` : "";
      return `${fmt(value)} L · ${currency} ${fmt(row?.avgCost ?? 0)}${over}`;
    }
    const cost = key === "lost" ? row?.lossCost : row?.cost;
    return `${fmt(value)} L · ${currency} ${fmt(cost ?? 0)}`;
  };

  const peak = Math.max(0, ...series.map((s) => Math.max(s.litres ?? 0, s.lost ?? 0)));
  const axis = niceScale(peak);

  const tickLabel = (v) => v.toLocaleString();
  const axisWidth = 12 + Math.max(...axis.ticks.map((t) => tickLabel(t).length)) * 6;

  return (
    <ChartContainer config={config} className="an-fuelchart">
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={fmtDay}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickMargin={8}
          fontSize={10}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={axisWidth}
          tickMargin={4}
          fontSize={10}
          domain={[axis.min, axis.max]}
          ticks={axis.ticks}
          interval={0}
          tickFormatter={tickLabel}
        />
        <Tooltip
          cursor={{ fill: "var(--color-border)", opacity: 0.25 }}
          content={<ChartTooltipContent labelFormatter={fmtDay} formatter={formatValue} />}
        />
        <Legend content={<ChartLegendContent />} />
        <Bar
          dataKey="litres"
          fill="var(--color-litres)"
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
          isAnimationActive={false}
        />
        <Bar
          dataKey="lost"
          fill="var(--color-lost)"
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
          isAnimationActive={false}
        />
        {showAvg && (
          <Line
            type="monotone"
            dataKey="avg"
            stroke="var(--color-avg)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

function Highlight({ label, value, sub }) {
  return (
    <div className="an-hl">
      <div className="an-hl__label">{label}</div>
      <div className="an-hl__value">{value}</div>
      {sub && <div className="an-hl__sub">{sub}</div>}
    </div>
  );
}

function OpsLedger({ items }) {
  return (
    <div className="an-today__lead">
      {items.map((it) => (
        <div key={it.k} className="an-lead">
          <div className="an-lead__v">
            {it.v}
            {it.unit && <span className="an-lead__u">{it.unit}</span>}
          </div>
          <div className="an-lead__k">{it.k}</div>
        </div>
      ))}
    </div>
  );
}

function OpsBlock({
  accent,
  label,
  value,
  unit,
  sub,
  children,
  className,
  chartOnly,
  title,
  containerRef,
}) {
  if (chartOnly) {
    return (
      <div
        className={"an-ops an-ops--chart" + (className ? ` ${className}` : "")}
        style={{ "--ops-accent": accent }}
        ref={containerRef}
      >
        {title && (
          <div className="an-card__head an-ops__charthead">
            <span className="an-ops__charttitle">{title}</span>
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <div
      className={"an-ops" + (className ? ` ${className}` : "")}
      style={{ "--ops-accent": accent }}
      ref={containerRef}
    >
      <div className="an-ops__label">{label}</div>
      <div className="an-ops__value">
        {value}
        {unit && <span className="an-ops__unit"> {unit}</span>}
        {sub && <span className="an-ops__sub"> {sub}</span>}
      </div>
      <div className="an-ops__lines">{children}</div>
    </div>
  );
}

function OpsLine({ k, v, em, title }) {
  return (
    <div className={`an-ops__line${em ? " an-ops__line--em" : ""}`} title={title}>
      <span className="an-ops__k">{k}</span>
      <span className="an-ops__v">{v}</span>
    </div>
  );
}

function typeLabel(t) {
  const s = String(t).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function OpsBar({ k, n, of, color }) {
  const pct = of > 0 ? Math.min(100, (n / of) * 100) : 0;
  return (
    <div className="an-ops__barrow" title={`${fmt(n)} of ${fmt(of)}`}>
      <span className="an-ops__k">{k}</span>
      <span className="an-ops__track">
        <span className="an-ops__fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="an-ops__v">{fmt(n)}</span>
    </div>
  );
}

const clockFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: FLEET_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function AvgTile({ label, value, unit }) {
  return (
    <div className="an-avg">
      <div className="an-avg__label">{label}</div>
      <div className="an-avg__value">
        {value}
        <span className="an-avg__unit"> {unit}</span>
      </div>
    </div>
  );
}