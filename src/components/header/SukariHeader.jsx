// Main app header: branding, live KPI stat buttons (fleetdash Topbar port),
// theme toggle, maintenance bell. Clicking a KPI expands the FilterStrip
// ticker below the header with the underlying assets.

import { useState, useEffect } from "react";

import CompanySwitcherDropdown from "./CompanySwitcherDropdown";
import SitePlanLinks from "./SitePlanLinks";
import UserMenu from "./UserMenu";
import FilterStrip from "./FilterStrip";
import StatCarousel from "./StatCarousel";
import { statMeta, statValues, StatButton, productKey } from "./StatKpis";

import { useAppSelector, useCompanies } from "../../context/AppContext";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { isInTransit, carriesCargo, equipmentLabel } from "../../lib/vehicleMap";
import { useDashboardSummary } from "../../hooks/useDashboardSummary";
import { useApiData } from "../../hooks/useApiData";
import { getDeliveryAnalytics } from "../../api/analytics";

import "../../index.css";

// FilterStrip chip status from the live vehicle's 4-state scheme.
const CHIP_STATUS = { ok: "ok", speeding: "warn", theft: "crit", parked: "ok" };

export default function SukariHeader() {
  const desktopActiveTab = useAppSelector((a) => a.desktopActiveTab);
  const { activeCompany } = useCompanies();

  const [activeStat, setActiveStat] = useState(null);

  // Server KPI summary, polled every 30 s + SWR-cached.
  const summary = useDashboardSummary(activeCompany?.id);

  // Product catalog — everything the org ferried over the trailing 30 days
  // (real CargoManifest rows). Used for the 30d tonnage on buttons and in the
  // FilterStrip; which products get a BUTTON is decided further down from the
  // live stream (only products on the road right now).
  const { data: deliveryAnalytics } = useApiData(
    () => getDeliveryAnalytics({ companyId: activeCompany?.id, days: 30 }),
    [activeCompany?.id],
    { cacheKey: `ft-header-products:${activeCompany?.id}` }
  );
  // Sukari's catalog is exactly two products — Processed Sugar out to the
  // depots and Raw Sugarcane in from the farms. Older seeded trips carry
  // random cargo descriptions (cement, petroleum, …) that would otherwise
  // each get a KPI button, so anything else is filtered out for Sukari.
  const SUKARI_PRODUCTS = /^(processed sugar|raw sugarcane)$/i;
  const products = (deliveryAnalytics?.products ?? []).filter(
    (p) => activeCompany?.id !== "sukari" || SUKARI_PRODUCTS.test(p.product)
  );

  // Shared live fleet stream — the same list the map renders.
  const { vehicles } = useFleetLiveShared();

  // ── KPI bucketing ─────────────────────────────────────────────────────────
  // ONE classification decides every button, so the topbar always balances:
  //   IN TRANSIT = Σ product buttons + EMPTY.
  // "In transit" is the ACTIVE fleet — every vehicle mid-cycle, whether
  // mid-journey (TO_*) or at an operational stop (loading / offloading /
  // garage). Membership is decided by PHASE, not live speed: a loaded truck
  // that stops mid-haul (breakdown, refuel, traffic) or drops offline keeps
  // its TO_* phase, so it stays in transit and on its product button.
  //   product — mid-journey with cargo aboard (weight > 0)
  //   empty   — a CARRIER mid-journey with nothing aboard, or docked at an
  //             operational stop (load regardless: neither is in productive
  //             transit yet; the sim has no refuel phase — refuels are events,
  //             not stops)
  //   plant   — working machines that never carry a load: dozers, excavators,
  //             backhoes, compactors, wheel loaders, graders. They belong in
  //             IN TRANSIT (they are out working) but NOT in EMPTY, which is
  //             meant to mean idle capacity. See carriesCargo in lib/vehicleMap.
  //   off     — done for the day (AT_PARKING / AT_INDUSTRY / DWELL / SUNDAY /
  //             DONE): appears in no button
  // The identity is now IN TRANSIT = Σ products + EMPTY + PLANT.
  // Live vehicles carry no phase — phases were the simulator's trip state — so
  // they are bucketed on movement alone. No provider gives us cargo weight
  // today, so `weight` is 0 for all of them and every moving vehicle lands in
  // EMPTY: we know it is on the road, we do not know what it is carrying, and
  // EMPTY is the honest bucket for that. IN TRANSIT still counts them, so the
  // two agree; when a weighbridge feed arrives, loaded vehicles move to their
  // product button on their own with no change here.
  const ENROUTE = /^(TO_FARM|TO_INDUSTRY|TO_DEPOT|TO_PARKING|TO_GARAGE|FROM_GARAGE)$/;
  const OPERATIONAL_STOP = /^(LOADING|UNLOADING|OFFLOADING|AT_GARAGE)$/;
  const bucketOf = (v) => {
    // An OFFLINE unit is in no bucket, whatever its last frame said. This used
    // to key off `v.onRoad` alone, which is speed+ignition with no connection
    // check, so a tracker that dropped off the network mid-journey kept its
    // last speed forever and stayed "in transit": measured live, 14 vehicles
    // on this button against 4 on the map, the 10 extra all offline — one of
    // them reporting 49 km/h from a frame we no longer believe.
    if (!v.online) return null;

    // Nothing aboard: idle capacity for a carrier, business as usual for plant.
    const noLoad = carriesCargo(v) ? "empty" : "plant";

    const phase = v.phase ?? "";
    if (OPERATIONAL_STOP.test(phase)) return noLoad;
    if (ENROUTE.test(phase)) return v.weight > 0 ? "product" : noLoad;
    // Live rows carry no phase. Same predicate the map and the card use, so
    // the topbar count and the IN TRANSIT chip cannot disagree.
    if (!phase && isInTransit(v)) return v.weight > 0 ? "product" : noLoad;
    return null; // off duty
  };

  const activeFleet = vehicles.flatMap((v) => {
    const bucket = bucketOf(v);
    if (!bucket) return [];
    return [{
      vehicleId: v.vehicleId ?? v.id,
      plate: v.id,
      driver: v.driver,
      cargo: v.cargo,
      // What the machine IS — the only useful thing to say about a plant unit,
      // which has no cargo and no tonnage to report.
      machine: equipmentLabel(v),
      phase: v.phase,
      tonnes: v.weight,
      bucket,
      status: CHIP_STATUS[v.status] ?? "ok",
    }];
  });
  const emptyFleet = activeFleet.filter((c) => c.bucket === "empty");
  const plantFleet = activeFleet.filter((c) => c.bucket === "plant");
  const ferrying = activeFleet.filter((c) => c.bucket === "product");

  const liveSummary = summary
    ? {
        ...summary,
        emptyFleet,
        plantFleet,
        inTransit: {
          vehicleCount: activeFleet.length,
          // Tonnes actually being ferried — sums the product buckets, so the
          // tonnage balances against the product buttons the same way the
          // vehicle counts do (docked partial loads show on the EMPTY chips).
          sugarTonnes: +ferrying.reduce((sum, c) => sum + (c.tonnes ?? 0), 0).toFixed(1),
          vehicles: activeFleet,
        },
      }
    : summary;

  // Sukari hauls sugar; every other org's load is generic cargo.
  const cargoWord = activeCompany?.id === "sukari" ? "sugar" : "cargo";

  // (No maintenance bell here any more — both the jump and the attention
  // counter live on the footer's Maint nav icon. Its orphaned click handler
  // was still declared here and had been failing lint as unused.)

  // Buttons only for products ON THE ROAD right now — anything the org isn't
  // ferrying at this moment gets no button, which is what keeps the topbar
  // uncluttered. Only product-bucket vehicles create buttons (a docked loaded
  // vehicle sits in EMPTY and must not spawn a zero-count button). Live cargo
  // names are matched back to the 30d catalog (for the ferried-tonnage
  // figure); a live cargo missing from the catalog still gets a button with
  // its live tonnage. Heaviest live product first.
  const liveByProduct = new Map();
  for (const v of ferrying) {
    if (!v.cargo) continue;
    const k = productKey(v.cargo);
    const entry = liveByProduct.get(k) ?? { name: v.cargo, liveTonnes: 0 };
    entry.liveTonnes += v.tonnes;
    liveByProduct.set(k, entry);
  }
  const activeProducts = [...liveByProduct.entries()]
    .sort((a, b) => b[1].liveTonnes - a[1].liveTonnes)
    .map(([k, { name }]) => products.find((p) => productKey(p.product) === k) ?? { product: name, tonnes: null });

  useEffect(() => {
    setActiveStat(null);
  }, [activeCompany?.id]);

  useEffect(() => {
    if (desktopActiveTab !== "fleet") setActiveStat(null);
  }, [desktopActiveTab]);

  // If the active product's last vehicle finishes its haul, the button
  // disappears — close the orphaned FilterStrip with it.
  const liveProductKeys = [...liveByProduct.keys()].sort().join(",");
  useEffect(() => {
    if (activeStat?.startsWith("product:") && !liveProductKeys.split(",").includes(productKey(activeStat.slice("product:".length)))) {
      setActiveStat(null);
    }
  }, [activeStat, liveProductKeys]);

  const toggleStat = (key) => setActiveStat((prev) => (prev === key ? null : key));

  const statButtons = statMeta(liveSummary, activeProducts).map(({ key, label, color, icon }) => {
    const { value, unit, sub } = statValues(key, liveSummary, cargoWord, products);
    return (
      <StatButton
        key={key}
        label={label}
        value={value}
        unit={unit}
        sub={sub}
        color={color}
        icon={icon}
        active={activeStat === key}
        onClick={() => toggleStat(key)}
      />
    );
  });

  return (
    <>
      <header className="sukari-header">

        <div className="sukari-header__row">
          <CompanySwitcherDropdown />

          <div className="sukari-header__center">
            {desktopActiveTab === "fleet" && <StatCarousel>{statButtons}</StatCarousel>}
          </div>

          <div className="sukari-header__right">
            {/* The LIGHT/DARK switch used to sit between these two. The app
                ships one theme now, so a switch here could only ever have one
                position — and a control that never moves is read as broken
                long before it is read as decided. The account page keeps the
                Appearance row, disabled, which is where an explanation
                belongs; a header switch has no room to carry one. */}
            <SitePlanLinks />
            <UserMenu />
          </div>
        </div>

        <div className="sukari-header__top-row">
          <CompanySwitcherDropdown />

          <div className="sukari-header__top-right">
            {/* The LIGHT/DARK switch used to sit between these two. The app
                ships one theme now, so a switch here could only ever have one
                position — and a control that never moves is read as broken
                long before it is read as decided. The account page keeps the
                Appearance row, disabled, which is where an explanation
                belongs; a header switch has no room to carry one. */}
            <SitePlanLinks />
            <UserMenu />
          </div>
        </div>

        {desktopActiveTab === "fleet" && (
          <div className="sukari-header__bottom-row">
            <div className="sukari-header__stats-row">
              <StatCarousel>{statButtons}</StatCarousel>
            </div>
          </div>
        )}

      </header>

      {desktopActiveTab === "fleet" && activeStat && liveSummary && (
        <FilterStrip
          stat={activeStat}
          summary={liveSummary}
          cargoWord={cargoWord}
          products={products}
          onClose={() => setActiveStat(null)}
        />
      )}
    </>
  );
}
