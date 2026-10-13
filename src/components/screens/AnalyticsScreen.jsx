import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  useMachineSummary,
  isPlantFleet as isPlant,
} from "../../hooks/useMachineSummary";
import MachineOperations from "../body/MachineOperations";
import FleetStateSection from "../body/FleetStateSection";
import FleetMixPie from "../body/FleetMixPie";
import FleetStateDonut from "../body/FleetStateDonut";
import SensorGauge from "../body/SensorGauge";
import FuelRateChart from "../body/FuelRateChart";
import FuelPerHourHistogram from "../body/FuelPerHourHistogram";
import SugarTonnageChart from "../body/SugarTonnageChart";
import WeighbridgeAnalytics from "../body/WeighbridgeAnalytics";
import SugarHaulUnits from "../body/SugarHaulUnits";
// Withdrawn from the page 2026-09-14 at the operator's request. The component,
// its stylesheet block and the /analytics/stop-clusters endpoint behind it all
// remain — this is three commented lines, not a removal, so putting the card
// back is uncommenting them. See the fetch and the render site below.
// import StopClusters from "../body/StopClusters";
import {
  getFleetState,
  getAreaByDay,
  getExcavatorArea,
  getMachineStarts,
  getFuelRateSeries,
  getSugarHauls,
  // getStopClusters,  // with the card above
  getVehicleCategories,
} from "../../api/machineOps";
import { getWeighmentAnalytics } from "../../api/weighments";

/** Plates with no recognisable prefix — counted in the fleet, never a category. */
const UNPREFIXED = "__unprefixed";
const UNPREFIXED_SET = new Set([UNPREFIXED]);

import {
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import {
  ChartContainer,
  ChartTooltipContent,
} from "../ui/chart";

import { niceScale } from "../../lib/niceScale";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { joinUnitFuelDays } from "../../lib/unitFuelSeries";
import { splitDrained } from "../../lib/fuelTheftSplit";
import "./AnalyticsScreen.css";

import {
  getDeliveryAnalytics,
  getFuelCost,
  getOperationsToday,
  getVehicleFuelDays,
} from "../../api/analytics";

import { useAppSelector, useAppActions, useCompanies, useTheme } from "../../context/AppContext";
import FuelStandardCard from "../body/FuelStandardCard";
import { usePermissions } from "../../hooks/usePermissions";
import { useApiData } from "../../hooks/useApiData";
import DownloadReportButton from "../shared/DownloadReportButton";
import ErrorBoundary from "../shared/ErrorBoundary";
import LoadError from "../shared/LoadError";
import TabEmptyState from "../shared/TabEmptyState";
import { AnalyticsIcon } from "../footer/NavIcons";
import { monthLabelOf } from "../header/MonthPicker";
import AnalyticsFilterBar from "./AnalyticsFilterBar";
import {
  sectionState, showSection,
  hasRateDays, hasHaulDays, hasHaulUnits, hasFleetUnits, hasFuelPerHour,
  hasActiveDays, hasAreaDays,
} from "../../lib/analyticsSections";
import { summariseToday, hoursRunBands } from "../../lib/todayOps";
import HoursRunRadar from "../body/HoursRunRadar";
import {
  windowFor,
  categoriesParam,
  vehiclesParam,
  selectionKey,
  unitOptions,
  isFiltered,
  filterFleetState,
  filterMachineStarts,
  filterExcavatorArea,
  filterForOrgChange,
} from "../../lib/analyticsFilter";
import { downloadAnalyticsReport } from "../../utils/analytics_report";

const FLEET_TZ = "Africa/Nairobi";
const RECORD_START_MONTH = "2026-07";

const fleetToday = (now = new Date()) => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: FLEET_TZ,
  })
    .format(now)
    .split("-")
    .map(Number);

  return { y, m, d };
};

const monthKey = (y, m) =>
  `${y}-${String(m).padStart(2, "0")}`;

const currentMonthKey = (now = new Date()) => {
  const { y, m } = fleetToday(now);
  return monthKey(y, m);
};

const fleetTodayIso = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: FLEET_TZ,
  }).format(now);

/**
 * @param resetKey  Changes when the filter must be adopted WITHOUT its debounce
 *   — today, when the organisation changes. The debounce exists to stop a
 *   half-typed date firing a query; it must not delay a reset, because the
 *   settled value is what the fetches key on, and a settled value carrying the
 *   previous organisation's vehicle categories is exactly the request that
 *   comes back empty. Applied during render rather than in an effect so no
 *   committed render ever holds the stale pair.
 */
function useSettledFilter(filter, resetKey, delayMs = 350) {
  const [settled, setSettled] = useState(filter);

  const [settledKey, setSettledKey] = useState(resetKey);
  if (settledKey !== resetKey) {
    setSettledKey(resetKey);
    setSettled(filter);
  }

  const dateKey =
    filter.mode === "range"
      ? `${filter.from}|${filter.to}`
      : "";

  const rest = {
    ...filter,
    from: null,
    to: null,
  };

  const restKey = JSON.stringify(rest);

  useEffect(() => {
    setSettled((prev) => ({
      ...rest,
      from: prev.from,
      to: prev.to,
    }));
  }, [restKey]);

  useEffect(() => {
    if (filter.mode !== "range") {
      setSettled(filter);
      return undefined;
    }

    const id = setTimeout(
      () => setSettled(filter),
      delayMs,
    );

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
  Number(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const fmtOrDash = (n, d = 0) =>
  n == null ? "—" : fmt(n, d);

const days_ = (n) =>
  `${fmt(n)} day${n === 1 ? "" : "s"}`;

export default function AnalyticsScreen() {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { activeCompany } = useCompanies();
  const { darkMode: contextDarkMode } = useTheme();

  // Filtering the units on the map is its own permission, separate from
  // reading analytics — an account can be allowed to see the figures without
  // being allowed to slice them by vehicle type.
  const { can: canDo } = usePermissions();
  const { setDesktopActiveTab } = useAppActions();
  const canFilterUnits = canDo("map:filter");

  const darkMode =
    contextDarkMode ??
    (typeof document !== "undefined" &&
      document.documentElement.classList.contains(
        "dark",
      ));

  const isPlantFleet = isPlant(activeCompanyId);

  // Fleet-state donut. A list of orgs it is hidden for, by request — empty
  // since 2026-10-08, when SUKARI asked for its Fleet coverage ring back.
  // A presentation choice per org, not a rule about the data.
  const COVERAGE_HIDDEN = new Set([]);
  const showFleetDonut =
    isPlantFleet ||
    !COVERAGE_HIDDEN.has(
      String(activeCompanyId ?? "").toLowerCase(),
    );

  /* Fleets whose gate figure comes off a weighbridge rather than off the sales
     office's paperwork.
     Sukari runs four scales — FACTORY, OPAPO, OYANI, NYAONDO — and for a mill
     that weighs every load, the scale is the better witness of what left: it
     counts the lorries and the wait as well as the weight, and it does not
     depend on a dispatch having been raised. So this org gets Weighbridge
     Analytics in the slot Sugar Delivered per Day holds everywhere else.
     A list and not a condition on the data, like COVERAGE_HIDDEN above: the
     day another mill's scales start reporting, putting it here is the whole
     change. Testing "does this org have bridges" instead would swap the card
     out from under a fleet the moment its feed went quiet, which is when the
     paperwork view is most worth keeping. */
  const WEIGHBRIDGE_FLEETS = new Set(["sukari"]);
  const weighs = WEIGHBRIDGE_FLEETS.has(String(activeCompanyId ?? "").toLowerCase());

  const LIVE_MS = 60_000;
  const nowMonth = currentMonthKey();
  const todayIso = fleetTodayIso();

  const [filter, setFilter] = useState(() => ({
    mode: "month",
    month: nowMonth,
    from: todayIso,
    to: todayIso,
    categories: [],
    // The UNIT selection, beside the type one. Empty is the whole fleet, by
    // the same convention — see lib/analyticsFilter.
    vehicles: [],
  }));

  /* A vehicle category belongs to ONE organisation's fleet.
   *
   * The options on the filter bar are read from the fleet rather than from a
   * list in the source, so the vocabulary is different for every organisation —
   * a plant fleet offers EXCAVATOR and DOZER, a haulage fleet offers neither.
   * Carrying a selection across a switch therefore sends every query out with a
   * `cats` parameter the new organisation has no units matching, and the page
   * draws itself correctly around nothing: zeroed tiles, empty charts, a fleet
   * that appears to have stopped. The filter bar cannot say so either, because
   * its own summary reads "0 of N units" — accurate, and no help at all.
   *
   * Reset during RENDER, not in an effect. An effect runs after commit, so the
   * intervening render would already have fired the whole fan-out of analytics
   * requests under the old categories — the empty page would be fetched before
   * being cleared. Setting state during render of the same component makes
   * React discard this pass and re-run with the corrected value before anything
   * commits, which is what makes the stale request impossible rather than
   * merely brief.
   *
   * The date window deliberately SURVIVES the switch. Months and ranges mean
   * the same thing in every organisation, so clearing them would throw away the
   * comparison the user is in the middle of making — the reason to switch
   * organisations is usually to look at the same period twice. */
  const [filterOrgId, setFilterOrgId] = useState(activeCompanyId);
  const orgChanged = filterOrgId !== activeCompanyId;

  /* The corrected filter is computed, not read back from state. The re-render
   * React schedules below has not happened yet, so `filter` in THIS pass is
   * still the previous organisation's — and it is this pass that hands a value
   * to useSettledFilter. Deriving it here is what keeps the two in step. */
  const effectiveFilter = filterForOrgChange(
    filter,
    orgChanged,
  );

  if (orgChanged) {
    setFilterOrgId(activeCompanyId);
    // Guarded on identity, which filterForOrgChange preserves when there is
    // nothing to clear — an unconditional set here would re-render forever.
    if (effectiveFilter !== filter) setFilter(effectiveFilter);
  }

  const settledFilter = useSettledFilter(
    effectiveFilter,
    activeCompanyId,
  );
  const { categories, vehicles } = settledFilter;

  const { days, to } = windowFor(
    settledFilter,
    FLEET_TZ,
  );

  const endsToday = to == null;
  const month = windowLabel(settledFilter);
  const catParam = categoriesParam(categories);
  /* The unit selection as a query value, and as a dependency. Arrays are new
   * objects on every render, so every `useApiData` below depends on this
   * STRING rather than on the array — the same rule the categories already
   * follow, and the reason a paint does not refetch the page. */
  const vehParam = vehiclesParam(vehicles);
  const filtered = isFiltered(categories, vehicles);
  /* Whether the operator has named units. Two cards answer at a grain that
   * cannot honour it — see MachineOperations below. */
  const unitFiltered = Boolean(vehicles?.length);
  /* ONE unit, which is a different question from "some units".
   *
   * The fleet fuel chart answers what the yard put in and lost. Narrowed to a
   * single plate the interesting question changes — what that lorry burnt per
   * kilometre it actually ran — and that needs a denominator the fleet chart
   * has never carried. Exactly one, never "a few": the rates over a selection
   * of units are sum-over-sum, which is a fleet figure wearing a unit's name. */
  const singleUnit = vehicles?.length === 1;

  const windowKey = `${to ?? "now"}:${selectionKey(
    categories, vehicles,
  )}`;

  const {
    data: machineWeek,
    pending: weekPending,
  } = useMachineSummary(activeCompanyId, {
    days,
    to,
    categories,
    vehicles,
  });

  const { data: vehicleCategories } = useApiData(
    () =>
      isPlantFleet
        ? getVehicleCategories({
          companyId: activeCompanyId,
        })
        : Promise.resolve(null),
    [activeCompanyId, isPlantFleet],
    {
      cacheKey: `ft-vehicle-cats:${activeCompanyId}`,
    },
  );

  const {
    data,
    loading,
    error,
    retry,
    stale: dataStale,
  } = useApiData(
    () =>
      getDeliveryAnalytics({
        companyId: activeCompanyId,
        days,
        to,
        categories,
        vehicles,
      }),
    [activeCompanyId, days, to, catParam, vehParam],
    {
      cacheKey: `ft-analytics:${activeCompanyId}:${days}:${windowKey}`,
      keepPreviousData: true,
    },
  );

  const {
    data: fuel,
    loading: fuelLoading,
    stale: fuelStale,
  } = useApiData(
    () =>
      getFuelCost({
        companyId: activeCompanyId,
        days,
        to,
        categories,
        vehicles,
      }),
    [activeCompanyId, days, to, catParam, vehParam],
    {
      cacheKey: `ft-fuel-cost:${activeCompanyId}:${days}:${windowKey}`,
      keepPreviousData: true,
    },
  );

  /* The km and the burn behind ONE unit's fuel days.
   *
   * Fetched only under a single-unit filter — every key carries that unit, so
   * an unfiltered fetch would be a whole extra aggregate nothing renders. The
   * fetcher returns null rather than not existing when the gate is off, which
   * is what `useApiData` needs to hold a stable hook order. */
  const {
    data: unitFuel,
    loading: unitFuelLoading,
  } = useApiData(
    () =>
      singleUnit
        ? getVehicleFuelDays({
          companyId: activeCompanyId,
          days,
          to,
          categories,
          vehicles,
        })
        : Promise.resolve(null),
    [
      activeCompanyId,
      days,
      to,
      catParam,
      vehParam,
      singleUnit,
    ],
    {
      cacheKey: singleUnit
        ? `ft-unit-fuel:${activeCompanyId}:${days}:${windowKey}`
        : null,
      keepPreviousData: false,
    },
  );

  const {
    data: opsData,
    stale: opsStale,
  } = useApiData(
    () =>
      getOperationsToday({
        companyId: activeCompanyId,
        categories,
        vehicles,
      }),
    [activeCompanyId, catParam, vehParam],
    {
      cacheKey: `ft-ops-today:${activeCompanyId}:${selectionKey(
        categories, vehicles,
      )}`,
      pollMs: LIVE_MS,
      keepPreviousData: true,
    },
  );

  const ops = opsData ?? {};

  const {
    data: fleetStateAll,
    loading: fleetLoading,
    error: fleetError,
  } = useApiData(
    () =>
      getFleetState({
        companyId: activeCompanyId,
        days,
        to,
      }),
    [activeCompanyId, days, to],
    {
      cacheKey: `ft-fleet-state:${activeCompanyId}:${days}:${to ?? "now"
        }`,
      pollMs: LIVE_MS,
      keepPreviousData: true,
    },
  );

  /* The unit picker's options: every unit this organisation has, off the
   * fleet-state feed the page already loads. Deliberately the UNFILTERED one —
   * a picker built from its own output could only ever narrow, and unticking
   * would be impossible because the unticked unit would have vanished from the
   * list. */
  const unitChoices = useMemo(() => unitOptions(fleetStateAll), [fleetStateAll]);

  const { data: exAreaAll } = useApiData(
    () =>
      getExcavatorArea({
        companyId: activeCompanyId,
      }),
    [activeCompanyId],
    {
      cacheKey: `ft-ex-area:${activeCompanyId}`,
    },
  );

  const {
    data: fuelRates,
    stale: ratesStale,
    loading: ratesLoading,
    error: ratesError,
  } = useApiData(
    // Fetched for EVERY fleet now. `fuel-rate-days` was never plant-specific —
    // its own header quotes SUKARI's measured L/km — and this gate was the only
    // reason a haulage fleet could not see what its kilometres cost.
    () =>
      getFuelRateSeries({
        companyId: activeCompanyId,
        days,
        to,
        categories,
        vehicles,
      }),
    [
      activeCompanyId,
      days,
      to,
      catParam,
      vehParam,
    ],
    {
      cacheKey: `ft-fuel-rates:${activeCompanyId}:${days}:${windowKey}`,
      keepPreviousData: true,
    },
  );

  // Sales hauls — tonnage per day and per unit. Fetched for every fleet: an org
  // that runs none simply gets empty arrays, and the components carry their own
  // empty state, so there is nothing to gate on and no way for the gate to be
  // wrong the day a fleet starts hauling.
  /* Only for the org that weighs, and only over the window the filter bar is
     already showing — `to` and `days` are the same two the sibling reads use,
     so the card cannot end up describing a different fortnight from the chart
     beside it.
     The vehicle and category selections are NOT passed. A ticket names a plate
     the scale operator typed, and most of the lorries at these bridges are
     contractors' and farmers' machines that appear in no fleet we hold — so
     narrowing by our own vehicle list would quietly drop most of the cane and
     report a mill running at a fraction of its real throughput. */
  const { data: wbAnalytics, loading: wbLoading } = useApiData(
    () => (weighs
      ? getWeighmentAnalytics({ companyId: activeCompanyId, days, to })
      : Promise.resolve(null)),
    [activeCompanyId, weighs, days, to],
    {
      cacheKey: weighs ? `ft-wb-analytics:${activeCompanyId}:${days}:${windowKey}` : null,
      keepPreviousData: true,
    },
  );

  const { data: sugarHauls, loading: haulsLoading, error: haulsError } = useApiData(
    /* Carries the vehicle selections now. It did not before, because there
       was only a machine-FAMILY filter and this table is a haulage feed —
       but "how much did this lorry ferry" is the question the table answers
       per row, so a unit filter that left it listing every unit would be the
       one control on the page that does nothing where it matters most. */
    () => getSugarHauls({ companyId: activeCompanyId, days, to, categories, vehicles }),
    [activeCompanyId, days, to, catParam, vehParam],
    {
      cacheKey: `ft-sugar-hauls:${activeCompanyId}:${days}:${windowKey}`,
      keepPreviousData: true,
    },
  );

  // Where the fleet's units actually stop — withdrawn from the page, see the
  // import above. Commented out rather than left running: the endpoint behind
  // it is a multi-second aggregate, and a fetch whose result nothing renders
  // would spend that on every visit to the page for nobody.
  //
  // Not fetched for the plant fleet either, when it is fetched at all:
  // Mufindi's machines work a site rather than visiting one, so "the places
  // many different units stop at" is a question about a yard it does not have.
  //
  // Its own window, deliberately fixed rather than following `days` — the
  // server offers 3, 7 and 14 and the page's selector runs to 90, so passing
  // `days` through would ask for 90 and silently receive 7.
  //
  // const { data: stopClusters, loading: stopsLoading } = useApiData(
  //   () =>
  //     isPlantFleet
  //       ? Promise.resolve(null)
  //       : getStopClusters({ companyId: activeCompanyId, days: 7 }),
  //   [activeCompanyId, isPlantFleet],
  //   {
  //     cacheKey: `ft-stop-clusters:${activeCompanyId}:7`,
  //     keepPreviousData: true,
  //   },
  // );

  const { data: machineStartsAll } = useApiData(
    () =>
      isPlantFleet
        ? getMachineStarts({
          companyId: activeCompanyId,
        })
        : Promise.resolve(null),
    [activeCompanyId, isPlantFleet],
    {
      cacheKey: `ft-machine-starts:${activeCompanyId}`,
      pollMs: LIVE_MS,
    },
  );

  const fleetState = useMemo(
    () =>
      filterFleetState(
        fleetStateAll,
        categories,
        vehicles,
      ),
    [fleetStateAll, catParam, vehParam],
  );

  const machineStarts = useMemo(
    () =>
      filterMachineStarts(
        machineStartsAll,
        categories,
      ),
    [machineStartsAll, catParam],
  );

  const exArea = useMemo(
    () =>
      filterExcavatorArea(
        exAreaAll,
        categories,
        fleetStateAll,
        vehicles,
      ),
    [exAreaAll, fleetStateAll, catParam, vehParam],
  );

  const {
    data: areaDays,
    stale: areaStale,
    loading: areaLoading,
    error: areaError,
  } = useApiData(
    () =>
      isPlantFleet
        ? getAreaByDay({
          companyId: activeCompanyId,
          days,
          to,
          categories,
          vehicles,
        })
        : Promise.resolve(null),
    [
      activeCompanyId,
      isPlantFleet,
      days,
      to,
      catParam,
      vehParam,
    ],
    {
      cacheKey: `ft-area-days:${activeCompanyId}:${days}:${windowKey}`,
      keepPreviousData: true,
    },
  );

  const todayOps = useMemo(
    () =>
      summariseToday(fleetState?.units) ?? {
        operational: 0,
        nonOperational: 0,
        avgHours: 0,
      },
    [fleetState],
  );

  const perMachine = useMemo(() => {
    const n = machineWeek?.unitsReporting ?? 0;

    if (!machineWeek || n === 0) {
      return null;
    }

    return {
      hours:
        (machineWeek.totalHours ?? 0) / n,

      distanceKm:
        (machineWeek.totalDistanceKm ?? 0) / n,
    };
  }, [machineWeek]);

  /**
   * Hours per machine per CALENDAR day of the window — idle days included.
   *
   * Deliberately not `machineWeek.avgHoursPerDay`, which the server computes
   * per OBSERVED working unit-day and which therefore answers a different
   * question: how hard a machine worked on the days it worked at all, rather
   * than how much of the period it was earning. Measured 2026-08-28 the two
   * differ by more than a rounding error — KASULU 5.8 against 7.4, SUKARI 3.8
   * against 4.4 — so they are not interchangeable and must not be mixed on one
   * page.
   *
   * This is the figure the card shows and the one the generated report is now
   * given, so the two cannot disagree. If the intent changes to "per day
   * worked", switch BOTH to machineWeek.avgHoursPerDay and change the label
   * back — the label under this number has to keep describing the arithmetic
   * that produced it, which is the fault this replaced.
   */
  const avgHoursPerDay = useMemo(() => {
    const n = machineWeek?.unitsReporting ?? 0;
    const d = machineWeek?.days ?? 0;

    if (!machineWeek || n === 0 || d === 0) {
      return null;
    }

    return (machineWeek.totalHours ?? 0) / n / d;
  }, [machineWeek]);

  const {
    areaBest,
    areaAvgKm2,
    areaMaxMachines,
  } = useMemo(() => {
    const d = areaDays?.days ?? [];

    if (d.length === 0) {
      return {
        areaBest: null,
        areaAvgKm2: 0,
        areaMaxMachines: 0,
      };
    }

    return {
      areaBest: d.reduce(
        (a, x) =>
          x.m2 > a.m2 ? x : a,
        d[0],
      ),

      areaAvgKm2:
        d.reduce(
          (a, x) => a + x.m2,
          0,
        ) /
        d.length /
        1e6,

      areaMaxMachines: Math.max(
        ...d.map((x) => x.machines),
      ),
    };
  }, [areaDays]);

  const mixByCategory = useMemo(() => {
    if (
      !isPlantFleet ||
      !fleetState?.byCategory
    ) {
      return null;
    }

    const out = {};

    for (const c of fleetState.byCategory) {
      const n =
        (c.working ?? 0) +
        (c.idling ?? 0) +
        (c.parked ?? 0) +
        (c.offline ?? 0);

      const key =
        (c.category || "").trim() ||
        UNPREFIXED;

      if (n > 0) {
        out[key] =
          (out[key] ?? 0) + n;
      }
    }

    return Object.keys(out).length > 0
      ? out
      : null;
  }, [isPlantFleet, fleetState]);

  const fleetTypes = (() => {
    const byType =
      ops?.fleet?.byType ?? {};

    const active =
      ops?.fleet?.active ?? 0;

    const tractors =
      byType.TRACTOR ?? 0;

    const trucks =
      byType.TRUCK ?? 0;

    const otherKinds = Object.entries(
      byType,
    )
      .filter(
        ([t]) =>
          t !== "TRACTOR" &&
          t !== "TRUCK",
      )
      .sort((a, b) => b[1] - a[1]);

    return {
      active,
      tractors,
      trucks,

      other: Math.max(
        0,
        active - tractors - trucks,
      ),

      otherKinds,

      otherTooltip: otherKinds
        .map(
          ([t, n]) =>
            `${typeLabel(t)} ${fmt(n)}`,
        )
        .join(" · "),
    };
  })();

  const updating = Boolean(
    dataStale ||
    fuelStale ||
    areaStale ||
    ratesStale ||
    opsStale ||
    weekPending,
  );

  const totals =
    data?.totals ?? {
      trips: 0,
      tonnes: 0,
      distanceKm: 0,
      activeDays: 0,
    };

  const byDay = data?.byDay ?? [];

  const distance =
    data?.distance ?? {
      totalKm: 0,
      perDayKm: 0,
      perWeekKm: 0,
      perMonthKm: 0,
    };

  const todayKey =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: FLEET_TZ,
      },
    ).format(new Date());

  const trendByDay =
    byDay.length > 1 &&
      byDay[byDay.length - 1].day ===
      todayKey
      ? byDay.slice(0, -1)
      : byDay;

  const halfDays = Math.max(
    1,
    Math.floor(
      trendByDay.length / 2,
    ),
  );

  // Keyed on trips, not on the number of day buckets. The API returns a bucket
  // per day in the window whether or not it saw a trip, so `trendByDay` is
  // never empty and a length test would caption an all-zero chart with "last
  // 7d vs previous 7d" — a comparison between two nothings.
  /* "Pending" and "none" are different claims.
     `tripsPending` is the server saying this organisation's trip pipeline has
     never produced a row — MENENGAI and WESTSUGAR, which have no dispatch feed
     yet. That is work not done, not a fleet that made no deliveries, and the
     caption should not settle the question the wrong way while we wait. */
  const subCaption =
    totals.tripsPending
      ? "trips pending"
      : !totals.trips
      ? "no delivery data"
      : trendByDay.length > 1
        ? `last ${halfDays}d vs previous ${halfDays}d`
        : "single day";

  const fuelTotals =
    fuel?.totals ?? {
      litresFilled: 0,
      litresLost: 0,
      cost: 0,
      lossCost: 0,
      fillings: 0,
      thefts: 0,
    };

  const fuelAverages =
    fuel?.averages ?? {
      perDayLitres: 0,
      perDayCost: 0,
    };

  const fuelPrice =
    fuel?.price ?? null;

  // `lost` is what drained OTHER than suspected theft, and `theft` the
  // suspected theft — apart, so a litre is in one bar or the other, never
  // both (lib/fuelTheftSplit).
  const fuelByDay = (
    fuel?.byDay ?? []
  ).map((d) => {
    const { lost, lossCost, theft, theftCost } = splitDrained(d);
    return {
      day: d.day,
      litres: d.litresFilled,
      cost: d.cost,
      lost,
      lossCost,
      theft,
      theftCost,
    };
  });

  // The same split for the rows under the chart
  const fuelSplit = splitDrained(fuelTotals);

  /**
   * The individual drains behind `fuelTotals.litresLost`, newest first.
   *
   * From the same endpoint as the totals rather than a second fetch of
   * /fuel/thefts, so the table in the report always sums to the figure printed
   * above it — see the server's note on `drains`.
   */
  const fuelDrains = (
    fuel?.drains ?? []
  ).map((d) => ({
    at: d.beganAt,
    plate:
      d.registrationPlate ??
      d.name ??
      "—",
    // Litres, not millilitres: the endpoint prices and converts every level on
    // the way out (fuel-pricing), so this arrives in the same unit — and at the
    // same rounding — as the "Litres lost" total the table has to sum to.
    litres: d.litres ?? null,
    cost: d.cost ?? null,
    // The FSL either side of the fall — the level the probe actually read at
    // that hour, rather than only the difference between the two. Present on
    // every drain measured over 30 days, and their difference IS `litres`, so
    // the three columns check each other on the page.
    levelBefore:
      d.levelBefore ?? null,
    levelAfter:
      d.levelAfter ?? null,
    location: d.location ?? null,
    cause: d.cause ?? null,
    causeReason:
      d.causeReason ?? null,
    // Whether an operator was actually told. Computed by the SERVER from the
    // classifier's own rule — re-deriving it here would be a second copy that
    // drifts from the alerts it claims to describe.
    announced: Boolean(
      d.announced,
    ),
    // Null on rows judged before 2026-08-28. Absent, not zero.
    fallSeconds:
      d.fallSeconds ?? null,
  }));

  const hasFuel =
    fuelLoading ||
    fuelTotals.fillings > 0 ||
    fuelTotals.thefts > 0;

  const lossPct =
    fuelTotals.litresFilled > 0
      ? (fuelSplit.lost /
        fuelTotals.litresFilled) *
      100
      : 0;

  const theftPct =
    fuelTotals.litresFilled > 0
      ? (fuelSplit.theft /
        fuelTotals.litresFilled) *
      100
      : 0;

  const hasData =
    !loading &&
    !fuelLoading &&
    (totals.trips > 0 || hasFuel);

  const hasDeliveries =
    loading || totals.trips > 0;

  /* ── which sections have something to say ───────────────────────────────
   *
   * Asked for 2026-09-14: a section with no records should not be drawn, and
   * its space should close up behind it. What that cannot become is a page
   * that quietly loses a card whenever a feed is slow or broken — so the
   * decision goes through `sectionState`, which hides ONLY a feed that has
   * answered and answered with nothing. Loading and failed sections stay and
   * say what they are. See lib/analyticsSections for the whole argument.
   *
   * Each entry carries the label the foot of the page names it by, so the note
   * listing what was withheld is a reading of these decisions rather than a
   * second guess at them.
   */
  /* A BOOLEAN rather than the array, because `byDay` is rebuilt on every
   * render (`data?.byDay ?? []`) and a memo keyed on its identity is a memo
   * that never holds. */
  const anyActiveDay = hasActiveDays(byDay);

  const sections = useMemo(() => ({
    rates: {
      label: "Fuel rates",
      state: sectionState({
        loading: ratesLoading, error: ratesError, hasRows: hasRateDays(fuelRates),
      }),
    },
    perHour: {
      label: "Litres per hour",
      state: sectionState({
        loading: fleetLoading, error: fleetError, hasRows: hasFuelPerHour(fleetState),
      }),
    },
    tonnage: {
      /* One slot, two cards, and the label follows whichever is in it — the
         withheld-sections note at the foot names these, and "Tonnage out of
         the gate" over an absent weighbridge card would send an operator
         looking for a sales chart this org does not show. */
      label: weighs ? "Weighbridge analytics" : "Tonnage out of the gate",
      state: weighs
        ? sectionState({
          loading: wbLoading,
          error: null,
          /* A day with a ticket on it, anywhere in the captured span. Not
             `days.length` — the server returns a point per day asked for and
             most of them are gaps, so a length test would call a month of
             nothing a populated card. */
          hasRows: Boolean(wbAnalytics?.totals?.tickets),
        })
        : sectionState({
          loading: haulsLoading, error: haulsError, hasRows: hasHaulDays(sugarHauls),
        }),
    },
    haulUnits: {
      label: "Units ferrying sugar",
      state: sectionState({
        loading: haulsLoading, error: haulsError, hasRows: hasHaulUnits(sugarHauls),
      }),
    },
    fleet: {
      label: "Fleet state",
      state: sectionState({
        loading: fleetLoading, error: fleetError, hasRows: hasFleetUnits(fleetState),
      }),
    },
    daily: {
      label: "Daily Activity",
      state: isPlantFleet
        ? sectionState({
          loading: areaLoading, error: areaError, hasRows: hasAreaDays(areaDays),
        })
        : sectionState({
          loading, error, hasRows: anyActiveDay,
        }),
    },
    fuelCost: {
      label: "Fuel Consumption & Cost",
      state: sectionState({
        loading: fuelLoading, error: null, hasRows: hasFuel && !fuelLoading,
      }),
    },
  }), [
    ratesLoading, ratesError, fuelRates,
    fleetLoading, fleetError, fleetState,
    haulsLoading, haulsError, sugarHauls,
    weighs, wbLoading, wbAnalytics,
    areaLoading, areaError, areaDays,
    isPlantFleet, loading, error, anyActiveDay, fuelLoading, hasFuel,
  ]);

  const show = useCallback((key) => showSection(sections[key]?.state), [sections]);

  // Tractors on the books. Drives whether the early-departure block is asked
  // at all — see the comment where it renders.
  const tractorFleet =
    ops.fleet?.byType?.TRACTOR ?? 0;

  /* Trucks ON THE BOOKS, which for two of these orgs is zero and does not mean
     what it looks like.
     It is a DENOMINATOR and nothing more. It must never gate the card, and it
     did for one commit: MENENGAI holds 244 units of which 241 are UNSPECIFIED
     and not one is a TRUCK, so a `truckFleet > 0` gate hid a card that had real
     runs behind it — 25 dispatches over five days out of Naitiri, 17 cane and 8
     sales, on six plates.
     The server anticipated exactly this and the gate ignored it. Its truck
     query counts `vehicleType = TRUCK` OR `kind = SALES`, on the reasoning that
     the sales office does not dispatch a tractor to a customer — so the
     lifecycle answers what the registry cannot for the fleets that arrive
     through sync:wialon with no type set at all. The NUMERATOR therefore works
     for Menengai; only the share of the fleet is unavailable, and a missing
     denominator is a thing to say rather than a reason to say nothing. */
  const truckFleet =
    ops.fleet?.byType?.TRUCK ?? 0;

  /* ── the Today-on-the-Ground gates are ORG facts, not selection facts ──────
   *
   * Asked for 2026-09-14: filtering to one unit must not empty the section of
   * cards. It did — `operations-today` is vehicle-filtered, so picking one
   * lorry made `tractorFleet` 0 and its window `trips` 0, and the two gates
   * below removed the Tractors and Trucks cards outright. The reader lost the
   * card rather than seeing it report nothing for the unit they had just
   * picked, which is the worse of the two failures: a card that says "none
   * today" answers the question, a card that is gone does not.
   *
   * The questions those gates ask are about the FLEET — does this org own a
   * tractor, does it raise dispatch paperwork at all — and neither is a
   * question a unit selection is entitled to answer. MENENGAI owns no tractor
   * among 244 units and WESTSUGAR raises no dispatch among 486; those cards
   * should stay absent for them, filtered or not. So the gates are captured
   * while the page is showing the whole org and held across a filter: a
   * selection can then empty a card but never remove one, and never conjure
   * one either.
   *
   * Captured rather than re-fetched because the unfiltered pass always happens
   * first — the filter opens empty and is cleared on every organisation change
   * (see filterForOrgChange above), so there is no route into a filtered view
   * that has not already rendered the unfiltered one. Re-fetching
   * `operations-today` a second time without the filter would buy nothing and
   * cost a request per keystroke.
   *
   * Both fields start TRUE/non-zero-friendly while the window is still
   * loading, which is the safe direction: an unsettled page shows the card and
   * fills it in, rather than hiding one it is about to need. */
  const orgGates = useRef({
    orgId: null,
    hasDeliveries: false,
    tractorFleet: 0,
  });

  if (
    orgGates.current.orgId !==
    activeCompanyId
  ) {
    orgGates.current = {
      orgId: activeCompanyId,
      hasDeliveries: false,
      tractorFleet: 0,
    };
  }

  /* Written during render, deliberately. It is a cache of what this pass can
   * see, not state the page reacts to — nothing re-renders because of it, and
   * the value it records is a pure function of the props of this same pass, so
   * a double invocation writes the same thing twice. */
  if (!filtered && !loading) {
    orgGates.current.hasDeliveries =
      hasDeliveries;
    orgGates.current.tractorFleet =
      tractorFleet;
  }

  /* Under a filter, the wider of the two answers. `||` and `max` rather than a
   * straight swap so a selection can still REVEAL a card on the rare fleet
   * whose org-level pass had not settled when the filter went on. */
  const gateDeliveries = filtered
    ? orgGates.current
      .hasDeliveries ||
    hasDeliveries
    : hasDeliveries;

  const gateTractorFleet = filtered
    ? Math.max(
      orgGates.current.tractorFleet,
      tractorFleet,
    )
    : tractorFleet;

  /* Today on the ground is a row of FOUR tiles, and which four depends on
     what the org records. Composition and sensors are always there; the
     coverage donut nearly always; the rest needs paperwork (Tractors, Trucks)
     or machine families (Machines working early). A fleet with none of that
     (WESTSUGAR, KABRAS, NZOIA, TIMSALES, AQUAMIST raise no dispatches) drew
     three tiles and an empty quarter. The hours-run tile fills the slot from
     the fleet-state rows every tracked org has, and only when the slot is
     empty, so a fleet that has its own fourth keeps it. */
  const todayTiles =
    2 +
    (showFleetDonut ? 1 : 0) +
    (isPlantFleet ? 1 : 0) +
    (!isPlantFleet && gateDeliveries && gateTractorFleet > 0 ? 1 : 0) +
    (!isPlantFleet && gateDeliveries ? 1 : 0);
  const showHoursRun = todayTiles < 4;
  const hoursRun = useMemo(
    () => (showHoursRun ? hoursRunBands(fleetState?.units) : null),
    [showHoursRun, fleetState],
  );

  const activeDaysList =
    byDay.filter(
      (d) => d.trips > 0,
    );

  const busiestDay =
    activeDaysList.reduce(
      (best, d) =>
        !best ||
          d.trips > best.trips
          ? d
          : best,
      null,
    );

  const furthestDay =
    activeDaysList.reduce(
      (best, d) =>
        !best ||
          d.distanceKm >
          best.distanceKm
          ? d
          : best,
      null,
    );

  const avgTripsPerActiveDay =
    activeDaysList.length
      ? totals.trips /
      activeDaysList.length
      : 0;

  const longestStreak = (() => {
    if (
      activeDaysList.length === 0
    ) {
      return 0;
    }

    const times =
      activeDaysList
        .map((d) =>
          new Date(
            `${d.day}T00:00:00Z`,
          ).getTime(),
        )
        .sort((a, b) => a - b);

    let best = 1;
    let run = 1;

    for (
      let i = 1;
      i < times.length;
      i++
    ) {
      run =
        times[i] -
          times[i - 1] ===
          86_400_000
          ? run + 1
          : 1;

      best = Math.max(
        best,
        run,
      );
    }

    return best;
  })();

  const perTripKm =
    totals.trips
      ? distance.totalKm /
      totals.trips
      : 0;

  // ─── Chart refs used by PDF generation ────────────────────────────────

  const operationalRef =
    useRef(null);

  const sensorRef =
    useRef(null);

  const fuelHistogramRef =
    useRef(null);

  const fuelConsumptionRef =
    useRef(null);

  // ─── PDF report generation state ──────────────────────────────────────
  //
  // This state is set BEFORE starting the asynchronous PDF process.
  //
  // That means the button immediately becomes:
  //
  //   Generating PDF…
  //
  // and cannot be clicked again until the promise settles.

  const [
    isGeneratingReport,
    setIsGeneratingReport,
  ] = useState(false);

  const handleDownloadReport =
    async () => {
      // Hard guard against duplicate generation.
      //
      // Even if a second click somehow gets through before React updates
      // the disabled state, this prevents a second report from starting.
      if (
        !hasData ||
        isGeneratingReport
      ) {
        return;
      }

      // IMPORTANT:
      // Set this before the asynchronous work begins so the UI immediately
      // reflects that the button has been clicked.
      setIsGeneratingReport(true);

      try {
        await downloadAnalyticsReport({
          isPlantFleet,
          darkMode,

          companyName:
            activeCompany?.short ||
            activeCompany?.name ||
            "Fleet",

          windowLabel: month,

          filename: `${activeCompany?.short ||
            "Fleet"
            }-Analytics-Report.pdf`,

          chartRefs: {
            operational:
              operationalRef.current,

            sensor:
              sensorRef.current,

            fuelHistogram:
              fuelHistogramRef.current,

            fuelConsumption:
              fuelConsumptionRef.current,
          },

          // Plant data
          machineWeek,
          // The card's own figure, passed rather than left to be recomputed.
          // The report read machineWeek.avgHoursPerDay — a different
          // definition — and printed 7.4 h beside a dashboard showing 5.8.
          avgHoursPerDay,
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
          fuelDrains,
        });
      } catch (err) {
        console.error(
          "PDF generation failed:",
          err,
        );

        // The button is re-enabled in finally below.
        //
        // Keep the existing behaviour of logging the error. If the
        // DownloadReportButton or parent later gets an error UI, this is
        // the place to surface it.
      } finally {
        // IMPORTANT:
        //
        // Whether PDF generation succeeds OR fails, unlock the button.
        setIsGeneratingReport(false);
      }
    };

  if (error) {
    return (
      <div className="analytics-page">
        <div className="analytics-page__inner">
          <LoadError
            label="Analytics"
            onRetry={retry}
            fullSection
          />
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-page">
      <div className="analytics-page__inner">
        <div data-tour="page-filters" className="an-head an-head--bare">
          <AnalyticsFilterBar
            filter={filter}
            onChange={setFilter}
            // The funnel. Already hidden for haulage fleets, which have no
            // meaningful categories to filter by; `map:filter` now decides it
            // for the fleets that do. AnalyticsFilterBar renders nothing when
            // the options are null, so this removes the control rather than
            // disabling it.
            options={
              isPlantFleet && canFilterUnits
                ? vehicleCategories
                : null
            }
            /* The unit picker, for EVERY fleet — unlike the type picker, which
               is hidden on haulage because a plate prefix there is a
               registration series rather than a machine family. A plate is a
               plate on any fleet, so the only gate is the same permission. */
            units={canFilterUnits ? unitChoices : null}
            minMonth={RECORD_START_MONTH}
            maxMonth={nowMonth}
            today={todayIso}
            updating={updating}
          >
            {hasData && (
              <DownloadReportButton
                onGenerate={
                  handleDownloadReport
                }
                // Rendered in the browser from data already on screen, so the
                // server never sees a request to refuse — the button is the
                // only control there is.
                permission="analytics:export"

                // Immediate visual feedback.
                label={
                  isGeneratingReport
                    ? "Generating PDF…"
                    : "PDF Report"
                }

                // Locked for the complete duration of the
                // asynchronous report-generation process.
                disabled={
                  isGeneratingReport ||
                  !hasData
                }
              />
            )}
          </AnalyticsFilterBar>
        </div>

        {!hasData && !loading ? (
          <TabEmptyState
            icon={
              <AnalyticsIcon size={44} />
            }
            title="Analytics"
            hint={
              filtered
                ? `No delivery or fuel history for ${month} on the vehicle types selected. Clear the filter or pick a wider window.`
                : "No delivery or fuel history yet. Analytics will appear here once the live integration is connected."
            }
          />
        ) : (
          <ErrorBoundary label="Analytics">
            <div
              className={`an-body${updating
                ? " an-body--updating"
                : ""
                }`}
            >
              {/* PLANT FLEET TOP ROW */}
              {isPlantFleet && (
                <div data-tour="an-summary" className="an-top">
                  <div className="an-card an-distance">
                    <div className="an-card__head">
                      <span className="an-card__title">
                        Summary
                      </span>

                      <span className="an-card__hint">
                        {!machineWeek
                          ? "—"
                          : !endsToday
                            ? month
                            : machineWeek.days ===
                              1
                              ? "today, still running"
                              : `${days_(
                                machineWeek.days,
                              )} to today`}
                      </span>
                    </div>

                    <div className="an-dist-body">
                      <div className="an-dist-total">
                        <div className="an-dist-total__value">
                          {fmtOrDash(
                            avgHoursPerDay,
                            1,
                          )}
                          <span>
                            {" "}
                            h
                          </span>
                        </div>

                        <div className="an-dist-total__label">
                          average hours per machine, per day across the window
                        </div>
                      </div>

                      <div className="an-avgs an-avgs--pair">
                        <AvgTile
                          label="Average hours per machine"
                          value={fmtOrDash(
                            perMachine?.hours,
                            1,
                          )}
                          unit="h"
                        />

                        <AvgTile
                          label="Average distance per machine"
                          value={fmtOrDash(
                            perMachine?.distanceKm,
                          )}
                          unit="km"
                        />
                      </div>

                      <div className="an-dist-foot">
                        {endsToday
                          ? machineWeek?.days ===
                            1
                            ? "Today so far, whether or not a machine worked"
                            : `Today and the ${days_(
                              (machineWeek?.days ??
                                7) -
                              1,
                            )} before it, whether or not a machine worked`
                          : `${month}, whether or not a machine worked`}{" "}
                        ·{" "}
                        {fmtOrDash(
                          machineWeek?.totalHours,
                        )}{" "}
                        h and{" "}
                        {fmtOrDash(
                          machineWeek?.totalDistanceKm,
                        )}{" "}
                        km across{" "}
                        {fmtOrDash(
                          machineWeek?.unitsReporting,
                        )}{" "}
                        units reporting · that average is{" "}
                        {machineWeek
                          ? Math.round(
                            ((avgHoursPerDay ?? 0) /
                              (machineWeek.expectedHoursPerDay ?? 1)) *
                            100,
                          )
                          : "—"}
                        % of the{" "}
                        {
                          machineWeek?.expectedHoursPerDay
                        }{" "}
                        h day
                      </div>
                    </div>
                  </div>

                  <div data-tour="page-kpis" className="an-kpis">
                    <StatCard
                      label="Distance covered"
                      value={fmtOrDash(
                        machineWeek?.distanceTodayKm,
                      )}
                      unit="km today"
                      series={machineWeek?.byDay.map(
                        (d) => d.distanceKm,
                      )}
                      days={machineWeek?.byDay.map(
                        (d) => d.day,
                      )}
                      agg="sum"
                      type="line"
                      color={DEPOT_COLOR}
                      sub={
                        machineWeek
                          ? `${fmt(
                            machineWeek.totalDistanceKm,
                          )} km over ${machineWeek.days
                          } days`
                          : "not reported yet"
                      }
                      tipFormat={(v) =>
                        `${fmt(v)} km`
                      }
                    />

                    <StatCard
                      label="Area worked (avg)"
                      value={
                        areaDays?.days?.length
                          ? fmt(
                            areaDays.days.reduce(
                              (sum, d) =>
                                sum +
                                d.m2 /
                                1e4,
                              0,
                            ) /
                            areaDays.days
                              .length,
                            1,
                          )
                          : "—"
                      }
                      unit="ha / day"
                      series={areaDays?.days.map(
                        (d) =>
                          d.m2 / 1e4,
                      )}
                      days={areaDays?.days.map(
                        (d) => d.day,
                      )}
                      agg="avg"
                      type="bar"
                      color={PRODUCT_COLOR}
                      sub={
                        areaDays
                          ? `avg over ${areaDays.measuredDays
                          } measured day${areaDays.measuredDays ===
                            1
                            ? ""
                            : "s"
                          }`
                          : "not yet measured"
                      }
                      tipFormat={(v) =>
                        `${fmt(v, 1)} ha`
                      }
                    />

                    <StatCard
                      label="Working hours per day (avg)"
                      value={fmtOrDash(
                        avgHoursPerDay,
                        1,
                      )}
                      unit="h"
                      series={machineWeek?.byDay.map(
                        (d) => d.hours,
                      )}
                      days={machineWeek?.byDay.map(
                        (d) => d.day,
                      )}
                      agg="avg"
                      type="bar"
                      color={TRIPS_COLOR}
                      sub={`against ${machineWeek?.expectedHoursPerDay} h expected`}
                      tipFormat={(v) =>
                        `${fmt(v, 1)} h`
                      }
                    />
                  </div>
                </div>
              )}

              {/* HAULAGE FLEET TOP ROW */}
              {/*
                Rendered for every haulage fleet, including one with no trips at
                all. MENENGAI and WESTSUGAR have no dispatch feed — the provider
                maps only NDHIWA to SUKARI, so no dispatch is ever attributed to
                them and `totals.trips` is 0 — and this row used to disappear
                entirely, which reads as "the page is broken for this org"
                rather than "there is nothing to show yet".

                Nothing below needs a guard added: `perTripKm` and
                `avgTripsPerActiveDay` already fall back to 0 rather than
                dividing by zero, `distance` defaults to zeroes, `trendByDay`
                is an empty array, and `Sparkline` returns null on an empty
                series. So the cards come out as honest zeroes carrying an
                explicit hint, instead of vanishing.
              */}
              {!isPlantFleet && (
                  <div data-tour="an-summary" className="an-top">
                    <div className="an-card an-distance">
                      <div className="an-card__head">
                        <span className="an-card__title">
                          Summary
                        </span>

                        <span className="an-card__hint">
                          {/* A bare "0 days" would read as a measured zero.
                              This org has no dispatch feed, which is a
                              different statement. */}
                          {totals.trips
                            ? `${totals.activeDays} of ${days} days active`
                            : totals.tripsPending
                              ? "trips pending"
                              : "no delivery data"}
                        </span>
                      </div>

                      <div className="an-dist-body">
                        <div className="an-dist-total">
                          <div className="an-dist-total__value">
                            {fmt(
                              distance.totalKm,
                            )}
                            <span>
                              {" "}
                              km
                            </span>
                          </div>

                          <div className="an-dist-total__label">
                            total distance
                          </div>
                        </div>

                        <div className="an-avgs an-avgs--pair">
                          <AvgTile
                            label="Average distance per day"
                            value={fmt(
                              distance.perDayKm,
                            )}
                            unit="km"
                          />

                          <AvgTile
                            label="Average distance per trip"
                            value={fmt(
                              perTripKm,
                            )}
                            unit="km"
                          />
                        </div>

                        <div className="an-dist-foot">
                          <span>
                            {/* Which denominator, said out loud. The head
                                counts the days that carried a trip; the
                                average above divides by every day in the
                                window, and 3,352 x 11 does not make 46,922. */}
                            {fmt(totals.trips)} completed trip
                            {totals.trips === 1 ? "" : "s"}. The averages above
                            are across all {fmt(days)} days in the window, not
                            only the {fmt(totals.activeDays)} with trips.
                          </span>
                        </div>
                      </div>
                    </div>

                    <div data-tour="page-kpis" className="an-kpis">
                      <StatCard
                        label="Completed trips"
                        value={fmt(
                          totals.trips,
                        )}
                        series={trendByDay.map(
                          (d) => d.trips,
                        )}
                        days={trendByDay.map(
                          (d) => d.day,
                        )}
                        agg="sum"
                        type="bar"
                        color={TRIPS_COLOR}
                        sub={subCaption}
                        tipFormat={(v) =>
                          `${fmt(v)} trip${v === 1
                            ? ""
                            : "s"
                          }`
                        }
                      />

                      <StatCard
                        label="Distance covered"
                        value={fmt(
                          totals.distanceKm,
                        )}
                        unit="km"
                        series={trendByDay.map(
                          (d) =>
                            d.distanceKm,
                        )}
                        days={trendByDay.map(
                          (d) => d.day,
                        )}
                        agg="sum"
                        type="line"
                        color={DEPOT_COLOR}
                        sub={subCaption}
                        tipFormat={(v) =>
                          `${fmt(v)} km`
                        }
                      />

                      <StatCard
                        label="Trips per day"
                        value={fmt(
                          avgTripsPerActiveDay,
                          1,
                        )}
                        series={trendByDay.map(
                          (d) => d.trips,
                        )}
                        days={trendByDay.map(
                          (d) => d.day,
                        )}
                        agg="avg"
                        type="bar"
                        color={PRODUCT_COLOR}
                        sub={`over ${totals.activeDays
                          } day${totals.activeDays ===
                            1
                            ? ""
                            : "s"
                          } with trips`}
                        tipFormat={(v) =>
                          `${fmt(v)} trip${v === 1
                            ? ""
                            : "s"
                          }`
                        }
                      />
                    </div>
                  </div>
                )}

              {/* TODAY ON THE GROUND */}
              {ops && (
                <>
                  <div data-tour="an-today" className="an-today an-card an-card--wide">
                    <div className="an-card__head">
                      <span className="an-card__title">
                        Today on the ground
                      </span>

                      <span className="an-card__hint">
                        {fmtDay(ops.day)} · since 00:00{" "}
                        {FLEET_TZ.split(
                          "/",
                        )[1].replace(
                          "_",
                          " ",
                        )}
                      </span>
                    </div>

                    {isPlantFleet && (
                      <OpsLedger
                        items={[
                          {
                            k: "operational",
                            v: fmtOrDash(
                              todayOps?.operational,
                            ),
                          },
                          {
                            k: "non-operational",
                            v: fmtOrDash(
                              todayOps?.nonOperational,
                            ),
                          },
                          {
                            k: "avg hours run",
                            v: fmtOrDash(
                              todayOps?.avgHours,
                              1,
                            ),
                            unit: "h",
                          },
                        ]}
                      />
                    )}

                    <div className="an-today__grid">
                      <OpsBlock
                        tour="an-mix"
                        accent="var(--chart-1)"
                        chartOnly
                        title="Fleet composition"
                      >
                        <FleetMixPie
                          byType={
                            mixByCategory ??
                            ops.fleet?.byType
                          }
                          total={
                            fleetTypes.active
                          }
                          typeLabel={
                            mixByCategory
                              ? (c) => c
                              : typeLabel
                          }
                          tailKeys={
                            mixByCategory
                              ? UNPREFIXED_SET
                              : undefined
                          }
                        />
                      </OpsBlock>

                      {showFleetDonut && (
                        <OpsBlock
                          tour="an-coverage"
                          accent="var(--chart-2)"
                          chartOnly
                          title={
                            isPlantFleet
                              ? "Operational today"
                              : "Fleet coverage"
                          }
                          containerRef={
                            operationalRef
                          }
                        >
                          <FleetStateDonut
                            state={fleetState}
                            ops={todayOps}
                            mode={
                              isPlantFleet
                                ? "operational"
                                : "coverage"
                            }
                          />
                        </OpsBlock>
                      )}

                      {/*
                        Every fleet, not just plant. Fuel probes and trackers
                        are fitted across all four organisations — the fuel
                        ledger reads them for each — so "how much of this fleet
                        is actually measuring?" is the same question everywhere,
                        and it was only ever answered for KASULU.

                        SensorGauge carries its own empty state: an org whose
                        units report no sensor health renders the titled card
                        with "No unit reports a sensor state." rather than
                        vanishing, which is the behaviour the haulage row above
                        was also changed to.
                      */}
                      <OpsBlock
                        tour="an-sensors"
                        accent="var(--chart-3)"
                        chartOnly
                        className="an-ops--gauge"
                        containerRef={sensorRef}
                      >
                        <SensorGauge
                          state={fleetState}
                        />
                      </OpsBlock>

                      {/*
                        Dispatch-derived, so it needs a dispatch feed — and it
                        is about TRACTORS, so it also needs tractors.

                        The second condition is not pedantry. MENENGAI runs
                        sugar out of Naitiri on trucks and has no tractor on its
                        books at all (241 of its 244 active units are typed
                        UNSPECIFIED, three are PLANT, none is a TRACTOR), so
                        this block could only ever report "0 before 06:00" over
                        four zeroed bars — a statement about a morning that was
                        never measured, for a machine the fleet does not own.

                        It used to be gated on `hasDeliveries` alone, which was
                        adequate only while those orgs had no dispatch feed
                        whatsoever. They do now, so the card would have appeared
                        the moment the first sales run landed. Ask the question
                        the block is actually about.
                      */}
                      {!isPlantFleet && gateDeliveries && gateTractorFleet > 0 && (
                        <OpsBlock
                          tour="an-early"
                          accent="var(--dawn-2)"
                          label="Tractors dispatched early"
                          value={fmt(
                            ops.earlyDepartures
                              ?.before06,
                          )}
                          /* Short, and it stays short. The tiles are a
                             quarter of the row — about 265px — and a sub that
                             also carried the denominator ("of 196 out, before
                             06:00") broke after the comma and left a hole
                             between the figure and the bar. The denominator is
                             stated under the track instead, where the line has
                             the width for it. */
                          sub="before 06:00"
                        >
                          <EarlyBands
                            out={
                              ops.earlyDepartures
                                ?.tractorsOut ?? 0
                            }
                            before04={
                              ops.earlyDepartures
                                ?.before04 ?? 0
                            }
                            before05={
                              ops.earlyDepartures
                                ?.before05 ?? 0
                            }
                            before06={
                              ops.earlyDepartures
                                ?.before06 ?? 0
                            }
                          />
                        </OpsBlock>
                      )}

                      {/* Gated on having a dispatch feed at all, which is the
                          tractor block's own first condition and the only one
                          that applies here. WESTSUGAR has 486 units and no
                          dispatch paperwork whatsoever, so it has nothing to
                          report and falls out on `hasDeliveries`; MENENGAI has
                          runs and keeps its card. */}
                      {!isPlantFleet && gateDeliveries && (
                        <OpsBlock
                          tour="an-trucks"
                          accent="var(--chart-4)"
                          label="Trucks dispatched"
                          value={fmt(
                            ops.dispatches
                              ?.trucks,
                          )}
                          /* The denominator, in the head — where the share is
                             read, rather than in a "Fleet trucks" line at the
                             foot of the tile two rows under the bar that
                             depends on it, and a `title` only a mouse reaches.
                             Omitted entirely where there is no denominator to
                             give: "of 0 fleet trucks" over a real count is a
                             worse statement than no statement. */
                          sub={
                            truckFleet > 0
                              ? `of ${fmt(truckFleet)} fleet trucks`
                              : "signed out today"
                          }
                        >
                          {/* The share, only where a share exists. A track
                              against a zero denominator draws empty beside a
                              non-zero figure, which reads as "none of them"
                              rather than as "we cannot say". */}
                          {truckFleet > 0 && (
                            <OpsBar
                              k="Signed out today"
                              n={
                                ops.dispatches
                                  ?.trucks ?? 0
                              }
                              of={truckFleet}
                              color="var(--chart-4)"
                            />
                          )}

                          <OpsLine
                            k="Last signed out"
                            v={
                              ops.dispatches
                                ?.truckList?.[0]
                                ? clockFmt.format(
                                  new Date(
                                    ops.dispatches.truckList[0].at,
                                  ),
                                )
                                : "—"
                            }
                            em
                          />

                          {/* Why there is no share, where there is none.
                              These fleets arrive through sync:wialon, which
                              sets no vehicle type, so the registry holds no
                              trucks to take a percentage of — and the count
                              above is standing on the RUN's own kind instead.
                              Said plainly, because a figure resting on a
                              different definition from the one beside it on the
                              same page should say which it is using. */}
                          {truckFleet === 0 && (
                            <div className="an-ops__caveat">
                              {/* The SUBJECT changes with the filter. Unfiltered
                                  this is a statement about the fleet's registry;
                                  under a unit selection the same zero means the
                                  units picked are not typed trucks, and saying
                                  "none of this fleet" while one plate is
                                  selected describes something the reader is not
                                  looking at. */}
                              {unitFiltered
                                ? `Counted from sales runs: the registry does not type ${singleUnit ? "this unit" : "the units selected"} as a truck, so a share is not available.`
                                : "Counted from sales runs: the registry types none of this fleet as a truck, so a share of it is not available."}
                            </div>
                          )}

                          {/* A caveat about the figure above, not another
                              statistic beneath it. "Plate unresolved 12" was a
                              bare count with no stated subject — a reader could
                              as easily take it for twelve more trucks as for a
                              reason the headline is short. These runs are in no
                              figure on this tile, and the row says so. */}
                          {ops.dispatches
                            ?.plateUnresolved >
                            0 && (
                              <div className="an-ops__caveat">
                                {fmt(
                                  ops.dispatches
                                    .plateUnresolved,
                                )}{" "}
                                dispatched on a plate the
                                registry does not hold —
                                counted in none of the
                                above.
                              </div>
                            )}
                        </OpsBlock>
                      )}

                      <MachineOperations
                        companyId={
                          activeCompanyId
                        }
                        starts={
                          machineStarts
                        }
                        /* This chart counts machines BY FAMILY and has no
                           per-unit rows behind it, so a unit selection cannot
                           narrow it. It says so rather than drawing every
                           excavator under a filter naming one. */
                        unitFiltered={unitFiltered}
                      />

                      {/* The fourth tile for fleets with no other fourth —
                          see `showHoursRun`. The units that ran, drawn as a
                          radar over six engine-hour bands. */}
                      {showHoursRun && (
                        <OpsBlock
                          tour="an-hours"
                          accent="var(--chart-5)"
                          className="an-ops--radar"
                          label="Hours run today"
                          value={fmtOrDash(hoursRun?.ran)}
                          /* One line under the figure: the denominator and
                             the mean, where the old tile spent two rows and a
                             caveat paragraph on them. */
                          sub={
                            hoursRun
                              ? `of ${fmt(hoursRun.units)}` +
                                (todayOps?.avgHours != null
                                  ? ` · ${fmt(todayOps.avgHours, 1)} h avg`
                                  : "")
                              : "ran"
                          }
                        >
                          {!hoursRun ? (
                            <div className="an-ops__none">Reading engine hours…</div>
                          ) : hoursRun.ran === 0 ? (
                            <div className="an-ops__none">Nothing has run since midnight.</div>
                          ) : (
                            <HoursRunRadar
                              bands={hoursRun.bands}
                              unbanded={hoursRun.movedNoHours}
                            />
                          )}
                        </OpsBlock>
                      )}
                    </div>

                    {/* Either chart may be withheld on its own, and the row
                        collapses to one column when it is — see .an-fuelrow in
                        the stylesheet. The row itself goes only when BOTH have
                        nothing, rather than leaving an empty grid behind. */}
                    {isPlantFleet && (show("rates") || show("perHour")) && (
                      <div data-tour="an-fuelrow" className="an-fuelrow">
                        {show("rates") && (
                          <FuelRateChart
                            series={fuelRates}
                          />
                        )}

                        {show("perHour") && (
                          <div
                            ref={
                              fuelHistogramRef
                            }
                          >
                            <FuelPerHourHistogram
                              state={
                                fleetState
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/*
                      The haulage pair, answering the same two questions the
                      plant row above answers — what does the work cost, and how
                      much of it got done — in the units a haulage fleet works
                      in.

                      Left: the SAME FuelRateChart, restricted to its kilometre
                      view. The hectare denominator is excavator work and means
                      nothing to a truck, so the toggle is not offered rather
                      than offered and left empty.

                      Right: tonnage rather than a distribution of hourly rates.
                      A haulage fleet's output is what it delivered, and the
                      per-hour histogram's whole subject — two populations of
                      machine with different jobs — does not exist here.

                      For a fleet that WEIGHS, that right-hand slot holds the
                      bridges instead. Same question — what left the gate —
                      read off the scale rather than off the sales office's
                      paperwork, which for a mill running four of them is the
                      better witness and carries the lorries and the wait as
                      well as the weight. See WEIGHBRIDGE_FLEETS above.
                    */}
                    {!isPlantFleet && (show("rates") || show("tonnage")) && (
                      <div data-tour="an-haulrow" className="an-fuelrow">
                        {show("rates") && (
                          <FuelRateChart
                            series={fuelRates}
                            views={["litresPerKm"]}
                          />
                        )}

                        {show("tonnage") && (
                          weighs
                            ? <WeighbridgeAnalytics data={wbAnalytics} loading={wbLoading} />
                            : <SugarTonnageChart hauls={sugarHauls} loading={haulsLoading} />
                        )}
                      </div>
                    )}
                  </div>

                  {isPlantFleet && show("fleet") && (
                    <FleetStateSection
                      state={fleetState}
                      area={exArea}
                      windowSpan={`${days}d`}
                      windowLabel={month}
                    />
                  )}

                  {!isPlantFleet && show("haulUnits") && (
                    <SugarHaulUnits
                      hauls={sugarHauls}
                      loading={haulsLoading}
                    />
                  )}

                  {/* Every fleet but Mufindi's — see the fetch above.
                      Withdrawn 2026-09-14; uncomment with the import and the
                      fetch to bring it back.

                  {!isPlantFleet && (
                    <StopClusters data={stopClusters} loading={stopsLoading} />
                  )} */}
                </>
              )}

              {/* Fuel against standard — the Fuel › Report fleet review over this
                  window. Draws itself only where the review judged a unit (the
                  machine register's standards are Kasulu's alone today). */}
              {canDo("fuel_filling:read") && (
                <FuelStandardCard
                  companyId={activeCompanyId} days={days} to={to} windowLabel={month}
                  onOpen={() => {
                    try { localStorage.setItem("fuelReport.mode", "review"); } catch { /* opens on its default */ }
                    setDesktopActiveTab("fuelReport");
                  }}
                />
              )}

              {/* GRID: FUEL + DAILY ACTIVITY */}
              <div className="an-grid">
                {show("fuelCost") && (
                  // `hasFuel` as it was, read through the same gate as
                  // everything else so the withheld note can name it.
                  
                  <Card
                    tour="an-fuelcost"
                    title="Fuel Consumption &amp; Cost"
                    hint={`${fmt(
                      fuelTotals.litresFilled,
                    )} L · ${fmt(
                      fuelTotals.fillings,
                    )} fillings`}
                  >
                    <div
                      ref={
                        fuelConsumptionRef
                      }
                    >
                      {/*
                        * One plate gets a different chart, not a filtered
                        * one. See UnitFuelChart for why a rate needs a
                        * denominator the fleet chart does not carry.
                        */}
                      {singleUnit ? (
                        <UnitFuelChart
                          fuelDays={fuelByDay}
                          unitFuel={unitFuel}
                          loading={
                            unitFuelLoading
                          }
                        />
                      ) : (
                        <FuelChart
                          series={fuelByDay}
                          currency={
                            fuelPrice?.currency ??
                            "KES"
                          }
                        />
                      )}
                    </div>

                    <div className="an-calc">
                      <div className="an-calc__row">
                        <span className="an-calc__k">
                          Fuel put in
                        </span>

                        <span className="an-calc__v">
                          {fmt(
                            fuelTotals.litresFilled,
                          )}{" "}
                          L
                        </span>
                      </div>

                      <div className="an-calc__row an-calc__row--em">
                        <span className="an-calc__k">
                          Fuel cost{" "}
                          <em>
                            (at{" "}
                            {fuelPrice?.currency ??
                              "KES"}{" "}
                            {fmt(
                              fuelPrice?.pricePerLitre ??
                              0,
                              2,
                            )}
                            /L)
                          </em>
                        </span>

                        <span className="an-calc__v">
                          {fuelPrice?.currency ??
                            "KES"}{" "}
                          {fmt(
                            fuelTotals.cost,
                          )}
                        </span>
                      </div>

                      <div className="an-calc__row">
                        <span className="an-calc__k">
                          Fuel drained{" "}
                          <em>
                            (
                            {fmt(
                              fuelSplit.drains,
                            )}{" "}
                            event
                            {fuelSplit.drains === 1
                              ? ""
                              : "s"}
                            )
                          </em>
                        </span>

                        <span className="an-calc__v">
                          {fmt(
                            fuelSplit.lost,
                          )}{" "}
                          L ·{" "}
                          {fmt(
                            lossPct,
                            1,
                          )}
                          %
                        </span>
                      </div>

                      <div className="an-calc__row an-calc__row--em">
                        <span className="an-calc__k">
                          Value of fuel drained
                        </span>

                        <span className="an-calc__v">
                          {fuelPrice?.currency ??
                            "KES"}{" "}
                          {fmt(
                            fuelSplit.lossCost,
                          )}
                        </span>
                      </div>

                      {/* Suspected theft, apart from what drained above:
                          the SIPHON drains, the only ones the product calls
                          possible theft (lib/fuelTheftSplit). */}
                      <div className="an-calc__row an-calc__row--theft">
                        <span className="an-calc__k">
                          Suspected theft{" "}
                          <em>
                            (
                            {fmt(
                              fuelSplit.thefts,
                            )}{" "}
                            event
                            {fuelSplit.thefts === 1
                              ? ""
                              : "s"}
                            )
                          </em>
                        </span>

                        <span className="an-calc__v">
                          {fmt(
                            fuelSplit.theft,
                          )}{" "}
                          L ·{" "}
                          {fmt(
                            theftPct,
                            1,
                          )}
                          %
                        </span>
                      </div>

                      <div className="an-calc__row an-calc__row--em an-calc__row--theft">
                        <span className="an-calc__k">
                          Value of suspected theft
                        </span>

                        <span className="an-calc__v">
                          {fuelPrice?.currency ??
                            "KES"}{" "}
                          {fmt(
                            fuelSplit.theftCost,
                          )}
                        </span>
                      </div>

                      <div className="an-calc__row">
                        <span className="an-calc__k">
                          Average per active day
                        </span>

                        <span className="an-calc__v">
                          {fmt(
                            fuelAverages.perDayLitres,
                          )}{" "}
                          L ·{" "}
                          {fuelPrice?.currency ??
                            "KES"}{" "}
                          {fmt(
                            fuelAverages.perDayCost,
                          )}
                        </span>
                      </div>

                    </div>
                  </Card>
                )}

                {/*
                  Every haulage fleet, gated on the fleet TYPE rather than on
                  whether it has trips. KASULU keeps its own area-based Daily
                  activity card further down, so this must stay off for plant or
                  that org gets two.

                  With no trips the calendar still draws — `byDay` carries a
                  bucket per day in the window whether or not one saw a trip, so
                  DailyHeatmap's empty state (which needs a zero-LENGTH series)
                  never fires and the month renders as an honest grid of quiet
                  days. The side highlights already fall back to "—" and "no
                  activity".
                */}
                {/* CHANGED 2026-09-14: gated on a day the fleet actually ran
                    rather than on the fleet type. The note above still holds —
                    `byDay` carries a bucket per day whether or not one saw a
                    trip, so the heatmap's own empty state never fires and a
                    dead month drew as a full grid of quiet days with "—" in
                    every highlight. That is the card this was asked to stop
                    drawing. */}
                {!isPlantFleet && show("daily") && (
                  <Card
                    tour="an-daily"
                    title="Daily Activity"
                    hint={`${totals.activeDays ?? 0} of ${days} days active`}
                  >
                    <div className="an-daily">
                      <div className="an-daily__heat">
                        <DailyHeatmap
                          series={byDay}
                        />
                      </div>

                      <div className="an-daily__side">
                        <Highlight
                          label="Busiest day"
                          value={
                            busiestDay
                              ? fmtDay(
                                busiestDay.day,
                              )
                              : "—"
                          }
                          sub={
                            busiestDay
                              ? `${busiestDay.trips} trip${busiestDay.trips ===
                                1
                                ? ""
                                : "s"
                              }`
                              : "no activity"
                          }
                        />

                        <Highlight
                          label="Avg / active day"
                          value={fmt(
                            avgTripsPerActiveDay,
                            1,
                          )}
                          sub="trips per day"
                        />

                        <Highlight
                          label="Furthest day"
                          value={
                            furthestDay
                              ? `${fmt(
                                furthestDay.distanceKm,
                              )} km`
                              : "—"
                          }
                          sub={
                            furthestDay
                              ? fmtDay(
                                furthestDay.day,
                              )
                              : "no activity"
                          }
                        />

                        <Highlight
                          label="Longest streak"
                          value={`${longestStreak}`}
                          sub={`day${longestStreak ===
                            1
                            ? ""
                            : "s"
                            } running`}
                        />
                      </div>
                    </div>
                  </Card>
                )}

                {/* Was: draw while the feed is null OR carries any day at
                    all. A month of measured-but-empty days passed that test and
                    drew an empty heatmap; `show` asks whether any day has
                    ground on it, and keeps the null case by way of the
                    loading state. */}
                {isPlantFleet && show("daily") && (
                    <Card
                      tour="an-daily"
                      title="Daily Activity"
                      hint={
                        areaDays
                          ? `${areaDays.measuredDays} of ${areaDays.windowDays} days measured`
                          : "measuring…"
                      }
                    >
                      <div className="an-daily">
                        <div className="an-daily__heat">
                          <DailyHeatmap
                            series={
                              areaDays?.days ??
                              []
                            }
                            value={(d) =>
                              d.m2
                            }
                            empty="No ground measured yet"
                            label={(c) =>
                              c.rec
                                ? `${fmtDay(
                                  c.iso,
                                )} · ${fmt(
                                  c.rec
                                    .km2,
                                  3,
                                )} km² · ${c.rec
                                  .machines
                                } machine${c.rec
                                  .machines ===
                                  1
                                  ? ""
                                  : "s"
                                }`
                                : `${fmtDay(
                                  c.iso,
                                )} · not measured`
                            }
                          />
                        </div>

                        <div className="an-daily__side">
                          <Highlight
                            label="Most ground"
                            value={
                              areaBest
                                ? `${fmt(
                                  areaBest.km2,
                                  3,
                                )} km²`
                                : "—"
                            }
                            sub={
                              areaBest
                                ? fmtDay(
                                  areaBest.day,
                                )
                                : "no activity"
                            }
                          />

                          <Highlight
                            label="Avg / measured day"
                            value={`${fmt(
                              areaAvgKm2,
                              3,
                            )} km²`}
                            sub="ground turned over"
                          />

                          <Highlight
                            label="Total"
                            value={
                              areaDays
                                ? `${fmt(
                                  areaDays.totalM2 /
                                  1e6,
                                  2,
                                )} km²`
                                : "—"
                            }
                            sub={
                              areaDays
                                ? `over ${areaDays.measuredDays
                                } day${areaDays.measuredDays ===
                                  1
                                  ? ""
                                  : "s"
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

// ─── Helper components and functions ────────────────────────────────────

function periodDelta(values, agg) {
  if (values.length < 2) {
    return null;
  }

  const half = Math.max(
    1,
    Math.floor(values.length / 2),
  );

  const cur = values.slice(-half);

  const prev = values.slice(
    -2 * half,
    -half,
  );

  const total = (arr) =>
    arr.reduce(
      (s, x) => s + x,
      0,
    );

  const a = (arr) =>
    arr.length === 0
      ? 0
      : agg === "avg"
        ? total(arr) /
        arr.length
        : total(arr);

  const c = a(cur);
  const p = a(prev);

  if (p <= 0) {
    return c > 0 ? 100 : 0;
  }

  return Math.round(
    ((c - p) / p) * 100,
  );
}

function StatCard({
  label,
  value,
  unit,
  series = [],
  days = [],
  agg,
  type,
  color,
  sub,
  tipFormat,
}) {
  const deltaPct =
    periodDelta(series, agg);

  const up =
    (deltaPct ?? 0) >= 0;

  return (
    <div className="an-kpi">
      <div className="an-kpi__head">
        <span className="an-kpi__label">
          {label}
        </span>

        {deltaPct != null && (
          <span
            className={`an-kpi__delta ${up ? "up" : "down"
              }`}
          >
            {up ? "▲" : "▼"}{" "}
            {Math.abs(deltaPct)}%
          </span>
        )}
      </div>

      <div className="an-kpi__value">
        {value}
        {unit && (
          <span className="an-kpi__unit">
            {" "}
            {unit}
          </span>
        )}
      </div>

      <div className="an-kpi__sub">
        {sub}
      </div>

      <Sparkline
        values={series}
        days={days}
        type={type}
        color={color}
        tipFormat={tipFormat}
      />
    </div>
  );
}

function Sparkline({
  values,
  days,
  type,
  color,
  tipFormat,
}) {
  if (
    !values ||
    values.length === 0
  ) {
    return null;
  }

  const data = values.map(
    (v, i) => ({
      i,
      day: days[i] ?? "",
      value: v,
    }),
  );

  /**
   * How many points actually carry a number.
   *
   * A line with `dot={false}` draws the SEGMENTS between points, so a series
   * with one real value draws nothing at all — the chart renders, the axis
   * renders, and the data is invisible. That is not a hypothetical: the
   * machine summary appends today as its own point, so on a fleet whose
   * nightly rollup has not run there is exactly one, and the card showed an
   * empty plot under a headline with figures in it.
   *
   * Below two points the dot IS the plot.
   */
  const plotted = data.filter(
    (d) =>
      d.value != null &&
      Number.isFinite(d.value),
  ).length;

  const config = {
    value: {
      label: "",
      color,
    },
  };

  const label = (
    _v,
    payload,
  ) => {
    const day =
      payload?.[0]?.payload?.day;

    return day ? fmtDay(day) : "";
  };

  const value = (v) =>
    tipFormat
      ? tipFormat(v)
      : fmt(v);

  return (
    <ChartContainer
      config={config}
      className="an-kpi__spark mt-1.5"
    >
      {type === "bar" ? (
        <BarChart
          data={data}
          margin={SPARK_MARGIN}
          barCategoryGap={1}
        >
          <Tooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel={false}
                labelFormatter={label}
                formatter={value}
              />
            }
          />

          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[
              2,
              2,
              0,
              0,
            ]}
            isAnimationActive={
              false
            }
          />
        </BarChart>
      ) : (
        <LineChart
          data={data}
          margin={SPARK_MARGIN}
        >
          <Tooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel={false}
                labelFormatter={label}
                formatter={value}
              />
            }
          />

          <Line
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={
              plotted < 2
                ? { r: 2.5 }
                : false
            }
            activeDot={{ r: 3 }}
            // A gap is a day that was not measured, not a day of zero. Joining
            // across it would draw a straight line through days nobody
            // recorded and invite reading it as flat activity.
            connectNulls={false}
            isAnimationActive={
              false
            }
          />
        </LineChart>
      )}
    </ChartContainer>
  );
}

const SPARK_MARGIN = {
  top: 4,
  right: 2,
  bottom: 2,
  left: 2,
};

function fmtDay(day) {
  return new Date(
    `${day}T00:00:00Z`,
  ).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    },
  );
}

function Card({
  title,
  hint,
  children,
  wide,
  tour,
}) {
  return (
    <div
      data-tour={tour}
      className={`an-card${wide
        ? " an-card--wide"
        : ""
        }`}
    >
      <div className="an-card__head">
        <span className="an-card__title">
          {title}
        </span>

        {hint && (
          <span className="an-card__hint">
            {hint}
          </span>
        )}
      </div>

      {children}
    </div>
  );
}

const HEAT_HUE =
  "57,135,229";

function heatFill(
  trips,
  max,
  inRange,
) {
  if (!inRange) {
    return "transparent";
  }

  if (trips <= 0) {
    return "var(--elevated)";
  }

  const a =
    0.18 +
    0.82 *
    (trips / max);

  return `rgba(${HEAT_HUE},${a.toFixed(
    3,
  )})`;
}

function DailyHeatmap({
  series,
  value = (d) =>
    d.trips,
  label,
  empty = "No daily activity yet",
}) {
  if (series.length === 0) {
    return (
      <div className="an-card__empty">
        {empty}
      </div>
    );
  }

  const DAY_MS =
    86_400_000;

  const parse = (iso) =>
    new Date(
      `${iso}T00:00:00Z`,
    );

  const byDayMap = new Map(
    series.map((d) => [
      d.day,
      d,
    ]),
  );

  const monOffset = (dt) =>
    (dt.getUTCDay() + 6) %
    7;

  const first = parse(
    series[0].day,
  );

  const last = parse(
    series[series.length - 1]
      .day,
  );

  const max = Math.max(
    1,
    ...series.map(
      (d) => value(d) || 0,
    ),
  );

  const weeks = [];
  let week = [];

  for (
    let t = first.getTime();
    t <= last.getTime();
    t += DAY_MS
  ) {
    const dt = new Date(t);

    const iso = dt
      .toISOString()
      .slice(0, 10);

    const rec =
      byDayMap.get(iso);

    week.push({
      iso,
      dt,
      v: rec
        ? value(rec) ?? 0
        : null,
      rec,
      inRange: true,
    });

    if (
      monOffset(dt) ===
      6
    ) {
      weeks.push(week);
      week = [];
    }
  }

  if (week.length) {
    weeks.push(week);
  }

  const WEEKDAYS = [
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
  ];

  const monthDay = (dt) =>
    dt.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      },
    );

  return (
    <div className="an-heat">
      <div className="an-heat__grid">
        <div className="an-heat__corner" />

        {WEEKDAYS.map(
          (w) => (
            <div
              className="an-heat__wd"
              key={w}
            >
              {w}
            </div>
          ),
        )}

        {weeks.map(
          (
            week,
            wi,
          ) => {
            const prev =
              weeks[wi - 1];

            const newMonth =
              wi === 0 ||
              week[0].dt.getUTCMonth() !==
              prev[0].dt.getUTCMonth();

            return (
              <Fragment
                key={
                  week[0].iso
                }
              >
                <div className="an-heat__rowlbl">
                  {newMonth
                    ? monthDay(
                      week[0]
                        .dt,
                    )
                    : week[0].dt.getUTCDate()}
                </div>

                {week.map(
                  (c, ci) => (
                    <div
                      key={c.iso}
                      className="an-heat__cell"
                      style={{
                        background:
                          heatFill(
                            c.v ??
                            0,
                            max,
                            c.inRange,
                          ),
                        ...(ci ===
                          0
                          ? {
                            gridColumnStart:
                              monOffset(
                                c.dt,
                              ) +
                              2,
                          }
                          : null),
                      }}
                      title={
                        !c.inRange
                          ? undefined
                          : label
                            ? label(
                              c,
                            )
                            : `${fmtDay(
                              c.iso,
                            )} · ${c.v ??
                            0
                            } trip${c.v ===
                              1
                              ? ""
                              : "s"
                            }${c.rec
                              ? ` · ${fmt(
                                c
                                  .rec
                                  .distanceKm,
                              )} km`
                              : ""
                            }`
                      }
                    />
                  ),
                )}
              </Fragment>
            );
          },
        )}
      </div>

      <div className="an-heat__legend">
        <span>
          Less
        </span>

        <span
          className="an-heat__swatch"
          style={{
            background:
              "var(--elevated)",
          }}
        />

        <span
          className="an-heat__swatch"
          style={{
            background: `rgba(${HEAT_HUE},0.34)`,
          }}
        />

        <span
          className="an-heat__swatch"
          style={{
            background: `rgba(${HEAT_HUE},0.6)`,
          }}
        />

        <span
          className="an-heat__swatch"
          style={{
            background: `rgba(${HEAT_HUE},0.82)`,
          }}
        />

        <span
          className="an-heat__swatch"
          style={{
            background: `rgba(${HEAT_HUE},1)`,
          }}
        />

        <span>
          More
        </span>
      </div>
    </div>
  );
}

/**
 * The key under a fuel chart, and the switch for each series in it.
 *
 * Seven series on one plot is what the single-unit question needs — a burn,
 * its two denominators, two rates, a theft and a trend — and it is also more
 * than anyone reads at once. A reader chasing litres per kilometre does not
 * want the trailing mean crossing it, and a reader checking a drain wants the
 * three litre series alone. So the key is the control: click a name and that
 * series leaves the plot, and the axis it was setting rescales to what is
 * still drawn.
 *
 * ## The swatch is the mark
 *
 * A row of identical squares says which colour a series is and nothing else.
 * These say what to LOOK for: a square for a bar, a drawn rule for a line, a
 * dashed rule for the two rates — the same dash the plot draws them with. On a
 * chart carrying three bars and four lines, that is the difference between
 * hunting for a colour and knowing the shape you are hunting for.
 *
 * ## A series with nothing in it cannot be switched
 *
 * A unit that works standing still has no distance in the window, so its
 * kilometres and its litres per kilometre are null on every day. The key for
 * those used to look exactly like the others and did nothing when clicked.
 * They are now disabled and say why, which is also the honest answer to "where
 * is the rate line" — there is no reading, not a hidden series.
 *
 * Built from the chart's own `config` rather than from Recharts' legend
 * payload, because a hidden series drops out of that payload — the switch that
 * turned a series off would vanish with it, and nothing would turn it back on.
 *
 * Real buttons: keyboard-reachable, `aria-pressed` carries the on/off state,
 * and nothing in the row changes width when it is toggled, so the next click
 * lands where the reader is already aiming.
 */
function ChartKeys({
  config,
  hidden,
  onToggle,
  dead,
}) {
  return (
    <div
      className="an-chartkeys"
      role="group"
      aria-label="Show or hide series"
    >
      {Object.entries(config).map(
        ([key, item]) => {
          const off = hidden.has(key);
          const none = Boolean(
            dead?.has(key),
          );

          return (
            <button
              key={key}
              type="button"
              className={
                "an-chartkey" +
                (off
                  ? " an-chartkey--off"
                  : "")
              }
              aria-pressed={
                none ? undefined : !off
              }
              disabled={none}
              title={
                none
                  ? `${item.label} — no reading in this window`
                  : `${
                    off ? "Show" : "Hide"
                  } ${item.label}`
              }
              onClick={() =>
                onToggle(key)
              }
            >
              <span
                className={
                  "an-chartkey__mark an-chartkey__mark--" +
                  (item.mark ?? "bar")
                }
                style={{
                  "--mark":
                    item.color,
                }}
              />

              {item.label}
            </button>
          );
        },
      )}
    </div>
  );
}

/**
 * The series a chart has no reading for anywhere in the window.
 *
 * Not the same as a gappy series: `km` on a haulage unit is null on the days
 * the tank balance did not close and real on the days it did, and that series
 * is drawn. This is the one that is null on every day of the window — nothing
 * to draw and nothing to switch.
 */
function deadSeries(rows, keys) {
  const out = new Set();

  for (const key of keys) {
    const any = rows.some(
      (r) => r[key] != null,
    );

    if (!any) out.add(key);
  }

  return out;
}

/**
 * Which series a reader has switched off.
 *
 * Deliberately not persisted and not lifted: it is a way of looking at the
 * chart in front of you, not a setting. Picking a different unit rebuilds the
 * card and the chart opens the same way again, which is the right default for
 * a plate whose shape you have not seen yet.
 *
 * Two series open switched OFF. The trailing mean is a reading of the bars
 * rather than a measurement beside them, and engine hours are the denominator
 * of a rate that is already drawn — both are worth having on demand and
 * neither is worth spending a line of a phone-width plot on before anyone has
 * asked. Everything measured stays on.
 */
function useHiddenSeries(
  initiallyOff = [],
) {
  /* The argument is read once, on mount: it is the chart's opening position,
     not a prop the caller keeps control of. A reader who switches a series
     back on has said what they want, and a re-render must not take it away
     again. */
  const [hidden, setHidden] = useState(
    () => new Set(initiallyOff),
  );

  const toggle = useCallback((key) => {
    setHidden((prev) => {
      const next = new Set(prev);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, []);

  return [hidden, toggle];
}

/**
 * The caption on an axis: what its numbers are counted in.
 *
 * Unit symbols in mono micro-caps, not words in the body face. Three reasons,
 * in order of how much they cost to get wrong:
 *
 *   · WIDTH. The unit chart carries four axes, and on a phone the plot between
 *     them is about 200px. "Litres" over a column of 0–60 spends forty of
 *     those pixels saying what "L" says.
 *   · WHERE THE COLOUR GOES. The ticks are tinted to their axis — that is the
 *     wayfinding, and it is load-bearing with four scales in play. A caption
 *     tinted the same way repeats it and competes with it, so the caption is
 *     neutral and the numbers keep the colour.
 *   · VOICE. Mono is the instrument face here: it is what the tank readings
 *     and the sensor table are set in, and a unit is an instrument's label.
 *
 * Above the axis rather than rotated beside it — four rotated captions would
 * each cost a column of that same 200px.
 */
/* The rotated caption's lane inside the axis band, and how far its centre is
   walked in from the band's outer edge. Measured against the rendered boxes:
   the ticks hug the axis line, so the lane is the outer edge — at offset 10 the
   caption sat on "0.00", and at 0 half a rotated glyph renders outside the SVG
   and is clipped. */
const CAP_LANE = 14;
const CAP_OFFSET = 6;

/* ── The same chart on a phone ────────────────────────────────────────────
 *
 * Measured on the unit chart at 375px, before this: the card is 310px wide,
 * the four axis bands take 153 of it, and the plot is left 157px for fifteen
 * days of three bars — 2px per bar. Half the card was numbers and the other
 * half was hairlines. Two of those four bands were scaling a series with no
 * reading anywhere in the window, so they were spending 90px to print a
 * column of numbers no mark on the chart belonged to.
 *
 * What follows is the phone's share of that width taken back and spent on
 * marks. Nothing here fires above 640px: the desktop chart has the room to
 * carry all four bands and is left exactly as it was.
 */
const PHONE = "(max-width: 640px)";

/** The rotated caption's lane on a phone — see CAP_LANE. Three pixels narrower
 *  against an 8px cap rather than 8.5px. Four bands, so it is twelve. */
const CAP_LANE_SM = 11;
const CAP_OFFSET_SM = 3;

/** Fewer gridlines on a phone: six horizontal rules across a 150px plot stripe
 *  the marks they are meant to measure. */
const PHONE_SCALE = { targetTicks: 4, maxTicks: 5 };

/**
 * Thousands, short, for an axis band on a phone.
 *
 * "20,000" is six mono characters — 34px of a 310px card, on every one of six
 * ticks. "20k" is three. The rounding is deliberate and only applies where it
 * cannot mislead: above 10,000 a litre is under a tenth of one percent of the
 * tick, and a reader taking an exact number off a gridline rather than the
 * tooltip is not a reader this saves anything from.
 */
const compactTick = (v) => {
  const a = Math.abs(v);

  if (a >= 10000) return `${Math.round(v / 1000)}k`;

  if (a >= 1000) {
    return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  return v.toLocaleString();
};

const axisCap = (
  value,
  side = "left",
  phone = false,
  tint = null,
) => ({
  value,
  // Rotated and centred ALONG the axis, the way the fuel-rate chart's own
  // caption sits — see body/FuelRateChart. `insideLeft`/`insideRight` put the
  // label's centre on the band's outer edge and the offset walks it inward, so
  // the glyph lands inside the SVG instead of half-clipped by it; `textAnchor:
  // middle` is what centres it against the axis rather than hanging it from
  // the top.
  angle: -90,
  position: side === "right" ? "insideRight" : "insideLeft",
  // The offset walks the label's centre INWARD from the band's outer edge.
  // Too little and a rotated glyph is half-clipped by the SVG; too much and it
  // lands on the ticks, which share the band. Ticks hug the axis line, so the
  // free lane is the band's outer edge and the offset is small on purpose —
  // per-axis, because the bands are not the same width.
  /* Measured at 375px: the caption's centre lands about 4px inside the offset,
     so at 6 its right edge reaches 15.5 while a three-character compact tick
     begins at 14.2. On the phone's narrower lane it is walked back out to 3,
     which puts the glyph's outer edge at 1.8 — still inside the SVG, and clear
     of the numbers by two and a half pixels. */
  offset: phone ? CAP_OFFSET_SM : CAP_OFFSET,
  /* Normally the caption is neutral and the TICKS carry the axis colour —
     that is the wayfinding with four scales in play, and tinting both would
     repeat it. A band with no ticks has nothing left to carry it, so on a
     phone the caption takes the tint the numbers would have had. */
  style: {
    textAnchor: "middle",
    ...(tint ? { fill: tint } : null),
  },
  className: "an-axcap",
});

/** The x caption, centred under the axis it names. Measured against the boxes:
 *  at the phone's shorter plot the day ticks end exactly where the caption
 *  starts, so it is walked down into the four pixels of margin still free
 *  below it — the caption names the row of dates and must not sit in it. */
const dayCap = (phone) => ({
  value: "FLEET DAY",
  position: "insideBottom",
  offset: phone ? -5 : -1,
  className: "an-axcap",
});

/** Ticks, in the same mono as the captions so the digits sit in columns. The
 *  axis `stroke` still tints them — see axisCap. */
const TICK = { className: "an-axtick" };

/** The day ticks, which belong to no series and take none of the colours.
 *  Their own class because a `fill` in `.an-axtick` would beat the axis
 *  `stroke` on the y ticks and take the tint off the four scales with it. */
const DAY_TICK = { className: "an-axtick an-axtick--day" };

const FUEL_MA_DAYS = 7;

function movingAverage(
  series,
  days = FUEL_MA_DAYS,
) {
  return series.map(
    (row, i) => {
      const from =
        Math.max(
          0,
          i - days + 1,
        );

      const span =
        i - from + 1;

      let litres = 0;
      let cost = 0;

      for (
        let k = from;
        k <= i;
        k++
      ) {
        litres +=
          series[k]
            .litres ?? 0;

        cost +=
          series[k].cost ??
          0;
      }

      return {
        ...row,
        avg:
          litres / span,
        avgCost:
          cost / span,
        avgDays: span,
      };
    },
  );
}

function FuelChart({
  series,
  currency = "KES",
}) {
  // Before the early return: a hook that only runs on a populated chart is a
  // hook that changes count when the fleet goes quiet.
  const [hidden, toggle] =
    useHiddenSeries(["avg"]);

  // See PHONE: below 640px the band gives width back to the plot.
  const phone = useMediaQuery(PHONE);

  if (series.length === 0) {
    return (
      <div className="an-card__empty">
        No fuel activity yet
      </div>
    );
  }

  const showAvg =
    series.length > 1;

  const data = showAvg
    ? movingAverage(
      series,
    )
    : series;

  const config = {
    litres: {
      mark: "bar",
      label: "Fuel in",
      color:
        "var(--chart-1)",
    },

    // Amber: fuel that left the tank for any other reason. Red is kept for
    // suspected theft, the bar beside it.
    lost: {
      mark: "bar",
      label: "Drained",
      color:
        "var(--chart-4)",
    },

    theft: {
      mark: "bar",
      label: "Suspected theft",
      color:
        "var(--chart-8)",
    },

    ...(showAvg
      ? {
        avg: {
          mark: "trend",
          label: `${FUEL_MA_DAYS}-day average`,
          color:
            "var(--chart-7)",
        },
      }
      : {}),
  };

  const formatValue = (
    value,
    key,
    item,
  ) => {
    const row =
      item?.payload;

    if (key === "avg") {
      const span =
        row?.avgDays ??
        FUEL_MA_DAYS;

      const over =
        span <
          FUEL_MA_DAYS
          ? ` (${span}d so far)`
          : "";

      return `${fmt(
        value,
      )} L · ${currency} ${fmt(
        row?.avgCost ??
        0,
      )}${over}`;
    }

    const cost =
      key === "lost"
        ? row?.lossCost
        : key === "theft"
          ? row?.theftCost
          : row?.cost;

    return `${fmt(
      value,
    )} L · ${currency} ${fmt(
      cost ?? 0,
    )}`;
  };

  /* The axis follows what is DRAWN: switch the drained series off and the
     scale should close up around the fills rather than keeping room for a
     bar nobody asked to see. */
  const peak = Math.max(
    0,
    ...series.map(
      (s) =>
        Math.max(
          hidden.has("litres")
            ? 0
            : s.litres ?? 0,
          hidden.has("lost")
            ? 0
            : s.lost ?? 0,
          hidden.has("theft")
            ? 0
            : s.theft ?? 0,
        ),
    ),
  );

  const axis = niceScale(
    peak,
    phone ? PHONE_SCALE : undefined,
  );

  const tickLabel = (v) =>
    phone
      ? compactTick(v)
      : v.toLocaleString();

  /* Sized for the mono the ticks are now set in: JetBrains Mono advances
     about 5.7px at 9.5px, against the 6px a 10px sans was costing. Measured
     at 320px, the four axes of the unit chart were taking 108px of a 270px
     card and leaving the plot 139 — the metric is worth getting right. */
  const axisWidth =
    (phone
      ? CAP_LANE_SM
      : CAP_LANE) +
    8 +
    Math.max(
      ...axis.ticks.map(
        (t) =>
          tickLabel(t)
            .length,
      ),
    ) *
    5.7;

  return (
    <>
      <ChartContainer
        config={config}
        className="an-fuelchart"
      >
      <ComposedChart
        data={data}
        margin={{
          top: 16,
          // See the unit chart's margin: nothing on the right holds the last
          // day label, and on a phone the plot now reaches far enough for it
          // to hang past the SVG.
          right: phone ? 14 : 4,
          bottom: 14,
          left: 4,
        }}
        barGap={phone ? 1 : 2}
        barCategoryGap={
          phone ? "8%" : "10%"
        }
      >
        <CartesianGrid
          vertical={false}
        />

        <XAxis
          dataKey="day"
          tickFormatter={fmtDay}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickMargin={8}
          tick={DAY_TICK}
          label={dayCap(phone)}
        />

        {/*
          * yAxisId stays explicit on every series even though only one axis is
          * left. Recharts defaults an untagged series to axis id 0; the moment
          * a second axis is added back, an untagged bar silently rescales
          * against whichever axis it lands on and still renders, wrong and
          * without complaint.
          */}
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          width={axisWidth}
          tickMargin={4}
          tick={TICK}
          domain={[
            axis.min,
            axis.max,
          ]}
          ticks={
            axis.ticks
          }
          interval={0}
          tickFormatter={
            tickLabel
          }
          label={axisCap(
            "L",
            "left",
            phone,
          )}
        />

        <Tooltip
          cursor={{
            fill:
              "var(--color-border)",
            opacity: 0.25,
          }}
          content={
            <ChartTooltipContent
              labelFormatter={
                fmtDay
              }
              formatter={
                formatValue
              }
            />
          }
        />

        <Bar
          yAxisId="left"
          dataKey="litres"
          hide={hidden.has("litres")}
          fill="var(--color-litres)"
          radius={[
            4,
            4,
            0,
            0,
          ]}
          maxBarSize={22}
          isAnimationActive={
            false
          }
        />

        <Bar
          yAxisId="left"
          dataKey="lost"
          hide={hidden.has("lost")}
          fill="var(--color-lost)"
          radius={[
            4,
            4,
            0,
            0,
          ]}
          maxBarSize={22}
          isAnimationActive={
            false
          }
        />

        <Bar
          yAxisId="left"
          dataKey="theft"
          hide={hidden.has("theft")}
          fill="var(--color-theft)"
          radius={[
            4,
            4,
            0,
            0,
          ]}
          maxBarSize={22}
          isAnimationActive={
            false
          }
        />

        {showAvg && (
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="avg"
            hide={hidden.has("avg")}
            stroke="var(--color-avg)"
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 3,
            }}
            isAnimationActive={
              false
            }
          />
        )}
      </ComposedChart>
      </ChartContainer>

      {/* The key doubles as the switch — see ChartKeys. */}
      <ChartKeys
        config={config}
        hidden={hidden}
        onToggle={toggle}
        dead={deadSeries(
          data,
          Object.keys(config),
        )}
      />
    </>
  );
}

/**
 * One unit's fuel day, whole: what went in, what it burnt, what it ran for
 * that burn, what the burn cost per kilometre and per engine hour, and what
 * left the tank without doing any of it.
 *
 * ## Why this is a different chart rather than the fleet chart filtered
 *
 * The fleet chart answers what the yard put in and lost, and litres is the only
 * unit on it. Narrowed to one plate the useful question changes — what this
 * lorry burnt for the work it actually did — and a rate needs denominators the
 * fleet chart has never carried. Both of them are on it: kilometres for a unit
 * that travels to work, engine hours for one that does not, and the pair of
 * them together is what separates a thirsty day from a long one.
 *
 * ## Four scales, and why they are four axes rather than one
 *
 * Measured on the box 2026-09-14 over 30 days, per unit per day: litres in run
 * to about 350, kilometres to about 570, engine hours to about 14, and litres
 * per kilometre sit between 0.17 and 1.4. Put the rate on the litres axis and
 * it IS the axis line. Each axis is therefore tinted to its own series, because
 * four scales on one plot are only readable if a reader can tell at a glance
 * which one a mark belongs to.
 *
 * Litres per hour shares the hours axis. It is the one pairing that is not a
 * single unit — but both sit in the same 0-to-30 band, both are per-hour
 * quantities, and the alternative was a fifth axis narrower than its own
 * labels. The legend names both, so nothing is inferred from the axis alone.
 *
 * ## The series is gappy on purpose
 *
 * `used`, `km`, `hours` and the two rates exist only for a day whose tank
 * balance closed — 11 to 13 days in 30 for a single unit. Those days are NULL,
 * never 0, and `connectNulls` stays off so the lines break. A zero would draw a
 * unit that ran nowhere, which is a claim about the day rather than the absence
 * of one.
 *
 * Fuel in and fuel drained come from the ledger instead of the probe balance,
 * so they are present on days the rest is missing. That asymmetry is real, and
 * the chart shows it rather than trimming both halves down to the days they
 * share.
 *
 * ## The trend line is the fleet chart's, unchanged
 *
 * Fills are lumpy — 300 L on Tuesday and nothing until Friday — so one unit's
 * bars are spikier than the whole yard's and the level underneath them is
 * harder to see, not easier. The same trailing mean the fleet chart draws is
 * therefore drawn here over the same series, so the two views smooth the same
 * way and a reader moving between them is reading one line, not two.
 */
function UnitFuelChart({
  fuelDays,
  unitFuel,
  loading,
}) {
  // Before the early return: a hook that only runs on a populated chart is a
  // hook that changes count when a unit has no fuel history.
  const [hidden, toggle] =
    useHiddenSeries([
      "hours",
      "avg",
    ]);

  // See PHONE: below 640px this chart gives its width back to the plot.
  const phone = useMediaQuery(PHONE);

  /* The ledger is the spine, and the join lives in lib/unitFuelSeries —
   * extracted because it is the one part that fails silently. `measured` is
   * how many days actually picked up a distance, which the caveat prints. */
  const { rows } = joinUnitFuelDays(
    fuelDays,
    unitFuel,
  );

  if (rows.length === 0) {
    return (
      <div className="an-card__empty">
        {loading
          ? "Loading this unit's fuel days…"
          : "No fuel activity yet"}
      </div>
    );
  }

  // One day is a reading, not a trend; the mean over it is the bar again.
  const showAvg = rows.length > 1;

  const data = showAvg
    ? movingAverage(rows)
    : rows;

  /* Every axis follows what is DRAWN. Switch the trend off and the litres
     scale closes up around the bars; switch the hours off and what is left of
     that axis belongs to litres per hour alone. An axis still sized for a
     series a reader has just removed is the chart disagreeing with them. */
  const peakOf = (...keys) =>
    Math.max(
      0,
      ...data.map(
        (d) =>
          Math.max(
            ...keys.map(
              (k) =>
                hidden.has(k)
                  ? 0
                  : d[k] ?? 0,
            ),
          ),
      ),
    );

  /* An axis is furniture unless a mark on the plot is standing on it.
   *
   * Two of the four here regularly are not: a unit that works standing still
   * has no distance in the window, so KM and L/KM are null on every day of it,
   * and a reader who has switched engine hours off has told us the same thing
   * about that scale. Each empty band was still costing about 45px of a 310px
   * card to print a column of numbers belonging to nothing — on the plate this
   * was measured against, 90px of the 153 the bands took.
   *
   * Dropping the band drops the series bound to it as well. They draw nothing
   * either way (that is what made the band empty), but Recharts resolves a
   * series against its `yAxisId` whether or not it has anything to plot, and a
   * series pointing at an axis that is no longer mounted falls back to the
   * default axis and rescales against it, silently.
   *
   * Phone only. Above 640px the chart has room for all four and keeping an
   * empty scale on screen is the honest answer to "where is the rate line" —
   * there is the axis, and there is nothing on it. */
  const standingOn = (...keys) =>
    keys.some(
      (k) =>
        !hidden.has(k) &&
        data.some(
          (d) => d[k] != null,
        ),
    );

  const showLitres =
    !phone ||
    standingOn(
      "litres",
      "used",
      "lost",
      "theft",
      "avg",
    );

  const showKm =
    !phone || standingOn("km");

  const showHours =
    !phone ||
    standingOn(
      "hours",
      "perHour",
    );

  const showRate =
    !phone ||
    standingOn("perKm");

  const scaleOpts = phone
    ? PHONE_SCALE
    : undefined;

  /* Which scale keeps its numbers on a phone.
   *
   * Four columns of ticks were the clutter: two walls of digits down the sides
   * of a 310px card, and between them the marks they measure squeezed into
   * 157px. The bands themselves are not the problem — the reader needs to know
   * a line has its own scale, and which one — so on a phone the other three
   * keep their tinted caption and lose their numbers. A band goes from about
   * 45px to 14, the plot roughly doubles, and no series loses its label.
   *
   * Litres keeps the numbers because the bars are the card's subject and a bar
   * without a number on its axis is a shape with no size. If every litre
   * series is switched off, the numbers go to whichever scale still has
   * something standing on it. Exact values for everything else are one tap
   * away in the tooltip, where they were always more precise than a gridline.
   */
  const numbered = !phone
    ? null
    : standingOn(
      "litres",
      "used",
      "lost",
      "theft",
      "avg",
    )
      ? "litres"
      : standingOn("perKm")
        ? "rate"
        : standingOn("km")
          ? "km"
          : standingOn(
            "hours",
            "perHour",
          )
            ? "hours"
            : null;

  const litresAxis = niceScale(
    peakOf(
      "litres",
      "lost",
      "theft",
      "used",
      "avg",
    ),
    scaleOpts,
  );

  const kmAxis = niceScale(
    peakOf("km"),
    scaleOpts,
  );

  /* Hours and litres per hour share this one — see the header. */
  const hoursAxis = niceScale(
    peakOf("hours", "perHour"),
    scaleOpts,
  );

  const rateAxis = niceScale(
    peakOf("perKm"),
    scaleOpts,
  );

  const litresTick = (v) =>
    phone
      ? compactTick(v)
      : v.toLocaleString();

  const kmTick = (v) =>
    phone
      ? compactTick(v)
      : v.toLocaleString();

  const hoursTick = (v) =>
    v.toFixed(hoursAxis.max < 6 ? 1 : 0);

  /* Two decimals below 2 L/km, where every ordinary haulage day sits: at one
   * decimal a 0.44 and a 0.48 print the same tick twice. */
  const rateTick = (v) =>
    v.toFixed(rateAxis.max < 2 ? 2 : 1);

  /* See the fleet chart's axisWidth for the mono metric, plus a lane for the
     rotated caption: it is laid out INSIDE the axis band, so a band sized for
     the numbers alone prints the two on top of each other. Rotating is what
     lets a four-axis chart caption every scale — an upright caption has to be
     as wide as its own text, and "H·L/H" over a 14px gutter ran straight into
     the one beside it. */
  /**
   * A reading with nothing either side of it, drawn.
   *
   * `used`, `km`, `hours` and the two rates exist only on a day whose tank
   * balance closed, and those days do not have to be consecutive — on the unit
   * this was measured against, not one of the five was. A line through points
   * that never neighbour each other has no segment to draw, so with `dot` off
   * it drew nothing at all: three tinted axes down the side of the card,
   * scaling three lines that were not on it.
   *
   * So an isolated reading gets a dot. Only an isolated one — a point inside a
   * run is already carried by the segments through it, and dotting the whole
   * series would put a bead on every day of a month.
   */
  const loneDot = (key) =>
    function LoneDot(props) {
      const { cx, cy, index, stroke } =
        props;

      if (cx == null || cy == null) {
        return null;
      }

      const alone =
        data[index - 1]?.[key] ==
          null &&
        data[index + 1]?.[key] ==
          null;

      if (!alone) return null;

      return (
        <circle
          key={`${key}-${index}`}
          cx={cx}
          cy={cy}
          r={2.4}
          fill={stroke}
        />
      );
    };

  /** The tint a caption carries when its own numbers are gone — see axisCap. */
  const capTint = (id, colour) =>
    phone && numbered !== id
      ? colour
      : null;

  /** An axis band: its numbers and the width they need, or — on a phone, for
   *  the scales that are not `numbered` — the caption alone. */
  const band = (id, ticks, fmtTick) =>
    phone && numbered !== id
      ? {
        tick: false,
        width: CAP_LANE_SM + 3,
      }
      : {
        tick: TICK,
        width: widthOf(
          ticks,
          fmtTick,
        ),
      };

  const widthOf = (ticks, fmtTick) =>
    (phone
      ? CAP_LANE_SM
      : CAP_LANE) +
    8 +
    Math.max(
      ...ticks.map(
        (t) => fmtTick(t).length,
      ),
    ) *
    5.7;

  const config = {
    litres: {
      mark: "bar",
      label: "Fuel in",
      color: "var(--chart-1)",
    },

    used: {
      mark: "bar",
      label: "Fuel used",
      color: "var(--chart-2)",
    },

    lost: {
      mark: "bar",
      label: "Fuel drained",
      color: "var(--chart-4)",
    },

    theft: {
      mark: "bar",
      label: "Suspected theft",
      color: "var(--chart-8)",
    },

    km: {
      mark: "line",
      label: "Km run",
      color: "var(--chart-7)",
    },

    hours: {
      mark: "line",
      label: "Engine hours",
      color: "var(--chart-3)",
    },

    perKm: {
      mark: "dash",
      label: "Fuel per km",
      color: "var(--chart-4)",
    },

    perHour: {
      mark: "dash",
      label: "Fuel per hour",
      color: "var(--chart-5)",
    },

    ...(showAvg
      ? {
        avg: {
          mark: "trend",
          label: `${FUEL_MA_DAYS}-day average`,
          color: "var(--chart-6)",
        },
      }
      : {}),
  };

  const formatValue = (
    value,
    key,
    item,
  ) => {
    const row = item?.payload;

    // Drawn with connectNulls off and gappy by design — the formatter is
    // handed the null directly rather than a zero.
    if (value == null) {
      return "— no reading";
    }

    if (key === "km") {
      return `${fmt(value)} km`;
    }

    if (key === "hours") {
      return `${fmt(value, 1)} h`;
    }

    if (key === "perKm") {
      return `${fmt(value, 2)} L/km`;
    }

    if (key === "perHour") {
      return `${fmt(value, 1)} L/h`;
    }

    if (key === "avg") {
      const span =
        row?.avgDays ?? FUEL_MA_DAYS;

      return `${fmt(value)} L${
        span < FUEL_MA_DAYS
          ? ` (${span}d so far)`
          : ""
      }`;
    }

    if (key === "used") {
      /* The measured burn, which is what both rates divide. Naming its
       * denominators beside it is the difference between "it drank 263 L"
       * and "it drank 263 L doing 514 km in 13.4 hours". */
      return `${fmt(value)} L burnt${
        row?.km != null
          ? ` · ${fmt(row.km)} km`
          : ""
      }${
        row?.hours != null
          ? ` · ${fmt(row.hours, 1)} h`
          : ""
      }`;
    }

    const cost =
      key === "lost"
        ? row?.lossCost
        : key === "theft"
          ? row?.theftCost
          : row?.cost;

    return `${fmt(value)} L${
      cost != null
        ? ` · ${fmt(cost)}`
        : ""
    }`;
  };

  return (
    <>
      <ChartContainer
        config={config}
        className="an-fuelchart"
      >
        <ComposedChart
          data={data}
          margin={{
            top: 16,
            /* The last day label is centred on the final category and hangs
               half its width past the plot. A right-hand band absorbs that;
               with both of them dropped on a phone it was clipped by the SVG,
               so the margin stands in for the band. */
            right:
              phone &&
              !showKm &&
              !showHours
                ? 14
                : 4,
            bottom: 14,
            left: 4,
          }}
          barGap={phone ? 0 : 1}
          barCategoryGap={
            phone ? "8%" : "10%"
          }
        >
          <CartesianGrid
            vertical={false}
          />

          <XAxis
            dataKey="day"
            tickFormatter={fmtDay}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={8}
            tick={DAY_TICK}
            label={dayCap(phone)}
          />

          {/*
            * Four axes, each tinted to the series it scales. yAxisId is
            * explicit on every series below — Recharts defaults an untagged
            * one to axis id 0, and with four axes present a mistagged bar
            * still renders, wrong and without complaint.
            */}
          {showRate && (
            <YAxis
              yAxisId="rate"
              orientation="left"
              tickLine={false}
              axisLine={false}
              {...band(
                "rate",
                rateAxis.ticks,
                rateTick,
              )}
              tickMargin={4}
              domain={[
                rateAxis.min,
                rateAxis.max,
              ]}
              ticks={rateAxis.ticks}
              interval={0}
              tickFormatter={rateTick}
              stroke="var(--chart-4)"
              label={axisCap(
                "L/KM",
                "left",
                phone,
                capTint(
                  "rate",
                  "var(--chart-4)",
                ),
              )}
            />
          )}

          {showLitres && (
            <YAxis
              yAxisId="litres"
              orientation="left"
              tickLine={false}
              axisLine={false}
              {...band(
                "litres",
                litresAxis.ticks,
                litresTick,
              )}
              tickMargin={4}
              domain={[
                litresAxis.min,
                litresAxis.max,
              ]}
              ticks={litresAxis.ticks}
              interval={0}
              tickFormatter={litresTick}
              stroke="var(--chart-1)"
              label={axisCap(
                "L",
                "left",
                phone,
                capTint(
                  "litres",
                  "var(--chart-1)",
                ),
              )}
            />
          )}

          {showKm && (
            <YAxis
              yAxisId="km"
              orientation="right"
              tickLine={false}
              axisLine={false}
              {...band(
                "km",
                kmAxis.ticks,
                kmTick,
              )}
              tickMargin={4}
              domain={[
                kmAxis.min,
                kmAxis.max,
              ]}
              ticks={kmAxis.ticks}
              interval={0}
              tickFormatter={kmTick}
              stroke="var(--chart-7)"
              label={axisCap(
                "KM",
                "right",
                phone,
                capTint(
                  "km",
                  "var(--chart-7)",
                ),
              )}
            />
          )}

          {showHours && (
            <YAxis
              yAxisId="hours"
              orientation="right"
              tickLine={false}
              axisLine={false}
              {...band(
                "hours",
                hoursAxis.ticks,
                hoursTick,
              )}
              tickMargin={4}
              domain={[
                hoursAxis.min,
                hoursAxis.max,
              ]}
              ticks={hoursAxis.ticks}
              interval={0}
              tickFormatter={hoursTick}
              stroke="var(--chart-3)"
              label={axisCap(
                "H·L/H",
                "right",
                phone,
                capTint(
                  "hours",
                  "var(--chart-3)",
                ),
              )}
            />
          )}

          <Tooltip
            cursor={{
              fill: "var(--color-border)",
              opacity: 0.25,
            }}
            content={
              <ChartTooltipContent
                labelFormatter={fmtDay}
                formatter={formatValue}
              />
            }
          />

          {/* Litres, and only litres, are bars: they are the quantity an
              operator counts, and three of them on one axis compare by eye.
              Everything else is a rate or a denominator and is drawn as a
              line, so nothing that cannot be added up looks like it can. */}
{showLitres && (
            <Bar
              yAxisId="litres"
              dataKey="litres"
              hide={hidden.has("litres")}
              fill="var(--color-litres)"
              radius={[4, 4, 0, 0]}
              maxBarSize={
                phone ? 18 : 12
              }
              isAnimationActive={false}
            />
          )}

{showLitres && (
            <Bar
              yAxisId="litres"
              dataKey="used"
              hide={hidden.has("used")}
              fill="var(--color-used)"
              radius={[4, 4, 0, 0]}
              maxBarSize={
                phone ? 18 : 12
              }
              isAnimationActive={false}
            />
          )}

{showLitres && (
            <Bar
              yAxisId="litres"
              dataKey="lost"
              hide={hidden.has("lost")}
              fill="var(--color-lost)"
              radius={[4, 4, 0, 0]}
              maxBarSize={
                phone ? 18 : 12
              }
              isAnimationActive={false}
            />
          )}

{showLitres && (
            <Bar
              yAxisId="litres"
              dataKey="theft"
              hide={hidden.has("theft")}
              fill="var(--color-theft)"
              radius={[4, 4, 0, 0]}
              maxBarSize={
                phone ? 18 : 12
              }
              isAnimationActive={false}
            />
          )}

          {showAvg && showLitres && (
            <Line
              yAxisId="litres"
              type="monotone"
              dataKey="avg"
              hide={hidden.has("avg")}
              stroke="var(--color-avg)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          )}

{showKm && (
            <Line
              yAxisId="km"
              type="monotone"
              dataKey="km"
              hide={hidden.has("km")}
              stroke="var(--color-km)"
              strokeWidth={2}
              dot={loneDot("km")}
              activeDot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

{showHours && (
            <Line
              yAxisId="hours"
              type="monotone"
              dataKey="hours"
              hide={hidden.has("hours")}
              stroke="var(--color-hours)"
              strokeWidth={1.75}
              dot={loneDot("hours")}
              activeDot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

          {/* The two rates are dashed, because a rate is not a reading — it
              is the quotient of two of the marks above it. */}
{showRate && (
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="perKm"
              hide={hidden.has("perKm")}
              stroke="var(--color-perKm)"
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={loneDot("perKm")}
              activeDot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

{showHours && (
            <Line
              yAxisId="hours"
              type="monotone"
              dataKey="perHour"
              hide={hidden.has("perHour")}
              stroke="var(--color-perHour)"
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={loneDot("perHour")}
              activeDot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>

      {/* The key doubles as the switch — see ChartKeys. Seven series is what
          the question needs and more than anyone reads at once. */}
      <ChartKeys
        config={config}
        hidden={hidden}
        onToggle={toggle}
        dead={deadSeries(
          data,
          Object.keys(config),
        )}
      />

    </>
  );
}

function Highlight({
  label,
  value,
  sub,
}) {
  return (
    <div className="an-hl">
      <div className="an-hl__label">
        {label}
      </div>

      <div className="an-hl__value">
        {value}
      </div>

      {sub && (
        <div className="an-hl__sub">
          {sub}
        </div>
      )}
    </div>
  );
}

function OpsLedger({
  items,
}) {
  return (
    <div className="an-today__lead">
      {items.map(
        (it) => (
          <div
            key={it.k}
            className="an-lead"
          >
            <div className="an-lead__v">
              {it.v}

              {it.unit && (
                <span className="an-lead__u">
                  {it.unit}
                </span>
              )}
            </div>

            <div className="an-lead__k">
              {it.k}
            </div>
          </div>
        ),
      )}
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
  tour,
}) {
  if (chartOnly) {
    return (
      <div
        data-tour={tour}
        className={
          "an-ops an-ops--chart" +
          (className
            ? ` ${className}`
            : "")
        }
        style={{
          "--ops-accent":
            accent,
        }}
        ref={containerRef}
      >
        {title && (
          <div className="an-card__head an-ops__charthead">
            <span className="an-ops__charttitle">
              {title}
            </span>
          </div>
        )}

        {children}
      </div>
    );
  }

  return (
    <div
      data-tour={tour}
      className={
        "an-ops" +
        (className
          ? ` ${className}`
          : "")
      }
      style={{
        "--ops-accent":
          accent,
      }}
      ref={containerRef}
    >
      <div className="an-ops__label">
        {label}
      </div>

      <div className="an-ops__value">
        {value}

        {unit && (
          <span className="an-ops__unit">
            {" "}
            {unit}
          </span>
        )}

        {sub && (
          <span className="an-ops__sub">
            {" "}
            {sub}
          </span>
        )}
      </div>

      <div className="an-ops__lines">
        {children}
      </div>
    </div>
  );
}

function OpsLine({
  k,
  v,
  em,
  title,
}) {
  return (
    <div
      className={`an-ops__line${em
        ? " an-ops__line--em"
        : ""
        }`}
      title={title}
    >
      <span className="an-ops__k">
        {k}
      </span>

      <span className="an-ops__v">
        {v}
      </span>
    </div>
  );
}

function typeLabel(t) {
  const s = String(t)
    .replace(
      /_/g,
      " ",
    )
    .toLowerCase();

  return (
    s.charAt(0).toUpperCase() +
    s.slice(1)
  );
}

/**
 * The early-morning sign-outs, as three nested slices of the day's dispatches.
 *
 * ## Three bars that could only ever grow
 *
 * This was three rows — Before 04:00, Before 05:00, Before 06:00 — each a bar
 * against the same denominator, all in one flat colour. The figures are
 * CUMULATIVE, which the server says in as many words ("they must not be added
 * up"), and drawing them as three sibling bars is the one presentation that
 * invites precisely that. Worse, the second bar being longer than the first
 * carries no information at all: it contains the first. A reader learned
 * nothing from the comparison the chart was built to make.
 *
 * Measured over Sukari's last fortnight, the three land at roughly 3%, 16% and
 * 28% of the day's tractors, so all three also sat inside the left third of
 * their tracks — three short stubs of the same colour, one above the other.
 *
 * ## One bar, and the bands are what moved
 *
 * One track, which is the day: every tractor signed out. The early portion
 * fills its left end in three steps of the dawn ramp, deepest first, and what
 * each step's WIDTH shows is that hour's own arrivals rather than the running
 * total — 5 out before 04:00, then 24 more by 05:00, then 22 more by 06:00.
 * Those three are disjoint and they sum to the figure in the head, so the
 * addition the old card invited is now the one the drawing supports.
 *
 * The remaining track is the rest of the day's tractors, and it is the whole
 * point of showing a denominator: 51 early means one thing out of 60 and
 * another out of 200.
 *
 * The ramp is the one the Machines-working-early chart uses, and deliberately:
 * same three hours, same meaning, same order, deepest = earliest. Two cards on
 * one page asking when machines went out should not each invent a palette.
 *
 * ## Contrast
 *
 * On the light tile the last two steps are 1.38:1 apart from each other, which
 * is as far as a single hue stretches while every step still clears 3:1 on the
 * card this ramp was validated against — so the boundaries between segments
 * are DRAWN, a hairline in the tile's own colour, not left to the fills to
 * imply. The track gets an outline for the same reason: at `--border` against
 * `--elevated` it measured 1.14:1, an invisible 100% behind every proportion
 * on this row of tiles.
 */
function EarlyBands({ out, before04, before05, before06 }) {
  /* Exclusive counts, from the cumulative ones. Floored at zero rather than
     trusted: these arrive from three separate counts over one table and a
     partial payload must not produce a negative width. */
  const bands = [
    { key: "b04", label: "Before 04:00", tone: "var(--dawn-3)", n: Math.max(0, before04) },
    { key: "b05", label: "04:00 – 05:00", tone: "var(--dawn-2)", n: Math.max(0, before05 - before04) },
    { key: "b06", label: "05:00 – 06:00", tone: "var(--dawn-1)", n: Math.max(0, before06 - before05) },
  ];

  /* A day with no tractor out is a real day — Sukari had one on 12 September,
     with seven trucks out and no cane. Three empty tracks under a zero would
     be arithmetic on nothing; the sentence is the honest form, and it says
     "signed out", because that is the clock this figure is on. */
  if (out <= 0) {
    return (
      <div className="an-ops__none">
        No tractor signed out today.
      </div>
    );
  }

  const pct = (n) => (n / out) * 100;
  const after = Math.max(0, out - before06);

  return (
    <div className="an-ops__bands">
      <div
        className="an-ops__stack"
        role="img"
        aria-label={
          `${before06} of ${out} tractors signed out before 06:00: ` +
          bands.map((b) => `${b.label}, ${b.n}`).join("; ")
        }
      >
        {bands.map((b) => (
          /* A zero band draws NOTHING. The single-bar rows on these tiles give
             a zero 2px so it reads as measured rather than missing, which is
             right for a row that carries its own label and figure; inside a
             stack it would be a sliver of colour standing for no tractor, next
             to slivers that stand for one. The key below says zero in words. */
          b.n > 0 ? (
            <span
              key={b.key}
              className="an-ops__seg"
              style={{ width: `${pct(b.n)}%`, background: b.tone }}
            />
          ) : null
        ))}
      </div>

      <div className="an-ops__bandkey">
        {bands.map((b) => (
          <span key={b.key} className="an-ops__band">
            <i className="an-ops__sw" style={{ background: b.tone }} aria-hidden="true" />
            <span className="an-ops__bandk">{b.label}</span>
            <span className="an-ops__bandv">{fmt(b.n)}</span>
          </span>
        ))}
      </div>

      {/* What the empty track is. Without it the remainder reads as a target
          not met rather than as the tractors that went out after six, which is
          most of them on a normal day and is not a fault. */}
      <div className="an-ops__rest">
        {fmt(after)} of {fmt(out)} out at 06:00 or later
      </div>
    </div>
  );
}

function OpsBar({
  k,
  n,
  of,
  color,
}) {
  const pct =
    of > 0
      ? Math.min(
        100,
        (n / of) * 100,
      )
      : 0;

  return (
    <div
      className="an-ops__barrow"
      title={`${fmt(n)} of ${fmt(
        of,
      )}`}
    >
      <span className="an-ops__k">
        {k}
      </span>

      <span className="an-ops__track">
        <span
          className="an-ops__fill"
          style={{
            width: `${pct}%`,
            background: color,
          }}
        />
      </span>

      <span className="an-ops__v">
        {fmt(n)}
      </span>
    </div>
  );
}

const clockFmt =
  new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: FLEET_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  );

function AvgTile({
  label,
  value,
  unit,
}) {
  return (
    <div className="an-avg">
      <div className="an-avg__label">
        {label}
      </div>

      <div className="an-avg__value">
        {value}

        <span className="an-avg__unit">
          {" "}
          {unit}
        </span>
      </div>
    </div>
  );
}